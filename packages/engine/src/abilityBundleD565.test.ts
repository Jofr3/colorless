import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { abilityUsedKey } from "./cardplay";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { type EffectContext, runProgram } from "./interpreter";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { redactGame } from "./redact";
import { programFor, registryCardIds } from "./registry";
import { FIXTURE_POOL, battler, benchFromDeck, clearBench, deckOf, setActiveFromDeck, trainerCard, typedEnergy } from "./testFixtures";
import type { InPlayPokemon } from "./types";

// ── 🆕🆕🆕 D565 — FOUR ABILITIES (and Ruffian, in `ruffianD565.test.ts`) ──
//
//   Misty's Psyduck        sv10-045 / sv10-193  "Flustered Leap"    — on the Bench: mill the BOTTOM card; if you
//                                                                      did, attachments discarded, self on deck TOP
//   Team Rocket's Orbeetle sv10-089 / sv10-198  "Rocket Brain"      — as often as you like: 1 counter from a Team
//                                                                      Rocket's Pokémon to another of your Pokémon
//   Farfetch'd             sv06-132             "Impromptu Carrier" — played to the Bench: search a Tool, attach it
//   Palafin                sv06-060             "Zero to Hero"      — Active → Bench, once per turn: switch in a
//                                                                      Palafin ex from the deck, IN PLACE
//
// Every card is driven end-to-end on its REAL id on a LOCAL `cardPool` (D275) in the suite's OWN
// deck (D270). Texts, stats and legality off tcgdex (the audit's card JSON), 2026-09-28. Readings
// R-FL, R-IC1, R-IC2, R-ZH1, R-ZH2: docs/decisions.md D565.

const PSYDUCK = ["sv10-045", "sv10-193"] as const;
const ORBEETLE = ["sv10-089", "sv10-198"] as const;
const FARFETCHD = "sv06-132";
const PALAFIN = "sv06-060";
const PALAFIN_EX = ["svp-126", "sv06-061", "sv06-193", "sv08.5-151"] as const;
const FINIZEN = "d565t-finizen";
const TR_MON = "d565t-tr-mon";
const FILLER = "d565t-filler";
const FRAIL = "d565t-frail";
const SWITCH = "sv01-194";
const BOSS = "sv02-172";
const SCRAMBLE = "sv08-186";
const JELLICENT_EX = "sv10.5w-045";
const VITALITY_BAND = "sv01-197";
const UNSIMULATED_TOOL = "fix-tool";
const SPECIAL = "fix-special";
const WATER = "fix-water-energy";
const PSYCHIC = "d565t-psychic-energy";
const COLORLESS = "fix-energy";

const FLUSTERED_LEAP =
  "Once during your turn, if this Pokémon is on your Bench, you may discard the bottom card of your deck. If you do, discard all cards from this Pokémon and put this Pokémon on top of your deck.";
const ROCKET_BRAIN =
  "As often as you like during your turn, you may move 1 damage counter from 1 of your Team Rocket's Pokémon to another of your Pokémon.";
const IMPROMPTU_CARRIER =
  "When you play this Pokémon from your hand onto your Bench during your turn, you may search your deck for a Pokémon Tool card and attach it to this Pokémon. Then, shuffle your deck.";
const ZERO_TO_HERO =
  "Once during your turn, when this Pokémon moves from the Active Spot to the Bench, you may search your deck for a Palafin ex and switch it with this Pokémon. Any attached cards, damage counters, Special Conditions, turns in play, and any other effects remain on the new Pokémon. If you switched a Pokémon in this way, put this card into your deck. Then, shuffle your deck.";
