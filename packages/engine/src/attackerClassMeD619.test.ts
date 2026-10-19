import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import { attackerGatedReductionOf, passivesOf } from "./continuous";
import { deriveAttackDamageBonus, deriveAttackEffect } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameAction, GameState, PokemonRef, Seat } from "./index";
import { conditionHolds } from "./interpreter";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  trainerCard,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D619 — WP12 (THE PASSIVE HALF) + WP15 ──
//
// 7 printed texts / 10 `me` printings. WP12: the attacker-gated post-W/R reduction, the NEW
// `PassiveEffects.damageReductionAfterWRFromAttacker` — Sacred Charm ×2 (a Tool, "Pokémon that have an
// Ability"), Thick Scale (a Tool on a {N} holder, {G}/{R}/{W}/{L} attackers) and Dewgong ×2 "Thick Fat"
// (an Ability, {R}/{W} attackers) — summed at the four §8.5 sites by `attackerGatedReductionOf`. WP15:
// D564's `youPlayedSupporterNamedThisTurn` behind three attack texts (Team Rocket's Kangaskhan ex
// "Wicked Impact", Espurr "Buddy Attack", Hippowdon "Twister Spewing") and Heliolisk ×2 "Frilled
// Generator". Every id and text off the LOCAL D1 (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-09,
// `legal_standard = 1`; none was referenced in the tree before this slice except Heliolisk's D611 pin.
// WP12's four ATTACK texts are dropped and named (a persisted attacker class — apps/api match.ts "STAYS
// 42 AT D619") [🆕🆕🆕 D630 (D539): BUILT at D630 (M1, MRV 43 → 44); §1's rung reads them now]. Driven on a LOCAL `cardPool` (D275) in the suite's OWN 60-card deck (D270).

const SACRED_TEXT =
  "The Pokémon this card is attached to takes 30 less damage from attacks from your opponent's Pokémon that have an Ability (after applying Weakness and Resistance).";
const SCALE_TEXT =
  "The {N} Pokémon this card is attached to takes 50 less damage from attacks from your opponent's {G}, {R}, {W}, or {L} Pokémon (after applying Weakness and Resistance).";
const FAT_TEXT =
  "This Pokémon takes 30 less damage from attacks from your opponent's {R} or {W} Pokémon (after applying Weakness and Resistance).";
const FRILLED_TEXT =
  "Once during your turn, if you played Canari from your hand this turn, you may use this Ability. Search your deck for up to 2 Basic {L} Energy cards and attach them to this Pokémon. Then, shuffle your deck.";
const WICKED =
  'If you played a Supporter card that has "Team Rocket" in its name from your hand during this turn, this attack does 100 more damage.';
const BUDDY = "If you played Emma from your hand during this turn, this attack does 60 more damage.";
const TWISTER = "If you played Tarragon from your hand during this turn, discard the top 3 cards of your opponent's deck.";

/** WP12's four dropped ATTACK texts (a persisted attacker class), with their printing counts. [🆕🆕🆕 D630 (D539): BUILT at D630.] */
const DROPPED: readonly (readonly [string, number])[] = [
  ["During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Burned Pokémon.", 1],
  ["During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Evolution Pokémon.", 2],
  [
    "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Pokémon that have an Ability.",
    1,
  ],
  [
    "During your opponent's next turn, this Pokémon takes 100 less damage from attacks from Evolution Pokémon (after applying Weakness and Resistance).",
    1,
  ],
];

const SACRED = ["me02-093", "me02-122"] as const;
const THICK_SCALE = "me02.5-211";
const DEWGONG = ["me02-022", "me02-097"] as const;
const HELIOLISK = ["me02.5-064", "me02.5-229"] as const;
const KANGASKHAN = "me02.5-162";
const ESPURR = "me04-036";
const HIPPOWDON = "me03-040";
const EMMA = "me04-077";
const ARIANA = "me02.5-202";
const TARRAGON = "me03-085";
const CANARI = "me02.5-185";
const JAMMING = "sv06-153";
const FLUTTER = "sv05-078";

const ABLE = "d619-able";
const PLAIN = "d619-plain";
const FIRE_ABLE = "d619-fire-able";
const TYPED = (type: string) => `d619-atk-${type.toLowerCase()}`;
const WALL = "d619-wall";
const WEAK = "d619-weak";
const DRAGON = "d619-dragon";
const L = "d619-lightning";
const F = "d619-fighting";
const P = "d619-psychic";

