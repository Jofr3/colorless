// Inline card fixtures + drivers for the engine tests: a tiny fake catalog
// (nothing fetched) and helpers that script the deterministic setup flow.
// Not exported from the package index — test-only, but framework-free
// (plain throws) so any suite can use it.

import type { Card } from "@luminous/schema";
import type {
  ApplyResult,
  ErrorCode,
  GameAction,
  GameEvent,
  GameState,
  Seat,
  SpecialConditions,
} from "./index";
import { SEATS, applyAction, cardOfUid, createGame, isBasicPokemon, topUid } from "./index";
import { makeInPlay, withActive } from "./types";

const blank: Omit<Card, "id" | "name" | "category"> = {
  setId: "fix",
  localId: "0",
  image: null,
  illustrator: null,
  rarity: null,
  regulationMark: null,
  hp: null,
  stage: null,
  evolveFrom: null,
  types: null,
  retreat: null,
  abilities: null,
  attacks: null,
  weaknesses: null,
  resistances: null,
  trainerType: null,
  energyType: null,
  effect: null,
  legal: { standard: true, expanded: true },
  variants: null,
};

export function basicPokemon(id: string, retreat: number): Card {
  return {
    ...blank,
    id,
    name: id,
    category: "Pokemon",
    stage: "Basic",
    hp: 60,
    types: ["Colorless"],
    retreat,
  };
}

export function stage1Pokemon(id: string): Card {
  return {
    ...blank,
    id,
    name: id,
    category: "Pokemon",
    stage: "Stage1",
    hp: 90,
    types: ["Colorless"],
    retreat: 2,
    evolveFrom: "fix-basic-1",
  };
}

/** A Stage 2 that evolves from `fix-stage1` — the top of the M4 evolution
    chain (fix-basic-1 → fix-stage1 → fix-stage2). */
export function stage2Pokemon(id: string): Card {
  return {
    ...blank,
    id,
    name: id,
    category: "Pokemon",
    stage: "Stage2",
    hp: 140,
    types: ["Colorless"],
    retreat: 3,
    evolveFrom: "fix-stage1",
  };
}

export function basicEnergy(id: string): Card {
  return { ...blank, id, name: id, category: "Energy", energyType: "Normal" };
}

/** A Basic Energy of a real type. The NAME is the datum ("Fire Energy"):
    catalog basics carry no `types`, so the engine derives provision from it
    (cards.ts energyProvidesOf) — the unnamed `basicEnergy` above therefore
    provides Colorless, which the M1 suites rely on. */
export function typedEnergy(id: string, type: string): Card {
  return { ...blank, id, name: `${type} Energy`, category: "Energy", energyType: "Normal" };
}

export function itemTrainer(id: string): Card {
  return { ...blank, id, name: id, category: "Trainer", trainerType: "Item" };
}

/** A Trainer of a given type. Used with the REAL catalog ids the M4 registry
    authors (sv01-189, …) so `programFor(id)` finds the program — the `effect`
    text is cosmetic here (the registry keys on the id, not the text). */
export function trainerCard(id: string, trainerType: string, effect: string): Card {
  return { ...blank, id, name: id, category: "Trainer", trainerType, effect };
}

/** A battle-ready Basic: a 60 HP Colorless body whose combat data (attacks,
    types, hp, weakness/resistance) each M2 matchup overrides. */
export function battler(id: string, overrides: Partial<Card> = {}): Card {
  return {
    ...blank,
    id,
    name: id,
    category: "Pokemon",
    stage: "Basic",
    hp: 60,
    types: ["Colorless"],
    retreat: 1,
    ...overrides,
  };
}

