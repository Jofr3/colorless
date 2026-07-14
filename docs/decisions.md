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
| D10 | M9 catalog search shape (refines D5/§6) | `CardBrief` **extended** with `types/hp/regulationMark/stage/trainerType/energyType` (card-table columns only — **no set join**, so no `setName`); `GET /cards` gains **repeatable `type`/`rarity`** (OR within a dimension) and **`sort=name\|hp-desc\|set`**; KV cache keys version-prefixed (`catalog:v2:`) so a shape change can't serve stale briefs. The builder consumes briefs through one adapter (`src/features/builder/catalog.ts` — accented `"Pokémon"`, stage/trainerType/energyType → the single `subtype`). *Why: the grid/filters/deck-math need those fields per tile; per-tile full-Card fetches or a fixture pool were the alternatives.* (2026-07-13) |
| D11 | M9 scope trims (pending P2) | **Kinds** (`subtypes`) filter stays a client-side per-page heuristic (server can't express OR across stage/trainerType; EX/Mega are name-regexes until structured data — P2 tasks 8-9). **Manual deck/folder reorder is session-only** (no position field in the schema — P2 task 17). **Folder delete keeps the lift-up UX client-side** (child PATCHes before DELETE) over the server's cascade semantics. **`RARITIES` is a hardcoded tcgdex vocabulary snapshot** in the rail. *Why: each would widen M9's already-large surface; all four are logged with their fixes in `workstreams/deck-builder.md`.* (2026-07-13) **Revised 2026-07-14 (P2-M1):** kinds now filter **server-side** (repeatable `stage`/`trainerType`/`energyType`) — only EX/Mega remain a client-side name-regex post-filter (tcgdex `suffix` not persisted; follow-up logged); hardcoded vocabularies replaced by **`GET /facets`**. Reorder (task 17) and lift-up remain as decided. **Revised again 2026-07-14 (task 17):** reorder is now persisted — see D13; only the lift-up trim still stands. |
| D12 | P2-M1 catalog surface & legality source of truth | `GET /cards` gains **repeatable `id`** (≤100, deck hydration in ONE call; chunked IN + in-memory ordering twin of the SQL sort), **`nameExact`** (case-insensitive whole-name equality), `serie`, `illustrator`, `text` (LIKE over ability/attack JSON), plus the kind params above; **`GET /facets`** serves the filter vocabularies (7 DISTINCTs, one db.batch, KV-cached). `CardBrief` += **`legal {standard,expanded}`**; KV namespace → **`catalog:v3:`**, with KV **bypassed** for >512-byte keys and any `?id=` request (per-deck id sets never recur — caching them is pure write waste). Web: **`Format.legalFlag`** keys BOTH the `legalOnly` filter (`legal=<flag>`) and `isLegalInFormat` (structured verdict beats printed mark; mark check only for legal-less fixtures) — one legality definition for grid + validator. Deck rules: **Radiant = 1 per deck total** (like ACE SPEC; official rule), Prism Star = 1 per name. *Why: filters needed server truth for correct totals; hydration was an N-request fan-out; legality had two disagreeing definitions.* (2026-07-14) |
| D13 | Manual-order persistence model (P2 task 17) | `position` INTEGER on `decks` and `folders` — **global per user, not per folder**: the web grid's flat array (position-ascending) IS the manual order, per-view filtering preserves relative order, and a nest move keeps the row's slot (folderId changes, position doesn't) — exactly the client's existing semantics. Creates take **min−1** (new rows prepend); migration 0003 backfills existing rows in the old name-order so nothing visibly moves. A reorder permutes the in-view rows **among their own slots' position values** (`applyReorder` returns the rewritten array + the changed `{id, position}` pairs) and persists via **`POST /decks/reorder` / `/folders/reorder`** — absolute assignments, ≤500 rows, applied atomically in one db.batch; unknown/foreign ids → 400 naming them; failure recovery is **resync**, not per-row rollback (the folder-delete precedent). Reorder deliberately does NOT bump `updated`. *Why: slot-permutation keeps payloads at the size of the move (not the scope), needs no renumbering pass ever, and one atomic endpoint beats N racing PATCHes.* (2026-07-14) |

| D14 | Engine core contract (P3-M1) | **`applyAction(state, action) → {ok:true, state, events} | {ok:false, error}`** — one reducer, never throws, never mutates. `GameState` is plain JSON (the mulberry32 `rngState` lives **inside** it, so same seed + same actions replay identically); card instances are **uids** (`"p1#0"`) over an injected `cardPool` carried in the state (keeps `applyAction` a pure 2-arg pair and snapshots self-contained). Seats **`p1`/`p2` are labels, not turn order** — the coin winner *chooses* first via an action, `firstPlayer` records it. **Choices are actions; mandatory steps auto-resolve** inside the reducer (mulligan redraws, prize setting, the turn-start draw), so a `Phase` exists only where a player owes a decision. **Events are the animation + wire contract** (semantic, serializable, payloads always copied — never aliasing state or the caller's action). **Wire-safety:** TS types are not input validation — P4 decodes actions from clients, so every index/seat/count an action carries is runtime-checked (three real card-destroying bugs came from exactly this: a JSON string `"1"` bench index). *Why: the engine runs in two runtimes (web local play + the authoritative DO), and an authoritative server needs a total, replayable, non-throwing function of (state, action).* (2026-07-14) |
| D15 | Mulligan compensation (rules correction) | Each player may draw 1 card **per opponent mulligan**, and **mulliganing yourself does not forfeit it** — so **both** seats can be owed at once (each off the other's count). `reference/ptcg-rules.md` §3.5 previously read "the non-mulliganing player", which the M1 engine implemented as an exemption that does not exist; the reference doc is corrected and the phase now carries a per-seat `owed`/`decided` map. The compensation draw is **clamped** so a player can never draw below the 6 cards they must still set aside as prizes. *Why: a wrong rule in the spec propagated straight into the engine — the reference doc is the source of truth and had to be fixed at the source.* (2026-07-14) |

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
