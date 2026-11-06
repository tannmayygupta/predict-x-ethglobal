import Database from "better-sqlite3";

export type Db = Database.Database;

const BUSY_TIMEOUT_MS = 5000;

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  return db;
}

/** FR-B-05: quotes, orders and the insight cache only. Pool data is never stored here. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS quotes (
  quote_id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  symbol TEXT NOT NULL,
  order_type TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  response TEXT NOT NULL,
  order_typed_data TEXT NOT NULL,
  permit_typed_data TEXT,
  created_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  order_type TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS insights (
  key TEXT PRIMARY KEY,
  response TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

export function migrate(db: Db): void {
  db.exec(SCHEMA);
}
