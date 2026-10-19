import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { countersMoveLocked, weaknessAmountOverride, withWeaknessAmount } from "./continuous";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame, engineVersion, redactGame } from "./index";
import type { EffectContext } from "./interpreter";
import { isCounterMoveOp, startlingDropRetort } from "./interpreter";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  trainerCard,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D644 — Y1e: RULE HOOKS, ONE PRINTING EACH ──
//
// 5 printed texts / 5 printings on five NEW registry objects: Cinderace `me01-028` "Explosiveness" (the NEW
// `CardProgram.setupActiveFromHand`, setup.ts `setupPlaceActive`; R-EXP1, R-EXP2), Patrat `me04-070` "Watchful Eye"
// (the NEW `PassiveEffects.countersCantMove`, continuous.ts `countersMoveLocked`; R-WEY1), Illumise `30th-004`
// "Supereffective Pheromones" (the NEW `PassiveEffects.weaknessTimesWithNamedInPlay`, continuous.ts
// `weaknessAmountOverride`; R-SPH1, R-SPH2), Ferrothorn `me04-063` "Startling Drop" (the NEW
// `CardProgram.opponentMillWhenMilled`, interpreter.ts `startlingDropRetort`; R-STD1, R-STD2) and Transformation Tome
// `me04-083` (shipped `payFromHand` + `switchWithDiscardNamed`; R-TFT1, R-TFT2). Dropped and named: Backtrack Badge
// `me05-074` [🆕🆕🆕 D646 (D539): built at D646]. Every id and text off the LOCAL D1 (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-10,
// `legal_standard = 1`. Driven on a LOCAL `cardPool` (D275) in the suite's OWN 60-card deck (D270).

const EXPLOSIVENESS_TEXT =
  "If this Pokémon is in your hand when you are setting up to play, you may put it face down in the Active Spot.";
const WATCHFUL_TEXT = "Damage counters on each Pokémon (both yours and your opponent's) can't be moved to other Pokémon.";
const PHEROMONES_TEXT = "If you have Volbeat in play, apply Weakness for both Active Pokémon as ×3.";
const STARTLING_TEXT =
  "During your opponent's turn, if this Pokémon is discarded from your deck by an effect of an attack or Ability from your opponent's Pokémon, or by an effect of your opponent's Item or Supporter cards, discard the top 8 cards of your opponent's deck.";
const TOME_TEXT =
  "You must play 2 Transformation Tome cards at once. (This effect works one time for 2 cards.)\n\nChoose a Basic Pokémon in your discard pile and switch it with 1 of your Basic Pokémon in play. Any attached cards, damage counters, Special Conditions, turns in play, and any other effects remain on the new Pokémon.";

const CINDERACE = "me01-028";
const PATRAT = "me04-070";
const ILLUMISE = "30th-004";
const FERROTHORN = "me04-063";
const TOME = "me04-083";
const BADGE = "me05-074"; // Backtrack Badge — dropped and named [🆕🆕🆕 D646 (D539): built at D646, `backtrackBadgeMeD646.test.ts`]
const FLUTTER = "sv05-078"; // Flutter Mane "Midnight Fluttering": the opposing Active has no Abilities
const MUNKIDORI = "sv06-095"; // "Adrena-Brain" (D572)
const ORBEETLE = "sv10-089"; // Team Rocket's Orbeetle "Rocket Brain" (D565)

const MOVER = "d644-mover"; // {G}, 400 HP, the MOVES below
const FILLER = "d644-filler"; // {C}, 400 HP
const TARGET = "d644-target"; // {C}, 400 HP, Weakness {G}×2 and {R}×2
const BLAZE = "d644-blaze"; // {R}, 400 HP
const VOLBEAT = "d644-volbeat"; // a plain "Volbeat"
const PEBBLE = "d644-pebble"; // {C} Basic, 70 HP
const SPROUT = "d644-sprout"; // {G} Basic, 60 HP
const SHRUB = "d644-shrub"; // {G} Stage 1 from Sprout, 100 HP
const E = "fix-energy";
const DARK = "d644-dark";
const SPARE = "d644-spare";

const TO_DEFENDER = "Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.";
const TO_CHOSEN = "Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon.";
const ANY_WAY = "You may move any number of damage counters from your opponent's Benched Pokémon to their Active Pokémon.";
const SNIPE =
  "This attack does 30 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** 0 Transfer, 1 Extend, 2 Collect (the three counter-move attacks); 3 Hit 30; 4 Snipe 30; 5 Mill 2; 6 Self-mill 2. */
