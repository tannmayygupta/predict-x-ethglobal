# @predictx/extension

Chrome (MV3) overlay for x.com. Everything it shows comes from the local backend or Base Sepolia; nothing is mocked.

## Parts

| Path | Runs in | Job |
| --- | --- | --- |
| `src/content/` | x.com, isolated world | Shadow DOM overlay (React + Tailwind), fonts, wallet state |
| `src/inpage/inpage.iife.ts` | x.com, main world | Finds MetaMask (EIP-6963) and answers allowlisted wallet requests |
| `src/bridge/` | both | `postMessage` protocol and the content-side `BridgeProvider` |
| `src/background/` | service worker | Backend gateway: only URLs under `VITE_API_BASE_URL`, GET/POST, coalesces and briefly caches GETs |

The overlay never calls the backend itself (x.com CORS/CSP/Private Network Access would block `localhost`); it asks the service worker. It never holds a key: signing happens in MetaMask.

## Build and load

```sh
cp .env.example .env            # repo root, once; VITE_* values are read from there
pnpm install                    # repo root
pnpm --filter @predictx/extension build
```

In Chrome open `chrome://extensions`, turn on Developer mode, **Load unpacked**, choose `apps/extension/dist`. After a rebuild press the reload icon on the extension and refresh x.com.

`pnpm --filter @predictx/extension dev` serves a hot-reloading build to the same `dist` folder.

## Test

```sh
pnpm --filter @predictx/extension test       # gateway rules, bridge protocol, wallet allowlist
pnpm --filter @predictx/extension typecheck
```
