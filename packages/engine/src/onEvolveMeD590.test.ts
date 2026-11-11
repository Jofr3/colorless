import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import { deriveAttackEffect } from "./effects";
import type { GameAction, GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { applyAction } from "./index";
import { programFor } from "./registry";
import { flipCoin } from "./rng";
import {
  effectPrompt,
  effectPromptOf,
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  setDamage,
  toDeckTop,
  typedEnergy,
  must,
  driveSetup,
  roundTrip,
} from "./testFixtures";

const HEAD =
  "Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability.";
const PSYCHIC_DRAW_3 = `${HEAD} Draw 3 cards.`;
const PSYCHIC_DRAW_2 = `${HEAD} Draw 2 cards.`;
const PRISON_PANIC = `${HEAD} Make your opponent's Active Pokémon Confused.`;
const ENERGIZED_STEPS = `${HEAD} Look at the top 4 cards of your deck and attach any number of Basic Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck.`;
const HEAVE_HO_CATCHER = `${HEAD} Switch in 1 of your opponent's Benched Pokémon to the Active Spot.`;
const CAST_OFF_SHELL = `${HEAD} Search your deck for a Shedinja and put it onto your Bench. Then, shuffle your deck.`;
const ENRICHING_MELODY = `${HEAD} Heal all damage from 1 of your Pokémon.`;
const MULTIPLYING_COCOON = `${HEAD} Search your deck for a Silcoon or a Cascoon and put it onto your Bench. Then, shuffle your deck.`;
const HAPHAZARD_HAMMER = `${HEAD} Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon.`;
const SELF_SHUFFLE = "Shuffle this Pokémon and all attached cards into your deck.";

const ALAKAZAM = ["me01-056", "mep-003", "mep-009"] as const;
const KADABRA = "me01-055";
const BRAMBLEGHAST = "me02-047";
const GRUMPIG = "me01-063";
const HARIYAMA = "me01-073";
const NINJASK = ["me01-017", "me01-137"] as const;
const PRIMARINA = ["me05-020", "me05-088"] as const;
const SILCOON = "me02.5-012";
const TINKATUFF = "me01-097";
const LOKIX = "me02-010";
const SHEDINJA = "me01-061";
const CASCOON = "me02.5-014";

const ABILITIES: readonly (readonly [string, string, readonly string[]])[] = [
  ["Psychic Draw", PSYCHIC_DRAW_3, ALAKAZAM],
  ["Psychic Draw", PSYCHIC_DRAW_2, [KADABRA]],
  ["Prison Panic", PRISON_PANIC, [BRAMBLEGHAST]],
  ["Energized Steps", ENERGIZED_STEPS, [GRUMPIG]],
  ["Heave-Ho Catcher", HEAVE_HO_CATCHER, [HARIYAMA]],
  ["Cast-Off Shell", CAST_OFF_SHELL, NINJASK],
  ["Enriching Melody", ENRICHING_MELODY, PRIMARINA],
  ["Multiplying Cocoon", MULTIPLYING_COCOON, [SILCOON]],
  ["Haphazard Hammer", HAPHAZARD_HAMMER, [TINKATUFF]],
];

const triggerOf = (id: string) => programFor(id)?.triggered?.[0];
const consequent = (text: string) => text.slice(HEAD.length + 1);

describe("D590 §1 — the programs: nine `onEvolve` objects over 13 printings, and the dropped Flygon", () => {
  it("every keyed printing carries ONE optional `onEvolve` trigger under its printed name, one object per text", () => {
    expect(ABILITIES.flatMap(([, , ids]) => ids)).toHaveLength(13);
    for (const [name, , ids] of ABILITIES) {
      for (const id of ids) {
        expect(Object.keys(programFor(id) ?? {}), id).toEqual(["triggered"]);
        expect(programFor(id)?.triggered, id).toHaveLength(1);
        expect(triggerOf(id), id).toMatchObject({ name, trigger: "onEvolve" });
        expect(triggerOf(id), id).not.toHaveProperty("oncePerTurn");
        expect(programFor(id), id).toBe(programFor(ids[0] as string));
      }
    }
    expect(new Set(ABILITIES.map(([, , ids]) => programFor(ids[0] as string))).size).toBe(9);
  });

  it("Psychic Draw: the draw sits behind a confirm carrying the whole print (3 on Alakazam, 2 on Kadabra)", () => {
    for (const [id, text, count] of [
      [ALAKAZAM[0], PSYCHIC_DRAW_3, 3],
      [KADABRA, PSYCHIC_DRAW_2, 2],
    ] as const) {
      expect(triggerOf(id)?.program).toEqual([
        { op: "optional", note: text, ops: [{ op: "drawCards", count }] },
      ]);
      expect(deriveAttackEffect(consequent(text))).toEqual([{ op: "drawCards", count }]);
    }
  });

  it("Prison Panic: the Confused sits behind a confirm carrying the whole print (it would overwrite the rotation slot)", () => {
    expect(triggerOf(BRAMBLEGHAST)?.program).toEqual([
      {
        op: "optional",
        note: PRISON_PANIC,
        ops: [{ op: "applyStatus", target: "defender", status: "confused" }],
      },
    ]);
  });

  it("the other six: each the op the printed consequent reads as, auto-fired", () => {
    expect(triggerOf(GRUMPIG)?.program).toEqual([
      { op: "attachFromTop", n: 4, filter: { kind: "basicEnergy" }, max: "any" },
      { op: "shuffleDeck" },
    ]);
    expect(triggerOf(NINJASK[0])?.program).toEqual([
      { op: "searchDeck", filter: { kind: "byName", name: "Shedinja" }, dest: "bench", max: 1 },
      { op: "shuffleDeck" },
    ]);
    expect(triggerOf(SILCOON)?.program).toEqual([
      {
        op: "searchDeck",
        filter: {
          kind: "anyOf",
          filters: [
            { kind: "byName", name: "Silcoon" },
            { kind: "byName", name: "Cascoon" },
          ],
        },
        dest: "bench",
        max: 1,
      },
      { op: "shuffleDeck" },
    ]);
    // The four whose printed consequent `deriveAttackEffect` reads: the same program.
    for (const id of [HARIYAMA, NINJASK[0], PRIMARINA[0], TINKATUFF]) {
      const text = ABILITIES.find(([, , ids]) => ids.includes(id))?.[1] as string;
      const derived = deriveAttackEffect(consequent(text));
      expect(triggerOf(id)?.program, id).toEqual(
        id === HARIYAMA ? derived?.map((op) => ({ ...op, optional: true })) : derived,
      );
    }
    // Heave-Ho Catcher is Defiant Horn's program, Enriching Melody is Enriching Oil's.
    expect(triggerOf(HARIYAMA)?.program).toEqual(programFor("sv09-136")?.triggered?.[0]?.program);
    expect(triggerOf(PRIMARINA[0])?.program).toEqual(
      programFor("sv01-023")?.triggered?.[0]?.program,
    );
    expect(triggerOf(TINKATUFF)?.program).toEqual([
      {
        op: "coinFlipGate",
        ops: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
      },
    ]);
  });

  it('Flygon ×3 "Sandy Flapping" is keyed with both halves (D626), and no printed attack is registry-keyed', () => {
    for (const id of ["me02-053", "me02-101", "mep-016"])
      expect(
        programFor(id)?.triggered?.map((t) => t.trigger),
        id,
      ).toEqual(["onEvolve", "onKnockOut"]);
    for (const [, , ids] of ABILITIES)
      for (const id of ids) expect(programFor(id)?.attack, id).toBeUndefined();
    expect(programFor(LOKIX)).toBeUndefined();
  });
});

describe("D590 §2 — the self-shuffle: `deriveAttackEffect` reads the mandatory sentence as `returnSelf` to the deck", () => {
  it("the sentence is the `me` corpus's row at 3 printings and is not printed bare in `sv`", () => {
    expect(new Map(meAttackCorpus().map(([n, text]) => [text, n])).get(SELF_SHUFFLE)).toBe(3);
    expect(legalAttackCorpus().some(([, text]) => text === SELF_SHUFFLE)).toBe(false);
  });

  it("it derives, with no `optional` (nothing asks)", () => {
    expect(deriveAttackEffect(SELF_SHUFFLE)).toEqual([{ op: "returnSelf", dest: "deck" }]);
  });

  it("the near misses stay null, one token apart each", () => {
    const controls: Record<string, string> = {
      'Surf Back\'s "You may" (registry-keyed, not derived)': `You may ${SELF_SHUFFLE.charAt(0).toLowerCase()}${SELF_SHUFFLE.slice(1)}`,
      "a prefixed sentence": `Draw a card. ${SELF_SHUFFLE}`,
      "a suffixed sentence": `${SELF_SHUFFLE} Draw a card.`,
      "into your hand": SELF_SHUFFLE.replace("into your deck", "into your hand"),
    };
    for (const [why, text] of Object.entries(controls))
      expect(deriveAttackEffect(text), why).toBeNull();
  });
});

// ── ON A BOARD ──

const FILLER = "d590-filler"; // a {C} Basic, 300 HP
const ABRA = "d590-abra";
const BRAMBLIN = "d590-bramblin";
const SPOINK = "d590-spoink";
const MAKUHITA = "d590-makuhita";
const NINCADA = "d590-nincada";
const BRIONNE = "d590-brionne";
const WURMPLE = "d590-wurmple";
const TINKATINK = "d590-tinkatink";
const P = "d590-psychic";
const RARE_CANDY = "sv01-191";
const W = "d590-water";

const seed = (id: string, name: string): Card =>
  battler(id, { name, hp: 70, types: ["Colorless"], retreat: 1 });
const evolved = (
  id: string,
  name: string,
  stage: "Stage1" | "Stage2",
  evolveFrom: string,
  hp: number,
  type: string,
  ability: string | null,
  attacks: Card["attacks"],
): Card =>
  battler(id, {
    name,
    stage,
    evolveFrom,
    hp,
    types: [type],
    retreat: 1,
    abilities:
      ability === null
        ? null
        : [
            {
              type: "Ability",
              name: ABILITIES.find(([, t]) => t === ability)?.[0] as string,
              effect: ability,
            },
          ],
    attacks,
  } as Partial<Card>);

const LOCAL: Record<string, Card> = {
  [ALAKAZAM[0]]: evolved(
    ALAKAZAM[0],
    "Alakazam",
    "Stage2",
    "Kadabra",
    140,
    "Psychic",
    PSYCHIC_DRAW_3,
    [
      {
        cost: ["Psychic"],
        name: "Powerful Hand",
        effect:
          "Place 2 damage counters on your opponent's Active Pokémon for each card in your hand.",
      },
    ],
  ),
  [KADABRA]: evolved(KADABRA, "Kadabra", "Stage1", "Abra", 80, "Psychic", PSYCHIC_DRAW_2, [
    { cost: ["Psychic"], name: "Super Psy Bolt", damage: 30 },
  ]),
  [BRAMBLEGHAST]: evolved(
    BRAMBLEGHAST,
    "Brambleghast",
    "Stage1",
    "Bramblin",
    100,
    "Psychic",
    PRISON_PANIC,
    [{ cost: ["Psychic", "Colorless", "Colorless"], name: "Psychic Sphere", damage: 80 }],
  ),
  [GRUMPIG]: evolved(GRUMPIG, "Grumpig", "Stage1", "Spoink", 120, "Psychic", ENERGIZED_STEPS, [
    { cost: ["Psychic", "Colorless", "Colorless"], name: "Psychic Sphere", damage: 60 },
  ]),
  [HARIYAMA]: evolved(
    HARIYAMA,
    "Hariyama",
    "Stage1",
    "Makuhita",
    150,
    "Fighting",
    HEAVE_HO_CATCHER,
    [
      {
        cost: ["Fighting", "Fighting", "Fighting"],
        name: "Wild Press",
        damage: 210,
        effect: "This Pokémon also does 70 damage to itself.",
      },
    ],
  ),
  [NINJASK[0]]: evolved(NINJASK[0], "Ninjask", "Stage1", "Nincada", 80, "Grass", CAST_OFF_SHELL, [
    {
      cost: ["Grass", "Colorless"],
      name: "U-turn",
      damage: 90,
      effect: "Switch this Pokémon with 1 of your Benched Pokémon.",
    },
  ]),
  [SHEDINJA]: evolved(SHEDINJA, "Shedinja", "Stage1", "Nincada", 60, "Psychic", null, [
    {
      cost: ["Psychic"],
      name: "Damage Beat",
      damage: "20×",
      effect:
        "This attack does 20 damage for each damage counter on your opponent's Active Pokémon.",
    },
  ]),
  [PRIMARINA[0]]: evolved(
    PRIMARINA[0],
    "Primarina",
    "Stage2",
    "Brionne",
    150,
    "Water",
    ENRICHING_MELODY,
    [{ cost: ["Water", "Colorless"], name: "Aqua Return", damage: 120, effect: SELF_SHUFFLE }],
  ),
  [SILCOON]: evolved(SILCOON, "Silcoon", "Stage1", "Wurmple", 90, "Grass", MULTIPLYING_COCOON, [
    { cost: ["Grass"], name: "Tackle", damage: 30 },
  ]),
  [CASCOON]: evolved(CASCOON, "Cascoon", "Stage1", "Wurmple", 90, "Grass", null, [
    {
      cost: ["Grass"],
      name: "Trading Places",
      effect: "Switch this Pokémon with 1 of your Benched Pokémon.",
    },
  ]),
  [TINKATUFF]: evolved(
    TINKATUFF,
    "Tinkatuff",
    "Stage1",
    "Tinkatink",
    90,
    "Metal",
    HAPHAZARD_HAMMER,
    [{ cost: ["Metal"], name: "Light Punch", damage: 30 }],
  ),
  [LOKIX]: evolved(LOKIX, "Lokix", "Stage1", "Nymble", 120, "Grass", null, [
    { cost: ["Grass"], name: "Low Kick", damage: 30 },
    {
      cost: ["Colorless", "Colorless", "Colorless"],
      name: "Jumping Shot",
      damage: 150,
      effect: SELF_SHUFFLE,
    },
  ]),
  [RARE_CANDY]: FIXTURE_POOL[RARE_CANDY] as Card,
  [FILLER]: battler(FILLER, { name: "D590 Filler", hp: 300, types: ["Colorless"], retreat: 1 }),
  [ABRA]: seed(ABRA, "Abra"),
  [BRAMBLIN]: seed(BRAMBLIN, "Bramblin"),
  [SPOINK]: seed(SPOINK, "Spoink"),
  [MAKUHITA]: seed(MAKUHITA, "Makuhita"),
  [NINCADA]: seed(NINCADA, "Nincada"),
  [BRIONNE]: battler(BRIONNE, {
    name: "Brionne",
    stage: "Stage1",
    evolveFrom: "Popplio",
    hp: 90,
    types: ["Water"],
  }),
  [WURMPLE]: seed(WURMPLE, "Wurmple"),
  [TINKATINK]: seed(TINKATINK, "Tinkatink"),
  [P]: typedEnergy(P, "Psychic"),
  [W]: typedEnergy(W, "Water"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [ALAKAZAM[0]]: 1,
  [KADABRA]: 2,
  [BRAMBLEGHAST]: 1,
  [GRUMPIG]: 1,
  [HARIYAMA]: 1,
  [NINJASK[0]]: 1,
  [SHEDINJA]: 2,
  [PRIMARINA[0]]: 1,
  [SILCOON]: 2,
  [CASCOON]: 1,
  [TINKATUFF]: 1,
  [LOKIX]: 1,
  [FILLER]: 12,
  [ABRA]: 1,
  [BRAMBLIN]: 1,
  [SPOINK]: 1,
  [MAKUHITA]: 1,
  [NINCADA]: 1,
  [BRIONNE]: 1,
  [WURMPLE]: 1,
  [TINKATINK]: 1,
  [P]: 8,
  [W]: 6,
  [RARE_CANDY]: 1,
  "fix-energy": 10,
});

/** Setup (P2 first), then P1's turn 4 — §4: nobody evolves on a first turn; both hands back into the
    decks and the Prizes swapped out for deck cards, so every named card is findable. */
function p1Turn(): GameState {
  let state = driveSetup(5901, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    let deck = [...side.deck, ...side.hand];
    const prizes = side.prizes.map((u) => {
      if ([FILLER, "fix-energy"].includes(state.cardIdByUid[u] as string)) return u;
      const swap = deck.find((d) =>
        [FILLER, "fix-energy"].includes(state.cardIdByUid[d] as string),
      );
      if (swap === undefined) throw new Error("no swap card");
      deck = [...deck.filter((d) => d !== swap), u];
      return swap;
    });
    state = { ...state, players: { ...state.players, [s]: { ...side, hand: [], prizes, deck } } };
  }
  return state;
}

/** P1: a FILLER Active and `bench` benched; P2: `oppActive` and `oppBench`; P1's hand is `hand`. */
function table(opts: {
  active?: string;
  bench?: readonly string[];
  oppActive?: string;
  oppBench?: readonly string[];
  hand: readonly string[];
}): GameState {
  let state = p1Turn();
  state = clearBench(setActiveFromDeck(state, "p1", opts.active ?? FILLER), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", opts.oppActive ?? FILLER), "p2");
  for (const id of opts.bench ?? []) state = benchFromDeck(state, "p1", id);
  for (const id of opts.oppBench ?? []) state = benchFromDeck(state, "p2", id);
  const side = state.players.p1;
  let deck = [...side.deck];
  const hand: string[] = [];
  for (const id of opts.hand) {
    const uid = deck.find((u) => state.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`p1 deck has no ${id}`);
    hand.push(uid);
    deck = deck.filter((u) => u !== uid);
  }
  return { ...state, players: { ...state.players, p1: { ...side, hand, deck } } };
}

const handUid = (state: GameState, id: string) =>
  state.players.p1.hand.find((u) => state.cardIdByUid[u] === id) as string;
const top = (state: GameState, body: InPlayPokemon | null | undefined) =>
  body === null || body === undefined
    ? undefined
    : state.cardIdByUid[body.stack[body.stack.length - 1] as string];
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];

/** Evolve P1's bench[0] (or the Active) into `id` from the hand. */
function evolve(
  state: GameState,
  id: string,
  target: { spot: "active" } | { spot: "bench"; index: number } = { spot: "bench", index: 0 },
) {
  return mustApply(state, { type: "evolve", seat: "p1", uid: handUid(state, id), target });
}
const resolve = (state: GameState, choice: unknown, seat: Seat = "p1") =>
  mustApply(state, { type: "resolveEffect", seat, choice } as GameAction);

/** An rng cursor whose first flip lands on `face`. */
function cursorFor(face: "heads" | "tails"): number {
  for (let n = 1; n < 1000; n++) if (flipCoin(n)[0] === face) return n;
  throw new Error("no cursor");
}

describe("D590 §3 — Psychic Draw: a real confirm, then the draw", () => {
  it("Kadabra onto Abra: the confirm carries the whole print; yes draws 2", () => {
    const parked = evolve(table({ bench: [ABRA], hand: [KADABRA] }), KADABRA);
    expect(of(parked.events, "ABILITY_TRIGGERED").map((e) => e.ability)).toEqual(["Psychic Draw"]);
    expect(effectPrompt(parked.state)).toStrictEqual({ kind: "confirm", note: PSYCHIC_DRAW_2 });
    const deck = parked.state.players.p1.deck.length;
    const done = resolve(parked.state, { kind: "confirm", yes: true }).state;
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.hand).toHaveLength(2);
    expect(done.players.p1.deck).toHaveLength(deck - 2);
  });

  it("decline: nothing is drawn", () => {
    const parked = evolve(table({ bench: [ABRA], hand: [KADABRA] }), KADABRA);
    const done = resolve(parked.state, { kind: "confirm", yes: false }).state;
    expect(done.players.p1.hand).toHaveLength(0);
    expect(done.players.p1.deck).toHaveLength(parked.state.players.p1.deck.length);
  });

  it("Alakazam onto Kadabra: yes draws 3", () => {
    const parked = evolve(table({ bench: [KADABRA], hand: [ALAKAZAM[0]] }), ALAKAZAM[0]);
    expect(effectPrompt(parked.state)).toStrictEqual({ kind: "confirm", note: PSYCHIC_DRAW_3 });
    expect(
      resolve(parked.state, { kind: "confirm", yes: true }).state.players.p1.hand,
    ).toHaveLength(3);
  });

  it("Rare Candy onto Abra (Basic → Stage 2): the same confirm, and yes draws 3", () => {
    const state = table({ bench: [ABRA], hand: [RARE_CANDY, ALAKAZAM[0]] });
    const parked = mustApply(state, {
      type: "rareCandy",
      seat: "p1",
      uid: handUid(state, RARE_CANDY),
      evolutionUid: handUid(state, ALAKAZAM[0]),
      target: { spot: "bench", index: 0 },
    });
    expect(top(parked.state, parked.state.players.p1.bench[0])).toBe(ALAKAZAM[0]);
    expect(of(parked.events, "ABILITY_TRIGGERED").map((e) => e.ability)).toEqual(["Psychic Draw"]);
    expect(effectPrompt(parked.state)).toStrictEqual({ kind: "confirm", note: PSYCHIC_DRAW_3 });
    expect(
      resolve(parked.state, { kind: "confirm", yes: true }).state.players.p1.hand,
    ).toHaveLength(3);
  });

  it("the parked confirm survives a JSON round trip (no new persisted key)", () => {
    const parked = evolve(table({ bench: [ABRA], hand: [KADABRA] }), KADABRA).state;
    const revived = roundTrip(parked);
    expect(resolve(revived, { kind: "confirm", yes: true }).state.players.p1.hand).toHaveLength(2);
  });
});

