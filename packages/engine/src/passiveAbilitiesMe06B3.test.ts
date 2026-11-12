import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { effectiveAttackCost } from "./continuous";
import type { GameAction, GameState, Seat } from "./index";
import { programFor } from "./registry";
import { simulationGaps } from "./simulationGaps";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  driveSetup,
  ensureInDeck,
  expectErr,
  handFromDeck,
  mustApply,
  patchSide,
  roundTrip,
  setActiveFromDeck,
  setDamage,
  trainerCard,
  unprize,
} from "./testFixtures";

const PUNK_OUT = "If your opponent has any Pokémon ex in play, this Pokémon has no Retreat Cost.";
const COTTONY_CARRIER = "Your Basic Pokémon in play have no Retreat Cost.";
const INCARNATE_SOLIDARITY =
  "If you have Tornadus, Thundurus, Landorus, and Enamorus in play, ignore all {C} Energy in the costs of attacks used by this Pokémon.";
const THUNDEROUS_EDGE =
  "This attack's damage isn't affected by any effects on your opponent's Active Pokémon.";
const RISING_HEART =
  "If your opponent's Active Pokémon is a Pokémon ex, this attack does 100 more damage.";
const GAIA_CRUSH = "Discard a Stadium in play.";
const CORKSCREW_DIVE = "You may draw cards until you have 6 cards in your hand.";
const HIGH_DENSITY_ARMOR =
  "If this Pokémon has full HP, it takes 60 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance).";
const TOUGH_SWING = "This attack's damage isn't affected by Resistance.";
const COUNTERATTACK_QUILLS =
  "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), place 3 damage counters on the Attacking Pokémon.";
const DIGGING_CLAW = "Discard the top card of your opponent's deck.";
const RESTRICTED_ACTIVATION =
  "This Pokémon can't use attacks unless you have 10 or more cards in your hand.";
const GOLIATHS_PUNCH = "This Pokémon also does 30 damage to itself.";

const solidarity = [
  { type: "Ability", name: "Incarnate Solidarity", effect: INCARNATE_SOLIDARITY },
];

