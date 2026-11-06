import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BASELINE_ENV } from "./env";

const require = createRequire(import.meta.url);
/** The runtime `pnpm start` uses (tsx src/server.ts), launched under the node binary that runs vitest. */
const TSX_CLI = require.resolve("tsx/cli");
const BACKEND_DIR = fileURLToPath(new URL("../..", import.meta.url));
const SERVER_ENTRY = join(BACKEND_DIR, "src", "server.ts");
/** server.ts loads the repo .env unless pointed elsewhere; boot tests must see only what they pass. */
const NO_ENV_FILE = join(BACKEND_DIR, "test", "helpers", ".env.does-not-exist");
const SQLITE_FILE = "boot.sqlite";

export type LogLine = Record<string, unknown> & { msg?: string };

export interface ExitStatus {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface HttpReply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** A real `src/server.ts` child process: the only place tests open a socket (B10-01). */
export class ServerProcess {
  readonly lines: LogLine[] = [];
  readonly sqlitePath: string;
  private readonly dir: string;
  private readonly child: ChildProcess;
  private readonly chunks: string[] = [];
  private readonly listeners = new Set<(line: LogLine) => void>();
  private pending = "";
  private readonly exited: Promise<ExitStatus>;

  private constructor(env: Record<string, string>) {
    this.dir = mkdtempSync(join(tmpdir(), "predictx-boot-"));
    this.sqlitePath = join(this.dir, SQLITE_FILE);
    this.child = spawn(process.execPath, [TSX_CLI, SERVER_ENTRY], {
      cwd: BACKEND_DIR,
      env: { ...process.env, ...BASELINE_ENV, ENV_FILE: NO_ENV_FILE, PORT: "0", SQLITE_PATH: this.sqlitePath, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child.stdout?.on("data", (chunk: Buffer) => this.ingest(chunk));
    this.child.stderr?.on("data", (chunk: Buffer) => this.ingest(chunk));
    this.exited = new Promise((resolve) => {
      this.child.once("exit", (code, signal) => resolve({ code, signal }));
    });
  }

  static start(env: Record<string, string> = {}): ServerProcess {
    return new ServerProcess(env);
  }

  /** Everything the process wrote to stdout and stderr, for "never contains the secret" assertions. */
  output(): string {
    return this.chunks.join("");
  }

  /** Resolves with the first log line matching `predicate`; rejects when the process exits or the wait expires first. */
  waitForLine(predicate: (line: LogLine) => boolean, timeoutMs: number): Promise<LogLine> {
    const found = this.lines.find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`no matching log line within ${timeoutMs} ms; output so far:\n${this.output()}`));
      }, timeoutMs);
      const onLine = (line: LogLine): void => {
        if (!predicate(line)) return;
        cleanup();
        resolve(line);
      };
      const onExit = (): void => {
        cleanup();
        reject(new Error(`process exited before a matching log line; output:\n${this.output()}`));
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        this.listeners.delete(onLine);
        this.child.off("exit", onExit);
      };
      this.listeners.add(onLine);
      this.child.once("exit", onExit);
    });
  }

  waitForExit(timeoutMs: number): Promise<ExitStatus> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`process still running after ${timeoutMs} ms`)), timeoutMs);
      void this.exited.then((status) => {
        clearTimeout(timer);
        resolve(status);
      });
    });
  }

  kill(signal: NodeJS.Signals): void {
    this.child.kill(signal);
  }

  /** Always called from afterEach: a leaked child would keep the vitest worker alive. */
  async stop(): Promise<void> {
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill("SIGKILL");
      await this.exited;
    }
    rmSync(this.dir, { recursive: true, force: true });
  }

  private ingest(chunk: Buffer): void {
    const text = chunk.toString("utf8");
    this.chunks.push(text);
    const parts = (this.pending + text).split("\n");
    this.pending = parts.pop() ?? "";
    for (const part of parts) {
      if (part.trim().length === 0) continue;
      const line = parseLine(part);
      this.lines.push(line);
      for (const listener of this.listeners) listener(line);
    }
  }
}

/** pino writes one JSON object per line; anything else (a tsx crash trace) is kept as a raw message. */
function parseLine(text: string): LogLine {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) return parsed as LogLine;
  } catch {
    // not JSON: fall through to the raw form
  }
  return { msg: text };
}

/** Plain node:http so the throwing fetch stub from test/setup.ts stays in force for every other test. */
export function httpGet(port: number, path: string, headers: Record<string, string> = {}): Promise<HttpReply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
      const body: Buffer[] = [];
      res.on("data", (chunk: Buffer) => body.push(chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(body).toString("utf8") }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}