describe("D590 §4 — Prison Panic: a real confirm, then the opponent's Active is Confused", () => {
  /** P2's Active already carries `rotation` (an Asleep left by an earlier attack, a Paralysis from
      earlier this turn), the reachable board the confirm exists for. */
  const board = (rotation: "none" | "asleep" | "paralyzed") => {
    const state = table({ bench: [BRAMBLIN], hand: [BRAMBLEGHAST] });
    const active = state.players.p2.active as InPlayPokemon;
    return evolve(
      {
        ...state,
        players: {
          ...state.players,
          p2: {
            ...state.players.p2,
            active: { ...active, conditions: { ...active.conditions, rotation } },
          },
        },
      },
      BRAMBLEGHAST,
    );
  };

  it("the confirm carries the whole print; yes Confuses the Defending Pokémon", () => {
    const parked = board("none");
    expect(of(parked.events, "ABILITY_TRIGGERED").map((e) => e.ability)).toEqual(["Prison Panic"]);
    expect(effectPrompt(parked.state)).toStrictEqual({ kind: "confirm", note: PRISON_PANIC });
    const done = resolve(parked.state, { kind: "confirm", yes: true }).state;
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p2.active?.conditions.rotation).toBe("confused");
    expect(done.players.p1.active?.conditions.rotation).toBe("none");
  });

  it("decline keeps an Asleep or Paralyzed Defending Pokémon as it was; yes replaces it", () => {
    for (const rotation of ["asleep", "paralyzed"] as const) {
      const parked = board(rotation);
      const kept = resolve(parked.state, { kind: "confirm", yes: false }).state;
      expect(kept.phase.kind, rotation).toBe("turn:action");
      expect(kept.players.p2.active?.conditions.rotation, rotation).toBe(rotation);
      const taken = resolve(parked.state, { kind: "confirm", yes: true }).state;
      expect(taken.players.p2.active?.conditions.rotation, rotation).toBe("confused");
    }
  });
});

