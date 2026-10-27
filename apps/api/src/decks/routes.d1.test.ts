import { type Deck, type DeckCard, type DeckSummary, MAX_DECKS_PER_USER } from "@colorless/schema";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../index";
import {
  raceBeforeBatch,
  raceBeforeFirstBatch,
  type SignedIn,
  seedCards,
  signedInUser,
  useTestD1,
} from "../testing/d1";

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

describe("PATCH /decks/:id against a concurrent write", () => {
  /** A PATCH whose write lands just after `winner` commits, as another tab's save would. */
  function racedPatch(id: string, body: unknown, winner: (db: D1Database) => Promise<unknown>) {
    const { db } = d1();
    return app.request(
      `/decks/${id}`,
      jsonInit("PATCH", body, ash.cookie),
      d1().env({ DB: raceBeforeFirstBatch(db, () => winner(db).then(() => {})) }),
    );
  }

  it("writes only the fields the request names and answers with the stored row", async () => {
    const deck = await createDeck("Charizard", [card("sv01-004", 4), card("sv01-006", 2)]);
    const res = await racedPatch(deck.id, { name: "Zard" }, (db) =>
      db
        .prepare(
          "UPDATE decks SET tint = 5, format = 'expanded', cover_card_id = 'sv01-006' WHERE id = ?",
        )
        .bind(deck.id)
        .run(),
    );
    expect(res.status).toBe(200);
    const expected = { name: "Zard", tint: 5, format: "expanded", chosenCoverCardId: "sv01-006" };
    expect(await res.json()).toMatchObject(expected);
    expect(await getDeck(deck.id)).toMatchObject(expected);
  });

  it("does not write a deck that stopped being the caller's", async () => {
    const gary = await signedInUser(d1().db, "gary@example.com");
    const deck = await createDeck("Charizard", [card("sv01-004", 4)]);
    const res = await racedPatch(deck.id, { name: "Stolen" }, (db) =>
      db.prepare("UPDATE decks SET user_id = ? WHERE id = ?").bind(gary.userId, deck.id).run(),
    );
    expect(res.status).toBe(404);
    const row = await d1()
      .db.prepare("SELECT name FROM decks WHERE id = ?")
      .bind(deck.id)
      .first<{ name: string }>();
    expect(row?.name).toBe("Charizard");
  });
});

