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
import { resistanceOf, weaknessOf } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  FIXTURE_POOL,
  OPPONENT_RESISTANCE_DECK,
  attachFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 🆕🆕 D371 — THE OPPONENT-RESISTANCE CLAUSE, AND THE SHAPE QUESTION SETTLED
// BEFORE ANYTHING WAS SPELLED.
//
// D370 handed over *"your opponent's Active Pokémon has {F} Resistance"* — 2 legal
// printings, the cheapest of the SEVEN clauses its own §1 left pinned in the
// residue's 2-printing band — with two things ordered ahead of the build: run the
// SUPPLY check first (D207's rule; D370 owed the VOCABULARY half and had already
// run it), and settle a named SHAPE question before spelling a predicate (D368's
// ordering).
//
// ✅ **SUPPLY: THE FIELD IS INGESTED AND THE ENGINE ALREADY READS IT** (§2).
// D207's failure mode is a predicate over a banner no column CLASSIFIES —
// permanently empty candidate set, a card that can never be played. `resistances`
// is a real `Card` column and the §8.5 pipeline has read it since 0.1.x. ⚠️ The
// only population measurable in this container is `FIXTURE_POOL`, which is a
// FLOOR on a biased sample and is NOT promoted to a census: there are no D1
// credentials here, so the Standard-legal count is unmeasured and not guessed.
//
// 🛑 **THE SHAPE QUESTION, AND IT IS THE WHOLE MEMBER** (§5).
// `resistanceOf(attacker, defender)` returns a modifier ONLY when the defender's
// Resistance names one of the ATTACKER's types — §8.5 asks *"does this Resistance
// apply to THIS attack"*. The printed clause asks whether the defender HAS `{F}`
// Resistance, whoever is attacking. The two disagree on exactly one board and this
// file drives it: a METAL attacker against a FIGHTING-resistant defender, where
// the clause is TRUE (10 + 50 = 60) and `resistanceOf` is NULL. A member routed
// through the helper pays 10 there. `fix-oppresist` is Metal for that reason and
// `fix-oppresist-f` is the same attack on a Fighting body, where both fire and the
// dealt number is 10 + 50 − 30 = 30.
//
// ⚠️ **THE PREDICATE IS ON THE ENTRY'S `type` AND NOTHING ELSE.** `WeakRes.value`
// is optional in the schema and `weakResModifier` HONOURS an entry whose value it
// cannot parse (it falls back to −30), so an entry §8.5 cannot price is still a
// printed Resistance. `fix-dualresist` carries two entries with the matching one
// SECOND and value-less — the single body that separates `.some(…)` from
// `resistances[0]` and a `type`-only predicate from one that also reads `value`.
//
// WHAT SHIPS: 1 new `BoardCondition` member (`opponentActiveHasResistance
// { type }`), its 2 reader arms and 1 new anchored PATTERN reusing
// `CLAUSE_POKEMON_TYPES` whole. ZERO new vocabulary, zero new maps, zero new
// clause-table rows.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/** The nine live readers, run as one — the same set `censusAtHead.test.ts`,
    `opponentToolBonus.test.ts` and `benchTypeBonus.test.ts` use. */
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
  "If your opponent's Active Pokémon has {F} Resistance, this attack does 50 more damage.";
const TAKEN_CLAUSE = "your opponent's Active Pokémon has {F} Resistance";

const FIGHTING: BoardCondition = { kind: "opponentActiveHasResistance", type: "Fighting" };

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: OPPONENT_RESISTANCE_DECK, p2: OPPONENT_RESISTANCE_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** The seat's opposite. Spelled once here rather than imported, because the member
    is seat-relative and every board case below names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

/** `attacker` in `seat`'s Active Spot with the `{C}` paid, `defender` across the
    table, and BOTH benches EMPTY — nothing in this clause reads a Bench, and an
    empty one keeps the dealt number a statement about the two Active bodies.
    `board` opens P1's turn, so a P2 case passes once more: a p1-only suite cannot
    tell "reads YOUR OPPONENT's Active" apart from "reads p2's". */
function ready(
  seed: number,
  defender: string,
  attacker = "fix-oppresist",
  seat: Seat = "p1",
): GameState {
  let state = board(seed);
  if (seat === "p2") state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = setActiveFromDeck(state, seat, attacker);
  state = attachFromDeck(state, seat, "fix-energy", 1);
  state = setActiveFromDeck(state, other(seat), defender);
  return clearBench(clearBench(state, seat), other(seat));
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
    of the Active Spot's stack, so the Active body's IDENTITY is the pushed card
    while the card underneath is unchanged. Every uid stays in exactly one zone.
    It drives the `activeTop` read directly — a real evolution needs an
    `evolvesFrom` chain these synthetic bodies do not carry, and the reader's claim
    is about the stack TOP rather than about how it got there. */
function pushOnActive(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  const body = side.active;
  if (uid === undefined) throw new Error(`${seat} deck has no ${cardId}`);
  if (body === null) throw new Error(`${seat} has no Active Pokémon`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        active: { ...body, stack: [...body.stack, uid] },
      },
    },
  };
}

/** TEST SURGERY: empty an Active Spot. No legal action reaches this board — a seat
    with no Active has lost — but the member commits to answering FALSE there, and
    a commitment nothing drives is a comment. */
function emptyActive(state: GameState, seat: Seat): GameState {
  return {
    ...state,
    players: { ...state.players, [seat]: { ...state.players[seat], active: null } },
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
    // D370 left the residue at 31 / 40 and pinned SEVEN clauses at 2 printings.
    // Both figures are re-derived here off the same instrument — the nine live
    // readers over `legalAttackCorpus()` — rather than quoted.
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    // The DEPARTURE and the SIZE are asserted separately: a guard that only checked
    // 30 / 38 could not tell "the template landed" from "a reader broke".
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    // 🆕🆕 D372 — 30 / 38 -> **28 / 36**: D372 took the CROSS-BOARD EQUAL-ENERGY
    // clause this file's own band below named among the six, and that clause is
    // printed under TWO sentences at 1 printing each — so the SENTENCE term falls by
    // 2 where the PRINTING term falls by 2, and this file's head is re-derived from
    // the live corpus with each earlier figure coming back off it one term later.
    // 🆕🆕 D373 — 28 / 36 -> 27 / 34: the UNIVERSAL-OVER-THE-BENCH clause left the
    // residue (1 sentence / 2 printings), re-derived live rather than decremented.
    // 🆕🆕 D374 — 27 / 34 -> 26 / 32: the NAMED-ENERGY clause left the residue
    // (1 sentence / 2 printings), re-derived live rather than decremented.
    // 🆕🆕 D375 — 26 / 32 -> 25 / 30: the CROSS-BOARD TYPE INTERSECTION left it,
    // (1 sentence / 2 printings), re-derived live rather than decremented.
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
    // D371's recorded residue, then D370's, re-derived from THIS head: add the
    // sentences back rather than freezing the pair that measured them.
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

    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    // 🆕🆕 D372 — FIVE at 2 printings now: this file left SIX and D372 bought the
    // CROSS-BOARD EQUAL-ENERGY one out of them. Spelled out so a successor inherits
    // the tie-break MEASURED. Every one of them is a different mechanism.
    // 🆕🆕 D374 — FOUR -> THREE: D374 bought the NAMED-ENERGY clause out of the band,
    // and the list is re-derived live rather than edited down.
    // 🆕🆕 D375 — THREE -> TWO: the CROSS-BOARD TYPE INTERSECTION was bought out of
    // it, and the two survivors are the two D374's handoff had already PRICED.
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
    // …and it is the WHOLE population of this clause shape in the corpus: no other
    // sentence asks about a printed Resistance as a CONDITION. Every other
    // occurrence of the word is the §8.5 parenthetical ("Don't apply Weakness and
    // Resistance for Benched Pokémon.") or a suppression clause, and neither is
    // this skeleton.
    const shaped = corpus().filter(([, s]) =>
      /^If your opponent's Active Pokémon has .+ Resistance, /.test(s),
    );
    expect(shaped.map(([, s]) => s)).toEqual([TAKEN]);
    // ⚠️ THE IDS BEHIND THOSE TWO PRINTINGS ARE NOT RECORDED, DELIBERATELY — D369's
    // finding, unchanged at D371: this container has no D1 credentials (`bunx
    // wrangler d1 execute` returns `CLOUDFLARE_API_TOKEN` unset), so they could not
    // be read and are NOT guessed. Nothing on this path needs them: a TEMPLATE is
    // keyed on the printed shape, so it serves every printing of it in every set —
    // and the other ten types the day one is printed.
  });

  it("🛑 the `needs` column: NO member of this union reads a printed DEFENSIVE column", () => {
    // D199's rule, driven rather than listed. The near member reads the same BODY
    // through the same `activeTop` and a DIFFERENT column, and the two disagree on
    // one board: `fix-fightresist` is a COLORLESS body with a FIGHTING Resistance.
    const state = ready(7100, "fix-fightresist");
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(true);
    // Same body, the `types` column: Colorless, so the type member answers false
    // for Fighting and true for Colorless. Widening it to take a FIELD would be a
    // RENAME (D362: 31 sites across 7 files) and the two columns do not even have
    // the same shape — `string[]` against `{type, value?}[]`.
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasType", type: "Fighting" })).toBe(
      false,
    );
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasType", type: "Colorless" })).toBe(
      true,
    );
    // Same body, the attachment members: nothing is attached across the table.
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasToolAttached" })).toBe(false);
    // Same body, the class members: a plain Basic, neither ex nor V nor Evolution.
    expect(conditionHolds(state, "p1", { kind: "opponentActiveIsExOrV" })).toBe(false);
    expect(conditionHolds(state, "p1", { kind: "opponentActiveIsEvolution" })).toBe(false);
    // And the WEAKNESS column, one field over in the same schema, is the near miss
    // a wrong transcription lands on — `fix-fightweak` separates them below (§5).
    const weak = ready(7101, "fix-fightweak");
    expect(conditionHolds(weak, "p1", FIGHTING)).toBe(false);
  });
});

