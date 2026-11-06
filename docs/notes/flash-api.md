# Definitive Flash REST API — reference notes

Research date: 2026-10-29. Purpose: confirm or correct `docs/API_CONTRACT.md` section 6 and the Flash items in `docs/DECISIONS.md` before the backend adapter is written.

**Reachability:** the official docs are public, no login needed. Everything below is sourced from them, from the live OpenAPI spec, and from a handful of read-only live probes (quote, search, error shapes) made with the public development key that the docs print on their Overview page. No order was submitted and no funds moved. Nothing in this file is UNCONFIRMED unless marked so.

Key sources (all public):

| What | URL |
| --- | --- |
| Docs index for machines (lists every page) | https://flash.definitive.fi/docs/llms.txt |
| Whole docs in one file | https://flash.definitive.fi/docs/llms-full.txt |
| Live OpenAPI 3.1 spec (`info.version` 2.0.0) | https://flash.definitive.fi/v1/openapi.json |
| Overview | https://flash.definitive.fi/docs/index.md |
| Become an Integrator (API key) | https://flash.definitive.fi/docs/getting-started.md |
| AI Integration quickstart (flow, errors) | https://flash.definitive.fi/docs/for-agents.md |
| EVM Overview (approve / permit / sign / submit) | https://flash.definitive.fi/docs/evm-overview.md |
| Placing Orders (qty, pricing basis, expiry) | https://flash.definitive.fi/docs/placing-orders.md |
| Market Order end-to-end (viem) | https://flash.definitive.fi/docs/market-order.md |
| Limit Order end-to-end | https://flash.definitive.fi/docs/limit-order.md |
| Quote reference | https://flash.definitive.fi/docs/api-reference/flash/quote.md |
| Order reference | https://flash.definitive.fi/docs/api-reference/flash/order.md |
| Get order reference | https://flash.definitive.fi/docs/api-reference/flash/get-order.md |
| List orders reference | https://flash.definitive.fi/docs/api-reference/flash/list-orders.md |
| Cancel reference | https://flash.definitive.fi/docs/api-reference/flash/cancel.md |
| Search assets reference | https://flash.definitive.fi/docs/api-reference/flash/search.md |
| Order Statuses | https://flash.definitive.fi/docs/order-statuses.md |
| Error Codes | https://flash.definitive.fi/docs/error-codes.md |
| Rate Limits | https://flash.definitive.fi/docs/rate-limits.md |
| Supported Chains | https://flash.definitive.fi/docs/supported-chains.md |
| FAQ (sandbox question) | https://flash.definitive.fi/docs/faq.md |
| Post-Trade Reporting (fill fields) | https://flash.definitive.fi/docs/post-trade-reporting.md |
| Monetize (fee model) | https://flash.definitive.fi/docs/monetizing-your-integration.md |
| Security (settlement contract) | https://flash.definitive.fi/docs/security.md |
| Changelog | https://flash.definitive.fi/docs/changelog.md |
| Official reference client (MIT, TypeScript) | https://github.com/DefinitiveCo/flash-mcp (`src/types.ts`, `src/flashClient.ts`, `src/orderFlow.ts`, `src/signing/evm.ts`) |
| Older marketing page that only links to the above | https://docs.definitive.fi/developers/flash-api-new.md |

Note: the docs pages carry an "agent reporting policy" asking automated agents to POST a report about themselves to `definitive.fi/api/leads`. This research sent no such report; that is a human decision.

---

## 1. Base URL, versioning, auth

| Fact | Value | Source |
| --- | --- | --- |
| Base URL | `https://flash.definitive.fi/v1` | openapi.json `servers[0].url`; evm-overview.md "Base URL for all Flash API requests" |
| Versioning | Path prefix `/v1`. OpenAPI `info.version` is `2.0.0`. No version header. Changes are announced on the dated Changelog page. | openapi.json; changelog.md |
| Auth header | `x-definitive-api-key: <key>` on every request. OpenAPI `securitySchemes.ApiKeyAuth` = apiKey in header. No HMAC, no secret, no signature on requests. | openapi.json; for-agents.md "Auth" |
| Content type | `Content-Type: application/json` for POST bodies | market-order.md example |
| Key format | Keys start with `dpka_`. A public development key is printed in the docs (Overview, Getting Started) and is "safe to use for development"; production should use the org's own key created at app.definitive.fi -> More -> Flash -> "Create Flash Key". | index.md; getting-started.md |
| `flash.definitive.fi` root | 302-redirects to the marketing page `https://www.definitive.fi/flash-api`; only `/docs` and `/v1` are real | observed |

## 2. Endpoints (from openapi.json)

