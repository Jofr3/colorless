import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { disabledAbilityUids } from "./continuous";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { redactGame } from "./redact";
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  trainerCard,
  typedEnergy,
} from "./testFixtures";
import type { InPlayPokemon } from "./types";

// ── 🆕🆕🆕 D566 — THE TRAINER BUNDLE, HALF ONE: BROCK'S SCOUTING, OGRE'S MASK AND THE
//    WATCHTOWER RIDER ──
//
//   Brock's Scouting   sv09-146 / sv09-179  Supporter  "Search your deck for up to 2 Basic Pokémon or
//                                                      1 Evolution Pokémon, reveal them, and put them into
//                                                      your hand. Then, shuffle your deck."
//   Ogre's Mask        sv06-159 / sv08.5-118 Item      "Choose a Pokémon ex in your discard pile that has
//                                                      "Ogerpon" in its name, and switch it with 1 of your
//                                                      Pokémon ex in play that has "Ogerpon" in its name. …"
//   Team Rocket's      sv10-180              Stadium   "{C} Pokémon in play (both yours and your opponent's)
//   Watchtower                                         have no Abilities."
//
// Driven on the REAL ids on a LOCAL `cardPool` (D275) in the suite's OWN deck (D270). Texts off tcgdex
// (the audit's card JSON), 2026-09-28. Readings: docs/decisions.md D566 (R-OM, R-WT1, R-LK1 restated).
// The KO-moment Tools and Powerglass are `koToolsD566.test.ts`.

const BROCK = ["sv09-146", "sv09-179"] as const;
const OGRE = ["sv06-159", "sv08.5-118"] as const;
const WATCHTOWER = "sv10-180";
const TEAL_EX = "sv06-025"; // Teal Mask Ogerpon ex — "Teal Dance" (built), Grass, 210
const HEARTH_EX = "sv06-040"; // Hearthflame Mask Ogerpon ex — Fire, 210
const TEAL_PLAIN = "sv06-024"; // Teal Mask Ogerpon — NOT ex, 110
const TINY_EX = "d566-tiny-ogerpon-ex"; // a CONSTRUCTED 100-HP Ogerpon ex, for the KO rung only
const DUDUNSPARCE = "sv05-129"; // {C} — "Run Away Draw" (activated)
const FARFETCHD = "sv06-132"; // {C} — "Impromptu Carrier" (onPlayToBench)
const DURANT_EX = "sv08-004"; // {G} — onPlayToBench, the non-{C} trigger control
const BASIC = "d566-basic";
const EVO = "d566-evo";
const FILLER = "d566-filler";
const GRASS = "d566-grass";
const TOOL = "d566-tool";

const BROCK_TEXT =
  "Search your deck for up to 2 Basic Pokémon or 1 Evolution Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.";
const OGRE_TEXT =
  'Choose a Pokémon ex in your discard pile that has "Ogerpon" in its name, and switch it with 1 of your Pokémon ex in play that has "Ogerpon" in its name. Any attached cards, damage counters, Special Conditions, turns in play, and any other effects remain on the new Pokémon.';
const WATCHTOWER_TEXT = "{C} Pokémon in play (both yours and your opponent's) have no Abilities.";

