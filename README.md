# colorless

Colorless: a trading-card-game (TCG) playmat with a deck builder, a hot-seat
sandbox and online play. The web frontend is a LÖVE 11.4 application packaged
with love.js (WebAssembly) and drawn in Balatro's visual language; the rules
engine and the API are TypeScript.

## Stack

- Frontend: Lua on LÖVE 11.4 via love.js (`frontend/lua/`), hosted by
  `index.html` with a small TypeScript bridge (`src/lua/bridge.ts`) bundled by Vite 8
- Rules engine and shared schemas: TypeScript 7 (`packages/engine`, `packages/schema`)
- API: a Cloudflare Worker with Hono, D1 and Durable Objects (`apps/api`)
- Hosting: a static-assets Cloudflare Worker (`wrangler.jsonc`) serves the built frontend

## Getting started

Prerequisites:

- bun at the version in `.bun-version`, and Node 22 (`.node-version`): the build
  and test tools run under Node.
- Balatro's source tree at `../balatro-source`, or wherever `BALATRO_SOURCE`
  points. It holds the game's own files (the Lua build copies shaders, textures,
  the font, sounds and music from its `resources/`, and some checks compare
  against its Lua source) and love.js installed in it with
  `npm install love.js@11.4.1`. `scripts/love-inputs.ts` checks that copy by hash.
- Lua 5.1, only for `check:lua` (where nix is installed, the Lua test runner
  builds it). Optional: Chromium or Firefox for `bun run e2e`, Tailscale for
  `dev:tailnet`.

Without the Balatro tree, `typecheck`, `lint`, `test:run`, `check:static` and
`api:dev` work, and the checks that compare against Balatro skip themselves.
`dev`, `build`, `check`, `check:lua`, `e2e`, `deploy` and `release` need it.

First run:

```bash
bun install
git config core.hooksPath .githooks              # once per clone: the opt-in pre-push hook (docs/conventions.md)
cp apps/api/.dev.vars.example apps/api/.dev.vars # optional: only for Google sign-in or a local pepper
bun run dev:all                                  # web on :5175, API on :8787
```

Without `PASSWORD_PEPPER`, the local API logs a `pepper_missing` error when someone
registers or signs in. That is expected locally.

`api:dev` migrates the local D1, but the card catalog starts empty: load it with
the ingest in `docs/workstreams/backend-data.md` §3.4.1 (needs network access to
tcgdex). Then open <http://localhost:5175>, register, build or import a 60-card
deck with a Basic Pokémon, and open Sandbox.

The project docs start at `docs/README.md` (the doc map and the resume
protocol); the current state is `docs/status.md`.

## Architecture

The canvas renders every page; the page is picked by path (`/`, `/decks`,
`/decks/<id>`, `/sandbox`, `/sandbox/play`, `/online`, `/online/<code>`,
`/online/<code>/play`, routed by `src/host/router.ts`), and `?account` /
`?settings` open the settings popup over it. `frontend/lua/web/host.js` boots
love.js. Messages go both ways: the page writes mailbox files that Lua polls
(names in `src/host/mailboxes.ts`), and Lua prints `COLORLESS:<channel>:…`
lines to stdout, which `src/host/shell.ts` hands to the TypeScript adapters in
`src/lua/`. The adapters call the API (`src/lib/api.ts`), run local games with
the engine (`src/game/` over `packages/engine`), build decks (`src/decks/`) and
hold the lobby WebSocket (`src/online/`). Lua never sees passwords or session
cookies. See `frontend/lua/README.md` for the frontend in detail.

The API (`apps/api`) is a Hono Worker on D1 (accounts, decks, the card
catalog), with a KV cache of catalog reads, an R2 mirror of card images and a
daily cron that sweeps expired sessions and sign-in counters. Each online lobby is a `LobbyDO`
Durable Object that runs the same engine and sends each seat its redacted view
of the game. The catalog is loaded into D1 by a local script
(`apps/api/scripts/ingest.ts`) that reads tcgdex; nothing in Cloudflare fetches
it.

