import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { type EffectContext, runProgram } from "./interpreter";
import { redactGame } from "./redact";
import { programFor } from "./registry";
import { FIXTURE_POOL, battler, clearBench, deckOf, setActiveFromDeck, specialEnergy, trainerCard, benchFromDeck } from "./testFixtures";
import type { InPlayPokemon } from "./types";

// ── 🆕🆕🆕 D565 — RUFFIAN: THE BODY-FIRST PICK ──
//
//   Ruffian  sv09-157 / sv09-181  Supporter  "Discard a Pokémon Tool and a Special Energy from 1 of your
//                                            opponent's Pokémon."
//
// ONE question (which opponent body — the ones carrying a Tool OR a Special Energy, shield-filtered),
// whose answer buys the two body-narrowed discards (`discardTools { count 1, bodyUid }` and
// `discardEnergy { from "opponentChosen", specialEnergy, count 1, bodyUid }`). Driven on the REAL
// ids on a LOCAL `cardPool` (D275) in the suite's OWN deck (D270). Text off tcgdex (the audit's
// card JSON), 2026-09-28. Reading R-RU1: docs/decisions.md D565.

const RUFFIAN = ["sv09-157", "sv09-181"] as const;
const FRAXURE = "sv06.5-045";
const FILLER = "d565r-filler";
const TOOL = "d565r-tool";
const SPECIAL = "fix-special";
const SPECIAL_2 = "fix-special-2";
const BASIC = "fix-energy";