const MOVES: Card["attacks"] = [
  { cost: ["Colorless"], name: "Transfer", damage: "", effect: TO_DEFENDER },
  { cost: ["Colorless"], name: "Extend", damage: "", effect: TO_CHOSEN },
  { cost: ["Colorless"], name: "Collect", damage: "", effect: ANY_WAY },
  { cost: ["Colorless"], name: "Hit", damage: 30 },
  { cost: ["Colorless"], name: "Snipe", damage: "", effect: SNIPE },
  { cost: ["Colorless"], name: "Mill", damage: "", effect: "Discard the top 2 cards of your opponent's deck." },
  { cost: ["Colorless"], name: "Dig", damage: "", effect: "Discard the top 2 cards of your deck." },
];
const TRANSFER = 0;
const EXTEND = 1;
const COLLECT = 2;
const HIT = 3;
const SNIPE_AT = 4;
const MILL = 5;
const DIG = 6;
const TAP: Card["attacks"] = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];

const ability = (name: string, effect: string) => ({ abilities: [{ type: "Ability", name, effect }] }) as Partial<Card>;
const mon = (id: string, name: string, hp: number, types: string[], attacks: Card["attacks"], extra: Partial<Card> = {}) =>
  battler(id, { name, hp, types, retreat: 1, attacks, ...extra });

const LOCAL: Record<string, Card> = {
  [CINDERACE]: mon(
    CINDERACE,
    "Cinderace",
    160,
    ["Fire"],
    [
      {
        cost: ["Colorless"],
        name: "Turbo Flare",
        damage: 50,
        effect:
          "Search your deck for up to 3 Basic Energy cards and attach them to your Benched Pokémon in any way you like. Then, shuffle your deck.",
      },
    ],
    { stage: "Stage2", evolveFrom: "Raboot", ...ability("Explosiveness", EXPLOSIVENESS_TEXT) },
  ),
  [PATRAT]: mon(PATRAT, "Patrat", 70, ["Colorless"], [{ cost: ["Colorless"], name: "Bite", damage: 10 }], ability("Watchful Eye", WATCHFUL_TEXT)),
  [ILLUMISE]: mon(ILLUMISE, "Illumise", 80, ["Grass"], [{ cost: ["Grass", "Colorless"], name: "Ram", damage: 30 }], {
    weaknesses: [{ type: "Fire", value: "×2" }],
    ...ability("Supereffective Pheromones", PHEROMONES_TEXT),
  }),
  [FERROTHORN]: mon(
    FERROTHORN,
    "Ferrothorn",
    130,
    ["Metal"],
    [{ cost: ["Metal", "Metal"], name: "Special Whip", damage: "70+", effect: "If this Pokémon has any Special Energy attached, this attack does 70 more damage." }],
    { stage: "Stage1", evolveFrom: "Ferroseed", ...ability("Startling Drop", STARTLING_TEXT) },
  ),
  [TOME]: { ...trainerCard(TOME, "Item", TOME_TEXT), name: "Transformation Tome" },
  [FLUTTER]: mon(FLUTTER, "Flutter Mane", 90, ["Fire"], MOVES, ability("Midnight Fluttering", "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities, except for Midnight Fluttering.")),
  [MUNKIDORI]: mon(MUNKIDORI, "Munkidori", 110, ["Psychic"], TAP, ability("Adrena-Brain", "Once during your turn, if this Pokémon has any {D} Energy attached, you may move up to 3 damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon.")),
  [ORBEETLE]: mon(ORBEETLE, "Team Rocket's Orbeetle", 130, ["Psychic"], TAP, ability("Rocket Brain", "As often as you like during your turn, you may move 1 damage counter from 1 of your Team Rocket's Pokémon to another of your Pokémon.")),
  [MOVER]: mon(MOVER, "D644 Mover", 400, ["Grass"], MOVES),
  [FILLER]: mon(FILLER, "D644 Filler", 400, ["Colorless"], TAP),
  [TARGET]: mon(TARGET, "D644 Target", 400, ["Colorless"], TAP, {
    weaknesses: [
      { type: "Grass", value: "×2" },
      { type: "Fire", value: "×2" },
    ],
  }),
  [BLAZE]: mon(BLAZE, "D644 Blaze", 400, ["Fire"], MOVES),
  [VOLBEAT]: mon(VOLBEAT, "Volbeat", 80, ["Grass"], TAP),
  [PEBBLE]: mon(PEBBLE, "D644 Pebble", 70, ["Colorless"], TAP),
  [SPROUT]: mon(SPROUT, "D644 Sprout", 60, ["Grass"], TAP),
  [SHRUB]: mon(SHRUB, "D644 Shrub", 100, ["Grass"], TAP, { stage: "Stage1", evolveFrom: "D644 Sprout" }),
  [DARK]: typedEnergy(DARK, "Darkness"),
  [SPARE]: typedEnergy(SPARE, "Metal"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [CINDERACE]: 1,
  [PATRAT]: 2,
  [ILLUMISE]: 1,
  [FERROTHORN]: 2,
  [TOME]: 3,
  [FLUTTER]: 1,
  [MUNKIDORI]: 1,
  [ORBEETLE]: 1,
  [MOVER]: 1,
  [FILLER]: 10,
  [TARGET]: 1,
  [BLAZE]: 1,
  [VOLBEAT]: 2,
  [PEBBLE]: 2,
  [SPROUT]: 2,
  [SHRUB]: 1,
  [E]: 6,
  [DARK]: 2,
  "fix-stage2": 1,
  [SPARE]: 19,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

const isBasic = (state: GameState, uid: string) => POOL[state.cardIdByUid[uid] ?? ""]?.stage === "Basic";

/** createGame through the first-player choice: both seats at `setup:place` (opening). */
function placing(): GameState {
  const created = createGame({ seed: 6440, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }));
  if (state.phase.kind !== "setup:place") throw new Error(`expected setup:place, got ${state.phase.kind}`);
  return state;
}

/** TEST SURGERY — `cardId` out of `seat`'s deck into its hand (no-op when the hand already holds one). */
function inHand(state: GameState, seat: Seat, cardId: string): GameState {
  return state.players[seat].hand.some((u) => state.cardIdByUid[u] === cardId) ? state : handFromDeck(state, seat, cardId, 1);
}

/** TEST SURGERY — every Basic in `seat`'s hand back into its deck. */
function noBasicInHand(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  const basics = side.hand.filter((u) => isBasic(state, u));
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, hand: side.hand.filter((u) => !basics.includes(u)), deck: [...side.deck, ...basics] } },
  };
}

