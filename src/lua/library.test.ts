import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fullCardsFrom, json, stubFetch } from "../test/fetchStub";
import { cardBrief } from "../test/fixtures";
import { clearCardPoolCache } from "../game/cardPool";
import { deckStore } from "../decks/deckStore";
import { decodeFields, encodeFields } from "./wire";
import { LuaLibrary } from "./library";
import { WIRE_ROWS, wireColumn } from "./wireFields";

const decks = [
  {
    id: "a",
    name: "Zebra",
    folderId: null,
    cardCount: 60,
    tint: 0,
    coverCardId: null,
    position: 0,
  },
  {
    id: "b",
    name: "Árbol\t%",
    folderId: "f",
    cardCount: 20,
    tint: 90,
    coverCardId: "sv-1",
    position: 1,
  },
  {
    id: "c",
    name: "Apple",
    folderId: null,
    cardCount: 40,
    tint: 180,
    coverCardId: null,
    position: 2,
  },
];
const reads = { "GET /decks": () => json(decks) };
const setup = async () => {
  const publish = vi.fn();
  const open = vi.fn();
  const library = new LuaLibrary(publish, open);
  library.session("authenticated", "user");
  await library.command("open");
  return { library, publish, open };
};
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  clearCardPoolCache();
  deckStore.reset();
});
/** A deck as POST or PATCH /decks answers it. */
const saved = (id: string, name: string, position = 0) => ({
  id,
  name,
  format: null,
  folderId: null,
  tint: 0,
  position,
  updated: "2026-10-01T00:00:00.000Z",
  cards: [],
  chosenCoverCardId: null,
});
const header = (snapshot: unknown) => {
  const fields = decodeFields(String(snapshot).split("\n")[0] ?? "") ?? [];
  return (name: (typeof WIRE_ROWS.library.header.fields)[number]) =>
    fields[wireColumn(WIRE_ROWS.library.header, name)];
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const deckRows = (snapshot: unknown) =>
  Object.fromEntries(
    String(snapshot)
      .split("\n")
      .filter((line) => line.startsWith("D\t"))
      .map((line) => line.split("\t"))
      .map((fields) => [fields[1], fields[wireColumn(WIRE_ROWS.library.deck, "illegal")]]),
  );
describe("Lua deck library", () => {
  it("marks incomplete decks illegal at once and judges complete ones in the background", async () => {
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
    const rotated = { ...card, id: "old", legal: { standard: false, expanded: true } };
    const energy = {
      ...card,
      id: "energy",
      name: "Basic Grass Energy",
      category: "Energy",
      energyType: "Normal",
      stage: null,
    };
    const filled = (cardId: string) => [
      { cardId, count: 4 },
      { cardId: "energy", count: 56 },
    ];
    const contents = (cards: { cardId: string; count: number }[]) => ({
      id: "a",
      name: "Zebra",
      format: "standard",
      cards,
    });
    const complete = [
      ...decks,
      {
        id: "d",
        name: "Rotated",
        folderId: null,
        cardCount: 60,
        tint: 0,
        coverCardId: null,
        position: 3,
      },
    ];
    stubFetch({
      "GET /decks": () => json(complete),
      "GET /decks/a": () => json(contents(filled(card.id))),
      "GET /decks/d": () => json({ ...contents(filled("old")), id: "d" }),
      "GET /cards/full": fullCardsFrom({ [card.id]: card, old: rotated, energy }),
    });
    const { publish } = await setup();
    expect(deckRows(publish.mock.lastCall?.[0])).toEqual({ a: "", b: "1", c: "1", d: "" });
    await flush();
    await flush();
    expect(deckRows(publish.mock.lastCall?.[0])).toEqual({ a: "0", b: "1", c: "1", d: "1" });
  });
  it("leaves piles unmarked when a legality check fails", async () => {
    stubFetch({
      "GET /decks": () => json(decks),
      "GET /decks/a": () => json({ error: "down" }, 500),
    });
    const { library, publish } = await setup();
    await flush();
    await flush();
    expect(library.phase).toBe("ready");
    expect(deckRows(publish.mock.lastCall?.[0])).toEqual({ a: "", b: "1", c: "1" });
  });
  it("loads the shared API, searches across folders and escapes mailbox delimiters", async () => {
    stubFetch(reads);
    const { library, publish, open } = await setup();
    expect(library.visible().decks.map((d) => d.id)).toEqual(["c", "b", "a"]);
    await library.command(encodeFields(["search", "ÁRBOL"]));
    expect(library.visible().decks.map((d) => d.id)).toEqual(["b"]);
    const row = String(publish.mock.lastCall?.[0])
      .split("\n")[1]
      ?.split("\t")
      .map(decodeURIComponent);
    expect(row?.slice(0, 3)).toEqual(["D", "b", "Árbol\t%"]);
    await library.command("edit\tb");
    expect(open).toHaveBeenCalledWith("b");
    await library.command("edit\tunknown");
    expect(open).toHaveBeenCalledTimes(1);
  });
  it("sorts all decks and wraps pages", async () => {
    stubFetch(reads);
    const { library } = await setup();
    await library.command("sort\tname-asc");
    expect(library.visible().decks.map((d) => d.id)).toEqual(["c", "b", "a"]);
    await library.command("sort\tcards-desc");
    expect(library.visible().decks.map((d) => d.id)).toEqual(["a", "c", "b"]);
    await library.command("page\t1");
    expect(library.page).toBe(1);
    library.size = 1;
    await library.command("page\t-1");
    expect(library.page).toBe(3);
    await library.command("page\t1");
    expect(library.page).toBe(1);
  });
  it("ignores stale folder commands without reading or mutating folders", async () => {
    const { calls } = stubFetch(reads);
    const { library } = await setup();
    await library.command("move\tfolder\tf\tchild");
    await library.command("move\tfolder\tf\tf");
    await library.command("create\tfolder\tHidden");
    await library.command("delete\tfolder\tf");
    expect(calls).toEqual(["GET /decks"]);
  });
  it("creates root decks and validates names", async () => {
    const { impl } = stubFetch({
      ...reads,
      "POST /decks": () => json(saved("n", "A new deck", -1), 201),
    });
    const { library } = await setup();
    await library.command("create\tdeck\t%20%20");
    expect(library.message).toContain("1 to 100");
    library.message = "";
    await library.command(encodeFields(["create", "deck", "x".repeat(101)]));
    expect(library.message).toContain("1 to 100");
    expect(impl.mock.calls.some(([, i]) => i?.method === "POST")).toBe(false);
    await library.command(encodeFields(["create", "deck", "  A new deck  "]));
    const call = impl.mock.calls.find(([, i]) => i?.method === "POST");
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      name: "A new deck",
      folderId: null,
      cards: [],
    });
    expect(library.result).toBe("ok");
  });
  it("renames and deletes decks without changing folder membership", async () => {
    const { impl } = stubFetch({
      ...reads,
      "PATCH /decks/b": () => json({ ...saved("b", "Renamed", 1), folderId: "f" }),
      "DELETE /decks/a": () => new Response(null, { status: 204 }),
    });
    const { library } = await setup();
    await library.command(encodeFields(["rename", "deck", "b", " Renamed "]));
    const patch = impl.mock.calls.find(([, i]) => i?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ name: "Renamed" });
    await library.command("delete\tdeck\ta");
    expect(impl.mock.calls.filter(([, i]) => i?.method === "DELETE")).toHaveLength(1);
    expect(library.result).toBe("ok");
  });
  it("reconciles a failed deck write and keeps the error visible", async () => {
    const { calls } = stubFetch({ ...reads, "PATCH /decks/b": () => json({}, 503) });
    const { library } = await setup();
    await library.command("rename\tdeck\tb\tRenamed");
    expect(calls.filter((c) => c === "GET /decks")).toHaveLength(2);
    expect(library.result).toBe("error");
    expect(library.message).toContain("Could not save");
  });
  it("shows a rename's answer at once and fetches the list again behind it", async () => {
    let held: (() => void) | undefined;
    let named = "Árbol\t%";
    const { calls } = stubFetch({
      "GET /decks": () => {
        const list = decks.map((d) => (d.id === "b" ? { ...d, name: named } : d));
        if (calls.filter((c) => c === "GET /decks").length === 1) return json(list);
        return new Promise<Response>((done) => {
          held = () => done(json(list));
        });
      },
      "PATCH /decks/b": () => json({ ...saved("b", "Renamed", 1), folderId: "f" }),
    });
    const { library, publish } = await setup();
    named = "Renamed";
    const rename = library.command(encodeFields(["rename", "deck", "b", "Renamed"]));
    await vi.waitFor(() => expect(header(publish.mock.lastCall?.[0])("result")).toBe("ok"));
    expect(header(publish.mock.lastCall?.[0])("busy")).toBe("0");
    expect(library.decks.find((d) => d.id === "b")?.name).toBe("Renamed");
    expect(calls).toEqual(["GET /decks", "PATCH /decks/b", "GET /decks"]);
    held?.();
    await rename;
    expect(library.decks.find((d) => d.id === "b")?.name).toBe("Renamed");
  });
  it("adds a created deck and drops a deleted one from the server's answer", async () => {
    stubFetch({
      ...reads,
      "POST /decks": () => json(saved("n", "Fresh", -1), 201),
      "DELETE /decks/a": () => new Response(null, { status: 204 }),
    });
    const { library } = await setup();
    let shown: string[] = [];
    const watch = vi.spyOn(library, "emit").mockImplementation(function (this: LuaLibrary) {
      if (this.result === "ok" && shown.length === 0) shown = this.decks.map((d) => d.id);
      return LuaLibrary.prototype.emit.call(this);
    });
    await library.command(encodeFields(["create", "deck", "Fresh"]));
    expect(shown).toEqual(["n", "a", "b", "c"]);
    shown = [];
    await library.command("delete\tdeck\ta");
    expect(shown).not.toContain("a");
    watch.mockRestore();
  });
  it("opens on the list another screen already fetched, before its own request answers", async () => {
    stubFetch(reads);
    await deckStore.revalidate("user");
    let answer: (() => void) | undefined;
    stubFetch({
      "GET /decks": () =>
        new Promise<Response>((done) => {
          answer = () => done(json(decks));
        }),
    });
    const publish = vi.fn();
    const library = new LuaLibrary(publish, () => {});
    library.session("authenticated", "user");
    const open = library.command("open");
    expect(header(publish.mock.lastCall?.[0])("phase")).toBe("ready");
    expect(library.decks.map((d) => d.id)).toEqual(["a", "b", "c"]);
    answer?.();
    await open;
    expect(library.phase).toBe("ready");
  });
  it("says why a create was refused when the account holds the most decks it can", async () => {
    stubFetch({
      ...reads,
      "POST /decks": () => json({ error: "deck limit reached", limit: 500 }, 409),
    });
    const { library } = await setup();
    await library.command(encodeFields(["create", "deck", "One more"]));
    expect(library.result).toBe("error");
    expect(library.message).toBe("Your library is full (500 decks). Delete one to make room.");
  });
  it("falls back from saved Manual and ignores stale manual sort/reorder commands", async () => {
    localStorage.setItem("decks.sortKey", "manual");
    const { calls } = stubFetch(reads);
    const { library } = await setup();
    expect(library.sort).toBe("name-asc");
    await library.command("sort\tmanual");
    await library.command("order\tdeck\tc\tearlier");
    expect(library.sort).toBe("name-asc");
    expect(calls).toEqual(["GET /decks"]);
  });
  it("says why the library failed when the session check cannot reach the server", () => {
    const publish = vi.fn();
    const library = new LuaLibrary(publish, () => {});
    library.session("error", "");
    const [header] = String(publish.mock.lastCall?.[0]).split("\n");
    const fields = decodeFields(header ?? "") ?? [];
    const column = (name: "phase" | "message") => wireColumn(WIRE_ROWS.library.header, name);
    expect(fields[column("phase")]).toBe("error");
    expect(fields[column("message")]).toBe("Check your connection, then try again.");
  });
  it("discards a late load after sign-out", async () => {
    let settle!: (r: Response) => void;
    stubFetch({
      ...reads,
      "GET /decks": () =>
        new Promise<Response>((resolve) => {
          settle = resolve;
        }),
    });
    const library = new LuaLibrary(
      () => {},
      () => {},
    );
    library.session("authenticated", "user");
    const pending = library.command("open");
    library.session("anonymous", "");
    settle(json(decks));
    await pending;
    expect(library.decks).toEqual([]);
    expect(library.phase).toBe("anonymous");
    expect(library.busy).toBe(false);
  });
});