## Scripts

```bash
bun run dev         # build the Lua app, serve it on :5175 (127.0.0.1 or localhost), rebuild on Lua edits
bun run dev:all     # frontend (5175) + API (8787); Ctrl+C stops both
bun run dev:tailnet # both servers over Tailnet HTTPS; selects available ports
bun run dev:local   # both servers on free 127.0.0.1 ports, no Tailscale; prints both URLs
bun run build:lua   # rebuild the Lua app into public/love/ (an open dev page reloads)
bun run build       # tsc -b, build:lua, vite build → dist/
bun run deploy      # web Worker only: production build + publish dist/ (partial; see Deployment)
bun run api:deploy  # API Worker only (partial; see Deployment)
bun run typecheck
bun run lint        # biome ci: formatting and lint, warnings fail, as in check:static
bun run format      # biome --write over the whole tree; for your files only: bunx biome format --write <paths>
bun run test:run    # vitest (src, apps, packages)
bun run check       # check:static + check:lua + check:test (the full gate, as in CI)
bun run release     # the normal deploy: check, gates, remote D1 migrations, API, web, tag
bun run e2e         # browser smoke of the real page against a local API (opt-in; run before a release)
bun run deps:check  # the monthly dependency report (needs the network, never fails)
```

Other scripts: `package.json`; operations: `docs/workstreams/backend-data.md` §3.7.

In Claude Code, each file an Edit or Write touches is formatted with Biome by the
hook in `.claude/settings.json` (`scripts/format-hook.ts`).

The toolchain upgrade routine is in `docs/conventions.md` ("Dependencies").

`dev` (and so `dev:all`, `dev:tailnet` and `dev:local`) runs Vite under
`frontend/lua/watch.mjs`, which reruns `build:lua` 200 ms after the last change
to `frontend/lua/{main.lua,conf.lua,ui,assets,web}`. The page reloads by itself
once "Colorless Lua frontend built" prints. A failed rebuild is reported and the
watch goes on. Edits under `tests/` and `tools/` are not packed and rebuild
nothing.

One Lua test file runs under Lua 5.1 with `bun run test:lua <name>.lua` (a path
works too; see `frontend/lua/README.md`).

The API dev command supplies the system CA bundle to Wrangler/workerd through
`NODE_EXTRA_CA_CERTS`, including on NixOS. An existing `NODE_EXTRA_CA_CERTS`
setting takes precedence. TLS certificate verification remains enabled.
It also applies pending migrations to the local D1 database before starting,
so account and session tables are ready on a fresh checkout. This applies to
`api:dev`, `dev:all`, and `dev:tailnet`; the remote database is not migrated.

## Deployment

`bun run release` is how production is deployed. It runs `check` and the
release gates, migrates the remote D1, deploys the API, then the web app,
checks that both answer with the new commit, and tags the release
`release-YYYYMMDD-HHMM`. What to do before and after it, and how to recover
from a failed step, is in `docs/workstreams/backend-data.md` §3.7.1, "Releasing".
`bun run deploy` (web only) and `bun run api:deploy` (API only) are partial
deploys: they skip the full gate, take no D1 bookmark and leave no release tag.

**Cloudflare access.** The ambient `CLOUDFLARE_API_TOKEN` is read-only: it serves
every listing, read and release gate. Production writes load the deploy token from
`~/.local/state/secrets/CLOUDFLARE_DEPLOY_TOKEN` (or the file
`CLOUDFLARE_DEPLOY_TOKEN_FILE` names): `deploy`, `api:deploy` and `release` do it
themselves, and any other write goes through
`bun scripts/with-deploy-token.ts <command>` from `apps/api/`. Details in
`docs/workstreams/backend-data.md` §3.7.2, "Cloudflare tokens".

