# Status — start here

A Pokémon TCG deck builder and simulator: build decks from the real catalog, play them locally in
a sandbox, or play them online against another account. Updated 2026-11-12.

## Where things are

| Path | What |
|---|---|
| `packages/engine` | The rules engine: a pure, seeded state machine. Runs in the browser (local play) and in the LobbyDO (online). |
| `packages/schema` | Zod schemas for everything on the wire: cards, decks, the redacted game, the lobby. |
| `apps/api` | Hono Worker (`colorless-api`) on D1 and R2: catalog, auth, decks, and the `LobbyDO` that runs online matches. |
| `src/` | The TypeScript bridge between the browser, the engine and the Lua UI (`src/host`, `src/lua`, `src/game`, `src/decks`, `src/online`, `src/lib`, and `src/seam`, the client-to-API and client-to-lobby tests). |
| `frontend/lua` | The UI, a LÖVE app run by love.js; `frontend/lua/README.md` covers its structure and the mailbox protocol. |
| `scripts/` | Dev tooling: generators with `--check` gates, the guards in `check:static`, the e2e smoke, the mutation corpus (`scripts/mutation`). The catalog ingest is `apps/api/scripts/ingest.ts`. |

## Working on it

- First run and prerequisites: the root `README.md`, "Getting started". The docs map, the resume protocol and where each common task's recipe lives: `docs/README.md`.
- `bun run check` is the gate, and CI runs the same steps. It needs Balatro's source for the Lua tests and build: `BALATRO_SOURCE`, else `balatro-source` beside the main checkout, which a git worktree finds too.
- A worktree needs only `bun install`; run tools through `bun run`/`bunx`, not bare names (a bare `vitest` or `wrangler` can run the main checkout's copy). Its D1 checks read the main checkout's local catalog, read-only, until it has its own. For a catalog `api:dev` can serve in a worktree, copy it: `mkdir -p apps/api/.wrangler && cp -r <main>/apps/api/.wrangler/state apps/api/.wrangler/` (a copy, so no database is shared).
- `bun run dev:all` starts the web app and the API. The local D1 catalog is loaded by the ingest in `workstreams/backend-data.md` §3.4.1.
- `bun run release` checks, migrates the remote D1, deploys the API, then the web app, checks both, and tags the release `release-YYYYMMDD-HHMM`. `release:gate` refuses when local and remote `print_key` differ, because the reprint alias table is generated from the local catalog: re-ingest locally and rerun `bun scripts/registry-aliases.ts`.
- After adding a `decisions.md` entry, run `bun run docs:index`.

## Current state

- **Deployed:** what is live is the newest `release-*` tag (`git describe --tags --abbrev=0 --match 'release-*'`); not yet live: `git log --oneline <tag>..origin/main`. `GET /health` (`version.tag`, the API) and the page's `<meta name="build">` (the web app) confirm it (`workstreams/backend-data.md` §3.7.2).
- **Finished and released:** the card-coverage program (October), and the audits of 2026-10-24 to 2026-11-10 (architecture, performance, database, security, reliability, UI, API, dependencies, build and CI, observability). Each has dated entries in `decisions.md`; `decision-index.md` lists them.

## Open items

Each names where it is written up (`decisions.md` entries by date and title).

- **Remote catalog ingest owed:** the local D1 has the 2026-11-12 ingest (`me06` and tcgdex fixes) and the remote does not, so `release:gate` refuses the next release until `bun scripts/with-deploy-token.ts bun scripts/ingest.ts --remote` runs (2026-11-12 "Catalog re-ingest 2026-11-12: Delta Reign (me06) and tcgdex data fixes").
- **`me06` cards waiting on tcgdex data:** every `me06` card simulates (engine 0.556.0) except 14 print groups (26 printings) whose text is missing or garbled: twelve text-less Trainers, Mega Rayquaza Cap and Azurill. The set's Stage 1 / Stage 2 rows also lack `evolve_from`, and six Evolution-line ex are typed Basic. `me06` is Expanded-only, so Standard is unaffected (`reference/card-revision.md` "Deferred" items 12 and 13; 2026-11-12 "Delta Reign (me06) card programs (ME06-REG, ME06-B1..B5)").
- **2026-12-01, Cloudflare's Workers Logs pricing change:** recheck the free Workers Logs allowance, and whether Workers Issues stays free (2026-11-09 "Backend and API audit safety nets, and what production says"; 2026-11-10 "Observability audit Phase 1"; 2026-11-11 "No email alert for a new Workers issue").
- **Latency SLO:** revisit after a month of `prod:report` runs (2026-11-10 "Observability audit Phase 3", "For the user"; "Observability audit released").
- **The old `agents` Cloudflare token:** revoke or narrow it when the user says so (2026-11-10 "The web Worker's 404 script, a web rollback rehearsal, …", "Still open").
- **API Worker rollback:** never rehearsed; the web rollback was (same entry; `workstreams/backend-data.md` §3.7.3).
- **Google OAuth callback:** confirm the deployed API's callback is registered on the Google client (the root `README.md`, "Google login"; the API was renamed in 2026-10-22 "The Lua frontend replaces React").
- **Deferred dependency majors:** Node 24 in Q1 2027 (`conventions.md` "Dependencies", Toolchain); drizzle stays on 0.x (2026-11-09 "Dependency refresh: wrangler 4.158 …", user decision 13). `bun run deps:check` reports the rest.
- **Uploaded avatars:** avatars are generated from the account (D82); uploads are still open (`archive/workstreams/polish.md`).
- **UI items not done:** the builder Retry's hit area (needs a 1 px button move), multi-set search (needs an API change), and the manual checks the user left out: NVDA, real devices, a saved credential (2026-11-09 "Frontend & UI audit follow-ups").

## Known limitations

- **Cards:** `simulationGaps` marks card text the engine does not run (none in Standard), and the builder shows it on the card. Data and design gaps are in `reference/card-revision.md` "Deferred"; readings left for a rulings review are the `R-…` entries in `archive/decisions-numbered.md` (look them up through `decision-index.md`) and card-revision.md's "Ruling notes".
- **Local play** does not enforce deck legality (online does), and a saved local game is dropped on any engine version change (2026-10-26 "Engine↔client contract").
- **No spectating** in the Lua client: a full lobby says so (`frontend/lua/README.md`, Online).
- **No email:** password reset and email verification answer 501 until an email provider is chosen (`workstreams/backend-data.md` §3.5).
- **One site:** both Workers are on `workers.dev`; a custom domain must keep the app and the API on one site, or sign-in breaks (root `README.md`, "Deployment").
- **Production only**, no staging environment (2026-11-10 "Production only, no staging environment").
- **Workers Free plan:** daily account-wide limits, and an accepted availability risk from request floods (`workstreams/backend-data.md` §3.7.4).
- **Browser:** the app needs WebGL and WebAssembly (`frontend/lua/web/host.js`). Nothing is reported off the device when the client fails (2026-11-10 "Observability audit: the log guard …", 5a).
- **Building** the frontend needs Balatro's source tree (root `README.md`, "Getting started").
