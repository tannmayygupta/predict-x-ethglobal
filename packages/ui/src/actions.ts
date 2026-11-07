/**
 * Every wallet write the product makes: create a pool, bet, claim, refund, mint test USDC. Each one checks the
 * network, simulates first (so a revert shows its reason before gas is spent), sends, and waits for the receipt.
 * The same functions run in the extension, the dashboard and the end-to-end script.
 */
import { mockUsdcAbi, predictionPoolAbi, toUsdcUnits } from "@predictx/shared";
import { parseEventLogs, type Account, type Address, type Hex } from "viem";
import {
  chainNow, readRawPool, readUsdcAllowance, readUsdcBalance, type ChainClients, type PoolWalletClient,
} from "./chain";
import type { PreparedPool } from "./create";
import { UiError, toUiError } from "./errors";

export interface Session {
  chain: ChainClients;
  wallet: PoolWalletClient;
  /** An address for browser wallets (they sign), or a local account in scripts and tests. */
  account: Account | Address;
}

/** The faucet contract caps one mint at 1,000 USDC (API_CONTRACT section 4). */
export const MAX_MINT_USDC = "1000";
/** What the one-click "Get test USDC" button mints. */
export const FAUCET_MINT_USDC = "100";
const WRONG_NETWORK_MESSAGE = "Switch your wallet to Base Sepolia.";

export function accountAddress(session: Session): Address {
  return typeof session.account === "string" ? session.account : session.account.address;
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw toUiError(err);
  }
}

async function assertNetwork(session: Session): Promise<void> {
  if ((await session.wallet.getChainId()) !== session.chain.chainId) throw new UiError("WRONG_NETWORK", WRONG_NETWORK_MESSAGE);
}

async function confirmed(session: Session, hash: Hex): Promise<Hex> {
  const receipt = await session.chain.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new UiError("CHAIN_ERROR", "The transaction was reverted onchain.");
  return hash;
}

export function createPool(session: Session, pool: PreparedPool): Promise<{ poolId: number; hash: Hex }> {
  return guarded(async () => {
    await assertNetwork(session);
    const { chain } = session;
    const { request } = await chain.publicClient.simulateContract({
      account: session.account, address: chain.poolAddress, abi: predictionPoolAbi, functionName: "createPool",
      args: [pool.question, pool.coingeckoId, pool.direction, pool.strikeE18, BigInt(pool.resolveTime)],
    });
    const hash = await confirmed(session, await session.wallet.writeContract(request));
    const receipt = await chain.publicClient.getTransactionReceipt({ hash });
    const created = parseEventLogs({ abi: predictionPoolAbi, eventName: "PoolCreated", logs: receipt.logs })[0];
    if (!created) throw new UiError("CHAIN_ERROR", "The pool was created but its id could not be read. Check the dashboard.");
    return { poolId: Number(created.args.id), hash };
  });
}

export interface StakeInput {
  poolId: number;
  isYes: boolean;
  /** Decimal USDC, for example "5.00". */
  amountUsdc: string;
}

export interface StakeResult {
  /** Null when the existing allowance already covered the bet. */
  approvalHash: Hex | null;
  stakeHash: Hex;
}

function parseAmount(amountUsdc: string): bigint {
  try {
    const units = toUsdcUnits(amountUsdc);
    if (units > 0n) return units;
  } catch {
    /* falls through to the shared message */
  }
  throw new UiError("BAD_INPUT", "Enter an amount above zero, with at most 6 decimals.");
}

export type StakeStep = "approving" | "staking";

/** Approves exactly the amount being bet (never unlimited), then stakes. `onStep` lets the screen name each wallet prompt. */
export function stake(session: Session, input: StakeInput, onStep?: (step: StakeStep) => void): Promise<StakeResult> {
  return guarded(async () => {
    const units = parseAmount(input.amountUsdc);
    await assertNetwork(session);
    const { chain } = session;
    const holder = accountAddress(session);
    const [raw, now, balance, allowance] = await Promise.all([
      readRawPool(chain, BigInt(input.poolId)), chainNow(chain), readUsdcBalance(chain, holder), readUsdcAllowance(chain, holder),
    ]);
    if (now >= Number(raw.resolveTime)) throw new UiError("POOL_CLOSED", "Betting on this pool has closed.");
    if (balance < units) throw new UiError("NEED_USDC", "You need test USDC.");

    let approvalHash: Hex | null = null;
    if (allowance < units) {
      onStep?.("approving");
      const { request } = await chain.publicClient.simulateContract({
        account: session.account, address: chain.usdcAddress, abi: mockUsdcAbi, functionName: "approve", args: [chain.poolAddress, units],
      });
      approvalHash = await confirmed(session, await session.wallet.writeContract(request));
    }
    onStep?.("staking");
    const { request } = await chain.publicClient.simulateContract({
      account: session.account, address: chain.poolAddress, abi: predictionPoolAbi, functionName: "stake",
      args: [BigInt(input.poolId), input.isYes, units],
    });
    return { approvalHash, stakeHash: await confirmed(session, await session.wallet.writeContract(request)) };
  });
}

/** Winners only; the contract pays `computePayout` and sends the fee to the treasury once. */
export function claim(session: Session, poolId: number): Promise<Hex> {
  return guarded(async () => {
    await assertNetwork(session);
    const { request } = await session.chain.publicClient.simulateContract({
      account: session.account, address: session.chain.poolAddress, abi: predictionPoolAbi, functionName: "claim", args: [BigInt(poolId)],
    });
    return confirmed(session, await session.wallet.writeContract(request));
  });
}

/** Void pools only: returns the full stake, no fee. */
export function refund(session: Session, poolId: number): Promise<Hex> {
  return guarded(async () => {
    await assertNetwork(session);
    const { request } = await session.chain.publicClient.simulateContract({
      account: session.account, address: session.chain.poolAddress, abi: predictionPoolAbi, functionName: "refund", args: [BigInt(poolId)],
    });
    return confirmed(session, await session.wallet.writeContract(request));
  });
}

/** Faucet: mints test USDC to the connected wallet. Test USDC has no value. */
export function mintTestUsdc(session: Session, amountUsdc: string): Promise<Hex> {
  return guarded(async () => {
    const units = parseAmount(amountUsdc);
    if (units > toUsdcUnits(MAX_MINT_USDC)) throw new UiError("BAD_INPUT", `The most you can mint at once is ${MAX_MINT_USDC} USDC.`);
    await assertNetwork(session);
    const { request } = await session.chain.publicClient.simulateContract({
      account: session.account, address: session.chain.usdcAddress, abi: mockUsdcAbi, functionName: "mint",
      args: [accountAddress(session), units],
    });
    return confirmed(session, await session.wallet.writeContract(request));
  });
}
