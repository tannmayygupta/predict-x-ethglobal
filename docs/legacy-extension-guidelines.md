> SUPERSEDED on 2026-10-29 by `AGENT.md` / `RULES.md` at the repo root. Paths below (`extension/`, `npm run build`, `sample images/`, the PRD) no longer apply; the extension now lives in `apps/extension`.

# Repository Guidelines

## Project Structure & Module Organization

The Chrome extension frontend lives in `extension/`: React views in `src/main.tsx`, the X Shadow DOM overlay in `src/content.tsx`, styles in `src/styles.css`, and the Manifest V3 files in `public/`. Root-level files include the earlier standalone UI prototype, the MVP PRD, and visual references in `sample images/`. The PRD describes future shared, dashboard, backend, contract, and CRE packages; they are not implemented here. Keep this task's scope in `extension/` and update the PRD when API or contract interfaces change.

## Build, Test, and Development Commands

From `extension/`, run `npm install` to install frontend dependencies and `npm run build` to create the unpacked extension in `extension/dist/`. Load that `dist/` directory from `chrome://extensions` with Developer mode enabled. `npm run dev` starts the Vite side-panel development page; it does not load the X content script into Chrome. There is no test suite yet. The PRD calls for Vitest for future shared schemas and Foundry for contracts.

## Coding Style & Naming Conventions

Use React with TypeScript, `camelCase` for values, and descriptive lowercase filenames. Keep X page integration in `src/content.tsx` and isolate it in Shadow DOM so X styles cannot affect the overlay. Match the existing styling in `src/styles.css`. Avoid reformatting the bundled root HTML prototype wholesale. Keep API keys out of extension code and commits.

## Testing Guidelines

No tests or coverage requirements are present yet. When shared schemas or contracts are added, follow the PRD's Vitest and Foundry choices, name tests after the behavior or module, and document the exact invocation.

## Commits and Pull Requests

Git history is unavailable in this workspace, so no repository-specific commit convention could be confirmed. Use short imperative commit subjects (for example, `Add shared API schemas`). Pull requests should explain the user-visible or interface change, list validation performed, and include screenshots for UI changes. Link related issues or requirements when available.

## Security and Configuration

Keep API keys on the backend and out of extension or dashboard bundles. Use environment variables for configuration; provide safe example values in an example environment file, never real credentials. The PRD lists the expected variable names and API boundaries.
