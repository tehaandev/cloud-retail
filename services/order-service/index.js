require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const { query, initDB, pool } = require("./db");

const app = express();
app.use(express.json());
app.use(cors());

// Initialize EventBridge
const eventbridge = new AWS.EventBridge({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

// Initialize Database
initDB();

// --- ROUTES ---

// 1. Health Check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "Order Service is healthy" });
});

// 2. Create Order (with stock reservation and validation)
app.post("/orders", async (req, res) => {
  const client = await pool.connect();
  let stockReserved = false;
  let reservationData = null;

  try {
    const { userId, productId, quantity, idempotencyKey } = req.body;

    // Step 1: Input Validation
    if (!userId || !productId || !quantity) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "userId, productId, and quantity are required",
        errors: [
          !userId && { field: "userId", message: "userId is required" },
          !productId && { field: "productId", message: "productId is required" },
          !quantity && { field: "quantity", message: "quantity is required" }
        ].filter(Boolean)
      });
    }

    if (typeof quantity !== 'number' || quantity <= 0 || quantity > 10000) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "Quantity must be a positive number between 1 and 10000",
        errors: [{ field: "quantity", message: "Quantity must be between 1 and 10000" }]
      });
    }

    // Step 2: Check Idempotency (prevent duplicate orders)
    if (idempotencyKey) {
      const existingOrder = await query(
        "SELECT * FROM orders WHERE idempotency_key = $1",
        [idempotencyKey]
      );
      if (existingOrder.rows.length > 0) {
        console.log(`[IDEMPOTENCY] Returning existing order for key: ${idempotencyKey}`);
        return res.status(200).json({
          ...existingOrder.rows[0],
          duplicate: true
        });
      }
    }

    // Step 3: Validate product exists and get price
    let product;
    try {
      const response = await axios.get(
        `${process.env.PRODUCT_SERVICE_URL}/products/${productId}`,
        { timeout: 5000 }
      );
      product = response.data;
    } catch (err) {
      if (err.response?.status === 404) {
        return res.status(404).json({
          code: "PRODUCT_NOT_FOUND",
          message: `Product ${productId} not found`
        });
      }
      console.error("[ERROR] Product service unavailable:", err.message);
      return res.status(503).json({
        code: "SERVICE_UNAVAILABLE",
        message: "Product service is currently unavailable. Please try again later."
      });
    }

    const totalPrice = product.price * quantity;

    // Step 4: Reserve Stock (synchronous call to Inventory Service)
    const inventoryServiceUrl = process.env.INVENTORY_SERVICE_URL || "http://localhost:3004";
    try {
      const reserveResponse = await axios.post(
        `${inventoryServiceUrl}/inventory/reserve`,
        { productId, quantity },
        { timeout: 5000 }
      );
      stockReserved = true;
      reservationData = reserveResponse.data;
      console.log(`[STOCK] Reserved ${quantity} units of product ${productId}. Available: ${reservationData.available}`);
    } catch (err) {
      if (err.response?.status === 409 && err.response?.data?.code === "INSUFFICIENT_STOCK") {
        return res.status(409).json({
          code: "INSUFFICIENT_STOCK",
          message: err.response.data.message,
          available: err.response.data.available,
          requested: quantity
        });
      }
      if (err.response?.status === 404) {
        return res.status(404).json({
          code: "PRODUCT_NOT_IN_INVENTORY",
          message: `Product ${productId} not found in inventory`
        });
      }
      console.error("[ERROR] Inventory service error:", err.message);
      return res.status(503).json({
        code: "SERVICE_UNAVAILABLE",
        message: "Inventory service is currently unavailable. Please try again later."
      });
    }

    // Step 5: Begin Database Transaction
    await client.query("BEGIN");

    try {
      // Step 6: Insert Order into Database
      const insertResult = await client.query(
        `INSERT INTO orders (user_id, product_id, quantity, total_price, status, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [userId, productId, quantity, totalPrice, "pending", idempotencyKey || null]
      );

      const order = insertResult.rows[0];
      console.log(`[ORDER] Created order ${order.id} for user ${userId}`);

      // Step 7: Publish Event to EventBridge
      const eventId = `${order.id}-${uuidv4()}`;
      const eventDetail = {
        event_id: eventId,
        order_id: order.id,
        user_id: userId,
        product_id: productId,
        quantity: quantity,
        total_price: totalPrice,
        created_at: order.created_at
      };

      const params = {
        Entries: [
          {
            Source: "com.cloudretail.order",
            DetailType: "OrderCreated",
            Detail: JSON.stringify(eventDetail),
            EventBusName: process.env.EVENT_BUS_NAME || "default",
          },
        ],
      };

      try {
        await eventbridge.putEvents(params).promise();
        console.log(`[EVENT] OrderCreated published to EventBridge: ${order.id}, event_id: ${eventId}`);
      } catch (eventError) {
        console.error("[ERROR] Failed to publish event to EventBridge:", eventError);
        // Rollback everything if event publish fails
        throw new Error("Failed to publish order event");
      }

      // Step 8: Commit Transaction
      await client.query("COMMIT");

      // Return success response with available stock info
      res.status(201).json({
        ...order,
        available_stock: reservationData.available
      });

    } catch (dbError) {
      // Rollback database transaction
      await client.query("ROLLBACK");
      throw dbError;
    }

  } catch (error) {
    console.error("[ERROR] Order creation failed:", error);

    // Step 9: Release Stock Reservation on ANY Failure
    if (stockReserved && reservationData) {
      try {
        const inventoryServiceUrl = process.env.INVENTORY_SERVICE_URL || "http://localhost:3004";
        await axios.post(
          `${inventoryServiceUrl}/inventory/release-reservation`,
          { productId: req.body.productId, quantity: req.body.quantity },
          { timeout: 5000 }
        );
        console.log(`[ROLLBACK] Released stock reservation for product ${req.body.productId}`);
      } catch (releaseError) {
        console.error("[ERROR] Failed to release stock reservation:", releaseError.message);
        // Log this for manual intervention
      }
    }

    res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Failed to create order. Please try again."
    });
  } finally {
    client.release();
  }
});

// 3. Get Order by ID
app.get("/orders/:id", async (req, res) => {
  try {
    const result = await query("SELECT * FROM orders WHERE id = $1", [
      req.params.id,
    ]);
    const order = result.rows[0];
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    res.json(order);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching order" });
  }
});

// --- SERVER START ---
const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
  console.log(`Order Service running on port ${PORT}`);
});

