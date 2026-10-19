import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import {
  effectiveAttackCost,
  healLocked,
  opposingAttackDebuff,
  opposingToolAttackDebuff,
  seatShieldedFromLowEnergyAttacker,
  selfIgnoresColorlessCost,
  selfPreWRBonusPerOpponentPrize,
} from "./continuous";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameState, PokemonRef, Seat } from "./index";
import { conditionHolds } from "./interpreter";
import { programFor } from "./registry";
import { flipCoin } from "./rng";
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
  setConditions,
  setDamage,
  setPrizes,
  specialEnergy,
  trainerCard,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D631 — P1, THE REST OF THE PASSIVE MODIFIERS ──
//
// 6 printed Ability texts / 9 printings (`me` + `30th`), each on a NEW registry object: Bastiodon ×3 "Ancient
// Bulwark" (a side shield from a benched holder, gated on the attacker's Energy count), Decidueye ex ×2 "Sniper's
// Eye" (every {C} ignored while the opponent holds exactly 4 cards), Kingambit "Supreme Overlord" (+30 before W/R
// per Prize the opponent has taken), Garbodor "Gloomy Garbage" (−20 before W/R off a Tool-carrying opposing
// Active), Yveltal "Life-Locked" (the opponent's Active can't be healed, at every heal site) and Snorlax "Good
// Sleep" (a Checkup heal while still Asleep, on the NEW `BoardCondition` `yourActiveAsleep`). Every id and text off
// the LOCAL D1 (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-10, `legal_standard = 1`. Before this slice the
// ids appeared only in D610's unkeyed pins (Snorlax nowhere). Driven on a LOCAL `cardPool` (D275) in the suite's
// OWN 60-card deck (D270).

const BULWARK_TEXT =
  "As long as this Pokémon is on your Bench, prevent all damage done to each of your Pokémon by attacks from your opponent's Pokémon that have 2 or less Energy attached.";
const SNIPER_TEXT =
  "If your opponent has exactly 4 cards in their hand, ignore all {C} Energy in the costs of attacks used by this Pokémon.";
const OVERLORD_TEXT =
  "Attacks used by this Pokémon do 30 more damage to your opponent's Active Pokémon for each Prize card your opponent has taken (before applying Weakness and Resistance).";
const GARBAGE_TEXT =
  "Attacks used by your opponent's Active Pokémon that has a Pokémon Tool attached do 20 less damage (before applying Weakness and Resistance).";
const LOCKED_TEXT = "Your opponent's Active Pokémon can't be healed.";
const SLEEP_TEXT = "If this Pokémon remains Asleep during Pokémon Checkup, heal all damage from this Pokémon.";

const BASTIODON = ["mep-085", "me05-062", "me05-093"] as const;
const DECIDUEYE = ["me03-012", "me03-100"] as const;
const KINGAMBIT = "me02.5-148";
const GARBODOR = "me04-057";
const YVELTAL = "30th-100";
const SNORLAX = "30th-119";
const POTION = "sv01-188";
const KLEFKI = "sv01-096";
const GARGANACL = "sv02-123";
const FLUTTER = "sv05-078";
const SEISMITOAD = "sv03-052";
const JAMMING = "sv06-153";
const PICNIC = "sv01-184"; // Picnic Basket — `healEachAll`
const MAGEARNA = "sv09-107"; // Magearna "Auto Heal" — `healSubject` (a REAL id: the registry row must resolve)
const TR_ENERGY = "sv10-182"; // Team Rocket's Energy — ONE card, TWO units

const ATK = "d631-attacker";
const TR_ATK = "d631-tr-attacker";
const WALL = "d631-wall";
const METAL_WEAK = "d631-metal-weak";
const TOOL = "d631-tool";
const G = "d631-grass";
const M = "d631-metal";

// The attacker's attacks, one per §8.5 site (D619's set): every cost is ONE {C}.
const BLAST = 0; // main hit, 120
const SHOCKWAVE = 1; // spreadDamage into the opponent's Bench, 120 each
const PINPOINT = 2; // placeSnipe `deals` arm, 120 to one chosen benched
const ARROW = 3; // opponentAny — snipeActive when the pick is the Active
const SELFSPLASH = 4; // spreadDamage into the attacker's OWN Bench
const FEINT_SNIPE = 5; // opponentAny ignoreWR
const MEND = 6; // "Heal 30 damage from this Pokémon." — healSelf
const EDGE = 7; // main hit, 120, the D192 sentence (`suppressTargetEffects`)

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
    name: "Feint Snipe",
    effect:
      "This attack does 120 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on that Pokémon.",
  },
  { cost: ["Colorless"], name: "Mend", effect: "Heal 30 damage from this Pokémon." },
  {
    cost: ["Colorless"],
    name: "Edge",
    damage: 120,
    effect: "This attack's damage isn't affected by any effects on your opponent's Active Pokémon.",
  },
];

