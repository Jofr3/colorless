import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader as readByAny,
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
import type { BoardCondition, GameEvent, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  EXACT_HAND_SIZE_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 🆕🆕 D379 — THE EXACT HAND-SIZE READ: THE LAST SENTENCE BEHIND THE
// "…THIS ATTACK DOES NOTHING." SKELETON, AND THE FIRST CANCEL-ONLY MEMBER.
//
// D378 handed this over as the ONE printed does-nothing opener no
// `ATTACK_REQUIREMENT_CLAUSES` row carried, with the shape question already
// half-measured. The answer held: ONE new PARAMETERISED `BoardCondition` member,
// `yourHandExactly { count }`, ONE clause row, TWO reader arms.
//
//   Alolan Dugtrio  `sv08-123`/`sv08-208`  "Trio-Cheehoo"  (NO Energy cost, 120)
//                   *"If you don't have exactly 3 cards in your hand, this attack does nothing."*
//                   2 legal printings
//
// 🛑 **BOTH CONSEQUENTS WERE ASKED AGAIN AND THE BONUS SIDE IS EMPTY — A FIRST.**
// D363, D365, D377 and D378 each bought a member that BOTH clause tables read, and
// the last two turned on that. The legal attack column prints no own-hand exact read
// under a "+N more damage" consequent at all, so all 2 printings arrive through the
// cancel table. **ASKING BOTH CONSEQUENTS IS STILL RIGHT; THE ANSWER IS SOMETIMES
// ZERO, AND THAT IS A RESULT RATHER THAN A MISS.** §1 measures it.
//
// 🛑 **THE NEAR MISS IS `opponentHandAtMost`, AND IT IS WRONG TWICE — THE SEAT AND
// THE COMPARATOR.** D365 measured that when it refused this sentence. Both halves
// are real: that member reads `players[otherSeat(seat)]` against `<=`, this one reads
// `players[seat]` against `===`. No parameterisation of a threshold yields an
// equality and no seat argument makes one member answer both printed sentences — so
// this is an ADDITION and the seat-parameter question D366 left open is not even
// reachable from here. §3 and §4 drive the disagreement on real boards rather than
// arguing it, with Absol ex `sv03-135` "Cursed Slug" fielded on the SAME state.
//
// ⚠️ **THE SHAPE ANSWER: A SINGLE `count`, AND THE CATALOG CHOSE IT.** Both shapes
// are already in the union one family over — `opponentPrizesRemaining { counts }` is
// SET MEMBERSHIP because the pool prints *"exactly 3 or 4 Prize cards"*,
// `opponentHandAtMost { count }` is a THRESHOLD. Asked of the hand column at this
// head: *"exactly 3"* is the ONLY own-hand exact read in the whole legal attack
// column — no second value, no disjunction, no own-hand threshold. **WHAT WOULD FLIP
// IT is a printed own-hand DISJUNCTION**; a second printing at a different single
// value flips nothing, because that is the axis `count` already varies on. §1 pins
// both halves of that measurement so the choice reddens if the catalog moves.
//
// ⚠️ **THE VACUITY MODES, NAMED BEFORE THE BUILD AND EACH DRIVEN ON A BOARD:**
//   • the comparator is `===`, so `>=` is green on a 3-card hand and wrong on a
//     4-card one and `<=` is green on a 3-card hand and wrong on a 2-card one — §4
//     attacks with 2, 3 AND 4 cards in hand and reports 120 on exactly one;
//   • the seat is the ATTACKER's own, so an arm reading the far hand is green on
//     every board where the two hands happen to be level — §3 sweeps a grid where
//     they never are, and §4's headline board holds P1 at 4 and P2 at 3;
//   • the polarity is owned by the skeleton, so a row storing the NEGATION would
//     cancel exactly when the card fires — §4's three boards are the discriminator;
//   • the row is keyed on the printed LITERAL, so a table "simplified" into a `\d+`
//     pattern would map a sentence the catalog does not print — §2 refuses six
//     constructed rewrites and §6 drives the one that matters through `fix-sawk`.
//
// 🛑 **AND THIS SLICE EXPIRES A GUARD FOUR FILES SHARE — ON PURPOSE, AS PREDICTED.**
// With this row the does-nothing skeleton has NO unmapped sentence left, so
// `splitOrder.test.ts` §4's `unmapped` array is EMPTY and
// `sawkRequirementSplit.test.ts`, `attackRequirement.test.ts`, `exOnlyActive.test.ts`
// and `fix-sawk`'s index-2 printed effect all lose their real printed subject. Every
// one becomes a CONSTRUCTED near-miss and says so in its own block. **A GUARD KEYED
// ON A REFUSAL HAS AN EXPIRY DATE, AND THE SLICE THAT EXPIRES IT OWNS THE REWRITE.**
//
// WHAT SHIPS: **1 new PARAMETERISED `BoardCondition` member**, its **2** reader arms
// and **1** `ATTACK_REQUIREMENT_CLAUSES` row. Zero new maps, templates, patterns,
// ops, events, imports or `packages/schema` bytes — and zero
// `CONDITIONAL_DAMAGE_CLAUSES` rows, which is the part that is new.
// `MATCH_RECORD_VERSION` stays 22: the parameter is a plain `number` inside a
// `BoardCondition` (the shape `opponentHandAtMost` already persists) and the arm
// reads `players[seat].hand`, in the record since M1 with its shape untouched.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The two consequent skeletons, as labelled COPIES — the readers' own patterns are
    module-private. Whole-sentence anchored at BOTH ends, like theirs. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;
const NOTHING = /^If (.+), this attack does nothing\.$/;

/** ~~The nine live readers, run as one — the same set `censusAtHead.test.ts` uses.~~

    🛑🛑 🆕🆕 **D418 — THE HEADER ABOVE IS STRUCK AND THE ARRAY IS WIDENED TO TWELVE,
    WHICH REVERSES THIS FILE'S OWN EXPLICIT, ARGUED REFUSAL TO DO EXACTLY THAT.** The
    refusal is in the `SIZE_CEILING` block below, kept verbatim and NOT deleted,
    because it is the evidence. It said: *"THE NINE-READER ARRAY IS NOT A BUG AND IS
    NOT WIDENED HERE… adding a tenth reader to it would move numbers this slice has
    nothing to do with."*

    ⚠️ **THAT REASONING WAS LOCALLY CORRECT, AND THAT IS THE PROBLEM WITH IT.**
    Widening a shared instrument inside a slice about hand sizes really would move a
    neighbouring figure the slice had not measured — so the right call, for that
    slice, was to decline. The same call was available and equally right in every
    other slice, which is how a two-entry gap survived **179 commits** and reached
    THREE (D381's `deriveAttackOptionalCostBoost`, D403's
    `deriveAttackDiscardScaledBoost`, D417's `deriveAttackCancelRequirement`). **A
    DEFECT EVERY LOCAL DECISION IS RIGHT TO DECLINE HAS NO LOCAL FIX, AND A DEFECT
    WITH NO LOCAL FIX IS PERMANENT UNTIL SOMEONE CHANGES THE SHAPE.**

    🛑 **SO D418 DID NOT ANSWER THE ARGUMENT — IT REMOVED ITS PREMISE.** The premise
    was that this array IS the census instrument, so touching it moves census
    numbers. It no longer is: every figure in this file is computed through
    `resolvedByAnyReader` IMPORTED FROM `censusAttackCorpus.ts` and derived from the
    MODULE, which is the same twelve readers on every branch of the repo at once.
    Widening the array below therefore moves NOTHING — it only makes §1's first rung
    agree with the module. The old block's fear was real and is now unfounded, in
    that order, and both halves are left standing so a successor can see why.

    ⚠️ The one figure the widening DOES move is the refusal claim the old block
    carved out by hand (`CEILING_TAKEN_AT_D385`), and §1 states that reversal in
    place rather than deleting the rung. */
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
  // 🆕🆕 D418 — the TENTH, ELEVENTH and TWELFTH (D381, D403, D417). Three readers,
  // one silence, one edit; see the block above for why it took 179 commits.
  deriveAttackOptionalCostBoost,
  deriveAttackDiscardScaledBoost,
  // 🆕🆕 D428 — THE THIRTEENTH, the PRE-DAMAGE Tool discard. ⚠️ SPLICED BEFORE THE
  // LAST ENTRY RATHER THAN APPENDED, D419's rule: mutant `find` strings quote an
  // array's LAST entries plus its closing bracket, and appending moves that anchor
  // without a character of it changing.
  deriveAttackPreDamage,
  deriveAttackCancelRequirement,
];

