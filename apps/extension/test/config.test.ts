import { DEPLOYED_API_BASE_URL, DEPLOYED_APP_URL, buildTweetText } from "@predictx/shared";
import { createChainClients, postablePool, type PreparedPool } from "@predictx/ui";
import { afterEach, describe, expect, it, vi } from "vitest";

const LOCAL_API = "http://localhost:8787/api/v1";
const LOCAL_DASHBOARD = "http://localhost:5173";

// config.ts reads import.meta.env once, when it is first imported, so every case loads a fresh copy of the module.
async function loadConfig() {
  vi.resetModules();
  return import("../src/config");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("extension build-time URLs", () => {
  it("default to the deployed app when nothing is set", async () => {
    const config = await loadConfig();
    expect(config.apiBaseUrl).toBe(DEPLOYED_API_BASE_URL);
    expect(config.dashboardUrl).toBe(DEPLOYED_APP_URL);
    // The post step reads this one: it is the origin of the link in the tweet.
    expect(config.chainOptions.dashboardUrl).toBe(DEPLOYED_APP_URL);
  });

  it("ignore the dashboard's VITE_API_BASE_URL and VITE_DASHBOARD_URL, so a developer's localhost .env cannot reach a post", async () => {
    vi.stubEnv("VITE_API_BASE_URL", LOCAL_API);
    vi.stubEnv("VITE_DASHBOARD_URL", LOCAL_DASHBOARD);
    const config = await loadConfig();
    expect(config.apiBaseUrl).toBe(DEPLOYED_API_BASE_URL);
    expect(config.dashboardUrl).toBe(DEPLOYED_APP_URL);
  });

  it("follow VITE_EXTENSION_* for a build against a local stack", async () => {
    vi.stubEnv("VITE_EXTENSION_API_BASE_URL", LOCAL_API);
    vi.stubEnv("VITE_EXTENSION_DASHBOARD_URL", LOCAL_DASHBOARD);
    const config = await loadConfig();
    expect(config.apiBaseUrl).toBe(LOCAL_API);
    expect(config.dashboardUrl).toBe(LOCAL_DASHBOARD);
    expect(config.chainOptions.dashboardUrl).toBe(LOCAL_DASHBOARD);
  });

  it("treat a blank override like an unset one instead of producing an empty URL", async () => {
    vi.stubEnv("VITE_EXTENSION_API_BASE_URL", "  ");
    vi.stubEnv("VITE_EXTENSION_DASHBOARD_URL", "");
    const config = await loadConfig();
    expect(config.apiBaseUrl).toBe(DEPLOYED_API_BASE_URL);
    expect(config.dashboardUrl).toBe(DEPLOYED_APP_URL);
  });
});

describe("the Create -> Post draft", () => {
  it("carries the deployed link for pool 12 even when the dashboard's localhost variables are set", async () => {
    vi.stubEnv("VITE_API_BASE_URL", LOCAL_API);
    vi.stubEnv("VITE_DASHBOARD_URL", LOCAL_DASHBOARD);
    const config = await loadConfig();
    const chain = createChainClients(config.chainOptions);
    const prepared: PreparedPool = {
      question: "Will $ETH be above $2236 at 23:06 UTC on 6 Nov?",
      coingeckoId: "ethereum",
      direction: 0,
      strikeUsd: "2236",
      strikeE18: 2236n * 10n ** 18n,
      resolveTime: 1_794_006_360,
    };
    // The chain read is refused, which exercises the fallback link path; the chain path builds it from the same origin.
    const pool = await postablePool(chain, 12, prepared, { attempts: 1, read: () => Promise.reject(new Error("rpc down")) });
    expect(buildTweetText(pool)).toBe(`Will $ETH be above $2236 at 23:06 UTC on 6 Nov?\n\nBet YES or NO: ${DEPLOYED_APP_URL}/pool/12\nPX#12\n\n#predictx $predictx`);
  });
});
