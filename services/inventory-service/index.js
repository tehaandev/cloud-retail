require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { query, initDB, pool } = require("./db");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());

// Initialize Database and Seed Inventory
initDB().then(async () => {
  try {
    // Check if inventory table is empty
    const result = await query("SELECT COUNT(*) as count FROM inventory");
    const count = parseInt(result.rows[0].count, 10);

    if (count === 0) {
      console.log("Seeding initial inventory...");

      // Read seed data from service-local seeds directory
      const seedFilePath = path.join(__dirname, "seeds/products.json");
      const seedData = JSON.parse(fs.readFileSync(seedFilePath, "utf8"));

      for (const item of seedData) {
        await query(
          "INSERT INTO inventory (product_id, stock_quantity, reserved_quantity) VALUES ($1, $2, 0)",
          [item.id, item.stock]
        );
        console.log(`Seeded inventory for product: ${item.name} (ID: ${item.id}, Stock: ${item.stock})`);
      }
      console.log("Inventory seeding complete.");
    }
  } catch (err) {
    console.error("Error seeding inventory:", err);
  }
});

// In-memory event tracking (use Redis in production for distributed systems)
const processedEvents = new Map();

// --- ROUTES ---

// 1. Health Check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "Inventory Service is healthy" });
});

// 2. Get stock by Product ID
app.get("/inventory/:productId", async (req, res) => {
  try {
    const result = await query("SELECT * FROM inventory WHERE product_id = $1", [req.params.productId]);
    const item = result.rows[0];
    if (!item) {
      return res.status(404).json({ message: "Product inventory not found" });
    }
    // Calculate available stock (stock - reserved)
    const availableStock = item.stock_quantity - (item.reserved_quantity || 0);
    res.json({ ...item, available_stock: availableStock });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching inventory" });
  }
});

// 3. Reserve stock atomically (for order creation)
app.post("/inventory/reserve", async (req, res) => {
  const client = await pool.connect();
  try {
    const { productId, quantity } = req.body;

    if (!productId || !quantity || quantity <= 0) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "productId and positive quantity are required"
      });
    }

    await client.query("BEGIN");

    // Lock the row for update to prevent race conditions
    const lockResult = await client.query(
      "SELECT * FROM inventory WHERE product_id = $1 FOR UPDATE",
      [productId]
    );

    if (lockResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        code: "PRODUCT_NOT_FOUND",
        message: `Product ${productId} not found in inventory`
      });
    }

    const inventory = lockResult.rows[0];
    const availableStock = inventory.stock_quantity - inventory.reserved_quantity;

    if (availableStock < quantity) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        code: "INSUFFICIENT_STOCK",
        message: `Insufficient stock. Available: ${availableStock}, Requested: ${quantity}`,
        available: availableStock,
        requested: quantity
      });
    }

    // Reserve the stock by incrementing reserved_quantity
    const updateResult = await client.query(
      `UPDATE inventory
       SET reserved_quantity = reserved_quantity + $1,
           version = version + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE product_id = $2 AND version = $3
       RETURNING *`,
      [quantity, productId, inventory.version]
    );

    if (updateResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        code: "CONCURRENT_MODIFICATION",
        message: "Inventory was modified by another request. Please retry."
      });
    }

    await client.query("COMMIT");

    const updated = updateResult.rows[0];
    const newAvailable = updated.stock_quantity - updated.reserved_quantity;

    res.status(200).json({
      message: "Stock reserved successfully",
      reserved: true,
      available: newAvailable,
      productId: productId,
      reservedQuantity: quantity
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error reserving stock:", error);
    res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Error reserving stock"
    });
  } finally {
    client.release();
  }
});

