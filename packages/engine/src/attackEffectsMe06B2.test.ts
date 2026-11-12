import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { deriveAttackEffect, timingGateFromAttackText } from "./effects";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
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
  expectErr,
  handFromDeck,
  mustApply,
  patchSide,
  roundTrip,
  setActiveFromDeck,
  setDamage,
  unprize,
  withFaces,
} from "./testFixtures";

const FADE_OUT = "Put this Pokémon and all attached cards into your hand.";
const BUG_OUT =
  "Reveal the bottom 7 cards of your deck, and this attack does 50 damage for each Pokémon you find there that has the Bug Out attack. Then, shuffle any revealed Pokémon back into your deck. Discard the other cards.";
const MAKE_WAVES = "Each player shuffles their hand into their deck and draws 4 cards.";
const BUBBLE_DRAIN = "Heal 30 damage from this Pokémon.";
const THUNDER_CLAD =
  "If you go first, you can use this attack during your first turn. Search your deck for an Energy card and attach it to this Pokémon. Then, shuffle your deck.";
const POWER_RUSH = "Flip a coin. If tails, during your next turn, this Pokémon can't use attacks.";
const CHAOS_CRAWLER =
  "During your opponent's next turn, prevent all damage from attacks done to this Pokémon. If 1 of your Pokémon used Chaos Crawler during your last turn, this attack can't be used.";
const LURE_OUT =
  "Reveal the top 5 cards of your opponent's deck. You may choose any number of Basic Pokémon you find there and put those Pokémon onto their Bench. Your opponent shuffles the other cards back into their deck.";
const OMINOUS_EYES = "Place 5 damage counters on 1 of your opponent's Pokémon.";

const COMBEE: Card = battler("me06-006", {
  name: "Combee",
  hp: 50,
  types: ["Grass"],
  retreat: 1,
  weaknesses: [{ type: "Fire", value: "×2" }],
  attacks: [
    { cost: ["Grass"], name: "Fade Out", damage: 10, effect: FADE_OUT },
    {
      cost: ["Colorless", "Colorless", "Colorless"],
      name: "Bug Out",
      damage: "50×",
      effect: BUG_OUT,
    },
  ],
});
const MANTINE: Card = battler("me06-025", {
  name: "Mantine",
  hp: 110,
  types: ["Water"],
  retreat: 1,
  weaknesses: [{ type: "Lightning", value: "×2" }],
  attacks: [
    { cost: ["Colorless"], name: "Make Waves", effect: MAKE_WAVES },
    { cost: ["Water", "Colorless"], name: "Bubble Drain", damage: 30, effect: BUBBLE_DRAIN },
  ],
});
const RAIKOU_EX: Card = battler("me06-033", {
  name: "Raikou ex",
  hp: 200,
  types: ["Lightning"],
  retreat: 0,
  weaknesses: [{ type: "Fighting", value: "×2" }],
  attacks: [
    { cost: ["Lightning"], name: "Thunder-Clad", effect: THUNDER_CLAD },
    {
      cost: ["Lightning", "Lightning", "Colorless"],
      name: "Power Rush",
      damage: 200,
      effect: POWER_RUSH,
    },
  ],
});
const GIRATINA: Card = battler("me06-045", {
  name: "Giratina",
  hp: 130,
  types: ["Psychic"],
  retreat: 3,
  weaknesses: [{ type: "Darkness", value: "×2" }],
  resistances: [{ type: "Fighting", value: "-30" }],
  attacks: [
    {
      cost: ["Psychic", "Psychic", "Colorless"],
      name: "Chaos Crawler",
      damage: 120,
      effect: CHAOS_CRAWLER,
    },
  ],
});
const SABLEYE: Card = battler("me06-060", {
  name: "Sableye",
  hp: 80,
  types: ["Darkness"],
  retreat: 1,
  weaknesses: [{ type: "Grass", value: "×2" }],
  attacks: [
    { cost: ["Darkness"], name: "Lure Out", effect: LURE_OUT },
    { cost: ["Darkness", "Colorless"], name: "Ominous Eyes", effect: OMINOUS_EYES },
  ],
});
const REPRINTS: readonly (readonly [string, Card])[] = [
  ["me06-121", RAIKOU_EX],
  ["me06-136", RAIKOU_EX],
];

