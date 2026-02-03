const { Pool } = require("pg");

// Support both DATABASE_URL (local) and component-based (production)
const connectionString =
  process.env.DATABASE_URL ||
  `postgres://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

const pool = new Pool({
  connectionString,
  ssl: process.env.DB_HOST ? { rejectUnauthorized: false } : false,
});

const query = (text, params) => pool.query(text, params);

const initDB = async () => {
  const createTableQuery = `
    DROP TABLE IF EXISTS orders;
    CREATE TABLE orders (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      product_id VARCHAR(255) NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 10000),
      total_price DECIMAL(10, 2) NOT NULL CHECK (total_price >= 0),
      status VARCHAR(50) DEFAULT 'pending',
      idempotency_key VARCHAR(255) UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const addConstraintsQuery = `
    DO $$
    BEGIN
      -- Add CHECK constraint for quantity if it doesn't exist
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'orders_quantity_check'
      ) THEN
        ALTER TABLE orders ADD CONSTRAINT orders_quantity_check CHECK (quantity > 0 AND quantity <= 10000);
      END IF;

      -- Add CHECK constraint for total_price if it doesn't exist
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'orders_total_price_check'
      ) THEN
        ALTER TABLE orders ADD CONSTRAINT orders_total_price_check CHECK (total_price >= 0);
      END IF;
    END $$;
  `;

  try {
    await query(createTableQuery);
    console.log("Postgres Order table initialized");

    await query(addConstraintsQuery);
    console.log("Order table constraints added");
  } catch (err) {
    console.error("Error initializing DB:", err);
  }
};

module.exports = {
  query,
  initDB,
  pool,
};

