import { describe, expect, it } from "vitest";
import { DECK_SIZE, HAND_SIZE, PRIZE_COUNT, applyAction, createGame } from "./index";
import type { GameState, Seat } from "./index";
import {
  ALL_BASIC_DECK,
  FIXTURE_POOL,
  MIXED_DECK,
  ONE_BASIC_DECK,
  deckOf,
  handUid,
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
function chooseFirst(state: GameState, first: Seat): { state: GameState; events: unknown[] } {
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
    // p1's opening 7, p2's opening 7, straight to placement.
    expect(events).toEqual([
      { type: "FIRST_PLAYER_CHOSEN", first: "p2", chosenBy: "p1" },
      { type: "CARDS_DRAWN", seat: "p1", uids: state.players.p1.hand, reason: "opening" },
      { type: "CARDS_DRAWN", seat: "p2", uids: state.players.p2.hand, reason: "opening" },
    ]);
    expect(state.players.p1.hand).toHaveLength(HAND_SIZE);
    expect(state.players.p2.hand).toHaveLength(HAND_SIZE);
    expect(state.phase).toEqual({ kind: "setup:place", ready: { p1: false, p2: false } });
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
  it("auto-resolves reveal/shuffle/redraw until the hand has a Basic", () => {
    const created = mustCreate(SEED_MULL, { p1: ALL_BASIC_DECK, p2: ONE_BASIC_DECK });
    const { state, events } = chooseFirst(created.state, "p1");
    const mulligans = state.players.p2.mulligans;
    expect(mulligans).toBeGreaterThanOrEqual(2);
    expect(state.players.p1.mulligans).toBe(0);
    const reveals = events.filter((e) => (e as { type: string }).type === "MULLIGAN_REVEALED");
    expect(reveals).toHaveLength(mulligans);
    // The final hand is valid: 7 cards including the lone Basic.
    expect(state.players.p2.hand).toHaveLength(HAND_SIZE);
    expect(state.players.p2.hand.some((u) => state.cardIdByUid[u] === "fix-basic-1")).toBe(true);
    // One draw per OPPONENT mulligan; p2 mulliganed, so only p1 is owed and
    // p2 (owed 0) is pre-decided rather than prompted.
    expect(state.phase).toEqual({
      kind: "setup:drawExtra",
      owed: { p1: mulligans, p2: 0 },
      decided: { p1: false, p2: true },
    });
  });

  it("owes BOTH players when both mulligan — each off the other's count (§3.5)", () => {
    const created = mustCreate(SEED_BOTH_MULL, { p1: ONE_BASIC_DECK, p2: ONE_BASIC_DECK });
    const { state } = chooseFirst(created.state, "p1");
    const p1Mulls = state.players.p1.mulligans;
    const p2Mulls = state.players.p2.mulligans;
    expect(p1Mulls).toBeGreaterThanOrEqual(1);
    expect(p2Mulls).toBeGreaterThanOrEqual(1);
    // Mulliganing yourself does not forfeit the compensation you are owed.
    expect(state.phase).toEqual({
      kind: "setup:drawExtra",
      owed: { p1: p2Mulls, p2: p1Mulls },
      decided: { p1: false, p2: false },
    });
  });

  it("opens placement only once every owed seat has answered", () => {
    const created = mustCreate(SEED_BOTH_MULL, { p1: ONE_BASIC_DECK, p2: ONE_BASIC_DECK });
    let state = chooseFirst(created.state, "p1").state;
    state = must(applyAction(state, { type: "setupDrawExtra", seat: "p1", count: 0 }));
    expect(state.phase.kind).toBe("setup:drawExtra"); // p2 still owes an answer
    state = must(applyAction(state, { type: "setupDrawExtra", seat: "p2", count: 1 }));
    expect(state.phase.kind).toBe("setup:place");
  });

  it("skips compensation when nobody mulligans", () => {
    const created = mustCreate(1, { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK });
    const { state } = chooseFirst(created.state, "p1");
    expect(state.phase.kind).toBe("setup:place");
  });
});

