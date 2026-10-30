import { afterEach, describe, expect, it, vi } from "vitest";
import { fullCardsFrom, json, stubFetch } from "../test/fetchStub";
import { cardBrief } from "../test/fixtures";
import { clearCardPoolCache } from "../game/cardPool";
import { deckStore } from "./deckStore";

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
const cards = [
  { cardId: card.id, count: 4 },
  { cardId: energy.id, count: 56 },
];
const UPDATED = "2026-10-01T00:00:00.000Z";
const summary = (id: string, name: string, cardCount = 60) => ({
  id,
  name,
  format: "standard",
  folderId: null,
  cardCount,
  tint: 0,
  coverCardId: null,
  position: 0,
  updated: UPDATED,
  ...(cardCount === 60 ? { cards } : {}),
});
const pool = { "GET /cards/full": fullCardsFrom({ [card.id]: card, energy }) };
/** GET /decks answers `list()` once per call, each held until `answer()`. */
function heldList(list: () => unknown[]) {
  const waiting: (() => void)[] = [];
  const stub = stubFetch({
    ...pool,
    "GET /decks": () =>
      new Promise<Response>((done) => {
        waiting.push(() => done(json(list())));
      }),
  });
  return { ...stub, answer: () => waiting.shift()?.() };
}
const settle = () => new Promise((done) => setTimeout(done, 0));

afterEach(() => {
  deckStore.reset();
  clearCardPoolCache();
  vi.unstubAllGlobals();
});

