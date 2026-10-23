import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameEvent, GameState } from "./index";
import { applyAction, createGame } from "./index";
import { battler, completeSetup, deckOf, typedEnergy, mustApply as must } from "./testFixtures";
import { type InPlayPokemon, makeInPlay } from "./types";

const POLLEN =
  "During your next turn, if the Defending Pokémon is Knocked Out, take 2 more Prize cards.";

const RIBOMBEE = "sv05-076";
const VICTIM = "b37-victim";
const TAPPER = "b37-tapper";
const C = "b37-colorless";

const LOCAL: Record<string, Card> = {
  [RIBOMBEE]: battler(RIBOMBEE, {
    name: "Ribombee",
    hp: 70,
    types: ["Psychic"],
    retreat: 0,
    weaknesses: [{ type: "Metal", value: "×2" }],
    attacks: [{ cost: ["Colorless"], name: "Plentiful Pollen", effect: POLLEN, damage: 30 }],
  }),
  // A 1-Prize body with 100 HP and no Weakness / Resistance: three Pollens Knock it Out on the
  // third, and any count of 30s is exact arithmetic.
  [VICTIM]: battler(VICTIM, {
    name: "B37 Victim",
    hp: 100,
    types: ["Colorless"],
    weaknesses: [],
    resistances: [],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [TAPPER]: battler(TAPPER, {
    name: "B37 Tapper",
    hp: 400,
    types: ["Colorless"],
    weaknesses: [],
    resistances: [],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [C]: typedEnergy(C, "Colorless"),
};

const DECK = deckOf({ [TAPPER]: 20, [C]: 40 });
const BOUNTY = 2;

/** P1's turn 3 (past the §4 first-turn ban) on a 60-card filler deck. */
function base(): GameState {
  const created = createGame({ seed: 3737, decks: { p1: DECK, p2: DECK }, cardPool: LOCAL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = completeSetup(created.state, { first: "p1" });
  for (const seat of ["p1", "p2"] as const) {
    const result = applyAction(state, { type: "endTurn", seat });
    if (!result.ok) throw new Error(`endTurn rejected: ${result.error.code}`);
    state = result.state;
  }
  return state;
}

/** TEST SURGERY — P1: Active Ribombee with one {C} (and, when asked, a second benched Ribombee
    with one {C}); P2: Active Victim carrying `damage`, one benched Tapper (so a Knock Out promotes
    rather than ends the game). Six Prize cards each, ten deck cards each, fresh uids throughout. */
function table(opts: { damage: number; benchRibombee?: boolean }): GameState {
  const state: GameState = JSON.parse(JSON.stringify(base()));
  let n = 0;
  const alloc = (id: string): string => {
    const uid = `b37#${n++}`;
    state.cardIdByUid[uid] = id;
    const card = LOCAL[id];
    if (card === undefined) throw new Error(`no local face for ${id}`);
    state.cardPool = { ...state.cardPool, [id]: card };
    return uid;
  };
  const body = (id: string, energy: readonly string[], damage = 0): InPlayPokemon => ({
    ...makeInPlay(alloc(id), 1),
    energy: energy.map(alloc),
    damage,
  });
  const pile = (k: number) => Array.from({ length: k }, () => alloc(TAPPER));
  state.players.p1 = {
    ...state.players.p1,
    active: body(RIBOMBEE, [C]),
    bench: opts.benchRibombee === true ? [body(RIBOMBEE, [C])] : [],
    hand: [],
    discard: [],
    deck: pile(10),
    prizes: pile(6),
  };
  state.players.p2 = {
    ...state.players.p2,
    active: body(VICTIM, [C], opts.damage),
    bench: [body(TAPPER, [C])],
    hand: [],
    discard: [],
    deck: pile(10),
    prizes: pile(6),
  };
  return state;
}
const pollen = (state: GameState) => must(state, { type: "attack", seat: "p1", index: 0 });
const pass = (state: GameState, seat: "p1" | "p2") => must(state, { type: "endTurn", seat }).state;
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

function owed(before: GameState, after: GameState, events: readonly GameEvent[]): number {
  if (after.phase.kind === "ko:takePrizes") return after.phase.count;
  const row = ofType(events, "PRIZES_OWED")[0];
  if (row !== undefined) return row.count;
  return before.players.p1.prizes.length - after.players.p1.prizes.length;
}

/** Turn 3: Pollen on the Victim (now carrying `damage + 30`), then P2 passes — P1's turn 5. */
function markedThenTurn5(opts: { damage: number; benchRibombee?: boolean }) {
  const start = table(opts);
  expect(start.turn).toBe(3);
  const first = pollen(start);
  expect(first.state.players.p2.active?.koBounty).toStrictEqual({ turn: 5, amount: BOUNTY });
  const turn5 = pass(first.state, "p2");
  expect(turn5.turn).toBe(5);
  expect(turn5.players.p2.active?.damage).toBe(opts.damage + 30);
  return turn5;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("B37 §1 — a turn-5 Pollen that Knocks Out the turn-3-marked Pokémon still pays the turn-3 +2", () => {
  it('sv05-076 "Plentiful Pollen" twice, the SAME Ribombee: the second Knocks Out, and P1 is owed 1 + 2', () => {
    // 40 + 30 = 70 after turn 3; the turn-5 Pollen's 30 makes it 100 — lethal on 100 HP.
    const turn5 = markedThenTurn5({ damage: 40 });
    const { state, events } = pollen(turn5);
    expect(ofType(events, "KNOCKED_OUT").map((e) => e.uid)).toContain(
      turn5.players.p2.active?.stack[0],
    );
    expect(owed(turn5, state, events)).toBe(1 + BOUNTY);
    expect(ofType(events, "PRIZE_BONUS").map((e) => [e.by, e.count])).toEqual([
      [BOUNTY, 1 + BOUNTY],
    ]);
    // The body leaves play at this sweep: no turn-7 window is announced on it.
    expect(ofType(events, "KO_BOUNTY_APPLIED")).toEqual([]);
  });

  it("a SECOND, benched Ribombee retreated into the Active Spot uses Pollen on turn 5: the same 1 + 2", () => {
    const turn5 = markedThenTurn5({ damage: 40, benchRibombee: true });
    const swapped = must(turn5, {
      type: "retreat",
      seat: "p1",
      discardEnergy: [],
      promoteBenchIndex: 0,
    }).state;
    expect(swapped.players.p1.active?.stack[0]).toBe(turn5.players.p1.bench[0]?.stack[0]);
    const { state, events } = pollen(swapped);
    expect(owed(swapped, state, events)).toBe(1 + BOUNTY);
    expect(ofType(events, "PRIZE_BONUS").map((e) => e.by)).toEqual([BOUNTY]);
  });

  it("a chain of three: a NON-lethal turn-5 Pollen re-marks for turn 7, and the turn-7 Pollen that Knocks Out pays 1 + 2", () => {
    // 10 + 30 = 40 after turn 3, 70 after turn 5 (alive), 100 after turn 7.
    const turn5 = markedThenTurn5({ damage: 10 });
    const second = pollen(turn5);
    const turn7 = pass(second.state, "p2");
    expect(turn7.turn).toBe(7);
    const { state, events } = pollen(turn7);
    expect(owed(turn7, state, events)).toBe(1 + BOUNTY);
    expect(ofType(events, "PRIZE_BONUS").map((e) => e.by)).toEqual([BOUNTY]);
  });
});

describe("B37 §2 — the controls: a surviving body is re-marked for turn 7, and an unmarked Knock Out pays face value", () => {
  it("a NON-lethal turn-5 Pollen moves the mark to turn 7 with one row and pays nothing on turn 5", () => {
    const turn5 = markedThenTurn5({ damage: 10 });
    const second = pollen(turn5);
    expect(second.state.players.p2.active?.damage).toBe(70);
    expect(second.state.players.p2.active?.koBounty).toStrictEqual({ turn: 7, amount: BOUNTY });
    expect(ofType(second.events, "KO_BOUNTY_APPLIED").map((e) => e.amount)).toEqual([BOUNTY]);
    expect(ofType(second.events, "PRIZE_BONUS")).toEqual([]);
  });

  it("a FIRST Pollen that Knocks Out (no live mark) pays the face value", () => {
    const start = table({ damage: 70 });
    const { state, events } = pollen(start);
    expect(owed(start, state, events)).toBe(1);
    expect(ofType(events, "PRIZE_BONUS")).toEqual([]);
  });
});
