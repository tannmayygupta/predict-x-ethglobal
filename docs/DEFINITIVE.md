# DEFINITIVE.md

How PredictX uses Definitive Flash. Checked against the code on 2026-11-07. Line ranges are approximate and drift; search for the named symbol if a range is off. Vendor reference: `docs/notes/flash-api.md`. Contract: `docs/API_CONTRACT.md` sections 2 and 6.

## 1. Summary

- Flash is called only from the backend, in one file: `apps/backend/src/clients/flash.http.ts`. No frontend, script in the product path, or extension code talks to `flash.definitive.fi`.
- The extension reaches the backend only through its service-worker gateway (`apps/extension/src/background/apiProxy.ts`), which accepts only URLs under the configured API base and only GET or POST.
- Implemented Flash calls: `POST /quote`, `POST /order`, `GET /orders/{id}?funderAddress=`.
- `POST /order` and `GET /orders/{id}` are switched off by `FLASH_ORDERS_ENABLED=false` (D-T1). The build is quote-only. With the flag off, the real client refuses before any quote is read or spent.
- Not used: `GET /search` (our key gets 403 `SEARCH_NOT_ELIGIBLE`), `GET /balances/{address}` (works for our key, mainnet only, nothing calls it), `GET /orders?funderAddress=` (list), and any cancel endpoint.
- Key: `FLASH_API_KEY`, sent only in the `x-definitive-api-key` header. Base URL: `FLASH_BASE_URL`, default `https://flash.definitive.fi/v1`. The key is scrubbed from upstream error text and censored in logs (`flash.http.ts`, `plugins/logging.ts`).

## 2. Where Definitive appears

### Backend (`apps/backend/src`)

| File and lines | Role |
| --- | --- |
| `clients/flash.http.ts` 1-185 | The only HTTP client. `quote()` posts `/quote`, `submit()` posts `/order`, `status()` gets `/orders/{id}`. 5 s timeout. 5xx becomes "flash unavailable"; 404 becomes `FlashNotFoundError`. Holds the original quote body in memory for 60 s because Flash wants every trade field resent on `/order` (D-B13). |
| `clients/flash.map.ts` 33-57 | `toFlashQuoteBody`: builds the Flash body. Base mainnet for both chains, `contraAsset` = USDC, `side`, `qty`, `orderType`, `funderAddress`. `maxSlippage` only for market, `limitNotionalPrice` and `expireTime` (ISO) only for limit. |
| `clients/flash.map.ts` 70-125 | `plainPriceImpact` and `fromFlashQuote`: Flash quote to our `FlashQuoteResponse`. Sets `expiresAt = now + 60 s` (Flash has no quote expiry), clamps amounts to token decimals. |
| `clients/flash.map.ts` 130-215 | `toFlashOrderBody`, `mapFlashStatus`, `fromFlashOrder`: order path (disabled in this build). |
| `clients/flash.factors.ts` 1-84 | `deriveQuoteFactors`: the nine swap factors (see section 4) and `orderDeadlineOf` (reads the deadline in the typed data; good-till-cancelled sentinel gives null). |
| `clients/flash.decimal.ts` | bigint decimal helpers (`clampDecimals`, `divideDecimal`, `minAfterSlippage`). No JS number maths on money. |
| `clients/flash.types.ts` | `FlashClient` interface, `RawFlashQuote` and `RawFlashOrder` schemas, `QUOTE_TTL_SECONDS = 60`, error classes. |
| `clients/flash.mock.ts` 1-112 | `MockFlashClient` used when `FLASH_MOCK=true`. Quote ids start with `q_mock_`; it emits the same factor keys. |
| `clients/flash.factory.ts` 1-25 | Picks mock or HTTP client from `FLASH_MOCK`. |
| `services/flash.ts` 1-237 | `FlashService`: checks (token is Flash-tradable, amount at most `MAX_FLASH_TRADE_USD`, positive limit price, slippage in (0,1], expiry window 60 s to 30 d), stores the quote in SQLite, validates the response against the contract. `order()` refuses first when orders are off. `status()` serves terminal states from SQLite (D-B3). |
| `routes/flash.ts` 1-46 | `POST /flash/quote`, `POST /flash/order`, `GET /flash/order/:orderId`. `ordersEnabled = flashMock || flashOrdersEnabled`: mock orders move no funds, so only the real client needs the opt-in. |
| `config.ts` 7, 37-38, 67-70, 107-110 | `FLASH_API_KEY`, `FLASH_BASE_URL`, `FLASH_MOCK`, `FLASH_ORDERS_ENABLED` (default false). |
| `db/quotes.ts`, `db/orders.ts` | Stored quotes (with byte-exact typed data) and orders. |
| `services/market.ts` 185 | `verified = token.flashSupported && token.address !== null` (D-T13). Flash data is not otherwise used for market data. |
| `services/insight.ts` | No Flash import by design (FR-I-04, D-T14). A static test enforces it. |

