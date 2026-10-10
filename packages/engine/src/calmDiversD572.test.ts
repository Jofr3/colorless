import type { Card } from "@luminous/schema";
import { redactedEffectPromptSchema } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { abilityUsedKey, programPlayable } from "./cardplay";
import { disabledAbilityUids, inPlayToHandBlocked, koEnergyRescueUids } from "./continuous";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { conditionHolds, conditionNote, runProgram } from "./interpreter";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { redactGame } from "./redact";
import { programFor } from "./registry";
import { FIXTURE_POOL, battler, benchFromDeck, clearBench, deckOf, setActiveFromDeck, trainerCard, typedEnergy } from "./testFixtures";
import type { InPlayPokemon } from "./types";

// ── 🆕🆕🆕 D572 — "CALM DIVERS": SIX PRINTINGS, FOUR TEXTS ──
//
//   Munkidori  sv06-095 / sv06.5-072 / sv08.5-044  "Adrena-Brain"        — with any {D} attached: move up to 3
//                                                                          damage counters own → opponent
//   Milotic    sv06-050                            "Mentally Calm"       — the opponent's in-play cards can't
//                                                                          be put into the opponent's hand
//   Huntail    sv10-055                            "Diver's Catch"       — a {W} body KO'd by an opposing attack
//                                                                          keeps its Basic {W} Energy in hand
//   Klinklang  sv07-101                            "Emergency Rotation"  — from the HAND to the Bench, once per
//                                                                          turn, vs an opposing Stage 2
//
// Every card is driven on its REAL id on a LOCAL `cardPool` (D275) in the suite's OWN deck (D270). Texts,
// stats and legality off tcgdex (the audit's card JSON), 2026-10-03. Readings R-DC2, R-DC3a/b, R-MC1..3,
// R-KR1..2 (all ⚠️ UNRULED) and the D27 auto-fire: docs/decisions.md D572.

const MUNKIDORI = ["sv06-095", "sv06.5-072", "sv08.5-044"] as const;
const MILOTIC = "sv06-050";
const HUNTAIL = "sv10-055";
const KLINKLANG = "sv07-101";
const GEAR_COATING = ["sv10.5b-063", "sv10.5b-141"] as const;
const MUNKIDORI_EX = "sv06.5-037";
const PECHARUNT_EX = "sv06.5-039";
const AMULET = "sv08-162";
const FLUTTER_MANE = "sv05-078";
const SHIFTRY = "sv05-005";
const SWOOBAT = "sv10.5w-037";
const COMFEY = "sv09-068";
const ESPATHRA = "sv08-095";
const ZARUDE = "sv08-011";
const SCOOP_UP = "sv06-162";
const CHILL_TOY = "sv08-166";
const ARBOK = "sv10-113";
const GASTRODON = "sv08-107";
const STAGE2 = "d572t-stage2";
const STAGE1 = "d572t-stage1";
const HITTER = "d572t-hitter";
const SPREADER = "d572t-spreader";
const RECOILER = "d572t-recoiler";
const WATER_MON = "d572t-water";
const FILLER = "d572t-filler";
const DARK = "d572t-dark";
const GRASS = "d572t-grass";
const PSYCHIC = "d572t-psychic";
const WATER = "fix-water-energy";
const COLORLESS = "fix-energy";
const SPECIAL = "fix-special";

const ADRENA_BRAIN =
  "Once during your turn, if this Pokémon has any {D} Energy attached, you may move up to 3 damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon.";
const MENTALLY_CALM = "Your opponent's Pokémon in play and all attached cards can't be put into your opponent's hand.";
const DIVERS_CATCH =
  "When 1 of your {W} Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, you may put all Basic {W} Energy attached to that Pokémon into your hand instead of the discard pile.";
