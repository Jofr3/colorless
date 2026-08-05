# Workstream: Polish (Phase 5)

Refinements unlocked once real **user** and **card** data exist. Threads through
P2–P4; tracked here so nothing is forgotten.

## Backlog
- **PASS / HISTORY CONTROLS — CLOSED 2026-07-26 (P5-4, D84).** The long-running
  "the Pass turn button is unclickable while the turn panel is open" item, and
  its residual about the history arrows, are both resolved — by DELETION, once
  the code was read rather than the symptom described:
  - **`PreviousButton`/`ForwardButton` took no props.** No `onClick`, no handler,
    on any surface, ever. They were mock chrome from the /simulator prototype, so
    "history navigation is unreachable during your own turn:action" described
    navigation that did not exist. Two buttons a screen reader announced as
    "Previous"/"Forward" and that did nothing are worse than none; they are gone.
    If a real history is built, they come back WIRED.
  - **The playmat's ⟶ was enabled exactly when the panel covered it** — the panel
    renders precisely when `passDisabled === false` — so on /play and online it
    was never clickable. `PlaymatView.onPassTurn` is now OPTIONAL and the control
    renders only for a driver that passes one: the /simulator sandbox, where
    nothing covers it. Each game panel has carried its own `Pass` since the
    earlier fix, browser-verified.
  Verified in a browser at 1280×700 with a real `elementFromPoint` hit-test (a
  synthetic `.click()` is what hid the original bug): at a live turn:action /play
  has no "Pass turn" and no arrows, its in-panel `Pass` hit-tests to itself and
  advances the turn; /simulator still has its ⟶, hit-testing to itself.
- **Lobby identity — NAMES DONE 2026-07-26 (P5-1, D81); avatars still open.** A
  lobby seat's name is now the ACCOUNT's `displayName`, resolved SERVER-SIDE at
  the hello (`loadDisplayName`, apps/api/src/lobby/displayName.ts) from the same
  `userId` the /ws session cookie already provided — so it is authoritative, not
  announced, and a player cannot present themselves as someone else. An anonymous
  socket (or an account whose name is blank) keeps the client's generated
  "Player 4271" handle; the blank case deliberately does NOT fall back to the
  email, which `AccountButton` shows a user about themselves but which a lobby
  broadcasts to the opponent AND to spectators. The client announces its account
  name too, purely so the host's locally-seeded waiting screen doesn't flash the
  old handle. Browser-verified: signed-in seats read "Ash"/"Misty" across panels,
  turn banner, game log and the spectator pill, while two signed-out players kept
  their generated handles. **AVATARS (generated) DONE 2026-07-26 (P5-2, D82):**
  `PlayerState.avatarSeed` carries an FNV-1a HASH of the account id (never the id
  — the snapshot is broadcast to the opponent and to spectators), from which
  `PlayerAvatar` draws a deterministic two-hue gradient plus the same initial the
  account control shows. Nothing stored, nothing uploaded, and the same person
  looks the same to you in every lobby; an anonymous seat keeps the generic
  figure rather than being given a face that would change next visit. Saturation
  and lightness are FIXED so the seed picks the hue and never how loud the result
  is. **Still open: uploaded avatars** — the item below (R2 + CSP); an image
  simply wins over the generated one when it lands.
