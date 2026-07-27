// Auth request bodies (backend-data.md §3.5/§6) — parsed by the api's
// zValidator at the boundary and reusable by the web app's forms.

import { z } from "zod";

/** Emails are normalized to lowercase AT the boundary: `users.email` is
    UNIQUE and every lookup is exact, so one canonical casing everywhere. */
const emailField = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());

/** Password policy lives on REGISTER only (min 8); login accepts anything
    non-empty so a policy change never locks out existing accounts. The max
    is a DoS guard — every char feeds PBKDF2. */
const newPasswordField = z.string().min(8).max(256);

export const registerRequestSchema = z.object({
  email: emailField,
  password: newPasswordField,
  displayName: z.string().trim().min(1).max(64).optional(),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailField,
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Editing your own profile (P5-5). Same 1–64 bounds as register's optional
    name, but REQUIRED here: register may omit it and get the email's local
    part, while explicitly saving a blank one would only cost you your name —
    the lobby would fall back to a generated "Player 4271" handle (P5-1). */
export const updateProfileRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(64),
  /** Your favourite deck (P5-7): one of your OWN decks — the api 400s an id
      that isn't yours — or null to clear it. ABSENT (undefined) leaves it
      unchanged, so a name-only save need not carry it, and older clients keep
      working. */
  favouriteDeckId: z.string().nullable().optional(),
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
