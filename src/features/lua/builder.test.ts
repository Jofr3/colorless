import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LuaBuilder } from "./builder";
import { encodeFields } from "./account";
import * as api from "../../lib/api";
import type { CardBrief, Deck } from "@luminous/schema";
vi.mock("../../lib/api", () => ({
  getDeck: vi.fn(),
  patchDeck: vi.fn(),
  getCards: vi.fn(),
  getCard: vi.fn(),
  getFacets: vi.fn(),
  getSets: vi.fn(),
  getSeries: vi.fn(),
  cardImageUrl: (id: string) => `/assets/${id}.png`,
}));
const card = (
  id: string,
  name = "Pikachu",
  category: CardBrief["category"] = "Pokemon",
): CardBrief => ({
  id,
  name,
  category,
  rarity: "Common",
  image: "art",
  setId: "sv1",
  localId: "1",
  types: ["Lightning"],
  hp: 60,
  regulationMark: "H",
  stage: "Basic",
  trainerType: null,
  energyType: category === "Energy" ? "Normal" : null,
  legal: { standard: true, expanded: true },
});
const deck = (cards: Deck["cards"] = []): Deck =>
  ({
    id: "one",
    name: "Electric Dreams",
    format: "standard",
    cards,
    chosenCoverCardId: null,
  }) as Deck;
const tick = async () => {
  await vi.advanceTimersByTimeAsync(650);
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(api.getDeck).mockResolvedValue(deck());
  vi.mocked(api.getCards).mockResolvedValue({
    items: [card("a"), card("b")],
    total: 2,
    page: 1,
    pageSize: 8,
  });
  vi.mocked(api.patchDeck).mockResolvedValue(deck());
  vi.mocked(api.getFacets).mockResolvedValue({
    stages: ["Basic"],
    types: ["Lightning"],
    trainerTypes: [],
    energyTypes: [],
    suffixes: [],
    rarities: ["Common"],
    illustrators: [],
    regulationMarks: ["H"],
  } as Awaited<ReturnType<typeof api.getFacets>>);
  vi.mocked(api.getSets).mockResolvedValue([]);
  vi.mocked(api.getSeries).mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());
