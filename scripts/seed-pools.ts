/**
 * T-B09: seed demo pools on Base Sepolia with stakes from two wallets.
 *
 * Run from apps/backend (pnpm resolves viem there):
 *   pnpm exec tsx --tsconfig ../../scripts/tsconfig.json ../../scripts/seed-pools.ts
 *
 * Reads DEPLOYER_PRIVATE_KEY and SEED_WALLET_2_PRIVATE_KEY from the repo .env (test funds only).
 * Only the CRE forwarder can resolve a pool, so this script creates two short pools that turn
 * "awaiting" after three minutes (CRE later resolves one) and one pool that stays open for four hours.
 * Keys and signatures are never printed.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DURATION_PRESETS_SECONDS,
  buildQuestion,
  deployments,
  fromE18,
  mockUsdcAbi,
  predictionPoolAbi,
  toStrikeE18,
  toUsdcUnits,
} from "@predictx/shared";
import { createPublicClient, createWalletClient, http, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const ENV_FILE = fileURLToPath(new URL("../.env", import.meta.url));
// Small buffer so resolveTime still clears the contract's now + 120 s rule when the tx lands a block later.
const CREATE_BUFFER_SECONDS = 30;
const [THREE_MINUTES, , FOUR_HOURS] = DURATION_PRESETS_SECONDS;

interface SeedPool {
  symbol: string;
  coingeckoId: string;
  direction: "above" | "below";
  strike: string;
  durationSeconds: number;
  yesUsdc: string; // staked by wallet 1
  noUsdc: string; // staked by wallet 2
}

const POOLS: SeedPool[] = [
  { symbol: "ETH", coingeckoId: "ethereum", direction: "above", strike: "3000", durationSeconds: THREE_MINUTES, yesUsdc: "60", noUsdc: "40" },
  { symbol: "BTC", coingeckoId: "bitcoin", direction: "below", strike: "100000", durationSeconds: THREE_MINUTES, yesUsdc: "25", noUsdc: "25" },
  { symbol: "PEPE", coingeckoId: "pepe", direction: "above", strike: "0.00001", durationSeconds: FOUR_HOURS, yesUsdc: "10", noUsdc: "15" },
];

function readKey(name: string): Hex {
  const raw = (process.env[name] ?? "").trim();
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(raw)) throw new Error(`${name} is missing or not a 32-byte hex key`);
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

async function main(): Promise<void> {
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
  const rpcUrl = process.env.POOL_RPC_URL ?? baseSepolia.rpcUrls.default.http[0];
  const deployment = deployments[baseSepolia.id];
  const pool = deployment.predictionPool;
  const usdc = deployment.mockUsdc;
  if (!pool || !usdc) throw new Error("packages/shared/src/deployments.ts has no Base Sepolia addresses");

  const wallets = [privateKeyToAccount(readKey("DEPLOYER_PRIVATE_KEY")), privateKeyToAccount(readKey("SEED_WALLET_2_PRIVATE_KEY"))] as const;
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  const send = async (accountIndex: 0 | 1, request: Parameters<ReturnType<typeof createWalletClient>["writeContract"]>[0]) => {
    const client = createWalletClient({ account: wallets[accountIndex], chain: baseSepolia, transport: http(rpcUrl) });
    const hash = await client.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
    return receipt;
  };

  // Mint and approve exactly what each wallet stakes (RULES 2.6: no unlimited approvals).
  const totals = [POOLS.reduce((s, p) => s + toUsdcUnits(p.yesUsdc), 0n), POOLS.reduce((s, p) => s + toUsdcUnits(p.noUsdc), 0n)] as const;
  for (const i of [0, 1] as const) {
    const address = wallets[i].address;
    await send(i, { address: usdc, abi: mockUsdcAbi, functionName: "mint", args: [address, totals[i]], account: wallets[i], chain: baseSepolia });
    await send(i, { address: usdc, abi: mockUsdcAbi, functionName: "approve", args: [pool, totals[i]], account: wallets[i], chain: baseSepolia });
    process.stdout.write(`wallet ${i + 1} ${address}: minted and approved ${fromE18(totals[i] * 10n ** 12n)} USDC\n`);
  }

  for (const seed of POOLS) {
    const block = await publicClient.getBlock({ blockTag: "latest" });
    const resolveTime = Number(block.timestamp) + seed.durationSeconds + CREATE_BUFFER_SECONDS;
    const strikeUsd = fromE18(toStrikeE18(seed.strike)); // canonical form, so the stored question matches the API
    const question = buildQuestion({ symbol: seed.symbol, direction: seed.direction, strikeUsd, resolveTime });
    const receipt = await send(0, {
      address: pool,
      abi: predictionPoolAbi,
      functionName: "createPool",
      args: [question, seed.coingeckoId, seed.direction === "above" ? 0 : 1, toStrikeE18(strikeUsd), BigInt(resolveTime)],
      account: wallets[0],
      chain: baseSepolia,
    });
    const created = parseEventLogs({ abi: predictionPoolAbi, eventName: "PoolCreated", logs: receipt.logs })[0];
    if (!created) throw new Error("PoolCreated event missing");
    const id = created.args.id;
    await send(0, { address: pool, abi: predictionPoolAbi, functionName: "stake", args: [id, true, toUsdcUnits(seed.yesUsdc)], account: wallets[0], chain: baseSepolia });
    await send(1, { address: pool, abi: predictionPoolAbi, functionName: "stake", args: [id, false, toUsdcUnits(seed.noUsdc)], account: wallets[1], chain: baseSepolia });
    process.stdout.write(`pool ${id}: "${question}" resolveTime ${resolveTime} YES ${seed.yesUsdc} / NO ${seed.noUsdc}\n`);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`seed failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