const WALL = "b2-wall";
const BRUISER = "b2-bruiser";
const BUGGY = "b2-buggy";
const STAGE_ONE = "b2-stage-one";
const ITEM = "b2-item";

const LOCAL: Record<string, Card> = {
  [COMBEE.id]: COMBEE,
  [MANTINE.id]: MANTINE,
  [RAIKOU_EX.id]: RAIKOU_EX,
  [GIRATINA.id]: GIRATINA,
  [SABLEYE.id]: SABLEYE,
  [WALL]: battler(WALL, { name: "B2 Wall", hp: 400, types: ["Colorless"], retreat: 2 }),
  [BRUISER]: battler(BRUISER, {
    name: "B2 Bruiser",
    hp: 300,
    types: ["Colorless"],
    retreat: 2,
    attacks: [
      { cost: ["Colorless"], name: "Smash", damage: 60 },
      {
        cost: ["Colorless"],
        name: "Poison Smash",
        damage: 60,
        effect: "Your opponent's Active Pokémon is now Poisoned.",
      },
    ],
  }),
  [BUGGY]: battler(BUGGY, {
    name: "B2 Buggy",
    hp: 60,
    types: ["Grass"],
    attacks: [{ cost: ["Colorless"], name: "Bug Out", damage: "10×" }],
  }),
  [STAGE_ONE]: battler(STAGE_ONE, {
    name: "B2 Stage One",
    hp: 90,
    types: ["Darkness"],
    stage: "Stage1",
    evolveFrom: "B2 Wall",
  }),
  [ITEM]: battler(ITEM, { name: "B2 Plain", hp: 70, types: ["Colorless"] }),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [COMBEE.id]: 4,
  [MANTINE.id]: 1,
  [RAIKOU_EX.id]: 1,
  [GIRATINA.id]: 2,
  [SABLEYE.id]: 1,
  [WALL]: 17,
  [BRUISER]: 2,
  [BUGGY]: 2,
  [STAGE_ONE]: 2,
  [ITEM]: 2,
  "fix-grass-energy": 4,
  "fix-water-energy": 4,
  "fix-lightning-energy": 6,
  "fix-psychic-energy": 6,
  "fix-darkness-energy": 4,
  "fix-special": 2,
});
const KEEP = new Set(DECK.filter((id) => id !== WALL));

/** `first` goes first; with `passes` turns ended the board is on `seat`'s turn, both hands in the deck. */
function board(
  attacker: string,
  energy: readonly (readonly [string, number])[],
  opts: { first?: Seat; passes?: number } = {},
): GameState {
  const first = opts.first ?? "p2";
  const passes = opts.passes ?? 3;
  let state = driveSetup(0xb2, { p1: DECK, p2: DECK }, { pool: POOL, first });
  for (let i = 0; i < passes; i += 1) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = mustApply(state, { type: "endTurn", seat: state.phase.seat }).state;
  }
  for (const seat of ["p1", "p2"] as const) {
    const side = state.players[seat];
    state = patchSide(state, seat, { hand: [], deck: [...side.deck, ...side.hand] });
    state = unprize(state, seat, KEEP);
  }
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", WALL), "p2");
  for (const [id, n] of energy) state = attachFromDeck(state, "p1", id, n);
  return state;
}