describe("§2 — THE SUPPLY CHECK, run FIRST: the column exists, and the floor is a FLOOR", () => {
  it("🛑 `Card.resistances` is a real ingested column the engine already reads", () => {
    // D207's question, asked before the predicate was designed: *name the field
    // before you design the predicate*. A predicate over a banner no column
    // CLASSIFIES yields a permanently empty candidate set — `Tera`'s shape, where
    // every occurrence is DEMAND and the SUPPLY side is absent. This is not that.
    // The column is on the schema, it is populated, and §8.5 has read it since
    // 0.1.x — `resistanceOf` is exported from the package index.
    const body = FIXTURE_POOL["fix-fightresist"];
    expect(body?.resistances).toEqual([{ type: "Fighting", value: "-30" }]);
    expect(typeof resistanceOf).toBe("function");
  });

  it("⚠️ the population is a FLOOR on a BIASED SAMPLE and is not promoted to a census", () => {
    // The honest statement of what this container can measure. `FIXTURE_POOL` is
    // the engine's hand-built pool — real printings AND `fix-*` bodies — so it is
    // evidence that the field is populated and is NOT a denominator. The
    // Standard-legal count of Fighting-resistant bodies is UNMEASURED here: no D1
    // credentials, no local sqlite catalog, and a guessed figure would be worth
    // less than an absence (D183's rule about a count with no population).
    const ids = Object.keys(FIXTURE_POOL);
    const withResistance = ids.filter((id) => (FIXTURE_POOL[id]?.resistances ?? []).length > 0);
    const fighting = ids.filter((id) =>
      (FIXTURE_POOL[id]?.resistances ?? []).some((r) => r.type === "Fighting"),
    );
    // 🆕🆕 D372 — 450 -> **453**, and the OTHER TWO COLUMNS STAND STILL. D372 adds
    // three bodies (`fix-sameenergy`, `fix-sameenergy-120`, `fix-energyholder`) and
    // none of them prints a Resistance, so the pool grows and the sample this rung
    // is actually about does not. **THAT IS THE FLOOR BEHAVING LIKE A FLOOR**: a
    // denominator that moved every time an unrelated fixture landed would be worth
    // even less than this one, and the two unmoved columns are what say so.
    // 🆕🆕 D373 — 453 -> **454**, and the other two columns stand still AGAIN: the
    // one body this slice adds (`fix-benchall`) prints no Resistance either.
    // 🆕🆕 D374 — 454 -> **457**, and the other two columns stand still a THIRD time.
    // D374 adds one body (`fix-trbonus`) and TWO Special ENERGY cards
    // (`fix-tr-other-energy`, `fix-not-tr-energy`), and `Card.resistances` is null on
    // every Energy in the catalog — so the pool grows by three and the sample this
    // rung is about does not move at all.
    // 🆕🆕 D375 — 457 -> **459**, and the other two columns stand still a FOURTH
    // time. D375 adds two bodies (`fix-typeshare`, `fix-bigfairy`) and neither prints
    // a Resistance — both are declared with `types` and nothing else, because the
    // column this slice reads is `Card.types`.
    // 🆕🆕 D376 — 459 -> **460**, and the other two columns stand still a FIFTH time.
    // D376 adds ONE body (`fix-emberpillar`) and no Energy at all — the four Energy
    // cards its boards need were already in the pool — and that one body prints no
    // Resistance, because the column this slice reads is the DISCARD PILE.
    // 🆕🆕 D377 — 460 -> **463**, and the other two columns stand still a SIXTH time.
    // D377 adds THREE bodies (`fix-roastheat`, `fix-mindcrush`, `fix-charbreath`) and
    // no Energy at all, and none of the three prints a Resistance — the column that
    // slice reads is `SpecialConditions` on the opponent's Active.
    // 🆕🆕 D378 — 463 -> **465**, and the other two columns stand still a SEVENTH time.
    // D378 adds TWO bodies (`fix-mountaindrop`, `fix-assaultland`) and no Energy at
    // all, and neither prints a Resistance — the column that slice reads is
    // `state.stadium`, which is not on a card at all.
    // 🆕🆕 D379 — 465 -> **466**, and the other two columns stand still an EIGHTH time.
    // D379 adds ONE body (`fix-triocheehoo`) and no Energy at all, and it prints no
    // Resistance — the column that slice reads is the attacker's own HAND LENGTH,
    // which is not on a card at all either.
    // 🆕🆕 D380 — 466 -> **468**, and the other two columns stand still a NINTH time.
    // D380 adds TWO bodies (`fix-blazedestruct`, `fix-knockover`) and no Energy at
    // all, and neither prints a Resistance — the column that slice reads is
    // `state.stadium`, which is not on a card at all. ⚠️ **AND THIS FLOOR MOVES ON
    // THE FIXTURE COUNT, NOT ON THE PRINTED TEXT** — the mirror of the apostrophe
    // census one file over, which moves on the CHARACTER and not on the count.
    // 🆕🆕 D381 — 468 -> **469**, and the other two columns stand still a TENTH time.
    // D381 adds ONE body (`fix-crushpress`, Cetitan ex's "Crushing Press") and no
    // Energy at all, and it prints no Resistance — the column that slice reads is
    // `state.stadium` again, which is not on a card at all. ⚠️ **AND THE ONE THING
    // THAT FIXTURE'S CARD DATA *IS* READ FOR IS ITS NAME**: `Fixceti ex` carries the
    // ex suffix so `isExOrV` sees it, which is a claim about `Card.name` and still
    // not about `Card.resistances`.
    // 🆕🆕 D382 — 469 -> **470**, and the other two columns stand still an ELEVENTH
    // time. D382 adds ONE body (`fix-groundmelter`, Chi-Yu's "Ground Melter") and no
    // Energy at all, and it prints no Resistance — the column that slice reads is
    // `state.stadium` for a THIRD consecutive slice, which is not on a card at all.
    // 🆕🆕 D383 — 470 -> **471**, and the other two columns stand still a TWELFTH
    // time. D383 adds ONE body (`fix-torrent`, Wellspring Mask Ogerpon ex's
    // "Torrential Pump") and no Energy at all, and it prints no Resistance — what
    // that slice reads off a card is the ATTACHED Energy COUNT (`InPlayPokemon.energy`,
    // a board array) rather than any printed column, so `Card.resistances` is
    // untouched for a FOURTH consecutive slice.
    // 🆕🆕 D384 — 471 -> **472**, and the other two columns stand still a THIRTEENTH
    // time. D384 adds ONE body (`fix-moreenergy`, Swalot's "Devouring Mouth") and no
    // Energy at all, and it prints no Resistance — what that slice reads off a board is
    // the ATTACHED Energy COUNT on two bodies (`InPlayPokemon.energy`) rather than any
    // printed column, so `Card.resistances` is untouched for a FIFTH consecutive slice.
    // 🆕🆕 D385 — 472 -> **473**, and the other two columns stand still a FOURTEENTH
    // time. D385 adds ONE body (`fix-purging`, Veluza ex's "Purging Strike") and no
    // Energy at all, and it prints no Resistance — what that slice reads off a board is
    // a HAND LENGTH, which is not on a card at all, so `Card.resistances` is untouched
    // for a SIXTH consecutive slice.
    // 🆕🆕 D386 — 473 -> **474**, and the other two columns stand still a FIFTEENTH
    // time. D386 adds ONE body (`fix-lively`, Maractus's "Lively Needles") and no
    // Energy at all, and it prints no Resistance — what that slice reads off a board is
    // a per-turn STAMP on `InPlayPokemon` (`healedTurn`), which is not a printed column
    // at all, so `Card.resistances` is untouched for a SEVENTH consecutive slice.
    // 🆕🆕 D387 — 474 -> **477**, and the other two columns stand still a SIXTEENTH
    // time. 🛑 **AND IT IS THE FIRST STEP BIGGER THAN ONE SINCE D377**: D387 adds THREE
    // bodies (`fix-spirited`, the printed attacker; `fix-stage1-big` and
    // `fix-vstar-big`, two DEFENDERS that exist only to carry a printed `stage` word),
    // and none of the three prints a Resistance — what that slice reads off a card is
    // `Card.stage`, a printed column that is NOT this one, so `Card.resistances` is
    // untouched for an EIGHTH consecutive slice. ⚠️ **A COUNT THAT MOVES BY THREE IS
    // NOT A DIFFERENT KIND OF MOVE FROM ONE THAT MOVES BY ONE** — what makes the other
    // two columns stand still is WHICH COLUMN the slice reads, never how many bodies
    // it adds.
    // 🆕🆕 D388 — 477 -> **480**, and the other two columns stand still a SEVENTEENTH
    // time. THREE bodies again (`fix-aerochase`, the printed attacker; `fix-retreat1-titan`
    // and `fix-retreat2-titan`, two DEFENDERS that exist only to carry a printed RETREAT
    // cost), and none of the three prints a Resistance — what that slice reads off a card
    // is `Card.retreat`, folded with the board, which is a printed column that is NOT this
    // one, so `Card.resistances` is untouched for a NINTH consecutive slice.
    // 🆕🆕 D389 — 480 -> **481**, and the other two columns stand still an EIGHTEENTH
    // time. ONE body (`fix-deletingslash`, Iron Crown's "Deleting Slash" demonstrator),
    // ZERO Energy, ZERO Resistances — and what D389 reads off a card is nothing at all:
    // its instrument is `PlayerSide.bench.length`, a BOARD array on the OTHER seat, so
    // `Card.resistances` is untouched for a TENTH consecutive slice.
    // 🆕🆕 D390 — 481 -> **484**, and the other two columns stand still a NINETEENTH
    // time. THREE bodies (`fix-shortcircuit`, Electivire's "Short-Circuit Knuckle"
    // demonstrator, and the two Water bodies `fix-waterbody` / `fix-inplaydual`), and
    // none of the three prints a Resistance — what D390 reads off a card is
    // `Card.types`, a printed column that is NOT this one, so `Card.resistances` is
    // untouched for an ELEVENTH consecutive slice. ⚠️ `fix-shortcircuit` does print a
    // ×2 Fighting WEAKNESS, which is the neighbouring column and is deliberately not
    // what this rung counts.
    // 🆕🆕 D391 — 484 -> **486**: TWO fixtures, `fix-frozenwood` (the Abomasnow
    // demonstrator) and `fix-grassdouble` (the Special providing `{G}{G}`). Both `fix-*`, so the
    // FLOOR moves and the catalog behind it does not.
    // 🆕🆕 D392 — 486 -> **489**: THREE fixtures, `fix-loveimpact` (Team Rocket's
    // Nidoqueen, the demonstrator) and the two bench bodies `fix-trnidoking` /
    // `fix-nidoking`. None prints a Resistance — what D392 reads off a card is
    // `Card.name`, a printed column that is not this one — so `Card.resistances` is
    // untouched for a TWELFTH consecutive slice. All three are `fix-*`, so the FLOOR
    // moves and the catalog behind it does not.
    // 🆕🆕 D393 — 489 -> **493**: FOUR fixtures, the EVOLVE PAIR's two attackers
    // (`fix-strikeitrich`, `fix-abruptflash`) and their two printed pre-evolutions
    // (`fix-gimmighoul`, `fix-mistystaryu`). ⚠️ **AND `Card.resistances` MOVES FOR THE
    // FIRST TIME IN TWELVE SLICES** — 27 -> 28 — because Gholdengo `sv08-131` prints
    // a real Grass -30 and D306 says transcribe the card rather than the fields the
    // tests read. The FIGHTING count below is what stands still, which is the rung
    // that keeps this file's own subject separate from a pool that grew beside it.
    expect(ids).toHaveLength(561); // 🆕🆕 D467 +1 FIXTURE id (`fix-benchnoun` — the attacker carrying corpus file lines 544 and 622; ZERO Resistances and ZERO Weaknesses, so the two columns this file is actually about stand still and only the POOL SIZE moves).
    // 🆕🆕 D465 +1 FIXTURE id (`fix-recoil-scale`, the SYNTHETIC carrier of THE RECOIL THAT SCALES OFF ITS OWN COUNTERS — corpus FILE LINE 500, 1 legal printing, on idx 0, with the BARE twin at corpus FILE LINE 501 on idx 1 as the one-axis control). ⚠️ **IT PRINTS NO RESISTANCE AND NO WEAKNESS**, so `withResistance` (28) and the FIGHTING count below both stand still — a fixture added for a damage-number claim has no business moving a Resistance census (D427). ⚠️ **AND D464 ADDED NONE AT ALL**, which is why this line did not move last slice: its sentence already sat on `fix-oxford` index 2. // 🆕🆕 D462 +1 FIXTURE id (`fix-oxford`, the SYNTHETIC carrier of the THREE-STATUS OXFORD LIST — corpus FILE LINE 679, 2 legal printings, carriers UNRESOLVED because this checkout has no D1, D425). 🆕🆕 D461 +2 FIXTURE ids (`fix-scopedheal` and `fix-scopedheal-evo`, the BASIC and STAGE 1 bodies carrying the SCOPED BOARD HEAL's two printed sentences at indices 0 and 1 — `censusAttackCorpus.ts` file lines 273 and 274). ⚠️ **TWO AND NOT ONE, AND THE SECOND IS NOT A CONVENIENCE**: `healEach.basicOnly` is a CARD read, so the suite needs a body on the OTHER side of the stage line to see the filter refuse anything at all — and the evolved twin is also what drives the case where the ATTACKER excludes ITSELF. ⚠️ THE IDS ARE SYNTHETIC BECAUSE THIS CHECKOUT HAS NO D1 (D425): the four printings' real card ids CANNOT BE RESOLVED and are deliberately not guessed, while the SENTENCES and their printing counts are measured off the committed corpus and pinned in `scopedBoardHeal.test.ts` §1. ⚠️ `fix-energy` AND `fix-titan` ARE RE-USED RATHER THAN NEW, so this figure steps by TWO where the slice added FOUR entries to a deck (D425: one-per-new-POOL-ENTRY, not one-per-deck-slot). 🛑 NEITHER PRINTS A `resistances` ROW and neither prints a Weakness, so `Card.resistances` (28) and the FIGHTING count below BOTH stand still: a fixture added for a SET-MEMBERSHIP claim has no business moving a Resistance census (D427's rule about `fix-drainwall`). 🛑 A `- 2` TERM GOES AT THE FRONT OF ALL ELEVEN NESTED RUNGS BELOW AND EVERY FROZEN TAIL IS UNTOUCHED, diffed against HEAD after the edit and STEPPED ALL ELEVEN rather than only the one that reddened (D431).) 🆕🆕 D460 +1 FIXTURE id (`fix-threshflip`, the synthetic Colorless body carrying the COIN-COUNT THRESHOLD's three printed sentences at indices 0-2 — `censusAttackCorpus.ts` file lines 214, 213 and 228. ⚠️ THE ID IS SYNTHETIC BECAUSE THIS CHECKOUT HAS NO D1 (D425): the three printings' real card ids CANNOT BE RESOLVED and are deliberately not guessed, while the SENTENCES and their printing counts are measured off the committed corpus and pinned in `coinThreshold.test.ts` §1. It prints no Resistance, so `Card.resistances` stands still.) 🆕🆕🆕🆕 D451 +1 FIXTURE id (`fix-hptarget`, the synthetic {L} body carrying the three printed HP-target sentences at indices 0–2 and the printed-damage §11 attribution control at 3). ⚠️ **`fix-bigbody`, `fix-lightning-weak`, `fix-lightning-energy`, `sv02-173`, `sv03-078` AND `fix-unaware` ARE RE-USED RATHER THAN NEW** — all six have been in the pool for dozens of slices — so this figure steps by ONE where the slice added SEVEN entries to a deck (D425: a census delta is one-per-new-POOL-ENTRY, not one-per-deck-slot). 🛑 THE FIXTURE PRINTS NO `resistances` ROW and its {L} is a TYPE rather than a Resistance, so `Card.resistances` (28) and the FIGHTING count below BOTH stand still: a fixture added for an ARITHMETIC claim has no business moving a Resistance census (D427's rule about `fix-drainwall`). 🆕🆕🆕🆕 D450 +2 FIXTURE ids (`fix-counterfold`, the three-fold attacker, and `fix-idlebody`, the Ability-bearing body its `abilityPokemon` half needs). 🆕🆕🆕 D449 +1 FIXTURE (`fix-counterput`, the synthetic {L} body carrying both printed word orders at indices 0 and 1 and the `deals: true` ATTRIBUTION CONTROL at 2). ⚠️ **`fix-lightning-weak`, `fix-lightning-energy`, `sv03-078`, `fix-unaware` AND `sv03-197` ARE RE-USED RATHER THAN NEW** — all five have been in the pool for dozens of slices — so this figure steps by ONE where the slice added SIX entries to a deck (D425: a census delta is one-per-new-POOL-ENTRY, not one-per-deck-slot). 🛑 THE FIXTURE PRINTS NO `resistances` ROW and its {L} is a TYPE rather than a Resistance, so `Card.resistances` and the FIGHTING count below BOTH stand still (THE PUT-COUNTER VERB WITH A CHOSEN TARGET — *"Put 2 damage counters on 1 of your opponent's Pokémon."* (corpus line 413) and *"Choose 2 of your opponent's Pokémon and put 3 damage counters on each of them."* (line 83), **2 sentences / 2 legal printings**, claimed WHOLE by `deriveAttackEffect` arms 23b and 23c through TWO new anchors over the SHIPPED op literal `damageChosen {target: "opponentAny", count, source: "attack"}` with `deals` ABSENT — the literal arm 25's first op has emitted since D143. **ZERO new ops, ZERO new op FIELDS, ZERO new readers** (the reader surface stands still at 13), ZERO registry rows, ZERO `packages/schema` and ZERO `redact.ts` bytes; `MATCH_RECORD_VERSION` **STAYS 29** because no key and no union member arrived — only a PRODUCER of a literal v29 already admitted, driven over the serialized bytes in THREE directions in `counterPutChosen.test.ts` §3. 🛑 **THE WORK ORDER SAID NO ANCHOR CLAIMED THIS VERB AND FOUR DID.** The bare any-zone spelling was missing because a D143 doc block measured *"not printed as a standalone sentence ANYWHERE in the pool"* on the LOCAL pool while the engine runs on `legal_standard = 1`, where it carries 1 printing — D413's two-populations failure biting a REFUSAL, corrected in place at `COUNTER_PUT_ANY_THEN_SELF_LOCK`.) 🆕🆕🆕 D448 +1 FIXTURE (`fix-scaledsnipe`, the synthetic {L} body carrying the two printed scaled sentences at indices 0 and 1, the ONE-AXIS control at 2 and the UNPRINTED rider pair at 3) (A COUNT SOURCE ON THE SNIPE'S OWN AMOUNT — corpus lines 552 and 570, **2 sentences / 3 legal printings**, claimed by `deriveAttackEffect` arm 6d through ONE widening of the SHIPPED anchor `CHOSEN_ANY_TARGET` over ONE new optional `damageChosen` field `perEnergyOnSelf`.) ⚠️ **AND `sv01-197` (Vitality Band), `fix-lightning-weak`, `fix-lightning-energy` AND `fix-energy` ARE RE-USED RATHER THAN NEW** — all four have been in the pool since the 0.38.0 snipe family and the D401 cost deck — so this figure steps by ONE where the slice added FIVE entries to a deck. **A census delta comes from FIXTURES as well as from readers (D425), and it is one-per-new-POOL-ENTRY rather than one-per-deck-slot.** 🛑 THE FIXTURE PRINTS NO `resistances` ROW AT ALL and its {L} is a TYPE rather than a Resistance, so `Card.resistances` and the FIGHTING count below BOTH stand still: a fixture added for a SCALING claim has no business moving a Resistance census (D427's rule about `fix-drainwall`). // 🆕🆕 D447 +1 FIXTURE (`fix-pinpoint`, the synthetic body carrying the three printed sentences) (THE CHOSEN BENCH SNIPE, BOTH SEATS AND BOTH WORDINGS — corpus rows 514/525 (own side, at 10 and 40) and 587 (the BARE opponent-side wording), **3 sentences / 3 legal printings**, claimed by `deriveAttackEffect` arm 6c through TWO widenings of the shared `ALSO_BENCHED_SNIPE_BODY` over ONE new `damageChosen.target` member `yourBench`.) // 🆕🆕 D446 +1 FIXTURE (`fix-roundbody`, the body whose printed attack is NAMED "Round" — the `CardFilter.attackNamePokemon` positive for the FILTERED IN-PLAY BODY COUNT). ⚠️ **THE OTHER THREE BODIES D446's BOARDS FIELD ARE RE-USED RATHER THAN NEW** — `fix-attacker-ex`, `fix-pokemon-v` and `fix-pokemon-vmax` have been in the pool since the Mimikyu cast and the Choice Belt gate, so this figure steps by ONE where the slice added FOUR cards to a deck. **A census delta comes from FIXTURES as well as from readers (D425), and it is one-per-new-POOL-ENTRY rather than one-per-deck-slot.** // 🆕🆕 D440 +2 FIXTURES (`fix-discardpile`, the FILTERED DISCARD-PILE COUNT's four-attack holder, and `fix-ethansadv`, a Supporter whose NAME is exactly "Ethan's Adventure" — `matchesFilter`'s `byName` arm is `card.name === filter.name`, so the printed noun needs a card the catalog would call by that name, and `trainerCard` names every Trainer in this pool by its ID. TWO and not one, and the second is NOT a rename of D337's `fix-ethansadventure`: that would be an edit to a shared fixture four D337 rungs read, which is the class of change D412 paid for. Keeping both is also what makes the predicate falsifiable — they sit in one pile and a `supporter` misreading counts TWO where the print counts ONE. ⚠️ NEITHER carries a `resistances` row and neither is reachable from this file's ops; the front term is the whole cost.) 🆕🆕 D439 +1 FIXTURE (`fix-inplaybodies` "Team Rocket's Fixmon", the FILTERED IN-PLAY BODY COUNT's five-attack holder — one card and not five, because the five printed sentences differ only in the noun and the per-unit amount). ⚠️ **AND `Card.resistances` STANDS STILL AT 28**: the fixture prints no Resistance, no Weakness, no Ability and no Tool, so the FLOOR moves and the catalog behind it does not — this file's own subject is untouched. A `- 1` TERM GOES AT THE FRONT OF ALL ELEVEN NESTED RUNGS BELOW AND EVERY FROZEN TAIL IS UNTOUCHED, diffed against HEAD before writing. 🆕🆕 D438 +3 FIXTURES (THE RETREAT-COST PENALTY — *"This attack does {30|50} less damage for each {C} in your opponent's Active Pokémon's Retreat Cost."*, corpus rows 573/603, **2 sentences / 3 legal printings** that differ at exactly ONE character position (the `3` vs the `5`, index 17 zero-based — DIFFED, not eyeballed), claimed WHOLE by `deriveAttackDamagePenalty` through ONE new anchor `RETREAT_COST_PENALTY` and ONE `if`. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at **13** (the arm sits inside an existing reader, not a fourteenth), and the count source it names — `opponentActiveRetreatCost` — plus its `scaledAttackDamage` arm have both shipped since D110, so no union member and no evaluator arm arrived with it. `REGISTRY_ATTACKS` (12 units), `SPLIT_ATTACK_UNITS` (13) and `COMPOUND_ATTACK_UNITS` (21) were RE-MEASURED UNMOVED after the anchor landed rather than assumed, D424's rule. ⚠️ AND NO COMPOUND COMPOSES, MEASURED ON BOTH SIDES: each sentence holds **zero** `. ` joiners, so `splitAttackTrailingClause` and `splitAttackGateClause` both return null on it before AND after the widening — D426's mechanism at the degenerate end.) 🆕🆕 D437 +1 FIXTURE — THE **FIXTURE** ROUTE, NOT THE READER ROUTE (D425), and this slice moves BOTH in one commit. ONE Pokémon fixture, `fix-filteredsnipe`: the attacker printing corpus row 528 at index 0, the SAME sentence with the narrowing clause deleted at index 1 (the one-axis control) and a deliberately-unread sibling of the printed predicate at index 2. `fix-teaparty` — the benched-only §11 damage shield the D433 pair needs — was ALREADY in the pool since D253 and is reused rather than invented, so it moves nothing here. 🛑 THE FIXTURE PRINTS NO `resistances` ROW AT ALL and its {W} is a TYPE rather than a Resistance, so `Card.resistances` and the FIGHTING count below stand still: a fixture added for a candidate-set claim has no business moving a Resistance census (D427's rule about `fix-drainwall`). // 🆕🆕 D436 +3 FIXTURES (THE "EXTRA ENERGY" DECLARATION READ — `fix-powerpress`, `fix-highvoltage` and `fix-extraprobe`. NONE prints a Resistance, so `Card.resistances` stands still at 28 for the FOURTH consecutive slice and the FIGHTING count below is unmoved; all three are `fix-*`, so the FLOOR moves and the catalog behind it does not.) // 🆕🆕 D432 +3 FIXTURES (THE INSTALLED NO-WEAKNESS BAR — *"During your opponent's next turn, this Pokémon has no Weakness."*, corpus row 192, **1 sentence / 3 legal printings**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `SELF_NO_WEAKNESS` and ONE new field-free `EffectOp` `removeWeakness`. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at 13 (the arm is inside `deriveAttackEffect`, not a fourteenth reader), and `SPLIT_ATTACK_UNITS`, `COMPOUND_ATTACK_UNITS` and `REGISTRY_ATTACK_UNITS` were RE-MEASURED UNMOVED after the anchor landed rather than assumed, D424's rule. ⚠️ AND NO COMPOUND COMPOSES: the sentence is ONE clause with no `. ` joiner in it at all, so `splitAttackTrailingClause` never sees a tail — D426's mechanism, at the degenerate end.) ⚠️ THIS IS THE **FIXTURE** ROUTE, NOT THE READER ROUTE, and D432 moves BOTH in the same commit — the three Pokémon fixtures are `fix-nowk` (the installer, ×2 Lightning so the §8.5 Weakness step MOVES A NUMBER), `fix-nowk-stage1` (the §10 EVOLVE clear) and `fix-bolt` (the {L} swinger). 🛑 **NONE OF THE THREE PRINTS A RESISTANCE**, so `withResistance` (28) and the FIGHTING count (18) below stand still for an EIGHTEENTH consecutive slice: a fixture added for a WEAKNESS claim has no business moving a Resistance census (D427's own rule about `fix-drainwall`, and the ×2 Lightning here is the other column). 🛑 THE ELEVEN CHAINS BELOW TAKE A `- 3` TERM AT THE FRONT AND THEIR FROZEN ENDPOINTS ARE UNTOUCHED — diffed against HEAD mechanically after the edit, D426's check for D425's slip, and STEPPED ALL ELEVEN rather than only the one that reddened (D431). 🆕🆕 D431 +1 FIXTURE (`fix-prizewheel`, the prize-taking attacker), which is the FIXTURE route into this pool and not the reader route (THE PRIZE TAKEN WITHOUT A KNOCK OUT — *"Discard all Energy from this Pokémon, and take a Prize card."*, corpus row 108, **1 sentence / 3 legal printings**, claimed WHOLE by `deriveAttackEffect` through ONE new compound anchor `SELF_DISCARD_ALL_THEN_TAKE_PRIZE` and ONE new field-free `EffectOp` `takePrize`. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at 13 (the arm is inside `deriveAttackEffect`, not a fourteenth reader), and `SPLIT_ATTACK_UNITS`, `COMPOUND_ATTACK_UNITS` and `REGISTRY_ATTACK_UNITS` were RE-MEASURED UNMOVED after the anchor landed rather than assumed, D424's rule. ⚠️ AND THE COMPOUND COMPOSED NOTHING: `splitAttackTrailingClause` refuses this string twice over — the joiner is ", and" rather than ". ", and the tail *"take a Prize card."* is claimed by no reader — so the sentence arrives through the anchor and NOT through the splitter, which is why `COMPOUND_ATTACK_UNITS` does not move, D426's mechanism.) 🆕🆕 D429 +2 fixtures (THE REST OF THE PRE-DAMAGE FAMILY — `fix-preseam`, the attacker printing corpus rows 71/72/74 beside a same-damage null control and a deliberately unread row; `fix-seamwall`, the {F} 300 HP body that wears a Tool, a Special Energy and a Basic at once; NEITHER prints a Resistance — `fix-seamwall` is typed {F} for Rock Chestplate's holder gate and prints no `resistances` at all — so `Card.resistances` stands still for a SEVENTEENTH consecutive slice and the FIGHTING count below is unmoved.) 🆕🆕 D428 +3 Pokémon fixtures (THE PRE-DAMAGE TOOL DISCARD — `fix-toolstrip`, the attacker printing corpus line 73 at TWO indices beside two same-damage twins that print nothing and one deliberately unread row; `fix-chestwall`, {F} / 300 HP, the body Rock Chestplate `sv01-192` gates its −30 on; and `fix-charmwall`, Basic / 100 HP, the body Bravery Charm `sv02-173`'s +50 carries across the KO boundary). 🛑 **NONE OF THE THREE PRINTS A RESISTANCE, AND NONE PRINTS A WEAKNESS EITHER** — this slice reads `InPlayPokemon.tools`, which is not a printed `Card` column at all, and a fixture added for a Tool claim has no business moving a W/R census (D427's own rule about `fix-drainwall`). So the FLOOR moves by 3 and both the `Card.resistances` count and the FIGHTING count below stand still. The three Tools this slice drives (`sv01-192`, `sv02-173`, `sv01-197`) were ALREADY in the pool and are reused rather than invented, so they move nothing here at all.)  🆕🆕 D427 +3 Pokémon fixtures (HEAL SELF BY THE DAMAGE THIS ATTACK DEALT — `fix-suction`, the attacker printing corpus line 286 at three indices plus one deliberately-unread row so the ATTACK_EFFECT_SKIPPED rung has a control on the SAME body; and the W/R pair `fix-drainwall` / `fix-drainweak`, 300 HP each and identical but for one printed `×2 Fire` row, which is what makes *"the heal read the BASE instead of the DEALT amount"* a defect no single-defender board can hide. The shipped 300-HP pair `fix-suppresswall` / `fix-resistwall` would have been free and is CONFOUNDED: both also carry a −30 post-W/R reduction from their registry rows, which is exactly the second subtraction that has to hold still while the first is read. 🛑 THE ELEVEN CHAINS BELOW TAKE A `- 3` TERM AT THE FRONT AND THEIR FROZEN ENDPOINTS ARE UNTOUCHED — diffed against HEAD after the edit, which is D426's check for D425's slip. ⚠️ NEITHER NEW BODY CARRIES `resistances` AND NEITHER IS FIGHTING, so `withResistance` and `fighting` two rungs down stand still: a fixture added for a Weakness claim has no business moving a Resistance census.)  🆕🆕 D425 +1 Pokémon fixture (`fix-tremor` — the OWN-SIDE BENCH SPREAD's demonstrator, carrying BOTH possessives of one printed shape at indices 0 and 1). It is `fix-*` with no card behind it: the SENTENCES are transcribed off `censusAttackCorpus.ts` (3 legal printings at 10), and this checkout holds NO D1 — no local sqlite, no remote credentials — so the carrier ids could not be resolved and are NOT invented. `Card.resistances` STANDS STILL AT 28 and FIGHTING at 18: the body prints no Resistance row at all (its `{F}` is a TYPE, which is the other column — D407's distinction verbatim). The 20 and the 30 needed no fixture: `swsh10.5-043` Tyranitar and `sv01-117` Krookodile have carried those two sentences since D170 and D129 as DECLARED-UNSIMULATED siblings. 🆕🆕 D424 +5 Pokémon fixtures (`fix-ninetales`, `fix-tr-houndoom`, `fix-ekans`, `fix-glimmora`, `fix-accelgor` — the five bodies of the two-status pair). All five are `fix-*`, so the FLOOR moves and the catalog behind it does not. ⚠️ `Card.resistances` STANDS STILL AT 28 and FIGHTING at 18: not one of the five prints a Resistance (read column by column off the remote D1 on 2026-08-26 — `resistances_json` is NULL on every one), so this file's own subject is untouched by a pool that grew beside it. 🆕🆕 D423 +2 Pokémon fixtures (`fix-glalie` and `fix-flapple`, the two CARDS that print the opponent-side damage-counter MULTIPLIER — Glalie `sv06-052` and Flapple `sv08-139`, the latter also printed as `sv08-210` at Illustration Rare, which is a RARITY and not a third body so no third fixture exists). Both are `fix-*` KEYS WITH REAL CARDS BEHIND THEM, D421's situation exactly: `sv06` and `sv08` are not among the local D1's six sets and `catalogManifest.test.ts` (c) asserts `CATALOG_MANIFEST.absent` is EMPTY, so a real-id fixture would REDDEN that guard. Every scalar on both is transcribed off the remote D1 row (2026-08-24) and pinned in `opponentCounterMultiply.test.ts` §1.) // 🆕🆕 D421 — +2 Pokémon fixtures (`fix-gougingfire`, the UNTIL-IT-LEAVES-ACTIVE BAR's demonstrator, and `fix-gouging-stage1`, the body the EVOLVE clear needs). `withResistance` (28) and the FIGHTING count (18) BOTH stand still for a FOURTH consecutive slice — Gouging Fire ex prints ×2 Water as a WEAKNESS and no Resistance row at all, and the synthetic Stage 1 prints neither. The floor is a floor on a BIASED SAMPLE, and the bias is a property of what fixtures get written rather than of the catalog. // 🆕🆕 D413 — +1 Pokémon fixture (`fix-coinbonus`, the ADDITIVE MULTI-COIN FOLD's demonstrator: BOTH printed sentences on ONE 200 HP body at indices 0 and 1, differing in the single token `per` ∈ {30, 50} and in nothing else). ZERO Energy prints and ZERO Resistances, so `withResistance` (28) and `fighting` (18) BOTH stand still for a THIRD consecutive slice — what D413 reads off a card is its ATTACK TEXT and nothing else, and the printed `20+` base it also reads is `Attack.damage`, not a Resistance row. 🆕🆕 D409 — +1 Pokémon fixture (`fix-compound`, the FIVE printed `. `-joined compounds on one 340 HP body, plus the SHIPPED twin of one of them and a refusal control). ZERO Energy prints and ZERO Resistances, so `withResistance` (28) and `fighting` (18) both stand still for a SECOND consecutive slice — what D409 reads off a card is its ATTACK TEXT and nothing else. ⚠️ A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED PREFIX CHAINS BELOW, never at the end (D397). 🆕🆕 D408 — +2 Pokémon fixtures (`fix-lockplural`, the SELF-side bare plural; `fix-deflock`, the OPPONENT-side lock in BOTH printed verbs on one body). `withResistance` and the FIGHTING count both stand still, because neither fixture writes a `resistances` row and both default to Colorless: the floor is a floor on a BIASED SAMPLE, and the bias is a property of what fixtures get written rather than of the catalog. 🆕🆕 D407 — +1 Pokémon fixture (`fix-boardgrass`); `withResistance` and the FIGHTING count both stand still, because it prints no Resistance at all and its {G} is a TYPE rather than a Resistance row 🆕🆕 D406 — +1 Pokémon fixture (`fix-toolscaler`); `withResistance` and the FIGHTING count both stand still, because it prints no Resistance at all and its {F} is a TYPE rather than a Resistance row 🆕🆕 D405 — +1 Pokémon fixture (`fix-selfenergyhand`); `withResistance` and the FIGHTING count both stand still, because it prints no Resistance at all (a {R} ×2 WEAKNESS is the other field). 🆕🆕 D404 — +1 Pokémon fixture (`fix-handdraw`); `withResistance` and the FIGHTING count both stand still, because it prints no Resistance at all. // 🆕🆕 D403 — +2 Pokémon fixtures (`fix-benchboost`, `fix-benchbasicboost`); `withResistance` and the FIGHTING count both stand still, because neither prints a Resistance (a {D} ×2 WEAKNESS is the other field) and the −30 body this slice measures against (`fix-psychic-resist-big`) has been in the pool since D139 // 🆕🆕 D402 — +2 Pokémon fixtures (`fix-allscale`, `fix-basicscale`); `withResistance` and the FIGHTING count both stand still, because neither prints a Resistance (a {F} ×2 WEAKNESS is the other field) // 🆕🆕 D401 — +2 Pokémon fixtures (`fix-costsnipe`, `fix-allsnipe`); `withResistance` and the FIGHTING count both stand still, because neither prints a Resistance (a {F} ×2 WEAKNESS is the other field) // 🆕🆕 D400 — +2 Pokémon fixtures (`fix-twinsnipe`, `fix-twinfeint`); `withResistance` stands still, because neither prints a Resistance (a {F} ×2 WEAKNESS is the other column) // 🆕🆕 D399 — +1 Pokémon fixture (`fix-hazardousgreed` Wo-Chien `sv08-015`); `withResistance` stands still, because the printing prints no Resistance (a {R} ×2 WEAKNESS is the other column) // 🆕🆕 D398 — +1 Pokémon fixture (`fix-counterturn` Rabsca `sv08-014`); `withResistance` stands still, because the printing prints no Resistance // 🆕🆕 D397 — +2 Pokémon fixtures (`fix-bonevengeance` Marowak `sv07-073`, `fix-cubone` the card its clause NAMES); `withResistance` stands still, because neither prints one // 🆕🆕 D394 — +2 Pokémon fixtures (`fix-alloutattack` Falinks, `fix-crazyblast` Weezing); `withResistance` stands still at 28, because neither printing carries a resistance row
    expect(withResistance).toHaveLength(28);
    // 🆕🆕 **D438 — A `- 3` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS BELOW, AND EVERY
    // FROZEN TAIL IS UNTOUCHED.** THREE bodies: `fix-retreatless` (the demonstrator printing
    // corpus rows 573/603) and the two ladder rungs `fix-retreat3-titan` / `fix-retreat0-titan`,
    // the printed {C}{C}{C} and printed-ZERO defenders a PER-UNIT clause needs and the
    // retreat family did not have. ⚠️ **NONE OF THE THREE PRINTS A RESISTANCE**, so
    // `Card.resistances` (28) and the FIGHTING count below both stand still — a fixture added
    // for a damage-number claim has no business moving a Resistance census (D427's rule about
    // `fix-drainwall`). All three are `fix-*`, so the FLOOR moves and the catalog behind it
    // does not. 🛑 **ELEVEN COUNTED AND ELEVEN STEPPED IN ONE PASS** (D428/D431): vitest
    // reddened only the first, and a green suite after fixing that one is evidence the runner
    // stopped early rather than that the round was complete.
    // 🆕🆕 **D429 — A `- 2` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS BELOW, AND EVERY
    // FROZEN TAIL IS UNTOUCHED.** TWO bodies (`fix-preseam`, the attacker printing corpus
    // rows 71/72/74, and `fix-seamwall`, the {F} 300 HP body that wears a Tool, a Special
    // Energy and a Basic at once). NEITHER prints a Resistance, so `Card.resistances`
    // stands still and the FIGHTING count above is unmoved. ⚠️ D428's note said this file
    // carries ELEVEN nested prefix chains and it carries exactly eleven — counted, and all
    // eleven stepped, because a green suite after fixing the ONE that reddened is not
    // evidence the round was complete.
    expect(fighting).toHaveLength(18);
    // 🆕🆕 D399 — a `- 1` term at the FRONT of EVERY rung below: ONE body
    // (`fix-hazardousgreed`, Wo-Chien `sv08-015`), ZERO Energy, ZERO Resistances. The
    // rungs are nested PREFIXES of one chain, so a body added to the pool shifts all
    // eleven by the same 1 and each frozen tail stays frozen. ⚠️ **THE CHAIN IS EDITED
    // AT THE FRONT, NEVER AT THE END**, and it is keyed on the `.toBe(N)` tails (D397).
    // 🆕🆕 D402 — a `- 2` term at the FRONT of EVERY rung below: TWO bodies
    // (`fix-allscale`, `fix-basicscale`, the DISCARD-COUNT-SCALED demonstrators), ZERO
    // Energy prints, ZERO Resistances. What D402 reads off a card is its ATTACK TEXT
    // and nothing else, so this file's own two columns stand still — which is the
    // measurement, not the assumption. ⚠️ **THE CHAIN IS EDITED AT THE FRONT.**
    // D371 measured this floor at 27 of 450 and D370 at 24 of 444, BEFORE their
    // fixtures landed. The arithmetic is spelled out so the inherited figures and
    // the live ones cannot silently disagree: D372 is +3 bodies / +0 / +0, and
    // D371 was +6 bodies, +3 with a Resistance (`fix-fightweak` has none by
    // design), +2 of them Fighting.
    // 🆕🆕 D374 — one more term on the chain: +3 bodies / +0 / +0.
    // 🆕🆕 D375 — and one more: +2 bodies / +0 / +0.
    // 🆕🆕 D376 — and one more again: +1 body / +0 / +0 (`fix-emberpillar`, which
    // prints no Resistance because the column D376 reads is the discard pile).
    // 🆕🆕 D377 — and one more again: +3 bodies / +0 / +0 (`fix-roastheat`,
    // `fix-mindcrush`, `fix-charbreath`, none of which prints a Resistance because the
    // column D377 reads is the opponent Active's `SpecialConditions`).
    // 🆕🆕 D378 — a `- 2` term at the head of the chain: TWO bodies, ZERO Energy,
    // ZERO Resistances.
    // 🆕🆕 D379 — a `- 1` term ahead of that one: ONE body (`fix-triocheehoo`), ZERO
    // Energy, ZERO Resistances.
    // 🆕🆕 D380 — a `- 2` term at the head: TWO bodies (`fix-blazedestruct`,
    // `fix-knockover`), ZERO Energy, ZERO Resistances — the column D380 reads is
    // `state.stadium`, which is not on a card at all.
    // 🆕🆕 D381 — a `- 1` term at the head of the chain: ONE body (`fix-crushpress`),
    // ZERO Energy, ZERO Resistances — the column D381 reads is `state.stadium` again,
    // and the only card datum its fixture is read for is its NAME.
    // 🆕🆕 D382 — a `- 1` term at the FRONT of the chain: ONE body (`fix-groundmelter`,
    // Chi-Yu's "Ground Melter" demonstrator), ZERO Energy, ZERO Resistances — the
    // column D382 reads is `state.stadium` for a THIRD consecutive slice, and unlike
    // D381's fixture this one's NAME is read by nothing either. ⚠️ **THE CHAIN IS
    // EDITED AT THE FRONT, NEVER AT THE END** — every later operand would shift.
    // 🆕🆕 D383 — a `- 1` term at the FRONT of the chain: ONE body (`fix-torrent`,
    // Wellspring Mask Ogerpon ex's "Torrential Pump" demonstrator), ZERO Energy,
    // ZERO Resistances — and what D383 reads off a card is nothing at all: its
    // instrument is `InPlayPokemon.energy`, a BOARD array, so this is the first
    // slice in four whose fixture's card data is read by neither this column nor a
    // NAME. ⚠️ **THE CHAIN IS EDITED AT THE FRONT, NEVER AT THE END.**
    // 🆕🆕 D384 — a `- 1` term at the FRONT of the chain, the SECOND consecutive slice
    // whose fixture's card data is read by neither this column nor a NAME: ONE body
    // (`fix-moreenergy`, Swalot's "Devouring Mouth" demonstrator), ZERO Energy, ZERO
    // Resistances, and an instrument that is `InPlayPokemon.energy` on TWO bodies
    // rather than any printed column. ⚠️ **THE CHAIN IS EDITED AT THE FRONT.**
    // 🆕🆕 D385 — a `- 1` term at the FRONT of the chain, the THIRD consecutive slice
    // whose fixture's card data is read by neither this column nor a NAME: ONE body
    // (`fix-purging`, Veluza ex's "Purging Strike" demonstrator), ZERO Energy, ZERO
    // Resistances, and an instrument that is a HAND LENGTH — not on a card at all.
    // ⚠️ **THE CHAIN IS EDITED AT THE FRONT, NEVER AT THE END.**
    // 🆕🆕 D386 — a `- 1` term at the FRONT of the chain, the FOURTH consecutive slice
    // whose fixture's card data is read by neither this column nor a NAME: ONE body
    // (`fix-lively`, Maractus's "Lively Needles" demonstrator), ZERO Energy, ZERO
    // Resistances, and an instrument that is a per-turn STAMP on `InPlayPokemon` —
    // not on a card at all. ⚠️ **THE CHAIN IS EDITED AT THE FRONT, NEVER AT THE END.**
    // 🆕🆕 D387 — a `- 3` term at the FRONT of the chain, the first term bigger than
    // one since D377: THREE bodies (`fix-spirited`, `fix-stage1-big`, `fix-vstar-big`),
    // ZERO Energy, ZERO Resistances, and an instrument that is `Card.stage` — a printed
    // column, but not this one. ⚠️ **THE CHAIN IS EDITED AT THE FRONT, NEVER AT THE END.**
    // 🆕🆕 D388 — a `- 3` term at the FRONT of the chain, the SECOND consecutive slice
    // to add three: THREE bodies (`fix-aerochase`, `fix-retreat1-titan`,
    // `fix-retreat2-titan`), ZERO Energy, ZERO Resistances, and an instrument that is
    // `Card.retreat` FOLDED WITH THE BOARD — a printed column, but not this one, and
    // the first one on this chain that is not read straight off the card at all.
    // ⚠️ **THE CHAIN IS EDITED AT THE FRONT, NEVER AT THE END.**
    // 🆕🆕 D389 — a `- 1` term at the FRONT of the chain: ONE body
    // (`fix-deletingslash`), ZERO Energy, ZERO Resistances, and an instrument that is a
    // BENCH LENGTH on the opponent's side — not on a card at all.
    // ⚠️ **THE CHAIN IS EDITED AT THE FRONT, NEVER AT THE END.**
    // 🆕🆕 D390 — a `- 3` term at the FRONT of the chain: THREE bodies
    // (`fix-shortcircuit`, `fix-waterbody`, `fix-inplaydual`), ZERO Energy, ZERO
    // Resistances, and an instrument that is `Card.types` — a printed column, but not
    // this one. ⚠️ **THE CHAIN IS EDITED AT THE FRONT, NEVER AT THE END.**
    // 🆕🆕 D391 — a `- 2` term at the FRONT: `fix-frozenwood` and `fix-grassdouble`,
    // the Abomasnow demonstrator and the Special providing `{G}{G}`. ⚠️ THE CHAIN IS EDITED AT
    // THE FRONT, NEVER AT THE END.
    // 🆕🆕 D392 — a `- 3` term for this slice's three fixtures, at the FRONT of the chain.
    // 🆕🆕 D397 — a `- 2` at the FRONT of every chain below: the BENCHED-CUBONE FILTER added TWO
    // Pokémon fixtures to the pool (`fix-bonevengeance`, `fix-cubone`). ⚠️ THE CHAIN IS EDITED
    // AT THE FRONT, NEVER AT THE END.
    // 🆕🆕 D394 — a `- 2` at the FRONT of every chain below: the USED-ATTACK PAIR added
    // TWO Pokémon fixtures to the pool. ⚠️ THE CHAIN IS EDITED AT THE FRONT, NEVER AT
    // THE END — each line still names the floor at the slice that measured it.
    // 🆕🆕 D398 — a `- 1` at the FRONT of every chain below: the DECK-SIZE READ added ONE
    // Pokémon fixture to the pool (`fix-counterturn`). ⚠️ THE CHAIN IS EDITED AT THE FRONT,
    // NEVER AT THE END — and the substitution above was keyed on each line's `.toBe(N)` TAIL
    // rather than on the chain, because a chain GROWS INTO THE PATTERN THAT MATCHES IT (D397).
    // 🆕🆕 D400 — a `- 2` at the FRONT of every chain below: the ANY-TARGET ARITY added
    // TWO Pokémon fixtures to the pool (`fix-twinsnipe`, `fix-twinfeint`). ⚠️ THE CHAIN
    // IS EDITED AT THE FRONT, NEVER AT THE END — each line still names the floor at the
    // slice that measured it, and the substitution is keyed on the frozen `.toBe(N)`.
    // 🆕🆕 D404 — a `- 1` at the FRONT of every chain below: THE MANDATORY HAND WIPE AND
    // REFILL added ONE Pokémon fixture to the pool (`fix-handdraw`). ⚠️ THE CHAIN IS
    // EDITED AT THE FRONT, NEVER AT THE END — the tails below are FROZEN past-head
    // floors, each naming the slice that measured it, and moving one would erase the
    // provenance the chain exists to keep.
    // 🆕🆕 D406 — a `- 1` at the FRONT of every chain below: THE COUNTED TOOL SCALER
    // added ONE Pokémon fixture to the pool (`fix-toolscaler`). ZERO Energy prints and
    // ZERO Resistances, and what D406 reads off a card is its ATTACK TEXT alone — its
    // printed `{F}` is a `Card.types` value, not a Resistance row, so BOTH of this
    // file's own columns stand still. ⚠️ THE CHAIN IS EDITED AT THE FRONT, NEVER AT THE
    // END — each line still names the floor at the slice that measured it, and the
    // substitution is keyed on the frozen `.toBe(N)`.
    // 🆕🆕 D405 — a `- 1` at the FRONT of every chain below: the MANDATORY OWN-BOARD
    // ENERGY RETRIEVAL added ONE Pokémon fixture to the pool (`fix-selfenergyhand`).
    // ⚠️ THE CHAIN IS EDITED AT THE FRONT, NEVER AT THE END — each line still names the
    // floor at the slice that measured it, and the substitution is keyed on the frozen
    // `.toBe(N)`.
    // 🆕🆕 D403 — a `- 2` at the FRONT of every chain below: the ADDITIVE HALF OF D402's
    // FAMILY added TWO Pokémon fixtures to the pool (`fix-benchboost`,
    // `fix-benchbasicboost`). ⚠️ THE CHAIN IS EDITED AT THE FRONT, NEVER AT THE END —
    // each line still names the floor at the slice that measured it, and the
    // substitution is keyed on the frozen `.toBe(N)`.
    // 🆕🆕 D401 — a `- 2` at the FRONT of every chain below: the SELF-DISCARD COST BEFORE
    // AN ANY-TARGET SNIPE added TWO Pokémon fixtures to the pool (`fix-costsnipe`,
    // `fix-allsnipe`). ⚠️ THE CHAIN IS EDITED AT THE FRONT, NEVER AT THE END — each line
    // still names the floor at the slice that measured it, and the substitution is keyed
    // on the frozen `.toBe(N)`.
    // 🆕🆕 D407 — a `- 1` at the FRONT of every chain below: THE BOARD-WIDE OWN-ENERGY
    // COUNT added ONE Pokémon fixture to the pool (`fix-boardgrass`). ⚠️ THE CHAIN IS
    // EDITED AT THE FRONT, NEVER AT THE END — each line still names the floor at the
    // slice that measured it, and the substitution is keyed on the frozen `.toBe(N)`.
    // 🆕🆕 D408 — a `- 2` at the FRONT of every chain below: THE BARE ATTACK LOCK added
    // TWO Pokémon fixtures (`fix-lockplural`, `fix-deflock`). ⚠️ THE CHAIN IS EDITED AT
    // THE FRONT, NEVER AT THE END — and ELEVEN chains take the same term, which is the
    // second slice running to pay eleven of them here.
    // 🆕🆕 D413 — a `- 1` at the FRONT of every chain below: THE ADDITIVE MULTI-COIN
    // FOLD added ONE Pokémon fixture to the pool (`fix-coinbonus`, both printed
    // sentences on one 200 HP body at indices 0 and 1). ZERO Energy prints and ZERO
    // Resistances, and what D413 reads off a card is its ATTACK TEXT alone, so BOTH of
    // this file's own columns stand still — measured rather than assumed. ⚠️ THE CHAIN
    // IS EDITED AT THE FRONT, NEVER AT THE END — each line still names the floor at the
    // slice that measured it, and the substitution is keyed on the frozen `.toBe(N)`,
    // because a chain GROWS INTO THE PATTERN THAT MATCHES IT (D397).
    // 🆕🆕 D421 — a `- 2` term at the FRONT of the chain: TWO Pokémon fixtures
    // (`fix-gougingfire`, `fix-gouging-stage1`), ZERO Energy prints and ZERO Resistances.
    // ⚠️ EDITED AT THE FRONT, NEVER AT THE END — the frozen tail is what this rung is (D397).
    // 🆕🆕 D423 — a `- 2` term at the FRONT of the chain: TWO Pokémon fixtures
    // (`fix-glalie` and `fix-flapple`, the two CARDS that print the opponent-side damage-counter
    // MULTIPLIER — Glalie `sv06-052` and Flapple `sv08-139`, the latter also printed as `sv08-210`
    // at Illustration Rare, a RARITY and not a third body). ZERO Energy prints; ONE Resistance-free
    // body and one ×2-Metal body, so this rung's own subject is untouched by either.
    // ⚠️ EDITED AT THE FRONT, NEVER AT THE END — the frozen tail is what this rung is (D397).
    // 🆕🆕 D424 — a `- 5` term at the FRONT: the two-status pair's five Pokémon fixtures. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
    // 🆕🆕 **D428 — a `- 3` term at the FRONT of ALL ELEVEN of this file's nested prefix
    // chains, and every frozen tail (468, 466, 465, 463, 460, 459, 457, 454, 453, 450, 444)
    // IS UNTOUCHED.** They all start from `ids.length`, so a fixture addition moves every
    // one of them and a slice that stepped only the chain its own rung reddened would have
    // left ten tautologies behind — D425 named this file's chain as the hardest edit in the
    // repo for exactly that reason. The three fixtures are `fix-toolstrip`, `fix-chestwall`
    // and `fix-charmwall`; ZERO Energy prints, ZERO Resistances and ZERO Weaknesses, so this
    // rung's own subject is untouched. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
    // 🆕🆕 D431 — a `- 1` term at the FRONT of ALL ELEVEN rungs below, for this slice's ONE
    // Pokémon fixture (`fix-prizewheel`, the prize-taking attacker). 🛑 ALL ELEVEN WERE
    // STEPPED, NOT THE ONE THAT REDDENED (D428): vitest stops at the first failing assertion in
    // an `it`, so the other ten would have gone quiet rather than red — the exact tautology
    // D426 found. The fixture prints ZERO Resistances and ZERO Weaknesses and carries no Energy,
    // so this rung's own subject is untouched and only the POOL SIZE moved. ⚠️ EDITED AT THE
    // FRONT, NEVER AT THE END — every endpoint below is byte-identical to `b23819c`.
    // 🆕🆕 D437 — a `- 1` term at the FRONT of ALL ELEVEN rungs below, for this slice's ONE Pokémon
    // fixture (`fix-filteredsnipe`, the filtered bench snipe's attacker; `fix-teaparty` is reused from
    // D253 and adds nothing to the pool). 🛑 ALL ELEVEN WERE STEPPED, NOT THE ONE THAT REDDENED (D431):
    // vitest stops at the first failing assertion in an `it`, so the other ten would have gone QUIET
    // rather than red — D426's tautology. ⚠️ EDITED AT THE FRONT, NEVER AT THE END: the eleven frozen
    // endpoints (468, 466, 465, 463, 460, 459, 457, 454, 453, 450, 444) were diffed against `88b03a2`
    // after the edit and not one byte moved. The fixture prints ZERO Resistances and ZERO Weaknesses
    // and carries no Energy, so this rung's own subject is untouched and only the POOL SIZE moved.
    expect(ids.length - 1 /* 🆕🆕 **D467 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN ENDPOINT IS UNTOUCHED** (D426/D437). ONE new `FIXTURE_POOL` id: `fix-benchnoun`, the two-attack carrier of `censusAttackCorpus.ts` file lines 544 and 622. ⚠️ **THE UNIT HERE IS FIXTURE IDS, NOT SENTENCES AND NOT PRINTINGS** — the same commit moves the sentence chains by 2 and the printing chains by 3, which is three different sizes in one pass (D451/D464/D466). The fixture prints ZERO Resistances and ZERO Weaknesses (`battler` leaves both null and this slice overrides neither), so this file's own subject is untouched and only the POOL SIZE moved — read against this rung's predicate rather than stepped by analogy (D465). ⚠️ AND THE ELEVEN WERE FOUND BY A STRING COUNT rather than by re-running the suite until it stopped failing, which is what stops one of them being missed. */ - 1 /* 🆕🆕 **D466 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN ENDPOINT IS UNTOUCHED** (D426/D437). ONE new `FIXTURE_POOL` id: `fix-stage2body`, the Stage 2 carrier of `censusAttackCorpus.ts` file line 589. ⚠️ **THE UNIT HERE IS FIXTURE IDS, NOT SENTENCES AND NOT PRINTINGS** — the same commit moves the sentence chains by 2 and the printing chains by 3, which is three different sizes in one pass (D451/D464). The fixture prints ZERO Resistances, ZERO Weaknesses and no Energy, so this file's own subject is untouched and only the POOL SIZE moved — read against this rung's predicate rather than stepped by analogy (D465).  */ - 1 /* 🆕🆕 **D465 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN TAIL IS UNTOUCHED** (D438's pattern, D426's rule). ONE body: `fix-recoil-scale`, the scaled-recoil demonstrator. It prints no Resistance, so only the POOL SIZE moves. ⚠️ EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕 **D462 — A `- 1` TERM AT THE FRONT, AND THE FROZEN ENDPOINT IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END — a tail that moves with the head asserts `head === head`). THE THREE-STATUS OXFORD LIST: corpus FILE LINE 679, *"Your opponent's Active Pokémon is now Burned, Confused, and Poisoned."*, **1 sentence / 2 legal printings** — this is the FIXTURE-id half (`fix-oxford`, one new synthetic body). ⚠️ **EVERY CHAIN IN THIS FILE WAS STEPPED IN ONE PASS, FOUND BY A STRING COUNT** rather than by re-running the suite: vitest stops an `it` at its first throw, so a second or third chain in the same `it` goes QUIET rather than red (D428). */ - 2 /* 🆕🆕 **D461 — A `- 2` TERM AT THE FRONT OF ALL ELEVEN RUNGS IN THIS LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END). 🛑 ALL ELEVEN WERE STEPPED, NOT ONLY THE ONE THAT REDDENED (D431) — vitest stops an `it` at its first throw, so the other ten would have gone QUIET rather than red. The slice's TWO Pokémon fixtures are `fix-scopedheal` and `fix-scopedheal-evo`, the SCOPED BOARD HEAL's Basic and Stage 1 bodies. */ - 1 /* 🆕🆕 **D460 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN RUNGS IN THIS LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END). 🛑 ALL ELEVEN WERE STEPPED, NOT ONLY THE ONE THAT REDDENED (D431) — vitest stops an `it` at its first throw, so the other ten would have gone QUIET rather than red. The slice's ONE Pokémon fixture is `fix-threshflip`, the COIN-COUNT THRESHOLD's attacker; `fix-titan`, `fix-energy` and `sv02-193` are all reused and add nothing to the pool. It prints ZERO Resistances and ZERO Weaknesses and carries no Energy, so this rung's own subject is untouched and only the POOL SIZE moved. */ - 1 /* 🆕🆕🆕🆕 **D451 — A `- 1` TERM AT THE FRONT OF THIS ELEVEN-DEEP LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END; stepped in ALL ELEVEN rungs rather than only the one that went red — D431). ⚠️ **AND THE TERM IS 1 WHERE THE PRINTINGS-KEYED CHAINS IN `censusAtHead.test.ts` TOOK 5** — this ladder counts FIXTURE IDS and this slice adds exactly one, which is the two-sizes-in-one-pass hazard D450's resume point named, arriving again at a third size. */ - 2 /* 🆕🆕🆕🆕 **D450 — A `- 2` TERM AT THE FRONT OF THIS LADDER, AND THE FROZEN ENDPOINT IS UNTOUCHED (D426).** TWO fixture ids: `fix-counterfold` (the three-fold attacker) and `fix-idlebody` (the Ability-bearing body its `abilityPokemon` half needs, which every other Ability-bearing fixture in the pool confounds with a live passive). ⚠️ EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D449 front term: +1 FIXTURE, `fix-counterput` — the synthetic {L} body carrying both printed word orders plus the `deals: true` attribution control. The five other bodies its deck fields are RE-USED, so the pool steps by ONE where the deck gained SIX slots (D425). EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D448 front term: +1 FIXTURE, `fix-scaledsnipe` — the synthetic {L} body carrying the two printed scaled sentences plus a one-axis control and an unprinted rider pair. EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D447 front term: +1 FIXTURE, `fix-pinpoint` — the synthetic body carrying the three printed sentences. EDITED AT THE FRONT, NEVER AT THE END. */ - 1 - 2 - 1 - 3 - 1 - 3 - 3 - 1 - 2 - 3 - 3 - 1 - 5 - 2 - 2 - 1 - 1 - 2 - 1 - 1 - 1 - 1 - 2 - 2 - 2 - 2 - 1 - 1 - 2 - 2 - 4 - 3 - 2 - 3 - 1 - 3 - 3 - 1 - 1 - 1 - 1 - 1 - 1).toBe(468);
    // 🆕🆕 D392 — a `- 3` term for this slice's three fixtures, at the FRONT of the chain.
    // 🆕🆕 D424 — a `- 5` term at the FRONT of EVERY rung below, the two-status pair's five Pokémon fixtures. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
    // 🆕🆕 D446 — a `- 1` term at the FRONT of ALL ELEVEN, `fix-roundbody` (the body
    // whose printed attack is NAMED "Round"). ⚠️ **ALL ELEVEN WERE STEPPED IN ONE PASS**
    // (D428/D431) — vitest stops at the first failing assertion in an `it`, so a green run
    // after fixing the one that reddened is evidence the runner stopped early and nothing
    // else. ⚠️ EDITED AT THE FRONT, NEVER AT THE END: the eleven frozen endpoints (468, 466,
    // 465, 463, 460, 459, 457, 454, 453, 450, 444) are untouched. The new fixture prints ZERO
    // Resistances and ZERO Weaknesses, so this rung's own subject is unmoved and only the
    // POOL SIZE stepped. ⚠️ The slice's other three bodies (`fix-attacker-ex`,
    // `fix-pokemon-v`, `fix-pokemon-vmax`) were already in the pool — a deck slot is not a
    // pool entry.
    expect(ids.length - 1 /* 🆕🆕 **D467 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN ENDPOINT IS UNTOUCHED** (D426/D437). ONE new `FIXTURE_POOL` id: `fix-benchnoun`, the two-attack carrier of `censusAttackCorpus.ts` file lines 544 and 622. ⚠️ **THE UNIT HERE IS FIXTURE IDS, NOT SENTENCES AND NOT PRINTINGS** — the same commit moves the sentence chains by 2 and the printing chains by 3, which is three different sizes in one pass (D451/D464/D466). The fixture prints ZERO Resistances and ZERO Weaknesses (`battler` leaves both null and this slice overrides neither), so this file's own subject is untouched and only the POOL SIZE moved — read against this rung's predicate rather than stepped by analogy (D465). ⚠️ AND THE ELEVEN WERE FOUND BY A STRING COUNT rather than by re-running the suite until it stopped failing, which is what stops one of them being missed. */ - 1 /* 🆕🆕 **D466 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN ENDPOINT IS UNTOUCHED** (D426/D437). ONE new `FIXTURE_POOL` id: `fix-stage2body`, the Stage 2 carrier of `censusAttackCorpus.ts` file line 589. ⚠️ **THE UNIT HERE IS FIXTURE IDS, NOT SENTENCES AND NOT PRINTINGS** — the same commit moves the sentence chains by 2 and the printing chains by 3, which is three different sizes in one pass (D451/D464). The fixture prints ZERO Resistances, ZERO Weaknesses and no Energy, so this file's own subject is untouched and only the POOL SIZE moved — read against this rung's predicate rather than stepped by analogy (D465).  */ - 1 /* 🆕🆕 **D465 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN TAIL IS UNTOUCHED** (D438's pattern, D426's rule). ONE body: `fix-recoil-scale`, the scaled-recoil demonstrator. It prints no Resistance, so only the POOL SIZE moves. ⚠️ EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕 **D462 — A `- 1` TERM AT THE FRONT, AND THE FROZEN ENDPOINT IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END — a tail that moves with the head asserts `head === head`). THE THREE-STATUS OXFORD LIST: corpus FILE LINE 679, *"Your opponent's Active Pokémon is now Burned, Confused, and Poisoned."*, **1 sentence / 2 legal printings** — this is the FIXTURE-id half (`fix-oxford`, one new synthetic body). ⚠️ **EVERY CHAIN IN THIS FILE WAS STEPPED IN ONE PASS, FOUND BY A STRING COUNT** rather than by re-running the suite: vitest stops an `it` at its first throw, so a second or third chain in the same `it` goes QUIET rather than red (D428). */ - 2 /* 🆕🆕 **D461 — A `- 2` TERM AT THE FRONT OF ALL ELEVEN RUNGS IN THIS LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END). 🛑 ALL ELEVEN WERE STEPPED, NOT ONLY THE ONE THAT REDDENED (D431) — vitest stops an `it` at its first throw, so the other ten would have gone QUIET rather than red. The slice's TWO Pokémon fixtures are `fix-scopedheal` and `fix-scopedheal-evo`, the SCOPED BOARD HEAL's Basic and Stage 1 bodies. */ - 1 /* 🆕🆕 **D460 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN RUNGS IN THIS LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END). 🛑 ALL ELEVEN WERE STEPPED, NOT ONLY THE ONE THAT REDDENED (D431) — vitest stops an `it` at its first throw, so the other ten would have gone QUIET rather than red. The slice's ONE Pokémon fixture is `fix-threshflip`, the COIN-COUNT THRESHOLD's attacker; `fix-titan`, `fix-energy` and `sv02-193` are all reused and add nothing to the pool. It prints ZERO Resistances and ZERO Weaknesses and carries no Energy, so this rung's own subject is untouched and only the POOL SIZE moved. */ - 1 /* 🆕🆕🆕🆕 **D451 — A `- 1` TERM AT THE FRONT OF THIS ELEVEN-DEEP LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END; stepped in ALL ELEVEN rungs rather than only the one that went red — D431). ⚠️ **AND THE TERM IS 1 WHERE THE PRINTINGS-KEYED CHAINS IN `censusAtHead.test.ts` TOOK 5** — this ladder counts FIXTURE IDS and this slice adds exactly one, which is the two-sizes-in-one-pass hazard D450's resume point named, arriving again at a third size. */ - 2 /* 🆕🆕🆕🆕 **D450 — A `- 2` TERM AT THE FRONT OF THIS LADDER, AND THE FROZEN ENDPOINT IS UNTOUCHED (D426).** TWO fixture ids: `fix-counterfold` (the three-fold attacker) and `fix-idlebody` (the Ability-bearing body its `abilityPokemon` half needs, which every other Ability-bearing fixture in the pool confounds with a live passive). ⚠️ EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D449 front term: +1 FIXTURE, `fix-counterput` — the synthetic {L} body carrying both printed word orders plus the `deals: true` attribution control. The five other bodies its deck fields are RE-USED, so the pool steps by ONE where the deck gained SIX slots (D425). EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D448 front term: +1 FIXTURE, `fix-scaledsnipe` — the synthetic {L} body carrying the two printed scaled sentences plus a one-axis control and an unprinted rider pair. EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D447 front term: +1 FIXTURE, `fix-pinpoint`. EDITED AT THE FRONT, NEVER AT THE END. */ - 1 - 2 - 1 - 3 - 1 - 3 - 3 - 1 - 2 - 3 - 3 - 1 - 5 - 2 - 2 - 1 - 1 - 2 - 1 - 1 - 1 - 1 - 2 - 2 - 2 - 2 - 1 - 1 - 2 - 2 - 4 - 3 - 2 - 3 - 1 - 3 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 2).toBe(466);
    expect(ids.length - 1 /* 🆕🆕 **D467 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN ENDPOINT IS UNTOUCHED** (D426/D437). ONE new `FIXTURE_POOL` id: `fix-benchnoun`, the two-attack carrier of `censusAttackCorpus.ts` file lines 544 and 622. ⚠️ **THE UNIT HERE IS FIXTURE IDS, NOT SENTENCES AND NOT PRINTINGS** — the same commit moves the sentence chains by 2 and the printing chains by 3, which is three different sizes in one pass (D451/D464/D466). The fixture prints ZERO Resistances and ZERO Weaknesses (`battler` leaves both null and this slice overrides neither), so this file's own subject is untouched and only the POOL SIZE moved — read against this rung's predicate rather than stepped by analogy (D465). ⚠️ AND THE ELEVEN WERE FOUND BY A STRING COUNT rather than by re-running the suite until it stopped failing, which is what stops one of them being missed. */ - 1 /* 🆕🆕 **D466 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN ENDPOINT IS UNTOUCHED** (D426/D437). ONE new `FIXTURE_POOL` id: `fix-stage2body`, the Stage 2 carrier of `censusAttackCorpus.ts` file line 589. ⚠️ **THE UNIT HERE IS FIXTURE IDS, NOT SENTENCES AND NOT PRINTINGS** — the same commit moves the sentence chains by 2 and the printing chains by 3, which is three different sizes in one pass (D451/D464). The fixture prints ZERO Resistances, ZERO Weaknesses and no Energy, so this file's own subject is untouched and only the POOL SIZE moved — read against this rung's predicate rather than stepped by analogy (D465).  */ - 1 /* 🆕🆕 **D465 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN TAIL IS UNTOUCHED** (D438's pattern, D426's rule). ONE body: `fix-recoil-scale`, the scaled-recoil demonstrator. It prints no Resistance, so only the POOL SIZE moves. ⚠️ EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕 **D462 — A `- 1` TERM AT THE FRONT, AND THE FROZEN ENDPOINT IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END — a tail that moves with the head asserts `head === head`). THE THREE-STATUS OXFORD LIST: corpus FILE LINE 679, *"Your opponent's Active Pokémon is now Burned, Confused, and Poisoned."*, **1 sentence / 2 legal printings** — this is the FIXTURE-id half (`fix-oxford`, one new synthetic body). ⚠️ **EVERY CHAIN IN THIS FILE WAS STEPPED IN ONE PASS, FOUND BY A STRING COUNT** rather than by re-running the suite: vitest stops an `it` at its first throw, so a second or third chain in the same `it` goes QUIET rather than red (D428). */ - 2 /* 🆕🆕 **D461 — A `- 2` TERM AT THE FRONT OF ALL ELEVEN RUNGS IN THIS LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END). 🛑 ALL ELEVEN WERE STEPPED, NOT ONLY THE ONE THAT REDDENED (D431) — vitest stops an `it` at its first throw, so the other ten would have gone QUIET rather than red. The slice's TWO Pokémon fixtures are `fix-scopedheal` and `fix-scopedheal-evo`, the SCOPED BOARD HEAL's Basic and Stage 1 bodies. */ - 1 /* 🆕🆕 **D460 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN RUNGS IN THIS LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END). 🛑 ALL ELEVEN WERE STEPPED, NOT ONLY THE ONE THAT REDDENED (D431) — vitest stops an `it` at its first throw, so the other ten would have gone QUIET rather than red. The slice's ONE Pokémon fixture is `fix-threshflip`, the COIN-COUNT THRESHOLD's attacker; `fix-titan`, `fix-energy` and `sv02-193` are all reused and add nothing to the pool. It prints ZERO Resistances and ZERO Weaknesses and carries no Energy, so this rung's own subject is untouched and only the POOL SIZE moved. */ - 1 /* 🆕🆕🆕🆕 **D451 — A `- 1` TERM AT THE FRONT OF THIS ELEVEN-DEEP LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END; stepped in ALL ELEVEN rungs rather than only the one that went red — D431). ⚠️ **AND THE TERM IS 1 WHERE THE PRINTINGS-KEYED CHAINS IN `censusAtHead.test.ts` TOOK 5** — this ladder counts FIXTURE IDS and this slice adds exactly one, which is the two-sizes-in-one-pass hazard D450's resume point named, arriving again at a third size. */ - 2 /* 🆕🆕🆕🆕 **D450 — A `- 2` TERM AT THE FRONT OF THIS LADDER, AND THE FROZEN ENDPOINT IS UNTOUCHED (D426).** TWO fixture ids: `fix-counterfold` (the three-fold attacker) and `fix-idlebody` (the Ability-bearing body its `abilityPokemon` half needs, which every other Ability-bearing fixture in the pool confounds with a live passive). ⚠️ EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D449 front term: +1 FIXTURE, `fix-counterput` — the synthetic {L} body carrying both printed word orders plus the `deals: true` attribution control. The five other bodies its deck fields are RE-USED, so the pool steps by ONE where the deck gained SIX slots (D425). EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D448 front term: +1 FIXTURE, `fix-scaledsnipe` — the synthetic {L} body carrying the two printed scaled sentences plus a one-axis control and an unprinted rider pair. EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D447 front term: +1 FIXTURE, `fix-pinpoint`. EDITED AT THE FRONT, NEVER AT THE END. */ - 1 - 2 - 1 - 3 - 1 - 3 - 3 - 1 - 2 - 3 - 3 - 1 - 5 - 2 - 2 - 1 - 1 - 2 - 1 - 1 - 1 - 1 - 2 - 2 - 2 - 2 - 1 - 1 - 2 - 2 - 4 - 3 - 2 - 3 - 1 - 3 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 2 - 1).toBe(465);
    expect(ids.length - 1 /* 🆕🆕 **D467 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN ENDPOINT IS UNTOUCHED** (D426/D437). ONE new `FIXTURE_POOL` id: `fix-benchnoun`, the two-attack carrier of `censusAttackCorpus.ts` file lines 544 and 622. ⚠️ **THE UNIT HERE IS FIXTURE IDS, NOT SENTENCES AND NOT PRINTINGS** — the same commit moves the sentence chains by 2 and the printing chains by 3, which is three different sizes in one pass (D451/D464/D466). The fixture prints ZERO Resistances and ZERO Weaknesses (`battler` leaves both null and this slice overrides neither), so this file's own subject is untouched and only the POOL SIZE moved — read against this rung's predicate rather than stepped by analogy (D465). ⚠️ AND THE ELEVEN WERE FOUND BY A STRING COUNT rather than by re-running the suite until it stopped failing, which is what stops one of them being missed. */ - 1 /* 🆕🆕 **D466 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN ENDPOINT IS UNTOUCHED** (D426/D437). ONE new `FIXTURE_POOL` id: `fix-stage2body`, the Stage 2 carrier of `censusAttackCorpus.ts` file line 589. ⚠️ **THE UNIT HERE IS FIXTURE IDS, NOT SENTENCES AND NOT PRINTINGS** — the same commit moves the sentence chains by 2 and the printing chains by 3, which is three different sizes in one pass (D451/D464). The fixture prints ZERO Resistances, ZERO Weaknesses and no Energy, so this file's own subject is untouched and only the POOL SIZE moved — read against this rung's predicate rather than stepped by analogy (D465).  */ - 1 /* 🆕🆕 **D465 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN TAIL IS UNTOUCHED** (D438's pattern, D426's rule). ONE body: `fix-recoil-scale`, the scaled-recoil demonstrator. It prints no Resistance, so only the POOL SIZE moves. ⚠️ EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕 **D462 — A `- 1` TERM AT THE FRONT, AND THE FROZEN ENDPOINT IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END — a tail that moves with the head asserts `head === head`). THE THREE-STATUS OXFORD LIST: corpus FILE LINE 679, *"Your opponent's Active Pokémon is now Burned, Confused, and Poisoned."*, **1 sentence / 2 legal printings** — this is the FIXTURE-id half (`fix-oxford`, one new synthetic body). ⚠️ **EVERY CHAIN IN THIS FILE WAS STEPPED IN ONE PASS, FOUND BY A STRING COUNT** rather than by re-running the suite: vitest stops an `it` at its first throw, so a second or third chain in the same `it` goes QUIET rather than red (D428). */ - 2 /* 🆕🆕 **D461 — A `- 2` TERM AT THE FRONT OF ALL ELEVEN RUNGS IN THIS LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END). 🛑 ALL ELEVEN WERE STEPPED, NOT ONLY THE ONE THAT REDDENED (D431) — vitest stops an `it` at its first throw, so the other ten would have gone QUIET rather than red. The slice's TWO Pokémon fixtures are `fix-scopedheal` and `fix-scopedheal-evo`, the SCOPED BOARD HEAL's Basic and Stage 1 bodies. */ - 1 /* 🆕🆕 **D460 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN RUNGS IN THIS LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END). 🛑 ALL ELEVEN WERE STEPPED, NOT ONLY THE ONE THAT REDDENED (D431) — vitest stops an `it` at its first throw, so the other ten would have gone QUIET rather than red. The slice's ONE Pokémon fixture is `fix-threshflip`, the COIN-COUNT THRESHOLD's attacker; `fix-titan`, `fix-energy` and `sv02-193` are all reused and add nothing to the pool. It prints ZERO Resistances and ZERO Weaknesses and carries no Energy, so this rung's own subject is untouched and only the POOL SIZE moved. */ - 1 /* 🆕🆕🆕🆕 **D451 — A `- 1` TERM AT THE FRONT OF THIS ELEVEN-DEEP LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END; stepped in ALL ELEVEN rungs rather than only the one that went red — D431). ⚠️ **AND THE TERM IS 1 WHERE THE PRINTINGS-KEYED CHAINS IN `censusAtHead.test.ts` TOOK 5** — this ladder counts FIXTURE IDS and this slice adds exactly one, which is the two-sizes-in-one-pass hazard D450's resume point named, arriving again at a third size. */ - 2 /* 🆕🆕🆕🆕 **D450 — A `- 2` TERM AT THE FRONT OF THIS LADDER, AND THE FROZEN ENDPOINT IS UNTOUCHED (D426).** TWO fixture ids: `fix-counterfold` (the three-fold attacker) and `fix-idlebody` (the Ability-bearing body its `abilityPokemon` half needs, which every other Ability-bearing fixture in the pool confounds with a live passive). ⚠️ EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D449 front term: +1 FIXTURE, `fix-counterput` — the synthetic {L} body carrying both printed word orders plus the `deals: true` attribution control. The five other bodies its deck fields are RE-USED, so the pool steps by ONE where the deck gained SIX slots (D425). EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D448 front term: +1 FIXTURE, `fix-scaledsnipe` — the synthetic {L} body carrying the two printed scaled sentences plus a one-axis control and an unprinted rider pair. EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D447 front term: +1 FIXTURE, `fix-pinpoint`. EDITED AT THE FRONT, NEVER AT THE END. */ - 1 - 2 - 1 - 3 - 1 - 3 - 3 - 1 - 2 - 3 - 3 - 1 - 5 - 2 - 2 - 1 - 1 - 2 - 1 - 1 - 1 - 1 - 2 - 2 - 2 - 2 - 1 - 1 - 2 - 2 - 4 - 3 - 2 - 3 - 1 - 3 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 2 - 1 - 2).toBe(463);
    expect(ids.length - 1 /* 🆕🆕 **D467 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN ENDPOINT IS UNTOUCHED** (D426/D437). ONE new `FIXTURE_POOL` id: `fix-benchnoun`, the two-attack carrier of `censusAttackCorpus.ts` file lines 544 and 622. ⚠️ **THE UNIT HERE IS FIXTURE IDS, NOT SENTENCES AND NOT PRINTINGS** — the same commit moves the sentence chains by 2 and the printing chains by 3, which is three different sizes in one pass (D451/D464/D466). The fixture prints ZERO Resistances and ZERO Weaknesses (`battler` leaves both null and this slice overrides neither), so this file's own subject is untouched and only the POOL SIZE moved — read against this rung's predicate rather than stepped by analogy (D465). ⚠️ AND THE ELEVEN WERE FOUND BY A STRING COUNT rather than by re-running the suite until it stopped failing, which is what stops one of them being missed. */ - 1 /* 🆕🆕 **D466 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN ENDPOINT IS UNTOUCHED** (D426/D437). ONE new `FIXTURE_POOL` id: `fix-stage2body`, the Stage 2 carrier of `censusAttackCorpus.ts` file line 589. ⚠️ **THE UNIT HERE IS FIXTURE IDS, NOT SENTENCES AND NOT PRINTINGS** — the same commit moves the sentence chains by 2 and the printing chains by 3, which is three different sizes in one pass (D451/D464). The fixture prints ZERO Resistances, ZERO Weaknesses and no Energy, so this file's own subject is untouched and only the POOL SIZE moved — read against this rung's predicate rather than stepped by analogy (D465).  */ - 1 /* 🆕🆕 **D465 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN TAIL IS UNTOUCHED** (D438's pattern, D426's rule). ONE body: `fix-recoil-scale`, the scaled-recoil demonstrator. It prints no Resistance, so only the POOL SIZE moves. ⚠️ EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕 **D462 — A `- 1` TERM AT THE FRONT, AND THE FROZEN ENDPOINT IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END — a tail that moves with the head asserts `head === head`). THE THREE-STATUS OXFORD LIST: corpus FILE LINE 679, *"Your opponent's Active Pokémon is now Burned, Confused, and Poisoned."*, **1 sentence / 2 legal printings** — this is the FIXTURE-id half (`fix-oxford`, one new synthetic body). ⚠️ **EVERY CHAIN IN THIS FILE WAS STEPPED IN ONE PASS, FOUND BY A STRING COUNT** rather than by re-running the suite: vitest stops an `it` at its first throw, so a second or third chain in the same `it` goes QUIET rather than red (D428). */ - 2 /* 🆕🆕 **D461 — A `- 2` TERM AT THE FRONT OF ALL ELEVEN RUNGS IN THIS LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END). 🛑 ALL ELEVEN WERE STEPPED, NOT ONLY THE ONE THAT REDDENED (D431) — vitest stops an `it` at its first throw, so the other ten would have gone QUIET rather than red. The slice's TWO Pokémon fixtures are `fix-scopedheal` and `fix-scopedheal-evo`, the SCOPED BOARD HEAL's Basic and Stage 1 bodies. */ - 1 /* 🆕🆕 **D460 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN RUNGS IN THIS LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END). 🛑 ALL ELEVEN WERE STEPPED, NOT ONLY THE ONE THAT REDDENED (D431) — vitest stops an `it` at its first throw, so the other ten would have gone QUIET rather than red. The slice's ONE Pokémon fixture is `fix-threshflip`, the COIN-COUNT THRESHOLD's attacker; `fix-titan`, `fix-energy` and `sv02-193` are all reused and add nothing to the pool. It prints ZERO Resistances and ZERO Weaknesses and carries no Energy, so this rung's own subject is untouched and only the POOL SIZE moved. */ - 1 /* 🆕🆕🆕🆕 **D451 — A `- 1` TERM AT THE FRONT OF THIS ELEVEN-DEEP LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END; stepped in ALL ELEVEN rungs rather than only the one that went red — D431). ⚠️ **AND THE TERM IS 1 WHERE THE PRINTINGS-KEYED CHAINS IN `censusAtHead.test.ts` TOOK 5** — this ladder counts FIXTURE IDS and this slice adds exactly one, which is the two-sizes-in-one-pass hazard D450's resume point named, arriving again at a third size. */ - 2 /* 🆕🆕🆕🆕 **D450 — A `- 2` TERM AT THE FRONT OF THIS LADDER, AND THE FROZEN ENDPOINT IS UNTOUCHED (D426).** TWO fixture ids: `fix-counterfold` (the three-fold attacker) and `fix-idlebody` (the Ability-bearing body its `abilityPokemon` half needs, which every other Ability-bearing fixture in the pool confounds with a live passive). ⚠️ EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D449 front term: +1 FIXTURE, `fix-counterput` — the synthetic {L} body carrying both printed word orders plus the `deals: true` attribution control. The five other bodies its deck fields are RE-USED, so the pool steps by ONE where the deck gained SIX slots (D425). EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D448 front term: +1 FIXTURE, `fix-scaledsnipe` — the synthetic {L} body carrying the two printed scaled sentences plus a one-axis control and an unprinted rider pair. EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D447 front term: +1 FIXTURE, `fix-pinpoint`. EDITED AT THE FRONT, NEVER AT THE END. */ - 1 - 2 - 1 - 3 - 1 - 3 - 3 - 1 - 2 - 3 - 3 - 1 - 5 - 2 - 2 - 1 - 1 - 2 - 1 - 1 - 1 - 1 - 2 - 2 - 2 - 2 - 1 - 1 - 2 - 2 - 4 - 3 - 2 - 3 - 1 - 3 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 2 - 1 - 2 - 3).toBe(460);
    expect(ids.length - 1 /* 🆕🆕 **D467 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN ENDPOINT IS UNTOUCHED** (D426/D437). ONE new `FIXTURE_POOL` id: `fix-benchnoun`, the two-attack carrier of `censusAttackCorpus.ts` file lines 544 and 622. ⚠️ **THE UNIT HERE IS FIXTURE IDS, NOT SENTENCES AND NOT PRINTINGS** — the same commit moves the sentence chains by 2 and the printing chains by 3, which is three different sizes in one pass (D451/D464/D466). The fixture prints ZERO Resistances and ZERO Weaknesses (`battler` leaves both null and this slice overrides neither), so this file's own subject is untouched and only the POOL SIZE moved — read against this rung's predicate rather than stepped by analogy (D465). ⚠️ AND THE ELEVEN WERE FOUND BY A STRING COUNT rather than by re-running the suite until it stopped failing, which is what stops one of them being missed. */ - 1 /* 🆕🆕 **D466 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN ENDPOINT IS UNTOUCHED** (D426/D437). ONE new `FIXTURE_POOL` id: `fix-stage2body`, the Stage 2 carrier of `censusAttackCorpus.ts` file line 589. ⚠️ **THE UNIT HERE IS FIXTURE IDS, NOT SENTENCES AND NOT PRINTINGS** — the same commit moves the sentence chains by 2 and the printing chains by 3, which is three different sizes in one pass (D451/D464). The fixture prints ZERO Resistances, ZERO Weaknesses and no Energy, so this file's own subject is untouched and only the POOL SIZE moved — read against this rung's predicate rather than stepped by analogy (D465).  */ - 1 /* 🆕🆕 **D465 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN TAIL IS UNTOUCHED** (D438's pattern, D426's rule). ONE body: `fix-recoil-scale`, the scaled-recoil demonstrator. It prints no Resistance, so only the POOL SIZE moves. ⚠️ EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕 **D462 — A `- 1` TERM AT THE FRONT, AND THE FROZEN ENDPOINT IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END — a tail that moves with the head asserts `head === head`). THE THREE-STATUS OXFORD LIST: corpus FILE LINE 679, *"Your opponent's Active Pokémon is now Burned, Confused, and Poisoned."*, **1 sentence / 2 legal printings** — this is the FIXTURE-id half (`fix-oxford`, one new synthetic body). ⚠️ **EVERY CHAIN IN THIS FILE WAS STEPPED IN ONE PASS, FOUND BY A STRING COUNT** rather than by re-running the suite: vitest stops an `it` at its first throw, so a second or third chain in the same `it` goes QUIET rather than red (D428). */ - 2 /* 🆕🆕 **D461 — A `- 2` TERM AT THE FRONT OF ALL ELEVEN RUNGS IN THIS LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END). 🛑 ALL ELEVEN WERE STEPPED, NOT ONLY THE ONE THAT REDDENED (D431) — vitest stops an `it` at its first throw, so the other ten would have gone QUIET rather than red. The slice's TWO Pokémon fixtures are `fix-scopedheal` and `fix-scopedheal-evo`, the SCOPED BOARD HEAL's Basic and Stage 1 bodies. */ - 1 /* 🆕🆕 **D460 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN RUNGS IN THIS LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END). 🛑 ALL ELEVEN WERE STEPPED, NOT ONLY THE ONE THAT REDDENED (D431) — vitest stops an `it` at its first throw, so the other ten would have gone QUIET rather than red. The slice's ONE Pokémon fixture is `fix-threshflip`, the COIN-COUNT THRESHOLD's attacker; `fix-titan`, `fix-energy` and `sv02-193` are all reused and add nothing to the pool. It prints ZERO Resistances and ZERO Weaknesses and carries no Energy, so this rung's own subject is untouched and only the POOL SIZE moved. */ - 1 /* 🆕🆕🆕🆕 **D451 — A `- 1` TERM AT THE FRONT OF THIS ELEVEN-DEEP LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END; stepped in ALL ELEVEN rungs rather than only the one that went red — D431). ⚠️ **AND THE TERM IS 1 WHERE THE PRINTINGS-KEYED CHAINS IN `censusAtHead.test.ts` TOOK 5** — this ladder counts FIXTURE IDS and this slice adds exactly one, which is the two-sizes-in-one-pass hazard D450's resume point named, arriving again at a third size. */ - 2 /* 🆕🆕🆕🆕 **D450 — A `- 2` TERM AT THE FRONT OF THIS LADDER, AND THE FROZEN ENDPOINT IS UNTOUCHED (D426).** TWO fixture ids: `fix-counterfold` (the three-fold attacker) and `fix-idlebody` (the Ability-bearing body its `abilityPokemon` half needs, which every other Ability-bearing fixture in the pool confounds with a live passive). ⚠️ EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D449 front term: +1 FIXTURE, `fix-counterput` — the synthetic {L} body carrying both printed word orders plus the `deals: true` attribution control. The five other bodies its deck fields are RE-USED, so the pool steps by ONE where the deck gained SIX slots (D425). EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D448 front term: +1 FIXTURE, `fix-scaledsnipe` — the synthetic {L} body carrying the two printed scaled sentences plus a one-axis control and an unprinted rider pair. EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D447 front term: +1 FIXTURE, `fix-pinpoint`. EDITED AT THE FRONT, NEVER AT THE END. */ - 1 - 2 - 1 - 3 - 1 - 3 - 3 - 1 - 2 - 3 - 3 - 1 - 5 - 2 - 2 - 1 - 1 - 2 - 1 - 1 - 1 - 1 - 2 - 2 - 2 - 2 - 1 - 1 - 2 - 2 - 4 - 3 - 2 - 3 - 1 - 3 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 2 - 1 - 2 - 3 - 1).toBe(459);
    expect(ids.length - 1 /* 🆕🆕 **D467 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN ENDPOINT IS UNTOUCHED** (D426/D437). ONE new `FIXTURE_POOL` id: `fix-benchnoun`, the two-attack carrier of `censusAttackCorpus.ts` file lines 544 and 622. ⚠️ **THE UNIT HERE IS FIXTURE IDS, NOT SENTENCES AND NOT PRINTINGS** — the same commit moves the sentence chains by 2 and the printing chains by 3, which is three different sizes in one pass (D451/D464/D466). The fixture prints ZERO Resistances and ZERO Weaknesses (`battler` leaves both null and this slice overrides neither), so this file's own subject is untouched and only the POOL SIZE moved — read against this rung's predicate rather than stepped by analogy (D465). ⚠️ AND THE ELEVEN WERE FOUND BY A STRING COUNT rather than by re-running the suite until it stopped failing, which is what stops one of them being missed. */ - 1 /* 🆕🆕 **D466 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN ENDPOINT IS UNTOUCHED** (D426/D437). ONE new `FIXTURE_POOL` id: `fix-stage2body`, the Stage 2 carrier of `censusAttackCorpus.ts` file line 589. ⚠️ **THE UNIT HERE IS FIXTURE IDS, NOT SENTENCES AND NOT PRINTINGS** — the same commit moves the sentence chains by 2 and the printing chains by 3, which is three different sizes in one pass (D451/D464). The fixture prints ZERO Resistances, ZERO Weaknesses and no Energy, so this file's own subject is untouched and only the POOL SIZE moved — read against this rung's predicate rather than stepped by analogy (D465).  */ - 1 /* 🆕🆕 **D465 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN TAIL IS UNTOUCHED** (D438's pattern, D426's rule). ONE body: `fix-recoil-scale`, the scaled-recoil demonstrator. It prints no Resistance, so only the POOL SIZE moves. ⚠️ EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕 **D462 — A `- 1` TERM AT THE FRONT, AND THE FROZEN ENDPOINT IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END — a tail that moves with the head asserts `head === head`). THE THREE-STATUS OXFORD LIST: corpus FILE LINE 679, *"Your opponent's Active Pokémon is now Burned, Confused, and Poisoned."*, **1 sentence / 2 legal printings** — this is the FIXTURE-id half (`fix-oxford`, one new synthetic body). ⚠️ **EVERY CHAIN IN THIS FILE WAS STEPPED IN ONE PASS, FOUND BY A STRING COUNT** rather than by re-running the suite: vitest stops an `it` at its first throw, so a second or third chain in the same `it` goes QUIET rather than red (D428). */ - 2 /* 🆕🆕 **D461 — A `- 2` TERM AT THE FRONT OF ALL ELEVEN RUNGS IN THIS LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END). 🛑 ALL ELEVEN WERE STEPPED, NOT ONLY THE ONE THAT REDDENED (D431) — vitest stops an `it` at its first throw, so the other ten would have gone QUIET rather than red. The slice's TWO Pokémon fixtures are `fix-scopedheal` and `fix-scopedheal-evo`, the SCOPED BOARD HEAL's Basic and Stage 1 bodies. */ - 1 /* 🆕🆕 **D460 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN RUNGS IN THIS LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END). 🛑 ALL ELEVEN WERE STEPPED, NOT ONLY THE ONE THAT REDDENED (D431) — vitest stops an `it` at its first throw, so the other ten would have gone QUIET rather than red. The slice's ONE Pokémon fixture is `fix-threshflip`, the COIN-COUNT THRESHOLD's attacker; `fix-titan`, `fix-energy` and `sv02-193` are all reused and add nothing to the pool. It prints ZERO Resistances and ZERO Weaknesses and carries no Energy, so this rung's own subject is untouched and only the POOL SIZE moved. */ - 1 /* 🆕🆕🆕🆕 **D451 — A `- 1` TERM AT THE FRONT OF THIS ELEVEN-DEEP LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END; stepped in ALL ELEVEN rungs rather than only the one that went red — D431). ⚠️ **AND THE TERM IS 1 WHERE THE PRINTINGS-KEYED CHAINS IN `censusAtHead.test.ts` TOOK 5** — this ladder counts FIXTURE IDS and this slice adds exactly one, which is the two-sizes-in-one-pass hazard D450's resume point named, arriving again at a third size. */ - 2 /* 🆕🆕🆕🆕 **D450 — A `- 2` TERM AT THE FRONT OF THIS LADDER, AND THE FROZEN ENDPOINT IS UNTOUCHED (D426).** TWO fixture ids: `fix-counterfold` (the three-fold attacker) and `fix-idlebody` (the Ability-bearing body its `abilityPokemon` half needs, which every other Ability-bearing fixture in the pool confounds with a live passive). ⚠️ EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D449 front term: +1 FIXTURE, `fix-counterput` — the synthetic {L} body carrying both printed word orders plus the `deals: true` attribution control. The five other bodies its deck fields are RE-USED, so the pool steps by ONE where the deck gained SIX slots (D425). EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D448 front term: +1 FIXTURE, `fix-scaledsnipe` — the synthetic {L} body carrying the two printed scaled sentences plus a one-axis control and an unprinted rider pair. EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D447 front term: +1 FIXTURE, `fix-pinpoint`. EDITED AT THE FRONT, NEVER AT THE END. */ - 1 - 2 - 1 - 3 - 1 - 3 - 3 - 1 - 2 - 3 - 3 - 1 - 5 - 2 - 2 - 1 - 1 - 2 - 1 - 1 - 1 - 1 - 2 - 2 - 2 - 2 - 1 - 1 - 2 - 2 - 4 - 3 - 2 - 3 - 1 - 3 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 2 - 1 - 2 - 3 - 1 - 2).toBe(457);
    expect(ids.length - 1 /* 🆕🆕 **D467 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN ENDPOINT IS UNTOUCHED** (D426/D437). ONE new `FIXTURE_POOL` id: `fix-benchnoun`, the two-attack carrier of `censusAttackCorpus.ts` file lines 544 and 622. ⚠️ **THE UNIT HERE IS FIXTURE IDS, NOT SENTENCES AND NOT PRINTINGS** — the same commit moves the sentence chains by 2 and the printing chains by 3, which is three different sizes in one pass (D451/D464/D466). The fixture prints ZERO Resistances and ZERO Weaknesses (`battler` leaves both null and this slice overrides neither), so this file's own subject is untouched and only the POOL SIZE moved — read against this rung's predicate rather than stepped by analogy (D465). ⚠️ AND THE ELEVEN WERE FOUND BY A STRING COUNT rather than by re-running the suite until it stopped failing, which is what stops one of them being missed. */ - 1 /* 🆕🆕 **D466 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN ENDPOINT IS UNTOUCHED** (D426/D437). ONE new `FIXTURE_POOL` id: `fix-stage2body`, the Stage 2 carrier of `censusAttackCorpus.ts` file line 589. ⚠️ **THE UNIT HERE IS FIXTURE IDS, NOT SENTENCES AND NOT PRINTINGS** — the same commit moves the sentence chains by 2 and the printing chains by 3, which is three different sizes in one pass (D451/D464). The fixture prints ZERO Resistances, ZERO Weaknesses and no Energy, so this file's own subject is untouched and only the POOL SIZE moved — read against this rung's predicate rather than stepped by analogy (D465).  */ - 1 /* 🆕🆕 **D465 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN TAIL IS UNTOUCHED** (D438's pattern, D426's rule). ONE body: `fix-recoil-scale`, the scaled-recoil demonstrator. It prints no Resistance, so only the POOL SIZE moves. ⚠️ EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕 **D462 — A `- 1` TERM AT THE FRONT, AND THE FROZEN ENDPOINT IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END — a tail that moves with the head asserts `head === head`). THE THREE-STATUS OXFORD LIST: corpus FILE LINE 679, *"Your opponent's Active Pokémon is now Burned, Confused, and Poisoned."*, **1 sentence / 2 legal printings** — this is the FIXTURE-id half (`fix-oxford`, one new synthetic body). ⚠️ **EVERY CHAIN IN THIS FILE WAS STEPPED IN ONE PASS, FOUND BY A STRING COUNT** rather than by re-running the suite: vitest stops an `it` at its first throw, so a second or third chain in the same `it` goes QUIET rather than red (D428). */ - 2 /* 🆕🆕 **D461 — A `- 2` TERM AT THE FRONT OF ALL ELEVEN RUNGS IN THIS LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END). 🛑 ALL ELEVEN WERE STEPPED, NOT ONLY THE ONE THAT REDDENED (D431) — vitest stops an `it` at its first throw, so the other ten would have gone QUIET rather than red. The slice's TWO Pokémon fixtures are `fix-scopedheal` and `fix-scopedheal-evo`, the SCOPED BOARD HEAL's Basic and Stage 1 bodies. */ - 1 /* 🆕🆕 **D460 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN RUNGS IN THIS LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END). 🛑 ALL ELEVEN WERE STEPPED, NOT ONLY THE ONE THAT REDDENED (D431) — vitest stops an `it` at its first throw, so the other ten would have gone QUIET rather than red. The slice's ONE Pokémon fixture is `fix-threshflip`, the COIN-COUNT THRESHOLD's attacker; `fix-titan`, `fix-energy` and `sv02-193` are all reused and add nothing to the pool. It prints ZERO Resistances and ZERO Weaknesses and carries no Energy, so this rung's own subject is untouched and only the POOL SIZE moved. */ - 1 /* 🆕🆕🆕🆕 **D451 — A `- 1` TERM AT THE FRONT OF THIS ELEVEN-DEEP LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END; stepped in ALL ELEVEN rungs rather than only the one that went red — D431). ⚠️ **AND THE TERM IS 1 WHERE THE PRINTINGS-KEYED CHAINS IN `censusAtHead.test.ts` TOOK 5** — this ladder counts FIXTURE IDS and this slice adds exactly one, which is the two-sizes-in-one-pass hazard D450's resume point named, arriving again at a third size. */ - 2 /* 🆕🆕🆕🆕 **D450 — A `- 2` TERM AT THE FRONT OF THIS LADDER, AND THE FROZEN ENDPOINT IS UNTOUCHED (D426).** TWO fixture ids: `fix-counterfold` (the three-fold attacker) and `fix-idlebody` (the Ability-bearing body its `abilityPokemon` half needs, which every other Ability-bearing fixture in the pool confounds with a live passive). ⚠️ EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D449 front term: +1 FIXTURE, `fix-counterput` — the synthetic {L} body carrying both printed word orders plus the `deals: true` attribution control. The five other bodies its deck fields are RE-USED, so the pool steps by ONE where the deck gained SIX slots (D425). EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D448 front term: +1 FIXTURE, `fix-scaledsnipe` — the synthetic {L} body carrying the two printed scaled sentences plus a one-axis control and an unprinted rider pair. EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D447 front term: +1 FIXTURE, `fix-pinpoint`. EDITED AT THE FRONT, NEVER AT THE END. */ - 1 - 2 - 1 - 3 - 1 - 3 - 3 - 1 - 2 - 3 - 3 - 1 - 5 - 2 - 2 - 1 - 1 - 2 - 1 - 1 - 1 - 1 - 2 - 2 - 2 - 2 - 1 - 1 - 2 - 2 - 4 - 3 - 2 - 3 - 1 - 3 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 2 - 1 - 2 - 3 - 1 - 2 - 3).toBe(454);
    expect(ids.length - 1 /* 🆕🆕 **D467 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN ENDPOINT IS UNTOUCHED** (D426/D437). ONE new `FIXTURE_POOL` id: `fix-benchnoun`, the two-attack carrier of `censusAttackCorpus.ts` file lines 544 and 622. ⚠️ **THE UNIT HERE IS FIXTURE IDS, NOT SENTENCES AND NOT PRINTINGS** — the same commit moves the sentence chains by 2 and the printing chains by 3, which is three different sizes in one pass (D451/D464/D466). The fixture prints ZERO Resistances and ZERO Weaknesses (`battler` leaves both null and this slice overrides neither), so this file's own subject is untouched and only the POOL SIZE moved — read against this rung's predicate rather than stepped by analogy (D465). ⚠️ AND THE ELEVEN WERE FOUND BY A STRING COUNT rather than by re-running the suite until it stopped failing, which is what stops one of them being missed. */ - 1 /* 🆕🆕 **D466 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN ENDPOINT IS UNTOUCHED** (D426/D437). ONE new `FIXTURE_POOL` id: `fix-stage2body`, the Stage 2 carrier of `censusAttackCorpus.ts` file line 589. ⚠️ **THE UNIT HERE IS FIXTURE IDS, NOT SENTENCES AND NOT PRINTINGS** — the same commit moves the sentence chains by 2 and the printing chains by 3, which is three different sizes in one pass (D451/D464). The fixture prints ZERO Resistances, ZERO Weaknesses and no Energy, so this file's own subject is untouched and only the POOL SIZE moved — read against this rung's predicate rather than stepped by analogy (D465).  */ - 1 /* 🆕🆕 **D465 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN TAIL IS UNTOUCHED** (D438's pattern, D426's rule). ONE body: `fix-recoil-scale`, the scaled-recoil demonstrator. It prints no Resistance, so only the POOL SIZE moves. ⚠️ EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕 **D462 — A `- 1` TERM AT THE FRONT, AND THE FROZEN ENDPOINT IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END — a tail that moves with the head asserts `head === head`). THE THREE-STATUS OXFORD LIST: corpus FILE LINE 679, *"Your opponent's Active Pokémon is now Burned, Confused, and Poisoned."*, **1 sentence / 2 legal printings** — this is the FIXTURE-id half (`fix-oxford`, one new synthetic body). ⚠️ **EVERY CHAIN IN THIS FILE WAS STEPPED IN ONE PASS, FOUND BY A STRING COUNT** rather than by re-running the suite: vitest stops an `it` at its first throw, so a second or third chain in the same `it` goes QUIET rather than red (D428). */ - 2 /* 🆕🆕 **D461 — A `- 2` TERM AT THE FRONT OF ALL ELEVEN RUNGS IN THIS LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END). 🛑 ALL ELEVEN WERE STEPPED, NOT ONLY THE ONE THAT REDDENED (D431) — vitest stops an `it` at its first throw, so the other ten would have gone QUIET rather than red. The slice's TWO Pokémon fixtures are `fix-scopedheal` and `fix-scopedheal-evo`, the SCOPED BOARD HEAL's Basic and Stage 1 bodies. */ - 1 /* 🆕🆕 **D460 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN RUNGS IN THIS LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END). 🛑 ALL ELEVEN WERE STEPPED, NOT ONLY THE ONE THAT REDDENED (D431) — vitest stops an `it` at its first throw, so the other ten would have gone QUIET rather than red. The slice's ONE Pokémon fixture is `fix-threshflip`, the COIN-COUNT THRESHOLD's attacker; `fix-titan`, `fix-energy` and `sv02-193` are all reused and add nothing to the pool. It prints ZERO Resistances and ZERO Weaknesses and carries no Energy, so this rung's own subject is untouched and only the POOL SIZE moved. */ - 1 /* 🆕🆕🆕🆕 **D451 — A `- 1` TERM AT THE FRONT OF THIS ELEVEN-DEEP LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END; stepped in ALL ELEVEN rungs rather than only the one that went red — D431). ⚠️ **AND THE TERM IS 1 WHERE THE PRINTINGS-KEYED CHAINS IN `censusAtHead.test.ts` TOOK 5** — this ladder counts FIXTURE IDS and this slice adds exactly one, which is the two-sizes-in-one-pass hazard D450's resume point named, arriving again at a third size. */ - 2 /* 🆕🆕🆕🆕 **D450 — A `- 2` TERM AT THE FRONT OF THIS LADDER, AND THE FROZEN ENDPOINT IS UNTOUCHED (D426).** TWO fixture ids: `fix-counterfold` (the three-fold attacker) and `fix-idlebody` (the Ability-bearing body its `abilityPokemon` half needs, which every other Ability-bearing fixture in the pool confounds with a live passive). ⚠️ EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D449 front term: +1 FIXTURE, `fix-counterput` — the synthetic {L} body carrying both printed word orders plus the `deals: true` attribution control. The five other bodies its deck fields are RE-USED, so the pool steps by ONE where the deck gained SIX slots (D425). EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D448 front term: +1 FIXTURE, `fix-scaledsnipe` — the synthetic {L} body carrying the two printed scaled sentences plus a one-axis control and an unprinted rider pair. EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D447 front term: +1 FIXTURE, `fix-pinpoint`. EDITED AT THE FRONT, NEVER AT THE END. */ - 1 - 2 - 1 - 3 - 1 - 3 - 3 - 1 - 2 - 3 - 3 - 1 - 5 - 2 - 2 - 1 - 1 - 2 - 1 - 1 - 1 - 1 - 2 - 2 - 2 - 2 - 1 - 1 - 2 - 2 - 4 - 3 - 2 - 3 - 1 - 3 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 2 - 1 - 2 - 3 - 1 - 2 - 3 - 1).toBe(453);
    expect(ids.length - 1 /* 🆕🆕 **D467 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN ENDPOINT IS UNTOUCHED** (D426/D437). ONE new `FIXTURE_POOL` id: `fix-benchnoun`, the two-attack carrier of `censusAttackCorpus.ts` file lines 544 and 622. ⚠️ **THE UNIT HERE IS FIXTURE IDS, NOT SENTENCES AND NOT PRINTINGS** — the same commit moves the sentence chains by 2 and the printing chains by 3, which is three different sizes in one pass (D451/D464/D466). The fixture prints ZERO Resistances and ZERO Weaknesses (`battler` leaves both null and this slice overrides neither), so this file's own subject is untouched and only the POOL SIZE moved — read against this rung's predicate rather than stepped by analogy (D465). ⚠️ AND THE ELEVEN WERE FOUND BY A STRING COUNT rather than by re-running the suite until it stopped failing, which is what stops one of them being missed. */ - 1 /* 🆕🆕 **D466 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN ENDPOINT IS UNTOUCHED** (D426/D437). ONE new `FIXTURE_POOL` id: `fix-stage2body`, the Stage 2 carrier of `censusAttackCorpus.ts` file line 589. ⚠️ **THE UNIT HERE IS FIXTURE IDS, NOT SENTENCES AND NOT PRINTINGS** — the same commit moves the sentence chains by 2 and the printing chains by 3, which is three different sizes in one pass (D451/D464). The fixture prints ZERO Resistances, ZERO Weaknesses and no Energy, so this file's own subject is untouched and only the POOL SIZE moved — read against this rung's predicate rather than stepped by analogy (D465).  */ - 1 /* 🆕🆕 **D465 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN TAIL IS UNTOUCHED** (D438's pattern, D426's rule). ONE body: `fix-recoil-scale`, the scaled-recoil demonstrator. It prints no Resistance, so only the POOL SIZE moves. ⚠️ EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕 **D462 — A `- 1` TERM AT THE FRONT, AND THE FROZEN ENDPOINT IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END — a tail that moves with the head asserts `head === head`). THE THREE-STATUS OXFORD LIST: corpus FILE LINE 679, *"Your opponent's Active Pokémon is now Burned, Confused, and Poisoned."*, **1 sentence / 2 legal printings** — this is the FIXTURE-id half (`fix-oxford`, one new synthetic body). ⚠️ **EVERY CHAIN IN THIS FILE WAS STEPPED IN ONE PASS, FOUND BY A STRING COUNT** rather than by re-running the suite: vitest stops an `it` at its first throw, so a second or third chain in the same `it` goes QUIET rather than red (D428). */ - 2 /* 🆕🆕 **D461 — A `- 2` TERM AT THE FRONT OF ALL ELEVEN RUNGS IN THIS LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END). 🛑 ALL ELEVEN WERE STEPPED, NOT ONLY THE ONE THAT REDDENED (D431) — vitest stops an `it` at its first throw, so the other ten would have gone QUIET rather than red. The slice's TWO Pokémon fixtures are `fix-scopedheal` and `fix-scopedheal-evo`, the SCOPED BOARD HEAL's Basic and Stage 1 bodies. */ - 1 /* 🆕🆕 **D460 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN RUNGS IN THIS LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END). 🛑 ALL ELEVEN WERE STEPPED, NOT ONLY THE ONE THAT REDDENED (D431) — vitest stops an `it` at its first throw, so the other ten would have gone QUIET rather than red. The slice's ONE Pokémon fixture is `fix-threshflip`, the COIN-COUNT THRESHOLD's attacker; `fix-titan`, `fix-energy` and `sv02-193` are all reused and add nothing to the pool. It prints ZERO Resistances and ZERO Weaknesses and carries no Energy, so this rung's own subject is untouched and only the POOL SIZE moved. */ - 1 /* 🆕🆕🆕🆕 **D451 — A `- 1` TERM AT THE FRONT OF THIS ELEVEN-DEEP LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END; stepped in ALL ELEVEN rungs rather than only the one that went red — D431). ⚠️ **AND THE TERM IS 1 WHERE THE PRINTINGS-KEYED CHAINS IN `censusAtHead.test.ts` TOOK 5** — this ladder counts FIXTURE IDS and this slice adds exactly one, which is the two-sizes-in-one-pass hazard D450's resume point named, arriving again at a third size. */ - 2 /* 🆕🆕🆕🆕 **D450 — A `- 2` TERM AT THE FRONT OF THIS LADDER, AND THE FROZEN ENDPOINT IS UNTOUCHED (D426).** TWO fixture ids: `fix-counterfold` (the three-fold attacker) and `fix-idlebody` (the Ability-bearing body its `abilityPokemon` half needs, which every other Ability-bearing fixture in the pool confounds with a live passive). ⚠️ EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D449 front term: +1 FIXTURE, `fix-counterput` — the synthetic {L} body carrying both printed word orders plus the `deals: true` attribution control. The five other bodies its deck fields are RE-USED, so the pool steps by ONE where the deck gained SIX slots (D425). EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D448 front term: +1 FIXTURE, `fix-scaledsnipe` — the synthetic {L} body carrying the two printed scaled sentences plus a one-axis control and an unprinted rider pair. EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D447 front term: +1 FIXTURE, `fix-pinpoint`. EDITED AT THE FRONT, NEVER AT THE END. */ - 1 - 2 - 1 - 3 - 1 - 3 - 3 - 1 - 2 - 3 - 3 - 1 - 5 - 2 - 2 - 1 - 1 - 2 - 1 - 1 - 1 - 1 - 2 - 2 - 2 - 2 - 1 - 1 - 2 - 2 - 4 - 3 - 2 - 3 - 1 - 3 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 2 - 1 - 2 - 3 - 1 - 2 - 3 - 1 - 3).toBe(450);
    expect(ids.length - 1 /* 🆕🆕 **D467 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN ENDPOINT IS UNTOUCHED** (D426/D437). ONE new `FIXTURE_POOL` id: `fix-benchnoun`, the two-attack carrier of `censusAttackCorpus.ts` file lines 544 and 622. ⚠️ **THE UNIT HERE IS FIXTURE IDS, NOT SENTENCES AND NOT PRINTINGS** — the same commit moves the sentence chains by 2 and the printing chains by 3, which is three different sizes in one pass (D451/D464/D466). The fixture prints ZERO Resistances and ZERO Weaknesses (`battler` leaves both null and this slice overrides neither), so this file's own subject is untouched and only the POOL SIZE moved — read against this rung's predicate rather than stepped by analogy (D465). ⚠️ AND THE ELEVEN WERE FOUND BY A STRING COUNT rather than by re-running the suite until it stopped failing, which is what stops one of them being missed. */ - 1 /* 🆕🆕 **D466 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN ENDPOINT IS UNTOUCHED** (D426/D437). ONE new `FIXTURE_POOL` id: `fix-stage2body`, the Stage 2 carrier of `censusAttackCorpus.ts` file line 589. ⚠️ **THE UNIT HERE IS FIXTURE IDS, NOT SENTENCES AND NOT PRINTINGS** — the same commit moves the sentence chains by 2 and the printing chains by 3, which is three different sizes in one pass (D451/D464). The fixture prints ZERO Resistances, ZERO Weaknesses and no Energy, so this file's own subject is untouched and only the POOL SIZE moved — read against this rung's predicate rather than stepped by analogy (D465).  */ - 1 /* 🆕🆕 **D465 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN NESTED RUNGS, AND EVERY FROZEN TAIL IS UNTOUCHED** (D438's pattern, D426's rule). ONE body: `fix-recoil-scale`, the scaled-recoil demonstrator. It prints no Resistance, so only the POOL SIZE moves. ⚠️ EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕 **D462 — A `- 1` TERM AT THE FRONT, AND THE FROZEN ENDPOINT IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END — a tail that moves with the head asserts `head === head`). THE THREE-STATUS OXFORD LIST: corpus FILE LINE 679, *"Your opponent's Active Pokémon is now Burned, Confused, and Poisoned."*, **1 sentence / 2 legal printings** — this is the FIXTURE-id half (`fix-oxford`, one new synthetic body). ⚠️ **EVERY CHAIN IN THIS FILE WAS STEPPED IN ONE PASS, FOUND BY A STRING COUNT** rather than by re-running the suite: vitest stops an `it` at its first throw, so a second or third chain in the same `it` goes QUIET rather than red (D428). */ - 2 /* 🆕🆕 **D461 — A `- 2` TERM AT THE FRONT OF ALL ELEVEN RUNGS IN THIS LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END). 🛑 ALL ELEVEN WERE STEPPED, NOT ONLY THE ONE THAT REDDENED (D431) — vitest stops an `it` at its first throw, so the other ten would have gone QUIET rather than red. The slice's TWO Pokémon fixtures are `fix-scopedheal` and `fix-scopedheal-evo`, the SCOPED BOARD HEAL's Basic and Stage 1 bodies. */ - 1 /* 🆕🆕 **D460 — A `- 1` TERM AT THE FRONT OF ALL ELEVEN RUNGS IN THIS LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END). 🛑 ALL ELEVEN WERE STEPPED, NOT ONLY THE ONE THAT REDDENED (D431) — vitest stops an `it` at its first throw, so the other ten would have gone QUIET rather than red. The slice's ONE Pokémon fixture is `fix-threshflip`, the COIN-COUNT THRESHOLD's attacker; `fix-titan`, `fix-energy` and `sv02-193` are all reused and add nothing to the pool. It prints ZERO Resistances and ZERO Weaknesses and carries no Energy, so this rung's own subject is untouched and only the POOL SIZE moved. */ - 1 /* 🆕🆕🆕🆕 **D451 — A `- 1` TERM AT THE FRONT OF THIS ELEVEN-DEEP LADDER, AND EVERY FROZEN TAIL IS UNTOUCHED** (D426/D437: edited at the FRONT, never at the END; stepped in ALL ELEVEN rungs rather than only the one that went red — D431). ⚠️ **AND THE TERM IS 1 WHERE THE PRINTINGS-KEYED CHAINS IN `censusAtHead.test.ts` TOOK 5** — this ladder counts FIXTURE IDS and this slice adds exactly one, which is the two-sizes-in-one-pass hazard D450's resume point named, arriving again at a third size. */ - 2 /* 🆕🆕🆕🆕 **D450 — A `- 2` TERM AT THE FRONT OF THIS LADDER, AND THE FROZEN ENDPOINT IS UNTOUCHED (D426).** TWO fixture ids: `fix-counterfold` (the three-fold attacker) and `fix-idlebody` (the Ability-bearing body its `abilityPokemon` half needs, which every other Ability-bearing fixture in the pool confounds with a live passive). ⚠️ EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D449 front term: +1 FIXTURE, `fix-counterput` — the synthetic {L} body carrying both printed word orders plus the `deals: true` attribution control. The five other bodies its deck fields are RE-USED, so the pool steps by ONE where the deck gained SIX slots (D425). EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D448 front term: +1 FIXTURE, `fix-scaledsnipe` — the synthetic {L} body carrying the two printed scaled sentences plus a one-axis control and an unprinted rider pair. EDITED AT THE FRONT, NEVER AT THE END. */ - 1 /* 🆕🆕🆕 D447 front term: +1 FIXTURE, `fix-pinpoint`. EDITED AT THE FRONT, NEVER AT THE END. */ - 1 - 2 - 1 - 3 - 1 - 3 - 3 - 1 - 2 - 3 - 3 - 1 - 5 - 2 - 2 - 1 - 1 - 2 - 1 - 1 - 1 - 1 - 2 - 2 - 2 - 2 - 1 - 1 - 2 - 2 - 4 - 3 - 2 - 3 - 1 - 3 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 2 - 1 - 2 - 3 - 1 - 2 - 3 - 1 - 3 - 6).toBe(444);
    expect(withResistance.length - 3 - 1).toBe(24); // 🆕🆕 D393 — a `- 1` term at the FRONT: Gholdengo `sv08-131` prints a real Grass -30, transcribed whole (D306)
    expect(fighting.length - 2).toBe(16);
  });

  it("the VOCABULARY half is inherited, not re-run: `{F}` is a real `Card.types` value", () => {
    // D370 ran this question for `{M}` and it is the same map here, so this rung
    // records rather than re-derives. It still goes red if the map loses the code.
    expect(POKEMON_TYPE_BY_CODE.F).toBe("Fighting");
    expect((POKEMON_TYPES as readonly string[]).includes("Fighting")).toBe(true);
  });
});

