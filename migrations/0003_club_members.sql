-- Add private Club cards and associate future orders without changing existing order data.
CREATE TABLE club_members (
  id TEXT PRIMARY KEY,
  access_token_hash TEXT NOT NULL,
  customer TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL
);
ALTER TABLE orders ADD COLUMN member_id TEXT REFERENCES club_members(id);
CREATE INDEX idx_orders_member_created ON orders(member_id, created_at DESC);
