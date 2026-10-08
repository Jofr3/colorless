import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { benchLimitForIds, benchLimitOf, benchTrimStages } from "./continuous";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion, phaseViewOf } from "./index";
import type { GameAction, GameState, PokemonRef, Seat } from "./index";
import { programFor } from "./registry";
import { FIXTURE_POOL, battler, deckOf, trainerCard } from "./testFixtures";
import { isBenchIndex } from "./turn";
import { BENCH_CEILING, BENCH_MAX, makeInPlay } from "./types";

// ── 🆕🆕🆕 D577 — AREA ZERO UNDERDEPTHS ×3: A PER-SEAT BENCH OF 8, AND THE TRIM BACK TO 5 ──
//
//   Area Zero Underdepths  sv07-131, sv07-174, sv08.5-094  (Stadium)
//
// *"Each player who has any Tera Pokémon in play can have up to 8 Pokémon on their Bench. If a player
// no longer has any Tera Pokémon in play, that player discards Pokémon from their Bench until they have
// 5. When this card leaves play, both players discard Pokémon from their Bench until they have 5, and
// the player who played this card discards first."*
//
// R-AZ1 (per seat), R-AZ2 (the settle-point state check), R-AZ3 (owner first on leave), R-AZ4 (the
// Bench OWNER answers, on the non-turn seat too), R-AZ5 (whole stacks, no Knock Out, no Prize), R-AZ6
// (behind the sweep's prize / promotion), R-AZ7 (an in-program leave queues at the FRONT), R-AZ8 (setup
// stays 5) — decisions.md D576 (d) and D577. Every producer is driven: the mid-turn sweep (evolve, an
// Item bounce, a Stadium REPLACEMENT, a Stadium-discarding Item), `finishAttack` (a Knock Out, and a
// Stadium-discarding attack), and `runCheckup`. Real ids on a LOCAL pool (D275); the Tera read is the
// banner table's, keyed by id, so the Tera bodies here wear real Tera ids.

const UNDERDEPTHS = "sv07-131";
const UNDERDEPTHS_2 = "sv07-174";
const UNDERDEPTHS_3 = "sv08.5-094";
const JAMMING_TOWER = "sv06-153";
const MEGATON_BLOWER = "sv08-182";
const SCOOP_UP_CYCLONE = "sv06-162";
/** Teal Mask Ogerpon ex — a TERA Basic (banners.ts). */
const TERA = "sv06-025";
/** Hearthflame Mask Ogerpon ex — a second Tera Basic, for the opponent. */
const TERA_2 = "sv06-040";
const NOT_TERA_EVOLUTION = "d577t-evolution";
const HITTER = "d577t-hitter";
const STADIUM_BREAKER = "d577t-stadium-breaker";
const POISONER = "d577t-poisoner";
const FILLER = "d577t-filler";
/** Lillie's Ribombee "Inviting Wink" and its pre-evolution (the opponent's 8-Bench receives). */
const RIBOMBEE = "sv09-067";
const CUTIEFLY = "d577t-cutiefly";
/** Lillie's Comfey "Inviting Flowers" — *"any number"* of Lillie's Basics onto the Bench. */
const COMFEY = "sv09-068";
const LILLIES_BASIC = "d577t-lillies-basic";

const UNDERDEPTHS_TEXT =
  "Each player who has any Tera Pokémon in play can have up to 8 Pokémon on their Bench. If a player no longer has any Tera Pokémon in play, that player discards Pokémon from their Bench until they have 5. When this card leaves play, both players discard Pokémon from their Bench until they have 5, and the player who played this card discards first.";

function underdepths(id: string): Card {
  return { ...trainerCard(id, "Stadium", UNDERDEPTHS_TEXT), name: "Area Zero Underdepths" };
}

