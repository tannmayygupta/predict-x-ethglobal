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