const EMERGENCY_ROTATION =
  "Once during your turn, if this Pokémon is in your hand and your opponent has any Stage 2 Pokémon in play, you may put this Pokémon onto your Bench.";

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(
    MUNKIDORI.map((id) => [
      id,
      battler(id, {
        name: "Munkidori",
        types: ["Psychic"],
        hp: 110,
        retreat: 1,
        weaknesses: [{ type: "Darkness", value: "×2" }],
        resistances: [{ type: "Fighting", value: "-30" }],
        abilities: [{ type: "Ability", name: "Adrena-Brain", effect: ADRENA_BRAIN }],
        attacks: [
          { cost: ["Psychic", "Colorless"], name: "Mind Bend", damage: 60, effect: "Your opponent's Active Pokémon is now Confused." },
        ],
      }),
    ]),
  ),
  [MILOTIC]: battler(MILOTIC, {
    name: "Milotic",
    stage: "Stage1",
    evolveFrom: "Feebas",
    types: ["Water"],
    hp: 120,
    retreat: 1,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    abilities: [{ type: "Ability", name: "Mentally Calm", effect: MENTALLY_CALM }],
    attacks: [{ cost: ["Water", "Colorless", "Colorless"], name: "Hydro Splash", damage: 100 }],
  }),
  [HUNTAIL]: battler(HUNTAIL, {
    name: "Huntail",
    stage: "Stage1",
    evolveFrom: "Clamperl",
    types: ["Water"],
    hp: 110,
    retreat: 1,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    abilities: [{ type: "Ability", name: "Diver's Catch", effect: DIVERS_CATCH }],
    attacks: [{ cost: ["Water", "Colorless", "Colorless"], name: "Wave Splash", damage: 80 }],
  }),
  [KLINKLANG]: battler(KLINKLANG, {
    name: "Klinklang",
    stage: "Stage2",
    evolveFrom: "Klang",
    types: ["Metal"],
    hp: 140,
    retreat: 3,
    weaknesses: [{ type: "Fire", value: "×2" }],
    resistances: [{ type: "Grass", value: "-30" }],
    abilities: [{ type: "Ability", name: "Emergency Rotation", effect: EMERGENCY_ROTATION }],
    attacks: [{ cost: ["Colorless", "Colorless"], name: "Hyper Ray", damage: 130, effect: "Discard all Energy from this Pokémon." }],
  }),
  [MUNKIDORI_EX]: battler(MUNKIDORI_EX, {
    name: "Munkidori ex",
    types: ["Darkness"],
    hp: 210,
    retreat: 1,
    abilities: [
      {
        type: "Ability",
        name: "Oh No You Don't",
        effect:
          "If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, and if you have any Pecharunt ex in play, your opponent takes 1 fewer Prize card.",
      },
    ],
    attacks: [
      {
        cost: ["Darkness", "Darkness", "Colorless"],
        name: "Dirty Headbutt",
        damage: 190,
        effect: "During your next turn, this Pokémon can't use Dirty Headbutt.",
      },
    ],
  }),
  [PECHARUNT_EX]: battler(PECHARUNT_EX, { name: "Pecharunt ex", types: ["Darkness"], hp: 190, retreat: 1 }),
  [AMULET]: {
    ...trainerCard(
      AMULET,
      "Tool",
      "If the Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.",
    ),
    name: "Amulet of Hope",
  },
  [FLUTTER_MANE]: battler(FLUTTER_MANE, {
    name: "Flutter Mane",
    types: ["Psychic"],
    hp: 90,
    retreat: 1,
    abilities: [
      {
        type: "Ability",
        name: "Midnight Fluttering",
        effect:
          "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities, except for Midnight Fluttering.",
      },
    ],
  }),
  // 🆕🆕🆕 the R-KR2 witness (a review-round finding): Sticky Bind is the one live lock that reaches
  // the very zone and stage an Emergency Rotation lands in — a BENCHED Stage 2.
  [GASTRODON]: battler(GASTRODON, {
    name: "Gastrodon",
    stage: "Stage1",
    evolveFrom: "Shellos",
    types: ["Fighting"],
    hp: 130,
    retreat: 3,
    weaknesses: [{ type: "Grass", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Sticky Bind",
        effect:
          "As long as this Pokémon is on your Bench, Benched Stage 2 Pokémon (both yours and your opponent's) have no Abilities.",
      },
    ],
    attacks: [{ cost: ["Fighting", "Colorless", "Colorless"], name: "Mud Shot", damage: 80 }],
  }),
  [SHIFTRY]: battler(SHIFTRY, {
    name: "Shiftry",
    stage: "Stage2",
    evolveFrom: "Nuzleaf",
    types: ["Grass"],
    hp: 150,
    retreat: 2,
    attacks: [
      {
        cost: ["Grass"],
        name: "Expelling Tornado",
        effect:
          "Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck.",
      },
      { cost: ["Colorless", "Colorless"], name: "Energy Loop", damage: 140, effect: "Put an Energy attached to this Pokémon into your hand." },
    ],
  }),
  [SWOOBAT]: battler(SWOOBAT, {
    name: "Swoobat",
    stage: "Stage1",
    evolveFrom: "Woobat",
    types: ["Psychic"],
    hp: 90,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Happy Return", effect: "Put 1 of your Benched Pokémon and all attached cards into your hand." },
      { cost: ["Colorless", "Colorless"], name: "Gust", damage: 50 },
    ],
  }),
  [COMFEY]: battler(COMFEY, {
    name: "Lillie's Comfey",
    types: ["Psychic"],
    hp: 70,
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Inviting Flowers",
        effect: "You may search your deck for any number of Basic Lillie's Pokémon and put them onto your Bench. Then, shuffle your deck.",
      },
      { cost: ["Psychic"], name: "Fade Out", damage: 30, effect: "Put this Pokémon and all attached cards into your hand." },
    ],
  }),
  [ESPATHRA]: battler(ESPATHRA, {
    name: "Espathra",
    stage: "Stage1",
    evolveFrom: "Flittle",
    types: ["Psychic"],
    hp: 120,
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Mystical Eyes",
        effect:
          "Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand.",
      },
      { cost: ["Psychic", "Colorless"], name: "Spiral Drain", damage: 60, effect: "Heal 30 damage from this Pokémon." },
    ],
  }),
  [ZARUDE]: battler(ZARUDE, {
    name: "Zarude",
    types: ["Grass"],
    hp: 120,
    retreat: 1,
    attacks: [
      { cost: ["Grass"], name: "Leaf Drain", damage: 20, effect: "Heal 20 damage from this Pokémon." },
      {
        cost: ["Grass", "Grass", "Colorless"],
        name: "Jungle Whip",
        damage: "80+",
        effect: "You may put all Energy attached to this Pokémon into your hand to have this attack do 80 more damage.",
      },
    ],
  }),
  [SCOOP_UP]: {
    ...trainerCard(SCOOP_UP, "Item", "Put 1 of your Pokémon and all attached cards into your hand."),
    name: "Scoop Up Cyclone",
  },
  [CHILL_TOY]: {
    ...trainerCard(
      CHILL_TOY,
      "Item",
      "You can use this card only if you go second, and only during your first turn.\n\nPut an Energy attached to 1 of your opponent's Pokémon into their hand.",
    ),
    name: "Chill Teaser Toy",
  },
  [ARBOK]: battler(ARBOK, {
    name: "Team Rocket's Arbok",
    stage: "Stage1",
    evolveFrom: "Team Rocket's Ekans",
    types: ["Darkness"],
    hp: 130,
    retreat: 2,
    abilities: [
      {
        type: "Ability",
        name: "Potent Glare",
        effect:
          "As long as this Pokémon is in the Active Spot, your opponent can't play any Pokémon that has an Ability from their hand, except for Team Rocket's Pokémon.",
      },
    ],
  }),
  [STAGE2]: battler(STAGE2, { name: "D572 Stage Two", stage: "Stage2", evolveFrom: "D572 Stage One", hp: 900, types: ["Colorless"] }),
  [STAGE1]: battler(STAGE1, { name: "D572 Stage One", stage: "Stage1", evolveFrom: "D572 Filler", hp: 900, types: ["Colorless"] }),
  [HITTER]: battler(HITTER, {
    name: "D572 Hitter",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Crush", damage: 300 }],
  }),
  [SPREADER]: battler(SPREADER, {
    name: "D572 Spreader",
    hp: 900,
    types: ["Colorless"],
    attacks: [
      {
        cost: [],
        name: "Spinning Tail",
        effect:
          "This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
    ],
  }),
  [RECOILER]: battler(RECOILER, {
    name: "D572 Recoiler",
    hp: 60,
    types: ["Water"],
    attacks: [{ cost: [], name: "Reckless Dive", damage: 10, effect: "This Pokémon also does 60 damage to itself." }],
  }),
  [WATER_MON]: battler(WATER_MON, { name: "D572 Water", hp: 100, types: ["Water"], retreat: 1 }),
  [FILLER]: battler(FILLER, {
    name: "D572 Filler",
    hp: 900,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  [DARK]: typedEnergy(DARK, "Darkness"),
  [GRASS]: typedEnergy(GRASS, "Grass"),
  [PSYCHIC]: typedEnergy(PSYCHIC, "Psychic"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [MUNKIDORI[0]]: 1,
  [MUNKIDORI[1]]: 1,
  [MUNKIDORI[2]]: 1,
  [MILOTIC]: 1,
  [HUNTAIL]: 2,
  [KLINKLANG]: 2,
  [MUNKIDORI_EX]: 1,
  [PECHARUNT_EX]: 1,
  [AMULET]: 1,
  [FLUTTER_MANE]: 1,
  [SHIFTRY]: 1,
  [SWOOBAT]: 1,
  [COMFEY]: 1,
  [ESPATHRA]: 1,
  [ZARUDE]: 1,
  [SCOOP_UP]: 1,
  [CHILL_TOY]: 1,
  [ARBOK]: 1,
  [STAGE2]: 1,
  [STAGE1]: 1,
  [HITTER]: 1,
  [SPREADER]: 1,
  [RECOILER]: 2,
  [WATER_MON]: 2,
  [FILLER]: 14,
  // 🆕🆕🆕 the R-KR2 witness, in the 15th Filler's SLOT (directly after the Fillers, so the seeded
  // shuffle of the same 60 positions leaves every other card where it was).
  [GASTRODON]: 1,
  [DARK]: 3,
  [GRASS]: 3,
  [PSYCHIC]: 2,
  [WATER]: 4,
  [COLORLESS]: 3,
  [SPECIAL]: 2,
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

/** TEST SURGERY — every uid of `seat`'s hand and prizes back into the deck, the hand then EXACTLY `ids`. */
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
  seed = 5721,
): GameState {
  let state = setHand(setHand(opened(seed), "p1", []), "p2", []);
  state = setActiveFromDeck(ensureInDeck(state, "p1", active), "p1", active);
  state = setActiveFromDeck(ensureInDeck(state, "p2", oppActive), "p2", oppActive);
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of bench) state = benchFromDeck(ensureInDeck(state, "p1", id), "p1", id);
  for (const id of oppBench) state = benchFromDeck(ensureInDeck(state, "p2", id), "p2", id);
  return state;
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

const damaged = (state: GameState, seat: Seat, spot: Spot, damage: number) =>
  withBody(state, seat, spot, (p) => ({ ...p, damage }));

/** TEST SURGERY — attach `n` copies of deck card `id` to the body (Energy or Tool by kind). */
function attach(state: GameState, seat: Seat, spot: Spot, id: string, n = 1, as: "energy" | "tools" = "energy"): GameState {
  let next = state;
  for (let i = 0; i < n; i++) {
    next = ensureInDeck(next, seat, id);
    const side = next.players[seat];
    const uid = side.deck.find((u) => next.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`no ${id} in the deck`);
    next = { ...next, players: { ...next.players, [seat]: { ...side, deck: side.deck.filter((u) => u !== uid) } } };
    next = withBody(next, seat, spot, (p) => ({ ...p, [as]: [...p[as], uid] }));
  }
  return next;
}

/** TEST SURGERY — put one deck copy of `id` UNDER the body's top card (an evolution stack). */
function underneath(state: GameState, seat: Seat, spot: Spot, id: string): GameState {
  const next = ensureInDeck(state, seat, id);
  const side = next.players[seat];
  const uid = side.deck.find((u) => next.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`no ${id}`);
  const moved = { ...next, players: { ...next.players, [seat]: { ...side, deck: side.deck.filter((u) => u !== uid) } } };
  return withBody(moved, seat, spot, (p) => ({ ...p, stack: [uid, ...p.stack] }));
}

function all<T extends GameEvent["type"]>(events: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const top = (p: InPlayPokemon): string => p.stack[p.stack.length - 1] as string;
const idOf = (state: GameState, uid: string): string => state.cardIdByUid[uid] ?? "";

function render(events: GameEvent[], state: GameState): string[] {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn" ? [] : [`${entry.who}: ${entry.segments.map((s) => s.text).join("")}`],
  );
}

const use = (name: string, target: { spot: "active" } | { spot: "bench"; index: number }): GameAction =>
  ({ type: "useAbility", seat: "p1", target, abilityName: name }) as GameAction;
const ACTIVE = { spot: "active" as const };
type Ref = { seat: Seat; spot: { spot: "active" } | { spot: "bench"; index: number } };
const pick = (ref: Ref, take?: number): GameAction =>
  ({
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemon", ref, ...(take === undefined ? {} : { take }) },
  }) as GameAction;
const decline: GameAction = { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon" } } as GameAction;
const attack = (index: number): GameAction => ({ type: "attack", seat: "p1", index }) as GameAction;

function prompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return state.phase.prompt;
}

/** p1's Munkidori (`MUNKIDORI[i]`) Active with one {D} and `own` damage, p2 `oppActive` + bench. */
function brainBoard(own = 30, oppActive: string = FILLER, oppBench: readonly string[] = [], i = 0): GameState {
  return damaged(attach(table(MUNKIDORI[i] ?? MUNKIDORI[0], [], oppActive, oppBench), "p1", "active", DARK), "p1", "active", own);
}

/** The owed Prize count for p1 after a Knock Out: the parked pick, the PRIZES_OWED row, or the row delta. */
function owed(before: GameState, after: GameState, events: GameEvent[]): number {
  if (after.phase.kind === "ko:takePrizes") return after.phase.count;
  const row = all(events, "PRIZES_OWED")[0];
  if (row !== undefined) return row.count;
  return before.players.p1.prizes.length - after.players.p1.prizes.length;
}

// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — the prints and the registry rows", () => {
  it("Adrena-Brain: once per turn, the NEW {D} body gate, the NEW op at the printed ceiling — one object, three keys", () => {
    const first = programFor(MUNKIDORI[0]);
    expect(first).toEqual({
      abilities: [
        {
          name: "Adrena-Brain",
          oncePerTurn: true,
          activeOnly: false,
          requiresEnergyType: "Darkness",
          program: [{ op: "moveCountersToOpponentChosen", upTo: 3 }],
        },
      ],
    });
    expect(programFor(MUNKIDORI[1])).toBe(first);
    expect(programFor(MUNKIDORI[2])).toBe(first);
  });

  it("Mentally Calm, Diver's Catch, Emergency Rotation", () => {
    expect(programFor(MILOTIC)).toEqual({ passive: { opponentInPlayToHandBlocked: true } });
    expect(programFor(HUNTAIL)).toEqual({ passive: { koBasicEnergyToHand: "Water" } });
    expect(programFor(KLINKLANG)).toEqual({
      benchFromHand: { name: "Emergency Rotation", playableIf: { kind: "opponentStage2PokemonInPlay" } },
    });
  });

  it("no row authors an `attack` key (Mind Bend, Hydro Splash, Wave Splash, Hyper Ray derive), and the Gear Coating Klinklangs are untouched", () => {
    for (const id of [...MUNKIDORI, MILOTIC, HUNTAIL, KLINKLANG]) {
      expect(Object.keys(programFor(id) ?? {}), id).not.toContain("attack");
    }
    for (const id of GEAR_COATING) expect(programFor(id)?.benchFromHand, id).toBeUndefined();
  });

  it("the two NEW BoardCondition members read their printed clauses back", () => {
    expect(conditionNote({ kind: "opponentStage2PokemonInPlay" })).toBe("your opponent has any Stage 2 Pokémon in play");
    expect(conditionNote({ kind: "yourInPlayToHandAllowed" })).toBe(
      "your Pokémon in play and attached cards can be put into your hand",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§2 — Munkidori \"Adrena-Brain\" (up to 3 counters, own → opponent)", () => {
  it("🛑 the {D} BODY GATE: no {D} attached → refused with the printed clause, and both HUD mirrors grey the row with it", () => {
    const bare = damaged(table(MUNKIDORI[0]), "p1", "active", 30);
    const no = refused(bare, use("Adrena-Brain", ACTIVE));
    expect(no.code).toBe("ABILITY_CONDITION_NOT_MET");
    expect(no.message).toBe("Adrena-Brain can only be used if this Pokémon has any Darkness Energy attached (§9)");
    const phase = redactGame(bare, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    const row = phase.abilities.find((a) => a.abilityName === "Adrena-Brain");
    expect(row?.disabled).toBe(true);
    expect(row?.reason).toBe("Only if this Pokémon has any Darkness Energy attached");
    // A {P} Energy is not {D}: the gate reads PROVISION, not "any Energy".
    const psychic = attach(bare, "p1", "active", PSYCHIC);
    expect(refused(psychic, use("Adrena-Brain", ACTIVE)).code).toBe("ABILITY_CONDITION_NOT_MET");
    // …and one {D} lights it.
    const lit = redactGame(brainBoard(), "p1").phase;
    if (lit.kind !== "turn:action") throw new Error("expected turn:action");
    expect(lit.abilities.find((a) => a.abilityName === "Adrena-Brain")?.disabled).toBe(false);
  });

  it("🛑 Q1 FORCED (one damaged own body), Q2 ALWAYS PARKED even over a LONE opponent body — `upTo: 3`, `takeVerb: \"move\"`", () => {
    const { state } = run(brainBoard(), use("Adrena-Brain", ACTIVE));
    const p = prompt(state);
    expect(p).toEqual({
      kind: "choosePokemon",
      candidates: [{ seat: "p2", spot: { spot: "active" } }],
      upTo: 3,
      takeVerb: "move",
      note: "Move up to 3 damage counters onto which of your opponent's Pokémon?",
    });
    // The wire carries the verb (D135 conditional spread) — and the ceiling unclamped.
    const wire = redactGame(state, "p1").phase;
    if (wire.kind !== "effect:choose" || !("prompt" in wire)) throw new Error("expected the answerer's prompt");
    expect(wire.prompt).toMatchObject({ kind: "choosePokemon", upTo: 3, takeVerb: "move" });
    // …and the WIRE SCHEMA keeps it (zod strips an undeclared key, so a schema without the field
    // would silently turn every Adrena-Brain row back into "attach").
    expect(redactedEffectPromptSchema.parse(wire.prompt)).toMatchObject({ takeVerb: "move" });
  });

  it("🛑 an answer's `take` is the count: 2 of 3 moves 20", () => {
    const start = brainBoard(50);
    const parked = run(start, use("Adrena-Brain", ACTIVE)).state;
    const { state, events } = run(parked, pick({ seat: "p2", spot: { spot: "active" } }, 2));
    expect(state.phase.kind).toBe("turn:action");
    expect(bodyAt(state, "p1", "active").damage).toBe(30);
    expect(bodyAt(state, "p2", "active").damage).toBe(20);
    expect(all(events, "COUNTERS_PLACED")).toEqual([
      { type: "COUNTERS_PLACED", seat: "p2", uid: top(bodyAt(start, "p2", "active")), amount: 20, source: "moved" },
    ]);
  });

  it("🛑 an ABSENT `take` is the printed 3 — and it is CLAMPED to what the source carries (2 counters moves 2)", () => {
    const full = run(run(brainBoard(50), use("Adrena-Brain", ACTIVE)).state, pick({ seat: "p2", spot: { spot: "active" } })).state;
    expect(bodyAt(full, "p1", "active").damage).toBe(20);
    expect(bodyAt(full, "p2", "active").damage).toBe(30);
    const short = run(run(brainBoard(20), use("Adrena-Brain", ACTIVE)).state, pick({ seat: "p2", spot: { spot: "active" } }, 3)).state;
    expect(bodyAt(short, "p1", "active").damage).toBe(0);
    expect(bodyAt(short, "p2", "active").damage).toBe(20);
  });

  it("🛑 the DECLINE (no ref) moves none — and the once-per-turn use is still SPENT", () => {
    const start = brainBoard(30);
    const parked = run(start, use("Adrena-Brain", ACTIVE)).state;
    const { state, events } = run(parked, decline);
    expect(state.phase.kind).toBe("turn:action");
    expect(bodyAt(state, "p1", "active").damage).toBe(30);
    expect(bodyAt(state, "p2", "active").damage).toBe(0);
    expect(all(events, "COUNTERS_PLACED")).toEqual([]);
    expect(state.allowances.abilitiesUsed).toContain(
      abilityUsedKey(top(bodyAt(start, "p1", "active")), { name: "Adrena-Brain", oncePerTurn: true }),
    );
    expect(refused(state, use("Adrena-Brain", ACTIVE)).code).toBe("ABILITY_ALREADY_USED");
  });

  it("🛑 Q1 PARKS over two damaged own bodies (the Munkidori and a benched one); its answer buys Q2 over the opponent's WHOLE board", () => {
    let start = damaged(attach(table(MUNKIDORI[1], [FILLER], FILLER, [WATER_MON]), "p1", "active", DARK), "p1", 0, 40);
    start = damaged(start, "p1", "active", 10);
    const first = run(start, use("Adrena-Brain", ACTIVE)).state;
    const q1 = prompt(first);
    if (q1.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(q1.upTo).toBeUndefined();
    expect(q1.takeVerb).toBeUndefined();
    expect(q1.candidates).toEqual([
      { seat: "p1", spot: { spot: "active" } },
      { seat: "p1", spot: { spot: "bench", index: 0 } },
    ]);
    const second = run(first, pick({ seat: "p1", spot: { spot: "bench", index: 0 } })).state;
    const q2 = prompt(second);
    if (q2.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(q2.candidates).toEqual([
      { seat: "p2", spot: { spot: "active" } },
      { seat: "p2", spot: { spot: "bench", index: 0 } },
    ]);
    const done = run(second, pick({ seat: "p2", spot: { spot: "bench", index: 0 } })).state;
    expect(bodyAt(done, "p1", 0).damage).toBe(10);
    expect(bodyAt(done, "p1", "active").damage).toBe(10);
    expect(bodyAt(done, "p2", 0).damage).toBe(30);
  });

  it("refused when NO own body carries damage (could only whiff — D222's grey-out agrees)", () => {
    const clean = attach(table(MUNKIDORI[2]), "p1", "active", DARK);
    expect(refused(clean, use("Adrena-Brain", ACTIVE)).code).toBe("NO_LEGAL_TARGET");
    expect(programPlayable(clean, [{ op: "moveCountersToOpponentChosen", upTo: 3 }], "p1")).toBe(false);
  });

  it("🛑 a LETHAL move is swept mid-turn and is NOT \"by an attack\": the Prize is p1's, but Oh No You Don't does not reduce it", () => {
    let start = brainBoard(30, MUNKIDORI_EX, [PECHARUNT_EX]);
    start = damaged(start, "p2", "active", 190);
    const victim = top(bodyAt(start, "p2", "active"));
    const parked = run(start, use("Adrena-Brain", ACTIVE)).state;
    const { state, events } = run(parked, pick({ seat: "p2", spot: { spot: "active" } }));
    expect(all(events, "KNOCKED_OUT").map((e) => e.uid)).toEqual([victim]);
    expect(state.lastKoMarks.p2.find((m) => m.uid === victim)?.byAttack).toBe(false);
    // Munkidori ex is a Rule Box body: 2 Prizes, NOT reduced to 1 — the reduction needs an attack.
    expect(owed(start, state, events)).toBe(2);
  });

  it("🛑 Amulet of Hope and Huntail do NOT fire on an Adrena-Brain Knock Out", () => {
    let start = brainBoard(30, WATER_MON, [HUNTAIL]);
    start = attach(attach(start, "p2", "active", WATER, 2), "p2", "active", AMULET, 1, "tools");
    start = damaged(start, "p2", "active", 70);
    const water = bodyAt(start, "p2", "active").energy;
    const parked = run(start, use("Adrena-Brain", ACTIVE)).state;
    const { state, events } = run(parked, pick({ seat: "p2", spot: { spot: "active" } }));
    const ko = all(events, "KNOCKED_OUT")[0];
    expect(ko?.toHand).toBeUndefined();
    for (const uid of water) expect(state.players.p2.discard).toContain(uid);
    expect(state.players.p2.hand.filter((u) => water.includes(u))).toEqual([]);
    // No Amulet search parked for p2 (no koTrigger), no ABILITY_TRIGGERED.
    expect(all(events, "ABILITY_TRIGGERED")).toEqual([]);
    expect(state.phase.kind === "effect:choose" && state.phase.seat === "p2").toBe(false);
  });

  it("🛑 a PARKED Adrena-Brain round-trips through JSON (pendingOp + the engine-written `from`) and resumes", () => {
    const parked = run(brainBoard(30), use("Adrena-Brain", ACTIVE)).state;
    const revived = JSON.parse(JSON.stringify(parked)) as GameState;
    expect(revived).toEqual(parked);
    if (revived.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(revived.phase.cont.pendingOp).toEqual({
      op: "moveCountersToOpponentChosen",
      upTo: 3,
      from: { spot: "active" },
    });
    const done = run(revived, pick({ seat: "p2", spot: { spot: "active" } }, 1)).state;
    expect(bodyAt(done, "p2", "active").damage).toBe(10);
  });

  it("a `take` above the printed 3 is refused by the validator (the ceiling is the print's)", () => {
    const parked = run(brainBoard(50), use("Adrena-Brain", ACTIVE)).state;
    expect(refused(parked, pick({ seat: "p2", spot: { spot: "active" } }, 4)).code).toBe("BAD_EFFECT_CHOICE");
  });

  it("Mind Bend still derives: 60 and Confused", () => {
    let state = brainBoard(0);
    state = attach(state, "p1", "active", PSYCHIC, 1);
    const { state: after } = run(state, attack(0));
    expect(bodyAt(after, "p2", "active").damage).toBe(60);
    expect(bodyAt(after, "p2", "active").conditions.rotation).toBe("confused");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§3 — Milotic \"Mentally Calm\" (the in-play → hand lock)", () => {
  it("🛑 THE DIRECTION: p2's Milotic locks p1's cards and never p2's own", () => {
    const state = table(FILLER, [], MILOTIC);
    expect(inPlayToHandBlocked(state, "p1")).toBe(true);
    expect(inPlayToHandBlocked(state, "p2")).toBe(false);
    // On the Bench too (no spot clause).
    const benched = table(FILLER, [], FILLER, [MILOTIC]);
    expect(inPlayToHandBlocked(benched, "p1")).toBe(true);
    expect(inPlayToHandBlocked(table(FILLER), "p1")).toBe(false);
  });

  it("🛑 a §9-LOCKED Milotic locks nothing (Flutter Mane opposite silences the Active Milotic)", () => {
    const state = table(FLUTTER_MANE, [], MILOTIC);
    expect(inPlayToHandBlocked(state, "p1")).toBe(false);
    expect(conditionHolds(state, "p1", { kind: "yourInPlayToHandAllowed" })).toBe(true);
    expect(conditionHolds(table(FILLER, [], MILOTIC), "p1", { kind: "yourInPlayToHandAllowed" })).toBe(false);
  });

  it("🛑 returnBenched (bench): Swoobat's Happy Return WHIFFS — the body stays on the Bench", () => {
    const start = attach(attach(table(SWOOBAT, [WATER_MON], MILOTIC), "p1", "active", COLORLESS), "p1", 0, WATER);
    const { state, events } = run(start, attack(0));
    expect(state.players.p1.bench).toHaveLength(1);
    expect(all(events, "POKEMON_RETURNED")).toEqual([]);
    // Control: no Milotic, the same attack returns it.
    const free = attach(attach(table(SWOOBAT, [WATER_MON]), "p1", "active", COLORLESS), "p1", 0, WATER);
    const ok = run(free, attack(0)).state;
    expect(ok.players.p1.bench).toHaveLength(0);
    expect(ok.players.p1.hand.map((u) => idOf(ok, u)).sort()).toEqual([WATER, WATER_MON].sort());
  });

  it("🛑 returnBenched (Active arm, Scoop Up Cyclone's writer): the Active stays", () => {
    const start = table(FILLER, [WATER_MON], MILOTIC);
    const events: GameEvent[] = [];
    const program: EffectOp[] = [{ op: "returnBenched", whose: "self", dest: "hand", includeActive: true }];
    const out = runProgram(start, program, { seat: "p1" }, events);
    if (out.kind !== "parked") throw new Error("expected the two-body pick to park");
    // Answer the ACTIVE through the resumed path is not reachable here; ask the writer on a ONE-body board instead.
    const lone = table(FILLER, [], MILOTIC);
    const loneEvents: GameEvent[] = [];
    const done = runProgram(lone, program, { seat: "p1" }, loneEvents);
    if (done.kind !== "done") throw new Error("expected the forced pick to finish");
    expect(done.state.players.p1.active).not.toBeNull();
    expect(all(loneEvents, "POKEMON_RETURNED")).toEqual([]);
    const free = runProgram(table(FILLER), program, { seat: "p1" }, []);
    if (free.kind !== "done") throw new Error("expected done");
    expect(free.state.players.p1.active).toBeNull();
  });

  it("🛑 R-MC2: Scoop Up Cyclone with every own body locked is REFUSED (no afford-then-reject), and Chill Teaser Toy by the Milotic OWNER is unplayable", () => {
    const locked = setHand(table(FILLER, [WATER_MON], MILOTIC), "p1", [SCOOP_UP]);
    const uid = locked.players.p1.hand[0] as string;
    expect(refused(locked, { type: "playTrainer", seat: "p1", uid } as GameAction).code).toBe("NO_LEGAL_TARGET");
    const free = setHand(table(FILLER, [WATER_MON]), "p1", [SCOOP_UP]);
    expect(programPlayable(free, programFor(SCOOP_UP)?.trainer ?? [], "p1")).toBe(true);
    // R-MC1 + R-MC2 — p1 OWNS Milotic: the Toy would put p2's Energy into p2's hand, which p1's own lock stops.
    const toy = programFor(CHILL_TOY)?.trainer ?? [];
    const own = attach(table(MILOTIC), "p2", "active", WATER);
    expect(programPlayable(own, toy, "p1")).toBe(false);
    expect(programPlayable(attach(table(FILLER), "p2", "active", WATER), toy, "p1")).toBe(true);
  });

  it("🛑 returnSelf: Lillie's Comfey's Fade Out WHIFFS — Comfey and its Energy stay Active", () => {
    const start = attach(table(COMFEY, [], MILOTIC), "p1", "active", PSYCHIC);
    const { state, events } = run(start, attack(1));
    expect(bodyAt(state, "p1", "active").energy).toHaveLength(1);
    expect(all(events, "POKEMON_RETURNED")).toEqual([]);
    expect(bodyAt(state, "p2", "active").damage).toBe(30);
  });

  it("🛑 devolveBodyToHand (R-MC1/R-MC3): p1's OWN Milotic stops p1's Espathra devolving p2's body — the devolve fails WHOLE", () => {
    let start = underneath(table(ESPATHRA, [MILOTIC], STAGE1), "p2", "active", FILLER);
    start = attach(start, "p1", "active", COLORLESS);
    const { state, events } = run(start, attack(0));
    expect(bodyAt(state, "p2", "active").stack).toHaveLength(2);
    expect(all(events, "POKEMON_DEVOLVED")).toEqual([]);
    // Control: without the Milotic the same attack devolves.
    let free = underneath(table(ESPATHRA, [], STAGE1), "p2", "active", FILLER);
    free = attach(free, "p1", "active", COLORLESS);
    expect(bodyAt(run(free, attack(0)).state, "p2", "active").stack).toHaveLength(1);
  });

  it("🛑 discardEnergy `to: \"hand\"`: Shiftry's Energy Loop keeps its Energy attached under the lock (the 140 still lands)", () => {
    const start = attach(table(SHIFTRY, [], MILOTIC), "p1", "active", COLORLESS, 2);
    const { state, events } = run(start, attack(1));
    expect(bodyAt(state, "p1", "active").energy).toHaveLength(2);
    expect(all(events, "ENERGY_DISCARDED")).toEqual([]);
    const free = run(attach(table(SHIFTRY), "p1", "active", COLORLESS, 2), attack(1)).state;
    expect(bodyAt(free, "p1", "active").energy).toHaveLength(1);
  });

  it("🛑 D385 — Zarude's Jungle Whip does NOT offer its cost under the lock (a \"yes\" would buy +80 for a whiff): the base 80 lands with no prompt", () => {
    const locked = attach(attach(table(ZARUDE, [], MILOTIC), "p1", "active", GRASS, 2), "p1", "active", COLORLESS);
    const { state } = run(locked, attack(1));
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(bodyAt(state, "p2", "active").damage).toBe(80);
    expect(bodyAt(state, "p1", "active").energy).toHaveLength(3);
    // Control: the confirm parks without the lock.
    const free = attach(attach(table(ZARUDE), "p1", "active", GRASS, 2), "p1", "active", COLORLESS);
    expect(run(free, attack(1)).state.phase.kind).toBe("effect:choose");
  });

  it("Hydro Splash still derives: 100", () => {
    const start = attach(table(MILOTIC), "p1", "active", WATER, 3);
    expect(bodyAt(run(start, attack(0)).state, "p2", "active").damage).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§4 — Huntail \"Diver's Catch\" (the Knock Out rescue, auto-fired per D27)", () => {
  /** p1 Hitter Active (300 for nothing); p2 `koed` Active carrying 2 {W} + 1 {C} Basic + 1 Special, `oppBench`. */
  function catchBoard(koed: string = WATER_MON, oppBench: readonly string[] = [HUNTAIL], p1Bench: readonly string[] = []): GameState {
    let state = table(HITTER, p1Bench, koed, oppBench);
    state = attach(state, "p2", "active", WATER, 2);
    state = attach(state, "p2", "active", COLORLESS, 1);
    return attach(state, "p2", "active", SPECIAL, 1);
  }

  it("🛑 the rescue: a {W} body KO'd by the opponent's attack puts its Basic {W} Energy into the HAND — {C} Basic and Special to the discard", () => {
    const start = catchBoard();
    const body = bodyAt(start, "p2", "active");
    const waters = body.energy.filter((u) => idOf(start, u) === WATER);
    const others = body.energy.filter((u) => idOf(start, u) !== WATER);
    const { state, events } = run(start, attack(0));
    expect(state.players.p2.hand).toEqual(waters);
    for (const uid of others) expect(state.players.p2.discard).toContain(uid);
    for (const uid of waters) expect(state.players.p2.discard).not.toContain(uid);
    const ko = all(events, "KNOCKED_OUT")[0];
    expect(ko?.toHand).toEqual(waters);
    expect(ko?.discarded).not.toContain(waters[0]);
    expect(render(events, state)).toContain(
      "p2: D572 Water was Knocked Out — 2 Basic Energy put into the hand instead of the discard pile",
    );
  });

  it("🛑 a NON-{W} body is not rescued (R-DC3a: the printed type)", () => {
    const { state, events } = run(catchBoard(PECHARUNT_EX), attack(0));
    expect(all(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(state.players.p2.hand).toEqual([]);
    expect(all(events, "KNOCKED_OUT")[0]?.toHand).toBeUndefined();
  });

  it("no Huntail, no rescue — and a §9-SILENCED Huntail rescues nothing", () => {
    const none = catchBoard(WATER_MON, []);
    expect(run(none, attack(0)).state.players.p2.hand).toEqual([]);
    // Flutter Mane (p1 Active) silences p2's ACTIVE Huntail; the rescue is asked of the board directly.
    let silenced = table(FLUTTER_MANE, [], HUNTAIL);
    silenced = attach(silenced, "p2", "active", WATER, 2);
    expect(koEnergyRescueUids(silenced, "p2", bodyAt(silenced, "p2", "active"))).toEqual([]);
    let live = table(FILLER, [], HUNTAIL);
    live = attach(live, "p2", "active", WATER, 2);
    expect(koEnergyRescueUids(live, "p2", bodyAt(live, "p2", "active"))).toHaveLength(2);
  });

  it("🛑 R-DC3b: a Milotic on the ATTACKER's side locks the rescue — the {W} Energy goes to the discard", () => {
    const { state, events } = run(catchBoard(WATER_MON, [HUNTAIL], [MILOTIC]), attack(0));
    expect(state.players.p2.hand).toEqual([]);
    expect(all(events, "KNOCKED_OUT")[0]?.toHand).toBeUndefined();
  });

  it("🛑 Milotic and Huntail on the SAME board: a Milotic never locks its own side — the rescue holds", () => {
    const { state } = run(catchBoard(WATER_MON, [HUNTAIL, MILOTIC]), attack(0));
    expect(state.players.p2.hand.map((u) => idOf(state, u))).toEqual([WATER, WATER]);
  });

  it("🛑 R-DC2: a Huntail KO'd in the SAME batch still counts (the PRE-batch board) — Huntail Active and a benched {W} body both fall", () => {
    let start = table(SPREADER, [], HUNTAIL, [WATER_MON]);
    start = damaged(damaged(start, "p2", "active", 80), "p2", 0, 70);
    start = attach(attach(start, "p2", "active", WATER, 1), "p2", 0, WATER, 1);
    const benchWater = bodyAt(start, "p2", 0).energy;
    const ownWater = bodyAt(start, "p2", "active").energy;
    const { state, events } = run(start, attack(0));
    expect(all(events, "KNOCKED_OUT")).toHaveLength(2);
    expect([...state.players.p2.hand].sort()).toEqual([...benchWater, ...ownWater].sort());
  });

  it("🛑 a CHECKUP Knock Out (Poison) is not \"by an attack\" — no rescue", () => {
    let start = catchBoard();
    start = withBody(damaged(start, "p2", "active", 90), "p2", "active", (p) => ({
      ...p,
      conditions: { ...p.conditions, poisonDamage: 10 },
    }));
    const { state, events } = run(start, { type: "endTurn", seat: "p1" } as GameAction);
    const ko = all(events, "KNOCKED_OUT")[0];
    expect(ko).toBeDefined();
    expect(ko?.toHand).toBeUndefined();
    expect(state.players.p2.hand.filter((u) => idOf(state, u) === WATER)).toEqual([]);
  });

  it("🛑 a RECOIL Knock Out of the attacker's own {W} body is not \"from your OPPONENT's Pokémon\" — no rescue", () => {
    let start = table(RECOILER, [HUNTAIL]);
    start = attach(start, "p1", "active", WATER, 2);
    const waters = bodyAt(start, "p1", "active").energy;
    const { state, events } = run(start, attack(0));
    expect(all(events, "KNOCKED_OUT").map((e) => e.toHand)).toEqual([undefined]);
    for (const uid of waters) expect(state.players.p1.discard).toContain(uid);
  });

  it("Wave Splash still derives: 80", () => {
    const start = attach(table(HUNTAIL), "p1", "active", WATER, 3);
    expect(bodyAt(run(start, attack(0)).state, "p2", "active").damage).toBe(80);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§5 — Klinklang \"Emergency Rotation\" (the first in-hand Ability)", () => {
  const benchIt = (state: GameState): GameAction =>
    ({ type: "playBasicToBench", seat: "p1", uid: state.players.p1.hand[0] as string }) as GameAction;

  it("🛑 refused without an opposing Stage 2, with the printed clause", () => {
    const state = setHand(table(FILLER), "p1", [KLINKLANG]);
    const no = refused(state, benchIt(state));
    expect(no.code).toBe("ABILITY_CONDITION_NOT_MET");
    expect(no.message).toBe("Emergency Rotation can only be used if your opponent has any Stage 2 Pokémon in play (§9)");
  });

  it("🛑 an opposing Stage 2 (Active OR Bench) admits it: benched, ABILITY_USED filed, the allowance spent", () => {
    for (const board of [table(FILLER, [], STAGE2), table(FILLER, [], FILLER, [STAGE2])]) {
      const state = setHand(board, "p1", [KLINKLANG]);
      const uid = state.players.p1.hand[0] as string;
      const { state: after, events } = run(state, benchIt(state));
      expect(after.players.p1.bench.map(top)).toEqual([uid]);
      expect(after.players.p1.hand).toEqual([]);
      expect(events.slice(0, 2)).toEqual([
        { type: "ABILITY_USED", seat: "p1", uid, ability: "Emergency Rotation" },
        { type: "POKEMON_BENCHED", seat: "p1", uid },
      ]);
      expect(after.allowances.abilitiesUsed).toContain(`${uid}:Emergency Rotation`);
      expect(render(events, after)[0]).toBe("p1: Klinklang used Emergency Rotation");
    }
  });

  it("🛑 ONCE PER TURN: scooped back to the hand the same turn, the same card is refused", () => {
    let state = setHand(table(FILLER, [], STAGE2), "p1", [KLINKLANG, SCOOP_UP]);
    const klink = state.players.p1.hand[0] as string;
    const scoop = state.players.p1.hand[1] as string;
    state = run(state, { type: "playBasicToBench", seat: "p1", uid: klink } as GameAction).state;
    state = run(state, { type: "playTrainer", seat: "p1", uid: scoop } as GameAction).state;
    if (state.phase.kind === "effect:choose") state = run(state, pick({ seat: "p1", spot: { spot: "bench", index: 0 } })).state;
    expect(state.players.p1.hand).toContain(klink);
    expect(refused(state, { type: "playBasicToBench", seat: "p1", uid: klink } as GameAction).code).toBe(
      "ABILITY_ALREADY_USED",
    );
  });

  it("🛑 R-KR1: Potent Glare (a Pokémon-PLAY bar) refuses it", () => {
    const glare = setHand(table(FILLER, [], ARBOK, [STAGE2]), "p1", [KLINKLANG]);
    expect(refused(glare, benchIt(glare)).code).toBe("HAND_PLAY_BLOCKED");
  });

  it("🛑 R-KR2: an in-play Ability lock that WOULD silence the landed Klinklang does not reach it in the hand", () => {
    // 🆕🆕🆕 the review round's rewrite. The old rung put Flutter Mane as p1's Active — a lock that reaches
    // p2's Active and nothing of p1's, and `disabledAbilityUids` never holds a hand uid — so a lock-aware
    // `benchFromHandRotation` passed it. Gastrodon "Sticky Bind" on p1's OWN Bench silences BENCHED Stage 2
    // Pokémon on BOTH sides: the exact zone and stage the Rotation lands in. Three facts, in order:
    const board = setHand(table(FILLER, [GASTRODON, SHIFTRY], STAGE2), "p1", [KLINKLANG]);
    const klinklang = board.players.p1.hand[0] as string;
    // (a) the lock is LIVE on p1's own side — p1's benched Stage 2 Shiftry has no Abilities;
    expect(disabledAbilityUids(board).has(top(bodyAt(board, "p1", 1)))).toBe(true);
    // (b) the in-hand Klinklang still uses Emergency Rotation (R-KR2: the lock reaches in-play bodies only);
    const { state: after, events } = run(board, benchIt(board));
    expect(after.players.p1.bench.map(top)).toEqual([...board.players.p1.bench.map(top), klinklang]);
    expect(all(events, "ABILITY_USED")).toHaveLength(1);
    // (c) and ONCE LANDED the same lock does reach it — the witness is a lock that silences this very card.
    expect(disabledAbilityUids(after).has(klinklang)).toBe(true);
    // Flutter Mane (p1's Active, reaching p2's Active) is irrelevant too.
    const fluttering = setHand(table(FLUTTER_MANE, [], STAGE2), "p1", [KLINKLANG]);
    expect(run(fluttering, benchIt(fluttering)).state.players.p1.bench).toHaveLength(1);
  });

  it("a Basic still benches byte-identically, and a non-Basic WITHOUT the key is still NOT_A_BASIC_POKEMON", () => {
    const basic = setHand(table(FILLER), "p1", [WATER_MON]);
    expect(run(basic, benchIt(basic)).events).toEqual([
      { type: "POKEMON_BENCHED", seat: "p1", uid: basic.players.p1.hand[0] as string },
    ]);
    const stage1 = setHand(table(FILLER, [], STAGE2), "p1", [MILOTIC]);
    expect(refused(stage1, benchIt(stage1)).code).toBe("NOT_A_BASIC_POKEMON");
  });

  it("Hyper Ray still derives: 130 and every Energy discarded", () => {
    const start = attach(table(KLINKLANG), "p1", "active", COLORLESS, 2);
    const after = run(start, attack(0)).state;
    expect(bodyAt(after, "p2", "active").damage).toBe(130);
    expect(bodyAt(after, "p1", "active").energy).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§6 — the version", () => {
  it("the engine is 0.526.0", () => {
    expect(engineVersion).toBe("0.526.0");
  });
});
