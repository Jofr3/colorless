import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { countAttachedEnergy, providedEnergy } from "./continuous";
import { deriveAttackEffect } from "./effects";
import type { GameAction, GameEvent, GameState, PokemonRef, Seat } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { programFor } from "./registry";
import { flipCoin } from "./rng";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  expectErr,
  mustApply,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D645 — THE LAST ONE-OFFS ──
//
// 3 printed texts / 5 `me` printings: Meganium `me01-010` / `mep-001` "Wild Growth" (the NEW
// `PassiveEffects.basicEnergyProvidesTwice`, continuous.ts `doubledBasicEnergyType` inside `unitsOf`; R-WGR1, R-WGR2),
// Goodra `me04-068` / `mep-077` "Slimy Sliding" (the NEW `PassiveEffects.retreatFailsOnTails`, continuous.ts
// `retreatCoinFlipSource`, asked by turn.ts `retreat`; R-SLD1, R-SLD2, R-SLD3) and Deoxys `me04-032` "Psyspear"
// (`CONDITIONAL_BENCH_SNIPE` over the NEW `BoardCondition` `extraEnergyBeyondAttackCost`, answered at declaration by
// attack.ts `resolveDeclarationGates`; R-PSP1). Every id and text off the LOCAL D1
// (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-10, `legal_standard = 1`. Driven on a LOCAL `cardPool` (D275) in
// the suite's OWN 60-card deck (D270).

const WILD_GROWTH_TEXT =
  "Each Basic {G} Energy attached to all of your Pokémon provides {G}{G} Energy. The effect of Wild Growth doesn't stack.";
const SLIMY_TEXT =
  "When your opponent's Active Pokémon retreats, your opponent flips a coin. If tails, Energy for its Retreat Cost is not discarded, and they don't switch Pokémon. The effect of Slimy Sliding doesn't stack.";
const PSYSPEAR_TEXT =
  "If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const MEGANIUM = "me01-010";
const MEGANIUM_P = "mep-001";
const GOODRA = "me04-068";
const GOODRA_P = "mep-077";
const DEOXYS = "me04-032";
const FLUTTER = "sv05-078"; // Flutter Mane "Midnight Fluttering": the opposing Active has no Abilities

const LEAFY = "d645-leafy"; // {G}, 400 HP, Retreat 2: "Twin Leaf" {G}{G} 10
const FILLER = "d645-filler"; // {C}, 400 HP, Retreat 1
const WALL = "d645-wall"; // {C}, 400 HP, no attack
const G = "d645-grass";
const R = "d645-fire";
const P = "d645-psychic";
const SPARE = "d645-spare";

const TAP: Card["attacks"] = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];
const ability = (name: string, effect: string) => ({ abilities: [{ type: "Ability", name, effect }] }) as Partial<Card>;
const mon = (id: string, name: string, hp: number, types: string[], attacks: Card["attacks"], extra: Partial<Card> = {}) =>
  battler(id, { name, hp, types, retreat: 1, attacks, ...extra });
const meganium = (id: string) =>
  mon(id, "Meganium", 160, ["Grass"], [{ cost: ["Grass", "Grass", "Colorless", "Colorless"], name: "Solar Beam", damage: 140 }], {
    stage: "Stage2",
    evolveFrom: "Bayleef",
    retreat: 2,
    ...ability("Wild Growth", WILD_GROWTH_TEXT),
  });
const goodra = (id: string) =>
  mon(id, "Goodra", 160, ["Dragon"], [{ cost: ["Water", "Psychic"], name: "Dragon Pulse", damage: 160, effect: "Discard the top card of your deck." }], {
    stage: "Stage2",
    evolveFrom: "Sliggoo",
    retreat: 3,
    ...ability("Slimy Sliding", SLIMY_TEXT),
  });