describe("setupDrawExtra", () => {
  function owedState(): { state: GameState; owed: number } {
    const created = mustCreate(SEED_MULL, { p1: ALL_BASIC_DECK, p2: ONE_BASIC_DECK });
    const { state } = chooseFirst(created.state, "p1");
    if (state.phase.kind !== "setup:drawExtra") throw new Error("expected setup:drawExtra");
    return { state, owed: state.phase.owed.p1 };
  }

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
    expect(next.players.p1.hand).toHaveLength(HAND_SIZE + count);
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
    expect(events).toEqual([{ type: "COMPENSATION_DECIDED", seat: "p1", drawn: 0, owed }]);
    expect(next.players.p1.hand).toHaveLength(HAND_SIZE);
    expect(next.phase.kind).toBe("setup:place");
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
      // …and no SELF-installed retreat lock either (D412), read the same way as
      // the six stamps below rather than as the boolean above it: `retreatLocked`
      // (continuous.ts) compares this stamp to `state.turn`, so `null` is "never
      // locked" rather than "locked on turn 0". ⚠️ **TWO §11 RETREAT FIELDS AND
      // ONE QUESTION** — the boolean one line up is the OPPONENT-side half and this
      // stamp is the SELF-side one, and the pair is why `toEqual`'s exactness is
      // doing more here than usual: a slice that added the second field and left
      // this literal spelling only the first would have a fresh body asserting
      // half of a two-field answer, which is precisely the D222 shape the field's
      // own doc-comment warns about.
      retreatLockedTurn: null,
      // A card entering play carries no effect of an attack (D142) — the only
      // installation site is an attack's own effect program.
      attackBlock: null,
      // …and no self-lock either (D143), for the same reason and read the same
      // way: `attackLocked` compares the stamp to `state.turn`, so `null` is
      // "never locked" rather than "locked on turn 0".
      attackLockedTurn: null,
      // …and no durated damage reduction (D147), read the same way again:
      // `installedReductionOf` compares the stamp to `state.turn` and returns 0
      // for a `null`, so a fresh body reduces nothing rather than reducing on
      // turn 0. THIS ASSERTION IS THE THIRD STAMPED FIELD'S ONLY STRUCTURAL
      // GUARD outside its own suite — `toEqual` is exact, so a field added to
      // `makeInPlay` without a thought about what it means at placement fails
      // here first.
      damageReduction: null,
      // 🆕🆕 …and no attack-installed NO-WEAKNESS bar (D432), read the same way a
      // sixth time: `installedNoWeakness` compares the stamp to `state.turn`, so a
      // fresh body is Weak rather than un-Weak on turn 0. ⚠️ AND THIS `toEqual` IS
      // WHY THE FIELD IS `number | null` RATHER THAN `number | undefined`: an
      // exact object comparison tells "absent" from "present and null", which is
      // the very distinction `MATCH_RECORD_VERSION` 26 -> 27 exists to enforce at
      // the storage boundary.
      noWeaknessTurn: null,
      // 🆕🆕 …and NO SCHEDULED counter placement (D434), which is the SEVENTH read of
      // the same rule and the first one that is a RECORD rather than a stamp. That
      // matters exactly here: `scheduledEffectDue` asks `scheduled !== null` and
      // then dereferences `.turn`, so a body that reached this line with the key
      // ABSENT would not read as "nothing scheduled" — it would THROW at the next
      // Checkup. ⚠️ AND THIS `toEqual` IS WHY THE FIELD IS `… | null` RATHER THAN
      // `… | undefined`: an exact object comparison tells "absent" from "present and
      // null", which is the very distinction `MATCH_RECORD_VERSION` 27 -> 28 exists
      // to enforce at the storage boundary.
      scheduledEffect: null,
      attackDamageDebuff: null,
      // …and no ARMED recoil (D152), read the same way a fifth time:
      // `installedRecoilOf` compares the stamp to `state.turn`, so a fresh body
      // retaliates for nothing rather than retaliating on turn 0.
      installedRecoil: null,
      // …and no PER-ATTACK bar (D154; a LIST since D165), read the same way a
      // sixth time — and this is the one where "read the same way" stops being a
      // formality: `lockedAttackIndexes` returns INDICES, and 0 is a real index,
      // so an EMPTY list is the only thing separating a fresh body from one whose
      // attack 0 is barred on turn 0. The field carries records and not a bare
      // number for exactly that reason.
      lockedAttacks: [],
      // …and no PER-ATTACK BUFF (D155), read the same way a seventh time and for
      // the sixth field's reason exactly: `boostedAttackDamage` compares the stamp
      // to `state.turn` AND the stored index to the declared one, so a `null`
      // record is what keeps a fresh body's attack 0 from being paid +0 on turn 0
      // — which is a difference of nothing today and of a number the moment the
      // reader stops returning 0 on the way out.
      boostedAttack: null,
      markers: [],
      turnPlayed: 0,
      // Placed Active from the HAND, which is not a move from the Bench — the
      // one in-play Pokémon that never gets a `promotedTurn` stamp (D124).
      promotedTurn: null,
      // …and nothing has healed it either (D386): a card arriving from the hand
      // carries no damage, so there is nothing for a heal to remove. The stamp's
      // absence is `null` and not `0`, because turn 0 is a real turn number here.
      healedTurn: null,
      // …and it has not EVOLVED either (D393): a card placed from the hand arrives
      // as itself, and the one placement that is an evolution builds its body by
      // spread in `evolveOnto` rather than through `makeInPlay`. `null` and not `0`
      // for `healedTurn`'s reason one line up — turn 0 is a real turn number here.
      evolvedTurn: null,
      // …and it has never ATTACKED either (D394): the one writer is `finishAttack`
      // (flow.ts) and a body being placed in the setup phase has not been near it.
      // `null` and not a record for the same reason again — absence of a record is
      // the only thing that separates "never attacked" from "attacked on turn 0",
      // and unlike the six stamps above this one is READ two turns after it is
      // written, so a wrong absence would be wrong for longer.
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
  it("sets prizes, reveals the board and starts turn 1 with a draw", () => {
    const created = mustCreate(1, { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK });
    let state = chooseFirst(created.state, "p1").state;
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
      "PRIZES_SET",
      "SETUP_REVEALED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(next.players.p1.prizes).toHaveLength(PRIZE_COUNT);
    expect(next.players.p2.prizes).toHaveLength(PRIZE_COUNT);
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
    });
  });
});