const HEROS_SPIRIT = "Put this Pokémon into play only with the effect of Palafin's Zero to Hero Ability.";
const PSYCHIC_TEXT = "This attack does 40 more damage for each Energy attached to your opponent's Active Pokémon.";
const MACH_CUT_TEXT = "Discard a Special Energy from your opponent's Active Pokémon.";

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(
    PSYDUCK.map((id) => [
      id,
      battler(id, {
        name: "Misty's Psyduck",
        types: ["Water"],
        hp: 70,
        retreat: 1,
        weaknesses: [{ type: "Lightning", value: "×2" }],
        abilities: [{ type: "Ability", name: "Flustered Leap", effect: FLUSTERED_LEAP }],
        attacks: [{ cost: ["Water"], name: "Sprinkle Water", damage: 30 }],
      }),
    ]),
  ),
  ...Object.fromEntries(
    ORBEETLE.map((id) => [
      id,
      battler(id, {
        name: "Team Rocket's Orbeetle",
        stage: "Stage2",
        evolveFrom: "Team Rocket's Dottler",
        types: ["Psychic"],
        hp: 130,
        retreat: 2,
        weaknesses: [{ type: "Darkness", value: "×2" }],
        resistances: [{ type: "Fighting", value: "-30" }],
        abilities: [{ type: "Ability", name: "Rocket Brain", effect: ROCKET_BRAIN }],
        attacks: [{ cost: ["Psychic", "Colorless", "Colorless"], name: "Psychic", damage: "40+", effect: PSYCHIC_TEXT }],
      }),
    ]),
  ),
  [FARFETCHD]: battler(FARFETCHD, {
    name: "Farfetch'd",
    types: ["Colorless"],
    hp: 70,
    retreat: 1,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    abilities: [{ type: "Ability", name: "Impromptu Carrier", effect: IMPROMPTU_CARRIER }],
    attacks: [{ cost: ["Colorless"], name: "Mach Cut", damage: 30, effect: MACH_CUT_TEXT }],
  }),
  [PALAFIN]: battler(PALAFIN, {
    name: "Palafin",
    stage: "Stage1",
    evolveFrom: "Finizen",
    types: ["Water"],
    hp: 100,
    retreat: 1,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    abilities: [{ type: "Ability", name: "Zero to Hero", effect: ZERO_TO_HERO }],
    attacks: [{ cost: ["Water", "Colorless"], name: "Wave Splash", damage: 30 }],
  }),
  ...Object.fromEntries(
    PALAFIN_EX.map((id) => [
      id,
      battler(id, {
        name: "Palafin ex",
        stage: "Stage1",
        evolveFrom: "Finizen",
        types: ["Water"],
        hp: 340,
        retreat: 2,
        weaknesses: [{ type: "Lightning", value: "×2" }],
        abilities: [{ type: "Ability", name: "Hero's Spirit", effect: HEROS_SPIRIT }],
        attacks: [
          { cost: ["Water"], name: "Giga Impact", damage: 250, effect: "During your next turn, this Pokémon can't attack." },
        ],
      }),
    ]),
  ),
  [FINIZEN]: battler(FINIZEN, { name: "Finizen", types: ["Water"], hp: 60, retreat: 1 }),
  [TR_MON]: battler(TR_MON, { name: "Team Rocket's Fixmon", hp: 100, retreat: 1, types: ["Colorless"] }),
  [FILLER]: battler(FILLER, {
    name: "D565 Filler",
    hp: 900,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  [FRAIL]: battler(FRAIL, { name: "D565 Frail", hp: 30, retreat: 1, types: ["Colorless"] }),
  [SCRAMBLE]: {
    ...trainerCard(
      SCRAMBLE,
      "Item",
      "Switch your Active Pokémon with 1 of your Benched Pokémon. If you do, you may move any amount of Energy from the Pokémon you moved to your Bench to the new Active Pokémon.",
    ),
    name: "Scramble Switch",
  },
  [SWITCH]: { ...trainerCard(SWITCH, "Item", "Switch your Active Pokémon with 1 of your Benched Pokémon."), name: "Switch" },
  [BOSS]: {
    ...trainerCard(BOSS, "Supporter", "Switch in 1 of your opponent's Benched Pokémon to the Active Spot."),
    name: "Boss's Orders",
  },
  [JELLICENT_EX]: battler(JELLICENT_EX, {
    name: "Jellicent ex",
    stage: "Stage1",
    evolveFrom: "Frillish",
    types: ["Psychic"],
    hp: 260,
    abilities: [
      {
        type: "Ability",
        name: "Oceanic Curse",
        effect:
          "As long as this Pokémon is in the Active Spot, your opponent can't play any Item cards or Pokémon Tool cards from their hand.",
      },
    ],
  }),
  [PSYCHIC]: typedEnergy(PSYCHIC, "Psychic"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [PSYDUCK[0]]: 2,
  [PSYDUCK[1]]: 1,
  [ORBEETLE[0]]: 1,
  [ORBEETLE[1]]: 1,
  [FARFETCHD]: 2,
  [PALAFIN]: 2,
  [PALAFIN_EX[0]]: 1,
  [PALAFIN_EX[1]]: 1,
  [FINIZEN]: 2,
  [TR_MON]: 3,
  [FRAIL]: 1,
  [SWITCH]: 3,
  [BOSS]: 1,
  [SCRAMBLE]: 1,
  [JELLICENT_EX]: 1,
  [VITALITY_BAND]: 2,
  [UNSIMULATED_TOOL]: 2,
  [SPECIAL]: 2,
  [WATER]: 6,
  [PSYCHIC]: 3,
  [FILLER]: 14,
  [COLORLESS]: 8,
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

/** TEST SURGERY — every uid of `seat`'s hand and prizes back into the deck (so every copy is
    reachable by the deck surgeries), the hand then EXACTLY `ids` (one card per entry). */
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

/** TEST SURGERY — one copy of `id` into `seat`'s DECK (from the hand, or swapped out of the
    Prizes for a deck card that is not `id`). Every uid stays in exactly one zone. */
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

/** p1's turn 2: p1 `active` + `bench`, p2 `oppActive`. Hands emptied into the decks. */
function table(active: string, bench: readonly string[] = [], oppActive: string = FILLER, seed = 5651): GameState {
  let state = setHand(setHand(opened(seed), "p1", []), "p2", []);
  state = setActiveFromDeck(ensureInDeck(state, "p1", active), "p1", active);
  state = setActiveFromDeck(ensureInDeck(state, "p2", oppActive), "p2", oppActive);
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of bench) state = benchFromDeck(ensureInDeck(state, "p1", id), "p1", id);
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
  let next = ensureInDeck(state, seat, id);
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

/** TEST SURGERY — one deck copy of `id` to the BOTTOM of `seat`'s deck. */
function toBottom(state: GameState, seat: Seat, id: string): GameState {
  const next = ensureInDeck(state, seat, id);
  const side = next.players[seat];
  const uid = side.deck.find((u) => next.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`no ${id}`);
  return {
    ...next,
    players: { ...next.players, [seat]: { ...side, deck: [...side.deck.filter((u) => u !== uid), uid] } },
  };
}

/** TEST SURGERY — every copy of `id` out of `seat`'s deck into its discard pile. */
function purge(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  const gone = side.deck.filter((u) => state.cardIdByUid[u] === id);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, deck: side.deck.filter((u) => !gone.includes(u)), discard: [...side.discard, ...gone] },
    },
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

const use = (name: string, target: { spot: "active" } | { spot: "bench"; index: number }): GameAction =>
  ({ type: "useAbility", seat: "p1", target, abilityName: name }) as GameAction;
const bench = (index: number) => ({ spot: "bench" as const, index });
const ACTIVE = { spot: "active" as const };
const pick = (ref: { seat: Seat; spot: { spot: "active" } | { spot: "bench"; index: number } }): GameAction =>
  ({ type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } }) as GameAction;
const cards = (uids: string[], seat: Seat = "p1"): GameAction =>
  ({ type: "resolveEffect", seat, choice: { kind: "cards", uids } }) as GameAction;

function prompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return state.phase.prompt;
}

