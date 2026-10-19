import type { Card } from "@luminous/schema";
import { redactedGameSchema } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { cardOfUid, hasPrintedAbility, hpOf, isFossilTop, prizeValueOf } from "./cards";
import { CATALOG_MANIFEST } from "./catalogManifest";
import { fossilPlayable } from "./cardplay";
import {
  disabledAbilityUids,
  effectiveMaxHp,
  isLethallyDamaged,
  passivesOf,
  retreatLocked,
} from "./continuous";
import { deriveAttackEffect } from "./effects";
import type { GameEvent } from "./events";
import { FOSSIL_HP, FOSSIL_IDS, fossilPokemonCard } from "./fossils";
import { applyAction, attackCostAt, createGame, discardableTargets, engineVersion } from "./index";
import type { GameAction, GameState, PokemonTarget, Seat } from "./index";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { redactGame } from "./redact";
import { programFor } from "./registry";
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

// ── 🆕🆕🆕 D576 — THE ANTIQUE FOSSILS: FOUR PRINTINGS, THREE TEXTS, `MATCH_RECORD_VERSION` 38 → 39 ──
//
//   Antique Cover Fossil  sv07-129, sv10.5b-080  "Protective Cover" — no attack EFFECTS on it (R-FO5)
//   Antique Root Fossil   sv07-130               "Primal Root"      — Active: the opponent's Basic
//                                                                     attackers pay {C} more (R-FO5)
//   Antique Plume Fossil  sv10.5w-079            "Plume Protection" — Benched: no attack DAMAGE (R-FO5)
//
// Each prints: *"Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by
// any Special Conditions and can't retreat. At any time during your turn, you may discard this card from
// play."* — R-FO1 (an ITEM play), R-FO2 (a Pokémon only in play), R-FO3 (discard from play), R-FO4 (the
// card rules are not Abilities), R-FO6 (evolution onto it). Area Zero Underdepths ×3 is PARKED (D577).
// (🆕🆕🆕 D577 (D539): *"PARKED"* is WITHDRAWN — BUILT at D577, `areaZeroUnderdepthsD577.test.ts`.)
//
// Every card is driven on its REAL id on a LOCAL `cardPool` (D275) in the suite's OWN deck (D270). The
// fossils are built exactly as the catalog row arrives today — ~~an Item with `hp: null` and
// `abilities: null` (the ingest drops both; decisions.md D576)~~ 🆕 D581: an Item carrying tcgdex's
// `hp: 60` and its printed `abilities`, taken from `CATALOG_MANIFEST.trainerFaces` (the local D1,
// measured — `apps/api/src/ingest/map.ts` keeps a Trainer's printed face since D581) — so the Ability
// on the Pokémon face this suite sees is the CATALOG's, read by `fossils.ts`. Texts copied VERBATIM from
// the tcgdex card JSON (2026-09-25) and pinned equal to the manifest's; the suite never reads that JSON
// at run time.

const COVER = "sv07-129";
const COVER_2 = "sv10.5b-080";
const ROOT = "sv07-130";
const PLUME = "sv10.5w-079";
const LILEEP = "sv07-005";
const CRADILY = "sv07-006";
const RARE_CANDY = "sv01-191";
const NEST_BALL = "sv01-181";
const SWITCH = "sv01-194";
const KLEFKI = "sv01-096";
const TYRANITAR = "sv09-095";
const ARBOK = "sv10-113";
const WATCHTOWER = "sv10-180";
const HITTER = "d576t-hitter";
const STAGE1_HITTER = "d576t-stage1-hitter";
const FIGHTER = "d576t-fighter";
const SPREADER = "d576t-spreader";
const SNIPER = "d576t-sniper";
const SELF_SPREADER = "d576t-self-spreader";
const SELF_SNIPER = "d576t-self-sniper";
const COUNTERS = "d576t-counters";
const STRIPPER = "d576t-stripper";
const FILLER = "d576t-filler";
const ABILITY_BASIC = "d576t-ability-basic";
const GRASS = "d576t-grass";
const COLORLESS = "fix-energy";
const STATUSES = ["Asleep", "Burned", "Confused", "Paralyzed", "Poisoned"] as const;
const statusHitter = (status: (typeof STATUSES)[number]): string => `d576t-status-${status.toLowerCase()}`;

/** The rule every fossil prints, VERBATIM (tcgdex `effect`, all four rows). */
const FOSSIL_RULE =
  "Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat.\n\nAt any time during your turn, you may discard this card from play.";
/** The three printed Abilities, VERBATIM (tcgdex `abilities[0]`). */
const PROTECTIVE_COVER_TEXT =
  "Prevent all effects of attacks used by your opponent's Pokémon done to this Pokémon. (Damage is not an effect.)";
const PRIMAL_ROOT_TEXT =
  "As long as this Pokémon is in the Active Spot, attacks used by your opponent's Basic Pokémon cost {C} more.";
const PLUME_PROTECTION_TEXT =
  "As long as this Pokémon is on your Bench, prevent all damage done to this Pokémon by attacks from your opponent's Pokémon.";
const SPINNING_TAIL =
  "This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const BENCH_SNIPE =
  "This attack also does 20 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** D425's `"yourBench"` spread and D447's own-Bench snipe: the ATTACKER'S OWN Bench is hit. */
const SELF_SPREAD = "This attack does 30 damage to each of your Benched Pokémon.";
const SELF_SNIPE =
  "This attack also does 20 damage to 1 of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const PUT_COUNTERS = "Put 2 damage counters on 1 of your opponent's Pokémon.";
const STRIP = "Discard an Energy from your opponent's Active Pokémon.";

/** A fossil exactly as the catalog row arrives: an Item ~~with `hp`/`abilities` null (the ingest drops
    both)~~ 🆕 D581: carrying its printed `hp` and `abilities`, read off `CATALOG_MANIFEST.trainerFaces`. */
function fossilRow(id: string, name: string): Card {
  const face = CATALOG_MANIFEST.trainerFaces[id];
  if (face === undefined) throw new Error(`no catalog face for ${id}`);
  return { ...trainerCard(id, "Item", FOSSIL_RULE), name, hp: face.hp, abilities: face.abilities };
}

