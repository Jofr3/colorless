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
  optionalCostBoostProgram,
} from "./effects";
import { conditionHolds, conditionNote } from "./interpreter";
import type { BoardCondition, EffectOp, GameEvent, GameState, Seat } from "./index";
import {
  PURGING_STRIKE_DECK,
  attachFromDeck,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 🆕🆕 D385 — THE SECOND CONNECTIVE: THE SENTENCE D381 NAMED, REFUSED AND PRICED,
// TAKEN FOUR SLICES LATER AT LESS THAN HALF THE QUOTED PRICE.
//
//   Veluza ex `sv09-043` "Purging Strike" ({W}{W}{C}, `120+`, index 1 of two —
//   confirmed by id against tcgdex, which returns "Razor Fin" ({W}, 30, no effect
//   text) at index 0)
//     "You may discard your hand. If you discarded any cards in this way, this attack
//      does 120 more damage."
//     **1 legal printing.**
//
// `optionalCostBoost.test.ts` §1 has carried a rung since D381 saying **the family is
// EIGHT when the connective is shortened, not seven** — `/^You may .*\. If /` finds
// one record `/^You may .*If you do,/` cannot see — and it named this one, refused it
// and said what it was refused for: *"a HAND discard as an attack step **and** a
// consequent conditioned on the COST's own effect … a RECORD of what the cost did"*.
//
// ### THE PRICE WAS WRONG IN BOTH DIRECTIONS, WHICH IS D199's RULE FROM THE RARER SIDE
//
// * **THE DISCARD WAS ALREADY BUILT.** `discardHand` has been an `EffectOp` since
//   Professor's Research (registry.ts) — fully automatic, park-free, no fields. What
//   was missing was not the op but an ATTACK program that reaches it, and this is the
//   first one.
// * **THE RECORD IS NOT NEEDED AT ALL, AND THAT IS THE SLICE'S ONE REAL FINDING.**
//   `recordAs` on `discardHand` would have been a widening and would have cost a
//   single `recordMoved` line — the op already builds `[...side.hand]` for its event.
//   It is not built because the `recordGate` it would feed **could not fail**:
//   `AttackOptionalCostBoost.cond` is not optional, and the cost's payability
//   (`yourHandNotEmpty`) is the SAME predicate the printed *"if you discarded any
//   cards in this way"* states one clause later. A second reading of one fact is a
//   branch no board can take (D205's rule, and `switchActive`'s own note one op over).
// * **SO WHAT SHIPS IS A CONNECTIVE AND A GATE**: `OPTIONAL_COST_BOOST`'s literal
//   *". If you do, "* becomes a closed alternation of two, `optionalCostOps` gains a
//   third row, and the union gains ONE NULLARY `BoardCondition` member with TWO
//   exhaustive-switch arms. **ZERO new readers, ops, events, prompts, choice kinds,
//   payoff rows, registry rows or `packages/schema` bytes** — so
//   `MATCH_RECORD_VERSION` stays **22**.
//
// ### THE SHAPE QUESTIONS, ANSWERED FROM THE CATALOG BEFORE A LINE WAS WRITTEN
//
// 1. 🛑 **A WIDENED CONNECTIVE, NOT AN ELEVENTH READER — D383's ARGUMENT, ONE FIELD
//    OVER.** A second reader of *"You may {cost}. If {something}, {payoff}"* would
//    carry a top-level anchor no LEADING WORD could separate from this one, and every
//    reader here is held to a disjointness proof drawn from its leading words. **TWO
//    READERS CANNOT SHARE AN ANCHOR.** §2 drives it.
// 2. 🛑 **THE TWO CONNECTIVES ARE NOT SYNONYMS IN ENGLISH AND ARE SYNONYMS HERE, AND
//    THAT IS A PROOF OBLIGATION RATHER THAN A CONVENIENCE.** *"If you do"* asks
//    whether the offer was ACCEPTED; *"if you discarded any cards in this way"* asks
//    whether the accepted cost MOVED anything. They come apart exactly when a player
//    can say yes to a cost that whiffs — which this reading makes unreachable, because
//    every row of `optionalCostOps` supplies its cost's **EXACT** payability. §3
//    drives that equivalence for all THREE rows on boards, and it is the obligation
//    each future row inherits: a merely NECESSARY `cond` would pay out on a whiff.
// 3. 🛑 **A NULLARY MEMBER, BECAUSE THE PRINTED COST HAS NO DIGIT.** `yourHandExactly`
//    and `opponentHandAtMost` are parameterised because the catalog prints *"exactly
//    3"*, *"3 or fewer"*, *"5 or fewer"*. This cost names the whole hand, so a
//    `count: 1` would be INVENTED where `yourActiveEnergyAtLeast`'s arity is CAPTURED
//    — D383's own guard read from the other side. §1 measures that no own-hand
//    THRESHOLD is printed anywhere in the legal attack column, at any value.
//
// ⚠️ **THE VACUITY MODES, NAMED BEFORE THE BUILD AND EACH DRIVEN:**
//   • 🛑 **THE GATE'S FALSE ARM IS AN ORDINARY BOARD, WHICH NO GATE IN THIS FAMILY HAS
//     HAD BEFORE.** D381's needed an empty Stadium zone and D383's could not be
//     reached from the real printing at all (its suite drives a synthetic 4-Energy
//     cost). A player who has played their hand out and then attacks reaches this one
//     by legal play alone — so §6 drives it from the **REAL** printing, and dropping
//     the gate would offer a "yes" that discards NOTHING and still pays +120;
//   • the gate could be `>= 0` instead of `> 0` and every non-empty hand would be
//     green — §3 drives 0, 1 and 2 cards;
//   • the printed base could be dropped from either `otherwise` and a decline or a
//     refused gate would silently delete a 120-damage attack — §4 pins both arms and
//     §5/§6 read `DAMAGE_DEALT` on all three answers;
//   • the connective could be widened to a bare `. If ` and the reader would start
//     claiming sentence shapes it cannot pay — §2 refuses three synthetic ones;
//   • the whole reading could be dropped and the sentence would go back to the loud
//     `ATTACK_EFFECT_SKIPPED` path — §4 pins the program and §5 asserts its absence.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The TEN live readers, run as one — the same set `censusAtHead.test.ts` keeps.
    ⚠️ **THIS SLICE ADDS NO ELEVENTH**, which is shape question 1: the array is
    unchanged and the census still moves by one sentence. */
const READERS: readonly ((text: string) => unknown)[] = [
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

/** THE SENTENCE THIS SLICE BUYS, byte-for-byte from the committed corpus. */
const PURGING =
  "You may discard your hand. If you discarded any cards in this way, this attack does 120 more damage.";
/** D381's — the OTHER connective on the same skeleton, and this file's control at
    every seam where the two spellings have to be told apart. */
const CRUSHING_PRESS =
  "You may discard a Stadium in play. If you do, this attack does 140 more damage.";
/** D383's — the third cost row, and the one whose `cond` carries a captured digit. */
const TORRENTIAL =
  "You may shuffle 3 Energy attached to this Pokémon into your deck. If you do, this attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** …and the ONE the reading still owes, refused for a `PlayerState` field. */
const PRIZE_FLIP =
  "You may turn 1 of your face-down Prize cards face up. If you do, this attack does 80 more damage. (That Prize card remains face up for the rest of the game.)";

/** D381's census regex, kept verbatim: it is now a FLOOR on the reading rather than a
    description of it, which is the whole of what this slice changes about the family. */
const NARROW = /^You may .*If you do,/;
/** …and the shortened one that suite has carried since D381. */
const WIDE = /^You may .*\. If /;

const HAND_NOT_EMPTY: BoardCondition = { kind: "yourHandNotEmpty" };

// ── boards ─────────────────────────────────────────────────────────────────────

/** Setup, then P1's turn 2 (P2 went first and passed) — P1's first unrestricted turn,
    so the attack step is legal (§4). P1's Active is Veluza ex paid {W}{W}{C}; P2's is
    `fix-titan`, whose 340 HP survives the boosted **240** and whose name carries no
    Rule Box.

    Mulligan compensation is DECLINED on both sides (`extraDraw: 0`), which is a legal
    choice and the only way the opening hand sizes are seed-independent — a mulligan
    hands the opponent extra draws, and a suite whose gate reads a hand SIZE would then
    be asserting on the shuffle (`exactHandSize.test.ts`'s finding, one member over).

    **THE TWO SEATS DIFFER IN THE FIXTURE BEFORE ANY ASSERTION IS MADE ABOUT EITHER**
    (D380's finding: a seat defect hides inside a symmetric board) — P1 always attacks
    and only P1 ever holds the attacker. */
function board(seed: number): GameState {
  let state = driveSetup(
    seed,
    { p1: PURGING_STRIKE_DECK, p2: PURGING_STRIKE_DECK },
    { first: "p2", extraDraw: { p1: 0, p2: 0 }, active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = setActiveFromDeck(state, "p1", "fix-purging");
  state = attachFromDeck(state, "p1", "fix-water-energy", 2);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** TEST SURGERY: shrink `seat`'s hand to `size`, parking the surplus in the discard —
    the zone a played card would have reached anyway, so the result stays legal-shaped
    (every uid in exactly one zone). Shrink ONLY: growing a hand means drawing, and a
    draw is a real action.

    ⚠️ A FILE-LOCAL TWIN of `exactHandSize.test.ts`'s and `publicCount.test.ts`'s,
    deliberately and for their stated reason: a shared helper in `testFixtures.ts`
    would put a hand-editing surgery in reach of every suite that has no business
    resizing one. Three callers is still not a library. */
function setHandSize(state: GameState, seat: Seat, size: number): GameState {
  const side = state.players[seat];
  if (size > side.hand.length) throw new Error(`${seat} hand is ${side.hand.length}, cannot grow`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        hand: side.hand.slice(0, size),
        discard: [...side.discard, ...side.hand.slice(size)],
      },
    },
  };
}

const attack = (state: GameState, seat: Seat = "p1") =>
  mustApply(state, { type: "attack", seat, index: 0 });

const say = (state: GameState, yes: boolean) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes } });

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** THREE SEEDS (D270's rule). Nothing on this seam flips a coin, and nothing spends
    `rngState` — but the OPENING HAND is a shuffle, and this file's subject is its
    size, so the boards are seeded rather than pinned. */
const SEEDS = [9001, 9013, 9029] as const;

describe("§1 — the price, MEASURED IN REFUSED SENTENCES, before and after", () => {
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

  it("🛑 the reading goes 7 sentences / 14 printings → 8 / 15, and the REFUSED half stands still", () => {
    // 🛑 THE DENOMINATOR IS THE THING THAT MOVED, WHICH NO EARLIER SLICE IN THIS
    // FAMILY CHANGED. D381 and D383 each claimed one more of a FIXED seven; this one
    // claims a sentence that was never in the seven, so the family regex D381 wrote
    // has stopped describing the reader's domain and is a FLOOR on it.
    const narrow = corpus().filter(([, s]) => NARROW.test(s));
    expect([narrow.length, units(narrow)]).toEqual([7, 14]);
    const wide = corpus().filter(([, s]) => WIDE.test(s));
    expect([wide.length, units(wide)]).toEqual([8, 15]);
    // The reader's ACTUAL domain, re-derived: eight sentences, fifteen printings, with
    // the face-up Prize the only refusal left.
    const read = wide.filter(([, s]) => deriveAttackOptionalCostBoost(s) !== null);
    const forward = wide.filter(([, s]) => deriveAttackOptionalBoost(s) !== null);
    const refused = wide.filter(([, s]) => !resolvedByAnyReader(s));
    expect([read.length, units(read)]).toEqual([3, 8]);
    expect([forward.length, units(forward)]).toEqual([4, 5]);
    expect([refused.length, units(refused)]).toEqual([1, 2]);
    expect(refused.map(([, s]) => s)).toEqual([PRIZE_FLIP]);
    // …and the parts sum, which is what makes a partition a partition.
    expect(read.length + forward.length + refused.length).toBe(wide.length);
    expect(units(read) + units(forward) + units(refused)).toBe(units(wide));
    // BEFORE, re-derived rather than quoted: this slice adds exactly one cost row and
    // one connective, so removing the sentence they claim reproduces D384's head.
    const before = wide.filter(([, s]) => s === PURGING || !resolvedByAnyReader(s));
    expect([before.length, units(before)]).toEqual([2, 3]);
    // 🛑 THE TWO READERS ARE STILL MUTUALLY EXCLUSIVE ON EVERY PRINTED MEMBER of the
    // WIDENED family, which is the property that lets attack.ts SUM its terms instead
    // of choosing between them — and the widening is exactly where it could have been
    // lost.
    for (const [, s] of wide) {
      expect(
        [deriveAttackOptionalBoost(s), deriveAttackOptionalCostBoost(s)].filter((r) => r !== null)
          .length,
        s,
      ).toBeLessThan(2);
    }
  });

  it("the sentence carries ONE printing, and the census is asked TWICE", () => {
    const rows = corpus().filter(([, s]) => s === PURGING);
    expect([rows.length, units(rows)]).toEqual([1, 1]);
    // 🛑 **ONCE WITH THE LITERAL SHORTENED TO THE PART A SPELLING CANNOT CHANGE**
    // (D310/D311's rule): every legal attack sentence that OFFERS a hand discard at
    // all is this one, whatever it buys and however the connective is spelled.
    const offered = corpus().filter(([, s]) => /^You may discard your hand\b/.test(s));
    expect(offered.map(([, s]) => s)).toEqual([PURGING]);
    // …and once at the CONNECTIVE end, which is the half this slice widens: exactly
    // one record in the whole legal attack column spells "in this way" behind a
    // sentence break AND a leading "You may", and it is this one. **A SECOND SPELLING
    // WOULD BE A SECOND ALTERNATION BRANCH**, so the count is the anchor's expiry date.
    const connective = corpus().filter(([, s]) =>
      /^You may .*\. If you discarded any cards in this way, /.test(s),
    );
    expect(connective.map(([, s]) => s)).toEqual([PURGING]);
  });

  it("🛑 the MANDATORY hand discard was a DIFFERENT slice, and D404 took it", () => {
    // The ceiling this file priced and left (D379's rule, and `exactHandSize.test.ts`
    // §1's own rung re-derived here rather than quoted). The imperative spelling is
    // worth SEVEN printings and was refused for a reason this slice does not touch: it
    // is a hand discard followed by a DRAW, with no offer, no gate and no bonus.
    //
    // 🆕🆕 **D404 BUILT IT, AND THE RUNG IS RE-POINTED RATHER THAN DELETED** — as a
    // `deriveAttackEffect` arm, which is a DIFFERENT producer from this file's, so the
    // two readings must stay disjoint: this reader still refuses it, and if it ever
    // claimed it `attack.ts` would have two programs for one sentence.
    const mandatory = corpus().filter(([, s]) => s === "Discard your hand and draw 6 cards.");
    expect([mandatory.length, units(mandatory)]).toEqual([1, 7]);
    expect(resolvedByAnyReader("Discard your hand and draw 6 cards.")).toBe(true);
    expect(deriveAttackOptionalCostBoost("Discard your hand and draw 6 cards.")).toBeNull();
  });

  it("🛑 NO own-hand THRESHOLD is printed anywhere, which is why the member is NULLARY", () => {
    // Shape question 3, driven off the catalog rather than argued. `yourHandExactly`
    // and `opponentHandAtMost` carry a `count` because the catalog prints one; a
    // `count: 1` here would be a parameter with one inhabitant, invented rather than
    // captured. **WHAT WOULD FLIP IT is a printed own-hand floor**, and there is none.
    const floors = corpus().filter(([, s]) =>
      /\d+ or more cards in your hand|at least \d+ cards? in your hand/.test(s),
    );
    expect(floors).toEqual([]);
    // The controls that make that mean something: the two thresholds the catalog DOES
    // print are both about the OPPONENT's hand or about an exact own count.
    const printed = corpus().filter(([, s]) =>
      /cards in (your|their) hand,/.test(s) && /^If /.test(s),
    );
    expect(printed.length).toBeGreaterThan(0);
  });
});

describe("§2 — the CONNECTIVE is a closed alternation, and every refusal is driven", () => {
  it("the printed sentence reads as a precondition, ONE cost op and the moreDamage payoff", () => {
    expect(deriveAttackOptionalCostBoost(PURGING)).toEqual({
      cond: { kind: "yourHandNotEmpty" },
      ops: [{ op: "discardHand" }],
      payoff: { kind: "moreDamage", bonus: 120 },
    });
  });

  it("🛑 the ALTERNATION is CLOSED — a third connective is refused, not guessed", () => {
    // Synthetic on purpose: no card prints any of these, which is the whole point of
    // driving a refusal from outside the population (D379's saturation trap).
    const at = (connective: string) =>
      deriveAttackOptionalCostBoost(
        `You may discard your hand. ${connective}, this attack does 120 more damage.`,
      );
    // The two the anchor spells.
    expect(at("If you do")).not.toBeNull();
    expect(at("If you discarded any cards in this way")).not.toBeNull();
    // …and the near misses. A bare `. If ` would claim all of these, and each of them
    // asks a question this reading does not answer: a COUNT, a different zone, or a
    // fact about the board rather than about the cost.
    expect(at("If you discarded 3 or more cards in this way")).toBeNull();
    expect(at("If you discarded any Energy in this way")).toBeNull();
    expect(at("If your opponent's Active Pokémon is Burned")).toBeNull();
    // The case of the leading word is part of the anchor, exactly as it is on both
    // halves (D246 / D316).
    expect(at("if you do")).toBeNull();
    // …and the COMMA is not optional: the anchor splits the sentence on it.
    expect(
      deriveAttackOptionalCostBoost(
        "You may discard your hand. If you do this attack does 120 more damage.",
      ),
    ).toBeNull();
  });

  it("🛑 the COST anchor is whole-clause, and the near nouns are refused", () => {
    const at = (cost: string) =>
      deriveAttackOptionalCostBoost(
        `You may ${cost}. If you discarded any cards in this way, this attack does 120 more damage.`,
      );
    expect(at("discard your hand")).not.toBeNull();
    // A COUNTED hand discard is a different op and a different gate — `discardHand`
    // takes no count and there is nothing in this row to hold one.
    expect(at("discard 3 cards from your hand")).toBeNull();
    // The SEAT: the printed subject is "you", and the opponent's hand is neither this
    // op nor this member.
    expect(at("discard your opponent's hand")).toBeNull();
    // The ZONE: a shuffle is `handRefresh`, not `discardHand`.
    expect(at("shuffle your hand into your deck")).toBeNull();
    // The VERB, lowercase at its own anchor.
    expect(at("Discard your hand")).toBeNull();
  });

  it("🛑 the two OTHER cost rows accept the NEW connective, which is what makes it one reading", () => {
    // The widening is on the SKELETON and not on this row, and a connective wired into
    // one cost's branch would be invisible to every assertion above. Both existing
    // rows are re-read under the new spelling, and the readings are IDENTICAL to the
    // printed ones.
    const swapped = (text: string) => text.replace(". If you do,", ". If you discarded any cards in this way,");
    expect(deriveAttackOptionalCostBoost(swapped(CRUSHING_PRESS))).toEqual(
      deriveAttackOptionalCostBoost(CRUSHING_PRESS),
    );
    expect(deriveAttackOptionalCostBoost(swapped(TORRENTIAL))).toEqual(
      deriveAttackOptionalCostBoost(TORRENTIAL),
    );
    // …and the face-up Prize is STILL refused under BOTH connectives, so the widening
    // claimed nothing it cannot pay: its refusal is the PAYOFF's trailing reminder and
    // the `PlayerState` field behind the cost, neither of which this slice touches.
    expect(deriveAttackOptionalCostBoost(PRIZE_FLIP)).toBeNull();
    expect(deriveAttackOptionalCostBoost(swapped(PRIZE_FLIP))).toBeNull();
    expect(resolvedByAnyReader(PRIZE_FLIP)).toBe(false);
  });

  it("🛑 the OTHER NINE readers refuse it, which is what makes ten readers one answer", () => {
    for (const read of READERS) {
      if (read === deriveAttackOptionalCostBoost) continue;
      expect(read(PURGING), read.name).toBeNull();
    }
    // A leading or trailing sentence denies the compound, as it denies D316's reader.
    expect(deriveAttackOptionalCostBoost(`Draw a card. ${PURGING}`)).toBeNull();
    expect(deriveAttackOptionalCostBoost(`${PURGING} Draw a card.`)).toBeNull();
  });
});

describe("§3 — `yourHandNotEmpty`, and the EQUIVALENCE that licenses the connective", () => {
  it.each(SEEDS)("seed %i — `> 0` and not `>= 0`: 0, 1 and 2 cards each read", (seed) => {
    const state = board(seed);
    for (const size of [0, 1, 2]) {
      expect(conditionHolds(setHandSize(state, "p1", size), "p1", HAND_NOT_EMPTY), `${size}`).toBe(
        size > 0,
      );
    }
    // 🛑 THE ATTRIBUTION CONTROL: the untouched hand really is non-empty on this
    // board, so the `false` above is about the SIZE and not about a broken fixture.
    expect(state.players.p1.hand.length).toBeGreaterThan(0);
    expect(conditionHolds(state, "p1", HAND_NOT_EMPTY)).toBe(true);
  });

  it.each(SEEDS)("seed %i — it is SEAT-RELATIVE, and a one-seat board cannot say so", (seed) => {
    // The member is read from the ATTACKER's seat; a suite that only ever asked p1
    // could not tell "reads the attacker's hand" from "reads p1's hand". Empty ONE
    // hand and read BOTH seats.
    const state = setHandSize(board(seed), "p1", 0);
    expect(conditionHolds(state, "p1", HAND_NOT_EMPTY)).toBe(false);
    expect(conditionHolds(state, "p2", HAND_NOT_EMPTY)).toBe(true);
    const mirrored = setHandSize(board(seed), "p2", 0);
    expect(conditionHolds(mirrored, "p1", HAND_NOT_EMPTY)).toBe(true);
    expect(conditionHolds(mirrored, "p2", HAND_NOT_EMPTY)).toBe(false);
  });

  it("🛑 the near misses are computed BESIDE it, on a board where they disagree", () => {
    // D362's "widen or add" test, run as data. `yourHandExactly` is the same seat and
    // the same zone under an EQUALITY, so it is TRUE at exactly one size and cannot
    // express a floor; `opponentHandAtMost` is the wrong seat AND the wrong
    // comparator; `handSizesEqual` is symmetric and says nothing about either size.
    const state = setHandSize(setHandSize(board(SEEDS[0]), "p1", 2), "p2", 0);
    expect(conditionHolds(state, "p1", HAND_NOT_EMPTY)).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "yourHandExactly", count: 2 })).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "yourHandExactly", count: 1 })).toBe(false);
    // 🛑 …AND HERE IS WHY AN EQUALITY CANNOT STAND IN: at ONE card this member is TRUE
    // and `yourHandExactly { count: 2 }` is FALSE, so no single value of that
    // parameter answers the printed cost.
    const one = setHandSize(state, "p1", 1);
    expect(conditionHolds(one, "p1", HAND_NOT_EMPTY)).toBe(true);
    expect(conditionHolds(one, "p1", { kind: "yourHandExactly", count: 2 })).toBe(false);
    // The far-seat sibling reads P2's empty hand and answers TRUE at every threshold —
    // the opposite polarity on the opposite seat.
    expect(conditionHolds(state, "p1", { kind: "opponentHandAtMost", count: 0 })).toBe(true);
    // …and the symmetric one is FALSE here, so no board below can be passing through it.
    expect(conditionHolds(state, "p1", { kind: "handSizesEqual" })).toBe(false);
  });

  it("🛑 THE OBLIGATION EVERY COST ROW INHERITS: `cond` is the cost's EXACT payability", () => {
    // 🛑 **THIS IS THE LICENCE FOR THE CONNECTIVE WIDENING AND IT IS THE ONE CLAIM THE
    // SLICE CANNOT MAKE FROM A REGEX.** *"If you discarded any cards in this way"*
    // means the same as *"If you do"* only because a "yes" always moves something —
    // which holds exactly when each row's `cond` is NECESSARY **and** SUFFICIENT for
    // its ops to do anything. Asserted here as a property of the TABLE, over all three
    // printed rows, so a fourth row added without a matching gate reddens this rung
    // rather than silently paying out on a whiff.
    const rows = [PURGING, CRUSHING_PRESS, TORRENTIAL] as const;
    for (const text of rows) {
      const reading = deriveAttackOptionalCostBoost(text);
      if (reading === null) throw new Error(`expected a reading for ${text}`);
      // Every row supplies a gate — the field is not optional, and a row that returned
      // one without a `cond` would not compile. What is asserted is that the gate is
      // ABOUT the cost: the ops are non-empty and the `cond` names the zone they touch.
      expect(reading.ops.length, text).toBeGreaterThan(0);
      expect(reading.cond, text).not.toBeUndefined();
    }
    // …and the SUFFICIENCY half, driven on a board for this slice's row: with the gate
    // TRUE, `discardHand` moves at least one card. §5 reads the zones; here is the
    // predicate paired with the count it promises.
    const state = setHandSize(board(SEEDS[0]), "p1", 1);
    expect(conditionHolds(state, "p1", HAND_NOT_EMPTY)).toBe(true);
    expect(state.players.p1.hand).toHaveLength(1);
    const done = say(attack(state).state, true);
    expect(find(done.events, "HAND_DISCARDED")?.uids).toHaveLength(1);
  });

  it("the note is a reject pill, and it is a LITERAL because the member is nullary", () => {
    expect(conditionNote(HAND_NOT_EMPTY)).toBe("you have at least 1 card in your hand");
    // …and it does NOT round-trip to the printed bytes, which is stated rather than
    // discovered: the catalog spells this fact as a CONSEQUENT ("if you discarded any
    // cards in this way") and never as an antecedent, so the pill and the printed
    // clause are two strings with two audiences (D116, and the arm above's own note).
    expect(conditionNote(HAND_NOT_EMPTY)).not.toContain("in this way");
    // The sibling's pill, for the contrast the two are one line apart in the switch.
    expect(conditionNote({ kind: "yourHandExactly", count: 3 })).toBe(
      "you have exactly 3 cards in your hand",
    );
  });
});

