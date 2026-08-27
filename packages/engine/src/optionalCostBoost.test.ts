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
import type { EffectOp, GameEvent, GameState, Seat } from "./index";
import {
  OPTIONAL_COST_BOOST_DECK,
  attachFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 🆕🆕 D381 — THE REVERSED OPTIONAL BOOST: D316's SENTENCE WITH ITS TWO HALVES
// SWAPPED, ON ZERO NEW OPS.
//
// D316 read *"You may do {N} more damage. If you do, {drawback}"* — the antecedent
// is the PAYOFF and the consequent is the cost. This slice reads the same sentence
// the other way round: the antecedent is the COST and the consequent is the extra
// damage it buys.
//
//   Cetitan ex `sv10-065` / `sv10-210` "Crushing Press" ({W}{W}{W}{C}, `140+`)
//     "You may discard a Stadium in play. If you do, this attack does 140 more damage."
//
// **TWO legal printings, and every mechanism they need already shipped**:
// `discardStadium` and `stadiumInPlay` are D380's and D378's, `optional` is D186's,
// `conditionGate` is older than all three. What this slice buys is a READING — which
// is exactly why the number that prices it is HOW MANY REFUSED SENTENCES IT CLAIMS,
// measured before and after: the family is **7 sentences / 14 printings** and **3
// sentences / 9 printings were refused at D380's head**; this reader claims **1 / 2**
// and leaves **2 / 7** refused. §1 asserts both columns of all three figures.
//
// ### THE FOUR SHAPE QUESTIONS, ANSWERED FROM THE CATALOG BEFORE ANYTHING WAS SPELLED
//
// 1. **A SEPARATE READER, NOT A SECOND ANCHOR ON `deriveAttackOptionalBoost`, AND THE
//    CATALOG DECIDED IT.** The family partitions by which half is the cost, and the
//    partition is total: all FOUR forward sentences buy their bonus with a consequent
//    that can ALWAYS be paid (shuffle yourself away, hurt yourself, forgo next turn's
//    attack), so their reading needs no precondition; all THREE reversed ones lead
//    with a cost that can be UNPAYABLE (a Stadium to discard, three Energy to shuffle
//    away, a face-down Prize to turn up). **THE PRECONDITION IS WHAT THE SWAP MEANS**,
//    so `AttackOptionalCostBoost` carries a `cond` the forward reading would never
//    populate — and the two arms come out in the opposite order (question 4).
//    §2 drives the partition rather than asserting it from this comment.
// 2. **THE COST-SIDE TABLE IS A TABLE FROM ITS FIRST ROW** (`retrieveNoun`'s rule):
//    `optionalCostOps` dispatches over closed `^…$` anchors and returns BOTH the ops
//    and the board fact that makes them payable, so the next printed cost is a row.
// 3. 🛑 **THE EMPTY ZONE, AND HERE IT IS NOT COSMETIC.** With no Stadium in play a
//    confirm assembled without the gate would offer a "yes" that discards NOTHING and
//    still pays the printed **+140** — a free 140, which is D380's stakeless dialog
//    with damage at stake. §5 drives an empty zone and requires **140, not 280**.
// 4. 🛑 **THE COST GOES IN FRONT OF THE HIT, AND THE ORDER IS OBSERVABLE ON A BOARD
//    THIS POOL CAN BUILD.** `boostedArms` emits `[damageDefender(base + bonus),
//    ...ops]` because the FORWARD sentence prints payoff-then-drawback; this one
//    prints discard-then-damage. Neutralization Zone `sv06.5-060` prevents damage to
//    a no-Rule-Box Pokémon **from an attacking Pokémon ex** — and Cetitan ex is one —
//    so on that board the printed order deals **280** and the swapped order deals
//    **0** and then discards the Stadium that stopped it. §4 drives both ends.
//    ⚠️ A vacated `hpDelta` Stadium moves a MAXIMUM between the two hits as well, but
//    all three of those printings are `sv08`/`sv10` and outside the six sets
//    `CATALOG_MANIFEST` covers, so that half is NAMED rather than driven (D205).
//
// ⚠️ **THE VACUITY MODES, NAMED BEFORE THE BUILD AND EACH DRIVEN ON A BOARD:**
//   • the reader could claim everything — **the saturation trap** (D379). §2 re-pairs
//     each refused half with a half this reader DOES read, so each refusal is driven
//     from OUTSIDE the population and is attributable to ONE half;
//   • either gate could lose its `otherwise` and every board with a Stadium on it
//     would still pass — §4 and §5 assert the printed **140** on a declined confirm
//     AND on an empty zone;
//   • the arms could be built in `boostedArms`' order and every board WITHOUT
//     Neutralization Zone would still pass — §4's Zone board is the only rung that
//     separates them, which is why the fixture is named `Fixceti ex`;
//   • the whole reading could be dropped and the sentence would go back to the
//     skipped-effect path — §3 pins the program byte-for-byte and §4 asserts the
//     attack does NOT emit `ATTACK_EFFECT_SKIPPED`.
//
// WHAT SHIPS: **1 new reader**, **1 new exported assembler**, **1 cost-table row**,
// **1 fixture**, **1 deck**. ZERO new `EffectOp` members, ops, events, prompts,
// choice kinds, `BoardCondition` members, error codes or `packages/schema` bytes —
// so `MATCH_RECORD_VERSION` stays **22**: every op this program contains could
// already appear in a v22 record, so no v22 byte string means anything different
// under this engine.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The TEN live readers, run as one. `censusAtHead.test.ts`'s nine plus this slice's. */
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
const CETITAN = "You may discard a Stadium in play. If you do, this attack does 140 more damage.";

/** …and the ONE it leaves, with the mechanism it is waiting on. Kept as data because
    §6 drives it: a successor who widens either anchor to swallow it reddens here by
    name.

    🆕🆕 **D383 EMPTIED HALF OF THIS AND THE ENTRY MOVED TO `TAKEN_SINCE` RATHER THAN
    BEING DELETED** (D178: provenance is annotated, never overwritten). It read *"an
    Energy→OWN-DECK op AND a Bench-snipe consequent"* — and BOTH halves of that price
    were the wrong size. See `TAKEN_SINCE`. */
const STILL_OWED = {
  /** A FACE-UP PRIZE on `PlayerState` — a persisted-shape change, so
      `MATCH_RECORD_VERSION` on top of the engine bump. */
  prize:
    "You may turn 1 of your face-down Prize cards face up. If you do, this attack does 80 more damage. (That Prize card remains face up for the rest of the game.)",
} as const;

/** 🆕🆕 D383 — THE ROW THAT LEFT `STILL_OWED`, ASSERTED RESOLVED rather than merely
    removed. `stadiumPresence.test.ts` grew the same list at D382 for the same reason:
    a refusal list can be made green by SHORTENING it, so every departed row owes a
    positive claim in its place.

    Wellspring Mask Ogerpon ex `sv06-064`/`-194`/`-213`/`sv08.5-027`/`-152`
    "Torrential Pump" ({W}{C}{C}, flat **100**), **5 legal printings** — D381's own
    reading widened at its CONSEQUENT, on ZERO new readers. **THE PRICE D381 WROTE
    DOWN WAS WRONG IN BOTH DIRECTIONS**: the "Energy→own-deck op" is one optional
    VALUE on `discardEnergy.to`, the "Bench-snipe consequent" was already built (the
    payoff anchor shares its regex BODY with `deriveAttackEffect`'s `ALSO_BENCHED_SNIPE`
    and differs only in the case of the leading word), and what it actually cost is a
    `BoardCondition` member D381 never named. */
const TAKEN_SINCE = {
  energy:
    "You may shuffle 3 Energy attached to this Pokémon into your deck. If you do, this attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
} as const;

const FAMILY = /^You may .*If you do,/;

/** The EIGHTH member of the widened family, and the one the handoff's `/If you do,/`
    census could not see: the connective is a condition on the COST's own effect
    rather than a bare *"if you do"*. Refused, and named so §1 can drive it.
    ✅ 🆕🆕 **D385 BUILT IT** — the sentence above is kept as written (D178) because the
    census claim it makes is still true; what changed is that §1's two REFUSAL rungs
    are now claims about the reading. */
const HAND_DISCARD =
  "You may discard your hand. If you discarded any cards in this way, this attack does 120 more damage.";
const BEACH_COURT = "sv01-167";
const NEUTRALIZATION_ZONE = "sv06.5-060";

// ── boards ─────────────────────────────────────────────────────────────────────

/** Put `stadiumId` into `seat`'s hand and play it — the shared §7.3 zone then carries
    `owner: seat`. ⚠️ **A CONSTRUCTED `state.stadium` WOULD HAVE BEEN GREEN AND DEAD**
    (D310/D314/D318, and D380 at this exact seam): what is under test is that the
    Stadium the RULES put in the zone is the one the confirm takes out of it. */
function playStadium(state: GameState, seat: Seat, stadiumId: string): GameState {
  const withCard = handFromDeck(state, seat, stadiumId, 1);
  const uid = handUid(withCard, seat, stadiumId);
  return mustApply(withCard, { type: "playTrainer", seat, uid }).state;
}

/** Setup, then P1's turn 2 (P2 went first and passed) — P1's first unrestricted turn,
    so the attack step is legal (§4). **P2 IS ALWAYS THE STADIUM'S OWNER** and P1
    always the attacker, so the two seats differ in the fixture before any assertion
    is made about either (D380's finding: a seat defect hides inside a symmetric
    board). P1's Active is Cetitan ex, paid {W}{W}{W}{C}; P2's is `fix-titan`, whose
    340 HP survives the boosted 280 and whose name carries NO Rule Box. */
function board(seed: number, stadiumId: string | null = null): GameState {
  let state = driveSetup(
    seed,
    { p1: OPTIONAL_COST_BOOST_DECK, p2: OPTIONAL_COST_BOOST_DECK },
    { first: "p2" },
  );
  if (stadiumId !== null) state = playStadium(state, "p2", stadiumId);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = setActiveFromDeck(state, "p1", "fix-crushpress");
  state = attachFromDeck(state, "p1", "fix-water-energy", 3);
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  return state;
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

/** THREE SEEDS (D270's rule). Nothing on this seam flips a coin. */
const SEEDS = [7001, 7013, 7027] as const;

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

  it("🛑 the family is 7 sentences / 14 printings, and it partitions 5 forward / 2 reversed… ", () => {
    const family = corpus().filter(([, s]) => FAMILY.test(s));
    expect([family.length, units(family)]).toEqual([7, 14]);
    // D316's four, which were already resolving at D380's head.
    const forward = family.filter(([, s]) => deriveAttackOptionalBoost(s) !== null);
    expect([forward.length, units(forward)]).toEqual([4, 5]);
    // …and the reversed half. 🆕🆕 D383 — **1 / 2 -> 2 / 7**, because the PAYOFF half
    // became a table. The reader is unchanged and so is its anchor: what moved is that
    // `optionalCostPayoff` now has a second row.
    const reversed = family.filter(([, s]) => deriveAttackOptionalCostBoost(s) !== null);
    expect([reversed.length, units(reversed)]).toEqual([2, 7]);
    // 🛑 THE TWO READERS ARE MUTUALLY EXCLUSIVE ON EVERY PRINTED MEMBER, which is the
    // property that lets attack.ts SUM its terms instead of choosing between them.
    for (const [, s] of family) {
      expect(
        [deriveAttackOptionalBoost(s), deriveAttackOptionalCostBoost(s)].filter(
          (r) => r !== null,
        ).length,
        s,
      ).toBeLessThan(2);
    }
  });

  it("🛑 …the refused half went 3 sentences / 9 printings → 1 / 2, in TWO slices", () => {
    const family = corpus().filter(([, s]) => FAMILY.test(s));
    const refused = family.filter(([, s]) => !resolvedByAnyReader(s));
    // AFTER. 🆕🆕 D383 — the sole survivor is the one `STILL_OWED` row and nothing else.
    expect([refused.length, units(refused)]).toEqual([1, 2]);
    expect(refused.map(([, s]) => s)).toEqual([STILL_OWED.prize]);
    // BEFORE, re-derived rather than quoted: drop this reader from the set and the
    // refused half is the head D380 handed over — 3 sentences / 9 printings.
    const withoutThisReader = (text: string): boolean =>
      READERS.filter((read) => read !== deriveAttackOptionalCostBoost).some(
        (read) => read(text) !== null,
      );
    const before = family.filter(([, s]) => !withoutThisReader(s));
    expect([before.length, units(before)]).toEqual([3, 9]);
    // …and the delta is exactly the TWO sentences this reader claims — D381's, and
    // 🆕🆕 D383's, which is the second row of the payoff table rather than a second
    // reader. **THE READER IS THE UNIT OF THIS SUBTRACTION, NOT THE SLICE**, which is
    // why the arithmetic here is 3 -> 1 across two commits and not 3 -> 2 -> 1.
    expect(
      before
        .filter(([, s]) => !refused.some(([, r]) => r === s))
        .map(([, s]) => s)
        .sort(),
    ).toEqual([CETITAN, TAKEN_SINCE.energy].sort());
  });

  it("the sentence carries TWO printings, and no near spelling hides behind it", () => {
    const rows = corpus().filter(([, s]) => s === CETITAN);
    expect([rows.length, units(rows)]).toEqual([1, 2]);
    // The census asked for the WORD rather than the phrase (D310/D311): every legal
    // attack sentence that carries "If you do," AND "Stadium" at all is this one.
    const both = corpus().filter(([, s]) => s.includes("If you do,") && s.includes("Stadium"));
    expect(both.map(([, s]) => s)).toEqual([CETITAN]);
    // …and the offer is spelled ONE way. Two records carry a leading "You may discard"
    // over a Stadium — D380's bare imperative and this compound — for FOUR printings
    // between them, and neither spells the noun lower-case or possessive.
    const offered = corpus().filter(([, s]) => /^You may discard .{0,20}stadium/i.test(s));
    expect([offered.length, units(offered)]).toEqual([2, 4]);
    expect(offered.map(([, s]) => s).sort()).toEqual(
      ["You may discard a Stadium in play.", CETITAN].sort(),
    );
  });

  it("🛑 …and the FAMILY IS EIGHT WHEN THE CONNECTIVE IS SHORTENED, not seven", () => {
    // 🛑 **ASK THE CENSUS TWICE — ONCE WITH THE LITERAL SHORTENED TO THE PART A
    // SPELLING CANNOT CHANGE** (D310/D311's rule, and the resume point's census was a
    // FLOOR on this family for exactly the reason that rule names). `/If you do,/` is
    // the connective FOUR of the five reversed printings happen to print; relaxing it
    // to a bare sentence break finds an EIGHTH record the handoff's figure could not
    // see.
    const strict = corpus().filter(([, s]) => FAMILY.test(s));
    const wide = corpus().filter(([, s]) => /^You may .*\. If /.test(s));
    expect([strict.length, units(strict)]).toEqual([7, 14]);
    expect([wide.length, units(wide)]).toEqual([8, 15]);
    // …and the difference is ONE record, named, refused, and refused for a mechanism
    // rather than for its connective: the cost is a HAND discard this engine cannot
    // spell as an attack step, and the consequent is conditional on HOW MANY cards it
    // moved — a record of the cost's own effect, not a board fact read before it.
    const extra = wide.filter(([, s]) => !strict.some(([, t]) => t === s));
    expect(extra.map(([n, s]) => [n, s])).toEqual([[1, HAND_DISCARD]]);
    // ✅ 🆕🆕 **D385 TOOK IT, AND THE TWO REFUSAL RUNGS THAT STOOD HERE ARE RE-AIMED
    // RATHER THAN DELETED.** This rung used to assert `resolvedByAnyReader(HAND_DISCARD)`
    // was FALSE and that re-pairing the hand cost with `If you do,` was refused BY THE
    // COST HALF. D385 widened the connective to a closed alternation of two and added
    // the cost row, so BOTH claims are now false — and neither `find` moved a character,
    // which is D384's premise-rot in the TEST file set. What the rung is ABOUT survives
    // untouched: the census question (*"ask it once with the connective shortened"*)
    // found a record the family regex could not see, and that is still exactly what the
    // three lines above measure.
    expect(resolvedByAnyReader(HAND_DISCARD)).toBe(true);
    expect(deriveAttackOptionalCostBoost(HAND_DISCARD)).toEqual({
      cond: { kind: "yourHandNotEmpty" },
      ops: [{ op: "discardHand" }],
      payoff: { kind: "moreDamage", bonus: 120 },
    });
    // 🛑 AND THE COST HALF IS WHAT CLAIMS IT, not the connective alone — the same
    // synthetic re-pairing §2 uses, so the claim is attributable to one half. The hand
    // cost reads under BOTH connectives (they are one reading — see
    // `OPTIONAL_COST_CONNECTIVE`), and an UNKNOWN cost is still refused under both.
    expect(
      deriveAttackOptionalCostBoost(
        "You may discard your hand. If you do, this attack does 120 more damage.",
      ),
    ).toEqual(deriveAttackOptionalCostBoost(HAND_DISCARD));
    expect(
      deriveAttackOptionalCostBoost(
        "You may turn 1 of your face-down Prize cards face up. If you discarded any cards in this way, this attack does 80 more damage.",
      ),
    ).toBeNull();
  });
});

