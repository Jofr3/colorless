import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameEvent, GameState, PokemonRef, Seat } from "./index";
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
  effectPrompt,
  ensureInDeck,
  expectErr,
  handFromDeck,
  mustApply,
  patchSide,
  roundTrip,
  setActiveFromDeck,
  setDamage,
  specialEnergy,
  typedEnergy,
  unprize,
  withFaces,
} from "./testFixtures";

const SLIPPERY_OIL =
  "Once during your turn, you may use this Ability. Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)";
const MEGA_DRAIN = "Heal 30 damage from this Pokémon.";
const BUDDY_BOOST =
  "Once during your turn, you may use this Ability. Attach a Basic {R} Energy card, a Basic {L} Energy card, or 1 of each from your hand to your Electivire and Magmortar in any way you like.";
const DEEP_SEA_DRAW =
  "Once during your turn, you may use this Ability.\t\tDraw a card. If you do, you may put a card from your hand on the bottom of your deck.";
const OCEANIC_GAIN =
  "Once during your turn, if this Pokémon is in the Active Spot, you may use this Ability. Heal 50 damage from this Pokémon.";
const GENERATORS_TOUCH =
  "Once during your turn, you may use this Ability. Attach a Basic {L} Energy card from your discard pile to 1 of your Pokémon.";
const MATERNAL_CALL =
  "Once during your turn, you may use this Ability. Flip a coin. If heads, switch in 1 of your opponent's Benched Pokémon to the Active Spot.";
const GIGA_IMPACT = "During your next turn, this Pokémon can't use attacks.";
const BEAT_SCALES =
  "Once during your turn, you may use this Ability. Look at the top 6 cards of your deck and attach any number of Basic Energy cards you find there to your {N} Pokémon in any way you like. Shuffle the other cards back into your deck.";
const ENERGIZING_PRESENT =
  "Once during your turn, if this Pokémon is in the Active Spot, you may use this Ability. Look at the top 6 cards of your deck, reveal an Energy card you find there, and put it into your hand. Shuffle the other cards and put them on the bottom of your deck.";

