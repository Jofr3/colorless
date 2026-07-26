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
  **Still open: a favourite deck** on the profile, and the uploads below.
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
- **Card detail view:** richer card view using tcgdex fields (attacks, abilities,
  pricing, set/illustrator).
- **Settings & accessibility:** carry the existing `prefers-reduced-motion`
  respect through the new surfaces.

Pull items into an active phase as they become relevant; don't build them ahead
of the data they need.
