# @predictx/backend

Fastify API behind the extension and the dashboard: token allowlist, CoinGecko market data, the Definitive Flash proxy, the OpenAI insight endpoint and PredictionPool reads. Contract: `docs/API_CONTRACT.md`; schemas: `@predictx/shared`.

## Run locally

```bash
cp .env.example .env                       # repo root; FLASH_MOCK=true needs no key
pnpm install                               # repo root, once
pnpm --filter @predictx/backend test       # unit suite, no network (fetch is stubbed)
pnpm --filter @predictx/backend start      # tsx src/server.ts, listens on 0.0.0.0:$PORT
curl -s localhost:8787/api/v1/health       # {"ok":true}
```

There is no build step: the server runs from TypeScript through `tsx` (`build` only type-checks). `server.ts` loads the repo-root `.env` unless `ENV_FILE` points elsewhere; variables already in the environment win.

Boot writes two JSON log lines worth reading: `backend config` (every value, secrets shown as `[set]` or `[empty]`, the RPC URL reduced to its origin) and `backend listening` with the bound port. A config error exits with code 1 and one `backend failed to start` line whose `reason` names the variable.

## Market data (CoinGecko only, D-005)

- One batched `GET /coins/markets` (all allowlist ids, `precision=full`, 24h and 7d changes) feeds `/market/:symbol` and the insight prompt; cached 60 s with single-flight. A cached price older than 15 minutes is no longer served: the route answers 502.
- `GET /market/:symbol/chart?range=24h|7d` comes from `market_chart` (289 five-minute or 169 hourly points), cut to at most 96 (24h) or 85 (7d) points; open, low and high are computed from the full series first. Cached 300 s (24h) and 900 s (7d); a chart older than 1 h answers 502. A bad `range` is a 400.
- Liquidity is `total_reserve_in_usd` from CoinGecko's onchain endpoint (same host and key), truncated to cents; it is null when no pool is listed or the lookup fails. High, low and liquidity never fail `/market`.
- A 429 from CoinGecko opens a window (its `Retry-After`, else 60 s) in which no request is sent and only cached data is served.
- Flash `/search` is not used (it is gated for our key); Flash supplies only quotes. The insight service never imports the Flash client or service (FR-I-04, enforced by a static test).

## Environment variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `PORT` | no | `8787` | Hosts inject their own; `0` picks a free port (smoke test). |
| `ALLOWED_ORIGINS` | yes | | Comma-separated. Must include `https://x.com` and the dashboard origin. |
| `FLASH_MOCK` | yes | | `true` serves deterministic quotes; `false` calls Definitive Flash on Base mainnet. |
| `FLASH_API_KEY` | when `FLASH_MOCK=false` | empty | Boot fails fast without it. |
| `FLASH_BASE_URL` | no | `https://flash.definitive.fi/v1` | |
| `OPENAI_API_KEY` | no | empty | Empty or invalid: `/insight` still answers 200 with `degraded: true`. |
| `OPENAI_MODEL` | no | empty | Model id, chosen by a human (DECISIONS open item). |
| `COINGECKO_API_KEY` | no | empty | Demo key; the free tier works without one. |
| `POOL_CHAIN_ID` | yes | | `84532` (Base Sepolia). |
| `POOL_ADDRESS` | yes | | `0x` + 40 hex; the deployed PredictionPool. |
| `POOL_RPC_URL` | yes | | Only its origin is ever logged. |
| `SQLITE_PATH` | yes | | File path or `:memory:`. Put it on the persistent disk in production. |
| `DASHBOARD_URL` | no | `http://localhost:5173` | Builds `pool.dashboardUrl`. |
| `LOG_LEVEL` | no | `info` | pino level. |
| `TRUST_PROXY` | no | `false` | `false` or a positive hop count. Use `1` behind Railway/Render: the client IP for rate limiting is then the address the platform proxy appended to `x-forwarded-for`, and anything the client wrote further left is ignored. `true` is rejected at boot because it would trust every hop and let a client spoof its IP to reset its rate limit. |
| `VALIDATE_RESPONSES` | no | `true` | Runtime response-schema check; may be `false` in production. |
| `ENV_FILE` | no | repo `.env` | Alternative dotenv path; a missing file is ignored. |

Keys never leave the backend: nothing here is prefixed `VITE_`, and the log redaction censors key headers, key fields, signatures and typed data.

## Hosting (Railway or Render, no Dockerfile)

Both platforms build from the monorepo root with the lockfile and start the backend workspace.

| Setting | Value |
| --- | --- |
| Root directory | repository root (the workspace needs `packages/shared`) |
| Node | **22 or newer**: `better-sqlite3` 13 ships N-API prebuilds for linux-x64/arm64 and needs Node >= 22; no `node-gyp` build should run (`apps/backend/package.json` `engines`) |
| Package manager | pnpm 9.12.0 via corepack (root `packageManager`); Railway's Nixpacks detects it from the lockfile, on Render prefix the build with `corepack enable` |
| Build command | `pnpm install --frozen-lockfile` |
| Start command | `pnpm --filter @predictx/backend start` |
| Health check path | `/api/v1/health` |
| Persistent disk | Railway: a Volume mounted at `/data`; Render: a Disk mounted at `/var/data`. Set `SQLITE_PATH=/data/predictx.sqlite` (or `/var/data/...`). Without a disk, quotes and orders vanish on every deploy. |
| Environment | every variable above; `FLASH_MOCK=false` with the real `FLASH_API_KEY`, `TRUST_PROXY=1`, `ALLOWED_ORIGINS=https://x.com,<dashboard origin>`, `DASHBOARD_URL=<dashboard origin>` |

Railway: set `NIXPACKS_NODE_VERSION=22` if the detected Node is older. Render: add a `.node-version` file or `NODE_VERSION=22` in the environment. Both inject `PORT`; leave it unset. One instance only: the rate limiter and the SQLite file are per process.

## Deployment checklist (TEST_PLAN 8.2, manual, record in `docs/WORKLOG.md`)

Replace `$URL` with the public base URL (no trailing slash).

```
- [ ] B10-05  curl -s $URL/api/v1/health                                    -> {"ok":true}
- [ ] B10-06  curl -sI -H "Origin: https://x.com" $URL/api/v1/tokens        -> access-control-allow-origin: https://x.com
              curl -sI -H "Origin: <dashboard origin>" $URL/api/v1/tokens   -> access-control-allow-origin: <dashboard origin>
              curl -sI -H "Origin: https://evil.example" $URL/api/v1/tokens -> no access-control-allow-origin header
- [ ] B10-07  FLASH_MOCK=false in the host environment; the boot log shows flashMock:false and flashApiKey:"[set]";
              curl -s -X POST $URL/api/v1/flash/quote -H "content-type: application/json" \
                -d '{"walletAddress":"<funded wallet>","symbol":"ETH","side":"buy","orderType":"market","amount":"1.00"}'
              -> parses with FlashQuoteResponse (no order is placed by a quote)
- [ ] B10-08  no key values in the deployed artifact: grep the build/output directory for the FLASH, OPENAI and
              COINGECKO key strings; only .env on the host holds them (and .env is not in git)
- [ ] B10-09  TRUST_PROXY=1 on the host; 61 requests to $URL/api/v1/tokens within a minute from one client
              return 429 RATE_LIMITED on the 61st, and a second client is unaffected
- [ ] write the public URL into docs/WORKLOG.md under T-B10
```
