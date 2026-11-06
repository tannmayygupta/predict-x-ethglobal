/**
 * Gate 0 (T-003, TEST_PLAN B04-31): one real Definitive Flash limit order of at most MAX_FLASH_TRADE_USD,
 * priced 30% below spot so it rests `open`, through the same HttpFlashClient the backend uses.
 *
 * Run from apps/backend so the backend's node_modules resolve (scripts/tsconfig.json maps viem, zod and
 * @predictx/shared there):
 *
 *   cd apps/backend && pnpm exec tsx --tsconfig ../../scripts/tsconfig.json ../../scripts/gate0-flash.ts
 *
 * Typecheck: cd apps/backend && pnpm exec tsc -p ../../scripts/tsconfig.json
 *
 * Environment (the repo .env is loaded; variables already in the environment win):
 *   FLASH_API_KEY      required  Definitive Flash key (dpka_...)
 *   GATE0_PRIVATE_KEY  required  0x-hex private key of a Base mainnet wallet holding USDC and ETH for gas
 *   GATE0_AMOUNT_USDC  optional  USDC to spend, default "1.00"; refused above MAX_FLASH_TRADE_USD (RULES 2.8)
 *   GATE0_RPC_URL      optional  Base mainnet RPC for the approve tx, default https://mainnet.base.org
 *   FLASH_BASE_URL     optional  default https://flash.definitive.fi/v1
 *
 * Output: docs/GATE0.md (every raw request and response body, redacted) and docs/gate0/*.json (the same
 * bodies named like test/fixtures/flash). The key, the private key and signatures are never printed or
 * written (RULES 2.1). POST /order is never retried: Flash can create an order and still answer 4xx
 * (docs/notes/flash-api.md 4.3), so a failed submit is reconciled by a human, not by this script.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MAX_FLASH_TRADE_USD, fromE18, toStrikeE18, toUsdcUnits, type FlashQuoteResponse } from "@predictx/shared";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseAbi,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { base } from "viem/chains";
import { z } from "zod";
import { HttpFlashClient } from "../apps/backend/src/clients/flash.http";
import { FlashError } from "../apps/backend/src/clients/flash.types";
import { requireToken } from "../apps/backend/src/services/tokens";
import { systemClock } from "../apps/backend/src/util/clock";
import { recordingFetch, writeReport, type Recorded } from "./gate0-report";

const DEFAULT_AMOUNT_USDC = "1.00";
const DEFAULT_FLASH_BASE_URL = "https://flash.definitive.fi/v1";
const DEFAULT_RPC_URL = "https://mainnet.base.org";
const SYMBOL = "ETH";
/** 30% below spot: far enough that the order rests open through the polls, close enough to be a real price. */
const LIMIT_DISCOUNT_PERCENT = 70n;
const PERCENT = 100n;
const E18 = 10n ** 18n;
/** Limit prices are quoted to the cent. */
const CENT_E18 = 10n ** 16n;
const POLLS = 5;
const POLL_INTERVAL_MS = 3_000;
/** approve(address,uint256) calldata: 4-byte selector, then two 32-byte words; the spender is the first word. */
const SELECTOR_HEX = "0x095ea7b3".length;
const WORD_HEX = 64;
const ADDRESS_HEX = 40;

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** Narrows a regex-validated string to viem's Hex template type without a cast. */
function isHex(value: string): value is Hex {
  return value.startsWith("0x");
}

const Env = z.object({
  GATE0_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "GATE0_PRIVATE_KEY must be 0x + 64 hex").refine(isHex),
  FLASH_API_KEY: z.string().min(1, "FLASH_API_KEY is required"),
  FLASH_BASE_URL: z.string().url().default(DEFAULT_FLASH_BASE_URL),
  GATE0_RPC_URL: z.string().url().default(DEFAULT_RPC_URL),
});

const TypedDataJson = z.object({
  types: z.record(z.array(z.object({ name: z.string(), type: z.string() }))),
  primaryType: z.string(),
  domain: z.object({
    name: z.string(),
    version: z.string(),
    chainId: z.union([z.string(), z.number()]),
    verifyingContract: z.string(),
  }),
  message: z.record(z.unknown()),
});

