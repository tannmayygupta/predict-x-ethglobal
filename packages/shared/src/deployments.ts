/**
 * Deployed contract addresses per chain id. Base Sepolia (84532) deployed 2026-10-31 at block 52490267 by
 * `forge script script/Deploy.s.sol` (see contracts/README.md). Forwarder: CRE MockKeystoneForwarder (simulation).
 */
export type HexAddress = `0x${string}`;

export interface Deployment {
  predictionPool: HexAddress | null;
  mockUsdc: HexAddress | null;
}

export const deployments = {
  84532: {
    predictionPool: "0x6b0f6C0f324C615Add6BfcA5EE0b8eeD66F2C0cd",
    mockUsdc: "0x1e05373c199D764f7dE0353d58AFEa2b4C6326Ef",
  },
} as const satisfies Record<number, Deployment>;