### Shared (`packages/shared`)

| File | Role |
| --- | --- |
| `src/schemas.ts` | `FlashQuoteRequest`, `FlashQuoteResponse` (with the nine factors), `FlashOrderRequest`, `FlashOrderResponse`, `FlashOrderDetail`. |
| `src/constants.ts` | `FLASH_BASE_ASSETS` (USDC `0x8335...2913`, WETH `0x4200...0006`), `CHAINS.BASE_MAINNET.flashName`, `MAX_FLASH_TRADE_USD = 5`, `MIN_LIMIT_EXPIRY_SECONDS`, `MAX_LIMIT_EXPIRY_SECONDS`, `GTC_DEADLINE_THRESHOLD`. |
| `tokens.json` | Which tokens are `flashSupported`, with the pinned Base address and decimals (section 7). |
| `src/fixtures.ts` | `quoteEthMarket`, `quoteEthLimit`. |

### UI (`packages/ui/src`, used by the extension and the dashboard)

| File | Role |
| --- | --- |
| `api.ts` 72, 103 | `flashQuote` posts `/flash/quote` through the injected HTTP function (service worker in the extension, fetch in the dashboard). No order function is called anywhere. |
| `components/SwapPanel.tsx`, `components/swap/SwapForm.tsx` | Quote-only swap form: market or limit, USDC amount (max 5), slippage presets, limit presets and expiry. |
| `components/swap/QuoteSummary.tsx` | The rows on screen; ends in a disabled "Place order" and "Testnet-only build: orders are not sent." |
| `components/swap/swapMath.ts` | Pure maths: network cost, effective gap, minimum received, expiry. |
| `view.ts` 67 | `isMockQuote`: ids starting `q_mock_` get a MOCK badge. |
| `components/market/TokenMarketCard.tsx` | Swap button disabled with "Swap unavailable for this token" when `!flashSupported`. |

### Extension and dashboard

| File | Role |
| --- | --- |
| `apps/extension/src/background/apiProxy.ts` 1-101 | Service-worker gateway to the backend. Not an open proxy. Coalesces identical GETs for 3 s. |
| `apps/extension/src/content/Panel.tsx` | Swap tab; moves to the first Flash-tradable token if the selected one is not. |
| `apps/dashboard/src/pages/Swap.tsx` | Same SwapPanel on the website. |
| `apps/dashboard/src/playground/endpoints.ts` | Playground lists `POST /flash/quote`; order endpoints are deliberately not listed. |

### Scripts

| File | Role |
| --- | --- |
| `scripts/gate0-flash.ts` | Gate 0 (T-003): would place one REAL mainnet limit order of at most 5 USDC. Human only. Blocked and in conflict with D-T1. Never run it from an agent. |
| `scripts/gate0-redact.ts`, `scripts/gate0-report.ts` | Redaction and report for the Gate 0 run. |
| `scripts/check-bundles.ts` 21 | Fails if a shipped bundle contains a Flash key shape (`dpka_...`). |

## 3. Swap quote data flow