const RUFFIAN_TEXT = "Discard a Pokémon Tool and a Special Energy from 1 of your opponent's Pokémon.";

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(RUFFIAN.map((id) => [id, { ...trainerCard(id, "Supporter", RUFFIAN_TEXT), name: "Ruffian" }])),
  [FRAXURE]: battler(FRAXURE, {
    name: "Fraxure",
    stage: "Stage1",
    evolveFrom: "Axew",
    types: ["Dragon"],
    hp: 100,
    abilities: [
      {
        type: "Ability",
        name: "Unnerve",
        effect: "Prevent all effects of your opponent's Item and Supporter cards done to this Pokémon.",
      },
    ],
  }),
  [FILLER]: battler(FILLER, {
    name: "D565 Ruffian Filler",
    hp: 900,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  // A SIMULATED Tool is not required here — Ruffian discards whatever Tool is attached.
  [TOOL]: { ...trainerCard(TOOL, "Tool", "A D565 test Tool."), name: "D565 Tool" },
  [SPECIAL_2]: specialEnergy(SPECIAL_2, "fix-special-2"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [RUFFIAN[0]]: 2,
  [RUFFIAN[1]]: 2,
  [FRAXURE]: 2,
  [TOOL]: 4,
  [SPECIAL]: 4,
  [SPECIAL_2]: 2,
  [BASIC]: 8,
  [FILLER]: 36,
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

/** p1's turn 2: plain bodies, p2 `oppActive` + `oppBench`; hands emptied into the decks. */
function table(oppActive: string = FILLER, oppBench: readonly string[] = [], seed = 5652): GameState {
  let state = setHand(setHand(opened(seed), "p1", []), "p2", []);
  state = setActiveFromDeck(state, "p1", FILLER);
  state = setActiveFromDeck(ensureInDeck(state, "p2", oppActive), "p2", oppActive);
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of oppBench) state = benchFromDeck(ensureInDeck(state, "p2", id), "p2", id);
  return state;
}

function all<T extends GameEvent["type"]>(events: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const idsOf = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);

function play(state: GameState, id: string = RUFFIAN[0]): { state: GameState; events: GameEvent[] } {
  const before = setHand(state, "p1", [id]);
  return run(before, { type: "playTrainer", seat: "p1", uid: before.players.p1.hand[0] as string });
}

const pick = (spot: { spot: "active" } | { spot: "bench"; index: number }): GameAction =>
  ({ type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref: { seat: "p2", spot } } }) as GameAction;

// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — the print and the registry row", () => {
  it("one field-free body-first op; the reprint shares the object; only a `trainer` key", () => {
    const first = programFor(RUFFIAN[0]);
    expect(first).toEqual({ trainer: [{ op: "discardToolAndSpecialEnergyChosen" }] });
    expect(programFor(RUFFIAN[1])).toBe(first);
  });

  it("the engine is 0.542.0", () => {
    expect(engineVersion).toBe("0.542.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§2 — one body qualifies: the pick is forced, both halves come off THAT body", () => {
  it("🛑 a Tool and a Special Energy on the Active: both discarded to the OPPONENT's pile, the Basic stays", () => {
    let state = table();
    state = attach(state, "p2", "active", TOOL, "tools");
    state = attach(state, "p2", "active", SPECIAL);
    state = attach(state, "p2", "active", BASIC);
    const { state: after, events } = play(state, RUFFIAN[1]);
    expect(after.phase.kind).toBe("turn:action");
    expect(bodyAt(after, "p2", "active").tools).toEqual([]);
    expect(idsOf(after, bodyAt(after, "p2", "active").energy)).toEqual([BASIC]);
    expect(idsOf(after, after.players.p2.discard)).toEqual(expect.arrayContaining([TOOL, SPECIAL]));
    expect(all(events, "TOOLS_DISCARDED")).toHaveLength(1);
    expect(all(events, "ENERGY_DISCARDED")).toHaveLength(1);
    // The Tool half first, then the Special Energy — the print's order.
    expect(events.findIndex((e) => e.type === "TOOLS_DISCARDED")).toBeLessThan(
      events.findIndex((e) => e.type === "ENERGY_DISCARDED"),
    );
  });

  it("🛑 R-RU1: a body with ONLY a Tool is a legal pick — the Tool comes off, the Energy half whiffs", () => {
    const state = attach(table(), "p2", "active", TOOL, "tools");
    const { state: after, events } = play(state);
    expect(bodyAt(after, "p2", "active").tools).toEqual([]);
    expect(all(events, "ENERGY_DISCARDED")).toHaveLength(0);
  });

  it("🛑 R-RU1: a body with ONLY a Special Energy is a legal pick — the Energy comes off, the Tool half whiffs", () => {
    const state = attach(table(), "p2", "active", SPECIAL);
    const { state: after, events } = play(state);
    expect(bodyAt(after, "p2", "active").energy).toEqual([]);
    expect(all(events, "TOOLS_DISCARDED")).toHaveLength(0);
  });

  it("🛑 the Tool half is MANDATORY: one Tool on the body comes off INLINE, no take-or-decline park", () => {
    const state = attach(table(), "p2", "active", TOOL, "tools");
    const { state: after } = play(state);
    expect(after.phase.kind).toBe("turn:action");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§3 — several bodies qualify: the pick parks, and the answer narrows BOTH halves", () => {
  function loaded(): GameState {
    let state = table(FILLER, [FILLER, FILLER]);
    state = attach(state, "p2", "active", TOOL, "tools");
    state = attach(state, "p2", "active", SPECIAL);
    state = attach(state, "p2", 1, TOOL, "tools");
    state = attach(state, "p2", 1, SPECIAL);
    return state;
  }

  it("🛑 the offer is exactly the qualifying bodies (the bare Bench 0 is not), Active first", () => {
    const { state } = play(loaded());
    if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "choosePokemon") {
      throw new Error("expected a choosePokemon park");
    }
    expect(state.phase.prompt.note).toBe(
      "Discard a Pokémon Tool and a Special Energy from which of your opponent's Pokémon?",
    );
    expect(state.phase.prompt.candidates).toEqual([
      { seat: "p2", spot: { spot: "active" } },
      { seat: "p2", spot: { spot: "bench", index: 1 } },
    ]);
  });

  it("🛑 answering Bench 1 strips Bench 1 ONLY — the Active keeps its Tool and its Special Energy", () => {
    const parked = play(loaded()).state;
    const { state } = run(parked, pick({ spot: "bench", index: 1 }));
    expect(state.phase.kind).toBe("turn:action");
    expect(bodyAt(state, "p2", 1).tools).toEqual([]);
    expect(bodyAt(state, "p2", 1).energy).toEqual([]);
    expect(bodyAt(state, "p2", "active").tools).toHaveLength(1);
    expect(bodyAt(state, "p2", "active").energy).toHaveLength(1);
  });

  it("🛑 an unoffered body over the wire is refused", () => {
    const parked = play(loaded()).state;
    expect(applyAction(parked, pick({ spot: "bench", index: 0 })).ok).toBe(false);
  });

  it("two DIFFERENT Special Energy on the picked body: the Energy half asks which one — of THAT body only", () => {
    let state = loaded();
    state = attach(state, "p2", 1, SPECIAL_2);
    const parked = play(state).state;
    const second = run(parked, pick({ spot: "bench", index: 1 })).state;
    if (second.phase.kind !== "effect:choose" || second.phase.prompt.kind !== "discardEnergy") {
      throw new Error("expected a discardEnergy park");
    }
    const hosts = second.phase.prompt.discardable.map((d) => d.from);
    expect(hosts.every((ref) => ref.seat === "p2" && ref.spot.spot === "bench" && ref.spot.index === 1)).toBe(true);
    expect(second.phase.prompt.discardable).toHaveLength(2);
    // The Tool half already came off, before the Energy question.
    expect(bodyAt(second, "p2", 1).tools).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§4 — the shield and the refusal", () => {
  it("🛑 a SHIELDED body (Fraxure \"Unnerve\") is not offered: with the Active also loaded, the pick is forced to it", () => {
    let state = table(FILLER, [FRAXURE]);
    state = attach(state, "p2", "active", TOOL, "tools");
    state = attach(state, "p2", 0, TOOL, "tools");
    state = attach(state, "p2", 0, SPECIAL);
    const { state: after, events } = play(state);
    expect(after.phase.kind).toBe("turn:action");
    expect(bodyAt(after, "p2", "active").tools).toEqual([]);
    expect(bodyAt(after, "p2", 0).tools).toHaveLength(1);
    expect(bodyAt(after, "p2", 0).energy).toHaveLength(1);
    expect(all(events, "TRAINER_EFFECT_PREVENTED")).toHaveLength(1);
  });

  it("🛑 no opponent body carries a Tool or a Special Energy: the play is REFUSED (a card that could only whiff)", () => {
    const state = attach(table(), "p2", "active", BASIC);
    const before = setHand(state, "p1", [RUFFIAN[0]]);
    const result = applyAction(before, { type: "playTrainer", seat: "p1", uid: before.players.p1.hand[0] as string });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NO_LEGAL_TARGET");
  });

  it("…and YOUR OWN Tool never makes it playable (the offer is the opponent's side only)", () => {
    const state = attach(table(), "p1", "active", TOOL, "tools");
    const before = setHand(state, "p1", [RUFFIAN[0]]);
    expect(applyAction(before, { type: "playTrainer", seat: "p1", uid: before.players.p1.hand[0] as string }).ok).toBe(
      false,
    );
  });

  it("the online HUD greys the card on the refused board and lights it on a legal one", () => {
    const refusedBoard = setHand(attach(table(), "p2", "active", BASIC), "p1", [RUFFIAN[0]]);
    const legalBoard = setHand(attach(table(), "p2", "active", SPECIAL), "p1", [RUFFIAN[0]]);
    const playable = (state: GameState) => {
      const phase = redactGame(state, "p1").phase;
      if (phase.kind !== "turn:action") throw new Error("expected turn:action");
      const row = phase.trainers.find((t) => t.uid === state.players.p1.hand[0]);
      if (row === undefined) throw new Error("no Ruffian row");
      return !row.disabled;
    };
    expect(playable(refusedBoard)).toBe(false);
    expect(playable(legalBoard)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§5 — the narrowing keys, driven through the interpreter", () => {
  const ctx: EffectContext = { seat: "p1", invokedBy: "supporter" };

  it("🛑 `discardTools.bodyUid` takes the Tool off THAT body only; absent, it would offer both", () => {
    let state = table(FILLER, [FILLER]);
    state = attach(state, "p2", "active", TOOL, "tools");
    state = attach(state, "p2", 0, TOOL, "tools");
    const benchUid = bodyAt(state, "p2", 0).stack.at(-1) as string;
    const events: GameEvent[] = [];
    const ops: EffectOp[] = [{ op: "discardTools", count: 1, bodyUid: benchUid }];
    const out = runProgram(state, ops, ctx, events);
    if (out.kind !== "done") throw new Error("expected done");
    expect(bodyAt(out.state, "p2", 0).tools).toEqual([]);
    expect(bodyAt(out.state, "p2", "active").tools).toHaveLength(1);
    // The unnarrowed op is the D543 up-to park over BOTH Tools.
    const wide = runProgram(state, [{ op: "discardTools", count: 1 }], ctx, []);
    expect(wide.kind).toBe("parked");
  });

  it("🛑 `discardEnergy { from: \"opponentChosen\", bodyUid }` takes the Special Energy off THAT body only", () => {
    let state = table(FILLER, [FILLER]);
    state = attach(state, "p2", "active", SPECIAL);
    state = attach(state, "p2", 0, SPECIAL);
    const benchUid = bodyAt(state, "p2", 0).stack.at(-1) as string;
    const events: GameEvent[] = [];
    const out = runProgram(
      state,
      [{ op: "discardEnergy", from: "opponentChosen", filter: { kind: "specialEnergy" }, count: 1, bodyUid: benchUid }],
      ctx,
      events,
    );
    if (out.kind !== "done") throw new Error("expected done");
    expect(bodyAt(out.state, "p2", 0).energy).toEqual([]);
    expect(bodyAt(out.state, "p2", "active").energy).toHaveLength(1);
  });

  it("🛑 the parked pick round-trips through JSON (`MATCH_RECORD_VERSION` holds at 36) and resumes", () => {
    let state = table(FILLER, [FILLER]);
    state = attach(state, "p2", "active", TOOL, "tools");
    state = attach(state, "p2", 0, SPECIAL);
    const parked = play(state).state;
    const revived = JSON.parse(JSON.stringify(parked)) as GameState;
    expect(revived).toEqual(parked);
    if (revived.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(revived.phase.cont.pendingOp).toEqual({ op: "discardToolAndSpecialEnergyChosen" });
    const { state: done } = run(revived, pick({ spot: "bench", index: 0 }));
    expect(bodyAt(done, "p2", 0).energy).toEqual([]);
    expect(bodyAt(done, "p2", "active").tools).toHaveLength(1);
  });
});
