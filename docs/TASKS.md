# TASKS.md

Status values: `todo`, `doing`, `done`, `blocked`. Only change the status of your own tasks. Owners: **A** = Agent A, **B** = Agent B, **H** = human.
Pick the first `todo` task for your role whose `deps` are all `done` (see `AGENT.md`).

## Index

| ID | Title | Owner | Deps | Status |
| --- | --- | --- | --- | --- |
| T-001 | Verify scaffold | B | none | done |
| T-002 | Deploy stub contracts and publish ABI | B | T-001 | done |
| T-003 | Gate 0: one real Flash limit order | B | T-001 | blocked |
| T-A01 | Extension scaffold and overlay mount | A | T-001 | todo |
| T-A02 | MSW mock server from fixtures | A | T-001 | todo |
| T-A03 | Page bridge and wallet client | A | T-A01 | todo |
| T-A04 | Cashtag detector and hover trigger | A | T-A01, T-A02 | todo |
| T-A05 | Token card shell (A1) | A | T-A04 | todo |
| T-A06 | Swap tab: market order (A2) | A | T-A05, T-A03 | todo |
| T-A07 | Swap tab: limit order | A | T-A06 | todo |
| T-A08 | Insight tab (A3) | A | T-A07 | todo |
| T-A09 | Create panel and launcher (A4) | A | T-A03, T-002 | todo |
| T-A10 | Post step (A5) | A | T-A09 | todo |
| T-A11 | Dashboard scaffold, routing, wallet | A | T-A02, T-A03 | todo |
| T-A12 | Pool page: bet, claim, refund (D2) | A | T-A11, T-002 | todo |
| T-A13 | Dashboard home and faucet (D1, D3) | A | T-A12 | todo |
| T-A14 | Bet box on tweets (A6) | A | T-A12, T-A04 | todo |
| T-A15 | States, copy and polish pass | A | T-A14, T-A08 | todo |
| T-A16 | Switch to real backend, run merge checklist | A | T-B10, T-A15 | todo |
| T-B01 | Backend scaffold | B | T-001 | done |
| T-B02 | Tokens and market endpoints | B | T-B01 | done |
| T-B03 | Flash client with mock mode | B | T-B01 | done |
| T-B04 | Flash endpoints | B | T-B03, T-003 | doing |
| T-B05 | Insight endpoint (OpenAI) | B | T-B02 | done |
| T-B06 | PredictionPool contract and tests | B | T-002 | done |
| T-B07 | Pool read endpoints | B | T-B06, T-B01 | done |
| T-B08 | CRE workflow and simulation | B | T-B06 | done |
| T-B09 | Seed demo pools | B | T-B06, T-B08 | done |
| T-B10 | Deploy backend | B | T-B04, T-B05, T-B07 | doing |
| T-I01 | Merge checklist (first run) | H | T-A16 | todo |
| T-I02 | Demo rehearsal x2 | H | T-I01 | todo |
| T-I03 | Record and post the demo | H | T-I02 | todo |

## Foundation

### T-001 Verify scaffold
- owner: B | status: done | deps: none | reqs: NFR-02
- do: `pnpm install`, `pnpm typecheck`, `pnpm test`. Do not change shared code.
- done when: all three pass and the output is pasted in `WORKLOG.md`.

### T-002 Deploy stub contracts and publish ABI
- owner: B | status: done | deps: T-001 | reqs: FR-C-01, FR-C-02, FR-C-08
- do: Foundry project in `contracts/`. `MockUSDC` (6 decimals, `mint(to, amount)` public, max 1,000 USDC per call). A `PredictionPool` with the full interface from `API_CONTRACT.md` section 4 and views; payout and `onReport` may be stubs. Deploy both to Base Sepolia. Write addresses into `.env.example` comments and `packages/shared/src/deployments.ts`; export the ABI to `packages/shared/src/abi.ts`.
- done when: addresses exist, `forge build` passes, Agent A can import the ABI. Message in `WORKLOG.md`: "stub deployed".

### T-003 Gate 0: one real Flash limit order
- owner: B | status: blocked | deps: T-001 | reqs: FR-S-03, FR-B-02  (see B-002)  (scripts/gate0-flash.ts is written; needs FLASH_API_KEY and a funded wallet)
- read: `API_CONTRACT.md` section 6
- do: script `scripts/gate0-flash.ts` that, with a funded Base wallet, requests a Flash quote (buy ETH with USDC, limit order, at most $5), handles `approveTx` and signatures, submits, then polls. Write `docs/GATE0.md`: working request and response shapes, order status values, token addresses, whether an approve is needed, quote lifetime, any surprise.
- done when: Flash accepted the order (status `open` or `filled`) and `docs/GATE0.md` exists. If it fails, write a blocker `Flash gate failed` and stop all Flash tasks.
- note: needs `FLASH_API_KEY` and a funded wallet from a human. Write a blocker if missing.