describe("§3 — the template: N from the sentence, and a round trip across NOTATIONS", () => {
  it("maps the printed sentence onto the new member at the printed 50", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 50,
      count: { kind: "boardCondition", cond: FIGHTING },
    });
  });

  it("takes N FROM THE SENTENCE, not from the card", () => {
    for (const per of [10, 30, 250]) {
      expect(
        deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does ${per} more damage.`),
      ).toEqual({ per, count: { kind: "boardCondition", cond: FIGHTING } });
    }
    // A printed 0 adds nothing — the guard every arm in this family carries, so the
    // sentence stays LOUD rather than deriving a no-op bonus.
    expect(
      deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does 0 more damage.`),
    ).toBeNull();
  });

  it("🛑 the MAP is the vocabulary, not the regex — all 22 spellings resolve", () => {
    // The capture is `(.+)`, so the refusal of a non-type happens at the map. That
    // is what this asserts: every one of the eleven types resolves in BOTH
    // notations off one loose pattern. A `(Grass|Fire|…)` alternation would answer
    // the same today and rot the day a type is added to the schema.
    for (const type of POKEMON_TYPES) {
      expect(
        deriveAttackDamageBonus(
          `If your opponent's Active Pokémon has ${type} Resistance, this attack does 50 more damage.`,
        ),
        type,
      ).toEqual({
        per: 50,
        count: {
          kind: "boardCondition",
          cond: { kind: "opponentActiveHasResistance", type },
        },
      });
    }
    for (const [code, type] of Object.entries(POKEMON_TYPE_BY_CODE)) {
      expect(
        deriveAttackDamageBonus(
          `If your opponent's Active Pokémon has {${code}} Resistance, this attack does 50 more damage.`,
        ),
        code,
      ).toEqual({
        per: 50,
        count: {
          kind: "boardCondition",
          cond: { kind: "opponentActiveHasResistance", type },
        },
      });
    }
  });

  it("🛑 `conditionNote` is NOT the clause key — and re-derives to the member anyway", () => {
    // D118's rule: the note spells the prose NAME, because a reject pill and a HUD
    // tooltip are read off the board by a person and `{F}` is a card-face glyph. So
    // this note does NOT round-trip to the printed bytes…
    expect(conditionNote(FIGHTING)).toBe("your opponent's Active Pokémon has Fighting Resistance");
    expect(conditionNote(FIGHTING)).not.toBe(TAKEN_CLAUSE);
    expect(conditionNote(FIGHTING)).not.toContain("{F}");
    // …and it DOES round-trip to the same MEMBER, through the map's spelled-out
    // half — the property this family gained at D367 and D370 inherited.
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(FIGHTING)}, this attack does 50 more damage.`)
        ?.count,
    ).toEqual({ kind: "boardCondition", cond: FIGHTING });
    // And it holds for every type, both directions, which is what makes it a
    // property of the TEMPLATE rather than a fact about Fighting.
    for (const type of POKEMON_TYPES) {
      const cond: BoardCondition = { kind: "opponentActiveHasResistance", type };
      expect(
        deriveAttackDamageBonus(`If ${conditionNote(cond)}, this attack does 40 more damage.`)
          ?.count,
        type,
      ).toEqual({ kind: "boardCondition", cond });
    }
  });

  it("🛑 the APOSTROPHE class is load-bearing HERE in a way it was not for D370", () => {
    // D136's hardening, and this is the family's SECOND parameterised clause whose
    // printed sentence spells a possessive — `YOUR_BENCH_TYPE_CLAUSE` carries no
    // class because its sentence has no apostrophe at all. The template pass is
    // handed the RAW clause (`literalClauseRow`'s fold is for TABLE keys), so the
    // `['’]` in this pattern's own source is the only thing standing between a
    // punctuation-normalising re-ingest and both printings going silently unread.
    const curly = TAKEN.replace("opponent's", "opponent’s");
    expect(curly).not.toBe(TAKEN);
    expect(curly).toContain("’");
    expect(deriveAttackDamageBonus(curly)).toEqual({
      per: 50,
      count: { kind: "boardCondition", cond: FIGHTING },
    });
    // …and the two spellings produce the SAME value, never merely a non-null one —
    // D137's contract, stated there and asserted here.
    expect(deriveAttackDamageBonus(curly)).toEqual(deriveAttackDamageBonus(TAKEN));
  });

  it("pins the BYTES — a lookalike character would un-map the clause silently", () => {
    // 86 code points; the clause inside it is 49. The é in "Pokémon" is the
    // character this rung exists for — two UTF-8 bytes, one code point, and a
    // decomposed spelling would read identically in a diff.
    expect(TAKEN.length).toBe(86);
    expect(TAKEN_CLAUSE.length).toBe(49);
    expect(TAKEN).toContain("é");
    expect(TAKEN).not.toContain("́");
    // The braces are the catalog's notation and are NOT regex syntax here — the
    // capture is `(.+)` and the map holds the literal `{F}`.
    expect(TAKEN_CLAUSE).toContain("{F}");
    // A STRAIGHT apostrophe is what the catalog prints today (0 of 978 rows carry
    // U+2019, re-verified at D137/D154), which is why the class above is standing
    // insurance rather than a live path.
    expect(TAKEN).toContain("'");
    expect(TAKEN).not.toContain("’");
    // "Resistance" is CAPITALISED as printed, and the matcher has no /i.
    expect(TAKEN_CLAUSE.endsWith(" Resistance")).toBe(true);
  });
});

