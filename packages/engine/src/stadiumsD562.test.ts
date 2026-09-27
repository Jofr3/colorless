import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import {
  activeRetreatSurcharge,
  countToolsInPlay,
  effectiveMaxHp,
  effectiveRetreatCost,
  passivesOf,
  stadiumShieldsStatus,
  toolAttackCostDiscount,
  toolsInEffect,
} from "./continuous";
import type { GameEvent } from "./events";
import { applyAction, createGame } from "./index";
import type { GameState, Seat } from "./index";
import { conditionHolds } from "./interpreter";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  expectErr,
  mustApply,
  setActiveFromDeck,
  setConditions,
  setDamage,
  setPrizes,
  trainerCard,
} from "./testFixtures";
import { koToolTriggersOf } from "./triggers";
import type { InPlayPokemon } from "./types";

// ── 🆕🆕🆕 D562 — THE TWO STADIUMS: JAMMING TOWER AND FESTIVAL GROUNDS ──
//
//   Jamming Tower     sv06-153 / sv10-243    Stadium  Pokémon Tools (both sides) have no effect
//   Festival Grounds  sv06-149 / sv08.5-108  Stadium  Energy-carrying Pokémon (both sides): no Special Conditions
//
// Jamming Tower is `StadiumEffects.toolsHaveNoEffect`, read by ONE function (continuous.ts
// `toolsInEffect`) that every Tool EFFECT walk goes through while every Tool COUNT read stays
// on the raw list (R-JT). Festival Grounds is `StadiumEffects.statusShieldIfEnergyAttached`,
// the refusal at `applyStatus` and the recovery at `recoverStatuses`, which `playStadium` now
// also calls (R-FG). Both driven BOTH WAYS on the REAL ids, on a LOCAL `cardPool` (D275) in the
// suite's OWN 60-card deck (D270). The consumable Tools are `toolsD562.test.ts`.
// docs/decisions.md D562.

const JAMMING = ["sv06-153", "sv10-243"] as const;
const FESTIVAL = ["sv06-149", "sv08.5-108"] as const;
const HEROS_CAPE = "sv05-152";
const AIR_BALLOON = "sv10.5b-079";
const RESCUE_BOARD = "sv05-159";
const COUNTER_GAIN = "sv08-169";
const GEMSTONE = "sv07-137";
const EXP_SHARE = "sv01-174";

const JAMMING_TEXT =
  "Pokémon Tools attached to each Pokémon (both yours and your opponent's) have no effect.";
const FESTIVAL_TEXT =
  "Each Pokémon that has any Energy attached (both yours and your opponent's) recovers from all Special Conditions and can't be affected by any Special Conditions.";

const WALL = "d562s-wall";
const HEXER = "d562s-hexer";

const CONFUSE = 0; // "Your opponent's Active Pokémon is now Confused."
const REST = 1; // "This Pokémon is now Asleep. Heal 30 damage from it."
const TOXIC = 2; // "Your opponent's Active Pokémon is now Poisoned."

