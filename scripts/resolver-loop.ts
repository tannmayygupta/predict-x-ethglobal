/**
 * Auto-resolver (decision D-T2): every minute, if any pool is due, run the real Chainlink CRE workflow
 * with `cre workflow simulate ... --broadcast`. The workflow reads the pool, fetches the CoinGecko price,
 * and delivers the report through the CRE MockKeystoneForwarder that the deployed PredictionPool trusts.
 * This is a CRE SIMULATION with real onchain delivery, and it is labelled that way everywhere it is shown.
 *
 * Run from apps/backend (pnpm resolves viem there):
 *   pnpm exec tsx --tsconfig ../../scripts/tsconfig.json ../../scripts/resolver-loop.ts [--once] [--dry-run] [--force]
 *
 * Needs the `cre` CLI on PATH and logged in, and CRE_ETH_PRIVATE_KEY (a Base Sepolia wallet with test ETH)
 * in the repo .env. RESOLVER_INTERVAL_SECONDS overrides the 60 s default.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dueIds, loadRepoEnv, poolContext, readKey, say, sleep, type PoolContext } from "./common";

const CRE_DIR = fileURLToPath(new URL("../cre", import.meta.url));
const DEFAULT_INTERVAL_SECONDS = 60;
const CRE_TIMEOUT_MS = 240_000;
const MAX_DUE = 10n;
const TAIL_LINES = 14;
const CRE_ARGS = [
  "workflow", "simulate", "resolve-pools", "--target", "staging-settings",
  "--non-interactive", "--trigger-index", "0", "--broadcast",
];
const INSTALL_HINT = "cre CLI not found. Install it with: irm https://app.chain.link/cre/install.ps1 | iex   then run: cre login";

interface CreResult {
  code: number | null;
  tail: string[];
}

/** Where the official Windows installer puts cre.exe; a terminal opened before the install may not have it on PATH yet. */
function windowsInstallDir(): string | null {
  return process.platform === "win32" && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "cre") : null;
}

/**
 * The CLI wants the key as 64 hex characters without 0x. It never needs to be printed. Login comes from `cre login`
 * or, for an unattended loop, CRE_API_KEY in the environment (passed through untouched).
 */
function creEnv(): NodeJS.ProcessEnv {
  const key = readKey("CRE_ETH_PRIVATE_KEY").slice(2);
  // secrets.yaml declares this variable, so it must exist; empty means keyless CoinGecko.
  const env: NodeJS.ProcessEnv = { ...process.env, CRE_ETH_PRIVATE_KEY: key, CRE_COINGECKO_API_KEY: process.env.CRE_COINGECKO_API_KEY ?? "" };
  const dir = windowsInstallDir();
  if (dir) {
    const name = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "Path";
    env[name] = `${dir};${env[name] ?? ""}`;
  }
  return env;
}

function runCre(): Promise<CreResult> {
  return new Promise((resolve, reject) => {
    const env = creEnv();
    const secret = env.CRE_ETH_PRIVATE_KEY ?? "";
    // On Windows the child is looked up on the PATH we just built, so spawn the explicit file when it is there.
    const dir = windowsInstallDir();
    const exe = dir && existsSync(join(dir, "cre.exe")) ? join(dir, "cre.exe") : "cre";
    const child = spawn(exe, CRE_ARGS, { cwd: CRE_DIR, env });
    const lines: string[] = [];
    const collect = (chunk: Buffer): void => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line.trim()) lines.push(secret ? line.split(secret).join("[redacted]") : line);
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => child.kill(), CRE_TIMEOUT_MS);
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(err.code === "ENOENT" ? new Error(INSTALL_HINT) : err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, tail: lines.slice(-TAIL_LINES) });
    });
  });
}

async function cycle(ctx: PoolContext, dryRun: boolean, force: boolean): Promise<void> {
  const due = await dueIds(ctx, MAX_DUE);
  if (due.length === 0 && !force) {
    say("no pools due");
    return;
  }
  say(`due pools: ${due.join(", ")}`);
  if (dryRun) {
    say(`dry run: would run in cre/: cre ${CRE_ARGS.join(" ")}`);
    return;
  }
  const result = await runCre();
  for (const line of result.tail) say(`cre: ${line}`);
  const still = await dueIds(ctx, MAX_DUE);
  const resolved = due.filter((id) => !still.includes(id));
  say(`cre exited ${result.code}; resolved ${resolved.length} of ${due.length}${still.length ? `; still due: ${still.join(", ")}` : ""}`);
}

async function main(): Promise<void> {
  loadRepoEnv();
  const once = process.argv.includes("--once");
  const dryRun = process.argv.includes("--dry-run");
  // Diagnostics: run the CRE workflow even when nothing is due, to check the CLI, login and key end to end.
  const force = process.argv.includes("--force");
  const intervalMs = Number(process.env.RESOLVER_INTERVAL_SECONDS ?? DEFAULT_INTERVAL_SECONDS) * 1000;
  if (!Number.isFinite(intervalMs) || intervalMs < 10_000) throw new Error("RESOLVER_INTERVAL_SECONDS must be at least 10");
  if (!dryRun) readKey("CRE_ETH_PRIVATE_KEY"); // fail at start, not at the first due pool
  const ctx = poolContext();
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      say(`${signal}: finishing the current cycle, then exiting`);
      stopping = true;
    });
  }
  say(`resolver started for pool ${ctx.pool} every ${intervalMs / 1000}s${dryRun ? " (dry run)" : ""}`);
  while (!stopping) {
    // A failed cycle (RPC blip, CoinGecko, cre error) is logged and retried next tick; it must not kill the loop.
    await cycle(ctx, dryRun, force).catch((err: unknown) => say(`cycle failed: ${err instanceof Error ? err.message : String(err)}`));
    if (once) return;
    // Sleep in one-second slices so a signal ends the loop promptly.
    for (let waited = 0; waited < intervalMs && !stopping; waited += 1000) await sleep(1000);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`resolver failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