/** Setup, then P1's own SECOND turn (P2 went first; every turn passed); both hands back into the decks. */
function p1Turn(): GameState {
  let state = placing();
  for (const s of ["p1", "p2"] as const) {
    state = inHand(state, s, FILLER);
    const uid = state.players[s].hand.find((h) => state.cardIdByUid[h] === FILLER);
    if (uid === undefined) throw new Error(`no Filler in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat: s }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    state = { ...state, players: { ...state.players, [s]: { ...side, hand: [], deck: [...side.deck, ...side.hand] } } };
  }
  return state;
}

const BOARD_IDS = Object.keys(LOCAL).filter((id) => id !== SPARE).concat([E]);

/** TEST SURGERY — every Prize whose id is a board id swapped with a SPARE from the deck. */
function unprize(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  const kept = new Set(BOARD_IDS);
  let deck = [...side.deck];
  const prizes = side.prizes.map((u) => {
    if (!kept.has(state.cardIdByUid[u] ?? "")) return u;
    const swap = deck.find((d) => !kept.has(state.cardIdByUid[d] ?? ""));
    if (swap === undefined) throw new Error("no swap card");
    deck = [...deck.filter((d) => d !== swap), u];
    return swap;
  });
  return { ...state, players: { ...state.players, [seat]: { ...side, prizes, deck } } };
}

/** P1's Active `attacker` (one {C} attached) over `p1Bench`; P2's Active `defender` over `p2Bench`. */
function table(attacker: string, defender: string, p2Bench: readonly string[] = [], p1Bench: readonly string[] = []): GameState {
  let state = p1Turn();
  for (const s of ["p1", "p2"] as const) state = unprize(clearBench(state, s), s);
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  state = attachFromDeck(state, "p1", E, 1);
  for (const id of p1Bench) state = benchFromDeck(state, "p1", id);
  state = clearBench(setActiveFromDeck(state, "p2", defender), "p2");
  for (const id of p2Bench) state = benchFromDeck(state, "p2", id);
  return state;
}

/** TEST SURGERY — `damage` HP of counters on `seat`'s Active, or on its Bench body `index`. */
function hurt(state: GameState, seat: Seat, damage: number, index?: number): GameState {
  const side = state.players[seat];
  if (index === undefined) {
    if (side.active === null) throw new Error(`no ${seat} Active`);
    return { ...state, players: { ...state.players, [seat]: { ...side, active: { ...side.active, damage } } } };
  }
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, bench: side.bench.map((b, i) => (i === index ? { ...b, damage } : b)) } },
  };
}

/** TEST SURGERY — a copy of `cardId` below the top of `seat`'s deck moved to the TOP of it. */
function onTop(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u, i) => i > 0 && state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${seat} has no ${cardId}`);
  return { ...state, players: { ...state.players, [seat]: { ...side, deck: [uid, ...side.deck.filter((u) => u !== uid)] } } };
}

/** TEST SURGERY — `cardId` moved from `seat`'s deck to its discard pile. */
function toDiscard(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${seat} has no ${cardId}`);
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, deck: side.deck.filter((u) => u !== uid), discard: [...side.discard, uid] } },
  };
}

/** TEST SURGERY — P1's Active evolved in place into `cardId` (pulled from the deck), not this turn. */
function evolvedActive(state: GameState, cardId: string): GameState {
  const side = state.players.p1;
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined || side.active === null) throw new Error(`p1 has no ${cardId}`);
  const active = { ...side.active, stack: [...side.active.stack, uid] };
  return { ...state, players: { ...state.players, p1: { ...side, active, deck: side.deck.filter((u) => u !== uid) } } };
}

const attack = (index: number): GameAction => ({ type: "attack", seat: "p1", index });
const use = (abilityName: string): GameAction =>
  ({ type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName }) as GameAction;
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const idOf = (state: GameState, uid: string | undefined) => (uid === undefined ? undefined : state.cardIdByUid[uid]);
const topId = (state: GameState, seat: Seat) => idOf(state, state.players[seat].active?.stack.at(-1));

describe("D644 §1 — the prints and the registry rows", () => {
  it("five keys on five NEW objects; ~~Backtrack Badge stays unkeyed (dropped and named)~~ (🆕🆕🆕 D646 (D539): keyed at D646)", () => {
    expect(programFor(CINDERACE)).toEqual({ setupActiveFromHand: "Explosiveness" });
    expect(programFor(PATRAT)).toEqual({ passive: { countersCantMove: true } });
    expect(programFor(ILLUMISE)).toEqual({ passive: { weaknessTimesWithNamedInPlay: { name: "Volbeat", amount: 3 } } });
    expect(programFor(FERROTHORN)).toEqual({ opponentMillWhenMilled: { ability: "Startling Drop", count: 8 } });
    expect(programFor(TOME)).toEqual({
      trainer: [
        { op: "payFromHand", count: 1, to: "discard", filter: { kind: "byName", name: "Transformation Tome", cardNoun: true } },
        { op: "switchWithDiscardNamed", filter: { kind: "basicPokemon" } },
      ],
    });
    expect(Object.keys(programFor(BADGE) ?? {})).toEqual(["passive"]); // 🆕🆕🆕 D646 (D539): was `toBeUndefined()` — keyed at D646.
  });

  it("is built at engine 0.536.0", () => {
    expect(engineVersion).toBe("0.536.0");
  });
});

describe("D644 §2 — Explosiveness: Cinderace may be put face down into the Active Spot at setup", () => {
  it("the Stage 2 Cinderace is placed as the Active, stays there through the reveal, and is redacted face down until then", () => {
    let state = inHand(inHand(placing(), "p1", CINDERACE), "p1", FILLER);
    const uid = handUid(state, "p1", CINDERACE);
    const placed = mustApply(state, { type: "setupPlaceActive", seat: "p1", uid });
    expect(placed.events).toEqual([{ type: "POKEMON_PLACED", seat: "p1", uid, spot: "active" }]);
    expect(placed.state.players.p1.active?.stack).toEqual([uid]);
    expect(placed.state.players.p1.hand).not.toContain(uid);
    expect(JSON.stringify(redactGame(placed.state, "p2").board.opponent)).not.toContain(CINDERACE);
    state = inHand(placed.state, "p2", FILLER);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: "p2", uid: handUid(state, "p2", FILLER) }));
    for (const s of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat: s }));
    expect(topId(state, "p1")).toBe(CINDERACE);
  });

  it("the Bench placement still takes Basics only; a Stage 2 without the Ability is refused as the Active", () => {
    let state = inHand(inHand(inHand(placing(), "p1", CINDERACE), "p1", FILLER), "p1", "fix-stage2");
    expectErr(state, { type: "setupPlaceActive", seat: "p1", uid: handUid(state, "p1", "fix-stage2") }, "NOT_A_BASIC_POKEMON");
    state = must(applyAction(state, { type: "setupPlaceActive", seat: "p1", uid: handUid(state, "p1", FILLER) }));
    expectErr(state, { type: "setupPlaceBench", seat: "p1", uid: handUid(state, "p1", CINDERACE) }, "NOT_A_BASIC_POKEMON");
  });

  it("a Cinderace still in the deck is not in the hand", () => {
    const state = inHand(placing(), "p1", FILLER);
    const inDeck = state.players.p1.deck.find((u) => state.cardIdByUid[u] === CINDERACE);
    if (inDeck === undefined) throw new Error("no Cinderace in the deck");
    expectErr(state, { type: "setupPlaceActive", seat: "p1", uid: inDeck }, "CARD_NOT_IN_HAND");
  });

  it("R-EXP1: the mulligan is unchanged — with no Basic in the hand the placement is refused and the mulligan is taken", () => {
    let state = noBasicInHand(inHand(placing(), "p1", CINDERACE), "p1");
    const cinderace = handUid(state, "p1", CINDERACE);
    expectErr(state, { type: "setupPlaceActive", seat: "p1", uid: cinderace }, "NOT_A_BASIC_POKEMON");
    state = inHand(state, "p2", FILLER);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: "p2", uid: handUid(state, "p2", FILLER) }));
    const ready = mustApply(state, { type: "setupReady", seat: "p2" });
    expect(of(ready.events, "MULLIGAN_REVEALED")[0]?.hand).toContain(cinderace);
  });

  it("with a Basic in the hand too, the player chooses: the Basic is still placeable", () => {
    const state = inHand(inHand(placing(), "p1", CINDERACE), "p1", FILLER);
    const placed = mustApply(state, { type: "setupPlaceActive", seat: "p1", uid: handUid(state, "p1", FILLER) });
    expect(topId(placed.state, "p1")).toBe(FILLER);
  });
});

describe("D644 §3 — Watchful Eye: damage counters can't be moved to other Pokémon", () => {
  it("the five counter-move ops are the lock's set; no other op is", () => {
    for (const op of [
      { op: "moveCountersToDefender" },
      { op: "moveCountersChosen" },
      { op: "moveCounterOwnChosen" },
      { op: "moveCountersToOpponentChosen", upTo: 3 },
      { op: "moveCountersOpponentAnyWay", from: "any" },
    ] as const) {
      expect(isCounterMoveOp(op as never), op.op).toBe(true);
    }
    expect(isCounterMoveOp({ op: "switchWithDiscardNamed", filter: { kind: "basicPokemon" } })).toBe(false);
  });

  it("Transfer (`moveCountersToDefender`): moves without Patrat; with a Patrat on EITHER Bench nothing moves", () => {
    const board = (p1Bench: readonly string[], p2Bench: readonly string[]) =>
      hurt(table(MOVER, FILLER, p2Bench, [PEBBLE, ...p1Bench]), "p1", 30, 0);
    const free = mustApply(board([], []), attack(TRANSFER)).state;
    expect([free.players.p1.bench[0]?.damage, free.players.p2.active?.damage]).toEqual([0, 30]);
    for (const [mine, theirs] of [[[PATRAT], []], [[], [PATRAT]]] as const) {
      const locked = mustApply(board(mine, theirs), attack(TRANSFER)).state;
      expect([locked.players.p1.bench[0]?.damage, locked.players.p2.active?.damage]).toEqual([30, 0]);
    }
  });

  it("Extend (`moveCountersChosen`) and Collect (`moveCountersOpponentAnyWay`) whiff under an Active Patrat", () => {
    const extend = hurt(table(MOVER, PATRAT, [], [PEBBLE]), "p1", 30, 0);
    const extended = mustApply(extend, attack(EXTEND)).state;
    expect([extended.players.p1.bench[0]?.damage, extended.players.p2.active?.damage]).toEqual([30, 0]);
    expect(extended.phase.kind).not.toBe("effect:choose");
    const control = mustApply(hurt(table(MOVER, FILLER, [], [PEBBLE]), "p1", 30, 0), attack(EXTEND)).state;
    expect([control.players.p1.bench[0]?.damage, control.players.p2.active?.damage]).toEqual([0, 30]);
    const collect = hurt(table(MOVER, PATRAT, [PEBBLE]), "p2", 30, 0);
    const collected = mustApply(collect, attack(COLLECT)).state;
    expect(collected.phase.kind).not.toBe("effect:choose");
    expect(collected.players.p2.bench[0]?.damage).toBe(30);
    const open = mustApply(hurt(table(MOVER, FILLER, [PEBBLE]), "p2", 30, 0), attack(COLLECT)).state;
    expect(open.phase.kind).toBe("effect:choose");
  });

  it("Adrena-Brain (`moveCountersToOpponentChosen`) and Rocket Brain (`moveCounterOwnChosen`) are refused, not spent", () => {
    const brain = (bench: readonly string[]) => hurt(attachFromDeck(table(MUNKIDORI, FILLER, bench), "p1", DARK, 1), "p1", 30);
    expect(mustApply(brain([]), use("Adrena-Brain")).state.phase.kind).toBe("effect:choose");
    expectErr(brain([PATRAT]), use("Adrena-Brain"), "NO_LEGAL_TARGET");
    const rocket = (bench: readonly string[]) => hurt(table(ORBEETLE, FILLER, bench, [PEBBLE]), "p1", 30);
    expect(mustApply(rocket([]), use("Rocket Brain")).state.players.p1.bench[0]?.damage).toBe(10);
    expectErr(rocket([PATRAT]), use("Rocket Brain"), "NO_LEGAL_TARGET");
  });

  it("§9: Flutter Mane silences the opposing Active Patrat, and the counters move again", () => {
    const board = hurt(table(FLUTTER, PATRAT, [], [PEBBLE]), "p1", 30, 0);
    expect(countersMoveLocked(board)).toBe(false);
    expect(countersMoveLocked(table(FLUTTER, FILLER, [PATRAT]))).toBe(true);
    const { state } = mustApply(board, attack(TRANSFER));
    expect([state.players.p1.bench[0]?.damage, state.players.p2.active?.damage]).toEqual([0, 30]);
  });
});

describe("D644 §4 — Supereffective Pheromones: with Volbeat in play, Weakness for both Active Pokémon is ×3", () => {
  it("the main hit: 30 ×2 = 60 without Illumise; ×3 = 90 with Illumise and Volbeat on the attacker's side", () => {
    expect(mustApply(table(MOVER, TARGET), attack(HIT)).state.players.p2.active?.damage).toBe(60);
    expect(mustApply(table(MOVER, TARGET, [], [ILLUMISE, VOLBEAT]), attack(HIT)).state.players.p2.active?.damage).toBe(90);
  });

  it("both Active Pokémon: an Illumise and Volbeat on the DEFENDER's side apply it too", () => {
    expect(mustApply(table(MOVER, TARGET, [ILLUMISE, VOLBEAT]), attack(HIT)).state.players.p2.active?.damage).toBe(90);
  });

  it("no Volbeat, or a Volbeat on the other side (R-SPH2): ×2", () => {
    expect(mustApply(table(MOVER, TARGET, [], [ILLUMISE]), attack(HIT)).state.players.p2.active?.damage).toBe(60);
    expect(mustApply(table(MOVER, TARGET, [VOLBEAT], [ILLUMISE]), attack(HIT)).state.players.p2.active?.damage).toBe(60);
  });

  it("a defender with no Weakness to the attacker stays at its printed damage", () => {
    expect(mustApply(table(MOVER, FILLER, [], [ILLUMISE, VOLBEAT]), attack(HIT)).state.players.p2.active?.damage).toBe(30);
  });

  it("the snipe site (`snipeActive`) applies it as at the main hit", () => {
    expect(mustApply(table(MOVER, TARGET), attack(SNIPE_AT)).state.players.p2.active?.damage).toBe(60);
    expect(mustApply(table(MOVER, TARGET, [], [ILLUMISE, VOLBEAT]), attack(SNIPE_AT)).state.players.p2.active?.damage).toBe(90);
  });

  it("§9: an Active Illumise silenced by Flutter Mane gives ×2; an unsilenced one ×3", () => {
    // 30 ×3 = 90 Knocks Out the 80-HP Illumise; 30 ×2 = 60 does not.
    const live = mustApply(table(BLAZE, ILLUMISE, [VOLBEAT]), attack(HIT));
    expect(of(live.events, "KNOCKED_OUT").map((e) => idOf(live.state, e.uid))).toEqual([ILLUMISE]);
    expect(mustApply(table(FLUTTER, ILLUMISE, [VOLBEAT]), attack(HIT)).state.players.p2.active?.damage).toBe(60);
    expect(weaknessAmountOverride(table(FLUTTER, ILLUMISE, [VOLBEAT]))).toBeNull();
  });

  it("R-SPH1: only a multiplicative Weakness is rewritten", () => {
    expect(withWeaknessAmount({ op: "multiply", amount: 2 }, 3)).toEqual({ op: "multiply", amount: 3 });
    expect(withWeaknessAmount({ op: "add", amount: 20 }, 3)).toEqual({ op: "add", amount: 20 });
    expect(withWeaknessAmount(null, 3)).toBeNull();
    expect(withWeaknessAmount({ op: "multiply", amount: 2 }, null)).toEqual({ op: "multiply", amount: 2 });
  });
});

describe("D644 §5 — Startling Drop: milled off its owner's deck by the opponent, the opponent discards their top 8", () => {
  const ctxOf = (seat: Seat, invokedBy?: EffectContext["invokedBy"]): EffectContext =>
    invokedBy === undefined ? { seat } : { seat, invokedBy };

  it("an attack mills P2's Ferrothorn: Startling Drop triggers and P1's top 8 go to P1's discard pile", () => {
    const board = onTop(table(MOVER, FILLER), "p2", FERROTHORN);
    const ferro = board.players.p2.deck[0];
    const top8 = board.players.p1.deck.slice(0, 8);
    const { state, events } = mustApply(board, attack(MILL));
    expect(of(events, "ABILITY_TRIGGERED")).toEqual([{ type: "ABILITY_TRIGGERED", seat: "p2", uid: ferro, ability: "Startling Drop" }]);
    expect(of(events, "DECK_TOP_DISCARDED").map((e) => [e.seat, e.actor, e.uids.length])).toEqual([
      ["p2", "p1", 2],
      ["p1", "p2", 8],
    ]);
    expect(state.players.p1.deck.length).toBe(board.players.p1.deck.length - 8);
    expect(state.players.p1.discard.slice(-8)).toEqual(top8);
  });

  it("not milled, or milled off its OWN deck by its owner: nothing", () => {
    const plain = mustApply(table(MOVER, FILLER), attack(MILL));
    expect(of(plain.events, "ABILITY_TRIGGERED")).toEqual([]);
    const own = onTop(table(MOVER, FILLER), "p1", FERROTHORN);
    const dug = mustApply(own, attack(DIG));
    expect(of(dug.events, "ABILITY_TRIGGERED")).toEqual([]);
    expect(dug.state.players.p1.deck.length).toBe(own.players.p1.deck.length - 2);
  });

  it("R-STD1: two Ferrothorn milled together answer twice (16)", () => {
    const board = onTop(onTop(table(MOVER, FILLER), "p2", FERROTHORN), "p2", FERROTHORN);
    const { state, events } = mustApply(board, attack(MILL));
    expect(of(events, "ABILITY_TRIGGERED")).toHaveLength(2);
    expect(state.players.p1.deck.length).toBe(board.players.p1.deck.length - 16);
  });

  it("an Item, a Supporter or an Ability mills it too; a Stadium / Tool program (no `invokedBy`) does not", () => {
    const board = onTop(table(MOVER, FILLER), "p2", FERROTHORN);
    const ferro = board.players.p2.deck[0] as string;
    for (const by of ["item", "supporter", "ability", "attack"] as const) {
      const events: GameEvent[] = [];
      const next = startlingDropRetort(board, "p2", [ferro], ctxOf("p1", by), events);
      expect(next.players.p1.deck.length, by).toBe(board.players.p1.deck.length - 8);
    }
    const events: GameEvent[] = [];
    expect(startlingDropRetort(board, "p2", [ferro], ctxOf("p1"), events)).toBe(board);
    expect(events).toEqual([]);
  });

  it("only during the controller's turn (\"during your opponent's turn\"): P2 milling P1's Ferrothorn on P1's turn answers nothing", () => {
    const board = onTop(table(MOVER, FILLER), "p1", FERROTHORN);
    const ferro = board.players.p1.deck[0] as string;
    const events: GameEvent[] = [];
    expect(startlingDropRetort(board, "p1", [ferro], ctxOf("p2", "ability"), events)).toBe(board);
    expect(startlingDropRetort(board, "p1", [ferro], ctxOf("p1", "attack"), events)).toBe(board);
    expect(events).toEqual([]);
  });

  it("a short deck gives what it has", () => {
    const board = onTop(table(MOVER, FILLER), "p2", FERROTHORN);
    const short = { ...board, players: { ...board.players, p1: { ...board.players.p1, deck: board.players.p1.deck.slice(0, 3) } } };
    const events: GameEvent[] = [];
    const next = startlingDropRetort(short, "p2", [board.players.p2.deck[0] as string], ctxOf("p1", "attack"), events);
    expect(next.players.p1.deck).toEqual([]);
    expect(of(events, "DECK_TOP_DISCARDED")[0]?.uids).toHaveLength(3);
  });
});

describe("D644 §6 — Transformation Tome: play 2 at once; switch a Basic in play with one in the discard pile", () => {
  const tomes = (state: GameState, n: number) => handFromDeck(state, "p1", TOME, n);
  const swapBoard = (bench: readonly string[] = []) => {
    let state = table(PEBBLE, FILLER, [], bench);
    state = attachFromDeck(state, "p1", E, 1);
    state = hurt(state, "p1", 30);
    return toDiscard(state, "p1", SPROUT);
  };
  const playTome = (state: GameState): GameAction => ({ type: "playTrainer", seat: "p1", uid: handUid(state, "p1", TOME) });

  it("two in hand: both go to the discard pile, the Active becomes the Sprout with its Energy and its 30 damage", () => {
    const board = tomes(swapBoard(), 2);
    const pebble = board.players.p1.active?.stack[0];
    const sprout = board.players.p1.discard.at(-1);
    const { state, events } = mustApply(board, playTome(board));
    expect(topId(state, "p1")).toBe(SPROUT);
    expect(state.players.p1.active?.damage).toBe(30);
    expect(state.players.p1.active?.energy).toHaveLength(2);
    expect(state.players.p1.hand.filter((u) => state.cardIdByUid[u] === TOME)).toEqual([]);
    expect(state.players.p1.discard.filter((u) => state.cardIdByUid[u] === TOME)).toHaveLength(2);
    expect(state.players.p1.discard).toContain(pebble);
    expect(state.players.p1.discard).not.toContain(sprout);
    expect(of(events, "POKEMON_SWAPPED_FROM_DISCARD")).toEqual([
      { type: "POKEMON_SWAPPED_FROM_DISCARD", seat: "p1", fromUid: pebble, toUid: sprout },
    ]);
  });

  it("R-TFT1: one alone is refused (`PLAY_CONDITION_NOT_MET`), and stays in the hand", () => {
    const board = tomes(swapBoard(), 1);
    expectErr(board, playTome(board), "PLAY_CONDITION_NOT_MET");
  });

  it("no Basic in the discard pile, or no Basic in play: refused (`NO_LEGAL_TARGET`)", () => {
    const empty = tomes(attachFromDeck(table(PEBBLE, FILLER), "p1", E, 1), 2);
    expectErr(empty, playTome(empty), "NO_LEGAL_TARGET");
    const evolved = tomes(evolvedActive(toDiscard(table(SPROUT, FILLER), "p1", SPROUT), SHRUB), 2);
    expectErr(evolved, playTome(evolved), "NO_LEGAL_TARGET");
  });

  it("R-TFT2: two Basics in play park the body pick; an evolved body is not offered", () => {
    const board = tomes(swapBoard([PEBBLE]), 2);
    const { state } = mustApply(board, playTome(board));
    if (state.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${state.phase.kind}`);
    expect(state.phase.prompt).toMatchObject({ kind: "choosePokemon" });
    const benched = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
    } as GameAction).state;
    expect(idOf(benched, benched.players.p1.bench[0]?.stack.at(-1))).toBe(SPROUT);
    expect(topId(benched, "p1")).toBe(PEBBLE);
  });
});
