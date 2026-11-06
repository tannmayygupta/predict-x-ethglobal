# ARCHITECTURE.md

## 1. Components

```
x.com page
  +- Content script (isolated world)  detects $CASHTAG / PX#id, mounts Shadow DOM overlay
  +- Page bridge (main world)         talks to window.ethereum via postMessage
  +- Service worker                   optional: caches /tokens
            |  HTTPS (JSON, no login)
            v
Backend (Fastify)  ---- CoinGecko        (prices)
  +- market                               
  +- agent  ----------- OpenAI           (insight, one call)
  +- flash  ----------- Flash REST       (quote, order, status)   Base MAINNET, <= $5/order
  +- pools  ----------- Base Sepolia RPC (read PredictionPool)
  +- SQLite (quotes, orders, insights)

Dashboard (Vite SPA)  --> same backend API, wallet via window.ethereum directly

Base Sepolia:  PredictionPool <--onReport-- KeystoneForwarder <-- CRE workflow
                                             (cron -> read pools -> CoinGecko -> report)
```

## 2. Chains and assets

| Purpose | Chain | Id | Assets |
| --- | --- | --- | --- |
| Flash swaps and orders | Base mainnet (`base`) | 8453 | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, WETH `0x4200000000000000000000000000000000000006` |
| Prediction pools | Base Sepolia | 84532 | `MockUSDC` (deployed by us, public mint), gas in test ETH |

The UI switches the wallet between the two networks when an action needs it.

## 3. Data flows

**Swap (FR-S)**
1. `GET /market/ETH`
2. `POST /flash/quote` returns `steps` (`approveTx`, `permitTypedData`, `orderTypedData`)
3. Wallet on Base: send `approveTx` if present; sign `permitTypedData` if present; sign `orderTypedData`
4. `POST /flash/order` with signatures; backend echoes the stored typed data to Flash
5. Poll `GET /flash/order/:id` every 3 s until `filled`, `failed` or `expired`

**Insight (FR-I)**
`POST /insight` -> backend reads CoinGecko -> one OpenAI call -> validate and clamp -> response. No path to Flash.

**Create pool (FR-P-01..03)**
Form -> `buildQuestion` -> wallet on Base Sepolia -> `createPool` -> receipt gives `poolId` -> `buildTweetText` -> X composer.

**Bet and payout (FR-P-04..07)**
`GET /pools/:id` -> (approve exact amount) -> `stake` -> after `resolveTime` CRE reports -> `GET /pools/:id` shows `resolved` -> `claim`.

**Resolve (FR-R)**
Cron (1 min) -> `getDuePoolIds(10)` -> for each: `getPool` -> CoinGecko price -> `outcomeYes = above ? price >= strike : price <= strike` -> `writeReport` -> forwarder -> `onReport`.

## 4. Ownership map

| Path | Owner | Notes |
| --- | --- | --- |
| `apps/extension`, `apps/dashboard` | Agent A | |
| `apps/backend`, `contracts`, `cre`, `scripts` | Agent B | |
| `packages/shared/tokens.json`, ABI, fixtures | Agent B | |
| `packages/shared/src/schemas.ts`, `helpers.ts`, `constants.ts` | Shared | Change protocol in `AGENT.md` |

## 5. Pool lifecycle

```
created --(now >= resolveTime)--> awaiting --(CRE report)--> resolved
                                        \--(one side empty)--> void  (refund)
```

## 6. Failure behaviour

| Failure | Result |
| --- | --- |
| CoinGecko down | Popup shows last cached price with "Price delayed"; CRE skips the pool and retries next minute |
| OpenAI down or invalid output | `/insight` returns static tip with `degraded: true` |
| Flash error | `FLASH_ERROR` with Flash's message shown to the user |
| X layout changes | Cashtag highlight or bet box may stop; dashboard links still work |
| Wallet on wrong network | Action button becomes "Switch to Base" or "Switch to Base Sepolia" |
