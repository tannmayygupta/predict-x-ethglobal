/**
 * End-to-end proof on Base Sepolia, no UI: mint, create a 3-minute pool, stake from two wallets, wait for the
 * resolver loop to settle it through Chainlink CRE, then claim or refund and check every number three ways:
 * the contract, the backend API, and shared computePayout.
 *
 * Needs the backend running (pnpm --filter @predictx/backend start) and the resolver running
 * (scripts/resolver-loop.ts). Run from apps/backend:
 *   pnpm exec tsx --tsconfig ../../scripts/tsconfig.json ../../scripts/e2e-lifecycle.ts --scenario yes|no|void
 *
 * Keys: TEST_WALLET_A_PRIVATE_KEY (creator, YES staker) and TEST_WALLET_B_PRIVATE_KEY (NO staker) in the repo .env.
 * Scenarios: yes = YES wins, no = NO wins, void = only YES staked so the pool is refunded. Test funds only.
 */
import { Market, Pool, Position, buildQuestion, computePayout, formatUsdc, fromE18, toStrikeE18, toUsdcUnits } from "@predictx/shared";
import type { z } from "zod";
import {
  approveExact, claim, createPool, loadRepoEnv, makeWallet, mint, poolContext, readPool, refund, say, sleep, stake, usdcBalance,
  type PoolContext, type Sent, type Wallet,
} from "./common";

const SCENARIOS = ["yes", "no", "void"] as const;
type Scenario = (typeof SCENARIOS)[number];

const DURATION_SECONDS = 180; // the 3-minute preset
const CREATE_BUFFER_SECONDS = 30; // keeps resolveTime past the contract's now + 120 s rule when the tx lands
const MIN_GAS_WEI = 2_000_000_000_000_000n; // 0.002 ETH is plenty for ~8 transactions on Base Sepolia
const RESOLVE_TIMEOUT_MS = 10 * 60_000;
const API_SETTLE_TIMEOUT_MS = 40_000; // the backend caches pool reads for 10 s
const POLL_MS = 10_000;
const PRICE_TOLERANCE_PERCENT = 10n;
const CENT_E18 = 10n ** 16n;

const apiBase = process.env.E2E_API_BASE ?? "http://localhost:8787/api/v1";

