import { describe, expect, it } from "vitest";
import {
  HAND_SIZE,
  PRIZE_COUNT,
  applyAction,
  createGame,
  isBasicPokemon,
  isEnergyCard,
  otherSeat,
  retreatCostOf,
  topCardOf,
} from "./index";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import {
  ALL_BASIC_DECK,
  FIXTURE_POOL,
  MIXED_DECK,
  ONE_BASIC_DECK,
  deepFreeze,
  driveSetup,
  expectErr,
  handUid,
  must,
  mustApply,
} from "./testFixtures";

// The turn suite's board seed: MIXED decks, no mulligans, and p1's turn-1
// hand holds the energy/Basics the boards below need.
const TURN_SEED = 170;
const TURN_DECKS = { p1: MIXED_DECK, p2: MIXED_DECK };

function findInHand(
  state: GameState,
  seat: Seat,
  predicate: (cardId: string) => boolean,
): string | undefined {
  return state.players[seat].hand.find((uid) => {
    const id = state.cardIdByUid[uid];
    return id !== undefined && predicate(id);
  });
}

/** A deterministic little bot: same seed ⇒ same choices ⇒ same game. Each
    turn it attaches the first energy in hand, benches the first Basic, and
    retreats whenever the active's cost is already covered, then passes —
    until someone decks out. Returns the full event log and final state. */
function playScriptedGame(seed: number): { state: GameState; events: GameEvent[] } {
  const created = createGame({
    seed,
    decks: { p1: MIXED_DECK, p2: MIXED_DECK },
    cardPool: FIXTURE_POOL,
  });
  if (!created.ok) throw new Error(created.error.code);
  let state = created.state;
  const events: GameEvent[] = [...created.events];
  // Returns the next state so call sites reassign `state` — that keeps TS's
  // narrowing honest (a bare closure reassignment would go unnoticed).
  const step = (action: GameAction): GameState => {
    const applied = mustApply(state, action);
    state = applied.state;
    events.push(...applied.events);
    return state;
  };

  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected chooseFirst");
  const winner = state.phase.coinWinner;
  state = step({ type: "chooseFirstPlayer", seat: winner, first: winner });
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const owedSeat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (owedSeat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = step({ type: "setupDrawExtra", seat: owedSeat, count: phase.owed[owedSeat] });
  }
  for (const seat of ["p1", "p2"] as const) {
    const isBasic = (id: string) => {
      const card = FIXTURE_POOL[id];
      return card !== undefined && isBasicPokemon(card);
    };
    const active = findInHand(state, seat, isBasic);
    if (active === undefined) throw new Error("no basic after mulligans");
    state = step({ type: "setupPlaceActive", seat, uid: active });
    for (let i = 0; i < 2; i++) {
      const bench = findInHand(state, seat, isBasic);
      if (bench !== undefined) state = step({ type: "setupPlaceBench", seat, uid: bench });
    }
    state = step({ type: "setupReady", seat });
  }

  for (let guard = 0; guard < 400 && state.phase.kind === "turn:action"; guard++) {
    const seat = state.phase.seat;
    const isCard = (pred: (card: (typeof FIXTURE_POOL)[string]) => boolean) => (id: string) => {
      const card = FIXTURE_POOL[id];
      return card !== undefined && pred(card);
    };
    const energy = findInHand(state, seat, isCard(isEnergyCard));
    if (energy !== undefined) {
      state = step({ type: "attachEnergy", seat, uid: energy, target: { spot: "active" } });
    }
    const basic = findInHand(state, seat, isCard(isBasicPokemon));
    if (basic !== undefined && state.players[seat].bench.length < 5) {
      state = step({ type: "playBasicToBench", seat, uid: basic });
    }
    const side = state.players[seat];
    const active = side.active;
    if (active !== null && side.bench.length > 0) {
      // Resolved the way the engine itself resolves it (state.cardPool via the
      // accessors), not straight off FIXTURE_POOL — otherwise the script could
      // not catch a bug in that lookup path.
      const top = topCardOf(state, active);
      const cost = top === undefined ? Number.NaN : retreatCostOf(top);
      if (!Number.isNaN(cost) && active.energy.length >= cost) {
        state = step({
          type: "retreat",
          seat,
          discardEnergy: active.energy.slice(0, cost),
          promoteBenchIndex: 0,
        });
      }
    }
    state = step({ type: "endTurn", seat });
  }
  return { state, events };
}

