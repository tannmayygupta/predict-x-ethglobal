# Backend test plan (TDD)

Scope: every Part B backend task in `docs/TASKS.md` (T-B01, T-B02, T-B03, T-B04, T-B05, T-B07, T-B10) plus the Gate 0 script (T-003). Contracts (T-B06), CRE (T-B08) and seeding (T-B09) are chain work with their own Foundry and CRE checks and are referenced here only where the backend reads them.

This file is the TDD backlog. `docs/TASKS.md` stays the status tracker; `docs/WORKLOG.md` records runs. Each row below is one test. Tick the box only when the test exists, was seen red, and is green.

## 0. Rules of the loop

1. Pick the next unticked row in task order. Write the test. Run it. It must fail for the right reason (not a syntax error, not a missing import).
2. Write the smallest code that makes it green. No code without a red test demanding it.
3. Refactor with the suite green. Re-run.
4. Tick the row. When a task's rows are all ticked and its `done when` in `docs/TASKS.md` holds, set the task `done` and append to `docs/WORKLOG.md`.
5. Every response assertion goes through the shared zod schema from `@predictx/shared` (`Schema.parse(body)`), never a hand-written shape. Every error assertion parses with `ApiError` and checks `error.code`.
6. No test touches the network. Every external service sits behind an adapter interface with a fake. Live tests are a separate script, gated on env keys, and never part of `pnpm test`.
7. No `any`, no `console.log`, no TODO without a task id (RULES.md definition of done).

## 1. Architecture for testability

```
apps/backend/
  src/
    app.ts              buildApp(deps): FastifyInstance   <- all tests use this, never the listener
    server.ts           reads env, builds real deps, listens  <- not unit tested
    config.ts           zod-parsed env -> Config
    errors.ts           AppError(code, message, http); error handler -> ApiError shape
    plugins/
      cors.ts, rateLimit.ts, validation.ts (zod preHandler), logging.ts
    db/
      sqlite.ts         open(path) -> Db; migrate(); three tables only
      quotes.ts, orders.ts, insights.ts   repositories
    clients/
      coingecko.ts      interface PriceSource { simplePrice(ids): ... }
      flash.ts          interface FlashClient { quote, submit, status }; MockFlashClient; HttpFlashClient
      openai.ts         interface InsightModel { complete(input): ... }; HttpInsightModel
      chain.ts          interface PoolReader { poolCount, getPool, getPosition }; ViemPoolReader
    services/
      market.ts, insight.ts, flash.ts, pools.ts
    routes/
      health.ts, tokens.ts, market.ts, insight.ts, flash.ts, pools.ts
    util/
      cache.ts          TTL memory cache with injectable clock
      clock.ts          now(): number (unix seconds), injectable
  test/
    helpers/
      build.ts          buildTestApp(overrides) -> { app, db, clock, fakes }
      fakes.ts          FakePriceSource, FakeFlash, FakeInsightModel, FakePoolReader, FakeClock
    fixtures/
      flash/*.json      recorded Flash request and response bodies (from Gate 0)
      openai/*.json     recorded Structured Output replies
    <one file per route or module, named after the behaviour>
  TEST_PLAN.md
```

Dependency injection is the whole trick: `buildApp({ config, db, clock, priceSource, flash, insightModel, poolReader })`. Tests pass fakes; `server.ts` passes real ones. Time is never read from `Date.now()` inside src; it comes from `clock.now()`.

Test runner: Vitest. HTTP: `app.inject()` from Fastify (no port). DB: `better-sqlite3` on `:memory:` per test file.

Scripts in `apps/backend/package.json`:

| script | command | runs in CI / `pnpm test` |
| --- | --- | --- |
| `test` | `vitest run` | yes |
| `test:watch` | `vitest` | no |
| `test:live` | `vitest run --config vitest.live.config.ts` | no, needs keys |
| `typecheck` | `tsc --noEmit` | yes |
| `dev` | `tsx watch src/server.ts` | no |
| `build` | `tsc -p tsconfig.build.json` | yes |

## 2. T-B01 Backend scaffold

reqs: FR-B-05, FR-B-06, FR-B-07. done when: health works, a validation failure returns `BAD_REQUEST` in the shared shape, tests pass.

