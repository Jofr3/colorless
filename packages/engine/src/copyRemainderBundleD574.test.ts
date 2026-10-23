import type { Card } from "@colorless/schema";
import { redactedEffectPromptSchema } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { hasRuleBox } from "./cards";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  COPY_FAMILY_MARKER,
  deriveAttackCopy,
  deriveAttackEffect,
  splitAttackTrailingClause,
} from "./effects";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { settleProgram } from "./flow";
import { applyAction } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { resumeProgram } from "./interpreter";
import type { EffectChoice } from "./interpreter";
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
  must,
  mustApply as run,
  effectPrompt,
  driveSetup,
  roundTrip,
  withFaces,
} from "./testFixtures";
import type { InPlayPokemon } from "./types";

const PERSIANS = ["sv10-150", "sv10-219", "svp-218"] as const;
const PERSIAN = PERSIANS[0];
const SLOWKING = "sv07-058";
const MALAMAR = "sv06.5-034";
const SABLEYE = "sv05-107";
const ALAKAZAM = "sv06-082";
const ZOROARK = "sv10.5w-062";
const XEROSIC = "sv06.5-064";
const TARGET = "d574t-target";
const SOLO = "d574t-solo";
const BLANK = "d574t-blank";
const GATED = "d574t-gated";
const UNREAD = "d574t-unread";
const TESTMON_EX = "d574t-testmon-ex";
const WEAK_DARK = "d574t-weak-dark";
const FRAIL = "d574t-frail";
const FILLER = "d574t-filler";
const TEAPARTY = "fix-teaparty";
const MIST = "fix-mist-energy";
const DARK = "d574t-dark";
const PSYCHIC = "d574t-psychic";
const COLORLESS = "fix-energy";

const HAUGHTY_ORDER =
  "Reveal the top 10 cards of your opponent's deck. You may choose an attack from a Pokémon you find there and use it as this attack. Shuffle the revealed cards into your opponent's deck.";
const SEEK_INSPIRATION =
  "Discard the top card of your deck, and if that card is a Pokémon that doesn't have a Rule Box, choose 1 of its attacks and use it as this attack. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)";
const COLLUDING_TENTACLES =
  "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. If you do, this attack does 120 damage to the new Active Pokémon. If you didn't play Xerosic's Machinations from your hand during this turn, this attack does nothing.";
const DAMAGE_COLLECTION =
  "You may move any number of damage counters from your opponent's Benched Pokémon to their Active Pokémon.";
const STRANGE_HACKING =
  "Your opponent's Active Pokémon is now Confused. You may move any number of damage counters from your opponent's Pokémon to their other Pokémon in any way you like.";
const STRANGE_HACKING_TAIL =
  "You may move any number of damage counters from your opponent's Pokémon to their other Pokémon in any way you like.";
const FOUL_PLAY = "Choose 1 of your opponent's Active Pokémon's attacks and use it as this attack.";
const GATED_TEXT =
  "If you go second, you can't use this attack during your first turn. This attack does 30 damage for each of your Benched Pokémon.";
const UNREAD_TEXT =
  "Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack.";

