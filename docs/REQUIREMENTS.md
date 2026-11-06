# REQUIREMENTS.md

Each requirement has an ID. Tasks in `TASKS.md` reference these IDs. "Acceptance" is the check that proves it.

## Out of scope (do not build)

Disputes, World ID, Uniswap, copy trading, leaderboards, multi-source price checks, AI-parsed free-text questions, order cancellation, selling tokens on Flash, user accounts, indexers, mobile layouts, light theme, any production hardening.

## A. Extension (on x.com)

| ID | Requirement | Acceptance |
| --- | --- | --- |
| FR-X-01 | Highlight `$CASHTAG` text only if the symbol is in `GET /tokens`. Detect tags added by infinite scroll. | On a page with `$ETH` and `$FAKE`, only `$ETH` is highlighted; new tweets loaded by scrolling are handled |
| FR-X-02 | Hovering a highlighted tag for 300 ms opens the token card (screen A1). Leaving it and the card for 150 ms closes it. Escape closes it. | Card opens and closes with those timings; only one card is open at a time |
| FR-X-03 | Card header shows name, symbol, price, 24h change, contract address (copyable), chain pill. Data from `GET /market/:symbol`. | Values match the API response; address copy works |
| FR-X-04 | All extension UI is inside a Shadow DOM and does not change x.com styling. | Inspecting x.com shows no new global styles |
| FR-X-05 | One wallet path: injected main-world script talks to `window.ethereum`; the overlay talks to it by `postMessage`. | Connect, switch network, send tx and sign typed data all work from the overlay |

## B. Swap and limit order (Flash)

| ID | Requirement | Acceptance |
| --- | --- | --- |
| FR-S-01 | Swap tab: enter USDC amount (max 5.00), choose Market or Limit, see quote summary (spend, receive, fees, price impact). | Quote appears within 3 s of pressing "Get quote"; amount above 5.00 is rejected in the form |
| FR-S-02 | Market order flow: quote, switch wallet to Base, send `steps.approveTx` if present, sign `steps.permitTypedData` if present, sign `steps.orderTypedData`, submit, poll status every 3 s. | A real $1-5 order reaches `filled` and shows a BaseScan link to `txHash` |
| FR-S-03 | Limit order flow: same as FR-S-02 with `limitPriceUsd`. Status `open` is shown as "Waiting for price". | A limit order is accepted by Flash and shows `open` |
| FR-S-04 | If the quote expires before signing, request one new quote automatically; if that also fails, show the error. | Waiting 70 s after a quote then pressing Sign shows a fresh quote or the expired message |
| FR-S-05 | The contract address and chain are visible before the Sign button is enabled. | Screenshot shows address and "Base" above the button |
| FR-S-06 | A result is called "Filled" only if status is `filled` and `txHash` exists. | A mocked `filled` response without `txHash` is shown as an error |
| FR-S-07 | Mock mode shows a "MOCK" badge on the card. | With `FLASH_MOCK=true` the badge is visible |

## C. Insight

| ID | Requirement | Acceptance |
| --- | --- | --- |
| FR-I-01 | Insight tab: optional intent box (max 200 chars), "Get insight" button, tip, bias and confidence badges, disclaimer. | Response renders within 6 s; character counter stops at 200 |
| FR-I-02 | "Use suggested limit" fills the Swap tab with Limit and the suggested price. | Pressing it switches tabs with the price filled |
| FR-I-03 | `degraded: true` shows the notice "Live insight unavailable. Showing a basic note." | With the LLM disabled the notice appears and the tab still works |
| FR-I-04 | The agent never places or signs anything. | No code path from `/insight` to `/flash/*` |

## D. Prediction pools

| ID | Requirement | Acceptance |
| --- | --- | --- |
| FR-P-01 | Launcher button on X opens the Create panel (screen A4). Form: token (allowlist), above/below, strike price, duration preset (3 min, 1 h, 4 h, 24 h). The question is built by `buildQuestion` and shown as a preview. | Preview text equals what is stored onchain |
| FR-P-02 | Create sends `createPool` on Base Sepolia (switching network if needed) and reads `poolId` from the receipt. | Pool appears on the dashboard with the same question |
| FR-P-03 | Post step (screen A5) shows `buildTweetText` output and a button that opens the X composer with that text. The user presses Post. | Composer opens prefilled; text contains `PX#<id>` and the dashboard link |
| FR-P-04 | Bet box (screen A6) appears under a tweet whose text contains `PX#<id>` or a `/pool/<id>` dashboard link (use `extractPoolId`). | Box shows question, time left, YES and NO totals; absent on other tweets |
| FR-P-05 | Staking: choose YES or NO and an amount in test USDC. Approve the exact amount if allowance is too low, then `stake`. | Totals update after confirmation; no unlimited approval is requested |
| FR-P-06 | Dashboard pool page `/pool/:id` shows everything in the bet box plus result, resolved price, my position and Claim or Refund. | A loser can open the link and see the result and their stake |
| FR-P-07 | Claim pays `computePayout`. Refund returns the full stake for a void pool. | Example: YES $60, NO $40, 2% fee, YES wins: a $30 YES stake claims $49.00 |
| FR-P-08 | Dashboard home lists the latest 20 pools; faucet page mints test USDC. | Both pages load with seeded data |
| FR-P-09 | Pool status labels: open, awaiting result, resolved, void. | Labels match `derivePoolStatus` for all four cases |

