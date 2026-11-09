import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIXED_MESSAGES,
  keptNameMessage,
  LuaBuilder,
  messageWidth,
  unresolvedMessage,
} from "./builder";
import { decodeFields, encodeFields } from "./wire";
import { deckNameOrNull } from "../decks/deckSnapshot";
import { WIRE_ROWS, wireColumn } from "./wireFields";
import * as api from "../lib/api";
import {
  type Card,
  type CardBrief,
  type CardIndexPayload,
  type CardsQueryParams,
  DECK_NAME_MAX,
  type Deck,
  MAX_CACHED_CARDS_PAGE,
} from "@colorless/schema";
import { forgetCardIndex, forgetCatalogOptions, loadCardIndex } from "../decks/catalog";
import { clearCardPoolCache, fetchCardPool } from "../game/cardPool";
import { deckStore } from "../decks/deckStore";
import { MAX_TRANSIENT_RETRIES } from "../decks/deckSaver";
import { cardIndexPayload } from "../test/fixtures";
import { ENERGY_TYPES } from "../decks/cards";
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ApiError: actual.ApiError,
    DECK_WRITE_TIMEOUT_MS: actual.DECK_WRITE_TIMEOUT_MS,
    withDeadline: actual.withDeadline,
    getDeck: vi.fn(),
    patchDeck: vi.fn(),
    getCards: vi.fn(),
    getCardIndex: vi.fn(),
    getFullCards: vi.fn(),
    getCard: vi.fn(),
    getFacets: vi.fn(),
    getSets: vi.fn(),
    getSeries: vi.fn(),
    listDecks: vi.fn(),
    cardImageUrl: (id: string) => `/assets/${id}.png`,
  };
});
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
/** Forty Abra, `c0` to `c39`, each with a Teleport attack, and a Pikachu. */
const ABRA_INDEX = cardIndexPayload(
  [...ids(0, 40).map((id) => card(id, "Abra")), card("p", "Pikachu")],
  Object.fromEntries(ids(0, 40).map((id) => [id, '[{"name":"Teleport","effect":"Switch."}]'])),
);
const tick = async () => {
  await vi.advanceTimersByTimeAsync(650);
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  forgetCardIndex();
  forgetCatalogOptions();
  clearCardPoolCache();
  vi.mocked(api.getCardIndex).mockResolvedValue(ABRA_INDEX);
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
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  deckStore.reset();
});
async function setup(images = vi.fn()) {
  const publish = vi.fn();
  const back = vi.fn();
  const b = new LuaBuilder(publish, back, images);
  b.session("authenticated", "u1");
  await b.command("open\tone");
  return { b, publish, back };
}
/** A PATCH /decks/:id stand-in that holds `deck` and refuses a stale version with the route's 409.
    `offline` fails every save before it arrives; `loseNext` commits the next one and loses its
    response. */
