# Decisions & Locked Assumptions

## Product / architecture decisions
| # | Decision | Choice |
|---|---|---|
| D1 | Backend data strategy | Own DB — ingest tcgdex → Cloudflare D1, serve our own API |
| D2 | Accounts & persistence | Full accounts + auth; users own their decks |
| D2a | Auth methods | Email + password **and** social OAuth (Discord + Google) |
| D3 | Catalog scope | Full-history-capable schema, ingest SV-era first |
| D4 | Card images | Mirror into R2, serve from our domain |
| D5 | Card type | Unify — one canonical `Card`; builder/playmat are view projections |
| D6 | Online lobby server | In scope — real Durable Object (WebSocket) lobby |
| D7 | Game engine placement | Separate **`packages/engine`** (pure logic) — imported by both `apps/web` (local play) and `apps/api` (authoritative DO). *Why: the engine runs in two runtimes; an app can't import another app.* |
| D8 | Card-effect modeling | **Composable, data-driven op programs** over shared archetype templates (not per-card functions); engine emits **semantic events** consumed by the animation layer. *Why: cards are minor variations on a few archetypes; keeps authoring + animation cheap. Detail in `workstreams/simulator.md`.* |
| D9 | Image mirroring & ingest execution (refines D4/§3.4) | Images mirror into R2 **lazily** — a Worker route (`GET /assets/…`) serves from R2 and on miss fetches tcgdex origin, stores, streams; catalog rows keep tcgdex **origin** URLs. Card-data backfill runs as a **local Bun script** applying batched upsert SQL via `wrangler d1 execute`; a future cron does small in-Worker deltas only. *Why: a full SV backfill is ~10k images — over Worker subrequest limits in one shot and hours of CLI puts; cache-aside mirrors exactly what's viewed and stays within limits.* (2026-07-09) |

## Locked assumptions (override explicitly if they change)
- Bun-workspace monorepo; API + Lobby DO on Cloudflare **Workers** via `wrangler`.
- **Hono** + **Zod**; **Drizzle** over D1. Ingest uses **plain REST fetch +
  our Zod schemas** — the official `@tcgdex/sdk` turned out unnecessary since
  we validate every payload ourselves anyway (changed 2026-07-09, was: SDK).
- Server **sessions** (http-only cookie), not stateless JWT.
- Ingest filters to SV-era but writes the full-history schema.
- attacks/weaknesses/resistances stored as JSON columns for now (promote to
  child tables only if we need to query inside them).
- English (`en`) first; schema leaves room for i18n later.
- The **match engine (P3)** is the actual gameplay; approximate at first,
  improved iteratively.

## These are defaults, not law
Every decision and assumption here is a **default with a rationale**, chosen with
the context available at the time — revisit any of them when the code or new
context reveals a better path. The point of writing them down is to preserve the
*why*, so a later session can judge whether it still holds.

## Adding / changing a decision
Append a row (or a dated subsection for bigger ones) with the choice **and the
one-line why**. When you revise an existing decision, update its row and note
what changed and why. The one hard rule: **don't reverse a decision silently** —
leave a trail so the reasoning is never lost.