// The attacker's attacks, one per §8.5 site (D562's set): every cost is ONE {C}.
const BLAST = 0; // main hit, 120
const SHOCKWAVE = 1; // spreadDamage into the opponent's Bench, 120 each
const PINPOINT = 2; // placeSnipe `deals` arm, 120 to one chosen benched
const ARROW = 3; // opponentAny — snipeActive when the pick is the Active
const SELFSPLASH = 4; // spreadDamage into the attacker's OWN Bench
const FEINT = 5; // main hit that ignores effects on the opponent's Active
const FEINT_SNIPE = 6; // opponentAny ignoreWR
const JAB = 7; // main hit, 60

const BENCH_TAIL = " (Don't apply Weakness and Resistance for Benched Pokémon.)";
const ATTACKS = [
  { cost: ["Colorless"], name: "Blast", damage: 120 },
  {
    cost: ["Colorless"],
    name: "Shockwave",
    damage: 10,
    effect: "This attack does 120 damage to each of your opponent's Benched Pokémon.",
  },
  {
    cost: ["Colorless"],
    name: "Pinpoint",
    damage: 10,
    effect: `This attack also does 120 damage to 1 of your opponent's Benched Pokémon.${BENCH_TAIL}`,
  },
  {
    cost: ["Colorless"],
    name: "Arrow",
    effect: `This attack does 120 damage to 1 of your opponent's Pokémon.${BENCH_TAIL}`,
  },
  {
    cost: ["Colorless"],
    name: "Selfsplash",
    damage: 10,
    effect: `This attack also does 120 damage to each of your Benched Pokémon.${BENCH_TAIL}`,
  },
  {
    cost: ["Colorless"],
    name: "Feint",
    damage: 120,
    effect:
      "This attack's damage isn't affected by Weakness or Resistance, or by any effects on your opponent's Active Pokémon.",
  },
  {
    cost: ["Colorless"],
    name: "Feint Snipe",
    effect:
      "This attack does 120 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on that Pokémon.",
  },
  { cost: ["Colorless"], name: "Jab", damage: 60 },
];
const AURA = [{ type: "Ability", name: "D619 Aura", effect: "A test Ability with no program." }];

const tool = (id: string, name: string, effect: string): Card => ({ ...trainerCard(id, "Tool", effect), name });
const supporter = (id: string, name: string, effect: string): Card => ({
  ...trainerCard(id, "Supporter", effect),
  name,
});
const attacker = (id: string, name: string, type: string, extra: Partial<Card> = {}): Card =>
  battler(id, { name, types: [type], hp: 340, attacks: ATTACKS, ...extra } as Partial<Card>);

