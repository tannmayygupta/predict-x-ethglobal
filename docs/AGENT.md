# AGENT.md: operating manual for autonomous development

You are building PredictX, a hackathon proof of concept. The goal is a working 3-minute demo, not a production system. When two designs both work, choose the one with fewer moving parts.

All paths in this and the other planning docs are relative to the repo root; bare doc names such as `RULES.md` or `TASKS.md` mean the file in `docs/`.

## 1. Read first (every session, in this order)

1. `README.md`, `RULES.md`, `REQUIREMENTS.md`
2. `API_CONTRACT.md` and `packages/shared/src/schemas.ts` (they must agree; the code wins, then fix the doc)
3. `UI_REFERENCE.md` if your role is A
4. `TASKS.md`, `WORKLOG.md` (last 5 entries), `BLOCKERS.md`

## 2. Roles and scopes

| Role | May edit | Must not edit |
| --- | --- | --- |
| **Agent A** (frontend) | `apps/extension/**`, `apps/dashboard/**` | `apps/backend`, `contracts`, `cre`, `tokens.json`, shared ABI/fixtures |
| **Agent B** (backend) | `apps/backend/**`, `contracts/**`, `cre/**`, `scripts/**`, `packages/shared/tokens.json`, shared ABI and fixtures | `apps/extension`, `apps/dashboard` |
| **Both** | `TASKS.md` (own tasks only), `WORKLOG.md`, `BLOCKERS.md` | `packages/shared/src/schemas.ts` and `helpers.ts` unless the change protocol (section 6) is followed |

If your task needs a file outside your scope, stop and write a blocker. Do not edit it.

## 3. The loop (repeat for every task)

1. **Pick.** Take the first task in `TASKS.md` with `status: todo`, matching your role, whose `deps` are all `done`. If none, write "idle: waiting on <ids>" in `WORKLOG.md` and stop.
2. **Understand.** Read the task's linked requirement IDs, API sections and UI screens. Restate the acceptance check in one sentence.
3. **Plan.** Write at most 5 lines in your scratch notes: files you will touch, tests you will add.
4. **Build small.** Smallest diff that satisfies the acceptance check. No refactors, no extras, no "while I am here".
5. **Verify.** Run the checks in section 4. A task is not done until they pass.
6. **Self-review** against `RULES.md` section "Review checklist".
7. **Record.** Set the task to `done` in `TASKS.md`, append to `WORKLOG.md`, commit (format in `RULES.md`).
8. **Next.** Go to step 1.

Work on one task at a time. Do not start a second task with the first one failing.

## 4. Verification commands

| Scope | Commands that must pass |
| --- | --- |
| Any | `pnpm typecheck`, `pnpm test` |
| Extension / dashboard | `pnpm --filter ./apps/extension build`, `pnpm --filter ./apps/dashboard build`, plus the manual check written in the task |
| Backend | `pnpm --filter ./apps/backend test`, then call each touched endpoint with `curl` and confirm the response parses with the zod schema |
| Contracts | `forge build`, `forge test -vv` |
| CRE | `cre workflow simulate` (see task) and paste the key output lines into `WORKLOG.md` |

If a command cannot run in your environment, say so in `WORKLOG.md`. Never mark a task `done` on an unrun check.

## 5. Mock-first rule

- Agent A develops against a mock server (MSW) that serves `packages/shared/src/fixtures.ts`. It never waits for the backend.
- Agent B runs with `FLASH_MOCK=true` until Gate 0 (`T-003`) passes.
- Switching from mock to real is a change to one environment variable, never to code.

## 6. Contract change protocol

The API contract is the only thing the two agents share. To change it:

1. Write a blocker entry titled `CONTRACT CHANGE: <what>` with the old shape, the new shape and why.
2. Wait for a human to resolve it.
3. After approval, one agent updates `schemas.ts`, `fixtures.ts`, `API_CONTRACT.md` and the shared tests **in one commit**. Then both sides adapt.

Never "just add a field" on one side.

## 7. When to stop and ask a human

Write a blocker and move on (or stop if nothing else is unblocked) when:

- An API key, wallet, faucet funds or deployment address is missing.
- The task needs a new dependency, chain, tool or service not listed in `DECISIONS.md`.
- A real-funds action is needed beyond the limits in `RULES.md`.
- The spec contradicts itself, or two documents disagree and the code does not settle it.
- A sponsor API behaves differently from `API_CONTRACT.md` or the notes in `docs/GATE0.md`.
- You have failed the same check three times with different fixes.

Do not guess, invent endpoints, invent field names, or silently change scope.

## 8. Things that look helpful but are forbidden

Adding features from "out of scope", adding a database table or endpoint not in the contract, calling third-party APIs from the frontend, committing secrets, deploying anything to mainnet other than the one Flash test order in `T-003`, rewriting working code for style, skipping tests, "temporarily" disabling validation.

## 9. Task definition of done

- Acceptance check from `TASKS.md` passes (manually or by test).
- `pnpm typecheck` and `pnpm test` pass.
- No new `any`, no `console.log` left, no TODO without a task id.
- Every request and response touched is validated by the shared zod schema.
- UI work matches `UI_REFERENCE.md` (tokens, copy, states).
- `TASKS.md`, `WORKLOG.md` updated, one commit made.

## 10. Report format (end of every working session)

```
Done: <task ids>
In progress: <task id or none>
Blocked: <B-ids or none>
Next: <task ids>
Risks: <anything that could break the demo>
```

## 11. Starter prompts

**Agent A**

> You are Agent A for PredictX. Read AGENT.md, RULES.md, REQUIREMENTS.md, API_CONTRACT.md, UI_REFERENCE.md and TASKS.md in that order. You own apps/extension and apps/dashboard only. Work through TASKS.md tasks marked A, one at a time, following the loop in AGENT.md. Use the MSW mock server until told the real backend is live. Stop and write BLOCKERS.md entries instead of guessing.

**Agent B**

> You are Agent B for PredictX. Read AGENT.md, RULES.md, REQUIREMENTS.md, API_CONTRACT.md, ARCHITECTURE.md and TASKS.md in that order. You own apps/backend, contracts, cre, scripts and the shared tokens/ABI/fixtures. Work through TASKS.md tasks marked B, one at a time, following the loop in AGENT.md. Keep FLASH_MOCK=true until T-003 passes. Stop and write BLOCKERS.md entries instead of guessing.
