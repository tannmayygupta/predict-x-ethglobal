# scripts/

Operational scripts that are not part of any package build. They run with the backend's toolchain
(`tsx`, `viem`, `zod`, `@predictx/shared`), which `scripts/tsconfig.json` maps to `apps/backend/node_modules`
because the pnpm workspace keeps no hoisted packages at the repo root.

## gate0-flash.ts (T-003, TEST_PLAN B04-31)

Places **one real Definitive Flash limit order** on Base mainnet for at most `MAX_FLASH_TRADE_USD` (5 USDC),
priced 30% below spot so it rests `open`, then polls its status five times. It uses the backend's own
`HttpFlashClient`, so what it records is exactly what the backend will see.

### Prerequisites

- A Flash API key (`FLASH_API_KEY`, starts with `dpka_`), from app.definitive.fi -> More -> Flash -> Create Flash Key.
- A Base **mainnet** wallet holding a few USDC and a little ETH for one approve transaction. Export its private
  key as `GATE0_PRIVATE_KEY`. Use a throwaway wallet; never a main one.
- `pnpm install` already done at the repo root.

### Run

```sh
cd apps/backend
pnpm exec tsx --tsconfig ../../scripts/tsconfig.json ../../scripts/gate0-flash.ts
```

Variables are read from the process environment first, then from the repo `.env`:

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `FLASH_API_KEY` | yes | | Definitive Flash key |
| `GATE0_PRIVATE_KEY` | yes | | `0x` + 64 hex, funder wallet on Base mainnet |
| `GATE0_AMOUNT_USDC` | no | `1.00` | USDC to spend; the script refuses anything above `MAX_FLASH_TRADE_USD` or equal to 0 |
| `GATE0_RPC_URL` | no | `https://mainnet.base.org` | RPC used for the allowance read and the approve tx |
| `FLASH_BASE_URL` | no | `https://flash.definitive.fi/v1` | Flash API base |

Suggested `.env` lines (never commit `.env`):

```
GATE0_PRIVATE_KEY=
GATE0_AMOUNT_USDC=1.00
GATE0_RPC_URL=https://mainnet.base.org
```

### What it does, in order

1. Refuses to run if the amount is 0 or above the cap (checked before any key is read).
2. Market quote for the same amount, read-only, to derive Flash's implied spot price.
3. Limit quote at 70% of spot through `HttpFlashClient.quote`.
4. If the quote returns `approveTx`, decodes the spender from it and sends an **exact-amount** USDC approve
   (RULES 2.6), skipping it when the allowance already suffices. Waits for the receipt.
5. Signs `steps.orderTypedData` (and the permit, if present) with `signTypedData`, stripping `EIP712Domain` from
   `types` and coercing `chainId` to a number the way Definitive's reference client does. The string sent back to
   Flash is the original, unchanged.
6. Submits once. **Never retries**: Flash can create an order and still answer 4xx (docs/notes/flash-api.md 4.3);
   a failed submit is reconciled by a human via `GET /orders?funderAddress=`.
7. Polls `GET /orders/{id}?funderAddress=` five times, 3 s apart.
8. Writes `docs/GATE0.md` (summary plus every raw request and response, redacted) and `docs/gate0/*.json`
   (the raw bodies named like `apps/backend/test/fixtures/flash/`, ready to copy over the placeholders).

The API key, the private key and every signature are redacted from the report and never printed.

### After it runs

- Copy `docs/gate0/*.json` over `apps/backend/test/fixtures/flash/*.json` (same names) and run `pnpm test`.
- Resolve the `GATE0: confirm` comments in `apps/backend/src/clients/flash.map.ts` and `flash.types.ts` against
  the recorded bodies; record the real status values in `docs/DECISIONS.md`.
- If the order was accepted (`open` or `filled`), mark T-003 done in `docs/TASKS.md`. If not, write the blocker
  `Flash gate failed` and stop all Flash tasks (TASKS.md T-003).

### Typecheck

```sh
cd apps/backend && pnpm exec tsc -p ../../scripts/tsconfig.json
```
