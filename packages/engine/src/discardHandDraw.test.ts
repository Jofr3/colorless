import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackCopy,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackRequirement,
} from "./effects";
import type { GameEvent, GameState } from "./index";
import { programFor } from "./registry";
import {
  HAND_DRAW_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  handToDeck,
  mustApply,
  setActiveFromDeck,
  trimDeckTo,
  types,
} from "./testFixtures";

const attack = { type: "attack", seat: "p1", index: 0 } as const;

const READERS: readonly ((t: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackBonusConsequent,
  deriveAttackOptionalCostBoost,
  deriveAttackCancelRequirement,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackDiscardScaledBoost,
];

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

const TAKEN = "Discard your hand and draw 6 cards.";

const SHUFFLED = "Shuffle your hand into your deck. Then, draw 6 cards.";

const shuffledProgram = (count: number) => [
  { op: "handRefresh", who: "you", draw: { kind: "fixed", count } },
];

/** The PROGRAM, spelled once and reused, so a case cannot pass against a hand-copied
    literal that has drifted from what the file means by it. */
const program = (count: number) => [{ op: "discardHand" }, { op: "drawCards", count }];

describe("D404 §1 — the sentence, measured live over the legal column", () => {
  it("D419 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("is really in the column, ONCE, at SEVEN printings", () => {
    const rows = legalAttackCorpus().filter(([, s]) => s === TAKEN);
    expect([rows.length, units(rows)]).toEqual([1, 7]);
  });

  it("the arm is its ONLY reader — the other ELEVEN refuse it", () => {
    expect(deriveAttackEffect(TAKEN)).not.toBeNull();
    for (const read of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(TAKEN), read.name).toBeNull();
    }
  });

  it("the column prints ONE count for this skeleton, and it is 6", () => {
    const family = legalAttackCorpus().filter(([, s]) => /^Discard your hand and draw /.test(s));
    expect(family.map(([, s]) => s)).toEqual([TAKEN]);
    expect(units(family)).toBe(7);
  });

  it(" D479 — the SHUFFLE spelling is a real printing and is now BUILT, by ONE OTHER reader", () => {
    const rows = legalAttackCorpus().filter(([, s]) => s === SHUFFLED);
    expect([rows.length, units(rows)]).toEqual([1, 1]);
    expect(resolvedByAnyReader(SHUFFLED), SHUFFLED).toBe(true);
    expect(deriveAttackEffect(SHUFFLED)).toEqual(shuffledProgram(6));
    for (const read of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(SHUFFLED), read.name).toBeNull();
    }
  });
});

describe("D404 §2 — the program, and why the count is CAPTURED", () => {
  it("derives the two ops in PRINTED ORDER", () => {
    expect(deriveAttackEffect(TAKEN)).toEqual(program(6));
  });

  it("the count is a printed PARAMETER, and the TRAINER column is the evidence", () => {
    expect(deriveAttackEffect("Discard your hand and draw 7 cards.")).toEqual(
      programFor("sv01-189")?.trainer,
    );
    expect(deriveAttackEffect("Discard your hand and draw 5 cards.")).toEqual(
      programFor("sv06-145")?.trainer,
    );
    // …and the two really are DIFFERENT programs, so the pair above is not one
    // assertion written twice.
    expect(programFor("sv01-189")?.trainer).not.toEqual(programFor("sv06-145")?.trainer);
  });

  it("a printed 0 stays LOUD, and 1 does not", () => {
    expect(deriveAttackEffect("Discard your hand and draw 0 cards.")).toBeNull();
    expect(deriveAttackEffect("Discard your hand and draw 1 cards.")).toEqual(program(1));
  });
});

