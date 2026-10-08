---
name: whatsapp-count-me-in
description: Conventions for this repo — module naming, ESM import style, test layout, commit format. Use when adding or changing code or tests here.
---

# whatsapp-count-me-in conventions

## Modules
- Class modules are PascalCase (`CommandHandler.ts`, `EventService.ts`, `notify/EmailNotifier.ts`); function and utility modules are camelCase (`formatters.ts`, `memberNames.ts`, `connection/classify.ts`).
- ESM with `"module": "nodenext"`: relative imports carry the `.js` extension — `import { t } from './i18n.js'`.
- Named exports only; the repo has no default exports.

## Tests
- Vitest; run with `pnpm test` (`vitest run`).
- One file per module in `src/__tests__/<Module>.test.ts`.

## Commits
- Conventional Commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`.
