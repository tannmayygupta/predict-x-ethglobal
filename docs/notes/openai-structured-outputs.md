# OpenAI Structured Outputs — research notes (2026-10-29)

Scope: the one `POST /insight` call in T-B05 (backend only, no tools, no tweet text, 300 max output
tokens, one application-level retry, static fallback with `degraded: true`). Facts below come from the
official docs and SDK source on 2026-10-29; the SDK behaviour was also verified by running
`openai@7.45.1` against an injected fake `fetch` (section 10).

## 1. Summary / what this means for PredictX

| Topic | Finding | Action |
| --- | --- | --- |
| SDK | `openai` latest is **7.45.1** (published 2026-10-27). | `pnpm add openai@^7.45.1` in `apps/backend`. |
| Node | SDK `engines.node` is `>=22.0.0`; README: "Node.js 22 is the minimum supported version", "Node.js 20 reached end of life on April 30, 2026 and is no longer supported." | **Conflict**: `docs/DECISIONS.md` says "Backend Node 20" and root `package.json` says `engines.node >=20`. Local toolchain is Node 24.19.0. A human must bump the decision to Node 22+ (24 recommended by OpenAI). |
| zod | SDK peer range is `zod@"^3.25 \|\| ^4.0"` and `openai/helpers/zod` does `require("zod/v4")`, a subpath that only exists from zod 3.25. Our `packages/shared` declares `^3.23.8`; the lockfile happens to resolve `zod@3.25.76`, so it works today, but `npm install openai zod@3.23.8` fails with ERESOLVE and a forced install throws `ERR_PACKAGE_PATH_NOT_EXPORTED` on import (verified). | Bump `packages/shared` (and backend) to `"zod": "^3.25.76"`. Keep `import { z } from "zod"` (zod 3 API); no code changes. |
| API | "While Chat Completions remains supported, Responses is recommended for all new projects." | Use `client.responses.parse` with `text.format` from `zodTextFormat`. |
| Reasoning | GPT-6 / GPT-5.6 models reason by default (`reasoning.effort` default `medium`); reasoning tokens count toward `max_output_tokens`, and a response may come back `incomplete` "before any visible output tokens are produced". `temperature` is only accepted when effort is `none`. | Send `reasoning: { effort: "none" }` with the 300-token budget; pick a model that supports `none` (gpt-6-luna, gpt-5.6-luna). |
| Retries | SDK default `maxRetries` is 2 (retries connection errors, 408, 409, 429, 5xx, and timeouts). | `maxRetries: 0` on the client; the backend does its single retry itself. |
| Model | Candidates in section 9. Cheapest non-deprecated: **`gpt-6-luna`** ($0.10 in / $0.50 out per 1M). | Human picks `OPENAI_MODEL` (DECISIONS open item). |

## 2. Sources

- npm registry record: https://registry.npmjs.org/openai/latest (`version`, `engines`, `peerDependencies`)
- SDK README: https://github.com/openai/openai-node/blob/main/README.md (Requirements, Retries, Timeouts, Custom fetch, Handling errors)
- SDK Node policy: https://github.com/openai/openai-node/blob/main/NODE_VERSION_POLICY.md
- SDK structured outputs doc: https://github.com/openai/openai-node/blob/main/docs/structured-outputs.md
- SDK helper doc (zod feature support): https://github.com/openai/openai-node/blob/main/docs/helpers.md
- Structured Outputs guide: https://developers.openai.com/api/docs/guides/structured-outputs (platform.openai.com/docs/* now 301-redirects to developers.openai.com/api/docs/*)
- Responses API reference: https://developers.openai.com/api/docs/api-reference/responses/create
- Responses vs Chat Completions: https://developers.openai.com/api/docs/guides/migrate-to-responses
- Reasoning guide: https://developers.openai.com/api/docs/guides/reasoning
- Latest-model guide (parameter restrictions): https://developers.openai.com/api/docs/guides/latest-model
- Models: https://developers.openai.com/api/docs/models , https://developers.openai.com/api/docs/models/gpt-6-luna , https://developers.openai.com/api/docs/models/gpt-5.6-luna
- Pricing: https://developers.openai.com/api/docs/pricing
- Deprecations: https://developers.openai.com/api/docs/deprecations
- Installed typings read directly: `node_modules/openai/client.d.ts` (`ClientOptions`), `resources/responses/responses.d.ts`, `core/error.d.ts`, `helpers/zod.d.ts`, `lib/ResponsesParser.d.ts`

