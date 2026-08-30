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
import {
  BENCH_ALL_DAMAGED_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
} from "./testFixtures";

// 🆕🆕 D373 — THE UNIVERSAL OVER THE BENCH, AND THE EMPTY-SET BOUNDARY THAT WAS THE
// WHOLE SLICE. THE BUILD IS FOUR EDITS; THE RESULT IS A SEMANTIC CHOICE.
//
// D369 measured this clause, priced it at the cheapest shape this family has, and
// then REFUSED to build it — not on shape and not on price, but on a third question:
// what would the row MEAN on an empty Bench? *"All of your Benched Pokémon have at
// least 1 damage counter on them"* is worth **+120**, an empty Bench happens in every
// game, and D369 measured that the catalog cannot triangulate the answer: the whole
// 640-sentence legal attack column prints **exactly one** `/^If all of /` record, so
// the population is one and there is no sibling to compare against.
//
// This slice settles it. **THE ANSWER IS FALSE — AN EMPTY BENCH DOES NOT SATISFY THE
// CLAUSE — AND IT IS RECORDED AS A CHOICE, NOT AS A FACT.**
//
// 🛑 **THE RULES DO NOT SETTLE IT, AND THAT IS A MEASUREMENT RATHER THAN A SHRUG**
// (§2). Four instruments were asked and all four are silent: `docs/reference/
// ptcg-rules.md` states no quantifier rule; the official Pokémon TCG glossary defines
// neither *"all"* nor *"each"*; the Rulings Compendium publishes nothing on a
// universal antecedent over an empty Bench; and the **official Japanese card page for
// this exact printing carries NO Q&A entry at all** (Drampa = ジジーロン, SV5M 060,
// 「げきこうほう」). A real-game ruling would have beaten any engine convention. There
// is none.
//
// 🛑 **AND THE PRECEDENT D369 THOUGHT IT HAD IS NOT A PRECEDENT** (§2) — the finding
// that made this decidable. D369 recorded two prior data points and read them as one
// convention and one logical necessity: `noEnergyOnYourPokemon`, TRUE on an empty
// board, *"chosen"*; `yourBenchDamaged`, FALSE on an empty Bench, *"forced"*. The
// first half is wrong. `noEnergyOnYourPokemon` prints *"none of your Pokémon have any
// Energy attached"* — a NEGATED EXISTENTIAL — and `¬∃` over the empty set is TRUE by
// exactly the same forcing that makes `∃` over the empty set FALSE. **THE TWO DATA
// POINTS ARE EACH OTHER'S NEGATION. NEITHER IS A CONVENTION, AND TOGETHER THEY CARRY
// NO INFORMATION ABOUT A POSITIVE UNIVERSAL.** So this member is the first empty-set
// semantics this vocabulary has ever actually chosen, which is why it is argued in
// the doc block instead of copied from a neighbour.
//
// **THE TWO TIE-BREAKS, AND THEY AGREE.** (1) The pay-out is asymmetric: a wrong TRUE
// silently ADDS 120 to an attack that earned nothing; a wrong FALSE withholds a bonus
// a player can see is missing. (2) Under the vacuous reading the cheapest way to
// satisfy a clause about your Bench is to have no Bench — the printed condition would
// be satisfied by ignoring it.
//
// ⚠️ **WHAT WOULD FALSIFY THE CHOICE**, named so a successor can flip it in one edit:
// an official Q&A on the printing, a Compendium ruling, or PTCG Live observed paying
// the +120 with an empty Bench. The remedy is deleting the `length > 0` guard and
// inverting ONE expectation in §2.
//
// ⚠️ **AND THE NEAR MISS IS ONE METHOD CALL** (§3). `yourBenchDamaged` is `.some` and
// this member is `.every` over the SAME array, on the same seat, reading the same
// field. Driven on ONE board with two benched bodies and one of them damaged, where
// the existential is TRUE and the universal FALSE.
//
// WHAT SHIPS: **1 new `BoardCondition` member** (`yourBenchAllDamaged`), its **2**
// reader arms and **1 literal `CONDITIONAL_DAMAGE_CLAUSES` row**. ZERO new
// vocabulary, maps, templates, patterns, imports, ops, events or `packages/schema`
// bytes, and `MATCH_RECORD_VERSION` stays 22.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/** The nine live readers, run as one — the same set `censusAtHead.test.ts`,
    `opponentToolBonus.test.ts` and `sameEnergyBonus.test.ts` use. */
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