const LOCAL: Record<string, Card> = {
  [MEGANIUM]: meganium(MEGANIUM),
  [MEGANIUM_P]: meganium(MEGANIUM_P),
  [GOODRA]: goodra(GOODRA),
  [GOODRA_P]: goodra(GOODRA_P),
  [DEOXYS]: mon(DEOXYS, "Deoxys", 120, ["Psychic"], [{ cost: ["Psychic", "Psychic", "Psychic"], name: "Psyspear", damage: 120, effect: PSYSPEAR_TEXT }], {
    retreat: 2,
  }),
  [FLUTTER]: mon(FLUTTER, "Flutter Mane", 90, ["Psychic"], TAP, ability("Midnight Fluttering", "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities, except for Midnight Fluttering.")),
  [LEAFY]: mon(LEAFY, "D645 Leafy", 400, ["Grass"], [{ cost: ["Grass", "Grass"], name: "Twin Leaf", damage: 10 }], { retreat: 2 }),
  [FILLER]: mon(FILLER, "D645 Filler", 400, ["Colorless"], TAP),
  [WALL]: mon(WALL, "D645 Wall", 400, ["Colorless"], []),
  [G]: typedEnergy(G, "Grass"),
  [R]: typedEnergy(R, "Fire"),
  [P]: typedEnergy(P, "Psychic"),
  [SPARE]: typedEnergy(SPARE, "Metal"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [MEGANIUM]: 2,
  [MEGANIUM_P]: 1,
  [GOODRA]: 2,
  [GOODRA_P]: 1,
  [DEOXYS]: 1,
  [FLUTTER]: 1,
  [LEAFY]: 2,
  [FILLER]: 10,
  [WALL]: 4,
  [G]: 6,
  [R]: 2,
  [P]: 6,
  "fix-energy": 4,
  [SPARE]: 18,
});
const BOARD_IDS = new Set(Object.keys(LOCAL).filter((id) => id !== SPARE).concat(["fix-energy"]));

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup, then P1's own FIRST turn (P2 went first and passed); both hands back into the decks. */
function p1Turn(): GameState {
  const created = createGame({ seed: 6451, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    state = { ...state, players: { ...state.players, [s]: { ...side, hand: [], deck: [...side.deck, ...side.hand] } } };
  }
  return state;
}

/** TEST SURGERY — every Prize whose id is a board id swapped with a non-board deck card. */
function unprize(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  let deck = [...side.deck];
  const prizes = side.prizes.map((u) => {
    if (!BOARD_IDS.has(state.cardIdByUid[u] ?? "")) return u;
    const swap = deck.find((d) => !BOARD_IDS.has(state.cardIdByUid[d] ?? ""));
    if (swap === undefined) throw new Error("no swap card");
    deck = [...deck.filter((d) => d !== swap), u];
    return swap;
  });
  return { ...state, players: { ...state.players, [seat]: { ...side, prizes, deck } } };
}

/** TEST SURGERY — `count` copies of the Energy `cardId` from `seat`'s deck onto its Active, or Bench body `index`. */
function energize(state: GameState, seat: Seat, cardId: string, count: number, index?: number): GameState {
  const side = state.players[seat];
  const uids = side.deck.filter((u) => state.cardIdByUid[u] === cardId).slice(0, count);
  if (uids.length < count) throw new Error(`${seat} deck has ${uids.length} ${cardId}, needed ${count}`);
  const deck = side.deck.filter((u) => !uids.includes(u));
  if (index === undefined) {
    if (side.active === null) throw new Error(`no ${seat} Active`);
    return { ...state, players: { ...state.players, [seat]: { ...side, deck, active: { ...side.active, energy: [...side.active.energy, ...uids] } } } };
  }
  const bench = side.bench.map((b, i) => (i === index ? { ...b, energy: [...b.energy, ...uids] } : b));
  return { ...state, players: { ...state.players, [seat]: { ...side, deck, bench } } };
}

type Board = { active: string; energy?: readonly (readonly [string, number])[]; bench?: readonly string[] };

/** P1's board and P2's board, on P1's first turn. */
function table(p1: Board, p2: Board): GameState {
  let state = p1Turn();
  for (const [s, board] of [["p1", p1], ["p2", p2]] as const) {
    state = unprize(clearBench(setActiveFromDeck(state, s, FILLER), s), s);
    state = clearBench(setActiveFromDeck(state, s, board.active), s);
    for (const [id, n] of board.energy ?? []) state = energize(state, s, id, n);
    for (const id of board.bench ?? []) state = benchFromDeck(state, s, id);
  }
  return state;
}

/** The smallest `rngState` whose next coin is `face`. */
function cursorFor(face: "heads" | "tails"): number {
  for (let n = 1; n < 1000; n++) if (flipCoin(n)[0] === face) return n;
  throw new Error("no cursor");
}

const attack = (index: number): GameAction => ({ type: "attack", seat: "p1", index });
const retreat = (state: GameState, promoteBenchIndex = 0): GameAction => ({
  type: "retreat",
  seat: "p1",
  discardEnergy: [...(state.players.p1.active?.energy ?? [])],
  promoteBenchIndex,
});
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const topOf = (state: GameState, seat: Seat, index?: number) => {
  const side = state.players[seat];
  const body = index === undefined ? side.active : side.bench[index];
  return body?.stack.at(-1);
};
const bench = (index: number): PokemonRef => ({ seat: "p2", spot: { spot: "bench", index } });
const pick = (state: GameState, ref: PokemonRef) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemonMulti", refs: [ref] } } as GameAction);
const p2Damage = (state: GameState) => [state.players.p2.active?.damage ?? -1, ...state.players.p2.bench.map((b) => b.damage)];

describe("D645 §1 — the prints and the registry rows", () => {
  it("four keys on two NEW objects; Psyspear is reader-built and unkeyed", () => {
    expect(programFor(MEGANIUM)).toEqual({ passive: { basicEnergyProvidesTwice: "Grass" } });
    expect(programFor(MEGANIUM_P)).toBe(programFor(MEGANIUM));
    expect(programFor(GOODRA)).toEqual({ passive: { retreatFailsOnTails: "Slimy Sliding" } });
    expect(programFor(GOODRA_P)).toBe(programFor(GOODRA));
    expect(programFor(DEOXYS)).toBeUndefined();
    expect(deriveAttackEffect(PSYSPEAR_TEXT)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "extraEnergyBeyondAttackCost", extra: 2 },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list.
        then: [{ op: "damageChosen", target: "opponentBench", amount: 120, count: 1, source: "attack", deals: true }],
      },
    ]);
  });

  it("is built at engine 0.550.0", () => {
    expect(engineVersion).toBe("0.550.0");
  });
});

