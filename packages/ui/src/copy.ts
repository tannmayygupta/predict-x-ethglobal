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
  /* NEW (not in the written deck) */
  connect_wallet: "Connect wallet",
  orders_off: "Testnet-only build: orders are not sent.",
  review_only: "Review only",
  settled_by: "Settled by Chainlink CRE (simulation)",
} as const;

export const closesIn = (time: string): string => `Closes in ${time}`;
export const approveAmount = (amount: string): string => `Approve ${amount} USDC`;
export const claimAmount = (amount: string): string => `Claim ${amount} USDC`;
export const refundAmount = (amount: string): string => `Refund ${amount} USDC`;
export const loadError = (thing: string): string => `Couldn't load ${thing}. Try again.`;
export const filledDetail = (receive: string, spend: string): string => `Bought ${receive} ETH for ${spend} USDC`;
export const limitWaitingDetail = (price: string): string => `Your order fills when ETH is at or below ${price}.`;
export const orderFailed = (message: string): string => `Order failed: ${message}`;