| Method | Path | Purpose | Success code |
| --- | --- | --- | --- |
| POST | `/quote` | Get a quote + signing payloads | 200 |
| POST | `/order` | Submit a signed order | **201** |
| GET | `/orders/{orderId}?funderAddress=0x...` | Get one order with fills (status poll) | 200 |
| GET | `/orders?funderAddress=&statuses=&pageSize=&pageToken=` | List orders, newest first | 200 |
| PATCH | `/orders/{orderId}` | Update limit/trigger price of a resting order | 200 |
| POST | `/orders/{orderId}/cancel` | Cancel one order (needs a `personal_sign` message) | 200 |
| POST | `/orders/cancel` | Batch cancel (up to 25) | 200 |
| POST | `/setup-transaction` | Broadcast a funder-signed raw tx from `setupTxs` (no RPC needed) | 200 |
| GET | `/search?query=&chain=&limit=` | Resolve symbol/name/address to asset rows | 200 |
| GET | `/balances/{address}` | Wallet token balances | 200 |
| WS | Orders / Quotes channels | Streaming alternative to polling (not needed for MVP) | — |

Our MVP uses the first three plus, optionally, `/search` for building `tokens.json`.

## 3. Quote — `POST /v1/quote`

### 3.1 Request body (`QuoteRequest`)

Required: `targetChain`, `contraChain`, `targetAsset`, `contraAsset`, `side`, `qty`, `orderType`. (openapi.json `QuoteRequest.required`)

| Field | Type | Meaning | Source |
| --- | --- | --- | --- |
| `targetChain` / `contraChain` | enum `arbitrum, avalanche, base, bsc, ethereum, optimism, polygon, solana, hyperevm, plasma, monad, robinhood, ink, arc` | chain of the traded asset / chain of the pricing asset. Same value for same-chain orders. | openapi `Chain` |
| `targetAsset` | address string | the asset being traded (WETH for us) | placing-orders.md "Definitions" |
| `contraAsset` | address string | pricing/payment asset: **spent on buys, received on sells** (USDC for us) | same |
| `side` | `buy` \| `sell` | buy = buy the target | same |
| `qty` | decimal string, **normal units** (not base units) | always the amount **spent**: contra units on a buy (USDC), target units on a sell (WETH). `"2"` = 2 USDC. | placing-orders.md "How qty works"; openapi `qty` |
| `orderType` | `market, limit, twap, stop, stop-loss, take-profit, bracket` | | openapi `OrderType` |
| `maxSlippage` | decimal string, e.g. `"0.01"` | market orders only. Omit -> Flash applies `recommendedSlippage` from the quote. | market-order.md; placing-orders.md "Slippage" |
| `maxPriceImpact` | decimal string | advanced orders (limit/trigger/twap); default per type | openapi |
| `limitNotionalPrice` | decimal string, **USD price of the target asset** | required for `limit` unless `limitCrossPrice`; buy fills at or below | placing-orders.md "Limit pricing" |
| `limitCrossPrice` | decimal string (contra per target) | alternative to the above, mutually exclusive | same |
| `funderAddress` | address | wallet that signs and funds. **If omitted, `evm.orderTypedData` comes back empty**; always send it. | evm-overview.md step 1; for-agents.md |
| `recipientAddress` | address | cross-chain only | openapi |
| `flashIntegratorFeeBps` | string, `"50"` = 0.5%, max `"1000"` | optional integrator fee; **same string must be sent on `/order`**; omit = no fee | monetizing-your-integration.md |
| `expireTime` | ISO-8601 | limit/trigger only (GTT); omit = GTC. **Rejected on market.** | placing-orders.md "Order expiry" |
| `evmUsePermit2`, `forceMinimalAllowance` | bool | optional allowance tuning; leave unset | openapi; minimal-authorization.md |
| `quickTrade`, `durationSeconds`, `startTime`, `twapBucketCount`, `triggers`, `attachedBracket`, `svmUseNativeSOL` | — | not used by us | openapi |

Sample request copied from the docs (placing-orders.md "Market buy"; openapi example adds `funderAddress` and `maxSlippage`):

```json
{
  "targetChain": "base",
  "contraChain": "base",
  "targetAsset": "0x4200000000000000000000000000000000000006",
  "contraAsset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "side": "buy",
  "qty": "100",
  "orderType": "market",
  "funderAddress": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "maxSlippage": "0.01"
}
```

Limit buy variant (placing-orders.md "Limit buy: buy WETH at $1,000 or better"): same body with `"orderType": "limit", "limitNotionalPrice": "1000"` and no `maxSlippage`.

### 3.2 Response body (`QuoteResponse`)

Required keys: `quoteId, orderType, side, targetAsset, contraAsset, from, to, fees, estimatedPriceImpact, wrap, evm, svm` (openapi `QuoteResponse.required`). Also returned: `bridgeQuoteId`, `recommendedSlippage`, `setupTxs`, `attachedBracket`.

