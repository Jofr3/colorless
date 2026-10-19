// 🆕🆕🆕 D636 — L1 + Clawitzer of the Mega backlog: THE NEXT-TURN OPPONENT LOCKS AND FALL BACK TO RELOAD, 6 texts /
// 7 printings, and `MATCH_RECORD_VERSION` 44 → 45 (apps/api match.ts "44 → 45 AT D636",
// `lockKeysMigrationD636.test.ts`).
//
//   • Trevenant `me04-039` "Cursed Roots": the shipped `markHandAttach { barred }` (Glimmora's bar, no new key).
//   • Pachirisu `me01-051` "Electrified Incisors": `markHandAttach` with the NEW `counters` — 8 counters per Energy
//     card attached from the victim's hand to the marked body, on the action and an effect's hand attach (R-EIC1).
//   • Octillery `me04-017` "Jet of Ink": `flipLockAttack` with the NEW `coins: 2` on the NEW
//     `InPlayPokemon.attackTwoFlipLockTurn`; every coin is flipped, any tails stops the attack (R-JOI1).
//   • Seismitoad `30th-084` "Quaking Fist": the NEW `flipLockTrainerPlay` on the NEW `PlayerSide.trainerFlipLockTurn`;
//     cardplay.ts `trainerFlipFails` at every Trainer play from hand (R-QF1).
//   • Chi-Yu `me01-031` "Scorching Earth": a `conditionGate` on the NEW `opponentStadiumInPlay` over `discardStadium`
//     and `preventHandPlay` at the NEW stamped class `"Stadium"` (R-SCE1).
//   • Clawitzer `me01-038` / `-141` "Fall Back to Reload": `FALL_BACK_TO_RELOAD` on the NEW per-body gate
//     `benchedThisTurn` over the NEW `InPlayPokemon.benchedTurn` (R-FBR1).
//
// Texts byte for byte off the LOCAL D1 (2026-10-10, `legal_standard = 1`); driven on the real ids in a LOCAL `cardPool`
// (D275) in the suite's OWN 60-card deck (D270). Attack COSTS and Retreat Costs are dropped to `[]` / 0 on the local
// faces; names, stages, HP, types, Weakness and Resistance are printed. Coins are chosen by seeding `rngState`.

import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { GameAction, GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { applyAction, createGame, engineVersion, formatElapsed, logFromEvents } from "./index";
import { resumeProgram, runProgram } from "./interpreter";
import { programFor } from "./registry";
import { type CoinFace, flipCoin } from "./rng";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  trainerCard,
} from "./testFixtures";
import { type PokemonTarget, makeInPlay } from "./types";

// ── THE PRINTED TEXTS ──

const CURSED_ROOTS =
  "During your opponent's next turn, Energy can't be attached from your opponent's hand to the Defending Pokémon.";
const INCISORS =
  "During your opponent's next turn, whenever they attach an Energy card from their hand to the Defending Pokémon, place 8 damage counters on that Pokémon.";
const JET_OF_INK =
  "During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips 2 coins. If either of them is tails, that attack doesn't happen.";
const QUAKING_FIST =
  "During your opponent's next turn, whenever they try to use a Trainer card from their hand, they flip a coin. If tails, your opponent discards that Trainer card instead of using it.";
const SCORCHING_EARTH =
  "If your opponent has a Stadium in play, discard it. If you do, your opponent can't play any Stadium cards from their hand during their next turn.";
const FALL_BACK =
  "Once during your turn, when this Pokémon moves from the Active Spot to your Bench, you may use this Ability. Attach up to 2 Basic {W} Energy cards from your hand to this Pokémon.";

const TREVENANT = "me04-039";
const PACHIRISU = "me01-051";
const OCTILLERY = "me04-017";
const SEISMITOAD = "30th-084";
const CHIYU = "me01-031";
const CLAWITZER = "me01-038";
const CLAWITZER_2 = "me01-141";
// The Trainers the locks are driven on (LOCAL D1 names and texts; each a shipped registry program).
const SWITCH = "sv01-194";
const RESEARCH = "sv01-189";
const ARTAZON = "sv02-171";
const BEACH_COURT = "sv01-167";
const CHARM = "sv02-173";
const RARE_CANDY = "sv01-191";
const FOSSIL = "sv07-129";
const BOSS = "sv02-172";
const WATER = "fix-water-energy";

const weak = (type: string): Card["weaknesses"] => [{ type, value: "×2" }] as Card["weaknesses"];

