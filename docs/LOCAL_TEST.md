# Run PredictX locally (testnet only)

Everything here uses Base Sepolia test funds. Nothing touches Base mainnet: the Swap tab fetches real Flash quotes and never sends an order.

## 0. One-time setup

| Need | How |
| --- | --- |
| Node 22, pnpm 9, Foundry, Bun | already used by the repo (`node -v`, `pnpm -v`) |
| Chainlink `cre` CLI | Installed on this machine (v1.39.0, signature checked, in `%LOCALAPPDATA%\Programs\cre`). You still have to sign in: run `cre login` once (it opens your browser), then `cre whoami`. For an unattended loop you can instead put a `CRE_API_KEY` in `.env`. On a new machine: `irm https://app.chain.link/cre/install.ps1 \| iex` |
| MetaMask in Chrome | with two accounts (A bets YES, B bets NO) |
| Base Sepolia ETH | free from a faucet, for gas: a little in every wallet below |

Create `.env` at the repo root (it is git-ignored): `cp .env.example .env`, then fill in:

| Variable | Used by | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY`, `OPENAI_MODEL=gpt-6-luna` | backend | without them the Insight tab shows the basic fallback note |
| `FLASH_API_KEY`, `FLASH_MOCK=false` | backend | free key from app.definitive.fi (More, Flash). Keep `FLASH_ORDERS_ENABLED=false` |
| `COINGECKO_API_KEY` | backend | Demo key. Needed for the batched market call, the chart and liquidity; keyless gets 429 quickly. The backend reads `.env` only at start: restart it after editing |
| `CRE_ETH_PRIVATE_KEY` | resolver loop | a throwaway wallet with Base Sepolia ETH; it pays gas to deliver settlements |
| `CRE_API_KEY` (optional) | resolver loop | alternative to `cre login` for running the loop unattended |
| `TEST_WALLET_A_PRIVATE_KEY`, `TEST_WALLET_B_PRIVATE_KEY` | `e2e-lifecycle` and live tests | throwaway wallets with Base Sepolia ETH. Never a real wallet |

If you leave `FLASH_API_KEY` empty keep `FLASH_MOCK=true`: the Swap tab then shows a visible MOCK badge on fake quotes.

## 1. Start everything (four terminals)

```sh
pnpm install

# 1. backend  -> http://localhost:8787/api/v1/health
pnpm --filter @predictx/backend start

# 2. dashboard -> http://localhost:5173
pnpm --filter @predictx/dashboard dev

# 3. settlement loop (checks every minute, runs the Chainlink CRE workflow when a pool is due)
cd apps/backend
pnpm exec tsx --tsconfig ../../scripts/tsconfig.json ../../scripts/resolver-loop.ts

# 4. build the extension for this local stack, then load it in Chrome.
#    First uncomment the two VITE_EXTENSION_* lines in .env, otherwise the build targets the deployed app.
#    (`pnpm demo` does this for its own build.)
pnpm --filter @predictx/extension build
```

Chrome: `chrome://extensions`, Developer mode on, **Load unpacked**, pick `apps/extension/dist`. After every rebuild press the extension's reload icon and refresh x.com.

Quick checks before you start:

```sh
cd apps/backend
# is the settlement path wired? (runs the real cre CLI once even if nothing is due; expect your login/key to be accepted)
pnpm exec tsx --tsconfig ../../scripts/tsconfig.json ../../scripts/resolver-loop.ts --once --force
# after building the extension and dashboard: no key names or secret values in what ships
pnpm exec tsx --tsconfig ../../scripts/tsconfig.json ../../scripts/check-bundles.ts
# every backend endpoint through the typed client the apps use (backend must be running)
pnpm --filter @predictx/ui test:live
```

## 2. Prove the money path first (no browser)

With the backend and the resolver loop running:

```sh
cd apps/backend
pnpm exec tsx --tsconfig ../../scripts/tsconfig.json ../../scripts/e2e-lifecycle.ts --scenario yes    # about 5 min
pnpm exec tsx --tsconfig ../../scripts/tsconfig.json ../../scripts/e2e-lifecycle.ts --scenario no
pnpm exec tsx --tsconfig ../../scripts/tsconfig.json ../../scripts/e2e-lifecycle.ts --scenario void
```

