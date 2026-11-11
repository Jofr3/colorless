import { formatElapsed, type GameAction, logFromEvents, type Seat } from "@colorless/engine";
import { EVOLVE_DECK, MIXED_DECK, mustCreate, walkGame } from "@colorless/engine/testing";
import type { WireAction } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { FakeStorage } from "./lobbyHarness";
import { applyMatchAction, MATCH_RECORD_VERSION, type MatchRecord, matchFrameFor } from "./match";
import { MatchStore } from "./matchStore";

// Byte budgets for one seeded game: what the DO writes per action and what each socket is sent.
// The counts are deterministic for a given engine; the budgets leave room for rules changes and
// fail when a write or a frame starts growing with the game.

const SEED = 31;
const NAMES = { p1: "Ana", p2: "Bo" } as const;
const VIEWERS: Seat[] = ["p1", "p2"];

/** About a quarter above what the seeded game measures, in JSON characters. */
const BUDGET = {
  writtenPerAction: 21_000,
  writtenPerGame: 2_500_000,
  deltaFrame: 18_500,
  fullFrame: 56_000,
};

/** Storage that counts the JSON bytes of every value written. */
function measuredStorage() {
  const storage = new FakeStorage();
  const sizes = { written: 0 };
  const put = storage.put.bind(storage);
  storage.put = async (entries: string | Record<string, unknown>, value?: unknown) => {
    const values = typeof entries === "string" ? [value] : Object.values(entries);
    for (const item of values) sizes.written += JSON.stringify(item).length;
    await put(entries, value);
  };
  return { storage, sizes };
}

function seededGame() {
  const created = mustCreate(SEED, { p1: MIXED_DECK, p2: EVOLVE_DECK });
  const record: MatchRecord = {
    version: MATCH_RECORD_VERSION,
    seed: SEED,
    startedAt: 0,
    names: NAMES,
    state: created.state,
    log: logFromEvents(created.events, {
      names: NAMES,
      state: created.state,
      elapsed: formatElapsed(0),
    }),
  };
  const actions: GameAction[] = [];
  walkGame(created.state, SEED, () => {}, {
    maxSteps: 600,
    onStep: (_board, action) => actions.push(action),
  });
  return { record, actions };
}

async function playedGame() {
  const { storage, sizes } = measuredStorage();
  const store = new MatchStore(storage);
  let { record, actions } = seededGame();
  await store.put(record);
  const steps: { written: number; delta: number; full: number; record: MatchRecord }[] = [];
  for (const [index, action] of actions.entries()) {
    const seat = (action as { seat: Seat }).seat;
    const outcome = applyMatchAction(record, seat, action as unknown as WireAction, index * 1000);
    if (!outcome.ok) throw new Error(outcome.reason);
    const before = sizes.written;
    await store.put(outcome.record);
    const frameBytes = (logFrom?: number) =>
      Math.max(
        ...VIEWERS.map(
          (viewer) => JSON.stringify(matchFrameFor(outcome.record, viewer, logFrom)).length,
        ),
      );
    steps.push({
      written: sizes.written - before,
      delta: frameBytes(record.log.length),
      full: frameBytes(),
      record: outcome.record,
    });
    record = outcome.record;
  }
  return { steps, storage };
}

describe("online match byte budgets", () => {
  it("writes a bounded slice of the match per action and sends bounded frames", async () => {
    const { steps } = await playedGame();
    const max = (key: "written" | "delta" | "full") => Math.max(...steps.map((s) => s[key]));
    const total = steps.reduce((sum, step) => sum + step.written, 0);
    expect(steps.length).toBeGreaterThan(100);
    expect(max("written")).toBeLessThanOrEqual(BUDGET.writtenPerAction);
    expect(total).toBeLessThanOrEqual(BUDGET.writtenPerGame);
    expect(max("delta")).toBeLessThanOrEqual(BUDGET.deltaFrame);
    expect(max("full")).toBeLessThanOrEqual(BUDGET.fullFrame);
    const late = steps.slice(-20).map((step) => step.written);
    const early = steps.slice(10, 30).map((step) => step.written);
    expect(Math.max(...late)).toBeLessThan(2 * Math.max(...early));
  });

  it("sends the same frames from the record read back after a wake as from the one in memory", async () => {
    const { steps, storage } = await playedGame();
    const last = steps.at(-1)?.record;
    if (last === undefined) throw new Error("no steps");
    const woken = await new MatchStore(storage).get();
    for (const viewer of VIEWERS) {
      expect(JSON.stringify(matchFrameFor(woken as MatchRecord, viewer))).toBe(
        JSON.stringify(matchFrameFor(last, viewer)),
      );
    }
  });
});