/** p1 plays the Item/Supporter `id` from a hand that holds exactly it. */
function playFromHand(state: GameState, id: string): { state: GameState; events: GameEvent[] } {
  const before = setHand(state, "p1", [id]);
  const uid = before.players.p1.hand[0] as string;
  return run(before, { type: "playTrainer", seat: "p1", uid });
}

// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — the prints and the registry rows", () => {
  it("Flustered Leap: benchOnly, the bottom mill filing `moved`, the gate, the deck-TOP return", () => {
    const first = programFor(PSYDUCK[0]);
    expect(first).toEqual({
      abilities: [
        {
          name: "Flustered Leap",
          oncePerTurn: true,
          activeOnly: false,
          benchOnly: true,
          program: [
            { op: "discardDeckBottom", count: 1, recordAs: "moved" },
            {
              op: "recordGate",
              slot: "moved",
              // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
              then: [{ op: "returnSelf", dest: "deckTop", attachmentsTo: "discard" }],
            },
          ],
        },
      ],
    });
    expect(programFor(PSYDUCK[1])).toBe(first);
  });

  it("Rocket Brain: as often as you like (`oncePerTurn: false`), the owner-narrowed one-counter move", () => {
    const first = programFor(ORBEETLE[0]);
    expect(first).toEqual({
      abilities: [
        {
          name: "Rocket Brain",
          oncePerTurn: false,
          activeOnly: false,
          program: [{ op: "moveCounterOwnChosen", ownerPokemon: "Team Rocket" }],
        },
      ],
    });
    expect(programFor(ORBEETLE[1])).toBe(first);
  });

  it("Impromptu Carrier: an `onPlayToBench` Tool search that ATTACHES to itself, then the shuffle", () => {
    expect(programFor(FARFETCHD)).toEqual({
      triggered: [
        {
          name: "Impromptu Carrier",
          trigger: "onPlayToBench",
          optional: true,
          program: [
            { op: "searchDeck", filter: { kind: "toolCard" }, dest: "attachToSelf", max: 1 },
            { op: "shuffleDeck" },
          ],
        },
      ],
    });
  });

  it("Zero to Hero: the Active→Bench SELF trigger, once per turn, the non-parking swap", () => {
    expect(programFor(PALAFIN)).toEqual({
      triggered: [
        {
          name: "Zero to Hero",
          trigger: "onActiveMovedToBench",
          optional: true,
          oncePerTurn: true,
          program: [{ op: "switchWithDeckNamed", name: "Palafin ex" }],
        },
      ],
    });
  });

  it("no row authors an `attack` key — Sprinkle Water, Psychic, Mach Cut and Wave Splash derive", () => {
    for (const id of [...PSYDUCK, ...ORBEETLE, FARFETCHD, PALAFIN]) {
      expect(Object.keys(programFor(id) ?? {}), id).not.toContain("attack");
    }
  });

  it("🛑 `benchOnly` is carried by exactly Flustered Leap's two ids, and NO row pairs it with `activeOnly`", () => {
    const benchOnly: string[] = [];
    for (const id of registryCardIds()) {
      for (const ability of programFor(id)?.abilities ?? []) {
        if (ability.benchOnly === true) benchOnly.push(id);
        // Unsatisfiable: no spot is both. A row with both could never be used.
        expect(ability.activeOnly && ability.benchOnly === true, id).toBe(false);
      }
    }
    expect(benchOnly.sort()).toEqual([...PSYDUCK].sort());
  });

  it("the TRIGGERED `oncePerTurn` is carried by Zero to Hero alone", () => {
    const locked = registryCardIds().filter((id) => (programFor(id)?.triggered ?? []).some((t) => t.oncePerTurn === true));
    expect(locked).toEqual([PALAFIN]);
  });

  it("`abilityUsedKey` keys a TRIGGERED row exactly as an activated one — `${uid}:${name}`", () => {
    const zero = (programFor(PALAFIN)?.triggered ?? [])[0];
    if (zero === undefined) throw new Error("no trigger");
    expect(abilityUsedKey("p1#7", zero)).toBe("p1#7:Zero to Hero");
  });

  it("the engine is 0.469.0", () => {
    expect(engineVersion).toBe("0.469.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§2 — Misty's Psyduck \"Flustered Leap\" (benchOnly, bottom mill, deck TOP)", () => {
  function leapBoard(): GameState {
    let state = table(FILLER, [PSYDUCK[0]]);
    state = attach(state, "p1", 0, WATER, 1);
    state = attach(state, "p1", 0, VITALITY_BAND, 1, "tools");
    return toBottom(state, "p1", COLORLESS);
  }

  it("🛑 from the Bench: the bottom card is discarded, the attachments are discarded, the Psyduck goes on TOP", () => {
    const before = leapBoard();
    const psyduck = top(bodyAt(before, "p1", 0));
    const attached = [...bodyAt(before, "p1", 0).energy, ...bodyAt(before, "p1", 0).tools];
    const bottom = before.players.p1.deck.at(-1) as string;
    const { state, events } = run(before, use("Flustered Leap", bench(0)));
    expect(state.players.p1.bench).toHaveLength(0);
    expect(state.players.p1.deck[0]).toBe(psyduck);
    expect(state.players.p1.deck).not.toContain(bottom);
    expect(state.players.p1.deck).toHaveLength(before.players.p1.deck.length); // −1 bottom, +1 Psyduck
    expect(state.players.p1.discard).toEqual([...before.players.p1.discard, bottom, ...attached]);
    expect(all(events, "DECK_BOTTOM_DISCARDED")).toEqual([{ type: "DECK_BOTTOM_DISCARDED", seat: "p1", uids: [bottom] }]);
    expect(all(events, "POKEMON_RETURNED")).toEqual([
      {
        type: "POKEMON_RETURNED",
        seat: "p1",
        uid: psyduck,
        actor: "p1",
        dest: "deckTop",
        uids: [psyduck, ...attached],
        attachmentsTo: { dest: "discard", uids: attached },
      },
    ]);
  });

  it("🛑 \"on top of\" is a POSITION: no SHUFFLE row and the RNG does not move", () => {
    const before = leapBoard();
    const { state, events } = run(before, use("Flustered Leap", bench(0)));
    expect(all(events, "SHUFFLE")).toHaveLength(0);
    expect(state.rngState).toEqual(before.rngState);
    // The rest of the deck keeps its order under the Psyduck.
    expect(state.players.p1.deck.slice(1)).toEqual(before.players.p1.deck.slice(0, -1));
  });

  it("the log reads the bottom and the top", () => {
    const before = leapBoard();
    const { state, events } = run(before, use("Flustered Leap", bench(0)));
    const rows = render(events, state);
    expect(rows).toContain("p1: discarded 1 card from the bottom of their deck");
    expect(rows).toContain("p1: put Misty's Psyduck on top of Ember's deck and discarded 2 attached cards");
  });

  it("🛑 from the Active Spot it is REFUSED `ABILITY_BENCH_ONLY` — the mirror of `activeOnly`", () => {
    const state = table(PSYDUCK[1]);
    expect(refused(state, use("Flustered Leap", ACTIVE))).toEqual({
      code: "ABILITY_BENCH_ONLY",
      message: "Flustered Leap can only be used from the Bench (§9)",
    });
  });

  it("🛑 the online HUD: the benched row is lit, the Active row is greyed", () => {
    const state = table(PSYDUCK[0], [PSYDUCK[1]]);
    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    const rows = phase.abilities.filter((a) => a.abilityName === "Flustered Leap");
    expect(rows.map((r) => [r.target, r.disabled])).toEqual([
      [{ spot: "active" }, true],
      [{ spot: "bench", index: 0 }, false],
    ]);
  });

  it("R-FL: an EMPTY deck mills nothing — the gate closes and nothing else happens, the use is spent", () => {
    let state = leapBoard();
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, deck: [], discard: [...state.players.p1.discard, ...state.players.p1.deck] } } };
    const psyduck = top(bodyAt(state, "p1", 0));
    const { state: after, events } = run(state, use("Flustered Leap", bench(0)));
    expect(top(bodyAt(after, "p1", 0))).toBe(psyduck);
    expect(bodyAt(after, "p1", 0).energy).toHaveLength(1);
    expect(all(events, "DECK_BOTTOM_DISCARDED")).toHaveLength(0);
    expect(all(events, "POKEMON_RETURNED")).toHaveLength(0);
    expect(refused(after, use("Flustered Leap", bench(0))).code).toBe("ABILITY_ALREADY_USED");
  });

  it("R-FL (UNRULED half): the SAME card replayed later in the turn stays locked by its `${uid}:Flustered Leap` key", () => {
    // ⚠️ UNRULED, pinned as what the engine DOES and not as what the rules say. The
    // uid-keyed lock is older than D565 and serves every Ability; Flustered Leap is the
    // first card that makes this board easy to reach. Common TCG practice treats a card
    // that left play and came back as a NEW Pokémon whose "Once during your turn" may be
    // used again (the reason Crobat V prints its own "more than 1 Dark Asset" clause) —
    // recalled, not quoted. If a ruling confirms that, this rung flips to "usable".
    const { state: leapt } = run(leapBoard(), use("Flustered Leap", bench(0)));
    const psyduck = leapt.players.p1.deck[0] as string;
    // Draw it (surgery: the top card into the hand) and play it back onto the Bench.
    const drawn = {
      ...leapt,
      players: { ...leapt.players, p1: { ...leapt.players.p1, deck: leapt.players.p1.deck.slice(1), hand: [psyduck] } },
    };
    const { state: replayed } = run(drawn, { type: "playBasicToBench", seat: "p1", uid: psyduck });
    expect(top(bodyAt(replayed, "p1", 0))).toBe(psyduck);
    expect(refused(replayed, use("Flustered Leap", bench(0))).code).toBe("ABILITY_ALREADY_USED");
  });

  it("the lock is PER BODY: a second benched Psyduck still leaps", () => {
    let state = table(FILLER, [PSYDUCK[0], PSYDUCK[1]]);
    state = run(state, use("Flustered Leap", bench(0))).state;
    const { state: after } = run(state, use("Flustered Leap", bench(0)));
    expect(after.players.p1.bench).toHaveLength(0);
  });

  it("Sprinkle Water still derives: 30 to the opponent's Active", () => {
    let state = table(PSYDUCK[0]);
    state = attach(state, "p1", "active", WATER, 1);
    const { state: after } = run(state, { type: "attack", seat: "p1", index: 0 });
    expect(bodyAt(after, "p2", "active").damage).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§3 — Team Rocket's Orbeetle \"Rocket Brain\" (one counter, own → own)", () => {
  it("🛑 both questions forced: the damaged Orbeetle gives ONE counter to the one other body", () => {
    const state = damaged(table(ORBEETLE[0], [FILLER]), "p1", "active", 30);
    const orbeetle = top(bodyAt(state, "p1", "active"));
    const filler = top(bodyAt(state, "p1", 0));
    const { state: after, events } = run(state, use("Rocket Brain", ACTIVE));
    expect(after.phase.kind).toBe("turn:action");
    expect(bodyAt(after, "p1", "active").damage).toBe(20);
    expect(bodyAt(after, "p1", 0).damage).toBe(10);
    expect(all(events, "HEALED")).toEqual([{ type: "HEALED", seat: "p1", uid: orbeetle, amount: 10 }]);
    expect(all(events, "COUNTERS_PLACED")).toEqual([
      { type: "COUNTERS_PLACED", seat: "p1", uid: filler, amount: 10, source: "moved" },
    ]);
  });

  it("🛑 AS OFTEN AS YOU LIKE: three uses in one turn move three counters", () => {
    let state = damaged(table(ORBEETLE[0], [FILLER]), "p1", "active", 30);
    for (let i = 0; i < 3; i++) state = run(state, use("Rocket Brain", ACTIVE)).state;
    expect(bodyAt(state, "p1", "active").damage).toBe(0);
    expect(bodyAt(state, "p1", 0).damage).toBe(30);
    // …and a fourth has nothing left to move: refused, not a silent no-op.
    expect(refused(state, use("Rocket Brain", ACTIVE)).code).toBe("NO_LEGAL_TARGET");
  });

  it("🛑 the SOURCE must be a Team Rocket's Pokémon: a damaged non-Team-Rocket body is never offered", () => {
    const state = damaged(damaged(table(ORBEETLE[0], [FILLER, TR_MON]), "p1", 0, 50), "p1", 1, 20);
    const { state: after } = run(state, use("Rocket Brain", ACTIVE));
    // One damaged TR body (the Fixmon on Bench 1) — forced; two destinations — parked.
    const p = prompt(after);
    if (p.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(p.note).toBe("Move the damage counter onto which of your Pokémon?");
    expect(p.candidates).toEqual([
      { seat: "p1", spot: { spot: "active" } },
      { seat: "p1", spot: { spot: "bench", index: 0 } },
    ]);
    const done = run(after, pick({ seat: "p1", spot: { spot: "active" } })).state;
    expect(bodyAt(done, "p1", 1).damage).toBe(10);
    expect(bodyAt(done, "p1", 0).damage).toBe(50);
    expect(bodyAt(done, "p1", "active").damage).toBe(10);
  });

  it("refused when no Team Rocket's body carries damage, and when there is no OTHER body", () => {
    const undamaged = damaged(table(ORBEETLE[0], [FILLER]), "p1", 0, 50);
    expect(refused(undamaged, use("Rocket Brain", ACTIVE)).code).toBe("NO_LEGAL_TARGET");
    const alone = damaged(table(ORBEETLE[0]), "p1", "active", 30);
    expect(refused(alone, use("Rocket Brain", ACTIVE)).code).toBe("NO_LEGAL_TARGET");
  });

  it("🛑 TWO damaged sources: question 1 parks, its answer buys question 2, the second answer moves", () => {
    const state = damaged(damaged(table(ORBEETLE[0], [TR_MON, FILLER]), "p1", "active", 30), "p1", 0, 20);
    const first = run(state, use("Rocket Brain", ACTIVE)).state;
    const p1 = prompt(first);
    if (p1.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(p1.note).toBe(
      "Move 1 damage counter off which of your Team Rocket's Pokémon? You will then choose where it goes.",
    );
    expect(p1.candidates).toEqual([
      { seat: "p1", spot: { spot: "active" } },
      { seat: "p1", spot: { spot: "bench", index: 0 } },
    ]);
    const second = run(first, pick({ seat: "p1", spot: { spot: "bench", index: 0 } })).state;
    const p2 = prompt(second);
    if (p2.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    // "another of your Pokémon": the source is never a destination.
    expect(p2.candidates).toEqual([
      { seat: "p1", spot: { spot: "active" } },
      { seat: "p1", spot: { spot: "bench", index: 1 } },
    ]);
    const done = run(second, pick({ seat: "p1", spot: { spot: "bench", index: 1 } })).state;
    expect(done.phase.kind).toBe("turn:action");
    expect(bodyAt(done, "p1", 0).damage).toBe(10);
    expect(bodyAt(done, "p1", 1).damage).toBe(10);
    expect(bodyAt(done, "p1", "active").damage).toBe(30);
  });

  it("the Orbeetle need not be the source — a benched, undamaged Orbeetle moves another body's counter", () => {
    const state = damaged(table(TR_MON, [ORBEETLE[1]]), "p1", "active", 40);
    const { state: after } = run(state, use("Rocket Brain", bench(0)));
    expect(bodyAt(after, "p1", "active").damage).toBe(30);
    expect(bodyAt(after, "p1", 0).damage).toBe(10);
  });

  it("🛑 a LETHAL move is swept mid-turn and the Prize goes to the OPPONENT", () => {
    const start = damaged(damaged(table(ORBEETLE[0], [FRAIL]), "p1", "active", 30), "p1", 0, 20);
    const frail = top(bodyAt(start, "p1", 0));
    const p1Prizes = start.players.p1.prizes.length;
    const p2Prizes = start.players.p2.prizes.length;
    const { state, events } = run(start, use("Rocket Brain", ACTIVE));
    expect(all(events, "KNOCKED_OUT").map((e) => e.uid)).toEqual([frail]);
    expect(state.players.p1.discard).toContain(frail);
    expect(state.players.p1.bench).toHaveLength(0);
    expect(state.players.p1.prizes.length).toBe(p1Prizes);
    const p2Took =
      state.players.p2.prizes.length < p2Prizes || (state.phase.kind === "ko:takePrizes" && state.phase.seat === "p2");
    expect(p2Took).toBe(true);
  });

  it("the online HUD lights the row on a legal board and greys it on an illegal one", () => {
    const lit = damaged(table(ORBEETLE[0], [FILLER]), "p1", "active", 30);
    const greyed = table(ORBEETLE[0], [FILLER]);
    for (const [state, disabled] of [
      [lit, false],
      [greyed, true],
    ] as const) {
      const phase = redactGame(state, "p1").phase;
      if (phase.kind !== "turn:action") throw new Error("expected turn:action");
      expect(phase.abilities.find((a) => a.abilityName === "Rocket Brain")?.disabled).toBe(disabled);
    }
  });

  it("Psychic still derives: 40 + 40 for each Energy on the opponent's Active", () => {
    let state = table(ORBEETLE[0]);
    state = attach(state, "p1", "active", PSYCHIC, 1);
    state = attach(state, "p1", "active", COLORLESS, 2);
    state = attach(state, "p2", "active", COLORLESS, 2);
    const { state: after } = run(state, { type: "attack", seat: "p1", index: 0 });
    expect(bodyAt(after, "p2", "active").damage).toBe(120);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§4 — Farfetch'd \"Impromptu Carrier\" (a searched Tool attached to itself)", () => {
  function played(state: GameState): { state: GameState; events: GameEvent[]; uid: string } {
    const before = setHand(state, "p1", [FARFETCHD]);
    const uid = before.players.p1.hand[0] as string;
    return { uid, ...run(before, { type: "playBasicToBench", seat: "p1", uid }) };
  }

  it("🛑 playing it to the Bench parks the search: dest `attach`, the printed note, SIMULATED Tools only (R-IC1)", () => {
    const board = ensureInDeck(ensureInDeck(table(FILLER), "p1", VITALITY_BAND), "p1", UNSIMULATED_TOOL);
    const { state } = played(board);
    const p = prompt(state);
    if (p.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(p.dest).toBe("attach");
    expect(p.min).toBe(0);
    expect(p.max).toBe(1);
    expect(p.note).toBe("Search your deck for a Pokémon Tool card and attach it to this Pokémon.");
    const offered = new Set(p.candidates.map((u) => state.cardIdByUid[u]));
    expect(offered.has(VITALITY_BAND)).toBe(true);
    expect(offered.has(UNSIMULATED_TOOL)).toBe(false);
  });

  it("🛑 the answer attaches the Tool to the Farfetch'd, files TOOL_ATTACHED and then shuffles", () => {
    const board = ensureInDeck(table(FILLER), "p1", VITALITY_BAND);
    const { state, uid } = played(board);
    const p = prompt(state);
    if (p.kind !== "chooseCards") throw new Error("expected chooseCards");
    const band = p.candidates.find((u) => state.cardIdByUid[u] === VITALITY_BAND) as string;
    const { state: after, events } = run(state, cards([band]));
    expect(after.phase.kind).toBe("turn:action");
    expect(top(bodyAt(after, "p1", 0))).toBe(uid);
    expect(bodyAt(after, "p1", 0).tools).toEqual([band]);
    expect(after.players.p1.deck).not.toContain(band);
    expect(all(events, "TOOL_ATTACHED")).toEqual([
      { type: "TOOL_ATTACHED", seat: "p1", uid: band, target: { spot: "bench", index: 0 } },
    ]);
    expect(all(events, "SHUFFLE")).toEqual([{ type: "SHUFFLE", seat: "p1" }]);
    expect(events.findIndex((e) => e.type === "TOOL_ATTACHED")).toBeLessThan(events.findIndex((e) => e.type === "SHUFFLE"));
  });

  it("the decline attaches nothing and still shuffles (\"you may\" is the search's own min 0)", () => {
    const { state } = played(ensureInDeck(table(FILLER), "p1", VITALITY_BAND));
    const { state: after, events } = run(state, cards([]));
    expect(bodyAt(after, "p1", 0).tools).toEqual([]);
    expect(all(events, "SHUFFLE")).toHaveLength(1);
  });

  it("🛑 R-IC1's ONE predicate: the same unsimulated Tool is refused from the HAND (TRAINER_NOT_SIMULATED)", () => {
    const board = setHand(table(FILLER), "p1", [UNSIMULATED_TOOL]);
    const uid = board.players.p1.hand[0] as string;
    expect(refused(board, { type: "attachTool", seat: "p1", uid, target: { spot: "active" } }).code).toBe(
      "TRAINER_NOT_SIMULATED",
    );
  });

  it("🛑 an UNSIMULATED Tool answered over the wire is refused (not among the candidates)", () => {
    const board = ensureInDeck(ensureInDeck(table(FILLER), "p1", VITALITY_BAND), "p1", UNSIMULATED_TOOL);
    const { state } = played(board);
    const fake = state.players.p1.deck.find((u) => state.cardIdByUid[u] === UNSIMULATED_TOOL) as string;
    expect(applyAction(state, cards([fake])).ok).toBe(false);
  });

  it("with no simulated Tool in the deck nothing parks — the search whiffs and the deck shuffles", () => {
    const board = purge(purge(table(FILLER), "p1", VITALITY_BAND), "p1", "sv02-173");
    const { state, events } = played(board);
    expect(state.phase.kind).toBe("turn:action");
    expect(all(events, "SHUFFLE")).toHaveLength(1);
  });

  it("🛑 R-IC2: the HAND-PLAY Tool bar does not apply — under Jellicent ex the hand attach is refused, the search attaches", () => {
    const board = ensureInDeck(table(FILLER, [], JELLICENT_EX), "p1", VITALITY_BAND);
    const handBand = setHand(board, "p1", [VITALITY_BAND]);
    const bandUid = handBand.players.p1.hand[0] as string;
    expect(
      refused(handBand, { type: "attachTool", seat: "p1", uid: bandUid, target: { spot: "active" } }).code,
    ).toBe("HAND_PLAY_BLOCKED");
    const { state } = played(board);
    const p = prompt(state);
    if (p.kind !== "chooseCards") throw new Error("expected chooseCards");
    const band = p.candidates[0] as string;
    const { state: after } = run(state, cards([band]));
    expect(bodyAt(after, "p1", 0).tools).toEqual([band]);
  });

  it("§7.4 — a program source that already holds a Tool is offered nothing (no park) and the deck still shuffles", () => {
    let state = ensureInDeck(table(FILLER, [FARFETCHD]), "p1", VITALITY_BAND);
    state = attach(state, "p1", 0, UNSIMULATED_TOOL, 1, "tools");
    const ctx: EffectContext = { seat: "p1", sourceUid: top(bodyAt(state, "p1", 0)) };
    const events: GameEvent[] = [];
    const program = (programFor(FARFETCHD)?.triggered ?? [])[0]?.program as EffectOp[];
    const out = runProgram(state, program, ctx, events);
    expect(out.kind).toBe("done");
    expect(all(events, "SHUFFLE")).toHaveLength(1);
    expect(all(events, "TOOL_ATTACHED")).toHaveLength(0);
  });

  it("Mach Cut still derives: 30 and a Special Energy off the opponent's Active", () => {
    let state = table(FARFETCHD);
    state = attach(state, "p1", "active", COLORLESS, 1);
    state = attach(state, "p2", "active", SPECIAL, 1);
    const { state: after } = run(state, { type: "attack", seat: "p1", index: 0 });
    expect(bodyAt(after, "p2", "active").damage).toBe(30);
    expect(bodyAt(after, "p2", "active").energy).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§5 — Palafin \"Zero to Hero\" (the in-place swap, Palafin ex's one route in)", () => {
  /** p1: an evolved Palafin (Finizen underneath) Active with one Water, 30 damage and a Tool,
      a benched pivot; one Palafin ex in the deck. */
  function heroBoard(withEx = true): GameState {
    let state = table(PALAFIN, [FILLER]);
    state = underneath(state, "p1", "active", FINIZEN);
    state = attach(state, "p1", "active", WATER, 1);
    state = attach(state, "p1", "active", VITALITY_BAND, 1, "tools");
    state = withBody(state, "p1", "active", (p) => ({ ...p, damage: 30, turnPlayed: 1, evolvedTurn: 1 }));
    // Exactly ONE Palafin ex in the deck (or none): the other copy out, this one in.
    state = purge(state, "p1", PALAFIN_EX[0]);
    return withEx ? ensureInDeck(state, "p1", PALAFIN_EX[1]) : purge(state, "p1", PALAFIN_EX[1]);
  }

  const retreat = (state: GameState): GameAction => ({
    type: "retreat",
    seat: "p1",
    discardEnergy: [...bodyAt(state, "p1", "active").energy],
    promoteBenchIndex: 0,
  });

  it("🛑 a RETREAT fires it: the Palafin ex takes the top of the SAME body, everything else rides along", () => {
    const before = heroBoard();
    const was = bodyAt(before, "p1", "active");
    const palafin = top(was);
    const ex = before.players.p1.deck.find((u) => before.cardIdByUid[u] === PALAFIN_EX[1]) as string;
    const { state, events } = run(before, retreat(before));
    expect(state.phase.kind).toBe("turn:action"); // R-ZH1: no park — the "you may" resolves YES
    const now = bodyAt(state, "p1", 0);
    expect(now.stack).toEqual([was.stack[0], ex]);
    expect(now.damage).toBe(30);
    expect(now.tools).toEqual(was.tools);
    expect(now.turnPlayed).toBe(1);
    expect(now.evolvedTurn).toBe(1);
    expect(state.players.p1.deck).toContain(palafin);
    expect(state.players.p1.deck).not.toContain(ex);
    expect(all(events, "ABILITY_TRIGGERED")).toEqual([{ type: "ABILITY_TRIGGERED", seat: "p1", uid: palafin, ability: "Zero to Hero" }]);
    expect(all(events, "POKEMON_SWAPPED_FROM_DECK")).toEqual([
      { type: "POKEMON_SWAPPED_FROM_DECK", seat: "p1", fromUid: palafin, toUid: ex },
    ]);
    expect(all(events, "SHUFFLE")).toHaveLength(1);
    expect(state.rngState).not.toEqual(before.rngState); // the shuffle is real, not only a row
    expect(all(events, "POKEMON_EVOLVED")).toHaveLength(0);
    expect(state.allowances.abilitiesUsed).toContain(`${palafin}:Zero to Hero`);
  });

  it("🛑 \"THIS Pokémon\": only the body that MOVED fires — a second Palafin already on the Bench does not", () => {
    // Two Palafin: the Active retreats (and swaps), the benched one stays a Palafin.
    let state = heroBoard();
    state = benchFromDeck(ensureInDeck(state, "p1", PALAFIN), "p1", PALAFIN);
    const benchedPalafin = top(bodyAt(state, "p1", 1));
    const { state: after, events } = run(state, retreat(state));
    expect(all(events, "ABILITY_TRIGGERED")).toHaveLength(1);
    expect(all(events, "POKEMON_SWAPPED_FROM_DECK")).toHaveLength(1);
    expect(after.players.p1.bench.some((p) => top(p) === benchedPalafin)).toBe(true);
  });

  it("the log names both cards", () => {
    const before = heroBoard();
    const { state, events } = run(before, retreat(before));
    expect(render(events, state)).toContain("p1: switched Palafin with Palafin ex from their deck");
  });

  it("🛑 a SWITCH (an Item, `switchInto`) fires it too", () => {
    const before = heroBoard();
    const { state, events } = playFromHand(before, SWITCH);
    const after = state.phase.kind === "effect:choose" ? run(state, pick({ seat: "p1", spot: { spot: "bench", index: 0 } })).state : state;
    const moved = bodyAt(after, "p1", 0);
    expect(after.cardIdByUid[top(moved)]).toBe(PALAFIN_EX[1]);
    expect(events.length).toBeGreaterThan(0);
  });

  it("🛑 R-ZH2: a FAILED search (no Palafin ex) still shuffles AND spends the lock", () => {
    const before = heroBoard(false);
    const palafin = top(bodyAt(before, "p1", "active"));
    const { state, events } = run(before, retreat(before));
    expect(top(bodyAt(state, "p1", 0))).toBe(palafin);
    expect(all(events, "SHUFFLE")).toHaveLength(1);
    expect(all(events, "POKEMON_SWAPPED_FROM_DECK")).toHaveLength(0);
    expect(state.rngState).not.toEqual(before.rngState);
    expect(state.allowances.abilitiesUsed).toContain(`${palafin}:Zero to Hero`);
  });

  it("🛑 ONCE during your turn: moved to the Bench a second time the same turn, it does not fire again", () => {
    // Retreat with no Palafin ex (spends the lock), then Switch it back in and out again.
    let state = run(heroBoard(false), retreat(heroBoard(false))).state;
    const palafin = top(bodyAt(state, "p1", 0));
    // A Palafin ex back in the deck, so a second firing WOULD swap — and must not.
    const side = state.players.p1;
    const ex = side.discard.find((u) => state.cardIdByUid[u] === PALAFIN_EX[1] || state.cardIdByUid[u] === PALAFIN_EX[0]);
    if (ex === undefined) throw new Error("no Palafin ex in the discard");
    const deckEx: GameState = {
      ...state,
      players: { ...state.players, p1: { ...side, discard: side.discard.filter((u) => u !== ex), deck: [...side.deck, ex] } },
    };
    state = playFromHand(deckEx, SWITCH).state;
    if (state.phase.kind === "effect:choose") state = run(state, pick({ seat: "p1", spot: { spot: "bench", index: 0 } })).state;
    expect(top(bodyAt(state, "p1", "active"))).toBe(palafin);
    const { state: out, events } = playFromHand(state, SWITCH);
    const final = out.phase.kind === "effect:choose" ? run(out, pick({ seat: "p1", spot: { spot: "bench", index: 0 } })) : { state: out, events };
    expect(all([...events, ...final.events], "ABILITY_TRIGGERED")).toHaveLength(0);
    expect(final.state.players.p1.bench.some((p) => top(p) === palafin)).toBe(true);
    expect(final.state.players.p1.deck).toContain(ex);
  });

  it("🛑 \"during your turn\": dragged to the Bench by the OPPONENT's Boss's Orders, it does not fire", () => {
    let state = heroBoard();
    state = run(state, { type: "endTurn", seat: "p1" }).state;
    state = setHand(state, "p2", [BOSS]);
    const boss = state.players.p2.hand[0] as string;
    const played = run(state, { type: "playTrainer", seat: "p2", uid: boss });
    const after =
      played.state.phase.kind === "effect:choose"
        ? run(played.state, { type: "resolveEffect", seat: "p2", choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } } })
        : played;
    const moved = after.state.players.p1.bench.map((p) => after.state.cardIdByUid[top(p)]);
    expect(moved).toContain(PALAFIN);
    expect(all([...played.events, ...after.events], "POKEMON_SWAPPED_FROM_DECK")).toHaveLength(0);
  });

  it("🛑 THE CENSUS HOLDER: Scramble Switch's \"the Pokémon you moved to your Bench\" is re-keyed to the swapped body", () => {
    const before = heroBoard();
    const { state } = playFromHand(before, SCRAMBLE);
    // The switch pick is forced (one benched body); the Energy move parks (up to "any").
    const p = prompt(state);
    if (p.kind !== "moveEnergy") throw new Error(`expected moveEnergy, got ${p.kind}`);
    const water = bodyAt(state, "p1", 0).energy;
    expect(state.cardIdByUid[top(bodyAt(state, "p1", 0))]).toBe(PALAFIN_EX[1]);
    expect(water).toHaveLength(1);
    const dest = { seat: "p1" as const, spot: { spot: "active" as const } };
    const { state: after } = run(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: water.map((uid) => ({ uid, dest })) },
    } as GameAction);
    expect(bodyAt(after, "p1", "active").energy).toEqual(water);
    expect(bodyAt(after, "p1", 0).energy).toEqual([]);
  });

  it("the hand evolve onto Finizen is STILL refused — the swap is the route, not an evolve", () => {
    let state = table(FINIZEN);
    state = setHand(state, "p1", [PALAFIN_EX[0]]);
    const uid = state.players.p1.hand[0] as string;
    expect(refused(state, { type: "evolve", seat: "p1", uid, target: { spot: "active" } }).code).toBe(
      "EVOLVE_ONLY_VIA_ABILITY",
    );
  });

  it("Wave Splash still derives: 30 to the opponent's Active", () => {
    let state = table(PALAFIN);
    state = attach(state, "p1", "active", WATER, 2);
    const { state: after } = run(state, { type: "attack", seat: "p1", index: 0 });
    expect(bodyAt(after, "p2", "active").damage).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§6 — the bytes: `MATCH_RECORD_VERSION` holds at 36 (D125 widenings, driven)", () => {
  it("🛑 a PARKED Rocket Brain (question 1) round-trips through JSON and resumes to both questions", () => {
    const state = damaged(damaged(table(ORBEETLE[0], [TR_MON, FILLER]), "p1", "active", 30), "p1", 0, 20);
    const parked = run(state, use("Rocket Brain", ACTIVE)).state;
    const revived = JSON.parse(JSON.stringify(parked)) as GameState;
    expect(revived).toEqual(parked);
    if (revived.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(revived.phase.cont.pendingOp).toEqual({ op: "moveCounterOwnChosen", ownerPokemon: "Team Rocket" });
    const second = run(revived, pick({ seat: "p1", spot: { spot: "bench", index: 0 } })).state;
    if (second.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    // The engine-written first answer rides the continuation, a D125 optional key.
    expect(second.phase.cont.pendingOp).toEqual({
      op: "moveCounterOwnChosen",
      ownerPokemon: "Team Rocket",
      from: { spot: "bench", index: 0 },
    });
    const again = JSON.parse(JSON.stringify(second)) as GameState;
    const done = run(again, pick({ seat: "p1", spot: { spot: "active" } })).state;
    expect(bodyAt(done, "p1", "active").damage).toBe(40);
  });

  it("🛑 a PARKED Impromptu Carrier search (`dest: \"attachToSelf\"`, prompt `\"attach\"`) round-trips and resumes", () => {
    const board = ensureInDeck(table(FILLER), "p1", VITALITY_BAND);
    const before = setHand(board, "p1", [FARFETCHD]);
    const parked = run(before, { type: "playBasicToBench", seat: "p1", uid: before.players.p1.hand[0] as string }).state;
    const revived = JSON.parse(JSON.stringify(parked)) as GameState;
    expect(revived).toEqual(parked);
    const p = prompt(revived);
    if (p.kind !== "chooseCards") throw new Error("expected chooseCards");
    const band = p.candidates.find((u) => revived.cardIdByUid[u] === VITALITY_BAND) as string;
    const done = run(revived, cards([band])).state;
    expect(bodyAt(done, "p1", 0).tools).toEqual([band]);
  });
});
