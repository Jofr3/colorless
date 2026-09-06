import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
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

// 0.308.0 → 0.309.0 — 🆕🆕 D404: THE MANDATORY HAND WIPE AND REFILL.
//
// "Discard your hand and draw 6 cards." — 1 sentence / 7 legal printings, the biggest
// single sentence left in the SPLIT-AWARE residue D403 handed on, and the cheapest of
// them: ONE whole-sentence anchor and ONE `deriveAttackEffect` arm returning
// `[{ op: "discardHand" }, { op: "drawCards", count }]`. Both ops shipped with
// Professor's Research; D385 already reached the first from ATTACK text through
// `optionalCostOps`. What is new is only that either is reached at the TOP LEVEL.
//
// 🛑 WHAT THIS FILE IS ABOUT IS AN ORDER, NOT A SENTENCE. Every op here is present and
// correct in isolation under the swap; the printed "and" is what makes the program
// right, and a COUNT cannot see the difference — three discarded and six drawn leaves a
// hand of six under both readings. §4 reads UIDS, which is the only instrument that can.
//
// 🛑 AND THE TWO FALSIFIERS THE HANDOFF NAMED ARE DRIVEN RATHER THAN ARGUED. §5 puts the
// draw on a deck of TWO and follows the board to the loss; §6 puts the discard on an
// EMPTY hand. Both held, and the REASONS are in the version block rather than the
// verdicts (D403's rule).

const attack = { type: "attack", seat: "p1", index: 0 } as const;

/** Every reader `censusAtHead.test.ts` sweeps with, so a sentence this file calls
    "unread" is unread by the WHOLE engine and not merely by the one reader it is about
    (D382's rule: a refusal claim that asks only its own producer is a claim about
    nothing). */
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
  // 🆕🆕 D419 — the TWELFTH reader (D417, `deriveAttackCancelRequirement`), which
  // this list never had.
  // ⚠️ SPLICED MID-LIST RATHER THAN APPENDED: mutant `find` strings in
  // `scripts/mutation/mutants.ts` quote an array's LAST entries plus its closing
  // `];`, and appending moves that anchor without a character of it changing —
  // the adjacency class D418 paid for once on `stadiumPresence.test.ts`.
  deriveAttackCancelRequirement,
  // 🆕🆕 D428 — THE THIRTEENTH, the PRE-DAMAGE Tool discard. ⚠️ SPLICED BEFORE THE
  // LAST ENTRY RATHER THAN APPENDED, D419's rule: mutant `find` strings quote an
  // array's LAST entries plus its closing bracket, and appending moves that anchor
  // without a character of it changing.
  deriveAttackPreDamage,
  deriveAttackDiscardScaledBoost,
];

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

/** THE SENTENCE THIS SLICE BUYS, byte for byte from `legalAttackCorpus()`. */
const TAKEN = "Discard your hand and draw 6 cards.";

/** THE REAL NEAR-MISS, and it is printed in the SAME column at the SAME count — which
    is what makes it worth more than any constructed one. Same zone emptied, same six
    cards drawn, DIFFERENT verb and DIFFERENT destination: this is `handRefresh`
    (shuffled back INTO the deck, order destroyed) and not `discardHand`.

    🆕🆕 **D479 BUILT IT, AND THE SENTENCE ABOVE IS WHY IT WAS BUILDABLE**: the
    identification `handRefresh`-and-not-`discardHand` was already correct, so the row
    cost ONE anchor (`SHUFFLE_HAND_DRAW`) and ONE arm (44b) and no op work at all. This
    constant therefore stops being a `toBeNull` witness and becomes a DISJOINTNESS
    witness — D444/D447's rule: a rung that quietly shrinks loses the transition, so the
    two rungs below assert the value it derives to NOW and name the decision that moved
    it. **The claim this file still makes about it is the one that matters**: the two
    anchors are STRUCTURALLY disjoint (a string cannot begin two ways — *"Discard "*
    versus *"Shuffle "*, both `^…$`), so neither can ever claim the other's sentence,
    which is exactly what D404's *"a read that floated on 'draw 6 cards' would take
    both"* was protecting. That is now asserted in BOTH directions instead of one. */
const SHUFFLED = "Shuffle your hand into your deck. Then, draw 6 cards.";

/** 🆕🆕 D479 — D404's PROGRAM for the sentence above, spelled once. `who: "you"` and
    `draw: { kind: "fixed" }` are Youngster `sv01-198`'s own authored values. */
const shuffledProgram = (count: number) => [
  { op: "handRefresh", who: "you", draw: { kind: "fixed", count } },
];

/** The PROGRAM, spelled once and reused, so a case cannot pass against a hand-copied
    literal that has drifted from what the file means by it. */
const program = (count: number) => [{ op: "discardHand" }, { op: "drawCards", count }];