## Part A: extension and dashboard (Agent A)

### T-A01 Extension scaffold and overlay mount
- owner: A | status: todo | deps: T-001 | reqs: FR-X-04 | read: UI_REFERENCE sections 1, 2
- do: `apps/extension` with Vite and `@crxjs/vite-plugin`, React, Tailwind, MV3 manifest for `https://x.com/*` and `https://twitter.com/*`. Content script mounts a Shadow DOM root; import `design-tokens.css` inside it. Bundle the two fonts. Empty launcher pill.
- done when: loading the unpacked extension on x.com shows the pill with correct styling, and x.com styles are untouched.
- note (2026-10-29 audit): `apps/extension` currently holds the legacy v2.1 design prototype (plain Vite, npm-era, hardcoded data, no shared package). Reuse `public/manifest.json` host config, the Shadow DOM mount in `src/content.tsx:71-83`, the `chrome.storage` showOverlay toggle and `service-worker.js`. Replace the two vite configs with `@crxjs/vite-plugin`, rename the package to `@predictx/extension`, add the `@predictx/shared` workspace dep, drop the side-panel app (`sidepanel.html`, `src/main.tsx`; overlay-only per D-007). Fix the old "Predidex" brand strings.

### T-A02 MSW mock server from fixtures
- owner: A | status: todo | deps: T-001 | reqs: NFR-05
- do: MSW handlers for all 10 endpoints in `API_CONTRACT.md` returning `packages/shared/src/fixtures.ts`. Support `?fail=<ErrorCode>` and a `?delay=<ms>`. A `MOCK` flag shows the mock badge. Shared by extension and dashboard dev builds.
- done when: every endpoint answers in a browser test and error modes work.

### T-A03 Page bridge and wallet client
- owner: A | status: todo | deps: T-A01 | reqs: FR-X-05
- do: main-world script registered for x.com that exposes `window.ethereum` calls via `postMessage` (request id, method, params, result or error). `getWalletClient()` returns a `viem` wallet client for the overlay (through the bridge) and for the dashboard (direct). Support: connect, chain switch (add Base Sepolia if missing), send transaction, `eth_signTypedData_v4` with a JSON string payload.
- done when: from the overlay you can connect, switch network and sign a test typed-data message.

### T-A04 Cashtag detector and hover trigger
- owner: A | status: todo | deps: T-A01, T-A02 | reqs: FR-X-01, FR-X-02
- do: fetch `/tokens`; `MutationObserver` on the timeline; wrap allowlisted `$SYMBOL` text in a span (amber underline) without breaking X's DOM; hover timings from `UI_REFERENCE` section 6. All X selectors in `xSelectors.ts`.
- done when: only allowlisted tags highlight, scrolling loads are handled, hover opens a placeholder card.
- note (2026-10-29 audit): legacy `src/content.tsx:22-43` has a mouseover regex for $BTC/$ETH/$SOL/$PEPE with a 240 ms hide delay; starting point only. No allowlist fetch, MutationObserver, highlight span or spec timings yet.

### T-A05 Token card shell (A1)
- owner: A | status: todo | deps: T-A04 | reqs: FR-X-02, FR-X-03 | read: UI_REFERENCE A1
- done when: header shows market data from `/market/:symbol`, address copy works, tabs switch, loading, error and stale states are reachable via the mock.
- note (2026-10-29 audit): legacy card is a static stub with hardcoded prices; roughly 5% reusable. Rebuild against `/market/:symbol`.

### T-A06 Swap tab: market order (A2)
- owner: A | status: todo | deps: T-A05, T-A03 | reqs: FR-S-01, FR-S-02, FR-S-04, FR-S-05, FR-S-06, FR-S-07 | read: API_CONTRACT quote and order shapes
- do: form, quote summary, stepper, approve then sign then submit then poll, filled state, error states. Typed data passes through unchanged.
- done when: against the mock the full flow reaches Filled; with the real backend (later) a $1-5 order fills.
- note (2026-10-29 audit): legacy "Set Trade" UI is a static preview with a fake wallet picker; no viem, no quote call. Rebuild.

### T-A07 Swap tab: limit order
- owner: A | status: todo | deps: T-A06 | reqs: FR-S-03
- done when: Limit option sends `limitPriceUsd`; `open` status shows "Waiting for price".

### T-A08 Insight tab (A3)
- owner: A | status: todo | deps: T-A07 | reqs: FR-I-01, FR-I-02, FR-I-03
- done when: tip, badges, degraded notice, and "Use suggested limit" filling the Limit tab all work in the mock.

