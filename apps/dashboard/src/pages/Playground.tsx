import { useCallback, useState } from "react";
import { ChecksStrip } from "../playground/ChecksStrip";
import { ENDPOINTS, type Endpoint, type HttpMethod } from "../playground/endpoints";
import { sendRequest, type RequestResult } from "../playground/http";
import { EndpointList, RequestBuilder } from "../playground/RequestBuilder";
import { RequestLog } from "../playground/RequestLog";
import { MONO, ResponseViewer } from "../playground/ResponseViewer";
import { useRequestLog } from "../playground/useRequestLog";
import { apiBaseUrl } from "../services";

const FIRST_ENDPOINT = ENDPOINTS[0] as Endpoint;

/** Developer tool: calls the PredictX backend directly and keeps a log of every request made here. */
export function Playground() {
  const [endpoint, setEndpoint] = useState<Endpoint>(FIRST_ENDPOINT);
  const [result, setResult] = useState<RequestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const { entries, add, clear } = useRequestLog();

  const run = useCallback(
    async (method: HttpMethod, path: string, body?: string): Promise<RequestResult> => {
      const res = await sendRequest(apiBaseUrl, method, path, body);
      add(res);
      return res;
    },
    [add],
  );

  async function send(e: Endpoint, path: string, body: string | undefined) {
    setBusy(true);
    try {
      setResult(await run(e.method, path, body));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-[1100px] flex-col gap-6 px-4 py-8 min-[800px]:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 font-display text-28 font-bold">API playground</h1>
          <p className="m-0 mt-1 text-14 text-mute">Call the PredictX backend, read the raw response and keep a log of every request.</p>
        </div>
        <span className="max-w-full break-all rounded-full border border-rule px-3 py-1.5 text-12 text-mute" style={MONO} title="API base URL">{apiBaseUrl}</span>
      </div>
      <ChecksStrip run={run} />
      <div className="grid grid-cols-1 items-start gap-6 min-[1000px]:grid-cols-[280px_minmax(0,1fr)]">
        <EndpointList selectedId={endpoint.id} onSelect={setEndpoint} />
        <div className="flex min-w-0 flex-col gap-6">
          <RequestBuilder key={endpoint.id} endpoint={endpoint} busy={busy} onSend={(e, p, b) => void send(e, p, b)} />
          <ResponseViewer result={result} busy={busy} />
          <RequestLog entries={entries} selectedId={result?.id ?? null} onSelect={setResult} onClear={clear} />
        </div>
      </div>
    </main>
  );
}