const LOCAL_CARDS: Record<string, Card> = {
  [BASTIODON[0]]: battler(BASTIODON[0], {
    name: "Bastiodon",
    stage: "Stage2",
    evolveFrom: "Shieldon",
    hp: 160,
    types: ["Metal"],
    retreat: 4,
    weaknesses: [{ type: "Fire", value: "x2" }],
    resistances: [{ type: "Grass", value: "-30" }],
    abilities: [{ type: "Ability", name: "Ancient Bulwark", effect: BULWARK_TEXT }],
    attacks: [{ cost: ["Metal", "Metal", "Colorless"], name: "Hammer In", damage: 160 }],
  } as Partial<Card>),
  [DECIDUEYE[0]]: battler(DECIDUEYE[0], {
    name: "Decidueye ex",
    stage: "Stage2",
    evolveFrom: "Dartrix",
    hp: 320,
    types: ["Grass"],
    retreat: 2,
    suffix: "ex",
    weaknesses: [{ type: "Fire", value: "×2" }],
    abilities: [{ type: "Ability", name: "Sniper's Eye", effect: SNIPER_TEXT }],
    attacks: [
      {
        cost: ["Grass", "Colorless", "Colorless", "Colorless"],
        name: "Crushing Arrow",
        damage: 240,
        effect: "Discard an Energy from your opponent's Active Pokémon.",
      },
    ],
  } as Partial<Card>),
  [KINGAMBIT]: battler(KINGAMBIT, {
    name: "Kingambit",
    stage: "Stage2",
    evolveFrom: "Bisharp",
    hp: 170,
    types: ["Metal"],
    retreat: 3,
    weaknesses: [{ type: "Fire", value: "×2" }],
    resistances: [{ type: "Grass", value: "-30" }],
    abilities: [{ type: "Ability", name: "Supreme Overlord", effect: OVERLORD_TEXT }],
    attacks: [
      {
        cost: ["Metal", "Metal"],
        name: "Double-Edged Slash",
        damage: 180,
        effect: "This Pokémon also does 50 damage to itself.",
      },
    ],
  } as Partial<Card>),
  [GARBODOR]: battler(GARBODOR, {
    name: "Garbodor",
    stage: "Stage1",
    evolveFrom: "Trubbish",
    hp: 140,
    types: ["Darkness"],
    retreat: 3,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    abilities: [{ type: "Ability", name: "Gloomy Garbage", effect: GARBAGE_TEXT }],
    attacks: [{ cost: ["Darkness", "Darkness", "Colorless"], name: "Sludge Bomb", damage: 100 }],
  } as Partial<Card>),
  [YVELTAL]: battler(YVELTAL, {
    name: "Yveltal",
    hp: 120,
    types: ["Darkness"],
    retreat: 1,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    abilities: [{ type: "Ability", name: "Life-Locked", effect: LOCKED_TEXT }],
    attacks: [{ cost: ["Darkness", "Colorless", "Colorless"], name: "Dark Cutter", damage: 90 }],
  } as Partial<Card>),
  [SNORLAX]: battler(SNORLAX, {
    name: "Snorlax",
    hp: 160,
    types: ["Colorless"],
    retreat: 4,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    abilities: [{ type: "Ability", name: "Good Sleep", effect: SLEEP_TEXT }],
    attacks: [
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Collapse",
        damage: 130,
        effect: "This Pokémon is now Asleep.",
      },
    ],
  } as Partial<Card>),
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
  [JAMMING]: {
    ...trainerCard(JAMMING, "Stadium", "Pokémon Tools attached to each Pokémon (both yours and your opponent's) have no effect."),
    name: "Jamming Tower",
  },
  [ATK]: battler(ATK, { name: "D631 Attacker", types: ["Colorless"], hp: 340, attacks: ATTACKS } as Partial<Card>),
  [TR_ATK]: battler(TR_ATK, { name: "Team Rocket's D631 Attacker", types: ["Colorless"], hp: 340, attacks: ATTACKS } as Partial<Card>),
  [TR_ENERGY]: specialEnergy(
    TR_ENERGY,
    "Team Rocket's Energy",
    "This card can only be attached to a Team Rocket's Pokémon. If this card is attached to anything other than a Team Rocket's Pokémon, discard this card.\n\nAs long as this card is attached to a Pokémon, it provides 2 in any combination of {P} Energy and {D} Energy.",
  ),
  [MAGEARNA]: battler(MAGEARNA, {
    name: "Magearna",
    hp: 90,
    retreat: 1,
    types: ["Metal"],
    abilities: [
      {
        type: "Ability",
        name: "Auto Heal",
        effect:
          "As long as this Pokémon is in the Active Spot, whenever you attach an Energy card from your hand to 1 of your Pokémon, heal 90 damage from that Pokémon.",
      },
    ],
    attacks: [{ name: "Spike Draw", cost: ["Colorless"], damage: "20", effect: "Draw 2 cards." }],
  } as Partial<Card>),
  [WALL]: battler(WALL, { name: "D631 Wall", types: ["Colorless"], hp: 400 }),
  [METAL_WEAK]: battler(METAL_WEAK, {
    name: "D631 Metal Weak",
    types: ["Colorless"],
    hp: 600,
    weaknesses: [{ type: "Metal", value: "×2" }],
  } as Partial<Card>),
  [TOOL]: { ...trainerCard(TOOL, "Tool", "A test Tool with no program."), name: "D631 Tool" },
  [G]: typedEnergy(G, "Grass"),
  [M]: typedEnergy(M, "Metal"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [BASTIODON[0]]: 2,
  [DECIDUEYE[0]]: 1,
  [KINGAMBIT]: 1,
  [GARBODOR]: 2,
  [YVELTAL]: 1,
  [SNORLAX]: 1,
  [FLUTTER]: 1,
  [KLEFKI]: 1,
  [GARGANACL]: 1,
  [SEISMITOAD]: 1,
  [POTION]: 2,
  [JAMMING]: 1,
  [ATK]: 1,
  [TR_ATK]: 1,
  [TR_ENERGY]: 2,
  [MAGEARNA]: 1,
  [PICNIC]: 1,
  [METAL_WEAK]: 1,
  [TOOL]: 2,
  [WALL]: 15,
  [G]: 2,
  [M]: 3,
  "fix-energy": 16,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup with p2 going first; returns p1's turn 2 after p2 passed, both hands back into the decks. */
function opened(): GameState {
  const created = createGame({ seed: 6310, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** TEST SURGERY — one copy of `id` into `seat`'s DECK (swapped out of the Prizes for a deck WALL when it is
    prized). Every uid stays in exactly one zone. */
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

/** p1's turn 2: `attacker` (with `energy`, one {C} by default) against `defender`; each side's Bench EXACTLY the
    bodies named, each carrying its Tool. */
function table(opts: {
  attacker?: Body;
  energy?: readonly (readonly [string, number])[];
  defender?: Body;
  bench?: Body[];
  ownBench?: Body[];
}): GameState {
  let state = opened();
  for (const s of ["p1", "p2"] as const) state = clearBench(setActiveFromDeck(state, s, WALL), s);
  const atk = opts.attacker ?? { id: ATK };
  state = setActiveFromDeck(ensureInDeck(state, "p1", atk.id), "p1", atk.id);
  const defender = opts.defender ?? { id: WALL };
  state = setActiveFromDeck(ensureInDeck(state, "p2", defender.id), "p2", defender.id);
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const [seat, body] of [
    ["p1", atk],
    ["p2", defender],
  ] as const) {
    if (body.tool !== undefined) state = attachToolFromDeck(ensureInDeck(state, seat, body.tool), seat, "active", body.tool);
  }
  for (const [seat, bodies] of [
    ["p2", opts.bench ?? []],
    ["p1", opts.ownBench ?? []],
  ] as const) {
    for (const [i, body] of bodies.entries()) {
      state = benchFromDeck(ensureInDeck(state, seat, body.id), seat, body.id);
      if (body.tool !== undefined) state = attachToolFromDeck(ensureInDeck(state, seat, body.tool), seat, i, body.tool);
    }
  }
  for (const [id, n] of opts.energy ?? [["fix-energy", 1]]) state = attachFromDeck(state, "p1", id, n);
  return state;
}

/** TEST SURGERY — `seat`'s hand is exactly `count` cards off the top of its deck. */
function handOf(state: GameState, seat: Seat, count: number): GameState {
  const side = state.players[seat];
  const all = [...side.hand, ...side.deck];
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, hand: all.slice(0, count), deck: all.slice(count) } },
  };
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

