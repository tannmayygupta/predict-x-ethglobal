import { DEPLOYED_APP_URL } from "@predictx/shared";
import { describe, expect, it } from "vitest";
import { createChainClients } from "../src/chain";
import type { PreparedPool } from "../src/create";
import { postablePool } from "../src/created";

const prepared: PreparedPool = {
  question: "Will $ETH be above $2236 at 23:06 UTC on 6 Nov?",
  coingeckoId: "ethereum",
  direction: 0,
  strikeUsd: "2236",
  strikeE18: 2236n * 10n ** 18n,
  resolveTime: 1_794_006_360,
};

describe("createChainClients dashboardUrl", () => {
  it("defaults to the deployed app, never to a local address", () => {
    expect(createChainClients().dashboardUrl).toBe(DEPLOYED_APP_URL);
  });

  it("uses the configured origin when there is one", () => {
    expect(createChainClients({ dashboardUrl: "https://dashboard.example.test" }).dashboardUrl).toBe("https://dashboard.example.test");
  });

  it("puts the default origin in the post link when the chain will not answer", async () => {
    const pool = await postablePool(createChainClients(), 12, prepared, { attempts: 1, read: () => Promise.reject(new Error("rpc down")) });
    expect(pool.dashboardUrl).toBe(`${DEPLOYED_APP_URL}/pool/12`);
  });
});
