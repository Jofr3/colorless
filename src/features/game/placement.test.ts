// Lockstep suite (node env): gamePlacementPredicate — the /play drop gate —
// against moveToAction and the engine, over REAL engine states (the engine's
// own fixtures + the projection). The contract under test, both directions:
//
//   allow  ⇒ moveToAction translates to a NON-NULL action of the expected
//            type (the affordance never promises a drop that can't dispatch);
//   reject ⇒ moveToAction translates to null (nothing to dispatch) OR the
//            routed action is one applyAction deterministically refuses (the
//            gesture-class could never succeed — no pill for a rule the user
//            never gestured at).
//
// Extend this together with placement.ts and moveToAction.ts — a drift
// between the three surfaces breaks here, not on the page.

import type { GameState, Phase, Seat } from "@luminous/engine";
import { applyAction } from "@luminous/engine";
import { describe, expect, it } from "vitest";
import {
  ALL_BASIC_DECK,
  EVOLVE_DECK,
  MIXED_DECK,
  STADIUM_TOOL_DECK,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  mustCreate,
  setActiveFromDeck,
} from "../../../packages/engine/src/testFixtures";
import type { BoardState, CardPlacement, CardType } from "../playmat/types";
import { canPlace } from "../playmat/utils/cardMovement";
import { moveToAction } from "./moveToAction";
import { gamePlacementPredicate } from "./placement";
import { projectGameState } from "./projection";

// Seed 170: MIXED vs MIXED runs mulligan-free (see projection.test.ts), so
// chooseFirstPlayer lands straight on setup:place.
const SEED = 170;
const DECKS = { p1: MIXED_DECK, p2: MIXED_DECK };

