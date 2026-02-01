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
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      product_id VARCHAR(255) NOT NULL,
      quantity INTEGER NOT NULL,
      total_price DECIMAL(10, 2) NOT NULL,
      status VARCHAR(50) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await query(createTableQuery);
    console.log('Postgres Order table initialized');
  } catch (err) {
    console.error('Error initializing DB:', err);
  }
};

module.exports = {
  query,
  initDB,
};
