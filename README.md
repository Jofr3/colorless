# luminous_ui_v2

A React 19 + Vite + Tailwind 4 prototype of a TCG playmat with Balatro-style card physics. Standalone clone of the `playmat` v9 page from `luminous_ui`.

## Stack

- **React 19** + **TypeScript 6**
- **Vite 8** (dev server + build)
- **Tailwind CSS 4** (`@tailwindcss/vite`)
- **GSAP 3** (card animation engine)
- **dnd-kit** (`@dnd-kit/core`) for drag-and-drop card placement

## Scripts

```bash
bun install          # install dependencies
bun run dev          # start dev server on http://127.0.0.1:5173 (strict port)
bun run build        # tsc -b && vite build -> dist/
bun run preview      # serve the production build locally
bun run typecheck    # tsc -b --noEmit (no emit, just type-check)
bun run lint         # biome lint src
bun run format       # biome format src --write
```

## Project structure

```
src/
  App.tsx
  main.tsx
  index.css
  components/
    playmat-v9/
      Body.tsx          # the playmat scene (turn UI, hand, stadium, log, tuning panel)
    tcg/
      BalatroHoverCard.tsx     # Balatro-port hover/sway/release physics
      CardImage.tsx            # picture/source AVIF + WebP + JPG fallback
      EnergyIcon.tsx
      balatroTuning.ts         # runtime-tunable physics constants + persistence
      prefersReducedMotion.ts
public/
  cards/                       # ~73 card assets in avif/webp/jpg triplets
```

## Key features

- Drag-and-drop card placement on the playmat (dnd-kit pointer sensors).
- Balatro-style card feel: hover zoom, idle ambient tilt, perspective bend, drag sway, and physics-driven release toss.
- Runtime tuning panel (settings cog, bottom-right) lets you dial spring stiffness, sway, idle tilt, etc. with values persisted to `localStorage`.
- Respects `prefers-reduced-motion`.

## Balatro physics — quick note

Constants and easing curves are ported directly from the Balatro Lua sources. Look at the comment block at the top of [`src/components/tcg/BalatroHoverCard.tsx`](src/components/tcg/BalatroHoverCard.tsx) for exact Lua-file references (`card.lua`, `moveable.lua`, `globals.lua`, `dissolve.fs`) and the matching JS values. Tunable subset lives in `src/components/tcg/balatroTuning.ts`.
