import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { hasRuleBox, isExOrV, isMegaEvolutionPokemonEx, pokemonSuffixOf, prizeValueOf } from "./cards";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { FIXTURE_POOL, battler, deckOf, setPrizes, trainerCard } from "./testFixtures";
import { type InPlayPokemon, makeInPlay } from "./types";

// ── 🆕🆕🆕 D582 — THE MEGA EVOLUTION POKÉMON ex RULE ──
//
// Every `me` "Mega … ex" prints this rule box (Mega Venusaur ex `me01-003`, the printed face):
//
//   Mega Evolution ex rule — When your Mega Evolution Pokémon ex is Knocked Out, your opponent
//   takes 3 Prize cards.
//
// tcgdex carries no rule-box text and its `suffix` column never says MEGA (the 133 legal printings
// are tagged `ex` 94 / `EX` 27 / none 12 — LOCAL D1, 2026-10-07), so the class is read off the NAME,
// as `pokemonSuffixOf` reads every other rule box. The 3 REPLACES the Pokémon ex rule's 2 and is the
// BASE that flow.ts `planPrizes` composes every existing modifier over.
//
// What does NOT change, checked against the printed face: a Mega ex evolves from its printed
// `evolveFrom` (Mega Venusaur ex is a Stage 2 from Ivysaur; Mega Absol ex is a Basic), its turn does
// not end when it evolves (the 2014 "M Pokémon-EX" rule; no `me` printing carries it), and it is
// still a Pokémon ex — every "Pokémon ex" sentence reaches it.

const MEGA_VENUSAUR = "me01-003";
const IVYSAUR = "me01-002";
const MEGA_ABSOL = "me01-086";
const MEGA_CHARIZARD_X = "me02-013";
const MEGANIUM = "me01-010";
const MEGA_SIGNAL = "me01-121";
const HYDREIGON_EX = "sv10.5w-067"; // registry `GREEDY_EATER` — "take 1 more Prize card" for a Basic
const LEGACY = "fix-legacy-energy"; // registry `LEGACY_ENERGY` — "that player takes 1 fewer Prize card"
const HITTER = "d582-hitter";
const PLAIN_EX = "d582-plain-ex";
const FILLER = "d582-filler";

/** The printed faces (LOCAL D1, 2026-10-07). */
const LOCAL_CARDS: Record<string, Card> = {
  [MEGA_VENUSAUR]: battler(MEGA_VENUSAUR, {
    name: "Mega Venusaur ex",
    hp: 380,
    stage: "Stage2",
    evolveFrom: "Ivysaur",
    types: ["Grass"],
    retreat: 4,
    weaknesses: [{ type: "Fire", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Solar Transfer",
        effect:
          "As often as you like during your turn, you may use this Ability. Move a Basic {G} Energy from 1 of your Pokémon to another of your Pokémon.",
      },
    ],
    attacks: [
      { cost: ["Grass", "Grass", "Grass", "Grass"], name: "Jungle Dump", effect: "Heal 30 damage from this Pokémon.", damage: 240 },
    ],
  }),
  [IVYSAUR]: battler(IVYSAUR, {
    name: "Ivysaur",
    hp: 110,
    stage: "Stage1",
    evolveFrom: "Bulbasaur",
    types: ["Grass"],
    retreat: 3,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [{ cost: ["Grass", "Grass"], name: "Razor Leaf", damage: 60 }],
  }),
  [MEGA_ABSOL]: battler(MEGA_ABSOL, {
    name: "Mega Absol ex",
    hp: 280,
    types: ["Darkness"],
    retreat: 2,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      {
        cost: ["Darkness", "Colorless"],
        name: "Terminal Period",
        effect: "If your opponent's Active Pokémon has exactly 6 damage counters on it, that Pokémon is Knocked Out.",
      },
      {
        cost: ["Darkness", "Darkness", "Colorless"],
        name: "Claw of Darkness",
        effect: "Your opponent reveals their hand, and you discard a card you find there.",
        damage: 200,
      },
    ],
  }),
  [MEGA_CHARIZARD_X]: battler(MEGA_CHARIZARD_X, {
    name: "Mega Charizard X ex",
    hp: 360,
    stage: "Stage2",
    evolveFrom: "Charmeleon",
    types: ["Fire"],
  }),
  [MEGANIUM]: battler(MEGANIUM, { name: "Meganium", hp: 160, stage: "Stage2", evolveFrom: "Bayleef", types: ["Grass"] }),
  [MEGA_SIGNAL]: {
    ...trainerCard(
      MEGA_SIGNAL,
      "Item",
      "Search your deck for a Mega Evolution Pokémon ex, reveal it, and put it into your hand. Then, shuffle your deck.",
    ),
    name: "Mega Signal",
  },
  [HYDREIGON_EX]: battler(HYDREIGON_EX, {
    name: "Hydreigon ex",
    hp: 330,
    stage: "Stage2",
    evolveFrom: "Zweilous",
    types: ["Darkness"],
    retreat: 3,
    abilities: [
      {
        type: "Ability",
        name: "Greedy Eater",
        effect:
          "If your opponent's Basic Pokémon is Knocked Out by damage from an attack used by this Pokémon, take 1 more Prize card.",
      },
    ],
    attacks: [
      {
        cost: ["Darkness", "Darkness", "Darkness", "Colorless", "Colorless"],
        name: "Dark Bite",
        effect: "During your opponent's next turn, the Defending Pokémon can't retreat.",
        damage: 200,
      },
      // Test-only: a free hit big enough to Knock Out any Mega ex.
      { cost: [], name: "Test Strike", damage: 400 },
    ],
  }),
  [HITTER]: battler(HITTER, { hp: 900, attacks: [{ cost: [], name: "Test Strike", damage: 400 }] }),
  [PLAIN_EX]: battler(PLAIN_EX, { name: "Plainmon ex", hp: 200 }),
  [FILLER]: battler(FILLER, { hp: 900 }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [MEGA_VENUSAUR]: 2,
  [IVYSAUR]: 2,
  [MEGA_ABSOL]: 2,
  [HYDREIGON_EX]: 1,
  [HITTER]: 2,
  [PLAIN_EX]: 1,
  [LEGACY]: 2,
  [FILLER]: 28,
  "fix-energy": 20,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function run(state: GameState, action: GameAction): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  return { state: result.state, events: result.events };
}