Each prints `ok:` lines and a final `DONE` with transaction hashes. Any `CHECK FAILED` is a real bug.

## 3. Walk through it on x.com (two MetaMask accounts)

1. Open `http://localhost:5173/faucet`, connect account A, switch to Base Sepolia, press **Get 100 USDC**. Repeat with account B.
2. On x.com find or write a post containing `$ETH`. The tag is underlined. Hover it for a moment: the card shows the live price, address and chain.
   - The card shows price, 24h change, market cap, liquidity, 24h volume and a 24h chart you can scrub. **View details** opens the AI tab; **Swap** opens the Swap tab (disabled for tokens Flash cannot trade, such as PEPE).
   - **AI**: press *Get insight* (real AI tip; "Use suggested limit" moves it to Swap).
   - **Swap**: connect, choose Market or Limit, type 2 and press *Get quote*. You see a Flash quote with spend, receive, network cost, minimum received, slippage and expiry, the token address and chain, and a disabled *Place order* with "Testnet-only build: orders are not sent." Tradable: ETH, BTC (cbBTC), DEGEN, BRETT. Field mapping: docs/DEFINITIVE.md section 4.
3. Press the **PredictX** pill (bottom right), choose a token, Above, a strike, 3 min. The preview is the exact onchain question. Connect, press **Create prediction**, confirm in MetaMask.
4. Press **Post to X**. The composer opens with the text; press Post. The post now shows the bet box (the `PX#id` marker triggers it).
5. In the bet box, as account A enter 5 and press **Bet YES** (MetaMask asks to approve exactly 5 USDC, then to bet). Switch MetaMask to account B and bet **NO**. The odds bar updates within seconds.
6. Wait for the close time plus up to a minute. The resolver loop prints the Chainlink run. The box changes to **Result: YES/NO**, "Settled by Chainlink CRE (simulation)", and the price at close.
7. The winner presses **Claim**. Check the amount: for a $60/$40 pool with a $30 YES stake the payout is $49.00 (2% fee).

Also open `http://localhost:5173/` (all pools) and `http://localhost:5173/pool/<id>` to see the same pool with your position.

## 4. What is real and what is not

- Real: prices, chart, market cap, volume and liquidity (CoinGecko), AI tips (OpenAI), Flash quotes, the contracts, the bets, the Chainlink workflow code, settlement transactions on Base Sepolia.
- A simulation: the Chainlink run is `cre workflow simulate --broadcast`, delivered through Chainlink's simulation forwarder (the screen says so). A fully deployed CRE workflow needs a redeployed contract and CRE deploy access.
- Not done on purpose: no Flash order is ever sent (no testnet exists for Flash).
- The "price at close" is the price when the loop ran, up to about a minute after the close.
- In a local-stack build (`VITE_EXTENSION_*` set, or after `pnpm demo`) post links use `localhost`, so other people cannot open them; the `PX#id` marker still makes the bet box appear on your own timeline. A plain `pnpm --filter @predictx/extension build` with those lines unset posts https://predictx-tawny.vercel.app links instead.

## 5. Troubleshooting

| Symptom | Check |
| --- | --- |
| No underline on `$ETH` | backend running? `curl localhost:8787/api/v1/tokens`; reload the extension and the page |
| Card says "Couldn't load ETH" | backend down, or CoinGecko rate-limited (free tier) |
| "Install MetaMask to continue." | MetaMask must be enabled for x.com; reload the page |
| Create fails with "The wallet took too long" | confirm in MetaMask within about a minute, then press Create again |
| Pool stays "Closed. Waiting for the result..." | is the resolver loop running, `cre whoami` ok, `CRE_ETH_PRIVATE_KEY` funded? |
| Backend answers on 8787 but data looks wrong | another session's proxy may hold the port (B-009); start the backend with `PORT=8791` and point `VITE_API_BASE_URL` at it, or use the LAN IP |
| Dev server unreachable from the browser | the dashboard listens on IPv4 and IPv6; try `http://127.0.0.1:5173` |
