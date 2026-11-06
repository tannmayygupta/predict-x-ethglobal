# API_CONTRACT.md

Source of truth is `packages/shared/src/schemas.ts` (zod). This file explains it. If they disagree, the code wins and this file is fixed.

## 1. Conventions

- Base path `/api/v1`. JSON only. `camelCase`.
- No login. CORS limited to `ALLOWED_ORIGINS`. Per-IP rate limits (`/insight` 10 per minute, others 60 per minute).
- Amounts: decimal strings in base units for onchain values (USDC 6 decimals); decimal strings in normal units for Flash amounts and USD prices. Time: unix seconds (integer). Addresses: `0x` + 40 hex.
- Errors: `{ "error": { "code": "...", "message": "..." } }`

| Code | HTTP | Meaning |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | Validation failed |
| `UNSUPPORTED_TOKEN` | 400 | Symbol not in `tokens.json` or not tradable on Flash |
| `NOT_FOUND` | 404 | Unknown pool or order |
| `QUOTE_EXPIRED` | 409 | Quote missing or past `expiresAt`; request a new one |
| `RATE_LIMITED` | 429 | Too many requests |
| `FLASH_ERROR` | 502 | Flash rejected or failed; message carries the reason |
| `LLM_UNAVAILABLE` | 503 | Only if no fallback exists (normally `degraded: true` is used) |
| `INTERNAL` | 500 | Anything else |

## 2. Endpoints

| # | Method and path | Purpose |
| --- | --- | --- |
| 1 | `GET /health` | `{ "ok": true }` |
| 2 | `GET /tokens` | Token allowlist |
| 3 | `GET /market/:symbol` | Price for the popup |
| 4 | `POST /insight` | AI tip and suggested limit |
| 5 | `POST /flash/quote` | Quote and signing steps |
| 6 | `POST /flash/order` | Submit signed order |
| 7 | `GET /flash/order/:orderId` | Poll order status |
| 8 | `GET /pools` | Latest 20 pools |
| 9 | `GET /pools/:id` | One pool |
| 10 | `GET /pools/:id/position?address=0x...` | A wallet's stake and payout |

Pool writes (`createPool`, `stake`, `claim`, `refund`, and USDC `approve`, `mint`) are sent straight to the contract with the shared ABI. They are not API calls.

## 3. Shapes

**`GET /tokens`**
```json
{ "tokens": [ { "symbol": "ETH", "name": "Ethereum", "coingeckoId": "ethereum", "flashChainId": 8453,
                "address": "0x4200000000000000000000000000000000000006", "decimals": 18, "flashSupported": true } ] }
```

**`GET /market/ETH`**
```json
{ "symbol": "ETH", "name": "Ethereum", "address": "0x4200000000000000000000000000000000000006",
  "flashChainId": 8453, "priceUsd": "2451.12", "change24hPct": -1.8, "updatedAt": 1761600000 }
```

**`POST /insight`**
```json
// request
{ "symbol": "ETH", "userIntent": "I want to buy on a dip" }
// response
{ "symbol": "ETH", "tip": "ETH is down 1.8% today. A limit buy a few percent below spot avoids chasing the move.",
  "bias": "neutral", "confidence": "low",
  "suggestedLimit": { "side": "buy", "priceUsd": "2380.00", "reason": "About 3% below spot" },
  "degraded": false, "disclaimer": "Not financial advice." }
```

**`POST /flash/quote`** (MVP: buy only)
```json
// request
{ "walletAddress": "0x...", "symbol": "ETH", "side": "buy", "orderType": "market",
  "amount": "2.00", "limitPriceUsd": null, "slippage": "0.01" }
// response
{ "quoteId": "q_123", "expiresAt": 1761600060, "orderType": "market", "side": "buy",
  "chain": "base", "chainId": 8453,
  "spend": { "symbol": "USDC", "amount": "2.00" }, "receive": { "symbol": "ETH", "amount": "0.000816" },
  "feesUsd": "0.01", "estimatedPriceImpact": "0.0004",
  "steps": { "approveTx": { "to": "0x...", "data": "0x..." }, "permitTypedData": null, "orderTypedData": "{...}" } }
```
`steps.*TypedData` are JSON **strings**. The frontend parses them and passes them to `eth_signTypedData_v4` unchanged. `approveTx` is sent as a normal wallet transaction on Base before signing.

