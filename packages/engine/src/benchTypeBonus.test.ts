import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "./censusAttackCorpus";
import type { PokemonType } from "./effects";
import {
  POKEMON_TYPES,
  POKEMON_TYPE_BY_CODE,
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
  BENCH_TYPE_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 🆕🆕 D370 — THE BENCH-SCOPED TYPE CLAUSE, AND THE VOCABULARY CHECK RUN BEFORE
// ANYTHING WAS SPELLED.
//
// D369 handed over *"you have any {M} Pokémon on your Bench"* — 2 legal printings,
// the cheapest of the EIGHT clauses its own §1 left pinned in the residue's
// 2-printing band — with two instructions ahead of the build: run the VOCABULARY
// question first (*"is the captured token a real `Card.types` value?"*, the
// question that killed three candidates at D368), and RE-DERIVE the `needs` column
// against the union rather than inheriting "one new member" (D199's rule, which
// D207 paid for).
//
// ✅ **VOCABULARY: THE TOKEN PASSES AND ITS NEIGHBOUR FAILS** (§2).
// `POKEMON_TYPE_BY_CODE["M"]` is `"Metal"`; `Tera` is not a `Card.types` value at
// all (D207: every occurrence of that banner is DEMAND, the SUPPLY side absent) —
// and *"you have any Tera Pokémon on your Bench"* is the IDENTICAL sentence one
// token over, at 1 legal printing. **THE SAME TEMPLATE THAT BUYS THE ONE MUST
// REFUSE THE OTHER**, so the refusal is a rung and not a comment.
//
// ✅ **`needs` RE-DERIVED, AND BOTH WIDENINGS DECLINED ON BOARDS** (§1, §5). Two
// members come close and neither can be widened into this one: `opponentActiveHasType`
// reads the same FIELD on the wrong body (widening it is a RENAME, and its second
// axis turns a lookup into a quantifier), and `yourBenchHasNamed` reads the same
// ZONE on the wrong FIELD (one vocabulary OPEN, one CLOSED).
//
// 🛑 **AND THE NARROW ZONE IS LOAD-BEARING IN A WAY IT IS NOT FOR THE BENCH COUNT.**
// Both printings are on METAL attackers, so an "in play" reading would satisfy the
// clause off the attacker's own type and make the +80 unconditional on every board.
// It is D279's Falinks refutation with a TYPE where that one had a NAME, and §5
// refutes it on a board — which is why `fix-benchtype` is deliberately `Metal`.
//
// WHAT SHIPS: 1 new `BoardCondition` member (`yourBenchHasType { type }`), its 2
// reader arms and 1 new anchored PATTERN reusing `CLAUSE_POKEMON_TYPES` whole.
// ZERO new vocabulary, zero new maps and zero new clause-table rows.
//
// ⚠️ **AND ONE THING FOUND ON THE WAY PAST, RECORDED MEASURED RATHER THAN GUESSED**
// (§6): *"If your opponent's Active Pokémon is a {N} Pokémon, it is now
// Paralyzed."* — **2 legal printings** — carries an antecedent this family ALREADY
// reads and a CONSEQUENT no skeleton spells. It surfaced because a figure in §3 was
// written at 3 and MEASURED at 5, which is the second guessed number in this file
// to go red before it was trusted.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/** The nine live readers, run as one — the same set `censusAtHead.test.ts` and
    `opponentToolBonus.test.ts` use. */
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
const TAKEN = "If you have any {M} Pokémon on your Bench, this attack does 80 more damage.";
const TAKEN_CLAUSE = "you have any {M} Pokémon on your Bench";

/** THE TRAP — the identical sentence one TOKEN over, in the corpus at 1 printing,
    and refused because `Tera` is not a type. */
const TRAP = "If you have any Tera Pokémon on your Bench, this attack does 100 more damage.";
const TRAP_CLAUSE = "you have any Tera Pokémon on your Bench";

const METAL: BoardCondition = { kind: "yourBenchHasType", type: "Metal" };

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: BENCH_TYPE_DECK, p2: BENCH_TYPE_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** The seat's opposite. Spelled once here rather than imported, because the member
    is seat-relative and every board case below names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

/** `fix-benchtype` in `seat`'s Active Spot with the `{C}` paid, a 200 HP body
    across the table, and BOTH benches EMPTY — each case then benches exactly the
    bodies it is about. `board` opens P1's turn, so a P2 case passes once more: a
    p1-only suite cannot tell "reads YOUR Bench" apart from "reads p1's". */
function ready(seed: number, seat: Seat = "p1", attacker = "fix-benchtype"): GameState {
  let state = board(seed);
  if (seat === "p2") state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = setActiveFromDeck(state, seat, attacker);
  state = attachFromDeck(state, seat, "fix-energy", 1);
  state = setActiveFromDeck(state, other(seat), "fix-bigbody");
  return clearBench(clearBench(state, seat), other(seat));
}

function benched(state: GameState, seat: Seat, ...ids: readonly string[]): GameState {
  let next = state;
  for (const id of ids) next = benchFromDeck(next, seat, id);
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

/** TEST SURGERY, local to this file: push a card from `seat`'s deck onto the TOP
    of bench[index]'s stack, so the benched body's IDENTITY (§1.2) is the pushed
    card while the card underneath is unchanged. Every uid stays in exactly one
    zone. It exists to drive the `topCardOf` read directly — a real evolution
    needs an `evolvesFrom` chain these synthetic bodies do not carry, and the
    reader's claim is about the stack TOP rather than about how it got there. */
function pushOnBench(state: GameState, seat: Seat, index: number, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  const body = side.bench[index];
  if (uid === undefined) throw new Error(`${seat} deck has no ${cardId}`);
  if (body === undefined) throw new Error(`${seat} has no benched Pokémon at ${index}`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        bench: side.bench.map((p, i) => (i === index ? { ...p, stack: [...p.stack, uid] } : p)),
      },
    },
  };
}

