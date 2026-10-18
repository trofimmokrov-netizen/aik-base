CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  owner_telegram_id TEXT,
  access_hash TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','reviewing','agreed','in_progress','completed','cancelled')),
  created_at TEXT NOT NULL,
  notification_status TEXT NOT NULL DEFAULT 'pending' CHECK(notification_status IN ('pending','sent')),
  idempotency_hash TEXT UNIQUE NOT NULL,
  body_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_owner ON orders(owner_telegram_id, created_at DESC);
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','done')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox(state, available_at, locked_until);
CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id INTEGER PRIMARY KEY,
  processing_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_expiry ON rate_limits(expires_at);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
