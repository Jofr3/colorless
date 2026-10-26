You are continuing autonomous work on **colorless**. This is a FRESH session —
nothing from the previous one is in your context. `docs/` is the handoff.

## Boot (do exactly this, nothing more)

1. Read `docs/README.md` and `docs/roadmap.md` in full — both are small.
2. Read `docs/status.md` in full. Its "Current state" is the resume point. If it
   references a decision (`D86`, etc.), find it in `docs/decision-index.md` and
   read that one entry — never read `docs/archive/` whole.
3. Read the "Code & quality" section of `docs/conventions.md`, then the **one**
   `docs/workstreams/*.md` the resume point names. No other workstream.

## The job

Pick **one** slice from the resume point — the smallest coherent unit that
leaves the repo better and green. Prefer the item the resume point names first
unless the code tells you otherwise; if you deviate, say why in `status.md`.

Then, per `docs/conventions.md`:

- Delegate research / code-mapping / self-contained implementation to sub-agents
  (`Explore`, `general-purpose`). Keep this session's context lean — that is what
  lets the slice finish in one session.
- `bun run check` must be green before you call the slice done.
- Do the **end-of-session ritual**: update `docs/status.md` (current state and
  the next concrete step), log any decision as a dated entry in
  `docs/decisions.md` and run `bun run docs:index`, and write what you learned
  into the right workstream doc.
- Commit the work. One commit for the slice, message in the style of `git log`.

## Landing the session

You may get a `[autoloop]` context notice mid-flight. Treat it as binding:

- **soft** — stop starting new work. Finish or park what is open, run the
  ritual, commit, end the turn.
- **hard** — stop now. Whatever state the code is in, make it compile, write an
  honest `status.md` entry saying exactly where you stopped and what is
  half-done, commit, end the turn.

Never `/compact` and continue. A fresh session with a good resume point beats a
compacted one — that is the whole point of this loop.

If the resume point needs a decision only the user can make (a deploy, a
credential, a product call), do not guess and do not burn the iteration: write
that into `status.md` as the resume point, commit, then write one line saying
what you need into `tmp/autoloop-stop` (gitignored — a signal, not a commit) and
stop. The loop halts and shows the user that line.
