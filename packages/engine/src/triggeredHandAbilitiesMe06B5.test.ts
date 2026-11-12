import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { GameAction, GameEvent, GameState, PokemonRef, Seat } from "./index";
import { programFor } from "./registry";
import { simulationGaps } from "./simulationGaps";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  driveSetup,
  effectPrompt,
  ensureInDeck,
  expectErr,
  handFromDeck,
  mustApply,
  patchSide,
  roundTrip,
  setActiveFromDeck,
  specialEnergy,
  typedEnergy,
  unprize,
} from "./testFixtures";

const RULERS_ROAR =
  "Once during your turn, when you play this Pokémon from your hand onto your Bench, you may use this Ability. Look at the top 4 cards of your deck and attach a Basic Energy card you find there to this Pokémon. Shuffle the other cards and put them on the bottom of your deck.";
const STORM_EMERALD =
  "This attack does 50 damage for each {R} Energy and each {L} Energy attached to all of your Pokémon.";
const EXCITED_DIVE =
  "Once during your turn, if this Pokémon is in your hand, and if you have any Colorless Mega Evolution Pokémon ex in play, you may use this Ability. Put this Pokémon onto your Bench.";
const TALON_HUNT =
  "You may search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck.";

const RAYQUAZA: Card = battler("me06-084", {
  name: "Mega Rayquaza ex",
  hp: 280,
  types: ["Colorless"],
  retreat: 2,
  weaknesses: [{ type: "Lightning", value: "×2" }],
  resistances: [{ type: "Fighting", value: "-30" }],
  abilities: [{ type: "Ability", name: "Ruler's Roar", effect: RULERS_ROAR }],
  attacks: [
    {
      cost: ["Fire", "Lightning", "Colorless"],
      name: "Storm Emerald",
      damage: "50×",
      effect: STORM_EMERALD,
    },
  ],
});
const TALONFLAME: Card = battler("me06-088", {
  name: "Talonflame ex",
  hp: 280,
  types: ["Colorless"],
  retreat: 0,
  weaknesses: [{ type: "Lightning", value: "×2" }],
  resistances: [{ type: "Fighting", value: "-30" }],
  abilities: [{ type: "Ability", name: "Excited Dive", effect: EXCITED_DIVE }],
  attacks: [
    { cost: ["Colorless", "Colorless"], name: "Talon Hunt", damage: 150, effect: TALON_HUNT },
  ],
});
/** The catalog row says Basic; this face is the Evolution the Ability's wording implies. */
const TALONFLAME_STAGE2: Card = { ...TALONFLAME, stage: "Stage2", evolveFrom: "Fletchinder" };
const REPRINTS: readonly (readonly [string, Card])[] = [
  ["me06-138", RAYQUAZA],
  ["me06-141", RAYQUAZA],
  ["me06-124", TALONFLAME],
];

const WALL = "b5-wall";
const MEGA_FIRE = "b5-mega-fire";
const COLORLESS_EX = "b5-colorless-ex";
const FIRE = "b5-fire";
const LIGHTNING = "b5-lightning";
const WATER = "b5-water";
const SPECIAL = "b5-special";
const LUMINOUS = "sv02-191";