const ME_FACES: Record<string, Card> = {
  [TREVENANT]: battler(TREVENANT, {
    name: "Trevenant",
    stage: "Stage1",
    evolveFrom: "Phantump",
    hp: 130,
    types: ["Psychic"],
    retreat: 0,
    weaknesses: weak("Darkness"),
    resistances: [{ type: "Fighting", value: "-30" }] as Card["resistances"],
    attacks: [
      { cost: [], name: "Cursed Roots", damage: 30, effect: CURSED_ROOTS },
      {
        cost: [],
        name: "Overwhelming Pain",
        damage: "60+",
        effect: "This attack does 10 more damage for each damage counter on all of your opponent's Pokémon.",
      },
    ],
  }),
  [PACHIRISU]: battler(PACHIRISU, {
    name: "Pachirisu",
    hp: 70,
    types: ["Lightning"],
    retreat: 0,
    weaknesses: weak("Fighting"),
    attacks: [{ cost: [], name: "Electrified Incisors", damage: 10, effect: INCISORS }],
  }),
  [OCTILLERY]: battler(OCTILLERY, {
    name: "Octillery",
    stage: "Stage1",
    evolveFrom: "Remoraid",
    hp: 110,
    types: ["Water"],
    retreat: 0,
    weaknesses: weak("Lightning"),
    attacks: [
      { cost: [], name: "Jet of Ink", damage: 30, effect: JET_OF_INK },
      { cost: [], name: "Tantrum", damage: 120, effect: "This Pokémon is now Confused." },
    ],
  }),
  [SEISMITOAD]: battler(SEISMITOAD, {
    name: "Seismitoad",
    stage: "Stage2",
    hp: 160,
    types: ["Fighting"],
    retreat: 0,
    weaknesses: weak("Grass"),
    attacks: [
      { cost: [], name: "Quaking Fist", damage: 60, effect: QUAKING_FIST },
      { cost: [], name: "Mega Punch", damage: 180 },
    ],
  }),
  [CHIYU]: battler(CHIYU, {
    name: "Chi-Yu",
    hp: 110,
    types: ["Fire"],
    retreat: 0,
    weaknesses: weak("Water"),
    attacks: [{ cost: [], name: "Scorching Earth", damage: 40, effect: SCORCHING_EARTH }],
  }),
  ...Object.fromEntries(
    [CLAWITZER, CLAWITZER_2].map((id) => [
      id,
      battler(id, {
        name: "Clawitzer",
        stage: "Stage1",
        evolveFrom: "Clauncher",
        hp: 130,
        types: ["Water"],
        retreat: 0,
        weaknesses: weak("Lightning"),
        abilities: [{ type: "Ability", name: "Fall Back to Reload", effect: FALL_BACK }] as Card["abilities"],
        attacks: [{ cost: [], name: "Aqua Launcher", damage: 210, effect: "Discard all Energy from this Pokémon." }],
      }),
    ]),
  ),
  [SWITCH]: { ...trainerCard(SWITCH, "Item", "Switch your Active Pokémon with 1 of your Benched Pokémon."), name: "Switch" },
  [RESEARCH]: {
    ...trainerCard(RESEARCH, "Supporter", "Discard your hand and draw 7 cards."),
    name: "Professor's Research",
  },
  [ARTAZON]: {
    ...trainerCard(
      ARTAZON,
      "Stadium",
      "Once during each player's turn, that player may search their deck for a Basic Pokémon that doesn't have a Rule Box and put it onto their Bench. Then, that player shuffles their deck. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)",
    ),
    name: "Artazon",
  },
  [BEACH_COURT]: {
    ...trainerCard(BEACH_COURT, "Stadium", "The Retreat Cost of each Basic Pokémon in play (both yours and your opponent's) is {C} less."),
    name: "Beach Court",
  },
  [CHARM]: {
    ...trainerCard(CHARM, "Tool", "The Basic Pokémon this card is attached to gets +50 HP."),
    name: "Bravery Charm",
  },
  [RARE_CANDY]: {
    ...trainerCard(
      RARE_CANDY,
      "Item",
      "Choose 1 of your Basic Pokémon in play. If you have a Stage 2 card in your hand that evolves from that Pokémon, put that card onto the Basic Pokémon to evolve it, skipping the Stage 1. You can't use this card during your first turn or on a Basic Pokémon that was put into play this turn.",
    ),
    name: "Rare Candy",
  },
  [FOSSIL]: { ...trainerCard(FOSSIL, "Item", "Play this card as if it were a 60-HP Basic {C} Pokémon."), name: "Antique Cover Fossil" },
  [BOSS]: {
    ...trainerCard(BOSS, "Supporter", "Switch in 1 of your opponent's Benched Pokémon to the Active Spot."),
    name: "Boss's Orders",
  },
};

// ── THE SUITE'S OWN BODIES ──

const WALL = "d636-wall"; // a 900-HP {C} Basic: 60 to the Active
const FRAGILE = "d636-fragile"; // a 60-HP {C} Basic Electrified Incisors Knocks Out
const FILLER = "d636-filler";
const SPROUT = "d636-sprout"; // Rare Candy's Basic …
const SHOOT = "d636-shoot"; // … its Stage 1 (the bridge, never played) …
const TREE = "d636-tree"; // … and the Stage 2 Rare Candy puts on it
const CLAUNCHER = "d636-clauncher"; // the suite's own Clauncher, for R-FBR1's evolution reading
const JAB = 60;

const mon = (id: string, name: string, extra: Partial<Card> = {}): Card =>
  battler(id, {
    name,
    hp: 900,
    types: ["Colorless"],
    retreat: 0,
    attacks: [{ cost: [], name: "Jab", damage: JAB }],
    ...extra,
  });

const LOCAL: Record<string, Card> = {
  ...ME_FACES,
  [WALL]: mon(WALL, "D636 Wall"),
  [FRAGILE]: mon(FRAGILE, "D636 Fragile", { hp: 60 }),
  [FILLER]: mon(FILLER, "D636 Filler"),
  [SPROUT]: mon(SPROUT, "D636 Sprout"),
  [SHOOT]: mon(SHOOT, "D636 Shoot", { stage: "Stage1", evolveFrom: "D636 Sprout" }),
  [TREE]: mon(TREE, "D636 Tree", { stage: "Stage2", evolveFrom: "D636 Shoot" }),
  [CLAUNCHER]: mon(CLAUNCHER, "Clauncher", { types: ["Water"] }),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [TREVENANT]: 1,
  [PACHIRISU]: 1,
  [OCTILLERY]: 1,
  [SEISMITOAD]: 1,
  [CHIYU]: 1,
  [CLAWITZER]: 1,
  [CLAWITZER_2]: 1,
  [SWITCH]: 2,
  [RESEARCH]: 2,
  [ARTAZON]: 1,
  [BEACH_COURT]: 1,
  [CHARM]: 1,
  [RARE_CANDY]: 1,
  [FOSSIL]: 1,
  [BOSS]: 1,
  [WALL]: 4,
  [FRAGILE]: 2,
  [SPROUT]: 1,
  [SHOOT]: 1,
  [TREE]: 1,
  [CLAUNCHER]: 1,
  [FILLER]: 15,
  [WATER]: 12,
  "fix-energy": 6, // the prize row
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}
function refusal(result: ReturnType<typeof applyAction>): string {
  return result.ok ? "OK" : result.error.code;
}

/** Hands and prize rows reset: every hand back into the deck, the six `fix-energy` the prize row. */
function reset(state: GameState): GameState {
  let next = state;
  for (const s of ["p1", "p2"] as const) {
    const side = next.players[s];
    const pile = [...side.deck, ...side.hand, ...side.prizes];
    const prizes = pile.filter((u) => next.cardIdByUid[u] === "fix-energy");
    next = {
      ...next,
      players: {
        ...next.players,
        [s]: { ...side, hand: [], prizes, deck: pile.filter((u) => !prizes.includes(u)) },
      },
    };
  }
  return next;
}