- **Profiles — NAME + FACE DONE 2026-07-26 (P5-5, D85); favourite deck open.**
  The Profile section on **/settings** (`src/features/settings/
  ProfileSection.tsx`) is where an account edits itself, and the first thing it
  fixes is that P5-1 made your name authoritative and broadcast while leaving it
  unchangeable. **`PATCH /auth/me`** (requireUser BEFORE the validator; no write
  when nothing changed) takes `updateProfileRequestSchema` — one required
  `displayName`, trimmed, 1–64, the same bounds register applies to its optional
  one. The provider's `updateProfile` adopts the api's answer as the current
  user, so the corner account control follows with no re-probe.
  **The section shows the REAL generated avatar, not a lookalike:** `userSchema`
  now carries **`avatarSeed`** (derived server-side, the same value the lobby
  broadcasts), so `PlayerAvatar` — moved to `src/components/` since two surfaces
  use it — draws the identical face here and in a lobby. The seed module moved
  with it, to `apps/api/src/auth/avatar.ts`: it is a property of the ACCOUNT, not
  of a seat. Deriving the hash client-side was rejected — a second copy of FNV-1a
  is one that must agree with the server forever.
  The initial follows the draft as you type; a 401 mid-save re-probes and the
  panel becomes a sign-in prompt (`state.from` returns you here). **A rename
  reaches a lobby at the next hello** (`loadDisplayName` resolves the seat name
  there), so a player already seated keeps the old name until they rejoin.
  Browser-verified across two clients: "Brock" → "Pewter Brock" updated the
  initial, the corner control and the OPPONENT's player panel, with a
  byte-identical gradient throughout (the seed is the id, not the name).
  **FAVOURITE DECK — DONE 2026-07-27 (P5-7, D87):** an account pins one of its
  **own** decks as its favourite (nullable `users.favourite_deck_id`, migration
  `0005`, surfaced as `userSchema.favouriteDeckId` — just the ID) and sees that
  deck's cover + name on /settings via a native `<select>` that rides the SAME
  PATCH as the name. `PATCH /auth/me` takes an OPTIONAL nullable `favouriteDeckId`
  (absent leaves it, null clears it, a string is validated against the caller's
  decks → 400 `favourite deck not found`), the profile stores only the id and
  resolves the cover/name from the caller's own `GET /decks` (derive-on-read,
  tolerate stale — like the covers), and the FK is `ON DELETE SET NULL` so
  deleting the deck clears the pin. **BROWSER-VERIFIED end to end 2026-07-27
  (build #71):** the /settings picker listed only the caller's own decks;
  pinning one rendered its cover (real `<img>`, `naturalWidth=245`) + name and
  rode `PATCH /auth/me` (200); the pin survived a reload; `DELETE`ing the deck
  cleared `favouriteDeckId` to null server-side (the FK) and the tile went blank.
  Zero page errors. **Dev-drive gotcha:** wrangler's default API port `:8787`
  can be held by another project's dev server on this machine — the web client
  defaults its API origin to `:8787` (`src/lib/apiOrigin.ts`), so point it at the
  real port with `VITE_API_ORIGIN=http://localhost:<port>` when the API lands
  elsewhere; the API's CORS still allows `localhost:5173` regardless of its own
  port. **Still open: the uploads below.**
- **Avatars:** upload/choose an avatar → stored in R2, served from our domain;
  update CSP accordingly. The settings surface P5-2 said this needed now exists
  (the Profile section above), so what's left is genuinely the R2 + CSP +
  moderation half; an uploaded image simply wins over the generated face.
- **Deck covers / art — DONE 2026-07-26 (P5-3, D83).** A deck is fronted by its
  own headline card. **The rule (pure `pickCoverCardId`, apps/api/src/decks/
  cover.ts): the Pokémon with the highest printed HP**, ties broken by copies
  then card id. HP is the best proxy the catalog offers for "the card this deck
  is built around" and needs no taxonomy: ranking by STAGE gets a Basic-ex deck
  wrong, ranking by COUNT gets nearly every evolution deck wrong (the 4-of Basic
  beats the 3-of Stage 2 it evolves into). Cards with no scan are skipped;
  `coverCardId` is null for an empty or Pokémon-less deck and the blue back
  stands, which is also right for a deck you just created. Derived on READ in the
  list query (one extra query for the whole library, no stored column to keep in
  sync). It is a HEURISTIC — a user-chosen cover would simply win over it, and
  that's the natural follow-up. **A browser run caught the thing tests couldn't:**
  the deck name was nearly illegible over busy card art (it had always sat on a
  flat blue back), so the label now gets a gradient scrim — only when there IS
  art, so a coverless deck looks exactly as before.
  **A CHOSEN cover — DONE 2026-07-26 (P5-6, D86).** The follow-up above, built:
  a nullable `decks.cover_card_id` (migration `0004`) the editor pins, and a pure
  **`effectiveCoverCardId(chosen, candidates)`** (apps/api/src/decks/cover.ts) the
  list query runs — the pin wins, everything else falls through to
  `pickCoverCardId`, which is now explicitly the DEFAULT rather than the answer.
  It resolves against the candidate list the default was already deriving from,
  so a choice costs no extra query and a STALE pin (card removed elsewhere, scan
  gone after a re-ingest) falls back rather than drawing a blank. The pin may be
  a **Trainer** — guessing needs a rule, choosing does not. Two fields on purpose:
  `DeckSummary.coverCardId` is still the face being DRAWN (the grid needed no
  change), while `Deck.chosenCoverCardId` is the stored CHOICE the picker is set
  to. The picker (`CoverDialog`, opened from the deck panel's footer) offers
  **Automatic as an explicit option** — reverting is one click — and only cards
  the catalog can draw. **Consistency is enforced on both sides:** PATCH validates
  the pin against the list the patch leaves behind (400 `cover card not in deck`)
  and drops a pin whose card it removes; the editor's `toSnapshot` drops it
  locally too, which is load-bearing — the cover rides the same debounced PATCH
  as the card list, so a self-contradicting body would 400 forever.
- **Card detail view — DONE 2026-07-27 (P5-8, D88).** A read-only **detail modal**
  (`src/features/builder/components/CardDetailDialog.tsx`) opened from the deck
  builder's card grid, hydrating the full `Card` via the already-existing
  `GET /cards/:id` (`getCard`) — so the whole slice was web-UI; no API/DB/schema/
  ingest change. Shows the big high-quality scan plus attacks (cost pips + damage
  + effect), abilities, weakness/resistance/retreat, Trainer/Energy rules text,
  illustrator, rarity, regulation mark, and `{localId} · {setId}`. **The inspect
  affordance is a SIBLING of the add button, not a child** — the tile is a
  `<button>` (click=add, right-click=remove, pointer-down=drag), so a corner info
  button floats over it at `z-20`, revealed on hover/keyboard-focus, and clicking
  it opens the modal WITHOUT adding a copy (all three tile gestures untouched).
  Header name + image come from the seed `BuilderCard` (up instantly) while the
  body swaps loading→ready as `getCard` resolves, with a `cancelled` flag against
  stale responses and the seed retained through the close. **Honest about the
  catalog:** pricing / national-dex number / flavor text are NOT in D1, so the
  view doesn't show them (and prints the raw set id, no name lookup); every block
  is guarded so a Trainer/Energy omits what it lacks. **Respects
  `prefers-reduced-motion`** (`motion-reduce:transition-none`) — the model the
  older surfaces below still need. Type/cost pips reuse `EnergyGlyph` behind a
  pure `isGlyphType` guard. 1936 → 1941 tests. Browser-verified end to end
  (build #72): Absol (Pokémon), Academy at Night (Trainer, Effect-only), high-Q
  `<img>` naturalWidth=600, info click left the deck count at 0, X/Escape/backdrop
  all close. **NOTE the schema header (`apps/api/src/db/schema.ts`) documents that
  pricing / `dexId` / `description` are deliberately unstored** — adding any needs
  a migration + re-ingest, so a future "richer" detail view would start there.
- **Reduced-motion audit — DONE 2026-07-27 (P5-9, D89).** Carried
  `prefers-reduced-motion` respect through the three new P5 surfaces that lacked it,
  appending `motion-reduce:*` variants AT THE CALL SITE per the D88 idiom (the P5-8
  author deliberately did NOT edit the shared `glass.ts` constants; this slice
  honoured that placement). The app's ONLY global reduced-motion rule
  (`src/index.css` L190) neutralises just `<body>` + `.route-view`; it never
  touches a Tailwind `transition-*`/`scale-*`/`animate-*` utility on a component,
  which is why these were unguarded.
  - `CoverDialog.tsx`: `TILE_BASE`'s `hover:scale-[1.03] active:scale-95`, the
    close button's `transition-colors`, and the Done ghost button.
  - `Settings.tsx`: the font `<select>`, the back-arrow icon's
    `transition-transform` slide, and the Back-to-home ghost button.
  - `ProfileSection.tsx`: the Save button, the sign-in link — and the Save
    **spinner**, a perpetual `animate-spin` that `transition-none` can't stop, got
    `motion-reduce:animate-none` (the one genuinely-new variant in the repo).
    Halting it is correct: the "Save" text + disabled/dimmed button convey "saving",
    and `SpinnerIcon` is a 3/4 ring that reads fine frozen.
  - **`PlayerAvatar` was already clean** — its only `style` is a static gradient,
    no transition/animation.
  Pure CSS-class slice — no logic/component/API touch, 1941 → 1941 tests. Verified
  via the shipped stylesheet: a production `vite build` emits both
  `motion-reduce:transition-none` and `motion-reduce:animate-none` inside `@media
  (prefers-reduced-motion: reduce)`, so the guards are live (not a dropped typo'd
  variant). A browser drive was judged low-value — the change is additive +
  reduced-motion-only (can't regress the default render) and the mechanism is
  browser-verified from P5-8.
- **App-wide glass reduced-motion pass — DONE 2026-07-27 (P5-10, D90).** The
  root cause P5-9 fixed only at three call sites, now fixed at the source. The
  shared `glass.ts` constants that carry a transition — `GLASS_HUD_BUTTON`,
  `GLASS_GHOST_BUTTON`, `GLASS_DIALOG_GHOST_BUTTON`, `GLASS_ACCENT_BUTTON`,
  `GLASS_NEUTRAL_BUTTON`, `GLASS_FILTER_TOGGLE` (all `transition-all` +
  `active:scale-95`) and `GLASS_INPUT` (`transition-colors`) — each got
  `motion-reduce:transition-none` appended, so EVERY glass control app-wide (auth,
  lobby HUD, filters, decks, dialogs, corner controls) respects reduced motion
  from the constant, not each call site. Under reduced motion the fade is off and
  the active-scale SNAPS rather than animating (the same behaviour `CoverDialog`'s
  `TILE_BASE` was browser-verified with in P5-8). **This reverses D88/D89's "patch
  at the call site" placement** — a blessed reversal (the P5-9 resume point named
  it), logged as D90; a header comment in `glass.ts` states the invariant so the
  next author appends the guard to any new transitional constant. **The four
  call-site guards adjacent to a glass constant became redundant and were dropped**
  (`CardDetailDialog` Retry, `Settings` Back-to-home, `CoverDialog` Done,
  `ProfileSection` Save); **every guard protecting an OWN non-constant transition
  was kept** (`Settings` font select + arrow-icon slide, `CoverDialog` `TILE_BASE`
  + close button, `CardDetailDialog` close button, `CardGrid` info button,
  `ProfileSection` sign-in link, and the Save spinner's `motion-reduce:animate-none`
  — a `transition-none` can't stop an `animate-spin`). Pure CSS-class slice — no
  logic/component/API/DB/schema touch; 1941 → 1941 tests (nothing new to
  unit-test: `motion-reduce:*` isn't observable in jsdom, className assertions are
  brittle). Verified via the shipped stylesheet — a production `vite build` emits
  `.motion-reduce\:transition-none{transition-property:none}` inside `@media
  (prefers-reduced-motion:reduce)` in the main `index-*.css` bundle where the glass
  buttons live. A browser drive was low-value: additive + reduced-motion-only
  (can't regress the default render), the mechanism is browser-verified from P5-8,
  and constant-vs-call-site placement is invisible in the compiled CSS (cascade is
  by stylesheet order, not class-attribute order). ~~**The reduced-motion story is
  now complete app-wide.**~~ **WRONG — see P5-11 below: it was complete for the
  glass constants only, and 66 class contexts app-wide were still unguarded.**
- **The HUD row buttons — DONE 2026-08-04 (P5-11, D214).** D213 flagged
  `ROW_BUTTON_BASE` as a local constant restated in `OnlineHud.tsx` carrying
  `transition-all` with no guard. The sweep that verified it found the finding
  UNDERSTATED twice over: **three** constants were restated byte for byte (BASE,
  ENABLED, DISABLED), plus **six more row strings inlined identically at the call
  sites of both HUDs** (attack row, energy picker, bench picker, prize tile,
  promote row, and the selected/unselected tints) — twelve duplicated strings in
  all. They now live in **`src/features/game/hudRows.ts`**, read by both HUDs
  (`OnlineHud` already imports `EnergyDots` from `features/game`), carrying the
  guard **in the constant** per D90's placement rather than D89's call sites.
  `lib/glass.ts` was rejected as the home: 33 importers vs. these two read sites,
  and the rows are not glass paint. Zero visual change for anyone who has not
  asked for reduced motion — every substitution is the same class set plus the
  guard. Verified against the SHIPPED stylesheet **with an attribution control**,
  since `glass.ts` already emitted `.motion-reduce\:transition-none` and its mere
  presence proves nothing: a build in which `hudRows.ts` alone used
  `motion-reduce:transition-[none]` emitted that rule inside `@media
  (prefers-reduced-motion:reduce)`, and a build with the variant typo'd emitted
  nothing at all. 677 → 682 tests. ~~**STILL OPEN: 54 unguarded class contexts
  remain across 26 files**~~ — **CLOSED by P5-12 below, and the number was 58,
  not 54.**
- **The rest of the reduced-motion sweep — DONE 2026-08-04 (P5-12, D217).** The
  54 D214 filed, plus **four it could not see**: D214's regex matched
  `transition-<property>` only, and Tailwind also has a BARE `transition`
  utility. Those four were in `DeckPanel` (a tooltip whose bare `transition`
  drives a `scale-95 → scale-100` hover animation — the most motion-y thing in
  the whole set), `Decks`, `FilterRail` and `Home`. **58 → 0.**
  **12 of the 58 were the same string written more than once**, so they became
  three constants in `lib/glass.ts` rather than twelve more copies of the guard:
  **`BACK_ARROW_ICON`** (the back/up arrow's hover slide — SEVEN read sites
  across five features, byte-identical at all of them), **`GHOST_ICON_BUTTON`**
  (the round ghost close/dismiss X — five read sites; size, `shrink-0` and
  `disabled:` states stay at the call site, which is all its readers disagreed
  about) and **`SOLID_PRIMARY_BUTTON`** (the solid-white primary — three read
  sites, one of which already had a comment calling it a copy of another).
  `glass.ts` is the right home HERE where D214 rightly refused it: D214's strings
  had two readers and a narrower module (`features/game`) that held both; these
  have seven / five / three across five / three / three features and no narrower
  module containing them. The other 46 are one-reader strings and just took the
  guard in place, per D90's rule. Every remaining duplicate-ish pair is named in
  the D217 commit message with the reason it was left alone.
  **`transition-[z-index]` (CardGrid, DeckPanel) IS guarded**, deliberately: it
  is not motion, but D90's invariant is "an instant state change", and a
  z-index that flips 75ms late is a delayed one. Guarding costs nothing (no
  pixel moves either way, and `useTiltJuice` has already disabled that card's
  tilt for the same user) and keeps the rule mechanical — "every `transition-*`
  carries the guard" — with no property allowlist for the next author to
  misjudge.
  **THE SWEEP IS NOW COMMITTED**, as `src/lib/reducedMotionSweep.test.ts` — D214's
  was a throwaway script, so its numbers could not be re-derived by anyone. It
  runs in `bun run check`, so the NEXT unguarded transition fails CI instead of
  waiting for a fourth audit. 682 → 692 tests.
  ⚠️ **AND THE SHIPPED-STYLESHEET CHECK IS WORSE THAN D214 THOUGHT.** D214
  identified `glass.ts` as the confound. The real confound is **this file**:
  Tailwind v4's automatic content detection scans the repo's MARKDOWN, so the
  prose in `polish.md` / `decisions.md` / `progress.md` that *describes*
  `motion-reduce:transition-none` is enough to emit the rule. Proved twice: a
  build with **every** `src/**` file's variant typo'd still shipped
  `.motion-reduce\:transition-none`, and a marker class placed only inside an
  HTML comment in this file was emitted into `dist`. So the only sound form of
  the check is a **unique marker**: 22/22 files carrying a literal guard were
  attributed individually via a per-file `motion-reduce:transition-[fxN]`, and
  the same marker behind a typo'd variant emitted nothing. **A future slice
  should look at narrowing Tailwind's `@source` — the docs are inflating the
  shipped CSS with classes no element uses.**
- **Uploaded avatars (still open — USER-gated).** Same as the item above:
  upload/choose an avatar → stored in R2, served from our domain, CSP updated. The
  settings surface exists (Profile section); what's left is the R2 + CSP +
  **moderation** half — moderation is an unresolved product call, so this needs
  the user before it can be built.

**P5-11 (D214) reopened autonomous P5 work that P5-10 had declared finished;
P5-12 (D217) finished it, and this time the claim is a command** — `bun run
check` runs `src/lib/reducedMotionSweep.test.ts`, which fails on the next
unguarded transition. Do NOT re-declare it "complete" in prose; the test is the
statement. **Three adjacent gaps it deliberately does not cover, all real:**
1. **`animate-*` needs `motion-reduce:animate-none`, not `transition-none`** —
   D89 guarded exactly one spinner (`ProfileSection`); **15 `animate-spin` /
   `animate-pulse` sites app-wide are still unguarded** (`StatusPanel`,
   `AccountButton`, `AuthPage` ×2, `Decks` ×2, `PlayerPanel` ×2, `LobbyRoom` ×2,
   `OnlineHub` ×2, `CardGrid`, `DeckPanel`, `StartCountdown`). Two more already
   use the `motion-safe:` form and are correct. This is the same shape of slice
   as P5-12 and the sweep test is one regex away from measuring it.
2. **JS-set transitions are invisible to any class sweep** —
   `components/useTiltJuice.ts`'s `TILT_STYLE` sets
   `transition: "transform 140ms …"` as an inline style, so the card hover
   scale still animates for a reduced-motion user even though the hook honours
   the query for the tilt and juice. The other JS motion sources
   (`glowRenderer`, `CardSheen`, `useFlip`, `AnimatedCardsLayer`) DO check
   `matchMedia` — this one is the outlier.
3. **Tailwind scans the docs** (see P5-12) — the shipped CSS carries classes
   that exist only in these write-ups.

The two long-standing items (uploaded avatars, the remote P4 deploy) are
still USER-gated. The P3 simulator M5 card-effect backlog
(`docs/reference/coverage-backlog.md`, `workstreams/simulator.md`) is still the
deepest alternative.

Pull items into an active phase as they become relevant; don't build them ahead
of the data they need.
