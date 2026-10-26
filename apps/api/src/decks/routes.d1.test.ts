import type { Deck, DeckCard, DeckSummary } from "@colorless/schema";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../index";
import { type SignedIn, seedCards, signedInUser, useTestD1 } from "../testing/d1";

const SCAN = "https://assets.tcgdex.net/en/sv/sv01/x";

const d1 = useTestD1((db) =>
  seedCards(db, [
    { id: "sv01-004", name: "Charmander", category: "Pokemon", hp: 70, imageUrl: SCAN },
    { id: "sv01-006", name: "Charizard ex", category: "Pokemon", hp: 330, imageUrl: SCAN },
    { id: "sv01-007", name: "Arcanine ex", category: "Pokemon", hp: 330, imageUrl: SCAN },
    { id: "sv01-016", name: "Pidgey", category: "Pokemon", hp: 60, imageUrl: null },
    { id: "sv01-191", name: "Rare Candy", category: "Trainer", imageUrl: SCAN },
    { id: "sv01-230", name: "Fire Energy", category: "Energy", imageUrl: SCAN },
  ]),
);

let ash: SignedIn;

beforeEach(async () => {
  ash = await signedInUser(d1().db, "ash@example.com");
});

function jsonInit(method: "POST" | "PATCH", body: unknown, cookie: string) {
  return {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  };
}

async function createDeck(name: string, cards: DeckCard[], who: SignedIn = ash): Promise<Deck> {
  const res = await app.request(
    "/decks",
    jsonInit("POST", { name, tint: 22, cards }, who.cookie),
    d1().env(),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as Deck;
}

function patchDeck(id: string, body: unknown, who: SignedIn = ash) {
  return app.request(`/decks/${id}`, jsonInit("PATCH", body, who.cookie), d1().env());
}

async function getDeck(id: string): Promise<Deck> {
  const res = await app.request(`/decks/${id}`, { headers: { Cookie: ash.cookie } }, d1().env());
  expect(res.status).toBe(200);
  return (await res.json()) as Deck;
}

async function listDecks(who: SignedIn = ash): Promise<DeckSummary[]> {
  const res = await app.request("/decks", { headers: { Cookie: who.cookie } }, d1().env());
  expect(res.status).toBe(200);
  return (await res.json()) as DeckSummary[];
}

async function coversByName(who: SignedIn = ash) {
  return Object.fromEntries(
    (await listDecks(who)).map((deck) => [
      deck.name,
      { cardCount: deck.cardCount, coverCardId: deck.coverCardId },
    ]),
  );
}

const card = (cardId: string, count: number): DeckCard => ({ cardId, count });

describe("PATCH /decks/:id cover pin", () => {
  it("pins a card the deck runs, and null goes back to automatic", async () => {
    const deck = await createDeck("Charizard", [card("sv01-004", 4), card("sv01-006", 2)]);
    const pinned = await patchDeck(deck.id, { chosenCoverCardId: "sv01-004" });
    expect(pinned.status).toBe(200);
    expect(((await pinned.json()) as Deck).chosenCoverCardId).toBe("sv01-004");
    expect((await getDeck(deck.id)).chosenCoverCardId).toBe("sv01-004");

    expect((await patchDeck(deck.id, { chosenCoverCardId: null })).status).toBe(200);
    expect((await getDeck(deck.id)).chosenCoverCardId).toBeNull();
  });

  it("rejects a pin on a card the deck does not run and leaves the deck untouched", async () => {
    const deck = await createDeck("Charizard", [card("sv01-004", 4)]);
    for (const chosenCoverCardId of ["sv01-006", "sv99-001"]) {
      const res = await patchDeck(deck.id, { name: "Renamed", chosenCoverCardId });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "cover card not in deck",
        cardIds: [chosenCoverCardId],
      });
    }
    expect(await getDeck(deck.id)).toMatchObject({ name: "Charizard", chosenCoverCardId: null });
  });

  it("checks the pin against the card list the same patch leaves behind", async () => {
    const deck = await createDeck("Charizard", [card("sv01-004", 4)]);
    const removed = await patchDeck(deck.id, {
      cards: [card("sv01-006", 2)],
      chosenCoverCardId: "sv01-004",
    });
    expect(removed.status).toBe(400);
    expect((await getDeck(deck.id)).cards).toEqual([card("sv01-004", 4)]);

    const added = await patchDeck(deck.id, {
      cards: [card("sv01-004", 4), card("sv01-006", 2)],
      chosenCoverCardId: "sv01-006",
    });
    expect(added.status).toBe(200);
    expect(await getDeck(deck.id)).toMatchObject({
      chosenCoverCardId: "sv01-006",
      cards: [card("sv01-004", 4), card("sv01-006", 2)],
    });
  });

  it("keeps the pin through a rename and a card swap that still runs the pinned card", async () => {
    const deck = await createDeck("Charizard", [card("sv01-004", 4), card("sv01-006", 2)]);
    await patchDeck(deck.id, { chosenCoverCardId: "sv01-006" });
    expect((await patchDeck(deck.id, { name: "Zard" })).status).toBe(200);
    expect((await patchDeck(deck.id, { cards: [card("sv01-006", 3)] })).status).toBe(200);
    expect(await getDeck(deck.id)).toMatchObject({
      name: "Zard",
      chosenCoverCardId: "sv01-006",
      cards: [card("sv01-006", 3)],
    });
  });

  it("drops the pin when a card swap removes the pinned card", async () => {
    const deck = await createDeck("Charizard", [card("sv01-004", 4), card("sv01-006", 2)]);
    await patchDeck(deck.id, { chosenCoverCardId: "sv01-006" });
    const res = await patchDeck(deck.id, { cards: [card("sv01-004", 4)] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Deck).chosenCoverCardId).toBeNull();
    expect((await getDeck(deck.id)).chosenCoverCardId).toBeNull();
  });

  it("404s a pin on another account's deck", async () => {
    const gary = await signedInUser(d1().db, "gary@example.com");
    const deck = await createDeck("Gary's", [card("sv01-004", 4)], gary);
    const res = await patchDeck(deck.id, { chosenCoverCardId: "sv01-004" });
    expect(res.status).toBe(404);
  });
});

