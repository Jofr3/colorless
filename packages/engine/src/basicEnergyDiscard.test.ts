import { describe, expect, it } from "vitest";
import { cardOfUid, matchesFilter } from "./cards";
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
import type { BoardCondition, CardFilter, GameEvent, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  BASIC_ENERGY_DISCARD_DECK,
  attachFromDeck,
  clearBench,
  discardFromDeck,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 🆕🆕 D376 — THE FILTERED DISCARD-PILE THRESHOLD, AND THE MEMBER ONE ZONE OVER THAT
// IT LOOKS EXACTLY LIKE AND IS THE INVERSE OF.
//
// D375 handed over *"If you have 10 or more Basic {R} Energy cards in your discard
// pile, this attack does 100 more damage."* — Chandelure `sv10.5w-018` "Incendiary
// Pillar" (50+, **+100**) and its Illustration-rare reprint `sv10.5w-103`, **1
// sentence / 2 legal printings** — with D207's SUPPLY question already answered YES
// on BOTH halves and the whole price named as SHAPE. That is how it came out, and
// this file is organised around the four ways the build could have been green and
// wrong, each one killed on a board at the SAME nine-card base.
//
// ✅ **THE SUPPLY QUESTION WAS NEVER CLOSE, WHICH IS WHY §1 IS SHORT AND §3 IS LONG.**
// `PlayerState.discard` is a uid list the model has carried since M1 and `CardFilter`
// ALREADY SPELLS THE PRINTED NOUN — `{ kind: "basicEnergy", energyType }`, authored
// for the *"Basic {L} Energy card"* SEARCH sentences. Neither the zone nor the filter
// is new; the member is one `for` loop over the two of them.
//
// 🛑 **THE SHAPE, WHICH IS THE WHOLE PRICE: THIS IS `yourEnergyInPlayAtLeast`
// INVERTED, NOT `yourEnergyInPlayAtLeast` RELOCATED.** That member's own doc block
// says it *"reads provision rather than the printed name"* — correctly, because an
// Energy card IN PLAY pays for whatever it PROVIDES, so a wildcard Luminous Energy
// counts as {D} while it is alone. **A DISCARD PILE PROVIDES NOTHING**: a card in a
// pile is attached to nothing, and the printed words here name a card CLASS
// (**Basic**) and a printed TYPE. §6.5's standing rule for every pile-scanning
// consumer in `effects.ts`, applied to a `BoardCondition` for the first time.
//
// 🛑 **AND THE REUSE WOULD HAVE BEEN GREEN ON ALMOST EVERY BOARD A SUITE WRITES.** A
// discard pile holding ten Fire Energy and nothing else cannot tell ANY of the four
// wrong readings apart from the right one — which is exactly the pile a test writes
// by accident. So every board below is asserted against ALL FOUR narrowings/widenings
// computed BESIDE the member, and §3's first rung is the ATTRIBUTION CONTROL (D214):
// the board where all five readings AGREE, asserted first, so the disagreements later
// are a statement about the boards rather than about a predicate that is always false.
//
// THE FOUR:
//   • **the ZONE** — `countEnergyInPlay` instead of the pile (§4). It is the sibling's
//     own arm copied verbatim, and it is TRUE on exactly the boards this one is FALSE
//     on, which is why the pair is driven in BOTH directions;
//   • **the CARD CLASS** — `anyEnergy` instead of `basicEnergy`, i.e. the printed word
//     "Basic" dropped (§3). A Special in the pile separates it, and `sv02-191`
//     **Luminous** is the sharp one: the SAME CARD provides {R} in play and provides
//     nothing in a pile;
//   • **the TYPE** — `energyType` dropped, i.e. the printed `{R}` dropped (§3). A
//     Basic {W} in the pile separates it;
//   • **the FILTER ENTIRELY** — `discard.length`, the whole pile counted (§3). Any
//     non-Energy card in the pile separates it.
//
// ⚠️ **AND THE THRESHOLD IS ITS OWN CLAIM.** The printed words are "or more" — a
// FLOOR — so `>` for `>=` is the mistake this member owes, and §5 drives 9 (false)
// and 10 (true) on real declarations rather than on `conditionHolds` alone.
//
// WHAT SHIPS: **1 new `BoardCondition` member** (`yourBasicEnergyInDiscardAtLeast`,
// carrying `energy` and `count`), its **2** reader arms and **1 literal
// `CONDITIONAL_DAMAGE_CLAUSES` row`. **ZERO new imports** — `matchesFilter` and
// `cardOfUid` were both already in `interpreter.ts` — and zero new maps, templates,
// patterns, ops, events or `packages/schema` bytes. `MATCH_RECORD_VERSION` stays 22.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/** The nine live readers, run as one — the same set `censusAtHead.test.ts` and
    `typeShareBonus.test.ts` use. */
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

/** THE SENTENCE THIS SLICE BUYS — Chandelure `sv10.5w-018` "Incendiary Pillar", 2
    legal printings of ONE sentence, byte-for-byte from the committed corpus. */
const TAKEN =
  "If you have 10 or more Basic {R} Energy cards in your discard pile, this attack does 100 more damage.";
const TAKEN_CLAUSE = "you have 10 or more Basic {R} Energy cards in your discard pile";

const DISCARD: BoardCondition = {
  kind: "yourBasicEnergyInDiscardAtLeast",
  energy: "Fire",
  count: 10,
};
/** THE SIBLING ONE ZONE OVER, at the SAME type and the SAME threshold — the member a
    reuse would have delegated to, and a shipped predicate rather than a local copy of
    one. Every board below reports it. */
const IN_PLAY: BoardCondition = { kind: "yourEnergyInPlayAtLeast", energy: "Fire", count: 10 };

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: BASIC_ENERGY_DISCARD_DECK, p2: BASIC_ENERGY_DISCARD_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** The seat's opposite. Spelled once here rather than imported, because the member is
    seat-relative on the face of it and every board below names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

/** `fix-emberpillar` in `seat`'s Active Spot with its `{C}` paid by a COLORLESS
    `fix-energy`, a 200 HP `fix-bigbody` across the table, and both benches cleared.
    `board` opens P1's turn, so a P2 case passes once more: a p1-only suite cannot tell
    "reads YOUR discard pile" apart from "reads p1's".

    ⚠️ THE `{C}` IS PAID BY `fix-energy` AND NEVER BY A FIRE ENERGY. §4 has to be able
    to say *"there are ten Basic {R} IN PLAY and the clause is still false"*, and a
    cost paid in Fire would make every one of those boards ambiguous about which Fire
    Energy the assertion was talking about. */
function ready(seed: number, seat: Seat = "p1"): GameState {
  let state = board(seed);
  if (seat === "p2") state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = setActiveFromDeck(state, seat, "fix-emberpillar");
  state = attachFromDeck(state, seat, "fix-energy", 1);
  state = setActiveFromDeck(state, other(seat), "fix-bigbody");
  return clearBench(clearBench(state, seat), other(seat));
}

/** Put `count` copies of each id into `seat`'s DISCARD PILE, off their own deck. */
function pile(state: GameState, seat: Seat, ...cards: readonly [string, number][]): GameState {
  let next = state;
  for (const [id, count] of cards) next = discardFromDeck(next, seat, id, count);
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

/** How many cards in `seat`'s pile match `filter` — the shape of the arm under test,
    with the FILTER as a parameter, so each widening below is the real predicate with
    one printed word removed rather than a hand-written approximation of one. */
function pileCount(state: GameState, seat: Seat, filter: CardFilter): number {
  let n = 0;
  for (const uid of state.players[seat].discard) {
    if (matchesFilter(cardOfUid(state, uid), filter)) n += 1;
  }
  return n;
}

/** THE FOUR ATTRIBUTION CONTROLS (D214), read off the same board as the member and
    reported together, so a rung says WHICH reading it separates rather than merely
    that something differs. `zone` is the SHIPPED sibling; the other three are this
    member's own predicate with one printed word dropped. */
function readings(
  state: GameState,
  seat: Seat,
): { member: boolean; zone: boolean; anyEnergy: boolean; untyped: boolean; wholePile: boolean } {
  return {
    member: conditionHolds(state, seat, DISCARD),
    zone: conditionHolds(state, seat, IN_PLAY),
    anyEnergy: pileCount(state, seat, { kind: "anyEnergy" }) >= 10,
    untyped: pileCount(state, seat, { kind: "basicEnergy" }) >= 10,
    wholePile: state.players[seat].discard.length >= 10,
  };
}

describe("§1 — the price, RE-DERIVED: a 1:2 step and the 2-printing band emptied", () => {
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
    // D375 left the residue at 25 records / 30 printings with TWO clauses in the
    // 2-printing band. Both figures are re-derived here off the same instrument — the
    // nine live readers over `legalAttackCorpus()` — rather than quoted.
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    // The DEPARTURE and the SIZE are asserted separately: a guard that only checked
    // 24 / 28 could not tell "the row landed" from "a reader broke".
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    // 🆕🆕 D377 — 24 / 28 -> 22 / 26: the CROSS-BOARD STATUS PAIR left this residue
    // (TWO sentences, ONE printing each — *"…is Burned"* +40 and *"…is Confused"* +90),
    // re-derived live rather than edited down. That slice's THIRD printing moved a
    // DIFFERENT residue: its cancel-consequent sibling lives behind the "does nothing"
    // skeleton, not this one.
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
    // 🛑 AND THE STEP IS 1:2 HERE, the shape D369/D370/D371/D373/D374/D375 all kept —
    // D377's was 2:2. Every earlier head is re-derived from THIS one rather than
    // frozen: D376's 24/28, D375's 25/30, D374's 26/32, D373's 27/34, D372's 28/36,
    // D371's 30/38.
    // 🆕🆕 D392 — the OFFSET gains one on each axis: the head moved, this one's did not.
    expect([refused.length + 19, units(refused) + 23]).toEqual([24, 28]);
    // 🆕🆕 D392 — the OFFSET gains one on each axis: the head moved, this one's did not.
    expect([refused.length + 20, units(refused) + 25]).toEqual([25, 30]);
    expect([refused.length + 21, units(refused) + 27]).toEqual([26, 32]);
    expect([refused.length + 22, units(refused) + 29]).toEqual([27, 34]);
    expect([refused.length + 23, units(refused) + 31]).toEqual([28, 36]);
    expect([refused.length + 25, units(refused) + 33]).toEqual([30, 38]);

    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    // 🛑 THE 2-PRINTING BAND IS NOW A SINGLE ITEM, AND IT IS THE EXPENSIVE ONE. D374's
    // page priced it and three slices have deferred it on the same ground: *"this
    // Pokémon was healed during this turn"* needs a PER-TURN HEALED FLAG on the state,
    // which is a persisted-shape change and therefore a `MATCH_RECORD_VERSION` bump on
    // top of the engine bump. Pinned here MEASURED, so the successor inherits the
    // tie-break rather than re-running it.
    const band = [...byClause].filter(([, n]) => n === 2).map(([clause]) => clause);
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
    // The 5-printing declaration clause D368 disqualified on SHAPE ("in addition to
    // this attack's cost" — it reads THIS ATTACK'S COST, which two printings set
    // differently, so no `state+seat` predicate can answer it) is still the largest
    // thing in the residue and still refused, so nothing here re-priced it.
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

  it("🛑 ONE sentence, TWO printings — and the printed NOUN is wider than the row", () => {
    const records = corpus().filter(([, s]) => s === TAKEN);
    expect(records).toHaveLength(1);
    expect(units(records)).toBe(2);
    // …and no second sentence carries the clause under a different amount, so the row
    // cannot be short and cannot rot on a reprint.
    const clauseRows = corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === TAKEN_CLAUSE);
    expect(clauseRows).toHaveLength(1);
    expect(units(clauseRows)).toBe(2);
    // 🛑 THE PRINTED NOUN `Basic {R} Energy` APPEARS ON FOUR SENTENCES / SIX PRINTINGS
    // AND THIS MEMBER BUYS ONE OF THEM, which is the measurement that says what this
    // slice does NOT buy. The other three are all OPS on the same noun — an attach
    // from the discard pile, a deck search, and a multi-noun deck search — and every
    // one of them already reads it through `CardFilter`'s `basicEnergy` +
    // `energyType`, which is the same predicate this member reuses. Re-run rather than
    // inherited, so a set that prints a fifth reddens HERE.
    const noun = corpus().filter(([, s]) => s.includes("Basic {R} Energy"));
    expect(noun).toHaveLength(4);
    expect(units(noun)).toBe(6);
    expect(noun.filter(([, s]) => s === TAKEN)).toHaveLength(1);
    expect(noun.filter(([, s]) => BONUS.test(s.trim()))).toHaveLength(1);
    // 🛑 AND THE ZONE IS WIDER STILL: seven sentences / fourteen printings name "in
    // your discard pile" in the legal attack column, and this is the ONLY one that
    // asks a QUESTION about it rather than moving a card out of it.
    const zone = corpus().filter(([, s]) => s.includes("in your discard pile"));
    expect(zone).toHaveLength(7);
    expect(units(zone)).toBe(14);
    expect(zone.filter(([, s]) => BONUS.test(s.trim()))).toHaveLength(1);
    // ⚠️ THE IDS BEHIND THE TWO PRINTINGS ARE NOT READ FROM THE CATALOG — D369's
    // constraint, unchanged: this container has no D1 credentials and no local sqlite
    // copy. `sv10.5w-018` / `sv10.5w-103` are recorded in the member's doc block from a
    // WEB lookup, and nothing on this path needs an id: a literal row is keyed on the
    // printed clause and serves every printing of it.
  });
});

describe("§2 — the clause row, the printed BYTES, and a note that round-trips neither way", () => {
  it("maps the printed sentence onto the new member at the printed 100", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 100,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourBasicEnergyInDiscardAtLeast", energy: "Fire", count: 10 },
      },
    });
  });

  it("🛑 the KEY is the printed bytes, pinned by COUNT and PURE ASCII", () => {
    // D183's defect is an arm authored from a PARAPHRASE, and the byte count is what
    // catches a transcription that reads right and is not the printed sentence.
    expect(TAKEN).toHaveLength(101);
    expect(TAKEN_CLAUSE).toHaveLength(63);
    expect(BONUS.exec(TAKEN)?.[1]).toBe(TAKEN_CLAUSE);
    // ⚠️ AND THIS SENTENCE IS PURE ASCII, WHICH IS WORTH ASSERTING RATHER THAN
    // ASSUMING: it names no `Pokémon` (U+00E9) and carries no apostrophe, so unlike
    // D374's and D375's rows there is no D137/D154 fold for it to depend on. A
    // punctuation-normalising re-ingest cannot touch it, and a successor reaching for
    // `foldApostrophes` here would be adding a guard against nothing.
    expect([...TAKEN].every((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) <= 0x7e)).toBe(
      true,
    );
    expect(TAKEN).not.toContain("é");
    expect(TAKEN).not.toContain("'");
    expect(TAKEN).not.toContain("\u2019");
  });

  it("🛑 eight constructed rewrites resolve to NOTHING — the printed words are the key", () => {
    // Keys are whole printed clauses and never substrings, so each of these differs
    // from the row by exactly one printed thing and must therefore MISS. If any of
    // them ever resolves, a template has been introduced where a literal row was
    // measured to be right (D119's corollary — TWO tokens vary here, so D118's
    // one-token test fails).
    for (const near of [
      // the CLASS word dropped — the widening §3 kills on a board
      "If you have 10 or more {R} Energy cards in your discard pile, this attack does 100 more damage.",
      // the TYPE glyph dropped — the other widening §3 kills on a board
      "If you have 10 or more Basic Energy cards in your discard pile, this attack does 100 more damage.",
      // a different type
      "If you have 10 or more Basic {W} Energy cards in your discard pile, this attack does 100 more damage.",
      // a different threshold
      "If you have 9 or more Basic {R} Energy cards in your discard pile, this attack does 100 more damage.",
      // the sibling's phrasing of the same threshold
      "If you have at least 10 Basic {R} Energy cards in your discard pile, this attack does 100 more damage.",
      // a different ZONE — the one §4 kills on a board
      "If you have 10 or more Basic {R} Energy cards in play, this attack does 100 more damage.",
      // the OPPONENT's pile
      "If your opponent has 10 or more Basic {R} Energy cards in their discard pile, this attack does 100 more damage.",
      // the singular noun
      "If you have 10 or more Basic {R} Energy card in your discard pile, this attack does 100 more damage.",
    ]) {
      expect(resolvedByAnyReader(near), near).toBe(false);
    }
    // …and the taken sentence IS resolved, so the loop above is a statement about
    // those eight strings rather than about the reader being asleep.
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
  });

  it("🛑 the SIBLING's row still resolves to the SIBLING, one zone over", () => {
    // The row was added BESIDE `yourEnergyInPlayAtLeast`'s, not over it. If this ever
    // answers with the new member, the two adjacent rows have been conflated — which
    // is the exact accident their adjacency invites.
    expect(
      deriveAttackDamageBonus("If you have at least 3 {D} Energy in play, this attack does 50 more damage."),
    ).toEqual({
      per: 50,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourEnergyInPlayAtLeast", energy: "Darkness", count: 3 },
      },
    });
  });

  it("🛑 the note is built from BOTH parameters and round-trips NEITHER way", () => {
    // D118's rule: the energy reads as the printed NAME rather than the brace code,
    // because a reject pill and a HUD tooltip are read off the board by a person and
    // "{R}" is a card-face glyph. Together with the sibling's "at least" phrasing that
    // is TWO differences from the printed clause, so this note round-trips neither to
    // the bytes nor — unlike `yourBenchHasType`'s — back to the member, because
    // `CONDITIONAL_DAMAGE_CLAUSES` is keyed on the printed sentence WHOLE and there is
    // no token map with a spelled-out half to land on.
    expect(conditionNote(DISCARD)).toBe(
      "you have at least 10 Basic Fire Energy cards in your discard pile",
    );
    expect(conditionNote(DISCARD)).not.toBe(TAKEN_CLAUSE);
    expect(resolvedByAnyReader(`If ${conditionNote(DISCARD)}, this attack does 100 more damage.`)).toBe(
      false,
    );
    // …and BOTH parameters are really read, so a second threshold or a second type
    // costs no note arm.
    expect(
      conditionNote({ kind: "yourBasicEnergyInDiscardAtLeast", energy: "Water", count: 3 }),
    ).toBe("you have at least 3 Basic Water Energy cards in your discard pile");
    // ⚠️ ASSERTED IN THE NEGATIVE AGAINST THE TWO NEIGHBOURS THAT DO ROUND-TRIP, so a
    // successor cannot "fix" this one into the table key without noticing that two
    // members deliberately differ from it.
    for (const verbatim of [
      { kind: "opponentActiveHasToolAttached" },
      { kind: "inPlayTypesIntersect" },
    ] as const) {
      expect(
        deriveAttackDamageBonus(`If ${conditionNote(verbatim)}, this attack does 80 more damage.`),
      ).toEqual({ per: 80, count: { kind: "boardCondition", cond: verbatim } });
    }
    // …and the sibling one zone over does not round-trip either, for the same D118
    // reason, which is what makes this note's shape a family habit rather than a lapse.
    expect(resolvedByAnyReader(`If ${conditionNote(IN_PLAY)}, this attack does 50 more damage.`)).toBe(
      false,
    );
  });
});