describe("PATCH /decks/:id versions", () => {
  const storedCards = (id: string) =>
    d1()
      .db.prepare("SELECT card_id AS cardId, count FROM deck_cards WHERE deck_id = ? ORDER BY 1")
      .bind(id)
      .all<DeckCard>()
      .then((result) => result.results);

  it("moves the version on every write, versioned or not, and serves it", async () => {
    const deck = await createDeck("Fire", [card("sv01-004", 4)]);
    expect(deck.version).toBe(0);
    const renamed = await patchDeck(deck.id, { name: "Blaze", version: 0 });
    expect(await renamed.json()).toMatchObject({ name: "Blaze", version: 1 });
    const swapped = await patchDeck(deck.id, { cards: [card("sv01-006", 2)] });
    expect(await swapped.json()).toMatchObject({ cards: [card("sv01-006", 2)], version: 2 });
    expect((await getDeck(deck.id)).version).toBe(2);
    expect((await listDecks())[0]?.version).toBe(2);
  });

  it("refuses a save from a stale version with the current deck, and writes nothing", async () => {
    const deck = await createDeck("Fire", [card("sv01-004", 4)]);
    expect((await patchDeck(deck.id, { cards: [card("sv01-006", 2)], version: 0 })).status).toBe(
      200,
    );
    const counting = countingBatchWrites(d1().db);
    const res = await app.request(
      `/decks/${deck.id}`,
      jsonInit("PATCH", { name: "Stale", cards: [card("sv01-007", 1)], version: 0 }, ash.cookie),
      d1().env({ DB: counting.db }),
    );
    expect(res.status).toBe(409);
    const current = await getDeck(deck.id);
    expect(await res.json()).toEqual({ error: "deck changed since this version", deck: current });
    expect(current).toMatchObject({ name: "Fire", cards: [card("sv01-006", 2)], version: 1 });
    expect(counting.written()).toBe(0);
  });

  it("lets a save without a version win over a newer one", async () => {
    const deck = await createDeck("Fire", [card("sv01-004", 4)]);
    await patchDeck(deck.id, { name: "Blaze", version: 0 });
    const res = await patchDeck(deck.id, { name: "Old tab", cards: [card("sv01-007", 1)] });
    expect(res.status).toBe(200);
    expect(await getDeck(deck.id)).toMatchObject({
      name: "Old tab",
      cards: [card("sv01-007", 1)],
      version: 2,
    });
  });

  it("refuses a versioned save that another tab beat to the write, card list included", async () => {
    const deck = await createDeck("Fire", [card("sv01-004", 4), card("sv01-006", 2)]);
    // The other tab's save lands between this one's reads (a batch, since it names cards) and its
    // write, and takes the deck to exactly the version this save would have written.
    const otherTab = async () => {
      const res = await patchDeck(deck.id, { name: "Theirs", cards: [card("sv01-191", 4)] });
      expect(res.status).toBe(200);
    };
    const res = await app.request(
      `/decks/${deck.id}`,
      jsonInit("PATCH", { name: "Mine", cards: [card("sv01-007", 1)], version: 0 }, ash.cookie),
      d1().env({ DB: raceBeforeBatch(d1().db, 1, otherTab) }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ deck: { name: "Theirs", version: 1 } });
    expect(await storedCards(deck.id)).toEqual([card("sv01-191", 4)]);
  });

  it("refuses a versioned rename that another tab beat to the write", async () => {
    const deck = await createDeck("Fire", [card("sv01-004", 4)]);
    const res = await app.request(
      `/decks/${deck.id}`,
      jsonInit("PATCH", { name: "Mine", version: 0 }, ash.cookie),
      d1().env({
        DB: raceBeforeFirstBatch(d1().db, async () => {
          expect((await patchDeck(deck.id, { tint: 5 })).status).toBe(200);
        }),
      }),
    );
    expect(res.status).toBe(409);
    expect(await getDeck(deck.id)).toMatchObject({ name: "Fire", tint: 5, version: 1 });
  });

  it("writes no cards into a deck that stopped being the caller's", async () => {
    const gary = await signedInUser(d1().db, "gary@example.com");
    const deck = await createDeck("Charizard", [card("sv01-004", 4)]);
    const res = await app.request(
      `/decks/${deck.id}`,
      jsonInit("PATCH", { cards: [card("sv01-007", 1)] }, ash.cookie),
      d1().env({
        DB: raceBeforeBatch(d1().db, 1, async () => {
          await d1()
            .db.prepare("UPDATE decks SET user_id = ? WHERE id = ?")
            .bind(gary.userId, deck.id)
            .run();
        }),
      }),
    );
    expect(res.status).toBe(404);
    expect(await storedCards(deck.id)).toEqual([card("sv01-004", 4)]);
  });
});

describe("POST /decks cap", () => {
  it(`refuses a deck past ${MAX_DECKS_PER_USER} and takes one again after a delete`, async () => {
    const { db } = d1();
    await db
      .prepare(
        `INSERT INTO decks (id, user_id, name, tint, position, updated)
          WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
          SELECT 'bulk-' || i, ?, 'Deck ' || i, 0, i, 0 FROM n`,
      )
      .bind(MAX_DECKS_PER_USER, ash.userId)
      .run();
    const full = await app.request(
      "/decks",
      jsonInit("POST", { name: "One more", tint: 22 }, ash.cookie),
      d1().env(),
    );
    expect(full.status).toBe(409);
    expect(await full.json()).toEqual({ error: "deck limit reached", limit: MAX_DECKS_PER_USER });
    const deleted = await app.request(
      "/decks/bulk-1",
      { method: "DELETE", headers: { Cookie: ash.cookie } },
      d1().env(),
    );
    expect(deleted.status).toBe(204);
    await createDeck("One more", []);
    // The cap is per account.
    await createDeck("Gary's", [], await signedInUser(db, "gary@example.com"));
  });
});