/** THE SENTENCE THIS SLICE BUYS, byte-for-byte from the committed corpus. */
const TRIO_CHEEHOO = "If you don't have exactly 3 cards in your hand, this attack does nothing.";
/** The NEAR MISS: the same noun, the other seat, the other comparator — and it has
    been in the union since D115. Every board below is measured against it. */
const CURSED_SLUG = "If your opponent has 3 or fewer cards in their hand, this attack does 120 more damage.";
/** …and the third hand clause, the SEAT-SYMMETRIC one (D119), kept in view because
    it is the reading a lazy "both hands" arm would drift into. */
const EXTRASENSORY = "If you have the same number of cards in your hand as your opponent, this attack does 90 more damage.";

const EXACT_CLAUSE = "you don't have exactly 3 cards in your hand";

const EXACTLY_3: BoardCondition = { kind: "yourHandExactly", count: 3 };
const THEIRS_AT_MOST_3: BoardCondition = { kind: "opponentHandAtMost", count: 3 };
const HANDS_LEVEL: BoardCondition = { kind: "handSizesEqual" };

/** THE CEILING, PRICED FROM THE CORPUS AND LEFT. Every legal attack sentence that
    reads a hand's SIZE and is still refused. None of them is a `BoardCondition`:
    the first is a `DamageCountSource` over the FAR hand, and the second a draw whose
    count is the far hand.

    🛑 🆕🆕 **D385 TOOK THE MIDDLE ENTRY, AND THIS RUNG WAS GREEN AND FALSE WHEN IT DID
    — WHICH IS D382's DEFECT REPRODUCED EXACTLY.** The list used to carry *"You may
    discard your hand. If you discarded any cards in this way, this attack does 120
    more damage."* under the note *"an op plus a did-it clause"*, and §1's loop asserts
    every entry is refused by `resolvedByAnyReader`. D385 built that sentence — through
    `deriveAttackOptionalCostBoost`, which **this file's hand-kept `READERS` array does
    not contain** — so nothing here reddened and the rung went on claiming a refusal
    that had stopped existing. It was caught by grepping `mutants.ts` and the suite for
    the SENTENCE (D384's rule) rather than by running anything.

    ⚠️ **THE NINE-READER ARRAY IS NOT A BUG AND IS NOT WIDENED HERE.** This file's
    census figures (`resolved` / `residue`) are a NINE-reader instrument that four
    suites share and that the resume point pins at 364 / 1,255; adding a tenth reader
    to it would move numbers this slice has nothing to do with. What was wrong is that
    a REFUSAL claim was drawn from an instrument that cannot see one reader. **A
    CENSUS INSTRUMENT AND A REFUSAL ORACLE ARE NOT THE SAME OBJECT**, and the sentence
    is removed from the list rather than the array being changed.

    🛑🛑 🆕🆕 **D418 — THE PARAGRAPH DIRECTLY ABOVE IS REVERSED, AND IT IS KEPT WORD
    FOR WORD BECAUSE IT IS THE EVIDENCE.** The array WAS widened, to twelve, and the
    census figures did not move a digit — because D418 first took the figures off the
    array entirely (`resolvedByAnyReader` now comes from `censusAttackCorpus.ts` and
    is derived from the MODULE). ⚠️ **THE ARGUMENT WAS NOT WRONG; IT WAS LOAD-BEARING
    ON A PREMISE NOBODY THOUGHT TO ATTACK.** Its premise — *"this array IS a shared
    census instrument, so widening it moves neighbouring numbers"* — was true, and it
    made widening a cost that no single slice could justify paying. Every slice after
    this one faced the identical trade and reached the identical, correct, local
    answer. **THAT IS WHY THE GAP LASTED 179 COMMITS AND GREW FROM ONE READER TO
    THREE** (D381, D403, D417): a defect that every local decision is right to decline
    has no local fix, and it stays until the SHAPE changes rather than the verdict.

    ⚠️ AND THE CARVE-OUT THIS BLOCK CHOSE INSTEAD — *"the sentence is removed from the
    list rather than the array being changed"* — is the second half of the lesson. It
    fixed the one refusal claim its author could SEE, by hand, and left the instrument
    that hid it in place; the very next thing the instrument hid was D404's, then
    D417's. **A HAND-CARVED EXCEPTION IS A REPAIR THAT DOES NOT COMPOUND.** The
    resulting rung (`expect(readByAny(CEILING_TAKEN_AT_D385)).toBe(false)`) had by
    D418 become a test that would go RED if anyone fixed the array — see §1's
    ceiling rung, where it is reversed in place rather than deleted. */