const ERC20 = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** RULES 2.8 guard, checked before any key is read so a bad amount never gets near the network. */
function assertAmountAllowed(amount: string): bigint {
  const units = toUsdcUnits(amount);
  const max = toUsdcUnits(String(MAX_FLASH_TRADE_USD));
  if (units === 0n) throw new Error(`GATE0_AMOUNT_USDC must be greater than 0, got ${amount}`);
  if (units > max) {
    throw new Error(`refusing to run: GATE0_AMOUNT_USDC=${amount} exceeds MAX_FLASH_TRADE_USD=${MAX_FLASH_TRADE_USD}`);
  }
  return units;
}

/** Flash's implied spot (USDC spent per ETH received) from a market quote, as an 18-decimal integer. */
function impliedSpotE18(market: FlashQuoteResponse): bigint {
  return (toStrikeE18(market.spend.amount) * E18) / toStrikeE18(market.receive.amount);
}

/** 30% below spot, rounded down to the cent. */
function limitPriceBelowSpot(spotE18: bigint): string {
  const limitE18 = (spotE18 * LIMIT_DISCOUNT_PERCENT) / PERCENT;
  return fromE18((limitE18 / CENT_E18) * CENT_E18);
}

/** The official client strips EIP712Domain from `types` and makes chainId a number before signing (notes 3.3). */
async function signTypedDataString(account: PrivateKeyAccount, json: string): Promise<Hex> {
  const parsed = TypedDataJson.parse(JSON.parse(json));
  const kept = Object.entries(parsed.types).filter(([name]) => name !== "EIP712Domain");
  // viem accepts `types` as a plain record; it validates the struct names at signing time.
  const types: Record<string, unknown> = Object.fromEntries(kept);
  return account.signTypedData({
    domain: {
      name: parsed.domain.name,
      version: parsed.domain.version,
      chainId: Number(parsed.domain.chainId),
      verifyingContract: getAddress(parsed.domain.verifyingContract),
    },
    types,
    primaryType: parsed.primaryType,
    message: parsed.message,
  });
}