/** Setup, then P1's own FIRST turn (P2 went first and passed: turn 2). The seed is the first from 6360 whose two
    opening hands each hold a Basic Pokémon card (an Antique Fossil is a Basic for the mulligan rule, not for this). */
function p1First(): GameState {
  for (let seed = 6360; seed < 6460; seed++) {
    try {
      return p1FirstAt(seed);
    } catch {
      // the next seed
    }
  }
  throw new Error("no seed deals both seats a Basic Pokémon card");
}
function p1FirstAt(seed: number): GameState {
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
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  return reset(state);
}

/** P1: `active` + `bench`; P2: `foe` Active + `foeBench`. Hands empty. Turn 2, P1 to act. */
function board(
  active: string,
  bench: readonly string[] = [],
  foe: string = WALL,
  foeBench: readonly string[] = [FILLER],
): GameState {
  let state = clearBench(setActiveFromDeck(p1First(), "p1", active), "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  state = clearBench(setActiveFromDeck(state, "p2", foe), "p2");
  for (const id of foeBench) state = benchFromDeck(state, "p2", id);
  return state;
}

function all<T extends GameEvent["type"]>(events: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}
/** An attack ENDS the turn (§5.3): the returned state is the opponent's next turn unless a ko:* park holds it. */
const attack = (state: GameState, seat: Seat, index = 0) => mustApply(state, { type: "attack", seat, index });
const endTurn = (state: GameState, seat: Seat) => must(applyAction(state, { type: "endTurn", seat }));
function body(pokemon: InPlayPokemon | null | undefined): InPlayPokemon {
  if (pokemon === null || pokemon === undefined) throw new Error("no body");
  return pokemon;
}
const topOf = (pokemon: InPlayPokemon | null | undefined) => body(pokemon).stack.at(-1) as string;
/** `count` copies of `id` from `seat`'s deck into the hand, and the last one's uid. */
function inHand(state: GameState, seat: Seat, id: string, count = 1): { state: GameState; uid: string } {
  const next = handFromDeck(state, seat, id, count);
  const uid = next.players[seat].hand.filter((u) => next.cardIdByUid[u] === id).pop() as string;
  return { state: next, uid };
}
/** The first `rngState` (from 1) whose next flips are exactly `faces`, so a coin is chosen rather than hoped for. */
function seedFor(faces: readonly CoinFace[]): number {
  for (let seed = 1; seed < 100_000; seed++) {
    let s = seed;
    let hit = true;
    for (const face of faces) {
      const [got, next] = flipCoin(s);
      if (got !== face) {
        hit = false;
        break;
      }
      s = next;
    }
    if (hit) return seed;
  }
  throw new Error("no seed");
}
const rolled = (state: GameState, faces: readonly CoinFace[]): GameState => ({ ...state, rngState: seedFor(faces) });
const revived = (state: GameState): GameState => JSON.parse(JSON.stringify(state)) as GameState;
function rows(events: GameEvent[], state: GameState): string[] {
  const entries = logFromEvents(events, { names: { p1: "Ana", p2: "Bo" }, state, elapsed: formatElapsed(0) });
  return entries.flatMap((e) => (e.kind === "turn" ? [] : [e.segments.map((s) => s.text).join("")]));
}
const attachWater = (state: GameState, seat: Seat, target: PokemonTarget) => {
  const held = inHand(state, seat, WATER);
  return applyAction(held.state, { type: "attachEnergy", seat, uid: held.uid, target });
};

// ────────────────────────────────────────────────────────────────────────────
describe("D636 §1 — the readers and the registry row", () => {
  it("Cursed Roots is Glimmora's bar alone; Electrified Incisors carries the counters (the printed \"place\" read as \"put\")", () => {
    expect(deriveAttackEffect(CURSED_ROOTS)).toEqual([{ op: "markHandAttach", barred: true }]);
    expect(deriveAttackEffect(INCISORS)).toEqual([{ op: "markHandAttach", counters: 8 }]);
    expect(deriveAttackEffect(INCISORS.replace("place 8", "put 8"))).toEqual([{ op: "markHandAttach", counters: 8 }]);
    for (const near of [
      INCISORS.replace("8", "0"),
      INCISORS.replace("the Defending Pokémon", "this Pokémon"),
      CURSED_ROOTS.replace("the Defending Pokémon", "this Pokémon"),
      CURSED_ROOTS.replace(/\.$/, ""),
    ]) {
      expect(deriveAttackEffect(near), near).toBeNull();
    }
  });

  it("Jet of Ink reads `flipLockAttack` with `coins: 2`; D547's one-coin sentence keeps the bare op", () => {
    expect(deriveAttackEffect(JET_OF_INK)).toEqual([{ op: "flipLockAttack", coins: 2 }]);
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.",
      ),
    ).toEqual([{ op: "flipLockAttack" }]);
    expect(deriveAttackEffect(JET_OF_INK.replace("2 coins", "3 coins"))).toBeNull();
    expect(deriveAttackEffect(JET_OF_INK.replace("either", "both"))).toBeNull();
  });

  it("Quaking Fist reads the NEW `flipLockTrainerPlay`; Scorching Earth a gate on the opponent's Stadium over the discard and the bar", () => {
    expect(deriveAttackEffect(QUAKING_FIST)).toEqual([{ op: "flipLockTrainerPlay" }]);
    expect(deriveAttackEffect(QUAKING_FIST.replace("a Trainer card", "an Item card"))).toBeNull();
    expect(deriveAttackEffect(SCORCHING_EARTH)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentStadiumInPlay" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "discardStadium" }, { op: "preventHandPlay", bars: "Stadium" }],
      },
    ]);
    expect(deriveAttackEffect(SCORCHING_EARTH.replace("Stadium cards", "Item cards"))).toBeNull();
  });

  it("Clawitzer ×2: one object — from the Bench, gated on the moved-to-Bench stamp, two declinable `toSelf` hand attaches", () => {
    expect(programFor(CLAWITZER)).toBe(programFor(CLAWITZER_2));
    expect(programFor(CLAWITZER)).toEqual({
      abilities: [
        {
          name: "Fall Back to Reload",
          oncePerTurn: true,
          activeOnly: false,
          benchOnly: true,
          benchedThisTurn: true,
          program: [
            { op: "attachEnergyFrom", source: "hand", energyType: "Water", toSelf: true, declinable: true },
            { op: "attachEnergyFrom", source: "hand", energyType: "Water", toSelf: true, declinable: true },
          ],
        },
      ],
    });
    // Every L1 attack id is a reader row: no key.
    for (const id of [TREVENANT, PACHIRISU, OCTILLERY, SEISMITOAD, CHIYU]) expect(programFor(id), id).toBeUndefined();
  });
});

