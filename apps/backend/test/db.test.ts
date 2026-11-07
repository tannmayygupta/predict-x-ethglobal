import { FlashOrderDetail, FlashQuoteResponse, InsightResponse, fixtures } from "@predictx/shared";
import { describe, expect, it } from "vitest";
import { InsightsRepo } from "../src/db/insights";
import { OrdersRepo } from "../src/db/orders";
import { QuotesRepo } from "../src/db/quotes";
import { migrate, openDb } from "../src/db/sqlite";

function tableNames(db: ReturnType<typeof openDb>): string[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  return rows.map((r) => String((r as { name: string }).name)).sort();
}

describe("B01-23 migrate creates exactly three tables", () => {
  it("quotes, orders, insights and nothing else (FR-B-05: no pools table)", () => {
    const db = openDb(":memory:");
    migrate(db);
    expect(tableNames(db)).toEqual(["insights", "orders", "quotes"]);
    db.close();
  });
});

describe("B01-24 migrate is idempotent", () => {
  it("a second call neither throws nor duplicates tables", () => {
    const db = openDb(":memory:");
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
    expect(tableNames(db)).toEqual(["insights", "orders", "quotes"]);
    db.close();
  });
});

const WALLET = "0x1111111111111111111111111111111111111111";
const RAW_ORDER = '{"types":{"EIP712Domain":[]},"domain":{"chainId":"8453"},"primaryType":"FlashOrder","message":{"deadline":"1761600300"}}';
const RAW_PERMIT = '{"types":{},"domain":{},"primaryType":"PermitSingle","message":{"nonce":"0"}}';

describe("B01-25 quotes repository", () => {
  it("insert then get round-trips the FlashQuoteResponse and the raw typed-data strings byte-for-byte", () => {
    const db = openDb(":memory:");
    migrate(db);
    const quotes = new QuotesRepo(db);
    const row = {
      quoteId: "q_123",
      walletAddress: WALLET,
      symbol: "ETH",
      orderType: "market" as const,
      expiresAt: 1761600060,
      response: fixtures.quoteEthMarket,
      rawTypedData: { orderTypedData: RAW_ORDER, permitTypedData: RAW_PERMIT },
      createdAt: 1761600000,
    };
    quotes.insert(row);
    const stored = quotes.get("q_123");
    expect(stored).toBeDefined();
    expect(stored?.response).toEqual(fixtures.quoteEthMarket);
    expect(FlashQuoteResponse.parse(stored?.response)).toEqual(fixtures.quoteEthMarket);
    expect(stored?.rawTypedData.orderTypedData).toBe(RAW_ORDER);
    expect(stored?.rawTypedData.permitTypedData).toBe(RAW_PERMIT);
    expect(stored).toMatchObject({
      quoteId: "q_123",
      walletAddress: WALLET,
      symbol: "ETH",
      orderType: "market",
      expiresAt: 1761600060,
      createdAt: 1761600000,
      usedAt: null,
    });
    expect(quotes.get("q_missing")).toBeUndefined();
    db.close();
  });
  it("stores a null permit as null", () => {
    const db = openDb(":memory:");
    migrate(db);
    const quotes = new QuotesRepo(db);
    quotes.insert({
      quoteId: "q_1",
      walletAddress: WALLET,
      symbol: "ETH",
      orderType: "limit",
      expiresAt: 1,
      response: fixtures.quoteEthMarket,
      rawTypedData: { orderTypedData: RAW_ORDER, permitTypedData: null },
      createdAt: 0,
    });
    expect(quotes.get("q_1")?.rawTypedData.permitTypedData).toBeNull();
    db.close();
  });
});

describe("B01-25-markUsed single-use quotes (D-B1)", () => {
  it("markUsed succeeds once, records usedAt, and refuses a second use or an unknown id", () => {
    const db = openDb(":memory:");
    migrate(db);
    const quotes = new QuotesRepo(db);
    quotes.insert({
      quoteId: "q_1",
      walletAddress: WALLET,
      symbol: "ETH",
      orderType: "market",
      expiresAt: 10,
      response: fixtures.quoteEthMarket,
      rawTypedData: { orderTypedData: RAW_ORDER, permitTypedData: null },
      createdAt: 0,
    });
    expect(quotes.markUsed("q_1", 5)).toBe(true);
    expect(quotes.get("q_1")?.usedAt).toBe(5);
    expect(quotes.markUsed("q_1", 6)).toBe(false);
    expect(quotes.get("q_1")?.usedAt).toBe(5);
    expect(quotes.markUsed("q_missing", 7)).toBe(false);
    db.close();
  });
});

