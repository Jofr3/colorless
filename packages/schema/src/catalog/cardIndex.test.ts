import { describe, expect, it } from "vitest";
import {
  CARD_INDEX_VERSION,
  type CardIndexPayload,
  type CardIndexRow,
  cardIndexSteps,
  prepareCardIndex,
} from "./cardIndex";

/** A row with the columns the orders read; the rest are empty. */
function row(id: string, name: string, setId: string, localId: string, hp: number | null) {
  return [
    id,
    name,
    "Pokemon",
    null,
    0,
    setId,
    localId,
    null,
    hp,
    null,
    null,
    null,
    null,
    null,
    null,
    1,
    1,
    null,
    null,
    null,
  ] satisfies CardIndexRow as CardIndexRow;
}

// Three sets, their rows interleaved, with equal local ids, names and HP so every order needs its
// tie-break.
const PAYLOAD: CardIndexPayload = {
  version: CARD_INDEX_VERSION,
  series: { b: "s", a: "s", c: "s" },
  cards: [
    row("b-2", "Pidgey", "b", "002", 50),
    row("a-9", "Abra", "a", "009", 60),
    row("c-1", "Abra", "c", "001", null),
    row("a-1", "Zubat", "a", "001", 60),
    row("b-1", "Abra", "b", "001", 70),
    row("a-1x", "Abra", "a", "001", 60),
    row("c-0", "Mew", "c", "000", 70),
  ],
};
const byPosition = (positions: readonly number[]) =>
  positions.map((position) => (PAYLOAD.cards[position] as CardIndexRow)[0]);

describe("prepareCardIndex", () => {
  it("orders by set and local id, by name, and by HP, each tie in collector order", () => {
    const index = prepareCardIndex(PAYLOAD);
    expect(byPosition(index.orders.set)).toEqual([
      "a-1",
      "a-1x",
      "a-9",
      "b-1",
      "b-2",
      "c-0",
      "c-1",
    ]);
    expect(byPosition(index.orders.name)).toEqual([
      "a-1x",
      "a-9",
      "b-1",
      "c-1",
      "c-0",
      "b-2",
      "a-1",
    ]);
    expect(byPosition(index.orders["hp-desc"])).toEqual([
      "b-1",
      "c-0",
      "a-1",
      "a-1x",
      "a-9",
      "b-2",
      "c-1",
    ]);
    // Each card keeps its row's position, so the orders index it.
    expect(index.cards.map((card) => card.row[0])).toEqual(PAYLOAD.cards.map((r) => r[0]));
    expect(index.cards[1]?.name).toBe("abra");
  });

  it("is prepared a set at a time: the steps give the thread back after each set", () => {
    const steps = cardIndexSteps(PAYLOAD);
    let pauses = 0;
    let step = steps.next();
    while (!step.done) {
      pauses++;
      step = steps.next();
    }
    // One pause after each of the three sets, and one after the name order.
    expect(pauses).toBe(4);
    expect(step.value).toEqual(prepareCardIndex(PAYLOAD));
  });

  it("refuses a version it does not read before preparing anything", () => {
    const steps = cardIndexSteps({ ...PAYLOAD, version: 2 as typeof CARD_INDEX_VERSION });
    expect(() => steps.next()).toThrow("card index version 2 is not 1");
  });
});
