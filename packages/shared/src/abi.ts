/**
 * ABI of the contracts the frontend writes to and the backend reads (T-B07 defines, T-B06 implements).
 * `as const` so viem infers argument and return types. Field order and types are part of the
 * contract between the backend's PoolReader and the Solidity struct; change both together.
 *
 * Integer widths matter for viem's decoding: uint8/uint16 decode to number, uint64/uint256 to bigint.
 */

const POOL_STRUCT = [
  { name: "question", type: "string" },
  { name: "coingeckoId", type: "string" },
  { name: "direction", type: "uint8" }, // 0 above, 1 below (API_CONTRACT section 4)
  { name: "strikeE18", type: "uint256" },
  { name: "resolveTime", type: "uint64" },
  { name: "createdAt", type: "uint64" },
  { name: "yesTotal", type: "uint256" },
  { name: "noTotal", type: "uint256" },
  { name: "resolved", type: "bool" },
  { name: "outcomeYes", type: "bool" },
  { name: "resolvedPriceE18", type: "uint256" },
  { name: "feeBps", type: "uint16" },
  { name: "creator", type: "address" },
] as const;

export const predictionPoolAbi = [
  /* ---------- writes ---------- */
  {
    type: "function",
    name: "createPool",
    stateMutability: "nonpayable",
    inputs: [
      { name: "question", type: "string" },
      { name: "coingeckoId", type: "string" },
      { name: "direction", type: "uint8" },
      { name: "strikeE18", type: "uint256" },
      { name: "resolveTime", type: "uint64" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "stake",
    stateMutability: "nonpayable",
    inputs: [
      { name: "poolId", type: "uint256" },
      { name: "isYes", type: "bool" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "poolId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "refund",
    stateMutability: "nonpayable",
    inputs: [{ name: "poolId", type: "uint256" }],
    outputs: [],
  },
  /** Chainlink CRE IReceiver: the KeystoneForwarder calls this; report = abi.encode(poolId, outcomeYes, priceE18). */
  {
    type: "function",
    name: "onReport",
    stateMutability: "nonpayable",
    inputs: [
      { name: "metadata", type: "bytes" },
      { name: "report", type: "bytes" },
    ],
    outputs: [],
  },
  /* ---------- views (FR-C-08) ---------- */
  {
    type: "function",
    name: "poolCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "count", type: "uint256" }],
  },
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "pool", type: "tuple", components: POOL_STRUCT }],
  },
  {
    type: "function",
    name: "getPosition",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [
      { name: "yesStake", type: "uint256" },
      { name: "noStake", type: "uint256" },
      { name: "claimed", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "getDuePoolIds",
    stateMutability: "view",
    inputs: [{ name: "max", type: "uint256" }],
    outputs: [{ name: "ids", type: "uint256[]" }],
  },
  /* ---------- events ---------- */
  {
    type: "event",
    name: "PoolCreated",
    anonymous: false,
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "question", type: "string", indexed: false },
      { name: "coingeckoId", type: "string", indexed: false },
      { name: "direction", type: "uint8", indexed: false },
      { name: "strikeE18", type: "uint256", indexed: false },
      { name: "resolveTime", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Staked",
    anonymous: false,
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "isYes", type: "bool", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Resolved",
    anonymous: false,
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "outcomeYes", type: "bool", indexed: false },
      { name: "priceE18", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Claimed",
    anonymous: false,
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Refunded",
    anonymous: false,
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  /* ---------- custom errors (so a revert reason can be decoded; mirrors PredictionPool.sol) ---------- */
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "PoolNotFound", inputs: [{ name: "id", type: "uint256" }] },
  { type: "error", name: "ResolveTimeTooSoon", inputs: [{ name: "resolveTime", type: "uint64" }] },
  { type: "error", name: "QuestionTooLong", inputs: [{ name: "length", type: "uint256" }] },
  { type: "error", name: "InvalidDirection", inputs: [{ name: "direction", type: "uint8" }] },
  { type: "error", name: "ZeroAmount", inputs: [] },
  { type: "error", name: "StakingClosed", inputs: [{ name: "id", type: "uint256" }] },
  {
    type: "error",
    name: "InvalidSender",
    inputs: [
      { name: "sender", type: "address" },
      { name: "expected", type: "address" },
    ],
  },
  { type: "error", name: "AlreadyResolved", inputs: [{ name: "id", type: "uint256" }] },
  { type: "error", name: "TooEarly", inputs: [{ name: "id", type: "uint256" }] },
  { type: "error", name: "NotResolved", inputs: [{ name: "id", type: "uint256" }] },
  { type: "error", name: "PoolIsVoid", inputs: [{ name: "id", type: "uint256" }] },
  { type: "error", name: "PoolNotVoid", inputs: [{ name: "id", type: "uint256" }] },
  {
    type: "error",
    name: "NothingToClaim",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "user", type: "address" },
    ],
  },
  {
    type: "error",
    name: "AlreadyClaimed",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "user", type: "address" },
    ],
  },
] as const;

/** MockUSDC on Base Sepolia: the ERC-20 subset the faucet and the stake flow use (API_CONTRACT section 4). */
export const mockUsdcAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "ok", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "remaining", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "error",
    name: "MintCapExceeded",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "max", type: "uint256" },
    ],
  },
] as const;
