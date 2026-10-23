import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame } from "./index";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import {
  battler,
  completeSetup,
  deckOf,
  specialEnergy,
  trainerCard,
  typedEnergy,
  mustApply as must,
} from "./testFixtures";
import { type InPlayPokemon, makeInPlay } from "./types";

const STEEL_CUTTER =
  "Discard up to 2 Basic {M} Energy cards from your hand, and this attack does 40 damage for each card you discarded in this way.";
const DOUBLE_EATER =
  "Discard up to 2 Energy cards from your hand, and this attack does 60 damage for each card you discarded in this way.";
const STICK_N_DRAW = "Discard a card from your hand. If you do, draw 2 cards.";
const ULTRA_BALL_TEXT =
  "You can use this card only if you discard 2 other cards from your hand.\n\nSearch your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.";

const FILLER = "b36-filler";
const C = "b36-colorless";
const M = "b36-metal";
const W = "b36-water";
const SPECIAL = "b36-special";
const ULTRA_BALL = "sv01-196";

const TAP = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];
const LOCAL: Record<string, Card> = {
  // Every attacker pays a single {C}: the cost is not the claim, the discard is.
  "me05-060": battler("me05-060", {
    name: "Skarmory",
    hp: 300,
    attacks: [{ cost: ["Colorless"], name: "Steel Cutter", effect: STEEL_CUTTER, damage: "40×" }],
  }),
  "me03-032": battler("me03-032", {
    name: "Mawile",
    hp: 300,
    attacks: [{ cost: ["Colorless"], name: "Double Eater", effect: DOUBLE_EATER, damage: "60×" }],
  }),
  "sv08-128": battler("sv08-128", {
    name: "Klefki",
    hp: 300,
    attacks: [{ cost: ["Colorless"], name: "Stick 'n' Draw", effect: STICK_N_DRAW }],
  }),
  [ULTRA_BALL]: { ...trainerCard(ULTRA_BALL, "Item", ULTRA_BALL_TEXT), name: "Ultra Ball" },
  // No Weakness / Resistance on the defender, so the printed per-card damage is the whole total.
  [FILLER]: battler(FILLER, {
    name: "B36 Filler",
    hp: 400,
    types: ["Colorless"],
    weaknesses: [],
    resistances: [],
    attacks: TAP,
  }),
  [C]: typedEnergy(C, "Colorless"),
  [M]: typedEnergy(M, "Metal"),
  [W]: typedEnergy(W, "Water"),
  [SPECIAL]: specialEnergy(SPECIAL, "B36 Special Energy"),
};

const DECK = deckOf({ [FILLER]: 20, [C]: 40 });
const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

