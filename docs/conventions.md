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

**Before measuring anything the repo already measures, grep the test suite for the
figure.** If you need the list rather than the count, copy the predicate verbatim
rather than reconstructing it from its description.

## A mechanism that launders the census (attack-copy refusal)

The attack-copy family (7 sentences / 14 printings) is refused, and the reason
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

## Unbounded queues (attack-copy refusal)

`runProgram` is `while (queue.length > 0)` with **no step limit**, and gates splice
with `queue.unshift(...)`. Any op whose candidate set can include an instance of
itself is an unbounded loop inside a Durable Object request — not a failing test, a
hang. **Before adding an op that can name another op's source, ask whether the
source set can contain the op itself, and what bounds it.**

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
