/**
 * One command for the demo: `pnpm demo` (from the repo root).
 * Builds the extension, then runs the backend, the dashboard and the settlement loop side by side with
 * prefixed output. Ctrl+C stops all three. Test funds only; nothing here touches mainnet.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BACKEND_DIR = join(ROOT, "apps", "backend");
const HEALTH_URL = "http://localhost:8787/api/v1/health";
const HEALTH_TRIES = 40;
const HEALTH_WAIT_MS = 500;

// The official Windows installer puts cre.exe here; a terminal opened before the install may not have it on PATH.
const creDir = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "cre") : "";
const env = { ...process.env, PATH: creDir && existsSync(creDir) ? `${process.env.PATH ?? ""}${delimiter}${creDir}` : process.env.PATH };

const children = [];

function prefixed(name, stream) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) process.stdout.write(`[${name}] ${line}\n`);
  });
}

function run(name, command, args, cwd = ROOT) {
  const child = spawn(command, args, { cwd, env, shell: true, stdio: ["ignore", "pipe", "pipe"] });
  prefixed(name, child.stdout);
  prefixed(name, child.stderr);
  child.on("exit", (code) => process.stdout.write(`[${name}] exited with code ${code}\n`));
  children.push(child);
  return child;
}

function stopAll() {
  for (const child of children) {
    if (child.pid === undefined) continue;
    // shell: true wraps the process, so on Windows the whole tree has to be taken down.
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
}

async function waitForBackend() {
  for (let i = 0; i < HEALTH_TRIES; i += 1) {
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_WAIT_MS));
  }
  return false;
}

process.on("SIGINT", () => {
  stopAll();
  process.exit(0);
});

process.stdout.write("Building the extension (apps/extension/dist)...\n");
// The demo runs the local backend and dashboard, so this build must point at them; a normal build targets the deployed app.
const localExtensionEnv = { ...env, VITE_EXTENSION_API_BASE_URL: "http://localhost:8787/api/v1", VITE_EXTENSION_DASHBOARD_URL: "http://localhost:5173" };
const build = spawnSync("pnpm", ["--filter", "@predictx/extension", "build"], { cwd: ROOT, env: localExtensionEnv, shell: true, stdio: "inherit" });
if (build.status !== 0) {
  process.stdout.write("Extension build failed; fix it first.\n");
  process.exit(1);
}

run("backend", "pnpm", ["--filter", "@predictx/backend", "start"]);
run("dashboard", "pnpm", ["--filter", "@predictx/dashboard", "dev"]);

if (await waitForBackend()) {
  run("resolver", "pnpm", ["exec", "tsx", "--tsconfig", "../../scripts/tsconfig.json", "../../scripts/resolver-loop.ts"], BACKEND_DIR);
  process.stdout.write(
    [
      "",
      "PredictX demo is up:",
      "  Dashboard   http://localhost:5173",
      "  API         http://localhost:8787/api/v1",
      "  Extension   chrome://extensions > Developer mode > Load unpacked > apps/extension/dist",
      "  Stop        Ctrl+C",
      "",
    ].join("\n"),
  );
} else {
  process.stdout.write("The backend did not answer on /health. Check the [backend] lines above.\n");
  stopAll();
  process.exit(1);
}
