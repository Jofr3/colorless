// Times the hot-seat save over seeded games: each move's persist, the save's
// size as the game goes on, restoring it, undoing through it and the heap its
// history holds. Run with `bun run bench:simsave [moves]`. Prints medians;
// timings never gate (the byte budget lives in simulatorSave.test.ts).

import { clearSimulatorSave } from "../game/simulatorSave";
import { LuaSimulator } from "../lua/simulator";
import { LocalTableSource } from "../lua/tableSource";
import { playSimulatorGame } from "./simulatorGame";

const runtime = globalThis as unknown as {
  Bun?: { gc(force: boolean): void };
  process?: { argv: string[]; memoryUsage(): { heapUsed: number } };
};
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  },
});
let clock = 1_700_000_000_000;
Date.now = () => {
  clock += 1_000;
  return clock;
};

const SAVE_KEY = "colorless:simulator:game";
// Three typical games, and a long one whose players rarely end a turn early.
const GAMES = [
  { seed: 11 },
  { seed: 23 },
  { seed: 37 },
  { seed: 11, turnBudget: 24, endOdds: 80, holdAttacks: true },
];
const TURNS = [11, 35, 95];
const maxMoves = Number(runtime.process?.argv[2] ?? 1500);

const median = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
};
const ms = (x: number) => Math.round(x * 100) / 100;
const heap = () => {
  runtime.Bun?.gc(true);
  return runtime.process?.memoryUsage().heapUsed ?? Number.NaN;
};
const time = (fn: () => void) => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};
let saved = "";
const open = () => {
  // A fresh read each time, not one the save module has already replayed.
  clearSimulatorSave();
  store.set(SAVE_KEY, saved);
  const sim = new LuaSimulator(
    () => {},
    () => {},
  );
  sim.open();
  if (!(sim.source instanceof LocalTableSource)) throw Error("The save did not restore");
  return sim.source;
};

for (const { seed, ...policy } of GAMES) {
  store.clear();
  const persists: { turn: number; ms: number }[] = [];
  const chars = new Map<number, number>();
  const { src, moves } = playSimulatorGame(seed, {
    ...policy,
    maxMoves,
    onOpen: (table) => {
      const persist = table.persist.bind(table);
      table.persist = () => {
        const start = performance.now();
        const ok = persist();
        persists.push({ turn: table.host.game.turn, ms: performance.now() - start });
        return ok;
      };
    },
    onMove: (table) => {
      for (const turn of TURNS)
        if (table.host.game.turn >= turn && !chars.has(turn))
          chars.set(turn, store.get(SAVE_KEY)?.length ?? 0);
    },
  });
  const finalTurn = src.host.game.turn;
  saved = store.get(SAVE_KEY) ?? "";
  const between = (from: number, to: number) =>
    ms(median(persists.filter((p) => p.turn >= from && p.turn <= to).map((p) => p.ms)));

  const loads = Array.from({ length: 5 }, () => time(() => open()));
  // What the history holds in memory, against keeping only the turn starts
  // and replaying the actions after one on each undo: five copies held at
  // once, so the collector's noise is small beside them.
  const heldBy = (keep: (src: LocalTableSource) => unknown) => {
    const before = heap();
    const kept = Array.from({ length: 5 }, () => keep(open()));
    clearSimulatorSave();
    const after = heap();
    return kept.length && (after - before) / kept.length;
  };
  const held = heldBy((table) => table.host);
  const heldTurnStarts = heldBy(({ host }) => ({
    origin: host.origin,
    actions: host.actions,
    turns: host.turns.map((t) => t.game),
  }));
  let table: LocalTableSource | null = open();
  const undos: number[] = [];
  let undone = 0;
  while (table.history.canStep("undoAction")) {
    undos.push(time(() => table?.history.step("undoAction")));
    undone++;
  }
  const backAtStart = table.host.game === table.host.steps[0]?.game;
  let redone = 0;
  while (table.history.canStep("redoAction")) {
    table.history.step("redoAction");
    redone++;
  }
  table = null;

  console.log(
    JSON.stringify({
      seed,
      ...policy,
      moves,
      finalTurn,
      persistMs: {
        turns1to10: between(1, 10),
        turns30to40: between(30, 40),
        last50: ms(median(persists.slice(-50).map((p) => p.ms))),
      },
      saveChars: {
        ...Object.fromEntries([...chars].map(([t, n]) => [`turn${t}`, n])),
        final: saved.length,
      },
      loadMs: ms(median(loads)),
      heldHeapMB: Math.round(held / 1e4) / 100,
      turnStartsOnlyHeapMB: Math.round(heldTurnStarts / 1e4) / 100,
      undoMs: ms(median(undos)),
      undone,
      redone,
      backAtStart,
    }),
  );
}
