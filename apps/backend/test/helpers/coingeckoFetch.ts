export interface RecordedCall {
  url: URL;
  headers: Headers;
  signal: AbortSignal | null | undefined;
}

function urlOf(input: string | URL | Request): URL {
  return new URL(input instanceof Request ? input.url : String(input));
}

/** A fetch stand-in that records each call and answers every one with the same canned reply. */
export function fetchReplying(status: number, body: unknown, contentType = "application/json", headers: Record<string, string> = {}) {
  const calls: RecordedCall[] = [];
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: urlOf(input), headers: new Headers(init?.headers), signal: init?.signal });
    return new Response(text, { status, headers: { "content-type": contentType, ...headers } });
  };
  return { calls, fetchImpl };
}

export function onlyCall(calls: RecordedCall[]): RecordedCall {
  const call = calls[0];
  if (!call || calls.length !== 1) throw new Error(`expected exactly one fetch call, got ${calls.length}`);
  return call;
}

export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the promise to reject");
}

// Observed rate-limit body, docs/notes/coingecko-api.md section 5.
export const RATE_LIMIT_BODY = {
  status: { error_code: 429, error_message: "You've exceeded the Rate Limit. Please visit https://www.coingecko.com/en/api/pricing" },
};
