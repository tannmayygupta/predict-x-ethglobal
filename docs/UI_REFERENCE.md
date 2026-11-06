# UI_REFERENCE.md: blueprint of every screen

Agent A builds from this file. Screen IDs (A1..A6, D1..D3) match `REQUIREMENTS.md` and `TASKS.md`. Wireframes are ASCII; sizes are in px. Tokens are in `packages/shared/src/design-tokens.css`. Copy is exact; do not reword it.

## 1. Design direction

**Subject:** prediction pools on X, used by crypto traders mid-scroll. The UI must read in two seconds, sit quietly on top of someone else's page, and make one thing memorable.

**The memorable thing: the Odds Slip.** A pool is drawn as a tear-off slip: question on top, a dashed tear line with two notches cut into the edges, stakes below. The YES/NO split bar sits on the slip. Everything else stays plain.

**Palette (named)**

| Name | Hex | Use |
| --- | --- | --- |
| Ink | `#14182B` | Card and slip surface |
| Ink 2 | `#1D2340` | Inputs, raised areas (Ink 3 `#262D52` on hover) |
| Rule | `#2C3358` | Borders, tear line |
| Text | `#EDEBFA` | Primary text |
| Mute | `#9AA1C7` | Secondary text |
| Amber | `#FFB020` | Primary action, brand (text on it is Ink) |
| Yes | `#34D399` | YES, gains, filled |
| No | `#FF6B7A` | NO, errors, failed |
| Page | `#0D1020` | Dashboard background |

Dark only. On X in light mode the card still uses Ink with its border and shadow, so it reads as a separate object.

**Type:** Bricolage Grotesque (600, 700) for headings, prices and amounts; Instrument Sans (400, 500, 600) for everything else. Both bundled. Numbers use tabular figures. Scale: 12, 13, 14, 16, 20, 28, 40. Sentence case everywhere; no all-caps labels.

**Rules of restraint:** one radius per role (6 inputs, 10 buttons, 14 cards); one shadow; no gradients; no entrance animations. Motion only answers an action: card open (140 ms fade and 4 px rise), state changes (120 ms). Respect `prefers-reduced-motion`.

## 2. Where things live

```
+-- x.com timeline --------------------------------------------+
|  @someone                                                    |
|  Gm. $ETH looks ready here                                   |
|      ^ highlighted tag (amber underline)  -> opens A1       |
|                                                              |
|  @other                                                      |
|  Will $PEPE be above $0.0000120 at 14:30 UTC on 28 Oct?      |
|  Bet YES or NO: predictx.app/pool/12   PX#12                 |
|  +-- A6 Bet box (injected under the tweet) ----------------+ |
|  |  ...                                                    | |
|  +---------------------------------------------------------+ |
|                                                  [ PredictX ]| <- launcher pill (bottom right)
+--------------------------------------------------------------+      opens A4
```

| Surface | Mount point | Width | z-index |
| --- | --- | --- | --- |
| A1 token card | Floating, anchored below the hovered tag (flip above if no room) | 340 | overlay |
| A4 create panel | Fixed, bottom 72, right 20 | 360 | overlay |
| A5 post step | Replaces the content of A4 | 360 | overlay |
| A6 bet box | Inserted after the tweet text block | 100% of tweet column, max 520 | in flow |
| Launcher pill | Fixed, bottom 20, right 20 | auto, 40 tall | overlay |

All of it lives in one Shadow DOM root per mount point.

## 3. Screens

### A1. Token card (hover on `$ETH`)

```
+----------------------------------------------+  340 wide, radius 14
| Ethereum  ETH                  [ Base ]  [x] |  header, padding 16
| $2,451.12    v 1.8%  today                   |  price: display 28; change: 13, No color if negative
| 0x4200...0006  [copy]                        |  address chip, 13, Mute
+----------------------------------------------+
|   Swap        Insight                        |  tabs, active has 2px Amber underline
+----------------------------------------------+
|                                              |
|   (tab body: A2 or A3)                       |
|                                              |
+----------------------------------------------+
| [MOCK]              Trades run on Base       |  footer, 12, Mute. MOCK badge only in mock mode
+----------------------------------------------+
```

States: **loading** (skeleton for price and address), **error** (Notice: "Couldn't load ETH. Try again." + Try again button), **stale** (price with "Price delayed" in Mute).

### A2. Swap tab

Idle (market):
```
|  Spend (USDC)                                |
|  [ 2.00                         ]  max 5.00  |  Input, 40 tall
|  ( Market | Limit )                          |  segmented control
|  (Limit only) Buy when price is at or below  |
|  [ 2380.00                      ]  USD       |
|  [          Get quote           ]            |  primary button
```