/** TEST SURGERY — set bench[index]'s damage on `seat`. */
function benchDamaged(state: GameState, seat: Seat, index: number, damage: number): GameState {
  const side = state.players[seat];
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, bench: side.bench.map((p, i) => (i === index ? { ...p, damage } : p)) },
    },
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

/** p1 plays a Potion from hand onto `spot` (its own board); the resulting state and events. */
function potion(state: GameState, spot: PokemonRef["spot"]) {
  const ensured = ensureInDeck(state, "p1", POTION);
  const side = ensured.players.p1;
  const uid = side.deck.find((u) => ensured.cardIdByUid[u] === POTION) as string;
  const held = {
    ...ensured,
    players: { ...ensured.players, p1: { ...side, deck: side.deck.filter((u) => u !== uid), hand: [...side.hand, uid] } },
  };
  const played = mustApply(held, { type: "playTrainer", seat: "p1", uid });
  if (played.state.phase.kind !== "effect:choose") return played;
  const ref: PokemonRef = { seat: "p1", spot };
  const resolved = mustApply(played.state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } });
  return { state: resolved.state, events: [...played.events, ...resolved.events] };
}

/** p1 plays the no-choice Item `id` from hand. */
function playItem(state: GameState, id: string) {
  const ensured = ensureInDeck(state, "p1", id);
  const side = ensured.players.p1;
  const uid = side.deck.find((u) => ensured.cardIdByUid[u] === id) as string;
  const held = {
    ...ensured,
    players: { ...ensured.players, p1: { ...side, deck: side.deck.filter((u) => u !== uid), hand: [...side.hand, uid] } },
  };
  return mustApply(held, { type: "playTrainer", seat: "p1", uid });
}

