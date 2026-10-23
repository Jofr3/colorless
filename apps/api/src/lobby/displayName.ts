// Resolves a lobby seat's name from the account rather than trusting the hello frame, so a player
// cannot present as someone else.

import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { users } from "../db/schema";

type Db = DrizzleD1Database;

/** An account's stored display name as a lobby should use it: trimmed, or null
    when there is nothing usable.

    Null rather than a fallback, because the ONE fallback that suggests itself
    here — the email, which `AccountButton` uses — must never be taken: that
    control shows a user their OWN address, while a lobby name is broadcast to
    the opponent (and to spectators since P4 3c-vii). A blank name is a cosmetic
    problem; a published email address is not. The caller falls back to the
    client-announced handle instead. Pure. */
export function lobbyDisplayName(stored: string | null | undefined): string | null {
  const trimmed = (stored ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/** The display name of the account a socket authenticated as, or null for an
    anonymous socket (and for an account whose name is blank). Never throws on a
    missing row — a session pointing at a deleted user reads the same as no
    session, and the lobby simply keeps the announced handle. */
export async function loadDisplayName(db: Db, userId: string | null): Promise<string | null> {
  if (userId === null) return null;
  const row = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return lobbyDisplayName(row?.displayName);
}
