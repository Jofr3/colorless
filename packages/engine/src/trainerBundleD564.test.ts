import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import type { BoardCondition } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { redactGame } from "./redact";
import { programFor } from "./registry";
import { FIXTURE_POOL, battler, benchFromDeck, clearBench, deckOf, setActiveFromDeck, trainerCard } from "./testFixtures";
import type { InPlayPokemon } from "./types";

// ── 🆕🆕🆕 D564 — THE MRV 35 → 36 TRAINER BUNDLE ──
//
//   Amarys                  sv08.5-093 / -132 / -170  Supporter  draw 4; END of turn, 5+ in hand: discard your hand
//   Team Rocket's Factory   sv10-173                  Stadium    played a "Team Rocket" Supporter this turn: draw 2
//   Community Center        sv06-146                  Stadium    played a Supporter this turn: heal 10 from each
//   Crobat                  sv06.5-029                Ability    "Shadowy Envoy": played Janine's Secret Art: draw to 8
//   Caretaker (rider)       sv06-144 / -203           Supporter  drew any + Community Center in play: shuffle itself in
//
// Jasmine's Gaze ×3 (the side-wide next-turn reduction) is `sideDamageNextTurnD564.test.ts`.
// Every card is driven end-to-end on its REAL id on a LOCAL `cardPool` (D275) in the suite's
// OWN deck (D270). Texts, subtypes and legality off tcgdex (the audit's card JSON),
// 2026-09-28. Readings R-AM, R-FC, R-CT, R-CC and the three persisted keys: decisions.md D564.

const AMARYS = ["sv08.5-093", "sv08.5-132", "sv08.5-170"] as const;
const FACTORY = "sv10-173";
const COMMUNITY_CENTER = "sv06-146";
const CARETAKER = ["sv06-144", "sv06-203"] as const;
const CROBAT = "sv06.5-029";
const JANINE = "sv06.5-059";
const ARIANA = "sv10-171";
const FLUTTER_MANE = "sv05-078";
const FILLER = "d564t-filler";
const VICTIM = "d564t-victim";
const DARK = "fix-dark-energy";

const AMARYS_TEXT =
  "Draw 4 cards. At the end of this turn, if you have 5 or more cards in your hand, discard your hand.";
const FACTORY_TEXT =
  'Once during each player\'s turn, if they played a Supporter card that has "Team Rocket" in its name from their hand this turn, they may draw 2 cards.';
const CC_TEXT =
  "Once during each player's turn, if they played a Supporter card from their hand this turn, they may heal 10 damage from each of their Pokémon.";
const CARETAKER_TEXT =
  "Draw 2 cards. If you drew any cards in this way and if Community Center is in play, shuffle this Caretaker into your deck instead of discarding it.";
const SHADOWY_ENVOY =
  "Once during your turn, if you played Janine's Secret Art from your hand this turn, you may draw cards until you have 8 cards in your hand.";
const POISON_FANG =
  "Your opponent's Active Pokémon is now Poisoned. During Pokémon Checkup, put 2 damage counters on that Pokémon instead of 1.";

