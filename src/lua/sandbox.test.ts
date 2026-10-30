import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fullCardsFrom, json, stubFetch } from "../test/fetchStub";
import { cardBrief } from "../test/fixtures";
import { clearCardPoolCache } from "../game/cardPool";
import { deckStore } from "../decks/deckStore";
import { loadSimulatorSave } from "../game/simulatorSave";
import { LuaSandbox } from "./sandbox";
import { launchSandbox } from "./sandboxLaunch";

const SAVED = "2026-10-01T00:00:00.000Z";
const EDITED = "2026-10-02T00:00:00.000Z";
/** The list as an api before summary card lists served it: the picker fetches each complete deck. */
const legacy = [
  { id: "b", name: "Training Deck", cardCount: 60, folderId: "folder", updated: SAVED },
  { id: "a", name: "Electric\tDreams%", cardCount: 60, folderId: null, updated: SAVED },
  { id: "empty", name: "Empty", cardCount: 0, folderId: null, updated: SAVED },
];
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
const contents = (count = 60) => [
  { cardId: card.id, count: 4 },
  { cardId: energy.id, count: count - 4 },
];
const full = (id: string, count = 60, updated = SAVED) => ({
  id,
  name: legacy.find((deck) => deck.id === id)?.name ?? id,
  format: "standard",
  updated,
  cards: contents(count),
});
/** The list as GET /decks serves it now: each complete deck carries its format and cards. */
const decks = legacy.map((deck) =>
  deck.cardCount === 60 ? { ...deck, format: "standard", cards: contents() } : deck,
);
const reads = {
  "GET /decks": () => json(decks),
  "GET /cards/full": fullCardsFrom({ [card.id]: card, energy }),
};
const legacyReads = {
  ...reads,
  "GET /decks": () => json(legacy),
  "GET /decks/a": () => json(full("a")),
  "GET /decks/b": () => json(full("b")),
};
async function setup() {
  const publish = vi.fn();
  const launch = vi.fn();
  const sandbox = new LuaSandbox(publish, async () => launch);
  sandbox.session("authenticated", "user");
  await sandbox.command("open");
  return { sandbox, publish, launch };
}
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => {
  clearCardPoolCache();
  deckStore.reset();
  vi.unstubAllGlobals();
});
/** GET /decks held until `answer()`, the other reads at once. */
const heldDecks = () => {
  let answer: () => void = () => {};
  const stub = stubFetch({
    ...reads,
    "GET /decks": () =>
      new Promise<Response>((done) => {
        answer = () => done(json(decks));
      }),
  });
  return { ...stub, answer: () => answer() };
};
const phaseOf = (publish: ReturnType<typeof vi.fn>) =>
  String(publish.mock.lastCall?.[0]).split("\t")[1];
const deckIds = (publish: ReturnType<typeof vi.fn>) =>
  String(publish.mock.lastCall?.[0])
    .split("\n")
    .slice(1)
    .map((row) => row.split("\t")[1]);

