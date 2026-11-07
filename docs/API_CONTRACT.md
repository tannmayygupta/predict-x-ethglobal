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
| 3 | `GET /market/:symbol` | Price and stats for the popup |
| 3b | `GET /market/:symbol/chart?range=24h or 7d` | Price series for the card chart (default `24h`) |
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
                "address": "0x4200000000000000000000000000000000000006", "decimals": 18, "flashSupported": true,
                "network": "base", "onchain": { "network": "base", "address": "0x4200000000000000000000000000000000000006" } } ] }
```
`network` (`ethereum | base | bitcoin`) and `onchain` (CoinGecko onchain network id and token address, used for the liquidity lookup; `null` when the token has no pool, e.g. BTC) are optional. Flash-tradable today: ETH, BTC (cbBTC, 8 decimals), DEGEN, BRETT, all on Base. PEPE is not.

**`GET /market/ETH`**
```json
{ "symbol": "ETH", "name": "Ethereum", "address": "0x4200000000000000000000000000000000000006",
  "flashChainId": 8453, "priceUsd": "2451.12", "change24hPct": -1.8, "updatedAt": 1761600000,
  "change24hUsd": "-44.93", "marketCapUsd": "295820000000", "volume24hUsd": "11580000000",
  "high24hUsd": "2503.40", "low24hUsd": "2431.07", "liquidityUsd": "138690000", "verified": true }
```
All price, change, cap and volume figures come from CoinGecko (D-005). `change24hUsd` is signed (`SignedDecimalString`) and equals `price * pct / (100 + pct)` in bigint, 2 decimals. `high24hUsd` and `low24hUsd` come from the full 24h chart series. `liquidityUsd` is the CoinGecko onchain `total_reserve_in_usd` truncated to 2 decimals; `null` when the token has no pool or the lookup fails. Every new key is `null` (`verified`: `false`) when unknown, and the backend always emits all of them. A failed liquidity, high or low lookup never fails the market response. `verified` is true when the token is Flash-tradable on the allowlist with a pinned contract address.

**`GET /market/ETH/chart?range=24h`** (`range`: `24h` default, or `7d`)
```json
{ "symbol": "ETH", "range": "24h",
  "points": [ [1761513600, "2496.05"], [1761600000, "2451.12"] ],
  "openUsd": "2496.05", "lowUsd": "2431.07", "highUsd": "2503.4", "updatedAt": 1761600000 }
```
`points` are `[unix seconds, price]`, at least 2 and at most `MAX_CHART_POINTS` (300); the backend downsamples to about 96 (24h) or 85 (7d) points, keeping the first and the newest. `openUsd` (first point), `lowUsd` and `highUsd` are computed from the full series before downsampling. Prices keep 7 significant digits and are never negative. Source: CoinGecko `market_chart` (`vs_currency=usd`, `days=1` or `7`, `precision=full`). Cached 300 s (24h) and 900 s (7d); a stale entry is served on upstream failure, else `502`. A CoinGecko `429` blocks refreshes for `Retry-After` (else 60 s) and only the cache is served meanwhile.

**`POST /insight`**
```json
// request
{ "symbol": "ETH", "userIntent": "I want to buy on a dip" }
// response
{ "symbol": "ETH", "tip": "ETH is down 1.8% today. A limit buy a few percent below spot avoids chasing the move.",
  "bias": "neutral", "confidence": "low",
  "suggestedLimit": { "side": "buy", "priceUsd": "2380.00", "reason": "About 3% below spot" },
  "degraded": false, "disclaimer": "Not financial advice.",
  "spotUsd": "2451.12", "asOf": 1761600000 }
```
`spotUsd` is the CoinGecko spot the suggestion was measured against and `asOf` its unix time, so the UI can show "vs spot" and the age. The service fills both; the model never writes them. The suggested limit is clamped within 15% of spot.

**`POST /flash/quote`** (MVP: buy only)
```json
// request
{ "walletAddress": "0x...", "symbol": "ETH", "side": "buy", "orderType": "market",
  "amount": "2.00", "limitPriceUsd": null, "slippage": "0.01", "expireAt": null }