### 2.1 Config (`test/config.test.ts`)
- [x] B01-01 `loadConfig(env)` with the `.env.example` values parses and returns typed config with `apiPrefix = "/api/v1"`.
- [x] B01-02 Missing `PORT` defaults to 8787; `FLASH_MOCK` accepts `"true"`/`"false"` strings and yields booleans.
- [x] B01-03 `ALLOWED_ORIGINS` splits on comma and trims whitespace.
- [x] B01-04 `FLASH_MOCK=false` with empty `FLASH_API_KEY` throws a descriptive error (fail fast at boot, not at first request).
- [x] B01-05 Invalid `POOL_ADDRESS` (not 0x + 40 hex) throws.

### 2.2 Health and app shape (`test/health.test.ts`)
- [x] B01-06 `GET /api/v1/health` returns 200 and `{ ok: true }` exactly.
- [x] B01-07 `GET /health` without the prefix returns 404 in `ApiError` shape with code `NOT_FOUND`.
- [x] B01-08 Unknown route under the prefix returns 404 `NOT_FOUND` in `ApiError` shape.

### 2.3 Error handler (`test/errors.test.ts`)
- [x] B01-09 A route throwing `AppError("UNSUPPORTED_TOKEN", msg)` yields HTTP 400 and `ApiError.parse(body).error.code === "UNSUPPORTED_TOKEN"`. (Register a throwaway test route via `buildTestApp({ extraRoutes })`.)
- [x] B01-10 Each `ErrorCode` maps to the HTTP status in API_CONTRACT section 1 (table-driven over all eight codes).
- [x] B01-11 An unexpected `Error` yields 500, code `INTERNAL`, and the message does not leak the stack or internal text (generic message).
- [x] B01-12 Malformed JSON body yields 400 `BAD_REQUEST`.

### 2.4 Validation plugin (`test/validation.test.ts`)
- [x] B01-13 A test route with `body: InsightRequest`: posting `{}` returns 400 `BAD_REQUEST` and the message names the failing path (`symbol`).
- [x] B01-14 Posting a valid body reaches the handler with the parsed (defaulted) value, for example `slippage` default `"0.01"` when the schema is `FlashQuoteRequest`.
- [x] B01-15 Response validation: a handler returning a body that fails its declared response schema yields 500 `INTERNAL` and logs the zod issue (guards FR-B-01 at runtime in dev and test; may be disabled by config in prod).

### 2.5 CORS (`test/cors.test.ts`)
- [x] B01-16 Request with `Origin: https://x.com` (in allowlist) gets `access-control-allow-origin: https://x.com`.
- [x] B01-17 Request with `Origin: https://evil.example` gets no `access-control-allow-origin` header and the response is otherwise normal (FR-B-06 acceptance).
- [x] B01-18 Preflight `OPTIONS` for `POST /insight` from an allowed origin returns 204 with allow-methods including POST and allow-headers including content-type.

### 2.6 Rate limit (`test/rateLimit.test.ts`)
- [x] B01-19 61st `GET /tokens` from one IP within a minute returns 429 `RATE_LIMITED` in `ApiError` shape; the 60th returns 200.
- [x] B01-20 11th `POST /insight` from one IP within a minute returns 429; the 10th does not (run with a fake insight model so this test is pure).
- [x] B01-21 Limits are per IP: a second IP (`x-forwarded-for` or `remoteAddress` override via inject) is not affected by the first IP's count.
- [x] B01-22 Limit window resets after 60 s using the injectable clock (no real sleeping).

### 2.7 SQLite (`test/db.test.ts`)
- [x] B01-23 `migrate()` on an empty `:memory:` db creates exactly three tables: `quotes`, `orders`, `insights` (query `sqlite_master`). FR-B-05: no `pools` table.
- [x] B01-24 `migrate()` is idempotent (second call does not throw or duplicate).
- [x] B01-25 `quotes` repo: `insert(quote, raw)` then `get(quoteId)` round-trips the full `FlashQuoteResponse` and the stored raw Flash typed-data strings byte-for-byte.
- [x] B01-26 `orders` repo: `insert`, `get`, `updateStatus` round-trip; `get` of unknown id returns `undefined`.
- [x] B01-27 `insights` repo: `put(key, response, expiresAt)` then `get(key, now)` returns it before expiry and `undefined` at or after expiry.

### 2.8 Logging (`test/logging.test.ts`)
- [x] B01-28 Each request produces one pino log line with `reqId`, method, url and status (capture via a pino destination stream).
- [x] B01-29 Request logs never contain `x-definitive-api-key`, `FLASH_API_KEY` or `OPENAI_API_KEY` values (redaction configured; test by sending a header and asserting the value is absent from the stream).

