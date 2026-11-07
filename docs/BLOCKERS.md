# BLOCKERS

Things only a human can resolve. Add an entry, then move to the next unblocked task. Never guess your way past a blocker.

Format:

```
## B-001 <short title>  (<role>, <task id>, <date>)
Blocked on: <what is missing: key, decision, access, unclear spec>
Tried: <what you checked>
Needs from human: <one specific question or action>
Safe to continue with: <other task ids, or "nothing">
Status: open | resolved (<answer>)
```

## Open

## B-007 Vercel production secrets are empty  (B, deploy, 2026-11-07)
Blocked on: `OPENAI_API_KEY`, `FLASH_API_KEY` and `COINGECKO_API_KEY` pull as empty from the Vercel project. The deployed backend therefore serves `q_mock_` quotes (MOCK badge), a degraded AI note, and keyless CoinGecko calls that hit 429 quickly.
Tried: pulled the project environment; the three variables came back empty. Secrets are not readable by an agent and must not be pasted into chat or files.
Needs from human: re-add the three secrets in the Vercel project settings (Production), then redeploy. Also set `FLASH_MOCK=false` and keep `FLASH_ORDERS_ENABLED=false`.
Safe to continue with: everything local (the local `.env` is separate).
Status: open

## B-008 Flash search access  (B, docs/DEFINITIVE.md, 2026-11-07)
Blocked on: Flash `GET /search` answers 403 `SEARCH_NOT_ELIGIBLE` for our key. `GET /balances` works (mainnet only).
Tried: live probe on 2026-11-07. Liquidity was moved to CoinGecko onchain (D-T12), so nothing in the product is waiting on this.
Needs from human: ask Definitive to enable search for our key, only if Flash-side liquidity or token discovery is wanted later.
Safe to continue with: everything.
Status: open

## B-009 Port 8787 can be shadowed by another session's proxy  (A+B, 2026-11-07)
Blocked on: a second local session left a proxy listening on port 8787 on this machine, so `localhost:8787` may not reach our backend. Results seen on that port (old data, a different shape) are not ours.
Tried: started our own backend on another port (`PORT=8791`) for live checks and stopped only that process.
Needs from human: stop the other proxy, or verify through the machine's LAN IP or another port (set `PORT`, and `VITE_API_BASE_URL` and the extension build to match). An agent must not kill a process it did not start.
Safe to continue with: everything that does not need port 8787.
Status: open

## B-006 Chainlink CRE login and funded test keys  (B, M1/M9, 2026-11-06)
Blocked on: the `cre` CLI (v1.39.0, installed and signature-verified) refuses every command, including a dry-run simulation, with "not logged in and no CRE_API_KEY set". Login is interactive (browser) and belongs to the human's Chainlink account. Also empty in `.env`: `CRE_ETH_PRIVATE_KEY`, `TEST_WALLET_A_PRIVATE_KEY`, `TEST_WALLET_B_PRIVATE_KEY` (Base Sepolia test ETH), and the OpenAI and Flash keys.
Tried: `cre whoami`, `cre workflow simulate ... ` (dry run), `scripts/resolver-loop.ts --once --force` (finds and runs cre.exe, reports the login error).
Needs from human: run `cre login` (in Claude Code type `! cre login`) or create a `CRE_API_KEY`; fill the keys listed in docs/LOCAL_TEST.md section 0.
Safe to continue with: everything that does not settle or spend: unit and render tests, builds, `ui test:live`.
Status: open

## B-001 Foundry and funded Base Sepolia deployer  (B, T-002, 2026-10-29)  RESOLVED 2026-10-31
Blocked on: (Foundry 1.8.7 installed 2026-10-30, resolved) `DEPLOYER_PRIVATE_KEY` with Base Sepolia ETH missing (`.env.example` has no such variable yet; contract addresses are 0x0).
Tried: `which forge` -> not found; checked .env.example and contracts/ (only .gitkeep).
Needs from human: install Foundry, provide a funded Sepolia deployer key plus two funded test wallets for T-B09, and add DEPLOYER_PRIVATE_KEY, KEYSTONE_FORWARDER_ADDRESS, TREASURY_ADDRESS to .env.example.
Safe to continue with: contract authoring and `forge test` locally once Foundry exists; T-B01, T-B02, T-B03, T-B05 (degraded path), T-A01, T-A02.
Status: open

## B-002 Flash API key and funded mainnet wallet  (B, T-003, 2026-10-29)
Blocked on: `FLASH_API_KEY` empty; no Base mainnet wallet with >= $5 USDC and ETH for gas; Flash order status values undecided (DECISIONS open item).
Tried: checked .env.example, scripts/ (only .gitkeep), docs/ (no GATE0.md).
Needs from human: the key, the wallet, and confirmation whether a Definitive testnet sandbox exists.
Safe to continue with: T-B03 in FLASH_MOCK=true mode.
Status: open