/** RULES 2.6: an exact-amount approve to the spender Flash named, instead of the unlimited one it proposes. */
async function ensureAllowance(
  quote: FlashQuoteResponse,
  units: bigint,
  account: PrivateKeyAccount,
  rpcUrl: string,
): Promise<{ spender: string; txHash: Hex | null }> {
  const approveTx = quote.steps.approveTx;
  if (approveTx === null) return { spender: "(none: allowance already sufficient)", txHash: null };
  const wordStart = SELECTOR_HEX + WORD_HEX - ADDRESS_HEX;
  const spender = getAddress(`0x${approveTx.data.slice(wordStart, SELECTOR_HEX + WORD_HEX)}`);
  const token = getAddress(approveTx.to);
  const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
  const allowance = await publicClient.readContract({
    address: token,
    abi: ERC20,
    functionName: "allowance",
    args: [account.address, spender],
  });
  if (allowance >= units) return { spender, txHash: null };
  const wallet = createWalletClient({ account, chain: base, transport: http(rpcUrl) });
  const txHash = await wallet.writeContract({ address: token, abi: ERC20, functionName: "approve", args: [spender, units] });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { spender, txHash };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const envFile = `${repoRoot}.env`;
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const amount = process.env.GATE0_AMOUNT_USDC ?? DEFAULT_AMOUNT_USDC;
  const units = assertAmountAllowed(amount);
  const parsedEnv = Env.safeParse(process.env);
  if (!parsedEnv.success) {
    throw new Error(parsedEnv.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const env = parsedEnv.data;
  const account = privateKeyToAccount(env.GATE0_PRIVATE_KEY);
  const token = requireToken(SYMBOL);
  const records: Recorded[] = [];
  const client = new HttpFlashClient({
    baseUrl: env.FLASH_BASE_URL,
    apiKey: env.FLASH_API_KEY,
    clock: systemClock,
    fetchImpl: recordingFetch(records, env.FLASH_API_KEY),
  });
  const lines = [`# Gate 0: one real Flash limit order`, "", `Run: ${new Date().toISOString()}, funder ${account.address}, ${amount} USDC -> ${SYMBOL} on Base.`, ""];
  const walletAddress = account.address;
  try {
    say(`quoting market spot for ${amount} USDC`);
    const market = await client.quote({
      request: { walletAddress, symbol: SYMBOL, side: "buy", orderType: "market", amount, slippage: "0.01" },
      token,
    });
    const spotE18 = impliedSpotE18(market);
    const limitPriceUsd = limitPriceBelowSpot(spotE18);
    lines.push(`- Market quote implies spot ${fromE18(spotE18)} USD; limit set to ${limitPriceUsd} USD (${PERCENT - LIMIT_DISCOUNT_PERCENT}% below).`);
    say(`requesting limit quote at ${limitPriceUsd} USD`);
    const quote = await client.quote({
      request: { walletAddress, symbol: SYMBOL, side: "buy", orderType: "limit", amount, limitPriceUsd, slippage: "0.01" },
      token,
    });
    const deadline = TypedDataJson.parse(JSON.parse(quote.steps.orderTypedData)).message.deadline;
    const lifetime = typeof deadline === "string" ? `${Number(deadline) - systemClock.now()} s` : "unknown";
    lines.push(`- Quote ${quote.quoteId}: receive ${quote.receive.amount} ${SYMBOL}, fees ${quote.feesUsd} USD, our expiresAt ${quote.expiresAt}, typed-data deadline ${String(deadline)} (lifetime ${lifetime} at quote time).`);
    lines.push(`- Permit typed data present: ${quote.steps.permitTypedData !== null}. approveTx present: ${quote.steps.approveTx !== null}.`);
    const approval = await ensureAllowance(quote, units, account, env.GATE0_RPC_URL);
    lines.push(`- Approve spender ${approval.spender}; exact-amount approve tx ${approval.txHash ?? "not needed"} (RULES 2.6).`);
    const orderSignature = await signTypedDataString(account, quote.steps.orderTypedData);
    const permitSignature = quote.steps.permitTypedData ? await signTypedDataString(account, quote.steps.permitTypedData) : null;
    say("submitting the signed order (never retried)");
    const submitted = await client.submit({
      quote,
      rawTypedData: { orderTypedData: quote.steps.orderTypedData, permitTypedData: quote.steps.permitTypedData },
      order: { quoteId: quote.quoteId, walletAddress, orderSignature, permitSignature },
    });
    lines.push(`- Order ${submitted.orderId} accepted with HTTP ${records.at(-1)?.status ?? "?"}.`);
    const seen: string[] = [];
    for (let poll = 0; poll < POLLS; poll += 1) {
      if (poll > 0) await sleep(POLL_INTERVAL_MS);
      try {
        const detail = await client.status({ orderId: submitted.orderId, orderType: "limit", funderAddress: walletAddress });
        seen.push(`${detail.status}${detail.txHash ? ` tx ${detail.txHash}` : ""}${detail.error ? ` (${detail.error})` : ""}`);
      } catch (err) {
        if (!(err instanceof FlashError)) throw err;
        seen.push(`error: ${err.message}`);
      }
      say(`poll ${poll + 1}/${POLLS}: ${seen.at(-1) ?? ""}`);
    }
    lines.push(`- Mapped statuses over ${POLLS} polls: ${seen.join(" -> ")}.`);
    lines.push(`- Addresses: target ${token.address ?? "?"} (${SYMBOL}), contra ${quote.spend.symbol}, chain ${quote.chain} (${quote.chainId}).`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lines.push(`- FAILED: ${message}. If POST /order was reached, check GET /orders?funderAddress=${walletAddress} before any resubmit.`);
    process.exitCode = 1;
  } finally {
    say(writeReport(lines, records));
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
