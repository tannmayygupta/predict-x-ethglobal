import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Live tests need real keys and network; they run only via `pnpm test:live`.
    exclude: ["test/live/**", "node_modules/**"],
    setupFiles: ["./test/setup.ts"],
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/server.ts"],
      reporter: ["text", "json-summary"],
      // X-03: pure logic must stay covered; routes and plugins are exercised through the route tests.
      thresholds: {
        "src/services/**": { lines: 90 },
        "src/clients/**": { lines: 90 },
        "src/util/**": { lines: 90 },
        "src/errors.ts": { lines: 90 },
      },
    },
  },
});
