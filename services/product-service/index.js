require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const { docClient, initDB, TABLE_NAME } = require("./db");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());

// Initialize Database
initDB().then(async () => {
  // Check if products exist, if not seed some
  try {
    const data = await docClient.scan({ TableName: TABLE_NAME }).promise();
    for (const item of data.Items) {
      await docClient
        .delete({ TableName: TABLE_NAME, Key: { id: item.id } })
        .promise();
    }
    if (data.Items.length === 0) {
      console.log("Seeding initial products...");

      // Read seed data from service-local seeds directory
      const seedFilePath = path.join(__dirname, "seeds/products.json");
      const seedData = JSON.parse(fs.readFileSync(seedFilePath, "utf8"));

      for (const item of seedData) {
        // Store only catalog data (no stock field)
        const product = {
          id: item.id,
          name: item.name,
          description: item.description,
          price: item.price,
          createdAt: new Date().toISOString(),
        };
        await docClient.put({ TableName: TABLE_NAME, Item: product }).promise();
        console.log(`Seeded product: ${product.name} (ID: ${product.id})`);
      }
      console.log("Product seeding complete.");
    }
  } catch (err) {
    console.error("Error seeding data:", err);
  }
});

// --- ROUTES ---

// 1. Health Check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "Product Service is healthy" });
});

// 2. Get all products
app.get("/products", async (req, res) => {
  try {
    const params = {
      TableName: TABLE_NAME,
    };
    const data = await docClient.scan(params).promise();
    res.json(data.Items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching products" });
  }
});

// 3. Get product by ID
app.get("/products/:id", async (req, res) => {
  try {
    const params = {
      TableName: TABLE_NAME,
      Key: { id: req.params.id },
    };
    const data = await docClient.get(params).promise();
    if (!data.Item) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.json(data.Item);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching product" });
  }
});

// 4. Create product (Mock Admin)
app.post("/products", async (req, res) => {
  try {
    const { name, description, price } = req.body;
    const newProduct = {
      id: uuidv4(),
      name,
      description,
      price,
      createdAt: new Date().toISOString(),
    };

    const params = {
      TableName: TABLE_NAME,
      Item: newProduct,
    };

    await docClient.put(params).promise();
    res.status(201).json(newProduct);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error creating product" });
  }
});

// --- SERVER START ---
const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`Product Service running on port ${PORT}`);
});

