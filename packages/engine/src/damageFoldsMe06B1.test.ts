import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
} from "./effects";
import type { GameAction, GameEvent, GameState } from "./index";
import { programFor } from "./registry";
import { simulationGaps } from "./simulationGaps";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  discardFromDeck,
  driveSetup,
  ensureInDeck,
  expectErr,
  handFromDeck,
  mustApply,
  roundTrip,
  setActiveFromDeck,
  trainerCard,
  unprize,
} from "./testFixtures";

const LINEAR_ATTACK =
  "This attack does 30 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const PUNISHING_NEEDLES =
  "This attack does 50 more damage for each of your opponent's Pokémon in play that has an Ability.";
const RAID =
  "If this Pokémon evolved from Wattrel during this turn, this attack does 90 more damage.";
const BRUTAL_WHIRLPOOL =
  "If a Stadium that has \"Legendary\" in its name is in play, this attack also does 50 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const BRUTAL_LANDS =
  'If a Stadium that has "Legendary" in its name is in play, this attack does 170 more damage.';
const COLORFUL_WHIP =
  "Reveal any number of Pokémon from your hand, and this attack does 30 damage for each different type of Pokémon you revealed in this way.";
const REWARM =
  "This attack does 30 damage for each Basic {R} Energy card in your discard pile. Then, shuffle those cards into your deck.";
const STRONG_FLARE = "Discard 2 Energy from this Pokémon.";

const CACTURNE: Card = battler("me06-005", {
  name: "Cacturne",
  hp: 130,
  types: ["Grass"],
  stage: "Stage1",
  retreat: 2,
  weaknesses: [{ type: "Fire", value: "×2" }],
  attacks: [
    { cost: ["Colorless"], name: "Linear Attack", effect: LINEAR_ATTACK },
    { cost: ["Grass"], name: "Punishing Needles", damage: "10+", effect: PUNISHING_NEEDLES },
  ],
});
const HEAT_ROTOM_EX: Card = battler("me06-023", {
  name: "Heat Rotom ex",
  hp: 190,
  types: ["Fire"],
  retreat: 1,
  weaknesses: [{ type: "Water", value: "×2" }],
  attacks: [
    { cost: ["Colorless", "Colorless"], name: "Rewarm", damage: "30×", effect: REWARM },
    {
      cost: ["Fire", "Fire", "Colorless"],
      name: "Strong Flare",
      damage: 170,
      effect: STRONG_FLARE,
    },
  ],
});
const KYOGRE: Card = battler("me06-026", {
  name: "Kyogre",
  hp: 150,
  types: ["Water"],
  retreat: 3,
  weaknesses: [{ type: "Lightning", value: "×2" }],
  attacks: [
    { cost: ["Water", "Colorless"], name: "Waterfall", damage: 40 },
    {
      cost: ["Water", "Water", "Colorless"],
      name: "Brutal Whirlpool",
      damage: 100,
      effect: BRUTAL_WHIRLPOOL,
    },
  ],
});
const WATTREL: Card = battler("me06-040", {
  name: "Wattrel",
  hp: 60,
  types: ["Lightning"],
  retreat: 1,
  weaknesses: [{ type: "Lightning", value: "×2" }],
  resistances: [{ type: "Fighting", value: "-30" }],
  attacks: [
    {
      cost: ["Lightning"],
      name: "Agility",
      damage: 10,
      effect:
        "Flip a coin. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.",
    },
  ],
});
/** The catalog row has no `evolve_from` (no me06 row has one); the printed "Evolves from Wattrel" is supplied so it can evolve. */
const KILOWATTREL: Card = battler("me06-041", {
  name: "Kilowattrel",
  hp: 120,
  types: ["Lightning"],
  stage: "Stage1",
  evolveFrom: "Wattrel",
  retreat: 1,
  weaknesses: [{ type: "Lightning", value: "×2" }],
  resistances: [{ type: "Fighting", value: "-30" }],
  attacks: [
    { cost: ["Lightning"], name: "Raid", damage: "30+", effect: RAID },
    { cost: ["Lightning", "Colorless"], name: "Speed Dive", damage: 70 },
  ],
});
const GROUDON: Card = battler("me06-053", {
  name: "Groudon",
  hp: 150,
  types: ["Fighting"],
  retreat: 4,
  weaknesses: [{ type: "Grass", value: "×2" }],
  attacks: [
    { cost: ["Fighting", "Colorless"], name: "Strength", damage: 40 },
    {
      cost: ["Fighting", "Fighting", "Colorless"],
      name: "Brutal Lands",
      damage: "100+",
      effect: BRUTAL_LANDS,
    },
  ],
});
const KECLEON: Card = battler("me06-083", {
  name: "Kecleon",
  hp: 90,
  types: ["Colorless"],
  retreat: 2,
  weaknesses: [{ type: "Fighting", value: "×2" }],
  attacks: [
    {
      cost: ["Colorless", "Colorless"],
      name: "Colorful Whip",
      damage: "30×",
      effect: COLORFUL_WHIP,
    },
  ],
});
/** sv03-141 prints Cacturne's sentence on Punishing Scissors, so the same reader plays it. */
const SCIZOR: Card = battler("sv03-141", {
  name: "Scizor",
  hp: 140,
  types: ["Metal"],
  stage: "Stage1",
  evolveFrom: "Scyther",
  retreat: 2,
  attacks: [
    { cost: ["Metal"], name: "Punishing Scissors", damage: "10+", effect: PUNISHING_NEEDLES },
    { cost: ["Metal", "Metal"], name: "Cut", damage: 70 },
  ],
});
const REPRINTS: readonly (readonly [string, Card])[] = [
  ["me06-111", GROUDON],
  ["me06-117", KECLEON],
  ["me06-119", HEAT_ROTOM_EX],
  ["sv03-205", SCIZOR],
  ["sv04.5-191", SCIZOR],
];

