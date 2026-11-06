# WORKLOG

Append-only. One entry per finished task. Newest at the bottom.

Format:

```
## T-XXX <title>  (<role>, <YYYY-MM-DD HH:MM>)
Plan: <max 5 lines>
Changed: <files>
Verified: <commands run + result>
Notes: <surprises, follow-ups, decisions made>
```

## T-000 Restructure into monorepo  (H + agent, 2026-10-29 04:20)
Plan: unpack predictx-initiator.zip at repo root; git mv extension/ -> apps/extension; archive root HTML prototype under docs/prototype; retire files/.
Changed: all kit files at root, packages/shared, apps/extension (moved), docs/prototype/predictx-extension-ui.html, docs/legacy-extension-guidelines.md (old AGENTS.md), .gitignore, removed both package-lock.json.
Verified: `cmp` of all 11 kit docs against the zip: identical. `git status --short` shows renames, not deletes.
Notes: the five .md files in files/ were byte-identical to the zip copies, so files/ was deleted (zip backed up outside the repo). Audit of the legacy extension: nothing meets any task's done-when; T-A01 ~12%, T-A04 ~15%, T-A05/A06/A09/A10 ~5%, all else 0%.

## T-001 Verify scaffold  (B, 2026-10-29 04:21)
Plan: corepack enable -> pnpm 9.12.0; pnpm install; pnpm typecheck; pnpm test.
Changed: pnpm-lock.yaml (new), .env (copied from .env.example, untracked).
Verified:
  pnpm install -> Packages: +103, Done in 16.5s
  pnpm typecheck -> packages/shared typecheck$ tsc --noEmit ... Done
  pnpm test -> packages/shared test$ vitest run ... Test Files 1 passed (1), Tests 7 passed (7)
  pnpm --filter predictx-extension build -> dist/content.js 152.20 kB, built in 1.28s (legacy extension still builds from apps/extension)
Notes: pnpm was not on PATH; fixed with `corepack enable` under nvm node v24.19.0. forge and cre CLIs are not installed (see B-001, B-003). Workspace is "2 of 3 projects" for typecheck/test because the legacy extension has no typecheck/test scripts.

## Backend build  (B, 2026-10-29 05:10 to 13:55)
Built test-first from apps/backend/TEST_PLAN.md by parallel agents (research -> T-B01 -> T-B02/T-B03/T-B07 -> T-B04/T-B05 -> T-B10). Final: root pnpm typecheck green; pnpm test green: packages/shared 7/7, apps/backend 33 files / 415 tests; coverage 98.68% lines. 154 of 163 plan rows ticked; the 9 open rows are live checks that need keys, a deployed contract or hosting. One commit per task:

### T-B01  (commit 36023b7)
2026-10-29 T-B01 Backend scaffold (agent B). Created apps/backend (@predictx/backend, pnpm workspace, Node >=22, tsx runtime, Vitest). Installed fastify 5.12.7, @fastify/cors 11.3.1, pino 9.14.0, better-sqlite3 13.0.3 (prebuilt loads on Node 24), viem 2.57.13, openai 7.45.1, zod 3.25.76 (one instance with packages/shared). Built buildApp(deps) with injected config/db/clock/adapters, zod config loader, ApiError error + not-found handlers, routeConfig-based request/response validation, CORS allowlist, own fixed-window per-IP rate limiter (60/min default, 10/min insight) on an injectable clock, single-line pino request logging with secret redaction, SQLite migrate (quotes/orders/insights) and three repositories, TtlCache, client interfaces + factory stubs, empty route plugins for later tasks, server.ts with .env loading and graceful shutdown, and the test harness (buildTestApp, FakeClock, FakePriceSource, NotConfiguredFlash, FakeInsightModel, FakePoolReader, LogCapture, network-disabled setup, live config). TDD rows B01-01..B01-29 plus B01-cache-1..6 and five harness rows (B01-02b, B01-09b, B01-12b, B01-25-markUsed, B01-27-purge) all seen red then green; 10 rows passed immediately and are flagged. Checks: `pnpm typecheck` green (shared + backend), `pnpm test` green: packages/shared 7/7, apps/backend 55/55 across 9 files. Boot smoke: `tsx src/server.ts` with baseline env creates the sqlite file and fails at the first adapter stub ("not implemented: T-B02") as designed. Not done here (reported for humans): tick TEST_PLAN boxes, set T-B01 done in TASKS.md, DECISIONS.md Node 22 + tsx runtime entries, .env.example additions (DASHBOARD_URL, LOG_LEVEL, TRUST_PROXY, VALIDATE_RESPONSES). No commit made.

