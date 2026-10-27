import { afterEach, describe, expect, it, vi } from "vitest";
import type { Deck } from "../decks/data";
import { fullCardsFrom, json, stubFetch } from "../test/fetchStub";
import { cardBrief } from "../test/fixtures";
import { clearCardPoolCache } from "./cardPool";
import { deckContents, deckLegality } from "./sandboxDecks";

const card = {
  ...cardBrief(),
  illustrator: null,
  evolveFrom: null,
  retreat: 0,
  abilities: null,
  attacks: null,
  weaknesses: null,
  resistances: null,
  effect: null,
  variants: null,
};
const energy = {
  ...card,
  id: "energy",
  name: "Basic Grass Energy",
  category: "Energy",
  energyType: "Normal",
  stage: null,
};
const cards = (basics: number) => [
  { cardId: card.id, count: basics },
  { cardId: energy.id, count: 60 - basics },
];
const summary = (id: string, over: Partial<Deck> = {}): Deck => ({
  id,
  name: id,
  format: "standard",
  folderId: null,
  cardCount: 60,
  cards: cards(4),
  tint: 0,
  coverCardId: null,
  position: 0,
  updated: "2026-10-01T00:00:00.000Z",
  ...over,
});
const live = () => true;

afterEach(() => {
  clearCardPoolCache();
  vi.unstubAllGlobals();
});

describe("deck contents for the pickers and the legality check", () => {
  it("reads a summary's own cards without a request", async () => {
    const { calls } = stubFetch({});
    await expect(deckContents(summary("a"))).resolves.toMatchObject({
      name: "a",
      format: "standard",
      cards: cards(4),
    });
    expect(calls).toEqual([]);
  });

  it("judges listed cards, fetching only the complete decks a list sent without them", async () => {
    const { calls } = stubFetch({
      "GET /decks/old": () => json({ ...summary("old"), cards: cards(0), chosenCoverCardId: null }),
      "GET /cards/full": fullCardsFrom({ [card.id]: card, energy }),
    });
    const legality = await deckLegality(
      [
        summary("listed"),
        summary("no-basic", { cards: cards(0) }),
        summary("old", { cards: undefined }),
        summary("short", { cardCount: 40, cards: undefined }),
      ],
      live,
    );
    expect(Object.fromEntries(legality)).toEqual({
      listed: true,
      "no-basic": false,
      old: false,
      short: false,
    });
    expect(calls).toEqual(["GET /decks/old", "GET /cards/full"]);
  });
});
