import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { normalizeCardText } from "./cardText";
import { CATALOG_MANIFEST } from "./catalogManifest";
import { effectiveMaxHp } from "./continuous";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame, engineVersion, redactGame } from "./index";
import { benchArrivalCounters } from "./interpreter";
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
  setConditions,
  trainerCard,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D642 — Z1 + K2: THE `me` STADIUM REST AND THE WATCHED-ACTIVE DAMAGE TRIGGERS ──
//
// 5 printed texts / 6 printings on five NEW registry objects: Spiritomb `me01-087` / `-148` "Spiteful Swirl" and
// Wishiwashi `30th-022` "Counterattack Grouping" (the NEW `PassiveEffects.damageAttackerWatched`, read by
// continuous.ts `watchedRecoilOf` at the two recoil sites; R-SSW1, R-CAG1), Risky Ruins `me01-127` (the NEW
// `StadiumEffects.benchArrivalCounters`, interpreter.ts `benchArrivalCounters`; R-RR1, R-RR2), Dizzying Valley
// `me02-088` (the NEW `StadiumEffects.confusionSurvivesStageChange`, continuous.ts `stageChangeConditions`; R-DV1)
// and Ange Floette `me04-075` (the NEW `StadiumEffects.playOnlyOverStadium` and `hpDelta.name`; R-ANF1, R-ANF2).
// Every id and text off the LOCAL D1 (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-10, `legal_standard = 1`.
// Driven on a LOCAL `cardPool` (D275) in the suite's OWN 60-card deck (D270).

const SWIRL_TEXT =
  "If your Active {D} Pokémon is damaged by an attack from your opponent's Pokémon (even if your Active {D} Pokémon is Knocked Out), place 1 damage counter on the Attacking Pokémon.";
/** The LOCAL D1 bytes, two TABs included ("Pokémon\t\tis"). */
const GROUPING_TEXT =
  "If your Wishiwashi or Wishiwashi ex is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if your Pokémon\t\tis Knocked Out), place 3 damage counters on the Attacking Pokémon.";
const RUINS_TEXT =
  "Whenever any player puts a Basic non-{D} Pokémon onto their Bench during their turn, place 2 damage counters on that Pokémon.";
const VALLEY_TEXT =
  "Confused Pokémon (both yours and your opponent's) don't recover from that Special Condition when they evolve or devolve.";
const ANGE_TEXT =
  "You can put this card into play only if you discard a Prism Tower in play, and you can put this card into play during the same turn you play Prism Tower.\nEach Mega Floette ex in play (both yours and your opponent's) gets +150 HP.";
const TOWER_TEXT =
  "Once during each player's turn, that player may discard 2 cards from their hand in order to draw a card.";

const SPIRITOMB = ["me01-087", "me01-148"] as const;
const WISHIWASHI = "30th-022";
const RUINS = "me01-127";
const VALLEY = "me02-088";
const ANGE = "me04-075";
const TOWER = "me04-080";
const MEGA_FLOETTE = "me04-035";
const CLEFABLE = "me03-031"; // Mega Clefable ex "Luminous Wing" (D614)
const FLUTTER = "sv05-078"; // Flutter Mane "Midnight Fluttering": the opposing Active has no Abilities
const NEST_BALL = "sv01-181";
const ALOMOMOLA = "sv10.5b-024"; // "Gentle Fin": a Basic with 70 HP or less from the discard onto the Bench
const JAW = "me03-068"; // Antique Jaw Fossil
const TRANQUILL = "sv05-133"; // "Emergency Evolution": evolve from the deck at 30 HP or less remaining
const PHANTUMP = "me04-038"; // "Spiteful Evolution": evolve from the hand, then 2 counters
const KLINKLANG = "sv07-101"; // "Emergency Rotation": a Stage 2 put onto the Bench from the hand

const STRIKER = "d642-striker"; // {C}, 400 HP, the MOVES below
const FILLER = "d642-filler"; // {C}, 400 HP
const DARK = "d642-dark"; // {D}, 400 HP
const WISHI_EX = "d642-wishiwashi-ex"; // a "Wishiwashi ex" (no Ability), 300 HP
const PEBBLE = "d642-pebble"; // {C} Basic, 70 HP
const SHADE = "d642-shade"; // {D} Basic, 70 HP
const SPROUT = "d642-sprout"; // {G} Basic, 70 HP
const SHRUB = "d642-shrub"; // {G} Stage 1 from Sprout, 100 HP
const UNFEZANT = "d642-unfezant"; // Stage 2 from Tranquill
const TREVENANT = "d642-trevenant"; // Stage 1 from Phantump
const FLOETTE = "d642-floette"; // a plain "Floette", 70 HP
const E = "fix-energy";
const SPARE = "d642-spare";