const LOCAL_CARDS: Record<string, Card> = {
  [COVER]: fossilRow(COVER, "Antique Cover Fossil"),
  [COVER_2]: fossilRow(COVER_2, "Antique Cover Fossil"),
  [ROOT]: fossilRow(ROOT, "Antique Root Fossil"),
  [PLUME]: fossilRow(PLUME, "Antique Plume Fossil"),
  [LILEEP]: battler(LILEEP, {
    name: "Lileep",
    stage: "Stage1",
    evolveFrom: "Antique Root Fossil",
    types: ["Grass"],
    hp: 100,
    retreat: 2,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [
      {
        cost: ["Grass"],
        name: "Bind Down",
        damage: 50,
        effect: "During your opponent's next turn, the Defending Pokémon can't retreat.",
      },
    ],
  }),
  [CRADILY]: battler(CRADILY, {
    name: "Cradily",
    stage: "Stage2",
    evolveFrom: "Lileep",
    types: ["Grass"],
    hp: 150,
    retreat: 3,
    weaknesses: [{ type: "Fire", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Selective Slime",
        effect:
          "Once during your turn, you may flip a coin. If heads, choose Burned, Confused, or Poisoned. Your opponent's Active Pokémon is now affected by that Special Condition.",
      },
    ],
    attacks: [
      {
        cost: ["Grass"],
        name: "Miasma Wind",
        damage: "100×",
        effect: "This attack does 100 damage for each Special Condition affecting your opponent's Active Pokémon.",
      },
    ],
  }),
  [TYRANITAR]: battler(TYRANITAR, {
    name: "Tyranitar",
    stage: "Stage2",
    types: ["Darkness"],
    hp: 180,
    retreat: 3,
    abilities: [
      {
        type: "Ability",
        name: "Daunting Gaze",
        effect: "As long as this Pokémon is in the Active Spot, your opponent can't play any Item cards from their hand.",
      },
    ],
  }),
  [ARBOK]: battler(ARBOK, {
    name: "Team Rocket's Arbok",
    stage: "Stage1",
    types: ["Darkness"],
    hp: 120,
    retreat: 2,
    abilities: [
      {
        type: "Ability",
        name: "Potent Glare",
        effect:
          "As long as this Pokémon is in the Active Spot, your opponent can't play any Pokémon that has an Ability, except for Team Rocket's Pokémon, from their hand to evolve or to put onto their Bench.",
      },
    ],
  }),
  [WATCHTOWER]: {
    ...trainerCard(
      WATCHTOWER,
      "Stadium",
      "{C} Pokémon in play (both yours and your opponent's) have no Abilities.",
    ),
    name: "Team Rocket's Watchtower",
  },
  [HITTER]: battler(HITTER, {
    name: "D576 Hitter",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Crush", damage: 60 }],
  }),
  [STAGE1_HITTER]: battler(STAGE1_HITTER, {
    name: "D576 Stage 1 Hitter",
    stage: "Stage1",
    evolveFrom: "D576 Hitter",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Crush", damage: 60 }],
  }),
  [FIGHTER]: battler(FIGHTER, {
    name: "D576 Fighter",
    hp: 900,
    types: ["Fighting"],
    attacks: [{ cost: [], name: "Jab", damage: 30 }],
  }),
  [SPREADER]: battler(SPREADER, {
    name: "D576 Spreader",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Spinning Tail", effect: SPINNING_TAIL }],
  }),
  [SNIPER]: battler(SNIPER, {
    name: "D576 Sniper",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Pick Off", damage: 10, effect: BENCH_SNIPE }],
  }),
  [SELF_SPREADER]: battler(SELF_SPREADER, {
    name: "D576 Self Spreader",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Backfire", effect: SELF_SPREAD }],
  }),
  [SELF_SNIPER]: battler(SELF_SNIPER, {
    name: "D576 Self Sniper",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Misfire", damage: 10, effect: SELF_SNIPE }],
  }),
  [COUNTERS]: battler(COUNTERS, {
    name: "D576 Counters",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Hex", effect: PUT_COUNTERS }],
  }),
  [STRIPPER]: battler(STRIPPER, {
    name: "D576 Stripper",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Strip", damage: 10, effect: STRIP }],
  }),
  [FILLER]: battler(FILLER, {
    name: "D576 Filler",
    hp: 900,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  [ABILITY_BASIC]: battler(ABILITY_BASIC, {
    name: "D576 Ability Basic",
    hp: 70,
    types: ["Colorless"],
    abilities: [{ type: "Ability", name: "D576 Nothing", effect: "This Ability does nothing." }],
  }),
  [GRASS]: typedEnergy(GRASS, "Grass"),
  ...Object.fromEntries(
    STATUSES.map((status) => [
      statusHitter(status),
      battler(statusHitter(status), {
        name: `D576 ${status} Hitter`,
        hp: 900,
        types: ["Colorless"],
        attacks: [{ cost: [], name: "Daze", effect: `Your opponent's Active Pokémon is now ${status}.` }],
      }),
    ]),
  ),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [COVER]: 2,
  [COVER_2]: 1,
  [ROOT]: 2,
  [PLUME]: 2,
  [LILEEP]: 1,
  [CRADILY]: 1,
  [RARE_CANDY]: 1,
  [NEST_BALL]: 1,
  [SWITCH]: 1,
  [KLEFKI]: 1,
  [TYRANITAR]: 1,
  [ARBOK]: 1,
  [WATCHTOWER]: 1,
  [HITTER]: 1,
  [STAGE1_HITTER]: 1,
  [FIGHTER]: 1,
  [SPREADER]: 1,
  [SNIPER]: 1,
  [SELF_SPREADER]: 1,
  [SELF_SNIPER]: 1,
  [COUNTERS]: 1,
  [STRIPPER]: 1,
  [ABILITY_BASIC]: 1,
  ...Object.fromEntries(STATUSES.map((status) => [statusHitter(status), 1])),
  [FILLER]: 15,
  [GRASS]: 4,
  [COLORLESS]: 10,
});

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function run(state: GameState, action: GameAction): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  return { state: result.state, events: result.events };
}