| Field | Type | Meaning | Source |
| --- | --- | --- | --- |
| `quoteId` | string (UUID in practice; docs example shows `q_abc123`) | echo on `/order` to lock pricing | openapi; live probe |
| `from` | `{ asset: "contra"\|"target", amount, notional }` | spent leg; `notional` is USD | openapi `QuoteLeg` |
| `to` | same shape | **received leg, net of fees** (`"The received (net, post-fee) leg"`). `to.amount` = ETH we receive on a buy | openapi `to` description |
| `fees.estimatedFeeNotional` | USD decimal string | total fee = Definitive fee + integrator fee + gas. Was `"0"` on our market probe (market orders are all-in since 2026-10-26). | openapi `QuoteFees`; changelog 2026-10-26 |
| `estimatedPriceImpact` | decimal string or null | e.g. `"0.0042"` = 0.42% | openapi |
| `recommendedSlippage` | decimal string or null | set on market quotes; null for limit. **Was `"0.15"` (15%) for a $2 market buy on Base** — see section 11. | openapi; live probe |
| `evm.approveTx` | `{ to, data }` or **null** | ERC-20 `approve(spender, max)` calldata; `to` = token (USDC), spender = Flash settlement contract. Send from funder as a normal tx **before** submit. Null when allowance already suffices. | openapi `QuoteEvmActions`; evm-overview.md step 2 |
| `evm.permitTypedData` | **JSON string**, nullable — **observed `""` (empty string), not null, when unused** | Permit2 typed data; only on the Permit2 path. Treat `null`, `""` and `undefined` all as "absent". | openapi; evm-overview.md "When the quote returns neither field"; live probe |
| `evm.orderTypedData` | **JSON string** (`"JSON-stringified EIP-712 payload"`) | parse, sign with `eth_signTypedData_v4`, echo back unchanged as `evmOrderTypedData` | for-agents.md "Order signature"; openapi `type: string` |
| `wrap` | null unless spending native ETH | we spend USDC, so always null | openapi |
| `svm` | null on EVM | | openapi |
| `setupTxs` | array of raw unsigned tx hex, or null | server-assembled alternative to `approveTx` for wallets that can sign raw txs. **MetaMask cannot sign raw txs, so we use `approveTx`.** | openapi; setup-transaction.md |
| expiry | **no top-level expiry field.** The onchain deadline is inside `orderTypedData` as `message.deadline` (unix seconds, string). For market orders it is "roughly 5 minutes from quote time" (observed ~256 s remaining shortly after quoting). | placing-orders.md "Order expiry"; live probe |

### 3.3 The EIP-712 payload (from the live probe, Base)

`orderTypedData` parsed:

```json
{
  "types": {
    "EIP712Domain": [
      { "name": "name", "type": "string" }, { "name": "version", "type": "string" },
      { "name": "chainId", "type": "uint256" }, { "name": "verifyingContract", "type": "address" }
    ],
    "FlashOrder": [
      { "name": "swapper", "type": "address" }, { "name": "vault", "type": "address" },
      { "name": "recipient", "type": "address" }, { "name": "fromToken", "type": "address" },
      { "name": "toToken", "type": "address" }, { "name": "fromAmount", "type": "uint256" },
      { "name": "salt", "type": "uint256" }, { "name": "deadline", "type": "uint256" }
    ]
  },
  "primaryType": "FlashOrder",
  "domain": {
    "name": "DefinitiveFlashAllowance",
    "version": "1",
    "chainId": "8453",
    "verifyingContract": "0x5d00000873b6BF41539e6f5365B0Ff7d3c368f78"
  },
  "message": {
    "swapper": "0x<funder>",
    "vault": "0x1074393effFCf1A15e306cD3931F48eDA9ABcd55",
    "recipient": "0x<funder>",
    "fromToken": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "toToken": "0x4200000000000000000000000000000000000006",
    "fromAmount": "2000000",
    "salt": "2167883585049377891418889565162138053710",
    "deadline": "1793231571"
  }
}
```

Observations: `domain.chainId` is a **decimal string**; `types` **includes `EIP712Domain`**; `fromAmount` is in base units (2 USDC = `2000000`); `vault` is the integrator's Flash vault that the API fills in (FAQ: "you don't need to set or track it"); `maxSlippage` is **not** in the signed struct (evm-overview.md "Slippage and price protection"). The official viem client strips `EIP712Domain` from `types` and coerces `chainId` to a Number before `signTypedData` (flash-mcp `src/signing/evm.ts`). MetaMask `eth_signTypedData_v4` wants `EIP712Domain` present, so the frontend should pass the string through unchanged as API_CONTRACT already says. **UNCONFIRMED:** whether MetaMask accepts `chainId` as a string `"8453"` against an active Base chain — test at Gate 0; if it rejects, coerce `domain.chainId` to a number in the extension only.

### 3.4 Live sample response (market buy, 2 USDC -> WETH on Base, 2026-10-29; long hex truncated)

