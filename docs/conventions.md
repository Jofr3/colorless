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
- ⚠️ **A SURVIVOR IS THE INTERESTING OUTPUT, and a legitimate one is declared.**
  Add `survives: {kind, reason}` for the correct-and-unreachable cases this repo
  keeps finding — `equivalent` (D196's declaration snapshot),
  `unreachable-population` (D202's leading `^`: every near-miss the catalog
  prints carries its clause at the start), `unreachable-shape` (D205's
  never-spelled `count: 1`). It is **the opposite of an allowlist**: a declared
  survivor that gets **KILLED** reports `STALE-SURVIVOR` and fails the run,
  because the recorded reason has stopped being true.
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

## End-of-session ritual (do not skip)
1. Update `progress.md`: status table + session-log entry + **new resume point**.
2. Record any decision in `decisions.md`.
3. Write anything learned into the right workstream/reference doc so the next
   session doesn't rediscover it.
