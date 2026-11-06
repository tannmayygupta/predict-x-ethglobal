# PredictX CRE resolver

Chainlink CRE workflow (TypeScript SDK) that resolves due PredictionPool pools on Base Sepolia
(task T-B08, requirements FR-R-01..05 in `docs/REQUIREMENTS.md` section G).

Each cron run:

1. reads `getDuePoolIds(maxPools)` and then `getPool(id)` from the pool contract with the EVM client (latest block);
2. fetches `GET {coingeckoBaseUrl}/simple/price?ids=<coingeckoId>&vs_currencies=usd&precision=full`
   with the HTTP client and median consensus over `priceE18` (bigint);
3. converts the exact JSON number literal to `priceE18` with bigint arithmetic (exponent notation
   such as `4.89e-06` handled, digits past 18 decimals truncated);
4. decides `outcomeYes = above ? price >= strike : price <= strike`;
5. encodes `abi.encode(uint256 poolId, bool outcomeYes, uint256 priceE18)` and calls `writeReport`
   to the pool through the forwarder.

A pool whose price fetch fails (HTTP error, transport error, unknown coin id, unparsable or
non-positive price) is skipped this run and stays unresolved; the other pools continue (FR-R-05).
A write whose transaction or `onReport` reverts is logged as failed.

## Layout

```
cre/
  project.yaml            RPC per target (Base Sepolia: ethereum-testnet-sepolia-base-1)
  secrets.yaml            secret id COINGECKO_API_KEY -> env var CRE_COINGECKO_API_KEY
  .env.example            variable names only; real values go in cre/.env (gitignored) or the shell
  resolve-pools/
    main.ts               entry: cron trigger -> onCronTrigger
    workflow.yaml         targets staging-settings / production-settings
    config.*.json         schedule, chainSelectorName, poolAddress, maxPools, gasLimit, coingeckoBaseUrl
    src/workflow.ts       capability wiring (EVM read, HTTP + median, report, writeReport)
    src/price.ts          decimal string <-> E18 bigint
    src/outcome.ts        outcome rule
    src/report.ts         report ABI encoding
    src/coingecko.ts      URL/request building and response parsing
    test/*.test.ts        bun tests; workflow.test.ts uses the SDK's EvmMock/HttpActionsMock
```

The ABI comes from `packages/shared/src/abi.ts` (imported directly, single source of truth).

## Install and test

Requires Bun >= 1.2.21 and the CRE CLI (`cre whoami` must work).

```bash
cd cre/resolve-pools
bun install
bun test          # unit + mocked workflow tests
bun run typecheck
```

## Simulate

Run from `cre/`. The CLI needs `CRE_ETH_PRIVATE_KEY` (64 hex chars, no `0x`) and, because
`secrets.yaml` declares it, `CRE_COINGECKO_API_KEY` must exist (empty = keyless). Provide both
in `cre/.env` (gitignored, copy from `.env.example`) or export them in the shell.

```bash
cd cre
# dry run: reads chain and CoinGecko, prepares the writes, sends nothing
cre workflow simulate resolve-pools --target staging-settings --non-interactive --trigger-index 0

# broadcast: really sends one forwarder transaction per due pool (needs Base Sepolia ETH)
cre workflow simulate resolve-pools --target staging-settings --non-interactive --trigger-index 0 --broadcast
```

The deployed PredictionPool's forwarder is the CRE simulation MockKeystoneForwarder
`0x82300bd7c3958625581cc2f77bc6464dcecdf3e5`, so only `simulate --broadcast` can resolve it. A
deployed workflow would deliver through the KeystoneForwarder `0xF8344CFd5c43616a4366C34E3EEE75af79a74482`
and needs a PredictionPool deployed with that forwarder (the forwarder is immutable).

Verify afterwards:

```bash
P=0x6b0f6C0f324C615Add6BfcA5EE0b8eeD66F2C0cd R=https://sepolia.base.org
cast call $P "getDuePoolIds(uint256)(uint256[])" 10 --rpc-url $R
cast call $P "getPool(uint256)((string,string,uint8,uint256,uint64,uint64,uint256,uint256,bool,bool,uint256,uint16,address))" 0 --rpc-url $R
```
