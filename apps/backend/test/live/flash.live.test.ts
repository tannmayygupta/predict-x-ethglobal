import { FlashQuoteResponse } from "@predictx/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createFlashClient } from "../../src/clients/flash.factory";
import { loadConfig } from "../../src/config";
import { buildTestApp } from "../helpers/build";
import { BASELINE_ENV } from "../helpers/env";

/**
 * B04-32: one real read-only quote through the route and HttpFlashClient. Runs only via `pnpm test:live`
 * with FLASH_API_KEY in the repo .env or the environment. A quote moves no funds and places no order;
 * the funder only has to be an address so Flash returns the typed data (notes section 3.1).
 */
const apiKey = process.env.FLASH_API_KEY ?? "";
/** The address Definitive's own docs use in their quote example. */
const DOCS_EXAMPLE_FUNDER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const QUOTE_AMOUNT_USDC = "1.00";

type Built = Awaited<ReturnType<typeof buildTestApp>>;
let built: Built | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

describe.skipIf(!apiKey)("B04-32 live Flash quote for 1 USDC", () => {
  it("POST /flash/quote parses with FlashQuoteResponse and carries signable EIP-712 typed data; no order is placed", async () => {
    const config = loadConfig({ ...BASELINE_ENV, ...process.env, FLASH_MOCK: "false", SQLITE_PATH: ":memory:" });
    const flash = createFlashClient(config);
    built = await buildTestApp({ config, flash });
    const payload = {
      walletAddress: DOCS_EXAMPLE_FUNDER,
      symbol: "ETH",
      side: "buy",
      orderType: "market",
      amount: QUOTE_AMOUNT_USDC,
    };
    const res = await built.app.inject({ method: "POST", url: "/api/v1/flash/quote", payload });
    expect(res.statusCode, res.body).toBe(200);
    const quote = FlashQuoteResponse.parse(res.json());
    expect(quote).toMatchObject({ orderType: "market", side: "buy", chain: "base", chainId: 8453 });
    expect(quote.spend.symbol).toBe("USDC");
    expect(quote.receive.symbol).toBe("ETH");
    expect(quote.expiresAt).toBe(built.clock.now() + 60);
    const typedData: unknown = JSON.parse(quote.steps.orderTypedData);
    expect(typedData).toMatchObject({ primaryType: "FlashOrder", domain: { verifyingContract: expect.any(String) } });
  });
});
