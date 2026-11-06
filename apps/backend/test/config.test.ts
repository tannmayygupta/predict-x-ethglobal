import { API_PREFIX } from "@predictx/shared";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config";
import { describeConfig } from "../src/config.summary";
import { BASELINE_ENV, envWith } from "./helpers/env";

describe("B01-01 loadConfig with .env.example values", () => {
  it("parses into a typed config with apiPrefix /api/v1", () => {
    const config = loadConfig({ ...BASELINE_ENV, SQLITE_PATH: "./predictx.sqlite" });
    expect(config.apiPrefix).toBe(API_PREFIX);
    expect(config.apiPrefix).toBe("/api/v1");
    expect(config.port).toBe(8787);
    expect(config.allowedOrigins).toEqual(["http://localhost:5173", "https://x.com"]);
    expect(config.flashApiKey).toBe("");
    expect(config.flashBaseUrl).toBe("https://flash.definitive.fi/v1");
    expect(config.flashMock).toBe(true);
    expect(config.openaiApiKey).toBe("");
    expect(config.openaiModel).toBe("");
    expect(config.coingeckoApiKey).toBe("");
    expect(config.poolChainId).toBe(84532);
    expect(config.poolAddress).toBe("0x0000000000000000000000000000000000000000");
    expect(config.poolRpcUrl).toBe("https://sepolia.base.org");
    expect(config.sqlitePath).toBe("./predictx.sqlite");
    expect(config.dashboardUrl).toBe("http://localhost:5173");
    expect(config.logLevel).toBe("info");
    expect(config.trustProxy).toBe(false);
    expect(config.validateResponses).toBe(true);
  });
});

describe("B01-02 defaults and booleans", () => {
  it("defaults PORT to 8787 when missing", () => {
    expect(loadConfig(envWith({ PORT: undefined })).port).toBe(8787);
  });
  it("turns FLASH_MOCK strings into booleans", () => {
    expect(loadConfig(envWith({ FLASH_MOCK: "true" })).flashMock).toBe(true);
    expect(loadConfig(envWith({ FLASH_MOCK: "false", FLASH_API_KEY: "dpka_test" })).flashMock).toBe(false);
  });
});

describe("B01-03 ALLOWED_ORIGINS parsing", () => {
  it("splits on comma, trims whitespace and drops empty entries", () => {
    const config = loadConfig(envWith({ ALLOWED_ORIGINS: " https://x.com , http://localhost:5173,, " }));
    expect(config.allowedOrigins).toEqual(["https://x.com", "http://localhost:5173"]);
  });
});

describe("B01-04 FLASH_MOCK=false requires a key", () => {
  it("throws a descriptive error at load time", () => {
    expect(() => loadConfig(envWith({ FLASH_MOCK: "false", FLASH_API_KEY: "" }))).toThrow(
      /FLASH_API_KEY.*FLASH_MOCK=false/,
    );
  });
});

describe("B01-05 POOL_ADDRESS must be an address", () => {
  it("throws when not 0x + 40 hex", () => {
    expect(() => loadConfig(envWith({ POOL_ADDRESS: "0x1234" }))).toThrow(/POOL_ADDRESS/);
    expect(() => loadConfig(envWith({ POOL_ADDRESS: "not-an-address" }))).toThrow(/POOL_ADDRESS/);
  });
});

describe("B01-02b PORT=0 means an ephemeral port (B10-01 smoke test)", () => {
  it("accepts 0 and rejects negatives and non-integers", () => {
    expect(loadConfig(envWith({ PORT: "0" })).port).toBe(0);
    expect(() => loadConfig(envWith({ PORT: "-1" }))).toThrow(/PORT/);
    expect(() => loadConfig(envWith({ PORT: "80.5" }))).toThrow(/PORT/);
  });
});

describe("B10-03 describeConfig for the boot log", () => {
  const SECRET_FLASH = "dpka_boot_secret_value";
  const SECRET_OPENAI = "sk-boot-secret-value";
  const RPC_WITH_KEY = "https://base-sepolia.g.alchemy.com/v2/rpc-secret-key";

  it("shows secrets as [set] or [empty] and the RPC url as its origin only", () => {
    const config = loadConfig(
      envWith({ FLASH_API_KEY: SECRET_FLASH, OPENAI_API_KEY: SECRET_OPENAI, COINGECKO_API_KEY: "", POOL_RPC_URL: RPC_WITH_KEY }),
    );
    const summary = describeConfig(config);
    expect(summary.flashApiKey).toBe("[set]");
    expect(summary.openaiApiKey).toBe("[set]");
    expect(summary.coingeckoApiKey).toBe("[empty]");
    expect(summary.poolRpcUrl).toBe("https://base-sepolia.g.alchemy.com");
    expect(JSON.stringify(summary)).not.toContain(SECRET_FLASH);
    expect(JSON.stringify(summary)).not.toContain(SECRET_OPENAI);
    expect(JSON.stringify(summary)).not.toContain("rpc-secret-key");
  });

  it("keeps every non-secret field verbatim so an operator can confirm the deployment", () => {
    const config = loadConfig(envWith({ FLASH_API_KEY: SECRET_FLASH }));
    const { flashApiKey, openaiApiKey, coingeckoApiKey, poolRpcUrl, ...rest } = config;
    expect(describeConfig(config)).toEqual({
      ...rest,
      flashApiKey: "[set]",
      openaiApiKey: "[empty]",
      coingeckoApiKey: "[empty]",
      poolRpcUrl: new URL(poolRpcUrl).origin,
    });
  });
});

describe("B10-09 TRUST_PROXY is a hop count, never blanket trust", () => {
  it("defaults to false and accepts a positive integer hop count", () => {
    expect(loadConfig(envWith({ TRUST_PROXY: undefined })).trustProxy).toBe(false);
    expect(loadConfig(envWith({ TRUST_PROXY: "false" })).trustProxy).toBe(false);
    expect(loadConfig(envWith({ TRUST_PROXY: "1" })).trustProxy).toBe(1);
    expect(loadConfig(envWith({ TRUST_PROXY: "2" })).trustProxy).toBe(2);
  });
  it("rejects true with a ConfigError that asks for a hop count", () => {
    expect(() => loadConfig(envWith({ TRUST_PROXY: "true" }))).toThrow(ConfigError);
    expect(() => loadConfig(envWith({ TRUST_PROXY: "true" }))).toThrow(/TRUST_PROXY.*hop count/);
  });
  it.each(["0", "-1", "1.5", "yes", ""])("rejects %j", (value) => {
    expect(() => loadConfig(envWith({ TRUST_PROXY: value }))).toThrow(/TRUST_PROXY/);
  });
});