describe("§1 — the price, RE-DERIVED: the `needs` column and the band, not the handoff's words", () => {
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

  it("🛑 the residue steps by exactly this sentence, and the 2-printing band by exactly one", () => {
    // D369 left the residue at 32 / 42 and pinned EIGHT clauses at 2 printings. Both
    // figures are re-derived here off the same instrument — the nine live readers
    // over `legalAttackCorpus()` — rather than quoted.
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    // The DEPARTURE and the SIZE are asserted separately: a guard that only checked
    // 31 / 40 could not tell "the template landed" from "a reader broke".
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    // 🆕🆕 D372 — 30 / 38 -> **28 / 36**: D372 took the CROSS-BOARD EQUAL-ENERGY
    // clause this file's own band named among the six (`sameEnergyBonus.test.ts`),
    // and it is printed under TWO sentences at 1 printing each — so this head falls
    // by 2 in BOTH terms where the three slices before it fell by 1 and 2. Each
    // earlier figure still comes back off the live head rather than being frozen.
    // 🆕🆕 D373 — 28 / 36 -> 27 / 34: the UNIVERSAL-OVER-THE-BENCH clause left the
    // residue (1 sentence / 2 printings), re-derived live rather than decremented.
    // 🆕🆕 D374 — 27 / 34 -> 26 / 32: the NAMED-ENERGY clause left the residue
    // (1 sentence / 2 printings), re-derived live rather than decremented.
    // 🆕🆕 D375 — 26 / 32 -> 25 / 30: the CROSS-BOARD TYPE INTERSECTION left it,
    // the same 1:2 step, re-derived live rather than decremented.
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
    // D371's recorded residue, then D370's, then D369's, re-derived from THIS head:
    // add the sentences back rather than freezing the pair that measured them.
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

    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    // 🆕🆕 D372 — FIVE at 2 printings now: this file left SIX and D372 bought the
    // CROSS-BOARD EQUAL-ENERGY one out of them. The list is spelled out so a
    // successor inherits the tie-break MEASURED. Every one of them is a different
    // mechanism.
    // 🆕🆕 D374 — FOUR -> THREE: D374 bought the NAMED-ENERGY clause out of the band,
    // and the list is re-derived live rather than edited down.
    // 🆕🆕 D375 — THREE -> TWO: the CROSS-BOARD TYPE INTERSECTION was bought out of
    // it, and this file's §5 is where its dual-type refutation lives.
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
    expect(band.length + 3).toBe(3);
    expect(band.length + 4).toBe(4);
    expect(band.length + 5).toBe(5);
    expect(band.length + 6).toBe(6);
    expect(band.length + 7).toBe(7);
    expect(band.length + 8).toBe(8);
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

  it("the taken sentence is 2 legal printings, and that is ALL of them", () => {
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(2);
    // ONE record, because the corpus is a `GROUP BY` over distinct sentences.
    expect(corpus().filter(([, s]) => s === TAKEN)).toHaveLength(1);
    // ⚠️ THE IDS BEHIND THOSE TWO PRINTINGS ARE NOT RECORDED, DELIBERATELY — D369's
    // finding, unchanged: this container has no D1 credentials (`bunx wrangler d1
    // execute` returns `CLOUDFLARE_API_TOKEN` unset), so they could not be read and
    // are NOT guessed. Nothing on this path needs them: a TEMPLATE is keyed on the
    // printed shape, so it serves every printing of it in every set — and the other
    // ten types the day one is printed.
  });

  it("🛑 the `needs` column: NO existing member answers this, and the two near ones DISAGREE", () => {
    // D199's rule, driven rather than listed. ONE board — a Metal body on your
    // Bench, a Colorless body across the table — and the three members that read
    // either the FIELD or the ZONE this one needs. Each answers a different
    // question, and the answers separate on this board.
    const state = benched(ready(6300), "p1", "fix-metalbody");
    expect(conditionHolds(state, "p1", METAL)).toBe(true);
    // Same FIELD, wrong body: the opponent's Active is `fix-bigbody`, Colorless.
    expect(
      conditionHolds(state, "p1", { kind: "opponentActiveHasType", type: "Metal" }),
    ).toBe(false);
    // Same ZONE, wrong field: the benched body's NAME is not a type and never was.
    expect(
      conditionHolds(state, "p1", { kind: "yourBenchHasNamed", name: "Metal" }),
    ).toBe(false);
    // Same ZONE, no field at all — and a COUNT cannot stand in, which the next two
    // lines prove rather than assert: swap the benched body for a Fairy one and the
    // count is unchanged while this member flips.
    expect(conditionHolds(state, "p1", { kind: "yourBenchAtLeast", count: 1 })).toBe(true);
    const wrongType = benched(ready(6301), "p1", "fix-fairybody");
    expect(conditionHolds(wrongType, "p1", { kind: "yourBenchAtLeast", count: 1 })).toBe(true);
    expect(conditionHolds(wrongType, "p1", METAL)).toBe(false);
  });
});

describe("§2 — THE VOCABULARY CHECK, run FIRST: one token passes and its neighbour fails", () => {
  it("🛑 `{M}` resolves to a real `Card.types` value and `Tera` resolves to nothing", () => {
    // The question D369 ordered ahead of the build, answered in the one line it
    // takes. `POKEMON_TYPE_BY_CODE` is the map D234 built and D367 spread into
    // `CLAUSE_POKEMON_TYPES`, so this is the SAME vocabulary the template consults.
    expect(POKEMON_TYPE_BY_CODE.M).toBe("Metal");
    expect((POKEMON_TYPES as readonly string[]).includes("Metal")).toBe(true);
    // …and the banner sitting one token away is not in it, in EITHER notation.
    expect((POKEMON_TYPES as readonly string[]).includes("Tera")).toBe(false);
    expect(Object.values(POKEMON_TYPE_BY_CODE)).not.toContain("Tera");
  });

  it("🛑 both sentences are REAL and in the corpus — the trap is printed, not invented", () => {
    // The refusal below is worth something only because the catalog prints the
    // sentence it refuses. Both are here, one at 2 printings and one at 1.
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(2);
    expect(units(corpus().filter(([, s]) => s === TRAP))).toBe(1);
    // And they are the WHOLE population of this clause shape: the template's
    // vocabulary is the only thing standing between them.
    const shaped = corpus().filter(([, s]) => /^If you have any .+ Pokémon on your Bench, /.test(s));
    expect(shaped.map(([, s]) => s).sort()).toEqual([TRAP, TAKEN].sort());
  });

  it("🛑 the trap is refused by the MAP, not by the anchor — and stays LOUD", () => {
    // THE DISTINCTION THAT MAKES THIS A RUNG. The template MATCHES the trap
    // sentence — it is the same shape — and the capture then misses the vocabulary.
    // So the sentence falls through to null and stays on the loud
    // ATTACK_EFFECT_SKIPPED path, rather than deriving a bonus that can never pay.
    expect(BONUS.test(TRAP)).toBe(true);
    expect(deriveAttackDamageBonus(TRAP)).toBeNull();
    expect(resolvedByAnyReader(TRAP)).toBe(false);
    // …while the taken sentence, one token over, resolves.
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
    // A `(Grass|Fire|…)` alternation in the pattern would give the same answer here
    // TODAY and rot the day a type is added to the schema. That the refusal is the
    // MAP's is what this asserts: every one of the eleven types resolves, in BOTH
    // notations, off the same pattern that just refused `Tera`.
    for (const type of POKEMON_TYPES) {
      expect(
        deriveAttackDamageBonus(`If you have any ${type} Pokémon on your Bench, this attack does 80 more damage.`),
        type,
      ).toEqual({ per: 80, count: { kind: "boardCondition", cond: { kind: "yourBenchHasType", type } } });
    }
    for (const [code, type] of Object.entries(POKEMON_TYPE_BY_CODE)) {
      expect(
        deriveAttackDamageBonus(`If you have any {${code}} Pokémon on your Bench, this attack does 80 more damage.`),
        code,
      ).toEqual({ per: 80, count: { kind: "boardCondition", cond: { kind: "yourBenchHasType", type } } });
    }
  });
});

describe("§3 — the template: N from the sentence, and a round trip across NOTATIONS", () => {
  it("maps the printed sentence onto the new member at the printed 80", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 80,
      count: { kind: "boardCondition", cond: METAL },
    });
  });

  it("takes N FROM THE SENTENCE, not from the card", () => {
    for (const per of [10, 30, 250]) {
      expect(
        deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does ${per} more damage.`),
      ).toEqual({ per, count: { kind: "boardCondition", cond: METAL } });
    }
    // A printed 0 adds nothing — the guard every arm in this family carries, so the
    // sentence stays LOUD rather than deriving a no-op bonus.
    expect(
      deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does 0 more damage.`),
    ).toBeNull();
  });

  it("🛑 `conditionNote` is NOT the clause key — and re-derives to the member anyway", () => {
    // D118's rule: the note spells the prose NAME, because a reject pill and a HUD
    // tooltip are read off the board by a person and `{M}` is a card-face glyph. So
    // this note does NOT round-trip to the printed bytes…
    expect(conditionNote(METAL)).toBe("you have any Metal Pokémon on your Bench");
    expect(conditionNote(METAL)).not.toBe(TAKEN_CLAUSE);
    // …and it DOES round-trip to the same MEMBER, through the map's spelled-out
    // half. **THIS PROPERTY DID NOT EXIST BEFORE D367**, which taught
    // `CLAUSE_POKEMON_TYPES` the brace notation: before it, the note's re-derivation
    // would have missed and the sentence gone LOUD.
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(METAL)}, this attack does 80 more damage.`)?.count,
    ).toEqual({ kind: "boardCondition", cond: METAL });
    // And it holds for every type, both directions, which is what makes it a
    // property of the TEMPLATE rather than a fact about Metal.
    for (const type of POKEMON_TYPES) {
      const cond: BoardCondition = { kind: "yourBenchHasType", type };
      expect(
        deriveAttackDamageBonus(`If ${conditionNote(cond)}, this attack does 40 more damage.`)?.count,
        type,
      ).toEqual({ kind: "boardCondition", cond });
    }
  });

  it("🛑 the SIBLING template's note was found NOT round-tripping to the bytes either", () => {
    // The stale comment this slice corrected, asserted rather than described.
    // `conditionNote`'s `opponentActiveHasType` arm claimed the note "round-trips to
    // the printed clause … the type word is the same token the sentence carried in".
    // D367 falsified that by teaching the map brace codes, and the catalog prints
    // THREE legal printings that show it.
    const bracePrinted = corpus().filter(([, s]) =>
      /^If your opponent's Active Pokémon is a \{[A-Z]\} Pokémon, /.test(s),
    );
    // FIVE printings carry the brace-coded antecedent, and only THREE of them are
    // under this consequent — a figure this rung was written at 3 and MEASURED at 5,
    // which is the second time in this file a guessed number went red before it was
    // trusted. The other two are §6's finding.
    expect(units(bracePrinted)).toBe(5);
    const braceBonus = bracePrinted.filter(([, s]) => BONUS.test(s.trim()));
    expect(units(braceBonus)).toBe(3);
    const cond: BoardCondition = { kind: "opponentActiveHasType", type: "Psychic" };
    expect(deriveAttackDamageBonus(
      "If your opponent's Active Pokémon is a {P} Pokémon, this attack does 30 more damage.",
    )).toEqual({ per: 30, count: { kind: "boardCondition", cond } });
    // The note answers the NAME, not the printed glyph — right answer, stale claim.
    expect(conditionNote(cond)).toBe("your opponent's Active Pokémon is a Psychic Pokémon");
    expect(conditionNote(cond)).not.toContain("{P}");
    // …and re-derives to the same member, which is the claim that survived.
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(cond)}, this attack does 30 more damage.`)?.count,
    ).toEqual({ kind: "boardCondition", cond });
  });

  it("pins the BYTES — a lookalike character would un-map the clause silently", () => {
    // 75 code points; the clause inside it is 38. The é in "Pokémon" is the
    // character this rung exists for — two UTF-8 bytes, one code point, and a
    // decomposed spelling would read identically in a diff.
    expect(TAKEN.length).toBe(75);
    expect(TAKEN_CLAUSE.length).toBe(38);
    expect(TAKEN).toContain("é");
    expect(TAKEN).not.toContain("́");
    // The braces are the catalog's notation and are NOT regex syntax here — the
    // capture is `(.+)` and the map holds the literal `{M}`.
    expect(TAKEN_CLAUSE).toContain("{M}");
    // NO apostrophe anywhere in this sentence, which is why `literalClauseRow`'s
    // fold is not on this path at all: the template is handed the RAW clause and
    // carries no `['’]` slot because there is nothing to class (D137's separation).
    expect(TAKEN).not.toContain("'");
    expect(TAKEN).not.toContain("’");
  });
});