/** p1 attaches a `fix-energy` from hand onto `spot` (its own board). */
function attachFromHand(state: GameState, spot: PokemonRef["spot"]) {
  const side = state.players.p1;
  const uid = side.deck.find((u) => state.cardIdByUid[u] === "fix-energy") as string;
  const held = {
    ...state,
    players: { ...state.players, p1: { ...side, deck: side.deck.filter((u) => u !== uid), hand: [...side.hand, uid] } },
  };
  return mustApply(held, { type: "attachEnergy", seat: "p1", uid, target: spot });
}

/** An `rngState` whose next flip is `face`. */
function seedFor(face: "heads" | "tails"): number {
  for (let seed = 1; seed < 1000; seed++) if (flipCoin(seed)[0] === face) return seed;
  throw new Error("no seed");
}

// ────────────────────────────────────────────────────────────────────────────
describe("D631 §1 — the prints and the registry rows", () => {
  it("six objects, one per printed text, on the 9 ids; reprints share the object", () => {
    expect(programFor(BASTIODON[0])).toEqual({ passive: { preventSeatDamageWhileBenchedFromEnergyAtMost: 2 } });
    for (const id of BASTIODON) expect(programFor(id), id).toBe(programFor(BASTIODON[0]));
    expect(programFor(DECIDUEYE[0])).toEqual({ passive: { ignoreColorlessCostIfOpponentHandExactly: 4 } });
    expect(programFor(DECIDUEYE[1])).toBe(programFor(DECIDUEYE[0]));
    expect(programFor(KINGAMBIT)).toEqual({ passive: { damageBonusBeforeWRPerOpponentPrize: 30 } });
    expect(programFor(GARBODOR)).toEqual({ passive: { opponentActiveToolAttackDebuff: 20 } });
    expect(programFor(YVELTAL)).toEqual({ passive: { opponentActiveCantBeHealed: true } });
    expect(programFor(SNORLAX)).toEqual({
      triggered: [
        {
          name: "Good Sleep",
          trigger: "betweenTurns",
          activeOnly: true,
          program: [
            {
              op: "conditionGate",
              cond: { kind: "yourActiveAsleep" },
              // biome-ignore lint/suspicious/noThenProperty: the effect gate's step list, not a thenable.
              then: [{ op: "heal", target: "self", amount: "all" }],
            },
          ],
        },
      ],
    });
  });
});