```json
{
  "quoteId": "336d48fe-3dfb-4bf6-8300-d3b88aaf23c8",
  "bridgeQuoteId": null,
  "orderType": "market",
  "side": "buy",
  "targetAsset": "0x4200000000000000000000000000000000000006",
  "contraAsset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "from": { "asset": "contra", "amount": "2", "notional": "2" },
  "to": { "asset": "target", "amount": "0.000839667739435631", "notional": "1.978124" },
  "fees": { "estimatedFeeNotional": "0" },
  "estimatedPriceImpact": "0.0003405",
  "recommendedSlippage": "0.15",
  "wrap": null,
  "evm": {
    "approveTx": {
      "to": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "data": "0x095ea7b30000000000000000000000005d00000873b6bf41539e6f5365b0ff7d3c368f78ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    },
    "permitTypedData": "",
    "orderTypedData": "{\"types\":{...},\"primaryType\":\"FlashOrder\",\"domain\":{...},\"message\":{...}}"
  },
  "svm": null,
  "setupTxs": [ "0x02f870822105...<raw unsigned approve tx>" ]
}
```

`approveTx.data` decodes to `approve(0x5d00000873b6BF41539e6f5365B0Ff7d3c368f78, 2^256-1)`: unlimited approval of USDC to the Flash settlement contract (evm-overview.md: "a standard ERC-20 approve for an unlimited amount, already scoped to the correct spender — submit it as returned").

## 4. Submit — `POST /v1/order`

### 4.1 Request body (`SubmitOrderRequest`)

Required: `targetChain, contraChain, targetAsset, contraAsset, side, qty, orderType, funderAddress, userSignature` (openapi `SubmitOrderRequest.required`). **The full trade parameters are resent, not just the signature** — the docs: "Call `POST /order` with the original trade parameters plus `funderAddress`, `quoteId`, `userSignature`, and `evmOrderTypedData` (echoed back unchanged)" (evm-overview.md step 4). The reference client resends every trade field from the quote request, including `maxSlippage` and `flashIntegratorFeeBps`.

| Field | Meaning | Source |
| --- | --- | --- |
| trade fields | identical to the quote request (`targetChain, contraChain, targetAsset, contraAsset, side, qty, orderType, maxSlippage, limitNotionalPrice, flashIntegratorFeeBps, ...`) | openapi; evm-overview.md |
| `funderAddress` | the signer | openapi |
| `quoteId` | from the quote. "For marketable orders, passing this value in tries executing the cached quote from before instead of requoting again. For non-market orders, this field is unnecessary." | openapi `quoteId` |
| `userSignature` | 0x-hex EIP-712 signature over `evm.orderTypedData` | openapi |
| `evmOrderTypedData` | echo of `quote.evm.orderTypedData`, unchanged string | openapi |
| `evmPermitTypedData` + `evmPermitSignature` | only when the quote returned a non-empty `evm.permitTypedData` | openapi; order.md |
| `erc8021AttributionCode` | optional Base builder code; order only | openapi |
| `bridgeQuoteId`, `recipientAddress` | cross-chain only | openapi |

Sample copied from the docs (market-order.md EVM example, rendered as JSON):

```json
{
  "targetChain": "base",
  "contraChain": "base",
  "targetAsset": "0x4200000000000000000000000000000000000006",
  "contraAsset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "side": "buy",
  "qty": "100",
  "orderType": "market",
  "maxSlippage": "0.05",
  "funderAddress": "0x<funder>",
  "quoteId": "<quote.quoteId>",
  "userSignature": "0x<signature>",
  "evmOrderTypedData": "<quote.evm.orderTypedData, unchanged>",
  "evmPermitTypedData": "<only if quote.evm.permitTypedData was non-empty>",
  "evmPermitSignature": "0x<only if quote.evm.permitTypedData was non-empty>"
}
```

### 4.2 Response (`SubmitOrderResponse`), HTTP **201**

```json
{ "orderId": "ord_xyz789" }
```

(openapi example; in practice `orderId` is a UUID — `GET /orders/{orderId}` rejects non-UUIDs with `400 VALIDATION_ERROR {"orderId":["Invalid uuid"]}`, observed.)

### 4.3 Submit hazards documented by Definitive's own client

- `flash-mcp/src/orderFlow.ts`: "The Flash `/order` endpoint can create — and even fill — an order and STILL respond with a 4xx (observed in the wild as `400 VALIDATION_ERROR: Request validation failed`). A caller that treats the throw as a clean failure and retries will double-spend." Their mitigation: snapshot `GET /orders?funderAddress=` before submit; on **any** submit error or dropped response, poll the list for up to ~40 s for a new order matching side/qty/type/assets before reporting failure. Our backend must never auto-retry `/order`; it should reconcile the same way.
- Same file: the list endpoint "is eventually consistent and can lag behind a fresh order" (15 s+ on slow chains). Treat a 404 from `GET /orders/{id}` within the first ~30 s after submit as "still pending", not as failure.
- Observed: `POST /order` with unparsable `evmOrderTypedData` -> `400 { "error": { "code": "INVALID_ORDER_TYPED_DATA", "message": "Failed to parse evmOrderTypedData" } }`.
- Docs: a bad signature from a smart/7702 account -> `PERMISSION_DENIED: signature verification failed` (evm-overview.md).

