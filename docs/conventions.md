# Working Conventions

## Guidance, not gospel
These docs are a **living guide**, not a fixed process. You have context the
planning sessions didn't — the actual code, real data, what just broke. Use it:
- **Suggest better/different approaches** when you see them. Don't follow a task
  list off a cliff because it's written down.
- When you deviate: **explain the what + why**, prefer aligning with the user on
  anything significant, then **update the affected doc** and log the change in
  `decisions.md` (with its rationale). Small in-the-flow improvements don't need
  ceremony — just keep the docs honest.
- Locked assumptions and D-numbered decisions are **defaults with reasons**, not
  laws. Revisit any of them freely; the only hard rule is *don't reverse one
  silently* — leave a trail.
- Treat file/symbol references in these docs as **point-in-time** — verify against
  the current code before relying on them.

## Context hygiene (the point of this whole system)
- Load **`status.md` + the one relevant `workstreams/*.md`** (+ its
  `reference/`). Don't read unrelated workstreams or sweep the repo. Find
  decisions through `decision-index.md`; never read `archive/` whole.
- Prefer facts already written in these docs over re-deriving them.

## End-of-session ritual (do not skip)
1. Update `status.md`'s current state and its "Open items": add what this
   session left open, with its `decisions.md` anchor, and drop what it closed.
2. Record any decision as a dated entry at the end of `decisions.md`, then run
   `bun run docs:index`.
3. Write anything learned into the right workstream/reference doc so the next
   session doesn't rediscover it.

## Sub-agent / workflow policy
Delegate to sub-agents to keep the main session's context lean:
- **Research** (rules, library docs, API behaviour) → a `general-purpose` agent
  that writes a condensed doc into `reference/` and returns only a summary.
- **Code mapping** ("how does X work today, what's missing") → an **Explore**
  agent (read-only; returns conclusions, not file dumps).
- **Implementation** of a self-contained slice → a `general-purpose` agent with
  a tight spec; it edits files and returns a summary + what to verify.
- **Review** before committing non-trivial work → `/code-review`.
- **Big fan-out** (e.g. authoring effect handlers for many cards, or a broad
  audit) → a **Workflow** (multi-agent). Note: user-triggered/opt-in — ask first.

Rule of thumb: if answering would mean reading many files, delegate it and keep
only the conclusion.

## Handing work to another agent (D421)

**An instruction is a claim, and nothing downstream of a brief audits the brief.**
D421's brief asserted the target sentence carried a U+2019 apostrophe. It carries
U+0027 — written from memory, never checked, and delivered as an instruction
rather than as a question. It was caught only because the builder verified it
instead of implementing it. **When you hand work off, mark which of your claims
are MEASURED and which are REMEMBERED**, and expect the remembered ones to be the
wrong ones. A false premise at the top of a task is the cheapest defect to inject
and the most expensive to find, because every check below it is busy checking
something else.

## Code & quality
- TypeScript strict; match the surrounding code's style.
- **Comments are minimal (2026-10-23).** Comment only what the code cannot say:
  a game rule or card wording it implements, a non-obvious invariant or ordering
  constraint, or why something is done an unexpected way. No decision ids, emoji
  markers, history ("was", "now", "corrected"), census counts, dates or line
  numbers in code or tests — that record belongs in `docs/decisions.md` and git.
  `bun scripts/comment-guard.ts` (in `check:static`) enforces the id and date part
  on comments. Strings are data: a test title may name the decision whose sections
  it pins. Tests must not read source or doc text, and must not pin `engineVersion`.
- **Biome** for lint/format; **Vitest** for tests. Run **`bun run check`** before
  calling work done. It is `check:static` (the steps `package.json` lists under
  that name: guards, generators' `--check`, `tsc -b`, `biome ci`, the mutant `precheck`), `check:lua` (the headless Lua tests,
  requiring Balatro's source) and `check:test` (vitest). `scripts/check.ts` runs
  `check:static` and `check:lua`, and the steps of `check:static`, concurrently,
  printing each step's output when it finishes and then a timing table; a step is
  one quoted argument, so adding one to `package.json` is all it takes.
  `check:test` runs after them on its own, since vitest already uses every core
  and sharing them makes its timeouts flaky. CI runs the same three
  names, except that Lua tests needing Balatro's source are skipped there, in
  three jobs: `static` (the prod audit, check:static, the Lua tests, the bundle,
  actionlint, the gitleaks secret scan of the pushed or PR range and, on main
  pushes only, the never-failing `bench`), `test` and `mutants`. Each job runs
  `.github/actions/setup` after its checkout (Bun, Node, Bun's install cache,
  the frozen install, optionally Lua 5.1), so a toolchain change is made once.
  The install cache is keyed on bun.lock alone and only `static` saves it. A
  gitleaks finding fails `static`: a real secret is rotated, not just removed
  from the branch; a false positive gets a scoped entry in `.gitleaks.toml`,
  whose header pins the gitleaks version and sha256. Apart from CI,
  `prod-watch.yml` ("Production watch") probes production every 6 hours with
  `scripts/prod-watch.ts`: Bun only, no install and no secret, so keep that
  script's imports to Node built-ins and the files it reads now. Its failure
  email is the outage alert. Run
  `bun run format` before committing. `bun run release` runs check, the release
  gates (with the production advisory audit, and CI's result for HEAD printed,
  not waited for), the web build, the remote D1 migrations, the API deploy, the
  health check of the new version, the web deploy and its check, then tags the
  release `release-YYYYMMDD-HHMM`, re-checking before each deploy that the tree
  is clean at the remote's main and at the commit the release pinned
  (`docs/workstreams/backend-data.md` §3.7.2 has the recovery per step).
- `tsc -b` checks the engine and the schema once: both are composite projects
  that emit declarations into their ignored `dist/`, and the app, the api and
  the scripts read them through project references, so an error in engine source
  is reported by the engine project alone. CI caches the build info and those
  declarations and backdates them on restore, so every project still compares
  its sources by content.
- `scripts/import-graph.ts --check` fails on any runtime import cycle other than
  the recorded `RECORDED_CYCLE` (flow, interpreter, ops/board, ops/energy,
  triggers: a program step can knock out, which runs triggers and the turn
  flow, which run programs), and on a relative import that crosses a workspace
  root (each package, each app, `src`, `scripts`). Import another root through
  its package entry: `@colorless/engine/testing` is the fixture barrel,
  `@colorless/schema/tcgdex-fixtures/*` the TCGdex payloads, `@colorless/schema/jitless` turns off
  zod's eval probe and must be the first import of any page entry (`src/lua/bridge.ts`;
  `scripts/zodJitless.test.ts` checks it), and `@colorless/schema/constants` holds the
  zod-free constants; engine runtime code imports only that subpath's values, so it never builds
  a zod schema (`--check` fails on a value import from zod or the schema root). Schemas that only tests parse (`redactedGameSchema`, `lobbyServerMessageSchema`)
  sit in modules nothing on the Worker's runtime path imports, so the bundle drops them. A pure helper that
  would close a new cycle belongs in a lower module.
- The web app's page bundle stays free of the rules interpreter: code that runs before a table
  opens imports engine values from `@colorless/engine/rules` (deck rules, card classes, `DECK_SIZE`),
  and the game table (`src/lua/simulator.ts`, the online table), sandbox setup and the builder's
  simulation gaps load the full engine through `import()`. The bridge queues the table's commands
  while its chunk loads (`LazyScreen`). Type-only imports from `@colorless/engine` are free;
  `import-graph.ts --check` fails when the bridge's static imports reach the engine root.
- Vitest has three projects (`vitest.config.ts`): `engine` runs without per-file
  isolation, so engine suites must not use mocks, stubs, fake timers or other
  module-level state that leaks between files. The app suites are split by the
  config itself: a file that calls `vi.mock`, `vi.stubGlobal`, `vi.stubEnv`,
  `vi.useFakeTimers`, `vi.setSystemTime`, `vi.spyOn`, `vi.unstubAll*` or
  `vi.resetModules`, or names `globalThis`, runs in `app-isolated`; every other
  app file runs in `app`, without isolation, so it must not leave other
  module-level state behind either. Both shared projects undo stubbed globals,
  stubbed env vars and spies after every test, so a stub a helper installs (for
  example `stubFetch`) lasts one test there. Vitest caches transformed modules in
  `node_modules/.vitest-cache` (`bunx vitest --clearCache` empties it).
- **The engine remembers derived facts by object identity**: `disabledAbilityUids` per
  `GameState` (`DISABLED_ABILITY_UIDS`, `continuous.ts`), `cardOfUid`'s faces per `cardIdByUid`
  and `cardPool` (`FACES_BY_UID`, `cards.ts`) and `poolHasOwnerBoundEnergy` per `cardPool`
  (`OWNER_BOUND_POOLS`, `continuous.ts`). Once the engine has read a state, never write into it,
  its `cardIdByUid` or its `cardPool` in place, tests included: build a new object
  (`{ ...state, ... }`, `patchSide`, `{ ...state.cardPool, [id]: card }`), or the next read returns
  the answer remembered for the old contents. The `engine` project shares these memos across
  files in a worker, so such a stale read can pass or fail depending on which files run together.
- After any refactor that moves, reformats or un-comments mutated code, run
  `bun scripts/mutation/reanchor.ts --write`: it re-points rows whose `find` moved
  (whitespace, comments and file splits are ignored when matching) and lists the
  rest for manual re-anchoring or retirement (`--retire <file of ids>`). Each row
  records the `symbol` (top-level declaration, plus the key inside an object such
  as REGISTRY) its `find` sits in; a row only re-anchors inside that symbol, and
  precheck fails when a row's text sits in another symbol: after a rename, pass
  `--write --accept-symbols`; if the row landed on a twin, re-point it. `--write`
  fills in a missing symbol. Re-run every re-anchored row.
