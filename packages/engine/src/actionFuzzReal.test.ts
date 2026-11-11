// A seeded fuzz over REAL cards. `actionFuzz.test.ts` walks synthetic
// fixture decks; this walks the bench's four real-card archetype decks (`benchPool.json`) against
// each other, on the legacy mulberry32 generator and on ChaCha20, which every real game uses.
//
// Every accepted step of the walk, and every hostile wire action (`hostileActionsAt`) the engine
// accepts at a sampled state, must:
// - leave a state the lobby can persist, redact and log, with every card kept (`afterAccept`);
// - keep the board rules (`boardViolations`);
// - answer a Prize take or a parked prompt only with what it offered, as the seat it asked
//   (`promptViolations`);
// - give the same state and events when applied to a JSON copy of the state it ran on: the DO
//   loads a fresh state for every action, while the simulator keeps one in memory, so an engine
//   cache keyed on object identity must not change what an action does (warm versus cold).
// A whole game then replays from a JSON copy of its start to the same end.
//
// The pool is rewritten after an ingest, so this asserts properties only, never counts of a walk.

import { wireActionSchema } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { BenchDeckName } from "./fixtures/bench";
import {
  afterAccept,
  boardViolations,
  hostileActionsAt,
  promptViolations,
  rngFrom,
} from "./fixtures/fuzz";
import type { GameAction, GameEvent, GameState, RngState } from "./index";
import { applyAction, createGame } from "./index";
import { BENCH_POOL, benchDeck, deepFreeze, drbgSeed, roundTrip, walkGame } from "./testFixtures";

/** Accepted steps per walk (every bench game ends well before), the states between hostile
    slices, and the seeds. About 6 s alone. */
const MAX_STEPS = 400;
const HOSTILE_EVERY = 8;
const GAME_SEED = 0x2ea1;
const FUZZ_SEED = 0x5ec1;

const PAIRS: readonly (readonly [BenchDeckName, BenchDeckName])[] = [
  ["charizard", "gardevoir"],
  ["dragapult", "miraidon"],
  ["charizard", "dragapult"],
  ["gardevoir", "miraidon"],
];

/** Each pairing on both generators, with its own game and walk seeds. */
const RUNS = PAIRS.flatMap(([p1, p2], i) => [
  [`${p1} v ${p2}`, p1, p2, GAME_SEED + i, 7 + i],
  [`${p1} v ${p2} (ChaCha20)`, p1, p2, drbgSeed(GAME_SEED + i), 7 + i],
]) as [string, BenchDeckName, BenchDeckName, RngState, number][];

const stable = (value: unknown) => JSON.stringify(value);