## 3. T-B02 Tokens and market endpoints

reqs: FR-B-01. done when: both endpoints parse with their schemas; tests cover happy and unsupported paths.

### 3.1 Tokens (`test/tokens.test.ts`)
- [x] B02-01 `GET /tokens` returns 200 and `TokensResponse.parse(body)` succeeds.
- [x] B02-02 Body equals `packages/shared/tokens.json` content exactly (deep equal), so the allowlist has one source.
- [x] B02-03 Every token with `flashSupported: true` has non-null `address`, `flashChainId` and `decimals` (data invariant test over the JSON).
- [x] B02-04 Response carries `cache-control: public, max-age=300`.

### 3.2 Market (`test/market.test.ts`)
- [x] B02-05 `GET /market/ETH` with `FakePriceSource` returning `{ ethereum: { usd: 2451.12, usd_24h_change: -1.8 } }` yields 200, `Market.parse(body)` succeeds, `priceUsd === "2451.12"`, `change24hPct === -1.8`, `updatedAt === clock.now()`.
- [x] B02-06 `address` and `flashChainId` come from `tokens.json` for that symbol, not from CoinGecko.
- [x] B02-07 Symbol lookup is case-insensitive: `/market/eth` returns `symbol: "ETH"`.
- [x] B02-08 `GET /market/DOGE` (not in allowlist) returns 400 `UNSUPPORTED_TOKEN`.
- [x] B02-09 Price formatting: a source value of `0.000012` becomes `DecimalString` `"0.000012"`, never `"1.2e-5"`; `1234.5` becomes `"1234.5"`. Table-driven over small, large and integer values.
- [x] B02-10 Cache: two requests within 30 s call the price source once; a request at +31 s calls it again (fake clock).
- [x] B02-11 Cache is per symbol: `/market/ETH` then `/market/BTC` are two source calls.
- [x] B02-12 Price source failure (fake throws) with a warm cache entry older than 30 s serves the stale entry and sets `updatedAt` to the cached time (stale-while-error, supports NFR-01 hover latency).
- [x] B02-13 Price source failure with no cache returns 502 in `ApiError` shape with code `INTERNAL` (there is no dedicated upstream code for CoinGecko in the contract; message says "price source unavailable").
- [x] B02-14 Price source returns the id missing (empty object) yields the same as B02-13.

### 3.3 CoinGecko client (`test/clients/coingecko.test.ts`, uses an injected `fetch`)
- [x] B02-15 `simplePrice(["ethereum"])` calls `GET /api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true` and, when a key is configured, sends header `x-cg-demo-api-key`.
- [x] B02-16 Non-200 upstream response throws a `PriceSourceError` carrying the status.
- [x] B02-17 Request has a 3 s timeout (abort signal fires with a fake timer).
- [x] B02-18 Also requests `include_7d_change` only when asked (`{ with7d: true }`), for T-B05 input, and surfaces it as `change7dPct` (CoinGecko simple/price has no 7d field; the client falls back to `coins/{id}/market_chart` or returns `null`, and the test pins whichever is chosen. Record the decision in `docs/DECISIONS.md`).

## 4. T-B03 Flash client with mock mode

reqs: FR-B-02, FR-S-07. done when: mock mode passes schema tests; real mode compiles and is unit-tested with recorded fixtures.

### 4.1 Mock client (`test/clients/flashMock.test.ts`)
- [x] B03-01 `MockFlashClient.quote(req)` returns a `FlashQuoteResponse` that parses, with `spend.amount === req.amount`, `orderType === req.orderType`, `expiresAt === clock.now() + 60`, and a fresh `quoteId` per call.
- [x] B03-02 For a limit request, the mock `receive.amount` equals `amount / limitPriceUsd` to 6 decimals.
- [x] B03-03 `submit(quoteId, sigs)` returns `{ orderId, status: "submitted" }` and a fresh `orderId` per call.
- [x] B03-04 `status(orderId)` progression: first call `submitted`, second `open` for limit or `filled` for market, with `txHash` present when `filled` and `null` when `open` (FR-S-06 relies on this).
- [x] B03-05 `status("o_unknown")` throws `NotFound`.
- [x] B03-06 A quote request with `amount: "fail"`-marker symbol or a `?fail=` style hook (`MockFlashClient` option `failNextQuote`) throws `FlashError("mock failure")` so the FLASH_ERROR path is testable.
- [x] B03-07 Mock output equals the shared fixture `quoteEthMarket` for the exact fixture input (wallet, ETH, market, 2.00), apart from `quoteId` and `expiresAt`. Keeps Part A's MSW and Part B's mock aligned.

