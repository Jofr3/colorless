// P5 — the lobby shows a player's REAL name (polish.md "Lobby identity"). Until
// now the name in a lobby was whatever the client announced in its `hello`: a
// "Player 4271" generated in localStorage, editable by anyone, and belonging to
// nobody. The account has had a `displayName` since P1; this resolves it.
//
// It is the SECOND thing the lobby's one authenticated fact (the socket's
// `userId`, from the /ws session cookie) is used for — the first being the
// owner-scoped deck read at the match handoff (deckLoad.ts). Resolving the name
// server-side rather than trusting the frame also means a player cannot announce
// themselves as someone else, which matters the moment names stop being random.
//
// The pure `lobbyDisplayName` is unit-tested; `loadDisplayName` is the query half
// (D1, so untested here — the `loadPlayerDeck` / `loadCardPool` pattern).

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