// 4. Confirm reservation (move from reserved to actual decrement)
app.post("/inventory/confirm-reservation", async (req, res) => {
  const client = await pool.connect();
  try {
    const { productId, quantity } = req.body;

    if (!productId || !quantity || quantity <= 0) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "productId and positive quantity are required"
      });
    }

    await client.query("BEGIN");

    // Decrement both stock and reserved quantities
    const result = await client.query(
      `UPDATE inventory
       SET stock_quantity = stock_quantity - $1,
           reserved_quantity = reserved_quantity - $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE product_id = $2
       RETURNING *`,
      [quantity, productId]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        code: "PRODUCT_NOT_FOUND",
        message: `Product ${productId} not found in inventory`
      });
    }

    await client.query("COMMIT");

    res.status(200).json({
      message: "Reservation confirmed successfully",
      confirmed: true,
      productId: productId
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error confirming reservation:", error);
    res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Error confirming reservation"
    });
  } finally {
    client.release();
  }
});

// 5. Release reservation (rollback on order failure)
app.post("/inventory/release-reservation", async (req, res) => {
  const client = await pool.connect();
  try {
    const { productId, quantity } = req.body;

    if (!productId || !quantity || quantity <= 0) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "productId and positive quantity are required"
      });
    }

    await client.query("BEGIN");

    // Decrement reserved_quantity to release the hold
    const result = await client.query(
      `UPDATE inventory
       SET reserved_quantity = reserved_quantity - $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE product_id = $2
       RETURNING *`,
      [quantity, productId]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        code: "PRODUCT_NOT_FOUND",
        message: `Product ${productId} not found in inventory`
      });
    }

    await client.query("COMMIT");

    res.status(200).json({
      message: "Reservation released successfully",
      released: true,
      productId: productId
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error releasing reservation:", error);
    res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Error releasing reservation"
    });
  } finally {
    client.release();
  }
});

// 6. Webhook Event Consumer for OrderCreated (with idempotency)
app.post("/inventory/webhook/order-created", async (req, res) => {
  try {
    const { event_id, product_id, quantity, order_id } = req.body;

    // Validate required fields
    if (!event_id || !product_id || !quantity) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "event_id, product_id, and quantity are required"
      });
    }

    // Check if this event was already processed (idempotency)
    if (processedEvents.has(event_id)) {
      console.log(`[EVENT DUPLICATE] Event ${event_id} already processed. Returning success.`);
      return res.status(200).json({
        message: "Event already processed",
        duplicate: true,
        event_id
      });
    }

    console.log(`[EVENT CONSUMED] Processing event ${event_id} for order ${order_id}: product ${product_id}, quantity ${quantity}`);

    // Confirm the reservation (moves from reserved to actual decrement)
    const confirmResponse = await new Promise((resolve, reject) => {
      // Make internal call to confirm-reservation endpoint
      const http = require('http');
      const postData = JSON.stringify({ productId: product_id, quantity });

      const options = {
        hostname: 'localhost',
        port: process.env.PORT || 3004,
        path: '/inventory/confirm-reservation',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    if (confirmResponse.status === 200) {
      // Mark event as processed with timestamp
      processedEvents.set(event_id, { timestamp: Date.now(), order_id, product_id, quantity });

      // Cleanup old events (keep last 10000 events or 1 hour old)
      if (processedEvents.size > 10000) {
        const oneHourAgo = Date.now() - 3600000;
        for (const [key, value] of processedEvents.entries()) {
          if (value.timestamp < oneHourAgo) {
            processedEvents.delete(key);
          }
        }
      }

      console.log(`[EVENT SUCCESS] Inventory confirmed for product ${product_id}`);
      return res.status(200).json({
        message: "Inventory updated successfully",
        event_id,
        order_id
      });
    } else {
      console.error(`[EVENT FAILED] Failed to confirm reservation:`, confirmResponse.body);
      return res.status(confirmResponse.status).json(confirmResponse.body);
    }
  } catch (error) {
    console.error("[EVENT ERROR] Error processing webhook:", error);
    res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Error updating inventory"
    });
  }
});

// --- SERVER START ---
const PORT = process.env.PORT || 3004;
app.listen(PORT, () => {
  console.log(`Inventory Service running on port ${PORT}`);
});
