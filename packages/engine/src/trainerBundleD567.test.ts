import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { resumeProgram, runProgram } from "./interpreter";
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
  setPrizes,
  trainerCard,
  typedEnergy,
  walkProgram,
} from "./testFixtures";
import type { InPlayPokemon } from "./types";

// ── 🆕🆕🆕 D567 — THE TRAINER BUNDLE: 4 PRINTINGS / 4 TEXTS / 4 OBJECTS ──
//
//   Redeemable Ticket        sv09-156  Item     "Count your Prize cards, shuffle them, and put them on
//                                               the bottom of your deck. Then, take that many cards from
//                                               the top of your deck and put them face down as your
//                                               Prize cards."
//   Accompanying Flute       sv06-142  Item     "Reveal the top 5 cards of your opponent's deck. You may
//                                               choose any number of Basic Pokémon you find there and put
//                                               those Pokémon onto their Bench. Your opponent shuffles the
//                                               other cards back into their deck."
//   Team Rocket's Bother-Bot sv10-172  Item     "Turn 1 of your opponent's face-down Prize cards face up
//                                               and choose a random card from your opponent's hand. Your
//                                               opponent reveals that card. You may have your opponent
//                                               switch those cards. (That Prize card remains face up for
//                                               the rest of the game.)"
//   Grand Tree               sv07-136  Stadium  (ACE SPEC) "Once during each player's turn, that player may
//                                               search their deck for a Stage 1 Pokémon that evolves from 1
//                                               of their Basic Pokémon … Stage 2 … Then, that player
//                                               shuffles their deck. (Players can't evolve a Basic Pokémon
//                                               during their first turn or a Basic Pokémon that was put
//                                               into play this turn.)"
//
// Driven on the REAL ids on a LOCAL `cardPool` (D275) in the suite's OWN deck (D270). Texts off tcgdex
// (the audit's card JSON), 2026-09-28. Readings: docs/decisions.md D567 (R-AF1..3, R-BB1, R-BB2 ⚠️
// UNRULED, R-GT1, R-GT2, R-GT3 ⚠️ UNRULED).

const TICKET = "sv09-156";
const FLUTE = "sv06-142";
const BOTHER = "sv10-172";
const TREE = "sv07-136";
const FARFETCHD = "sv06-132"; // {C} Basic — "Impromptu Carrier" (onPlayToBench), R-AF2's trigger control
const EEVEE = "sv08-143"; // Eevee — "Boosted Evolution" (evolveEarlyExempt, activeOnly), R-GT3
const GENESECT = "sv06.5-040"; // Genesect — "ACE Nullifier" (Grand Tree is ACE SPEC)
const TOOL = "d567-tool";
const SPROUT = "d567-sprout";
const SAPLING = "d567-sapling";
const OAK = "d567-oak";
const PUP = "d567-pup";
const VAPOR = "d567-vapor"; // evolves from Eevee — R-GT3's candidate
const ENERGY = "d567-energy";
const FILLER = "d567-filler";

const TICKET_TEXT =
  "Count your Prize cards, shuffle them, and put them on the bottom of your deck. Then, take that many cards from the top of your deck and put them face down as your Prize cards.";
const FLUTE_TEXT =
  "Reveal the top 5 cards of your opponent's deck. You may choose any number of Basic Pokémon you find there and put those Pokémon onto their Bench. Your opponent shuffles the other cards back into their deck.";
const BOTHER_TEXT =
  "Turn 1 of your opponent's face-down Prize cards face up and choose a random card from your opponent's hand. Your opponent reveals that card. You may have your opponent switch those cards. (That Prize card remains face up for the rest of the game.)";
const TREE_TEXT =
  "Once during each player's turn, that player may search their deck for a Stage 1 Pokémon that evolves from 1 of their Basic Pokémon and put it onto that Pokémon to evolve it. If that Pokémon was evolved in this way, that player may search their deck for a Stage 2 Pokémon that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, that player shuffles their deck. (Players can't evolve a Basic Pokémon during their first turn or a Basic Pokémon that was put into play this turn.)";