## 3. Package and runtime

- `openai@7.45.1`, dist-tag `latest`. (Older `next`/`alpha`/`beta` tags point at 4.x/5.x pre-releases; ignore them.)
- `engines.node: ">=22.0.0"`. README support matrix: "Node.js 22 and 24 LTS. Node.js 22 is the minimum supported version." Policy doc: Node 24 is "Supported and recommended"; Node 22 retirement notice due by 2026-10-30, EOL 2027-04-30.
- TypeScript `>= 4.9`.
- `apiKey` defaults to `process.env.OPENAI_API_KEY`; `baseURL` defaults to `process.env.OPENAI_BASE_URL`. Pass both explicitly in the backend so tests cannot accidentally read the real env.

## 4. Responses API vs Chat Completions

Responses (recommended, use this):

```ts
const response = await client.responses.create({
  model: OPENAI_MODEL,
  instructions: "system text",
  input: "user text",
  text: {
    format: {
      type: "json_schema",
      name: "insight",          // a-z A-Z 0-9 _ - ; max 64 chars
      schema: { /* strict JSON Schema */ },
      strict: true,
    },
  },
  max_output_tokens: 300,
});
const json = JSON.parse(response.output_text); // you validate it yourself
```

`client.responses.parse(...)` with `text: { format: zodTextFormat(Schema, "name") }` does the same call and
adds `response.output_parsed` (typed, validated by zod). A raw `{ type: "json_schema" }` format passed to
`parse` is `JSON.parse`d and typed `unknown`; `create` never parses.

Chat Completions (legacy shape, "supported indefinitely", for reference only):

```ts
const completion = await client.chat.completions.parse({
  model, messages: [{ role: "system", content: "..." }, { role: "user", content: "..." }],
  response_format: zodResponseFormat(Schema, "insight"), // {type:"json_schema", json_schema:{name, schema, strict:true}}
  max_tokens: 300,
});
completion.choices[0]?.message.parsed; // or .content / .refusal
```

Migration guide mapping: `messages` -> `input` (+ `instructions`), `response_format` -> `text.format`,
`choices[0].message.content` -> `output_text` / iterate `output`, `max_tokens` -> `max_output_tokens`.
JSON mode (`{ type: "json_object" }`) is "Not recommended for gpt-4o and newer models"; only
`json_schema` + `strict: true` guarantees schema adherence.

## 5. Strict-schema rules (Structured Outputs guide, "Supported schemas")

- Root must be an object (no root `anyOf`). Every object: all properties in `required`, `additionalProperties: false`.
- Optional value = required nullable field, e.g. `"type": ["string", "null"]` (zod: `.nullable()`, never plain `.optional()` — the SDK helper throws on `.optional()`).
- Types: string, number, integer, boolean, object, array, enum, anyOf; `$ref`/`$defs` and recursion OK.
- Supported constraints: string `pattern`, `format` (date-time, date, email, uuid, ...); number `minimum`/`maximum`/`multipleOf`; array `minItems`/`maxItems`. (`minLength`/`maxLength`, `pattern`, `minimum`... are not supported on fine-tuned models.)
- Unsupported: `allOf`, `not`, `if/then/else`, `dependentRequired`, `dependentSchemas`. Using one with `strict: true` returns an error.
- Limits: 5,000 properties, 10 nesting levels, 1,000 enum values, 120,000 chars of names/enum/const strings.
- Output keys follow schema order. Descriptions must be in the schema (`.describe()`); TS comments are not sent.

## 6. `zodTextFormat` and zod versions