### 4.2 Field mapping, pure functions (`test/clients/flashMap.test.ts`)
- [x] B03-08 `toFlashQuoteBody(ourReq, token)` produces `{ targetAsset: WETH, targetChain: "base", contraAsset: USDC, contraChain: "base", side, qty: amount, orderType, limitNotionalPrice, maxSlippage, funderAddress }` per API_CONTRACT section 6, table-driven for market and limit.
- [x] B03-09 `limitNotionalPrice` is omitted (not `null`) for market orders, if that is what Gate 0 shows; otherwise `null`. Pin whichever `docs/GATE0.md` records.
- [x] B03-10 `fromFlashQuote(flashResp, ourReq, now)` maps `evm.approveTx`, `evm.permitTypedData`, `evm.orderTypedData` into `steps.*`, and the typed data strings are identical to the input strings (`toBe`, not re-serialised).
- [x] B03-11 `fromFlashQuote` sets `expiresAt = now + 60` because Flash returns no expiry.
- [x] B03-12 `fromFlashQuote` output parses with `FlashQuoteResponse`; `chain === "base"`, `chainId === 8453`.
- [x] B03-13 `toFlashOrderBody(storedQuote, ourOrderReq)` echoes `evmOrderTypedData` from the stored quote with `userSignature`, and `evmPermitTypedData` plus `evmPermitSignature` only when a permit was present.
- [x] B03-14 `mapFlashStatus(raw)` maps every value recorded in `docs/GATE0.md` onto `submitted | open | filled | failed | expired`, and an unknown value maps to `failed` with `error: "unknown flash status: <raw>"` (never throws).

### 4.3 HTTP client with recorded fixtures (`test/clients/flashHttp.test.ts`, injected `fetch`)
- [x] B03-15 `quote()` POSTs to `${FLASH_BASE_URL}/quote` (path per GATE0) with header `x-definitive-api-key` and the mapped body; replies with recorded `fixtures/flash/quote.ok.json`; result parses and the typed-data string is unchanged.
- [x] B03-16 `submit()` POSTs to the order path with the echoed typed data and signature; recorded `order.ok.json`.
- [x] B03-17 `status()` GETs the order; recorded `status.filled.json` maps to `filled` with `txHash`.
- [x] B03-18 Upstream 4xx with a JSON error body throws `FlashError` whose message is the upstream reason (FR: message carries the reason).
- [x] B03-19 Upstream 5xx or network error throws `FlashError("flash unavailable")`.
- [x] B03-20 The API key never appears in thrown error messages or in the request body.
- [x] B03-21 Requests time out at 5 s.

### 4.4 Wiring (`test/clients/flashFactory.test.ts`)
- [x] B03-22 `createFlashClient(config)` returns `MockFlashClient` when `FLASH_MOCK=true` and `HttpFlashClient` otherwise; no code path reads the env directly (switching is one env var, AGENT.md section 5).

## 5. T-B04 Flash endpoints

reqs: FR-B-02, FR-S-04. deps: T-003 (shapes in `docs/GATE0.md`). done when: a real $1-5 limit order goes through end to end and the status is returned in our shape.

All route tests use `FakeFlash` (a spy around `MockFlashClient`) and `:memory:` SQLite.

### 5.1 Quote (`test/flash.quote.test.ts`)
- [x] B04-01 Valid market request returns 200 and `FlashQuoteResponse.parse(body)` succeeds.
- [x] B04-02 Valid limit request with `limitPriceUsd` returns 200 with `orderType: "limit"`.
- [x] B04-03 Limit request without `limitPriceUsd` returns 400 `BAD_REQUEST` naming `limitPriceUsd`.
- [x] B04-04 `amount: "5.01"` returns 400 `BAD_REQUEST` mentioning the max (`MAX_FLASH_TRADE_USD`); `"5.00"` is accepted; `"0"` is rejected.
- [x] B04-05 `side: "sell"` returns 400 (schema literal).
- [x] B04-06 Unknown or `flashSupported: false` symbol returns 400 `UNSUPPORTED_TOKEN`.
- [x] B04-07 Invalid `walletAddress` returns 400 `BAD_REQUEST`.
- [x] B04-08 The quote is stored: after 200, `quotes.get(body.quoteId)` returns the response plus wallet, symbol, orderType and raw typed data.
- [x] B04-09 `FakeFlash.quote` throwing `FlashError("insufficient liquidity")` returns 502 `FLASH_ERROR` with that message.
- [x] B04-10 `steps.orderTypedData` in the response is `toBe`-identical to what the client returned (pass-through).
- [x] B04-11 Request body with an unknown extra field is accepted (zod strips) and the extra field is not forwarded to Flash.

