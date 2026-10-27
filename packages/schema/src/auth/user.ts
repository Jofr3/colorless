// The public account shape (backend-data.md §3.5/§6) — what the /auth routes
// return and the web app stores as "who am I". Deliberately NEVER carries a
// password or hash field: the DB row's `password_hash` is an apps/api
// implementation detail that must not enter the shared vocabulary.

import * as z from "zod";

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
  /** Whether the account signs in with a password, so deleting it asks for that password. Only
      the fact: the hash never leaves apps/api. */
  hasPassword: z.boolean(),
  /** Ask this user, once, to choose their public name: the account predates generated default
      handles, so its name may be its email's local part or its Google real name (security audit
      AU3). Saving a name, or keeping this one, through PATCH /auth/me clears it. Optional so a
      client reads a server from before the field as "do not ask"; a client from before it
      ignores it. */
  namePrompt: z.boolean().optional(),
  /** ISO datetime — the api serializes the epoch-ms DB column at the boundary. */
  createdAt: z.iso.datetime(),
});
export type User = z.infer<typeof userSchema>;
