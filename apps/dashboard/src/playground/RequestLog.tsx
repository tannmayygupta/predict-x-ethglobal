import { useState } from "react";
import { cx } from "@predictx/ui";
import { formatMs, isSuccess, type RequestResult } from "./http";
import { FOCUS, GHOST_BTN, MONO, PANEL } from "./ResponseViewer";

type Filter = "all" | "success" | "errors";
const FILTERS: Filter[] = ["all", "success", "errors"];
const LABEL: Record<Filter, string> = { all: "All", success: "Success", errors: "Errors" };

interface Props {
  entries: RequestResult[];
  selectedId: string | null;
  onSelect: (entry: RequestResult) => void;
  onClear: () => void;
}

export function RequestLog({ entries, selectedId, onSelect, onClear }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const okCount = entries.filter(isSuccess).length;
  const counts: Record<Filter, number> = { all: entries.length, success: okCount, errors: entries.length - okCount };
  const shown = entries.filter((e) => filter === "all" || (filter === "success") === isSuccess(e));

  return (
    <section aria-label="Request log" className={PANEL}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-semibold">Request log</span>
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Filter log" className="flex gap-1 rounded-button bg-ink2 p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={cx("h-7 rounded-input px-3 text-13 font-semibold", FOCUS, filter === f ? "bg-ink text-text" : "text-mute hover:text-text")}
              >
                {LABEL[f]} {counts[f]}
              </button>
            ))}
          </div>
          <button type="button" className={GHOST_BTN} onClick={onClear} disabled={entries.length === 0}>Clear</button>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="m-0 text-13 text-mute">{entries.length === 0 ? "No requests yet. Every request made on this page is listed here." : "Nothing matches this filter."}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0 text-12" style={MONO}>
          {shown.map((e) => (
            <li key={e.id} className="border-t border-rule">
              <button
                type="button"
                onClick={() => onSelect(e)}
                aria-current={e.id === selectedId}
                className={cx("flex w-full items-center gap-3 px-1 py-3 text-left text-text", FOCUS, e.id === selectedId ? "bg-ink2" : "hover:bg-ink2")}
                style={MONO}
              >
                <span className="w-[64px] shrink-0 text-mute">{new Date(e.at).toLocaleTimeString("en-GB")}</span>
                <span className={cx("w-[40px] shrink-0", e.method === "GET" ? "text-yes" : "text-amber")}>{e.method}</span>
                <span className="min-w-0 flex-1 break-all">{e.path}</span>
                <span className={cx("shrink-0", isSuccess(e) ? "text-yes" : "text-no")}>{e.status ?? "ERR"}</span>
                <span className="w-[56px] shrink-0 text-right text-mute">{formatMs(e.ms)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 text-12 text-mute">Kept in memory only, newest first, last 50 requests. Click a row to reload its response.</p>
    </section>
  );
}