describe("Lua sandbox setup", () => {
  it("ignores a command with a malformed percent-sequence", async () => {
    const publish = vi.fn();
    await expect(
      new LuaSandbox(publish, async () => () => {}).command("pick\t%"),
    ).resolves.toBeUndefined();
    expect(publish).not.toHaveBeenCalled();
  });
  it("warms the game table's code once the picker has its decks, not competing with them", async () => {
    let answer: (response: Response) => void = () => {};
    stubFetch({
      ...reads,
      "GET /decks": () =>
        new Promise<Response>((done) => {
          answer = done;
        }),
    });
    const warm = vi.fn();
    const sandbox = new LuaSandbox(vi.fn(), async () => () => {}, warm);
    sandbox.session("authenticated", "user");
    const open = sandbox.command("open");
    await new Promise((done) => setTimeout(done, 0));
    expect(warm).not.toHaveBeenCalled();
    answer(json(decks));
    await open;
    expect(sandbox.phase).toBe("ready");
    expect(warm).toHaveBeenCalledTimes(1);
  });
  it("says Loading only while it has no decks to show", async () => {
    const held = heldDecks();
    const publish = vi.fn();
    const sandbox = new LuaSandbox(publish, async () => () => {});
    sandbox.session("authenticated", "user");
    const open = sandbox.command("open");
    expect(phaseOf(publish)).toBe("loading");
    held.answer();
    await open;
    expect(phaseOf(publish)).toBe("ready");
  });
  it("keeps its decks on screen and playable while it checks them again", async () => {
    stubFetch(reads);
    const { sandbox, publish } = await setup();
    await sandbox.command("close");
    // Without the store's copy too: the picker keeps what it shows.
    deckStore.reset();
    const held = heldDecks();
    const reopen = sandbox.command("open");
    expect(phaseOf(publish)).toBe("ready");
    expect(deckIds(publish)).toEqual(["a", "b"]);
    expect(String(publish.mock.lastCall?.[0]).split("\t")[2]).toBe("0");
    await sandbox.command("select\t2\tb");
    expect(sandbox.selected).toEqual(["a", "b"]);
    held.answer();
    await reopen;
    expect(deckIds(publish)).toEqual(["a", "b"]);
    expect(sandbox.selected).toEqual(["a", "b"]);
  });
  it("judges a list the store holds while it is checked again, not after", async () => {
    stubFetch(reads);
    await deckStore.revalidate("user");
    const held = heldDecks();
    const publish = vi.fn();
    const sandbox = new LuaSandbox(publish, async () => () => {});
    sandbox.session("authenticated", "user");
    const open = sandbox.command("open");
    expect(phaseOf(publish)).toBe("loading");
    await vi.waitFor(() => expect(phaseOf(publish)).toBe("ready"));
    expect(deckIds(publish)).toEqual(["a", "b"]);
    expect(held.calls.filter((call) => call === "GET /decks")).toHaveLength(1);
    held.answer();
    await open;
    expect(deckIds(publish)).toEqual(["a", "b"]);
  });
  it("opens on the decks another screen already judged, without judging them again", async () => {
    const { calls } = stubFetch(reads);
    const list = await deckStore.revalidate("user");
    await deckStore.judge(list);
    const held = heldDecks();
    const publish = vi.fn();
    const sandbox = new LuaSandbox(publish, async () => () => {});
    sandbox.session("authenticated", "user");
    const open = sandbox.command("open");
    expect(phaseOf(publish)).toBe("ready");
    expect(deckIds(publish)).toEqual(["a", "b"]);
    held.answer();
    await open;
    expect([...calls, ...held.calls].filter((c) => c === "GET /cards/full")).toHaveLength(1);
  });
  it("loads decks across folders, escapes names and selects each player independently", async () => {
    const { calls } = stubFetch(reads);
    const { sandbox, publish } = await setup();
    expect(sandbox.selected).toEqual(["a", "a"]);
    expect(publish.mock.lastCall?.[0]).toContain("Electric%09Dreams%25");
    await sandbox.command("select\t2\tb");
    expect(sandbox.selected).toEqual(["a", "b"]);
    await sandbox.command("select\t2\ta");
    expect(sandbox.selected).toEqual(["a", "a"]);
    await sandbox.command("select\t1\tnot-a-deck");
    expect(sandbox.selected).toEqual(["a", "a"]);
    expect(calls).toEqual(["GET /decks", "GET /cards/full"]);
  });
  it("fetches each complete deck from an api whose list carries no cards, and starts from them", async () => {
    const { calls } = stubFetch(legacyReads);
    const { sandbox, launch } = await setup();
    expect(sandbox.decks.map((deck) => deck.id)).toEqual(["a", "b"]);
    expect(calls).toHaveLength(4);
    expect(calls).not.toContain("GET /decks/empty");
    await sandbox.command("start");
    expect(launch).toHaveBeenCalledOnce();
  });
  it("hides incomplete decks and allows both players to use the same complete deck", async () => {
    stubFetch(reads);
    const { sandbox, launch } = await setup();
    await sandbox.command("select\t1\tempty");
    expect(sandbox.decks.map((deck) => deck.id)).toEqual(["a", "b"]);
    expect(sandbox.selected).toEqual(["a", "a"]);
    await sandbox.command("start");
    expect(launch).toHaveBeenCalledOnce();
    const game = launch.mock.calls[0]?.[0];
    expect(game.names).toEqual({ p1: "Player 1", p2: "Player 2" });
    expect(game.state.firstPlayer).toBeNull();
  });
  it("starts from the contents the list carried without fetching them", async () => {
    const { calls } = stubFetch(reads);
    const { sandbox, launch } = await setup();
    const fetched = calls.length;
    await sandbox.command("select\t2\tb");
    await sandbox.command("start");
    expect(launch).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(fetched);
  });
  it("revalidates contents it fetches at the start, including card count and Basic Pokémon", async () => {
    stubFetch(legacyReads);
    const { sandbox, launch } = await setup();
    stubFetch({ ...legacyReads, "GET /decks/a": () => json(full("a", 59)) });
    await sandbox.command("start");
    expect(sandbox.message).toContain("59 cards");
    expect(launch).not.toHaveBeenCalled();
    clearCardPoolCache();
    stubFetch({
      ...legacyReads,
      "GET /cards/full": fullCardsFrom({
        [card.id]: { ...card, category: "Energy", energyType: "Normal", stage: null },
        energy,
      }),
    });
    await sandbox.command("start");
    expect(sandbox.message).toContain("no Basic Pokémon");
    expect(launch).not.toHaveBeenCalled();
  });
  it("hands off an exact restorable game and never navigates if storage fails", async () => {
    stubFetch(reads);
    const { sandbox, launch } = await setup();
    await sandbox.command("select\t2\tb");
    await sandbox.command("start");
    const game = launch.mock.calls[0]?.[0];
    const navigate = vi.fn();
    launchSandbox(game, navigate);
    expect(navigate).toHaveBeenCalledOnce();
    expect(loadSimulatorSave()?.game).toEqual(game.state);
    expect(loadSimulatorSave()?.log.length).toBeGreaterThan(0);
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(() => launchSandbox(game, navigate)).toThrow("browser storage");
    expect(navigate).toHaveBeenCalledOnce();
  });
  it("rejects double starts and cancels the handoff if the user leaves while loading", async () => {
    // An api whose list carries no cards, so the start has a fetch to hold open.
    stubFetch(legacyReads);
    const { sandbox, launch } = await setup();
    let finish!: (response: Response) => void;
    const { calls } = stubFetch({
      ...legacyReads,
      "GET /decks/a": () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    await sandbox.command("select\t2\tb");
    const pending = sandbox.command("start");
    await sandbox.command("start");
    await vi.waitFor(() => expect(calls).toContain("GET /decks/a"));
    await sandbox.command("close");
    finish(json(full("a")));
    await pending;
    expect(calls.filter((path) => path === "GET /decks/a")).toHaveLength(1);
    expect(launch).not.toHaveBeenCalled();
  });
  it("does not hand off a game the user left while the handoff was still loading", async () => {
    stubFetch(reads);
    const launch = vi.fn();
    let loaded!: (launch: () => void) => void;
    const sandbox = new LuaSandbox(
      vi.fn(),
      () =>
        new Promise((resolve) => {
          loaded = resolve;
        }),
    );
    sandbox.session("authenticated", "user");
    await sandbox.command("open");
    const pending = sandbox.command("start");
    await vi.waitFor(() => expect(loaded).toBeDefined());
    await sandbox.command("close");
    loaded(launch);
    await pending;
    expect(launch).not.toHaveBeenCalled();
  });
  it("clears selections on sign-out and ignores stale account responses", async () => {
    let finish!: (response: Response) => void;
    stubFetch({
      "GET /decks": () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const sandbox = new LuaSandbox(vi.fn(), async () => () => {});
    sandbox.session("authenticated", "old-user");
    const pending = sandbox.command("open");
    sandbox.session("anonymous", "");
    finish(json(decks));
    await pending;
    expect(sandbox.phase).toBe("anonymous");
    expect(sandbox.decks).toEqual([]);
    expect(sandbox.selected).toEqual(["", ""]);
  });
  it("shows retry/empty states and refreshes deleted selections", async () => {
    stubFetch({ "GET /decks": () => json({ error: "down" }, 503) });
    const { sandbox } = await setup();
    expect(sandbox.phase).toBe("error");
    stubFetch(reads);
    await sandbox.command("refresh");
    expect(sandbox.selected).toEqual(["a", "a"]);
    stubFetch({ "GET /decks": () => json([]) });
    await sandbox.command("refresh");
    expect(sandbox.phase).toBe("ready");
    expect(sandbox.selected).toEqual(["", ""]);
  });
  it("offers any deck a game can run, whatever its copies or format, but not one with no Basic or a missing card", async () => {
    const names = ["valid", "no-basic", "copies", "missing", "standard", "expanded", "deleted"];
    const summaries = names.map((id) => ({ ...legacy[0], id, name: id }));
    const custom = (
      id: string,
      cards: { cardId: string; count: number }[],
      format = "standard",
    ) => ({ ...full(id), cards, format });
    stubFetch({
      ...reads,
      "GET /decks": () => json(summaries),
      "GET /decks/valid": () => json(full("valid")),
      "GET /decks/no-basic": () => json(custom("no-basic", [{ cardId: "energy", count: 60 }])),
      "GET /decks/copies": () =>
        json(
          custom("copies", [
            { cardId: card.id, count: 5 },
            { cardId: "energy", count: 55 },
          ]),
        ),
      "GET /decks/missing": () =>
        json(
          custom("missing", [
            { cardId: "absent", count: 4 },
            { cardId: "energy", count: 56 },
          ]),
        ),
      "GET /decks/standard": () =>
        json(
          custom("standard", [
            { cardId: "old", count: 4 },
            { cardId: "energy", count: 56 },
          ]),
        ),
      "GET /decks/expanded": () =>
        json(
          custom(
            "expanded",
            [
              { cardId: "old", count: 4 },
              { cardId: "energy", count: 56 },
            ],
            "expanded",
          ),
        ),
      "GET /decks/deleted": () => json({ error: "not found" }, 404),
      "GET /cards/full": fullCardsFrom({
        [card.id]: card,
        energy,
        old: { ...card, id: "old", legal: { standard: false, expanded: true } },
      }),
    });
    const { sandbox, launch } = await setup();
    expect(sandbox.decks.map((deck) => deck.id)).toEqual([
      "copies",
      "expanded",
      "standard",
      "valid",
    ]);
    expect(sandbox.selected).toEqual(["copies", "copies"]);
    await sandbox.command("select\t2\tstandard");
    await sandbox.command("start");
    expect(sandbox.message).toBe("");
    expect(launch).toHaveBeenCalledOnce();
  });
  it("keeps catalog failures retryable and shows an empty chooser when every deck is invalid", async () => {
    stubFetch({ ...reads, "GET /cards/full": () => json({ error: "down" }, 503) });
    const { sandbox } = await setup();
    expect(sandbox.phase).toBe("error");
    stubFetch(reads);
    await sandbox.command("refresh");
    expect(sandbox.decks).toHaveLength(2);
    const noBasic = [{ cardId: energy.id, count: 60 }];
    stubFetch({
      ...reads,
      "GET /decks": () =>
        json(
          decks.map((deck) => ({
            ...deck,
            updated: EDITED,
            ...(deck.cardCount === 60 && { cards: noBasic }),
          })),
        ),
    });
    await sandbox.command("refresh");
    expect(sandbox.phase).toBe("ready");
    expect(sandbox.decks).toEqual([]);
    expect(sandbox.selected).toEqual(["", ""]);
  });
  it("judges every reload from the list alone, the card pool already in hand", async () => {
    const { calls } = stubFetch(reads);
    const { sandbox } = await setup();
    calls.length = 0;
    await sandbox.command("refresh");
    expect(calls).toEqual(["GET /decks"]);
    const edited = stubFetch({
      ...reads,
      "GET /decks": () =>
        json(
          decks.map((deck) =>
            deck.id === "a" ? { ...deck, updated: EDITED, cardCount: 59, cards: undefined } : deck,
          ),
        ),
    });
    await sandbox.command("refresh");
    expect(edited.calls).toEqual(["GET /decks"]);
    expect(sandbox.decks.map((deck) => deck.id)).toEqual(["b"]);
  });
});
