import { defineConfig } from "vitest/config";

// Separate config on purpose: these tests need the network, funded test wallets and a running backend.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/live/**/*.live.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    passWithNoTests: true,
  },
});
