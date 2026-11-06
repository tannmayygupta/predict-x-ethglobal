/**
 * End-to-end proof on Base Sepolia, no browser: mint, create a 3-minute pool, bet from two wallets, wait for the
 * resolver loop to settle it through Chainlink CRE, then claim or refund, and check every number three ways:
 * the contract, the backend API and shared computePayout.
 *
 * Every wallet action goes through @predictx/ui, the same functions the extension and the dashboard call, so a
 * pass here means the screens' write path works. Needs the backend running (pnpm --filter @predictx/backend start)
 * and the resolver running (scripts/resolver-loop.ts). Run from apps/backend:
 *   pnpm exec tsx --tsconfig ../../scripts/tsconfig.json ../../scripts/e2e-lifecycle.ts --scenario yes|no|void
 *
 * Keys: TEST_WALLET_A_PRIVATE_KEY (creator, YES bettor) and TEST_WALLET_B_PRIVATE_KEY (NO bettor) in the repo .env.
 * Scenarios: yes = YES wins, no = NO wins, void = only YES bet so the pool is refunded. Test funds only.
 */
import { computePayout, formatUsdc, fromE18, toStrikeE18, toUsdcUnits } from "@predictx/shared";
import {
  accountAddress, chainNow, claim, createApiClient, createChainClients, createPool, createPoolWalletClient, mintTestUsdc,
  prepareCreate, readRawPool, readUsdcBalance, refund, stake, type ChainClients, type Session, type UiErrorCode,
} from "@predictx/ui/core";
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadRepoEnv, readKey, say, sleep } from "./common";

const SCENARIOS = ["yes", "no", "void"] as const;
type Scenario = (typeof SCENARIOS)[number];

const DURATION_SECONDS = 180; // the 3-minute preset
const MIN_GAS_WEI = 2_000_000_000_000_000n; // 0.002 ETH covers ~8 transactions on Base Sepolia
const RESOLVE_TIMEOUT_MS = 10 * 60_000;
const API_SETTLE_TIMEOUT_MS = 40_000; // the backend caches pool reads for 10 s
const POLL_MS = 10_000;
const PRICE_TOLERANCE_PERCENT = 10n;
const CENT_E18 = 10n ** 16n;