describe("D631 §2 — Ancient Bulwark: a benched holder shields its whole side from attackers with 2 or less Energy", () => {
  it("the main hit: 1 or 2 Energy prevented, 3 Energy lands; an Active holder shields nothing", () => {
    for (const [n, expected] of [
      [1, 0],
      [2, 0],
      [3, 120],
    ] as const) {
      const board = table({ energy: [["fix-energy", n]], bench: [{ id: BASTIODON[0] }] });
      expect(activeDamage(swing(board, BLAST).state), `${n} Energy`).toBe(expected);
    }
    const active = table({ defender: { id: BASTIODON[0] } });
    expect(activeDamage(swing(active, BLAST).state)).toBe(120);
  });

  it("the spread: every benched body is shielded, the holder included; an own-Bench spread lands", () => {
    const board = table({ bench: [{ id: BASTIODON[0] }, { id: WALL }] });
    const after = swing(board, SHOCKWAVE).state;
    expect([benchDamage(after, "p2", 0), benchDamage(after, "p2", 1)]).toEqual([0, 0]);
    expect(activeDamage(after)).toBe(0);
    const own = table({ ownBench: [{ id: BASTIODON[0] }, { id: WALL }] });
    const splashed = swing(own, SELFSPLASH).state;
    expect([benchDamage(splashed, "p1", 0), benchDamage(splashed, "p1", 1)]).toEqual([120, 120]);
  });

  it("the snipes: a benched pick and the Active pick are shielded; 3 Energy lands", () => {
    const board = table({ bench: [{ id: WALL }, { id: BASTIODON[0] }] });
    expect(benchDamage(snipe(board, PINPOINT, BENCH0).state, "p2", 0)).toBe(0);
    expect(activeDamage(snipe(board, ARROW, ACTIVE).state)).toBe(0);
    const charged = table({ energy: [["fix-energy", 3]], bench: [{ id: WALL }, { id: BASTIODON[0] }] });
    expect(benchDamage(snipe(charged, PINPOINT, BENCH0).state, "p2", 0)).toBe(120);
  });

  it("a Feint snipe on the holder drops its OWN shield, not a second holder's (D254's scope)", () => {
    const alone = table({ bench: [{ id: BASTIODON[0] }] });
    expect(benchDamage(snipe(alone, FEINT_SNIPE, BENCH0).state, "p2", 0)).toBe(120);
    const pair = table({ bench: [{ id: BASTIODON[0] }, { id: BASTIODON[0] }] });
    expect(benchDamage(snipe(pair, FEINT_SNIPE, BENCH0).state, "p2", 0)).toBe(0);
  });

  it("the count is CARDS, not units: two Team Rocket's Energy (4 units) are 2 Energy, and the hit is prevented", () => {
    const board = table({ attacker: { id: TR_ATK }, energy: [[TR_ENERGY, 2]], bench: [{ id: BASTIODON[0] }] });
    const attacker = board.players.p1.active;
    if (attacker === null) throw new Error("no Active");
    expect(attacker.energy).toHaveLength(2);
    expect(activeDamage(swing(board, BLAST).state)).toBe(0);
  });

  it("the scan: the seat test and an unresolvable attacker", () => {
    const board = table({ bench: [{ id: BASTIODON[0] }] });
    const defender = board.players.p2.active;
    const attacker = board.players.p1.active;
    if (defender === null || attacker === null) throw new Error("no Actives");
    expect(seatShieldedFromLowEnergyAttacker(board, defender, attacker, "p1", "all")).toBe(true);
    expect(seatShieldedFromLowEnergyAttacker(board, defender, attacker, "p2", "all")).toBe(false);
    expect(seatShieldedFromLowEnergyAttacker(board, defender, undefined, "p1", "all")).toBe(false);
  });
});

describe("D631 §3 — Sniper's Eye: every {C} ignored while the opponent holds exactly 4 cards", () => {
  const decidueye = (hand: number) =>
    handOf(table({ attacker: { id: DECIDUEYE[0] }, energy: [[G, 1]] }), "p2", hand);

  it("4 cards: the cost is {G} and Crushing Arrow resolves on one {G}; 3 or 5: the printed cost stands", () => {
    const four = decidueye(4);
    const body = four.players.p1.active;
    if (body === null) throw new Error("no Active");
    const printed = ["Grass", "Colorless", "Colorless", "Colorless"];
    expect(effectiveAttackCost(four, body, printed)).toEqual(["Grass"]);
    expect(selfIgnoresColorlessCost(four, body)).toBe(true);
    expect(activeDamage(swing(four, 0).state)).toBe(240);
    for (const n of [3, 5]) {
      const other = decidueye(n);
      const active = other.players.p1.active;
      if (active === null) throw new Error("no Active");
      expect(effectiveAttackCost(other, active, printed), `${n} cards`).toEqual(printed);
      const refused = applyAction(other, { type: "attack", seat: "p1", index: 0 });
      expect(refused.ok, `${n} cards`).toBe(false);
    }
  });

  it("a surcharge's {C} goes too (R-SNE1); a §9 lock restores the printed cost", () => {
    const toad = handOf(table({ attacker: { id: DECIDUEYE[0] }, defender: { id: SEISMITOAD }, energy: [[G, 1]] }), "p2", 4);
    const body = toad.players.p1.active;
    if (body === null) throw new Error("no Active");
    expect(effectiveAttackCost(toad, body, ["Grass", "Colorless", "Colorless", "Colorless"])).toEqual(["Grass"]);
    const locked = handOf(table({ attacker: { id: DECIDUEYE[0] }, defender: { id: FLUTTER }, energy: [[G, 1]] }), "p2", 4);
    const held = locked.players.p1.active;
    if (held === null) throw new Error("no Active");
    expect(selfIgnoresColorlessCost(locked, held)).toBe(false);
    expect(effectiveAttackCost(locked, held, ["Grass", "Colorless"])).toEqual(["Grass", "Colorless"]);
  });
});