export const FIXTURE_POOL: Record<string, Card> = {
  "fix-basic-0": basicPokemon("fix-basic-0", 0),
  "fix-basic-1": basicPokemon("fix-basic-1", 1),
  "fix-basic-2": basicPokemon("fix-basic-2", 2),
  "fix-stage1": stage1Pokemon("fix-stage1"),
  "fix-stage2": stage2Pokemon("fix-stage2"),
  "fix-energy": basicEnergy("fix-energy"),
  "fix-item": itemTrainer("fix-item"),
  "fix-fire-energy": typedEnergy("fix-fire-energy", "Fire"),
  "fix-water-energy": typedEnergy("fix-water-energy", "Water"),
  // The M2 cast: one Fire attacker with a spread of printed-attack shapes,
  // and defenders that exercise each §8.5 damage-pipeline branch.
  "fix-attacker": battler("fix-attacker", {
    types: ["Fire"],
    hp: 120,
    attacks: [
      { cost: ["Colorless"], name: "Bite", damage: 30 },
      { cost: ["Fire", "Colorless"], name: "Flame", damage: 60 },
      // The canonical modern print — effects.ts derives it (M3), so Yawn
      // actually puts the defender to sleep.
      { name: "Yawn", effect: "Your opponent's Active Pokémon is now Asleep." },
      {
        cost: ["Colorless"],
        name: "Rage",
        damage: "10+",
        effect: "This attack does 10 more damage for each damage counter on this Pokémon.",
      },
    ],
  }),
  /** The M3 cast: one derivable status sentence (effects.ts) per attack, on
      a tanky costless body so self-inflicted conditions don't KO it. */
  "fix-statuser": battler("fix-statuser", {
    hp: 120,
    attacks: [
      { name: "Hypnosis", effect: "Your opponent's Active Pokémon is now Asleep." },
      { name: "Confuse Ray", effect: "Your opponent's Active Pokémon is now Confused." },
      {
        name: "Numbing Bolt",
        damage: 10,
        effect: "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed.",
      },
      { name: "Overheat", effect: "This Pokémon is now Burned." },
      { name: "Rest", effect: "This Pokémon is now Asleep. Heal 30 damage from it." },
      {
        name: "Toxic",
        effect:
          "Your opponent's Active Pokémon is now Poisoned. During Pokémon Checkup, put 2 damage counters on that Pokémon instead of 1.",
      },
      // The classic OLD-ERA phrasing effects.ts deliberately does NOT
      // derive, with no damage and no modifier — pins the pure-text
      // ATTACK_EFFECT_SKIPPED path.
      { name: "Lullaby", effect: "The Defending Pokémon is now Asleep." },
    ],
  }),
  /** OHKO'd by Bite — the e2e prize-race fodder. No attacks of its own. */
  "fix-victim": battler("fix-victim", { hp: 30 }),
  /** Plain wall: no weakness, no resistance, survives several Bites. */
  "fix-wall": battler("fix-wall", { hp: 120 }),
  /** Weak to Fire — Bite hits for 60 and exactly KOs it. */
  "fix-weak": battler("fix-weak", { hp: 60, weaknesses: [{ type: "Fire", value: "×2" }] }),
  /** Resists Fire — Bite is floored to 0. */
  "fix-tough": battler("fix-tough", {
    hp: 120,
    resistances: [{ type: "Fire", value: "-30" }],
  }),
  /** Both weak AND resistant to Fire — pins the §8.5 order:
      (30 × 2) − 30 = 30, where the wrong order gives (30 − 30) × 2 = 0. */
  "fix-weak-tough": battler("fix-weak-tough", {
    hp: 120,
    weaknesses: [{ type: "Fire", value: "×2" }],
    resistances: [{ type: "Fire", value: "-30" }],
  }),
  /** Old-era ADDITIVE weakness (the dp5-4 print): Bite deals 30 + 20 = 50,
      where a misread ×2 would deal 60. */
  "fix-weak-plus": battler("fix-weak-plus", {
    hp: 120,
    weaknesses: [{ type: "Fire", value: "+20" }],
  }),
  /** hp printed as 0 — a catalog data gap schema/ingest let through, read as
      null by hpOf: never KO'd (a KO requires printed hp > 0). */
  "fix-zero-hp": battler("fix-zero-hp", { hp: 0 }),

  // — M4 slice 2: the representative Trainer/Ability cast (real catalog ids so
  //   the registry finds their authored programs). —
  "sv01-189": trainerCard("sv01-189", "Supporter", "Discard your hand and draw 7 cards."),
  "sv01-181": trainerCard(
    "sv01-181",
    "Item",
    "Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.",
  ),
  "sv02-172": trainerCard(
    "sv02-172",
    "Supporter",
    "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
  ),
  "sv01-194": trainerCard("sv01-194", "Item", "Switch your Active Pokémon with 1 of your Benched Pokémon."),
  "sv01-188": trainerCard("sv01-188", "Item", "Heal 30 damage from 1 of your Pokémon."),
  "sv01-172": trainerCard(
    "sv01-172",
    "Item",
    "Search your deck for a Basic Energy card, reveal it, and put it into your hand. Then, shuffle your deck.",
  ),
  /** A Stadium — pins the TRAINER_TYPE_UNSUPPORTED reject (persistent zones are
      a later slice). Not in the registry either. */
  "fix-stadium": {
    ...blank,
    id: "fix-stadium",
    name: "fix-stadium",
    category: "Trainer",
    trainerType: "Stadium",
    effect: "A test Stadium.",
  } satisfies Card,
  /** Chien-Pao ex — a Water Basic whose registry entry carries the activated
      "Shivery Chill" Ability (search up to 2 Basic {W} Energy → hand). */
  "sv02-061": battler("sv02-061", {
    name: "Chien-Pao ex",
    types: ["Water"],
    hp: 220,
    retreat: 2,
    weaknesses: [{ type: "Metal", value: "×2" }],
    abilities: [{ type: "Ability", name: "Shivery Chill", effect: "…search for up to 2 Basic {W} Energy…" }],
    attacks: [{ cost: ["Water", "Water"], name: "Hail Blade", damage: "60×", effect: "…discard {W} Energy…" }],
  }),
  /** Bouffalant — a Colorless Basic whose registry entry carries the passive
      "Bouffer" (takes 20 less damage after Weakness/Resistance). */
  "sv03-174": battler("sv03-174", {
    name: "Bouffalant",
    types: ["Colorless"],
    hp: 120,
    retreat: 2,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    abilities: [{ type: "Ability", name: "Bouffer", effect: "This Pokémon takes 20 less damage…" }],
    attacks: [{ cost: ["Colorless", "Colorless"], name: "Damage Rush", damage: "50+" }],
  }),
};