const LOCAL: Record<string, Card> = {
  [RAYQUAZA.id]: RAYQUAZA,
  [TALONFLAME.id]: TALONFLAME,
  [WALL]: battler(WALL, {
    name: "B5 Wall",
    hp: 400,
    types: ["Colorless"],
    retreat: 2,
    attacks: [{ cost: ["Colorless"], name: "Smash", damage: 60 }],
  }),
  [MEGA_FIRE]: battler(MEGA_FIRE, { name: "Mega B5 Blaze ex", hp: 300, types: ["Fire"] }),
  [COLORLESS_EX]: battler(COLORLESS_EX, { name: "B5 Gale ex", hp: 200, types: ["Colorless"] }),
  [FIRE]: typedEnergy(FIRE, "Fire"),
  [LIGHTNING]: typedEnergy(LIGHTNING, "Lightning"),
  [WATER]: typedEnergy(WATER, "Water"),
  [SPECIAL]: specialEnergy(SPECIAL, "B5 Special Energy"),
  [LUMINOUS]: specialEnergy(LUMINOUS, "Luminous Energy"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const POOL_STAGE2: Record<string, Card> = { ...POOL, [TALONFLAME.id]: TALONFLAME_STAGE2 };
const DECK = deckOf({
  "sv01-181": 1,
  [RAYQUAZA.id]: 3,
  [TALONFLAME.id]: 2,
  [WALL]: 22,
  [MEGA_FIRE]: 1,
  [COLORLESS_EX]: 1,
  [FIRE]: 8,
  [LIGHTNING]: 8,
  [WATER]: 6,
  [SPECIAL]: 2,
  [LUMINOUS]: 1,
  "fix-energy": 5,
});
const KEEP = new Set(DECK.filter((id) => id !== WALL));

/** p1 to act, on a turn that is not the first; both hands in the deck, both Benches empty. */
function board(active: string, pool: Record<string, Card> = POOL): GameState {
  let state = driveSetup(0xb5, { p1: DECK, p2: DECK }, { pool, first: "p2" });
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
  return clearBench(setActiveFromDeck(state, "p2", WALL), "p2");
}

function bench(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  let out = state;
  for (const id of ids) out = benchFromDeck(ensureInDeck(out, seat, id), seat, id);
  return out;
}

function hand(state: GameState, cards: readonly string[]): GameState {
  let out = state;
  for (const id of cards) out = handFromDeck(ensureInDeck(out, "p1", id), "p1", id, 1);
  return out;
}

/** Puts one deck copy of each id on top of p1's deck, in the order given (first on top). */
function stackTop(state: GameState, top: readonly string[]): GameState {
  let seated = state;
  for (const id of top) seated = ensureInDeck(seated, "p1", id);
  const deck = [...seated.players.p1.deck];
  const picked = top.map((id) => {
    const at = deck.findIndex((u) => seated.cardIdByUid[u] === id);
    if (at < 0) throw new Error(`p1 has no spare ${id} in the deck`);
    return deck.splice(at, 1)[0] as string;
  });
  return patchSide(seated, "p1", { deck: [...picked, ...deck] });
}

const ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const benchRef = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });
const resolve = (choice: unknown): GameAction =>
  ({ type: "resolveEffect", seat: "p1", choice }) as GameAction;
const ids = (state: GameState, uids: readonly string[]) =>
  uids.map((u) => state.cardIdByUid[u] as string);
const handUidOf = (state: GameState, id: string): string => {
  const uid = state.players.p1.hand.find((u) => state.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`no ${id} in p1's hand`);
  return uid;
};
const benchIt = (state: GameState, id: string): GameAction => ({
  type: "playBasicToBench",
  seat: "p1",
  uid: handUidOf(state, id),
});
const bodyAt = (state: GameState, ref: PokemonRef) => {
  const side = state.players[ref.seat];
  const body = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  if (body === null || body === undefined) throw new Error("no body there");
  return body;
};
const energyOn = (state: GameState, ref: PokemonRef) => ids(state, bodyAt(state, ref).energy);
const ofType = (events: readonly GameEvent[], type: GameEvent["type"]) =>
  events.filter((e) => e.type === type);

describe("me06 B5: every built printing leaves simulationGaps on its program", () => {
  it("Mega Rayquaza ex ×3 and Talonflame ex ×2 have no gap, and each reprint plays its canonical's program", () => {
    for (const card of [RAYQUAZA, TALONFLAME, TALONFLAME_STAGE2]) {
      expect(simulationGaps(card), card.id).toEqual([]);
    }
    for (const [id, face] of REPRINTS) {
      expect(simulationGaps({ ...face, id }), id).toEqual([]);
      expect(programFor(id), id).toBe(programFor(face.id));
    }
    expect(programFor(RAYQUAZA.id)?.triggered?.[0]).toMatchObject({
      name: "Ruler's Roar",
      trigger: "onPlayToBench",
    });
    expect(programFor(TALONFLAME.id)?.benchFromHand).toEqual({
      name: "Excited Dive",
      playableIf: { kind: "yourMegaExInPlay", type: "Colorless" },
    });
  });
});