## B-003 Chainlink CRE access  (B, T-B08, 2026-10-29)  RESOLVED 2026-10-31: CLI v1.39.0 + Bun 1.4.4 installed, logged in; `cre workflow simulate --broadcast` does broadcast through the MockKeystoneForwarder (pools 0 and 1 resolved)
Blocked on: `cre` CLI not installed; CRE account access; CRE_POOL_CHAIN_SELECTOR for Base Sepolia; KeystoneForwarder address; whether `cre workflow simulate` can broadcast.
Tried: `which cre` -> not found.
Needs from human: CRE CLI install and account, plus answers to the four questions above.
Safe to continue with: everything not depending on T-B08.
Status: open

## B-004 Remaining service keys and hosting  (B/A, T-B02 T-B05 T-B10 T-A11, 2026-10-29)
Blocked on: OPENAI_API_KEY and OPENAI_MODEL choice (an agent must not pick the model per DECISIONS), COINGECKO_API_KEY (also as a CRE secret), Railway/Render account for the backend, Vercel domain for the dashboard (VITE_DASHBOARD_URL / DASHBOARD_URL / ALLOWED_ORIGINS).
Tried: .env.example has these variables empty or missing (DASHBOARD_URL, BASESCAN_API_KEY absent).
Needs from human: the keys and the two hosting targets. Also decide `x.com/intent/tweet` vs `intent/post` for T-A10.
Safe to continue with: all mock-mode tasks; CoinGecko free tier works without a key for development.
Status: open

## B-005 CONTRACT CHANGE: shared pool fixtures disagree with the helpers  (B, T-B07, 2026-10-29)  RESOLVED 2026-11-06: approved; fixture strike is "0.000012" and the question is rebuilt for resolveTime 1761602400, with a shared test asserting buildQuestion(fixture) === fixture.question
Blocked on: packages/shared/src/fixtures.ts poolOpen/poolResolved use strikeUsd "0.0000120" and question "...at 14:30 UTC on 28 Oct?" while fromE18 canonicalises the strike to "0.000012" and resolveTime 1761602400 is 22:00 UTC on 27 Oct, so buildQuestion(fixture) !== fixture.question (FR-P-01).
Tried: backend maps strikeUsd with fromE18 and builds its own consistent seeds; the frontend mock server serves the fixtures as-is, so the two sides will disagree on the preview.
Needs from human: approve one commit that fixes the fixture (strike "0.000012", question rebuilt with buildQuestion for resolveTime 1761602400) and its test, per AGENT.md section 6. The frontend must canonicalise the strike (toStrikeE18 then fromE18) before calling buildQuestion.
Safe to continue with: everything.
Status: open

## B-006 CONTRACT CHANGE: market stats, chart endpoint, quote factors, insight spot/asOf  (shared, 2026-11-07)
Old shape: `Market` had 7 fields (symbol, name, address, flashChainId, priceUsd, change24hPct, updatedAt); no chart endpoint; `FlashQuoteRequest` had no expiry; `FlashQuoteResponse` carried only spend, receive, feesUsd and estimatedPriceImpact; `InsightResponse` had no spot or age; `Token` had no network; BTC, DEGEN and BRETT were `flashSupported: false`.
New shape (all additive; new response keys are `.nullable().default(null)`, booleans `.default(false)`, so stored rows and old clients still parse; the backend must always emit them):
- `SignedDecimalString`. `Token`: optional `network`, optional nullable `onchain {network, address}`.
- `Market`: `change24hUsd` (signed), `marketCapUsd`, `volume24hUsd`, `high24hUsd`, `low24hUsd`, `liquidityUsd`, `verified`.
- `GET /market/:symbol/chart?range=24h|7d` returning `MarketChart` (`ChartRange`, `ChartPoint`, max `MAX_CHART_POINTS` = 300).
- `FlashQuoteRequest.expireAt` (limit only), slippage must satisfy 0 < x <= 1; constants `MIN_LIMIT_EXPIRY_SECONDS` 60, `MAX_LIMIT_EXPIRY_SECONDS` 2592000.
- `FlashQuoteResponse`: `recommendedSlippage`, `slippage`, `spendUsd`, `receiveUsd`, `minReceive`, `effectivePriceUsd`, `marketPriceUsd`, `limitPriceUsd`, `orderDeadline`.
- `InsightResponse`: `spotUsd`, `asOf` (filled by the service, never by the model).
- `tokens.json`: BTC (cbBTC, 8 decimals), DEGEN and BRETT become Flash-supported on Base (probes returned 200 quotes); PEPE stays unsupported.
Why: the hover card needs stats and a 24h chart, the swap tab needs honest quote factors (real cost, minimum received, expiry), and the AI limit suggestion must show the spot it was measured against.
Status: resolved (requested and approved by the human on 2026-11-07). Note: this entry shares the number B-006 with the open CRE login blocker above; this one is the contract change.
