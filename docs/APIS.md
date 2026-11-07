# APIS.md

Every external API PredictX uses or needs. Checked against the code on 2026-11-07. Vendor details: `docs/notes/`. Definitive Flash has its own page: `docs/DEFINITIVE.md`.

Status legend: **used** (called by the product today), **available** (works for us, nothing calls it), **blocked** (needs a human).

## Summary

| API | Status | Auth env var | Owner file |
| --- | --- | --- | --- |
| Definitive Flash `POST /quote` | used | `FLASH_API_KEY` | `apps/backend/src/clients/flash.http.ts` |
| Definitive Flash `POST /order`, `GET /orders/{id}` | implemented, disabled (D-T1) | `FLASH_API_KEY` | same |
| Definitive Flash `GET /balances/{address}` | available | `FLASH_API_KEY` | none |
| Definitive Flash `GET /search` | blocked (403, B-008) | `FLASH_API_KEY` | none |
| CoinGecko `/coins/markets` | used | `COINGECKO_API_KEY` | `apps/backend/src/clients/coingecko.ts` |
| CoinGecko `/coins/{id}/market_chart` | used | `COINGECKO_API_KEY` | same |
| CoinGecko `/onchain/networks/{network}/tokens/{address}` | used | `COINGECKO_API_KEY` | same |
| CoinGecko `/simple/price` (Chainlink workflow only) | used | `CRE_COINGECKO_API_KEY` | `cre/resolve-pools/src/coingecko.ts` |
| OpenAI Responses API, `gpt-6-luna` | used | `OPENAI_API_KEY`, `OPENAI_MODEL` | `apps/backend/src/clients/openai.ts` |
| Base Sepolia RPC through viem | used | none | `apps/backend/src/clients/chain.ts`, `packages/ui` |
| Base mainnet RPC | not used by the product | none | none |
| BaseScan | links only | none | `packages/shared/src/constants.ts` |
| Chainlink CRE CLI | used (local simulation) | `CRE_API_KEY` or `cre login`, `CRE_ETH_PRIVATE_KEY` | `scripts/resolver-loop.ts` |
| x.com content security policy | constraint | none | `apps/extension/src/background/apiProxy.ts` |
| Vercel | deploy target, blocked on secrets (B-007) | Vercel project env | `vercel.json` |

All keys live in `.env` (git-ignored) or in the host's secret store. No key reaches the extension or dashboard bundles; `scripts/check-bundles.ts` scans for key names, key shapes and the actual values.

## Definitive Flash (swap quotes)

| | |
| --- | --- |
| Used for | Swap quotes on Base mainnet and the swap factors (cost, minimum received, deadline). Quote-only in this build. |
| Base URL | `FLASH_BASE_URL`, default `https://flash.definitive.fi/v1` |
| Auth | `FLASH_API_KEY` in the `x-definitive-api-key` header. `FLASH_MOCK=true` skips the network and returns `q_mock_` quotes. |
| Endpoints | Used: `POST /quote`. Implemented but off: `POST /order`, `GET /orders/{id}?funderAddress=` (`FLASH_ORDERS_ENABLED=false`). Available, unused: `GET /balances/{address}`, `GET /orders`. Blocked: `GET /search` (403 `SEARCH_NOT_ELIGIBLE`). |
| Rate limit | Flash: 5 requests per second per endpoint per key. Ours: 60 requests per minute per client, so a re-quote is an explicit button. |
| Cache | None for quotes. A quote is stored in SQLite and valid 60 s (our rule). |
| Timeout | 5 s |
| On failure | Flash 5xx or timeout: `FLASH_ERROR` "flash unavailable", the UI shows the plain message and the user retries. Flash 4xx: the reason is relayed with the key scrubbed. Missing key with `FLASH_MOCK=false`: requests fail with `FLASH_ERROR`. |
| Owner | `apps/backend/src/clients/flash.http.ts`, mapping in `flash.map.ts`, `flash.factors.ts`, service `services/flash.ts` |

## CoinGecko (prices, market stats, chart, liquidity)

One source for price data (D-005). Demo plan: 100 calls per minute, 10,000 credits per month (`docs/notes/coingecko-api.md`). Key header `x-cg-demo-api-key` on `api.coingecko.com`; `x-cg-pro-api-key` on `pro-api.coingecko.com`. Env: `COINGECKO_API_KEY`. Without a key the calls are keyless and 429 quickly.

| Endpoint | Used for | Cache | Failure |
| --- | --- | --- | --- |
| `GET /coins/markets` (all allowlist ids in one call, `precision=full`, 24h and 7d changes) | price, 24h and 7d change, market cap, 24h volume, 24h high and low fallback | 60 s, single-flight, last good value served up to 15 min, then 502 | stale value, else `INTERNAL` 502 |
| `GET /coins/{id}/market_chart` (`days=1` or `7`, `precision=full`) | `GET /market/:symbol/chart`; 24h high and low; insight statistics | 300 s (24h), 900 s (7d), single-flight, stale up to 1 h, 30 s failure backoff | stale series, else 502; market never fails because of it |
| `GET /onchain/networks/{network}/tokens/{address}` | `liquidityUsd` (`total_reserve_in_usd`, truncated to cents; the value carries a junk tail of about 200 digits) | 600 s, 60 s failure backoff | `liquidityUsd: null`; 404 (no pool, for example BTC) is also null |

Rate limiting: a 429 opens a window (the `Retry-After` header, else 60 s, capped at 600 s) in which no request leaves the backend and only cache is served. Timeout 3 s. Owner: `apps/backend/src/clients/coingecko.ts`, services `services/market.ts` and `services/chart.ts`.

