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
  /** ISO datetime — the api serializes the epoch-ms DB column at the boundary. */
  createdAt: z.iso.datetime(),
});
export type User = z.infer<typeof userSchema>;