describe("D631 §4 — Supreme Overlord: +30 before W/R per Prize the opponent has taken", () => {
  const kingambit = (opponentPrizes: number, defender: string = WALL) =>
    setPrizes(table({ attacker: { id: KINGAMBIT }, defender: { id: defender }, energy: [[M, 2]] }), "p2", opponentPrizes);

  it("0, 2 and 5 taken: 180, 240, 330", () => {
    for (const [prizes, expected] of [
      [6, 180],
      [4, 240],
      [1, 330],
    ] as const) {
      expect(activeDamage(swing(kingambit(prizes), 0).state), `${6 - prizes} taken`).toBe(expected);
    }
  });

  it("before Weakness: (180 + 60) × 2 = 480; the holder's own Prizes do not count", () => {
    expect(activeDamage(swing(kingambit(4, METAL_WEAK), 0).state)).toBe(480);
    const own = setPrizes(kingambit(6), "p1", 2);
    expect(activeDamage(swing(own, 0).state)).toBe(180);
  });

  it("the scan reads the holder's opponent and a §9 lock silences it", () => {
    const board = kingambit(3);
    const body = board.players.p1.active;
    if (body === null) throw new Error("no Active");
    expect(selfPreWRBonusPerOpponentPrize(board, body)).toBe(90);
    // Flutter Mane (90 HP, its Midnight Fluttering silencing the Active Kingambit) is Knocked Out, so the
    // DAMAGE_DEALT row's `bonus` is the witness, against the same row on a Wall.
    const locked = setPrizes(table({ attacker: { id: KINGAMBIT }, defender: { id: FLUTTER }, energy: [[M, 2]] }), "p2", 3);
    expect(of(swing(locked, 0).events, "DAMAGE_DEALT")[0]?.bonus).toBeUndefined();
    const free = kingambit(3);
    expect(of(swing(free, 0).events, "DAMAGE_DEALT")[0]?.bonus).toBe(90);
  });
});

describe("D631 §5 — Gloomy Garbage: −20 before W/R off a Tool-carrying opposing Active's attacks", () => {
  it("a Tool on the attacker: 100; none: 120; Garbodor on the attacker's side: 120", () => {
    expect(activeDamage(swing(table({ attacker: { id: ATK, tool: TOOL }, bench: [{ id: GARBODOR }] }), BLAST).state)).toBe(100);
    expect(activeDamage(swing(table({ bench: [{ id: GARBODOR }] }), BLAST).state)).toBe(120);
    expect(activeDamage(swing(table({ attacker: { id: ATK, tool: TOOL }, ownBench: [{ id: GARBODOR }] }), BLAST).state)).toBe(120);
  });

  it("an Active Garbodor counts, two holders stack, the spread is weakened too", () => {
    expect(
      activeDamage(swing(table({ attacker: { id: ATK, tool: TOOL }, defender: { id: GARBODOR } }), BLAST).state),
    ).toBe(100);
    const two = table({ attacker: { id: ATK, tool: TOOL }, bench: [{ id: GARBODOR }, { id: GARBODOR }] });
    expect(activeDamage(swing(two, BLAST).state)).toBe(80);
    const spread = swing(table({ attacker: { id: ATK, tool: TOOL }, bench: [{ id: GARBODOR }, { id: WALL }] }), SHOCKWAVE).state;
    expect([benchDamage(spread, "p2", 0), benchDamage(spread, "p2", 1)]).toEqual([100, 100]);
  });

  it("under Jamming Tower the Tool is still attached; a §9 lock on Garbodor switches it off", () => {
    const jammed = stadium(table({ attacker: { id: ATK, tool: TOOL }, bench: [{ id: GARBODOR }] }), JAMMING);
    const body = jammed.players.p1.active;
    if (body === null) throw new Error("no Active");
    expect(opposingToolAttackDebuff(jammed, body)).toBe(20);
    expect(opposingAttackDebuff(jammed, body)).toBe(0);
    const locked = table({ attacker: { id: FLUTTER, tool: TOOL }, defender: { id: GARBODOR } });
    expect(activeDamage(swing(locked, BLAST).state)).toBe(120);
  });
});

