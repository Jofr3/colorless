# apps/api

- The API, D1, auth, the lobby, ingest and releases as built: `docs/workstreams/backend-data.md`
  (§6 lists the routes and the steps for a new one; §3.4.1 is the ingest; §3.7 releases).
- Migrations: `docs/conventions.md`, "Database migrations".
- One suite: `bunx vitest run <path>`; the `*.d1.test.ts` suites run on a real local D1. The gate is
  `bun run check`.
- Production writes go only through `bun run release` or `scripts/with-deploy-token.ts`.