- CI's `mutants` job runs `bun run mutants:sample --base <ref>`: every row whose
  `file` or killer the diff touches (at most 60), plus 30 rows drawn with the
  commit sha as seed. A SURVIVED, stale or errored row fails the job; reproduce
  it locally with `bun run mutants --only <id>`.
- Test seams to reuse: `walkGame`/`candidateActions` (`fixtures/walk.ts`) for
  seeded play-forward sweeps (`onStep` sees each accepted action's events); `createLobbyHarness` (`apps/api/src/lobby/lobbyHarness.ts`)
  for LobbyDO (its `dispose` fails a test whose DO sent a frame `lobbyServerMessageSchema`
  refuses); `useTestD1` (`apps/api/src/testing/d1.ts`) for routes on a real D1, with `failingD1` there for one whose statements or batches fail;
  `openBridge` (`src/seam/lobbyBridge.ts`) for the web client's channel, LobbyClient and Lua
  online adapters against that real LobbyDO, over sockets that drop, reopen or go half-open, on
  fake timers. A suite outside the api imports the harness as `@colorless/api/testing/lobbyHarness`
  (never a relative import across roots); `src/seam` is typechecked by `tsconfig.seam.json`, with
  the DOM and the Workers types, and `worker-bundle.ts --check` fails if the Worker bundle carries
  a test-only module.
  A change to the persisted game shape fails `packages/engine/src/persistShape.test.ts`
  until `GAME_STATE_VERSION` (`packages/engine/src/persist.ts`) is bumped and the snapshot
  rewritten with `-u`. The pinned skeleton covers a fresh game, a body and a side with every
  install field set by its op, and one park per prompt kind; a new install field needs an op in
  the test's `INSTALL_OPS`, and a field only an unsampled op writes is not pinned. A change to
  the Lua wire fails `src/lua/wireFixtures.test.ts`; regenerate its fixtures with `-u` and update `frontend/lua/tests/wire_fixtures.lua` and
  `frontend/lua/tests/sim_model.lua` to match.
- **The Lua mailbox rows are declared once** (`src/lua/wireFields.ts` `WIRE_ROWS`): each row kind's
  tag(s) and field order, `as const`. Emitters build a record and encode it with `wireRow`, so a
  missing or extra field fails to compile. `bun scripts/lua-constants.ts` turns the table into
  `frontend/lua/ui/wire_fields.lua` (field → 1-based column); `--check` runs in `check:static`. Lua
  is the only reader of these rows (the builder's title comes from `LuaBuilder.name`). Readers index
  by name (`f[W.header.matchId]`, `r[W.card.zone]`) and tests by `wireColumn`, never by number. To
  add, drop or reorder a field, edit `WIRE_ROWS`, rerun the generator and the fixtures; the web
  deploy is atomic and content-hashed, so no slot is kept for an older client. The command and
  text-input records Lua sends back are still positional.
- **Deck construction rules live once, in the engine** (`deckRules.ts`): `FORMATS`/`formatById`
  (a null or unknown format plays Standard), the `isAceSpec`/`isRadiantPokemon`/`isPrismStar`
  classes, `isLegalInFormat` (the card's `legal` flags, no printed-mark fallback), and
  `validateDeck(entries, format)`/`savedDeckReasons(cards, format, pool)`, which return the
  reasons a deck is illegal. The server enforces them: `beginMatch` refuses a deck that is not
  legal in its own stored format, and the lobby drops both players back to selecting with the
  reason. The builder (`src/decks/deckMath.ts`) and the online picker (`sandboxDecks.ts`
  `playableDecks`, its `online` verdict) call the same functions. Local play asks only what
  `createGame` asks: 60 cards, all in the catalog, and a Basic Pokémon.
- The client's one view of a game is `redactGame`'s `RedactedGame` plus the seat log. Both table
  sources read prompts and the effect phase (`unit`, `counterTransfer`, `invokedBy`,
  `abilityName`) and the log rows' `cues` (`cuesFromEvents`), never `pendingOp` or the rendered
  log text. Grow that wire with optional fields: the API deploys before the web client, so a new
  enum literal needs the client deployed first.
- **Persisted state is versioned and migrated in the engine** (`persist.ts`). The lobby's
  `MATCH_RECORD_VERSION` is `GAME_STATE_VERSION`, so the wire carries one number; `match.ts`
  keeps only the record envelope and `loadMatchRecord`, and calls `migrateGameState` for the
  state. To bump: raise `GAME_STATE_VERSION`, rewrite the shape snapshot, and give the previous
  version a `MIGRATION_STEPS` entry if its states can be carried forward: `unchanged` when the old
  bytes already read correctly, `withDefaultKeys` when the change only adds side installs
  (`clearedSideInstalls`) or attack-effect fields (`clearedAttackEffects`), or a hand-written step
  otherwise. A version with no entry is retired: the DO answers its record `stale` and retires the
  match, and a local save is already refused by its `engineVersion`. The oldest migratable version
  is 42. Each step gets a `*Migration.test.ts` beside `persist.ts`, built on the
  `storedAt`/`migrateStored`/`mustMigrate` fixtures; the DO's read is tested in
  `apps/api/src/lobby/matchLoad.test.ts`.
  - **A hand-written step also gets one real record** (reliability audit EN6). `storedAt` strips
    keys from a current state, and the same person writes it and the step, so a wrong idea of the
    old shape passes both. Before changing the engine, write one parked mid-turn state from a
    bench-deck walk (`actionFuzzReal.test.ts`'s setup) with the pre-change engine, by a script, and
    commit it as a fixture with the version it was written at. The step's test migrates it and
    plays 20 steps with `fixtures/fuzz.ts`'s checks. Delete the fixture when its version retires.
    An `unchanged` or `withDefaultKeys` step needs none.
- Reuse the shared engine helpers instead of re-spelling them: `inPlayOf`,
  `bodyAt`/`pokemonAt`, `relativeSeat`, `turnOwnerOf`, `clearedAttackEffects`,
  `HP_PER_COUNTER`/`damageCountersOn`, and for the §9 once-per-turn bag
  `abilityUsedKey`/`coinRedoKey`/`abilityUsedThisTurn`/`spendAbilityUse`
  (`types.ts`); `landAttackHit` (`damageCalc.ts`) for the §8.5 tail after Weakness and
  Resistance (reduction, prevention, the shield and survival coins, the KO-survival clamp,
  `DAMAGE_DEALT` and the consumed Tools) on every attack-damage route, each route keeping its
  own bonus, debuff and W/R steps; `OpOf<K>` for one `EffectOp`
  variant (`effectTypes.ts`); `positiveInt`, `printedFlipCount` and the gate
  builders in `effects.ts`; the printed-text vocabulary (`STATUS_WORD_OF`, the
  type-code maps, `foldApostrophes`, `COPY_FAMILY_MARKER`) in
  `deriver/vocabulary.ts`, which runtime modules import instead of `effects.ts`;
  `searchThenShuffle`/`searchTopOrderProgram`/`activated`/`berry`
  (`registryBuilders.ts`). State checks (`discardMisplacedEnergy`, the trim
  stages, `postStepChecks`, which `advance` and `applyAction` both call) live in
  `stateChecks.ts`; `finishGame` in `outcome.ts`; the pure trigger lookups
  `triggersOf`/`damagedByAttackAbility`/`damagedToolTriggersOf` in
  `triggerLookup.ts`; the KO-survival clamp and the RNG-consuming damage coins
  (`koSurvivalCoinFlip`, `coinFlipShieldPrevents`) in `damageCalc.ts`, so
  `continuous.ts` stays a read model that pushes no events and draws no RNG. The op contract lives in `effectTypes.ts`, program
  types in `programTypes.ts`, and stepOp's arm bodies in `ops/*.ts`,
  `effectTargets.ts`, `boardCondition.ts`, `effectPrompt.ts` and `promptText.ts`;
  `interpreter.ts` keeps runProgram, stepOp, answerOp and resumeProgram. Neither it nor
  `effects.ts` re-exports these modules: import a helper from the module that defines it. A parked
  op's answer goes through `answerOp`, one arm per `parks: true` op (a missing arm
  fails to compile), which returns the board and the ops the answer buys, the
  shape stepOp returns. resumeProgram is answerOp, then `discardMisplacedEnergy`,
  then runProgram over the bought ops and the rest. A multi-question op whose
  first question is forced (`healChosen` with riders, the `moveCounters*` ops)
  answers it through answerOp too, so the forced and parked endings agree. Every op
  declares its traits in `OP_TRAITS` (`ops/traits.ts`, type-only imports):
  whether it parks, its record slot, whether it moves counters, and whether
  `programPlayable` asks its whiff check (`ONLY_WHIFFS` in `cardplay.ts`). The
  op-generic sites read that table instead of keeping their own op lists. Test
  helpers live in `fixtures/` behind the `testFixtures.ts` barrel (`driveSetup`,
  `patchSide`, `roundTrip`, `mustDerive`, `seedForFlips`). The fixture pool's
  `fix-*` card programs live in `fixtures/registry.ts`, not in `registry.ts`:
  the vitest setup file (`fixtures/vitestSetup.ts`, wired in `vitest.config.ts`)
  installs them with `registerTestPrograms`, which nothing else calls and the
  package index does not export, so the production registry holds no `fix-*` id.
- **Reprints are not typed by hand.** `programFor(id)` reads `REGISTRY[id]`, then
  the row of `id`'s print_key group through `PROGRAM_ALIAS`
  (`registryAliases.generated.ts`, from the local D1's `print_key` column), then the
  test programs; `bannerOf` and `FOSSIL_IDS` fall back through the same table. Author a
  card on ONE printing; its same-name, same-text reprints follow. After an ingest
  that adds printings, or after authoring a group's first row on a printing that is
  not its canonical one, run `bun scripts/registry-aliases.ts` (`--check` in
  `check:static` compares, and skips with a message where no local sqlite exists,
  as in CI and fresh worktrees; `COLORLESS_D1_SQLITE=<path>` reads another file).
  `registryAliases.test.ts` fails when a reprint carries its own REGISTRY row or a
  group reaches two programs. A twin under ANOTHER name or with different text has
  its own print_key and still needs an explicit row (`reprintAliasLegal.test.ts`,
  `reprintAliasMeD58*.test.ts`). `registryCardIds()` lists REGISTRY keys only; a
  sweep that means every programmed printing uses `programmedCardIds()`
  (`fixtures/printings.ts`).
- **The generated table must match the remote catalog.** It is built from the LOCAL
  D1, which CI cannot see, so `bun run release` runs `release-gate.ts print-keys`
  (apps/api), which fails when the local and remote `print_key` columns differ; then
  re-ingest locally, re-run `bun scripts/registry-aliases.ts`, and commit.
- `scripts/residue-census*.ts` and `scripts/opaque-anatomy*.ts` were deleted
  (2026-10-23) after measuring zero residue; the archived lessons that describe
  them (`archive/conventions-lessons.md`) are history.
- An engine function that appends to an `events: GameEvent[]` out-parameter takes it as its last
  positional parameter, after any options record; optional parameters before it are passed
  explicitly (`undefined`, or `{}` for a fresh `EffectRecord`).
- Pure logic gets unit tests (see the many `*.test.ts` in the repo). There is no DOM test
  environment: DOM-facing code takes its elements and event targets as parameters (as
  `src/host/textProxy.ts` and `src/host/router.ts` do), and its tests pass fakes built on
  Node's `EventTarget`.
- **The page around the Lua canvas.** `frontend/lua/web/host.js` is a classic script, checked
  with `// @ts-check` (`frontend/lua/web/tsconfig.json`), that must load before `game.js`, which
  reads love.js's `Module` while it parses. It keeps only boot (`Module`, the loading and
  failure overlay), mailbox writes (held until `preRun` when the runtime does not exist yet),
  the viewport mailbox and card art, and defines `window.colorlessHost`
  (`src/host/bridgeProtocol.d.ts`). The boot invariant: `Love()` starts on window load, after
  the deferred bridge module has run and called `colorlessHost.connect`; when it has not, the
  host shows the failure overlay instead of starting. Everything else is TypeScript in
  `src/host/` (`router.ts` owns routes and history, `shell.ts` takes Lua's
  `COLORLESS:<channel>:` prints, which Lua sends only through `ui/bridge.lua` with every
  payload field percent-encoded, so no data can break a line and forge a command;
  `scripts/lua-bridge-guard.ts` fails on any other stdout write; `textProxy.ts` drives the native inputs with the shared
  `[revision, field, value, selectionStart, selectionEnd, action]` record), wired by
  `src/lua/bridge.ts`, which registers the screen adapters in one table. The host script has
  no imports, so it receives data (mailbox names, the artwork cache) through `connect`. Lua
  reads mailboxes by name through `ui/host_constants.lua`, which `scripts/lua-constants.ts`
  generates from `src/host/mailboxes.ts`: add a mailbox there, not as a string in Lua. Lua owns
  the preferences record; the page stores it as Lua writes it. Adapters guard async replies
  with `epochGuard()` (`src/lua/epochGuard.ts`).
- Import zod as `import * as z from "zod"`, never `import { z }`: the named import keeps every zod
  locale in the Worker bundle. Give a refinement its message as `{ error }`, not zod 4's
  deprecated `{ message }`. `scripts/worker-bundle.ts --check` (in `check:static`) builds the
  Worker with a wrangler dry run that takes the apps/api `deploy` script's flags, so it measures
  what ships, and fails on a non-English locale or a bundle over its budget. It fails, before
  building, when that script's `wrangler deploy` lacks `--minify` or apps/api/wrangler.jsonc does
  not set `"upload_source_maps": true`. It also fails on an npm package in the bundle that is not in the `dependencies` of apps/api,
  packages/engine or packages/schema, so a dev dependency such as @tcgdex/sdk cannot ship by one
  value import, and a shipped package's own dependencies must be declared. Worker source (not its
  tests, `src/testing/` or the bun-run ingest file helpers) may not use `process`, `Buffer`,
  `require` or the other Node globals (a Biome override): the Worker runs without `nodejs_compat`.
- `scripts/lock-check.ts` (in `check:static`) fails when bun.lock resolves more than one miniflare
  or workerd version. Bump wrangler and apps/api's exact miniflare pin (the miniflare version that
  wrangler itself depends on) together, then regenerate the Worker's types (below). The D1 harness
  passes its options through `convertV4MiniflareOptions`.
- `scripts/worker-types.ts` (in `check:static`) fails when `apps/api/worker-configuration.d.ts`
  is stale: it runs `wrangler types --check` with the `types` script's flags, and checks the
  header records that script's command. apps/api and the seam suites take the Workers runtime and
  the bindings from that file (no @cloudflare/workers-types); `src/env.ts` reads each binding's
  type from its `GeneratedEnv` and fails to compile on a binding it does not list.
- **`bun run bench`** (`scripts/bench.ts`) times the engine over seeded games on the committed
  real-card pool `packages/engine/src/fixtures/benchPool.json` (regenerate with `bun scripts/bench/write-pool.ts`):
  applyAction per action and per action type, two redactions, logFromEvents, legality probes and a
  cold engine import, as medians. `--node` runs it under V8, `--cpu-prof` writes a profile to
  `tmp/bench/`. Its `fingerprint` hashes every state, event list, redaction and log row: a pure
  performance change must leave it identical, and any rules change moves it. It is not part of
  `check` and nothing gates on its timings. Its replays reuse the recorded games' state objects, so
  `FACES_BY_UID` and `OWNER_BOUND_POOLS` are warm, as in the browser simulator; the lobby loads a fresh state
  per action and gains less from them.
- **`bun run e2e`** (`scripts/e2e.ts`) is the browser smoke of the real page, opt-in and the
  recommended step before `bun run release` (`docs/workstreams/backend-data.md` §3.7.2). It needs
  `CHROMIUM` (or chromium on PATH) and `BALATRO_SOURCE`, builds the site against its own
  `wrangler dev` on free ports with a fresh migrated D1 in a temporary directory, seeded with
  `@colorless/api/testing/fixtureCatalog` (a deck of committed tcgdex payloads), and makes its
  accounts and decks through the API. It reads the mailboxes by `WIRE_ROWS` and drives Lua through
  bridge lines, and stops every process it started, failing or not; a failed run keeps the
  temporary directory and prints it. A new step goes in `smoke()`; keep it semantic, never canvas
  coordinates. **`bun run e2e --firefox`** runs the same smoke in Firefox (`FIREFOX`, or firefox
  on PATH; with Nix, `$(nix build nixpkgs#firefox --no-link --print-out-paths)/bin/firefox`) over
  WebDriver BiDi, through the driver interface in `scripts/lib/browser.ts`; a step uses only that
  interface, so it runs in both. Headless Firefox makes no WebGL context, so this mode starts its
  own Xvfb and, where `/run/opengl-driver` is missing, Mesa's software GL, both from nixpkgs unless
  `XVFB`/`MESA` name them; it is opt-in too, about 80 s.
- **Never inherit a suite figure from prose — six were stale in one session**
  (D206 found the recorded baseline of 233 files / 4367 tests was really
  234 / 4373). Measure with `bunx vitest run --pool=forks --maxWorkers=2`;
  `bun run test:run` SIGKILLs its worker in this container and `bun test` is the
  wrong harness entirely (`check` uses vitest).

## A guard must be able to go RED (D200 → D214)

🛑 **Before you trust a check, say what change would turn it RED. If the answer
is "only deleting the card", it is vacuous.** One session shipped **eight** guards
that ran, were green, and could not fail — D212 counts itself the sixth, D213 and
D214 came after. Three were caught by their own author, which is the only reason
the trend improved.

- ⚠️ **It bites verification PROCEDURES as hard as tests.** D214: three prior
  reduced-motion slices "verified" by grepping the built CSS for a
  `motion-reduce` rule that another module already emitted, so the check was
  green before the work started. What rescued it was an
  **attribution control**: a build with the variant deliberately typo'd emits
  nothing anywhere. Any check whose subject is a shared artifact needs one.
- **Assert the thing, not a proxy for it.** `biome lint <path>` exits 0 on a path
  it processed **zero** files for — count files, not exit codes (D212). A doc
  comment spelling an action as a double-quoted literal **by itself satisfied a
  source-scan guard** (D210). A name-based DOM query passed on a board with **no
  Stadium section**, because a second copy in hand rendered a same-named row
  elsewhere (D213).
- **"These ids are unbuilt" is nearly always true**, so a flag that only asserts
  absence cannot fail. D200's table named six entirely wrong cards and passed
  because the wrong cards were also unbuilt; D204's per-surface rebuild was
  **still** vacuous (`programFor(id)?.attack` reads the REGISTRY only, while
  attack programs resolve `registry ?? deriveAttackEffect`). D205's repair:
  every flag **drives** the missing mechanism on a real board.
- **Declining to write one is a result.** D203 refused an api-side
  prompt⟺dialog assertion — the api has no React, so it could not go red for
  the reason that mattered — and recorded the refusal instead of shipping green.
- Cousin defect: an arm written from a **paraphrased** sentence passes a test
  written against the same paraphrase and matches no real card (D183). Author
  and assert against the printed bytes.
- 🛑 **A NEGATED CONJUNCTION OVER UNION MEMBERS IS A CLOSED-WORLD ASSUMPTION WITH
  NO COMPILER BEHIND IT.** `op.from !== "yourActive" && op.from !== "yours"`
  duplicated `discardVictimSeat` — the helper whose own doc says it exists so two
  readers cannot disagree — and was equal to it **by construction**, until a third
  own-board member existed and fell silently out of the wrong side (D222). **A
  `switch` over the union goes red when a member is added; a conjunction goes
  quiet.** Before adding a union member, grep for hand-spelled tests over the
  members you already have, and route them through the one helper instead.

- 🛑 **WHEN ONE FACT GAINS A SECOND FIELD, FIND EVERY READ SITE BEFORE YOU FIX ANY OF THEM (D412).**
  The §11 retreat lock went from one field to two (an imposed boolean and a self-installed stamp).
  The engine gate and `redact.ts` were routed through a single new reader; **the HUD (the React
  app's, since deleted) was the third site and was still spelling the old field by hand** — a live afford-then-reject, found by
  grep rather than by a red test. ⚠️ **THE SERVER-SIDE TWIN PASSING PROVES NOTHING ABOUT THE LOCAL
  PANEL** (D213's rule, re-earned). `grep -rn "<fieldName>" src/ apps/ packages/` is the whole
  procedure, and it costs seconds.
- ⚠️ **A GUARD FOR A NEWLY-SPLIT FACT NEEDS THE HALF THAT WAS ALREADY CORRECT AS A CONTROL.** Driving
  only the new half proves the new code runs; driving only the old half stays green through the
  entire defect. D412's HUD guard is three cases — new, old, neither — and only the first goes red
  against the old line.
- ⚠️ **BEFORE EDITING A SHARED `*_DECK` FIXTURE, ASK WHOSE SEEDS IT FEEDS.** D412 added ONE card to
  `COMPOUND_COMPOSE_DECK` so a local board could run, and **reddened three of D409's boards** — deck
  composition is load-bearing for every suite seeded off it. Prefer re-homing your assertion into a
  sweep that already has the machinery: D412's §10 claim belonged in the existing three-route clear
  sweep anyway, because **one route passing says nothing about the other two**.

- 🛑 **WHEN YOU BUILD THE FIRST THING THAT CAN PRODUCE A STATE OTHER CODE HAS ONLY EVER SEEN ARRIVE
  ONE WAY, GO FIND THE CODE THAT ASSUMED IT (D414).** A new op made a body lethal on the defender's
  board *without damaging it*. Two shipped readers had quietly encoded *"lethal here ⇒ damaged by
  this attack"* — one as a per-BATCH constant feeding six printings of *"Knocked Out by damage from
  an attack"*, one **discharged by placement and stated as such in its own comment** (Vengeful
  Punch). **Neither would have gone red, and neither is reachable from the new op's file.**
  ⚠️ **THE SEARCH IS CHEAP AND IT IS THE WHOLE SLICE**: name the invariant your change breaks in one
  sentence, then `grep` for the vocabulary that invariant is phrased in. Minutes, here.
- ⚠️ **A DOC BLOCK'S JUSTIFICATION IS A CLAIM AND ROTS LIKE A COUNT — INCLUDING THE ONE YOU JUST
  WROTE.** D414 justified a mechanism with a board that turns out not to exist (a card that denies
  the *Prize*, not the Knock Out). The mechanism was cheap and worth keeping; the reason was invented.
  It now says the motivating board does not exist. **A mechanism kept for a stated cheap reason is
  fine; one kept for a reason that turns out to be false is how this repo loses track of what is
  load-bearing.**

## Counting the catalog

- **Every count carries a POPULATION and a LEGALITY.** Six-set local (978),
  remote D1 (3,786) and Standard-legal (2,021) are three denominators; a figure
  without one is a floor (D183, D187).
- ⚠️ **SQLite's `LIKE` is CASE-INSENSITIVE — use `GLOB`.** It cost D200 a count
  of **95** where the truth was **6**. D202 ran both deliberately, to prove no
  case variant exists rather than to assume it.
- **`json_each`, never a grouped query.** A grouped `attacks_json` query
  attributed a sentence to Yanmega `svp-187` that Iron Bundle `sv06-062` prints
  (D206); D208 re-derived with `json_each` + equality.
- **Sweep all three text columns** (`attacks_json`, `abilities_json`, `effect`).
  D205's sweep read attacks only, and undersized one flag 2 → 7 printings (D206).
  ⚠️ **AND WIDENING THE COLUMNS PROVES NOTHING ABOUT THE LITERAL.** D310 caught the
  `returnBenched` census sweeping `attacks_json` alone and re-ran it across two
  columns: 4 → 8 printings. **Eight was still short**, because
  `'this Pokémon and all attached cards'` cannot see the PRONOUN spelling — Abra
  `sv06-080` prints *"you may shuffle **it** and all attached cards into your
  deck"* and the family is NINE (D311). **A census is as narrow as BOTH the columns
  its query names AND the literal it matches; ask it twice — once with the columns
  widened, once with the literal shortened to the part of the sentence a pronoun
  cannot change.**
- **A census is only as wide as its verbs.** `effect GLOB '*Switch your Active*'`
  missed every gust-antecedent printing of the same family — including one the
  slice then landed (D206).
- ⚠️ **Name the field before you design the predicate.** A predicate over a
  banner no column CLASSIFIES yields a permanently empty candidate set, which
  `programPlayable` turns into a card that can never be played. The sharp form
  (D207): `Tera` is on 22 rows and **every occurrence is DEMAND — the SUPPLY
  side is absent**. Same for `Ancient` / `Future` (D205, D204). 🆕🆕🆕 **D568 (D539): WITHDRAWN
  FOR TERA** — the supply need not be an INGESTED column: `banners.ts`, an engine table keyed by
  PRINTING id (never species or name, D135), is the writer, and D568 built 19 printings on it.
  "No ingested column classifies the banner" stays TRUE, and so does every Ancient/Future claim
  until Slice 2 widens `Banner`. 🆕🆕🆕 **D569 (D539): and Slice 2 part a DID — `Banner` is "Tera" |
  "Ancient" | "Future" and the table carries 86 more ids (two sources: pokemon-tcg-data's subtypes
  and a species/name cross-check, every disagreement settled on the printed image); the
  Ancient/Future claims are WITHDRAWN in turn.** "No ingested column" still stays TRUE. The rule this bullet teaches stands: name the field — here, the
  table — before you design the predicate.

## Pricing a slice

- 🛑 **A REFUSAL CARRIES ITS OWN EXPIRY DATE IF IT SAYS WHAT IT IS WAITING FOR — SO GO BACK AND
  CHECK THE TRIGGER (D413).** A sentence was refused because D121's warrant needs *two printings with
  one token varying* and the pool had one. The refusal was correct and it named the exact condition
  that would overturn it. **That condition had been true for a long time and nobody looked** — because
  the refusal was measured on the LOCAL 978-card pool while the engine is built against the
  `legal_standard = 1` column. *Two populations, two answers*, biting a REFUSAL instead of a census.
  Collecting it cost one regex and one arm and bought 5 printings.
  ⚠️ `grep -rn "REFUSED\|toBeNull\|toBe(null)" packages/engine/src/*.test.ts`, then re-read each
  reason against **today's** population and **the population the engine actually runs on**.
- ⚠️ **THE BIGGEST BUILDABLE THING IS OFTEN NOT AT THE TOP OF THE RESIDUE RANKING.** Ranking unbuilt
  sentences by printings surfaces the expensive ones — they are unbuilt *because* they are expensive.
  D413 was found instead by a **one-word-deletion sweep** over the whole residue: delete a token and
  ask whether an existing reader claims the result. Cheap to run, and it names near-misses that no
  size ranking can see.


- **Establishing a true price is a full result, and refusing to build is a valid
  outcome.** Two "large" items collapsed on contact: D186's 78-printing gate is
  **12** buildable; D200's 80-printing filter yields **6**. D193 built
  `energyOnSelf`, measured five assertions across four files going red, and
  **reverted** — D196 landed it later, once the witness it collided with was
  re-homed.
- ⚠️ **Re-derive the `needs` column, not just the ids and counts.** A flag can
  overstate a cost as easily as understate a gap: D199 priced
  `opponentPrizesRemaining` as missing when it was already in the union **at
  D199's own commit**, hiding 7 legal printings behind a word (D207 then landed
  them as two registry rows and zero new engine code).
- ⚠️ **And it can UNDER-price, which is the harder direction to see: name the
  READ SITES, not just the field.** D190 priced Flashing Draw at "a `from:'self'`
  member on `discardEnergy`" — exactly right about the op, and silent about the
  half that cost more. The printed *"in order to use this Ability"* makes that
  discard a **COST**, so `programPlayable` had to answer *"does THIS body hold a
  matching Energy"*, which it could not ask (it took no `sourceUid`) — a
  parameter that then threaded through six call sites including **both HUD
  row-lighting sites**, where dropping it would have been a live afford-then-reject
  (D222). A new field is cheap; a new field its GATES cannot see is not. The
  sibling slice one op over is not evidence either: D221 needed no gate change
  **only because an un-narrowed attach target set always contains the host**.
- **An arm transfers across sets; a registry row does not.** A deriver arm is a
  text parser and serves every reprint of its sentence; a row is keyed by card id
  (and its print_key group, through `PROGRAM_ALIAS`) and legality is a hard filter on it — D180's four *correct* alias rows serve
  **zero** Standard-legal printings (D187, D180 follow-up).
- **Exact map or flag.** A registry row has no deriver behind it to refuse what
  it cannot parse, so whatever is authored is what the card does forever: a
  wrong-but-plausible program is strictly worse than an unbuilt one, which at
  least fails loudly (D190b, D199).
- **Re-triage a deferred list against the code, item by item — do not read it.**
  D195: an old list's *"every item was fixed"* was one item too generous, and a
  deferred note **named a remedy rather than the defect** (the real fix touched
  neither thing the note pointed at).

## Database migrations

**Adding one.** Edit `apps/api/src/db/schema.ts`, then from `apps/api/` run
`bun run db:generate --name <what_it_does>`: drizzle-kit writes the next
numbered file into `apps/api/drizzle/` and updates `drizzle/meta/`. SQL that
drizzle-kit cannot write (a trigger, a backfill) goes in that file, or in an
empty one from `bun run db:generate --custom --name <what>`. Apply it with
`bun run db:migrate:local`, then `bun run check` (`migration-guard.ts`,
`drizzle-drift.ts` and `migrations.d1.test.ts` read the new file). `bun run
release` applies it remotely. Every migration follows the rules below.

D1 applies each migration file in one transaction with foreign keys enforced, and
the previous Worker keeps serving while `release` migrates. Two rules follow.

- **Expand, then contract.** A migration must stay readable by the Worker that is
  already deployed: add tables, columns (nullable or with a default) and indexes
  freely; drop or rename a column only one release after the code stopped reading
  it. `release` migrates before it deploys, and the API `deploy` refuses to run
  while a migration is unapplied remotely (`apps/api/scripts/release-gate.ts`).
  `scripts/migration-guard.ts` fails on `DROP COLUMN` or a `RENAME` in a file
  not listed in its `CONTRACTS_REVIEWED`, with the commit since which no code
  reads the old name.
- **Never let drizzle-kit rebuild a table that has children.** For a CHECK, an FK
  action, NOT NULL or a type change, drizzle-kit writes `PRAGMA foreign_keys=OFF;
  CREATE __new_t; INSERT … SELECT; DROP TABLE t; RENAME`. Inside D1's transaction
  the PRAGMA does nothing, so `DROP TABLE` fires ON DELETE: rebuilding `users`
  empties sessions, identities, folders, decks and deck_cards; rebuilding `decks`
  empties deck_cards and clears favourites; rebuilding `cards` or `sets` fails at
  COMMIT because deck rows reference them (NO ACTION). `PRAGMA
  defer_foreign_keys` defers checks, not actions, so it does not help.
  `scripts/migration-guard.ts` (check:static) fails on `PRAGMA foreign_keys`,
  `DROP TABLE` or `__new_` in a migration file not listed in its `REVIEWED`.
  Prefer what needs no rebuild: a `BEFORE INSERT/UPDATE` trigger instead of a
  CHECK, a new column instead of a changed one. When a rebuild is unavoidable,
  hand-write it: copy every descendant table out (`CREATE TABLE __keep_x AS
  SELECT * FROM x`, down the whole cascade tree), rebuild, re-insert parents
  before children, re-point `users.favourite_deck_id`, drop the copies; export
  the user tables first (backend-data.md §3.7.3). Then make
  `apps/api/src/db/migrations.d1.test.ts` pass (it seeds every table, applies each
  newer migration file by itself and compares row counts, references and
  `PRAGMA foreign_key_check`) and add the file to `REVIEWED` with the reason.
- **A backfill comes after the DDL.** Put a migration's data statements
  (`UPDATE`, `INSERT`, `DELETE`) after its schema changes, each starting a line:
  restoring an export older than the migration re-runs them from the first such
  line to the end of the file (backend-data.md §3.7.3, step 4).
- `scripts/drizzle-drift.ts` (check:static) fails when `schema.ts` has changes no
  migration records. drizzle-kit does not track triggers; note any next to the
  table in `apps/api/src/db/`.
- **A Durable Object migration ships alone.** A new `migrations` entry in
  apps/api/wrangler.jsonc (a LobbyDO class added, renamed or deleted) blocks
  `wrangler rollback` to every API version before it. Release it with no other
  API change, so a rollback never has to cross it (backend-data.md §3.7.2;
  build audit DEP2).

## Dependencies

bun.lock is the source of truth, and it is always installed frozen: CI,
`release` and `deploy` run `bun install --frozen-lockfile` first. Only a commit
meant to change dependencies changes bun.lock (dependency audit, DEP-P1).

**Ranges.**

- Carets by default, for libraries and tools alike. A hand bump raises the floor
  to the version it locks, so a manifest never says `^4.0.0` while the lock
  holds 4.109.
- An exact pin needs a recorded reason, listed here:
  - `@tcgdex/sdk` (D188): an opt-in ingest transport whose types are never the
    boundary.
  - `@noble/ciphers` (MI1): the match RNG's ChaCha20, an inspected security
    surface.
  - `miniflare`: equal to the version wrangler itself depends on, so the D1 test
    harness and `wrangler dev` run one workerd. `scripts/lock-check.ts`
    (check:static) fails a second miniflare or workerd in the lock.
  - `@biomejs/biome` (DEP-P7): `biome ci --error-on-warnings` is a check:static
    gate, and a patch can change formatter output or add a warning, so a bump
    is a commit of its own that reformats and fixes in the same diff.
  A new exact pin adds its line and decision here.
- A dependency declared in two workspaces carries the same spec there
  (wrangler, today). `bun run deps:check` lists any that differ.
- **The root owns the test and type tooling.** vitest, typescript, biome and
  @types/node are declared only in the root package.json, although every
  workspace's tests import vitest and apps/api's `tsc -b` uses the root
  typescript. Do not add them to a workspace manifest (USE7).
- **TypeScript 7 checks; TypeScript 6 parses.** `tsc` is TypeScript 7, the Go
  compiler, which has no stable compiler API yet. The mutation scripts that
  parse source (`binding-gate.ts`, `reanchor.ts`, `symbol.ts`) import
  `@typescript/typescript6` instead, the TS 6 API under its own name. Nothing
  else may import it. Port them and drop it when TS 7.1's API is stable (DEP-P5).

**Toolchain.** `.bun-version` (read by setup-bun) and `packageManager` name the
same bun, and `.node-version` (read by setup-node) names the Node 22 LTS line:
tsc, vite, vitest, wrangler and biome start with `#!/usr/bin/env node`, so
`bun run` executes them under Node. Bump them in a commit of their own and
keep `engines` in step; Dependabot does not update them. Move Node to 24 in
Q1 2027, before 22's end of life on 2027-04-30, and @types/node with it: it
follows the pinned Node major, never the newest.

**Install scripts.** `trustedDependencies` is `[]`, so bun's default trust list
applies: today only workerd's postinstall runs (it hard-links the platform
binary that is already installed). An empty list does not mean "no scripts".
Add a package only when it cannot work without its own script, with the reason
(DEP-P2, TRN5); `bun pm untrusted` lists the blocked ones.