const SHOOTING_MOONS =
  "You may discard up to 4 Energy cards from your hand, and this attack does 40 more damage for each card you discarded in this way.";
const LOOK_TOP =
  "Look at the top 5 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.";
const DEVOLVE_DECK =
  "Devolve each of your opponent's evolved Pokémon by shuffling the highest Stage Evolution card on it into your opponent's deck.";
const DEVOLVE_HAND =
  "If your opponent's Active Pokémon is an evolved Pokémon, devolve it by putting the highest Stage Evolution card on it into your opponent's hand.";

/** 0 Hit 30 (attack.ts's main hit); 1 Moons 30+ (re-homed into `damageDefender`); 2 Crush 300; 3 Look; 4/5 devolve. */
const MOVES: Card["attacks"] = [
  { cost: ["Colorless"], name: "Hit", damage: 30 },
  { cost: ["Colorless"], name: "Moons", damage: "30+", effect: SHOOTING_MOONS },
  { cost: ["Colorless"], name: "Crush", damage: 300 },
  { cost: ["Colorless"], name: "Look", damage: "", effect: LOOK_TOP },
  { cost: ["Colorless"], name: "Unwind", damage: "", effect: DEVOLVE_DECK },
  { cost: ["Colorless"], name: "Rewind", damage: "", effect: DEVOLVE_HAND },
];
const HIT = 0;
const MOONS = 1;
const CRUSH = 2;
const LOOK = 3;
const UNWIND = 4;
const REWIND = 5;
const TAP: Card["attacks"] = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];

const ability = (name: string, effect: string) => ({ abilities: [{ type: "Ability", name, effect }] }) as Partial<Card>;
const mon = (id: string, name: string, hp: number, types: string[], attacks: Card["attacks"], extra: Partial<Card> = {}) =>
  battler(id, { name, hp, types, retreat: 1, attacks, ...extra });
