require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const AWS = require("aws-sdk");
const { query, initDB } = require("./db");

const app = express();
app.use(express.json());
app.use(cors());

// Initialize EventBridge
const eventbridge = new AWS.EventBridge({ region: process.env.AWS_REGION || 'us-east-1' });

// Initialize Database
initDB();

// --- ROUTES ---

// 1. Health Check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "Order Service is healthy" });
});

// 2. Create Order
app.post("/orders", async (req, res) => {
  try {
    const { userId, productId, quantity } = req.body;

    // 1. Validate product exists and get price
    let product;
    try {
      const response = await axios.get(`${process.env.PRODUCT_SERVICE_URL}/products/${productId}`);
      product = response.data;
    } catch (err) {
      return res.status(404).json({ message: "Product not found or unavailable" });
    }

    const totalPrice = product.price * quantity;

    // 2. Save order to DB
    const result = await query(
      "INSERT INTO orders (user_id, product_id, quantity, total_price, status) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [userId, productId, quantity, totalPrice, "pending"]
    );

    const order = result.rows[0];

    // 3. Publish Event to EventBridge
    const params = {
      Entries: [
        {
          Source: 'com.cloudretail.order',
          DetailType: 'OrderCreated',
          Detail: JSON.stringify(order),
          EventBusName: process.env.EVENT_BUS_NAME || 'default',
        },
      ],
    };

    try {
      await eventbridge.putEvents(params).promise();
      console.log(`[EVENT] OrderCreated published to EventBridge: ${order.id}`);
    } catch (eventError) {
      console.error("[ERROR] Failed to publish event to EventBridge:", eventError);
      // We don't fail the request here, but in production you'd use a DLQ or retry pattern
    }

    res.status(201).json(order);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error creating order" });
  }
});

// 3. Get Order by ID
app.get("/orders/:id", async (req, res) => {
  try {
    const result = await query("SELECT * FROM orders WHERE id = $1", [req.params.id]);
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
