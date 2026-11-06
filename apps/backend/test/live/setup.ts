import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Live tests read real keys from the repo-level .env; values already in the environment win.
const envFile = fileURLToPath(new URL("../../../../.env", import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}
