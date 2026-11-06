import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * "Nothing in the product is faked": shipped code under packages/ui, apps/extension and apps/dashboard may not
 * import the shared fixtures or hardcode a contract/wallet address. Addresses come from deployments.ts, the
 * environment or the API. (Tests and build output are exempt.)
 */
const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const ROOTS = ["packages/ui/src", "apps/extension/src", "apps/extension/public", "apps/dashboard/src"];
const SOURCE_FILE = /\.(ts|tsx|js|jsx|css|html|json)$/;
const FIXTURE_USE = /\bfixtures\b|\bmarketEth\b|\binsightEth\b|\bquoteEthMarket\b|\borderFilled\b|\bpoolOpen\b|\bpoolResolved\b|\bpositionWinner\b/;
const ADDRESS_LITERAL = /0x[0-9a-fA-F]{40}\b/;

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "dist") return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : SOURCE_FILE.test(name) ? [path] : [];
  });
}

const shipped = ROOTS.flatMap((root) => files(join(REPO, root)));

describe("shipped code is not faked", () => {
  it("scans something (this guard must not pass vacuously)", () => {
    expect(shipped.length).toBeGreaterThan(0);
  });

  it("never imports or names the shared fixtures", () => {
    const offenders = shipped.filter((f) => FIXTURE_USE.test(readFileSync(f, "utf8"))).map((f) => relative(REPO, f));
    expect(offenders).toEqual([]);
  });

  it("never hardcodes an address", () => {
    const offenders = shipped.filter((f) => ADDRESS_LITERAL.test(readFileSync(f, "utf8"))).map((f) => relative(REPO, f));
    expect(offenders).toEqual([]);
  });
});