/** Expand `{ id: count }` into a flat deck list. */
export function deckOf(counts: Record<string, number>): string[] {
  const ids: string[] = [];
  for (const [id, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) ids.push(id);
  }
  return ids;
}

export const ALL_BASIC_DECK = deckOf({ "fix-basic-1": 60 });

/** One Basic in 60 — mulligans are near-certain, used with searched seeds. */
export const ONE_BASIC_DECK = deckOf({ "fix-basic-1": 1, "fix-energy": 59 });

export const MIXED_DECK = deckOf({
  "fix-basic-0": 8,
  "fix-basic-1": 20,
  "fix-basic-2": 8,
  "fix-stage1": 4,
  "fix-energy": 16,
  "fix-item": 4,
});

/** The full fix-basic-1 → fix-stage1 → fix-stage2 line for the M4 evolution
    suite: 24 fix-basic-1 make a fix-basic-1 opening hand near-certain (so a
    board can pin one as the Active), and the deck reliably still holds copies
    of each evolution card for handFromDeck to pull post-setup. */
export const EVOLVE_DECK = deckOf({
  "fix-basic-1": 24,
  "fix-stage1": 12,
  "fix-stage2": 8,
  "fix-energy": 16,
});

/** M4 slice 2 Trainer suite: reliable fix-basic-1 openings + Nest Ball search
    targets, every representative Trainer in multiples (handFromDeck pulls them
    post-setup), and Water/Colorless energy for the search filters. */
export const TRAINER_DECK = deckOf({
  "fix-basic-1": 20,
  "sv01-189": 2,
  "sv01-181": 2,
  "sv02-172": 2,
  "sv01-194": 2,
  "sv01-188": 2,
  "sv01-172": 2,
  "fix-water-energy": 20,
  "fix-energy": 8,
});

/** M4 slice 2 Ability suite: Chien-Pao ex and Bouffalant are both Basics (so
    either can be an Active), plus Water energy for Shivery Chill to search. */
export const ABILITY_DECK = deckOf({
  "sv02-061": 4,
  "sv03-174": 4,
  "fix-basic-1": 12,
  "fix-water-energy": 24,
  "fix-energy": 16,
});

