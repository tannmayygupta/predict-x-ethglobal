import { fileURLToPath } from "node:url";
import { defineManifest } from "@crxjs/vite-plugin";
import { loadEnv } from "vite";
// Relative on purpose: Vite runs this file in plain Node while it loads the config, and Node cannot import the
// TypeScript source of the @predictx/shared workspace package. A relative import is bundled by esbuild instead.
import { DEPLOYED_API_BASE_URL } from "../../../packages/shared/src/constants";

const X_MATCHES = ["https://x.com/*", "https://twitter.com/*"];

export default defineManifest(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL("../../..", import.meta.url)), "VITE_");
  // Same variable and same fallback as src/config.ts, so the host permission always matches the URL the worker calls.
  const apiOrigin = new URL(env.VITE_EXTENSION_API_BASE_URL?.trim() || DEPLOYED_API_BASE_URL).origin;
  return {
    manifest_version: 3,
    name: "PredictX",
    version: "0.2.0",
    description: "Prices, AI tips and prediction pools on X, settled by Chainlink on Base Sepolia.",
    permissions: [],
    // The service worker calls the backend; x.com pages never do.
    host_permissions: [...X_MATCHES, `${apiOrigin}/*`],
    background: { service_worker: "src/background/index.ts", type: "module" },
    content_scripts: [
      { matches: X_MATCHES, js: ["src/inpage/inpage.iife.ts"], run_at: "document_start", world: "MAIN" },
      { matches: X_MATCHES, js: ["src/content/index.tsx"], run_at: "document_idle" },
    ],
    web_accessible_resources: [{ resources: ["assets/*"], matches: X_MATCHES }],
  };
});
