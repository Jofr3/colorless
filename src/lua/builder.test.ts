import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LuaBuilder, messageWidth, unresolvedMessage } from "./builder";
import builderSource from "./builder.ts?raw";
import { encodeFields } from "./wire";
import { WIRE_ROWS, wireColumn } from "./wireFields";
import * as api from "../lib/api";
import type { CardBrief, CardsQueryParams, Deck } from "@colorless/schema";
vi.mock("../lib/api", async (importOriginal) => ({
  ApiError: (await importOriginal<typeof import("../lib/api")>()).ApiError,
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
/** Card ids `c<start>` to `c<end - 1>`: positions in a catalogOf result. */
const ids = (start: number, end: number) =>
  Array.from({ length: end - start }, (_, index) => `c${start + index}`);
/** A getCards stand-in serving `total(query)` matches, paged by the query's page and pageSize. */
const catalogOf =
  (total: (query: CardsQueryParams | undefined) => number) => async (query?: CardsQueryParams) => {
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 50;
    const count = total(query);
    const start = Math.min(count, (page - 1) * pageSize);
    const items = ids(start, Math.min(count, start + pageSize)).map((id) => card(id));
    return { items, total: count, page, pageSize };
  };
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
    // Neighbouring deck pages queue behind the visible ones; unknown ids drop.
    await b.command(encodeFields(["preview-cards", "c\nd", "e\nmissing\nf"]));
    expect(images.mock.lastCall?.[0].map((image: { id: string }) => image.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
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
    expect(b.message).toBe("Could not save. Your edits are kept. Retry.");
    expect(back).not.toHaveBeenCalled();
    expect(b.entries.get("a")).toBe(1);
    await b.command("leave");
    await tick();
    expect(back).toHaveBeenCalledTimes(1);
    expect(b.message).toBe("");
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
  it("flags format-illegal deck rows for the Lua alert badge", async () => {
    vi.mocked(api.getCards).mockResolvedValue({
      items: [card("a"), { ...card("x", "Rotated"), legal: { standard: false, expanded: true } }],
      total: 2,
      page: 1,
      pageSize: 8,
    });
    const { b, publish } = await setup();
    await b.command("add\ta");
    await b.command("add\tx");
    const rows = () =>
      Object.fromEntries(
        String(publish.mock.lastCall?.[0])
          .split("\n")
          .filter((line) => line.startsWith("D\t"))
          .map((line) => line.split("\t"))
          .map((fields) => [fields[1], fields[wireColumn(WIRE_ROWS.builder.card, "illegal")]]),
      );
    expect(rows()).toEqual({ a: "0", x: "1" });
    await b.command("format");
    expect(rows()).toEqual({ a: "0", x: "0" });
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
  it("makes each queued save from the version the previous save returned", async () => {
    vi.mocked(api.getDeck).mockResolvedValue({ ...deck(), version: 4 });
    let resolve!: (d: Deck) => void;
    vi.mocked(api.patchDeck)
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValueOnce({ ...deck(), version: 6 });
    const { b } = await setup();
    await b.command("add\ta");
    await tick();
    await b.command("add\tb");
    await tick();
    resolve({ ...deck(), version: 5 });
    await tick();
    await b.command("remove\tb");
    await tick();
    expect(vi.mocked(api.patchDeck).mock.calls.map(([, body]) => body.version)).toEqual([4, 5, 6]);
  });
  it("reloads the server copy and says so when another tab saved first", async () => {
    vi.mocked(api.getDeck).mockResolvedValue({ ...deck(), version: 1 });
    const theirs: Deck = {
      ...deck([{ cardId: "b", count: 2 }]),
      name: "Theirs",
      tint: 22,
      folderId: null,
      position: 0,
      updated: "2026-10-27T10:00:00.000Z",
      version: 2,
    };
    vi.mocked(api.patchDeck).mockRejectedValueOnce(
      new api.ApiError(409, { error: "deck changed since this version", deck: theirs }),
    );
    const { b, publish, back } = await setup();
    await b.command("add\ta");
    await b.command("leave");
    await tick();
    // The leave waits, so the notice is read before the editor closes.
    expect(back).not.toHaveBeenCalled();
    expect([...b.entries]).toEqual([["b", 2]]);
    expect(b.name).toBe("Theirs");
    expect(b.message).toBe("Deck changed elsewhere; reloaded the latest.");
    expect(String(publish.mock.lastCall?.[0])).toContain("reloaded%20the%20latest.");
    expect(b.saveStatus).toBe("");
    // The copy in hand was reloaded without asking again, and the next save is made from it.
    expect(api.getDeck).toHaveBeenCalledTimes(1);
    expect(api.patchDeck).toHaveBeenCalledTimes(1);
    await b.command("add\ta");
    await tick();
    expect(api.patchDeck).toHaveBeenLastCalledWith("one", expect.objectContaining({ version: 2 }));
  });
  it("fetches the latest copy on a conflict that did not carry it", async () => {
    vi.mocked(api.getDeck)
      .mockResolvedValueOnce(deck())
      .mockResolvedValueOnce({ ...deck([{ cardId: "b", count: 1 }]), version: 3 });
    vi.mocked(api.patchDeck).mockRejectedValueOnce(new api.ApiError(409, undefined));
    const { b } = await setup();
    await b.command("add\ta");
    await tick();
    expect(api.getDeck).toHaveBeenCalledTimes(2);
    expect([...b.entries]).toEqual([["b", 1]]);
    expect(b.message).toBe("Deck changed elsewhere; reloaded the latest.");
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
  it("offers Retry only after a load failed", async () => {
    const { b, publish } = await setup();
    const retry = () =>
      String(publish.mock.lastCall?.[0]).split("\n")[0]?.split("\t")[
        wireColumn(WIRE_ROWS.builder.header, "retry")
      ];
    vi.mocked(api.getCards).mockResolvedValueOnce({
      items: [card("b", "Abra")],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    await b.command(encodeFields(["import", "2 Abra"]));
    expect(b.message).toBe("Deck imported.");
    expect(retry()).toBe("0");
    vi.mocked(api.getCards).mockRejectedValueOnce(new Error("offline"));
    await b.command("retry");
    expect(b.message).toBe("Card search failed. Try again.");
    expect(retry()).toBe("1");
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
  it("prefetches neighbouring catalog pages so paging never shows the loading state", async () => {
    vi.mocked(api.getCards).mockImplementation(async (query) => {
      const page = query?.page ?? 1;
      return { items: [card(`p${page}a`), card(`p${page}b`)], total: 40, page, pageSize: 8 };
    });
    const images = vi.fn();
    const { b, publish } = await setup(images);
    await tick();
    const pages = () => vi.mocked(api.getCards).mock.calls.map(([q]) => q?.page);
    expect(pages()).toEqual([1, 2, 3]);
    const totals = () => vi.mocked(api.getCards).mock.calls.map(([q]) => q?.total);
    // The API caches a browsing query's first pages, so their prefetches send no total.
    expect(totals()).toEqual([undefined, undefined, undefined]);
    expect(images.mock.lastCall?.[0].map((image: { id: string }) => image.id)).toEqual([
      "p1a",
      "p1b",
      "p2a",
      "p2b",
      "p3a",
      "p3b",
    ]);
    publish.mockClear();
    await b.command("page\t1");
    expect(b.results.map((c) => c.cardId)).toEqual(["p2a", "p2b"]);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(b.busy).toBe(false);
    await tick();
    expect(pages()).toEqual([1, 2, 3, 4]);
    // Page 4 is past the API's cached pages, so it carries the known total.
    expect(totals()[3]).toBe(40);
    await b.command("page\t-1");
    expect(b.results.map((c) => c.cardId)).toEqual(["p1a", "p1b"]);
    await tick();
    expect(pages()).toEqual([1, 2, 3, 4]);
  });
  it("fetches a name search's pages three to a request and splits them", async () => {
    vi.mocked(api.getCards).mockImplementation(catalogOf(() => 40));
    const images = vi.fn();
    const { b, publish } = await setup(images);
    await tick();
    const calls = () => vi.mocked(api.getCards).mock.calls.map(([q]) => q);
    const seen = calls().length;
    await b.command(encodeFields(["filter", "query", "Abra"]));
    await tick();
    const requests = () =>
      calls()
        .slice(seen)
        .map((q) => [q?.page, q?.pageSize, q?.total]);
    // The first page and its prefetch in one request, which counts the matches as it goes.
    expect(requests()).toEqual([[1, 24, undefined]]);
    expect(b.results.map((c) => c.cardId)).toEqual(ids(0, 8));
    expect(b.total).toBe(40);
    expect(images.mock.lastCall?.[0].map((image: { id: string }) => image.id)).toEqual(ids(0, 24));
    publish.mockClear();
    await b.command("page\t1");
    expect(b.results.map((c) => c.cardId)).toEqual(ids(8, 16));
    expect(publish).toHaveBeenCalledTimes(1);
    await tick();
    // Page 4 is the next block's first; the block request passes the known total back.
    expect(requests()).toEqual([
      [1, 24, undefined],
      [2, 24, 40],
    ]);
    for (const [first, last] of [
      [16, 24],
      [24, 32],
      [32, 40],
    ] as const) {
      await b.command("page\t1");
      expect(b.busy).toBe(false);
      expect(b.results.map((c) => c.cardId)).toEqual(ids(first, last));
      await tick();
    }
    expect(requests()).toHaveLength(2);
  });
  it("keeps the page and requests nothing when a filter is set to the value it has", async () => {
    vi.mocked(api.getCards).mockImplementation(catalogOf(() => 40));
    const { b } = await setup();
    await tick();
    await b.command(encodeFields(["filter", "query", "Abra"]));
    await tick();
    await b.command("page\t1");
    await tick();
    const seen = vi.mocked(api.getCards).mock.calls.length;
    // The search field reports its unchanged text again when an edit starts or ends.
    await b.command(encodeFields(["filter", "query", "Abra"]));
    await tick();
    expect(vi.mocked(api.getCards).mock.calls.length).toBe(seen);
    expect(b.results.map((c) => c.cardId)).toEqual(ids(8, 16));
  });
  it("does not pass an earlier query's total to the prefetches of a search that failed", async () => {
    const catalog = catalogOf((query) => (query?.name === "Abra" ? 40 : 16));
    let failures = 1;
    vi.mocked(api.getCards).mockImplementation(async (query) => {
      if (query?.name === "Bulb" && failures-- > 0) throw new Error("offline");
      return catalog(query);
    });
    const { b } = await setup();
    await b.command(encodeFields(["filter", "query", "Abra"]));
    await tick();
    const calls = () => vi.mocked(api.getCards).mock.calls.map(([q]) => q);
    const seen = calls().length;
    await b.command(encodeFields(["filter", "query", "Bulb"]));
    await tick();
    // The failed first block is fetched again by the prefetch, counting afresh.
    expect(
      calls()
        .slice(seen)
        .map((q) => [q?.page, q?.total]),
    ).toEqual([
      [1, undefined],
      [1, undefined],
    ]);
    await b.command("page\t1");
    expect(b.results.map((c) => c.cardId)).toEqual(ids(8, 16));
    expect(b.total).toBe(16);
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

describe("builder message widths", () => {
  const MAX = 280;
  it("measures like the game font", () => {
    // Widths fontTools gave for m6x11plus at size 14.
    expect(messageWidth("Deck changed elsewhere; reloaded the latest.")).toBe(253.75);
    expect(messageWidth("Unknown: WWWWWWWWWWWWWWWWWWWW. Deck unchanged.")).toBe(308);
    expect(messageWidth("Pokémon Catcher")).toBe(93.625);
  });

  it("keeps every fixed message on one line", () => {
    const source = builderSource;
    const messages = [
      ...source.matchAll(/this\.message = "([^"]+)"/g),
      ...source.matchAll(/^\s+\w+: "([^"]+)",$/gm),
      ...source.matchAll(/^const [A-Z_]+ = "([^"]+)";$/gm),
    ].map((m) => m[1] as string);
    expect(messages.length).toBeGreaterThan(10);
    for (const message of messages) expect(messageWidth(message), message).toBeLessThanOrEqual(MAX);
  });

  it("names the unknown cards that fit, then counts the rest", () => {
    expect(unresolvedMessage(["Rocky Helmet SVI 193"])).toBe(
      "Unknown: Rocky Helmet SVI 193. Deck unchanged.",
    );
    expect(unresolvedMessage(["Mew ex", "Arven", "Iono", "Boss's Orders"])).toBe(
      "Unknown: Mew ex +3 more. Deck unchanged.",
    );
    expect(unresolvedMessage(["Mmmmmmmmmmmmmmmmmmmmmmmmmmmm"])).toBe(
      "1 unknown card. Deck unchanged.",
    );
    expect(unresolvedMessage(["Wwwwwwwwwwwwwwwwwwwwwwwww", "Mew"])).toBe(
      "2 unknown cards. Deck unchanged.",
    );
    for (const lines of [["Rocky Helmet SVI 193"], ["Mew ex", "Arven", "Iono", "Boss's Orders"]])
      expect(messageWidth(unresolvedMessage(lines))).toBeLessThanOrEqual(MAX);
  });
});
