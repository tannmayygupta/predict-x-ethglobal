/** The backend block of .env.example, with the test-only overrides the plan prescribes. */
export const BASELINE_ENV: Record<string, string> = {
  PORT: "8787",
  ALLOWED_ORIGINS: "http://localhost:5173,https://x.com",
  FLASH_API_KEY: "",
  FLASH_BASE_URL: "https://flash.definitive.fi/v1",
  FLASH_MOCK: "true",
  OPENAI_API_KEY: "",
  OPENAI_MODEL: "",
  COINGECKO_API_KEY: "",
  POOL_CHAIN_ID: "84532",
  POOL_ADDRESS: "0x0000000000000000000000000000000000000000",
  POOL_RPC_URL: "https://sepolia.base.org",
  SQLITE_PATH: ":memory:",
  VALIDATE_RESPONSES: "true",
};

export function envWith(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  return { ...BASELINE_ENV, ...overrides };
}