describe("D404 §1 — the sentence, measured live over the legal column", () => {
  it("🆕🆕 D419 — the hand-kept READERS list IS the module's reader surface", () => {
    // 🛑 THE GUARD THIS FILE NEVER HAD, IN D417's SHAPE AND D418's WORDING. This
    // copy was hand-kept and NOTHING compared it to what `effects.ts` exports, so
    // it could sit short of the module indefinitely — which is precisely the state
    // `censusAtHead.test.ts` was in before D417 and thirty more files were in after
    // D418. A guard in another file guards that file's copy alone.
    //
    // ⚠️ AND THE FIGURES NO LONGER COME OFF THIS LIST AT ALL. Resolution below is
    // computed through `resolvedByAnyReader` IMPORTED from `censusAttackCorpus.ts`,
    // off the MODULE surface, so no edit here can move a census number again. What
    // survives is a DECLARED EXPECTATION, and this rung is its only remaining job.
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    // ⚠️ THE COUNT IS PINNED SEPARATELY FROM THE DIFF ABOVE, and the separation is
    // load-bearing: a diff alone stays GREEN when a slice deletes a reader from the
    // module and from this list in the SAME commit, and the figures would then move
    // with nothing naming the cause.
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("is really in the column, ONCE, at SEVEN printings", () => {
    // The attribution control (D183): without it every rung below could be green
    // against a paraphrase that no card prints.
    const rows = legalAttackCorpus().filter(([, s]) => s === TAKEN);
    expect([rows.length, units(rows)]).toEqual([1, 7]);
  });

  it("🛑 the arm is its ONLY reader — the other ELEVEN refuse it", () => {
    expect(deriveAttackEffect(TAKEN)).not.toBeNull();
    for (const read of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(TAKEN), read.name).toBeNull();
    }
  });

  it("🛑 the column prints ONE count for this skeleton, and it is 6", () => {
    // The measurement behind the CAPTURE, stated as a number rather than left implied.
    // A literal `6` in the anchor could never go red off this corpus — which is exactly
    // why the argument for capturing has to come from the OTHER column (§2 below), and
    // why the emptiness of this one is named rather than passed over (D400).
    const family = legalAttackCorpus().filter(([, s]) => /^Discard your hand and draw /.test(s));
    expect(family.map(([, s]) => s)).toEqual([TAKEN]);
    expect(units(family)).toBe(7);
  });

  it("⚠️ 🆕🆕 D479 — the SHUFFLE spelling is a real printing and is now BUILT, by ONE OTHER reader", () => {
    // 🛑 RE-POINTED, NOT DELETED (D444/D447/D467). Until D479 this rung asserted
    // `resolvedByAnyReader(SHUFFLED) === false` and thirteen `toBeNull`s — the witness
    // for "a whole slice of its own (`handRefresh` with `toBottom` absent)". D479 took
    // that slice, so the rung asserts the OTHER side and names the decision that moved
    // it; a witness that quietly shrinks to nothing loses the transition it recorded.
    const rows = legalAttackCorpus().filter(([, s]) => s === SHUFFLED);
    expect([rows.length, units(rows)]).toEqual([1, 1]);
    // 🆕🆕 D419 — ASSERTED OFF THE MODULE FIRST. The loop below names WHICH reader
    // claims it and is kept for that; but it can only ever walk the readers this file
    // happens to list, which is the failure mode D418 measured in 38 files. This line
    // walks whatever `effects.ts` exports today.
    expect(resolvedByAnyReader(SHUFFLED), SHUFFLED).toBe(true);
    // ⚠️ AND IT IS STILL A REFUSAL CLAIM — about the OTHER TWELVE. The property this
    // file needs is not "nobody reads it" but "exactly one reader does, and it is not
    // arm 44's", so a future widening that lets a second reader claim this sentence
    // reddens here exactly as the old shape would have.
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

  it("🛑 the count is a printed PARAMETER, and the TRAINER column is the evidence", () => {
    // The attack column prints 6 alone (§1), so the corpus cannot justify a capture on
    // its own. `registry.ts` can: the identical printed skeleton carries 7 on
    // Professor's Research `sv01-189` and 5 on Carmine `sv06-145`, both authored BY
    // HAND years before this arm existed. So the arm is read against the hand-authored
    // rows rather than against a re-typed expectation — one sentence, two producers,
    // and they must agree byte for byte or one of them is wrong.
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
    // The `>= 1` guard every counted arm in this file carries. A "draw 0 cards." is a
    // hand discard wearing a draw's sentence, and belongs on the ATTACK_EFFECT_SKIPPED
    // path where a census can see it.
    expect(deriveAttackEffect("Discard your hand and draw 0 cards.")).toBeNull();
    expect(deriveAttackEffect("Discard your hand and draw 1 cards.")).toEqual(program(1));
  });
});

describe("D404 §3 — the refusals, each pinned on ONE printed byte", () => {
  it("🛑 the VERB, the SEAT, the QUANTIFIER and the ORDER refuse INDEPENDENTLY", () => {
    // D399's rule: a near-miss the anchor already refuses for some OTHER reason proves
    // nothing about the byte you meant to test. THE POSITIVE CONTROL FIRST.
    expect(deriveAttackEffect(TAKEN)).not.toBeNull();
    // …the VERB alone, and it is the REAL printing rather than a construction.
    // 🆕🆕 D479 RE-POINTED THIS ONE TOO, AND IN THE DIRECTION THAT MAKES IT STRONGER.
    // `toBeNull` said only "arm 44 did not take it"; a wrong-program build would have
    // passed it just as happily as no build at all. Asserting the OTHER program says
    // "arm 44 did not take it AND the sentence went to the right reader", which is the
    // claim §3 is about. The two anchors are structurally disjoint — a string cannot
    // begin both *"Discard "* and *"Shuffle "* — so this pair can never both be true of
    // one string, and that is the disjointness stated as behaviour rather than prose.
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
    // The sharpest pair here, and a `toBeNull` cannot express the second half: the bare
    // draw DOES derive, and it must derive to the draw op ALONE with no discard in
    // front of it. A widened anchor with an optional `(?:Discard your hand and )?`
    // prefix passes every accept case in this file and fails exactly here — and in
    // production it would empty the hand of every card that prints a plain draw.
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
  it("🛑 the hand discarded is the OLD one, and the hand kept is the deck's OLD TOP SIX", () => {
    // THE RUNG THIS WHOLE SLICE EXISTS FOR. Under the swapped program every op still
    // runs, `HAND_DISCARDED` still fires and the hand still ends at six — so a
    // count-based assertion is green under the defect. These two SETS are disjoint by
    // construction and the swap makes them equal.
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

  it("🛑 the printed BASE is KEPT — neither op is a `damageDefender`", () => {
    // `programDamage` is `program?.some(step => step.op === "damageDefender")`, so it is
    // FALSE here and the printed number survives the whole pipeline. A reading that ever
    // claimed the base would silently delete a 30-damage attack, and the flat marker on
    // `fix-handdraw` is what makes that observable.
    const state = fielded(3);
    const { state: done, events } = mustApply(state, attack);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(done.players.p2.active?.damage).toBe(30);
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(1);
  });

  it("🛑 neither half of `ATTACK_EFFECT_SKIPPED` fires", () => {
    // `effectSimulated`'s FIRST disjunct is `program !== null`, so a new
    // `deriveAttackEffect` arm answers the effect half by construction and this slice
    // adds NO term to any of `attack.ts`'s three disjunction chains. The modifier half
    // is not in play at all — the fixture's marker is flat.
    //
    // 🛑 READ OFF THE `attack` ACTION, WHICH IS THE ONLY STEP THIS ROW CAN APPEAR IN
    // (D403's two GAPs were exactly this mistake asserted on a later step). Nothing here
    // parks, so there is one action and one event list — stated rather than relied on.
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
    // Zero cards emit nothing — the sibling ops' rule, and the reason it matters is that
    // a "drew 0 cards" row would announce that nothing had happened. The hand discard in
    // front of it is unaffected, which is what makes this the "do as much as you can"
    // ending rather than a refusal.
    const state = trimDeckTo(fielded(6), "p1", 0);
    const oldHand = [...state.players.p1.hand];
    const { state: done, events } = mustApply(state, attack);
    expect(types(events)).toContain("HAND_DISCARDED");
    expect(events.filter((e) => e.type === "CARDS_DRAWN" && e.seat === "p1")).toHaveLength(0);
    expect(done.players.p1.hand).toEqual([]);
    for (const uid of oldHand) expect(done.players.p1.discard).toContain(uid);
  });

  it("🛑 drawing the deck DRY does not end the game — the loss is owed to the DRAW", () => {
    // THE FALSIFIER, DRIVEN END TO END. §14.3 is a turn-START rule checked in `flow.ts`
    // `startTurn`, never at the moment the deck runs out — so an attack-borne draw
    // inside §8 cannot lose the game however deep it digs. P1 empties their own deck,
    // their turn ends, P2 takes a turn, and only THEN does P1 fail to draw.
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
    // `discardHand` returns the state untouched on an empty hand and pushes nothing —
    // the same silence every zero-card op in this engine keeps. D385 gated it behind
    // `yourHandNotEmpty` because the printed sentence there OFFERED the discard and the
    // offer needed a stake; this sentence is an IMPERATIVE with no offer, so §8.6's "do
    // as much as you can" is the whole rule and no gate is owed.
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

  it("🛑 nothing PARKS — the whole sentence resolves inside the `attack` action", () => {
    // The other half of the reachability question, and it is a property of the two ops
    // rather than of this sentence: both are fully automatic, `programPlayable`'s three
    // call sites are `playTrainer` and the two ability paths, and no attack passes
    // through it. So a top-level attack producer needs no gate, no `sourceUid` and no
    // second action — which is why this file has no `resolveEffect` step anywhere.
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
