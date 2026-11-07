import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A silent fallback to localhost is how a build once drafted "http://localhost:5173/pool/12" into a post. Shipped code
 * may not name a local address: the deployed origin is DEPLOYED_APP_URL in packages/shared, and a local one only ever
 * arrives through the VITE_ environment variables. (Tests, docs, scripts and build output are exempt.)
 */
const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const ROOTS = ["packages/shared/src", "packages/ui/src", "apps/extension/src", "apps/extension/public", "apps/dashboard/src"];
const SOURCE_FILE = /\.(ts|tsx|js|jsx|css|html|json)$/;
const LOCAL_ADDRESS = /\blocalhost\b|\b127\.0\.0\.1\b/;

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "dist") return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : SOURCE_FILE.test(name) ? [path] : [];
  });
}

const shipped = ROOTS.flatMap((root) => files(join(REPO, root)));

describe("shipped code has no local-address default", () => {
  it("scans something, including the extension manifest (this guard must not pass vacuously)", () => {
    expect(shipped.length).toBeGreaterThan(0);
    expect(shipped.some((f) => f.endsWith("manifest.ts"))).toBe(true);
  });

  it("never names localhost or 127.0.0.1", () => {
    const offenders = shipped.filter((f) => LOCAL_ADDRESS.test(readFileSync(f, "utf8"))).map((f) => relative(REPO, f));
    expect(offenders).toEqual([]);
  });
});