describe("D590 §5 — Energized Steps: the top 4, any number of Basic Energy, to any of your Pokémon", () => {
  it("offers exactly the Basic Energy among the top 4; two go to two bodies, the rest shuffled back", () => {
    let state = table({ bench: [SPOINK, FILLER], hand: [GRUMPIG] });
    state = toDeckTop(state, "p1", FILLER, 2);
    state = toDeckTop(state, "p1", P, 1);
    state = toDeckTop(state, "p1", W, 1);
    const window = state.players.p1.deck.slice(0, 4);
    const energy = window.filter((u) => [P, W].includes(state.cardIdByUid[u] as string));
    expect(energy).toHaveLength(2);
    const parked = evolve(state, GRUMPIG);
    const offer = effectPromptOf(parked.state, "attachCards");
    expect([...offer.candidates].sort()).toEqual([...energy].sort());
    const done = resolve(parked.state, {
      kind: "attachCards",
      assignments: [
        { uid: energy[0], to: { seat: "p1", spot: { spot: "active" } } },
        { uid: energy[1], to: { seat: "p1", spot: { spot: "bench", index: 1 } } },
      ],
    });
    expect(done.state.players.p1.active?.energy).toEqual([energy[0]]);
    expect(done.state.players.p1.bench[1]?.energy).toEqual([energy[1]]);
    expect(of(done.events, "SHUFFLE").map((e) => e.seat)).toContain("p1");
    expect(done.state.players.p1.deck).toHaveLength(state.players.p1.deck.length - 2);
  });

  it("taking none is a legal answer", () => {
    let state = table({ bench: [SPOINK], hand: [GRUMPIG] });
    state = toDeckTop(state, "p1", P, 1);
    const parked = evolve(state, GRUMPIG);
    const done = resolve(parked.state, { kind: "attachCards", assignments: [] }).state;
    expect(done.players.p1.active?.energy).toEqual([]);
    expect(done.players.p1.deck).toHaveLength(state.players.p1.deck.length);
  });
});

