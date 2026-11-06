import { defineConfig } from "vitest/config";

export default defineConfig({
  // Process CSS (including ?inline imports) so tests see the real tokens and utilities, not empty strings.
  test: { environment: "node", include: ["test/**/*.test.ts"], restoreMocks: true, css: { include: [/.+/] } },
});