/** THE SENTENCE THIS SLICE BUYS — Drampa sv05-138/-184 "Raging Cannon", 2 legal
    printings of ONE sentence, byte-for-byte from the committed corpus. */
const TAKEN =
  "If all of your Benched Pokémon have at least 1 damage counter on them, this attack does 120 more damage.";
const TAKEN_CLAUSE = "all of your Benched Pokémon have at least 1 damage counter on them";

/** THE EXISTENTIAL TWIN, shipped at D116 — the same array, the same field, the same
    seat, `.some` instead of `.every`, and five printed words apart. */
const EXISTENTIAL_SENTENCE =
  "If your Benched Pokémon have any damage counters on them, this attack does 100 more damage.";

const ALL: BoardCondition = { kind: "yourBenchAllDamaged" };
const ANY: BoardCondition = { kind: "yourBenchDamaged" };
const NO_ENERGY: BoardCondition = { kind: "noEnergyOnYourPokemon" };

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: BENCH_ALL_DAMAGED_DECK, p2: BENCH_ALL_DAMAGED_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** The seat's opposite. Spelled once here rather than imported, because the member
    is seat-relative on the face of it and every board below names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

/** `fix-benchall` in `seat`'s Active Spot with its `{C}` paid, a 200 HP `fix-bigbody`
    across the table, and **BOTH BENCHES EMPTY** — the boundary board, and the one
    every other board here is built up from. `board` opens P1's turn, so a P2 case
    passes once more: a p1-only suite cannot tell "reads YOUR bench" apart from
    "reads p1's bench". */
function ready(seed: number, seat: Seat = "p1"): GameState {
  let state = board(seed);
  if (seat === "p2") state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = setActiveFromDeck(state, seat, "fix-benchall");
  state = attachFromDeck(state, seat, "fix-energy", 1);
  state = setActiveFromDeck(state, other(seat), "fix-bigbody");
  return clearBench(clearBench(state, seat), other(seat));
}

/** `ready`'s board with `count` `fix-basic-1` benched on `seat` and the damage in
    `damages` written onto them, index for index. `0` means an UNDAMAGED benched body,
    which is the only thing that separates `.every` from `.some`. */
function withBench(state: GameState, seat: Seat, damages: readonly number[]): GameState {
  let next = state;
  for (const _ of damages) next = benchFromDeck(next, seat, "fix-basic-1");
  damages.forEach((damage, index) => {
    if (damage > 0) next = setBenchDamage(next, seat, index, damage);
  });
  return next;
}

