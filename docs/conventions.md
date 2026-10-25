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
- Load **`progress.md` + the one relevant `workstreams/*.md`** (+ its
  `reference/`). Don't read unrelated workstreams or sweep the repo.
- Prefer facts already written in these docs over re-deriving them.

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

## Code & quality
- TypeScript strict; match the surrounding code's style.
- **Comments are minimal (2026-10-23).** Comment only what the code cannot say:
  a game rule or card wording it implements, a non-obvious invariant or ordering
  constraint, or why something is done an unexpected way. No decision ids, emoji
  markers, history ("was", "now", "corrected"), census counts, dates or line
  numbers in code or tests — that record belongs in `docs/decisions.md` and git.
  Tests must not read source or doc text, and must not pin `engineVersion`.
- **Biome** for lint/format; **Vitest** for tests. Run **`bun run check`** before
  calling work done. It is `check:static` (coverage guards, `tsc -b`, `biome ci`,
  Lua constants, the mutant `precheck`), `check:lua` (the headless Lua tests,
  requiring Balatro's source) and `check:test` (vitest). CI runs the same three
  names, except that Lua tests needing Balatro's source are skipped there. Run
  `bun run format` before committing. `bun run release` runs check, the remote D1
  migrations, the API deploy and then the web deploy, in that order.
- Vitest has two projects (`vitest.config.ts`): `engine` runs without per-file
  isolation, so engine suites must not use mocks, stubs, fake timers or other
  module-level state that leaks between files; `app` covers everything else.
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
  seeded play-forward sweeps; `createLobbyHarness` (`apps/api/src/lobby/lobbyHarness.ts`)
  for LobbyDO; `useTestD1` (`apps/api/src/testing/d1.ts`) for routes on a real D1.
  A change to the stored game shape fails `recordShape.test.ts` until
  `MATCH_RECORD_VERSION` is bumped and the snapshot rewritten with `-u`. A change to the
  Lua wire fails `src/lua/wireFixtures.test.ts`; regenerate its fixtures with `-u` and
  update `frontend/lua/tests/wire_fixtures.lua` to match.
- Reuse the shared engine helpers instead of re-spelling them: `inPlayOf`,
  `bodyAt`/`pokemonAt`, `relativeSeat`, `turnOwnerOf`, `clearedAttackEffects`,
  `HP_PER_COUNTER`/`damageCountersOn` (`types.ts`); `OpOf<K>` for one `EffectOp`
  variant (`effectTypes.ts`); `positiveInt`, `printedFlipCount` and the gate
  builders in `effects.ts`; `searchThenShuffle`/`activated`/`berry`
  (`registryBuilders.ts`). The op contract lives in `effectTypes.ts`, program
  types in `programTypes.ts`, and stepOp's arm bodies in `ops/*.ts`,
  `effectTargets.ts`, `boardCondition.ts`, `effectPrompt.ts` and `promptText.ts`;
  `interpreter.ts` keeps runProgram, stepOp, applyChoice and resume. Every op
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
- `scripts/residue-census*.ts` and `scripts/opaque-anatomy*.ts` were deleted
  (2026-10-23) after measuring zero residue; sections below that describe them
  are history.
- An engine function that appends to an `events: GameEvent[]` out-parameter takes it as its last
  positional parameter, after any options record; optional parameters before it are passed
  explicitly (`undefined`, or `{}` for a fresh `EffectRecord`).
- Pure logic gets unit tests (see the many `*.test.ts` in the repo); DOM tests
  opt into jsdom per-file (`// @vitest-environment jsdom`).
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
  reduced-motion slices "verified" by grepping the built CSS for
  `.motion-reduce\:transition-none` — `glass.ts` already emitted that rule, so
  the check was green before the work started. What rescued it was an
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
  The engine gate and `redact.ts` were routed through a single new reader; **`GameHud.tsx` was the
  third site and was still spelling the old field by hand** — a live afford-then-reject, found by
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
  and legality is a hard filter on it — D180's four *correct* alias rows serve
  **zero** Standard-legal printings (D187, D180 follow-up).
- **Exact map or flag.** A registry row has no deriver behind it to refuse what
  it cannot parse, so whatever is authored is what the card does forever: a
  wrong-but-plausible program is strictly worse than an unbuilt one, which at
  least fails loudly (D190b, D199).
- **Re-triage a deferred list against the code, item by item — do not read it.**
  D195: an old list's *"every item was fixed"* was one item too generous, and a
  deferred note **named a remedy rather than the defect** (the real fix touched
  neither thing the note pointed at).

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
- ⚠️ Passing `.` reports **exactly one more file than the sum of its parts**
  (509 vs 508) under every include set tried — a constant artifact of the `.`
  argument itself, not a file. The guard passes explicit file lists, so it is
  immune.
- What the guard does **not** cover, stated: script extensions only (JSON is out
  — pulling drizzle's generated snapshots into the lint set is its own decision),
  and it says nothing about whether the rules are good, only whether the linter
  can see the file.

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

## Pricing a sentence (D421)

**The mechanism count is not the sentence's shape.** *"This Pokémon can't use
Blaze Blitz again until it leaves the Active Spot."* reads like three edits — an
anchor, a reader arm, an op — and cost five. The two extra sites were invisible
from the text and each would have shipped a live defect: the field's PRUNE would
have garbage-collected an unbounded bar, and the LOG row would have promised the
wrong duration. **Before pricing a sentence, grep every writer and every reader of
the field it lands in.** The invisible mechanisms live in the code that MAINTAINS
the state, not in the code that interprets the sentence.

**A log row is a claim with the same standing as a predicate.** The test is never
*"does the row name the duration?"* but *"does it assert something this path makes
untrue?"* — a row saying "next turn" on a bar with no clock is not stilted, it is
false, and false in the direction that costs a player a turn.

## Optional keys / widenings (D421)

**An optional rider should fail LOUD.** A widening is free at the version boundary,
which makes it tempting to stop thinking once the bump is avoided — but a build
that DROPS the rider still has to be detectable. D421 stamps `LockedAttack.turn`
with the install turn rather than `+ 2` for exactly this reason: `+ 2` would make a
lost rider degrade silently into the neighbouring next-turn lock, while the install
turn produces a bar stamped for a turn already spent, visible on the next board.
**When you add an optional key, choose the REST of the record so that losing the
key is detectable.** A widening that degrades into plausible behaviour will be
mis-read for a year.

**Same fact, same spelling, every surface.** D421's rider is the identical key with
the identical value on the op, the persisted record and the event. That is the
design, not a coincidence — it is what stops a reader honouring the rider in one
place and forgetting it in another.

## Re-pointing a swept claim (D421)

When your slice makes a swept census case newly true, **widen the claim rather than
excluding your own case from it.** D421's attack-name sweep in `perAttackLock.test.ts`
began matching the new rider; the fix was to widen the assertion to "under EITHER
printed duration", not to filter the rider out. Excluding it would have narrowed a
swept census back into a hand-kept list — which is precisely the defect D419 spent a
whole slice removing.

## Deciding a discrepancy (D421)

When the code and the printed text disagree and you are keeping the code, **write the
decision down at the site and pin it with its own test.** `evolveOnto` lifts D421's
bar though the Pokémon never left the Active Spot; that is right (§10 removes the
effects of attacks on evolution) but the sentence does not say it. A successor who
finds an untested discrepancy assumes an accident and "fixes" it. **A decision that
is not pinned is indistinguishable from an oversight.**

## Confidence markers (D422)

D421 produced the rule "mark which of your claims are MEASURED and which are
REMEMBERED". **Its very first use attached `MEASURED` to a partial measurement**:
a universal — *"`declinable` no longer exists on any prompt"* — generalised from
the first five hits of a `grep -c` whose counts ran into the hundreds.
`choosePokemonMulti` carries it as a REQUIRED field. The conclusion survived by
luck; the stated reason was wrong and was repeated at four sites downstream.

**A confidence marker is only as good as the check behind it, and a mislabelled
claim is worse than an unlabelled one** — an unlabelled guess invites checking, a
mislabelled one forbids it. **Say WHAT you measured and HOW, not that you
measured.** "grep -c across packages/ returned N, I read all N" is a measurement.
"I grepped it" is not.

**Corollary — a universal needs a total check.** Any claim of the form "no X
anywhere does Y" must be backed by reading every hit, or stated as the partial it
is: "the five sites I read do not do Y".

## Stale refusals (D422)

**A stale refusal is more expensive than no refusal, because a refusal is read as
a measurement.** D422 was priced in a doc block as a blocked vocabulary slice
needing a prompt field that does not exist. Every clause of it was false — the
field had been renamed ~60 slices earlier, and the decline the block said had
nowhere to live sat one op earlier the whole time. The correct note, D227's, was
four lines away and **sat unread for roughly 195 decisions**, because the louder
and wronger block beside it kept every reader away.

**When you refuse a slice, write the CONDITION THAT WOULD REVERSE THE REFUSAL**,
so a successor can test it in one command instead of trusting it. A refusal
without a falsifier is an assertion with a long shelf life and no expiry date.

**And when a slice pays a price a doc block quoted, rewrite that block to record
what the price ACTUALLY was.** Leaving it is how the next reader pays the quoted
price instead of the real one.

## Precedents (D422)

**Drive the precedent you cite.** D422 leaned on a shipped mirror sentence to
settle its empty-bench behaviour and discovered that board was never driven.
Citing an unpinned precedent is how a false claim propagates: afterwards it reads
as TWO confirmations of something nothing ever tested. **If you cite a shipped
case as settling a question, check that it is driven — and drive it if it is
not.**

## Computing the unmapped residue (D422)

`legalAttackCorpus()` minus `resolvedByAnyReader()` is **not** the set of
printings that do not work. It is keyed on *"no whole-sentence reader claims this
string"*, and misses three ways a printing can already be served: a registry row,
`splitAttackGateClause`, and `splitAttackTrailingClause`. At D422's head that is
**47 of 359 printings already working**, and `censusAtHead.test.ts` closes the
identity directly. Ranking candidates on the raw difference put two
already-fully-built sentences at the top of the list, one of them the highest by
printing count. **Subtract the three served sets before ranking anything**, and
compute it on a quiet tree — importing the instrument during a mutation sweep
answers about a half-written module.

## Pinning an absence (D423)

**A true assertion can stand in for a false claim, and nothing goes red.**
`opponentCounterScaling.test.ts` pinned "the multiply twin of this count source
is printed NOWHERE" by asserting that one constructed sentence derives to null.
The assertion was true — its string used an amount (`per = 30`) that nothing
prints. The claim was false: three Standard-legal printings carry the same shape
at `per = 20`. The two were never the same proposition, and only the assertion was
executable, so the guard stayed green for 255 decisions while actively warning
future slices away from correct work.

**PIN AN ABSENCE ON THE POPULATION, NOT ON A SPECIMEN.** Assert that the census
returns zero rows for the shape. Do not assert that one hand-written string
derives to null — that is a specimen-shaped guard, green forever, and it means
nothing about the pool.

**And an absence sitting next to a disproved absence is not thereby disproved —
nor is one sitting next to a surviving claim thereby safe.** Re-measure each on
its own. D423 re-measured three: two held, one needed annotating.

## Scoped claims (D423)

**A claim scoped to a population must carry that population to every site it is
copied to.** D168's decision row said *"the local D1, 2026-08-03, 978 cards / 6
sets"*, and its measurement was EXACT on that population — re-running the literal
against those six sets returns precisely the figure it recorded. Its doc block
said *"the pool"*. The row was right, the copy was wrong, and **the copy is what
every later reader saw**. This is the two-populations-two-answers failure (D413)
reaching a pinned absence rather than a refusal.

The mechanised half of this rule already exists and works: `catalogManifest.test.ts`
reddens when "978 cards" is written without "/ 6 sets", and it fired on 13 fresh
offenders mid-slice during D423 — catching the author, not a successor. **Prefer
widening that guard's reach to trusting prose.**

**Corollary: when you disprove a claim, date it before you rewrite it.** "Wrong
when written" and "true then, rotted since" are different faults with different
fixes, and the distinction is usually recoverable — from the decision row's own
scope, from denominator identities that would have moved, or from git history.
Do not write "rotted" for a claim that was never true.

## Sites are not mechanisms (D423)

**Price the MECHANISMS, then separately count the SITES.** D423 predicted one
regex and one arm and was exactly right about the shape — then touched 27 sites,
20 of them census literals across 13 files, in up to four layers per file,
including a bare-literal operand (`356 − REGISTRY − SPLIT − COMPOUND`) that
`grep 'toBe(N)'` cannot find. D421 made the identical error by a different road —
mechanisms invisible in the code that MAINTAINS state. Two roads, one class: the
number you are confident about is the shape, and it tells you nothing about the
blast radius.

## Enumerating a family (D424)

**The enumerations are the unreliable part, not the reasoning.** Three briefs in
four slices carried an incomplete enumeration, each by a different route:

- **D421** asserted an apostrophe byte from memory — U+2019 where the byte is U+0027.
- **D422** generalised *"no prompt carries `declinable`"* from the first five of
  ~200 grep hits; `choosePokemonMulti` carries it as a REQUIRED field.
- **D424** enumerated a sentence family with `is now (X) and (Y)`, which cannot
  match the printed Oxford-comma form, and miscounted distinct pairs by counting
  ROWS instead of PAIRS.

Every one was caught downstream by a builder who checked instead of obeying —
which is luck, not a process.

**When enumerating a family, grep the LOOSEST plausible shape and read every hit.**
The variant you did not imagine is exactly the one your pattern excludes. **And
state the pattern you used**, so the next reader can see its edges rather than
inheriting your blind spot as a fact.

## Refusals the type system re-derives (D424)

**Prefer a refusal derived from the model over one listed against it.** D424 must
refuse two Special Conditions that occupy the same field (`asleep`/`paralyzed`/
`confused` are all values of `rotation`, so applying both means the second
silently overwrites the first — a lie that resolves). The refusal is
`Record<StatusName, keyof SpecialConditions>` plus a shared-field test, not a
blocklist of bad pairs.

A blocklist would have been correct on the day it was written and silently wrong
at the next status word. The map **does not compile** until a new word is
classified, so the guard cannot drift from the model it guards. It also refuses
`(X) and (X)` for free, off the same invariant.

## Refusal rungs need controls (D424)

**Every "X is refused" assertion owes a neighbouring "Y is admitted" on the same
axis.** *"Same-slot status pairs are refused"* passes trivially if the reader
refuses everything, so the rung is worthless without a case proving the reader
still says yes to something. D424 admits Burned+Poisoned — two different slots,
no printing anywhere — directly beside the refusals.

This is the same defect shape as D423's specimen-shaped absence guard: an
assertion that cannot distinguish the behaviour you want from a much worse one.

## Cheapness is marginal sites, not mechanisms (D424)

**A second anchor that moves no new site is nearly free.** D424 took the coin-flip
twin of its pattern because the marginal cost was zero — the same census literals
move either way, only by different deltas. Given that mechanism counts have now
under-predicted blast radius three slices running (D421 by state maintenance,
D423 and D424 by census bookkeeping: 4 mechanisms → **68 sites across 22 files**),
**marginal site count is the better cheapness test.**

**And re-count the version tax every slice.** It has been misquoted three slices
running — a doc note says 5, D423 measured 7, D424 measured **9** assertions and
12 version sites. Grep both `engineVersion` and `manifest.version`.

## Derived facts in consumers (D425)

**A closed-world assumption that is true by accident looks exactly like correct
code until its first counterexample.** `log.ts` rendered every `DAMAGE_DEALT` row
under `otherSeat(event.seat)` — deriving the DEALER from the VICTIM's seat. That
was correct for all four producers in the engine, not because anything enforced
it, but because all four happened to aim across the table. The first own-side
producer made the log credit the DEFENDER with damage the ATTACKER had just done
to its own Bench.

**When you add a producer to a shipped event, grep every consumer for facts it
DERIVES rather than READS.** A consumer that recomputes one field from another is
asserting an invariant nobody declared and nothing checks. The fix is to carry the
fact on the event.

## Required field vs optional rider (D425)

**Apply the test; do not copy the outcome.** D421 added an optional rider and
defended it by choosing the rest of the record so that losing the rider fails
LOUD. D425 faced the same choice and went the other way, because here an optional
`selfInflicted` flag, when forgotten, reproduces exactly the attribution bug that
had just been found — a plausible-looking wrong answer. A **required** `by: Seat`
makes the next damage site a compile error instead.

The rule is the same in both slices: **choose the shape so that losing the new
information is detectable.** Sometimes that is an optional key beside a value that
degrades visibly; sometimes it is a required key. The blast radius is usually the
deciding practicality — D425's was one strict `toEqual` literal.

## Publishing your pattern (D425)

**Stating the pattern you grepped is what makes your blind spot findable by
someone else.** D424's convention says to state it; D425's family survey did, used
`/also does \d+ damage to/`, and missed a corpus row that prints the same shape
BARE — no *also*. The builder found the hole precisely by checking the published
pattern's edges.

That is now four incomplete enumerations in five slices, each by a different route
(asserted from memory, generalised from a partial grep, a pattern too narrow for a
comma, a pattern too narrow for a missing adverb). **The enumerations remain the
unreliable part. Publish the pattern every time.**

## Census deltas come from fixtures too (D425)

`clauseApostrophe`'s sweep moves when a **fixture** is added, not only when a
reader is. D425 moved it 147 → 151, four sentences arriving by two different
routes. **A slice predicting that delta from the reader side alone gets it wrong.**

## Doc-block justifications rot like counts (D425)

D425's own mid-slice price paragraph claimed "57 sites in 21 files" and was wrong
on every figure; it was corrected in place and says so. A prose justification is a
claim with the same shelf life as the number beside it — **including the paragraph
you are writing right now.**

## When a card id cannot be resolved (D425)

This checkout has **no D1** — no local sqlite, no remote credentials. Ids that
cannot be resolved must be **stated as unresolved, never invented**; sentence text
and printing counts remain measurable off the committed corpus. A plausible-looking
invented id is indistinguishable from a real one to every later reader.

## Quoting a residue (D425)

**A residue figure is meaningless without the subtraction set that produced it.**
Two sessions measured "the unbuilt residue" at the same HEAD and got 203/315 and
201/310. Neither was wrong; they had subtracted different served sets and neither
had said which. Measured in one run at D425's head:

| subtraction set | residue |
|---|---|
| reader only (`!resolvedByAnyReader`) | 216 sentences / 343 printings |
| − gate + trailing splitters | 200 / 310 |
| − registry as well | **198 / 305** |
| − all four splitters + registry | 198 / 305 (unchanged) |

**Always name the set.** This is D423's scoped-claim rule arriving at a
denominator instead of a population, and denominators are exactly the numbers that
get copied into later claims unqualified.

**And carry this fact:** `splitAttackRequirementClause` and
`splitAttackCancelClause` serve **zero** additional unresolved sentences, so the
honest subtraction is **gate + trailing + registry, and nothing more**.

## Census chains: the frozen tail (D426, about D425)

**A frozen tail that moves with the head asserts nothing, and no sweep can tell
you.** The census chains assert `head - term - term - … === <frozen historical
value>`. The right-hand side is a constant; each slice pays its step by adding a
term at the FRONT. D425 instead **bumped the frozen endpoint** in 8 chains across
6 files, turning the assertion into `head === head`.

It was a slip rather than a decision — the same commit added the term correctly to
a sibling chain immediately below. It passed review, and **1,558 mutants plus a
clean whole-corpus sweep said nothing, because the assertion still passes.**

**WHEN YOU STEP A CENSUS CHAIN, DIFF THE FROZEN ENDPOINT AGAINST THE PREVIOUS
COMMIT.** If it moved, you wrote a tautology. This is D423's shape — a true
assertion standing in for a claim that no longer holds — reaching the INSTRUMENT
layer, where it is hardest to see and where the mutation harness is blind to it by
construction.

## Resumed slices (D426)

**A resumed slice must re-derive what it inherits.** D426's engine half was built
by an agent that died mid-slice; the agent that finished it was told to
reconstruct and CHECK those decisions rather than build on them. Six survived and
one did not: *"the SECOND park in the engine with a `decider`"* is the THIRD.

**And the error was inherited, not invented** — two shipped doc lines had said so
since D227 and were false the day they were written. Interrupted work carries its
author's premises silently; the assertions in a half-finished diff have not been
reviewed by anyone.

## The splitter composes on the TAIL (D426)

**State the mechanism, not the outcome.** D424 gained a free printing when a
compound composed; D426 gained none. One fact predicts both:
`splitAttackTrailingClause` composes when `deriveAttackEffect` already reads the
**TAIL**. D424 claimed a tail's head; D426 made a head readable whose tail is
still unread.

"Compounds sometimes compose for free" is not something you can plan with. The
mechanism is.

## Probing for leaked identifiers (D426)

**Quote the uid.** `p2#4` is a prefix of `p2#42`, so a bare substring test for a
leaked identifier passes on a snapshot that leaks. Any redaction probe must quote
the identifier, and any "nothing leaked" claim made with an unquoted search is
worth nothing.

**And a redaction assertion needs its attribution control.** The actor could not
see the opponent's hand before the attack either, so "the actor cannot see it
during the park" proves little on its own. The case that carries the claim is the
one after the answer: exactly the discarded cards become public, and the rest stay
shut.

## Scope is not the enclosing function (D427)

**Reading the enclosing function is not reading the enclosing scope.** D427's
brief asserted that a `const` was in scope at a call site because both lines sit
inside the same `export function`. It is declared inside an `if` block that closes
~60 lines before the call. The plan was unimplementable as written — a compile
error for anyone who followed it.

This is the fifth incomplete enumeration in six slices, and **the first that no
grep could have caught**: the four earlier ones were about TEXT (a remembered
byte, a partial grep, an Oxford comma, a missing adverb), and this one is about
lexical structure. **When a plan depends on a value being reachable, open the
braces — or say plainly that you have not.**

## A price is a forecast; a rule is a criterion (D427)

A shipped test comment stated that D427's widening *"widens a type that rides
`EffectContinuation` across the wire"* and would therefore bump
`MATCH_RECORD_VERSION`. It does not. An earlier slice had **priced** it that way
while declining it, and the price outlived its context as prose.

The rule turns on optional-vs-required, and the precedent is written verbatim
elsewhere in the codebase. **A forecast that survives in prose gets read as a
criterion** — D422's stale refusal one abstraction level up. **When you decline a
slice on price, mark the price AS a price**, with the date and the head it was
measured at.

## Choosing a carrier does not duck persistence (D427)

Both `EffectContext` and `EffectRecord` ride `phase.cont` and are serialized. A
version prediction that rests on "I chose the carrier that isn't persisted" is
resting on nothing. **Drive the record; do not reason from the carrier's name.**

D427's prediction held because the added key is OPTIONAL — which is the rule —
and the carrier was chosen on a different axis entirely: `EffectRecord`'s slots
are all `string[]` lists of card uids, and the new value is an HP figure, so no
widening keeps the map's value type.

## Near-misses must differ on one axis (D427)

Two of D427's mutants survived the first pass, and both were real gaps in its own
suite: a refusal rung whose near-miss was BOTH lowercased and re-worded, and
another BOTH comma-joined and re-ordered. Neither could show which feature of the
anchor did the refusing, so both rungs passed and proved nothing.

**A near-miss that differs on more than one axis tests nothing about either.**

## Declared survivors should self-invalidate (D427)

D427 keeps one `equivalent` survivor whose argument is that every summand in a
sum is non-negative, so a mutated initialiser is unreachable-by-value. That
declaration is preferred over deleting the row because **the day any summand can
go negative, the row reports `STALE-SURVIVOR` and fails the run.**

**Prefer a declaration that a future change breaks loudly over one that quietly
stays true.**

## The version-tax miss, mechanism named (D427)

The count of `engineVersion` assertions has been misquoted **six slices running**.
The mechanism: **every note counts the pins it INHERITED and never the one it is
about to AUTHOR.** Now 13 assertions / 16 sites. Count your own suite's pin, and
grep both `engineVersion` and `manifest.version`.

## Placement is necessary, not sufficient (D428)

**When you insert a state change mid-function, grep for locals bound from that
state earlier.** D428's pre-damage hook sits on exactly the right line — the last
before §8.5 — and would still have been dead. `defender` was a `const`
destructured ~1,150 lines earlier, and that OBJECT (not the seat) is what
`passivesOf`, `installedReductionOf`, `seatDamageReduction`, `koSurvivalClamp` and
the §8.1 reads all take. A hook updating only `next` fires its event, prints its
log row, mutates the board — **and moves no number.**

That is D407's built-but-dead defect arriving through a **stale local** rather
than through a missing table row, which makes it much harder to see: everything
observable except the number is correct.

**Write the mutant that skips the rebind.** It is the build a careless slice
actually ships, and it is indistinguishable from the real thing in the log.

## A refusal's falsifier should be executable (D428)

D428 declined a prefix stripper on a measurement — four corpus sentences share the
head `Before doing damage, `, and **zero** of the four remainders is claimed by any
reader, so the stripper buys nothing today — and put that measurement **in the
suite**. The day a second remainder becomes claimed, the refusal goes RED.

**A refusal written as prose rots** (D422's stale block cost ~195 decisions).
**A refusal written as a test cannot.** When you decline a generalisation, state
the condition that would reverse it *and make that condition a rung*.

## Never truncate an enumeration (D428)

**`head -N` silently converts "all hits" into "the first N".** D428's brief listed
eight rows of a ten-row column because the survey was piped through `head -8` and
then reported as complete. The pattern was correct; the output was cut.

That is the sixth incomplete enumeration in seven slices, and the routes have all
been different: a remembered byte (D421), a partial grep (D422), an Oxford comma
(D424), a missing adverb (D425), a block scope (D427), and now self-inflicted
truncation. **State the pattern AND the limit, and do not pipe an enumeration you
are about to call complete through `head`.**

## Census deltas have a third route (D428)

`clauseApostrophe` stepped 152 → 153 with **no fixture added and no new
apostrophe-bearing sentence** — a card already in the pool simply became
derivable. Reader additions and fixture additions are two routes into that census;
**a previously-refused sentence becoming claimed is a third.**

## Step every nested chain, not the one that reddened (D428)

`opponentResistanceBonus.test.ts` carries **eleven** nested prefix chains, and all
eleven needed the front term. A green suite after fixing the one that failed is
not evidence the round was complete — the others fail only on a later run, or
worse, silently stop asserting what they were written for.

## A stale local can UNDO a change (D429)

D428 found a hook that fired its event, printed its row, and moved no number,
because a `const` bound ~1,150 lines earlier was what every later read consulted.
**D429 found the strictly worse form.** The §9 counterattack site spells
`{ ...active, damage: active.damage + recoil }` and writes it back with
`withActive` — so a stale binding **puts a discarded card back on the board** ~500
lines after it entered the discard pile. One physical card, two zones.

**When you mutate state mid-function, grep every later `{ ...local }` WRITE-BACK,
not only every later read.** A stale read is invisible-but-inert; a stale
write-back is a resurrection, and it corrupts the board rather than merely
failing to see it.

## Write the property, not the shape that has it (D429)

D428 forbade a parking pre-damage op by having its applier return `GameState`.
Both D428's own doc block and the following brief then treated **the return type**
as the criterion. It is not. A park is `RunResult`'s `{ kind: "parked"; prompt;
cont }`, drained by `settleProgram`; what actually forbids one is that the return
carries **no prompt and no continuation** — nothing a resolver could drain.

The distinction bites the moment the type is widened for an unrelated reason.
D429 needed a result channel, and had the literal type been the rule, adding
fields would have looked forbidden while adding the wrong field would have looked
fine. The rule is now written at the type: **fields may be added when the CALLER
consumes and discards them; never when a RESOLVER would have to drain them.**

**When you rely on a property, write the property — not the shape that happens to
have it.**

## A streak is a claim (D429)

D429's brief stated the version-tax count had been "wrong seven slices running".
It had not: D428 counted its own pin and ended the streak, exactly as D427
predicted when it named the mechanism. The figure was inherited from D427's note
and **incremented without re-reading the note being cited**.

**Extending a streak asserts it afresh.** A running count is one of the easiest
claims to carry forward unchecked, because each increment feels like arithmetic
rather than a measurement. Re-read the last entry before you add to it.

## Do not pin a defect's current behaviour (D429, applying D418)

D429 found a live rules gap — the pre-damage strip ignores `effectRefused` while
a sibling effect in the same seam honours it, so the seam is internally
inconsistent on a board two real cards can reach. It **deliberately did not add a
test** for the current behaviour.

**A guard that reddens when someone fixes a defect actively defends the defect.**
Record the gap in prose and in the resume point, and leave the tests silent, so
the person who fixes it meets no resistance.

## Reasoning that rots when a channel is added (D430)

**A claim can be true when written and falsified by a channel added later — and
nothing tells you, because the arm still runs.** Three ops (`applyStatus`,
`preventRetreat`, `preventAttack`) carried doc blocks saying their `target:"self"`
arm *"can never be refused in practice"*, reasoning from an installed block's
CLOCK: a block stamped `turn + 1` cannot be live on its holder's own turn. That
was true at D142, when installs were the only channel. **D260 added clockless
AURA channels, 118 decisions later, and the reasoning became false** while every
line of code stayed valid — so a self-inflicted Special Condition was being
cancelled by the attacker's own card.

**When you add a CHANNEL, grep for claims that reason about the channels that
existed before it.** Code that still compiles and tests that still pass are not
evidence; the rot is in the justification, not the behaviour.

## When defect and fix emit the same events (D430)

D430's refusal produces **exactly one** `ATTACK_EFFECT_PREVENTED` row — the same
count the defect produced, because the refusal makes a downstream zero-guard
short-circuit. A log-shaped assertion would have passed on both builds.

**That identical count is why the defect survived two slices.** When a fix does
not change what is emitted, **the killing rung must read the BOARD**, not the log.
Verify by applying the fix's inverse by hand and diffing both — D430 did, and the
only difference was `tools=[]` versus `tools=["p2#13"]`.

## A regex that matches a clock is not a regex that matches a source (D430)

D430's first population rung asserted `/opponent/` across all 8 printings of an
effect-prevention family and **passed** — including on a printing whose only
"opponent" is *"during your opponent's next turn"*, a CLOCK rather than a source
restriction. The rung proved nothing about the property it was written for.

**Split a population rung by KIND before trusting it**, and choose the token that
carries the meaning rather than the token that happens to appear in every row.

## `grep -c` counts text, not structure (D430)

Two briefs in this run asserted a structural fact from a substring count:
*"`sv05-161` appears in `testFixtures.ts`"* was offered as *"is in the fixture
pool"* (all three hits are comments; the key is `fix-mist-energy`), and
*"`grep -c packages/schema` returns 1"* was offered as *"one mutant targets
`packages/schema`"* (the hit was a `what:` description string; zero rows target
it).

**Grep for the structural spelling** — `file: "…"`, a key declaration, an export —
**not the substring.** "Appears in the file" and "is a key in the pool" are
different propositions, and only one of them is what you are claiming.

## Process: the precheck command (D430)

**`bun run mutants --precheck` is NOT a flag — it silently starts a FULL SWEEP.**
The precheck is `bun scripts/mutation/precheck.ts`. If you start one by accident,
SIGTERM it; the harness restores its mutated file and clears the journal on the
way out.

## Do not roll your own instrument (D430 follow-up)

**A hand-rolled instrument competing with a guarded one loses silently.**
`censusAtHead.test.ts` ships the canonical unbuilt-residue predicate (the
`residueSentences` filter) and pins its outputs — `rawUnbuiltSentences`,
`residueSentences` and `unbuiltAttack`. It is tested; a script in
`$CLAUDE_JOB_DIR/tmp` is not.

⚠️ **THE FIGURES ARE DELIBERATELY NOT QUOTED HERE ANY MORE (D432).** This block
used to say *"209 / 184 / 275"* and a line number; by D431's head the file had
moved and the numbers were **208 / 183 / 272**, and D432 moved them again to
**207 / 182 / 269**. A residue figure copied into prose rots on the next slice by
construction — this note is about not trusting a copy, so it may not BE one.
**Read them off the suite** (`grep -n 'rawUnbuiltSentences.length' packages/engine/src/censusAtHead.test.ts`),
never off this paragraph. That is D418's move applied to this doc: remove the
premise instead of maintaining it. This run quoted a
hand-rolled figure for five slices and it was wrong every time — most recently
191/285 against a true 184/275, from two errors that partly cancelled:

- **`registry.ts` does not contain the printed sentences.** It is keyed by card id
  and holds PROGRAMS; the text lives in `REGISTRY_ATTACK_SENTENCES` in the test
  file. A substring test against `registry.ts` finds 2 of 10.
- **A bare `splitAttackGateClause(text) !== null` over-subtracts.** The canonical
  also requires `gate.body !== "" && resolvedByAnyReader(gate.body)` — a gate whose
  body nothing claims is not served.
  > 🆕 **D545 annotation — this spelling of the canonical is stale since D529** (`b3f5c4fb`, the Rollout
  > census-instrument fix). The live predicate (`censusAtHead.test.ts`, the residue filter) is
  > `gate !== null && (gate.body === "" || resolvedByAnyReader(gate.body))`: a CLAUSE-ONLY row (`body: ""`,
  > D395's path) IS served. D545's two cost-clause rows (`:316`, `:324`) are served through exactly that
  > branch; read with the line above, they would be mis-counted as residue. The over-subtraction warning
  > itself stands for a gate whose NON-EMPTY body nothing claims.

**Before measuring anything the repo already measures, grep the test suite for the
figure.** If you need the list rather than the count, copy the predicate verbatim
rather than reconstructing it from its description.

## A mechanism that launders the census (attack-copy refusal)

The attack-copy family (**6 sentences / 13 printings** — ⚠️ this paragraph said
*7 / 14* from its writing until D471, which measured it with a committed
instrument over the very population the next sentence cites; an uncounted figure
in a rule is still a claim) is refused, and the reason
generalises. A copy op can only splice `deriveAttackEffect`'s output — 964 of
1,732 printings — while 445 resolve through one of the other twelve readers into
`attack()` locals no op can reach, and 323 resolve nowhere.

**But the disqualifying part is not the 44%.** `effectSimulated` is computed from
the COPIER's sentence, so the moment a copy anchor claims it,
`ATTACK_EFFECT_SKIPPED` can never fire for that attack again. The build would
switch off the engine's one honest failure channel exactly where it is needed
most, while stepping `BUILT.attack`.

**A mechanism that makes the coverage instrument report success it did not earn is
worse than an unbuilt sentence**, which at least fails loudly (D190b/D199 at the
instrument layer rather than the program layer).

**The falsifier is executable, not prose**: the refusal reverses when `attack()`'s
§8.5 block becomes a callable function taking an attacker, a defender and a
`declared`.

🆕🆕🆕 **D573 — THE FALSIFIER WAS MET, AND THE REFUSAL REVERSED FOR FOUR OF THE SIX SENTENCES
(4 / 9 built; the family is 2 sentences / 4 printings now).** Not by extracting §8.5 but by
the cheaper shape the falsifier names: `attack()` takes an optional `declared` OVERRIDE
(`AttackCopyOverride`) and re-enters itself with the COPIED attack at declaration time, so
`effectSimulated` is computed from the COPIED text — a copied unbuilt sentence still fires
`ATTACK_EFFECT_SKIPPED`, carrying that text (`copyAttackD573.test.ts` §3, the anti-laundering
rung). The disqualifying part above does not happen. The rule this section states is
UNCHANGED and still binding: a mechanism that makes the coverage instrument report success
it did not earn is worse than an unbuilt sentence. Haughty Order ×3 and Seek Inspiration
REVEAL or MILL before the choice and need a park in the MIDDLE of an attack; they stay
refused under this section until that exists.

🆕🆕🆕 **D573 REVIEW — *"The disqualifying part above does not happen"* WAS FALSE AS FIRST BUILT,
FOR ONE SENTENCE CLASS, AND THE LESSON IS THIS SECTION'S OWN.** The override substituted the
copied text at the EFFECT seam and the GATE-SPLIT seam, and the split removed a copied
attack's printed timing / requirement clause (*"If you go second, you can't use this attack
during your first turn."*, the Rollout and Angelite clauses) as "simulated" while
`attackTimingBlocked` — the one enforcer — still ran only on the COPIER's own attack. The
clause fired no ATTACK_EFFECT_SKIPPED and bound no one (a reviewer drove a Foul Play for 90 on
the turn the copied attack itself is ATTACK_PREVENTED). **The census was laundered through the
gate seam while the effect seam was honest, and the anti-laundering rung could not see it
because it only fed an unbuilt EFFECT sentence.** Closed: attack.ts `usableCopies` asks the
copied clause (looked up where printed, asked for the copier's seat) and drops every candidate
it bars (R-CP4; `copyAttackD573.test.ts` §3b). ⚠️ **When a substitution re-points a seam that
REMOVES text as accounted-for, the enforcer of that text must be re-pointed in the same hunk —
every seam that marks a sentence "simulated" is a laundering seam if its enforcer is not.**
🆕🆕🆕 **D573 third review — and when a substitution re-points the HOLDER's text while the holder
stays put, every installer that resolves a printed NAME against the holder is asked a new
question.** A copied *"this Pokémon can't use Slashing Strike"* or *"…Echoed Voice attack does 80
more"* resolves against the COPIER, which prints no such attack, so it installs nothing — read as
the rules answer under the name-reference reading (R-CP9, ⚠️ UNRULED, decisions.md D573) and
DRIVEN (`copyAttackD573.test.ts` §3c), not left silent. The test: for every "unreachable off every
printing" a substitution can reach, either rule the outcome or skip the sentence — and withdraw
the claim in place (D539).

🆕🆕🆕 **D574 — THE LAST TWO SENTENCES ARE BUILT, AND *"they stay refused under this section until
that exists"* IS DISCHARGED, NOT WAIVED.** The park in the MIDDLE of an attack exists: attack.ts
`copyAtResolution` reveals / mills after the coins and parks `useFoundAttackAs`; the answer
re-enters `attack()` RESUMED with the found attack as the same `AttackCopyOverride`, so
`effectSimulated` is still computed from the COPIED text (a revealed unbuilt attack reports
ITSELF — `copyRemainderBundleD574.test.ts` §2's anti-laundering rung) and the copied gate is still
enforced, through a PHANTOM one-card body for a source that is not in play (R-CP4 extended). Both
D573 lessons above held without a new seam: no text is removed as accounted-for without its
enforcer, and every holder-keyed name still resolves against the copier (R-CP9 unchanged).

## Unbounded queues (attack-copy refusal)

`runProgram` is `while (queue.length > 0)` with **no step limit**, and gates splice
with `queue.unshift(...)`. Any op whose candidate set can include an instance of
itself is an unbounded loop inside a Durable Object request — not a failing test, a
hang. **Before adding an op that can name another op's source, ask whether the
source set can contain the op itself, and what bounds it.**

🆕🆕🆕 **D573 — ANSWERED FOR THE COPY FAMILY, AND THE ANSWER IS THE BOUND, NOT A STEP LIMIT.**
The copy never enters `runProgram`'s queue at all (its op `useAttackAs` is only ever PARKED,
never stepped), and its source set CAN contain a copy — so every attack whose text carries
`COPY_FAMILY_MARKER` (*"use it as this attack"*, all six family sentences, built or not) is
excluded as a candidate (R-CP3, ⚠️ UNRULED). The re-entry is therefore at most one level
deep. If a ruling ever allows nesting, the bound becomes a depth counter — never "no bound".

🆕🆕🆕 **D574 — TWO MORE ANSWERS, ONE OF EACH KIND.** ① The resolve-time copies (Haughty Order,
Seek Inspiration) take the same bound: their found candidates exclude every marker attack, so the
mid-attack re-entry is also one level deep. ② **The first op that LOOPS — re-emits itself with
no fixed number of questions** — `moveCountersOpponentAnyWay` (Sableye / Alakazam, *"any number of
damage counters … in any way you like"*) schedules its next round after every move, so its source
set DOES contain itself. (Re-emission alone is not new: `moveCountersChosen` → `{ ...op, fromBench }`,
`moveCountersToOpponentChosen` → `{ ...op, from }` and the `schedule: [{ ...op, from: lone.spot }]`
arm each re-emit once with a progressed field, for a FIXED count of questions.) The
bound is an ENGINE-WRITTEN BUDGET, not a step limit (R-AK1, ⚠️ UNRULED): the counters in the
op's source zone when it first steps; every round moves ≥ 1 counter and spends exactly what it
moved; a decline ends it. An A → B → A cycle therefore ends within the budget (driven, and held
by `D574-loop-budget-never-spent`). **The question to ask before adding a looping op: what
monotone quantity does each round strictly consume, and who writes it?**

## A brief that supplies the list pre-empts the audit (D431)

D431's brief commissioned a closed-world audit of every consumer of a pending
stage — and then listed **4** of the **15** sites, omitting exactly the eleven
consumers the audit was for. The conclusion happened to survive, but the brief had
already answered the question it was asking.

**Supply the PATTERN, not the answers.** If you list sites at all, state the count
and say you read every hit; a partial list handed to someone told to audit reads
as the audit's scope.

## A sentence true of every existing case reads as a law (D431)

Four op doc blocks state that an interpreter op *"returns a `GameState` and cannot
reach `pending`"*. `GameState` **contains** `pending`, and a sibling op in the same
file has spliced into it for a long time. Each sentence is true *of its own op*;
read together they assert a type-level constraint that does not exist.

**When you rely on something several comments assert, check whether it is a
property or a habit** — a property is enforced by a type or a test, a habit is
merely what every case has happened to do so far. This is the same shape as D430's
reasoning-that-rots, arriving through repetition rather than through time.

## A clean audit is a finding (D431)

D431 audited every consumer of the `takePrizes` stage for KO assumptions and found
none. That is worth recording rather than dropping, precisely because D425 found
the opposite one event over: a consumer deriving a damage row's dealer from the
victim's seat, correct for every producer by accident. **A negative result about a
hazard you had specific reason to expect is evidence about the design, not an
absence of news.**

## Sibling rungs go quiet, not red (D431)

Vitest stops at the first failure in a file, so when one rung of a repeated pattern
breaks, its siblings are never evaluated. All **eleven** nested chains in
`opponentResistanceBonus.test.ts` needed a front term and only one reddened.

**After fixing the rung that failed, step every sibling and re-run.** A green suite
following a one-rung fix is not evidence the round was complete — it is evidence
that the runner stopped early.

## A wrong citation is worse than a missing one (D432)

D432's brief attributed `retreatLockedTurn` to D421. It is **D412's** — and that
was not bookkeeping. **The two decisions took opposite roads on exactly the
question the slice turned on**: D412 added a REQUIRED key and bumped
`MATCH_RECORD_VERSION`; D421 added an OPTIONAL key and defended it by making the
loss loud. Citing the wrong one pointed at the wrong answer for the only real
decision in the slice.

**A missing citation makes a builder look; a wrong one makes them confident.**
Before citing a precedent for a decision, check which way that precedent actually
went — `git log -S "<field>" -- <path>` settles it in one command.

## The optional-key mitigation needs a record with other fields (D432)

D421's rule — *choose the rest of the record so that losing the key is
detectable* — is **unavailable when the stored fact is a single number with
nothing beside it.** D432's bar carries no amount, no filter and no narrowing, so
dropping the key reproduces the previous engine exactly: the effect silently does
not happen and the board looks normal.

That is the benign soft landing `MATCH_RECORD_VERSION` exists to refuse (D124).
**When a record has no rest, required is the only honest choice, and the bump is
the price of honesty.** Do not reach for optional because it is free.

## Line numbers in a brief are claims (D432)

One of four clear sites cited in D432's brief pointed inside an unrelated
function. A builder following the number rather than the description would have
edited the wrong code.

**Quote the line's TEXT beside its number**, so a wrong number is self-evident
rather than authoritative.

## Disjunct order can be load-bearing for a type reason (D432)

At `snipeActive`, `attacker === null` is what admits `attacker.card` on the next
line, through TypeScript's aliased-condition narrowing. Whether a new disjunct is
appended or prepended there is a **correctness** question, not a style one.

**When you add a disjunct to an existing condition, check whether any later line
depends on the narrowing the existing operands provide** — and state which, and
why, in the code.

## Adding to a swept set re-reads the set (D432)

Three of the four swept clear-set assertions were missing a field that D412 never
added — drift invisible until someone else's field arrived and the set was read as
a whole.

**When you add a field to a swept set, re-read the entire set.** Earlier omissions
do not redden anything on their own; they surface only when the next author looks.

## Grepping prose: the derived noun (D433)

**A stem pattern misses the derived noun, and the derived noun is where reference
prose states the rule.** D433's brief grepped `docs/reference/ptcg-rules.md` with
`/[Dd]evolv/` and reported what it found. The line stating the slice's central
hazard outright is `:538` — *"**Devolution** (some effects): removes the top
evolution card; excess damage past the now-lower HP causes a KO"* — and
`/[Dd]evolv/` **cannot match it**, because the noun's stem is `devolu`.

**When grepping prose, grep the shortest unambiguous stem** (`devolu`), and grep
the concept at least two ways. Code uses verbs; documentation uses nouns.

**And exactness is not rigour.** Inside the same verification, an exact-phrase
grep for a known doc comment returned nothing where a looser pattern found it
instantly. A grep that finds nothing is evidence about the pattern before it is
evidence about the codebase.

## When precedents disagree, the disagreement is the rule (D433)

Three shipped literals disagree about clearing `markers` on a body: `evolveOnto`
clears it; `switchInto` and `clearOnLeavingActive` keep it. The disagreement is
not drift — **it is cleared only where a FRESH CARD ARRIVES.** Devolve is not that,
so it follows the two that keep, and copying the nearest-looking precedent
(`evolveOnto`, the other evolution-stack operation) would have been a live defect.

**Before following a precedent, check whether its siblings agree with it.** A lone
precedent is a data point; a unanimous set is a rule; a split set is a
distinction you have not found yet.

## The second producer of a marker (D433)

**A marker correct for every board its first producer could reach can still need a
guard for its second.** D414's `koByEffect` marker never needed a `wasLethal`
conjunct, because its producer could not encounter an already-lethal body. D433's
producer can — §8.5 damage lands before the effect program — and stamping
unconditionally would have **denied a recoil that is owed**, since that body
genuinely *was* Knocked Out by damage.

**When you become the second producer of a marker, re-derive its precondition from
scratch** rather than inheriting the first producer's.

## Ask the shield after narrowing (D433)

D433's first build asked the §11 refusal gate over the whole opponent board and
*then* filtered to the printed candidate set, so a shielded body that the effect
could never have reached filed a prevention row. Every other caller narrows first.

**Every board is identical under both builds; the only casualty is a false log
row** — which is exactly why it would have survived review. Narrow to the printed
candidates, then ask.

## Declare partial evidence as partial (D433)

D433's neighbour re-probe covered 92 of 439 rows; a full probe was aborted twice
on wall time, because the harness re-runs a baseline per suite-set change. **The
report says so, in those terms.** A clean `precheck` proves no anchor rotted,
which is a different and weaker claim than a probe. Say which one you have.

## A rest must be OLD, not merely plural (D434)

D421's optional-key mitigation — *choose the rest of the record so that losing the
key is detectable* — requires a rest **that a previous deploy already wrote**.

D434's record has two keys, and the brief argued the optional road was therefore
available. It was not: **both keys arrive in the same deploy, so neither can
witness the other's loss.** A v27 record does not hold a `scheduledCounters`
missing one key — it holds no `scheduledCounters` at all.

**When you reach for the optional road, ask what the OLD bytes contain, not what
the NEW type contains.** D432 established that a record with no rest must be
required; this adds that a record whose rest is *new* has no rest for this purpose
either.

## A record-valued field fails differently from a bare stamp (D434)

- A missing `number | null` **stamp** reads `undefined === state.turn` → `false`.
  **Silent** — D432's benign soft landing.
- A missing `Record | null` reads `undefined !== null` and the next line
  dereferences. **An old board THROWS.**

D434's first doc block claimed the benign landing by analogy with its stamp
neighbours, and was measured false. The two shipped record-valued fields both say
in their own comments that the absent-key arm is the version constant's job rather
than the reader's — so the reader is deliberately intolerant, and the constant is
what protects it.

**Work out which failure you are choosing. Do not inherit the neighbouring stamp's.**

## "Cleared at §10 sites" is false for half the stamps (D434)

`promotedTurn` and `healedTurn` are cleared at **no** §10 site; `evolvedTurn` is
written at `evolveOnto` and nulled at `devolveEach`. The six per-body stamps split
in two: **durated effect-of-attack stamps are cleared, HISTORY stamps are kept.**

**Check which kind yours is before copying a neighbour** — and note that the
reachability story can invert: D434's record fires at the end of the *holder's own*
turn, so retreat, Switch and evolving are all live counterplay inside its window,
where every neighbour's window sits on the opponent's turn.

## A clear-rung must assert the silent aftermath (D434)

Reading a cleared field back as `null` **passes on a build that clears the record
and fires a second copy anyway.** The rung has to drive the boundary where the
effect would have fired and assert that nothing happened.

## A short list makes a claim narrower, not false (D434, restating D419)

`attackLock.test.ts`'s three-route sweep listed **8 field names against 11 durated
fields**, so the three-route agreement was never checked for five of them — and
nothing ever reddened, because a narrow claim still passes. Widened to the whole
family, **it passes, and that is the finding.** `perAttackLock`'s swept set was
still missing a key whose class D432 had already found.

**When you touch a swept set, count it against the TYPE**, not against the list
that is there.

## An optional key can degrade into silent CORRUPTION (D435)

D435 was the first slice in this run where D434's *rest must be OLD* test was
**satisfied**: both existing keys were written by the previous deploy, so an
optional `kind` was a real, free option. **It was still refused**, on a
degradation that was measured rather than classified from the shape.

A dropped `kind` reads as the old member, `amount` is `undefined`, the Checkup
computes `damage + undefined` → **`NaN`**, and `NaN >= hp` is **false**. The body
is not removed, is not Knocked Out, **and can never be Knocked Out again — on a
board that looks entirely normal.**

That is neither D124's benign soft landing nor a loud failure. It is **silent
corruption**, and it is a third distinct outcome. The sequence to carry:

- **D432** — no rest → required, because a lost key is undetectable.
- **D434** — a rest that is not OLD is not a rest; the old bytes hold nothing.
- **D435** — rest old, option genuinely available, **degradation is `NaN`**.

**Measure the degradation. Do not classify it from the record's shape.**

## Two payloads that read alike (D435)

*Discard the Defending Pokémon* and *the Defending Pokémon will be Knocked Out*
both remove a body. **Only the Knock Out pays a Prize** — `ptcg-rules.md` §8.1
owes it to "the player who KO'd the Pokémon" and no clause pays one for a card
leaving play any other way. The engine already agreed before either op existed:
a shipped discard op stages no `takePrizes`.

So they are **two ops and two union members, never one with a flag** — and the
discriminating rung only works because a sibling rung asserts that everything
*else* agrees, leaving the prize assertion as the single thing that reddens if
the two collapse.

## A precedent named in a brief is a claim (D435)

D435's brief named `devolveEach` as the precedent for *"and all attached cards"*.
It moves one evolution card and touches no attachment — **not a precedent at
all** — while the real one, `returnSelf { dest: "discard" }` (D313), went
unmentioned and agrees with §8.1 byte for byte.

**Two unanimous precedents are a rule; check for a third before assuming a
split.** D433's `markers` case came out the other way, and knowing which you have
is the whole point.

## Not incrementing is also a measurement (D435)

The version tax stands at **20/23** across D434 and D435, because D435 extends an
existing suite and authors no new pin. It was **re-measured rather than stepped**,
and saying so is the point: **incrementing a running count by reflex is the
failure D429 named** (a streak is a claim, and extending one asserts it afresh).

Grep the assertion, not the string — two of the twenty-one hits for the pin are
prose inside doc comments quoting a historical version.

## A refusal is scoped (D436)

**A refusal scoped to one vocabulary is not a refusal of the sentence.** D368
refused *"If this Pokémon has at least N extra Energy attached (in addition to
this attack's cost)…"* as a `BoardCondition`, and was right for a structural
reason: `conditionHolds(state, seat, cond)` is handed **no attack**, and the
identical clause is printed on two attacks with two different costs, so one board
answers it two ways.

**Seven shipped rungs across four suites then carried that refusal as though the
SENTENCE were unbuildable.** It is not: claimed as a `DamageCountSource`, whose
fold runs inside `attack()` where the declared cost is a local, it costs one
anchor and one arm.

**When you meet a refusal, check what it refuses** — the vocabulary, the shape, or
the sentence. Collect the ones that were right about their own scope rather than
overturning them.

## The comparand fixes the unit (D436)

D121 established that counting Energy counts **cards**, not units of provision,
and that rule governs the whole engine. **D436 is the first place it does not
apply**, and the reason is the comparand: *"extra Energy in addition to this
attack's COST"* compares attachment against a multiset of **symbols**.

- **Cards-minus-symbols is not a quantity.**
- The cards reading **goes negative on a board the rules admit** — one
  double-provision card pays a two-symbol cost by itself, giving −1, where units
  give 0, the floor the cost check guarantees.
- D121 governs a **count**; this is a **difference**.

**Apply the test, do not copy the outcome** (D425). And note the general form:
when a predicate compares two quantities, **the comparand decides the unit**, not
the local convention.

## The sibling hazard, priced (D436)

Twenty-one suites carry the same residue chain at up to eighteen rungs apiece —
**122 front terms** — and vitest reddens exactly one per run. D436 needed **four
full runs to green**, each exposing rungs the previous failure had silenced.

**Step every sibling in one pass, or budget the runs.** This is the wall-clock
cost of the rule that was previously only described.

## Cost is a check, not a payment (D436)

`ptcg-rules.md` §8 step 2: *"Cost is only a check, not a payment."* Energy is not
consumed by attacking unless the attack text says so — so "extra" Energy is
measured against what remains attached, and a frozen pair should assert the
arming Energy is still there afterwards.

## When you build what an earlier slice refused (D436's GAP)

**Grep the mutation corpus for the SENTENCE, not just the test suites.** D384
wrote this rule; D436 broke it and produced the run's first GAP in seventeen
sweeps.

D368 had refused a clause as a `BoardCondition` and planted a **tripwire** — a
mutant adding a clause-table row for it, killed by a rung asserting the sentence
was unclaimed. D436 built that sentence through a different vocabulary and
carefully re-pointed **seven test rungs** onto the new truth. It never asked
whether a *mutant row* rested on the old refusal. The re-pointed claim is true
under the mutant and the real build alike, so the tripwire stopped firing.

⚠️ **`precheck` cannot catch this.** It proves every `find` still MATCHES; it says
nothing about whether a row still DISCRIMINATES. `--decision D436` was 9/9 and
precheck was clean over all 1,688 rows. **Only the whole-corpus run could see it.**

## "The new reader pre-empts it" is a claim about ONE call site (D436's GAP)

The tempting resolution — *the anchor matches first, so the added table row is
dead, therefore the mutation is equivalent* — was **wrong**, and declaring it
would have recorded a live finding as unguarded.

`boardConditionForClause` has **three** call sites. The anchor pre-empts exactly
one. The other two sit inside exported readers reached by carriers whose joins the
anchor's `\.$` cannot match, so the mutation is observable through them.

**Before declaring a mutation equivalent because a new reader pre-empts it,
enumerate every call site of the thing it mutates** — and judge each hit
code-vs-prose rather than counting matches.

**And note why no census could have caught it**: of 640 corpus sentences the
clause is captured on 2 by the pre-empted carrier and 0 by each of the others.
A figure that is zero on both sides of a change cannot move. **It needed a probe,
not a count.**

## A low percentage can mean cost, not neglect (D436 follow-up)

The trainer column is **42.8% built** against the attack column's **85.3%**, which
reads as the obvious place to pivot. It is not.

**There is no trainer text deriver at all.** Trainers are built as **registry rows
keyed by card id** — 113 units from 82 rows, **1.38 units per hand-authored row**
— so the 151 unbuilt units would need roughly **110 bespoke rows**. Attacks
amortize: one anchor serves every printing of a sentence, and slices in this run
repeatedly took **5 printings per anchor**.

**Before pivoting on a coverage percentage, measure the unit cost of the column.**
A column that is less built may simply be one where each unit costs more.

## The unit is not "cards" (D436 follow-up)

The census counts **units** — one effect-bearing text slot, so a card with two
attacks and an ability contributes three — over **printings**, where reprints
count separately (one sentence's five printings were a single card in five
rarities).

**Card-level identity is not resolvable in this checkout**: there is no local D1.
Any "how many cards" figure derived here is invented. **Quote units and
printings, and say which one you mean.**

## Truncation has a second axis (D437)

`head -N` has cost four briefs in this run, and the convention written against it
only covered ROW count. D437's brief instead cut each surveyed line at **108
characters**, and lost `, except for this Pokémon.` from a family member — **a
whole mechanism, and the thing that made that sibling the dearest of four.**

**Truncating by WIDTH is truncating.** Print enumerations whole on both axes, or
do not quote them.

## Citing a helper is not citing the code path (D437)

`parkOrForce` exists and its 0/1/≥2 doctrine holds — but `damageChosen`
**hand-rolls the same three endings inline** and never calls it. A brief naming
the helper sends a builder to the wrong file.

**Quote the arm, not the utility it resembles.** And note the consequence for the
slice: a narrowing that runs before the arity check **re-sorts boards between
arms** — *parks* becomes *silent* or *forced* — so each arity case needs the
unnarrowed board as its one-axis control.

## Check a gate is reachable before applying an ordering rule to it (D437)

D433 earned *ask the shield after narrowing, not before*. It is **inapplicable**
at `damageChosen`, which never calls `unshieldedRefs`: its preventions live inside
the placement loop over the refs it is handed, so narrowing precedes the ask **by
construction**.

Drive it anyway, with the admission — because the refusal case alone passes on a
build that asks nobody. **The shield REFUSES; it does not UN-NAME**: a shielded
body that is a printed candidate still files its row with `prevented: true`, while
one the filter excluded is never named at all.

## Five shipped arms beat one structural neighbour (D437)

The *"has any damage counters on it"* predicate is spelled `damage > 0`, because
**five shipped `conditionHolds` arms read that exact printed phrase and all five
spell it so**. The counter-valued function it most resembles serves *"exactly N
damage counters"*, whose comparand is a NUMBER — so its unit must be counters
(D436's comparand rule).

**Following the structurally nearest code would have been D433's `markers`
mistake at a predicate.** Count the arms that read the same PRINTED phrase, not
the functions that look alike.

## The copied-function trap, from the other side (D437)

D416's rule is usually read as *copying a function copies its mutants' anchors*.
D437 hit the converse: `precheck` found **seven broken rows** — three at `0×`,
four at `2×` — because **newly written lines became byte-identical to lines
elsewhere** (a fresh `const scope = …` matching another function's first line, a
guard gaining `&& agrees` matching a neighbour's).

**Writing a line that already exists elsewhere breaks a row you never touched.**
Run `precheck` after every edit round, not once at the end.

## Assertion polarity over a disjunction (D438 — and why D436's GAP happened)

**A negative assertion over a disjunction is a claim about EVERY disjunct; its
positive replacement is a claim about NONE of them.**

`resolvedByAnyReader(s) === false` is a thirteen-way refusal: it reddens if any
one of thirteen readers is ever widened onto `s`. When a slice builds `s` and
re-points that rung to `=== true`, the suite stays green — and **all thirteen
refusals are discarded**, because the new claim is true under a mistaken widening
and under the real build alike.

**That is exactly how D436 disarmed D368's tripwire and produced this run's only
GAP.** D438 hit the same fork and took the other branch: assert **the owner reader
by name AND that every other reader still refuses**. Strictly stronger in both
directions, and it arms rows a boolean never could.

**When you re-point a negative, name what now owns it and keep the refusals.**

## Never run a formatter on a shared tree (D438)

`biome format --write` on a **single** test file swept **140 insertions / 32
deletions of pre-existing format drift** into an unrelated slice. The repo carries
122 format-dirty files; that is a separate commit, not a passenger.

It was found and undone by reconstructing the file from `git show HEAD:` and
re-applying the three real edits — **no `git checkout --`, no `stash`, no
`reset`**, per the standing rule against wholesale tree operations.

## Rename when the second inhabitant arrives (D438)

A local called `selfPenalty` described its **count source** by accident and its
**printed clause** by intent. Both readings were true while the reader had one
arm. The accidental one became false the moment a second count source joined it.

**Rename when a second inhabitant arrives, not when the wrong reading finally
causes a bug.**

## Some questions are unresolvable here, and must stay open (D438)

D438 re-checked whether a suppression term should reach its new fold. The answer
requires a registry row on a fixture that also prints the sentence, and the six
real card ids are in neither `catalogManifest.ts` nor `FIXTURE_POOL` — so it is
**not answerable in this checkout**.

It is recorded at the site as unresolvable rather than guessed, the same posture
as unresolved card ids. **No local D1 means some questions must be left open;
answering them confidently is the failure, not leaving them.**

## A filter union is not a private vocabulary (D439)

Widening `CardFilter` looks like adding one member. It is not: the union has
consumers beyond the reader you are building for — an exhaustive `retrieveNoun`
switch **and a `Set`, where a new member falls out silently** (D222's closed-world
hazard).

D439 refused its largest countable (3 sentences / 6 printings) on that basis
rather than on the predicate, which was trivially expressible. **Before adding a
member to a shared union, enumerate its consumers** — the cost is measured in
files, not in the member.

## "Spellable by a filter" is not "reachable by the anchor" (D439)

A row whose filter already exists can still be unbuildable for reasons that have
nothing to do with the vocabulary:

- the sentence **ends in `)`** against an `^…$` anchor;
- and separately, it **does not compose** — the trailing splitter's **first**
  guard refuses its tail, so the head is never consulted at all.

D439's brief listed such a row as spellable. It was blocked twice over, and
claiming the head would have bought **zero** census printings. **Check the anchor
and the splitter, not just the filter.**

## A guard that asks the registry only is vacuous for derived surfaces (D439)

A shipped work-order table carried one of D439's own sentences as UNBUILT and
reddened nothing, because its check read `programFor(id)?.[surface]` — **the
registry alone** — while attack programs resolve `registry ?? deriveAttackEffect`.
That is D204's vacuity at a new address.

It was found by **grepping the suites before building**, which is now the third
distinct defect that habit has caught in this run.

## A surviving mutant can disprove your prose (D439)

D439 wrote *"order is behaviour here"* in a doc block, then watched the row that
would have demonstrated it **survive**. The claim was false — a sibling arm
returns only on a resolved token, so it falls through.

The block was corrected **to say it was false when written**, the branches proved
pairwise disjoint over the whole 25-noun vocabulary, and the row kept as a
declared survivor that reports `STALE-SURVIVOR` if the sets ever overlap. **A
surviving mutant is a claim about your prose as often as about your tests.**

## Process finding: argv-anchored process checks (D439)

`ps aux | grep '[b]un scripts/mutation/run.ts'` **matches a waiter shell whose own
command line quotes the string** — it did, twice, and read as a live sweep. The
reliable check is argv[0]-anchored, `ps -eo args | grep -E '^bun
scripts/mutation/run\.ts'`, **plus the journal's recorded pid**.

That is the **third** instrument written to obey D411 and then bitten by it —
`pgrep -f` matched its own waiter two slices earlier. **A process check that can
match the checker is not a process check.**

### A completeness check is a parse, and a parse is not the thing (D439)

The sweep prints one line per mutant and the corpus declares one row per mutant,
so "did every row run" looks like a two-line `comm`. **Both lines were wrong on
the first attempt, in opposite directions, and each would have produced a
confident false report.**

- **The corpus side.** `grep -oE 'id: "..."' scripts/mutation/mutants.ts`
  returned **1707** for a **1715**-row corpus: eight rows are written in a shape
  the pattern does not match. Trusting it means reporting **eight missing
  mutants on a sweep that ran every row** — an invented failure, which is worse
  than a missed one because it costs a slice to chase. **Enumerate from the
  module** — `bun -e 'const {MUTANTS} = await import(...)'` and read `.id` — so
  the count comes from the same structure the runner iterates. This is
  *`grep -c` counts text, not structure* on its **fourth** distinct axis: a
  `what:` string, a comment, a `;` inside an object type, and now an `id:` that
  does not sit alone on its line.
- **The log side.** Splitting each line on the ` … ` column separator returned
  **1716** ids for 1715 rows, because **one row's own prose contains the
  delimiter**. *A delimiter that also occurs inside the payload is not a
  delimiter* — the same defect as parsing a union to its first `;`.

**So run the comparison in BOTH directions and read both residues.** `missing`
alone would have shown the eight phantoms and hidden the parse bug; `extra`
alone would have shown the phantom row and hidden the eight. The tell that a
residue is a parse artefact rather than a real gap is that its "id" carries a
trailing fragment of English.

### The delta of a whole-corpus sweep should equal the slice (D439)

A green sweep says the corpus passes; it does not say *this slice changed only
what it meant to*. Subtract the previous sweep's line: D438 closed at
`1678 killed · 26 known`, D439 at `1688 killed · 27 known` — **+10 and +1, which
is exactly D439's 11 new rows**. Equality means no pre-existing row flipped
verdict, which is the claim worth making about a slice that **generalised a
shipped function in place**. An unexplained delta is a finding even when every
verdict is green.

## A confound in the BUILDABLE subset is not a confound in the print (D440)

D440's four buildable sentences are perfectly confounded on two axes: every printed
`more` row counts YOUR discard pile and every printed bare row counts your
OPPONENT's. **A build that derived the seat from the fold reads all four printed
sentences and all eight printings correctly**, so a suite written entirely on the
print passes on the defect.

**The confound was an artefact of the VOCABULARY, not of the catalog.** The pool
does print the `×` fold over YOUR pile — that row is refused for its FILTER, not for
its seat — so the defect is live the day the vocabulary widens by one map row. That
distinction is what decides the answer:

1. **Ask whether the suites already drive constructed text before choosing.** They
   do. Measured by extracting every `deriveAttackDamage*("…")` call with a single
   double-quoted literal argument and testing corpus membership: **45 such calls, of
   which 38 carry a NON-corpus sentence.** A crude verb heuristic put **10** of those
   38 on a positive VALUE assertion rather than `toBeNull`; **8 were then read
   directly and all 8 confirm it** — `bodiesInPlayScaling` ×2 (one of them carrying
   the note *"Constructed, and labelled so."*), `trEnergyBonus` ×2,
   `typedEnergyThreshold`, `crossBoardStatus`, `opponentCounterMultiply` and
   `benchBodyScaling`. ⚠️ **THE PATTERN'S EDGE, STATED** (D425): it cannot see a call
   whose argument is an identifier, a template literal or a single-quoted string, so
   45 is a FLOOR on the population and not a census. A reader is a function of TEXT, so a
   rung over unprinted text is a claim about the READER, not about the pool.
   Declaring `survives: {unreachable-population}` here would have been an invented
   reason with a true-looking shape.
2. **Then give the mutant an attribution control.** With D440's two constructed
   rungs temporarily removed, both seat-from-fold mutants **SURVIVE** and the
   evaluator seat-cross still dies. Without that experiment, "13 KILLED" is a claim
   about an exit code. This is D214's attribution-control rule reaching a mutation
   row instead of a build artifact.

## Re-derive a union's rule; do not read it off the member names (D440)

Every one of `DamageCountSource`'s sixteen prior members spells a side into its NAME,
which reads as a law. **It is not the law, and the two stated reasons are both
narrower than the pattern they produced:**

- **D168** — *"a `side` would have to be read by `scaledAttackDamage` anyway, and the
  three members that have no side at all would then carry a field they must ignore"*
  — is a claim about a **union-wide** side. A per-member field makes no side-less
  member carry anything.
- **D369** — *"parameterising instead is not a widening but a RENAME of a shipped
  member, which D362 priced at 31 sites across 7 files against 4"* — is about
  **retrofitting**. There is nothing to rename when the member is born with the field.

What decides it positively is **D193's `zone`, inside the same union**: two members
would each have to carry the identical payload, and *"duplicating the field that
answers 'which Energy counts' is precisely the second answer to one question D159
forbids."* So the real rule is **nullary or asymmetric payload ⇒ two members;
identical payload ⇒ one member with the discriminator as a field** — and every
shipped pair fits it.

**A unanimous set of names is a habit until you read the reasons** (D431's
property-versus-habit test, arriving at a naming convention).

## A closed noun map is what keeps a data-blocked refusal honest (D440)

D440's vocabulary could have been a capture: `^(.+) card$` → `byName` spells the one
proper-name noun without the file learning a card name, which is the property D439's
owner-noun pattern was built for. **It also claims `"Ancient card"`** — a `byName`
filter matching nothing in the catalog, counting 0 on every board, leaving a
permanently DATA-BLOCKED sentence scoring its printed base forever while
`BUILT.attack` steps for it. That is D190b/D199 at the instrument layer: *a
wrong-but-plausible program is strictly worse than an unbuilt one*.
🆕🆕🆕 **D569 (D539): "permanently DATA-BLOCKED" is WITHDRAWN** — `"Ancient card"` is a closed-map
ROW now (`DISCARD_PILE_NOUNS` → the any-category `bannerCard` over `banners.ts`), Roaring Moon
"Vengeance Fletching" ×2 is built on it, and the `byName` capture this section refuses is still
refused — which is exactly the honesty the closed map was for.

**When a vocabulary could be a capture, ask what the capture claims that the map
refuses** — and write the mutant, because it is right about every sentence the slice
claims and only the refusal rung and the census move.

## An apostrophe in a KEY needs `literalClauseRow`, not `Map.get` (D440)

`IN_PLAY_BODY_NOUNS` (D439) uses a bare `.get`, correctly — its three keys carry no
apostrophe. D440's map is the first in the family whose key spells one
(`Ethan's Adventure card`), **so a successor copying the neighbouring function writes
the defect by imitation.** A bare `.get` loses the row under a punctuation-normalising
re-ingest and the printed sentence falls silently off the built set.

**No board and no census can see it.** The only instrument that can is
`clauseApostrophe.test.ts`'s re-ingest sweep, which rewrites every derivable
apostrophe-bearing fixture sentence at U+2019 and requires reader-for-reader
EQUALITY. Check whether your table's keys carry the character before copying the
neighbour's lookup — and measure the corpus byte with `codePointAt`, never by eye
(D421; D440's three slots are all U+0027, at indexes 70, 62 and 46).

## An owner-prefixed fixture is a census subject even when it is not a Pokémon (D440)

`fix-ethansadv` ("Ethan's Adventure") reddened the D242 prefixed-NAME enumeration in
**three** suites — `inPlayTarget`, `ownerTargetOps`, `switchSeam` — while being
**invisible to every `ownerPokemon` PREDICATE in the engine**, because that arm
requires `category === "Pokemon"`. D337 recorded *"a shared pool is shared per SWEEP,
not per test"* about bodies; this is the same finding arriving from the Trainer side.

**Before adding a fixture with a possessive in its name, grep the NAME sweeps rather
than the predicates.** A predicate that cannot see your card is not evidence that a
sweep cannot.

## Not every classic defect is reachable — say so rather than write a straw (D440)

D440 was asked for a "counts units rather than cards" mutant and does not have one:
a count built on `matchesFilter` is **cards by construction**, because that function
is a per-CARD boolean with no unit reading to mutate into, and D436's comparand rule
needs a SYMBOL comparand that a bare count has none of. The nearest REAL defect is
the provision VOCABULARY (`{ kind: "providesEnergy" }` in the noun map), and that is
the row that was written, with the unreachability stated in its own `what`.

**A straw mutant proves nothing about a real defect** — and a corpus row whose
premise is unreachable is D420's *"a row that survives because it changes nothing"*
waiting to happen.

### Write the expected sweep delta down BEFORE the sweep runs (D440)

D439 established that a whole-corpus sweep's delta should equal the slice. D440
went one better: the resume point named the expected delta — **+13 killed and +0
declared** — *while the sweep had not yet been launched*, and that is what
arrived. **Make it a prediction, not a reading.** A number subtracted afterwards
can be rationalised into agreement; a number written down first cannot. Put the
expectation in the resume point beside the debt, so whoever runs the sweep is
checking a claim rather than describing an outcome.

**And the zero half carries as much as the other half.** `+0 declared` says the
slice added no equivalent and moved no existing verdict — worth stating
explicitly on any slice that **generalises a shipped function in place** or
re-transcribes a neighbour's rows, which is exactly when a silent verdict flip
is plausible.

### Report the MATCHED count, not the two totals (D440)

`listed === run` is not "every row ran": it is also satisfied by a run line
matched to the *wrong* id. The check that means something is the third figure —
how many listed ids were found in the log — reported alongside the count of run
lines matching **no** listed id. D440 measured **1728 listed / 1728 run lines /
1728 matched / 0 unmatched**.

Anchoring on the id list also dissolved D439's phantom `extra`: nothing parses
the ` … ` separator any more, so a row whose prose contains the delimiter is no
longer able to impersonate a mutant. **A check anchored on the structure cannot
be fooled by prose that contains the structure's punctuation** — which is the
general form of the fix, not a special case for that one row.

## A quantifier that answers two questions is ONE field (D441)

`moveEnergy.max` went `number | "any"` → `+ "all"`, and the tempting shape was a
separate `mandatory?: true` beside the number. **It is refused because the printed
determiner answers the quantity AND the declinability at once**, so two fields
would spell combinations nothing prints — `max: 3` with the flag is *"Move exactly
3"*, and `max: "any"` with it is *"any amount, but not none"*, which is not
English. D361 settled the identical question one op over on
`discardEnergy.count`, on the same word: **a WIDENING is free; a GENERALISATION is
not.**

⚠️ **The test is not "how many questions does the union member answer" but "how
many INDEPENDENT questions does the PRINT ask".** If the two always co-vary in
print, a second field is a way to author cards nobody printed.

## Derive the new field's spelling from the model, not from the slice (D441)

D441 needed a mandatory-vs-declinable floor on a prompt that had none. The answer
was **not invented**: `min === max` is already this engine's spelling for exactly
that fact in three shipped places — `chooseCards`'s wire doc (*"`min` is the
DECLINABLE split (0 = the printed 'up to', `min === max === count` = a mandatory
exact cost)"*), `choosePokemonMulti`'s `{min, max, declinable}`, and the
`const exact = prompt.min === prompt.max` **both** HUD dialogs caption from.

**Before adding a field, grep the sibling members of the same union for the fact
you are about to name.** A shape that already has three readers costs nothing to
learn and cannot drift from them; a new one has to be taught to every surface.

## Which way does the absent key point (D441)

D432/D434/D435 built the sequence *no rest → required*, *rest not old → required*,
*rest old but degradation is `NaN` → required*. D441 is the case where the optional
road is not merely available but **correct**, and the discriminator is DIRECTION:

- **D359 BUMPED 21 → 22** because `choosePokemon`'s absent `upTo` came to mean
  MANDATORY, where a v21 record's bytes meant DECLINABLE.
- **D441 stays at 29** because `moveEnergy`'s absent `min` means DECLINABLE, and
  every park an older deploy could write **was** declinable.

Same field shape, same persisted address, opposite answers. **The question is never
"is the key optional" — it is "does the ABSENT key still say what the old writer
meant".** And it is settled by reconstructing an old record (delete the key the old
writer never wrote), replaying it through the real action API, and asserting the old
answer is still accepted — beside the new board refusing it. Both directions or
neither.

⚠️ **The exact precedents are usually already written down.** D333 measured no bump
for a **widened `max` union** and D334 none for an **added optional `exact`**, both
on the SAME op (`lookAtTopN`), and both are quoted verbatim inside
`MATCH_RECORD_VERSION`'s own doc block. Read that block for your shape before
reasoning from the type's name.

## An op's arity doctrine can have a hole nothing has ever reached (D441)

`parkOrForce`'s 0/1/≥2 doctrine is shipped and correct, and `moveEnergy`
**hand-rolls it and has never had the 1 arm at all** — not by oversight, but because
a DECLINE was always a second answer, so no board this op could reach ever offered
exactly one. The first mandatory quantifier removed the decline and the arm became
reachable in the same edit.

**When you remove an answer from a prompt, re-derive its arity from scratch.** The
missing arm is invisible until you do, because every existing board still has two.
And **gate the new arm on the thing that changed** (here the FLOOR), not on the
condition that happens to co-occur (the destination count) — the loose gate is
D358's shipped defect, and it silently forces every declinable sibling on the same
board.

## The pre-build tripwire audit is right to run and wrong about which row (D441)

D436's GAP produced the rule *before building what an earlier slice refused, grep
the mutation corpus for the SENTENCE*. D441 ran it over all 1,728 rows from the
module, on six fields, with ten needles, and read all 48 hits. **The audit's
conclusion held — nothing rested on the refusal — and its PREDICTION was wrong.**
It expected D229's two anchor rows to rot; the build took a separate third anchor
and they did not. What rotted was `D244-any-amount-clamps-to-one`, whose `find`
quotes a HELPER the audit had read and not flagged.

⚠️ **An audit that names the rows it expects to break is doing two jobs, and only
one of them is reliable.** The GAP question ("does a row rest on this refusal") is
answerable by reading. The ROT question ("which `find` will stop matching") is
answerable only by `bun scripts/mutation/precheck.ts`, which costs seconds and is
mechanical. **Do both, and never let the reading stand in for the precheck.**

## A separate anchor is cheaper than a wider alternation when the KINDS differ (D441)

Widening `/^Move (?:(\d+)|an) …/` to `(?:(\d+)|an|all)` looks like one character of
work. It is not: the arm reads the absent capture AS the value (`match[1] ===
undefined ? 1 : Number(match[1])` — the whole of D229's article reading), so a third
alternative producing a DIFFERENT `max` kind forces the arm to ask which branch
matched. **Two kinds, two anchors** — the rule the BASIC sibling already stated for
a different reason (the article moves with the noun).

⚠️ **And it has a second payoff that is worth naming: a new anchor breaks no
existing row, where an in-place widening rots every mutant that quotes the regex.**
D414's lesson, avoided rather than paid.

## Splitting a deferral list by REASON (D441)

`derivedSelfEnergyMove.test.ts` carried a two-row `DEFERRED` list whose comment gave
ONE reason (`max`) for both. D441 collected one of them and discovered the other's
blocker was never `max` at all — it is the ANSWER SHAPE. The list was **split into
two named lists, each with its own falsifier**, rather than shortened.

**When you collect half of a deferral, check whether the stated reason was ever true
of the other half.** A list that keeps its original justification after losing a
member is asserting that reason about a sentence nobody re-checked — D422's stale
refusal, arriving inside a test fixture instead of a doc block.

## Not every shape change is at a persisted address (D442)

**Before pricing a type change against `MATCH_RECORD_VERSION`, grep for where the
type actually LANDS in `MatchRecord`.** D442's brief asserted that the
`moveEnergy` CHOICE shape *"is persisted in `phase.cont`"*, which would have made
a rename D359's case and owed a bump. It is false: a `MatchRecord` is
`{version, seed, startedAt, state, log, names}`; `state.phase` (`effect:choose`)
holds the PROMPT and an `EffectContinuation` (`{pendingOp, rest, ctx, record?}`);
`log` is the RENDERED `SeatLogEntry[]`. **An `EffectChoice` is in none of them** —
it rides one `resolveEffect` action, is validated, is applied, and is gone.

D427 wrote *"choosing a carrier does not duck persistence — drive the record, do
not reason from the carrier's name."* This is the same rule pointing the other
way and it is worth as much: **a shape that is NOT persisted must not be priced as
though it were**, or a slice pays a bump it does not owe and retires every live
match to do it. The version question is still asked — D442's two OPTIONAL
`anyDest` riders (one on the persisted OP, one on the PROMPT) are exactly D334's
case and are driven over reconstructed v29 bytes — it is just asked at the right
address.

## A coupling expressed by a SHAPE becomes an assertion when the shape widens (D442)

Under `{ kind: "moveEnergy"; uids: string[]; dest: PokemonRef }`, *"every pick
lands on ONE destination"* was true **by construction** — unwritable and
unbreakable. Under `{ picks: { uid, dest }[] }` it is one `if` in
`validateChoice`, and deleting it turns Energy Switch and Poppy into spread cards
**with every board driving the new sentences still green**.

**When you widen a shape, enumerate what the OLD shape was asserting for free and
write each one down as a check.** The mutant that deletes it is the one worth
writing, because the slice's own suite cannot see it.

## Two riders need two rows when they are independent in the PRINT (D442)

`moveEnergy` now carries `anySource` (D226) and `anyDest` (D442). They co-occur on
two of the three printed sentences and not on the third, so a suite asserting only
*"the spread resolves"* is green under whichever rider it did not happen to
exercise. **One mutant per rider, each the other's control** — the same rule
D440's confound argument reaches from the vocabulary side.

## A row can be unkillable in one direction and killable in the other (D442)

Building a regex character class from `Object.keys(ENERGY_TYPE_BY_CODE)` buys two
properties, and only ONE of them is observable:

- **it cannot ADMIT a code the map refuses** — unobservable, because the arm's own
  `energyType !== undefined` guard turns an unmapped code into exactly the `null`
  an unmatched anchor already gives;
- **it cannot DROP one the map carries** — observable: the printed sentence falls
  silently off the built set and `BUILT.attack` steps back.

D442's first version of that row installed the ADMIT direction and **SURVIVED** —
D420's *a row that survives because it changes nothing*, found by the probe rather
than by reading. **Measure which direction is observable, write the row for that
one, and record the other at the guard** rather than deleting a guard the type
system needs.

## Appending to a shared demonstrator reddens its provenance rungs (D442)

`fix-trainerops` gained three attacks at 63-65 and **twelve** suites pin
`attacks.length` on it. Only one of the twelve surfaced first, and it surfaced as
a **RED BASELINE inside the mutation harness** (`--decision D229` reported ERROR),
because the full-suite run predated the append.

**Grep `toHaveLength(<old>)` across `packages/engine/src/*.test.ts` immediately
after appending to a shared fixture**, and step every hit in one pass — D431's
sibling rule, arriving at a fixture instead of at a census chain. The rungs exist
to catch exactly this and they did; the expensive part was finding them one at a
time.

## D437's converse trap is easiest to hit when you add a COMPONENT (D442)

A new dialog written beside an existing one naturally repeats its neighbour's
lines. `const canDecline = floor === 0;` written a second time in the same file
makes `D441-*-hud-keeps-the-decline` match **2×** — a row broken by a file the row
does not describe. `precheck` catches it in seconds. **Spell the new copy
differently (or inline it) and say at the site why**, so the next author does not
"tidy" it back.

### A resume point is a work order, so correct a false one in place (D442)

The run's standing practice is **not** to retro-edit earlier slices when they
merely disagree with a later one — three slices' numbers are not evidence, and
neither is one slice's dissent. **A factually false claim is a different case.**
D441's resume point asserted that the `moveEnergy` choice shape *"is persisted in
`phase.cont`"*; it is persisted nowhere, and the claim would have forced a
`MATCH_RECORD_VERSION` bump that nothing owes. That paragraph was copied into
D442's brief **verbatim**, which re-asserted it — and only measuring
`MatchRecord` instead of obeying the paragraph caught it.

So: **a disagreement is recorded and left standing; a falsehood is corrected
where it lives**, with a note saying which slice corrected it and how it was
measured. The test is whether a future reader acting on the sentence would do
the wrong thing.

**And a claim carried forward is still a claim being made.** It inherits no
evidence from having been written down before — this is the same rule as *a
streak is a claim; extending one asserts it afresh*, arriving at a work order
instead of a count.

### Editor diagnostics are not a measurement while the harness is running (D442)

The mutation harness writes a mutant into a source file, runs a suite, and writes
the original bytes back. An editor or language server that indexes the file
inside that window reports a file the repo never had — during D442's verification
the LSP surfaced errors in `interpreter.ts` about members that do not exist,
sitting on top of a tree where `tsc -b` exits 0.

**Settle it with the tool that owns the answer** (`bun run check`, or `bunx tsc
-b`) and with `git status`, not with a diagnostics panel. This is the same rule
as *a process check that can match the checker is not a process check*, one layer
up: an instrument that samples a transient state is reporting the instrument, not
the tree.

## A brief's "this would be the first X" is a claim about a CLASS (D443)

D443's work order asked the `decider` question by naming the three shipped
`RunResult.decider` producers and observing that all three hand the choice to the
opponent — so an attacker-decided pick on the opponent's board "would be the first
of its kind."

**The comparison set was wrong, not the reading.** The class is not *parks that
file a `decider`*; it is *picks on the other seat's board*, and that class is
large and unanimous the other way: `knockOutChosen` (D416), `discardEnergy`'s
`opponentChosen` arm, `gust`, `returnBenched { whose: "opponent" }` all park on
the opponent's board with **no** `decider`. D416's own comment states the rule —
*"Only two ops in this switch file one and both print the chooser explicitly"*.

**When a brief says "this would be the first X", derive the class X before
counting its members.** A set enumerated from the FIELD you are about to add is a
set of things that already have it, which tells you nothing about whether you
need it.

## The reference states the doctrine; the code shows the habit (D443)

Three shipped producers agreeing is a habit (D431). `docs/reference/ptcg-rules.md`
§9.4 settles the same question outright, in one grep:

> *"Almost every printed effect is decided by the player resolving it, even when
> it reaches across the table … the target is theirs, the choice is yours. A small
> family inverts that, and the wording is the tell: **"your opponent may …"**."*

**Ask the rules doc for the rule before generalising from the engine's cases.**
The doc names the discriminator (a printed chooser) where the cases only exhibit
one.

## Widen a parameter's MEANING at the call sites, not in the body (D443)

`moveEndpoints` had to start answering about the OPPONENT's board. Rewriting its
body — five `seat`s → `board` — would have rotted **five** shipped mutant rows
(`D229-source-scope-is-the-whole-board`, `D229-destinations-include-the-active`,
`D229-destinations-are-the-other-seat`, `D229-needed-is-two`,
`D244-othersToSelf-is-benchToActive`), every one of which quotes those lines.

Every route in that function already read its endpoints off whatever seat it was
handed, so the widening was **two call sites** passing `moveBoardSeat(op, seat)`
and a doc paragraph. Body byte-identical, zero rows re-transcribed.

**Before rewriting a function to take a new fact, check whether it already takes
it and the CALLERS are the ones deciding wrongly.** This is D441's *a new anchor
breaks no existing row* one layer up — D414's lesson avoided rather than paid, on
a parameter instead of a regex.

## Price the NAME when the name is a persisted byte (D443)

D438's rule is *rename when the second inhabitant arrives*. `selfToBench` gained
one: with `side: "opponent"` it reads *the board's Active → that board's Bench*,
which is what its code always computed, and only the word "self" is now wrong.

**It is refused, and the reason is the address.** A `route` VALUE lives inside
`phase.cont.pendingOp`, which is inside `state`, which is inside `MatchRecord` —
so renaming it is D359's case and bumps `MATCH_RECORD_VERSION`, retiring every
live match for a word. The refusal carries an executable falsifier: **the day the
constant bumps for any other reason, rename it in the same edit.**

D438's rule still holds for names that are not persisted. **Check the address
before you apply it.**

## A shield has no valence — do not invent one (D443)

`moveEnergy` reaching the opponent's board asks §11 for the first time, at BOTH
endpoints: a body that would LOSE Energy and a body that would GAIN it are both
filtered. Every printing in the family says *"prevent all … effects of attacks
done to this Pokémon"*; **none says "harmful effects"**, and the engine's own
model (`effectRefusedOn` takes a body, not a valence) has no place to put the
distinction.

**A harm/benefit split would have been a rule invented at the call site** — D424's
*prefer the refusal the model re-derives over the one listed against it*, arriving
at a gate instead of at a blocklist.

## Three shape changes, one persisted address (D443)

D443 changed an op field, a `GameEvent` field and (not) a prompt. Only the op
lands in `MatchRecord` bytes:

- **`moveEnergy.side`** — inside `phase.cont.pendingOp`. **PERSISTED.** Optional,
  and ABSENT means what every v29 writer meant (v29 had no opponent-board move to
  write) → D334, no bump.
- **`ENERGY_MOVED.actor`** — a `GameEvent`, and **no `GameEvent` is in a
  `MatchRecord` at all** (`{version, seed, startedAt, names, state, log}`; `state`
  is a `GameState`, which holds no events; `log` is rendered). Not persisted, so
  **REQUIRED was free** — D425's call, and the next producer is a compile error.
- **the prompt** — unmoved. Every `PokemonRef` already carries an ABSOLUTE seat,
  so `side` rides the OP alone where `anySource` and `anyDest` ride both. Those
  two are COUPLINGS, invisible in the candidate lists; this one is spelled by
  every candidate.

**Enumerate your slice's shape changes and give each its own address.** D442's
rule (*not every shape change is at a persisted address*) generalises: on a slice
with several, the answer differs per change and "the version question" is not one
question.

## A one-sided marker rung is green under BOTH defects (D443)

*"The opponent's rows say `opponent`"* passes on a build that says it on **every**
row. *"My rows say nothing"* passes on a build that says it on **none**. The
killing case is the same-render **pair**: two identically-named bodies, two rows,
exactly one marker — and one mutant per direction, each the other's control.

⚠️ **And check the control is reachable.** D443's first online control asserted
that no unmarked row rendered — vacuously true, because on a sole-source prompt
the viewer's own bodies are never offered as buttons at all. The fix was a
constructed mixed-board prompt, **labelled as constructed** (D440: a rung over a
prompt the engine never emits is a claim about the READER, not about the pool).

## An indentation-prefixed mutant anchor is ambiguous (D443)

`find` is a SUBSTRING search, so a needle beginning with 18 spaces **matches
inside a line indented 20**. Two JSX badges at different depths are not
disambiguated by their indentation, and `precheck` reported `find occurs 2×` for
both HUD rows on the first try.

**Include a neighbouring line when the line you want is a repeated idiom.** This
is D416/D437's copied-line trap reached through whitespace rather than through a
copied function.

## The version tax appears in PROSE as well as in assertions (D443)

A blanket replace of `0.344.0` → `0.345.0` across 30 files stepped 27 assertions
correctly **and corrupted two historical claims**: a suite header recording
`0.343.0 → 0.344.0` became `0.343.0 → 0.345.0`, and the new suite's own header
became `0.345.0 → 0.345.0`.

D435 already said *grep the assertion, not the string*. This is the failure that
rule predicts, arriving from the WRITE side rather than the count side: **a
mechanical version bump must exclude the prose that records what a PREVIOUS bump
was.** Re-grep the old version string afterwards; the hits that remain should be
exactly the historical ones.

### `--decision` takes ONE value, and passing more fails silently (D443)

Repeating the flag does not union the selections — the last one wins and the
earlier ones are discarded without a warning. D443's "six-decision neighbour
re-probe" was quietly a one-decision re-probe until it was re-run per decision.

**The output looks like a pass either way**, which is what makes it worth a rule:
a green line naming a smaller row count than you expected is the only tell, so
**check the row count against the number of rows you meant to probe**. Run the
decisions separately and report each.

This is the same family as the `--allow-dirty` trap (`0 killed · N
skipped(dirty)`, exit 1) and the `--precheck` non-flag (which silently starts a
full sweep): **the harness's argv handling is not forgiving, and its failures are
verdict-shaped.** Read the count, not the colour.

### The strongest `+0` is the one on a slice that changed a MEANING (D443)

A whole-corpus sweep's `+0 declared` is worth stating in proportion to what could
have flipped under it. D442 earned one by renaming a shipped wire member. D443
earned a stronger one: it changed **three shipped meanings** — a `GameEvent`
field (`ENERGY_MOVED.seat` had meant controller *and* board, true for all four
producers by accident), a helper's parameter (`moveEndpoints`' `seat`), and a
`route` value (`selfToBench`). None of those is a type error anywhere; every
reader still compiled and still ran.

**That is precisely when a pre-existing row flips without anyone noticing**, and
1,752 rows that knew nothing about the slice still died for the same reasons they
always had. When a slice redefines what a shipped name MEANS rather than what it
holds, say so beside the zero — the zero is the measurement that the redefinition
did not leak.

## A NAME can enrol a function in a mechanism (D444)

🛑 **`censusAttackCorpus.ts` derives the whole-sentence reader surface off
`effects.ts` by NAME PREFIX (`deriveAttack…`) plus `typeof === "function"`. That
makes `deriveAttack` a RESERVED NAMESPACE with nothing but a string behind the
decision.** D444 added a new export called `deriveAttackTimingGate`, which
enrolled itself as a reader — and because `resolvedByAnyReader` tests
`read(text) !== null` while that function answers `undefined`, the predicate
claimed **every sentence in the corpus**. 22 rungs across 5 files went red in one
run.

That is the exact failure `resolvedByAnyReader`'s own doc block predicts for a
mis-named reader, and it fired for a function that was never meant to be one.
**Before naming a new `effects.ts` export, ask whether the name puts it inside a
surface that is derived by pattern.** The membership test is the name; there is no
type, no registration, and no compile error. It is also the good news: the surface
guard caught it in one run, loudly, which is exactly what D417 built it for.

⚠️ **A derived surface is a two-sided contract, and only one side is usually
tested.** The rungs everyone writes say *"every reader is in the surface"*. The
one that catches this says *"every member of the surface is a reader"* — and the
cheapest form is to assert the two SETS are equal, which reddens on an accidental
member as well as on a missing one.

## Re-pointing a rung whose PREMISE your slice removes (D444)

D418's rule — *after re-pointing, ask what the OLD claim could catch that the new
one cannot* — has a second shape, and D444 hit it twice in one slice.

`benchBodySelfScaling.test.ts` §4 and `rolloutGate.test.ts` §5 both pinned *"a
body printing the clause with NO registry row keeps its whole string and stays
LOUD"*. D444 made every table clause represented BY CONSTRUCTION, so those bodies
stopped being unrepresented. **Re-pointing the rungs onto the same bodies would
have produced two TRUE assertions that nothing can falsify** — the split fires
either way now.

**The move is to find the body that STILL has the old property**, not to relax the
claim. Here that is a NEAR-MISS: the same printed shape with one token changed, so
it is genuinely outside the table, genuinely ungated, and genuinely loud. The old
discrimination survives intact on a new subject, and the mutant that depended on it
(`D282-split-fires-without-a-gate` at the split; the polarity rows at the map) still
dies. ⚠️ **And the near-miss must differ on exactly ONE axis (D427)**, or it says
nothing about which feature did the refusing.

## Half a sentence can fail loudly while the other half fails in silence (D444)

🛑 **This engine's coverage strategy is "flag loudly rather than guess", and it has
one hole: a printed RULE that nobody authored is simply absent.** A body printing
Terapagos ex's *"If you go second, you can't use this attack during your first
turn. This attack does 30 damage for each of your Benched Pokémon."* with no
registry row was — measured on a board — **loud about the damage and silent about
the restriction**: `ATTACK_EFFECT_SKIPPED` fired naming the whole sentence and the
fold was withheld, while `attackGateOf` answered `undefined` and the attack
declared successfully on exactly the turn the card forbids.

A rung had pinned that body since D282, and it pinned the LOUD half. **When a
printed sentence carries a rule AND an effect, a guard about the effect is not a
guard about the rule** — they resolve at different seams (the §8 declaration gate
versus the §8.5 pipeline) and they fail in opposite directions. Ask what happens to
each half separately, and drive each on its own board.

## A refusal can be right about its measurement and wrong about its QUESTION (D444)

D395 refused a derived `attackGate` on two measured grounds, and D444 reversed it
without either ground turning out to be false:

- *"a deriver buys ZERO additional legal printings"* — **still true at D444's
  head.** ⚠️ And scoped to `legal_standard = 1`, while the app ships an
  **`expanded`** format keyed on `legal_expanded` (`src/features/builder/cards.ts`
  `legalFlag`). effects.ts's own block already recorded that the pool-wide query
  returns 15 where the legal one returns 13. **D413's two populations, two answers
  — biting a refusal one level above a census.**
- *"a deriver makes `attack.ts`'s two-key check a tautology"* — **also true, and it
  is a price rather than a blocker.** It was paid: the check is kept as defence in
  depth with the argument written at the line, and the mutant that check earned is
  re-declared `survives: equivalent` with a reason that self-invalidates.

**What the refusal never asked was what happens to the RULE on an unrepresented
body.** It reasoned entirely about the SPLIT. ⚠️ **So the check on a refusal is not
only "are its numbers still true" (D413/D422) — it is "did it ask the whole
question".** A refusal can be arithmetically perfect and still be about the wrong
half of the mechanism, and re-running its query will never tell you.

## Registry ?? derived: keep the row, and assert the two against each other (D444)

D402's finding, re-earned one field over. When a hand-authored registry row gains a
DERIVATION behind it, the honest move is `authored ?? derived` and **keeping every
row**: the row still wins, no board moves, and the two producers become assertable
against each other — which is a stronger rung than either had alone.

D444's form: every DISTINCT `attackGate` value in the live registry must be either
a value the printed clause derives, or a named exception (the one trailing-clause
family). That single rung is what ties the clause table to 17 hand-authored rows,
and it reddens by VALUE the day a row is authored at the wrong polarity — the
failure D281's own doc block calls the easiest thing there to get wrong.

⚠️ **And be honest when the PRECEDENCE itself is unobservable.** If the two
producers agree everywhere, no board can tell `a ?? b` from `b ?? a`; that mutant
is `equivalent` and should be DECLARED as such, with the agreement rung named as
the thing that would make it killable again.

### Prefer the NON-MONOTONE sweep prediction (D444)

D440-D443 each committed to a sweep delta before the sweep ran, and each was of
the form `+N killed, +0 declared` — which follows from counting the rows you
added. That arithmetic survives being sloppy: a slice that only ADDS rows can
hardly land anywhere else, so hitting it confirms the practice more than it
confirms the slice.

D444's prediction was **non-monotone in both columns at once**: 8 new rows (7
killed, 1 declared) *and* one pre-existing killed row converting to a declared
survivor, giving `1752 + 7 − 1 = 1758` and `27 + 1 + 1 = 29`. That number could
only be produced by knowing **which** existing row was about to change class and
why. It tests comprehension rather than addition.

**So when a slice changes the class of an existing row, say which row and write
the subtraction out** — do not fold it into a net figure. A slice that turns a
killed row into a declared survivor is exactly the shape that gets read as a
regression by whoever diffs the two totals, and the only defence is having named
it in advance.

### `!resolvedByAnyReader` is not the unbuilt set (D444, re-earned)

The reader surface is one of four ways a printed sentence gets simulated; the
others are a registry row, the gate splitter and the trailing splitter. Measuring
"what is left" with `!resolvedByAnyReader` alone therefore over-counts, and
`censusAtHead.test.ts` has a canonical residue predicate precisely so nobody has
to re-derive the subtraction.

**This was already a convention and a work order broke it anyway**, calling three
sentences unbuilt that had been simulated since D282/D307 — because the loose
predicate is one call and the right one is four. ⚠️ **The tell is cheap**: before
claiming a sentence is unbuilt, run `splitAttackGateClause` and
`splitAttackTrailingClause` on it and check the registry. If any of the three
answers, the sentence is built and the census already knows.

## A count over a HIDDEN zone is an information channel (D445)

`DamageCountSource` had a standing invariant nobody had written as a rule: every one
of its sixteen members counts something both seats can see. D440 stated it for the
discard pile — *"ordered and public (§2), so the opponent-side read leaks nothing"*.
**D445's member counts the opponent's HAND, and the damage number it produces is
public**, so the fold itself is a channel: a public number reporting a private fact.

The engine does not get to decide that. **The PRINT does**, and the two printed rows
keep the invariant by two different routes:

- *"…for each **card** in your opponent's hand."* counts hand SIZE, which the board
  already shows (`cardplay.ts` greys a Trainer-path reveal on an empty opponent hand
  for exactly that reason);
- *"Your opponent **reveals their hand**. …for each **Trainer card** you find there."*
  counts a narrower set, and the printed reveal is what makes it public.

**So the rule is not "the zone is public" but "the sentence makes the COUNTED FACT
public"** — and it is pinned on the POPULATION (no corpus sentence carries a filtered
hand count without a printed reveal), never on a specimen (D423). ⚠️ **Build only the
filtered row and the claim is unfalsifiable**; the unfiltered row is the control that
makes the reveal's role provable rather than asserted.

## Two readers may own one sentence, and `attack.ts` said otherwise (D445)

`attack.ts` carried *"a card carries at most one scaling clause OR a program: the
whole-sentence anchor means a scaling sentence never also derives an op."* **Measured
across all 640 corpus sentences at D444's head: ZERO were claimed by more than one
reader — a HABIT, not a property** (D431's test), and the locals were already separate
(`program` runs at the TAIL, `scaling` folds before §8.5), so the code was fine and
only the sentence was wrong.

A compound whose halves land at two different SEAMS needs both readers. Claiming only
one is D444's half-a-sentence defect with the census green: `resolvedByAnyReader`,
`effectSimulated` and `BUILT.attack` are all satisfied by whichever half you took.
**When a printed sentence carries an effect AND a fold, count the seams, not the
anchors** — and pin "this is the only dual-claimed sentence" as a population rung, so
the next one arrives on purpose.

## The trailing splitter's mirror image is not the trailing splitter (D445)

`splitAttackTrailingClause` composes HEAD-claimed-by-any-reader + TAIL-claimed-by
-`deriveAttackEffect`, and says so at the guard: *"a tail claimed only by a damage
reader would be a fold the caller has no place to put."* D445's compound is exactly
that predicate reflected — an EFFECT head and a DAMAGE tail — so it is refused by
construction and would need the splitter INVERTED, not reused.

**Two whole-sentence anchors over the same string cost two arms; a second composition
path costs a mechanism.** Check which way round the compound runs before reaching for
D409.

## `.test()` where the sibling does `.exec()` ships half a sentence (D445)

D445's first draft claimed the reveal with a bare `ATTACK_REVEAL_AND_TRAINER_SCALE
.test(effect)` while the damage arm over the SAME anchor carried `per >= 1 && filter
!== null`. The anchor's noun group is `[^.]+`, so *"…for each Ancient card you find
there."* matched: the reveal resolved, the sentence was marked SIMULATED, and the
damage was silently dropped. **D190b's exact-map-or-flag rule, in the direction that
looks like it works** — a board changes, a log row prints, and the loud channel never
fires for a card the engine cannot score.

**When two arms share an anchor, they share its GUARDS.** A `.test()` beside an
`.exec()` on one regex is the tell.

## A deferral that names a MECHANISM has a trigger too (D445)

D413's rule is about refusals; this is the same shape at a helper. `countCardsInDiscard
Pile` recorded *"the `hand` twin one arm down is DELIBERATELY LEFT INLINE … folding it
in would mean a `zone` parameter and a rewrite of a shipped arm **for a family this
slice does not print**"*. D445 prints that family, so the deferral expired exactly
where it said it would, and D440's own move (generalise in place, make the old arm a
delegation, re-transcribe the rows) was the whole implementation.

**Grep your own source comments for deferrals, not only `decisions.md` for refusals.**
A note that states its trigger is a note somebody can act on; one that states a
preference is not.

## D437's converse trap, hit through a WHOLE FUNCTION (D445)

Extracting an inline loop into a top-level function re-indents it — and at two spaces
`for (const uid of state.players[seat].hand) {` became byte-identical to
`handCostCandidates`' first loop. The re-transcribed row reported `find occurs 2×`,
**a row broken by a function it does not describe**. The fix is D443's: include the
line the new function uniquely owns (`let held = 0;`, where the sibling counts into
`kept`/`out`).

⚠️ **`precheck` caught both the 0× and the 2× in seconds, on consecutive attempts.**
Run it after every edit round, not once at the end.

## A mirror board is not a seat inversion (D445)

A `board(by)` helper that assigns "the attacker's hand" and "the defender's hand"
gives the SAME numbers from either chair — which is a real claim (the fold is
seat-relative, not hard-wired to p2) and is NOT the claim that reading the wrong seat
is visible. The inversion evidence has to come off ONE board: *on this table, the
attacker's own hand answers 1 and 4 where the defender's answers 5 and 7.*

**Two rungs, two claims.** A suite with only the mirror passes on a build that reads
`attackerSeat` on a symmetric fixture.

## A brief's printing count is a FLOOR (D445)

D445's work order named four sentences / seven printings, measured with the canonical
subtraction and correct as far as it went. The buildable family was **three sentences
/ six printings** — two of the four were refused, and a FIFTH sentence the brief's own
family pattern could not see (*"This attack does 30 damage for each card in your
opponent's hand."*, no reveal, corpus row 564) joined it and turned out to be the
control the whole information argument rests on.

**A family enumerated by one literal is as narrow as that literal** (D310 at a
catalog, D419 at an instrument, here at a work order). Re-sweep with the MECHANISM's
vocabulary — *hand* × *does N damage* — not with the sentence's opening words.

### A monotone prediction arrived at by CHECKING is not the same object (D445)

D444 established: prefer the non-monotone sweep prediction, because it tests
comprehension rather than addition. D445's was monotone — `+14 killed, +0
declared` — and the honest version of that claim required saying *why*.

The builder enumerated every pre-existing row that could plausibly have changed
class (a re-transcribed row whose killer set had been widened, a tripwire the
slice had to check, both rows of a neighbouring decision, a shared-walk row, and
five more) and read each one, establishing that **no non-monotone prediction was
available**. That is different from noticing nothing obvious had moved.

**So when the prediction comes out monotone, say which rows you checked to
establish that.** Otherwise "monotone" is indistinguishable from "did not look",
and the two produce the same number right up until the sweep disagrees.

## An amortization argument is a claim about MARGINAL sites (D446)

D439 refused a `CardFilter` widening *for its consumers* — "the cost is measured in
files, not in the member" — and D446's work order reopened it on the ground that
**the consumer cost is largely FIXED, so paying it once for two members changes the
arithmetic.** That premise did not survive.

Measured at D446's head, **8 of the first member's 9 marginal SITE KINDS recurred
for the second**: its own union member and doc block, its own `matchesFilter` arm,
its own `retrieveNoun` arm, its own `BENCHABLE_RETRIEVAL_KINDS` entry, its own
anchor, its own reader arm, its own deck slots and its own board with its own rungs.
The one kind that did NOT recur is a new FIXTURE. ⚠️ **And the second member cost
MORE than the first, not less** — it alone forced a rename of a shipped
`DamageCountSource` member plus a required field (16 executable sites, 5 mutant rows
re-transcribed), which the first needed none of. What is genuinely shared is the
**FILE set** (three), the audit, and the single census step. **The cost is linear in ARMS and fixed only in
FILES**, so a "pay it once" argument is only true of whatever the union's consumers
happen to do per-file rather than per-member.

Both members were built anyway, because each pays on its own — which is the point:
**the arithmetic that justified the slice was not the arithmetic the brief named,
and saying so is worth more than the slice.** D424's rule (*cheapness is marginal
sites, not mechanisms*) is the same test; this is its converse — **when a brief
argues that a cost AMORTIZES, count the marginal sites of the SECOND item, not the
files of the first.**

## Enumerate a union's consumers by what they DO, not by what breaks (D446)

D439 and D440 both name *"the two other consumers of that union"* (`retrieveNoun`
and `BENCHABLE_RETRIEVAL_KINDS`). Re-derived at D446, `CardFilter` has **four**
non-test consumers plus the predicate itself, and the two nobody counts are the safe
ones:

| consumer | shape | omission is |
|---|---|---|
| `cards.ts matchesFilter` | exhaustive `switch`, declared return type | a TYPE ERROR |
| `interpreter.ts retrieveNoun` | exhaustive `switch`, declared return type | a TYPE ERROR |
| `effects.ts BENCHABLE_RETRIEVAL_KINDS` | a `Set<CardFilter["kind"]>` | **SILENT** |
| `interpreter.ts energyNoun` | if-chain with a `return "Energy"` fall-through | silent and CORRECT |
| `interpreter.ts matchesAttached` | one member by name, then delegates | nothing |

**A list of "the consumers" that only names the ones that break is a list of
hazards, not a census** — and a successor pricing a widening off it will
under-count the surface and over-count the risk. Derive it by grepping every read
of the discriminant (`grep -n "filter\.kind\|Filter\[.kind.\]"`), then classify
each hit by what an omission DOES.

## A silent consumer can be unreachable, and that is a THIRD answer (D446)

`BENCHABLE_RETRIEVAL_KINDS` is the `Set` D439 refused a widening over, and its
hazard is real in general. For D446's two members it is **unreachable in both
directions**: the Set has ONE call site, whose `filter` can only come from
`HAND_SEARCH_NOUNS` / `typedNounFilter` / a bare `byName`, and none of those can
produce either new member. Omitting them refuses nothing; admitting them benches
nothing.

So the answer to *"what breaks if the Set is wrong"* was **neither direction is
observable today** — which is not "it does not matter". The lines are still owed
(the day `HAND_SEARCH_NOUNS` gains a row for either noun, the Set is what decides),
and the decision is recorded **at the site** with its unobservability stated.
⚠️ **AND NO MUTANT ROW IS WRITTEN FOR IT** — D420's rule (*a row that survives
because it changes nothing reports a suite gap that does not exist*) plus D442's
(*write the row for the observable direction and record the other at the guard*).
Here there is no observable direction, so the record is the comment.

## A caption arm can be owed and unrenderable (D446)

`retrieveNoun`'s exhaustive switch means a new `CardFilter` member owes a
singular/plural noun phrase, and the natural question is whether a wrong one is a
test failure or invisible. **Measured: invisible.** Every caller reads an
`op.filter`; D446's two members are produced only into a parse-time
`DamageCountSource` and never into an op, so no board can render either phrase.
`abilityPokemon` has been in exactly that state since D285 and says so.

The arms are still owed, for two reasons worth separating: the switch is exhaustive
(so the member cannot be added without answering the question), and a **registry
author can hand-write the filter into an op tomorrow**. What can be driven is the
property that makes them unreachable — a sweep of every op the derived attack column
produces, asserting neither member appears — and that is what the suite pins instead
of a caption nothing emits.

## A predicted SHAPE is not the measurement that predicted it (D446)

D428's rule is *a refusal's falsifier should be executable*, and D439 wrote a good
one: a census rung that reddens *"the day a `CardFilter` member reads
`pokemonSuffixOf`"*. D446 was that day and the rung fired exactly as designed.

**But the same sentence also predicted the SHAPE of the fix** — *"this member gains
an `opponentPokemonInPlay` sibling"* — and that half was wrong, because D440
re-derived the union's rule **one slice after the prediction was written** and found
the seat-in-the-name convention was a habit: *nullary or asymmetric payload ⇒ two
members; identical payload ⇒ one member with the discriminator as a field.*

**A falsifier should name the CONDITION that reverses the refusal, not the build
that will follow it.** The condition is checkable and ages well; the build is a
forecast (D427) and ages like one. When you fire an inherited falsifier, re-derive
the shape from today's rules rather than implementing the prediction.

## A guard can graduate from prospective to live, and its witness must move (D446)

D439's `(?!opponent)` lookahead was defended with *"today the vocabulary would refuse
that noun anyway; the lookahead is what stops the refusal turning into a WRONG CARD
the day an ex/V filter member lands."* Correct, and its witness was
`"…for each of your opponent's Pokémon in play." → null`.

D446 landed that member **and added the opponent-side anchor**, which claims that
very string — correctly. Re-pointing the witness to `.not.toBeNull()` would have
produced an assertion that is **true under the lookahead-free build as well**
(D418's disarmed tripwire, D438's polarity rule). The repair is D444's: find the
subject that still HAS the old property. Here it is the **doubled owner** —
*"your opponent's Team Rocket's Pokémon"* — which the attacker's anchor would
resolve to `ownerPokemon { owner: "opponent's Team Rocket" }` and the foe anchor
resolves to the opponent's `Team Rocket` subgroup. Two builds, two answers, one axis.

## A CAPTURE is safe when the datum is a COLUMN (D446)

D440 refused `^(.+) card$` → `byName` because it would claim *"Ancient card"* — a
banner in **no** column of the persisted catalog — so the filter would count 0 on
every board forever while `BUILT.attack` stepped for it (D190b/D199 at the
instrument layer). That refusal reads as *"prefer a closed map to a capture"*, and
it is narrower than that.

D446 captures a printed **attack name** and the capture is safe, for one reason: an
attack name is `attacks_json[].name`, a persisted column this engine already reads
at every declaration. **Any printed attack noun is answerable by construction, and a
name that matches nothing is a genuine zero rather than a data gap.**

**Classify the DATUM before choosing between a map and a capture.** The question is
not "how open is the token set" but "does a column answer it" — and the two
questions give different answers on the same-looking pattern.

## Re-transcribe by SHORTENING onto the line the row is about (D446)

Five shipped mutant rows broke when D446 renamed a union member and gave an arm a
new local. Four of them quoted six-line blocks that included the very `return`
statement the rename touched.

The repair that keeps D416's guarantee — *confine the mutation so the original
killer keeps the kill* — is to **shorten the `find` onto the line the row is
actually about** and leave the rest of the block out of it. `D439-*-arm-drops-the-
filter` is about the vocabulary lookup, not about the `return`; re-anchored on the
lookup it survives every future edit to the arm's tail, and its mutation is
byte-identical in meaning. ⚠️ **A row whose `find` is longer than its claim rots on
every neighbouring edit** — length is not strictness, it is surface area.

## Name a new local so it is not its neighbour's twin (D446)

D446's evaluator arm needed `const <x>Seat = bonus.count.seat === "you" ? attackerSeat
: defenderSeat;` — a line the sibling arm four `case`s down already owns verbatim as
`pileSeat`. Naming it `bodySeat` (and saying at the site why) is what keeps
`D440-evaluator-crosses-the-seat` at `1×`. This is D442's rule applied *before*
`precheck` reports the `2×` rather than after — the cheaper order, and the comment is
what stops the next author "tidying" the two into one helper.

### A docs file can be a mutation target, so a late edit can void a sweep (D446)

`docs/progress.md` is the target of eight `D318-*` rows that guard the
end-of-session ritual. A prose correction landed in it **after** a whole-corpus
sweep had launched, which under D215's dirty-file refusal would have made all
eight report `SKIPPED-DIRTY` — and **skips take the exit code with them**, so the
run would have printed a plausible table and meant nothing.

**The repair is to commit that path alone, early**, while the sweep is far from
the rows in question. Check how far along it is first: the row order is by id, so
you can see whether the guarded rows have already run.

⚠️ **And classify every dirty path before staging any of them.** At that moment a
second file was also dirty — and it was a **mutant in flight**, which re-reading
its diff seconds later confirmed by coming back empty. **During a sweep,
`git status` reports the harness as often as it reports you.** Staging a file the
harness owns is how a mutant gets committed as source.

## A marker that co-occurs with a family is not its blocker (D447)

🛑 **A surface token shared by every member of a refused family looks like the
gate and usually is not. The test is one line: STRIP THE TOKEN AND RE-ASK THE
READERS.** D446's resume point named the trailing *"(Don't apply Weakness and
Resistance for Benched Pokémon.)"* as *"the whole family's gatekeeper"* and said
it *"should be priced once"*. Priced:

- it sits on **19 residue sentences / 26 printings** — the largest trailing
  marker in the residue, which is what made the claim plausible;
- **stripping it and re-asking `resolvedByAnyReader` unlocks 0 / 0.** Every one
  of the 19 bodies is refused on its own merits;
- adding a *mirror* trailing splitter on top of the strip unlocks **1 sentence /
  2 printings** across the whole residue, which does not pay for a splitter.

⚠️ **AND THE DECISIVE MEASUREMENT NEEDED NO EXPERIMENT AT ALL. Count the marker
on BOTH sides of the predicate before you count it on one.** That parenthetical
is on **43 corpus sentences / 88 printings**, and **24 sentences / 62 printings
of them already RESOLVE** — every shipped anchor in the family spells it as an
optional trailing group. A token that appears on the built side in the majority
of its printings cannot be what refuses the rest. The reminder appears on 26
residue printings *because* bench damage is unbuilt, not the other way round.

⚠️ The corollary bites REFUSAL PROSE too, and it did here: D446 §5 explained a
refusal as *"the sentence ENDS IN `)` against an `^…$` anchor"*, which is false
for every anchor in that family. **A refusal reason is a claim; a co-occurring
token is the easiest wrong one to write down**, because it is visible in the
sentence and the true reason usually is not.

## Sibling anchors drift apart in the direction of MORE specificity (D447)

⚠️ **When two anchors read the same shape on two seats or two zones, the
generalisations one of them gains do NOT propagate — and the gap shows up as
printings nobody has priced.** `SPREAD_EACH_BENCH` has spelled `(?:also )?` since
it was written and took a possessive CAPTURE at D425. Its snipe sibling
`ALSO_BENCHED_SNIPE_BODY`, twenty lines away in the same file and sharing the same
printed noun, demanded the literal word `also` and the literal owner *"your
opponent's"* until D447. Cost of the gap: **3 sentences / 3 printings** refused
for two tokens, one of them (row 587, the only bare benched snipe in the column)
refused **by a single word**.

**So: when you generalise an anchor, list its siblings over the same noun and say
for each whether the generalisation applies.** A "no" is a finding worth a line;
silence is how a one-word refusal survives twenty slices. The doc block over the
snipe fragment had even ARGUED that "also" was not load-bearing — *"the
LOAD-BEARING separator from Covetous Ivy is the whole-sentence `\.$`, not the word
also"* — and the word stayed in the regex anyway. **A comment saying a token is
not load-bearing is a candidate for deletion, not a justification for keeping it.**

## A group index shifts when the capture must sit where the print puts it (D447)

⚠️ D437 widened a shared regex fragment and kept every caller's indices stable by
**appending** its new group after the existing ones. That trick is available only
for a group at the END of the pattern. A POSSESSIVE capture sits where the
possessive is printed — before the narrowing — so D447's widening shifted
`damagedOnly` from `[3]` to `[4]` at all three callers and in two mutant rows.

**Neither the compiler nor a type sees a `match[3]`, so an index shift is a silent
defect at every caller you forget.** What caught it here was: (1) each caller
re-read and re-indexed by hand as part of the edit, and (2) `precheck`, which
reported both mutant rows as `0×` immediately. **After changing a shared regex's
group count, grep the fragment's name and re-index every caller in the same edit
— and expect the mutation corpus to name the ones you missed.**

## A total `switch` is the only thing that sees a new union member (D447)

🛑 `snipeTargets` chose its candidate scope with `op.target === "opponentAny" ? … :
…`. Adding a THIRD member to `damageChosen.target` compiled cleanly and fell out
of the `else`, aiming the own-side snipe across the table. **`tsc` reported
nothing, and no test existed yet to fail.** D222's rule and D425's line in
`spreadDamage` — *"a `switch` rather than a negated test, so a third member stops
compiling here instead of falling silently out of the wrong side of a `!==`"* —
were both already written down, one file apart, and this site had neither.

⚠️ **The second half is worse and is the part to generalise: a funnel BELOW the
switch can be written in terms of the old members' shared property.** `placeSnipe`
filtered its bench refs on `ref.seat === opponent` — true of both pre-existing
members and of neither new one — so the widened op would have parked a real
prompt, taken a real answer and **dealt nothing**. **When you widen a union, walk
every function the widened value flows INTO and ask what each one assumed about
the members that existed before**, not just the ones that dispatch on it.

## Adding a fixture makes an existing mutant row occur twice (D447)

⚠️ D437's converse trap has a third face: it fires when you REMOVE a comment.
`placeSnipe`'s `DAMAGE_DEALT` literal carried a distinguishing comment line above
`by: ctx.seat`; rewriting that comment made the literal BYTE-IDENTICAL to
`spreadDamage`'s from `by:` down, and `D425-damage-row-names-the-victim-as-the-dealer`
— whose `find` is exactly that run of lines — started occurring **2×**.

**The repair is a trailing comment that says why it is there**, so the next editor
does not "tidy" the two sites back into twins. `precheck` is what found it, in
seconds, and it is the reason to run `precheck` after every edit to a file the
corpus targets rather than only before the sweep.

### The region-overlap audit and `precheck` answer different questions (D447)

The mechanical audit — for every file you will edit, find every mutant row whose
`find` lies in a region you change — has been the strongest pre-build instrument
in this run (51 in-region rows at D443, 19 at D444, 15 at D446). **It has a
structural blind spot**, and D447 hit it: a row broke in a region the slice did
**not** touch, because an edit elsewhere made one event literal a **byte-twin** of
another, so the row's `find` began occurring twice.

The audit examined 1,055 rows, flagged 27, and this was not among them —
correctly, because by its own question it was not near the edit.

- **The region audit answers**: *did I edit near this row?*
- **`precheck` answers**: *does this row's `find` still occur exactly once?*

**The second question is the one the corpus actually rests on, and the first is
not a substitute for it.** Run the audit to know what you are about to disturb
and to plan repairs; run `precheck` to know whether the corpus is runnable. It
costs seconds and it is the only one that catches a collision you created at a
distance.

## The parallel fold may already exist — ask the CONSUMER, not the type (D448)

🛑 **A work order that says "today only X can do this" is a claim about a CONSUMER, and
the type is the wrong place to check it.** D448's brief said a `DamageCountSource`
"folds into the attack's own damage in `attack.ts`'s §8.5 pipeline" and that a snipe's
amount cannot carry a count today, so the slice would be either *"a fold reaching a new
consumer"* or *"a second, parallel fold"* — and priced the second as much bigger.

**Both were wrong, and one grep settled it.** `snipeAmount` (interpreter.ts) has
multiplied `damageChosen.amount` by a board fact since Wo-Chien "Covetous Ivy", at both
call sites — the inline run and the resumed pick. The second parallel fold was already
there; the slice gave it a second inhabitant and cost one optional field and four lines.

⚠️ **THE REASON THE DOCS POINTED THE WRONG WAY IS WORTH KNOWING**: the shipped rider is
a BOOLEAN (`perTakenPrize?: true`), so it does not mention `DamageCountSource` anywhere
and no grep for the union's name reaches it. **Grep the VERB, not the vocabulary** —
`grep -n "op.amount \*"` finds a fold whatever it is spelled in.

⚠️ **AND THE TWO FOLDS GENUINELY CANNOT BE MERGED HERE**, which is a cost worth
recording rather than a preference: `scaledAttackDamage` lives in `attack.ts`, which
imports `interpreter.ts` (so the reverse import is a cycle), and its signature takes the
attack's printed `cost` for `extraEnergyUnitsBeyondCost`, which `EffectContext` does not
carry. A "just reuse the evaluator" note would have been a recipe that ships a defect —
D420's rule, one module over.

## A boolean rider is a union member with the discriminator erased (D448)

**When a second boolean rider answers the same question as the first, say so, price the
collapse, and name the trigger** — but then **check that the trigger's row is not
blocked upstream of the thing you are pricing.**

D448 added `perEnergyOnSelf?: true` beside `perTakenPrize?: true` rather than replacing
both with `scale?: DamageCountSource`. The collapse was measured at **24 sites across 10
files** plus a `MATCH_RECORD_VERSION` bump — the rider is persisted, so dropping its name
is D359's RENAME, not D125's widening — which is D362/D369's arithmetic exactly.

🛑 **THE FIRST DRAFT OF THE TRIGGER WAS WRONG AND IS THE POINT OF THIS ENTRY.** It named
a printed row whose count needs a PAYLOAD (a filtered discard-pile count, 3 printings) as
the case that would force the collapse. Then its CONTROL was checked — the *unscaled*
twin one corpus line below it — and that is unbuilt too: **no anchor claims the verb at
all**, so the payload is not the blocker and collecting the row is a different slice.
**A refusal's reason must be the FIRST one in the chain, and the way to find it is to
strip the thing you are pricing and re-ask** (D399's one-axis rule, applied to a price).

## A family grep over a VERB misses the family's biggest member (D448)

⚠️ D310's census rule — *a census is as narrow as BOTH the columns its query names and the
literal it matches* — bites a FAMILY the same way. D448 enumerated "a chosen-target hit
whose amount scales" as *every sentence carrying `for each` and `damage to `*: ten rows,
and it wrote *"what this pattern cannot see"* beside them **from memory**. Re-running the
shortened query found an eleventh — *"**Put 2 damage counters on** 1 of your opponent's
Pokémon for each Basic {G} Energy card in your discard pile…"*, **3 printings**, the
LARGEST single count in the class — because the same mechanism is printed with a
different verb.

**So: write the "cannot see" sentence as a QUERY YOU RAN, never as a list you thought
of.** Two of the three negatives in that comment were true; the one that was not was
about the family's biggest row.
🆕 **D538 BUILT THAT ROW**, so the example is now a HISTORY rather than a live residue
quote — corrected in place rather than deleted, because the lesson is about the QUERY and
not about the row's status. Arm 23b-bis claims it whole as `damageChosen
{ perDiscardPileCard }` + `discardPileRetrieval { max: "all" }` + `shuffleDeck`, and the
sentence that D448's shortened query found is exactly the one that closed the placement
family (19 sentences / 38 printings, all read). The rule stands unchanged: the row was
found by RE-RUNNING a narrower literal, and it was the largest in its class. (The case-sensitivity half is the same lesson at one
character: `t.includes("for each")` reports NINE where `/for each/i` reports TEN, because
one member opens the sentence with *"For each…"*.)

## A one-print fixture makes a filter unfalsifiable (D448)

🛑 **When the thing under test is "count X regardless of Y", the board must contain a Y
that differs — otherwise the narrowed and un-narrowed answers are the same number and
the mutant survives against a suite that looks thorough.** D448's fold counts Energy
CARDS with no type filter; the neighbouring reader (`SELF_ENERGY_MULTIPLY`, one file
over, same printed noun) counts them WITH one, so passing a type is the nearest wrong
edit there is. On an all-{L} deck it is invisible. One Colorless card on the attacker is
the whole difference between a green mutant table and a meaningless one — and the row
that needs it says so in its own `what`, so the fixture cannot be "simplified" later.

## A NEW local can be a DISTANT neighbour's byte-twin (D448)

⚠️ D437's converse trap and D447's blind spot have a third face, and it fires on code you
are **writing** rather than editing. D448 wrote `const attacker = activeTop(state,
ctx.seat);` into a new nine-line function; that is `snipeActive`'s line **verbatim**,
three hundred lines up in the same file, and the mutant row authored against it reported
`find occurs 2×` immediately.

- The region-overlap audit cannot see it: the twin is nowhere near the edit.
- `precheck` sees it in seconds, which is the whole argument for running it **after
  writing new code**, not only after editing quoted code.
- **The repair is the NAME, not a wider anchor** (D446): the local became `thisPokemon`,
  which is what the sentence prints, and a comment says why so the two are not tidied
  back into twins. A wider anchor would have left the collision in the source for the
  next author to re-create.

## A corpus row number is a FILE LINE, and one handoff used array indices (D448)

⚠️ `censusAtHead.test.ts`, `decisions.md` and every slice note cite *"corpus row N"*
meaning **line N of `censusAttackCorpus.ts`**. D447's resume point §5 cited the same
sentences by their **1-based index into the parsed 640-entry array**, which is
`fileLine - 52` at that head — and mixed the two conventions **inside one section**
(*"(535/row 587)"*). D448's work order inherited the array numbers and they resolved to
entirely different sentences.

**Cite the line number, and cross-check the PRINTING COUNT before acting on a cited
row** — the count is what tells the two conventions apart in one look. This is D432's
*"line numbers in a brief are claims"* arriving at a data file instead of a source file.

### `--decision` matches by SUBSTRING, so D443's row-count check is wrong (D448)

⚠️ D443 wrote the probe discipline as *"check the row count against
`MUTANTS.filter(m => m.decision === d).length` read off the module"*, and five slices
have followed it. **The runner does not use equality.** `scripts/mutation/run.ts` filters
with `m.decision.includes(decision)`, so:

- a row whose `decision` is a COMPOUND like `"D204/D205"` is run by `--decision D205`
  **and** by `--decision D204`, while the equality count sees neither. D448 hit exactly
  this: the module says D205 has **2** rows, the runner ran **3**, and by the equality
  check that reads as an unexplained extra row;
- and the match is a plain substring, so **`--decision D44` would run every row from
  D440 to D449 at once** — a probe that looks narrow and is not.

**The correct counter is `MUTANTS.filter(m => m.decision.includes(d)).length`**, and it
differs from the equality count on exactly the compound rows. Report the `includes`
figure; if the two disagree, say so — the disagreement names a compound row and is worth
a line.

### A mutant row can be INERT, and `precheck` cannot see it (D450)

`precheck` answers exactly one question: does each row's `find` occur exactly
once in its target file? It says nothing about whether the `replace` expresses a
**different program**. D450 wrote a row whose `replace` prepended a comment
instead of deleting the field it named — so the harness applied it, compiled
**byte-equivalent behaviour**, and reported `SURVIVED (undeclared)`.

**That is a third distinct blind spot, and the three instruments do not cover
each other:**

- the **region-overlap audit** cannot see a collision you create at a distance
  (D447) — it asks *did I edit near this row?*
- **`precheck`** cannot see an inert row (D450) — it asks *does this `find` occur
  exactly once?*
- only a **probe or the sweep** asks *does this row express a defect the suite
  catches?*

**So read an undeclared survivor as a question about the ROW first, not only
about the suite.** The reflex is to hunt for the missing assertion; check that
the `replace` actually changes behaviour before writing one, because a test
written to kill an inert mutant is a vacuous guard by construction (D205/D208).

### Diff every row's `find` against its `replace` before probing (D451)

D450 discovered that a mutant row can be **inert** — its `replace` compiles
byte-equivalent behaviour, so the harness reports `SURVIVED (undeclared)` for a
row that expresses no defect. D451 re-entered the same trap **one slice later**,
with two of its nineteen rows inert on the first draft (one prepended a comment
instead of changing the field; one returned a value-equal object).

The difference is that D451 caught them **before the probe**, with a mechanical
diff of each row's `find` against its `replace`. That is the missing instrument:

- the **semantic audit** finds rows that mention what you are changing;
- the **mechanical region audit** finds rows whose `find` sits in an edited span;
- **`precheck`** finds rows whose `find` no longer occurs exactly once;
- **a `find`-vs-`replace` diff** finds rows that change nothing at all.

Only the fourth catches an inert row at authoring time, and it costs one pass
over the rows you just wrote. Run it as the last step before probing — an
undeclared survivor found later is the same defect discovered at ten times the
cost, and it invites the wrong repair (writing a test to kill a mutant that
cannot be killed, which is a vacuous guard by construction).

## The consequent may not be a fold at all — ask the SITE what it spends (D452)

🛑 **D448 taught "the parallel fold may already exist — ask the CONSUMER, not the type".
D452 is the next question: ask whether there is a fold.** The work order priced
*"For each heads, ⟨do something⟩"* as *"a count that multiplies an op's amount"* and asked
only whether the fold was D448's or a second one. **Neither.** `programPerHeads` has spent
the heads count into a LONGER PROGRAM since D130 — `heads` copies of the member's ops,
appended at the flip site, run by the existing tail — so nothing multiplies, `op.amount *`
reaches the family nowhere, and **no op ever sees the coin result**. The value that crosses
the gap is program LENGTH.

**So the grep discipline needs a third question.** D448's rule says grep the VERB and the
state mutation, not the vocabulary; that is necessary and it is not sufficient, because a
grep for `op.amount *` returning nothing reads as *"the fold is missing"* when the truth
may be *"there is no fold and never was"*. **Read the SITE that produces the count and ask
what it spends the count INTO** — a number, a program, or a park. Three answers, and only
the first is a fold.

⚠️ **AND REPETITION IS OFTEN THE CORRECT READING RATHER THAN THE CHEAP ONE.** *"For each
heads, discard a random card"* is N INDEPENDENT picks over a hand that SHRINKS between them;
an op carrying a count could only get that right by re-deriving the shrink internally. The
testable difference is DISTINCTNESS: N repeats can never name one card twice, where a
snapshot-then-index build repeats one most of the time.

## A refusal that names a FIRST is a refusal with an expiry date (D452, re-earning D413)

D130 refused a printing because its op *"would be the FIRST EffectOp in the engine to consume
`state.rngState`"*. **D232 built exactly that op** and the refusal stood for 220 decisions
anyway. D413's rule already covers it — *a refusal that says what it is waiting for carries
its own expiry date, so go back and check the trigger* — and this is the shape that makes the
trigger hardest to notice: **an ordinal**. *"The first X"*, *"the only Y"*, *"nothing else
does Z"* are all claims that a later slice can falsify without ever reading the refusal.

⚠️ **`grep -rn "would be the first\|the ONLY\|nothing (else )?in this engine" packages/engine/src`**
and re-read each hit against today's module. An ordinal in a refusal is a countdown.

## "Cannot express" is a claim about the MACHINERY; check the machinery (D452)

🛑 D130 refused two printings because a park is *"the one thing D130's expansion cannot
express"*. **`resumeProgram` ends in `runProgram(applied, rest, …)`**, so an op sitting in
`rest` that parks simply parks again — the expansion puts its copies in `rest` like any
other program, and N sequential parks are a shipped capability. One line of the interpreter
answers it; the refusal had stood since 0.81.0.

**The honest refusal was a COST**, and it is a real one: the printing's fixture is the
suite's FIELDED "stays LOUD" end-to-end witness across five files, so building it re-points
a rung with no other candidate to re-point onto (D418). **Write the cost, never the
impossibility** — a cost invites a successor to pay it, and an impossibility tells them not
to look. This is D451's *"a refusal names TWO things and only one of them may be true"*
arriving at the difference between *can't* and *won't*.

## A byte pin on an invented string is green by construction (D452)

🛑 **A refusal rung pinned `OUT_OF_SCOPE[1].length` at 97 against a sentence NO CARD PRINTS**
— one card's opening glued to another's consequent, documented as *"verbatim off the local
D1"*, and green since D130. The file's own doc blocks name NBSP and U+2019 as escapes because
*"a hand-retyped near-miss is the only way one can enter the codebase"*; the near-miss that
entered was a hand-retyped OPENING, which **no byte pin on the whole string can catch** —
the pin measures the invention as faithfully as it would measure the truth.

**The repair is the SOURCE, not the pin.** Every entry in a refusal set should be asserted to
be a row of the committed corpus (`legalAttackCorpus().some(…)` or a `Map` lookup), and its
PRINTING COUNT asserted off the corpus too — the count is what tells two conventions and two
populations apart in one look (D448). A set that is merely byte-pinned is a set that can
drift onto a sentence nobody prints and take a refusal with it.

## The semantic audit's most valuable output can be an ABSENCE (D452)

The pre-build semantic audit exists to find rows that COLLIDE with what you are changing.
D452's found something else: needling the corpus for `ATTACK_COIN_MILL_PRINTED` and
`ATTACK_COIN_MILL_UNTIL_TAILS` returned **ZERO rows** — a whole shipped slice (two anchors,
two arms, a 1,459-line suite) pinned by nothing since D130. Two rows were written for it and
**one SURVIVED on the first probe**.

⚠️ **So needle the NEIGHBOURS you are copying, not only the lines you edit.** A slice that
copies an arm's guards is a slice that has just read that arm carefully — it is the cheapest
moment there will ever be to notice the arm is untested. And when the audit comes back clean
**on a name you expected to find**, that is a finding (D431), not a pass.

## A "leading text pins `^`" rung must vary ONLY the anchor (D452)

The mutant above survived because every leading-text rung in the file read
*"Before doing damage, **f**lip 3 coins…"*. The lowercase `f` means the string is refused by
the family's case-sensitivity, so the rung is green with the `^` deleted — it pinned the case
and its comment claimed it pinned the anchor.

**When a rung's comment names the mechanism it pins, check that the string varies ONLY that
mechanism.** This is D399's one-axis rule applied to a refusal string rather than to a
near-miss sentence, and it is easy to hit because a capitalised word mid-sentence looks wrong
to write ("Before doing damage, Flip 3 coins.") — which is exactly why the correct probe uses
a prefix that ENDS a sentence.

## A bare integer operand, for the FIFTH slice (D452)

`censusAtHead.test.ts` carries the residue-printings figure twice: once as
`expect(unbuiltAttack).toBe(192)` and once as a bare `242` inside an arithmetic expression a
thousand lines away. D449, D450, D451 and D452 each stepped the first and missed the second,
and each found it by running the suite. **Grep for the OLD VALUE as a bare token, not only
inside `toBe(`** — `grep -n '\b242\b'` costs nothing and closes it.

⚠️ **And budget FIVE `bun run check` rounds for a census step, not three.** D452's rounds
found 12 files, then 11, then 5, then 3, then green — and every round's failures were a
different SPELLING of the same figure (`toHaveLength(N)`, `toBe(N)`, `resolvedP`,
`p(resolved)`, `units - built`, `residueP`, `rawHead`, `head`, a bare operand). **The
spelling is the thing that varies, so a spelling-keyed pass will always be short.**

## A file-local `cardPool` costs the fixture-id ladders nothing (D452)

Worth knowing before pricing a slice whose card ids are unresolvable (D425). D414's idiom —
`createGame({ seed, decks, cardPool: { ...FIXTURE_POOL, ...LOCAL_CARDS } })` with `fix-*` keys
— keeps a demonstrator out of `FIXTURE_POOL` entirely. So `opponentResistanceBonus.test.ts`'s
eleven-deep FIXTURE-ID ladder takes a **0** term, and `counterBenchPut.test.ts`'s shared-pool
`source` sweep stays quiet. The census still steps by the full sentence and printing counts,
because those are keyed on the CORPUS and the READERS, not on the pool.

## `MATCH_RECORD_VERSION`: the strongest argument is "this byte already ships" (D452)

D450 established the question for a NON-PARKING op: reachability — an op reaches storage only
via a continuation's `pendingOp` and its `rest`, written only on a park. **D452 is the case
where reachability is not needed at all**, and it is a better argument: each new arm emits an
op the catalog ALSO prints as a standalone sentence, so `JSON.stringify` of what the new arm
produces is byte-identical to what a v29 deploy already writes. **There is no new byte, so
there is nothing for a version to be about.**

⚠️ **State BOTH halves anyway.** The reachability half was still driven (neither op parks; no
other op shares the program; 80 declarations, zero `effect:choose` phases) and so was the LOSS
direction — a lost `count` is a silent whiff, a lost `to` routes the card to the DECK and
SHUFFLES, which burns an extra `rngState` step and desyncs every later flip. Reachability
alone reads as an excuse (D450); "this byte already ships" alone leaves the loss hazard
unnamed even though it is pre-existing.

### Audit for ABSENCE, not only for collision (D452)

The four pre-probe passes all ask what an edit might **break**: which rows
mention what you are changing, which rows sit in an edited span, which rows'
`find` no longer occurs once, which rows changed nothing. **None asks what was
never covered.**

D452's semantic pass found that `programPerHeads` — a shipped mechanism with its
own 1,459-line suite — had **zero mutant rows for 322 decisions**. Every green
sweep since 0.81.0 had said nothing whatever about it, because a corpus reports
only on the rows it contains, and **a family with no rows is indistinguishable
from a family that passes.** The two rows written for it were the first evidence
it discriminates at all, and one of them **survived its first probe** — so the
family was not merely unpinned, it had a live hole.

**A green sweep is a statement about coverage, not about correctness.** When you
touch a mechanism, grep the corpus for rows naming it *before* assuming the
sweep's history covers it — an empty result is a finding, and it is the cheapest
one available.

### "No row names it" is the WRONG coverage predicate, in both directions (D453)

D452's absence rule needs an instrument, and the obvious one — *grep the corpus
for the op's name* — is wrong twice over. D453 ran it over all **74**
`EffectOp` kinds and then ran a better one beside it.

**FALSE NEGATIVES.** `counterUntilRemainingHp` is pinned by **thirteen** D451
rows — four on its `effects.ts` arms, nine inside its interpreter function — and
**not one spells the op's name** in `id`, `what`, `find` or `replace`. A good row
quotes the FIELD it crosses (`remainingHp`, `target`, `source`) or the LINE it
deletes. **The name is metadata; the SPAN is the fact.**

**FALSE POSITIVES, which are the dangerous half.** Five kinds "have rows" under
substring and every hit is PROSE in some *other* row's `what`, or a `replace`
that emits the op as a NEIGHBOUR's wrong answer
(`D432-arm-emits-the-neighbours-op` hands `installNoWeakness`'s arm a
`reduceDamage`). **A measure that reports coverage which is not there is worse
than one that misses coverage which is** — the first stops you looking.

**THE PREDICATE TO USE INSTEAD, and it is cheap enough for the standing set.**
For each kind, build the regions that IMPLEMENT or PRODUCE it — the same-named
top-level function in `interpreter.ts`, every `case "<kind>":` block, every
helper typed `Extract<EffectOp, { op: "<kind>" }>`, every `op: "<kind>"` producer
statement in `effects.ts`/`registry.ts` — then ask whether any row's `find`
**span** intersects one. ⚠️ **STATE ITS LIMIT (D425):** it cannot see a row that
changes an op's behaviour from outside those regions (a shared helper —
`effectRefused`, `parkOrForce`, `withActive` — or the dispatcher's shape), and it
says nothing about whether an in-range row expresses a defect worth catching. It
is a tripwire, not a proof.

## Coverage is a CHAIN, and the predictor is FIELD COUNT (D453)

Why eleven shipped ops had never been touched by a row is not eleven accidents.
Tagging every op-region hit as PRODUCER-side (`effects.ts`/`registry.ts`) or
IMPLEMENTATION-side (`interpreter.ts`) over the pre-D453 corpus:

> **758 producer-side · 358 implementation-side · 24 kinds producer-ONLY ·
> ZERO kinds implementation-ONLY · 11 with neither.**

**No op has ever gained an implementation row without already having a producer
row.** The mechanism is the authoring habit: **a mutant row is written by the
slice that BUILDS a sentence, and that slice's row is a row about the ARM it just
wrote.** An implementation is reached only when a later slice returns to it for
some other reason.

⚠️ **So the predictor of coverage is the op's FIELD COUNT, not its importance or
its printings.** Mean declared keys beyond `op`: **1.00** over the unpinned,
**1.60** over the thin (1–2 rows), **3.00** over the well-covered.
`reduceDamage` has **29 legal printings** — more than most of the covered set —
and one field. A derivation-arm row is a row about a FIELD, so a one-field op
offers the habitual shape exactly one target and a **field-free op offers none**,
however much behaviour its implementation carries.

**This predicts rather than explains**: the field-poor members of the thin set
are the next gap, and you can name them before looking.

## An undeclared survivor has a FOURTH cause: your own `expectKilledBy` (D453)

D450 named three — a real suite hole, a genuinely equivalent mutant, an inert row
whose `replace` compiles the same program. D453 hit a fourth: **the defect IS
caught, by a suite the row does not name.** `D453-may-draw-is-answered-by-the-controller`
survived `optionalDraw.test.ts` + `aquaWash.test.ts`, was **KILLED by `--full` in
121s**, and the real killer was `revealBottom.test.ts` alone.

⚠️ **RUN `--full` ON ANY UNDECLARED SURVIVOR BEFORE YOU BELIEVE IT.** Two minutes
buys the difference between *"the suite has a hole"* and *"I named the wrong
suites"*, and the wrong answer leads you to write a test for a defect that is
already caught — a vacuous guard by construction (D205/D208). Over-narrowing
`expectKilledBy` is already called a lie in this file; this is what the lie looks
like from the reader's side.

⚠️ **And the specific trap: name the suite the op's CARD lives in, not the suite
its KIND suggests.** `opponentMayDraw` is a "may draw" op, so `optionalDraw.test.ts`
reads right and never loads the line. The op ships on exactly one card, and that
card's suite is the killer. **For a registry-only op, `expectKilledBy` is a
question about the card.**

## A doc block that says "recorded as a mutant" names a FILE (D453)

D216 wrote into `interpreter.ts` that a `=== 1` / `<= 1` comparison was
*"recorded as an equivalent mutant rather than passed off as a tested
comparison"*, and `counterSourceAnswered`'s block said the same of its spot test.
**The corpus contained zero rows for that op, and had for 237 decisions.**

This is D449's rule with a sharper edge: a refusal carries a population, and a
claim of the form *"recorded as X"* carries a **file you can grep**. It is the
cheapest false claim there is to check and one of the easiest to write. **When you
write "recorded as", write the row in the same edit** — and when you read one,
grep it.

## An arm can be LIVE and claim nothing (D453)

`deriveAttackEffect`'s `COUNTER_PUT_ON_DEFENDER` arm matches **zero**
`legal_standard = 1` sentences today; the loosest grep returns five rows and all
five belong to other families. So `damageActive`'s entire live population is one
registry row, and a mutant on the ARM would measure an empty set while a mutant
on the interpreter seat line measures the whole thing.

**Measure an op's printings before choosing which SEAT to pin** — producer or
implementation. It is a different question from "is the op reachable", and the
answers can point opposite ways.

## "1–2 rows" is not shallow, it is ONE-SIDED (D453)

Eight rows across seven thinly-covered ops were read in full and **every one
expresses a real defect** — a printed field crossed, a neighbouring op emitted
verbatim, an amount pinned to one printing, the counters→HP conversion dropped.
None was an anchor-shape row. But **seven of the eight sit in `effects.ts`
derivation arms**, which is the producer-ONLY shape above.
`scheduleDiscard`'s single row proves the reader emits `scheduleDiscard` and not
`scheduleKnockOut`; it proves nothing about what the op then does.

**Count a family's rows by SEAT, not by total.** A thin count is a question about
which half is missing, not about quality.

### Publish the instrument, not only the number (D454)

D453 measured `758 producer-side / 358 implementation-side / zero kinds
implementation-only` and drew a structural conclusion from it. **Its audit script
was never committed**, so the numbers could not be re-run — and when D454 rebuilt
the measurement, `zero` turned out to be an artefact of an asymmetric predicate
(wide producer regions, implementation regions stopping at the `case` arm). A
predicate built to match D453's totals reproduces them to ~2% and still returns
five implementation-only kinds; the call-graph predicate returns six.

**A measurement whose script is not in the tree is a claim, not a measurement.**
When a slice's finding is a number about the repo, commit the script that
produced it — or state the query inline in a form the next slice can paste. This
run has now had one unfalsifiable claim survive four days (D453's tally) and one
survive 237 decisions (a doc block asserting a mutant row in a file that did not
contain it).

⚠️ **And a green sweep cannot audit its own corpus.** D453's and D454's sweeps
were both green and both predictions landed, while the question of whether the
rows were the *right* rows was settled only by re-derivation. A sweep answers
*do these rows still discriminate*; it is silent on *is this the set that should
exist*.

### A refusal that names a SENTENCE is usually a claim about a CARRIER (D457/D458)

The deck-search family mis-priced its own blocker **twice in two slices**, and
both notes were written by the slice that refused the row:

- D457's said a rule was *"unrepresentable here, representable one op over"* — true
  of the neighbouring op's field, false of the op that would serve it, because
  that one answers with a map and the printed rule is a constraint on the map.
- D458's said a row needed *"its own arm by D232's rule"* — and D232's rule, opened
  rather than cited, says the opposite: a family collapses to **one** arm when its
  sentences differ in a NOUN and splits on a VERB.

Both were phrased as facts about **what the sentence needs** and were claims about
**what one carrier happens to hold today** — an op's fields, an anchor's shape, a
rule's summary. One had stood 222 decisions.

**The cheap disproof is one line: delete one axis from the printed string and
re-ask the readers.** D458 ran it and found the remainder had derived since D235,
which located the blocker exactly and cost nothing.

So when you meet a shipped refusal: re-read it as naming a **carrier**, identify
which carrier would actually serve the sentence, and re-measure the population
against *that* one rather than the one that refused it.

### The sweep measures the corpus; a classifier measures the work left (D459)

A whole-corpus sweep costs ~2.3 hours and answers *do these rows still
discriminate*. It cannot answer *which row should I build next*, and every
targeting failure in this run went undetected by twenty consecutive green
sweeps: three slices cited corpus rows by array index against a convention
written to forbid it; one family mis-priced its own blocker twice; a
handed-forward list was wrong three slices running.

**So when targeting is the weak step, build an instrument for targeting.**
`scripts/residue-census.ts` classifies every residue sentence by the single
deletion or substitution that reaches a built string, and its first run produced
the number none of the prose had: **`OPAQUE` is 68% of the residue**, so the
cheap drawer is nearly empty.

Two requirements make such an instrument trustworthy, both learned the hard way:

- **Print the VALUE, not only the verdict.** Ten rows were one-token deletions
  and nine lost the token's meaning in the derived value — a spelling blocker
  against nine semantic ones. A count cannot separate those; the value can.
- **A class is a LOWER BOUND on the work, never an estimate.** The instrument's
  own blind spot fires on the record's rows: one "cheap substitution" was priced
  at three mechanisms by an earlier slice, and two rows' readable half is a rider
  while the head is unbuilt. Say *which half* survived.

### A patch script must assert its own file's SIZE after writing (D462)

D459 added `try/finally` to throwaway scripts that patch a source file, after one
crashed before its restore line and a later script adopted the mutated file as
its baseline. D462 found the other half: a `String.replace(find, replacementString)`
where the pattern ended `\.$` before a backtick. **`$` is special in a
replacement string** — `` $` `` inserts everything *before* the match — so the
call spliced **19,000 lines of `effects.ts` into itself**.

Nothing in the standing apparatus sees this. The whole-corpus sweep cannot;
`precheck` cannot (the `find` still occurs once); none of the four pre-probe
passes can. It was caught by a **line count** — 25,970 → 45,031 — and undone from
the HEAD blob.

So a script that writes a source file must, before it exits:

- use a **function** replacement (`(m) => …`), which never interprets `$`; and
- **assert the file's size or line count** against what it expected to change.

Every instrument in this repo reads these files assuming they are source. A
corrupted one is not a failed edit — it is a false baseline for everything that
runs next.

### `OPAQUE` means UNCLASSIFIED, never EXPENSIVE (D463)

`scripts/residue-census.ts` classes a sentence `OPAQUE` when no deletion or
substitution *it can make* reaches a built string. That is a statement about the
**instrument's reach**, not about the work.

D463's second printing proved it: the row sat in `OPAQUE` because the
substitution that would reach a built string is seven tokens and lands on a
different flip count — and it cost **one regex and one arm**, the same as its
`SUBST-7` twin. It was findable only because the twin was classified.

So when a slice takes a classified row, **check whether the same consequent is
printed elsewhere in `OPAQUE`**. The class tells you where the instrument
stopped; the corpus tells you what the sentence needs.

### An unpinned line accumulates prose (D463)

D130's expansion loop and D43's anchor had **zero mutant rows for their whole
lives**, and both had acquired doc claims that were false: one said the
expression produced *"a different ending"* — measured, it produces none, and the
mutation runs the entire engine suite green.

**Prose about a line is not evidence about the line.** A line no row quotes can
carry any claim indefinitely, because nothing ever contradicts it — the same
mechanism by which an unmeasured figure accumulates citations. When you touch
such a line, expect its comment to be wrong, and settle equivalence by *applying
the mutation and running the suite*, never by argument: a declared survivor
asserted from reasoning is a claim, and one asserted from a green full-suite run
is a measurement a successor can re-check.

## A doc block that names the BYTE doing a refusal is one regex from being checked (D464)

D462 left a printed row LOUD and wrote why, at the anchor it had just shipped: *"It is refused by
the SECOND capture group and by nothing else: drop `(${STATUS_WORDS})` to `(.+)` and this anchor
eats a sentence whose Energy discard it would silently throw away."* **Two thirds of that is false,
and one regex each disproves it.** Measured over the whole 640-row column, `DEFENDER_STATUS_TRIPLE`
claims exactly ONE row / 2 printings under EVERY single-axis loosening it has — slot 1, 2 or 3
widened to `(.+)`, the `^` dropped, the `\.$` dropped — and the row in question is in NONE of them.
It cannot be: the anchor demands a SECOND comma that sentence never prints, and its `^Your opponent`
prefix refuses the leading flip clause besides. Its sibling `FLIP_DEFENDER_STATUS_PAIR` is wrong the
same way (loosened, it gains a DIFFERENT row). The anchor that really refused it was a third one the
paragraph did not name — `FLIP_DEFENDER_NOW`, by its `\.$`, which drifts from **2 rows / 29
printings** to **6 / 35**.

**The failure is a FOLD.** Three anchors refuse one sentence for three different reasons, and the
author wrote the reason of the anchor under the cursor as if it were the family's. That is D463's
*"a refusal that groups N rows under ONE reason is N refusals"* with the quantifier on the other
side: **one row refused by N anchors is N claims, and only one of them may be true.**

Two rules:

1. **Run the loosening you are about to claim, over the POPULATION, before writing the sentence.**
   It is five lines of script and it answers exactly.
2. **Keep the result as a RUNG, not as prose.** A near-miss doc block ages into a `toBeNull` whose
   title says why, and the title is the part nothing checks. The executable form is a rung that
   pins both cardinalities of the strict anchor and both of the drifted one.

## A `LEFT_LOUD` list is a targeting instrument in disguise (D464)

D424 pointed its loud-control slot at *"…is now Burned, Confused, and Poisoned."*; D462 BUILT that
sentence and re-pointed the slot onto corpus line 264; D464 built line 264 and re-pointed onto three
more. **Three slices, three builds, and every subject was already sitting in a `toBeNull` list
somebody had written to prove a refusal was loud.**

That is not a coincidence. A loud-control slot is filled by looking for *a real printing, in the
same family, whose extra mechanic is unbuilt, that a small drift of this anchor would claim* — which
is a description of the cheapest next slice. **The repo has been maintaining a shortlist of buildable
sentences under a name that reads like the opposite.**

`grep -rn "LEFT_LOUD\|STILL_LOUD\|returns null for anything but" packages/engine/src/*.test.ts`
before running the census, and price what it names.

## The `$` end and the `^` end of an anchor fail differently (D464)

A constructed near miss with LEADING text stays on the loud path: nothing claims its head, so
`ATTACK_EFFECT_SKIPPED` fires and a rung can assert it. **Its TRAILING twin does not.** Once the
sentence itself derives, D409's trailing splitter sees a claimed HEAD and a claimed TAIL and
composes them — so *"⟨the printed sentence⟩. Draw a card."* derives, while `deriveAttackEffect`
still returns `null` for it and `resolvedByAnyReader` is still false.

**Building a sentence builds every `⟨it⟩. ⟨claimed tail⟩` compound with it, through a path that is
neither the anchor nor the arm.** Nothing is authored while no such compound prints — check that
over the whole column and say so — but the consequence for a suite is immediate: a `$`-end refusal
cannot be demonstrated on the loud path the way a `^`-end refusal can, and a rung that tries will go
red on its first run. Assert the SPLIT instead (`splitAttackTrailingClause(x)` equals the head/tail
pair) and say why the two ends differ.

D464 found this from a RED test, not from any audit. None of the four pre-probe passes can see it.

## `discardEnergy` collapses interchangeable candidates BEFORE it decides to park (D464)

`interchangeableCandidates` + `forcedDiscards` run in front of the park, so a body holding three
identical `{C}` presents **one** candidate, the pick is forced, and the op resolves INLINE with no
prompt at all. One `{C}` plus one `{W}` is the smallest board on which the same op PARKS.

**A suite that only ever builds a uniform board tests half the op** — no `EFFECT_PENDING`, no
`phase.cont`, and therefore no subject for a `MATCH_RECORD_VERSION` argument that leans on the
persisted continuation. Build both boards and drive both paths, and pin the DECK that makes them
distinguishable with a mutant row: with the second Energy type removed every end-state assertion
stays green and the park simply stops existing.

## Four `check` rounds, and the fifth site that only a string count can find (D464)

D462's rule — *vitest stops an `it` at its first throw, so COUNT THE FILE* — held again, and the
round count was **four**, not three: 17 census sites, then 7, then 3, then a `tsc` narrowing error
that only appears once the suite compiles at all. **Five `toBe(1514)` assertions were sitting behind
a `toHaveLength(493)` in the same `it`** and no test run would ever have reported them.

⚠️ **And when the SENTENCE step and the PRINTING step disagree, every chain term disagrees too.**
D463 moved `+2 / +2` and could use one number everywhere; D464 moved `+1 sentence / +2 printings`,
so a `resolved.length` chain takes `- 1` and a `units(resolved)` chain takes `- 2` — on the SAME
LINE, twice, in three files. Read the head name, not the neighbouring term.

### A slice that never sees a GAP has not proved its rows discriminate (D464)

D464's first probe reported one GAP and it was **real**: the suite drove the
ASCII apostrophe everywhere and the U+2019 fold nowhere, so an entire character
class was executable by nothing. A rung closed it and the second probe returned
12/12.

That is the normal, healthy shape. A first probe that comes back clean has shown
that the rows **compile and run**; it has not shown that the suite can tell the
mutated build from the real one, because nothing forced the question.

**So read a first-probe GAP as the instrument working, not as a setback** — and
when a first probe is clean on rows you have just written, spend a moment asking
which assertion would have caught each one, rather than treating the clean line
as the finish.

⚠️ And note where it was found: **the probe costs ~50 seconds, the whole-corpus
sweep 2.4 hours.** Every defect D464 found — the GAP, a mutation whose `replace`
changed a different character than its own description claimed, and a doc block
naming the wrong byte — was found *before* the sweep began. The sweep's job is to
certify that the surrounding two thousand rows still discriminate; it is not
where your own slice's defects should surface.

### An instrument that measures the repo must be killable by the corpus (D465)

`scripts/**` sits outside the vitest globs and outside `tsc -b`'s references, so
a committed measurement there is checked by **nothing**: neither `bun run check`
nor a full whole-corpus sweep can tell a correct classifier from a plausible one.
Its only guarantee is that its author read it.

D465 changed such a file — repairing a span probe whose blind spot had hidden
five residue rows — and shipped `scripts/residue-census-gate.ts` beside it, a
`killedByCommand` killer (D212's precedent). Three properties make it worth
having:

- it compares the pinned literals **read out of the suite's source**, so the gate
  holds no number of its own and cannot drift alongside the thing it checks;
- it pins the **blind spot that remains**, not only the one that was fixed;
- it totals a population (32,154 spans), so a silent narrowing shows up as a
  count rather than as an absence.

Five mutant rows die through it, which is the point: **the instrument is now as
falsifiable as the engine it reports on.** When you commit a measurement, commit
the thing that can kill it — otherwise the next slice inherits a number nobody
can contradict, which this run has already seen survive four days and 237
decisions in two separate cases.

### A declared survivor's REASON rots like a count (D466)

A declared survivor carries a verdict and a reason. The sweep re-checks the
verdict every run; **nothing ever re-checks the reason.** So a row can go on
surviving for a reason that quietly stopped being true, and that state is
indistinguishable from surviving for the right reason until someone re-derives
it.

D466 edited an exact-key map that a declared survivor's reason quantifies over —
the row sits **four lines** from an edited hunk. Ruling it out key by key kept the
`+0` honest, and in the process found the reason's arithmetic **already wrong two
slices earlier**: it claimed three exact keys where there are seven.

**So when a slice edits the structure a declared survivor's reason quantifies
over, re-derive the reason and not only the verdict.** The cheap majority can
still be dismissed by file — D466 dismissed nine that way in seconds and checked
twenty-three individually — but the whole value of the exercise sits in the rows
that cannot be, and those are exactly the ones a file-level argument hides.

### A narrowing guard is only killable where the narrow pattern runs first

D467 added a second regex arm that matches a strict subset of what an older arm
matches, and guarded the overlap with a lookahead. Two corpus rows quantify over
the same disjointness fact and the sweep returned **opposite verdicts**: deleting
the lookahead is **KILLED**, while swapping the two arms with the lookahead intact
**SURVIVES as equivalent**.

Both readings are correct, and they disagree only about order. Ship the narrow arm
FIRST and its guard is the only thing between it and a string the broad arm owns —
removing it changes an answer, so the corpus can see it. Ship it SECOND and the
broad arm consumes those strings before the narrow one is reached: the guard still
compiles, still reads as careful, and is **unobservable** — its deletion row would
survive, and survive for a reason ("no input distinguishes them") that is
indistinguishable in the log from a genuine equivalence.

**So killability of a narrowing predicate is a property of the dispatch order, not
of the predicate.** When adding an arm that narrows an existing one, place it
ahead of what it narrows — that is the only order in which the guard is testable
at all. And when a guard-deletion row survives, check the order before writing
`equivalent`: a vacuous guard and a redundant one produce the same verdict.

### A one-token blocker is one token WIDE — it does not mean the token is a column

The residue classifier reports the smallest edit that reaches a built string. When
that edit is a single word, it is tempting to read "one token from buildable". D468
is the case that shows the reading is unsound: `Ancient` and `Future` were the
largest single token in the residue (12 sentences / 17 printings) and reachable in
one substitution — and the buildable subset was **empty**, because `cardSchema` has
21 keys and none of them classifies the banner. Six of the seven one-token edits
*delete or replace the class word and derive with the class gone*, which measures
the sentence's shape without the blocker rather than the blocker's cost.

**Before writing a brief around a census row, open the schema and ask which column
the printed adjective reads.** `{L}` is `Card.types` and cost one anchor and one
arm. `Ancient` is in no column at all, and building it would have shipped a filter
that counts 0 on every board forever while `BUILT.attack` stepped for it — strictly
worse than leaving the sentence unbuilt. The census picks a TOKEN, not a SLICE.
🆕🆕🆕 **D569 (D539): "`Ancient` is in no column, and building it would have shipped a filter that
counts 0" is WITHDRAWN as the conclusion** — "in no column" stays TRUE, but the supply was an engine
table keyed by printing id (`banners.ts`, D568 Tera, D569 Ancient/Future), so a `bannerPokemon` /
`bannerCard` filter counts real bodies. The rule stands with one more question: if no column reads
the adjective, ask whether a per-PRINTING engine table could, and price its two-source cost.

### A refusal re-proposed three times is one `expect` away from self-checking

The Ancient/Future family had been re-derived from source and refused at least three
times, each time costing a full investigation, because the refusal lived only in
prose — a doc block, a conventions entry, a decisions row. Prose does not fail.

D468 wrote it as a test instead: a section that pins the schema key set read **off
`cardSchema.shape`**, plus the blocked population and the claim that no reader,
splitter or registry row takes any of it. **The rung goes red the day ingest lands
the column, and names it.** When a refusal survives its third re-litigation, stop
writing the paragraph better and spend the same effort on the assertion.
🆕🆕🆕 **D569 (D539): "no reader, splitter or registry row takes any of it" is WITHDRAWN at D569** —
four of the twelve sentences are claimed by READERS and four more by hand-written REGISTRY rows,
all over `banners.ts`; the schema-key rung stayed GREEN because no ingest column landed, which is
the lesson: the falsifier named the wrong LAYER. `typedSelfSwitch.test.ts` §9 now pins which four
the readers claim.

Two corollaries D468 also paid for:
- **A refusal can be load-bearing.** One of the blocked sentences was already
  fielded as an attribution control *because* it was data-blocked. Building it
  would have left that control green while it stopped testing anything. Before
  building a sentence that has been refused before, grep the suites for it.
- **Price a row against the field that would SERVE it, not the field that refused
  it.** The work-order table had this row down as refused on `ownerPokemon` — while
  `targetType`, which serves it exactly, was named three paragraphs down in the same
  doc block. That is the second slice in a row to find a stale refusal of this shape.

### A "just bump X" instruction owes the condition under which X is enough

D468's work order told the builder to step the archive ratchet 137 → 138. The
builder refused and was right: the ratchet counts `### Prior resume point (` blocks
in `docs/progress.md`, there were 137, and the step only becomes true in the *same
edit that demotes the resume point* — a ritual edit the slice does not perform.
Following the instruction would have turned `bun run check` red for a reason
unrelated to the slice's own work.

**A counter that tracks an artefact must be stepped by whoever creates the artefact,
never by whoever is merely nearby.** And when a brief hands down a mechanical bump,
it owes the precondition; a builder who cannot see the precondition cannot tell a
ratchet from a typo.

### `equivalent` is a verdict, not a reason — two kinds share it and their obligations differ

The corpus now holds one order-swap survivor of each kind, written a slice apart,
and the sweep log prints them identically as `SURVIVES(known) — equivalent`:

- **Guarded disjointness** (D467): two patterns overlap, and a lookahead is what
  keeps the shipped order from mattering. The equivalence is CONTINGENT on a
  deletable byte, so a companion row exists that goes red when the byte goes —
  and it is KILLED, which is what makes the guard worth having.
- **Structural disjointness** (D468): the two patterns are both `^…$` and disagree
  on a mandatory run of bytes at the same position, so no string can match both.
  No guard exists, and correctly none does — one would be unkillable by
  construction, which the conventions already call a vacuous guard.

**The maintenance obligations are opposite.** A guarded equivalence must be
re-derived whenever either pattern moves; a structural one cannot be broken
without changing the sentence the anchor spells. **So write which kind the row
has into its `survives` reason.** The verdict column will not preserve the
distinction, and the next reader has no way to recover it from the log.

### A census measures whether a sentence is CLAIMED, never whether it is claimed CORRECTLY

D469's attribution control is the cleanest demonstration this repo has of the
limit. With the reader arm mutated to emit the wrong member — the Active-only
count source in place of the whole-board one — the derived program answers the
wrong scope on every board. And **both census suites stayed green**: the sentence
still reads, `resolvedByAnyReader` is still true, and RESIDUE still falls by one.

So a falling residue is evidence that a sentence has an owner, and no evidence at
all that the owner is right. **Every count that a census moves needs a behavioural
suite underneath it that a wrong-but-plausible implementation fails.** When you
add a reader arm, mutate it to the NEAREST WRONG SIBLING and check that something
other than the census goes red; if nothing does, the sentence is claimed but not
built, which is the failure mode the census was introduced to detect and is
structurally blind to.

### When a brief names a row twice, check whether the second entry is the invoice

D469's work order listed corpus file line 534 on its off-the-table list — flagged
as a negative control's home, "a successor that builds it owes a fourth" — and
then, three paragraphs later, as its shortlist's top pick. That reads as a
contradiction and is not one: **one entry named a PRICE and the other named a
VALUE.** The builder honoured both, built the row and paid the fourth control onto
a strictly better home (2 printings, up from 1).

The general shape: an entry that says *"X is load-bearing / X costs Y"* is not a
prohibition on X, it is the bill for X. Read it as one before discarding either
entry, and prefer the resolution that pays the bill to the one that picks a side.

### Price a left row and write the price down, so the next slice does not re-derive it

D469 left three rows and recorded exactly what each would cost: one buildable but
strictly larger (a shared helper widening whose blast radius is two ops, not one);
one whose "state-blocked" reputation was **false** on inspection and is really a
four-consumer vocabulary widening; and one that genuinely costs a
`MATCH_RECORD_VERSION` bump because it reverses a recorded design decision and
adds an op field. None of that is visible from the census, all of it is expensive
to re-derive, and all of it decides what the *next* slice should be.

**A row you decline is worth as much as a row you build, if you write down the
price.** State which of the three shapes it is: bigger than it looks, smaller than
its reputation, or version-costing.

### Pure addition is a survivor-preservation argument, and `precheck` is its proof

Before a sweep, the declared survivors have to be shown still valid. The cheap
method is rule-out-by-file: a survivor in a file the slice does not touch cannot
have been affected. D469 is the case where that method ran out — it edits three
files housing 19 of the 35 survivors, so only 16 could be dismissed that way.

The argument that carried the other 19 is worth reusing: **every hunk was a pure
addition** — a new import line, a new anchor, a new union member, a new reader
arm, a new switch case, a function appended after an existing one — and no
existing line was modified. A survivor's reason can only be invalidated by bytes
that MOVE. Bytes that are merely added cannot reach it, unless the reason
quantifies over the very structure being extended.

**And the claim is tool-checkable rather than eyeballed:** `precheck` re-finding
all N `find` strings exactly once IS the proof that no existing line moved, since
every corpus row anchors on a byte string in a real file. So the method is:
rule out by file, then rule out by pure-addition with precheck as the witness,
then hand-check only the reasons that quantify over the extended structure. D469
had exactly one of those (a survivor whose reason turned on a damage figure being
non-negative; the new arm returns a product of two non-negatives, so it held).

This is materially cheaper than reading nineteen reasons, and it is available to
any slice that adds without editing — which, for this codebase, is most of them.

### A rule written for the users of a tool does not propagate into the tool

Since D462 this file has required a **function** replacement in every hand-written
probe — `text.replace(find, () => replacement)` — because `String.replace` with a
string second argument interprets `$&`, `` $` ``, `$'` and `$1` as splice
directives. That rule was written after a slice spliced 19,000 lines of a source
file into itself.

**The mutation harness itself was never checked against it.** `run.ts` applied
every mutant with a string replacement for 236 slices. Eleven corpus rows carry a
`$` directive in their `replace` — an anchor row quotes its own regex in a doc
comment, and a pattern ending `…$` before a backtick spells `` $` `` — so those
eleven had been applying a mutation nobody wrote.

**When you write a convention because a class of bug is easy to author, grep the
tooling for the same construct the same day.** The tools are written by the same
hands and are not covered by the rule that the tools enforce.

### A defect whose failure mode looks like success hides until it reaches a row where success is failure

The splice corruption produced a file that does not parse. vitest exits non-zero.
The runner reports **KILLED**. Ten rows had been reporting a kill for a file that
was 0.6–1.7 MB of spliced garbage, and every sweep summary for 236 slices counted
them as coverage — D416's *a row that dies for the wrong reason is worth less than
one that survives, because it reports success*, at scale and undetected.

It surfaced only when the same corruption landed on a **declared survivor**, where
"the suite went red" is the anomaly rather than the goal: that row threw a
spurious `STALE-SURVIVOR` and failed the run loudly.

**So the declared survivors are not only documentation of what is unkillable —
they are the only rows whose corruption is observable.** A corpus of pure kills
cannot detect a harness that kills for the wrong reason. Keep declaring the
survivors, and when a harness-level anomaly appears, look there first.

### Guard the harness from OUTSIDE the checker, or the guard is over-determined

The splice fix is guarded by a separate `scripts/mutation/splice-gate.ts` that
`precheck.ts` imports — deliberately not implemented inside `precheck.ts` itself.
The reason is the vacuous-guard trap reached one level up: the mutant that tests
the guard mutates `run.ts`, which *also* makes that row's own `find` occur zero
times, which `precheck` already exits 1 for. The kill would have been
over-determined, and the guard untestable while looking guarded.

The gate also checks a **conjunction** — a `$` in a `replace` is only a defect if
the patcher interprets it — rather than banning `$` in the rows. That distinction
matters: "repairing" the rows by doubling the `$` would write a literal `$$`. **The
repair would be the defect.** When guarding a two-part invariant, assert the pair,
not the half that is easier to see.

### `--only` does not accumulate

Passing `--only` several times in one invocation silently runs a single row and
prints a green-looking total. To re-measure N rows, loop and invoke it N times.
This was found while re-verifying ten rows at once and getting `1 killed`.

### When a silent-corruption class turns out to be harmless, the value recovered is meaning, not coverage

All ten rows corrupted by the `$`-splice defect came back KILLED once the harness
patched literally — each running its declared mutation for the first time in 236
slices. It is tempting to file that as "no harm done."

That is the wrong reading. **A surviving row would have been a coverage gap
discovered; ten kills prove only that the corpus was accidentally sound where it
could not see itself.** The cost of the class was never the verdicts — it was that
for 236 slices a portion of the sweep's headline number was **unfalsifiable**, and
no amount of green could have revealed it, because a corrupted row reports exactly
what a healthy row reports.

So when a silent-corruption class is fixed and nothing changes: record that
nothing changed, and record that this was the *least informative* of the available
outcomes. The recovered value is that those numbers now mean something. Do not let
"it turned out fine" become the reason the next such class goes unlooked-for.

### A residue class defined NEGATIVELY describes the instrument as much as the corpus

`OPAQUE` means *no deletion and no substitution this instrument can make reaches a
built string*. It sat at 78 sentences / 112 printings for four slices while every
reachable class drained, and was read as "the hard ones". It is not.

**All three probes in `residue-census.ts` are single-region** — one segment, one
span, one contiguous substitution. A sentence differing from a built one at **two
separated points** is invisible to all of them however small each difference is.
Measured: `OPAQUE` is 33 REACHED / 45 FAR, and eleven of the reached are two small
edits from a built string.

**Before treating a class as a difficulty ranking, ask what the classifier can
physically express.** A negative definition is a statement about the probe's
vocabulary; only a positive one is a statement about the work. When a class refuses
to move while its neighbours drain, suspect the instrument before the corpus.

### A marker with any built-side hit is not an explanation

D471 proposed six markers for *why* a sentence is opaque. Five were refuted by
their own control: the most plausible one — that `OPAQUE` is the continuing-effect
seam — is false by **49 built sentences / 217 printings** carrying that same marker.

**So every proposed blocker needs a built-side control before it may label
anything**, and a marker that appears on built sentences explains nothing. This is
D464's fold defect with the quantifier moved from the row to the family: it is not
enough that the marker appears on the opaque rows; it must be *absent* from the
built ones. Publish both counts side by side, and let a marker with a live built
side be a co-marker that labels nothing.

### An uncounted figure inside a rule is still a claim

This file's attack-copy rule said "7 sentences / 14 printings" from the day it was
written. Measured over the very population the next sentence of the same paragraph
cites, it is **6 / 13**. Nothing was checking it, because prose figures are not
executable and no instrument had ever been pointed at that family.

**Numbers inside conventions rot exactly like numbers inside code, and nothing
reddens when they do.** When you write a figure into a rule, either derive it from
a committed instrument or mark it as an estimate. When an instrument later covers
that ground, re-measure the prose it supersedes.

### Nothing in this repo can see a defect in a committed measurement except its own gate

D469 and D470 asked that a mutated arm redden *something other than a census suite*.
D471's attribution control came back inverted, and the inversion is worth keeping:
with the new classifier's central function mutated to its nearest wrong sibling,
its own gate went red and **`bun run check` at 459 files / 10,328 tests exited 0**,
along with every other instrument, the linter and precheck.

A measurement script is not covered by the test suite, the typechecker's project
references, or any other instrument. **It is covered by exactly one thing: the gate
you write for it.** That is why D465's rule is not a nicety — an ungated instrument
is unfalsifiable by construction, and its numbers will be quoted for slices.

### D462's "use a function replacement" rule is JavaScript-specific

Python's `str.replace` **rejects** a function as its second argument with a
`TypeError` — and a probe that swallows it silently measures the *unmutated* file,
producing a green-looking non-result. Python's `str.replace` never interprets `$`
at all, so the JS hazard does not exist there; the safe form is `find`-split and
join with a `len(parts) == 2` assertion.

**Carry the intent across languages, not the incantation.** The rule is "make the
replacement literal and assert the substitution happened", and each language spells
that differently.

### A wider anchor that claims the same rows is not free — it is pure risk

D472's sentence is *"If your opponent's Active Pokémon is a {N} Pokémon, it is now
Paralyzed."* The obvious anchor captures the subject: `^If (.+), it is now
(STATUS)\.$`. Measured over all 640 corpus rows, that wider form claims **exactly
the same 1 sentence / 2 printings** as the form that spells the subject out.

It buys nothing and costs a wrong program. The consequent is an **anaphor** — *it*
— and its referent is fixed by the subject the sentence spells. Under the wide
anchor, *"If you have any {M} Pokémon on your Bench, it is now Paralyzed."*
resolves, because `yourBenchHasType` is a real condition, and paralyses the
**defender** off a pronoun pointing at the attacker's own Bench.

**So before generalising an anchor, measure what the generalisation would claim
over the whole corpus.** If the answer is "the same rows", the generality is pure
risk. And when the consequent contains a pronoun, the subject is not decoration:
**an anchor that generalises the subject silently generalises the referent**, and
no census can see it — the sentence still reads and the residue still falls.

### A boolean consequent has no number, so build the signature instead

The usual discriminating board makes N wrong implementations answer N different
numbers. A status consequent has nothing to count: it lands or it does not.

D472's answer is a **five-board signature read as five bits**: the correct build
answers 17, the attacker-side reading 0, and eight plausible wrong builds answer
eight distinct values. The technique generalises to any boolean or side-effecting
consequent — pick a board family that each candidate implementation partitions
differently, and read the pattern of fires as an integer.

Two conditions make it honest: **every wrong value must be MEASURED**, by handing
each real alternative to the real predicate over the real boards (not arithmetic
written into a comment — D439); and the family must include a board where the
correct build is silent, so *0* is a value in the signature rather than the
absence of one.

### An arm can be load-bearing for a whole family and still be uncovered

`conditionHolds`'s `opponentActiveHasType` arm has shipped since D120 and is
evaluated by every clause in its family. It had **zero mutant rows intersecting it
by span, for 352 decisions**, while the arm immediately beside it carries five.

Coverage accrues to whoever last edited nearby, not to what the code load-bears
for. **So when you touch a family, measure its central arm's coverage by SPAN
rather than assuming the family's row count covers it** — an op-name grep will not
find this, because the arm has no name of its own in any row.

### "Is it a pure addition?" is the wrong question — ask "where the survivors live?"

D469 established that pure addition preserves declared survivors, with `precheck`
as the witness. D471 deleted nothing and cleared all 37 at step one. D472 deleted
**124 lines across 61 files** and still cleared cheaply — because the deletions and
the survivors were disjoint by construction: `effects.ts`, where 8 of the 37 live,
was 118 insertions and **zero** deletions, and every deleted line sat in a test
file housing no survivor's `find`.

So the property that matters is not "did this slice delete anything" but **"did it
delete anything where a declared survivor lives"** — which `git diff --numstat`
answers per file, not per slice. The pre-clearance order is:

1. **numstat per file** — which files have deletions at all?
2. **file membership** — do any declared survivors live in those files?
3. **reasons** — only for survivors in files with deletions, plus any whose reason
   quantifies over a structure the slice extended (D466).

D472 needed step three exactly once, for a survivor whose reason counts vocabulary
entries; it was re-derived kind by kind and came out unmoved. A slice may delete
freely and still close out in seconds, provided it deletes in the right places.

### A doubt about EXPRESSIBILITY costs more than a doubt about COST

D473's work order asked whether the printed `If you do,` construction was
expressible, and warned that if it needed an op observing a prior op's success
then "the pair is not cheap". That op had shipped since **D48**, its doc block
names the printed phrase, and a test had been driving the exact op pair and
asserting the exact printed caption since **D227** — the engine could DESCRIBE the
sentence before it could READ it.

The two kinds of doubt are not symmetric. A wrong price makes a slice look
expensive and someone re-measures it. **A wrong expressibility doubt moves a row
from the shortlist to the blocked list, and nothing re-examines the blocked list.**
That is how a row two lines from shipped can sit unbuilt indefinitely.

**So before writing "this may need a new mechanism", grep the op union and the
describers for the printed phrase itself.** The engine's own vocabulary is the
cheapest thing to check and the most expensive thing to get wrong.

### A reader can be correct while its DESCRIBER is incomplete, and only the describer is user-visible

D473 refused a consequent widening that would have claimed one extra row. The
reader would have derived that row correctly. But the op in its consequent has no
phrase in `describeBranch`, so the prompt caption would have **silently dropped the
consequent** while the census recorded the sentence BUILT and the residue fell.

Neither the census nor the mutation corpus can see a caption that quietly says
less — the program is right, the tests pass, and the player is told something
incomplete. **So for every op a widened anchor would newly admit, check that the
describers have a phrase for it.** Coverage of the reader is not coverage of the
description.

### A rule that turns on persistence must be applied at an address that persists

D472 decided `MATCH_RECORD_VERSION` on whether a change adds a new union MEMBER
(costly) or a new INHABITANT of an existing union (free). D473's brief carried that
test to `AttackFlipCount` — where it is meaningless, because that union is **never
serialised at all**: it is a local `const` inside `attack()`, absent from
`packages/schema` entirely. The member/inhabitant distinction has no version
consequence there in either direction.

**Before applying a persistence-based rule, establish that the thing persists.**
The three arguments this repo uses are genuinely different: *no carrier at all*
(D470, D472), *a byte string a current deploy already writes* (D473, where the op
does park), and *a new member of a persisted union* (costly). Naming which one you
are making is part of making it.

### DRIVEN-BUT-UNPINNED is a different diagnosis from UNTESTED, and it changes the remedy

D474's work order said a piece of machinery had "zero test rungs and zero mutant
rows". The mutant-row half was true, measured with the span predicate. The test
half was false by 1,668 lines: a suite drove that code hard on real boards, with a
whole section on where three readings disagree.

The two states need opposite work:

- **Untested** code needs a SUITE. Nothing exercises it, so nothing can discriminate.
- **Driven-but-unpinned** code needs ROWS — and those rows must name the **existing**
  suites as their killers. The discrimination is already there; what is missing is
  the measurement that it exists. D474's ten debt rows all named pre-existing suites,
  all ten killed, and that was the first evidence on record that those suites
  discriminate at all.

**So before writing "this is uncovered", run both checks — the span predicate for
rows and a grep for the suites.** They answer different questions, and conflating
them prescribes the wrong fix: writing a new suite for driven code duplicates what
exists, while writing rows for untested code produces GAPs.

### A union's exhaustiveness may rest on a payload coincidence rather than its discriminator

`takeFlips` dispatched `AttackFlipCount` with a ternary. Adding a member without an
`energy` field was a loud type error — but only because the *field access* refused,
not because the *discriminator* was checked. A member **carrying** an `energy` field
of compatible type would have satisfied the access and fallen silently into the
wrong reading.

That distinction is not academic: the very next row in the same family is exactly
such a member. **A union that type-checks today may be one compatibly-shaped member
away from a silent wrong answer, and the compiler will not tell you which.**

**Dispatch on the discriminator, in a `switch`.** Then the failure mode of a new
member is a missing case, which is loud for every member shape rather than only for
the ones whose payload happens to differ.

### A line number that lands inside a doc block reads as correct

A citation in D474's brief pointed at `effects.ts:~13448` for a function that begins
at `:13467` — the cited line was inside the function's own doc comment. Anyone
opening the file sees the right name on screen and moves on.

That is how a wrong citation survives review, and it is the same hazard as citing
the wrong decision number: **the reader's confirmation is visual, not semantic.**
When citing a definition, cite the line the declaration is on, and prefer the symbol
name over the number — the name survives every edit above it.

### The only reliable done-signal for a sweep is the summary line

Watching a whole-corpus sweep, two tempting signals are both wrong:

- **The working tree.** A `git status` mid-sweep will show a source file MODIFIED,
  because the runner is holding a mutant applied and has not reached its `finally`
  yet. That is its normal working state, not damage. **A sweep is a program that
  deliberately dirties the tree thousands of times**; reading that dirtiness as
  failure inverts the meaning of the thing being watched.
- **The process table.** A liveness check built on `ps` can race and report the
  process absent while it is alive and mid-patch, turning a healthy run into an
  apparent crash at 2,148 of 2,163 rows.

**Poll for the summary line in the log.** It is written once, at the end, and it is
the only artefact that means the run finished. If you must also check liveness, make
the summary line the primary condition and `ps` the secondary one — never the
reverse.

This is the same fact that makes `--allow-dirty` necessary and makes a clean start
mandatory: **the runner owns tree-dirtiness for the duration**, so anyone else's
dirtiness is indistinguishable from its own.

### A rule and its forecast can share one paragraph, and the true half lends the false half its authority

D474 converted a union dispatch from a ternary to a `switch` and wrote, in one
breath: *"dispatch on the discriminator"* — a **criterion**, and correct — and
*"corpus file line 231 is exactly such a member"* — a **forecast**, and false.
D475 built 231, found it nullary, and measured that the old ternary would have
been type-loud for it too.

The rule was right; the prediction about which row would test it was not. And
because they arrived together, in the same voice, with the same confidence, the
prediction inherited the rule's credibility.

**When inheriting a paragraph, separate the criterion from the prediction and
verify them independently.** A criterion is checkable against the code as it
stands; a forecast is only checkable by building the thing it forecasts. Writing
them adjacently is natural — the forecast is usually *why* the rule got written —
but the reader downstream cannot tell which sentence is which unless you say so.

### A mutation that cannot change an answer is not a weak row — it is not a row

D475 deliberately did not write a `crossed-both-seats` mutant for a count of the
form `a + b`: addition is commutative, so swapping both seats computes the
identical number on every board. Such a row would report KILLED or SURVIVED
according to nothing at all.

The observable form was written instead (`reads-the-defender-twice`). **Before
authoring a row, ask what board would distinguish the mutant from the original.**
If none can, the row is not testing weakly, it is testing nothing — and it will sit
in the corpus looking like coverage.

### Demotion is not deletion — correct a falsified claim inside an archived block

`docs/progress.md` keeps every prior resume point. When D475 falsified a claim
written in D474's, the fix went **into the demoted block**, marked and dated, not
only into the new one.

Archived blocks are still read — they are the record of why things are the way they
are, and a successor tracing a decision reads them precisely when the current text
is silent. **A false claim in an archive is still a false claim**, and it is more
dangerous there than in live text, because nothing downstream reddens when it rots.

### A tool that recovers silently from misuse teaches nothing about the misuse

D475 caused a CLOBBER: the builder edited a source file while the mutation harness
held a mutant applied. The harness did exactly the right thing — preserved the
stray edit, restored its own baseline, and reported the collision. The edit was
recovered by hand and the slice went on.

The whole-corpus sweep then reported **`0 clobber(s)`**, correctly: a CLOBBER is
scoped to the run that observes it, and the verdict column carries no memory of an
earlier one. So the only record that it happened is the one written by hand into
the session log.

**That is why the standing rule is phrased as *never write to the tree while the
harness is in flight*, not *clean up afterwards*.** Recovery is cheap and the
incident is invisible a run later, which means nothing accumulates pressure against
repeating it. When a tool contains a mistake perfectly, the mistake has to be
recorded somewhere the tool does not reach — otherwise the next occurrence is
equally cheap and equally uninstructive, indefinitely.

A useful corollary for reading any green run: **the absence of a verdict is not the
absence of the event.** Ask what the run could not have seen.

### A citation is a claim about what the cited thing says

D476's work order recommended an **optional** field and cited a precedent as its
authority. That precedent's field is **required** — the recommendation was refuted
by the thing it invoked, in the same sentence, and the check took seconds.

This is D458's hazard from the other direction. There, a wrong decision number made
a builder confident about the wrong code. Here the number was right and its
*content* contradicted the sentence citing it, which is harder to catch: nothing
about the citation looks wrong until you open it.

**Open the citation before you rely on it, and open it again before you pass it
on.** A brief that cites is making two claims — that the referent exists, and that
it says what the sentence needs it to say — and only the first is self-evident.

### A question about two axes needs a cell where both are printed

D476 was asked whether a newly-added `face` field is orthogonal to the count
members a previous slice had closed. It has no instances: all three of those
members reach a fold that has no `face` field at all, so the two never co-occur on
any printed row. The question could only have been answered about the type system,
not about the corpus.

The real grid — the one member family where both axes appear — is 2×2 with three
cells printed, and orthogonality holds there, measured three ways including two
face-flipped mutants killed by *different* suites.

**Before asking whether two dimensions interact, find a printed row where both are
present.** If none exists, the honest answer is "the corpus does not pose this
question", and any other answer is about the code's shape rather than its
behaviour.

### A count taken from a grep is a claim about the grep

D476's builder wrote, in code, that a field placement left "five pre-existing mutant
`find` strings byte-stable". The member carried **nine** rows; four of them anchored
*through* the region being edited, and all four broke. The number came from a
partial grep and was recorded as though it came from the code.

**When a count is load-bearing, derive it from the module rather than from a text
search** — the corpus is importable, the type is enumerable, and the search is a
convenience that silently answers a narrower question than the one asked.

### A row whose `replace` omits a required field reports ERROR, not KILLED

When D476 made a union field required, four pre-existing mutant rows whose `find`
spanned the affected arm needed re-anchoring in **both** `find` and `replace` — not
just `find`. A `replace` that omits a now-required field does not compile, and the
harness reports ERROR rather than a verdict.

> ⚠️ **D533 CORRECTION — THE LAST SENTENCE ABOVE IS FALSE OF `run.ts`.** The harness never
> compiles a `replace`: it patches the file and runs `expectKilledBy` under vitest, which
> transpiles with esbuild and does not type-check. ERROR is reserved for a bad path
> (`run.ts` "path escapes the repo" / "file does not exist"), a `find` that no longer resolves
> (the stale-row branch) and a red baseline — nothing else (`run.ts:402` `green: code === 0`,
> `:611` `const killed = !mutated.green`). A `replace` that omits a required field TRANSPILES and
> RUNS: it reports KILLED if the missing field makes something throw or an assertion go red, and
> SURVIVED if it does not. The advice below (re-read every dependent `replace`) stands; the
> reason is that the verdict is silent, not that it is ERROR.

**So making a field required is a corpus-wide edit, not a type-local one.** After
adding a required field, `precheck` for `find` breakage and then read every
dependent row's `replace` for the same omission; the first is automatic and the
second is not.

### `precheck` guarantees every `find` resolves; nothing guarantees every `replace` compiles

A mutant row has two halves and they fail differently. `precheck` reads every
`find` and proves it occurs exactly once in its target — that half is gated, and a
break is reported in seconds. The `replace` half has no gate at all: it is never
compiled until the row runs, and a `replace` that no longer type-checks reports
**ERROR**, which is neither KILLED nor SURVIVED.

> ⚠️ **D533 CORRECTION — IT IS NEVER COMPILED EVEN WHEN THE ROW RUNS, AND IT DOES NOT REPORT
> ERROR.** Per `run.ts:402`/`:611` the verdict is the killer's exit code; ERROR is only a bad path
> (`:460`/`:463`), a stale `find` (`:499`) or a red baseline (`:522`). A `replace` that would not
> type-check transpiles and RUNS — which is how `D445-log-row-derives-the-actor` reported KILLED
> for 87 decisions on a `ReferenceError` (D532 close-out). And the "no gate at all" half is now
> half-gated: **`binding-gate.ts` (D533), called from `precheck`, rejects a `replace` that names an
> identifier its file does not bind, or deletes a top-level binding another statement still
> reads.** It does NOT type-check (a dropped required field still passes it) — see the D533 section
> at the end of this file.

That matters most when a change makes a field **required**. D476 did, and four
pre-existing rows had `replace` strings that omitted the new field. `precheck`
caught their `find` breakage; nothing would have caught the `replace` breakage
except running them.

Two consequences worth keeping:

- **After adding a required field, read every dependent row's `replace`, not just
  its `find`.** The first is automatic; the second is manual and easy to skip
  precisely because the first passed.
- **State `0 error(s)` explicitly in a sweep prediction.** A prediction phrased only
  as killed-plus-survived cannot distinguish a clean run from one where rows failed
  to compile, because ERROR rows fall outside both terms.

### Two instruments over one population: reading one is a sample, not a survey

This repo ships `residue-census.ts` and `opaque-anatomy.ts` over the same 640
sentences. Their classes are **disjoint by construction** — the anatomy classifies
only what the census left `OPAQUE` — so a row the census has already classified is
*absent* from the anatomy's list, and vice versa.

D477's work order enumerated three rows of a four-row family. The missing one was
the largest tie and the residue's only `COMPOSE` row: fully classified by the
census, invisible in the anatomy section the brief happened to read.

**Run both before choosing, and prefer a published PATTERN to an enumeration.**
D477 replaced the three-row list with a regex over all 640 rows and found eight
rows / thirteen printings — a measurement anyone can re-run and disagree with,
where a list is only as complete as the window it was read through.

### Overriding a convention is legitimate only as a recorded rung

D472's rule says a wider anchor that claims no additional rows is pure risk. D477
measured exactly that — its generalisations claimed the same 3 sentences / 5
printings as a literal spelling — and took the generality anyway, because the
alternative was a second hundred-byte spelling of one printed clause, which is
D416's copied-function hazard: the corpus goes **quiet** rather than red.

That is a real trade and the right call. What makes it acceptable is that **the
measurement is pinned as a test rung**, so the override is a decision a successor
can find, re-run and reverse — rather than a habit that erodes the rule silently.

**When you override a convention, leave the measurement that justified it in
executable form.** A rule with recorded exceptions stays a rule; a rule with
unrecorded ones is just a preference.

### `find`-vs-`replace` diffing catches mis-described rows, not only inert ones

The diff is usually justified as catching INERT rows — a `replace` that compiles to
byte-equivalent code, which `precheck` cannot see. D477's caught something else: a
row whose `what` described a **swap** while its `replace` performed a **deletion**.
The row was live and would have been killed; its description was simply false.

**No other gate reads the `what` against the `replace`.** `precheck` checks that
`find` resolves; the runner checks that the suite reddens; nothing checks that the
row does what it says. Read the three fields against each other, and note that a
genuine swap's `find` must span both operands — a swap cannot be spelled by
anything shorter.

### A declared survivor's reason is a claim about a POPULATION; a probe is a claim about a SUITE

D477 declared a survivor whose reason is *unreachable by value*: the guard it
deletes is true on every input the code can actually receive, because the character
class it tests is built from a map's own keys.

That claim quantifies over the whole reachable population — and a `--decision`
probe cannot sample it. The probe shows the row surviving against one suite. Only
the whole-corpus run shows it surviving **while thousands of other mutations of the
same file are being killed around it**, which is what distinguishes *unreachable*
from merely *unwatched*.

**So match the evidence to the shape of the reason.** When a survivor's reason is
local — structural disjointness between two anchors, a commutative fold, an
argument about two adjacent lines — a probe is sufficient and the sweep adds
nothing. When the reason quantifies over inputs, values, or the corpus, **the probe
is not weaker evidence of the same kind; it is evidence of a different claim**, and
only the full run speaks to the one being made.

### A refusal can be false on the day it is written — check its claim against the declaration it names

D424 refused a row because *"`coinFlipGate` carries no tails branch"*. That field
had shipped 155 decisions earlier at D269, the interpreter already spliced it, and
another arm was already producing two-armed gates. The refusal was false when
written, and it was then copied into two further sites, where it blocked the row
for another fifty-odd decisions.

**This is the second such finding in six slices** — D473 found `recordGate`'s "if
you do" had shipped since D48 while a brief called it unbuildable. Both were
**expressibility** claims, and both had been copied onward.

The asymmetry is why it matters: a wrong **price** is re-measured by the next slice
that considers the row. A wrong **expressibility** claim moves the row to the
blocked list, and nothing re-reads the blocked list.

**So before writing or trusting a refusal that names a type, open the declaration.**
The check costs seconds. And when starting a slice, re-read two or three refusals in
the target family the same way — the ones that are wrong are, by construction, the
ones nobody has looked at.

### "Is it a gate?" is the wrong question about describers — ask whether it parks through the call site

D473 established that a widened anchor owes a check that `describeBranch` /
`describeCondition` can phrase every op it newly admits. D478's brief applied that
to a gate and was wrong: those functions are reached from **exactly one call site**,
which returns early unless the **parking** op is a recording op with a matching
`recordGate` in the queue. A `coinFlipGate` reaches neither, and one describer is
typed to take a `recordGate` specifically.

**Describer obligations follow the call path, not the op's category.** Trace the one
site that calls them and ask whether your program reaches it; "it is a gate, so
describers apply" is a category argument, and category arguments do not survive
contact with a single-call-site helper.

### An anchor with zero mutant rows is evidence its doc block has never been re-read

D478 found the same anchor at the centre of two independent findings: its refusal
was **false on the day it was written**, and it had carried **zero mutant rows for
fifty-four decisions**. Those are not two coincidences.

They reinforce each other in a loop:

1. A refusal stops the family from being built.
2. An unbuilt family attracts no mutant rows — nobody is editing near it.
3. No rows means nothing ever forces anyone to re-derive the refusal.

The loop is only broken from outside, by someone opening the declaration the
refusal names. **So the absence audit (find machinery with no rows) and the refusal
audit (check a refusal's claim against the type it cites) are the same audit
approached from two ends** — and when an absence audit turns something up, read its
doc block before writing rows for it. The rows are the cheaper half of the finding.

### Audit refusals from the zero-mutant-row set, not from the residue's class table

D479 checked 15 expressibility refusals against the declarations they name. **Four
were false — a 27% rate.** What found them was D478's corollary, not the residue:
an absence audit over 96 module-level anchors turned up **38 with zero mutant
rows**, and three of the four falsifications lived in that set. Only one lived
where the residue clusters, and one lived in an *instrument* rather than the engine
at all.

That follows from the loop D478 named: a refusal stops a family being built, an
unbuilt family attracts no rows, and no rows means nothing re-derives the refusal.
**So the anchors with no rows are exactly where stale refusals accumulate.**

**Start an audit there, and do not restrict it to the engine** — instruments carry
refusals too, and theirs are the least likely to be re-read.

### A refusal has three failure modes, and only two of them overturn anything

D479's four falsifications were not all the same kind:

- **False when written.** The claim was untrue on the day it was made — D270's
  refusal named three things as absent that had shipped one decision later, and it
  stood for 208 more.
- **Rotted.** The claim was true and became false. D363 grouped four rows under one
  reason; one of the four now builds.
- **Reason-only.** The verdict survives but its stated reason does not. D247 refused
  a shape as "a question no card asks" when a card does print it — and the refusal
  still stands, because the *expressibility* clause beside it holds.

**Say which kind you found.** Only the first two overturn a refusal; the third
corrects it. Recording a reason-only correction as an overturn would put a row back
on the shortlist that is still genuinely blocked.

### A brief that cannot be followed literally is a brief that gets followed approximately

D479's work order told its builder to read a 5,928-line file "ALL of it" — an
instruction that contradicts this repo's own context-hygiene rule — and pointed at
"the last three entries" of a file whose sections are not chronological, so the
three it named were twelve decisions stale.

Neither error was fatal, because the builder noticed. That is the problem: **an
instruction that must be silently reinterpreted teaches the reader to reinterpret
instructions.** The next one that needs following exactly gets the same treatment.

**Name entries by title, ask for the index plus the named sections, and give
instructions that are executable as written.**

### The three defect classes a `find`/`replace`/`what` diff catches

Reading a mutant row's three fields against each other has now caught three
distinct defects in three consecutive slices, and only this check sees any of them:

- **INERT** (D451) — the `replace` compiles to byte-equivalent code. `precheck`
  cannot see it; the row reports KILLED for the wrong reason.
- **MIS-DESCRIBED** (D477, D478) — the row is live and killable, but its `what`
  describes a different mutation than its `replace` performs.
- **UNKILLABLE-AS-WRITTEN** (D479) — the row is live and correctly described, but
  **no rung in the named suite separates the mutant from the original**. It would
  have shipped as a silent survivor.

`precheck` gates that `find` resolves; the runner gates that the suite reddens.
**Nothing gates that the row means what it says**, so read all three fields before
probing.

### The danger of an unkillable row is not that it fails — it is that it PASSES

D479 caught a mutant row that was live, correctly described, and separated from the
original by **no rung in its named suite**. Left alone it would have reported
SURVIVED.

That is the failure mode worth naming, because it inverts the usual worry. A
survivor is a verdict this corpus treats as *informative*: it gets declared, given
a reason, and inherited by every later slice as a fact about the engine. **A row
nothing can kill does not report its own defect — it reports a property of the code
that is not there.**

And the probe cannot tell the two apart. `survives because equivalent` and
`survives because untested` produce the same line. Only the author, reading the
rung list against the mutation before running anything, can distinguish them.

**So the three-field read happens BEFORE the probe, not after** — and when a row is
rescued by adding rungs, the whole-corpus run is what confirms the new rungs
discriminate rather than merely exist.

### A refusal carries two claims with two different oracles — check build state first

*"This cannot be expressed"* and *"this is not built"* are separate claims, and they
are settled by different queries:

- **Cannot be expressed** — settled by opening the declaration the refusal names.
- **Is not built** — settled by `programFor`, or by grepping the registry.

D479 audited a refusal, opened all three declarations it cited, was right about all
three — and then re-asserted the build-state half **from the paragraph it was
falsifying**. The cards had shipped 208 and 153 decisions earlier; the refusal in
`registry.ts` is refuted by a declaration **52 lines below it in the same file**.

**Check build state first.** It is the cheaper query, and an audit that checks only
expressibility will confirm a refusal is *possible* to overturn without ever
noticing it was overturned years ago.

### Three prose rules over 150 decisions did not stop the fourth occurrence

D330: *"check whether the piece has shipped before pricing it."* D343: the same
lesson at its second site. D321: *"a backlog row that names an unbuilt card is a
claim about the registry"*, with `git grep <id>` prescribed. **It happened a fourth
time anyway.**

Part of why is mechanical and worth knowing: **reprints are cited by suffix** —
`` `sv10.5w-023`/`-107` `` — so a refusal written in shorthand never spells its id
whole and **is invisible to the grep the rule prescribes.**

The rest is D465's argument: a claim nothing executes is a claim nothing checks. So
the build-state claim became a table asserted in both directions — refusals asserted
*not built*, resolved ones asserted *built and corrected*. **When a prose rule has
failed three times, the fourth response is not a better-worded rule.**

### Correcting one copy of a claim leaves the others standing

The refusal D480 overturned had been copied into three files. D271 built the thing
it denied and corrected **one** copy — the one in the test that would have gone red.
The copies in `registry.ts` and `effects.ts` stayed, and one of them is what a later
audit read.

**When you falsify a claim, grep for its distinctive phrase and correct every
instance in the same edit.** The copy you fix is the one that reddens; the copies
that do not redden are the ones a successor will find.

### When a slow tool is the sole guard over an untypechecked region, every defect there costs a full run

`tsc -b` does not typecheck `scripts/` — every tsconfig `include` is `["src"]` or
`["vite.config.ts"]`, so the mutation corpus and every instrument sit outside it.
D480 proved it with a live witness: a survivor's reason keyed `survives.why` where
the runner reads `survives.reason` **shipped green through `bun run check`**, and
surfaced only when a probe printed `undefined`.

The consequence is about economics, not correctness. **The mutation sweep is
currently the only thing standing between a data error in `scripts/` and a green
gate — and it is a ~2.7-hour instrument that runs once per slice**, where a
typechecker runs in seconds. Every mis-keyed field in a 2,238-row corpus is
invisible until a sweep, and a sweep is the most expensive feedback in the repo.

Two things follow. **Treat a coverage hole in a fast tool as a cost multiplier on
the slow one**, not merely as a gap. And when closing such a hole, **expect it to
surface latent errors in proportion to how long it was open** — price that before
committing, because "turn on the typechecker" is never the whole slice.

### A coverage gap named by the directory where it was noticed will leave files behind

D480 found an untypechecked file in `scripts/` and three separate documents — its
decisions row, the resume point, and the next brief — all called it "the `scripts/`
hole". D481 measured it: **15 files, three of them outside `scripts/` entirely**,
in `apps/api/` and `packages/schema/`. Closing the directory would have left them
behind a guard reporting OK, which is the same defect one level up.

**Enumerate the region from the tool's own answer, never from the path in the bug
report.** `git ls-files` for what exists, `tsc --showConfig` for what is covered,
and the difference is the gap. A witness tells you a hole exists; it does not tell
you where the hole ends.

### "Defects in proportion to how long it was open" is not a law

This file previously said to expect a long-open coverage hole to surface latent
errors in proportion to its age. D481 closed one and found **six errors — four in
a single file, and zero in the 2.3 MB, 2,238-row corpus** that had been unchecked
the whole time.

The earlier entry had two halves and only one survived. **The economics half is
sound**: a defect in an unguarded region costs whatever the next-slowest tool
costs to find, and D480 paid a 2.7-hour sweep for one mis-keyed field. **The volume
half is not**: a region can be unguarded for months and still be nearly clean,
because the people writing it were being careful without a tool to prove it.

**So argue for closing a hole from cost-per-defect, not from expected yield** — and
when the count comes back small, that is the guard working as intended, not the
slice failing to justify itself.

### A coverage guard needs a self-check, because its failure mode is going vacuous

Any guard that asserts "the uncovered set is empty" can be defeated by making the
set trivially empty — blank the predicate, widen a comparison, narrow the input.
All of those stay **green forever**, and a mutation row against them reports
SURVIVED, which this corpus treats as informative.

D481's guard routes its verdict through drivable functions exercised on **synthetic
pairs whose answer is known by construction**, before the real repo is consulted.
That is what gives a mutant against it a board to die on.

Two related rules earned at the same time: **a guard should assert its own wiring**
(the older lint guard can be disabled by deleting eight words from `package.json`
with nothing going red), and **a rung that cannot fire should be deleted, not kept
for reassurance** — one was, once the compiler was found to catch that case an
earlier call.

### Closing a verification hole changes the standing of every past measurement over it

D481's sweep was the first in this run's history whose corpus had been typechecked.
The line it printed — `0 error(s)` over 2,246 rows — reads identically to the
forty-two before it. **The number is unchanged and its warrant is not.**

Every prior sweep reported that column over rows no tool had type-verified. A row
could carry a mis-keyed field, be read as `undefined` by the runner, and produce a
verdict about nothing, while the column still read zero. Those measurements were
not *wrong* — they were **unwarranted**, and nothing in the output distinguished
the two.

So the value of closing a coverage hole is not only the defects it prevents going
forward. **It retroactively establishes what every past measurement over that
region was entitled to claim.** That benefit is invisible in the slice's own
numbers — D481 found six errors, which badly understates what it bought — and it is
the strongest available argument for closing such holes early rather than when they
finally bite.

### "Does the op exist?" is checkable; "does a composition of shipped ops spell it?" is not

D482's row was priced at three mechanisms by three separate records over 35
decisions. The true price was one anchor and one arm, with **zero new ops** — the
sentence is spelled by composing two ops that already ship, and the awkward
asymmetry the price was for turned out to be *the boundary between them*.

The reason the wrong price survived three restatements is structural. A claim about
one op — *"`spreadDamage` is bench-only"* — is checkable in seconds by opening a
declaration, and it was true every time it was restated. **A claim about
compositions is checkable by nothing in this repo**, so *"therefore this needs a
third target and a new asymmetry"* was never tested by anyone; each record copied
the last.

**Before pricing a row at "needs a new op", try to spell it as a sequence of shipped
ops and drive the result.** It is a ten-minute check, it is the question that
decides most prices, and nothing in the tooling will prompt you to ask it.

### The unkillable-as-written class is not confined to mutant rows

D479 named the defect in a mutant row: live, correctly described, and separated
from the original by no rung. D482 found the same shape **inside a test suite** —
at the demonstrator's printed damage value, two different implementations produced
**byte-identical boards**, so the section's discriminating assertion was silently
vacuous.

**The symptom was a control passing.** Nothing failed, nothing looked wrong, and
the assertion would have gone on reporting a distinction it could not make.

So the check generalises: **any assertion can be vacuous by arithmetic coincidence,
not only by construction.** When a board is chosen to separate N implementations,
compute what each of them would answer and confirm the answers differ — and prefer
values that cannot collide (a printed 90 where 30 would have made two readings
agree).

### A refusal witness is a tripwire whose blast radius is the whole family

D482 widened an anchor next to a sentence D189 had refused. The widening was caught
by two suites: D482's own, and **D189's `toBeNull` on that sentence — written 293
decisions earlier**.

D189 could not have known which slice would eventually reach too far in that
direction. It only had to name the sentence and assert it stayed unread. That is
what makes a refusal witness different from documentation: **a `toBeNull` naming a
printed sentence is a live guard against every future anchor that overreaches
toward it**, not merely a record of what was unbuilt at the time.

Two things follow, both already practised here and now justified by a case:
**re-point refusal witnesses rather than deleting them** when the sentence is
finally built (D438/D444), because the rung's value outlives the refusal; and
**measure such a witness by the slices it catches, not by the row it was written
for.**

### `find` occurs exactly once ≠ one row per line

`precheck` asserts that every mutant row's `find` occurs exactly once in its target
file. D483 found two rows whose `find` strings both resolved to **the same line** —
each occurring once, both patching it — for **46 decisions**. Both reported KILLED
on every sweep, and the arm one of them names had **no row at all**.

The check was true the whole time. **A per-row uniqueness property does not imply a
per-line partition**, and nothing in the harness asserts the second.

How it happened is ordinary: a slice re-indexed a capture group, and only one of the
two rows quoting that line was re-transcribed. The surviving row then landed on its
neighbour's line and stayed green.

**When a check reports a property, write down what it does not imply.** The gap is
worth its own guard, and the count of existing collisions is the deliverable whether
or not any are defects.

⚠️ **[CORRECTED AT D484, WHICH MEASURED IT.] The predicate this entry originally
proposed — *group rows by (file, resolved-line) and assert no line carries two* — is
FALSE, by a factor of hundreds.** Sharing a line is the corpus's **central idiom**:
one anchor line, N different corruptions of it. Measured at D484: **383 lines carry
943 rows (41.6% of the corpus)**, and **293 groups / 726 rows share a byte-identical
`(file, find)`**. An exemption list for those would be the very artefact a coverage
guard must not have.

**The predicate that works is EXPERIMENT IDENTITY: no two rows may be
indistinguishable to the runner** — same `file`, `find`, `replace`, `nameFilter`,
killer set, `survives`. `id`, `decision` and `what` are excluded, because they are
labels and a defect that renames itself is still a defect. Under that predicate the
exempt set is **empty**, and a historical replay across six commits shows it firing
on exactly one group — the real defect — **at D447, the commit that caused it**, and
never falsely across 568 rows added since.

⚠️ **The general lesson is about the shape of the first guess:** the obvious
predicate keyed on *where a row points*, and the defect was about *what a row is*.
Two rows on one line are a family; two rows the runner cannot tell apart are a bug.

### A shared printed word is not a shared blocker

D483 was handed four residue rows that all print `Pokémon ex` in a target position
and told they shared one blocker. Deleting each axis in turn and re-asking the
readers (D458) split them **2 + 2**: the two snipes resolve at HEAD once the class
token is stripped, while the two spreads stay unread with *either* the class or the
trailing sentence removed.

One slice became two, and the half that looked cheapest was cheap for a different
reason than the half that did not.

**Before pricing a cluster as one mechanism, delete each candidate axis separately
and re-ask.** Rows that share vocabulary often do not share a blocker, and the
disproof costs one probe per axis.

### The arithmetic-coincidence class applies to designs, not only to assertions

D482 found a test section that was vacuous because two implementations produced
byte-identical boards at the chosen damage value. D483 found the same shape **in a
design decision**: a shipped op walks exactly the candidate set a printed sentence
names, with a required filter and the right side — and it places **flat counters**
where the sentence says *"does N damage"*.

**On any board without a damage-reduction passive, those two are byte-identical.**
A suite that does not field such a passive cannot tell them apart, so the wrong
composition would have looked correct indefinitely.

**When a shipped op looks like it spells a sentence, name the boards on which the
two would differ before adopting it.** If you cannot name one, you have not
established that it spells the sentence — only that nothing you have tried
distinguishes them.

### A corpus cannot self-report a row that tests its neighbour

D483 repaired two mutant rows that had resolved to the same line for 46 decisions.
Before the repair: both KILLED. After: both KILLED. **The verdict column is
byte-identical across a defect that made one of the two rows meaningless.**

So nothing in 46 sweeps could have distinguished this corpus from a correct one —
and nothing in the sweep that followed the repair confirms the repair either. **The
only evidence that the second arm is now covered is the row itself, read against
the code.**

This is the same shape as the formerly-spliced rows that all came back killed once
the harness patched literally: **when a silent-corruption class is fixed and no
verdict moves, the recovered value is meaning, not coverage.** Both cases share a
moral worth stating once: a mutation corpus reports what its rows do, never what
its rows *say* they do, and the gap between the two is invisible to every column it
prints.

### Validate a guard's predicate against history, not against argument

D484 had to choose what a mutation-corpus partition guard should assert. Rather
than reasoning about what *ought* to collide, it replayed the candidate predicate
against six past commits of the corpus.

The result decided the design: **0 collisions before the defect landed, exactly 1
from the commit that caused it through every commit after, 0 once it was repaired
by hand** — the real defect every time, and **nothing else ever, across 46
decisions and 568 rows added**.

That is stronger evidence than any argument could have been. It establishes the
false-positive rate empirically, it names the commit the guard would have fired on,
and it shows the predicate is neither too tight nor too loose **on the actual
history the guard will run against**.

**When a guard's predicate is not obvious, run it over the past.** The repository's
own history is a labelled dataset: the defects are the ones someone eventually
found by hand, and everything else is a negative example.

### The obvious predicate often keys on WHERE something points, when the defect is about WHAT it is

D483 found two mutant rows resolving to one line and the natural guard followed the
symptom: *no line may carry two rows*. D484 measured it — **41.6% of the corpus
shares a line, legitimately**, because one anchor line with N different corruptions
is the corpus's central idiom.

The defect was never about location. It was that two rows were **indistinguishable
to the runner** — same file, find, replace, killers — so one of them could not
possibly be testing anything the other wasn't. That predicate has an *empty* exempt
set, where the location-based one would need a 383-entry exemption list.

**When generalising from a single defect, separate the symptom from the property.**
Two rows on one line are a family; two rows the runner cannot tell apart are a bug —
and the first is what you see, while the second is what went wrong.

### A rung that tests two fields at once cannot prove either

D484's guard shipped with a self-check rung comparing *no command, a suite* against
*a command, no suite* — two fields apart. The rung passed, and so did the mutant
that removed one of those fields from the key: it **survived**, because the rung
stayed green either way.

**A discriminating rung must differ from its control in exactly one axis.** Two
differences give the implementation two ways to pass, and the rung then proves
nothing about either — which is the unkillable-as-written class arriving in the
guard that was written to prevent a related one.

### Ask what the instrument assumes about itself that nothing asserts

Twice now a guard has retroactively changed the standing of every measurement that
came before it. D481 closed a typecheck hole and the next sweep's `0 error(s)` was
the first one taken over a corpus anything had type-verified. D484 added an
experiment-identity check and the next sweep was the first taken over rows anything
had proven distinguishable from one another — for 46 decisions, two of them were
not, and the column read identically throughout.

In both cases **the number was unchanged and its warrant was not**, and in both
cases nothing in the output could have shown the difference.

Two of a kind is a pattern worth acting on: **when a corpus is the instrument,
every property of the corpus that nothing checks is a silent qualifier on every
number the corpus has ever produced.**

So the productive question is not *"what might be wrong today"* — the sweep answers
that, expensively. It is **"what does this instrument assume about itself that
nothing asserts?"** For this corpus the answers found so far were: that `find`
resolves uniquely (asserted early), that patching is literal (unasserted until
D470), that rows are distinguishable experiments (unasserted until D484), and that
the files holding it typecheck (unasserted until D481). The remaining ones are
worth enumerating deliberately rather than waiting for each to surface as a defect.

### A `COMPOUND-head` row can come free the WRONG way, and the cheaper build is the trap

D466's rule is *before pricing any `COMPOUND-*` row, drive `splitAttackTrailingClause`
with a head you know builds.* D485 drove it and got the answer D466 did not: **the
splitter composes this shape**, so building the tail alone would have freed the row with
no compound anchor at all — strictly cheaper than what shipped.

It was refused, and the reason generalises. The tail is *"Discard all Item cards and
Pokémon Tool cards **you find there**."* — **an anaphor whose antecedent is the printed
reveal in the other clause.** A tail-only arm makes `deriveAttackEffect` claim a fragment
whose *there* points at nothing, and then the splitter will compose it behind **any** head
some reader claims: *"Draw 3 cards. Discard all Item cards and Pokémon Tool cards you find
there."* would resolve into a program that empties half the opponent's hand off a sentence
that never revealed it.

**So the splitter's admission test is not a licence.** It asks whether the two halves are
each readable; it cannot ask whether the tail MEANS anything without its head. D472 found
the same shape in a pronoun's SUBJECT (an anchor that generalises the subject silently
generalises the referent); this is the same defect in a locative, and the family's own
idiom — seven prior sentences all anchored WHOLE with their leading reveal — was already
the right answer for this reason at seven addresses.

**The rule: before taking a splitter composition, ask what the tail refers to. If any word
in it points OUT of the clause, the anchor owes the whole sentence.**

### The near-miss op that is byte-identical on the FIRST board you would write

D483 stated the counterweight — *a composition that matches on the boards you happen to
build is not a composition that matches* — and D485 is the case where it bit at the
cheapest board rather than at an exotic one.

`bottomFromOpponentHand { filter, dest: "discard" }` takes the **same** `CardFilter` into
the **same** pile as the sweep D485 built. On an opponent hand holding **exactly one**
matching card the two are byte-identical — and not merely in the board: a single-class
offer auto-resolves under the M1 no-choice rule, so there is not even a park to notice.
A suite whose fixture hand held one Item would have proved nothing and looked complete.

They diverge at **two** matches: the sweep takes both and asks nothing, the near-miss takes
one and parks to ask which.

**Two things follow.** First, **name the board where they differ before adopting or
refusing a composition, and drive both** — D485's §5 runs the near-miss program on both
boards rather than describing it. Second, **the collision board is usually the SMALLEST
one**, because the shipped op's shape degenerates there; so "I tested the simple case
first" is exactly the habit that hides it.

### Six readings, six numbers — compute the board before you choose it

D482's arithmetic-coincidence class says compute what each candidate implementation would
answer before picking a board. D485 did it as a table and the table paid twice: at
2 Items / 2 Tools the *items-only* and *tools-only* readings both answer 2, and with only
Energy as the non-matching filler the *every Trainer* reading collides with the correct one.
The hand that separates all six is 3 Items, 2 Tools, and non-matches drawn from the OTHER
two printed Trainer subtypes.

**Assert the near-misses, not just the answer.** D485's §5 computes what the board would
answer if one Item were dropped, and if the Supporter and Stadium were dropped, so the
fixture's composition is a MEASUREMENT of what it has to be rather than a preference a
successor can quietly erode.

### A shared event's doc block is producer-specific in exactly one clause

`FORCED_HAND_DISCARD` was written at D426 with *"`seat` is the player who CHOSE them"*.
D485 added a second producer where **nobody chooses** — the printed sentence names a
predicate — and every other clause of that doc block survived: the filing under the owner,
the absence of an `actor`, the count-shaped log row, the argument for why no second seat
is named.

**When a second producer arrives at a shared event, read the doc block clause by clause
rather than deciding whether it is "still right".** One sentence was false and the rest
were load-bearing and true; deleting the block would have lost the argument, and leaving it
would have left a false claim in the two files a successor reads (D178/D442 — correct in
place, dated, in every copy). D478's rule pointed at the same address from the other side:
**describer obligations follow the CALL PATH**, and the call path is where the stale clause
was.

### A brief's hard-rules list is a checklist, and omissions from it read as permission

Every work order in this run has carried a hard-rules block. D485's omitted the one
line its predecessors included — that the end-of-session ritual belongs to the
caller — and the builder ran the full ritual: stamp, resume point, session log,
decisions row, conventions entries, archive ratchet.

It did the work correctly and consistently, and `check` was green. **The deviation
was the brief's, not the builder's.** A rule that has held for fifteen consecutive
work orders is not thereby implicit; it is only in force where it is written.

**Keep the hard-rules block verbatim between briefs and edit it deliberately.** When
a rule leaves the list, that is a decision — so make it one, rather than discovering
after the fact that dropping a line was read as lifting it.

### Three slices running, the decisive artefact was a board chosen from an argument

D482 built a five-board signature so eight wrong implementations answered eight
different numbers. D483 refused a shipped op because it places flat counters where
the print says damage — identical on any board without a reduction passive. D485
refused a near-miss that takes the same filter into the same pile — identical on
any hand holding exactly one match, which is the first hand anyone would write.

**In all three, the wrong choice would have been green.** No verdict column, no
census figure and no sweep would have distinguished it; the discriminating board
existed only because someone reasoned about where two candidates diverge *before*
designing the suite.

So the pattern is worth stating as practice: **when two implementations are
available, name the board on which they differ before you write any board at all.**
If you cannot name one, you have not chosen between them — you have picked the one
you thought of first and collected evidence that cannot tell.

And note what this implies about the sweep: it is excellent at catching a build
that contradicts an assertion, and structurally blind to a build that satisfies
every assertion anyone thought to write.

### Two candidate programs can agree by ARITHMETIC IDENTITY on every board

D483 and D485 each found a near-miss that matched the right answer on the boards
one would naturally write. D486 found something stronger: a sibling program whose
card count equals the correct one **for every possible hand size**, because
`min(1,H) + min(2, H − min(1,H))` is identically `min(3,H)`.

**No board separates them by what leaves the hand.** They diverge only on what the
program *asks* — one parks for a choice on a two-card hand, the other discards
silently.

So when two candidates look interchangeable, first check whether they are equal by
*algebra* rather than by coincidence. **If they are, no amount of board design will
help, and the separating axis is not a quantity at all** — look at parking,
prompting, ordering, or what the log records. Those are the observable differences a
quantity-shaped test can never reach.

### A rung passing is not evidence it still tests its stated claim

After D486's build, a neighbouring suite's compose rung was still green — **for a
different reason than the one it names.** It had been passing because of the tail
condition it describes; it now passes because of a shadow refusal in the splitter.
Nothing failed, and nothing would have.

**A build inside a family is the moment to re-read that family's rungs against
their stated reasons.** A rung whose justification has silently moved is
indistinguishable from a healthy one at the verdict level, and it will keep passing
long after the thing it was written to catch has stopped being possible.

### Prefer "an old doc block says X, unverified" to "D4xx priced it at X"

D486's work order attributed a price to a recent refusal audit and quoted it as
verbatim from that decision's row. The row never mentions the sentence: the audit
had verified only the *expressibility* half, and the **price** came from a doc block
**93 decisions old** — which turned out wrong in both directions, naming a repair
site whose reader requires a field the sentence does not print.

**Attribution changes how a claim is read.** "A recent audit priced it" implies
someone re-derived it recently; "an old doc block says so" invites the check. Both
can cite the same words, and only the second is honest when nobody has looked.

**Grep the row you are citing before you quote it** (D476), and when the provenance
is a doc comment rather than a decision, say that.

### Where two programs are extensionally equal, the corpus is PROVABLY blind

D486 refused a sibling program equal to the shipped one by algebraic identity —
`min(1,H) + min(2, H − min(1,H)) === min(3,H)` for every hand size. The sweep then
ran 2,294 rows and **every one would have reported the same verdict under either
build**.

That is a stronger statement than "the suite happened to miss it". The blindness is
**provable**, and the proof is an identity rather than a gap: no additional row, no
better board, and no larger corpus can distinguish two programs that agree on the
measured axis everywhere. Coverage is not the missing ingredient.

**So when a design choice turns on an axis the corpus does not measure — parking,
prompting, ordering, log text — say so explicitly in the decision, because the
green run will otherwise be read as having endorsed it.** The number is silent on
choices of that kind, and there is no version of the number that would not be.

### Adding vocabulary is always a widening, so a residue row is essentially never blocked by a schema version

Several rows were deferred across this run "because building them would bump
`MATCH_RECORD_VERSION`". D487 measured it: **zero of 96 residue sentences are
blocked only by a version-costing change**, and the reason is structural rather
than fortunate.

The record's own discriminator is *"would an old record MEAN something else"*, which
admits three costing shapes: a new **required** key at a persisted address, a
**rename** there, or a re-meaning of an existing byte string. **A residue sentence is
by construction a distinction no shipped printing prints** — so the pre-change
behaviour is always available as the absent-key default, and every repair that adds
vocabulary (a new op, a new union member, a new value, a new optional field) is a
widening.

A bump can only be **forced** by a repair that RESHAPES something a record already
holds — in this repo, the durated per-Pokémon and per-game records. So the whole
test is: **does the sentence print a duration or a schedule?** If not, the version
is not the blocker, whatever an old note says.

### Price by witness load, not only by mechanism

D487 compared three rows whose mechanisms looked comparable and chose on a cost no
mechanism count predicts: **how many refusal-witness files name the sentence.** One
carried six, one two, and the one built carried one. D485 had found a candidate
fielded in nine.

A witness re-point is real work — each is an executable claim that must stay true
and keep discriminating — and it is invisible to every other estimate. **Count the
files that name a sentence before pricing it**, and remember the count is a lower
bound on the slices that will notice if you get the re-point wrong.

### Confidence in a brief is not evidence, and the hedged claims are the derived ones

Of three prices handed to D487, the two stated confidently — both with citations —
were false, and the citations pointed at text that does not exist where they said.
**The one marked "my read, unverified" was correct**, and is what shipped. That is
the fifth consecutive slice where an inherited price was wrong and a flagged
uncertainty was right.

The pattern has a mundane cause: **a hedge is what a writer adds when they actually
looked and were unsure**, while a confident restatement is usually a claim copied
forward. So read the hedges as the load-bearing sentences, and treat the confident
ones as the ones most in need of a grep.

### A green run after fixing one site is evidence the runner stopped early

D487's census tax landed in **five waves** — 19 sites, then 16, 9, 7, 2 — because
an earlier failing `expect(` in the same `it` masks every later one. The same effect
has appeared in every multi-site tax this run.

**So when a mechanical pass touches many assertions, do not read the first green as
done.** Re-run until a round changes nothing, and expect the count of remaining
sites to be unknowable until the round before last.

### The corpus is blind to design equivalence and sharp on behavioural regression

Two consecutive close-outs make the distinction cleanly, and it is worth holding
onto rather than re-deriving.

**D486's claim was a choice between two programs** that agree by arithmetic identity
on every board. No verdict could settle it — the blindness was provable, not
incidental, and the evidence had to be an argument about a non-quantitative axis.

**D487's claim was that an old byte string still means what it meant.** That is a
statement about a fixed input producing a fixed output, and it is exactly what a
mutation corpus is competent to hold: the suite drives a v29 continuation with the
new key absent, and the sweep confirms nothing mutates that rung away.

So the instrument's competence has a shape. **Ask which kind of claim you are
making before deciding what evidence the run provides.** For compatibility,
regression, and "does this still do X" — the sweep is the right instrument and a
green line is real support. For "which of these two equivalent designs is correct"
— it is silent, and saying so explicitly is part of the decision.

### Measure pair-hood by AXIS DELETION, never by sentence resemblance (D488)

Two residue sentences that *look* like one mechanism may be one slice or several, and **the
sentences cannot tell you which**. The test is cheap and it is the same cost either way: **delete
each axis alone and re-run every reader on both rows.** Two rows are one slice iff they refuse and
build **together on every axis**.

D488's pair — *"Discard the top 3 cards of your deck, and this attack does 80 damage for each
**Energy card** you discarded in this way."* and its *"…70 damage for each **Misty's Pokémon**…"*
sibling at count 7 — ran four deletions against all 13 `deriveAttack*` exports:

| axis deleted | row A | row B |
|---|---|---|
| FILTER (`→ card`) | refused | refused — **and both collapse to the SAME STRING at two counts** |
| MILL HEAD (shipped Energy-discard head, same filtered tail) | refused | refused |
| SCALING (tail dropped) | **builds** (`discardDeckTop count:3`) | **builds** (`count:7`) |
| CONNECTIVE (comma → period) | refused | refused |

**Two blockers, both rows carry both, and the noun is neither.** The filters differ in *kind* — a
category (`anyEnergy`) versus an owner-prefixed name (`ownerPokemon`) — and that difference cost
**zero**: both members shipped under one anchor. **D483 ran the identical test on a four-row cluster
and got a 2+2 SPLIT.** Neither result was predictable from reading the sentences.

**Pin the pair-hood in the mutant corpus, not only in prose.** D488 authored two rows
(`D488-noun-group-goes-greedy`, `D488-noun-resolver-loses-the-owner`) that are characters **only row
B can see** — had the pair actually been two mechanisms, those rows would have had no killer, and the
sweep would have said so.

### When a near-miss is an ALGEBRAIC identity on the natural board, the finding is WHICH BOARD to write (D488, refining D486)

D486 established that a candidate can be indistinguishable from the build by arithmetic rather than
by board coincidence. D488 shows the **useful** form of that: the identity was **conditional on a
board property**, and naming the property is what made the suite say anything.

*"Count what the mill recorded"* and *"count the discard pile afterwards"* are equal **for every
deck, every count and every noun** — when the pile **starts empty**, because the pile afterwards *is*
what the mill moved. That is the board a suite writes by default. **So every board in D488's suite
pre-seeds the discard pile**, and the near-miss is separated on the first assertion instead of never.

Two further rules fell out:

- **Count how many candidate readings each board separates, and field as many boards as it takes.**
  D488 enumerated **eight** readings; board A separated 6 (80 / 240 / 0 / 320 / 640 / 160), board B
  separated **all 8** (140 / 490 / 0 / 350 / 770 / 210 / 280 / 70). The file fields two decks because
  one deck would have left two readings alive.
- ⚠️ **A candidate that NO board separates by quantity is separated by CONTENTS.** A mill-side filter
  (filter as the cards leave the deck, rather than as the record is scored) is arithmetically
  identical **forever** on any deck whose top N all match. Its separating axis is *which cards left*,
  so the suite asserts the pile's **contents**, not only its size.

### The near-miss that folds at DECLARATION is not a composition — check WHEN, not just WHAT (D488)

`deriveAttackDamageMultiplier` really does claim *"…for each Energy card in your discard pile."*, and
it really does produce a filtered count of exactly the right noun. It is still not a route to
*"…for each Energy card you discarded in this way."*, on two independent grounds:

1. **It folds at DECLARATION** — before the program runs, off the board — where this family's count
   must be read *after* the mill, from inside the program.
2. **It counts the WHOLE pile**, not the record.

Ask of any candidate composition **when it evaluates**, not only what it computes. A multiplier
resolved at declaration and a slot read mid-program are different machines that agree only on the
empty-pile board (see above). `deriveAttackDamageMultiplier(MILL_ENERGY)` is null, so there was no
composition to reach for — but the *shape* of the refutation is reusable.

### Witness load is per-MECHANISM, not per-ROW (D488, refining D487-ii)

D487 established: price a residue row by **witness load** — how many refusal-witness files name the
sentence — not only by mechanism, because no mechanism count predicts it (one candidate had six
files, another had one).

D488 supplies the second data point, and it cuts the other way. Its two rows share **one file, two
rungs** (`discardScaledDamage.test.ts` §1), because the witness is held **by predicate** — *"this
anchor takes SIX… and only those"* — rather than by quoting either sentence. Neither sentence appears
verbatim anywhere outside the corpus file. **Building both rows cost exactly what building one would
have.**

So: **count witness load against the MECHANISM you are about to build, then divide by the rows it
frees.** A predicate-held witness amortises across every row in its cluster; a sentence-quoting
witness does not. And check the neighbours are actually about your sentence —
`benchDiscardBoost.test.ts` and `deckTopMill.test.ts` carry mill refusals that belong to a
*different* (additive) row and cost nothing here.

### Re-point a witness onto the OP, not onto the count (D488)

When a refusal rung is re-pointed after its sentence ships (D178/D438), prefer a discriminator that
**breaks when the claim stops being true**. D488's §1 rung had asserted an arm count; a `.length`
re-point would have stayed green while the sentence it names moved to a different anchor. It now
discriminates the two arms **by the op** (`discardEnergy` vs `discardDeckTop`).

⚠️ **And read what the rung's comment still promises.** D488's names **two** blockers for its
leftovers; exactly **one** was paid. Leaving the other named — rather than editing the comment down
to what shipped — is what tells the next slice where the remaining sentence's price is.

### A `Math.round` numerator can be DERIVED BY INTERSECTION rather than read (D488)

A census rung of the form `round(inRows / unbuiltAttack * 100) === 18` is **green at more than one
numerator**, so a slice that moves only the denominator can edit it blind and never find out.

D488 measured instead of assuming: the rung is green at both denominators, `inRows ∈ {33,34}` at 184
and `∈ {32,33}` at 182, and the intersection is **{33}** — unmoved. (33/184 = 17.93 %, 33/182 =
18.13 %; the printed fraction held at 18 while only the denominator moved.) Confirm with `git diff`
that the numerator's identifier is absent from every hunk in that file.

**Generalisation: a rounded assertion has a solution SET, not a solution.** Any edit to one of its
inputs must be justified against the whole set, or it is a guess that happens to pass.

### A figure and its exception list are TWO claims, and usually only the figure has a witness (D488)

D487 wrote: *"version tax measured at exactly 81 occurrences, with **three** history occurrences left
alone."* The arithmetic was right — `grep` returns 85, `85 − 4 = 81` — and the **word was wrong**:
there are **four**. The fourth is *that paragraph itself*, which quotes the arrow it is counting.

**A prose census of exceptions is self-referential the moment it is written down**, and the count is
taken before the sentence exists. When inheriting a figure with an exception list: **re-derive the
list, not just the total**. The total is the part that had a witness.

### A progress grep is an instrument, and it needs the same literal check as any other (D488)

D488's whole-corpus sweep was monitored mid-run with `grep -c 'SURVIVED'`. **The harness prints
`SURVIVES(known)`.** The grep matched nothing for two and a half hours, and several interim status
reports said *"zero survivors"* while 35 declared survivors had already been seen. The run was
correct throughout; the instrument reading it was not.

Two rules:

- **Tally by the verdict COLUMN, not by a guessed literal.** `awk '{print $3}' … | sort | uniq -c`
  enumerates the labels the harness actually emits and cannot silently return zero. If you must
  grep, grep once for the label and confirm it is non-zero at a point where you know it should be.
- ⚠️ **The final tally DOUBLES.** The harness prints each row once as a progress line and again as a
  table row — the D488 probe showed 11 progress lines and 11 table rows for 11 mutants — so a
  whole-log count of `KILLED` reads 4,536 for a 2,268-row result. **Derive the count from unique
  ids**, not from label occurrences.

🛑 **And the standing rule is unchanged: the summary line is the only reliable done-signal** (D474).
An absent verdict, a dirty tree and a missing count are all normal mid-run states.

### Run the axis-deletion LATTICE, and substitute each axis onto its nearest BUILT spelling (D489, refining D488-i)

D488 established axis deletion as the way to measure whether two rows are one slice. D489 sharpens
the method twice.

**Substitute, do not delete.** Removing a clause outright confounds two different findings — *"this
axis is the blocker"* and *"the remainder is not a sentence the corpus would ever print"*. Replace
each axis with its nearest **already-built** spelling instead, so every point in the lattice is a
sentence some reader could in principle claim.

**Run the lattice, not the list.** One-axis deletions answer *"is any single axis the blocker"*; they
cannot answer *"does any proper subset of this sentence already build"*. D489 ran all **2⁵ points ×
13 readers** on a five-axis sentence:

| axes changed | points | built |
|---|---:|---:|
| 0 (the print) | 1 | 0 |
| 1 | 5 | 0 |
| 2 | 10 | 0 |
| 3 | 10 | 0 |
| 4 | 5 | 0 |
| 5 (all) | 1 | **1** |

*"No proper subset builds"* is strictly stronger than *"one point builds"*, and it is what justifies
a whole-sentence anchor rather than a composition.

⚠️ **And count the axes from the PRINT, not from the brief.** D489's work order named four; the
sentence had five — the printed noun was bare `Energy cards` with no type token where the shipped
anchor's filter group was mandatory. The missing axis is the one that makes a "the head already
ships" claim true of the *vocabulary* and false of the *sentence*.

### A brief's "A or B?" fork is itself a claim, and the answer is often C (D489)

D489's work order priced a hand-source discard as *"a seventh `discardEnergy.from` member, or D485's
`discardFromOpponentHand` mirrored"*, and named those two carriers confidently. **Both were wrong.**
The carrier was `payFromHand`, which already had the source, the filter, the §9.2 filing and the
`chooseCards` park, and lacked only the quantifier.

**Before choosing between two named carriers, grep the op union for the VERB THE SENTENCE PRINTS** —
`grep -n 'from your hand' effects.ts` — rather than for the carriers someone named. A fork presented
as exhaustive is an assertion about the op union, and it deserves the same witness as any other.

### Ask what the PARK carries before pricing a union member (D489)

Widening a union looks like adding a word. It is not, when the new member changes what the **prompt**
must carry. Every machine under `discardEnergy` takes a `PokemonRef` — `discardableEnergies` yields
`{uid, from: PokemonRef}`, the §11 shield filters those refs, `interchangeableCandidates` keys on the
host, and the park itself carries refs across the wire. **A hand card has no ref**, so a hand member
there changes the prompt's candidate *type*: D457's five mirrors (`packages/schema`, `redact.ts`,
`projection.ts`, both HUDs) — to say what `chooseCards` already says.

**The test is not "does the union have room" but "does the new member's payload fit the park".**

### "This op parks, so the describer obligation is live" is a CATEGORY ARGUMENT (D489, re-earning D478)

Two consecutive slices, a work order predicted describer work from the fact that an op parks. Both
times the obligation was **empty**.

`withConsequence` returns the prompt unchanged unless the QUEUE holds a `recordGate` on the slot the
parking op files; `describeBranch`/`describeCondition` are reached only from `recordGate.ops`.
**Parking is not the trigger — a gate is.** Trace the one call site; do not argue from the op's
category.

⚠️ **And the real describer work is often somewhere the category argument never looks.** D489's was
in the park's *heading*: `handCostPhrase` learning the printed *"up to N"* makes the caption the
printed head sentence byte for byte, which turns it into a D457 witness that the op carried its cap.

### A named slot beats a boolean rider once the source stops being implicit (D489)

`damageChosen`'s two existing scaled-snipe riders are bare `true` flags because each names an
**implicit** source the fold finds from `(state, ctx)` — the prize count, the attacker's attached
Energy. A §9.2 record is an **address** with three inhabitants (🆕🆕🆕 D567 NOTE (D539): five now — `turnedPrize` / `revealed`; 🆕🆕🆕 D579 (D539): SIX now — `"placed"`, one entry per damage counter placed; the address argument only strengthens), so a boolean would have to hard-code
one, and D458 already measured the board that breaks that: two sequential recorders overwrite one
slot, so a program filing both `paid` and `discarded` needs to say which.

Shipped as `perRecorded?: EffectSlot` — **not** `count`, which on that op already means the arity.
**No filter twin**: the filing op is narrowed by the printed noun, so a filter would be unfalsifiable
on every board the sentence reaches, and the falsifier belongs at the site rather than in a field.

### A census staying GREEN under an attribution control is the finding, not the absence of one (D489, demonstrating D469)

D489 broke its central arm at the nearest wrong sibling — the printed **hand** head read as a
**board** discard — and `censusAtHead` stayed green. Under that wrong build the sentence still reads,
`resolvedByAnyReader` is still true, the residue still falls by one and `BUILT.attack` still steps.

**A census measures whether a sentence is CLAIMED, never whether it is claimed CORRECTLY.** The five
behavioural suites that went red are what discriminate. When the attribution control leaves a census
green, record it: it is positive evidence that the census is doing its stated job and not more.

### `cardIdentity` keys a Basic Energy on what it PROVIDES, not its id (D489)

N unnamed `basicEnergy` fixtures are **one** interchangeable class. A suite measuring an
interchangeable *collapse* on them measures the offer's ceiling and says nothing about the collapse —
D489's first board hid exactly this, and a red rung found it. **Use `typedEnergy` with distinct
provisions** whenever the board is meant to separate "how many are offered" from "how many distinct
choices exist".

### An instrument's SCOPE is part of its figure — `git grep` cannot see the new suite (D489)

The version tax at D489's head is **88 occurrences / 62 files / 18 `it(` titles**. `git grep` reports
**84 / 61 / 17**, and the difference is exactly the slice's own new test suite, which is **untracked
until the ritual commits it**. Every slice creates one, so a `git grep` tax figure is systematically
short by one file's worth — and the builder's report quoted two mutually inconsistent numbers for
this one figure.

**Say which instrument produced a number, and check its scope covers the untracked tree.** This is
D488's `SURVIVES(known)` failure at a different instrument: the run was right both times and the
thing counting it was not.

⚠️ **The same applies to `grep -c 'it('`**, which counts *lines containing* the substring — including
prose and comments — and over-reported D489's rung delta by 4. `grep -cE '^\s+it\('` agreed with
vitest exactly.

### A version-tax forecast is a forecast (D489, applying D427)

Predicting the successor's tax arithmetic fails in a way the arithmetic cannot see: the file count
does not grow monotonically, because the **previous** slice's suite drops out of the live set as the
new one joins it. Re-measure after the edit; do not carry a predicted figure into a resume point.

### A residue-census snapshot in `tmp/` is one slice stale by construction (D489)

`census-D<N>.txt` is written *before* D<N>'s own build lands. Diffing against it reports your slice's
delta **plus the previous slice's**. Re-run the instrument at HEAD; the gate's §A literals are the
check that you did.

### Launch a multi-hour sweep DETACHED with `setsid`, and poll it (D489)

D489's whole-corpus sweep took **three launches**. Two runs as tracked background jobs were
**SIGTERMed within a minute or two of the turn ending** — once at row ~200, once at row ~12. The
third, launched with `setsid nohup … &` so the process reparented to **init (PPID 1)** and sat
outside the session's process group, ran the full 9,653 s to completion.

```
setsid nohup bun scripts/mutation/run.ts > "$CLAUDE_JOB_DIR/tmp/sweep-DNNN.log" 2>&1 < /dev/null &
disown
```

Verify it took: `ps -eo pid,ppid -p <pid>` must show **PPID 1**.

⚠️ **RE-POINTED (D541 close-out): the recipe above is ONE FLAG SHORT and `PPID 1` is the wrong
column to read.** Plain `setsid` does not fork when the backgrounded job is already a process-group leader,
so it `exec`s in place and the sweep keeps the shell as its PPID; use `setsid --fork` and verify `SID ==
PID`. See *"Plain `setsid` does not FORK"* below. The recipe is kept as written because it is what the last
fifty-odd sweeps actually ran.

⚠️ **A detached run sends no completion notification**, so the loop must poll — and the poll reads
the **summary line**, never a verdict tally (D474, D488).

🛑 **The interruptions were not a harness defect, and the harness's own behaviour is why they cost
nothing.** Both times it trapped the signal and restored what it had applied —
`[SIGTERM] restoring 1 file(s) before exit…`, then `restoring 0 file(s)` — leaving a clean tree, no
`tmp/mutation-journal.json`, and no orphan process. That is D470's safety behaviour working under a
signal nobody designed for.

**Before relaunching an interrupted sweep, classify the state all three ways** (D446): `git status`
clean, no journal file, and `ps` shows no surviving `mutation/run.ts`. A dirty tree after an
interruption means a mutant is still applied and must be reverted at the site — never with
`git checkout --` or `git stash`.

### A byte pin cannot catch a PHANTOM SPECIMEN (D490, extending D452)

`deckTopMill.test.ts` held a near-miss documented *"verbatim off the local D1"* that read **100**
more damage. The committed corpus column prints **140**, on the one and only row containing
`each player's deck` — and `effects.ts` had copied the invented figure to two more doc sites. Both
`toBeNull` rungs on that string had been green for **two independent wrong reasons**: the string was
a phantom, *and* the readers they named were the wrong ones.

🛑 **A byte pin measures an invention exactly as faithfully as it measures the truth.** D452 caught
this shape at a hand-retyped *opening*; D490 caught it at a hand-retyped **damage figure**, which no
amount of pinning can distinguish from a real one.

**The repair, and the standing rule: assert that a specimen IS a row of `legalAttackCorpus()`**, and
read its printing count off the corpus rather than typing it. Where a card id cannot be resolved in
this checkout, cite the corpus **file line** instead — and say the id is unresolvable rather than
inventing one.

### A refusal ROTS, and nothing in the corpus forces anyone to re-derive it (D490, closing D478's loop)

D490's family had **zero mutant rows across 87 decisions**. A tripwire audit over all 2,331
pre-existing rows on eight needles found **no row resting on the refusal**. The loop is complete and
self-sealing: the refusal stopped the family being built → an unbuilt family attracted no rows → no
row rested on the refusal → nothing ever re-checked it.

Its stated reason (*"it needs a recording mill this engine does not have"*) had been **false since
D488**, two slices earlier, and it also said *"refused by all TWELVE readers"* when the surface had
been thirteen since D417.

🛑 **Before pricing any residue row from a recorded refusal, re-derive the refusal itself.** Five
consecutive slices have found an inherited price naming something already built — and at D490 the
caller's own *correction* of the price was also half-stale.

### The RECORD can decide an op's shape, and it is cheap to drive (D490, applying D458)

The question *"is 'each player's deck' one op or two sequential ones?"* looks like a style call. It
is not: `recordMoved` **assigns** (`record[slot] = [...uids]`), so `[mill self, mill opponent,
damage]` leaves only the **second** deck's card filed — **190 where the sentence deals 330**, with
both decks correctly milled and both log rows correct, so nothing else looks wrong. Two slots is no
escape either, because `damageDefender.count` is a single `EffectSlot`.

**When a program files a record and something downstream counts it, drive the sequential spelling
before choosing.** D458 measured this overwrite on a different pair; D490 is the first printing whose
*damage number* turns on it.

⚠️ **And widen a two-member discriminant with a `switch`, not the ternary it replaced.** The shipped
line was `op.whose === "self" ? ctx.seat : otherSeat(ctx.seat)`; a third member falls silently out of
the wrong side and `tsc` says nothing — D447's `snipeTargets` defect at a new address.

### When two shipped precedents disagree, find the axis that distinguishes them (D490, applying D433)

`counterEachAll`'s `side:"both"` walks absolute `SEATS`. `handRefresh`'s `who:"both"` walks
controller-first. Picking one by preference would have been a coin flip; the distinguishing fact is
**what the op emits per iteration**: `counterEachAll` emits one event per *body*, so seat order is
not row order, while `handRefresh` and D490's mill emit one row per *seat*, so the seat order **is**
the log's order.

🛑 **And test it from p2's chair.** Absolute-vs-controller ordering is **inert on every board where
p1 attacks** — the entire distinction is unobservable in the default fixture, so a suite can look
thorough and still let the mutant live.

### A witness re-pointed onto a READER's return value is blind to the ASSEMBLER (D490, extending D489/D469)

D489 established that a census staying green under an attribution control is the finding. D490 goes
a layer further: under a mutation that mills the **wrong deck**, *all four* family suites whose
witnesses had just been re-pointed **also stayed green** — because their claims are about what the
**reader** answers, and the mutation lives in the **assembler**, downstream of it. Only the
behavioural suite discriminated.

**Re-point a witness onto the OP where you can.** Where the reader's return value is the only
available subject, **say in the rung that the family's witnesses are blind to assembly**, so the next
slice does not mistake their greenness for coverage.

### Say which instrument produced a number — writing the convention did not prevent the repeat (D490, re-earning D489)

D489 recorded that `git grep` sees only **tracked** files, so a version-tax figure taken with it is
short by exactly the slice's own new suite. **One slice later, D490's report quoted a tracked-only
occurrence count beside an untracked-inclusive file count** — the identical mixed figure.

Measured at D490's head: **89 occurrences / 63 files / 19 `it(` titles**; `git grep` says **85 / 62**;
the new suite contributes exactly **4 / 1**.

⚠️ **D489's history-exception list was also one short** — it named four and there were five, having
called *"this heading"* the paragraph *inside* its changelog entry while missing the entry's own
heading. That is D488's self-reference rule firing a second time.

🛑 **The rule that works is procedural, not advisory: re-measure the figure AND its exception list
after the edit, and state the command you used.** A convention that says "check your scope" does not
survive contact with a report template that does not ask for the command.

### Grep the OLD VALUES as bare tokens before letting the runner find the census tax (D490)

The tax lands in waves because an earlier failing `expect(` masks later ones in the same `it`. D490
cut it to three waves (4, 9, 2) by first grepping the **old** literals as bare tokens — which found
31 sites across 16 files in one pass — and letting the runner find only the remainder. The runner is
a one-throw-per-`it` instrument; a grep is not.

### An axis whose printed value is ALREADY BUILT is not an axis (D491)

D491's brief named three axes — SCOPE, MOOD, COUNT. Measured over the full lattice, **two were inert
on the verdict and one was degenerate**: *"Draw 3 cards."* had built since M4, so substituting COUNT
onto its nearest BUILT spelling changed nothing on either side of the split.

**Before listing an axis, check that its nearest BUILT spelling actually DIFFERS from the print.**
Otherwise the lattice carries a dimension that cannot move the verdict, and its Hamming weights mean
less than they look — a 2⁴ table with one degenerate axis is really a 2³ table reported twice.

⚠️ **And when an axis has no nearest-BUILT spelling at all, say it is UNAVAILABLE rather than
inventing a point.** D491's subject-noun axis (`player`, where every built seat noun is `you` /
`your opponent`) had nothing printed or built to substitute onto, so it could not be varied
independently of SCOPE. Reporting that is a finding; fabricating a comparison point is not.

### A lattice run AFTER the build is not the lattice — derive the pre-state, do not quote it (D491)

A pre-slice axis table cannot be re-run at the new head, so writing it into a suite as prose is
exactly the unfalsifiable claim D465 forbids: it records what someone once saw, and nothing rechecks
it.

**The executable form is `before = now && !NEW_ANCHOR.test(point)`** — derive the old verdict from
the current one by subtracting what the new anchor claims — **plus a rung asserting that the points
the new anchor claims are exactly the ones that moved.** That version reddens if a later slice widens
the anchor across a point the lattice said was refused.

### Read what a refusal QUANTIFIES OVER before treating it as a blocker (D491, applying D450)

D490 found a recorded refusal that had gone **stale**. D491 found something sharper and more common:
a refusal that was **still true, and answering a different question.**

`opponentMayDraw`'s doc says *"Deliberately NOT a rider on `drawCards`: that op is fully automatic and
seat-fixed to the controller, and every one of its call sites relies on both."* Both halves hold — of
the **shape it refuses**, a MAY answered by the other player, which needs a park, and a parking rider
does break *fully automatic*. It says nothing about a **mandatory both-seats key**, which needs no
park at all.

**A doc block that refuses a SHAPE has refused that shape, not the axis.** Quote the refusal's own
reasoning and check what it ranges over before letting it price anything.

### An attack ENDS THE TURN, so the defender's turn-start draw lands inside the same action (D491)

🆕🆕🆕 **D570 (D539) — SCOPED, NOT WITHDRAWN.** True on every board except a FIRST attack by a Festival
Lead body (Dipplin, Goldeen, Swirlix, Seaking) with Festival Grounds in play: that attack opens the
attack-again window (`TurnAllowances.attackAgainUid`, flow.ts `finishAttack`) and the turn does NOT end,
so no turn-start draw lands in the action; the second attack (or `endTurn`) ends it. A suite that
drives a Festival Lead body under Festival Grounds must read the draw one action later.

Any claim about what an attack's *effect* drew must filter `CARDS_DRAWN` on **`reason: "effect"`**. A
bare row count is off by one for the defender on every board — and worse, it **passes a build that
walks the seats in either order**, because the extra row makes `["p1","p2"]` and `["p2","p1"]` both
read as three rows with the defender appearing.

This cost D491 a red round and it is the same shape as D430's *a regex that matches a clock is not a
regex that matches a source*, arriving this time at an event's `reason` field.

⚠️ **The deck-out consequences follow from the same fact**: `flow.ts` checks only the seat whose turn
is **starting**, so an attacker who decks themselves out does **not** lose, and when both players
deck out the **defender** does — inside the same action, not a turn later.

### A mechanical substitution pass must be CLOSED UNDER ITS OWN OUTPUT (D491)

D491's census pass ran two rules in one loop where the first rule's **replacement** was the second
rule's **pattern**. One line was stepped twice and gained a duplicated comment.

**Either order the rules so no output is a later input, or apply them in a single pass with a
sentinel.** 🛑 **`git diff` will not flag this** — the line still looks stepped, just stepped too far.
The only detection is re-reading the patched lines, which is worth doing on every mechanical pass.

### `spliceReport`'s population moves when a row BREAKS, not only when one is written (D491)

`patches LITERALLY` read **22** mid-slice against a recorded 21, and returned to 21 once `precheck`'s
broken rows were repaired. The cause: a row whose `find` occurs **twice** in its target is counted as
spliceable, because `String.replace` and split/join then disagree about it.

**Read a moved gate population as a question about the corpus's HEALTH before reading it as a change
in the corpus.** A count that drifts without an authoring edit is usually a broken row, not a new
dependency.

### Name which LAYER each witness covers — census, reader, executor (D491, extending D490-ii)

D490 showed that a witness re-pointed onto a reader's return value is blind to the assembler. D491
ran the attribution control at **both** layers and produced the full map:

| witness kind | reader mutation | executor mutation |
|---|---|---|
| census (`censusAtHead`) and loud controls | green | green |
| value re-point onto the reader's answer | **red** | green |
| behavioural suite | **red** | **red** |

So: **the census and the loud controls are blind to both layers**; a value re-point — the form D438
says to prefer — covers **the reader only**; and **only a behavioural suite covers the executor.**
State this explicitly in the rung, so a later slice does not read a green family suite as coverage of
the program its reading builds.

### Count MATCHES, not LINES, when grepping the census tax (D491)

D491's front-term pass found **21 sites across 8 files** where `grep -n` reported **18 / 9** — three
lines carry two chains each. Use `grep -o` (or a regex `findall`) and count matches.

🆕 **And naming a constant is what makes it greppable**: wave 3 was a single site,
`RAW_UNBUILT_ATTACK_UNITS`, found by one grep — where **seven consecutive slices** had stepped its
`toBe(N)` pin and missed the bare arithmetic operand beside it, because the operand had no name until
D458 gave it one.

### A bare `toBe(N)` replacement is a line-targeted edit wearing a global one's clothes (D492)

D435's *grep the assertion, not the string* is necessary and **not sufficient**. `toBe(24)` **is**
the assertion spelling, and a repo-wide replacement of it hit **7 sites in 6 files** where exactly
one was the census figure.

🛑 **Worse, the obvious repair is NOT AN INVERSE.** Replacing the new value back also rewrites every
site that legitimately held the new value all along — D492 broke **9 pre-existing assertions** that
way, in one command, while undoing an over-patch of 7.

⚠️ **And the suite was GREEN through the over-patch**, because the other assertions in those files
still passed. No test could have caught it; it was found only by reading `git diff -U0`.

**Two rules.**

1. **For a literal under ~4 digits, patch BY LINE NUMBER** — derive the target lines from
   `git diff -U0`, or from the runner's `file:line`. A value-keyed pass is only safe for a figure
   large enough to be unique, and one `grep -c` tells you which case you have before you write
   anything.
2. **A revert is a diff-driven edit too.** Undo the **lines** the diff shows you changed, never the
   **value** you changed them to.

**Verify the repair by paired analysis, not by a green suite**: count each changed literal on both
sides of the diff and confirm every value nets out to the intended step. D492's repair was confirmed
by `toBe(24)` net −1 against `toBe(28)` net +1 — exactly one site, the intended one.

### An instrument's classification is an answer to the question the instrument asks (D492)

`residue-census.ts` classifies a residue row by **cutting** a segment and re-reading the remainder.
That answers *"does the remainder build?"* It **cannot** answer *"does the remainder compose?"* — and
those come apart.

D492's two rows were filed `COMPOUND-tail` on the strength of a `CUT 🛑 does NOT build:` line, and a
work order quoted that line as proof the head was the only blocker. Measured in the other direction,
the **tail was a blocker too**: the head under D482's *parenthetical* builds, while the same head
under a W/R **suppression sentence** does not, because `splitAttackTrailingClause` requires the tail
to be a `deriveAttackEffect` clause and a suppression is a damage reader's (D466).

🛑 **Never quote a classifier's label as a blocker count.** Run the substitution in **both**
directions — vary the segment you kept as well as the one you cut — before pricing anything.

### When two readings collide, find the ONE BYTE that splits them (D492)

The instinct on a collision board is to reach for a bigger board. Often the tie breaks on a single
property instead, and finding it is cheaper and makes a sharper rung.

*"Does 60 damage **TO** each of your opponent's Pokémon ex"* and *"…**FOR** each…"* are identical —
`[60, 0]` — on an Active `ex` with no Weakness and no benched `ex`. **A Weakness ×2 on that same
one-body board splits them 60 against 120.** No extra bodies required.

**Enumerate the readings first, then look for the smallest perturbation that separates the most of
them.** D492 enumerated ten and found one board separating six numerically plus a seventh **by
shape** (the wrong reading *parks* rather than answering a number) — a distinction worth reaching for,
since a parked program and a wrong number fail differently.

### A gate population that moves must be VERIFIED, not accepted (D492, applying D491)

D491 recorded that `spliceReport`'s population moves when a row **breaks**, not only when one is
written. D492 moved it 21 → 22 in the other direction — and the check is the same either way:
**re-derive the population independently** rather than accepting the builder's account of it.

The precise criterion is a `String.replace` special in the row's `replace` — `$$`, `$&`, `` $` ``,
`$'`, `$n`, `$<name>` — **not a bare `$`**, which over-counts by an order of magnitude (212 rows
against the true 22). Re-derived that way, exactly one D492 row qualified, so the move was an
authored dependency.

⚠️ **The builder's report named the wrong row for it.** The conclusion was right and the citation was
not, which is the same name-without-checking failure that has recurred across this run — and it is
why the population is re-derived at ritual time rather than read.

### Price each branch of a fork ALONE as well as together (D493)

D493 faced a two-blocker row and a work order that asked *"which branch frees more?"* — a question
that presupposes the branches are independent. Measured, they were not:

- **(A)** the vocabulary gap freed **0 sentences / 0 printings** alone. The clause it would teach is
  printed standalone **zero** times.
- **(B)** the composition seam freed **0 / 0** alone. The set it would serve — *refused whole,
  unserved by all splitters, head claimed, tail claimed by a non-effect reader* — was **empty**.
- **(A)+(B) together freed 1 / 1** — which is exactly what a single whole-sentence anchor freed, for
  a fraction of the cost.

🛑 **A branch with an empty SOLO payoff is not half a slice. It is a prerequisite** — and a
prerequisite whose only consumer is the other branch is not a design option, it is a cost line.

**Compute each branch's payoff over the whole corpus separately before comparing them.** If neither
pays alone, the fork was never a fork.

### Before building a composition path, grep the corpus for the mutant whose `replace` IS that path (D493)

D493's composition branch already existed as a mutant row. `D409-tail-guard-widened-to-any-reader`
carries `replace: "  if (!claimedByAnyReader(tail)) return null;"` — **byte for byte the widening** —
and its `what` names the defect it ships: *"a tail claimed only by a DAMAGE reader would then be
admitted, and the caller has nowhere to put it… SILENT IN EVERY CENSUS."*

**Building that branch would have disarmed the tripwire that describes it** — D436's GAP, arrived at
from the authoring side rather than the sweeping side.

⚠️ **The needle is the GUARD LINE, not the decision number.** Nobody looking for "prior art on
trailing-clause composition" would search for `D409`; they would search for the code they were about
to write. Grep the corpus's `replace` column for the line you are about to add, before you add it.

### A dual-claim POPULATION rung is blind to correctness (D493, extending D469)

D469 established that a census measures whether a sentence is *claimed*, never whether it is claimed
*correctly*. D493 found the same blindness one layer down, at a rung that looked like a real check:

A **population** rung asserting *"exactly these N sentences are claimed by two readers"* stayed
**green** under a reader mutation that changed the derived value — because it asserts **how many
readers claim**, never **what they answer**.

**Say in the rung which layer it covers.** A population rung defends the shape of the reader table
and nothing about the numbers those readers produce; only a behavioural suite does that.

### When a sentence needs two readers, ask whether the caller already hands them the same string (D493)

`attack.ts` hands `effect` to all five damage readers. So a sentence that needs a multiplier **and** a
suppression cost **one constant and zero caller bytes** — the two readers simply both match it.

The alternative, a composition seam, would have cost a fifth splitter, a rebind in the four-stripper
chain, the `effectSimulated`/`modifierSimulated` terms, and the splitter disjointness matrix growing
6 pairs → 10 — **and that matrix would have fired**, because one shipped card carries both a leading
requirement clause and a trailing suppression clause.

**Check the caller's dispatch before designing a seam.** Two readers over one string is free when the
caller already broadcasts; a seam is never free.

⚠️ **And gate the second reader on the first.** D493's suppression arm fires only if the multiplier
arm also claims the string, so the pair cannot half-build — D445's `.test()`-beside-an-`.exec()`
defect, answered by asking the arm that owns the guards.

### `OPAQUE` means UNCLASSIFIED, never EXPENSIVE (D494, confirming D463)

D494's row was filed `OPAQUE` — the census class for *"no deletion and no substitution this
instrument can make reaches a built string"* — and it cost **less** than the `COMPOUND-head` row
built one slice earlier.

The reason is mechanical, not a coincidence: `residue-census.ts`'s three probes are all
**single-region**. This row's edit to a built string needed a quantifier substitution **and** a type
substitution **and** a tail removal — **three separated points** — so no single-region probe could
reach it, whatever its cost.

🛑 **Never read `OPAQUE` as a price.** It reports the instrument's reach, not the row's. This is the
second time in one run that an `OPAQUE` row turned out cheaper than a classified neighbour.

### A killer set named from a suite's NAME is a lie in the over-broad direction (D494)

D494 credited `typedEnergyThreshold.test.ts` with killing a `conditionHolds` arm because the name
matched the subject. **It kills neither row and contains zero references to the member.** The real
killers were two shipped suites that had been discriminating that line since D193/D376 and had never
been credited with it.

**Hunt one suite at a time and record what actually goes red.** A killer set assembled by name is
wrong in the direction that hides work: it credits a suite that does nothing and leaves the suites
that do the discriminating uncredited — which is D474's *driven-but-unpinned*, arriving through a
naming shortcut rather than through an omission.

### The self-reference rule fires on the LITERAL, never on the PATTERN (D494, a precondition on D488)

D488 established that a prose census of exceptions is self-referential the moment it is written down
— the paragraph counting occurrences becomes one. D494 found the precondition nobody had stated.

A paragraph that writes its command with an **escaped** pattern (`0\.389\.0`) does **not** contain
the literal it counts, so it does **not** count itself. D494's first draft declared the next
exception list would be two, counting itself; running the command afterwards returned the smaller
number.

**Before applying D488's rule, check whether the note's own text matches the literal or only the
pattern.** And ⚠️ **the inherited total may still be short**: D493's note said 92 where the truth was
93, the 93rd being that note's own sentence — the rule firing *inside the paragraph that warns about
it*. **Re-measure; never inherit.**

### An axis whose printed value already builds is degenerate — including a PREDICTED axis (D494, re-earning D491)

D491 established the rule for axes someone names. D494 earned it again on an axis someone
**predicted**: a work order said *"expect at least one more axis"*, and the obvious candidate
(the damage amount) turned out to be a **capture on an anchor that already builds**. A 2⁴ table would
have been the 2³ table reported twice.

⚠️ **And check whether the extra dimension is an AXIS or a VALUE.** D494's third axis was
three-valued (`absent` / `Weakness` / `Weakness or Resistance`) — the richness lived *inside* an axis
already counted, not beside it.

🛑 **A corollary about hedges.** For six slices this loop's hedged claims were the accurate ones and
its confident claims failed. At D494 the inverse held exactly: every confident measurement was right
and the single hedge was wrong. **Treat "the hedged claim carries" as a tendency worth checking, not
a rule to lean on** — the useful discipline is measuring, not calibrating confidence about who was
confident.

### A family can be BUILT, GREEN and CENSUS-COMPLETE while being executable by nothing (D495)

`bun scripts/mutation/run.ts --decision D142 --allow-dirty` prints **"No mutants selected."** So do
`D144` and `D148`. D142's gated-prevent family is **19 legal printings — the largest single mapping
in D134's census — and no mutant row has intersected it by span for roughly 350 decisions.** Every
green whole-corpus sweep in that span said precisely nothing about it.

🛑 **The census cannot see this and neither can the sweep.** A census reports whether a sentence is
*claimed*; a green sweep reports that every row that exists was killed. **Neither reports that no row
exists.**

**`--decision <D>` printing "No mutants selected" is the cheapest audit in the toolkit, and nothing
runs it on a cadence.** Sweep every decision id for it once, and treat an empty result as a finding
rather than as an absence of news.

⚠️ **Measure the gap by SPAN, not by op name** (D453). A family can have rows that mention it in
prose while nothing mutates the lines that implement it.

### A WEIGHT-1-ONLY lattice is a distinct warrant for a whole-sentence anchor (D495)

D489, D490 and D494 each produced a lattice with exactly one built point at **full** weight — *no
proper subset builds*, so the anchor is justified because nothing smaller is claimed.

D495 produced the opposite: built-by-weight **0/1 · 2/2 · 0/1**. **Every segment of the print is
already claimed and only the combination has no reader.** There is no prerequisite half and no proper
superset to compose from, which is a *different* justification for the same conclusion.

**Report the built-by-weight vector, not just the verdict.** Two lattices that both end in "ship an
anchor" can say opposite things about why, and the difference is what a later slice needs.

### Enumerate a gated family by BOTH faces of its gate (D495)

A `^Flip a coin\. If heads, ` pattern cannot see a row that opens *"Flip a coin. **If tails**, this
attack does nothing. **If heads**, …"*. D495's work order miscounted the family for exactly that
reason — the conclusion survived, the enumeration did not.

**Match on the gate, not on one of its faces**: `/^Flip a coin\. If (heads|tails), /`. The same
applies to any two-armed construct where one arm may be spelled first.

### A recorded refusal that quotes a PRICE needs the price re-derived, not just the claim (D495)

D490 established that a recorded refusal can be stale and D491 that it can be answering a different
question. D495 adds the third failure mode: **a refusal whose reasoning is a cost estimate**, where
half the estimate is real and half is not.

The refusal priced this row at *"a seed sweep **and a fourth fixture**"*. The seed half was real —
the target suite pins a seed-free claim, so the board belonged in a new file. **The fixture half was
wrong**: D452's file-local `cardPool` idiom keeps a demonstrator out of `FIXTURE_POOL` entirely, so
the pool-size pin, an eleven-deep `ids.length` ladder and a derivable sweep all took a **zero** term.

**Re-derive each term of a quoted price separately.** A price is a conjunction, and conjunctions rot
one clause at a time.

### D463's eaten-minus-sign trap does not fail loudly (D495)

A front-term splice whose marker *includes* the `- ` produces `resolving.length - - 1 /*D495*/ 1
/*D494*/…`. **`git diff` looks plausible.** The suite does not go red in a way that names the cause:
what surfaced it was a **`PARSE_ERROR` in 8 files with 210 tests silently NOT COLLECTED, while the
summary still read "15 failed."**

⚠️ **The convention already gives the correct form** — splice with a `head` that *excludes* the sign
— **and it was read and still got wrong on the first pass**, because the marker including the sign is
the natural thing to grep for.

🛑 **After any front-term pass, check the COLLECTED-TEST count, not just the failure count.** A
falling total with a plausible failure line is the signature of a parse error, and a parse error in a
census file hides exactly the assertions the pass was editing.

### Decline a rung rather than ship it vacuous — and leave an executable falsifier (D495, applying D200)

D495's first shield-interaction draft set a **made-up field** on the victim and **passed while
asserting nothing**. It was caught by **reading the draft, not by a red run** — a vacuous rung is
green by construction and no harness will complain.

The mechanism was driven by a **registry** lookup that a per-board `cardPool` clone cannot inject, so
the honest options were a wider fixture (which would have reddened another suite's boards) or a
decline.

**Declining is legitimate; declining silently is not.** The decline shipped with an executable
falsifier — every id in the deck asserted registry-free — so the day one gains a row, the rung goes
red and names the reason the decline expired.

### A PAIR of anchors needs a PAIR of probes — and no census can tell you which one is bare (D496, re-earning D463)

`preventBlock.test.ts` had driven both coin faces, both spellings and eleven behavioural sections of
its family since it was written. Its *"is anchored end to end"* rung still spelled **every**
constructed probe against `WIDE_TEXT` and **none** against `NARROW_TEXT`. Two mutants — the narrow
anchor's `^` and its terminator — **survived 481 files / 10,969 tests.**

🛑 **The reason nothing could have noticed is worth more than the defect.** Measured over all 640
corpus rows: **every single-axis loosening of all three anchors in that family claims exactly the
rows it claimed before.** `BUILT.attack`, the residue and `resolvedByAnyReader` are byte-identical
under all six mutations.

**An anchor-shape defect is invisible to every census by construction.** A census asks whether a
sentence is claimed; a loosened anchor claims the same sentences. **A constructed near-miss is the
only instrument that exists for it**, which is why these rungs are load-bearing in a way their line
count does not suggest.

⚠️ **The asymmetry inside one file is the tell.** The same slice's apostrophe axis *was* covered —
because it had a **per-anchor** rung, where the anchoring axis had a **per-family** rung written
against one member. **When auditing a family's guards, group the rungs by how many members each one
NAMES, not by how many rungs there are.** A `for (const text of [...])` sweep is what stops the count
drifting when a third spelling lands.

🛑 **And when a row survives, do not tune the row.** D496's two survivors kept their `find`/`replace`
byte-for-byte; the *suite* changed, with the survival measurement written into the rung so the
override stays findable.

### `--decision <D>` printing "No mutants selected" is a FLOOR, not the measurement (D496, refining D495)

D495 made the empty-`--decision` sweep the cheapest audit available. D496 ran it properly and found
both halves of its error bar:

- **It under-reports.** Seven ids print *"No mutants selected"* where three were expected.
- ⚠️ **It over-reports too.** `--decision D146` selects zero rows **while D146's region carries four
  `D239-*` rows**. The decision id on a row is metadata about who wrote it; **the span is the fact**
  (D453). A region is covered by whatever mutates its lines, whoever authored that.

🛑 **And `--list` ignores `--decision`** — it prints the whole corpus. A check spelled
`--decision D142 --list` answers nothing while looking like it answered.

**Measure coverage by resolving each row's `find` to a line span and intersecting against the region.**
The id sweep is how you find candidates; the span sweep is how you confirm one.

### A coverage slice must state what does NOT move (D496)

A slice that authors mutant rows and touches no engine source has a prediction with a different
shape, and it has to say so: **the residue does not move, `BUILT.attack` does not move, the census
stands still, there is no census tax, and the engine version is not bumped** — the last because
nothing a card can reach changed.

**Verify it rather than asserting it**: `git diff --name-only` should contain no engine source file,
and the version constants should be absent from the diff entirely.

⚠️ **The test count may also be unchanged and still be correct** — strengthening assertions inside
existing `it` blocks adds no tests, so there is no `it(` delta to reconcile. **Say that explicitly**,
or the next reader will hunt for a missing number.

### A foreground probe can be SIGTERM'd before its `finally` runs (D496, applying D475)

A tool timeout killed a foreground mutation probe between patch and restore, leaving a mutated
`effects.ts` that had to be restored by hand from the HEAD blob. **The tool recovers silently**, so
nothing in the normal record would have shown it.

🛑 **Prefer `setsid` for anything that patches the tree**, not only for long sweeps — the hazard is
the timeout, not the duration. And after any interrupted probe, verify the tree against HEAD by hash
before trusting a green run.

### A module namespace's key order is a property of the LOADER, not the module (D497)

`Object.entries` on an ES module namespace is **spec-sorted** under Bun's native ESM and
**declaration-ordered** under vite/vitest's SSR transform. Measured on the same bytes:
`Object.keys(effects)` arrives already sorted under `bun` and does not under `vitest`.

So a `.sort()` over that input is **a no-op in one runner and real behaviour in the other** — and
this repo reads the same function under **both** (suites under vitest, `scripts/residue-census.ts`
under Bun).

🛑 **Never reason about enumeration order from the source. Measure it in the runner that owns the
answer** — and when two runners own different answers, say which one a rung is pinning.

### "No witness exists" is a claim about a GREP, and the shape you grep for decides it (D497)

A work order reported that nothing asserted the reader surface's *contents* or *order* — having
looked for length pins. There were **~50 order-sensitive sites**, spelled
`expect(<names>.sort()).toEqual(surface())`. **`toEqual` on arrays is order-sensitive**, so a sorted
left-hand side pins order *and* membership.

🛑 **The diagnosis changes the whole slice.** *Untested* needs a witness; **driven-but-unpinned needs
ROWS** (D474). Acting on the wrong one means "fixing" a guard that already existed and shipping a
redundant rung.

⚠️ **And classify witnesses by what they can SEE, not by the fact that they exist.** Two of those
sites re-sort the surface before comparing and are blind to order **by construction**. A killer set
assembled from length-only suites lets every order mutation survive and reports a gap that is not
there.

### Both halves of a two-clause guard deserve a row, and the PAIR is the finding (D497)

For `name.startsWith("deriveAttack") && typeof value === "function"`: dropping the prefix conjunct
takes the oracle from 13 entries to 25 and the residue **to zero**; dropping the `typeof` conjunct
changes nothing, because no non-function export carries the name.

**Ship both.** One is KILLED; the other is a declared survivor with kind `unreachable-population`
that self-invalidates the day such an export appears. **One conjunct is load-bearing and one is
defence in depth, and only the pair tells you which** — which is exactly what a later reader needs
before touching either.

⚠️ **And note where the damage actually shows up.** The count is defended by ~90 assertions, so a
count-changing mutation dies instantly; the dangerous mutations are the ones that **preserve** the
count. Aim rows there.

### `equivalent` has a third kind: PURITY (D497, extending D468)

D468 named structural and guarded disjointness. A **memo over an input fixed at load** is neither:
the recomputation is a pure function of an immutable value, so no board can separate memoised from
recomputing.

**State the falsifier you checked, not the one you assume.** D497's was `grep -rn 'vi.mock(\|vi.spyOn('`
over the engine returning **0** — nothing can stub the namespace mid-run, so the input really is
immutable for the suite's lifetime. The obligation is to re-derive that the day it stops being true.

### A coverage slice should say when a region is thinner than it looks (D497)

Seven candidate mutations existed on a 16-line function and **three were unobservable today**. The
honest output is six rows plus the measurement for the seventh — not seven rows, and not silence.

⚠️ **Declining a row is a result when it carries its reasoning.** D497 recorded why
`startsWith` → `includes` was skipped (equivalent at the same count and order, probed green in five
suites) so a successor can disagree in one line rather than re-deriving it. And it declined the
realistic memo slips because they die by TypeError everywhere — **measuring the language rather than
the code** (D440).

### A boolean predicate's witnesses split by POLARITY, and each half is blind to the other mutation (D498)

`resolvedByAnyReader` has 102 calling files and 330 classified assertions, and they are not
interchangeable. **139 CLAIM-TRUE rungs can only see a NARROWING. 98 CLAIM-FALSE rungs can only see a
WIDENING.** 93 population folds see both. Measured: 12 files see narrowing only, 5 see widening only.

Driven, and exactly complementary:

| mutation | a CLAIM-TRUE suite | a CLAIM-FALSE suite |
|---|---|---|
| `.some` → `.every` (claims 529 → 0) | **RED** | green |
| `!== null` → `!== undefined` (529 → 640) | green | **RED** |

🛑 **A killer set assembled from one polarity lets the other mutation survive and reports a gap that
is not there.** **Pick one axis-PURE suite per row and name the population suite second.**

This is D438's polarity rule arriving at a **killer set** rather than at a re-point, and D497's
witness-classification lesson on a different axis: a witness count says nothing about which mutation
each witness can see.

### A one-line predicate can have NO count-preserving mutation at all (D498, bounding D497)

D497 earned *"the count is defended by ~90 assertions, so aim rows at mutations that PRESERVE the
count."* At `resolvedByAnyReader` there is nothing to aim at.

Measured over 640 sentences × 13 readers, the body admits exactly **three** behaviours — claim 0,
claim 529, claim 640 — and **both count-preserving candidates are equivalent**: `!= null` and
`Boolean(…)` each claim the same 529, because **0 of 8,320 calls return `undefined`** and 0 return a
falsy non-null.

**When a region's mutation lattice is that small, publish the lattice rather than filling a quota.**
Three rows, one of them a declared survivor, is the honest output — and two further candidates were
declined as second rows of one experiment (D484/D475).

### "Strictly a better guard" is a claim about WHICH failure you want (D498)

`read(text) != null` would refuse an `undefined`-answering reader where the shipped `!== null` admits
it — catching exactly the hazard that function's own doc block names. It is still **not strictly
better**.

Under `!== null`, a mis-enrolled reader makes the predicate claim **everything**: catastrophic, and
**loud** — 22 rungs across 5 files red in one run, which is what made D444's accident visible. Under
`!= null`, that reader contributes nothing, every census figure stands still, and the defect is
**silent at this line**.

🛑 **Before calling a stricter comparison an improvement, ask what the loose version's failure was
doing for you.** This repo's own doctrine — *flag loudly rather than guess* (D190b/D199) and *choose
the shape so that losing the information is detectable* (D421) — points away from the stricter
operator here, and the tension belongs in the row's `what` rather than in a silent edit.

### An instrument that classifies suites must strip comments, bracket-match, and be RUN AGAINST A PROBE (D498, re-earning D455)

A first-pass classifier of one predicate's witnesses got two answers wrong in opposite directions:
one suite read as a witness on a hit that is **prose inside a comment**, and another read as having
no rung because a wrapped `expect(\n …\n).toBe(…)` overflowed a fixed character window.

**Both were found by driving the prediction against a probe, not by re-reading the regex.**

🛑 **A classifier's error rate is measurable in one experiment and invisible in its output.** Strip
comments before scanning source for anything (D455), bracket-match the call rather than windowing on
character count, and **publish the classification only after a probe has confirmed it** — otherwise
the instrument built to apply a convention is the thing that violates it.

### `killedByCommand` REPLACES `expectKilledBy` — a row killed two ways can name only one (D498)

Both of D498's killed rows are independently caught by `residue-census-gate` **and** by a test suite.
The runner's row shape cannot express that: setting `killedByCommand` replaces the suite list rather
than adding to it.

**Record the unnamed killer in prose** — in the decision's header comment or the row's `what` —
rather than losing it. A successor re-pointing the row will otherwise believe the named killer is the
only one, and may weaken a guard that two instruments were holding.

### A refusal scoped to a CARRIER is not a refusal of the sentence (D499)

D142 recorded that this row needed *"a SECOND consequent on the same flip"*, four suites carried the
refusal, and one called it *"a durable witness rather than a treadmill"*. It stood for **57
decisions**. **Every clause was true of `deriveAttackEffect` and false as a claim about the engine.**

That reader's program runs at the **tail**, after §8.5 — so an `otherwise` arm cannot retract damage
already dealt, exactly as the block said. But `deriveAttackCoinFlip` is read **~1,000 lines earlier,
in front of §8.5**, and can.

🛑 **The disproof is one question, and it is cheap: WHICH CARRIER IS READ AT THE SEAM THE RULE
RESOLVES AT?** Ask it of every recorded refusal before pricing the row it guards. *"No widening of
any anchor in THIS family can reach it"* is the hardest form to see, because the scope qualifier is
doing all the work and reads like emphasis.

✅ **And note what a correctly-scoped refusal buys**: because D142's was about a carrier rather than
the sentence, **five shipped `toBeNull` witnesses stayed green and armed** through the build. A
refusal that overreaches takes its witnesses down with it.

### A third lattice shape: the PREREQUISITE HALF (D499)

Three shapes are now on record, and they say different things:

- **D489/D490/D494** — one built point at **full** weight: *no proper subset builds*, so nothing
  smaller is claimed and an anchor is warranted.
- **D495** — built-by-weight `0/1 · 2/2 · 0/1`: **every segment builds** and only the combination has
  no reader; no prerequisite half and no superset to compose from.
- **D499** — built-by-weight `0/1 · 1/3 · 0/1`: **one built point at weight 1**, reached by deleting
  a segment whose complement is *itself a printed corpus row*.

**The third says the blocker is the JOIN**, which is a **seam** question — and that is why D499's
answer was a new member on the reader that owns the seam rather than a whole-sentence anchor.

**Report the built-by-weight vector, not the verdict.** All three end in "ship something"; only the
vector says what.

### The two-reader idiom is free only when neither reader consumes a RESOURCE (D499, bounding D493/D494)

D493 and D494 shipped sentences claimed by **two** readers over one anchor, because `attack.ts` hands
the same `effect` string to all five damage readers — one constant, zero caller bytes.

**That is free only when the readers are pure.** Here both consume `state.rngState`, and `attack.ts`
runs both blocks unconditionally — so a dual claim spends **two rng steps and emits two coin-flip
rows for one printed flip**, and the two faces can disagree.

🛑 **Before reaching for the idiom, ask what each reader SPENDS.** And when a single printed flip must
drive two consequences, assert the resource directly: D499 drove `rngState` to be **byte-identical to
the sibling's on the same seed, on both faces**, with seeds searched rather than stubbed.

### A first-probe survivor must be discriminated with `--only … --full` (D499, applying D455)

D499's first probe returned one GAP. The cheap reading is *"my killer set is too narrow"*. The
measured reading required running the single row against the **whole suite**: it survived **482 files
/ 11,001 tests**, so the killer set was not the problem — the anchor's `^` had **zero rows
intersecting it by span for 373 decisions**.

**Measure the absence by SPAN, not by decision name** (D453), and then **fix the suite, not the row**
(D496): D499's row stayed byte-for-byte and the suite gained a constructed prefix.

⚠️ **Dispatch ORDER is what makes a sibling anchor's terminator observable.** Two whole-sentence
anchors are structurally disjoint while both keep their terminators; reading the one that *can* widen
first is what turns its loosening into a red rung instead of a survivor.

### An agent can die mid-slice and leave a COMPLETE, green tree — verify before assuming it is partial (D500, applying D410)

D500's builder terminated on a server-side 500 and wrote no report. Its last words were that it was
mid-repair, which reads like a half-finished slice. **It was not**: `bun run check` was green at
483 files / 11,024 tests, `precheck` was clean, every gate passed, and the decision probe returned
7 killed / 0 survivors / 0 GAP.

🛑 **Verify the state before deciding what it is.** The full check is cheap and it is six things:
`bun run check`, `precheck`, every gate, the decision probe, `tmp/mutation-journal.json`, and `ps`
for a live harness. Any one of them alone can mislead.

✅ **And the reasoning was recoverable, because this loop pins it in the SUITE rather than narrating
it.** The lattice vector, the degeneracy argument and the separating board were all readable out of
the new test file and the doc blocks. **That is the assertions-as-the-record discipline paying for
itself under a failure mode it was not designed for** — and it is the strongest argument for writing
a measurement into a rung rather than into a report.

⚠️ **Name what the lost report cannot tell you, rather than implying it was said.** D500's branch
pricing, tripwire audit, witness load and `MATCH_RECORD_VERSION` argument were never written down.
The version is unchanged and the gates agree, but **no argument for it is on record**, and the
decision row says so. A successor must re-derive it. **A gap in the record is a finding; a gap
papered over is a lie with a date on it.**

### A fourth lattice shape: the SINGLE-AXIS sentence (D500)

Four shapes are now on record, and the vector is what distinguishes them:

| shape | vector | what it says |
|---|---|---|
| D489 / D490 / D494 | one built point at **full** weight | no proper subset builds |
| D495 | `0/1 · 2/2 · 0/1` | **every segment** builds; only the combination has no reader |
| D499 | `0/1 · 1/3 · 0/1` | a **prerequisite half**; the blocker is the JOIN |
| **D500** | **`0/1 · 1/1`** | **one axis carries the whole blocker** |

D500's candidate axis list had four entries and **three were degenerate** — each one's printed value
already builds on an otherwise-built sentence, so substituting it changes nothing.

🛑 **The honest table was 2¹, and saying so is the finding.** A 2⁴ table would have been the same
table reported eight times, which is D491's degeneracy rule arriving at the table's *size* rather
than at a single axis.

### When a printed noun names a CARD CLASS, count CARDS and not what they PROVIDE (D500)

*"For each Basic Energy attached"* is not *"for each basic-type Energy provided"*. **A Special Energy
card can provide a basic type**, so the two readings diverge on a real board — and the shipped
attached-counter counted provisions.

**The separating board needs a card of the other class that provides the type in question**, plus a
control of the same class that does not. D500 fields both, so the reading is pinned by a board rather
than by an argument.

⚠️ **And reuse the shipped arm for the noun** (D159: one noun, one answer). D500's new category value
asks `matchesFilter`'s existing `basicEnergy` arm rather than writing a second reader of the same
printed word — which is what keeps the two surfaces from drifting apart later.

### A first-probe survivor has THREE diagnoses, not two (D500, extending D455/D499)

D455 gave *narrow killer set*; D499 gave *real suite gap*, discriminated with `--only … --full`.
D500 adds the third: **the row is INERT ON THE BOARD THE SUITE FIELDS** — the mutation is observable
in principle, but nothing in the fixture pool can reach it.

The remedy differs from both: not a wider killer set, and not a new rung on the same board, but **a
fixture that can express the difference**. D500's needed a wildcard provider.

🛑 **Distinguish the three before acting.** Widening a killer set for an inert row hides the fixture
gap; adding a fixture for a genuinely narrow killer set is wasted work.

### A precedent at the same ADDRESS is not a precedent for the same QUESTION — date it before citing it (D501)

D501's work order instructed the builder to *"check what `poisonDamage` did about this — it is the
shipped precedent at the same address, so whatever argument it made is the one to re-derive rather
than reinvent."*

**`poisonDamage` made no argument.** It landed **2026-07-14**; `apps/api/src/lobby/match.ts` did not
exist until **07-23**; `MATCH_RECORD_VERSION` first appeared **07-26**. The sibling predates record
versioning by twelve days. It is a precedent for the **shape** — amount on the condition, counters
converted at the producer, an optional op rider against a rule constant — and **silent on the
constant**.

🛑 **The phrase "at the same address" concealed the difference, and the failure mode is worse than a
dead end**: a builder can infer *"the sibling didn't bump, so neither should I"* from an absence that
means nothing at all. That is D476's hazard — the citation's content contradicting the sentence
citing it.

**Run `git log -S` on the precedent and compare its date against the mechanism you are asking it
about.** A precedent that predates the question cannot have answered it.

### Ask what the OPTIONAL shape would DISARM, not only what it would mean (D501)

D501 needed a new key on a record persisted in `MatchRecord.state`. The optional road was genuinely
available: D441's discriminator answers yes (absent would read as the default, and every old record
*did* mean the default), and D434's *"the rest must be old"* was satisfied — only the second time on
record.

**What decided it was a shipped compile-time guard.** Two `satisfies SpecialConditions` sites exist
precisely so that an added engine field is *a compile error rather than a silent drop*. **An optional
key satisfies both while reaching neither surface** — it would have silently disarmed the two
instruments written to catch exactly this class of omission. Both guards fired on the required-field
edit; **that is evidence, where the rule was only an argument.**

⚠️ **And a fourth position in the degradation sequence.** D432 *no rest to carry the meaning*; D434
*rest not old*; D435 *rest old but the degradation is NaN*; **D501 *rest old, option available, and
the rest cannot witness the loss*** — the sibling keys were byte-identical at both values, so nothing
in the record could reveal which one was meant. Driven: the board computes `damage + undefined` →
`NaN`, `NaN >= hp` is false, and the body **can never be Knocked Out again on a board that looks
entirely normal.**

### Grep every READ SITE of a constant before changing it (D501, applying D412)

D501 made a hard-coded confusion self-damage configurable. Grepping the read sites first found a
**live false claim to players**: the HUD printed *"Confused: attacking flips a coin — tails: 30 damage
to itself"* off the rotation alone — wrong at the exact moment a player decides whether to attack —
plus two prose claims in `events.ts` and `log.ts` asserting *"the 30 self-damage"*.

🛑 **A constant that was true becomes a lie the moment it becomes configurable**, and the lie lands
wherever someone quoted it rather than read it. **Enumerate the readers before the edit, not after
the tests pass** — none of these three would have reddened anything.

⚠️ **And check the surfaces separately.** D501 fixed the local HUD and left the online one with no
hint at all, which the decision row records: **the asymmetry existed before the slice and only
started to matter because of it.**

### Run the bare-token census FIRST — its output may be the decision not to use a value-keyed pass (D501, sharpening D492)

D492 established that a bare `toBe(N)` replacement is unsafe for small literals. D501 shows the
cheaper move: **count the token repo-wide before choosing the method.**

Its two census literals matched **186** and **243** times across the repo. That number is not a
warning to be careful — it is the answer: **every literal was patched by line number**, each with a
one-occurrence-in-region assertion, and no value-keyed pass was attempted at all.

**The census is a decision procedure, not a hazard check.** Run it first and let the count pick the
method.

### A lattice can be EMPTY at every weight — a sixth shape, and a claim about the FAMILY (D502)

D502's whole-sentence 2⁴ read `0/1 · 0/4 · 0/6 · 0/4 · 0/1`: **no built point at any weight, and all
four axes flipping a verdict at 0 of 8 cells.**

🛑 **Stop reading that as a statement about the axes and read it as one about the SEAM.** The §9.2
gate family is **7 sentences / 9 printings**, every one claimed whole by an anchor that welds its own
head, **with no composition path at all** — so the honest whole-sentence table is **2⁰**, and the
informative lattice was the **tail's own 2³** (`0/1 · 0/3 · 0/3 · 1/1`, no degenerate axis).

**When every axis is inert, the next question is which sub-expression has a live lattice**, not which
axis was miscounted.

⚠️ **And a degenerate axis makes the point set smaller than the bit set.** Sixteen bit-points were
**eight distinct strings**, so an instrument collecting "the points the new anchor claims" into an
array rather than a Set reports the print twice — which D502's first draft did, and it went red.

### Read the ARITY question at the FLOOR, not at the candidate count (D502)

Pinning a destination reduced a parking op's decisions from two to one and left `destinations` at
length 1 — which looks exactly like the forced arm D441 added, and is not. **That force is gated on
the FLOOR**, and the printed determiner *"move **an** Energy"* gives `max: 1` → floor 0, so **the
decline is still an answer and the op still parks.**

**Ask what the remaining ANSWER set is, not what the remaining CANDIDATE set is.** A single candidate
with a declinable floor is still a question; a single candidate with a positive floor is not.

### The complement of a shipped field is not a field you can invert (D502)

D502 needed to pin a destination to a recorded uid, and the shipped near-relative was an `exclude`
that *removes* recorded uids from a candidate set — the same shape in the opposite polarity. It could
not be reused, on three counts, and the order of the checks is the lesson:

1. **Supply first.** An inverted `exclude` needs a producer for the inverted set, and no op files the
   complement of its own answer. **That is one grep.**
2. **Then the value KINDS** — one subtracts uids from uids of the same kind; the other maps a card
   uid onto the body carrying it, which the first has no analogue for.
3. **Then the direction of the LOSS** — a dropped `exclude` widens an offer; a dropped pin widens one
   destination to a whole zone, and only the second changes which body the sentence is about.

### A refusal whose BOTH clauses survive re-derivation is worth saying out loud (D502)

Five consecutive slices found an inherited price naming something already built, so the habit became
to report the falsification. D502's did not falsify: D230's two-clause refusal was **true in both
halves** at this head.

**Record that explicitly.** A run that only ever publishes its corrections teaches its successors
that recorded prices are unreliable, when the actionable fact is the opposite — *this* one was real,
which is why the row was worth building now rather than deferring again.

### Placing a new anchor is a decision about ANOTHER decision's row (D502)

Two `^…$` anchors with different mandatory byte runs are structurally disjoint, so their order is
legibility — **until a terminator goes.** `D230-anchor-drops-the-tail` names D502's printing as its
real witness, and reading the head anchor **first** is what keeps that mutation observable; ahead of
it, the mutation goes inert on the one card the row cites and a shipped row's stated reason quietly
becomes false.

🛑 **Before choosing where a new arm goes, grep the mutant corpus for rows whose `what` names the
sentence you are about to build.**

### `tsc` over `scripts/` catches what `precheck` and a probe cannot (D502, D481 paying out)

Twenty-one D502 rows emitted a one-element **array** where `what` takes a string. **`precheck` was
clean. The probe ran all twenty-two and reported 20 killed / 2 known.** The runner reads `what` only
to print it, so nothing in the mutation toolchain can see the error — **`bun run check` was red in
seconds.**

**D481's closed hole is the only thing standing between a data error in the mutant corpus and a
green gate**, and this is the first slice caught by it rather than by a sweep. ⚠️ **A green probe is
not evidence that the rows are well-formed** — only that they patch and run.

### The tripwire audit's needle list must include the CENSUS CONSTANTS (D502)

`D495-census-built-attack-not-stepped` quotes the current `BUILT.attack` literal — **`"  attack: 1617,"` at this head, and D502 recorded it as `1616`, which was already stale when written** — and it **rots on every census step**,
in a test file that no code region of a reader slice touches. D502's audit used twelve name-needles
and seventeen span regions and **missed it**; `precheck` found it in seconds.

**Predict it**, the way D501 learned to predict `D326-record-version-not-bumped` across a version
bump. A row whose `find` quotes a number that every slice moves is a standing rot, and the audit
should name it before the build rather than discover it after.

### Run the lattice over the RESIDUE PREDICATE, not over the readers alone (D503)

D503 ran both and they disagreed about the slice:

| lattice | vector | what it says |
|---|---|---|
| the 13 readers only | `0/1 · 0/3 · 0/3 · 0/1` | D502's empty shape — *"the seam has no path"* |
| **readers + splitters** | `0/1 · 0/3 · 1/3 · 1/1` | *"the seam HAS a path, and one reader's refusal is the only guard"* |

**Opposite conclusions from one sentence, and only the second is actionable** — it is what exposed a
composition road that was completely unguarded.

⚠️ **Every lattice this run has reported was readers-only**, so the six recorded shapes may each be
missing a splitter dimension. **Re-run one whenever the answer would change what you build.**

### "The order is unobservable on today's column" can be CIRCULAR (D503)

`attack.ts` carries an honest placement comment: *"no printing carries both … so the order is
unobservable on today's column."* The column **does** print the pairing — D503's row is the only one,
measured — and the order is unobservable **only because that sentence is unbuilt, and it is unbuilt
because of the order.**

🛑 **When a placement comment cites the pool as its warrant, check whether the pool's silence is
caused by the thing being excused.** The comment is not wrong; its warrant is self-sealing, and a
successor reading it as evidence will conclude the question is settled when it is merely closed.

⚠️ **Related**: the same file's invariant *"one `preDamage` and one `program` can never both be
non-null"* is **true in its literal form and false in its stated reason** — *"the readers are
whole-sentence anchored and disjoint by construction"* was already falsified by three sentences /
five printings built deliberately. **A true conclusion can sit on a rotted premise, and the premise
is what a successor reuses.**

### A reason can be TRUE UNDER A NARROWER READING THAN ITS WORDS CARRY (D503, a fourth mode)

D479 named three ways a recorded reason fails: **false when written**, **rotted since**, and
**reason-only** (the verdict holds, the stated cause does not). D503 found a fourth.

*"An unbounded count"* reads as a missing capability, and the capability has shipped since D247. The
verdict was still correct — the real blocker is a **pincer**, where one op has the unbounded count
but no destination narrowing and the other has the narrowing but a numeric count, so **neither op has
both halves**. The words were true of one op and false of the engine.

**Re-derive a reason at the precision a builder would act on**, not at the precision that makes it
sound right. A reason that is true-but-imprecise sends a successor to widen the wrong op.

### Count refusal witnesses by which BUILD ROAD each can see (D503)

Two witness files named D503's sentence, and they are **complementary, not redundant**: one asserts
the effect reader is null and catches the composition road only; the other asserts the two damage
readers are null and catches the vocabulary road only. **Neither covers both.**

**When re-pointing or pruning refusal witnesses, map them against the roads a build could take.** Two
witnesses that look like duplicates may be a partition, and deleting either opens a road silently.

### Re-derive a census literal from the module, never from a convention (D503)

`D495-census-built-attack-not-stepped` quotes the current `BUILT.attack` literal in its `find`, so it
**rots on every census step**. D502 recorded that row's literal in a convention entry as `1616`; it
was **1617** at the time of writing and the entry was stale on arrival.

🛑 **A convention that quotes a moving number is a convention that will be wrong.** Name the row and
the mechanism — *"it quotes the current `BUILT.attack` literal"* — and let the reader derive the
value. D503 corrected D502's entry in place.

### Quote the harness line VERBATIM — the token is `GAP(S)`, capital S (D503)

`scripts/mutation/run.ts` prints its summary as:

```
<n> killed · <n> known survivor(s) · <n> GAP(S) · <n> stale · <n> skipped(dirty) · <n> clobber(s) · <n> error(s) · <n>s total
```

**`GAP(S)` has a capital S, and has since D211's first commit** — `git log -S 'GAP(s) ·' --
scripts/mutation/run.ts` returns nothing, i.e. the lowercase form has never existed in the harness.

At D503's close-out the archive was found to quote it lowercase **311 times in `progress.md`** and
**144 times in `decisions.md`** — **455 in all**, spanning every "EXACTLY AS PREDICTED" claim on
record. (Occurrences, excluding five deliberate meta-mentions that name the lowercase form as their
subject.)

⚠️ **The first close-out of D503 recorded 444, and that was wrong**: it summed `grep -o`
OCCURRENCES for one file against `grep -c` LINES for the other. **A token that can appear more than
once on a line must be counted with `grep -o | wc -l`, never `grep -c`** — and a total assembled
from two different counting methods is not a total. Fixing a transcription defect with a miscounted
census is the same class of error one level down.

**Why this is more than a typo.** Each stamp presents a string as *the run's output*. That string
was never the run's output. The **numbers** in those claims were right every time and are
re-derivable from any log — but the **verbatim** claim was false, so **no recorded prediction could
ever be checked against its log by string comparison**. And nothing caught it for 64 slices because
nothing was looking: no mutant row quotes the token, no gate parses the summary line, no test
compares a recorded prediction to an emitted one.

**This is the D496–D498 blind spot one level up.** A census reports whether a sentence is claimed; a
green sweep reports that every row which *exists* was killed; **neither reports that the prose
DESCRIBING the run is accurate.** Instrument output that is transcribed by hand into prose is
unguarded by construction unless something compares the two.

**The rule:**

1. **Copy the summary line out of the log — never retype it.** `grep -E '^[0-9]+ killed · '` the
   log and paste what it prints.
2. **A guard over recorded lines must assert against `run.ts`'s own format string**, not against a
   hard-coded copy of it — a guard holding its own literal inherits exactly the defect it exists to
   catch, and the two drift together silently.
3. Nothing functional depends on the casing (verified at D503: no `find`/`replace`, no gate, no
   test), so correcting the archive is a textual fix — but **land the guard first**, so it is seen to
   fail and then pass. `progress.md` is itself the target of eight `D318-*` rows, so re-run
   `precheck` after any bulk rewrite of it rather than assuming the rows are untouched.


### The instrument that DEFINES a class must be the one that ENUMERATES it (D504)

D503 found that the archive quoted the mutation harness's summary field with the wrong capitals,
measured the damage by grepping that one token, and reported **455 places**. D504 then built a guard
that parses `run.ts`'s template and compares every recorded line against it — and it immediately
found **9 more defects of exactly the same class**: six `ERROR(s)` where the harness prints
`error(s)`, one line spelling `KILLED`, and three bare `GAP`s.

**The census was not careless; it was structurally blind.** Grepping one token can only ever report
that token. Nothing in that method could report a *sibling* token being wrong, because the method
never knew the field list existed.

**The rule:** when you find a defect that belongs to a class — one wrong token out of seven, one
stale citation out of forty, one unguarded reader out of thirteen — **do not measure the class with
an instrument that can only see the member you happened to notice.** Derive the class from its
definition (here: the harness's own format string) and enumerate against that. If you cannot, say
that the number you are reporting is a **floor**, and say what it is a floor of.

Corollary, learned the same day: `-harness-known-field-renamed`'s floor drops 474 → **243**, not 0.
A floor that collapses to zero under a mutation was measuring the mutation; one that collapses
partway is measuring something real.

### Every reported count must name its unit (D504)

D503's close-out reported **444** lowercase instances. The number was assembled from
`grep -o … | wc -l` (**occurrences**) for one file and `grep -c` (**lines**) for another. The true
figure was **455**.

One slice later, inside the very work built to fix that, it happened again in a milder form: the
builder reported **464** and the caller counted **465**. Both were right — **464 places, 465 token
edits**, because one line carried two wrong tokens.

**The rule:** a bare count is ambiguous between *occurrences*, *lines*, *places* and *edits*, and
prose that says "444 instances" hides which one it means. **Name the unit in the number**
("464 places / 465 token edits"), and **never sum two counts produced by different methods** — a
total assembled that way is not a total. When the unit is genuinely places-with-possible-multiples,
report both.

### `grep` here is `ugrep`, and it returns nothing for an untracked file (D504)

During D504's verification, searching the newly created suite returned **no output at all** — not an
error, no match, silently. The file existed with 521 lines. `grep` in this environment is `ugrep`,
which skips files git does not track.

**A silent empty result from a search tool is not evidence of absence.** When a search over a file
you just created comes back empty, check the file exists and is non-empty before concluding anything
about its contents. Use Python (`io.open(...).read()`), or `git add` the file first. This matters
most in exactly the situation it arose: verifying that a new guard does *not* contain something.


### A seventh lattice shape: ONE BLOCKING AXIS × A FREE 2⁴ (D505)

D505's five-axis sentence read the same vector under both predicates:

> `0/1 · 1/5 · 4/10 · 6/10 · 4/5 · 1/1` — **16 of 32 points build**, and the two readings
> agree at every weight with **0 divergent points** (both splitters null at **32/32**).

**Read the arithmetic, not the table.** Exactly half building is the signature of a lattice that
FACTORISES: one axis flips the verdict at **16 of 16** cells and the other four at **0 of 16**
each, so the bit set is 32 and the meaningful point set is **2**. That is distinct from all six
shapes on record (full-weight-only D489/D490/D494/D501; every-segment D495; prerequisite-half
D499; single-axis 2¹ D500; empty-at-every-weight D502; D503's opposite-conclusions).

🛑 **AND IT IS A CLAIM ABOUT THE PRICE.** A single blocking axis on an otherwise free lattice is
the shape of a row whose mechanism already ships — the blocker is a NAME, not a machine. D505's
cost was one anchor, one arm, one optional boolean and one argument list; the four inert axes were
already spelled by the sibling anchor one screen up. **When a lattice halves, look for the
missing cell of a table rather than for a new op.**

⚠️ **INERT IS NOT DEGENERATE, AND THE DISTINCTION IS WORTH ASSERTING.** D491's degeneracy is
identity — the axis's two values are the SAME STRING, so the table is a smaller one reported
twice. D505's four are distinct strings (all 32 points are distinct, asserted) that never move
the verdict. The second is a statement about the READER; the first is a statement about the
instrument.

### A lattice run in the same commit as the build must subtract the build by its RIDER, not its ANCHOR (D505, sharpening D491)

D491 established that a post-build lattice is not the lattice. The executable form needs a
predicate for *"the points my new arm claims"*, and the obvious one is the anchor. **Key it on the
derived VALUE instead** — D505 used *"the program is a `spreadDamage` carrying `perTakenPrize`"*.
Two reasons: the anchor is usually module-private and not importable, and a successor who widens
the anchor across a point the lattice recorded as refused is caught by the same rung rather than
slipping past a name. Pair it with the converse assertion — *the claimed set is EXACTLY these N
points* — or the subtraction is circular.

### A price that cites a sibling's PRINTING COUNT is a claim about today's column (D505)

D448 built the `1 of … Benched Pokémon for each Prize card your opponent has taken` arm for
Wo-Chien ex `sv02-027`. At D505's head **that sentence is not a row of the `legal_standard = 1`
column at all** — the clause appears on five corpus rows and none is that spelling. So a shipped,
green, census-complete arm was executable by nothing in the legal pool (D495's shape), and any
price reading *"the scaled snipe already ships at 3 printings"* was counting a rotation ago.

**An arm transfers across sets and a registry row does not (D180/D187), so this is not dead code.**
What rots is the *number* beside it. ⚠️ **Before leaning on a sibling row's size, re-run the
membership** — `legalAttackCorpus()` is one call, and a `Map.get` returning `undefined` where a
count was expected is the whole check.

### A refusal can be true in every clause and still wrong, when one clause reads a PERSISTENCE fact as an EXPRESSIVENESS one (D505, extending D450/D451)

`scaledAnySnipe.test.ts` refused D505's row with: *"its op is `spreadDamage`, which is
`{target, amount}` and carries NO scaling field at all **and no park to hang one on**;
`perTakenPrize` and `perEnergyOnSelf` are `damageChosen` riders and do not transfer."* Every
clause described the head correctly. Two of them do not support the conclusion:

- **"do not transfer"** — a rider does not have to transfer, it has to be SPELLED on the second op.
  `snipeAmount` takes a STRUCTURAL parameter, so the fold accepted the widened op unchanged.
- **"no park to hang one on"** — not parking is exactly what made the rider FREE of
  `MATCH_RECORD_VERSION`. The clause named the reason the row was CHEAP and filed it as the
  reason the row was blocked.

⚠️ **The tell is a refusal whose clauses are all about SHAPE and none about the machine that reads
the shape.** Ask what the consumer's signature actually takes before believing that a field cannot
reach it.

### A mutant row's ARITHMETIC and its stated CLAIM can drift, and only a step of a different SIZE makes it visible (D505)

`D495-census-built-attack-not-stepped` says it puts `BUILT.attack` *"back to its pre-slice value"*.
D499's note spells that out in arithmetic. D501 and D502 both stepped the constant by **+1** and
both re-transcribed a **two-step** regression, so for two slices the row's arithmetic and its own
`what` disagreed and nothing could tell — at a step of 1 the difference between *"pre-slice"* and
*"two back"* is one digit that reads like a convention. **D505's step is +3, which is the head
where the divergence shows**, and the replace was corrected to the genuine pre-slice value.

**A row whose `replace` is derived from its `find` by a fixed offset has stopped being about what
it says it is about.** When re-transcribing, re-derive the offset from the row's `what`, not from
the previous transcription.

### D497's pair rule, paid on a SHIPPED switch (D505)

`spreadDamage`'s victim `switch` has two arms. D425 wrote a mutant for `yourBench` — the arm ONE
producer takes — and none for `opponentBench`, which every other producer takes, and the corpus
carried that asymmetry for eighty decisions. `opcoverage.ts` had been reporting the consequence
all along (**2/5 seat-line coverage, the weakest of the damage ops**) without anyone reading it as
*"one arm of a two-arm switch"*.

⚠️ **When you widen an op, diff its mutant rows against its BRANCHES, not against its fields.** The
missing row is usually the branch the shipped producers all take, because that is the branch every
existing board already exercises — so its absence never shows up as a red test.

### `OPAQUE` is a function of `SUBMAX`, not of the sentence — re-run the census before calling a row deep (D505, confirming D463 with a curve)

`scripts/residue-census.ts` classifies a residue row `OPAQUE` when no bounded multi-region edit
reaches a built string. The bound is `SUBMAX`, an env override that **defaults to 4**. Measured at
D505's head:

| `SUBMAX` | OPAQUE |
|---:|---|
| 4 (default) | **63 sentences / 92 printings** |
| 8 | 51 / 74 |
| 12 | 33 / 51 |
| 20 | **12 / 21** |

**Four fifths of the OPAQUE class is an artefact of the default cap.** D463's rule — *"`OPAQUE`
means UNCLASSIFIED, never EXPENSIVE"* — now has a measured curve behind it.

**This is not academic: the default hid the cheapest row in the residue.** D505's row
(`censusAttackCorpus.ts:517`, 3 legal printings) is `OPAQUE`/`UNEXPLAINED` at `SUBMAX=4`. At
`SUBMAX=12` the census classifies it itself:

```
SUBST 10 token(s): «Pokémon for each Prize card your opponent has taken.» → «Pokémon.»
  onto BUILT (reader): This attack also does 10 damage to each of your opponent's Benched Pokémon.
```

One substitution onto an already-built reader string — a deletion with the period re-attached. And
the substituted span **is exactly the lattice's single load-bearing axis**: two instruments that know
nothing of each other isolate the same lone blocker.

**The rule:** before concluding a row is structurally deep, re-run the census at a larger `SUBMAX`.
A row that is `OPAQUE` at 4 and `SUBST-n` at 12 is **cheap and mislabelled**, not hard. When
reporting an OPAQUE count, **name the cap it was measured at** — the bare number means nothing
without it.

### A figure called a "ceiling" must carry its derivation and its unit (D505)

For roughly twelve consecutive resume points the loop carried *"the practical ceiling is ~88 %"*.
At D505 it was checked and **could not be re-derived from any instrument**. What it approximates is
the **current built-sentence percentage** — 559/640 = **87.3 %** at D505's head, and 86.4 % at D493
where the wording was coined. It is a *current value*, mislabelled as a *limit*, copied forward and
slowly diverging from both.

The honest figures, each with its unit:

- built attack **sentences** 559/640 = **87.3 %**
- built attack **printings** 1617/1732 = **93.4 %**
- the real **ceiling** — structurally-blocked rows removed (`BLOCKED-*`, 14 sentences / 25
  printings) — is 626/640 = **97.8 %** of sentences

Likewise *"about 67 sentences of reachable work"* is arithmetically right (81 − 14) and materially
misleading: **13 of those 67 are `Ancient`/`Future`/`Tera` banner rows** that have been off the table
for 41 slices. **Reachable-and-not-banner is 54 sentences / 73 printings.**

**The rule:** a percentage in a resume point must say **what over what**, and a number called a
ceiling must state **what it excludes to be one**. A current value that drifts while its label says
"limit" is worse than no number, because it silently answers "how much is left?" with the wrong
quantity. Cf. [[the instrument that defines a class must enumerate it]] — same failure, one level up:
a figure nothing re-derives is a figure nothing can correct.

### Nothing guards the engine changelog, and it has drifted for three slices (D505)

`packages/engine/src/index.ts` carries the version provenance as headings of the form
`🆕🆕🆕 engineVersion <old> → **<new>** (D<nnn> — …)`. **No gate, test or mutant row checks them**,
and at D505's head the record is wrong in three places, verified against
`git log -- packages/engine/package.json`:

- **D501 edited D500's heading instead of adding its own.** It now reads
  `0.391.0 → **0.393.0** (D500 …)`, which swallows D501's bump and attributes it to D500. D500
  actually went 0.391.0 → **0.392.0** (commit `233324aa`), D501 → **0.393.0** (`58f14838`). The
  string `0.392.0` no longer appears in the file at all.
- **0.394.0 (D502, `3c91f6d5`) has no heading.**
- **0.395.0 (D505) has no heading** — deliberately, following D502's precedent, with provenance put
  in the new suite's header and the op's doc block instead.

**This is D504's finding one level further out.** D504 established that nothing compared a quoted
sweep line to the emitted one; here nothing compares a changelog heading to the version history the
commits actually record. Same class, same remedy: **the instrument that knows the truth must be the
one that checks the claim.**

✅ **PAID AT D506 — the guard is `packages/engine/src/engineVersionChangelog.test.ts` and all three
defects are repaired.** 202 headings, 30 of them naming a slice, five cases, six mutant rows. The
guard was landed red first: it failed on exactly those three defects and named each one.
⚠️ **But read the next two sections before citing it** — the authority it uses is NOT the commit
history, and what that cannot see is written out in the file and below.


### A value-keyed version sweep will retarget a CHANGELOG HEADING, and that is how D501's defect happened (D506)

D501's only edit to `packages/engine/src/index.ts` was **one line** —
`git show 58f14838 -- packages/engine/src/index.ts` is a one-line diff — and that line was D500's
heading arrow, moved from `**0.392.0**` to `**0.393.0**`. It was not carelessness, and the mechanism
generalises:

- the house version tax is paid by a **VALUE-KEYED sweep**: grep the outgoing literal, re-point
  every hit, then re-grep to confirm none is left;
- a changelog heading **legitimately contains the outgoing literal as its target** — that is what a
  heading IS;
- so the pass whose job is to move every pin forward also rewrites the one occurrence that must
  stand still, and the re-grep confirms success.

D500's own version-tax paragraph even prints an exception list for this exact class and names the
**previous** heading. The sweep then ate the **current** one.

**The rules:**

1. **A version bump gets its OWN heading. Never retarget the last one.** If a slice declines to
   write a heading (D502 and D505 both did), the version has no provenance at all — which is
   defects (b) and (c) of the D505 note above, and is now red.
2. **A version-tax exception list must name the CURRENT heading, not only the previous one.** The
   heading a slice is about to write is itself a history occurrence the moment the next slice
   sweeps.
3. ⚠️ **`git show <commit> -- <file>` before believing a heading.** A one-line diff on a
   1,480-line comment is invisible in a session log and in `git log --stat`.

### An in-repo SECOND WITNESS can stand in for an authority that `bun run check` cannot reach (D506)

D506's brief asked for the real authority for *"which version did slice D<nnn> ship?"* — the value of
`version` in `packages/engine/package.json` at each commit — and it was **refused, on two
measurements**:

- `packages/engine/tsconfig.json` sets `"types": []` on purpose (the engine runs in a Worker and in
  the browser), and that blocks an **explicit** import too, not just globals:
  `import { execFileSync } from "node:child_process"` in `packages/engine/src` is
  `error TS2591: Cannot find name 'node:child_process'`. Widening the engine's types so a doc guard
  can shell out is the widening `progressLog.test.ts` and `mutationSummaryQuote.test.ts` both
  refused.
- 🛑 **the deciding one: `.github/workflows/ci.yml` uses `actions/checkout@v4` with no
  `fetch-depth`, i.e. a SHALLOW clone of ONE commit.** `git log -- packages/engine/package.json`
  returns one entry there. CI runs `bun run test:run`. So a git-reading vitest guard that hard-fails
  when it cannot see the history is **red in CI the day it lands**, and one that SKIPS is the
  anti-pattern (a guard that silently passes when it cannot verify is worse than none). There is no
  third option inside `check`.

**What was used instead: two authorities that are present in every checkout and are not copies held
by the guard.** The chain's own 202 headings plus `manifest.version` for structure, and
**`docs/decisions.md` for attribution** — it records `Engine <old> → <new>` on the row of 225
decisions, including all 30 the headings name. A misattribution now has to be committed
**identically in two files, by two different steps of the ritual**, to pass.

⚠️ **AND THE WITNESS'S ACCURACY WAS MEASURED RATHER THAN ASSUMED.** Against
`git log -p -- packages/engine/package.json`, `docs/decisions.md` agrees on **160 of 162 adjudicable
slices** (the exceptions are D184's and D389's rows). Over the 27 labelled headings that existed at
D505's head it agreed **26 of 27** — and the one disagreement *was* the defect.

**The rule:** when the true authority is out of reach of the tool that must enforce the check, look
for an **independent in-repo record** and **measure how often it agrees with the authority before
relying on it**. Say the agreement rate in the guard. What such a guard cannot see is a defect
committed to both records at once — for D506 that means **a uniform re-labelling**, and it is named
in the file rather than left for a reader to discover.

### A verifying regex must be at least as permissive as the one it checks (D506)

Three slices running, this loop has been bitten by the same shape: **an instrument too narrow to see
the whole class, reporting a number as though it bounded it.** D503 grepped one token and reported 455
where the class held 464. D504 summed occurrences for one file against lines for another and reported
444 for 455. At D506 it happened again — **in the caller's own verification of the guard built to
catch it.**

Checking the builder's "202 headings / 10 holes / 53 versions", the caller wrote

```python
re.finditer(r'engineVersion (0\.\d+\.\d+) → \*\*(0\.\d+\.\d+)\*\*', s)
```

and got **196 headings, 15 chain breaks, 58 missing versions** — then reported the disagreement as a
discrepancy in the builder's figures. The builder's regex was
`/engineVersion\s+(\d+\.\d+\.\d+)\s*→\s*\*\*(\d+\.\d+\.\d+)\*\*…/`. The difference is
`\s*` versus a literal space: **`index.ts`'s headings live in a wrapped doc comment, so six of them
break across lines.** Re-run with the builder's semantics: **202 / 9 minor breaks + one patch hole =
10 / 53.** The builder was exact; the caller was wrong in three numbers at once.

**The rule:** when you write a pattern to check someone else's count, **make it at least as
permissive as theirs, or you are measuring a different set and your disagreement is yours.** In
practice:

1. **Read their matcher before writing yours.** If it tolerates whitespace, newlines, optional bold,
   or an optional trailing group, yours must too.
2. **Whitespace in a wrapped document is not incidental.** Any pattern run over prose — doc comments,
   markdown, changelogs — must assume the text wraps, because it does.
3. **A disagreement is a finding, not a verdict.** Resolve it to a cause before reporting either
   number. Both times this run reported a count without doing that, the reported number was wrong.
4. Corollary of [[the instrument that defines a class must enumerate it]]: **the verifier is also an
   instrument, and it has the same failure mode as the thing it verifies.**

### The version-bump ritual destroys the record of the previous bump, and its own check confirms success (D506)

`packages/engine/src/index.ts` carries version provenance as
`🆕🆕🆕 engineVersion <old> → **<new>** (D<nnn> …)` headings. At D506 it was found drifted in three
places, and **the mechanism matters more than the defect.**

`git show 58f14838 -- packages/engine/src/index.ts` is a **two-line diff** — D501's entire edit to
that file:

```
- export const engineVersion = "0.392.0";                            → "0.393.0"   (correct)
- 🆕🆕🆕 engineVersion 0.391.0 → **0.392.0** (D500 …)                 → **0.393.0**  (destroys it)
```

The house version tax is paid by a **value-keyed sweep** for the outgoing literal. But a changelog
heading legitimately **contains the outgoing version as its target** — that is what records the
previous bump. So the sweep rewrites the one occurrence that must stand still, and **the confirming
re-grep reports success, because no `0.392.0` remains.** Worse, the unescaped string then appears
nowhere in the file (it survived only as `toBe("0\.392\.0")` inside D500's own block), so a
value-keyed search could never have found the loss either.

D500's own version-tax paragraph prints an exception list for exactly this class — and it names the
**previous** heading. The sweep then ate the current one.

**The rules:**

1. **One heading per bump; never retarget an existing heading.** A heading's `<new>` is a historical
   fact and is never an occurrence to sweep.
2. **A value-keyed sweep must exclude the changelog**, and the exclusion must name *the heading being
   written this slice*, not merely the one before it.
3. **A confirming re-grep for "no occurrences of the old value remain" cannot detect this class** —
   it is satisfied *by* the damage. Check the count of headings and the chain, not the absence of a
   literal.

⚠️ And note what made this cheap to find and expensive to have missed: **nothing had checked the
headings for 55 slices.** The guard (`engineVersionChangelog.test.ts`) now pins the chain, the head,
uniqueness and attribution — see its own closing note for the five things it deliberately cannot see.


## A labelled changelog heading and its `docs/decisions.md` row are ONE edit (D507)

`engineVersionChangelog.test.ts`'s ATTRIBUTION case asserts `adjudicated === LABELLED.length` with
**no tolerance**: every heading whose parenthesis opens `(D<nnn>` must have a matching
`| **D<nnn>** |` row in `docs/decisions.md` recording the same arrow. So a slice that bumps the
engine and writes `(D507 — …)` while `decisions.md` has no D507 row ships `bun run check` **RED**.

D507 was scoped away from `docs/decisions.md` (the caller performs the ritual) and therefore could
not write a labelled heading at all. It wrote an **unlabelled** one — which is the pre-D452 form,
172 of the 202 headings carry it, and the ATTRIBUTION case skips it by construction — and said so
inside the heading, naming the exact row the ritual owes and the exact rewrite that labels it.

**The rule: bump, heading and decisions row move together, or the heading stays unlabelled and the
debt is written into the heading itself.** Relabelling later is additive and safe; it is not the
retarget D506 forbids, because the arrow does not move.

## `D506-changelog-head-unnamed` is part of the version tax (D507)

That row un-bolds **the newest heading's** target so the parser stops seeing it and `NEWEST` falls
behind `HEAD`. Its stated reason is *"killed by the HEAD case alone"*.

Leave it pointed at the previous slice's heading and it goes **INERT ON THE VERDICT** the moment a
newer heading exists: un-bolding a heading that is no longer the head leaves `NEWEST === HEAD`, the
HEAD case stays green, and the kill arrives — if at all — through the CHAIN case instead. The row
would still report KILLED and its own sentence would be false (D450's inert row, D453's undeclared
diagnosis).

**Every engine bump owes this re-point, in the same edit as the heading and the constant.**

## The version sweep is a WHITELIST, not a value-keyed grep (D507)

D506 named the mechanism that ate D500's heading: the tax is paid by grepping the OUTGOING literal,
and a changelog heading legitimately CONTAINS that literal as its target. D507 turned the finding
into a procedure. Sweep only lines matching:

- `expect(engineVersion).toBe("<old>")` and `expect(manifest.version).toBe("<old>")`
- an `it(…)` title that spells the version (D460's fourth class — no prescribed grep sees it)
- `export const engineVersion = "<old>";` and `"version": "<old>"` in `package.json`
- `mutants.ts` rows whose `find` quotes one of those lines

then **re-grep the old literal and check that what remains is exactly your written-down exception
list.** At D507 that was 16 occurrences outside `docs/`: this slice's own heading SOURCE, the
previous slice's heading TARGET, four history lines in the changelog guard, three header arrows in
suites, the D275 re-point ledger and three lines of the `D506-changelog-head-unnamed` row. 101
occurrences across 72 files moved; **none of the 16 did.**

⚠️ A whitelist sweep can also move a line you did not plan for and be RIGHT: `mutants.ts`'s
`find: 'export const engineVersion = "<old>";'` contains the declaration verbatim, so it is swept by
the declaration rule and that is exactly where it had to land.

## A both-sides printing is a COMPOSITION, not a union member (D507, re-earning D482)

*"(both yours and your opponent's)"* names TWO ZONES. If the engine already has one op per zone, the
sentence is a **program**, not a third member on somebody's `target`. D482 established this for
`damageDefender` + `spreadDamage`; D507 applied it where BOTH zones are the same op
(`spreadDamage { yourBench }` then `spreadDamage { opponentBench }`), and the both-sides half cost
**zero** type bytes.

🛑 **And the refusal it replaces was right about its rows and wrong about its mechanism for 82
decisions.** `ownBenchSpread.test.ts` had carried *"a THIRD `target` value plus a two-board fold"*
since D425. Only the ROW LIST was ever asserted, so the REASON was free to be false (D466). **When
you inherit a priced refusal, price it again before you either pay it or quote it.**

⚠️ The restructure that looks tempting — copying a sibling's `{ filter, side }` pair — is the same
class of move as the thrice-refused `scale?: DamageCountSource` (D448/D449/D465). Check what the
sibling's walk REACHES: `counterEachAll` walks `board.active` too, so a `side` on a bench-only op
invites a `filter` that falsifies *"`spreadDamage` only ever touches `side.bench`"* in three files.

## An eighth lattice shape: a CONJUNCTIVE PAIR of blocking axes (D507)

D505's shape was ONE blocking axis flipping the verdict at 16/16 cells with four inert axes at 0/16.
D507's 2⁵ lattice reads `0/1 · 0/5 · 1/10 · 3/10 · 3/5 · 1/1` and factorises as **two axes flipping
at 8 of 16 cells each and three at 0 of 16** — the arithmetic signature of a CONJUNCTION: a
pre-slice point builds only where BOTH blockers are substituted, so neither alone reaches a built
string and each flips only the half of its cells where the other is already substituted.

**Read the flip table, not just the weight vector.** `8/16 + 8/16` and `16/16 + 0/16` can produce
similar-looking vectors and mean different things about the price.

## D505's reachability argument had an ARM-shaped premise (D507, refining D456)

D505 closed `EffectContinuation.rest` for `spreadDamage` by writing *"the arm below returns a program
of **length one**"*. D507's arm returns a program of **length two**, so that sentence was simply not
available and the question had to be re-derived rather than inherited.

The door is still shut, and the reason is now a property of the OP instead of a property of the ARM:
`rest` holds what sits BEHIND a park, and the op in front of it is itself the never-parking op.
**State the reachability argument in terms of what the OPS can do, not in terms of how long today's
program happens to be** — and when you inherit one, check which of the two it was.

## A producer count measured AFTER your own build is a number you manufactured (D507, applying D427)

D507's refusal of corpus line 601 wanted *"`damageDefender` has many more producers than
`spreadDamage`"* as its price. Measured at the post-build head the figures were 9 against 7 — because
the new arm's two ternary branches had added **four** `spreadDamage` producer sites of its own. The
pre-slice figure was 3.

The rung that decides was moved to a number the slice does not touch: the **union ARITY**.
`spreadDamage` is one member, so an optional rider is one line; `damageDefender` is two members whose
whole purpose is keeping `amount` and `per`/`count` apart, so a rider on the flat arm owes a
`?: never` on the sibling in the same edit. **Prefer a comparand your own diff cannot move (D436),
and when you report the movable one, report the confound beside it.**

### Labelling a changelog heading touches THREE files, not two (D507, extending D506)

D507 shipped its `0.395.0 → 0.396.0` heading **unlabelled**, because
`engineVersionChangelog.test.ts`'s ATTRIBUTION case asserts `adjudicated === LABELLED.length` with no
tolerance: a `(D507 —` label requires the `| **D507** |` row in `docs/decisions.md` to exist in the
same commit. The builder named that debt and handed the caller "one atomic edit".

**It was not one edit. It was three**, and the caller found the third the hard way:

1. `packages/engine/src/index.ts` — add the `(D<nnn> —` label to the heading;
2. `docs/decisions.md` — the matching `| **D<nnn>** |` row;
3. 🆕 **`scripts/mutation/mutants.ts` — every row whose `find` quotes that heading.**

`D506-changelog-head-unnamed` pins the head by quoting the newest heading verbatim:

```
find:    "engineVersion 0.395.0 → **0.396.0** (THE SPREAD"
replace: "engineVersion 0.395.0 → 0.396.0 (THE SPREAD"
```

Inserting `D507 — ` after the parenthesis moved the heading out from under both strings, and
`precheck` went red with `find occurs 0× in packages/engine/src/index.ts`.

⚠️ **`bun run check` was GREEN throughout.** `precheck` is not part of `check` — it is a separate
gate — so the only thing standing between a labelled heading and a corpus that cannot run is
**remembering to run `precheck` after touching `index.ts`**. Had the sweep been launched on the
commit, it would have died on row 1 of 2,517 after the commit was already made.

**The rule:** after editing a changelog heading for any reason — labelling it, writing a new one,
correcting one — **run `bun scripts/mutation/precheck.ts` before committing.** More generally:
**a mutant row's `find` is a dependency on exact bytes in another file, and nothing type-checks it.**
`precheck` is the only instrument that knows, and it is not in `check`.

Cf. [[the version tax now has three parts]] — this is its fourth.


## A ninth lattice shape: ONE blocking axis and FOUR live ones, zero free (D508)

D505's shape was one blocking axis at 16/16 with **four inert axes at 0/16**; D507's was a
conjunctive pair at 8/16 each with **three inert at 0/16**. D508's 2⁵ reads
`0/1 · 1/5 · 1/10 · 3/10 · 2/5 · 0/1` (**7 of 32** pre-slice, 8 after) and its flip table is
`7 · 5 · 3 · 3 · 1` of 16 — **no axis flips at zero.** The ZONE axis is the blocker, and it is
blocking ONE-SIDEDLY rather than symmetrically: all 16 discard-pile points are dead before the
slice and exactly one is alive after, while the in-play half builds at 7/16 on its own.

**The distinction the flip table buys you is a price.** An axis at 0/16 is free — you can move it
without changing the verdict, so it costs nothing to spell. An axis that flips anywhere is a
LITERAL the anchor has to carry, and every one of them is a measurement you owe (*"the column
prints this spelling zero times"*). D508 owed four such measurements and D505 owed none.

⚠️ **`INERT ON THE VERDICT` is still not `DEGENERATE`** (D491's identity sense). Here the question
does not even arise — all 32 points are distinct strings AND no axis is inert — but say which you
mean, because a 0/16 axis whose two values produce the same bytes is a different finding from a
0/16 axis whose values differ and are simply not read.

## A refusal corrected IN PLACE can stay false in the file you were not editing (D508)

D440 blocked a corpus row for two reasons. D446 built the mechanism behind the second one and
corrected the sentence **in `discardPileScaling.test.ts`**, leaving the row *"blocked ONCE where it
used to be blocked twice"* — exactly the in-place correction this repo asks for.

🛑 **The same refusal was ALSO written into `scripts/opaque-anatomy.ts`'s marker table, and nobody
re-read it.** D479 then audited that very `needs` string, found its FIRST clause false, corrected it
at length — and copied the already-stale third clause forward untouched, thirty-three decisions
after the mechanism it names had shipped. The false sentence survived two deliberate corrections of
the paragraph containing it.

**The rule:** when you correct a refusal in place, the unit of the sweep is the refusal's
VOCABULARY, not the file you are standing in. `grep` for the mechanism the refusal names
(`attacksOf`, `CardFilter` over…) across `packages/**` **and `scripts/**`, and for the corpus line
number if the refusal cites one. D414's *"find every read site before you fix any of them"* applies
to CLAIMS as well as to fields.

## A marker's verdict is DATA a build can falsify, and narrowing the marker is the dishonest repair (D508)

`scripts/opaque-anatomy.ts` declares each marker `blocker` or `co-marker` and
`opaque-anatomy-gate.ts` § C checks the declaration against the corpus: a `blocker` must have a
ZERO built side. That section's own doc block forecasts its failure — *"the day a slice builds an
attack-copy sentence, its built side goes positive and this gate goes RED and names it"* — and
D508 is the first time it happened for real.

**Two repairs are available and only one is honest.** Narrowing the marker's `rx` so the newly
built sentence stops matching restores the `blocker` verdict *by deleting the evidence against it*.
Re-declaring the verdict keeps the marker, keeps the refutation, and is D178's rule (annotate
provenance, never overwrite it). ⚠️ **Take the consequence with it**: a co-marker never LABELS a
row, so the rows it used to carry fall to `UNEXPLAINED`. That is not collateral damage — if the
marker was not the reason, the label was doing work it could not justify (D463).

## A census step rots pins in five different SHAPES, so a value-keyed pass is a partial sweep (D508)

The per-slice suites mirror `censusAtHead.test.ts`'s figures, and at this head they spell the same
two numbers as `toEqual([536, 1572])`, `toBe(1572)`, `toHaveLength(536)`, `units(resolved)`,
`p(resolved)`, `resolvedP` and `rawHead`. A pass keyed on one of those shapes moves some of them,
re-greps clean for its own pattern, and leaves the rest red.

**The instrument that enumerates them is the test run, not a grep.** Run the whole suite, take the
failing `file:line` list, and patch from that — the same reason `precheck` rather than reading is
what answers the rot question for mutant rows (D441).

## A new arm that is a CROSS PRODUCT collides with its parents' mutant rows (D508)

D508's arm emits `seat: "you"` above the identical `filter: { kind: "attackNamePokemon", … }` line
that D446's arm emits, so a shipped row whose `find` was those two lines became `find occurs 2×`
and `precheck` refused the corpus. **This is structural, not bad luck**: a cross product of two
shipped pieces is *by construction* byte-similar to both parents, so expect at least one collision
per parent and predict it before `precheck` does.

The repair is `D483`'s, one union over: extend the `find` by the ONE line the two arms cannot
share — here the count's `kind` — rather than re-pointing onto something arbitrary. **The claim
must come through unchanged**; a re-transcription that quietly changes what a row tests is worth
less than a broken row (D498).

## `src/**` IS in the mutation corpus — D215 is a DIRTY-FILE refusal, not a path allowlist (D509)

D509 was briefed to check "whether the harness can even patch `src/`" before writing rows against a
React component, on the reading that D215's *"the harness STOPS WRITING TO FILES IT DOES NOT OWN"*
is a scope restriction on the corpus. **It is not.** `runMutant` resolves any repo-relative path and
refuses exactly two things: a path that escapes `REPO_ROOT`, and a file `git status --porcelain`
reports as modified (per file, re-checked after the baseline run, overridable with `--allow-dirty`).
Measured at D509's head, the corpus already targets `src/` **34 times** — six of them
`OnlineHud.tsx` itself — plus `scripts/`, `docs/`, `apps/`, `biome.json` and three `tsconfig`s.

⚠️ **The ownership `run.ts` enforces is TEMPORAL — "is another agent holding this file right now" —
and its own doc block says so**: a whole-tree refusal was rejected because *"it lets the engine half
of the corpus run while `src/**` is live."* Read the refusal's mechanism before inferring a
population from its slogan (D423: sites are not mechanisms).

## A rendered NUMBER needs its own rung; asserting the SENTENCE leaves the number free (D509)

`GameHud.dom.test.tsx` has pinned the local Confusion hint since long before D501 — with
`expect(screen.getByText(/Confused: attacking flips a coin/))`. D501 then made that line read its
amount off the board instead of a hard-coded `30`, **and the dom rung never moved**, because the
regex stops before the number. At D509's head the local HUD's amount is pinned by **no** dom rung at
all, and D501 shipped no mutant row on it either: `{conditions?.confusionDamage ?? 30}` → `{30}`
dies to nothing on that surface. The engine suites pin the engine's number; nothing pins what the
panel PRINTS.

**This is D466's *"only the row LIST was asserted, leaving the REASON free to be wrong"* at a UI
string.** When a slice's whole content is *which* value a surface renders, the rung must drive a
value the old build could not produce — D509's online twin asserts the FULL sentence against a board
carrying `confusionDamage: 80`, so a literal `30` and a neighbouring `poisonDamage` both redden it,
and a second board at the rulebook default keeps the pair one-axis apart (D427).

⚠️ **And a pair of same-typed fields on one record is its own hazard.** `RedactedConditions` carries
both `poisonDamage` and `confusionDamage`; a board that raises only one of them cannot separate a
reader that grabbed the wrong sibling from one that grabbed the right one.

## "No member of this union does X" is a claim that rots differently from "this print does not ask for X" (D510)

Two shipped doc blocks justified `attackNamePokemon`'s exact `===` by asserting **"no `CardFilter`
member does substring matching at any width"**. It was false when it was written: `ownerPokemon`
has matched a proper PREFIX of `Card.name` since **D200** (`card.name.startsWith(\`${owner}'s \`)`),
and `scripts/opaque-anatomy.ts`'s `CARD-NAME-COUNT` marker — the marker covering the very row D510
built — has recorded it since **D471**.

🛑 **The conclusion was right and the warrant was wrong, which is D503's fourth mode arriving in a
new place.** The exactness really is correct; what is false is the survey it rests on. **Rest an
exactness on the PRINTED NOUN, not on a census of the union** — *"the sentence names one attack,
whole"* cannot rot, and *"no member does X"* rots the day any member does.

⚠️ **And the script said so before any engine file did.** D508's rule (sweep a corrected claim
across `packages/**` AND `scripts/**`) has a converse: **when a `scripts/` instrument and an engine
doc block disagree about the engine, the instrument is not automatically the stale one.** Check
both directions before correcting either.

## The ANCHOR may not be the blocker — run the pattern before pricing the slice (D510)

D440's census block listed the Team Rocket row as needing a `CardFilter` member, and every resume
point since repeated it. What nobody ran was the anchor. `DISCARD_PILE_COUNT_MULTIPLY`'s `([^.]+)`
noun group has swallowed the whole narrowed phrase since the day it was written — against the
printed bytes it captures `20` / `Supporter card that has "Team Rocket" in its name` / `your` — so
the sentence had always REACHED the reader and was refused one step later, at the noun resolver.
That function's own doc block said so (*"or `null` when this file has no way to spell it (Ancient,
the Team Rocket name substring)"*) and the price still read as if an anchor were owed.

🛑 **Before pricing a residue row, `exec` its family's shipped anchors against the printed bytes.**
It is one line and it distinguishes D505's shape (*the blocker is a NAME, not a machine*) from
D508's (*the blocker is a PATTERN*). D510's whole engine change was one regex **added beside** a
resolver and one union member; the anchors were untouched, so **no existing mutant row quoting them
rotted** — which is the second payoff and is not visible from the sentence alone.

## A both-sides COUNT is not a both-sides OP — D507's composition does not transfer (D510)

D507 answered *"(both yours and your opponent's)"* with a COMPOSITION: `spreadDamage{yourBench}`
then `spreadDamage{opponentBench}`, two ops, **zero type bytes**. That works because `spreadDamage`
is an **op** and a program is a **list**. The same printed parenthetical over a **count** does not
compose: `AttackDamageBonus` is `{ per, count }` with ONE count, the fold is `per × count`, and two
counts would have to be **summed into one number** — which changes the reader's RETURN TYPE, not
its program.

**Measured, at this head, rather than argued:**

| question | answer |
|---|---|
| `CountSeat` members | **2** (`"you" \| "opponent"`) |
| `seat: "both"` occurrences in the repo | **0** |
| sites that READ `CountSeat` | **2**, both `seat === "you" ? attackerSeat : defenderSeat` |
| exhaustive consumers of `DamageCountSource` | **1** (`scaledAttackDamage`, attack.ts) |
| shipped both-sides counts | **2**, and BOTH are MEMBERS (`bothSidesBenchCount`, `bothActivesEnergyCount`) |

🛑 **The decider is not member-count, it is which mistake the compiler catches.** A third
`CountSeat` value is read as `"opponent"` by both binary ternaries, **silently, with no type
error** — and it hands `cardsInDiscardPile` a value nothing prints (D104). A new MEMBER is caught by
`attack.ts`'s total `switch` (D447). **When a widening and an addition are otherwise equal, take
the one a total switch can see.**

## The BAKED HEAD NOUN is combinatorial — price it with a crossover, not with a shrug (D510)

`CardFilter` has no intersection combinator, deliberately, so `attackNamePokemon` and D510's
`supporterNameContaining` both spell the head noun INTO the member. **The cost of that idiom is one
member per (noun × predicate) pair**, and a price that does not say where it stops is not a price.

D510's, stated: the column prints the quoted-fragment predicate under **two** head nouns
(`censusAttackCorpus.ts` file lines 543 `Supporter card` and 583 `Pokémon`), so full coverage costs
**2 members**. The alternative — a general `allOf` plus a bare `nameContaining` — costs **3**: two
members plus a RECURSIVE combinator every exhaustive `CardFilter` reader owes an arm to, one of
which must recurse (`anyOf`'s own stated cost), plus a `retrieveNoun` join with *"and"* that no
printed sentence drives. **The crossover is the THIRD head noun**, which this column does not
print. A successor who meets one should re-run the comparison rather than adding a third member by
habit.

⚠️ **And D392's amended rule decides MEMBER vs OPTIONAL RIDER here too, at a union it was not
written for**: *a filter is a FIELD only when a SHIPPED delegate already accepts it; otherwise it is
a MEMBER*. `cards.ts` carries no name-matching predicate at all — `byName` and `ownerPokemon` both
read `card.name` INLINE — so there is no delegate, and an optional rider is invisible to the
compiler: a producer that spelled the printed noun and forgot it would silently get the UNNARROWED
read. The field is `fragment` and not `name` for D392's compiler reason, in both unions.

## A tenth lattice shape: FIVE axes, every one flipping at the MINIMUM 1/16, singleton built set (D510)

D505's shape was one blocking axis at 16/16 with four inert at 0/16; D507's a conjunctive pair at
8/16 with three inert; D508's one blocker at 7/16 with four live and none inert. D510's 2⁵
(NOUN × PREDICATE × ORDER × SEAT × FOLD) reads

> `0/1 · 0/5 · 0/10 · 1/10 · 0/5 · 0/1` — **1 of 32** before the slice, **5 of 32** after,
> identical readers-only and under `builds()`, **0 divergent points**, all four splitters null at
> **128/128**, all 32 points distinct strings.

Flip table: **1/16 on every one of the five axes** — the minimum a live axis can have. **Zero inert
axes AND zero free axes**, which is new: D505 had four free, D507 three, D508 none-free-but-none-at-one.

🛑 **Read as a price, the shape says the row shares no sub-expression with anything built.** The
single pre-existing built point is D508's row at Hamming weight THREE, and every axis flips only in
that one cell — so the sentence's built neighbourhood is a single distant point, not a region.
⚠️ **Which is exactly why the flip table is not the whole price.** Three of the five axes are
literals the new noun pattern carries and owe a *"printed zero times"* measurement; the other two
(SEAT, FOLD) flip at 1/16 **because the shipped anchor pair already varies them for free**. **A
1/16 axis can be either owed or free — look at WHICH point it flips at, not just at the count.**

## The row-selection flag is `--only`, and an UNRECOGNISED flag runs the WHOLE corpus silently (D510)

D510 typed `bun scripts/mutation/run.ts --id <row> --allow-dirty` three times. **There is no `--id`
flag.** `run.ts` takes `--only a,b,c` and `--decision D<nnn>`; an unknown flag is not rejected, so
each of those invocations started a **2,541-row, ~3-hour sweep** that looked like a row probe for
its first few seconds. Killing them on a timeout is what produced the damage below.

🛑 **Check the flag against `run.ts`'s own usage block (lines ~90–100) before quoting a probe
command in a brief or a resume point.** The failure mode is silent and expensive in both directions:
the run does far more than asked, and the OUTPUT you skim looks like the run you wanted.

## A killed `--allow-dirty` probe leaves its PATCH, and two concurrent ones restore each other's files (D510)

The harness patches a source file, runs a suite, restores it. **A killed run leaves the patch in
place.** D510 had two running at once and killed both: the tree was left carrying **fourteen**
leftover mutant patches across `effects.ts`, `interpreter.ts`, `cards.ts`, `cardplay.ts` and
`registry.ts` — **three of them files the slice was itself editing**, so a blind `HEAD` restore
would have destroyed real work.

✅ **`run.ts` HAS A JOURNAL AND SELF-HEALS ON THE NEXT RUN** — *"A previous mutation run (pid …) did
not restore its files. Restoring them now from the journal."* — which is the FIRST thing to try, and
which D510 discovered only after recovering by hand. The manual recovery is still worth knowing
because it works when the journal does not cover a file: for each id `precheck` reports at `find
occurs 0×`, assert the row's `replace` occurs exactly **1×** and its `find` **0×**, then substitute
back. **Row-wise, never file-wise**, whenever the file is one the slice has touched.

⚠️ **And `git status` after an interrupted probe is not optional.** Two of the five clobbered files
(`cardplay.ts`, `registry.ts`) were not in the slice's edit set at all and would have been committed
as silent behaviour changes. **`bun run check` was GREEN on one of them**: `cardplay.ts` carried a
`switchActive` mutant whose killing suite had already been restored out from under it — so the
green suite proves the tree is consistent, not that it is the tree you wrote.

**Rules**: one probe at a time; `--only` / `--decision` and nothing else; and after ANY interrupted
probe run `precheck` **and** `git status` before doing anything else.

### `run.ts` does not reject unknown flags, so a typo launches a three-hour whole-corpus sweep (D510)

`scripts/mutation/run.ts` selects rows with **`--only`**. There is **no `--id`**. But unknown flags
are **not rejected** — they are ignored — so `--id <row>` does not probe one row: it **matches
nothing to filter on and runs the entire corpus**.

At D510 this happened **three times**. Two of those sweeps ran **concurrently**, were killed, and
left **14 mutant patches across five files** — three of which were being edited at the time. ⚠️ **And
`bun run check` was GREEN on one of those patched trees**, because a mutation is by construction a
plausible edit.

**Why this is worse than a wasted three hours:** the harness patches the working tree in place and
restores on exit. A killed sweep does not restore. So a mistyped flag can leave the repository in a
state that **looks healthy to `check`** and silently corrupts whatever is committed next.

**The rules:**

1. **Probe with `--only <id>` or `--decision <Dnnn>`.** If a "probe" takes more than a minute,
   **it is not a probe** — stop it and read the flag you typed.
2. **`precheck` is the detector.** It asserts every row's `find` occurs exactly once, and a leftover
   patch has *replaced* a `find` — so **`precheck` clean is proof the tree is unpatched**, and
   `check` green is not. Run it after any interrupted sweep, and before any commit that followed one.
3. **Never run two sweeps at once.** They patch the same files.
4. `run.ts` keeps a **journal that self-heals on the next run**, which is a recovery path but not a
   safety net — it only helps if a next run happens before a commit.

✅ **The guard was cheap and IS NOW WRITTEN (D511)** — `scripts/mutation/argv.ts`, called from the
first lines of `main()`, ahead of both the `--list` branch and the journal recovery. `--id <row>` now
exits **4** naming the flag, and nothing is read or written. See the D511 convention below for what
it does and does not cover; this convention stays because the RULES above are still the rules.

### When a `scripts/` instrument and an engine doc block disagree about the engine, the instrument is not automatically the stale one (D510)

Two doc blocks in `effects.ts` stated *"no `CardFilter` member does substring matching at any
width"*, and used it as the warrant for refusing a name-fragment member. **The sentence was false
when it was written**: `ownerPokemon` has matched a proper **prefix** of `Card.name` since D200
(`card.name.startsWith(\`${owner}'s \`)`, `cards.ts`), and a prefix is a substring at a fixed offset.

⚠️ **And `scripts/opaque-anatomy.ts`'s `CARD-NAME-COUNT` marker — the marker covering the very row
the doctrine was refusing — had recorded the truth since D471.** For thirty-nine decisions the repo
held both claims at once, and the engine's own prose was the wrong half.

**The habit this corrects:** `scripts/` is treated as derived commentary and `packages/engine` as the
source of truth, so a conflict gets resolved toward the engine by reflex. But a marker in `scripts/`
is **re-derived against the tree every run**, while a doc block is **prose that nothing executes**.
**On a question of fact about the engine, prefer the one something checks.** Cf. D508, where a false
price survived in `scripts/` for thirty-three decisions because nobody looked there — the lesson runs
in *both* directions: **neither side of that boundary is automatically fresher.**


### `run.ts`'s flag surface is closed, and the check runs before anything that writes (D511)

`scripts/mutation/argv.ts` holds the whole flag surface — `--list`, `--only <v>`, `--decision <v>`,
`--full`, `--verbose`, `--allow-dirty` — and `run.ts` rejects anything else with **exit 4** and a
message naming the offender. Four classes are refused, all of them the same defect (an argument
*dropped* rather than an argument *wrong*):

1. **an unknown flag** — D510's `--id`, and any `--typo`;
2. **a value flag with no value** — a trailing `--only`, whose `undefined` reads as *no filter*;
3. **a value flag whose value is another flag** — `--only --full`, which took `"--full"` as a row id;
4. **a bare positional** — the row id a mistyped flag leaves stranded. `run.ts` reads none, ever.

A **repeated** flag is refused too: `--only` does not accumulate, so `--only a --only b` has always
silently meant `--only a`. ⚠️ That is not a change of semantics — `--only` still takes ONE
comma-separated list, `--decision` still takes ONE value, and `--list` still ignores `--decision`.
The discard is now announced instead of performed in silence.

🛑 **WHERE THE CHECK RUNS IS PART OF THE GUARD.** It is the first thing `main()` does — **ahead of
the `--list` branch AND ahead of `recoverFromJournal()`**. D369's rule is *the recovery path is a
WRITE, so the only command that may precede it is one that never writes*; validation never writes, so
it qualifies, and it must go **further forward** than `--list` rather than beside it. Behind the
recovery a rejected command line could still restore a live run's file out from under it and exit 2 —
D369's defect reached through a typo. Behind `--list`, `--list --ohno` would print the corpus and
report success on a line it never understood. **Exit 4 is a new code on purpose**: 1/2/3 already mean
*a row failed*, *a dead run's files were put back — go look*, and *someone else is mid-run*.

✅ **`--decision`'s SUBSTRING MATCH WAS EVALUATED AND DELIBERATELY LEFT ALONE.** `--decision D51`
matching both `D510` and `D511` is a real trap, and tightening it to an exact match is a worse one —
measured, not argued. Five of the corpus's `decision` strings are not bare ids: `D192 (inheriting
D161)`, `D192 (inheriting D159)`, `D204 (vs D200 predicate)`, `D204/D205`, `D209 (as flipped by
D210)`. Under `===`, `--decision D192` stops finding two of its own rows and `--decision D205` stops
finding the `D204/D205` pair — **a selector that silently returns FEWER rows than asked for, which is
D510's defect pointing the other way**. Prefix-matching a family is also a legitimate use. It stays,
and a mutant row now makes any future `===` say so out loud.

⚠️ **WHAT THE GUARD DOES NOT DO.** It does not interpret values: `--only nonsense` is a well-formed
line and is still answered with *No mutants selected* and exit 2. And `packages/engine/src/
mutationArgvGuard.test.ts` **drives the validator and reads the wiring as text — it does not spawn
`run.ts`**, because `run.ts` has a top-level `await main()` (importing it runs the harness inside
vitest) and `packages/engine` sets `"types": []`, so `node:child_process` does not typecheck there.
What is proved in `check` is that the predicate is right and that the call sits ahead of both writes
in the source. That the assembled process exits 4 was demonstrated by hand and is pinned only as text.

### `bun run check` does not check formatting, so `biome format .` is a 360-file edit (D511)

`check` is `typecheck-coverage && tsc -b && lint-coverage && biome lint . --error-on-warnings &&
vitest run`. **`biome format` is not in it, in either direction** — not `--write`, not `--check`. The
repo is therefore **not** format-clean and has not been for a long time: at D511's head a bare
`bunx biome format . --write` rewrote **360 files**, none of them the slice's, and `check` was green
on the result. ⚠️ **That is a whole-tree edit wearing a tidy-up's clothes**, and it is the "never
touch the tree wholesale" rule at an instrument rather than at `git`. **Format explicit paths only**:
`bunx biome format --write <the files you wrote>`. If a formatter pass ever does escape, `git diff
--stat` names the blast radius and `precheck` must be re-run afterwards — a reformat can move a
mutant row's `find`.


### A union-annotated ARRAY is not a guard on that union (D512)

🛑 **`const SEATS: readonly CountSeat[] = ["you", "opponent"]` plus `expect(SEATS).toHaveLength(2)`
CANNOT go red when `CountSeat` gains a third value.** Widening a union never makes a narrower array
illegal — every element is still assignable — and the length is a property of the literal, not of
the type. D510 shipped exactly that as the executable falsifier for a refusal (*"the day `CountSeat`
gains a third member, this rung goes RED"*) and it stood, green and vacuous, until D512 ran the
experiment: `CountSeat` widened to three values, **`tsc -b` exit 0, the whole suite green**.

**The shape that does fire is a `Record` KEYED on the union** — `const SEATS: Record<CountSeat, Seat>
= { you: "p1", opponent: "p2" }` fails to compile with a value missing. D446 already used it for
`CardFilter["kind"]` in `bodiesInPlayScaling.test.ts`, and that one HAS fired, three times now, each
time as the only compile error a new member produced. **Prefer the refusal the model re-derives**
(D424); an annotated array is a list a human keeps.

⚠️ **The general test is conventions' own: say what change would turn the rung red, then make that
change.** It costs one `sed`, one `tsc -b` and one suite run here — about two minutes — and it is the
only thing that separates a falsifier from a sentence about one.

### Run the shipped anchors against the row FIRST, and report whichever way it comes out (D510 → D512)

D510 found its row had matched a shipped anchor since D440 and was refused one step later, which
turned *"new machine"* into *"new name"* for the cost of one `exec`. **D512 ran the same check and got
the opposite answer** — all four in-play anchors refuse its row **at the pattern**, because every one
of them requires the literal `for each of your ` and the printed sentence's head is SEATLESS, with the
side named by a trailing parenthetical instead. Both answers are worth the minute. The check is not
*"is an anchor owed"*; it is *"where exactly does this sentence stop being read"*, and the answer
names the slice.

### A both-sides reading is a MEMBER, and the reason is a ternary (D193/D196 → D512)

Three shipped counts now span both seats and **all three are members with no seat field**:
`bothSidesBenchCount`, `bothActivesEnergyCount`, `bothSidesPokemonInPlay`. The reason is mechanical
rather than stylistic — `attack.ts` resolves a `CountSeat` with `seat === "you" ? attackerSeat :
defenderSeat`, a BINARY ternary, so a third value is read as the OPPONENT with no complaint anywhere,
where a new member is a compile error in that file's total `switch` (D447).

⚠️ **And D507's composition answer does not transfer from ops to counts.** Two `spreadDamage` ops are
two elements of a LIST; two counts would have to be SUMMED into one number, and the reader returns
ONE optional count. The recursive alternative (a `sumOf` combinator) was priced at D512 and refused
for two measured reasons: it gives two shipped members a SECOND spelling each (D159), and it makes
the evaluator's `switch` total over the KINDS but no longer over the VALUES — which is the
exhaustiveness the switch was worth having.


### Stage by listing what changed, not by listing what you remember changing (D512)

At D512's ritual the caller staged eight explicit paths — including
`scripts/mutation/mutants.ts` — and missed **`scripts/opaque-anatomy.ts`**, which carried a real
change from the same slice. The commit went in incomplete and a whole-corpus sweep was launched on
the resulting dirty tree. **Eight mutant rows target that file**, so the run would have reported
**8 SKIPPED-DIRTY** and broken a prediction that had already been committed.

⚠️ **The check that would have caught it ran, printed the file, and was read past.** The staging step
ended with:

```
git status --porcelain | grep -v '^[MA] ' || echo "nothing unstaged"
```

which emitted ` M scripts/opaque-anatomy.ts` — and the next line of output, `scope clean`, was the
one that got read.

**The rules:**

1. **Derive the path list from `git status`, do not compose it from memory.** `git add` with explicit
   paths is right (never `git add -A`), but the list must come from what the tree reports.
2. **Make the unstaged check FAIL, not print.** A line that emits a warning among other output is a
   line that gets skimmed. Prefer something that exits non-zero, or read `git status --porcelain`
   once and confirm every line begins `M ` or `A ` before committing.
3. **`git status --porcelain` immediately before `setsid`.** A sweep is three hours and its
   prediction is already committed; a dirty tree invalidates it silently until the summary line.
4. ✅ **Recovery is cheap and safe**: `kill -TERM` the sweep — the harness traps it and restored in
   **2 s** at D512 — then amend, re-verify, relaunch. Nothing was pushed, so amending is correct.

**The self-description worth keeping:** `0 skipped(dirty)` in a sweep's summary is not decoration —
it is the line that proves the run saw the tree you committed.


## A SET-LEVEL constraint lives at the PROMPT, and an op field alone is invisible to the validator (D513)

D513's brief asked where *"the picks are pairwise type-distinct"* could honestly live and offered
two candidates: **a new optional field on the op** (D125's widening) **or the prompt/choice layer,
if the park that asks the player to pick already validates the answer**. The measurement is that
the question is not a choice, and the answer has been written down since D332:

> `interpreter.ts`, `chooseCards.caps`: *"**IT IS A PROMPT FIELD AND NOT AN OP FIELD, WHICH IS THE
> WHOLE COST OF THE DRAYTON ROW.** `validateChoice` (cardplay.ts) matches a wire answer against the
> PROMPT and nothing else — that is the architecture, and it is what a P4 client is checked by. A
> cap that lived only on the op would be invisible there… **The op field and this one are two
> halves of one narrowing and neither is useful alone.**"*

And `validateChoice`'s own `chooseCards` arm says *"this is the ONLY place they can be enforced"*.

**So: YES, the park validates — against the PROMPT, never against the op.** `filter` is enforced
only transitively (membership in `prompt.candidates`, computed at park time), `max` as `prompt.max`,
`exact` as `prompt.min`, `also` as `prompt.caps`. **No code on the resolve path calls
`matchesFilter` at all.** A constraint added to an op and not mirrored into the prompt is a
constraint a crafted frame walks past.

🛑 **The corollary that decided D513's price: a DISTINCTNESS relation over a FINITE PARTITION is
already expressible in the shipped vocabulary.** `caps` is `{ uids, max }[]` — a cap on how many
picks may come out of a named uid set — so *"of different types"* is one cap of **ONE** per type
cell. The slice cost one optional anchor group, one optional op key, one partition in the park and
one caption parameter, with **zero** new prompt fields, validator branches or client mirrors.
D457's *"a PROMPT field costs five mirrors; an OP field costs none"* prices it at the cheap end
**because no prompt field is added at all** — the cost was paid at D332 and this is its second
producer.

⚠️ **What does NOT transfer, measured rather than assumed:** the sibling `attachFromDeck` family
parks the compound `attachCards` prompt, which has no `caps` of its own. A mechanism that reaches
one park does not reach its neighbour just because the printed phrase is the same.

## "No filter can express it" is a claim about the KIND of constraint, not about the union's membership (D513)

`CardFilter` is answered by `matchesFilter` **one uid at a time**. *"of different types"* is a
predicate on the ANSWER SET, so it is false of no card and true of no card — **widening the union
however far never reaches it.** That is a different statement from *"the union is missing a
member"*, and the difference is not academic:

🛑 **Two shipped refusal comments in `effects.ts` and one pinned test reason named a *"distinctness
`CardFilter`"* as the missing carrier** — a work order pointing at a union that could never have
carried it. One of them sits **three lines below** that same file's own warning that *"a 'cannot'
that names the wrong carrier reads as a fact about the sentence"* (D456, quoted there). All three
were corrected in place (D178/D457/D466/D508).

**The rule:** before recording *"this needs a new `X` member"*, ask whether the printed relation is
**per-item or across-items**. A per-item predicate is a member; an across-items one is a different
layer, and naming the wrong one sends the next three slices to the wrong file.

## D510's anchor rule pays a second time, and TWO PRINTINGS OF ONE PHRASE can be blocked at DIFFERENT LAYERS (D513)

D510: *"before pricing a residue row, `exec` its family's shipped anchors against the printed
bytes."* Run before D513 touched anything, `ATTACK_HAND_SEARCH` **matched** corpus line 473 and its
`([^,.]+?)` noun group captured `Basic Energy cards of different types` **whole** — the class
excludes a comma and a period and the printed phrase contains neither. So the sentence had reached
that reader **since D231** and died one step later, in `HAND_SEARCH_PLURAL.get`. The new optional
group admits nothing the old pattern refused; it MOVES a phrase out of the noun so the closed table
is asked about a noun it can name. *(Asserted executably: the pre-slice pattern is reconstructed in
the suite and both patterns are shown to match the same set of 640 legal sentences.)*

🛑 **And the other printing of the same phrase is blocked somewhere else entirely.** Corpus line 472
reaches `DECK_SEARCH_ATTACH`, whose `Energy cards and attach them` is **welded**, so that pattern
does not admit the phrase at all — on top of the `Tera` banner. **Two rows, one printed phrase, two
layers**, so building one says nothing about the other. A residue pass that groups rows by their
printed text will price them as one slice and be wrong.

## A lattice can CHANGE SHAPE across its own slice, and the change IS the price (D513)

Every lattice on the register has been reported as ONE vector. D513's 2⁵
(NOUN × DISTINCTNESS × REVEAL × OPENER × COUNT) is **16 of 32 before and 24 of 32 after**, and the
flip tables are different SHAPES:

| state | flip table (of 16) | shape |
|---|---|---|
| PRE | `NOUN 0 · DISTINCT 16 · REVEAL 0 · OPENER 0 · COUNT 0` | **D505's seventh** — one blocking axis on a free 2⁴ |
| POST | `NOUN 8 · DISTINCT 8 · REVEAL 0 · OPENER 0 · COUNT 0` | **D507's eighth** — a conjunctive pair |

The NOUN axis was **free** (0/16) and became **live** (8/16) because the slice added a guard that
refuses a non-Energy distinctness. 🛑 **Read as D508 reads a flip table — a 0/16 axis is free to
spell, and every axis that flips anywhere is a literal owing a *"printed zero times"* measurement —
the shape change is exactly the guard's price: one axis moved off zero, so the slice owes one
measurement and no more.** That is a sharper price than "the guard costs a few lines", and it comes
out of the instrument rather than out of a judgement.

**Report both tables when a slice adds a REFUSAL.** A slice that only widens leaves the flip table's
zeros where they were; one that also narrows moves an axis off zero, and that is the part a
successor needs to know about.

## A census step rots pins in WAVES, not just in shapes — count the rounds, not the sites (D513)

D508 found that a census step rots pins in five different SHAPES. D513 found the orthogonal fact:
because **vitest stops an `it` at its first throw** (D462), the same round of edits reveals only the
FIRST stale rung in each `it`. D513's single-printing step took **FOUR full suite rounds** —
26 failures, then 19, then 9, then 7 — and the later waves were the *second, third and fourth*
assertions inside `it`s whose first assertion had just been fixed. Several were in files already
edited in the previous round.

- ⚠️ **A green round is not evidence the step is complete until a round produces ZERO failures.**
  "I fixed every file that failed" is a statement about one round.
- ⚠️ **When a file's chain is one very long line holding BOTH a sentence chain and a printings
  chain, fixing the first leaves the second on the same line** — `retreatCostBonus.test.ts` needed
  three separate terms on two lines and reddened once per round.
- **Budget the rounds.** At ~140 s a round, a one-printing census step is ten minutes of suite time
  before any of the real work is checked.

## `re.sub`'s replacement string interprets backslashes — D462's rule, in Python (D513)

D462 recorded that `String.replace(find, replacementString)` interprets `$` in the REPLACEMENT.
Python's `re.sub` has the same hazard one character over: **`\\d` in a replacement string is
processed as an escape**, so splicing a mutant `find` that quotes a regex source line silently
halves its backslashes. The symptom is a `precheck` report of `find occurs 0×` on a row you just
wrote, with a `find` that LOOKS right.

**Use a literal splice — `s[:m.start()] + new + s[m.end():]` — whenever the replacement contains
a backslash.** The same applies to `str.replace` in JS and to `sed`. And re-run `precheck` after
every mutants edit, not after the batch.

## A lattice cannot price a guard on a value OUTSIDE its own axis set (D514, sharpening D513)

D513 established that a slice which NARROWS moves an axis off zero in the flip table, and that the
move IS the guard's price. D514 narrows too — `namedCardNounFilter` refuses the three printed FACE
BANNERS, which is the one axis D440 refused `^(.+) card$` on — and its flip table goes the other
way:

| state | flip table (of 8) | built |
|---|---|---|
| PRE | `OPENER 0 · COUNT 4 · NOUN 4 · REVEAL 0` | 4 of 16 |
| POST | `OPENER 0 · COUNT 0 · NOUN 0 · REVEAL 0` | **16 of 16** |

**Every axis ends FREE and nothing is owed — and that reading is wrong.** The lattice's axes are the
PRINTED SENTENCE'S OWN variation, and `Ancient cards` is a value this sentence never takes, so the
guard is invisible to the instrument by construction.

🛑 **An all-zero POST flip table means *"no axis this sentence varies over is load-bearing"*, NOT
*"this slice narrowed nothing"*.** When a slice adds a refusal whose subject is outside the axis
set, the *"printed zero times"* measurement is still owed and must be paid BY HAND, with the
omission recorded next to the table — otherwise a successor reads `[0,0,0,0]` as *"cost nothing"*
and deletes the guard. D514 pays it in its suite's §1 (no deck-search row in the 640-sentence column
names `Ancient`/`Future`/`Tera` as its noun) and says so in the lattice rung itself.

## The CHEAPER-LOOKING ROAD can be the one that pays the same field (D514)

D514's brief offered two roads: one more REGISTRY row (cheap, bespoke, linear in printings forever)
or a reader arm. The registry road looked strictly cheaper and it was not, for a reason that is only
visible by reading the sibling's PROGRAM rather than its verdict.

The bench twin (`sv09-068`) is a registry row and spells its printed *"any number"* as
`max: BENCH_MAX` — sound **because the DESTINATION supplies a cap**: a bench-bound search is clamped
to `benchSpace` in two places, so `BENCH_MAX` is the largest value the sentence can ever mean. **A
HAND has no cap at all.** So the hand printing has no number a registry author could write down, and
the registry road would have had to widen `searchDeck.max` anyway — or ship a caption naming a
number the card does not print, which D190b ranks below an unbuilt row.

🛑 **Price a road by the FIELDS it forces, not by the file it edits.** *"A registry row is a
hand-written program, so it costs no engine change"* is true only when a value already exists that
the program can name. Read the sibling row's actual literal and ask WHY that literal is sound; if the
reason is a property of its destination, its zone or its noun, it does not transfer.

## D510's anchor habit answered YES for the first time — and the blocker was a CONJUNCTION (D514)

Four slices have now run the shipped anchors against the row before pricing it. D510: matched since
D440. D513: matched since D231, died in a `Map.get`. D512: answered **null** at the pattern. D514:
also **null** — and this is the first time the anchor really was A blocker.

🛑 **It was not THE blocker, and stopping at the first null would have under-priced the row by
half.** Repair the count alone and the same pattern matches, captures the noun whole, and dies one
step later in the very `HAND_SEARCH_PLURAL.get` that killed D513's row. Two layers, and the 2⁴
lattice says the same thing independently — COUNT and NOUN each flip the verdict at **4 of 8** cells,
D507's CONJUNCTIVE signature.

**When the anchor answers null, repair THAT axis and run it again.** One `exec` more, and it is the
difference between *"the anchor is the blocker"* and *"the anchor is the FIRST of two blockers"*.
⚠️ And the corollary for a refusal list: this row's recorded deferral reason named **both** blockers
(*"`byName` at an UNBOUNDED max the `(\d+)` group cannot spell"*) and was still filed under a
heading that said the remaining rows were *"ALL NOUNS"*. **Read each entry, never the heading** —
that heading has now been wrong in the same direction twice (D513, D514).

## A census step can take SIX rounds, and a round is not cheap (D514, extending D513)

D513 measured four full suite rounds for a one-printing step. D514's two-printing step took **six**:
**26 → 21 → 10 → 7 → 1 → 0** failing tests, at ~180 s a round. The last two rounds were single
assertions — a percentage whose DENOMINATOR had shrunk while its numerator stood still, and a
`BUILT.attack - …` subtraction chain in an `it` whose earlier rungs had only just been fixed.

- **Budget the rounds**, and do not treat a small round as evidence you are nearly done: rounds 5
  and 6 revealed one rung each and were the two that mattered most (the `inRows` check is what says a
  build left the residue WITHOUT leaving any tabulated row).
- ⚠️ **A percentage rung reddens on a step it has no numerator in.** `Math.round((inRows /
  unbuiltAttack) * 100)` moved 23 % → 24 % because the DENOMINATOR fell. Say which half moved in the
  note, or the next reader records a numerator that never changed.

## `biome check --write` on an EXPLICIT path still reformats a file the repo has never formatted (D514)

The standing rule is *"never run a whole-tree formatter; format explicit paths only"*. **That is not
sufficient**, and D514 paid for the difference. `bun run check` runs `biome lint` and has **no
formatting step**, so most long-lived files are not format-clean. Running `biome check --write` on
four explicit paths rewrote **5,527 lines of `scripts/mutation/mutants.ts`**, 280 of `effects.ts` and
144 of `interpreter.ts` — and broke **26 mutant `find` strings**, because a `find` is exact source
text and the formatter had moved it.

- **On an EXISTING file run `bunx biome lint <paths>` — no `--write`.** That is what `check` runs and
  it is the only thing the repo is green under.
- **`--write` is for a file this slice CREATED**, where the whole file is the diff anyway.
- **Recovery is `git show HEAD:<path> > <path>` plus re-applying the slice's own edits** (never
  `git checkout --`, never `git restore` — see *"Working beside other agents"*). Save the current
  bytes to scratch first; the re-apply is scripted, the lost work is not.
- ⚠️ And the symptom arrives at `precheck`, not at `check`: a formatted tree is still GREEN.

### `biome --write` on explicit paths is still a whole-file rewrite (D514, sharpening D511)

D511 established *"format explicit paths only"* after a bare `biome format . --write` rewrote 360
files. **That rule was necessary and not sufficient.** At D514 a builder ran `biome check --write` on
**explicit paths** — obeying D511 — and it **rewrote 5,527 lines of `scripts/mutation/mutants.ts` and
broke 26 mutant `find` strings.**

The reason is that `--write` does not format *your change*; it formats **the file**. In a repo with
**no formatting step in `check`** (D511), almost every existing file is unformatted, so naming it as
an explicit path is naming a whole-file rewrite.

**The rule:**

1. **On a file that already existed: `bunx biome lint <path>` with NO `--write`.** Read the
   diagnostics and fix by hand.
2. **`--write` only on files the slice CREATED**, where a whole-file rewrite is the whole file you
   just wrote.
3. ⚠️ **`mutants.ts` is the worst possible target**, because a mutant `find` is a dependency on exact
   bytes in another file and **nothing type-checks it**. `precheck` is the only instrument that knows
   — and it is **not part of `check`**.
4. **Recovery without the forbidden commands**: `git show HEAD:<path> > <path>`, then re-apply the
   slice's edits. No `checkout`, no `restore`, no `stash`, no `reset`.

### Line-level diff stats overstate change in a file of repeated records (D514)

While D514 was building, `git diff --numstat` reported **+3140 / −2387** on `mutants.ts` — a file
whose slice added nine rows. That looked like the D492 mass-edit signature and was investigated as
one.

It was not. Comparing the **records** rather than the lines showed **every one of the 2,566
pre-existing rows byte-identical**, with only added rows accounting for the change. `mutants.ts` is
thousands of structurally near-identical blocks, so inserting rows mid-file makes the diff matcher
re-align large regions and report them as delete-plus-add of content that never moved.

⚠️ **A naive cross-check misleads here too**: "how many removed lines reappear among added lines"
reported 12%, because identical lines recur many times across records and multiset overlap does not
track them.

**The rule: for a file of repeated similar records, diff line counts are not a measure of semantic
change. Parse the records and compare them by key.** A one-line extractor over `id:` blocks answered
in seconds what the line stats could not answer at all.

⚠️ And note the honest limit found the same day: such an extractor has its own blind spot — D514's
missed **8 of 2,583 rows** at both revisions because they close at a different indentation. It was
usable because the miss was *identical on both sides*; a one-sided extractor would have invented a
difference.


## D510's anchor habit has a THIRD layer, and only that layer fails SILENTLY (D515)

D512 answered **null**. D513 matched and died in a `Map.get`. D514 answered null, then matched once
the count was repaired. D515 has **three**:

| layer | question | answer | how it fails |
|---|---|---|---|
| 1 — the anchor | does any shipped reader or splitter claim the print? | **no**, 13 readers × 4 splitters, all null | LOUDLY (`ATTACK_EFFECT_SKIPPED`) |
| 2 — the composition | repair the documented widening in a scratch copy — does it reach? | **yes**: the pattern matches and the captured consequent is ITSELF claimed | LOUDLY |
| 3 — the describer | does `describeBranch` have a phrase for the consequent op? | **no** | **SILENTLY** |

🛑 **THE THIRD LAYER IS THE ONE A CENSUS CANNOT SEE, AND IT IS THE ONE THAT BLOCKED THE ROW.** A
missing describer arm does not throw, does not return null from the reader, and does not move any
count. It degrades the parking prompt's caption to bytes an honest program **also** produces — here,
the gated payment's note collapsed to exactly the ungated payment's note — so the sentence reads as
built while the dialog stops saying what the price buys. **When the anchor probe answers "no" at
layer 1, keep going: repair, re-run, and then ask what reads the VALUE the arm would produce.**

## A refusal that names its blocker by NAME is a work order with a receipt (D515, contrasting D486)

D473 measured the widening that would claim this row and refused it in one clause: *"a different op
that `describeBranch` has no phrase for, so the park's caption would silently degrade to the bare
cost while the sentence read as claimed."* Forty-two decisions later **every word of that was still
true**, and paying the named blocker was the whole slice.

⚠️ **THAT IS THE OPPOSITE OUTCOME FROM D486's AND D505's, AND THE DIFFERENCE IS WHAT THE REFUSAL
NAMED.** D486's deferred reason named a *condition of the splitter* and was true-but-not-the-blocker;
D505's named a persistence fact and read it as an expressiveness one. **D473's named a FUNCTION.** A
refusal that names a function, a field or a line is checkable in one command and ages well; a refusal
that names a property of the sentence ages badly. **Prefer the former when you write one**, and when
you inherit one, check which kind it is before re-deriving the whole price.

## A THIRD lattice PHENOMENON: one axis moves ONTO zero while another moves OFF it (D515)

⚠️ **THIS IS A PHENOMENON, NOT A TWELFTH SHAPE** — the shape register is eleven long and D513's
shape-change and D514's outside-the-axis-set guard are phenomena beside it, not entries in it. Say
which you are adding, because an ordinal nobody re-derives is the figure that rots (D488).

D513 established that a narrowing moves an axis from free to live. D514 found the case where the
narrowing is invisible because its subject is outside the axis set. D515 does both at once:

| state | built | flip table (of 8) |
|---|---|---|
| PRE | 6 of 16 | `OPENER 6 · GATE 6 · CONSEQ 2 · COUNT 0` |
| POST | 7 of 16 | `OPENER 7 · GATE 7 · CONSEQ 1 · COUNT 1` |

**CONSEQ falls to 1 because the widening retired a cell; COUNT rises to 1 because the slice spells
the consequent's count out instead of capturing it.** The two moves are independent and a slice that
reported only the total (6 → 7) would have shown neither. ⚠️ **A flip table is not a scalar — read
it per axis on BOTH sides**, and pay the *"printed zero times"* measurement for every axis that ends
non-zero (here: the column prints no gated plural, measured over all 640 sentences).

⚠️ **AND D503's RULE EARNED ITS KEEP AGAIN**: the readers-only reading of the same lattice is
2 → 3 of 16, and the two predicates disagree at **4 of the 16 points** — every one of them a
gate-less point that `splitAttackTrailingClause` composes out of a claimed head and a claimed tail.
The slice's arm touches none of the four. A readers-only lattice would have reported a different
shape for this sentence.

## A census step can take SEVEN rounds (D515, extending D513/D514)

D513 counted waves; D514 counted six rounds. D515 took **seven** `vitest run` rounds to close, and
the last three were single assertions each. The reason is structural and worth stating: **vitest
stops an `it` at its first throw**, so a chain with N stale operands can only surface one per round,
and a file with M sibling chains can only surface one chain per round. **The stopping rule is a
GREEN run, never "the count I expected stopped appearing"** — and a round that fixes one site and
goes green is evidence the runner stopped early, not evidence the pass is done (D462/D431).

## Count the CANDIDATES, not the cards — `payFromHand` collapses interchangeable copies (D515, applying D416/D464)

A board built by taking N cards off the deck bottom can hand a payment N copies of ONE card id.
`handCostCandidates` keeps at most `count` copies per `cardIdentity`, so the offer collapses to one,
`parkOrForce` resolves it inline, and **the suite silently exercises the FORCED path while reading as
the parked one**. D515's first draft did exactly that and the symptom was a `WRONG_SEAT` error from a
park it did not expect. **Name the card ids when a board must park**; a count is not a board.

⚠️ **AND READ THE DISCARD PILES, NOT THE HANDS, AFTER A SETTLED ATTACK** (D491): the attack ends the
turn [🆕 D570 (D539): except a FIRST attack under Festival Lead with Festival Grounds in play, which opens the attack-again window instead] inside the same action, so the defender's turn-start draw lands before the state is observed and
their hand comes back one HIGHER than it went in. A hand-size assertion written the obvious way is
off by one in the direction that looks like the effect failing.

### In `effects.ts`, a regex over raw text measures the commentary too (D516, naming D506's mechanism)

D506 established that *a verifying regex must be at least as permissive as the one it checks*. D516
found **why that keeps happening in this repo specifically**, after **four consecutive failed
attempts by the caller to enumerate one union**:

**`effects.ts`'s doc blocks quote code-like prose.** They contain `type`, `kind: "…"`, `{ op: … }`
and whole sentences about types. So a regex run over the raw file matches **the commentary as well as
the code**, and the failure is silent — it returns a shorter list, never an error.

Two measured instances from one slice:

- A window-limited enumeration of `DamageCountSource` reported **6 members**, and a brace-aware walk
  reported the same, because both terminated on punctuation inside a doc comment. The union has
  **19**.
- Twice the extraction reported `cardsInOpponentHand` **absent** — moments after the caller had
  watched that exact kind derive live from `deriveAttackDamageMultiplier`.
- A search for the nearest preceding `type ` declaration anchored on the words *"type would have to
  change"*, **inside a comment**.

**The rules:**

1. **Prefer asking the type over parsing the text.** `count: DamageCountSource` at the field's
   declaration settled in one line what four regexes could not.
2. **Prefer driving over reading.** A value that derives live is proof of membership; an extraction
   that disagrees with a live derivation is wrong, and the derivation wins.
3. If you must parse, **strip comments first** — and treat a shorter-than-expected list as a
   suspected instrument failure, not a finding.
4. ⚠️ **A disagreement between your extraction and someone else's is not evidence they are wrong.**
   Resolve it to a cause. At D516 the caller's four attempts all lost to the builder's one.

### A refusal that names a function ages well — second confirmation (D516, with D515)

D515 found that **D473 named its blocker 42 decisions early and was right in every clause**, because
it named *what was missing* rather than *what the text looked like*. D516 is the same result on a
different row: **`SHUFFLE_HAND_DRAW`'s D479 doc block names the row, names the axis, enumerates the
four existing members, concludes "that row needs a fifth member" — and drives that refusal as an
executable falsifier.** 37 decisions later it was exactly right.

⚠️ **And the operational half, which cost real time at D516:** the row carried **three** shipped
witnesses, and only one of them reddened when the row was built. **A pass that chases only the rung
that goes red leaves the others green and wrong.** When a refusal is overturned, **sweep every rung
that carried its unbuiltness as a premise** — they are findable because a function-shaped refusal
names the thing they all depend on.


### The "gate arm" is a closed four-entry timing list, not a general `If …,` splitter (D517)

> 🆕 **D545 — THE "FOUR-ENTRY" AND "TIMING-ONLY" HALVES OF THIS RULE ARE WITHDRAWN; THE "NOT A GENERAL
> SPLITTER" HALF STANDS.** D517's bytes are kept below as written (dated). What changed:
> - The list was already **five** rows at D541 (`54e67649`, the Angelite trailing-gate row) — measured off
>   `git show`: 4 at D517 (`53dde5bc`), 5 at D541, 5 at D544 (`0f4d7257`).
> - D545 added rows **six and seven**, and they are **COST** clauses, not timing clauses — two leading
>   `If …,` sentences, `censusAttackCorpus.ts` `:316` (*"If this Pokémon has any damage counters on it,
>   this attack can be used for {F}."*) and `:324` (*"If this Pokémon is affected by a Special Condition,
>   ignore all Energy in this attack's cost."*), each claimed WHOLE (`body: ""`, D395's path) and mapped
>   to the NON-BLOCKING `AttackTimingGate` members `alternateCostIf` / `costWaivedIf`, read by
>   `attackCostAt` (`attack.ts`). So *"all about turn timing"* and *"a leading comma clause of any other
>   kind never reaches it"* are false at D545's head for exactly those two strings.
> - **What still holds, and is the rule to keep:** the list is **closed** and matched **whole** (or with a
>   trailing space). A leading `If …,` clause reaches the gate arm **only if its exact whole sentence is a
>   row**; any other conditional sentence still prices on the **reader** arm. Consequence 2's *"not a
>   growth area"* is withdrawn with it — the arm stood at 7 sentences / 17 units at D544 and is 9 / 19 at
>   D545 — but "expect the reader arm" stays the default: a new gate row is a deliberate design choice
>   (a new `AttackTimingGate` member plus a total `ATTACK_GATE_CLAUSE_GATES` entry), never an accident.
> - ⚠️ A new `AttackTimingGate` member that is NOT a block must be excluded from `BlockingAttackGate`
>   (`interpreter.ts`) on purpose, or the attack is REFUSED exactly when its condition holds (D545's trap).

`builds()`'s third arm is `splitAttackGateClause`, and its name invites a wrong model. D517's brief
asserted that a sentence opening *"If you have exactly 1 Prize card remaining, …"* therefore "lands on
the gate arm". **It cannot.**

`ATTACK_GATE_CLAUSES` (`effects.ts`) is a **closed list of four whole printed sentences**, all about
**turn timing**:

```
"If you go second, you can't use this attack during your first turn."
"If you go first, you can use this attack during your first turn."
"You can use this attack only if you go second, and only during your first turn."
"You can use this attack only if this Pokémon used Rollout during your last turn."
```

It matches whole-string or with a trailing space. **A leading comma clause of any other kind never
reaches it** — measured null at 16/16 lattice cells and on all six members of the prize-gate family.

**Consequences worth holding:**

1. **A printed `If …,` gate is ordinary reader work**, not splitter work. D517's row is claimed whole
   by a `deriveAttackEffect` arm emitting a `conditionGate` op — a *runtime* gate, which is a
   different thing from the *parse-time* gate the arm is named for.
2. **The gate arm has stood at 5 sentences / 13 printings for many slices and is not a growth area.**
   When pricing a conditional row, expect the **reader** arm.
3. ⚠️ **Check which arm a built sibling uses before reasoning from it** (D514's rule, at a new
   address): all three built members of D517's family are reader-arm builds, two through
   `deriveAttackDamageBonus` and one through `deriveAttackRequirement`. **Zero were gate-arm.**

### Grepping the refusal's noun found a rung that had been right for 398 decisions — and was green (D517, cashing D516)

D516 established: **when a refusal is overturned, sweep every rung that carried its unbuiltness**, and
they are findable because a function-shaped refusal *names* the thing they depend on. D517 ran that
grep and found `publicCount.test.ts`'s Slaking V rung, written at **D119** (2026-08-01):

> *"It would want a `yourPrizesRemaining` sibling; nothing here claims it, so it stays loud."*

It named the missing member **by the exact name it was eventually given, 398 decisions early.** D473
aged 42 decisions and D479 aged 37; this is an order of magnitude past both.

🛑 **And it stayed GREEN when the member landed**, because its own sentence is an Ability attack-lock
and remains refused for a different reason. **Nothing would have surfaced it.** A slice that chased
only the rungs that reddened would have left a live, confidently-worded rung telling every future
reader that no member reads your own Prize count — **false the moment the member existed.**

**The rule, sharpened:** after adding a named thing, **grep the name across the whole test corpus**,
not just the files that failed. A refusal naming what is missing is a **standing claim about
absence**, and absence-claims do not fail when the absence ends — they just quietly become lies.


### A printed COUNT over a shipped PREDICATE: take the predicate's walk, and never the model's field count (D518)

Two things came out of building *"This attack does 100 damage for each Special Condition affecting
your opponent's Active Pokémon."* on top of a predicate that had read the same printed noun since
D116.

**1. The predicate is not a cheaper count, and the reason is the EVALUATOR rather than the noun.**
`BoardCondition.opponentActiveHasSpecialCondition` ships and reaches the damage fold through
`DamageCountSource.boardCondition` — but that member is the **0-or-1 indicator** (D115), spelled
`conditionHolds(...) ? bonus.per : 0`. Its ceiling is `per` at every `per`, so no reparameterisation
of a shipped predicate ever pays a per-unit tally. 🛑 **When a row's delta is COUNTING rather than
TESTING, the price is a union member — check the EVALUATOR's arithmetic before pricing it as
"the predicate already ships".**

**2. Derive the count from the predicate's WALK, not from a second reading of the model.** D159 as
this repo applies it (D516, D517, D518 — three consecutive slices): *what D159 makes single is the
walk.* Here the walk already existed. `presentStatuses` (`types.ts`) is the projection the predicate
folds as `.length > 0`; the count folds the same call as `.length`. That makes
**`predicate ⟺ count ≥ 1` true by construction** rather than by two readers agreeing — the same
reason `opponentActiveBurned` and `opponentActiveConfused` ask the projection instead of the fields
(D377). If the two folds *could* disagree on some board, that is a finding; if they cannot, assert
it and say why.

🛑 **THE TRAP, AND IT IS THE WHOLE REASON (2) IS A RULE AND NOT A PREFERENCE: A MODEL'S FIELD COUNT
IS NOT ITS CONCEPT COUNT.** `SpecialConditions` has **four** fields and holds at most **three**
conditions:

| field | contributes |
|---|---|
| `rotation: "none" \| "asleep" \| "paralyzed" \| "confused"` | **0 or 1** — EXCLUSIVE, three printed words share one slot |
| `poisonDamage: number` | 1 iff `> 0` — the amount doubles as Poison's flag |
| `burned: boolean` | 1 iff true |
| `confusionDamage: number` | **0, always** — a PARAMETER of Confusion (D501), not a condition |

A naive set-fields tally reads **4** where the print says **3**, and — because `noConditions()`
seeds `confusionDamage` to `DEFAULT_CONFUSION_DAMAGE` rather than to 0 — it reads **1 on a clean
body**, turning the printed floor of *no damage at all* into a live hit. Both errors are invisible
to every census: the sentence still derives, `BUILT.attack` does not move, and the arm split does not
budge. **Only a board carrying two conditions at once, or a Confused body with a raised amount, can
see it** — which is why the suite drives those boards rather than asserting the arm.

⚠️ **The general form:** before writing `Object.values(x).filter(Boolean).length` over a state
interface, ask which fields are *flags*, which are *amounts serving as flags*, which are *exclusive
enums*, and which are *parameters of another field*. Four shapes, one interface — and the
projection that already knows the difference is usually one file away.


### Settle a "does anything else consume this?" question by DELETING the arm and running `tsc -b --force` (D518)

D515 established that shipped ops do not imply a shipped sentence, because a missing **describer**
arm fails silently. The follow-on question — *which surfaces consume this type?* — is usually
answered by grepping, which in `effects.ts` measures the commentary too (D516).

D518 answered it by **experiment**: delete the evaluator arm, run **`tsc -b --force`**, and read the
error set. Result: **exactly one file, two errors** — so `attack.ts`'s `switch (bonus.count.kind)` is
the sole exhaustive consumer, and `DamageCountSource` has **no describer surface at all**.

⚠️ **The `--force` is load-bearing.** `tsc -b` is **incremental** (D517: it once reported clean over a
test file that did not yet exist), so without it the experiment can answer "nothing consumes this"
when the truth is "nothing was recompiled."

**The rule:** to enumerate a union's real consumers, **break it and ask the compiler**, with
`--force`. It is faster than a grep, it cannot be fooled by prose, and the error set *is* the
consumer list. Pair with D512's census-by-compile-error: **one** error tree-wide means the other
consumers are exhaustive switches; **many** means hand-kept lists.

### A model's FIELD count is not its CONCEPT count (D518)

`SpecialConditions` has four fields:

```ts
rotation: "none" | "asleep" | "paralyzed" | "confused";   // EXCLUSIVE — 0 or 1 conditions
poisonDamage: number;                                      // poisoned iff > 0
burned: boolean;
confusionDamage: number;                                   // a PARAMETER of confusion, not a condition
```

…and represents **at most three** conditions. A printed *"for each Special Condition"* fold that
tallied set fields would answer **2** on a Confused body with a raised confusion number, and deal
double. D518 drove that board: `presentStatuses` returns **1**, the fold deals **100**, not 200.

**The rule:** when a printed noun counts *concepts*, do not count *fields*. Find the shipped walk that
already decides the concept — here `presentStatuses`, the same call behind the shipped
*"is affected by a Special Condition"* predicate — and **take that walk**, so predicate and count
cannot disagree. ⚠️ **A second definition of the same concept is the defect**, even when it happens to
agree today; this is what *"what D159 makes single is the WALK"* (D516/D517) means in practice.


### Grep the refusal's TYPE as well as its NOUN (D519, widening D516's rule 4)

D516 established: when a refusal is overturned, **grep its noun** across the whole corpus, because
absence-claims stay green while quietly becoming lies. D517 cashed that against a rung 398 decisions
old. **D519 found the rule's blind spot.**

D518 refused a row saying it wanted a damaged-body **`CardFilter`** member. The verdict was right and
**the cause was wrong**: `matchesFilter` is handed a **`Card`** (off `topCardOf`), and **a card has no
`damage`** — so no `CardFilter` inhabitant could ever have expressed it. The narrowing belongs on the
**count**.

🛑 **And the correction had been on record for 69 decisions, green the whole time.**
`counterFold.test.ts` (D450) says outright *"a board fact does not have to travel through `CardFilter`
at all"*, naming `matchesFilter(card: Card)` as the reason. **D518's sweep could not see it, because
that sweep was keyed on the printed noun** — and D450's note never mentions the printed noun at all.

**The rule:** after overturning or re-homing a refusal, grep **both**:

1. the **noun** it named (the printed phrase, the member name) — D516's rule; and
2. the **type** it blamed (`CardFilter`, `DamageCountSource`, the function it said was missing).

A refusal that blames the wrong carrier is invisible to a noun-keyed sweep **and** is exactly the kind
most worth finding, because every successor it misleads goes to the wrong layer. Cf. D479's third
failure mode: *true in every clause, wrong about the carrier.*

### `precheck` cannot see a mutant row that is its own experiment (D519)

A D519 row shipped with `find` and `replace` **byte-identical** — an escaping slip while building the
replacement by string surgery. The consequences are worth stating exactly:

- the patch was a **no-op**, so the file was unchanged;
- the suite therefore **passed**;
- and the row reported **SURVIVED**.

⚠️ **`precheck` is blind to this by construction.** It asserts that each `find` occurs **exactly once**
in its target, and that **no two rows are the same experiment**. A row whose `find` equals its
`replace` satisfies both: it occurs once, and it is not the *same experiment as some other row* — it
is its own. **It is well-formed, unique, patchable, and asserts nothing.**

This is **D481's class one layer deeper** (a data error in the corpus that every gate calls healthy).
The only instrument that caught it was the **probe's undeclared-survivor report**.

**The rules:**

1. **Treat an unexpected SURVIVED on a brand-new row as a suspected no-op first**, before blaming the
   killer set — check `find` against `replace` before anything else.
2. **Never build a `replace` by string surgery on the `find`** without diffing the two.
3. ✅ **A corpus-wide sweep for `find === replace` is one line and worth running** after any slice that
   adds rows. D519's caller ran it: **zero rows anywhere**.
4. **The cheap guard is unwritten**: `precheck` could reject `find === replace` outright. Until it
   exists, (1)–(3) are what stands between a vacuous row and a green corpus.


### Enumerate what the log contains; never grep for the token you expect (D519)

Through the whole of D519's 3.1-hour sweep the caller reported *"0 non-KILLED"*, computed with
`grep -cE 'SURVIVED|GAP| ERROR|STALE|CLOBBER'`. The harness spells a declared survivor
**`SURVIVES(known)`** — present tense, parenthesised — so the pattern matched **none of the 50**
and returned 0 for hours while survivors were being printed on screen.

**Why:** the run really was clean, so the wrong number and the right number agreed *by luck*. That
is what makes this class hard to catch and worth a rule: a pattern built out of what you expect can
only ever confirm you, and it is indistinguishable from a correct one on precisely the inputs where
the expectation happens to hold. The same grep would have reported `0 non-KILLED` through a run with
fifty undeclared survivors.

**How to apply:** when you want to know what a log says, enumerate its tokens rather than testing
for one:

```
grep -oE '^  [A-Za-z0-9_.:-]+ +… +[A-Za-z()]+' sweep.log | grep -oE '[A-Za-z()]+$' | sort | uniq -c
```

This proves cleanliness *and* yields the survivor count in one pass, with no guessed spelling
anywhere in it. ⚠️ **Anchor the enumeration to the indented verdict lines.** Once the run's survivor
report prints, its explanatory prose contains both `…` and the word `KILLED`, so an unanchored tally
reads **2576** against a true 2572 — the replacement instrument needs its own scope stated, which is
D519's file-scope lesson recurring one layer out.

### `pgrep -f` matches the command that is doing the asking (D519)

`pgrep -af 'mutation/run.ts'` reported the sweep **alive for twenty minutes after it had exited**.
`-f` matches against the whole command line, and the shell wrapper running the check contains the
literal string `mutation/run.ts` — so the predicate was satisfied by itself.

**Why:** this is the same defect as the two entries above, and naming the three together is the
point. In one session: a survivor grep that could not match the harness's token; a `KILLED` tally
that swept the report's own prose; and a liveness check that matched the checker. **Every one was an
instrument whose scope silently included something it was not meant to measure, or excluded what it
was** — and every one returned a plausible number that happened to be wrong.

**How to apply:** ask for the thing, not for a string that appears near it. For liveness, match the
program rather than any substring of the command line — `pgrep -af '^bun ' | grep 'mutation/run'`,
or check whether the log is still growing (`wc -c` twice), which asks the process's *effect* instead
of its name. More generally: **before believing a measurement, ask what else could satisfy it.**

### During a sweep, nothing that reads the working tree is trustworthy — including tools you did not run (D519)

The mutation harness patches files in place and restores them seconds later, so any read of the
working tree during a run may catch a mutated byte. Verify against `git show HEAD:<path>` instead.

**Why:** this is not only about commands you type. During D519's sweep the editor's language server
reported three `Type '"any"' is not assignable` errors at `prizeGateParalyze.test.ts:574-575`. At
HEAD — and in the tree moments later — those lines are **comments**. Eight mutant rows target that
file, and one was patched in when the diagnostic was sampled. A running sweep therefore manufactures
plausible, specific, entirely false diagnostics.

**How to apply:** the tell is that the complaint names a file the corpus targets
(`grep -c '<file>' scripts/mutation/mutants.ts`). Before acting on *any* tool output that read the
tree during a sweep — yours or the harness's or the IDE's — re-check the same lines through
`git show HEAD:`. And do not edit the tree at all until the run reports: a write mid-sweep is a
CLOBBER.

### A refusal's falsifier is only as good as its premise — ask what the named op HITS (D520)

D507 refused corpus `:601` and named a falsifier: *"the flat arm carries a per-body predicate for a
reason of its own, or a second four-zone print."* Thirteen slices later neither had happened, and the
row was buildable the whole time at **zero** vocabulary — because the premise was wrong. The Active
half never needed *"a per-body board predicate on `damageDefender`'s flat arm"*: that arm hits **one**
body, and *"has any damage counters on it"* asked of one body is the shipped `BoardCondition`
`opponentActiveDamaged` (D115) in the shipped `conditionGate`. A rider on the op would have been a
second spelling of a shipped predicate (D159).

**The rule:** before waiting on a refusal's falsifier, re-derive the premise it stands on. The
cheapest question is *what does the op the refusal names actually HIT?* A one-body question is a
`BoardCondition`; a many-body question is a rider on the walk. D507's own note (a) had already said
the self-exclusion was structural — and then priced the row on the wrong carrier. This is D479's
third mode (true in every clause, wrong about the carrier) with D518→D519's shape, one slice later.

### A lattice over AXES is blind to the anchor's ENDS (D520)

The 2⁵ lattice deletes and substitutes printed axes, so every point starts with `This attack` and ends
with the parenthetical. Two rows that drop `^` and `$` from the anchor SURVIVED the first probe —
`find ≠ replace` had been asserted first (D519 (4)(a)), so it was a suite gap and not a no-op.
**Write the both-ends rung explicitly**: a prefixed print and a suffixed print each derive null.
D519's §1 carried it; a suite that copies the lattice without it is green under both mutants.

### ⚠️ FALSE (D532 close-out / D533): The harness type-checks a `replace`, so a mutant that drops a REQUIRED field is ERROR, not a verdict (D520, applying D476)

`then` is required on `conditionGate`, so a `then → otherwise` row would report ERROR rather than
KILLED or SURVIVED. Cover the polarity from the other side instead (the gate removed; the gate's seat
mirrored), and say in the batch header why the obvious row is absent.

> ⚠️ **THE HEADING IS FALSE (D532 close-out, corrected at D533).** `run.ts` does not type-check a
> `replace`; it reads the killer's exit code, and ERROR is only a bad path, a stale `find` or a red
> baseline (`run.ts:402`/`:611`, `:460`/`:463`/`:499`/`:522`). A `replace` that drops `then`
> transpiles and RUNS. **So D520's `then → otherwise` row is WRITABLE after all** — it would report
> a real verdict, and `binding-gate.ts` (D533) does not stand in its way because it names no unbound
> identifier. Writing it is a follow-up, OUT OF SCOPE for D533 (an instrument slice). The
> other-side rows D520 wrote in its place stand on their own.
>
> ✅ **WRITTEN AT D534** — `D520-four-zone-gate-polarity-swapped` (decision D534, zero engine
> bytes): `then: []` plus an `otherwise` arm carrying the Active's hit, never the literal key
> rename; killed by `fourZoneSpread.test.ts` and census-silent. It is distinct from C4 (the gate
> removed) and C8 (the gate's seat mirrored).

### A `replace` that names an identifier its file does not have is killed by the compiler, not by the suite (D532 close-out, applying D416)

D532's sweep came back ONE short of its prediction (`2700 · 52 · 1 GAP` against `2701 · 52 · 0`) and
the survivor was not a D532 row. `D445-log-row-derives-the-actor` (`log.ts`, `row(event.actor, …)` →
`row(otherSeat(event.seat), …)`) had reported KILLED on 87 consecutive sweeps with its producer, its
arm and its killer suite byte-unchanged. What changed at D532 was one import line: `log.ts` gained
`otherSeat` for `energyHostName`. Until then the `replace` named an identifier `log.ts` neither
imported nor defined, so every "kill" was a `ReferenceError` thrown at the mutated line the first
time the suite reached it. The harness reads the exit code (`run.ts` `green: code === 0`;
`const killed = !mutated.green`) and vitest transpiles with esbuild without type-checking, so a
missing name is neither ERROR nor a compile failure — it is a runtime throw that reads exactly like an
assertion going red. (The heading above says the harness type-checks a `replace`; what `run.ts` does
is read the exit code of `expectKilledBy` under vitest, and ERROR is reserved for a `find` that no
longer resolves, a red baseline or a bad path — a `replace` that would not type-check but transpiles
RUNS.) The true status was EQUIVALENT — the event has ONE producer, which binds `actor` to
`otherSeat(seat)` — and it was declared at the close-out with `expectKilledBy` kept. This is D416's
*a row that dies for the wrong reason is worth less than one that survives, because it reports
success*, and D519's right-verdict-wrong-carrier mode, on a mutant row rather than a refusal. D388's
session log had already said it (*"a mutant that cannot run is not a mutant that was caught … ASK OF
EVERY MUTANT: WOULD THIS COMPILE AND RUN?"*) and it never became a rule. This is the rule.

**A `replace` may only introduce identifiers the target file already imports or defines.** If it
introduces one it does not, the kill is the compiler's (a `ReferenceError` at the mutated line), not
the suite's — the row reports coverage the suite never earned, and it will show its true status the
day the file imports that name for an unrelated reason, as D445's did 87 decisions later.

**The class, swept at the close-out (nothing fixed):** for each undeclared row, the identifiers its
`replace` introduces that its `find` does not carry (comments, string and regex literals, member names
after `.`/`?.`, keywords and builtins stripped), flagged when absent from `git show HEAD:<file>` with
the `find` span removed. 2,700 rows scanned; 447 introduce at least one identifier; **19 flagged**, of
which **three are true members** (⚠️ **WRONG — THE CLASS WAS SEVEN; see the correction below**) — `D242-gate-read-off-the-catalog-past-the-ability-lock`,
`D252-effects-off-top-card` and `D278-predicate-bypasses-the-ability-lock` each call `programFor(...)`
in `interpreter.ts`, which is exported only from `registry.ts` and has never been imported or defined
in `interpreter.ts` (`git log -S programFor -- packages/engine/src/interpreter.ts` is empty) — so all
three are KILLED today by the missing name and their true status is unknown until each is re-probed
with a temporary import. The other 16 are names the `replace` itself defines (9), object-literal keys
(4) and prose or regex text the stripper did not classify (5).

> ⚠️ **D533 CORRECTION — SEVEN TRUE MEMBERS, NOT THREE, AND THE RAW-TEXT SWEEP MISSED EACH OF THE
> FOUR EXTRAS FOR ITS OWN REASON.** Read by the D533 judge and flagged by the built gate at HEAD
> (`FLAGGED 7`): **D242, D252, D278** (`programFor`, imported TYPE-ONLY in `interpreter.ts` — the
> registry import must stay type-only, so `git log -S` was right that it was never a value there);
> **`D377-confused-reaches-for-isImmobilized`** — `isImmobilized` is defined in `types.ts` and appears
> in `interpreter.ts` only in a COMMENT, which a raw-text "absent from the file" test counts as present;
> **`D226-one-event-for-every-source`** (reads `moved`) and **`D237-bench-clamp-dropped-at-the-move`**
> (its `replace` deletes `const moved` while the function below still reads it) — `moved` is declared
> in OTHER functions of the same file, so "absent from the file" is false and the out-of-scope read
> passes; and **`D232-random-discard-anchor-drops-the-apostrophe-class`** — the DELETION direction: its
> `replace` dropped the `const ATTACK_RANDOM_DISCARD_FROM_HAND = ` prefix while `effects.ts` still
> reads the name, and a scan of the identifiers a `replace` INTRODUCES cannot see a binding that went
> away. All seven were re-spelled at D533 and each now dies by ASSERTION (probed `--only`, no
> `ReferenceError` in any failure); none is equivalent, so no survivor declaration was owed.

**✅ BUILT AT D533: `precheck` now rejects such rows** through `binding-gate.ts` — see the D533 section
below. (Was: *"Next instrument slice, not built here: extend `precheck` to reject such rows … Until it
does, the check is by hand, and the sweep script above is the hand."*)

### A `replace` may only name what its file binds — and the gate that says so is a FLOOR (D533)

`scripts/mutation/binding-gate.ts`, called from `precheck` as its fourth property (after `find` ×1,
the splice gate and the partition gate), re-parses with the TypeScript compiler API the TOP-LEVEL
statement(s) each row's `find` overlaps, before and after the patch, and checks two directions:

- **INTRODUCTION** — a value-position identifier in the mutated region bound by none of: the
  region's own declarations (params, `var`/`let`/`const`, destructured names, function/class names,
  catch vars), the file's OTHER top-level declarations, its VALUE imports (`import type` and
  `{ type X }` bind nothing at run time), or `globalThis`. Taken BY DIFFERENCE against the original
  region, so a name already unresolved there (`expect` in a suite) is never the row's fault.
- **DELETION** — a name the original region declared at top level and the mutated one does not,
  still read by another top-level statement and declared by none (D232's shape).

Only `Identifier` nodes are visited, so comments, strings, templates and regex text drop out by
construction; member names after `.`/`?.`, object keys, class and enum members, binding property
names, labels, import/export specifiers, JSX attribute names and lowercase JSX tags are not
references; type nodes are skipped. **No hand-kept exemption list.** Measured at HEAD before the
re-spellings: **FLAGGED 7** — exactly D226, D232, D237, D242, D252, D278, D377 — and **0** after.
Runtime about 9 s over ~2,750 rows (per-file and per-region parses cached).

**⚠️ IT IS A FLOOR, NOT A PROOF.** Scope is top-level-statement granularity: a same-named binding in
a SIBLING nested function inside the same top-level statement masks a miss. It does not type-check
either — a `replace` that drops a required field passes it (and RUNS, see the D520 correction above).

**🛑 A GATE ROW MUST GO RED FOR ITS OWN REASON (D484's note, applied).** The corpus is clean at HEAD,
so every mutation that makes the gate vacuous or over-eager is visible only on the self-check's
synthetic board: thirteen fixtures, each ONE difference from a correct row — four positives (an
unimported call whose name sits in a COMMENT of the file, a type-only import used as a value in
both spellings, D237's removed-local shape, D232's deleted-top-level shape) and nine negatives (a
name the replace declares, a value import, a member, an object key, comment/string/template/regex
text, a type-position name, a global, a pre-existing unresolved name, a name the enclosing function
declares). The self-check names EVERY failing fixture, not the first, so each of the eleven D533
rows was SEEN to fail the fixture built for it — not merely to exit 1.

### A doc figure of four digits or more has TWO printed spellings, and a sweep for one is BLIND to the other (D536 close-out, sharpening D467)

D536 exhausted all three of its review rounds on documentation and commentary — the code was green from the
first build — and the LAST blocking defect was a single stale test-count stamp: `11,977` where the committed
figure was **11,978**. The builder had already swept for that figure and come back clean. The sweep was not
careless; it was **blind**, because the number exists in this repo in TWO spellings and the sweep searched one.

A count of four digits or more is written here both COMMA-GROUPED (`11,978`) and BARE (`11978`), and **which
form a given figure takes is not predictable** — it is not per-file, not per-section, and not per-kind-of-count.
Measured over `docs/progress.md` **as committed at `dd9ec2b0`** (scoped to that revision on purpose — this
very entry moves the counts, D423), with the D536 slice's own four figures, counted with lookarounds
(`grep -oP '(?<![0-9,])1657(?![0-9])'`, because an alternation of the form `(^|[^0-9,])N` miscounts under
this repo's `grep`, which is ugrep):

- corpus **2801** — **0** bare, **9** comma-grouped
- `BUILT.attack` **1657** — **5** bare, **0** comma-grouped
- tests **11978** — **2** bare, **2** comma-grouped
- files **517** — three digits, so grouping is a no-op and there is no second spelling (51 occurrences, one
  form). **The hazard starts at four digits.**

So `git grep -F 11977` and `git grep -F '11,977'` answer DIFFERENT questions, and either one alone can report a
file clean while the stale copy sits three lines away in the other form.

**THE RULE: when you sweep for a figure of four digits or more — a stale one you are hunting, or a fresh one
you are stepping — match BOTH spellings in a single pattern, never one literal.** The cheap form is an
optional separator:

```
git grep -nE '11,?977' -- docs/
git grep -nE '2,?801'  -- docs/ packages/ scripts/
```

⚠️ This is D467's *"a doc figure can rot in TWO files at once, and fixing one copy makes it worse"* with a
DIFFERENT mechanism, and the difference is what makes it its own rule: **the second copy does not have to be in
another FILE — it only has to be in another SPELLING.** D467's remedy (correct the source in the same commit,
and prefer to DELETE the figure and derive it) applies unchanged; what this adds is that you cannot even FIND
the copies until the pattern stops caring about the comma.

⚠️ **AND WATCH WHERE A FRESH COPY COMES FROM: AN *ARCHIVED* RESUME POINT (OR ANY FROZEN PRIOR BLOCK) IS A
COPY SOURCE THAT IS CORRECT IN PLACE AND STALE THE MOMENT IT IS QUOTED FORWARD** — this class recurred ONE
slice after the rule above was written, at D537, when a `SUBMAX=12` row count was carried verbatim out of the
archived D536 resume point into the live D537 one, where it read as freshly measured because the sentence
around it was freshly written. A sweep cannot help here: the figure was not MISSED, it was INTRODUCED, and the
archived copy is frozen on purpose and must never be edited to match. **The remedy is to RE-MEASURE, and to
measure BOTH ENDS when the sentence is a comparison** — D537 ran the gate in a detached worktree at
`49d0d3a1` (*"all 21 rows carry a hit"*) and in the working tree (*"all 20"*), so the disclosure asserts a
measurement rather than a memory.

### A writer that removes by POSITIONAL INDEX is SINGLE-REF-ONLY, and a set-valued caller must gather first and splice STRICTLY DESCENDING (D537 close-out)

`interpreter.ts`'s shipped `returnBenched` removes bodies by `ref.spot.index` and **never compares a uid**.
That is correct for the ONE ref it is given and wrong for every set, because **removing from an array mutates
the index space the remaining refs were measured in.** BOTH of D537's independent blast-radius scouts found
it, separately, in code that has shipped for many slices — which is why it is written here rather than left as
a comment at one call site.

The two failures, on a bench of `[A, B, C, D]`:

- removing `{1, 3}` — after index 1 goes, the bench COMPACTS to `[A, C, D]`, `bench[3]` is `undefined`, the
  writer's own silent guard fires, and **one body survives the effect** that named it;
- removing `{0, 1}` — after index 0 goes, index 1 now addresses **C, not B**, so the WRONG body leaves, under
  a `POKEMON_RETURNED` event that looks entirely correct.

**Both are SILENT.** Nothing throws, no event says which body it meant, and no assertion that counts events
can tell the two boards apart. The deck arm has a second, quieter version of the same problem: it shuffles
**per ref**, so a caller that loops it files N `SHUFFLE` rows and takes N RNG draws for one PRINTED shuffle.

🛑 **THE SHIPPED ONE-REF WRITER IS NOT WRONG TODAY and must not be "fixed" on speculation** — one ref cannot
collide with itself, and D537 moved no engine byte on its account. **THE RULE IS FOR THE NEXT CALLER: a
set-valued op MUST NOT loop a by-index writer.** Gather every body first, resolve each to a uid or to a
snapshot of the seat, and then apply — splicing **strictly descending by index** so that each removal is below
every index not yet used. D537's `returnBenchedRest` does exactly that.

⚠️ **AND STATE THE PRECONDITION AT THE SITE, BECAUSE IT IS THE PART THAT ROTS.** Descending-by-index is
correct only while every candidate sits on **ONE seat's** bench; the day a candidate set spans two seats, two
independent index spaces are being sorted as if they were one, and the failure is silent again. A
descending splice without a written single-seat precondition is a correct program with no way to notice when
it stops being one.

### A mechanical sweep may only touch the SITES ITS KEY NAMES, and a CATALOG row is never one of them (D538 close-out, extending D492 and D426)

D492 already forbids a value-keyed pass over a short literal and says the over-patch is found only by reading
`git diff -U0`. D426 already protects a chain's **frozen endpoint** from being stepped. **Neither bounds the
pass's FILE SET**, and D538 is what that costs.

A D538 census pin sweep — a `− 1` term on SENTENCE chains and a `− 3` on PRINTING chains, plus value-keyed
re-transcriptions — did three kinds of damage in one slice, in increasing order of severity:

1. it stepped **six FROZEN ENDPOINTS** (`benchNamedBonus`, `sameEnergyBonus`, `moreEnergyBonus`,
   `opponentBenchCount`, `inPlayTypeBonus`, `retreatCostBonus`) as if they were flat pins — D426's class,
   caught by auditing the SHAPE of each site (*look at what is on the LEFT of the `expect(`*);
2. it corrupted **four COMMENTS** in `censusAtHead.test.ts` by replacing a quoted code fragment
   (*"`expect(BUILT.attack - ` occurs TWICE"*) as though it were code — **a string replace over a file that
   quotes its own code is a replace over PROSE as well**;
3. 🛑 it rewrote bytes inside a **CORPUS ROW of `packages/engine/src/censusAttackCorpus.ts`** — the
   catalog's own `<legal printings> <printed sentence>` data.

**THE THIRD IS THE ONE WITH NO RED RUN BEHIND IT.** A comment corruption is inert. An endpoint corruption
goes red. A catalog-row corruption does neither: the catalog is DATA every census figure is DERIVED FROM, so
unless the edited bytes happen to flip whether some reader resolves that row, **no count moves, no `toBe(N)`
fails, `precheck` is green, every gate is green, and the whole suite is green** — while the corpus now SAYS
something no printed card does. The file's parse-time guards check a row's SHAPE (no leading digit in the
sentence, no leading or trailing space), never its CONTENT, so they pass too.

**THE RULE, IN TWO HALVES.**

1. **Bound the FILE SET before writing the replace.** A mechanical pass may touch only the files that hold
   the sites its key names — in practice the pin suites. **A catalog, corpus or fixture DATA file is outside
   that set by construction**, because it holds no assertions and therefore no pins; if such a file appears
   in the pass's diff at all, the pass is wrong regardless of what it wrote there.
2. **Audit `git diff -U0` per FILE, not per value.** The first question is *which files did this touch?* —
   answerable in one line and before any value is read. D492's per-value paired analysis is the SECOND
   question, and it cannot ask the first.

⚠️ **THIS IS WHY A REVIEWER ATTACKS THE DIFF RATHER THAN READING THE REPORT.** The report of a green sweep
and a green `check` is exactly what a corrupted catalog row produces. ✅ **And verify a REVERT by absence,
not by a green suite**: D538's revert is confirmed by `censusAttackCorpus.ts` not appearing in
`git show --numstat a0102c18` at all — the committed catalog is byte-identical to the previous slice's.

### A WITHDRAWAL is a sweep, not a correction — and not every site holding the word is a site to change (D539 close-out, extending D467 and D460)

D467 says that when you correct a transcribed FIGURE you correct the SOURCE in the same commit. D539 is the
same shape one level up and it costs more, because what was wrong was not a number but a CLAIM the slice
itself had decided was false.

The claim was *"`attack.ts` binds both readers unconditionally."* Ground truth: `attack.ts:1708` binds
`derivedHead` **unconditionally**, and `attack.ts:1761-1764` binds `damageMultiplier` **GUARDED** —
`deriveAttackDamageMultiplier(effect)` is reached only when `damageBonus === null`. One of the six copies
even cited `attack.ts:1764` as a binding, and that line is the ternary's **ELSE-ARM**, which binds nothing.

**THE SECOND REVIEW PASS WITHDREW THE WORD IN EXACTLY ONE PLACE AND LEFT IT LIVE IN SIX OTHERS, TWO OF THEM
SHIPPED ENGINE SOURCE** — an `effects.ts` anchor doc block, an `effects.ts` reader arm, an `index.ts`
changelog block that then contradicted itself three paragraphs later, the new suite's own file header (the
file that pass reported as fixed), a `docs/decisions.md` row, and a line of the session-log entry recording
the withdrawal. **So one diff both made the claim and recorded its withdrawal**, and a third pass was needed
to find the rest.

🛑 **THE RULE: a withdrawal is not done when the sentence is fixed at ONE site.** The moment you decide a
prose claim is false, `git grep` its load-bearing WORD across the whole diff and fix every hit in ONE pass,
**engine source first**. There is no red run to wait for: a doc block, a rung title and a changelog
paragraph carry no assertions, so `tsc`, `precheck`, every gate and the whole suite stay green with N−1
false copies standing. **The site you are editing when you notice is the least likely to be the only one**,
because a claim gets copied in the direction of the work — source → suite → changelog → docs — and the
copy you are looking at is usually the last one written.

⚠️ **AND THE OTHER HALF, WHICH THE SAME SLICE PAID FOR SEPARATELY: CLASSIFY THE SITE BEFORE THE PASS
CHANGES IT.** D539 also skipped the version whitelist's `it()` TITLE class entirely — **27** titles naming
`0.423.0` over bodies asserting `0.424.0`, caught on the fourth review round, although D460 already names
that class and already says *"step the titles in the same pass, and count them."* That was a compliance
failure against a written rule, and the cure is mechanical: **key a version pass on the version STRING, not
on `expect(`**, and the titles come with it. But **one title had to be left alone**:
`benchKeepShuffleRest.test.ts:883` reads *"… (D538 — 0.422.0 → 0.423.0; the title is de-valued so the
version tax is one edit per site, not two)"* over a body asserting `0.424.0`. That `0.423.0` is a
**PROVENANCE RECORD** — which decision made an EARLIER bump — and stepping it replaces a true historical
fact with a false one.

**So a mechanical pass over a word or a version asks TWO questions per site, in order: is this site in the
pass's file set (D538), and is this occurrence a PIN or a RECORD OF A PAST STATE?** A pin must move with its
assertion; a record must not be touched. Both halves are invisible to every gate, which is why the audit is
the diff and the classification is per SITE rather than per value.

### A revert of a LINE is a `cmp` against HEAD, not a retype (D540 close-out, extending D428 and D178/D418)

D538 already says to **verify a revert by ABSENCE** — its catalog revert is confirmed by
`censusAttackCorpus.ts` not appearing in `git show --numstat` at all. That instrument answers *"did this
file move?"*. **It cannot answer *"did this LINE come back?"***, and D540 is what the gap costs.

D540 stepped two FROZEN endpoints by mistake (`benchNamedBonus.test.ts:1096`, `sameEnergyBonus.test.ts:969`)
and undid the step **by re-typing the line**. Both lines are a value followed by an **append-only STACK of
trailing `// (…)` annotation blocks, one per slice that ever touched the chain**. Re-authoring from memory
reproduced the value and the *shape*, and put back the version at `0eec3e13` — D537's head — so **D538's
≈1.7 KB block went with it**. Measured: both sites came back `cmp`-identical to `0eec3e13` and **1,726 bytes
short of HEAD**, and a per-file per-decision tag scan over all 110 changed test files read `D538` **7 → 6**
in exactly those two files and nowhere else (`D536` 19 → 18 and `D537` 11 → 10 with it, because both were
cited INSIDE the removed block).

🛑 **NOTHING COULD SEE IT.** The asserted values never moved, so `check` was green, `precheck` was green, no
mutant, gate or census figure shifted — and the removed-comment-line audit cannot see a **deletion INSIDE a
line** any more than it can see an insertion inside one.

**THE RULE: to undo an edit to a line, restore the line's BYTES and prove it.**

```
git show HEAD:<file> | sed -n '<n>p'     # the bytes
cmp <(git show HEAD:<file>) <file>       # the proof
```

A retype is not a revert; it is a **new authorship of the line** that happens to agree with the old one
about the part you were looking at. On a line whose payload is an append-only record, re-authoring it is a
**truncation of an enumeration** (D428) and a **deletion where a re-point was owed** (D178/D418).

⚠️ **AND THE SAME STACK BREAKS FROM THE OTHER SIDE, IN THE SAME SLICE.** D540 also stepped the `find`/
`replace` of two standing mutant rows (the D275 engine-version row, the D495 census row) while **never
appending this slice's entry to either row's re-transcription enumeration** — the rows ran, their `find`s
were at 1x, `precheck` was green and both were KILLED in the sweep. So an append-only stack can lose an OLD
entry to a retype or fail to gain the NEW one, and **neither failure has a runner behind it**, because the
code around the record is correct either way.

✅ **Both halves reduce to one habit: the record moves in the SAME EDIT as the thing it records, and any
undo of that edit is a byte restore.** No new rule is owed for the missing-entry half — D428 already covers
a truncated enumeration, and a head with the current slice missing is a truncation at the head. What is new
is that an edit which *looks like an undo* is one of the ways the truncation happens.

### Plain `setsid` does not FORK, so it does not detach a job that is already a process-group leader (D541 close-out, correcting D489's recipe)

D489 wrote the recipe that every sweep since has used:

```
setsid nohup bun scripts/mutation/run.ts > "$CLAUDE_JOB_DIR/tmp/sweep-DNNN.log" 2>&1 < /dev/null &
disown
```

🛑 **It is one flag short, and the missing flag is why the `setsid` reuse counter stalled for eight
close-outs.** `setsid(2)` FAILS with `EPERM` when the calling process is already a process-group leader —
which is exactly what a shell puts a backgrounded job into. The `setsid(1)` wrapper then does not fork: it
`exec`s the program **in place**, the new session is never created, and the sweep keeps the shell wrapper
as its PPID. It runs, it finishes, and every property the detachment was for is absent.

```
setsid --fork nohup bun scripts/mutation/run.ts > tmp/sweep-DNNN.log 2>&1 < /dev/null &
```

**Verify it took with `ps -eo pid,ppid,sid -p <pid>`, and read BOTH columns.** `PPID 1` alone does not
discriminate: an ORPHANED child of a dead shell also shows `PPID 1` — reparenting is not detachment — but
it keeps its old session id. **`SID == PID` is the measurement**; `PPID 1` is a consequence.

⚠️ **D541's first launch failed exactly this way** and was caught by reading the `ps` output rather than by
anything going red. It was killed from a state classified all three ways (D446: tree clean, no journal, no
surviving `mutation/run.ts`) and relaunched with `--fork`, which is the only reason `tmp/sweep-D541.ppid.txt`
reads `PID 1580043 / PPID 1 / SID 1580043`.

🛑 **And write the read INTO THE LOG, in the same command that starts the sweep.** A sidecar has to be tied
to its log by arithmetic over mtimes afterwards; a line inside the artefact needs no arithmetic to tie it to
the artefact. That one-line fix has now been deferred through eight close-outs, each of which paid the
arithmetic instead. 🆕 (D547 close-out) **PAID at D547, after thirteen deferrals, and NOT in the `$!` form
every deferral wrote down**: that form reads a wrapper which has already exited. See *"Put the `ps` read
INTO the log"* below for the recipe that works.

### Building a slice in a SECOND CHECKOUT: `realpath` the workspace package, and a clean merge is not a reconciliation (D541)

A second worktree lets a slice be built while the main tree runs a three-hour sweep. It costs two things,
and both are silent.

🛑 **(i) THE WORKTREE CAN TEST THE MAIN TREE'S SOURCE.** Symlinking or copying `node_modules` from the main
repo makes the checkout resolve `@colorless/engine` to the **MAIN TREE's** `packages/engine`. Every suite —
`packages/engine`'s as much as `src/`'s — then reports green about code that is not in the checkout, and a
whole slice can be built, probed and reviewed against source it never touched. **It is not made safe by a
slice having no `src/` bytes.** Before trusting any green run, and again after anything that could touch
`node_modules`:

```
node -e "console.log(require('fs').realpathSync('node_modules/@colorless/engine'))"
```

must print a path **inside the worktree**. D541 hit this and caught it here; `vite.config.ts` carries no
alias, so `vitest` resolves the same way `node` does.

🛑 **(ii) A CLEAN MERGE IS NOT A RECONCILIATION.** A slice built on `main` MINUS the previous close-out
carries pre-close-out prose. When it is cherry-picked forward, git merges the docs sections cleanly —
because the two sides touched different lines — and the stale half lands intact, contradicting the paid
block a few hundred lines below it in the SAME FILE. Git resolved the TEXT; nobody resolved the CLAIMS.

**So prove the facts survived, do not assert it.** After the pick, diff the docs against the close-out
commit and read every deletion:

```
git diff --numstat <close-out> HEAD -- docs/
git diff <close-out> HEAD -- docs/progress.md | grep '^-[^-]'
```

The deletions must be exactly the single-line records the new slice legitimately supersedes (the
`Last updated` line, the status row) plus claims deliberately withdrawn — never a paragraph of the previous
close-out. D541's pick deletes **3** lines in `progress.md` and **zero** in `decisions.md` and
`conventions.md`, and that is a `cmp`-grade check rather than a sentence (D540's rule, one file wider).

⚠️ **And re-point the LINE ADDRESSES the parked text carries.** D541's parked `(0)` block cited the previous
close-out at `:955-985`; after the pick those lines held a different section entirely. **A line address is a
figure** and rots like one (D466/D541).

### A detached sweep survives its LAUNCHER but not a REBOOT, and its log cannot tell you which one killed it (D542 close-out)

`setsid --fork` (above) makes a sweep outlive the process that started it. It does nothing against a machine
shutdown, which SIGTERMs every session on the box — D542's second launch was properly detached and died
anyway, 292 verdicts in.

🛑 **The log tail is the SAME for both deaths.** The harness handles every SIGTERM identically: it restores
the mutated file, prints `[SIGTERM] restoring 1 file(s) before exit…` and exits, with no summary line. D542's
launcher-exit death (run 1) and its shutdown death (run 2) end in byte-identical lines, so a close-out that
reads only the log records the wrong cause — and an account written after the fact can carry the wrong TIME
as well: run 2's was handed over as *"rebooted around 10:10"*, when the machine went down at **08:04:01** and
10:09:30 was only when it came back.

**So when a sweep log stops without a summary line, ask the MACHINE before blaming the launcher:**

```
uptime                      # how long the current boot has been up
journalctl --list-boots     # the PREVIOUS boot's END is the time of death, not the new boot's start
                            # (🆕 D560 close-out: refined — the time of death is the shutdown's FIRST line
                            #  in `journalctl -b -1`; see "A shutdown's time of death is where it STARTS…" below)
```

and compare the previous boot's end with the log's own mtime (D542: `08:04:01` against `08:03:59.335`). Then
classify the tree all three ways (D446: clean, no `tmp/mutation-journal.json`, no surviving
`mutation/run.ts`) and relaunch. ⚠️ **Keep the partial log, but do not stitch it**: the finished run is the
artefact. D542 checked that both partial logs agreed with the finished run on every verdict they carried
(2,659 / 2,659 and 292 / 292, same order) — a check worth running, because it is what says an interruption
cost wall-clock and nothing else.

### A worktree's isolation check is EVERY `@colorless` link, not the root one (D543 close-out)

D541's check above — one `realpath` of the root's `node_modules/@colorless/engine` — is NECESSARY and not
SUFFICIENT. This repo carries **five** workspace links, and three of them live in NESTED `node_modules`:

```
node_modules/@colorless/engine                    # ABSOLUTE in the main tree — D541's case
node_modules/@colorless/schema
apps/api/node_modules/@colorless/engine           # RELATIVE: ../../../../packages/engine
apps/api/node_modules/@colorless/schema
packages/engine/node_modules/@colorless/schema    # RELATIVE: ../../../schema
```

🛑 **A relative link resolves against its REAL path.** Symlink `packages/engine/node_modules` WHOLE into the
main tree and `../../../schema` resolves from inside the MAIN tree — so the engine's `@colorless/schema` is the
main checkout's `packages/schema` while the root link reads perfectly. D543 hit it (the engine did not redden
on a schema edit that `src/` already saw), and D544's builder hit it again; both rebuilt the nested
directories as REAL directories whose links point inside the worktree. That is the second-checkout build
running against the very tree a whole-corpus sweep is patching in place.

**So the check is all of them, and every one must print a path inside the worktree:**

```
for l in node_modules/@colorless/* */*/node_modules/@colorless/*; do realpath "$l"; done
```

Build a worktree's nested `node_modules` as real directories, never as symlinks to the main checkout's.

### Put the `ps` read INTO the log with `$$` and `exec` inside the `setsid --fork`, never with `$!` (D547 close-out, completing D541's recipe)

D541's section above says to write the detachment read INTO the log in the same command that starts the
sweep. Thirteen close-outs deferred it, and every one of them wrote the owed form down as
`ps -eo pid,ppid,sid -p $!`. 🛑 **That form cannot work under `setsid --fork`, which D541 made mandatory.**
`$!` is the pid of the `setsid(1)` WRAPPER. With `--fork` the wrapper forks, the CHILD calls `setsid(2)` and
`exec`s the program, and the wrapper exits at once. By the time `ps -p $!` runs there is no such process,
so it prints a header and no row. Measured at the D547 close-out with a dummy:
`setsid --fork sleep 7 &` gave `$!` = 1987953, `ps -p 1987953` returned no row, and the sleep was
1987955 (`PPID 1`, `SID 1987955`). If the thirteenth deferral had been paid in the form it was written,
it would have written an empty table into the log.

**Take the read from INSIDE the new session, then `exec` so the pid is kept:**

```
setsid --fork sh -c 'ps -o pid,ppid,sid,cmd -p $$; date -Is; exec bun scripts/mutation/run.ts' > tmp/sweep-DNNN.log 2>&1 < /dev/null
```

(the single quotes matter: `$$` must be expanded by the inner `sh`, not the launching shell). `$$` is the
inner shell, which already IS the detached session leader, and `exec` replaces it with `bun` under the same
pid. So the log opens with three lines: `ps`'s own header (`PID PPID SID CMD`, since `ps -o` prints one),
then the row naming the sweep's own pid, with `CMD sh -c …` because it was read before the `exec`, then on
line 3 the `date -Is` stamp, the launch time to the second. No mtime arithmetic is needed to tie the row
to the log. D547's log reads `PID PPID SID CMD` on :1, `1776886 / 1 / 1776886` on :2 and
`2026-09-24T11:40:57+02:00` on :3. A sidecar taken
afterwards with `ps -o pid,ppid,sid,cmd -p 1776886` reads the SAME pid with `CMD bun scripts/mutation/run.ts`.
That is the `exec` observed, not assumed.

⚠️ **Key any sidecar on the pid (`-p <pid>`), never on the command name (`-C bun`).** A name match picks up
every other `bun` on the box. That is where the stray rows in earlier sidecars came from: `bun run check` in
D543's, `bun run dev` in D544's, `bun run dev --port 5173 --strictPort` in D546's. D547's sidecar, keyed with
`-p`, carries exactly one row.

### `git commit --amend` is refused in auto mode, so a landing writes its final message at the pick (D552 close-out)

The D552 land workflow cherry-picked the parked `002e3e51` onto `main` as `b21418b9` and then planned to rewrite
that commit's message in its ship step with `git commit --amend`. 🛑 **The auto-mode permission classifier refuses
`git commit --amend`**, so the step stopped with the commit made, unpushed, and the sweep not launched. The commit
already carried a correct message (byte-identical to the parked commit's, shorter than the one the step meant to
write, with exactly one `Co-Authored-By` line), so the orchestrator pushed it as-is and launched the sweep by hand
with D547's recipe above. Nothing was lost, but a stop between commit and launch is a stop in the loop.

**The rules:**

1. **Do not plan a landing around amend.** If the landed commit's message must differ from the parked one, write
   it at the pick: `git cherry-pick --no-commit <sha>`, resolve and re-verify, then ONE plain `git commit -F <file>`
   with the final message. The parked commit's own message is the default and is usually right.
2. **When the stop comes after the commit exists, read the message before trying to rewrite it.** A title that
   names the slice truthfully and exactly ONE `Co-Authored-By` trailer is a correct commit. A shorter message is not
   a reason to rewrite history; ship it as it stands and put the fuller account in the close-out.
3. **Rule 4 of *"Stage by listing what changed…"* (D512, above: *"then amend, re-verify, relaunch"*) assumes amend
   is available.** Under auto mode it is not: kill the sweep as that rule says, then either ask the user to
   approve the amend or land the fix as a second commit, and re-predict from the tree that commit leaves.

### A shutdown's time of death is where it STARTS in the old boot's journal, not where that journal ENDS (D560 close-out, refining D542)

D542's check above compares the previous boot's END (`journalctl --list-boots`) with the partial log's mtime; at
D542 they sat 1.9 s apart. At D560 they sat **75 s** apart: the partial log's mtime is `09:34:32.260` and the old
boot's journal stops at `09:35:47.554`. The gap is the shutdown itself, which ran for 75 s after it had SIGTERMed the
sweep. The journal names the shutdown's first moment, and that line is the time of death:

```
journalctl -b -1 -o short-precise --grep 'Power key|Powering off|powering down|Rebooting'
```

D560's reads `09:34:32.111 … Power key pressed short.`, then `Powering off...` and `System is powering down.`,
**0.15 s** before the log's mtime. It also names the CAUSE (here the power key), which `--list-boots` cannot. So a
gap of a minute between the log's mtime and the old boot's end is not, by itself, a sign that something other than
the shutdown killed the sweep; find the shutdown's first line before concluding anything.

⚠️ **The hand-off's times were wrong again, in D542's way.** It said the sweep launched *"~06:15"* and died when the
machine *"rebooted around 13:04"*. The partial log's own `date -Is` line says 05:56:18, and 13:04:18 is when the NEW
boot began, three and a half hours after the death. Both corrections came from artefacts, which is why they are read
rather than copied.

⚠️ **A relaunch into the same paths overwrites the first launch's sidecar** (`tmp/sweep-<D>.ppid.txt`). Rename the
partial log (`-interrupted.log`) before relaunching; the first launch's pid then survives in that log's own first
rows, because D547's recipe put it there. Do not rely on a sidecar for any launch but the last.

### This repo's `grep` can silently UNDER-COUNT an ERE, so a `grep` count needs a second engine (D565 close-out, extending D504, D536 and the :4101 grep-count rule)

`grep` in this environment is ugrep 7.8.4 behind a shell function (`type grep` shows it). Its faults are already
on record: D504 recorded that it returns nothing for an untracked file, and the D536 close-out (*"A doc figure of
four digits or more has TWO printed spellings"*) recorded that an ERE alternation of the form `(^|[^0-9,])N`
miscounts under it. D565's close-out measured one more, at least the third known: it drops every other match of an
ERE inside a file it does read.

`grep -cE '^ +[A-Za-z0-9][^ ]* +…'` over the verdict lines of `tmp/sweep-D565.log` read **1,836**. GNU
`command grep -cE`, `grep -cP` and a bun script all read **3,673**, and D564's log reads **1,805** against
**3,611** the same way: every other matching line is dropped, with no error and no warning. On an eight-line
cut of the log, `[^ ]* +…` matches **0** lines under ugrep and **8** under GNU `grep`. The anchored
`^  [A-Za-z0-9][^ ]* +… +` form happened to count right under both, so which patterns are affected is not
predictable from their shape.

That an enumeration's number comes from the module and not from a text search is already the rule of *"A count
taken from a grep is a claim about the grep"* (:4101, D476), and D519 (9)'s set-compare already follows it; a
count that comes out at about half, or at zero, is already suspect under D504's *"a silent empty result from a
search tool is not evidence of absence"*. What this section adds is one rule:

**Any `grep` count that goes into a doc is cross-checked against a second engine first**: `command grep` (GNU),
`grep -P`, or the script. If two engines disagree, treat it as a tool fault until shown otherwise, and write down
the figure the script gives.

### A `setsid --fork` sweep's PPID is its nearest SUBREAPER, not always `1`, and `setsid` leaves it in the launching unit's CGROUP (D566 close-out, refining D541 and D547)

D541 made `SID == PID` the detachment measurement and called `PPID 1` its consequence, and the logs D547's recipe
wrote all opened with `PPID 1` up to D565's. D566's log opens with `PID 1706648 / PPID 1144 / SID 1706648`.
`ps -o pid,ppid,cmd -p 1144` reads `/run/current-system/systemd/lib/systemd/systemd --user --deserialize=34`, itself
`PPID 1`. The sweep ran to its summary line, so nothing was lost. Only the reading changed.

**Why:** when the `setsid(1)` wrapper exits, the kernel hands its orphaned child to the nearest ancestor marked as a
CHILD SUBREAPER, and to init only if there is none. The systemd user manager is one. This session's shell sits in
`user.slice/user-1000.slice/user@1000.service/app.slice/t3code.service` (`/proc/$$/cgroup`), under that manager, so
its orphans go to `1144`. The earlier `PPID 1` launches were presumably made from outside the user manager. Their
launch context was not recorded, so that is an inference, not a measurement. One reading is consistent with it:
`systemctl --user show t3code.service -p ActiveEnterTimestamp` reads 2026-09-28 19:53:40. That is after D565's launch
(17:40:45) and before D566's (09:54:48 the next day). The same reading shows the unit did not restart during D566's
run. Re-measured at the D566 close-out with a
dummy launched by the same recipe from the same session (`setsid --fork sh -c 'ps -o pid,ppid,sid,cmd -p $$; exec
sleep 3'`), the dummy read `PPID 1144` and `SID == PID`.

**The rules:**

1. **`SID == PID` stays the one detachment check. Do not compare the PPID to `1`.** Record the PPID as read and name
   its process (`ps -o pid,ppid,cmd -p <ppid>`). Init and a `systemd --user` subreaper both mean the orphan was
   adopted. A shell or a tool runner as PPID means the fork did not happen, which is D541's failure, and so does
   `SID != PID` whatever the PPID says.
2. **`setsid` detaches the SESSION, not the CGROUP.** The same dummy's `/proc/<pid>/cgroup` read the launching unit's
   (`…/app.slice/t3code.service`), and that unit's `KillMode` is `control-group` (`systemctl --user show
   t3code.service -p KillMode`). So stopping or restarting the unit the launching session runs under would kill the
   sweep with it, however detached its session is. The log would then stop without a summary line, exactly as it
   does after a reboot. For a log that stops early, run D542's boot check and ALSO `journalctl --user -u <unit>` for a
   stop or restart inside the run's window, before classifying it as anything else. The sweep's OWN cgroup was not
   read while it ran, only the dummy's. Launching into a scope of its own (`systemd-run --user --scope …`) was not
   measured either, so it is not the recipe yet.

### A withdrawn COUNT claim is also spelled as an ENUMERATION with no number in it, so the sweep keys on the MEMBERS' names too (D567 close-out, extending D539)

D567 added two members to `EffectSlot` (`turnedPrize` and `revealed`, five now; 🆕🆕🆕 D579 (D539): six since D579 — `"placed"`), so every present-tense sentence
saying it has three was withdrawn. D539's rule was followed, and it still took THREE passes to find them all:

1. The builder swept the literal phrase *"Three members"* and annotated two sites.
2. The parked slice's last review found SIX more, where the claim had been reworded (*"has three inhabitants"*,
   *"there are three of them"*). The landing then re-swept for a three-count within three lines of `EffectSlot`,
   `recordAs` or *§9.2 record*, whitespace-collapsed, and found TWO more.
3. The final review, after the landing commit `a26f3e16`, found TEN more (landed as `b10ce168`). They state the
   membership as a LIST with no number in it — `"paid" | "moved" | "discarded"`, *(paid / moved / discarded)* — and
   one of them (*"into the same three slots"*) sits in a block that never names `EffectSlot` at all.

Every gate and the whole suite were green at each stage, as D539 says they will be.

**Why:** D539 says to grep the claim's load-bearing WORD. For a count claim, the number and the type's name are
not the only load-bearing tokens. The claim is carried just as fully by the list of the old members, and a list has
no number to grep for and need not name its type.

**The rule:** when a slice changes the size of a union, enum or set that prose describes, sweep for all three
spellings in ONE pass, engine source first:

1. the literal phrase;
2. the old count within a few lines of the type's name and its synonyms, whitespace-collapsed;
3. the old members' names next to one another under any separator (`/`, `|`, `,`, *or*, *and*), skipping windows
   that already name a new member or carry the slice's note.

Then classify each hit before changing it (D539's second half). A MEASURED population is not a claim about the
union: D567 left `discardDefender.test.ts:491`, a count of that file's own `recordGate`s. A record of a past state
is not one either.

### A gate mutant whose only witness is a LIVE residue sentence dies the day a slice BUILDS that sentence, and nothing goes red (D569 close-out, extending D467, D516 and D459)

`D471-min-region-takes-the-first-hit` read KILLED on every sweep through D568. It came back as the ONE undeclared
survivor of D569's sweep, ending a 36-run exact-prediction streak, although its bytes, its target line and its gate had
not changed. Its killer, `opaque-anatomy-gate.ts` §E, re-derives a measurement over the LIVE residue, so it could catch
a first-hit search only while some live OPAQUE row had a first-admitted alignment larger than its minimum. Exactly one
row did: Roaring Moon's «This attack does 10 more damage for each Ancient card in your discard pile.». D569 built it. The
gate stayed green, the slice's probes never reached the row, and the sweep was the first thing to notice.

D467 and D516 cover a suite witness that a build turns RED. This is the silent case. **A gate over a population passes
on any population, so when its witness leaves, the gate stays green, and only its mutant can show that it has stopped
discriminating.**

**The rule:**

1. **When a slice changes the residue** (it builds, reaches or reclassifies any corpus sentence), probe EVERY row whose
   killer is a gate over the live census before you write the prediction, not only the rows near your hunks. List them
   by `killedByCommand`, not by file. At D569 there are fifteen: 8 on `bun scripts/opaque-anatomy-gate.ts` and 7 on
   `bun scripts/residue-census-gate.ts`. Probing all of them takes a few seconds. 🆕🆕🆕 D571: SIXTEEN — 9 on
   `opaque-anatomy-gate.ts` with `D571-gate-co-marker-pin-premise-broken` (population-independent: a literal premise).
2. **Prefer a pinned literal witness to a population witness** for any row that tests the INSTRUMENT's logic rather than
   a claim about the corpus. D569's fix has that shape. It adds an optional `targets` parameter whose default is the
   live side, so every existing caller is unchanged, and pins a fixed pair. The gate re-measures the pair's premise, so
   the pin cannot quietly become a tautology.
3. **Classify each gate row once and keep the class.** There are four classes:
   - **Population-independent:** the witness is a literal input, so no slice can use it up.
   - **Population-dependent but loud:** the gate's own non-degeneracy check goes red before the row can survive.
   - **Grows with progress:** the witness is the BUILT side or the corpus, so only rotation threatens it.
   - **At risk:** the witness is a handful of live residue sentences. This GAP had that shape.

**The class sweep at D569, on the fixed tree.** Each of the 15 rows was applied by hand and the claim that fired was
read. All 15 are KILLED.

- **Population-independent (8):** the five `D465-*` tail-repair rows (`residue-census-gate` §B literals),
  `D471-regions-never-separate`, `D471-adjacent-edits-oversplit`, and now `D471-min-region-takes-the-first-hit`.
- **Population-dependent but loud (2):**
  - `D471-region-bound-not-applied`. It dies on §A (k = 1 on every row) and on §E's "far half is empty", and the gate
    already requires a far row.
  - `D471-built-side-control-inverted`. It dies on §C. Building only empties residue sides further, so the number of
    killing claims can only grow.
- **Grows with progress (4):**
  - `D471-continuous-declared-a-blocker`: CONTINUOUS has 59 built sentences / 230 printings.
  - `D508-named-attack-marker-kept-as-blocker`: NAMED-ATTACK has 4 built sentences / 7 printings.
  - the two `D529-*-refuses-the-clause-only-gate-again` rows: they need the 3 clause-only-gate sentences, which are
    already built.
- ⚠️ **At risk (1): `D471-co-marker-may-label`.** It dies on §C's *"a CO-MARKER labelled a row"*, which needs a FAR
  OPAQUE row that matches a non-blocker marker. Its whole witness population is FIVE live residue sentences: three
  `SCHEMA-BANNER` (Ancient/Future), one `PRIZE-ZONE` and one `ANY-NUMBER-OF`. A slice that builds or reaches all five
  turns it into the next silent GAP, and a Paradox part b slice is the likeliest to remove three of them. Pin it the same
  way, with a literal far row that a co-marker labels, before or with that slice. It was not pinned at this close-out,
  which was scoped to the GAP row. 🆕🆕🆕 **D571: PINNED, and it moves to population-independent — 10 of 16, since its premise row (below) is a sixteenth gate row and is population-independent too.** D571 (Paradox
  part b) built Destructo-Press, one of the three SCHEMA-BANNER witnesses (SCHEMA-BANNER OPAQUE 3/4 → 2/2), so before the
  build `opaque-anatomy-gate.ts` §C gained a literal witness: `blockerMarkerOf` (the labelling line, exported from
  `opaque-anatomy.ts` byte for byte, so the row's `find` is unchanged) is asked of the PRIZE-ZONE sentence «If you use
  this attack when you have exactly 1 Prize card remaining, you win this game.», with its premise (a co-marker matches it,
  no blocker does) re-measured; a new row, `D571-gate-co-marker-pin-premise-broken`, keeps the premise honest. The live
  witnesses are four now (two SCHEMA-BANNER, one PRIZE-ZONE, one ANY-NUMBER-OF); the row no longer depends on them.
  🆕🆕🆕 **D575 (D539): ~~"four now (two SCHEMA-BANNER, one PRIZE-ZONE, one ANY-NUMBER-OF)"~~ is WITHDRAWN**, kept as
  written (D418): so is the *"FIVE live residue sentences: three `SCHEMA-BANNER` … one `PRIZE-ZONE` and one `ANY-NUMBER-OF`"* above (D571 built one `SCHEMA-BANNER`, D574 the `ANY-NUMBER-OF`, D575 the rest but Koraidon). D574 built the ANY-NUMBER-OF witness (Sableye "Damage Collection"), and D575 built the PRIZE-ZONE one
  (N's Sigilyph "Victory Symbol" — the very sentence `CO_PIN` holds) and one SCHEMA-BANNER one (Miraidon "C.O.D.E.:
  Protect"). ONE live far witness remains — Koraidon `sv08-116` "Unrelenting Onslaught", SCHEMA-BANNER — and the
  `CO_PIN` literal still holds the row unchanged (a literal is not built away when its sentence is): the gate-witness
  probe read 16/16 KILLED after D575.
  🆕🆕🆕 **D579 (D539): ~~"ONE live far witness remains — Koraidon"~~ is WITHDRAWN** — D579 BUILT Koraidon `sv08-116`
  (a literal clause row over the seat-level `GameState.recentAttackers`); the `OPAQUE` class is EMPTY, no live far witness
  remains, and the row rests on the `CO_PIN` literal ALONE — the case the pin was written for. The gate-witness probe
  read 16/16 KILLED on the D579 bytes.

### A withdrawn claim about a MECHANISM is also spelled as the mechanism's DATA, so the sweep keys on those shapes too (D570 third review, extending D539 and D567)

D570 made one exit from `finishAttack` keep the turn (Festival Lead's attack-again window). Every sentence saying an
attack ends the turn was swept, and it still took THREE reviews to find them all:

1. The build swept the literal phrase (*"attacking ends the turn"*) line by line.
2. The first review re-swept whitespace-collapsed, on more verbs (*"finishAttack still ends the turn"*).
3. The second review found claims with no "attack … ends" in them (*"the §5.3 turn still ends"*, *"turn end"*,
   *"feeds the same tail"*), `finishAttack`'s own doc first.
4. The third review found `phaseView.ts`'s *"(pending: [ko…, endTurn, checkup, startTurn])"* — the claim spelled as a
   QUEUE LITERAL — and *"puts its KO stages in FRONT of this tail"*, the claim spelled as a POSITION.

**Why:** a mechanism claim is carried by the mechanism's data as fully as by its verb: a stage sequence, a call
order, a "before / after / in front of" position. None of those contain the verb a prose sweep keys on.

**The rule:** when a slice adds an exit, a branch or a stage to a mechanism that prose describes, sweep in ONE pass,
engine source first: (1) the verb phrases, whitespace-collapsed (D539 / D567); (2) the mechanism's DATA spellings —
the old stage or call sequence written as a literal (`[a, b, c]`, `a → b → c`) under any separator; (3) POSITION
words next to the mechanism's names (`in front of`, `behind`, `queued`, `then`). Classify each hit (D539's second
half): a named board on which the new branch cannot fire is true and stays.

### A withdrawal sweep is case-INSENSITIVE: the claim's lowercase copy hides mid-sentence (D573 landing, extending D539)

D573's third review withdrew the claim *"Unreachable off every printing"* at four sites, and the builder's sweep for
it (*"Unreachable off"* / *"name their own attack"*, case-sensitive) reported "no other claim a copy reaches". The landing
re-ran it with `git grep -n -i` and found two more: D154's *"A name matching nothing installs nothing and emits no row
— unreachable off all five printings, constructed and pinned."*, in its `decisions.md` row and its `simulator.md`
section. The same claim, written lowercase mid-sentence. So the count was SIX, not four, and two "found no other
claim" sentences were false as written. No gate and no test reads prose, so nothing went red.

**Why:** a claim that opens a sentence in one place is capitalised there and lowercase wherever it follows a dash, a
colon or a clause. A case-sensitive sweep keyed on the first copy found misses every copy that is not also a sentence
start, and nothing executable notices.

**The rule:** every D539 / D567 / D570 withdrawal sweep is run with `git grep -n -i`, engine source first, on each
phrase it keys on. A sweep reported as "found no other claim" names its flags (the `-i` included), so a reviewer can
tell a case-insensitive negative from a case-sensitive one.

## Git / commits
- Branch off `main` for non-trivial work; commit/push only when asked.
- Commit trailer per global config: `Co-Authored-By: Claude ...`.
- **Explicit paths only, and never touch the tree wholesale** — see "Working
  beside other agents" above. It is the rule this branch pays for most often.

## End-of-session ritual (do not skip)
1. Update `progress.md`: status table + session-log entry + **new resume point**.
2. Record any decision in `decisions.md`.
3. Write anything learned into the right workstream/reference doc so the next
   session doesn't rediscover it.

## A refusal carries a POPULATION, and a doc block's "which is why" is a refusal (D449)

🛑 **`grep -rn "which is why there is no" packages/engine/src` — and read every hit against
the population the ENGINE runs on.** D143 wrote, at a shipped anchor, *"it is NOT printed as
a standalone sentence ANYWHERE in the pool … so the compound is the ONLY form this sentence
takes, **which is why there is no bare any-zone anchor**"*. The census behind it was run on
the LOCAL D1 (978 cards / 6 sets); the engine's population is `legal_standard = 1`, where the
sentence carries 1 printing and had since the corpus column was committed. **The claim was
wrong on the day it was written, on the population that matters — and it then stood as the
stated reason not to build, for 106 decisions.**

This is D413's two-populations failure (*"a refusal measured on the local pool while the
engine runs on the legal column"*) reaching a **doc block at a source site** rather than a
`toBeNull` in a suite. The two forms need the same audit and only one of them is grep-able
by its assertion. ⚠️ **A refusal phrased as an explanation — *"which is why we did not"*, *"so
there is no"*, *"this is the ONLY form"* — is the hardest kind to find**, because it reads as
a description of the code rather than as a claim about the catalog.

**Corollary, and it is the cheap half:** when you correct such a claim, DATE it (D423) —
"wrong when written" and "true then, rotted since" are different faults — and say which
population each half was measured on.

## A `toBeNull` on a sentence the catalog PRINTS is a liability (D449)

**A near-miss rung that asserts a REAL printed sentence derives to `null` goes red the day
somebody builds it, and its replacement is not "delete it".** D449 flipped four at once
(`attackLock.test.ts`, `counterPut.test.ts`, `counterBenchPut.test.ts`,
`scaledAnySnipe.test.ts`). Every one of them was really making a claim about DISJOINTNESS —
*"the zone word is what tells these two anchors apart"*, *"the anchor is not a prefix"* — and
nullity was only the cheapest way to spell it while nothing read the other sentence.

**Re-point onto an INEQUALITY of derived programs.** `expect(deriveAttackEffect(a)).not.toEqual(deriveAttackEffect(b))`
plus the two positive programs is strictly stronger than `toBeNull`: it still goes red on the
defect the old rung was about, and it cannot go green by accident when a sibling anchor
lands. That is D418's second half applied before the re-point rather than after it.

⚠️ **AND FIND THEM BEFORE YOU WRITE A LINE.** Run the new anchor over every string literal in
the package — twenty lines of script, and it names every rung that will flip, with its file
and line. State what the scan cannot see (template literals, strings built by `.replace`).

## Stepping a census: grep the chain heads FIRST (D449, re-earning D431)

Three `check` rounds went on sibling chains again. The shapes that hid:

- **A PAIR EXPRESSION whose two halves sit on ONE line** — `[resolving.length - …, units(resolving) - …]`.
  Patching "the first occurrence of the head" fixes half of it and the assertion still reddens.
- **An ELEVEN-DEEP LADDER** (`opponentResistanceBonus.test.ts`), where fixing rung one just
  moves the failure to rung two, once per `check`.
- 🛑 **`BUILT.attack` IS A RECORDED CONSTANT, and `censusAtHead`'s chains SUBTRACT FROM IT.**
  Adding your front term before bumping the constant OVER-subtracts, and the rung reddens
  with a number that looks like the opposite defect. **Bump the constant first, then step the
  chains.**

The procedure that works: `grep -n "<head> -"` for every head spelling in every file the
delta touches, list the sites, patch them in one pass, then run.

## The catalog-scope guard reads ONE line (D449)

`catalogManifest.test.ts` matches `\b(\d{3,4}) cards(?: \/ (\d+) sets)?` — a single regex over
the source text — so **wrapping "978 cards / 6 sets" across two comment lines makes it an
offender**. It fired twice on the author in one slice, which is the guard doing its job; know
it before it costs a `check` round, and keep the phrase on one line.

## A "permanent boundary of the vocabulary" is a claim about ONE CARRIER (D450)

D450's brief refused a printed sentence because *"`matchesFilter` takes a catalog card,
never an `InPlayPokemon` — this is a permanent boundary of the filter vocabulary rather
than a missing member."* **The premise was true and measured** (the function's own
`basicPokemon` arm states it as the reason the *"HP or less REMAINING"* printings are
unreachable) **and the conclusion was false**, because a board fact does not have to
travel through `CardFilter` at all. `damageChosen.damagedOnly` (D437) had been reading
the sentence's exact eight printed words — *"that has any damage counters on it"* — off
an `InPlayPokemon` for eleven decisions. The rider was reused verbatim on the other op
and the sentence was built.

🛑 **THE PROCEDURE IS TO GREP THE PRINTED PHRASE, NOT THE VOCABULARY THAT WOULD EXPRESS
IT.** "Which union member would say this?" finds nothing when the shipped answer is a
rider on an op. `grep -rn "any damage counters" packages/engine/src` costs seconds and
names the surface that already reads the fact.

**A boundary is a property of a FUNCTION; a refusal is a claim about the ENGINE.** The
two are only the same when that function is the engine's only door to the fact — which
is exactly the thing to check, and exactly the thing a brief that names the function
will not have checked.

## A doc block that refuses a SHAPE has refused that shape, not the axis (D450)

`counterEachAll`'s declaration has said since D340 that *"modelling this as a seat-scoped
op with a **'both' boolean** would put the printed subject of the sentence into a
modifier"*. That is correct, and it does not reach a two-member **ENUM** whose values ARE
the printed subjects (`"both"` is *"(both yours and your opponent's)"*, `"opponent"` is
*"each of your opponent's Pokémon"*) — the shape `disableAbilities.side` and
`handRefresh.who` already ship. **Read the refusal's NOUN before inheriting it.**

⚠️ And it had a POPULATION as well as a noun (D449): D340 measured on the one sentence in
reach, and the `legal_standard = 1` column prints two more that are one-seat. Both halves
had to be checked, and only one of them is grep-able.

## A mutant row can be INERT, and the harness reports it as a survivor (D450)

⚠️ The runner's own message on an undeclared survivor is *"either the suite has a real gap,
or the decision row's tally was wrong. Both are findings."* **There is a third.** D450
authored a row whose `replace` prepended a comment to the line ABOVE the field it meant to
delete: the harness compiled byte-equivalent behaviour, every suite passed, and the verdict
was `SURVIVED(undeclared)` — which reads as a suite hole and is not one.

**Before believing a GAP, diff `find` against `replace` and name the SEMANTIC token that
moved.** If the only difference is inside a comment or a string that nothing reads, the row
never mutated anything. `precheck` cannot see this either: the `find` occurs exactly once
and the row is perfectly runnable — it just does nothing.

## The consumer's stated REASON can narrow while its behaviour stays right (D450)

D425 says: when you add a producer to a shipped event, grep every consumer for facts it
DERIVES rather than reads. **The twin is: grep every consumer for the REASONS it
asserts.** `log.ts`'s `COUNTERS_PLACED` `"attack"` arm justifies its system voice with
*"`seat` owns the DAMAGED Pokémon, which for an attack is the attacker's OPPONENT"*. A
both-seats placement makes that sentence false and leaves the ROW correct — for a wider
reason than the one written (a system row names no actor, so it cannot credit the wrong
one). Nothing goes red; a successor reads a justification that its own board contradicts,
and "fixes" the row.

**Correct the reason at the site in the same commit that falsifies it**, and say which
half of it survived.

## `MATCH_RECORD_VERSION` for a NON-PARKING op: the question is REACHABILITY (D450)

An `EffectOp` reaches storage by exactly one route — `EffectContinuation` carries
`{pendingOp, rest, ctx, record}` and lives at `GameState.phase.cont`, which
`MatchRecord.state` persists. **`rest` is the second door and it is the one that gets
forgotten**: a program that parks writes every op AFTER the parking one into `rest`, so an
op that never parks is still persisted if any shipped program places it behind one.

So "does this op park?" is not the question. The question is **"can any producer put this
op into a written continuation?"**, and it is answered off the PRODUCERS — walk
`registryCardIds()`' four program-bearing keys plus the deriver's arms — not off the op.
D450 added TWO REQUIRED fields to a shipped op for free on exactly this argument, and the
argument is a measurement rather than a shape claim.

## A bare integer operand in an arithmetic census expression, for the third slice (D450)

D365 wrote it and D423 re-earned it; D450 paid it again. `censusAtHead.test.ts` carries the
unbuilt-printings figure at THREE sites, and one of them is a bare `250` inside
`expect(250 - REGISTRY_ATTACKS.length - SPLIT_ATTACK_UNITS - COMPOUND_ATTACK_UNITS)`. A
line-targeted grep for `toBe(250)` steps the other two and leaves this one, and the failure
that follows quotes a number that looks like an unrelated defect.

**The comment at that site already said so.** Reading it was not enough; running the suite
was. **Step the census, then run — and expect the run to find a site the grep could not.**

## A refusal names TWO things and only one of them may be true (D451)

D450 found a refusal whose BOUNDARY was real and whose CONCLUSION did not follow. D451
found the same shape one slice later, in a sentence that has stood since 0.88.0: these
rows *"read their amount off the TARGET rather than off the text … which is a different
mechanism and **no capture can express it**"*.

Both halves were checked and they answer differently. **The AMOUNT is genuinely
unprintable** — the sentence carries no count. **The DESTINATION is printed, is a bare
integer, and a capture expresses it exactly.** The refusal named the quantity the reader
must PRODUCE and concluded something about the quantity the reader must READ, and the two
are not the same quantity.

**When a doc block refuses on "X cannot be expressed", write down which X**: the thing the
sentence prints, or the thing the op needs. A sentence that prints a destination and needs
an amount is expressible the moment something computes between them.

## The floor for a PER-BODY computed amount is `healEachAll`'s, not the whole-op guard (D451)

This engine has THREE shipped shapes for "refuse a non-positive amount" and they are not
interchangeable:

- **above the walk** (`counterEachAll`, `damageActive`: `if (amount <= 0) return state;`) —
  correct when the amount is a CONSTANT the producer handed in;
- **before the park is built** (D449's `damageChosen` arms) — same case, one seam earlier;
- **inside the per-body closure** (`healEach`, `healEachAll`: `if (healed <= 0) return
  pokemon;`) — the only correct one when the amount is COMPUTED PER BODY.

A whole-op guard on a per-body amount lets ONE body already at the target cancel the fold
for every other body. **Ask where the amount is computed, not what the neighbouring op
does**, and drive a board where one body's answer is zero and its neighbour's is not.

## A "cannot kill" property is worth a guard, not a coincidence (D451)

`counterUntilRemainingHp` fills a body to `damage = max − remainingHp`, which is lethal
exactly when `remainingHp <= 0`. Every printed destination is positive, so the property
holds for free on today's catalog — which is precisely D324's situation with
`effectiveMaxHp`'s floor, and D324's answer applies: **write the guard anyway, because the
alternative is an invariant stated in three doc blocks and asserted by no line of code.**

The guard is what lets the op ship with **no `KNOCKED_OUT`, no `takePrizes`, no
`koByEffect` marker and no Prize argument at all** — and it is the single line a future
*"until its remaining HP is 0"* has to delete, which makes the cost of that printing
visible at the site instead of discovered by a board.

## Two printed tokens that CO-VARY need two anchors, not two optional groups (D451)

`COUNTER_SPREAD_ON_OPPONENT` gets away with one optional `(Benched )?` because exactly one
token varies. When TWO vary **together** — *"each of … Benched"* or neither and *"Active"*
— a single regex with two optional groups additionally accepts the CROSS PRODUCT, which is
two sentences the catalog does not print and whose readings nobody has decided.

**Count the varying tokens before reaching for an optional group, and if there is more than
one, ask whether they are independent.** Two anchors say the two printed things and refuse
the crossings; the crossings are then a driven refusal rather than an accident.

## A census delta has TWO cardinalities and they can move by different amounts (D451)

Three consecutive slices (D448, D449, D450) claimed sentences that each carried exactly ONE
printing, so "+N sentences" and "+N printings" were the same number and every ladder took
the same front term. D451's three sentences carry 2, 1 and 2.

**Read both figures off the corpus before stepping anything**, and expect the front terms
to come in at least two sizes in one pass: `censusAtHead.test.ts`'s chains count PRINTINGS
(this slice: `- 5`), the sentence-keyed ladders count SENTENCES (`- 3`), and
`opponentResistanceBonus.test.ts`'s eleven-deep ladder counts FIXTURE IDS (`- 1`). Three
sizes, one commit — and a slice that assumed one number would have been wrong in two of
the three places.

## A coverage predicate is an INSTRUMENT, and an uncommitted one is a number nobody can re-run (D454)

D453 published **`758 producer-side · 358 implementation-side · 24 producer-ONLY · ZERO
implementation-ONLY`** over the `EffectOp` union and shipped **no script**. `tmp/` held its
four pass scripts and not its op audit, so the numbers on the page were unfalsifiable by
construction — which is D211's whole complaint about mutant tallies, arriving one level up
at the tallies' own measuring device.

Re-derived at D454, the structural conclusion **does not survive**. D453 measured PRODUCER
regions wide (two brace levels out from each `op: "K"` literal) and IMPLEMENTATION regions
narrow (the `case "K":` arm body only). Following the CALL GRAPH out of the arm — every
top-level `interpreter.ts` function transitively reachable from it whose fan-in over the 74
kinds is ≤ 4 — returns **665 producer / 811 implementation** and **6 implementation-ONLY
kinds, not zero**. And the NON-transitive variant that attributes only EXCLUSIVE helpers,
which reproduces D453's own totals to ~2% (**744 / 337** against its 758 / 358 on the same
corpus), returns **5**. **Two predicates, one conclusion: zero was never the number.**

🛑 **AN ASYMMETRIC PREDICATE MANUFACTURES A DIRECTIONAL LAW.** Wide on one side and narrow
on the other, "coverage is a strict chain from producer to implementation" is what you get
whatever the corpus looks like. **State the region definition for BOTH sides in the same
sentence, and if the two are not the same shape, say why before you draw a conclusion from
the asymmetry.**

⚠️ **AND THE SLICE THAT STATED THE LAW BROKE IT.** D453's own 18 rows are **17
implementation-side and 1 producer-side**, so "zero implementation-only" was false in its
own commit and its resume point did not say so. **Re-run your structural claim against the
corpus you are about to write, not the one you measured.**

## A shared helper is the implementation of EVERY op that calls it (D454)

Attributing only EXCLUSIVE helpers reported `scheduleCounters`, `scheduleDiscard` and
`scheduleKnockOut` as having **zero implementation rows** when they have **six** — five D434
rows on `scheduleDelayed`, the one function the three arms delegate to, and one D435 row on
`sameSchedule`, the private helper `scheduleDelayed` itself calls.
D453's recommendation named all three as the next slice's targets on exactly that blindness.

⚠️ **THE SIXTH ROW IS ONE CALL FURTHER OUT THAN THE FIFTH**, which is why "attribute the
shared helper" is not enough on its own: the attribution has to be **transitive**, and what
stops it swallowing the whole file is a FAN-IN cap (`withActive` and `topUid` are reachable
from nearly every arm; `sameSchedule` from three). **Cap on fan-in, not on call depth.**

**Any op-level coverage claim owes an answer to "what does this do with a helper called by
three arms".** The two honest answers are *attribute it to all three* (what D454 does) and
*exclude it and say the figure is a floor*; silently dropping it is the third, and it
produces a work order for work that is already done.

## Measure the op's LIVE POPULATION before choosing which line to pin (D454)

Every op D454 touched had its printings counted first — by walking `deriveAttackEffect`
(plus both composing splitters) over `legalAttackCorpus()` and every `programFor(id)` in
`registryCardIds()`, and counting sentences, printings and registry cards separately. That
is what makes `unreachable-population` a **declaration** instead of a sweep verdict ninety
minutes later, and it is cheap: one script, one run, all 74 kinds at once.

⚠️ **AND IT CATCHES DOC ROT ON THE WAY PAST.** `installRecoil`'s header in `interpreter.ts`
quotes *"put 10 damage counters on the Attacking Pokémon."* at *"2 printings"*; the live
family is corpus line 178 at **8 counters / 5 printings**, and `Attacking Pokémon` returns
exactly **3** corpus rows, none of them a ten.

## Needle EVENT and FIELD names, not only op names (D454)

`STATUS_PREVENTED` had **zero rows in the whole corpus** before D454. So did
`statusImmunities`, `HAND_DISCARDED` and `installedRecoil`. D172's entire §12 immunity gate
— four printings, `passivesOf`, three source classes, a whole slice — was executable by
nothing, and every op-name search said `applyStatus` was well covered (eleven rows, all on
the producer side).

**An op NAME is metadata; an EVENT name is what the implementation writes.** The semantic
pass's needle list should carry the event types and the state field names an op touches,
because those are the strings a row about the implementation will actually quote.

## A stopping rule you can re-run beats an adjective (D454)

*"358 implementation-side rows over 53 kinds"* is not obviously enough or short. D454's
proposal, stated so it can be re-computed and argued with:

> **An op's implementation is COVERED when every code line in its implementation region that
> RESOLVES A SEAT — `ctx.seat`, `otherSeat(`, `state.players[` — is quoted by at least one
> mutant row's `find` span.**

Measured at D454: the corpus moved **178/470 = 0.379 → 190/470 = 0.404**, and the five ops
pinned went from **0/n** to 3/3, 3/3, 3/3, 2/2 and 1/2. The rule is chosen because the two
worst defects of this run were both seat crossings that no test caught (D447), and because
it is **per line, so a `find` spanning a whole function cannot inflate it** — the weaker
rows-per-decision-point ratio (0.628 → 0.637) can.

🛑 **AND DO NOT WIDEN A `find` TO BUY A DIGIT.** `applyStatus`'s uncovered second seat line
reads an ALREADY-RESOLVED seat; extending the row by one line would have scored 2/2 and
added no guard. **A metric you can move without adding a defect is a metric you have started
gaming.**

## When a comment tells you there are TWO of something, go and look at the other one (D454)

`preventAttackUse`'s doc block says *"the bare ternary occurs TWICE in this file (an
unrelated op shares the expression)"* — written so a mutant would be anchored on the comment
rather than the line. D412 pinned its own copy. **The unrelated op is `applyStatus`, and its
copy sat with eleven producer rows and zero implementation rows for 42 decisions.**

A comment that names a duplicate is a free survey result somebody already paid for. This is
D414's *"grep the vocabulary the invariant is phrased in"* with the grep already written into
the source.

## A committed instrument is a convention, not a courtesy (D455)

D454 made "commit the instrument" a rule after D453's audit script went missing. D455 is the
first slice to pay it, and it cost **one lint fix and one comment block** —
`scripts/mutation/opcoverage.ts`, `bun scripts/mutation/opcoverage.ts`, no arguments, which
reproduces D454's headline figures EXACTLY at the base commit (74 kinds · 666 producer / 841
implementation · seat lines **190/470 = 0.404** · decision points **841/1321 = 0.637**).
That exact reproduction is the point: **a successor can now falsify the number in one
command instead of rebuilding the predicate**, which is what D454 spent most of a slice on.

Three requirements make it an instrument rather than a script:

- **It states its own predicate in a comment, including WHAT IT CANNOT SEE** (D419). Here:
  implementations outside `interpreter.ts`; the three `runProgram`-spliced gates; anything
  reachable only from the RESUME side; producers outside `effects.ts`/`registry.ts`; and
  that it counts incidences, never whether a row is any good.
- **It answers the default question with no arguments.** Env knobs are for the variants,
  not for the headline.
- ⚠️ **A NEW FILE UNDER `scripts/` IS INSIDE `bun run check` AND OUTSIDE `tsc -b`, AND BOTH
  HALVES MATTER.** `tsconfig.node.json` includes `vite.config.ts` and nothing else, so the
  script is not in the app's build graph (`mutants.ts`'s reason: a harness that measures the
  suite has no business inside it). But `biome.json`'s `files.include` carries `scripts/**`
  and `bun run lint:coverage` requires every source file to be countable — so the file is
  held to `noExplicitAny`, `noNonNullAssertion` and `--error-on-warnings` from the moment it
  lands, untracked or not. D455's first `bun run check` went RED on `lint/style/useTemplate`.
  **Write it to the repo's lint rules, not to a throwaway's.**

## An instrument that scans a type union must strip COMMENTS first (D455)

Scanning `effects.ts`'s `EffectOp` union for `op: "…"` returns **76** kinds. Two of them do
not exist: `{ op: "knockOut"; target: … }` at **6248** and `{ op: "takePrizes"; count: number }`
at **6379** are PROSE inside doc blocks — shapes that were considered and refused — and they
report with rows on neither seat, which reads exactly like a coverage gap. Stripping block
and line comments returns the **74** that are declared.

D454's script got 74 by taking only the FIRST `op:` per union member, which is correct here
by accident and would break on any member whose discriminator is not its first field.
**When you scan source text for a declaration, say whether comments are in or out** — a doc
block that DISCUSSES a shape is indistinguishable from one that declares it, to a regex.

## "Predicate artefact" is a claim about ONE op, and it does not distribute (D455)

D454 excluded four ops from its own target set as *"a predicate artefact — `runProgram`
splices them"*. Three of them are: `coinFlipGate`, `conditionGate` and `recordGate` have
dead `case` arms marked *"never reach here"*, and their real work is the queue loop.

**`optional` is not**, and grouping it with them hid a real gap. It has a live park arm
(`{ kind: "confirm" }`), a live apply arm, and its yes/no splice is `continuationOps` —
invisible to an arm-rooted predicate for a **different reason** (that function is reachable
from no `case` arm at all), and pinned the whole time by `D316-decline-buys-nothing`.

⚠️ **AN EXCLUSION LIST IS AS DANGEROUS AS AN ENUMERATION AND ROTS THE SAME WAY.** A set of
things you have decided not to look at is exactly where a real gap survives, because nothing
downstream re-checks it. **Name the mechanism per member, not per group** — if the sentence
that justifies the exclusion is not true of every member individually, the group is wrong.

## The two survivor diagnoses need DIFFERENT commands, so run both (D455)

Two `shuffleDeck` rows survived their first probe and they were different faults:

- **Over-narrow `expectKilledBy`** (D453's fourth cause) — `--full` KILLED it in 119s. The
  repair is a killer set, not a test.
- **A real suite hole** — `--full` SURVIVED it across 449 files / 9,975 tests. The repair is
  a test.

⚠️ **`--full` IS THE DISCRIMINATOR AND IT IS THE FIRST THING TO RUN**, before writing either
repair. Guessing wrong in one direction ships a test nobody needed; guessing wrong in the
other ships a killer set that hides a hole.

⚠️ **AND WHEN `--full` KILLS IT, HUNT THE KILLER ONE SUITE AT A TIME.** D455 ran the row
against twelve candidates individually: only **two** kill it, and the ten that do not are the
finding — **the entire derived-search family drives `shuffleDeck` and none of it checks whose
deck was shuffled.** A killer set assembled by plausibility would have named four suites,
been green, and said nothing true.

## A thread that is only observable on the SECOND use (D455)

`shuffleDeck`'s last line threads the advanced `rngState` back onto the state. Dropping it
leaves the deck genuinely shuffled and **every board assertion in this repo green** — the
cards move, the SHUFFLE row is filed, the zones balance — while the generator never advances,
so the next shuffle replays the same permutation and the next coin flip repeats a face. The
whole suite could not tell the two builds apart, on the op that nearly every search program
in the engine ENDS with.

**A resource that is CONSUMED and written back is invisible to any assertion about one use.**
The rung has to compare two states across the consumption, and it owes a control on the same
axis (D424): D455 asserts the generator MOVED on the yes and STOOD STILL on the no, same
board, same seed — because *"rngState moved"* alone is satisfied by any action that touches
the generator for any reason.

⚠️ `D335-shuffle-is-spent-and-thrown-away` had recorded this exact defect on a DIFFERENT
function since D335. **A row on one function is not coverage of the rule** — grep for the
other consumers of the same resource the day you write it.

## "Recorded as X" in a doc block, for the SECOND slice running (D453, D455)

D453 found `interpreter.ts`'s `moveCountersChosen` arm claiming *"recorded as an equivalent
mutant"* with **zero** rows in the corpus for that op — false for 237 decisions. D455 found
the identical sentence on the `optional` APPLY arm, in the same file, also with zero rows
intersecting it by character span.

**Two instances in three slices is a pattern, not an accident.** The mechanism: a slice
writes a claim about `scripts/mutation/mutants.ts` into `packages/engine/src/*.ts`, and
nothing anywhere reads the two together. ⚠️ **GREP `"recorded as"` / `"as an equivalent
mutant"` / `"pinned by"` ACROSS `packages/` WHENEVER YOU TOUCH THE CORPUS**, and check each
hit against the module. It is one command and it has paid twice.

The repair is a DECLARED row, not a deleted claim: `survives: { kind: "equivalent" }` with a
self-invalidating reason (D427) makes the sentence true *and* makes it go loud the day it
stops being true.

## A refusal is scoped to whatever its LAST clause names (D456)

D451 refused *"…put damage counters on the Attacking Pokémon equal to the damage done to this
Pokémon."* with this reason: *"D451's quantity is a fact about the BODY STANDING THERE,
readable at the instant the op runs, where this one is a HISTORY of what happened during the
opponent's turn — **it needs a durated watcher and a recorded figure, neither of which this op
has**."*

Every word of that is true **of `counterUntilRemainingHp`**, and the last clause says so. The
sentence still read as a statement about the family, and it was quoted forward that way into
three more files. The durated watcher had existed since **D152** (`InstalledRecoil`), and the
figure never becomes a history at all: both §9 read sites hold it as a local named `dealt` —
the same local their own `dealt > 0` gate reads — two lines above the call. The whole channel
was one **required** parameter.

- **A refusal's scope is the op it was measured on, and its GENERALITY is a separate claim
  that nobody checks.** Write *"this op cannot"*, never *"the engine cannot"*, unless you have
  grepped the engine.
- ⚠️ **Before inheriting a refusal, ask where the sentence would be READ, not where it was
  refused.** D451 refused it at a `^Put` anchor whose read site runs inside the attacker's own
  program; the sentence's read site is the §9 recoil, a turn later, in a different file. Two
  addresses, two answers — and only one of them was ever measured.
- **Three shipped refusals have now fallen in seven slices, and every one named its own
  trigger.** D413's (a population), D428's (an executable rung), and this one (an op scope).

## A refusal that names the varying token IS a work order (D456)

`counterPutChosen.test.ts`'s bullet (g) said, in full: *"179 is the SHIPPED sentence at line
178 with 'even if IT is Knocked Out' re-spelled 'even if THIS POKÉMON is' — a near miss on a
parenthetical — and 180 reads its amount off the damage just taken."* It named the family, the
read site, the exact varying token and the exact channel. **It cost one regex alternation to
collect, and it sat unread for five slices** while the residue was ranked by printing count.

D413 made this point about a doc block. It is truer of a test bullet, which nobody greps.
⚠️ **When you write a refusal that names ONE token, say so in its first line** — *"one
alternation away"* is a price, and a price is the only part of a refusal a successor acts on.

## The specimen in a refusal rung must be the PRINTED bytes (D456)

Four test files pinned the retaliation sentence as still-unread using a string spelling *"(even
if **it** is Knocked Out)"*. The catalog prints *"(even if **this Pokémon** is)"* and nothing
else on that sentence. So four rungs were green about a byte string no card carries — D183's
paraphrase defect (*"an arm written from a paraphrased sentence passes a test written against
the same paraphrase"*) arriving at a **refusal**, where it is harder to see because nothing
downstream consumes the specimen.

**Derive the specimen from `legalAttackCorpus()` where you can**, and where you keep a
historical string, assert the printed one BESIDE it so the difference is visible rather than
quietly corrected. This is D423's rule (*pin an absence on the POPULATION, not on a specimen*)
with the specimen shown to be wrong rather than merely narrow.

## "Corrected in place" is a claim with a population (D456)

D455 found a doc block quoting a printed sentence the catalog does not carry, corrected it in
`interpreter.ts`, and closed out with ✅ *"`installRecoil`'s PHANTOM SENTENCE, CORRECTED IN
PLACE"*. The identical quote was live in **six** more places at that commit — `effects.ts`
(twice), `types.ts`, `index.ts`, `installedRecoil.test.ts` and `apps/api/src/lobby/match.ts`.

D415's rule (*before correcting a comment, grep for its first distinctive clause; if it appears
more than once, the correction is a SWEEP and its cost is the sweep*) is written in this file,
**by the run that then did not run the grep.** ⚠️ **A close-out that says "in place" owes the
count of places**, and the count costs one `grep`.

## When a persisted record gains a second field, both reads need the same gate (D456)

`InstalledRecoil` went from `{turn, amount}` to `{turn, amount, ofDamageTaken?}`. The `amount`
read has been gated on `stacking` (*"is this record's window the one I am writing"*) since
D152, because D124's expiry is by **arithmetic** — a spent record is still sitting on the body
and nothing sweeps it. The first draft of the FLAG read was ungated, so a spent stamp would
have turned a fresh FLAT install into a scaled one two turns later.

This is D412's *"one fact gains a second field, find every read site"* pointed inward: the two
reads are four lines apart in one function, and the asymmetry is exactly what a reader skims
past. ⚠️ **Write the gate on the new read by COPYING the old read's line, not by re-deriving
it** — and drive it across a real turn boundary so the staleness is produced by the clock
rather than written by hand.

## A log row cannot print a number it does not have (D456)

When an amount becomes a CHANNEL rather than a literal, the row that announces the
installation has nothing to say. `RECOIL_ARMED` rendered *"will counterattack for **0 damage**
during your opponent's next turn"* — a claim that nothing will happen, printed at the instant
a real trap is armed. The fix is a flag on the event and a second `log.ts` arm that names the
RULE instead of a figure.

**This site is invisible from the engine.** Nothing about the board, the record, the census or
the mutants points at it; only rendering the row does. ⚠️ **When you widen an amount to a
source, render the row before you call the slice done** (D421's rule, and the second time it
has caught a row that was false rather than stilted).

## A mutant with nowhere to die is a coverage finding (D456)

*"The interpreter's §9 funnel passes 0 for the hit"* would have survived 449 files. The funnel
(D328's re-homed main hit) reaches `installedRecoilOf` exactly as `attack.ts` does, and every
board that drives it used the CATALOG half of the recoil — Rocky Helmet's flat 20 — which is
indifferent to the new argument. The header of the very suite that drives it LISTS the
installed half among the reactions it is about, and no board there drove it.

**When you thread a new argument through two call sites, write the mutant for BOTH before you
write either killer set.** The site with no board is the finding; D455 said the same thing
about `shuffleDeck` one slice earlier, and the two together are the rule: **a row on one call
site is not coverage of the function.**

## Census chains: two more ways to get the term wrong (D456)

D428 said *step every nested chain, not the one that reddened*. Two new failure modes, both
found by the suite after a pass that looked complete:

- ⚠️ **TWO CHAINS CAN SHARE ONE PHYSICAL LINE.** `opponentBenchCount.test.ts` and
  `retreatCostBonus.test.ts` spell `expect([resolving.length - … , units(resolving) - …])` on a
  single line, and a per-line pass steps only the first of them. **A chain is a chain whether
  or not it starts a line.**
- ⚠️ **A CHAIN'S UNIT IS NOT ALWAYS READABLE OFF ITS HEAD EXPRESSION.**
  `precociousEvolution.test.ts`'s chain is headed `head`, which counts **printings** despite
  not being spelled `units(...)`. A pass that classified chains by their head text gave it the
  sentence term and was off by one.

And the bare `240` operand inside `censusAtHead.test.ts`'s arithmetic — the one
`grep 'toBe(N)'` cannot see — **bit for the sixth consecutive slice, inside a comment block
that has warned about it each time**. That is D418's shape reaching a COMMENT: the note is read
only by someone already standing there, and nobody stands there until the assertion has failed.

## Two surfaces, two spellings, and the reason written down (D456)

D421's rule is *same fact, same spelling, every surface*. D456 breaks it once, deliberately, and
that is the interesting case:

- the **op** carries `amount: number | "damageTaken"` — parse-time, reaches storage only behind
  a park, and this op never parks;
- the **persisted record** keeps `amount: number` and carries a separate `ofDamageTaken?: true`.

A persisted `amount: "damageTaken"` would put a STRING in the numeric field `attack.ts` SUMS
with `passivesOf().damageAttacker`, so a deploy that did not know the inhabitant would compute
`20 + "damageTaken"` → `"20damageTaken"` → `> 0` false, and would silently drop the ALWAYS-ON
share as well as the installed one. **When you split a spelling, write the failure the unified
spelling would have produced** — otherwise the next reader "unifies" them.

⚠️ **And the sibling spelling was refused for a second reason worth keeping.** `heal.amount`
already uses `"dealt"` for a §8.5 figure, and reusing that word here would have invited the
`case "heal"` arm's own resolution (`ctx.dealt ?? 0`, five lines away) to be copied onto this
op — a real answer about the wrong hit. **A name that invites the neighbouring arm's code is a
worse name than an inconsistent one.**

## `MATCH_RECORD_VERSION`: the reachability argument has a precondition (D456)

D453, D454 and D455 all held 29 partly on *"an `EffectOp` reaches storage only through a
continuation's `pendingOp` and its `rest`, written only on a park"*. That argument is about
**`EffectOp`s** and says nothing about a `GameState` field. `InPlayPokemon.installedRecoil` is
persisted directly, every save, park or no park.

⚠️ **Before reusing the reachability argument, name the ADDRESS the shape changed at.** If it is
a `GameState` field, the only argument available is `match.ts`'s own discriminator — *does the
OLD byte string still mean what it meant* — and the optional-vs-required question has to be
asked with D421's criterion **applied**, not copied. The sequence of refusals now reads: D432
*no rest*, D434 *rest not old*, D435 *rest old but the loss is `NaN` corruption*, and D456
*rest old, loss inert, and the residue is a byte string the surviving path cannot author*.

**"Detectable" can live in the BYTES rather than on the board.** D456's dropped rider leaves
`{turn, amount: 0}`, and the deriver's `counters >= 1` guard is the only producer of a flat
`installRecoil` in the engine — measured over the whole corpus and the whole registry, in the
suite, rather than asserted.

## A refusal names a CARRIER, and the carrier can be wrong (D457)

D235 refused *"attach them to **1 of** your Pokémon"* at count > 1 with: *"`attachFromDeck` has
`max` but no `attachEnergyFrom.count`, so the phrase is UNREPRESENTABLE here and it is
representable one op over."* Every clause of that is true, and the conclusion is false. `count`
pins a batch to the ONE body `attachEnergyFrom` always picks; this op's park answers with a MAP
from card to target, so the same printed rule is a constraint **on the map** — how many TARGETS
the answer may name — and needs a flag, not a count. It cost **one optional field** and it sat
refused for 222 decisions.

⚠️ **When a refusal says "unrepresentable", ask *in what*:** in the OP, in a FIELD, or in the
shape of the ANSWER the park collects? A price written in a sibling op's vocabulary is a price
for the sibling. And the reason this one survived so long is that it was RIGHT in its own terms:
the successor greps for a missing field, finds the field genuinely missing, and re-derives the
refusal instead of the mechanism.

**Its dual is worth stating too:** when you add a per-X cap, ask whether the print also spells a
cap on the number of Xs. `maxPerTarget` (cards per body) and `oneTarget` (bodies per answer)
bound opposite ends of one map, and neither can be recovered from the other.

## "Unread by every reader" is not "unbuilt" — measure the registry BEFORE pricing (D457)

D457's brief handed over a measured family: 13 sentences / 18 printings that no
`deriveAttack*` reader resolves. **Four of the thirteen (6 printings) are BUILT**, through the
registry summand — and `censusAtHead.test.ts` requires the two summands to be DISJOINT
(`registryUnits` asserts `resolvedByAnyReader(text) === false` for every registry sentence). So
for those four, writing a reader arm does not *add* a build: it **redens the census until the
registry row is retired**, and the honest delta is zero printings for two files of churn.

⚠️ **Run `programFor`/`registryCardIds` over a family's sentences before ranking it by
printings.** `resolvedByAnyReader` is a reader instrument and answers a reader question; D314
said "refused by the deriver" and "unbuilt" are different claims, and at family scale they can
differ by a third.

## A demonstrator can run out of unread sentences (D457)

`fix-trainerops` fields one attack per family so refusals have a live subject on a real board
(D181's `Strafe` precedent). `optionalSelfSwitch.test.ts` drives the loud `ATTACK_EFFECT_SKIPPED`
row off it as an ATTRIBUTION control (D214) — without one, a suite that only asserts
`toHaveLength(0)` on that row is green on a build that stopped emitting it. D457 built index 42,
which was **the last unread index of 71** (measured with `resolvedByAnyReader`, not assumed).

- **The control must be re-pointed at a sentence a successor cannot casually build.** Index 71 is
  the Future-banner attach: DATA-BLOCKED, because no ingested column classifies the banner
  (`packages/schema/src/catalog/card.ts` `cardSchema` carries `stage`/`types`/`trainerType`/
  `energyType` and no subtype column). A merely-unbuilt sentence would disarm the control the
  next time somebody writes an anchor.
  🆕🆕🆕 **D569 (D539): "DATA-BLOCKED" is WITHDRAWN for index 71** — the banner's supply turned
  out to be an engine table keyed by printing id (`banners.ts`, no ingest change), and the real
  printings (Miraidon `sv05-121`/`svp-092` "Peak Acceleration") are BUILT as a hand-written
  REGISTRY attack. The control still holds because no DERIVER reads the sentence on the `fix-*`
  card, and its `deriveAttackEffect(...)` → null rung is what goes red the day one does; the
  thirteen length-pin comments carry the same note. The lesson for the next re-point is the one
  below: "data-blocked" was a claim about the INGEST, and the engine can supply data itself.
- **The fixture is APPENDED and the length pin steps in every suite that carries it** — thirteen
  of them at D457 — in one pass (D431: a green run after fixing the one that reddened is evidence
  the runner stopped early).

## A PROMPT field costs five mirrors; an OP field costs none (D457)

D235 priced `redact.ts`, `projection.ts`, both HUDs and `log.ts` at **ZERO** because it added no
prompt field — the park was an existing shape. D457 adds one, and the same list is non-zero:
`packages/schema/src/match/redacted.ts`, `packages/engine/src/redact.ts`,
`src/features/game/projection.ts`, `GameHud.tsx` and `OnlineHud.tsx`, plus the prompt KEY that
decides remounting. Find them by grepping the SIBLING FIELD (`maxPerTarget`), never by trusting
a list a previous slice wrote for a different shape.

⚠️ **And a shared UI predicate needs unshared WORDS.** Both rules close a target row, so they
ride one predicate — but `maxPerTarget` closes a body that *already has its share* and
`oneTarget` closes a body *the Energy are not going to*. Rendering "already has one" over a
Pokémon holding nothing is the dialog stating a false fact about the board, and no engine test
can see it.

## The park IS the road to storage (D457, refining D456)

D453–D455 held `MATCH_RECORD_VERSION` partly on *"an `EffectOp` reaches storage only through a
park"*; D456 found that argument inapplicable to a `GameState` field. D457 is the case where the
op **does** park — and the lesson is that this is a reason to ASK the question, not to skip it:
`attachFromDeck.oneTarget` rides `EffectContinuation.pendingOp` and `attachCards.oneTarget` rides
the persisted `effect:choose` phase, so both are in a saved record.

**The detectability argument came from the REST of the record again, and this time from a
caption.** `attachFromDeckNote` builds the prompt's `note` from the same field, so a park whose
note says *"attach them to 1 of your Pokémon"* while carrying no rider is a byte string this
deploy cannot write: the two halves would have to disagree at the moment of writing. **When a
field also decides a string, that string is the witness that the field was there.**

## A CITED rule is a claim, and it rots faster than a count (D458)

**Two consecutive slices in one family spent a blocker whose stated reason named the wrong
carrier, and both reasons read as facts about the SENTENCE.** D457's was *"UNREPRESENTABLE
here"* — true of `attachEnergyFrom.count`, false of the op. D458's was *"a different sentence
SHAPE, so its own arm **by D232's rule**"* — and D232's rule, opened and read, says the
opposite: *a family collapses to ONE arm when its sentences differ in a NOUN and splits when
they differ in a VERB*, and it splits only where an alternation would have to loosen the
punctuation, the conjunction, the pronoun AND the verb form together. The sentence differed in
the NOUN COUNT. The build was one optional group and zero new anchors.

⚠️ **A citation is the cheapest thing in a doc block to write and the most expensive to check,
because it looks already-checked.** *"By D-NNN's rule"* is not a warrant; it is a pointer, and
the pointer is what rots. **Open the rule. `grep` for the decision id and read the paragraph the
rule actually lives in** — it costs one command, and in this family it was worth two slices.

## Decomposing one printed sentence into N ops (D458)

*"Search your deck for up to 2 Basic {G} Energy cards **and up to 2 Basic {L} Energy cards** and
attach them to your Pokémon in any way you like."* is TWO `attachFromDeck` ops and ONE trailing
shuffle. The decomposition is sound — and **only under preconditions the estimate did not
name**, which is D420's rule (*when you write a "just do X" note, write the condition under
which X is enough*) arriving at a program shape.

**Name what would COUPLE the pieces, then refuse the couplings you cannot honour.** Two
sequential searches carry two answer MAPS and two §9.2 FILINGS, so:
- a `batch: false` destination (*"attach them to **1 of** your Pokémon"*) would let one batch
  land on one body and the other on another — a split the card does not print;
- the §9.2 tail's `recordAs` slot would be OVERWRITTEN by the second op, so a board where the
  first search attached and the second whiffed files `[]` and the printed gate answers NO about
  an attach that happened.

Both are **0 printings**. Both are refused rather than mis-built (D190b/D199), **both are read
off the MODEL** — the destination table's own flag, the tail's own capture group — rather than
listed as bad pairs (D424), and each ships beside the admission that differs from it on ONE axis
(D427).

**And the equivalence argument is worth writing down, because it is what a successor will want:**
N ops reach the same end boards as one N-quota question exactly when the pools are DISJOINT,
every target stays eligible after each step, and nothing constrains the answer map. Drive both
extremes — everything on one body, and the batches apart.

## A recurring miss is a missing NAME, not a missing warning (D458)

`censusAtHead.test.ts` pinned its raw-unbuilt figure twice: once as a greppable `toBe(N)` and
once as a **bare operand inside an arithmetic expression**. **SEVEN CONSECUTIVE SLICES (D449,
D450, D451, D452, D456, D457, D458) stepped the first, missed the second, and were told by the
suite** — with a comment warning them about it sitting directly above the operand every time,
each slice adding a new paragraph to that comment saying the streak had grown.

That is D418's shape reaching a COMMENT: **the note is read only by someone already standing
there, and nobody stands there until the assertion has already failed.** The repair is not a
louder warning; it is `const RAW_UNBUILT_ATTACK_UNITS = N`, so one `grep` finds both sites.
**When the same figure is missed N times, stop describing it and name it.**

## Inserting a capture group is a re-transcription event (D458)

Adding ONE optional group to a shipped regex shifted its later groups by two — the destination
from `match[4]` to `match[6]`, the §9.2 tail from `match[5]` to `match[7]` — and broke **four**
mutant `find`s that quoted the old indices. **Every off-by-two spelling COMPILES**, and two of
them still derive a plausible-looking program: reading the destination from the wrong group is
loud (the whole family stops deriving), reading the tail from the wrong group is silent (one
sentence quietly loses its gate). **Write a mutant for each direction; the quiet one is the
reason the pair exists.**

⚠️ **And then the lint fix broke a fifth (D414 again, at authoring time for once).** The new
group left a template literal with no interpolation, `bun run check` flagged
`noUnusedTemplateLiteral`, and merging that fragment moved the anchor's tail line.
**`precheck` reported it in seconds; a sweep would have reported it after ninety minutes.**

## When "is the loss detectable?" answers NO (D458)

D421/D425 say: choose the shape so that losing the new information is detectable. D457 satisfied
it with a caption built from the same field. **D458 satisfies it by having nothing to lose** —
zero new op fields, zero new prompt fields, so a saved record gains only a LONGER
`EffectContinuation.rest`, not a wider one. Driven honestly, the LOSS direction answers **NO**:
a truncated `rest` degrades into a sentence the catalog does print and nothing else in the frame
contradicts it (the truncated park's PROMPT is byte-identical to the whole one).

**That is an argument FOR the shape, not a defect in it** — a truncated required list is data
corruption, which no `MATCH_RECORD_VERSION` protects against and which the slice does not make
newly possible. **Report the NO rather than hiding it: a slice that cannot answer the
detectability question is different from one for which the question does not arise.**

## A flat coverage reading can be predicted from the file list (D458)

`opcoverage`'s SEAT-LINE denominator lives in `interpreter.ts` alone. A slice that touches no
`interpreter.ts` bytes and whose mutants are all producer-side on `effects.ts` **cannot** move
it — so the flat reading is forced, and saying so BEFORE running the instrument is stronger than
explaining it after. D457 found the same op reading `0/7` through a slice that rewrote its arm,
park, caption, validator, wire key and both HUDs; D458 is the second receipt. **Read a flat
figure as "this slice moved no seat lines", never as "this slice added no safety" — and if you
can name why from the diff alone, say it in the resume point.**

## Print the VALUE, not only the verdict (D459)

`scripts/residue-census.ts` classifies every unbuilt residue sentence by the single
deletion or substitution that reaches a built string. **Ten of the 130 residue rows at
D459's head were ONE-TOKEN deletions**, and a verdict-only instrument would have called
all ten equally cheap. Nine of them lose the deleted token's meaning: delete `Basic`,
`Benched`, `Ancient`, `Future`, `{L}`, `{F}` or `Iono's` and the remainder derives with
the filter GONE. The tenth — `card` in *"…for each Special Energy **card** attached to
this Pokémon."* — derives to `{per: 70, count: {kind: "energyOnSelf", energyType:
"special"}}`, filter INTACT.

**That one difference is the whole targeting decision, and no count can carry it.** So
every probe reports what the remainder derives TO, beside the string. The instrument does
not classify SPELLING vs SEMANTIC for you; it puts the two derived values side by side so
the judgement takes one look instead of a doc block. This is D454's "a stopping rule you
can re-run beats an adjective" one level down: **a re-runnable rule beats an adjective,
and a re-runnable rule that shows its working beats a re-runnable rule.**

## A one-axis deletion is a LOWER BOUND on the work, never an estimate (D459)

The census's classes are assigned by the CHEAPEST probe that fires, so a sentence with a
compound structure AND an unrepresentable filter lands on the structure. Measured at
D459's head, with the recorded refusals beside them:

| class | sentences | printings | what it means |
|---|---:|---:|---|
| `COMPOSE` | 1 | 2 | both halves build; only the JOIN is missing |
| `COMPOUND-*` | 16 | 22 | one half builds, the other does not |
| `SUBST-n` | 10 | 12 | differs from a BUILT corpus sentence in one contiguous region |
| `PHRASE-n` | 15 | 20 | one contiguous deletion builds, and no built sibling exists |
| `OPAQUE` | 88 | 126 | no single deletion or substitution reaches a built string |

⚠️ **`SUBST-2` contains *"This attack does 30 damage to each of your opponent's Pokémon."*,
one token (`each` → `1`) from a sentence this engine builds — and D447 priced that row as a
THIRD `spreadDamage.target` plus a §8.5 asymmetry between the Active and the Bench.** Both
are true. **Read the class as "at least this much is missing", never as a price.**

## A deletion that derives can point at the WRONG HALF (D459)

Two residue rows (*"This attack does {60|100} damage to each of your opponent's Pokémon ex
[and Pokémon V]. This attack's damage isn't affected by Weakness or Resistance."*) drop
their FIRST segment and the remainder builds — because the remainder is the W/R-immunity
RIDER, which every reader already claims, while the head is a filtered spread that no
mechanism exists for. A classifier that reported "one deletion away" would have pointed at
the cheap half of a row D447 priced at three mechanisms. **So the probe re-asks the build
predicate on the REMOVED half too, and the class name says which half survived
(`COMPOUND-head` / `COMPOUND-tail` / `COMPOSE`).** `COMPOSE` — both halves build — is the
only class whose price is actually known, and there is exactly **one** such row in the
whole residue, 2 printings. ⚠️ **That reproduces D447's own price for a mirror compound
splitter — *"unlocks 1 sentence / 2 printings, which does not pay"* — mechanically and from
the other end, which is the strongest kind of agreement between an instrument and a
record.**

## A corpus row number: the convention was broken TWICE after it was written (D459, about D448)

D448 wrote *"a corpus row number is a FILE LINE"* after D447's resume point cited array
indices. **D446, D457 and D458 all cite ARRAY INDICES anyway** — `fileLine − 53` at this
head. Every number in D457's and D458's blocker tables (`387 401 403 404 410 412 419 420
430`) resolves to a different, unrelated sentence when read as the file line the convention
mandates.

🛑 **AND D448's OWN TIE-BREAKER DOES NOT WORK.** It says *"cross-check the PRINTING COUNT
before acting on a cited row — the count is what tells the two conventions apart in one
look."* Measured over those nine citations, the printing count is **the same under both
readings for four of them** (401: 1p/1p, 403: 2p/2p, 404: 2p/2p, 420: 1p/1p). A check that
passes 44% of the time on wrong data is not a check. **Cite the file line AND quote the
sentence text; the text is the only discriminator that always works** — which is D456's
"the specimen in a rung must be the PRINTED bytes" arriving at a citation instead of a test.

## A mutant with nowhere to die can ACQUIRE one (D459, refining D456)

`D459-multiply-fold-drops-its-type-filter` replaces the `×` fold's captured `energyType`
with `null`. **Before this slice it was equivalent on the legal pool**: all NINE legal
`×`-fold printings were untyped, so the captured filter was `null` on every one of them
and no board could tell the two apart. D459's two printings are the first that discriminate
it. D456 said a mutant with nowhere to die is a coverage finding; the converse is a
BUILDING finding — **when a slice adds the first printing that inhabits an existing field,
go back and ask which old mutations it has just made killable.** Look for them at the arm
you widened, not at the bytes you wrote.

## A probe that patches a source file must restore it in a `finally` (D459)

A throwaway script that wrote a mutation into `effects.ts`, imported the module and crashed
on a bad import left the mutation in the tree. **The next script read that file as its
baseline and "restored" the mutated version** — so a build that had been verified minutes
earlier was silently gone, and the only thing that caught it was a follow-up probe printing
`FIND OCCURS 0x`. `git diff --stat` did NOT catch it: the file was still dirty by the right
number of lines, because the slice's own comment blocks were still there. **Wrap the patch
in `try/finally`, and re-assert the built behaviour (not the line count) after any probe
that writes to the tree.**

## A union rule can cut both ways inside one slice (D460)

D440's rule — *nullary or asymmetric payload ⇒ two members; identical payload ⇒ one member
with the discriminator as a field* — was applied twice in D460 and gave **opposite** answers
one type apart:

- the three printed threshold predicates (*either … is heads*, *both … are tails*, *at least 2
  … are heads*) carry the identical payload (a face and a count) ⇒ **ONE shape, `face` as a
  field**;
- `perHeads` and `perHeadsThenThreshold` carry asymmetric payloads ⇒ **TWO members**.

**The tell is the PAYLOAD, never "which one looks like a widening".** The second question is
the one that reads like a widening and is not: adding optional `threshold?`/`ops?` to
`perHeads` would have saved four lines in `attack.ts` and made every `perHeads` value carry
two keys it must ignore.

## A normalisation that is sound at the EVALUATOR can be wrong at the DERIVER (D460)

*"If both of them are tails"* over two coins is exactly *"zero heads"*, and at the flip site
the rewrite is total — `faces.length` is in scope. **At derive time it is not.** The rewrite
needs `flips` to know its own cardinality, which `AttackFlipCount`'s `printed` member does and
its `attachedEnergy` and `untilTails` members do not, so the normalisation would be a rule that
fires on one of three members and couples two axes the union's own doc block calls independent.

**Ask WHERE the arithmetic is available, not whether it is correct.** A rewrite that is only
expressible for one inhabitant of a field is a coupling, not a simplification.

## The version tax has a FOURTH class of site and no prescribed grep sees it (D460)

D459 measured the tax as 37 assertions / 41 sites and named the greps: `engineVersion` and
`manifest.version`. **Both miss the `it()` TITLE.** Three test files name the version in the
test's own name (`it("engineVersion is 0.359.0 and \`manifest.version\` agrees")`), and at
D460's head **two of the three were stale** — one of them since D459, because the assertion
inside it had been stepped by a targeted replacement and the title had not.

A stale title is not green-by-construction the way a stale doc block is; it is worse, because
the test REPORTS under that name and a run log then says a version the suite does not assert.
**Step the titles in the same pass, and count them: 38 assertions / 3 titles / 4 other sites.**

## The mutation corpus is a source file and Biome refuses it above `files.maxSize` (D460)

`scripts/mutation/mutants.ts` crossed **2,097,152 bytes** during D460 (2,112,246 after its
rows). Biome answers a file over `files.maxSize` with an `internalError/io` diagnostic **and
still counts it as checked**, so every lint step exits 0 while the repo's largest source file
is linted by nothing.

**The first symptom was `bun run check` failing on D212's `lint-coverage` guard**, 248 slices
after that guard was written — the guard reads the limit out of `biome.json` rather than
hard-coding it, so raising the limit raises the check with it. Raised 2 MiB → 4 MiB, and the
raise now carries its own mutation row (`D460-maxsize-refuses-the-corpus`, killed by
`bun scripts/lint-coverage.ts`), which is D212's `include` pair applied to the other field of
the same object. **Expect this again around 4 MiB; a corpus that grows ~20 KB a slice reaches
it in roughly a hundred.** [🆕🆕🆕 D587: it came, at 4,195,627 bytes with D587's rows — raised 4 MiB → 8 MiB
(`biome.json` `8388608`), the D460 row's `find` following the value.]

## A new fixture is a census delta in FOUR places, not one (D460)

D425's rule says a fixture moves `clauseApostrophe`'s sweep. D460 measured the full set for one
fixture card carrying three printed sentences:

| rung | move | why |
|---|---|---|
| `clauseApostrophe` derivable | 185 → 188 | three sentences, each with a possessive, all now derivable |
| `opponentResistanceBonus` id floor | 554 → 555 | one new `FIXTURE_POOL` id |
| that file's ELEVEN-deep `ids.length - N` ladder | +1 at the front of all eleven | same id, eleven rungs |
| the 21 frozen-tail chains in 8 files | `- 3` / `- 4` at the FRONT | the READER; ⚠️ `grep -n` reports 18 — three share a physical line |
| the reader/residue chains in 12 files | +3 / +4 | the READER, not the fixture |

**The first three are invisible to any forecast made from the reader side**, and the fourth
wave arrived only after the first three were green. Four full suite runs to converge, which is
D428/D431's "a clean run after one round of fixes is not evidence the round was complete"
holding for the fourth consecutive slice.

## Refuse a consequent that can never fire, and say which end you are refusing (D460)

The threshold family owes TWO guards and they are the same argument from opposite ends:
`atLeast >= 1` (a threshold of zero is met by every outcome, so the printed `if` decides
nothing) and `atLeast <= flips` (a threshold above the flip count is met by no outcome, so the
printed consequent never lands). **The second is the dangerous one**: admitting it silences
`ATTACK_EFFECT_SKIPPED` — the only thing that would tell a reader the sentence is unread —
while shipping a status that can never be applied. Two mutation rows, not one, because a slice
that kept only one guard leaves the other end open and nothing says so.

## A `PHRASE-1` row is a LOWER BOUND on the work and often a bad estimate of it (D461)

`scripts/residue-census.ts` classifies a residue sentence `PHRASE-1` when deleting ONE token
reaches a string some reader builds. **That is a statement about WHERE the blocker is. It says
nothing about what the derived value LOSES**, and D459 already measured that nine of ten
one-token deletions lose the token's meaning.

D461 is the priced case. Both its rows derived to `[{op:"healEach", amount:100}]` after the
deletion — and dropping `Basic` heals every EVOLVED body on the side, while dropping `Benched`
heals the ATTACKER. The slice cost one anchor, one noun map, one deriver arm, two op fields, two
fixtures, a deck, an interpreter diff and a 30-test suite.

**Before pricing a `PHRASE-1` row, print the derived value beside the printed sentence and say
what the deletion lost.** If the answer is "which objects the sentence is about", the class name
is measuring the wrong thing.

⚠️ **And the mis-reading direction is usually QUIET.** Deleting a narrowing yields a SUPERSET, so
the engine does MORE than the card says: more log rows, never fewer, no `ATTACK_EFFECT_SKIPPED`,
and no count that goes down. Every assertion written against the built rows stays green.

## One printed adjective slot can hold two different KINDS of fact (D461)

*"each of your **Basic** Pokémon"* narrows by a CARD property. *"each of your **Benched**
Pokémon"* narrows by a BOARD position. They occupy the same slot in the same template and they
are not the same axis.

**The decisive test is `matchesFilter`'s signature**, not intuition: it is
`(card: Card | undefined, filter: CardFilter)` and is never handed an `InPlayPokemon`, so a board
position is inexpressible as a `CardFilter` **at any width**, while a printed stage is exactly
`{kind: "basicPokemon"}`. Verified at D204, D264, D265, D331, D450 and again here.

The shape then follows from the union's own rule with no judgement left over:

| the printed rows differ in | the shape |
|---|---|
| PAYLOAD (nullary vs carrying, or different fields) | two MEMBERS |
| a discriminator only, identical payload | ONE member, discriminator as a FIELD |
| a discriminator on TWO axes, identical payload | ONE member, **TWO fields** — never one enum |

A single `scope: "basic" \| "bench"` enum fails twice: it puts two axes in one slot
(`attachFromTop.restTo`'s standing refusal — *"two keys on one axis can be set to contradict each
other"*, pointed the other way) and it cannot spell the CROSSING. The catalog need not print the
crossing today; **the vocabulary must not be the reason it could never be read.**

**`AttachTargetRiders` (D204) is the shipped precedent and the names are ITS names** — `basicOnly`,
`benchOnly`, `targetType`, `ownerPokemon`, `notIfKO`, two card facts and two board facts as flat
riders on one op. Reach for it before inventing a field name.

## A frozen tail and a live head look identical and are edited in OPPOSITE places (D461)

D426/D437: a census chain is edited at the FRONT, never at the END, because a tail that moves with
the head asserts `head === head`. D461 stepped SEVEN tails at the end before re-reading the rule.

**The tell is the left-hand side of the assertion:**

| left-hand side | what it is | how to step it |
|---|---|---|
| `expect(live)` — a bare live expression | a LIVE HEAD | change the literal |
| `expect(live - 3 /* … */ - 2 - 1 - … - 922)` | a CHAIN with a FROZEN TAIL | add a term at the FRONT |

`precociousEvolution.test.ts` carries **one of each within sixty lines**, so the file is not the
unit and neither is the number. ⚠️ Reverting the tails is what exposed the live head — it went red
on its own, which is the cheapest possible way to be told the difference.

## A fixture's census delta depends on what it PRINTS, not on the fact that it exists (D461)

D460's table lists `clauseApostrophe` first among the rungs a new fixture moves. D461 added two
fixtures and **that rung did not move**: neither sentence carries a possessive. What did move was
the `FIXTURE_POOL` id floor (555 → 557), its eleven-deep `ids.length - N` ladder, and
`stage1Bonus`'s Stage-1 count (83 → 84, because one fixture is a Stage 1).

**Read the fixture's own fields against each rung's predicate rather than stepping the whole
table.** ⚠️ And a synthetic Stage 1 must carry a NON-NULL `evolveFrom` — `stage1Bonus`'s chainless
rung is a singleton finding that a careless fixture turns into an artefact (D390, honoured at
D391/D393/D421/D424/D432/D439 and now here).

## "Every printing site moves by the same delta" is false (D461)

`compoundCompose.test.ts` §4's `claimedWhole` is a PRINTINGS figure that did not move when four
claimed printings arrived, because it carries a SECOND predicate: it counts printings that are
MULTI-CLAUSE **and** claimed whole, and both new sentences hold zero `. ` joiners.

**A census site is its predicate, not its unit.** Step by analogy and a site with a second
conjunct goes red; the cheap disproof is running the suite rather than reasoning about it.

## A refusal list is a claim with an expiry date, and re-pointing it is owed twice over (D461)

D461 built a sentence that **two** shipped `toBeNull` lists held as live witnesses
(`boardHeal.test.ts`'s `REAL_NEAR_MISSES[4]`, `selfHeal.test.ts`'s `UNMAPPED_NEAR_MISSES[0]`), and
one of them carried the comment *"nothing in the pool prints this spread form at all today"* while
the pool printed it twice.

Two rules, and the second is new:
1. **Grep every refusal list for the sentence before you build it** — the STANDING NOTE in those
   files already says re-point rather than delete.
2. 🆕 **Prefer a witness whose blocker is DATA over one whose blocker is a mechanism.** A sentence
   unbuilt because a column does not exist cannot be built by any reader at any width, so the slot
   stops needing re-pointing every few slices — and if it ever goes green, the thing that changed
   is the ingest, which is exactly what a witness should be able to tell you.
   🆕🆕🆕 **D569 (D539): the premise is WITHDRAWN as stated** — D568/D569 supplied a per-printing
   fact with NO ingest change (`banners.ts`, an engine table keyed by printing id), so "a column
   does not exist" no longer means "no reader at any width". A witness is durable when no DERIVER
   reads its TEXT (pin `resolvedByAnyReader` → false beside it), not when its datum is missing.

## The `Ancient` banner is the residue's largest non-mechanism blocker: 7 sentences / 10 printings (D461)

Measured over all 640 rows of `legalAttackCorpus()`, not sampled. The persisted `Card`
(`packages/schema/src/catalog/card.ts`) carries **no** banner column — `id, setId, localId, name,
category, image, illustrator, rarity, regulationMark, hp, stage, evolveFrom, types, retreat,
abilities, attacks, weaknesses, resistances, trainerType, energyType, effect, legal, variants` —
and the banner is a per-PRINTING fact, so a name-keyed species table is refused forever (Great Tusk
ex `sv01-123`/`-230`/`-246` is the same species with and without it).

**The falsifier is an INGEST change** (a per-printing column plus a `CardFilter` member). Nothing in
`packages/engine` can be it. Priced here so successors stop re-deriving it: `Future` is the same
shape one banner over and blocks two more `PHRASE-1` rows.

🆕🆕🆕 **D569 (D539): "the falsifier is an INGEST change … nothing in `packages/engine` can be it" is
WITHDRAWN.** The falsifier was `packages/engine/src/banners.ts` — an engine table keyed by PRINTING
id (D135; the per-printing objection above is exactly why it is id-keyed), Tera at D568, Ancient and
Future at D569 (86 ids, two sources) — plus the `CardFilter` members `bannerPokemon` and the D569
any-category `bannerCard`. "The persisted `Card` carries no banner column" stays TRUE. Of the
Ancient/Future attack rows, D569 built Primordial Beatdown, Vengeance Fletching, Majestic Sword and
Iron Smasher through readers and Peak Acceleration, Land Collapse, Supportive Singing and Perplexing
Transfer as index-keyed registry rows; what stays unbuilt (Iron Moth, Unrelenting Onslaught,
Destructo-Press, C.O.D.E.: Protect) is blocked by a MECHANISM, not by the banner. 🆕🆕🆕 D571 (D539): Destructo-Press is
BUILT (its mechanism, a reveal-and-discard-matches op, `revealTopDiscardMatching`); three stay unbuilt.
🆕🆕🆕 D575 (D539): ~~"three stay unbuilt"~~ — ONE stays unbuilt (Unrelenting Onslaught). Iron Moth (the `"ancient"` member of the
persisted `AttackerClass`) and C.O.D.E.: Protect (`PlayerSide.sideAttackBlock`, ended by `switchInto`) are
BUILT at D575 behind `MATCH_RECORD_VERSION` 37 → 38; Unrelenting Onslaught (Koraidon `sv08-116`, R-1 unruled)
remains, and it is still a MECHANISM blocker.
🆕🆕🆕 D579 (D539): ~~"ONE stays unbuilt (Unrelenting Onslaught) … R-1 unruled … remains"~~ — BUILT at D579: R-1 was RULED by
the user (reading B, 2026-10-05) and the mechanism, a seat-level attack record (`GameState.recentAttackers`,
`MATCH_RECORD_VERSION` 40 → 41), was built. No Ancient/Future attack row stays unbuilt.

## A refusal that names a SENTENCE is usually a claim about a WARRANT, not about a carrier (D462)

D424 measured *"Your opponent's Active Pokémon is now Burned, Confused, and Poisoned."* (corpus
FILE LINE 679, 1 sentence / 2 legal printings), named it, and left it LOUD:

> the ONLY 3-status row in the column, so a 3-list template would be D121's literal over a pool of
> one

Every word of the measurement is true and the conclusion does not follow. **D121 prices a NEW
parameter.** The third slot is `STATUS_WORDS` — D424's own vocabulary, warranted in the same doc
block on three distinct printed pairs with both slots varying — at one more position. The pool of
one was the SENTENCE's and never the parameter's, and the sentence cost ONE anchor and ONE arm over
a helper that already existed.

**When a refusal cites a warrant rule, ask which THING the rule is about.** "Two printings before a
parameter" is about the parameter. A sentence that reuses an existing parameter at a new position
introduces none, so the rule has nothing to say about it. D462 is the second slice in four to find
a shipped refusal that priced the wrong noun (D457's was "unrepresentable here" about the wrong
op's vocabulary).

## Choose a TEMPLATE over a LITERAL when the captures are what keep a refusal REACHABLE (D462)

The usual argument for a template is generality and the usual argument against it is D121. D462
found a third axis that beats both when they tie on cost.

`DEFENDER_STATUS_TRIPLE` could have been a literal — `Burned, Confused, and Poisoned` — for the
same one regex and the same one arm. It is a template because those three words are **provably
slot-disjoint**, so `defenderStatusOps`' collision refusal would be UNREACHABLE from the literal
arm: dead code that can only rot, and exactly the "declared but not live" defect D424 avoided by
driving its own refusal synthetically. With the slots open, a constructed *"…is now Asleep,
Confused, and Poisoned."* reaches the refusal the way the pair's six collisions do.

**A template that can never be WRONG and keeps a guard reachable beats a literal that cannot be
wrong and makes the guard dead.** Check the second half explicitly: enumerate what the open slots
admit (here 18 sentences, one printed, every one deriving a correct program) before claiming it.

## A red test run reports the ENDPOINT; D426/D437 says to edit the HEAD (D462)

D461 wrote down that a frozen tail and a live head are edited in opposite places. D462 broke that
rule anyway, six times in one pass, and the reason is worth more than the rule:

**The assertion that throws is the endpoint, so the endpoint is what the tool names.** A vitest
failure reads `expected [372, 1271] to deeply equal [373, 1273]` and the obvious edit — the one at
the reported line — is precisely the forbidden one. A tail that moves with the head asserts
`head === head` and no sweep can tell.

**When a subtraction chain reddens, do not edit the line the runner named.** Find the chain's HEAD
(`resolving.length - N /* …`, `units(resolving) - N /* …`, `ids.length - N /* …`) by a string count
over the file, put the new term there, and leave the endpoint alone. D462 reverted all six and
stepped 22 heads instead.

## Vitest stops an `it` at its first throw, so COUNT THE FILE — do not re-run the suite (D462)

D462 needed **three** rounds of `bun run check` to make eleven files green, and no round was wrong
about what it reported. Round 1 named 12 files / 16 tests. Round 2 found **11 sites that had been
quiet behind them**, two in files that had not been red at all. Round 3 found **8 more**.

A census `it` in this repo routinely carries three or four assertions over the same corpus — a
sentence count, a printing count, a residue count and a chain. **Fixing the reported one makes the
next one reportable and nothing more.** The instrument that sees all of them at once is a string
count over the file:

- `s.split(pattern).length - 1` sees every occurrence, including several on one line;
- `grep -c` counts LINES and under-reports (D462's version tax: 52 occurrences in 43 files, so
  seven files were under-reported by nine);
- a line-anchored regex under-reports too — D462's first head scan required the head to start the
  line and found **15 of 22**.

## `String.replace(find, replacementString)` interprets `$` in the REPLACEMENT (D462)

`$&`, `` $` ``, `$'`, `$n` and `$$` are directives inside a replacement STRING. D462's new anchor
ends `\\.$` immediately before a backtick, so `` $` `` — "everything before the match" — spliced
19,000 lines of `effects.ts` into itself on the very first patch. The file went from 25,970 to
45,031 lines and nothing but a line count noticed.

**Always pass a function: `s.replace(find, () => replace)`.** A throwaway patch script must also
(a) assert the `find` occurs exactly the MEASURED number of times, (b) refuse `find === replace`,
and (c) restore every touched file from an in-memory backup in a `finally`. D462's did all three
and still needed the line count, because a `$`-splice is a successful replacement.

## `opcoverage.ts` cannot see a reader ARM, and that is its universe rather than a gap (D462)

D462 moved `residue-census.ts` (residue 124/172 → 123/170) and left `opcoverage.ts`
**byte-identical in every column** except the corpus size — seat lines 206/470 = 0.438, decision
points 878/1326 = 0.662, `applyStatus` 1/2 = 0.50 before and after.

That is correct by construction. The instrument's universe is `EffectOp` KINDS and the producer /
implementation regions that mention them; a slice whose whole subject is a new ANCHOR and a new
deriver ARM producing an **already-produced** op adds no kind, no arm in the interpreter, and no
row whose `find` span lands within `FANIN`/`LEV` of a literal `"applyStatus"`.

**Say which instrument is blind to your subject BEFORE you run it**, so a flat column reads as a
prediction met rather than as a slice that did nothing.

## The `Ancient`/`Future` banner is 12 sentences / 16 printings, and it is FOUR carriers (D462)

D461's entry above says 7 / 10 for `Ancient` alone. Re-measured over the census output at HEAD, the
residue holds **12 sentences / 16 printings** mentioning `Ancient` or `Future` — 8 non-`OPAQUE`
(`COMPOUND-head` ×1, `SUBST-2` ×3, `SUBST-3` ×1, `PHRASE-1` ×3) and 4 `OPAQUE`.

**The data refusal stands** (`effects.ts`, `PREVENT_DAMAGE_FROM_CLASS`'s doc block): the banner is a
per-PRINTING fact and no ingested column carries it. **But it is not one mechanism even if the data
arrives.** The eight non-`OPAQUE` rows want the predicate in at least four different carriers — a
`CardFilter` kind, `preventDamage.fromClass` (a one-member union — 🆕🆕🆕 D575 (D539): ~~"one-member"~~,
THREE members since D575, `"basic" | "ancient" | "ex"`), an op FIELD in the
`moveCountersToDefender.ownerPokemon` shape, and a SUPPORTER-CARD predicate for *"If you played an
Ancient Supporter card…"*, which is not about a Pokémon at all. **Price the CARRIERS, not the
token.**
🆕🆕🆕 **D569 (D539): "the data refusal stands" is WITHDRAWN** — the data arrived as an engine table,
not an ingest column (`banners.ts`, keyed by printing id; "no ingested column carries it" stays
TRUE), and the carriers prediction held exactly: D569 paid a `CardFilter` kind (`bannerCard`, beside
`bannerPokemon`), an op FIELD (`moveCountersToDefender.filter`, `healChosen.filter`), and a
SUPPORTER-CARD predicate (`yourPlayedBannerSupporterThisTurn`); the `fromClass` carrier (Iron Moth)
is the one deferred, for its rollback reading.
🆕🆕🆕 **D575 (D539): ~~"the `fromClass` carrier (Iron Moth) is the one deferred"~~ is WITHDRAWN** —
kept as written (D418). D575 PAID the fourth carrier: `AttackerClass.stage` widened to
`"basic" | "ancient" | "ex"` (kept REQUIRED, `attackerMatchesStage` an exhaustive `switch`) behind
`MATCH_RECORD_VERSION` 37 → 38, the ELEVENTH position — the rollback reading is answered by the bump,
not by an optional key (decisions.md D575). All four carriers are now paid.

## The `?suffix=` filter fails CLOSED, and the ingest MAPPER is not what is missing (D462)

Answered from the code, as far as a checkout with no database allows:

- **`?suffix=` returns an EMPTY page, not the unfiltered one.** `apps/api/src/catalog/query.ts`
  pushes `inArray(cards.suffix, query.suffix)` and SQL `NULL IN (…)` is never true. Failing closed
  is the better of the two modes and is worth recording as a property rather than an accident.
- **`/facets` `suffixes` serves `[]`** while the column is empty (`selectDistinct` under
  `isNotNull`), so the rail renders no chip and the filter is unreachable from the UI.
- 🛑 **The bigger fact is already recorded and is worse than "vacuous":** migration `0006`, which
  ADDS the column, **has never been applied to the remote database**, so production has no `suffix`
  column at all — and `/facets` selects it inside a shared `db.batch`, so deploying ahead of the
  migration fails the WHOLE endpoint (`apps/api/src/db/catalog.ts`; runbook
  `docs/workstreams/backend-data.md §3.7`).
- ⚠️ **The ingest CODE is not missing.** `apps/api/src/ingest/map.ts` maps
  `suffix: normalizeSentinel(card.suffix)` on the Pokémon arm and `apps/api/src/ingest/upserts.ts`
  writes the column. "The fix is an INGEST change" is imprecise wherever it appears: what is
  missing is a MIGRATION on the remote and an ingest RUN.
- ⚠️ **And it would not classify `Ancient` anyway** — `suffix` is the rule-box marker
  (`ex`/`V`/`VMAX`). `packages/schema/src/tcgdex/card.ts` declares no banner field. 🛑 **The limit of
  that check, said out loud: the schema is NOT strict** (no `.strict()`, no `.passthrough()`, no
  catchall), so zod strips unknown upstream keys silently — this repo's transcription having no
  banner field is not evidence that tcgdex has none.

## `OPAQUE` in `residue-census.ts` means UNCLASSIFIED, never EXPENSIVE (D463)

`OPAQUE` is the classifier's *no-verdict* bucket: **no single deletion and no single substitution
this instrument can make reaches a string some reader already builds.** That is a statement about
**how far the instrument can edit a sentence**, and it says nothing whatever about how much the
sentence costs.

D463's proof, measured: corpus file line **234** (*"Flip a coin until you get tails. For each heads,
discard an Energy from your opponent's Active Pokémon."*) sat in `OPAQUE`, and its twin at line
**200** (*"Flip 2 coins. …"*, byte-identical consequent) sat in `SUBST-7`. **They are ONE shape**,
reached by two `AttackFlipCount` members that shipped at D127 and D129. Line 234 cost one regex and
one arm — the same as the row the instrument had classified as cheap. It is `OPAQUE` only because
the edit that would reach a built string is seven tokens and lands on a *different* flip count.

Three rules follow:

1. **A row in `OPAQUE` is not out of reach; it is out of the INSTRUMENT's reach.** Three slices in a
   row read `OPAQUE 88/126, unmoved` as *"the cheap work is gone"*. It moved on the fourth, to a
   pair that cost two regexes.
2. **When a cheap class names a sentence, grep the corpus for its SHAPE, not for its class.** The
   pair here was findable only because `SUBST-7` named the twin: the instrument pointed at an
   `OPAQUE` row it could not classify.
3. **The class table SPLITS one shape across classes and has no way to join it.** Two rows in
   different classes may be one slice; the table cannot say so, and nothing in the output hints at
   it.

## A refusal that groups N rows under ONE reason is N refusals until each is priced (D463)

D452's `OUT_OF_SCOPE` held four corpus rows and refused three of them (lines 200, 217, 234) with a
single shared count — *"`discardEnergy` PARKS on a genuine choice"*. D463 built two of the three,
and the third was **never refused for that reason at all**: line 217 is *"For each TAILS"*, a FACE
axis `programPerHeads` does not have, which no amount of parking work would have touched. It is
still unbuilt now that the park is shipped.

**A grouped refusal takes its REASON from its cheapest member and its COST from its dearest**, and
both numbers are wrong for every member in between. Split it before quoting it. The executable form
of the split is worth writing: D463's §1 re-enumerates the whole per-face family off the corpus and
asserts exactly ONE row is unbuilt, so the distinction reddens if it stops holding.

## A refusal is only as retired as its most CONFIDENT test (D463)

D130 wrote that N sequential parks are *"the one thing D130's expansion cannot express"*. The code
contradicted it from the first day — `resumeProgram` ends in `runProgram(applied, rest, …)`, so an
op in `rest` that parks parks again. D423 corrected it in prose. **D452 disproved it EXECUTABLY**,
building the two-op program by hand and asserting the second copy sits in `cont.rest`.

And for eleven more decisions, four separate files went on asserting the sentence was unreadable —
because the correction and the assertion lived in different files. **A prose correction does not
retire a refusal; the arrays do.** When a refusal is overturned, grep the whole repo for its
SENTENCE, not for its decision number.

## Check the negative-control cost FIRST, then pay it — it is not a reason to refuse (D463)

Before building a residue row, grep the suites for its sentence. D462 found one (`"Each player draws
3 cards."`) whose construction would have silently un-armed two attribution rungs; D463 found
another — Krookodile `sv01-117`, the FIELDED *"stays LOUD"* end-to-end witness in five suites.

**The two cases end differently and the difference is the point.** D462's row had a SEMANTIC reason
to stay refused as well (`drawCards` is seat-fixed). D463's did not: refusing it would have left a
PRINTED sentence unbuilt for no reason but a test's convenience — **a refusal about a SUITE wearing
a claim about a SENTENCE**, which is the exact failure mode this file already warns about one
section up.

The cheap way to price it: **make the engine change alone and read the runner.** D463's negative-
control cost measured 22 failing assertions across 17 files in one run, before a line of test work
was written. And when the witness is re-pointed, D418's question is owed: *what did the OLD claim
catch that the new one cannot?* Here — that `deriveAttackEffect` still refuses the sentence, which
is kept in all four files, **because the trap it guards got WORSE when the sentence got built**: a
float now puts TWO readers on ONE printing at TWO sites instead of turning a loud skip into one
silent discard.

## ENCODE FIRST, WRITE SECOND — `open(p, "w")` truncates before `.write()` runs (D463)

D463 emptied `scripts/mutation/mutants.ts` (23,514 lines → 0 bytes) with

```python
open(p, "w", encoding="utf-8").write(text)   # text held lone surrogates
```

`open(p, "w")` **truncates the file when it opens it**. The `UnicodeEncodeError` was raised inside
`.write()`, so the file was already empty and nothing was written. The repo's standing rule —
*"assert its own file's size after writing, wrapped in try/finally"* — **would not have caught it**:
the `finally` did run, and it reported the damage rather than preventing it.

The rule that does:

```python
payload = text.encode("utf-8")     # fails here, with the file untouched
with open(p, "wb") as fh:
    fh.write(payload)
```

Repair, when it happens: `git show HEAD:<path> > <path>` and re-apply the slice's own edits. That is
not `git checkout --` / `reset --hard` / `stash` and stays inside the standing prohibition.

⚠️ **And the cause is worth naming separately: lone surrogates.** `"🛡"` in a Python
string is two unpaired surrogates and is NOT encodable; the emoji is `"\U0001f6e1"`. Text copied out
of a JS/TS source (where `🛡` is a valid pair) does not survive the trip.

## A FRONT-INSERT must append to the head and leave the tail byte-for-byte (D463)

Adding a term to the front of a census subtraction chain, D426/D437's rule, has a mechanical trap.
This ate eighteen minus signs in one pass:

```python
l.replace(head + "- ", head + FRONT_TERM)      # FRONT_TERM ends "*/ "
# result:  units(x) - 2 /*D463*/ 2 /*D462*/ …   ← D462's own "- " is gone
```

Splice by **appending to the head and keeping the whole tail**: `l[:at] + head + FRONT_TERM +
l[at + len(head):]`. Any offset computed from the marker's length is where the sign goes.

⚠️ **And the marker is not unique on the line.** `BUILT.attack - ` occurs twice on one
`censusAtHead.test.ts` line — once as code, once inside a comment quoting the count. Take the FIRST
occurrence and assert its column is inside the code region (`0 <= at < 80`), never `count(…) == 1`.

## A PAIR of anchors needs a PAIR of probes (D463)

D463's new suite had one mid-sentence refusal loop:

```ts
for (const text of [`This attack does 30 damage. ${PRINTED_TWO}`, …]) expect(…).toBeNull();
```

It varied the SENTENCE across its cases while holding the DEFECT fixed, which **looks** symmetric
and left the twin anchor's `^` with nothing driving it — reported by the probe as a GAP on
`D463-until-tails-anchor-loses-its-caret`. When a slice ships two anchors, the negative loop must
run every probe against BOTH; the four pre-probe passes will not find this, because each row is
individually well-formed and each sits in a region the slice really changed.

## Two claims stronger than the code accumulated on ONE unpinned line (D463)

`attack.ts`'s D130 expansion had **zero mutant rows for 333 decisions** (needled at D463:
`repeated.push`, `coinFlip.ops`, `expanded.length > 0`, `i < heads` — 0 hits each), and it collected
two comments that overstate what the code does:

- *"the one thing D130's expansion cannot express"* — false from the first day, and the whole of
  D463.
- *"an empty `EffectOp[]` would route the attack through `settleProgram` … a different ending with
  the same result … how a no-op grows a KO sweep it did not have"* — **measured false at this head**:
  the mutation was applied and the WHOLE engine suite run against it (341 files / 8,888 tests,
  green). With no damaged-trigger and no KO-Tool stage, `epilogue` is `[attackEpilogue]` alone,
  `advance` pops it and calls `finishAttack` itself, and draining an empty program reaches the same
  call — which a comment ten lines BELOW the guard already calls *"byte-identical to the pre-slice
  tail"*, contradicting the one above it. Declared `equivalent` and kept, not deleted: it is written
  from the rule, and it is self-invalidating (D427).

**An unpinned line is where prose goes to stop being checked.** Needling `mutants.ts` for the
identifiers in a region you are about to build on costs one grep and is the cheapest audit here.

## `MATCH_RECORD_VERSION`: pick the argument SHAPE that is true, not the one you used last (D463)

Three shapes are on record and they are not interchangeable:

- **REACHABILITY (D461)** — *the op never parks, so it can never reach `phase.cont.rest`.*
- **SERIALIZED ALPHABET (D462)** — *no new op, op FIELD or op VALUE, so no byte a v29 record can
  hold after the slice that it could not hold before it.*
- **NOTHING OPTIONAL ADDED (D458)** — *the widening is on a field that was already optional.*

D463 is the alphabet, and **reachability is FALSE for it**: its op parks, so the continuation is
written and persisted. Reusing the previous slice's sentence would have been a confident false
claim about the one structure the version guards. **The COUNT of copies is not a byte in the
alphabet** — an array that already accepts N members does not gain a shape by holding two.

⚠️ And when the slice DOES park, the LOSS direction stops being a formality: empty `rest` in the
persisted bytes and the resumed board must take a **different, observable** ending. That is what
turns "N parks" into a claim about a BOARD rather than about a log.
## An instrument that produces a COMMITTED figure needs a KILLER, not a doc block (D465)

`scripts/residue-census.ts` shipped at D459 as *"the instrument that produces a coverage figure is
committed beside the corpus it measures"*. It then ran for six slices with **nothing behind it**,
and the bill arrived twice:

- The three literals it transcribes from `censusAtHead.test.ts` **rotted by exactly one slice, four
  separate times**, and its own doc block says so — *"the rot is one slice deep every time and
  nothing reddens."*
- Its span probe had a **mechanical blind spot** that over-populated `OPAQUE` by six rows for six
  slices. A wrong classifier does not go red. It just points at the wrong target.

`scripts/residue-census-gate.ts` is the repair, on D212's precedent (`lint-coverage.ts`) and D411's
(`recovery-gate.ts`): a `killedByCommand` killer, not a `bun run check` step. ⚠️ **A `*.test.ts`
CANNOT do this job** — `scripts/**` is outside vitest's include globs *and* outside `tsc -b`'s
project references, so importing the probe from a suite breaks the typecheck instead of guarding
anything. The gate needs the module importable, which means guarding the printing with
`if (import.meta.main)` — a two-line change that costs nothing and is the whole difference between
a script and a library.

⚠️ **THE GATE HOLDS NO NUMBER OF ITS OWN.** Its §A reads the pinned literals out of the suite's
SOURCE and compares them with the instrument's own computation. A figure copied into a second file
is the exact thing that rotted four times; a gate that copies it rots the same way and takes the
alarm with it.

## A tokeniser that splits and rejoins on `" "` cannot delete the LAST token (D465)

`spanProbe` did `text.split(" ")`, dropped a span, and `join(" ")`. Every corpus sentence ends with
its terminator, so a deletion reaching the last token took the period with it and the remainder
**could never build** — not "rarely", never. Six residue rows / 9 printings sat in `OPAQUE` for that
reason alone.

The repair is not one `if`, which is what the guess said:

1. re-attach the sentence terminator when the span reaches the last token, **and**
2. drop a dangling clause separator (`,` `;` `:`) first — two of the five rows leave `…of your
   deck,` and a period alone yields `deck,.`, and
3. do **not** re-terminate a remainder that already ends in `.` — that is a NARROWING dressed as a
   widening, and it silently costs hits the probe already had.

⚠️ **KEEP THE UNREPAIRED CANDIDATE AND ASK BOTH.** Replacing the plain join with the repaired one
makes the fix a change; asking both makes it a widening, and "no span this probe used to reach can
be lost" becomes a property rather than a hope. It is checkable in one diff: every pre-existing
`SPAN` evidence line must come out byte-identical.

## D464's MEASUREMENTS survived the slice; its ESTIMATE of the fix did not (D465)

D464 wrote three things about the blind spot. Two were measurements and reproduced exactly a slice
later (`18 − 1 = 17` sentences, `24 − 2 = 22` printings once its own row was built; the six named
FILE LINES were the six, to the row). The third — *"the fix is one `if` in `spanProbe`"* — was a
guess and was wrong in the cheap direction. **A measurement survives a slice. A size estimate does
not, and the two sit in the same paragraph looking alike.**

## A CLASS TABLE is a statement about the INSTRUMENT, so fixing the probe moves it with no build (D465)

D465 moved `OPAQUE` **86/123 → 81/116 before building anything**, and then built a row and `OPAQUE`
**did not move at all** — the reverse of the previous two slices, which both reported an `OPAQUE`
step as the receipt for their build. Both facts are correct and neither is about the work:

- the fix moved five rows out of `OPAQUE` because the probe could suddenly reach them;
- the build then took one of those five, so it left `PHRASE-6` and not `OPAQUE`.

**Never read a class-table delta as a measure of what a slice did unless the instrument stood
still.** Say which of the two moved.

## A FIXTURE_POOL id is a CENSUS entry, and adding one has a tax of its own (D465)

D464 could write *"NO NEW FIXTURE ID"* because its sentence already sat on a shipped fixture. D465
could not, and the id cost twelve assertions in one file that has nothing to do with the slice's
subject: `opponentResistanceBonus.test.ts` pins the pool SIZE (558 → 559) and carries **eleven
nested `ids.length - N` chains** that all take a front term. Check `Card.resistances` and the
weakness column in the same pass and say they stood still — a fixture added for a damage-number
claim has no business moving a Resistance census (D427).

## A chain head can sit MID-LINE, and an anchored grep cannot see it (D465)

The census tax is paid by stepping chain heads at the FRONT. A sweep for
`^\s*<subject> - [0-9]+ /\*` found sixteen and missed three, because those three sit inside a
two-operand `toEqual([…, …])` on one line. The runner then showed **two of the three** — the third
was behind a passing assertion in the same `it`. Re-grepped without the `^` anchor it reads
nineteen. **Grep the loosest plausible shape and state what the pattern cannot see (D419), and never
treat the runner's list as the population.**

## An `expect(...).toHaveLength(N)` over a FILTERED corpus is a negative control (D465)

`scaledAnySnipe.test.ts` §1 builds its population with
`/for each/i.test(t) && t.includes("damage to ")` and pins `unbuilt` at 8. An exact-sentence grep of
every `*.test.ts` for the row D465 built returned **ZERO hits** — and the rung still reddened,
because the row was never named: it was *counted*. ⚠️ **GREPPING FOR THE SENTENCE DOES NOT FIND
EVERY CONTROL THAT HOLDS IT.** A filter-built population holds sentences nobody typed.

Re-pointed rather than decremented (D418): the count now says 7, and two new assertions name the row
that left and pin the ONE fact that makes it a non-member — its op is `damageSelf`, not
`damageChosen`. A count that steps 8 → 7 records that something left and says nothing about what;
the pair goes red on *"a reader widened past the count clause"* and green only on *"D465 built the
self-hit"*, which the old count could not distinguish.

⚠️ **AND THE SAME LOOSE PATTERN OVER-INCLUDES IN BOTH DIRECTIONS.** `t.includes("damage to ")`
matches *"damage to ITSELF"* — a recoil on the attacker's own body has been sitting in a
"chosen-target hit" population since that rung was written. Its own block already recorded that the
pattern MISSES a member (a counter-spelled snipe); it took a slice to notice it also holds one that
was never a member.

## `damageCountersOnSelf` ships and is NOT usable from an `EffectOp` (D465)

`DamageCountSource` has seventeen members including `damageCountersOnSelf`, and reaching for it is
the obvious move. It is a **PARSE-TIME type** — its own doc block says *"no `EffectOp` carries
one"* — consumed in the same tick by `attack.ts`'s module-private `scaledAttackDamage`, which needs
a defender seat and an effective cost array that `EffectContext` does not have. The shipped way to
scale an OP's own amount is a boolean rider folded by an `(op, state, ctx)` function
(`snipeAmount`'s `perTakenPrize`, `perEnergyOnSelf`, now `recoilAmount`'s
`perDamageCounterOnSelf`). **The general collapse into `scale?: DamageCountSource` was PRICED at
D448/D449 — 24 sites across 10 files plus a `MATCH_RECORD_VERSION` bump for zero extra printings —
so a third rider is that refusal re-applied, not a new decision.**

## The REACHABILITY argument has a FIRST-position form as well as a LAST-position one (D465)

D464's op reached `phase.cont.rest` and was safe because its `rest` was **EMPTY BY POSITION** — the
op was last. D465's is unreachable for the mirror reason: the only producer returns a program of
**LENGTH ONE**, so there is no earlier op at all, let alone a parking one. Both are D461's shape and
both must be **DRIVEN**, not asserted: pin `program.length`, and pin that `phase.cont` is absent
after the swing — **on a board where the op WHIFFS as well as one where it fires**, because a whiff
is not a park and the two are easy to confuse in a `stepOp` arm.


## A REFUSAL IS NOT AN ASSERTION, so its REASON can be false for years and nothing goes red (D466)

D466 built the row D446 had refused, and found D446's stated reason false in every clause:

> *"a stage ORDINAL is not a persisted field either — `Card.stage` is a free-text column and the
> engine's own `isBasicPokemon` / `evolveFromOf` read it as a BINARY. Spelling 'Stage 1' would mean a
> third reading of that column, and the row is ONE printing."*

`Card.stage` is a **persisted column with a CLOSED vocabulary** (`Basic | Stage1 | Stage2 | VSTAR |
VMAX`, queried against the remote D1 at **D262**), and `cards.ts` had been reading it as the **ORDINAL**
for 59 decisions — `isStage2Pokemon` since D262, `isStage1Pokemon` since D387, both cited by name in
`interpreter.ts`'s own `opponentActiveIsStage1` / `opponentActiveIsStage2` arms. The new member was
therefore **not a third reading of anything**; it was the FIRST reading reused at a second address.

🛑 **THE MEASUREMENT BESIDE IT WAS RIGHT.** *"The row is ONE printing"* is a fact about the pool and is
still true — and it was the real reason not to take the slice at D446. **A measurement and a
conclusion are two separate claims and each needs its own check.** This is the third slice in a row
where the measurement was right and the conclusion was not (D457 and D458 each mis-priced their own
blocker by reading a doc block instead of asking the code).

⚠️ **WHY THIS CLASS OF ERROR SURVIVES SO LONG: A REFUSAL IS NOT AN ASSERTION.** A `toBeNull` rung goes
red when the refusal STOPS being true; nothing anywhere goes red when the REASON stops being true, or
was never true. So the reason accumulates rot at the exact rate nobody re-reads it.

**THE RULE.** Before inheriting a refusal:
1. **grep for the thing the reason says does not exist.** D466's whole disproof was
   `grep -n "isStage1Pokemon\|isStage2Pokemon" packages/engine/src/cards.ts` — one command.
2. **Separate the reason from the price**, and record them separately at the site, so the next reader
   can see which one is load-bearing.
3. When you falsify a reason, **correct it where it lives and say which slice corrected it and how it
   was measured** (D442) — do not simply delete it. D466 kept D446's bullet as the record of a
   prediction that came true, with the false clauses marked as history.

## A `COMPOUND-*` class names the EDIT that reaches a built string, NOT a composition path (D466)

`residue-census.ts` classifies a residue row `COMPOUND-tail` when removing segment 1 leaves a segment
some reader claims. **That does NOT mean "build the head and the row leaves the residue."**

Measured at D466, with a head that ALREADY builds:

```
"This attack does 50 damage to each of your opponent's Benched Pokémon."          → spreadDamage ✅
"This attack's damage isn't affected by Weakness or Resistance."                  → suppression  ✅
both, joined by ". "                                                             → splitter: null
```

`splitAttackTrailingClause` requires the TAIL to be a **`deriveAttackEffect`** clause specifically
(it is the half the caller appends to the program), and a W/R suppression tail is a DAMAGE reader's.
So the two `COMPOUND-tail` rows in the residue (corpus file lines 539 and 616, 4 printings) need the
head **and** a composition path, and the `SUBST-2` row beside them (line 572) needs the head too.

**THE RULE: before pricing any `COMPOUND-*` row, drive `splitAttackTrailingClause` on the printed
string with a head you know builds.** It costs one probe. D466 nearly took that family as its target
on the strength of the class name and a 5-printing count.

⚠️ The general form: **a classifier class is a lower bound on the work stated in the classifier's own
vocabulary, and its vocabulary is DELETIONS AND SUBSTITUTIONS — not seams, not carriers, not
composition.** `PHRASE-2` and `OPAQUE` were equally misleading at D466 in OPPOSITE directions: the
`PHRASE-2` row's "two tokens" were a whole `CardFilter` member, and the `OPAQUE` row cost that same
member plus ONE anchor. **`OPAQUE` is UNCLASSIFIED, never EXPENSIVE.**

## A declared survivor's `reason` is a DOC FIGURE and rots like one (D466)

`D439-vocabulary-order-loses-the-owner` is a declared `equivalent` survivor whose reason reads *"the
vocabulary is 25 nouns — the **3 exact keys** of `IN_PLAY_BODY_NOUNS`, the 11 `POKEMON_TYPES` names and
the 11 `{X}` codes"*. D446 added two exact keys and did not update it; D466 added two more. The map
holds **7**, and the vocabulary is **29**.

🛑 **THE HARNESS CANNOT SEE THIS.** A `survives` declaration is checked in exactly one direction — the
run FAILS if the row is KILLED (`STALE-SURVIVOR`). A row that still survives passes with any reason at
all, including a wrong one, including one whose arithmetic contradicts the file it describes.

**THE RULE: when you edit the structure a declared survivor's reason DESCRIBES, re-derive the reason in
the same commit**, even when the row still survives. The pre-probe semantic pass is where to catch it —
needle the corpus for the STRUCTURE name (`IN_PLAY_BODY_NOUNS` returned 2 hits at D466, both inside
this row's prose), not only for the code lines you are editing.

⚠️ **AND THE PROPERTY IS RE-CHECKED KEY BY KEY, NOT BY DISTANCE.** The row sits 4 lines from a D466
hunk; the mechanical region-overlap pass flagged nothing (the `find` is outside the hunk) and would
have said "safe". What actually settles it is reading the mutation: the exact-map lookup sits AHEAD of
both permuted branches in the `find` AND in the `replace`, and neither new key carries an apostrophe,
so neither can reach `IN_PLAY_OWNER_NOUN` in either world.

## Run every repo script FROM THE REPO ROOT — a `cd` into the package breaks `tsc` and `bun` alike (D466)

`bunx tsc -b` from `packages/engine/src` fails with `TS5083: Cannot read file
'…/packages/engine/src/tsconfig.json'`, and `bun scripts/mutation/precheck.ts` from the same directory
fails with `Module not found "scripts/mutation/precheck.ts"`. **Both look like a broken config and
neither is.** Every path in this repo's tooling — `tsconfig` project references, `vitest`'s `include`
globs, `lint-coverage.ts`'s file list, every mutant row's `file` — is repo-root-relative. D466 lost two
rounds to this. Use absolute paths in `sed`/`grep`, and invoke tools from the root.

## A disjointness GUARD is only killable where the pattern that needs it runs FIRST (D467)

D467 added two anchors that narrow a shipped one by a printed noun, and they are disjoint from their
siblings for two DIFFERENT reasons:

- `BENCH_COUNTER_FILTERED_MULTIPLY` captures `([^.]+ Pokémon)` — at least one character, a SPACE, then
  the head noun — so the shipped `…on all of your Benched Pokémon.` **cannot match it at all**. That is
  STRUCTURAL disjointness and it carries no guard.
- `YOUR_BENCHED_NOUN_SCALE` captures a BARE token (`…for each of your Benched Charjabug.`), so nothing
  in its shape excludes `Pokémon`. Its only defence is a `(?!Pokémon\.)` lookahead.

**The second kind has a trap.** Place the narrowed arm at the house position — BEHIND the arm it
narrows — and deleting the lookahead changes NOTHING the reader can observe: the shipped arm claims the
sentence first, so the mutation is INERT (D450). And these regexes are **module-private `const`s**, so
no suite can assert the pattern directly either. **The guard becomes unkillable, which is D205/D208's
vacuous guard by construction** — a `(?!…)` nobody can turn red is a comment with syntax.

**THE RULE, in order of preference:**

1. **Prefer STRUCTURAL disjointness.** A string cannot end two ways; a capture that demands a space
   cannot match a noun without one. No guard, nothing to rot.
2. **Where only a guard will do, place the guarded arm FIRST** and say why in the block. The deletion
   then breaks the SHIPPED printings, and the row that proves it is killed by the suites that own the
   OLD member — not by your own suite.
3. **Then pin the order from the other side** with an ORDER-PERMUTATION mutant declared `equivalent`
   (D439's shape). The pair is the claim: *the ORDER is legibility and the GUARD is behaviour*, and the
   day the guard weakens, the survivor reports `STALE-SURVIVOR`.

⚠️ **AND SAY WHICH KIND YOU HAVE.** "Disjoint, so the order is legibility" is true of both and useful
about neither — the placement decision follows from WHICH mechanism supplies the disjointness.

## A `toBeNull` negative control is a claim with an EXPIRY DATE, and its suite may not be yours (D467)

D467 read two sentences and turned two unrelated suites red. Both pinned *"This attack does 20 more
damage for each of your Benched {L} Pokémon."* → `toBeNull` as the **"count source with no reader at
all"** witness — `scaledDamage.test.ts` (re-homed there off Entei at D196) and
`selfEnergyScaling.test.ts` (as one of three independent reasons a printing stays unread).

Neither was found by grep. Both were found by `bun run check` going red, which is the good outcome —
but the repair is not "delete the assertion":

- **Re-point it to the OTHER side and say so** (D444/D447): assert the value it derives to NOW, with a
  note naming the decision that moved it. A rung that quietly shrinks loses the transition.
- **Find the witness a NEW HOME.** A suite that says "no member answers this count" is asserting a
  property of the UNION, and the property is still worth pinning — it just needs a different sentence.
  D467's third home is corpus **file line 534** (the opponent's whole board of damage counters), chosen
  because it is ONE sentence on ONE fold, so the count source is the only ground.
- **Note in the resume point that the new witness is load-bearing**, or the next slice builds it
  without knowing it owes a fourth home.

⚠️ **AND A WITNESS WRITTEN AS *N INDEPENDENT REASONS* IS THE ONE THAT SURVIVES THIS.**
`selfEnergyScaling.test.ts` wrote its refusal as three facts and said out loud that *"any one of them
alone would keep it standing"*. D467 is the first time that construction had to pay out: reason 2 died
and the witness stands on 1 and 3.

## A doc figure can rot in TWO files at once, and fixing one copy makes it worse (D467)

D466 followed the rule above and re-derived `D439-vocabulary-order-loses-the-owner`'s `reason` from
*"25 nouns — the 3 exact keys"* to 7/29. It did **not** touch `inPlayBodyFilter`'s own doc block, which
is where that sentence was transcribed FROM and which still said 25/3. For a whole slice the mutant row
and the comment disagreed by four keys, and nothing anywhere went red.

**THE RULE: when you correct a transcribed figure, correct the SOURCE in the same commit — and prefer
to DELETE the figure and derive it.** D467 does both: the two prose copies now agree at 8/30, and
`benchNounScaling.test.ts` §5 computes the vocabulary through the READER (every exact key must resolve,
every one of the 22 type tokens must resolve, none may match `IN_PLAY_OWNER_NOUN`, and the three sizes
must sum to 30). The next key to land reddens a rung instead of quietly disagreeing with two comments.

⚠️ The same slice found the same rot in a `what` string: `D439-vocabulary-defaults-instead-of-staying-loud`
said the defaulting mutation *"steps `BUILT.attack` by 3"*, which was true until D466 built the Stage
member. Re-MEASURED to **2** by enumerating every unbuilt corpus row that reaches any `inPlayBodyFilter`
anchor. **A `what` is a doc figure too.**

## `grep -oP` with a negated class can MERGE two printed forms into one key (D467)

D467 measured the corpus slot after *"Benched "* with `grep -oP "Benched [^ .]+\."` and got ONE
sentence-final value at **89**. The truth is two: `Benched Pokémon.` at **46** and `Benched Pokémon.)`
at **43** — the negated class stops before the period, so the *"(Don't apply Weakness and Resistance for
Benched Pokémon.)"* rider's prefix matched as well and the two forms summed into one count.

The wrong figure was already written into an `effects.ts` doc block before the suite caught it.
**`grep -c` counts TEXT, not structure, and `grep -oP` with a negated class counts a PREFIX, not a
token.** When a count is going into a doc block or a refusal, enumerate it with a tokeniser over the
committed corpus and assert the WHOLE multiset — D467's §1 asserts all thirteen keys with their
multiplicities, so a new printed Bench noun reddens a rung instead of joining a total.

## Three small harness facts D467 paid for

- **A mutant row with `survives` STILL needs `expectKilledBy`.** Omitting it crashes the runner with
  `TypeError: undefined is not an object (evaluating 'files.join')`. The field is optional in `Mutant`,
  so `tsc` is silent; the row is the suites the survivor is RUN against to confirm it survives.
- **Never start a second `bun scripts/mutation/run.ts` while one is in flight.** D411's journal-liveness
  gate refuses correctly (exit 3, "its journal is not wreckage, it is that run's net"), but both
  processes write the same redirect and the transcript interleaves into nonsense.
- **`echo "X=$?"` after a PIPE reports the pipe's last stage, not the script.**
  `bun scripts/residue-census-gate.ts 2>&1 | tail` printed three §A disagreements while the transcript
  said `GATE_EXIT=0`. Redirect to a file and read the exit there.