const WIMPOD: Card = battler("me06-010", {
  name: "Wimpod",
  hp: 70,
  types: ["Grass"],
  retreat: 3,
  weaknesses: [{ type: "Fire", value: "×2" }],
  abilities: [{ type: "Ability", name: "Punk Out", effect: PUNK_OUT }],
  attacks: [{ cost: ["Grass"], name: "Ram", damage: 10 }],
});
const ALTARIA: Card = battler("me06-082", {
  name: "Altaria",
  stage: "Stage1",
  hp: 110,
  types: ["Colorless"],
  retreat: 1,
  weaknesses: [{ type: "Lightning", value: "×2" }],
  resistances: [{ type: "Fighting", value: "-30" }],
  abilities: [{ type: "Ability", name: "Cottony Carrier", effect: COTTONY_CARRIER }],
  attacks: [{ cost: ["Colorless", "Colorless", "Colorless"], name: "Flap", damage: 80 }],
});
const THUNDURUS: Card = battler("me06-035", {
  name: "Thundurus",
  hp: 120,
  types: ["Lightning"],
  retreat: 1,
  weaknesses: [{ type: "Fighting", value: "×2" }],
  abilities: solidarity,
  attacks: [
    {
      cost: ["Lightning", "Colorless", "Colorless"],
      name: "Thunderous Edge",
      damage: 90,
      effect: THUNDEROUS_EDGE,
    },
  ],
});
const ENAMORUS: Card = battler("me06-048", {
  name: "Enamorus",
  hp: 120,
  types: ["Psychic"],
  retreat: 1,
  weaknesses: [{ type: "Metal", value: "×2" }],
  abilities: solidarity,
  attacks: [
    {
      cost: ["Psychic", "Psychic", "Colorless", "Colorless"],
      name: "Rising Heart",
      damage: "100+",
      effect: RISING_HEART,
    },
  ],
});
const LANDORUS: Card = battler("me06-054", {
  name: "Landorus",
  hp: 130,
  types: ["Fighting"],
  retreat: 2,
  weaknesses: [{ type: "Grass", value: "×2" }],
  abilities: solidarity,
  attacks: [
    {
      cost: ["Fighting", "Colorless", "Colorless"],
      name: "Gaia Crush",
      damage: 110,
      effect: GAIA_CRUSH,
    },
  ],
});
const TORNADUS: Card = battler("me06-085", {
  name: "Tornadus",
  hp: 110,
  types: ["Colorless"],
  retreat: 1,
  weaknesses: [{ type: "Lightning", value: "×2" }],
  resistances: [{ type: "Fighting", value: "-30" }],
  abilities: solidarity,
  attacks: [
    {
      cost: ["Colorless", "Colorless", "Colorless"],
      name: "Corkscrew Dive",
      damage: 70,
      effect: CORKSCREW_DIVE,
    },
  ],
});
const SANDSLASH: Card = battler("me06-050", {
  name: "Sandslash",
  stage: "Stage1",
  hp: 110,
  types: ["Fighting"],
  retreat: 1,
  weaknesses: [{ type: "Grass", value: "×2" }],
  abilities: [{ type: "Ability", name: "Counterattack Quills", effect: COUNTERATTACK_QUILLS }],
  attacks: [{ cost: ["Fighting"], name: "Digging Claw", damage: 60, effect: DIGGING_CLAW }],
});
const STEELIX: Card = battler("me06-052", {
  name: "Steelix",
  stage: "Stage1",
  hp: 190,
  types: ["Fighting"],
  retreat: 4,
  weaknesses: [{ type: "Grass", value: "×2" }],
  abilities: [{ type: "Ability", name: "High Density Armor", effect: HIGH_DENSITY_ARMOR }],
  attacks: [
    {
      cost: ["Fighting", "Fighting", "Colorless", "Colorless"],
      name: "Tough Swing",
      damage: 150,
      effect: TOUGH_SWING,
    },
  ],
});
const GOLURK: Card = battler("me06-047", {
  name: "Mega Golurk ex",
  hp: 350,
  types: ["Psychic"],
  retreat: 3,
  weaknesses: [{ type: "Darkness", value: "×2" }],
  resistances: [{ type: "Fighting", value: "-30" }],
  abilities: [{ type: "Ability", name: "Restricted Activation", effect: RESTRICTED_ACTIVATION }],
  attacks: [
    { cost: ["Psychic", "Psychic"], name: "Goliath's Punch", damage: 300, effect: GOLIATHS_PUNCH },
  ],
});
const REPRINTS: readonly (readonly [string, Card])[] = [
  ["me06-116", ALTARIA],
  ["me06-110", ENAMORUS],
  ["me06-122", GOLURK],
  ["me06-137", GOLURK],
];

const WALL = "b3-wall";
const BRUTE_EX = "b3-brute-ex";
const BRUTE_V = "b3-brute-v";
const SPROUT = "b3-sprout";
const SHIELD = "b3-shield";
const HEAVY = "b3-heavy";
const TORNADUS_EX = "b3-tornadus-ex";
const STADIUM = "b3-stadium";
const KLEFKI = "sv01-096";
const SEISMITOAD = "sv03-052";

