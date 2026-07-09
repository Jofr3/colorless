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
| `subtypes[]` | derived kinds (`cardMatchesCategories`) | EX/Mega are **name regex**, not data |
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
17. **Persist order/structure:** add an `order`/position field to the schema;
    persist reorder + nest moves (`applyReorder`/`previewOrder` are in-memory
    only today).
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
