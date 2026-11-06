# PredictX project tracker

Last updated: **2026-11-04**. Status values mirror [`TASKS.md`](TASKS.md), which holds each task's full spec and acceptance check. When a task changes, update both files in the same commit.

## Where we are

**Overall: about 38% complete** (10 of 32 tasks done, 3 in progress, 19 not started; percentages below are weighted by how much of each task is built).

| Area | Tasks | Done | Progress |
| --- | --- | --- | --- |
| Backend API, contracts, Chainlink (role B) | 13 | 10 | `█████████░` 91% |
| Chrome extension (role A) | 11 | 0 | `░░░░░░░░░░` 4% |
| Dashboard website (role A) | 3 | 0 | `░░░░░░░░░░` 0% |
| Frontend integration (role A) | 2 | 0 | `░░░░░░░░░░` 0% |
| Demo and submission (human) | 3 | 0 | `░░░░░░░░░░` 0% |

**In one line:** everything behind the scenes works on Base Sepolia (create pool, bet, Chainlink settles, winner claims). The screens people see, the extension and the dashboard, are the critical path now.

Legend: ✅ done · 🟡 in progress · ⛔ blocked on a human input · ⬜ not started. The **Assignee** column is for the team to claim tasks; put your name in when you start one.

## Backend, contracts and Chainlink (role B)

| ID | Task | Status | % | Assignee | What is left |
| --- | --- | --- | --- | --- | --- |
| T-001 | Verify monorepo scaffold | ✅ | 100 | | |
| T-002 | Contracts compile, ABI published, deployed | ✅ | 100 | | |
| T-B01 | Backend scaffold (validation, errors, CORS, rate limit, SQLite) | ✅ | 100 | | |
| T-B02 | Token list and price endpoints (CoinGecko) | ✅ | 100 | | |
| T-B03 | Flash client with mock mode | ✅ | 100 | | |
| T-B05 | AI insight endpoint (OpenAI `gpt-6-luna`) | ✅ | 100 | | Verified live |
| T-B06 | PredictionPool contract and tests | ✅ | 100 | | 49 Foundry tests, deployed |
| T-B07 | Pool read endpoints | ✅ | 100 | | Verified live on Base Sepolia |
| T-B08 | Chainlink CRE workflow | ✅ | 100 | | Resolved two pools onchain |
| T-B09 | Seed demo pools | ✅ | 100 | | Pools in every state exist |
| T-B04 | Flash swap endpoints | 🟡 | 85 | | Built and tested in mock mode. Needs a `FLASH_API_KEY` for the live quote check |
| T-B10 | Deploy backend | 🟡 | 60 | | Boot tests and guide done. Hosting deferred: the demo runs on localhost |
| T-003 | Gate 0: one real Flash order | ⛔ | 40 | | Script written. Needs a Base mainnet wallet with about 2 USDC; optional for a localhost demo |

## Chrome extension (role A)

`apps/extension` holds an older design prototype with hardcoded data. The percentages credit only the pieces that can be reused.

| ID | Task | Status | % | Assignee | Depends on |
| --- | --- | --- | --- | --- | --- |
| T-A01 | Extension scaffold and overlay mount | 🟡 | 85 | | Built; load-unpacked check on x.com pending |
| T-A02 | Mock API server from shared fixtures | dropped | - | | Decision D-T4: real backend, nothing mocked |
| T-A03 | Wallet bridge (MetaMask on x.com) | 🟡 | 85 | | Bridge + controller built and tested; hand check pending |
| T-A04 | Detect `$CASHTAG` and hover trigger | 🟡 | 80 | | Detector + hover built and tested; X page check pending |
| T-A05 | Token card (price, address, tabs) | 🟡 | 80 | | Card built against /market; browser check pending |
| T-A06 | Swap tab: market order | 🟡 | 70 | | Quote-only by design (D-T1); needs a Flash key to see real quotes |
| T-A07 | Swap tab: limit order | 🟡 | 70 | | Limit quote built; same key needed |
| T-A08 | Insight tab | 🟡 | 80 | | Insight built; real tips need an OpenAI key |
| T-A09 | Create pool panel and launcher | 🟡 | 80 | | Form + preview + createPool built; args verified against the live contract by simulation; a funded wallet run is pending |
| T-A10 | Post pool to X | 🟡 | 80 | | Post step built (x.com/intent/post) |
| T-A14 | Bet box under tweets | ⬜ | 0 | | T-A12, T-A04 |

