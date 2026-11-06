/**
 * Start-up for the hosted settler (Vercel Daemon or any container). Run it with tsx, from apps/backend:
 *   node_modules/.bin/tsx --tsconfig ../../scripts/tsconfig.json ../../scripts/settler-start.mjs
 *
 * The `cre` CLI refuses to run, even to simulate, unless it is logged in. A container has no browser, so the
 * login is restored from a secret: CRE_LOGIN_YAML_B64 holds your ~/.cre/cre.yaml, base64-encoded. It is written to
 * ~/.cre/cre.yaml before the loop starts and removed from the environment, so neither the loop nor `cre` sees it.
 * The CLI keeps the access token fresh from the refresh token inside; if CRE_API_KEY is set it is used instead.
 *
 * Make the secret on your computer, then paste it into the host's environment variables (PowerShell, copies it
 * to the clipboard without printing it):
 *   [Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.cre\cre.yaml")) | Set-Clipboard
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const say = (message) => process.stdout.write(`${new Date().toISOString()} settler: ${message}\n`);

const seed = process.env.CRE_LOGIN_YAML_B64;
delete process.env.CRE_LOGIN_YAML_B64;

if (process.env.CRE_API_KEY) {
  say("using CRE_API_KEY for the cre login");
} else if (seed) {
  const dir = join(homedir(), ".cre");
  const file = join(dir, "cre.yaml");
  const text = Buffer.from(seed, "base64").toString("utf8");
  if (!/^\s*RefreshToken\s*:/m.test(text)) {
    process.stderr.write("settler: CRE_LOGIN_YAML_B64 is not a cre.yaml (no RefreshToken found). Re-create it from ~/.cre/cre.yaml.\n");
    process.exit(1);
  }
  // Never overwrite a file that already exists: on a host with a disk it may hold a newer refreshed login.
  if (existsSync(file)) {
    say("cre login file already present; keeping it");
  } else {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(file, text, { mode: 0o600 });
    chmodSync(file, 0o600);
    say("cre login restored from CRE_LOGIN_YAML_B64");
  }
} else {
  say("WARNING: neither CRE_API_KEY nor CRE_LOGIN_YAML_B64 is set, so cre will refuse to run");
}

await import("./resolver-loop.ts");