### T-A09 Create panel and launcher (A4)
- owner: A | status: todo | deps: T-A03, T-002 | reqs: FR-P-01, FR-P-02
- do: form, preview via `buildQuestion`, strike via `toStrikeE18`, network switch, `createPool` with the shared ABI, read `poolId` from the receipt.
- done when: a pool is created on Base Sepolia and the id is shown.
- note (2026-10-29 audit): legacy launcher is a round logo button, not the pill; create flow is a static preview. Rebuild.

### T-A10 Post step (A5)
- owner: A | status: todo | deps: T-A09 | reqs: FR-P-03
- done when: composer opens with `buildTweetText` output; copy-link and open-pool buttons work.
- note (2026-10-29 audit): legacy code opens `x.com/intent/tweet` with prefilled text; confirm `intent/tweet` vs `intent/post` (DECISIONS open item).

### T-A11 Dashboard scaffold, routing, wallet
- owner: A | status: todo | deps: T-A02, T-A03 | reqs: FR-P-06 | read: UI_REFERENCE D1 to D3 layout, top bar
- done when: routes `/`, `/pool/:id`, `/faucet` render with the top bar, wallet connect and network pill.

### T-A12 Pool page: bet, claim, refund (D2)
- owner: A | status: todo | deps: T-A11, T-002 | reqs: FR-P-05, FR-P-06, FR-P-07, FR-P-09
- do: Slip component, OddsBar, Countdown, exact-amount approve, `stake`, `claim`, `refund`, position panel, refetch every 10 s and after transactions.
- done when: all pool statuses (open, awaiting, resolved winner, resolved loser, void) render correctly from fixtures, and a real stake on the stub contract works.

### T-A13 Dashboard home and faucet (D1, D3)
- owner: A | status: todo | deps: T-A12 | reqs: FR-P-08
- done when: home lists pools with empty, loading and error states; faucet mints test USDC.

### T-A14 Bet box on tweets (A6)
- owner: A | status: todo | deps: T-A12, T-A04 | reqs: FR-P-04
- do: detect `PX#<id>` or `/pool/<id>` in tweet text with `extractPoolId`; inject the Slip under the tweet; reuse the D2 components.
- done when: the box appears only on matching tweets; staking works from the box.

### T-A15 States, copy and polish pass
- owner: A | status: todo | deps: T-A14, T-A08 | reqs: NFR-05
- done when: every screen in `UI_REFERENCE.md` section 8 checklist passes, using `?fail=` mock modes to view all error states.

### T-A16 Switch to real backend, run merge checklist
- owner: A | status: todo | deps: T-B10, T-A15 | reqs: FR-B-01
- do: set `VITE_API_BASE_URL` to the deployed backend; fix only frontend-side mismatches; if a contract mismatch exists write a `CONTRACT CHANGE` blocker.
- done when: the merge checklist below passes.

## Part B: backend, contracts, CRE (Agent B)

### T-B01 Backend scaffold
- owner: B | status: done | deps: T-001 | reqs: FR-B-05, FR-B-06, FR-B-07
- do: Fastify app, zod validation using shared schemas, error handler producing `ApiError`, CORS from `ALLOWED_ORIGINS`, rate limits, pino logs, SQLite with the three tables (`quotes`, `orders`, `insights`), `GET /health`.
- done when: health works, a validation failure returns `BAD_REQUEST` in the shared shape, tests pass.

### T-B02 Tokens and market endpoints
- owner: B | status: done | deps: T-B01 | reqs: FR-B-01
- do: `GET /tokens` from `tokens.json`; `GET /market/:symbol` from CoinGecko `simple/price` (price and 24h change), 30 s memory cache, `UNSUPPORTED_TOKEN` for unknown symbols.
- done when: both endpoints parse with their schemas; tests cover happy and unsupported paths.

### T-B03 Flash client with mock mode
- owner: B | status: done | deps: T-B01 | reqs: FR-B-02, FR-S-07
- do: `FlashClient` with `quote()`, `submit()`, `status()`. `FLASH_MOCK=true` returns fixtures. Real mode implements the adapter in `API_CONTRACT.md` section 6.
- done when: mock mode passes schema tests; real mode compiles and is unit-tested with recorded fixtures.

### T-B04 Flash endpoints
- owner: B | status: doing | deps: T-B03, T-003 | reqs: FR-B-02, FR-S-04  (mock mode complete; real-mode done-when waits on T-003, see B-002)
- do: `POST /flash/quote` (validate, enforce `MAX_FLASH_TRADE_USD`, store quote), `POST /flash/order` (look up quote, `QUOTE_EXPIRED` if past `expiresAt`, submit, store order), `GET /flash/order/:orderId`. Typed data strings pass through unchanged. Use the shapes recorded in `docs/GATE0.md`.
- done when: a real $1-5 limit order goes through the backend end to end and the status is returned in our shape.