const LOCAL_CARDS: Record<string, Card> = {
  [UNDERDEPTHS]: underdepths(UNDERDEPTHS),
  [UNDERDEPTHS_2]: underdepths(UNDERDEPTHS_2),
  [UNDERDEPTHS_3]: underdepths(UNDERDEPTHS_3),
  [JAMMING_TOWER]: {
    ...trainerCard(
      JAMMING_TOWER,
      "Stadium",
      "Pokémon Tools attached to each Pokémon (both yours and your opponent's) have no effect.",
    ),
    name: "Jamming Tower",
  },
  [MEGATON_BLOWER]: {
    ...trainerCard(
      MEGATON_BLOWER,
      "Item",
      "Discard all Pokémon Tools and Special Energy from each of your opponent's Pokémon, and discard a Stadium in play.",
    ),
    name: "Megaton Blower",
  },
  [SCOOP_UP_CYCLONE]: {
    ...trainerCard(SCOOP_UP_CYCLONE, "Item", "Put 1 of your Pokémon and all attached cards into your hand."),
    name: "Scoop Up Cyclone",
  },
  [TERA]: battler(TERA, {
    name: "Teal Mask Ogerpon ex",
    hp: 30,
    types: ["Grass"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  [TERA_2]: battler(TERA_2, {
    name: "Hearthflame Mask Ogerpon ex",
    hp: 30,
    types: ["Fire"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  [NOT_TERA_EVOLUTION]: battler(NOT_TERA_EVOLUTION, {
    name: "D577 Evolution",
    stage: "Stage1",
    evolveFrom: "Teal Mask Ogerpon ex",
    hp: 900,
    types: ["Grass"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  [HITTER]: battler(HITTER, {
    name: "D577 Hitter",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Crush", damage: 60 }],
  }),
  [STADIUM_BREAKER]: battler(STADIUM_BREAKER, {
    name: "D577 Stadium Breaker",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Quake", damage: 10, effect: "Discard a Stadium in play." }],
  }),
  [POISONER]: battler(POISONER, {
    name: "D577 Poisoner",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Sting", effect: "Your opponent's Active Pokémon is now Poisoned." }],
  }),
  [RIBOMBEE]: battler(RIBOMBEE, {
    name: "Lillie's Ribombee",
    stage: "Stage1",
    evolveFrom: "Lillie's Cutiefly",
    hp: 90,
    types: ["Psychic"],
    abilities: [
      {
        type: "Ability",
        name: "Inviting Wink",
        effect:
          "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may have your opponent reveal their hand and you put any number of Basic Pokémon you find there onto their Bench.",
      },
    ],
  }),
  [CUTIEFLY]: battler(CUTIEFLY, { name: "Lillie's Cutiefly", hp: 40, types: ["Psychic"] }),
  [COMFEY]: battler(COMFEY, {
    name: "Lillie's Comfey",
    hp: 70,
    types: ["Psychic"],
    attacks: [
      {
        cost: [],
        name: "Inviting Flowers",
        effect:
          "You may search your deck for any number of Basic Lillie's Pokémon and put them onto your Bench. Then, shuffle your deck.",
      },
    ],
  }),
  [LILLIES_BASIC]: battler(LILLIES_BASIC, { name: "Lillie's Clefairy", hp: 60, types: ["Psychic"] }),
  [FILLER]: battler(FILLER, {
    name: "D577 Filler",
    hp: 900,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [UNDERDEPTHS]: 1,
  [UNDERDEPTHS_2]: 1,
  [UNDERDEPTHS_3]: 1,
  [JAMMING_TOWER]: 1,
  [MEGATON_BLOWER]: 1,
  [SCOOP_UP_CYCLONE]: 1,
  [TERA]: 2,
  [TERA_2]: 2,
  [NOT_TERA_EVOLUTION]: 2,
  [HITTER]: 1,
  [STADIUM_BREAKER]: 1,
  [POISONER]: 1,
  [RIBOMBEE]: 1,
  [CUTIEFLY]: 1,
  [COMFEY]: 1,
  [LILLIES_BASIC]: 9,
  [FILLER]: 20,
  "fix-energy": 13,
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

/** Setup with p2 going first; returns p1's turn 2 after p2 passed. */
function opened(seed: number): GameState {
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
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** TEST SURGERY — take one `id` out of `seat`'s deck / hand / prizes (prizes refilled from the deck). */
function pull(state: GameState, seat: Seat, id: string): { state: GameState; uid: string } {
  const side = state.players[seat];
  const is = (u: string) => state.cardIdByUid[u] === id;
  const inDeck = side.deck.find(is);
  if (inDeck !== undefined) {
    return { uid: inDeck, state: withSide(state, seat, { deck: side.deck.filter((u) => u !== inDeck) }) };
  }
  const inHand = side.hand.find(is);
  if (inHand !== undefined) {
    return { uid: inHand, state: withSide(state, seat, { hand: side.hand.filter((u) => u !== inHand) }) };
  }
  const prized = side.prizes.find(is);
  const swap = side.deck.find((u) => !is(u));
  if (prized === undefined || swap === undefined) throw new Error(`${seat} has no ${id} to pull`);
  return {
    uid: prized,
    state: withSide(state, seat, {
      prizes: side.prizes.map((u) => (u === prized ? swap : u)),
      deck: side.deck.filter((u) => u !== swap),
    }),
  };
}

function withSide(state: GameState, seat: Seat, patch: Partial<GameState["players"]["p1"]>): GameState {
  return { ...state, players: { ...state.players, [seat]: { ...state.players[seat], ...patch } } };
}

/** p1's turn 2 on a hand-built board: each seat's Active and Bench (ANY size — no 5 cap), both hands
    emptied into the decks, and the Stadium zone set when `stadium` is given. */
function table(opts: {
  p1Active: string;
  p1Bench?: readonly string[];
  p2Active?: string;
  p2Bench?: readonly string[];
  stadium?: { id: string; owner: Seat } | null;
  p1Hand?: readonly string[];
  seed?: number;
}): GameState {
  let state = opened(opts.seed ?? 5771);
  for (const seat of ["p1", "p2"] as const) {
    const side = state.players[seat];
    const back = [
      ...side.hand,
      ...(side.active === null ? [] : [...side.active.stack, ...side.active.energy, ...side.active.tools]),
      ...side.bench.flatMap((p) => [...p.stack, ...p.energy, ...p.tools]),
    ];
    state = withSide(state, seat, { hand: [], active: null, bench: [], deck: [...side.deck, ...back] });
  }
  const seat = (s: Seat, active: string, bench: readonly string[]) => {
    let pulled = pull(state, s, active);
    state = withSide(pulled.state, s, { active: makeInPlay(pulled.uid, 0) });
    for (const id of bench) {
      pulled = pull(state, s, id);
      state = withSide(pulled.state, s, { bench: [...pulled.state.players[s].bench, makeInPlay(pulled.uid, 0)] });
    }
  };
  seat("p1", opts.p1Active, opts.p1Bench ?? []);
  seat("p2", opts.p2Active ?? FILLER, opts.p2Bench ?? []);
  for (const id of opts.p1Hand ?? []) {
    const pulled = pull(state, "p1", id);
    state = withSide(pulled.state, "p1", { hand: [...pulled.state.players.p1.hand, pulled.uid] });
  }
  if (opts.stadium) {
    const pulled = pull(state, opts.stadium.owner, opts.stadium.id);
    state = { ...pulled.state, stadium: { uid: pulled.uid, owner: opts.stadium.owner } };
  }
  return state;
}

const fillers = (n: number): string[] => Array.from({ length: n }, () => FILLER);
const benchRefs = (seat: Seat, indices: readonly number[]): PokemonRef[] =>
  indices.map((index) => ({ seat, spot: { spot: "bench", index } }));
const handUid = (state: GameState, seat: Seat, id: string): string => {
  const uid = state.players[seat].hand.find((u) => state.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`${seat} hand has no ${id}`);
  return uid;
};

function trimPrompt(state: GameState): { seat: Seat; min: number; max: number; candidates: number } {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti") throw new Error(`expected choosePokemonMulti, got ${prompt.kind}`);
  return { seat: state.phase.seat, min: prompt.min, max: prompt.max, candidates: prompt.candidates.length };
}

/** Answer the parked trim for `seat` by discarding the LAST `n` Benched bodies. */
function trimLast(state: GameState, seat: Seat, n: number): { state: GameState; events: GameEvent[] } {
  const size = state.players[seat].bench.length;
  const indices = Array.from({ length: n }, (_, i) => size - n + i);
  return run(state, { type: "resolveEffect", seat, choice: { kind: "pokemonMulti", refs: benchRefs(seat, indices) } });
}

describe("D577 §1 — the printed text, the registry row, BENCH_CEILING and the version", () => {
  it("all three printings share ONE program whose one field is the widened limit", () => {
    for (const id of [UNDERDEPTHS, UNDERDEPTHS_2, UNDERDEPTHS_3]) {
      expect(programFor(id)).toEqual({ stadium: { benchLimitWithTera: 8 } });
    }
    expect(programFor(UNDERDEPTHS)).toBe(programFor(UNDERDEPTHS_3));
  });

  it("BENCH_MAX stays the rule (5); BENCH_CEILING (8) is the largest Bench a printing grants", () => {
    expect(BENCH_MAX).toBe(5);
    expect(BENCH_CEILING).toBe(8);
    expect(programFor(UNDERDEPTHS)?.stadium?.benchLimitWithTera).toBe(BENCH_CEILING);
  });

  it("isBenchIndex admits a Bench index 5 … 7 (a 0.460 reader refused every one of them) and refuses 8", () => {
    for (const index of [0, 4, 5, 6, 7]) expect(isBenchIndex(index)).toBe(true);
    expect(isBenchIndex(8)).toBe(false);
    expect(isBenchIndex(-1)).toBe(false);
    expect(isBenchIndex("5")).toBe(false);
  });

  it("is built at engine 0.483.0", () => {
    expect(engineVersion).toBe("0.483.0");
  });
});

describe("D577 §2 — benchLimitOf is PER SEAT (R-AZ1)", () => {
  it("no Stadium: 5 for both seats, Tera or not", () => {
    const state = table({ p1Active: TERA, p2Active: TERA_2, stadium: null });
    expect(benchLimitOf(state, "p1")).toBe(5);
    expect(benchLimitOf(state, "p2")).toBe(5);
  });

  it("Underdepths in play: 8 for the seat with a Tera Pokémon in play, 5 for the seat without", () => {
    const state = table({ p1Active: TERA, stadium: { id: UNDERDEPTHS, owner: "p2" } });
    expect(benchLimitOf(state, "p1")).toBe(8);
    expect(benchLimitOf(state, "p2")).toBe(5);
  });

  it("a Tera Pokémon on the BENCH counts — 'in play', not 'Active'", () => {
    const state = table({ p1Active: FILLER, p1Bench: [TERA], stadium: { id: UNDERDEPTHS_2, owner: "p1" } });
    expect(benchLimitOf(state, "p1")).toBe(8);
  });

  it("a different Stadium widens nothing", () => {
    const state = table({ p1Active: TERA, stadium: { id: JAMMING_TOWER, owner: "p1" } });
    expect(benchLimitOf(state, "p1")).toBe(5);
  });

  it("benchLimitForIds (the web's redacted board) answers the same question off card ids", () => {
    expect(benchLimitForIds(UNDERDEPTHS, [TERA, FILLER])).toBe(8);
    expect(benchLimitForIds(UNDERDEPTHS, [FILLER])).toBe(5);
    expect(benchLimitForIds(undefined, [TERA])).toBe(5);
    expect(benchLimitForIds(JAMMING_TOWER, [TERA])).toBe(5);
  });
});

describe("D577 §3 — the live limit at every Bench writer", () => {
  it("plays Basics up to 8 with a Tera Pokémon in play, and refuses the ninth", () => {
    let state = table({
      p1Active: TERA,
      p1Bench: fillers(6),
      p1Hand: [FILLER, FILLER],
      stadium: { id: UNDERDEPTHS, owner: "p1" },
    });
    state = run(state, { type: "playBasicToBench", seat: "p1", uid: handUid(state, "p1", FILLER) }).state;
    state = run(state, { type: "playBasicToBench", seat: "p1", uid: handUid(state, "p1", FILLER) }).state;
    expect(state.players.p1.bench).toHaveLength(8);
    state = withSide(state, "p1", { hand: [...state.players.p1.hand, state.players.p1.deck.find((u) => state.cardIdByUid[u] === FILLER) ?? ""] });
    const refused = applyAction(state, { type: "playBasicToBench", seat: "p1", uid: handUid(state, "p1", FILLER) });
    expect(refused.ok ? null : [refused.error.code, refused.error.message]).toEqual([
      "BENCH_FULL",
      "the bench holds at most 8 Pokémon",
    ]);
  });

  it("without a Tera Pokémon the sixth Basic is refused under Underdepths", () => {
    const state = table({ p1Active: FILLER, p1Bench: fillers(5), p1Hand: [FILLER], stadium: { id: UNDERDEPTHS, owner: "p1" } });
    const refused = applyAction(state, { type: "playBasicToBench", seat: "p1", uid: handUid(state, "p1", FILLER) });
    expect(refused.ok ? null : refused.error.message).toBe("the bench holds at most 5 Pokémon");
  });

  it("an Energy attaches to Bench index 7 — the ceiling admits the slot and the board holds it", () => {
    let state = table({ p1Active: TERA, p1Bench: fillers(8), stadium: { id: UNDERDEPTHS, owner: "p1" } });
    const pulled = pull(state, "p1", "fix-energy");
    state = withSide(pulled.state, "p1", { hand: [pulled.uid] });
    state = run(state, { type: "attachEnergy", seat: "p1", uid: pulled.uid, target: { spot: "bench", index: 7 } }).state;
    expect(state.players.p1.bench[7]?.energy).toEqual([pulled.uid]);
  });
});

describe("D577 §4 — the Stadium REPLACED: both trim, the OWNER first (R-AZ3, R-AZ4, R-AZ5)", () => {
  it("p2 owns Underdepths, p1 replaces it: p2 (the NON-turn seat) answers first, then p1, then p1's turn resumes", () => {
    let state = table({
      p1Active: TERA,
      p1Bench: fillers(7),
      p2Active: TERA_2,
      p2Bench: fillers(6),
      p1Hand: [JAMMING_TOWER],
      stadium: { id: UNDERDEPTHS, owner: "p2" },
    });
    const played = run(state, { type: "playTrainer", seat: "p1", uid: handUid(state, "p1", JAMMING_TOWER) });
    state = played.state;
    expect(trimPrompt(state)).toEqual({ seat: "p2", min: 1, max: 1, candidates: 6 });
    const view = phaseViewOf(state, "p1");
    expect([view.activeSeat, view.waitingSeat]).toEqual(["p1", "p2"]);
    const p2Discard = state.players.p2.discard.length;
    const first = trimLast(state, "p2", 1);
    state = first.state;
    expect(state.players.p2.bench).toHaveLength(5);
    expect(state.players.p2.discard.length).toBe(p2Discard + 1);
    expect(first.events.filter((e) => e.type === "BENCH_TRIMMED").map((e) => e.seat)).toEqual(["p2"]);
    expect(trimPrompt(state)).toEqual({ seat: "p1", min: 2, max: 2, candidates: 7 });
    const second = trimLast(state, "p1", 2);
    state = second.state;
    expect(state.players.p1.bench).toHaveLength(5);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(state.pending).toEqual([]);
    // R-AZ5 — no Knock Out, no Prize.
    expect([...first.events, ...second.events].some((e) => e.type === "KNOCKED_OUT" || e.type === "PRIZES_OWED")).toBe(false);
    expect(state.players.p1.prizes).toHaveLength(6);
  });

  it("p1 owns Underdepths and replaces it itself: p1 trims first", () => {
    let state = table({
      p1Active: TERA,
      p1Bench: fillers(6),
      p2Active: TERA_2,
      p2Bench: fillers(7),
      p1Hand: [JAMMING_TOWER],
      stadium: { id: UNDERDEPTHS_2, owner: "p1" },
    });
    state = run(state, { type: "playTrainer", seat: "p1", uid: handUid(state, "p1", JAMMING_TOWER) }).state;
    expect(trimPrompt(state).seat).toBe("p1");
    state = trimLast(state, "p1", 1).state;
    expect(trimPrompt(state)).toEqual({ seat: "p2", min: 2, max: 2, candidates: 7 });
  });

  it("the trimmed body goes with its WHOLE stack (attached Energy too) — the event names the bodies and the pile", () => {
    let state = table({
      p1Active: TERA,
      p1Bench: fillers(6),
      p1Hand: [JAMMING_TOWER],
      stadium: { id: UNDERDEPTHS, owner: "p1" },
    });
    const energy = pull(state, "p1", "fix-energy");
    state = energy.state;
    const lastBody = state.players.p1.bench[5];
    if (lastBody === undefined) throw new Error("no sixth body");
    state = withSide(state, "p1", {
      bench: state.players.p1.bench.map((b, i) => (i === 5 ? { ...b, energy: [energy.uid] } : b)),
    });
    state = run(state, { type: "playTrainer", seat: "p1", uid: handUid(state, "p1", JAMMING_TOWER) }).state;
    const trimmed = trimLast(state, "p1", 1);
    const row = trimmed.events.find((e) => e.type === "BENCH_TRIMMED");
    expect(row).toEqual({
      type: "BENCH_TRIMMED",
      seat: "p1",
      uids: [lastBody.stack[0]],
      discarded: [lastBody.stack[0], energy.uid],
    });
    expect(trimmed.state.players.p1.discard).toEqual(expect.arrayContaining([lastBody.stack[0], energy.uid]));
  });

  it("a Bench already at 5 is not asked anything", () => {
    let state = table({
      p1Active: TERA,
      p1Bench: fillers(5),
      p2Bench: fillers(4),
      p1Hand: [JAMMING_TOWER],
      stadium: { id: UNDERDEPTHS, owner: "p2" },
    });
    state = run(state, { type: "playTrainer", seat: "p1", uid: handUid(state, "p1", JAMMING_TOWER) }).state;
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("the answer must be EXACTLY the excess", () => {
    let state = table({
      p1Active: TERA,
      p1Bench: fillers(7),
      p1Hand: [JAMMING_TOWER],
      stadium: { id: UNDERDEPTHS, owner: "p1" },
    });
    state = run(state, { type: "playTrainer", seat: "p1", uid: handUid(state, "p1", JAMMING_TOWER) }).state;
    const short = applyAction(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: benchRefs("p1", [0]) },
    });
    expect(short.ok).toBe(false);
    const wrongSeat = applyAction(state, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "pokemonMulti", refs: benchRefs("p1", [0, 1]) },
    });
    expect(wrongSeat.ok).toBe(false);
  });
});

describe("D577 §5 — the Stadium DISCARDED by a program: owner-first trims at the FRONT of pending (R-AZ7)", () => {
  it("an Item (Megaton Blower) discards p2's Underdepths: p2 trims first, then p1, then p1's turn resumes", () => {
    let state = table({
      p1Active: TERA,
      p1Bench: fillers(6),
      p2Active: TERA_2,
      p2Bench: fillers(6),
      p1Hand: [MEGATON_BLOWER],
      stadium: { id: UNDERDEPTHS, owner: "p2" },
    });
    state = run(state, { type: "playTrainer", seat: "p1", uid: handUid(state, "p1", MEGATON_BLOWER) }).state;
    expect(state.stadium).toBeNull();
    expect(trimPrompt(state).seat).toBe("p2");
    state = trimLast(state, "p2", 1).state;
    expect(trimPrompt(state).seat).toBe("p1");
    state = trimLast(state, "p1", 1).state;
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("an ATTACK discards the Stadium: both trims resolve BEFORE the attack's epilogue ends the turn", () => {
    let state = table({
      p1Active: STADIUM_BREAKER,
      p1Bench: [TERA, ...fillers(6)],
      p2Active: TERA_2,
      p2Bench: fillers(6),
      stadium: { id: UNDERDEPTHS_3, owner: "p2" },
    });
    const attacked = run(state, { type: "attack", seat: "p1", index: 0 });
    state = attacked.state;
    expect(trimPrompt(state).seat).toBe("p2");
    expect(state.pending.map((s) => s.kind)).toEqual(["benchTrim", "attackEpilogue"]);
    expect(attacked.events.some((e) => e.type === "TURN_ENDED")).toBe(false);
    state = trimLast(state, "p2", 1).state;
    expect(trimPrompt(state)).toEqual({ seat: "p1", min: 2, max: 2, candidates: 7 });
    const last = trimLast(state, "p1", 2);
    const kinds = last.events.map((e) => e.type);
    expect(kinds.indexOf("BENCH_TRIMMED")).toBeLessThan(kinds.indexOf("TURN_ENDED"));
    expect(last.state.players.p1.bench).toHaveLength(5);
  });

  it("benchTrimStages skips a seat a queued trim already holds, and orders `first` then the other", () => {
    const state = table({
      p1Active: FILLER,
      p1Bench: fillers(6),
      p2Bench: fillers(7),
      stadium: { id: JAMMING_TOWER, owner: "p1" },
    });
    expect(benchTrimStages(state, "p2")).toEqual([
      { kind: "benchTrim", seat: "p2" },
      { kind: "benchTrim", seat: "p1" },
    ]);
    expect(benchTrimStages(state, "p1", [{ kind: "benchTrim", seat: "p1" }])).toEqual([{ kind: "benchTrim", seat: "p2" }]);
  });
});

describe("D577 §6 — the last Tera Pokémon LEAVES PLAY (R-AZ2), through every sweep", () => {
  it("Knocked Out by an attack (finishAttack): the prize, then the promotion, THEN the trim (R-AZ6)", () => {
    let state = table({
      p1Active: HITTER,
      p2Active: TERA_2,
      p2Bench: fillers(7),
      stadium: { id: UNDERDEPTHS, owner: "p1" },
    });
    const attacked = run(state, { type: "attack", seat: "p1", index: 0 });
    state = attacked.state;
    expect(state.phase.kind).toBe("ko:takePrizes");
    expect(state.pending.map((s) => s.kind)).toEqual(["takePrizes", "promote", "benchTrim", "endTurn", "checkup", "startTurn"]);
    state = run(state, { type: "takePrizes", seat: "p1", prizeIndices: [0, 1] }).state;
    expect(state.phase.kind).toBe("ko:promote");
    state = run(state, { type: "promote", seat: "p2", benchIndex: 0 }).state;
    // 7 Benched − 1 promoted = 6: one over the 5 a Tera-less seat may keep.
    expect(trimPrompt(state)).toEqual({ seat: "p2", min: 1, max: 1, candidates: 6 });
    state = trimLast(state, "p2", 1).state;
    expect(state.players.p2.bench).toHaveLength(5);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("no trim when the Bench is at 5 after the promotion", () => {
    let state = table({ p1Active: HITTER, p2Active: TERA_2, p2Bench: fillers(6), stadium: { id: UNDERDEPTHS, owner: "p1" } });
    state = run(state, { type: "attack", seat: "p1", index: 0 }).state;
    expect(state.pending.some((s) => s.kind === "benchTrim")).toBe(true);
    state = run(state, { type: "takePrizes", seat: "p1", prizeIndices: [0, 1] }).state;
    state = run(state, { type: "promote", seat: "p2", benchIndex: 0 }).state;
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("Knocked Out at the Checkup (runCheckup): the trim sits between the promotion and the next turn", () => {
    let state = table({
      p1Active: TERA,
      p1Bench: fillers(7),
      p2Active: POISONER,
      stadium: { id: UNDERDEPTHS, owner: "p2" },
    });
    state = withSide(state, "p1", {
      active: state.players.p1.active === null ? null : { ...state.players.p1.active, damage: 20 },
    });
    state = withSide(state, "p1", {
      active:
        state.players.p1.active === null
          ? null
          : {
              ...state.players.p1.active,
              conditions: { ...state.players.p1.active.conditions, poisonDamage: 10 },
            },
    });
    state = run(state, { type: "endTurn", seat: "p1" }).state;
    // The Checkup's poison KO'd the Tera Active: p2's prize, p1's promotion, p1's trim.
    expect(state.phase.kind).toBe("ko:takePrizes");
    state = run(state, { type: "takePrizes", seat: "p2", prizeIndices: [0, 1] }).state;
    state = run(state, { type: "promote", seat: "p1", benchIndex: 0 }).state;
    expect(trimPrompt(state)).toEqual({ seat: "p1", min: 1, max: 1, candidates: 6 });
    expect(phaseViewOf(state, "p1").activeSeat).toBeNull();
    state = trimLast(state, "p1", 1).state;
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("EVOLVED into a non-Tera card (the mid-turn sweep): the seat trims at once", () => {
    let state = table({
      p1Active: TERA,
      p1Bench: fillers(7),
      p1Hand: [NOT_TERA_EVOLUTION],
      stadium: { id: UNDERDEPTHS, owner: "p1" },
    });
    // p1's turn 2 is its FIRST turn (§4/§10): pass twice to reach turn 4.
    state = run(run(state, { type: "endTurn", seat: "p1" }).state, { type: "endTurn", seat: "p2" }).state;
    state = run(state, {
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", NOT_TERA_EVOLUTION),
      target: { spot: "active" },
    }).state;
    expect(trimPrompt(state)).toEqual({ seat: "p1", min: 2, max: 2, candidates: 7 });
    state = trimLast(state, "p1", 2).state;
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("BOUNCED to the hand by an Item (Scoop Up Cyclone — the program sweep): the seat trims at once", () => {
    let state = table({
      p1Active: FILLER,
      p1Bench: [...fillers(7), TERA],
      p1Hand: [SCOOP_UP_CYCLONE],
      stadium: { id: UNDERDEPTHS_2, owner: "p2" },
    });
    state = run(state, { type: "playTrainer", seat: "p1", uid: handUid(state, "p1", SCOOP_UP_CYCLONE) }).state;
    state = run(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 7 } } },
    }).state;
    expect(trimPrompt(state)).toEqual({ seat: "p1", min: 2, max: 2, candidates: 7 });
    state = trimLast(state, "p1", 2).state;
    expect(state.players.p1.bench).toHaveLength(5);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("another Tera Pokémon still in play keeps the 8", () => {
    let state = table({ p1Active: HITTER, p2Active: TERA_2, p2Bench: [TERA, ...fillers(6)], stadium: { id: UNDERDEPTHS, owner: "p1" } });
    state = run(state, { type: "attack", seat: "p1", index: 0 }).state;
    expect(state.pending.some((s) => s.kind === "benchTrim")).toBe(false);
  });
});

describe("D577 §7 — the two 'any number' Bench writers reach an 8-Bench (BENCH_CEILING)", () => {
  it("Inviting Wink offers the opponent's 7 same-name Basics onto a 1-body Bench that may hold 8", () => {
    let state = table({
      p1Active: CUTIEFLY,
      p2Active: TERA_2,
      p2Bench: [FILLER],
      p1Hand: [RIBOMBEE],
      stadium: { id: UNDERDEPTHS, owner: "p2" },
    });
    // p1's turn 2 is its first turn (§10): pass twice, then hand p2 seven copies of one Basic.
    state = run(run(state, { type: "endTurn", seat: "p1" }).state, { type: "endTurn", seat: "p2" }).state;
    const p2 = state.players.p2;
    state = withSide(state, "p2", {
      hand: [],
      deck: [...p2.deck, ...p2.hand],
    });
    for (let i = 0; i < 7; i++) {
      const pulled = pull(state, "p2", LILLIES_BASIC);
      state = withSide(pulled.state, "p2", { hand: [...pulled.state.players.p2.hand, pulled.uid] });
    }
    state = run(state, {
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", RIBOMBEE),
      target: { spot: "active" },
    }).state;
    if (state.phase.kind === "effect:choose" && state.phase.prompt.kind === "confirm") {
      state = run(state, { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: true } }).state;
    }
    if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "chooseCards") {
      throw new Error(`expected the chooseCards offer, got ${state.phase.kind}`);
    }
    // 0.460 kept BENCH_MAX (5) representatives per class; the ceiling is 8 now, and space is 7.
    expect(state.phase.prompt.candidates).toHaveLength(7);
    expect(state.phase.prompt.max).toBe(7);
    const picks = [...state.phase.prompt.candidates];
    state = run(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: picks } }).state;
    expect(state.players.p2.bench).toHaveLength(8);
  });

  it("Lillie's Comfey 'Inviting Flowers' benches up to 8 with a Tera Pokémon in play", () => {
    let state = table({ p1Active: COMFEY, p1Bench: [TERA], stadium: { id: UNDERDEPTHS, owner: "p1" } });
    state = run(state, { type: "attack", seat: "p1", index: 0 }).state;
    if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "chooseCards") {
      throw new Error(`expected the search, got ${state.phase.kind}`);
    }
    // `max: BENCH_CEILING`, clamped to the 7 free slots (0.460: `max: BENCH_MAX`, so 5).
    expect(state.phase.prompt.max).toBe(7);
    const picks = state.phase.prompt.candidates.slice(0, 7);
    state = run(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [...picks] } }).state;
    expect(state.players.p1.bench).toHaveLength(8);
  });
});