/** Attack index 0 from `seat` and report the damage actually dealt. */
function damageDealt(state: GameState, seat: Seat = "p1"): number {
  const after = mustApply(state, { type: "attack", seat, index: 0 });
  const dealt = after.events.find((e: GameEvent) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

/** THE ATTRIBUTION CONTROL, and the reason this file can prove the guard is doing
    something: the member's predicate with the `length > 0` clause REMOVED, i.e. the
    vacuous reading, computed here off the same array the arm reads. Every board below
    compares the two, and they may differ on exactly one board in the whole game. */
function vacuousReading(state: GameState, seat: Seat): boolean {
  return state.players[seat].bench.every((p) => p !== null && p.damage > 0);
}

describe("§1 — the price, RE-DERIVED: a 1:2 step and the band down to four", () => {
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

  it("🛑 the residue steps by exactly this ONE sentence and TWO printings", () => {
    // D372 left the residue at 28 records / 36 printings and pinned FIVE clauses in
    // the 2-printing band. Both figures are re-derived here off the same instrument —
    // the nine live readers over `legalAttackCorpus()` — rather than quoted.
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    // The DEPARTURE and the SIZE are asserted separately: a guard that only checked
    // 27 / 34 could not tell "the row landed" from "a reader broke".
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    // 🆕🆕 D374 — 27 / 34 -> 26 / 32: the NAMED-ENERGY clause left the residue (1
    // sentence / 2 printings), re-derived live rather than decremented.
    // 🆕🆕 D375 — 26 / 32 -> 25 / 30: the CROSS-BOARD TYPE INTERSECTION left it, same
    // 1:2 step, and this file's own band named it FIRST of the three it left behind.
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
    // 🛑 AND THE STEP IS 1:2, NOT D372's 2:2. Every earlier head is re-derived from
    // THIS one rather than frozen: 🆕 D375's 26/32, D374's 27/34, D372's 28/36,
    // D371's 30/38, D370's 31/40.
    // 🆕🆕 D376 — one more term on every chain below, same 1:2 step (the FILTERED
    // DISCARD-PILE THRESHOLD). ⚠️ THE HEAD IS NOW 24 / 28, so every OFFSET here moved
    // by one sentence and two printings while the expected values stayed put — which
    // is the point of writing them as offsets off the live head at all.
    // 🆕🆕 D392 — the OFFSET gains one on each axis: the head moved, this one's did not.
    expect([refused.length + 19, units(refused) + 23]).toEqual([24, 28]);
    // 🆕🆕 D392 — the OFFSET gains one on each axis: the head moved, this one's did not.
    expect([refused.length + 20, units(refused) + 25]).toEqual([25, 30]);
    expect([refused.length + 21, units(refused) + 27]).toEqual([26, 32]);
    expect([refused.length + 22, units(refused) + 29]).toEqual([27, 34]);
    expect([refused.length + 23, units(refused) + 31]).toEqual([28, 36]);
    expect([refused.length + 25, units(refused) + 33]).toEqual([30, 38]);
    expect([refused.length + 26, units(refused) + 35]).toEqual([31, 40]);

    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    // 🆕🆕 D374 — THREE at 2 printings, where this row measured four: D374 took the
    // `Team Rocket's Energy` clause this page named FIRST in its own handoff, so the
    // band is re-derived live and the row it left is gone from this list.
    // 🆕🆕 D375 — THREE -> TWO: D375 took the CROSS-BOARD TYPE INTERSECTION, which
    // this list named first. The two survivors are the two D374's handoff had already
    // PRICED — one needs a persisted per-turn HEALED flag (a `MATCH_RECORD_VERSION`
    // bump on top of the engine bump), the other is a threshold over a filtered zone.
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
    expect(band.length + 5).toBe(5);
    // The 5-printing declaration clause D368 disqualified on SHAPE is still the
    // largest thing in the residue and still refused, so nothing here re-priced it.
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

  it("🛑 ONE sentence, TWO printings — and that is the WHOLE universal population", () => {
    const records = corpus().filter(([, s]) => s === TAKEN);
    expect(records).toHaveLength(1);
    expect(units(records)).toBe(2);
    // …and the CLAUSE is the whole population: no second sentence carries it under a
    // different amount, so the row cannot be short and cannot rot on a reprint.
    const clauseRows = corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === TAKEN_CLAUSE);
    expect(clauseRows).toHaveLength(1);
    expect(units(clauseRows)).toBe(2);
    // 🛑 AND D369's MEASUREMENT STANDS AT THIS HEAD: the corpus prints exactly ONE
    // universally-quantified antecedent, which is what made the boundary undecidable
    // FROM THE CATALOG and forced §2's argument. Re-run rather than inherited, so a
    // future set that prints a second one reddens HERE and hands the successor the
    // triangulation this slice did not have.
    const universals = corpus().filter(([, s]) => /^If all of /.test(s));
    expect(universals).toHaveLength(1);
    expect(universals[0]?.[1]).toBe(TAKEN);
    // ⚠️ THE IDS BEHIND THE TWO PRINTINGS ARE NOT READ FROM THE CATALOG — D369's
    // finding, unchanged: this container has no D1 credentials and no local sqlite
    // copy. `sv05-138`/`-184` is recorded in the fixture's doc block from the PRINTED
    // CARD rather than from a query, and nothing on this path needs an id: a literal
    // row is keyed on the printed clause and serves every printing of it.
  });
});

describe("§2 — THE BOUNDARY: an empty Bench is FALSE, and the two prior data points are each other's negation", () => {
  it("🛑 the union's two 'precedents' are `∃` and `¬∃` — forced, not chosen", () => {
    // THE FINDING THAT MADE THIS DECIDABLE, DRIVEN RATHER THAN ARGUED. D369 read
    // `noEnergyOnYourPokemon`'s TRUE on an empty board as a CHOSEN vacuous-universal
    // convention. It is not chosen: its printed sentence is "none of your Pokémon have
    // any Energy attached", a NEGATED EXISTENTIAL, and `¬∃` over an empty set is TRUE
    // by exactly the same forcing that makes `∃` over an empty set FALSE.
    const empty = ready(7100);
    expect(empty.players.p1.bench).toEqual([]);
    expect(empty.players.p1.active).not.toBeNull();
    expect(conditionHolds(empty, "p1", NO_ENERGY)).toBe(false); // the Active paid `{C}`
    expect(conditionHolds(empty, "p1", ANY)).toBe(false);
    // The two printed sentences, side by side: "none … any" against "… any", which is
    // `¬∃` against `∃`. A pair of negations is one data point, not two, and it says
    // nothing at all about a POSITIVE universal.
    expect(conditionNote(NO_ENERGY)).toBe("none of your Pokémon have any Energy attached");
    expect(conditionNote(ANY)).toBe("1 of your Benched Pokémon has damage counters on it");
    expect(conditionNote(NO_ENERGY).startsWith("none of")).toBe(true);
    // …and `noEnergyOnYourPokemon` really is TRUE on a board with nothing in play,
    // which is the reading D369 quoted — reproduced here so the correction is to the
    // INTERPRETATION of the fact and not to the fact.
    const nothing: GameState = {
      ...empty,
      players: { ...empty.players, p1: { ...empty.players.p1, active: null } },
    };
    expect(conditionHolds(nothing, "p1", NO_ENERGY)).toBe(true);
    expect(conditionHolds(nothing, "p1", ANY)).toBe(false);
  });

  it("🛑 THE CHOICE: an empty Bench is FALSE, and the vacuous reading would say TRUE", () => {
    // THE ASSERTION THE WHOLE SLICE EXISTS FOR, with its own attribution control
    // beside it. `vacuousReading` is this member's predicate with the `length > 0`
    // clause removed — the classical `∀` over the empty set — computed off the same
    // array the arm reads. IT ANSWERS TRUE. The member answers FALSE.
    const empty = ready(7101);
    expect(empty.players.p1.bench).toEqual([]);
    expect(vacuousReading(empty, "p1")).toBe(true);
    expect(conditionHolds(empty, "p1", ALL)).toBe(false);
    // 🛑 AND IT IS WORTH 120 DAMAGE ON A LEGAL BOARD, WHICH IS WHY THE CHOICE IS NOT
    // ACADEMIC. Declared for real: the base 10 lands and the bonus does not.
    expect(damageDealt(empty)).toBe(10);
    // Both seats, because "your Bench" is seat-relative and an empty-bench answer that
    // was really a p1 answer would pass every rung above.
    const emptyP2 = ready(7102, "p2");
    expect(emptyP2.players.p2.bench).toEqual([]);
    expect(conditionHolds(emptyP2, "p2", ALL)).toBe(false);
    expect(damageDealt(emptyP2, "p2")).toBe(10);
  });

  it("🛑 …and FALSE is the ONLY board where the guard and the vacuous reading differ", () => {
    // The other half of the control, and the thing that keeps the `length > 0` from
    // being a superstition: on every NON-EMPTY bench the guard is inert, so it cannot
    // be quietly changing an answer somewhere else. Swept across the shapes.
    const base = ready(7103);
    for (const damages of [[10], [0], [10, 10], [10, 0], [0, 10], [10, 10, 10], [10, 0, 10]]) {
      const state = withBench(base, "p1", damages);
      expect(state.players.p1.bench).toHaveLength(damages.length);
      expect(conditionHolds(state, "p1", ALL), damages.join("/")).toBe(
        vacuousReading(state, "p1"),
      );
    }
    // …and on the empty one they disagree. Asserted last, so the sweep above is a
    // statement about non-empty benches rather than about benches.
    expect(conditionHolds(base, "p1", ALL)).not.toBe(vacuousReading(base, "p1"));
  });

  it("🛑 the invariant the guard buys: the universal IMPLIES the existential, on every board", () => {
    // The empty Bench is the ONE board where a vacuous universal would sit ABOVE the
    // existential — TRUE while `.some` is FALSE — and the guard is exactly what makes
    // `∀ ⟹ ∃` hold everywhere instead of almost everywhere. Swept, including the
    // full Bench of 5 and both seats.
    const shapes: readonly (readonly number[])[] = [
      [],
      [0],
      [10],
      [0, 0],
      [10, 0],
      [10, 10],
      [10, 10, 10, 10, 10],
      [10, 10, 10, 10, 0],
    ];
    for (const seat of ["p1", "p2"] as const) {
      const base = ready(7104, seat);
      for (const damages of shapes) {
        const state = withBench(base, seat, damages);
        const all = conditionHolds(state, seat, ALL);
        const any = conditionHolds(state, seat, ANY);
        expect(!all || any, `${seat} ${damages.join("/")}`).toBe(true);
      }
    }
    // And the sweep really does contain a board where they DISAGREE, or "∀ ⟹ ∃"
    // would be satisfied by a member that is never true at all.
    const partial = withBench(ready(7105), "p1", [10, 0]);
    expect(conditionHolds(partial, "p1", ANY)).toBe(true);
    expect(conditionHolds(partial, "p1", ALL)).toBe(false);
  });
});

describe("§3 — the near miss: `.every` against `.some`, on ONE board", () => {
  it("🛑 two benched bodies, ONE damaged — the existential TRUE, the universal FALSE", () => {
    // THE BOARD D369's HANDOFF ORDERED. One method call apart, so the only thing that
    // can tell the two members apart is a bench that is PARTLY damaged.
    const state = withBench(ready(7200), "p1", [10, 0]);
    expect(state.players.p1.bench.map((p) => p.damage)).toEqual([10, 0]);
    expect(conditionHolds(state, "p1", ANY)).toBe(true);
    expect(conditionHolds(state, "p1", ALL)).toBe(false);
    expect(damageDealt(state)).toBe(10);

    // Damage the second body and the universal flips while the existential does not
    // move — which is what makes the pair a discrimination rather than a coincidence.
    const both = setBenchDamage(state, "p1", 1, 10);
    expect(conditionHolds(both, "p1", ANY)).toBe(true);
    expect(conditionHolds(both, "p1", ALL)).toBe(true);
    expect(damageDealt(both)).toBe(130);
  });

  it("🛑 the ZONE is the Bench: the Active's damage is invisible to it, either way", () => {
    // The printed word is "Benched". A damaged ACTIVE over an all-damaged bench must
    // not change the answer, and — the direction that actually costs — a damaged
    // Active must not RESCUE a bench holding an undamaged body.
    const undamagedBench = withBench(ready(7201), "p1", [0]);
    const active = undamagedBench.players.p1.active;
    if (active === null) throw new Error("p1 has no Active Pokémon");
    const hurtActive: GameState = {
      ...undamagedBench,
      players: {
        ...undamagedBench.players,
        p1: { ...undamagedBench.players.p1, active: { ...active, damage: 50 } },
      },
    };
    expect(hurtActive.players.p1.active?.damage).toBe(50);
    expect(conditionHolds(hurtActive, "p1", ALL)).toBe(false);
    expect(damageDealt(hurtActive)).toBe(10);
    // …and the other way: an all-damaged bench under an UNDAMAGED Active is TRUE.
    const allDamaged = withBench(ready(7202), "p1", [10]);
    expect(allDamaged.players.p1.active?.damage).toBe(0);
    expect(conditionHolds(allDamaged, "p1", ALL)).toBe(true);
    expect(damageDealt(allDamaged)).toBe(130);
  });

  it("🛑 the SEAT is yours: the opponent's bench cannot arm or disarm it", () => {
    // `withBench` on the OTHER seat only. P1's own bench is empty, so the member is
    // false; filling the opponent's bench with damaged bodies must not move it, and
    // an opponent's UNDAMAGED bench must not falsify an all-damaged one of yours.
    const theirs = withBench(ready(7203), "p2", [10, 10]);
    expect(theirs.players.p2.bench).toHaveLength(2);
    expect(conditionHolds(theirs, "p1", ALL)).toBe(false);
    expect(conditionHolds(theirs, "p2", ALL)).toBe(true);

    const mine = withBench(withBench(ready(7204), "p1", [10]), "p2", [0, 0]);
    expect(conditionHolds(mine, "p1", ALL)).toBe(true);
    expect(conditionHolds(mine, "p2", ALL)).toBe(false);
    expect(damageDealt(mine)).toBe(130);
  });

  it("🛑 'at least 1' is 1 DAMAGE COUNTER, i.e. any damage at all — not a threshold", () => {
    // The printed "at least 1 damage counter" is the game's way of writing "any", and
    // a counter is 10 HP. So 10 satisfies it and 0 does not, and there is nothing
    // between them to get wrong — which is the argument for a LITERAL row rather than
    // a `at least (\d+)` template, since a template would accept a threshold the
    // catalog never prints and answer it with this member.
    const one = withBench(ready(7205), "p1", [10]);
    expect(conditionHolds(one, "p1", ALL)).toBe(true);
    const none = withBench(ready(7206), "p1", [0]);
    expect(conditionHolds(none, "p1", ALL)).toBe(false);
    const many = withBench(ready(7207), "p1", [50]);
    expect(conditionHolds(many, "p1", ALL)).toBe(true);
  });
});

describe("§4 — the clause row and the note: an EXACT round trip, and a refusal beside it", () => {
  it("maps the printed sentence onto the new member at the printed 120", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: { kind: "yourBenchAllDamaged" } },
    });
  });

  it("🛑 the EXISTENTIAL sentence still resolves to the EXISTENTIAL member", () => {
    // The row this slice adds sits directly beside D116's and the keys differ by five
    // printed words. Keys are whole printed clauses and never substrings, so neither
    // can reach the other — driven, because "the table has two rows" is not the claim.
    expect(deriveAttackDamageBonus(EXISTENTIAL_SENTENCE)).toEqual({
      per: 100,
      count: { kind: "boardCondition", cond: { kind: "yourBenchDamaged" } },
    });
    expect(deriveAttackDamageBonus(TAKEN)).not.toEqual(
      deriveAttackDamageBonus(EXISTENTIAL_SENTENCE),
    );
  });

  it("🛑 the note keeps the QUANTIFIER, and round-trips through the reader", () => {
    // `yourBenchDamaged`'s note turns the collective plural into "1 of"; this one must
    // not, because here the quantifier IS the content — a pill reading "your Benched
    // Pokémon have damage counters" would describe the SIBLING and mislead on exactly
    // the boards the two disagree about.
    expect(conditionNote(ALL)).toBe(TAKEN_CLAUSE);
    expect(conditionNote(ALL)).not.toBe(conditionNote(ANY));
    // It happens to be byte-identical to the table key, so it round-trips — which is
    // NOT true of every member (D372's drops a printed pronoun and deliberately does
    // not), and is asserted here rather than assumed for the family.
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(ALL)}, this attack does 120 more damage.`),
    ).toEqual({ per: 120, count: { kind: "boardCondition", cond: ALL } });
  });

  it("🛑 the neighbouring universals the catalog does NOT print stay refused", () => {
    // The row is a LITERAL and the anchor is the whole sentence, so plausible
    // paraphrases of the same idea must find no reader at all. If one of these ever
    // resolves, a template has been introduced where a row was measured to be right.
    for (const near of [
      "If all of your Benched Pokémon have at least 2 damage counters on them, this attack does 120 more damage.",
      "If all of your Pokémon have at least 1 damage counter on them, this attack does 120 more damage.",
      "If all of your opponent's Benched Pokémon have at least 1 damage counter on them, this attack does 120 more damage.",
      "If all of your Benched Pokémon have at least 1 damage counter on them, this attack does 120 less damage.",
    ]) {
      expect(resolvedByAnyReader(near), near).toBe(false);
    }
    // …and the taken sentence is resolved, so the loop above is a statement about
    // those four strings rather than about the reader being asleep.
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
  });
});
