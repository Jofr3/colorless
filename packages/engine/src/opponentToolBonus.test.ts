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
import type { BoardCondition, GameEvent, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  OPPONENT_TOOL_DECK,
  attachFromDeck,
  attachToolFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 🆕🆕 D369 — THE CROSS-BOARD POKÉMON TOOL CLAUSE, AND A SHAPE QUESTION WHOSE
// ANSWER WAS "YES" WITH THE BLOCKER SOMEWHERE ELSE ENTIRELY.
//
// D368 handed over TWO candidates at the head of the `CONDITIONAL_DAMAGE_BONUS`
// residue, called them "the two largest remaining", said both were **2 legal
// printings for 1 new member** — a ratio of 2.0 against the 3.0 it took — and
// ordered the work: ask whether 2.0 is worth buying at all, and settle the SHAPE
// of *"all of your Benched Pokémon have at least 1 damage counter on them"*
// BEFORE pricing it, because a universal over a variable-size set is a shape no
// member of this union has.
//
// 🛑 **THE SHAPE QUESTION'S ANSWER IS YES, AND THAT IS NOT WHAT BLOCKS IT** (§2).
// A universal over the Bench is a function of `(state, seat)` and nothing else, so
// `conditionHolds` can evaluate it exactly — unlike D368's declaration candidate,
// which needed an attack it is never handed. What actually blocks it is a THIRD
// kind of question: an EMPTY-SET SEMANTIC BOUNDARY, and the catalog is measured
// unable to settle it — the whole 640-sentence legal attack column prints exactly
// ONE universally-quantified antecedent, so there is no sibling to triangulate
// against. **A SHAPE ASKS WHETHER THE TABLE CAN HOLD IT; A PRICE ASKS WHETHER IT
// IS WORTH BUYING; A BOUNDARY ASKS WHAT THE ROW WOULD *MEAN* — AND THE THIRD ONE
// CAN FAIL WITH THE FIRST TWO BOTH GREEN.**
//
// 🛑 **AND THE HANDOFF'S TIE-BREAK SET WAS TWO ITEMS WHERE THE MEASUREMENT SAYS
// SEVEN** (§1). Re-derived here rather than inherited: the 2-printing band of the
// residue holds **7 distinct clauses**, not the 2 the resume point named. The
// number that decided this slice was never "2.0 vs 2.0" — it was which of seven
// 2.0s costs the least to get RIGHT.
//
// WHAT SHIPS: **1 new `BoardCondition` member** (`opponentActiveHasToolAttached`),
// its **2** reader arms and **1** literal `CONDITIONAL_DAMAGE_CLAUSES` row — the
// cross-board twin of D122's `yourActiveHasToolAttached`, which has been in the
// union since 0.73.0 reading the identical field on the other body.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/** The nine live readers, run as one — the same set `censusAtHead.test.ts` and
    `undamagedBonus.test.ts` use. */
const READERS: readonly ((text: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  // 🆕🆕 D419 — the THREE readers this list never had (D381, D403, D417), written
  // in NAME order rather than in landing order because the guard below diffs a
  // SORTED list against the module surface.
  // ⚠️ SPLICED MID-LIST RATHER THAN APPENDED: mutant `find` strings in
  // `scripts/mutation/mutants.ts` quote an array's LAST entries plus its closing
  // `];`, and appending moves that anchor without a character of it changing —
  // the adjacency class D418 paid for once on `stadiumPresence.test.ts`.
  deriveAttackCancelRequirement,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalCostBoost,
  // 🆕🆕 D428 — THE THIRTEENTH, the PRE-DAMAGE Tool discard. ⚠️ SPLICED BEFORE THE
  // LAST ENTRY RATHER THAN APPENDED, D419's rule: mutant `find` strings quote an
  // array's LAST entries plus its closing bracket, and appending moves that anchor
  // without a character of it changing.
  deriveAttackPreDamage,
  deriveAttackBonusConsequent,
];

/** THE SENTENCE THIS SLICE BUYS, and the clause inside it. */
const TAKEN =
  "If your opponent's Active Pokémon has a Pokémon Tool attached, this attack does 80 more damage.";
const TAKEN_CLAUSE = "your opponent's Active Pokémon has a Pokémon Tool attached";

/** THE SELF TWIN, shipped at D122 and untouched here — Greedent `sv01-152`
    "Enhanced Fang". The two sentences differ ONLY in the noun phrase naming the
    body, which is exactly why they must never resolve to one member. */
const SELF_TWIN = "If this Pokémon has a Pokémon Tool attached, this attack does 80 more damage.";

/** THE CANDIDATE DEFERRED IN §2, with its printing count. */
const UNIVERSAL =
  "If all of your Benched Pokémon have at least 1 damage counter on them, this attack does 120 more damage.";

/** Enhanced Fang is at index 1 — index 0 is the effect-less "Bite". */
const ENHANCED_FANG_INDEX = 1;

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: OPPONENT_TOOL_DECK, p2: OPPONENT_TOOL_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** The seat's opposite. Spelled once here rather than imported, because the member
    is seat-relative and every board case below names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

/** `attacker` in `seat`'s Active Spot with the cost paid, a 200 HP body across
    the table, and BOTH benches empty — each case then puts exactly the bodies and
    Tools it is about. `board` opens P1's turn, so a P2 case passes once more; the
    clause is seat-relative and a P1-only suite cannot tell "reads your opponent's
    Active" apart from "reads p2's". */
function ready(seed: number, seat: Seat, attacker: string): GameState {
  let state = board(seed);
  if (seat === "p2") state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = setActiveFromDeck(state, seat, attacker);
  state = attachFromDeck(state, seat, "fix-energy", 3);
  state = setActiveFromDeck(state, other(seat), "fix-bigbody");
  return clearBench(clearBench(state, seat), other(seat));
}

/** Attack at `index` from `seat` and report the damage actually dealt. */
function damageDealt(state: GameState, seat: Seat, index = 0): number {
  const after = mustApply(state, { type: "attack", seat, index });
  const dealt = after.events.find((e: GameEvent) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

describe("§1 — the price, RE-DERIVED: the 2-printing band is SEVEN clauses, not two", () => {
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

  it("🛑 the residue is 33 sentences / 44 printings and its top band holds 7 clauses at 2", () => {
    // D368's handoff named TWO candidates at 2 printings and called them "the two
    // largest remaining". Measured over the same instrument it used — the nine live
    // readers over `legalAttackCorpus()` — the 2-printing band is SEVEN clauses.
    // The tie-break was therefore never a coin toss between two; it was a choice
    // among seven, and the one taken is the only one whose predicate ALREADY EXISTS
    // in this file's sibling member.
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    // The row is SHIPPED at this head, so the taken sentence has left the refused
    // set and the residue is smaller than the handoff's figure by exactly its
    // printings. Both facts are asserted rather than one: the departure and the
    // size, so a reader that broke and a row that landed cannot look alike.
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    // 🆕🆕 D372 — 30 / 38 -> **28 / 36**, AND THE TWO TERMS STOP MOVING IN STEP.
    // D372 took the CROSS-BOARD EQUAL-ENERGY clause (`sameEnergyBonus.test.ts`) this
    // file's own band named among the six, and that clause is printed under **TWO**
    // sentences at 1 printing each — so the SENTENCE term falls by 2 where the
    // PRINTING term falls by 2, the first time on this chain that the two are not
    // 1-and-2. **A CLAUSE-KEYED BAND ENTRY IS NOT A SENTENCE COUNT.** Every earlier
    // figure still comes back off the live head rather than being left frozen.
    // 🆕🆕 D373 — 28 / 36 -> 27 / 34: the UNIVERSAL-OVER-THE-BENCH clause left the
    // residue (1 sentence / 2 printings), re-derived live rather than decremented.
    // 🆕🆕 D374 — 27 / 34 -> 26 / 32: the NAMED-ENERGY clause left the residue
    // (1 sentence / 2 printings), re-derived live rather than decremented.
    // 🆕🆕 D375 — 26 / 32 -> 25 / 30: the CROSS-BOARD TYPE INTERSECTION left it, the
    // same 1:2 step, re-derived live rather than decremented.
    // 🆕🆕 D376 — 25 / 30 -> 24 / 28: the FILTERED DISCARD-PILE THRESHOLD left the
    // residue (1 sentence / 2 printings), re-derived live rather than decremented.
    // 🆕🆕 D377 — 24 / 28 -> 22 / 26: the CROSS-BOARD STATUS PAIR left this residue —
    // TWO sentences at ONE printing each (*"…is Burned"* +40, *"…is Confused"* +90) —
    // so the step is 2:2 rather than the 1:2 the six slices before it took. Re-derived
    // live rather than decremented. ⚠️ AND THAT SLICE'S THIRD PRINTING IS NOT IN THIS
    // NUMBER: the same board fact is printed once more under the "does nothing"
    // consequent, which is a different skeleton and a different residue.
        // 🆕🆕 D378 — 22 / 26 -> 21 / 25: STADIUM PRESENCE (`stadiumInPlay`) left this
    // residue — ONE sentence at ONE printing (Probopass `sv10-098` "Mountain Drop",
    // +70) — re-derived live rather than decremented. ⚠️ AND TWO OF THAT SLICE'S
    // THREE PRINTINGS ARE NOT IN THIS NUMBER: the same board fact is printed under
    // the "does nothing" consequent by Fan Rotom, which is a different skeleton and a
    // different residue — and there it is the BIGGER half.
    // 🆕🆕 D384 — 21 / 25 -> 20 / 24: the STRICT-INEQUALITY TWIN left this residue —
    // ONE sentence at ONE printing (Swalot `sv07-092` "Devouring Mouth", +160) — and
    // it is the family's FIRST 1:1 step, re-derived live rather than decremented.
    // ⚠️ AND IT IS THE SENTENCE D372 PRICED AND REFUSED: the same two Active bodies as
    // `activeEnergyCountsEqual`, under `>` instead of `===`, on a SECOND nullary member.
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
    // D371's recorded residue, then D370's, then D369's, then D368's — all
    // re-derived from THIS head rather than quoted. A guard that only checked the
    // current pair could not tell "a row landed" from "a reader broke".
    // 🆕🆕 D373 — one more term on each chain, and the step is 1 sentence /
    // 2 printings (the UNIVERSAL-OVER-THE-BENCH clause).
    // 🆕🆕 D374 — one more term on each chain, and the step is 1 sentence /
    // 2 printings (the NAMED-ENERGY clause).
    // 🆕🆕 D375 — one more term again, same 1:2 step (the TYPE INTERSECTION).
    // 🆕🆕 D376 — one more term on every chain below, same 1:2 step (the FILTERED
    // DISCARD-PILE THRESHOLD). ⚠️ THE HEAD IS NOW 24 / 28, so every OFFSET here moved
    // by one sentence and two printings while the expected values stayed put — which
    // is the point of writing them as offsets off the live head at all.
    // 🆕🆕 D392 — the OFFSET gains one: the head moved, this one's did not.
    expect(refused.length + 19).toBe(24);
    // 🆕🆕 D392 — the OFFSET gains one: the head moved, this one's did not.
    expect(units(refused) + 23).toBe(28);
    expect(refused.length + 20).toBe(25);
    expect(units(refused) + 25).toBe(30);
    expect(refused.length + 21).toBe(26);
    expect(units(refused) + 27).toBe(32);
    expect(refused.length + 22).toBe(27);
    expect(units(refused) + 29).toBe(34);
    expect(refused.length + 23).toBe(28);
    expect(units(refused) + 31).toBe(36);
    expect(refused.length + 25).toBe(30);
    expect(units(refused) + 33).toBe(38);
    expect(refused.length + 26).toBe(31);
    expect(units(refused) + 35).toBe(40);
    expect(refused.length + 27).toBe(32);
    expect(units(refused) + 37).toBe(42);
    expect(refused.length + 28).toBe(33);
    expect(units(refused) + 39).toBe(44);

    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    // 🆕🆕 D372 — FIVE at 2 printings now: D372 bought the CROSS-BOARD EQUAL-ENERGY
    // clause, after D371 bought the Resistance one and D370 the bench-scoped {M}
    // TYPE one. The list keeps the rest, spelled out so a successor inherits the
    // tie-break MEASURED rather than re-running it. Every one of them is a different
    // mechanism.
    // 🆕🆕 D374 — FOUR -> THREE: D374 bought the NAMED-ENERGY clause out of the band,
    // and the list is re-derived live rather than edited down.
    // 🆕🆕 D375 — THREE -> TWO: the CROSS-BOARD TYPE INTERSECTION was bought out of
    // the band (`typeShareBonus.test.ts`), and the two survivors are the two D374's
    // handoff had already PRICED.
    const band = [...byClause].filter(([, n]) => n === 2).map(([clause]) => clause);
    // 🆕🆕 D376 — TWO -> ONE: the FILTERED DISCARD-PILE THRESHOLD was bought out of
    // the band (`basicEnergyDiscard.test.ts`), and the ONE survivor is the expensive
    // one D374's handoff already priced — *"this Pokémon was healed during this turn"*
    // needs a per-turn HEALED flag on the state, which is a persisted-shape change and
    // therefore a `MATCH_RECORD_VERSION` bump on top of the engine bump.
    // 🆕🆕 D386 — ONE -> ZERO: the healed-this-turn clause was bought out of the band
    // (`healedThisTurn.test.ts`), and THE 2-PRINTING BAND IS NOW EMPTY. 🛑 D379's
    // SATURATION SHAPE — an emptied population cannot go red for the reason that
    // matters — so the refusal is driven from OUTSIDE it: the ONLY clause left above
    // ONE printing is the 5-printing declaration clause D368 disqualified on SHAPE,
    // and the 1-printing band is SIXTEEN deep (D387 took one out of it).
    expect(band).toEqual([]);
    expect([...byClause.values()].filter((n) => n > 1)).toEqual([]);// 🆕🆕 D436 the `n > 1` BAND IS NOW EMPTY — its one occupant was the 5-printing DECLARATION clause and this slice claims it. The rung still goes RED the moment any reader narrows so that a clause returns above one printing (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.)
    // 🆕🆕 D387 — 18 -> **17**: the STAGE 1 clause left the 1-printing band, which is
    // the ONLY band that moved. The 2-printing band was already empty and stays empty,
    // and the refusal is still driven from OUTSIDE it.
    // 🆕🆕 D388 — 17 -> **16**: the RETREAT-COST THRESHOLD left the 1-printing band,
    // which is the ONLY band that moved. The 2-printing band was already empty and stays
    // empty, and the refusal is still driven from OUTSIDE it.
    // 🆕🆕 D389 — 16 -> **15**: the OPPONENT-SEAT BENCH COUNT left the 1-printing band.
    // 🆕🆕 D390 — 15 -> **14**: the OPPONENT-SEAT TYPE READ left it too, and the
    // 1-printing band is again the ONLY band that moved. The 2-printing band was
    // already empty and stays empty, and the refusal is still driven from OUTSIDE it.
    // 🆕🆕 D391 — the TYPED PER-BODY ENERGY THRESHOLD left the 1-printing band.
    // 🆕🆕 D392 — 13 -> **12**: the SUBSTRING NAME READ's clause left the 1-printing band.
    expect(byClause.size).toBe(5); // 🆕🆕 D436 -1 clause: the 5-printing DECLARATION clause LEAVES this residue, and the 5 remaining are the D207 banners (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D398 — the DECK-SIZE READ took ONE more singleton out, a 1:1 step, and it was the LAST BUILDABLE one // 🆕🆕 D397 — the BENCHED-CUBONE FILTER took ONE more singleton out, back to a 1:1 step // 🆕🆕 D394 — the USED-ATTACK PAIR took TWO more singletons out at once, the second two-step in two slices
    expect(band.length + 2).toBe(2);
    // …with D372's clause counted back in the band is SIX, with D371's as well SEVEN,
    // with D370's EIGHT, and with this file's own NINE — the number D368's handoff
    // put at two.
    expect(band.length + 3).toBe(3);
    expect(band.length + 4).toBe(4);
    expect(band.length + 5).toBe(5);
    expect(band.length + 6).toBe(6);
    expect(band.length + 7).toBe(7);
    expect(band.length + 8).toBe(8);
    expect(band.length + 9).toBe(9);
    // The 5-printing declaration clause D368 disqualified on shape is STILL the
    // largest thing in the residue and is STILL refused, so nothing here has quietly
    // re-priced it.
    // 🆕🆕 **D436 — 5 → 1: THE DECLARATION CLAUSE LEFT AND THE RESIDUE IS FLAT.** The
    // paragraph above is right about the SHAPE and D436 does not contradict it: no
    // `BoardCondition` answers *"in addition to this attack's cost"*, and none does
    // now. The sentence is claimed by a `DamageCountSource` instead, whose fold runs
    // inside `attack()` where the declared cost is a local. ⚠️ **A REFUSAL SCOPED TO
    // ONE VOCABULARY IS NOT A REFUSAL OF THE SENTENCE.** The rung is kept and inverted
    // rather than deleted (D418): a FLAT maximum reddens the moment any clause returns
    // above one printing, which is the direction that still matters.
    expect(Math.max(...byClause.values())).toBe(1);
  });

  it("the taken sentence is 2 legal printings, and that is ALL of them", () => {
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(2);
    // ONE record, because the corpus is a `GROUP BY` over distinct sentences: two
    // records for one sentence would double-count the printings above.
    expect(corpus().filter(([, s]) => s === TAKEN)).toHaveLength(1);
    // ⚠️ AND THE IDS BEHIND THOSE TWO PRINTINGS ARE NOT RECORDED, DELIBERATELY.
    // This container has no D1 credentials (`bunx wrangler d1 execute` returns
    // `CLOUDFLARE_API_TOKEN` unset), so the ids could not be read this session and
    // are NOT guessed. Nothing on this path needs them: the reader is keyed on the
    // printed sentence, so it serves every printing of it in every set — "an arm
    // transfers across sets; a registry row does not".
  });

  it("🛑 and the TWIN's own printing is not Standard-legal — the ROW outlived it", () => {
    // A D187 finding one clause over, and it is why the amount is captured by the
    // SKELETON rather than by the clause row. Greedent's "Enhanced Fang" is the
    // sentence D122 was built for and it has ZERO legal printings today; the twin
    // row survives on a DIFFERENT amount of the same clause — "40 more damage",
    // 2 legal printings — which the row serves for free because it never saw the
    // number. **A ROW KEYED ON THE CLAUSE OUTLIVES THE PRINTING THAT MOTIVATED IT;
    // A ROW KEYED ON THE SENTENCE WOULD NOT HAVE.**
    expect(corpus().some(([, s]) => s === SELF_TWIN)).toBe(false);
    const twinLegal = corpus().filter(
      ([, s]) => BONUS.exec(s.trim())?.[1] === "this Pokémon has a Pokémon Tool attached",
    );
    expect(twinLegal).toHaveLength(1);
    expect(units(twinLegal)).toBe(2);
    expect(twinLegal[0]?.[1]).toBe(
      "If this Pokémon has a Pokémon Tool attached, this attack does 40 more damage.",
    );
    // …and it still resolves to the twin member, at the printed 40. The row this
    // slice adds sits directly beside it and moves nothing here.
    expect(deriveAttackDamageBonus(twinLegal[0]?.[1] ?? "")).toEqual({
      per: 40,
      count: { kind: "boardCondition", cond: { kind: "yourActiveHasToolAttached" } },
    });
    // So the two CLAUSES are level at 2 legal printings each — which is the honest
    // comparison, and not the one a reader of Greedent's card would have made.
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(units(twinLegal));
  });
});

describe("§2 — the SHAPE question D368 ordered first, settled: YES, and it is not the blocker", () => {
  it("🛑 a universal over the Bench IS a `(state, seat)` fact — the union CAN hold it", () => {
    // THE ANSWER TO THE HANDED QUESTION, DRIVEN RATHER THAN ARGUED. D368's candidate
    // was disqualified because it needed the DECLARED ATTACK, which `conditionHolds`
    // is never handed. A universal over the Bench needs no such thing: the Bench is
    // reachable from the state and the seat, and `noEnergyOnYourPokemon` is ALREADY
    // a universal over a variable-size in-play set, shipped since D111. So the shape
    // exists in the union today and the candidate is NOT disqualified the way its
    // predecessor was.
    const existingUniversal: BoardCondition = { kind: "noEnergyOnYourPokemon" };
    const state = ready(6100, "p1", "fix-oppotool");
    expect(typeof conditionHolds(state, "p1", existingUniversal)).toBe("boolean");
    expect(conditionNote(existingUniversal)).toBe("none of your Pokémon have any Energy attached");
    // The printed word is "none … any", which is `∀p. ¬hasEnergy(p)` — a universal
    // over exactly the kind of variable-size set the handed candidate quantifies.
    expect(conditionNote(existingUniversal)).toContain("none of your");
  });

  it("🛑 what BLOCKS it is the EMPTY-SET boundary, and the two conventions are both live", () => {
    // THE MEASUREMENT THAT MAKES THIS A DEFERRAL AND NOT A SHRUG. This union answers
    // the empty-population question BOTH ways today, and both are deliberate:
    //   • `noEnergyOnYourPokemon` — the only prior UNIVERSAL — is documented
    //     "vacuously true with nothing in play", and is TRUE on an empty board;
    //   • `yourBenchDamaged` — an EXISTENTIAL — is documented "an EMPTY Bench is
    //     false", and is FALSE on an empty Bench.
    let state = ready(6101, "p1", "fix-oppotool");
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, active: null } } };
    expect(state.players.p1.bench).toHaveLength(0);
    expect(conditionHolds(state, "p1", { kind: "noEnergyOnYourPokemon" })).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "yourBenchDamaged" })).toBe(false);
    // 🛑 AND THE PRECEDENT DOES NOT TRANSFER, WHICH IS THE WHOLE FINDING. The
    // existential's FALSE is forced by logic — an existential over an empty set
    // cannot be true — so it is not a convention at all and decides nothing. The
    // universal's TRUE was chosen on a board THE GAME CANNOT REACH: §4 guarantees
    // an Active Pokémon, so "nothing in play" never happens in a real match and the
    // choice was free of consequence. An EMPTY BENCH happens every game, and the
    // vacuous reading there is worth +120 damage. So the one precedent that has the
    // right SHAPE was set where it could not be wrong.
    const activeOnly = ready(6102, "p1", "fix-oppotool");
    expect(activeOnly.players.p1.active).not.toBeNull();
    expect(activeOnly.players.p1.bench).toHaveLength(0);
    // A REACHABLE board with an empty Bench — the exact board the deferred clause
    // would have to answer on, and the reason the question is not academic.
    expect(conditionHolds(activeOnly, "p1", { kind: "yourBenchDamaged" })).toBe(false);
  });

  it("🛑 the CATALOG cannot settle it either — ONE universal antecedent in 640 sentences", () => {
    // The instrument, not the intuition: the whole legal attack column prints
    // exactly ONE universally-quantified antecedent, so there is no second printing
    // to triangulate the boundary against — no rider, no sibling amount, nothing.
    // D368 settled its shape question by finding the SAME clause on two costs;
    // that move is unavailable here because the population is one.
    const universals = corpus().filter(([, s]) => /^If all of /.test(s));
    expect(universals).toHaveLength(1);
    expect(universals[0]?.[1]).toBe(UNIVERSAL);
    expect(units(universals)).toBe(2);
  });

  it("🛑🆕🆕 D373 — THE TRIPWIRE FIRED, AND THE BOUNDARY WAS SETTLED BEFORE THE ROW LANDED", () => {
    // 🛑 **THIS RUNG WAS D369's REFUSAL, AND IT IS NOW D369's REFUSAL BEING LIFTED.**
    // It read `resolvedByAnyReader(UNIVERSAL) === false` and said "a row added for it
    // without the boundary being settled turns this green rung red". D373 added the
    // row, this rung went red, and the inversion below is the receipt — kept HERE,
    // beside the argument that made the deferral, rather than deleted with it.
    expect(units(corpus().filter(([, s]) => s === UNIVERSAL))).toBe(2);
    expect(BONUS.test(UNIVERSAL.trim())).toBe(true);
    expect(resolvedByAnyReader(UNIVERSAL)).toBe(true);
    // …and it resolves to a member of its OWN, not to the existential twin the rung
    // above documents. That distinction is what D369 was protecting, and it is the
    // one thing a lifted refusal must still assert.
    expect(deriveAttackDamageBonus(UNIVERSAL)).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: { kind: "yourBenchAllDamaged" } },
    });
    // 🛑 THE BOUNDARY, IN ONE LINE: an empty Bench is FALSE. Chosen, not inherited —
    // the whole argument, its four silent instruments and its falsifier are in
    // `benchAllDamagedBonus.test.ts` §2 and in the member's doc block.
    const empty = ready(6103, "p1", "fix-oppotool");
    expect(empty.players.p1.bench).toHaveLength(0);
    expect(conditionHolds(empty, "p1", { kind: "yourBenchAllDamaged" })).toBe(false);
    // And the taken sentence still has NONE of that problem: it is a threshold on ONE
    // body, which is what "the cheapest of the seven to get RIGHT" means.
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
  });
});