**Release-age cooldown.** `bunfig.toml` sets `minimumReleaseAge` to 3 days:
`bun add`, `bun update` and any install that resolves skip versions published
less than 3 days ago, and say so ("blocked by minimum-release-age"). A frozen
install of an existing lock is unaffected. An urgent security patch bypasses it
for one command, `bun update hono --minimum-release-age=0`, and the commit says
why. Bun 1.4.2 has no `--minimum-release-age-excludes` flag; to exempt a
package for a while, add it to `minimumReleaseAgeExcludes` in bunfig.toml.
The gate also applies to versions already in the lock: any install that
re-resolves (adding or removing a dependency) is refused while a locked version
is under 3 days old. Pass `--minimum-release-age=0` for that one install and
check that the lock diff moves nothing else (DEP-P3b).

**Dependabot** (`.github/dependabot.yml`) opens weekly PRs in groups, at most
10 at once:

| Group | What | Cooldown | Merged |
|---|---|---|---|
| `production` | hono, zod, drizzle-orm, @hono/zod-validator, @noble/ciphers; minor and patch | none | weekly, as they arrive |
| `cloudflare` | wrangler, miniflare, @cloudflare/* | 7 days | in the monthly routine |
| `vite` | vite, vitest, @vitest/* | 7 days | in the monthly routine |
| `types` | @types/* | 7 days | in the monthly routine |
| `dev` | every other package; minor and patch | 7 days | in the monthly routine |
| `actions` | the SHA-pinned GitHub Actions | 7 days | in the monthly routine |

A major that no group takes comes as a PR of its own. Majors of typescript,
@types/node, @biomejs/biome and vitest are ignored: each needs a go/no-go branch
(below), and the comment beside each ignore names its phase. GitHub's
dependency graph does not read bun.lock, so Dependabot raises no alerts for
transitive or dev packages. The weekly **Dependency report** workflow
(`.github/workflows/deps-report.yml`) puts the full `bun audit` and
`bun outdated -r` in its run summary, and never fails.

**The monthly routine.**

1. `bun run deps:check`. It needs the network and never fails. It prints
   `bun outdated -r`, the full `bun audit` and CI's `--prod` gate, lock-check,
   the bun.lock packages the registry marks deprecated, the toolchain pins
   against the local bun and node, specs that differ between workspaces, the
   `compatibility_date` age, and the advisory and release pages of the five
   packages the Worker ships. Also read the latest Dependency report run
   (`gh run list --workflow deps-report.yml`), and drop any line of
   `scripts/audit-ignore.txt` whose advisory has a fix now: CI's audit and the
   release's `audit` gate both skip what it lists.
2. Read those five pages since the locked versions. An upstream repository
   advisory can take days to reach GitHub's database, and `bun audit` reads
   only that database: hono's of 2026-11-01 reached neither.
3. Triage the grouped Dependabot PRs. Each one runs full CI; the gates beyond
   it:
   - `production`: green CI, then `bun run release`, since it ships in the API
     Worker.
   - `cloudflare`: check the branch out, then run
     `bun install --frozen-lockfile && bun run check && bun run build && bun run e2e`
     locally. CI skips build:lua (it builds without the Lua package) and never
     runs e2e. Move the `compatibility_date` with it (below).
   - `vite`: the same local `check`, `build` and `e2e`, then a web release,
     since vite builds what the site serves.
   - `types`, `dev`, `actions`: green CI and a local `bun run check`.
   - PRs that touch bun.lock conflict with each other: merge one, then comment
     `@dependabot rebase` on the next.
4. Dev advisories from the full audit: fix them by an in-range lock refresh,
   or note why not.
5. Look at the toolchain pins: a newer bun 1.x or Node 22.x is bumped in a
   commit of its own.
6. `bun run --cwd apps/api prod:report --days 30`. It is read-only, with the
   ambient read token, and exits 1 only on a crit: a Free quota at 80% of its
   limit, or no successful cron run yesterday. Read every warn, the two SLO
   lines and the match completion share; a missed SLO sends the next session
   to its cause. Run it with `--release` after each release too (`release:finish`
   reminds you); the runbook is `docs/workstreams/backend-data.md` §3.7.4.
7. Record the notable bumps in `docs/decisions.md`.

**Taking a major** happens on a go/no-go branch of its own, never in a group
PR. Write the go criteria first (the dependency audit's §5, phases 5-7, are
the model: `tsc -b` clean, the whole suite passing, `mutants:sample` green, the
CI caches still hitting). Run every gate the routine names for its group. Go
merges it and records the decision; no-go records why, and the ignore line
stays until the next attempt.

**compatibility_date.** `wrangler.jsonc` and `apps/api/wrangler.jsonc` set the
same date, and they move together: with each cloudflare-group bump, and at
least quarterly (`deps:check` flags a date more than 92 days old). Read
Cloudflare's compatibility-flags changelog between the old and the new date.
Then the gates: `bun run check` (its d1 suites run the new workerd), `bun run
e2e`, and a `wrangler dev` smoke (`bun run dev:all`: sign in, open a deck,
play a few turns). Record the move in `docs/decisions.md`.

**Worker types.** `apps/api/worker-configuration.d.ts` is generated: regenerate
it with `bun run --cwd apps/api types` whenever apps/api/wrangler.jsonc, its
`compatibility_date` or wrangler change, and commit it with that change
(`check:static` fails a stale one). Never edit it or run a bare `wrangler types`,
which reads `.dev.vars` (DEP-P3b).

## Pre-push hook

`.githooks/pre-push` is an opt-in hook (BLD-P4) that stops the Biome and
decision-index slips CI would fail on. Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

That setting lives in the clone's shared config, so every worktree of the clone
uses it, each running its own checkout's `.githooks/pre-push`. A worktree on a
branch from before the hook existed runs nothing. Turn it off with
`git config --unset core.hooksPath`. Skip it for one push with
`git push --no-verify`, for instance mid-sweep or when pushing someone else's
red commit on purpose.

- **What it runs.** The stub execs `bun scripts/pre-push.ts`. For each commit
  being pushed, that exports the commit's tree to a temp directory outside the
  repo and runs `biome ci . --error-on-warnings` and
  `scripts/decision-index.ts --check` there, concurrently. It checks what is
  pushed, not the working tree, so another agent's unfinished file in a shared
  checkout neither fails your push nor passes for you. About 3 s on an idle
  machine, nearly all of it Biome. Biome runs on the whole tree rather than the
  changed files: the saving would be about 2 s, and a changed-files run has to
  get first pushes, `biome.json` edits and deleted files right.
- **Secret scan.** When a `gitleaks` binary is on PATH and the pushed tree has
  `.gitleaks.toml`, it also runs `gitleaks git` over the commits the remote
  lacks (`<remote tip>..<tip>`, or `<tip> --not --remotes=<remote>` for a new
  ref or an unfetched remote tip), with findings redacted. Otherwise it prints
  why it skipped. CI runs gitleaks either way.
- **Mutation journal.** Like `check.ts`, it refuses while
  `tmp/mutation-journal.json` (or `MUTATION_JOURNAL_PATH`) exists: the tree may
  hold mutated source, and a commit made from it may carry a mutant.
- It is not a substitute for `bun run check`; tsc, the guards, the Lua tests and
  vitest still run only there and in CI.

## Working beside other agents

Two or three agents share this checkout. Work like it:

- 🛑 **Never mutate the working tree wholesale** — no `git stash`, no
  `git checkout -- <path>`, no `git reset --hard`. Uncommitted work has been
  destroyed that way; the mutation harness was rebuilt around exactly this rule
  (D215 — it holds the original bytes rather than asking git). Read history with
  **`git show <rev>:<path>`**.
- **Commit with EXPLICIT PATHS.** Never `git add -A`, never `git commit -a`.
- ⚠️ **`decisions.md` and the engine version are SERIALISATION POINTS.**
  `decisions.md` lost three rows to concurrent writes (D177's and D187's had to
  be reconstructed after the fact — D176, D187), and three pairs of slices claimed
  the same engine version from the same base (D186/D199 both took 0.127.0;
  D202/D204; D207/D210/D208 all took 0.133.0). Every collision needed hand
  arbitration, and two engine-behaviour commits reached HEAD with **no version
  block at all** (D208 paid it). If you cannot hold `index.ts`, declare the bump
  **OWED** in the commit body.
- **Annotate provenance; never overwrite it.** How a claim was warranted at the
  time is what this repo keeps losing (D178; D180's follow-up kept the
  asserted-from-doc paragraph and added the measurement beside it).

## Git / commits
- Branch off `main` for non-trivial work; commit/push only when asked.
- Commit trailer per global config: `Co-Authored-By: Claude ...`.
- **Explicit paths only, and never touch the tree wholesale** — see "Working
  beside other agents" above. It is the rule this branch pays for most often.

## Mutants are DECLARED, not narrated (D211)
Roughly thirty `decisions.md` rows publish a mutant tally — *"13 mutants, 3
survivors"*, *"36 written, 36 killed"* — and until D211 **every one of them was
unreproducible by construction**. Nothing re-ran them and nothing regressed them,
so a slice reporting *"12 killed"* while the suite would actually have passed
three of them was **indistinguishable from an honest one**. Those tallies are
also the only evidence on record that this repo's guards discriminate at all —
which is exactly the class this session proved rots (D200 → D204 → D205 each
shipped a flag that ran, passed, and was worthless).

So: **if you write a mutant tally, the mutants go in `scripts/mutation/mutants.ts`.**

- A mutant is **data**: `{id, decision, what, file, find, replace, expectKilledBy}`.
  `find` is exact source text and **must occur exactly once** — zero matches is an
  ERROR (the code moved; re-transcribe the row), not a skip. That is the row's
  expiry date: *a line number rots silently, a unique string rots loudly.*
- `bun run mutants` applies each one to the real file, runs only
  `expectKilledBy` (≈2 s, versus ≈70 s for the full suite), and restores. Whole
  corpus at D215: **42 mutants / 138 s**. `--only` / `--decision` / `--full` /
  `--list` / `--allow-dirty`.
- **A green baseline is a precondition.** If the target suites are already red,
  the harness reports ERROR rather than a verdict — because "the suite went red"
  would otherwise mean nothing. This fires for real when a sibling agent is
  mid-slice in the same tree.
- **A mutant must be the mistake an author would actually make** — in practice, a
  neighbouring arm's REAL code copied verbatim (D190b: Scorching Armor's status
  onto Poison Point; D199's 36 are all neighbour copies). A straw mutant proves
  nothing about a real defect.
- 🛑 **A ROW THAT SURVIVES BECAUSE IT CHANGES NOTHING IS WORSE THAN NO ROW — IT REPORTS A SUITE GAP
  THAT DOES NOT EXIST (D420).** A mutant mutated a `case` LABEL with a TypeScript `as` assertion,
  which is **erased at runtime**: the arm still matched, the row expressed no defect, and the sweep
  dutifully reported a GAP. ⚠️ **BEFORE BELIEVING A SURVIVOR, CHECK THAT THE MUTATION IS OBSERVABLE
  AT RUNTIME AT ALL** — types, `as`, `satisfies` and anything the compiler erases are not mutations.
  This is the mirror of D416's rule (*a row that dies for the wrong reason*), and the two together
  are the whole of what makes a tally mean anything.
- 🛑 **A RECIPE IN A DOC BLOCK IS A CLAIM, AND IT CAN SHIP A DEFECT NO CODE REVIEW WOULD CATCH
  (D420).** D417 wrote *"a successor adds a row and stops — no anchor, no arm"*. Following it
  literally would have stepped `BUILT.attack` while the sentence still fell to the loud skip path —
  **built-but-dead, authored by prose.** The corrected rule states its PRECONDITION: *a row costs a
  row IFF its head is already claimed.* ⚠️ **WHEN YOU WRITE A "JUST DO X" NOTE FOR A SUCCESSOR, WRITE
  THE CONDITION UNDER WHICH X IS ENOUGH** — and if you cannot state it, you have not finished
  understanding the mechanism.
- 🛑 **A SURVEY IS AS NARROW AS THE SHAPE IT GREPS FOR (D419).** D418 surveyed for a MODULE-LEVEL
  reader array and found 40 files; there were **47**, and the six it missed were the ones that hid
  the defect best — **inline declarations inside test bodies, every one a refusal rung, where a short
  list makes the claim NARROWER rather than FALSE and so nothing ever reddens.** ⚠️ **WHEN A SURVEY
  DRIVES A SLICE, STATE THE SHAPE IT SEARCHED FOR AND ASK WHAT THAT SHAPE CANNOT SEE.** This is
  D310's census rule ("a census is as narrow as the columns its query names") with an instrument in
  place of a catalog.
- ⚠️ **A CLOSE-OUT CLAIM IS A CLAIM, AND IT ROTS THE SAME WAY A FIGURE DOES.** Three close-out
  assertions in four slices were falsified by grepping them — *"the derivation now exists exactly
  once"* (it did not), *"the sweep has not run"* (it had), *"the writer is unidentified"* (it was
  identifiable). **Check the sentence you are about to write into `decisions.md` the same way you
  would check a number.**
- 🛑 **RE-POINTING A REFUSAL RUNG ONTO A DIFFERENT TRUE CLAIM CAN SILENTLY DROP THE DISCRIMINATION
  THE OLD CLAIM PROVIDED (D418).** This run re-pointed refusal rungs four times, correctly, on the
  rule *re-point, do not delete*. The fourth one still disarmed a mutant: a rung that had asserted
  *"no reader takes this sentence"* became *"this reader takes it"* — both TRUE, but the new claim is
  `true` under the mutant and under the real build alike, so only the old one could ever go red.
  ⚠️ **THE RULE NEEDS ITS SECOND HALF: after re-pointing, ask what the OLD claim could catch that the
  new one cannot** — and if a mutant row names that file as its killer, run `--only <row>` before you
  commit. Re-arming cost one assertion once it was found; finding it cost a 92-minute sweep.
- 🛑 **A DEFECT EVERY LOCAL DECISION IS RIGHT TO DECLINE HAS NO LOCAL FIX (D418).** A stale reader
  array was left unfixed for **179 commits** because every slice that met it was CORRECT to decline:
  *"adding a tenth reader would move numbers this slice has nothing to do with."* True of each slice,
  and fatal in aggregate — the defect grew from one missing reader to three, and ended up wrong in
  **38 of 40 files**. ⚠️ **THE MOVE IS NOT TO OVERRULE THE ARGUMENT, IT IS TO REMOVE ITS PREMISE.**
  D418 made the figures come off a module-derived surface FIRST; widening the array then moved zero
  digits and the objection dissolved rather than being argued with. **When a refusal keeps being
  right, attack what makes it right.**
- ⚠️ **A REPAIR THAT DOES NOT COMPOUND IS A DEBT WITH INTEREST (D418).** The declining slice worked
  around its blind spot by deleting one sentence from a list instead of fixing the array. By the time
  the array was fixed, that workaround had become a rung which would go **RED if anyone fixed it** —
  the repair actively defending the defect. **Prefer a fix that makes the next one cheaper; if you
  cannot, say in the comment that you are choosing a workaround and why.**
- 🛑 **AN INSTRUMENT WITH A HAND-KEPT COPY OF SOMETHING THE MODULE ALREADY EXPORTS CANNOT GO RED —
  IT CAN ONLY GO QUIET (D417).** `censusAtHead.test.ts` computed `BUILT.attack` — the figure most of
  this repo's accounting keys off — from a **stale 11-entry reader list against 12 exported**, and
  stayed green, because every figure it asserts is derived from that same stale list. It had had no
  guard since the file was written at **D233**. ⚠️ **THE GUARD IS NOT "KEEP THE COPY UPDATED", IT IS
  "DERIVE IT FROM THE MODULE AND PIN BOTH THE DIFF AND THE COUNT"** — the count separately, because a
  diff alone stays green when a reader is deleted from the module and the list together.
  ⚠️ **AND WHEN YOU ADD THAT GUARD TO ONE FILE, GREP FOR THE OTHER COPIES IN THE SAME BREATH.** There
  were **eight** more, at 9 and 11 readers, none guarded — and all eight carried a doc claim that
  their list was *"the same set `censusAtHead.test.ts` uses"*, false in every one.
- 🛑 **A GUARD THAT ONLY EVER RUNS ON THE FORCED PATH DOES NOT GUARD THE PARKED ONE (D416).**
  `parkOrForce` auto-resolves at ONE candidate, so a suite whose boards all field one candidate
  exercises the forced arm exclusively — and every assertion still passes, which is exactly why it
  reads as covered. D416's marker on the `applyChoice` path had **no witness at all**, and only a
  mutant found it. ⚠️ **WHEN AN OP CAN PARK, COUNT THE CANDIDATES YOUR BOARDS ACTUALLY OFFER.** If
  none offers two, the park is untested however many cases there are.
- 🛑 **COPYING A FUNCTION COPIES ITS MUTANTS' ANCHORS, AND THE CORPUS GOES QUIET RATHER THAN RED
  (D416).** A new funnel written by copying `gustTargets` made three existing rows match TWO sites —
  `find occurs 2×`, D404's wrong-arm trap. `precheck` catches it mechanically, **but only if you run
  it**; a sweep would have reported a phantom verdict about the wrong function. ⚠️ **The repair is
  TWO-SIDED**: re-anchoring the old rows onto lines the original uniquely owns leaves the COPY
  untested unless you also write rows for it — otherwise you have moved a tested line into a file
  nothing pins.
- 🛑 **A CLAIM THAT IS COPIED IS A CLAIM THAT ROTS IN N PLACES (D415).** A census note written at
  D414 was wrong three ways and had been replicated **byte-identically into 21 sites across 10
  suites**. Correcting the original would have left twenty copies asserting the false version.
  ⚠️ **BEFORE CORRECTING A COMMENT, `grep` FOR ITS FIRST DISTINCTIVE CLAUSE.** If it appears more than
  once, the correction is a SWEEP and its cost is the sweep, not the sentence. Hash the copies first:
  if they are identical, one wording fits all; a drifted copy needs its own reading.
- 🛑 **A LINT FIX IS AN EDIT TO A MUTATED FILE — RE-RUN `precheck` AFTER ONE (D414).** A row was
  authored, prechecked clean, and then its quoted block gained a `biome-ignore` comment when
  `bun run check` flagged `noThenProperty`. The `find` stopped occurring and the row reported ERROR
  ninety minutes into a whole-corpus sweep. **The exactly-once rule caught it, which is the point —
  but `precheck` costs seconds and the sweep costs ninety minutes.**
  ⚠️ **THE GENERAL FORM IS BROADER THAN "A LINT FIX", AND D415 PAID FOR THE DIFFERENCE: ANY edit to a
  file the corpus quotes rots a row — including a TEST-ONLY edit made by an agent you delegated to.**
  Paying an unrelated debt added one sentence to a set a mutant quoted, and it was committed without
  re-running `precheck`. **Run it before you commit, not after the sweep tells you.**
- ⚠️ **A RE-TRANSCRIPTION CAN BREAK A ROW'S MEANING WHILE FIXING ITS ANCHOR.** The same repair first
  pointed a `conditionGate`'s `cond` at a union member that does not exist. That mutant would have
  been KILLED — by an exhaustive switch throwing, not by the rule the row is about. **A row that dies
  for the wrong reason is worth less than one that survives**, because it reports success.
  Re-transcribe onto a REAL neighbour with an inverted meaning.
- ⚠️ **Anchor every pattern.** An unanchored regex mutated a byte-identical arm
  in a different card's program and reported a **phantom survivor** — the
  wrong-row failure, which has now cost three slices (D207). The exactly-once
  `find` rule above is what catches it mechanically (D215).
- **An unreachable survivor is REMOVED, not tested around** (D205's `count <= 1`
  caption, D206's unkillable state-identity guard, D208's provably-dead
  `dealt <= 0`) — a test written to kill it would be the next vacuous guard.
- ⚠️ **A SURVIVOR IS THE INTERESTING OUTPUT, and a legitimate one is declared.**
  Add `survives: {kind, reason}` for the correct-and-unreachable cases this repo
  keeps finding — `equivalent` (D196's declaration snapshot),
  `unreachable-population` (D202's leading `^`: every near-miss the catalog
  prints carries its clause at the start), `unreachable-shape` (D205's
  never-spelled `count: 1`). It is **the opposite of an allowlist**: a declared
  survivor that gets **KILLED** reports `STALE-SURVIVOR` and fails the run,
  because the recorded reason has stopped being true.
- 🛑 **A LIVE RUN AND A CRASHED ONE LOOK IDENTICAL FROM THE OUTSIDE — CHECK `ps`
  BEFORE YOU BELIEVE THE TREE (D411).** A mutant on disk, a
  `tmp/mutation-journal.json`, and a red suite are all NORMAL MID-SWEEP STATES,
  and one 89-minute sweep produced all three and fooled a reader with each: a
  mutated `interpreter.ts` read as a leftover clobber, the journal read as
  wreckage, and a `bun run check` racing the sweep read as *"HEAD is RED"* (it
  had caught `D378-presence-keeps-the-owner-test` mid-window; HEAD was green).
  **THE FIX FOR ALL THREE IS ONE COMMAND**: `ps aux | grep 'scripts/mutation/run.ts'`.
  ⚠️ **And `bun run mutants` was itself the writer of that sweep's one CLOBBER** —
  the recovery path took a live run's journal for a dead one's, which is why
  `recoverFromJournal` now checks whether the journal's PID IS ALIVE and refuses
  (exit **3**, distinct from the **2** that means a dead run was recovered).
  **NEVER RUN THE HARNESS, OR A `check`, WHILE A SWEEP IS IN FLIGHT.**
  `scripts/check.ts` now refuses to start while the journal exists, and says
  whether its writer is alive; `CHECK_DURING_MUTATION=1` overrides it.
- **A hung mutant is killed at its deadline** (five times its baseline, never
  under a minute) and counts as KILLED, tagged `TIMEOUT` in the progress line,
  the table and a list under the summary line.
- ⚠️ **Fixing the instance is not fixing the class.** D369 hit exactly the defect
  above through `--list` and repaired it by moving that one read-only command
  ahead of the recovery — correct, and it left every WRITING invocation walking
  into the same hazard for forty decisions. **When a fix reorders ONE caller past
  a landmine, ask what the other callers do.**
- ⚠️ **Restoration never uses git** — not `checkout`, not `stash`. The harness
  holds the original bytes and writes them back, so a tree carrying another
  agent's uncommitted edits comes out the way it went in. Four nets:
  `try/finally`, signal handlers, `process.on("exit")`, and a **journal** at
  `tmp/mutation-journal.json` written *before* the file changes — the only net
  that survives `kill -9`, and the next invocation restores from it and refuses
  to run.
- 🛑 **THE HARNESS WILL NOT WRITE TO A DIRTY FILE (D215).** *A tool that can eat
  a colleague's uncommitted work is worse than no tool*, and this checkout runs
  two or three agents at once. So immediately before each write — and again after
  the baseline run, because that takes a minute and a sibling can start inside it
  — `git status --porcelain <file>` must be **empty**. Otherwise the row reports
  **`SKIPPED-DIRTY`** and is never mutated. ⚠️ The gate is **per file, not
  per tree**: a whole-tree refusal would make the tool unusable in the only repo
  it exists for, and would be a *weaker* guarantee anyway (clean at startup says
  nothing about minute four). A failed `git status` counts as dirty — the gate's
  failure mode is refusal.
- 🛑 **A mid-window write is a `CLOBBER` verdict, not a warning.** If the bytes on
  disk after the run are not the ones the harness wrote, the interloping version
  is preserved beside the journal **and the mutant's verdict becomes `CLOBBER`**,
  because its answer is untrustworthy and somebody has to go look. D211 only
  printed to stderr, so a run that overwrote a save still ended *"0 gaps"* and
  exited 0.
- **Skips and clobbers count against the exit code.** A mutant the harness
  declined to check is not a mutant that passed, and the exit code is the only
  part of the output a CI step reads. `--allow-dirty` overrides the refusal, for
  the one honest case: an author iterating on their **own** uncommitted change.
- **`killedByCommand`** names a non-vitest killer as an argv array (no shell) for
  guards that are scripts rather than suites — D212's lint-coverage guard, whose
  mutants are on `biome.json`. `--full` is ignored for such a row.

⚠️ **WHAT THE HARNESS DOES NOT PROVE.** It is not coverage, and a green table is
not *"the suite is good"*: it says these specific defects on these specific lines
are caught by these specific suites, today. It does not **generate** mutants —
every row is hand-transcribed, so it can only re-check claims someone already
made, never find the defect nobody thought of. A KILLED verdict reads the **exit
code**, not the failure message, so it proves the suite goes red and not that it
goes red for the right reason. `expectKilledBy` is an author's judgement, and
narrowing it wrongly makes a mutant "survive" a suite that never loaded the line
(`--full` answers that when it matters). It says nothing about the ~18 decision
rows whose tallies are still only prose (D211 seeded 6 decisions, D215 added 7).
And ⚠️ **it says nothing at all about a row reported `SKIPPED-DIRTY`** — a run in
a busy checkout answers for a *subset* of the corpus, and names which.

### Where dev scripts sit
`scripts/**`, `apps/api/scripts/ingest.ts` and `packages/schema/scripts/
validate-live.ts` are all **outside `tsc -b`'s project references and outside
vitest's `include` globs**, deliberately: a dev tool has no business in the app's
build graph, and a harness meant to check the suite has no business inside it.
Bun runs the TypeScript directly. **Biome lints every one of them** — including
the repo-root `scripts/**` and `vite.config.ts`, as of D212.

### Lint coverage is CHECKED, not asserted (D212)
Until D212 the sentence above was **false at the repo root and nothing noticed**.
`files.include` was `["src/**","apps/**","packages/**"]`, so Biome reported *zero
files processed* for `scripts/` **even when the path was passed explicitly** —
and `scripts/catalog-manifest.ts` had been unlinted since the day it was written.
The reason it survived is the shape this session keeps hitting (D200/D204/D205,
D203, D209): **`biome lint <path>` exits 0 on a path it processed zero files
for**, so a CI lint step covering the path proves nothing. The exit code is not
the observation; the **file count** is.

So: **`bun run lint:coverage` (`scripts/lint-coverage.ts`), a step of
`bun run check`.** It hands Biome the repo's entire source-file list in one
invocation and requires the reported count to equal the list's length — Biome
silently drops paths `files.include` misses, so `checked < passed` *is* the
uncovered set. It names the files. **Delete a directory from `files.include` and
`bun run check` goes RED**; verified by doing exactly that three ways.

- `lint` / `lint:ci` / `format` now pass **`.`**, not a hand-kept path list.
  Those lists were the *second* place coverage could rot, independently of
  `biome.json`; now `files.include` is the single source of truth and the guard
  audits it.
- ⚠️ **Biome 1.9's `files.include` globs are NOT path-anchored.** `src/**`
  matches `apps/api/src/**` and `packages/*/src/**` too — measured: with
  `include: ["src/**"]`, `biome lint .` checks 482 files, not 208. So an include
  entry covers more than it reads like, and a *narrowly* passed path argument can
  hide that. Always observe with the count, never read the config and infer.
  **Biome 2 (DEP-P7)** anchors globs at the config's directory, so
  `biome migrate` rewrote each entry as `**/src/**` and so on to keep 1.9's
  coverage, and the old `files.ignore` became `!` entries in `files.includes`.
  For these top-level directories the two forms cover the same 1058 files
  (measured); lint-coverage, not the glob's spelling, is the check.
- **Biome 2 does not touch Markdown** (`!**/*.md`, dependency audit decision 10):
  Biome 2 formats `.md`, and the docs are hand-wrapped prose. Format them in a
  change of their own if ever.
- **Biome 2 refuses a second root config** below the one it started from
  ("Found a nested root configuration"). `scripts/lib/generated.ts` formats a
  generated file with a temp config under `tmp/`, so it runs Biome *from that
  directory* (`cwd: dir`); run from the repo root, every generator's `--check`
  fails.
- ⚠️ Passing `.` reports **exactly one more file than the sum of its parts**
  (509 vs 508) under every include set tried — a constant artifact of the `.`
  argument itself, not a file. The guard passes explicit file lists, so it is
  immune.
- What the guard does **not** cover, stated: script extensions only (JSON is out
  — pulling drizzle's generated snapshots into the lint set is its own decision),
  and it says nothing about whether the rules are good, only whether the linter
  can see the file.

## Tool gotchas

Lessons from the card-coverage program that still hold. Each ends with the start of its section's
heading in `archive/conventions-lessons.md`.

- `grep` in the agent shell is ugrep (`type grep`): it skips ignored files and has dropped every
  other match of an ERE. Check a count that goes into a doc with `command grep` or a script.
  *"`grep` here is `ugrep`"*, *"This repo's `grep` can silently UNDER-COUNT an ERE"*
- `grep -c` counts lines, not structure, and `grep -oP` with a negated class counts prefixes: grep
  the structural spelling (`file: "…"`, a key) or derive the count from the module.
  *"`grep -c` counts text, not structure"*, *"`grep -oP` with a negated class can MERGE"*
- An anchored pattern misses a match mid-line, and a stem misses its derived noun (`devolv` finds
  no "devolution"). Grep the loosest shape and say what it cannot see.
  *"A chain head can sit MID-LINE"*, *"Grepping prose: the derived noun"*
- Run repo scripts from the repo root: tsconfig references, vitest globs and mutant `file` paths
  are root-relative. *"Run every repo script FROM THE REPO ROOT"*
- Vitest stops an `it` at its first failing `expect`: after a red run, fix every site in the file,
  not one per run. *"Vitest stops an `it` at its first throw"*
- `s.replace(find, str)` reads `$&`, `$n` and `` $` `` in `str`, so pass `() => str`; Python's
  `re.sub` reads backslashes in its replacement, so splice with slices.
  *"`String.replace(find, replacementString)` interprets `$`"*, *"`re.sub`'s replacement string"*