function printed(id: string, name: string, trainerType: string, effect: string): Card {
  return { ...trainerCard(id, trainerType, effect), name };
}

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(AMARYS.map((id) => [id, printed(id, "Amarys", "Supporter", AMARYS_TEXT)])),
  ...Object.fromEntries(CARETAKER.map((id) => [id, printed(id, "Caretaker", "Supporter", CARETAKER_TEXT)])),
  [FACTORY]: printed(FACTORY, "Team Rocket's Factory", "Stadium", FACTORY_TEXT),
  [COMMUNITY_CENTER]: printed(COMMUNITY_CENTER, "Community Center", "Stadium", CC_TEXT),
  [JANINE]: printed(JANINE, "Janine's Secret Art", "Supporter", "Choose up to 2 of your {D} Pokémon. …"),
  [ARIANA]: printed(ARIANA, "Team Rocket's Ariana", "Supporter", "Draw cards until you have 5 cards in your hand. …"),
  [CROBAT]: battler(CROBAT, {
    name: "Crobat",
    stage: "Stage2",
    evolveFrom: "Golbat",
    types: ["Darkness"],
    hp: 130,
    retreat: 0,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    abilities: [{ type: "Ability", name: "Shadowy Envoy", effect: SHADOWY_ENVOY }],
    attacks: [{ cost: ["Darkness", "Colorless"], name: "Poison Fang", damage: 120, effect: POISON_FANG }],
  }),
  [FLUTTER_MANE]: battler(FLUTTER_MANE, {
    name: "Flutter Mane",
    types: ["Psychic"],
    hp: 90,
    abilities: [
      {
        type: "Ability",
        name: "Midnight Fluttering",
        effect:
          "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities, except for Midnight Fluttering.",
      },
    ],
  }),
  [FILLER]: battler(FILLER, {
    name: "D564 Filler",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  [VICTIM]: battler(VICTIM, { name: "D564 Victim", hp: 10, types: ["Colorless"] }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [AMARYS[0]]: 2,
  [AMARYS[1]]: 1,
  [AMARYS[2]]: 1,
  [FACTORY]: 2,
  [COMMUNITY_CENTER]: 2,
  [CARETAKER[0]]: 2,
  [CARETAKER[1]]: 1,
  [ARIANA]: 2,
  [JANINE]: 2,
  [CROBAT]: 2,
  [FLUTTER_MANE]: 1,
  [VICTIM]: 2,
  [FILLER]: 28,
  [DARK]: 4,
  "fix-energy": 8,
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

/** Setup with p2 going first; returns p1's (unrestricted) turn 2 after p2 passed. */
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

/** TEST SURGERY — one copy of `id` into `seat`'s DECK (back from the hand, or swapped out
    of the Prizes for the deck's bottom card). Every uid stays in exactly one zone. */
function ensureInDeck(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  if (side.deck.some((u) => state.cardIdByUid[u] === id)) return state;
  const held = side.hand.find((u) => state.cardIdByUid[u] === id);
  if (held !== undefined) {
    const next = { ...side, hand: side.hand.filter((u) => u !== held), deck: [...side.deck, held] };
    return { ...state, players: { ...state.players, [seat]: next } };
  }
  const prized = side.prizes.find((u) => state.cardIdByUid[u] === id);
  const swap = side.deck[side.deck.length - 1];
  if (prized === undefined || swap === undefined) throw new Error(`${seat} has no ${id} to seat`);
  const next = {
    ...side,
    prizes: side.prizes.map((u) => (u === prized ? swap : u)),
    deck: [...side.deck.slice(0, -1), prized],
  };
  return { ...state, players: { ...state.players, [seat]: next } };
}

/** p1's turn 2: p1 `active` + `bench`, p2 `oppActive` + `oppBench`. */
function table(
  active: string = FILLER,
  bench: readonly string[] = [],
  oppActive: string = FILLER,
  oppBench: readonly string[] = [],
  seed = 5641,
): GameState {
  let state = opened(seed);
  state = setActiveFromDeck(ensureInDeck(state, "p1", active), "p1", active);
  state = setActiveFromDeck(ensureInDeck(state, "p2", oppActive), "p2", oppActive);
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of bench) state = benchFromDeck(ensureInDeck(state, "p1", id), "p1", id);
  for (const id of oppBench) state = benchFromDeck(ensureInDeck(state, "p2", id), "p2", id);
  return state;
}

/** TEST SURGERY — `seat`'s hand becomes EXACTLY one card per entry of `ids`. */
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
    const swap = deck[deck.length - 1];
    if (prized === undefined || swap === undefined) throw new Error(`${seat} has no more ${id}`);
    prizes = prizes.map((u) => (u === prized ? swap : u));
    deck = deck.slice(0, -1);
    hand.push(prized);
  }
  return { ...state, players: { ...state.players, [seat]: { ...side, hand, deck, prizes } } };
}

/** TEST SURGERY — every Basic {D} Energy out of `seat`'s deck into its discard, so Janine's
    Secret Art resolves to a bare shuffle (its shipped empty path) rather than parking. */
function noDarkInDeck(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  const dark = side.deck.filter((u) => state.cardIdByUid[u] === DARK);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, deck: side.deck.filter((u) => !dark.includes(u)), discard: [...side.discard, ...dark] },
    },
  };
}

/** `seat` holds exactly `[id, ...rest]`; plays `id`. */
function play(board: GameState, id: string, rest: readonly string[] = [], seat: Seat = "p1") {
  const before = setHand(board, seat, [id, ...rest]);
  const uid = before.players[seat].hand[0] as string;
  return { before, uid, ...run(before, { type: "playTrainer", seat, uid }) };
}

/** `seat` plays the Stadium `id` from its hand onto `board` (a real `playTrainer`), and its
    hand is then `rest`. */
function withStadium(board: GameState, id: string, seat: Seat = "p1", rest: readonly string[] = []): GameState {
  return setHand(play(board, id, rest, seat).state, seat, rest);
}

function all<T extends GameEvent["type"]>(events: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function body(p: InPlayPokemon | null | undefined): InPlayPokemon {
  if (p === null || p === undefined) throw new Error("no body");
  return p;
}

const drawn = (events: readonly GameEvent[]) => all(events, "CARDS_DRAWN").map((e) => e.uids.length);
const useStadium = (state: GameState, seat: Seat = "p1") => run(state, { type: "useStadiumAbility", seat });
const endTurn = (state: GameState, seat: Seat = "p1") => run(state, { type: "endTurn", seat });
const useEnvoy = (target: { spot: "active" } | { spot: "bench"; index: number } = { spot: "active" }) =>
  ({ type: "useAbility", seat: "p1", target, abilityName: "Shadowy Envoy" }) as GameAction;

function withDamage(state: GameState, seat: Seat, spot: "active" | number, damage: number): GameState {
  const side = state.players[seat];
  const hurt = (p: InPlayPokemon): InPlayPokemon => ({ ...p, damage });
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        active: spot === "active" ? hurt(body(side.active)) : side.active,
        bench: side.bench.map((p, i) => (i === spot ? hurt(p) : p)),
      },
    },
  };
}