The Chainlink workflow reads `GET /simple/price?ids=...&vs_currencies=usd&precision=full` with `CRE_COINGECKO_API_KEY` (same Demo key, a separate variable, because the CRE run does not read `COINGECKO_API_KEY`). Owner: `cre/resolve-pools/src/coingecko.ts`. Empty works but gets 429 quickly.

## OpenAI (AI insight)

| | |
| --- | --- |
| Used for | The Insight tab: bias, confidence, tip and a suggested limit price. Text and numbers only, no tools, no tweet text. |
| API | Responses API through the official `openai` SDK (`responses.parse`, strict json_schema, reasoning effort none, `store: false`, `max_output_tokens` 300) |
| Model | `OPENAI_MODEL=gpt-6-luna` (chosen by the human, 2026-10-30) |
| Auth | `OPENAI_API_KEY` |
| Rate limit | Ours: 10 insight requests per minute per client. OpenAI limits depend on the account. |
| Cache | 300 s per symbol and intent; degraded answers are never cached (D-B4) |
| Timeout and retry | 5 s. One retry for a fast transient failure only; none on 401, a refusal or a timeout. Worst case about 6 s. |
| On failure | The endpoint still answers 200 with `degraded: true` and a basic note. The UI shows "Live insight unavailable. Showing a basic note." with a retry. |
| Prompt facts | CoinGecko only: price, 24h and 7d change, market cap, volume, high and low, range position, volume to market cap ratio, chart statistics when cached. No Flash data (FR-I-04, D-T14). The suggested limit is clamped within 15% of spot. |
| Owner | `apps/backend/src/clients/openai.ts`, `services/insight.ts`, `services/insight.facts.ts` |

## Base Sepolia RPC (pools)

- Used by the backend (pool reads, 10 s cache) and by the dashboard and extension (wallet transactions and re-reads) through `viem`.
- URL: `POOL_RPC_URL` / `VITE_POOL_RPC_URL`, default `https://sepolia.base.org`. No key. Public RPCs rate limit without notice.
- On failure: the backend serves the stale pool cache, else `INTERNAL` 502. The UI shows a load error with a retry.
- Owner: `apps/backend/src/clients/chain.ts`, `apps/backend/src/services/pools.ts`, `packages/ui/src/wallet.ts`.

## Base mainnet RPC

Not used by the product. The only code that would touch it is the human-only `scripts/gate0-flash.ts` (`GATE0_RPC_URL`, default `https://mainnet.base.org`). Mainnet appears in the UI only as links and as the Flash chain.

## BaseScan

Links only, no API calls and no key: `https://basescan.org` (token addresses) and `https://sepolia.basescan.org` (pool and transactions). Defined in `CHAINS` in `packages/shared/src/constants.ts`; "View on BaseScan" in the card menu is in `packages/ui/src/components/market/KebabMenu.tsx`. `BASESCAN_API_KEY` is not used.

## Chainlink CRE

- `cre workflow simulate --broadcast` runs the TypeScript workflow in `cre/resolve-pools` locally and delivers the report on Base Sepolia through the simulation forwarder `0x82300bd7c3958625581cc2f77bc6464dcecdf3e5` (D-T2). The UI says "Settled by Chainlink CRE (simulation)".
- Auth: `cre login` once, or `CRE_API_KEY`. Gas for the delivery: `CRE_ETH_PRIVATE_KEY` (throwaway wallet with Base Sepolia ETH). The workflow's CoinGecko key is `CRE_COINGECKO_API_KEY`.
- Rate limit: the resolver loop runs every `RESOLVER_INTERVAL_SECONDS` (default 60).
- On failure: the loop logs the error and tries again next round; the pool stays "Awaiting result". A refused login is flagged loudly (see B-006).
- Owner: `scripts/resolver-loop.ts`, `scripts/settler-start.mjs`, `cre/resolve-pools`.

## x.com content security policy

x.com's CSP blocks remote images and most cross-origin requests from the page. So:

- All backend calls go through the extension's service worker (`apps/extension/src/background/apiProxy.ts`), which has the host permission for the API origin (D-T5). It is not an open proxy: URL under the API base only, GET or POST only, dot-segments rejected, identical GETs coalesced for 3 s.
- Token and chain icons are bundled inline SVG components. Fonts load through the FontFace API from bundled files.
- Never add a remote image, font or script to the overlay.

## Vercel (hosting)

- `vercel.json` defines a `web` service (dashboard), an `api` container service (`Dockerfile.api`, the backend) and a `settler` daemon (`Dockerfile.settler`, the resolver loop). `/api/*` goes to the backend.
- Secrets are set in the Vercel project. Today `OPENAI_API_KEY`, `FLASH_API_KEY` and `COINGECKO_API_KEY` pull as empty, so a deployment serves `q_mock_` quotes and a degraded AI note until they are re-added and the project is redeployed. Blocked on a human (B-007).
- Owner: human (Vercel account). Files: `vercel.json`, `Dockerfile.api`, `Dockerfile.settler`, `.vercelignore`.

## Blocked on a human

| Item | Needs | Blocker |
| --- | --- | --- |
| Flash `GET /search` | Definitive enables search for our key | B-008 |
| Vercel production secrets | Re-add the three keys, redeploy | B-007 |
| CRE login and funded keys | `cre login`, test wallets | B-006 |
| Funded Base mainnet wallet for Gate 0 | Conflicts with D-T1; only if the human supersedes it | B-002 |
