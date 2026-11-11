# Colorless Lua frontend

Colorless's web frontend: a LÖVE 11.4 application packaged with love.js for WebAssembly and served at `/`. Pages are chosen by path (`/sandbox`, `/decks`, `/online/CODE`, …); `?account` and `?settings` open the settings popup over any page. All visible menu content, layout, input handling, animation, audio, and rendering run in Lua. A small host script boots LÖVE, writes the viewport and card art into file mailboxes, and hands every other `COLORLESS:` print to the bridge module (`src/lua/bridge.ts`), which owns routing, the native text proxies, the accessible links and the API adapters.

## Run

From the repository root (the API runs separately with `bun run api:dev`, or use `bun run dev:all` for both):

```sh
bun run dev
```

This builds the Lua app and serves it at <http://127.0.0.1:5175/>. To build and run the frontend and API over Tailscale HTTPS:

```sh
bun run dev:tailnet
```

Open the printed frontend URL. Tailscale must be connected;
the command selects free ports. Ctrl+C stops both servers and its Tailnet proxies.

`bun run dev` rebuilds after an edit to Lua or host files (`watch.mjs`); refresh the page once the build prints. Without it, rebuild by hand, then refresh (a running Vite dev server picks the new files up):

```sh
bun run build:lua
```

The root `index.html` is the host page. `build:lua` writes the love.js runtime, the game package, `web/host.js` and `web/host.css` into `public/love/` (ignored by Git), which Vite serves at `/love/` and copies into `dist/love/` on build. The page's one module script, `src/lua/bridge.ts`, is bundled by Vite with the configured `VITE_API_ORIGIN`. `bun run build` runs the Lua build and the Vite build; `bun run deploy` does the same in production mode (`.env.production` points at the deployed API) and publishes `dist/` to the static-assets Worker in the root `wrangler.jsonc` (`colorless.jofrescari.workers.dev`).

The production HTML carries a Content-Security-Policy (injected by `vite.config.ts`): same-origin scripts plus `'wasm-unsafe-eval'` for love.wasm, the API origin and its WebSocket twin for `connect-src`/`img-src`, and `data:`/`blob:` images and media.

The build defaults to the sibling `../balatro-source` directory, including its installed `love.js` package. Override with `BALATRO_SOURCE=/absolute/path/to/balatro-source`. No changes are made to that source tree. The compiler uses compatibility mode with 128 MiB initial memory, as in the existing Balatro web build; cross-origin isolation headers are not required.

## This milestone

- Three equally sized menu buttons: Sandbox (blue) → `/sandbox`, Online (red) → the lobby modal at `/online`, Decks (pale green) → the deck library at `/decks`.
- Account opens the Account tab in the Lua settings popup. Game, Graphics, Audio and Account share Balatro's overlay, border, controls and Back button. The Account tab shows your email in a disabled input, edits your display name, saves to the shared API, and signs out. Sign-in and registration open a Lua modal with email/password fields and Google sign-in, then return to the Account tab. The modal uses the same border, buttons, motion and screen effects as Settings.
- Settings apply immediately: screenshake (0–100), reduced motion, CRT strength (0–100), bloom, max frame rate (60 or 144 FPS), master/music/game-sound volume, and mute. They persist in browser storage across reloads. Reduced motion follows the device preference until explicitly changed. These settings currently apply to the Lua frontend. Under them, the Game tab's Credits button opens the third-party notices in a new tab (`COLORLESS:credits`; the page's native Credits link goes to the same file).
- The frame loop (`love.run` in `main.lua`) runs update and draw at most 60 times a second, or 144 with Max Frame Rate, however fast the display refreshes (`ui/frame_pacer.lua`); input events are still read on every animation frame. Home and its Settings under reduced motion skip drawing frames that would repeat the last one (the browser keeps showing the last frame) and draw again on any input, page message, resize or change, and once a second regardless. Boot compiles only the menu's two shaders; the table and card shaders compile in the first frames after the menu shows, or at once for a page that needs them.
- Account and Settings use separate compact panels matching Balatro's grey Profile button and original projected shadow, without extra headings. The Sound button is removed; the M keyboard shortcut remains available.
- Balatro-style buttons with the original four-step corner profile and projected shadows (no coloured button extrusion). The wrapper has the source's 0.1-tile embossed edge, without a drop shadow. Main buttons share the same dimensions and uppercase text size in a centered group.
- Shared room sway, eased cursor movement, and click jiggle ported from `update_canvas_juice`. Input coordinates follow the moving UI; reduced-motion mode disables room motion.
- Animated title-screen vortex, CRT/scanline/bloom pass, original UI sounds and music. The card renderer and edition effects remain available for future Lua pages.
- Custom `COLORLESS` wordmark loaded from authored base and star sprites in `assets/branding/`. The 836 × 322 sprite uses exact 2×2 blocks from a 418 × 161 logical pixel grid, matching the original logo's pixel density and 2x texture treatment. It has angular, tapered lettering, ivory faces, a layered grey/teal border and subtle tinted ledge highlights. The second O is a silver colorless energy disc with a dark six-point star and no colored streaks. The star rotates clockwise once per minute while the disc and lettering remain fixed within the logo; Reduced Motion pauses the star at its current angle. Linear filtering and the live CRT shader match the source's rendering approach. No startup shaders or GPU readbacks are needed to create the logo. It scales proportionally for desktop and portrait and respects reduced motion. Authoring and palette details are in `assets/branding/SOURCES.md`.
- Balatro's CRT shader (patched at load only to measure its fringe and centre distance in CSS pixels on a high-DPR canvas) uses Balatro's default CRT strength of 70: barrel lens distortion, feathered screen edges, RGB fringing, phosphor scanlines, noise, contrast correction and eased screen tilt. Canvas filtering and the native LÖVE canvas draw match the original. Tilt uses the original 22 × 12.9-tile viewport scale, independent of the responsive menu layout. Bloom and glitching are disabled by the original default settings. Pointer input is mapped through the screen distortion before hit testing.
- Effects share Balatro's menu clock starting at 12 seconds, with room motion updated before advancing the shader clock. Reduced motion uses the original frozen background time of 300; this frontend additionally freezes CRT noise and disables screen tilt for the system accessibility preference.
- Horizontal desktop menu and stacked portrait buttons, viewport resizing, keyboard navigation, native accessible navigation, system reduced-motion preference, and persisted sound toggle.