function versionedServer() {
  const stored: Deck = {
    ...deck(),
    tint: 1,
    folderId: null,
    position: 0,
    updated: "2026-10-28T00:00:00.000Z",
    version: 1,
  };
  const server = { deck: stored, offline: false, loseNext: false };
  vi.mocked(api.getDeck).mockResolvedValue(stored);
  vi.mocked(api.patchDeck).mockImplementation(async (_id, body) => {
    if (server.offline) throw new TypeError("Failed to fetch");
    if (body.version !== server.deck.version) {
      throw new api.ApiError(409, { error: "deck changed since this version", deck: server.deck });
    }
    server.deck = {
      ...server.deck,
      name: body.name ?? server.deck.name,
      cards: body.cards ?? server.deck.cards,
      chosenCoverCardId: body.chosenCoverCardId ?? null,
      version: (server.deck.version ?? 0) + 1,
    };
    if (server.loseNext) {
      server.loseNext = false;
      throw new TypeError("Failed to fetch");
    }
    return server.deck;
  });
  return server;
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
      { keepalive: false },
    );
  });
  it("retains a failed save and waits for successful persistence before leaving", async () => {
    for (let i = 0; i <= MAX_TRANSIENT_RETRIES; i++) {
      vi.mocked(api.patchDeck).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    }
    const { b, back } = await setup();
    await b.command("add\ta");
    await b.command("leave");
    await tick();
    // Retried on its own at 2, 4 and 8 s, "retrying", before it is reported.
    expect(b.saveStatus).toBe("retrying");
    await vi.advanceTimersByTimeAsync(14_000);
    expect(api.patchDeck).toHaveBeenCalledTimes(MAX_TRANSIENT_RETRIES + 1);
    expect(b.saveStatus).toBe("failed");
    expect(b.message).toBe("Could not save. Your edits are kept. Retry.");
    expect(back).not.toHaveBeenCalled();
    expect(b.entries.get("a")).toBe(1);
    await b.command("leave");
    await tick();
    expect(back).toHaveBeenCalledTimes(1);
    expect(b.message).toBe("");
  });
  it("stops saving a deck a save finds gone, offers its decklist, and lets Back leave (DECK1)", async () => {
    vi.mocked(api.patchDeck).mockRejectedValue(new api.ApiError(404, { error: "deck not found" }));
    const { b, publish, back } = await setup();
    const header = () => decodeFields(String(publish.mock.lastCall?.[0]).split("\n")[0] ?? "");
    await b.command("add\ta");
    // Back pressed before the save answers waits for it, then stays to show why it failed.
    await b.command("leave");
    await tick();
    expect(api.patchDeck).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
    expect(b.message).toBe("This deck no longer exists. Export to keep it.");
    expect(header()?.[wireColumn(WIRE_ROWS.builder.header, "saveStatus")]).toBe("");
    expect(b.hasUnsavedEdits()).toBe(false);
    // Later edits are kept on screen, not sent, and the notice stays.
    await b.command("add\ta");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(api.patchDeck).toHaveBeenCalledTimes(1);
    expect(b.message).toBe("This deck no longer exists. Export to keep it.");
    await b.command("export");
    expect(b.transfer).toContain("2 Pikachu");
    const navigated = vi.fn();
    b.navigate(navigated);
    expect(navigated).toHaveBeenCalledTimes(1);
    await b.command("leave");
    expect(back).toHaveBeenCalledTimes(1);
    expect(api.patchDeck).toHaveBeenCalledTimes(1);
  });
  it("lets a second Back leave without saving once a save has failed (DECK1)", async () => {
    vi.mocked(api.patchDeck).mockRejectedValue(new api.ApiError(500, { error: "internal" }));
    const { b, back } = await setup();
    await b.command("add\ta");
    await tick();
    expect(b.saveStatus).toBe("failed");
    expect(b.message).toBe("Could not save. Your edits are kept. Retry.");
    // The first Back tries the save again, and says what the next one does.
    await b.command("leave");
    expect(b.message).toBe("Not saved. Press Back again to leave anyway.");
    await tick();
    expect(api.patchDeck).toHaveBeenCalledTimes(2);
    expect(back).not.toHaveBeenCalled();
    expect(b.message).toBe("Not saved. Press Back again to leave anyway.");
    await b.command("leave");
    expect(back).toHaveBeenCalledTimes(1);
    expect(api.patchDeck).toHaveBeenCalledTimes(2);
    expect(b.entries.get("a")).toBe(1);
    // The edits given up are never sent: not as the page closes or hides, not when the
    // network comes back, and not by a retry that was waiting.
    expect(b.hasUnsavedEdits()).toBe(false);
    await b.command("close");
    b.persistNow();
    b.retrySave();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.patchDeck).toHaveBeenCalledTimes(2);
  });
  it("takes a double click on Back after a failed save as one press", async () => {
    vi.mocked(api.patchDeck).mockRejectedValue(new api.ApiError(500, { error: "internal" }));
    const { b, back } = await setup();
    await b.command("add\ta");
    await tick();
    await b.command("leave");
    await vi.advanceTimersByTimeAsync(200);
    await b.command("leave");
    expect(back).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    const navigated = vi.fn();
    b.navigate(navigated);
    expect(navigated).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });
  it("arms no leave without saving until a save has failed, and disarms once one lands", async () => {
    let fail = true;
    vi.mocked(api.patchDeck).mockImplementation(async () => {
      if (fail) throw new api.ApiError(500, { error: "internal" });
      return deck([{ cardId: "a", count: 1 }]);
    });
    const { b, back } = await setup();
    await b.command("add\ta");
    await tick();
    fail = false;
    await b.command("retry-save");
    await tick();
    expect(b.saveStatus).toBe("saved");
    // The landed save disarmed it: Back after this new failure only tries again, and arms.
    fail = true;
    await b.command("add\tb");
    await b.command("leave");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(b.message).toBe("Could not save. Your edits are kept. Retry.");
    await b.command("leave");
    expect(back).not.toHaveBeenCalled();
    expect(b.message).toBe("Not saved. Press Back again to leave anyway.");
    await vi.advanceTimersByTimeAsync(1_000);
    await b.command("leave");
    expect(back).toHaveBeenCalledTimes(1);
  });
  it("drops the failed save's Retry from its message while the save is tried again", async () => {
    for (let i = 0; i <= 2 * MAX_TRANSIENT_RETRIES + 1; i++) {
      vi.mocked(api.patchDeck).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    }
    const { b } = await setup();
    await b.command("add\ta");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(b.saveStatus).toBe("failed");
    expect(b.message).toBe("Could not save. Your edits are kept. Retry.");
    await b.command("retry-save");
    await tick();
    expect(b.saveStatus).toBe("retrying");
    expect(b.message).toBe("");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(b.saveStatus).toBe("failed");
    expect(b.message).toBe("Could not save. Your edits are kept. Retry.");
  });
  it("gives up on saves that never answer, so Retry and Leave work again", async () => {
    vi.mocked(api.patchDeck).mockImplementation(() =>
      api.withDeadline(api.DECK_WRITE_TIMEOUT_MS, () => new Promise<Deck>(() => {})),
    );
    const { b, back } = await setup();
    await b.command("add\ta");
    await b.command("leave");
    await tick();
    expect(b.saveStatus).toBe("saving");
    // Four tries of 30 s each, with the 2, 4 and 8 s waits between them.
    await vi.advanceTimersByTimeAsync(4 * api.DECK_WRITE_TIMEOUT_MS + 14_000);
    expect(api.patchDeck).toHaveBeenCalledTimes(4);
    expect(b.saveStatus).toBe("failed");
    expect(b.message).toBe("Could not save. Your edits are kept. Retry.");
    expect(back).not.toHaveBeenCalled();
    vi.mocked(api.patchDeck).mockResolvedValue(deck());
    await b.command("leave");
    await tick();
    expect(api.patchDeck).toHaveBeenCalledTimes(5);
    expect(back).toHaveBeenCalledTimes(1);
  });
  it("sends pending edits at once, in a save that outlives the page, when it is hidden", async () => {
    let resolve!: (d: Deck) => void;
    vi.mocked(api.patchDeck).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const { b } = await setup();
    expect(b.hasUnsavedEdits()).toBe(false);
    await b.command("add\ta");
    expect(b.hasUnsavedEdits()).toBe(true);
    b.persistNow();
    expect(api.patchDeck).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.patchDeck).mock.lastCall?.[2]).toEqual({ keepalive: true });
    // Reverted while that save is out: the editor matches the saved copy, but the revert is unsent.
    await b.command("remove\ta");
    expect(b.hasUnsavedEdits()).toBe(true);
    resolve(deck([{ cardId: "a", count: 1 }]));
    // The follow-up goes a second after the first save started.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.patchDeck).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.patchDeck).mock.lastCall?.[2]).toEqual({ keepalive: false });
    expect(b.hasUnsavedEdits()).toBe(false);
  });
  it("publishes saving, retrying through new edits after a failed attempt, then saved for 2.2 s", async () => {
    vi.mocked(api.patchDeck).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { b, publish } = await setup();
    const status = () =>
      String(publish.mock.lastCall?.[0]).split("\n")[0]?.split("\t")[
        wireColumn(WIRE_ROWS.builder.header, "saveStatus")
      ];
    await b.command("add\ta");
    expect(status()).toBe("pending");
    await tick();
    expect(status()).toBe("retrying");
    // An edit made while the retry waits joins it, still retrying.
    await b.command("add\tb");
    expect(status()).toBe("retrying");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(status()).toBe("saved");
    expect(vi.mocked(api.patchDeck).mock.lastCall?.[1].cards).toEqual([
      { cardId: "a", count: 1 },
      { cardId: "b", count: 1 },
    ]);
    // It landed at 2.6 s, 50 ms ago, and says so until 4.8 s.
    await vi.advanceTimersByTimeAsync(2_149);
    expect(status()).toBe("saved");
    await vi.advanceTimersByTimeAsync(1);
    expect(status()).toBe("");
  });
  it("puts each deck a save returns in the shared deck store", async () => {
    const row = {
      id: "one",
      name: "Electric Dreams",
      format: "standard",
      folderId: null,
      cardCount: 0,
      tint: 1,
      coverCardId: null,
      position: 0,
      updated: "2026-10-29T00:00:00.000Z",
    };
    vi.mocked(api.listDecks).mockResolvedValue([row] as Awaited<ReturnType<typeof api.listDecks>>);
    await deckStore.revalidate("u1");
    const saved = {
      ...deck([{ cardId: "a", count: 1 }]),
      name: "Saved Dreams",
      tint: 1,
      folderId: null,
      position: 0,
      updated: "2026-10-30T00:00:00.000Z",
      version: 2,
    } as Deck;
    vi.mocked(api.patchDeck).mockResolvedValue(saved);
    const { b } = await setup();
    await b.command("add\ta");
    expect(deckStore.peek("u1")?.decks[0]?.name).toBe("Electric Dreams");
    await tick();
    expect(deckStore.peek("u1")?.decks).toEqual([
      expect.objectContaining({ id: "one", name: "Saved Dreams", cardCount: 1 }),
    ]);
    expect(api.listDecks).toHaveBeenCalledTimes(1);
  });
  it("sends a failed save again when asked, as when the network returns", async () => {
    vi.mocked(api.patchDeck).mockRejectedValue(new TypeError("Failed to fetch"));
    const { b } = await setup();
    await b.command("add\ta");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(b.saveStatus).toBe("failed");
    expect(b.hasUnsavedEdits()).toBe(true);
    vi.mocked(api.patchDeck).mockResolvedValue(deck([{ cardId: "a", count: 1 }]));
    b.retrySave();
    await tick();
    expect(b.saveStatus).toBe("saved");
    expect(b.hasUnsavedEdits()).toBe(false);
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
    await vi.advanceTimersByTimeAsync(1_000);
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
    await tick();
    expect(b.results[0]?.cardId).toBe("c0");
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
    expect(vi.mocked(api.patchDeck).mock.lastCall?.[1]).toMatchObject({ version: 2 });
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
  it("takes the 409 its own retry gets as the save whose response was lost", async () => {
    const server = versionedServer();
    server.loseNext = true;
    const { b } = await setup();
    await b.command("add\ta");
    await tick();
    expect(server.deck.cards).toEqual([{ cardId: "a", count: 1 }]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(server.deck).toMatchObject({ cards: [{ cardId: "a", count: 1 }], version: 2 });
    expect(b.saveStatus).toBe("saved");
    expect(b.message).toBe("");
    // The retry found its edits already saved, so nothing more was written.
    expect(vi.mocked(api.patchDeck).mock.calls.map(([, body]) => body.version)).toEqual([1, 1]);
  });
  it("takes a 409 carrying a save whose response was lost as that save, across offline edits", async () => {
    const server = versionedServer();
    server.loseNext = true;
    const { b } = await setup();
    await b.command("add\ta");
    await tick();
    expect(server.deck.cards).toEqual([{ cardId: "a", count: 1 }]);
    server.offline = true;
    await b.command("add\tb");
    await tick();
    await b.command("add\tb");
    await vi.advanceTimersByTimeAsync(14_000);
    expect(b.message).toBe("Could not save. Your edits are kept. Retry.");
    server.offline = false;
    await b.command("add\ta");
    await tick();
    const kept = [
      { cardId: "a", count: 2 },
      { cardId: "b", count: 2 },
    ];
    expect(server.deck.cards).toEqual(kept);
    expect(b.snapshot().cards).toEqual(kept);
    expect(b.message).toBe("");
    expect(b.saveStatus).toBe("saved");
    expect(api.getDeck).toHaveBeenCalledTimes(1);
    const versions = vi.mocked(api.patchDeck).mock.calls.map(([, body]) => body.version);
    expect(versions.at(-1)).toBe(2);
    expect(new Set(versions.slice(0, -1))).toEqual(new Set([1]));
  });
  it("sends an undo made after a save whose response was lost, and counts it unsaved until then", async () => {
    const server = versionedServer();
    server.loseNext = true;
    const { b, back } = await setup();
    await b.command("add\ta");
    await tick();
    await b.command("remove\ta");
    // The undo joins the retry of the save whose response was lost.
    expect(b.saveStatus).toBe("retrying");
    await b.command("leave");
    expect(back).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(server.deck.cards).toEqual([]);
    expect(server.deck.version).toBe(3);
    expect(back).toHaveBeenCalledTimes(1);
  });
  it("takes a lost save made while the name field was blank as its own (DECK2)", async () => {
    const server = versionedServer();
    server.loseNext = true;
    const { b } = await setup();
    await b.command("add\ta");
    // The name is cleared and left blank past the save's debounce.
    await b.command(encodeFields(["name", "", "input"]));
    await tick();
    expect(vi.mocked(api.patchDeck).mock.lastCall?.[1].name).toBe("Electric Dreams");
    expect(server.deck.cards).toEqual([{ cardId: "a", count: 1 }]);
    await b.command(encodeFields(["name", "Bolt", "input"]));
    await b.command("add\tb");
    await vi.advanceTimersByTimeAsync(2_500);
    expect(b.message).toBe("");
    expect(b.name).toBe("Bolt");
    expect(server.deck).toMatchObject({
      name: "Bolt",
      cards: [
        { cardId: "a", count: 1 },
        { cardId: "b", count: 1 },
      ],
    });
    expect(api.getDeck).toHaveBeenCalledTimes(1);
  });
  it("sends nothing for a name cleared and not yet typed again", async () => {
    const { b } = await setup();
    await b.command(encodeFields(["name", "", "input"]));
    await tick();
    expect(b.hasUnsavedEdits()).toBe(false);
    expect(api.patchDeck).not.toHaveBeenCalled();
  });
  it("still reloads on a 409 carrying a deck this tab never sent, after a lost response", async () => {
    const server = versionedServer();
    server.loseNext = true;
    const { b } = await setup();
    await b.command("add\ta");
    await tick();
    server.deck = { ...server.deck, cards: [{ cardId: "b", count: 2 }], version: 3 };
    await b.command("add\tb");
    await vi.advanceTimersByTimeAsync(2_000);
    expect([...b.entries]).toEqual([["b", 2]]);
    expect(b.message).toBe("Deck changed elsewhere; reloaded the latest.");
    expect(api.patchDeck).toHaveBeenCalledTimes(2);
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
    const searches = vi.mocked(api.getCards).mock.calls.length;
    await b.command(encodeFields(["import", "4 Nonexistent Pokemon"]));
    expect([...b.entries]).toEqual([["a", 1]]);
    expect(b.message).toContain("Deck unchanged");
    expect(b.transfer).toBe("");
    // Names resolve in the card index, its first print of Abra.
    await b.command(encodeFields(["import", "2 Abra"]));
    expect([...b.entries]).toEqual([["c0", 2]]);
    expect(b.transfer).toBe("2 Abra");
    expect(vi.mocked(api.getCards).mock.calls.length).toBe(searches);
  });
  it("refuses a decklist with more card lines than a deck can hold", async () => {
    const { b } = await setup();
    await b.command("add\ta");
    const text = Array.from({ length: 201 }, () => "1 Abra").join("\n");
    await b.command(encodeFields(["import", text]));
    expect(b.message).toBe("Too many card lines. Deck unchanged.");
    expect([...b.entries]).toEqual([["a", 1]]);
  });
  it("offers Retry only after a load failed", async () => {
    const { b, publish } = await setup();
    const retry = () =>
      String(publish.mock.lastCall?.[0]).split("\n")[0]?.split("\t")[
        wireColumn(WIRE_ROWS.builder.header, "retry")
      ];
    await b.command(encodeFields(["import", "2 Abra"]));
    expect(b.message).toBe("Deck imported.");
    expect(retry()).toBe("0");
    // The import loaded the card index; without it, the search asks GET /cards.
    forgetCardIndex();
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
    // All, then the match.
    expect(choices).toHaveLength(2);
    expect(choices[1]).toContain("Water");
    await b.command("option-pick\t");
    expect(b.filters.types).toEqual([]);
  });
  /** The list rows of the last publish: its P row's fields and each Q row's [value, label, selected]. */
  const listRows = (publish: ReturnType<typeof vi.fn>) => {
    const lines = String(publish.mock.lastCall?.[0])
      .split("\n")
      .map((l) => decodeFields(l) ?? []);
    const picker = lines.find((l) => l[0] === "P");
    const choices = lines.filter((l) => l[0] === "Q").map((l) => l.slice(1));
    const option = (key: string) => lines.find((l) => l[0] === "O" && l[1] === key);
    return { picker, choices, option };
  };
  it("pages, marks and counts a multi-value list end to end (UI-FU3)", async () => {
    const { b, publish } = await setup();
    await b.command("options\ttypes");
    let rows = listRows(publish);
    // All and the eleven types: seven a page.
    expect(rows.picker).toEqual(["P", "types", "Energy type", "1", "2", ""]);
    expect(rows.choices).toHaveLength(7);
    expect(rows.choices[0]).toEqual(["", "All", "1"]);
    await b.command("option-pick\tFire");
    await b.command("option-pick\tWater");
    rows = listRows(publish);
    expect(rows.choices.filter((c) => c[2] === "1").map((c) => c[0])).toEqual(["Fire", "Water"]);
    // The cycle shows the count and lights both pips.
    expect(rows.option("types")?.[3]).toBe("2 selected");
    expect(rows.option("types")?.[6]).toBe(
      `${ENERGY_TYPES.indexOf("Fire") + 2},${ENERGY_TYPES.indexOf("Water") + 2}`,
    );
    expect(api.getCards).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: ["Fire", "Water"], page: 1 }),
    );
    await b.command("option-page\t1");
    rows = listRows(publish);
    expect(rows.picker?.[3]).toBe("2");
    expect(rows.choices.map((c) => c[0])).toEqual(ENERGY_TYPES.slice(6));
    // Past the last page stays on it.
    await b.command("option-page\t1");
    expect(listRows(publish).picker?.[3]).toBe("2");
    // A search starts on page 1 again.
    await b.command("option-query\tWAT");
    rows = listRows(publish);
    expect(rows.picker?.slice(3)).toEqual(["1", "1", "WAT"]);
    expect(rows.choices).toEqual([
      ["", "All", "0"],
      ["Water", "Water", "1"],
    ]);
    // All stays offered under a search, so a search never hides the way to clear.
    await b.command("option-query\twa");
    expect(listRows(publish).choices.map((c) => c[0])).toEqual(["", "Water"]);
    // Picking a chosen value clears it; All clears every one.
    await b.command("option-pick\tWater");
    expect(b.filters.types).toEqual(["Fire"]);
    expect(listRows(publish).option("types")?.[3]).toBe("Fire");
    await b.command("option-pick\t");
    expect(b.filters.types).toEqual([]);
    expect(api.getCards).toHaveBeenLastCalledWith(expect.objectContaining({ type: undefined }));
  });
  it("sets a single-value filter from its list and searches it (UI-FU3)", async () => {
    heldIdle();
    vi.mocked(api.getSets).mockResolvedValue([
      { id: "sv01", name: "Scarlet & Violet" },
      { id: "sv02", name: "Paldea Evolved" },
    ] as Awaited<ReturnType<typeof api.getSets>>);
    const { b, publish } = await setup();
    await tick();
    await b.command("options\tsetId");
    await b.command("option-pick\tsv01");
    await b.command("option-pick\tsv02");
    expect(b.filters.setId).toBe("sv02");
    const rows = listRows(publish);
    expect(rows.choices.map((c) => [c[1], c[2]])).toEqual([
      ["All", "0"],
      ["Scarlet & Violet", "0"],
      ["Paldea Evolved", "1"],
    ]);
    expect(rows.option("setId")?.[3]).toBe("Paldea Evolved");
    expect(api.getCards).toHaveBeenLastCalledWith(expect.objectContaining({ set: "sv02" }));
    await b.command("option-pick\t");
    expect(b.filters.setId).toBe("");
    // An unknown value changes nothing.
    await b.command("option-pick\tnope");
    expect(b.filters.setId).toBe("");
  });
  it("publishes no list once it closes or another deck opens (UI-FU3)", async () => {
    const { b, publish } = await setup();
    await b.command("options\ttypes");
    await b.command("option-query\tfi");
    await b.command("option-page\t1");
    expect(listRows(publish).picker).toBeDefined();
    await b.command("options\t");
    expect(listRows(publish).picker).toBeUndefined();
    expect(listRows(publish).choices).toEqual([]);
    await b.command("options\ttypes");
    await b.command("option-query\tfi");
    await b.command("open\ttwo");
    expect(b.optionKey).toBe("");
    expect(b.optionQuery).toBe("");
    expect(b.optionPage).toBe(1);
    expect(listRows(publish).picker).toBeUndefined();
  });
  it("prefetches neighbouring pages from the card index only, never from /cards", async () => {
    const idle = heldIdle();
    vi.mocked(api.getCards).mockImplementation(catalogOf(() => 40));
    const images = vi.fn();
    const { b, publish } = await setup(images);
    await tick();
    // Before the index loads, only the page on screen comes from /cards: a prefetch there would
    // spend the per-address search limit on a page that may never be opened.
    const pages = () => vi.mocked(api.getCards).mock.calls.map(([q]) => q?.page);
    expect(pages()).toEqual([1]);
    expect(images.mock.lastCall?.[0].map((image: { id: string }) => image.id)).toEqual(ids(0, 8));
    idle[0]?.();
    await tick();
    // Once it has loaded, opening a page warms its neighbours from it, art queued behind its own,
    // so the next page shows with no loading state.
    await b.command("page\t1");
    await tick();
    expect(b.results.map((c) => c.cardId)).toEqual(ids(8, 16));
    expect(images.mock.lastCall?.[0].map((image: { id: string }) => image.id)).toEqual([
      ...ids(8, 24),
      ...ids(0, 8),
      ...ids(24, 32),
    ]);
    publish.mockClear();
    await b.command("page\t1");
    expect(b.results.map((c) => c.cardId)).toEqual(ids(16, 24));
    expect(publish).toHaveBeenCalledTimes(1);
    expect(b.busy).toBe(false);
    await b.command("page\t-2");
    expect(b.results.map((c) => c.cardId)).toEqual(ids(0, 8));
    expect(b.busy).toBe(false);
    await tick();
    expect(pages()).toEqual([1]);
  });
  it("slices every page from the card index once it has loaded, asking /cards for none (CAT1)", async () => {
    vi.mocked(api.getCards).mockImplementation(catalogOf(() => 40));
    const images = vi.fn();
    const { b } = await setup(images);
    await tick();
    expect(api.getCardIndex).toHaveBeenCalledTimes(1);
    const seen = vi.mocked(api.getCards).mock.calls.length;
    // The index holds forty Abra and a Pikachu, all Pokemon, none of them Trainers.
    await b.command("cycle\tsupertype\t1");
    expect(b.filters.supertype).toBe("Pokémon");
    expect(b.busy).toBe(false);
    expect(b.results.map((c) => c.cardId)).toEqual(ids(0, 8));
    expect(b.total).toBe(41);
    // The prefetched pages come from it too, and page with no loading state.
    expect(images.mock.lastCall?.[0].map((image: { id: string }) => image.id)).toEqual(ids(0, 24));
    await b.command("page\t1");
    expect(b.results.map((c) => c.cardId)).toEqual(ids(8, 16));
    await b.command("sort");
    await b.command("format");
    await b.command("cycle\tsupertype\t1");
    expect(b.filters.supertype).toBe("Trainer");
    expect(b.results).toEqual([]);
    expect(b.total).toBe(0);
    await b.command(encodeFields(["filter", "hpMin", "10"]));
    await tick();
    expect(vi.mocked(api.getCards).mock.calls.length).toBe(seen);
  });
  it("searches names and rules text in the card index, loaded once, without asking /cards", async () => {
    vi.mocked(api.getCards).mockImplementation(catalogOf(() => 40));
    const images = vi.fn();
    const { b, publish } = await setup(images);
    await tick();
    // The index loads once the deck has shown, before any search needs it.
    expect(api.getCardIndex).toHaveBeenCalledTimes(1);
    const seen = vi.mocked(api.getCards).mock.calls.length;
    await b.command(encodeFields(["filter", "query", "abr"]));
    await tick();
    expect(b.results.map((c) => c.cardId)).toEqual(ids(0, 8));
    expect(b.total).toBe(40);
    // The visible page's art first, then the prefetched pages after it.
    expect(images.mock.lastCall?.[0].map((image: { id: string }) => image.id)).toEqual(ids(0, 24));
    publish.mockClear();
    for (const [first, last] of [
      [8, 16],
      [16, 24],
      [24, 32],
      [32, 40],
    ] as const) {
      await b.command("page\t1");
      expect(b.busy).toBe(false);
      expect(b.results.map((c) => c.cardId)).toEqual(ids(first, last));
      await tick();
    }
    await b.command(encodeFields(["filter", "query", ""]));
    await b.command(encodeFields(["filter", "text", "teleport"]));
    await tick();
    expect(b.total).toBe(40);
    await b.command(encodeFields(["filter", "text", "thunder"]));
    await tick();
    expect(b.results).toEqual([]);
    expect(b.total).toBe(0);
    // A name filter combines with the other dimensions, as the API's would.
    await b.command(encodeFields(["filter", "text", ""]));
    await b.command(encodeFields(["filter", "query", "pika"]));
    await tick();
    expect(b.results.map((c) => c.cardId)).toEqual(["p"]);
    await b.command("cycle\tsupertype\t2");
    await tick();
    expect(b.filters.supertype).toBe("Trainer");
    expect(b.results).toEqual([]);
    expect(vi.mocked(api.getCards).mock.calls.length).toBe(seen);
    expect(api.getCardIndex).toHaveBeenCalledTimes(1);
  });
  /** requestIdleCallback held by the test: each queued callback runs when the test says. */
  function heldIdle() {
    const idle: (() => void)[] = [];
    const requestIdleCallback = vi.fn((callback: () => void) => idle.push(callback));
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    return idle;
  }
  it("loads the card index once the first page has shown and the browser is idle", async () => {
    const idle = heldIdle();
    let answer!: (page: Awaited<ReturnType<typeof api.getCards>>) => void;
    vi.mocked(api.getCards).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const b = new LuaBuilder(vi.fn(), vi.fn());
    b.session("authenticated", "u1");
    const opening = b.command("open\tone");
    await tick();
    expect(idle).toHaveLength(0);
    answer({ items: [card("a")], total: 1, page: 1, pageSize: 8 });
    await opening;
    expect(b.results.map((c) => c.cardId)).toEqual(["a"]);
    // Parsing and preparing the index takes the main thread: not while the builder opens.
    expect(api.getCardIndex).not.toHaveBeenCalled();
    expect(idle).toHaveLength(1);
    idle[0]?.();
    expect(api.getCardIndex).toHaveBeenCalledTimes(1);
  });
  it("loads the card index after a short timer where there is no requestIdleCallback", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    await setup();
    expect(api.getCardIndex).not.toHaveBeenCalled();
    await tick();
    expect(api.getCardIndex).toHaveBeenCalledTimes(1);
  });
  it("answers a free-text search made before the idle load from the index, loaded for it", async () => {
    const idle = heldIdle();
    vi.mocked(api.getCards).mockImplementation(catalogOf(() => 40));
    const { b } = await setup();
    await tick();
    expect(api.getCardIndex).not.toHaveBeenCalled();
    await b.command(encodeFields(["filter", "query", "abr"]));
    await tick();
    expect(b.results.map((c) => c.cardId)).toEqual(ids(0, 8));
    expect(b.total).toBe(40);
    expect(api.getCardIndex).toHaveBeenCalledTimes(1);
    // The idle load then finds the index loaded.
    idle[0]?.();
    await tick();
    expect(api.getCardIndex).toHaveBeenCalledTimes(1);
  });
  it("makes a free-text search wait for an index still loading, then answers it from the index", async () => {
    const idle = heldIdle();
    vi.mocked(api.getCards).mockImplementation(catalogOf(() => 40));
    let deliver!: (payload: CardIndexPayload) => void;
    vi.mocked(api.getCardIndex).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    const { b } = await setup();
    await tick();
    idle[0]?.();
    expect(api.getCardIndex).toHaveBeenCalledTimes(1);
    await b.command(encodeFields(["filter", "query", "abr"]));
    await tick();
    expect(b.busy).toBe(true);
    deliver(ABRA_INDEX);
    await tick();
    expect(b.busy).toBe(false);
    expect(b.results.map((c) => c.cardId)).toEqual(ids(0, 8));
    expect(b.total).toBe(40);
    expect(api.getCardIndex).toHaveBeenCalledTimes(1);
  });
  it("asks /cards for a filter change while the card index is still loading, not waiting on it", async () => {
    const idle = heldIdle();
    vi.mocked(api.getCards).mockImplementation(catalogOf(() => 40));
    let deliver!: (payload: CardIndexPayload) => void;
    vi.mocked(api.getCardIndex).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    const { b } = await setup();
    idle[0]?.();
    expect(api.getCardIndex).toHaveBeenCalledTimes(1);
    await b.command("cycle\tsupertype\t2");
    expect(b.busy).toBe(false);
    expect(api.getCards).toHaveBeenCalledWith(
      expect.objectContaining({ category: "Trainer", page: 1 }),
    );
    expect(b.total).toBe(40);
    deliver(ABRA_INDEX);
    await tick();
    const seen = vi.mocked(api.getCards).mock.calls.length;
    await b.command("cycle\tsupertype\t-1");
    expect(b.filters.supertype).toBe("Pokémon");
    expect(b.total).toBe(41);
    expect(vi.mocked(api.getCards).mock.calls.length).toBe(seen);
  });
  it("does not load the card index for a builder left before the browser was idle", async () => {
    const idle = heldIdle();
    const { b } = await setup();
    b.session("anonymous", "");
    idle[0]?.();
    await tick();
    expect(api.getCardIndex).not.toHaveBeenCalled();
  });
  it("reports a search failed when the card index does not load, and loads it again on Retry", async () => {
    vi.mocked(api.getCardIndex).mockRejectedValue(new Error("offline"));
    const { b } = await setup();
    await tick();
    await b.command(encodeFields(["filter", "query", "abra"]));
    await tick();
    expect(b.message).toBe("Card search failed. Try again.");
    vi.mocked(api.getCardIndex).mockResolvedValue(ABRA_INDEX);
    await b.command("retry");
    await tick();
    expect(b.results.map((c) => c.cardId)).toEqual(ids(0, 8));
    expect(b.total).toBe(40);
    expect(b.message).toBe("");
  });
  it("asks /cards only for the pages the API caches, and the card index for the rest", async () => {
    vi.mocked(api.getCards).mockImplementation(catalogOf(() => 40));
    const { b } = await setup();
    await tick();
    await b.command("page\t3");
    await tick();
    expect(b.page).toBe(4);
    await b.command(encodeFields(["filter", "hpMin", "10"]));
    await tick();
    expect(vi.mocked(api.getCards).mock.calls.length).toBeGreaterThan(0);
    for (const [query] of vi.mocked(api.getCards).mock.calls) {
      expect(query?.page ?? 1).toBeLessThanOrEqual(MAX_CACHED_CARDS_PAGE);
      expect(query?.hpMin).toBeUndefined();
      expect(query?.total).toBeUndefined();
    }
    expect(api.getCardIndex).toHaveBeenCalledTimes(1);
  });
  it("keeps the page and requests nothing when a filter is set to the value it has", async () => {
    vi.mocked(api.getCards).mockImplementation(catalogOf(() => 40));
    const { b } = await setup();
    await tick();
    await b.command(encodeFields(["filter", "hpMin", "50"]));
    await tick();
    await b.command("page\t1");
    await tick();
    const seen = vi.mocked(api.getCards).mock.calls.length;
    // The field reports its unchanged text again when an edit starts or ends.
    await b.command(encodeFields(["filter", "hpMin", "50"]));
    await tick();
    expect(vi.mocked(api.getCards).mock.calls.length).toBe(seen);
    expect(b.results.map((c) => c.cardId)).toEqual(ids(8, 16));
  });
  it("does not apply an import after its dialog is cancelled", async () => {
    const { b } = await setup();
    await b.command("add\ta");
    forgetCardIndex();
    let resolve!: (value: CardIndexPayload) => void;
    vi.mocked(api.getCardIndex).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const importing = b.command(encodeFields(["import", "2 Abra"]));
    await b.command("cancel-import");
    resolve(ABRA_INDEX);
    await importing;
    expect([...b.entries]).toEqual([["a", 1]]);
    expect(b.message).toContain("cancelled");
  });
});