const ARBOLIVA: Card = battler("me06-017", {
  name: "Arboliva",
  stage: "Stage2",
  hp: 150,
  types: ["Grass"],
  retreat: 2,
  weaknesses: [{ type: "Fire", value: "×2" }],
  abilities: [{ type: "Ability", name: "Slippery Oil", effect: SLIPPERY_OIL }],
  attacks: [{ cost: ["Grass", "Colorless"], name: "Mega Drain", damage: 100, effect: MEGA_DRAIN }],
});
const MAGMORTAR: Card = battler("me06-021", {
  name: "Magmortar",
  stage: "Stage1",
  hp: 140,
  types: ["Fire"],
  retreat: 3,
  weaknesses: [{ type: "Water", value: "×2" }],
  abilities: [{ type: "Ability", name: "Buddy Boost", effect: BUDDY_BOOST }],
  attacks: [{ cost: ["Fire", "Fire", "Colorless"], name: "Heat Crash", damage: 80 }],
});
const JELLICENT: Card = battler("me06-028", {
  name: "Jellicent",
  stage: "Stage1",
  hp: 120,
  types: ["Water"],
  retreat: 2,
  weaknesses: [{ type: "Lightning", value: "×2" }],
  abilities: [{ type: "Ability", name: "Deep Sea Draw", effect: DEEP_SEA_DRAW }],
  attacks: [{ cost: ["Water", "Colorless", "Colorless"], name: "Gentle Slap", damage: 100 }],
});
const WISHIWASHI: Card = battler("me06-029", {
  name: "Wishiwashi ex",
  hp: 260,
  types: ["Water"],
  retreat: 3,
  weaknesses: [{ type: "Lightning", value: "×2" }],
  abilities: [{ type: "Ability", name: "Oceanic Gain", effect: OCEANIC_GAIN }],
  attacks: [{ cost: ["Water", "Water", "Water", "Colorless"], name: "Hydro Splash", damage: 220 }],
});
const PAWMOT: Card = battler("me06-039", {
  name: "Pawmot",
  stage: "Stage2",
  hp: 150,
  types: ["Lightning"],
  retreat: 1,
  weaknesses: [{ type: "Fighting", value: "×2" }],
  abilities: [{ type: "Ability", name: "Generator's Touch", effect: GENERATORS_TOUCH }],
  attacks: [{ cost: ["Lightning", "Colorless"], name: "Electric Punch", damage: 100 }],
});
const NIDOQUEEN: Card = battler("me06-057", {
  name: "Nidoqueen",
  stage: "Stage2",
  hp: 170,
  types: ["Darkness"],
  retreat: 3,
  weaknesses: [{ type: "Fighting", value: "×2" }],
  abilities: [{ type: "Ability", name: "Maternal Call", effect: MATERNAL_CALL }],
  attacks: [
    {
      cost: ["Darkness", "Colorless", "Colorless"],
      name: "Giga Impact",
      damage: 150,
      effect: GIGA_IMPACT,
    },
  ],
});
const KOMMO_O: Card = battler("me06-075", {
  name: "Kommo-o",
  stage: "Stage2",
  hp: 160,
  types: ["Dragon"],
  retreat: 2,
  abilities: [{ type: "Ability", name: "Beat Scales", effect: BEAT_SCALES }],
  attacks: [{ cost: ["Lightning", "Fighting", "Colorless"], name: "Hammer In", damage: 170 }],
});
const DELIBIRD: Card = battler("me06-079", {
  name: "Delibird",
  hp: 90,
  types: ["Colorless"],
  retreat: 1,
  weaknesses: [{ type: "Lightning", value: "×2" }],
  resistances: [{ type: "Fighting", value: "-30" }],
  abilities: [{ type: "Ability", name: "Energizing Present", effect: ENERGIZING_PRESENT }],
  attacks: [{ cost: ["Colorless"], name: "Beat", damage: 10 }],
});
const FACES = [ARBOLIVA, MAGMORTAR, JELLICENT, WISHIWASHI, PAWMOT, NIDOQUEEN, KOMMO_O, DELIBIRD];
const REPRINTS: readonly (readonly [string, Card])[] = [
  ["me06-107", MAGMORTAR],
  ["me06-120", WISHIWASHI],
];

const WALL = "b4-wall";
const ELECTIVIRE = "b4-electivire";
const ELECTIVIRE_EX = "b4-electivire-ex";
const DRAGON = "b4-dragon";
const FIRE = "b4-fire";
const LIGHTNING = "b4-lightning";
const WATER = "b4-water";
const SPECIAL = "b4-special";

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(FACES.map((card) => [card.id, card])),
  [WALL]: battler(WALL, {
    name: "B4 Wall",
    hp: 400,
    types: ["Colorless"],
    retreat: 2,
    attacks: [{ cost: ["Colorless"], name: "Smash", damage: 60 }],
  }),
  [ELECTIVIRE]: battler(ELECTIVIRE, { name: "Electivire", hp: 140, types: ["Lightning"] }),
  [ELECTIVIRE_EX]: battler(ELECTIVIRE_EX, { name: "Electivire ex", hp: 260, types: ["Lightning"] }),
  [DRAGON]: battler(DRAGON, { name: "B4 Dragon", hp: 120, types: ["Dragon"] }),
  [FIRE]: typedEnergy(FIRE, "Fire"),
  [LIGHTNING]: typedEnergy(LIGHTNING, "Lightning"),
  [WATER]: typedEnergy(WATER, "Water"),
  [SPECIAL]: specialEnergy(SPECIAL, "B4 Special Energy"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [ARBOLIVA.id]: 1,
  [MAGMORTAR.id]: 2,
  [JELLICENT.id]: 1,
  [WISHIWASHI.id]: 1,
  [PAWMOT.id]: 1,
  [NIDOQUEEN.id]: 1,
  [KOMMO_O.id]: 1,
  [DELIBIRD.id]: 1,
  [WALL]: 21,
  [ELECTIVIRE]: 1,
  [ELECTIVIRE_EX]: 1,
  [DRAGON]: 1,
  [FIRE]: 6,
  [LIGHTNING]: 6,
  [WATER]: 6,
  [SPECIAL]: 2,
  "fix-grass-energy": 2,
  "fix-dark-energy": 2,
  "fix-fighting-energy": 2,
  "fix-energy": 1,
});
const KEEP = new Set(DECK.filter((id) => id !== WALL));