/** Setup with p2 first, then p2 passes: p1's turn 2 (`rounds` more full rounds on top). */
function opened(seed: number, rounds = 0): GameState {
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
  for (let i = 0; i < rounds; i += 1) {
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  }
  return state;
}

function withSide(state: GameState, seat: Seat, patch: Partial<GameState["players"]["p1"]>): GameState {
  return { ...state, players: { ...state.players, [seat]: { ...state.players[seat], ...patch } } };
}

/** Take one copy of `id` out of `seat`'s deck / hand / prizes (a prize is swapped for a deck card). */
function pull(state: GameState, seat: Seat, id: string): { state: GameState; uid: string } {
  const side = state.players[seat];
  const is = (u: string) => state.cardIdByUid[u] === id;
  const zone = (["deck", "hand", "prizes"] as const).find((z) => side[z].some(is));
  if (zone === undefined) throw new Error(`${seat} has no ${id}`);
  const uid = side[zone].find(is) ?? "";
  if (zone === "prizes") {
    const swap = side.deck.find((u) => !is(u)) ?? "";
    return {
      uid,
      state: withSide(state, seat, {
        prizes: side.prizes.map((u) => (u === uid ? swap : u)),
        deck: side.deck.filter((u) => u !== swap),
      }),
    };
  }
  return { uid, state: withSide(state, seat, { [zone]: side[zone].filter((u) => u !== uid) }) };
}

interface Spot {
  id: string;
  energy?: readonly string[];
}

/** A board on p1's turn: each Active built from a `Spot`, p2 given a FILLER on the Bench (so a KO of
    its Active is a Prize pick, not a win by an empty board), every hand emptied back into the deck;
    `hand` puts those ids into p1's hand. */
