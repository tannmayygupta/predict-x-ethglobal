import { API_PREFIX, Address } from "@predictx/shared";
import { z } from "zod";

const DEFAULT_DASHBOARD_URL = "http://localhost:5173";
const DEFAULT_LOG_LEVEL = "info";
const DEFAULT_PORT = 8787;
const DEFAULT_FLASH_BASE_URL = "https://flash.definitive.fi/v1";

const BooleanString = z.enum(["true", "false"]).transform((v) => v === "true");

const HOP_COUNT_PATTERN = /^[1-9]\d*$/;
/**
 * "false" or a positive hop count. "true" would trust every hop, so request.ip would become the leftmost
 * x-forwarded-for value, which the client writes itself and could rotate to reset its rate limit (B10-09).
 */
const TrustProxy = z
  .string()
  .refine((v) => v !== "true", {
    message: 'TRUST_PROXY=true trusts every hop and lets clients spoof their IP; use a hop count such as "1" (Railway/Render) or "false"',
  })
  .refine((v) => v === "true" || v === "false" || HOP_COUNT_PATTERN.test(v), {
    message: 'TRUST_PROXY must be "false" or a positive integer hop count such as "1"',
  })
  .transform((v): false | number => (v === "false" ? false : Number(v)));

const EnvSchema = z.object({
  PORT: z.coerce.number().int().nonnegative().default(DEFAULT_PORT),
  ALLOWED_ORIGINS: z.string().transform((v) =>
    v
      .split(",")
      .map((o) => o.trim())
      .filter((o) => o.length > 0),
  ),
  FLASH_API_KEY: z.string().default(""),
  FLASH_BASE_URL: z.string().url().default(DEFAULT_FLASH_BASE_URL),
  FLASH_MOCK: BooleanString,
  /** Real Flash orders spend mainnet funds, so submitting them is opt-in; quotes are always allowed. */
  FLASH_ORDERS_ENABLED: BooleanString.default("false"),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_MODEL: z.string().default(""),
  COINGECKO_API_KEY: z.string().default(""),
  POOL_CHAIN_ID: z.coerce.number().int().positive(),
  POOL_ADDRESS: Address,
  POOL_RPC_URL: z.string().url(),
  SQLITE_PATH: z.string(),
  DASHBOARD_URL: z.string().url().default(DEFAULT_DASHBOARD_URL),
  LOG_LEVEL: z.string().default(DEFAULT_LOG_LEVEL),
  TRUST_PROXY: TrustProxy.default("false"),
  VALIDATE_RESPONSES: BooleanString.default("true"),
});

/** Cross-field rules: these must fail at boot, never at the first request (B01-04). */
const EnvRules = EnvSchema.superRefine((e, ctx) => {
  if (!e.FLASH_MOCK && e.FLASH_API_KEY.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["FLASH_API_KEY"],
      message: "FLASH_API_KEY is required when FLASH_MOCK=false",
    });
  }
});

export interface Config {
  port: number;
  apiPrefix: string;
  allowedOrigins: string[];
  flashApiKey: string;
  flashBaseUrl: string;
  flashMock: boolean;
  flashOrdersEnabled: boolean;
  openaiApiKey: string;
  openaiModel: string;
  coingeckoApiKey: string;
  poolChainId: number;
  poolAddress: string;
  poolRpcUrl: string;
  sqlitePath: string;
  dashboardUrl: string;
  logLevel: string;
  /** false, or how many proxies in front of the app may append to x-forwarded-for. */
  trustProxy: false | number;
  validateResponses: boolean;
}

export type EnvSource = NodeJS.ProcessEnv | Record<string, string | undefined>;

/** A misconfigured environment: the message alone tells the operator what to fix, no stack needed (B10-02). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Parses process.env (or any env-shaped record) into a typed Config. Throws with every problem listed. */
export function loadConfig(env: EnvSource): Config {
  const result = EnvRules.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ConfigError(`Invalid backend config: ${problems}`);
  }
  const e = result.data;
  return {
    port: e.PORT,
    apiPrefix: API_PREFIX,
    allowedOrigins: e.ALLOWED_ORIGINS,
    flashApiKey: e.FLASH_API_KEY,
    flashBaseUrl: e.FLASH_BASE_URL,
    flashMock: e.FLASH_MOCK,
    flashOrdersEnabled: e.FLASH_ORDERS_ENABLED,
    openaiApiKey: e.OPENAI_API_KEY,
    openaiModel: e.OPENAI_MODEL,
    coingeckoApiKey: e.COINGECKO_API_KEY,
    poolChainId: e.POOL_CHAIN_ID,
    poolAddress: e.POOL_ADDRESS,
    poolRpcUrl: e.POOL_RPC_URL,
    sqlitePath: e.SQLITE_PATH,
    dashboardUrl: e.DASHBOARD_URL,
    logLevel: e.LOG_LEVEL,
    trustProxy: e.TRUST_PROXY,
    validateResponses: e.VALIDATE_RESPONSES,
  };
}