describe("D645 §2 — Wild Growth: each Basic {G} Energy on its owner's Pokémon provides {G}{G}", () => {
  it("a Basic {G} on a body of Meganium's side provides two units; without Meganium, one", () => {
    const grown = table({ active: LEAFY, energy: [[G, 1]], bench: [MEGANIUM] }, { active: WALL });
    const leafy = grown.players.p1.active;
    if (leafy === null) throw new Error("no Active");
    expect(providedEnergy(grown, leafy)).toEqual(["Grass", "Grass"]);
    const plain = table({ active: LEAFY, energy: [[G, 1]], bench: [FILLER] }, { active: WALL });
    if (plain.players.p1.active === null) throw new Error("no Active");
    expect(providedEnergy(plain, plain.players.p1.active)).toEqual(["Grass"]);
  });

  it("one Basic {G} pays Twin Leaf's {G}{G} under Wild Growth; without it, the cost is unmet", () => {
    const grown = table({ active: LEAFY, energy: [[G, 1]], bench: [MEGANIUM] }, { active: WALL });
    expect(p2Damage(mustApply(grown, attack(0)).state)).toEqual([10]);
    expectErr(table({ active: LEAFY, energy: [[G, 1]], bench: [FILLER] }, { active: WALL }), attack(0), "ATTACK_COST_UNMET");
  });

  it("only Basic {G}: a Basic {R} beside it stays one unit", () => {
    const state = table({ active: LEAFY, energy: [[G, 1], [R, 1]], bench: [MEGANIUM] }, { active: WALL });
    if (state.players.p1.active === null) throw new Error("no Active");
    expect(providedEnergy(state, state.players.p1.active)).toEqual(["Grass", "Grass", "Fire"]);
  });

  it("only YOUR Pokémon: the opponent's Meganium doubles nothing on P1's board", () => {
    const state = table({ active: LEAFY, energy: [[G, 1]], bench: [FILLER] }, { active: WALL, bench: [MEGANIUM] });
    expectErr(state, attack(0), "ATTACK_COST_UNMET");
  });

  it("doesn't stack: two Meganium still make one Basic {G} two units, not four", () => {
    const state = table({ active: LEAFY, energy: [[G, 1]], bench: [MEGANIUM, MEGANIUM_P] }, { active: WALL });
    if (state.players.p1.active === null) throw new Error("no Active");
    expect(providedEnergy(state, state.players.p1.active)).toEqual(["Grass", "Grass"]);
  });

  it("§9: an opposing Active Flutter Mane silences an Active Meganium — its own Basic {G} provides one unit", () => {
    const locked = table({ active: MEGANIUM, energy: [[G, 1]] }, { active: FLUTTER });
    if (locked.players.p1.active === null) throw new Error("no Active");
    expect(providedEnergy(locked, locked.players.p1.active)).toEqual(["Grass"]);
    const live = table({ active: MEGANIUM, energy: [[G, 1]] }, { active: WALL });
    if (live.players.p1.active === null) throw new Error("no Active");
    expect(providedEnergy(live, live.players.p1.active)).toEqual(["Grass", "Grass"]);
  });

  it("R-WGR1: a card COUNT does not move — one Basic {G} card is one {G} Energy attached", () => {
    const state = table({ active: LEAFY, energy: [[G, 1]], bench: [MEGANIUM] }, { active: WALL });
    if (state.players.p1.active === null) throw new Error("no Active");
    expect(countAttachedEnergy(state, state.players.p1.active, "Grass")).toBe(1);
  });

  it("R-WGR2: a Retreat Cost is still paid in Energy CARDS — one Basic {G} does not pay Retreat 2", () => {
    const state = table({ active: LEAFY, energy: [[G, 1]], bench: [MEGANIUM] }, { active: WALL });
    expectErr(state, retreat(state), "RETREAT_COST_MISMATCH");
  });
});