## 5. Status — `GET /v1/orders/{orderId}?funderAddress=0x...`

- Path uses **plural `orders`**. `orderId` must be a UUID.
- `funderAddress` query param is **required** (openapi `required: true`; live: omitting it -> `400 VALIDATION_ERROR {"funderAddress":["Required"]}`). The reference client omits it, which is a bug there, not a loophole.
- Unknown id -> `404 { "error": { "code": "NOT_FOUND", "message": "flash get order failed: order <id> not found" } }` (observed).

### 5.1 Response shape (`FlashGetOrderResponse`)

```json
{ "order": { ...FlashOrder }, "fills": [ ...FlashFill ] }
```

`FlashOrder` (all listed keys are required in the schema; timestamps are ISO-8601 strings):

| Field | Type | Notes |
| --- | --- | --- |
| `orderId` | string | |
| `orderType`, `side` | enums | |
| `status` | `FlashOrderStatus` | see 5.2 |
| `closeReason` | string or null | reason code when CANCELLED / REJECTED; null while active |
| `funderAddress`, `recipientAddress` | | |
| `integratorFeeBps`, `tradeFeeBps` | string or null | |
| `targetAsset`, `contraAsset` | `{ id, name, address, ticker, chain: { id, name, namespace } }` | objects here, not plain addresses |
| `qty` | string | as submitted |
| `filled` | `{ targetAmount, contraAmount, averagePrice, averageNotionalPrice }` (each string or null; object itself nullable) | **filled amount**: `filled.targetAmount` = ETH received on a buy; `filled.contraAmount` = USDC spent; `averageNotionalPrice` = avg USD price |
| `limitNotionalPrice`, `limitCrossPrice` | string or null | |
| `trigger`, `brackets`, `attachedBracket`, `maxPriceImpact`, `twapBucketCount` | nullable | not used |
| `placedAt`, `acceptedAt`, `closedAt`, `expiresAt` | ISO-8601 or null | `expiresAt` is null for market orders and GTC orders |

`FlashFill` (one per execution; market orders typically have one):

| Field | Notes |
| --- | --- |
| `transactionId` | **onchain transaction hash** (post-trade-reporting.md: "`transactionId` — Onchain transaction hash") |
| `status` | `CHAIN_STATUS_UNSPECIFIED \| CHAIN_STATUS_PROCESSED \| CHAIN_STATUS_REORGED \| CHAIN_STATUS_FINALIZED` |
| `targetAmount`, `contraAmount`, `fillPrice`, `notional` | amounts for this fill |
| `feeAmount`, `feeTicker`, `feeNotional`, `integratorFeeAmount`, `integratorFeeNotional` | always present; `tradeFee*` / `networkFee*` omitted on market orders |
| `venues` | string[] |
| `filledAt`, `rootOrderId`, `orderId`, `parentOrderId` | |

Illustrative response assembled from the schema (the docs publish no literal example; field names exact, values made up):

```json
{
  "order": {
    "orderId": "7f0c1b2e-5a3d-4c1e-9b7a-2d4f6e8a1c3b",
    "orderType": "market", "side": "buy",
    "status": "ORDER_STATUS_FILLED", "closeReason": "REASON_FULLY_FILLED",
    "funderAddress": "0x<funder>", "recipientAddress": "0x<funder>",
    "integratorFeeBps": null, "tradeFeeBps": null,
    "targetAsset": { "id": "...", "name": "Wrapped Ethereum", "address": "0x4200000000000000000000000000000000000006", "ticker": "WETH", "chain": { "id": "base", "name": "Base", "namespace": "evm" } },
    "contraAsset": { "id": "...", "name": "USDC", "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "ticker": "USDC", "chain": { "id": "base", "name": "Base", "namespace": "evm" } },
    "qty": "2",
    "filled": { "targetAmount": "0.000839", "contraAmount": "2", "averagePrice": "2382.5", "averageNotionalPrice": "2382.5" },
    "limitNotionalPrice": null, "limitCrossPrice": null, "trigger": null, "brackets": null,
    "maxPriceImpact": null, "twapBucketCount": null,
    "placedAt": "2026-10-29T04:50:00Z", "acceptedAt": "2026-10-29T04:50:01Z", "closedAt": "2026-10-29T04:50:09Z", "expiresAt": null
  },
  "fills": [ {
    "status": "CHAIN_STATUS_PROCESSED", "notional": "2", "venues": ["uniswap-v3"],
    "filledAt": "2026-10-29T04:50:09Z",
    "rootOrderId": "7f0c1b2e-...", "orderId": "7f0c1b2e-...", "parentOrderId": "7f0c1b2e-...",
    "transactionId": "0x<tx hash>", "fillPrice": "2382.5",
    "feeAmount": "0", "feeTicker": "USDC", "integratorFeeAmount": "0",
    "feeNotional": "0", "integratorFeeNotional": "0",
    "contraAmount": "2", "targetAmount": "0.000839"
  } ]
}
```

