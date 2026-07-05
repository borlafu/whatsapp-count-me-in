# whatsapp-count-me-in

WhatsApp bot for event sign-ups and waitlists in groups.

## Commands

- **Build:** `pnpm run build` (tsc)
- **Test:** `pnpm test` (vitest run)
- **Dev:** `pnpm start` (tsx src/index.ts)
- **Typecheck:** `npx tsc --noEmit`

## Stack

- TypeScript, Node ≥24, pnpm
- SQLite via better-sqlite3
- WhatsApp via @whiskeysockets/baileys
- Vitest for tests