function table(opts: { p1: Spot; p2: Spot; hand?: readonly string[]; rounds?: number }): GameState {
  let state = opened(5821, opts.rounds ?? 0);
  for (const seat of ["p1", "p2"] as const) {
    const side = state.players[seat];
    const back = [
      ...side.hand,
      ...(side.active === null ? [] : [...side.active.stack, ...side.active.energy, ...side.active.tools]),
      ...side.bench.flatMap((p) => [...p.stack, ...p.energy, ...p.tools]),
    ];
    state = withSide(state, seat, { hand: [], active: null, bench: [], deck: [...side.deck, ...back] });
  }
  const make = (seat: Seat, spot: Spot): InPlayPokemon => {
    const top = pull(state, seat, spot.id);
    state = top.state;
    const energy: string[] = [];
    for (const id of spot.energy ?? []) {
      const e = pull(state, seat, id);
      state = e.state;
      energy.push(e.uid);
    }
    return { ...makeInPlay(top.uid, 0), energy };
  };
  const p1 = make("p1", opts.p1);
  const p2 = make("p2", opts.p2);
  const bench = make("p2", { id: FILLER });
  state = withSide(state, "p1", { active: p1 });
  state = withSide(state, "p2", { active: p2, bench: [bench] });
  const hand: string[] = [];
  for (const id of opts.hand ?? []) {
    const h = pull(state, "p1", id);
    state = h.state;
    hand.push(h.uid);
  }
  return withSide(state, "p1", { hand });
}

const strike = (index: number): GameAction => ({ type: "attack", seat: "p1", index });
const prizesOwed = (state: GameState) => (state.phase.kind === "ko:takePrizes" ? state.phase.count : null);

describe("D582 §0 — the version", () => {
  it("is built at engine 0.524.0, in BOTH places", () => {
    expect(engineVersion).toBe("0.524.0");
    expect(manifest.version).toBe("0.524.0");
  });
});

describe("D582 §1 — the predicate: a Mega Evolution Pokémon ex is read off the NAME", () => {
  it("every Mega ex face answers true — whatever tcgdex's `suffix` column says (Mega Charizard X ex carries none)", () => {
    for (const id of [MEGA_VENUSAUR, MEGA_ABSOL, MEGA_CHARIZARD_X]) {
      expect(isMegaEvolutionPokemonEx(POOL[id] as Card), id).toBe(true);
    }
  });

  it("the near misses answer false: Meganium (no space), a plain ex, a Trainer named Mega Signal, a non-ex 'Mega' name", () => {
    expect(isMegaEvolutionPokemonEx(POOL[MEGANIUM] as Card)).toBe(false);
    expect(isMegaEvolutionPokemonEx(POOL[PLAIN_EX] as Card)).toBe(false);
    expect(isMegaEvolutionPokemonEx(POOL[MEGA_SIGNAL] as Card)).toBe(false);
    expect(isMegaEvolutionPokemonEx(battler("d582-x", { name: "Mega Lucario" }))).toBe(false);
    // The space is load-bearing: a constructed "Meganium ex" is a plain Pokémon ex (2 Prizes).
    const meganiumEx = battler("d582-meganium-ex", { name: "Meganium ex" });
    expect(isMegaEvolutionPokemonEx(meganiumEx)).toBe(false);
    expect(prizeValueOf(meganiumEx)).toBe(2);
  });

  it("a Mega ex is STILL a Pokémon ex: suffix `ex`, a Rule Box, and an `ex or V` for the prevention auras", () => {
    const venusaur = POOL[MEGA_VENUSAUR] as Card;
    expect(pokemonSuffixOf(venusaur)).toBe("ex");
    expect(hasRuleBox(venusaur)).toBe(true);
    expect(isExOrV(venusaur)).toBe(true);
  });
});

describe("D582 §2 — prizeValueOf: 3 for a Mega ex, every other class unmoved", () => {
  it("Mega ex 3, plain ex 2, VMAX 3, V 2, plain body 1, non-Pokémon 1", () => {
    expect(prizeValueOf(POOL[MEGA_VENUSAUR] as Card)).toBe(3);
    expect(prizeValueOf(POOL[MEGA_ABSOL] as Card)).toBe(3);
    expect(prizeValueOf(POOL[MEGA_CHARIZARD_X] as Card)).toBe(3);
    expect(prizeValueOf(POOL[PLAIN_EX] as Card)).toBe(2);
    expect(prizeValueOf(battler("d582-vmax", { name: "Fixmon VMAX" }))).toBe(3);
    expect(prizeValueOf(battler("d582-v", { name: "Fixmon V" }))).toBe(2);
    expect(prizeValueOf(POOL[MEGANIUM] as Card)).toBe(1);
    expect(prizeValueOf(POOL[MEGA_SIGNAL] as Card)).toBe(1);
  });
});

