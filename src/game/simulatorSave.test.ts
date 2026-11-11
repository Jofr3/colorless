import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { engineVersion } from "@colorless/engine";
import { LuaSimulator } from "../lua/simulator";
import { LocalTableSource } from "../lua/tableSource";
import { playSimulatorGame } from "../test/simulatorGame";
import { clearSimulatorSave, loadSimulatorSave, saveSimulator } from "./simulatorSave";
import { hasSimulatorSave } from "./simulatorSaveKey";
import { fullStorage, memoryStorage } from "../test/storageStub";

const SAVE_KEY = "colorless:simulator:game";
let storage: Map<string, string>;

beforeEach(() => {
  const local = memoryStorage();
  storage = local.values;
  vi.stubGlobal("localStorage", local);
  let clock = 1_700_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => {
    clock += 1_000;
    return clock;
  });
  clearSimulatorSave();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const reload = () => {
  const host = loadSimulatorSave();
  if (!host) throw new Error("The save did not restore");
  return new LocalTableSource(host);
};
/** The stored record, edited, as the next load will read it. */
const tamper = (edit: (record: Record<string, unknown>) => void) => {
  const record = JSON.parse(storage.get(SAVE_KEY) ?? "null");
  edit(record);
  clearSimulatorSave();
  storage.set(SAVE_KEY, JSON.stringify(record));
};

/** No save to resume: the sandbox opens its deck picker, and the table stays empty. */
const expectDeckPicker = () => {
  expect(loadSimulatorSave()).toBeNull();
  const route = vi.fn();
  const sim = new LuaSimulator(vi.fn(), route);
  sim.command("resume");
  expect(route).toHaveBeenCalledWith("sandbox");
  sim.command("open");
  expect(sim.source).toBeNull();
};

describe("the simulator save", () => {
  // A legacy save: its game draws from the mulberry32 generator, and still replays on it.
  it.each([
    ["the legacy generator", false],
    ["ChaCha20", true],
  ])(
    "restores the whole history on %s: every action undoes back to the start and redoes to the end",
    (_, chacha) => {
      const { src } = playSimulatorGame(11, { maxMoves: 150, chacha });
      const live = src.host;
      expect(typeof live.origin.game.rngState).toBe(chacha ? "object" : "number");
      expect(live.steps.length).toBeGreaterThan(100);
      const table = reload();
      expect(table.host).toEqual(live);
      for (let i = live.steps.length - 2; i >= 0; i--) {
        table.history.step("undoAction");
        const step = live.steps[table.host.stepIndex];
        expect(table.host.stepIndex).toBeLessThanOrEqual(i);
        expect(table.host.game).toEqual(step?.game);
        expect(table.host.log).toEqual(live.log.slice(0, step?.logLength));
        expect(table.host.viewerSeat).toBe(step?.viewerSeat);
        i = table.host.stepIndex;
      }
      expect(table.history.canStep("undoAction")).toBe(false);
      expect(table.host.game).toEqual(live.origin.game);
      expect(table.host.log).toEqual(live.origin.log);
      const back = reload();
      expect(back.host.game).toEqual(live.origin.game);
      while (back.history.canStep("redoAction")) back.history.step("redoAction");
      expect(back.host.game).toEqual(live.game);
      expect(back.host.log).toEqual(live.log);
      expect(back.host.viewerSeat).toBe(live.viewerSeat);
    },
  );

  it("reopens at the place in history it was left, by turn as well as by action", () => {
    const { src } = playSimulatorGame(23, { maxMoves: 120 });
    const live = src.host;
    src.history.step("undoTurn");
    src.history.step("undoTurn");
    src.history.step("undoAction");
    const left = src.host;
    const table = reload();
    expect(table.host).toEqual(left);
    expect(table.turns()).toEqual(src.turns());
    table.history.step("redoTurn");
    src.history.step("redoTurn");
    expect(table.host.game).toEqual(src.host.game);
    for (const t of [table, src]) while (t.history.canStep("redoTurn")) t.history.step("redoTurn");
    expect(table.host.game).toEqual(live.game);
    expect(reload().host.game).toEqual(live.game);
  });

  it("replaces the redo tail with a new move made after reopening", () => {
    const { src } = playSimulatorGame(37, { maxMoves: 80 });
    for (let i = 0; i < 5; i++) src.history.step("undoAction");
    const table = reload();
    const { game, viewerSeat, cursor } = table.host;
    if (game.phase.kind !== "turn:action") throw new Error("expected a turn");
    table.send({ type: "endTurn", seat: viewerSeat });
    expect(table.lifecycle().error).toBeNull();
    expect(table.history.canStep("redoAction")).toBe(false);
    expect(table.host.actions).toHaveLength(cursor + 1);
    const again = reload();
    expect(again.host).toEqual(table.host);
    again.history.step("undoAction");
    expect(again.host.game).toEqual(game);
    expect(again.history.canStep("redoAction")).toBe(true);
  });

  it("tells whether a save of this format is stored without replaying it", () => {
    expect(hasSimulatorSave()).toBe(false);
    playSimulatorGame(11, { maxMoves: 20 });
    expect(hasSimulatorSave()).toBe(true);
    // Another engine's save still counts: opening it falls back to the deck picker.
    tamper((record) => {
      record.engineVersion = `${engineVersion}-other`;
    });
    expect(hasSimulatorSave()).toBe(true);
    tamper((record) => {
      record.version = 1;
    });
    expect(hasSimulatorSave()).toBe(false);
    storage.set(SAVE_KEY, "not json");
    expect(hasSimulatorSave()).toBe(false);
    clearSimulatorSave();
    expect(hasSimulatorSave()).toBe(false);
  });

  it("drops a save from an older format or another engine", () => {
    playSimulatorGame(11, { maxMoves: 20 });
    expect(loadSimulatorSave()).not.toBeNull();
    tamper((record) => {
      record.version = 1;
    });
    expect(loadSimulatorSave()).toBeNull();
    tamper((record) => {
      record.version = 2;
      record.engineVersion = `${engineVersion}-other`;
    });
    expect(loadSimulatorSave()).toBeNull();
  });

  type SaveRecord = {
    actions: unknown[];
    position: { stepIndex: number };
    origin: { game: { players?: { p1: { hand: unknown[] } } } };
    names: unknown;
    fingerprint: string;
  };
  it.each<[string, (record: SaveRecord) => void]>([
    [
      "has a different end board",
      (r) => {
        r.fingerprint = "0";
      },
    ],
    [
      "misses an action from the middle",
      (r) => {
        r.actions.splice(3, 1);
      },
    ],
    [
      "has an action the engine refuses",
      (r) => {
        r.actions[5] = { action: { type: "endTurn", seat: "p3" }, at: 0 };
      },
    ],
    [
      "has an action that does not parse",
      (r) => {
        r.actions[2] = { action: 7, at: 0 };
      },
    ],
    [
      "points past its history",
      (r) => {
        r.position.stepIndex = 10_000;
      },
    ],
    [
      "lost its starting board",
      (r) => {
        r.origin.game = {};
      },
    ],
    [
      "has a starting board that cannot be shown",
      (r) => {
        if (r.origin.game.players) r.origin.game.players.p1.hand = [{}];
      },
    ],
    [
      "has a starting RNG state no generator reads",
      (r) => {
        (r.origin.game as Record<string, unknown>).rngState = {
          alg: "chacha20",
          key: "x",
          counter: 0,
        };
      },
    ],
    [
      "names no players",
      (r) => {
        r.names = null;
      },
    ],
  ])("falls back to the deck picker when the save %s", (_, corrupt) => {
    playSimulatorGame(11, { maxMoves: 40 });
    expect(loadSimulatorSave()).not.toBeNull();
    tamper((record) => corrupt(record as SaveRecord));
    expectDeckPicker();
  });

  it("falls back to the deck picker when the save is not JSON", () => {
    storage.set(SAVE_KEY, "{not json");
    expectDeckPicker();
  });

  it("reports a write that did not stick", () => {
    const { src } = playSimulatorGame(11, { maxMoves: 5 });
    vi.stubGlobal("localStorage", fullStorage());
    expect(saveSimulator(src.host)).toBe(false);
  });

  it("drops the last match's save when a new match's write does not stick", () => {
    const { src } = playSimulatorGame(11, { maxMoves: 30 });
    const abandoned = src.host.startedAt;
    expect(loadSimulatorSave()?.startedAt).toBe(abandoned);
    const write = localStorage.setItem;
    localStorage.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    expect(src.restart()).toBeNull();
    expect(src.persist()).toBe(false);
    expect(storage.has(SAVE_KEY)).toBe(false);
    localStorage.setItem = write;
    expectDeckPicker();
  });

  it("keeps an earlier point of the same match when a later write does not stick", () => {
    const { src } = playSimulatorGame(11, { maxMoves: 5 });
    const before = storage.get(SAVE_KEY);
    localStorage.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    expect(saveSimulator({ ...src.host, actions: [...src.host.actions] })).toBe(false);
    expect(storage.get(SAVE_KEY)).toBe(before);
    expect(loadSimulatorSave()?.startedAt).toBe(src.host.startedAt);
  });

  it("stays within its size budget over a whole game at a pinned seed, and restores it", () => {
    const budget = new Map([
      [11, 20_000],
      [35, 40_000],
      [95, 90_000],
    ]);
    const chars = new Map<number, number>();
    const { src } = playSimulatorGame(11, {
      maxMoves: 2000,
      onMove: (table) => {
        for (const turn of budget.keys())
          if (table.host.game.turn >= turn && !chars.has(turn))
            chars.set(turn, storage.get(SAVE_KEY)?.length ?? 0);
      },
    });
    expect(chars.has(35)).toBe(true);
    for (const [turn, size] of chars)
      expect(size, `turn ${turn}`).toBeLessThan(budget.get(turn) ?? 0);
    // The save grows by its newest action, not by another copy of the history.
    const final = storage.get(SAVE_KEY)?.length ?? Number.POSITIVE_INFINITY;
    expect(final).toBeLessThan(30_000 + 100 * src.host.actions.length);
    expect(reload().host).toEqual(src.host);
  });
});