Quote ready:
```
|  You spend     2.00 USDC                     |
|  You get       about 0.000816 ETH            |  display 20
|  Fees          $0.01     Price impact 0.04%  |
|  Token         ETH  0x4200...0006  on Base   |  FR-S-05: required before the button enables
|  Steps  (1) Approve  (2) Sign  (3) Place     |  stepper; step 1 hidden if no approveTx
|  [        Approve and place order      ]     |  primary; label changes per step (copy deck)
|  Quote valid for 48s                         |  Mute, counts down
```

Signing:
```
|  Steps  (1) Approve v  (2) Sign ...          |
|  Confirm in your wallet.                     |
|  [ Waiting for wallet...  ]  (disabled)      |
```

Placed, polling:
```
|  Order sent. Checking status...              |  spinner
|  Order o_456                                 |
```

Filled:
```
|  Filled                                      |  Yes color, display 20
|  Bought 0.000816 ETH for 2.00 USDC           |
|  View on BaseScan                            |  link to /tx/<txHash>
|  [ New order ]                               |  secondary
```

Limit open:
```
|  Waiting for price                           |  Amber
|  Your order fills when ETH is at or below    |
|  $2,380.00.   View status                    |
```

Failed or expired:
```
|  [!] Order failed: <message>                 |  Notice error
|  [ Try again ]                               |
```

Other states: **wrong network** (button reads "Switch to Base"), **no wallet** (Notice: "Install MetaMask to trade." + link), **amount invalid** (Input error text under field), **FLASH_ERROR** (Notice error with API message).

### A3. Insight tab

```
|  What are you planning? (optional)           |
|  [ I want to buy on a dip           ]  0/200 |  Input, counter in Mute
|  [         Get insight          ]            |  primary
|  ------------------------------------------  |
|  [Neutral]  [Low confidence]                 |  badges
|  ETH is down 1.8% today. A limit buy a few   |  tip, 14, max 2 lines of 14 words
|  percent below spot avoids chasing the move. |
|  Suggested limit: $2,380.00  (About 3% below)|
|  [   Use suggested limit   ]                 |  secondary; fills A2 Limit
|  Not financial advice.                       |  12, Mute
```

States: **loading** ("Reading the market..." with skeleton lines), **degraded** (Notice info: "Live insight unavailable. Showing a basic note."), **error** (Notice error + Try again), **no suggestion** (hide the limit row and button).

Badge colors: Bullish = Yes, Bearish = No, Neutral = Mute; confidence badges use Mute outline.

### A4. Create panel (launcher pill opens it)

```
+--------------------------------------------+  360 wide
| New prediction                          [x]|
|                                            |
| Token                                      |
| [ PEPE                                  v ]|  select from allowlist
| Will the price be                          |
| ( Above | Below )                          |  segmented
| Strike price (USD)                         |
| [ 0.0000120                               ]|
| Resolves in                                |
| ( 3 min | 1 hour | 4 hours | 24 hours )    |  segmented
|                                            |
| +----------------------------------------+ |
| | Will $PEPE be above $0.0000120 at      | |  preview: the exact onchain question
| | 14:30 UTC on 28 Oct?                   | |
| +----------------------------------------+ |
| Fee: 2% of the pool, paid out to winners.  |  12, Mute
| [          Create prediction            ]  |  primary
+--------------------------------------------+
```

States: **validation** (strike must be a number above 0; token required), **wrong network** ("Switch to Base Sepolia"), **sending** ("Creating..." disabled), **error** (Notice error with reason), **no wallet**.

### A5. Post step (replaces A4 content after success)

```
| Prediction created                          |  Yes color check, display 20
| Pool #12 is live on Base Sepolia.           |
| +----------------------------------------+  |
| | Will $PEPE be above $0.0000120 at...   |  |  buildTweetText output, selectable
| | Bet YES or NO: predictx.app/pool/12    |  |
| | PX#12                                  |  |
| +----------------------------------------+  |
| [        Post to X          ]               |  opens composer; user presses Post
| [ Copy link ]   [ Open pool page ]          |  secondary, secondary
```

### A6. Bet box (the Odds Slip, injected under a tweet)

Open:
```
+------------------------------------------------------+  radius 14, border Rule
| Will $PEPE be above $0.0000120 at 14:30 UTC on 28 Oct? |  question: display 16, 2 lines max
| Closes in 03:12                         Pool 100.00 USDC|  13, Mute; countdown is display font
(. . . . . . . . . . . . . . . . . . . . . . . . . . . .)  tear line with notches
| YES 60%                                      NO 40%   |
| [########################################--------]    |  split bar: Yes left, No right, 10 tall
| 60.00 USDC                              40.00 USDC    |
| Amount [ 5.00      ] USDC                             |
| [   Bet YES   ]  [   Bet NO   ]                       |  Yes outline / No outline; filled when chosen
+------------------------------------------------------+
```