describe("D645 §3 — Slimy Sliding: the opponent's retreat flips a coin; tails, it doesn't happen", () => {
  const board = () => table({ active: FILLER, energy: [["fix-energy", 1]], bench: [WALL] }, { active: WALL, bench: [GOODRA] });

  it("tails: no Energy discarded, no switch, and the retreat is spent (R-SLD2)", () => {
    const state = { ...board(), rngState: cursorFor("tails") };
    const before = state.players.p1;
    const goodraUid = topOf(state, "p2", 0);
    const { state: after, events } = mustApply(state, retreat(state));
    expect(events).toEqual([
      { type: "ABILITY_TRIGGERED", seat: "p2", uid: goodraUid, ability: "Slimy Sliding" },
      { type: "ABILITY_COIN_FLIP", seat: "p2", uid: goodraUid, ability: "Slimy Sliding", result: "tails" },
    ]);
    expect(after.players.p1.active).toEqual(before.active);
    expect(after.players.p1.bench).toEqual(before.bench);
    expect(after.players.p1.discard).toEqual(before.discard);
    expect(after.allowances.retreated).toBe(true);
    expect(after.rngState).toBe(flipCoin(state.rngState)[1]);
    expectErr(after, retreat(after), "ALREADY_RETREATED");
  });

  it("heads: the retreat happens as printed, behind the two rows", () => {
    const state = { ...board(), rngState: cursorFor("heads") };
    const activeUid = topOf(state, "p1");
    const { state: after, events } = mustApply(state, retreat(state));
    expect(events.slice(0, 2).map((e) => e.type)).toEqual(["ABILITY_TRIGGERED", "ABILITY_COIN_FLIP"]);
    expect(of(events, "ABILITY_COIN_FLIP").map((e) => e.result)).toEqual(["heads"]);
    expect(of(events, "RETREATED")).toHaveLength(1);
    expect(topOf(after, "p1", 0)).toBe(activeUid);
    expect(after.players.p1.discard.map((u) => after.cardIdByUid[u])).toEqual(["fix-energy"]);
    expect(after.rngState).toBe(flipCoin(state.rngState)[1]);
  });

  it("no Goodra (or only P1's own): no coin, the shipped retreat, the RNG untouched", () => {
    for (const p1Bench of [[WALL], [WALL, GOODRA]]) {
      const state = { ...table({ active: FILLER, energy: [["fix-energy", 1]], bench: p1Bench }, { active: WALL }), rngState: cursorFor("tails") };
      const { state: after, events } = mustApply(state, retreat(state));
      expect(events[0]?.type).toBe("RETREATED");
      expect(of(events, "ABILITY_COIN_FLIP")).toEqual([]);
      expect(after.rngState).toBe(state.rngState);
    }
  });

  it("doesn't stack: two Goodra (Active and Bench) flip ONE coin, named for the Active", () => {
    const base = table({ active: FILLER, energy: [["fix-energy", 1]], bench: [WALL] }, { active: GOODRA, bench: [GOODRA_P] });
    const state = { ...base, rngState: cursorFor("tails") };
    const { events } = mustApply(state, retreat(state));
    expect(of(events, "ABILITY_COIN_FLIP")).toEqual([
      { type: "ABILITY_COIN_FLIP", seat: "p2", uid: topOf(state, "p2"), ability: "Slimy Sliding", result: "tails" },
    ]);
  });

  it("§9: P1's Active Flutter Mane silences an Active Goodra — no coin", () => {
    const state = { ...table({ active: FLUTTER, energy: [["fix-energy", 1]], bench: [WALL] }, { active: GOODRA }), rngState: cursorFor("tails") };
    const { events } = mustApply(state, retreat(state));
    expect(of(events, "ABILITY_COIN_FLIP")).toEqual([]);
    expect(of(events, "RETREATED")).toHaveLength(1);
  });

  it("R-SLD1: a retreat refused by its own checks flips nothing", () => {
    const state = { ...board(), rngState: cursorFor("tails") };
    const result = applyAction(state, { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 });
    expect(result.ok).toBe(false);
  });
});

