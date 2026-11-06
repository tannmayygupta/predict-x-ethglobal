# Demo guide (3 minutes)

Everything runs on Base Sepolia with test funds. Nothing touches mainnet.

## Start it

```sh
pnpm install          # first time only
pnpm demo             # builds the extension, then runs backend + dashboard + settlement loop
```

`pnpm demo` prints the addresses when it is ready. Stop it with Ctrl+C.

Load the extension once: `chrome://extensions`, Developer mode on, **Load unpacked**, pick `apps/extension/dist`. After a rebuild press the extension's reload icon and refresh x.com.

Before you go on stage:

| Check | How |
| --- | --- |
| MetaMask has two accounts on Base Sepolia, each with a little ETH for gas | any Base Sepolia faucet |
| Both accounts hold test USDC | dashboard `/faucet`, **Get 100 USDC** (once per account) |
| Pools exist | `cd apps/backend && pnpm exec tsx --tsconfig ../../scripts/tsconfig.json ../../scripts/seed-pools.ts` |
| `cre whoami` answers | run `cre login` once if not |

## What is real and what is not

| Part | Status |
| --- | --- |
| Pools, bets, payouts | Real contracts on Base Sepolia, test USDC |
| Settlement | Chainlink CRE workflow run through the **CRE simulator** with the official CLI (not deployed on Chainlink's network; the account has no deploy access). The resolver loop runs it every minute and delivers the report on-chain |
| Prices | CoinGecko, one source |
| AI insight | OpenAI through the backend; falls back to a basic note if the key or model fails |
| Swap | Flash quotes only. With `FLASH_MOCK=true` the quote is fake and carries a visible MOCK badge. Orders are always off (`FLASH_ORDERS_ENABLED=false`) |

## The 3-minute walkthrough

1. **Landing page** (`localhost:5173`, 20 s). Read the headline: a take on X becomes a bet, settled by price. Click **Open dashboard**.
2. **Pools** (20 s). Open an open pool: odds bar, countdown, the bet slip. Point at "Settled by Chainlink CRE (simulation)".
3. **Predict** (45 s). Sidebar, **Predict**. Pick ETH, Above, a strike near the current price, **3 min**. Connect wallet, **Create prediction**, confirm in MetaMask. Press **Post to X**: a draft opens on X with the question and link. Post it.
4. **Extension on X** (45 s). Press the **PredictX** button (bottom right). Walk the nav: **AI** (press Get insight), **Swap** (Get quote, note the MOCK badge and the disabled Place order), **Predict**. Use the toggle in the header to switch **Popup**, **Slide-up** and **Side panel**. Hover a `$ETH` cashtag in a post for the card.
5. **Bet under the post** (30 s). Under your posted tweet the bet box appears. Switch MetaMask to account 2, press **Bet NO** (exact-amount approval first, then the bet).
6. **Settlement** (the 3-minute pool closes). In the terminal the `[resolver]` lines show the CRE simulation run and `resolved 1 of 1`. Refresh the pool: Result, then **Claim** for the winner.
7. **Playground** (optional, 20 s). Sidebar, **Playground**: **Run all checks**, send `GET /pools`, open the request log.

## If something goes wrong

| Symptom | Fix |
| --- | --- |
| Panel says "Connecting to the PredictX server..." | the backend is not up: look at the `[backend]` lines |
| Cashtags are not underlined on X | the extension was not reloaded after a build, or the backend has not answered `/tokens` yet |
| Pool stays "Awaiting result" | the resolver is not running or `cre whoami` fails: check the `[resolver]` lines |
| MetaMask refuses to bet | wrong network (use the Switch button) or no test USDC (use the Faucet) |
| Insight shows the basic note | OpenAI key or `OPENAI_MODEL` is wrong; the rest still works |
