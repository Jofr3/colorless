# colorless

Colorless: a trading-card-game (TCG) playmat with a deck builder, a hot-seat
sandbox and online play. The web frontend is a LÖVE 11.4 application packaged
with love.js (WebAssembly) and drawn in Balatro's visual language; the rules
engine and the API are TypeScript.

## Stack

- Frontend: Lua on LÖVE 11.4 via love.js (`frontend/lua/`), hosted by
  `index.html` with a small TypeScript bridge (`src/lua/bridge.ts`) bundled by Vite 8
- Rules engine and shared schemas: TypeScript 6 (`packages/engine`, `packages/schema`)
- API: a Cloudflare Worker with Hono, D1 and Durable Objects (`apps/api`)
- Hosting: a static-assets Cloudflare Worker (`wrangler.jsonc`) serves the built frontend

## Architecture

The canvas renders every page; the page is picked by path (`/`, `/decks`,
`/decks/<id>`, `/sandbox`, `/sandbox/play`, `/online`, `/online/<code>`,
`/online/<code>/play`), and `?account` / `?settings` open the settings popup over it. `frontend/lua/web/host.js` boots love.js and moves
messages between Lua and the browser through a file mailbox. The TypeScript
adapters in `src/lua/` answer those messages: they call the API
(`src/lib/api.ts`), run local games with the engine (`src/game/`), build decks
(`src/decks/`) and hold the lobby WebSocket (`src/online/`). Lua never sees
passwords or session cookies. See `frontend/lua/README.md` for the frontend in
detail.

## Caching

| What | Where | Policy |
|---|---|---|
| `/assets/*` (Vite bundle), `/love/*` (runtime, game package) | browser | immutable for a year; `/love/` URLs carry a `?v=` content hash (`frontend/lua/build.mjs`, `vite.config.ts`), headers in `public/_headers` |
| Pages (`index.html` on every route) | browser | revalidated on each load, so a deploy shows up immediately |
| `game.data` | IndexedDB | love.js preload cache, keyed by package |
| Card artwork | IndexedDB (`ArtworkCache`), memory | 128 MB LRU of resized PNGs |
| Catalog reads (`/cards`, `/sets`, `/series`, `/facets`) | KV + browser | KV 1 h; browser 5 min fresh + 1 h stale-while-revalidate, ETag/304 |
| Card images (`/assets/cards/…` on the API) | R2 + browser | mirrored once from tcgdex; immutable |
| `/decks`, `/folders`, `/auth/me` | browser | ETag with `private, no-cache`: always revalidated, 304 when unchanged |
| CORS preflights | browser | `Access-Control-Max-Age` one day (Chromium caps at 2 h) |

`workers.dev` has no edge Cache API, so nothing is cached at Cloudflare's edge
beyond the static assets themselves.

## Scripts

```bash
bun install
bun run dev         # build the Lua app, serve it at http://127.0.0.1:5175/
bun run dev:all     # frontend (5175) + API (8787); Ctrl+C stops both
bun run dev:tailnet # both servers over Tailnet HTTPS; selects available ports
bun run build:lua   # rebuild the Lua app into public/love/ (refresh the page)
bun run build       # tsc -b, build:lua, vite build → dist/
bun run deploy      # production build + publish dist/ to colorless.jofrescari.workers.dev
bun run api:deploy  # publish the API Worker
bun run preview
bun run typecheck
bun run lint        # biome
bun run format      # biome --write
bun run test:run    # vitest (src, apps, packages)
bun run check       # check:static + check:lua + check:test (the full gate, as in CI)
bun run release     # check, remote D1 migrations, API deploy, then web deploy
```

`build:lua` needs the sibling `../balatro-source` checkout (or
`BALATRO_SOURCE`) with its installed `love.js` package. The Lua unit checks run
with plain Lua from the repository root: `lua frontend/lua/tests/<name>.lua`.
Checks that compare against Balatro's source skip themselves when it is missing
(as in CI); `bun run check` requires it.

