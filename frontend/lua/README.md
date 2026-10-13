# Luminous Lua frontend — home milestone

A separate LÖVE 11.4 application, packaged with love.js for WebAssembly. The React frontend remains at `/`; the new home is at `/lua/`. All visible menu content, layout, input handling, animation, audio, and rendering run in Lua. The small HTML/JS host boots LÖVE, passes viewport/preferences through a file mailbox, exposes native accessible links, and navigates to existing routes.

## Run

From the repository root:

```sh
bun run dev:lua
```

If Vite is already running on port 5175, just build and visit <http://127.0.0.1:5175/lua/>:

```sh
bun run build:lua
```

Rebuild after editing Lua or host files, then refresh. Generated files live in `public/lua/` and are ignored by Git. The normal React build copies this directory into `dist/lua/` if it exists. To build both from scratch:

```sh
bun run build:lua
bun run build
```

The build defaults to the sibling `../balatro-source` directory, including its installed `love.js` package. Override with `BALATRO_SOURCE=/absolute/path/to/balatro-source`. No changes are made to that source tree. The compiler uses compatibility mode with 128 MiB initial memory, as in the existing Balatro web build; cross-origin isolation headers are not required.

## This milestone

- Four menu cards: Play → `/play`, Sandbox → `/simulator`, Online → `/lobby`, Decks → `/decks`.
- Account and Settings open the existing settings page, which includes the profile/sign-in controls. Authentication and sign-out remain managed by React.
- Card hover, pointer-tracked shader deformation, spring-like settling, original juice timing, drag and snap-back, and click feedback.
- Foil, holographic and polychrome card editions, animated title-screen vortex, CRT/scanline/bloom pass, original UI sounds and music.
- Portrait two-column layout, viewport resizing, keyboard navigation, native accessible navigation, system reduced-motion preference, and persisted sound toggle.

Click a card to navigate. Dragging a card does not navigate; it returns to its slot when released. Use arrow keys and Enter/Space while the canvas is focused; Tab also reaches native links. M toggles sound. Audio starts after the first gesture and pauses when the window loses focus.

The other pages still open the current React application. Their home/back links still return to the React home. Sandbox preserves the current `/simulator` redirect to `/play`. This milestone does not port the match engine, authentication, deck storage, or API client into Lua.

## Visual source and new work

The build copies **unmodified** `splash.fs`, `CRT.fs`, `dissolve.fs`, `foil.fs`, `holo.fs`, `polychrome.fs`, `m6x11plus.ttf`, and six audio files from the local Balatro resources. Generated `asset-manifest.json` records their SHA-256 hashes. These resources are not vendored into this repository.

The palette follows Balatro's `globals.lua`: red `#FE5F55`, blue `#009DFF`, green `#4BC292`, panel `#374244`, with gold `#F5B244` and card stock `#F0EAD6`. The title and four new pixel card faces are drawn in Lua. `ui/motion.lua` ports Balatro's separate target/visible transforms, position/rotation/scale velocities, and juice equations. `ui/card.lua` follows `Card:draw` and `Sprite:draw_shader` for ambient and pointer tilt, screen-space uniforms, shadow parallax, and edition passes; it does not import Balatro's entire game/UI object system. The composition, card emblems, controls and responsive layout are new Luminous UI, so this is a first visual milestone, not a claim of complete behavioral parity.

## Files

- `main.lua`: home scene, routing intents, responsive layout, input/audio lifecycle.
- `ui/card.lua`: generated card faces, original hover hit buffer, pointer/ambient tilt and edition/shadow passes.
- `ui/motion.lua`: tile-space target/visible transforms and original movement equations.
- `ui/theme.lua`: palette, font cache, text and stepped pixel panels.
- `web/`: browser bootstrap, navigation allowlist, accessible fallback, viewport/reduced-motion bridge.
- `build.mjs`: stages the application and local resources, then invokes love.js.

Card render textures are recreated after viewport changes because love.js clears canvas contents when resizing its WebGL backbuffer. Keep that behavior when adding future card artwork.

## Card fidelity checks

With LuaJIT installed, run from the repository root:

```sh
luajit frontend/lua/tests/motion.lua
luajit frontend/lua/tests/card_render.lua
```

The motion check executes the local Balatro `engine/moveable.lua` as the reference and compares 9,602 values across hover, juice, dragging, return-to-slot and 30/60/120/144 FPS plus long frames. `BALATRO_SOURCE` selects a different reference source directory. The render check covers centre/corner cursor positions at four screen scales, matching base/edition geometry, un-tilted shadows, hover hysteresis, and reduced motion.

The shader mouse position and tile size are transformed into actual framebuffer coordinates. Hover uses Balatro's 0.02 scale/0.012 rotation impulse and +0.05 scale, with +0.1 drag zoom. Desktop dragging suspends hover and uses the ambient tilt, just as the original controller does (touch can combine both states). There is no added hover lift or whole-card idle rotation: idle motion comes from Balatro's synthetic cursor orbit. Shader `time` is the per-card seed, while the edition's second input is elapsed time, as in the source. Shadows are un-tilted and grow farther from the card when dragged.