**`POST /flash/order`**
```json
{ "quoteId": "q_123", "walletAddress": "0x...", "orderSignature": "0x...", "permitSignature": null }
// response
{ "orderId": "o_456", "status": "submitted" }
```

**`GET /flash/order/:orderId`**
```json
{ "orderId": "o_456", "status": "filled", "orderType": "market", "txHash": "0x...",
  "chainId": 8453, "filledAmount": "0.000816", "error": null, "updatedAt": 1761600030 }
```
`status`: `submitted | open | filled | failed | expired`. The backend maps Flash's status values to these.

**`GET /pools/:id`**
```json
{ "id": 12, "chainId": 84532, "contract": "0x...",
  "question": "Will $PEPE be above $0.000012 at 22:00 UTC on 27 Oct?",
  "symbol": "PEPE", "coingeckoId": "pepe", "direction": "above", "strikeUsd": "0.000012",
  "resolveTime": 1761602400, "createdAt": 1761588000,
  "yesTotal": "60000000", "noTotal": "40000000",
  "status": "open", "outcome": null, "resolvedPriceUsd": null, "feeBps": 200,
  "creator": "0x...", "dashboardUrl": "https://predictx.app/pool/12" }
```
Status: `open` before `resolveTime`; `awaiting` after it until CRE reports; `resolved` after the report; `void` when resolved with an empty side. Use `derivePoolStatus`.

**`GET /pools/:id/position?address=0x...`**
```json
{ "poolId": 12, "address": "0x...", "yesStake": "30000000", "noStake": "0",
  "claimable": "49000000", "claimed": false, "refundable": "0" }
```
`GET /pools` returns `{ "pools": [ Pool, ... ] }`, newest first, at most 20.

## 4. Contract interface the frontend calls

| Function | Used by | Notes |
| --- | --- | --- |
| `createPool(question, coingeckoId, direction, strikeE18, resolveTime)` | Create panel | `direction`: 0 above, 1 below; returns id in `PoolCreated` |
| `stake(poolId, isYes, amount)` | Bet box, dashboard | needs exact USDC `approve` first |
| `claim(poolId)` | Dashboard | winners only |
| `refund(poolId)` | Dashboard | void pools only |
| `MockUSDC.mint(to, amount)` | Faucet | public, max 1,000 USDC per call |

## 5. Shared helpers (never re-implement)

`buildQuestion`, `buildTweetText`, `extractPoolId`, `toStrikeE18`, `fromE18`, `toUsdcUnits`, `formatUsdc`, `computePayout`, `derivePoolStatus` in `packages/shared/src/helpers.ts`.

## 6. Backend adapter: our fields to Flash fields (`POST https://flash.definitive.fi/v1/...`, header `x-definitive-api-key`)

| Ours | Flash |
| --- | --- |
| `symbol` (ETH) | `targetAsset` = WETH address; `targetChain` = `base` |
| fixed | `contraAsset` = USDC address; `contraChain` = `base` |
| `side` | `side` |
| `amount` | `qty` (spent asset: USDC on buy) |
| `orderType` | `orderType` (`market` or `limit`) |
| `limitPriceUsd` | `limitNotionalPrice` |
| `slippage` | `maxSlippage` |
| `walletAddress` | `funderAddress` |
| quote `evm.approveTx` | `steps.approveTx` |
| quote `evm.permitTypedData` | `steps.permitTypedData` |
| quote `evm.orderTypedData` | `steps.orderTypedData` |
| order `orderSignature` | `userSignature` (+ echo `evmOrderTypedData` from the stored quote) |
| order `permitSignature` | `evmPermitSignature` (+ echo `evmPermitTypedData`) |

Flash does not return an expiry; the backend sets `expiresAt` to quote time + 60 s. Record any difference you observe in `docs/GATE0.md`.