describe("D631 §5b — Gloomy Garbage under a clause that ignores effects on the target: only the target's own term goes (R-GG1)", () => {
  const armed = (opts: { defender?: Body; bench?: Body[] }) => table({ attacker: { id: ATK, tool: TOOL }, ...opts });

  it("the snipes without one: a benched Garbodor weakens the benched pick and the Active pick", () => {
    const board = armed({ bench: [{ id: WALL }, { id: GARBODOR }] });
    expect(benchDamage(snipe(board, PINPOINT, BENCH0).state, "p2", 0)).toBe(100);
    expect(activeDamage(snipe(board, ARROW, ACTIVE).state)).toBe(100);
  });

  it("a Feint snipe aimed elsewhere keeps a benched Garbodor's −20, at the Active and at another benched pick", () => {
    const board = armed({ bench: [{ id: WALL }, { id: GARBODOR }] });
    expect(activeDamage(snipe(board, FEINT_SNIPE, ACTIVE).state)).toBe(100);
    expect(benchDamage(snipe(board, FEINT_SNIPE, BENCH0).state, "p2", 0)).toBe(100);
  });

  it("a Feint snipe on a Garbodor drops that Garbodor's own −20, benched or Active; a second holder's stays", () => {
    expect(benchDamage(snipe(armed({ bench: [{ id: GARBODOR }] }), FEINT_SNIPE, BENCH0).state, "p2", 0)).toBe(120);
    expect(activeDamage(snipe(armed({ defender: { id: GARBODOR }, bench: [{ id: WALL }] }), FEINT_SNIPE, ACTIVE).state)).toBe(120);
    const pair = armed({ bench: [{ id: GARBODOR }, { id: GARBODOR }] });
    expect(benchDamage(snipe(pair, FEINT_SNIPE, BENCH0).state, "p2", 0)).toBe(100);
  });

  it("the main hit under the D192 sentence: a defending Garbodor's −20 goes, a benched one's stays", () => {
    expect(activeDamage(swing(armed({ defender: { id: GARBODOR } }), EDGE).state)).toBe(120);
    expect(activeDamage(swing(armed({ bench: [{ id: GARBODOR }] }), EDGE).state)).toBe(100);
    expect(activeDamage(swing(armed({ defender: { id: GARBODOR } }), BLAST).state)).toBe(100);
  });

  it("the scan's `exceptHolder` drops that holder alone", () => {
    const board = armed({ defender: { id: GARBODOR }, bench: [{ id: GARBODOR }] });
    const body = board.players.p1.active;
    const defender = board.players.p2.active;
    if (body === null || defender === null) throw new Error("no Actives");
    expect(opposingToolAttackDebuff(board, body)).toBe(40);
    expect(opposingToolAttackDebuff(board, body, defender)).toBe(20);
  });
});

describe("D631 §6 — Life-Locked: the opponent's Active can't be healed, at every heal site", () => {
  it("Potion (`healChosen`): the locked Active heals 0 and files nothing; a Benched body heals", () => {
    const board = setDamage(table({ defender: { id: YVELTAL }, ownBench: [{ id: WALL }] }), "p1", 60);
    const { state, events } = potion(board, ACTIVE);
    expect(activeDamage(state, "p1")).toBe(60);
    expect(of(events, "HEALED")).toEqual([]);
    const benched = benchDamaged(table({ defender: { id: YVELTAL }, ownBench: [{ id: WALL }] }), "p1", 0, 60);
    expect(benchDamage(potion(benched, BENCH0).state, "p1", 0)).toBe(30);
  });

  it("the attack's self-heal (`healSelf`) heals 0; with no Yveltal it heals 30; Yveltal on the Bench locks too", () => {
    const locked = setDamage(table({ bench: [{ id: YVELTAL }] }), "p1", 60);
    expect(activeDamage(swing(locked, MEND).state, "p1")).toBe(60);
    const free = setDamage(table({}), "p1", 60);
    expect(activeDamage(swing(free, MEND).state, "p1")).toBe(30);
  });

  it("Garganacl's Checkup heal (`healEach`) skips the locked Active and heals the Bench", () => {
    let board = table({ defender: { id: YVELTAL }, ownBench: [{ id: GARGANACL }] });
    board = benchDamaged(setDamage(board, "p1", 60), "p1", 0, 60);
    const after = mustApply(board, { type: "endTurn", seat: "p1" }).state;
    expect(activeDamage(after, "p1")).toBe(60);
    expect(benchDamage(after, "p1", 0)).toBe(40);
  });

  it("Picnic Basket (`healEachAll`): the locked Active heals 0, its Bench and the Yveltal side heal", () => {
    let board = setDamage(table({ defender: { id: YVELTAL }, ownBench: [{ id: WALL }] }), "p1", 60);
    board = setDamage(benchDamaged(board, "p1", 0, 60), "p2", 60);
    const { state, events } = playItem(board, PICNIC);
    expect(activeDamage(state, "p1")).toBe(60);
    expect(benchDamage(state, "p1", 0)).toBe(30);
    expect(activeDamage(state, "p2")).toBe(30);
    expect(of(events, "HEALED").map((e) => e.seat)).toEqual(["p1", "p2"]);
  });

  it("Magearna's Auto Heal (`healSubject`): an attach to the locked Active heals 0, to the Bench heals", () => {
    const board = setDamage(table({ attacker: { id: MAGEARNA }, defender: { id: YVELTAL }, ownBench: [{ id: WALL }] }), "p1", 60);
    const onActive = attachFromHand(board, ACTIVE);
    expect(activeDamage(onActive.state, "p1")).toBe(60);
    expect(of(onActive.events, "HEALED")).toEqual([]);
    const onBench = attachFromHand(benchDamaged(board, "p1", 0, 60), BENCH0);
    expect(benchDamage(onBench.state, "p1", 0)).toBe(0);
    const free = setDamage(table({ attacker: { id: MAGEARNA } }), "p1", 60);
    expect(activeDamage(attachFromHand(free, ACTIVE).state, "p1")).toBe(0);
  });

  it("a §9 lock on Yveltal lifts it: Klefki locks the Basic Yveltal and the Potion heals", () => {
    const board = setDamage(table({ attacker: { id: KLEFKI }, defender: { id: YVELTAL } }), "p1", 60);
    const body = board.players.p1.active;
    if (body === null) throw new Error("no Active");
    expect(healLocked(board, body)).toBe(false);
    expect(activeDamage(potion(board, ACTIVE).state, "p1")).toBe(30);
    const unlocked = setDamage(table({ defender: { id: YVELTAL } }), "p1", 60);
    const held = unlocked.players.p1.active;
    if (held === null) throw new Error("no Active");
    expect(healLocked(unlocked, held)).toBe(true);
    expect(healLocked(unlocked, unlocked.players.p2.active ?? held)).toBe(false);
  });
});

