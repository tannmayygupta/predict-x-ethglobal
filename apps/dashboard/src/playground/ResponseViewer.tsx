import { useState } from "react";
import { cx } from "@predictx/ui";
import { formatMs, isSuccess, type RequestResult } from "./http";

export const MONO = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" } as const;

export const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber focus-visible:outline-offset-2";
export const PANEL = "flex flex-col gap-4 rounded-card border border-rule bg-ink p-5";
export const GHOST_BTN = `h-8 rounded-button border border-rule px-3 text-13 font-semibold text-text hover:bg-ink2 ${FOCUS}`;

export function statusLabel(r: RequestResult): string {
  return r.status === null ? r.statusText : `${r.status} ${r.statusText}`.trim();
}

/** Response body is untrusted server text: it is only ever rendered as a text node. */
export function ResponseViewer({ result, busy }: { result: RequestResult | null; busy: boolean }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.body);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2000);
  }

  return (
    <section aria-label="Response" className={PANEL} aria-busy={busy}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold">Response</span>
          {result ? (
            <>
              <span className={cx("rounded-full border px-3 py-0.5 text-12 font-semibold", isSuccess(result) ? "border-yes text-yes" : "border-no text-no")}>{statusLabel(result)}</span>
              <span className="text-12 text-mute">{formatMs(result.ms)} · {result.bytes} B</span>
            </>
          ) : null}
        </div>
        <button type="button" className={GHOST_BTN} onClick={() => void copy()} disabled={!result}>
          {copied === "done" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy JSON"}
        </button>
      </div>
      <pre className="m-0 max-h-[420px] overflow-auto rounded-button bg-text p-4 text-12 text-page" style={{ ...MONO, lineHeight: "20px" }}>
        {busy ? "Sending..." : result ? result.body || "(empty body)" : "Send a request to see the response here."}
      </pre>
    </section>
  );
}
