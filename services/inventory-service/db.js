const { Pool } = require('pg');

// Support both DATABASE_URL (local) and component-based (production)
const connectionString = process.env.DATABASE_URL ||
  `postgres://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

const pool = new Pool({
  connectionString,
  ssl: process.env.DB_HOST ? { rejectUnauthorized: false } : false,
});

const query = (text, params) => pool.query(text, params);

const initDB = async () => {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS inventory (
      product_id VARCHAR(255) PRIMARY KEY,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await query(createTableQuery);
    console.log('Postgres Inventory table initialized');
  } catch (err) {
    console.error('Error initializing DB:', err);
  }
};

module.exports = {
  query,
  initDB,
};
