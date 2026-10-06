# luminous_ui_v2

A React 19 + Vite + Tailwind 4 trading-card-game (TCG) playmat prototype with
Balatro-style card physics: spring motion, perspective-mesh tilt, directional
hover lift, press/juice pops, and pointer drag-and-drop between zones.

## Stack

- React 19 + TypeScript 6
- Vite 8 (Rolldown) + Tailwind CSS 4 (`@tailwindcss/vite`)
- PixiJS 8 for the animated card layer
- GSAP 3 (+ PixiPlugin) for tween-driven juice

## Architecture

The DOM renders the static board (slots, piles, HUD, hand) and doubles as the
layout engine: every card/slot exposes `data-card-anchor` / `data-card-drop-zone`
attributes and CSS-variable-driven sizing. A single PixiJS canvas overlay
(`AnimatedCardsLayer`) measures those anchors and renders the *visible*,
animated cards on top — the DOM card faces are `visibility: hidden`. One Pixi
`Application`, one ticker, and one `CardView` per card drive all motion.

Board state is a plain reducer (`utils/cardMovement.ts`): a drag emits a
`CardMoveRequest` that `moveCardOnBoard` validates via `canPlace` and applies.

## Scripts

```bash
bun install
bun run dev        # vite dev server (127.0.0.1:5175)
bun run dev:all    # frontend (5175) + API (8787); Ctrl+C stops both
bun run dev:tailnet # both servers over Tailnet HTTPS; selects available ports
bun run build      # tsc -b && vite build
bun run preview
bun run typecheck
bun run lint       # biome
bun run format     # biome --write
```

## Google login

Create a **Web application** OAuth client in [Google Auth Platform](https://console.cloud.google.com/auth/clients).
Register `http://localhost:8787/auth/oauth/google/callback` for local development
and `https://luminous-api.jofrescari.workers.dev/auth/oauth/google/callback` for the deployed API.
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

Set `APP_ORIGIN` to the deployed frontend's exact origin and build the frontend
with `VITE_API_ORIGIN=https://luminous-api.jofrescari.workers.dev`.
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
src/
  App.tsx                  # app shell
  main.tsx                 # React root
  index.css                # Tailwind import + global theme/body CSS
  lib/
    pixi/createPixiApplication.ts
    animation/gsapPixi.ts  # GSAP + PixiPlugin registration
  features/playmat/
    index.ts               # public feature export
    Playmat.tsx            # feature orchestrator + turn/board state
    constants.ts           # layout constants + shared class/style strings
    types.ts               # domain types
    playmat.css            # surface/card/attachment CSS
    data/mockPlaymat.ts    # static board + log fixtures
    pixi/
      CardView.ts          # per-card Pixi display object (spring/juice/tilt)
      cardBackTexture.ts   # procedural card-back textures
    utils/                 # cardMovement, benchLayout, piles, players
    components/            # Bench, Card, CardImage, GameLog, Hand, Piles,
                           # PlayerSide, StadiumSlot, TurnHud, AnimatedCardsLayer
```

## Notes

- Card faces load from remote image URLs (see `data/mockPlaymat.ts`); card
  backs are generated procedurally in the Pixi layer.
- The bench holds 5 Pokémon by default, or 8 while a bench-expanding stadium
  (e.g. Lumiose City) is in play.
- Respects `prefers-reduced-motion`: intro, idle, and juice animations are muted.
```
