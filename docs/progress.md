# Progress — living status

> Update this at the **end of every session**: bump the status table, append a
> session-log entry, and rewrite the **Resume point** to the next concrete action.

**Last updated:** 2026-07-09 — build session (P1 milestone 1: monorepo scaffold).

## Resume point
P1 **milestone 1 is done**: scaffold committed on the `backend` branch and
deployed — `https://luminous-api.jofrescari.workers.dev/health` is green.
Next concrete action: **milestone 2** (`workstreams/backend-data.md` §8) —
author the tcgdex Zod schemas in `packages/schema` (validate against live
tcgdex responses), and move the lobby types + reducer
(`src/features/online/net/`) into `packages/schema`.

## Status by workstream
| Workstream | Phase | Status |
|---|---|---|
| backend-data | P1 | 🚧 M1 scaffold done (local); M2 next |
| deck-builder | P2 | 📋 Specced + code-mapped (`workstreams/deck-builder.md`) — blocked on P1 |
| simulator | P3 | 📋 Ruleset ready (`reference/ptcg-rules.md`); engine not started |
| online | P4 | 📋 Specced — blocked on P3 |
| polish | P5 | 📝 Backlog |

Legend: 📝 backlog · 📋 specced · 🔎 research · 🚧 in progress · ✅ done

## Session log
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