function refused(state: GameState, action: GameAction): { code: string; message: string } {
  const result = applyAction(state, action);
  if (result.ok) throw new Error(`${action.type} was accepted`);
  return { code: result.error.code, message: result.error.message };
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

/** TEST SURGERY — `seat`'s hand back into the deck, the hand then EXACTLY `ids` (from the deck, or swapped
    out of the Prizes). */
function setHand(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  const side = state.players[seat];
  let deck = [...side.deck, ...side.hand];
  let prizes = [...side.prizes];
  const hand: string[] = [];
  for (const id of ids) {
    const uid = deck.find((u) => state.cardIdByUid[u] === id);
    if (uid !== undefined) {
      deck = deck.filter((u) => u !== uid);
      hand.push(uid);
      continue;
    }
    const prized = prizes.find((u) => state.cardIdByUid[u] === id);
    const swap = deck.find((u) => !ids.includes(state.cardIdByUid[u] ?? ""));
    if (prized === undefined || swap === undefined) throw new Error(`${seat} has no more ${id}`);
    prizes = prizes.map((u) => (u === prized ? swap : u));
    deck = deck.filter((u) => u !== swap);
    hand.push(prized);
  }
  return { ...state, players: { ...state.players, [seat]: { ...side, hand, deck, prizes } } };
}

/** TEST SURGERY — one copy of `id` into `seat`'s DECK (from the hand, or swapped out of the Prizes). */
function ensureInDeck(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  if (side.deck.some((u) => state.cardIdByUid[u] === id)) return state;
  const held = side.hand.find((u) => state.cardIdByUid[u] === id);
  if (held !== undefined) {
    const next = { ...side, hand: side.hand.filter((u) => u !== held), deck: [...side.deck, held] };
    return { ...state, players: { ...state.players, [seat]: next } };
  }
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

/** p1's turn 2: p1 `active` + `bench`, p2 `oppActive` + `oppBench`. Hands emptied into the decks. */
function table(
  active: string,
  bench: readonly string[] = [],
  oppActive: string = FILLER,
  oppBench: readonly string[] = [],
  seed = 5763,
): GameState {
  let state = setHand(setHand(opened(seed), "p1", []), "p2", []);
  state = setActiveFromDeck(ensureInDeck(state, "p1", active), "p1", active);
  state = setActiveFromDeck(ensureInDeck(state, "p2", oppActive), "p2", oppActive);
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of bench) state = benchFromDeck(ensureInDeck(state, "p1", id), "p1", id);
  for (const id of oppBench) state = benchFromDeck(ensureInDeck(state, "p2", id), "p2", id);
  return state;
}

/** The cost p2's Active is charged for attack `index` right now (`attackCostAt`, nothing attached). */
const costOf = (state: GameState, index = 0): readonly string[] =>
  attackCostAt(state, "p2", bodyAt(state, "p2", "active"), index, []);

/** p2's own turn on the same table (p1 passed). */
function p2Turn(state: GameState): GameState {
  return must(applyAction(state, { type: "endTurn", seat: "p1" }));
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

/** TEST SURGERY — attach deck copies of `ids` to the body, in order. */
function attach(state: GameState, seat: Seat, spot: Spot, ...ids: string[]): GameState {
  let next = state;
  for (const id of ids) {
    next = ensureInDeck(next, seat, id);
    const side = next.players[seat];
    const uid = side.deck.find((u) => next.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`no ${id} in the deck`);
    next = { ...next, players: { ...next.players, [seat]: { ...side, deck: side.deck.filter((u) => u !== uid) } } };
    next = withBody(next, seat, spot, (p) => ({ ...p, energy: [...p.energy, uid] }));
  }
  return next;
}

/** TEST SURGERY — put Team Rocket's Watchtower into the shared Stadium zone (owned by `owner`). */
function withWatchtower(state: GameState, owner: Seat = "p2"): GameState {
  const seated = ensureInDeck(state, owner, WATCHTOWER);
  const side = seated.players[owner];
  const uid = side.deck.find((u) => seated.cardIdByUid[u] === WATCHTOWER);
  if (uid === undefined) throw new Error("no Watchtower");
  return {
    ...seated,
    players: { ...seated.players, [owner]: { ...side, deck: side.deck.filter((u) => u !== uid) } },
    stadium: { uid, owner },
  };
}

function all<T extends GameEvent["type"]>(events: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const top = (p: InPlayPokemon): string => p.stack[p.stack.length - 1] as string;

function render(events: GameEvent[], state: GameState): string[] {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn" ? [] : [`${entry.who}: ${entry.segments.map((s) => s.text).join("")}`],
  );
}

const attack = (seat: Seat, index: number): GameAction => ({ type: "attack", seat, index }) as GameAction;
const handUidOf = (state: GameState, seat: Seat, id: string): string => {
  const uid = state.players[seat].hand.find((u) => state.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`${seat} holds no ${id}`);
  return uid;
};
const play = (state: GameState, id: string): GameAction => ({
  type: "playTrainer",
  seat: "p1",
  uid: handUidOf(state, "p1", id),
});
const discard = (seat: Seat, target: PokemonTarget): GameAction => ({
  type: "discardFromPlay",
  seat,
  target,
});

// ─────────────────────────────────────────────────────────────────────────────
// §0 — the face, pinned LITERALLY against the printed card (🆕 D581: the Ability is the catalog row's).
// ─────────────────────────────────────────────────────────────────────────────
describe("D576 §0 — `fossils.ts`: the Pokémon face, its Ability read off the catalog row (D581)", () => {
  it("🛑 FOUR ids, and only these — keyed by PRINTING id (🆕🆕🆕 D637 (D539): EIGHT — the four `me` fossils joined, antiqueFossilsMeD637.test.ts)", () => {
    // 🆕🆕🆕 D637 — plus Antique Jaw / Sail Fossil `me03-068` / `-069` and Antique Armor / Skull Fossil `me05-072` / `-073`.
    expect([...FOSSIL_IDS].sort()).toEqual([COVER, ROOT, COVER_2, PLUME, "me03-068", "me03-069", "me05-072", "me05-073"].sort());
    for (const id of [LILEEP, RARE_CANDY, NEST_BALL, "sv07-131"]) expect(FOSSIL_IDS.has(id), id).toBe(false);
  });

  it("🛑 the three printed Abilities, VERBATIM — names and texts, on the CATALOG rows (D581)", () => {
    const faces = CATALOG_MANIFEST.trainerFaces;
    const ability = (name: string, effect: string) => [{ type: "Ability", name, effect }];
    expect(faces[COVER]?.abilities).toEqual(ability("Protective Cover", PROTECTIVE_COVER_TEXT));
    expect(faces[COVER_2]?.abilities).toEqual(ability("Protective Cover", PROTECTIVE_COVER_TEXT));
    expect(faces[ROOT]?.abilities).toEqual(ability("Primal Root", PRIMAL_ROOT_TEXT));
    expect(faces[PLUME]?.abilities).toEqual(ability("Plume Protection", PLUME_PROTECTION_TEXT));
    // The rule's "60-HP" and the row's printed `hp` are the same number on all four (FOSSIL_HP).
    for (const id of [COVER, COVER_2, ROOT, PLUME]) expect(faces[id]?.hp, id).toBe(FOSSIL_HP);
    expect(faces[LILEEP]).toBeUndefined();
  });

  it("🛑 D581 — the face's Ability IS the row's: a different row gives a different face, a stale row none", () => {
    const row = POOL[COVER] as Card;
    const other = { ...row, abilities: [{ type: "Ability", name: "D581 Other", effect: "Not printed." }] };
    expect(fossilPokemonCard(other).abilities).toEqual(other.abilities);
    // A catalog not re-ingested since D581 hands the engine `abilities: null` — the face then has no
    // Ability (the deploy-order caveat in fossils.ts), and is still the 60-HP Basic {C} Pokémon.
    const stale = { ...row, hp: null, abilities: null };
    expect(fossilPokemonCard(stale)).toMatchObject({ category: "Pokemon", hp: 60, abilities: [] });
  });

  it("🛑 the in-play face: a Basic {C} Pokémon, 60 HP, its Ability, no attacks / Weakness / Resistance / Retreat", () => {
    const row = POOL[ROOT] as Card;
    // The catalog row as the ingest writes it today (🆕 D581: with its printed hp and Ability).
    expect(row).toMatchObject({ category: "Trainer", trainerType: "Item", hp: 60 });
    expect(row.abilities).toEqual([{ type: "Ability", name: "Primal Root", effect: PRIMAL_ROOT_TEXT }]);
    const face = fossilPokemonCard(row);
    expect(FOSSIL_HP).toBe(60);
    expect(face).toMatchObject({
      id: ROOT,
      name: "Antique Root Fossil",
      category: "Pokemon",
      stage: "Basic",
      hp: 60,
      types: ["Colorless"],
      retreat: 0,
      attacks: [],
      weaknesses: [],
      resistances: [],
      trainerType: null,
    });
    expect(face.abilities).toEqual([{ type: "Ability", name: "Primal Root", effect: PRIMAL_ROOT_TEXT }]);
    // Memoized per id: the same object for the same catalog row, and the row itself for a non-fossil.
    expect(fossilPokemonCard(row)).toBe(face);
    expect(fossilPokemonCard(POOL[LILEEP] as Card)).toBe(POOL[LILEEP]);
  });

  it("🛑 the registry: `playAsPokemon` + the printed Ability as `passive` — three objects on four ids", () => {
    expect(programFor(COVER)).toEqual({ playAsPokemon: true, passive: { preventAttackEffects: true } });
    expect(programFor(COVER_2)).toBe(programFor(COVER));
    expect(programFor(ROOT)).toEqual({
      playAsPokemon: true,
      passive: { opponentActiveAttackCostSurcharge: 1, opponentActiveAttackCostSurchargeBasicOnly: true },
    });
    expect(programFor(PLUME)).toEqual({ playAsPokemon: true, passive: { preventDamageWhileBenched: true } });
    // Cover is Skeledirge "Unaware"'s sentence word for word, so its field IS Unaware's.
    expect(programFor("sv08-031")?.passive).toEqual(programFor(COVER)?.passive);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §1 — R-FO1: playing it is an ITEM play onto the Bench.
// ─────────────────────────────────────────────────────────────────────────────
describe("D576 §1 — R-FO1: an ITEM play that lands on the Bench", () => {
  it("🛑 the hand card goes to the BENCH (never the discard pile), announced as an Item then a body", () => {
    const s = setHand(table(FILLER), "p1", [COVER]);
    const uid = handUidOf(s, "p1", COVER);
    const { state, events } = run(s, play(s, COVER));
    expect(state.players.p1.hand).not.toContain(uid);
    expect(state.players.p1.discard).not.toContain(uid);
    expect(state.players.p1.bench.map(top)).toEqual([uid]);
    expect(bodyAt(state, "p1", 0).turnPlayed).toBe(state.turn);
    expect(events).toEqual([
      { type: "TRAINER_PLAYED", seat: "p1", uid, trainerType: "Item" },
      { type: "POKEMON_BENCHED", seat: "p1", uid },
    ]);
    // A Supporter allowance is untouched (it is an Item), and the turn goes on.
    expect(state.allowances.supporterPlayed).toBe(false);
    expect(state.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
  });

  it("🛑 an Item bar refuses it — the opponent's STAMPED bar and its Active's CONTINUOUS one (Tyranitar)", () => {
    const s = setHand(table(FILLER), "p1", [ROOT]);
    const stamped: GameState = {
      ...s,
      handPlayLockedTurn: { ...s.handPlayLockedTurn, p1: { ...s.handPlayLockedTurn.p1, Item: s.turn } },
    };
    expect(refused(stamped, play(stamped, ROOT)).code).toBe("HAND_PLAY_BLOCKED");
    const gazed = setHand(table(FILLER, [], TYRANITAR), "p1", [ROOT]);
    expect(refused(gazed, play(gazed, ROOT))).toEqual({
      code: "HAND_PLAY_BLOCKED",
      message: "your opponent prevents you from playing Item cards from your hand",
    });
  });

  it("🛑 a POKÉMON-play bar does NOT refuse it (Team Rocket's Arbok \"Potent Glare\") — it is not a Pokémon from the hand", () => {
    const s = setHand(table(FILLER, [], ARBOK), "p1", [PLUME, ABILITY_BASIC]);
    // The control: a Basic WITH an Ability really is barred on this board.
    const basic = handUidOf(s, "p1", ABILITY_BASIC);
    expect(refused(s, { type: "playBasicToBench", seat: "p1", uid: basic }).code).toBe("HAND_PLAY_BLOCKED");
    expect(run(s, play(s, PLUME)).state.players.p1.bench).toHaveLength(1);
  });

  it("🛑 it is not \"playing a Basic Pokémon\": the bench-play action refuses it as NOT a Basic", () => {
    const s = setHand(table(FILLER), "p1", [COVER]);
    expect(refused(s, { type: "playBasicToBench", seat: "p1", uid: handUidOf(s, "p1", COVER) }).code).toBe(
      "NOT_A_BASIC_POKEMON",
    );
  });

  it("🛑 it needs a free Bench slot — a full Bench refuses it, and both Trainer lists grey it the same way", () => {
    const full = setHand(table(FILLER, [FILLER, FILLER, FILLER, FILLER, FILLER]), "p1", [COVER]);
    expect(fossilPlayable(full, "p1")).toBe(false);
    expect(refused(full, play(full, COVER)).code).toBe("BENCH_FULL");
    const wire = redactGame(full, "p1").phase;
    if (wire.kind !== "turn:action") throw new Error("expected turn:action");
    expect(wire.trainers).toEqual([
      { uid: handUidOf(full, "p1", COVER), name: "Antique Cover Fossil", disabled: true, reason: "No legal target", rareCandy: false },
    ]);
    const roomy = setHand(table(FILLER, [FILLER]), "p1", [COVER]);
    expect(fossilPlayable(roomy, "p1")).toBe(true);
    const lit = redactGame(roomy, "p1").phase;
    if (lit.kind !== "turn:action") throw new Error("expected turn:action");
    expect(lit.trainers.map((t) => [t.name, t.disabled])).toEqual([["Antique Cover Fossil", false]]);
  });

  it("the log reads as an Item play and a body benched", () => {
    const s = setHand(table(FILLER), "p1", [PLUME]);
    const { state, events } = run(s, play(s, PLUME));
    const rows = render(events, state);
    expect(rows).toEqual(["p1: played Antique Plume Fossil", "p1: benched Antique Plume Fossil"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — R-FO2: a Pokémon ONLY while in play.
// ─────────────────────────────────────────────────────────────────────────────
describe("D576 §2 — R-FO2: a 60-HP Basic {C} Pokémon in play, and an Item everywhere else", () => {
  it("🛑 `cardOfUid` is zone-aware: Item in the hand, Pokémon on the Bench, Item again in the discard pile", () => {
    const s = setHand(table(FILLER), "p1", [COVER]);
    const uid = handUidOf(s, "p1", COVER);
    expect(cardOfUid(s, uid)).toMatchObject({ category: "Trainer", trainerType: "Item" });
    // 🆕 D581 — the Item in the hand carries its catalog Ability and is still NOT a Pokémon with one.
    expect(hasPrintedAbility(cardOfUid(s, uid))).toBe(false);
    const benched = run(s, play(s, COVER)).state;
    expect(cardOfUid(benched, uid)).toMatchObject({ category: "Pokemon", stage: "Basic", hp: 60, types: ["Colorless"] });
    const gone = run(benched, discard("p1", { spot: "bench", index: 0 })).state;
    expect(gone.players.p1.discard).toContain(uid);
    expect(cardOfUid(gone, uid)).toMatchObject({ category: "Trainer", trainerType: "Item" });
    // A non-fossil uid never pays more than the one `Set.has`: the catalog row, by identity.
    const filler = top(bodyAt(gone, "p1", "active"));
    expect(cardOfUid(gone, filler)).toBe(POOL[FILLER]);
  });

  it("🛑 60 HP: 60 damage Knocks it Out, for ONE Prize", () => {
    const s = p2Turn(table(COVER, [FILLER], HITTER));
    const fossil = bodyAt(s, "p1", "active");
    expect(effectiveMaxHp(s, fossil)).toBe(60);
    expect(prizeValueOf(cardOfUid(s, top(fossil)) as Card)).toBe(1);
    const { state, events } = run(s, attack("p2", 0));
    expect(all(events, "KNOCKED_OUT").map((e) => e.uid)).toEqual([top(fossil)]);
    expect(state.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p2", count: 1 });
  });

  it("🛑 no Weakness and no Resistance — a Fighting attacker's 30 lands as 30", () => {
    const s = p2Turn(table(PLUME, [FILLER], FIGHTER));
    expect(bodyAt(run(s, attack("p2", 0)).state, "p1", "active").damage).toBe(30);
  });

  it("🛑 not placeable in setup — the hand card is not a Basic Pokémon", () => {
    const created = createGame({ seed: 5763, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
    if (!created.ok) throw new Error("createGame failed");
    let state = created.state;
    if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
    state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }));
    while (state.phase.kind === "setup:drawExtra") {
      const phase = state.phase;
      const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
      if (s === undefined) break;
      state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
    }
    const withFossil = setHand(state, "p1", [COVER, FILLER]);
    const fossil = handUidOf(withFossil, "p1", COVER);
    expect(refused(withFossil, { type: "setupPlaceActive", seat: "p1", uid: fossil }).code).toBe("NOT_A_BASIC_POKEMON");
    const placed = must(applyAction(withFossil, { type: "setupPlaceActive", seat: "p1", uid: handUidOf(withFossil, "p1", FILLER) }));
    expect(refused(placed, { type: "setupPlaceBench", seat: "p1", uid: fossil }).code).toBe("NOT_A_BASIC_POKEMON");
  });

  it("🛑 a deck search for a Basic Pokémon (Nest Ball) MISSES it — in the deck it is an Item", () => {
    const s = setHand(table(FILLER), "p1", [NEST_BALL]);
    const deckFossils = s.players.p1.deck.filter((u) => FOSSIL_IDS.has(s.cardIdByUid[u] ?? ""));
    expect(deckFossils.length).toBeGreaterThan(0);
    const parked = run(s, play(s, NEST_BALL)).state;
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "chooseCards") {
      throw new Error("expected a chooseCards park");
    }
    const candidates = parked.phase.prompt.candidates;
    // The search really offers Basics — and not one fossil among them.
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((u) => POOL[parked.cardIdByUid[u] ?? ""]?.stage === "Basic")).toBe(true);
    for (const fossil of deckFossils) expect(candidates).not.toContain(fossil);
  });

  it("🛑 the wire carries the in-play face: a Pokémon row with a 60-HP battle line", () => {
    const s = table(FILLER, [COVER]);
    const wire = redactGame(s, "p2");
    const row = wire.board.opponent.bench[0];
    expect(row).toMatchObject({ cardId: COVER, name: "Antique Cover Fossil", category: "Pokemon", trainerType: null });
    expect(row?.battle?.hp).toBe(60);
    expect(redactedGameSchema.safeParse(wire).success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — R-FO3: "At any time during your turn, you may discard this card from play."
// ─────────────────────────────────────────────────────────────────────────────
describe("D576 §3 — R-FO3: discard it from play in your own main phase", () => {
  it("🛑 a Benched fossil leaves with its WHOLE stack — no Knock Out, no Prize, the turn goes on", () => {
    const s = attach(table(FILLER, [FILLER, PLUME]), "p1", 1, COLORLESS);
    const body = bodyAt(s, "p1", 1);
    const { state, events } = run(s, discard("p1", { spot: "bench", index: 1 }));
    expect(state.players.p1.bench.map(top)).toEqual([top(bodyAt(s, "p1", 0))]);
    expect(state.players.p1.discard.slice(-2)).toEqual([...body.stack, ...body.energy]);
    expect(events).toEqual([
      { type: "POKEMON_RETURNED", seat: "p1", uid: top(body), actor: "p1", dest: "discard", uids: [...body.stack, ...body.energy] },
    ]);
    expect(all(events, "KNOCKED_OUT")).toEqual([]);
    expect(state.players.p2.prizes).toEqual(s.players.p2.prizes);
    expect(state.lastKoTurn).toEqual(s.lastKoTurn);
    expect(state.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
    expect(render(events, state)).toEqual(["p1: put Antique Plume Fossil and 1 attached card into Ember's discard pile"]);
  });

  it("🛑 an Active fossil leaves the spot EMPTY — a promotion is owed, then the SAME turn resumes", () => {
    const s = table(COVER, [FILLER, FILLER]);
    const { state, events } = run(s, discard("p1", { spot: "active" }));
    expect(state.players.p1.active).toBeNull();
    expect(state.phase).toMatchObject({ kind: "ko:promote", seat: "p1" });
    expect(all(events, "PROMOTION_REQUIRED")).toEqual([{ type: "PROMOTION_REQUIRED", seat: "p1" }]);
    const promoted = run(state, { type: "promote", seat: "p1", benchIndex: 0 }).state;
    expect(promoted.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
    expect(promoted.turn).toBe(s.turn);
  });

  it("🛑 an Active fossil with an EMPTY Bench: the board is empty — the §14.2 loss", () => {
    const s = table(ROOT);
    const { state } = run(s, discard("p1", { spot: "active" }));
    expect(state.phase).toEqual({ kind: "gameOver", outcome: { result: "win", winner: "p2", reason: "noPokemon" } });
  });

  it("🛑 one forced promotion when one body is left — no park", () => {
    const s = table(COVER, [FILLER]);
    const { state } = run(s, discard("p1", { spot: "active" }));
    expect(state.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
    expect(state.players.p1.active).not.toBeNull();
  });

  it("🛑 only a fossil-topped body: a non-fossil (and an empty spot, a bad index) is refused", () => {
    const s = table(FILLER, [COVER]);
    expect(refused(s, discard("p1", { spot: "active" })).code).toBe("NOT_DISCARDABLE");
    expect(refused(s, discard("p1", { spot: "bench", index: 3 })).code).toBe("NO_TARGET");
    expect(refused(s, discard("p1", { spot: "bench", index: 9 })).code).toBe("BAD_BENCH_INDEX");
    expect(refused(s, { type: "discardFromPlay", seat: "p1", target: null } as unknown as GameAction).code).toBe("BAD_TARGET");
  });

  it("🛑 \"during YOUR turn\": the opponent cannot, and nobody can mid-prompt or in the attack-again window", () => {
    const s = table(FILLER, [COVER], FILLER, [PLUME]);
    expect(refused(s, discard("p2", { spot: "bench", index: 0 })).code).toBe("WRONG_SEAT");
    expect(discardableTargets(s, "p2")).toEqual([]);
    // Mid-prompt: a parked Nest Ball (a Basic left in the deck to find).
    const parkedFrom = setHand(s, "p1", [NEST_BALL]);
    const parked = run(parkedFrom, play(parkedFrom, NEST_BALL)).state;
    expect(parked.phase.kind).toBe("effect:choose");
    expect(refused(parked, discard("p1", { spot: "bench", index: 0 })).code).toBe("BAD_PHASE");
    expect(discardableTargets(parked, "p1")).toEqual([]);
    // Festival Lead's attack-again window narrows the turn to an attack or a pass (R-FL1).
    const window: GameState = { ...s, allowances: { ...s.allowances, attackAgainUid: top(bodyAt(s, "p1", "active")) } };
    expect(refused(window, discard("p1", { spot: "bench", index: 0 })).code).toBe("BAD_PHASE");
    expect(discardableTargets(window, "p1")).toEqual([]);
    // …and the WIRE agrees (festivalLeadD570.test.ts §7's every-affordance rung, for the new
    // affordance): the same state's `turn:action.discardable` is LIVE with the window shut and
    // [] inside it.
    const shut = redactGame(s, "p1").phase;
    const open = redactGame(window, "p1").phase;
    if (shut.kind !== "turn:action" || open.kind !== "turn:action") throw new Error("expected turn:action");
    expect(shut.discardable).toEqual([
      { target: { spot: "bench", index: 0 }, label: "Antique Cover Fossil (Bench 1)" },
    ]);
    expect(open.discardable).toEqual([]);
  });

  it("🛑 the offer funnel lists EXACTLY the fossil-topped spots, Active first — and the wire carries them to the actor alone", () => {
    const s = table(ROOT, [FILLER, COVER, PLUME]);
    expect(discardableTargets(s, "p1")).toEqual([
      { spot: "active" },
      { spot: "bench", index: 1 },
      { spot: "bench", index: 2 },
    ]);
    const mine = redactGame(s, "p1").phase;
    if (mine.kind !== "turn:action") throw new Error("expected turn:action");
    expect(mine.discardable).toEqual([
      { target: { spot: "active" }, label: "Antique Root Fossil (Active)" },
      { target: { spot: "bench", index: 1 }, label: "Antique Cover Fossil (Bench 2)" },
      { target: { spot: "bench", index: 2 }, label: "Antique Plume Fossil (Bench 3)" },
    ]);
    const theirs = redactGame(s, "p2").phase;
    if (theirs.kind !== "turn:action") throw new Error("expected turn:action");
    expect(theirs.discardable).toEqual([]);
    const spectator = redactGame(s, "p1", true).phase;
    if (spectator.kind !== "turn:action") throw new Error("expected turn:action");
    expect(spectator.discardable).toEqual([]);
    // Every offered spot is accepted by the action — the funnel and the handler agree.
    for (const target of discardableTargets(s, "p1")) expect(applyAction(s, discard("p1", target)).ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — R-FO4: the two CARD RULES are not Abilities.
// ─────────────────────────────────────────────────────────────────────────────
describe("D576 §4 — R-FO4: \"can't be affected by any Special Conditions and can't retreat\" — card rules, never lifted", () => {
  for (const status of STATUSES) {
    it(`🛑 ${status}: the status is PREVENTED on the Active fossil`, () => {
      // PLUME, not COVER (Protective Cover refuses the attack's EFFECT before the status gate is asked)
      // and not ROOT (Primal Root would surcharge the Basic hitter's free attack).
      const s = p2Turn(table(PLUME, [FILLER], statusHitter(status)));
      const { state, events } = run(s, attack("p2", 0));
      const word = status.toLowerCase();
      expect(all(events, "STATUS_PREVENTED").map((e) => e.status)).toEqual([word]);
      expect(all(events, "STATUS_APPLIED")).toEqual([]);
      expect(bodyAt(state, "p1", "active").conditions).toEqual(bodyAt(s, "p1", "active").conditions);
    });
  }

  it("🛑 every status hitter really derives (the five sentences are read, not skipped)", () => {
    for (const status of STATUSES) {
      expect(deriveAttackEffect(`Your opponent's Active Pokémon is now ${status}.`), status).not.toBeNull();
    }
  });

  it("🛑 it can't retreat — refused with the card rule's own message, and the wire's `retreat.can` is false", () => {
    const s = attach(table(ROOT, [FILLER]), "p1", "active", COLORLESS);
    expect(retreatLocked(s, bodyAt(s, "p1", "active"))).toBe(true);
    expect(refused(s, { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 })).toEqual({
      code: "RETREAT_PREVENTED",
      message: "this card can't retreat (its own printed rule)",
    });
    const wire = redactGame(s, "p1").phase;
    if (wire.kind !== "turn:action") throw new Error("expected turn:action");
    expect(wire.retreat).toEqual({ cost: 0, can: false });
  });

  it("🛑 a Switch effect still moves it — the rule bars RETREAT, not every move", () => {
    const s = setHand(table(COVER, [FILLER]), "p1", [SWITCH]);
    const fossil = top(bodyAt(s, "p1", "active"));
    const { state } = run(s, play(s, SWITCH));
    expect(state.players.p1.bench.map(top)).toEqual([fossil]);
  });

  it("🛑 Team Rocket's Watchtower ({C} Pokémon have no Abilities) does NOT lift either rule", () => {
    const s = withWatchtower(p2Turn(table(ROOT, [FILLER], statusHitter("Paralyzed"))));
    const fossil = bodyAt(s, "p1", "active");
    // The lock IS on: the fossil's Ability is silenced (Primal Root — §5).
    expect(disabledAbilityUids(s).has(top(fossil))).toBe(true);
    expect(passivesOf(s, fossil).statusImmunities).toEqual(["asleep", "burned", "confused", "paralyzed", "poisoned"]);
    expect(all(run(s, attack("p2", 0)).events, "STATUS_PREVENTED")).toHaveLength(1);
    expect(retreatLocked(s, fossil)).toBe(true);
  });

  it("🛑 Klefki's Basic lock does NOT lift them either", () => {
    // Klefki locks every Basic in play, both sides, from its own Active Spot — the fossil's face is a Basic.
    const s = table(KLEFKI, [COVER]);
    const fossil = bodyAt(s, "p1", 0);
    expect(disabledAbilityUids(s).has(top(fossil))).toBe(true);
    expect(passivesOf(s, fossil).preventAttackEffects).toBe(false);
    expect(passivesOf(s, fossil).statusImmunities).toHaveLength(5);
    expect(retreatLocked(s, fossil)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — R-FO5: the three Abilities ARE Abilities.
// ─────────────────────────────────────────────────────────────────────────────
describe("D576 §5 — R-FO5: Protective Cover, Primal Root, Plume Protection", () => {
  it("🛑 Cover: an attack's EFFECT on it is refused, its DAMAGE lands", () => {
    const s = p2Turn(attach(table(COVER, [FILLER], STRIPPER), "p1", "active", COLORLESS));
    const { state } = run(s, attack("p2", 0));
    const fossil = bodyAt(state, "p1", "active");
    expect(fossil.energy).toHaveLength(1);
    expect(fossil.damage).toBe(10);
    // The control: the same attack strips a non-Cover body.
    const bare = p2Turn(attach(table(PLUME, [FILLER], STRIPPER), "p1", "active", COLORLESS));
    expect(bodyAt(run(bare, attack("p2", 0)).state, "p1", "active").energy).toHaveLength(0);
  });

  it("🛑 Cover: and a lock (Watchtower) lifts it — the Energy comes off", () => {
    const s = withWatchtower(p2Turn(attach(table(COVER, [FILLER], STRIPPER), "p1", "active", COLORLESS)));
    expect(bodyAt(run(s, attack("p2", 0)).state, "p1", "active").energy).toHaveLength(0);
  });

  it("🛑 Root, ACTIVE: the opponent's BASIC attacker pays {C} more — a free attack now costs one", () => {
    const s = p2Turn(table(ROOT, [FILLER], HITTER));
    expect(costOf(s)).toEqual(["Colorless"]);
    expect(refused(s, attack("p2", 0)).code).toBe("ATTACK_COST_UNMET");
    const paid = attach(s, "p2", "active", COLORLESS);
    // Paid, it lands: 60 damage Knocks the 60-HP Root Out.
    expect(all(run(paid, attack("p2", 0)).events, "KNOCKED_OUT").map((e) => e.uid)).toEqual([top(bodyAt(s, "p1", "active"))]);
  });

  it("🛑 Root: a STAGE 1 attacker is not surcharged (the printed \"Basic\"), and a BENCHED Root surcharges nothing", () => {
    const s = p2Turn(table(ROOT, [FILLER], STAGE1_HITTER));
    expect(costOf(s)).toEqual([]);
    const benched = p2Turn(table(FILLER, [ROOT], HITTER));
    expect(costOf(benched)).toEqual([]);
  });

  it("🛑 Root: Watchtower lifts it — while the status immunity and the retreat lock STAY", () => {
    const s = withWatchtower(p2Turn(table(ROOT, [FILLER], HITTER)));
    expect(costOf(s)).toEqual([]);
    const fossil = bodyAt(s, "p1", "active");
    expect(passivesOf(s, fossil).statusImmunities).toHaveLength(5);
    expect(retreatLocked(s, fossil)).toBe(true);
  });

  it("🛑 Plume, BENCHED: a spread's damage is prevented on it and lands everywhere else", () => {
    const s = p2Turn(table(FILLER, [PLUME, FILLER], SPREADER));
    const { state } = run(s, attack("p2", 0));
    expect(bodyAt(state, "p1", 0).damage).toBe(0);
    expect(bodyAt(state, "p1", 1).damage).toBe(30);
    expect(bodyAt(state, "p1", "active").damage).toBe(30);
  });

  it("🛑 Plume, BENCHED: a Bench snipe's damage is prevented on it too", () => {
    const s = p2Turn(table(FILLER, [PLUME], SNIPER));
    const { state } = run(s, attack("p2", 0));
    expect(bodyAt(state, "p1", 0).damage).toBe(0);
    expect(bodyAt(state, "p1", "active").damage).toBe(10);
  });

  it("🛑 Plume: \"attacks from your OPPONENT'S Pokémon\" — its owner's OWN-Bench spread lands on it (D425)", () => {
    // p2 attacks its OWN Bench, where p2's Plume sits: the attacker is not the fossil's opponent.
    const s = p2Turn(table(FILLER, [], SELF_SPREADER, [PLUME, FILLER]));
    const { state } = run(s, attack("p2", 0));
    expect(bodyAt(state, "p2", 0).damage).toBe(30);
    expect(bodyAt(state, "p2", 1).damage).toBe(30);
  });

  it("🛑 Plume: and its owner's OWN-Bench snipe lands on it too (D447)", () => {
    // ONE legal pick (the lone Benched Plume), so the choice is forced and resolves inside the attack.
    const s = p2Turn(table(FILLER, [], SELF_SNIPER, [PLUME]));
    const { state } = run(s, attack("p2", 0));
    expect(bodyAt(state, "p2", 0).damage).toBe(20);
    expect(bodyAt(state, "p1", "active").damage).toBe(10);
  });

  it("🛑 Plume, ACTIVE: no protection — the zone clause", () => {
    const s = p2Turn(table(PLUME, [FILLER], FIGHTER));
    expect(bodyAt(run(s, attack("p2", 0)).state, "p1", "active").damage).toBe(30);
  });

  it("🛑 Plume prevents DAMAGE only: an EFFECT (damage counters) still lands on the Benched fossil — Cover's does not", () => {
    const plume = p2Turn(table(FILLER, [PLUME], COUNTERS));
    const plumeHit = run(plume, attack("p2", 0)).state;
    const pick = (state: GameState, spot: Spot) =>
      run(state, {
        type: "resolveEffect",
        seat: "p2",
        choice: { kind: "pokemonMulti", refs: [{ seat: "p1", spot: spot === "active" ? { spot: "active" } : { spot: "bench", index: spot } }] },
      });
    expect(bodyAt(pick(plumeHit, 0).state, "p1", 0).damage).toBe(20);
    // Cover's EFFECTS half, on the same sentence, aimed at the ACTIVE Cover: refused. (The put-counter arm
    // aimed at a BENCHED body asks no effects refusal at all — a pre-existing gap Skeledirge "Unaware" shares,
    // recorded in decisions.md D576 as a carried finding, and deliberately NOT pinned here.)
    const cover = p2Turn(table(COVER, [FILLER], COUNTERS));
    const coverHit = run(cover, attack("p2", 0)).state;
    expect(bodyAt(pick(coverHit, "active").state, "p1", "active").damage).toBe(0);
    const plumeActive = p2Turn(table(PLUME, [FILLER], COUNTERS));
    expect(bodyAt(pick(run(plumeActive, attack("p2", 0)).state, "active").state, "p1", "active").damage).toBe(20);
  });

  it("🛑 Plume: Watchtower lifts it — the spread lands — while the status immunity and the retreat lock STAY", () => {
    const s = withWatchtower(p2Turn(table(FILLER, [PLUME], SPREADER)));
    const fossil = bodyAt(s, "p1", 0);
    expect(passivesOf(s, fossil).preventDamageWhileBenched).toBe(false);
    expect(bodyAt(run(s, attack("p2", 0)).state, "p1", 0).damage).toBe(30);
    expect(passivesOf(s, fossil).statusImmunities).toHaveLength(5);
    expect(retreatLocked(s, fossil)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — R-FO6: evolution onto a fossil.
// ─────────────────────────────────────────────────────────────────────────────
describe("D576 §6 — R-FO6 (⚠️ UNRULED → ruled): Lileep evolves from \"Antique Root Fossil\", and the fossil stops", () => {
  it("🛑 not on the turn it was played (§10), and on the next turn it does — by NAME", () => {
    // Two turns on, so §4's first-turn evolve ban (p1's turn 2 is its first) is not what refuses it.
    const later0 = table(FILLER);
    const s = setHand({ ...later0, turn: later0.turn + 2 }, "p1", [ROOT, LILEEP]);
    const benched = run(s, play(s, ROOT)).state;
    const evolve: GameAction = { type: "evolve", seat: "p1", uid: handUidOf(benched, "p1", LILEEP), target: { spot: "bench", index: 0 } };
    expect(refused(benched, evolve).code).toBe("EVOLVE_TOO_SOON");
    const later = { ...benched, turn: benched.turn + 2 };
    const evolved = run(later, evolve).state;
    expect(cardOfUid(evolved, top(bodyAt(evolved, "p1", 0)))?.name).toBe("Lileep");
  });

  it("🛑 once evolved, the fossil's rules and Ability STOP: Lileep can retreat, is not discardable, takes statuses", () => {
    let s = table(ROOT, [FILLER], HITTER);
    s = setHand(s, "p1", [LILEEP]);
    s = { ...s, turn: s.turn + 2 };
    const evolved = run(s, { type: "evolve", seat: "p1", uid: handUidOf(s, "p1", LILEEP), target: { spot: "active" } }).state;
    const lileep = bodyAt(evolved, "p1", "active");
    expect(lileep.stack).toHaveLength(2);
    expect(isFossilTop(evolved, lileep)).toBe(false);
    expect(retreatLocked(evolved, lileep)).toBe(false);
    expect(discardableTargets(evolved, "p1")).toEqual([]);
    expect(passivesOf(evolved, lileep).statusImmunities).toEqual([]);
    // The fossil under it is still a card of an in-play stack: its face is still the Pokémon one.
    expect(cardOfUid(evolved, lileep.stack[0] as string)?.category).toBe("Pokemon");
    // Primal Root is gone with it: the opponent's Basic attacks for free again.
    const theirs = p2Turn(evolved);
    expect(costOf(theirs)).toEqual([]);
  });

  it("🛑 Rare Candy puts Cradily straight onto the fossil (the chain bridges through Lileep)", () => {
    let s = table(FILLER, [ROOT]);
    s = setHand(s, "p1", [RARE_CANDY, CRADILY, LILEEP]);
    s = { ...s, turn: s.turn + 2 };
    const candy: GameAction = {
      type: "rareCandy",
      seat: "p1",
      uid: handUidOf(s, "p1", RARE_CANDY),
      target: { spot: "bench", index: 0 },
      evolutionUid: handUidOf(s, "p1", CRADILY),
    };
    const { state } = run(s, candy);
    expect(cardOfUid(state, top(bodyAt(state, "p1", 0)))?.name).toBe("Cradily");
    expect(isFossilTop(state, bodyAt(state, "p1", 0))).toBe(false);
  });

  it("…and a Knock Out of the evolved body discards the fossil with it, as an Item", () => {
    let s = table(ROOT, [FILLER], HITTER);
    s = setHand(s, "p1", [LILEEP]);
    s = { ...s, turn: s.turn + 2 };
    const evolved = run(s, { type: "evolve", seat: "p1", uid: handUidOf(s, "p1", LILEEP), target: { spot: "active" } }).state;
    const fossilUid = bodyAt(evolved, "p1", "active").stack[0] as string;
    const hurt = withBody(p2Turn(evolved), "p1", "active", (p) => ({ ...p, damage: 40 }));
    const { state } = run(hurt, attack("p2", 0));
    expect(state.players.p1.discard).toContain(fossilUid);
    expect(cardOfUid(state, fossilUid)?.category).toBe("Trainer");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — `MATCH_RECORD_VERSION` 38 → 39: the persisted position, and its rollback reading.
// ─────────────────────────────────────────────────────────────────────────────
describe("D576 §7 — the persisted position: a fossil's Trainer uid in `InPlayPokemon.stack`", () => {
  it("🛑 the bytes round-trip through JSON and still read as the Pokémon face", () => {
    const s = table(FILLER, [PLUME]);
    const revived = JSON.parse(JSON.stringify(s)) as GameState;
    const body = bodyAt(revived, "p1", 0);
    expect(cardOfUid(revived, top(body))?.hp).toBe(60);
    expect(isFossilTop(revived, body)).toBe(true);
  });

  it("🛑 a 0.459 ROLLBACK reads the SAME bytes as a Trainer with no HP — the body can NEVER be Knocked Out (NOT inert)", () => {
    // 0.459's `cardOfUid` was the pool lookup: the catalog row, an Item with `hp: null`. `hpOf` reads that as
    // a DATA GAP ("the KO check skips rather than insta-KOs"), so under 0.459 a v39 fossil body is unkillable.
    // (🆕 D581: the row as the catalog held it BEFORE D581's ingest widening — today's row carries `hp: 60`.
    // So the title holds only against a catalog not re-ingested since D581: on a re-ingested one, 0.459's
    // category-blind `hpOf` reads 60 off the Item and the rolled-back body IS Knocked Out at 60 — apps/api
    // match.ts' D576 entry says so.)
    const row = { ...(POOL[COVER] as Card), hp: null, abilities: null };
    expect(hpOf(row)).toBeNull();
    // DRIVEN through THIS build's real KO check on the 0.459 reading of the bytes: an ordinary Item uid on top
    // of a stack is exactly what 0.459 sees in a v39 fossil body — 900 damage, not lethal, never swept.
    const s = table(FILLER, [PLUME]);
    const fossil = bodyAt(s, "p1", 0);
    const switchUid = s.players.p1.deck.find((u) => s.cardIdByUid[u] === SWITCH) as string;
    const asOld: InPlayPokemon = { ...fossil, stack: [switchUid], damage: 900 };
    expect(isLethallyDamaged(s, asOld)).toBe(false);
    // …while THIS build's face of the same body is lethal at 60.
    expect(isLethallyDamaged(s, { ...fossil, damage: 60 })).toBe(true);
    expect(isLethallyDamaged(s, { ...fossil, damage: 50 })).toBe(false);
  });

  it("the engine is 0.543.0", () => {
    expect(engineVersion).toBe("0.543.0");
  });
});