const SMASH = 0;
const BIG_SMASH = 1;
const SHOCKWAVE = 2;
const SELFSPLASH = 3;
const bruteAttacks = [
  { cost: ["Colorless"], name: "Smash", damage: 60 },
  { cost: ["Colorless"], name: "Big Smash", damage: 120 },
  {
    cost: ["Colorless"],
    name: "Shockwave",
    damage: 10,
    effect: "This attack does 30 damage to each of your opponent's Benched Pokémon.",
  },
  {
    cost: ["Colorless"],
    name: "Selfsplash",
    damage: 10,
    effect:
      "This attack also does 120 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  },
];

const LOCAL: Record<string, Card> = {
  [WIMPOD.id]: WIMPOD,
  [ALTARIA.id]: ALTARIA,
  [THUNDURUS.id]: THUNDURUS,
  [ENAMORUS.id]: ENAMORUS,
  [LANDORUS.id]: LANDORUS,
  [TORNADUS.id]: TORNADUS,
  [SANDSLASH.id]: SANDSLASH,
  [STEELIX.id]: STEELIX,
  [GOLURK.id]: GOLURK,
  [WALL]: battler(WALL, {
    name: "B3 Wall",
    hp: 400,
    types: ["Colorless"],
    retreat: 2,
    attacks: bruteAttacks,
  }),
  [BRUTE_EX]: battler(BRUTE_EX, {
    name: "B3 Brute ex",
    hp: 400,
    types: ["Colorless"],
    retreat: 2,
    attacks: bruteAttacks,
  }),
  [BRUTE_V]: battler(BRUTE_V, { name: "B3 Brute V", hp: 400, types: ["Colorless"], retreat: 2 }),
  [SPROUT]: battler(SPROUT, {
    name: "B3 Sprout",
    hp: 400,
    types: ["Grass"],
    retreat: 2,
    attacks: [
      { cost: ["Colorless"], name: "Leaf Tap", damage: 50 },
      { cost: ["Colorless"], name: "Leaf Slap", damage: 60 },
    ],
  }),
  [SHIELD]: battler(SHIELD, {
    name: "B3 Shield",
    hp: 400,
    types: ["Colorless"],
    retreat: 2,
    resistances: [{ type: "Fighting", value: "-30" }],
  }),
  [HEAVY]: battler(HEAVY, {
    name: "B3 Heavy",
    hp: 100,
    types: ["Colorless"],
    retreat: 3,
    attacks: [{ cost: ["Colorless", "Colorless"], name: "Press", damage: 20 }],
  }),
  [TORNADUS_EX]: battler(TORNADUS_EX, { name: "Tornadus ex", hp: 200, types: ["Colorless"] }),
  [STADIUM]: trainerCard(STADIUM, "Stadium", ""),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [WIMPOD.id]: 1,
  [ALTARIA.id]: 1,
  [THUNDURUS.id]: 1,
  [ENAMORUS.id]: 1,
  [LANDORUS.id]: 1,
  [TORNADUS.id]: 1,
  [SANDSLASH.id]: 1,
  [STEELIX.id]: 1,
  [GOLURK.id]: 1,
  [WALL]: 17,
  [BRUTE_EX]: 2,
  [BRUTE_V]: 1,
  [SPROUT]: 1,
  [SHIELD]: 1,
  [HEAVY]: 2,
  [TORNADUS_EX]: 1,
  [KLEFKI]: 1,
  [SEISMITOAD]: 1,
  [STADIUM]: 1,
  "fix-grass-energy": 3,
  "fix-lightning-energy": 4,
  "fix-psychic-energy": 6,
  "fix-fighting-energy": 6,
  "fix-energy": 4,
});
const KEEP = new Set(DECK.filter((id) => id !== WALL));

/** p1 to act, on a turn that is not the first; both hands in the deck, both Benches empty. */
function board(active: string, defender: string = WALL): GameState {
  let state = driveSetup(0xb3, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
  for (let i = 0; i < 3; i += 1) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = mustApply(state, { type: "endTurn", seat: state.phase.seat }).state;
  }
  for (const seat of ["p1", "p2"] as const) {
    const side = state.players[seat];
    const inPlay = [side.active, ...side.bench].flatMap((p) =>
      p === null ? [] : [...p.stack, ...p.energy, ...p.tools],
    );
    state = patchSide(state, seat, {
      hand: [],
      active: null,
      bench: [],
      deck: [...side.deck, ...side.hand, ...inPlay],
    });
    state = unprize(state, seat, KEEP);
  }
  state = clearBench(setActiveFromDeck(state, "p1", active), "p1");
  return clearBench(setActiveFromDeck(state, "p2", defender), "p2");
}

