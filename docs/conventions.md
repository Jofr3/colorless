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
about the family's biggest row. (The case-sensitivity half is the same lesson at one
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
