# Flash fixtures (placeholders)

These bodies are shaped after `docs/notes/flash-api.md` (OpenAPI 3.1 spec, live read-only quote probe on
2026-10-29, and the illustrative get-order response assembled from the schema). They are **placeholders until
`docs/GATE0.md` records real bodies** from a funded test order (T-003). Field names are exact; values are
invented. No real API key, signature, salt or transaction hash appears here (RULES 2.1).

| File | Flash call | Notes |
| --- | --- | --- |
| `quote.ok.json` | `POST /v1/quote` 200 | market buy 2 USDC -> WETH on Base; `permitTypedData` is `""` as observed live |
| `order.ok.json` | `POST /v1/order` 201 | only `orderId` is documented |
| `status.filled.json` | `GET /v1/orders/{id}?funderAddress=` 200 | `ORDER_STATUS_FILLED` with one fill; shape UNCONFIRMED until Gate 0 |
| `status.open.json` | same | `ORDER_STATUS_ACCEPTED` resting limit order, no fills |
| `error.4xx.json` | any endpoint 400 | documented `{ error: { code, message, details } }` shape |

When Gate 0 replaces them, keep the same file names so `test/clients/flashHttp.test.ts` stays untouched.