// response
{ "quoteId": "q_123", "expiresAt": 1761600060, "orderType": "market", "side": "buy",
  "chain": "base", "chainId": 8453,
  "spend": { "symbol": "USDC", "amount": "2.00" }, "receive": { "symbol": "ETH", "amount": "0.000816" },
  "feesUsd": "0.01", "estimatedPriceImpact": "0.0004",
  "recommendedSlippage": "0.15", "slippage": "0.01", "spendUsd": "2.00", "receiveUsd": "1.96",
  "minReceive": "0.000807", "effectivePriceUsd": "2450.98", "marketPriceUsd": "2401.96",
  "limitPriceUsd": null, "orderDeadline": 1761600300,
  "steps": { "approveTx": { "to": "0x...", "data": "0x..." }, "permitTypedData": null, "orderTypedData": "{...}" } }
```
Request rules: `expireAt` (unix seconds) is valid only with `orderType: "limit"` (a market request carrying it is rejected, because Flash answers 400); the backend requires it to be 60 s to 30 d from now (`MIN_LIMIT_EXPIRY_SECONDS`, `MAX_LIMIT_EXPIRY_SECONDS`) and omits it for good-till-cancelled. `slippage` must satisfy 0 < x <= 1.

Response factors (all `null` when not applicable; the backend always emits every key):

| Field | Meaning |
| --- | --- |
| `recommendedSlippage` | Flash's own suggestion (about `0.15` for small market orders); `null` for limit. It ignores the `maxSlippage` we send |
| `slippage` | the `maxSlippage` we sent; `null` for limit |
| `spendUsd`, `receiveUsd` | Flash `from.notional` and `to.notional` |
| `minReceive` | market: `to.amount * (1 - slippage)` floored to token decimals; limit: equals `receive.amount` |
| `effectivePriceUsd` | `spend.amount / receive.amount`, 8 decimals, `null` if receive is zero |
| `marketPriceUsd` | `to.notional / to.amount` for market; `null` for limit |
| `limitPriceUsd` | echo of the limit price; `null` for market |
| `orderDeadline` | unix seconds from `message.deadline` in the order typed data; `null` when absent or at or above 2^40 (the good-till-cancelled sentinel 281474976710655) |

Cost facts: Flash reports `fees.estimatedFeeNotional` as `"0"` on market quotes because gas is embedded in the rate; the real cost is `spendUsd - receiveUsd` (about $0.04 on $2 and $5). `estimatedPriceImpact` can be negative upstream and is clamped to `"0"`. Amount strings can carry 36+ decimals and are clamped to token decimals before they are validated. A limit price at or above market is marketable and fills at once.

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
| `symbol` (ETH, BTC, DEGEN, BRETT) | `targetAsset` = the token's `address` from `tokens.json` (WETH, cbBTC, ...); `targetChain` = `base` |
| fixed | `contraAsset` = USDC address; `contraChain` = `base` |
| `side` | `side` |
| `amount` | `qty` (spent asset: USDC on buy) |
| `orderType` | `orderType` (`market` or `limit`) |
| `limitPriceUsd` | `limitNotionalPrice` (never `limitCrossPrice`) |
| `expireAt` (limit only) | `expireTime` as an ISO timestamp; never sent for market orders |
| `slippage` | `maxSlippage` |
| `walletAddress` | `funderAddress` |
| quote `evm.approveTx` | `steps.approveTx` |
| quote `evm.permitTypedData` | `steps.permitTypedData` |
| quote `evm.orderTypedData` | `steps.orderTypedData` |
| order `orderSignature` | `userSignature` (+ echo `evmOrderTypedData` from the stored quote) |
| quote `to.notional` / `from.notional` | `receiveUsd` / `spendUsd` |
| quote `recommendedSlippage` | `recommendedSlippage` |
| quote `evm.orderTypedData` `message.deadline` | `orderDeadline` |
| order `permitSignature` | `evmPermitSignature` (+ echo `evmPermitTypedData`) |

Flash does not return a quote expiry field; the backend sets `expiresAt` to quote time + 60 s. The order's own deadline lives inside the signed typed data (`message.deadline`, about 5 minutes for market orders, the 2^48-1 sentinel for good-till-cancelled limits) and is surfaced as `orderDeadline`. Flash `GET /search` is not eligible for our key (403), so stats come from CoinGecko, not Flash. Record any difference you observe in `docs/GATE0.md`.