describe("deck cards before their details arrive", () => {
  type CardsPage = Awaited<ReturnType<typeof api.getCards>>;
  const B = WIRE_ROWS.builder;
  const rowsOf = (raw: unknown) =>
    String(raw)
      .split("\n")
      .map((line) => line.split("\t").map(decodeURIComponent));
  /** Each deck row as its tag, card id, name and quantity. */
  const deckRows = (raw: unknown) =>
    rowsOf(raw).flatMap((r) =>
      r[0] === "D"
        ? [
            [
              r[0],
              r[wireColumn(B.card, "cardId")],
              r[wireColumn(B.card, "name")],
              r[wireColumn(B.card, "quantity")],
            ],
          ]
        : r[0] === "L"
          ? [
              [
                r[0],
                r[wireColumn(B.pending, "cardId")],
                r[wireColumn(B.pending, "name")],
                r[wireColumn(B.pending, "quantity")],
              ],
            ]
          : [],
    );
  const validationOf = (raw: unknown) =>
    rowsOf(raw).find((r) => r[0] === "V")?.[wireColumn(B.validation, "message")];
  const headerOf = (raw: unknown, field: (typeof B.header.fields)[number]) =>
    rowsOf(raw)[0]?.[wireColumn(B.header, field)];
  const readyEmits = (publish: ReturnType<typeof vi.fn>) =>
    publish.mock.calls.map(([raw]) => raw).filter((raw) => headerOf(raw, "phase") === "ready");
  /** GET /cards?id= held until `answer` or `fail`; any other query gets one catalog page. */
  function holdDeckCards() {
    const asked: string[][] = [];
    let settle:
      | { resolve: (page: CardsPage) => void; reject: (error: unknown) => void }
      | undefined;
    vi.mocked(api.getCards).mockImplementation((query) => {
      if (!query?.id)
        return Promise.resolve({ items: [card("a"), card("b")], total: 2, page: 1, pageSize: 8 });
      asked.push([...query.id]);
      return new Promise<CardsPage>((resolve, reject) => {
        settle = { resolve, reject };
      });
    });
    return {
      asked,
      answer: (items: CardBrief[]) =>
        settle?.resolve({ items, total: items.length, page: 1, pageSize: 100 }),
      fail: () => settle?.reject(new Error("offline")),
    };
  }
  /** Open the deck and let everything but the held request answer. */
  async function opening() {
    const publish = vi.fn();
    const b = new LuaBuilder(publish, vi.fn(), vi.fn());
    b.session("authenticated", "u1");
    void b.command("open\tone");
    await tick();
    return { b, publish };
  }

  it("publishes entries as loading, never unavailable, and refuses to drop them, until their cards arrive", async () => {
    vi.mocked(api.getDeck).mockResolvedValue(deck([{ cardId: "x", count: 2 }]));
    const held = holdDeckCards();
    const { b, publish } = await opening();
    expect(held.asked).toEqual([["x"]]);
    expect(deckRows(publish.mock.lastCall?.[0])).toEqual([["L", "x", "Loading card...", "2"]]);
    expect(validationOf(publish.mock.lastCall?.[0])).toBe("Loading cards...");
    for (const raw of readyEmits(publish)) {
      expect(deckRows(raw).map((r) => r[2])).not.toContain("Unavailable card");
      expect(validationOf(raw)).not.toMatch(/unavailable/);
    }
    await b.command("discard\tx");
    await b.command("remove\tx");
    await tick();
    expect(b.entries.get("x")).toBe(2);
    expect(api.patchDeck).not.toHaveBeenCalled();
    held.answer([card("x")]);
    await tick();
    expect(deckRows(publish.mock.lastCall?.[0])).toEqual([["D", "x", "Pikachu", "2"]]);
    expect(validationOf(publish.mock.lastCall?.[0])).not.toBe("Loading cards...");
  });

  it("fills cards the page already holds into the first ready emit and asks /cards for the rest only", async () => {
    await loadCardIndex();
    vi.mocked(api.getFullCards).mockResolvedValue([card("z", "Zapdos") as unknown as Card]);
    await fetchCardPool(["z"]);
    vi.mocked(api.getDeck).mockResolvedValue(
      deck([
        { cardId: "c0", count: 2 },
        { cardId: "z", count: 1 },
      ]),
    );
    const held = holdDeckCards();
    const known = await opening();
    expect(held.asked).toEqual([]);
    const first = readyEmits(known.publish)[0];
    expect(deckRows(first)).toEqual([
      ["D", "c0", "Abra", "2"],
      ["D", "z", "Zapdos", "1"],
    ]);
    for (const raw of readyEmits(known.publish))
      expect(validationOf(raw)).not.toBe("Loading cards...");

    vi.mocked(api.getDeck).mockResolvedValue(
      deck([
        { cardId: "c0", count: 2 },
        { cardId: "q", count: 1 },
        { cardId: "z", count: 1 },
      ]),
    );
    const mixed = await opening();
    expect(held.asked).toEqual([["q"]]);
    expect(deckRows(readyEmits(mixed.publish)[0])).toEqual([
      ["D", "c0", "Abra", "2"],
      ["L", "q", "Loading card...", "1"],
      ["D", "z", "Zapdos", "1"],
    ]);
  });

  it("shows the cards of a failed request as unavailable, with Retry, and loads them on retry", async () => {
    vi.mocked(api.getDeck).mockResolvedValue(deck([{ cardId: "x", count: 2 }]));
    const held = holdDeckCards();
    const { b, publish } = await opening();
    held.fail();
    await tick();
    const failed = publish.mock.lastCall?.[0];
    expect(deckRows(failed)).toEqual([["D", "x", "Unavailable card", "2"]]);
    expect(validationOf(failed)).toBe("1 card(s) unavailable. Remove them or retry loading.");
    expect(headerOf(failed, "message")).toBe("Some cards did not load. Retry before adding.");
    expect(headerOf(failed, "retry")).toBe("1");
    void b.command("retry");
    await tick();
    expect(held.asked).toEqual([["x"], ["x"]]);
    expect(deckRows(publish.mock.lastCall?.[0])).toEqual([["L", "x", "Loading card...", "2"]]);
    held.answer([card("x")]);
    await tick();
    const loaded = publish.mock.lastCall?.[0];
    expect(deckRows(loaded)).toEqual([["D", "x", "Pikachu", "2"]]);
    expect(headerOf(loaded, "message")).toBe("");
    expect(headerOf(loaded, "retry")).toBe("0");
  });

  it("applies an add made while the deck's cards load once they arrive, counting their copies", async () => {
    vi.mocked(api.getDeck).mockResolvedValue(deck([{ cardId: "x", count: 3 }]));
    const held = holdDeckCards();
    const { b } = await opening();
    const adds = [b.command("add\ta"), b.command("add\ta")];
    held.answer([card("x")]);
    await Promise.all(adds);
    expect([...b.entries]).toEqual([
      ["x", 3],
      ["a", 1],
    ]);
    expect(b.message).toBe("This card has reached its copy limit.");
  });

  it("writes the decklist an export asks for while the deck's cards load once they arrive", async () => {
    vi.mocked(api.getDeck).mockResolvedValue(deck([{ cardId: "x", count: 2 }]));
    const held = holdDeckCards();
    const { b } = await opening();
    const exported = b.command("export");
    held.answer([card("x")]);
    await exported;
    expect(b.transfer).toContain("2 Pikachu");
    expect(b.message).toBe("");
  });
});