const stadiumCard = (id: string, name: string, effect: string): Card => ({ ...trainerCard(id, "Stadium", effect), name });
function fossilRow(id: string, name: string): Card {
  const face = CATALOG_MANIFEST.trainerFaces[id];
  if (face === undefined) throw new Error(`no catalog face for ${id}`);
  return {
    ...trainerCard(
      id,
      "Item",
      "Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat.\n\nAt any time during your turn, you may discard this card from play.",
    ),
    name,
    hp: face.hp,
    abilities: face.abilities,
  };
}

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(
    SPIRITOMB.map((id) => [
      id,
      mon(id, "Spiritomb", 80, ["Darkness"], [{ cost: ["Darkness"], name: "Mountain Breaker", damage: 10, effect: "Discard the top card of your opponent's deck." }], ability("Spiteful Swirl", SWIRL_TEXT)),
    ]),
  ),
  [WISHIWASHI]: mon(WISHIWASHI, "Wishiwashi", 30, ["Water"], [{ cost: ["Water"], name: "Surprise Attack", damage: 30, effect: "Flip a coin. If tails, this attack does nothing." }], ability("Counterattack Grouping", GROUPING_TEXT)),
  [RUINS]: stadiumCard(RUINS, "Risky Ruins", RUINS_TEXT),
  [VALLEY]: stadiumCard(VALLEY, "Dizzying Valley", VALLEY_TEXT),
  [ANGE]: stadiumCard(ANGE, "Ange Floette", ANGE_TEXT),
  [TOWER]: stadiumCard(TOWER, "Prism Tower", TOWER_TEXT),
  [MEGA_FLOETTE]: mon(MEGA_FLOETTE, "Mega Floette ex", 250, ["Psychic"], TAP),
  [CLEFABLE]: mon(CLEFABLE, "Mega Clefable ex", 330, ["Psychic"], MOVES, ability("Luminous Wing", "Prevent all effects of your opponent's Pokémon's Abilities done to this Pokémon.")),
  [FLUTTER]: mon(FLUTTER, "Flutter Mane", 90, ["Psychic"], MOVES, ability("Midnight Fluttering", "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities, except for Midnight Fluttering.")),
  [ALOMOMOLA]: mon(ALOMOMOLA, "Alomomola", 130, ["Water"], TAP, ability("Gentle Fin", "Once during your turn, if this Pokémon is in the Active Spot, you may put a Basic Pokémon with 70 HP or less from your discard pile onto your Bench.")),
  [JAW]: fossilRow(JAW, "Antique Jaw Fossil"),
  [TRANQUILL]: mon(TRANQUILL, "Tranquill", 80, ["Colorless"], TAP, {
    stage: "Stage1",
    evolveFrom: "Pidove",
    ...ability("Emergency Evolution", "Once during your turn, if this Pokémon has 30 HP or less remaining, you may search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck."),
  }),
  [UNFEZANT]: mon(UNFEZANT, "Unfezant", 150, ["Colorless"], TAP, { stage: "Stage2", evolveFrom: "Tranquill" }),
  [PHANTUMP]: mon(PHANTUMP, "Phantump", 70, ["Psychic"], TAP, ability("Spiteful Evolution", "Once during your turn, you may use this Ability. Choose a card in your hand that evolves from this Pokémon and put it onto this Pokémon to evolve it. If you do, place 2 damage counters on the Pokémon you evolved in this way. You can't use this Ability during your first turn.")),
  [KLINKLANG]: mon(KLINKLANG, "Klinklang", 160, ["Metal"], TAP, {
    stage: "Stage2",
    evolveFrom: "Klang",
    ...ability("Emergency Rotation", "Once during your turn, if this Pokémon is in your hand and your opponent has any Stage 2 Pokémon in play, you may put this Pokémon onto your Bench."),
  }),
  [TREVENANT]: mon(TREVENANT, "Trevenant", 130, ["Psychic"], TAP, { stage: "Stage1", evolveFrom: "Phantump" }),
  [STRIKER]: mon(STRIKER, "D642 Striker", 400, ["Colorless"], MOVES),
  [FILLER]: mon(FILLER, "D642 Filler", 400, ["Colorless"], TAP),
  [DARK]: mon(DARK, "D642 Dark", 400, ["Darkness"], TAP),
  [WISHI_EX]: mon(WISHI_EX, "Wishiwashi ex", 300, ["Water"], TAP),
  [PEBBLE]: mon(PEBBLE, "D642 Pebble", 70, ["Colorless"], TAP),
  [SHADE]: mon(SHADE, "D642 Shade", 70, ["Darkness"], TAP),
  [SPROUT]: mon(SPROUT, "D642 Sprout", 70, ["Grass"], TAP),
  [SHRUB]: mon(SHRUB, "D642 Shrub", 100, ["Grass"], TAP, { stage: "Stage1", evolveFrom: "D642 Sprout" }),
  [FLOETTE]: mon(FLOETTE, "Floette", 70, ["Psychic"], TAP),
  [SPARE]: typedEnergy(SPARE, "Metal"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [SPIRITOMB[0]]: 1,
  [SPIRITOMB[1]]: 1,
  [WISHIWASHI]: 2,
  [RUINS]: 1,
  [VALLEY]: 1,
  [ANGE]: 1,
  [TOWER]: 1,
  [MEGA_FLOETTE]: 1,
  [CLEFABLE]: 1,
  [FLUTTER]: 1,
  [NEST_BALL]: 1,
  [ALOMOMOLA]: 1,
  [JAW]: 1,
  [TRANQUILL]: 1,
  [UNFEZANT]: 1,
  [PHANTUMP]: 1,
  [TREVENANT]: 1,
  [KLINKLANG]: 1,
  [STRIKER]: 1,
  [FILLER]: 10,
  [DARK]: 2,
  [WISHI_EX]: 1,
  [PEBBLE]: 2,
  [SHADE]: 1,
  [SPROUT]: 2,
  [SHRUB]: 2,
  [FLOETTE]: 1,
  [E]: 6,
  [SPARE]: 13,
});
const BOARD_IDS = Object.keys(LOCAL).filter((id) => id !== SPARE).concat([E, NEST_BALL]);

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup, then P1's own SECOND turn (P2 went first; every turn passed); both hands back into the decks. */
function p1Turn(): GameState {
  const created = createGame({ seed: 6420, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    state = { ...state, players: { ...state.players, [s]: { ...side, hand: [], deck: [...side.deck, ...side.hand] } } };
  }
  return state;
}

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
function table(
  attacker: string,
  defender: string,
  p2Bench: readonly string[] = [],
  p1Bench: readonly string[] = [],
): GameState {
  let state = p1Turn();
  for (const s of ["p1", "p2"] as const) state = unprize(clearBench(setActiveFromDeck(state, s, FILLER), s), s);
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  state = attachFromDeck(state, "p1", E, 1);
  for (const id of p1Bench) state = benchFromDeck(state, "p1", id);
  state = clearBench(setActiveFromDeck(state, "p2", defender), "p2");
  for (const id of p2Bench) state = benchFromDeck(state, "p2", id);
  return state;
}

/** TEST SURGERY — `id` out of `owner`'s deck into the shared Stadium zone. */
function stadium(state: GameState, id: string, owner: Seat = "p2"): GameState {
  const side = state.players[owner];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`${owner} has no ${id}`);
  return {
    ...state,
    stadium: { uid, owner },
    players: { ...state.players, [owner]: { ...side, deck: side.deck.filter((u) => u !== uid) } },
  };
}

