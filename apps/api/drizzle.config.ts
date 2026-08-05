// drizzle-kit config — generate-only (no credentials): `bun run db:generate`
// emits SQL into ./drizzle, and wrangler applies it (`db:migrate:local` /
// `db:migrate:remote` — see wrangler.jsonc `migrations_dir`).
//
// NB: apps/api tsconfig only includes src/, so this file sits outside
// typecheck by design; Biome still lints it.

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