describe("D582 §3 — on a board: the Knock Out owes 3, and the existing modifiers compose over it", () => {
  it("KOing an Active Mega ex (Stage 2, 380 HP) owes 3 Prizes; the pick takes 3", () => {
    const state = table({ p1: { id: HITTER }, p2: { id: MEGA_VENUSAUR } });
    const { state: after, events } = run(state, strike(0));
    expect(events.some((e) => e.type === "KNOCKED_OUT" && e.seat === "p2")).toBe(true);
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 3 });
    const next = must(applyAction(after, { type: "takePrizes", seat: "p1", prizeIndices: [0, 1, 2] }));
    expect(next.players.p1.prizes).toHaveLength(3);
  });

  it("the contrast on the same board: a plain ex owes 2", () => {
    const state = table({ p1: { id: HITTER }, p2: { id: PLAIN_EX } });
    expect(prizesOwed(run(state, strike(0)).state)).toBe(2);
  });

  it("a REDUCTION subtracts from 3: Legacy Energy on the Mega ex → 2 (PRIZE_REDUCED by 1, count 2)", () => {
    const state = table({ p1: { id: HITTER }, p2: { id: MEGA_ABSOL, energy: [LEGACY] } });
    const { state: after, events } = run(state, strike(0));
    expect(prizesOwed(after)).toBe(2);
    expect(events).toContainEqual(expect.objectContaining({ type: "PRIZE_REDUCED", seat: "p2", by: 1, count: 2 }));
  });

  it("a BONUS adds to 3: Hydreigon ex's Greedy Eater KOs a BASIC Mega ex → 4 (PRIZE_BONUS by 1, count 4)", () => {
    const state = table({ p1: { id: HYDREIGON_EX }, p2: { id: MEGA_ABSOL } });
    const { state: after, events } = run(state, strike(1));
    expect(prizesOwed(after)).toBe(4);
    expect(events).toContainEqual(expect.objectContaining({ type: "PRIZE_BONUS", seat: "p2", by: 1, count: 4 }));
  });

  it("both at once compose in printed order: 3 − 1 + 1 = 3", () => {
    const state = table({ p1: { id: HYDREIGON_EX }, p2: { id: MEGA_ABSOL, energy: [LEGACY] } });
    expect(prizesOwed(run(state, strike(1)).state)).toBe(3);
  });

  it("the Stage 2 Mega ex is not Basic, so Greedy Eater adds nothing: 3", () => {
    const state = table({ p1: { id: HYDREIGON_EX }, p2: { id: MEGA_VENUSAUR } });
    expect(prizesOwed(run(state, strike(1)).state)).toBe(3);
  });

  it("the clamp: with 2 Prizes left, KOing a Mega ex takes both and wins (§14.1)", () => {
    const state = setPrizes(table({ p1: { id: HITTER }, p2: { id: MEGA_VENUSAUR } }), "p1", 2);
    const { state: after, events } = run(state, strike(0));
    expect(events.find((e) => e.type === "GAME_OVER")).toMatchObject({
      outcome: { result: "win", winner: "p1", reason: "prizesTaken" },
    });
    expect(after.phase.kind).toBe("gameOver");
  });
});

describe("D582 §4 — evolution is the ordinary kind: no turn end, Basics are Basics", () => {
  it("Ivysaur evolves into Mega Venusaur ex and the SAME turn goes on (an Energy is still attachable)", () => {
    // p1's SECOND turn (turn 4): the first turn bans evolving (§4).
    const state = table({ p1: { id: IVYSAUR }, p2: { id: FILLER }, hand: [MEGA_VENUSAUR, "fix-energy"], rounds: 1 });
    const turn = state.turn;
    const [mega, energy] = state.players.p1.hand as [string, string];
    const evolved = run(state, { type: "evolve", seat: "p1", uid: mega, target: { spot: "active" } }).state;
    expect(evolved.players.p1.active?.stack).toEqual([state.players.p1.active?.stack[0], mega]);
    expect(evolved.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(evolved.turn).toBe(turn);
    const attached = run(evolved, { type: "attachEnergy", seat: "p1", uid: energy, target: { spot: "active" } }).state;
    expect(attached.players.p1.active?.energy).toEqual([energy]);
    expect(attached.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("a Basic Mega ex (Mega Absol ex) is played straight to the Bench", () => {
    const state = table({ p1: { id: HITTER }, p2: { id: FILLER }, hand: [MEGA_ABSOL] });
    const uid = state.players.p1.hand[0] as string;
    const after = run(state, { type: "playBasicToBench", seat: "p1", uid }).state;
    expect(after.players.p1.bench.map((p) => p.stack[0])).toEqual([uid]);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });
});