const TEAL_DANCE_TEXT =
  "Once during your turn, you may attach a Basic {G} Energy card from your hand to this Pokémon. If you do, draw a card.";

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(
    BROCK.map((id) => [id, { ...trainerCard(id, "Supporter", BROCK_TEXT), name: "Brock's Scouting" }]),
  ),
  ...Object.fromEntries(OGRE.map((id) => [id, { ...trainerCard(id, "Item", OGRE_TEXT), name: "Ogre's Mask" }])),
  [WATCHTOWER]: { ...trainerCard(WATCHTOWER, "Stadium", WATCHTOWER_TEXT), name: "Team Rocket's Watchtower" },
  [TEAL_EX]: battler(TEAL_EX, {
    name: "Teal Mask Ogerpon ex",
    types: ["Grass"],
    hp: 210,
    abilities: [{ type: "Ability", name: "Teal Dance", effect: TEAL_DANCE_TEXT }],
  }),
  [HEARTH_EX]: battler(HEARTH_EX, { name: "Hearthflame Mask Ogerpon ex", types: ["Fire"], hp: 210 }),
  [TEAL_PLAIN]: battler(TEAL_PLAIN, { name: "Teal Mask Ogerpon", types: ["Grass"], hp: 110 }),
  [TINY_EX]: battler(TINY_EX, { name: "Tiny Mask Ogerpon ex", types: ["Grass"], hp: 100 }),
  [DUDUNSPARCE]: battler(DUDUNSPARCE, {
    name: "Dudunsparce",
    stage: "Basic",
    types: ["Colorless"],
    hp: 140,
    abilities: [
      {
        type: "Ability",
        name: "Run Away Draw",
        effect:
          "Once during your turn, you may draw 3 cards. If you do, shuffle this Pokémon and all attached cards into your deck.",
      },
    ],
  }),
  [FARFETCHD]: battler(FARFETCHD, {
    name: "Farfetch'd",
    types: ["Colorless"],
    hp: 70,
    abilities: [{ type: "Ability", name: "Impromptu Carrier", effect: "…" }],
  }),
  [DURANT_EX]: battler(DURANT_EX, {
    name: "Durant ex",
    types: ["Grass"],
    hp: 190,
    abilities: [{ type: "Ability", name: "Sudden Shearing", effect: "…" }],
  }),
  [BASIC]: battler(BASIC, { name: "D566 Basic", types: ["Water"], hp: 60 }),
  [EVO]: battler(EVO, { name: "D566 Evolution", stage: "Stage1", evolveFrom: "D566 Basic", types: ["Water"], hp: 90 }),
  [FILLER]: battler(FILLER, {
    name: "D566 Filler",
    hp: 900,
    retreat: 1,
    types: ["Water"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  [GRASS]: typedEnergy(GRASS, "Grass"),
  [TOOL]: { ...trainerCard(TOOL, "Tool", "A D566 test Tool."), name: "D566 Tool" },
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [BROCK[0]]: 1,
  [BROCK[1]]: 1,
  [OGRE[0]]: 1,
  [OGRE[1]]: 1,
  [WATCHTOWER]: 1,
  [TEAL_EX]: 3,
  [HEARTH_EX]: 2,
  [TEAL_PLAIN]: 2,
  [TINY_EX]: 1,
  [DUDUNSPARCE]: 2,
  [FARFETCHD]: 3,
  [DURANT_EX]: 3,
  [BASIC]: 4,
  [EVO]: 3,
  [GRASS]: 6,
  [TOOL]: 2,
  [FILLER]: 24,
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

function rejected(state: GameState, action: GameAction): string {
  const result = applyAction(state, action);
  if (result.ok) throw new Error(`${action.type} was accepted`);
  return result.error.code;
}

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

/** Every non-deck zone's cards back into the deck, then `ids` into the hand. */
function setHand(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  const side = state.players[seat];
  let deck = [...side.deck, ...side.hand];
  const hand: string[] = [];
  for (const id of ids) {
    const uid = deck.find((u) => state.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`${seat} has no more ${id} in the deck`);
    deck = deck.filter((u) => u !== uid);
    hand.push(uid);
  }
  return { ...state, players: { ...state.players, [seat]: { ...side, hand, deck } } };
}

/** A prized copy of `id` swapped into the deck when the deck holds none. */
function ensureInDeck(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  if (side.deck.some((u) => state.cardIdByUid[u] === id)) return state;
  const prized = side.prizes.find((u) => state.cardIdByUid[u] === id);
  const swap = side.deck.find((u) => state.cardIdByUid[u] !== id);
  if (prized === undefined || swap === undefined) throw new Error(`${seat} has no ${id} to seat`);
  const next = {
    ...side,
    prizes: side.prizes.map((u) => (u === prized ? swap : u)),
    deck: [...side.deck.filter((u) => u !== swap), prized],
  };
  return { ...state, players: { ...state.players, [seat]: next } };
}

/** Every copy of `id` in the prizes swapped for deck cards that are not `id`. */
function unprize(state: GameState, seat: Seat, id: string): GameState {
  let next = state;
  for (;;) {
    const side = next.players[seat];
    const prized = side.prizes.find((u) => next.cardIdByUid[u] === id);
    if (prized === undefined) return next;
    const swap = side.deck.find((u) => next.cardIdByUid[u] === FILLER);
    if (swap === undefined) throw new Error("no filler to swap");
    next = {
      ...next,
      players: {
        ...next.players,
        [seat]: {
          ...side,
          prizes: side.prizes.map((u) => (u === prized ? swap : u)),
          deck: [...side.deck.filter((u) => u !== swap), prized],
        },
      },
    };
  }
}

/** TEST SURGERY — every Pokémon card in p1's DECK except `keep` goes to the discard pile, so a
    Pokémon search offers exactly the kept uids. */
function pokemonOnly(state: GameState, keep: readonly string[]): GameState {
  const side = state.players.p1;
  const gone = side.deck.filter((u) => POOL[state.cardIdByUid[u] ?? ""]?.category === "Pokemon" && !keep.includes(u));
  return {
    ...state,
    players: {
      ...state.players,
      p1: { ...side, deck: side.deck.filter((u) => !gone.includes(u)), discard: [...side.discard, ...gone] },
    },
  };
}

function toDiscard(state: GameState, seat: Seat, id: string): GameState {
  const next = ensureInDeck(state, seat, id);
  const side = next.players[seat];
  const uid = side.deck.find((u) => next.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`no ${id}`);
  return {
    ...next,
    players: {
      ...next.players,
      [seat]: { ...side, deck: side.deck.filter((u) => u !== uid), discard: [...side.discard, uid] },
    },
  };
}

type Spot = "active" | number;

function bodyAt(state: GameState, seat: Seat, spot: Spot): InPlayPokemon {
  const side = state.players[seat];
  const p = spot === "active" ? side.active : side.bench[spot];
  if (p === null || p === undefined) throw new Error(`no body at ${seat} ${String(spot)}`);
  return p;
}

function withBody(state: GameState, seat: Seat, spot: Spot, f: (p: InPlayPokemon) => InPlayPokemon): GameState {
  const side = state.players[seat];
  const next =
    spot === "active"
      ? { ...side, active: f(bodyAt(state, seat, "active")) }
      : { ...side, bench: side.bench.map((p, i) => (i === spot ? f(p) : p)) };
  return { ...state, players: { ...state.players, [seat]: next } };
}

/** TEST SURGERY — attach a deck copy of `id` to the body, as Energy or as a Tool. */
function attach(state: GameState, seat: Seat, spot: Spot, id: string, as: "energy" | "tools" = "energy"): GameState {
  const next = ensureInDeck(state, seat, id);
  const side = next.players[seat];
  const uid = side.deck.find((u) => next.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`no ${id}`);
  const moved = { ...next, players: { ...next.players, [seat]: { ...side, deck: side.deck.filter((u) => u !== uid) } } };
  return withBody(moved, seat, spot, (p) => ({ ...p, [as]: [...p[as], uid] }));
}

/** p1's turn 2: p1 `active` + `bench`, p2 a filler; hands emptied into the decks. */
function table(active: string = FILLER, bench: readonly string[] = [], seed = 5661): GameState {
  let state = setHand(setHand(opened(seed), "p1", []), "p2", []);
  state = setActiveFromDeck(ensureInDeck(state, "p1", active), "p1", active);
  state = setActiveFromDeck(ensureInDeck(state, "p2", FILLER), "p2", FILLER);
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of bench) state = benchFromDeck(ensureInDeck(state, "p1", id), "p1", id);
  return state;
}

function all<T extends GameEvent["type"]>(events: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const idOf = (state: GameState, uid: string | undefined) => (uid === undefined ? undefined : state.cardIdByUid[uid]);
const idsOf = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);
const topOf = (p: InPlayPokemon) => p.stack[p.stack.length - 1];

function play(state: GameState, id: string): { state: GameState; events: GameEvent[] } {
  const before = setHand(state, "p1", [...idsOf(state, state.players.p1.hand).filter((x): x is string => x !== undefined), id]);
  const uid = before.players.p1.hand.find((u) => before.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`no ${id} in hand`);
  return run(before, { type: "playTrainer", seat: "p1", uid });
}

function playRejected(state: GameState, id: string): string {
  const before = setHand(state, "p1", [id]);
  return rejected(before, { type: "playTrainer", seat: "p1", uid: before.players.p1.hand[0] as string });
}

function chooseCardsPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${prompt.kind}`);
  return prompt;
}

const cards = (uids: readonly string[]): GameAction =>
  ({ type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [...uids] } }) as GameAction;

const pickOwn = (spot: { spot: "active" } | { spot: "bench"; index: number }): GameAction =>
  ({ type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref: { seat: "p1", spot } } }) as GameAction;

function logText(state: GameState, events: readonly GameEvent[]): string[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: formatElapsed(0) };
  return logFromEvents([...events], ctx).flatMap((entry) =>
    entry.kind === "action" ? [entry.segments.map((s) => s.text).join("")] : [],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — the prints and the registry rows", () => {
  it("Brock's Scouting: ONE `searchDeck` carrying `orElse`, then the shuffle; the reprint shares the object", () => {
    const first = programFor(BROCK[0]);
    expect(first).toEqual({
      trainer: [
        {
          op: "searchDeck",
          filter: { kind: "basicPokemon" },
          max: 2,
          dest: "hand",
          reveal: true,
          orElse: { filter: { kind: "evolutionPokemon" }, max: 1 },
        },
        { op: "shuffleDeck" },
      ],
    });
    expect(programFor(BROCK[1])).toBe(first);
  });

  it("Ogre's Mask: ONE `switchWithDiscardNamed` over `pokemonNameContaining { Ogerpon, suffix ex }`", () => {
    const first = programFor(OGRE[0]);
    expect(first).toEqual({
      trainer: [
        { op: "switchWithDiscardNamed", filter: { kind: "pokemonNameContaining", fragment: "Ogerpon", suffix: "ex" } },
      ],
    });
    expect(programFor(OGRE[1])).toBe(first);
  });

  it("Team Rocket's Watchtower: a `stadium.disableAbilities` over {C} targets, both sides, and nothing else", () => {
    expect(programFor(WATCHTOWER)).toEqual({ stadium: { disableAbilities: { side: "both", targetType: "Colorless" } } });
  });

  it("the engine is 0.492.0", () => {
    expect(engineVersion).toBe("0.492.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§2 — Brock's Scouting: ONE alternative, WHOLLY (the disjunctive caps)", () => {
  /** p1's deck topped with 2 Basics and 2 Evolutions (no other Basic / Evolution in it). */
  function scouting(seed = 5662) {
    let state = table(FILLER, [], seed);
    for (const id of [BASIC, EVO]) state = unprize(state, "p1", id);
    const deck = state.players.p1.deck;
    const basics = deck.filter((u) => state.cardIdByUid[u] === BASIC).slice(0, 2);
    const evos = deck.filter((u) => state.cardIdByUid[u] === EVO).slice(0, 2);
    state = pokemonOnly(state, [...basics, ...evos]);
    const parked = play(state, BROCK[0]);
    return { ...parked, basics, evos };
  }

  it("🛑 the park: the UNION of both alternatives, max 2 (the LARGER, never the sum 3), min 0, `capsAnyOf` and no `caps`", () => {
    const { state, basics, evos } = scouting();
    const prompt = chooseCardsPrompt(state);
    expect(new Set(prompt.candidates)).toEqual(new Set([...basics, ...evos]));
    expect(prompt.min).toBe(0);
    expect(prompt.max).toBe(2);
    expect(prompt.dest).toBe("hand");
    expect(prompt.caps).toBeUndefined();
    expect(prompt.capsAnyOf?.map((entry) => [new Set(entry.uids), entry.max])).toEqual([
      [new Set(basics), 2],
      [new Set(evos), 1],
    ]);
    expect(prompt.note).toBe("Search your deck for up to 2 Basic Pokémon or 1 Evolution Pokémon into your hand.");
  });

  it("🛑 KEY RUNG: 1 Basic + 1 Evolution is REFUSED — the conjunctive caps [{Basic,2},{Evo,1}] under max 2 would pass it", () => {
    const { state, basics, evos } = scouting();
    const mixed = [basics[0] as string, evos[0] as string];
    // The conjunctive reading, computed off the same prompt: both per-kind caps hold and
    // the flat total holds — so ONLY the disjunctive key refuses it.
    const prompt = chooseCardsPrompt(state);
    const conjunctiveOk =
      mixed.length <= prompt.max &&
      (prompt.capsAnyOf ?? []).every((entry) => mixed.filter((u) => entry.uids.includes(u)).length <= entry.max);
    expect(conjunctiveOk).toBe(true);
    expect(rejected(state, cards(mixed))).toBe("BAD_EFFECT_CHOICE");
    expect(rejected(state, cards([evos[0] as string, basics[0] as string]))).toBe("BAD_EFFECT_CHOICE");
  });

  it("two Basics are taken, revealed, and the deck is shuffled after", () => {
    const { state, basics } = scouting();
    const { state: after, events } = run(state, cards(basics));
    expect(basics.every((u) => after.players.p1.hand.includes(u))).toBe(true);
    const searched = all(events, "DECK_SEARCHED")[0];
    expect(searched?.reveal).toBe(true);
    expect(new Set(searched?.uids)).toEqual(new Set(basics));
    const types = events.map((e) => e.type);
    expect(types.indexOf("SHUFFLE")).toBeGreaterThan(types.indexOf("DECK_SEARCHED"));
  });

  it("ONE Evolution is taken; TWO Evolutions are refused (that alternative's ceiling is 1)", () => {
    const { state, evos } = scouting();
    expect(rejected(state, cards(evos))).toBe("BAD_EFFECT_CHOICE");
    const { state: after } = run(state, cards([evos[0] as string]));
    expect(after.players.p1.hand).toContain(evos[0]);
  });

  it("ONE Basic alone is legal; three picks are refused by the ceiling; the empty answer declines and the shuffle still runs", () => {
    const { state, basics, evos } = scouting();
    expect(run(state, cards([basics[0] as string])).state.players.p1.hand).toContain(basics[0]);
    expect(rejected(state, cards([...basics, evos[0] as string]))).toBe("BAD_EFFECT_CHOICE");
    const declined = run(state, cards([]));
    expect(all(declined.events, "SHUFFLE")).toHaveLength(1);
    expect(declined.state.phase.kind).toBe("turn:action");
  });

  it("the wire carries `capsAnyOf` to the controller as FRESH arrays (the redactor's no-alias rule)", () => {
    const { state } = scouting();
    const view = redactGame(state, "p1");
    if (view.phase.kind !== "effect:choose" || view.phase.prompt?.kind !== "chooseCards") {
      throw new Error("expected a chooseCards park on the wire");
    }
    const engine = chooseCardsPrompt(state).capsAnyOf;
    expect(view.phase.prompt.capsAnyOf).toEqual(engine?.map((entry) => ({ uids: [...entry.uids], max: entry.max })));
    expect(view.phase.prompt.capsAnyOf?.[0]?.uids).not.toBe(engine?.[0]?.uids);
  });

  it("🛑 the parked search round-trips through JSON (`MATCH_RECORD_VERSION` holds at 36) and the refusal survives it", () => {
    const { state, basics, evos } = scouting();
    const revived = JSON.parse(JSON.stringify(state)) as GameState;
    expect(rejected(revived, cards([basics[0] as string, evos[0] as string]))).toBe("BAD_EFFECT_CHOICE");
    expect(run(revived, cards([evos[0] as string])).state.players.p1.hand).toContain(evos[0]);
  });

  it("no Basic and no Evolution in the deck: nothing parks, and the trailing shuffle still runs", () => {
    const state = pokemonOnly(table(FILLER, [], 5663), []);
    const { state: after, events } = play(state, BROCK[1]);
    expect(after.phase.kind).toBe("turn:action");
    expect(all(events, "DECK_SEARCHED")).toHaveLength(0);
    expect(all(events, "SHUFFLE")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§3 — Ogre's Mask: the in-place swap from the discard pile", () => {
  /** p1: Teal Mask Ogerpon ex Active (damaged, Burned, one Energy, one Tool), a Hearthflame
      Mask Ogerpon ex benched, and the given discard. */
  function masked(discard: readonly string[], bench: readonly string[] = [HEARTH_EX], seed = 5664): GameState {
    let state = table(TEAL_EX, bench, seed);
    state = attach(attach(state, "p1", "active", GRASS), "p1", "active", TOOL, "tools");
    state = withBody(state, "p1", "active", (p) => ({
      ...p,
      damage: 50,
      conditions: { ...p.conditions, burned: true },
      turnPlayed: 1,
    }));
    for (const id of discard) state = toDiscard(state, "p1", id);
    return state;
  }

  it("🛑 two bodies qualify and two DIFFERENT ex in the pile: TWO parks — the body, then the card (`dest \"swap\"`, mandatory)", () => {
    const state = masked([TEAL_EX, HEARTH_EX]);
    const first = play(state, OGRE[0]).state;
    if (first.phase.kind !== "effect:choose" || first.phase.prompt.kind !== "choosePokemon") {
      throw new Error("expected the body pick");
    }
    expect(first.phase.prompt.candidates).toEqual([
      { seat: "p1", spot: { spot: "active" } },
      { seat: "p1", spot: { spot: "bench", index: 0 } },
    ]);
    expect(first.phase.prompt.note).toBe(
      'Switch out which of your Pokémon in play (a Pokémon ex that has "Ogerpon" in its name)?',
    );
    const second = run(first, pickOwn({ spot: "active" })).state;
    const prompt = chooseCardsPrompt(second);
    expect(prompt.note).toBe('Switch in which card from your discard pile (a Pokémon ex that has "Ogerpon" in its name)?');
    expect(prompt.dest).toBe("swap");
    expect([prompt.min, prompt.max]).toEqual([1, 1]);
    expect(idsOf(second, prompt.candidates).sort()).toEqual([HEARTH_EX, TEAL_EX].sort());
    expect(rejected(second, cards([]))).toBe("BAD_EFFECT_CHOICE");
  });

  it("🛑 the swap: the TOP card is replaced IN PLACE — damage, conditions, Energy, Tool and turns in play stay; the old top goes to the DISCARD; no shuffle", () => {
    const state = masked([TEAL_EX, HEARTH_EX]);
    const before = bodyAt(state, "p1", "active");
    const oldTop = topOf(before);
    const second = run(play(state, OGRE[0]).state, pickOwn({ spot: "active" })).state;
    const incoming = chooseCardsPrompt(second).candidates.find((u) => second.cardIdByUid[u] === HEARTH_EX) as string;
    const { state: after, events } = run(second, cards([incoming]));
    const body = bodyAt(after, "p1", "active");
    expect(topOf(body)).toBe(incoming);
    expect(body.stack).toEqual([incoming]);
    expect(body.damage).toBe(50);
    expect(body.conditions.burned).toBe(true);
    expect(body.energy).toEqual(before.energy);
    expect(body.tools).toEqual(before.tools);
    expect(body.turnPlayed).toBe(1);
    expect(after.players.p1.discard).toContain(oldTop);
    expect(after.players.p1.discard).not.toContain(incoming);
    expect(all(events, "POKEMON_SWAPPED_FROM_DISCARD")).toEqual([
      { type: "POKEMON_SWAPPED_FROM_DISCARD", seat: "p1", fromUid: oldTop, toUid: incoming },
    ]);
    expect(all(events, "SHUFFLE")).toHaveLength(0);
    expect(all(events, "POKEMON_EVOLVED" as GameEvent["type"])).toHaveLength(0);
    expect(logText(after, events)).toContain(
      "switched Teal Mask Ogerpon ex with Hearthflame Mask Ogerpon ex from their discard pile",
    );
  });

  it("one body and one card id: BOTH questions are forced — the swap lands inline, no park", () => {
    const state = masked([HEARTH_EX], []);
    const { state: after, events } = play(state, OGRE[1]);
    expect(after.phase.kind).toBe("turn:action");
    expect(idOf(after, topOf(bodyAt(after, "p1", "active")))).toBe(HEARTH_EX);
    expect(all(events, "POKEMON_SWAPPED_FROM_DISCARD")).toHaveLength(1);
  });

  it("two copies of ONE card in the pile are interchangeable: the card question is forced (D42's collapse), no park", () => {
    let state = masked([HEARTH_EX], []);
    state = toDiscard(ensureInDeck(state, "p1", HEARTH_EX), "p1", HEARTH_EX);
    expect(state.players.p1.discard.filter((u) => state.cardIdByUid[u] === HEARTH_EX)).toHaveLength(2);
    const { state: after, events } = play(state, OGRE[0]);
    expect(after.phase.kind).toBe("turn:action");
    expect(all(events, "POKEMON_SWAPPED_FROM_DISCARD")).toHaveLength(1);
  });

  it("the BENCH body answered: only it changes, and the Active keeps its card", () => {
    const state = masked([TEAL_EX, HEARTH_EX]);
    const second = run(play(state, OGRE[0]).state, pickOwn({ spot: "bench", index: 0 })).state;
    const incoming = chooseCardsPrompt(second).candidates.find((u) => second.cardIdByUid[u] === TEAL_EX) as string;
    const after = run(second, cards([incoming])).state;
    expect(topOf(bodyAt(after, "p1", 0))).toBe(incoming);
    expect(idOf(after, topOf(bodyAt(after, "p1", "active")))).toBe(TEAL_EX);
    expect(topOf(bodyAt(after, "p1", "active"))).toBe(topOf(bodyAt(state, "p1", "active")));
  });

  it("🛑 a NON-ex Ogerpon is refused on the BODY side: the only Ogerpon in play is plain → the Item is unplayable", () => {
    let state = table(TEAL_PLAIN, [], 5665);
    state = toDiscard(state, "p1", HEARTH_EX);
    expect(playRejected(state, OGRE[0])).toBe("NO_LEGAL_TARGET");
  });

  it("🛑 a NON-ex Ogerpon is refused on the DISCARD side: the only Ogerpon in the pile is plain → unplayable", () => {
    let state = table(TEAL_EX, [], 5666);
    state = toDiscard(state, "p1", TEAL_PLAIN);
    expect(playRejected(state, OGRE[0])).toBe("NO_LEGAL_TARGET");
  });

  it("…and on a mixed board the plain Ogerpon is simply not OFFERED, on either side", () => {
    let state = table(TEAL_EX, [TEAL_PLAIN, HEARTH_EX], 5667);
    state = toDiscard(toDiscard(toDiscard(state, "p1", TEAL_PLAIN), "p1", HEARTH_EX), "p1", TEAL_EX);
    const first = play(state, OGRE[0]).state;
    if (first.phase.kind !== "effect:choose" || first.phase.prompt.kind !== "choosePokemon") {
      throw new Error("expected the body pick");
    }
    expect(first.phase.prompt.candidates).toEqual([
      { seat: "p1", spot: { spot: "active" } },
      { seat: "p1", spot: { spot: "bench", index: 1 } },
    ]);
    const second = run(first, pickOwn({ spot: "active" })).state;
    expect(idsOf(second, chooseCardsPrompt(second).candidates)).not.toContain(TEAL_PLAIN);
  });

  it("…and with no Ogerpon ex in the pile at all, or none in play, the Item is refused", () => {
    expect(playRejected(table(TEAL_EX, [], 5668), OGRE[0])).toBe("NO_LEGAL_TARGET");
    expect(playRejected(toDiscard(table(FILLER, [], 5669), "p1", TEAL_EX), OGRE[0])).toBe("NO_LEGAL_TARGET");
  });

  it("🛑 MID-TURN KO: the new top's HP (100) is at or below the carried damage (100) → swept at once, and the Prize is the OPPONENT's", () => {
    let state = table(FILLER, [TEAL_EX], 5670);
    state = withBody(state, "p1", 0, (p) => ({ ...p, damage: 100 }));
    state = toDiscard(state, "p1", TINY_EX);
    const { state: after, events } = play(state, OGRE[0]);
    const ko = all(events, "KNOCKED_OUT");
    expect(ko).toHaveLength(1);
    expect(idOf(after, ko[0]?.uid)).toBe(TINY_EX);
    expect(after.players.p1.bench).toHaveLength(0);
    // The KO'd seat's opponent takes the Prize (p2 parks or takes it).
    expect(events.some((e) => e.type === "PRIZES_OWED" || e.type === "PRIZES_TAKEN")).toBe(true);
    const prizeSeat = events.find((e) => e.type === "PRIZES_OWED" || e.type === "PRIZES_TAKEN") as { seat: Seat };
    expect(prizeSeat.seat).toBe("p2");
  });

  it("…and at 90 damage the same swap survives (the sweep reads the new HP, not the old)", () => {
    let state = table(FILLER, [TEAL_EX], 5671);
    state = withBody(state, "p1", 0, (p) => ({ ...p, damage: 90 }));
    state = toDiscard(state, "p1", TINY_EX);
    const { state: after, events } = play(state, OGRE[0]);
    expect(all(events, "KNOCKED_OUT")).toHaveLength(0);
    expect(idOf(after, topOf(bodyAt(after, "p1", 0)))).toBe(TINY_EX);
  });

  it("🛑 R-OM (UNRULED): Teal Dance used by the old top is FRESH on the new one — the lock keys on the top uid", () => {
    let state = table(TEAL_EX, [], 5672);
    state = toDiscard(state, "p1", TEAL_EX);
    state = setHand(state, "p1", [GRASS, GRASS]);
    const dance: GameAction = { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: "Teal Dance" };
    const danced = run(state, dance).state;
    const spent = danced.phase.kind === "effect:choose" ? danced : danced;
    expect(rejected(spent, dance)).toBe("ABILITY_ALREADY_USED");
    const swapped = play(spent, OGRE[0]).state;
    expect(swapped.phase.kind).toBe("turn:action");
    const again = run(swapped, dance);
    expect(all(again.events, "ENERGY_ATTACHED").length + all(again.events, "CARDS_DRAWN").length).toBeGreaterThan(0);
  });

  it("the first park round-trips through JSON (`MATCH_RECORD_VERSION` holds at 36) and resumes into question two", () => {
    const state = masked([TEAL_EX, HEARTH_EX]);
    const first = JSON.parse(JSON.stringify(play(state, OGRE[0]).state)) as GameState;
    const second = JSON.parse(JSON.stringify(run(first, pickOwn({ spot: "bench", index: 0 })).state)) as GameState;
    expect(chooseCardsPrompt(second).dest).toBe("swap");
    if (second.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(second.phase.cont.pendingOp).toMatchObject({ op: "switchWithDiscardNamed", bodyUid: topOf(bodyAt(state, "p1", 0)) });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§4 — Team Rocket's Watchtower: the first Stadium-sourced Ability lock", () => {
  /** Both seats: a {C} Dudunsparce Active and a {C} Farfetch'd + {G} Durant ex benched. */
  function towered(withTower: boolean, seed = 5673): GameState {
    let state = table(DUDUNSPARCE, [FARFETCHD, DURANT_EX], seed);
    state = setActiveFromDeck(ensureInDeck(state, "p2", DUDUNSPARCE), "p2", DUDUNSPARCE);
    state = clearBench(state, "p2");
    state = benchFromDeck(ensureInDeck(state, "p2", FARFETCHD), "p2", FARFETCHD);
    state = benchFromDeck(ensureInDeck(state, "p2", DURANT_EX), "p2", DURANT_EX);
    if (!withTower) return state;
    return play(state, WATCHTOWER).state;
  }

  const topUidAt = (state: GameState, seat: Seat, spot: Spot) => topOf(bodyAt(state, seat, spot)) as string;

  it("🛑 BOTH seats, Active AND Bench: every {C} body is locked and the {G} body is not", () => {
    const state = towered(true);
    expect(state.stadium).not.toBeNull();
    const locked = disabledAbilityUids(state);
    for (const seat of ["p1", "p2"] as const) {
      expect(locked.has(topUidAt(state, seat, "active"))).toBe(true);
      expect(locked.has(topUidAt(state, seat, 0))).toBe(true);
      expect(locked.has(topUidAt(state, seat, 1))).toBe(false);
    }
  });

  it("…and with NO Stadium the same board locks nothing (the Stadium is the whole source)", () => {
    expect(disabledAbilityUids(towered(false)).size).toBe(0);
  });

  it("🛑 a {C} ACTIVATED Ability is refused under it (`ABILITY_DISABLED`) and used without it", () => {
    const action: GameAction = { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: "Run Away Draw" };
    expect(rejected(towered(true), action)).toBe("ABILITY_DISABLED");
    expect(all(run(towered(false), action).events, "CARDS_DRAWN")).toHaveLength(1);
  });

  it("🛑 a {C} ON-PLAY TRIGGER does not fire under it (Farfetch'd parks no search); the {G} control's trigger does", () => {
    const base = setHand(ensureInDeck(ensureInDeck(towered(true), "p1", FARFETCHD), "p1", DURANT_EX), "p1", [
      FARFETCHD,
      DURANT_EX,
    ]);
    const farfetchd = base.players.p1.hand[0] as string;
    const benched = run(base, { type: "playBasicToBench", seat: "p1", uid: farfetchd });
    expect(benched.state.phase.kind).toBe("turn:action");
    expect(all(benched.events, "ABILITY_TRIGGERED")).toHaveLength(0);
    const durant = benched.state.players.p1.hand.find((u) => benched.state.cardIdByUid[u] === DURANT_EX) as string;
    const control = run(benched.state, { type: "playBasicToBench", seat: "p1", uid: durant });
    expect(all(control.events, "ABILITY_TRIGGERED").map((e) => e.ability)).toEqual(["Sudden Shearing"]);
  });

  it("…and without the Stadium the same Farfetch'd play DOES trigger (the control for the rung above)", () => {
    const base = setHand(ensureInDeck(towered(false), "p1", FARFETCHD), "p1", [FARFETCHD]);
    const benched = run(base, { type: "playBasicToBench", seat: "p1", uid: base.players.p1.hand[0] as string });
    expect(all(benched.events, "ABILITY_TRIGGERED").map((e) => e.ability)).toEqual(["Impromptu Carrier"]);
  });

  it("the OPPONENT's {C} Active is refused too, on its own turn", () => {
    const state = run(towered(true), { type: "endTurn", seat: "p1" }).state;
    const action: GameAction = { type: "useAbility", seat: "p2", target: { spot: "active" }, abilityName: "Run Away Draw" };
    expect(rejected(state, action)).toBe("ABILITY_DISABLED");
  });

  it("the wire greys the {C} Ability row for the acting viewer (the redactor reads the same Set), and lights it without the Stadium", () => {
    for (const [withTower, disabled] of [
      [true, true],
      [false, false],
    ] as const) {
      const view = redactGame(towered(withTower), "p1");
      if (view.phase.kind !== "turn:action") throw new Error("expected turn:action on the wire");
      const row = view.phase.abilities.find((a) => a.abilityName === "Run Away Draw" && a.target.spot === "active");
      expect(row?.disabled).toBe(disabled);
    }
  });

  it("🛑 R-WT1 TRIPWIRE (🆕🆕🆕 D578: INVERTED): ONE registered passive rewrites a Pokémon's TYPE, `typesInPlay` — the Watchtower still reads PRINTED types, exact because no retype names {C}", () => {
    // ~~The parked Scovillain ex "Double Type" … is UNBUILT, and the day it lands this rung must
    // move the Watchtower's read to an effective-types reader.~~ 🆕🆕🆕 D578 (D539): BUILT
    // (`DOUBLE_TYPE`, `typesInPlay: ["Grass", "Fire"]`), and the Watchtower read STAYS PRINTED
    // (the effective reader would recurse through `disabledAbilityUids`); its exactness is now
    // the no-{C} registry walk in `scovillainD578.test.ts`.
    expect(programFor("sv08-037")?.passive?.typesInPlay).toEqual(["Grass", "Fire"]);
    expect(programFor("sv08-216")).toBe(programFor("sv08-037"));
    const passiveKeys = new Set<string>();
    for (const id of registryCardIds()) {
      for (const key of Object.keys(programFor(id)?.passive ?? {})) passiveKeys.add(key);
    }
    const typeKeys = [...passiveKeys].filter((key) => /type/i.test(key)).sort();
    // Every type-NAMING passive key, each one a filter, a reduction or a weakness rewrite —
    // ~~none rewrites the holder's own `types`~~ 🆕🆕🆕 D578 (D539): ONE does, `typesInPlay`. A
    // new key here must be read before it is added.
    expect(typeKeys).toEqual([
      "damageReductionAfterWRFromTypeThenDiscard",
      "damageReductionAfterWRIfType",
      "preventDamageFromType",
      "typesInPlay", // 🆕🆕🆕 D578 — the ONE key that rewrites the holder's own types
      // 🆕🆕🆕 D580 — NOT a second rewriter: Iron Treads "Dual Core"'s CONDITION on `typesInPlay` (the
      // retype holds only while a Tool of this NAME is attached). It names no type, so the Watchtower's
      // printed read stays exact — `typesInPlay` is still the ONE key that rewrites a holder's types.
      "typesInPlayWhileToolNamed",
    ]);
  });

  it("🛑 R-LK1 RESTATED WITH THE WATCHTOWER BUILT: neither legal Pokémon lock source is {C}, so it switches no lock off", () => {
    // Flutter Mane `sv05-078` is {P} and Gastrodon `sv08-107` is {F} (tcgdex, 2026-09-28).
    // 🆕🆕🆕 D571 — and Iron Thorns ex `sv06-077` "Initialization" (built at D571, the THIRD legal
    // Pokémon lock) is {L} (tcgdex, 2026-10-03), so the Watchtower still switches no lock off.
    expect(programFor("sv05-078")?.passive?.disableAbilities).toBeDefined();
    expect(programFor("sv08-107")?.passive?.disableAbilities).toBeDefined();
    expect(programFor("sv06-077")?.passive?.disableAbilities).toBeDefined();
    const printed: Record<string, readonly string[]> = {
      "sv05-078": ["Psychic"],
      "sv08-107": ["Fighting"],
      "sv06-077": ["Lightning"],
    };
    for (const types of Object.values(printed)) expect(types).not.toContain("Colorless");
  });
});