Awaiting result (after close, before CRE report):
```
| Closed. Waiting for the result...                     |  Amber; no buttons
```

Resolved:
```
| Result: YES   Price at close $0.0000131               |  Yes or No color
| You staked 30.00 YES. You can claim 49.00 USDC.       |  only if connected and has a position
| [ Claim 49.00 USDC ]                                  |  primary
| You staked 10.00 NO. Better luck next time.           |  loser line (no button)
```

Void:
```
| No one took the other side. Everyone gets a refund.   |
| [ Refund 5.00 USDC ]                                  |
```

Other states: **loading** (skeleton), **not found** ("Pool not found."), **wrong network** (button "Switch to Base Sepolia"), **needs approval** (button "Approve 5.00 USDC" then "Bet YES"), **no test USDC** (Notice: "You need test USDC." + link "Get test USDC" to `/faucet`), **sending** (disabled, "Waiting for wallet...").

### D1. Dashboard home `/`

```
+-------------------------------------------------------------------+
| PredictX                  Pools   Faucet        [Base Sepolia] [0x12..9f Connect] |  top bar, 64 tall
+-------------------------------------------------------------------+
| Latest predictions                                                 |  display 28
|                                                                    |
| +--- slip ---------------------+  +--- slip ---------------------+ |  2 columns at >= 800, 1 below
| | question  ...                |  | question ...                 | |
| | Closes in 3h   Pool 100 USDC |  | Resolved: YES                | |
| | [#########-------] 60/40     |  | [#########-------] 60/40     | |
| +------------------------------+  +------------------------------+ |
+-------------------------------------------------------------------+
```
Empty: "No predictions yet. Create one from X with the PredictX button." Loading: 4 skeleton slips. Error: Notice error + Try again. Slip background variable `--px-slip-bg` = Page.

### D2. Pool page `/pool/:id`

```
+-------------------------------------------------------------------+
| top bar                                                            |
+-------------------------------------------------------------------+
| Pool #12   [Open]                                  (status badge) |
| Will $PEPE be above $0.0000120 at 14:30 UTC on 28 Oct?            |  display 28, max width 640
|                                                                    |
| +--- slip (same as A6, full width up to 640) -------------------+ |
| |  odds, bar, totals, bet form / result / claim                  | |
| +----------------------------------------------------------------+ |
|                                                                    |
| Your position                                                      |
| YES 30.00 USDC    NO 0.00 USDC    Claimable 49.00 USDC            |
|                                                                    |
| Details                                                            |
| Resolves  28 Oct 14:30 UTC    Fee 2%    Creator 0x12..9f           |
| Contract  0x2222..2222 (BaseScan)    Question source: CoinGecko     |
| [ Copy link ]  [ Post to X ]                                       |
+-------------------------------------------------------------------+
```
Status badge colors: open = Amber, awaiting = Mute, resolved = Yes or No by outcome, void = Mute.

### D3. Faucet `/faucet`

```
| Get test USDC                                                      |
| Test USDC works only on Base Sepolia. It has no value.             |
| Your balance  120.00 USDC                                          |
| [   Get 100 USDC   ]                                               |
| Need gas? Get Base Sepolia ETH from a faucet.  (link)              |
```

## 4. Components

| Component | Variants and states | Notes |
| --- | --- | --- |
| Button | primary (Amber), secondary (Ink 2 + Rule border), ghost, yes, no. sizes: md 40, sm 32. states: default, hover, focus (2px Amber ring, 2px offset), disabled (50% opacity), loading (spinner, disabled) | radius 10; label sentence case |
| Input | default, focus, error (No border + message below), disabled | 40 tall, radius 6, Ink 2 fill |
| Segmented | 2 to 4 options; selected = Ink 3 fill with Amber text | keyboard arrows |
| Tabs | 2 tabs; active has 2px Amber underline | |
| Select | token list | native `<select>` styled; no custom popover |
| Badge | neutral, yes, no, amber | 22 tall, radius 6, 12 text |
| OddsBar | props: yesTotal, noTotal; shows % and amounts; 0/0 shows a Rule-colored empty bar and "No bets yet" | 10 tall, radius 5; min 4% width per side when both exist |
| Countdown | props: resolveTime; format `MM:SS` under 1 h, `Hh Mm` above; at 0 shows "Closed" | display font; updates each second |
| AddressChip | short form `0x4200...0006`, copy button, link to explorer | copy shows "Copied" for 1.5 s |
| NetworkPill | Base, Base Sepolia; amber dot when the wallet is on the wrong network | |
| Stepper | steps with states: pending, active, done, failed | hides the Approve step if no `approveTx` |
| StatusLine | spinner + text | |
| Notice | info (Mute), warn (Amber), error (No); icon + one sentence + optional action | 8 radius |
| Toast | bottom center on dashboard only; 4 s | not used in the overlay |
| Skeleton | Ink 2 blocks, no shimmer animation | |
| Slip | wraps question + tear line + stakes; uses `.px-slip` classes from tokens | the only decorative element |

