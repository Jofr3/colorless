// Re-checks the sessions seated lobby sockets authenticated with at their upgrade. A socket keeps
// the account its cookie resolved to for as long as it stays open, so a logout, a revoked session
// or a deleted account would otherwise keep its seat playing. The DO asks once per rematch, never
// per frame; the match handoff re-checks each deck's session in its own read (deckLoad.ts).

import { and, gt, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { sessions } from "../db/schema";
import type { DeckOwner } from "./deckLoad";

/** The ids of the `owners`' sessions that still live and still belong to their account. Deleting
    an account deletes its sessions (cascade), so a deleted account's session reads as ended. One
    primary-key read of at most a few rows; no read at all for no owners. */
export async function liveSessionIds(
  db: DrizzleD1Database,
  owners: readonly DeckOwner[],
  now: number = Date.now(),
): Promise<Set<string>> {
  if (owners.length === 0) return new Set();
  const rows = await db
    .select({ id: sessions.id, userId: sessions.userId })
    .from(sessions)
    .where(
      and(
        inArray(
          sessions.id,
          owners.map((owner) => owner.sessionId),
        ),
        gt(sessions.expiresAt, new Date(now)),
      ),
    )
    .all();
  const live = new Set<string>();
  for (const owner of owners) {
    if (rows.some((row) => row.id === owner.sessionId && row.userId === owner.userId)) {
      live.add(owner.sessionId);
    }
  }
  return live;
}
