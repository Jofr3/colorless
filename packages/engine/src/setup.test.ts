import { describe, expect, it } from "vitest";
import { DECK_SIZE, HAND_SIZE, PRIZE_COUNT, applyAction, createGame } from "./index";
import { phaseViewOf } from "./phaseView";
import { redactGame } from "./redact";
import type { GameEvent, GameState, Seat } from "./index";
import {
  ALL_BASIC_DECK,
  FIXTURE_POOL,
  MIXED_DECK,
  ONE_BASIC_DECK,
  deckOf,
  handUid,
  finishOpeningSetup,
  must,
  mustApply,
  mustCreate,
  types,
} from "./testFixtures";

// Seeds found by deterministic scan (see the engine test conventions): the
// coin flip depends only on the seed (both shuffles consume a fixed number
// of RNG steps), so seed 1 always crowns p2 and seed 3 always crowns p1.
const SEED_P2_WINS = 1;
const SEED_P1_WINS = 3;
// With p1 on ALL_BASIC and p2 on ONE_BASIC, seed 1 gives p2 >= 2 mulligans.
const SEED_MULL = 1;
// With both on ONE_BASIC, seed 1 makes both players mulligan.
const SEED_BOTH_MULL = 1;
// MIXED decks, no mulligans, and p1's opening hand holds a Stage1.
const SEED_STAGE1 = 170;