describe("§3 — the clause row: an EXACT round trip, which the self twin cannot manage", () => {
  it("maps the printed sentence onto the new member at the printed 80", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 80,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveHasToolAttached" } },
    });
  });

  it("takes N FROM THE SENTENCE, not from the card", () => {
    for (const per of [10, 30, 250]) {
      expect(
        deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does ${per} more damage.`),
      ).toEqual({
        per,
        count: { kind: "boardCondition", cond: { kind: "opponentActiveHasToolAttached" } },
      });
    }
    // A printed 0 adds nothing — the guard every arm in this family carries, so the
    // sentence stays LOUD rather than deriving a no-op bonus.
    expect(deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does 0 more damage.`)).toBeNull();
  });

  it("🛑 `conditionNote` is BYTE-IDENTICAL to the clause key — the twin's is not", () => {
    // The property that makes this row cheaper than the one above it in the table:
    // the sentence names the seat and the spot, so no pronoun has to be resolved
    // (D116) and the note IS the key. Round-tripped in one step, both directions.
    const cond: BoardCondition = { kind: "opponentActiveHasToolAttached" };
    expect(conditionNote(cond)).toBe(TAKEN_CLAUSE);
    expect(deriveAttackDamageBonus(`If ${conditionNote(cond)}, this attack does 80 more damage.`)
      ?.count).toEqual({ kind: "boardCondition", cond });
    // The SELF twin's note is NOT its key — "this Pokémon" became "your Active
    // Pokémon" in the table — so the same round trip fails there. Asserted, because
    // "the note is the key" is a property of this row and not of the family.
    const twin: BoardCondition = { kind: "yourActiveHasToolAttached" };
    expect(conditionNote(twin)).toBe("your Active Pokémon has a Pokémon Tool attached");
    expect(SELF_TWIN).not.toContain(conditionNote(twin));
  });

  it("is a BARE TAG — the member carries no parameter to get wrong", () => {
    const bonus = deriveAttackDamageBonus(TAKEN);
    expect(bonus?.count.kind).toBe("boardCondition");
    if (bonus?.count.kind !== "boardCondition") throw new Error("unreachable");
    expect(Object.keys(bonus.count.cond)).toEqual(["kind"]);
  });

  it("pins the BYTES — a lookalike character would un-map the clause silently", () => {
    // 95 code points; the clause inside it is 58. The é in each "Pokémon" is the
    // character this rung exists for — it is two UTF-8 bytes and one code point, and
    // a decomposed spelling would read identically in a diff.
    expect(TAKEN.length).toBe(95);
    expect(TAKEN_CLAUSE.length).toBe(58);
    expect(TAKEN.split("Pokémon")).toHaveLength(3); // two occurrences
    // Precomposed U+00E9, never e + U+0301 — a decomposed é is invisible in a diff
    // and would fail the Map lookup.
    expect(TAKEN).toContain("é");
    expect(TAKEN).not.toContain("́");
    // A STRAIGHT apostrophe, which is what the catalog prints (D137). The curly form
    // is NOT in the key, and reaches the row through `literalClauseRow`'s fold
    // instead — asserted here as EQUALITY with the straight form, D136's shape.
    expect(TAKEN).toContain("opponent's");
    expect(TAKEN).not.toContain("’");
    expect(deriveAttackDamageBonus(TAKEN.replace("'", "’"))).toEqual(
      deriveAttackDamageBonus(TAKEN),
    );
  });
});