- `import { zodTextFormat } from "openai/helpers/zod"`; signature `zodTextFormat(zodObject, name, props?: { description? })`.
- Docstring: "Schemas from `zod/v3`, `zod/v4`, and `zod/v4-mini` are supported." With `zod@3.25.x`, `import { z } from "zod"` is the v3 API and works; `zod/v4` is also available from the same package.
- Empirical (zod 3.25.76, v3 API): `.nullable()` is sent as `anyOf: [{...}, {type:"null"}]`, `.describe()` -> `description`, `.max(n)` on strings -> `maxLength`, `.min/.max` on numbers -> `minimum/maximum`, `.regex` -> `pattern`, `z.literal("buy")` -> `const`, `.default()` -> `default` but still required, `.optional()` -> throws before any request. Note: the object `zodTextFormat` *returns* shows `nullable: true`; the SDK normalises it on send, so inspect the request body, not the helper's return value.
- Zod v3 strict helpers reject refinements, transforms, pipelines, intersections, ambiguous unions, `Date`/`BigInt`/`Map`/`Set`. Keep money as decimal strings (matches `DecimalString` in `packages/shared`).
- Our `InsightResponse` (shared schema) adds `symbol`, `degraded`, `disclaimer` and `side: "buy"` — keep a separate, smaller model-facing schema (`InsightDraft` below) and map into `InsightResponse` in the backend.

## 7. Request parameters that matter here

| Param | Where | Facts (typings / docs) |
| --- | --- | --- |
| `max_output_tokens` | request body | "An upper bound for the number of tokens that can be generated for a response, including visible output tokens and reasoning tokens." When hit: `status: "incomplete"`, `incomplete_details.reason: "max_output_tokens"`, and this "might occur before any visible output tokens are produced". |
| `temperature` | request body | "between 0 and 2"; "We generally recommend altering this or `top_p` but not both." Latest-model guide: "When reasoning effort is not `none`, remove `temperature`, `top_p`, and `top_logprobs`." |
| `reasoning.effort` | request body | `'none' \| 'minimal' \| 'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'`. Default `medium` on GPT-5.6 and GPT-6 Luna/Sol. `none` is supported by GPT-6.1 Terra, GPT-6 Sol, GPT-6 Luna, GPT-5.6 Luna; **not** by GPT-6 Astra / GPT-6.1 Sol (HTTP 400). |
| `store` | request body | "Defaults to true when omitted" (kept >= 30 days). Set `store: false` for this one-shot call. |
| `timeout` | `new OpenAI({ timeout })` or per-call 2nd arg `{ timeout }` | Milliseconds; default 10 minutes; throws `APIConnectionTimeoutError`; "request timeouts are retried by default". Node's fetch has its own ~5 min header/body timeouts (only matters if you go above that). |
| `maxRetries` | `new OpenAI({ maxRetries })` or per-call 2nd arg `{ maxRetries }` | Default 2 with exponential backoff; retried: connection errors, 408, 409, 429, >= 500, timeouts. Set **0** so the backend's single retry is the only retry. |
| `fetch` | `new OpenAI({ fetch })` | "Specify a custom `fetch` function implementation. If not provided, we expect that `fetch` is defined globally." Called as `fetch(url, init)`; honours `init.signal` for timeouts. `fetchOptions` adds `RequestInit` extras without replacing fetch. |
| `baseURL` | `new OpenAI({ baseURL })` | "Override the default base URL for the API... Defaults to process.env['OPENAI_BASE_URL']." Requests go to `${baseURL}/responses`. |

## 8. Errors and reading the result

Error classes (all `import`able from `"openai"`, all extend `APIError` except where noted; `err.status` holds the HTTP code):

| Status | Class |
| --- | --- |
| 400 | `BadRequestError` |
| 401 | `AuthenticationError` |
| 403 | `PermissionDeniedError` |
| 404 | `NotFoundError` |
| 409 | `ConflictError` |
| 422 | `UnprocessableEntityError` |
| 429 | `RateLimitError` |
| >= 500 | `InternalServerError` |
| n/a | `APIConnectionError`; `APIConnectionTimeoutError extends APIConnectionError` (timeouts) |

`responses.parse` additionally throws a `ZodError` when a *completed* response does not satisfy the schema
(verified). Refusals and incomplete responses do **not** throw.

Reading the response:

- `response.output_text` — SDK convenience: concatenation of every `output_text` item (`""` on refusal).
- `response.output_parsed` — first successfully parsed text item, or `null`. "Incomplete responses are left unparsed so their status and `incomplete_details` remain" inspectable.
- Refusal: an output item with `type: "message"` whose `content[]` holds `{ type: "refusal", refusal: "I'm sorry, I cannot assist with that request." }`.
- Truncation: `response.status === "incomplete" && response.incomplete_details?.reason === "max_output_tokens"`; `reason: "content_filter"` also exists. Only trust JSON when `status === "completed"`.

## 9. Model candidates for a cheap, fast structured-output call