function bench(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  let out = state;
  for (const id of ids) out = benchFromDeck(ensureInDeck(out, seat, id), seat, id);
  return out;
}

function withStadium(state: GameState, id: string): GameState {
  const seated = ensureInDeck(state, "p2", id);
  const side = seated.players.p2;
  const uid = side.deck.find((u) => seated.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`no ${id}`);
  return {
    ...seated,
    players: { ...seated.players, p2: { ...side, deck: side.deck.filter((u) => u !== uid) } },
    stadium: { uid, owner: "p2" },
  };
}

function handOf(state: GameState, seat: Seat, count: number): GameState {
  return count === 0 ? state : handFromDeck(state, seat, WALL, count);
}

const attack = (index: number, seat: Seat = "p1"): GameAction => ({ type: "attack", seat, index });
const retreat = (seat: Seat = "p1"): GameAction => ({
  type: "retreat",
  seat,
  discardEnergy: [],
  promoteBenchIndex: 0,
});
const endTurn = (state: GameState, seat: Seat) => mustApply(state, { type: "endTurn", seat }).state;
const ids = (state: GameState, uids: readonly string[]) =>
  uids.map((u) => state.cardIdByUid[u] as string);
const topId = (state: GameState, seat: Seat) =>
  ids(state, state.players[seat].active?.stack ?? []).at(-1);

/** p1 ends its turn with nothing attached; p2 then acts with `attacker` as its Active. */
function opponentTurn(state: GameState, attacker: string): GameState {
  const swapped = attachFromDeck(
    clearBench(setActiveFromDeck(state, "p2", attacker), "p2"),
    "p2",
    "fix-energy",
    1,
  );
  const passed = endTurn(swapped, "p1");
  return patchSide(passed, "p2", { hand: [] });
}

describe("me06 B3: every printing leaves simulationGaps on its program", () => {
  it("the thirteen printings have no gap, and each program is its Ability's", () => {
    const faces = [WIMPOD, ALTARIA, THUNDURUS, ENAMORUS, LANDORUS, TORNADUS];
    for (const card of [...faces, SANDSLASH, STEELIX, GOLURK]) {
      expect(simulationGaps(card), card.id).toEqual([]);
    }
    for (const [id, face] of REPRINTS) {
      expect(simulationGaps({ ...face, id }), id).toEqual([]);
      expect(programFor(id), id).toEqual(programFor(face.id));
    }
    expect(programFor(WIMPOD.id)).toEqual({
      passive: { noRetreatCostSelf: { requiresOpponentSuffixInPlay: "ex" } },
    });
    expect(programFor(ALTARIA.id)).toEqual(programFor("sv08-076"));
    expect(programFor(SANDSLASH.id)).toEqual(programFor("me02.5-068"));
    for (const card of [THUNDURUS, ENAMORUS, LANDORUS, TORNADUS]) {
      expect(programFor(card.id), card.id).toEqual({
        passive: {
          ignoreColorlessCostIfNamedInPlay: ["Tornadus", "Thundurus", "Landorus", "Enamorus"],
        },
      });
    }
    expect(programFor(GOLURK.id)).toEqual({
      passive: { cantAttackUnless: { kind: "yourHandAtLeast", count: 10 } },
    });
    expect(programFor(STEELIX.id)).toEqual({
      passive: {
        damageReductionAfterWRFromAttacker: {
          amount: 60,
          attacker: { kind: "anyPokemon" },
          holderAtFullHp: true,
        },
      },
    });
  });
});