describe("D404 §3 — the refusals, each pinned on ONE printed byte", () => {
  it("the VERB, the SEAT, the QUANTIFIER and the ORDER refuse INDEPENDENTLY", () => {
    expect(deriveAttackEffect(TAKEN)).not.toBeNull();
    expect(deriveAttackEffect(SHUFFLED)).not.toEqual(program(6));
    expect(deriveAttackEffect(SHUFFLED)).toEqual(shuffledProgram(6));
    // …the SEAT alone: the printed subject is "you", and the opponent's hand is neither
    // this op (which is keyed on `ctx.seat`) nor anything this engine can empty.
    expect(deriveAttackEffect("Discard your opponent's hand and draw 6 cards.")).toBeNull();
    // …the QUANTIFIER alone: a COUNTED discard is a different op with a different park.
    // `discardHand` takes no count and there is nowhere in this program to hold one.
    expect(deriveAttackEffect("Discard 3 cards from your hand and draw 6 cards.")).toBeNull();
    // …the ORDER alone: the reversed sentence is not printed by anything, and reading it
    // would need the SWAPPED program §4 exists to refuse.
    expect(deriveAttackEffect("Draw 6 cards and discard your hand.")).toBeNull();
  });

  it("the two HALVES apart: one is nobody's sentence, the other is D181's", () => {
    expect(deriveAttackEffect("Discard your hand.")).toBeNull();
    expect(deriveAttackEffect("Draw 6 cards.")).toEqual([{ op: "drawCards", count: 6 }]);
    expect(deriveAttackEffect("Draw a card.")).toEqual([{ op: "drawCards", count: 1 }]);
  });

  it("the anchor is WHOLE-SENTENCE — a leading or trailing clause is refused", () => {
    for (const text of [
      `Draw a card. ${TAKEN}`,
      `${TAKEN} Then, shuffle your deck.`,
      `${TAKEN} If you do, this attack does 60 more damage.`,
      // Case is load-bearing: no reader in `effects.ts` carries an `/i`.
      TAKEN.toLowerCase(),
      TAKEN.toUpperCase(),
      // The trailing period is required — the failure mode this repo names first,
      // because a regex written from a paraphrase matches no real card.
      "Discard your hand and draw 6 cards",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE BOARD. One fixture, and the deck is the instrument.
// ─────────────────────────────────────────────────────────────────────────────

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1 goes second, so their
    first turn carries no §4 attack restriction. */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: HAND_DRAW_DECK, p2: HAND_DRAW_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields `fix-handdraw` holding one `fix-energy` (the printed {C} cost); P2's Active
    is a 200 HP body the flat 30 never Knocks Out, so no KO tail can land between the
    discard and the draw. */
function fielded(seed: number): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-handdraw");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  return setActiveFromDeck(state, "p2", "fix-bigbody");
}

/** Every card id `HAND_DRAW_DECK` prints, so "empty the hand" is a statement about the
    deck list rather than about one seed's draw. */
const DECK_IDS = ["fix-handdraw", "fix-bigbody", "fix-item", "fix-energy"] as const;

/** TEST SURGERY, composed from the shipped helper: return P1's whole hand to the bottom
    of their deck. The bottom, never the top, for `trimDeckTo`'s reason — the top is
    exactly what the op under test reads. */
function emptyHand(state: GameState): GameState {
  let next = state;
  for (const id of DECK_IDS) next = handToDeck(next, "p1", id);
  return next;
}

describe("D404 §4 — the printed ORDER, read off UIDS because a count cannot see it", () => {
  it("the hand discarded is the OLD one, and the hand kept is the deck's OLD TOP SIX", () => {
    const state = fielded(1);
    const before = state.players.p1;
    const oldHand = [...before.hand];
    const topSix = before.deck.slice(0, 6);
    expect(oldHand.length).toBeGreaterThan(0);
    expect(topSix).toHaveLength(6);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, attack);

    expect(find(events, "HAND_DISCARDED")).toMatchObject({ seat: "p1", uids: oldHand });
    expect(find(events, "CARDS_DRAWN")).toMatchObject({
      seat: "p1",
      uids: topSix,
      reason: "effect",
    });
    // The hand afterwards is the six drawn cards and NOTHING ELSE — the old hand is not
    // in it, and the six are not in the discard.
    expect(done.players.p1.hand).toEqual(topSix);
    for (const uid of oldHand) expect(done.players.p1.discard).toContain(uid);
    for (const uid of topSix) expect(done.players.p1.discard).not.toContain(uid);
    // …and the deck lost exactly six off the top, from the seventh card down.
    expect(done.players.p1.deck).toEqual(before.deck.slice(6));
  });

  it("the two ops run at the attack's TAIL, in printed order, after the damage", () => {
    // An `EffectOp` runs after §8.5 and before `finishAttack`'s Knock Out sweep, so the
    // printed 30 lands FIRST and the program follows it. The tail rows are P1's turn
    // ending and P2's beginning — the standard ending of every attack in this suite.
    const state = fielded(2);
    const { events } = mustApply(state, attack);
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "HAND_DISCARDED",
      "CARDS_DRAWN",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
  });

  it("the printed BASE is KEPT — neither op is a `damageDefender`", () => {
    const state = fielded(3);
    const { state: done, events } = mustApply(state, attack);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(done.players.p2.active?.damage).toBe(30);
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(1);
  });

  it("neither half of `ATTACK_EFFECT_SKIPPED` fires", () => {
    const state = fielded(4);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, attack);
    expect(types(events)).toContain("ATTACK_DECLARED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(done.phase.kind).not.toBe("effect:choose");
  });
});

describe("D404 §5 — FALSIFIER 1: the draw on a SHORT deck costs no rule", () => {
  it("SHORT-DRAWS off a two-card deck and reports what MOVED", () => {
    // `drawToHand` SLICES, so the six-card draw files TWO and stops. The event carries
    // the SHORT list, so the log and the wire agree with the board rather than with the
    // printed number — `deckTopMill`'s own contract, one zone over.
    const state = trimDeckTo(fielded(5), "p1", 2);
    const top = [...state.players.p1.deck];
    expect(top).toHaveLength(2);
    const { state: done, events } = mustApply(state, attack);
    expect(find(events, "CARDS_DRAWN")).toMatchObject({ seat: "p1", uids: top, reason: "effect" });
    expect(done.players.p1.hand).toEqual(top);
    expect(done.players.p1.deck).toEqual([]);
  });

  it("an EMPTY deck draws NOTHING and emits no row, and the discard still happens", () => {
    const state = trimDeckTo(fielded(6), "p1", 0);
    const oldHand = [...state.players.p1.hand];
    const { state: done, events } = mustApply(state, attack);
    expect(types(events)).toContain("HAND_DISCARDED");
    expect(events.filter((e) => e.type === "CARDS_DRAWN" && e.seat === "p1")).toHaveLength(0);
    expect(done.players.p1.hand).toEqual([]);
    for (const uid of oldHand) expect(done.players.p1.discard).toContain(uid);
  });

  it("drawing the deck DRY does not end the game — the loss is owed to the DRAW", () => {
    const state = trimDeckTo(fielded(7), "p1", 2);
    const { state: attacked, events } = mustApply(state, attack);
    expect(attacked.players.p1.deck).toEqual([]);
    expect(types(events)).not.toContain("GAME_OVER");
    expect(attacked.phase.kind).not.toBe("gameOver");

    const { state: done, events: later } = mustApply(attacked, { type: "endTurn", seat: "p2" });
    expect(find(later, "GAME_OVER")?.outcome).toEqual({
      result: "win",
      winner: "p2",
      reason: "deckOut",
    });
    // The loss is the ATTACKER's — the player whose own printed attack emptied their
    // deck — which is what makes the draw a printed cost rather than a bug in the arm.
    expect(done.players.p1.deck).toEqual([]);
  });
});

describe("D404 §6 — FALSIFIER 2: the discard from a TOP-LEVEL attack arm", () => {
  it("an EMPTY hand emits no row at all, and the draw still runs", () => {
    const state = emptyHand(fielded(8));
    expect(state.players.p1.hand).toEqual([]);
    const topSix = state.players.p1.deck.slice(0, 6);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, attack);

    expect(types(events)).not.toContain("HAND_DISCARDED");
    expect(find(events, "CARDS_DRAWN")).toMatchObject({ uids: topSix, reason: "effect" });
    expect(done.players.p1.hand).toEqual(topSix);
    // …and the attack is still a 30-damage attack, which is what a program that had
    // refused itself on the empty hand would have deleted.
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });

  it("nothing PARKS — the whole sentence resolves inside the `attack` action", () => {
    const state = fielded(9);
    const { state: done } = mustApply(state, attack);
    expect(done.phase.kind).not.toBe("effect:choose");
    // The turn really did end inside the same batch, so nothing is waiting.
    expect(done.phase.kind).toBe("turn:action");
    expect(done.phase.kind === "turn:action" ? done.phase.seat : null).toBe("p2");
  });

  it("the discard lands in the CONTROLLER's own pile, and the opponent's is untouched", () => {
    // `ctx.seat` is the attacker on both ops — the seat question asked of the pair
    // rather than assumed from the sentence's "your".
    const state = fielded(10);
    const before = state.players.p1.hand.length;
    const p2Discard = [...state.players.p2.discard];
    const p2Hand = [...state.players.p2.hand];
    const { state: done } = mustApply(state, attack);
    expect(done.players.p1.discard).toHaveLength(state.players.p1.discard.length + before);
    expect(done.players.p2.discard).toEqual(p2Discard);
    // P2 drew for their turn, so their hand grew by exactly one and lost nothing.
    expect(done.players.p2.hand.slice(0, p2Hand.length)).toEqual(p2Hand);
    expect(done.players.p2.hand).toHaveLength(p2Hand.length + 1);
  });
});