describe("§2 — BOTH halves dispatched, and each refusal driven from OUTSIDE the population", () => {
  it("the printed sentence reads as a precondition, a cost and a DISPATCHED payoff", () => {
    expect(deriveAttackOptionalCostBoost(CETITAN)).toEqual({
      cond: { kind: "stadiumInPlay" },
      ops: [{ op: "discardStadium" }],
      // 🆕🆕 D383 — `bonus: 140` became `payoff: {kind, bonus}`. The KIND is what
      // `attack.ts` reads to decide whether the printed base is re-homed, so a payoff
      // that silently defaulted would delete a hit rather than mis-report a number.
      payoff: { kind: "moreDamage", bonus: 140 },
    });
  });

  it("🆕🆕 D383 — and the SECOND printed payoff reads as the SAME shape, one row over", () => {
    expect(deriveAttackOptionalCostBoost(TAKEN_SINCE.energy)).toEqual({
      // The one new `BoardCondition` member, carrying the digit the anchor CAPTURED.
      cond: { kind: "yourActiveEnergyAtLeast", count: 3 },
      ops: [
        { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: 3, to: "deck" },
        { op: "shuffleDeck" },
      ],
      // 🆕🆕 D399 — `count` is the shared fragment's second capture. All 5 printings
      // of this payoff spell "1 of", so the value is the one this reader always
      // built; what changed is that it is READ rather than remembered.
      payoff: { kind: "benchSnipe", amount: 120, count: 1 },
    });
  });

  it("🛑 the COST half's refusal is the COST's, not the reminder text's", () => {
    // 🛑 THE SATURATION TRAP, REFUSED (D379). Both remaining printings carry a
    // trailing parenthetical, so a `\.$` anchor would refuse them BY ACCIDENT and the
    // suite would read green while claiming nothing. So each half is re-paired with a
    // half this reader DOES read, and the sentences below are SYNTHETIC on purpose —
    // no card prints them, which is the whole point of driving a refusal from outside
    // the population.
    expect(
      deriveAttackOptionalCostBoost(
        "You may turn 1 of your face-down Prize cards face up. If you do, this attack does 80 more damage.",
      ),
    ).toBeNull();
    // 🆕🆕 D383 — THE ENERGY COST IS NO LONGER A REFUSAL AND THE ROW WAS REPLACED
    // RATHER THAN DELETED. Its two NEAREST misses take its place, and both are the
    // mistakes this row's anchor is actually protecting against: the wrong BODY and
    // the wrong ZONE. Synthetic on purpose — no card prints either.
    expect(
      deriveAttackOptionalCostBoost(
        "You may shuffle 3 Energy attached to your opponent's Active Pokémon into your deck. If you do, this attack does 120 more damage.",
      ),
    ).toBeNull();
    expect(
      deriveAttackOptionalCostBoost(
        "You may shuffle 3 Energy attached to this Pokémon into your discard pile. If you do, this attack does 120 more damage.",
      ),
    ).toBeNull();
    // …and the control that makes those refusals mean something: the SAME payoff
    // behind the cost the table DOES read, at a captured count of 2.
    expect(
      deriveAttackOptionalCostBoost(
        "You may shuffle 2 Energy attached to this Pokémon into your deck. If you do, this attack does 120 more damage.",
      ),
    ).toEqual({
      cond: { kind: "yourActiveEnergyAtLeast", count: 2 },
      ops: [
        { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: 2, to: "deck" },
        { op: "shuffleDeck" },
      ],
      payoff: { kind: "moreDamage", bonus: 120 },
    });
    // …and the other control, unchanged: the SAME payoff behind D381's own cost.
    expect(
      deriveAttackOptionalCostBoost(
        "You may discard a Stadium in play. If you do, this attack does 80 more damage.",
      ),
    ).toEqual({
      cond: { kind: "stadiumInPlay" },
      ops: [{ op: "discardStadium" }],
      payoff: { kind: "moreDamage", bonus: 80 },
    });
  });

  it("🛑 the PAYOFF half's refusal is the PAYOFF's, on a cost the table reads", () => {
    // 🆕🆕 D383 — the benched snipe is now a ROW, so the refusals move to ITS nearest
    // misses: the zone word dropped (`opponentAny`, a different op) and the count
    // moved off 1. Both are shapes `deriveAttackEffect` reads under OTHER anchors, so
    // a payoff table that claimed them would be answering another arm's question.
    expect(
      deriveAttackOptionalCostBoost(
        "You may discard a Stadium in play. If you do, this attack also does 120 damage to 1 of your opponent's Pokémon.",
      ),
    ).toBeNull();
    expect(
      deriveAttackOptionalCostBoost(
        "You may discard a Stadium in play. If you do, this attack also does 120 damage to each of your opponent's Benched Pokémon.",
      ),
    ).toBeNull();
    expect(
      deriveAttackOptionalCostBoost(
        "You may discard a Stadium in play. If you do, draw 3 cards.",
      ),
    ).toBeNull();
    // …and the printed 0 guard on the SECOND payoff too, which has its own captured
    // amount and therefore its own `>= 1`.
    expect(
      deriveAttackOptionalCostBoost(
        "You may discard a Stadium in play. If you do, this attack also does 0 damage to 1 of your opponent's Benched Pokémon.",
      ),
    ).toBeNull();
    // A printed 0 buys nothing — the guard every captured amount in effects.ts carries,
    // and here it is the whole stake: a Stadium charged for no extra damage.
    expect(
      deriveAttackOptionalCostBoost(
        "You may discard a Stadium in play. If you do, this attack does 0 more damage.",
      ),
    ).toBeNull();
  });

  it("🛑 the anchor is WHOLE-SENTENCE at BOTH ends, so a compound printing is refused", () => {
    for (const sentence of Object.values(STILL_OWED)) {
      expect(deriveAttackOptionalCostBoost(sentence), sentence).toBeNull();
    }
    // 🆕🆕 D383 — and the ATTRIBUTION CONTROL that stops this rung passing because the
    // list got shorter: the row that LEFT it is asserted to resolve.
    expect(deriveAttackOptionalCostBoost(TAKEN_SINCE.energy)).not.toBeNull();
    // A leading or trailing sentence denies it, exactly as it denies D316's reader.
    expect(deriveAttackOptionalCostBoost(`Draw a card. ${CETITAN}`)).toBeNull();
    expect(deriveAttackOptionalCostBoost(`${CETITAN} Draw a card.`)).toBeNull();
    // …and the bare D380 sentence, which stops at the first period.
    expect(deriveAttackOptionalCostBoost("You may discard a Stadium in play.")).toBeNull();
  });

  it("🛑 the OTHER NINE readers refuse it, which is what makes ten readers one answer", () => {
    for (const read of READERS) {
      if (read === deriveAttackOptionalCostBoost) continue;
      expect(read(CETITAN), read.name).toBeNull();
    }
    // …and this reader refuses all four of D316's, from the other side.
    for (const [, s] of corpus().filter(([, s]) => deriveAttackOptionalBoost(s) !== null)) {
      expect(deriveAttackOptionalCostBoost(s), s).toBeNull();
    }
  });
});