describe("Wimpod me06-010 Punk Out", () => {
  it("with the opponent's Pokémon ex on the Bench, Wimpod retreats for nothing", () => {
    const state = bench(bench(board(WIMPOD.id), "p1", [HEAVY]), "p2", [BRUTE_EX]);
    const out = mustApply(state, retreat());
    expect(topId(out.state, "p1")).toBe(HEAVY);
    expect(ids(out.state, out.state.players.p1.bench[0]?.stack ?? [])).toEqual([WIMPOD.id]);
  });

  it("the opponent's Active Pokémon ex counts, and so does a Mega Evolution Pokémon ex", () => {
    const active = bench(board(WIMPOD.id, BRUTE_EX), "p1", [HEAVY]);
    expect(topId(mustApply(active, retreat()).state, "p1")).toBe(HEAVY);
    const mega = bench(bench(board(WIMPOD.id), "p1", [HEAVY]), "p2", [GOLURK.id]);
    expect(topId(mustApply(mega, retreat()).state, "p1")).toBe(HEAVY);
  });

  it("a Pokémon V across the table, or a Pokémon ex on Wimpod's own side, leaves the Retreat Cost at 3", () => {
    const v = bench(board(WIMPOD.id, BRUTE_V), "p1", [HEAVY]);
    expectErr(v, retreat(), "RETREAT_COST_MISMATCH");
    const own = bench(board(WIMPOD.id), "p1", [HEAVY, BRUTE_EX]);
    expectErr(own, retreat(), "RETREAT_COST_MISMATCH");
  });

  it("Klefki in the opponent's Active Spot turns Punk Out off", () => {
    const locked = bench(board(WIMPOD.id, KLEFKI), "p1", [HEAVY]);
    expectErr(bench(locked, "p2", [BRUTE_EX]), retreat(), "RETREAT_COST_MISMATCH");
  });

  it("Ram does 10", () => {
    const state = attachFromDeck(board(WIMPOD.id), "p1", "fix-grass-energy", 1);
    expect(mustApply(state, attack(0)).state.players.p2.active?.damage).toBe(10);
  });
});

describe("Altaria me06-082 Cottony Carrier", () => {
  it("with Altaria on the Bench, the Basic Active retreats for nothing", () => {
    const state = bench(board(HEAVY), "p1", [ALTARIA.id]);
    const out = mustApply(state, retreat());
    expect(topId(out.state, "p1")).toBe(ALTARIA.id);
  });

  it("Altaria itself is a Stage 1 and still pays its {C}", () => {
    const state = bench(board(ALTARIA.id), "p1", [HEAVY]);
    expectErr(state, retreat(), "RETREAT_COST_MISMATCH");
    const paid = attachFromDeck(state, "p1", "fix-energy", 1);
    const energy = paid.players.p1.active?.energy ?? [];
    const out = mustApply(paid, { ...retreat(), discardEnergy: energy } as GameAction);
    expect(topId(out.state, "p1")).toBe(HEAVY);
  });

  it("without Altaria in play the Basic pays its 3, and the opponent's Basic is never freed", () => {
    expectErr(bench(board(HEAVY), "p1", [WIMPOD.id]), retreat(), "RETREAT_COST_MISMATCH");
    const theirs = bench(bench(board(WALL, HEAVY), "p1", [ALTARIA.id]), "p2", [WALL]);
    const passed = endTurn(theirs, "p1");
    expectErr(passed, retreat("p2"), "RETREAT_COST_MISMATCH");
  });

  it("Flap does 80", () => {
    const state = attachFromDeck(board(ALTARIA.id), "p1", "fix-energy", 3);
    expect(mustApply(state, attack(0)).state.players.p2.active?.damage).toBe(80);
  });
});

const QUARTET = [TORNADUS.id, THUNDURUS.id, LANDORUS.id, ENAMORUS.id];
const others = (active: string) => QUARTET.filter((id) => id !== active);

