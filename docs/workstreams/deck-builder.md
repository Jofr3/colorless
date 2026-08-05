# Workstream: Deck Builder & Decks List (Phase 2)

Goal: replace the fixture card pool with the live catalog API, upgrade the
filters using the richer tcgdex fields, and complete the deck **editor** and the
**decks list** with real persistence.

**Depends on:** P1 catalog API (`GET /cards|sets|series`) + decks/folders API +
R2 image URLs. See `workstreams/backend-data.md`.

---

## Current state (code map)

### Deck builder — `src/features/builder/`
- **Shell:** route `/decks/:deckId/edit` → `DeckBuilder.tsx` remounts
  `DeckBuilderInner` keyed on `deckId`; seed name arrives via router
  `location.state.name`.
- **In-memory deck:** a `Map<string, number>` (`entries`: cardId → qty), derived
  to an ordered `Deck` (`DeckEntry[]`, `deckMath.ts`) by looking ids up in
  `POOL_BY_ID` (built from `CARD_POOL`). **Cards unknown to the pool are silently
  dropped** — a structural problem once the pool is a paginated search.
- **Mutations:** `addCard` (guarded by `remainingAllowedFor`), `removeCard`,
  `clearDeck`, `importText`; also via drag (`useCardDrag`) and click/right-click
  in `CardGrid`/`DeckPanel`. Each fires an a11y `announce` + a `pulse` nonce.
- **Persistence:** per-deck localStorage key `builder.deck.<deckId>` holding
  `StoredDeck {name, formatId, cards:[cardId,qty][]}`; debounced 300 ms write +
  flush-on-unmount. Uses `src/lib/persistedState.ts`.

### Filters — `poolFilter.ts` + `components/FilterRail.tsx`
`Filters = { query, supertype, types[], subtypes[], rarities[], legalOnly, sort }`.
`filterPool` = `matches()` then `compare()`; dimensions AND-ed, multi-selects OR.

| Filter | Card field | Notes |
|---|---|---|
| `query` | `name` + `setName` + `cardId` | case-insensitive substring |
| `supertype` | `supertype` | equality (`all` = off) |
| `types[]` | `types` | any-of; untyped Trainers drop out |
| `subtypes[]` | derived kinds (`cardMatchesCategories`) | EX/Mega were **name regex**, not data (both gone — D198) |
| `rarities[]` | `rarity` | any-of over `RARITIES` |
| `legalOnly` | `regulationMark` vs `format.legalRegulationMarks` | only bites when format restricts marks |
| `sort` | `name` / `hp-desc` / `set` | not a filter |

### Card pool & images
- `CARD_POOL` = **90 hand-authored SV-era cards** in `cardPool.ts`, typed by
  `BuilderCard` (`cards.ts`): `cardId, name, supertype, subtype, types?, hp?,
  regulationMark?, rarity?, setName?, number?`. **No effect/attack/illustrator/
  weakness data.**
- Art: `cardImageUrl(cardId,size)` → `images.scrydex.com` (hotlinked), rendered
  by `src/components/CardImage.tsx` with a 404/CORS fallback tile. CSP
  (`vite.config.ts`) allowlists only `images.scrydex.com`.
