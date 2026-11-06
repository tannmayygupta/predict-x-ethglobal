import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // VITE_ variables come from the repo-root .env, shared with the extension.
  envDir: "../..",
  plugins: [react()],
  // "::" is dual-stack: both http://localhost and http://127.0.0.1 reach the dev server, whichever way the browser resolves localhost.
  server: { host: "::", port: 5173, strictPort: true },
});
