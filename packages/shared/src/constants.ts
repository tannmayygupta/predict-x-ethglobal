/** Chains. Flash trades on Base MAINNET only; pools live on Base Sepolia. */
export const CHAINS = {
  BASE_MAINNET: { id: 8453, flashName: "base", name: "Base", explorer: "https://basescan.org" },
  BASE_SEPOLIA: { id: 84532, flashName: null, name: "Base Sepolia", explorer: "https://sepolia.basescan.org" },
} as const;

/** Base mainnet assets used by Flash (from Flash's own quote example; confirm in Gate 0). */
export const FLASH_BASE_ASSETS = {
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  WETH: "0x4200000000000000000000000000000000000006",
} as const;

export const USDC_DECIMALS = 6;
export const FEE_BPS_DEFAULT = 200;
export const MIN_POOL_DURATION_SECONDS = 120;
export const DURATION_PRESETS_SECONDS = [180, 3600, 14400, 86400] as const;
export const MAX_QUESTION_LENGTH = 140;
export const MAX_INTENT_LENGTH = 200;
export const MAX_FLASH_TRADE_USD = 5;
export const API_PREFIX = "/api/v1";
export const MAX_CHART_POINTS = 300;
export const MIN_LIMIT_EXPIRY_SECONDS = 60;
export const MAX_LIMIT_EXPIRY_SECONDS = 2592000;
/** Flash uses 2^48-1 as the good-till-cancelled deadline; anything from 2^40 up is treated as "no deadline". */
export const GTC_DEADLINE_THRESHOLD = 2 ** 40;

/**
 * The deployed app on Vercel: the dashboard at "/" and the API under API_PREFIX, one origin. This is the public
 * production alias on purpose. The <project>-<team>.vercel.app alias is behind Vercel Authentication, so a link to it in
 * a post sends every reader to a login page.
 */
/** Appended to every draft post so the project is easy to find on X. */
export const TWEET_HASHTAGS = "#predictx $predictx";

export const DEPLOYED_APP_URL = "https://predictx-tawny.vercel.app";
export const DEPLOYED_API_BASE_URL = `${DEPLOYED_APP_URL}${API_PREFIX}`;