function printed(id: string, name: string, trainerType: string, effect: string): Card {
  return { ...trainerCard(id, trainerType, effect), name };
}

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(JAMMING.map((id) => [id, printed(id, "Jamming Tower", "Stadium", JAMMING_TEXT)])),
  ...Object.fromEntries(FESTIVAL.map((id) => [id, printed(id, "Festival Grounds", "Stadium", FESTIVAL_TEXT)])),
  [HEROS_CAPE]: printed(HEROS_CAPE, "Hero's Cape", "Tool", "The Pokémon this card is attached to gets +100 HP."),
  [AIR_BALLOON]: printed(
    AIR_BALLOON,
    "Air Balloon",
    "Tool",
    "The Retreat Cost of the Pokémon this card is attached to is {C}{C} less.",
  ),
  [RESCUE_BOARD]: printed(
    RESCUE_BOARD,
    "Rescue Board",
    "Tool",
    "The Retreat Cost of the Pokémon this card is attached to is {C} less. If that Pokémon's remaining HP is 30 or less, it has no Retreat Cost.",
  ),
  [COUNTER_GAIN]: printed(
    COUNTER_GAIN,
    "Counter Gain",
    "Tool",
    "If you have more Prize cards remaining than your opponent, attacks used by the Pokémon this card is attached to cost {C} less.",
  ),
  [GEMSTONE]: printed(
    GEMSTONE,
    "Gravity Gemstone",
    "Tool",
    "As long as the Pokémon this card is attached to is in the Active Spot, the Retreat Cost of both Active Pokémon is {C} more.",
  ),
  [WALL]: battler(WALL, { name: "D562 Wall", types: ["Colorless"], hp: 100, retreat: 3 }),
  [HEXER]: battler(HEXER, {
    name: "D562 Hexer",
    types: ["Psychic"],
    hp: 200,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Confuse Ray", damage: 10, effect: "Your opponent's Active Pokémon is now Confused." },
      { cost: ["Colorless"], name: "Rest", effect: "This Pokémon is now Asleep. Heal 30 damage from it." },
      { cost: ["Colorless"], name: "Toxic", damage: 10, effect: "Your opponent's Active Pokémon is now Poisoned." },
    ],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [JAMMING[0]]: 1,
  [JAMMING[1]]: 1,
  [FESTIVAL[0]]: 1,
  [FESTIVAL[1]]: 1,
  [HEROS_CAPE]: 1,
  [AIR_BALLOON]: 2,
  [RESCUE_BOARD]: 1,
  [COUNTER_GAIN]: 1,
  [GEMSTONE]: 1,
  [EXP_SHARE]: 1,
  [WALL]: 20,
  [HEXER]: 6,
  "fix-sturdy": 2,
  "fix-energy": 21,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup with p2 going first; returns p1's (unrestricted) turn 2 after p2 passed. */
function opened(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find((h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic");
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat: s }));
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** TEST SURGERY — one copy of `id` into `seat`'s DECK (back from the hand, or swapped out
    of the Prizes for the deck's bottom card). Every uid stays in exactly one zone. */
function ensureInDeck(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  if (side.deck.some((u) => state.cardIdByUid[u] === id)) return state;
  const held = side.hand.find((u) => state.cardIdByUid[u] === id);
  if (held !== undefined) {
    const next = { ...side, hand: side.hand.filter((u) => u !== held), deck: [...side.deck, held] };
    return { ...state, players: { ...state.players, [seat]: next } };
  }
  const prized = side.prizes.find((u) => state.cardIdByUid[u] === id);
  const swap = side.deck[side.deck.length - 1];
  if (prized === undefined || swap === undefined) throw new Error(`${seat} has no ${id} to seat`);
  const next = {
    ...side,
    prizes: side.prizes.map((u) => (u === prized ? swap : u)),
    deck: [...side.deck.slice(0, -1), prized],
  };
  return { ...state, players: { ...state.players, [seat]: next } };
}

/** p1's turn 2: p1 `active` (with `energy` {C}), p2 `oppActive` (with `oppEnergy`), a Tool
    on each Active if named, and each Bench EMPTY. */
function table(opts: {
  active?: string;
  oppActive?: string;
  energy?: number;
  oppEnergy?: number;
  tool?: string;
  oppTool?: string;
  seed?: number;
} = {}): GameState {
  let state = opened(opts.seed ?? 5622);
  state = setActiveFromDeck(ensureInDeck(state, "p1", opts.active ?? HEXER), "p1", opts.active ?? HEXER);
  state = setActiveFromDeck(ensureInDeck(state, "p2", opts.oppActive ?? WALL), "p2", opts.oppActive ?? WALL);
  state = clearBench(clearBench(state, "p1"), "p2");
  if (opts.tool !== undefined) state = attachToolFromDeck(ensureInDeck(state, "p1", opts.tool), "p1", "active", opts.tool);
  if (opts.oppTool !== undefined) {
    state = attachToolFromDeck(ensureInDeck(state, "p2", opts.oppTool), "p2", "active", opts.oppTool);
  }
  if ((opts.energy ?? 1) > 0) state = attachFromDeck(state, "p1", "fix-energy", opts.energy ?? 1);
  if ((opts.oppEnergy ?? 0) > 0) state = attachFromDeck(state, "p2", "fix-energy", opts.oppEnergy ?? 0);
  return state;
}

/** TEST SURGERY — `id` into the shared Stadium zone, owned by `owner`. */
function stadium(state: GameState, id: string, owner: Seat = "p1"): GameState {
  const ensured = ensureInDeck(state, owner, id);
  const side = ensured.players[owner];
  const uid = side.deck.find((u) => ensured.cardIdByUid[u] === id) as string;
  return {
    ...ensured,
    stadium: { uid, owner },
    players: { ...ensured.players, [owner]: { ...side, deck: side.deck.filter((u) => u !== uid) } },
  };
}

/** TEST SURGERY — one copy of `id` into `seat`'s hand; returns the board and its uid. */
function inHand(state: GameState, seat: Seat, id: string): { state: GameState; uid: string } {
  const ensured = ensureInDeck(state, seat, id);
  const side = ensured.players[seat];
  const uid = side.deck.find((u) => ensured.cardIdByUid[u] === id) as string;
  return {
    uid,
    state: {
      ...ensured,
      players: {
        ...ensured.players,
        [seat]: { ...side, deck: side.deck.filter((u) => u !== uid), hand: [...side.hand, uid] },
      },
    },
  };
}

function play(state: GameState, id: string) {
  const held = inHand(state, "p1", id);
  return mustApply(held.state, { type: "playTrainer", seat: "p1", uid: held.uid });
}

function all<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}
const active = (state: GameState, seat: Seat) => state.players[seat].active as InPlayPokemon;
const swing = (state: GameState, index: number) => mustApply(state, { type: "attack", seat: "p1", index });