/** P1's turn 3 (past the §4 first-turn ban) on a 60-card filler deck. */
function base(): GameState {
  const created = createGame({ seed: 3636, decks: { p1: DECK, p2: DECK }, cardPool: LOCAL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = completeSetup(created.state, { first: "p1" });
  for (const seat of ["p1", "p2"] as const) {
    const result = applyAction(state, { type: "endTurn", seat });
    if (!result.ok) throw new Error(`endTurn rejected: ${result.error.code}`);
    state = result.state;
  }
  return state;
}

/** TEST SURGERY — P1's Active is `attacker` with one {C}, P2's Active a 400-HP Filler, and P1's hand
    `hand`. Fresh uids for every card placed. */
function table(attacker: string, hand: readonly string[]): GameState {
  const state: GameState = JSON.parse(JSON.stringify(base()));
  let n = 0;
  const alloc = (id: string): string => {
    const uid = `b36#${n++}`;
    state.cardIdByUid[uid] = id;
    const card = LOCAL[id];
    if (card === undefined) throw new Error(`no local face for ${id}`);
    state.cardPool = { ...state.cardPool, [id]: card };
    return uid;
  };
  const body = (id: string, energy: readonly string[]): InPlayPokemon => ({
    ...makeInPlay(alloc(id), 1),
    energy: energy.map(alloc),
  });
  for (const seat of ["p1", "p2"] as const) {
    const side = state.players[seat];
    state.players[seat] = {
      ...side,
      active: seat === "p1" ? body(attacker, [C]) : body(FILLER, []),
      bench: [],
      hand: seat === "p1" ? hand.map(alloc) : [],
      discard: [],
      deck: Array.from({ length: 10 }, () => alloc(FILLER)),
    };
  }
  return state;
}
function chooseCards(state: GameState) {
  if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected a chooseCards park, got ${state.phase.kind}`);
  }
  return state.phase.prompt;
}
const answer = (state: GameState, uids: readonly string[]) =>
  must(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [...uids] } });
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
function render(events: readonly GameEvent[], state: GameState): string[] {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  return logFromEvents([...events], ctx).flatMap((entry) =>
    entry.kind === "turn" ? [] : [entry.segments.map((s) => s.text).join("")],
  );
}
const ids = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);

const attack: GameAction = { type: "attack", seat: "p1", index: 0 };

// ─────────────────────────────────────────────────────────────────────────────

describe("B36 §1 — an attack's hand discard is logged as its effect, not as a cost", () => {
  it.each([
    // [id, attack, hand, the ids the printed filter admits, per-card damage]
    ["me05-060", "Steel Cutter", [M, W, M, SPECIAL, FILLER], [M, M], 40],
    ["me03-032", "Double Eater", [W, SPECIAL, FILLER], [W, SPECIAL], 60],
  ] as const)(
    '%s "%s": the printed filter, up to 2, the per-card damage, and the row says only "discarded N cards from their hand"',
    (id, _name, hand, admitted, per) => {
      const parked = must(table(id, hand), attack).state;
      const prompt = chooseCards(parked);
      // The board half was already right; pinned so a log-only fix cannot regress it.
      expect(ids(parked, prompt.candidates)).toEqual(admitted);
      expect([prompt.min, prompt.max]).toEqual([0, 2]);
      const paid = prompt.candidates.slice(0, 2);
      const { state, events } = answer(parked, paid);
      expect(state.players.p1.discard).toEqual(paid);
      expect(state.players.p2.active?.damage).toBe(per * 2);
      expect(ofType(events, "HAND_COST_PAID")).toEqual([
        { type: "HAND_COST_PAID", seat: "p1", uids: paid, to: "discard", effect: true },
      ]);
      const texts = render(events, state);
      expect(texts).toContain("discarded 2 cards from their hand");
      expect(texts.some((t) => t.includes("to pay a cost"))).toBe(false);
    },
  );

  it('sv08-128 "Stick \'n\' Draw": the same op at the same seam — "discarded 1 card from their hand", then the draw', () => {
    const board = table("sv08-128", [W, SPECIAL]);
    const parked = must(board, attack).state;
    const prompt = chooseCards(parked);
    expect([prompt.min, prompt.max]).toEqual([1, 1]);
    const paid = [prompt.candidates[0] as string];
    const { state, events } = answer(parked, paid);
    expect(state.players.p1.discard).toEqual(paid);
    expect(state.players.p1.hand).toHaveLength(1 + 2);
    expect(ofType(events, "HAND_COST_PAID")).toEqual([
      { type: "HAND_COST_PAID", seat: "p1", uids: paid, to: "discard", effect: true },
    ]);
    const texts = render(events, state);
    expect(texts).toContain("discarded 1 card from their hand");
    expect(texts.some((t) => t.includes("to pay a cost"))).toBe(false);
  });
});

describe("B36 §2 — the control: Ultra Ball's printed cost still logs a cost", () => {
  it('sv01-196 Ultra Ball: "discarded 2 cards from their hand to pay a cost", and the event carries no `effect`', () => {
    const board = table(FILLER, [ULTRA_BALL, W, SPECIAL, M]);
    const ball = board.players.p1.hand[0] as string;
    let step = must(board, { type: "playTrainer", seat: "p1", uid: ball });
    const all: GameEvent[] = [...step.events];
    const prompt = chooseCards(step.state);
    const paid = prompt.candidates.filter((u) => u !== ball).slice(0, 2);
    expect(paid).toHaveLength(2);
    step = answer(step.state, paid);
    all.push(...step.events);
    expect(ofType(all, "HAND_COST_PAID")).toEqual([
      { type: "HAND_COST_PAID", seat: "p1", uids: paid, to: "discard" },
    ]);
    expect(render(all, step.state)).toContain("discarded 2 cards from their hand to pay a cost");
  });
});
