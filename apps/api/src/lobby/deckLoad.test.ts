import { describe, expect, it } from "vitest";
import { deckIdsFromRows, loadPlayerDeck } from "./deckLoad";

// The pure fold from compressed (cardId, count) deck rows into the flat 60-id
// list the engine wants, plus loadPlayerDeck's AUTH guards (which short-circuit
// before any query). The owner-scoped D1 read itself is untested here, the
// `loadCardPool` pattern.

/** A db that throws if any method is touched — proves the guards below never
    reach a query. */
const NO_DB = new Proxy(
  {},
  {
    get() {
      throw new Error("db must not be queried");
    },
  },
) as unknown as Parameters<typeof loadPlayerDeck>[0];

describe("deckIdsFromRows", () => {
  it("repeats each card id by its count, preserving row order", () => {
    expect(
      deckIdsFromRows([
        { cardId: "a", count: 2 },
        { cardId: "b", count: 1 },
        { cardId: "c", count: 3 },
      ]),
    ).toEqual(["a", "a", "b", "c", "c", "c"]);
  });

  it("expands a real 60-card deck to 60 ids", () => {
    const rows = [
      { cardId: "sv06.5-013", count: 24 },
      { cardId: "sve-003", count: 36 },
    ];
    const ids = deckIdsFromRows(rows);
    expect(ids).toHaveLength(60);
    expect(ids.filter((id) => id === "sve-003")).toHaveLength(36);
  });

  it("is empty for no rows, and drops a zero-count row", () => {
    expect(deckIdsFromRows([])).toEqual([]);
    expect(deckIdsFromRows([{ cardId: "a", count: 0 }])).toEqual([]);
  });
});

describe("loadPlayerDeck — the auth guards (short-circuit before any query)", () => {
  it("refuses an anonymous socket (no authenticated userId)", async () => {
    expect(await loadPlayerDeck(NO_DB, "d1", null)).toEqual({
      ok: false,
      reason: "you must be signed in to play a saved deck",
    });
  });

  it("refuses when the player selected no deck", async () => {
    expect(await loadPlayerDeck(NO_DB, null, "u1")).toEqual({
      ok: false,
      reason: "no deck selected",
    });
  });
});