describe("§4 — the program: D381's arm, and BOTH `otherwise`s carry the printed base", () => {
  const reading = () => {
    const parsed = deriveAttackOptionalCostBoost(PURGING);
    if (parsed === null) throw new Error("expected the reading");
    return parsed;
  };

  it("pins the assembly byte-for-byte: the gate, the confirm, the discard, the 240", () => {
    const expected: EffectOp[] = [
      {
        op: "conditionGate",
        cond: { kind: "yourHandNotEmpty" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          {
            op: "optional",
            note: PURGING,
            // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
            then: [{ op: "discardHand" }, { op: "damageDefender", amount: 240 }],
            otherwise: [{ op: "damageDefender", amount: 120 }],
          },
        ],
        otherwise: [{ op: "damageDefender", amount: 120 }],
      },
    ];
    expect(optionalCostBoostProgram(reading(), 120, PURGING)).toEqual(expected);
  });

  it("🛑 the COST goes IN FRONT of the hit, which is `boostedArms`' order REVERSED", () => {
    const gate = optionalCostBoostProgram(reading(), 120, PURGING)[0];
    if (gate === undefined || gate.op !== "conditionGate") throw new Error("expected the gate");
    const ask = gate.then[0];
    if (ask === undefined || ask.op !== "optional") throw new Error("expected the confirm");
    expect(ask.then.map((o) => o.op)).toEqual(["discardHand", "damageDefender"]);
  });

  it("🛑 the two decline arms are DISTINCT OBJECTS, so the program is a tree", () => {
    // D381's C8, re-driven on this sentence: `programWalk.test.ts` accounts for ops by
    // IDENTITY, so a shared decline array reports "already seen" down one path and
    // breaks that file's `structural - enumerated === missed` invariant by exactly one.
    const gate = optionalCostBoostProgram(reading(), 120, PURGING)[0];
    if (gate === undefined || gate.op !== "conditionGate") throw new Error("expected the gate");
    const ask = gate.then[0];
    if (ask === undefined || ask.op !== "optional") throw new Error("expected the confirm");
    expect(ask.otherwise).toEqual(gate.otherwise);
    expect(ask.otherwise).not.toBe(gate.otherwise);
  });

  it("🛑 the base VARIES the program, which is what says the payoff RE-HOMES it", () => {
    // The structural claim, and the control D383's arm is the inverse of: this payoff
    // moves the printed base inside the gate, so the assembly must differ at different
    // bases. A `benchSnipe` payoff does not vary at all.
    const at = (base: number) => optionalCostBoostProgram(reading(), base, PURGING);
    expect(at(30)).not.toEqual(at(120));
    const torrent = deriveAttackOptionalCostBoost(TORRENTIAL);
    if (torrent === null) throw new Error("expected D383's reading");
    expect(optionalCostBoostProgram(torrent, 30, TORRENTIAL)).toEqual(
      optionalCostBoostProgram(torrent, 120, TORRENTIAL),
    );
  });
});

