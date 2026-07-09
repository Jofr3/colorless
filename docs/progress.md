# Progress — living status

> Update this at the **end of every session**: bump the status table, append a
> session-log entry, and rewrite the **Resume point** to the next concrete action.

**Last updated:** 2026-07-09 — planning session (roadmap + continuation system).

## Resume point
Phase 1 is fully specced but **not yet implemented**. Next concrete action:
scaffold the Bun-workspace monorepo (`apps/api` with Hono + `wrangler`, and
`packages/schema`, plus a stubbed `packages/engine`) and get `/health` deploying green — see
`workstreams/backend-data.md` §8, milestone 1.

## Status by workstream
| Workstream | Phase | Status |
|---|---|---|
| backend-data | P1 | 📋 Specced — not started |
| deck-builder | P2 | 📋 Specced + code-mapped (`workstreams/deck-builder.md`) — blocked on P1 |
| simulator | P3 | 📋 Ruleset ready (`reference/ptcg-rules.md`); engine not started |
| online | P4 | 📋 Specced — blocked on P3 |
| polish | P5 | 📝 Backlog |

Legend: 📝 backlog · 📋 specced · 🔎 research · 🚧 in progress · ✅ done

## Session log
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