describe("§3 — THE PROVISION AXIS: a card CLASS and a printed TYPE, never a payment", () => {
  it("🛑 THE ATTRIBUTION CONTROL: on ten Basic {R} alone, ALL FIVE readings agree", () => {
    // D214's requirement, first: a narrowing that is always false — or a widening that
    // is always true — proves nothing about the boards where it disagrees. This is the
    // pile a suite writes by accident, and it is exactly the pile that cannot tell any
    // of the four wrong readings from the right one. Every rung below is a departure
    // from THIS board.
    const ten = pile(ready(8100), "p1", ["fix-fire-energy", 10]);
    expect(ten.players.p1.discard).toHaveLength(10);
    expect(readings(ten, "p1")).toEqual({
      member: true,
      zone: false,
      anyEnergy: true,
      untyped: true,
      wholePile: true,
    });
    expect(damageDealt(ten)).toBe(110);
    // …and on the EMPTY pile all five are false, so both directions of the control are
    // shown live rather than asserted in one.
    const bare = ready(8101);
    expect(bare.players.p1.discard).toEqual([]);
    expect(readings(bare, "p1")).toEqual({
      member: false,
      zone: false,
      anyEnergy: false,
      untyped: false,
      wholePile: false,
    });
    expect(damageDealt(bare)).toBe(10);
  });

  it("🛑 a WILDCARD SPECIAL in the pile is not a `Basic {R} Energy card` — and the SAME CARD provides {R} in play", () => {
    // THE RUNG THIS SLICE EXISTS FOR. `sv02-191` Luminous Energy provides EVERY type
    // while it is alone on a Pokémon, so a member that had delegated to
    // `countEnergyInPlay` — or that had counted the pile by provision — would score it
    // as {R}. In a DISCARD PILE it is attached to nothing and provides nothing, and it
    // is not a Basic Energy CARD, so nine Fire plus one Luminous is NINE.
    const nine = pile(ready(8102), "p1", ["fix-fire-energy", 9], ["sv02-191", 1]);
    expect(nine.players.p1.discard).toHaveLength(10);
    expect(readings(nine, "p1")).toEqual({
      member: false,
      zone: false,
      anyEnergy: true, // ← the CLASS widening, and it is TRUE here
      untyped: false,
      wholePile: true,
    });
    expect(damageDealt(nine)).toBe(10);

    // …and the OTHER half of the sentence, on a board: the very same card put IN PLAY
    // rather than in the pile makes the SIBLING true at 1, which is what "provides {R}"
    // means and where it is a correct reading. One card, two zones, two answers.
    const inPlay = attachFromDeck(ready(8103), "p1", "sv02-191", 1);
    expect(
      conditionHolds(inPlay, "p1", { kind: "yourEnergyInPlayAtLeast", energy: "Fire", count: 1 }),
    ).toBe(true);
    expect(conditionHolds(inPlay, "p1", DISCARD)).toBe(false);
  });

  it("🛑 an UNAUTHORED Special is refused too, by CLASS rather than by provision", () => {
    // `fix-special` provides Colorless (`energyProvidesOf`'s fallback), so a
    // provision-shaped reading would already miss it. It is here because the member
    // must refuse it for the RIGHT reason — `energyType === "Normal"` — and a second,
    // differently-shaped Special is what tells "refuses Specials" apart from "refuses
    // the wildcard".
    const nine = pile(ready(8104), "p1", ["fix-fire-energy", 9], ["fix-special", 1]);
    expect(readings(nine, "p1")).toEqual({
      member: false,
      zone: false,
      anyEnergy: true,
      untyped: false,
      wholePile: true,
    });
    expect(damageDealt(nine)).toBe(10);
  });

  it("🛑 a Basic of the WRONG TYPE is refused — the printed `{R}` is a conjunct", () => {
    // The TYPE widening: drop `energyType` and nine Fire plus one Water is ten Basic
    // Energy cards. `fix-water-energy` is a Basic, so it satisfies the class conjunct
    // and separates the type one on its own — which is what makes this board different
    // from the two above rather than a repeat of them.
    const nine = pile(ready(8105), "p1", ["fix-fire-energy", 9], ["fix-water-energy", 1]);
    expect(readings(nine, "p1")).toEqual({
      member: false,
      zone: false,
      anyEnergy: true,
      untyped: true, // ← the TYPE widening, and it is TRUE here and false above
      wholePile: true,
    });
    expect(damageDealt(nine)).toBe(10);
  });

  it("🛑 a POKÉMON in the pile is refused — the filter is not a pile LENGTH", () => {
    // The crudest widening and the easiest to write: `discard.length >= count`. Any
    // non-Energy card separates it, and `fix-basic-1` is one. Note that `anyEnergy` and
    // `untyped` are BOTH false here while `wholePile` is true — the three widenings are
    // ordered, and this board is what shows the outermost one is really outermost.
    const nine = pile(ready(8106), "p1", ["fix-fire-energy", 9], ["fix-basic-1", 1]);
    expect(readings(nine, "p1")).toEqual({
      member: false,
      zone: false,
      anyEnergy: false,
      untyped: false,
      wholePile: true,
    });
    expect(damageDealt(nine)).toBe(10);
  });

  it("🛑 the two Fire PRINTS are interchangeable, and the decoys do not disarm a full pile", () => {
    // `.filter`, not `.find`: the count is over EVERY matching card. Seven of one Fire
    // print and three of another make ten — the real catalog carries Basic Fire Energy
    // under three ids (`sve-002`/`-010`/`-018`), all identical in play, so a member
    // keyed on an id rather than on the printed noun would answer six here.
    const mixed = pile(
      ready(8107),
      "p1",
      ["fix-fire-energy", 7],
      ["fix-fire-energy-alt", 3],
    );
    expect(conditionHolds(mixed, "p1", DISCARD)).toBe(true);
    expect(damageDealt(mixed)).toBe(110);

    // …and every refused card ADDED to a satisfied pile leaves it satisfied: the
    // decoys subtract nothing, which is the other half of "the predicate is a count".
    const loaded = pile(
      ready(8108),
      "p1",
      ["fix-fire-energy", 10],
      ["fix-water-energy", 2],
      ["sv02-191", 2],
      ["fix-special", 2],
      ["fix-basic-1", 2],
    );
    expect(loaded.players.p1.discard).toHaveLength(18);
    expect(conditionHolds(loaded, "p1", DISCARD)).toBe(true);
    expect(damageDealt(loaded)).toBe(110);
  });
});

