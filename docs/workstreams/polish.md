# Workstream: Polish (Phase 5)

Refinements unlocked once real **user** and **card** data exist. Threads through
P2–P4; tracked here so nothing is forgotten.

## Backlog
- **PASS FIXED 2026-07-26 (both HUDs); the underlying overlap REMAINS for the
  history arrows.** The turn panel now carries its own **`Pass`** button in its
  footer next to Retreat (`GameHud` TurnPanel + `OnlineHud` AttackPanel). It needs
  no disabled state: each panel renders exactly when `waitingOn === "you" &&
  turn:action`, which is precisely the `passDisabled === false` condition both
  GamePage and OnlineMatch compute. Named **"Pass"**, not "Pass turn" — the
  playmat's ⟶ owns that accessible name and two identically-named buttons would
  be ambiguous to a screen reader and to queries. Browser-verified: a REAL click
  (hit-tested, not a synthetic `.click()`) advances the turn, and the in-panel
  button hit-tests clickable at 1280×633/800/1000 where the playmat ⟶ does not.
  **Residual:** the ⟶ and the **Previous/Forward history arrows are still covered
  by the panel** (all three hit-test `false` while it is open) — passing is
  restored, but history navigation stays unreachable during your own turn:action
  (it works in every other phase). Fixing that still needs the layout decision
  below.
- **BUG (found in the 2026-07-26 browser run, affects BOTH /play and online):
  the Pass turn button is unclickable while the turn panel is open.** The
  playmat's `TurnControls` (`src/features/playmat/components/TurnHud.tsx` — the
  ⟶ pass control + the history arrows) is `absolute z-20` at `right: 24, top: 50%`;
  the turn-action panel — the local `GameHud` `HudPanel` AND the online
  `OnlineHud` AttackPanel, class-identical `absolute z-[75] bottom-[calc(var(--hand-h)+16px)]
  right-4 w-72` — covers that whole box. `document.elementFromPoint` at the pass
  button's centre returns an ATTACK/ABILITY ROW of the panel, so a real click
  lands on that row instead (the panel's translucent glass is why the arrow is
  still faintly visible underneath, which is what makes it look clickable).
  Verified BLOCKED at 1280×633/700/800/900 in both surfaces, and there is no
  keyboard fallback (no keydown handler anywhere in the playmat/GamePage). The
  panel only renders during YOUR `turn:action` — exactly when you would pass —
  so the control is effectively dead in normal play. **This is pre-existing, not
  a P4 regression:** it reproduces with the minimal local panel (attacks +
  trainers), so the panel does not need the 3b ability/trainer rows to swallow it.
  It was also mis-recorded in `.claude/skills/verify` as a browser-automation
  quirk ("agent-browser `click` on the Pass button silently no-op'd; the `.click()`
  eval worked") — the eval works precisely BECAUSE a synthetic `.click()` skips
  hit-testing. Fix is a layout call (move the controls clear of the panel's
  right-hand column, move the panel, or give the panel a max-height that stops
  short of the vertical centre) — worth deciding once for both HUDs.
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
- **Profiles:** a basic user profile (display name, avatar, maybe favourite
  deck) backed by the `users` table.
- **Avatars:** upload/choose an avatar → stored in R2, served from our domain;
  update CSP accordingly.
- **Deck covers / art:** use real card art for deck covers in the decks list
  (currently a generated tint gradient — see `src/features/decks/data.ts`).
- **Card detail view:** richer card view using tcgdex fields (attacks, abilities,
  pricing, set/illustrator).
- **Settings & accessibility:** carry the existing `prefers-reduced-motion`
  respect through the new surfaces.

Pull items into an active phase as they become relevant; don't build them ahead
of the data they need.
