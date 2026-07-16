# Progress — living status

> Update this at the **end of every session**: bump the status table, append a
> session-log entry, and rewrite the **Resume point** to the next concrete action.

**Last updated:** 2026-07-16 — build session #4 (**P3-M2: attacks/KO/prizes +
the engine→playmat projection**, built + xhigh-reviewed + all confirmed
findings fixed + committed `e7e7efa`; **api DEPLOYED** this session after the
user ran the gated command — version `9b1ec1d1`).

## Resume point
**P3-M2 is done and committed (`e7e7efa`): attacks, KO + prizes, win check
(D16) and the per-viewer engine→playmat projection (D17,
`src/features/game/projection.ts`).** Suite 683 → 751, `bun run check` green.
**The api is deployed** (Worker `9b1ec1d1`; migration 0003 was ALREADY
applied remotely — "No migrations to apply" — so only the Worker was behind).
Prod smoke FULLY green (write smoke user-authorized): `/health` ok, `/cards`
serving, `/decks` session-gated; creates carry `position` (min−1 prepend),
list is position-ascending, foreign-id reorder → 400 naming the id, legit
reorder → 204 + persists + does NOT bump `updated` (all per D13). Throwaway
decks deleted after; the smoke account `smoke-20260716-m2@example.com`
remains (no delete-user endpoint).
Next concrete actions:
1. **Wire the projection into a playable local game page** — the playmat
   still renders `mockPlaymat.ts`; the natural slice is a page holding
   `GameState`, dispatching `applyAction`, rendering `projectGameState`
   (consumption sketch in the projection module; gate input on `waitingOn`,
   not `activePlayer` — see D17). Integration seams listed under
   "Projection deferrals" in `workstreams/simulator.md`.
2. Or **P3-M3 (status conditions + Pokémon Checkup)** — read "M2 as built"
   in `workstreams/simulator.md` first: `runCheckup` is a stub but the
   interrupt machinery is ready; lift a shared `knockOut` resolver out of
   the attack handler rather than copying it (the traps list has the rest:
   prizeValueOf=1 pending an ingest suffix column, name-derived energy
   provision, the kept phase↔pending dual encoding).
Unchanged user-side blockers: web prod build/deploy story unset
(`VITE_API_ORIGIN` at build time; CSP derives from it); deployed Worker's
`APP_ORIGIN` still `http://localhost:5173`; OAuth 503 until the
Discord/Google apps + four secrets exist (see 2026-07-13 entry for details).

## Status by workstream
| Workstream | Phase | Status |
|---|---|---|
| backend-data | P1 | ✅ M1–M9 + P2-M1 + task-17 api deployed (Worker `9b1ec1d1`, 2026-07-16); OAuth secrets pending (user) |
| deck-builder | P2 | ✅ ALL 19 tasks closed (task 17 landed + e2e-verified locally); only follow-ups left |
| simulator | P3 | 🚧 **M1+M2 done** (core + attacks/KO/prizes/win, D14/D16) + projection adapter (D17) — M3 (status/checkup) next; playmat not yet wired to the engine |
| online | P4 | 📋 Specced — blocked on P3 |
| polish | P5 | 📝 Backlog |

Legend: 📝 backlog · 📋 specced · 🔎 research · 🚧 in progress · ✅ done

