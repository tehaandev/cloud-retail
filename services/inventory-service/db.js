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
      reserved_quantity INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const addConstraintsQuery = `
    DO $$
    BEGIN
      -- Add CHECK constraint for stock_quantity if it doesn't exist
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'inventory_stock_quantity_check'
      ) THEN
        ALTER TABLE inventory ADD CONSTRAINT inventory_stock_quantity_check CHECK (stock_quantity >= 0);
      END IF;

      -- Add CHECK constraint for reserved_quantity if it doesn't exist
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'inventory_reserved_quantity_check'
      ) THEN
        ALTER TABLE inventory ADD CONSTRAINT inventory_reserved_quantity_check CHECK (reserved_quantity >= 0);
      END IF;
    END $$;
  `;

  const createTriggerFunction = `
    CREATE OR REPLACE FUNCTION check_inventory_sanity()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.stock_quantity - NEW.reserved_quantity < 0 THEN
        RAISE EXCEPTION 'Available stock cannot be negative (stock: %, reserved: %)', NEW.stock_quantity, NEW.reserved_quantity;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `;

  const createTrigger = `
    DROP TRIGGER IF EXISTS inventory_sanity_check ON inventory;
    CREATE TRIGGER inventory_sanity_check
    BEFORE INSERT OR UPDATE ON inventory
    FOR EACH ROW EXECUTE FUNCTION check_inventory_sanity();
  `;

  try {
    await query(createTableQuery);
    console.log('Postgres Inventory table initialized');

    await query(addConstraintsQuery);
    console.log('Inventory table constraints added');

    await query(createTriggerFunction);
    console.log('Inventory sanity check function created');

    await query(createTrigger);
    console.log('Inventory sanity check trigger created');
  } catch (err) {
    console.error('Error initializing DB:', err);
  }
};

module.exports = {
  query,
  initDB,
  pool,
};