describe("§4 — the near-misses stay LOUD, and the siblings are untouched", () => {
  it("refuses CONSTRUCTED rewrites of the clause — the shape is char-for-char", () => {
    for (const clause of [
      // The WEAKNESS column, one field over in the same schema and the near miss a
      // wrong transcription lands on. Nothing in the pool prints it as a condition,
      // and until something does it must stay LOUD rather than resolve to this
      // member with the wrong column behind it.
      "your opponent's Active Pokémon has {F} Weakness",
      "your opponent's Active Pokémon has Fighting Weakness",
      // Not a type at all — each of these reaches the map and misses it.
      "your opponent's Active Pokémon has Tera Resistance",
      "your opponent's Active Pokémon has Basic Resistance",
      "your opponent's Active Pokémon has any Resistance",
      "your opponent's Active Pokémon has no Resistance",
      // The other SEAT and the other ZONE.
      "your Active Pokémon has {F} Resistance",
      "this Pokémon has {F} Resistance",
      "any of your opponent's Benched Pokémon has {F} Resistance",
      // The lowercase noun — the matcher has no /i and "Resistance" is printed
      // capitalised in every occurrence in the corpus.
      "your opponent's Active Pokémon has {F} resistance",
      // De-accented: the exact silent failure the byte guard above exists for.
      "your opponent's Active Pokemon has {F} Resistance",
      // The brace stripped — `F` alone is not a key in either half of the map.
      "your opponent's Active Pokémon has F Resistance",
      // The §8.5 phrasing, which is a modifier and not a board fact.
      "your opponent's Active Pokémon has -30 Fighting Resistance",
    ]) {
      expect(
        deriveAttackDamageBonus(`If ${clause}, this attack does 50 more damage.`),
        clause,
      ).toBeNull();
    }
  });

  it("keeps the outer anchor guards on this sentence too", () => {
    for (const text of [
      // Lowercase leading "if" — the matcher has no /i.
      `if ${TAKEN_CLAUSE}, this attack does 50 more damage.`,
      // No trailing period is not the whole sentence.
      `If ${TAKEN_CLAUSE}, this attack does 50 more damage`,
      // A real trailing clause pins `$`.
      `If ${TAKEN_CLAUSE}, this attack does 50 more damage. Then, draw a card.`,
      // Leading text pins `^`.
      `Flip a coin. If ${TAKEN_CLAUSE}, this attack does 50 more damage.`,
      // The "×"/multiply twin, which `deriveAttackDamageMultiplier` owns.
      `If ${TAKEN_CLAUSE}, this attack does 50 damage.`,
    ]) {
      expect(deriveAttackDamageBonus(text), text).toBeNull();
    }
  });

  it("🛑 the three SIBLING templates still answer their own sentences — nothing was re-pointed", () => {
    // The clause pattern was appended LAST, and the four patterns are mutually
    // exclusive at their anchors. All three siblings are driven here so "appended
    // last" is a measured fact rather than a claim about ordering.
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon has any {R} Energy attached, this attack does 90 more damage.",
      ),
    ).toEqual({
      per: 90,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourActiveHasEnergyAttached", energy: "Fire" },
      },
    });
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a Dragon Pokémon, this attack does 90 more damage.",
      ),
    ).toEqual({
      per: 90,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveHasType", type: "Dragon" } },
    });
    expect(
      deriveAttackDamageBonus(
        "If you have any {M} Pokémon on your Bench, this attack does 80 more damage.",
      ),
    ).toEqual({
      per: 80,
      count: { kind: "boardCondition", cond: { kind: "yourBenchHasType", type: "Metal" } },
    });
    // …and the LITERAL table still wins first: the Tool clause on the SAME body is
    // a row (D368), and this template's anchor cannot reach it.
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon has a Pokémon Tool attached, this attack does 80 more damage.",
      ),
    ).toEqual({
      per: 80,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveHasToolAttached" } },
    });
  });
});

