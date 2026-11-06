import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import manifest from "./src/manifest";

export default defineConfig({
  // VITE_ variables come from the repo-root .env, shared with the dashboard.
  envDir: "../..",
  plugins: [react(), crx({ manifest })],
  build: { target: "es2022" },
  server: { port: 5174, strictPort: true, cors: true },
});