describe("results while a search is out", () => {
  type CardsPage = Awaited<ReturnType<typeof api.getCards>>;
  const H = WIRE_ROWS.builder.header;
  const rowsOf = (raw: unknown) =>
    String(raw)
      .split("\n")
      .map((line) => line.split("\t").map(decodeURIComponent));
  const shown = (raw: unknown) => ({
    busy: rowsOf(raw)[0]?.[wireColumn(H, "busy")],
    results: rowsOf(raw)
      .filter((r) => r[0] === "C")
      .map((r) => r[1]),
  });
  // The card index never loads unless a free-text search asks for it, so filter changes ask GET
  // /cards, as before it has loaded.
  beforeEach(() => vi.stubGlobal("requestIdleCallback", () => {}));
  /** The next GET /cards, held until the test answers it. */
  function holdNextPage() {
    let settle!: { resolve: (page: CardsPage) => void; reject: (error: unknown) => void };
    vi.mocked(api.getCards).mockImplementationOnce(
      () =>
        new Promise<CardsPage>((resolve, reject) => {
          settle = { resolve, reject };
        }),
    );
    return {
      answer: (ids: string[]) =>
        settle.resolve({
          items: ids.map((id) => card(id)),
          total: ids.length,
          page: 1,
          pageSize: 8,
        }),
      fail: () => settle.reject(new Error("offline")),
    };
  }

  it("keeps the results on screen, marked busy, until the new page lands", async () => {
    const { b, publish } = await setup();
    await tick();
    const held = holdNextPage();
    publish.mockClear();
    const searched = b.command("cycle\tsupertype\t1");
    // A quick answer would replace them without a busy emit in between.
    expect(publish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(shown(publish.mock.lastCall?.[0])).toEqual({ busy: "1", results: ["a", "b"] });
    for (const [raw] of publish.mock.calls) expect(shown(raw).results).toEqual(["a", "b"]);
    held.answer(["x", "y"]);
    await searched;
    expect(shown(publish.mock.lastCall?.[0])).toEqual({ busy: "0", results: ["x", "y"] });
  });

  it("accepts an add from the results still shown while a search is out", async () => {
    const { b } = await setup();
    await tick();
    holdNextPage();
    void b.command("format");
    await vi.advanceTimersByTimeAsync(200);
    expect(b.busy).toBe(true);
    await b.command("add\ta");
    expect(b.entries.get("a")).toBe(1);
  });

  it("clears the results when the search fails or matches nothing", async () => {
    const { b, publish } = await setup();
    await tick();
    const failing = holdNextPage();
    const failed = b.command("sort");
    failing.fail();
    await failed;
    expect(shown(publish.mock.lastCall?.[0])).toEqual({ busy: "0", results: [] });
    expect(b.message).toBe("Card search failed. Try again.");
    await b.command("retry");
    await tick();
    const empty = holdNextPage();
    const searched = b.command("sort");
    empty.answer([]);
    await searched;
    expect(shown(publish.mock.lastCall?.[0])).toEqual({ busy: "0", results: [] });
  });

  it("keeps only the results a smaller grid holds while its page loads", async () => {
    vi.mocked(api.getCards).mockImplementation(catalogOf(() => 40));
    const { b, publish } = await setup();
    await tick();
    expect(b.results).toHaveLength(8);
    holdNextPage();
    void b.command("size\t4");
    await vi.advanceTimersByTimeAsync(200);
    expect(shown(publish.mock.lastCall?.[0])).toEqual({ busy: "1", results: ids(0, 4) });
  });

  it("steps the sort forward by default and back on -1, as the Filters cycle does", async () => {
    const { b } = await setup();
    await b.command("sort");
    expect(b.filters.sort).toBe("hp-desc");
    await b.command("sort\t1");
    expect(b.filters.sort).toBe("set");
    await b.command("sort\t1");
    expect(b.filters.sort).toBe("name");
    await b.command("sort\t-1");
    expect(b.filters.sort).toBe("set");
    expect(api.getCards).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "set" }));
  });

  it("says loading at once when there are no results to keep", async () => {
    const { b, publish } = await setup();
    await tick();
    const empty = holdNextPage();
    const searched = b.command("sort");
    empty.answer([]);
    await searched;
    holdNextPage();
    publish.mockClear();
    void b.command("sort");
    expect(shown(publish.mock.lastCall?.[0])).toEqual({ busy: "1", results: [] });
  });

  it("publishes a search the card index answers once, with its results", async () => {
    vi.mocked(api.getCards).mockImplementation(catalogOf(() => 40));
    const { b, publish } = await setup();
    await tick();
    await b.command(encodeFields(["filter", "query", "abr"]));
    publish.mockClear();
    await vi.advanceTimersByTimeAsync(260);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(shown(publish.mock.lastCall?.[0])).toEqual({ busy: "0", results: ids(0, 8) });
  });
});