### T-B02  (commit 6b04c40)
2026-10-29 T-B02 Tokens and market endpoints — done (pending status tick in TASKS.md). GET /tokens serves packages/shared/tokens.json (parsed once with TokensResponse, cache-control public max-age=300). GET /market/:symbol maps CoinGecko simple/price (precision=full, include_24hr_change) into Market via numberToDecimalString, 30 s TtlCache on the injected clock, stale-while-error (D-B5), 502 INTERNAL 'price source unavailable' with no cache, UNSUPPORTED_TOKEN for symbols outside the allowlist. CoinGeckoPriceSource with injected fetch: host-based key header (demo/pro, none when keyless), 3 s AbortController timeout, PriceSourceError carrying the upstream status and message, documented error shapes incl. non-JSON 'Throttled'. D-B7: 7d change from coins/markets?price_change_percentage=7d, lazy via MarketService.change7dPct, 300 s cache, null on failure. sharedMarketService gives /market and /insight one cache per app. Contract rows for health/tokens/market plus four error codes in test/contract/tokens-market.contract.test.ts; B01-19 re-pointed to /tokens. Tests: test/tokens.test.ts 4, test/market.test.ts 36, test/clients/coingecko.test.ts 16, test/contract/tokens-market.contract.test.ts 7 — all green; backend suite 216/216; root typecheck green. Rows B02-01..B02-14 were found already implemented by an earlier interrupted run and verified rather than re-derived.

### T-B03  (commit c8a8bc5)
T-B03 Flash client with mock mode: all 22 TEST_PLAN rows (B03-01..B03-22) green via TDD. Mock client (clock-injected, deterministic q_mock_N/o_mock_N ids, status progression, failNextQuote, fixture-aligned, bigint decimal division) carried over from the prior run; this run added fromFlashQuote, toFlashOrderBody, mapFlashStatus and fromFlashOrder (src/clients/flash.map.ts), the HttpFlashClient with injected fetch, 5 s abort timer, x-definitive-api-key header, upstream-reason error mapping (4xx reason / 404 FlashNotFoundError / 5xx and network 'flash unavailable') and key scrubbing (src/clients/flash.http.ts), createFlashClient(config, deps?) switching on config.flashMock only, FakeFlash spy, and placeholder Flash fixtures with a README. FlashStatusInput gained a required funderAddress (Flash requires it on GET /orders/{id}). Validation: pnpm vitest run on the four flash test files = 66 tests green; pnpm test = 22 files / 255 tests green; root pnpm typecheck clean (shared + backend). No commits, no dependency changes, no edits outside the owned paths.

