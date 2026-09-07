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

### A refusal re-proposed three times is one `expect` away from self-checking

The Ancient/Future family had been re-derived from source and refused at least three
times, each time costing a full investigation, because the refusal lived only in
prose — a doc block, a conventions entry, a decisions row. Prose does not fail.

D468 wrote it as a test instead: a section that pins the schema key set read **off
`cardSchema.shape`**, plus the blocked population and the claim that no reader,
splitter or registry row takes any of it. **The rung goes red the day ingest lands
the column, and names it.** When a refusal survives its third re-litigation, stop
writing the paragraph better and spend the same effort on the assertion.

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
it in roughly a hundred.**

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
`CardFilter` kind, `preventDamage.fromClass` (a one-member union), an op FIELD in the
`moveCountersToDefender.ownerPokemon` shape, and a SUPPORTER-CARD predicate for *"If you played an
Ancient Supporter card…"*, which is not about a Pokémon at all. **Price the CARRIERS, not the
token.**

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