describe("D645 §4 — Psyspear: at least 2 extra Energy beyond the cost, 120 to 1 Benched Pokémon", () => {
  it("3 {P} on a {P}{P}{P} cost (no extra) and 4 (one extra): the 120 to the Active only, no pick", () => {
    for (const n of [3, 4]) {
      const result = mustApply(table({ active: DEOXYS, energy: [[P, n]] }, { active: WALL, bench: [FILLER, FILLER] }), attack(0));
      expect(result.state.phase.kind).not.toBe("effect:choose");
      expect(p2Damage(result.state)).toEqual([120, 0, 0]);
      expect(of(result.events, "ATTACK_EFFECT_SKIPPED")).toEqual([]);
    }
  });

  it("5 {P} (two extra): the Bench pick parks without the gate, and 120 lands on the chosen body", () => {
    const parked = mustApply(table({ active: DEOXYS, energy: [[P, 5]] }, { active: WALL, bench: [FILLER, FILLER] }), attack(0)).state;
    expect(parked.phase.kind).toBe("effect:choose");
    expect(JSON.stringify(parked.phase)).not.toContain("extraEnergyBeyondAttackCost");
    expect(JSON.stringify(parked.phase)).not.toContain("conditionGate");
    expect(p2Damage(pick(parked, bench(1)).state)).toEqual([120, 0, 120]);
  });

  it("R-PSP1: UNITS, not cards — 3 {P} + 1 Basic {G} under Wild Growth is 5 units, two extra", () => {
    const state = table({ active: DEOXYS, energy: [[P, 3], [G, 1]], bench: [MEGANIUM] }, { active: WALL, bench: [FILLER, FILLER] });
    expect(mustApply(state, attack(0)).state.phase.kind).toBe("effect:choose");
  });

  it("the member answers FALSE off attack.ts (no cost in scope) and notes the printed clause", () => {
    const state = table({ active: DEOXYS, energy: [[P, 5]] }, { active: WALL });
    expect(conditionHolds(state, "p1", { kind: "extraEnergyBeyondAttackCost", extra: 0 })).toBe(false);
    expect(conditionNote({ kind: "extraEnergyBeyondAttackCost", extra: 2 })).toBe(
      "this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost)",
    );
  });
});