describe("§4 — the near-misses stay LOUD, and the twin is untouched", () => {
  it("🛑 the SELF twin still resolves to the SELF member — this slice moved nothing", () => {
    expect(deriveAttackDamageBonus(SELF_TWIN)).toEqual({
      per: 80,
      count: { kind: "boardCondition", cond: { kind: "yourActiveHasToolAttached" } },
    });
  });

  it("refuses CONSTRUCTED rewrites of the clause — the Map key is char-for-char", () => {
    for (const clause of [
      // The BENCH across the table: a different board, and no member reads it.
      "your opponent's Benched Pokémon have a Pokémon Tool attached",
      // Plural, and the game does print "Pokémon Tools" elsewhere (Revavroom ex).
      "your opponent's Active Pokémon has 2 Pokémon Tools attached",
      "your opponent's Active Pokémon has any Pokémon Tools attached",
      // "attached to it" is the phrasing Tools use on their own card faces.
      "your opponent's Active Pokémon has a Pokémon Tool attached to it",
      // The article moved — "any" is D118's Energy phrasing, not this one's.
      "your opponent's Active Pokémon has any Pokémon Tool attached",
      // De-accented: the exact silent failure the byte guard above exists for.
      "your opponent's Active Pokemon has a Pokemon Tool attached",
      // "the Defending Pokémon" is §8's term of art and a real printed noun phrase
      // elsewhere in the pool — but not on this sentence, and not in this key.
      "the Defending Pokémon has a Pokémon Tool attached",
      // A Tool by NAME, which would be an open-vocabulary trap on a different noun.
      "your opponent's Active Pokémon has a Vitality Band attached",
    ]) {
      expect(
        deriveAttackDamageBonus(`If ${clause}, this attack does 80 more damage.`),
        clause,
      ).toBeNull();
    }
  });

  it("keeps the outer anchor guards on this sentence too", () => {
    for (const text of [
      // Lowercase leading "if" — the matcher has no /i.
      `if ${TAKEN_CLAUSE}, this attack does 80 more damage.`,
      // No trailing period is not the whole sentence.
      `If ${TAKEN_CLAUSE}, this attack does 80 more damage`,
      // A real trailing clause pins `$`.
      `If ${TAKEN_CLAUSE}, this attack does 80 more damage. Then, draw a card.`,
      // Leading text pins `^`.
      `Flip a coin. If ${TAKEN_CLAUSE}, this attack does 80 more damage.`,
      // The "×"/multiply twin, which `deriveAttackDamageMultiplier` owns.
      `If ${TAKEN_CLAUSE}, this attack does 80 damage.`,
    ]) {
      expect(deriveAttackDamageBonus(text), text).toBeNull();
    }
  });
});

