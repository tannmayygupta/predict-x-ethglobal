# DECISIONS.md

## Locked stack (no substitutions)

| Layer | Choice |
| --- | --- |
| Monorepo | pnpm workspaces, TypeScript (strict) |
| Extension | Chrome MV3, React 18, Vite + `@crxjs/vite-plugin`, Tailwind CSS, Shadow DOM overlay |
| Dashboard | React 18 + Vite SPA, React Router, Tailwind, deployed on Vercel |
| Wallet / chain client | `viem`, MetaMask only |
| Backend | Node 22 (see D-B10), Fastify, `zod`, `pino`, `better-sqlite3` (no ORM) |
| LLM | OpenAI API, official `openai` SDK, Structured Outputs; model id in `OPENAI_MODEL` |
| Prices | CoinGecko API (one source: popup, agent and CRE) |
| Execution | Definitive Flash REST API, backend only, Base mainnet, `$5` max per order |
| Contracts | Solidity 0.8.24, Foundry, OpenZeppelin (`SafeERC20`, `ReentrancyGuard`) |
| Pool chain | Base Sepolia (84532), `MockUSDC` (6 decimals, public mint) |
| Oracle | Chainlink CRE, TypeScript SDK, `cre` CLI simulation |
| Fonts | `@fontsource-variable/bricolage-grotesque`, `@fontsource-variable/instrument-sans` (bundled, never remote) |
| Tests | Vitest (shared, backend), Foundry (contracts) |

## Decision log

| ID | Decision | Why |
| --- | --- | --- |
| D-001 | Flash on Base **mainnet**, pools on Base Sepolia | Flash's chain list has no testnet |
| D-002 | MVP supports **buy only** (spend USDC, receive ETH) | Selling ETH needs a native-wrap step |
| D-003 | Pools read through the backend; writes go straight to the contract | One simple read API, no indexer |
| D-004 | No user accounts or sessions | Wallet address in request bodies is enough for a demo |
| D-005 | One price source for everything | Fewer failure points in the demo |
| D-006 | Pool lock time = resolve time | Simpler contract; no early lock |
| D-007 | All overlay UI on X, no toolbar popup form | One wallet path (page bridge) |
| D-008 | The dashboard link is the source of truth for a pool | The tweet's marker `PX#id` or link may not survive X rendering |

## Backend decisions (2026-10-29, implemented in apps/backend)

| ID | Decision | Why |
| --- | --- | --- |
| D-B1 | Flash quotes are single-use; the claim (markUsed) happens before submit, so a failed submit spends the quote and the client must re-quote | Flash can create or fill an order and still answer 4xx; never auto-retry a signed submit |
| D-B2 | GET /flash/order/:id returns the last stored detail (200, updatedAt unchanged) when Flash errors, including 404 lag | Flash get-order lags a fresh submit by up to ~30 s; polling must survive it |
| D-B3 | Terminal order statuses (filled, failed, expired) are served from SQLite without calling Flash | Saves the 5 req/s Flash budget during 3 s polling |
| D-B4 | Degraded insights are not cached | Recovery is immediate once the key is fixed |
| D-B5 | Market and pool reads serve a stale cache entry on upstream failure; 502 INTERNAL only with no cache | Keeps the hover card and dashboard alive through CoinGecko or RPC blips |
| D-B6 | Backend env gains DASHBOARD_URL for Pool.dashboardUrl, plus LOG_LEVEL, TRUST_PROXY (false or a trusted hop count, 1 on Railway or Render; "true" is rejected because it lets clients spoof x-forwarded-for), VALIDATE_RESPONSES | API_CONTRACT needs the dashboard origin server-side |
| D-B7 | 7d change comes from CoinGecko coins/markets?price_change_percentage=7d (lazy, 300 s cache); simple/price is called with precision=full | simple/price has no 7d field; without precision=full PEPE rounds to 5.0e-06 |
| D-B8 | Response validation against shared schemas runs as a preSerialization hook when VALIDATE_RESPONSES=true (default) | Catches contract drift at runtime without altering payloads |
| D-B9 | Backend runs TypeScript through tsx in dev and prod (start = tsx src/server.ts); no dist bundle | @predictx/shared is consumed as TS source |
| D-B10 | Backend requires Node >= 22 (better-sqlite3 13 and openai 7 prebuilds); root engines and the stack table should move from Node 20 to 22 | Pinned versions chosen from docs/notes/backend-stack.md |
| D-B11 | Rate limiting is an in-house fixed-window plugin on an injectable clock (no @fastify/rate-limit) | Window reset is testable without sleeping; no extra dependency |
| D-B12 | Flash status mapping: PENDING/UNSPECIFIED -> submitted, ACCEPTED/PARTIALLY_FILLED -> open, FILLED -> filled, CANCELLED/REJECTED/TERMINATED -> expired when closeReason is REASON_ORDER_EXPIRED else failed; txHash = last fill transactionId; expiresAt = quote time + 60 s | Flash exposes 8 statuses and no quote expiry; marked GATE0: confirm in flash.map.ts |
| D-B13 | HttpFlashClient keeps the original Flash quote body in memory per quoteId until expiry | Flash POST /order requires every trade field resent; a restart inside the 60 s window invalidates open quotes |
| D-B14 | The PredictionPool ABI the backend reads is defined in packages/shared/src/abi.ts; T-B06 must implement it unchanged | Backend and dashboard were built before the contract |
| D-B15 | OpenAI call: responses.parse with strict json_schema derived from InsightResponse, max_output_tokens 300, reasoning effort none, store false, maxRetries 0, 8 s timeout; empty key boots fine and answers degraded | FR-B-03 and FR-I-03 |