describe("GET /decks cover aggregation", () => {
  it("derives each deck's face from its own cards", async () => {
    await createDeck("Charizard", [card("sv01-004", 4), card("sv01-006", 2), card("sv01-191", 4)]);
    await createDeck("Tie on HP", [card("sv01-006", 1), card("sv01-007", 2)]);
    await createDeck("Even tie", [card("sv01-007", 2), card("sv01-006", 2)]);
    await createDeck("Scanless", [card("sv01-016", 4), card("sv01-004", 1)]);
    await createDeck("No Pokemon", [card("sv01-191", 4), card("sv01-230", 10)]);
    await createDeck("Empty", []);
    expect(await coversByName()).toEqual({
      Charizard: { cardCount: 10, coverCardId: "sv01-006" },
      "Tie on HP": { cardCount: 3, coverCardId: "sv01-007" },
      "Even tie": { cardCount: 4, coverCardId: "sv01-006" },
      Scanless: { cardCount: 5, coverCardId: "sv01-004" },
      "No Pokemon": { cardCount: 14, coverCardId: null },
      Empty: { cardCount: 0, coverCardId: null },
    });
  });

  it("draws a pinned Trainer, but not a pinned card without a scan", async () => {
    const trainer = await createDeck("Candy", [card("sv01-004", 4), card("sv01-191", 4)]);
    const scanless = await createDeck("Pidgey", [card("sv01-016", 4), card("sv01-004", 1)]);
    await patchDeck(trainer.id, { chosenCoverCardId: "sv01-191" });
    await patchDeck(scanless.id, { chosenCoverCardId: "sv01-016" });
    expect(await coversByName()).toEqual({
      Candy: { cardCount: 8, coverCardId: "sv01-191" },
      Pidgey: { cardCount: 5, coverCardId: "sv01-004" },
    });
  });

  it("aggregates only the caller's decks", async () => {
    const gary = await signedInUser(d1().db, "gary@example.com");
    await createDeck("Gary's", [card("sv01-006", 4)], gary);
    await createDeck("Ash's", [card("sv01-004", 2)]);
    expect(await coversByName()).toEqual({ "Ash's": { cardCount: 2, coverCardId: "sv01-004" } });
    expect(await coversByName(gary)).toEqual({
      "Gary's": { cardCount: 4, coverCardId: "sv01-006" },
    });
  });
});

describe("folderId on the deck routes", () => {
  it("creates at the library root, and null moves a filed deck back to it", async () => {
    const res = await app.request(
      "/decks",
      jsonInit("POST", { name: "Root", tint: 22, folderId: null }, ash.cookie),
      d1().env(),
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as Deck).folderId).toBeNull();

    const filed = await createDeck("Filed", []);
    await d1()
      .db.prepare("INSERT INTO folders (id, user_id, name) VALUES ('f1', ?, 'Standard')")
      .bind(ash.userId)
      .run();
    await d1().db.prepare("UPDATE decks SET folder_id = 'f1' WHERE id = ?").bind(filed.id).run();
    expect((await getDeck(filed.id)).folderId).toBe("f1");

    const renamed = await patchDeck(filed.id, { name: "Still filed" });
    expect(((await renamed.json()) as Deck).folderId).toBe("f1");
    const moved = await patchDeck(filed.id, { folderId: null });
    expect(moved.status).toBe(200);
    expect((await getDeck(filed.id)).folderId).toBeNull();
  });
});
