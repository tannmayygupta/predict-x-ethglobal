import { InsightResponse } from "@predictx/shared";
import type { Statement } from "better-sqlite3";
import type { Db } from "./sqlite";

interface InsightRow {
  response: string;
}

/** FR-B-05 insight cache: one row per (symbol, intent) key with an absolute expiry in unix seconds. */
export class InsightsRepo {
  private readonly putStmt: Statement<[string, string, number]>;
  private readonly getStmt: Statement<[string, number], InsightRow>;
  private readonly purgeStmt: Statement<[number]>;

  constructor(db: Db) {
    this.putStmt = db.prepare(
      `INSERT INTO insights (key, response, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET response = excluded.response, expires_at = excluded.expires_at`,
    );
    this.getStmt = db.prepare("SELECT response FROM insights WHERE key = ? AND expires_at > ?");
    this.purgeStmt = db.prepare("DELETE FROM insights WHERE expires_at <= ?");
  }

  put(key: string, response: InsightResponse, expiresAt: number): void {
    this.putStmt.run(key, JSON.stringify(response), expiresAt);
  }

  purgeExpired(now: number): number {
    return this.purgeStmt.run(now).changes;
  }

  /** Expired at exactly expiresAt, like the TtlCache. */
  get(key: string, now: number): InsightResponse | undefined {
    const row = this.getStmt.get(key, now);
    return row ? InsightResponse.parse(JSON.parse(row.response)) : undefined;
  }
}
