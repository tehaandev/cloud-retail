require("dotenv").config();
const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const { query, initDB } = require("./db");

const app = express();
app.use(express.json());
app.use(cors());

// Initialize Database
initDB();

// --- HELPER FUNCTIONS ---
const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
};

// --- ROUTES ---

// 1. Health Check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "IAM Service is healthy" });
});

// 2. Register Endpoint
app.post("/auth/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if user exists
    const userCheck = await query("SELECT * FROM users WHERE email = $1", [email]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const result = await query(
      "INSERT INTO users (email, password, role) VALUES ($1, $2, $3) RETURNING id, email, role",
      [email, hashedPassword, "customer"]
    );

    res.status(201).json({ 
      message: "User registered successfully",
      user: result.rows[0]
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// 3. Login Endpoint
app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const result = await query("SELECT * FROM users WHERE email = $1", [email]);
    const user = result.rows[0];
    
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Generate JWT
    const token = generateToken(user);

    res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// --- SERVER START ---
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`IAM Service running on port ${PORT}`);
});