### T-B07  (commit 8a8f158)
## T-B07 Pool read endpoints  (B, 2026-10-29 12:50)
Plan: define predictionPoolAbi + mockUsdcAbi in packages/shared/src/abi.ts; ViemPoolReader (readContract/multicall, injected client) in src/clients/chain.ts; PoolsService (toPool/toPosition with shared helpers, 10 s raw-tuple caches, stale-on-ChainReadError) in src/services/pools.ts; GET /pools, /pools/:id, /pools/:id/position in src/routes/pools.ts; TDD rows B07-01..23 against FakePoolReader; live test gated on POOL_ADDRESS/POOL_RPC_URL.
Changed: packages/shared/src/abi.ts (new), packages/shared/src/index.ts (+1 export line), apps/backend/src/clients/{chain,poolReader}.ts, src/services/pools.ts, src/routes/pools.ts, test/pools.routes.test.ts (+B07-19, B07-20), test/clients/chain.test.ts (new), test/contract/pools.contract.test.ts (new), test/live/pools.live.test.ts (new).
Verified: `pnpm vitest run test/pools.map.test.ts test/pools.position.test.ts test/pools.routes.test.ts test/clients/chain.test.ts test/contract/pools.contract.test.ts` -> Test Files 5 passed, Tests 71 passed; `pnpm vitest run --config vitest.live.config.ts test/live/pools.live.test.ts` -> 1 skipped (no deployed address); packages/shared `pnpm typecheck && pnpm test` -> Done, 7 passed; root `pnpm typecheck` -> Done; root `pnpm test` -> shared 7/7, backend 248/249 (the one failure is test/clients/flashHttp.test.ts B03-21, T-B03).
Notes: B07-24 skipped until T-B06/T-B09 deploy and seed (B-001). Shared fixture strikeUsd "0.0000120" vs canonical fromE18 "0.000012" needs a CONTRACT CHANGE blocker (frontend must canonicalise the strike before buildQuestion, or fixtures change). D-B5 (stale on chain failure, 502 INTERNAL "chain unavailable" without cache) and D-B6 (DASHBOARD_URL) implemented; ChainReadError hides the RPC URL in `cause`. ABI widths (uint64 times, uint16 feeBps, uint8 direction) are part of the backend contract with T-B06.

