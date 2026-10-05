-- Current schema. For both new and existing deployments, prefer `wrangler d1 migrations apply`.
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer TEXT NOT NULL,
  branch TEXT NOT NULL,
  items TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Nuevo',
  total REAL NOT NULL,
  created_at INTEGER NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  updated_at INTEGER,
  request_id TEXT,
  tracking_token TEXT,
  payload_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_branch_status_created ON orders(branch, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_request_id ON orders(request_id) WHERE request_id IS NOT NULL;
