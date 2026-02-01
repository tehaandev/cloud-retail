const { Pool } = require('pg');

// Support both DATABASE_URL (local) and component-based (production)
const connectionString = process.env.DATABASE_URL ||
  `postgres://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

const pool = new Pool({
  connectionString,
  ssl: process.env.DB_HOST ? { rejectUnauthorized: false } : false,
});

// Helper to run queries
const query = (text, params) => pool.query(text, params);

// Initialize DB schema
const initDB = async () => {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(50) DEFAULT 'customer',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await query(createTableQuery);
    console.log('Postgres IAM table initialized');
  } catch (err) {
    console.error('Error initializing DB:', err);
  }
};

module.exports = {
  query,
  initDB,
};