/** p1 to act, on a turn that is not the first; both hands in the deck, both Benches empty. */
function board(active: string, defender: string = WALL): GameState {
  let state = driveSetup(0xb4, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
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

const ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const benchRef = (index: number, seat: Seat = "p1"): PokemonRef => ({
  seat,
  spot: { spot: "bench", index },
});
const use = (abilityName: string, index?: number): GameAction => ({
  type: "useAbility",
  seat: "p1",
  target: index === undefined ? { spot: "active" } : { spot: "bench", index },
  abilityName,
});
const resolve = (choice: unknown, seat: Seat = "p1"): GameAction =>
  ({ type: "resolveEffect", seat, choice }) as GameAction;
const attack = (index = 0, seat: Seat = "p1"): GameAction => ({ type: "attack", seat, index });
const ids = (state: GameState, uids: readonly string[]) =>
  uids.map((u) => state.cardIdByUid[u] as string);
const bodyAt = (state: GameState, ref: PokemonRef) => {
  const side = state.players[ref.seat];
  const body = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  if (body === null || body === undefined) throw new Error("no body there");
  return body;
};
const energyOn = (state: GameState, ref: PokemonRef) => ids(state, bodyAt(state, ref).energy);
const topOf = (state: GameState, ref: PokemonRef) => ids(state, bodyAt(state, ref).stack).at(-1);
const used = (events: readonly GameEvent[]) => events.filter((e) => e.type === "ABILITY_USED");

/** Puts one deck copy of each id on top of `seat`'s deck, in the order given (first on top). */
function stackTop(state: GameState, seat: Seat, top: readonly string[]): GameState {
  let seated = state;
  for (const id of top) seated = ensureInDeck(seated, seat, id);
  const deck = [...seated.players[seat].deck];
  const picked = top.map((id) => {
    const at = deck.findIndex((u) => seated.cardIdByUid[u] === id);
    if (at < 0) throw new Error(`${seat} has no spare ${id} in the deck`);
    return deck.splice(at, 1)[0] as string;
  });
  return patchSide(seated, seat, { deck: [...picked, ...deck] });
}

function hand(state: GameState, cards: readonly string[]): GameState {
  let out = state;
  for (const id of cards) out = handFromDeck(ensureInDeck(out, "p1", id), "p1", id, 1);
  return out;
}

describe("me06 B4: every printing leaves simulationGaps on its program", () => {
  it("the ten printings have no gap, and each program is its Ability's", () => {
    for (const card of FACES) expect(simulationGaps(card), card.id).toEqual([]);
    for (const [id, face] of REPRINTS) {
      expect(simulationGaps({ ...face, id }), id).toEqual([]);
      expect(programFor(id), id).toBe(programFor(face.id));
    }
    expect(programFor(ARBOLIVA.id)?.abilities?.[0]).toEqual({
      name: "Slippery Oil",
      oncePerTurn: true,
      activeOnly: false,
      program: [{ op: "opponentSwitchOut" }],
    });
    expect(programFor(WISHIWASHI.id)?.abilities?.[0]).toMatchObject({ activeOnly: true });
    expect(programFor(DELIBIRD.id)?.abilities?.[0]).toMatchObject({ activeOnly: true });
    for (const card of [MAGMORTAR, JELLICENT, PAWMOT, NIDOQUEEN, KOMMO_O]) {
      expect(programFor(card.id)?.abilities?.[0], card.id).toMatchObject({
        oncePerTurn: true,
        activeOnly: false,
      });
    }
  });
});

describe("Arboliva me06-017 Slippery Oil", () => {
  it("from the Bench, the opponent chooses the new Active and the old one goes to the Bench", () => {
    const state = bench(bench(board(WALL), "p1", [ARBOLIVA.id]), "p2", [ELECTIVIRE, DRAGON]);
    const parked = mustApply(state, use("Slippery Oil", 0));
    expect(parked.state.phase).toMatchObject({ kind: "effect:choose", answerer: "p2" });
    expect(effectPrompt(parked.state)).toMatchObject({
      kind: "choosePokemon",
      candidates: [benchRef(0, "p2"), benchRef(1, "p2")],
    });
    const restored = roundTrip(parked.state);
    expectErr(restored, resolve({ kind: "pokemon", ref: benchRef(1, "p2") }), "WRONG_SEAT");
    const done = mustApply(restored, resolve({ kind: "pokemon", ref: benchRef(1, "p2") }, "p2"));
    expect(topOf(done.state, { seat: "p2", spot: { spot: "active" } })).toBe(DRAGON);
    expect(done.state.players.p2.bench.map((b) => ids(done.state, b.stack).at(-1)).sort()).toEqual(
      [ELECTIVIRE, WALL].sort(),
    );
    expectErr(done.state, use("Slippery Oil", 0), "ABILITY_ALREADY_USED");
  });

  it("one Benched Pokémon is switched in without a question; reading: an empty Bench refuses the Ability (Repel's gate)", () => {
    const one = mustApply(bench(board(ARBOLIVA.id), "p2", [DRAGON]), use("Slippery Oil"));
    expect(one.state.phase.kind).toBe("turn:action");
    expect(topOf(one.state, { seat: "p2", spot: { spot: "active" } })).toBe(DRAGON);
    expectErr(board(ARBOLIVA.id), use("Slippery Oil"), "NO_LEGAL_TARGET");
  });

  it("Mega Drain does 100 and heals 30 from Arboliva", () => {
    const state = setDamage(
      attachFromDeck(board(ARBOLIVA.id), "p1", "fix-grass-energy", 2),
      "p1",
      50,
    );
    const out = mustApply(state, attack());
    expect(out.state.players.p2.active?.damage).toBe(100);
    expect(out.state.players.p1.active?.damage).toBe(20);
  });
});

describe("Magmortar me06-021 / -107 Buddy Boost", () => {
  const boosted = () =>
    hand(bench(board(MAGMORTAR.id), "p1", [ELECTIVIRE, ELECTIVIRE_EX, DRAGON]), [FIRE, LIGHTNING]);

  it("reading: the names are exact, so only Electivire and Magmortar are offered (not Electivire ex); 1 of each goes where you like", () => {
    const parked = mustApply(boosted(), use("Buddy Boost"));
    expect(effectPrompt(parked.state)).toEqual({
      kind: "choosePokemon",
      candidates: [ACTIVE, benchRef(0)],
      upTo: 1,
      note: "Attach the Energy to which of your Electivire and Magmortar?",
    });
    const second = mustApply(
      roundTrip(parked.state),
      resolve({ kind: "pokemon", ref: benchRef(0) }),
    );
    expect(effectPrompt(second.state)).toMatchObject({ candidates: [ACTIVE, benchRef(0)] });
    expectErr(second.state, resolve({ kind: "pokemon", ref: benchRef(1) }), "BAD_EFFECT_CHOICE");
    const done = mustApply(second.state, resolve({ kind: "pokemon", ref: ACTIVE }));
    expect(energyOn(done.state, benchRef(0))).toEqual([FIRE]);
    expect(energyOn(done.state, ACTIVE)).toEqual([LIGHTNING]);
    expect(done.state.players.p1.hand).toEqual([]);
    expectErr(done.state, use("Buddy Boost"), "ABILITY_ALREADY_USED");
  });

  it("the {R} may be declined for the {L} alone, which is then owed", () => {
    const parked = mustApply(boosted(), use("Buddy Boost"));
    const declined = mustApply(parked.state, resolve({ kind: "pokemon" }));
    expect(effectPrompt(declined.state)).not.toHaveProperty("upTo");
    expectErr(declined.state, resolve({ kind: "pokemon" }), "BAD_EFFECT_CHOICE");
    const done = mustApply(declined.state, resolve({ kind: "pokemon", ref: benchRef(0) }));
    expect(energyOn(done.state, benchRef(0))).toEqual([LIGHTNING]);
    expect(ids(done.state, done.state.players.p1.hand)).toEqual([FIRE]);
  });

  it("both onto one body, and from the Bench onto the Bench copy itself", () => {
    const state = hand(bench(board(WALL), "p1", [MAGMORTAR.id]), [FIRE, LIGHTNING]);
    const parked = mustApply(state, use("Buddy Boost", 0));
    expect(effectPrompt(parked.state)).toMatchObject({ candidates: [benchRef(0)] });
    const second = mustApply(parked.state, resolve({ kind: "pokemon", ref: benchRef(0) }));
    const done = mustApply(second.state, resolve({ kind: "pokemon", ref: benchRef(0) }));
    expect(energyOn(done.state, benchRef(0))).toEqual([FIRE, LIGHTNING]);
  });

  it("only one Electivire-or-Magmortar and one Energy: attached without a question", () => {
    const out = mustApply(hand(board(MAGMORTAR.id), [FIRE]), use("Buddy Boost"));
    expect(out.state.phase.kind).toBe("turn:action");
    expect(energyOn(out.state, ACTIVE)).toEqual([FIRE]);
  });

  it("a hand with no Basic {R} or {L} Energy refuses the Ability", () => {
    expectErr(hand(board(MAGMORTAR.id), [WATER, SPECIAL]), use("Buddy Boost"), "NO_LEGAL_TARGET");
  });

  it("Heat Crash does 80", () => {
    const out = mustApply(attachFromDeck(board(MAGMORTAR.id), "p1", FIRE, 3), attack());
    expect(out.state.players.p2.active?.damage).toBe(80);
  });
});

describe("Jellicent me06-028 Deep Sea Draw", () => {
  it("draws a card, then a card from the hand may go to the bottom of the deck", () => {
    const state = hand(board(JELLICENT.id), [WATER]);
    const top = state.players.p1.deck[0] as string;
    const parked = mustApply(state, use("Deep Sea Draw"));
    expect(parked.state.players.p1.hand).toContain(top);
    const prompt = effectPrompt(parked.state);
    expect(prompt).toMatchObject({
      kind: "chooseCards",
      min: 0,
      max: 1,
      dest: "deckBottom",
      note: "Put up to 1 card from your hand on the bottom of your deck.",
    });
    expect([...(prompt as { candidates: string[] }).candidates].sort()).toEqual(
      [...parked.state.players.p1.hand].sort(),
    );
    const water = state.players.p1.hand[0] as string;
    const done = mustApply(roundTrip(parked.state), resolve({ kind: "cards", uids: [water] }));
    expect(done.state.players.p1.hand).toEqual([top]);
    expect(done.state.players.p1.deck.at(-1)).toBe(water);
    expectErr(done.state, use("Deep Sea Draw"), "ABILITY_ALREADY_USED");
  });

  it("the put is a may: declining keeps both cards, and the drawn card itself may go back", () => {
    const state = hand(board(JELLICENT.id), [WATER]);
    const parked = mustApply(state, use("Deep Sea Draw"));
    const kept = mustApply(parked.state, resolve({ kind: "cards", uids: [] }));
    expect(kept.state.players.p1.hand).toHaveLength(2);
    const top = state.players.p1.deck[0] as string;
    const back = mustApply(parked.state, resolve({ kind: "cards", uids: [top] }));
    expect(back.state.players.p1.deck.at(-1)).toBe(top);
    expectErr(
      parked.state,
      resolve({ kind: "cards", uids: [...parked.state.players.p1.hand] }),
      "BAD_EFFECT_CHOICE",
    );
  });

  it("reading: with an empty deck nothing is drawn, so nothing is asked (the Ability is still usable)", () => {
    const state = hand(board(JELLICENT.id), [WATER]);
    const empty = patchSide(state, "p1", {
      deck: [],
      discard: [...state.players.p1.discard, ...state.players.p1.deck],
    });
    const out = mustApply(empty, use("Deep Sea Draw"));
    expect(out.state.phase.kind).toBe("turn:action");
    expect(used(out.events)).toHaveLength(1);
    expect(ids(out.state, out.state.players.p1.hand)).toEqual([WATER]);
  });

  it("Gentle Slap does 100", () => {
    const out = mustApply(attachFromDeck(board(JELLICENT.id), "p1", WATER, 3), attack());
    expect(out.state.players.p2.active?.damage).toBe(100);
  });
});

describe("Wishiwashi ex me06-029 / -120 Oceanic Gain", () => {
  it("in the Active Spot it heals 50, clamped to the damage, once a turn", () => {
    const out = mustApply(setDamage(board(WISHIWASHI.id), "p1", 80), use("Oceanic Gain"));
    expect(out.state.players.p1.active?.damage).toBe(30);
    expectErr(out.state, use("Oceanic Gain"), "ABILITY_ALREADY_USED");
    const clamp = mustApply(setDamage(board(WISHIWASHI.id), "p1", 30), use("Oceanic Gain"));
    expect(clamp.state.players.p1.active?.damage).toBe(0);
  });

  it("on the Bench it is refused", () => {
    const state = setDamage(bench(board(WALL), "p1", [WISHIWASHI.id]), "p1", 80);
    expectErr(state, use("Oceanic Gain", 0), "ABILITY_ACTIVE_ONLY");
  });

  it("reading: at full HP the Ability may still be used and heals nothing", () => {
    const out = mustApply(board(WISHIWASHI.id), use("Oceanic Gain"));
    expect(used(out.events)).toHaveLength(1);
    expect(out.events.some((e) => e.type === "HEALED")).toBe(false);
  });

  it("Hydro Splash does 220", () => {
    const out = mustApply(attachFromDeck(board(WISHIWASHI.id), "p1", WATER, 4), attack());
    expect(out.state.players.p2.active?.damage).toBe(220);
  });
});

describe("Pawmot me06-039 Generator's Touch", () => {
  const charged = () =>
    discardFromDeck(
      discardFromDeck(bench(board(PAWMOT.id), "p1", [DRAGON]), "p1", LIGHTNING, 1),
      "p1",
      FIRE,
      1,
    );

  it("a Basic {L} from the discard pile goes to 1 of your Pokémon, Benched or Active", () => {
    const parked = mustApply(charged(), use("Generator's Touch"));
    expect(effectPrompt(parked.state)).toMatchObject({
      kind: "choosePokemon",
      candidates: [ACTIVE, benchRef(0)],
    });
    const done = mustApply(roundTrip(parked.state), resolve({ kind: "pokemon", ref: benchRef(0) }));
    expect(energyOn(done.state, benchRef(0))).toEqual([LIGHTNING]);
    expect(ids(done.state, done.state.players.p1.discard)).toEqual([FIRE]);
    expectErr(done.state, use("Generator's Touch"), "ABILITY_ALREADY_USED");
  });

  it("from the Bench too; a discard pile with no Basic {L} refuses the Ability", () => {
    const state = discardFromDeck(bench(board(WALL), "p1", [PAWMOT.id]), "p1", LIGHTNING, 1);
    const parked = mustApply(state, use("Generator's Touch", 0));
    const done = mustApply(parked.state, resolve({ kind: "pokemon", ref: ACTIVE }));
    expect(energyOn(done.state, ACTIVE)).toEqual([LIGHTNING]);
    const none = discardFromDeck(
      discardFromDeck(board(PAWMOT.id), "p1", FIRE, 1),
      "p1",
      SPECIAL,
      1,
    );
    expectErr(none, use("Generator's Touch"), "NO_LEGAL_TARGET");
  });

  it("Electric Punch does 100", () => {
    const out = mustApply(attachFromDeck(board(PAWMOT.id), "p1", LIGHTNING, 2), attack());
    expect(out.state.players.p2.active?.damage).toBe(100);
  });
});

describe("Nidoqueen me06-057 Maternal Call", () => {
  it("heads: you choose which Benched Pokémon of the opponent's is switched in", () => {
    const state = withFaces(bench(board(NIDOQUEEN.id), "p2", [DRAGON, ELECTIVIRE]), ["heads"]);
    const parked = mustApply(state, use("Maternal Call"));
    expect(parked.state.phase).not.toHaveProperty("answerer");
    expect(effectPrompt(parked.state)).toMatchObject({
      kind: "choosePokemon",
      candidates: [benchRef(0, "p2"), benchRef(1, "p2")],
    });
    const done = mustApply(
      roundTrip(parked.state),
      resolve({ kind: "pokemon", ref: benchRef(1, "p2") }),
    );
    expect(topOf(done.state, { seat: "p2", spot: { spot: "active" } })).toBe(ELECTIVIRE);
    expectErr(done.state, use("Maternal Call"), "ABILITY_ALREADY_USED");
  });

  it("reading: tails moves nothing and still spends the Ability", () => {
    const state = withFaces(bench(board(NIDOQUEEN.id), "p2", [DRAGON]), ["tails"]);
    const out = mustApply(state, use("Maternal Call"));
    expect(topOf(out.state, { seat: "p2", spot: { spot: "active" } })).toBe(WALL);
    expectErr(out.state, use("Maternal Call"), "ABILITY_ALREADY_USED");
  });

  it("reading: an opponent with no Benched Pokémon refuses the Ability before any coin is flipped (Captivating Invitation's gate)", () => {
    expectErr(board(NIDOQUEEN.id), use("Maternal Call"), "NO_LEGAL_TARGET");
  });

  it("Giga Impact does 150, and Nidoqueen can't attack during your next turn", () => {
    const state = attachFromDeck(
      attachFromDeck(board(NIDOQUEEN.id), "p1", "fix-dark-energy", 1),
      "p1",
      WATER,
      2,
    );
    const hit = mustApply(state, attack());
    expect(hit.state.players.p2.active?.damage).toBe(150);
    const back = mustApply(hit.state, { type: "endTurn", seat: "p2" });
    expect(back.state.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
    expectErr(back.state, attack(), "ATTACK_PREVENTED");
  });
});

describe("Kommo-o me06-075 Beat Scales", () => {
  const TOP = [FIRE, WALL, SPECIAL, LIGHTNING, WALL, FIRE, LIGHTNING];
  const scaled = () => stackTop(bench(board(KOMMO_O.id), "p1", [DRAGON, WALL]), "p1", TOP);

  it("any number of the Basic Energy in the top 6 go to your {N} Pokémon; the rest are shuffled back", () => {
    const state = scaled();
    const window = state.players.p1.deck.slice(0, 6);
    const basics = window.filter((u) => [FIRE, LIGHTNING].includes(state.cardIdByUid[u] as string));
    const parked = mustApply(state, use("Beat Scales"));
    const prompt = effectPrompt(parked.state);
    expect(prompt).toMatchObject({
      kind: "attachCards",
      targets: [ACTIVE, benchRef(0)],
      note: "Look at the top 6 cards of your deck and attach any number of Basic Energy cards you find there to your Dragon Pokémon in any way you like.",
    });
    expect([...(prompt as { candidates: string[] }).candidates].sort()).toEqual([...basics].sort());
    const [a, b, c] = basics as [string, string, string];
    expectErr(
      parked.state,
      resolve({ kind: "attachCards", assignments: [{ uid: a, to: benchRef(1) }] }),
      "BAD_EFFECT_CHOICE",
    );
    const done = mustApply(
      roundTrip(parked.state),
      resolve({
        kind: "attachCards",
        assignments: [
          { uid: a, to: ACTIVE },
          { uid: b, to: ACTIVE },
          { uid: c, to: benchRef(0) },
        ],
      }),
    );
    expect(bodyAt(done.state, ACTIVE).energy).toEqual([a, b]);
    expect(bodyAt(done.state, benchRef(0)).energy).toEqual([c]);
    expect(done.events.some((e) => e.type === "SHUFFLE")).toBe(true);
    expect(done.state.players.p1.deck).toHaveLength(state.players.p1.deck.length - 3);
    expectErr(done.state, use("Beat Scales"), "ABILITY_ALREADY_USED");
  });

  it("attaching nothing still shuffles the deck", () => {
    const state = scaled();
    const parked = mustApply(state, use("Beat Scales"));
    const done = mustApply(parked.state, resolve({ kind: "attachCards", assignments: [] }));
    expect(done.events.some((e) => e.type === "SHUFFLE")).toBe(true);
    expect(done.state.players.p1.deck).toHaveLength(state.players.p1.deck.length);
    expect(bodyAt(done.state, ACTIVE).energy).toEqual([]);
  });

  it("Hammer In does 170", () => {
    const state = attachFromDeck(
      attachFromDeck(
        attachFromDeck(board(KOMMO_O.id), "p1", LIGHTNING, 1),
        "p1",
        "fix-fighting-energy",
        1,
      ),
      "p1",
      WATER,
      1,
    );
    expect(mustApply(state, attack()).state.players.p2.active?.damage).toBe(170);
  });
});

describe("Delibird me06-079 Energizing Present", () => {
  const TOP = [WALL, FIRE, WALL, SPECIAL, WALL, WALL, LIGHTNING];
  const present = () => stackTop(board(DELIBIRD.id), "p1", TOP);

  it("reading: an Energy card includes Special Energy; it is revealed into the hand and the other 5 go to the bottom", () => {
    const state = present();
    const window = state.players.p1.deck.slice(0, 6);
    const seventh = state.players.p1.deck[6];
    const energies = window.filter((u) => [FIRE, SPECIAL].includes(state.cardIdByUid[u] as string));
    const parked = mustApply(state, use("Energizing Present"));
    const prompt = effectPrompt(parked.state);
    expect(prompt).toMatchObject({ kind: "chooseCards", min: 0, max: 1, dest: "hand" });
    expect([...(prompt as { candidates: string[] }).candidates].sort()).toEqual(
      [...energies].sort(),
    );
    const special = window[3] as string;
    expectErr(parked.state, resolve({ kind: "cards", uids: energies }), "BAD_EFFECT_CHOICE");
    const done = mustApply(roundTrip(parked.state), resolve({ kind: "cards", uids: [special] }));
    expect(done.state.players.p1.hand).toEqual([special]);
    expect(done.events).toContainEqual(
      expect.objectContaining({ type: "DECK_TOP_REVEALED", uids: [special] }),
    );
    const deck = done.state.players.p1.deck;
    expect(deck[0]).toBe(seventh);
    expect([...deck.slice(-5)].sort()).toEqual(window.filter((u) => u !== special).sort());
    expectErr(done.state, use("Energizing Present"), "ABILITY_ALREADY_USED");
  });

  it("reading: the look may come up empty on purpose (a hidden zone, §9.1), and the 6 still go to the bottom", () => {
    const state = present();
    const window = state.players.p1.deck.slice(0, 6);
    const parked = mustApply(state, use("Energizing Present"));
    const done = mustApply(parked.state, resolve({ kind: "cards", uids: [] }));
    expect(done.state.players.p1.hand).toEqual([]);
    expect([...done.state.players.p1.deck.slice(-6)].sort()).toEqual([...window].sort());
  });

  it("no Energy in the top 6: nothing is asked and the 6 go to the bottom", () => {
    const state = stackTop(board(DELIBIRD.id), "p1", [WALL, WALL, WALL, WALL, WALL, WALL]);
    const window = state.players.p1.deck.slice(0, 6);
    const out = mustApply(state, use("Energizing Present"));
    expect(out.state.phase.kind).toBe("turn:action");
    expect([...out.state.players.p1.deck.slice(-6)].sort()).toEqual([...window].sort());
  });

  it("on the Bench it is refused", () => {
    expectErr(
      bench(board(WALL), "p1", [DELIBIRD.id]),
      use("Energizing Present", 0),
      "ABILITY_ACTIVE_ONLY",
    );
  });

  it("Beat does 10", () => {
    const out = mustApply(attachFromDeck(board(DELIBIRD.id), "p1", WATER, 1), attack());
    expect(out.state.players.p2.active?.damage).toBe(10);
  });
});