describe("B01-26 orders repository", () => {
  it("insert, get and updateDetail round-trip; unknown id is undefined", () => {
    const db = openDb(":memory:");
    migrate(db);
    const orders = new OrdersRepo(db);
    expect(orders.get("o_missing")).toBeUndefined();
    const submitted: FlashOrderDetail = {
      ...fixtures.orderFilled,
      status: "submitted",
      txHash: null,
      filledAmount: null,
      updatedAt: 1761600000,
    };
    orders.insert({
      orderId: "o_456",
      quoteId: "q_123",
      walletAddress: WALLET,
      orderType: "market",
      status: "submitted",
      detail: submitted,
      createdAt: 1761600000,
      updatedAt: 1761600000,
    });
    expect(orders.get("o_456")).toEqual({
      orderId: "o_456",
      quoteId: "q_123",
      walletAddress: WALLET,
      orderType: "market",
      status: "submitted",
      detail: submitted,
      createdAt: 1761600000,
      updatedAt: 1761600000,
    });
    orders.updateDetail("o_456", fixtures.orderFilled, 1761600030);
    const updated = orders.get("o_456");
    expect(updated?.status).toBe("filled");
    expect(updated?.detail).toEqual(fixtures.orderFilled);
    expect(FlashOrderDetail.parse(updated?.detail)).toEqual(fixtures.orderFilled);
    expect(updated?.updatedAt).toBe(1761600030);
    expect(updated?.createdAt).toBe(1761600000);
    db.close();
  });
});

describe("B01-27 insights repository", () => {
  it("get returns the response before expiry and undefined at or after expiry", () => {
    const db = openDb(":memory:");
    migrate(db);
    const insights = new InsightsRepo(db);
    expect(insights.get("eth:", 0)).toBeUndefined();
    insights.put("eth:", fixtures.insightEth, 1000);
    expect(insights.get("eth:", 999)).toEqual(fixtures.insightEth);
    expect(InsightResponse.parse(insights.get("eth:", 999))).toEqual(fixtures.insightEth);
    expect(insights.get("eth:", 1000)).toBeUndefined();
    expect(insights.get("eth:", 1001)).toBeUndefined();
    db.close();
  });
  it("put on an existing key replaces the entry (upsert)", () => {
    const db = openDb(":memory:");
    migrate(db);
    const insights = new InsightsRepo(db);
    insights.put("eth:", fixtures.insightEth, 1000);
    insights.put("eth:", { ...fixtures.insightEth, tip: "newer" }, 2000);
    expect(insights.get("eth:", 1500)?.tip).toBe("newer");
    db.close();
  });
});

describe("B01-27-purge purgeExpired", () => {
  it("deletes only rows whose expiry has passed and reports how many", () => {
    const db = openDb(":memory:");
    migrate(db);
    const insights = new InsightsRepo(db);
    insights.put("a", fixtures.insightEth, 100);
    insights.put("b", fixtures.insightEth, 200);
    insights.put("c", fixtures.insightEth, 300);
    expect(insights.purgeExpired(200)).toBe(2);
    expect(insights.get("c", 250)).toBeDefined();
    expect(db.prepare("SELECT count(*) AS n FROM insights").get()).toEqual({ n: 1 });
    db.close();
  });
});

describe("rows stored before the contract change still parse (new keys default to null)", () => {
  /** The JSON a pre-change backend wrote: none of the new quote or insight keys. */
  function withoutKeys<T extends object>(value: T, keys: string[]): Record<string, unknown> {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
  }

  it("an old quote row gets null for every new quote factor", () => {
    const db = openDb(":memory:");
    migrate(db);
    const factors = [
      "recommendedSlippage",
      "slippage",
      "spendUsd",
      "receiveUsd",
      "minReceive",
      "effectivePriceUsd",
      "marketPriceUsd",
      "limitPriceUsd",
      "orderDeadline",
    ];
    db.prepare(
      `INSERT INTO quotes (quote_id, wallet_address, symbol, order_type, expires_at, response,
        order_typed_data, permit_typed_data, created_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run("q_old", WALLET, "ETH", "market", 1761600060, JSON.stringify(withoutKeys(fixtures.quoteEthMarket, factors)), RAW_ORDER, null, 1761600000);
    const stored = new QuotesRepo(db).get("q_old");
    expect(stored?.response).toMatchObject(Object.fromEntries(factors.map((key) => [key, null])));
    db.close();
  });

  it("an old cached insight gets null spotUsd and asOf", () => {
    const db = openDb(":memory:");
    migrate(db);
    db.prepare("INSERT INTO insights (key, response, expires_at) VALUES (?, ?, ?)").run(
      "eth:",
      JSON.stringify(withoutKeys(fixtures.insightEth, ["spotUsd", "asOf"])),
      1000,
    );
    expect(new InsightsRepo(db).get("eth:", 999)).toMatchObject({ symbol: "ETH", spotUsd: null, asOf: null });
    db.close();
  });
});
