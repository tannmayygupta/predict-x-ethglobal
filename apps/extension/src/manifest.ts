import { fileURLToPath } from "node:url";
import { defineManifest } from "@crxjs/vite-plugin";
import { loadEnv } from "vite";

const X_MATCHES = ["https://x.com/*", "https://twitter.com/*"];

export default defineManifest(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL("../../..", import.meta.url)), "VITE_");
  const apiOrigin = new URL(env.VITE_API_BASE_URL ?? "http://localhost:8787/api/v1").origin;
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