describe("card details", () => {
  const H = WIRE_ROWS.builder.header;
  const C = WIRE_ROWS.builder.card;
  const rowsOf = (raw: unknown) =>
    String(raw)
      .split("\n")
      .map((line) => line.split("\t").map(decodeURIComponent));
  const fullCard = (id: string) =>
    ({
      ...card(id, "Charmander"),
      effect: null,
      abilities: null,
      attacks: [{ name: "Ember", damage: 30, effect: "Discard an Energy." }],
    }) as unknown as Card;
  type Engine = Awaited<typeof import("@colorless/engine")>;
  /** A builder whose rules engine loads only when the test says. */
  async function heldEngine() {
    let load!: (engine: Pick<Engine, "simulationGaps">) => void;
    const loaded = new Promise<Pick<Engine, "simulationGaps">>((resolve) => {
      load = resolve;
    });
    const engine = vi.fn(() => loaded);
    const publish = vi.fn();
    const b = new LuaBuilder(publish, vi.fn(), vi.fn(), engine);
    b.session("authenticated", "u1");
    await b.command("open\tone");
    return {
      b,
      publish,
      engine,
      load: (gaps: string[]) => load({ simulationGaps: () => gaps as never }),
    };
  }

  it("shows a card's rules text before the rules engine loads, and its gaps once it does", async () => {
    let answer!: (c: Card) => void;
    vi.mocked(api.getCard).mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const { b, publish, engine, load } = await heldEngine();
    const opened = b.command("detail\ta");
    // The engine loads alongside the card's request, which has not answered yet.
    expect(engine).toHaveBeenCalledTimes(1);
    answer(fullCard("a"));
    await opened;
    const shown = rowsOf(publish.mock.lastCall?.[0]);
    expect(shown[0]?.[wireColumn(H, "details")]).toBe("Ember  30\nDiscard an Energy.");
    const selected = () => rowsOf(publish.mock.lastCall?.[0]).find((r) => r[0] === "S");
    expect(selected()?.[wireColumn(C, "gaps")]).toBe("");
    load(["attack"]);
    await tick();
    expect(selected()?.[wireColumn(C, "gaps")]).toBe("attack");
  });

  it("asks GET /cards/:id once per card, from the card pool's cache", async () => {
    vi.mocked(api.getCard).mockImplementation(async (id) => fullCard(id));
    const { b, load } = await heldEngine();
    load([]);
    await b.command("detail\ta");
    await b.command("detail\tb");
    await b.command("detail\ta");
    expect(vi.mocked(api.getCard).mock.calls).toEqual([["a"], ["b"]]);
    expect(b.details).toBe("Ember  30\nDiscard an Energy.");
  });

  it("says the details could not load, and loads them on the next try", async () => {
    vi.mocked(api.getCard).mockRejectedValueOnce(new Error("offline"));
    vi.mocked(api.getCard).mockResolvedValue(fullCard("a"));
    const { b, load } = await heldEngine();
    load([]);
    await b.command("detail\ta");
    expect(b.details).toBe("Details could not load. Close and reopen to retry.");
    await b.command("detail\ta");
    expect(b.details).toBe("Ember  30\nDiscard an Energy.");
  });
});