## 5. Copy deck (exact strings)

| Key | Text |
| --- | --- |
| get_quote | Get quote |
| approve_place | Approve and place order |
| place_order | Place order |
| approve | Approve {amount} USDC |
| switch_base | Switch to Base |
| switch_base_sepolia | Switch to Base Sepolia |
| waiting_wallet | Waiting for wallet... |
| confirm_wallet | Confirm in your wallet. |
| order_sent | Order sent. Checking status... |
| filled | Filled |
| filled_detail | Bought {receive} ETH for {spend} USDC |
| view_basescan | View on BaseScan |
| limit_waiting | Waiting for price |
| limit_waiting_detail | Your order fills when ETH is at or below {price}. |
| order_failed | Order failed: {message} |
| quote_expired | Quote expired. Get a new quote. |
| amount_too_high | The most you can trade is $5.00. |
| no_wallet | Install MetaMask to continue. |
| insight_cta | Get insight |
| insight_loading | Reading the market... |
| insight_degraded | Live insight unavailable. Showing a basic note. |
| use_limit | Use suggested limit |
| disclaimer | Not financial advice. |
| create_cta | Create prediction |
| creating | Creating... |
| created | Prediction created |
| post_to_x | Post to X |
| bet_yes | Bet YES |
| bet_no | Bet NO |
| closes_in | Closes in {time} |
| closed_waiting | Closed. Waiting for the result... |
| result_yes | Result: YES |
| result_no | Result: NO |
| claim | Claim {amount} USDC |
| refund | Refund {amount} USDC |
| void_note | No one took the other side. Everyone gets a refund. |
| need_usdc | You need test USDC. |
| get_test_usdc | Get test USDC |
| pool_not_found | Pool not found. |
| load_error | Couldn't load {thing}. Try again. |
| empty_pools | No predictions yet. Create one from X with the PredictX button. |
| mock_badge | MOCK |
| price_delayed | Price delayed |

Voice: plain verbs, sentence case, errors say what happened and what to do, never apologize. The same action keeps the same name everywhere (the button "Claim" produces the message "Claimed").

## 6. Interaction specs

| Item | Spec |
| --- | --- |
| Hover open / close | open after 300 ms on the tag; close 150 ms after leaving both tag and card; Escape closes |
| Card position | below the tag, 8 px gap; flips above if less than 360 px below; clamps to the viewport with 12 px margin |
| One at a time | opening a card closes any other |
| Polling | order status every 3 s, stop after 5 minutes with "Still waiting. Check again later." |
| Pool refresh | A6 and D2 refetch the pool every 10 s while open and awaiting; and right after any transaction |
| Focus | focus moves into the card on open via Tab only; no focus stealing |
| Buttons | disabled from click until the result returns |
| Selection | tweet text is never made interactive; only the tag span and our injected nodes are |
| Reduced motion | all transitions 0 ms |
| Keyboard | Escape closes overlays; Enter submits the focused form; arrow keys move in segmented controls |

## 7. Mock data to design against

Use `packages/shared/src/fixtures.ts`: `marketEth`, `insightEth`, `quoteEthMarket`, `orderFilled`, `poolOpen`, `poolResolved`, `positionWinner`. The mock server (MSW) must also be able to return each error code on demand (query `?fail=FLASH_ERROR`) so every error state can be seen.

## 8. Visual acceptance checklist (per screen)

- [ ] Uses only tokens (no hard-coded colors, radii, font sizes)
- [ ] Matches the wireframe structure and the exact copy
- [ ] Loading, empty and error states exist and are reachable in the mock
- [ ] Contract address and chain are visible before any trade can be signed
- [ ] Buttons disable while waiting; no double submit
- [ ] Keyboard focus visible; Escape works on overlays
- [ ] No horizontal scroll at 340 px (card) and 360 px (panel)
- [ ] The overlay does not change x.com's own layout or styles
- [ ] The Odds Slip is the only decorative element on the screen
