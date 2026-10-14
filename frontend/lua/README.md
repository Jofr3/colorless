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

- Three equally sized menu buttons: Sandbox (blue) → `/simulator`, Online (red) → `/lobby`, Decks (pale green) → `/decks`.
- Account opens the Account tab in the Lua settings popup. Game, Graphics, Audio and Account share Balatro's overlay, border, controls and Back button. The Account tab shows your email in a disabled input, edits your display name, saves to the shared API, and signs out. Sign-in and registration open a Lua modal with email/password fields and Google sign-in, then return to the Account tab. The modal uses the same border, buttons, motion and screen effects as Settings.
- Settings apply immediately: screenshake (0–100), reduced motion, CRT strength (0–100), bloom, master/music/game-sound volume, and mute. They persist in browser storage across reloads. Reduced motion follows the device preference until explicitly changed. These settings currently apply to the Lua frontend.
- Account and Settings use separate compact panels matching Balatro's grey Profile button and original projected shadow, without extra headings. The Sound button is removed; the M keyboard shortcut remains available.
- Balatro-style buttons with the original four-step corner profile and projected shadows (no coloured button extrusion). The wrapper has the source's 0.1-tile embossed edge, without a drop shadow. Main buttons share the same dimensions and uppercase text size in a centered group.
- Shared room sway, eased cursor movement, and click jiggle ported from `update_canvas_juice`. Input coordinates follow the moving UI; reduced-motion mode disables room motion.
- Animated title-screen vortex, CRT/scanline/bloom pass, original UI sounds and music. The card renderer and edition effects remain available for future Lua pages.
- The unmodified CRT shader uses Balatro's default CRT strength of 70: barrel lens distortion, feathered screen edges, RGB fringing, phosphor scanlines, noise, contrast correction and eased screen tilt. Canvas filtering and the native LÖVE canvas draw match the original. Tilt uses the original 22 × 12.9-tile viewport scale, independent of the responsive menu layout. Bloom and glitching are disabled by the original default settings. Pointer input is mapped through the screen distortion before hit testing.
- Effects share Balatro's menu clock starting at 12 seconds, with room motion updated before advancing the shader clock. Reduced motion uses the original frozen background time of 300; this frontend additionally freezes CRT noise and disables screen tilt for the system accessibility preference.
- Horizontal desktop menu and stacked portrait buttons, viewport resizing, keyboard navigation, native accessible navigation, system reduced-motion preference, and persisted sound toggle.

Click a button to navigate; releasing outside the pressed button cancels the action. Use arrow keys and Enter/Space while the canvas is focused; Tab also reaches native links. M toggles sound. Audio starts after the first gesture and pauses when the window loses focus.

The other pages still open the current React application. Their home/back links still return to the React home. Sandbox preserves the current `/simulator` redirect to `/play`. The account adapter reuses the existing API client and cookie session; passwords and session cookies never cross into Lua or local storage. The match engine and deck editor remain in React; the existing React sign-in forms are still available as a fallback.

Inside Settings, Tab/Shift+Tab or up/down move between controls. Left/right switch tabs, cycle CRT Bloom, or adjust a focused slider by 5; Home/End set its minimum/maximum. Enter/Space activates toggles and buttons. Drag sliders with a mouse or touch. Select Display name to edit it; the canvas field uses a native input proxy for IME, selection, paste and mobile keyboards. Enter finishes editing and Escape cancels the edit. Profile changes require Save; the success message disappears after three seconds. In the authentication modal, Enter advances through the fields and submits from the last field, Tab/Shift+Tab moves between controls, and Back returns to Account settings. Passwords are masked in Lua and kept only in the native inputs/API request, then cleared on success or dismissal. Google redirects through the existing provider configuration and returns to `/lua/?account`. Escape or Back closes the popup and returns focus to Settings. The background menu cannot receive input while the popup is open. Native accessible navigation opens the same popup when WASM is running, with live control announcements; its fallback links to React settings if WASM fails.

## Visual source and new work

The build copies **unmodified** `splash.fs`, `CRT.fs`, `dissolve.fs`, `foil.fs`, `holo.fs`, `polychrome.fs`, `m6x11plus.ttf`, and six audio files from the local Balatro resources. Generated `asset-manifest.json` records their SHA-256 hashes. These resources are not vendored into this repository.

The palette follows Balatro's `globals.lua`: red `#FE5F55`, blue `#009DFF`, green `#4BC292`, panel `#374244`, with gold `#F5B244` and card stock `#F0EAD6`. The title and buttons are drawn in Lua. The reusable card system and its four pixel card faces are retained, but are not loaded by the home scene. `ui/motion.lua` ports Balatro's separate target/visible transforms, position/rotation/scale velocities, and juice equations. `ui/card.lua` follows `Card:draw` and `Sprite:draw_shader` for ambient and pointer tilt, screen-space uniforms, shadow parallax, and edition passes; it does not import Balatro's entire game/UI object system. The composition, card emblems, controls and responsive layout are new Luminous UI, so this is a first visual milestone, not a claim of complete behavioral parity.

## Files