async function setup(images = vi.fn()) {
  const publish = vi.fn();
  const back = vi.fn();
  const b = new LuaBuilder(publish, back, images);
  b.session("authenticated", "u1");
  await b.command("open\tone");
  return { b, publish, back };
}
describe("Lua deck builder", () => {
  it("loads only the visible deck previews without saving and releases them in list view", async () => {
    const images = vi.fn();
    const { b } = await setup(images);
    const ids = ["c", "d", "e", "f", "g", "h", "i"];
    const template = b.cards.get("a");
    if (!template) throw new Error("Missing catalog fixture");
    for (const id of ids) {
      b.cards.set(id, { ...template, cardId: id });
      b.entries.set(id, 1);
    }
    await b.command(encodeFields(["preview-cards", "missing\nc\nd\ne\nf\ng\nh\ni"]));
    expect(images.mock.lastCall?.[0].map((image: { id: string }) => image.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
    ]);
    await b.command("preview-cards\t");
    expect(images.mock.lastCall?.[0].map((image: { id: string }) => image.id)).toEqual(["a", "b"]);
    await tick();
    expect(api.patchDeck).not.toHaveBeenCalled();
  });
  it("does not save on load; debounces edits and applies copy limits across prints", async () => {
    const { b } = await setup();
    await tick();
    expect(api.patchDeck).not.toHaveBeenCalled();
    for (let i = 0; i < 3; i++) await b.command("add\ta");
    await b.command("add\tb");
    await b.command("add\tb");
    await tick();
    expect([...b.entries]).toEqual([
      ["a", 3],
      ["b", 1],
    ]);
    expect(api.patchDeck).toHaveBeenCalledTimes(1);
    expect(api.patchDeck).toHaveBeenLastCalledWith(
      "one",
      expect.objectContaining({
        cards: [
          { cardId: "a", count: 3 },
          { cardId: "b", count: 1 },
        ],
      }),
    );
  });
  it("retains a failed save and waits for successful persistence before leaving", async () => {
    vi.mocked(api.patchDeck).mockRejectedValueOnce(new Error("offline"));
    const { b, back } = await setup();
    await b.command("add\ta");
    await b.command("leave");
    await tick();
    expect(b.saveStatus).toBe("failed");
    expect(back).not.toHaveBeenCalled();
    expect(b.entries.get("a")).toBe(1);
    await b.command("leave");
    await tick();
    expect(back).toHaveBeenCalledTimes(1);
  });
  it("serializes a follow-up edit behind an in-flight save before navigating", async () => {
    let resolve!: (d: Deck) => void;
    vi.mocked(api.patchDeck).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const { b } = await setup();
    await b.command("add\ta");
    await tick();
    await b.command("add\tb");
    const navigate = vi.fn();
    b.navigate(navigate);
    expect(navigate).not.toHaveBeenCalled();
    resolve(deck());
    await tick();
    expect(api.patchDeck).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
  it("keeps unavailable deck entries, prevents incomplete copy-limit checks, and allows removal", async () => {
    vi.mocked(api.getDeck).mockResolvedValue(deck([{ cardId: "missing", count: 3 }]));
    const { b, publish } = await setup();
    expect(b.entries.get("missing")).toBe(3);
    await b.command("add\ta");
    expect(b.entries.has("a")).toBe(false);
    expect(publish.mock.lastCall?.[0]).toContain("Unavailable%20card");
    for (let i = 0; i < 3; i++) await b.command("remove\tmissing");
    await b.command("add\ta");
    expect(b.entries.get("a")).toBe(1);
  });
  it("drops cover pins when removing the selected cover", async () => {
    const { b } = await setup();
    await b.command("add\ta");
    await b.command("cover\ta");
    await b.command("remove\ta");
    await tick();
    expect(b.cover).toBe(null);
    expect(b.snapshot().chosenCoverCardId).toBe(null);
  });
  it("ignores late catalog responses after a query changes", async () => {
    const { b } = await setup();
    let resolve!: (v: Awaited<ReturnType<typeof api.getCards>>) => void;
    vi.mocked(api.getCards).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const old = b.search();
    await b.command(encodeFields(["filter", "query", "Abra"]));
    resolve({ items: [card("old")], total: 1, page: 1, pageSize: 8 });
    await old;
    expect(b.results.some((c) => c.cardId === "old")).toBe(false);
    vi.mocked(api.getCards).mockResolvedValue({
      items: [card("new", "Abra")],
      total: 1,
      page: 1,
      pageSize: 8,
    });
    await tick();
    expect(b.results[0]?.cardId).toBe("new");
  });
  it("clears private state and prevents queued writes when the session changes", async () => {
    const { b } = await setup();
    await b.command("add\ta");
    b.session("anonymous", "");
    await tick();
    expect(b.entries.size).toBe(0);
    expect(b.name).toBe("");
    expect(b.phase).toBe("anonymous");
    expect(api.patchDeck).not.toHaveBeenCalled();
  });
  it("imports atomically: unmatched lines leave the current deck intact", async () => {
    const { b } = await setup();
    await b.command("add\ta");
    vi.mocked(api.getCards).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
    await b.command(encodeFields(["import", "4 Nonexistent Pokemon"]));
    expect([...b.entries]).toEqual([["a", 1]]);
    expect(b.message).toContain("Deck unchanged");
    expect(b.transfer).toBe("");
    vi.mocked(api.getCards).mockResolvedValue({
      items: [card("b", "Abra")],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    await b.command(encodeFields(["import", "2 Abra"]));
    expect([...b.entries]).toEqual([["b", 2]]);
    expect(b.transfer).toBe("2 Abra");
  });
  it("prefills the decklist from current cards and leaves an empty deck blank", async () => {
    const { b } = await setup();
    b.message = "An old message";
    await b.command("export");
    expect(b.transfer).toBe("");
    expect(b.message).toBe("");
    expect(api.patchDeck).not.toHaveBeenCalled();
    await b.command("add\ta");
    await b.command("export");
    expect(b.transfer).toContain("1 Pikachu");
    expect(b.transfer).toContain("Total Cards: 1");
    await b.command("add\ta");
    await b.command("export");
    expect(b.transfer).toContain("2 Pikachu");
    expect(b.transfer).toContain("Total Cards: 2");
  });
  it("forwards catalog filter dimensions and active format to server search", async () => {
    const { b } = await setup();
    await b.command("cycle\tsupertype\t1");
    await b.command("cycle\tsubtypes\t1");
    await b.command("format");
    expect(api.getCards).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: "Pokemon", stage: ["Basic"], legal: "expanded" }),
    );
  });
  it("searches choices and keeps multiple types selected on the server query", async () => {
    const { b, publish } = await setup();
    await b.command("options\ttypes");
    await b.command("option-pick\tGrass");
    await b.command("option-pick\tFire");
    expect(api.getCards).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: ["Grass", "Fire"] }),
    );
    await b.command("option-query\twater");
    const choices = String(publish.mock.lastCall?.[0])
      .split("\n")
      .filter((l) => l.startsWith("Q\t"));
    expect(choices).toHaveLength(1);
    expect(choices[0]).toContain("Water");
    await b.command("option-pick\t");
    expect(b.filters.types).toEqual([]);
  });
  it("does not apply an import after its dialog is cancelled", async () => {
    const { b } = await setup();
    await b.command("add\ta");
    let resolve!: (value: Awaited<ReturnType<typeof api.getCards>>) => void;
    vi.mocked(api.getCards).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const importing = b.command(encodeFields(["import", "2 Abra"]));
    await b.command("cancel-import");
    resolve({ items: [card("b", "Abra")], total: 1, page: 1, pageSize: 100 });
    await importing;
    expect([...b.entries]).toEqual([["a", 1]]);
    expect(b.message).toContain("cancelled");
  });
});