- Fixtures/placeholders: `cardPool.ts`, `decks/data.ts` (`SEED_*`), and the
  decks-list covers (`CardBackStack.tsx` — a generic tinted card back, never the
  deck's real cards).

### Deck math — `deckMath.ts`
`validateDeck` enforces: over-size (error), under-size (warning), >`maxCopiesByName`
(error; exempts basic Energy & ACE SPEC), `minBasicPokemon` (error), ACE SPEC
limit (error), out-of-format regulation mark (error). `legal = complete && no
errors`. **Gaps:** ACE SPEC/EX/Mega from rarity/name strings not structured data;
no Radiant/Prism-Star single-copy rules; uses printed mark, not tcgdex
`legal.standard/expanded`; no ban list.

### Import/export — `decklistText.ts` + `ImportExportDialog.tsx`
`parseDecklist` is a tolerant PTCG-Live/Limitless parser matching **by name only**
against the in-memory pool (retries stripping trailing `SET NUM`); reports
`unmatched`. `formatDecklist` produces canonical grouped output. **No id-based
matching**; unmatched lines aren't added.

### Decks list — `decks/Decks.tsx`
- Model (`decks/data.ts`): `Deck {id,name,folderId,cardCount,tint}`,
  `Folder {id,name,parentId}`. `cardCount` is a **static seed**, not derived.
- CRUD: `handleNewDeck`/`handleNewFolder`, `commitDeck/commitFolder` (rename),
  `deleteDeck`, `deleteFolder` (re-parents children up one level). Open →
  `navigate('/decks/:id/edit',{state:{name}})`.
- Folder tree (`tree.ts`): infinite nesting; `canDrop` blocks cycles. Drag/reorder
  via `useDeckDrag.ts` + `reorder.ts` + FLIP (`useFlip.ts`) + full keyboard path
  (`useKeyboardMove.ts` + `MoveBanner.tsx`).
- **Biggest gap — no persistence of data:** only filter/sort UI state is saved
  (`decks.filterOpen|showFilter|sortKey`). Decks & folders reset to `SEED_*` on
  every mount, so create/rename/move/delete vanish on refresh. Also: list deck
  ids and the builder's `builder.deck.<id>` store are **disconnected**, and
  `cardCount` never reflects real contents.

---

## P2-M1 status (2026-07-14) — filters, panel stats, legality + backlog fold-in

A four-slice session (api params/facets → backlog cleanup → richer filters →
panel/legality) closed most of what M9 left open. As-built:
- ✅ Tasks 8–10: `Filters` gained setId/serieId/illustrator/regulationMark/
  hpMin/hpMax/text; kinds (stage/trainerType/energyType) filter **server-side**
  with correct totals; options come from `GET /facets` + `/sets` + `/series`
  via `useCatalogOptions` (`catalogOptions.ts`, session-cached, all-or-nothing
  + retry). Hardcoded vocabularies deleted (`RARITIES`, stage/trainer/energy
  subtype consts) — test fixtures live in `src/test/fixtures.ts`.
  ~~**Client-side remainder: EX/Mega only**~~ — **GONE (D198).** See the
  rule-box entry below; `filterVisibleCards`, `DERIVED_KINDS` and CardGrid's
  `loadedCount` prop went with it, and NO dimension is filtered after paging
  any more.
- ✅ Task 12: `DeckStats` in `DeckPanel.tsx` — per-supertype counts + the
  type-distribution bar (ENERGY_TYPE_META palette, sr-only text alt).
  Pending/unavailable entries are excluded from both figures.
- ✅ Task 13: `Format.legalFlag` ("standard"/"expanded") drives BOTH
  `isLegalInFormat` (structured `card.legal` verdict beats the printed mark;
  mark check only for legal-less fixtures) and the `legalOnly` filter
  (`legal=<flag>` param) — grid and validator now agree. Radiant = 1 per deck
  total (official rule; supersedes per-name cap), Prism Star = 1 per name,
  ACE SPEC unchanged (rarity string verified: "ACE SPEC Rare").
- ✅ M9 review backlog: all items fixed (correctness + cleanup — see the
  2026-07-14 progress.md entry) — with one correction from the 2026-08-04
  re-verification: the `stage: null` item was ACCEPTED, not fixed (see the
  note on that list below). Deck hydration is now ONE batched
  `GET /cards?id=…` round (`cardStore.ts`); import matching uses `nameExact`
  (layered: stripped key → raw name → substring fallback).
- ✅ Task 17 (2026-07-14, same-day follow-up session): manual order persists —
  `position` on decks + folders (D13: global per-user slots, min−1 prepend,
  slot-permutation reorder), bulk `POST /decks/reorder` + `/folders/reorder`,
  web `applyReorder` returns the changed pairs and `Decks.tsx` persists them
  (failure → pill + resync). Migration 0003 backfills name-order. **All 19
  numbered tasks are now closed** — only the follow-ups below remain.

### P2-M1 follow-ups (verified review findings deliberately deferred)
> **Re-triaged 2026-08-04 — D195.** Every item below was re-checked against
> the code (the July text had rotted in places). Two were fixed here; the four
> that remain from the July list ALL live in `apps/api` (ingest, catalog
> query) and none of them is fixable — or even observable — from `src/`. One
> item was PROMOTED here out of the "resolved" M9 backlog, where it had been
> recorded as fixed but was only accepted.

- ~~**Persist tcgdex `suffix` at ingest**~~ **— CLOSED (column D197, filter +
  web D198).** `cards.suffix` (migration `0006`), `CatalogFacets.suffixes`,
  `GET /cards?suffix=` (repeatable), and a **Rule box** rail section fed by the
  facet vocabulary. The client fallback is deleted outright, and the census
  says it was worse than recorded: `/\bex\b/i` matched **627 of 3,786** rows
  and thinned them AFTER the server had paged and counted them — the recorded
  near-empty page — while `/\bmega\b/i` matched **0**, i.e. one of the two
  chips was already a dead chip returning an empty grid with no signal why.
  ⚠️ **The chips are gone until an ingest fills the column**: the vocabulary is
  the data, so `suffixes: []` renders no section. That is a deliberate,
  temporary loss of the EX filter, traded for a filter that cannot lie — and it
  is dischargeable by one command (`cd apps/api && bun scripts/ingest.ts
  --remote`, after `bun run db:migrate:remote`; `api.tcgdex.net` is still
  blocked here). Kind chips and rule-box chips are separate DIMENSIONS: the
  server ANDs across them ("a Basic that is also an ex") where the one-dimension
  fallback OR-ed.
- **`compareCardRows` is a JS twin of the SQL ORDER BY** —
  **STILL REAL, and the path rotted: it is `apps/api/src/catalog/query.ts`**,
  not `apps/api/src/query.ts`
  (`cardsOrder` = the SQL spec, `compareCardRows` = the JS twin, both in that
  file; the in-memory sort fires at `apps/api/src/catalog/routes.ts`, on the
  id-hydration path only). Checked from the web side by D195: **nothing about
  the divergence is visible or fixable from `src/`** — the client picks one of
  `name|hp-desc|set` and consumes whatever row order the api returns, so the
  two sorts can only disagree server-side. Unify into one declarative sort
  spec (or a final in-SQL ORDER BY over the ≤100-row id set) before adding
  sort options; an api slice, not a web one.
- ~~**Facets bundle is all-or-nothing** (`useCatalogOptions` Promise.all): one
  /series hiccup blanks the whole rail vocabulary.~~
  **FIXED 2026-08-04 — D195.** The Promise.all became three independent
  session slots (value + in-flight promise + never-cached failure, one per
  endpoint). A failed resource now costs only its own dimensions: a dead
  `/series` leaves the rarity/mark/illustrator chips and the set select fully
  usable. `CatalogOptions` is unchanged for callers — `status` became an
  AGGREGATE (loading if any is in flight, else error if any failed), which is
  what the rail's single spinner and single Retry want — and `retry` now
  re-fetches only the slots that are still missing. The per-dimension
  degradation needed no FilterRail change at all: its sections were already
  guarded on "is this list non-empty", so not blanking the data was the whole
  fix. Covered in `catalogOptions.dom.test.tsx` (three rounds: all fail →
  partial → the retry that hits only `/series`) and one FilterRail case.
- ~~**Dual legality mechanisms**: `legalRegulationMarks` survives only as the
  fixture fallback; consider a fixture factory that derives `legal` and delete
  the mark list (rotation updates must currently touch both).~~
  **CLOSED 2026-08-04 — D191.** The fallback was unreachable from production
  (`legal` is required on the wire and `toBuilderCard` is the only production
  constructor), so it was deleted rather than unified: `BuilderCard.legal` is
  now REQUIRED, `Format.legalRegulationMarks` is gone, and the mark→verdict
  derivation lives once in `builderCard()`/`STANDARD_LEGAL_MARKS`
  (`src/test/fixtures.ts`) for hand-built fixtures. A rotation is now zero
  production sites (it arrives as data) and one fixture site, pinned by the
  measured census in `src/test/legality.test.ts`.
- ~~**Ingest: `regulation_mark` can be the literal string `"None"`**~~ — FIXED
  api-side (D194), and the scope was BIGGER than reported: the sweep found the
  same sentinel in `cards.rarity` too, on all **34** rows of the `mfb` set
  (`regulation_mark` was only 2 of them), so the rail had **two** dead chips,
  not one. `apps/api/src/sentinel.ts` normalises `"None"`/`""` → NULL on both
  the ingest write and the catalog read, and the KV cache prefix bumped
  `v3`→`v4` so the stale `/facets` body can't outlive the deploy. Nothing to do
  here: the rail already hides a section whose facet list is empty and renders
  one chip per value, so dropping the value drops the chip. See
  `docs/workstreams/backend-data.md` §5.3.1 for the sweep table and the
  re-ingest command that clears the sentinel from D1 itself.
- ~~**401-recovery is gated by a `/auth/` path-prefix exclusion** (api.ts);
  per-request opt-out would express intent at the call site.~~
  **FIXED 2026-08-04 — D195.** `request()` takes `recoverSession: false` and
  the five `/auth` callers pass it; the `path.startsWith("/auth/")` sniff is
  gone. Behaviour is identical (that was the point — the prefix and the call
  sites agreed exactly), but the rule is now declared where the reason lives,
  a route added under `/auth` no longer has the policy decided for it, and the
  reverse case (a non-`/auth` route that must NOT re-probe) is expressible.
- **`text` search** covers ability/attack JSON only (Trainer/Energy `effect`
  out of scope; JSON-key over-match documented in the api).
  **STILL REAL — `apps/api`.** Confirmed 2026-08-04: the `text` predicate
  LIKEs `cards.abilities_json` and `cards.attacks_json` and nothing else
  (`apps/api/src/catalog/query.ts`). The web side is already honest about it
  — the rail's section label is "Ability/attack text" and `CardsQuery.text`
  documents the gap — so widening it is purely an api change (an `effect`
  column in the LIKE set, or a search index).
- **Ingest data caveat**: cards whose upstream `legal` is missing ingest as
  false/false — with `legalOnly` default-on they're hidden from the grid by
  default; fine for the SV-era catalog, revisit if older sets get ingested.
  **STILL REAL — `apps/api` (ingest).** Unchanged since July.
- **`stage: null` Pokémon → `subtype: ""`** (`catalog.ts subtypeOf`) —
  promoted here 2026-08-04 (D195) from the M9 list, which recorded it as
  fixed. It was ACCEPTED, not fixed: neither half of "decide a mapping or
  validate at ingest" landed. Such a card matches no kind chip and counts as
  a non-Basic in `validateDeck`'s `minBasicPokemon`. Latent only because no
  such row has been observed in the SV-era catalog — `cards.stage` is plain
  nullable text and ingest only sentinel-normalises it. Deciding the mapping
  is a web change; guaranteeing the column is an api one.

---

## M9 status (2026-07-13) — what the P1 frontend swap already covered

M9 landed a large chunk of this plan; the code map above predates it (the
biggest shifts: `cardPool.ts` is GONE — the pool is `useCardSearch` +
`src/features/builder/catalog.ts` (adapter) + `cardStore.ts` (by-id session
store); decks/folders/deck-contents live on the server; auth gates both pages).
- ✅ Task 1 (api client `src/lib/api.ts` — env var is `VITE_API_ORIGIN`),
  3 (art via `/assets/cards/{id}`, CSP swapped), 4 (paginated
  `useCardSearch`, load-more), 6 (deck ids fetch via `GET /cards/:id` —
  silent-drop fixed), 7 (server-matched import), 11 (deck load + debounced
  PATCH via `deckSaver`/`useDeckSaver`), 14 (list shows server-derived
  `cardCount`), 15 (decks/folders CRUD, optimistic + rollback), 16 (one id
  everywhere, server-minted), 18 (auth-gated loading/empty/error states).
- 🚧 Task 2 partial (`CardBrief` extended with types/hp/regulationMark/stage/
  trainerType/energyType — D10; abilities/attacks/etc. still only on full
  `Card`), 5 partial (`filtersToCardsQuery` exists; our API takes repeatable
  params + `sort`, NOT tcgdex `like:`-prefix syntax — the doc's original
  param sketch is obsolete), 19 partial (suite 528 green, fetch-stub style
  established per-file).
- 📋 Untouched: 8–10 (richer filters/real fields/API-fed options), 12
  (counts/type bar), 13 (structured legality in validateDeck), 17 (position
  field for manual order — see D11).

### M9 review backlog (verified findings deferred out of M9)
> **RESOLVED 2026-07-14 (P2-M1)** — every item below was fixed; kept for the
> record only. See the P2-M1 section above for what replaced it.
>
> **Re-verified 2026-08-04 — D195**, item by item against the code, because
> this file's structural claims have rotted before. The list is honest: all
> eight correctness items and every cleanup item have a named owner in the
> tree — the rollback guard is `patchWithRollback` in `Decks.tsx` (it rolls
> back only `item[field] === value`, i.e. only while the field still holds
> THIS edit); the transient-hydration retry is `cardStore.ts`'s per-id capped
> backoff plus the `liveHydrators` re-arm; import matching is `nameExact` in
> `catalog.ts findCardByName`; the /decks failure surface is a `role="alert"`
> `TransientErrorPill` keyed on a nonce so a repeat re-announces; the loading
> states are `StatusPanel`/`StatusSpinner` (`<output aria-busy>`); and the
> library load, the optimistic recipe, `unknownCardIdsOf` and the status
> panels each live in the single owner the item asked for.
>
> **One correction to the blanket "every item was fixed": the `stage: null`
> item was ACCEPTED, not fixed.** `subtypeOf` (`catalog.ts`) still maps such a
> Pokémon to `subtype: ""`, and neither branch of its proposed fix landed —
> `cards.stage` is plain nullable text in D1 (`apps/api/src/db/catalog.ts`)
> and ingest only sentinel-normalises it (`ingest/map.ts`), so nothing
> validates the column. It stays latent because no such row has been observed
> in the SV-era catalog, not because it was closed: one would match no
> kind chip and count as a non-Basic in `validateDeck`'s `minBasicPokemon`.
> Deciding the mapping is a web change; guaranteeing the column isn't.
> Everything else on the list is genuinely closed.

Correctness (all mechanism-confirmed; triggers need scale/drift/timing):
- **Stale-snapshot rollback can clobber a newer successful edit** —
  `commitDeck`/`commitFolder`/`moveDeck`/`moveFolder` (`Decks.tsx`) restore
  the pre-PATCH value unconditionally; fix falls out of the
  optimistic-helper dedup below (guard: only roll back if current === optimistic).
- **`legalOnly` (server `legal.standard` flag) vs `validateDeck` (client
  `['H','I','J']` marks) can disagree** → P2 task 13 (one source of truth).
- **`stage: null` Pokémon maps to `subtype ""`** (`catalog.ts subtypeOf`) —
  breaks `isBasicPokemon`/kind chips if such data ever ships; decide a
  mapping or validate at ingest.
- **`findCardByName` checks only the first 100 substring matches** — exact
  name can miss once the catalog is large; needs paging or an exact-name param.
- **Transient (non-404) hydration failures never self-retry** on an idle
  builder (`cardStore.ts`) — entries shimmer until an unrelated change.
- **404-known deck entries have no removal affordance** (inert pending tile;
  Clear is disabled when nothing hydrated) — only reachable after
  out-of-band catalog drift (FK RESTRICT protects normal flows).
- **Mutation-failure feedback on /decks is `sr-only`** and `syncMessage`
  never clears (an identical repeat isn't re-announced) — needs a visible,
  re-announcing surface.
- **Loading states hang `aria-label` on role-less divs** (builder, decks,
  picker) — use `role="status"`/`aria-busy`.

Cleanup / altitude (each names its fix):
- 401→`refresh()` hand-rolled at 6 sites → one owner (api-client hook or
  AuthProvider-registered observer).
- Library-load effect ×3 (Decks, resync, DeckPicker) → `useDeckLibrary`.
- Optimistic-mutation recipe ×4 → generic `patchWithRollback` helper.
- Folder-delete lift-up policy lives in a component → data-layer helper (or
  a server `?strategy=lift`); the PATCHes could be `Promise.all`ed (the
  serialization was deliberate — see the code comment — but resync makes
  parallel safe).
- Deck hydration = N× `GET /cards/:id` → repeatable `?id=` filter on
  `GET /cards` (the multiParam machinery is already there).
- `RARITIES` hardcoded vocabulary → shared enum in `@luminous/schema` or a
  facets endpoint (P2 task 10).
- Kinds → server params for the stage/trainerType/energyType kinds (P2 tasks
  8–9); the client-side gap forced `loadedCount`/`total` caption plumbing
  into CardGrid.
- CSP origin derivation duplicated (`vite.config.ts` vs `apiOrigin.ts`; the
  config CAN'T import it — `import.meta.env`) → tiny env-free shared module.
- Test plumbing (json/stubFetch/USER/jsdom shims) copied across ~7 files →
  one `src/test/` helper.
- Status-panel JSX ×5 (builder ×3, Decks, picker) → shared `StatusPanel`.
- `unknownCardIdsOf` (400 body parser) in `DeckBuilder.tsx` → next to
  `ApiError` in `src/lib/api.ts`.
- Input/error-red Tailwind recipes re-declared ×5–6 → `glass.ts` constants;
  `AccountButton` corner literals ×3 (+SettingsButton's copy) → shared consts.
- `useDeckSaver` options object rebuilt every render (initial re-sorted per
  render; `initialEntries` computed twice at mount) → memoize.

---

## Task list (ordered)

### Phase 0 — Seams & shared types (do first)
1. **Typed API client** `src/lib/api.ts`: `getCards(params)`, `getCard(id)`,
   `getSets`, `getSeries`, decks/folders CRUD. Base URL from
   `import.meta.env.VITE_API_URL`.
2. **Extend the canonical `Card`** (per D5) / `BuilderCard` with the richer API
   fields: `illustrator`, `abilities`/`attacks` (name+text+cost),
   `weaknesses`/`resistances`, `retreat`, `serie`, structured
   `legal {standard,expanded}`, and a stable `image` URL. Prefer structured
   fields over the name/rarity regexes.
3. **Route art through the API model:** replace `cardImageUrl` Scrydex hotlink
   with the card's R2 `image` URL; keep `CardImage.tsx`'s fallback; update the
   CSP (swap `images.scrydex.com` for the R2 + API origins).

### (a) Swap fixture pool → catalog API
4. Replace static `CARD_POOL`/`POOL_BY_ID` with a **paginated search hook**
   (`useCardSearch(filters)` → `GET /cards`); move name/types/hp/rarity/set/mark
   filtering server-side.
5. Make `poolFilter.ts` a **query-param builder** (tcgdex prefixes
   `eq:`/`like:`/`gte:`/`lte:`, `field=A|B`, `pagination:*`, `sort:*`); keep the
   pure local version for tests/optimistic UX. Add infinite-scroll to
   `CardGrid.tsx`.
6. **Decouple deck lookups from a loaded pool:** fetch full records for a deck's
   ids via batched `GET /cards/:id` so a saved deck renders even when its cards
   aren't in the current page (fixes the silent-drop problem).
7. **Server-backed import matching:** `parseDecklist` resolves names/ids via
   `GET /cards?name=…` against the full catalog, not the current page.

### (b) Richer filters (tcgdex fields)
8. Add filter dimensions to `Filters` + `FilterRail.tsx`: **set & serie**, **HP
   range** (min/max), **illustrator**, explicit **regulation-mark** picker, and
   **ability/attack text search** (new effect/attack fields). Optional:
   energy-cost / retreat filters.
9. Replace derived rarity/kind **heuristics** with real fields (EX/Mega/ACE SPEC
   from structured `suffix`/`subtype`/`category`, not name/rarity regex).
   *(EX/Mega done — D198 wired the kind chips to `?suffix=`. ACE SPEC still
   reads `rarity`, and Radiant/Prism Star still read the NAME — deliberately:
   the game defines those two BY the name, so the name check is the structured
   detection, not a stand-in. See `cards.ts`.)*
10. Populate select options from the API (`/rarities`, `/types`, `/sets`,
    `/series`, `/illustrators`) instead of hardcoded constants.

### (c) Complete the deck editor
11. **Point builder persistence at the API:** `GET /decks/:id` on load, debounced
    `PATCH /decks/:id` on change; keep `persistedState` as an offline/optimistic
    cache. Remove the dual-storage disconnect (→ task 16).
12. Surface counts & validation: add per-supertype counts (`countsBySupertype`)
    and the **type-distribution bar** (`pokemonTypeDistribution` is computed but
    unused) to `DeckPanel.tsx`.
13. Harden `validateDeck` for real data: use structured `legal.standard/expanded`;
    add Radiant/Prism-Star single-copy rules + any ban/restricted list the API
    exposes; keep ACE SPEC / basic-Energy exemptions.
14. On save, **write back `cardCount`** so the decks list reflects real size.

### (d) Complete the decks list
15. **Persist decks & folders** (the biggest gap): `GET /decks` + `GET /folders`;
    route every mutation through the API (create/rename/move/delete/reorder) with
    optimistic updates so drag/FLIP stays snappy.
16. **Unify deck identity:** make the list `Deck.id` the same id the builder
    persists under; `deleteDeck` also deletes contents server-side (removes
    today's orphaned `builder.deck.<id>`).
17. ~~**Persist order/structure:** add an `order`/position field to the schema;
    persist reorder + nest moves (`applyReorder`/`previewOrder` are in-memory
    only today).~~ ✅ 2026-07-14 — see D13 and the P2-M1 status above.
18. Add **auth-gated loading/empty/error states** to `Decks.tsx` and
    `DeckBuilder.tsx` (the API needs a session; today both assume sync fixtures).

### Cross-cutting
19. Update tests (`poolFilter.test.ts`, `deckMath.test.ts`, `decklistText.test.ts`,
    `Decks.dom.test.tsx`, `FilterRail.dom.test.tsx`) to mock the API client and
    cover the new filter params, server-import matching, and persistence.

---

## Sequencing note
Phase 0 (1–3) unblocks everything. (a) and (b) can proceed together against the
catalog API; (c) and (d) need the decks/folders API + auth from P1. A good first
slice: **API client + card search + infinite scroll** (tasks 1,4,5) so the
builder shows real cards, then filters (8–10), then persistence (11,15,16).
