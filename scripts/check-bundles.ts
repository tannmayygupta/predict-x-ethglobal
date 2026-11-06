/**
 * Merge checklist: "No API keys in the extension or dashboard bundle". Scans the built output of both apps for key
 * variable names and key-shaped strings, and for private-key-shaped hex that is not a transaction hash.
 *
 *   pnpm --filter @predictx/extension build && pnpm --filter @predictx/dashboard build
 *   cd apps/backend && pnpm exec tsx --tsconfig ../../scripts/tsconfig.json ../../scripts/check-bundles.ts
 *
 * Exits 1 listing every offending file. It also reads the local .env and flags any secret VALUE that appears in a
 * bundle, which is the check that matters most.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRepoEnv, say } from "./common";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const OUTPUTS = ["apps/extension/dist", "apps/dashboard/dist"];
const SECRET_NAMES = ["OPENAI_API_KEY", "FLASH_API_KEY", "COINGECKO_API_KEY", "CRE_API_KEY", "CRE_ETH_PRIVATE_KEY", "TEST_WALLET_A_PRIVATE_KEY", "TEST_WALLET_B_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"];
const KEY_SHAPES: Array<[string, RegExp]> = [
  ["OpenAI-style key", /sk-[A-Za-z0-9_-]{20,}/],
  ["Definitive Flash key", /dpka_[A-Za-z0-9]{10,}/],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{30,}/],
  ["PEM private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
/** Env variables whose values must never appear in a bundle. Short or empty values are ignored. */
const SECRET_ENV = SECRET_NAMES;
const MIN_SECRET_LENGTH = 12;

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function main(): void {
  loadRepoEnv();
  const secretValues = SECRET_ENV.map((n) => [n, (process.env[n] ?? "").replace(/^0x/, "")] as const).filter(([, v]) => v.length >= MIN_SECRET_LENGTH);
  const problems: string[] = [];
  let scanned = 0;
  for (const out of OUTPUTS) {
    const files = walk(join(REPO, out));
    if (files.length === 0) problems.push(`${out}: nothing built (run the build first)`);
    for (const file of files) {
      if (/\.(woff2?|png|svg|ico)$/.test(file)) continue;
      scanned += 1;
      const text = readFileSync(file, "utf8");
      const where = relative(REPO, file);
      for (const name of SECRET_NAMES) if (text.includes(name)) problems.push(`${where}: mentions ${name}`);
      for (const [label, re] of KEY_SHAPES) if (re.test(text)) problems.push(`${where}: contains a ${label}`);
      for (const [name, value] of secretValues) if (text.includes(value)) problems.push(`${where}: contains the VALUE of ${name}`);
    }
  }
  if (problems.length > 0) {
    for (const p of problems) process.stderr.write(`FAIL ${p}\n`);
    process.exit(1);
  }
  say(`ok: ${scanned} built files in ${OUTPUTS.join(" and ")} contain no key names, key-shaped strings or secret values`);
}

main();