describe("§5 — driven on boards: the printed COLUMN decides it, and `resistanceOf` never does", () => {
  it("🛑 A METAL ATTACKER, A FIGHTING-RESISTANT DEFENDER — the clause is TRUE and §8.5 is NULL", () => {
    // THE BOARD THIS WHOLE FIXTURE PAIR EXISTS FOR, and the shape question settled
    // rather than argued. `weakResModifier` skips every entry whose `type` is not
    // one of the ATTACKER's types, so §8.5 answers "no Resistance here" — while the
    // printed clause asks whether the DEFENDER HAS one, whoever is attacking.
    const state = ready(7110, "fix-fightresist");
    const attacker = FIXTURE_POOL["fix-oppresist"];
    const defender = FIXTURE_POOL["fix-fightresist"];
    if (attacker === undefined || defender === undefined) throw new Error("fixture missing");
    // The helper, asked directly: NULL, because Metal is not Fighting.
    expect(attacker.types).toEqual(["Metal"]);
    expect(resistanceOf(attacker, defender)).toBeNull();
    // The member, asked on the same board: TRUE.
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(true);
    // …and the dealt number is the difference between the two readings. 10 + 50,
    // with no §8.5 subtraction because the helper is null. A member routed through
    // `resistanceOf` pays 10 here, which is what makes this rung able to go RED.
    expect(damageDealt(state)).toBe(60);
  });

  it("🛑 the SAME attack on a FIGHTING body: both fire, and the numbers stack", () => {
    // The other half of the separation. Here the attacker's own type IS the one the
    // Resistance names, so `resistanceOf` returns −30 and applies for real:
    // 10 + 50 − 30 = 30. Without this board, "it does not go through `resistanceOf`"
    // would be shown only where the helper is null — and a member that answered
    // TRUE unconditionally would pass the rung above.
    const state = ready(7111, "fix-fightresist", "fix-oppresist-f");
    const attacker = FIXTURE_POOL["fix-oppresist-f"];
    const defender = FIXTURE_POOL["fix-fightresist"];
    if (attacker === undefined || defender === undefined) throw new Error("fixture missing");
    expect(attacker.types).toEqual(["Fighting"]);
    expect(resistanceOf(attacker, defender)).toEqual({ op: "subtract", amount: 30 });
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(true);
    expect(damageDealt(state)).toBe(30);
  });

  it("a body with NO Resistance column pays the printed base and nothing more", () => {
    const state = ready(7112, "fix-bigbody");
    expect(FIXTURE_POOL["fix-bigbody"]?.resistances).toBeNull();
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("a REAL Resistance of the WRONG type arms nothing — two distinct false boards", () => {
    // "No Resistance at all" and "a Resistance that does not match" are different
    // boards, exactly as D370 kept a defaulted Colorless body apart from a declared
    // Fairy one. `fix-grassresist` prints −30 against Grass.
    const state = ready(7113, "fix-grassresist");
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(false);
    // …and the member is PARAMETERISED, so the same board answers TRUE one token
    // over. Without this line the false above could be a broken predicate.
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasResistance", type: "Grass" })).toBe(
      true,
    );
    expect(damageDealt(state)).toBe(10);
  });

  it("🛑 a FIGHTING WEAKNESS arms nothing — the column one field over, driven", () => {
    // The transcription-one-field-over board. `weaknesses` and `resistances` are the
    // same shape in the same schema and D173/D175 both caught a fixture whose
    // `types` had been copied out of the wrong one. An arm reading `weaknesses`
    // flips here and nowhere else in this file.
    const state = ready(7114, "fix-fightweak");
    const defender = FIXTURE_POOL["fix-fightweak"];
    if (defender === undefined) throw new Error("fixture missing");
    expect(defender.weaknesses).toEqual([{ type: "Fighting", value: "×2" }]);
    expect(defender.resistances).toBeNull();
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("🛑 …and that Weakness column is LIVE, so the false above is not an inert fixture", () => {
    // THE ATTRIBUTION CONTROL (D214). "The clause is false on `fix-fightweak`" is
    // worth nothing if the fixture's weakness column were unreadable — the board
    // would answer the same under a broken schema. A FIGHTING attacker into the
    // same body doubles: 10 × 2 = 20, with the clause still FALSE and adding
    // nothing. Same body, same column, opposite answer.
    const state = ready(7115, "fix-fightweak", "fix-oppresist-f");
    const attacker = FIXTURE_POOL["fix-oppresist-f"];
    const defender = FIXTURE_POOL["fix-fightweak"];
    if (attacker === undefined || defender === undefined) throw new Error("fixture missing");
    expect(weaknessOf(attacker, defender)).toEqual({ op: "multiply", amount: 2 });
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(false);
    expect(damageDealt(state)).toBe(20);
  });

  it("🛑 TWO entries, the match SECOND and VALUE-LESS — `.some`, and `type` alone", () => {
    // The one body that separates two readings at once. `fix-dualresist` prints
    // `[{Grass, -30}, {Fighting}]`:
    //   • `resistances[0].type === t` answers Grass and MISSES the Fighting entry;
    //   • a predicate that also required a printed `value` MISSES it too, because
    //     `WeakRes.value` is optional and this entry carries none.
    // §8.5 itself honours a value it cannot parse (it falls back to −30), so an
    // entry the pipeline cannot PRICE is one it still counts as a Resistance.
    const state = ready(7116, "fix-dualresist");
    const defender = FIXTURE_POOL["fix-dualresist"];
    if (defender === undefined) throw new Error("fixture missing");
    expect(defender.resistances).toEqual([{ type: "Grass", value: "-30" }, { type: "Fighting" }]);
    expect(defender.resistances?.[1]?.value).toBeUndefined();
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasResistance", type: "Grass" })).toBe(
      true,
    );
    expect(damageDealt(state)).toBe(60);
  });

  it("🛑 the identity is the STACK TOP — an evolved body answers with the top card's column", () => {
    // Every other Active-Spot member reads through `activeTop`, and this one must
    // too: a Fighting-resistant body with a Resistance-less card pushed on top is
    // no longer a Fighting-resistant Pokémon. Reading `stack[0]` would still say
    // it is.
    let state = ready(7117, "fix-fightresist");
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(true);
    state = pushOnActive(state, "p2", "fix-bigbody");
    expect(state.players.p2.active?.stack).toHaveLength(2);
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("🛑 it reads the OPPONENT's Active — the seat is half the member", () => {
    // The attacker's OWN side is never the subject. A Fighting-resistant body in
    // p1's own Active Spot arms nothing; without this the predicate could be
    // reading "either Active" and every case above would pass.
    // The mirror board: the Fighting-resistant body is in P1'S OWN Active Spot and
    // the other side of the table holds a body with no Resistance column at all.
    // Asked from p1 the answer must be FALSE — it is p1's own Resistance.
    const mirror = clearBench(
      setActiveFromDeck(ready(7118, "fix-bigbody"), "p1", "fix-fightresist"),
      "p1",
    );
    expect(mirror.players.p1.active).not.toBeNull();
    expect(conditionHolds(mirror, "p1", FIGHTING)).toBe(false);
    // …and from p2, whose OPPONENT is the seat now holding it, TRUE. Same board,
    // opposite answers, so the false above is the SEAT and not a dead predicate.
    expect(conditionHolds(mirror, "p2", FIGHTING)).toBe(true);
    // The ordinary orientation, for the same pair of answers the other way round.
    const state = ready(7119, "fix-fightresist");
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(true);
    expect(conditionHolds(state, "p2", FIGHTING)).toBe(false);
  });

  it("answers from BOTH seats — it reads the opponent OF `seat`, not p1's", () => {
    // A p1-only suite cannot tell "reads YOUR OPPONENT's Active" apart from "reads
    // p2's Active". P2 attacks here, and pays the bonus.
    const state = ready(7120, "fix-fightresist", "fix-oppresist", "p2");
    expect(damageDealt(state, "p2")).toBe(60);
    for (const seat of ["p1", "p2"] as const) {
      expect(conditionHolds(state, seat, FIGHTING), seat).toBe(seat === "p2");
    }
  });

  it("an EMPTY Active Spot is FALSE, not a throw", () => {
    // The commitment every card-reading member in this union makes, driven rather
    // than commented. No legal action reaches this board, so the surgery is local.
    const state = emptyActive(ready(7121, "fix-fightresist"), "p2");
    expect(state.players.p2.active).toBeNull();
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(false);
  });

  it("the parameter is carried, not fixed — the same board answers 11 questions", () => {
    // The member is PARAMETERISED, so the board must answer differently per type.
    // Exactly one of the eleven is true against a single-entry Fighting Resistance.
    const state = ready(7122, "fix-fightresist");
    const held = POKEMON_TYPES.filter((type: PokemonType) =>
      conditionHolds(state, "p1", { kind: "opponentActiveHasResistance", type }),
    );
    expect(held).toEqual(["Fighting"]);
  });
});

describe("§6 — the census stands still", () => {
  it("🛑 the corpus totals STAND STILL — this slice adds no catalog row", () => {
    // The population is a committed transcription and this slice does not touch it.
    // Asserted here because every figure in §1 is a fraction of it: a corpus that
    // moved would make the residue step look like a reader change.
    expect(corpus().length).toBe(640);
    expect(units(corpus())).toBe(1732);
  });
});