| Worker | URL | Partial deploy |
|---|---|---|
| `colorless` (static assets, root `wrangler.jsonc`) | <https://colorless.jofrescari.workers.dev> | `bun run deploy` |
| `colorless-api` (`apps/api/wrangler.jsonc`) | <https://colorless-api.jofrescari.workers.dev> | `bun run api:deploy` |

The web build runs in production mode, so the bundle and its CSP point at
`VITE_API_ORIGIN` from `.env.production`. The frontend Worker's only script
(`src/notFoundWorker.ts`) answers a missing `/assets/` or `/love/` file with an
uncached 404; other unknown paths (such as old React URLs) get the host page. The API's `APP_ORIGIN` must equal the
frontend's origin (CORS and the post-login redirect), so redeploy the API after
changing it. The public suffix is `workers.dev` itself, so both Workers are on the
same site (`jofrescari.workers.dev`): the `SameSite=Lax` session cookie is first-party
for the app's requests. Moving to a custom domain must keep the two on one site,
or sign-in breaks.

### API secrets

`bun run release` refuses to release until the Worker holds four secrets
(`release:gate` step `secrets`, which only lists secret names): the Google
client's `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (see Google login below),
and these two. A missing Google secret only answers 503 to someone who tries
Google sign-in, so the gate is what notices it.

| Secret | What it does | If it is lost |
|---|---|---|
| `PASSWORD_PEPPER` | HMAC key applied to every password before PBKDF2, so a D1 export alone cannot be cracked offline | every account whose hash it peppered cannot sign in with its password (Google sign-in still works) until it is restored |
| `LOG_TAG_KEY` | key of the pseudonymous account and network tags in auth log lines | older log lines no longer match new ones; nothing else |

Set them **before** the first release that needs them, and keep a copy of each in
the password manager first: Cloudflare never shows a secret again. From `apps/api/`:

```sh
openssl rand -base64 32   # once per secret; save it in the password manager
bun scripts/with-deploy-token.ts bunx wrangler secret put PASSWORD_PEPPER
bun scripts/with-deploy-token.ts bunx wrangler secret put LOG_TAG_KEY
cd ../.. && bun run release
```

A secret put applies at once to the deployed Worker. Run it from `apps/api/`:
from the repository root it would target the web Worker instead. Existing password
hashes keep working and are re-peppered at each account's next sign-in, so nobody
is logged out. To rotate the pepper, set the old value as `PASSWORD_PEPPER_PREVIOUS`
and the new one as `PASSWORD_PEPPER`; delete the previous one only once the accounts
that matter have signed in again (backend-data.md §3.5).

## Google login