describe("§5 — driven on boards: the Tool decides the damage, and only across the table", () => {
  it("a Tool on the OPPONENT's Active pays the +80 — 10 + 80", () => {
    const state = attachToolFromDeck(ready(6200, "p1", "fix-oppotool"), "p2", "active", "fix-tool");
    expect(state.players.p2.active?.tools).toHaveLength(1);
    expect(damageDealt(state, "p1")).toBe(90);
  });

  it("NO Tool anywhere pays the printed base and nothing more", () => {
    const state = ready(6201, "p1", "fix-oppotool");
    expect(state.players.p2.active?.tools).toHaveLength(0);
    expect(damageDealt(state, "p1")).toBe(10);
  });

  it("🛑 a Tool on YOUR OWN Active arms NOTHING — the seat is the whole member", () => {
    // The board that separates this member from the one it was copied from. The
    // attacker is wearing the Tool; the defender is not; the clause reads the
    // defender, so the damage is the base.
    const state = attachToolFromDeck(ready(6202, "p1", "fix-oppotool"), "p1", "active", "fix-tool");
    expect(state.players.p1.active?.tools).toHaveLength(1);
    expect(damageDealt(state, "p1")).toBe(10);
  });

  it("🛑 a Tool on the opponent's BENCH arms nothing either — the SPOT is named too", () => {
    let state = benchFromDeck(ready(6203, "p1", "fix-oppotool"), "p2", "fix-benchfiller");
    state = attachToolFromDeck(state, "p2", 0, "fix-tool");
    expect(state.players.p2.bench[0]?.tools).toHaveLength(1);
    expect(state.players.p2.active?.tools).toHaveLength(0);
    expect(damageDealt(state, "p1")).toBe(10);
  });

  it("🛑 TWO Tools still arm it — `> 0`, never `=== 1`, and §7.4's cap is an ATTACH gate", () => {
    // The twin's one real decision, re-driven on the other body. §7.4 caps a Pokémon
    // at one Tool, but that cap lives at the attach gate and Revavroom ex `sv03-156`'s
    // "Tune-Up" Ability raises it to 4 — so a predicate reading `=== 1` would answer
    // FALSE on a board the printed sentence plainly describes. Nothing but a
    // TWO-Tool board can tell the two readings apart.
    let state = attachToolFromDeck(ready(6209, "p1", "fix-oppotool"), "p2", "active", "fix-tool");
    state = attachToolFromDeck(state, "p2", "active", "sv01-197");
    expect(state.players.p2.active?.tools).toHaveLength(2);
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasToolAttached" })).toBe(true);
    expect(damageDealt(state, "p1")).toBe(90);
  });

  it("reads A TOOL, not a particular one — Vitality Band arms it and adds nothing", () => {
    // `sv01-197` carries a REAL passive (+10 to the attacks of the Pokémon it is
    // attached to). Across the table that passive is inert, so the swing is exactly
    // the clause's 80 and not 90 — which is what tells "the member fired" apart from
    // "a Tool happened to change the number".
    const state = attachToolFromDeck(ready(6204, "p1", "fix-oppotool"), "p2", "active", "sv01-197");
    expect(damageDealt(state, "p1")).toBe(90);
  });

  it("answers from BOTH seats — it reads the opponent OF `seat`, not p2", () => {
    // A p1-only suite cannot tell "reads your opponent's Active" apart from "reads
    // p2's Active". Same board, other seat.
    const state = attachToolFromDeck(ready(6205, "p2", "fix-oppotool"), "p1", "active", "fix-tool");
    expect(damageDealt(state, "p2")).toBe(90);
    for (const seat of ["p1", "p2"] as const) {
      expect(conditionHolds(state, seat, { kind: "opponentActiveHasToolAttached" }), seat).toBe(
        seat === "p2",
      );
    }
  });

  it("🛑 the two members DISAGREE on one board, in both directions", () => {
    // ONE Tool, on ONE Active, read by BOTH members from BOTH seats: four answers,
    // and exactly two of them are true. This is the assertion that would go red if
    // the new arm had been written against `state.players[seat]`.
    const state = attachToolFromDeck(ready(6206, "p1", "fix-oppotool"), "p2", "active", "fix-tool");
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasToolAttached" })).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "yourActiveHasToolAttached" })).toBe(false);
    expect(conditionHolds(state, "p2", { kind: "opponentActiveHasToolAttached" })).toBe(false);
    expect(conditionHolds(state, "p2", { kind: "yourActiveHasToolAttached" })).toBe(true);
  });

  it("🛑 and the two SENTENCES do too — Greedent's fires where this one does not", () => {
    // The same board, driven through the printed cards rather than through the
    // predicates: Greedent (the SELF clause) is Active and wearing the Tool, so its
    // +80 pays; the cross-board sentence on the same board would not. Greedent is a
    // Stage 1 and reaches the spot by surgery, exactly as in `toolClause.test.ts`.
    const state = attachToolFromDeck(ready(6207, "p1", "sv01-152"), "p1", "active", "fix-tool");
    expect(FIXTURE_POOL["sv01-152"]?.attacks?.[ENHANCED_FANG_INDEX]?.effect).toBe(SELF_TWIN);
    expect(FIXTURE_POOL["sv01-152"]?.attacks?.[ENHANCED_FANG_INDEX]?.damage).toBe("80+");
    expect(damageDealt(state, "p1", ENHANCED_FANG_INDEX)).toBe(160); // 80 + 80
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasToolAttached" })).toBe(false);
  });

  it("an EMPTY opposing Active Spot is FALSE, as with every cross-board sibling", () => {
    let state = ready(6208, "p1", "fix-oppotool");
    state = { ...state, players: { ...state.players, p2: { ...state.players.p2, active: null } } };
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasToolAttached" })).toBe(false);
    // …and it is not a throw, which is what "total by design" means here.
    expect(conditionHolds(state, "p1", { kind: "opponentActiveDamaged" })).toBe(false);
  });
});