describe("§4 — THE ZONE AXIS: the pile, and never the board", () => {
  it("🛑 TEN Basic {R} IN PLAY with an EMPTY pile is FALSE — and the sibling is TRUE", () => {
    // THE BOARD THAT KILLS THE REUSE, and the reason the pair is driven rather than
    // argued. `countEnergyInPlay(state, seat, "Fire")` is the sibling's whole arm; it
    // answers 10 here and this member answers 0, on the same state, at the same
    // threshold, for the same type.
    const inPlay = attachFromDeck(ready(8200), "p1", "fix-fire-energy", 10);
    expect(inPlay.players.p1.active?.energy).toHaveLength(11); // 10 Fire + the {C} payer
    expect(inPlay.players.p1.discard).toEqual([]);
    expect(readings(inPlay, "p1")).toEqual({
      member: false,
      zone: true, // ← the SIBLING, and it is TRUE here
      anyEnergy: false,
      untyped: false,
      wholePile: false,
    });
    expect(damageDealt(inPlay)).toBe(10);
  });

  it("🛑 …and TEN in the PILE with none in play is TRUE, which is the same pair inverted", () => {
    // Asserted as its own rung rather than folded into §3's control, because "the two
    // members disagree" needs both directions: a member that was simply always false
    // would satisfy the rung above and fail this one.
    const inPile = pile(ready(8201), "p1", ["fix-fire-energy", 10]);
    expect(inPile.players.p1.active?.energy).toHaveLength(1);
    expect(readings(inPile, "p1")).toEqual({
      member: true,
      zone: false,
      anyEnergy: true,
      untyped: true,
      wholePile: true,
    });
    expect(damageDealt(inPile)).toBe(110);
  });

  it("🛑 a BENCHED body's Energy is in play too, and is still not in the pile", () => {
    // The `[active, ...bench]` spread is one identifier away in the sibling's own
    // helper, so the widening a reader would reach for is checked here as well: ten
    // Fire spread across the Bench does not fill a pile either.
    let benched = ready(8202);
    benched = attachFromDeck(benched, "p1", "fix-fire-energy", 5);
    expect(conditionHolds(benched, "p1", DISCARD)).toBe(false);
    expect(
      conditionHolds(benched, "p1", { kind: "yourEnergyInPlayAtLeast", energy: "Fire", count: 5 }),
    ).toBe(true);
    expect(damageDealt(benched)).toBe(10);
  });

  it("🛑 the OPPONENT's pile is not yours — seat-relative, driven from both sides", () => {
    // "you have … in your discard pile" is a seat-relative reading, and a p1-only file
    // cannot tell that from "p1's pile". Ten in THEIR pile makes THEIR reading true and
    // yours false, on one board.
    const theirs = pile(ready(8203), "p2", ["fix-fire-energy", 10]);
    expect(conditionHolds(theirs, "p1", DISCARD)).toBe(false);
    expect(conditionHolds(theirs, "p2", DISCARD)).toBe(true);
    expect(damageDealt(theirs)).toBe(10);

    // …and a real declaration from P2 pays the bonus off P2's own pile, so the seat is
    // driven through the attack path and not only through `conditionHolds`.
    const mine = pile(ready(8204, "p2"), "p2", ["fix-fire-energy", 10]);
    expect(conditionHolds(mine, "p2", DISCARD)).toBe(true);
    expect(damageDealt(mine, "p2")).toBe(110);
  });
});