/** TEST SURGERY: make a fresh copy of `cardId` (pulled from the seat's deck)
    the Active, sending the current Active (if any) to the bench end — Ability
    tests need a specific Active without hunting for a setup seed. Bench must
    have room; the result stays legal-shaped (every uid in exactly one zone). */
export function setActiveFromDeck(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${seat} deck has no ${cardId}`);
  const benched = side.active === null ? side.bench : [...side.bench, side.active];
  if (benched.length > 5) throw new Error("no bench room to displace the current Active");
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        active: makeInPlay(uid, 0),
        bench: benched,
      },
    },
  };
}

export function mustCreate(
  seed: number,
  decks: { p1: string[]; p2: string[] } = { p1: MIXED_DECK, p2: MIXED_DECK },
): { state: GameState; events: GameEvent[] } {
  const result = createGame({ seed, decks, cardPool: FIXTURE_POOL });
  if (!result.ok) throw new Error(`createGame failed: ${result.error.code}`);
  return { state: result.state, events: result.events };
}

export function must(result: ApplyResult): GameState {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.state;
}

/** applyAction that throws on rejection and hands back state + events. */
export function mustApply(
  state: GameState,
  action: GameAction,
): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) {
    throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  }
  return { state: result.state, events: result.events };
}

/** applyAction that must REJECT with exactly `code` — mustApply's negative
    twin, shared by the suites' wire/validation tests. */
export function expectErr(state: GameState, action: GameAction, code: ErrorCode): void {
  const result = applyAction(state, action);
  if (result.ok) {
    throw new Error(`expected ${action.type} to be rejected with ${code}, but it applied`);
  }
  if (result.error.code !== code) {
    throw new Error(
      `expected ${action.type} to fail with ${code}, got ${result.error.code}: ${result.error.message}`,
    );
  }
}

/** Event log → its type names — the shape every suite's order pins assert. */
export function types(events: GameEvent[]): string[] {
  return events.map((event) => event.type);
}

/** The stack-top uid of `seat`'s Active — throws when the spot is empty. */
export function activeUid(state: GameState, seat: Seat): string {
  const active = state.players[seat].active;
  const uid = active === null ? undefined : topUid(active);
  if (uid === undefined) throw new Error(`${seat} has no Active Pokémon`);
  return uid;
}

/** The stack-top uid of `seat`'s bench[index] — throws when the slot is
    empty (the bench is dense, so a valid index always holds a Pokémon). */
export function benchTopUid(state: GameState, seat: Seat, index: number): string {
  const pokemon = state.players[seat].bench[index];
  const uid = pokemon === undefined ? undefined : topUid(pokemon);
  if (uid === undefined) throw new Error(`${seat} has no benched Pokémon at index ${index}`);
  return uid;
}

export function handUid(state: GameState, seat: Seat, cardId: string): string {
  const uid = state.players[seat].hand.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) {
    throw new Error(`${seat} has no ${cardId} in hand — pick a seed that provides one`);
  }
  return uid;
}

export function handUids(state: GameState, seat: Seat, cardId: string, count: number): string[] {
  const uids = state.players[seat].hand
    .filter((u) => state.cardIdByUid[u] === cardId)
    .slice(0, count);
  if (uids.length < count) {
    throw new Error(`${seat} has ${uids.length} ${cardId} in hand, needed ${count}`);
  }
  return uids;
}

export function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((u) => {
    // Resolved through the engine's own accessor, so fixtures can never
    // disagree with the engine about what card a uid is.
    const card = cardOfUid(state, u);
    return card !== undefined && isBasicPokemon(card);
  });
  if (uid === undefined) throw new Error(`${seat} has no Basic Pokémon in hand`);
  return uid;
}

export interface SetupOptions {
  /** Who goes first (the winner's pick); defaults to the winner themselves. */
  first?: Seat;
  /** Card ids to bench per seat after the active is placed. */
  bench?: Partial<Record<Seat, string[]>>;
  /** Specific card id to use as the active (defaults to any Basic in hand). */
  active?: Partial<Record<Seat, string>>;
  /** Compensation cards to draw per seat when owed (defaults to all owed). */
  extraDraw?: Partial<Record<Seat, number>>;
}

/** Scripts a full setup: choose first, resolve compensation, place actives
    (+ requested benches), ready both. Returns the state on turn 1. */
export function driveSetup(
  seed: number,
  decks: { p1: string[]; p2: string[] } = { p1: MIXED_DECK, p2: MIXED_DECK },
  opts: SetupOptions = {},
): GameState {
  let state = mustCreate(seed, decks).state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  const winner = state.phase.coinWinner;
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: winner, first: opts.first ?? winner }),
  );
  // Both seats can be owed compensation (each off the other's mulligans), so
  // every undecided seat has to answer before placement opens.
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = SEATS.find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    const count = opts.extraDraw?.[seat] ?? phase.owed[seat];
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count }));
  }
  for (const seat of SEATS) {
    const activeId = opts.active?.[seat];
    const uid =
      activeId === undefined ? firstBasicInHand(state, seat) : handUid(state, seat, activeId);
    state = must(applyAction(state, { type: "setupPlaceActive", seat, uid }));
    for (const benchId of opts.bench?.[seat] ?? []) {
      const benchUid = handUid(state, seat, benchId);
      state = must(applyAction(state, { type: "setupPlaceBench", seat, uid: benchUid }));
    }
  }
  for (const seat of SEATS) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** TEST SURGERY: move `count` copies of `cardId` from the seat's deck onto
    the Active's energy, bypassing the one-attach-per-turn rule — attack
    matchups need multi-energy boards without scripting N turns of attaches.
    The result stays a legal-shaped state (every uid in exactly one zone). */
export function attachFromDeck(
  state: GameState,
  seat: Seat,
  cardId: string,
  count: number,
): GameState {
  const side = state.players[seat];
  if (side.active === null) throw new Error(`${seat} has no Active Pokémon`);
  const uids = side.deck.filter((uid) => state.cardIdByUid[uid] === cardId).slice(0, count);
  if (uids.length < count) {
    throw new Error(`${seat} deck has ${uids.length} ${cardId}, needed ${count}`);
  }
  const taken = new Set(uids);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((uid) => !taken.has(uid)),
        active: { ...side.active, energy: [...side.active.energy, ...uids] },
      },
    },
  };
}

/** TEST SURGERY: move `count` copies of `cardId` from the seat's deck into
    their HAND — evolution/trainer tests need specific cards in hand without
    hunting for a seed that deals them. Mirror of attachFromDeck; the result
    stays legal-shaped (every uid in exactly one zone). */
export function handFromDeck(
  state: GameState,
  seat: Seat,
  cardId: string,
  count: number,
): GameState {
  const side = state.players[seat];
  const uids = side.deck.filter((uid) => state.cardIdByUid[uid] === cardId).slice(0, count);
  if (uids.length < count) {
    throw new Error(`${seat} deck has ${uids.length} ${cardId}, needed ${count}`);
  }
  const taken = new Set(uids);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((uid) => !taken.has(uid)),
        hand: [...side.hand, ...uids],
      },
    },
  };
}

/** TEST SURGERY: overwrite fields of the Active's Special Conditions —
    checkup tests need conditioned boards without scripting the status
    attacks (and coin flips) that would inflict them. The null guard stays:
    withActive takes a non-null Pokémon. */
export function setConditions(
  state: GameState,
  seat: Seat,
  conditions: Partial<SpecialConditions>,
): GameState {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active Pokémon`);
  return withActive(state, seat, {
    ...active,
    conditions: { ...active.conditions, ...conditions },
  });
}

/** TEST SURGERY: set the Active's damage outright — heal/lethality tests
    need damaged boards without scripting the attacks that would place it. */
export function setDamage(state: GameState, seat: Seat, damage: number): GameState {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active Pokémon`);
  return withActive(state, seat, { ...active, damage });
}

/** TEST SURGERY: shrink a seat's prize row to `count`, returning the surplus
    to the bottom of the deck (still legal-shaped) — win-condition tests need
    "one prize from victory" boards without playing five KOs first. */
export function setPrizes(state: GameState, seat: Seat, count: number): GameState {
  const side = state.players[seat];
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        prizes: side.prizes.slice(0, count),
        deck: [...side.deck, ...side.prizes.slice(count)],
      },
    },
  };
}

/** Recursively freeze a value (strict mode makes any later mutation throw). */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}