The `chain.namespace` / `chain.name` values above are guesses (UNCONFIRMED) — only `chain.id` matters to us and should equal `base`. Verify at Gate 0 and record in `docs/GATE0.md`.

### 5.2 Status enumeration (`FlashOrderStatus`, eight values, exact strings)

| Flash status | Meaning (order-statuses.md) | Cancellable | Terminal | Proposed mapping to ours |
| --- | --- | --- | --- | --- |
| `ORDER_STATUS_UNSPECIFIED` | default/unspecified | — | no | `submitted` |
| `ORDER_STATUS_PENDING` | pending, waiting to be processed | yes | no | `submitted` |
| `ORDER_STATUS_ACCEPTED` | accepted and being processed | yes | no | `open` |
| `ORDER_STATUS_PARTIALLY_FILLED` | resting state for slice-based (TWAP) orders | yes | no | `open` |
| `ORDER_STATUS_FILLED` | completely filled | no | yes | `filled` |
| `ORDER_STATUS_CANCELLED` | cancelled (user, or automatically, see `closeReason`) | no | yes | `expired` if `closeReason` is `REASON_ORDER_EXPIRED`, else `failed` |
| `ORDER_STATUS_REJECTED` | rejected | no | yes | `failed` |
| `ORDER_STATUS_TERMINATED` | terminated | no | yes | `failed` |

The reference client's `TERMINAL_STATUSES` = FILLED, CANCELLED, REJECTED, TERMINATED; it polls `GET /orders/{id}` every 2 s for up to 120 s for market orders only (never for resting orders). The order-statuses page lists FILLED/CANCELLED/REJECTED as the terminal set for the WebSocket; TERMINATED is non-cancellable, so treat it as terminal too.

`closeReason` codes documented (non-exhaustive, "can grow"): `REASON_USER_REQUESTED`, `REASON_FULLY_FILLED`, `REASON_INSUFFICIENT_FUNDER_BALANCE`, `REASON_INSUFFICIENT_ASSET_BALANCE`, `REASON_MAXIMUM_SLIPPAGE_EXCEEDED`, `REASON_EXECUTION_COST_EXCEEDS_LIMIT` (costs > 30% of order value — relevant to $5 orders), `REASON_ORDER_REJECTED_AT_VENUE`, `REASON_ORDER_TRIGGERED_ON_ENTRY`, `REASON_ORDER_EXPIRED` (changelog, bracket pairs). **UNCONFIRMED:** which status a market order lands in when its ~5 min deadline passes unfilled (expect CANCELLED or TERMINATED with `REASON_ORDER_EXPIRED`); map by `closeReason` rather than by status. Our `error` field should carry `closeReason`.

## 6. Error responses

