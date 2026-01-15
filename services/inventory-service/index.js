require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { query, initDB } = require("./db");

const app = express();
app.use(express.json());
app.use(cors());

// Initialize Database
initDB();

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
    res.json(item);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching inventory" });
  }
});

// 3. Mock Event Consumer for OrderCreated
app.post("/inventory/webhook/order-created", async (req, res) => {
  try {
    const { product_id, quantity } = req.body;
    console.log(`[EVENT CONSUMED] Updating inventory for product ${product_id}, reducing by ${quantity}`);

    // Atomic decrement of stock
    const result = await query(
      "UPDATE inventory SET stock_quantity = stock_quantity - $1 WHERE product_id = $2 RETURNING *",
      [quantity, product_id]
    );

    if (result.rows.length === 0) {
      console.warn(`Product ${product_id} not found in inventory. Creating record...`);
      // Initial stock might come from product service, but here we just mock it
      await query(
        "INSERT INTO inventory (product_id, stock_quantity) VALUES ($1, $2)",
        [product_id, 100 - quantity] // Mock initial 100
      );
    }

    res.status(200).json({ message: "Inventory updated" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error updating inventory" });
  }
});

// --- SERVER START ---
const PORT = process.env.PORT || 3004;
app.listen(PORT, () => {
  console.log(`Inventory Service running on port ${PORT}`);
});