Standard-tier prices per 1M tokens (input / cached input / output), from the pricing page on 2026-10-29. Batch and Flex are ~50% of these; "Fast" ~2x. All listed models support Structured Outputs and the Responses API.

| Model id | In / cached / out | Status (deprecations page) | Notes |
| --- | --- | --- | --- |
| **`gpt-6-luna`** | $0.10 / $0.01 / $0.50 | current; named replacement for gpt-4o-mini, gpt-4.1-mini, gpt-5.4-nano | "Our most efficient model for focused, high-volume tasks." 1.05M context, 128K max output, cutoff 2026-05-18, `reasoning.effort` none..max. **Recommended default.** |
| `gpt-5.6-luna` | $0.20 / $0.02 / $1.20 | current; replacement for gpt-5-nano, gpt-4.1-nano | Same limits, cutoff 2026-02-16, supports effort `none`. |
| `gpt-6.1-terra` | $1.00 / $0.05 / $5.00 | current | Supports effort `none`; pricier than needed. |
| `gpt-5.4-nano` | $0.20 / $0.02 / $1.25 | deprecated, shutdown 2027-04-01 | Avoid for new code. |
| `gpt-5-nano` | $0.05 / $0.005 / $0.40 | deprecated, shutdown **2026-12-11** | Cheapest on paper, dies in six weeks. |
| `gpt-5-mini` | $0.25 / $0.025 / $2.00 | deprecated, shutdown 2026-12-11 | |
| `gpt-4o-mini` | $0.15 / $0.075 / $0.60 | deprecated, shutdown 2027-01-14 | |
| `gpt-4.1-nano` | $0.10 / $0.025 / $0.40 | **shut down 2026-10-23** | Do not use. |
| `gpt-6-astra` | $10.00 / $1.00 / $50.00 | current | The guide's generic "start here" model; 100x too expensive for this call and does not support effort `none`. |

For a 300-output-token call the whole request costs well under $0.001 on `gpt-6-luna`.

## 10. Minimal verified example (SDK 7.45.1, zod 3.25.76, injected fetch, `maxRetries: 0`)

Type-checked with `tsc --strict` and executed against a fake `fetch` (happy path, refusal, incomplete-then-retry,
401, 429 with exactly one SDK attempt, timeout, schema violation). Sketch for `apps/backend/src/insight/openai.ts`:

```ts
import OpenAI, { APIConnectionTimeoutError, APIError, AuthenticationError, RateLimitError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

/** Model-facing schema. Every field is required; "absent" is expressed as null. */
export const InsightDraft = z.object({
  tip: z.string().max(400).describe("One short, plain-English sentence for a retail trader."),
  bias: z.enum(["bullish", "bearish", "neutral"]),
  confidence: z.enum(["low", "medium", "high"]),
  suggestedLimit: z
    .object({
      priceUsd: z.string().regex(/^\d+(\.\d+)?$/).describe("Decimal string, USD."),
      reason: z.string().max(160),
    })
    .nullable()
    .describe("Null when a limit order makes no sense right now."),
});
export type InsightDraft = z.infer<typeof InsightDraft>;

export interface OpenAIClientOptions {
  apiKey: string;
  /** Inject a fake in unit tests so nothing touches the network. */
  fetch?: typeof globalThis.fetch;
  /** Point at a stub server in tests, or a proxy. */
  baseURL?: string;
  timeoutMs?: number;
}

export function createOpenAIClient(options: OpenAIClientOptions): OpenAI {
  return new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    fetch: options.fetch,
    maxRetries: 0, // the application does exactly one retry itself
    timeout: options.timeoutMs ?? 8_000,
  });
}

export type InsightFailure = "auth" | "rate_limit" | "timeout" | "refusal" | "incomplete" | "invalid" | "api" | "unknown";
export type InsightResult = { ok: true; value: InsightDraft } | { ok: false; reason: InsightFailure; detail?: string };

export async function requestInsightOnce(
  client: OpenAI,
  args: { model: string; instructions: string; input: string },
): Promise<InsightResult> {
  try {
    const response = await client.responses.parse({
      model: args.model,
      instructions: args.instructions,
      input: args.input,
      text: { format: zodTextFormat(InsightDraft, "insight") },
      // GPT-6 / GPT-5.6 models reason by default and reasoning tokens count against
      // max_output_tokens. `none` keeps the budget for the answer and is also the only
      // mode in which `temperature` is accepted on these models.
      reasoning: { effort: "none" },
      temperature: 0.2,
      max_output_tokens: 300,
      store: false,
    });

    if (response.status === "incomplete") {
      return { ok: false, reason: "incomplete", detail: response.incomplete_details?.reason ?? undefined };
    }
    for (const item of response.output) {
      if (item.type !== "message") continue;
      for (const part of item.content) {
        if (part.type === "refusal") return { ok: false, reason: "refusal", detail: part.refusal };
      }
    }
    if (response.output_parsed === null) return { ok: false, reason: "invalid", detail: "no parsed output" };
    return { ok: true, value: response.output_parsed };
  } catch (err: unknown) {
    if (err instanceof AuthenticationError) return { ok: false, reason: "auth" };
    if (err instanceof RateLimitError) return { ok: false, reason: "rate_limit" };
    if (err instanceof APIConnectionTimeoutError) return { ok: false, reason: "timeout" };
    if (err instanceof APIError) return { ok: false, reason: "api", detail: `${err.status ?? "?"} ${err.message}` };
    if (err instanceof z.ZodError) return { ok: false, reason: "invalid", detail: err.message };
    return { ok: false, reason: "unknown", detail: err instanceof Error ? err.message : String(err) };
  }
}

const RETRYABLE: ReadonlySet<InsightFailure> = new Set(["rate_limit", "timeout", "incomplete", "invalid", "api", "unknown"]);

/** One attempt plus one application-level retry; auth errors and refusals are final. */
export async function requestInsight(client: OpenAI, args: Parameters<typeof requestInsightOnce>[1]): Promise<InsightResult> {
  const first = await requestInsightOnce(client, args);
  if (first.ok || !RETRYABLE.has(first.reason)) return first;
  return requestInsightOnce(client, args);
}
```

