// @vitest-environment jsdom
import { fixtures, type Pool, type Position } from "@predictx/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PoolSlip, type PoolSlipProps } from "../src/components/PoolSlip";
import { createChainClients } from "../src/chain";
import type { WalletController, WalletState } from "../src/wallet";

/**
 * Renders the real slip for every pool state and checks the exact copy from the deck. The fixtures are used only
 * here, as test input; shipped code never imports them (see noFakes.test.ts).
 */
const chain = createChainClients();
const NOW = 1_800_000_000;
const HOLDER = "0x1111111111111111111111111111111111111111";

function controller(state: Partial<WalletState> = {}): WalletController {
  const full: WalletState = { status: "connected", address: HOLDER, chainId: chain.chainId, error: null, ...state };
  return {
    getState: () => full,
    subscribe: () => () => undefined,
    restore: async () => undefined,
    connect: async () => undefined,
    switchToPoolChain: async () => undefined,
    session: () => { throw new Error("not used"); },
    dispose: () => undefined,
  };
}

function pool(over: Partial<Pool> = {}): Pool {
  return { ...fixtures.poolOpen, resolveTime: NOW + 192, status: "open", outcome: null, resolvedPriceUsd: null, ...over };
}

function slip(over: Partial<PoolSlipProps> & { pool: Pool }) {
  return render(<PoolSlip position={null} controller={controller()} chain={chain} faucetUrl="http://localhost:5173/faucet" onChanged={() => undefined} {...over} />);
}

const position = (over: Partial<Position> = {}): Position => ({ ...fixtures.positionWinner, address: HOLDER, ...over });

afterEach(cleanup);

describe("PoolSlip states", () => {
  it("open: question, countdown, pool size, odds and both bet buttons", () => {
    slip({ pool: pool() });
    expect(screen.getByText(fixtures.poolOpen.question)).toBeTruthy();
    expect(screen.getByText(/Pool 100\.00 USDC/)).toBeTruthy();
    expect(screen.getByText("YES 60%")).toBeTruthy();
    expect(screen.getByText("NO 40%")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bet YES" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bet NO" })).toBeTruthy();
  });

  it("open with no bets shows the empty bar and 'No bets yet'", () => {
    slip({ pool: pool({ yesTotal: "0", noTotal: "0" }) });
    expect(screen.getByText("No bets yet")).toBeTruthy();
  });

  it("open but the local clock is past the close: shows the waiting line, no buttons (never bets after the close)", () => {
    slip({ pool: pool({ resolveTime: 1 }) });
    expect(screen.getByText("Closed. Waiting for the result...")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Bet YES" })).toBeNull();
  });

  it("awaiting: exact copy and no buttons", () => {
    slip({ pool: pool({ status: "awaiting", resolveTime: 1 }) });
    expect(screen.getByText("Closed. Waiting for the result...")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("resolved, winner: result, price, stake, claim button with the exact payout", () => {
    slip({
      pool: pool({ status: "resolved", resolveTime: 1, outcome: "yes", resolvedPriceUsd: "0.0000131" }),
      position: position({ yesStake: "30000000", noStake: "0", claimable: "49000000" }),
    });
    expect(screen.getByText(/Result: YES/)).toBeTruthy();
    expect(screen.getByText(/Price at close \$0\.0000131/)).toBeTruthy();
    expect(screen.getByText(/You staked 30\.00 YES\. You can claim 49\.00 USDC\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Claim 49.00 USDC" })).toBeTruthy();
    expect(screen.getByText("Settled by Chainlink CRE (simulation)")).toBeTruthy();
  });

  it("resolved, loser: 'Better luck next time.' and no claim button", () => {
    slip({
      pool: pool({ status: "resolved", resolveTime: 1, outcome: "yes", resolvedPriceUsd: "1" }),
      position: position({ yesStake: "0", noStake: "10000000", claimable: "0" }),
    });
    expect(screen.getByText(/You staked 10\.00 NO\. Better luck next time\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Claim/ })).toBeNull();
  });

  it("resolved NO shows 'Result: NO'", () => {
    slip({ pool: pool({ status: "resolved", resolveTime: 1, outcome: "no", resolvedPriceUsd: "1" }) });
    expect(screen.getByText(/Result: NO/)).toBeTruthy();
  });

  it("resolved, already claimed: says Claimed and offers no second claim", () => {
    slip({
      pool: pool({ status: "resolved", resolveTime: 1, outcome: "yes", resolvedPriceUsd: "1" }),
      position: position({ yesStake: "30000000", claimable: "0", claimed: true }),
    });
    expect(screen.getByText(/Claimed\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Claim/ })).toBeNull();
  });

  it("void: exact note and a refund button with the full stake", () => {
    slip({
      pool: pool({ status: "void", resolveTime: 1, yesTotal: "5000000", noTotal: "0" }),
      position: position({ yesStake: "5000000", claimable: "0", refundable: "5000000" }),
    });
    expect(screen.getByText("No one took the other side. Everyone gets a refund.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refund 5.00 USDC" })).toBeTruthy();
  });

  it("void with nothing to refund shows no button", () => {
    slip({ pool: pool({ status: "void", resolveTime: 1 }), position: position({ refundable: "0" }) });
    expect(screen.queryByRole("button", { name: /Refund/ })).toBeNull();
  });
});

describe("PoolSlip wallet gating", () => {
  it("no MetaMask: says to install it", () => {
    slip({ pool: pool(), controller: controller({ status: "no-wallet", address: null, chainId: null }) });
    expect(screen.getByText("Install MetaMask to continue.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Bet YES" })).toBeNull();
  });

  it("not connected: offers to connect instead of betting", () => {
    slip({ pool: pool(), controller: controller({ status: "disconnected", address: null, chainId: null }) });
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Bet YES" })).toBeNull();
  });

  it("wrong network: the only action is 'Switch to Base Sepolia'", () => {
    slip({ pool: pool(), controller: controller({ chainId: 1 }) });
    expect(screen.getByRole("button", { name: "Switch to Base Sepolia" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Bet YES" })).toBeNull();
  });

  it("claim is also gated on the network", () => {
    slip({
      pool: pool({ status: "resolved", resolveTime: 1, outcome: "yes", resolvedPriceUsd: "1" }),
      position: position({ claimable: "49000000", yesStake: "30000000" }),
      controller: controller({ chainId: 1 }),
    });
    expect(screen.queryByRole("button", { name: /Claim 49/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Switch to Base Sepolia" })).toBeTruthy();
  });
});
