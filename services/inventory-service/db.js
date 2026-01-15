const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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
