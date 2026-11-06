# PredictX

**Trade and bet on crypto prices without leaving X (Twitter).**

PredictX is a Chrome extension for X. When a tweet mentions a coin, such as `$ETH`, you hover over it and can:

1. **See the price and buy the coin** in a small popup. The swap runs through Definitive Flash.
2. **Get a short AI tip** about the coin, with a suggested buy price. The tip comes from OpenAI and never trades for you.
3. **Start a prediction pool**, for example "Will $ETH be above $3,000 at 18:00 UTC?", and post it to X. Anyone can bet YES or NO with test USDC. When time is up, a Chainlink workflow checks the real price and settles the pool, and winners claim their share.

Built for the ETHGlobal Mumbai hackathon. Sponsor tracks: **Chainlink CRE** and **Definitive Flash**.

> **Progress:** backend, smart contracts, the Chainlink workflow, the Chrome extension and the dashboard are built. Everything runs on **Base Sepolia test funds only**; the Swap tab shows real Flash quotes but never sends an order. Step-by-step local run: **[docs/LOCAL_TEST.md](docs/LOCAL_TEST.md)**. Task status: **[docs/TRACKER.md](docs/TRACKER.md)**.

## How it fits together

```
 X (twitter.com)                         Our backend (localhost:8787)
 ┌──────────────────────┐   prices, tips  ┌─────────────────────────┐ ──> CoinGecko (prices)
 │ PredictX extension    │ ─────────────> │ Fastify API             │ ──> OpenAI (tips)
 │ hover card, swap, bet │   quotes       │ keeps all API keys      │ ──> Definitive Flash (swaps, Base mainnet)
 └──────────┬───────────┘                 └─────────────────────────┘
            │ create pool, bet, claim (wallet signs)
            v
 ┌──────────────────────────────┐   settles due pools   ┌──────────────────────────┐
 │ PredictionPool contract       │ <─────────────────── │ Chainlink CRE workflow    │
 │ Base Sepolia (test USDC)      │                       │ reads CoinGecko price     │
 └──────────────────────────────┘                       └──────────────────────────┘
 Dashboard website: pool pages, claim, faucet (same backend and contract)
```

Money rules: prediction pools use **free test funds on Base Sepolia**. Swap quotes come from Definitive Flash (Base mainnet prices); this build never submits an order (`FLASH_ORDERS_ENABLED=false`), so no mainnet funds are ever used.

## Live on Base Sepolia

| Contract | Address |
| --- | --- |
| PredictionPool | [`0x6b0f6C0f324C615Add6BfcA5EE0b8eeD66F2C0cd`](https://sepolia.basescan.org/address/0x6b0f6C0f324C615Add6BfcA5EE0b8eeD66F2C0cd) |
| MockUSDC (test USDC) | [`0x1e05373c199D764f7dE0353d58AFEa2b4C6326Ef`](https://sepolia.basescan.org/address/0x1e05373c199D764f7dE0353d58AFEa2b4C6326Ef) |

Pools resolve through the Chainlink CRE simulation forwarder `0x82300bd7c3958625581cc2f77bc6464dcecdf3e5`.

## Run it locally

You need Node 22+, pnpm 9 (`corepack enable`), Foundry for contracts, and Bun plus the `cre` CLI for the Chainlink workflow.

```bash
cp .env.example .env                        # then fill in the keys you have; everything else has safe defaults
pnpm install
pnpm typecheck && pnpm test                 # shared package + backend (no network needed)
pnpm --filter @predictx/backend start       # API on http://localhost:8787/api/v1/health
```

| Part | Test | Run |
| --- | --- | --- |
| Backend | `pnpm --filter @predictx/backend test` | see [apps/backend/README.md](apps/backend/README.md) |
| Contracts | `cd contracts && forge test` | see [contracts/README.md](contracts/README.md) |
| Chainlink workflow | `cd cre/resolve-pools && bun test` | see [cre/README.md](cre/README.md) |
| Shared UI | `pnpm --filter @predictx/ui test` | API client, wallet actions, slip states |
| Extension | `pnpm --filter @predictx/extension test` | see [apps/extension/README.md](apps/extension/README.md) |
| Settlement + money path | | `scripts/resolver-loop.ts` and `scripts/e2e-lifecycle.ts`, see [scripts/README.md](scripts/README.md) |
| Demo pools | | `scripts/seed-pools.ts` |

Keys live only in `.env`, which git ignores. Never commit it. Without an OpenAI key the tips fall back to a basic note; without a Flash key swaps run in mock mode.

## Repo layout

```
apps/backend/       Fastify API: prices, AI tips, Flash quotes, pool reads            (done)
apps/extension/     Chrome (MV3) overlay on x.com: hover card, create pool, bet box    (built)
apps/dashboard/     Pools list, pool page (bet, claim, refund), test USDC faucet       (built)
packages/shared/    Shared types, validation, helpers, contract ABI and addresses     (done)
packages/ui/        API client, wallet actions, hooks and React pieces shared by both apps
contracts/          PredictionPool and MockUSDC, Foundry                              (done, deployed)
cre/                Chainlink CRE workflow that settles pools                         (done)
scripts/            Resolver loop, end-to-end lifecycle check, seed pools, Flash Gate 0
docs/               Requirements, API contract, tracker, decisions, work log, local test guide
docs/prototype/     Earlier HTML design board, visual reference only
```

## For contributors and AI agents

The planning docs drive the build. Read them in this order:

| # | File | What it is |
| --- | --- | --- |
| 1 | [docs/TRACKER.md](docs/TRACKER.md) | Where the project stands, task by task |
| 2 | [docs/AGENT.md](docs/AGENT.md) | How an agent works in this repo: loop, scopes, stop rules |
| 3 | [docs/RULES.md](docs/RULES.md) | Hard rules. Breaking one is a bug |
| 4 | [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | What must be true, with acceptance checks |
| 5 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, chains, data flows |
| 6 | [docs/API_CONTRACT.md](docs/API_CONTRACT.md) | The only interface between frontend and backend |
| 7 | [docs/UI_REFERENCE.md](docs/UI_REFERENCE.md) | Every screen, design token and piece of copy |
| 8 | [docs/TASKS.md](docs/TASKS.md) | The task backlog with acceptance checks |
| 9 | [docs/DECISIONS.md](docs/DECISIONS.md) | Locked stack, decision log, open questions |

Keep these up to date as you work: `docs/TASKS.md` and `docs/TRACKER.md` (status), `docs/WORKLOG.md` (what happened), `docs/BLOCKERS.md` (what needs a human).

Work is split into two roles. **Agent A** builds the frontend (`apps/extension`, `apps/dashboard`). **Agent B** builds the backend, contracts and Chainlink workflow (`apps/backend`, `contracts`, `cre`, `scripts`). The two meet only at the API contract in `packages/shared`.