describe("Incarnate Solidarity (Thundurus, Enamorus, Landorus, Tornadus)", () => {
  it("with all four in play, Thundurus's Thunderous Edge costs {L} alone and does 90", () => {
    const state = attachFromDeck(
      bench(board(THUNDURUS.id), "p1", others(THUNDURUS.id)),
      "p1",
      "fix-lightning-energy",
      1,
    );
    const thundurus = state.players.p1.active;
    if (thundurus === null) throw new Error("no Active");
    expect(effectiveAttackCost(state, thundurus, THUNDURUS.attacks?.[0]?.cost ?? [])).toEqual([
      "Lightning",
    ]);
    expect(mustApply(state, attack(0)).state.players.p2.active?.damage).toBe(90);
  });

  it("three of the four, or the fourth on the opponent's side, leaves the {C} owed", () => {
    const three = bench(board(THUNDURUS.id), "p1", [TORNADUS.id, LANDORUS.id]);
    expectErr(
      attachFromDeck(three, "p1", "fix-lightning-energy", 1),
      attack(0),
      "ATTACK_COST_UNMET",
    );
    const across = bench(three, "p2", [ENAMORUS.id]);
    expectErr(
      attachFromDeck(across, "p1", "fix-lightning-energy", 1),
      attack(0),
      "ATTACK_COST_UNMET",
    );
  });

  it("a reading: the four names are matched exactly on the top card, so Tornadus ex does not answer for Tornadus", () => {
    const state = bench(board(THUNDURUS.id), "p1", [TORNADUS_EX, LANDORUS.id, ENAMORUS.id]);
    expectErr(
      attachFromDeck(state, "p1", "fix-lightning-energy", 1),
      attack(0),
      "ATTACK_COST_UNMET",
    );
  });

  it("the Ability reaches only its own attacks: another Active still pays its {C}{C}", () => {
    const state = bench(board(HEAVY), "p1", QUARTET);
    expectErr(state, attack(0), "ATTACK_COST_UNMET");
  });

  it("Klefki in the opponent's Active Spot locks Thundurus, and the {C}{C} is owed again", () => {
    const state = attachFromDeck(
      bench(board(THUNDURUS.id, KLEFKI), "p1", others(THUNDURUS.id)),
      "p1",
      "fix-lightning-energy",
      1,
    );
    expectErr(state, attack(0), "ATTACK_COST_UNMET");
  });

  it("a reading: a surcharge's {C} goes too, so Thunderous Edge still costs {L} alone under Seismitoad's Quaking Zone", () => {
    const state = attachFromDeck(
      bench(board(THUNDURUS.id, SEISMITOAD), "p1", others(THUNDURUS.id)),
      "p1",
      "fix-lightning-energy",
      1,
    );
    const thundurus = state.players.p1.active;
    if (thundurus === null) throw new Error("no Active");
    expect(effectiveAttackCost(state, thundurus, THUNDURUS.attacks?.[0]?.cost ?? [])).toEqual([
      "Lightning",
    ]);
    const out = mustApply(state, attack(0)).state;
    expect(ids(out, out.players.p2.discard)).toContain(SEISMITOAD);
  });

  it("Thunderous Edge isn't affected by effects on the opponent's Active: a full-HP Steelix takes the whole 90", () => {
    const state = attachFromDeck(
      bench(board(THUNDURUS.id, STEELIX.id), "p1", others(THUNDURUS.id)),
      "p1",
      "fix-lightning-energy",
      1,
    );
    expect(mustApply(state, attack(0)).state.players.p2.active?.damage).toBe(90);
  });

  it("Corkscrew Dive's draw is optional: declined, the hand stays at 2", () => {
    const state = handOf(bench(board(TORNADUS.id), "p1", others(TORNADUS.id)), "p1", 2);
    const parked = roundTrip(mustApply(state, attack(0)).state);
    const declined = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: false },
    }).state;
    expect(declined.players.p2.active?.damage).toBe(70);
    expect(declined.players.p1.hand).toHaveLength(2);
  });

  it("Tornadus's Corkscrew Dive costs nothing: 70, then the optional draw to 6", () => {
    const state = handOf(bench(board(TORNADUS.id), "p1", others(TORNADUS.id)), "p1", 2);
    const parked = mustApply(state, attack(0)).state;
    expect(parked.phase.kind).toBe("effect:choose");
    const round = roundTrip(parked);
    const drawn = mustApply(round, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    }).state;
    expect(drawn.players.p2.active?.damage).toBe(70);
    expect(drawn.players.p1.hand).toHaveLength(6);
  });

  it("Enamorus's Rising Heart costs {P}{P}: 100, and 200 against a Pokémon ex", () => {
    const plain = attachFromDeck(
      bench(board(ENAMORUS.id), "p1", others(ENAMORUS.id)),
      "p1",
      "fix-psychic-energy",
      2,
    );
    expect(mustApply(plain, attack(0)).state.players.p2.active?.damage).toBe(100);
    const ex = attachFromDeck(
      bench(board(ENAMORUS.id, BRUTE_EX), "p1", others(ENAMORUS.id)),
      "p1",
      "fix-psychic-energy",
      2,
    );
    expect(mustApply(ex, attack(0)).state.players.p2.active?.damage).toBe(200);
  });

  it("Landorus's Gaia Crush costs {F}: 110, and the Stadium is discarded", () => {
    const state = withStadium(
      attachFromDeck(
        bench(board(LANDORUS.id), "p1", others(LANDORUS.id)),
        "p1",
        "fix-fighting-energy",
        1,
      ),
      STADIUM,
    );
    const stadiumUid = state.stadium?.uid;
    const out = mustApply(state, attack(0)).state;
    expect(out.players.p2.active?.damage).toBe(110);
    expect(out.stadium).toBeNull();
    expect(out.players.p2.discard).toContain(stadiumUid);
  });
  it("with no Stadium in play Gaia Crush still does 110", () => {
    const state = attachFromDeck(
      bench(board(LANDORUS.id), "p1", others(LANDORUS.id)),
      "p1",
      "fix-fighting-energy",
      1,
    );
    const out = mustApply(state, attack(0)).state;
    expect(out.players.p2.active?.damage).toBe(110);
    expect(out.stadium).toBeNull();
  });
});

