import type { Deck } from "@colorless/schema";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import app from "../index";
import { seedCards, signedInUser, useTestD1 } from "../testing/d1";
import { loadPlayerDeck } from "./deckLoad";

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

describe("loadPlayerDeck — a saved deck as the lobby plays it", () => {
  it("reads the owner's deck as flat ids together with the format it was built for", async () => {
    const ash = await signedInUser(d1().db, "ash@example.com");
    const db = drizzle(d1().db);
    for (const format of ["expanded", null]) {
      const deck = await createDeck(ash.cookie, format);
      const loaded = await loadPlayerDeck(db, deck.id, ash.userId);
      if (!loaded.ok) throw new Error(loaded.reason);
      expect(loaded.format).toBe(format);
      expect(loaded.ids).toHaveLength(60);
      expect(loaded.ids.filter((id) => id === "sv01-004")).toHaveLength(4);
    }
  });

  it("reads another account's deck as not found", async () => {
    const ash = await signedInUser(d1().db, "ash@example.com");
    const bo = await signedInUser(d1().db, "bo@example.com");
    const deck = await createDeck(ash.cookie, "standard");
    expect(await loadPlayerDeck(drizzle(d1().db), deck.id, bo.userId)).toEqual({
      ok: false,
      reason: "deck not found",
    });
  });
});