describe("§5 — the board: the hand reaches the DISCARD PILE, and the hit is 240", () => {
  it.each(SEEDS)("seed %i — YES: the whole hand is discarded and the Defender takes 240", (seed) => {
    const before = board(seed);
    const hand = before.players.p1.hand;
    expect(hand.length).toBeGreaterThan(0);
    const pileBefore = before.players.p1.discard.length;

    const parked = attack(before);
    // 🛑 NOTHING IS DEALT BEFORE THE ANSWER: the printed base is re-homed INSIDE the
    // gate, so a `DAMAGE_DEALT` row here would be the base leaking out of the program.
    expect(types(parked.events)).not.toContain("DAMAGE_DEALT");
    expect(types(parked.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(parked.state.phase.kind).toBe("effect:choose");
    expect(find(parked.events, "EFFECT_PENDING")).toEqual({
      type: "EFFECT_PENDING",
      seat: "p1",
      note: PURGING,
    });

    const done = say(parked.state, true);
    // 🛑 THE ZONE, NOT MERELY THE LENGTH — a hand emptied into nowhere would be green
    // on every "the hand is empty" assertion.
    expect(done.state.players.p1.hand).toEqual([]);
    expect(done.state.players.p1.discard).toHaveLength(pileBefore + hand.length);
    for (const uid of hand) expect(done.state.players.p1.discard).toContain(uid);
    expect(find(done.events, "HAND_DISCARDED")).toEqual({
      type: "HAND_DISCARDED",
      seat: "p1",
      uids: [...hand],
    });
    // …and the boosted hit, ONCE.
    expect(find(done.events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", base: 240, dealt: 240 });
    expect(done.state.players.p2.active?.damage).toBe(240);
    expect(done.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it.each(SEEDS)("seed %i — NO: the hand stays put and the printed 120 still lands", (seed) => {
    const before = board(seed);
    const hand = before.players.p1.hand;
    const pileBefore = before.players.p1.discard.length;
    const done = say(attack(before).state, false);
    // 🛑 THE DEFECT `optional`'s own doc names: a confirm that silently applies on "no".
    expect(done.state.players.p1.hand).toEqual(hand);
    expect(done.state.players.p1.discard).toHaveLength(pileBefore);
    expect(types(done.events)).not.toContain("HAND_DISCARDED");
    // 🛑 …AND THE ARM THAT WOULD OTHERWISE DELETE A 120-DAMAGE ATTACK. The card is
    // printed `120+`, so a decline deals the base — D381's finding, and the reason
    // this reading's `otherwise` is present where D383's is absent.
    expect(find(done.events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", base: 120, dealt: 120 });
    expect(done.state.players.p2.active?.damage).toBe(120);
  });
});

describe("§6 — the gate, driven from the REAL printing on an ORDINARY board", () => {
  it.each(SEEDS)("seed %i — 🛑 an EMPTY HAND is never offered, and the 120 still lands", (seed) => {
    // 🛑 **THE FIRST FALSE ARM IN THIS FAMILY THAT THE PRINTED CARD CAN REACH.**
    // D381's needs an empty Stadium zone and D383's cannot be reached from its own
    // printing at all (that suite drives a synthetic 4-Energy cost). A player who has
    // played their hand out and then attacks reaches this one by legal play alone.
    //
    // Without the gate, `optional` parks unconditionally and a "yes" discards NOTHING
    // and still collects the printed +120 — a free 120, which is D381's C2 defect on a
    // board that is not a corner case.
    const before = setHandSize(board(seed), "p1", 0);
    expect(conditionHolds(before, "p1", HAND_NOT_EMPTY)).toBe(false);
    const done = attack(before);
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(types(done.events)).not.toContain("EFFECT_PENDING");
    expect(types(done.events)).not.toContain("HAND_DISCARDED");
    // 🛑 THE GATE REFUSES THE QUESTION, NEVER THE ATTACK — the outer `otherwise`, and
    // an empty arm there would silently delete a 120-damage attack on the commonest
    // board this card sees late in a game.
    expect(types(done.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(done.events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", base: 120, dealt: 120 });
    expect(done.state.players.p2.active?.damage).toBe(120);
    // …and the CONTROL: the same board, the same seed, ONE card in hand — offered.
    const one = setHandSize(board(seed), "p1", 1);
    expect(attack(one).state.phase.kind).toBe("effect:choose");
  });

  it.each(SEEDS)("seed %i — 🛑 ONE card is the boundary, and it pays the FULL printed bonus", (seed) => {
    // The boundary the gate is drawn at, driven rather than described: a hand of one
    // is payable and buys the whole +120 — the printed sentence says *"any cards"*,
    // not *"all of them"*, so there is no proportionality anywhere in this reading.
    const before = setHandSize(board(seed), "p1", 1);
    const done = say(attack(before).state, true);
    expect(find(done.events, "HAND_DISCARDED")?.uids).toHaveLength(1);
    expect(done.state.players.p1.hand).toEqual([]);
    expect(find(done.events, "DAMAGE_DEALT")).toMatchObject({ base: 240, dealt: 240 });
  });
});