/** The catalog's Legendary Summit row has no effect text, so it sits in the zone by surgery. */
const LEGENDARY_SUMMIT = "me06-096";
const BEACH_COURT = "sv01-167";
const WATCHTOWER = "sv10-180";
const WALL = "b1-wall";
const GIFTED = "b1-gifted";
const PLAIN = "b1-plain";
const SOAKED = "b1-soaked";
const GRASS_MON = "b1-grass";
const FIRE_MON = "b1-fire";
const DUAL_MON = "b1-water-lightning";
const ITEM = "b1-item";

const LOCAL: Record<string, Card> = {
  [CACTURNE.id]: CACTURNE,
  [HEAT_ROTOM_EX.id]: HEAT_ROTOM_EX,
  [KYOGRE.id]: KYOGRE,
  [WATTREL.id]: WATTREL,
  [KILOWATTREL.id]: KILOWATTREL,
  [GROUDON.id]: GROUDON,
  [KECLEON.id]: KECLEON,
  [SCIZOR.id]: SCIZOR,
  [LEGENDARY_SUMMIT]: {
    ...trainerCard(LEGENDARY_SUMMIT, "Stadium", ""),
    name: "Legendary Summit",
    effect: null,
  },
  [WATCHTOWER]: {
    ...trainerCard(
      WATCHTOWER,
      "Stadium",
      "{C} Pokémon in play (both yours and your opponent's) have no Abilities.",
    ),
    name: "Team Rocket's Watchtower",
  },
  [WALL]: battler(WALL, { name: "B1 Wall", hp: 400, types: ["Colorless"], retreat: 2 }),
  [GIFTED]: battler(GIFTED, {
    name: "B1 Gifted",
    hp: 200,
    types: ["Colorless"],
    abilities: [{ type: "Ability", name: "B1 Aura", effect: "Nothing happens." }],
  }),
  [PLAIN]: battler(PLAIN, { name: "B1 Plain", hp: 200, types: ["Colorless"] }),
  [SOAKED]: battler(SOAKED, {
    name: "B1 Soaked",
    hp: 200,
    types: ["Fire"],
    weaknesses: [{ type: "Water", value: "×2" }],
  }),
  [GRASS_MON]: battler(GRASS_MON, { name: "B1 Grass", types: ["Grass"] }),
  [FIRE_MON]: battler(FIRE_MON, { name: "B1 Fire", types: ["Fire"] }),
  [DUAL_MON]: battler(DUAL_MON, { name: "B1 Dual", types: ["Water", "Lightning"] }),
  [ITEM]: trainerCard(ITEM, "Item", "Draw a card."),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [CACTURNE.id]: 1,
  [HEAT_ROTOM_EX.id]: 1,
  [KYOGRE.id]: 1,
  [WATTREL.id]: 1,
  [KILOWATTREL.id]: 1,
  [GROUDON.id]: 1,
  [KECLEON.id]: 1,
  [SCIZOR.id]: 1,
  [LEGENDARY_SUMMIT]: 1,
  [BEACH_COURT]: 1,
  [WATCHTOWER]: 1,
  [WALL]: 14,
  [GIFTED]: 4,
  [PLAIN]: 2,
  [SOAKED]: 1,
  [GRASS_MON]: 2,
  [FIRE_MON]: 1,
  [DUAL_MON]: 1,
  [ITEM]: 1,
  "fix-grass-energy": 3,
  "fix-fire-energy": 5,
  "fix-fire-energy-alt": 3,
  "fix-water-energy": 5,
  "fix-lightning-energy": 3,
  "fix-fighting-energy": 3,
  "fix-metal-energy": 1,
});
const KEEP = new Set(DECK.filter((id) => id !== WALL));

