import { useState } from "react";
import { cx } from "@predictx/ui";
import { DEFAULT_PARAMS, ENDPOINTS, buildPath, type Endpoint } from "./endpoints";
import { FOCUS, MONO, PANEL } from "./ResponseViewer";

interface Props {
  busy: boolean;
  onSend: (endpoint: Endpoint, path: string, body: string | undefined) => void;
}

const INPUT = `h-10 rounded-input border border-rule bg-ink2 px-3 text-13 text-text ${FOCUS}`;

export function EndpointList({ selectedId, onSelect }: { selectedId: string; onSelect: (e: Endpoint) => void }) {
  return (
    <section aria-label="Endpoints" className="flex flex-col gap-0.5 rounded-card border border-rule bg-ink p-3">
      <div className="px-3 py-2 text-12 font-semibold uppercase tracking-[0.08em] text-mute">Endpoints</div>
      {ENDPOINTS.map((e) => (
        <button
          key={e.id}
          type="button"
          aria-pressed={e.id === selectedId}
          onClick={() => onSelect(e)}
          className={cx("flex w-full items-center gap-3 rounded-button p-3 text-left text-14 text-text", FOCUS, e.id === selectedId ? "bg-ink2 font-semibold" : "hover:bg-ink2")}
        >
          <span className={cx("w-[44px] shrink-0 text-12", e.method === "GET" ? "text-yes" : "text-amber")} style={MONO}>{e.method}</span>
          <span className="min-w-0 break-all">{e.path}</span>
        </button>
      ))}
      <p className="m-0 mt-2 border-t border-rule px-3 pb-1 pt-3 text-12 text-mute">Order endpoints are off on this server: quotes only.</p>
    </section>
  );
}

export function RequestBuilder({ endpoint, busy, onSend }: Props & { endpoint: Endpoint }) {
  const [values, setValues] = useState<Record<string, string>>(DEFAULT_PARAMS);
  const [body, setBody] = useState(endpoint.body ?? "");
  const fields = [...endpoint.params, ...(endpoint.query ? [endpoint.query] : [])];
  const path = buildPath(endpoint, values);

  return (
    <section aria-label="Request" className={PANEL}>
      <form
        className="flex gap-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          onSend(endpoint, path, endpoint.method === "POST" ? body : undefined);
        }}
      >
        <div className="flex h-12 min-w-0 flex-1 items-center rounded-button border border-rule bg-ink2 px-4 text-13" style={MONO}>
          <span className={cx("mr-3", endpoint.method === "GET" ? "text-yes" : "text-amber")}>{endpoint.method}</span>
          <span className="min-w-0 truncate" title={path}>{path}</span>
        </div>
        <button type="submit" disabled={busy} className={`h-12 rounded-button bg-amber px-6 font-semibold text-amber-ink disabled:opacity-60 ${FOCUS}`}>
          {busy ? "Sending..." : "Send"}
        </button>
      </form>
      <p className="m-0 text-13 text-mute">{endpoint.hint}</p>
      {fields.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {fields.map((name) => (
            <label key={name} className="flex min-w-[200px] flex-1 flex-col gap-1.5 text-13 text-mute">
              {name}
              <input
                type="text"
                value={values[name] ?? ""}
                onChange={(ev) => setValues((v) => ({ ...v, [name]: ev.target.value }))}
                className={INPUT}
                style={MONO}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          ))}
        </div>
      ) : null}
      {endpoint.method === "POST" ? (
        <label className="flex flex-col gap-1.5 text-13 text-mute">
          JSON body
          <textarea
            value={body}
            onChange={(ev) => setBody(ev.target.value)}
            rows={9}
            spellCheck={false}
            className={`rounded-input border border-rule bg-ink2 p-3 text-13 text-text ${FOCUS}`}
            style={MONO}
          />
        </label>
      ) : null}
    </section>
  );
}