### T-B05 Insight endpoint (OpenAI)
- owner: B | status: done | deps: T-B02 | reqs: FR-B-03, FR-I-03, FR-I-04
- do: build input (symbol, price, 24h and 7d change, optional `userIntent`); one OpenAI call with Structured Outputs; validate with `InsightResponse`; clamp `suggestedLimit` to within 15% of spot; one retry; static fallback with `degraded: true`; 5-minute cache; 300 max output tokens. No tweet text, no tools.
- done when: a real call works; with an invalid key the endpoint still returns 200 and `degraded: true`.

### T-B06 PredictionPool contract and tests
- owner: B | status: done | deps: T-002 | reqs: FR-C-01 to FR-C-08
- do: full implementation per `REQUIREMENTS.md` section F. Foundry tests for every row, including the $60/$40 payout example. Redeploy to Base Sepolia keeping the same ABI; update `deployments.ts`.
- done when: `forge test` passes and the new address is recorded.

### T-B07 Pool read endpoints
- owner: B | status: done | deps: T-B06, T-B01 | reqs: FR-B-04
- do: `GET /pools`, `GET /pools/:id`, `GET /pools/:id/position` via viem reads, 10 s cache, shared helpers for `status`, `claimable`, `refundable`, `dashboardUrl` from env.
- done when: responses equal the contract state for seeded pools.

### T-B08 CRE workflow and simulation
- owner: B | status: done | deps: T-B06 | reqs: FR-R-01 to FR-R-05
- do: `cre/` TypeScript workflow per `REQUIREMENTS.md` section G. Use `.result()` pattern. Config for pool address, chain, schedule; CoinGecko key as a CRE secret. Simulate with a 2-minute pool. Determine whether simulation can broadcast; if not, resolve the pool through the mock forwarder and state that in `WORKLOG.md`.
- done when: a due pool is resolved and the simulation output (price, outcome, report) is pasted in `WORKLOG.md`. Write blockers for access or forwarder questions.

### T-B09 Seed demo pools
- owner: B | status: done | deps: T-B06, T-B08 | reqs: FR-P-08
- do: `scripts/seed-pools.ts` creates three pools: one open (4 h), one awaiting, one resolved, with stakes from two wallets.
- done when: the dashboard home shows all three states.

### T-B10 Deploy backend
- owner: B | status: doing | deps: T-B04, T-B05, T-B07 | reqs: FR-B-06, NFR-02  (deferred by the human on 2026-10-31: demo runs on localhost; hosting only if time allows)
- do: deploy to Railway or Render with env vars; set `FLASH_MOCK=false`; confirm CORS for the dashboard origin and `https://x.com`.
- done when: `GET /health` works from the public URL; the URL is written in `WORKLOG.md`.

## Integration (human)

### Merge checklist (run at T-I01 and again before recording)

- [ ] Every real endpoint response passes the zod schema the frontend uses
- [ ] Error responses show a readable message in the UI
- [ ] `steps.orderTypedData` goes backend -> wallet -> `POST /flash/order` unchanged
- [ ] A real $1-5 swap fills and the BaseScan link opens the transaction
- [ ] A pool created in the extension shows the same question on the dashboard and in the post text
- [ ] Stake, CRE resolve, claim pays what the page predicted
- [ ] Wrong network, no USDC and expired-quote paths show their messages
- [ ] CORS works from `x.com` pages and the dashboard
- [ ] No API keys in the extension or dashboard bundle (`grep` the build output)

### Demo script (3 minutes)

1. **Swap (30 s).** Hover `$ETH` on X. Show price and address. Place a $2 market swap, sign, show Filled and the BaseScan link.
2. **Insight to limit (30 s).** Open Insight, read the tip, press "Use suggested limit", sign, show the order open on Flash.
3. **Create (30 s).** Press the PredictX pill, choose `$PEPE`, above a strike, 3 minutes. Confirm. Press "Post to X" and show the prefilled post.
4. **Bet (30 s).** Open the link in a second window. Stake YES from one wallet and NO from another using test USDC.
5. **Resolve (45 s).** Run the CRE simulation, show the fetched price and the report, refresh the dashboard to show Resolved.
6. **Claim (15 s).** Winner claims; show the payout with the 2% fee.

Say out loud: the pool uses test funds on Base Sepolia; the Flash swap uses real funds on Base mainnet. Never present a simulation as a real execution. If time runs short, cut in this order: Insight tab, bet box on tweets (keep the dashboard link), limit orders, then the Flash track entirely. Never cut CRE resolution or the payout.
