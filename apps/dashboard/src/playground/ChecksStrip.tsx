import { useState } from "react";
import { cx } from "@predictx/ui";
import { FOCUS, MONO } from "./ResponseViewer";
import { SLOW_MS, formatMs, isSuccess, type RequestResult } from "./http";
import type { HttpMethod } from "./endpoints";

const CHECKS = ["/health", "/tokens", "/market/ETH", "/pools"];

type Run = (method: HttpMethod, path: string, body?: string) => Promise<RequestResult>;

function dotClass(r: RequestResult | undefined): string {
  if (!r) return "bg-rule";
  if (!isSuccess(r)) return "bg-no";
  return r.ms > SLOW_MS ? "border-2 border-no bg-transparent" : "bg-yes";
}

/** Smoke test of the four read endpoints. A hollow dot means it answered but took longer than 2 s. */
export function ChecksStrip({ run }: { run: Run }) {
  const [results, setResults] = useState<Record<string, RequestResult>>({});
  const [running, setRunning] = useState(false);

  async function runAll() {
    setRunning(true);
    try {
      const all = await Promise.all(CHECKS.map((path) => run("GET", path)));
      setResults(Object.fromEntries(all.map((r) => [r.path, r])));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section aria-label="Health checks" className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-rule bg-ink px-5 py-4">
      <div className="flex flex-wrap items-center gap-5">
        <span className="font-semibold">Checks</span>
        {CHECKS.map((path) => {
          const r = results[path];
          return (
            <span key={path} className="inline-flex items-center gap-2 text-mute">
              <span className={cx("h-2 w-2 rounded-full", dotClass(r))} aria-hidden="true" />
              <span style={MONO}>{path}</span>
              <span>{r ? (r.status === null ? "network error" : `${r.status} · ${formatMs(r.ms)}${r.ms > SLOW_MS ? " (slow)" : ""}`) : "not run"}</span>
            </span>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => void runAll()}
        disabled={running}
        className={`h-10 rounded-button border border-rule px-4 font-semibold text-text hover:bg-ink2 disabled:opacity-60 ${FOCUS}`}
      >
        {running ? "Running..." : "Run all checks"}
      </button>
    </section>
  );
}
