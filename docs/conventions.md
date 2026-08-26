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
- TypeScript strict; match the surrounding code's style and comment density.
- **Biome** for lint/format; **Vitest** for tests. Run **`bun run check`**
  (tsc + **lint coverage** + biome lint + vitest) before calling work done.
  ⚠️ `check` **lints but never checks FORMATTING** — see "The format gap" below.
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
  side is absent**. Same for `Ancient` / `Future` (D205, D204).

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

### The format gap (still open — D197, re-measured at D212)
**`bun run check` lints; it never checks formatting.** With `--max-diagnostics`
raised past Biome's default cap of 20, **122 committed files are format-dirty**
(79 `packages/engine`, 15 `packages/schema`, 15 `src/features`, 13 `apps/api`) —
D197's "10 files" was the capped view of `apps/api` alone. So `bun run format
--write` produces a 122-file diff that has nothing to do with your slice.
**Do not sweep it inside another change.** Closing it properly means one
formatting-only commit plus a `biome format --check` step in `check`; until then,
never run `bun run format` on a shared tree.

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
