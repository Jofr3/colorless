# luminous_ui — Project Docs & Continuation System

This `docs/` tree is the **durable memory of the project**. It exists so any new
Claude Code session (or human) can resume work **without reloading the whole
codebase into context**. Read this file first, then load only the docs relevant
to your task.

> **These docs are a guide, not a rulebook.** They capture the current best plan
> and the *reasoning* behind it — not a fixed process to execute blindly. If,
> while working, the code or new context reveals a better or simpler approach,
> **propose it**: say what you'd change and why, and (once it's the direction)
> update the affected doc + record the shift in `decisions.md`. The plans exist
> to be improved, not obeyed. What must be preserved is the *rationale* and the
> *update trail*, so the next session understands why things are the way they are.

## New session? Resume protocol

1. Read **`progress.md`** — the single source of truth for *what's done, what's
   in flight, and where to pick up* (the **Resume point**).
2. Read **`conventions.md`** — it now carries the **operating rules** distilled
   from the decision log, not just the doc ritual: what makes a guard vacuous,
   how to count the catalog, how to price a slice, and how to work in a checkout
   two other agents are editing. Each rule cites its D-number, so the full
   account is one grep of `decisions.md` away.
3. Skim **`roadmap.md`** for the big picture (the five phases).
4. Open only the **`workstreams/<area>.md`** you're working on, plus any
   **`reference/`** file it points to. Do **not** read the other workstreams.

## File map

| File | What it's for |
|---|---|
| `progress.md` | Living status + session log + the current **resume point**. Update every session. |
| `roadmap.md` | The phased plan (P1→P5) and dependencies. |
| `decisions.md` | Decision log (why we chose what) + locked assumptions. |
| `conventions.md` | How we work: sub-agents, doc ritual, code/test/commit rules, **and the transferable lessons** (vacuous guards, census scoping, pricing, concurrency, mutation discipline). |
| `workstreams/backend-data.md` | **P1** — Bun+Hono API, tcgdex→D1 ingest, R2 images, auth, deck API, lobby DO. Contains the tcgdex API reference. |
| `workstreams/deck-builder.md` | **P2** — real cards in the builder, richer filters, editor + decks list. |
| `workstreams/simulator.md` | **P3** — the rules-driven game engine. |
| `workstreams/online.md` | **P4** — run the simulator over the lobby DO for real matches. |
| `workstreams/polish.md` | **P5** — profiles, avatars, lobby names, misc refinement. |
| `reference/ptcg-rules.md` | Condensed Pokémon TCG ruleset — the spec for the simulator (P3). |

## The one rule that keeps this working

**Keep context small.** Delegate research, code-mapping, and multi-file edits to
sub-agents (see `conventions.md`), load only the workstream you need, and write
what you learned back into these docs **before the session ends**.