describe("Mega Golurk ex me06-047 Restricted Activation", () => {
  const golurk = (hand: number) =>
    handOf(attachFromDeck(board(GOLURK.id), "p1", "fix-psychic-energy", 2), "p1", hand);

  it("with 9 cards in hand Goliath's Punch is refused (the hand is counted at declaration)", () => {
    const state = golurk(9);
    expectErr(state, attack(0), "ATTACK_PREVENTED");
  });

  it("with 10 cards in hand it does 300 and 30 to itself", () => {
    const out = mustApply(golurk(10), attack(0)).state;
    expect(out.players.p2.active?.damage).toBe(300);
    expect(out.players.p1.active?.damage).toBe(30);
  });
});

describe("Steelix me06-052 High Density Armor and Tough Swing", () => {
  it("at full HP it takes 60 less: Big Smash's 120 lands as 60, and the next 120 lands in full", () => {
    const first = mustApply(opponentTurn(board(STEELIX.id), BRUTE_EX), attack(BIG_SMASH, "p2"));
    expect(first.state.players.p1.active?.damage).toBe(60);
    const again = endTurn(first.state, "p1");
    const passedBack = patchSide(again, "p2", { hand: [] });
    if (passedBack.phase.kind !== "turn:action" || passedBack.phase.seat !== "p2")
      throw new Error(`expected p2 to act, got ${passedBack.phase.kind}`);
    const second = mustApply(passedBack, attack(BIG_SMASH, "p2"));
    expect(second.state.players.p1.active?.damage).toBe(180);
  });

  it("the 60 comes off after Weakness: a {G} 60 doubles to 120 and lands as 60", () => {
    const out = mustApply(opponentTurn(board(STEELIX.id), SPROUT), attack(1, "p2"));
    expect(out.state.players.p1.active?.damage).toBe(60);
  });

  it("a reading: full HP means no damage counters when the damage is dealt; a 50 doubled to 100 lands as 40, and Steelix with 10 damage takes the whole 120", () => {
    const tap = mustApply(opponentTurn(board(STEELIX.id), SPROUT), attack(0, "p2"));
    expect(tap.state.players.p1.active?.damage).toBe(40);
    const hurt = mustApply(
      opponentTurn(setDamage(board(STEELIX.id), "p1", 10), SPROUT),
      attack(1, "p2"),
    );
    expect(hurt.state.players.p1.active?.damage).toBe(130);
  });

  it("on the Bench it takes 60 less too: Shockwave's 30 lands as 0", () => {
    const state = bench(board(HEAVY), "p1", [STEELIX.id]);
    const out = mustApply(opponentTurn(state, BRUTE_EX), attack(SHOCKWAVE, "p2"));
    expect(out.state.players.p1.active?.damage).toBe(10);
    expect(out.state.players.p1.bench[0]?.damage).toBe(0);
  });

  it("damage from its own side's attack is not reduced", () => {
    const state = bench(board(WALL), "p1", [STEELIX.id]);
    const out = mustApply(attachFromDeck(state, "p1", "fix-energy", 1), attack(SELFSPLASH));
    expect(out.state.players.p1.bench[0]?.damage).toBe(120);
  });

  it("Tough Swing does 150 through Resistance", () => {
    const state = attachFromDeck(
      attachFromDeck(board(STEELIX.id, SHIELD), "p1", "fix-fighting-energy", 2),
      "p1",
      "fix-energy",
      2,
    );
    expect(mustApply(state, attack(0)).state.players.p2.active?.damage).toBe(150);
  });
});

