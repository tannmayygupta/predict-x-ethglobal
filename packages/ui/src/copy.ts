/**
 * The copy deck (UI_REFERENCE section 5): exact strings, used everywhere, never reworded. Entries marked NEW
 * are not in the written deck; they were needed by the testnet-only build and are listed in docs/WORKLOG.md.
 */
export const COPY = {
  get_quote: "Get quote",
  approve_place: "Approve and place order",
  place_order: "Place order",
  switch_base: "Switch to Base",
  switch_base_sepolia: "Switch to Base Sepolia",
  waiting_wallet: "Waiting for wallet...",
  confirm_wallet: "Confirm in your wallet.",
  quote_expired: "Quote expired. Get a new quote.",
  amount_too_high: "The most you can trade is $5.00.",
  no_wallet: "Install MetaMask to continue.",
  insight_cta: "Get insight",
  insight_loading: "Reading the market...",
  insight_degraded: "Live insight unavailable. Showing a basic note.",
  use_limit: "Use suggested limit",
  disclaimer: "Not financial advice.",
  create_cta: "Create prediction",
  creating: "Creating...",
  created: "Prediction created",
  post_to_x: "Post to X",
  bet_yes: "Bet YES",
  bet_no: "Bet NO",
  closed_waiting: "Closed. Waiting for the result...",
  result_yes: "Result: YES",
  result_no: "Result: NO",
  void_note: "No one took the other side. Everyone gets a refund.",
  need_usdc: "You need test USDC.",
  get_test_usdc: "Get test USDC",
  pool_not_found: "Pool not found.",
  empty_pools: "No predictions yet. Create one from X with the PredictX button.",
  mock_badge: "MOCK",
  price_delayed: "Price delayed",
  chart_delayed: "Chart delayed",
  order_expired: "expired",
  /* NEW: market card */
  view_details: "View details",
  swap: "Swap",
  verified: "Verified",
  verified_hint: "On the PredictX allowlist, tradable on Flash",
  market_cap: "Market cap",
  liquidity: "Liquidity",
  volume_24h: "24h volume",
  predict_this_price: "Predict this price",
  copy_address: "Copy contract address",
  copied: "Address copied",
  copy_failed: "Could not copy",
  view_basescan: "View on BaseScan",
  open_dashboard: "Open dashboard",
  no_chart_data: "No chart data",
  chart_error: "Couldn't load the chart.",
  swap_unavailable: "Swap unavailable for this token",
  /* NEW: swap */
  market_price_label: "Market price",
  limit_below_market: "below market",
  limit_above_market: "At or above market: this order would fill at once",
  get_new_quote: "Get new quote",
  you_spend: "You spend",
  you_get: "You get (about)",
  rate: "Rate",
  effective_vs_market: "Effective price vs market",
  network_cost: "Network cost",
  network_cost_hint: "Gas and routing paid inside the swap rate. Not a PredictX fee.",
  fees: "Fees",
  price_impact: "Price impact",
  min_received: "Minimum received",
  slippage: "Slippage",
  quote_valid: "Quote valid",
  order_expires: "Order expires",
  good_till_cancelled: "Good till cancelled",
  steps: "Steps",
  /* NEW: AI insight */
  insight_empty: "No limit suggested right now.",
  insight_retry: "Try again",
  insight_rate_limited: "Too many requests. Wait a minute and try again.",
  insight_unsupported: "No insight is available for this token.",
  insight_llm_unavailable: "Insight is unavailable right now. Try again soon.",
  insight_network: "Couldn't reach the PredictX server.",
  /* NEW (not in the written deck) */
  connect_wallet: "Connect wallet",
  orders_off: "Testnet-only build: orders are not sent.",
  review_only: "Review only",
  settled_by: "Settled by Chainlink CRE (simulation)",
  minted: "Test USDC added. Place your bet.",
} as const;

export const closesIn = (time: string): string => `Closes in ${time}`;
export const approveAmount = (amount: string): string => `Approve ${amount} USDC`;
export const claimAmount = (amount: string): string => `Claim ${amount} USDC`;
export const refundAmount = (amount: string): string => `Refund ${amount} USDC`;
export const loadError = (thing: string): string => `Couldn't load ${thing}. Try again.`;
export const orderFailed = (message: string): string => `Order failed: ${message}`;
export const flashSuggests = (pct: string): string => `Flash suggests ${pct}%`;
export const slippageLowHint = (pct: string): string => `Below Flash's suggestion of ${pct}%. The order may not fill.`;
export const limitGapLabel = (pct: string): string => `${pct}% below market`;
export const rateLabel = (symbol: string, price: string): string => `1 ${symbol} = ${price}`;
export const quoteValidFor = (seconds: number): string => `${seconds}s`;
export const suggestedLimitRow = (price: string, gap: string, spot: string, time: string | null): string =>
  `Suggested limit ${price} (${gap} vs spot ${spot}${time ? `, as of ${time}` : ""})`;
