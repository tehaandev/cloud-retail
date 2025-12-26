require("dotenv").config();
const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// --- MOCK DATABASE (Temporary, until we add Docker Postgres) ---
const users = []; // Acts as our DB table for now

// --- HELPER FUNCTIONS ---
const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
};

// --- ROUTES ---

// 1. Health Check (To prove the service is running)
app.get("/health", (req, res) => {
  res.status(200).json({ status: "IAM Service is healthy" });
});

// 2. Register Endpoint
app.post("/auth/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if user exists (Mock check)
    const userExists = users.find((u) => u.email === email);
    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user (Mock DB save)
    const newUser = {
      id: Date.now().toString(), // Simple ID generation
      email,
      password: hashedPassword,
      role: "customer",
    };
    users.push(newUser);

    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// 3. Login Endpoint
app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = users.find((u) => u.email === email);
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
    res.status(500).json({ message: "Server error" });
  }
});

// --- SERVER START ---
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`IAM Service running on port ${PORT}`);
});

