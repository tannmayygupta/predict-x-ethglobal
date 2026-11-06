import { FlashQuoteResponse } from "@predictx/shared";
import type { Statement } from "better-sqlite3";
import type { OrderTypeName, RawTypedData } from "../clients/flash.types";
import type { Db } from "./sqlite";

export interface NewQuote {
  quoteId: string;
  walletAddress: string;
  symbol: string;
  orderType: OrderTypeName;
  expiresAt: number;
  response: FlashQuoteResponse;
  rawTypedData: RawTypedData;
  createdAt: number;
}

export interface StoredQuote extends NewQuote {
  /** Set once an order was submitted for this quote; quotes are single-use (D-B1). */
  usedAt: number | null;
}

interface QuoteRow {
  quote_id: string;
  wallet_address: string;
  symbol: string;
  order_type: string;
  expires_at: number;
  response: string;
  order_typed_data: string;
  permit_typed_data: string | null;
  created_at: number;
  used_at: number | null;
}

export class QuotesRepo {
  private readonly insertStmt: Statement<[QuoteRow]>;
  private readonly getStmt: Statement<[string], QuoteRow>;
  private readonly markUsedStmt: Statement<[number, string]>;

  constructor(db: Db) {
    this.insertStmt = db.prepare(
      `INSERT INTO quotes (quote_id, wallet_address, symbol, order_type, expires_at, response,
         order_typed_data, permit_typed_data, created_at, used_at)
       VALUES (@quote_id, @wallet_address, @symbol, @order_type, @expires_at, @response,
         @order_typed_data, @permit_typed_data, @created_at, @used_at)`,
    );
    this.getStmt = db.prepare("SELECT * FROM quotes WHERE quote_id = ?");
    this.markUsedStmt = db.prepare("UPDATE quotes SET used_at = ? WHERE quote_id = ? AND used_at IS NULL");
  }

  insert(quote: NewQuote): void {
    this.insertStmt.run({
      quote_id: quote.quoteId,
      wallet_address: quote.walletAddress,
      symbol: quote.symbol,
      order_type: quote.orderType,
      expires_at: quote.expiresAt,
      response: JSON.stringify(quote.response),
      order_typed_data: quote.rawTypedData.orderTypedData,
      permit_typed_data: quote.rawTypedData.permitTypedData,
      created_at: quote.createdAt,
      used_at: null,
    });
  }

  /** Atomic claim: true for the first caller only, so two concurrent submits cannot both pass. */
  markUsed(quoteId: string, usedAt: number): boolean {
    return this.markUsedStmt.run(usedAt, quoteId).changes === 1;
  }

  get(quoteId: string): StoredQuote | undefined {
    const row = this.getStmt.get(quoteId);
    return row ? toStoredQuote(row) : undefined;
  }
}

function toStoredQuote(row: QuoteRow): StoredQuote {
  return {
    quoteId: row.quote_id,
    walletAddress: row.wallet_address,
    symbol: row.symbol,
    // Validating on read keeps a corrupt row from reaching a client unparsed.
    orderType: FlashQuoteResponse.shape.orderType.parse(row.order_type),
    expiresAt: row.expires_at,
    response: FlashQuoteResponse.parse(JSON.parse(row.response)),
    rawTypedData: { orderTypedData: row.order_typed_data, permitTypedData: row.permit_typed_data },
    createdAt: row.created_at,
    usedAt: row.used_at,
  };
}
