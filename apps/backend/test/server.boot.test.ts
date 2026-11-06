import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { HealthResponse } from "../src/routes/health";
import { httpGet, ServerProcess } from "./helpers/serverProcess";

/*
 * T-B10 section 8.1. The scaffold runs the backend through tsx (package.json `start`), so there is no
 * dist/server.js to build; these tests spawn the same entry point `pnpm start` uses.
 */

const BOOT_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 30_000;

let server: ServerProcess | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

function portOf(line: Record<string, unknown>): number {
  const port = line.port;
  if (typeof port !== "number") throw new Error(`listen line carries no numeric port: ${JSON.stringify(line)}`);
  return port;
}

describe("B10-01 boot smoke test", () => {
  it(
    "starts with PORT=0 and a temp SQLITE_PATH, logs the bound port, and answers GET /api/v1/health over real HTTP",
    async () => {
      server = ServerProcess.start();
      const listening = await server.waitForLine((l) => l.msg === "backend listening", BOOT_TIMEOUT_MS);
      const port = portOf(listening);
      expect(port).toBeGreaterThan(0);

      const res = await httpGet(port, "/api/v1/health");
      expect(res.status).toBe(200);
      expect(HealthResponse.parse(JSON.parse(res.body))).toEqual({ ok: true });
    },
    TEST_TIMEOUT_MS,
  );
});

const EXIT_TIMEOUT_MS = 10_000;

describe("B10-02 boot with FLASH_MOCK=false and no key", () => {
  it(
    "exits non-zero and the fatal line carries the config reason without a stack trace",
    async () => {
      server = ServerProcess.start({ FLASH_MOCK: "false", FLASH_API_KEY: "" });
      const exit = await server.waitForExit(EXIT_TIMEOUT_MS);
      expect(exit.code).toBe(1);

      const fatal = server.lines.find((l) => l.msg === "backend failed to start");
      expect(fatal).toBeDefined();
      expect(fatal?.reason).toMatch(/FLASH_API_KEY is required when FLASH_MOCK=false/);
      expect(fatal).not.toHaveProperty("err");
      expect(server.lines.some((l) => l.msg === "backend listening")).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );
});

describe("B10-03 boot log shows the resolved config with secrets redacted", () => {
  const SECRET_FLASH = "dpka_boot_secret_value";
  const SECRET_OPENAI = "sk-boot-secret-value";

  it(
    'prints "[set]" or "[empty]" for every key and the raw values never appear in the output',
    async () => {
      server = ServerProcess.start({ FLASH_API_KEY: SECRET_FLASH, OPENAI_API_KEY: SECRET_OPENAI, COINGECKO_API_KEY: "" });
      const line = await server.waitForLine((l) => l.msg === "backend config", BOOT_TIMEOUT_MS);
      expect(line.config).toMatchObject({
        flashApiKey: "[set]",
        openaiApiKey: "[set]",
        coingeckoApiKey: "[empty]",
        flashMock: true,
        apiPrefix: "/api/v1",
        sqlitePath: server.sqlitePath,
      });
      await server.waitForLine((l) => l.msg === "backend listening", BOOT_TIMEOUT_MS);
      expect(server.output()).not.toContain(SECRET_FLASH);
      expect(server.output()).not.toContain(SECRET_OPENAI);
    },
    TEST_TIMEOUT_MS,
  );
});

const SHUTDOWN_LIMIT_MS = 2_000;

describe("B10-04 graceful shutdown", () => {
  it(
    "exits 0 within 2 s of SIGTERM and closes the SQLite handle (the WAL is checkpointed and removed)",
    async () => {
      server = ServerProcess.start();
      await server.waitForLine((l) => l.msg === "backend listening", BOOT_TIMEOUT_MS);
      // migrate() wrote through the WAL; SQLite deletes it only when the last handle closes cleanly.
      expect(existsSync(`${server.sqlitePath}-wal`)).toBe(true);

      const startedAt = performance.now();
      server.kill("SIGTERM");
      const exit = await server.waitForExit(SHUTDOWN_LIMIT_MS);
      const elapsedMs = performance.now() - startedAt;

      expect(exit.code).toBe(0);
      expect(elapsedMs).toBeLessThan(SHUTDOWN_LIMIT_MS);
      expect(server.lines.some((l) => l.msg === "shutting down" && l.signal === "SIGTERM")).toBe(true);
      expect(existsSync(`${server.sqlitePath}-wal`)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );
});