### 5.2 Order (`test/flash.order.test.ts`)
- [x] B04-12 Happy path: quote, then `POST /flash/order` with `orderSignature` returns 200 `{ orderId, status: "submitted" }` parsing with `FlashOrderResponse`.
- [x] B04-13 The order is stored and linked to the quote: `orders.get(orderId).quoteId === quoteId`.
- [x] B04-14 Unknown `quoteId` returns 409 `QUOTE_EXPIRED` (contract: "quote missing or past expiresAt").
- [x] B04-15 Quote past `expiresAt` (advance fake clock by 61 s) returns 409 `QUOTE_EXPIRED` and Flash `submit` is not called.
- [x] B04-16 Quote at exactly `expiresAt` is treated as expired (boundary pinned: `now >= expiresAt`).
- [x] B04-17 `walletAddress` differing from the quote's wallet returns 400 `BAD_REQUEST` (signature would not match the funder).
- [x] B04-18 Submitting the same quote twice returns 409 `QUOTE_EXPIRED` on the second call (a quote is single-use).
- [x] B04-19 `permitSignature` is forwarded only when the stored quote had `permitTypedData`; otherwise it is ignored.
- [x] B04-20 `FakeFlash.submit` throwing yields 502 `FLASH_ERROR` and no order row is written (or the row is written with status `failed`; pin one behaviour, recommended: no row).
- [x] B04-21 Missing `orderSignature` or non-hex returns 400.

### 5.3 Order status (`test/flash.status.test.ts`)
- [x] B04-22 `GET /flash/order/:id` for a known order calls `FakeFlash.status`, persists the latest status, and returns a body parsing with `FlashOrderDetail` with `orderType` taken from the stored quote.
- [x] B04-23 Unknown `orderId` returns 404 `NOT_FOUND`.
- [x] B04-24 Once stored status is `filled`, `failed` or `expired` (terminal), the route does not call Flash again and serves the stored row (saves rate budget during 3 s polling).
- [x] B04-25 Non-terminal stored status (`submitted`, `open`) calls Flash every time.
- [x] B04-26 `filled` from Flash without a `txHash` is returned as-is (`txHash: null`); the frontend decides (FR-S-06). Pin that the backend does not invent a hash.
- [x] B04-27 `FakeFlash.status` throwing returns the last stored status with `updatedAt` unchanged rather than 502, so polling survives transient errors. (Decision; document it.)
- [x] B04-28 `updatedAt` equals `clock.now()` at the time of the refresh.

### 5.4 Contract test across endpoints (`test/contract.test.ts`, FR-B-01)
- [x] B04-29 Table-driven: for each of the 10 endpoints, a canonical request is sent to the app with fakes and the response is parsed by the exact schema the frontend uses (`TokensResponse`, `Market`, `InsightResponse`, `FlashQuoteResponse`, `FlashOrderResponse`, `FlashOrderDetail`, `PoolsResponse`, `Pool`, `Position`, health literal). This file is the one that proves FR-B-01 and grows as endpoints land (B05 and B07 add their rows here).
- [x] B04-30 Table-driven: for each error code a request that triggers it exists and parses with `ApiError` (FR-B-07).

### 5.5 Gate 0 and live (`scripts/gate0-flash.ts`, `test/live/flash.live.test.ts`, run with `pnpm test:live`, skipped without `FLASH_API_KEY`)
- [ ] B04-31 Gate 0 script places one real limit order of at most 5 USDC far from market so it stays `open`, writes the raw quote, order and status bodies to `docs/GATE0.md`, and refuses to run if `amount > MAX_FLASH_TRADE_USD`. The recorded bodies become `test/fixtures/flash/*.json` (secrets and signatures redacted).
- [ ] B04-32 Live test: real quote for 1 USDC parses with `FlashQuoteResponse`; no order is placed by this test.