function created(p1: BenchDeckName, p2: BenchDeckName, seed: RngState): GameState {
  const result = createGame({
    seed,
    decks: { p1: benchDeck(p1), p2: benchDeck(p2) },
    cardPool: BENCH_POOL,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}

/** Everything wrong with an accepted `action` from `before` to `after`, or nothing. */
function acceptedProblems(
  before: GameState,
  action: GameAction,
  events: GameEvent[],
  after: GameState,
): string[] {
  const usable = afterAccept(before, after, events);
  const out = [
    ...(usable === null ? [] : [usable]),
    ...boardViolations(before, after),
    ...promptViolations(before, action),
  ];
  const cold = applyAction(roundTrip(before), roundTrip(action));
  if (!cold.ok) out.push(`a JSON copy refused it: ${cold.error.code}`);
  else if (stable(cold.state) !== stable(after)) out.push("a JSON copy reached another state");
  else if (stable(cold.events) !== stable(events)) out.push("a JSON copy emitted other events");
  return out;
}

interface Tally {
  answered: number;
  prizesTaken: number;
  hostileSent: number;
  hostileAccepted: number;
}

function fuzzRun(p1: BenchDeckName, p2: BenchDeckName, seed: RngState, walkSeed: number) {
  const problems = new Map<string, string>();
  const tally: Tally = { answered: 0, prizesTaken: 0, hostileSent: 0, hostileAccepted: 0 };
  const note = (problem: string, state: GameState, action: unknown) => {
    const where = `turn ${state.turn} ${state.phase.kind} ${stable(action).slice(0, 200)}`;
    if (!problems.has(problem)) problems.set(problem, where);
  };
  const start = created(p1, p2, seed);
  if (stable(created(p1, p2, seed)) !== stable(start))
    note("createGame is not deterministic", start, seed);
  const rng = rngFrom(FUZZ_SEED);
  const actions: GameAction[] = [];
  let visited = 0;
  const end = walkGame(
    start,
    walkSeed,
    (state) => {
      visited += 1;
      if (visited % HOSTILE_EVERY !== 0) return;
      const frozen = deepFreeze(state);
      for (const { action, seat } of hostileActionsAt(rng, frozen)) {
        // The DO's path: a JSON frame, the schema, then the actor's own seat.
        const wire = wireActionSchema.safeParse(roundTrip(action));
        if (!wire.success) continue;
        const bound = { ...wire.data, seat } as GameAction;
        tally.hostileSent += 1;
        try {
          const result = applyAction(frozen, bound);
          if (!result.ok) continue;
          tally.hostileAccepted += 1;
          for (const problem of acceptedProblems(frozen, bound, result.events, result.state))
            note(`hostile ${bound.type}: ${problem}`, frozen, bound);
        } catch (error) {
          note(`hostile ${bound.type} threw: ${(error as Error).message}`, frozen, bound);
        }
      }
    },
    {
      maxSteps: MAX_STEPS,
      onStep: (before, action, events, after) => {
        if (action.type === "resolveEffect") tally.answered += 1;
        if (action.type === "takePrizes") tally.prizesTaken += 1;
        actions.push(action);
        for (const problem of acceptedProblems(before, action, events, after))
          note(`${action.type}: ${problem}`, before, action);
      },
    },
  );
  let replay = roundTrip(start);
  for (const action of actions) {
    const result = applyAction(replay, action);
    if (!result.ok) {
      note(`the replay refused ${action.type}: ${result.error.code}`, replay, action);
      break;
    }
    replay = result.state;
  }
  if (stable(replay) !== stable(end))
    note("the replay from a JSON start ended elsewhere", end, null);
  return { problems: Object.fromEntries(problems), tally, end };
}

// Each run walks once and is remembered, so every test computes what it reads and stands alone.
const results = new Map<string, ReturnType<typeof fuzzRun>>();
function resultOf([name, p1, p2, seed, walk]: (typeof RUNS)[number]) {
  let result = results.get(name);
  if (result === undefined) {
    result = fuzzRun(p1, p2, seed, walk);
    results.set(name, result);
  }
  return result;
}

describe("seeded walks over the real-card bench decks (EN1, EN2)", () => {
  it.each(RUNS)("%s: every accepted action keeps the game sound", (...run) => {
    const { problems, end } = resultOf(run);
    expect(problems).toEqual({});
    // A walk stuck in setup would pass without playing a card.
    expect(end.turn).toBeGreaterThan(2);
  });

  it("the walks answer prompts, take Prizes, finish games and reach accepted hostile actions", () => {
    // Guards the sweep against passing vacuously; the floors are far below what the walks do. If a
    // pool rewrite drops one, change a seed rather than the floor.
    const all = RUNS.map(resultOf);
    const sum = (key: keyof Tally) => all.reduce((n, r) => n + r.tally[key], 0);
    expect(sum("answered")).toBeGreaterThan(0);
    expect(sum("prizesTaken")).toBeGreaterThan(0);
    expect(all.some((r) => r.end.phase.kind === "gameOver")).toBe(true);
    expect(sum("hostileAccepted")).toBeGreaterThan(0);
    expect(sum("hostileSent")).toBeGreaterThan(1000);
  });
});