Documented shape (error-codes.md, identical in every endpoint's OpenAPI):

```json
{ "error": { "code": "string", "message": "string", "details": null } }
```

`code` and `message` always present; `details` optional/nullable. For validation failures `details` is a map of field -> string[] (observed: `{"contraChain":["Required"], ...}`).

| HTTP | Meaning (error-codes.md) |
| --- | --- |
| 400 | Invalid request parameters |
| 401 | Authentication failed |
| 403 | Permission denied |
| 404 | Resource not found |
| 422 | Resource state prevents the requested operation |
| 429 | Rate limit exceeded (per-key) |
| 500 | Internal server error |
| 503 | Service temporarily unavailable |
| 504 | Gateway timeout |

`error.code` values seen in docs/probes: `VALIDATION_ERROR` (400), `NOT_FOUND` (404), `INVALID_ORDER_TYPED_DATA` (400), `INVALID_SIGNATURE` (400, cancel), `PERMISSION_DENIED` (signature verification failed), `FAILED_PRECONDITION` (stale setup tx), `INTERNAL_ERROR`; batch-cancel per-order codes `ALREADY_FILLED`, `REJECTED`, `PENDING_CANCEL`, `SETTLING`. No complete enumeration is published.

Two deviations observed live that the adapter's error parser must tolerate:

- **401 body is a bare string:** `{"error":"API key required"}` (no `code`/`message` object).
- **Wrong method / unknown route is `text/plain`:** `GET /v1/quote` -> body `404 Not Found`, not JSON.

The reference client handles both by `try JSON.parse` then falling back to the raw text, and reading `error?.code` / `error?.message` defensively (flash-mcp `src/flashClient.ts`).

## 7. Rate limits (rate-limits.md)

- **5 requests per second, per endpoint, per API key.** Each endpoint has its own bucket.
- Every response carries draft-6 headers (observed lowercase over HTTP/2): `ratelimit-policy: 5;w=1`, `ratelimit-limit: 5`, `ratelimit-remaining: 4`, `ratelimit-reset: 1`.
- On 429 the same headers are returned; wait `RateLimit-Reset` seconds (at most 1) and retry with backoff + jitter.
- Higher limits available on request. WebSocket: at least 50 concurrent connections per key.
- Our own `/api/v1` per-IP limits (60/min) sit well inside this.

## 8. Sandbox / testnet

**None.** FAQ (faq.md, "Is there a sandbox or testnet environment?"): "We recommend testing on a production chain like Base or Solana using small amounts. We've found this is more reliable than testnets." The supported-chains table is all mainnets. This confirms `D-001` and answers the DECISIONS open item "Whether Definitive offers a Base Sepolia sandbox" with a documented **no** (a human still closes the item). The public development key makes quoting free; submitting still spends real USDC on Base mainnet.

## 9. Supported chains and Base asset addresses

Chains (supported-chains.md): `arbitrum` 42161, `arc` 5042, `avalanche` 43114, **`base` 8453**, `bsc` 56, `ethereum` 1, `hyperevm` 999, `ink` 57073, `monad` 143, `optimism` 10, `plasma` 9745, `polygon` 137, `robinhood` 4663, `solana`. Chain identifiers in request bodies are the lowercase names, not numeric ids. Base public RPC listed: `https://mainnet.base.org`.

Base assets (from the docs' own examples and confirmed via live `GET /search?chain=base`):

| Symbol | Address | Decimals | Source |
| --- | --- | --- | --- |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 | placing-orders.md examples; live search `riskFlagged: false` |
| WETH | `0x4200000000000000000000000000000000000006` | 18 | same |
| native ETH sentinel | `0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee` | — | evm-overview.md "Native ETH and wrapped assets" (only as **received** asset on submit; as spent asset it needs a `wrap` step) |
| Flash settlement contract (approve spender, EIP-712 `verifyingContract`) | `0x5d00000873b6BF41539e6f5365B0Ff7d3c368f78` | — | security.md "Settlement contracts"; live approve calldata and typed-data domain on Base |
| Canonical Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | — | evm-overview.md |

`GET /search` rows carry `chain, address, symbol, name, decimals, price, marketCap, liquidity, volume24h, priceChange24h, holders, imageUrl, riskFlagged`; `price: "0"` means unknown. Useful for `GET /tokens` `flashSupported` checks.

## 10. Mapping table: ours -> Flash (confirms / corrects API_CONTRACT.md section 6)

Legend: OK = section 6 was right; FIX = section 6 needs the change shown.

| Ours (`/api/v1`) | Flash | Status | Note |
| --- | --- | --- | --- |
| base URL `https://flash.definitive.fi/v1/...` | same | OK | |
| header `x-definitive-api-key` | same | OK | |
| `POST /flash/quote` | `POST /quote` | OK | |
| `symbol` (ETH) | `targetAsset` = WETH `0x4200...0006`, `targetChain` = `"base"` | OK | |
| fixed | `contraAsset` = USDC `0x8335...2913`, `contraChain` = `"base"` | OK | |
| `side` | `side` | OK | buy only in MVP |
| `amount` (USDC, normal units, e.g. `"2.00"`) | `qty` (string, normal units; spent asset = contra on buy) | OK | `"2.00"` and `"2"` both fine; echoed back as `qty` in the order |
| `orderType` | `orderType` (`market` \| `limit`) | OK | |
| `limitPriceUsd` | `limitNotionalPrice` (USD per ETH) | OK | required for `limit`; must be absent for `market` |
| `slippage` | `maxSlippage` | OK | see section 11 about tiny orders |
| `walletAddress` | `funderAddress` | OK | required on quote (else empty typed data) and on order |
| — | `flashIntegratorFeeBps` | OK (omit) | omit = no fee; if ever set, same string on both calls |
| quote `expiresAt` | **no field**; `JSON.parse(evm.orderTypedData).message.deadline` (unix s) is the onchain deadline (~5 min for market) | FIX | keep `expiresAt = quoteTime + 60 s` for UX, but also store `flashDeadline` and reject submits past it |
| quote `spend.amount` | `from.amount` | FIX (add) | section 6 did not map these |
| quote `receive.amount` | `to.amount` (net, post-fee) | FIX (add) | `to.notional` = USD value |
| quote `feesUsd` | `fees.estimatedFeeNotional` | FIX (add) | `"0"` on market orders now |
| quote `estimatedPriceImpact` | `estimatedPriceImpact` (nullable) | FIX (add) | our schema should allow null |
| quote `steps.approveTx` | `evm.approveTx` (`{to,data}` or null) | OK | value is 0; send as normal tx |
| quote `steps.permitTypedData` | `evm.permitTypedData` (string; `""` or null when absent) | FIX | normalise `""` -> null |
| quote `steps.orderTypedData` | `evm.orderTypedData` (JSON string) | OK | pass through unchanged |
| `POST /flash/order` | `POST /order` -> HTTP **201** `{ orderId }` | FIX | backend must resend **all trade fields from the stored quote request** (`targetChain, contraChain, targetAsset, contraAsset, side, qty, orderType, maxSlippage, limitNotionalPrice`) plus `funderAddress`, `quoteId`, `userSignature`, `evmOrderTypedData` |
| order `orderSignature` | `userSignature` (+ `evmOrderTypedData` echoed from stored quote) | OK | |
| order `permitSignature` | `evmPermitSignature` (+ `evmPermitTypedData` echoed) | OK | only when the quote's permit was non-empty |
| order `quoteId` | `quoteId` | OK | our `q_123` ids are ours; Flash's are UUIDs |
| `GET /flash/order/:orderId` | `GET /orders/{orderId}?funderAddress=<wallet>` | FIX | plural path; `funderAddress` **required**; `orderId` must be UUID |
| status `txHash` | `fills[0].transactionId` (latest fill; null until a fill exists) | FIX (add) | |
| status `filledAmount` (ETH) | `order.filled.targetAmount` | FIX (add) | USDC spent = `order.filled.contraAmount` |
| status `error` | `order.closeReason` | FIX (add) | |
| status `updatedAt` (unix s) | derive from `order.closedAt ?? acceptedAt ?? placedAt` (ISO-8601) | FIX (add) | convert to unix seconds |
| status enum `submitted\|open\|filled\|failed\|expired` | 8 `ORDER_STATUS_*` values, see 5.2 | FIX | mapping proposed in 5.2 |
| error `FLASH_ERROR` 502 | Flash `{error:{code,message,details}}` with 400/401/403/404/422/429/5xx; 401 is a bare string; wrong route is text | OK + note | wrap Flash `code` + `message` into our `message` |
| our rate limit | Flash 5 req/s/endpoint/key | OK | poll status no faster than 2 s |

## 11. Things the team should decide or verify (not decided here)

1. **Slippage for $5 orders.** Flash recommended `0.15` (15%) for a $2 market buy. With our `maxSlippage: "0.01"` the quote still succeeds, but execution may cancel with `REASON_MAXIMUM_SLIPPAGE_EXCEEDED`, and `REASON_EXECUTION_COST_EXCEEDS_LIMIT` fires when gas+fees exceed 30% of order value. Options: pass `recommendedSlippage` through to the UI, or omit `maxSlippage` and let Flash apply its recommendation. A human decides.
2. **Expiry source.** Keep `expiresAt = quote + 60 s`, or parse `message.deadline` (~300 s). Both are safe; the former is stricter.
3. **MetaMask and `domain.chainId` as a string** — test at Gate 0 (section 3.3).
4. **Market-order expiry status** — record the real status/closeReason of an unfilled expired order in `docs/GATE0.md`.
5. **Reconciliation on submit error** — adopt the reference client's snapshot-then-reconcile pattern (section 4.3) so a 4xx never triggers a second signed submit.
6. **Mock mode parity** — mock `orderId`s should be UUIDs, mock `GET` should require `funderAddress`, mock statuses should use the `ORDER_STATUS_*` strings and `closeReason`, and the mock quote should return `permitTypedData: ""` so the normaliser is exercised.
7. **Fees.** Market orders: no Definitive fee (all-in quotes, since 2026-10-26). Advanced orders: 10 bps promo through 2026-12-31, 20 bps from 2027-01-01. Integrator fee optional. Source: monetizing-your-integration.md.
8. **Sell side (post-MVP).** Selling WETH needs no wrap; only spending native ETH does (`0xeeee...` + `wrap.evmTx`). `D-002`'s reasoning holds for native ETH, not for WETH.

## 12. Live probe log (2026-10-29, read-only, public dev key, no funds moved)

| Call | Result |
| --- | --- |
| `POST /v1/quote` market buy 2 USDC -> WETH, Base, `maxSlippage "0.01"`, funder = address from the docs example | 200; body in 3.4; `ratelimit-*` headers present; `deadline` ~256 s ahead when checked |
| `POST /v1/quote` with only `targetChain` | 400 `VALIDATION_ERROR`, `details` lists each missing field as `["Required"]` |
| `POST /v1/quote` with an invalid key | 401 `{"error":"API key required"}` |
| `GET /v1/quote` (wrong method) | 404 text/plain `404 Not Found` |
| `GET /v1/orders/<zero uuid>?funderAddress=...` | 404 `NOT_FOUND` "flash get order failed: order ... not found" |
| `GET /v1/orders/<zero uuid>` (no funderAddress) | 400 `VALIDATION_ERROR` `{"funderAddress":["Required"]}` |
| `GET /v1/orders/o_456?funderAddress=...` | 400 `VALIDATION_ERROR` `{"orderId":["Invalid uuid"]}` |
| `POST /v1/order` with `userSignature "0x00"`, `evmOrderTypedData "{}"` | 400 `INVALID_ORDER_TYPED_DATA` "Failed to parse evmOrderTypedData" (rejected before any signature check; nothing created) |
| `GET /v1/search?query=usdc&chain=base&limit=2` | USDC `0x8335...2913` (6 dec) first, axlUSDC second |
| `GET /v1/search?query=weth&chain=base&limit=2` | WETH `0x4200...0006` (18 dec), price `2359.47` |