describe("§6 — the census this row moves, and the summands it does not", () => {
  it("🛑 the attacker fixture prints the sentence char-for-char", () => {
    // The fixture IS the wiring on this path — there is no authored program behind
    // either printing — so a drifted character does not throw, it drops the card
    // back onto the loud ATTACK_EFFECT_SKIPPED path and silently stops paying.
    const attack = FIXTURE_POOL["fix-oppotool"]?.attacks?.[0];
    expect(attack?.effect).toBe(TAKEN);
    expect(attack?.damage).toBe(10);
    expect(attack?.cost).toEqual(["Colorless"]);
    expect(FIXTURE_POOL["fix-oppotool"]?.attacks).toHaveLength(1);
  });

  it("🛑 neither printing is REGISTRY-keyed, so only the RAW summand can move", () => {
    // The registry summand's standing-still, measured on the two ids this file can
    // name: the attacker fixture and Greedent, the twin's real printing. Neither
    // carries an authored program, so `REGISTRY_ATTACK_UNITS` cannot see this slice.
    // ⚠️ THE TWO REAL IDS BEHIND THE TAKEN SENTENCE ARE UNKNOWN THIS SESSION (no D1
    // credentials), so this rung says what it CAN check and does not pretend to the
    // id-walk D368's §6 ran. `censusAtHead.test.ts` closes the rest: it derives
    // `BUILT.attack` from the live readers over the committed corpus, so the +2
    // lands there or nowhere.
    expect(programFor("fix-oppotool")).toBeUndefined();
    expect(programFor("sv01-152")).toBeUndefined();
  });
});