## Deployment

| Worker | URL | Command |
|---|---|---|
| `colorless` (static assets, root `wrangler.jsonc`) | <https://colorless.jofrescari.workers.dev> | `bun run deploy` |
| `colorless-api` (`apps/api/wrangler.jsonc`) | <https://colorless-api.jofrescari.workers.dev> | `bun run api:deploy` |

`bun run deploy` builds in production mode, so the bundle and its CSP point at
`VITE_API_ORIGIN` from `.env.production`. The frontend Worker has no script; unknown
paths (such as old React URLs) fall back to the host page. The API's `APP_ORIGIN` must equal the
frontend's origin (CORS and the post-login redirect), so redeploy the API after
changing it. `workers.dev` is a public suffix, which makes the two Workers
different sites: the `SameSite=None` session cookie is a third-party cookie
there, and browsers that block those cannot sign in until both share a custom
domain.

## Google login

Create a **Web application** OAuth client in [Google Auth Platform](https://console.cloud.google.com/auth/clients).
Register `http://localhost:8787/auth/oauth/google/callback` for local development
and `https://colorless-api.jofrescari.workers.dev/auth/oauth/google/callback` for the deployed API.
Google requires the redirect URI to [match the registered URI exactly](https://developers.google.com/identity/protocols/oauth2/web-server).

For local development, copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars`,
fill in the client ID and secret, and run `bun run dev:all`.
Open the app at `http://localhost:5175`. Local CORS also accepts `http://127.0.0.1:5175`;
`APP_ORIGIN` determines where the API sends you after Google login.
If the Google consent screen is in testing mode, add your sign-in account as a test user.

For the deployed API, run these from `apps/api/`:

```sh
bunx wrangler secret put GOOGLE_CLIENT_ID
bunx wrangler secret put GOOGLE_CLIENT_SECRET
```

The deployed API's `APP_ORIGIN` (`apps/api/wrangler.jsonc`) is the deployed
frontend's exact origin, `https://colorless.jofrescari.workers.dev`; the frontend's
production build reads `VITE_API_ORIGIN` from `.env.production`.
Google sign-in reports unavailable until both credentials are configured.

The API dev command supplies the system CA bundle to Wrangler/workerd through
`NODE_EXTRA_CA_CERTS`, including on NixOS. An existing `NODE_EXTRA_CA_CERTS`
setting takes precedence. TLS certificate verification remains enabled.
It also applies pending migrations to the local D1 database before starting,
so account and session tables are ready on a fresh checkout. This applies to
`api:dev`, `dev:all`, and `dev:tailnet`; the remote database is not migrated.

### Tailnet development

With Tailscale connected, run `bun run dev:tailnet` and open the printed frontend
URL on a device in your Tailnet. The command selects free local server and HTTPS
ports, configures the API URL and CORS, and starts temporary Tailscale Serve
proxies. Ctrl+C stops its servers and proxies without changing existing Serve routes.

For Google login, add the exact callback URI printed by the command to your
Google OAuth client. To keep the public URLs stable across runs, set
`TAILNET_WEB_PORT` and `TAILNET_API_PORT` to available ports; explicitly chosen
ports fail if occupied. Google credentials still come from `apps/api/.dev.vars`.

## Project structure

```text
index.html               # love.js host page (canvas, loading bar, accessible links)
frontend/lua/            # the LÖVE app: main.lua, ui/, web/ (host.js, host.css), tests/
src/
  lua/                   # adapters between the Lua app and the browser; bridge.ts wires them
  game/                  # local game host, board projection, game log, sandbox decks
  decks/                 # card catalog, deck math, decklist text, deck saving
  online/                # lobby WebSocket client and channel
  lib/                   # API client, API origin, OAuth start, persisted state
  test/                  # fixtures and fakes shared by the tests
packages/engine          # the rules engine (shared with the API)
packages/schema          # wire schemas (shared with the API)
apps/api                 # Cloudflare Worker API
```