## Dashboard website (role A)

| ID | Task | Status | % | Assignee | Depends on |
| --- | --- | --- | --- | --- | --- |
| T-A11 | Dashboard scaffold, routing, wallet | ⬜ | 0 | | T-A02, T-A03 |
| T-A12 | Pool page: bet, claim, refund | ⬜ | 0 | | T-A11, T-002 ✅ |
| T-A13 | Home page and test USDC faucet | ⬜ | 0 | | T-A12 |

## Frontend integration (role A)

| ID | Task | Status | % | Assignee | Depends on |
| --- | --- | --- | --- | --- | --- |
| T-A15 | Loading, error and empty states, copy polish | ⬜ | 0 | | T-A14, T-A08 |
| T-A16 | Switch from mock data to the real backend | ⬜ | 0 | | T-A15 (backend on localhost is enough) |

## Demo and submission (human)

| ID | Task | Status | % | Assignee | Depends on |
| --- | --- | --- | --- | --- | --- |
| T-I01 | Run the merge checklist | ⬜ | 0 | | T-A16 |
| T-I02 | Rehearse the 3-minute demo twice | ⬜ | 0 | | T-I01 |
| T-I03 | Record and post the demo | ⬜ | 0 | | T-I02 |

## Next up (critical path)

1. **T-A01 and T-A02 in parallel.** Both are unblocked and unlock every other frontend task.
2. **T-A03 wallet bridge**, then the extension screens (T-A04 to T-A10) and the dashboard (T-A11 to T-A13) can run side by side.
3. **Approve blocker B-005** in [`BLOCKERS.md`](BLOCKERS.md): the shared sample pool's question text does not match its own time. Fixing it keeps the extension preview and the backend in agreement.
4. **Choose the Flash level for the demo:** mock only, live quotes (free key), or one real 1 USDC order (funded mainnet wallet).

## Waiting on a human

| Item | Unblocks | Cost |
| --- | --- | --- |
| Flash API key (app.definitive.fi → More → Flash → Create Flash Key) | T-B04 live quotes | Free |
| Base mainnet wallet with about 2 USDC and a little ETH | T-003 real order | A few dollars, optional |
| Railway or Render account | T-B10 hosting | Free tier, optional |
| Decision on blocker B-005 | Consistent pool previews | None |

## Proof it works (Base Sepolia)

| What | Link |
| --- | --- |
| PredictionPool deployed | [`0x6b0f…F2C0cd`](https://sepolia.basescan.org/address/0x6b0f6C0f324C615Add6BfcA5EE0b8eeD66F2C0cd) |
| MockUSDC deployed | [`0x1e05…6326Ef`](https://sepolia.basescan.org/address/0x1e05373c199D764f7dE0353d58AFEa2b4C6326Ef) |
| Chainlink settles pool 0: ETH 2,238.21 USD, NO wins | [tx](https://sepolia.basescan.org/tx/0xae225bc0204c3ed173bfb9b5822762b64e3e14b39ae0c28697dd65d56ce9dcea) |
| Chainlink settles pool 1: BTC 77,188.56 USD, YES wins | [tx](https://sepolia.basescan.org/tx/0x6081de27b47975572a167ecb54050f2f5aadb439be8131a618d9a049ff1608f1) |
| Winner claims 98 USDC from pool 0 | [tx](https://sepolia.basescan.org/tx/0xa154d06ea687fd23475e8f7384638b0077a5091e195a0d24b016156031d79ae4) |
| Winner claims 49 USDC from pool 1 | [tx](https://sepolia.basescan.org/tx/0xb2493412a02820b9aca3f4a1dde85b15d0409f1e81db4da7bf9b331663f99524) |

## Test health

| Suite | Command | Result |
| --- | --- | --- |
| Shared package | `pnpm --filter @predictx/shared test` | 7 passing |
| Backend | `pnpm --filter @predictx/backend test` | 473 passing, 98.8% line coverage |
| Backend live checks | `pnpm --filter @predictx/backend test:live` | OpenAI and Base Sepolia pass; Flash skipped until a key is added |
| Contracts | `cd contracts && forge test` | 49 passing, 100% line coverage on PredictionPool |
| Chainlink workflow | `cd cre/resolve-pools && bun test` | 37 passing |