```
SwapPanel (packages/ui)            user picks Market or Limit, amount in USDC (max 5), slippage or limit price + expiry
  -> api.flashQuote()              POST /api/v1/flash/quote   (extension: via service worker apiProxy.ts)
  -> routes/flash.ts               body validated with FlashQuoteRequest (zod); 60 req/min limit per client
  -> FlashService.quote()          token must be flashSupported with an address; amount, limit price, slippage, expireAt checked
  -> HttpFlashClient.quote()       POST {FLASH_BASE_URL}/quote   header x-definitive-api-key
        body (market): targetChain/contraChain "base", targetAsset = token address, contraAsset = USDC,
                       side, qty, orderType "market", funderAddress, maxSlippage
        body (limit):  same, plus limitNotionalPrice, and expireTime (ISO) only when the user chose an expiry
  <- Flash                         quoteId, from/to {amount, notional}, fees, estimatedPriceImpact, recommendedSlippage, evm {orderTypedData, ...}
  -> fromFlashQuote()              amounts clamped to token decimals; deriveQuoteFactors(); expiresAt = now + 60 s
  -> FlashService                  re-validated with FlashQuoteResponse; stored in SQLite (typed data byte-for-byte); returned
  <- QuoteSummary                  rows, a 60 s countdown, "Get new quote" at 0. Place order stays disabled.
```

No order is sent. The wallet is only read for its address (`funderAddress`). Re-quoting is an explicit button, not automatic, to respect the 60 req/min backend limit and Flash's 5 req/s.

## 4. What each number on screen comes from

| On screen | Response field | Flash source |
| --- | --- | --- |
| You spend | `spend.amount` (USDC), `spendUsd` | `from.amount`, `from.notional` |
| You get (about) | `receive.amount` | `to.amount`, clamped to token decimals (Flash can send 36+ decimals) |
| Rate (1 TOKEN = $x) | `effectivePriceUsd` | `from.amount / to.amount`, 8 decimals, null if amount is zero |
| Effective price vs market | `effectivePriceUsd` against `marketPriceUsd` (market) or the live `/market` price (limit) | `marketPriceUsd` = `to.notional / to.amount`, market only |
| Network cost | `spendUsd - receiveUsd`, clamped at 0 (computed in the UI) | `from.notional - to.notional`. Market `fees.estimatedFeeNotional` is "0" because gas is inside the rate, so this is the real cost, about $0.04 on $2 and $5. Not a PredictX fee. |
| Fees (only if non-zero) | `feesUsd` | `fees.estimatedFeeNotional` |
| Price impact | `estimatedPriceImpact` | `estimatedPriceImpact`; negative values are clamped to "0" by `plainPriceImpact` |
| Minimum received | `minReceive` | `to.amount * (1 - slippage)` floored to token decimals (market); equals `receive.amount` for limit |
| Slippage (used, suggested) | `slippage`, `recommendedSlippage` | `slippage` is the `maxSlippage` we sent (null for limit); `recommendedSlippage` is Flash's raw value ("0.15" for small market orders, null for limit) |
| Order expires | `orderDeadline`, or the expiry the user chose | `evm.orderTypedData` message `deadline` (about 300 s for market). Null when absent or at or above 2^40 (the good-till-cancelled sentinel 2^48-1 = 281474976710655). Limit shows the chosen expiry or "Good till cancelled". |
| Limit price | `limitPriceUsd` | Echo of what we sent as `limitNotionalPrice` (null for market) |
| Quote valid (countdown) | `expiresAt` | Ours: quote time + 60 s. Flash returns no expiry. |
| Steps | `steps.approveTx`, `steps.permitTypedData` | `evm.approveTx`, `evm.permitTypedData` (empty string becomes null) |
| Token address and chain | `Token.address`, `chainId` | `tokens.json` (pinned), shown with a BaseScan link (RULES 5.7) |
| MOCK badge | `quoteId` starts with `q_mock_` | Mock client only |

## 5. Findings verified live (2026-11-07)