const api = createApiClient(process.env.E2E_API_BASE ?? "http://localhost:8787/api/v1");

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`);
  say(`ok: ${message}`);
}

/** The action must fail with this exact code (not just "some error"). */
async function expectFailure(run: () => Promise<unknown>, code: UiErrorCode, what: string): Promise<void> {
  try {
    await run();
  } catch (err) {
    const got = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "unknown";
    if (got !== code) throw new Error(`CHECK FAILED: ${what} failed with ${got}, expected ${code}`);
    say(`ok: ${what} is refused with ${code}`);
    return;
  }
  throw new Error(`CHECK FAILED: ${what} should have been refused`);
}

/** Retries until the backend (10 s cache) agrees, then returns the matching value. */
async function untilApi<T>(read: () => Promise<T>, done: (v: T) => boolean, what: string): Promise<T> {
  const deadline = Date.now() + API_SETTLE_TIMEOUT_MS;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`CHECK FAILED: backend never showed ${what}`);
    await sleep(3_000);
  }
}

function makeSession(chain: ChainClients, keyName: string): Session {
  return { chain, wallet: createPoolWalletClient(http(chain.rpcUrl)), account: privateKeyToAccount(readKey(keyName)) };
}

/** A strike far from spot so the outcome is certain: half the price for YES (above), double for NO. */
function strikeFor(scenario: Scenario, priceE18: bigint): string {
  const raw = scenario === "no" ? priceE18 * 2n : priceE18 / 2n;
  return fromE18((raw / CENT_E18) * CENT_E18);
}

async function main(): Promise<void> {
  loadRepoEnv();
  const flag = process.argv.indexOf("--scenario");
  const scenario = (flag >= 0 ? process.argv[flag + 1] : "yes") as Scenario;
  if (!SCENARIOS.includes(scenario)) throw new Error(`--scenario must be one of ${SCENARIOS.join(", ")}`);

  const chain = createChainClients(process.env.POOL_RPC_URL ? { rpcUrl: process.env.POOL_RPC_URL } : {});
  const a = makeSession(chain, "TEST_WALLET_A_PRIVATE_KEY");
  const b = makeSession(chain, "TEST_WALLET_B_PRIVATE_KEY");
  for (const [name, s] of [["A", a], ["B", b]] as const) {
    const gas = await chain.publicClient.getBalance({ address: accountAddress(s) });
    check(gas >= MIN_GAS_WEI, `wallet ${name} ${accountAddress(s)} has Base Sepolia ETH for gas`);
  }

  const market = await api.market("ETH");
  const strikeUsd = strikeFor(scenario, toStrikeE18(market.priceUsd));
  const yesAmount = scenario === "void" ? "30" : "60";
  const noAmount = scenario === "void" ? "0" : "40";
  say(`scenario ${scenario}: ETH is $${market.priceUsd} (live), strike above $${strikeUsd}`);

  const txs: Record<string, string> = {};
  txs.mintA = await mintTestUsdc(a, yesAmount);
  if (noAmount !== "0") txs.mintB = await mintTestUsdc(b, noAmount);

  const prepared = prepareCreate(
    { symbol: "ETH", coingeckoId: "ethereum", direction: "above", strikeUsd, durationSeconds: DURATION_SECONDS },
    await chainNow(chain),
  );
  const created = await createPool(a, prepared);
  const id = created.poolId;
  txs.createPool = created.hash;
  say(`pool ${id} created: "${prepared.question}"`);

  const yesBet = await stake(a, { poolId: id, isYes: true, amountUsdc: yesAmount });
  txs.stakeYes = yesBet.stakeHash;
  check(yesBet.approvalHash !== null, "the bet approved exactly its own amount first (no unlimited approval)");
  if (noAmount !== "0") txs.stakeNo = (await stake(b, { poolId: id, isYes: false, amountUsdc: noAmount })).stakeHash;

  const open = await untilApi(
    () => api.pool(id),
    (p) => p.yesTotal === toUsdcUnits(yesAmount).toString() && p.noTotal === toUsdcUnits(noAmount).toString(),
    "the bets",
  );
  check(open.question === prepared.question, "backend shows the exact question stored onchain");
  check(open.status === "open", "backend reports status open before the close");

  say(`waiting for the resolver (resolveTime ${prepared.resolveTime}, then Chainlink CRE settles it)...`);
  const giveUp = Date.now() + RESOLVE_TIMEOUT_MS;
  while (!(await readRawPool(chain, BigInt(id))).resolved) {
    if (Date.now() > giveUp) throw new Error("Pool was not resolved in time. Is scripts/resolver-loop.ts running and `cre` logged in?");
    await sleep(POLL_MS);
  }

  await settle(chain, scenario, id, a, b, { yesAmount, noAmount, priceE18: toStrikeE18(market.priceUsd) }, txs);
  say(`DONE scenario ${scenario}, pool ${id}. Transactions: ${JSON.stringify(txs)}`);
}

interface Bets {
  yesAmount: string;
  noAmount: string;
  priceE18: bigint;
}

async function settle(chain: ChainClients, scenario: Scenario, id: number, a: Session, b: Session, bets: Bets, txs: Record<string, string>): Promise<void> {
  const onchain = await readRawPool(chain, BigInt(id));
  check(onchain.resolvedPriceE18 > 0n, `Chainlink reported a price: ${fromE18(onchain.resolvedPriceE18)}`);
  const drift = ((onchain.resolvedPriceE18 - bets.priceE18) * 100n) / bets.priceE18;
  check(drift < PRICE_TOLERANCE_PERCENT && drift > -PRICE_TOLERANCE_PERCENT, "reported price is within 10% of the live API price (a real price)");

  const wantStatus = scenario === "void" ? "void" : "resolved";
  const resolved = await untilApi(() => api.pool(id), (p) => p.status === wantStatus, `status ${wantStatus}`);
  if (scenario !== "void") check(resolved.outcome === scenario, `backend outcome is ${scenario}`);

  const poolBefore = await readUsdcBalance(chain, chain.poolAddress);
  if (scenario === "void") {
    const stakeUnits = toUsdcUnits(bets.yesAmount);
    const holder = accountAddress(a);
    const pos = await untilApi(() => api.position(id, holder), (p) => p.refundable !== "0", "the refund");
    check(pos.refundable === stakeUnits.toString(), "backend refundable equals the full stake");
    const before = await readUsdcBalance(chain, holder);
    txs.refund = await refund(a, id);
    check((await readUsdcBalance(chain, holder)) - before === stakeUnits, "refund returned the full stake with no fee");
    await expectFailure(() => refund(a, id), "ALREADY_CLAIMED", "a second refund");
    return;
  }

  const [winner, loser] = scenario === "yes" ? [a, b] : [b, a];
  const winTotal = toUsdcUnits(scenario === "yes" ? bets.yesAmount : bets.noAmount);
  const loseTotal = toUsdcUnits(scenario === "yes" ? bets.noAmount : bets.yesAmount);
  const expected = computePayout(winTotal, winTotal, loseTotal, onchain.feeBps);
  say(`expected winner payout ${formatUsdc(expected)} USDC (pool ${formatUsdc(winTotal + loseTotal)}, fee ${onchain.feeBps} bps)`);

  const winnerAddress = accountAddress(winner);
  const pos = await untilApi(() => api.position(id, winnerAddress), (p) => p.claimable !== "0", "the claimable amount");
  check(pos.claimable === expected.toString(), "backend claimable equals computePayout");
  check((await api.position(id, accountAddress(loser))).claimable === "0", "backend shows the loser nothing to claim");

  const before = await readUsdcBalance(chain, winnerAddress);
  txs.claim = await claim(winner, id);
  check((await readUsdcBalance(chain, winnerAddress)) - before === expected, "winner's USDC balance rose by exactly computePayout");
  check(poolBefore - (await readUsdcBalance(chain, chain.poolAddress)) >= expected, "the pool contract paid it out");
  await expectFailure(() => claim(winner, id), "ALREADY_CLAIMED", "a double claim");
  await expectFailure(() => claim(loser, id), "NOTHING_TO_CLAIM", "the loser's claim");
}

main().catch((err: unknown) => {
  process.stderr.write(`e2e failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