Test-side fake `fetch` (Vitest-ready; the SDK only needs a `Response` back and respects `init.signal`):

```ts
function fakeFetch(handler: (attempt: number) => { status: number; body: unknown }) {
  const calls: { url: string; body: unknown; headers: Headers }[] = [];
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    const { status, body } = handler(calls.length);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

// A completed Responses payload the SDK will parse:
const completed = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  id: "resp_1", object: "response", created_at: 0, status: "completed", model: "m",
  incomplete_details: null, error: null,
  output: [{ id: "msg_1", type: "message", role: "assistant", status: "completed", content }],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, ...extra,
});
// success:    completed([{ type: "output_text", text: JSON.stringify(draft), annotations: [] }])
// refusal:    completed([{ type: "refusal", refusal: "I can't help with that." }])
// truncated:  completed([{ type: "output_text", text: '{"tip":"Wa', annotations: [] }],
//                       { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })
// 401 body:   { error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } }
// 429 body:   { error: { message: "Rate limit reached", type: "rate_limit_error" } }
// timeout:    a fetch that never resolves and rejects with DOMException("aborted","AbortError") on init.signal "abort"
```

Assertions that held: request URL is `${baseURL}/responses`; `Authorization: Bearer <key>`; body has
`text.format.{type:"json_schema", name, strict:true, schema.additionalProperties:false}`,
`reasoning.effort:"none"`, `max_output_tokens:300`, `store:false`; 401 -> `AuthenticationError`, 429 ->
`RateLimitError` with **one** fetch call (control: default `maxRetries` made three), timeout ->
`APIConnectionTimeoutError`; refusal/incomplete give `output_parsed === null` without throwing; a completed
response that breaks the schema throws `ZodError`.

## 11. Open items for a human

- Choose `OPENAI_MODEL` (recommendation: `gpt-6-luna`; `gpt-5.6-luna` as the fallback choice).
- Approve Node 22+ (24 recommended) for the backend and update `docs/DECISIONS.md` + root `engines`.
- Approve the zod range bump to `^3.25.76` in `packages/shared` (already what the lockfile resolves).
- Confirm with a real key that `temperature` is accepted alongside `reasoning.effort: "none"` on the chosen model (official text says to remove it only when effort is not `none`; third-party reports say the API returns `unsupported_value` otherwise). If it is rejected, drop `temperature` — the schema and `effort: "none"` already make the call deterministic enough.