### T-B04  (commit babc016)
T-B04 Flash endpoints (2026-10-29): implemented src/services/flash.ts and src/routes/flash.ts (POST /flash/quote, POST /flash/order, GET /flash/order/:orderId) test-first against TEST_PLAN rows B04-01..B04-30 with FakeFlash (test/helpers/fakes/flashSpy.ts, a spy over MockFlashClient) and :memory: SQLite. Quote: tokens-service lookup, UNSUPPORTED_TOKEN for non-Flash tokens, MAX_FLASH_TRADE_USD enforced in USDC base units, adapter result validated with FlashQuoteResponse before storage, typed data stored and echoed unchanged. Order: QUOTE_EXPIRED for unknown/expired (now >= expiresAt)/already-used quotes (markUsed claim before submit, D-B1), wallet match, permit rule, FLASH_ERROR on submit failure with no order row. Status: terminal statuses served from SQLite (D-B3), transient Flash errors including 404 lag return the stored detail (D-B2), updatedAt = backend refresh time. Contract rows for the three endpoints and seven error codes in test/contract/flash.contract.test.ts. Live test test/live/flash.live.test.ts (B04-32) skips without FLASH_API_KEY. T-003 Gate 0 script scripts/gate0-flash.ts + gate0-report.ts + tsconfig.json + README.md: refuses amounts above the cap before reading keys (verified), exact-amount approve, viem signTypedData, single submit, 5 polls, redacted docs/GATE0.md and docs/gate0/*.json; not run (no key, no wallet, B-002). Result: apps/backend 31 files / 398 tests green, tsc clean, root typecheck and test green, scripts typecheck clean.

### T-B05  (commit e06b5f1)
T-B05 Insight endpoint: implemented POST /insight end to end with TDD (rows B05-01..B05-22 green, B05-23/24 written and skipped pending OPENAI_API_KEY/OPENAI_MODEL). OpenAI adapter (src/clients/openai.ts) uses openai@7.45.1 responses.parse with a strict json_schema text format derived from InsightResponse minus symbol/degraded/disclaimer, max_output_tokens 300, reasoning effort none, store false, no tools, maxRetries 0, 8 s timeout, injected fetch. Service (src/services/insight.ts + insight.schema/clamp/decimal.ts): fixed prompt (no tweet text), one retry, deterministic degraded fallback (never cached), bigint 15% clamp at spot's decimals, 300 s cache in the insights table keyed by symbol + normalised intent, LLM_UNAVAILABLE 503 only without a spot price. Contract rows added in test/contract/insight.contract.test.ts. Validation: apps/backend `pnpm test` 31 files / 398 tests green; root `pnpm typecheck` green; `pnpm test:live` 3 files skipped (no keys). Follow-ups: choose OPENAI_MODEL, confirm reasoning.effort none on it, bump zod range to ^3.25.76, record D-B decisions.

### T-B10  (commit dbf42af)
## T-B10 Deploy backend: boot tests, cross-cutting gates, deploy notes  (B, 2026-10-29 13:52)
Plan: spawn src/server.ts under tsx for the 8.1 smoke tests (no dist bundle); fail-fast config error with a reason-only fatal line; boot config line with secrets as [set]/[empty]; SIGTERM exit; proxy-aware rate-limit test; coverage thresholds; static rule tests for X-02/X-05; README with Railway/Render settings and the 8.2 checklist.
Changed: apps/backend/src/server.ts, src/config.ts (ConfigError), src/config.summary.ts (new), src/plugins/logging.ts (censor keeps presence markers only); test/server.boot.test.ts, test/helpers/serverProcess.ts, test/static.rules.test.ts (new); test/config.test.ts, test/logging.test.ts, test/rateLimit.test.ts; vitest.config.ts (thresholds); apps/backend/README.md (new).
Verified: root `pnpm typecheck` -> packages/shared Done, apps/backend Done. Root `pnpm test` -> shared 1 file / 7 tests passed; backend 33 files / 415 tests passed. `pnpm vitest run --coverage` -> all files 98.68% lines (branches 94.19, funcs 97.77); src/services 99.15, src/clients 98.86, src/util 95, src/errors.ts 100; thresholds met, exit 0; a probe config raising src/util/** to 99 fails with the expected ERROR line (thresholds are live). Boot smoke: tsx boot ~1.9 s, GET /api/v1/health over real HTTP -> {"ok":true}; FLASH_MOCK=false without key -> exit 1, reason "Invalid backend config: FLASH_API_KEY: FLASH_API_KEY is required when FLASH_MOCK=false"; SIGTERM -> exit 0 in well under 2 s, WAL removed.
Notes: no dist bundle (tsx runtime), TEST_PLAN B10-01 wording to align. 8.2 rows B10-05..B10-08 and the hosted half of B10-09 wait for a Railway/Render account (B-004); public URL still to be recorded here. README documents Node 22+ (better-sqlite3 13); root engines >=20 needs a human update. .env.example still lacks DASHBOARD_URL, LOG_LEVEL, TRUST_PROXY, VALIDATE_RESPONSES.

## Backend review fixes  (B, 2026-10-29)
Review: 29 findings from three lenses (contract, security, TDD); 18 confirmed by two independent verifiers, 11 refuted. Fixed test-first: limit price 0 returned 500 (now 400); TRUST_PROXY=true allowed rate-limit bypass by spoofing x-forwarded-for (now a hop count, "true" rejected); quote unknown after restart is 409 QUOTE_EXPIRED and not spent; unknown Flash status is re-polled instead of terminal; wrong-checksum address no longer becomes 502; stray ZodErrors are 500 not 400; error logs drop err.cause; Gate 0 report scrubs the key as a substring; insight cache purges expired rows; fallback tip formats spot readably; pool reader fails fast on an unsupported POOL_CHAIN_ID; two tests that could never fail were rewritten and mutation-checked; static non-null gate widened.
Left open: shared fixture strike/question mismatch (B-005, needs human approval); API_CONTRACT section 6 wording for maxSlippage/limitNotionalPrice per order type waits on Gate 0.
Verified: root pnpm typecheck clean; pnpm test: shared 7/7, backend 34 files / 473 tests; coverage 98.84% lines, thresholds met.

## T-B05 live verification  (B, 2026-10-30 19:13)
Verified: `pnpm vitest run --config vitest.live.config.ts test/live/insight.live.test.ts` -> 2 passed. OPENAI_MODEL=gpt-6-luna.
B05-23 real call: {"symbol":"ETH","tip":"ETH is down about 4% in 24 hours and 7% over the week, showing short-term weakness. If you want to buy a dip, consider a small limit order below spot and avoid committing more than you can afford to lose.","bias":"bearish","confidence":"low","suggestedLimit":{"side":"buy","priceUsd":"2158","reason":"About 3% below spot, allowing for a modest further dip amid recent declines."},"degraded":false,"disclaimer":"Not financial advice."}
B05-24 invalid key: 200 with degraded true.

## T-002 / T-B06 contracts  (B, 2026-10-30)
Plan: Foundry project in contracts/ (Soldeer deps: OpenZeppelin 5.4.0, forge-std 1.11.0; no submodules); MockUSDC and PredictionPool test-first per FR-C-01..08; ABI must equal packages/shared/src/abi.ts; deploy script; deployments.ts placeholder.
Changed: contracts/** (src, test, script, foundry.toml, soldeer.lock, README), packages/shared/src/deployments.ts, packages/shared/src/index.ts.
Verified: forge test -> 9 suites, 49 passed (includes 60/40 payout: 30 USDC YES stake claims 49, treasury +2 once; 1,000-run payout fuzz); coverage PredictionPool 100% lines/branches; compiled ABI equals abi.ts (19/19 entries); root pnpm typecheck and test green (shared 7, backend 473).
Live check: on a local Anvil fork of Base Sepolia at real time, deployed with throwaway wallets, seeded one open, one awaiting and one resolved pool; `pnpm vitest run --config vitest.live.config.ts test/live/pools.live.test.ts` -> 1 passed (every /pools field equals the contract view). The test now sets its clock from the latest block.
Notes: never use Anvil's default dev keys on a public network; on Base Sepolia they already carry EIP-7702 delegated code from sweepers. Pools never reported stay locked (no admin path, no timeout refund), matching current requirements. Simulation (MockKeystoneForwarder 0x82300bd7c3958625581cc2f77bc6464dcecdf3e5) and deployed CRE (KeystoneForwarder 0xF8344CFd5c43616a4366C34E3EEE75af79a74482) need separate deployments because the forwarder is immutable.

## T-002 / T-B06 Base Sepolia deploy  (B, 2026-10-31 09:42 IST)
Deployed with `forge script script/Deploy.s.sol --rpc-url https://sepolia.base.org --broadcast --slow` (dry run first: 2,477,806 gas, ~0.000025 ETH max).
MockUSDC 0x1e05373c199D764f7dE0353d58AFEa2b4C6326Ef (tx 0xd044aaf08f8fd1c5ac317061c2db8b444134303428c3a8b68a9213bf1c11a045)
PredictionPool 0x6b0f6C0f324C615Add6BfcA5EE0b8eeD66F2C0cd (tx 0xf80e44cc8eb34d1a1c74f4a407c6aef9534cdc85f87eb9387118df97b3c639d8), block 52490267.
Verified onchain: usdc() = MockUSDC, forwarder() = CRE MockKeystoneForwarder 0x82300bd7c3958625581cc2f77bc6464dcecdf3e5, treasury() = 0x8CF9113b19Aa9D169365CA7B1BB9d7b957B460e5, MockUSDC decimals 6. Recorded in packages/shared/src/deployments.ts and .env.example. "stub deployed" requirement met with the full contract.

## T-B09 Seed demo pools  (B, 2026-10-31 09:45 IST)
scripts/seed-pools.ts (viem, questions from buildQuestion with canonical strikes, exact-amount approvals). Dry-run on a local fork first, then Base Sepolia:
pool 0 "Will $ETH be above $3000 at 04:18 UTC on 31 Oct?" YES 60 / NO 40 (3 min; CRE resolve target, matches the FR-C-04 payout example)
pool 1 "Will $BTC be below $100000 at 04:18 UTC on 31 Oct?" YES 25 / NO 25 (3 min; stays awaiting)
pool 2 "Will $PEPE be above $0.00001 at 08:15 UTC on 31 Oct?" YES 10 / NO 15 (4 h; open)
Wallet 1 0x8CF9...60e5 stakes YES, wallet 2 0xB459...9c82 stakes NO. Remaining: resolve pool 0 via the CRE workflow (T-B08), then run test/live/pools.live.test.ts against Base Sepolia.

## T-B08 CRE workflow and simulation  (B, 2026-10-31 10:03 IST)
cre/resolve-pools: cron -> getDuePoolIds(10) -> getPool -> CoinGecko simple/price (keyless, precision=full, median consensus) -> outcome with exact E18 maths -> writeReport (poolId, outcomeYes, priceE18). .result() pattern only; per-pool skip on HTTP failure (FR-R-05). bun test: 37 pass (red-then-green per unit, workflow test with SDK mocks).
Simulate (dry): due pool ids [0, 1]; pool 0 ethereum 2238.82 USD -> NO (above 3000); pool 1 bitcoin 77191.92 USD -> YES (below 100000).
Simulate --broadcast: pool 0 tx 0xae225bc0204c3ed173bfb9b5822762b64e3e14b39ae0c28697dd65d56ce9dcea (resolved NO, priceE18 2238207897607361000000); pool 1 tx 0x6081de27b47975572a167ecb54050f2f5aadb439be8131a618d9a049ff1608f1 (resolved YES, priceE18 77188555839862970000000). getDuePoolIds(10) -> []. Cost ~0.0000013 ETH.
Claims: Account 2 claimed pool 0 -> +98 USDC (tx 0xa154d06ea687fd23475e8f7384638b0077a5091e195a0d24b016156031d79ae4); Account 1 claimed pool 1 -> +49 USDC (tx 0xb2493412a02820b9aca3f4a1dde85b15d0409f1e81db4da7bf9b331663f99524); treasury (Account 1) received 2 + 1 USDC fees; pool balance 175 -> 25 (pool 2 open stakes). Loser claim reverts NothingToClaim.
Pool 3 "Will $ETH be below $2500 at 04:39 UTC on 31 Oct?" created (tx 0xb9b77db3c1f75bfc55d0379f21e6a167e134d2eede3d0489ecd9c73f6771edd6) so an awaiting pool exists for the dashboard.

## T-B07 / T-B09 live verification  (B, 2026-10-31 10:13 IST)
`pnpm vitest run --config vitest.live.config.ts test/live/pools.live.test.ts` against Base Sepolia -> 1 passed. Backend /pools: 3 awaiting, 2 open, 1 resolved yes (77188.56), 0 resolved no (2238.21); every field equals getPool. Position for Account 2 on pool 0 shows claimed true. Demo will run on localhost; T-B10 hosting deferred.

## Testnet-only end-to-end build, M0 to M3  (A+B, 2026-11-06)
Plan approved by the human (decisions D-T1 to D-T7 in DECISIONS.md): testnet only, Swap tab shows real Flash quotes and never submits, pools settled by a local CRE-simulation loop, no mock mode in the product.
M0: B-005 resolved (shared fixtures now equal buildQuestion output, with a test). FLASH_ORDERS_ENABLED (default false) makes POST /flash/order answer FLASH_ERROR in real mode before any quote is read; 5 new tests. SIGTERM shutdown test skipped on Windows. Pool row mapping (toPool, toPosition, RawPool) moved to @predictx/shared so the UI refreshes from the chain with the same code; backend tests unchanged and green (477 pass, 1 skipped on Windows).
M1 (code done, run pending): scripts/resolver-loop.ts and scripts/e2e-lifecycle.ts typecheck and fail fast with clear messages. Not run end to end: needs the cre CLI and funded TEST_WALLET_A/B and CRE_ETH_PRIVATE_KEY keys.
M2: packages/ui (API client, wallet actions, controllers, helpers): 57 unit tests; live parity test passes against Base Sepolia (backend pools and positions equal direct chain reads, field for field).
M3: apps/extension rebuilt on @crxjs/vite-plugin 3 (legacy prototype removed): MV3 manifest, service-worker API gateway (not an open proxy, coalesces GETs), MAIN-world wallet bridge built as a 1.7 kB IIFE, Shadow DOM overlay with tokens and Tailwind inside the root, fonts via the FontFace API. 32 extension tests. `vite build` is clean; the build output contains no key names. Browser load check on x.com is still to do.
New copy strings (not in the written deck): "Connect wallet", "Testnet-only build: orders are not sent.", "Review only", "Settled by Chainlink CRE (simulation)", plus the plain error sentences in packages/ui/src/errors.ts.

## M4 and M5: hover card and Create panel  (A, 2026-11-06)
M4: cashtag detector (allowlist from /tokens, MutationObserver, skips composers, stops and restores the page if it ever throws), hover store with the 300/150 ms timings and card placement, token card with live /market data ("Price delayed" on a failed or old refresh), Insight tab on the real endpoint, Swap tab that fetches real Flash quotes and stops at a disabled "Place order" with "Testnet-only build: orders are not sent." (D-T1). A quote whose id starts with q_mock_ gets a visible MOCK badge.
M5: Create panel builds the exact onchain question (strike canonicalised, resolve time rounded up to a whole minute so the HH:MM shown is the real settle time, measured against block time not the local clock) and Post step opens x.com/intent/post with buildTweetText.
Found by live test: the shared ABI had no custom errors, so every contract revert surfaced as a generic error. Added the PredictionPool and MockUSDC errors to packages/shared/src/abi.ts (additive, mirrors the Solidity). The keyless live test (packages/ui/test/live/createSimulation.live.test.ts) now proves, against the deployed contract: createPool accepts the exact arguments for ETH/PEPE/BTC, a too-soon close time maps to RESOLVE_TOO_SOON, an over-long question is refused, claiming a missing pool maps to POOL_NOT_FOUND.
Tests: shared 8, ui 62 (+6 live), backend 477 (+1 skipped on Windows), extension 67. Extension builds clean.

## M6 dashboard  (A, 2026-11-06)
apps/dashboard (Vite + React Router + Tailwind): `/` latest 20 pools refreshed every 10 s, `/pool/:id` (shared PoolSlip, position, details, copy link, Post to X), `/faucet` (mint 100 test USDC, live balance). The PoolSlip lives in @predictx/ui so the tweet bet box (M7) reuses it. After a transaction the pool is read straight from the chain for 20 s (the backend caches 10 s). `stake` reports its two steps (approve exact amount, then bet) so the screen can name each wallet prompt.
Verification: `tsc` and `vite build` clean, no key names in dist. 14 render tests of PoolSlip assert the exact deck copy for open, empty, awaiting, resolved winner/loser/claimed, void, and the wallet gates (no MetaMask, not connected, wrong network). Not verified: a visual check in a browser. The Chrome tool in this session runs on a different network than the dev machine and could not reach localhost, so the human must look at http://localhost:5173.
Dev servers listen on both IPv4 and IPv6 (`host: "::"`).

## M7 bet box under posts  (A, 2026-11-06)
observePostBoxes keeps one shadow-root box under every post whose text has PX#<id> or /pool/<id> (digits only, absurd ids refused), re-creates a box x.com removed, removes boxes for posts that left. The slip is the same PoolSlip as the dashboard. Isolation: key events inside our UI stop at our host (x.com shortcuts j/k/n// stay quiet), clicks inside a box stop before the post's open-this-post handler, Escape is handed to us. Slip notch colour is read from the post's painted background. Tests: 83 in the extension (observer, mount isolation, no page styles added).

