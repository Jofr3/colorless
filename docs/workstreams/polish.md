# Workstream: Polish (Phase 5)

Refinements unlocked once real **user** and **card** data exist. Threads through
P2–P4; tracked here so nothing is forgotten.

## Backlog
- **Lobby identity:** real player names + profile pictures on the lobby and
  player panels (`src/features/online/components/PlayerPanel.tsx`). Today names
  are ad-hoc and there are no avatars.
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
