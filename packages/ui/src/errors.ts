/**
 * One error type for everything the wallet and the chain can do wrong. Screens switch on `code`, never on
 * message text, and the message is a plain sentence that says what happened and what to do.
 */
export type UiErrorCode =
  | "NO_WALLET"
  | "WRONG_NETWORK"
  | "USER_REJECTED"
  | "NEED_USDC"
  | "NO_GAS"
  | "BAD_INPUT"
  | "POOL_NOT_FOUND"
  | "POOL_CLOSED"
  | "RESOLVE_TOO_SOON"
  | "NOTHING_TO_CLAIM"
  | "ALREADY_CLAIMED"
  | "CHAIN_ERROR";

export class UiError extends Error {
  constructor(
    readonly code: UiErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "UiError";
  }
}

const USER_REJECTED_CODE = 4001; // EIP-1193

/** Revert reasons of PredictionPool.sol mapped to codes. Anything else stays a generic chain error. */
const REVERTS: Record<string, [UiErrorCode, string]> = {
  PoolNotFound: ["POOL_NOT_FOUND", "Pool not found."],
  StakingClosed: ["POOL_CLOSED", "Betting on this pool has closed."],
  ResolveTimeTooSoon: ["RESOLVE_TOO_SOON", "The wallet took too long. Review the prediction and create it again."],
  ZeroAmount: ["BAD_INPUT", "Enter an amount above zero."],
  NothingToClaim: ["NOTHING_TO_CLAIM", "There is nothing to claim for this wallet."],
  AlreadyClaimed: ["ALREADY_CLAIMED", "Already claimed."],
  QuestionTooLong: ["BAD_INPUT", "The question is too long. Use a shorter strike price."],
  InvalidDirection: ["BAD_INPUT", "Choose above or below."],
  MintCapExceeded: ["BAD_INPUT", "The most you can mint at once is 1000 USDC."],
  NotResolved: ["CHAIN_ERROR", "This pool has not been settled yet."],
  PoolIsVoid: ["CHAIN_ERROR", "This pool is void. Use refund instead."],
  PoolNotVoid: ["CHAIN_ERROR", "This pool is not void, so there is nothing to refund."],
};

interface Walkable {
  cause?: unknown;
  name?: unknown;
  code?: unknown;
  data?: { errorName?: unknown };
  shortMessage?: unknown;
}

/** Follows `cause` links (viem nests the real reason several levels down). Guards against cycles. */
function chain(err: unknown): Walkable[] {
  const seen: Walkable[] = [];
  let current: unknown = err;
  while (typeof current === "object" && current !== null && seen.length < 12 && !seen.includes(current)) {
    seen.push(current);
    current = (current as Walkable).cause;
  }
  return seen;
}

export function toUiError(err: unknown): UiError {
  if (err instanceof UiError) return err;
  const links = chain(err);
  if (links.some((e) => e.code === USER_REJECTED_CODE || e.name === "UserRejectedRequestError")) {
    return new UiError("USER_REJECTED", "You rejected the request in your wallet.", { cause: err });
  }
  for (const link of links) {
    const name = link.data?.errorName;
    const known = typeof name === "string" ? REVERTS[name] : undefined;
    if (known) return new UiError(known[0], known[1], { cause: err });
  }
  if (links.some((e) => e.name === "InsufficientFundsError")) {
    return new UiError("NO_GAS", "Your wallet needs Base Sepolia ETH to pay for gas.", { cause: err });
  }
  const detail = links.map((e) => e.shortMessage).find((m): m is string => typeof m === "string");
  return new UiError("CHAIN_ERROR", detail ? `Transaction failed: ${detail}` : "Transaction failed. Try again.", { cause: err });
}