/** P1's turn 4: both players have had a turn, so Wattrel can evolve; both Benches empty. */
function board(attacker: string, energy: readonly (readonly [string, number])[]): GameState {
  let state = driveSetup(0xb1, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
  for (const seat of ["p2", "p1", "p2"] as const) {
    state = mustApply(state, { type: "endTurn", seat }).state;
  }
  for (const seat of ["p1", "p2"] as const) {
    const side = state.players[seat];
    state = {
      ...state,
      players: {
        ...state.players,
        [seat]: { ...side, hand: [], deck: [...side.deck, ...side.hand] },
      },
    };
    state = unprize(state, seat, KEEP);
  }
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", WALL), "p2");
  for (const [id, n] of energy) state = attachFromDeck(state, "p1", id, n);
  return state;
}

function withStadium(state: GameState, id: string, owner: "p1" | "p2" = "p2"): GameState {
  const seated = ensureInDeck(state, owner, id);
  const side = seated.players[owner];
  const uid = side.deck.find((u) => seated.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`no ${id}`);
  return {
    ...seated,
    players: { ...seated.players, [owner]: { ...side, deck: side.deck.filter((u) => u !== uid) } },
    stadium: { uid, owner },
  };
}

const attack = (index: number): GameAction => ({ type: "attack", seat: "p1", index });
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const activeDamage = (state: GameState) => state.players.p2.active?.damage ?? -1;
const benchDamage = (state: GameState) => state.players.p2.bench.map((b) => b.damage);
const hand = (state: GameState, id: string) =>
  state.players.p1.hand.filter((u) => state.cardIdByUid[u] === id);

describe("me06 B1: every printing leaves simulationGaps through the text readers, no registry row", () => {
  it("the nine printings and Scizor's three have no gap and no program", () => {
    const faces = [CACTURNE, HEAT_ROTOM_EX, KYOGRE, KILOWATTREL, GROUDON, KECLEON, SCIZOR];
    for (const card of faces) {
      expect(simulationGaps(card), card.id).toEqual([]);
      expect(programFor(card.id), card.id).toBeUndefined();
    }
    for (const [id, face] of REPRINTS) {
      expect(simulationGaps({ ...face, id }), id).toEqual([]);
    }
  });

  it("each sentence derives to its reader's shape", () => {
    expect(deriveAttackDamageBonus(PUNISHING_NEEDLES)).toEqual({
      per: 50,
      count: { kind: "pokemonInPlay", seat: "opponent", filter: { kind: "abilityPokemon" } },
    });
    expect(deriveAttackDamageBonus(RAID)).toEqual({
      per: 90,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourActiveEvolvedFromThisTurn", name: "Wattrel" },
      },
    });
    const legendary = { kind: "stadiumInPlayNameContains", fragment: "Legendary" };
    expect(deriveAttackDamageBonus(BRUTAL_LANDS)).toEqual({
      per: 170,
      count: { kind: "boardCondition", cond: legendary },
    });
    expect(deriveAttackEffect(BRUTAL_WHIRLPOOL)).toEqual([
      {
        op: "conditionGate",
        cond: legendary,
        ops: [{ op: "spreadDamage", target: "opponentBench", amount: 50 }],
      },
    ]);
    expect(deriveAttackEffect(COLORFUL_WHIP)).toEqual([
      {
        op: "revealFromHand",
        filter: { kind: "anyPokemon" },
        note: "Reveal any number of Pokémon from your hand.",
        recordAs: "revealed",
      },
      { op: "damageDefender", per: 30, count: "revealed", distinctPokemonTypes: true },
    ]);
    const fire = { kind: "basicEnergy", energyType: "Fire" };
    expect(deriveAttackDamageMultiplier(REWARM)).toEqual({
      per: 30,
      count: { kind: "cardsInDiscardPile", seat: "you", filter: fire },
    });
    expect(deriveAttackEffect(REWARM)).toEqual([
      { op: "discardPileRetrieval", filter: fire, dest: "deck", max: "all" },
      { op: "shuffleDeck" },
    ]);
  });

  it("an unmapped clause and a printed zero stay loud", () => {
    const otherFragment = BRUTAL_WHIRLPOOL.replace('"Legendary"', '"Mythical"');
    expect(deriveAttackEffect(otherFragment)).toBeNull();
    expect(deriveAttackEffect(BRUTAL_WHIRLPOOL.replace("50 damage", "0 damage"))).toBeNull();
    expect(deriveAttackDamageBonus(PUNISHING_NEEDLES.replace("50", "0"))).toBeNull();
    expect(deriveAttackEffect(COLORFUL_WHIP.replace("30 damage", "0 damage"))).toBeNull();
    expect(deriveAttackDamageMultiplier(REWARM.replace("{R}", "{C}"))).toBeNull();
  });
});