- `open(p, "w")` empties the file before `.write()` runs, so encode first. A script that patches a
  source file asserts its `find` count and restores the file in `finally`.
  *"ENCODE FIRST, WRITE SECOND"*, *"A probe that patches a source file must restore it"*
- `biome --write` rewrites whole files: in a shared checkout format only the paths you changed,
  and rerun `bun scripts/mutation/precheck.ts` after a format or lint fix to a file the corpus
  quotes. *"Never run a formatter on a shared tree"*, *"`biome --write` on explicit paths"*
- Biome counts a file over `files.maxSize` as checked and lints none of it; `lint-coverage` then
  fails, and the fix is raising the limit (`mutants.ts` is the file nearest it).
  *"The mutation corpus is a source file and Biome refuses it above `files.maxSize`"*
- The harness picks rows with `--only a,b` or `--decision D<nnn>`; the precheck is its own script.
  `run.ts` refuses an unknown or repeated flag (an ignored one used to run the whole corpus).
  *"The row-selection flag is `--only`"*, *"Process: the precheck command"*
- A killed run leaves its mutant in the file, and two concurrent `--allow-dirty` probes restore
  each other's files: run one at a time, and let the next `run.ts` restore from the journal.
  *"A killed `--allow-dirty` probe leaves its PATCH"*
