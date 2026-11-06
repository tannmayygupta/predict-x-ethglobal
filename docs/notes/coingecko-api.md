# CoinGecko REST API notes (predictx backend)

Researched 2026-10-29 against the official docs (docs.coingecko.com) plus live
keyless calls to `api.coingecko.com` made on 2026-10-28 between 23:44 and
23:50 UTC. Anything marked **observed** is a live response we captured, not a
documented guarantee. Source URLs are in section 9.

Related contract: `GET /market/:symbol` in `docs/API_CONTRACT.md` returns
`{ symbol, name, address, flashChainId, priceUsd, change24hPct, updatedAt }`.
`docs/TASKS.md` T-B02 says: CoinGecko `simple/price`, 30 s memory cache.

## 0. TL;DR

| Question | Answer |
|---|---|
| Base URL (free Demo and keyless) | `https://api.coingecko.com/api/v3` |
| Base URL (paid Pro) | `https://pro-api.coingecko.com/api/v3` |
| Auth header (Demo) | `x-cg-demo-api-key` (query alt: `x_cg_demo_api_key`) |
| Auth header (Pro) | `x-cg-pro-api-key` (query alt: `x_cg_pro_api_key`) |
| Is a key required on `api.coingecko.com`? | No. Keyless works (observed), but it is a shared IP pool at "~5 calls/min (dynamic)" and documented as not for production or scheduled polling. |
| Spot + 24h change in one call | `GET /simple/price?ids=…&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true&precision=full` |
| 24h change key | `<coin>.usd_24h_change`, JSON number (percent), `null` when stale |
| 7d change | `GET /coins/markets?vs_currency=usd&ids=…&price_change_percentage=7d` -> `price_change_percentage_7d_in_currency` (number or null). One call for all tokens. |
| Demo limits | 100 calls/min (raised from 30 on 2026-05-17), 10,000 credits/month, only HTTP 200 consumes a credit |
| 429 shape | `{"status":{"error_code":429,"error_message":"…"}}` + `retry-after: 60`; Cloudflare may also return a plain-text body `Throttled` |
| 401 shape | `{"status":{"error_code":10002,"error_message":"API Key Missing…"}}` |
| Wrong key type | Pro key on public host -> HTTP **400**, `{"timestamp":…,"error_code":10010,"status":{"error_message":…}}` (third shape); Demo key on pro host -> 401 / 10002 |
| 404 shape (`/coins/{id}`) | `{"error":"coin not found"}` (different shape from 4xx above) |
| Our cache TTL | 60 s for spot/24h (matches Demo data freshness "from 60 sec"); 300 s for 7d. Lazy fetch on request, never a free-running poller (credit budget, see section 4). |
| Coin ids in `packages/shared/tokens.json` | `ethereum`, `bitcoin`, `pepe`, `degen-base`, `based-brett` all exist (observed, section 7). |

## 1. Plans, base URLs and authentication

| Plan | Root URL | Header | Query param | Rate limit | Monthly credits | Data freshness |
|---|---|---|---|---|---|---|
| Keyless public | `https://api.coingecko.com/api/v3` | none ("not needed and will be ignored") | none | "~5 calls/min (dynamic, varies by server load)", IP-based, shared by everyone on that IP | n/a | not stated |
| Demo (free) | `https://api.coingecko.com/api/v3` | `x-cg-demo-api-key` | `x_cg_demo_api_key` | 100 calls/min | 10,000 | "from 60 sec" |
| Basic (paid) | `https://pro-api.coingecko.com/api/v3` | `x-cg-pro-api-key` | `x_cg_pro_api_key` | 300 calls/min | 100,000 | "from 10 sec" |
| Analyst (paid) | same as Basic | same | same | 500 calls/min | 500,000 | "Real-time" |

Documented facts:

- Demo auth page: "All requests use the Demo API root URL: `https://api.coingecko.com/api/v3/`". Header is recommended; "Avoid query string parameters in production — they risk exposing your key in logs and browser history." Also: "Store your API key in your backend and use a proxy to inject it into requests."
- Pro auth page: "All requests use the Pro API root URL: `https://pro-api.coingecko.com/api/v3/`". "Failed requests (4xx, 5xx) do not consume credits, but still count toward your per-minute rate limit."
- Keyless page: "No headers, no auth — just send a request." "All keyless requests share an IP-based rate pool." "The keyless API is not suitable for production workloads, scheduled polling, or high-frequency updates." On 429: "back off exponentially before retrying." It recommends: "Sign up for a free Demo key — same endpoints, higher rate limits, and usage tracking."
- Errors page: error `10010` = "Wrong key type. If using a Pro key, your root URL must be `pro-api.coingecko.com`." Error `10011` = "Wrong key type. If using a Demo key, your root URL must be `api.coingecko.com`."
- Every endpoint we need (`/ping`, `/simple/price`, `/coins/list`, `/coins/markets`, `/coins/{id}`, `/coins/{id}/market_chart`, `/simple/supported_vs_currencies`) is on the Demo / Keyless list (66 endpoints).
- Demo plan requires attribution (pricing page). Put "Data provided by CoinGecko" somewhere visible in the popup.

Observed:

- `GET https://api.coingecko.com/api/v3/ping` with no key -> `200 {"gecko_says":"(V3) To the Moon!"}`.
- `GET https://pro-api.coingecko.com/api/v3/ping` with no key -> `401 {"status":{"error_code":10002,"error_message":"API Key Missing"}}`.
- `GET https://api.coingecko.com/api/v3/ping` with an invalid `x-cg-demo-api-key` -> `401 {"status":{"timestamp":"2026-10-28T23:44:51.339+00:00","error_code":10002,"error_message":"API Key Missing. Please make sure you're using the right authentication method.  For Pro API, please visit: https://docs.coingecko.com/reference/authentication.  For Public/Demo API, please visit: https://docs.coingecko.com/v3.0.1/reference/introduction"}}`. So an invalid Demo key does **not** fall back to keyless; it fails. The backend must send the header only when a key is configured.
- `access-control-allow-origin: *` is set on responses, but keys must stay on the backend (AGENTS.md rule and CoinGecko's own advice), so the extension never calls CoinGecko directly.

Header selection rule for our client: pick the header from the host. If
`COINGECKO_BASE_URL` contains `pro-api.coingecko.com` send `x-cg-pro-api-key`,
otherwise send `x-cg-demo-api-key`; send nothing when `COINGECKO_API_KEY` is
empty.

## 2. `GET /simple/price` (spot + 24h change in one call)

Docs: https://docs.coingecko.com/reference/simple-price (Pro) and
https://docs.coingecko.com/demo/reference/simple-price (Demo). Same parameters
on both.

| Param | Required | Default | Notes |
|---|---|---|---|
| `vs_currencies` | yes | `usd` | comma-separated; see `/simple/supported_vs_currencies`. Omitting it returns **422** (observed), not 400. |
| `ids` | no | `bitcoin` | comma-separated coin ids from `/coins/list`. "Maximum of 515 IDs per request." Priority `ids` > `names` > `symbols`. Unknown ids are silently dropped from the response (observed). |
| `names`, `symbols`, `include_tokens` | no | — | alternative lookups; we use `ids` only. |
| `include_market_cap` | no | `false` | adds `usd_market_cap` |
| `include_24hr_vol` | no | `false` | adds `usd_24h_vol` |
| `include_24hr_change` | no | `false` | adds `usd_24h_change`. Docs: "returns `null` if stale". Note the param says `24hr`, the response key says `24h`. |
| `include_last_updated_at` | no | `false` | adds `last_updated_at`, UNIX seconds (integer) |
| `precision` | no | unset | `full` or `0`..`18` decimal places for the price value. See the PEPE gotcha below. |

Documented example response:

```json
{
  "bitcoin": {
    "usd": 76975,
    "usd_market_cap": 1542226908349.8406,
    "usd_24h_vol": 29096603418.89408,
    "usd_24h_change": -1.4093297098441402,
    "last_updated_at": 1779092258
  }
}
```

Shape: top-level keys are the coin ids you asked for; inner keys are
`<vs_currency>`, `<vs_currency>_market_cap`, `<vs_currency>_24h_vol`,
`<vs_currency>_24h_change` and the shared `last_updated_at`. All values are JSON
numbers; `usd_24h_change` is a percentage (e.g. `-1.409…` means -1.41 %) and may
be `null`.

Observed (2026-10-28T23:44:36Z, keyless), request:

```
GET https://api.coingecko.com/api/v3/simple/price
  ?ids=ethereum,bitcoin,pepe,degen-base,based-brett
  &vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true
  &include_market_cap=true&include_24hr_vol=true
```

```json
{
  "ethereum":    { "usd": 2357.43,    "usd_market_cap": 288002888709.36475,  "usd_24h_vol": 9799612335.316778,  "usd_24h_change": 0.38204610173698295, "last_updated_at": 1793231060 },
  "bitcoin":     { "usd": 81269,      "usd_market_cap": 1633671196816.4155,  "usd_24h_vol": 25997195857.149693, "usd_24h_change": 0.5131479758712681,  "last_updated_at": 1793231060 },
  "pepe":        { "usd": 5.0e-06,    "usd_market_cap": 2104309318.835443,   "usd_24h_vol": 812430805.8383607,  "usd_24h_change": 9.544922403181316,   "last_updated_at": 1793231060 },
  "degen-base":  { "usd": 0.00092752, "usd_market_cap": 33330565.358417794,  "usd_24h_vol": 3302009.459968189,  "usd_24h_change": 0.4094563603895941,  "last_updated_at": 1793231070 },
  "based-brett": { "usd": 0.00485782, "usd_market_cap": 48139348.64284667,   "usd_24h_vol": 4958935.815960936,  "usd_24h_change": 3.9355400986108178,  "last_updated_at": 1793231070 }
}
```

Response headers of note (observed): `cache-control: max-age=30, public,
must-revalidate, s-maxage=60`, `cf-cache-status: MISS|HIT`, `x-request-id`.

**PEPE precision gotcha (observed).** With no `precision` the price of PEPE
comes back as `5.0e-06`. With `precision=full` the same call returns
`5.007934381530032e-06` (about 0.16 % different). For a product that compares
spot to a strike like `0.0000120` that rounding is unacceptable, so always send
`precision=full`. `precision=2` for ETH returned `2357.43` as expected.
`usd_24h_change` is returned at full precision in every case.

Observed edge cases:

- `ids=ethereum,not-a-real-coin-xyz` -> `200 {"ethereum":{…}}`; the unknown id
  is simply absent. Treat a missing key as `UNSUPPORTED_TOKEN`/no data, do not
  assume every requested id is present.
- Missing `vs_currencies` -> `422 {"error":"Missing parameter vs_currencies"}`.

## 3. 7-day percentage change: which endpoint

Two options; both are on the Demo / Keyless list.

### Option A (recommended): `GET /coins/markets` with `price_change_percentage=7d`

Docs: https://docs.coingecko.com/reference/coins-markets and the Demo twin.

| Param | Required | Default | Notes |
|---|---|---|---|
| `vs_currency` | yes | `usd` | singular, unlike `/simple/price` |
| `ids` | no | — | comma-separated, "Max 250 per request" |
| `price_change_percentage` | no | — | "Include price change percentage timeframe, comma-separated if querying more than 1 timeframe." Valid: `1h`, `24h`, `7d`, `14d`, `30d`, `200d`, `1y`. |
| `per_page` | no | `100` | 1..250 |
| `page` | no | `1` | |
| `order` | no | `market_cap_desc` | |
| `sparkline` | no | `false` | leave off |
| `precision` | no | unset | `full` or `0`..`18` |
| `include_rehypothecated` | no | `false` | leave off |

Each timeframe `X` you request adds a field named
`price_change_percentage_X_in_currency` (number or null). The response is an
array (not keyed by id) so map it by `id`. `price_change_percentage_24h` and
`current_price` are always present, so this single call can also serve spot +
24h if we ever want one upstream call instead of two.

Observed (2026-10-28T23:44:40Z, keyless), request:

```
GET https://api.coingecko.com/api/v3/coins/markets
  ?vs_currency=usd&ids=ethereum,bitcoin,pepe,degen-base,based-brett
  &price_change_percentage=24h,7d&per_page=10&page=1&sparkline=false
```

Trimmed to the fields we care about (full objects have ~30 keys each):

```json
[
  { "id": "bitcoin",     "symbol": "btc",   "name": "Bitcoin",  "current_price": 81269,      "price_change_percentage_24h": 0.55002, "price_change_percentage_24h_in_currency": 0.55002, "price_change_percentage_7d_in_currency": -4.2104, "market_cap_rank": 1,   "last_updated": "2026-10-28T23:43:42.000Z" },
  { "id": "ethereum",    "symbol": "eth",   "name": "Ethereum", "current_price": 2357.43,    "price_change_percentage_24h": 0.40332, "price_change_percentage_24h_in_currency": 0.40332, "price_change_percentage_7d_in_currency": -5.5444, "market_cap_rank": 2,   "last_updated": "2026-10-28T23:43:42.000Z" },
  { "id": "pepe",        "symbol": "pepe",  "name": "Pepe",     "current_price": 5.0e-06,    "price_change_percentage_24h": 9.73246, "price_change_percentage_24h_in_currency": 9.73246, "price_change_percentage_7d_in_currency": 7.4625,  "market_cap_rank": 48,  "last_updated": "2026-10-28T23:43:42.000Z" },
  { "id": "based-brett", "symbol": "brett", "name": "Brett",    "current_price": 0.00485781, "price_change_percentage_24h": 3.93554, "price_change_percentage_24h_in_currency": 3.93554, "price_change_percentage_7d_in_currency": -3.9553, "market_cap_rank": 481, "last_updated": "2026-10-28T23:43:42.000Z" },
  { "id": "degen-base",  "symbol": "degen", "name": "Degen",    "current_price": 0.00092745, "price_change_percentage_24h": 0.40946, "price_change_percentage_24h_in_currency": 0.40946, "price_change_percentage_7d_in_currency": -5.7443, "market_cap_rank": 633, "last_updated": "2026-10-28T23:43:42.000Z" }
]
```

One complete item, for a fixture:

```json
{
  "id": "bitcoin", "symbol": "btc", "name": "Bitcoin",
  "image": "https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png?1696501400",
  "current_price": 81269, "market_cap": 1633904371860, "market_cap_rank": 1,
  "fully_diluted_valuation": 1633904371860, "total_volume": 25995493503,
  "high_24h": 81698, "low_24h": 80334, "price_change_24h": 414.9,
  "price_change_percentage_24h": 0.55002, "market_cap_change_24h": 8378412058,
  "market_cap_change_percentage_24h": 0.51543, "circulating_supply": 20104981.0,
  "total_supply": 20104981.0, "max_supply": 21000000.0, "ath": 126080,
  "ath_change_percentage": -35.54195, "ath_date": "2025-10-06T10:57:42.000Z",
  "atl": 67.81, "atl_change_percentage": 119749.33484, "atl_date": "2013-07-05T16:00:00.000Z",
  "roi": null, "last_updated": "2026-10-28T23:43:42.000Z",
  "price_change_percentage_24h_in_currency": 0.55002,
  "price_change_percentage_7d_in_currency": -4.2104
}
```

Response headers (observed): `total: 5`, `per-page: 10`, `cache-control:
max-age=30, public, must-revalidate, s-maxage=60`.

Note that `ethereum.roi` is an object (`{"times":…, "currency":"btc",
"percentage":…}`) while others have `roi: null`; `max_supply` is `null` for
ETH and DEGEN. Schemas must mark these nullable.

### Option B: `GET /coins/{id}` and read `market_data.price_change_percentage_7d`

Docs: https://docs.coingecko.com/reference/coins-id and the Demo twin.

Request `GET /coins/ethereum?localization=false&tickers=false&market_data=true&sparkline=false`
(`community_data` and `developer_data` are deprecated and ignored since
2026-08-28).

Observed (2026-10-28T23:46Z): HTTP 200, **32,215 bytes** even with tickers and
localization off, `market_data` has 47 keys, each price field is a 63-currency
map. Relevant subset:

```json
{
  "id": "ethereum",
  "market_data": {
    "current_price": { "usd": 2357.46, "...": "62 more currencies" },
    "price_change_24h": 9.146074,
    "price_change_percentage_24h": 0.38947,
    "price_change_percentage_7d": -5.04587,
    "price_change_percentage_24h_in_currency": { "usd": 0.38947, "...": "…" },
    "price_change_percentage_7d_in_currency":  { "usd": -5.04587, "...": "…" },
    "last_updated": "2026-10-28T23:44:54.000Z"
  },
  "last_updated": "2026-10-28T23:44:54.000Z"
}
```

`price_change_percentage_7d` is a plain number and equals the `usd` entry of
`price_change_percentage_7d_in_currency` (same in the docs example: `-0.89706`).
Other plain-number timeframes present: `14d`, `30d`, `60d`, `200d`, `1y`.

Why not B: one call per coin (5 credits vs 1), ~32 KB vs ~2.5 KB, and the
unknown-id case is a 404 we must special-case. Use B only when a single coin's
metadata is needed (it is not, today).

## 4. Rate limits and the credit budget

Documented:

- Demo: 100 calls/min (changelog 2026-05-17: "Requests-per-minute (RPM) rate limits have been increased", Demo 30 -> 100, Basic 250 -> 300). Older CoinGecko tutorials still say 30/min; they are stale.
- Demo: 10,000 credits per month; "Each request that returns HTTP 200 uses one credit from your monthly quota." Failed requests do not consume credits but "All requests count toward your per-minute rate limit — including 4xx and 5xx errors."
- Keyless: "~5 calls/min (dynamic, varies by server load)", IP-based and shared.
- No rate-limit headers are documented. We observed `retry-after: 60` on the 429.

Observed: six keyless calls in ~15 s was enough to get a 429. For the rest of
that minute the app-level JSON 429 was followed by a Cloudflare plain-text 429
(`Throttled`). After ~75 s everything worked again. So "~5 calls/min" is real.

Budget math for Demo (10,000 credits / month):

- 10,000 / 30 days = ~333 calls/day = ~14/hour = one call every ~4.3 min if
  continuous.
- A 60 s poller for spot alone burns ~43,200 credits/month. A 60 s spot + 300 s
  7d poller burns ~52,000. Both blow the quota in about a week.
- Therefore: **fetch lazily on request with a TTL cache, never a free-running
  poller**, and keep a monthly counter so we can log when we pass, say, 8,000.
  Hackathon traffic (a few users) stays far below the cap this way.
- Unit tests must use recorded fixtures (sections 2 and 3), never the network.
  Keyless is fine for a manual smoke test; set `COINGECKO_API_KEY` for anything
  that runs repeatedly.

## 5. Error responses

Documented table (https://docs.coingecko.com/docs/common-errors-rate-limit and the support article):

| HTTP / code | Meaning |
|---|---|
| 400 | invalid request, check parameters |
| 401 | API key missing or invalid |
| 403 | access blocked by the server |
| 408 | request timed out (client-side network) |
| 429 | rate limit exceeded; reduce call frequency or upgrade |
| 500 | unexpected server error |
| 503 | service unavailable; check status page |
| 1020 | "Blocked by CDN firewall rule" (Cloudflare) |
| 10002 | API key missing / incorrect credentials |
| 10005 | endpoint not available on your plan ("This request is limited to Pro API subscribers") |
| 10010 | wrong key type: Pro key must use `pro-api.coingecko.com` |
| 10011 | wrong key type: Demo key must use `api.coingecko.com` |
| CORS | server did not return CORS headers; proxy through the backend |

The docs do not publish example bodies. Observed shapes:

```http
HTTP/2 429
content-type: application/json
retry-after: 60
cache-control: private, max-age=0, no-store, no-cache, must-revalidate

{"status":{"error_code":429,"error_message":"You've exceeded the Rate Limit. Please visit https://www.coingecko.com/en/api/pricing to subscribe to our API plans for higher rate limits."}}
```

```http
HTTP/2 429            (Cloudflare edge, same minute, after the JSON 429)
Throttled
```

```http
HTTP/2 401            (pro host, no key)
{"status":{"error_code":10002,"error_message":"API Key Missing"}}
```

```http
HTTP/2 401            (public host, invalid x-cg-demo-api-key)
{"status":{"timestamp":"2026-10-28T23:44:51.339+00:00","error_code":10002,"error_message":"API Key Missing. Please make sure you're using the right authentication method.  For Pro API, please visit: https://docs.coingecko.com/reference/authentication.  For Public/Demo API, please visit: https://docs.coingecko.com/v3.0.1/reference/introduction"}}
```

```http
HTTP/2 404            (GET /coins/not-a-real-coin-xyz)
{"error":"coin not found"}
```

```http
HTTP/2 422            (GET /simple/price?ids=ethereum, no vs_currencies)
{"error":"Missing parameter vs_currencies"}
```

Wrong key type (10010 / 10011) observed shapes: see section 5.1.

Takeaways for the client:

1. Branch on `response.status` first; only then try `JSON.parse`, and tolerate a
   non-JSON body (`Throttled`).
2. Three JSON error shapes exist: `{"status":{"error_code","error_message"}}`,
   `{"error": "…"}`, and (10010) `{"error_code", "status":{"error_message"}}`.
   Parse with a union schema and read `error_code` from either level.
3. On 429 honor `retry-after` (seconds) if present, else exponential backoff
   (1 s, 2 s, 4 s, cap 60 s), and serve the stale cache entry meanwhile.
4. 401 / 10002 / 10010 / 10011 are configuration errors: fail the request fast,
   log once, do not retry.
5. Never retry 4xx in a loop; every call, even failures, counts against the
   per-minute limit.

### 5.1 Wrong key type (observed)

```http
HTTP/2 400            (public host api.coingecko.com, header x-cg-pro-api-key: <any value>)
{"timestamp":"2026-10-28T23:49:49.127+00:00","error_code":10010,"status":{"error_message":"If you are using Pro API key, please change your root URL from api.coingecko.com to pro-api.coingecko.com  Please refer here for more details: https://docs.coingecko.com/reference/authentication"}}
```

```http
HTTP/2 401            (pro host pro-api.coingecko.com, header x-cg-demo-api-key: <any value>)
{"status":{"error_code":10002,"error_message":"API Key Missing"}}
```

Two surprises versus the docs table:

- 10010 comes back as HTTP **400**, not 401, and with a **third body shape**:
  `error_code` sits at the top level while `error_message` is nested under
  `status`. The docs table lists the code but not the status or shape.
- A Demo key sent to the pro host is not reported as 10011; the pro host just
  says `10002 API Key Missing` because it only reads `x-cg-pro-api-key`.

So the client must treat any of 400/401/403 carrying `error_code` 10002, 10005,
10010 or 10011 (wherever the code sits in the body) as a configuration error.

## 6. Caching and recommended TTL

Documented:

- Pricing page: endpoints are cached "around 1 to 5 minutes" unless otherwise specified; "Paid Pro API plans generally update faster, e.g., 30 sec for the simple/price endpoint". Demo plan data freshness is listed as "from 60 sec", Basic "from 10 sec".
- The endpoint pages have a "Cache / Update Frequency" heading with "(Paid API)" and "(Demo / Keyless API)" bullets but, in the rendered and `.md` versions we fetched, no numbers.
- `/simple/price` tips: "Use `include_last_updated_at=true` or `include_24hr_change=true` (returns `null` if stale) to verify price freshness."

Observed response headers: `cache-control: max-age=30, public, must-revalidate,
s-maxage=60` on `/simple/price` and `/coins/markets`; `s-maxage=30` on
`/coins/{id}`; `cf-cache-status: HIT` on repeat calls. So Cloudflare already
serves the same payload for up to 60 s; calling more often than that just
spends credits for identical data.

Recommendation:

| Data | TTL | Why |
|---|---|---|
| spot + 24h (`/simple/price`) | 60 s | equals Demo freshness and the edge `s-maxage`; T-B02's 30 s is harmless but gains nothing |
| 7d (`/coins/markets`) | 300 s | a 7-day percentage moves slowly; 5x fewer credits |
| stale-while-error | serve a cached entry up to 10 min old when upstream returns 429/5xx/timeout, and set a `stale: true`/"Price delayed" flag (ARCHITECTURE.md already describes "Price delayed") | |

Expose `updatedAt` from `last_updated_at` (unix seconds) so the popup can show
age. For `/coins/markets` convert `last_updated` (ISO 8601) with `Date.parse / 1000`.

## 7. Coin ids in `packages/shared/tokens.json`

All five ids resolve on the live API (both `/simple/price` and
`/coins/markets`, 2026-10-28):

| `coingeckoId` | `symbol` | `name` | market cap rank | usd (observed) |
|---|---|---|---|---|
| `bitcoin` | btc | Bitcoin | 1 | 81269 |
| `ethereum` | eth | Ethereum | 2 | 2357.43 |
| `pepe` | pepe | Pepe | 48 | 5.0e-06 (default precision) / 5.0079e-06 (`precision=full`) |
| `based-brett` | brett | Brett | 481 | 0.00485781 |
| `degen-base` | degen | Degen | 633 | 0.00092745 |

The `symbol` values CoinGecko returns are lowercase (`btc`, `eth`, `pepe`,
`brett`, `degen`); our contract uses uppercase symbols, so always map by
`coingeckoId`, not by symbol.

## 8. Backend design recommendation

Environment (add to the backend `.env.example`; never in the extension):

```
COINGECKO_BASE_URL=https://api.coingecko.com/api/v3   # pro: https://pro-api.coingecko.com/api/v3
COINGECKO_API_KEY=                                   # optional; empty = keyless
COINGECKO_TIMEOUT_MS=5000
COINGECKO_SPOT_TTL_S=60
COINGECKO_WEEK_TTL_S=300
```

Calls:

1. **Spot + 24h, one call for every token in `tokens.json`:**
   `GET {base}/simple/price?ids=ethereum,bitcoin,pepe,degen-base,based-brett&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true&precision=full`
   -> cache the whole map for 60 s; `GET /market/:symbol` reads its coin from
   the map. Map `usd` -> `priceUsd` (string, keep full precision),
   `usd_24h_change` -> `change24hPct` (number, `null` allowed = stale),
   `last_updated_at` -> `updatedAt`.
2. **7d change, one call for every token:**
   `GET {base}/coins/markets?vs_currency=usd&ids=…&price_change_percentage=7d&per_page=250&page=1&precision=full`
   -> cache 300 s; read `price_change_percentage_7d_in_currency` keyed by `id`.
   `precision=full` works here too (observed: PEPE `current_price`
   `5.023941144847025e-06`, 7d `7.4625`); `high_24h`/`low_24h` stay rounded.
3. Optional single-call mode: `/coins/markets` with
   `price_change_percentage=24h,7d` returns `current_price`,
   `price_change_percentage_24h` and the 7d field together, one credit, if
   credits ever get tight. Downside: no explicit "stale -> null" on 24h and
   `last_updated` is ISO rather than unix.

Validation (zod, following the repo convention) — nullable where noted:

```ts
export const simplePriceEntry = z.object({
  usd: z.number(),
  usd_24h_change: z.number().nullable().optional(),
  last_updated_at: z.number().int().optional(),
  usd_market_cap: z.number().nullable().optional(),
  usd_24h_vol: z.number().nullable().optional(),
});
export const simplePriceResponse = z.record(z.string(), simplePriceEntry); // keys = coin ids

export const coinsMarketsItem = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  current_price: z.number().nullable(),
  price_change_percentage_24h: z.number().nullable(),
  price_change_percentage_7d_in_currency: z.number().nullable().optional(),
  last_updated: z.string(),
}).passthrough();
export const coinsMarketsResponse = z.array(coinsMarketsItem);

export const coinGeckoError = z.union([
  // 401 10002, 429: {"status":{"error_code":429,"error_message":"…"}}
  z.object({ status: z.object({ error_code: z.number(), error_message: z.string(), timestamp: z.string().optional() }) }),
  // 400 10010: {"timestamp":"…","error_code":10010,"status":{"error_message":"…"}}
  z.object({ error_code: z.number(), timestamp: z.string().optional(), status: z.object({ error_message: z.string() }) }),
  // 404 / 422: {"error":"coin not found"} / {"error":"Missing parameter vs_currencies"}
  z.object({ error: z.string() }),
]);
export const coinGeckoErrorCode = (body: unknown): number | undefined => {
  const b = body as { error_code?: number; status?: { error_code?: number } } | null;
  return b?.error_code ?? b?.status?.error_code;
};
```

TDD fixture list (record from the observed JSON above):

- `simple-price.ok.json` (5 coins, section 2)
- `simple-price.missing-id.json` (`{"ethereum":{…}}` only)
- `coins-markets.ok.json` (5 items, section 3)
- `error.429.json`, `error.429.txt` (`Throttled`), `error.401.json`,
  `error.404.json`, `error.422.json`

Tests to write before the client:

- maps each token in `tokens.json` to a `MarketQuote` with full-precision
  `priceUsd` (PEPE must be `"0.000005007934381530032"`-class, not `"0.000005"`)
- `usd_24h_change: null` -> `change24hPct: null` and `stale: true`
- unknown symbol -> `UNSUPPORTED_TOKEN`; id missing from upstream map -> same
- 429 with `retry-after` -> serves cached value, schedules retry, no second
  upstream call inside the window
- non-JSON 429 body does not throw
- header is `x-cg-demo-api-key` for the public host, `x-cg-pro-api-key` for the
  pro host, absent when the key is empty
- second call inside the TTL does not hit the fetch mock

## 9. Sources

Official docs:

- Setting up your API key: https://docs.coingecko.com/reference/setting-up-your-api-key
- Demo API authentication (root URL, `x-cg-demo-api-key`): https://docs.coingecko.com/demo/reference/authentication
- Pro API authentication (root URL, `x-cg-pro-api-key`, credits note): https://docs.coingecko.com/reference/authentication
- Keyless Public API (no key, ~5 calls/min, not for production): https://docs.coingecko.com/docs/keyless-public-api
- Errors & rate limits (status/error code table, Demo 100/min, 4xx count toward RPM): https://docs.coingecko.com/docs/common-errors-rate-limit (also served as https://docs.coingecko.com/docs/errors-and-rate-limits.md)
- Changelog (2026-05-17 Demo 30 -> 100 RPM; 2026-08-14 `community_data`/`developer_data` removal): https://docs.coingecko.com/changelog
- Demo endpoint overview (66 keyless/demo endpoints): https://docs.coingecko.com/demo/reference/endpoint-overview
- Pro endpoint overview: https://docs.coingecko.com/reference/endpoint-overview
- `/simple/price`: https://docs.coingecko.com/reference/simple-price and https://docs.coingecko.com/demo/reference/simple-price
- `/coins/markets`: https://docs.coingecko.com/reference/coins-markets and https://docs.coingecko.com/demo/reference/coins-markets
- `/coins/{id}`: https://docs.coingecko.com/reference/coins-id and https://docs.coingecko.com/demo/reference/coins-id
- Docs index for agents: https://docs.coingecko.com/llms.txt

Pricing and support:

- Pricing (Demo 100/min, 10k credits, "from 60 sec", attribution; Basic 300/min, 100k, "from 10 sec"): https://www.coingecko.com/en/api/pricing
- Status codes explained: https://support.coingecko.com/hc/en-us/articles/6472757474457-How-can-I-differentiate-between-the-status-codes-I-am-receiving-and-what-do-they-mean
- 429 explained: https://support.coingecko.com/hc/en-us/articles/4538787440153-Why-am-I-getting-errors-with-a-status-code-429

Live calls (keyless, 2026-10-28 23:44–23:50 UTC) are reproduced verbatim above;
re-run them with `curl` against `https://api.coingecko.com/api/v3` to refresh.