describe("D590 §6 — Heave-Ho Catcher: switch in 1 of the opponent's Benched Pokémon", () => {
  it("the chosen Benched body becomes the Defending Pokémon", () => {
    const parked = evolve(
      table({ bench: [MAKUHITA], oppBench: [ABRA, SPOINK], hand: [HARIYAMA] }),
      HARIYAMA,
    );
    const done = resolve(parked.state, {
      kind: "pokemon",
      ref: { seat: "p2", spot: { spot: "bench", index: 1 } },
    }).state;
    expect(top(done, done.players.p2.active)).toBe(SPOINK);
    expect(done.players.p2.bench.map((b) => top(done, b)).sort()).toEqual([ABRA, FILLER].sort());
  });

  it("an empty opponent Bench whiffs", () => {
    const { state } = evolve(table({ bench: [MAKUHITA], hand: [HARIYAMA] }), HARIYAMA);
    expect(state.phase.kind).toBe("turn:action");
    expect(top(state, state.players.p2.active)).toBe(FILLER);
  });
});

describe("D590 §7 — the two Bench searches: Cast-Off Shell and Multiplying Cocoon", () => {
  it("Ninjask: only a Shedinja is offered; it lands on the Bench as a new Pokémon and the deck is shuffled", () => {
    const parked = evolve(table({ bench: [NINCADA], hand: [NINJASK[0]] }), NINJASK[0]);
    const offer = effectPromptOf(parked.state, "chooseCards");
    const candidates = offer.candidates;
    expect(candidates.map((u) => parked.state.cardIdByUid[u])).toEqual([SHEDINJA, SHEDINJA]);
    expect(offer.max).toBe(1);
    const done = resolve(parked.state, { kind: "cards", uids: [candidates[0]] });
    expect(done.state.players.p1.bench.map((b) => top(done.state, b))).toEqual([
      NINJASK[0],
      SHEDINJA,
    ]);
    expect(done.state.players.p1.bench[1]?.stack).toEqual([candidates[0]]);
    expect(of(done.events, "SHUFFLE").map((e) => e.seat)).toContain("p1");
  });

  it("Silcoon: a Silcoon or a Cascoon, one card, onto the Bench", () => {
    const parked = evolve(table({ bench: [WURMPLE], hand: [SILCOON] }), SILCOON);
    const offer = effectPromptOf(parked.state, "chooseCards");
    const candidates = offer.candidates;
    expect(candidates.map((u) => parked.state.cardIdByUid[u]).sort()).toEqual(
      [CASCOON, SILCOON].sort(),
    );
    expect(offer.max).toBe(1);
    const cascoon = candidates.find((u) => parked.state.cardIdByUid[u] === CASCOON) as string;
    const done = resolve(parked.state, { kind: "cards", uids: [cascoon] }).state;
    expect(done.players.p1.bench.map((b) => top(done, b))).toEqual([SILCOON, CASCOON]);
  });

  it("a full Bench takes nothing", () => {
    const { state } = evolve(
      table({ bench: [NINCADA, FILLER, FILLER, FILLER, FILLER], hand: [NINJASK[0]] }),
      NINJASK[0],
    );
    expect(state.phase.kind).toBe("turn:action");
    expect(state.players.p1.bench).toHaveLength(5);
  });
});