## 6. T-B05 Insight endpoint (OpenAI)

reqs: FR-B-03, FR-I-03, FR-I-04. done when: a real call works; with an invalid key the endpoint still returns 200 and `degraded: true`.

### 6.1 Prompt input (`test/insight.input.test.ts`)
- [x] B05-01 `buildInsightInput({ market, change7dPct, userIntent })` contains symbol, price, 24h change, 7d change (or "unknown" when null), the intent when given, and the fixed instruction text.
- [x] B05-02 Input never contains tweet text and the request to the model has no `tools` (FR-I-04 half: the service has no dependency on the Flash client; assert by constructing `InsightService` with no flash argument and by a static test that `src/services/insight.ts` and `src/routes/insight.ts` do not import from `clients/flash` or `services/flash`).
- [x] B05-03 `userIntent` longer than 200 chars is rejected at the route by `InsightRequest` (400), so the prompt builder never sees it.

### 6.2 Model call and validation (`test/insight.model.test.ts`, `FakeInsightModel`)
- [x] B05-04 The model is called once with `max_output_tokens: 300` and a JSON schema derived from `InsightResponse` (minus `symbol`, `degraded`, `disclaimer`, which the service sets).
- [x] B05-05 A valid model reply yields 200, `InsightResponse.parse(body)`, `degraded: false`, `symbol` echoed, `disclaimer === "Not financial advice."`.
- [x] B05-06 A reply that fails the schema triggers exactly one retry; a second bad reply yields the static fallback with `degraded: true` and 200.
- [x] B05-07 Model throws (network, 401 bad key, 429): one retry, then fallback `degraded: true`, HTTP 200. This is the acceptance test for "invalid key still returns 200".
- [x] B05-08 Model timeout (fake timer past 8 s) counts as a failure for B05-07.
- [x] B05-09 Fallback text is deterministic and mentions the symbol and 24h change sign ("up"/"down"), with `bias: "neutral"`, `confidence: "low"`, `suggestedLimit: null`.
- [x] B05-10 `LLM_UNAVAILABLE` 503 is returned only when the fallback itself cannot be built because `/market` failed (no spot price); otherwise never.

### 6.3 Clamp (`test/insight.clamp.test.ts`, pure)
- [x] B05-11 `clampSuggestedLimit(spot, limit)` leaves a value within 15% unchanged.
- [x] B05-12 A value below `spot * 0.85` is raised to exactly `spot * 0.85`, formatted as `DecimalString` with the same number of decimals as spot (minimum 2).
- [x] B05-13 A value above `spot * 1.15` is lowered to `spot * 1.15`.
- [x] B05-14 `null` passes through as `null`. A non-decimal `priceUsd` from the model fails the draft schema and is handled by the retry, then the static fallback (never a 500); the pure clamp itself maps such garbage to `null`.
- [x] B05-15 Clamp uses string decimal arithmetic (or a safe conversion) so `0.0000120` style prices do not lose precision (table-driven with PEPE-scale values).

### 6.4 Cache and route (`test/insight.route.test.ts`)
- [x] B05-16 Two identical requests within 5 minutes call the model once; the second is served from the `insights` table (FR-B-05).
- [x] B05-17 Cache key includes `symbol` and normalised `userIntent` (trimmed, lower-cased); different intents are different calls.
- [x] B05-18 A degraded response is not cached (so recovery is immediate when the key is fixed).
- [x] B05-19 Cache entry expires at +300 s (fake clock).
- [x] B05-20 Unknown symbol returns 400 `UNSUPPORTED_TOKEN` before any model call.
- [x] B05-21 `/insight` rate limit of 10 per minute applies (covered by B01-20; re-assert here with the real route wired).
- [x] B05-22 Add the `/insight` row to `test/contract.test.ts` (B04-29).

### 6.5 Live (`test/live/insight.live.test.ts`, needs `OPENAI_API_KEY`, `OPENAI_MODEL`)
- [x] B05-23 A real call for ETH returns `degraded: false` and parses. Paste the response in `docs/WORKLOG.md`.
- [x] B05-24 With `OPENAI_API_KEY=invalid` the route returns 200 with `degraded: true`.

## 7. T-B07 Pool read endpoints

reqs: FR-B-04. deps: T-B06 (ABI and `deployments.ts`). done when: responses equal the contract state for seeded pools.