const SIZE_CEILING = [
  // 🛑 🆕🆕 **D445 REMOVED THE FIRST ENTRY FROM THIS LIST AND KEPT ITS SUBJECT, WHICH IS
  // D444's RULE RATHER THAN D385's.** *"This attack does 30 damage for each card in your
  // opponent's hand."* is now claimed — by `deriveAttackDamageMultiplier`, through the
  // seventeenth `DamageCountSource` (`cardsInOpponentHand`) — so re-pointing the rung ONTO
  // it would have produced a TRUE assertion nothing can falsify. **The move is to find the
  // sentence that STILL has the old property**, and the second entry does: it reads the far
  // hand's size, no reader claims it, and it wants a DRAW COUNT rather than this member. The
  // departure is asserted below beside D385's, so an "un-build" reddens this file.
  "Shuffle your hand into your deck. Then, draw a card for each card in your opponent's hand.",
] as const;
/** 🆕🆕 **D445 — THE SECOND CEILING ENTRY TO LEAVE, AND IT LEAVES FOR A DIFFERENT REASON
    THAN D385's.** D385's entry was taken by a reader that was already in the file's array
    and merely unseen by it; this one is taken by a reader arm that did not exist. What it
    is NOT is this file's member: a per-card damage SCALER over the far hand is a
    `DamageCountSource`, where an exact-hand-size READ is a `BoardCondition` — the ceiling
    block's own distinction, and the reason it was priced and left rather than built. */
const CEILING_TAKEN_AT_D445 = "This attack does 30 damage for each card in your opponent's hand.";
/** …and the entry that LEFT the ceiling at D385, kept so this file still says what
    happened to it. ~~Refused by this file's nine readers and resolved by the tenth.~~
    🆕🆕 **D418 — struck: there is one oracle now and it RESOLVES this sentence.** The
    reader is still named (`deriveAttackOptionalCostBoost`) and §1 still pins WHICH one
    took it; what is gone is the nine-reader view that called it refused. */
const CEILING_TAKEN_AT_D385 =
  "You may discard your hand. If you discarded any cards in this way, this attack does 120 more damage.";

// ── boards ─────────────────────────────────────────────────────────────────────

/** TEST SURGERY: shrink `seat`'s hand to `size`, parking the surplus in the discard
    — the zone a played card would have reached anyway, so the result stays
    legal-shaped (every uid in exactly one zone). Shrink ONLY: growing a hand means
    drawing, and a draw is a real action §5's organic case uses instead of a helper.

    ⚠️ A FILE-LOCAL TWIN OF `publicCount.test.ts`'s, deliberately. That one is the
    only other suite whose subject is a hand LENGTH, and neither exports it: a shared
    helper in `testFixtures.ts` would put a hand-editing surgery in reach of every
    suite that has no business resizing one. Two callers is not a library. */
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

/** Setup, then P1's turn 2 (P2 went first and passed) — P1's first unrestricted
    turn, so the attack step is legal (§4) — with BOTH Active spots pinned to a
    neutral 200 HP `fix-bigbody`, the arithmetically clean defender every damage
    number below is measured against.

    Mulligan compensation is DECLINED on both sides (`extraDraw: 0`), which is a legal
    choice and the only way the opening hand sizes are seed-independent: a mulligan
    hands the opponent extra draws, and a suite whose whole subject is hand SIZE would
    then be asserting on the shuffle. Every case that needs a specific size sets it
    explicitly anyway — the declination is what makes the STARTING point knowable. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: EXACT_HAND_SIZE_DECK, p2: EXACT_HAND_SIZE_DECK },
    { first: "p2", extraDraw: { p1: 0, p2: 0 }, active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** `board`, handed over to P2. The member is seat-RELATIVE, and a P1-only suite
    cannot tell "reads the attacker's hand" apart from "reads p1's hand" — so every
    board reading is taken from the far seat too. ⚠️ NOTE the extra draw: each turn's
    draw alternates, so the hands here are 6 (P1) and 7 (P2), not level. */
function boardP2(seed: number): GameState {
  return mustApply(board(seed), { type: "endTurn", seat: "p1" }).state;
}

/** Field `cardId` in `seat`'s Active Spot and pay `spec` onto it symbol-for-symbol.
    Must run in that order: `attachFromDeck` attaches to whatever is Active. ⚠️ AND IT
    MUST RUN BEFORE ANY HAND SURGERY — both helpers pull from the DECK, so they leave
    the hand alone, but a later `setActiveFromDeck` would not undo a shrink. */
function fielded(
  state: GameState,
  seat: Seat,
  cardId: string,
  spec: readonly (readonly [string, number])[],
): GameState {
  let next = setActiveFromDeck(state, seat, cardId);
  for (const [id, count] of spec) next = attachFromDeck(next, seat, id, count);
  return next;
}

/** Alolan Dugtrio's body. NO Energy is paid, because the card prints no cost — the
    requirement is the only thing between this body and 120 damage. */
const trioCheehoo = (state: GameState, seat: Seat = "p1"): GameState =>
  fielded(state, seat, "fix-triocheehoo", []);

/** Absol ex's body, paid {D}{D}{D} — the WRONG-SEAT control. */
const cursedSlug = (state: GameState, seat: Seat = "p1"): GameState =>
  fielded(state, seat, "sv03-135", [["fix-dark-energy", 3]]);

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

