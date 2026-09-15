require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_URL &&
    !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
      ? { rejectUnauthorized: false }
      : false,
});

app.use(express.json());
app.use(cookieParser());

// Serve the website files from the repository root
app.use(express.static(__dirname));

// Database setup
async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_settings (
      id INTEGER PRIMARY KEY,
      data JSONB NOT NULL
    )
  `);

  const result = await pool.query(
    "SELECT id FROM site_settings WHERE id = 1"
  );

  if (result.rows.length === 0) {
    const defaultData = {
      siteName: "HOMS TECH",
      tagline: "Phone repair at your doorstep",
      phone: "",
      whatsapp: "",
      email: "",
      services: [
        "Screen Replacement",
        "Battery Replacement",
        "Charging Port Repair",
        "Camera Repair",
        "Software Repair",
      ],
      features: [
        "We come to your home",
        "Fast service",
        "Professional repair",
        "Warranty on repairs",
      ],
      devices: [
        { name: "iPhone 12", price: "" },
        { name: "iPhone 13", price: "" },
        { name: "iPhone 14", price: "" },
        { name: "iPhone 15", price: "" },
        { name: "iPhone 16", price: "" },
        { name: "iPhone 17", price: "" },
      ],
    };

    await pool.query(
      "INSERT INTO site_settings (id, data) VALUES (1, $1)",
      [JSON.stringify(defaultData)]
    );
  }
}

// Public API
app.get("/api/site", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT data FROM site_settings WHERE id = 1"
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Settings not found" });
    }

    res.json(result.rows[0].data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

// Login
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  if (
    username !== process.env.ADMIN_USERNAME ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const token = jwt.sign(
   