`PoolReader` interface returns raw contract tuples; the service converts. Tests use `FakePoolReader` seeded with the three demo pools (open, awaiting, resolved) and one void pool.

### 7.1 Mapping (`test/pools.map.test.ts`, pure)
- [x] B07-01 `toPool(raw, { now, chainId, contract, dashboardUrl })` parses with `Pool`; `strikeUsd = fromE18(strikeE18)`; `direction` 0 -> `above`, 1 -> `below`; `yesTotal`/`noTotal` as base-unit strings; `resolvedPriceUsd = fromE18(priceE18)` or `null`.
- [x] B07-02 `status` is computed by the shared `derivePoolStatus` for all four cases (open, awaiting, resolved, void), table-driven with the fake clock.
- [x] B07-03 `outcome` is `null` unless resolved and not void; for void it is `null` even if the contract stored an outcome.
- [x] B07-04 `dashboardUrl === ${DASHBOARD_URL}/pool/${id}` from env (add `DASHBOARD_URL` to config and `.env.example`; note in `docs/DECISIONS.md`).
- [x] B07-05 `question` round-trips exactly (no trimming) and the mapped `question` equals `buildQuestion({ symbol, direction, strikeUsd, resolveTime })` for seeded pools (FR-P-01 guard; this will also surface the fixture mismatch noted in WORKLOG and must be resolved via the contract change protocol, not by weakening the test).

### 7.2 Position (`test/pools.position.test.ts`, pure then route)
- [x] B07-06 Winner on a resolved pool: `claimable = computePayout(stake, winningTotal, losingTotal, feeBps)`; the $60/$40, 2%, $30 YES stake example yields `"49000000"` (FR-P-07).
- [x] B07-07 Loser on a resolved pool: `claimable = "0"`.
- [x] B07-08 Open or awaiting pool: `claimable = "0"`, `refundable = "0"`.
- [x] B07-09 Void pool: `refundable = yesStake + noStake`, `claimable = "0"`.
- [x] B07-10 Already claimed: `claimed: true`, `claimable: "0"`.
- [x] B07-11 Address with no stake: all zeros, `claimed: false`.

### 7.3 Routes (`test/pools.routes.test.ts`)
- [x] B07-12 `GET /pools` returns `PoolsResponse`, newest first (by id descending), at most 20 when the fake has 25 pools.
- [x] B07-13 `GET /pools` with zero pools returns `{ pools: [] }`.
- [x] B07-14 `GET /pools/12` returns `Pool`; `GET /pools/999` (id >= poolCount) returns 404 `NOT_FOUND`; `GET /pools/abc` and `/pools/-1` return 400 `BAD_REQUEST`.
- [x] B07-15 `GET /pools/12/position?address=0x…` returns `Position`; missing or invalid `address` returns 400.
- [x] B07-16 Position for an unknown pool returns 404.
- [x] B07-17 Cache: `/pools/12` twice within 10 s reads the chain once; at +11 s reads again. `/pools` list cache is separate from single-pool cache.
- [x] B07-18 Position is cached per (poolId, address) for 10 s.
- [x] B07-19 Chain read failure (fake throws) with no cache returns 502 `INTERNAL` "chain unavailable"; with a cache entry serves stale.
- [x] B07-20 No pool data is written to SQLite during any pools request (`sqlite_master` still lists three tables; row counts unchanged) (FR-B-05).
- [x] B07-21 Add the three pool rows to `test/contract.test.ts` (B04-29).

