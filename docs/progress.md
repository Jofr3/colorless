# Progress — living status

> Update this at the **end of every session**: bump the status table, append a
> session-log entry, and rewrite the **Resume point** to the next concrete action.

**Last updated:** 2026-07-09 — build session (P1 milestone 5: catalog read API).

## Resume point
**M5 is built and verified locally** (273 tests), **uncommitted** on `backend`.
Loose ends, in order:
1. **Remote migrations + ingest** (user must run/approve — the permission gate
   blocks Claude): `bun run db:migrate:remote` from `apps/api` (remote D1 is
   still on migration 0000; deployed `/assets/*` errors until then), then
   `bun scripts/ingest.ts --serie sv --remote` (~20–25 min, idempotent;
   19 sets / ~3.7k cards).
2. **Commit** M5, **deploy** (the Worker needs a redeploy to serve the new
   catalog routes + `CACHE` KV binding).
Then start **milestone 6** (`workstreams/backend-data.md` §8): auth —
email/password + Discord/Google OAuth, server sessions (§3.5). Needs OAuth app
registrations (Discord + Google consoles) and `wrangler secret`s — user-side
prerequisites to raise early.

## Status by workstream
| Workstream | Phase | Status |
|---|---|---|
| backend-data | P1 | 🚧 M1–M5 done (remote ingest pending); M6 (auth) next |
| deck-builder | P2 | 📋 Specced + code-mapped (`workstreams/deck-builder.md`) — blocked on P1 |
| simulator | P3 | 📋 Ruleset ready (`reference/ptcg-rules.md`); engine not started |
| online | P4 | 📋 Specced — blocked on P3 |
| polish | P5 | 📝 Backlog |

Legend: 📝 backlog · 📋 specced · 🔎 research · 🚧 in progress · ✅ done

## Session log
- **2026-07-09** (build) — **P1 milestone 5** (sub-agent): public catalog read
  API + the **canonical domain `Card`** (D5) in `packages/schema/src/catalog/`
  (unprefixed names; flat shape, consumers narrow on `category`; `image` is
  OUR asset base path `/assets/cards/{id}`, quality appended by clients).
  Routes in `apps/api/src/catalog/`: `GET /cards` (name/category/type/rarity/
  set/regulationMark/hpMin/hpMax/legal filters; page/pageSize≤100 envelope
  with total), `/cards/:id`, `/sets[?serie=]`, `/sets/:id` (+its cards),
  `/series`; all boundary-parsed through the domain schemas; KV cache-aside
  (binding `CACHE`, TTL 3600, normalized keys, only 200s) with
  `x-luminous-cache`. `@hono/zod-validator@0.8` works with zod 4 (hono range
  bumped to ^4.12). Suite 242→273; wrangler-dev transcript against the real
  123-card local D1 all correct. Uncommitted; deploy + remote ingest pending
  → resume point.