- `GET /search` returns 403 `SEARCH_NOT_ELIGIBLE` for our key. `GET /balances/{address}` works (mainnet only). Liquidity therefore comes from CoinGecko onchain (D-T12).
- Market quotes report `fees.estimatedFeeNotional = "0"`. Gas is embedded in the rate. Real cost = `from.notional - to.notional`.
- `recommendedSlippage` is "0.15" for small market orders and null for limit orders. It ignores the `maxSlippage` we send.
- The deadline lives inside the typed data (`message.deadline`): about 300 s for market orders and 2^48-1 for good-till-cancelled limit orders.
- Use `limitNotionalPrice` only. Never send `limitCrossPrice`.
- A limit price at or above market is marketable and fills at once. The UI warns.
- `expireTime` on a market order is a 400 from Flash, so the backend sends it for limit only.
- Rate limit: 5 requests per second, per endpoint, per API key.
- Flash can create or fill an order and still answer 4xx on `/order`. Never auto-retry a signed submit (D-B1).
- Quotes returned 200 on Base for WETH, cbBTC, DEGEN and BRETT. There is no real PEPE on Base, so PEPE is not tradable.
- `docs/GATE0.md` does not exist. T-003 (Gate 0) is blocked: it would place a real mainnet order and conflicts with D-T1.

## 6. Endpoints used versus available

| Flash endpoint | State | Notes |
| --- | --- | --- |
| `POST /quote` | Used today | Market and limit, buy side only (D-002). |
| `POST /order` | Implemented, disabled | Refused by `FLASH_ORDERS_ENABLED=false` before any quote is read. |
| `GET /orders/{id}?funderAddress=` | Implemented, disabled | Reachable only for orders that were placed, so unused in this build. |
| `GET /orders?funderAddress=` | Available, unused | Would be needed to reconcile a failed submit (notes section 4.3). |
| `GET /balances/{address}` | Available, unused | Works for our key, mainnet only. Could show a USDC balance later. |
| `GET /search` | Not available to us | 403. Needs Definitive to enable it (B-008). |
| Cancel endpoints | Not implemented | Never call them from an agent. |

## 7. Tradable tokens (Base, chain 8453)

| Symbol | Flash asset | Decimals | Notes |
| --- | --- | --- | --- |
| ETH | WETH `0x4200000000000000000000000000000000000006` | 18 | |
| BTC | cbBTC `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` | 8 | Coinbase wrapped BTC, D-T15 |
| DEGEN | `0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed` | 18 | |
| BRETT | `0x532f27101965dd16442e59d40670faf5ebb142e4` | 18 | |
| PEPE | none | none | `flashSupported: false`; the real PEPE is not on Base |

Spend asset is always USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.

## 8. Testnet policy

- Prediction pools run on Base Sepolia with test USDC. Flash has no testnet (D-001), so quotes use Base mainnet prices and nothing is ever submitted (D-T1).
- `FLASH_ORDERS_ENABLED` stays false. `FLASH_MOCK=false` gives real quotes with the real key; `FLASH_MOCK=true` gives fake quotes with a MOCK badge.
- Agents never call `POST /order`, any cancel endpoint, or run `scripts/gate0-flash.ts`.

## 9. Turning real orders on later

All of these must be true first. A human decides; an agent never flips the flag.

1. The human supersedes D-T1 in `docs/DECISIONS.md`, and T-003 / Gate 0 is run by a human with a funded Base mainnet wallet (at least about 2 USDC and some ETH for gas). `docs/GATE0.md` is then written from the real run.
2. The order status values and the `GET /orders/{id}` response are confirmed against a real order (open item in DECISIONS). `mapFlashStatus` carries a `GATE0` marker for this.
3. The UI default slippage is revisited: Flash recommends 0.15 for small market orders while our default is 1% (see the maxSlippage note in DECISIONS).
4. A reconcile step exists for a submit that answers 4xx (list orders and match), since Flash can still create the order.
5. The Place order button is enabled in `QuoteSummary.tsx`, the "Review only" badge and the testnet note are removed, and the order flow (approve, sign, place, poll) is wired. The backend path (`FlashService.order`, `status`) already exists and is tested.
6. Then set `FLASH_ORDERS_ENABLED=true` on the server (never in a bundle), keep `MAX_FLASH_TRADE_USD` at 5, and run the merge checklist item "A real $1-5 swap fills".
