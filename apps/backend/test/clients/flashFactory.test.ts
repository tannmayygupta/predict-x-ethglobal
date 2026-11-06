import { Token, type FlashQuoteRequest } from "@predictx/shared";
import { describe, expect, it, vi } from "vitest";
import tokensJson from "../../../../packages/shared/tokens.json";
import { createFlashClient } from "../../src/clients/flash.factory";
import { HttpFlashClient } from "../../src/clients/flash.http";
import { MockFlashClient } from "../../src/clients/flash.mock";
import { loadConfig } from "../../src/config";
import quoteOk from "../fixtures/flash/quote.ok.json";
import { BASELINE_ENV, envWith } from "../helpers/env";
import { FakeClock } from "../helpers/fakes/clock";

const ETH = Token.parse(tokensJson.tokens.find((t) => t.symbol === "ETH"));
const marketReq: FlashQuoteRequest = {
  walletAddress: "0x1111111111111111111111111111111111111111",
  symbol: "ETH",
  side: "buy",
  orderType: "market",
  amount: "2.00",
  slippage: "0.01",
};
const REAL_ENV = envWith({ FLASH_MOCK: "false", FLASH_API_KEY: "dpka_factory_test", FLASH_BASE_URL: "https://flash.test/v1" });

describe("B03-22 createFlashClient", () => {
  it("returns MockFlashClient when config.flashMock is true", () => {
    expect(createFlashClient(loadConfig(BASELINE_ENV), { clock: new FakeClock() })).toBeInstanceOf(MockFlashClient);
  });

  it("returns HttpFlashClient when config.flashMock is false", () => {
    expect(createFlashClient(loadConfig(REAL_ENV), { clock: new FakeClock() })).toBeInstanceOf(HttpFlashClient);
  });

  it("switches on config only, never on process.env", () => {
    vi.stubEnv("FLASH_MOCK", "false");
    vi.stubEnv("FLASH_API_KEY", "dpka_from_env");
    expect(createFlashClient(loadConfig(BASELINE_ENV), { clock: new FakeClock() })).toBeInstanceOf(MockFlashClient);
    vi.stubEnv("FLASH_MOCK", "true");
    expect(createFlashClient(loadConfig(REAL_ENV), { clock: new FakeClock() })).toBeInstanceOf(HttpFlashClient);
  });

  it("hands the mock the injected clock so expiry follows the app clock", async () => {
    const clock = new FakeClock();
    clock.set(100);
    const quote = await createFlashClient(loadConfig(BASELINE_ENV), { clock }).quote({ request: marketReq, token: ETH });
    expect(quote.expiresAt).toBe(160);
  });

  it("hands the http client the config base url and key and the injected fetch", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(quoteOk), { status: 200 });
    };
    const client = createFlashClient(loadConfig(REAL_ENV), { clock: new FakeClock(), fetchImpl });
    await client.quote({ request: marketReq, token: ETH });
    expect(calls[0]?.url).toBe("https://flash.test/v1/quote");
    expect(new Headers(calls[0]?.init?.headers).get("x-definitive-api-key")).toBe("dpka_factory_test");
  });

  it("builds with config alone (server.ts passes no deps) without touching the network", () => {
    expect(createFlashClient(loadConfig(BASELINE_ENV))).toBeInstanceOf(MockFlashClient);
    expect(createFlashClient(loadConfig(REAL_ENV))).toBeInstanceOf(HttpFlashClient);
  });
});
