// The public account shape (backend-data.md §3.5/§6) — what the /auth routes
// return and the web app stores as "who am I". Deliberately NEVER carries a
// password or hash field: the DB row's `password_hash` is an apps/api
// implementation detail that must not enter the shared vocabulary.

import { z } from "zod";

export const userSchema = z.object({
  id: z.string(),
  email: z.email(),
  displayName: z.string(),
  emailVerified: z.boolean(),
  /** The account's generated-avatar token (P5-2), derived server-side from the
      id — the SAME value a lobby seat carries in `PlayerState.avatarSeed`, so
      the face a player sees on their own profile is the face opponents see.
      Sent rather than derived client-side on purpose: one hash, one place. */
  avatarSeed: z.string(),
  /** The account's chosen favourite deck (P5-7), or null. Just the deck's ID —
      NOT its name or cover: /settings resolves those from the caller's own
      GET /decks list, so a rename or a re-cover is never stale here. A non-null
      id always points at a real deck of the caller's — the DB column's
      ON DELETE SET NULL nulls it the moment that deck is deleted. */
  favouriteDeckId: z.string().nullable(),
  /** ISO datetime — the api serializes the epoch-ms DB column at the boundary. */
  createdAt: z.iso.datetime(),
});
export type User = z.infer<typeof userSchema>;