describe("§3 — the program, pinned byte-for-byte: two gates, and BOTH carry a decline arm", () => {
  it("the cost is spliced IN FRONT of the boosted hit, and both declines deal the base", () => {
    const reading = deriveAttackOptionalCostBoost(CETITAN);
    if (reading === null) throw new Error("expected the reading");
    const expected: EffectOp[] = [
      {
        op: "conditionGate",
        cond: { kind: "stadiumInPlay" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          {
            op: "optional",
            note: CETITAN,
            // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
            then: [{ op: "discardStadium" }, { op: "damageDefender", amount: 280 }],
            otherwise: [{ op: "damageDefender", amount: 140 }],
          },
        ],
        otherwise: [{ op: "damageDefender", amount: 140 }],
      },
    ];
    expect(optionalCostBoostProgram(reading, 140, CETITAN)).toEqual(expected);
  });

  it("🛑 the DECLINE arm is the printed base and NOT nothing, on both gates", () => {
    // The one piece of behaviour `boostedArms` carries, paid twice here. An absent arm
    // on either gate would silently delete a 140-damage attack — which is the
    // difference from D380's bare "You may", whose `otherwise` is rightly ABSENT
    // because its whole printed content is the discard.
    const reading = deriveAttackOptionalCostBoost(CETITAN);
    if (reading === null) throw new Error("expected the reading");
    const gate = optionalCostBoostProgram(reading, 140, CETITAN)[0];
    if (gate === undefined || gate.op !== "conditionGate") throw new Error("expected the gate");
    expect(gate.otherwise).toEqual([{ op: "damageDefender", amount: 140 }]);
    const ask = gate.then[0];
    if (ask === undefined || ask.op !== "optional") throw new Error("expected the confirm");
    expect(ask.otherwise).toEqual([{ op: "damageDefender", amount: 140 }]);
    // The confirm's note is the WHOLE printed sentence and not a re-voicing — the op's
    // own contract, and what the dialog shows.
    expect(ask.note).toBe(CETITAN);
  });

  it("the base TRACKS the attack rather than being pinned, and the bonus is CAPTURED", () => {
    // Every printing of this family carries a real printed base, and the capture is
    // what keeps the assembler correct for a second printing rather than for this one.
    for (const trial of [0, 30, 140, 250]) {
      const reading = deriveAttackOptionalCostBoost(CETITAN);
      if (reading === null) throw new Error("expected the reading");
      const gate = optionalCostBoostProgram(reading, trial, CETITAN)[0];
      if (gate === undefined || gate.op !== "conditionGate") throw new Error("expected the gate");
      expect(gate.otherwise).toEqual([{ op: "damageDefender", amount: trial }]);
      const ask = gate.then[0];
      if (ask === undefined || ask.op !== "optional") throw new Error("expected the confirm");
      expect(ask.then[1]).toEqual({ op: "damageDefender", amount: trial + 140 });
    }
  });
});