describe("§1 — the price, RE-DERIVED: the does-nothing skeleton goes EMPTY", () => {
  it("🆕🆕 D418 — the hand-kept READERS list IS the module's reader surface", () => {
    // 🛑 THE GUARD THIS FILE ARGUED ITSELF OUT OF NEEDING, IN D417's SHAPE. The
    // `SIZE_CEILING` block below declined to widen this array and said so in capitals;
    // what it could not do was make the DECISION visible to anyone else, so the array
    // drifted from nine to a twelve-reader module in silence and the carve-out it
    // wrote by hand went stale too. **A REFUSAL RECORDED IN PROSE IS NOT A GUARD** —
    // this rung is the same refusal made falsifiable, and it goes red on the next
    // reader instead of on the next reader plus 179 commits.
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    // ⚠️ THE COUNT IS PINNED SEPARATELY FROM THE DIFF, because the diff alone stays
    // GREEN when a reader leaves the module and this list in the same commit.
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("🛑 the CANCEL residue reaches ZERO — there is no sentence left to name", () => {
    // D378 left the does-nothing remainder at 1 sentence / 2 printings and named it.
    // This takes it, and the rung that used to say WHICH sentence was owed now says
    // there is none. Re-derived off the nine live readers over `legalAttackCorpus()`,
    // not quoted.
    const refused = corpus().filter(([, s]) => NOTHING.test(s.trim()) && !readByAny(s));
    expect(refused.some(([, s]) => s === TRIO_CHEEHOO)).toBe(false);
    expect(refused).toEqual([]);
    expect(units(refused)).toBe(0);
    // 🛑 EVERY EARLIER HEAD IS RE-DERIVED FROM THIS ONE rather than frozen: D378's
    // 1/2, D377's 2/4, D376's 3/5.
    expect([refused.length + 1, units(refused) + 2]).toEqual([1, 2]);
    expect([refused.length + 2, units(refused) + 4]).toEqual([2, 4]);
    expect([refused.length + 3, units(refused) + 5]).toEqual([3, 5]);
  });

  it("🛑 the BONUS residue STOOD STILL for D379 — asserted as an OFFSET, not as a head", () => {
    // The half that makes this the first reader-keyed slice since D366 whose bonus
    // column does not move. Asserted rather than omitted: a rung that only checked
    // the cancel side could not tell "the bonus half is empty" from "nobody looked".
    //
    // 🆕🆕 **D384 — AND THE FROZEN PAIR IS WHAT WENT STALE, NOT THE CLAIM.** This rung
    // read `toBe(21)` / `toBe(25)` and D384 took a bonus sentence out of that residue
    // (the STRICT-INEQUALITY TWIN, Swalot `sv07-092`, 1 sentence / 1 printing), so the
    // literal pair reddened while what the rung is ABOUT — that D379's own slice moved
    // this column by ZERO — was never in doubt. **A STANDING-STILL IS A DIFFERENCE AND
    // MUST BE WRITTEN AS ONE**: the head is re-derived live below and D379's head is
    // reached by adding back exactly what left it since, which is a figure this rung
    // can keep being right about.
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !readByAny(s));
    // 🆕🆕 D386 — 20 / 24 -> 19 / 22: the HEALED-THIS-TURN clause left this residue —
    // ONE sentence at TWO printings (Maractus `sv10.5b-008`/`-093` "Lively Needles",
    // +100) — re-derived live rather than decremented. 🛑 AND IT EMPTIES THE 2-PRINTING
    // BAND: it was the last clause in it, so every band rung below is re-aimed off the
    // WHOLE distribution rather than off a list that can no longer be non-empty (D379).
    // 🆕🆕 D387 — 19 / 22 -> **18 / 21**: the STAGE 1 clause left this residue — ONE
    // sentence at ONE printing (Paldean Tauros `sv08-018` "Spirited Tackle", +90) —
    // re-derived live rather than decremented. 🛑 THE 2-PRINTING BAND STAYS EMPTY and
    // the distribution goes `{1: 17, 5: 1}` -> `{1: 16, 5: 1}`, so every band rung is
    // still aimed at the WHOLE distribution and its refusal still comes from OUTSIDE
    // the emptied band (D379).
    // 🆕🆕 D388 — 18 / 21 -> **17 / 20**: the RETREAT-COST THRESHOLD left this residue
    // — ONE sentence at ONE printing (Talonflame `sv07-123` "Aero Chase", +110) —
    // re-derived live rather than decremented. 🛑 THE 2-PRINTING BAND STAYS EMPTY and
    // the distribution goes `{1: 16, 5: 1}` -> `{1: 15, 5: 1}`, so every band rung is
    // still aimed at the WHOLE distribution (D379).
    // 🆕🆕 D389 — 17 / 20 -> **16 / 19**: the OPPONENT-SEAT BENCH COUNT left this
    // residue — ONE sentence at ONE printing (Iron Crown `sv08-132` "Deleting Slash",
    // +80) — re-derived live rather than decremented. 🛑 THE 2-PRINTING BAND STAYS
    // EMPTY and the distribution goes `{1: 15, 5: 1}` -> `{1: 14, 5: 1}`, so every
    // band rung is still aimed at the WHOLE distribution (D379).
    // 🆕🆕 D390 — 16 / 19 -> **15 / 18**: the OPPONENT-SEAT TYPE READ left this
    // residue — ONE sentence at ONE printing (Electivire `sv05-054` "Short-Circuit
    // Knuckle", +120) — re-derived live rather than decremented. 🛑 THE 2-PRINTING
    // BAND STAYS EMPTY and the distribution goes `{1: 14, 5: 1}` -> `{1: 13, 5: 1}`,
    // so every band rung is still aimed at the WHOLE distribution (D379).
    // 🆕🆕 D391 — 15 / 18 -> **14 / 17**: the TYPED PER-BODY ENERGY THRESHOLD left this
    // residue — ONE sentence at ONE printing (Abomasnow `sv10-060` "Frozen Wood", +120) —
    // re-derived live rather than decremented. 🛑 THE 2-PRINTING BAND STAYS EMPTY and the
    // distribution goes `{1: 13, 5: 1}` -> `{1: 12, 5: 1}`, so every band rung is still aimed
    // at the WHOLE distribution (D379). ⚠️ AND IT IS THE FIRST STEP IN THIS RUN TAKEN BY AN
    // OPTIONAL FIELD ON A SHIPPED MEMBER rather than by a new one.
    // 🆕🆕 D392 — 14 / 17 -> **13 / 16**: the SUBSTRING NAME READ left this residue — ONE
    // sentence at ONE printing (Team Rocket's Nidoqueen `sv10-116` "Love Impact", +120) —
    // re-derived live rather than decremented. 🛑 THE 2-PRINTING BAND STAYS EMPTY and the
    // distribution goes `{1: 12, 5: 1}` -> `{1: 11, 5: 1}`. ⚠️ AND THIS STEP WAS TAKEN BY A
    // SECOND MEMBER, the OPPOSITE shape from D391's one slice back — the measurements that
    // decided it are driven in `benchNameSubstring.test.ts` §2.
    expect(refused.length).toBe(5); // 🆕🆕 D436 -2 sentences (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D398 — 8 -> 7, the DECK-SIZE READ, and the LAST buildable sentence in this residue
    expect(units(refused)).toBe(5); // 🆕🆕 D436 -5 printings (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D398 — 11 -> 10, the DECK-SIZE READ's one printing
    // D379's head (which is also D378's, because D379 moved this column by zero — the
    // whole point of the rung) and D377's before it, re-derived from THIS one.
    // 🆕🆕 D392 — the OFFSET gains one on each axis: the head moved, this one's did not.
    expect([refused.length + 16, units(refused) + 20]).toEqual([21, 25]);
    // 🆕🆕 D392 — the OFFSET gains one on each axis: the head moved, this one's did not.
    expect([refused.length + 17, units(refused) + 21]).toEqual([22, 26]);
  });

  it("🛑 BOTH CONSEQUENTS ASKED, AND THE BONUS SIDE IS EMPTY — a first for this family", () => {
    // D363, D365, D377 and D378 each bought a member both clause tables read. Here
    // the other consequent has NOTHING in it, and that is measured over the whole
    // legal attack column rather than assumed from a failure to find one.
    const cancelRows = corpus().filter(([, s]) => s === TRIO_CHEEHOO);
    expect(cancelRows).toHaveLength(1);
    expect(units(cancelRows)).toBe(2);
    // No bonus sentence anywhere carries an own-hand EXACT read…
    const ownHandExactBonus = corpus().filter(([, s]) => {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      return clause.includes("exactly") && clause.includes("in your hand");
    });
    expect(ownHandExactBonus).toEqual([]);
    // …and of the FOUR bonus clauses that mention a hand at all, THREE resolve and none
    // resolves to this member. A bonus twin would show up right here. The two named
    // below are `opponentHandAtMost` and `handSizesEqual`; the third is that member's
    // second threshold (Mienshao's *"5 or fewer"*), and the fourth is unresolved and is
    // not a hand-SIZE read at all — it asks what was PLAYED from the hand this turn.
    const handBonus = corpus().filter(([, s]) => (BONUS.exec(s.trim())?.[1] ?? "").includes("hand"));
    expect(handBonus).toHaveLength(4);
    expect(handBonus.filter(([, s]) => readByAny(s))).toHaveLength(3);
    for (const sentence of [CURSED_SLUG, EXTRASENSORY]) {
      expect(handBonus.some(([, s]) => s === sentence), sentence).toBe(true);
      expect(readByAny(sentence), sentence).toBe(true);
    }
    expect(handBonus.filter(([, s]) => !readByAny(s)).map(([, s]) => s)).toEqual([
      "If you played a Future Supporter card from your hand during this turn, this attack does 100 more damage.",
    ]);
    for (const [, s] of handBonus) {
      const bonus = deriveAttackDamageBonus(s);
      const cond = bonus?.count.kind === "boardCondition" ? bonus.count.cond : null;
      expect(cond?.kind, s).not.toBe("yourHandExactly");
    }
  });

  it("🛑 THE SHAPE ANSWER, MEASURED: 'exactly 3' is the column's ONLY own-hand exact read", () => {
    // The rung that makes `count: number` a result rather than a preference, and the
    // one that reddens if the catalog ever warrants `counts`.
    const ownHandExact = corpus().filter(
      ([, s]) => s.includes("exactly") && s.includes("cards in your hand"),
    );
    expect(ownHandExact.map(([, s]) => s)).toEqual([TRIO_CHEEHOO]);
    // 🛑 AND WHAT WOULD FLIP IT IS A DISJUNCTION, NOT A SECOND VALUE. The Prize
    // family one member over prints exactly that shape, which is why THAT member
    // takes a list — so the discriminator exists in the catalog and this clause is
    // on the other side of it.
    const prizeDisjunction = corpus().filter(([, s]) => /exactly \d+ or \d+ Prize/.test(s));
    expect(prizeDisjunction).toHaveLength(1);
    expect(corpus().filter(([, s]) => /exactly \d+ or \d+ cards in your hand/.test(s))).toEqual([]);
    // …and there is no own-hand THRESHOLD either, which is the other shape this
    // member could have been mistaken for. Every "or fewer"/"or more" hand clause in
    // the column reads the OPPONENT's hand.
    for (const [, s] of corpus().filter(([, s]) => /or (fewer|more) cards in (your|their) hand/.test(s))) {
      expect(s, s).toContain("in their hand");
      expect(s, s).not.toContain("in your hand");
    }
  });

  it("🛑 the requirement table's reach goes 8 s / 16 p → 9 s / 18 p, and the openers are ALL of them", () => {
    // The accounting `splitOrder.test.ts` §4 keeps. The does-nothing OPENER population
    // is unmoved — this slice mapped the last one, it did not print one.
    const openers = corpus().filter(([, s]) => /^If .+?, this attack does nothing\./.test(s));
    expect([openers.length, units(openers)]).toEqual([9, 18]);
    const mapped = openers.filter(([, s]) => deriveAttackRequirement(s) !== null);
    expect([mapped.length, units(mapped)]).toEqual([9, 18]);
    const unmapped = openers.filter(([, s]) => deriveAttackRequirement(s) === null);
    expect([unmapped.length, units(unmapped)]).toEqual([0, 0]);
    // The parts sum, which is what makes a partition a partition — and here one part
    // is the whole, which is the milestone.
    expect(mapped.length + unmapped.length).toBe(openers.length);
    expect(units(mapped) + units(unmapped)).toBe(units(openers));
    // 🛑 SATURATION IS NOT VACUITY, AND THIS IS THE LINE THAT SAYS SO. With `unmapped`
    // empty, a `deriveAttackRequirement` that returned a constant would pass the two
    // rungs above; it does not, because it still refuses everything OUTSIDE the
    // opener population.
    expect(deriveAttackRequirement("Discard your hand and draw 6 cards.")).toBeNull();
    expect(corpus().filter(([, s]) => deriveAttackRequirement(s) !== null)).toHaveLength(9);
  });

  it("🛑 THE CEILING IS PRICED AND LEFT — no remaining hand-SIZE read is a BoardCondition", () => {
    // The handoff's rule: do not let the ceiling eat the floor. Every legal sentence
    // that still reads a hand's size is refused, and none of them wants this member —
    // one is a per-card damage scaler over the FAR hand, one an op plus a did-it
    // clause, one a draw whose count is the far hand.
    for (const sentence of SIZE_CEILING) {
      const rows = corpus().filter(([, s]) => s === sentence);
      expect(rows, sentence).toHaveLength(1);
      expect(readByAny(sentence), sentence).toBe(false);
    }
    // 🛑 🆕🆕 **D385 — THE THIRD ENTRY IS GONE FROM THE LIST AND ITS DEPARTURE IS
    // ASSERTED**, which is the only way this file can go red if it is ever "un-built".
    // ⚠️ AND THE TWO ORACLES ARE READ SIDE BY SIDE ON PURPOSE: this file's NINE-reader
    // instrument still refuses the sentence (it cannot see the tenth reader), and the
    // TENTH reader resolves it. **THAT GAP IS WHAT MADE THE OLD RUNG GREEN AND FALSE**,
    // and stating it here is what stops the next slice drawing a refusal from a census.
    //
    // 🛑🛑 🆕🆕 **D418 — THE PARAGRAPH ABOVE IS THE MISTAKE, NOT THE FIX, AND THE RUNG
    // IT DEFENDS IS REVERSED HERE.** It read `expect(readByAny(CEILING_TAKEN_AT_D385))
    // .toBe(false)` and called the GAP between two oracles a thing to STATE. ⚠️ **A GAP
    // BETWEEN TWO ORACLES IS NOT A FACT ABOUT THE ENGINE — IT IS A FACT ABOUT ONE
    // INSTRUMENT BEING BROKEN**, and asserting it made the breakage load-bearing: the
    // rung would have gone RED if anyone had fixed the array, which is a test that
    // punishes the repair. D418 fixed the array (see its doc block), so the assertion
    // is now `true` and the sentence is simply RESOLVED, like every other departed
    // ceiling entry in this file. The `deriveAttackOptionalCostBoost` line below is
    // KEPT, because naming WHICH reader took it is the part that was worth having.
    expect(corpus().filter(([, s]) => s === CEILING_TAKEN_AT_D385)).toHaveLength(1);
    expect(readByAny(CEILING_TAKEN_AT_D385)).toBe(true);
    // 🆕🆕 D445 — the SECOND departure, asserted the same way, and its owner NAMED. A bare
    // `readByAny(...) === true` would be satisfied by any of the thirteen widening onto it
    // (D438: a positive replacement for a negated disjunction is a claim about none of the
    // disjuncts), so the owner is pinned and the neighbour that must still refuse is pinned
    // beside it.
    expect(corpus().filter(([, s]) => s === CEILING_TAKEN_AT_D445)).toHaveLength(1);
    expect(readByAny(CEILING_TAKEN_AT_D445)).toBe(true);
    expect(deriveAttackDamageMultiplier(CEILING_TAKEN_AT_D445)).toEqual({
      per: 30,
      count: { kind: "cardsInOpponentHand", filter: { kind: "anyCard" } },
    });
    expect(deriveAttackDamageBonus(CEILING_TAKEN_AT_D445)).toBeNull();
    // 🛑 AND THE CEILING'S OWN CLAIM IS UNCHANGED: this sentence still wants NO
    // `BoardCondition`, which is the thing the block was priced on. The `exactly N cards in
    // your hand` member reads a SIZE against a printed number; this reads a COUNT as a
    // multiplicand. Two different questions, and the survivor above is the proof the list
    // still discriminates rather than having been emptied.
    expect(SIZE_CEILING).toHaveLength(1);
    expect(deriveAttackOptionalCostBoost(CEILING_TAKEN_AT_D385)).not.toBeNull();
    // 🛑 …and the SPECIFICITY is kept too, so "resolved" cannot come to mean "some
    // reader somewhere": the other two readers D418 added to this array refuse it, so
    // the claim above is still about D385's reader and not about the widening.
    expect(deriveAttackCancelRequirement(CEILING_TAKEN_AT_D385)).toBeNull();
    expect(deriveAttackDiscardScaledBoost(CEILING_TAKEN_AT_D385)).toBeNull();
    // 🛑 🆕🆕 **D404 TOOK THE HAND-ZONE SENTENCE, AND THE RUNG IS RE-POINTED RATHER
    // THAN DELETED.** It sat here as *"the biggest unbuilt thing in this corner is a
    // hand-ZONE op rather than a hand-SIZE read, which is why it is a different slice:
    // SEVEN printings"*, asserted `false` through `resolvedByAnyReader`. D404 built it
    // as a `deriveAttackEffect` arm — which **this file's NINE-reader array DOES
    // contain** — so unlike D385's departure one paragraph up, this one reddened the
    // rung by itself rather than going quiet. ⚠️ **THE DISTINCTION IS THE WHOLE POINT
    // OF KEEPING BOTH HERE**: a refusal claim is only as loud as the instrument that
    // states it, and D385's went silent for exactly the reason this one did not.
    //
    // The printing count is KEPT and still measured — the sentence and its 7 units are
    // this file's evidence that the ceiling it priced was real, and D404 moved the
    // VERDICT without moving the population.
    const discardHand = corpus().filter(([, s]) => s === "Discard your hand and draw 6 cards.");
    expect(discardHand).toHaveLength(1);
    expect(units(discardHand)).toBe(7);
    expect(readByAny("Discard your hand and draw 6 cards.")).toBe(true);
    // …and it is a hand-ZONE op and NOT a hand-SIZE read, which is the claim that made
    // it a different slice in the first place: no `BoardCondition` was bought for it.
    expect(deriveAttackEffect("Discard your hand and draw 6 cards.")).toEqual([
      { op: "discardHand" },
      { op: "drawCards", count: 6 },
    ]);
  });
});

describe("§2 — the key, the printed BYTES, and the tables that must not meet", () => {
  it("maps the printed NEGATION onto the POSITIVE member at the printed count", () => {
    // `ATTACK_REQUIREMENT_CLAUSES`' polarity rule: the row hands back the POSITIVE
    // fact and `attack.ts` cancels when it does NOT hold. So the printed "don't"
    // costs no `{ kind: "not" }` and no second member.
    expect(deriveAttackRequirement(TRIO_CHEEHOO)).toEqual({ kind: "yourHandExactly", count: 3 });
  });

  it("🛑 the KEY is the printed bytes, pinned by CODE-POINT COUNT", () => {
    // D183's defect is an arm authored from a PARAPHRASE, and the count is what
    // catches a transcription that reads right and is not the printed sentence.
    expect(TRIO_CHEEHOO).toHaveLength(73);
    expect(EXACT_CLAUSE).toHaveLength(43);
    expect(NOTHING.exec(TRIO_CHEEHOO)?.[1]).toBe(EXACT_CLAUSE);
    // ⚠️ THE KEY CARRIES ONE APOSTROPHE, in "don't", so D137's U+2019 fold is LIVE on
    // it — asserted by folding the printing the fold exists for.
    expect(EXACT_CLAUSE).toContain("'");
    expect(deriveAttackRequirement(TRIO_CHEEHOO.replace("don't", "don’t"))).toEqual(EXACTLY_3);
    // …and NO é, which is the ordinary case for a clause that never says "Pokémon".
    expect(EXACT_CLAUSE).not.toContain("é");
    // The printed noun is plural at 3 and the digit is a DIGIT, not a word — both are
    // transcription traps this table has paid for elsewhere.
    expect(EXACT_CLAUSE).toContain("exactly 3 cards");
    expect(EXACT_CLAUSE).not.toContain("three");
  });

  it("🛑 the two TABLES cannot reach each other — D125's disjointness, both directions", () => {
    // A clause meaning "the attack does N more damage if X" must never be reachable
    // from a sentence meaning "the attack does nothing if X", and vice versa. This
    // member sits in ONE table, so the crossing is asserted from both ends.
    expect(deriveAttackDamageBonus(`If ${EXACT_CLAUSE}, this attack does 120 more damage.`)).toBe(
      null,
    );
    expect(
      deriveAttackDamageBonus("If you have exactly 3 cards in your hand, this attack does 120 more damage."),
    ).toBeNull();
    expect(deriveAttackRequirement(TRIO_CHEEHOO)).not.toBeNull();
  });

  it("🛑 refuses six constructed rewrites the catalog does not print", () => {
    // Every one of these reads like the printed sentence and is not it. A substring,
    // a fuzzy lookup or a `\d+` pattern would take at least three — and the FIRST is
    // the one `fix-sawk`'s rider drives on a real board in §6.
    for (const clause of [
      "you don't have exactly 4 cards in your hand",
      "you don't have exactly 3 cards in hand",
      "you don't have exactly 3 Pokémon in your hand",
      "you have exactly 3 cards in your hand",
      "your opponent doesn't have exactly 3 cards in their hand",
      "you don't have 3 or fewer cards in your hand",
    ]) {
      expect(deriveAttackRequirement(`If ${clause}, this attack does nothing.`), clause).toBeNull();
    }
  });

  it("the reject fragment is the POSITIVE reading, which the catalog never prints", () => {
    // `conditionNote` is player-facing on both paths (the engine's reject pill and the
    // greyed HUD row's tooltip), and it CANNOT round-trip here: the printed sentence
    // is the negative, because the skeleton owns the negation, while a pill has to say
    // what the board must look like. Two audiences, two strings — stated so a
    // successor does not "fix" one into the other.
    expect(conditionNote(EXACTLY_3)).toBe("you have exactly 3 cards in your hand");
    expect(conditionNote(EXACTLY_3)).not.toBe(EXACT_CLAUSE);
    // …and it is built from the PARAMETER, so a member buried in the name would fail
    // here. This is the only place the un-printed counts are exercised at all.
    expect(conditionNote({ kind: "yourHandExactly", count: 5 })).toBe(
      "you have exactly 5 cards in your hand",
    );
    // ⚠️ THE PLURAL IS UNCONDITIONAL AND THAT IS DELIBERATE (D205): the pool prints
    // this clause at ONE value, 3, so a singular branch would be a shape no printing
    // can reach — an unreachable arm is removed, not tested around.
    expect(conditionNote({ kind: "yourHandExactly", count: 1 })).toBe(
      "you have exactly 1 cards in your hand",
    );
    // The three hand members answer differently, which is the whole point of there
    // being three.
    expect(conditionNote(EXACTLY_3)).not.toBe(conditionNote(THEIRS_AT_MOST_3));
    expect(conditionNote(EXACTLY_3)).not.toBe(conditionNote(HANDS_LEVEL));
  });
});

describe("§3 — the predicate: STRICT equality on the ATTACKER's own hand", () => {
  it("🛑 the boundary swept 0…8 — TRUE at exactly one size, and never at 2 or 4", () => {
    // The rung the comparator lives or dies on. `>=` is green at 3 and wrong at 4…8;
    // `<=` is green at 3 and wrong at 0…2. Both are one board away from correct, so
    // the sweep asserts the WHOLE curve rather than the true point.
    const base = board(90);
    const trueSizes: number[] = [];
    for (let size = 0; size <= 7; size += 1) {
      const state = setHandSize(base, "p1", size);
      expect(state.players.p1.hand).toHaveLength(size);
      if (conditionHolds(state, "p1", EXACTLY_3)) trueSizes.push(size);
    }
    expect(trueSizes).toEqual([3]);
  });

  it("🛑 reads the ATTACKER's hand and not the far one — the seat half of the near miss", () => {
    // D365's measurement, driven: `opponentHandAtMost` is the wrong SEAT as well as
    // the wrong comparator. On a board where P1 holds 4 and P2 holds 3 the two members
    // give OPPOSITE answers from p1's seat, one `toBe` apart.
    let state = setHandSize(board(91), "p1", 4);
    state = setHandSize(state, "p2", 3);
    expect([state.players.p1.hand.length, state.players.p2.hand.length]).toEqual([4, 3]);
    expect(conditionHolds(state, "p1", EXACTLY_3)).toBe(false);
    expect(conditionHolds(state, "p1", THEIRS_AT_MOST_3)).toBe(true);
    // …and the mirror: P1 at 3, P2 at 7. An arm reading the far hand answers false on
    // the line the printed card resolves.
    let mirror = setHandSize(board(92), "p1", 3);
    expect(mirror.players.p2.hand.length).toBe(7);
    expect(conditionHolds(mirror, "p1", EXACTLY_3)).toBe(true);
    expect(conditionHolds(mirror, "p1", THEIRS_AT_MOST_3)).toBe(false);
    // The member is SEAT-RELATIVE, unlike D378's: swapping the seat swaps the answer
    // on the very same state. That is what stops "reads a hand" being "reads p1's".
    mirror = setHandSize(mirror, "p2", 5);
    expect(conditionHolds(mirror, "p1", EXACTLY_3)).toBe(true);
    expect(conditionHolds(mirror, "p2", EXACTLY_3)).toBe(false);
  });

  it("🛑 it is not `handSizesEqual` in disguise — the level board is the discriminator", () => {
    // The third hand member (D119) is TRUE whenever the two hands match, at any size.
    // A `yourHandExactly` folded into it would be green on a 5-and-5 board, which is
    // exactly where the printed card does nothing.
    let level = setHandSize(board(93), "p1", 5);
    level = setHandSize(level, "p2", 5);
    expect(conditionHolds(level, "p1", HANDS_LEVEL)).toBe(true);
    expect(conditionHolds(level, "p1", EXACTLY_3)).toBe(false);
    // …and both true at once only when the shared size IS 3, which the sweep pins so
    // "they agree here" is a fact about the board and not about the members.
    let three = setHandSize(board(94), "p1", 3);
    three = setHandSize(three, "p2", 3);
    expect(conditionHolds(three, "p1", HANDS_LEVEL)).toBe(true);
    expect(conditionHolds(three, "p1", EXACTLY_3)).toBe(true);
  });

  it("the parameter is honoured — the same board, three different counts", () => {
    // `count` is a parameter and not a constant folded into the arm. Only the printed
    // 3 has a row behind it, so this is the one place the others are reachable at all.
    const state = setHandSize(board(95), "p1", 4);
    expect(conditionHolds(state, "p1", { kind: "yourHandExactly", count: 3 })).toBe(false);
    expect(conditionHolds(state, "p1", { kind: "yourHandExactly", count: 4 })).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "yourHandExactly", count: 5 })).toBe(false);
  });
});