function placingState(): GameState {
  const created = mustCreate(SEED, DECKS).state;
  if (created.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  const winner = created.phase.coinWinner;
  const state = must(
    applyAction(created, { type: "chooseFirstPlayer", seat: winner, first: "p1" }),
  );
  if (state.phase.kind !== "setup:place")
    throw new Error(`expected setup:place, got ${state.phase.kind}`);
  return state;
}

/** setup:place with p1's Active already down (still un-ready) — the board
    shape of confirmed bug (a): a setup energy dropped onto that Active. */
function midPlacingState(): GameState {
  const state = placingState();
  return must(
    applyAction(state, {
      type: "setupPlaceActive",
      seat: "p1",
      uid: handUid(state, "p1", "fix-basic-1"),
    }),
  );
}

/** setup:place with p1 already ready (p2 still placing). */
function readyP1State(): GameState {
  return must(applyAction(midPlacingState(), { type: "setupReady", seat: "p1" }));
}

/** setup:place with p1's bench at the 5-cap (ALL_BASIC: every card is the
    same Basic, so 1 active + 5 bench placements succeed at any seed). */
function benchFullPlacingState(): GameState {
  const created = mustCreate(SEED, { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK }).state;
  if (created.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  let state = must(
    applyAction(created, {
      type: "chooseFirstPlayer",
      seat: created.phase.coinWinner,
      first: "p1",
    }),
  );
  const placeTop = (type: "setupPlaceActive" | "setupPlaceBench") => {
    const uid = state.players.p1.hand[0];
    if (uid === undefined) throw new Error("p1 hand ran out during scripted setup");
    state = mustApply(state, { type, seat: "p1", uid }).state;
  };
  placeTop("setupPlaceActive");
  for (let i = 0; i < 5; i += 1) placeTop("setupPlaceBench");
  return state;
}

function turnState(): GameState {
  return driveSetup(SEED, DECKS, {
    first: "p1",
    active: { p1: "fix-basic-1", p2: "fix-basic-1" },
    bench: { p1: ["fix-basic-0"] },
  });
}

/** turn:action with p1's bench full — cap rejections must be structural. */
function benchFullTurnState(): GameState {
  return driveSetup(
    SEED,
    { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK },
    { first: "p1", bench: { p1: Array<string>(5).fill("fix-basic-1") } },
  );
}

/** turn:action on p1's turn 2 with the slice-3 persistent-zone cards in hand
    (a Stadium aimable at the global slot, a Tool aimable at own Pokémon) and
    an occupied bench slot for the Tool to land on. */
function stadiumToolTurnState(): GameState {
  let state = driveSetup(SEED, { p1: STADIUM_TOOL_DECK, p2: STADIUM_TOOL_DECK }, { first: "p2" });
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  // Displacing the Active benches it — an occupied bench index 0.
  state = setActiveFromDeck(state, "p1", "fix-basic-1");
  state = handFromDeck(state, "p1", "sv01-167", 1); // Beach Court (Stadium)
  return handFromDeck(state, "p1", "sv01-197", 1); // Vitality Band (Tool)
}

/** turn:action on p1's turn 3 (past the §4 first-turn ban), fix-basic-1
    Active, a matching fix-stage1 in hand — the one board where an evolve
    gesture is actually engine-legal, so the sweep covers a drop that APPLIES,
    not only ones the engine refuses. */
function evolveTurnState(): GameState {
  let state = driveSetup(
    SEED,
    { p1: EVOLVE_DECK, p2: EVOLVE_DECK },
    { first: "p1", active: { p1: "fix-basic-1", p2: "fix-basic-1" } },
  );
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  return handFromDeck(state, "p1", "fix-stage1", 1);
}

// ---------------------------------------------------------------------------
// The lockstep property.
// ---------------------------------------------------------------------------

/** Representative drop targets: every zone class the playmat's drop zones can
    report — own active/bench (indexed, out-of-range, and the index-less
    whole-zone container), the hand, and the never-legal opposing/global. */
const TARGETS: CardPlacement[] = [
  { owner: "you", zone: "active" },
  { owner: "you", zone: "bench" }, // whole-zone container (no index)
  { owner: "you", zone: "bench", index: 0 },
  { owner: "you", zone: "bench", index: 1 },
  { owner: "you", zone: "bench", index: 4 },
  { owner: "you", zone: "hand", index: 0 },
  { owner: "you", zone: "hand", index: 5 },
  { owner: "opponent", zone: "active" },
  { owner: "opponent", zone: "bench", index: 0 },
  { owner: "global", zone: "stadium" },
];

/** The action type a predicate-allowed drop must translate to. */
function expectedActionType(
  phase: Phase,
  sourceType: CardType,
  target: CardPlacement,
  board: BoardState,
): string {
  if (phase.kind === "setup:place") {
    return target.zone === "active" ? "setupPlaceActive" : "setupPlaceBench";
  }
  // turn:action — the only other phase the predicate allows drops in.
  if (sourceType === "energy") return "attachEnergy";
  if (sourceType === "tool") return "attachTool";
  if (sourceType === "stadium") return "playTrainer";
  // A Pokémon dropped onto an occupied own slot (Active, or an occupied bench
  // index) is an evolve gesture (§10); onto a free bench slot it is a Basic.
  if (target.zone === "active") return "evolve";
  if (
    target.zone === "bench" &&
    target.index !== undefined &&
    board.you.bench[target.index]?.type === "pokemon"
  ) {
    return "evolve";
  }
  return "playBasicToBench";
}

/** The transport-agnostic move context moveToAction now takes (a phase KIND +
    an is-it-my-turn flag), derived from a full engine phase for these tests. */
function moveCtx(phase: Phase, viewerSeat: Seat, board: BoardState) {
  return {
    phaseKind: phase.kind,
    isViewerTurn: phase.kind === "turn:action" && phase.seat === viewerSeat,
    viewerSeat,
    board,
  };
}

/** Assert the contract over every own-hand card × TARGETS for one state and
    viewer. `phase` overrides let the never-drop phases run against boards
    that actually hold cards (chooseFirst has empty hands, ko:* needs a KO). */
function expectLockstep(state: GameState, viewerSeat: Seat, phase?: Phase): void {
  const stateAt: GameState = phase === undefined ? state : { ...state, phase };
  const board = projectGameState(stateAt, viewerSeat).board;
  const predicate = gamePlacementPredicate(stateAt, viewerSeat);
  expect(board.you.hand.length).toBeGreaterThan(0); // a vacuous sweep proves nothing
  board.you.hand.forEach((model, index) => {
    const from: CardPlacement = { owner: "you", zone: "hand", index };
    for (const to of TARGETS) {
      const allowed = predicate(board, from, to, model.type);
      const action = moveToAction(
        { cardId: model.id, from, to },
        moveCtx(stateAt.phase, viewerSeat, board),
      );
      const label = `${stateAt.phase.kind}: ${model.type} → ${JSON.stringify(to)}`;
      if (allowed) {
        expect(action, label).not.toBeNull();
        if (action === null) continue; // narrow for TS; unreachable after the expect
        expect(action.type, label).toBe(expectedActionType(stateAt.phase, model.type, to, board));
      } else if (action !== null) {
        expect(applyAction(stateAt, action).ok, label).toBe(false);
      }
    }
  });
}

describe("gamePlacementPredicate ↔ moveToAction lockstep", () => {
  it("holds through setup:place (fresh, mid-placement, ready, bench-capped)", () => {
    expectLockstep(placingState(), "p1");
    expectLockstep(placingState(), "p2");
    expectLockstep(midPlacingState(), "p1");
    expectLockstep(readyP1State(), "p1"); // ready seat: every drop rejected
    expectLockstep(readyP1State(), "p2"); // ...while p2 still places freely
    expectLockstep(benchFullPlacingState(), "p1");
  });

  it("holds through turn:action (turn owner, off-turn seat, bench-capped, evolvable)", () => {
    expectLockstep(turnState(), "p1");
    expectLockstep(turnState(), "p2"); // p1's turn: p2's drops all spring back
    expectLockstep(benchFullTurnState(), "p1");
    expectLockstep(evolveTurnState(), "p1"); // a board where evolve is legal
    expectLockstep(stadiumToolTurnState(), "p1"); // Stadium/Tool gestures (§7.3/§7.4)
    expectLockstep(stadiumToolTurnState(), "p2"); // ...all spring back off-turn
  });

  it("holds in every never-drop phase (buttons and dialogs, not drags)", () => {
    const turn = turnState();
    expectLockstep(turn, "p1", { kind: "setup:chooseFirst", coinWinner: "p1" });
    expectLockstep(placingState(), "p1", {
      kind: "setup:drawExtra",
      owed: { p1: 1, p2: 0 },
      decided: { p1: false, p2: true },
    });
    expectLockstep(turn, "p1", { kind: "ko:takePrizes", seat: "p1", count: 1 });
    expectLockstep(turn, "p1", { kind: "ko:promote", seat: "p1" });
    expectLockstep(turn, "p1", {
      kind: "gameOver",
      outcome: { result: "win", winner: "p1", reason: "prizesTaken" },
    });
  });
});

// ---------------------------------------------------------------------------
// The specific gestures the seam exists for.
// ---------------------------------------------------------------------------

describe("gamePlacementPredicate — the confirmed canPlace bugs", () => {
  it("(a) setup energy onto an own occupied Pokémon gets no affordance", () => {
    const state = midPlacingState();
    const board = projectGameState(state, "p1").board;
    const predicate = gamePlacementPredicate(state, "p1");
    const from: CardPlacement = {
      owner: "you",
      zone: "hand",
      index: board.you.hand.findIndex((card) => card.type === "energy"),
    };
    const to: CardPlacement = { owner: "you", zone: "active" };
    // The mock's phase-unaware answer (its attach branch) — the bug: this
    // showed a legal-drop affordance whose dispatch could only ever pill
    // NOT_A_BASIC_POKEMON, a rule the user never gestured at.
    expect(canPlace(board, from, to, "energy")).toBe(true);
    expect(predicate(board, from, to, "energy")).toBe(false);
  });

  it("(b) hand → hand reorder is rejected in every phase (engine owns hand order)", () => {
    const to: CardPlacement = { owner: "you", zone: "hand", index: 3 };
    for (const state of [placingState(), turnState()]) {
      const board = projectGameState(state, "p1").board;
      const predicate = gamePlacementPredicate(state, "p1");
      const from: CardPlacement = { owner: "you", zone: "hand", index: 0 };
      const sourceType = board.you.hand[0]?.type;
      if (sourceType === undefined) throw new Error("expected a card in hand");
      expect(canPlace(board, from, to, sourceType)).toBe(true); // the mock's answer
      expect(predicate(board, from, to, sourceType)).toBe(false);
    }
  });
});

describe("gamePlacementPredicate — turn:action structure", () => {
  it("energy attaches only onto an occupied own slot (never the container)", () => {
    const state = turnState(); // active + one benched Pokémon
    const board = projectGameState(state, "p1").board;
    const predicate = gamePlacementPredicate(state, "p1");
    const from: CardPlacement = {
      owner: "you",
      zone: "hand",
      index: board.you.hand.findIndex((card) => card.type === "energy"),
    };
    expect(predicate(board, from, { owner: "you", zone: "active" }, "energy")).toBe(true);
    expect(predicate(board, from, { owner: "you", zone: "bench", index: 0 }, "energy")).toBe(true);
    // Empty slot / index-less container: no host, structurally impossible.
    expect(predicate(board, from, { owner: "you", zone: "bench", index: 1 }, "energy")).toBe(false);
    expect(predicate(board, from, { owner: "you", zone: "bench" }, "energy")).toBe(false);
  });

  it("affords a Pokémon dropped on the Active as an evolve, and the routed action applies (§10)", () => {
    const state = evolveTurnState();
    const board = projectGameState(state, "p1").board;
    const predicate = gamePlacementPredicate(state, "p1");
    const stage1Uid = handUid(state, "p1", "fix-stage1");
    const from: CardPlacement = {
      owner: "you",
      zone: "hand",
      index: board.you.hand.findIndex((card) => card.id === stage1Uid),
    };
    const to: CardPlacement = { owner: "you", zone: "active" };
    expect(predicate(board, from, to, "pokemon")).toBe(true);
    const action = moveToAction(
      { cardId: stage1Uid, from, to },
      moveCtx(state.phase, "p1", board),
    );
    expect(action).toEqual({ type: "evolve", seat: "p1", uid: stage1Uid, target: { spot: "active" } });
    // The full chain lands a LEGAL evolve on this real turn-3 board.
    expect(action === null ? false : applyAction(state, action).ok).toBe(true);
  });

  it("a Stadium dropped on the global slot routes to playTrainer and applies (§7.3)", () => {
    const state = stadiumToolTurnState();
    const board = projectGameState(state, "p1").board;
    const predicate = gamePlacementPredicate(state, "p1");
    const stadiumUid = handUid(state, "p1", "sv01-167");
    const from: CardPlacement = {
      owner: "you",
      zone: "hand",
      index: board.you.hand.findIndex((card) => card.id === stadiumUid),
    };
    const to: CardPlacement = { owner: "global", zone: "stadium" };
    expect(predicate(board, from, to, "stadium")).toBe(true);
    const action = moveToAction(
      { cardId: stadiumUid, from, to },
      moveCtx(state.phase, "p1", board),
    );
    expect(action).toEqual({ type: "playTrainer", seat: "p1", uid: stadiumUid });
    expect(action === null ? false : applyAction(state, action).ok).toBe(true);
    // Aimed anywhere else, a Stadium affords nothing and translates to null.
    const elsewhere: CardPlacement = { owner: "you", zone: "active" };
    expect(predicate(board, from, elsewhere, "stadium")).toBe(false);
    expect(
      moveToAction({ cardId: stadiumUid, from, to: elsewhere }, moveCtx(state.phase, "p1", board)),
    ).toBeNull();
  });

  it("a Tool dropped on an own occupied Pokémon routes to attachTool and applies (§7.4)", () => {
    const state = stadiumToolTurnState();
    const board = projectGameState(state, "p1").board;
    const predicate = gamePlacementPredicate(state, "p1");
    const toolUid = handUid(state, "p1", "sv01-197");
    const from: CardPlacement = {
      owner: "you",
      zone: "hand",
      index: board.you.hand.findIndex((card) => card.id === toolUid),
    };
    for (const to of [
      { owner: "you", zone: "active" } as const,
      { owner: "you", zone: "bench", index: 0 } as const,
    ]) {
      expect(predicate(board, from, to, "tool")).toBe(true);
      const action = moveToAction(
        { cardId: toolUid, from, to },
        moveCtx(state.phase, "p1", board),
      );
      expect(action?.type).toBe("attachTool");
      expect(action === null ? false : applyAction(state, action).ok).toBe(true);
    }
    // The index-less bench container has no host — no affordance, no action.
    const container: CardPlacement = { owner: "you", zone: "bench" };
    expect(predicate(board, from, container, "tool")).toBe(false);
    expect(
      moveToAction({ cardId: toolUid, from, to: container }, moveCtx(state.phase, "p1", board)),
    ).toBeNull();
  });

  it("a Pokémon may aim at the bench (Basic-ness stays the engine's) but not a full one", () => {
    const roomy = turnState();
    const roomyBoard = projectGameState(roomy, "p1").board;
    const from: CardPlacement = { owner: "you", zone: "hand", index: 0 };
    expect(
      gamePlacementPredicate(roomy, "p1")(
        roomyBoard,
        from,
        { owner: "you", zone: "bench" },
        "pokemon",
      ),
    ).toBe(true);

    const capped = benchFullTurnState();
    const cappedBoard = projectGameState(capped, "p1").board;
    expect(
      gamePlacementPredicate(capped, "p1")(
        cappedBoard,
        from,
        { owner: "you", zone: "bench" },
        "pokemon",
      ),
    ).toBe(false);
  });
});