describe("§4 — the board: the printed ORDER, on the one Stadium that can see it", () => {
  it.each(SEEDS)("seed %i — Beach Court: YES discards to the OWNER and deals 280", (seed) => {
    const before = board(seed, BEACH_COURT);
    const stadium = before.stadium;
    if (stadium === null) throw new Error("expected P2's Stadium in the zone");
    expect(stadium.owner).toBe("p2");
    const parked = attack(before);
    expect(parked.state.phase.kind).toBe("effect:choose");
    expect(find(parked.events, "EFFECT_PENDING")).toEqual({
      type: "EFFECT_PENDING",
      seat: "p1",
      note: CETITAN,
    });
    // 🛑 NOTHING HAS BEEN DEALT YET — the whole hit moved inside the gate, which is
    // what makes §8.5 run ONCE on the number the answer decided.
    expect(types(parked.events)).not.toContain("DAMAGE_DEALT");

    const done = say(parked.state, true);
    expect(done.state.stadium).toBeNull();
    // The OWNER's pile, asserted as an EXTENSION of its own former contents (D380's
    // repair — "contains the uid" and "grew by one" are both true of a cross-seat
    // write on a symmetric board).
    expect(done.state.players.p2.discard).toEqual([...parked.state.players.p2.discard, stadium.uid]);
    expect(done.state.players.p1.discard).toEqual(parked.state.players.p1.discard);
    expect(find(done.events, "STADIUM_DISCARDED")?.seat).toBe("p2");
    expect(find(done.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 280 });
    expect(types(done.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it.each(SEEDS)("seed %i — 🛑 NEUTRALIZATION ZONE: the order is observable, and it is 280", (seed) => {
    // 🛑🛑 **THE RUNG THAT SEPARATES THE PRINTED ORDER FROM `boostedArms`' ORDER, AND
    // THE ONLY ONE THAT CAN.** Neutralization Zone `sv06.5-060` prevents damage to a
    // Pokémon WITHOUT a Rule Box from an attacking Pokémon **ex**. `fix-titan` has no
    // Rule Box and `Fixceti ex` is an ex, so while the Zone is in the shared zone this
    // attack deals NOTHING. Discard first and the hit lands for 280; hit first and it
    // is prevented for 0 and the Zone is then discarded by an attack that did nothing.
    // Every board in this file that carries Beach Court instead is green EITHER WAY.
    const before = board(seed, NEUTRALIZATION_ZONE);
    const stadium = before.stadium;
    if (stadium === null) throw new Error("expected P2's Stadium in the zone");
    const defender = before.players.p2.active;
    if (defender === null) throw new Error("expected P2's Active");
    expect(defender.damage).toBe(0);

    const done = say(attack(before).state, true);
    expect(done.state.stadium).toBeNull();
    expect(find(done.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 280 });
    const after = done.state.players.p2.active;
    if (after === null) throw new Error("expected P2's Active");
    expect(after.damage).toBe(280);
  });

  it.each(SEEDS)("seed %i — and the CONTROL: the same Zone with the confirm DECLINED deals 0", (seed) => {
    // The other end of the same board, and it is what proves the 280 above came from
    // the DISCARD rather than from the Zone never mattering: decline, the Zone stays,
    // and the printed 140 is prevented in full.
    const before = board(seed, NEUTRALIZATION_ZONE);
    const stadium = before.stadium;
    if (stadium === null) throw new Error("expected P2's Stadium in the zone");
    const done = say(attack(before).state, false);
    expect(done.state.stadium).toEqual(stadium);
    expect(find(done.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0 });
    const after = done.state.players.p2.active;
    if (after === null) throw new Error("expected P2's Active");
    expect(after.damage).toBe(0);
  });
});

describe("§5 — the confirm: a decline still deals the base, and an empty zone is not asked", () => {
  it.each(SEEDS)("seed %i — NO leaves the Stadium alone and deals the printed 140", (seed) => {
    const before = board(seed, BEACH_COURT);
    const stadium = before.stadium;
    if (stadium === null) throw new Error("expected P2's Stadium in the zone");
    const done = say(attack(before).state, false);
    // 🛑 THE DEFECT `optional`'s own doc names: a confirm that silently applies on "no".
    expect(done.state.stadium).toEqual(stadium);
    expect(done.state.players.p2.discard).not.toContain(stadium.uid);
    expect(types(done.events)).not.toContain("STADIUM_DISCARDED");
    // …and the rung a dropped `optional.otherwise` reddens on.
    expect(find(done.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 140 });
  });

  it.each(SEEDS)("seed %i — 🛑 an EMPTY zone is not asked at all, and pays 140 rather than 280", (seed) => {
    // 🛑 THE RUNG A DROPPED `conditionGate` REDDENS ON, AND IT IS TWO RUNGS AT ONCE:
    // without the gate the program parks a confirm on an empty zone whose "yes"
    // discards NOTHING and still pays the +140 — a **FREE 140**, which is D380's
    // stakeless dialog with damage at stake.
    const before = board(seed, null);
    expect(before.stadium).toBeNull();
    const result = attack(before);
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(types(result.events)).not.toContain("EFFECT_PENDING");
    expect(types(result.events)).not.toContain("STADIUM_DISCARDED");
    expect(types(result.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // The gate refuses the QUESTION, never the attack — the rung a dropped
    // `conditionGate.otherwise` reddens on.
    expect(find(result.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 140 });
  });

  it.each(SEEDS)("seed %i — ONE §8.5 hit, never two: exactly one DAMAGE_DEALT per answer", (seed) => {
    // D316's arithmetic, inherited: Weakness DISTRIBUTES over a split hit but
    // Resistance and the defender's reduction are SUBTRACTIONS paid once per hit, so a
    // base landed pre-program AND a bonus landed inside the gate would emit two rows
    // for one printed number. `scaledBase` is 0 for this reader for exactly that
    // reason, and this is the observation that would catch its removal.
    for (const yes of [true, false]) {
      const done = say(attack(board(seed, BEACH_COURT)).state, yes);
      expect(types(done.events).filter((t) => t === "DAMAGE_DEALT")).toHaveLength(1);
    }
    const empty = attack(board(seed, null));
    expect(types(empty.events).filter((t) => t === "DAMAGE_DEALT")).toHaveLength(1);
  });
});

describe("§6 — what this slice did NOT buy", () => {
  it("🛑 the ONE remaining printing stays LOUD, waiting on a named mechanism", () => {
    for (const sentence of Object.values(STILL_OWED)) {
      expect(resolvedByAnyReader(sentence), sentence).toBe(false);
    }
    const left = corpus().filter(([, s]) =>
      (Object.values(STILL_OWED) as readonly string[]).includes(s),
    );
    // 🆕🆕 D383 — 2 / 7 -> 1 / 2.
    expect([left.length, units(left)]).toEqual([1, 2]);
    expect(corpus().filter(([, s]) => s === STILL_OWED.prize).map(([n]) => n)).toEqual([2]);
    // 🛑 AND THE DEPARTED ROW IS ASSERTED RESOLVED, WHICH IS WHAT KEEPS THE RUNG ABOVE
    // FROM GOING GREEN BY BEING SHORTENED (D382's repair, one file over).
    expect(resolvedByAnyReader(TAKEN_SINCE.energy)).toBe(true);
    expect(corpus().filter(([, s]) => s === TAKEN_SINCE.energy).map(([n]) => n)).toEqual([5]);
  });

  it("bought no new op and no new BoardCondition member — every step already existed", () => {
    const reading = deriveAttackOptionalCostBoost(CETITAN);
    if (reading === null) throw new Error("expected the reading");
    // D380's op and D378's member, reached through a new reading. Asserted by driving
    // the OTHER producer of the same op on the same board shape and comparing: the
    // bare imperative derives `discardStadium` alone, and this program's cost arm is
    // that same step.
    expect(deriveAttackEffect("Discard a Stadium in play.")).toEqual(reading.ops);
    expect(reading.cond).toEqual({ kind: "stadiumInPlay" });
  });

  it("bought no registry row — the reading reaches the board through attack text only", () => {
    // Both printings are ATTACKS, which is what makes attack.ts the whole read site.
    const rows = corpus().filter(([, s]) => s === CETITAN);
    expect(units(rows)).toBe(2);
    expect(rows).toHaveLength(1);
  });
});