async function api<T extends z.ZodTypeAny>(path: string, schema: T): Promise<z.infer<T>> {
  const res = await fetch(`${apiBase}${path}`);
  if (!res.ok) throw new Error(`GET ${path} answered ${res.status}: ${await res.text()}`);
  return schema.parse(await res.json());
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`);
  say(`ok: ${message}`);
}

async function expectRevert(run: () => Promise<unknown>, what: string): Promise<void> {
  try {
    await run();
  } catch {
    say(`ok: ${what} reverts as required`);
    return;
  }
  throw new Error(`CHECK FAILED: ${what} should have reverted`);
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

  const ctx = poolContext();
  const a = makeWallet(ctx, "TEST_WALLET_A_PRIVATE_KEY");
  const b = makeWallet(ctx, "TEST_WALLET_B_PRIVATE_KEY");
  for (const [name, w] of [["A", a], ["B", b]] as const) {
    const gas = await ctx.publicClient.getBalance({ address: w.account.address });
    check(gas >= MIN_GAS_WEI, `wallet ${name} ${w.account.address} has Base Sepolia ETH for gas`);
  }

  const market = await api("/market/ETH", Market);
  const priceE18 = toStrikeE18(market.priceUsd);
  const strikeUsd = strikeFor(scenario, priceE18);
  const yesStake = scenario === "void" ? "30" : "60";
  const noStake = scenario === "void" ? "0" : "40";
  say(`scenario ${scenario}: ETH is $${market.priceUsd} (live), strike above $${strikeUsd}`);

  const txs: Record<string, string> = {};
  const record = (name: string, sent: Sent): void => {
    txs[name] = sent.hash;
  };

  record("mintA", await mint(ctx, a, toUsdcUnits(yesStake)));
  record("approveA", await approveExact(ctx, a, toUsdcUnits(yesStake)));
  if (noStake !== "0") {
    record("mintB", await mint(ctx, b, toUsdcUnits(noStake)));
    record("approveB", await approveExact(ctx, b, toUsdcUnits(noStake)));
  }

  const block = await ctx.publicClient.getBlock({ blockTag: "latest" });
  const resolveTime = Number(block.timestamp) + DURATION_SECONDS + CREATE_BUFFER_SECONDS;
  const question = buildQuestion({ symbol: "ETH", direction: "above", strikeUsd, resolveTime });
  const created = await createPool(ctx, a, {
    question, coingeckoId: "ethereum", direction: 0, strikeE18: toStrikeE18(strikeUsd), resolveTime: BigInt(resolveTime),
  });
  record("createPool", created);
  const id = created.id;
  say(`pool ${id} created: "${question}"`);

  record("stakeYes", await stake(ctx, a, id, true, toUsdcUnits(yesStake)));
  if (noStake !== "0") record("stakeNo", await stake(ctx, b, id, false, toUsdcUnits(noStake)));

  const open = await untilApi(
    () => api(`/pools/${id}`, Pool),
    (p) => p.yesTotal === toUsdcUnits(yesStake).toString() && p.noTotal === toUsdcUnits(noStake).toString(),
    "the stakes",
  );
  check(open.question === question, "backend shows the exact question stored onchain");
  check(open.status === "open", "backend reports status open before the close");

  say(`waiting for the resolver (resolveTime ${resolveTime}, then Chainlink CRE settles it)...`);
  const settledAt = Date.now() + RESOLVE_TIMEOUT_MS;
  for (;;) {
    const onchain = await readPool(ctx, id);
    if (onchain.resolved) break;
    if (Date.now() > settledAt) throw new Error("Pool was not resolved in time. Is scripts/resolver-loop.ts running and `cre` logged in?");
    await sleep(POLL_MS);
  }

  await verifyAndPayOut(ctx, scenario, id, a, b, { yesStake, noStake, priceE18 }, record);
  say(`DONE scenario ${scenario}, pool ${id}. Transactions: ${JSON.stringify(txs)}`);
}

interface Stakes {
  yesStake: string;
  noStake: string;
  priceE18: bigint;
}

async function verifyAndPayOut(
  ctx: PoolContext, scenario: Scenario, id: bigint, a: Wallet, b: Wallet, s: Stakes, record: (n: string, t: Sent) => void,
): Promise<void> {
  const onchain = await readPool(ctx, id);
  check(onchain.resolvedPriceE18 > 0n, `Chainlink reported a price: ${fromE18(onchain.resolvedPriceE18)}`);
  const drift = ((onchain.resolvedPriceE18 - s.priceE18) * 100n) / s.priceE18;
  check(drift < PRICE_TOLERANCE_PERCENT && drift > -PRICE_TOLERANCE_PERCENT, "reported price is within 10% of the live API price (a real price, not a stub)");

  const wantStatus = scenario === "void" ? "void" : "resolved";
  const api1 = await untilApi(() => api(`/pools/${id}`, Pool), (p) => p.status === wantStatus, `status ${wantStatus}`);
  check(api1.outcome === (scenario === "void" ? api1.outcome : scenario === "yes" ? "yes" : "no"), `backend outcome matches the ${scenario} scenario`);

  const poolBefore = await usdcBalance(ctx, ctx.pool);
  if (scenario === "void") {
    const pos = await untilApi(() => api(`/pools/${id}/position?address=${a.account.address}`, Position), (p) => p.refundable !== "0", "the refund");
    check(pos.refundable === toUsdcUnits(s.yesStake).toString(), "backend refundable equals the full stake");
    const before = await usdcBalance(ctx, a.account.address);
    record("refund", await refund(ctx, a, id));
    check((await usdcBalance(ctx, a.account.address)) - before === toUsdcUnits(s.yesStake), "refund returned the full stake with no fee");
    await expectRevert(() => refund(ctx, a, id), "a second refund");
    return;
  }

  const winner = scenario === "yes" ? a : b;
  const loser = scenario === "yes" ? b : a;
  const [winTotal, loseTotal] = scenario === "yes" ? [toUsdcUnits(s.yesStake), toUsdcUnits(s.noStake)] : [toUsdcUnits(s.noStake), toUsdcUnits(s.yesStake)];
  const expected = computePayout(winTotal, winTotal, loseTotal, onchain.feeBps);
  say(`expected winner payout ${formatUsdc(expected)} USDC (pool ${formatUsdc(winTotal + loseTotal)}, fee ${onchain.feeBps} bps)`);

  const pos = await untilApi(() => api(`/pools/${id}/position?address=${winner.account.address}`, Position), (p) => p.claimable !== "0", "the claimable amount");
  check(pos.claimable === expected.toString(), "backend claimable equals computePayout");
  const lose = await api(`/pools/${id}/position?address=${loser.account.address}`, Position);
  check(lose.claimable === "0", "backend shows the loser nothing to claim");

  const before = await usdcBalance(ctx, winner.account.address);
  record("claim", await claim(ctx, winner, id));
  check((await usdcBalance(ctx, winner.account.address)) - before === expected, "winner's USDC balance rose by exactly computePayout");
  check(poolBefore - (await usdcBalance(ctx, ctx.pool)) >= expected, "the pool contract paid it out");
  await expectRevert(() => claim(ctx, winner, id), "a double claim");
  await expectRevert(() => claim(ctx, loser, id), "a loser's claim");
}

main().catch((err: unknown) => {
  process.stderr.write(`e2e failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