## E. Backend

| ID | Requirement | Acceptance |
| --- | --- | --- |
| FR-B-01 | Implement every endpoint in `API_CONTRACT.md` with the exact shapes. Validate requests and responses with shared schemas. | A contract test calls each endpoint and parses the response with its schema |
| FR-B-02 | Flash proxy: the API key stays on the server. `FLASH_MOCK=true` returns fixtures. Backend maps Flash fields to ours (see `API_CONTRACT.md` section 6). | Real quote returns `steps` with the typed data string unchanged |
| FR-B-03 | Insight: one OpenAI call with Structured Outputs; validate; clamp suggested limit to within 15% of spot; one retry; static fallback with `degraded: true`. | With a bad key the endpoint still returns 200 and `degraded: true` |
| FR-B-04 | Pools endpoints read the contract with viem and compute `status`, `claimable`, `refundable` with shared helpers. | Values equal what the contract returns |
| FR-B-05 | SQLite stores quotes, orders and insight cache only. | No pool data in SQLite |
| FR-B-06 | CORS allows only `ALLOWED_ORIGINS`; per-IP rate limit (10 req/min on `/insight`, 60 req/min elsewhere). | A blocked origin gets no CORS header |
| FR-B-07 | Errors use the shared shape and codes. | Every error test parses with `ApiError` |

## F. Contracts

| ID | Requirement | Acceptance (Foundry test) |
| --- | --- | --- |
| FR-C-01 | `createPool` stores question, `coingeckoId`, direction, `strikeE18`, `resolveTime`; requires `resolveTime >= now + 120 s` and question length at most 140. | create ok; too soon and too long revert |
| FR-C-02 | `stake` pulls USDC and records per-user stakes; reverts at or after `resolveTime` and for amount 0. | stake ok; late and zero revert |
| FR-C-03 | `onReport` callable only by the forwarder; decodes `(poolId, outcomeYes, priceE18)`; reverts if already resolved or before `resolveTime`. | stranger reverts; double report reverts; early report reverts |
| FR-C-04 | `claim` pays winners `stake * (total - fee) / winningTotal`; fee goes to treasury once. | $60/$40, 2%, $30 stake pays $49; treasury gets $2 |
| FR-C-05 | Losers cannot claim; no double claim. | both revert |
| FR-C-06 | Void pool (one side empty at resolution): `refund` returns full stake, no fee. | refund exact; no fee moved |
| FR-C-07 | No admin override of outcome or user funds. | review: no such function exists |
| FR-C-08 | Views: `poolCount`, `getPool`, `getPosition`, `getDuePoolIds(max)`. | `getDuePoolIds` returns only unresolved pools past `resolveTime` |

## G. CRE workflow

| ID | Requirement | Acceptance |
| --- | --- | --- |
| FR-R-01 | Cron trigger runs every minute (config). | Simulation executes the cron handler |
| FR-R-02 | Reads `getDuePoolIds(10)` then `getPool(id)` with `EVMClient`. | Simulation logs the pool ids read |
| FR-R-03 | Fetches the CoinGecko price with `HTTPClient` (median consensus, key from a CRE secret). | Simulation logs the price |
| FR-R-04 | Computes the outcome and writes `(poolId, outcomeYes, priceE18)` with `writeReport`. | A due pool becomes resolved in the contract (or in the mock-forwarder fallback, stated in `WORKLOG.md`) |
| FR-R-05 | On any HTTP failure, skip that pool this run. | Simulated failure leaves the pool unresolved without error |

## H. Non-functional

| ID | Requirement |
| --- | --- |
| NFR-01 | Hover card renders cached market data in under 300 ms after the first load. |
| NFR-02 | No secrets in extension or dashboard bundles (`grep` the build for key names). |
| NFR-03 | The whole demo (Section "Demo script" in `TASKS.md`) runs in 3 minutes without editing code. |
| NFR-04 | Chrome desktop only, dark theme only. |
| NFR-05 | Every screen handles loading, error and empty states from `UI_REFERENCE.md`. |
