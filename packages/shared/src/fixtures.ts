/** Example responses. Part A's mock server serves exactly these. Part B must keep them valid. */
import type { FlashOrderDetail, FlashQuoteResponse, InsightResponse, Market, Pool, Position } from "./schemas";

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
};

export const insightEth: InsightResponse = {
  symbol: "ETH",
  tip: "ETH is down 1.8% today. A limit buy a few percent below spot avoids chasing the move.",
  bias: "neutral",
  confidence: "low",
  suggestedLimit: { side: "buy", priceUsd: "2380.00", reason: "About 3% below spot" },
  degraded: false,
  disclaimer: "Not financial advice.",
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
  steps: {
    approveTx: { to: "0x3333333333333333333333333333333333333333", data: "0x095ea7b3" },
    permitTypedData: null,
    orderTypedData: "{\"types\":{},\"domain\":{},\"primaryType\":\"Order\",\"message\":{}}",
  },
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
  question: "Will $PEPE be above $0.0000120 at 14:30 UTC on 28 Oct?",
  symbol: "PEPE",
  coingeckoId: "pepe",
  direction: "above",
  strikeUsd: "0.0000120",
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