- `main.lua`: home scene, routing intents, responsive layout, input/audio lifecycle.
- `ui/button.lua`: shared main-menu and utility button rendering, press states and hit bounds.
- `ui/room.lua`: original screen-motion equations and inverse transform for pointer input.
- `ui/screen.lua`: original CRT uniforms, screen compositing, and perspective/lens mapping for pointer input.
- `ui/settings.lua`: responsive settings overlay, tab/slider/toggle rendering, modal pointer and keyboard input.
- `ui/account.lua`: account snapshot, draft, text-input state and transient save confirmation.
- `ui/auth.lua`: authentication form display state; `ui/text_input.lua` shares field, selection and caret rendering.
- `src/features/lua/`: browser adapter sharing the React API client, including session, profile, sign-in, registration and Google authentication errors. Vite serves/bundles it as `/lua/account.js`, using the same `VITE_API_ORIGIN`.
- `ui/preferences.lua`: defaults, bounds validation, reduced-motion policy, and persistence serialization.
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
luajit frontend/lua/tests/room.lua
luajit frontend/lua/tests/screen.lua
luajit frontend/lua/tests/settings.lua
luajit frontend/lua/tests/account.lua
luajit frontend/lua/tests/auth.lua
```

The motion check executes the local Balatro `engine/moveable.lua` as the reference and compares 9,602 values across hover, juice, dragging, return-to-slot and 30/60/120/144 FPS plus long frames. `BALATRO_SOURCE` selects a different reference source directory. The render check covers centre/corner cursor positions at four screen scales, matching base/edition geometry, un-tilted shadows, hover hysteresis, and reduced motion.

The room check executes Balatro's `update_canvas_juice` directly and compares 11,520 values across desktop/portrait sizes, frame rates, click impulses and reduced motion, including the inverse pointer transform. Button rendering follows `UIBox_button`, `UIElement:draw_self`, and `draw_pixellated_rect`: a 0.98-scale black shadow at 30% opacity, position-dependent parallax, a 0.985 press scale, and a 0.1-second clicked state. The wrapper follows `create_UIBox_main_menu_buttons` (`emboss=0.1`, no `shadow` flag). Button hover is silent, as in the original menu.

The screen check executes the original `love.resize` and CRT uniform block from `Game:draw`, and checks perspective/lens input mapping. For actual GPU comparison, run `node frontend/lua/tests/build-effects.mjs`, then serve the printed temporary directory (for example, `python3 -m http.server 8799 --bind 127.0.0.1 --directory <printed-directory>`). Open that server in a WebGL browser and inspect the console for `GPU PASS`. It compares every output pixel against the original CRT block and canvas draw across three viewport sizes and three cursor positions, using the same love.js compiler/runtime. No Balatro resources or generated test builds are committed.

The shader mouse position and tile size are transformed into actual framebuffer coordinates. Hover uses Balatro's 0.02 scale/0.012 rotation impulse and +0.05 scale, with +0.1 drag zoom. Desktop dragging suspends hover and uses the ambient tilt, just as the original controller does (touch can combine both states). There is no added hover lift or whole-card idle rotation: idle motion comes from Balatro's synthetic cursor orbit. Shader `time` is the per-card seed, while the edition's second input is elapsed time, as in the source. Shadows are un-tilted and grow farther from the card when dragged.

The Decks menu opens the Lua library as a modal over Home (`/lua/?page=decks`),
using Settings’ entrance animation and full-screen backdrop. Back or Escape
closes it, and background controls remain inactive while it is open. It shares the
existing account/session and decks API. Search includes all decks, including those
assigned to folders in the React app. Folder controls are absent; existing folder
records and memberships are preserved. Sort cycles through manual, name and card
count ordering. Desktop pages hold eight decks; portrait pages hold four. Red
Page X/Y arrows, Page Up/Down and the mouse wheel wrap through pages. A full-width
orange Back button sits at the bottom, without a title header or item count.

Click a deck to open the current editor, whose Decks link returns to Lua. Compact deck rows show a right-aligned count (e.g. 60/60) beneath each pile,
then its name. Drag a deck's top card onto another deck to reorder. Failed writes reconcile with the server.
New decks are created without a folder.

Deck piles follow the in-game `G.deck` implementation in `cardarea.lua` and
`card.lua`: count-dependent 0.15/52-tile offsets, room-relative parallax,
every-ninth-card rendering, original rank shading and separate Moveable physics
per visible rank. Only the top card hovers or drags; lower cards stay in place.
Backs use plain sprite draws, with no resting shadow or dissolve tilt. Dragging
adds the original raised shadow and keeps the cursor's initial grab offset.
Hover uses the source impulse and paper sound. Empty decks show one selectable
back. The library does not download or display Pokémon cover art.

Text editing stays in native browser proxies for IME, selection, paste and mobile
keyboards; rendering stays in Lua.

Library checks: `bunx vitest run src/features/lua/library.test.ts`,
`luajit frontend/lua/tests/library.lua` and
`luajit frontend/lua/tests/deck_pile.lua`. The pile check executes the original
CardArea alignment function. Browser QA uses isolated in-memory API fixtures
with populated, empty and formerly folder-assigned decks and multiple pages.