/** `db`, plus the rows its batches have written so far. */
function countingBatchWrites(db: D1Database) {
  let written = 0;
  const counted = new Proxy(db, {
    get(target, property) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          const results = await target.batch(statements);
          for (const result of results) written += result.meta.rows_written;
          return results;
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db: counted, written: () => written };
}

describe("deck card lists", () => {
  it("replaces the list: dropped cards go, new cards come, changed counts change", async () => {
    const deck = await createDeck("Fire", [
      card("sv01-004", 4),
      card("sv01-006", 2),
      card("sv01-230", 10),
    ]);
    const res = await patchDeck(deck.id, {
      cards: [card("sv01-230", 12), card("sv01-007", 2), card("sv01-004", 4)],
    });
    expect(res.status).toBe(200);
    expect((await getDeck(deck.id)).cards).toEqual([
      card("sv01-004", 4),
      card("sv01-007", 2),
      card("sv01-230", 12),
    ]);
    expect((await patchDeck(deck.id, { cards: [] })).status).toBe(200);
    expect((await getDeck(deck.id)).cards).toEqual([]);
  });

  it("writes one card row beyond the deck row when one count changes", async () => {
    const entries = [
      card("sv01-004", 4),
      card("sv01-006", 2),
      card("sv01-007", 2),
      card("sv01-016", 3),
      card("sv01-191", 4),
      card("sv01-230", 10),
    ];
    const changed = [...entries.slice(0, 5), card("sv01-230", 11)];
    const deck = await createDeck("Fire", entries);
    const writesOf = async (body: unknown) => {
      const counting = countingBatchWrites(d1().db);
      const res = await app.request(
        `/decks/${deck.id}`,
        jsonInit("PATCH", body, ash.cookie),
        d1().env({ DB: counting.db }),
      );
      expect(res.status).toBe(200);
      return counting.written();
    };
    const rename = await writesOf({ name: "Renamed" });
    expect(await writesOf({ cards: changed })).toBe(rename + 1);
    expect(await writesOf({ cards: changed })).toBe(rename);
    expect((await getDeck(deck.id)).cards).toEqual(changed);
  });

  it("refuses unknown cards on create and patch without writing", async () => {
    const created = await app.request(
      "/decks",
      jsonInit("POST", { name: "Bad", tint: 22, cards: [card("sv99-001", 1)] }, ash.cookie),
      d1().env(),
    );
    expect(created.status).toBe(400);
    expect(await created.json()).toEqual({ error: "unknown card id(s)", cardIds: ["sv99-001"] });
    expect(await listDecks()).toEqual([]);

    const deck = await createDeck("Fire", [card("sv01-004", 4)]);
    const res = await patchDeck(deck.id, {
      name: "Renamed",
      cards: [card("sv01-004", 4), card("sv99-001", 1)],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown card id(s)", cardIds: ["sv99-001"] });
    expect(await getDeck(deck.id)).toMatchObject({ name: "Fire", cards: [card("sv01-004", 4)] });
  });

  it("answers 404 before judging the cards of another account's deck", async () => {
    const gary = await signedInUser(d1().db, "gary@example.com");
    const deck = await createDeck("Gary's", [card("sv01-004", 4)], gary);
    const res = await patchDeck(deck.id, { cards: [card("sv99-001", 1)] });
    expect(res.status).toBe(404);
  });

  it("puts each new deck first", async () => {
    const first = await createDeck("First", []);
    const second = await createDeck("Second", []);
    expect(second.position).toBe(first.position - 1);
    expect((await listDecks()).map((deck) => deck.name)).toEqual(["Second", "First"]);
  });
});