describe("the deck store", () => {
  it("shares one GET /decks between every screen that asks while it is in flight", async () => {
    const held = heldList(() => [summary("a", "Alpha")]);
    const first = deckStore.revalidate("u");
    const second = deckStore.revalidate("u");
    held.answer();
    const [a, b] = await Promise.all([first, second]);
    expect(held.calls).toEqual(["GET /decks"]);
    expect(a).toBe(b);
    expect(deckStore.peek("u")?.decks.map((d) => d.id)).toEqual(["a"]);
  });
  it("keeps the revision while the list answers the same, and moves it when it changes", async () => {
    let name = "Alpha";
    stubFetch({ ...pool, "GET /decks": () => json([summary("a", name)]) });
    const first = await deckStore.revalidate("u");
    const same = await deckStore.revalidate("u");
    expect(same.revision).toBe(first.revision);
    name = "Beta";
    const renamed = await deckStore.revalidate("u");
    expect(renamed.revision).toBeGreaterThan(first.revision);
    expect(deckStore.peek("u")?.decks[0]?.name).toBe("Beta");
  });
  it("holds a list for one user only", async () => {
    stubFetch({ ...pool, "GET /decks": () => json([summary("a", "Alpha")]) });
    await deckStore.revalidate("u");
    expect(deckStore.peek("v")).toBeUndefined();
    deckStore.session("u");
    expect(deckStore.peek("u")).toBeDefined();
    deckStore.session("");
    expect(deckStore.peek("u")).toBeUndefined();
  });
  it("drops a list that arrives for a user who has signed out meanwhile", async () => {
    const held = heldList(() => [summary("a", "Alpha")]);
    const pending = deckStore.revalidate("u");
    deckStore.session("");
    held.answer();
    await pending.catch(() => {});
    expect(deckStore.peek("u")).toBeUndefined();
  });
  it("judges a revision once, and keeps the verdicts with it", async () => {
    const { calls } = stubFetch({
      ...pool,
      "GET /decks": () => json([summary("a", "Alpha"), summary("b", "Short", 20)]),
    });
    const list = await deckStore.revalidate("u");
    const [first, second] = await Promise.all([deckStore.judge(list), deckStore.judge(list)]);
    expect(first).toBe(second);
    expect(first.get("a")).toMatchObject({ playable: true, legal: true, name: "Alpha" });
    expect(first.has("b")).toBe(false);
    expect(deckStore.peekVerdicts(list)).toBe(first);
    expect(calls.filter((call) => call === "GET /cards/full")).toHaveLength(1);
  });
  it("forgets a failed judgement, so the next screen tries again", async () => {
    let fail = true;
    stubFetch({
      "GET /decks": () => json([summary("a", "Alpha")]),
      "GET /cards/full": (url) => (fail ? json({}, 503) : pool["GET /cards/full"](url)),
    });
    const list = await deckStore.revalidate("u");
    await expect(deckStore.judge(list)).rejects.toThrow();
    expect(deckStore.peekVerdicts(list)).toBeUndefined();
    fail = false;
    expect((await deckStore.judge(list)).get("a")?.playable).toBe(true);
  });
  it("applies a write's answer at once and moves the revision", async () => {
    stubFetch({ ...pool, "GET /decks": () => json([summary("a", "Alpha")]) });
    const before = await deckStore.revalidate("u");
    const { cards: _, cardCount: __, coverCardId: ___, ...base } = summary("a", "Renamed");
    deckStore.put("u", { ...base, cards, chosenCoverCardId: null });
    const renamed = deckStore.peek("u");
    expect(renamed?.revision).toBeGreaterThan(before.revision);
    expect(renamed?.decks[0]).toMatchObject({ id: "a", name: "Renamed", cardCount: 60 });
    deckStore.put("u", {
      ...base,
      id: "new",
      name: "New",
      position: -1,
      cards: [],
      chosenCoverCardId: null,
    });
    expect(deckStore.peek("u")?.decks.map((d) => d.id)).toEqual(["new", "a"]);
    expect(deckStore.peek("u")?.decks[0]).toMatchObject({ cardCount: 0, cards: undefined });
    deckStore.remove("u", "a");
    expect(deckStore.peek("u")?.decks.map((d) => d.id)).toEqual(["new"]);
  });
  it("a list fetched before a write does not overwrite it, and the next revalidation fetches anew", async () => {
    let name = "Alpha";
    const held = heldList(() => [summary("a", name)]);
    const stale = deckStore.revalidate("u");
    held.answer();
    await stale;
    const inFlight = deckStore.revalidate("u");
    const { cards: _, cardCount: __, coverCardId: ___, ...base } = summary("a", "Renamed");
    deckStore.put("u", { ...base, cards, chosenCoverCardId: null });
    const after = deckStore.revalidate("u");
    expect(held.calls.filter((call) => call === "GET /decks")).toHaveLength(3);
    // The answer from before the write lands after it, holding the old name.
    held.answer();
    await settle();
    expect(deckStore.peek("u")?.decks[0]?.name).toBe("Renamed");
    name = "Renamed";
    held.answer();
    await Promise.all([inFlight, after]);
    expect(deckStore.peek("u")?.decks[0]?.name).toBe("Renamed");
  });
  it("follows the account: fetches when it resolves signed in, drops the list on sign-out", async () => {
    const { calls } = stubFetch({ ...pool, "GET /decks": () => json([summary("a", "Alpha")]) });
    deckStore.follow("loading", "");
    deckStore.follow("authenticated", "u");
    deckStore.follow("authenticated", "u");
    await settle();
    expect(calls).toEqual(["GET /decks"]);
    expect(deckStore.peek("u")).toBeDefined();
    deckStore.follow("error", "");
    expect(deckStore.peek("u")).toBeDefined();
    deckStore.follow("authenticated", "u");
    await settle();
    expect(calls).toEqual(["GET /decks"]);
    deckStore.follow("anonymous", "");
    expect(deckStore.peek("u")).toBeUndefined();
  });
  it("prefetches a signed-in user's list once, quietly", async () => {
    const { calls } = stubFetch({ "GET /decks": () => json({}, 503) });
    deckStore.prefetch("u");
    deckStore.prefetch("u");
    await settle();
    expect(calls).toEqual(["GET /decks"]);
    expect(deckStore.peek("u")).toBeUndefined();
  });
});
