/** Example responses. Part A's mock server serves exactly these. Part B must keep them valid. */
import type { FlashOrderDetail, FlashQuoteResponse, InsightResponse, Market, MarketChart, Pool, Position } from "./schemas";

const WALLET = "0x1111111111111111111111111111111111111111";
const POOL = "0x2222222222222222222222222222222222222222";

export const marketEth: Market = {
  symbol: "ETH",
  name: "Ethereum",
  address: "0x4200000000000000000000000000000000000006",
  flashChainId: 8453,
  priceUsd: "2451.12",
  change24hPct: -1.8,
  updatedAt: 1761600000,
  change24hUsd: "-44.93",
  marketCapUsd: "295820000000",
  volume24hUsd: "11580000000",
  high24hUsd: "2503.40",
  low24hUsd: "2431.07",
  liquidityUsd: "138690000",
  verified: true,
};

/** 24h chart: a short, valid series (the real one has up to 96 points). */
export const marketChartEth: MarketChart = {
  symbol: "ETH",
  range: "24h",
  points: [
    [1761513600, "2496.05"],
    [1761535200, "2478.31"],
    [1761556800, "2441.90"],
    [1761578400, "2462.77"],
    [1761600000, "2451.12"],
  ],
  openUsd: "2496.05",
  lowUsd: "2431.07",
  highUsd: "2503.4",
  updatedAt: 1761600000,
};

export const insightEth: InsightResponse = {
  symbol: "ETH",
  tip: "ETH is down 1.8% today. A limit buy a few percent below spot avoids chasing the move.",
  bias: "neutral",
  confidence: "low",
  suggestedLimit: { side: "buy", priceUsd: "2380.00", reason: "About 3% below spot" },
  degraded: false,
  disclaimer: "Not financial advice.",
  spotUsd: "2451.12",
  asOf: 1761600000,
};

export const quoteEthMarket: FlashQuoteResponse = {
  quoteId: "q_123",
  expiresAt: 1761600060,
  orderType: "market",
  side: "buy",
  chain: "base",
  chainId: 8453,
  spend: { symbol: "USDC", amount: "2.00" },
  receive: { symbol: "ETH", amount: "0.000816" },
  feesUsd: "0.01",
  estimatedPriceImpact: "0.0004",
  recommendedSlippage: "0.15",
  slippage: "0.01",
  spendUsd: "2.00",
  receiveUsd: "1.96",
  minReceive: "0.000807",
  effectivePriceUsd: "2450.98",
  marketPriceUsd: "2401.96",
  limitPriceUsd: null,
  orderDeadline: 1761600300,
  steps: {
    approveTx: { to: "0x3333333333333333333333333333333333333333", data: "0x095ea7b3" },
    permitTypedData: null,
    orderTypedData: "{\"types\":{},\"domain\":{},\"primaryType\":\"Order\",\"message\":{}}",
  },
};

/** A limit order below market: no slippage, no market price, good till cancelled. */
export const quoteEthLimit: FlashQuoteResponse = {
  ...quoteEthMarket,
  quoteId: "q_124",
  orderType: "limit",
  receive: { symbol: "ETH", amount: "0.000840" },
  recommendedSlippage: null,
  slippage: null,
  receiveUsd: "2.00",
  minReceive: "0.000840",
  effectivePriceUsd: "2380.95",
  marketPriceUsd: null,
  limitPriceUsd: "2380.00",
  orderDeadline: null,
};

export const orderFilled: FlashOrderDetail = {
  orderId: "o_456",
  status: "filled",
  orderType: "market",
  txHash: "0x4444444444444444444444444444444444444444444444444444444444444444",
  chainId: 8453,
  filledAmount: "0.000816",
  error: null,
  updatedAt: 1761600030,
};

export const poolOpen: Pool = {
  id: 12,
  chainId: 84532,
  contract: POOL,
  question: "Will $PEPE be above $0.000012 at 22:00 UTC on 27 Oct?",
  symbol: "PEPE",
  coingeckoId: "pepe",
  direction: "above",
  strikeUsd: "0.000012",
  resolveTime: 1761602400,
  createdAt: 1761588000,
  yesTotal: "60000000",
  noTotal: "40000000",
  status: "open",
  outcome: null,
  resolvedPriceUsd: null,
  feeBps: 200,
  creator: WALLET,
  dashboardUrl: "https://predictx.app/pool/12",
};

export const poolResolved: Pool = {
  ...poolOpen,
  id: 11,
  status: "resolved",
  outcome: "yes",
  resolvedPriceUsd: "0.0000131",
  dashboardUrl: "https://predictx.app/pool/11",
};

export const positionWinner: Position = {
  poolId: 11,
  address: WALLET,
  yesStake: "30000000",
  noStake: "0",
  claimable: "49000000",
  claimed: false,
  refundable: "0",
};