/** TEST SURGERY — `seat`'s Active evolved in place into `cardId` (pulled from the deck), not this turn. */
function evolvedActive(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined || side.active === null) throw new Error(`${seat} has no ${cardId}`);
  const active = { ...side.active, stack: [...side.active.stack, uid] };
  return { ...state, players: { ...state.players, [seat]: { ...side, active, deck: side.deck.filter((u) => u !== uid) } } };
}

/** TEST SURGERY — `cardId` moved from `seat`'s deck to the TOP of it. */
function onTop(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
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

const withDamage = (state: GameState, seat: Seat, damage: number): GameState => {
  const side = state.players[seat];
  if (side.active === null) throw new Error(`no ${seat} Active`);
  return { ...state, players: { ...state.players, [seat]: { ...side, active: { ...side.active, damage } } } };
};
const attack = (index: number): GameAction => ({ type: "attack", seat: "p1", index });
const play = (state: GameState, cardId: string, seat: Seat = "p1") => {
  const withCard = handFromDeck(state, seat, cardId, 1);
  return mustApply(withCard, { type: "playTrainer", seat, uid: handUid(withCard, seat, cardId) });
};
const resolveCards = (state: GameState, uids: readonly string[], seat: Seat = "p1") =>
  mustApply(state, { type: "resolveEffect", seat, choice: { kind: "cards", uids: [...uids] } } as GameAction);
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const idOf = (state: GameState, uid: string | undefined) => (uid === undefined ? undefined : state.cardIdByUid[uid]);
const topId = (state: GameState, seat: Seat) => idOf(state, state.players[seat].active?.stack.at(-1));
const recoil = (events: readonly GameEvent[]) =>
  of(events, "COUNTERS_PLACED").filter((e) => e.source === "counterattack").map((e) => [e.seat, e.amount]);

describe("D642 §1 — the prints and the registry rows", () => {
  it("six keys on five NEW objects; the two Spiritomb printings share one", () => {
    expect(programFor(SPIRITOMB[0])).toEqual({ passive: { damageAttackerWatched: { amount: 10, activeType: "Darkness" } } });
    expect(programFor(SPIRITOMB[1])).toBe(programFor(SPIRITOMB[0]));
    expect(programFor(WISHIWASHI)).toEqual({
      passive: { damageAttackerWatched: { amount: 30, activeNames: ["Wishiwashi", "Wishiwashi ex"] } },
    });
    expect(programFor(RUINS)).toEqual({ stadium: { benchArrivalCounters: { amount: 20, excludesType: "Darkness" } } });
    expect(programFor(VALLEY)).toEqual({ stadium: { confusionSurvivesStageChange: true } });
    expect(programFor(ANGE)).toEqual({
      stadium: { playOnlyOverStadium: "Prism Tower", hpDelta: { amount: 150, stage: "basic", name: "Mega Floette ex" } },
    });
  });

  it("Counterattack Grouping's two TAB bytes survive the D612 normaliser (the key is by id; no reader reads it)", () => {
    expect(GROUPING_TEXT.split("\t")).toHaveLength(3);
    expect(normalizeCardText(GROUPING_TEXT)).toBe(GROUPING_TEXT);
    expect(normalizeCardText(SWIRL_TEXT)).toBe(SWIRL_TEXT);
  });

  it("is built at engine 0.547.0", () => {
    expect(engineVersion).toBe("0.547.0");
  });
});

describe("D642 §2 — Spiteful Swirl: 1 counter on the Attacking Pokémon when your Active {D} Pokémon is damaged", () => {
  it("a benched Spiritomb watches a {D} Active: attack.ts's main hit pays 10, one `counterattack` row", () => {
    const { state, events } = mustApply(table(STRIKER, DARK, [SPIRITOMB[0]]), attack(HIT));
    expect(state.players.p2.active?.damage).toBe(30);
    expect(state.players.p1.active?.damage).toBe(10);
    expect(recoil(events)).toEqual([["p1", 10]]);
  });

  it("the re-homed hit (interpreter.ts `reactWithRecoilAndAbility`) pays the same 10", () => {
    const { state, events } = mustApply(table(STRIKER, DARK, [SPIRITOMB[0]]), attack(MOONS));
    expect(state.players.p2.active?.damage).toBe(30);
    expect(recoil(events)).toEqual([["p1", 10]]);
  });

  it("the Active Spiritomb watches itself; two Spiritombs pay 10 each (R-SSW1)", () => {
    expect(mustApply(table(STRIKER, SPIRITOMB[0]), attack(HIT)).state.players.p1.active?.damage).toBe(10);
    expect(mustApply(table(STRIKER, SPIRITOMB[0], [SPIRITOMB[1]]), attack(HIT)).state.players.p1.active?.damage).toBe(20);
    expect(mustApply(table(STRIKER, SPIRITOMB[0], [SPIRITOMB[1]]), attack(MOONS)).state.players.p1.active?.damage).toBe(20);
  });

  it("a non-{D} Active is not watched", () => {
    const { state, events } = mustApply(table(STRIKER, FILLER, [SPIRITOMB[0]]), attack(HIT));
    expect(state.players.p1.active?.damage).toBe(0);
    expect(recoil(events)).toEqual([]);
  });

  it("even if the Active {D} Pokémon is Knocked Out", () => {
    const { state, events } = mustApply(table(STRIKER, SPIRITOMB[0], [FILLER]), attack(CRUSH));
    expect(of(events, "KNOCKED_OUT").map((e) => idOf(state, e.uid))).toEqual([SPIRITOMB[0]]);
    expect(state.players.p1.active?.damage).toBe(10);
  });

  it("§9 per holder: Flutter Mane silences the Active Spiritomb only; the benched one still pays", () => {
    const { state } = mustApply(table(FLUTTER, SPIRITOMB[0], [SPIRITOMB[1]]), attack(HIT));
    expect(state.players.p1.active?.damage).toBe(10);
    expect(mustApply(table(FLUTTER, SPIRITOMB[0]), attack(HIT)).state.players.p1.active?.damage).toBe(0);
  });

  it("Luminous Wing refuses it on both sites (an Ability's share)", () => {
    for (const index of [HIT, MOONS]) {
      const { state, events } = mustApply(table(CLEFABLE, DARK, [SPIRITOMB[0]]), attack(index));
      expect(state.players.p1.active?.damage, String(index)).toBe(0);
      expect(of(events, "ABILITY_EFFECT_PREVENTED").map((e) => e.seat), String(index)).toEqual(["p1"]);
    }
  });
});

describe("D642 §3 — Counterattack Grouping: 3 counters when your Active Wishiwashi or Wishiwashi ex is damaged", () => {
  it("the Active Wishiwashi (Knocked Out by the 30) pays 30", () => {
    const { state, events } = mustApply(table(STRIKER, WISHIWASHI, [FILLER]), attack(HIT));
    expect(of(events, "KNOCKED_OUT").map((e) => idOf(state, e.uid))).toEqual([WISHIWASHI]);
    expect(state.players.p1.active?.damage).toBe(30);
  });

  it("a benched Wishiwashi watches an Active `Wishiwashi ex`, on both sites", () => {
    expect(mustApply(table(STRIKER, WISHI_EX, [WISHIWASHI]), attack(HIT)).state.players.p1.active?.damage).toBe(30);
    expect(mustApply(table(STRIKER, WISHI_EX, [WISHIWASHI]), attack(MOONS)).state.players.p1.active?.damage).toBe(30);
  });

  it("any other name is not watched, whatever its type", () => {
    expect(mustApply(table(STRIKER, FILLER, [WISHIWASHI]), attack(HIT)).state.players.p1.active?.damage).toBe(0);
    expect(mustApply(table(STRIKER, DARK, [WISHIWASHI]), attack(HIT)).state.players.p1.active?.damage).toBe(0);
  });
});

describe("D642 §4 — Risky Ruins: 2 counters on a Basic non-{D} Pokémon put onto its owner's Bench on their turn", () => {
  const ruined = (state: GameState) => stadium(state, RUINS, "p2");
  const benchPlay = (state: GameState, cardId: string) => {
    const withCard = handFromDeck(state, "p1", cardId, 1);
    return mustApply(withCard, { type: "playBasicToBench", seat: "p1", uid: handUid(withCard, "p1", cardId) });
  };

  it("the hand play: the Basic {C} lands with 20, one `trainer` row; a {D} Basic and no Stadium take none", () => {
    const { state, events } = benchPlay(ruined(table(FILLER, FILLER)), PEBBLE);
    expect(state.players.p1.bench.map((b) => b.damage)).toEqual([20]);
    expect(of(events, "COUNTERS_PLACED").map((e) => [e.seat, idOf(state, e.uid), e.amount, e.source])).toEqual([
      ["p1", PEBBLE, 20, "trainer"],
    ]);
    expect(benchPlay(ruined(table(FILLER, FILLER)), SHADE).state.players.p1.bench.map((b) => b.damage)).toEqual([0]);
    expect(benchPlay(table(FILLER, FILLER), PEBBLE).state.players.p1.bench.map((b) => b.damage)).toEqual([0]);
  });

  it("a Stage 2 put onto the Bench (Klinklang \"Emergency Rotation\") is no Basic and takes none", () => {
    const board = ruined(table(FILLER, UNFEZANT));
    const { state } = benchPlay(board, KLINKLANG);
    expect(state.players.p1.bench.map((b) => [idOf(state, b.stack[0]), b.damage])).toEqual([[KLINKLANG, 0]]);
  });

  it("a deck search onto the Bench (Nest Ball)", () => {
    const parked = play(ruined(table(FILLER, FILLER)), NEST_BALL).state;
    const pebble = parked.players.p1.deck.find((u) => parked.cardIdByUid[u] === PEBBLE) as string;
    const { state } = resolveCards(parked, [pebble]);
    expect(state.players.p1.bench.map((b) => [idOf(state, b.stack[0]), b.damage])).toEqual([[PEBBLE, 20]]);
  });

  it("a discard-pile retrieval onto the Bench (Gentle Fin)", () => {
    const board = toDiscard(ruined(table(ALOMOMOLA, FILLER)), "p1", PEBBLE);
    const parked = mustApply(board, { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: "Gentle Fin" }).state;
    const pebble = parked.players.p1.discard.find((u) => parked.cardIdByUid[u] === PEBBLE) as string;
    const { state } = resolveCards(parked, [pebble]);
    expect(state.players.p1.bench.map((b) => [idOf(state, b.stack[0]), b.damage])).toEqual([[PEBBLE, 20]]);
  });

  it("a look at the top onto the Bench (an attack's `lookAtTopN`)", () => {
    const board = onTop(onTop(ruined(table(STRIKER, FILLER)), "p1", SHADE), "p1", PEBBLE);
    const parked = mustApply(board, attack(LOOK)).state;
    const picks = parked.players.p1.deck.slice(0, 2);
    const { state } = resolveCards(parked, picks);
    const landed = state.players.p1.bench.map((b) => [idOf(state, b.stack[0]), b.damage]);
    expect(landed).toEqual([
      [PEBBLE, 20],
      [SHADE, 0],
    ]);
  });

  it("an Antique Fossil's play: its in-play face is a Basic {C} Pokémon (R-RR2)", () => {
    const { state } = play(ruined(table(FILLER, FILLER)), JAW);
    expect(state.players.p1.bench.map((b) => [idOf(state, b.stack[0]), b.damage])).toEqual([[JAW, 20]]);
  });

  it("only during the owner's turn (R-RR1): the same landing for the OTHER seat pays nothing", () => {
    const board = benchFromDeck(benchFromDeck(ruined(table(FILLER, FILLER)), "p1", PEBBLE), "p2", PEBBLE);
    const mine = board.players.p1.bench[0]?.stack[0] as string;
    const theirs = board.players.p2.bench[0]?.stack[0] as string;
    const events: GameEvent[] = [];
    expect(benchArrivalCounters(board, "p2", [theirs], events)).toEqual(board);
    expect(events).toEqual([]);
    expect(benchArrivalCounters(board, "p1", [mine], events).players.p1.bench[0]?.damage).toBe(20);
  });
});

describe("D642 §5 — Dizzying Valley: Confused Pokémon stay Confused through an evolution or a devolution", () => {
  const valley = (state: GameState) => stadium(state, VALLEY, "p2");
  const dizzy = (state: GameState, seat: Seat = "p1") =>
    setConditions(state, seat, { rotation: "confused", confusionDamage: 80, poisonDamage: 10 });
  const evolveHand = (state: GameState) => {
    const withCard = handFromDeck(state, "p1", SHRUB, 1);
    return mustApply(withCard, {
      type: "evolve",
      seat: "p1",
      uid: handUid(withCard, "p1", SHRUB),
      target: { spot: "active" },
    } as GameAction);
  };

  it("the hand evolve keeps Confused (with its 80) and clears the Poison; without the Valley both clear", () => {
    const { state, events } = evolveHand(valley(dizzy(table(SPROUT, FILLER))));
    expect(topId(state, "p1")).toBe(SHRUB);
    expect(state.players.p1.active?.conditions).toEqual({ rotation: "confused", poisonDamage: 0, burned: false, confusionDamage: 80 });
    expect(of(events, "STATUS_CLEARED").map((e) => e.statuses)).toEqual([["poisoned"]]);
    const bare = evolveHand(dizzy(table(SPROUT, FILLER)));
    expect(bare.state.players.p1.active?.conditions.rotation).toBe("none");
    expect(of(bare.events, "STATUS_CLEARED").map((e) => [...e.statuses].sort())).toEqual([["confused", "poisoned"]]);
  });

  it("an Asleep body is not Confused: it still wakes on the evolve", () => {
    const asleep = setConditions(valley(table(SPROUT, FILLER)), "p1", { rotation: "asleep" });
    expect(evolveHand(asleep).state.players.p1.active?.conditions.rotation).toBe("none");
  });

  it("the deck evolve (Emergency Evolution)", () => {
    const board = withDamage(valley(dizzy(table(TRANQUILL, FILLER))), "p1", 50);
    let { state } = mustApply(board, { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: "Emergency Evolution" });
    if (state.phase.kind === "effect:choose") {
      const unfezant = state.players.p1.deck.find((u) => state.cardIdByUid[u] === UNFEZANT) as string;
      state = resolveCards(state, [unfezant]).state;
    }
    expect(topId(state, "p1")).toBe(UNFEZANT);
    expect(state.players.p1.active?.conditions.rotation).toBe("confused");
  });

  it("the hand evolve by an Ability (Spiteful Evolution)", () => {
    const board = handFromDeck(valley(dizzy(table(PHANTUMP, FILLER))), "p1", TREVENANT, 1);
    let { state } = mustApply(board, { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: "Spiteful Evolution" });
    if (state.phase.kind === "effect:choose") state = resolveCards(state, [handUid(state, "p1", TREVENANT)]).state;
    expect(topId(state, "p1")).toBe(TREVENANT);
    expect(state.players.p1.active?.conditions.rotation).toBe("confused");
  });

  it("the devolve into the deck and the devolve into the hand", () => {
    for (const index of [UNWIND, REWIND]) {
      const board = dizzy(evolvedActive(valley(table(STRIKER, SPROUT)), "p2", SHRUB), "p2");
      const { state, events } = mustApply(board, attack(index));
      expect(topId(state, "p2"), String(index)).toBe(SPROUT);
      expect(state.players.p2.active?.conditions.rotation, String(index)).toBe("confused");
      expect(of(events, "STATUS_CLEARED").map((e) => e.statuses), String(index)).toEqual([["poisoned"]]);
      const bare = mustApply(dizzy(evolvedActive(table(STRIKER, SPROUT), "p2", SHRUB), "p2"), attack(index)).state;
      expect(bare.players.p2.active?.conditions.rotation, String(index)).toBe("none");
    }
  });
});

describe("D642 §6 — Ange Floette: only over a Prism Tower, the same turn too; Mega Floette ex +150 HP", () => {
  const wire = (state: GameState) => {
    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
    return phase.trainers.find((t) => state.cardIdByUid[t.uid] === ANGE)?.disabled;
  };
  const withAnge = (state: GameState) => handFromDeck(state, "p1", ANGE, 1);
  const playAnge = (state: GameState) => ({ type: "playTrainer", seat: "p1", uid: handUid(state, "p1", ANGE) }) as GameAction;

  it("no Stadium, or another Stadium, in play: refused (`PLAY_CONDITION_NOT_MET`) and the wire row greyed", () => {
    const bare = withAnge(table(FILLER, FILLER));
    expectErr(bare, playAnge(bare), "PLAY_CONDITION_NOT_MET");
    expect(wire(bare)).toBe(true);
    const other = withAnge(stadium(table(FILLER, FILLER), VALLEY, "p2"));
    expectErr(other, playAnge(other), "PLAY_CONDITION_NOT_MET");
    expect(wire(other)).toBe(true);
  });

  it("over the opponent's Prism Tower (R-ANF1): played, the Prism Tower to ITS owner's discard pile", () => {
    const board = withAnge(stadium(table(FILLER, FILLER), TOWER, "p2"));
    expect(wire(board)).toBe(false);
    const tower = board.stadium?.uid as string;
    const { state, events } = mustApply(board, playAnge(board));
    expect([idOf(state, state.stadium?.uid), state.stadium?.owner]).toEqual([ANGE, "p1"]);
    expect(state.players.p2.discard).toContain(tower);
    expect(of(events, "STADIUM_DISCARDED").map((e) => [e.seat, e.uid])).toEqual([["p2", tower]]);
  });

  it("the same turn the player played Prism Tower (R-ANF2); any other spent Stadium play still refuses", () => {
    const towered = withAnge(play(table(FILLER, FILLER), TOWER).state);
    expect(towered.allowances.stadiumPlayed).toBe(true);
    expect(wire(towered)).toBe(false);
    expect(idOf(mustApply(towered, playAnge(towered)).state, mustApply(towered, playAnge(towered)).state.stadium?.uid)).toBe(ANGE);
    const valleyed = withAnge(play(table(FILLER, FILLER), VALLEY).state);
    expectErr(valleyed, playAnge(valleyed), "STADIUM_ALREADY_PLAYED");
    expect(wire(valleyed)).toBe(true);
    const theirs = withAnge({ ...stadium(table(FILLER, FILLER), TOWER, "p2"), allowances: { ...table(FILLER, FILLER).allowances, stadiumPlayed: true } });
    expectErr(theirs, playAnge(theirs), "STADIUM_ALREADY_PLAYED");
    expect(wire(theirs)).toBe(true);
  });

  it("🛑 the stated limitation, pinned: the actor's OWN earlier Prism Tower plus a spent play is let through", () => {
    const base = stadium(table(FILLER, FILLER), TOWER, "p1");
    const spent = withAnge({ ...base, allowances: { ...base.allowances, stadiumPlayed: true } });
    expect(wire(spent)).toBe(false);
    expect(idOf(mustApply(spent, playAnge(spent)).state, mustApply(spent, playAnge(spent)).state.stadium?.uid)).toBe(ANGE);
  });

  it("each Mega Floette ex in play gets +150 HP (both sides); a plain Floette does not", () => {
    const board = stadium(table(MEGA_FLOETTE, MEGA_FLOETTE, [FLOETTE]), ANGE, "p2");
    for (const seat of ["p1", "p2"] as const) {
      expect(effectiveMaxHp(board, board.players[seat].active as never), seat).toBe(400);
    }
    expect(effectiveMaxHp(board, board.players.p2.bench[0] as never)).toBe(70);
    const towered = stadium(table(MEGA_FLOETTE, MEGA_FLOETTE), TOWER, "p2");
    expect(effectiveMaxHp(towered, towered.players.p1.active as never)).toBe(250);
  });

  it("replacing it Knocks Out a Mega Floette ex the +150 was holding up", () => {
    const board = withDamage(stadium(table(MEGA_FLOETTE, FILLER, [], [FILLER]), ANGE, "p2"), "p1", 300);
    const { events, state } = play(board, VALLEY);
    expect(of(events, "KNOCKED_OUT").map((e) => idOf(state, e.uid))).toEqual([MEGA_FLOETTE]);
  });
});