describe("D590 §8 — Enriching Melody: heal all damage from 1 of your Pokémon", () => {
  it("the chosen body is healed in full; the other keeps its damage", () => {
    let state = table({ bench: [BRIONNE, FILLER], hand: [PRIMARINA[0]] });
    state = setDamage(state, "p1", 120);
    const side = state.players.p1;
    state = {
      ...state,
      players: {
        ...state.players,
        p1: { ...side, bench: side.bench.map((b, i) => (i === 1 ? { ...b, damage: 50 } : b)) },
      },
    };
    const parked = evolve(state, PRIMARINA[0]);
    const done = resolve(parked.state, {
      kind: "pokemon",
      ref: { seat: "p1", spot: { spot: "active" } },
    }).state;
    expect(done.players.p1.active?.damage).toBe(0);
    expect(done.players.p1.bench[1]?.damage).toBe(50);
  });
});

describe("D590 §9 — Haphazard Hammer: a coin, then an Energy off the opponent's Active", () => {
  const board = (face: "heads" | "tails") => {
    let state = table({ bench: [TINKATINK], hand: [TINKATUFF] });
    const side = state.players.p2;
    const energy = side.deck.filter((u) => state.cardIdByUid[u] === "fix-energy").slice(0, 2);
    state = {
      ...state,
      rngState: cursorFor(face),
      players: {
        ...state.players,
        p2: {
          ...side,
          deck: side.deck.filter((u) => !energy.includes(u)),
          active: side.active === null ? null : { ...side.active, energy },
        },
      },
    };
    return evolve(state, TINKATUFF);
  };

  it("heads: one Energy leaves the Defending Pokémon for its owner's discard pile", () => {
    const { state, events } = board("heads");
    expect(of(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result)).toEqual(["heads"]);
    expect(state.players.p2.active?.energy).toHaveLength(1);
    expect(state.players.p2.discard).toHaveLength(1);
  });

  it("tails: nothing moves", () => {
    const { state, events } = board("tails");
    expect(of(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result)).toEqual(["tails"]);
    expect(state.players.p2.active?.energy).toHaveLength(2);
  });
});