describe("Sandslash me06-050 Counterattack Quills and Digging Claw", () => {
  it("damaged in the Active Spot, it places 3 damage counters on the Attacking Pokémon", () => {
    const out = mustApply(opponentTurn(board(SANDSLASH.id), BRUTE_EX), attack(SMASH, "p2"));
    expect(out.state.players.p1.active?.damage).toBe(60);
    expect(out.state.players.p2.active?.damage).toBe(30);
  });

  it("Knocked Out by the attack, it still places them", () => {
    const state = bench(setDamage(board(SANDSLASH.id), "p1", 60), "p1", [HEAVY]);
    const out = mustApply(opponentTurn(state, BRUTE_EX), attack(SMASH, "p2"));
    expect(out.state.players.p1.discard.map((u) => out.state.cardIdByUid[u])).toContain(
      SANDSLASH.id,
    );
    expect(out.state.players.p2.active?.damage).toBe(30);
  });

  it("damaged on the Bench, it places nothing", () => {
    const state = bench(board(HEAVY), "p1", [SANDSLASH.id]);
    const out = mustApply(opponentTurn(state, BRUTE_EX), attack(SHOCKWAVE, "p2"));
    expect(out.state.players.p1.bench[0]?.damage).toBe(30);
    expect(out.state.players.p2.active?.damage ?? 0).toBe(0);
  });

  it("Digging Claw does 60 and discards the top card of the opponent's deck", () => {
    const state = attachFromDeck(board(SANDSLASH.id), "p1", "fix-fighting-energy", 1);
    const top = state.players.p2.deck[0];
    const out = mustApply(state, attack(0)).state;
    expect(out.players.p2.active?.damage).toBe(60);
    expect(out.players.p2.discard).toContain(top);
    expect(out.players.p2.deck).not.toContain(top);
  });
});
