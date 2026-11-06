# PredictX contracts

Foundry project for `PredictionPool` (parimutuel YES/NO price pools resolved by Chainlink CRE) and
`MockUSDC` (6-decimal test USDC, public mint capped at 1,000 USDC per call). Solidity 0.8.24,
OpenZeppelin Contracts 5.4.0. The ABI is fixed by `packages/shared/src/abi.ts`. Change both together.

Requirements: `REQUIREMENTS.md` section F (FR-C-01 to FR-C-08). Every row has tests under `test/`.

## Setup

```sh
export PATH="$HOME/.foundry/bin:$PATH"
cd contracts
forge soldeer install   # restores dependencies/ from soldeer.lock (no git submodules)
```

Dependencies come from Soldeer: `foundry.toml` `[dependencies]` plus the committed `soldeer.lock`.
`dependencies/` is gitignored. `remappings.txt` maps `@openzeppelin/contracts/` and `forge-std/`.

## Build, test, coverage

```sh
forge build
forge test -vv
forge coverage --report summary
```

`test/NoAdmin.t.sol` reads `out/PredictionPool.sol/PredictionPool.json`, so run `forge build` or
`forge test` (which builds first) before running it on its own.

## Local walkthrough on Anvil

Use anvil's default dev accounts only (mnemonic `test test ... junk`). Never reuse them on a real chain.
Account 0 is deployer and treasury, account 1 is the forwarder, accounts 2 to 4 are users.

```sh
anvil --chain-id 84532 &
RPC=http://127.0.0.1:8545
MN="test test test test test test test test test test test junk"
K0=$(cast wallet private-key --mnemonic "$MN" --mnemonic-index 0)   # deployer, treasury
K1=$(cast wallet private-key --mnemonic "$MN" --mnemonic-index 1)   # forwarder
K2=$(cast wallet private-key --mnemonic "$MN" --mnemonic-index 2)   # YES staker
K3=$(cast wallet private-key --mnemonic "$MN" --mnemonic-index 3)   # NO staker
A0=$(cast wallet address $K0); A1=$(cast wallet address $K1); A2=$(cast wallet address $K2); A3=$(cast wallet address $K3)

DEPLOYER_PRIVATE_KEY=$K0 TREASURY_ADDRESS=$A0 KEYSTONE_FORWARDER_ADDRESS=$A1 \
  forge script script/Deploy.s.sol --rpc-url $RPC --broadcast
USDC=<MockUSDC from the log>; POOL=<PredictionPool from the log>

# The backend reads pools through viem multicall; anvil has no Multicall3, so copy it from Base Sepolia.
MC=0xcA11bde05977b3631167028862bE2a173976CA11
cast rpc anvil_setCode $MC "$(cast code $MC --rpc-url https://sepolia.base.org)" --rpc-url $RPC

NOW=$(cast block latest --field timestamp --rpc-url $RPC)
cast send $POOL "createPool(string,string,uint8,uint256,uint64)" "Will \$ETH be above \$3000?" ethereum 0 3000000000000000000000 $((NOW+180)) --private-key $K0 --rpc-url $RPC

for K in $K2 $K3; do
  cast send $USDC "mint(address,uint256)" $(cast wallet address $K) 30000000 --private-key $K --rpc-url $RPC
  cast send $USDC "approve(address,uint256)" $POOL 30000000 --private-key $K --rpc-url $RPC   # exact amount
done
cast send $POOL "stake(uint256,bool,uint256)" 0 true 30000000 --private-key $K2 --rpc-url $RPC
cast send $POOL "stake(uint256,bool,uint256)" 0 false 30000000 --private-key $K3 --rpc-url $RPC

cast rpc evm_increaseTime 200 --rpc-url $RPC && cast rpc evm_mine --rpc-url $RPC
cast call $POOL "getDuePoolIds(uint256)(uint256[])" 10 --rpc-url $RPC           # [0]
cast send $POOL "onReport(bytes,bytes)" 0x $(cast abi-encode "f(uint256,bool,uint256)" 0 true 3100000000000000000000) --private-key $K1 --rpc-url $RPC

cast call $USDC "balanceOf(address)(uint256)" $A2 --rpc-url $RPC              # 0
cast send $POOL "claim(uint256)" 0 --private-key $K2 --rpc-url $RPC
cast call $USDC "balanceOf(address)(uint256)" $A2 --rpc-url $RPC              # 58800000 (60 * 0.98)
cast call $USDC "balanceOf(address)(uint256)" $A0 --rpc-url $RPC              # 1200000 fee
```

Backend live pool test against the local chain (it expects one open, one awaiting and one resolved
pool relative to its fake clock, 1_761_600_000; start anvil with `--timestamp 1761598000` for that):

```sh
cd apps/backend
POOL_ADDRESS=$POOL POOL_RPC_URL=http://127.0.0.1:8545 pnpm vitest run --config vitest.live.config.ts test/live/pools.live.test.ts
```

## Deploy to Base Sepolia

Set `DEPLOYER_PRIVATE_KEY` (funded with Base Sepolia ETH), `TREASURY_ADDRESS` and
`KEYSTONE_FORWARDER_ADDRESS` in your shell, never in a committed file, then:

```sh
forge script script/Deploy.s.sol --rpc-url https://sepolia.base.org --broadcast
```

The forwarder is immutable, so pick it per deployment (Base Sepolia, from the CRE forwarder directory,
docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts, checked 2026-10-30):

| Use | Forwarder |
| --- | --- |
| `cre workflow simulate --broadcast` | MockKeystoneForwarder `0x82300bd7c3958625581cc2f77bc6464dcecdf3e5` |
| Deployed CRE workflows | KeystoneForwarder `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` |

Simulation and production need different deployments. After deploying, record both addresses in
`packages/shared/src/deployments.ts` (chain 84532) and the env example comments (T-002).

## Design notes

- `onReport` accepts only the immutable forwarder (custom error `InvalidSender`, as in Chainlink's
  `ReceiverTemplate`) and implements ERC-165 for `IReceiver` and `IERC165`, which the KeystoneForwarder
  checks before delivery. Metadata is not validated.
- No owner and no admin functions (FR-C-07, enforced by `test/NoAdmin.t.sol`).
- Lock time equals resolve time (D-006). The fee (`FEE_BPS_DEFAULT` = 200 bps, stored per pool) goes
  to the treasury on the first winning claim only. Void pools refund YES plus NO stakes with no fee.
- A pool that is never reported stays unresolved; there is no timeout refund in the MVP.