describe("D636 §2 — Cursed Roots: no Energy from the victim's hand to the Defending Pokémon, next turn", () => {
  it("the Defending Pokémon is marked barred for the victim's own turn; an attach to it is refused, to the Bench is not", () => {
    const { state } = attack(board(TREVENANT), "p1");
    expect(state.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
    expect(body(state.players.p2.active).handAttachMark).toEqual({
      turn: state.turn,
      barred: true,
      endsTurn: false,
      tripped: false,
      counters: 0,
    });
    expect(refusal(attachWater(state, "p2", { spot: "active" }))).toBe("ENERGY_ATTACH_BARRED");
    expect(refusal(attachWater(state, "p2", { spot: "bench", index: 0 }))).toBe("OK");
  });

  it("the window passes by arithmetic: on the victim's NEXT turn the attach lands", () => {
    const { state } = attack(board(TREVENANT), "p1");
    const later = endTurn(endTurn(state, "p2"), "p1");
    expect(later.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
    expect(refusal(attachWater(later, "p2", { spot: "active" }))).toBe("OK");
  });
});

describe("D636 §3 — Electrified Incisors: 8 damage counters per Energy card from the victim's hand (R-EIC1)", () => {
  it("installs `counters: 8` on the Defending Pokémon, and the attach action places 80 on it", () => {
    const { state } = attack(board(PACHIRISU), "p1");
    const defender = body(state.players.p2.active);
    expect(defender.handAttachMark).toEqual({ turn: state.turn, barred: false, endsTurn: false, tripped: false, counters: 8 });
    const result = attachWater(state, "p2", { spot: "active" });
    if (!result.ok) throw new Error(result.error.code);
    expect(body(result.state.players.p2.active).damage).toBe(defender.damage + 80);
    expect(all(result.events, "COUNTERS_PLACED")).toEqual([
      { type: "COUNTERS_PLACED", seat: "p2", uid: topOf(defender), amount: 80, source: "attack" },
    ]);
    expect(result.state.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
  });

  it("an attach to a Benched body places nothing", () => {
    const { state } = attack(board(PACHIRISU), "p1");
    const result = attachWater(state, "p2", { spot: "bench", index: 0 });
    if (!result.ok) throw new Error(result.error.code);
    expect(all(result.events, "COUNTERS_PLACED")).toEqual([]);
    expect(body(result.state.players.p2.bench[0]).damage).toBe(0);
  });

  it("the counters can Knock Out: a 60-HP Defending Pokémon at 10 goes to the Knock Out sweep (the opponent takes the Prize)", () => {
    const { state } = attack(board(PACHIRISU, [], FRAGILE), "p1");
    const result = attachWater(state, "p2", { spot: "active" });
    if (!result.ok) throw new Error(result.error.code);
    expect(all(result.events, "KNOCKED_OUT").map((e) => e.seat)).toEqual(["p2"]);
    expect(result.state.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p1" });
  });

  it("an EFFECT's hand attach is placed on too, once per card (the effect path)", () => {
    const { state } = attack(board(PACHIRISU), "p1");
    const held = handFromDeck(state, "p2", WATER, 2);
    const defender = body(held.players.p2.active);
    const events: GameEvent[] = [];
    const run = runProgram(
      held,
      [
        { op: "attachEnergyFrom", source: "hand", energyType: "Water", toSelf: true },
        { op: "attachEnergyFrom", source: "hand", energyType: "Water", toSelf: true },
      ],
      { seat: "p2", sourceUid: topOf(defender) },
      events,
    );
    expect(run.kind).toBe("done");
    expect(body(run.state.players.p2.active).energy).toHaveLength(defender.energy.length + 2);
    expect(body(run.state.players.p2.active).damage).toBe(defender.damage + 160);
    expect(all(events, "COUNTERS_PLACED").map((e) => e.amount)).toEqual([80, 80]);
  });

  it("an `attachFromHand` answer is placed on too: the card onto the marked Active, none for the Benched one", () => {
    const { state } = attack(board(PACHIRISU), "p1");
    const held = handFromDeck(state, "p2", WATER, 2);
    const [toActive, toBench] = held.players.p2.hand.filter((u) => held.cardIdByUid[u] === WATER) as [string, string];
    const defender = body(held.players.p2.active);
    const events: GameEvent[] = [];
    const parked = runProgram(held, [{ op: "attachFromHand", filter: { kind: "basicEnergy" } }], { seat: "p2" }, events);
    if (parked.kind !== "parked") throw new Error("expected the attachCards park");
    const run = resumeProgram(
      parked.state,
      parked.cont,
      {
        kind: "attachCards",
        assignments: [
          { uid: toActive, to: { seat: "p2", spot: { spot: "active" } } },
          { uid: toBench, to: { seat: "p2", spot: { spot: "bench", index: 0 } } },
        ],
      },
      events,
    );
    expect(run.kind).toBe("done");
    expect(body(run.state.players.p2.active).energy).toContain(toActive);
    expect(body(run.state.players.p2.bench[0]).energy).toContain(toBench);
    expect(body(run.state.players.p2.active).damage).toBe(defender.damage + 80);
    expect(body(run.state.players.p2.bench[0]).damage).toBe(0);
    expect(all(events, "COUNTERS_PLACED").map((e) => [e.uid, e.amount])).toEqual([[topOf(defender), 80]]);
  });

  it("two installs in one window SUM (two printed effects): 16 counters per card", () => {
    const start = board(PACHIRISU);
    const events: GameEvent[] = [];
    const op = { op: "markHandAttach", counters: 8 } as const;
    const once = runProgram(start, [op], { seat: "p1" }, events);
    const twice = runProgram(once.state, [op], { seat: "p1" }, events);
    expect(body(twice.state.players.p2.active).handAttachMark?.counters).toBe(16);
    expect(all(events, "HAND_ATTACH_MARKED").map((e) => e.counters)).toEqual([8, 16]);
  });

  it("the next turn of the victim's places nothing (the window passed)", () => {
    const { state } = attack(board(PACHIRISU), "p1");
    const later = endTurn(endTurn(state, "p2"), "p1");
    const result = attachWater(later, "p2", { spot: "active" });
    if (!result.ok) throw new Error(result.error.code);
    expect(all(result.events, "COUNTERS_PLACED")).toEqual([]);
  });
});

describe("D636 §4 — Jet of Ink: two coins at the declaration, any tails stops the attack (R-JOI1)", () => {
  const inked = () => attack(board(OCTILLERY), "p1").state;

  it("stamps the Defending Pokémon's `attackTwoFlipLockTurn` for the victim's turn; the one-coin stamp is untouched", () => {
    const state = inked();
    const defender = body(state.players.p2.active);
    expect(defender.attackTwoFlipLockTurn).toBe(state.turn);
    expect(defender.attackFlipLockTurn).toBeNull();
  });

  it("heads, heads: the attack resolves, two coin rows", () => {
    const { events, state } = mustApply(rolled(inked(), ["heads", "heads"]), { type: "attack", seat: "p2", index: 0 });
    expect(all(events, "ATTACK_FLIP_LOCK_CHECK").map((e) => e.result)).toEqual(["heads", "heads"]);
    expect(all(events, "ATTACK_FAILED")).toEqual([]);
    expect(body(state.players.p1.active).damage).toBe(JAB);
  });

  for (const faces of [
    ["heads", "tails"],
    ["tails", "heads"],
  ] as const) {
    it(`${faces.join(", ")}: the attack doesn't happen, and BOTH coins are flipped`, () => {
      const { events, state } = mustApply(rolled(inked(), faces), { type: "attack", seat: "p2", index: 0 });
      expect(all(events, "ATTACK_FLIP_LOCK_CHECK").map((e) => e.result)).toEqual([...faces]);
      expect(all(events, "ATTACK_FAILED").map((e) => e.reason)).toEqual(["flipLock"]);
      expect(body(state.players.p1.active).damage).toBe(0);
    });
  }

  it("with a live one-coin lock as well, three coins (1 + 2): heads ×3 resolves, a third-coin tails stops it", () => {
    const base = inked();
    const both: GameState = {
      ...base,
      players: {
        ...base.players,
        p2: { ...base.players.p2, active: { ...body(base.players.p2.active), attackFlipLockTurn: base.turn } },
      },
    };
    const pass = mustApply(rolled(both, ["heads", "heads", "heads"]), { type: "attack", seat: "p2", index: 0 });
    expect(all(pass.events, "ATTACK_FLIP_LOCK_CHECK")).toHaveLength(3);
    expect(body(pass.state.players.p1.active).damage).toBe(JAB);
    const fail = mustApply(rolled(both, ["heads", "heads", "tails"]), { type: "attack", seat: "p2", index: 0 });
    expect(all(fail.events, "ATTACK_FAILED").map((e) => e.reason)).toEqual(["flipLock"]);
  });

  it("§10: the victim's retreat sheds it — the promoted body attacks with no coin, the benched one carries nothing", () => {
    const retreated = must(applyAction(inked(), { type: "retreat", seat: "p2", discardEnergy: [], promoteBenchIndex: 0 }));
    expect(body(retreated.players.p2.bench[0]).attackTwoFlipLockTurn).toBeNull();
    const { events } = mustApply(retreated, { type: "attack", seat: "p2", index: 0 });
    expect(all(events, "ATTACK_FLIP_LOCK_CHECK")).toEqual([]);
  });

  it("§10: a Switch sheds it too — the switched-out body carries nothing (`switchInto`)", () => {
    const held = inHand(inked(), "p2", SWITCH);
    const lockedUid = topOf(held.state.players.p2.active);
    const switched = must(applyAction(held.state, { type: "playTrainer", seat: "p2", uid: held.uid }));
    const benched = body(switched.players.p2.bench.find((b) => b.stack.includes(lockedUid)));
    expect(benched.attackTwoFlipLockTurn).toBeNull();
  });

  it("§10: evolving sheds it — the evolved card attacks with no coin (`evolveOnto`)", () => {
    const sprouted = attack(board(OCTILLERY, [], SPROUT), "p1").state;
    expect(body(sprouted.players.p2.active).attackTwoFlipLockTurn).toBe(sprouted.turn);
    const shoot = inHand(sprouted, "p2", SHOOT);
    const evolved = must(
      applyAction(shoot.state, { type: "evolve", seat: "p2", uid: shoot.uid, target: { spot: "active" } }),
    );
    expect(body(evolved.players.p2.active).attackTwoFlipLockTurn).toBeNull();
    const { events } = mustApply(evolved, { type: "attack", seat: "p2", index: 0 });
    expect(all(events, "ATTACK_FLIP_LOCK_CHECK")).toEqual([]);
  });

  it("§10: devolving sheds it (`devolvedBodyOf`)", () => {
    const p2turn = endTurn(board(OCTILLERY, [], SPROUT), "p1");
    const shoot = inHand(p2turn, "p2", SHOOT);
    const evolved = must(
      applyAction(shoot.state, { type: "evolve", seat: "p2", uid: shoot.uid, target: { spot: "active" } }),
    );
    const inkedShoot = attack(endTurn(evolved, "p2"), "p1").state;
    expect(body(inkedShoot.players.p2.active).attackTwoFlipLockTurn).toBe(inkedShoot.turn);
    const run = runProgram(inkedShoot, [{ op: "devolveEach" }], { seat: "p1", invokedBy: "attack" }, []);
    if (run.kind !== "done") throw new Error("expected done");
    const devolved = body(run.state.players.p2.active);
    expect(run.state.cardIdByUid[topOf(devolved)]).toBe(SPROUT);
    expect(devolved.attackTwoFlipLockTurn).toBeNull();
  });

  it("the stamp survives the JSON round trip (it is persisted)", () => {
    const state = inked();
    expect(body(revived(state).players.p2.active).attackTwoFlipLockTurn).toBe(state.turn);
  });
});

describe("D636 §5 — Quaking Fist: a coin at each Trainer play from hand next turn; tails discards it instead (R-QF1)", () => {
  const fisted = (foe: string = WALL) => attack(board(SEISMITOAD, [], foe), "p1").state;
  const play = (state: GameState, uid: string) => applyAction(state, { type: "playTrainer", seat: "p2", uid });

  it("stamps the OPPONENT's side for its next turn and says so", () => {
    const { state, events } = attack(board(SEISMITOAD), "p1");
    expect(state.players.p2.trainerFlipLockTurn).toBe(state.turn);
    expect(state.players.p1.trainerFlipLockTurn).toBeNull();
    expect(all(events, "TRAINER_FLIP_LOCKED")).toEqual([{ type: "TRAINER_FLIP_LOCKED", seat: "p2" }]);
  });

  it("an Item, tails: the card goes to the discard pile and nothing happens; heads: it is played", () => {
    const { state, uid } = inHand(fisted(), "p2", SWITCH);
    const tails = play(rolled(state, ["tails"]), uid);
    if (!tails.ok) throw new Error(tails.error.code);
    expect(tails.events).toEqual([{ type: "TRAINER_FLIP_LOCK_CHECK", seat: "p2", uid, result: "tails" }]);
    expect(tails.state.players.p2.discard).toContain(uid);
    expect(tails.state.players.p2.hand).not.toContain(uid);
    expect(topOf(tails.state.players.p2.active)).toBe(topOf(state.players.p2.active));
    const heads = play(rolled(state, ["heads"]), uid);
    if (!heads.ok) throw new Error(heads.error.code);
    expect(heads.events.slice(0, 2).map((e) => e.type)).toEqual(["TRAINER_FLIP_LOCK_CHECK", "TRAINER_PLAYED"]);
    expect(topOf(heads.state.players.p2.active)).toBe(topOf(state.players.p2.bench[0]));
  });

  it("a Supporter, tails: discarded, the hand untouched, and the turn's Supporter is spent", () => {
    const first = inHand(fisted(), "p2", RESEARCH, 2);
    const handBefore = first.state.players.p2.hand.length;
    const tails = play(rolled(first.state, ["tails"]), first.uid);
    if (!tails.ok) throw new Error(tails.error.code);
    expect(tails.state.players.p2.hand).toHaveLength(handBefore - 1);
    expect(tails.state.allowances.supporterPlayed).toBe(true);
    expect(tails.state.allowances.supporterPlayedUid).toBeNull();
    const second = tails.state.players.p2.hand.find((u) => tails.state.cardIdByUid[u] === RESEARCH) as string;
    expect(refusal(play(tails.state, second))).toBe("SUPPORTER_ALREADY_PLAYED");
  });

  it("a Stadium, tails: discarded, the zone empty, and the turn's Stadium play is spent", () => {
    const held = inHand(fisted(), "p2", ARTAZON);
    const both = inHand(held.state, "p2", BEACH_COURT);
    const tails = play(rolled(both.state, ["tails"]), held.uid);
    if (!tails.ok) throw new Error(tails.error.code);
    expect(tails.state.stadium).toBeNull();
    expect(tails.state.players.p2.discard).toContain(held.uid);
    expect(tails.state.allowances.stadiumPlayed).toBe(true);
    expect(refusal(play(tails.state, both.uid))).toBe("STADIUM_ALREADY_PLAYED");
  });

  it("a Tool, tails: discarded, nothing attached; heads: attached", () => {
    const { state, uid } = inHand(fisted(), "p2", CHARM);
    const tool = (s: GameState) => applyAction(s, { type: "attachTool", seat: "p2", uid, target: { spot: "active" } });
    const tails = tool(rolled(state, ["tails"]));
    if (!tails.ok) throw new Error(tails.error.code);
    expect(body(tails.state.players.p2.active).tools).toEqual([]);
    expect(tails.state.players.p2.discard).toContain(uid);
    const heads = tool(rolled(state, ["heads"]));
    if (!heads.ok) throw new Error(heads.error.code);
    expect(body(heads.state.players.p2.active).tools).toEqual([uid]);
  });

  it("Rare Candy, tails: discarded and the Stage 2 stays in hand; heads: the Basic evolves", () => {
    const candy = inHand(fisted(SPROUT), "p2", RARE_CANDY);
    const tree = inHand(candy.state, "p2", TREE);
    const use = (s: GameState) =>
      applyAction(s, { type: "rareCandy", seat: "p2", uid: candy.uid, evolutionUid: tree.uid, target: { spot: "active" } });
    const tails = use(rolled(tree.state, ["tails"]));
    if (!tails.ok) throw new Error(tails.error.code);
    expect(tails.state.players.p2.hand).toContain(tree.uid);
    expect(tails.state.players.p2.discard).toContain(candy.uid);
    expect(topOf(tails.state.players.p2.active)).not.toBe(tree.uid);
    const heads = use(rolled(tree.state, ["heads"]));
    if (!heads.ok) throw new Error(heads.error.code);
    expect(topOf(heads.state.players.p2.active)).toBe(tree.uid);
  });

  it("an Antique Fossil (an Item play), tails: discarded, not benched; heads: benched", () => {
    const { state, uid } = inHand(fisted(), "p2", FOSSIL);
    const tails = play(rolled(state, ["tails"]), uid);
    if (!tails.ok) throw new Error(tails.error.code);
    expect(tails.state.players.p2.bench.map((b) => b.stack[0])).not.toContain(uid);
    expect(tails.state.players.p2.discard).toContain(uid);
    const heads = play(rolled(state, ["heads"]), uid);
    if (!heads.ok) throw new Error(heads.error.code);
    expect(heads.state.players.p2.bench.map((b) => b.stack[0])).toContain(uid);
  });

  it("a play the rules refuse anyway is refused before any coin (the try must be legal)", () => {
    // A second Supporter after a tails one: §7.2 refuses it, though the lock is live and the coin would be tails.
    const first = inHand(fisted(), "p2", RESEARCH, 2);
    const tails = play(rolled(first.state, ["tails"]), first.uid);
    if (!tails.ok) throw new Error(tails.error.code);
    expect(tails.state.players.p2.trainerFlipLockTurn).toBe(tails.state.turn);
    const second = tails.state.players.p2.hand.find((u) => tails.state.cardIdByUid[u] === RESEARCH);
    if (second === undefined) throw new Error("the second Professor's Research left the hand");
    expect(refusal(play(rolled(tails.state, ["tails"]), second))).toBe("SUPPORTER_ALREADY_PLAYED");
    expect(tails.state.players.p2.hand).toContain(second);
    // Switch with no Benched Pokémon: no legal target, so no coin, though the coin would be tails.
    const lone = attack(board(SEISMITOAD, [], WALL, []), "p1").state;
    expect(lone.players.p2.trainerFlipLockTurn).toBe(lone.turn);
    expect(lone.players.p2.bench).toEqual([]);
    const sw = inHand(lone, "p2", SWITCH);
    expect(refusal(play(rolled(sw.state, ["tails"]), sw.uid))).toBe("NO_LEGAL_TARGET");
    // The same tails coin with a Bench: the try is legal, so it flips (the refusals above are the checks, not the seed).
    const legal = inHand(fisted(), "p2", SWITCH);
    const flipped = play(rolled(legal.state, ["tails"]), legal.uid);
    if (!flipped.ok) throw new Error(flipped.error.code);
    expect(all(flipped.events, "TRAINER_FLIP_LOCK_CHECK")).toHaveLength(1);
  });

  it("no lock, no coin: the installer's own Trainer plays draw no rng; the victim's NEXT turn draws none either", () => {
    const own = inHand(board(SEISMITOAD, [WALL]), "p1", SWITCH);
    const p1Play = applyAction(own.state, { type: "playTrainer", seat: "p1", uid: own.uid });
    if (!p1Play.ok) throw new Error(p1Play.error.code);
    expect(all(p1Play.events, "TRAINER_FLIP_LOCK_CHECK")).toEqual([]);
    const later = endTurn(endTurn(fisted(), "p2"), "p1");
    const next = inHand(later, "p2", SWITCH);
    const free = play(next.state, next.uid);
    if (!free.ok) throw new Error(free.error.code);
    expect(all(free.events, "TRAINER_FLIP_LOCK_CHECK")).toEqual([]);
  });
});

describe("D636 §6 — Scorching Earth: the opponent's Stadium discarded, then no Stadium from their hand next turn (R-SCE1)", () => {
  function withStadium(state: GameState, owner: Seat, id: string): GameState {
    const side = state.players[owner];
    const uid = side.deck.find((u) => state.cardIdByUid[u] === id) as string;
    return {
      ...state,
      players: { ...state.players, [owner]: { ...side, deck: side.deck.filter((u) => u !== uid) } },
      stadium: { uid, owner },
    };
  }

  it("the opponent's Stadium: discarded to its owner's pile, and their next turn's Stadium play is barred", () => {
    const start = withStadium(board(CHIYU), "p2", ARTAZON);
    const stadiumUid = start.stadium?.uid as string;
    const { state, events } = attack(start, "p1");
    expect(all(events, "STADIUM_DISCARDED")).toEqual([
      { type: "STADIUM_DISCARDED", seat: "p2", uid: stadiumUid, cause: "effect" },
    ]);
    expect(state.stadium).toBeNull();
    expect(state.players.p2.discard).toContain(stadiumUid);
    expect(state.handPlayLockedTurn.p2.Stadium).toBe(state.turn);
    expect(all(events, "HAND_PLAY_BLOCKED")).toEqual([{ type: "HAND_PLAY_BLOCKED", seat: "p2", bars: "Stadium" }]);
    expect(body(state.players.p2.active).damage).toBe(40);
    const held = inHand(state, "p2", BEACH_COURT);
    expect(refusal(applyAction(held.state, { type: "playTrainer", seat: "p2", uid: held.uid }))).toBe("HAND_PLAY_BLOCKED");
  });

  it("the attacker's OWN Stadium is not discarded and nothing is barred; with no Stadium nothing happens", () => {
    for (const start of [withStadium(board(CHIYU), "p1", ARTAZON), board(CHIYU)]) {
      const { state, events } = attack(start, "p1");
      expect(state.stadium).toEqual(start.stadium);
      expect(all(events, "HAND_PLAY_BLOCKED")).toEqual([]);
      expect(state.handPlayLockedTurn.p2.Stadium).toBeNull();
      expect(body(state.players.p2.active).damage).toBe(40);
      const held = inHand(state, "p2", BEACH_COURT);
      expect(refusal(applyAction(held.state, { type: "playTrainer", seat: "p2", uid: held.uid }))).toBe("OK");
    }
  });

  it("the bar lapses: on the opponent's turn after, the Stadium is played", () => {
    const { state } = attack(withStadium(board(CHIYU), "p2", ARTAZON), "p1");
    const later = endTurn(endTurn(state, "p2"), "p1");
    const held = inHand(later, "p2", BEACH_COURT);
    expect(refusal(applyAction(held.state, { type: "playTrainer", seat: "p2", uid: held.uid }))).toBe("OK");
  });
});

describe("D636 §7 — Fall Back to Reload: after this Pokémon moved Active→Bench this turn, up to 2 Basic {W} from hand (R-FBR1)", () => {
  const use = (state: GameState, index = 0) =>
    applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index },
      abilityName: "Fall Back to Reload",
    });
  const take = (state: GameState, index = 0) =>
    must(
      applyAction(state, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index } } },
      } as GameAction),
    );
  const decline = (state: GameState) =>
    must(applyAction(state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon" } } as GameAction));
  /** Clawitzer Active, a Wall benched, `water` Basic {W} in hand; then the retreat (Clawitzer to Bench 0). */
  function retreated(water = 2): GameState {
    const held = handFromDeck(board(CLAWITZER, [WALL]), "p1", WATER, water);
    return must(applyAction(held, { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 }));
  }

  it("a Clawitzer that has not moved this turn may not use it", () => {
    const state = handFromDeck(board(WALL, [CLAWITZER]), "p1", WATER, 2);
    expect(body(state.players.p1.bench[0]).benchedTurn).toBeNull();
    expect(refusal(use(state))).toBe("ABILITY_CONDITION_NOT_MET");
  });

  it("the retreat stamps `benchedTurn`; the use attaches two, one or none (each pick declinable)", () => {
    const state = retreated();
    expect(body(state.players.p1.bench[0]).benchedTurn).toBe(state.turn);
    const used = must(use(state));
    const two = take(take(used));
    expect(body(two.players.p1.bench[0]).energy).toHaveLength(2);
    const one = decline(take(used));
    expect(body(one.players.p1.bench[0]).energy).toHaveLength(1);
    const none = decline(decline(used));
    expect(body(none.players.p1.bench[0]).energy).toHaveLength(0);
    expect(none.players.p1.hand.filter((u) => none.cardIdByUid[u] === WATER)).toHaveLength(2);
  });

  it("once per turn; and with no Basic {W} Energy card in hand it cannot be used", () => {
    const state = retreated();
    const two = take(take(must(use(state))));
    expect(refusal(use(two))).toBe("ABILITY_ALREADY_USED");
    expect(refusal(use(retreated(0)))).toBe("NO_LEGAL_TARGET");
  });

  it("a Switch stamps it too (`switchInto`, the other Active→Bench move)", () => {
    const held = inHand(handFromDeck(board(CLAWITZER, [WALL]), "p1", WATER, 1), "p1", SWITCH);
    const switched = must(applyAction(held.state, { type: "playTrainer", seat: "p1", uid: held.uid }));
    const clawitzer = switched.players.p1.bench.findIndex((b) => switched.cardIdByUid[b.stack[0] ?? ""] === CLAWITZER);
    expect(body(switched.players.p1.bench[clawitzer]).benchedTurn).toBe(switched.turn);
    expect(refusal(use(switched, clawitzer))).toBe("OK");
  });

  it("dragged to the Bench on the OPPONENT's turn (Boss's Orders) it stamps their turn: not usable on yours", () => {
    const p2turn = endTurn(board(CLAWITZER, [WALL]), "p1");
    const boss = inHand(p2turn, "p2", BOSS);
    const gusted = must(applyAction(boss.state, { type: "playTrainer", seat: "p2", uid: boss.uid }));
    const clawitzer = body(gusted.players.p1.bench.find((b) => gusted.cardIdByUid[b.stack[0] ?? ""] === CLAWITZER));
    expect(clawitzer.benchedTurn).toBe(p2turn.turn);
    const mine = handFromDeck(endTurn(gusted, "p2"), "p1", WATER, 1);
    const index = mine.players.p1.bench.findIndex((b) => mine.cardIdByUid[b.stack[0] ?? ""] === CLAWITZER);
    expect(refusal(use(mine, index))).toBe("ABILITY_CONDITION_NOT_MET");
  });

  it("evolving on the Bench keeps the stamp (R-FBR1, R-MR1's precedent): a Clauncher that retreated, evolved, may use it", () => {
    // P1's second turn (turn 4): a Clauncher Active since an earlier turn, so it may evolve.
    const later = endTurn(endTurn(board(CLAUNCHER, [WALL]), "p1"), "p2");
    const held = inHand(handFromDeck(later, "p1", WATER, 1), "p1", CLAWITZER);
    const benched = must(applyAction(held.state, { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 }));
    expect(benched.cardIdByUid[topOf(benched.players.p1.bench[0])]).toBe(CLAUNCHER);
    const evolved = must(
      applyAction(benched, { type: "evolve", seat: "p1", uid: held.uid, target: { spot: "bench", index: 0 } }),
    );
    expect(topOf(evolved.players.p1.bench[0])).toBe(held.uid);
    expect(body(evolved.players.p1.bench[0]).benchedTurn).toBe(evolved.turn);
    expect(refusal(use(evolved))).toBe("OK");
  });

  it("the stamp survives the JSON round trip (it is persisted)", () => {
    const state = retreated();
    expect(body(revived(state).players.p1.bench[0]).benchedTurn).toBe(state.turn);
  });
});