## Session log
- **2026-07-16** (build #4) — **P3-M2 (attacks/KO/prizes/win, D16) + the
  engine→playmat projection (D17)**, two parallel build agents then an xhigh
  review (10 finder angles → 9 grouped verifiers → gap sweep; 15 findings
  reported, every confirmed one fixed in-session by two fix agents).
  (A) Engine M2: staged turn tail (`pending` queue + `advance()` in new
  `flow.ts`; `ko:takePrizes`/`ko:promote` park phases, forced picks
  auto-resolve), attack flow (typed costs w/ Colorless wildcards, §4
  first-turn ban, §8.5 weakness→resistance order), KO cleanup via shared
  `discardFromStack`, prize/promotion choice actions, `evaluateWin` →
  `GameOutcome` win/tie. (B) Projection: per-viewer `GameProjection`
  (drop-in playmat `BoardState` + piles/pokemon/waitingOn/pendingDecision/
  outcome), structural hidden-info redaction, uid-keyed animation identity.
  **Review headliners** (the xhigh pass paid a second time): two
  never-throw violations in M1 code the M1 review missed (`attachEnergy`
  `target:null` and retreat `discardEnergy:{length:1}` both THREW out of
  `applyAction` — probe-proven); `energyProvidesOf` misparsing the
  catalog's own "Basic Darkness/Metal Energy" prints → typed attacks
  permanently unpayable; schema-documented `"+20"` additive weakness
  silently applied as ×2 (→ `DamageModifier` model); `hp:0` rows
  instant-KOing undamaged Pokémon; the projection guessing the wrong
  actor during `ko:promote` + surfacing no pending decision/outcome/damage
  (→ the `activePlayer`/`waitingOn` split). Also: `BASIC_ENERGY_TYPES`
  hoisted to `@luminous/schema` (Fairy added; builder derives its palette),
  win-check consolidated into shared resolve-and-resume helpers,
  `turnTail()` extracted, `PHASE_DESYNC` cross-check hardening. Deferred
  (traps list): stable opaque ids for opponent-hand backs (P4 design),
  image-null → card-back mapping (wire-up slice), ingest columns for ex
  suffix / energy provision / weakness normalization. Suite 683 → 751;
  `bun run check` green. **Session traps:** the usage limit killed 7/10
  finders and the engine fixer mid-flight — ALL resumed via SendMessage
  with zero rework (third session this pattern holds). **The api deploy
  permission gate fired for the THIRD session** — the auto classifier
  rejects `db:migrate:remote` unless the user names the deploy explicitly;
  it genuinely needs the user. **Deploy resolution (same session, after the
  user ran the command):** migration 0003 was ALREADY applied remotely (the
  gate had only ever blocked the Worker upload); `bun run deploy` shipped
  Worker `9b1ec1d1`. Read-only prod smoke green (/health, /cards, /decks →
  401); the WRITE smoke was gate-blocked until the user explicitly asked,
  then passed in full: creates carry `position` (min−1 prepend), foreign-id
  reorder → `400 {"error":"unknown deck id(s)","ids":[…]}`, legit reorder →
  204, persisted, `updated` not bumped (D13 verified in prod). Throwaway
  decks deleted; smoke account remains.
- **2026-07-14** (build #3) — **P3 milestone 1: the engine core** (one build
  sub-agent + a 10-angle review). `packages/engine` is now a real engine
  (D14): pure JSON `GameState` with the mulberry32 `rngState` inside it,
  `applyAction → {ok, state, events} | {ok:false, error}` that never throws
  and never mutates, uid card instances over an injected `cardPool`, seats as
  labels (coin winner *chooses* first), choices-are-actions with mandatory
  steps auto-resolving, and semantic events as the animation/wire contract.
  Surface: setup (shuffle, flip, hands, mulligans, compensation, placements,
  prizes), turn loop + mandatory draw + deck-out loss, 1 energy/turn, Basics
  to bench (cap 5), retreat (named energy pays the exact cost), pass.
  Then an **xhigh review (10 finder angles)** — worth the cost, it found real
  bugs the suite was green over:
  (a) **wire-decoded string indices destroyed cards** — `bench["1"]` resolves
  (string key!) so the guard passed, but `i === index` never matched: the
  energy left the hand and attached to *nothing*; retreat's
  `slice(index + 1)` string-concatenated to `slice("11")` and **deleted every
  benched Pokémon** past the promoted slot. (b) an unvalidated `first` seat
  landed in `firstPlayer` and threw inside `startTurn` *several actions
  later*. (c) `applyAction` returned **undefined** for an unknown action type
  — the never-throw contract P4 rests on didn't hold at the wire. Lesson,
  now written into `simulator.md`: **TS types are not input validation.**
  (d) **the mulligan-compensation RULE was wrong** — it paid only a player who
  hadn't mulliganed. Each player draws 1 per *opponent* mulligan and
  mulliganing yourself forfeits nothing, so **both** seats can be owed. The
  error came from `reference/ptcg-rules.md` §3.5 itself ("the non-mulliganing
  player") — **the reference doc was fixed at the source** (D15) and the draw
  is now clamped so nobody can draw below their 6 prizes. (e) event payloads
  **aliased state arrays** (PRIZES_SET *was* the state's prize array) and the
  caller's action arrays; (f) `setupDrawExtra` advanced the phase emitting
  **zero events** (an event-only P4 client would hang on the prompt forever);
  (g) `shuffle` silently skipped swaps, biasing the permutation. All fixed +
  regression-tested. Also folded in: the 4×-duplicated turn gate → one shared
  `turnGate`, create/action errors → one `ErrorCode` union, poison modeled as
  a counter amount (§12) not a bool, `RETREATED` now carries the bench
  re-index (`promotedFrom`/`benchedTo`) so animators don't re-derive it.
  Suite 623 → 683; `bun run check` green; committed `d34146c`.
  **Session traps:** the Fable 5 usage limit killed the build agent mid-flight
  and later 4 of 10 review finders — all resumed from transcript via
  SendMessage with zero rework (same recovery as the 2026-07-14 build #1
  session; this is now a reliable pattern). **The api deploy was blocked by
  the permission gate for the SECOND session running** — it needs the user.
- **2026-07-14** (build #2) — **P2-M1 e2e pass + task 17** (single-agent).
  (A) FilterRail browser-driven end-to-end (agent-browser vs wrangler dev +
  vite): facets-fed vocabularies, server kinds (`stage=Stage2`), the EX/Mega
  mixed-kind client remainder (wire drops the kind dim; "60 of 79 loaded"
  caption; Load more → page 2), text search (`poison` → 8 right cards;
  numbers aren't searched — damage lives outside the text fields), HP bounds
  (+ inverted range → clean empty state), set + serie filters, **real**
  serie→set narrowing (ingested swsh10.5 locally to get a 2nd serie),
  legalOnly toggle, sort=hp-desc, DeckStats, the Radiant add-time guard
  (deckWideRemaining blocks a 2nd Radiant), and structured legality
  ("Radiant Blastoise is not legal in Standard"). **Verdict: PASS, zero app
  bugs.** The "Load more is dead" scare was agent-browser: clicks DON'T
  auto-scroll inner overflow containers (silent no-op), `fill ""` doesn't
  clear — both now in the recreated `.claude/skills/verify/SKILL.md` (the M9
  recipe was lost with a worktree). Real findings: cel25 ingest aborts
  (cel25-17 ability lacks `name` upstream; all-or-nothing by design → logged
  as follow-up); post-ingest /facets|/sets|/series stay KV-stale ≤1h (flush
  recipe in the skill). (B) **Task 17**: `position` INTEGER on decks+folders
  (D13 — global per-user slots; creates take min−1; nest moves keep the
  slot), migration 0003 with name-order backfill, `GET` lists order by it,
  bulk atomic `POST /decks/reorder` + `/folders/reorder` (≤500 absolute
  assignments, foreign id → 400 naming it, `updated` NOT bumped),
  `unknownCardIds`→`unknownIds`, api client `reorderDecks/Folders`, web
  `applyReorder` now returns `{items, changes}` (slot-permutation keeps the
  array position-sorted) and `Decks.tsx` persists via `persistReorder`
  (failure → pill + resync, the folder-delete precedent). E2e-verified:
  keyboard move → 204 → order survives reload (decks AND folders); probe
  400 correct. Suite 607→623; `bun run check` green. **Api deploy pending**
  — `db:migrate:remote` hit the session permission gate; deploy + smoke is
  the resume point. Local D1 now also holds swsh10.5 (88 cards, serie swsh).
- **2026-07-14** (build) — **P2 milestone 1** (four sub-agent slices + 8-angle
  review + fix pass; committed `b983170`, api deployed `05d46657` +
  prod-smoked same session): filters, panel stats, legality, and the
  full M9 backlog. (A) api: `GET /cards` gains repeatable `id` (≤100, one-call
  deck hydration; chunked IN + in-memory ordering twin), `nameExact`,
  repeatable `stage`/`trainerType`/`energyType`, `serie`, `illustrator`,
  `text`; new `GET /facets`; `CardBrief` += `legal`; KV → `catalog:v3:` with
  bypass for >512-byte keys AND any `?id=` request. (B) M9 backlog cleared:
  guarded `patchWithRollback`, `useDeckLibrary`, api-client-owned 401
  recovery (`setSessionRecoveryHandler`, coalesced probe, retry-once),
  data-layer folder lift-up (parallel PATCHes), visible self-expiring
  error pill (nonce re-announce), `StatusPanel`/`StatusSpinner`, hydration
  self-retry (1s→30s backoff, attempt-unbounded), unknown-id tiles with
  Remove, `src/test/` helpers (fetchStub/fixtures/domShims), glass.ts consts.
  (C) filters server-side with facets-fed options (`useCatalogOptions`);
  kinds → wire params (EX/Mega-only client remainder); hardcoded
  vocabularies deleted. (D) `DeckStats` (supertype counts + type bar) in
  DeckPanel; `Format.legalFlag` unifies `legalOnly` + `isLegalInFormat`;
  Radiant corrected to deck-wide 1 (official rule), Prism Star 1/name.
  Then an 8-angle review (3 correctness, reuse/simplification/efficiency/
  altitude/conventions) → 10 verified findings, ALL fixed in-session — the
  serious two: a **dropped hydration retry** when a batch failed after its
  effect run was disposed (fixed via module-level `liveHydrators` registry;
  failure maps merged + leak fixed) and the **nameExact import regression**
  for names with no print matching the stripped key (fixed: layered
  key→raw→substring resolution). Also: 401 session-expiry no longer raises
  the /decks error pill; LIKE `%`/`_` now escaped api-side; `?id=` requests
  skip KV; dead `getCard` removed; FilterRail/useCardSearch/DeckPanel
  memoized; ACE/Radiant dedup via `deckWideRemaining`. Deferred follow-ups →
  "P2-M1 follow-ups" in `workstreams/deck-builder.md`; D11 revised + D12
  added in `decisions.md`. Suite 528→607; `bun run check` green. NOT
  e2e-driven; api deploy must precede/accompany the web ship (new endpoints).
  Session trap: a usage-limit reset killed 7 review finders mid-flight —
  resumed via SendMessage with zero rework.
- **2026-07-13** (build) — **P1 milestone 9** (four sub-agent slices +
  multi-agent review): the frontend swap. (A) typed zod-free client
  `src/lib/api.ts` (types-only `@luminous/schema` imports, ApiError,
  `credentials:"include"` everywhere) + CSP now derived from
  `VITE_API_ORIGIN` via `loadEnv` (scrydex gone repo-wide). (B) builder on
  the server catalog: api gains repeatable `type`/`rarity` + `sort` +
  extended `CardBrief` (D10; KV `catalog:v2:`); web adapter
  `builder/catalog.ts`, paginated `useCardSearch`, session `cardStore` +
  per-id deck hydration (silent-drop fixed), async server-matched import,
  art via `/assets/cards/{id}` (playmat ids remapped to tcgdex scheme).
  (C) auth: root `AuthProvider` (me() boot), /login + /register (glass form,
  OAuth probe → friendly 503 copy), `AccountButton` corner control.
  (D) decks/folders on the API: optimistic mutations with field-level
  rollback, create-awaits-server, folder-delete lift-up (PATCHes then
  DELETE), builder deck load + debounced serialized PATCH (`deckSaver`),
  localStorage deck store retired; D11 scope trims. E2E-verified via
  agent-browser against wrangler dev (recipe → `.claude/skills/verify/`);
  verification caught two real bugs fixed in-session: **StrictMode
  double-mount permanently disposed the ref-cached saver** (→ effect-owned
  `useDeckSaver`, regression test) and the **register redirect race**
  (render-time `<Navigate to="/">` outran `navigate(from)` — unified).
  Then a 4-finder + 6-verifier + sweep review over the diff: 25+ confirmed
  findings; the 10 serious ones fixed in-session (saver drop-on-unmount
  during in-flight PATCH, name/count caps that could brick saves, auth
  last-writer races, one-off-401 eternal spinner, import-dialog dismissal
  race, `//` redirect guard, hasMore convergence, hydration remount race);
  the rest logged as the **M9 review backlog** in
  `workstreams/deck-builder.md`. Suite 451→528; `bun run check` green.
  NixOS/dev traps: browse dev via `localhost:5173` (CORS `APP_ORIGIN`), the
  cargo `agent-browser` binary is broken (use the Nix-profile one).
- **2026-07-09** (build) — **P1 milestone 8** (sub-agent): lobby Durable
  Object + client WS transport. `LobbyDO` (hibernation API, per-socket
  `serializeAttachment({playerId})`, auto ping/pong) runs the shared
  `lobbyReducer` unchanged; zod wire schemas in
  `packages/schema/src/lobby/wire.ts` with compile-time `Equals<>` proofs
  against the TS types; `lobbyCode` moved into the package. One alarm serves
  disconnect-grace (5 s), countdown→in-game, and empty-lobby TTL (10 min →
  deleteAll). Client `channel.ts` now WebSocket (backoff 400 ms→8 s, send
  queue, ping-as-heartbeat); `useLobby` internals rewritten (server is the
  authority now) but public API + all UI components untouched; API origin
  reader in `src/lib/apiOrigin.ts` (`VITE_API_ORIGIN`). Notable traps fixed:
  zod split out of `protocol.ts` to keep it off the web online chunk
  (97 kB→29 kB); WS route mounts BEFORE hono/cors (101 responses have
  immutable headers). Two-client e2e transcript all green; suite 400→451.
  M7 was committed + deployed + live-smoked this session (deck CRUD in prod).
- **2026-07-09** (build) — **P1 milestone 7** (sub-agent): deck/folder
  persistence API. `packages/schema/src/decks/` (Deck/DeckSummary/Folder +
  create/patch requests); `apps/api/src/decks/` (map/validate/routes);
  `requireUser` middleware extracted from `/auth/me` into
  `apps/api/src/auth/requireUser.ts` (shared session gate). All 9 endpoints
  session-gated; ownership scoping → 404 (no existence leaks); folder-cycle
  guard; card lists validated against the catalog via chunked IN queries
  (D1's 100-bound-params cap → 33-row insert chunks inside one `db.batch`);
  wholesale cards replacement on PATCH; empty PATCH → 400. Suite 343→400.
  M6 auth was committed + deployed + live-smoked this session (register/
  login/me/logout all correct in prod). Note: local D1 had only 123 cards
  (the sub-agent ingested sv01 locally to match test ids — local and remote
  D1 contents drift by design).
- **2026-07-09** (build) — **P1 milestone 6** (sub-agent): auth. Email/password
  + server sessions in `apps/api/src/auth/` — PBKDF2-SHA256 (WebCrypto,
  self-describing `pbkdf2$iters$salt$hash`, dummy-verify timing parity),
  session cookie `Secure; SameSite=None` with **sha256(token)** as the DB row
  id, app-wide CORS (`APP_ORIGIN` var), KV fixed-window rate limits (429 +
  Retry-After), Discord/Google OAuth (state cookie, account-takeover guard:
  unverified-email match → 409; routes 503 until secrets set), verify-email /
  reset-password are 501 pending an email-provider decision. No new
  migration (M3 tables fit). Domain `User` + request schemas in
  `packages/schema/src/auth/`. Suite 273→343. `.dev.vars` gitignored. §3.5
  rewritten as-built. Also this session: **full remote ingest completed**
  (19 sets / 3,698 cards, ~10 min) and M5 deployed + smoke-tested live
  (catalog totals, KV hit, R2 asset miss→hit in production).
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