describe("createGame", () => {
  it("rejects a deck that is not exactly 60 cards", () => {
    const result = createGame({
      seed: 1,
      decks: { p1: ALL_BASIC_DECK.slice(0, 59), p2: ALL_BASIC_DECK },
      cardPool: FIXTURE_POOL,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("BAD_DECK_SIZE");
  });

  it("rejects unknown card ids", () => {
    const result = createGame({
      seed: 1,
      decks: { p1: deckOf({ "fix-nope": 60 }), p2: ALL_BASIC_DECK },
      cardPool: FIXTURE_POOL,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNKNOWN_CARD_ID");
  });

  it("rejects a deck with no Basic Pokémon", () => {
    const result = createGame({
      seed: 1,
      decks: { p1: ALL_BASIC_DECK, p2: deckOf({ "fix-energy": 40, "fix-item": 20 }) },
      cardPool: FIXTURE_POOL,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NO_BASIC_POKEMON");
  });

  it("shuffles both decks, flips the coin and waits on the winner", () => {
    const { state, events } = mustCreate(SEED_P2_WINS);
    expect(types(events)).toEqual(["SHUFFLE", "SHUFFLE", "COIN_FLIP"]);
    const flip = events[2];
    if (flip?.type !== "COIN_FLIP") throw new Error("expected COIN_FLIP");
    expect(state.phase).toEqual({ kind: "setup:chooseFirst", coinWinner: flip.winner });
    expect(state.turn).toBe(0);
    expect(state.firstPlayer).toBeNull();
    // The shuffled deck is a permutation of that seat's minted uids.
    const uids = [...state.players.p1.deck].sort();
    expect(uids).toEqual(Array.from({ length: DECK_SIZE }, (_, i) => `p1#${i}`).sort());
    expect(Object.keys(state.cardIdByUid)).toHaveLength(DECK_SIZE * 2);
  });

  it("keeps only the ids the decks use in the state's card pool", () => {
    const { state } = mustCreate(1, { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK });
    expect(Object.keys(state.cardPool)).toEqual(["fix-basic-1"]);
  });
});

/** Drives past the coin flip: the winner picks `first`, hands get dealt. */
function chooseFirst(state: GameState, first: Seat): { state: GameState; events: GameEvent[] } {
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  const winner = state.phase.coinWinner;
  return mustApply(state, { type: "chooseFirstPlayer", seat: winner, first });
}

describe("chooseFirstPlayer", () => {
  it("rejects anyone but the coin winner", () => {
    const { state } = mustCreate(SEED_P2_WINS);
    const result = applyAction(state, { type: "chooseFirstPlayer", seat: "p1", first: "p1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WRONG_SEAT");
  });

  it("lets the winner give the first turn away, then deals 7-card hands", () => {
    const created = mustCreate(SEED_P1_WINS, { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK });
    const { state, events } = mustApply(created.state, {
      type: "chooseFirstPlayer",
      seat: "p1",
      first: "p2",
    });
    expect(state.firstPlayer).toBe("p2");
    // All-Basic decks cannot mulligan, so the cascade is exactly: choice,
    // p1's opening 7, p2's opening 7, then opening placement.
    expect(events).toEqual([
      { type: "FIRST_PLAYER_CHOSEN", first: "p2", chosenBy: "p1" },
      { type: "CARDS_DRAWN", seat: "p1", uids: state.players.p1.hand, reason: "opening" },
      { type: "CARDS_DRAWN", seat: "p2", uids: state.players.p2.hand, reason: "opening" },
    ]);
    expect(state.players.p1.hand).toHaveLength(HAND_SIZE);
    expect(state.players.p2.hand).toHaveLength(HAND_SIZE);
    expect(state.phase).toEqual({
      kind: "setup:place",
      stage: "opening",
      ready: { p1: false, p2: false },
    });
    expect(state.players.p1.prizes).toHaveLength(0);
    expect(state.players.p2.prizes).toHaveLength(0);
  });

  it("cannot be chosen twice", () => {
    const created = mustCreate(1, { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK });
    const { state } = chooseFirst(created.state, "p1");
    const result = applyAction(state, { type: "chooseFirstPlayer", seat: "p2", first: "p2" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("BAD_PHASE");
  });
});

describe("mulligans", () => {
  it.each(["p1", "p2"] as const)(
    "sets the valid player's prizes before %s completes mulligans",
    (mulliganSeat) => {
      const validSeat = mulliganSeat === "p1" ? "p2" : "p1";
      const decks = { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK };
      decks[mulliganSeat] = ONE_BASIC_DECK;
      const created = mustCreate(SEED_MULL, decks);
      let state = chooseFirst(created.state, "p1").state;
      expect(state.players[mulliganSeat].mulligans).toBe(0);
      expect(phaseViewOf(state, mulliganSeat).waitingSeat).toBe(validSeat);
      expect(applyAction(state, { type: "setupDrawExtra", seat: validSeat, count: 1 }).ok).toBe(
        false,
      );
      const opening = [...state.players[validSeat].hand];
      state = mustApply(state, {
        type: "setupPlaceActive",
        seat: validSeat,
        uid: opening[0] as string,
      }).state;
      state = mustApply(state, {
        type: "setupPlaceBench",
        seat: validSeat,
        uid: opening[1] as string,
      }).state;
      const expectedPrizes = state.players[validSeat].deck.slice(0, PRIZE_COUNT);
      const readied = mustApply(state, { type: "setupReady", seat: validSeat });
      expect(types(readied.events).indexOf("PRIZES_SET")).toBeLessThan(
        types(readied.events).indexOf("MULLIGAN_REVEALED"),
      );
      expect(readied.state.players[validSeat].prizes).toEqual(expectedPrizes);
      expect(readied.state.players[mulliganSeat].mulligans).toBeGreaterThan(0);
      expect(readied.state.players[mulliganSeat].hand).toHaveLength(HAND_SIZE);
      expect(readied.state.players[mulliganSeat].prizes).toHaveLength(0);
      expect(phaseViewOf(readied.state, validSeat).waitingSeat).toBe(mulliganSeat);
    },
  );

  it("auto-resolves reveal/shuffle/redraw until the hand has a Basic", () => {
    const created = mustCreate(SEED_MULL, { p1: ALL_BASIC_DECK, p2: ONE_BASIC_DECK });
    const { state, events } = finishOpeningSetup(chooseFirst(created.state, "p1").state);
    const mulligans = state.players.p2.mulligans;
    expect(mulligans).toBeGreaterThanOrEqual(2);
    expect(state.players.p1.mulligans).toBe(0);
    const reveals = events.filter((e) => (e as { type: string }).type === "MULLIGAN_REVEALED");
    expect(reveals).toHaveLength(mulligans);
    // The final hand is valid: 7 cards including the lone Basic.
    expect(state.players.p2.hand).toHaveLength(HAND_SIZE - 1);
    expect(state.players.p2.active).not.toBeNull();
    // One draw per OPPONENT mulligan; p2 mulliganed, so only p1 is owed and
    // p2 (owed 0) is pre-decided rather than prompted.
    expect(state.phase).toEqual({
      kind: "setup:drawExtra",
      owed: { p1: mulligans, p2: 0 },
      decided: { p1: false, p2: true },
      bonusCards: { p1: [], p2: [] },
    });
  });

  it("owes BOTH players when both mulligan — each off the other's count (§3.5)", () => {
    const created = mustCreate(SEED_BOTH_MULL, { p1: ONE_BASIC_DECK, p2: ONE_BASIC_DECK });
    const { state } = finishOpeningSetup(chooseFirst(created.state, "p1").state);
    const p1Mulls = state.players.p1.mulligans;
    const p2Mulls = state.players.p2.mulligans;
    expect(p1Mulls).toBeGreaterThanOrEqual(1);
    expect(p2Mulls).toBeGreaterThanOrEqual(1);
    // Mulliganing yourself does not forfeit the compensation you are owed.
    expect(state.phase).toEqual({
      kind: "setup:drawExtra",
      owed: { p1: p2Mulls, p2: p1Mulls },
      decided: { p1: false, p2: false },
      bonusCards: { p1: [], p2: [] },
    });
  });

  it("waits for every bonus draw, then starts when neither player drew a Basic", () => {
    const created = mustCreate(SEED_BOTH_MULL, { p1: ONE_BASIC_DECK, p2: ONE_BASIC_DECK });
    let state = finishOpeningSetup(chooseFirst(created.state, "p1").state).state;
    state = must(applyAction(state, { type: "setupDrawExtra", seat: "p1", count: 0 }));
    expect(state.phase.kind).toBe("setup:drawExtra"); // p2 still owes an answer
    state = must(applyAction(state, { type: "setupDrawExtra", seat: "p2", count: 1 }));
    expect(state.phase.kind).toBe("turn:action");
  });

  it("skips compensation when nobody mulligans", () => {
    const created = mustCreate(1, { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK });
    const { state } = finishOpeningSetup(chooseFirst(created.state, "p1").state);
    expect(state.phase.kind).toBe("turn:action");
  });
});

describe("setupDrawExtra", () => {
  function owedState(): { state: GameState; owed: number } {
    const created = mustCreate(SEED_MULL, { p1: ALL_BASIC_DECK, p2: ONE_BASIC_DECK });
    const { state } = finishOpeningSetup(chooseFirst(created.state, "p1").state);
    if (state.phase.kind !== "setup:drawExtra") throw new Error("expected setup:drawExtra");
    return { state, owed: state.phase.owed.p1 };
  }

  it("reserves both prize sets before drawing compensation from the remaining deck", () => {
    const created = mustCreate(SEED_MULL, { p1: ALL_BASIC_DECK, p2: ONE_BASIC_DECK });
    const dealt = finishOpeningSetup(chooseFirst(created.state, "p1").state);
    const state = dealt.state;
    if (state.phase.kind !== "setup:drawExtra") throw new Error("Expected compensation");
    expect(types(dealt.events).filter((type) => type === "PRIZES_SET")).toHaveLength(2);
    for (const seat of ["p1", "p2"] as const) {
      expect(state.players[seat].prizes).toHaveLength(PRIZE_COUNT);
      expect(state.players[seat].hand).toHaveLength(HAND_SIZE - 1);
      expect(state.players[seat].deck).toHaveLength(47);
    }
    const count = state.phase.owed.p1;
    const bonusCards = state.players.p1.deck.slice(0, count);
    const { state: next, events } = mustApply(state, { type: "setupDrawExtra", seat: "p1", count });
    expect(next.players.p1.hand.slice(HAND_SIZE - 1)).toEqual(bonusCards);
    for (const seat of ["p1", "p2"] as const) {
      expect(next.players[seat].prizes).toEqual(state.players[seat].prizes);
      expect(next.players[seat].hand.some((uid) => next.players[seat].prizes.includes(uid))).toBe(
        false,
      );
    }
    expect(events.some((event) => event.type === "PRIZES_SET")).toBe(false);
  });

  it("locks the opening Active and Bench, then allows only bonus Basics before reveal", () => {
    const { state, owed } = owedState();
    const initialActive = state.players.p1.active;
    const openingBasic = state.players.p1.hand[0] as string;
    const { state: drawn } = mustApply(state, { type: "setupDrawExtra", seat: "p1", count: owed });
    if (drawn.phase.kind !== "setup:place" || drawn.phase.stage !== "bonus")
      throw new Error("Expected bonus Bench step");
    expect(drawn.turn).toBe(0);
    expect(drawn.phase.ready).toEqual({ p1: false, p2: true });
    expect(drawn.players.p1.active).toEqual(initialActive);
    const bonusUid = drawn.phase.bonusCards?.p1[0] as string;
    const activeAttempt = applyAction(drawn, {
      type: "setupPlaceActive",
      seat: "p1",
      uid: bonusUid,
    });
    expect(activeAttempt.ok).toBe(false);
    if (!activeAttempt.ok) expect(activeAttempt.error.code).toBe("ACTIVE_ALREADY_PLACED");
    const openingAttempt = applyAction(drawn, {
      type: "setupPlaceBench",
      seat: "p1",
      uid: openingBasic,
    });
    expect(openingAttempt.ok).toBe(false);
    if (!openingAttempt.ok) expect(openingAttempt.error.code).toBe("SETUP_BONUS_ONLY");
    // A saved bonus step retains the eligible uids and the locked Active.
    const restored = JSON.parse(JSON.stringify(drawn)) as GameState;
    const benched = mustApply(restored, {
      type: "setupPlaceBench",
      seat: "p1",
      uid: bonusUid,
    }).state;
    expect(benched.players.p1.bench[0]?.stack).toEqual([bonusUid]);
    const finished = mustApply(benched, { type: "setupReady", seat: "p1" });
    expect(types(finished.events)).toEqual([
      "SETUP_READY",
      "SETUP_REVEALED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(finished.state.turn).toBe(1);
    expect(finished.state.players.p1.active).toEqual(initialActive);
    expect(finished.state.players.p1.prizes).toEqual(state.players.p1.prizes);
    const ownPhase = redactGame(drawn, "p1").phase;
    const otherPhase = redactGame(drawn, "p2").phase;
    const spectatorPhase = redactGame(drawn, "p1", true).phase;
    expect(ownPhase).toMatchObject({ stage: "bonus", bonusCards: drawn.phase.bonusCards?.p1 });
    expect(otherPhase).toMatchObject({ bonusCards: [] });
    expect(spectatorPhase).toMatchObject({ bonusCards: [] });
  });

  it("skips the bonus Bench step when the Bench is already full", () => {
    const created = mustCreate(SEED_MULL, { p1: ALL_BASIC_DECK, p2: ONE_BASIC_DECK });
    let state = chooseFirst(created.state, "p1").state;
    const opening = [...state.players.p1.hand];
    state = mustApply(state, {
      type: "setupPlaceActive",
      seat: "p1",
      uid: opening[0] as string,
    }).state;
    for (const uid of opening.slice(1, 6))
      state = mustApply(state, { type: "setupPlaceBench", seat: "p1", uid }).state;
    state = finishOpeningSetup(state).state;
    if (state.phase.kind !== "setup:drawExtra") throw new Error("Expected bonus draw");
    const next = mustApply(state, {
      type: "setupDrawExtra",
      seat: "p1",
      count: state.phase.owed.p1,
    }).state;
    expect(next.phase.kind).toBe("turn:action");
    expect(next.players.p1.bench).toHaveLength(5);
  });

  it("sets prizes before compensation when resuming an older setup without prizes", () => {
    const { state, owed } = owedState();
    const oldState = {
      ...state,
      players: {
        p1: {
          ...state.players.p1,
          deck: [...state.players.p1.prizes, ...state.players.p1.deck],
          prizes: [],
        },
        p2: {
          ...state.players.p2,
          deck: [...state.players.p2.prizes, ...state.players.p2.deck],
          prizes: [],
        },
      },
    };
    const { state: next, events } = mustApply(oldState, {
      type: "setupDrawExtra",
      seat: "p1",
      count: owed,
    });
    expect(types(events).slice(0, 3)).toEqual(["PRIZES_SET", "PRIZES_SET", "CARDS_DRAWN"]);
    expect(next.players.p1.prizes).toEqual(state.players.p1.prizes);
    expect(next.players.p2.prizes).toEqual(state.players.p2.prizes);
    expect(next.players.p1.hand.slice(HAND_SIZE - 1)).toEqual(state.players.p1.deck.slice(0, owed));
  });

  it("caps the draw at the owed count", () => {
    const { state, owed } = owedState();
    for (const count of [owed + 1, -1, 0.5]) {
      const result = applyAction(state, { type: "setupDrawExtra", seat: "p1", count });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("BAD_EXTRA_COUNT");
    }
  });

  it("rejects the seat that is not owed", () => {
    const { state, owed } = owedState();
    const result = applyAction(state, { type: "setupDrawExtra", seat: "p2", count: owed });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WRONG_SEAT");
  });

  it("draws up to the choice ('may draw'), then moves to placement", () => {
    const { state, owed } = owedState();
    const count = owed - 1;
    const { state: next, events } = mustApply(state, {
      type: "setupDrawExtra",
      seat: "p1",
      count,
    });
    expect(next.players.p1.hand).toHaveLength(HAND_SIZE - 1 + count);
    expect(events).toEqual([
      {
        type: "CARDS_DRAWN",
        seat: "p1",
        uids: next.players.p1.hand.slice(-count),
        reason: "compensation",
      },
      { type: "COMPENSATION_DECIDED", seat: "p1", drawn: count, owed },
    ]);
    expect(next.phase.kind).toBe("setup:place");
  });

  it("allows declining entirely — no draw, but the decision still emits", () => {
    const { state, owed } = owedState();
    const { state: next, events } = mustApply(state, {
      type: "setupDrawExtra",
      seat: "p1",
      count: 0,
    });
    // The phase advances, so an event-only consumer has to hear about it.
    expect(events[0]).toEqual({ type: "COMPENSATION_DECIDED", seat: "p1", drawn: 0, owed });
    expect(next.players.p1.hand).toHaveLength(HAND_SIZE);
    expect(next.phase.kind).toBe("turn:action");
  });
});

describe("placement", () => {
  function placeState(): GameState {
    const created = mustCreate(1, { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK });
    return chooseFirst(created.state, "p1").state;
  }

  it("requires the active before benching", () => {
    const state = placeState();
    const uid = handUid(state, "p1", "fix-basic-1");
    const result = applyAction(state, { type: "setupPlaceBench", seat: "p1", uid });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ACTIVE_NOT_PLACED");
  });

  it("places one Basic from hand as the face-down active", () => {
    const state = placeState();
    const uid = handUid(state, "p1", "fix-basic-1");
    const { state: next, events } = mustApply(state, { type: "setupPlaceActive", seat: "p1", uid });
    expect(events).toEqual([{ type: "POKEMON_PLACED", seat: "p1", uid, spot: "active" }]);
    expect(next.players.p1.hand).toHaveLength(HAND_SIZE - 1);
    expect(next.players.p1.active).toEqual({
      stack: [uid],
      energy: [],
      tools: [],
      damage: 0,
      conditions: { rotation: "none", poisonDamage: 0, burned: false, confusionDamage: 30 },
      retreatBlocked: false,
      retreatLockedTurn: null,
      attackBlock: null,
      attackLockedTurn: null,
      attackFlipLockTurn: null,
      attackTwoFlipLockTurn: null,
      damageReduction: null,
      noWeaknessTurn: null,
      scheduledEffect: null,
      attackDamageDebuff: null,
      damageVulnerability: null,
      attackDamageTaken: null,
      costTaxTurn: null,
      koBounty: null,
      handAttachMark: null,
      weaknessRetype: null,
      installedRecoil: null,
      lockedAttacks: [],
      boostedAttack: null,
      markers: [],
      turnPlayed: 0,
      promotedTurn: null,
      benchedTurn: null,
      healedTurn: null,
      evolvedTurn: null,
      usedAttack: null,
    });
  });

  it("rejects a second active", () => {
    let state = placeState();
    state = must(
      applyAction(state, {
        type: "setupPlaceActive",
        seat: "p1",
        uid: handUid(state, "p1", "fix-basic-1"),
      }),
    );
    const result = applyAction(state, {
      type: "setupPlaceActive",
      seat: "p1",
      uid: handUid(state, "p1", "fix-basic-1"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ACTIVE_ALREADY_PLACED");
  });

  it("rejects a card that is not in the actor's hand", () => {
    const state = placeState();
    const opponentUid = handUid(state, "p2", "fix-basic-1");
    const result = applyAction(state, { type: "setupPlaceActive", seat: "p1", uid: opponentUid });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CARD_NOT_IN_HAND");
  });

  it("rejects non-Basic cards for active and bench", () => {
    const created = mustCreate(SEED_STAGE1, { p1: MIXED_DECK, p2: MIXED_DECK });
    let state = chooseFirst(created.state, "p1").state;
    const stage1 = handUid(state, "p1", "fix-stage1");
    const asActive = applyAction(state, { type: "setupPlaceActive", seat: "p1", uid: stage1 });
    expect(asActive.ok).toBe(false);
    if (!asActive.ok) expect(asActive.error.code).toBe("NOT_A_BASIC_POKEMON");

    state = must(
      applyAction(state, {
        type: "setupPlaceActive",
        seat: "p1",
        uid: handUid(state, "p1", "fix-basic-1"),
      }),
    );
    const asBench = applyAction(state, { type: "setupPlaceBench", seat: "p1", uid: stage1 });
    expect(asBench.ok).toBe(false);
    if (!asBench.ok) expect(asBench.error.code).toBe("NOT_A_BASIC_POKEMON");
  });

  it("benches up to five, then rejects the sixth", () => {
    let state = placeState();
    state = must(
      applyAction(state, {
        type: "setupPlaceActive",
        seat: "p1",
        uid: handUid(state, "p1", "fix-basic-1"),
      }),
    );
    for (let i = 0; i < 5; i++) {
      state = must(
        applyAction(state, {
          type: "setupPlaceBench",
          seat: "p1",
          uid: handUid(state, "p1", "fix-basic-1"),
        }),
      );
    }
    expect(state.players.p1.bench).toHaveLength(5);
    const sixth = applyAction(state, {
      type: "setupPlaceBench",
      seat: "p1",
      uid: handUid(state, "p1", "fix-basic-1"),
    });
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) expect(sixth.error.code).toBe("BENCH_FULL");
  });

  it("locks a seat once it declares ready", () => {
    let state = placeState();
    state = must(
      applyAction(state, {
        type: "setupPlaceActive",
        seat: "p1",
        uid: handUid(state, "p1", "fix-basic-1"),
      }),
    );
    state = must(applyAction(state, { type: "setupReady", seat: "p1" }));
    for (const action of [
      { type: "setupPlaceBench", seat: "p1", uid: handUid(state, "p1", "fix-basic-1") } as const,
      { type: "setupReady", seat: "p1" } as const,
    ]) {
      const result = applyAction(state, action);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("ALREADY_READY");
    }
  });

  it("requires an active before readying", () => {
    const result = applyAction(placeState(), { type: "setupReady", seat: "p1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ACTIVE_NOT_PLACED");
  });

  it("rejects turn actions during setup", () => {
    const state = placeState();
    const result = applyAction(state, { type: "endTurn", seat: "p1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("BAD_PHASE");
  });
});

describe("finishing setup", () => {
  it("preserves the already-set prizes, reveals the board and starts turn 1 with a draw", () => {
    const created = mustCreate(1, { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK });
    let state = chooseFirst(created.state, "p1").state;
    const prizeCards = {
      p1: state.players.p1.deck.slice(0, PRIZE_COUNT),
      p2: state.players.p2.deck.slice(0, PRIZE_COUNT),
    };
    for (const seat of ["p1", "p2"] as const) {
      state = must(
        applyAction(state, {
          type: "setupPlaceActive",
          seat,
          uid: handUid(state, seat, "fix-basic-1"),
        }),
      );
    }
    state = must(applyAction(state, { type: "setupReady", seat: "p1" }));
    const { state: next, events } = mustApply(state, { type: "setupReady", seat: "p2" });

    expect(types(events)).toEqual([
      "SETUP_READY",
      "PRIZES_SET",
      "SETUP_REVEALED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(next.players.p1.prizes).toHaveLength(PRIZE_COUNT);
    expect(next.players.p2.prizes).toHaveLength(PRIZE_COUNT);
    expect(next.players.p1.prizes).toEqual(prizeCards.p1);
    expect(next.players.p2.prizes).toEqual(prizeCards.p2);
    // p1 went first and DOES draw on turn 1 (current rules, §4): 60 - 7 hand
    // - 6 prizes - 1 turn draw = 46 left.
    expect(next.players.p1.deck).toHaveLength(46);
    expect(next.players.p2.deck).toHaveLength(47);
    expect(next.players.p1.hand).toHaveLength(HAND_SIZE - 1 + 1);
    expect(next.turn).toBe(1);
    // The per-turn allowances live on state.allowances, not the phase (M2).
    expect(next.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(next.allowances).toEqual({
      energyAttached: false,
      retreated: false,
      supporterPlayed: false,
      stadiumPlayed: false,
      stadiumAbilityUsed: false,
      abilitiesUsed: [],
      sideAttackBonuses: [],
      supporterPlayedUid: null,
      endOfTurnHandDiscard: null,
      attackAgainUid: null,
    });
  });
});