describe("Cacturne me06-005 Punishing Needles", () => {
  it("10 plus 50 for each of the opponent's Pokémon in play with an Ability; the plain one and your own do not count", () => {
    let state = board(CACTURNE.id, [["fix-grass-energy", 1]]);
    state = clearBench(setActiveFromDeck(state, "p2", GIFTED), "p2");
    state = benchFromDeck(
      benchFromDeck(benchFromDeck(state, "p2", GIFTED), "p2", GIFTED),
      "p2",
      PLAIN,
    );
    state = benchFromDeck(state, "p1", GIFTED);
    const out = mustApply(state, attack(1));
    expect(activeDamage(out.state)).toBe(160);
    expect(benchDamage(out.state)).toEqual([0, 0, 0]);
  });

  it("no opposing Ability: the printed 10", () => {
    const state = benchFromDeck(board(CACTURNE.id, [["fix-grass-energy", 1]]), "p2", PLAIN);
    expect(activeDamage(mustApply(state, attack(1)).state)).toBe(10);
  });

  it("reading: an Ability shut off by Team Rocket's Watchtower still counts, since the count reads the printed card", () => {
    let state = board(CACTURNE.id, [["fix-grass-energy", 1]]);
    state = withStadium(benchFromDeck(state, "p2", GIFTED), WATCHTOWER);
    expect(activeDamage(mustApply(state, attack(1)).state)).toBe(60);
  });

  it("Scizor sv03-141 Punishing Scissors plays the same sentence: 10 + 50", () => {
    const state = benchFromDeck(board(SCIZOR.id, [["fix-metal-energy", 1]]), "p2", GIFTED);
    expect(activeDamage(mustApply(state, attack(0)).state)).toBe(60);
  });

  it("is refused without a {G}", () => {
    expectErr(board(CACTURNE.id, [["fix-fire-energy", 1]]), attack(1), "ATTACK_COST_UNMET");
  });
});

