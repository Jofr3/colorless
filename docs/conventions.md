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
