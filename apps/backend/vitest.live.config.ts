import { defineConfig } from "vitest/config";

// Separate config on purpose: the base config stubs fetch, live tests need the network.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/live/**/*.live.test.ts"],
    setupFiles: ["./test/live/setup.ts"],
    passWithNoTests: true,
    testTimeout: 30_000,
  },
});