describe("Mega Rayquaza ex me06-084 / -138 / -141 Ruler's Roar", () => {
  const window = [WALL, FIRE, SPECIAL, LIGHTNING] as const;
  const ready = (top: readonly string[] = window, benched: readonly string[] = []) =>
    stackTop(bench(hand(board(WALL), [RAYQUAZA.id]), "p1", benched), top);

  it("played onto the Bench it asks first; yes offers the window's Basic Energy onto this Pokémon only", () => {
    const state = ready(window, [WALL]);
    const before = state.players.p1.deck;
    const played = mustApply(state, benchIt(state, RAYQUAZA.id));
    expect(ofType(played.events, "ABILITY_TRIGGERED")).toEqual([
      expect.objectContaining({ ability: "Ruler's Roar" }),
    ]);
    expect(effectPrompt(played.state)).toMatchObject({ kind: "confirm", note: RULERS_ROAR });
    const asked = mustApply(roundTrip(played.state), resolve({ kind: "confirm", yes: true }));
    const prompt = effectPrompt(asked.state);
    expect(prompt).toMatchObject({
      kind: "attachCards",
      candidates: [before[1], before[3]],
      targets: [benchRef(1)],
      max: 1,
      note: "Look at the top 4 cards of your deck and attach a Basic Energy card you find there to this Pokémon.",
    });
    const parked = roundTrip(asked.state);
    expectErr(
      parked,
      resolve({ kind: "attachCards", assignments: [{ uid: before[1], to: ACTIVE }] }),
      "BAD_EFFECT_CHOICE",
    );
    expectErr(
      parked,
      resolve({ kind: "attachCards", assignments: [{ uid: before[1], to: benchRef(0) }] }),
      "BAD_EFFECT_CHOICE",
    );
    expectErr(
      parked,
      resolve({
        kind: "attachCards",
        assignments: [
          { uid: before[1], to: benchRef(1) },
          { uid: before[3], to: benchRef(1) },
        ],
      }),
      "BAD_EFFECT_CHOICE",
    );
    const done = mustApply(
      parked,
      resolve({ kind: "attachCards", assignments: [{ uid: before[3], to: benchRef(1) }] }),
    );
    expect(done.state.phase.kind).toBe("turn:action");
    expect(energyOn(done.state, benchRef(1))).toEqual([LIGHTNING]);
    const deck = done.state.players.p1.deck;
    expect(deck).toHaveLength(before.length - 1);
    expect(deck.slice(0, before.length - 4)).toEqual(before.slice(4));
    expect([...deck.slice(-3)].sort()).toEqual([before[0], before[1], before[2]].sort());
  });

  it("no keeps the deck exactly as it was and attaches nothing", () => {
    const state = ready();
    const played = mustApply(state, benchIt(state, RAYQUAZA.id));
    const done = mustApply(played.state, resolve({ kind: "confirm", yes: false }));
    expect(done.state.phase.kind).toBe("turn:action");
    expect(done.state.players.p1.deck).toEqual(state.players.p1.deck);
    expect(energyOn(done.state, benchRef(0))).toEqual([]);
  });

  it("yes with no pick still puts all 4 cards on the bottom", () => {
    const state = ready();
    const before = state.players.p1.deck;
    const played = mustApply(state, benchIt(state, RAYQUAZA.id));
    const asked = mustApply(played.state, resolve({ kind: "confirm", yes: true }));
    const done = mustApply(asked.state, resolve({ kind: "attachCards", assignments: [] }));
    expect(energyOn(done.state, benchRef(0))).toEqual([]);
    const deck = done.state.players.p1.deck;
    expect(deck.slice(0, -4)).toEqual(before.slice(4));
    expect([...deck.slice(-4)].sort()).toEqual(before.slice(0, 4).sort());
  });

  it("reading: a window with no Basic Energy asks nothing more after yes and bottoms all 4 (Special Energy is not offered)", () => {
    const state = ready([WALL, SPECIAL, WALL, LUMINOUS]);
    const before = state.players.p1.deck;
    const played = mustApply(state, benchIt(state, RAYQUAZA.id));
    const done = mustApply(played.state, resolve({ kind: "confirm", yes: true }));
    expect(done.state.phase.kind).toBe("turn:action");
    expect(energyOn(done.state, benchRef(0))).toEqual([]);
    expect([...done.state.players.p1.deck.slice(-4)].sort()).toEqual(before.slice(0, 4).sort());
    expect(done.state.players.p1.deck.slice(0, -4)).toEqual(before.slice(4));
  });

  it("a fifth card is never in the window, and a deck of 2 offers only those 2", () => {
    const state = ready([WALL, WALL, WALL, WALL, FIRE]);
    const played = mustApply(state, benchIt(state, RAYQUAZA.id));
    const done = mustApply(played.state, resolve({ kind: "confirm", yes: true }));
    expect(done.state.phase.kind).toBe("turn:action");
    expect(done.state.players.p1.deck[0]).toBe(state.players.p1.deck[4]);

    const short = stackTop(hand(board(WALL), [RAYQUAZA.id]), [FIRE, WALL]);
    const two = patchSide(short, "p1", { deck: short.players.p1.deck.slice(0, 2) });
    const shortPlayed = mustApply(two, benchIt(two, RAYQUAZA.id));
    const shortAsked = mustApply(shortPlayed.state, resolve({ kind: "confirm", yes: true }));
    expect(effectPrompt(shortAsked.state)).toMatchObject({
      kind: "attachCards",
      candidates: [two.players.p1.deck[0]],
    });
  });

  it("an empty deck: yes looks at nothing, attaches nothing and moves nothing", () => {
    const empty = patchSide(ready(), "p1", { deck: [] });
    const played = mustApply(empty, benchIt(empty, RAYQUAZA.id));
    const done = mustApply(played.state, resolve({ kind: "confirm", yes: true }));
    expect(done.state.phase.kind).toBe("turn:action");
    expect(done.state.players.p1.deck).toEqual([]);
    expect(energyOn(done.state, benchRef(0))).toEqual([]);
  });

  it("reading: each Mega Rayquaza ex played from the hand gets its own Ruler's Roar the same turn", () => {
    let state = stackTop(hand(hand(board(WALL), [RAYQUAZA.id]), [RAYQUAZA.id]), [FIRE, LIGHTNING]);
    for (const index of [0, 1]) {
      const played = mustApply(state, benchIt(state, RAYQUAZA.id));
      const asked = mustApply(played.state, resolve({ kind: "confirm", yes: true }));
      const uid = asked.state.players.p1.deck[0] as string;
      state = mustApply(
        asked.state,
        resolve({ kind: "attachCards", assignments: [{ uid, to: benchRef(index) }] }),
      ).state;
    }
    expect(energyOn(state, benchRef(0))).toHaveLength(1);
    expect(energyOn(state, benchRef(1))).toHaveLength(1);
  });

  it("does not fire when Nest Ball puts it onto the Bench from the deck", () => {
    const state = hand(board(WALL), ["sv01-181"]);
    const parked = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUidOf(state, "sv01-181"),
    });
    const prompt = effectPrompt(parked.state);
    if (prompt.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${prompt.kind}`);
    const ray = prompt.candidates.find((u) => parked.state.cardIdByUid[u] === RAYQUAZA.id);
    const done = mustApply(parked.state, resolve({ kind: "cards", uids: [ray] }));
    expect(done.state.phase.kind).toBe("turn:action");
    expect(ofType(done.events, "ABILITY_TRIGGERED")).toEqual([]);
    expect(ids(done.state, bodyAt(done.state, benchRef(0)).stack)).toEqual([RAYQUAZA.id]);
    expect(energyOn(done.state, benchRef(0))).toEqual([]);
  });
});

describe("Mega Rayquaza ex Storm Emerald", () => {
  const charged = () => {
    let state = bench(board(RAYQUAZA.id), "p1", [WALL, TALONFLAME.id]);
    state = attachFromDeck(state, "p1", FIRE, 1);
    state = attachFromDeck(state, "p1", LIGHTNING, 1);
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = attachBenchFromDeck(state, "p1", 0, FIRE, 2);
    state = attachBenchFromDeck(state, "p1", 0, WATER, 1);
    return attachBenchFromDeck(state, "p1", 1, LIGHTNING, 1);
  };
  const storm = (state: GameState) =>
    mustApply(state, { type: "attack", seat: "p1", index: 0 }).state.players.p2.active?.damage;

  it("does 50 for each {R} and each {L} on all of your Pokémon, Active and Bench; other types count nothing", () => {
    expect(storm(charged())).toBe(250);
  });

  it("your opponent's {R} and {L} Energy are not counted", () => {
    let state = charged();
    state = attachFromDeck(state, "p2", FIRE, 2);
    state = attachFromDeck(state, "p2", LIGHTNING, 2);
    expect(storm(state)).toBe(250);
  });

  it("reading: an Energy providing every type (Luminous Energy) is one Energy and counts once", () => {
    expect(storm(attachBenchFromDeck(charged(), "p1", 1, LUMINOUS, 1))).toBe(300);
  });

  it("a Special Energy that provides neither counts nothing", () => {
    expect(storm(attachBenchFromDeck(charged(), "p1", 1, SPECIAL, 1))).toBe(250);
  });
});

describe("Talonflame ex me06-088 / -124 Excited Dive", () => {
  const withHand = (
    pool: Record<string, Card>,
    megaAt: "active" | "bench" | null,
    extra = WALL,
  ) => {
    const active = megaAt === "active" ? RAYQUAZA.id : WALL;
    let state = board(active, pool);
    if (megaAt === "bench") state = bench(state, "p1", [RAYQUAZA.id]);
    if (extra !== WALL) state = bench(state, "p1", [extra]);
    return hand(state, [TALONFLAME.id]);
  };

  it("reading: the catalog row is a Basic, so it is benched as one, with or without a Mega, and no Ability is used", () => {
    const state = withHand(POOL, null);
    const uid = handUidOf(state, TALONFLAME.id);
    const done = mustApply(state, benchIt(state, TALONFLAME.id));
    expect(done.events).toEqual([{ type: "POKEMON_BENCHED", seat: "p1", uid }]);
    expect(done.state.allowances.abilitiesUsed).not.toContain(`${uid}:Excited Dive`);
  });

  it("as an Evolution, it is refused without a Colorless Mega Evolution Pokémon ex, with the printed clause", () => {
    for (const extra of [WALL, MEGA_FIRE, COLORLESS_EX]) {
      const state = withHand(POOL_STAGE2, null, extra);
      const result = applyAction(state, benchIt(state, TALONFLAME.id));
      expect(result.ok, extra).toBe(false);
      if (result.ok) continue;
      expect(result.error).toEqual({
        code: "ABILITY_CONDITION_NOT_MET",
        message:
          "Excited Dive can only be used if you have any Colorless Mega Evolution Pokémon ex in play (§9)",
      });
    }
  });

  it("reading: the catalog's Basic face is benched as one with Mega Rayquaza ex in play too, and no Ability is spent", () => {
    const state = withHand(POOL, "active");
    const uid = handUidOf(state, TALONFLAME.id);
    const done = mustApply(state, benchIt(state, TALONFLAME.id));
    expect(done.events).toEqual([{ type: "POKEMON_BENCHED", seat: "p1", uid }]);
    expect(done.state.allowances.abilitiesUsed).not.toContain(`${uid}:Excited Dive`);
  });

  it("your opponent's Mega Rayquaza ex, Active or Benched, does not open it: the printed 'you have'", () => {
    const foeActive = clearBench(
      setActiveFromDeck(withHand(POOL_STAGE2, null), "p2", RAYQUAZA.id),
      "p2",
    );
    const foeBench = bench(withHand(POOL_STAGE2, null), "p2", [RAYQUAZA.id]);
    for (const state of [foeActive, foeBench]) {
      expectErr(state, benchIt(state, TALONFLAME.id), "ABILITY_CONDITION_NOT_MET");
    }
  });

  it("with Mega Rayquaza ex in play, Active or Benched, it is put onto the Bench and the Ability is spent", () => {
    for (const megaAt of ["active", "bench"] as const) {
      const state = withHand(POOL_STAGE2, megaAt);
      const uid = handUidOf(state, TALONFLAME.id);
      const done = mustApply(state, benchIt(state, TALONFLAME.id));
      expect(done.events.slice(0, 2)).toEqual([
        { type: "ABILITY_USED", seat: "p1", uid, ability: "Excited Dive" },
        { type: "POKEMON_BENCHED", seat: "p1", uid },
      ]);
      expect(done.state.players.p1.bench.at(-1)?.stack).toEqual([uid]);
      expect(done.state.players.p1.hand).not.toContain(uid);
      expect(done.state.allowances.abilitiesUsed).toContain(`${uid}:Excited Dive`);
    }
  });

  it("once during your turn: the same card back in the hand is refused; a second copy is not", () => {
    const state = hand(withHand(POOL_STAGE2, "active"), [TALONFLAME.id]);
    const first = handUidOf(state, TALONFLAME.id);
    const once = mustApply(state, { type: "playBasicToBench", seat: "p1", uid: first }).state;
    const second = handUidOf(once, TALONFLAME.id);
    const twice = mustApply(once, { type: "playBasicToBench", seat: "p1", uid: second }).state;
    expect(twice.players.p1.bench.map((b) => b.stack.at(-1))).toEqual([first, second]);
    const back = patchSide(twice, "p1", {
      bench: twice.players.p1.bench.slice(1),
      hand: [...twice.players.p1.hand, first],
    });
    expectErr(back, { type: "playBasicToBench", seat: "p1", uid: first }, "ABILITY_ALREADY_USED");
  });

  it("a full Bench refuses it", () => {
    const full = bench(withHand(POOL_STAGE2, "active"), "p1", [WALL, WALL, WALL, WALL, WALL]);
    expectErr(full, benchIt(full, TALONFLAME.id), "BENCH_FULL");
  });

  it("Talon Hunt does 150 and puts up to 2 cards from the deck into the hand, then shuffles", () => {
    const state = attachFromDeck(board(TALONFLAME.id), "p1", "fix-energy", 2);
    const parked = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(parked.state.players.p2.active?.damage).toBe(150);
    const prompt = effectPrompt(roundTrip(parked.state));
    expect(prompt).toMatchObject({ kind: "chooseCards", max: 2 });
    const picks = state.players.p1.deck.slice(0, 2);
    const done = mustApply(parked.state, resolve({ kind: "cards", uids: picks }));
    expect([...done.state.players.p1.hand].sort()).toEqual([...picks].sort());
    expect(done.events.some((e) => e.type === "SHUFFLE")).toBe(true);
  });

  it("Talon Hunt: 'you may … up to 2' takes none, and a third card is refused", () => {
    const state = attachFromDeck(board(TALONFLAME.id), "p1", "fix-energy", 2);
    const parked = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expectErr(
      roundTrip(parked.state),
      resolve({ kind: "cards", uids: state.players.p1.deck.slice(0, 3) }),
      "BAD_EFFECT_CHOICE",
    );
    const none = mustApply(roundTrip(parked.state), resolve({ kind: "cards", uids: [] }));
    expect(none.state.players.p1.hand).toEqual([]);
    expect(none.state.players.p1.deck).toHaveLength(state.players.p1.deck.length);
  });
});