Click a button to open its page; releasing outside the pressed button cancels the action. Use Tab, Shift+Tab or the arrow keys and Enter/Space while the canvas is focused. Tab past the last home button (Settings), or Shift+Tab before the first (Sandbox), leaves the canvas for the page's native links and the browser: Lua prints `COLORLESS:focus-edge:first|last|none` as home's focus moves, and `shell.ts` keeps that one Tab from SDL, which otherwise prevents every Tab. Under Settings, a popup, a wipe, a text field or on any other page Tab stays in the canvas. Coming back, the canvas resumes at the button it left. Keyboard focus shows with the focused control's own hover look, and one control looks active at a time: a key press parks the pointer until it next moves, so the highlight follows keyboard focus, and with the pointer over a control that control's hover wins. The pointer leaving the canvas or a lifted finger also parks it, so no hover sticks after a tap. M toggles sound. Audio starts after the first gesture and pauses when the window loses focus.

The sandbox chooser opens the full gameplay page at `/sandbox/play`. Online play runs in Lua too: the lobby modal at `/online` and the live table at `/online/<code>/play` (see Online below). The account adapter uses the shared API client and cookie session; passwords and session cookies never cross into Lua or local storage.

Inside Settings, Tab/Shift+Tab or up/down move between controls. Left/right switch tabs, cycle CRT Bloom or Max Frame Rate, or adjust a focused slider by 5; Home/End set its minimum/maximum. Enter/Space activates toggles and buttons. Drag sliders with a mouse or touch. Select Display name to edit it; the canvas field uses a native input proxy for IME, selection, paste and mobile keyboards. Enter finishes editing and Escape cancels the edit. Profile changes require Save; the success message disappears after three seconds. In the authentication modal, Enter advances through the fields and submits from the last field, Tab/Shift+Tab moves between controls, and Back returns to Account settings. Passwords are masked in Lua and kept only in the native inputs/API request, then cleared on success or dismissal. Google redirects through the existing provider configuration and returns to `/?account`. Escape or Back closes the popup; a keyboard close returns focus to the home button that opened it (Settings or Account), and a pointer close leaves none focused. The background menu cannot receive input while the popup is open. Native accessible navigation opens the same popup when WASM is running, with live control announcements; its fallback links (`/?settings`, `/?account`) reload the page with that popup requested.

## Visual source and new work

The browser loading screen follows `boot_timer` in Balatro's
`functions/misc_functions.lua`: black background, a centered 300 × 30 bar,
5-pixel corners and a 3-pixel white outline. The fill uses Balatro's gold
(`G.C.GOLD`, `#EAC058`) instead of the source's pale blue. Download progress
fills the first 90%; the bar disappears when Lua signals readiness. Loading
status remains available to screen readers, and startup errors show the
message and fallback navigation. Until ready the canvas says "Colorless is
loading" (`aria-busy`); once ready the page announces "Colorless is ready". A
stalled boot or a failure (host.js `onDegraded`) takes the canvas out of the
Tab order and drops its application role, and the menu links, plus Home on a
deep link, load their pages for real.

The canvas is `role="application"` with `aria-roledescription="game"`, so
screen readers pass its keys through. Its name is short and stable (the page,
or "Deck builder: <name>"), `#instructions` (its description) says how to use
the current page, Settings or the sign-in form, and a visually hidden `<h1>`
names the page. Collection pages and Settings make the menu links `inert`;
there is no `aria-modal`, which could hide the `#announcement` live region.

The build copies 37 files **unmodified** from the local Balatro resources (`assets` and `music` in `build.mjs`): eight shaders (`splash.fs`, `background.fs`, `CRT.fs`, `dissolve.fs`, `played.fs`, `foil.fs`, `holo.fs`, `polychrome.fs`), two textures (`textures/2x/Enhancers.png`, `textures/2x/chips.png`), the font `m6x11plus.ttf`, 25 sound effects and the menu music `music1.ogg`. All but the music go into `game.data`; the music ships beside it. These resources are not vendored into this repository. Generated `asset-manifest.json` records each file's SHA-256 under `files`, and under `inputs` the pinned love.js and the Balatro tree's git commit (with whether its `resources/` differ from it; `null` when the tree is not a git checkout) plus one digest over every copied file.

