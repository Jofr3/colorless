import { and, eq } from "drizzle-orm";
import type { decks, folders } from "./users";

/** The row with this id, only if `userId` owns it: another user's row reads exactly like a missing
    one, so nothing about other accounts leaks. */
export function ownedBy(table: typeof decks | typeof folders, id: string, userId: string) {
  return and(eq(table.id, id), eq(table.userId, userId));
}
