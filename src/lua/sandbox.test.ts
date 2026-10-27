import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fullCardsFrom, json, stubFetch } from "../test/fetchStub";
import { cardBrief } from "../test/fixtures";
import { clearCardPoolCache } from "../game/cardPool";
import { clearSavedDeckCache } from "../game/sandboxDecks";
import { loadSimulatorSave } from "../game/simulatorSave";
import { LuaSandbox } from "./sandbox";
import { launchSandbox } from "./sandboxLaunch";

const SAVED = "2026-10-01T00:00:00.000Z";
const EDITED = "2026-10-02T00:00:00.000Z";
const decks = [
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
const full = (id: string, count = 60, updated = SAVED) => ({
  id,
  name: decks.find((deck) => deck.id === id)?.name ?? id,
  format: "standard",
  updated,
  cards: [
    { cardId: card.id, count: 4 },
    { cardId: energy.id, count: count - 4 },
  ],
});
const reads = {
  "GET /decks": () => json(decks),
  "GET /decks/a": () => json(full("a")),
  "GET /decks/b": () => json(full("b")),
  "GET /cards/full": fullCardsFrom({ [card.id]: card, energy }),
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
  clearSavedDeckCache();
  vi.unstubAllGlobals();
});

describe("Lua sandbox setup", () => {
  it("ignores a command with a malformed percent-sequence", async () => {
    const publish = vi.fn();
    await expect(
      new LuaSandbox(publish, async () => () => {}).command("pick\t%"),
    ).resolves.toBeUndefined();
    expect(publish).not.toHaveBeenCalled();
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
    expect(calls).toHaveLength(4);
    expect(calls).not.toContain("GET /decks/empty");
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
  it("revalidates fresh contents, including card count and Basic Pokémon", async () => {
    stubFetch(reads);
    const { sandbox, launch } = await setup();
    stubFetch({ ...reads, "GET /decks/a": () => json(full("a", 59)) });
    await sandbox.command("start");
    expect(sandbox.message).toContain("59 cards");
    expect(launch).not.toHaveBeenCalled();
    clearCardPoolCache();
    stubFetch({
      ...reads,
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
    stubFetch(reads);
    const { sandbox, launch } = await setup();
    let finish!: (response: Response) => void;
    const { calls } = stubFetch({
      ...reads,
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
    const summaries = names.map((id) => ({ ...decks[0], id, name: id }));
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
    stubFetch({
      ...reads,
      "GET /decks": () => json(decks.map((deck) => ({ ...deck, updated: EDITED }))),
      "GET /decks/a": () => json(full("a", 59, EDITED)),
      "GET /decks/b": () => json(full("b", 59, EDITED)),
    });
    await sandbox.command("refresh");
    expect(sandbox.phase).toBe("ready");
    expect(sandbox.decks).toEqual([]);
    expect(sandbox.selected).toEqual(["", ""]);
  });
  it("reuses a deck's contents and cards until its summary's updated moves", async () => {
    const { calls } = stubFetch(reads);
    const { sandbox } = await setup();
    calls.length = 0;
    await sandbox.command("refresh");
    expect(calls).toEqual(["GET /decks"]);
    const edited = stubFetch({
      ...reads,
      "GET /decks": () =>
        json(decks.map((deck) => (deck.id === "a" ? { ...deck, updated: EDITED } : deck))),
      "GET /decks/a": () => json(full("a", 59, EDITED)),
    });
    await sandbox.command("refresh");
    expect(edited.calls).toEqual(["GET /decks", "GET /decks/a"]);
    expect(sandbox.decks.map((deck) => deck.id)).toEqual(["b"]);
  });
});