describe("filter options", () => {
  it("asks for the filter options alongside the deck, once, and the decklist import reuses them", async () => {
    let answer!: (d: Deck) => void;
    vi.mocked(api.getDeck).mockImplementationOnce(
      () =>
        new Promise((r) => {
          answer = r;
        }),
    );
    vi.mocked(api.getSets).mockResolvedValue([
      { id: "sv01", name: "Scarlet & Violet", abbreviation: "SVI" },
    ] as Awaited<ReturnType<typeof api.getSets>>);
    const publish = vi.fn();
    const b = new LuaBuilder(publish, vi.fn(), vi.fn());
    b.session("authenticated", "u1");
    const opened = b.command("open\tone");
    // Still waiting on the deck: the options are already on their way.
    expect(api.getFacets).toHaveBeenCalledTimes(1);
    expect(api.getSets).toHaveBeenCalledTimes(1);
    expect(api.getSeries).toHaveBeenCalledTimes(1);
    answer(deck());
    await opened;
    expect(b.options().find((o) => o.key === "setId")?.labels).toEqual(["All", "Scarlet & Violet"]);
    // A second deck, and an import naming a set code, ask for none of them again.
    b.session("authenticated", "u2");
    await b.command("open\ttwo");
    await b.command(encodeFields(["import", "2 Abra SVI 1"]));
    expect(api.getFacets).toHaveBeenCalledTimes(1);
    expect(api.getSets).toHaveBeenCalledTimes(1);
    expect(api.getSeries).toHaveBeenCalledTimes(1);
  });

  it("asks again for options that failed to load, on Retry", async () => {
    vi.mocked(api.getFacets).mockRejectedValueOnce(new Error("offline"));
    const { b } = await setup();
    expect(b.message).toBe("Filter options did not load. Retry to reconnect.");
    await b.command("retry");
    expect(api.getFacets).toHaveBeenCalledTimes(2);
    // Sets and series loaded the first time, so Retry does not ask for them again.
    expect(api.getSets).toHaveBeenCalledTimes(1);
    expect(b.message).toBe("");
  });
});

