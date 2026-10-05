ALTER TABLE orders ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN note TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN updated_at INTEGER;
ALTER TABLE orders ADD COLUMN request_id TEXT;
ALTER TABLE orders ADD COLUMN tracking_token TEXT;
ALTER TABLE orders ADD COLUMN payload_hash TEXT;
UPDATE orders SET updated_at = created_at WHERE updated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orders_branch_status_created ON orders(branch, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_request_id ON orders(request_id) WHERE request_id IS NOT NULL;