const LOCAL_CARDS: Record<string, Card> = {
  [TICKET]: { ...trainerCard(TICKET, "Item", TICKET_TEXT), name: "Redeemable Ticket" },
  [FLUTE]: { ...trainerCard(FLUTE, "Item", FLUTE_TEXT), name: "Accompanying Flute" },
  [BOTHER]: { ...trainerCard(BOTHER, "Item", BOTHER_TEXT), name: "Team Rocket's Bother-Bot" },
  [TREE]: { ...trainerCard(TREE, "Stadium", TREE_TEXT), name: "Grand Tree", rarity: "ACE SPEC Rare" },
  [FARFETCHD]: battler(FARFETCHD, {
    name: "Farfetch'd",
    types: ["Colorless"],
    hp: 70,
    abilities: [{ type: "Ability", name: "Impromptu Carrier", effect: "…" }],
  }),
  [EEVEE]: battler(EEVEE, {
    name: "Eevee",
    types: ["Colorless"],
    hp: 60,
    abilities: [{ type: "Ability", name: "Boosted Evolution", effect: "…" }],
  }),
  [GENESECT]: battler(GENESECT, {
    name: "Genesect",
    types: ["Metal"],
    hp: 110,
    abilities: [
      {
        type: "Ability",
        name: "ACE Nullifier",
        effect: "If this Pokémon has a Pokémon Tool attached, your opponent can't play any ACE SPEC cards from their hand.",
      },
    ],
  }),
  [TOOL]: { ...trainerCard(TOOL, "Tool", "A D567 test Tool."), name: "D567 Tool" },
  [SPROUT]: battler(SPROUT, { name: "D567 Sprout", types: ["Grass"], hp: 60 }),
  [SAPLING]: battler(SAPLING, { name: "D567 Sapling", stage: "Stage1", evolveFrom: "D567 Sprout", types: ["Grass"], hp: 90 }),
  [OAK]: battler(OAK, { name: "D567 Oak", stage: "Stage2", evolveFrom: "D567 Sapling", types: ["Grass"], hp: 160 }),
  [PUP]: battler(PUP, { name: "D567 Pup", types: ["Water"], hp: 50 }),
  [VAPOR]: battler(VAPOR, { name: "D567 Vapor", stage: "Stage1", evolveFrom: "Eevee", types: ["Water"], hp: 110 }),
  [ENERGY]: typedEnergy(ENERGY, "Water"),
  [FILLER]: battler(FILLER, {
    name: "D567 Filler",
    hp: 900,
    retreat: 1,
    types: ["Water"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [TICKET]: 1,
  [FLUTE]: 1,
  [BOTHER]: 1,
  [TREE]: 1,
  [FARFETCHD]: 2,
  [EEVEE]: 1,
  [VAPOR]: 1,
  [SPROUT]: 4,
  [SAPLING]: 3,
  [OAK]: 2,
  [PUP]: 4,
  [ENERGY]: 10,
  [GENESECT]: 1,
  [TOOL]: 1,
  [FILLER]: 27,
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

/** p2 went first and passed: p1's turn 2 — p1's FIRST turn. */
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

/** Every hand card back into the deck, then `ids` into the hand. */
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

/** Prized copies of `id` swapped into the deck (for a deck card of ANOTHER id, a filler when
    possible) until the deck holds at least `k` copies — terminates for every id, FILLER included. */
function ensureCopies(state: GameState, seat: Seat, id: string, k = 1): GameState {
  let next = state;
  for (;;) {
    const side = next.players[seat];
    if (side.deck.filter((u) => next.cardIdByUid[u] === id).length >= k) return next;
    const prized = side.prizes.find((u) => next.cardIdByUid[u] === id);
    if (prized === undefined) throw new Error(`${seat} has fewer than ${k} ${id} to seat`);
    const other = (u: string) => next.cardIdByUid[u] !== id;
    const swap =
      side.deck.find((u) => other(u) && next.cardIdByUid[u] === FILLER) ?? side.deck.find(other);
    if (swap === undefined) throw new Error("no card to swap");
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

/** TEST SURGERY — every deck copy of `id` to the discard pile. */
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

/** TEST SURGERY — the deck's top cards become one copy each of `ids`, in that order. */
function stackTop(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  let next = state;
  for (const id of ids) next = ensureCopies(next, seat, id, ids.filter((x) => x === id).length);
  const side = next.players[seat];
  const taken: string[] = [];
  for (const id of ids) {
    const uid = side.deck.find((u) => next.cardIdByUid[u] === id && !taken.includes(u));
    if (uid === undefined) throw new Error(`${seat} has no more ${id} in the deck`);
    taken.push(uid);
  }
  return {
    ...next,
    players: { ...next.players, [seat]: { ...side, deck: [...taken, ...side.deck.filter((u) => !taken.includes(u))] } },
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

/** p1 `active` + `bench`, p2 a filler Active and an empty Bench; both hands emptied. */
function table(seed = 5671, active: string = FILLER, bench: readonly string[] = []): GameState {
  let state = setHand(setHand(opened(seed), "p1", []), "p2", []);
  state = setActiveFromDeck(ensureCopies(state, "p1", active), "p1", active);
  state = setActiveFromDeck(ensureCopies(state, "p2", FILLER), "p2", FILLER);
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of bench) state = benchFromDeck(ensureCopies(state, "p1", id), "p1", id);
  return state;
}

/** Surgery: the same board on p1's SECOND turn (turn 4 — p2 went first). */
const atTurn4 = (state: GameState): GameState => ({ ...state, turn: 4 });

function all<T extends GameEvent["type"]>(events: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const idOf = (state: GameState, uid: string | undefined) => (uid === undefined ? undefined : state.cardIdByUid[uid]);
const topOf = (p: InPlayPokemon) => p.stack[p.stack.length - 1];

function play(state: GameState, id: string): { state: GameState; events: GameEvent[] } {
  const before = setHand(state, "p1", [id]);
  const uid = before.players.p1.hand[0] as string;
  return run(before, { type: "playTrainer", seat: "p1", uid });
}

function phasePrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${state.phase.kind}`);
  return state.phase.prompt;
}

const cards = (uids: readonly string[]): GameAction =>
  ({ type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [...uids] } }) as GameAction;
const prize = (index: number): GameAction =>
  ({ type: "resolveEffect", seat: "p1", choice: { kind: "prize", index } }) as GameAction;
const confirm = (yes: boolean): GameAction =>
  ({ type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes } }) as GameAction;

/** The JSON round trip a `MatchRecord` puts a parked state through. */
const revived = (state: GameState): GameState => JSON.parse(JSON.stringify(state)) as GameState;

function logText(state: GameState, events: readonly GameEvent[]): string[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: formatElapsed(0) };
  return logFromEvents([...events], ctx).flatMap((entry) =>
    entry.kind === "action" ? [entry.segments.map((s) => s.text).join("")] : [],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — the prints, the registry rows and the new vocabulary's key sets", () => {
  it("Redeemable Ticket: ONE field-free `cycleOwnPrizes`", () => {
    expect(programFor(TICKET)).toEqual({ trainer: [{ op: "cycleOwnPrizes" }] });
  });

  it("Accompanying Flute: `lookAtTopN { whose opponent }` onto THEIR Bench, then the OPPONENT's shuffle", () => {
    expect(programFor(FLUTE)).toEqual({
      trainer: [
        {
          op: "lookAtTopN",
          n: 5,
          filter: { kind: "basicPokemon" },
          max: "any",
          dest: "bench",
          reveal: true,
          whose: "opponent",
        },
        { op: "shuffleDeck", whose: "opponent" },
      ],
    });
  });

  it("Team Rocket's Bother-Bot: turn (recorded), reveal (recorded), then the confirm behind BOTH records", () => {
    expect(programFor(BOTHER)).toEqual({
      trainer: [
        { op: "turnPrizeFaceUp", side: "opponent", recordAs: "turnedPrize" },
        { op: "randomFromOpponentHand", to: "reveal", recordAs: "revealed" },
        {
          op: "recordGate",
          slot: "turnedPrize",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          then: [
            {
              op: "recordGate",
              slot: "revealed",
              // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
              then: [
                {
                  op: "optional",
                  note: "You may have your opponent switch the revealed card with the Prize card you turned face up.",
                  // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
                  then: [{ op: "swapTurnedPrizeWithRevealed" }],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("Grand Tree: a Stadium ability (Levincia's shape) — the chosen evolve with THREE new keys, then the shuffle", () => {
    expect(programFor(TREE)).toEqual({
      stadium: {
        ability: {
          label: "Grand Tree",
          program: [
            { op: "evolveFromDeckChosen", bodyStage: "Basic", evolveTimingGates: true, thenEvolveAgain: true },
            { op: "shuffleDeck" },
          ],
        },
      },
    });
  });

  it("🛑 KEY-SET RUNG: every carrier of the new vocabulary in the WHOLE registry is one of these four rows, key set exact", () => {
    const carriers: Record<string, string[]> = {};
    const note = (key: string, id: string) => {
      carriers[key] = [...(carriers[key] ?? []), id];
    };
    for (const id of registryCardIds()) {
      const program = programFor(id);
      const lists: EffectOp[][] = [
        ...(program?.trainer === undefined ? [] : [program.trainer]),
        ...(program?.stadium?.ability === undefined ? [] : [program.stadium.ability.program]),
      ];
      for (const ops of lists) {
        for (const op of walkProgram(ops)) {
          if (op.op === "cycleOwnPrizes") note(`cycleOwnPrizes:${Object.keys(op).join(",")}`, id);
          if (op.op === "swapTurnedPrizeWithRevealed") note(`swap:${Object.keys(op).join(",")}`, id);
          if (op.op === "turnPrizeFaceUp" && (op.side !== undefined || op.recordAs !== undefined))
            note(`turnPrizeFaceUp:${Object.keys(op).join(",")}`, id);
          if (op.op === "randomFromOpponentHand" && (op.to === "reveal" || op.recordAs !== undefined))
            note(`randomFromOpponentHand:${Object.keys(op).join(",")}`, id);
          if (op.op === "lookAtTopN" && op.whose !== undefined) note(`lookAtTopN:${Object.keys(op).join(",")}`, id);
          if (
            op.op === "evolveFromDeckChosen" &&
            (op.bodyStage !== undefined || op.evolveTimingGates !== undefined || op.thenEvolveAgain !== undefined)
          )
            note(`evolveFromDeckChosen:${Object.keys(op).join(",")}`, id);
          if (op.op === "evolveFromDeck" && op.thenEvolveAgain !== undefined) note("evolveFromDeck:authored", id);
          if (op.op === "recordGate" && (op.slot === "turnedPrize" || op.slot === "revealed"))
            note(`recordGate:${op.slot}`, id);
        }
      }
    }
    expect(carriers).toEqual({
      "cycleOwnPrizes:op": [TICKET],
      "lookAtTopN:op,n,filter,max,dest,reveal,whose": [FLUTE],
      "turnPrizeFaceUp:op,side,recordAs": [BOTHER],
      "randomFromOpponentHand:op,to,recordAs": [BOTHER],
      "recordGate:turnedPrize": [BOTHER],
      "recordGate:revealed": [BOTHER],
      "swap:op": [BOTHER],
      "evolveFromDeckChosen:op,bodyStage,evolveTimingGates,thenEvolveAgain": [TREE],
    });
  });

  it("the engine is 0.548.0", () => {
    expect(engineVersion).toBe("0.548.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§2 — Redeemable Ticket: the prizes go under the deck and the top N come back face down", () => {
  it("🛑 the six prizes land UNDER the deck; the old top six become the row; deck length unchanged", () => {
    const before = table();
    const oldPrizes = [...before.players.p1.prizes];
    const staged = setHand(before, "p1", [TICKET]);
    const oldDeck = [...staged.players.p1.deck];
    const { state, events } = run(staged, { type: "playTrainer", seat: "p1", uid: staged.players.p1.hand[0] as string });
    const side = state.players.p1;
    expect(side.prizes).toEqual(oldDeck.slice(0, 6));
    expect(side.deck).toHaveLength(oldDeck.length);
    expect(side.deck.slice(0, oldDeck.length - 6)).toEqual(oldDeck.slice(6));
    expect([...side.deck.slice(-6)].sort()).toEqual([...oldPrizes].sort());
    expect(all(events, "PRIZES_CYCLED")).toEqual([{ type: "PRIZES_CYCLED", seat: "p1", count: 6 }]);
    expect(all(events, "SHUFFLE")).toEqual([]);
    expect(state.phase.kind).toBe("turn:action");
  });

  it("🛑 a Crescent Purge FACE-UP prize is retired with the rest: `faceUpPrizes` is emptied", () => {
    const base = table();
    const purged = base.players.p1.prizes[2] as string;
    const staged: GameState = {
      ...base,
      players: { ...base.players, p1: { ...base.players.p1, faceUpPrizes: [purged] } },
    };
    const { state } = play(staged, TICKET);
    expect(state.players.p1.faceUpPrizes).toEqual([]);
    expect(state.players.p1.prizes).not.toContain(purged);
    expect(state.players.p1.deck).toContain(purged);
    expect(redactGame(state, "p2").board.opponent.faceUpPrizes).toEqual([]);
    expect(redactGame(state, "p1").board.you.prizesRemaining).toBe(6);
  });

  it("🛑 the event names NO uid — neither an old prize nor a new one appears anywhere in the emitted rows", () => {
    const staged = setHand(table(), "p1", [TICKET]);
    const oldPrizes = [...staged.players.p1.prizes];
    const { state, events } = run(staged, { type: "playTrainer", seat: "p1", uid: staged.players.p1.hand[0] as string });
    const text = JSON.stringify(all(events, "PRIZES_CYCLED"));
    for (const uid of [...oldPrizes, ...state.players.p1.prizes]) expect(text).not.toContain(uid);
    expect(logText(state, events)).toContain("put 6 Prize cards on the bottom of their deck and took 6 new ones");
  });

  it("the prize shuffle spends rng and is replay-stable; the COUNT is the row's own (3 left → 3 cycled)", () => {
    const short = setPrizes(table(), "p1", 3);
    const a = play(short, TICKET);
    const b = play(short, TICKET);
    expect(a.state).toEqual(b.state);
    expect(a.state.rngState).not.toEqual(setHand(short, "p1", [TICKET]).rngState);
    expect(a.state.players.p1.prizes).toHaveLength(3);
    expect(all(a.events, "PRIZES_CYCLED")).toEqual([{ type: "PRIZES_CYCLED", seat: "p1", count: 3 }]);
    expect(logText(a.state, a.events)).toContain("put 3 Prize cards on the bottom of their deck and took 3 new ones");
  });

  it("n = 0 is a SILENT no-op: no event, no rng draw, no board change", () => {
    const base = table();
    const empty: GameState = {
      ...base,
      players: { ...base.players, p1: { ...base.players.p1, prizes: [], deck: [...base.players.p1.deck, ...base.players.p1.prizes] } },
    };
    const events: GameEvent[] = [];
    const result = runProgram(empty, [{ op: "cycleOwnPrizes" }], { seat: "p1" }, events);
    expect(result.kind).toBe("done");
    expect(result.state).toEqual(empty);
    expect(events).toEqual([]);
  });

  it("only the controller's own row moves — the opponent's prizes are untouched", () => {
    const staged = table();
    const { state } = play(staged, TICKET);
    expect(state.players.p2.prizes).toEqual(staged.players.p2.prizes);
    expect(state.players.p2.deck).toEqual(staged.players.p2.deck);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§3 — Accompanying Flute: the opponent's top 5, onto THEIR Bench", () => {
  /** p2's top five: Pup, Energy, Farfetch'd, Sapling (Stage 1), Pup. */
  const topFive = (state: GameState) => stackTop(state, "p2", [PUP, ENERGY, FARFETCHD, SAPLING, PUP]);

  it("🛑 the park: the Basics of the OPPONENT's window, `any` resolved to 3, dest bench, the controller answers", () => {
    const board = topFive(table());
    const window = board.players.p2.deck.slice(0, 5);
    const { state, events } = play(board, FLUTE);
    const prompt = phasePrompt(state);
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(prompt.candidates).toEqual([window[0], window[2], window[4]]);
    expect(prompt.max).toBe(3);
    expect(prompt.min).toBe(0);
    expect(prompt.dest).toBe("bench");
    expect(prompt.note).toBe(
      "Look at the top 5 cards of your opponent's deck and put any number of Basic Pokémon onto their Bench.",
    );
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(state.phase.seat).toBe("p1");
    expect(state.phase.answerer).toBeUndefined();
    expect(events.map((e) => e.type)).not.toContain("SHUFFLE");
  });

  it("🛑 two picks land on p2's Bench as FRESH bodies stamped this turn (R-AF1); the rest are shuffled into p2's deck", () => {
    const board = topFive(table());
    const window = board.players.p2.deck.slice(0, 5);
    const parked = play(board, FLUTE).state;
    const picks = [window[0] as string, window[2] as string];
    const { state, events } = run(parked, cards(picks));
    const bench = state.players.p2.bench;
    expect(bench.map(topOf)).toEqual(picks);
    for (const body of bench) {
      expect(body.turnPlayed).toBe(state.turn);
      expect(body.damage).toBe(0);
      expect(body.energy).toEqual([]);
    }
    expect(state.players.p2.deck).toHaveLength(board.players.p2.deck.length - 2);
    expect(state.players.p2.deck).not.toContain(picks[0]);
    expect(all(events, "DECK_TOP_REVEALED")).toEqual([
      { type: "DECK_TOP_REVEALED", seat: "p2", uids: picks, dest: "bench", reveal: true, actor: "p1" },
    ]);
    expect(all(events, "SHUFFLE")).toEqual([{ type: "SHUFFLE", seat: "p2" }]);
    expect(logText(state, events)).toContain(
      "revealed the top of Tide's deck — put D567 Pup, Farfetch'd onto Tide's Bench",
    );
  });

  it("🛑 R-AF2: the placed Farfetch'd fires NO on-play trigger — placed, not played (no park after the answer)", () => {
    const board = topFive(table());
    const window = board.players.p2.deck.slice(0, 5);
    const parked = play(board, FLUTE).state;
    const { state } = run(parked, cards([window[2] as string]));
    expect(state.phase.kind).toBe("turn:action");
    expect(idOf(state, topOf(bodyAt(state, "p2", 0)))).toBe(FARFETCHD);
  });

  it("🛑 LOSS DIRECTION: the controller's Bench, Active and deck are byte-identical after the Flute", () => {
    const board = topFive(table(5671, FILLER, [PUP]));
    const window = board.players.p2.deck.slice(0, 5);
    const staged = setHand(board, "p1", [FLUTE]);
    const parked = run(staged, { type: "playTrainer", seat: "p1", uid: staged.players.p1.hand[0] as string }).state;
    const { state } = run(parked, cards([window[0] as string, window[2] as string, window[4] as string]));
    expect(state.players.p1.bench).toEqual(staged.players.p1.bench);
    expect(state.players.p1.active).toEqual(staged.players.p1.active);
    expect(state.players.p1.deck).toEqual(staged.players.p1.deck);
    expect(state.players.p2.bench).toHaveLength(3);
  });

  it("🛑 PARTIAL: one free slot on p2's Bench — ~~three picked, the FIRST lands~~ the offer is capped at ONE (card revision B01), the others stay in p2's deck", () => {
    let board = topFive(table());
    for (let i = 0; i < 4; i++) board = benchFromDeck(ensureCopies(board, "p2", FILLER), "p2", FILLER);
    const window = board.players.p2.deck.slice(0, 5);
    const parked = play(board, FLUTE).state;
    const picks = [window[0] as string, window[2] as string, window[4] as string];
    // 🆕 Card revision B01 — the Bench clamp binds at the OFFER (`lookOwner`'s Bench): `max` is the one
    // free slot, so the three-card answer is refused; the apply's clamp stays as the belt.
    expect(parked.phase.kind === "effect:choose" && parked.phase.prompt.kind === "chooseCards" && parked.phase.prompt.max).toBe(1);
    expect(applyAction(parked, cards(picks)).ok).toBe(false);
    const { state, events } = run(parked, cards(picks.slice(0, 1)));
    expect(state.players.p2.bench).toHaveLength(5);
    expect(topOf(bodyAt(state, "p2", 4))).toBe(picks[0]);
    expect(state.players.p2.deck).toContain(picks[1]);
    expect(state.players.p2.deck).toContain(picks[2]);
    expect(all(events, "DECK_TOP_REVEALED")[0]?.uids).toEqual([picks[0]]);
  });

  it("🛑 R-AF3 — FULL: the look still happens and is announced, NONE is taken, and p2's deck is still shuffled (card revision B01: and nothing is OFFERED — no park)", () => {
    let board = topFive(table());
    for (let i = 0; i < 5; i++) board = benchFromDeck(ensureCopies(board, "p2", FILLER), "p2", FILLER);
    // 🆕 Card revision B01 — R-AF3's outcome is unchanged; its parenthetical "the park is still
    // offered" is retired: a full Bench clamps the offer to 0 and takes the whiff path (the look row,
    // then the shuffle), so there is no pick that could land nothing.
    const { state, events } = play(board, FLUTE);
    expect(state.phase.kind).toBe("turn:action");
    expect(state.players.p2.bench.map(topOf)).toEqual(board.players.p2.bench.map(topOf));
    expect(state.players.p2.deck).toHaveLength(board.players.p2.deck.length);
    expect(all(events, "DECK_TOP_REVEALED")).toEqual([
      { type: "DECK_TOP_REVEALED", seat: "p2", uids: [], dest: "bench", reveal: true, actor: "p1" },
    ]);
    expect(all(events, "SHUFFLE")).toEqual([{ type: "SHUFFLE", seat: "p2" }]);
    expect(logText(state, events)).toContain("revealed the top of Tide's deck — put nothing onto their Bench");
  });

  it("NONE: no Basic in the window — no park, the empty look row, and the shuffle", () => {
    const board = stackTop(table(), "p2", [ENERGY, SAPLING, ENERGY, OAK, ENERGY]);
    const { state, events } = play(board, FLUTE);
    expect(state.phase.kind).toBe("turn:action");
    expect(all(events, "DECK_TOP_REVEALED")).toEqual([
      { type: "DECK_TOP_REVEALED", seat: "p2", uids: [], dest: "bench", reveal: true, actor: "p1" },
    ]);
    expect(all(events, "SHUFFLE")).toEqual([{ type: "SHUFFLE", seat: "p2" }]);
    expect(state.players.p2.bench).toEqual([]);
  });

  it("the decline (empty answer) takes nothing and still shuffles p2's deck", () => {
    const board = topFive(table());
    const parked = play(board, FLUTE).state;
    const { state, events } = run(parked, cards([]));
    expect(state.players.p2.bench).toEqual([]);
    expect(all(events, "SHUFFLE")).toEqual([{ type: "SHUFFLE", seat: "p2" }]);
  });

  it("🛑 a deeper p2 card, or one of p1's own deck cards, is refused on the wire", () => {
    const board = topFive(table());
    const parked = play(board, FLUTE).state;
    const deeper = board.players.p2.deck.find((u, i) => i >= 5 && board.cardIdByUid[u] === PUP);
    const own = board.players.p1.deck.find((u) => board.cardIdByUid[u] === PUP);
    expect(deeper).toBeDefined();
    expect(own).toBeDefined();
    expect(rejected(parked, cards([deeper as string]))).not.toBe("");
    expect(rejected(parked, cards([own as string]))).not.toBe("");
  });

  it("🛑 the parked look round-trips through JSON (`MATCH_RECORD_VERSION` holds at 36) and resolves onto p2's Bench", () => {
    const board = topFive(table());
    const window = board.players.p2.deck.slice(0, 5);
    const parked = play(board, FLUTE).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(parked.phase.cont.pendingOp).toMatchObject({ op: "lookAtTopN", whose: "opponent" });
    const direct = run(parked, cards([window[0] as string]));
    const viaJson = run(revived(parked), cards([window[0] as string]));
    expect(viaJson.state).toEqual(direct.state);
    expect(viaJson.state.players.p2.bench.map(topOf)).toEqual([window[0]]);
  });

  it("an own-deck look is byte-identical: no `actor` on its row (D135)", () => {
    const board = stackTop(table(), "p1", [PUP, ENERGY, ENERGY, ENERGY, ENERGY]);
    const events: GameEvent[] = [];
    const result = runProgram(
      board,
      [{ op: "lookAtTopN", n: 5, filter: { kind: "basicPokemon" }, max: "any", dest: "bench" }],
      { seat: "p1" },
      events,
    );
    if (result.kind !== "parked") throw new Error("expected a park");
    expect(result.prompt.kind === "chooseCards" && result.prompt.note).toBe(
      "Look at the top 5 cards of your deck and put any number of Basic Pokémon onto your Bench.",
    );
    // The row itself: answered, the own-deck look writes its D135 shape with NO `actor` key.
    const pup = board.players.p1.deck[0] as string;
    const resumed: GameEvent[] = [];
    resumeProgram(result.state, result.cont, { kind: "cards", uids: [pup] }, resumed);
    const rows = all(resumed, "DECK_TOP_REVEALED");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "DECK_TOP_REVEALED", seat: "p1", uids: [pup], dest: "bench" });
    expect(rows[0] && "actor" in rows[0]).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§4 — Team Rocket's Bother-Bot: flip, reveal, and the recorded switch", () => {
  /** p2 holds Pup + Energy; `faceUp` is how many of p2's prizes are already face up (row order). */
  function botherBoard(faceUp = 0, hand: readonly string[] = [PUP, ENERGY]): GameState {
    const base = setHand(table(), "p2", hand);
    const side = base.players.p2;
    return { ...base, players: { ...base.players, p2: { ...side, faceUpPrizes: side.prizes.slice(0, faceUp) } } };
  }

  it("🛑 ≥2 face-down: the CONTROLLER parks on the OPPONENT's face-down indices, in the opponent's wording (R-BB2)", () => {
    const board = botherBoard(0);
    const { state } = play(board, BOTHER);
    const prompt = phasePrompt(state);
    expect(prompt).toEqual({
      kind: "choosePrize",
      indices: [0, 1, 2, 3, 4, 5],
      note: "Choose 1 of your opponent's face-down Prize cards to turn face up.",
    });
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(state.phase.seat).toBe("p1");
    expect(state.phase.answerer).toBeUndefined();
    // Nothing turned and nothing revealed before the answer.
    expect(state.players.p2.faceUpPrizes).toEqual([]);
  });

  it("🛑 the answer turns p2's slot (actor p1), a random p2 hand card is REVEALED and stays put, then the confirm parks", () => {
    const board = botherBoard(0);
    const parked = play(board, BOTHER).state;
    const { state, events } = run(parked, prize(3));
    const turned = board.players.p2.prizes[3] as string;
    expect(all(events, "PRIZE_TURNED_FACE_UP")).toEqual([
      { type: "PRIZE_TURNED_FACE_UP", seat: "p2", index: 3, uid: turned, actor: "p1" },
    ]);
    expect(state.players.p2.faceUpPrizes).toEqual([turned]);
    expect(state.players.p1.faceUpPrizes).toEqual([]);
    const [reveal] = all(events, "RANDOM_CARD_REVEALED");
    expect(reveal?.seat).toBe("p2");
    expect(reveal?.actor).toBe("p1");
    expect(board.players.p2.hand).toContain(reveal?.uid);
    expect(state.players.p2.hand).toEqual(board.players.p2.hand);
    expect(state.rngState).not.toEqual(parked.rngState); // the random pick spent a draw
    expect(all(events, "RANDOM_CARD_TAKEN")).toEqual([]);
    expect(phasePrompt(state)).toMatchObject({ kind: "confirm" });
    const rows = logText(state, events);
    expect(rows.some((r) => r.startsWith("turned Tide's ") && r.endsWith(" face up (Prize 4)"))).toBe(true);
    expect(rows.some((r) => r.startsWith("chose a random card from Tide's hand — Tide revealed "))).toBe(true);
  });

  it("🛑 YES: the hand card takes THAT slot face up (R-BB1), the prize card goes to p2's hand", () => {
    const board = botherBoard(0);
    const afterTurn = run(play(board, BOTHER).state, prize(3));
    const revealed = all(afterTurn.events, "RANDOM_CARD_REVEALED")[0]?.uid as string;
    const turned = board.players.p2.prizes[3] as string;
    const { state, events } = run(afterTurn.state, confirm(true));
    const side = state.players.p2;
    expect(side.prizes[3]).toBe(revealed);
    expect(side.prizes).toHaveLength(6);
    expect(side.faceUpPrizes).toEqual([revealed]);
    expect(side.hand).toContain(turned);
    expect(side.hand).not.toContain(revealed);
    expect(side.hand).toHaveLength(2);
    expect(all(events, "PRIZE_SWITCHED_WITH_HAND")).toEqual([
      { type: "PRIZE_SWITCHED_WITH_HAND", seat: "p2", actor: "p1", index: 3, prizeUid: turned, handUid: revealed },
    ]);
    expect(redactGame(state, "p1").board.opponent.faceUpPrizes.map((p) => [p.index, p.card.id])).toEqual([
      [3, revealed],
    ]);
    expect(logText(state, events).some((r) => r.startsWith("had Tide switch "))).toBe(true);
    expect(state.phase.kind).toBe("turn:action");
  });

  it("NO: the decline switches nothing — the turned prize stays face up in its slot and the hand is unchanged", () => {
    const board = botherBoard(0);
    const afterTurn = run(play(board, BOTHER).state, prize(1));
    const { state, events } = run(afterTurn.state, confirm(false));
    expect(state.players.p2.prizes).toEqual(board.players.p2.prizes);
    expect(state.players.p2.faceUpPrizes).toEqual([board.players.p2.prizes[1]]);
    expect(state.players.p2.hand).toEqual(board.players.p2.hand);
    expect(all(events, "PRIZE_SWITCHED_WITH_HAND")).toEqual([]);
  });

  it("EXACTLY ONE face-down: turned inline (no choosePrize), then the confirm", () => {
    const board = botherBoard(5);
    const { state, events } = play(board, BOTHER);
    expect(all(events, "PRIZE_TURNED_FACE_UP").map((e) => e.index)).toEqual([5]);
    expect(phasePrompt(state)).toMatchObject({ kind: "confirm" });
  });

  it("🛑 §8.6 — ZERO face-down (every prize already face up): nothing turns, the reveal still happens, NO switch is offered", () => {
    const board = botherBoard(6);
    const { state, events } = play(board, BOTHER);
    expect(all(events, "PRIZE_TURNED_FACE_UP")).toEqual([]);
    expect(all(events, "RANDOM_CARD_REVEALED")).toHaveLength(1);
    expect(state.phase.kind).toBe("turn:action");
    expect(state.players.p2.prizes).toEqual(board.players.p2.prizes);
    expect(state.players.p2.hand).toEqual(board.players.p2.hand);
  });

  it("🛑 §8.6 — EMPTY HAND: the prize is still turned, nothing is revealed, NO switch is offered", () => {
    const board = botherBoard(5, []);
    const { state, events } = play(board, BOTHER);
    expect(all(events, "PRIZE_TURNED_FACE_UP")).toHaveLength(1);
    expect(all(events, "RANDOM_CARD_REVEALED")).toEqual([]);
    expect(state.phase.kind).toBe("turn:action");
    expect(state.rngState).toEqual(board.rngState);
  });

  it("🛑 THE HAZARD: a Crescent Purge prize already face up is LEFT ALONE — the switch addresses the prize THIS card turned", () => {
    const board = botherBoard(1);
    const purged = board.players.p2.prizes[0] as string;
    const parked = play(board, BOTHER).state;
    expect(phasePrompt(parked)).toMatchObject({ kind: "choosePrize", indices: [1, 2, 3, 4, 5] });
    const afterTurn = run(parked, prize(4));
    const revealed = all(afterTurn.events, "RANDOM_CARD_REVEALED")[0]?.uid as string;
    const { state } = run(afterTurn.state, confirm(true));
    const side = state.players.p2;
    expect(side.prizes[0]).toBe(purged);
    expect(side.prizes[4]).toBe(revealed);
    expect(side.faceUpPrizes).toEqual([purged, revealed]);
    expect(side.hand).not.toContain(purged);
  });

  it("🛑 …and with the Purge prize the ONLY face-up one and none face down, it is not switched either", () => {
    const board = botherBoard(6);
    const { state } = play(board, BOTHER);
    expect(state.players.p2.faceUpPrizes).toEqual(board.players.p2.faceUpPrizes);
    expect(state.players.p2.prizes).toEqual(board.players.p2.prizes);
  });

  it("the controller's OWN prize row is never touched", () => {
    const board = botherBoard(0);
    const afterTurn = run(play(board, BOTHER).state, prize(0));
    const { state } = run(afterTurn.state, confirm(true));
    expect(state.players.p1.prizes).toEqual(board.players.p1.prizes);
    expect(state.players.p1.faceUpPrizes).toEqual([]);
  });

  it("🛑 a FACE-UP index or an out-of-range one is refused on the wire (the offer is the face-down indices)", () => {
    const parked = play(botherBoard(1), BOTHER).state;
    expect(rejected(parked, prize(0))).not.toBe("");
    expect(rejected(parked, prize(6))).not.toBe("");
  });

  it("🛑 both parks round-trip through JSON (`MATCH_RECORD_VERSION` holds at 36): the op's keys and the RECORD survive", () => {
    const board = botherBoard(0);
    const parked = play(board, BOTHER).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(parked.phase.cont.pendingOp).toEqual({ op: "turnPrizeFaceUp", side: "opponent", recordAs: "turnedPrize" });
    const direct = run(parked, prize(2));
    const viaJson = run(revived(parked), prize(2));
    expect(viaJson.state).toEqual(direct.state);
    const confirmPark = viaJson.state;
    if (confirmPark.phase.kind !== "effect:choose") throw new Error("expected the confirm park");
    expect(Object.keys(confirmPark.phase.cont.record ?? {}).sort()).toEqual(["revealed", "turnedPrize"]);
    const yesDirect = run(confirmPark, confirm(true));
    const yesJson = run(revived(confirmPark), confirm(true));
    expect(yesJson.state).toEqual(yesDirect.state);
    expect(yesJson.state.players.p2.prizes[2]).toBe(confirmPark.phase.cont.record?.revealed?.[0]);
  });

  it("the D548 own-side flip is byte-identical: no `actor`, the owner's wording", () => {
    const board = table();
    const events: GameEvent[] = [];
    const result = runProgram(board, [{ op: "turnPrizeFaceUp" }], { seat: "p1" }, events);
    if (result.kind !== "parked") throw new Error("expected a park");
    expect(result.prompt).toEqual({
      kind: "choosePrize",
      indices: [0, 1, 2, 3, 4, 5],
      note: "Choose 1 of your face-down Prize cards to turn face up.",
    });
    // The row itself: answered, the own-side flip writes the D548 shape with NO `actor` key.
    const resumed: GameEvent[] = [];
    resumeProgram(result.state, result.cont, { kind: "prize", index: 2 }, resumed);
    expect(all(resumed, "PRIZE_TURNED_FACE_UP")).toEqual([
      { type: "PRIZE_TURNED_FACE_UP", seat: "p1", index: 2, uid: board.players.p1.prizes[2] },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§5 — Grand Tree: the Stadium evolve, Basic bodies only, with a printed timing gate and a chained Stage 2", () => {
  /** p1: filler Active, a Sprout on the Bench; Grand Tree in play (played from the hand). */
  function treeBoard(turn4 = true, bench: readonly string[] = [SPROUT]): GameState {
    const base = table(5671, FILLER, bench);
    const played = play(base, TREE).state;
    return turn4 ? atTurn4(played) : played;
  }
  const use = (state: GameState, seat: Seat = "p1") => run(state, { type: "useStadiumAbility", seat });

  it("the premise: the Stadium is in play and the board is p1's", () => {
    const state = treeBoard();
    expect(idOf(state, state.stadium?.uid)).toBe(TREE);
    expect(state.phase.kind).toBe("turn:action");
  });

  it("🛑 FIRST TURN (§4, printed): no body is offered — nothing evolves, the deck is still shuffled", () => {
    const board = treeBoard(false);
    const { state, events } = use(board);
    expect(state.phase.kind).toBe("turn:action");
    expect(all(events, "POKEMON_EVOLVED")).toEqual([]);
    expect(all(events, "SHUFFLE")).toEqual([{ type: "SHUFFLE", seat: "p1" }]);
    expect(idOf(state, topOf(bodyAt(state, "p1", 0)))).toBe(SPROUT);
  });

  it("🛑 ENTERED THIS TURN (§10, printed): a Sprout with `turnPlayed` = this turn is not offered", () => {
    const board = withBody(treeBoard(), "p1", 0, (p) => ({ ...p, turnPlayed: 4 }));
    const { state, events } = use(board);
    expect(state.phase.kind).toBe("turn:action");
    expect(all(events, "POKEMON_EVOLVED")).toEqual([]);
  });

  it("🛑 STAGE 1 ONLY: the single Basic is forced, the Sapling is offered, and with no Stage 2 in the deck nothing more parks", () => {
    const board = purge(treeBoard(), "p1", OAK);
    const parked = use(board).state;
    const prompt = phasePrompt(parked);
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(prompt.dest).toBe("evolve");
    expect(prompt.min).toBe(0);
    expect(prompt.candidates.every((u) => parked.cardIdByUid[u] === SAPLING)).toBe(true);
    const { state, events } = run(parked, cards([prompt.candidates[0] as string]));
    expect(state.phase.kind).toBe("turn:action");
    expect(idOf(state, topOf(bodyAt(state, "p1", 0)))).toBe(SAPLING);
    expect(all(events, "POKEMON_EVOLVED")).toHaveLength(1);
    expect(all(events, "SHUFFLE")).toEqual([{ type: "SHUFFLE", seat: "p1" }]);
  });

  it("🛑 STAGE 1 + STAGE 2 (R-GT1): the Stage 2 park offers only what evolves from the NEW top, and it lands the same turn", () => {
    const parked = use(treeBoard()).state;
    const first = phasePrompt(parked);
    if (first.kind !== "chooseCards") throw new Error("expected chooseCards");
    const second = run(parked, cards([first.candidates[0] as string]));
    const prompt = phasePrompt(second.state);
    if (prompt.kind !== "chooseCards") throw new Error("expected the Stage 2 park");
    expect(prompt.candidates.length).toBeGreaterThan(0);
    expect(prompt.candidates.every((u) => second.state.cardIdByUid[u] === OAK)).toBe(true);
    expect(prompt.min).toBe(0);
    expect(all(second.events, "SHUFFLE")).toEqual([]);
    const { state, events } = run(second.state, cards([prompt.candidates[0] as string]));
    const body = bodyAt(state, "p1", 0);
    expect(body.stack.map((u) => state.cardIdByUid[u])).toEqual([SPROUT, SAPLING, OAK]);
    expect(all(events, "SHUFFLE")).toEqual([{ type: "SHUFFLE", seat: "p1" }]);
    expect(state.phase.kind).toBe("turn:action");
  });

  it("🛑 STAGE 2 DECLINED: the empty answer keeps the Sapling on top, and the deck is shuffled", () => {
    const parked = use(treeBoard()).state;
    const first = phasePrompt(parked);
    if (first.kind !== "chooseCards") throw new Error("expected chooseCards");
    const second = run(parked, cards([first.candidates[0] as string])).state;
    const { state, events } = run(second, cards([]));
    expect(idOf(state, topOf(bodyAt(state, "p1", 0)))).toBe(SAPLING);
    expect(all(events, "SHUFFLE")).toEqual([{ type: "SHUFFLE", seat: "p1" }]);
    expect(state.phase.kind).toBe("turn:action");
  });

  it("🛑 STAGE 1 DECLINED: no Stage 2 is offered (\"If that Pokémon was evolved in this way\")", () => {
    const parked = use(treeBoard()).state;
    const { state, events } = run(parked, cards([]));
    expect(state.phase.kind).toBe("turn:action");
    expect(idOf(state, topOf(bodyAt(state, "p1", 0)))).toBe(SPROUT);
    expect(all(events, "SHUFFLE")).toEqual([{ type: "SHUFFLE", seat: "p1" }]);
  });

  it("🛑 A NON-BASIC BODY IS NOT OFFERED: a Sapling in play with an Oak in the deck is skipped, so the Sprout is forced", () => {
    const board = treeBoard(true, [SPROUT, SAPLING]);
    const parked = use(board).state;
    const prompt = phasePrompt(parked);
    if (prompt.kind !== "chooseCards") throw new Error("expected the forced body's card park");
    expect(prompt.candidates.every((u) => parked.cardIdByUid[u] === SAPLING)).toBe(true);
    // D309's plain op, on the SAME board, offers BOTH bodies — the narrowing is Grand Tree's key.
    const events: GameEvent[] = [];
    const plain = runProgram(board, [{ op: "evolveFromDeckChosen" }], { seat: "p1" }, events);
    if (plain.kind !== "parked") throw new Error("expected the body park");
    expect(plain.prompt.kind).toBe("choosePokemon");
    expect(plain.prompt.kind === "choosePokemon" && plain.prompt.candidates).toHaveLength(2);
  });

  it("🛑 TWO eligible Basics: the body question PARKS, and the ANSWER carries the chain (the Stage 2 is still asked)", () => {
    const board = treeBoard(true, [SPROUT, SPROUT]);
    const parked = use(board).state;
    const body = phasePrompt(parked);
    expect(body.kind).toBe("choosePokemon");
    const first = run(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 1 } } },
    } as GameAction).state;
    const stage1 = phasePrompt(first);
    if (stage1.kind !== "chooseCards") throw new Error("expected the Stage 1 park");
    const second = run(first, cards([stage1.candidates[0] as string])).state;
    const stage2 = phasePrompt(second);
    if (stage2.kind !== "chooseCards") throw new Error("expected the Stage 2 park");
    expect(stage2.candidates.every((u) => second.cardIdByUid[u] === OAK)).toBe(true);
    const { state } = run(second, cards([stage2.candidates[0] as string]));
    expect(bodyAt(state, "p1", 1).stack.map((u) => state.cardIdByUid[u])).toEqual([SPROUT, SAPLING, OAK]);
    expect(bodyAt(state, "p1", 0).stack.map((u) => state.cardIdByUid[u])).toEqual([SPROUT]);
  });

  it("🛑 D307/R-SV1 RE-AFFIRMED: the plain op still offers a first-turn, entered-this-turn body (the gate is Grand Tree's alone)", () => {
    const board = withBody(treeBoard(false), "p1", 0, (p) => ({ ...p, turnPlayed: 2 }));
    const events: GameEvent[] = [];
    const plain = runProgram(board, [{ op: "evolveFromDeckChosen" }], { seat: "p1" }, events);
    expect(plain.kind).toBe("parked");
  });

  it("🛑 R-GT3 (UNRULED): an Eevee licensed by \"Boosted Evolution\" gets NO exemption on the first turn", () => {
    const base = table(5671, EEVEE);
    const board = play(base, TREE).state;
    const { state, events } = use(board);
    expect(state.phase.kind).toBe("turn:action");
    expect(all(events, "POKEMON_EVOLVED")).toEqual([]);
  });

  it("🛑 ACE SPEC (D303 re-affirmed): under an ARMED ACE Nullifier the BUILT Grand Tree is refused HAND_PLAY_BLOCKED", () => {
    let board = table();
    board = setActiveFromDeck(ensureCopies(board, "p2", GENESECT), "p2", GENESECT);
    board = clearBench(board, "p2");
    board = ensureCopies(board, "p2", TOOL);
    const tool = board.players.p2.deck.find((u) => board.cardIdByUid[u] === TOOL) as string;
    board = withBody(
      { ...board, players: { ...board.players, p2: { ...board.players.p2, deck: board.players.p2.deck.filter((u) => u !== tool) } } },
      "p2",
      "active",
      (p) => ({ ...p, tools: [tool] }),
    );
    const staged = setHand(board, "p1", [TREE]);
    expect(rejected(staged, { type: "playTrainer", seat: "p1", uid: staged.players.p1.hand[0] as string })).toBe(
      "HAND_PLAY_BLOCKED",
    );
  });

  it("🛑 ONCE PER TURN, FOR EACH PLAYER: a second use is refused; the opponent uses it on their own turn", () => {
    const board = purge(treeBoard(), "p1", SAPLING);
    const used = use(board).state;
    expect(rejected(used, { type: "useStadiumAbility", seat: "p1" })).toBe("STADIUM_ABILITY_ALREADY_USED");
    const p2Turn = run(used, { type: "endTurn", seat: "p1" }).state;
    expect(p2Turn.phase.kind === "turn:action" && p2Turn.phase.seat).toBe("p2");
    const { events } = use(p2Turn, "p2");
    expect(all(events, "STADIUM_ABILITY_ACTIVATED")).toHaveLength(1);
  });

  it("🛑 the Stage 1 park round-trips through JSON with `thenEvolveAgain` and resumes into the Stage 2 question", () => {
    const parked = use(treeBoard()).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(parked.phase.cont.pendingOp).toMatchObject({ op: "evolveFromDeck", thenEvolveAgain: true });
    const first = phasePrompt(parked);
    if (first.kind !== "chooseCards") throw new Error("expected chooseCards");
    const direct = run(parked, cards([first.candidates[0] as string]));
    const viaJson = run(revived(parked), cards([first.candidates[0] as string]));
    expect(viaJson.state).toEqual(direct.state);
    expect(phasePrompt(viaJson.state).kind).toBe("chooseCards");
  });

  it("🛑 a pick the offer did not hold buys no Stage 2 (the chain re-derives the offer, `evolveFromDeckMove`'s belt)", () => {
    const board = treeBoard();
    const events: GameEvent[] = [];
    const result = runProgram(
      board,
      [{ op: "evolveFromDeck", onto: { spot: "bench", index: 0 }, thenEvolveAgain: true }],
      { seat: "p1" },
      events,
    );
    if (result.kind !== "parked") throw new Error("expected a park");
    const oak = board.players.p1.deck.find((u) => board.cardIdByUid[u] === OAK) as string;
    expect(result.cont.pendingOp).toMatchObject({ op: "evolveFromDeck", thenEvolveAgain: true });
    // The wire refuses the uid outright ...
    expect(applyAction(result.state, cards([oak])).ok).toBe(false);
    // ... so the belt is driven BELOW the wire (review, D567): `resumeProgram` takes an
    // already-validated choice, and a Stage 2 the Stage 1 offer never held places
    // nothing (`evolveFromDeckMove`'s belt) AND buys no second question
    // (`chainedEvolveAnswered`'s `offer.candidates.includes` guard) — without the guard,
    // a second `evolveFromDeck` onto the Sprout would be bought and would ask for (or
    // force) the Sapling. Mutant `D567-chain-bought-on-a-foreign-pick`.
    const resumed: GameEvent[] = [];
    const out = resumeProgram(result.state, result.cont, { kind: "cards", uids: [oak] }, resumed);
    expect(out.kind).toBe("done");
    expect(all(resumed, "POKEMON_EVOLVED")).toEqual([]);
    expect(bodyAt(out.state, "p1", 0).stack.map((u) => out.state.cardIdByUid[u])).toEqual([SPROUT]);
  });
});