describe("D631 §7 — Good Sleep: still Asleep at the Checkup, heal all damage", () => {
  const sleeper = (opts: { asleep: boolean; face: "heads" | "tails"; defender?: string }) => {
    let board = setDamage(table({ attacker: { id: SNORLAX }, defender: { id: opts.defender ?? WALL } }), "p1", 100);
    if (opts.asleep) board = setConditions(board, "p1", { rotation: "asleep" });
    return { ...board, rngState: seedFor(opts.face) };
  };

  it("tails (still Asleep): heals all 100; heads (woke up): no heal; not Asleep: no heal", () => {
    const slept = mustApply(sleeper({ asleep: true, face: "tails" }), { type: "endTurn", seat: "p1" });
    expect(activeDamage(slept.state, "p1")).toBe(0);
    expect(of(slept.events, "HEALED").map((e) => e.amount)).toEqual([100]);
    const woke = mustApply(sleeper({ asleep: true, face: "heads" }), { type: "endTurn", seat: "p1" });
    expect(activeDamage(woke.state, "p1")).toBe(100);
    const awake = mustApply(sleeper({ asleep: false, face: "tails" }), { type: "endTurn", seat: "p1" });
    expect(activeDamage(awake.state, "p1")).toBe(100);
    expect(of(awake.events, "ABILITY_TRIGGERED").map((e) => e.ability)).toContain("Good Sleep");
  });

  it("the condition reads the seat's Active through `presentStatuses`", () => {
    const board = sleeper({ asleep: true, face: "tails" });
    expect(conditionHolds(board, "p1", { kind: "yourActiveAsleep" })).toBe(true);
    expect(conditionHolds(board, "p2", { kind: "yourActiveAsleep" })).toBe(false);
  });

  it("Life-Locked composes: an opposing Yveltal stops the heal", () => {
    const locked = mustApply(sleeper({ asleep: true, face: "tails", defender: YVELTAL }), { type: "endTurn", seat: "p1" });
    expect(activeDamage(locked.state, "p1")).toBe(100);
    expect(of(locked.events, "HEALED")).toEqual([]);
  });

  it("Collapse puts Snorlax to sleep, and the Checkup that follows can heal it", () => {
    const board = { ...table({ attacker: { id: SNORLAX }, energy: [["fix-energy", 3]] }), rngState: seedFor("tails") };
    const swung = swing(setDamage(board, "p1", 50), 0);
    expect(swung.state.players.p1.active?.conditions.rotation).toBe("asleep");
    expect(activeDamage(swung.state, "p1")).toBe(0);
    expect(of(swung.events, "HEALED").map((e) => e.amount)).toEqual([50]);
  });
});

describe("D631 §8 — the version", () => {
  it("is built at engine 0.542.0", () => {
    expect(engineVersion).toBe("0.542.0");
  });
});
