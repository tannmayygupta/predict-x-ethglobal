import { FlashOrderDetail, OrderStatus } from "@predictx/shared";
import type { Statement } from "better-sqlite3";
import type { OrderTypeName } from "../clients/flash.types";
import type { Db } from "./sqlite";

export interface StoredOrder {
  orderId: string;
  quoteId: string;
  walletAddress: string;
  orderType: OrderTypeName;
  status: OrderStatus;
  detail: FlashOrderDetail;
  createdAt: number;
  updatedAt: number;
}

interface OrderRow {
  order_id: string;
  quote_id: string;
  wallet_address: string;
  order_type: string;
  status: string;
  detail: string;
  created_at: number;
  updated_at: number;
}

export class OrdersRepo {
  private readonly insertStmt: Statement<[OrderRow]>;
  private readonly getStmt: Statement<[string], OrderRow>;
  private readonly updateStmt: Statement<[string, string, number, string]>;

  constructor(db: Db) {
    this.insertStmt = db.prepare(
      `INSERT INTO orders (order_id, quote_id, wallet_address, order_type, status, detail, created_at, updated_at)
       VALUES (@order_id, @quote_id, @wallet_address, @order_type, @status, @detail, @created_at, @updated_at)`,
    );
    this.getStmt = db.prepare("SELECT * FROM orders WHERE order_id = ?");
    this.updateStmt = db.prepare("UPDATE orders SET status = ?, detail = ?, updated_at = ? WHERE order_id = ?");
  }

  insert(order: StoredOrder): void {
    this.insertStmt.run({
      order_id: order.orderId,
      quote_id: order.quoteId,
      wallet_address: order.walletAddress,
      order_type: order.orderType,
      status: order.status,
      detail: JSON.stringify(order.detail),
      created_at: order.createdAt,
      updated_at: order.updatedAt,
    });
  }

  get(orderId: string): StoredOrder | undefined {
    const row = this.getStmt.get(orderId);
    return row ? toStoredOrder(row) : undefined;
  }

  /** The status column mirrors detail.status so terminal orders can be found without parsing JSON. */
  updateDetail(orderId: string, detail: FlashOrderDetail, updatedAt: number): void {
    this.updateStmt.run(detail.status, JSON.stringify(detail), updatedAt, orderId);
  }
}

function toStoredOrder(row: OrderRow): StoredOrder {
  return {
    orderId: row.order_id,
    quoteId: row.quote_id,
    walletAddress: row.wallet_address,
    orderType: FlashOrderDetail.shape.orderType.parse(row.order_type),
    status: OrderStatus.parse(row.status),
    detail: FlashOrderDetail.parse(JSON.parse(row.detail)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