// ────────────────────────────────────────────────────────────────────────────
describe("D562 stadiums §1 — the prints, and the registry rows that map them", () => {
  it("Jamming Tower ×2: ONE `stadium` key, `toolsHaveNoEffect`", () => {
    for (const id of JAMMING) {
      expect(programFor(id), id).toEqual({ stadium: { toolsHaveNoEffect: true } });
      expect(POOL[id]?.trainerType).toBe("Stadium");
    }
  });

  it("Festival Grounds ×2: ONE `stadium` key, `statusShieldIfEnergyAttached`", () => {
    for (const id of FESTIVAL) {
      expect(programFor(id), id).toEqual({ stadium: { statusShieldIfEnergyAttached: true } });
      expect(POOL[id]?.trainerType).toBe("Stadium");
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D562 stadiums §2 — Jamming Tower: every Tool EFFECT walk stops, every Tool COUNT stands (R-JT)", () => {
  it("🛑 `toolsInEffect` is the raw list without it and EMPTY under it — for BOTH seats", () => {
    const board = table({ tool: AIR_BALLOON, oppTool: AIR_BALLOON });
    for (const seat of ["p1", "p2"] as const) {
      expect(toolsInEffect(board, active(board, seat))).toEqual(active(board, seat).tools);
      expect(toolsInEffect(stadium(board, JAMMING[0], "p2"), active(board, seat))).toEqual([]);
    }
  });

  it("🛑 Hero's Cape: +100 HP (passivesOf's Tool source) → none; the holder's OWN printed passive stands", () => {
    const board = table({ oppActive: "fix-sturdy", oppTool: HEROS_CAPE });
    const jammed = stadium(board, JAMMING[1]);
    expect(effectiveMaxHp(board, active(board, "p2"))).toBe(220);
    expect(effectiveMaxHp(jammed, active(jammed, "p2"))).toBe(120);
    expect(passivesOf(jammed, active(jammed, "p2")).survivesKoAtFullHp).toBe(true);
  });

  it("🛑 PLAYING it Knocks Out a body Hero's Cape was holding up (playStadium's mid-turn sweep)", () => {
    const board = setDamage(table({ oppTool: HEROS_CAPE }), "p2", 150);
    const { events } = play(board, JAMMING[0]);
    expect(all(events, "KNOCKED_OUT").map((e) => e.seat)).toEqual(["p2"]);
  });

  it("🛑 Air Balloon's {C}{C} and Rescue Board's free retreat stop", () => {
    const balloon = table({ tool: AIR_BALLOON, active: WALL });
    expect(effectiveRetreatCost(balloon, active(balloon, "p1"))).toBe(1);
    const jammedBalloon = stadium(balloon, JAMMING[0]);
    expect(effectiveRetreatCost(jammedBalloon, active(jammedBalloon, "p1"))).toBe(3);
    const rescue = setDamage(table({ tool: RESCUE_BOARD, active: WALL }), "p1", 70);
    expect(effectiveRetreatCost(rescue, active(rescue, "p1"))).toBe(0);
    const jammedRescue = stadium(rescue, JAMMING[0]);
    expect(effectiveRetreatCost(jammedRescue, active(jammedRescue, "p1"))).toBe(3);
  });

  it("🛑 Counter Gain's {C} and Gravity Gemstone's {C} stop", () => {
    const gain = setPrizes(table({ tool: COUNTER_GAIN }), "p2", 3);
    expect(toolAttackCostDiscount(gain, active(gain, "p1"))).toBe(1);
    const jammedGain = stadium(gain, JAMMING[0]);
    expect(toolAttackCostDiscount(jammedGain, active(jammedGain, "p1"))).toBe(0);
    const stone = table({ oppTool: GEMSTONE });
    expect(activeRetreatSurcharge(stone, active(stone, "p1"))).toBe(1);
    const jammedStone = stadium(stone, JAMMING[0]);
    expect(activeRetreatSurcharge(jammedStone, active(jammedStone, "p1"))).toBe(0);
  });

  it("🛑 a Tool's on-KO trigger (Exp. Share) is silenced too — the scan is no longer ungated", () => {
    let board = table();
    board = benchFromDeck(ensureInDeck(board, "p2", WALL), "p2", WALL);
    board = attachToolFromDeck(ensureInDeck(board, "p2", EXP_SHARE), "p2", 0, EXP_SHARE);
    const koed = active(board, "p2").stack.at(-1) as string;
    expect(koToolTriggersOf(board, "p2", koed)).toHaveLength(1);
    expect(koToolTriggersOf(stadium(board, JAMMING[0]), "p2", koed)).toEqual([]);
  });

  it("🛑 R-JT — the COUNT reads stand: tools in play, the Active-has-a-Tool condition, and the §7.4 one-Tool cap", () => {
    const board = stadium(table({ tool: AIR_BALLOON, oppTool: AIR_BALLOON }), JAMMING[0]);
    expect(countToolsInPlay(board, "p1")).toBe(1);
    expect(conditionHolds(board, "p1", { kind: "yourActiveHasToolAttached" })).toBe(true);
    expect(conditionHolds(board, "p1", { kind: "opponentActiveHasToolAttached" })).toBe(true);
    const held = inHand(board, "p1", RESCUE_BOARD);
    expectErr(held.state, { type: "attachTool", seat: "p1", uid: held.uid, target: { spot: "active" } }, "TOOL_ALREADY_ATTACHED");
  });

  it("🛑 replaced by another Stadium, the Tools work again (a live read, nothing stamped)", () => {
    const board = stadium(table({ tool: AIR_BALLOON, active: WALL }), JAMMING[0]);
    expect(effectiveRetreatCost(board, active(board, "p1"))).toBe(3);
    const { state } = play(board, FESTIVAL[0]);
    expect(effectiveRetreatCost(state, active(state, "p1"))).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D562 stadiums §3 — Festival Grounds: the refusal and the recovery, both boards (R-FG)", () => {
  it("🛑 \"can't be affected\": an opposing Active WITH Energy refuses the condition (one STATUS_PREVENTED)", () => {
    const board = stadium(table({ oppEnergy: 1 }), FESTIVAL[0]);
    const { state, events } = swing(board, CONFUSE);
    expect(all(events, "STATUS_PREVENTED").map((e) => [e.seat, e.status])).toEqual([["p2", "confused"]]);
    expect(all(events, "STATUS_APPLIED")).toEqual([]);
    expect(active(state, "p2").conditions.rotation).toBe("none");
  });

  it("🛑 WITHOUT Energy the condition lands — \"that has any Energy attached\"", () => {
    const { events } = swing(stadium(table(), FESTIVAL[0]), TOXIC);
    expect(all(events, "STATUS_APPLIED").map((e) => [e.seat, e.status])).toEqual([["p2", "poisoned"]]);
  });

  it("🛑 \"both yours and your opponent's\" — the attacker's OWN self-inflicted Sleep is refused too", () => {
    const { events } = swing(stadium(table(), FESTIVAL[0], "p2"), REST);
    expect(all(events, "STATUS_PREVENTED").map((e) => [e.seat, e.status])).toEqual([["p1", "asleep"]]);
  });

  it("🛑 \"recovers from ALL\" — PLAYING it clears every condition on each Energy-carrying Active, both boards", () => {
    let board = table({ oppEnergy: 1 });
    board = setConditions(board, "p2", { poisonDamage: 10, burned: true, rotation: "asleep" });
    board = setConditions(board, "p1", { rotation: "confused" });
    const { state, events } = play(board, FESTIVAL[1]);
    const cleared = all(events, "STATUS_CLEARED");
    expect(cleared.map((e) => [e.seat, [...e.statuses].sort(), e.reason])).toEqual([
      ["p1", ["confused"], "recovered"],
      ["p2", ["asleep", "burned", "poisoned"], "recovered"],
    ]);
    expect(active(state, "p2").conditions).toMatchObject({ poisonDamage: 0, burned: false, rotation: "none" });
  });

  it("🛑 a body WITHOUT Energy keeps its conditions when it is played", () => {
    const board = setConditions(table({ energy: 0 }), "p1", { burned: true });
    const { state, events } = play(board, FESTIVAL[0]);
    expect(all(events, "STATUS_CLEARED")).toEqual([]);
    expect(active(state, "p1").conditions.burned).toBe(true);
  });

  it("🛑 an Energy ATTACHED while it is in play cures the body at once (the §6.2 moment)", () => {
    let board = stadium(setConditions(table({ energy: 0 }), "p1", { poisonDamage: 10 }), FESTIVAL[0]);
    const held = inHand(board, "p1", "fix-energy");
    board = held.state;
    const { state, events } = mustApply(board, {
      type: "attachEnergy",
      seat: "p1",
      uid: held.uid,
      target: { spot: "active" },
    });
    expect(all(events, "STATUS_CLEARED").map((e) => [e.seat, e.statuses, e.reason])).toEqual([
      ["p1", ["poisoned"], "recovered"],
    ]);
    expect(active(state, "p1").conditions.poisonDamage).toBe(0);
  });

  it("`stadiumShieldsStatus`: the Stadium AND any Energy, or nothing", () => {
    const board = table({ oppEnergy: 1 });
    expect(stadiumShieldsStatus(board, active(board, "p2"))).toBe(false);
    const grounds = stadium(board, FESTIVAL[0]);
    expect(stadiumShieldsStatus(grounds, active(grounds, "p2"))).toBe(true);
    const bare = stadium(table(), FESTIVAL[0]);
    expect(stadiumShieldsStatus(bare, active(bare, "p2"))).toBe(false);
    const jammed = stadium(board, JAMMING[0]);
    expect(stadiumShieldsStatus(jammed, active(jammed, "p2"))).toBe(false);
  });

  it("\"recovers\" is one-way: replaced by Jamming Tower, the cured body stays cured and can be affected again", () => {
    let board = setConditions(table({ oppEnergy: 1 }), "p2", { rotation: "asleep" });
    board = play(board, FESTIVAL[0]).state;
    expect(active(board, "p2").conditions.rotation).toBe("none");
    board = { ...board, allowances: { ...board.allowances, stadiumPlayed: false } };
    board = play(board, JAMMING[0]).state;
    expect(active(board, "p2").conditions.rotation).toBe("none");
    const { events } = swing(board, CONFUSE);
    expect(all(events, "STATUS_APPLIED").map((e) => e.status)).toEqual(["confused"]);
  });
});
