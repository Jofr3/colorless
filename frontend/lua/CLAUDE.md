# frontend/lua

- Structure, the mailbox and print protocol, the screens and the Lua tests: `README.md` here
  ("Files" has the steps for a new screen or wire field).
- The TypeScript side is `src/host` and `src/lua`; the wire rows are `src/lua/wireFields.ts`, and
  `bun run gen` regenerates `ui/wire_fields.lua` and `ui/host_constants.lua` (never edit those).
- One Lua test: `bun run test:lua <name>.lua`; the gate is `bun run check`; `bun run e2e` drives the
  real page.