describe("§4 — on a board: 2 / 3 / 4 cards in hand, and 120 lands on exactly one", () => {
  it("🛑 CANCELS with TWO cards in hand — the `<=` reading's board", () => {
    const state = setHandSize(trioCheehoo(board(96)), "p1", 2);
    expect(state.players.p1.hand).toHaveLength(2);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "ATTACK_FAILED")).toMatchObject({ reason: "requirement" });
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    // 🛑 AND NOTHING IS FLAGGED: the printed sentence is accounted for, so the cancel
    // is a SIMULATED outcome and not an unread one.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 RESOLVES with THREE — the whole printed 120, off a body that paid NO Energy", () => {
    const state = setHandSize(trioCheehoo(board(97)), "p1", 3);
    expect(state.players.p1.hand).toHaveLength(3);
    // The attacker carries no Energy at all, because the card prints no cost. Nothing
    // else on this board could explain the 120.
    expect(state.players.p1.active?.energy).toEqual([]);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_FAILED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 120, dealt: 120 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 CANCELS with FOUR — the `>=` reading's board, one card the other way", () => {
    const state = setHandSize(trioCheehoo(board(98)), "p1", 4);
    expect(state.players.p1.hand).toHaveLength(4);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "ATTACK_FAILED")).toMatchObject({ reason: "requirement" });
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 P1 at FOUR and P2 at THREE: Trio-Cheehoo CANCELS while Cursed Slug FIRES", () => {
    // THE CASE THE WHOLE SLICE IS ABOUT. One state, two printed sentences about a
    // hand, two seats, two different answers. An arm reading the far hand scores 120
    // on the first line; a Cursed Slug re-pointed at the near hand scores 100 on the
    // second.
    let base = setHandSize(board(99), "p1", 4);
    base = setHandSize(base, "p2", 3);
    const cancelled = mustApply(trioCheehoo(base), { type: "attack", seat: "p1", index: 0 });
    expect(find(cancelled.events, "ATTACK_FAILED")).toMatchObject({ reason: "requirement" });
    expect(types(cancelled.events)).not.toContain("DAMAGE_DEALT");
    const control = mustApply(cursedSlug(base), { type: "attack", seat: "p1", index: 1 });
    expect(find(control.events, "DAMAGE_DEALT")).toMatchObject({
      base: 100,
      scaled: 120,
      dealt: 220,
    });
    // Neither is flagged: both sentences are read, they just answer differently.
    expect(types(cancelled.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(control.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("cancels and resolves identically from the FAR SEAT", () => {
    const short = setHandSize(trioCheehoo(boardP2(100), "p2"), "p2", 2);
    const cancelled = mustApply(short, { type: "attack", seat: "p2", index: 0 });
    expect(find(cancelled.events, "ATTACK_FAILED")).toMatchObject({ reason: "requirement" });
    const exact = setHandSize(trioCheehoo(boardP2(101), "p2"), "p2", 3);
    // ⚠️ P1's hand is left at whatever the deal gave and is NOT 3 — so a far-hand arm
    // cannot be green here by coincidence.
    expect(exact.players.p1.hand.length).not.toBe(3);
    const { events } = mustApply(exact, { type: "attack", seat: "p2", index: 0 });
    expect(types(events)).not.toContain("ATTACK_FAILED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 120, dealt: 120 });
  });
});

describe("§5 — ARMED BY THE GAME: the hand played down to three, with no surgery", () => {
  it("🛑 P1 benches Basics and attaches an Energy — and the count the clause reads is the game's", () => {
    // Every case above SETS the hand; this one lets the game leave one behind. Benching
    // a Basic and attaching an Energy are the ordinary ways a hand empties, and the
    // number Trio-Cheehoo reads afterwards is the one those plays produced.
    //
    // A NAMED seed, because this case needs the deal itself to cooperate: P1's hand has
    // to hold enough spare Basics and an Energy for the shed to be playable at all.
    // Every other case in this suite is seed-independent by pinning; this one is the
    // exception and says so.
    let state = board(3);
    // Field the attacker FIRST: `setActiveFromDeck` displaces the current Active onto
    // the Bench, and the shed below fills that Bench.
    state = trioCheehoo(state);
    expect(state.players.p1.hand.length).toBe(7);
    while (state.players.p1.hand.length > 4 && state.players.p1.bench.length < 5) {
      const uid = state.players.p1.hand.find(
        (u) => FIXTURE_POOL[state.cardIdByUid[u] ?? ""]?.stage === "Basic",
      );
      if (uid === undefined) break;
      state = mustApply(state, { type: "playBasicToBench", seat: "p1", uid }).state;
    }
    expect(state.players.p1.hand.length).toBe(4);
    // …and the last card goes as the turn's one Energy attachment. It pays nothing —
    // Trio-Cheehoo has no cost — so its only effect on the outcome is the card it
    // removes from the hand, which is exactly the quantity under test.
    const energyUid = state.players.p1.hand.find(
      (u) => FIXTURE_POOL[state.cardIdByUid[u] ?? ""]?.category === "Energy",
    );
    expect(energyUid).toBeDefined();
    state = mustApply(state, {
      type: "attachEnergy",
      seat: "p1",
      uid: energyUid ?? "",
      target: { spot: "active" },
    }).state;
    expect(state.players.p1.hand.length).toBe(3);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_FAILED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 120, dealt: 120 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 one bench play SHORT of three and the same board cancels — the shed is what armed it", () => {
    // The control that stops the case above being "an attack that always resolves":
    // the identical script, stopped one play earlier, leaves FOUR in hand and the
    // attack is refused for the printed reason.
    let state = trioCheehoo(board(3));
    while (state.players.p1.hand.length > 4 && state.players.p1.bench.length < 5) {
      const uid = state.players.p1.hand.find(
        (u) => FIXTURE_POOL[state.cardIdByUid[u] ?? ""]?.stage === "Basic",
      );
      if (uid === undefined) break;
      state = mustApply(state, { type: "playBasicToBench", seat: "p1", uid }).state;
    }
    expect(state.players.p1.hand.length).toBe(4);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "ATTACK_FAILED")).toMatchObject({ reason: "requirement" });
    expect(types(events)).not.toContain("DAMAGE_DEALT");
  });
});