const LOCAL_CARDS: Record<string, Card> = {
  [SACRED[0]]: tool(SACRED[0], "Sacred Charm", SACRED_TEXT),
  [THICK_SCALE]: tool(THICK_SCALE, "Thick Scale", SCALE_TEXT),
  [JAMMING]: {
    ...trainerCard(JAMMING, "Stadium", "Pokémon Tools attached to each Pokémon (both yours and your opponent's) have no effect."),
    name: "Jamming Tower",
  },
  [DEWGONG[0]]: battler(DEWGONG[0], {
    name: "Dewgong",
    stage: "Stage1",
    evolveFrom: "Seel",
    hp: 130,
    types: ["Water"],
    retreat: 2,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    abilities: [{ type: "Ability", name: "Thick Fat", effect: FAT_TEXT }],
    attacks: [
      { cost: ["Water", "Colorless"], name: "Slam", damage: "70×", effect: "Flip 2 coins. This attack does 70 damage for each heads." },
    ],
  } as Partial<Card>),
  [HELIOLISK[0]]: battler(HELIOLISK[0], {
    name: "Heliolisk",
    stage: "Stage1",
    evolveFrom: "Helioptile",
    hp: 120,
    types: ["Lightning"],
    retreat: 1,
    abilities: [{ type: "Ability", name: "Frilled Generator", effect: FRILLED_TEXT }],
    attacks: [
      {
        cost: ["Lightning", "Colorless", "Colorless"],
        name: "Powerful Bolt",
        damage: "70×",
        effect: "Flip a coin for each Energy attached to this Pokémon. This attack does 70 damage for each heads.",
      },
    ],
  } as Partial<Card>),
  [KANGASKHAN]: battler(KANGASKHAN, {
    name: "Team Rocket's Kangaskhan ex",
    hp: 230,
    types: ["Colorless"],
    retreat: 2,
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Comet Punch", damage: "30×", effect: "Flip 4 coins. This attack does 30 damage for each heads." },
      { cost: ["Colorless", "Colorless", "Colorless"], name: "Wicked Impact", damage: "120+", effect: WICKED },
    ],
  } as Partial<Card>),
  [ESPURR]: battler(ESPURR, {
    name: "Espurr",
    hp: 60,
    types: ["Psychic"],
    retreat: 1,
    attacks: [{ cost: ["Psychic"], name: "Buddy Attack", damage: "10+", effect: BUDDY }],
  } as Partial<Card>),
  [HIPPOWDON]: battler(HIPPOWDON, {
    name: "Hippowdon",
    stage: "Stage1",
    evolveFrom: "Hippopotas",
    hp: 150,
    types: ["Fighting"],
    retreat: 4,
    attacks: [
      { cost: ["Fighting", "Fighting", "Colorless"], name: "Twister Spewing", damage: 80, effect: TWISTER },
      { cost: ["Fighting", "Fighting", "Colorless", "Colorless"], name: "Heavy Impact", damage: 130 },
    ],
  } as Partial<Card>),
  [EMMA]: supporter(EMMA, "Emma", "Your opponent reveals their hand, and you draw a card for each Pokémon you find there."),
  [ARIANA]: supporter(
    ARIANA,
    "Team Rocket's Ariana",
    "Draw cards until you have 5 cards in your hand. If all of your Pokémon in play are Team Rocket's Pokémon, draw cards until you have 8 cards in your hand instead.",
  ),
  [TARRAGON]: supporter(
    TARRAGON,
    "Tarragon",
    "Put up to 4 in any combination of {F} Pokémon and Basic {F} Energy cards from your discard pile into your hand.",
  ),
  [CANARI]: supporter(
    CANARI,
    "Canari",
    "You can use this card only if you discard another card from your hand.\n\nSearch your deck for up to 4 {L} Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
  ),
  [FLUTTER]: battler(FLUTTER, {
    name: "Flutter Mane",
    hp: 90,
    types: ["Psychic"],
    abilities: [
      {
        type: "Ability",
        name: "Midnight Fluttering",
        effect:
          "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities, except for Midnight Fluttering.",
      },
    ],
    attacks: ATTACKS,
  } as Partial<Card>),
  [ABLE]: attacker(ABLE, "D619 Able", "Colorless", { abilities: AURA } as Partial<Card>),
  [PLAIN]: attacker(PLAIN, "D619 Plain", "Colorless"),
  [FIRE_ABLE]: attacker(FIRE_ABLE, "D619 Fire Able", "Fire", { abilities: AURA } as Partial<Card>),
  ...Object.fromEntries(
    ["Grass", "Fire", "Water", "Lightning", "Psychic"].map((type) => [TYPED(type), attacker(TYPED(type), `D619 ${type}`, type)]),
  ),
  [WALL]: battler(WALL, { name: "D619 Wall", types: ["Colorless"], hp: 300 }),
  [WEAK]: battler(WEAK, { name: "D619 Weak", types: ["Colorless"], hp: 300, weaknesses: [{ type: "Colorless", value: "×2" }] }),
  [DRAGON]: battler(DRAGON, { name: "D619 Dragon", types: ["Dragon"], hp: 300 }),
  [L]: typedEnergy(L, "Lightning"),
  [F]: typedEnergy(F, "Fighting"),
  [P]: typedEnergy(P, "Psychic"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [SACRED[0]]: 2,
  [THICK_SCALE]: 1,
  [JAMMING]: 1,
  [DEWGONG[0]]: 1,
  [HELIOLISK[0]]: 1,
  [KANGASKHAN]: 1,
  [ESPURR]: 1,
  [HIPPOWDON]: 1,
  [EMMA]: 1,
  [ARIANA]: 1,
  [TARRAGON]: 1,
  [CANARI]: 1,
  [FLUTTER]: 1,
  [ABLE]: 1,
  [PLAIN]: 1,
  [FIRE_ABLE]: 1,
  [TYPED("Grass")]: 1,
  [TYPED("Fire")]: 1,
  [TYPED("Water")]: 1,
  [TYPED("Lightning")]: 1,
  [TYPED("Psychic")]: 1,
  [WALL]: 15,
  [WEAK]: 1,
  [DRAGON]: 1,
  [L]: 4,
  [F]: 3,
  [P]: 2,
  "fix-energy": 12,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup with p2 going first; returns p1's turn 2 after p2 passed, both hands back into the decks. */
function opened(): GameState {
  const created = createGame({ seed: 6190, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** TEST SURGERY — one copy of `id` into `seat`'s DECK (swapped out of the Prizes for the deck's
    bottom card when it is prized). Every uid stays in exactly one zone. */
function ensureInDeck(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  if (side.deck.some((u) => state.cardIdByUid[u] === id)) return state;
  const prized = side.prizes.find((u) => state.cardIdByUid[u] === id);
  const swap = side.deck.find((u) => !side.prizes.includes(u) && state.cardIdByUid[u] === WALL);
  if (prized === undefined || swap === undefined) throw new Error(`${seat} has no ${id} to seat`);
  const next = {
    ...side,
    prizes: side.prizes.map((u) => (u === prized ? swap : u)),
    deck: [...side.deck.filter((u) => u !== swap), prized],
  };
  return { ...state, players: { ...state.players, [seat]: next } };
}

type Body = { id: string; tool?: string };

/** p1's turn 2: `attacker` (with `energy`, one {C} by default) against `defender`; each side's Bench
    EXACTLY the bodies named, each body carrying its Tool. */
function table(opts: {
  attacker?: string;
  energy?: readonly (readonly [string, number])[];
  defender?: Body;
  bench?: Body[];
  ownBench?: Body[];
}): GameState {
  let state = opened();
  // Both setup Actives back into the decks first (a WALL stands in), so every named card is findable.
  for (const s of ["p1", "p2"] as const) state = clearBench(setActiveFromDeck(state, s, WALL), s);
  const atk = opts.attacker ?? ABLE;
  state = setActiveFromDeck(ensureInDeck(state, "p1", atk), "p1", atk);
  const defender = opts.defender ?? { id: WALL };
  state = setActiveFromDeck(ensureInDeck(state, "p2", defender.id), "p2", defender.id);
  state = clearBench(clearBench(state, "p1"), "p2");
  if (defender.tool !== undefined) {
    state = attachToolFromDeck(ensureInDeck(state, "p2", defender.tool), "p2", "active", defender.tool);
  }
  for (const [seat, bodies] of [
    ["p2", opts.bench ?? []],
    ["p1", opts.ownBench ?? []],
  ] as const) {
    for (const [i, body] of bodies.entries()) {
      state = benchFromDeck(ensureInDeck(state, seat, body.id), seat, body.id);
      if (body.tool !== undefined) {
        state = attachToolFromDeck(ensureInDeck(state, seat, body.tool), seat, i, body.tool);
      }
    }
  }
  for (const [id, n] of opts.energy ?? [["fix-energy", 1]]) state = attachFromDeck(state, "p1", id, n);
  return state;
}

/** TEST SURGERY — `id` into the shared Stadium zone, owned by `owner`. */
function stadium(state: GameState, id: string, owner: Seat = "p1"): GameState {
  const ensured = ensureInDeck(state, owner, id);
  const side = ensured.players[owner];
  const uid = side.deck.find((u) => ensured.cardIdByUid[u] === id) as string;
  return {
    ...ensured,
    stadium: { uid, owner },
    players: { ...ensured.players, [owner]: { ...side, deck: side.deck.filter((u) => u !== uid) } },
  };
}

/** One copy of `id` from p1's deck into p1's hand; the uid. */
function toHand(state: GameState, id: string): { state: GameState; uid: string } {
  const ensured = ensureInDeck(state, "p1", id);
  const side = ensured.players.p1;
  const uid = side.deck.find((u) => ensured.cardIdByUid[u] === id) as string;
  const p1 = { ...side, deck: side.deck.filter((u) => u !== uid), hand: [...side.hand, uid] };
  return { state: { ...ensured, players: { ...ensured.players, p1 } }, uid };
}

/** Play `id` (a Supporter) from p1's hand through the real `playTrainer` path. */
function play(state: GameState, id: string): GameState {
  const { state: held, uid } = toHand(state, id);
  return mustApply(held, { type: "playTrainer", seat: "p1", uid }).state;
}

/** TEST SURGERY — `id` was played from p1's hand this turn: the card into p1's discard and the
    allowance bag stamped exactly as `playTrainer` stamps it (D564's `supporterPlayedUid`). For the two
    Supporters whose own programs park (Tarragon's pick, Canari's hand cost). */
function played(state: GameState, id: string): GameState {
  const ensured = ensureInDeck(state, "p1", id);
  const side = ensured.players.p1;
  const uid = side.deck.find((u) => ensured.cardIdByUid[u] === id) as string;
  const p1 = { ...side, deck: side.deck.filter((u) => u !== uid), discard: [...side.discard, uid] };
  return {
    ...ensured,
    players: { ...ensured.players, p1 },
    allowances: { ...ensured.allowances, supporterPlayed: true, supporterPlayedUid: uid },
  };
}

const swing = (state: GameState, index: number) => mustApply(state, { type: "attack", seat: "p1", index });
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const activeDamage = (state: GameState, seat: Seat = "p2") => state.players[seat].active?.damage;
const benchDamage = (state: GameState, seat: Seat, i: number) => state.players[seat].bench[i]?.damage;

/** Swing a snipe and answer its pick with the body at `spot` on p2's board. */
function snipe(state: GameState, index: number, spot: PokemonRef["spot"]) {
  const { state: parked } = swing(state, index);
  if (parked.phase.kind !== "effect:choose") throw new Error(`expected a pick, got ${parked.phase.kind}`);
  const prompt = parked.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti") throw new Error(`expected choosePokemonMulti, got ${prompt.kind}`);
  const ref = prompt.candidates.find((c) => c.seat === "p2" && JSON.stringify(c.spot) === JSON.stringify(spot));
  if (ref === undefined) throw new Error("the spot is not a candidate");
  return mustApply(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemonMulti", refs: [ref] } });
}
const BENCH0: PokemonRef["spot"] = { spot: "bench", index: 0 };
const ACTIVE: PokemonRef["spot"] = { spot: "active" };

// ────────────────────────────────────────────────────────────────────────────
describe("D619 §1 — the prints, the registry rows and the readings", () => {
  it("the four passive / Ability objects, one per printed text, on the 7 `me` ids", () => {
    expect(programFor(SACRED[0])).toEqual({
      passive: { damageReductionAfterWRFromAttacker: { amount: 30, attacker: { kind: "abilityPokemon" } } },
    });
    expect(programFor(SACRED[1])).toBe(programFor(SACRED[0]));
    expect(programFor(THICK_SCALE)).toEqual({
      passive: {
        damageReductionAfterWRFromAttacker: {
          amount: 50,
          attacker: {
            kind: "anyOf",
            filters: ["Grass", "Fire", "Water", "Lightning"].map((pokemonType) => ({ kind: "typedPokemon", pokemonType })),
          },
          holderType: "Dragon",
        },
      },
    });
    expect(programFor(DEWGONG[0])).toEqual({
      passive: {
        damageReductionAfterWRFromAttacker: {
          amount: 30,
          attacker: {
            kind: "anyOf",
            filters: [
              { kind: "typedPokemon", pokemonType: "Fire" },
              { kind: "typedPokemon", pokemonType: "Water" },
            ],
          },
        },
      },
    });
    expect(programFor(DEWGONG[1])).toBe(programFor(DEWGONG[0]));
    expect(programFor(HELIOLISK[0])).toEqual({
      abilities: [
        {
          name: "Frilled Generator",
          oncePerTurn: true,
          activeOnly: false,
          playableIf: { kind: "youPlayedSupporterNamedThisTurn", name: "Canari" },
          program: [
            { op: "attachFromDeck", filter: { kind: "basicEnergy", energyType: "Lightning" }, max: 2, toSelf: true },
            { op: "shuffleDeck" },
          ],
        },
      ],
    });
    expect(programFor(HELIOLISK[1])).toBe(programFor(HELIOLISK[0]));
    // The three attack texts are reader rows: no registry key.
    for (const id of [KANGASKHAN, ESPURR, HIPPOWDON]) expect(programFor(id), id).toBeUndefined();
  });

  it("the three attack texts: rows of the `me` corpus, none printed in `sv`, each now read", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const text of [WICKED, BUDDY, TWISTER]) {
      expect([text, me.get(text)]).toEqual([text, 1]);
      expect(sv.has(text), text).toBe(false);
      expect(resolvedByAnyReader(text), text).toBe(true);
    }
    const bonus = (text: string) => {
      const read = deriveAttackDamageBonus(text);
      return read?.count.kind === "boardCondition" ? [read.per, read.count.cond] : read;
    };
    expect(bonus(WICKED)).toEqual([100, { kind: "youPlayedSupporterNamedThisTurn", nameContains: "Team Rocket" }]);
    expect(bonus(BUDDY)).toEqual([60, { kind: "youPlayedSupporterNamedThisTurn", name: "Emma" }]);
    expect(deriveAttackEffect(TWISTER)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "youPlayedSupporterNamedThisTurn", name: "Tarragon" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        then: [{ op: "discardDeckTop", whose: "opponent", count: 3 }],
      },
    ]);
  });

  it("the near misses stay unread: literal rows, and a clause no row claims leaves the mill unread", () => {
    for (const near of [
      "If you played Emma from your hand this turn, this attack does 60 more damage.",
      "If you played Lacey from your hand during this turn, this attack does 60 more damage.",
      'If you played a Supporter card that has "Team Plasma" in its name from your hand during this turn, this attack does 100 more damage.',
      "If you played Rare Candy from your hand during this turn, discard the top 3 cards of your opponent's deck.",
      "If you played Tarragon from your hand during this turn, discard the top 0 cards of your opponent's deck.",
    ]) {
      expect(resolvedByAnyReader(near), near).toBe(false);
    }
  });

  it("WP12's four ATTACK texts are dropped: corpus rows, still unread (🆕🆕🆕 D630 (D539): WITHDRAWN — all four read at D630, MRV 43 → 44, `persistedRecordsMeD630.test.ts`)", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    for (const [text, n] of DROPPED) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect(resolvedByAnyReader(text), text).toBe(true); // 🆕🆕🆕 D630 — reader-built
    }
    for (const id of ["me05-007", "me05-024", "me05-089", "me04-033", "me05-064"]) expect(programFor(id), id).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D619 §2 — Sacred Charm at the MAIN HIT: 30 less from an opposing Pokémon that has an Ability", () => {
  it("🛑 an attacker with an Ability: 120 → 90; one without: 120", () => {
    expect(activeDamage(swing(table({ defender: { id: WALL, tool: SACRED[0] } }), BLAST).state)).toBe(90);
    expect(activeDamage(swing(table({ attacker: PLAIN, defender: { id: WALL, tool: SACRED[0] } }), BLAST).state)).toBe(120);
  });

  it("🛑 AFTER Weakness: a ×2 holder takes 60 × 2 − 30 = 90 (before it would be 60)", () => {
    expect(activeDamage(swing(table({ defender: { id: WEAK, tool: SACRED[0] } }), JAB).state)).toBe(90);
  });

  it("🛑 Jamming Tower: the Tool has no effect — 120 lands", () => {
    const state = stadium(table({ defender: { id: WALL, tool: SACRED[0] } }), JAMMING);
    expect(activeDamage(swing(state, BLAST).state)).toBe(120);
  });

  it("🛑 Feint (`suppressTargetEffects`) drops it with the catalog half", () => {
    expect(activeDamage(swing(table({ defender: { id: WALL, tool: SACRED[0] } }), FEINT).state)).toBe(120);
  });

  it("the holder fold carries the reduction for any holder (no holder gate)", () => {
    const state = table({ defender: { id: WALL, tool: SACRED[0] } });
    expect(passivesOf(state, state.players.p2.active as NonNullable<GameState["players"]["p2"]["active"]>).damageReductionsFromAttacker).toEqual([
      { amount: 30, attacker: { kind: "abilityPokemon" } },
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D619 §3 — Thick Scale: a {N} holder takes 50 less from opposing {G} / {R} / {W} / {L}", () => {
  it("🛑 each printed type pays 50; {P} pays nothing", () => {
    for (const type of ["Grass", "Fire", "Water", "Lightning"]) {
      const state = table({ attacker: TYPED(type), defender: { id: DRAGON, tool: THICK_SCALE } });
      expect([type, activeDamage(swing(state, BLAST).state)]).toEqual([type, 70]);
    }
    const psychic = table({ attacker: TYPED("Psychic"), defender: { id: DRAGON, tool: THICK_SCALE } });
    expect(activeDamage(swing(psychic, BLAST).state)).toBe(120);
  });

  it("🛑 THE HOLDER GATE — on a non-{N} holder it does nothing (and the fold carries nothing)", () => {
    const state = table({ attacker: TYPED("Fire"), defender: { id: WALL, tool: THICK_SCALE } });
    expect(passivesOf(state, state.players.p2.active as NonNullable<GameState["players"]["p2"]["active"]>).damageReductionsFromAttacker).toEqual([]);
    expect(activeDamage(swing(state, BLAST).state)).toBe(120);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D619 §4 — Dewgong \"Thick Fat\": 30 less from opposing {R} or {W}", () => {
  it("🛑 {R} and {W} pay 30; {G} pays nothing", () => {
    expect(activeDamage(swing(table({ attacker: TYPED("Fire"), defender: { id: DEWGONG[0] } }), BLAST).state)).toBe(90);
    expect(activeDamage(swing(table({ attacker: TYPED("Water"), defender: { id: DEWGONG[0] } }), BLAST).state)).toBe(90);
    expect(activeDamage(swing(table({ attacker: TYPED("Grass"), defender: { id: DEWGONG[0] } }), BLAST).state)).toBe(120);
  });

  it("🛑 an Ability: Flutter Mane's lock on the opposing Active silences it", () => {
    const control = table({ attacker: TYPED("Fire"), defender: { id: DEWGONG[0] } });
    const locked = table({ attacker: FLUTTER, defender: { id: DEWGONG[0] } });
    const fold = (state: GameState) =>
      passivesOf(state, state.players.p2.active as NonNullable<GameState["players"]["p2"]["active"]>).damageReductionsFromAttacker;
    expect(fold(control)).toHaveLength(1);
    expect(fold(locked)).toEqual([]);
  });

  it("🛑 two sources SUM: Thick Fat + Sacred Charm against a {R} attacker that has an Ability: 120 − 60", () => {
    const state = table({ attacker: FIRE_ABLE, defender: { id: DEWGONG[0], tool: SACRED[0] } });
    expect(activeDamage(swing(state, BLAST).state)).toBe(60);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D619 §5 — the three interpreter sites, and \"your opponent's\"", () => {
  it("🛑 spreadDamage: the Charm holder takes 90, its neighbour 120", () => {
    const state = table({ bench: [{ id: WALL, tool: SACRED[0] }, { id: WALL }] });
    const done = swing(state, SHOCKWAVE).state;
    expect([benchDamage(done, "p2", 0), benchDamage(done, "p2", 1)]).toEqual([90, 120]);
  });

  it("🛑 placeSnipe `deals`: the picked Charm holder takes 90", () => {
    const state = table({ bench: [{ id: WALL, tool: SACRED[0] }, { id: WALL }] });
    expect(benchDamage(snipe(state, PINPOINT, BENCH0).state, "p2", 0)).toBe(90);
  });

  it("🛑 snipeActive: the picked Active Charm holder takes 90; under `ignoreWR` (Feint Snipe) 120", () => {
    const state = table({ defender: { id: WALL, tool: SACRED[0] }, bench: [{ id: WALL }] });
    expect(activeDamage(snipe(state, ARROW, ACTIVE).state)).toBe(90);
    expect(activeDamage(snipe(state, FEINT_SNIPE, ACTIVE).state)).toBe(120);
  });

  it("🛑 an OWN-SIDE splash: \"your opponent's\" — the attacker's own Charm holder takes the full 120", () => {
    const state = table({ ownBench: [{ id: WALL, tool: SACRED[0] }] });
    expect(benchDamage(swing(state, SELFSPLASH).state, "p1", 0)).toBe(120);
  });

  it("`attackerGatedReductionOf`: an unresolvable attacker or the holder's own seat answers 0", () => {
    const state = table({ defender: { id: WALL, tool: SACRED[0] } });
    const holder = state.players.p2.active as NonNullable<GameState["players"]["p2"]["active"]>;
    const list = passivesOf(state, holder).damageReductionsFromAttacker;
    const able = POOL[ABLE];
    expect(attackerGatedReductionOf(state, holder, list, able, "p1")).toBe(30);
    expect(attackerGatedReductionOf(state, holder, list, undefined, "p1")).toBe(0);
    expect(attackerGatedReductionOf(state, holder, list, able, "p2")).toBe(0);
    expect(attackerGatedReductionOf(state, holder, [], able, "p1")).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D619 §6 — WP15's attack texts on D564's named-Supporter member", () => {
  it("🛑 Wicked Impact: +100 after a Team Rocket's Supporter (Ariana, played); 120 after Emma or nothing", () => {
    const board = () => table({ attacker: KANGASKHAN, energy: [["fix-energy", 3]] });
    expect(activeDamage(swing(play(board(), ARIANA), 1).state)).toBe(220);
    expect(activeDamage(swing(play(board(), EMMA), 1).state)).toBe(120);
    expect(activeDamage(swing(board(), 1).state)).toBe(120);
  });

  it("🛑 Buddy Attack: +60 after Emma (played); 10 after Ariana or nothing", () => {
    const board = () => table({ attacker: ESPURR, energy: [[P, 1]] });
    expect(activeDamage(swing(play(board(), EMMA), 0).state)).toBe(70);
    expect(activeDamage(swing(play(board(), ARIANA), 0).state)).toBe(10);
    expect(activeDamage(swing(board(), 0).state)).toBe(10);
  });

  it("🛑 Twister Spewing: after Tarragon the opponent's top 3 go to their discard; otherwise only the 80", () => {
    const board = () => table({ attacker: HIPPOWDON, energy: [[F, 2], ["fix-energy", 1]] });
    const before = board();
    const deckTop = before.players.p2.deck.slice(0, 3);
    const { state: after, events } = swing(played(before, TARRAGON), 0);
    expect(activeDamage(after)).toBe(80);
    expect(of(events, "DECK_TOP_DISCARDED")).toEqual([{ type: "DECK_TOP_DISCARDED", seat: "p2", actor: "p1", uids: deckTop }]);
    for (const uid of deckTop) expect(after.players.p2.discard).toContain(uid);
    for (const other of [board(), play(board(), EMMA)]) {
      const { state: done, events: none } = swing(other, 0);
      expect(activeDamage(done)).toBe(80);
      expect(of(none, "DECK_TOP_DISCARDED")).toEqual([]);
    }
  });

  it("the member is the turn owner's: the OPPONENT reads false on p1's Emma", () => {
    const state = play(table({ attacker: ESPURR, energy: [[P, 1]] }), EMMA);
    expect(conditionHolds(state, "p1", { kind: "youPlayedSupporterNamedThisTurn", name: "Emma" })).toBe(true);
    expect(conditionHolds(state, "p2", { kind: "youPlayedSupporterNamedThisTurn", name: "Emma" })).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D619 §7 — Heliolisk \"Frilled Generator\": after Canari, up to 2 Basic {L} from the deck to itself", () => {
  const use = (state: GameState) =>
    applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Frilled Generator",
    } as GameAction);
  const code = (result: ReturnType<typeof applyAction>) => (result.ok ? "applied" : result.error.code);
  const board = () => table({ attacker: WALL, ownBench: [{ id: HELIOLISK[0] }] });

  it("🛑 after Canari: offers only Basic {L} Energy, two land on Heliolisk, the deck is shuffled; once per turn", () => {
    const parked = must(use(played(board(), CANARI)));
    if (parked.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${parked.phase.kind}`);
    const prompt = parked.phase.prompt as unknown as { kind: string; max: number; candidates: string[] };
    expect(prompt.kind).toBe("attachCards");
    expect(prompt.max).toBe(2);
    expect(new Set(prompt.candidates.map((u) => parked.cardIdByUid[u]))).toEqual(new Set([L]));
    const to = { seat: "p1", spot: { spot: "bench", index: 0 } };
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: prompt.candidates.slice(0, 2).map((uid) => ({ uid, to })) },
    } as GameAction);
    expect(done.state.players.p1.bench[0]?.energy.map((u) => done.state.cardIdByUid[u])).toEqual([L, L]);
    expect(of(done.events, "SHUFFLE").some((e) => (e as { seat: Seat }).seat === "p1")).toBe(true);
    expect(code(use(done.state))).toBe("ABILITY_ALREADY_USED");
  });

  it("🛑 refused with no Supporter, and after another Supporter (Emma, played)", () => {
    expect(code(use(board()))).toBe("ABILITY_CONDITION_NOT_MET");
    expect(code(use(play(board(), EMMA)))).toBe("ABILITY_CONDITION_NOT_MET");
  });
});

describe("D619 §8 — the version", () => {
  it("is built at engine 0.532.0", () => {
    expect(engineVersion).toBe("0.532.0");
  });
});
