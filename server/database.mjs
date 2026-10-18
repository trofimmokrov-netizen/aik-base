import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";

export function openDatabase(filename) {
  if (filename !== ":memory:")
    mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  if (filename !== ":memory:") chmodSync(filename, 0o600);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      owner_telegram_id TEXT,
      access_hash TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL,
      notification_status TEXT NOT NULL DEFAULT 'pending',
      notification_attempts INTEGER NOT NULL DEFAULT 0,
      next_notification_at INTEGER NOT NULL DEFAULT 0,
      idempotency_hash TEXT UNIQUE NOT NULL,
      body_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS telegram_updates (
      update_id INTEGER PRIMARY KEY,
      payload TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      retry_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS orders_notify ON orders(notification_status, next_notification_at);
  `);
  return db;
}
export function publicOrder(row) {
  const payload = JSON.parse(row.payload);
  return {
    id: row.id,
    serviceId: payload.serviceId,
    description: payload.description,
    status: row.status,
    createdAt: row.created_at,
    notificationStatus: row.notification_status,
  };
}