describe("§6 — the guard this slice EXPIRED, and what it did NOT buy", () => {
  it("🛑 the accounting guard's subject is now CONSTRUCTED — and the construction still works", () => {
    // `fix-sawk`'s index-2 rider printed a REAL unmapped corpus sentence from D363
    // until this slice; there is no printed does-nothing opener left to point it at,
    // so it now carries "exactly 4", one parameter value off the row that shipped.
    // The guard's property is unchanged: an unmapped leading clause may not be
    // stripped, so the WHOLE string stays loud.
    const rider = FIXTURE_POOL["fix-sawk"]?.attacks?.[2]?.effect ?? "";
    expect(rider).toContain("exactly 4 cards in your hand");
    expect(deriveAttackRequirement(rider)).toBeNull();
    // 🛑 AND THE CONSTRUCTION BUYS A DEFECT NO REAL SENTENCE COULD EXPRESS: a table
    // "simplified" from a literal row into a `\d+` pattern would MAP this and strip
    // the companion. The printed 3 resolves; the constructed 4 does not.
    expect(deriveAttackRequirement(TRIO_CHEEHOO)).not.toBeNull();
    expect(
      deriveAttackRequirement("If you don't have exactly 4 cards in your hand, this attack does nothing."),
    ).toBeNull();
    // …and no sentence in the legal attack column carries the constructed clause, so
    // the rider is not quietly asserting on a printing.
    expect(corpus().filter(([, s]) => s.includes("exactly 4 cards in your hand"))).toEqual([]);
  });

  it("bought no bonus row, no second hand member, and no hand-CONTENTS read", () => {
    // A slice that "completed" the family by adding a bonus twin would pass every rung
    // above. The catalog prints no such clause, so it would be a row with zero
    // printings behind it.
    expect(deriveAttackDamageBonus(TRIO_CHEEHOO)).toBeNull();
    // …and the union's public-state invariant is intact: this member reads a LENGTH.
    // Sizes are public (both players watched every draw and play that set them),
    // contents are not — which is why the whole family survives P4 redaction.
    const state = setHandSize(board(102), "p1", 3);
    expect(conditionHolds(state, "p1", EXACTLY_3)).toBe(true);
    // The same board with the same COUNT but entirely different cards answers the
    // same, which is the invariant driven rather than restated.
    const reordered: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, hand: [...state.players.p1.hand].reverse() },
      },
    };
    expect(conditionHolds(reordered, "p1", EXACTLY_3)).toBe(true);
  });

  it("bought no play GATE — this member reaches the board through printed ATTACK text only", () => {
    // `conditionNote` is the reject fragment for a play gate, and no card carries this
    // one as one today. Pinned directly (as `boardCondition.test.ts` pins the other
    // unreachable arms) so a typo in player-facing copy cannot ship unseen.
    expect(conditionNote(EXACTLY_3)).toBe("you have exactly 3 cards in your hand");
  });
});
