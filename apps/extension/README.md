# @predictx/extension

Chrome (MV3) overlay for x.com. Everything it shows comes from the PredictX backend (the deployed one, or a local one if you build for a local stack, see below) or Base Sepolia; nothing is mocked.

## Parts

| Path | Runs in | Job |
| --- | --- | --- |
| `src/content/` | x.com, isolated world | Shadow DOM overlay (React + Tailwind), fonts, wallet state |
| `src/inpage/inpage.iife.ts` | x.com, main world | Finds MetaMask (EIP-6963) and answers allowlisted wallet requests |
| `src/bridge/` | both | `postMessage` protocol and the content-side `BridgeProvider` |
| `src/background/` | service worker | Backend gateway: only URLs under the extension's API base URL (`VITE_EXTENSION_API_BASE_URL`, default the deployed API), GET/POST, coalesces and briefly caches GETs |

The overlay never calls the backend itself (x.com CORS/CSP/Private Network Access would block `localhost`); it asks the service worker. It never holds a key: signing happens in MetaMask.

## Build and load

```sh
pnpm install                    # repo root
pnpm --filter @predictx/extension build
```

The build targets the deployed app, https://predictx-tawny.vercel.app (dashboard and API are one origin), so the link in every post it drafts opens for anyone. It does not read the dashboard's `VITE_API_BASE_URL` / `VITE_DASHBOARD_URL`, so a localhost `.env` cannot leak into a post.

For a build against your own backend and dashboard, `cp .env.example .env` at the repo root once, uncomment the two `VITE_EXTENSION_*` lines and rebuild. `pnpm demo` does this for its own build; the `dist` it leaves behind posts `localhost` links, so run the plain build above before posting for real.

In Chrome open `chrome://extensions`, turn on Developer mode, **Load unpacked**, choose `apps/extension/dist`. After a rebuild press the reload icon on the extension and refresh x.com.

`pnpm --filter @predictx/extension dev` serves a hot-reloading build to the same `dist` folder (same defaults).

## Test

```sh
pnpm --filter @predictx/extension test       # gateway rules, bridge protocol, wallet allowlist
pnpm --filter @predictx/extension typecheck
```
