import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Live tests spend Base Sepolia gas with real keys; they run only via `pnpm test:live`.
    exclude: ["test/live/**", "node_modules/**"],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