describe("§5 — the THRESHOLD: `>=`, driven at exactly 9 and exactly 10", () => {
  it("🛑 NINE is FALSE and TEN is TRUE, on real declarations", () => {
    // The printed words are "10 or more" — a FLOOR — so `>` for `>=` is the mistake
    // this member owes, and it is invisible at any count but the boundary. Both sides
    // are driven through the attack path, so the rung reads the DEALT number rather
    // than the predicate alone.
    const nine = pile(ready(8300), "p1", ["fix-fire-energy", 9]);
    expect(nine.players.p1.discard).toHaveLength(9);
    expect(conditionHolds(nine, "p1", DISCARD)).toBe(false);
    expect(damageDealt(nine)).toBe(10);

    const ten = pile(ready(8301), "p1", ["fix-fire-energy", 10]);
    expect(ten.players.p1.discard).toHaveLength(10);
    expect(conditionHolds(ten, "p1", DISCARD)).toBe(true);
    expect(damageDealt(ten)).toBe(110);

    // …and ELEVEN is still true, which is what "or more" means and what a `===` would
    // break. The three rungs together separate `>`, `>=` and `===` on one axis.
    const eleven = pile(ready(8302), "p1", ["fix-fire-energy", 11]);
    expect(conditionHolds(eleven, "p1", DISCARD)).toBe(true);
    expect(damageDealt(eleven)).toBe(110);
  });

  it("🛑 the whole ramp 0..11 is monotone and steps EXACTLY at 10", () => {
    // One loop rather than three rungs, so the boundary is a property of the predicate
    // rather than of the three counts a case happened to pick. A `> 10` moves the step
    // to 11 and reddens here; a `>= 9` moves it to 9 and reddens here.
    for (let n = 0; n <= 11; n++) {
      const state = n === 0 ? ready(8310) : pile(ready(8310 + n), "p1", ["fix-fire-energy", n]);
      expect(conditionHolds(state, "p1", DISCARD), `${n} in the pile`).toBe(n >= 10);
    }
  });

  it("🛑 the `count` parameter is real: the same pile answers a lower threshold", () => {
    // The 10 lives in the clause row, not in the arm. A member that had hardcoded the
    // printed threshold would answer FALSE here, and the row would still be green.
    const nine = pile(ready(8320), "p1", ["fix-fire-energy", 9]);
    expect(conditionHolds(nine, "p1", DISCARD)).toBe(false);
    expect(
      conditionHolds(nine, "p1", { kind: "yourBasicEnergyInDiscardAtLeast", energy: "Fire", count: 9 }),
    ).toBe(true);
    // …and the `energy` parameter is real too, on the same board.
    expect(
      conditionHolds(nine, "p1", { kind: "yourBasicEnergyInDiscardAtLeast", energy: "Water", count: 1 }),
    ).toBe(false);
    const water = pile(nine, "p1", ["fix-water-energy", 1]);
    expect(
      conditionHolds(water, "p1", { kind: "yourBasicEnergyInDiscardAtLeast", energy: "Water", count: 1 }),
    ).toBe(true);
  });
});