## Testnet-only build decisions (2026-11-06, approved by the human)

| ID | Decision | Why |
| --- | --- | --- |
| D-T1 | The Swap tab shows real Flash quotes but never submits an order; the backend enforces it with `FLASH_ORDERS_ENABLED` (default false, real mode only) | Flash has no testnet; this build uses no mainnet funds |
| D-T2 | Pools are settled by a local loop (`scripts/resolver-loop.ts`) that runs `cre workflow simulate --broadcast` through the MockKeystoneForwarder; the UI labels it a CRE simulation | A deployed workflow needs a redeployed pool and CRE deploy access |
| D-T3 | `packages/ui` holds the API client, chain controllers and React pieces shared by the extension and the dashboard | The bet box must reuse the dashboard components (T-A14) without copying them |
| D-T4 | No MSW mock server (T-A02 dropped); the frontends talk to the real local backend and the chain | Nothing in the product may be faked |
| D-T5 | The extension calls the backend through its service worker, which coalesces identical GETs | Avoids x.com CORS/CSP/Private Network Access limits and the 60 req/min rate limit |
| D-T6 | After a transaction the UI re-reads the affected pool and position from the chain with viem | The backend caches pool reads for 10 s |
| D-T7 | Composer link is `x.com/intent/post` | Resolves the open item below |

## Open items (a human must confirm; an agent never decides these)

- [ ] Flash order status values and the `GET /order/{id}` response (Gate 0 records them in `docs/GATE0.md`)
- [x] Whether Definitive offers a Base Sepolia sandbox: no, the Flash FAQ says test on mainnet with small amounts (docs/notes/flash-api.md)
- [x] Whether CRE supports Base Sepolia: yes. `cre workflow supported-chains` (2026-10-31) lists ethereum-testnet-sepolia-base-1, selector 10344971235874465080, forwarder 0xF8344CFd5c43616a4366C34E3EEE75af79a74482, mock forwarder 0x82300bd7c3958625581cc2f77bc6464dcecdf3e5
- [x] Whether `cre workflow simulate` can broadcast the report onchain: yes, via `--broadcast` through the MockKeystoneForwarder (2026-10-31). Deployed workflows need a pool redeployed with KeystoneForwarder 0xF8344CFd5c43616a4366C34E3EEE75af79a74482
- [x] The exact current OpenAI model id for `OPENAI_MODEL`: `gpt-6-luna` (cheapest non-deprecated; gpt-5-nano shuts down 2026-12-11 and lacks reasoning effort none; gpt-4.1-nano shut down 2026-10-23). Chosen by the human on 2026-10-30.
- [ ] ETHGlobal rule: how many sponsor prizes one project may enter
- [x] Whether the composer link is `x.com/intent/tweet` or `x.com/intent/post` on demo day: `intent/post` (D-T7, 2026-11-06)
- [ ] Dashboard domain for `VITE_DASHBOARD_URL`
- [ ] zod range: apps/backend and packages/shared declare ^3.23.8 but openai/helpers/zod needs >= 3.25 (lockfile has 3.25.76); bump both together
- [ ] maxSlippage for $5 Flash orders: Flash recommended 0.15 for a $2 buy; our default is 0.01 (docs/notes/flash-api.md section 11)
