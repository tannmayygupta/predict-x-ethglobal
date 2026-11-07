# PredictX

**Trade and bet on crypto prices without leaving X (Twitter).**

PredictX is a Chrome extension for X plus a website, a backend and a smart contract. When a post mentions a coin such as `$ETH`, you can hover the cashtag and:

1. **See the price, a 24h chart and market stats**, and **get a swap quote** from Definitive Flash. This build only shows quotes. It never sends an order, so no mainnet funds are used.
2. **Get a short AI tip** about the coin with a suggested buy price (OpenAI). The AI cannot sign, send or place anything.
3. **Start a prediction pool**, for example "Will $ETH be above $3,000 at 18:00 UTC?", and post it to X. Anyone can bet YES or NO with test USDC. When the time is up, a **Chainlink CRE workflow** reads the real price and settles the pool onchain. Winners claim their share.

Built for the ETHGlobal Mumbai hackathon. Sponsor tracks: **Chainlink CRE** and **Definitive Flash**.

- **App:** https://predictx-tawny.vercel.app (landing page, pools, Predict, Swap, AI, API playground, faucet)
- **Extension (download):** [predictx-extension.zip](https://predictx-tawny.vercel.app/predictx-extension.zip)
- **API:** https://predictx-tawny.vercel.app/api/v1 (for example [`/health`](https://predictx-tawny.vercel.app/api/v1/health), [`/pools`](https://predictx-tawny.vercel.app/api/v1/pools))

> **Test funds only.** Pools use free test USDC on Base Sepolia. Swap quotes use Base mainnet prices, but `FLASH_ORDERS_ENABLED=false` means no order is ever submitted.

## Contents

1. [How it works](#how-it-works)
2. [Chainlink CRE: how pools get settled](#chainlink-cre-how-pools-get-settled)
3. [Definitive Flash: swap quotes](#definitive-flash-swap-quotes)
4. [The prediction pool contract](#the-prediction-pool-contract)
5. [Backend API](#backend-api)
6. [Install and use the extension](#install-and-use-the-extension)
7. [Deployed addresses and URLs](#deployed-addresses-and-urls)
8. [Run it locally](#run-it-locally)
9. [Security model](#security-model)
10. [Known limits](#known-limits)
11. [Repo layout and contributor docs](#repo-layout)

## How it works

```
 x.com                                       Backend (Fastify, Vercel container)
 ┌────────────────────────┐   HTTPS, JSON   ┌───────────────────────────┐ ─> CoinGecko  (prices, charts)
 │ PredictX extension      │ ──────────────> │ /tokens /market /insight  │ ─> OpenAI     (AI tip)
 │ content script + shadow │  via service    │ /flash/quote /pools       │ ─> Definitive Flash (swap quotes)
 │ DOM, wallet bridge      │  worker only    │ holds every API key       │ ─> Base Sepolia RPC (pool reads)
 └───────────┬────────────┘                  └───────────────────────────┘
             │ createPool / stake / claim / refund (MetaMask signs, straight to the contract)
             v
 ┌──────────────────────────────┐  onReport(metadata, report)  ┌──────────────────────────────────┐
 │ PredictionPool  (Base Sepolia) │ <──────────────────────────  │ Chainlink Forwarder              │
 │ MockUSDC test token            │                               │ <── CRE workflow "resolve-pools" │
 └──────────────────────────────┘                               │     cron, read pools, price, report│
                                                                 └──────────────────────────────────┘
 Dashboard (same origin as the API): pools list, pool page, Predict, Swap, AI, faucet
```

Two chains are involved on purpose:

| Purpose | Chain | Id | Money |
| --- | --- | --- | --- |
| Prediction pools, bets, claims | Base Sepolia | 84532 | Free `MockUSDC` and test ETH for gas |
| Flash swap quotes | Base mainnet | 8453 | Quotes only, nothing is sent |

Key design rules:

- **The extension never holds a key and never calls third parties.** All backend calls go through the extension's service worker, which only talks to the configured API base. Signing happens in MetaMask.
- **Pool writes bypass the backend.** `createPool`, `approve`, `stake`, `claim` and `refund` go from the wallet to the contract with the shared ABI (`packages/shared/src/abi.ts`). Each is simulated first so a revert reason shows before gas is spent. Approvals are for the **exact amount**, never unlimited.
- **One source of truth for money maths.** Shared helpers (`buildQuestion`, `toStrikeE18`, `computePayout`, `derivePoolStatus`, `extractPoolId`, and others in `packages/shared`) are used by the UI, backend, scripts and tests. Money is `string` or `bigint`, never a JS `number`.

### The pool lifecycle

```
created ──(now >= resolveTime)──> awaiting ──(CRE report)──> resolved   winners claim
   │                                  └───(one side has no stakes)──> void   everyone refunds, no fee
   └ open for bets until resolveTime
```

1. **Create.** A user picks a token, direction (above/below), strike and duration in the extension or on `/predict`. The UI builds the exact onchain question (`buildQuestion`), rounds the close time **up to a whole minute** so the HH:MM in the question is the real settle time, and calls `createPool`. The pool id comes from the `PoolCreated` event. The UI then builds the post text: the question, `Bet YES or NO: <dashboard link>/pool/<id>` and a `PX#<id>` marker.
2. **Bet.** Anyone opens the pool (dashboard page or the bet box the extension adds under any post containing `PX#<id>` or a `/pool/<id>` link) and bets YES or NO with test USDC. Betting is open while `block.timestamp < resolveTime`.
3. **Settle.** After `resolveTime`, the Chainlink workflow reads the pool, fetches the price, decides the outcome and delivers a signed report to the contract (next section).
4. **Claim.** A winner calls `claim`. If one side had no stakes, the pool is void and every staker calls `refund` for their full stake.

## Chainlink CRE: how pools get settled

**Role.** Chainlink CRE is the only thing that can decide an outcome. The contract has no owner and no admin function. The one way to resolve a pool is `onReport(metadata, report)`, and it reverts unless the caller is the configured Chainlink forwarder address (`InvalidSender`). The creator, the backend and PredictX itself cannot set a result.

**The workflow** lives in `cre/resolve-pools` (CRE TypeScript SDK, `@chainlink/cre-sdk`). Entry: `main.ts`. Logic: `src/workflow.ts`. It runs on a **cron trigger every minute** (`0 */1 * * * *`) and does the following each run:

| Step | What happens | CRE capability |
| --- | --- | --- |
| 1. Find work | `getDuePoolIds(10)` returns up to 10 unresolved pools whose `resolveTime` has passed. Read at the **latest block**, because "due" depends on `block.timestamp`. | `EVMClient.callContract` |
| 2. Read the pool | `getPool(id)` returns the coin id (CoinGecko), direction and strike (E18 fixed point). | `EVMClient.callContract` |
| 3. Get the price | `GET /simple/price?ids=<coin>&vs_currencies=usd&precision=full` on CoinGecko. The exact JSON number is converted to an E18 `bigint` with integer maths (exponent notation like `4.89e-06` handled). One fetch per coin per run. | `HTTPClient.sendRequest` with `consensusMedianAggregation<bigint>()` |
| 4. Decide | `outcomeYes = above ? price >= strike : price <= strike` (`src/outcome.ts`). | plain code |
| 5. Report | Encode `abi.encode(uint256 poolId, bool outcomeYes, uint256 priceE18)` and sign it. | `runtime.report(prepareReportRequest(...))` |
| 6. Deliver | Send the report to the pool through the forwarder. The tx and the receiver's `onReport` status are both checked; a revert is logged as failed. | `EVMClient.writeReport` |

Rules the code follows:

- **No guessed prices.** If the price fetch fails (HTTP error, unknown coin id, unparsable or non-positive price), that pool is **skipped** and retried next minute. Other pools continue. The CoinGecko API key is an optional CRE secret (`COINGECKO_API_KEY`, from `CRE_COINGECKO_API_KEY`); without it the workflow runs keyless.
- **SDK `.result()` pattern only**, no `async/await` on capabilities.
- **Median consensus** over per-node prices, so a single bad node cannot move the outcome.
- **One price source** (CoinGecko) for the popup, the AI tip and the workflow, so the number users see is the number that settles the pool.

**Onchain side.** `onReport` decodes the report, requires `msg.sender == forwarder`, requires the pool not already resolved (`AlreadyResolved`) and `block.timestamp >= resolveTime` (`TooEarly`), then stores `outcomeYes` and `resolvedPriceE18` and emits `Resolved`.

**How it runs in this project (be precise about this).** The deployed `PredictionPool` was constructed with Chainlink's **CRE simulation `MockKeystoneForwarder`** (`0x82300bd7c3958625581cc2f77bc6464dcecdf3e5`, Base Sepolia). That forwarder is what the `cre workflow simulate --broadcast` command delivers through, so settlement here is a **real workflow run with real onchain delivery in simulation mode**, driven by a loop:

- `scripts/resolver-loop.ts` runs every `RESOLVER_INTERVAL_SECONDS` (default 60). If any pool is due it executes `cre workflow simulate resolve-pools --target staging-settings --non-interactive --trigger-index 0 --broadcast`. It needs the `cre` CLI logged in (or `CRE_API_KEY`) and `CRE_ETH_PRIVATE_KEY`, a Base Sepolia wallet with test ETH that pays gas for the delivery transaction.
- In the hosted deployment this loop runs as the `settler` daemon (`Dockerfile.settler`, declared in `vercel.json`).
- The UI labels it "Settled by Chainlink CRE (simulation)". It is not described as a production DON deployment.
- A fully deployed workflow would deliver through the production KeystoneForwarder (`0xF8344CFd5c43616a4366C34E3EEE75af79a74482` on Base Sepolia) and needs a `PredictionPool` redeployed with that forwarder, because the forwarder address is immutable. See `docs/DECISIONS.md` (D-T2).

Proof it works: pools were resolved onchain by workflow runs and claimed (details and transaction hashes in `docs/WORKLOG.md`, task T-B08), and `scripts/e2e-lifecycle.ts` runs create → bet → settle → claim → double-claim-refused against Base Sepolia. Run the workflow tests with `cd cre/resolve-pools && bun test` (37 tests, including a mocked full run with the SDK's EVM and HTTP mocks). Setup, simulation and verification commands are in [cre/README.md](cre/README.md).

## Definitive Flash: swap quotes

**Role.** Definitive Flash is the swap venue behind the **Swap** tab (hover card, panel and `/swap`). The user enters an amount of USDC to spend and sees a real Flash quote for buying the token on **Base mainnet**: what they receive, the rate, price impact, the minimum after slippage and how long the quote is valid. Market and limit orders are both quoted.

**Quote-only by design.** `FLASH_ORDERS_ENABLED` defaults to `false`. The "Place order" button is disabled, labelled "Review only", and the screen says "Testnet-only build: orders are not sent." With the flag off the real client refuses `POST /flash/order` before any quote is read. Nothing in the product path calls an order endpoint, and spending is capped at `MAX_FLASH_TRADE_USD = 5` per order should orders ever be enabled.

**Data flow.**

```
SwapPanel (packages/ui)  ->  POST /api/v1/flash/quote  (extension: through the service worker)
  -> backend validates the body (zod), checks the token is Flash-tradable, amount <= $5, slippage, limit price, expiry
  -> POST https://flash.definitive.fi/v1/quote   header x-definitive-api-key
       body: targetChain/contraChain "base", targetAsset = token, contraAsset = USDC, side, qty, orderType,
             funderAddress (the user's wallet, read only), maxSlippage (market) or limitNotionalPrice + expireTime (limit)
  <- Flash: quoteId, from/to amounts and notionals, fees, estimatedPriceImpact, recommendedSlippage, evm { approveTx, permitTypedData, orderTypedData }
  -> backend maps it, clamps amounts to token decimals, derives the nine display factors, stores the quote
     (typed data byte for byte), sets expiresAt = now + 60 s, re-validates it against the shared schema
  <- UI shows the summary and a 60 s countdown; "Get new quote" at zero. Re-quoting is a button, not automatic.
```

**Where it lives.**

| Piece | File |
| --- | --- |
| The only Flash HTTP client (5 s timeout, key scrubbed from errors and logs) | `apps/backend/src/clients/flash.http.ts` |
| Request/response mapping, price impact, expiry | `apps/backend/src/clients/flash.map.ts`, `flash.factors.ts`, `flash.decimal.ts` |
| Checks, SQLite quote store, order gate | `apps/backend/src/services/flash.ts`, `routes/flash.ts` |
| Mock client (`FLASH_MOCK=true`), ids start `q_mock_` | `apps/backend/src/clients/flash.mock.ts` |
| Schemas shared with the UI | `packages/shared/src/schemas.ts` |
| Quote UI | `packages/ui/src/components/SwapPanel.tsx`, `components/swap/*` |

**Details worth knowing.**

- Tradable on Base: **ETH** (WETH), **BTC** (cbBTC), **DEGEN**, **BRETT**. PEPE has no real Base token, so its Swap button is disabled ("Swap unavailable for this token"). The spend asset is always USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- Token contract address and chain are shown with a BaseScan link next to a quote (RULES 5.7).
- Flash market quotes report zero fee because gas is inside the rate, so the UI shows the real network cost as `spend value - receive value`.
- Flash gives no quote expiry, so the 60 s validity is ours. Rate limit: Flash allows 5 requests per second per endpoint per key; the backend allows 60 requests per minute per client.
- `FLASH_MOCK=true` serves fake quotes with a visible **MOCK** badge. A mocked result is never presented as real (RULES 2.9). The hosted deployment may run in mock mode, in which case you will see that badge.
- The order path (`POST /order`, `GET /orders/{id}`) is implemented and tested in the backend but switched off. How to enable it safely is in [docs/DEFINITIVE.md](docs/DEFINITIVE.md) section 9. That doc also lists every file that touches Flash and which Flash endpoints are used or unavailable to our key.

## The prediction pool contract

`contracts/src/PredictionPool.sol` (Solidity 0.8.24, OpenZeppelin `SafeERC20` and `ReentrancyGuard`, Foundry).

| Rule | Detail |
| --- | --- |
| Create | `createPool(question, coingeckoId, direction, strikeE18, resolveTime)`. `resolveTime` must be at least 120 s ahead of `block.timestamp`; the question is at most 140 bytes; direction is 0 (above) or 1 (below). |
| Bet | `stake(poolId, isYes, amount)`. Reverts with `StakingClosed` at or after `resolveTime`, and `ZeroAmount` for 0. One wallet may hold both YES and NO. The contract pulls exactly `amount` of USDC (needs an exact approval first). |
| Settle | `onReport` only, from the forwarder. No owner, no admin, no pause. |
| Claim | Winner payout = `stake * (total - fee) / winningTotal`, fee 2% (`feeBps = 200`). The first claim also sends the pool fee to the treasury once. |
| Void | If either side has no stakes, nobody won: `claim` reverts `PoolIsVoid`, and `refund` returns the full stake with no fee. |

Worked example (a Foundry test): YES `$60`, NO `$40`, 2% fee. A `$30` YES stake receives `30 * (100 - 2) / 60 = $49`.

Every contract rule has a Foundry test (49 tests). The ABI and addresses are shared in `packages/shared` so the backend, UI, scripts and CRE workflow all use one copy.

## Backend API

Base: `/api/v1`. The contract between frontend and backend is [docs/API_CONTRACT.md](docs/API_CONTRACT.md), enforced by the zod schemas in `packages/shared/src/schemas.ts` on both sides. Errors always look like `{ "error": { "code", "message" } }`.

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Liveness |
| `GET /tokens` | Token allowlist (which are Flash-tradable, with pinned addresses) |
| `GET /market/:symbol`, `GET /market/:symbol/chart?range=24h\|7d` | Price, stats and chart series (CoinGecko, cached; "Price delayed" when stale) |
| `POST /insight` | One OpenAI call, output validated and clamped; falls back to a static tip with `degraded: true` |
| `POST /flash/quote` | Flash quote (see above) |
| `POST /flash/order`, `GET /flash/order/:orderId` | Disabled unless `FLASH_ORDERS_ENABLED=true` |
| `GET /pools`, `GET /pools/:id`, `GET /pools/:id/position?address=` | Pools and a wallet's position, read from the chain (10 s cache) |

Keys (Flash, OpenAI, CoinGecko) exist only as backend environment variables. Tweet text is untrusted and is rendered as plain text; it is never sent to the AI.

## Install and use the extension

1. Download and unzip [predictx-extension.zip](https://predictx-tawny.vercel.app/predictx-extension.zip).
2. Open `chrome://extensions`, turn on **Developer mode**, press **Load unpacked** and pick the unzipped folder.
3. Open [x.com](https://x.com). Press the **PredictX** button (bottom right), or hover a `$ETH` cashtag in any post.

To bet you need MetaMask on **Base Sepolia**, a little test ETH for gas (any Base Sepolia faucet) and test USDC. The bet box and the [faucet page](https://predictx-tawny.vercel.app/faucet) both have **Get test USDC** (mints up to 1,000 per call).

**Which backend and links the extension uses.** A build made with no extra settings targets the **deployed app**: API `https://predictx-tawny.vercel.app/api/v1` and dashboard links `https://predictx-tawny.vercel.app/pool/<id>`. These are the constants `DEPLOYED_APP_URL` and `DEPLOYED_API_BASE_URL` in `packages/shared/src/constants.ts`. The build also adds that origin to the manifest `host_permissions`, which is what lets the service worker read the responses. The extension deliberately does **not** read the dashboard's `VITE_API_BASE_URL` / `VITE_DASHBOARD_URL`, so a local `.env` can no longer put a localhost link in a post. To build against a local stack, set **both** `VITE_EXTENSION_API_BASE_URL` and `VITE_EXTENSION_DASHBOARD_URL` (see `.env.example`); `pnpm demo` does this for its own build. After rebuilding, press reload on the extension in `chrome://extensions` and refresh x.com.

## Deployed addresses and URLs

| Item | Value |
| --- | --- |
| App, API | https://predictx-tawny.vercel.app and `/api/v1` (Vercel: dashboard, API container and the settler daemon, see `vercel.json`) |
| PredictionPool (Base Sepolia) | [`0x6b0f6C0f324C615Add6BfcA5EE0b8eeD66F2C0cd`](https://sepolia.basescan.org/address/0x6b0f6C0f324C615Add6BfcA5EE0b8eeD66F2C0cd) |
| MockUSDC (test USDC, public mint) | [`0x1e05373c199D764f7dE0353d58AFEa2b4C6326Ef`](https://sepolia.basescan.org/address/0x1e05373c199D764f7dE0353d58AFEa2b4C6326Ef) |
| Forwarder the pool trusts (CRE simulation `MockKeystoneForwarder`) | `0x82300bd7c3958625581cc2f77bc6464dcecdf3e5` |
| CRE chain selector (Base Sepolia) | `ethereum-testnet-sepolia-base-1` (`10344971235874465080`) |

Use the public alias above. The `<project>-<team>.vercel.app` alias is behind Vercel Authentication and shows a login page to visitors.

## Run it locally

Requirements: Node 22+, pnpm 9 (`corepack enable`), Foundry (contracts), Bun and the `cre` CLI (Chainlink workflow).

```bash
cp .env.example .env              # fill in the keys you have; the rest have safe defaults
pnpm install
pnpm typecheck && pnpm test
pnpm --filter @predictx/backend start      # API on http://localhost:8787/api/v1/health
pnpm demo                                  # builds the extension for localhost, runs backend, dashboard and the resolver loop
```

| Part | Test | Docs |
| --- | --- | --- |
| Backend | `pnpm --filter @predictx/backend test` | [apps/backend/README.md](apps/backend/README.md) |
| Contracts | `cd contracts && forge test` | [contracts/README.md](contracts/README.md) |
| Chainlink workflow | `cd cre/resolve-pools && bun test` | [cre/README.md](cre/README.md) |
| Shared UI | `pnpm --filter @predictx/ui test` | |
| Extension | `pnpm --filter @predictx/extension test` | [apps/extension/README.md](apps/extension/README.md) |
| Settlement and money path | | `scripts/resolver-loop.ts`, `scripts/e2e-lifecycle.ts`, [scripts/README.md](scripts/README.md) |

Step-by-step local run: [docs/LOCAL_TEST.md](docs/LOCAL_TEST.md). Keys live only in `.env`, which git ignores; never commit it. Without an OpenAI key the tips fall back to a basic note; with `FLASH_MOCK=true` swap quotes are fake and carry a MOCK badge.

## Security model

- No API key, private key or signature in any client bundle; `scripts/check-bundles.ts` scans shipped bundles for key names, key shapes and the real secret values.
- The extension and dashboard talk only to the PredictX API and the chain RPC. The service-worker gateway accepts only GET/POST URLs under the API base (parsed URL, no credentials, no dot-segments) and caches successful GETs for 3 s.
- All overlay UI is inside a Shadow DOM; no CSS is injected into x.com.
- The AI has no tool that can sign or send. It returns text and one suggested number.
- Contract: no admin, outcome only from the forwarder, `SafeERC20`, `ReentrancyGuard`, checks-effects-interactions, exact-amount approvals from the UI.
- Real-funds limit: Flash orders are off; if ever enabled, at most `$5` each on Base. Pools use Base Sepolia test funds only.

## Known limits

- **Settlement is a CRE simulation**, delivered through the mock forwarder and driven by a loop (see above), not a deployed DON workflow.
- **Settlement price** is the CoinGecko spot price at the moment the workflow runs after `resolveTime` (usually within a minute), not a price pinned to the exact HH:MM in the question.
- Flash has no testnet, so quotes are mainnet prices and orders are disabled.
- The hosted backend runs on short-lived containers: the first request after idle can take several seconds, and the per-client rate limit (60/min) is per instance.
- Browser timers use the local clock while the contract uses block time; the contract always has the final say on whether a bet is accepted.

## Repo layout

```
apps/backend/       Fastify API: prices, AI tips, Flash quotes, pool reads
apps/extension/     Chrome (MV3) overlay on x.com: hover card, create pool, bet box
apps/dashboard/     Landing, pools list, pool page (bet, claim, refund), Predict, Swap, AI, playground, faucet
packages/shared/    Shared types, validation, helpers, constants, contract ABI and addresses
packages/ui/        API client, wallet actions, hooks and React pieces used by both apps
contracts/          PredictionPool and MockUSDC (Foundry)
cre/                Chainlink CRE workflow that settles pools
scripts/            Resolver loop, end-to-end lifecycle check, seed pools, demo launcher, Flash Gate 0
docs/               Requirements, API contract, architecture, decisions, work log, local test guide
```

## For contributors and AI agents

The planning docs drive the build. Read them in this order:

| # | File | What it is |
| --- | --- | --- |
| 1 | [docs/TRACKER.md](docs/TRACKER.md) | Where the project stands, task by task |
| 2 | [docs/AGENT.md](docs/AGENT.md) | How an agent works in this repo: loop, scopes, stop rules |
| 3 | [docs/RULES.md](docs/RULES.md) | Hard rules. Breaking one is a bug |
| 4 | [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | What must be true, with acceptance checks |
| 5 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, chains, data flows |
| 6 | [docs/API_CONTRACT.md](docs/API_CONTRACT.md) | The only interface between frontend and backend |
| 7 | [docs/UI_REFERENCE.md](docs/UI_REFERENCE.md) | Every screen, design token and piece of copy |
| 8 | [docs/TASKS.md](docs/TASKS.md) | The task backlog with acceptance checks |
| 9 | [docs/DECISIONS.md](docs/DECISIONS.md) | Locked stack, decision log, open questions |
| 10 | [docs/DEFINITIVE.md](docs/DEFINITIVE.md) | Every place Definitive Flash is used, the quote data flow, how to enable orders later |
| 11 | [docs/APIS.md](docs/APIS.md) | Every external API: auth, rate limit, cache, failure behaviour, owner file |

Keep `docs/TASKS.md` and `docs/TRACKER.md` (status), `docs/WORKLOG.md` (what happened) and `docs/BLOCKERS.md` (what needs a human) up to date. Work is split into **Agent A** (frontend: `apps/extension`, `apps/dashboard`) and **Agent B** (backend, contracts, CRE, scripts). They meet only at the API contract in `packages/shared`.
