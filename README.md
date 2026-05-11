# luminous_ui_v2

A React 19 + Vite + Tailwind 4 static TCG playmat prototype.

## Stack

- React 19 + TypeScript 6
- Vite 8
- Tailwind CSS 4 (`@tailwindcss/vite`)

## Scripts

```bash
bun install
bun run dev
bun run build
bun run preview
bun run typecheck
bun run lint
bun run format
```

## Project structure

```text
src/
  App.tsx                 # app shell, renders the playmat feature
  main.tsx                # React root
  index.css               # Tailwind import + global theme/body CSS
  features/
    playmat/
      index.ts            # public feature export
      Playmat.tsx         # feature orchestrator + turn state
      constants.ts        # reusable layout/class/style constants
      types.ts            # playmat domain types
      playmat.css         # feature-specific surface/card CSS
      data/
        mockPlaymat.ts    # static board/log fixture data
      utils/
        players.ts        # small player helper functions
      components/
        Bench.tsx
        Card.tsx
        CardImage.tsx
        GameLog.tsx
        Hand.tsx
        Piles.tsx
        PlayerSide.tsx
        StadiumSlot.tsx
        TurnHud.tsx
public/cards/             # local card image fallbacks
```

## Notes

- Cards are static: no card physics, card animation, or drag/drop runtime.
- Feature code lives under `src/features/playmat` so playmat-specific data,
  helpers, and UI stay together.
- Local card images are served through responsive AVIF/WebP/JPG `<picture>` sources.