Balatro is by LocalThunk, published by Playstack; its files remain theirs and are not covered by this repository's `LICENSE` (MIT, for Colorless's own code and original assets only). m6x11plus is a font by Daniel Linssen (managore, <https://managore.itch.io/m6x11>), "free to use with attribution". The build also writes `THIRD-PARTY-NOTICES.txt` into `public/love/` (`scripts/third-party-notices.ts`): the fan-project disclaimer, these credits, the TCGdex and Pokémon notices, the licence of every npm package the page and the API Worker may bundle, love.js, and LÖVE with the libraries `love.wasm` carries. The page's Credits link and the Credits button on Settings' Game tab open it; `vite.config.ts` fails a build whose bundle carries an npm package the notices do not cover.

love.js stays on 11.4.1 (LÖVE 11.4), the final npm release; the one-line `fetchPackage` loader patch is local to `build.mjs`. `scripts/love-inputs.ts` pins its version and the SHA-256 of `index.js`, `src/game.js`, `src/compat/love.js` and `src/compat/love.wasm`, and stops the build naming any file that differs (dependency audit decision 14).

Unavailable cards in simulator pickers follow Balatro's `greyed` deck-view path (`functions/UI_definitions.lua`, `Card:draw`, and `played.fs`): saturation ×0.5, lightness ×0.8, alpha ×0.5, with the original card tilt and transparency and no shadow or normal face beneath the shader. Selection changes restore the normal rendering in place.

Card-grid page changes follow `your_collection_joker_page` in `functions/button_callbacks.lua` and the `title` branch of `CardArea:align_cards` in `cardarea.lua`. Cards are replaced immediately and each row spreads from the collection area's centre (converted from top-left to centre coordinates), using the existing `Moveable` velocity equations. `ui/collection_motion.lua` preserves the row fan, vertical bow, ambient sway, parallax offset, centred partial rows and 0.95 scale from the source. Selection refreshes preserve the current cards instead of replaying the entrance; reduced motion skips the spread and ambient sway.

The palette follows Balatro's `globals.lua`: red `#FE5F55`, blue `#009DFF`, green `#4BC292`, panel `#374244`, with gold `#F5B244` and card stock `#F0EAD6`. The title and buttons are drawn in Lua. The reusable card system and its four pixel card faces are retained, but are not loaded by the home scene. `ui/motion.lua` ports Balatro's separate target/visible transforms, position/rotation/scale velocities, and juice equations. `ui/card.lua` follows `Card:draw` and `Sprite:draw_shader` for ambient and pointer tilt, screen-space uniforms, shadow parallax, and edition passes; it does not import Balatro's entire game/UI object system. The composition, card emblems, controls and responsive layout are new Colorless UI, so this is a first visual milestone, not a claim of complete behavioral parity.

## Files

- `main.lua`: home scene, page intents, responsive layout, input/audio lifecycle. Each screen gets its callbacks from `callbacksFor(channel, extra)` (command channel, sound, announcements, sign-in) and owns a `cancelInteractions()` that main calls when a wipe starts or the window loses focus.
- `ui/bridge.lua`: the only stdout writer. `Bridge.emit(channel, ...)` prints `COLORLESS:<channel>:<fields>` with each field percent-encoded and TAB-joined, and `Bridge.send(channel, payload)` forwards a payload already joined that way; love.js splits stdout at every newline, so nothing else may print (`scripts/lua-bridge-guard.ts`).
- `ui/button.lua`: shared main-menu and utility button rendering, press states and hit bounds; `errorLine` draws page error text in red on an ink pill; `modalFrameRaised` is the `create_UIBox_generic_options` frame (emboss, JOKER_GREY border, dark interior) every modal and page panel uses.
- `ui/room.lua`: original screen-motion equations and inverse transform for pointer input.
- `ui/screen.lua`: original CRT uniforms, screen compositing, and perspective/lens mapping for pointer input.
- `ui/settings.lua`: responsive settings overlay, tab/slider/toggle rendering, modal pointer and keyboard input.
- `ui/account.lua`: account snapshot, draft, text-input state and transient save confirmation.
- `ui/codec.lua`: the mailbox wire codec (percent-encoded TAB fields, newline rows), command encoding, comma lists and UTF-16 prefix slicing.
- `ui/text_fit.lua`: shrink-then-ellipsize fitting of single-line text on UTF-8 boundaries.
- `ui/controls.lua`: keyboard focus direction, bounded focus cycling over a screen's controls, and `Controls.lit`, which picks the one control that draws its hover look.
- `ui/mailbox.lua`: reads the page-written mailbox files by name (`Mailbox.read('library')`) and parses the shared card-art map. `Mailbox.poll()` runs once per frame and reads only the host's revision list (`__mailbox_revisions.txt`); a mailbox file is read again only when its revision moves.
- `ui/limits.lua` and `ui/host_constants.lua`: deck sizes, mailbox file names and the lobby code's alphabet and length, generated from the TypeScript constants by `bun scripts/lua-constants.ts` (`--check` runs in `bun run check` and CI).
- `ui/wire_fields.lua`: each simulator, library and builder mailbox row's field name → column (1-based), generated by the same script from `src/lua/wireFields.ts`.
- `ui/auth.lua`: authentication form display state; `ui/text_input.lua` shares field, selection and caret rendering.
- `src/lua/`: browser adapters over the shared API client, including session, profile, sign-in, registration and Google authentication errors. `bridge.ts` registers them in one screen table and connects to the host script; Vite bundles it with the configured `VITE_API_ORIGIN`.
- `src/host/`: the page around the canvas. `router.ts` (path routes, history, back/forward, the builder's save-before-leave hold, titles and canvas labels), `shell.ts` (Lua's print commands, Settings requests, preferences storage, accessible links, the canvas's name, description, heading and boot/degraded state, and the Tab out of home), `textProxy.ts` (the native input proxies), `mailboxes.ts` (mailbox names) and `bridgeProtocol.d.ts` (the host-script contract).
- `ui/preferences.lua`: defaults, bounds validation, reduced-motion policy, and persistence serialization.
- `ui/card.lua`: generated card faces, original hover hit buffer, pointer/ambient tilt (a card active through keyboard focus keeps the ambient tilt) and edition/shadow passes.
- `ui/motion.lua`: tile-space target/visible transforms and original movement equations.
- `ui/theme.lua`: palette, font cache, text and stepped pixel panels.
- `ui/card_back.lua`: the red and blue Balatro deck backs from `Enhancers.png`, one atlas shared by the library, the sandbox chooser, the online picker, the table and the screen wipe.
- `ui/deck_grid.lua`: one page of deck piles in a two-row grid with its bounds and page count, shared by the sandbox chooser and the online picker.
- `ui/fx.lua`: `attention_text` with its backdrop and the blocking `after` sequencer; `ui/sim_fx.lua` adds the table's background colour ramp on top.
- `ui/online.lua`: the online lobby modal (create/join, code pill, versus seats, deck picker with the regulation filter, countdown, info steps).
- `ui/simulator.lua`, `ui/sim_overlay.lua`, `ui/sim_hud.lua`: the game table; online mode adds the `L` row, the away banner, flag-driven Options/game-over buttons and the press-again Leave. Hud and Overlay keep a reference to the simulator; the comments above `Hud.new` and `Overlay.new` list the fields they read and write. `Simulator:cancelInteractions()` drops a press or drag in progress (window blur).
- `ui/sim_model.lua`: `Model.parse(raw)` turns one simulator mailbox snapshot into plain tables (header fields, sides, items, info, actions, card actions, menu, Knock Outs, lifecycle). It never calls LÖVE; `Simulator:sync` applies the result and the KO presentation reads the destination's Prize counts from it.
- `ui/sim_ko.lua`: the Knock Out presentation (burns in engine order with attachments, Prize flights, the half-second handoff pause) behind `Ko.begin`, `update` (true when the held snapshot should apply) and `cancel`; `Simulator.koPresentation` holds the running one.
- `src/online/lobbyClient.ts`: the framework-free lobby WebSocket client used by the Lua adapters; `createLobby.ts` mints a code.
- `src/lua/online.ts` (`LuaOnline`), `onlineTable.ts` (`LuaOnlineMatch`) and `tableSource.ts` (`TableSource`, `LocalTableSource`): the online modal adapter, the online table source and the seam that lets one `LuaSimulator` drive local and online games.
- `web/`: browser bootstrap (`host.js`, `host.css`; the page itself is the root `index.html`): the love.js `Module`, the WebAssembly/WebGL check, the early `love.wasm` download and compile (counted into one boot bar), the gzipped game package (`game.data.gz`, handed to host.js by `build.mjs`'s `Module.fetchPackage` patch and unpacked with DecompressionStream, with the plain `game.data` as fallback), the loading and failure overlay, boot performance marks, mailbox writes and their revision list, the viewport/reduced-motion mailbox, card art, the menu music (`music1.ogg`, published beside `game.data` and written into the runtime's filesystem after Lua is ready, only once Lua asks for it: never for a muted player or one whose volume is zero, and not at start under Save-Data), and the screen wipe's eight fallback scans (`transition_cards/`, published and written the same way, for everyone). `host.js` is checked JavaScript (`// @ts-check`, `web/tsconfig.json`).
- `build.mjs`: stages the application and local resources, then invokes love.js into `public/love/`.

Card render textures are recreated after viewport changes because love.js clears canvas contents when resizing its WebGL backbuffer. Keep that behavior when adding future card artwork.

`ui/card_dimensions.lua` defines every card's geometry: a 136×187 artwork
area (matching the 600×825 source scans), with a one-pixel rim on
every side, giving a 138×189 texture. The browser caches scans at 272×374.
`ui/card_frame.lua` reproduces the ordinary `Enhancers.png` card's stepped
corners at those dimensions, without a white mat. Each scan's added rim
extends the nearby colours from each of its four outer edges, preserving
silver gradients and full-art variation rather than choosing a single tint.
Rounded/transparent corners use the nearest straight edge. Small edge profiles
are cached for up to 64 artwork files; decoded pixels are released immediately.
Generated faces use their own outer stock colour. `CardFrame.scan(path,w,h)` draws a
cached scan into the artwork box and returns false when there is none, so the
builder and the table fall back to their own placeholder faces.
The scan fits the inner rectangle. Corners copy both the alpha mask and the
inner rim of Balatro's ordinary `Enhancers.png` card at its native 1× scale.
The source's empty outer row/column are removed, so the straight borders
reach the wrapper edges; only the stepped corners are transparent.
The two-pixel rim joint at each shoulder preserves the source's inner contour.
The thin rim and enlarged artwork are preserved. Cards,
piles, attachments, previews, hit targets and outlines share the dimensions,
and the draw scale is uniform so the border stays even on screen.
Face-down cards fit their original back sprites to the same outer bounds.

## Card fidelity checks

Game entry, same-deck New game, and leaving the simulator use
`ui/screen_wipe.lua`, traced through Balatro's `wipe_on`/`wipe_off` in
`functions/button_callbacks.lua`, `engine/event.lua`, `engine/particles.lua`,
`Moveable:move_wh`, and `Card:start_dissolve`. One opaque, randomly rotated
square grows and contracts with the original triangular 40-tile, 1.7-second
envelope. Its colour follows the scene's background colour over 0.6 seconds.
Artwork loaded while browsing/editing decks or playing is saved as resized PNGs
in IndexedDB (`src/lua/artworkCache.ts`). The disk pool and shuffle
history survive page reloads. Its 128 MiB byte budget evicts the least recently
used artwork when necessary; there is no 64-card limit on this pool. The existing
64-image WASM working cache remains separate. Builder/game loads reuse disk
images before downloading them again.

Transitions randomly draw unseen cards from the disk pool, then begin another
cycle without an immediate repeat. The host prepares only one PNG in WASM;
Lua acknowledges it after retaining its GPU image and border, then the host
releases that file and prepares the next one. Merely preparing a card does not
mark it shown. New images join the pool, and a flip or resize cannot lose the
selected artwork. If storage is unavailable or still loading, selection falls
back to the working cache, then the eight bundled scans. Browser storage remains
subject to browser quota/eviction and clearing site data. The card uses the
shared Pokémon frame/proportions, original face-down back, juice,
eight-widths-per-second flip, and unchanged dissolve shader,
BLACK/ORANGE/GOLD/RED embers and sounds.

The source's `before` event starts the flip immediately and blocks the scene
change for 0.7 seconds. Nominal burn/removal times are 1.25/1.8 seconds;
Balatro's event queue adds frame-sized scheduling delays. The overlay is drawn
above popups inside the room/CRT pass. Input stays locked until removal;
history requests before coverage replace the pending destination. Tall or
ultrawide viewports enlarge the square just enough to cover every corner.
Reduced Motion skips the animation and its sounds. Resizing preserves progress.

`frontend/lua/tests/artwork_cache.js` exercises real browser IndexedDB with 80
cards, reopening, persistent shuffle history, concurrent downloads, byte-budget
eviction, replacements and blocked storage. With Vite running, open
`http://127.0.0.1:5175/love/host.css` in an isolated agent-browser session and run
`agent-browser --session <name> eval --stdin < frontend/lua/tests/artwork_cache.js`.
The plain-text page avoids running the game loop during this storage-only test.

`lua frontend/lua/tests/transition_art.lua` checks cached selection, shuffle
cycles, new arrivals, eviction and the fallback of the scans that have arrived.
`lua frontend/lua/tests/screen_wipe.lua` executes the original event and
particle code at 30/60/120/144 FPS and checks timing, square motion, viewport
coverage, resize and reduced motion. Run
`lua frontend/lua/tests/screen_wipe_navigation.lua` for covered page changes,
input locking and history routing; the simulator tests also cover deferred
same-deck restarts and replacement snapshots. The fallback scans are published
beside `game.data` (not inside it) and written into the runtime after ready; a
wipe before the first arrives keeps its card face down, so the first transition
never waits on the network. Their source URLs are recorded in
`assets/transition_cards/SOURCES.md` and their hashes in the build manifest.

Run from the repository root with Lua 5.1, the dialect love.js ships (5.2 and
LuaJIT also run them, but accept syntax 5.1 rejects, such as `goto`). CI runs
the whole suite under `lua5.1`, and so does `bun run test:lua`: it takes
`lua5.1` from PATH, else, where `nix` is, builds nixpkgs#lua5_1 once and keeps
it under `node_modules/.cache/lua5.1`, else falls back to `lua` and says so
(`LUA=<binary>` overrides it):

```sh
lua frontend/lua/tests/motion.lua
lua frontend/lua/tests/card_render.lua
lua frontend/lua/tests/room.lua
lua frontend/lua/tests/screen.lua
lua frontend/lua/tests/settings.lua
lua frontend/lua/tests/account.lua
lua frontend/lua/tests/auth.lua
```

The motion check executes the local Balatro `engine/moveable.lua` as the reference and compares 9,602 values across hover, juice, dragging, return-to-slot and 30/60/120/144 FPS plus long frames. `BALATRO_SOURCE` selects a different reference source directory. The render check covers centre/corner cursor positions at four screen scales, matching base/edition geometry, un-tilted shadows, hover hysteresis, and reduced motion.

The room check executes Balatro's `update_canvas_juice` directly and compares 11,520 values across desktop/portrait sizes, frame rates, click impulses and reduced motion, including the inverse pointer transform. Button rendering follows `UIBox_button`, `UIElement:draw_self`, and `draw_pixellated_rect`: a 0.98-scale black shadow at 30% opacity, position-dependent parallax, a 0.985 press scale, and a 0.1-second clicked state. The wrapper follows `create_UIBox_main_menu_buttons` (`emboss=0.1`, no `shadow` flag). Button hover is silent, as in the original menu.

The screen check executes the original `love.resize` and CRT uniform block from `Game:draw`, and checks perspective/lens input mapping. For actual GPU comparison, run `bun run e2e --gpu`, which builds, serves and reads it headlessly; by hand, run `node frontend/lua/tests/build-effects.mjs`, then serve the printed temporary directory (for example, `python3 -m http.server 8799 --bind 127.0.0.1 --directory <printed-directory>`). Open that server in a WebGL browser and inspect the console for `GPU PASS`. It compares every output pixel against the original CRT block and canvas draw across three viewport sizes and three cursor positions, using the same love.js compiler/runtime. No Balatro resources or generated test builds are committed.

The shader mouse position and tile size are transformed into actual framebuffer coordinates. Hover uses Balatro's 0.02 scale/0.012 rotation impulse and +0.05 scale, with +0.1 drag zoom. Desktop dragging suspends hover and uses the ambient tilt, just as the original controller does (touch can combine both states). There is no added hover lift or whole-card idle rotation: idle motion comes from Balatro's synthetic cursor orbit. Shader `time` is the per-card seed, while the edition's second input is elapsed time, as in the source. Shadows are un-tilted and grow farther from the card when dragged.

The Decks menu opens the Lua library as a modal over Home (`/decks`),
using Settings’ entrance animation and full-screen backdrop. Back or Escape
closes it, and background controls remain inactive while it is open. It shares the
existing account/session and decks API. Search includes all decks, including those
assigned to folders by the former React app. Folder controls are absent; existing folder
records and memberships are preserved. Sort cycles through Name A–Z (the default), Name Z–A and card
count ordering. Desktop pages hold twelve decks in two rows of six; portrait pages hold four. Red
Page X/Y arrows, Page Up/Down and the mouse wheel wrap through pages. A full-width
orange Back button sits at the bottom, without a title header or item count.
The grid uses the Joker collection's G.C.BLACK inset panel and 0.05-tile emboss.
On page changes, piles spread from each row's center using the collection Card
constructor position and the shared Moveable physics. The paginator uses the
original DynaText character pop-in (rate 8) and ongoing bump motion; it stays
silent and respects Reduced Motion.

Click a deck to open its Lua builder (`/decks/<id>`). Compact deck rows show the name above each pile and a right-aligned count
(e.g. 60/60) beneath it. A small blue dots button under each pile's left half (the focus stop after its deck,
read as "Manage <name>") opens the Manage dialog: Edit deck, Rename and Delete deck. Delete opens a second
dialog that names the deck and must be confirmed. Dragging a top card returns it to its pile without changing the sort order. Failed writes reconcile with the server.
New decks are created without a folder.

Deck piles follow the in-game `G.deck` implementation in `cardarea.lua` and
`card.lua`: count-dependent 0.15/52-tile offsets, the in-game deck's right-side parallax,
every-ninth-card rendering, original rank shading and separate Moveable physics
per visible rank. Only the top card hovers or drags; lower cards stay in place.
Backs use plain sprite draws, with no resting shadow or dissolve tilt. Dragging
adds the original raised shadow and keeps the cursor's initial grab offset.
Hover uses the source impulse and paper sound. A translucent two-line View/Deck
badge follows the top card's position and rotation, without inheriting its zoom.
The counter follows `area_uibox`: three unshadowed text nodes at scale 0.3,
0.03-tile padding, 0.1-tile end spacers and the source 200px font atlas, height
correction and text offsets. It stays attached to the deck area while dragging.
Empty decks show one selectable
back. The library does not download or display Pokémon cover art.

Text editing stays in native browser proxies for IME, selection, paste and mobile
keyboards; rendering stays in Lua.

Library checks: `bunx vitest run src/lua/library.test.ts`,
`lua frontend/lua/tests/library.lua` and
`lua frontend/lua/tests/deck_pile.lua` and
`lua frontend/lua/tests/deck_labels.lua` and
`lua frontend/lua/tests/page_text.lua`. These checks execute the original
CardArea alignment, collection page callback, UIBox counter/badge layout and
DynaText letter-animation functions. Browser QA uses isolated in-memory API fixtures
with populated, empty and formerly folder-assigned decks and multiple pages.

The Lua builder uses a four-by-two card catalog on desktop and two-by-two on
portrait screens. It shares card search, live facet vocabularies, copy limits,
format validation, decklist import/export, and the serialized autosaver from
`src/decks/`. Click a card to inspect it, use its Add button, or drag it into the
deck tray. Drag a deck row out of the tray to remove one copy. Portrait mode has
Browse/Deck tabs and a bottom drop target. Card art is decoded by the browser into
a bounded PNG cache; Lua renders it at double atlas resolution with the original
card motion, hover shader, drag shadow, and room/CRT transform.
The deck tray has a compact paginator and an icon toggle between rows and a
three-by-two card grid with quantities. Both views share the category tabs; card
previews support inspection and dragging out to remove a copy.
List rows adapt Balatro's `create_UIBox_current_hand_row`, with quantity badges,
grey embossed backgrounds and inset quantity controls. Dragged deck previews
remain visible until the original Moveable motion returns them to their origin.
Deck information follows `create_UIBox_high_scores_row` and `create_progress_box`
from Balatro: darkened JOKER_GREY labels, BLACK values, solid 0.05-tile emboss,
clipped half-alpha blue fills, and the original static/DynaText shadow and float
formulas. `lua frontend/lua/tests/deck_stats.lua` compares its palette and fill
geometry directly with the sibling game's source.

The name, format, cards and cover choice autosave together. Back waits for an
acknowledged save; failed saves retain the draft and offer Retry. A browser unload
warns when edits are pending. Imports replace the deck only after every parsed
card resolves. The decklist modal opens with the current list, a floating Copy
button and a Confirm action enabled only for nonempty changes. Unavailable
catalog entries remain visible and removable. Filters use three fixed-size tabs,
two-column option cycles, and HP sliders; the cycle centers have hover feedback
without opening another modal. Card details, filters, validation, import/export and Clear
use the same modal motion and backdrop as Settings. Native text proxies supply
IME, clipboard, selection and mobile keyboards; even the multiline decklist is
rendered in Lua.
The host sends the viewport's CSS size and its device-pixel size (CSS size times the full
`devicePixelRatio`, uncapped; re-sent on resize, browser zoom and a move to a screen of another
ratio). Lua renders the scene and the CRT pass at the device size (`ui/viewport.lua`), so text and
art are drawn at the screen's own resolution, and lays out from it with the same virtual canvas,
so at any ratio the page looks like the ratio-1 page, only sharper: the CRT's scanline count
comes from the CSS height, and its RGB fringe and centre distance are measured in CSS pixels
(`Screen.source` patches CRT.fs at load; at ratio 1 it computes Balatro's values). Fonts and card
faces keep their virtual-size rasters with nearest filtering, so the device-resolution scene shows
their texels crisply; rasterizing the font at device size would change glyph advances (by up to
7% at 22 px) and so every label's width. At ratio 1 SDL resizes the canvas itself, as before; a
denser canvas is sized only by Lua's setMode, and one wider than the GPU's largest texture renders
at the largest size that fits.

Builder checks: `bunx vitest run src/lua/builder.test.ts` and
`lua frontend/lua/tests/builder.lua`. They cover shared copy limits, delayed and
failed saves, navigation, stale searches and sessions, atomic imports, modal
geometry and drag targets. Browser QA uses mocked deck writes with the live
read-only catalog, including desktop/portrait layouts, artwork, drag add/remove,
imports, and save-failure recovery.
Additional checks: `deck_row.lua`, `input_hover.lua`, `drag_return.lua`, and
`transfer.lua` in `frontend/lua/tests/` cover source palettes and hover layering,
return animation and texture cleanup, and decklist editing/confirmation.
`shared_widgets.lua` covers the raised modal frame, the shared deck backs,
`CardFrame.scan` and the deck pile grid.

## Sandbox deck selection

Sandbox resumes a saved Lua game when available; otherwise it opens `/sandbox`. Player 1 / Player 2 tabs select the active
seat. The search field and deck grid use the library's input, embossed collection
tray, generic back piles, title/count styling and animated red paginator. Desktop
pages hold ten decks in two rows of five; portrait pages hold four. Clicking a
pile selects it for the current player; a thin white outline encloses the selected title, pile and card count. Search and
pagination leave both players' selections intact, including decks in folders.

Both seats can use the same deck. The chooser automatically hides decks that fail
the builder validation (size, Basic Pokémon, copy limits, special-card limits,
missing catalog cards, and legality in the saved format). Deck and catalog requests
are bounded; transient failures show a retry state instead of hiding decks.
Play refetches and revalidates both decks before starting.
`src/game/prepareSandbox.ts` prepares the game. The host saves
the validated game and initial log in the existing simulator format before
navigation; unavailable storage keeps the chooser open with an error. Leaving
or changing accounts cancels pending loads and prevents late game launches.

Checks: `bun run test:run src/lua/sandbox.test.ts` and
`lua frontend/lua/tests/sandbox.lua`. These cover independent selection,
search, pagination, responsive bounds, disabled/busy controls, and modal hit testing.
The shared pile's original CardArea comparison lives in `tests/deck_pile.lua`.


## Sandbox gameplay

`/sandbox/play` is a full page built like Balatro's run screen. The
original `background.fs` runs with `ease_background_colour` palettes (the Small
Blind green on your turn, the grey-blue won palette on the opponent's, the boss
red or chips blue when the game ends). The left column ports
`create_UIBox_HUD`: a dark column running past the top and bottom of the room
inside a thin `DYN_UI.MAIN` frame, so only its two side lines show. That
dynamic colour follows the seat whose turn it is (player 1 blue, player 2 red,
neutral grey with no game) and also tints the turn panel's header and body
like the blind colour does. Inside: a turn panel in the HUD blind's shape (a DynaText header naming the acting player
over an empty body, reserved for later), the action panel in the
hand area's slot (End turn above a row of square Undo turn / Undo action /
Redo action / Redo turn icons, or Ready and the other setup buttons), the red GAME LOG / orange OPTIONS
buttons, and P1 Hand / P2 Hand / Turn / Energy / Supporter counters. Undo and redo
step through every accepted action; the turn buttons jump between the
checkpoints that begin each turn, and both survive a reload. Mulligan bonus
cards draw automatically for both players, including when resuming a pending
draw. These draws settle before publishing the board and stay out of undo/redo
stops, so history never repeats them. Everything on the table sits in
CardArea wells (black 10%, `r=0.1`, plus a whisper of the seat colour: the
opponent's half warm, yours cool) with `area_uibox` counters. The table is
four rows of wells between three columns: the opponent's discard, deck and
your prizes down the left; the wide benches top and bottom with the two
Actives stacked in the middle and the Stadium beside yours; the opponent's
prizes, your deck and your discard down the right. Prizes are 2×3 grids of
backs, the opponent's hand is a count on their bench strip, and your hand fans
along the bottom with `align_cards`' rotation, arc and breathing. Decks use
the shared `G.deck` pile; discards are a pile too, newest card face up. An
action that shuffles a deck riffles its pile with `align_cards`' `shuffle_amt`
(odd ranks slide and turn, twice) and the card-fan sound.
In-play Pokémon show their attached cards the way a real table does: Energy
cards tucked sideways behind the right edge, aligned to the bottom, Tools
behind the left edge aligned to the top, each further card a little less
exposed. HP lives in the hover popup as remaining/max.

Hovering a face-up card shows `card_h_popup`: a lightened JOKER_GREY frame, a
white description box with Ability tags, attack rows (energy pips, name,
damage) and the Weak / Resist / Retreat line, plus type, stage, Trainer or
Energy badges. Clicking one of your cards highlights it (`G.HIGHLIGHT_H`) and
attaches use/sell-style buttons: Bench, Play, Place Active, attack rows with
cost pips and printed damage, Retreat, Abilities and View (attacks, Retreat
and Abilities live only here). Targeted actions
(Attach, Evolve, Tools) turn the table into a picker: candidates bob with
`juice_card_until` and a white outline while everything else is tinted.
Cards can also be dragged: hand cards onto the Active or Bench wells (attach,
evolve, place), onto the Stadium slot, or onto the centre to play a Trainer;
Bench cards reorder; the Active dropped on a Benched Pokémon retreats, and
so does a Benched Pokémon dropped on the Active spot. The retreat cost comes
out of the attached Energy without a picker whenever every attached card is
the same Energy.

Host prompts render as `create_UIBox_generic_options` overlays or on the table
itself: button lists, real card rows in the collection tray (searches, Energy
discards, card orders), board picks and prize picks highlighted in place,
coin flips as spinning stake chips, the game log, discard piles, a card
inspector, an Options menu (Settings, Choose decks, New game, Main menu)
and `create_UIBox_game_over`. Main menu saves the game before leaving.
New game asks for confirmation, then reshuffles the same complete decks and returns to setup with fresh
history; the play-screen restart icon uses the same action. Choose decks opens
the deck-selection flow. A new match clears the old table's animations and overlays.
The desktop Options frame is 7.54
viewport tiles wide, with 5-tile buttons and a 7-tile Back button, matching
`create_UIBox_options`, `create_UIBox_generic_options` and both original UIBox
sizing passes. `lua frontend/lua/tests/options.lua` compares these widths with
the source across viewport sizes; portrait retains its compact layout.
Snapshot diffs drive the juice:
damage and heals use `attention_text` with its growing backdrop square and the
mult/chips sounds, KO'd Pokémon dissolve with burn colours, prizes pop in
gold with the coin sound, errors pop in red with `cancel`, and new cards slide
in from their deck. A hot-seat flip passes the table straight to the next
player once the attack juice lands, announced by the TURN banner.

`LuaSimulator` reuses `hostReducer`, `redactGame`, `moveToAction` and the
existing simulator saves. Lua receives the viewer's projection only, never
hidden opponent identities or deck order, plus catalogue text for the visible
cards, per-card action rows (`K`) with targets, costs and damage, sidebar
actions (`A`) with their slot, and menus (`M`/`O`/`F`) with a kind. Action
tokens carry a snapshot revision, so stale clicks cannot apply a different
action. Coin results come from the engine. Artwork uses the builder's browser
cache; cards without a scan draw a pixel placeholder in their type colour.
Adrena-Brain menus carry the selected source UID in the eighth `M` field and
a counter-transfer flag in the ninth. Valid targets shake immediately when
each selection step begins, then repeat at the normal interval.
The source stays raised while choosing a destination; both selected cards rise
for 0.5 seconds, shake together once for 0.4 seconds, then lower together.
The action resolves after at least 0.35 seconds and once both cards have settled.
This replaces their separate damage/heal shakes. New snapshots cancel pending
answers, and reduced motion resolves immediately.
`build.mjs` additionally copies `chips.png` and the chips, mult, coin, cancel,
whoosh, win and glass sounds.

Choosing P1, P2 or Random follows the original blind-selection presentation.
The source trace is `UIElement:click` → `G.FUNCS.select_blind` → `new_round`
→ `Blind:set_blind`, with `update_canvas_juice` moving the room:

- Click: `button` at pitch 1 / gain 0.3, a 0.5 room-jiggle impulse, and a
  0.1-second pressed/debounce window.
- The old prompt shrinks at `pop_out(5)` while moving ten tiles upward. The
  source's 0.8-second pause is shortened to 0.5 seconds for a quicker response.
- At 0.5 seconds, the seat colour starts its 0.3-second linear fade. At 0.55
  seconds, the panel targets its resting position using the shared Moveable
  equations. At 0.7 seconds, the silent title starts its letter cascade and the
  room receives a 3-point jiggle impulse.
- That reveal plays `chips1` (pitch 0.55–0.65, gain 0.42) and `gold_seal`
  (pitch 1.85–1.95, gain 0.26) together, with source gain and overlapping voices.

The animation uses Balatro game speed 1 with the shortened initial pause; this
simulator has no game speed setting. The source's blind-chip/reward animations have no equivalent in
this HUD. Portrait keeps its compact header; reduced motion skips the entrance
and shake while retaining audio. Restoring a game, refreshing its snapshot or
handing setup to the other player does not replay the entrance.
`lua frontend/lua/tests/sim_hud.lua` executes the original HUD sizing,
`Blind:set_blind` and DynaText code for comparison. `tests/room.lua` compares
the original room equations and inverse input coordinates across frame rates,
viewport scales, both impulses and reduced-motion settings.

Checks: `bun run test:run src/lua/simulator.test.ts`,
`lua frontend/lua/tests/simulator.lua`,
`lua frontend/lua/tests/simulator_draw.lua`,
`lua frontend/lua/tests/sim_model.lua` (the parse against the wire fixtures,
without LÖVE) and `lua frontend/lua/tests/sim_ko.lua` (the KO presentation on
its own). They exercise real setup and
hot-seat flips, redaction, stale actions, attachment drops, card-row prompts,
attacks from attached rows, retreat picks, persistence, hand drags and drops,
targeting, every menu kind, the hot-seat flip, the game-over screen and both
layouts, with the draw paths rendered against a stub LÖVE.

## Online

Online (home) opens `/online`, a page drawn as a modal over Home with
Settings' backdrop, entrance and generic-options frame. Page ids keep browser
history, reload and sign-in returns working: `/online/CODE` is the invite
link and resumes or joins that lobby, and `/online/CODE/play` is the live table.
Old `/?lobby=CODE`, `/match/CODE` and `/?page=…` links still resolve and are rewritten. Create and the
online/match hand-offs use `history.replaceState`, so Back from either page goes
Home, which leaves the lobby (a live match is forfeited).

Steps: **menu** (Create / Join tabs; the code field is a native proxy that
upper-cases and drops look-alike characters; Join stays disabled until four
characters), **joining**, **waiting** (code pill, Copy code, Copy link =
`<origin>/online/CODE`, the label flashes Copied), **versus** (your seat
and the opponent's, presence pip, Waiting / Choosing deck / Ready / Away pills,
Choose deck, Ready / Cancel ready; the Lua host has no Kick), the deck **picker**
(search, 5×2 or 2×2 pile grid, pages and a regulation cycle: All decks, Standard
legal, Not Standard legal, Expanded legal, Not Expanded legal; the filter only
changes the view and every listed deck already passes the Sandbox's playable
check), **countdown** (3, 2, 1, GO! as `attention_text`; only Leave works),
**starting**, and the info steps **invalid / not-found / full / kicked** with
Back to online. Spectating is not offered: a full lobby shows "Lobby is full".
Anonymous players can create and join,
and sign in from the menu or the picker; the socket then reopens with the same
seat and the account's name.

When the lobby flips in-game, both players wipe to `match`. It reuses the
Sandbox table and `LuaSimulator` with an online `TableSource`. Play order is the
server's (`settleFirstPlayer`, apps/api/src/lobby/match.ts): a lobby's first
game (or one after a tie) goes to the coin winner with no choice, and each
rematch's previous loser picks Go first / Go second. The server is
authoritative: refused actions pop the red error, Prizes and mulligan draws are
taken automatically, and the HUD's Energy and Supporter cells read the frame's
`allowances` (a server that sends none leaves only the Supporter cell, recovered
from the log). Options become Settings / Concede / Leave match. Leave
during a live game uses the press-again pattern ("Leave? Forfeits", 3-second
window); after the game it is immediate. Game over offers Rematch (Waiting...
once sent) / Leave / Game log / View table. Both players stay at the finished
table during a rematch: the first press asks (the server readies the asker),
the second readies the other player, and the next game opens on the same table.
Only an opponent who leaves or disconnects sends the wait back to the lobby
modal. When the opponent drops, a
`boss_warning_text` banner names them and counts down the 90-second forfeit
locally; "{name} is back" pops when they return. Coin flips animate from the
log's cues, and effect prompts take their title from the frame's `invokedBy` and
`abilityName`. Only the top card of each stack is on the wire, so the bench order
key (a stack's bottom card) is inferred from frame to frame and resets on reload.

Protocol: Lua prints `COLORLESS:online:<cmd>` (fields encoded with
`ui/codec.lua`, TAB-separated), which the bridge's shell hands to `LuaOnline`. Commands:
`open [code]`, `close`, `create`, `join code`, `leave [home]`, `decks`,
`select deckId`, `ready 1|0`, `kick`, `copy code|link`; `input` and
`finish-input` stay in the shell for the native code/search proxies. `LuaOnline`
publishes to `__online.txt`: a header
(revision, step, busy, message, code, role, link, countdown, notice, decks
state, name, account, canKick, status), `P` seat rows (the opponent's deck is
never sent) and `D,id,name,cardCount,standard,expanded` deck rows. Proxy edits
arrive in `__online_input.txt`. The table keeps `__simulator.txt`; its new
`L,mode,spectating,awayName,awayMs,flags,allow` row carries the online
lifecycle (flags `concede`, `rematch`, `rematch-sent`, `leave`).

Keyboard: Tab / Shift+Tab or up/down move focus and announce the control;
left/right switch the menu tabs and turn the regulation cycle; Enter/Space
activate; typing on the Join tab starts the code field and Enter joins; Escape
closes the picker, is ignored during the countdown and otherwise
acts as the Back slot. Page Up/Down and the wheel turn picker pages. Steps, joins, ready changes, copies and countdown ticks
are announced through `#announcement`. A deck that can't be played online (not legal in its own format) carries the alert
badge and ignores the pointer, but keyboard focus still reaches it and reads the reason; Enter on it says why it can't be
chosen instead of choosing it.

Online checks: `bunx vitest run src/online src/lua`,
`lua frontend/lua/tests/online.lua`, `lua frontend/lua/tests/simulator_online.lua`,
`lua frontend/lua/tests/options.lua` and
`lua frontend/lua/tests/screen_wipe_navigation.lua`. Browser QA uses two
sessions against a local API: create, invite link, typed join, kick and
rejoin, anonymous sign-in, picker and filter, ready/cancel, countdown, setup and
turns, a refused second Energy, away banner and resume, concede, rematch,
press-again Leave, browser Back forfeit, full / not-found / invalid links,
portrait and reduced motion.