Create a **Web application** OAuth client in [Google Auth Platform](https://console.cloud.google.com/auth/clients).
Register `http://localhost:8787/auth/oauth/google/callback` for local development
and `https://colorless-api.jofrescari.workers.dev/auth/oauth/google/callback` for the deployed API.
Google requires the redirect URI to [match the registered URI exactly](https://developers.google.com/identity/protocols/oauth2/web-server).

For local development, copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars`,
fill in the client ID and secret, and run `bun run dev:all`.
Open the app at `http://localhost:5175` for Google sign-in: the registered callback is on
`localhost`, and `APP_ORIGIN` sends you back to `localhost:5175` after it. Everything else
also works from `http://127.0.0.1:5175`, the URL Vite prints, since a dev page calls the API on
its own loopback name.
If the Google consent screen is in testing mode, add your sign-in account as a test user.

For the deployed API, run these from `apps/api/`:

```sh
bun scripts/with-deploy-token.ts bunx wrangler secret put GOOGLE_CLIENT_ID
bun scripts/with-deploy-token.ts bunx wrangler secret put GOOGLE_CLIENT_SECRET
```

The deployed API's `APP_ORIGIN` (`apps/api/wrangler.jsonc`) is the deployed
frontend's exact origin, `https://colorless.jofrescari.workers.dev`; the frontend's
production build reads `VITE_API_ORIGIN` from `.env.production`.
Google sign-in reports unavailable until both credentials are configured.

### Tailnet development

With Tailscale connected, run `bun run dev:tailnet` and open the printed frontend
URL on a device in your Tailnet. The command selects free local server and HTTPS
ports, configures the API URL and CORS, and starts temporary Tailscale Serve
proxies. Ctrl+C stops its servers and proxies without changing existing Serve routes.

For Google login, add the exact callback URI printed by the command to your
Google OAuth client. To keep the public URLs stable across runs, set
`TAILNET_WEB_PORT` and `TAILNET_API_PORT` to available ports; explicitly chosen
ports fail if occupied. Google credentials still come from `apps/api/.dev.vars`.

## Caching

| What | Where | Policy |
|---|---|---|
| `/assets/*` (Vite bundle), `/love/*` (runtime, game package) | browser | immutable for a year; `/love/` URLs carry a `?v=` content hash (`frontend/lua/build.mjs`, `vite.config.ts`), headers in `public/_headers` |
| Pages (`index.html` on every route) | browser | revalidated on each load, so a deploy shows up immediately |
| `game.data` | IndexedDB | love.js preload cache, reused while game.data's bytes are unchanged (its uuid is their sha256, `frontend/lua/packageUuid.mjs`) |
| Card artwork | IndexedDB (`ArtworkCache`), memory | 128 MB LRU of resized PNGs |
| Catalog reads (`/cards`, `/sets`, `/series`, `/facets`) | KV + browser | KV 1 day (of `/cards`, pages 1-3 only), retired by the catalog epoch on ingest; free-text searches skip KV; browser 5 min fresh + 1 h stale-while-revalidate, ETag/304 |
| Card images (`/assets/cards/…` on the API) | R2 + browser | mirrored once from tcgdex; immutable |
| `/decks`, `/auth/me` | browser | ETag with `private, no-cache`: always revalidated, 304 when unchanged |
| CORS preflights | browser | `Access-Control-Max-Age` one day (Chromium caps at 2 h) |

`workers.dev` has no edge Cache API, so nothing is cached at Cloudflare's edge
beyond the static assets themselves.

## Project structure

```text
index.html               # love.js host page (canvas, loading bar, accessible links)
frontend/lua/            # the LÖVE app: main.lua, ui/, web/ (host.js, host.css), tests/
src/
  host/                  # page routes, the shell around the canvas, text proxies, mailboxes
  lua/                   # adapters between the Lua app and the browser; bridge.ts wires them
  game/                  # local game host, board projection, game log, sandbox decks
  decks/                 # card catalog, deck math, decklist text, deck saving
  online/                # lobby WebSocket client and channel
  lib/                   # API client, API origin, OAuth start, persisted state
  seam/                  # tests joining the web client to the real API and lobby
  test/                  # fixtures and fakes shared by the tests
  notFoundWorker.ts      # the web Worker's script: a 404 for a missing build file
packages/engine          # the rules engine (shared with the API)
packages/schema          # wire schemas (shared with the API)
apps/api                 # Cloudflare Worker API
```

## Licence and credits

Colorless's own code and original assets are under the MIT licence in `LICENSE`. It does
not cover the Balatro assets the Lua build copies from a separate source tree (Balatro is
by LocalThunk, published by Playstack), the m6x11plus font (Daniel Linssen), LÖVE and
love.js, TCGdex card data and images, or the Pokémon trademarks; those remain their
owners'. The build writes their notices to `dist/love/THIRD-PARTY-NOTICES.txt`
(`scripts/third-party-notices.ts`), which the site's Credits link and Settings' Credits
button open. Colorless is an unofficial fan project, not affiliated with or endorsed by
Nintendo, Creatures Inc., GAME FREAK inc., The Pokémon Company, LocalThunk or Playstack.