const persianCard = (id: string): Card =>
  battler(id, {
    name: "Team Rocket's Persian ex",
    stage: "Stage1",
    evolveFrom: "Team Rocket's Meowth",
    types: ["Colorless"],
    hp: 260,
    retreat: 2,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Haughty Order", effect: HAUGHTY_ORDER },
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Cruel Slash",
        damage: 140,
        effect: "Your opponent's Active Pokémon is now Confused.",
      },
    ],
  });

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(PERSIANS.map((id) => [id, persianCard(id)])),
  [SLOWKING]: battler(SLOWKING, {
    name: "Slowking",
    stage: "Stage1",
    evolveFrom: "Slowpoke",
    types: ["Psychic"],
    hp: 120,
    retreat: 3,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    attacks: [
      { cost: ["Psychic", "Colorless"], name: "Seek Inspiration", effect: SEEK_INSPIRATION },
      { cost: ["Psychic", "Psychic", "Colorless"], name: "Super Psy Bolt", damage: 120 },
    ],
  }),
  [MALAMAR]: battler(MALAMAR, {
    name: "Malamar",
    stage: "Stage1",
    evolveFrom: "Inkay",
    types: ["Darkness"],
    hp: 120,
    retreat: 3,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      { cost: ["Darkness"], name: "Colluding Tentacles", effect: COLLUDING_TENTACLES },
      { cost: ["Darkness", "Colorless", "Colorless"], name: "Spinning Attack", damage: 90 },
    ],
  }),
  [SABLEYE]: battler(SABLEYE, {
    name: "Sableye",
    types: ["Darkness"],
    hp: 70,
    retreat: 1,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      { cost: ["Darkness"], name: "Claw Slash", damage: 20 },
      { cost: ["Colorless", "Colorless"], name: "Damage Collection", effect: DAMAGE_COLLECTION },
    ],
  }),
  [ALAKAZAM]: battler(ALAKAZAM, {
    name: "Alakazam",
    stage: "Stage2",
    evolveFrom: "Kadabra",
    types: ["Psychic"],
    hp: 140,
    retreat: 1,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    attacks: [
      { cost: ["Psychic"], name: "Strange Hacking", effect: STRANGE_HACKING },
      {
        cost: ["Psychic"],
        name: "Psychic",
        damage: "10+",
        effect:
          "This attack does 50 more damage for each Energy attached to your opponent's Active Pokémon.",
      },
    ],
  }),
  [ZOROARK]: battler(ZOROARK, {
    name: "Zoroark",
    stage: "Stage1",
    evolveFrom: "Zorua",
    types: ["Darkness"],
    hp: 120,
    retreat: 1,
    attacks: [
      {
        cost: ["Darkness"],
        name: "Mind Jack",
        damage: "30×",
        effect: "This attack does 30 damage for each of your opponent's Benched Pokémon.",
      },
      { cost: ["Colorless", "Colorless", "Colorless"], name: "Foul Play", effect: FOUL_PLAY },
    ],
  }),
  [XEROSIC]: {
    ...trainerCard(
      XEROSIC,
      "Supporter",
      "Your opponent discards cards from their hand until they have 3 cards in their hand.",
    ),
    name: "Xerosic's Machinations",
  },
  [TARGET]: battler(TARGET, {
    name: "D574 Target",
    types: ["Colorless"],
    hp: 400,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Poke", damage: 10 },
      { cost: ["Colorless", "Colorless"], name: "Smash", damage: 60 },
    ],
  }),
  [SOLO]: battler(SOLO, {
    name: "D574 Solo",
    types: ["Colorless"],
    hp: 400,
    retreat: 1,
    attacks: [{ cost: ["Colorless", "Colorless"], name: "Smash", damage: 60 }],
  }),
  [BLANK]: battler(BLANK, { name: "D574 Blank", types: ["Colorless"], hp: 400, retreat: 1 }),
  [GATED]: battler(GATED, {
    name: "D574 Gated",
    types: ["Colorless"],
    hp: 400,
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Gated Count", damage: "30×", effect: GATED_TEXT }],
  }),
  [UNREAD]: battler(UNREAD, {
    name: "D574 Unread",
    types: ["Colorless"],
    hp: 400,
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Unread Show", effect: UNREAD_TEXT }],
  }),
  [TESTMON_EX]: battler(TESTMON_EX, {
    name: "D574 Testmon ex",
    types: ["Colorless"],
    hp: 230,
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Test Blast", damage: 90 }],
  }),
  [WEAK_DARK]: battler(WEAK_DARK, {
    name: "D574 Weak to Darkness",
    types: ["Psychic"],
    hp: 400,
    retreat: 1,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    attacks: [{ cost: ["Psychic"], name: "Smash", damage: 60 }],
  }),
  [FRAIL]: battler(FRAIL, {
    name: "D574 Frail",
    types: ["Colorless"],
    hp: 60,
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [FILLER]: battler(FILLER, {
    name: "D574 Filler",
    types: ["Colorless"],
    hp: 900,
    retreat: 1,
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  [DARK]: typedEnergy(DARK, "Darkness"),
  [PSYCHIC]: typedEnergy(PSYCHIC, "Psychic"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [PERSIANS[0]]: 1,
  [PERSIANS[1]]: 1,
  [PERSIANS[2]]: 1,
  [SLOWKING]: 2,
  [MALAMAR]: 1,
  [SABLEYE]: 2,
  [ALAKAZAM]: 1,
  [ZOROARK]: 1,
  [XEROSIC]: 2,
  [TARGET]: 2,
  [SOLO]: 2,
  [BLANK]: 1,
  [GATED]: 1,
  [UNREAD]: 1,
  [TESTMON_EX]: 1,
  [WEAK_DARK]: 2,
  [FRAIL]: 2,
  [FILLER]: 10,
  [TEAPARTY]: 1,
  [DARK]: 6,
  [PSYCHIC]: 6,
  [COLORLESS]: 12,
  [MIST]: 1,
});

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

function refused(state: GameState, action: GameAction): { code: string; message: string } {
  const result = applyAction(state, action);
  if (result.ok) throw new Error(`${action.type} was accepted`);
  return { code: result.error.code, message: result.error.message };
}

/** Setup with p2 going first; returns p1's turn 2 (p1's FIRST turn — p1 went second). */
function opened(seed: number): GameState {
  const state = driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** p1's NEXT turn (turn 4): p1 and then p2 pass. */
function later(state: GameState): GameState {
  const passed = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  return must(applyAction(passed, { type: "endTurn", seat: "p2" }));
}

/** TEST SURGERY — the seat's hand back into its deck. */
function emptyHand(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, deck: [...side.deck, ...side.hand], hand: [] },
    },
  };
}

/** TEST SURGERY — one copy of `id` into `seat`'s DECK (swapped out of the Prizes when needed). */
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

/** TEST SURGERY — the top of `seat`'s deck becomes `ids` (in order, top first), then `pad` ENERGY
    cards (never Pokémon, so they offer nothing), then the rest. */
function stackTop(state: GameState, seat: Seat, ids: readonly string[], pad = 0): GameState {
  let s = state;
  for (const id of ids) s = ensureInDeck(s, seat, id);
  const side = s.players[seat];
  const used = new Set<string>();
  const top: string[] = [];
  for (const id of ids) {
    const uid = side.deck.find((u) => s.cardIdByUid[u] === id && !used.has(u));
    if (uid === undefined) throw new Error(`no ${id} in ${seat}'s deck`);
    used.add(uid);
    top.push(uid);
  }
  for (const u of side.deck) {
    if (top.length >= ids.length + pad) break;
    if (!used.has(u) && POOL[s.cardIdByUid[u] ?? ""]?.category === "Energy") {
      used.add(u);
      top.push(u);
    }
  }
  if (top.length < ids.length + pad) throw new Error("not enough Energy to pad the deck top");
  return {
    ...s,
    players: {
      ...s.players,
      [seat]: { ...side, deck: [...top, ...side.deck.filter((u) => !used.has(u))] },
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

function withBody(
  state: GameState,
  seat: Seat,
  spot: Spot,
  f: (p: InPlayPokemon) => InPlayPokemon,
): GameState {
  const side = state.players[seat];
  const next =
    spot === "active"
      ? { ...side, active: f(bodyAt(state, seat, "active")) }
      : { ...side, bench: side.bench.map((p, i) => (i === spot ? f(p) : p)) };
  return { ...state, players: { ...state.players, [seat]: next } };
}

const damaged = (state: GameState, seat: Seat, spot: Spot, damage: number): GameState =>
  withBody(state, seat, spot, (p) => ({ ...p, damage }));

/** TEST SURGERY — attach deck copies of each id in `ids` to the body. */
function attach(state: GameState, seat: Seat, spot: Spot, ids: readonly string[]): GameState {
  let next = state;
  for (const id of ids) {
    next = ensureInDeck(next, seat, id);
    const side = next.players[seat];
    const uid = side.deck.find((u) => next.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`no ${id} in the deck`);
    next = {
      ...next,
      players: { ...next.players, [seat]: { ...side, deck: side.deck.filter((u) => u !== uid) } },
    };
    next = withBody(next, seat, spot, (p) => ({ ...p, energy: [...p.energy, uid] }));
  }
  return next;
}

/** p1's turn 2: p1 `active` + `bench`, p2 `oppActive` + `oppBench`. Hands emptied into the decks. */
function table(
  active: string,
  bench: readonly string[] = [],
  oppActive: string = FILLER,
  oppBench: readonly string[] = [],
  seed = 5741,
): GameState {
  let state = emptyHand(emptyHand(opened(seed), "p1"), "p2");
  state = setActiveFromDeck(ensureInDeck(state, "p1", active), "p1", active);
  state = setActiveFromDeck(ensureInDeck(state, "p2", oppActive), "p2", oppActive);
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of bench) state = benchFromDeck(ensureInDeck(state, "p1", id), "p1", id);
  for (const id of oppBench) state = benchFromDeck(ensureInDeck(state, "p2", id), "p2", id);
  return state;
}

type Attacker = { id: string; index: number; name: string; energy: readonly string[] };
const ATTACKERS: Record<string, Attacker> = {
  ...Object.fromEntries(
    PERSIANS.map((id) => [
      id,
      { id, index: 0, name: "Haughty Order", energy: [COLORLESS, COLORLESS] },
    ]),
  ),
  [SLOWKING]: { id: SLOWKING, index: 0, name: "Seek Inspiration", energy: [PSYCHIC, COLORLESS] },
  [MALAMAR]: { id: MALAMAR, index: 0, name: "Colluding Tentacles", energy: [DARK] },
  [SABLEYE]: { id: SABLEYE, index: 1, name: "Damage Collection", energy: [COLORLESS, COLORLESS] },
  [ALAKAZAM]: { id: ALAKAZAM, index: 0, name: "Strange Hacking", energy: [PSYCHIC] },
  [ZOROARK]: {
    id: ZOROARK,
    index: 1,
    name: "Foul Play",
    energy: [COLORLESS, COLORLESS, COLORLESS],
  },
};

function attackerOf(id: string): Attacker {
  const a = ATTACKERS[id];
  if (a === undefined) throw new Error(`no attacker ${id}`);
  return a;
}

/** The attacker Active with its cost paid, on `table`'s board. */
function armed(
  id: string,
  bench: readonly string[] = [],
  oppActive: string = FILLER,
  oppBench: readonly string[] = [],
): GameState {
  return attach(table(id, bench, oppActive, oppBench), "p1", "active", attackerOf(id).energy);
}

function all<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const types = (events: readonly GameEvent[]): string[] => events.map((e) => e.type);

function render(events: GameEvent[], state: GameState): string[] {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn" ? [] : [`${entry.who}: ${entry.segments.map((s) => s.text).join("")}`],
  );
}

const declare = (id: string): GameAction => ({
  type: "attack",
  seat: "p1",
  index: attackerOf(id).index,
});
const answer = (choice: EffectChoice): GameAction =>
  ({ type: "resolveEffect", seat: "p1", choice }) as GameAction;
const yes = answer({ kind: "confirm", yes: true });
const no = answer({ kind: "confirm", yes: false });
const pickAttack = (index: number): GameAction => answer({ kind: "attack", index });
const p2Ref = (spot: Spot) =>
  spot === "active"
    ? { seat: "p2" as const, spot: { spot: "active" as const } }
    : { seat: "p2" as const, spot: { spot: "bench" as const, index: spot } };
const pickOpp = (spot: Spot, take?: number): GameAction =>
  answer({ kind: "pokemon", ref: p2Ref(spot), ...(take === undefined ? {} : { take }) });
const decline = answer({ kind: "pokemon" });

const oppActiveDamage = (state: GameState): number => bodyAt(state, "p2", "active").damage;

/** A seat's bodies in play (the Active and the Bench) — what a counter move or a copy could touch. */
const inPlay = (state: GameState, seat: Seat) => ({
  active: state.players[seat].active,
  bench: state.players[seat].bench,
});

/** Whether p1's turn ended: the turn passed to p2. */
const turnPassed = (state: GameState): boolean =>
  state.phase.kind === "turn:action" && state.phase.seat === "p2";

/** p1 played Xerosic's Machinations from hand this turn (a REAL play; p2's hand is empty, so its
    own effect discards nothing). */
function playedXerosic(state: GameState): GameState {
  const s = ensureInDeck(state, "p1", XEROSIC);
  const side = s.players.p1;
  const uid = side.deck.find((u) => s.cardIdByUid[u] === XEROSIC);
  if (uid === undefined) throw new Error("no Xerosic");
  const inHand: GameState = {
    ...s,
    players: {
      ...s.players,
      p1: { ...side, deck: side.deck.filter((u) => u !== uid), hand: [...side.hand, uid] },
    },
  };
  return run(inHand, { type: "playTrainer", seat: "p1", uid }).state;
}

/** All events of an action sequence, concatenated. */
function chain(
  state: GameState,
  actions: readonly GameAction[],
): { state: GameState; events: GameEvent[] } {
  let s = state;
  const events: GameEvent[] = [];
  for (const a of actions) {
    const r = run(s, a);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

// ─────────────────────────────────────────────────────────────────────────────
describe("D574 §1 — the readers: two resolve-time copy anchors, two counter-move anchors, one registry row", () => {
  it("`deriveAttackCopy` claims the two remainder sentences as RESOLVE-TIME kinds (and both apostrophes curl)", () => {
    expect(deriveAttackCopy(HAUGHTY_ORDER)).toEqual({
      from: "opponentDeckTop",
      count: 10,
      may: true,
    });
    expect(deriveAttackCopy(SEEK_INSPIRATION)).toEqual({ from: "ownDeckTopMill", count: 1 });
    expect(deriveAttackCopy(HAUGHTY_ORDER.split("'").join("’"))).toEqual({
      from: "opponentDeckTop",
      count: 10,
      may: true,
    });
    expect(deriveAttackCopy(SEEK_INSPIRATION.split("'").join("’"))).toEqual({
      from: "ownDeckTopMill",
      count: 1,
    });
    // One-token near misses refuse.
    expect(deriveAttackCopy(HAUGHTY_ORDER.replace("top 10", "top 5"))).toBeNull();
    expect(
      deriveAttackCopy(
        SEEK_INSPIRATION.replace(" (Pokémon ex, Pokémon V, etc. have Rule Boxes.)", ""),
      ),
    ).toBeNull();
    expect(deriveAttackCopy(HAUGHTY_ORDER.replace("You may choose", "Choose"))).toBeNull();
    // No PROGRAM: the effect reader still refuses both.
    expect(deriveAttackEffect(HAUGHTY_ORDER)).toBeNull();
    expect(deriveAttackEffect(SEEK_INSPIRATION)).toBeNull();
  });

  it("the whole copy family is claimed now: 6 sentences / 13 printings, every one by `deriveAttackCopy`", () => {
    const family = legalAttackCorpus().filter(([, s]) => COPY_FAMILY_MARKER.test(s));
    expect([family.length, family.reduce((n, [c]) => n + c, 0)]).toEqual([6, 13]);
    expect(family.filter(([, s]) => deriveAttackCopy(s) === null)).toEqual([]);
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(HAUGHTY_ORDER)).toBe(3);
    expect(rows.get(SEEK_INSPIRATION)).toBe(1);
    expect(resolvedByAnyReader(HAUGHTY_ORDER)).toBe(true);
    expect(resolvedByAnyReader(SEEK_INSPIRATION)).toBe(true);
  });

  it("the reader SURFACE stays at 14 — a widening, not a reader", () => {
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("Sableye derives WHOLE; Alakazam's tail derives and its compound COMPOSES behind the claimed head", () => {
    expect(rowsOf(DAMAGE_COLLECTION)).toBe(1);
    expect(deriveAttackEffect(DAMAGE_COLLECTION)).toEqual([
      { op: "moveCountersOpponentAnyWay", from: "bench" },
    ]);
    expect(deriveAttackEffect(DAMAGE_COLLECTION.split("'").join("’"))).toEqual([
      { op: "moveCountersOpponentAnyWay", from: "bench" },
    ]);
    expect(resolvedByAnyReader(DAMAGE_COLLECTION)).toBe(true);
    expect(deriveAttackEffect(STRANGE_HACKING_TAIL)).toEqual([
      { op: "moveCountersOpponentAnyWay", from: "any" },
    ]);
    // The compound is not claimed WHOLE by any reader (it stays in the RAW count) — it composes.
    expect(rowsOf(STRANGE_HACKING)).toBe(1);
    expect(deriveAttackEffect(STRANGE_HACKING)).toBeNull();
    expect(resolvedByAnyReader(STRANGE_HACKING)).toBe(false);
    const split = splitAttackTrailingClause(STRANGE_HACKING);
    expect(split).toEqual({
      head: "Your opponent's Active Pokémon is now Confused.",
      tail: STRANGE_HACKING_TAIL,
    });
    expect(deriveAttackEffect(split?.head ?? "")).not.toBeNull();
    // One-token near misses refuse (the destination, the quantifier, the apostrophe-free plural).
    expect(deriveAttackEffect(DAMAGE_COLLECTION.replace("their Active", "your Active"))).toBeNull();
    expect(deriveAttackEffect(DAMAGE_COLLECTION.replace("any number of", "up to 3"))).toBeNull();
    expect(deriveAttackEffect(STRANGE_HACKING_TAIL.replace(" in any way you like", ""))).toBeNull();
  });

  it("Malamar is a REGISTRY row (zero vocabulary) and the DERIVER still refuses its text (R-MA1)", () => {
    expect(rowsOf(COLLUDING_TENTACLES)).toBe(1);
    expect(programFor(MALAMAR)?.attack?.[0]).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "youPlayedSupporterNamedThisTurn", name: "Xerosic's Machinations" },
        then: [
          { op: "gust", recordAs: "moved" },
          {
            op: "recordGate",
            slot: "moved",
            then: [{ op: "damageNewActive", amount: 120 }],
          },
        ],
      },
    ]);
    expect(programFor(MALAMAR)?.attack?.[1]).toBeUndefined();
    expect(deriveAttackEffect(COLLUDING_TENTACLES)).toBeNull();
    expect(resolvedByAnyReader(COLLUDING_TENTACLES)).toBe(false);
  });

  it("the anti-laundering witness is a REAL refused sentence outside every family this round ranks", () => {
    expect(rowsOf(UNREAD_TEXT)).toBe(1);
    expect(resolvedByAnyReader(UNREAD_TEXT)).toBe(false);
    expect(splitAttackTrailingClause(UNREAD_TEXT)).toBeNull();
  });
});

function rowsOf(text: string): number | undefined {
  return legalAttackCorpus().find(([, s]) => s === text)?.[0];
}

// ─────────────────────────────────────────────────────────────────────────────
describe('D574 §2 — Haughty Order: reveal 10, shuffle at once (R-HO1), "You may", then the copy', () => {
  for (const id of PERSIANS) {
    it(`${id}: 2+ pairs — reveal, SHUFFLE, park the confirm; yes parks chooseAttack; the pick resolves`, () => {
      const before = stackTop(armed(id), "p2", [TARGET], 9);
      const shown = before.players.p2.deck.slice(0, 10);
      const parked = run(before, declare(id));
      expect(types(parked.events)).toEqual([
        "ATTACK_DECLARED",
        "DECK_TOP_REVEALED",
        "SHUFFLE",
        "EFFECT_PENDING",
      ]);
      expect(all(parked.events, "DECK_TOP_REVEALED")[0]).toEqual({
        type: "DECK_TOP_REVEALED",
        seat: "p2",
        dest: "deck",
        uids: shown,
        reveal: true,
        actor: "p1",
      });
      expect(parked.state.rngState).not.toBe(before.rngState);
      expect([...parked.state.players.p2.deck].sort()).toEqual([...before.players.p2.deck].sort());
      expect(all(parked.events, "ATTACK_DECLARED")[0]).not.toHaveProperty("as");
      expect(effectPrompt(parked.state)).toMatchObject({ kind: "confirm" });
      expect(parked.state.phase).toMatchObject({ kind: "effect:choose", resumeTail: true });
      expect(parked.state.pending).toEqual([
        { kind: "attackEpilogue", seat: "p1", uid: expect.any(String), attack: "Haughty Order" },
      ]);
      const second = run(parked.state, yes);
      expect(types(second.events)).toEqual(["EFFECT_PENDING"]);
      expect(effectPrompt(second.state)).toEqual({
        kind: "chooseAttack",
        candidates: [
          { index: 0, name: "Poke (D574 Target)" },
          { index: 1, name: "Smash (D574 Target)" },
        ],
        note: expect.any(String),
      });
      const done = run(second.state, pickAttack(1));
      expect(all(done.events, "ATTACK_COPY_RESOLVED")).toEqual([
        {
          type: "ATTACK_COPY_RESOLVED",
          seat: "p1",
          uid: expect.any(String),
          attack: "Haughty Order",
          as: "Smash",
        },
      ]);
      expect(oppActiveDamage(done.state)).toBe(60);
      expect(turnPassed(done.state)).toBe(true);
      expect(
        all([...parked.events, ...second.events, ...done.events], "ATTACK_DECLARED"),
      ).toHaveLength(1);
      expect(done.state.pending).toEqual([]);
      expect(bodyAt(done.state, "p1", "active").usedAttack).toMatchObject({
        name: "Haughty Order",
      });
    });
  }

  it("the log names the reveal and what the attack became", () => {
    const parked = run(stackTop(armed(PERSIAN), "p2", [TARGET], 9), declare(PERSIAN));
    const done = chain(parked.state, [yes, pickAttack(1)]);
    const lines = render([...parked.events, ...done.events], done.state);
    expect(lines).toContain("p1: Team Rocket's Persian ex used Haughty Order");
    expect(lines.some((l) => l.startsWith("p1: revealed the top 10 cards of Tide's deck: "))).toBe(
      true,
    );
    expect(lines).toContain("p1: Team Rocket's Persian ex's Haughty Order became Smash");
  });

  it("the DECLINE: the attack ends having copied nothing — no ATTACK_COPY_RESOLVED, no damage, the turn passes", () => {
    const parked = run(stackTop(armed(PERSIAN), "p2", [TARGET], 9), declare(PERSIAN));
    const { state, events } = run(parked.state, no);
    expect(types(events)).not.toContain("ATTACK_COPY_RESOLVED");
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(oppActiveDamage(state)).toBe(0);
    expect(turnPassed(state)).toBe(true);
    expect(state.pending).toEqual([]);
  });

  it("exactly ONE pair: the confirm, then the pair is taken with no chooseAttack", () => {
    const parked = run(stackTop(armed(PERSIAN), "p2", [SOLO], 9), declare(PERSIAN));
    expect(effectPrompt(parked.state)).toMatchObject({ kind: "confirm" });
    const { state, events } = run(parked.state, yes);
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(all(events, "ATTACK_COPY_RESOLVED")[0]).toMatchObject({ as: "Smash" });
    expect(oppActiveDamage(state)).toBe(60);
  });

  it("R-CP3 — copy-family attacks revealed are never offered (Persian ex's Haughty Order, Slowking's Seek Inspiration); a Rule Box is NOT a bar here", () => {
    const parked = run(
      stackTop(armed(PERSIAN), "p2", [PERSIANS[1], SLOWKING], 8),
      declare(PERSIAN),
    );
    const second = run(parked.state, yes);
    expect(effectPrompt(second.state)).toMatchObject({
      kind: "chooseAttack",
      candidates: [
        { index: 0, name: "Cruel Slash (Team Rocket's Persian ex)" },
        { index: 1, name: "Super Psy Bolt (Slowking)" },
      ],
    });
  });

  it("two copies of one card collapse to one row per attack (D42)", () => {
    const parked = run(stackTop(armed(PERSIAN), "p2", [TARGET, SOLO, TARGET], 7), declare(PERSIAN));
    const second = run(parked.state, yes);
    expect(effectPrompt(second.state)).toMatchObject({
      kind: "chooseAttack",
      candidates: [
        { name: "Poke (D574 Target)" },
        { name: "Smash (D574 Target)" },
        { name: "Smash (D574 Solo)" },
      ],
    });
  });

  it("two PRINTINGS of one card printed alike collapse too — Persian ex sv10-219 + svp-218 offer ONE Cruel Slash row (D42)", () => {
    const parked = run(
      stackTop(armed(PERSIAN), "p2", [PERSIANS[1], PERSIANS[2], SOLO], 7),
      declare(PERSIAN),
    );
    const second = run(parked.state, yes);
    const shown = effectPrompt(second.state);
    expect(shown).toMatchObject({
      kind: "chooseAttack",
      candidates: [
        { index: 0, name: "Cruel Slash (Team Rocket's Persian ex)" },
        { index: 1, name: "Smash (D574 Solo)" },
      ],
    });
    expect(shown?.kind === "chooseAttack" ? shown.candidates.length : -1).toBe(2);
  });

  it("R-CP4 — a revealed attack whose printed gate bars the COPIER now is not offered (the phantom body)", () => {
    // p1 went second and this is its first turn: GATED_TEXT bars the copier.
    const parked = run(stackTop(armed(PERSIAN), "p2", [GATED, SOLO], 8), declare(PERSIAN));
    const { state, events } = run(parked.state, yes);
    expect(all(events, "ATTACK_COPY_RESOLVED")[0]).toMatchObject({ as: "Smash" });
    expect(oppActiveDamage(state)).toBe(60);
    // …and a turn later the gate bars nothing, so both pairs are offered.
    const laterBoard = stackTop(
      attach(later(table(PERSIAN)), "p1", "active", [COLORLESS, COLORLESS]),
      "p2",
      [GATED, SOLO],
      8,
    );
    const second = chain(laterBoard, [declare(PERSIAN), yes]);
    expect(effectPrompt(second.state)).toMatchObject({
      kind: "chooseAttack",
      candidates: [{ name: "Gated Count (D574 Gated)" }, { name: "Smash (D574 Solo)" }],
    });
  });

  it("anti-laundering — a revealed UNBUILT attack copied still reports ITSELF", () => {
    const parked = run(stackTop(armed(PERSIAN), "p2", [UNREAD], 9), declare(PERSIAN));
    const { events } = run(parked.state, yes);
    expect(all(events, "ATTACK_EFFECT_SKIPPED")[0]).toMatchObject({ effect: UNREAD_TEXT });
  });

  it("no Pokémon in the top 10: revealed and shuffled, then the attack ends (no park)", () => {
    const { state, events } = run(stackTop(armed(PERSIAN), "p2", [], 10), declare(PERSIAN));
    expect(types(events)).toContain("DECK_TOP_REVEALED");
    expect(types(events)).toContain("SHUFFLE");
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(turnPassed(state)).toBe(true);
  });

  it("a deck shorter than 10 reveals what it holds; an EMPTY deck reveals nothing and the attack ends", () => {
    const short = stackTop(armed(PERSIAN), "p2", [SOLO], 2);
    const trimmed: GameState = {
      ...short,
      players: {
        ...short.players,
        p2: {
          ...short.players.p2,
          deck: short.players.p2.deck.slice(0, 3),
          discard: [...short.players.p2.discard, ...short.players.p2.deck.slice(3)],
        },
      },
    };
    const parked = run(trimmed, declare(PERSIAN));
    expect(all(parked.events, "DECK_TOP_REVEALED")[0]?.uids).toHaveLength(3);
    expect(effectPrompt(parked.state)).toMatchObject({ kind: "confirm" });
    const empty: GameState = {
      ...trimmed,
      players: {
        ...trimmed.players,
        p2: {
          ...trimmed.players.p2,
          deck: [],
          discard: [...trimmed.players.p2.discard, ...trimmed.players.p2.deck],
        },
      },
    };
    const { state, events } = run(empty, declare(PERSIAN));
    expect(all(events, "DECK_TOP_REVEALED")[0]?.uids).toEqual([]);
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).not.toContain("ATTACK_COPY_RESOLVED");
    // (p2 then cannot draw: the attack ended and the game moved on past it.)
    expect(state.phase.kind).not.toBe("effect:choose");
  });

  it("a CONFUSED tails reveals nothing and shuffles nothing (R-HO2: the coin comes first)", () => {
    const board = stackTop(armed(PERSIAN), "p2", [TARGET], 9);
    const confused = withFaces(
      withBody(board, "p1", "active", (p) => ({
        ...p,
        conditions: { ...p.conditions, rotation: "confused" },
      })),
      ["tails"],
    );
    const { state, events } = run(confused, declare(PERSIAN));
    expect(all(events, "ATTACK_FAILED")[0]).toMatchObject({ reason: "confusion" });
    expect(types(events)).not.toContain("DECK_TOP_REVEALED");
    expect(types(events)).not.toContain("SHUFFLE");
    // The deck is in its printed order but for the card p2 drew to start its turn: no shuffle ran.
    expect(state.players.p2.deck).toEqual(board.players.p2.deck.slice(1));
    // …and on HEADS the reveal follows the coin.
    const heads = run(
      withFaces(
        withBody(board, "p1", "active", (p) => ({
          ...p,
          conditions: { ...p.conditions, rotation: "confused" },
        })),
        ["heads"],
      ),
      declare(PERSIAN),
    );
    expect(types(heads.events).indexOf("CONFUSION_CHECK")).toBeLessThan(
      types(heads.events).indexOf("DECK_TOP_REVEALED"),
    );
  });

  it("a FLIP-LOCK tails reveals nothing either", () => {
    const board = stackTop(armed(PERSIAN), "p2", [TARGET], 9);
    const locked = withFaces(
      withBody(board, "p1", "active", (p) => ({ ...p, attackFlipLockTurn: board.turn })),
      ["tails"],
    );
    const { events } = run(locked, declare(PERSIAN));
    expect(all(events, "ATTACK_FAILED")[0]).toMatchObject({ reason: "flipLock" });
    expect(types(events)).not.toContain("DECK_TOP_REVEALED");
  });

  it("the resumed half flips NO coin again (a Confused copier's heads is not re-flipped at the answer)", () => {
    const board = stackTop(armed(PERSIAN), "p2", [TARGET], 9);
    const confused = withFaces(
      withBody(board, "p1", "active", (p) => ({
        ...p,
        conditions: { ...p.conditions, rotation: "confused" },
      })),
      ["heads", "tails", "tails", "tails"],
    );
    const parked = run(confused, declare(PERSIAN));
    expect(all(parked.events, "CONFUSION_CHECK")).toHaveLength(1);
    const done = chain(parked.state, [yes, pickAttack(1)]);
    expect(all(done.events, "CONFUSION_CHECK")).toHaveLength(0);
    expect(all(done.events, "ATTACK_FAILED")).toHaveLength(0);
    expect(oppActiveDamage(done.state)).toBe(60);
  });

  it("the resumed half flips NO flip-lock coin again (a heads lock is not re-flipped at the answer)", () => {
    const board = stackTop(armed(PERSIAN), "p2", [TARGET], 9);
    const locked = withFaces(
      withBody(board, "p1", "active", (p) => ({ ...p, attackFlipLockTurn: board.turn })),
      ["heads", "tails", "tails", "tails"],
    );
    const parked = run(locked, declare(PERSIAN));
    expect(all(parked.events, "ATTACK_FLIP_LOCK_CHECK")).toHaveLength(1);
    const done = chain(parked.state, [yes, pickAttack(1)]);
    expect(all(done.events, "ATTACK_FLIP_LOCK_CHECK")).toHaveLength(0);
    expect(oppActiveDamage(done.state)).toBe(60);
  });

  it("the answer RE-VALIDATES the SOURCE ZONE: a milled card that has left the discard pile is PHASE_DESYNC", () => {
    const parked = run(stackTop(armed(SLOWKING), "p1", [TARGET]), declare(SLOWKING));
    const side = parked.state.players.p1;
    const milled = side.discard[side.discard.length - 1] ?? "";
    const moved: GameState = {
      ...parked.state,
      players: {
        ...parked.state.players,
        p1: {
          ...side,
          discard: side.discard.filter((u) => u !== milled),
          hand: [...side.hand, milled],
        },
      },
    };
    expect(refused(moved, pickAttack(1)).code).toBe("PHASE_DESYNC");
    expect(run(parked.state, pickAttack(1)).state.phase.kind).not.toBe("effect:choose");
  });

  it("the answer RE-VALIDATES: the copier swapped out is PHASE_DESYNC; an index the prompt did not offer is refused", () => {
    const parked = run(
      stackTop(armed(PERSIAN, [PERSIANS[1]]), "p2", [TARGET], 9),
      declare(PERSIAN),
    );
    const second = run(parked.state, yes);
    expect(refused(second.state, pickAttack(2)).code).toBe("BAD_EFFECT_CHOICE");
    const side = second.state.players.p1;
    const swapped: GameState = {
      ...second.state,
      players: {
        ...second.state.players,
        p1: {
          ...side,
          active: bodyAt(second.state, "p1", 0),
          bench: [bodyAt(second.state, "p1", "active")],
        },
      },
    };
    expect(refused(swapped, pickAttack(1)).code).toBe("PHASE_DESYNC");
  });

  it("Haughty Order reveals a Malamar: Colluding Tentacles reads the COPIER's Xerosic (none → nothing; played → gust + 120)", () => {
    const without = chain(stackTop(armed(PERSIAN, [], FILLER, [SOLO]), "p2", [MALAMAR], 9), [
      declare(PERSIAN),
      yes,
      pickAttack(0),
    ]);
    expect(all(without.events, "ATTACK_COPY_RESOLVED")[0]).toMatchObject({
      as: "Colluding Tentacles",
    });
    expect(types(without.events)).not.toContain("POKEMON_SWITCHED");
    expect(oppActiveDamage(without.state)).toBe(0);
    const withX = chain(
      stackTop(playedXerosic(armed(PERSIAN, [], FILLER, [SOLO])), "p2", [MALAMAR], 9),
      [declare(PERSIAN), yes, pickAttack(0)],
    );
    expect(oppActiveDamage(withX.state)).toBe(120);
    expect(withX.state.players.p2.active?.stack).toEqual(
      expect.arrayContaining([expect.any(String)]),
    );
    expect(withX.state.cardIdByUid[withX.state.players.p2.active?.stack[0] ?? ""]).toBe(SOLO);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D574 §3 — Seek Inspiration: mill 1, no Rule Box, then the copy (forced inline, or parked)", () => {
  it("a NON-Pokémon milled: discarded, nothing copied, the turn passes", () => {
    const { state, events } = run(stackTop(armed(SLOWKING), "p1", [], 1), declare(SLOWKING));
    expect(types(events)).toContain("DECK_TOP_DISCARDED");
    expect(types(events)).not.toContain("ATTACK_COPY_RESOLVED");
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(turnPassed(state)).toBe(true);
  });

  it("a Rule Box Pokémon milled offers nothing (the printed bar); the same body without one would", () => {
    const board = stackTop(armed(SLOWKING), "p1", [TESTMON_EX]);
    const { state, events } = run(board, declare(SLOWKING));
    expect(types(events)).not.toContain("ATTACK_COPY_RESOLVED");
    expect(oppActiveDamage(state)).toBe(0);
    expect(state.players.p1.discard.map((u) => state.cardIdByUid[u])).toContain(TESTMON_EX);
    // …and the SECOND HALF, driven: the same body with the " ex" (the name-encoded Rule Box) dropped
    // is copied — forced inline, its one attack, 90. TEST SURGERY: the milled uid is re-keyed to the
    // twin, which is seated in the game's own pool (`createGame` keeps only the decks' cards).
    const TWIN = "d574t-testmon";
    const ruleBoxed = POOL[TESTMON_EX] as Card;
    const twinCard: Card = { ...ruleBoxed, id: TWIN, name: "D574 Testmon" };
    expect(hasRuleBox(ruleBoxed)).toBe(true);
    expect(hasRuleBox(twinCard)).toBe(false);
    const topUid = board.players.p1.deck[0] as string;
    const twinBoard: GameState = {
      ...board,
      cardPool: { ...board.cardPool, [TWIN]: twinCard },
      cardIdByUid: { ...board.cardIdByUid, [topUid]: TWIN },
    };
    const twin = run(twinBoard, declare(SLOWKING));
    expect(all(twin.events, "ATTACK_COPY_RESOLVED")[0]).toMatchObject({
      attack: "Seek Inspiration",
      as: "Test Blast",
    });
    expect(oppActiveDamage(twin.state)).toBe(90);
  });

  it("ONE usable attack: re-entered INLINE — one result carrying BOTH halves, no park", () => {
    const { state, events } = run(stackTop(armed(SLOWKING), "p1", [SOLO]), declare(SLOWKING));
    expect(types(events).slice(0, 3)).toEqual([
      "ATTACK_DECLARED",
      "DECK_TOP_DISCARDED",
      "ATTACK_COPY_RESOLVED",
    ]);
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
    expect(all(events, "ATTACK_COPY_RESOLVED")[0]).toMatchObject({
      attack: "Seek Inspiration",
      as: "Smash",
    });
    expect(oppActiveDamage(state)).toBe(60);
    expect(turnPassed(state)).toBe(true);
    expect(bodyAt(state, "p1", "active").usedAttack).toMatchObject({ name: "Seek Inspiration" });
  });

  it("R-CP3 — a milled Slowking offers only Super Psy Bolt (Seek Inspiration is a copy): forced, 120", () => {
    const { state, events } = run(stackTop(armed(SLOWKING), "p1", [SLOWKING]), declare(SLOWKING));
    expect(all(events, "ATTACK_COPY_RESOLVED")[0]).toMatchObject({ as: "Super Psy Bolt" });
    expect(oppActiveDamage(state)).toBe(120);
  });

  it("TWO usable attacks: parks chooseAttack, then the pick resolves", () => {
    const parked = run(stackTop(armed(SLOWKING), "p1", [TARGET]), declare(SLOWKING));
    expect(types(parked.events)).toEqual([
      "ATTACK_DECLARED",
      "DECK_TOP_DISCARDED",
      "EFFECT_PENDING",
    ]);
    expect(effectPrompt(parked.state)).toMatchObject({
      kind: "chooseAttack",
      candidates: [
        { index: 0, name: "Poke (D574 Target)" },
        { index: 1, name: "Smash (D574 Target)" },
      ],
    });
    const { state, events } = run(parked.state, pickAttack(0));
    expect(all(events, "ATTACK_COPY_RESOLVED")[0]).toMatchObject({ as: "Poke" });
    expect(oppActiveDamage(state)).toBe(10);
    expect(turnPassed(state)).toBe(true);
    expect(state.pending).toEqual([]);
  });

  it("an EMPTY deck mills nothing and the attack ends", () => {
    const board = armed(SLOWKING);
    const empty: GameState = {
      ...board,
      players: {
        ...board.players,
        p1: {
          ...board.players.p1,
          deck: [],
          discard: [...board.players.p1.discard, ...board.players.p1.deck],
        },
      },
    };
    const { state, events } = run(empty, declare(SLOWKING));
    expect(types(events)).not.toContain("DECK_TOP_DISCARDED");
    expect(turnPassed(state)).toBe(true);
  });

  it("a CONFUSED tails mills nothing", () => {
    const board = stackTop(armed(SLOWKING), "p1", [SOLO]);
    const confused = withFaces(
      withBody(board, "p1", "active", (p) => ({
        ...p,
        conditions: { ...p.conditions, rotation: "confused" },
      })),
      ["tails"],
    );
    const { state, events } = run(confused, declare(SLOWKING));
    expect(types(events)).not.toContain("DECK_TOP_DISCARDED");
    expect(state.players.p1.deck[0]).toBe(board.players.p1.deck[0]);
  });

  it("a copied attack that ITSELF PARKS: a milled Sableye's Damage Collection runs the loop", () => {
    const board = damaged(
      stackTop(armed(SLOWKING, [], FILLER, [SOLO]), "p1", [SABLEYE]),
      "p2",
      0,
      30,
    );
    const parked = run(board, declare(SLOWKING));
    expect(effectPrompt(parked.state)).toMatchObject({
      kind: "chooseAttack",
      candidates: [{ name: "Claw Slash (Sableye)" }, { name: "Damage Collection (Sableye)" }],
    });
    const loop = run(parked.state, pickAttack(1));
    expect(all(loop.events, "ATTACK_COPY_RESOLVED")[0]).toMatchObject({ as: "Damage Collection" });
    expect(effectPrompt(loop.state)).toMatchObject({
      kind: "choosePokemon",
      upTo: 3,
      takeVerb: "move",
      candidates: [p2Ref(0)],
    });
    const { state } = run(loop.state, pickOpp(0, 3));
    expect(oppActiveDamage(state)).toBe(30);
    expect(bodyAt(state, "p2", 0).damage).toBe(0);
    expect(turnPassed(state)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D574 §4 — Malamar Colluding Tentacles (a registry row, R-MA1)", () => {
  it("Xerosic's Machinations NOT played: nothing happens — no gust, no damage, no ATTACK_FAILED, no skip", () => {
    const { state, events } = run(armed(MALAMAR, [], FILLER, [SOLO, TARGET]), declare(MALAMAR));
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).not.toContain("ATTACK_FAILED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(state.cardIdByUid[bodyAt(state, "p2", "active").stack[0] ?? ""]).toBe(FILLER);
    expect(turnPassed(state)).toBe(true);
  });

  it("played, ONE Benched body: forced gust + 120 to the NEW Active, Weakness applied (×2 → 240)", () => {
    const { state, events } = run(
      playedXerosic(armed(MALAMAR, [], FILLER, [WEAK_DARK])),
      declare(MALAMAR),
    );
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(state.cardIdByUid[bodyAt(state, "p2", "active").stack[0] ?? ""]).toBe(WEAK_DARK);
    expect(oppActiveDamage(state)).toBe(240);
    expect(bodyAt(state, "p2", 0).damage).toBe(0);
  });

  it("played, TWO Benched bodies: the gust parks, the pick takes the 120", () => {
    const parked = run(playedXerosic(armed(MALAMAR, [], FILLER, [SOLO, TARGET])), declare(MALAMAR));
    expect(effectPrompt(parked.state)).toMatchObject({
      kind: "choosePokemon",
      candidates: [p2Ref(0), p2Ref(1)],
    });
    const { state } = run(parked.state, pickOpp(1));
    expect(state.cardIdByUid[bodyAt(state, "p2", "active").stack[0] ?? ""]).toBe(TARGET);
    expect(oppActiveDamage(state)).toBe(120);
  });

  it("played, an EMPTY opponent Bench: nothing switches, so nothing is dealt", () => {
    const { state, events } = run(playedXerosic(armed(MALAMAR)), declare(MALAMAR));
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(oppActiveDamage(state)).toBe(0);
  });

  it("Foul Play copying Colluding Tentacles reads the COPIER's seat (site 4 runs the SOURCE card's row)", () => {
    const parked = run(armed(ZOROARK, [], MALAMAR, [SOLO]), declare(ZOROARK));
    const without = run(parked.state, pickAttack(0));
    expect(all(without.events, "ATTACK_DECLARED")[0]).toMatchObject({ as: "Colluding Tentacles" });
    expect(oppActiveDamage(without.state)).toBe(0);
    const parkedX = run(playedXerosic(armed(ZOROARK, [], MALAMAR, [SOLO])), declare(ZOROARK));
    const withX = run(parkedX.state, pickAttack(0));
    expect(withX.state.cardIdByUid[bodyAt(withX.state, "p2", "active").stack[0] ?? ""]).toBe(SOLO);
    expect(oppActiveDamage(withX.state)).toBe(120);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D574 §5 — Sableye and Alakazam: the opponent-to-opponent loop (R-SB1, R-AK1, R-AK2)", () => {
  /** p2: FILLER Active, `bench` with `damage` each. */
  const sableye = (bench: readonly [string, number][]): GameState => {
    let s = armed(
      SABLEYE,
      [],
      FILLER,
      bench.map(([id]) => id),
    );
    bench.forEach(([, dmg], i) => {
      s = damaged(s, "p2", i, dmg);
    });
    return s;
  };

  it("Sableye: Q1 is the source + count (upTo = the budget), the destination is FORCED to the Active (R-SB1)", () => {
    const parked = run(
      sableye([
        [SOLO, 30],
        [TARGET, 0],
        [FRAIL, 20],
      ]),
      declare(SABLEYE),
    );
    // The undamaged body is not a source; the budget is every counter on their Bench (5).
    expect(effectPrompt(parked.state)).toMatchObject({
      kind: "choosePokemon",
      upTo: 5,
      takeVerb: "move",
      candidates: [p2Ref(0), p2Ref(2)],
    });
    const round = run(parked.state, pickOpp(0, 2));
    // No destination question: the move happened, and the next round asks again with the budget spent.
    expect(all(round.events, "COUNTERS_PLACED")).toEqual([
      { type: "COUNTERS_PLACED", seat: "p2", uid: expect.any(String), amount: 20, source: "moved" },
    ]);
    expect(all(round.events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p2", uid: expect.any(String), amount: 20 },
    ]);
    expect(oppActiveDamage(round.state)).toBe(20);
    expect(bodyAt(round.state, "p2", 0).damage).toBe(10);
    expect(effectPrompt(round.state)).toMatchObject({
      kind: "choosePokemon",
      upTo: 3,
      candidates: [p2Ref(0), p2Ref(2)],
    });
    // The DECLINE ends the loop.
    const { state, events } = run(round.state, decline);
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(oppActiveDamage(state)).toBe(20);
    expect(turnPassed(state)).toBe(true);
  });

  it("Sableye: a decline at once moves nothing at all", () => {
    const parked = run(sableye([[SOLO, 30]]), declare(SABLEYE));
    const { state, events } = run(parked.state, decline);
    expect(types(events)).not.toContain("HEALED");
    expect(bodyAt(state, "p2", 0).damage).toBe(30);
    expect(oppActiveDamage(state)).toBe(0);
  });

  it("Sableye: the FULL move — every counter, two rounds, and then the loop ends by itself (budget spent)", () => {
    const parked = run(
      sableye([
        [SOLO, 30],
        [FRAIL, 20],
      ]),
      declare(SABLEYE),
    );
    const r1 = run(parked.state, pickOpp(0, 3));
    const r2 = run(r1.state, pickOpp(1, 2));
    expect(oppActiveDamage(r2.state)).toBe(50);
    expect(bodyAt(r2.state, "p2", 0).damage).toBe(0);
    expect(bodyAt(r2.state, "p2", 1).damage).toBe(0);
    expect(turnPassed(r2.state)).toBe(true);
  });

  it("Sableye: a take larger than the source holds is CLAMPED silently to what it holds", () => {
    const parked = run(
      sableye([
        [SOLO, 10],
        [FRAIL, 20],
      ]),
      declare(SABLEYE),
    );
    const r1 = run(parked.state, pickOpp(0, 3));
    expect(oppActiveDamage(r1.state)).toBe(10);
    expect(effectPrompt(r1.state)).toMatchObject({ upTo: 2, candidates: [p2Ref(1)] });
  });

  it("Sableye: no damaged Benched body — no question at all", () => {
    const { state, events } = run(sableye([[SOLO, 0]]), declare(SABLEYE));
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(turnPassed(state)).toBe(true);
  });

  it("R-AK2 — Sableye into a §11-shielded Active (Mist Energy): no destination, so no source, and ONE refusal row", () => {
    const board = attach(sableye([[SOLO, 30]]), "p2", "active", [MIST]);
    const { state, events } = run(board, declare(SABLEYE));
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(all(events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    expect(bodyAt(state, "p2", 0).damage).toBe(30);
  });

  it("Alakazam: the Confused head FIRST, then Q1 over every damaged body, Q2 over their OTHER bodies", () => {
    const board = damaged(
      damaged(armed(ALAKAZAM, [], FILLER, [SOLO, TARGET]), "p2", "active", 30),
      "p2",
      0,
      10,
    );
    const parked = run(board, declare(ALAKAZAM));
    expect(types(parked.events).indexOf("STATUS_APPLIED")).toBeLessThan(
      types(parked.events).indexOf("EFFECT_PENDING"),
    );
    expect(bodyAt(parked.state, "p2", "active").conditions.rotation).toBe("confused");
    expect(effectPrompt(parked.state)).toMatchObject({
      kind: "choosePokemon",
      upTo: 4,
      candidates: [p2Ref("active"), p2Ref(0)],
    });
    const q2 = run(parked.state, pickOpp("active", 2));
    expect(effectPrompt(q2.state)).toMatchObject({
      kind: "choosePokemon",
      candidates: [p2Ref(0), p2Ref(1)],
    });
    expect(effectPrompt(q2.state)).not.toHaveProperty("upTo");
    const r1 = run(q2.state, pickOpp(1));
    expect(oppActiveDamage(r1.state)).toBe(10);
    expect(bodyAt(r1.state, "p2", 1).damage).toBe(20);
    expect(effectPrompt(r1.state)).toMatchObject({ upTo: 2 });
    const { state } = run(r1.state, decline);
    expect(turnPassed(state)).toBe(true);
  });

  it("R-AK1 — the LOOP BOUND stops an A → B → A cycle: two counters, two rounds, then no third question", () => {
    const board = damaged(armed(ALAKAZAM, [], FILLER, [SOLO]), "p2", "active", 20);
    const parked = run(board, declare(ALAKAZAM));
    expect(effectPrompt(parked.state)).toMatchObject({ upTo: 2, candidates: [p2Ref("active")] });
    // Round 1: Active → the one other body (forced).
    const r1 = run(parked.state, pickOpp("active", 1));
    expect(bodyAt(r1.state, "p2", 0).damage).toBe(10);
    expect(effectPrompt(r1.state)).toMatchObject({
      upTo: 1,
      candidates: [p2Ref("active"), p2Ref(0)],
    });
    // Round 2: back again.
    const r2 = run(r1.state, pickOpp(0, 1));
    expect(oppActiveDamage(r2.state)).toBe(20);
    expect(bodyAt(r2.state, "p2", 0).damage).toBe(0);
    // The budget is spent: the loop ENDS, the attack ends.
    expect(r2.state.phase.kind).not.toBe("effect:choose");
    expect(turnPassed(r2.state)).toBe(true);
  });

  it("R-AK2 — a Bench-shielded body (Curious Tea Party) is neither source nor destination; its refusal is announced ONCE", () => {
    const board = damaged(
      damaged(armed(ALAKAZAM, [], FILLER, [TEAPARTY, SOLO]), "p2", "active", 20),
      "p2",
      0,
      30,
    );
    const parked = run(board, declare(ALAKAZAM));
    expect(all(parked.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    expect(effectPrompt(parked.state)).toMatchObject({ candidates: [p2Ref("active")] });
    const r1 = run(parked.state, pickOpp("active", 1));
    expect(bodyAt(r1.state, "p2", 1).damage).toBe(10);
    expect(bodyAt(r1.state, "p2", 0).damage).toBe(30);
    expect(all(r1.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(0);
  });

  it("R-AK2 — NO counters on their board: a zero budget ends the op BEFORE the shield is asked, so no refusal row for a move that could never happen", () => {
    const board = armed(ALAKAZAM, [], FILLER, [TEAPARTY, SOLO]);
    const { state, events } = run(board, declare(ALAKAZAM));
    expect(bodyAt(state, "p2", "active").conditions.rotation).toBe("confused");
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(all(events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(0);
    expect(turnPassed(state)).toBe(true);
  });

  it("a counter move that reaches HP is a Knock Out BY THE ATTACK: the attacker takes the Prize (the Cofagrigus precedent)", () => {
    const board = damaged(armed(ALAKAZAM, [], FILLER, [FRAIL]), "p2", "active", 60);
    const parked = run(board, declare(ALAKAZAM));
    const frailUid = bodyAt(board, "p2", 0).stack[0];
    const { state, events } = run(parked.state, pickOpp("active", 6));
    expect(all(events, "KNOCKED_OUT").map((e) => e.uid)).toEqual([frailUid]);
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D574 §6 — the parks: wire-legal, serialisable, and INERT under a 0.457 rollback", () => {
  const confirmPark = () => run(stackTop(armed(PERSIAN), "p2", [TARGET], 9), declare(PERSIAN));
  const seekPark = () => run(stackTop(armed(SLOWKING), "p1", [TARGET]), declare(SLOWKING));
  const loopPark = () =>
    run(damaged(armed(SABLEYE, [], FILLER, [SOLO]), "p2", 0, 30), declare(SABLEYE));

  it("every new park is WIRE-legal for the answering seat (confirm, flattened chooseAttack, the loop's Q1)", () => {
    for (const parked of [
      confirmPark().state,
      run(confirmPark().state, yes).state,
      seekPark().state,
      loopPark().state,
    ]) {
      const wire = redactGame(parked, "p1").phase;
      if (wire.kind !== "effect:choose") throw new Error("expected effect:choose");
      expect(() => redactedEffectPromptSchema.parse(wire.prompt)).not.toThrow();
    }
  });

  it("a JSON round-trip of each parked state resolves identically", () => {
    for (const [parked, action] of [
      [run(confirmPark().state, yes).state, pickAttack(1)],
      [seekPark().state, pickAttack(1)],
      [loopPark().state, pickOpp(0, 2)],
    ] as const) {
      const revived = roundTrip(parked);
      const direct = run(parked, action);
      const viaJson = run(revived, action);
      expect(JSON.stringify(viaJson.state)).toBe(JSON.stringify(direct.state));
      expect(viaJson.events).toEqual(direct.events);
    }
  });

  /** The 0.457 reading of a parked answer: no route (cardplay.ts), `applyChoice`'s default, no
      `continuationOps` member — modelled by an op NAME 0.457 does not know — then `settleProgram`. */
  function rolledBack(parked: GameState, choice: EffectChoice, rename = false) {
    const phase = parked.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const cont = rename
      ? { ...phase.cont, pendingOp: { op: "unknownTo0457" } as unknown as EffectOp }
      : phase.cont;
    const events: GameEvent[] = [];
    const rolled = settleProgram(
      resumeProgram(parked, cont, choice, events),
      phase.seat,
      {
        resumeTail: phase.resumeTail === true,
        endsTurn: phase.endsTurn === true,
      },
      events,
    );
    if (!rolled.ok) throw new Error("the rollback reading failed");
    return rolled;
  }

  it("Haughty Order's park under 0.457 is an INERT whiff — the decline's board exactly, never PHASE_DESYNC", () => {
    const parked = confirmPark().state;
    const phase = parked.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect((phase.cont.pendingOp as EffectOp).op).toBe("useFoundAttackAs");
    const rolled = rolledBack(parked, { kind: "confirm", yes: true });
    const declined = run(parked, no);
    expect(JSON.stringify(rolled.state)).toBe(JSON.stringify(declined.state));
    expect(types(rolled.events)).not.toContain("ATTACK_COPY_RESOLVED");
    expect(types(rolled.events)).not.toContain("DAMAGE_DEALT");
    expect(turnPassed(rolled.state)).toBe(true);
    expect(rolled.state.pending).toEqual([]);
    // …and the chooseAttack park after a "yes" reads the same.
    const accepted = run(parked, yes).state;
    const rolled2 = rolledBack(accepted, { kind: "attack", index: 1 });
    expect(JSON.stringify(rolled2.state)).toBe(JSON.stringify(declined.state));
  });

  it("Seek Inspiration's park under 0.457 is an INERT whiff — the milled card stays milled, nothing is copied", () => {
    const parked = seekPark().state;
    const rolled = rolledBack(parked, { kind: "attack", index: 1 });
    expect(types(rolled.events)).not.toContain("ATTACK_COPY_RESOLVED");
    expect(oppActiveDamage(rolled.state)).toBe(0);
    expect(turnPassed(rolled.state)).toBe(true);
    expect(JSON.stringify(inPlay(rolled.state, "p2"))).toBe(JSON.stringify(inPlay(parked, "p2")));
    expect(bodyAt(rolled.state, "p1", "active").usedAttack).toMatchObject({
      name: "Seek Inspiration",
    });
  });

  it("the loop's park under 0.457 (an op name it does not know) moves NOTHING and ends the attack", () => {
    const parked = loopPark().state;
    const rolled = rolledBack(parked, { kind: "pokemon", ref: p2Ref(0), take: 2 }, true);
    expect(types(rolled.events)).not.toContain("COUNTERS_PLACED");
    expect(types(rolled.events)).not.toContain("HEALED");
    expect(JSON.stringify(inPlay(rolled.state, "p2"))).toBe(JSON.stringify(inPlay(parked, "p2")));
    expect(turnPassed(rolled.state)).toBe(true);
  });
});