describe("builder deck name", () => {
  const nameOf = (raw: string) =>
    decodeFields(raw.split("\n")[0] ?? "")?.[wireColumn(WIRE_ROWS.builder.header, "name")];

  it("keeps the saved name when a name edit ends blank, and says so", async () => {
    const { b, publish } = await setup();
    await b.command(encodeFields(["name", "", "input"]));
    expect(b.message).toBe("");
    await b.command(encodeFields(["name", "   ", "done"]));
    expect(b.name).toBe("Electric Dreams");
    expect(b.message).toBe("A deck needs a name. Kept Electric Dreams.");
    expect(nameOf(publish.mock.lastCall?.[0])).toBe("Electric Dreams");
    await tick();
    expect(b.hasUnsavedEdits()).toBe(false);
    expect(api.patchDeck).not.toHaveBeenCalled();
  });

  it("keeps the last name it held, and lets a real name through without a message", async () => {
    const { b } = await setup();
    await b.command(encodeFields(["name", "Bolt", "input"]));
    await b.command(encodeFields(["name", " Bolt ", "enter"]));
    expect(b.message).toBe("");
    await b.command(encodeFields(["name", "", "input"]));
    await b.command(encodeFields(["name", "", "enter"]));
    expect(b.name).toBe("Bolt");
    expect(b.message).toBe("A deck needs a name. Kept Bolt.");
    await b.command(encodeFields(["name", "Volt", "input"]));
    expect(b.message).toBe("");
  });

  it("shortens a long kept name so the message stays on its line", async () => {
    const long = "W".repeat(DECK_NAME_MAX);
    vi.mocked(api.getDeck).mockResolvedValue({ ...deck(), name: long });
    const { b } = await setup();
    await b.command(encodeFields(["name", "", "done"]));
    expect(b.name).toBe(long);
    expect(b.message).toMatch(/^A deck needs a name\. Kept W+\.\.\.$/);
    expect(messageWidth(b.message)).toBeLessThanOrEqual(280);
  });

  it("ends a shortened kept name in its three dots, with no space before them (QA7)", () => {
    // Names that differ in their first word's length, so some cut lands right after a space.
    for (let pad = 1; pad <= 12; pad++) {
      const message = keptNameMessage(
        `${"A".repeat(pad)} Extremely Long Deck Name That Keeps Going Past The Line`,
      );
      expect(message).toMatch(/^A deck needs a name\. Kept A+ .*[^\s.]\.\.\.$/);
      expect(message).not.toMatch(/\.\.\.\.$/);
      expect(messageWidth(message)).toBeLessThanOrEqual(280);
    }
  });

  it("validates a name as the library does: 1 to 100 characters once trimmed", () => {
    expect(deckNameOrNull("  Bolt ")).toBe("Bolt");
    expect(deckNameOrNull("   ")).toBeNull();
    expect(deckNameOrNull("x".repeat(DECK_NAME_MAX))).toBe("x".repeat(DECK_NAME_MAX));
    expect(deckNameOrNull("x".repeat(DECK_NAME_MAX + 1))).toBeNull();
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
    for (const message of FIXED_MESSAGES)
      expect(messageWidth(message), message).toBeLessThanOrEqual(MAX);
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