- **2026-07-09** (build) — **P1 milestone 4** (sub-agent) + **D9 logged**:
  ingest pipeline (`apps/api/src/ingest/` sql/map/upserts + 31 tests;
  CLI `apps/api/scripts/ingest.ts` — `--sets|--serie`, `--remote`, `--dry-run`)
  and the lazy R2 asset proxy (`/assets/cards/:id/:file`,
  `/assets/sets/:id/:file`; cache-aside, `x-luminous-cache: hit|miss`).
  Migrations 0001/0002 swap `*_r2_url` → origin `*_url` columns (two-step
  drop-then-add avoids drizzle-kit's interactive rename prompt in non-TTY).
  Local ingest of sve+sv06.5 (123 cards) verified incl. idempotent rerun and
  FK integrity; wrangler-dev curl transcript confirms miss→hit mirroring and
  the 404 allowlist. Suite 242 tests. R2 bucket `luminous-assets` + KV plans
  per §8.5 next. **NixOS quirk:** `wrangler dev` needs
  `SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt` for workerd origin
  fetches (production + node-side CLI unaffected). Worker deployed (bindings
  DB + ASSETS live); remote migrations/ingest pending → resume point.
- **2026-07-09** (build) — **P1 milestone 3**: Drizzle schema + D1 migrations
  (sub-agent). `apps/api/src/db/{catalog,users,schema}.ts` — 9 tables per
  §5.3 (updated where reality differed: `series.release_date` added,
  `sets.updated` dropped, `abilities_json` added; `variants_detailed`/
  `pricing`/`boosters`/dp-era extras deliberately not persisted). Migration
  `drizzle/0000_tired_sentry.sql` applied to **local** D1; FK enforcement
  verified. D1 database `luminous` created on the account (EEUR,
  id `735f0fb5-cdc3-494d-8b97-74a8ade0124a`); wrangler.jsonc binds it as `DB`
  with `migrations_dir: "drizzle"`; remote apply verified (9 tables live).
  **Notes for M4 (ingest):** insert series→sets→cards (FKs); upsert,
  never delete+reinsert cards (`deck_cards.card_id` RESTRICT); missing
  upstream `legal` → false/false; JSON columns are Drizzle `mode: "json"` —
  pass raw objects, don't pre-stringify; catalog timestamps ISO text, user
  timestamps epoch-ms integers.
- **2026-07-09** (build) — **P1 milestone 2**, via two sequential sub-agents:
  (a) lobby vocabulary moved — `types.ts` + `lobbyReducer.ts` (+ its 11 tests)
  now live in `packages/schema/src/lobby/`, 7 web importers switched to
  `@luminous/schema` (pure move, clean git renames); (b) tcgdex Zod schemas
  authored in `packages/schema/src/tcgdex/` — discriminated union on card
  `category`, 12 verbatim live fixtures, 19 tests, plus a live sweep script
  (`packages/schema/scripts/validate-live.ts`, outside tsconfig on purpose)
  that validated 390 models over 370 requests with 0 failures. Reality-vs-doc
  corrections folded into §5.1 (notably: `variants_detailed`, `wPromo`,
  `abilities[]`, nullable pricing blocks, tcgplayer dynamic print-run keys).
  `bun run check` green (203 tests) + production `vite build` green. Root
  `package.json` now depends on `@luminous/schema`; the package declares
  `sideEffects: false` so the web bundle tree-shakes unused zod schemas.
- **2026-07-09** (build) — **P1 milestone 1**: Bun-workspace monorepo scaffolded.
  Root `package.json` gained `workspaces: ["apps/*", "packages/*"]` (web app
  stays at root for now, per spec). New: `apps/api` (Hono 4 Worker,
  `wrangler.jsonc`, `GET /health`), `packages/schema` (Zod 4;
  `healthResponseSchema` proves the cross-package import), `packages/engine`
  (stub per D7). Root `tsc -b` references, biome scope, and vitest globs now
  cover all three; `bun run check` green (184 tests). `/health` verified via
  `wrangler dev` + curl, then deployed to
  `https://luminous-api.jofrescari.workers.dev` (user-approved).
  Notes: bun nests workspace deps in each package's own `node_modules`;
  packages export TS source directly (`exports: "./src/index.ts"`, no build
  step); wrangler 4.109 wants `@cloudflare/workers-types` **v5** (peer dep).
- **2026-07-09** — Defined all major decisions (D1–D6); wrote the backend/data
  spec; set up this docs-based continuation system + roadmap. Kicked off
  sub-agents to (a) research the PTCG ruleset → `reference/ptcg-rules.md` and
  (b) map the deck-builder code → `workstreams/deck-builder.md`.
  - Both sub-agents completed: `reference/ptcg-rules.md` (528 lines, SV Standard
    era, engine-oriented) and `workstreams/deck-builder.md` (code map + 19-task
    P2 plan) are written. Continuation system is fully populated.
- **2026-07-09** (design) — Added **D7** (engine lives in `packages/engine`,
  shared by web + api) and **D8** (composable, data-driven card effects: primitive
  op programs over archetype templates + a semantic event stream for animation).
  Queried live tcgdex cards to ground it; expanded `workstreams/simulator.md`.
  Follow-up for P1: add an `abilities_json` column to the `cards` table in
  `workstreams/backend-data.md`.
