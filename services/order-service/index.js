require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { query, initDB } = require("./db");

const app = express();
app.use(express.json());
app.use(cors());

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

    // 1. Validate product exists and get price (Mock call to Product Service)
    // In a real scenario, we'd use internal service-to-service auth
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

    // 3. Publish Event (Mocking EventBridge for now)
    console.log(`[EVENT] OrderCreated: ${JSON.stringify(order)}`);
    // TODO: Integrate with AWS EventBridge

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