describe("D590 §10 — Jumping Shot and Aqua Return: the damage, then the attacker and its cards into the deck", () => {
  for (const [id, index, energy] of [
    [LOKIX, 1, [["fix-energy", 3]]],
    [
      PRIMARINA[0],
      0,
      [
        [W, 1],
        ["fix-energy", 1],
      ],
    ],
  ] as const) {
    it(`${id}: the printed damage lands, the body and its Energy go into the deck, and the Bench promotes`, () => {
      let state = table({ active: id, bench: [FILLER], hand: [] });
      for (const [e, n] of energy) state = attachFromDeck(state, "p1", e, n);
      const uids = [
        ...(state.players.p1.active?.stack ?? []),
        ...(state.players.p1.active?.energy ?? []),
      ];
      const deck = state.players.p1.deck.length;
      const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index });
      expect(of(events, "DAMAGE_DEALT")[0]?.dealt).toBe(id === LOKIX ? 150 : 120);
      for (const uid of uids) expect(after.players.p1.deck, uid).toContain(uid);
      expect(after.players.p1.deck).toHaveLength(deck + uids.length);
      expect(after.players.p1.discard).toEqual([]);
      expect(top(after, after.players.p1.active)).toBe(FILLER);
      expect(after.players.p1.bench).toHaveLength(0);
      expect(after.turn).toBe(state.turn + 1);
    });
  }
});

describe("D590 §10b — Aqua Return over an evolution stack", () => {
  it("Primarina over Brionne: the card under it goes into the deck with it", () => {
    let state = table({ active: PRIMARINA[0], bench: [FILLER], hand: [] });
    const side = state.players.p1;
    const brionne = side.deck.find((u) => state.cardIdByUid[u] === BRIONNE) as string;
    const active = side.active as InPlayPokemon;
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...side,
          deck: side.deck.filter((u) => u !== brionne),
          active: { ...active, stack: [brionne, ...active.stack] },
        },
      },
    };
    state = attachFromDeck(state, "p1", W, 1);
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    const deck = state.players.p1.deck.length;
    const { state: after } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(after.players.p1.deck).toContain(brionne);
    expect(after.players.p1.deck).toHaveLength(deck + 4);
    expect(after.players.p1.discard).toEqual([]);
    expect(top(after, after.players.p1.active)).toBe(FILLER);
  });
});
