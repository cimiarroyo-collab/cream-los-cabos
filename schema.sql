-- Current schema. For both new and existing deployments, prefer `wrangler d1 migrations apply`.
CREATE TABLE IF NOT EXISTS club_members (
  id TEXT PRIMARY KEY,
  access_token_hash TEXT NOT NULL,
  customer TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL
);
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
  payload_hash TEXT,
  member_id TEXT REFERENCES club_members(id)
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_branch_status_created ON orders(branch, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_request_id ON orders(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_member_created ON orders(member_id, created_at DESC);