describe("§4 — the near-misses stay LOUD, and the siblings are untouched", () => {
  it("refuses CONSTRUCTED rewrites of the clause — the shape is char-for-char", () => {
    for (const clause of [
      // The TRAP, first: a real printed sentence, refused at the map.
      TRAP_CLAUSE,
      // Not a type at all, and each of these is a real printed word elsewhere.
      "you have any Basic Pokémon on your Bench",
      "you have any Stage 2 Pokémon on your Bench",
      "you have any Pokémon ex on your Bench",
      // The other ZONE — "in play" is `yourNamedPokemonInPlay`'s printed word, and
      // reading it here is the exact widening §5 refutes on a board.
      "you have any {M} Pokémon in play",
      // The other SEAT.
      "your opponent has any {M} Pokémon on your Bench",
      "you have any {M} Pokémon on your opponent's Bench",
      // A COUNT rather than an existential — a different member, unbuilt.
      "you have 2 or more {M} Pokémon on your Bench",
      // The Active Spot, which the printed word "Bench" excludes.
      "you have any {M} Pokémon in your Active Spot",
      // De-accented: the exact silent failure the byte guard above exists for.
      "you have any {M} Pokemon on your Bench",
      // The brace stripped — `M` alone is not a key in either half of the map.
      "you have any M Pokémon on your Bench",
      // An ENERGY notation borrowed onto a body: D118's clause reads "Energy".
      "you have any {M} Energy on your Bench",
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

  it("🛑 the two SIBLING templates still answer their own sentences — nothing was re-pointed", () => {
    // The clause pattern was appended LAST, and the three patterns are mutually
    // exclusive at their anchors. Both siblings are driven here so "appended last"
    // is a measured fact rather than a claim about ordering.
    expect(deriveAttackDamageBonus(
      "If this Pokémon has any {R} Energy attached, this attack does 90 more damage.",
    )).toEqual({
      per: 90,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourActiveHasEnergyAttached", energy: "Fire" },
      },
    });
    expect(deriveAttackDamageBonus(
      "If your opponent's Active Pokémon is a Dragon Pokémon, this attack does 90 more damage.",
    )).toEqual({
      per: 90,
      count: {
        kind: "boardCondition",
        cond: { kind: "opponentActiveHasType", type: "Dragon" },
      },
    });
    // …and the LITERAL table still wins first: the Bench clause keyed by NAME is a
    // row, and this template's anchor cannot reach it.
    expect(deriveAttackDamageBonus(
      "If Durant is on your Bench, this attack does 20 more damage.",
    )).toEqual({
      per: 20,
      count: { kind: "boardCondition", cond: { kind: "yourBenchHasNamed", name: "Durant" } },
    });
  });
});

describe("§5 — driven on boards: the Bench decides it, and the ACTIVE SPOT never does", () => {
  it("a {M} body on your Bench pays the +80 — 10 + 80", () => {
    const state = benched(ready(6310), "p1", "fix-metalbody");
    expect(damageDealt(state)).toBe(90);
  });

  it("an EMPTY Bench pays the printed base and nothing more", () => {
    const state = ready(6311);
    expect(state.players.p1.bench).toHaveLength(0);
    expect(conditionHolds(state, "p1", METAL)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("🛑 THE ATTACKER IS ITSELF {M} AND ARMS NOTHING — 'Bench' is not 'in play'", () => {
    // THE BOARD THIS WHOLE FIXTURE EXISTS FOR, and D279's Falinks refutation with a
    // TYPE instead of a NAME. `fix-benchtype` is Metal and is in the ACTIVE SPOT
    // with an EMPTY Bench: an `[side.active, ...side.bench]` reading would be TRUE
    // and the +80 would be unconditional on every board this card ever sees.
    const alone = ready(6312);
    const topUid = alone.players.p1.active?.stack.at(-1) ?? "";
    expect(alone.cardIdByUid[topUid]).toBe("fix-benchtype");
    expect(alone.players.p1.active?.stack).toHaveLength(1);
    expect(conditionHolds(alone, "p1", METAL)).toBe(false);
    expect(damageDealt(alone)).toBe(10);
    // …and the SAME board with a second Metal body benched pays the bonus, so the
    // false above is the ZONE and not a broken predicate.
    const paired = benched(ready(6313), "p1", "fix-metalbody");
    expect(conditionHolds(paired, "p1", METAL)).toBe(true);
    expect(damageDealt(paired)).toBe(90);
  });

  it("🛑 a DUAL-TYPED body arms it — `.includes`, never `types[0] ===`", () => {
    // `fix-dualbody` is `["Water", "Metal"]`, so an equality on the first element
    // answers Water and misses. Dual types are a real printing and the union member
    // says so; nothing but this board can tell the two readings apart.
    const state = benched(ready(6314), "p1", "fix-dualbody");
    expect(state.players.p1.bench[0]).toBeDefined();
    expect(conditionHolds(state, "p1", METAL)).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "yourBenchHasType", type: "Water" })).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "yourBenchHasType", type: "Fairy" })).toBe(false);
    expect(damageDealt(state)).toBe(90);
  });

  it("a REAL but WRONG type arms nothing, and neither does a DEFAULTED one", () => {
    // Two distinct false cases, because "no type written on the fixture" and "a type
    // written that does not match" are different boards: `fix-fairybody` is Fairy by
    // declaration and `fix-benchfiller` is Colorless by `printedTypesOf`'s default.
    const fairy = benched(ready(6315), "p1", "fix-fairybody");
    expect(conditionHolds(fairy, "p1", METAL)).toBe(false);
    expect(damageDealt(fairy)).toBe(10);
    const filler = benched(ready(6316), "p1", "fix-benchfiller");
    expect(conditionHolds(filler, "p1", METAL)).toBe(false);
    expect(conditionHolds(filler, "p1", { kind: "yourBenchHasType", type: "Colorless" })).toBe(
      true,
    );
    expect(damageDealt(filler)).toBe(10);
  });

  it("ONE match among many is enough — the printed word is 'any'", () => {
    // An existential over the whole Bench, not over slot 0: the Metal body is last.
    const state = benched(ready(6317), "p1", "fix-fairybody", "fix-benchfiller", "fix-metalbody");
    expect(state.players.p1.bench).toHaveLength(3);
    expect(conditionHolds(state, "p1", METAL)).toBe(true);
    expect(damageDealt(state)).toBe(90);
  });

  it("🛑 the identity is the STACK TOP (§1.2) — an evolved body stops arming it", () => {
    // `yourBenchHasNamed`'s rule, on the type field. A Metal body with a Fairy card
    // pushed on top is a FAIRY Pokémon; reading `stack[0]` would still answer Metal.
    let state = benched(ready(6318), "p1", "fix-metalbody");
    expect(conditionHolds(state, "p1", METAL)).toBe(true);
    state = pushOnBench(state, "p1", 0, "fix-fairybody");
    expect(state.players.p1.bench[0]?.stack).toHaveLength(2);
    expect(conditionHolds(state, "p1", METAL)).toBe(false);
    expect(conditionHolds(state, "p1", { kind: "yourBenchHasType", type: "Fairy" })).toBe(true);
    expect(damageDealt(state)).toBe(10);
  });

  it("🛑 it reads the OPPONENT's Bench as FALSE — the seat is half the member", () => {
    // A Metal body on the OTHER side of the table arms nothing. Without this the
    // predicate could be reading "either Bench" and every case above would pass.
    const state = benched(ready(6319), "p2", "fix-metalbody");
    expect(state.players.p2.bench).toHaveLength(1);
    expect(state.players.p1.bench).toHaveLength(0);
    expect(conditionHolds(state, "p1", METAL)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("answers from BOTH seats — it reads the Bench OF `seat`, not p1's", () => {
    // A p1-only suite cannot tell "reads YOUR Bench" apart from "reads p1's Bench".
    const state = benched(ready(6320, "p2"), "p2", "fix-metalbody");
    expect(damageDealt(state, "p2")).toBe(90);
    for (const seat of ["p1", "p2"] as const) {
      expect(conditionHolds(state, seat, METAL), seat).toBe(seat === "p2");
    }
  });

  it("the parameter is carried, not fixed — the same board answers 11 questions", () => {
    // The member is PARAMETERISED, so the board must answer differently per type.
    // Exactly one of the eleven is true on a single-Metal Bench.
    const state = benched(ready(6321), "p1", "fix-metalbody");
    const held = POKEMON_TYPES.filter((type: PokemonType) =>
      conditionHolds(state, "p1", { kind: "yourBenchHasType", type }),
    );
    expect(held).toEqual(["Metal"]);
  });
});

describe("§6 — the census, and a 2-printing sentence this slice found on the way past", () => {
  it("🛑 the corpus totals STAND STILL — this slice adds no catalog row", () => {
    // The population is a committed transcription and this slice does not touch it.
    // Asserted here because every figure in §1 is a fraction of it: a corpus that
    // moved would make the residue step look like a reader change.
    expect(corpus().length).toBe(640);
    expect(units(corpus())).toBe(1732);
  });

  it("🛑 THE ANTECEDENT THIS FAMILY ALREADY READS IS PRINTED UNDER A CONSEQUENT D472 BUILT", () => {
    // Found by widening §3's regex past the bonus skeleton, and it is the kind of
    // thing a successor should inherit MEASURED. *"If your opponent's Active Pokémon
    // is a {N} Pokémon, it is now Paralyzed."* — **2 legal printings** — carries the
    // SAME antecedent `OPPONENT_ACTIVE_TYPE_CLAUSE` has read since D120 and `{N}` is
    // a vocabulary entry `POKEMON_TYPE_BY_CODE` has held since D234 (`N` → Dragon).
    // What it lacked was a CONSEQUENT: no skeleton in this family spelled
    // *"…, it is now <Special Condition>."*, so all thirteen readers refused it.
    //
    // 🆕🆕 **D472 BUILT IT, AND THIS RUNG IS RE-POINTED RATHER THAN DELETED OR
    // FLIPPED TO A BOOLEAN (D418/D438/D444/D447).** The old rung was
    // `resolvedByAnyReader(…) === false` — a THIRTEEN-WAY refusal that reddens if any
    // one of thirteen readers is ever widened onto this string. Re-pointing it to
    // `=== true` would have discarded all thirteen at once, because that claim is
    // satisfied by a mistaken widening and by the real build alike: **that is exactly
    // how D436 disarmed D368's tripwire and produced this run's only GAP.** So the
    // replacement is D438's: name the OWNER by name AND keep the other twelve
    // refusing, which is strictly stronger in both directions than either boolean.
    //
    // ⚠️ **THE PRICE PARAGRAPH THAT STOOD HERE WAS RIGHT AND IS KEPT AS THE RECORD OF
    // A PREDICTION (D466).** It said *"a status consequent is a different reader with
    // its own anchor"* — it is one anchor and one arm on `deriveAttackEffect`, so the
    // reader was named correctly and the surface still stands still at 13 — and it
    // said the ANTECEDENT half costs zero new vocabulary, which is what made the row
    // cheap: `boardConditionForClause` resolves the whole clause and D472 adds no map
    // row, no `BoardCondition` member and no type token.
    const statusFamily = corpus().filter(([, s]) =>
      /^If your opponent's Active Pokémon is a .+ Pokémon, it is now /.test(s),
    );
    expect(statusFamily).toHaveLength(1);
    expect(statusFamily[0]?.[1]).toBe(
      "If your opponent's Active Pokémon is a {N} Pokémon, it is now Paralyzed.",
    );
    expect(units(statusFamily)).toBe(2);
    const printed = statusFamily[0]?.[1] ?? "";
    // THE OWNER, BY NAME AND BY VALUE — not `not.toBeNull()`, which a wrong-but-shaped
    // program satisfies too.
    expect(deriveAttackEffect(printed)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveHasType", type: "Dragon" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "applyStatus", target: "defender", status: "paralyzed" }],
      },
    ]);
    // …AND THE TWELVE REFUSALS THE OLD BOOLEAN CARRIED, KEPT. Every reader other than
    // the one named above still returns null on it, so a second reader widening onto
    // this string reddens here exactly as it would have before D472.
    for (const read of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(printed)).toBeNull();
    }
    // …and the antecedent inside it resolves TODAY, which is the half that is free.
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a {N} Pokémon, this attack does 30 more damage.",
      ),
    ).toEqual({
      per: 30,
      count: {
        kind: "boardCondition",
        cond: { kind: "opponentActiveHasType", type: "Dragon" },
      },
    });
  });
});
