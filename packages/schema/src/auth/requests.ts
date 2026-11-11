// Auth request bodies (backend-data.md §3.5/§6) — parsed by the api's
// zValidator at the boundary and reusable by the web app's forms.

import * as z from "zod";
import { collapseSpaces, DISPLAY_NAME_MAX, foldDisplayName } from "../displayName";
import { withoutControlChars } from "../text";

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

/** The account display name as register and PATCH /auth/me take it (displayName.ts has the
    rule; a lobby hello applies the same rule but strips instead of refusing). Other players see
    it, so a control or format character (text.ts) is refused. It is NFKC-folded and trimmed
    first, so a pasted trailing newline is not refused, then its whitespace runs collapse and it
    must be 1 to DISPLAY_NAME_MAX characters. The raw bound only caps the normalizing work. */
export const displayNameField = z
  .string()
  .max(DISPLAY_NAME_MAX * 4)
  .transform(foldDisplayName)
  .pipe(withoutControlChars(z.string().min(1)))
  .transform(collapseSpaces)
  .pipe(z.string().max(DISPLAY_NAME_MAX));

export const registerRequestSchema = z.object({
  email: emailField,
  password: newPasswordField,
  displayName: displayNameField.optional(),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailField,
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Editing your own profile. Same field as register's optional name, but REQUIRED here:
    register may omit it and get a generated handle ("Trainer-7K3Q"), while explicitly saving a
    blank one would only cost you your name. Saving also answers the one-time "choose your public
    name" prompt (`User.namePrompt`): sending the current name unchanged keeps it. */
export const updateProfileRequestSchema = z.object({
  displayName: displayNameField,
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

/** Deleting your own account (DELETE /auth/me). An account with a password must send it (same
    bounds as login). An OAuth-only account has none, so it must type its email instead, which the
    server compares trimmed and case-insensitively: a cookie alone never deletes an account. */
export const deleteAccountRequestSchema = z.object({
  password: z.string().min(1).max(256).optional(),
  confirmEmail: z.string().max(254).optional(),
});
export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;
