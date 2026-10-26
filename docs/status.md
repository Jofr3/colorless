# Status — start here

A Pokémon TCG deck builder and simulator: build decks from the real catalog, play them locally in
a sandbox, or play them online against another account. Updated 2026-10-26.

## Where things are

| Path | What |
|---|---|
| `packages/engine` | The rules engine: a pure, seeded state machine. Runs in the browser (local play) and in the LobbyDO (online). |
| `packages/schema` | Zod schemas for everything on the wire: cards, decks, the redacted game, the lobby. |
| `apps/api` | Hono Worker (`colorless-api`) on D1 and R2: catalog, auth, decks, and the `LobbyDO` that runs online matches. |
| `src/` | The TypeScript bridge between the browser, the engine and the Lua UI (`src/lua`, `src/game`, `src/decks`, `src/online`, `src/lib`). |
| `frontend/lua` | The UI, a LÖVE app run by love.js; `frontend/lua/README.md` covers its structure and the mailbox protocol. |
| `scripts/` | Dev tooling: catalog ingest, generators with `--check` gates, the mutation corpus (`scripts/mutation`). |

## Working on it

- `bun run check` is the gate, and CI runs the same steps. It needs `BALATRO_SOURCE` pointing at a Balatro source checkout for the Lua tests and build.
- `bun run dev:all` starts the web app and the API. The local D1 catalog setup is in `workstreams/backend-data.md`.
- `bun run release` checks, migrates the remote D1, deploys the API, then the web app. First diff local and remote `print_key` as `conventions.md` describes, because the reprint alias table is generated from the local catalog.
- After adding a `decisions.md` entry, run `bun run docs:index`.

## Current state

- **Deployed:** everything on `main` up to the Phase 3 architecture work (2026-10-26). Phase 4 (frontend structure) is merged and web-only; it deploys with the next `bun run release`.
- **Card coverage:** the coverage program finished in October. `simulationGaps` lists text the engine still can't run, and the builder shows it on the card.
- **Architecture audit:** Phases 0–4 are done (`decisions.md`, 2026-10-24 to 2026-10-26). Left out on purpose: H5 (explicit card-pool cache) and the host art-loader slice.
- **Deferred:** card readings left for a rulings review are the `R-…` entries in `decisions.md` and the "Ruling notes" in `reference/card-revision.md`.

## Docs

| File | What it's for |
|---|---|
| `conventions.md` | How to work here: code and test rules, the mutation corpus, generators, releases, and lessons from earlier slices. Read "Code & quality" before changing code. |
| `decisions.md` | Why things are the way they are. New decisions are dated `###` entries at the end. |
| `decision-index.md` | Generated: where each numbered decision (D1–D647) and each dated entry is written up. Look decisions up here rather than reading the archive. |
| `workstreams/*.md` | Per-area design notes: backend and data, deck builder, simulator, online, polish. |
| `reference/` | The condensed rules (`ptcg-rules.md`) and coverage backlogs. |
| `archive/` | The old session log (`progress.md`) and simulator build history, kept verbatim. Look things up there through the index; don't read them whole. |