describe("D636 §8 — the log rows, the fresh keys and the version", () => {
  it("the lock and its coin, Jet of Ink's two coins, and the counters on the mark, each read as a row (under the seat's name)", () => {
    const { state, events } = attack(board(SEISMITOAD), "p1");
    expect(rows(all(events, "TRAINER_FLIP_LOCKED"), state)).toEqual([
      "must flip a coin to use each Trainer card from hand next turn",
    ]);
    const { state: held, uid } = inHand(state, "p2", SWITCH);
    const tails = applyAction(rolled(held, ["tails"]), { type: "playTrainer", seat: "p2", uid });
    if (!tails.ok) throw new Error(tails.error.code);
    expect(rows(tails.events, tails.state)).toEqual(["flipped for Switch — tails: it is discarded instead of used"]);
    const inked = attack(board(OCTILLERY), "p1");
    expect(all(inked.events, "ATTACK_LOCKED")).toEqual([
      { type: "ATTACK_LOCKED", seat: "p2", uid: topOf(inked.state.players.p2.active), flip: true, coins: 2 },
    ]);
    expect(rows(all(inked.events, "ATTACK_LOCKED"), inked.state)).toEqual([
      "D636 Wall must flip 2 coins to attack next turn — if either is tails, the attack doesn't happen",
    ]);
    const marked = attack(board(PACHIRISU), "p1");
    expect(rows(all(marked.events, "HAND_ATTACH_MARKED"), marked.state)).toEqual([
      "D636 Wall takes 8 damage counters for each Energy card attached to it from hand during its owner's next turn",
    ]);
  });

  it("a fresh body and side carry the NEW keys empty; the stamped Stadium key is present", () => {
    const fresh = makeInPlay("u1", 3);
    expect(fresh.attackTwoFlipLockTurn).toBeNull();
    expect(fresh.benchedTurn).toBeNull();
    const state = board(WALL);
    for (const seat of ["p1", "p2"] as const) {
      expect(state.players[seat].trainerFlipLockTurn).toBeNull();
      expect(state.handPlayLockedTurn[seat].Stadium).toBeNull();
    }
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.551.0");
  });
});
