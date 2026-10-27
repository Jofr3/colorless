import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { sessionIdFromCookie } from "../auth/session";
import { signedInUser, useTestD1 } from "../testing/d1";
import type { DeckOwner } from "./deckLoad";
import { liveSessionIds } from "./sessionCheck";

const d1 = useTestD1();

/** The account and session a lobby socket holds after connecting with `user`'s cookie. */
async function ownerOf(user: { userId: string; cookie: string }): Promise<DeckOwner> {
  const sessionId = await sessionIdFromCookie(user.cookie);
  if (sessionId === null) throw new Error("no session in the cookie");
  return { userId: user.userId, sessionId };
}

describe("liveSessionIds — the rematch's session re-check (MI4)", () => {
  it("keeps live sessions and drops a revoked one, an expired one and a deleted account's", async () => {
    const ash = await ownerOf(await signedInUser(d1().db, "ash@example.com"));
    const bo = await ownerOf(await signedInUser(d1().db, "bo@example.com"));
    const db = drizzle(d1().db);
    const now = Date.now();
    expect(await liveSessionIds(db, [ash, bo], now)).toEqual(
      new Set([ash.sessionId, bo.sessionId]),
    );

    await d1()
      .db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
      .bind(now, ash.sessionId)
      .run();
    expect(await liveSessionIds(db, [ash, bo], now)).toEqual(new Set([bo.sessionId]));
    expect(await liveSessionIds(db, [ash, bo], now - 1)).toEqual(
      new Set([ash.sessionId, bo.sessionId]),
    );

    await d1().db.prepare("DELETE FROM sessions WHERE id = ?").bind(ash.sessionId).run();
    expect(await liveSessionIds(db, [ash, bo], now - 1)).toEqual(new Set([bo.sessionId]));

    // Deleting the account deletes its sessions.
    await d1().db.prepare("DELETE FROM users WHERE id = ?").bind(bo.userId).run();
    expect(await liveSessionIds(db, [ash, bo], now - 1)).toEqual(new Set());
  });

  it("refuses a live session presented for another account", async () => {
    const ash = await ownerOf(await signedInUser(d1().db, "ash@example.com"));
    const bo = await ownerOf(await signedInUser(d1().db, "bo@example.com"));
    const borrowed = { userId: ash.userId, sessionId: bo.sessionId };
    expect(await liveSessionIds(drizzle(d1().db), [borrowed])).toEqual(new Set());
  });

  it("reads nothing for no owners", async () => {
    const db = drizzle(d1().db);
    db.select = () => {
      throw new Error("read D1");
    };
    expect(await liveSessionIds(db, [])).toEqual(new Set());
  });
});