describe("§6 — the boundaries the arm has to survive", () => {
  it("🛑 an UNRESOLVABLE uid in the pile contributes nothing, and does not throw", () => {
    // `discard` is a uid list and `cardOfUid` returns undefined for a uid the catalog
    // cannot resolve; `matchesFilter` answers false for `undefined` rather than
    // throwing, which is the totality rule every reader in this family keeps. Driven by
    // putting a uid in the pile that no `cardIdByUid` entry names — so a member that
    // dereferenced the card directly would crash here rather than under-count.
    const ten = pile(ready(8400), "p1", ["fix-fire-energy", 10]);
    const broken: GameState = {
      ...ten,
      players: {
        ...ten.players,
        p1: { ...ten.players.p1, discard: [...ten.players.p1.discard, "uid-nobody-minted"] },
      },
    };
    expect(broken.players.p1.discard).toHaveLength(11);
    expect(conditionHolds(broken, "p1", DISCARD)).toBe(true);
    // …and it does not fill a short pile either.
    const nine = pile(ready(8401), "p1", ["fix-fire-energy", 9]);
    const shortBroken: GameState = {
      ...nine,
      players: {
        ...nine.players,
        p1: { ...nine.players.p1, discard: [...nine.players.p1.discard, "uid-nobody-minted"] },
      },
    };
    expect(conditionHolds(shortBroken, "p1", DISCARD)).toBe(false);
  });

  it("🛑 an EMPTY Active Spot does not change the answer — the clause reads no body", () => {
    // Every OTHER member in this neighbourhood is false with no Active, and that is a
    // property of THEM rather than of the family: this clause names a ZONE and no
    // Pokémon at all, so a hand-emptied Active Spot leaves it exactly where it was.
    // Asserted so a successor does not "restore consistency" by adding a guard that
    // would make a real board answer wrongly.
    const ten = pile(ready(8402), "p1", ["fix-fire-energy", 10]);
    const vacated: GameState = {
      ...ten,
      players: { ...ten.players, p1: { ...ten.players.p1, active: null } },
    };
    expect(conditionHolds(vacated, "p1", DISCARD)).toBe(true);
    const bare: GameState = {
      ...ready(8403),
      players: { ...ready(8403).players, p1: { ...ready(8403).players.p1, active: null } },
    };
    expect(conditionHolds(bare, "p1", DISCARD)).toBe(false);
  });

  it("🛑 a threshold of 0 is trivially TRUE on an empty pile, and that is stated not shipped", () => {
    // The member's doc block says an empty pile is 0, so a printed `count` of 0 would
    // be trivially true. The pool prints 10 and the clause row is the only producer, so
    // nothing can author a 0 — but the arm's behaviour is pinned rather than left to a
    // successor's guess, because "0 is unreachable" is a fact about the TABLE and this
    // is a fact about the ARM.
    const bare = ready(8404);
    expect(bare.players.p1.discard).toEqual([]);
    expect(
      conditionHolds(bare, "p1", { kind: "yourBasicEnergyInDiscardAtLeast", energy: "Fire", count: 0 }),
    ).toBe(true);
    // …and no clause in the table produces one, which is what makes the line above a
    // statement about the arm and not a live path.
    expect(
      resolvedByAnyReader("If you have 0 or more Basic {R} Energy cards in your discard pile, this attack does 100 more damage."),
    ).toBe(false);
  });
});