### 7.4 Viem reader (`test/clients/chain.test.ts`)
- [x] B07-22 `ViemPoolReader` calls `readContract` with the shared ABI and `POOL_ADDRESS` for `poolCount`, `getPool(id)`, `getPosition(id, address)` (mock the viem client's `readContract`; assert function names and args).
- [x] B07-23 `listLatest(20)` uses `multicall` (or batched reads) so a 20-pool list is at most 2 RPC round trips.

### 7.5 Live (`test/live/pools.live.test.ts`, needs `POOL_RPC_URL`, deployed address)
- [x] B07-24 Against Base Sepolia with the seeded pools from T-B09, `GET /pools` shows the three statuses and each field equals a direct `cast call` (acceptance "values equal what the contract returns"); paste output in `docs/WORKLOG.md`.

## 8. T-B10 Deploy backend

reqs: FR-B-06, NFR-02. done when: `GET /health` works from the public URL; URL in `docs/WORKLOG.md`.

### 8.1 Build and boot (`test/server.boot.test.ts`)
- [x] B10-01 A smoke test runs `src/server.ts` under `tsx` (there is no `dist` bundle; tsx is the runtime) with `PORT=0` and a temp `SQLITE_PATH`, then hits `/api/v1/health` over real HTTP and gets `{ ok: true }` (the only test that opens a socket).
- [x] B10-02 Boot with `FLASH_MOCK=false` and no key exits non-zero with a clear message (B01-04 end to end).
- [x] B10-03 Boot logs the resolved config with secrets redacted (`FLASH_API_KEY: "[set]"`).
- [x] B10-04 `SIGTERM` closes the server and the SQLite handle (graceful shutdown; process exits within 2 s).

### 8.2 Deployment checklist (manual, recorded in `docs/WORKLOG.md`)
- [ ] B10-05 Public `GET /health` returns `{ ok: true }`.
- [ ] B10-06 `curl -H "Origin: https://x.com" -I <url>/api/v1/tokens` shows the CORS header; `Origin: https://evil.example` does not. Same for the dashboard origin.
- [ ] B10-07 `FLASH_MOCK=false` in the environment; a 1 USDC quote from the public URL parses.
- [ ] B10-08 The deployed bundle contains no key values (`grep` the image or build output for the key strings; NFR-02 applies to frontends, but the backend build must not embed `.env`).
- [x] B10-09 Rate limit works behind the proxy: `TRUST_PROXY` is a hop count (1 on Railway or Render) so `request.ip` is the address the platform proxy appended, not the spoofable leftmost `x-forwarded-for` value.

## 9. Cross-cutting

- [x] X-01 `pnpm typecheck` passes with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` inherited from `tsconfig.base.json`.
- [x] X-02 `grep -rn "console.log\|: any\|TODO" apps/backend/src` returns nothing (or only `TODO T-xxx`).
- [x] X-03 Vitest coverage threshold: 90% lines on `src/services`, `src/clients`, `src/util`, `src/errors.ts`; routes and plugins are covered by the route tests.
- [x] X-04 `pnpm test` runs with no network: run once with `--offline`-style guard (`globalThis.fetch` replaced by a throwing stub in `test/setup.ts`); any test that reaches real `fetch` fails.
- [x] X-05 `test/contract.test.ts` imports schemas only from `@predictx/shared`, never redefines a shape.

## 10. Order of work

1. T-B01 (2.1 to 2.8), scaffold green. Set `done` in `docs/TASKS.md`.
2. T-B02 (3.x). Needs nothing external.
3. T-B03 (4.1, 4.2, 4.4 first; 4.3 waits for recorded fixtures from Gate 0, use placeholder fixtures shaped per API_CONTRACT section 6 and replace them after T-003).
4. T-B04 route tests (5.1 to 5.4) against `FakeFlash`; this makes the whole swap flow work in mock mode for Part A. 5.5 when the Flash key and wallet arrive.
5. T-B05 (6.1 to 6.4); 6.5 when the OpenAI key and model arrive.
6. T-B07 (7.1 to 7.3) against `FakePoolReader` using the ABI from T-002; 7.4 and 7.5 when the contract is deployed and seeded.
7. T-B10 once T-B04, T-B05, T-B07 are done.

Human inputs that unblock rows: Flash key and funded mainnet wallet (5.5, then 4.3 real fixtures), OpenAI key and model name (6.5), Foundry plus Sepolia deployer (7.4, 7.5), hosting account and `DASHBOARD_URL` (section 8). Everything else proceeds now.

## 11. Decisions this plan makes (record in `docs/DECISIONS.md` when implemented)

- D-B1 Quotes are single-use; resubmitting returns `QUOTE_EXPIRED`.
- D-B2 Order status polling returns the last stored status on transient Flash errors instead of 502.
- D-B3 Terminal order statuses are served from SQLite without calling Flash.
- D-B4 Degraded insights are not cached.
- D-B5 Market and pool reads serve stale cache on upstream failure.
- D-B6 Backend adds `DASHBOARD_URL` to env for `dashboardUrl`.
- D-B7 7d change source for the insight prompt (see B02-18).
- D-B8 Runtime response validation is on in dev and test, configurable in prod.

Items D-B1, D-B2, D-B5 and D-B6 touch behaviour the frontend can observe. They do not change any shared schema, so they do not need the contract change protocol, but Part A should be told.
