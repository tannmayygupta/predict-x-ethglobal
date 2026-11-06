# RULES.md

Hard rules. MUST and NEVER are not suggestions.

## 1. Scope and simplicity

1. MUST build only what `REQUIREMENTS.md` and `TASKS.md` ask for.
2. NEVER build anything listed under "Out of scope" in `REQUIREMENTS.md`.
3. MUST prefer the simpler option. One data source, one wallet, one order flow per feature.
4. NEVER add a dependency that is not in `DECISIONS.md`. If you need one, write a blocker.

## 2. Security

1. NEVER put an API key, private key, mnemonic or signature in client code, logs, commits, fixtures or screenshots. The Flash key, OpenAI key and CoinGecko key live only in backend env vars.
2. NEVER let the extension or dashboard call Flash, OpenAI or CoinGecko directly. Only `VITE_API_BASE_URL` and the chain RPC.
3. NEVER give the AI agent a tool that can sign, send or place anything. It returns text and a suggested number only.
4. Tweet text is untrusted. MUST render it as plain text. NEVER send tweet text to the LLM.
5. MUST validate every request body and response with the shared zod schema.
6. MUST request exact-amount token approvals. NEVER request unlimited approvals.
7. NEVER log signatures, typed data bodies, API keys or full request bodies of `/flash/*`.
8. Real-funds limits: the only mainnet spending allowed is Flash test orders of at most **$5 each** (`MAX_FLASH_TRADE_USD`) on Base. Pools use Base Sepolia test funds only.
9. NEVER present a simulated or mocked result as a real execution. Mock mode MUST show a visible "MOCK" badge in the UI.
10. NEVER commit `.env`. Only `.env.example` changes.

## 3. Code quality

1. TypeScript `strict`. NEVER use `any`, `@ts-ignore` or non-null `!` to silence the compiler. Use `unknown` and narrow.
2. Money and prices MUST be strings or `bigint`, never JS `number`. Convert only for display.
3. Use the shared helpers (`buildQuestion`, `buildTweetText`, `toStrikeE18`, `fromE18`, `toUsdcUnits`, `formatUsdc`, `computePayout`, `derivePoolStatus`, `extractPoolId`). NEVER re-implement them.
4. One responsibility per file. No file over 300 lines; split it.
5. No `console.log` in committed code. Use the logger (backend) or remove it.
6. Handle every async failure. NEVER swallow an error silently. Surface it through the shared error shape or a UI error state.
7. No magic numbers. Constants live in `packages/shared/src/constants.ts`.
8. Comments explain why, not what.

## 4. API discipline

1. `API_CONTRACT.md` and `packages/shared/src/schemas.ts` are the source of truth. Code that disagrees with them is wrong.
2. NEVER add, rename or remove a field or endpoint without the change protocol in `AGENT.md` section 6.
3. Error responses MUST use `{ "error": { "code", "message" } }` with a code from `ErrorCode`.
4. `steps.approveTx`, `steps.permitTypedData` and `steps.orderTypedData` pass through the system **unchanged**. NEVER edit, reformat or re-encode typed data.

## 5. UI rules (Part A)

1. All overlay UI renders inside a Shadow DOM root. NEVER inject global CSS into x.com.
2. Use design tokens from `UI_REFERENCE.md` only. NEVER hard-code colors, radii or font sizes in components.
3. Use the exact copy in the copy deck. NEVER invent button or error text.
4. Every component MUST implement its listed states (loading, empty, error, disabled, success).
5. Buttons that send a transaction or signature MUST disable on click until the result returns.
6. All X page selectors live in one file: `apps/extension/src/x/xSelectors.ts`.
7. Show the token contract address and the chain before any trade can be signed.
8. Keyboard: Escape closes overlays. Focus is visible. Reduced motion is respected.

## 6. Contracts and CRE (Part B)

1. `onReport` MUST accept calls only from the configured forwarder address.
2. NEVER add an admin function that can set an outcome, move user funds or pause withdrawals.
3. Use `SafeERC20` and `ReentrancyGuard`. Follow checks-effects-interactions.
4. Every contract rule in `REQUIREMENTS.md` (`FR-C-*`) MUST have a Foundry test.
5. CRE workflows use the SDK's `.result()` pattern; NEVER use `async/await` on capabilities.
6. One price source (CoinGecko). If it fails, skip the pool this run. NEVER guess a price.

## 7. Git

1. One task per commit. Message: `T-XXX: <imperative summary>` (example: `T-A06: add market swap tab`).
2. Branch per role: `agent-a/main`, `agent-b/main`. Merge to `main` only when the task's checks pass.
3. NEVER force-push. NEVER rewrite history.
4. Do not commit generated files, build output or `node_modules`.

## 8. Testing

1. Shared package: tests must stay green. A change to a schema updates its fixture and test in the same commit.
2. Backend: one test per endpoint for the happy path and one for the main error path.
3. Contracts: Foundry tests for each rule in `FR-C-*`, including the payout example (YES $60 / NO $40, 2% fee, $30 stake receives $49).
4. UI: manual check from the task, plus a build with no TypeScript errors. Screenshots optional.

## 9. Review checklist (run before every commit)

- [ ] Only files in my scope changed
- [ ] No secrets, no `.env`, no keys in fixtures
- [ ] Contract unchanged, or the change protocol was followed
- [ ] All inputs and outputs validated by shared schemas
- [ ] No `any`, no stray `console.log`, no unused code
- [ ] UI uses tokens and the copy deck; all states handled
- [ ] Task acceptance check passed; `pnpm typecheck` and `pnpm test` green
- [ ] `TASKS.md` and `WORKLOG.md` updated