describe("Kilowattrel me06-041 Raid", () => {
  function evolved(): GameState {
    let state = board(WATTREL.id, [["fix-lightning-energy", 1]]);
    state = handFromDeck(state, "p1", KILOWATTREL.id, 1);
    const [uid] = hand(state, KILOWATTREL.id);
    return mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: uid as string,
      target: { spot: "active" },
    }).state;
  }

  it("evolved from Wattrel this turn: 30 + 90", () => {
    expect(activeDamage(mustApply(evolved(), attack(0)).state)).toBe(120);
  });

  it("evolved on an earlier turn: the printed 30", () => {
    let state = mustApply(evolved(), { type: "endTurn", seat: "p1" }).state;
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    const out = mustApply(state, attack(0));
    expect(activeDamage(out.state)).toBe(30);
  });

  it("put in play without evolving this turn: the printed 30", () => {
    const state = board(KILOWATTREL.id, [["fix-lightning-energy", 1]]);
    expect(activeDamage(mustApply(state, attack(0)).state)).toBe(30);
  });
});

describe('Kyogre me06-026 Brutal Whirlpool and Groudon me06-053 Brutal Lands: a Stadium with "Legendary" in its name', () => {
  const kyogre = () => {
    const state = board(KYOGRE.id, [["fix-water-energy", 3]]);
    return benchFromDeck(benchFromDeck(state, "p2", PLAIN), "p2", SOAKED);
  };

  it("Legendary Summit in play (the opponent's): 100 to the Active and 50 to each Benched Pokémon, Weakness not applied", () => {
    const out = mustApply(withStadium(kyogre(), LEGENDARY_SUMMIT), attack(1));
    expect(activeDamage(out.state)).toBe(100);
    expect(benchDamage(out.state)).toEqual([50, 50]);
  });

  it("reading: the attacker's own Legendary Summit counts too: the spread and Brutal Lands' 170 both land", () => {
    const out = mustApply(withStadium(kyogre(), LEGENDARY_SUMMIT, "p1"), attack(1));
    expect(activeDamage(out.state)).toBe(100);
    expect(benchDamage(out.state)).toEqual([50, 50]);
    const groudon = withStadium(
      board(GROUDON.id, [["fix-fighting-energy", 3]]),
      LEGENDARY_SUMMIT,
      "p1",
    );
    expect(activeDamage(mustApply(groudon, attack(1)).state)).toBe(270);
  });

  it("another Stadium, or none: only the 100", () => {
    for (const state of [withStadium(kyogre(), BEACH_COURT), kyogre()]) {
      const out = mustApply(state, attack(1));
      expect(activeDamage(out.state)).toBe(100);
      expect(benchDamage(out.state)).toEqual([0, 0]);
    }
  });

  it("Groudon: 100 + 170 under Legendary Summit, 100 under Beach Court or none", () => {
    const groudon = () => board(GROUDON.id, [["fix-fighting-energy", 3]]);
    expect(activeDamage(mustApply(withStadium(groudon(), LEGENDARY_SUMMIT), attack(1)).state)).toBe(
      270,
    );
    expect(activeDamage(mustApply(withStadium(groudon(), BEACH_COURT), attack(1)).state)).toBe(100);
    expect(activeDamage(mustApply(groudon(), attack(1)).state)).toBe(100);
  });
});

