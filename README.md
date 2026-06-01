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
bun run dev        # vite dev server (127.0.0.1:5173)
bun run build      # tsc -b && vite build
bun run preview
bun run typecheck
bun run lint       # biome
bun run format     # biome --write
```

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