describe("determinism", () => {
  it("replays identically for the same seed and actions", () => {
    const a = playScriptedGame(42);
    const b = playScriptedGame(42);
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
  });

  it("diverges for a different seed", () => {
    const a = playScriptedGame(42);
    const b = playScriptedGame(43);
    expect(JSON.stringify(a.events)).not.toBe(JSON.stringify(b.events));
  });
});

describe("purity", () => {
  it("never mutates the input state, even through the setup cascade", () => {
    const created = createGame({
      seed: 7,
      decks: { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK },
      cardPool: FIXTURE_POOL,
    });
    if (!created.ok) throw new Error(created.error.code);
    // Strict mode makes any write to a frozen object throw, so a green run
    // proves the mulligan/draw cascade builds fresh objects throughout.
    const state = deepFreeze(created.state);
    if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected chooseFirst");
    const snapshot = JSON.stringify(state);
    const result = applyAction(state, {
      type: "chooseFirstPlayer",
      seat: state.phase.coinWinner,
      first: "p1",
    });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it("never mutates the input state through the MULLIGAN cascade", () => {
    // The all-Basic deck above can never mulligan, so it walks straight past
    // resolveMulligans' loop body and the compensation draw. This one forces
    // both — the paths where an in-place hand/deck edit would hide.
    const created = createGame({
      seed: 1,
      decks: { p1: ONE_BASIC_DECK, p2: ONE_BASIC_DECK },
      cardPool: FIXTURE_POOL,
    });
    if (!created.ok) throw new Error(created.error.code);
    const state = deepFreeze(created.state);
    if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected chooseFirst");
    const snapshot = JSON.stringify(state);
    const result = applyAction(state, {
      type: "chooseFirstPlayer",
      seat: state.phase.coinWinner,
      first: "p1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(state.players.p1.mulligans + state.players.p2.mulligans).toBe(0); // pre-action
    const mulliganed = result.state.players.p1.mulligans + result.state.players.p2.mulligans;
    expect(mulliganed).toBeGreaterThan(0); // the cascade really ran
    expect(JSON.stringify(state)).toBe(snapshot);

    // And the compensation draw, on a frozen post-mulligan state.
    const owedState = deepFreeze(result.state);
    if (owedState.phase.kind !== "setup:drawExtra") throw new Error("expected setup:drawExtra");
    const owedSnapshot = JSON.stringify(owedState);
    const drawn = applyAction(owedState, { type: "setupDrawExtra", seat: "p1", count: 1 });
    expect(drawn.ok).toBe(true);
    expect(JSON.stringify(owedState)).toBe(owedSnapshot);
  });

  it("hands out event payloads that do not alias state or the action", () => {
    // An event is a value handed to consumers (animators, the P4 broadcast, a
    // persisted log). One that sorts or splices a payload must never reach
    // back into game state — nor may a caller mutate an already-emitted event
    // by reusing the action object it passed in.
    const created = createGame({
      seed: 1,
      decks: { p1: ONE_BASIC_DECK, p2: ONE_BASIC_DECK },
      cardPool: FIXTURE_POOL,
    });
    if (!created.ok) throw new Error(created.error.code);
    if (created.state.phase.kind !== "setup:chooseFirst") throw new Error("expected chooseFirst");
    const applied = mustApply(created.state, {
      type: "chooseFirstPlayer",
      seat: created.state.phase.coinWinner,
      first: "p1",
    });
    const revealed = applied.events.find((e) => e.type === "MULLIGAN_REVEALED");
    if (revealed?.type !== "MULLIGAN_REVEALED") throw new Error("expected a mulligan");
    // MULLIGAN_REVEALED shows a hand held by a snapshot the caller may retain.
    revealed.hand.length = 0;
    expect(applied.state.players.p1.hand).toHaveLength(HAND_SIZE);
    expect(applied.state.players.p2.hand).toHaveLength(HAND_SIZE);
  });

  it("emits a RETREATED payload detached from the caller's action array", () => {
    // Same board the turn suite uses: active fix-basic-1 (retreat 1), one
    // Basic benched, and an energy in hand on turn 1.
    let state = driveSetup(TURN_SEED, TURN_DECKS, {
      first: "p1",
      active: { p1: "fix-basic-1", p2: "fix-basic-1" },
      bench: { p1: ["fix-basic-0"] },
    });
    expect(state.players.p1.prizes).toHaveLength(PRIZE_COUNT);

    const energy = handUid(state, "p1", "fix-energy");
    state = must(
      applyAction(state, {
        type: "attachEnergy",
        seat: "p1",
        uid: energy,
        target: { spot: "active" },
      }),
    );
    const discardEnergy = [energy];
    const applied = mustApply(state, {
      type: "retreat",
      seat: "p1",
      discardEnergy,
      promoteBenchIndex: 0,
    });
    const retreated = applied.events.find((e) => e.type === "RETREATED");
    if (retreated?.type !== "RETREATED") throw new Error("expected RETREATED");
    discardEnergy.length = 0; // the caller reuses its own action object
    expect(retreated.discardedEnergy).toEqual([energy]);
    expect(applied.state.players.p1.discard).toEqual([energy]);
  });

  it("never throws on a wire-decoded action outside the typed union", () => {
    // P4's Worker decodes actions from a client; the never-throw contract has
    // to survive a bogus type or seat, not just an illegal-but-typed action.
    const state = driveSetup(TURN_SEED, TURN_DECKS, { first: "p1" });
    const bogusType = applyAction(state, { type: "attackWithMove", seat: "p1" } as never);
    expect(bogusType.ok).toBe(false);
    if (!bogusType.ok) expect(bogusType.error.code).toBe("UNKNOWN_ACTION");

    const bogusSeat = applyAction(state, { type: "endTurn", seat: "P1" } as never);
    expect(bogusSeat.ok).toBe(false);
    if (!bogusSeat.ok) expect(bogusSeat.error.code).toBe("UNKNOWN_SEAT");
  });

  it("rejects a bogus `first` instead of crashing several actions later", () => {
    const created = createGame({
      seed: 7,
      decks: { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK },
      cardPool: FIXTURE_POOL,
    });
    if (!created.ok) throw new Error(created.error.code);
    if (created.state.phase.kind !== "setup:chooseFirst") throw new Error("expected chooseFirst");
    // Unvalidated, "p3" used to land in state.firstPlayer and throw inside
    // startTurn once both seats readied — far from the offending action.
    const result = applyAction(created.state, {
      type: "chooseFirstPlayer",
      seat: created.state.phase.coinWinner,
      first: "p3",
    } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNKNOWN_SEAT");
  });

  it("rejects a string bench index rather than destroying the card", () => {
    // JSON has no integer type. `bench["1"]` resolves (string key), so the
    // old guards passed and the energy attached to NOTHING / the retreat
    // spliced with "1" + 1 = "11", deleting benched Pokémon.
    let state = driveSetup(TURN_SEED, TURN_DECKS, {
      first: "p1",
      active: { p1: "fix-basic-0", p2: "fix-basic-1" },
      bench: { p1: ["fix-basic-1", "fix-basic-2"] },
    });
    const energy = handUid(state, "p1", "fix-energy");
    const attach = applyAction(state, {
      type: "attachEnergy",
      seat: "p1",
      uid: energy,
      target: { spot: "bench", index: "1" },
    } as never);
    expect(attach.ok).toBe(false);
    if (!attach.ok) expect(attach.error.code).toBe("BAD_BENCH_INDEX");

    // fix-basic-0 retreats free, so only the index is in question here.
    const benchBefore = state.players.p1.bench.length;
    const retreatResult = applyAction(state, {
      type: "retreat",
      seat: "p1",
      discardEnergy: [],
      promoteBenchIndex: "1",
    } as never);
    expect(retreatResult.ok).toBe(false);
    if (!retreatResult.ok) expect(retreatResult.error.code).toBe("BAD_BENCH_INDEX");

    // The legal integer form still works, and keeps every Pokémon.
    state = must(
      applyAction(state, { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 1 }),
    );
    expect(state.players.p1.bench).toHaveLength(benchBefore);
  });

  it("leaves the state untouched on rejections", () => {
    const state = deepFreeze(
      driveSetup(1, { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK }, { first: "p1" }),
    );
    const snapshot = JSON.stringify(state);
    // Illegal: p1 has an empty bench, so this retreat is rejected...
    const rejected = applyAction(state, {
      type: "retreat",
      seat: "p1",
      discardEnergy: [],
      promoteBenchIndex: 0,
    });
    expect(rejected.ok).toBe(false);
    // ...and a legal action on the same frozen state also leaves it intact.
    const accepted = applyAction(state, {
      type: "playBasicToBench",
      seat: "p1",
      uid: handUid(state, "p1", "fix-basic-1"),
    });
    expect(accepted.ok).toBe(true);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

describe("scripted end-to-end game", () => {
  it("plays setup and full turns through to a deck-out finish", () => {
    const { state, events } = playScriptedGame(42);

    expect(state.phase.kind).toBe("gameOver");
    if (state.phase.kind !== "gameOver") return;
    const outcome = state.phase.outcome;
    if (outcome.result !== "win") throw new Error("expected a deck-out win, not a tie");
    expect(outcome.reason).toBe("deckOut");
    const loser = outcome.winner === "p1" ? "p2" : "p1";
    expect(state.players[loser].deck).toHaveLength(0);

    // Event census: the whole M1 surface was exercised, exactly once ended.
    const count = (type: GameEvent["type"]) => events.filter((e) => e.type === type).length;
    expect(count("COIN_FLIP")).toBe(1);
    expect(count("FIRST_PLAYER_CHOSEN")).toBe(1);
    expect(count("PRIZES_SET")).toBe(2);
    expect(count("SETUP_REVEALED")).toBe(1);
    expect(count("GAME_OVER")).toBe(1);
    expect(count("ENERGY_ATTACHED")).toBeGreaterThan(0);
    expect(count("POKEMON_BENCHED")).toBeGreaterThan(0);
    expect(count("RETREATED")).toBeGreaterThan(0);
    expect(count("TURN_STARTED")).toBe(state.turn);
    // Every turn start drew a card except the deck-out one.
    const turnDraws = events.filter(
      (e) => e.type === "CARDS_DRAWN" && e.reason === "turnStart",
    ).length;
    expect(turnDraws).toBe(state.turn - 1);
    // Prizes stayed populated (they are taken from M2 on).
    expect(state.players.p1.prizes).toHaveLength(6);
    expect(state.players.p2.prizes).toHaveLength(6);
    expect(events.at(-1)?.type).toBe("GAME_OVER");
  });
});

// Concede (P4 3c-ii) — the only non-§14 way a game ends. One action serves two
// triggers: a player giving up, and the online server acting for one who
// abandoned the match, so it must work from ANY phase a stuck match can be in.
describe("concede — giving the game up", () => {
  it("hands the win to the opponent, with the `conceded` reason", () => {
    const state = driveSetup(7);
    const { state: next, events } = mustApply(state, { type: "concede", seat: "p1" });
    expect(next.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "win", winner: "p2", reason: "conceded" },
    });
    // It goes out through the ONE GAME_OVER emitter, so consumers (the log, the
    // redactor, both overlays) need no special case.
    expect(events.some((e) => e.type === "GAME_OVER")).toBe(true);
  });

  it("works on the OPPONENT's turn — the case it exists for", () => {
    // A player who walks away does so on their own turn; the other player's
    // forfeit timer then fires while it is still the ABSENTEE's turn. A concede
    // gated on "your turn" would be useless exactly there.
    const state = driveSetup(7);
    if (state.phase.kind !== "turn:action") throw new Error("expected turn:action");
    const idle = otherSeat(state.phase.seat);
    const { state: next } = mustApply(state, { type: "concede", seat: idle });
    expect(next.phase.kind).toBe("gameOver");
  });

  it("clears the pending queue, so nothing resumes into a finished game", () => {
    const state = driveSetup(7);
    const { state: next } = mustApply(state, { type: "concede", seat: "p1" });
    expect(next.pending).toEqual([]);
  });

  it("is refused once the game is over — the first result stands", () => {
    const state = driveSetup(7);
    const over = mustApply(state, { type: "concede", seat: "p1" }).state;
    // p2 cannot concede back and flip the winner.
    expectErr(over, { type: "concede", seat: "p2" }, "GAME_OVER");
    expect(over.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "win", winner: "p2", reason: "conceded" },
    });
  });
});
