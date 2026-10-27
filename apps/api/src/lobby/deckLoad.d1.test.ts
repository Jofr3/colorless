import type { Deck } from "@colorless/schema";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { sessionIdFromCookie } from "../auth/session";
import app from "../index";
import { seedCards, signedInUser, useTestD1 } from "../testing/d1";
import { type DeckOwner, loadPlayerDeck } from "./deckLoad";

const d1 = useTestD1((db) =>
  seedCards(db, [
    { id: "sv01-004", name: "Charmander", category: "Pokemon", hp: 70, imageUrl: null },
    { id: "sv01-230", name: "Fire Energy", category: "Energy", imageUrl: null },
  ]),
);

async function createDeck(cookie: string, format: string | null): Promise<Deck> {
  const res = await app.request(
    "/decks",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: "Embers",
        tint: 22,
        format,
        cards: [
          { cardId: "sv01-004", count: 4 },
          { cardId: "sv01-230", count: 56 },
        ],
      }),
    },
    d1().env(),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as Deck;
}

/** The account and session a lobby socket holds after connecting with `user`'s cookie. */
async function ownerOf(user: { userId: string; cookie: string }): Promise<DeckOwner> {
  const sessionId = await sessionIdFromCookie(user.cookie);
  if (sessionId === null) throw new Error("no session in the cookie");
  return { userId: user.userId, sessionId };
}

const SESSION_ENDED = { ok: false, reason: "sign in again to play a saved deck" };

describe("loadPlayerDeck — a saved deck as the lobby plays it", () => {
  it("reads the owner's deck as flat ids together with the format it was built for", async () => {
    const ash = await signedInUser(d1().db, "ash@example.com");
    const db = drizzle(d1().db);
    for (const format of ["expanded", null]) {
      const deck = await createDeck(ash.cookie, format);
      const loaded = await loadPlayerDeck(db, deck.id, await ownerOf(ash));
      if (!loaded.ok) throw new Error(loaded.reason);
      expect(loaded.format).toBe(format);
      expect(loaded.ids).toHaveLength(60);
      expect(loaded.ids.filter((id) => id === "sv01-004")).toHaveLength(4);
    }
  });

  it("reads the owner's deck with no cards as empty, not as missing", async () => {
    const ash = await signedInUser(d1().db, "ash@example.com");
    const deck = await createDeck(ash.cookie, "standard");
    await d1().db.prepare("DELETE FROM deck_cards").run();
    expect(await loadPlayerDeck(drizzle(d1().db), deck.id, await ownerOf(ash))).toEqual({
      ok: true,
      ids: [],
      format: "standard",
    });
  });

  it("reads another account's deck as not found", async () => {
    const ash = await signedInUser(d1().db, "ash@example.com");
    const bo = await signedInUser(d1().db, "bo@example.com");
    const deck = await createDeck(ash.cookie, "standard");
    expect(await loadPlayerDeck(drizzle(d1().db), deck.id, await ownerOf(bo))).toEqual({
      ok: false,
      reason: "deck not found",
    });
  });

  it("reads nothing once the socket's session has expired or been deleted", async () => {
    const ash = await signedInUser(d1().db, "ash@example.com");
    const deck = await createDeck(ash.cookie, "standard");
    const db = drizzle(d1().db);
    const owner = await ownerOf(ash);
    const now = Date.now();
    await d1().db.prepare("UPDATE sessions SET expires_at = ?").bind(now).run();
    expect(await loadPlayerDeck(db, deck.id, owner, now)).toEqual(SESSION_ENDED);
    expect((await loadPlayerDeck(db, deck.id, owner, now - 1)).ok).toBe(true);
    await d1().db.prepare("DELETE FROM sessions").run();
    expect(await loadPlayerDeck(db, deck.id, owner, now - 1)).toEqual(SESSION_ENDED);
  });

  it("refuses the deck's owner presenting another account's live session", async () => {
    const ash = await signedInUser(d1().db, "ash@example.com");
    const bo = await signedInUser(d1().db, "bo@example.com");
    const deck = await createDeck(ash.cookie, "standard");
    const borrowed = { userId: ash.userId, sessionId: (await ownerOf(bo)).sessionId };
    expect(await loadPlayerDeck(drizzle(d1().db), deck.id, borrowed)).toEqual(SESSION_ENDED);
  });
});
