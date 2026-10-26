import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { signedInUser, useTestD1 } from "../testing/d1";
import { resolveAccountFromCookie } from "./resolveSession";

const d1 = useTestD1();

describe("resolveAccountFromCookie — the lobby socket's account", () => {
  it("reads the session's account with its display name", async () => {
    const ash = await signedInUser(d1().db, "ash@example.com");
    expect(await resolveAccountFromCookie(drizzle(d1().db), ash.cookie)).toEqual({
      userId: ash.userId,
      displayName: "ash",
    });
  });

  it("reads no cookie, an unknown session and an expired one as anonymous", async () => {
    const ash = await signedInUser(d1().db, "ash@example.com");
    const db = drizzle(d1().db);
    expect(await resolveAccountFromCookie(db, null)).toBeNull();
    expect(await resolveAccountFromCookie(db, "session=unknown")).toBeNull();
    await d1().db.prepare("UPDATE sessions SET expires_at = 1").run();
    expect(await resolveAccountFromCookie(db, ash.cookie)).toBeNull();
  });
});