function render(events: GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn" ? [] : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

function offerFor(state: GameState, viewer: Seat) {
  const phase = redactGame(state, viewer).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.stadiumAbility;
}

// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — the prints and the registry rows", () => {
  it("Amarys: draw 4, then the scheduled end-of-turn discard at 5; reprints share ONE object, only a `trainer` key", () => {
    const first = programFor(AMARYS[0]);
    expect(first).toEqual({
      trainer: [
        { op: "drawCards", count: 4 },
        { op: "scheduleEndOfTurnHandDiscard", atLeast: 5 },
      ],
    });
    expect(Object.keys(first ?? {})).toEqual(["trainer"]);
    for (const id of AMARYS) expect(programFor(id)).toBe(first);
  });

  it("Team Rocket's Factory: a gated Stadium ability — the SUBSTRING form", () => {
    expect(programFor(FACTORY)).toEqual({
      stadium: {
        ability: {
          label: "Team Rocket's Factory",
          playableIf: { kind: "youPlayedSupporterNamedThisTurn", nameContains: "Team Rocket" },
          program: [{ op: "drawCards", count: 2 }],
        },
      },
    });
  });

  it("Community Center: a gated Stadium ability on the shipped `youPlayedSupporterThisTurn`", () => {
    expect(programFor(COMMUNITY_CENTER)).toEqual({
      stadium: {
        ability: {
          label: "Community Center",
          playableIf: { kind: "youPlayedSupporterThisTurn" },
          program: [{ op: "healEach", amount: 10 }],
        },
      },
    });
  });

  it("Crobat: one activated Ability — the EXACT-name form — and NO `attack` key (Poison Fang derives)", () => {
    const first = programFor(CROBAT);
    expect(first).toEqual({
      abilities: [
        {
          name: "Shadowy Envoy",
          oncePerTurn: true,
          activeOnly: false,
          playableIf: { kind: "youPlayedSupporterNamedThisTurn", name: "Janine's Secret Art" },
          program: [{ op: "drawUntilHandSize", size: 8 }],
        },
      ],
    });
    expect(Object.keys(first ?? {})).toEqual(["abilities"]);
  });

  it("Caretaker: the rider — the draw files what it took, and the shuffle sits behind it AND the Stadium", () => {
    const first = programFor(CARETAKER[0]);
    expect(first).toEqual({
      trainer: [
        { op: "drawCards", count: 2, recordAs: "moved" },
        {
          op: "recordGate",
          slot: "moved",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
          then: [
            {
              op: "conditionGate",
              cond: { kind: "stadiumInPlayNamed", name: "Community Center" },
              // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
              then: [{ op: "shufflePlayedCardIntoDeck" }],
            },
          ],
        },
      ],
    });
    expect(programFor(CARETAKER[1])).toBe(first);
  });

  it("four new texts, four DISTINCT objects, and none shared with Caretaker (D199)", () => {
    const objects = new Set([AMARYS[0], FACTORY, COMMUNITY_CENTER, CROBAT, CARETAKER[0]].map((id) => programFor(id)));
    expect(objects.size).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§2 — the two NEW `BoardCondition` members, driven both ways", () => {
  const TR: BoardCondition = { kind: "youPlayedSupporterNamedThisTurn", nameContains: "Team Rocket" };
  const JANINES: BoardCondition = { kind: "youPlayedSupporterNamedThisTurn", name: "Janine's Secret Art" };

  it("no Supporter played: both forms are FALSE", () => {
    const state = table();
    expect(state.allowances.supporterPlayedUid).toBeNull();
    expect(conditionHolds(state, "p1", TR)).toBe(false);
    expect(conditionHolds(state, "p1", JANINES)).toBe(false);
  });

  it("🛑 the SUBSTRING form holds for a Team Rocket's Supporter and the EXACT form does not", () => {
    const { state, uid } = play(table(), ARIANA);
    expect(state.allowances.supporterPlayedUid).toBe(uid);
    expect(conditionHolds(state, "p1", TR)).toBe(true);
    expect(conditionHolds(state, "p1", JANINES)).toBe(false);
    // The exact form is not a substring test: "Team Rocket" is not the card's NAME.
    expect(conditionHolds(state, "p1", { kind: "youPlayedSupporterNamedThisTurn", name: "Team Rocket" })).toBe(false);
    expect(
      conditionHolds(state, "p1", { kind: "youPlayedSupporterNamedThisTurn", name: "Team Rocket's Ariana" }),
    ).toBe(true);
  });

  it("🛑 the EXACT form holds for Janine's Secret Art and the SUBSTRING form does not", () => {
    const { state } = play(noDarkInDeck(table(), "p1"), JANINE);
    expect(conditionHolds(state, "p1", JANINES)).toBe(true);
    expect(conditionHolds(state, "p1", TR)).toBe(false);
  });

  it("🛑 THE SEAT GUARD — the OTHER seat reads FALSE on the turn owner's Supporter", () => {
    const { state } = play(table(), ARIANA);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(conditionHolds(state, "p1", TR)).toBe(true);
    expect(conditionHolds(state, "p2", TR)).toBe(false);
  });

  it("🛑 THE SEAT GUARD — FALSE for BOTH seats on a checkup-origin ko:* park (activeSeat null), TRUE for the owner mid-attack", () => {
    const armed = play(table(), ARIANA).state;
    const parked: GameState = {
      ...armed,
      phase: { kind: "ko:takePrizes", seat: "p1", count: 1 },
      pending: [{ kind: "startTurn", seat: "p2" }],
    };
    expect(conditionHolds(parked, "p1", TR)).toBe(false);
    expect(conditionHolds(parked, "p2", TR)).toBe(false);
    const midAttack: GameState = {
      ...parked,
      pending: [
        { kind: "endTurn", seat: "p1" },
        { kind: "startTurn", seat: "p2" },
      ],
    };
    expect(conditionHolds(midAttack, "p1", TR)).toBe(true);
    expect(conditionHolds(midAttack, "p2", TR)).toBe(false);
  });

  it("the turn boundary wipes the uid: the opponent's turn reads nothing of p1's Supporter", () => {
    const next = endTurn(play(table(), ARIANA).state).state;
    expect(next.allowances.supporterPlayedUid).toBeNull();
    expect(conditionHolds(next, "p2", TR)).toBe(false);
  });

  it("`stadiumInPlayNamed` — the NAME of whichever seat's Stadium, and nothing when the zone is empty", () => {
    const CC: BoardCondition = { kind: "stadiumInPlayNamed", name: "Community Center" };
    expect(conditionHolds(table(), "p1", CC)).toBe(false);
    const mine = withStadium(table(), COMMUNITY_CENTER);
    expect(conditionHolds(mine, "p1", CC)).toBe(true);
    expect(conditionHolds(mine, "p2", CC)).toBe(true); // no possessive is printed
    expect(conditionHolds(withStadium(table(), FACTORY), "p1", CC)).toBe(false);
    const theirs = withStadium(endTurn(table()).state, COMMUNITY_CENTER, "p2");
    expect(conditionHolds(theirs, "p1", CC)).toBe(true);
  });

  it("each note is the printed clause minus its \"if\"", () => {
    expect(conditionNote(TR)).toBe(
      'you played a Supporter card that has "Team Rocket" in its name from your hand this turn',
    );
    expect(conditionNote(JANINES)).toBe("you played Janine's Secret Art from your hand this turn");
    expect(conditionNote({ kind: "stadiumInPlayNamed", name: "Community Center" })).toBe("Community Center is in play");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§3 — Amarys: draw 4, and at the END of the turn, 5 or more in hand discards the hand", () => {
  it("the play draws 4 and SCHEDULES — the threshold rides the bag, and nothing is discarded yet", () => {
    const { state, events } = play(table(), AMARYS[0], [FILLER]);
    expect(drawn(events)).toEqual([4]);
    expect(state.players.p1.hand).toHaveLength(5);
    expect(state.allowances.endOfTurnHandDiscard).toBe(5);
    expect(all(events, "HAND_DISCARD_SCHEDULED")).toEqual([{ type: "HAND_DISCARD_SCHEDULED", seat: "p1", atLeast: 5 }]);
    expect(all(events, "HAND_DISCARDED")).toEqual([]);
  });

  for (const [rest, discards] of [
    [0, false],
    [1, true],
    [2, true],
  ] as const) {
    it(`🛑 THE THRESHOLD at the end of the turn: ${4 + rest} cards ${discards ? "DISCARDS" : "keeps"} (\`>=\`, the printed "5 or more")`, () => {
      const { state } = play(table(), AMARYS[0], Array<string>(rest).fill(FILLER));
      const hand = [...state.players.p1.hand];
      expect(hand).toHaveLength(4 + rest);
      const { state: next, events } = endTurn(state);
      const types = events.map((e) => e.type);
      if (discards) {
        expect(all(events, "HAND_DISCARDED")).toEqual([{ type: "HAND_DISCARDED", seat: "p1", uids: hand }]);
        // "At the end of this turn" — BEFORE the turn-ended row and the Checkup.
        expect(types.indexOf("HAND_DISCARDED")).toBeLessThan(types.indexOf("TURN_ENDED"));
        expect(next.players.p1.hand).toEqual([]);
        for (const uid of hand) expect(next.players.p1.discard).toContain(uid);
      } else {
        expect(all(events, "HAND_DISCARDED")).toEqual([]);
        expect(next.players.p1.hand).toEqual(hand);
      }
      // `freshAllowances()` wipes it at the next `startTurn`.
      expect(next.allowances.endOfTurnHandDiscard).toBeNull();
    });
  }

  it("the hand is read at the END, not at the play: spend it down to 4 and it is kept", () => {
    const { state } = play(table(), AMARYS[0], [FILLER, FILLER]);
    expect(state.players.p1.hand).toHaveLength(6);
    // Two cards leave the hand mid-turn (surgery standing in for two plays).
    const kept = setHand(state, "p1", state.players.p1.hand.slice(0, 4).map((u) => state.cardIdByUid[u] as string));
    const { state: next, events } = endTurn(kept);
    expect(all(events, "HAND_DISCARDED")).toEqual([]);
    expect(next.players.p1.hand).toHaveLength(4);
  });

  it("🛑 R-AM — an ATTACK-ended turn pays it AFTER the Knock Out's prize: 4 + 1 prize = 5 → the hand is discarded", () => {
    const board = table(FILLER, [], VICTIM, [FILLER]);
    const { state } = play(board, AMARYS[0]);
    expect(state.players.p1.hand).toHaveLength(4);
    const hit = run(state, { type: "attack", seat: "p1", index: 0 });
    expect(hit.state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    // Not yet: the discard is the endTurn stage's, and the prize stage is ahead of it.
    expect(all(hit.events, "HAND_DISCARDED")).toEqual([]);
    const prize = hit.state.players.p1.prizes[0] as string;
    const taken = run(hit.state, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    const discarded = all(taken.events, "HAND_DISCARDED");
    expect(discarded).toHaveLength(1);
    expect(discarded[0]?.uids).toHaveLength(5);
    expect(discarded[0]?.uids).toContain(prize);
    expect(taken.state.players.p1.hand).toEqual([]);
  });

  it("…and the CONTROL: the same attack with no Knock Out ends on 4 cards, and nothing is discarded", () => {
    const { state } = play(table(), AMARYS[0]);
    const hit = run(state, { type: "attack", seat: "p1", index: 0 });
    expect(all(hit.events, "HAND_DISCARDED")).toEqual([]);
    expect(hit.state.players.p1.hand).toHaveLength(4);
  });

  it("the OPPONENT's next turn does not inherit it: p2 ends its turn on 6+ cards and keeps them", () => {
    const { state } = play(table(), AMARYS[0], [FILLER]);
    const p2Turn = setHand(endTurn(state).state, "p2", [FILLER, FILLER, FILLER, FILLER, FILLER, FILLER]);
    const { state: next, events } = endTurn(p2Turn, "p2");
    expect(all(events, "HAND_DISCARDED")).toEqual([]);
    expect(next.players.p2.hand).toHaveLength(6);
  });

  it("every printing is the same card, and the log says what is pending", () => {
    for (const id of AMARYS) {
      const { state, events } = play(table(), id);
      expect(state.allowances.endOfTurnHandDiscard).toBe(5);
      expect(render(events, state)).toContainEqual({
        who: "p1",
        text: "will discard their hand at the end of this turn if it holds 5 or more cards",
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§4 — Team Rocket's Factory: a \"Team Rocket\" Supporter licenses one draw 2, on each player's own turn", () => {
  const factory = () => withStadium(table(), FACTORY);

  it("🛑 a Team Rocket's Supporter played this turn: the Stadium draws 2", () => {
    const { state } = play(factory(), ARIANA);
    const handBefore = state.players.p1.hand.length;
    const used = useStadium(state);
    expect(drawn(used.events)).toEqual([2]);
    expect(used.state.players.p1.hand).toHaveLength(handBefore + 2);
    expect(used.state.allowances.stadiumAbilityUsed).toBe(true);
  });

  it("🛑 a NON-Team-Rocket Supporter does not license it — PLAY_CONDITION_NOT_MET with the printed clause", () => {
    const { state } = play(factory(), CARETAKER[0]);
    expect(state.allowances.supporterPlayed).toBe(true);
    expect(refused(state, { type: "useStadiumAbility", seat: "p1" })).toEqual({
      code: "PLAY_CONDITION_NOT_MET",
      message:
        'Team Rocket\'s Factory can only be used if you played a Supporter card that has "Team Rocket" in its name from your hand this turn (§7.3)',
    });
  });

  it("no Supporter at all: refused the same way, and the use is NOT spent", () => {
    const state = factory();
    expect(refused(state, { type: "useStadiumAbility", seat: "p1" }).code).toBe("PLAY_CONDITION_NOT_MET");
    expect(state.allowances.stadiumAbilityUsed).toBe(false);
  });

  it("once per turn: a second use says so (the flag is checked BEFORE the gate)", () => {
    const used = useStadium(play(factory(), ARIANA).state).state;
    expect(refused(used, { type: "useStadiumAbility", seat: "p1" }).code).toBe("STADIUM_ABILITY_ALREADY_USED");
  });

  it("🛑 EACH PLAYER'S TURN: p2 uses p1's Factory on its OWN turn off its own Team Rocket's Supporter", () => {
    const p2Turn = endTurn(factory()).state;
    // p1's licence did not survive the boundary, and p2 has played nothing yet.
    expect(refused(p2Turn, { type: "useStadiumAbility", seat: "p2" }).code).toBe("PLAY_CONDITION_NOT_MET");
    const { state } = play(p2Turn, ARIANA, [], "p2");
    const used = useStadium(state, "p2");
    expect(drawn(used.events)).toEqual([2]);
    expect(used.events[0]).toMatchObject({ type: "STADIUM_ABILITY_ACTIVATED", seat: "p2" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§5 — Community Center: any Supporter licenses heal 10 from EACH of the actor's Pokémon", () => {
  const center = (bench: readonly string[] = [FILLER]) => withStadium(table(FILLER, bench), COMMUNITY_CENTER);

  it("🛑 after a Supporter: 10 off every damaged body of the ACTOR's, Active and Bench, and none of the opponent's", () => {
    let state = play(center([FILLER, FILLER]), ARIANA).state;
    state = withDamage(withDamage(withDamage(state, "p1", "active", 30), "p1", 0, 10), "p1", 1, 50);
    state = withDamage(state, "p2", "active", 40);
    const used = useStadium(state);
    expect(body(used.state.players.p1.active).damage).toBe(20);
    expect(used.state.players.p1.bench.map((p) => p.damage)).toEqual([0, 40]);
    expect(body(used.state.players.p2.active).damage).toBe(40);
    expect(all(used.events, "HEALED").map((e) => e.amount)).toEqual([10, 10, 10]);
  });

  it("no Supporter: refused with the printed clause", () => {
    expect(refused(center(), { type: "useStadiumAbility", seat: "p1" })).toEqual({
      code: "PLAY_CONDITION_NOT_MET",
      message: "Community Center can only be used if you played a Supporter card from your hand during this turn (§7.3)",
    });
  });

  it("🛑 R-CC — a board with NO damage: the use is ALLOWED and whiffs — spent, nothing healed", () => {
    const { state } = play(center(), ARIANA);
    const used = useStadium(state);
    expect(all(used.events, "HEALED")).toEqual([]);
    expect(used.state.allowances.stadiumAbilityUsed).toBe(true);
  });

  it("p2 on its own turn heals ITS side off its own Supporter", () => {
    let p2Turn = endTurn(center()).state;
    p2Turn = withDamage(withDamage(p2Turn, "p2", "active", 30), "p1", "active", 30);
    const used = useStadium(play(p2Turn, ARIANA, [], "p2").state, "p2");
    expect(body(used.state.players.p2.active).damage).toBe(20);
    expect(body(used.state.players.p1.active).damage).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§6 — Caretaker's rider: drew any cards AND Community Center in play → shuffles itself into the deck", () => {
  it("🛑 WITH Community Center: draws 2, then leaves the discard for the deck — Super Rod's two rows", () => {
    const board = withStadium(table(), COMMUNITY_CENTER);
    const deckBefore = board.players.p1.deck.length;
    const { uid, state, events } = play(board, CARETAKER[0]);
    expect(drawn(events)).toEqual([2]);
    expect(state.players.p1.discard).not.toContain(uid);
    expect(state.players.p1.deck).toContain(uid);
    // −1 Caretaker into the hand, −2 drawn, +1 Caretaker shuffled back.
    expect(state.players.p1.deck).toHaveLength(deckBefore - 1 - 2 + 1);
    expect(all(events, "DISCARD_RETRIEVED")).toEqual([{ type: "DISCARD_RETRIEVED", seat: "p1", dest: "deck", uids: [uid] }]);
    expect(events.map((e) => e.type).slice(-2)).toEqual(["DISCARD_RETRIEVED", "SHUFFLE"]);
  });

  it("WITHOUT a Stadium: draws 2 and goes to the discard", () => {
    const { uid, state } = play(table(), CARETAKER[1]);
    expect(state.players.p1.discard).toContain(uid);
    expect(state.players.p1.deck).not.toContain(uid);
  });

  it("🛑 a DIFFERENT Stadium (the Factory) is not Community Center — the name is the gate", () => {
    const { uid, state } = play(withStadium(table(), FACTORY), CARETAKER[0]);
    expect(state.players.p1.discard).toContain(uid);
  });

  it("the OPPONENT's Community Center counts too — no possessive is printed", () => {
    const theirs = withStadium(endTurn(table()).state, COMMUNITY_CENTER, "p2");
    const p1Again = endTurn(theirs, "p2").state;
    const { uid, state } = play(p1Again, CARETAKER[0]);
    expect(state.players.p1.deck).toContain(uid);
  });

  it("🛑 R-CT — an EMPTY deck draws nothing, so it did NOT draw \"any cards in this way\": it stays in the discard", () => {
    const held = setHand(withStadium(table(), COMMUNITY_CENTER), "p1", [CARETAKER[0]]);
    const side = held.players.p1;
    const empty: GameState = {
      ...held,
      players: { ...held.players, p1: { ...side, deck: [], discard: [...side.discard, ...side.deck] } },
    };
    const uid = side.hand[0] as string;
    const { state, events } = run(empty, { type: "playTrainer", seat: "p1", uid });
    expect(drawn(events)).toEqual([]);
    expect(state.players.p1.discard).toContain(uid);
    expect(state.players.p1.deck).toEqual([]);
  });

  it("R-CT — a ONE-card deck draws one, which is \"any\": it shuffles itself in", () => {
    const held = setHand(withStadium(table(), COMMUNITY_CENTER), "p1", [CARETAKER[0]]);
    const side = held.players.p1;
    const one: GameState = {
      ...held,
      players: {
        ...held.players,
        p1: { ...side, deck: side.deck.slice(0, 1), discard: [...side.discard, ...side.deck.slice(1)] },
      },
    };
    const uid = side.hand[0] as string;
    const { state, events } = run(one, { type: "playTrainer", seat: "p1", uid });
    expect(drawn(events)).toEqual([1]);
    expect(state.players.p1.deck).toEqual([uid]);
  });

  it("🛑 R-FC — a Caretaker shuffled back STILL counts as played: Community Center heals after it", () => {
    let board = withStadium(table(), COMMUNITY_CENTER);
    board = withDamage(board, "p1", "active", 20);
    const { uid, state } = play(board, CARETAKER[0]);
    expect(state.players.p1.deck).toContain(uid);
    expect(state.allowances.supporterPlayedUid).toBe(uid);
    expect(conditionHolds(state, "p1", { kind: "youPlayedSupporterNamedThisTurn", name: "Caretaker" })).toBe(true);
    const used = useStadium(state);
    expect(body(used.state.players.p1.active).damage).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§7 — Crobat \"Shadowy Envoy\": Janine's Secret Art licenses a draw to 8", () => {
  const withJanine = (board: GameState) => play(noDarkInDeck(board, "p1"), JANINE).state;

  it("🛑 after Janine's Secret Art: draws until 8, from the Active Spot or the Bench", () => {
    const active = run(withJanine(table(CROBAT)), useEnvoy({ spot: "active" }));
    expect(active.state.players.p1.hand).toHaveLength(8);
    expect(drawn(active.events)).toEqual([8]);
    const benched = run(withJanine(table(FILLER, [CROBAT])), useEnvoy({ spot: "bench", index: 0 }));
    expect(benched.state.players.p1.hand).toHaveLength(8);
  });

  it("🛑 ANOTHER Supporter does not license it — ABILITY_CONDITION_NOT_MET with the printed clause", () => {
    const { state } = play(table(CROBAT), CARETAKER[0]);
    expect(refused(state, useEnvoy())).toEqual({
      code: "ABILITY_CONDITION_NOT_MET",
      message: "Shadowy Envoy can only be used if you played Janine's Secret Art from your hand this turn (§9)",
    });
  });

  it("no Supporter at all: refused", () => {
    expect(refused(table(CROBAT), useEnvoy()).code).toBe("ABILITY_CONDITION_NOT_MET");
  });

  it("\"until 8\" is a ceiling: a hand already at 8 draws nothing", () => {
    const board = noDarkInDeck(table(CROBAT), "p1");
    const { state } = play(board, JANINE, Array<string>(8).fill(FILLER));
    const used = run(state, useEnvoy());
    expect(drawn(used.events)).toEqual([]);
    expect(used.state.players.p1.hand).toHaveLength(8);
  });

  it("once per turn", () => {
    const used = run(withJanine(table(CROBAT)), useEnvoy()).state;
    expect(refused(used, useEnvoy()).code).toBe("ABILITY_ALREADY_USED");
  });

  it("🛑 §9 — Flutter Mane's lock turns the ACTIVE Crobat's Ability off; a BENCHED Crobat is untouched", () => {
    const locked = withJanine(table(CROBAT, [CROBAT], FLUTTER_MANE));
    expect(refused(locked, useEnvoy()).code).toBe("ABILITY_DISABLED");
    expect(run(locked, useEnvoy({ spot: "bench", index: 0 })).state.players.p1.hand).toHaveLength(8);
  });

  it("🛑 Poison Fang STILL DERIVES now that a CardProgram exists (D444's registry ?? derived): 120 and Poisoned for 2 counters", () => {
    expect(programFor(CROBAT)?.attack).toBeUndefined();
    let state = table(CROBAT);
    const side = state.players.p1;
    const dark = side.deck.filter((u) => state.cardIdByUid[u] === DARK).slice(0, 2);
    state = {
      ...state,
      players: {
        ...state.players,
        p1: { ...side, deck: side.deck.filter((u) => !dark.includes(u)), active: { ...body(side.active), energy: dark } },
      },
    };
    const hit = run(state, { type: "attack", seat: "p1", index: 0 });
    expect(all(hit.events, "DAMAGE_DEALT")[0]?.dealt).toBe(120);
    expect(body(hit.state.players.p2.active).conditions.poisonDamage).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§8 — the online offer follows the gate (redact.ts), term for term with `useStadiumAbility`", () => {
  it("🛑 an UNSPENT gated use greys WITH the printed clause; licensed, it lights; spent, it greys with no reason", () => {
    const board = withStadium(table(), COMMUNITY_CENTER);
    expect(offerFor(board, "p1")).toEqual({
      label: "Community Center",
      disabled: true,
      reason: "Only if you played a Supporter card from your hand during this turn",
    });
    const licensed = play(board, ARIANA).state;
    expect(offerFor(licensed, "p1")).toEqual({ label: "Community Center", disabled: false, reason: null });
    const spent = useStadium(licensed).state;
    expect(offerFor(spent, "p1")).toEqual({ label: "Community Center", disabled: true, reason: null });
  });

  it("the Factory's clause is its own, and the offer agrees with the engine on every board", () => {
    const board = withStadium(table(), FACTORY);
    const boards = [board, play(board, CARETAKER[0]).state, play(board, ARIANA).state];
    expect(offerFor(boards[1] as GameState, "p1")?.reason).toBe(
      'Only if you played a Supporter card that has "Team Rocket" in its name from your hand this turn',
    );
    const pressable = boards.map((s) => offerFor(s, "p1")?.disabled === false);
    const accepted = boards.map((s) => applyAction(s, { type: "useStadiumAbility", seat: "p1" }).ok);
    expect(pressable).toEqual(accepted);
    expect(accepted).toEqual([false, false, true]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§9 — the bytes, and THE NINTH POSITION (`MATCH_RECORD_VERSION` 35 → 36)", () => {
  it("🛑 both allowance keys round-trip through JSON and still act", () => {
    const amarys = play(table(), AMARYS[0], [FILLER]).state;
    const revivedAmarys = JSON.parse(JSON.stringify(amarys)) as GameState;
    expect(revivedAmarys.allowances.endOfTurnHandDiscard).toBe(5);
    expect(endTurn(revivedAmarys).state.players.p1.hand).toEqual([]);
    const licensed = play(withStadium(table(), FACTORY), ARIANA).state;
    const revived = JSON.parse(JSON.stringify(licensed)) as GameState;
    expect(revived.allowances.supporterPlayedUid).toBe(licensed.allowances.supporterPlayedUid);
    expect(drawn(useStadium(revived).events)).toEqual([2]);
  });

  it("🛑 (i) A v35 ROLLBACK resuming a v36 record mid-turn DROPS a pending Amarys discard and a Factory licence — NOT inert", () => {
    // A v35 engine never reads either key, which is this engine with the key at its
    // fresh value: the Supporter is spent (`supporterPlayed` true) and its effect is gone.
    const amarys = JSON.parse(JSON.stringify(play(table(), AMARYS[0], [FILLER]).state)) as GameState;
    const rolledAmarys: GameState = { ...amarys, allowances: { ...amarys.allowances, endOfTurnHandDiscard: null } };
    expect(rolledAmarys.allowances.supporterPlayed).toBe(true);
    expect(endTurn(rolledAmarys).state.players.p1.hand).toHaveLength(5);
    const licensed = JSON.parse(JSON.stringify(play(withStadium(table(), FACTORY), ARIANA).state)) as GameState;
    const rolledLicence: GameState = { ...licensed, allowances: { ...licensed.allowances, supporterPlayedUid: null } };
    expect(refused(rolledLicence, { type: "useStadiumAbility", seat: "p1" }).code).toBe("PLAY_CONDITION_NOT_MET");
  });

  it("(ii) a v35-SHAPED bag (both keys ABSENT) reads benignly — no discard, no licence, no throw — and is retired by the version gate anyway (D124)", () => {
    const strip = (state: GameState): GameState => {
      const { supporterPlayedUid: _uid, endOfTurnHandDiscard: _eot, ...v35Allowances } = state.allowances;
      return { ...state, allowances: v35Allowances } as unknown as GameState;
    };
    // MEASURED, not argued: `undefined !== null` passes the threshold test and
    // `hand.length >= undefined` is false; an absent uid resolves to no card. Silent, so
    // the version gate — not the reader — is what retires such a record.
    const licensed = strip(play(withStadium(table(), FACTORY), ARIANA).state);
    expect(refused(licensed, { type: "useStadiumAbility", seat: "p1" }).code).toBe("PLAY_CONDITION_NOT_MET");
    const amarys = strip(play(table(), AMARYS[0], [FILLER]).state);
    expect(endTurn(amarys).state.players.p1.hand).toHaveLength(5);
  });

  it("the engine is 0.495.0", () => {
    expect(engineVersion).toBe("0.495.0");
  });
});