/** TEST SURGERY: `seat`'s deck ends (bottom last) or starts with one copy each of `ids`. */
function stack(state: GameState, seat: Seat, ids: readonly string[], end: "top" | "bottom") {
  const side = state.players[seat];
  const taken: string[] = [];
  for (const id of ids) {
    const uid = side.deck.find((u) => state.cardIdByUid[u] === id && !taken.includes(u));
    if (uid === undefined) throw new Error(`${seat} has no more ${id} in the deck`);
    taken.push(uid);
  }
  const rest = side.deck.filter((u) => !taken.includes(u));
  return patchSide(state, seat, {
    deck: end === "top" ? [...taken, ...rest] : [...rest, ...taken],
  });
}

const attack = (index: number, seat: Seat = "p1"): GameAction => ({ type: "attack", seat, index });
const endTurn = (state: GameState, seat: Seat) => mustApply(state, { type: "endTurn", seat }).state;
const choose = (state: GameState, uids: readonly string[], seat: Seat = "p1") =>
  mustApply(state, { type: "resolveEffect", seat, choice: { kind: "cards", uids } } as GameAction);
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const ids = (state: GameState, uids: readonly string[]) =>
  uids.map((u) => state.cardIdByUid[u] as string);
const promptOf = (state: GameState) => {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected a park, got ${state.phase.kind}`);
  return state.phase.prompt;
};

describe("me06 B2: every printing leaves simulationGaps; only Combee's Fade Out is a registry row", () => {
  it("the seven printings have no gap; Combee's program keys Fade Out alone, and the others have none", () => {
    for (const card of [COMBEE, MANTINE, RAIKOU_EX, GIRATINA, SABLEYE]) {
      expect(simulationGaps(card), card.id).toEqual([]);
    }
    for (const card of [MANTINE, RAIKOU_EX, GIRATINA, SABLEYE]) {
      expect(programFor(card.id), card.id).toBeUndefined();
    }
    expect(programFor(COMBEE.id)).toEqual({ attack: { 0: [{ op: "returnSelf", dest: "hand" }] } });
    for (const [id, face] of REPRINTS) {
      expect(simulationGaps({ ...face, id }), id).toEqual([]);
    }
  });

  it("Bug Out still plays through its reader, and Fade Out's sentence stays with the registry", () => {
    expect(deriveAttackEffect(BUG_OUT)).toEqual([
      {
        op: "revealDeckBottomCount",
        n: 7,
        filter: { kind: "attackNamePokemon", attack: "Bug Out" },
        recordAs: "revealed",
      },
      { op: "damageDefender", per: 50, count: "revealed" },
    ]);
    expect(deriveAttackEffect(FADE_OUT)).toBeNull();
  });

  it("each sentence derives to its reader's shape", () => {
    expect(deriveAttackEffect(MAKE_WAVES)).toEqual([
      { op: "handRefresh", who: "both", draw: { kind: "fixed", count: 4 } },
    ]);
    expect(timingGateFromAttackText(THUNDER_CLAD)).toEqual({ kind: "firstTurnExempt" });
    expect(
      deriveAttackEffect(
        "Search your deck for an Energy card and attach it to this Pokémon. Then, shuffle your deck.",
      ),
    ).toEqual([
      { op: "attachFromDeck", filter: { kind: "anyEnergy" }, max: 1, toSelf: true },
      { op: "shuffleDeck" },
    ]);
    expect(timingGateFromAttackText(CHAOS_CRAWLER)).toEqual({
      kind: "barredIf",
      condition: { kind: "yourPokemonUsedAttackLastTurn", attack: "Chaos Crawler" },
    });
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, prevent all damage from attacks done to this Pokémon.",
      ),
    ).toEqual([{ op: "preventDamage" }]);
    expect(deriveAttackEffect(LURE_OUT)).toEqual([
      {
        op: "lookAtTopN",
        n: 5,
        filter: { kind: "basicPokemon" },
        max: "any",
        dest: "bench",
        reveal: true,
        whose: "opponent",
      },
      { op: "shuffleDeck", whose: "opponent" },
    ]);
  });

  it("a neighbouring sentence stays loud", () => {
    expect(deriveAttackEffect(MAKE_WAVES.replace("Each player", "Each of you"))).toBeNull();
    expect(deriveAttackEffect(MAKE_WAVES.replace("4 cards", "0 cards"))).toBeNull();
    expect(
      timingGateFromAttackText(CHAOS_CRAWLER.replace(/Chaos Crawler during/, "Shadow Claw during")),
    ).toBeUndefined();
    expect(deriveAttackEffect(LURE_OUT.replace("top 5", "top 0"))).toBeNull();
    expect(deriveAttackEffect(LURE_OUT.replace("Basic Pokémon", "Pokémon"))).toBeNull();
  });
});

const SELF: { seat: Seat; spot: { spot: "active" } } = { seat: "p1", spot: { spot: "active" } };
const attachTo = (state: GameState, uid: string | undefined, seat: Seat = "p1") =>
  mustApply(state, {
    type: "resolveEffect",
    seat,
    choice: { kind: "attachCards", assignments: uid === undefined ? [] : [{ uid, to: SELF }] },
  } as GameAction);
const deckUid = (state: GameState, seat: Seat, id: string) => {
  const uid = state.players[seat].deck.find((u) => state.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`${seat} has no ${id} in the deck`);
  return uid;
};

describe("Combee me06-006 Fade Out", () => {
  it("10 damage, then Combee and every attached card go to the hand, and the Bench is promoted", () => {
    const state = benchFromDeck(board(COMBEE.id, [["fix-grass-energy", 1]]), "p1", WALL);
    const combee = state.players.p1.active;
    const out = mustApply(state, attack(0));
    expect(out.state.players.p2.active?.damage).toBe(10);
    expect([...out.state.players.p1.hand].sort()).toEqual(
      [...(combee?.stack ?? []), ...(combee?.energy ?? [])].sort(),
    );
    expect(ids(out.state, out.state.players.p1.active?.stack ?? [])).toEqual([WALL]);
    expect(out.state.players.p1.discard).toEqual(state.players.p1.discard);
  });

  it("with an empty Bench, Combee still leaves and its player has no Pokémon in play", () => {
    const out = mustApply(board(COMBEE.id, [["fix-grass-energy", 1]]), attack(0));
    expect(out.state.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "win", winner: "p2", reason: "noPokemon" },
    });
  });

  it("the 10 that Knocks Out the Defending Pokémon takes a Prize; both sides promote, and with both Benches empty the game is a tie", () => {
    let state = benchFromDeck(board(COMBEE.id, [["fix-grass-energy", 1]]), "p1", WALL);
    state = setDamage(benchFromDeck(state, "p2", WALL), "p2", 390);
    const owed = mustApply(state, attack(0)).state;
    expect(owed.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    const out = mustApply(owed, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(out.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(ids(out.state, out.state.players.p1.active?.stack ?? [])).toEqual([WALL]);
    expect(ids(out.state, out.state.players.p2.active?.stack ?? [])).toEqual([WALL]);
    expect(out.state.players.p1.hand).toHaveLength(2 + 1);

    const bare = setDamage(board(COMBEE.id, [["fix-grass-energy", 1]]), "p2", 390);
    const last = mustApply(bare, attack(0)).state;
    const tie = mustApply(last, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(tie.state.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "tie", reasons: { p1: "noPokemon", p2: "noPokemon" } },
    });
  });

  it("is refused without a {G}", () => {
    expectErr(board(COMBEE.id, [["fix-water-energy", 1]]), attack(0), "ATTACK_COST_UNMET");
  });
});

describe("Combee me06-006 Bug Out", () => {
  const WINDOW = [
    COMBEE.id,
    "fix-grass-energy",
    BUGGY,
    ITEM,
    "fix-special",
    COMBEE.id,
    "fix-water-energy",
  ];

  it("50 for each Pokémon with the Bug Out attack in the bottom 7; revealed Pokémon shuffle back, the rest is discarded", () => {
    const state = stack(board(COMBEE.id, [["fix-grass-energy", 3]]), "p1", WINDOW, "bottom");
    const window = state.players.p1.deck.slice(-7);
    const out = mustApply(state, attack(1));
    expect(out.state.players.p2.active?.damage).toBe(150);
    const discarded = out.state.players.p1.discard.slice(state.players.p1.discard.length);
    expect(ids(out.state, discarded).sort()).toEqual(
      ["fix-grass-energy", "fix-special", "fix-water-energy"].sort(),
    );
    for (const uid of window.filter((u) => !discarded.includes(u))) {
      expect(out.state.players.p1.deck).toContain(uid);
    }
    expect(out.state.players.p1.deck).toHaveLength(state.players.p1.deck.length - 3);
    expect(of(out.events, "DECK_TOP_REVEALED")[0]?.uids).toEqual(window);
  });

  it("no Bug Out Pokémon there: no damage, and every non-Pokémon is still discarded", () => {
    const energies = ["fix-psychic-energy", "fix-darkness-energy", "fix-water-energy"];
    const state = stack(
      board(COMBEE.id, [["fix-grass-energy", 3]]),
      "p1",
      [...energies, WALL, ...energies],
      "bottom",
    );
    const out = mustApply(state, attack(1));
    expect(out.state.players.p2.active?.damage).toBe(0);
    expect(out.state.players.p1.discard).toHaveLength(state.players.p1.discard.length + 6);
  });

  it("is refused with two Energy", () => {
    expectErr(board(COMBEE.id, [["fix-grass-energy", 2]]), attack(1), "ATTACK_COST_UNMET");
  });
});

describe("Mantine me06-025 Make Waves and Bubble Drain", () => {
  it("Make Waves: each player shuffles their hand into their deck and draws 4 (p2 then draws for their turn)", () => {
    let state = board(MANTINE.id, [["fix-water-energy", 1]]);
    state = handFromDeck(state, "p1", WALL, 2);
    state = handFromDeck(state, "p2", WALL, 6);
    const sizes = (s: GameState, seat: Seat) =>
      s.players[seat].hand.length + s.players[seat].deck.length;
    const out = mustApply(state, attack(0));
    expect(out.state.players.p1.hand).toHaveLength(4);
    expect(out.state.players.p2.hand).toHaveLength(4 + 1);
    for (const seat of ["p1", "p2"] as const) {
      expect(sizes(out.state, seat), seat).toBe(sizes(state, seat));
    }
    expect(out.state.players.p2.active?.damage).toBe(0);
  });

  it("Make Waves with fewer than 4 cards to draw draws what is there, and p2's empty deck then loses at their draw", () => {
    let state = board(MANTINE.id, [["fix-water-energy", 1]]);
    state = patchSide(state, "p1", { deck: state.players.p1.deck.slice(0, 2) });
    const p2 = state.players.p2.deck;
    state = patchSide(state, "p2", { hand: p2.slice(0, 1), deck: p2.slice(1, 4) });
    const out = mustApply(state, attack(0));
    expect(out.state.players.p1.hand).toHaveLength(2);
    expect(out.state.players.p1.deck).toEqual([]);
    expect(out.state.players.p2.hand).toHaveLength(4);
    expect(out.state.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "win", winner: "p1", reason: "deckOut" },
    });
  });

  it("Make Waves with empty hands still draws 4 each", () => {
    const out = mustApply(board(MANTINE.id, [["fix-water-energy", 1]]), attack(0));
    expect(out.state.players.p1.hand).toHaveLength(4);
    expect(out.state.players.p2.hand).toHaveLength(4 + 1);
  });

  it("Bubble Drain: 30 damage and heals 30 from Mantine", () => {
    const state = setDamage(board(MANTINE.id, [["fix-water-energy", 2]]), "p1", 50);
    const out = mustApply(state, attack(1));
    expect(out.state.players.p2.active?.damage).toBe(30);
    expect(out.state.players.p1.active?.damage).toBe(20);
  });

  it("Bubble Drain is refused without a {W}", () => {
    expectErr(board(MANTINE.id, [["fix-grass-energy", 2]]), attack(1), "ATTACK_COST_UNMET");
  });
});

describe("Raikou ex me06-033 Thunder-Clad and Power Rush", () => {
  const firstTurn = (
    energy: readonly (readonly [string, number])[] = [["fix-lightning-energy", 1]],
  ) => board(RAIKOU_EX.id, energy, { first: "p1", passes: 0 });

  it("going first, Thunder-Clad is usable on turn 1; reading: the bare noun an Energy card admits a Special Energy; it lands on Raikou ex, then a shuffle, and the park round-trips", () => {
    const state = firstTurn();
    expect(state.turn).toBe(1);
    const parked = roundTrip(mustApply(state, attack(0)).state);
    const prompt = promptOf(parked);
    expect(prompt.kind).toBe("attachCards");
    if (prompt.kind !== "attachCards") return;
    expect(prompt.targets).toEqual([SELF]);
    expect(prompt.max).toBe(1);
    const special = deckUid(parked, "p1", "fix-special");
    const out = attachTo(parked, special);
    expect(out.state.players.p1.active?.energy).toContain(special);
    expect(out.state.players.p1.deck).not.toContain(special);
    expect(of(out.events, "SHUFFLE")).toEqual([{ type: "SHUFFLE", seat: "p1" }]);
  });

  it("a Basic Energy of another type can be chosen too, and the search may find nothing", () => {
    const parked = mustApply(firstTurn(), attack(0)).state;
    const psychic = deckUid(parked, "p1", "fix-psychic-energy");
    expect(attachTo(parked, psychic).state.players.p1.active?.energy).toContain(psychic);
    const whiff = attachTo(parked, undefined);
    expect(whiff.state.players.p1.active?.energy).toHaveLength(1);
    expect(of(whiff.events, "SHUFFLE")).toEqual([{ type: "SHUFFLE", seat: "p1" }]);
  });

  it("refuses a non-Energy card, and the opponent answering", () => {
    const parked = mustApply(firstTurn(), attack(0)).state;
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "attachCards",
          assignments: [{ uid: deckUid(parked, "p1", WALL), to: SELF }],
        },
      } as GameAction,
      "BAD_EFFECT_CHOICE",
    );
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p2",
        choice: { kind: "attachCards", assignments: [] },
      } as GameAction,
      "WRONG_SEAT",
    );
  });

  it("the licence is Thunder-Clad's alone: Power Rush on turn 1 is still the first-turn ban", () => {
    const state = firstTurn([["fix-lightning-energy", 3]]);
    expectErr(state, attack(1), "FIRST_TURN_ATTACK");
  });

  it("Power Rush heads: 200, and Raikou ex attacks on the next turn", () => {
    const state = withFaces(board(RAIKOU_EX.id, [["fix-lightning-energy", 3]]), ["heads"]);
    const out = mustApply(state, attack(1));
    expect(out.state.players.p2.active?.damage).toBe(200);
    const next = endTurn(out.state, "p2");
    expect(mustApply(next, attack(0)).state.phase.kind).toBe("effect:choose");
  });

  it("Power Rush tails: 200, Raikou ex can't attack during the next turn, and can the turn after", () => {
    const state = withFaces(board(RAIKOU_EX.id, [["fix-lightning-energy", 3]]), ["tails"]);
    const out = mustApply(state, attack(1));
    expect(out.state.players.p2.active?.damage).toBe(200);
    const next = endTurn(out.state, "p2");
    expectErr(next, attack(0), "ATTACK_PREVENTED");
    expectErr(next, attack(1), "ATTACK_PREVENTED");
    const later = endTurn(endTurn(next, "p1"), "p2");
    expect(mustApply(later, attack(0)).state.phase.kind).toBe("effect:choose");
  });
});

describe("Giratina me06-045 Chaos Crawler", () => {
  const PPC: readonly (readonly [string, number])[] = [["fix-psychic-energy", 3]];
  /** p1's Giratina against p2's Bruiser, which has a {C} to attack with. */
  const giratina = () => {
    let state = board(GIRATINA.id, PPC);
    state = clearBench(setActiveFromDeck(state, "p2", BRUISER), "p2");
    return attachFromDeck(state, "p2", "fix-water-energy", 1);
  };
  const crawled = () => {
    const out = mustApply(giratina(), attack(0));
    expect(out.state.players.p2.active?.damage).toBe(120);
    return out.state;
  };

  it("120, and during the opponent's next turn their attack does no damage to Giratina", () => {
    const out = mustApply(crawled(), attack(0, "p2"));
    expect(out.state.players.p1.active?.damage).toBe(0);
  });

  it("reading: only damage is prevented, so the attack's effect still lands (Poisoned, then the Checkup's counter)", () => {
    const out = mustApply(crawled(), attack(1, "p2"));
    expect(of(out.events, "STATUS_APPLIED")).toHaveLength(1);
    expect(out.state.players.p1.active?.conditions.poisonDamage).toBe(10);
    expect(out.state.players.p1.active?.damage).toBe(10);
  });

  it("the protection lasts that one turn: the opponent's attack the turn after does its damage", () => {
    let state = mustApply(crawled(), attack(0, "p2")).state;
    state = endTurn(state, "p1");
    expect(mustApply(state, attack(0, "p2")).state.players.p1.active?.damage).toBe(60);
  });

  it("can't be used on the turn after it was used, and can again once a turn passes without it", () => {
    const next = endTurn(crawled(), "p2");
    expectErr(next, attack(0), "ATTACK_PREVENTED");
    const later = endTurn(endTurn(next, "p1"), "p2");
    expect(mustApply(later, attack(0)).state.players.p2.active?.damage).toBe(240);
  });

  it("the Giratina that used it bars another Giratina from the Bench; reading: once that body has left play the clause no longer holds (the record is on the body, as for Angelite)", () => {
    let state = benchFromDeck(giratina(), "p1", GIRATINA.id);
    state = mustApply(state, attack(0)).state;
    state = endTurn(state, "p2");
    const side = state.players.p1;
    const [benched] = side.bench;
    if (side.active === null || benched === undefined) throw new Error("expected two Giratina");
    state = patchSide(state, "p1", {
      active: { ...benched, energy: side.active.energy },
      bench: [{ ...side.active, energy: [] }],
    });
    expectErr(state, attack(0), "ATTACK_PREVENTED");
    const alone = patchSide(state, "p1", { bench: [] });
    expect(mustApply(alone, attack(0)).state.players.p2.active?.damage).toBe(240);
  });

  it("is refused with one {P}", () => {
    expectErr(
      board(GIRATINA.id, [
        ["fix-psychic-energy", 1],
        ["fix-water-energy", 2],
      ]),
      attack(0),
      "ATTACK_COST_UNMET",
    );
  });
});

describe("Sableye me06-060 Lure Out and Ominous Eyes", () => {
  const TOP = [WALL, "fix-darkness-energy", BUGGY, STAGE_ONE, ITEM];
  const lure = (benched = 0) => {
    let state = board(SABLEYE.id, [["fix-darkness-energy", 1]]);
    for (let i = 0; i < benched; i += 1) state = benchFromDeck(state, "p2", WALL);
    return stack(state, "p2", TOP, "top");
  };

  it("reveals p2's top 5, offers only its Basic Pokémon, and the park round-trips", () => {
    const state = lure();
    const window = state.players.p2.deck.slice(0, 5);
    const out = mustApply(state, attack(0));
    const parked = roundTrip(out.state);
    const prompt = promptOf(parked);
    expect(prompt.kind).toBe("chooseCards");
    if (prompt.kind !== "chooseCards") return;
    expect(ids(parked, prompt.candidates).sort()).toEqual([WALL, BUGGY, ITEM].sort());
    expect(prompt.min).toBe(0);
    expect(window).toHaveLength(5);
  });

  it("the chosen Basics go onto p2's Bench, and p2's deck is shuffled with the rest (p2 then draws for their turn)", () => {
    const state = lure();
    const [wall, , buggy] = state.players.p2.deck;
    const parked = mustApply(state, attack(0)).state;
    const out = choose(parked, [wall as string, buggy as string]);
    expect(out.state.players.p2.bench.map((b) => b.stack[0])).toEqual([wall, buggy]);
    expect(out.state.players.p2.deck).toHaveLength(state.players.p2.deck.length - 2 - 1);
    expect(of(out.events, "SHUFFLE")).toContainEqual({ type: "SHUFFLE", seat: "p2" });
    expect(out.state.players.p2.active?.damage).toBe(0);
  });

  it("choosing none still shuffles p2's deck", () => {
    const parked = mustApply(lure(), attack(0)).state;
    const out = choose(parked, []);
    expect(out.state.players.p2.bench).toEqual([]);
    expect(of(out.events, "SHUFFLE")).toContainEqual({ type: "SHUFFLE", seat: "p2" });
  });

  it("with p2's Bench full the look is still announced, nothing is asked, and p2's deck is shuffled", () => {
    let state = board(SABLEYE.id, [["fix-darkness-energy", 1]]);
    for (let i = 0; i < 5; i += 1) state = benchFromDeck(state, "p2", WALL);
    state = stack(state, "p2", TOP, "top");
    const out = mustApply(state, attack(0));
    expect(out.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(of(out.events, "DECK_TOP_REVEALED")).toEqual([
      { type: "DECK_TOP_REVEALED", seat: "p2", uids: [], dest: "bench", reveal: true, actor: "p1" },
    ]);
    expect(of(out.events, "SHUFFLE")).toContainEqual({ type: "SHUFFLE", seat: "p2" });
    expect(out.state.players.p2.bench).toHaveLength(5);
  });

  it("p2's Bench room caps the take: with 4 Benched only 1 fits", () => {
    const parked = mustApply(lure(4), attack(0)).state;
    const prompt = promptOf(parked);
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(prompt.max).toBe(1);
  });

  it("refuses the Stage 1, a card below the top 5, two over the Bench room, and p2 answering", () => {
    const state = lure();
    const parked = mustApply(state, attack(0)).state;
    const stageOne = state.players.p2.deck[3] as string;
    const deeper = state.players.p2.deck.slice(5).find((u) => state.cardIdByUid[u] === WALL);
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [stageOne] },
      } as GameAction,
      "BAD_EFFECT_CHOICE",
    );
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [deeper as string] },
      } as GameAction,
      "BAD_EFFECT_CHOICE",
    );
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p2", choice: { kind: "cards", uids: [] } } as GameAction,
      "WRONG_SEAT",
    );
    const full = mustApply(lure(4), attack(0)).state;
    const [wall, , buggy] = full.players.p2.deck;
    expectErr(
      full,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [wall as string, buggy as string] },
      } as GameAction,
      "BAD_EFFECT_CHOICE",
    );
  });

  it("Ominous Eyes places 5 damage counters on the chosen opponent's Pokémon, Benched included", () => {
    let state = board(SABLEYE.id, [["fix-darkness-energy", 2]]);
    state = benchFromDeck(state, "p2", ITEM);
    const parked = mustApply(state, attack(1)).state;
    const prompt = promptOf(parked);
    expect(prompt.kind).toBe("choosePokemonMulti");
    const out = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "bench", index: 0 } }] },
    } as GameAction);
    expect(out.state.players.p2.bench[0]?.damage).toBe(50);
    expect(out.state.players.p2.active?.damage).toBe(0);
  });

  it("Lure Out is refused without a {D}", () => {
    expectErr(board(SABLEYE.id, [["fix-water-energy", 1]]), attack(0), "ATTACK_COST_UNMET");
  });
});