- A sweep is done when its summary line is in the log; a modified file mid-sweep is normal. Copy
  the line, never retype it:
  `<n> killed · <n> known survivor(s) · <n> GAP(S) · <n> stale · <n> skipped(dirty) · <n> clobber(s) · <n> error(s) · <n>s total`.
  *"The only reliable done-signal for a sweep"*, *"Quote the harness line VERBATIM"*
- `pgrep -f` and `ps aux | grep` match the asking shell's own command line: anchor on argv
  (`ps -eo args | grep -E '^bun scripts/mutation/run\.ts'`) and check the journal's pid.
  *"Process finding: argv-anchored process checks"*, *"`pgrep -f` matches the command"*
- Detach a long sweep with `setsid --fork` (plain `setsid` does not fork a backgrounded job) and
  put the `ps` read in the log; `SID == PID` is the proof, and the PPID may be systemd's, not 1:
  `setsid --fork sh -c 'ps -o pid,ppid,sid,cmd -p $$; date -Is; exec bun scripts/mutation/run.ts' > tmp/sweep-<name>.log 2>&1 < /dev/null`.
  It still dies on a reboot, with the same log tail. *"Plain `setsid` does not FORK"*,
  *"Put the `ps` read INTO the log"*, *"A detached sweep survives its LAUNCHER but not a REBOOT"*
- `$?` after a pipe is the last stage's status: use `set -o pipefail` or `${PIPESTATUS[0]}`.
  *"Three small harness facts D467 paid for"*
- In a second worktree, install there and check that every `@colorless` link, nested ones
  included, resolves inside it; a borrowed `node_modules` tests the main tree's source.
  *"Building a slice in a SECOND CHECKOUT"*, *"A worktree's isolation check is EVERY"*
- Auto mode refuses `git commit --amend`: write the final message when you commit.
  *"`git commit --amend` is refused in auto mode"*