describe("Kecleon me06-083 Colorful Whip", () => {
  const kecleon = () => {
    let state = board(KECLEON.id, [["fix-water-energy", 2]]);
    for (const id of [GRASS_MON, GRASS_MON, FIRE_MON, DUAL_MON, ITEM]) {
      state = handFromDeck(state, "p1", id, 1);
    }
    return state;
  };
  const parkedPrompt = (state: GameState) => {
    if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "chooseCards") {
      throw new Error(`expected a chooseCards park, got ${state.phase.kind}`);
    }
    return state.phase.prompt;
  };
  const reveal = (state: GameState, uids: readonly string[]) =>
    mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids },
    } as GameAction);

  it("offers only the Pokémon in hand, 0 to all of them, and the park survives a round trip", () => {
    const parked = roundTrip(mustApply(kecleon(), attack(0)).state);
    const prompt = parkedPrompt(parked);
    expect(prompt.candidates.map((u) => parked.cardIdByUid[u]).sort()).toEqual(
      [GRASS_MON, GRASS_MON, FIRE_MON, DUAL_MON].sort(),
    );
    expect([prompt.min, prompt.max, prompt.dest]).toEqual([0, 4, "reveal"]);
    expect(prompt.note).toBe("Reveal any number of Pokémon from your hand.");
  });

  it("two Grass and a Fire are 2 types: 60; the cards stay in hand", () => {
    const parked = mustApply(kecleon(), attack(0)).state;
    const picked = [...hand(parked, GRASS_MON), ...hand(parked, FIRE_MON)];
    const out = reveal(parked, picked);
    expect(activeDamage(out.state)).toBe(60);
    expect(out.state.players.p1.hand).toEqual(parked.players.p1.hand);
    expect(of(out.events, "HAND_CARDS_REVEALED")).toEqual([
      { type: "HAND_CARDS_REVEALED", seat: "p1", uids: picked },
    ]);
  });

  it("reading: a {W}{L} card adds both its types, so Grass, Fire and it are 4 types: 120", () => {
    const parked = mustApply(kecleon(), attack(0)).state;
    const picked = [
      ...hand(parked, GRASS_MON),
      ...hand(parked, FIRE_MON),
      ...hand(parked, DUAL_MON),
    ];
    expect(activeDamage(reveal(parked, picked).state)).toBe(120);
  });

  it("refuses the Item, a uid twice and the opponent's answer, and the park stays", () => {
    const parked = mustApply(kecleon(), attack(0)).state;
    const [grass] = hand(parked, GRASS_MON);
    const [item] = hand(parked, ITEM);
    for (const uids of [[item as string], [grass as string, grass as string]]) {
      expectErr(
        parked,
        { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids } } as GameAction,
        "BAD_EFFECT_CHOICE",
      );
    }
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p2",
        choice: { kind: "cards", uids: [grass as string] },
      } as GameAction,
      "WRONG_SEAT",
    );
  });

  it("revealing none does no damage; no Pokémon in hand does not park", () => {
    const parked = mustApply(kecleon(), attack(0)).state;
    expect(activeDamage(reveal(parked, []).state)).toBe(0);
    const bare = mustApply(
      handFromDeck(board(KECLEON.id, [["fix-water-energy", 2]]), "p1", ITEM, 1),
      attack(0),
    );
    expect(bare.state.phase.kind).not.toBe("effect:choose");
    expect(activeDamage(bare.state)).toBe(0);
  });
});

describe("Heat Rotom ex me06-023 Rewarm", () => {
  it("30 per Basic {R} Energy card in your discard pile, then exactly those are shuffled into the deck", () => {
    let state = board(HEAT_ROTOM_EX.id, [["fix-water-energy", 2]]);
    state = discardFromDeck(state, "p1", "fix-fire-energy", 2);
    state = discardFromDeck(state, "p1", "fix-fire-energy-alt", 1);
    state = discardFromDeck(state, "p1", "fix-water-energy", 1);
    state = discardFromDeck(state, "p2", "fix-fire-energy", 2);
    const fires = state.players.p1.discard.filter((u) =>
      ["fix-fire-energy", "fix-fire-energy-alt"].includes(state.cardIdByUid[u] ?? ""),
    );
    expect(fires).toHaveLength(3);
    const out = mustApply(state, attack(0));
    expect(activeDamage(out.state)).toBe(90);
    for (const u of fires) expect(out.state.players.p1.deck).toContain(u);
    expect(out.state.players.p1.discard.map((u) => out.state.cardIdByUid[u])).toEqual([
      "fix-water-energy",
    ]);
    expect(out.state.players.p2.discard).toHaveLength(2);
    expect(of(out.events, "SHUFFLE")).toHaveLength(1);
  });

  it("no Basic {R} Energy in the discard pile: no damage, and the deck is still shuffled", () => {
    const state = discardFromDeck(
      board(HEAT_ROTOM_EX.id, [["fix-water-energy", 2]]),
      "p1",
      "fix-water-energy",
      1,
    );
    const out = mustApply(state, attack(0));
    expect(activeDamage(out.state)).toBe(0);
    expect(of(out.events, "SHUFFLE")).toHaveLength(1);
    expect(out.state.players.p1.discard).toHaveLength(1);
  });

  it("Strong Flare already plays: 170, then 2 Energy leave Heat Rotom ex", () => {
    const state = board(HEAT_ROTOM_EX.id, [["fix-fire-energy", 3]]);
    const out = mustApply(state, attack(1));
    expect(activeDamage(out.state)).toBe(170);
    expect(out.state.players.p1.active?.energy).toHaveLength(1);
  });
});
