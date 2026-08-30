import { describe, expect, it } from "vitest";
import { cardOfUid } from "./cards";
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
  FIXTURE_POOL,
  TR_ENERGY_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 🆕🆕 D374 — THE FIRST PRINTED CARD NAME READ OFF AN ATTACHED CARD, AND D207's
// SUPPLY QUESTION ASKED OF THE ONE CANDIDATE IN THIS RUN THAT WAS EXPECTED TO FAIL
// IT.
//
// D373 handed over *"If this Pokémon has any Team Rocket's Energy attached, this
// attack does 60 more damage."* (Team Rocket's Zapdos `sv10-070` "Wicked Thunder",
// **1 sentence / 2 legal printings**) with two questions in FRONT of the build, in
// D368's order — a SUPPLY question that could disqualify it outright, then a SHAPE
// question — and with a named fallback to take if the supply side turned out to be
// absent. **NEITHER REFUSAL IS OWED. Both questions are settled here, on boards.**
//
// ✅ **THE SUPPLY QUESTION PASSES** (§2). D207's failure mode is a predicate over a
// banner no column CLASSIFIES — `Tera` sits on 22 rows and **every occurrence is
// DEMAND**; `Ancient` / `Future` likewise — which would have made this candidate an
// op with a permanently unsatisfiable antecedent. It is not that shape:
// `InPlayPokemon.energy` holds uids, `state.cardIdByUid` resolves each to a catalog
// id and `cardOfUid` to the `Card`, whose `name` is an INGESTED COLUMN. §2 does not
// argue that — it reads the name back off a live board through the engine's own
// accessor, and then drives the +60.
//
// 🛑 **THE SHAPE QUESTION: ONE CARD NAME, NOT THE `Team Rocket's ` PREFIX FAMILY**
// (§3). *"Team Rocket's Pokémon"* genuinely IS a prefix family — `ownerPokemon`
// (D242) exists for it — so the same three words in front of *Energy* read as a
// family at first glance. They are not one: **exactly ONE Energy card carries the
// prefix** (`Team Rocket's Energy` `sv10-182`, reprinted `me2pt5-217`), which
// `cards.ts` already records by id as the near miss its `category === "Pokemon"`
// conjunct exists to refuse. ⚠️ **THE TWO READINGS ARE THEREFORE EXTENSIONALLY
// IDENTICAL ON TODAY'S POOL** — the choice costs nothing now and is a commitment
// about later — so it goes D373's way, on D373's tie-break: a name equality never
// over-serves, a prefix reading would silently pay +60 for a card the sentence may
// not name. ✅ **AND IT CARRIES AN ATTRIBUTION CONTROL** (D214): the prefix reading
// is computed BESIDE the member on every board this file builds, and the two differ
// on exactly one — an invented `Team Rocket's Fix Energy` — and agree everywhere
// else. **WHAT WOULD FALSIFY THE CHOICE**: a printed `Team Rocket's ⟨X⟩ Energy`, or
// a ruling reading the clause as the family.
//
// ⚠️ **THE ROW IS A LITERAL BECAUSE A CARD NAME HAS NO CLOSED VOCABULARY** (§5,
// D118). `SELF_ENERGY_ATTACHED_CLAUSE` — `^this Pokémon has any (.+) Energy
// attached$` — ALREADY matches this printed clause and captures `Team Rocket's`;
// only `CLAUSE_ENERGY_TOKENS` missing that token keeps it null. A template over the
// NAME would answer an energy nobody printed with this member, and §5 drives that
// refusal on an invented sentence.
//
// ⚠️ **AND THE PARAMETER IS THE UNION'S FIRST PRINTED TEXT CARRYING AN APOSTROPHE**
// (§5), which puts D154's fold on a new site: a punctuation-normalising re-ingest
// curls the printed SENTENCE and `Card.name` together, and `literalClauseRow`
// already folds the clause key. Folding one side and not the other is D137's
// half-fix wearing a proper noun. Both sides are driven.
//
// WHAT SHIPS: **1 new `BoardCondition` member** (`yourActiveHasNamedEnergyAttached`,
// carrying `name: string`), its **2** reader arms, **1 literal
// `CONDITIONAL_DAMAGE_CLAUSES` row** and **1 new import** (`cardOfUid` into
// interpreter.ts). ZERO new maps, templates, patterns, ops, events or
// `packages/schema` bytes, and `MATCH_RECORD_VERSION` stays 22.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/** The nine live readers, run as one — the same set `censusAtHead.test.ts` and
    `benchAllDamagedBonus.test.ts` use. */
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

/** THE SENTENCE THIS SLICE BUYS — Team Rocket's Zapdos `sv10-070` "Wicked Thunder",
    2 legal printings of ONE sentence, byte-for-byte from the committed corpus. */
const TAKEN =
  "If this Pokémon has any Team Rocket's Energy attached, this attack does 60 more damage.";
const TAKEN_CLAUSE = "this Pokémon has any Team Rocket's Energy attached";

/** THE PRINTED CARD NAME the member keys on, spelled ONCE and asserted against the
    fixture the boards actually attach — so a typo cannot be green on both sides. */
const TR_ENERGY = "Team Rocket's Energy";

const NAMED: BoardCondition = { kind: "yourActiveHasNamedEnergyAttached", name: TR_ENERGY };
const SPECIAL: BoardCondition = { kind: "yourActiveHasEnergyAttached", energy: "special" };

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: TR_ENERGY_DECK, p2: TR_ENERGY_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** The seat's opposite. Spelled once here rather than imported, because the member
    is seat-relative on the face of it and every board below names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

/** `fix-trbonus` in `seat`'s Active Spot with its `{C}` paid by a BASIC Energy, a
    200 HP `fix-bigbody` across the table, and both benches cleared. `board` opens
    P1's turn, so a P2 case passes once more: a p1-only suite cannot tell "reads YOUR
    Active" apart from "reads p1's Active".

    ⚠️ THE `{C}` IS PAID BY `fix-energy` AND NEVER BY THE SPECIAL UNDER TEST. Every
    unauthored Special provides `{C}` (`energyProvidesOf`), so a board that let the
    Team Rocket's Energy pay the cost could not tell "the clause is armed" from "the
    attack is affordable at all". */
function ready(seed: number, seat: Seat = "p1"): GameState {
  let state = board(seed);
  if (seat === "p2") state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = setActiveFromDeck(state, seat, "fix-trbonus");
  state = attachFromDeck(state, seat, "fix-energy", 1);
  state = setActiveFromDeck(state, other(seat), "fix-bigbody");
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

/** THE ATTRIBUTION CONTROL (D214), and the reason this file can show the SHAPE
    choice is doing something rather than assert that it is harmless: the member's
    predicate with the name EQUALITY swapped for the `Team Rocket's ` PREFIX reading,
    computed here off the same array the arm reads. Every board below compares the
    two. */
function prefixReading(state: GameState, seat: Seat): boolean {
  const active = state.players[seat].active;
  if (active === null) return false;
  return active.energy.some((uid) => cardOfUid(state, uid)?.name.startsWith("Team Rocket's ") ===
    true);
}

/** The names the engine can actually SEE on `seat`'s Active's attached Energy, read
    through the engine's own accessor rather than off the fixture table — which is
    what makes §2 a measurement of the SUPPLY rather than of this file. */
function attachedNames(state: GameState, seat: Seat): string[] {
  const active = state.players[seat].active;
  if (active === null) return [];
  return active.energy.map((uid) => cardOfUid(state, uid)?.name ?? "<unresolved>");
}

describe("§1 — the price, RE-DERIVED: a 1:2 step and the band down to three", () => {
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
    // D373 left the residue at 27 records / 34 printings and pinned FOUR clauses in
    // the 2-printing band. Both figures are re-derived here off the same instrument —
    // the nine live readers over `legalAttackCorpus()` — rather than quoted.
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    // The DEPARTURE and the SIZE are asserted separately: a guard that only checked
    // 26 / 32 could not tell "the row landed" from "a reader broke".
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    // 🆕🆕 D375 — 26 / 32 -> 25 / 30: the CROSS-BOARD TYPE INTERSECTION — this
    // file's own named fallback, taken by the very next slice — left the residue at
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
    // 🛑 AND THE STEP IS 1:2, the shape D369/D370/D371/D373 kept. Every earlier head
    // is re-derived from THIS one rather than frozen: 🆕 D374's 26/32, D373's 27/34,
    // D372's 28/36, D371's 30/38.
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

    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    // THREE at 2 printings once this slice's clause has left the band — D373's four
    // minus the one taken, spelled out so a successor inherits the tie-break MEASURED
    // rather than re-running it. The cross-board type INTERSECTION is D373's named
    // fallback and is now the head of the queue; the healed-this-turn clause is the
    // expensive one (a per-turn flag on the state, hence a MATCH_RECORD_VERSION bump).
    // 🆕🆕 D375 — THREE -> TWO, AND THE PREDICTION THIS BLOCK MADE WAS RIGHT: D375
    // took the named fallback, which was indeed the head of the queue, and the two
    // survivors are the two this comment already priced.
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

  it("🛑 ONE sentence, TWO printings — and the CLAUSE is the whole population", () => {
    const records = corpus().filter(([, s]) => s === TAKEN);
    expect(records).toHaveLength(1);
    expect(units(records)).toBe(2);
    // …and no second sentence carries the clause under a different amount, so the row
    // cannot be short and cannot rot on a reprint.
    const clauseRows = corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === TAKEN_CLAUSE);
    expect(clauseRows).toHaveLength(1);
    expect(units(clauseRows)).toBe(2);
    // 🛑 AND THE `Team Rocket's Energy` NOUN APPEARS IN THE LEGAL ATTACK COLUMN TWICE
    // AND ONLY TWICE, which is the measurement that says what this member does NOT
    // buy. The second sentence is a DISCARD ("Discard a Team Rocket's Energy from
    // this Pokémon. If you do, discard your opponent's Active Pokémon and all
    // attached cards.", 3 printings) — a named-card COST on `discardEnergy`, not a
    // board condition, and deliberately left where it is. Re-run rather than
    // inherited, so a set that prints a third reddens HERE.
    const mentions = corpus().filter(([, s]) => s.includes(TR_ENERGY));
    expect(mentions).toHaveLength(2);
    expect(mentions.filter(([, s]) => s === TAKEN)).toHaveLength(1);
    expect(units(mentions.filter(([, s]) => s !== TAKEN))).toBe(3);
    // ⚠️ THE IDS BEHIND THE TWO PRINTINGS ARE NOT READ FROM THE CATALOG — D369's
    // constraint, unchanged: this container has no D1 credentials and no local sqlite
    // copy. `sv10-070` is recorded in the fixture's doc block from the PRINTED CARD
    // rather than from a query, and nothing on this path needs an id: a literal row is
    // keyed on the printed clause and serves every printing of it.
  });
});

describe("§2 — D207's SUPPLY question, asked of the field and answered on a board", () => {
  it("🛑 the engine can SEE a `Card.name` on an ATTACHED Energy — read back live", () => {
    // THE QUESTION THAT COULD HAVE DISQUALIFIED THE SLICE. `Tera` is on 22 catalog
    // rows and every occurrence is DEMAND; a member reading a banner like that has a
    // permanently empty candidate set. This one reads an INGESTED COLUMN, and the
    // proof is a round trip through the engine's own accessor rather than a look at
    // the fixture table: uid → `state.cardIdByUid` → `state.cardPool` → `Card.name`.
    const armed = attachFromDeck(ready(7400), "p1", "fix-tr-energy", 1);
    expect(attachedNames(armed, "p1")).toEqual(["fix-energy", TR_ENERGY]);
    // …and the supply really is the CATALOG's, not this file's: the card has sat in
    // FIXTURE_POOL since D242 as `ownerPokemon`'s near miss, under its REAL name.
    expect(FIXTURE_POOL["fix-tr-energy"]?.name).toBe(TR_ENERGY);
    expect(FIXTURE_POOL["fix-tr-energy"]?.category).toBe("Energy");
  });

  it("🛑 …and the clause DRIVES: +60 with it attached, nothing without", () => {
    // The member and the printed consequent, on a real declaration. 10 base, so the
    // bonus cannot be confused with it.
    const bare = ready(7401);
    expect(conditionHolds(bare, "p1", NAMED)).toBe(false);
    expect(damageDealt(bare)).toBe(10);

    const armed = attachFromDeck(ready(7402), "p1", "fix-tr-energy", 1);
    expect(conditionHolds(armed, "p1", NAMED)).toBe(true);
    expect(damageDealt(armed)).toBe(70);

    // Both seats, because "this Pokémon" resolves to YOUR Active and a p1-only suite
    // cannot tell that from "p1's Active".
    const armedP2 = attachFromDeck(ready(7403, "p2"), "p2", "fix-tr-energy", 1);
    expect(conditionHolds(armedP2, "p2", NAMED)).toBe(true);
    expect(damageDealt(armedP2, "p2")).toBe(70);
  });

  it("🛑 an EMPTY Active Spot is FALSE, not a throw", () => {
    // Every card-reading member in this union answers false with no Active, and the
    // arm's early return is what makes that true here rather than a crash inside
    // `.some`.
    const armed = attachFromDeck(ready(7404), "p1", "fix-tr-energy", 1);
    const vacated: GameState = {
      ...armed,
      players: { ...armed.players, p1: { ...armed.players.p1, active: null } },
    };
    expect(conditionHolds(vacated, "p1", NAMED)).toBe(false);
    expect(prefixReading(vacated, "p1")).toBe(false);
  });
});

describe("§3 — THE SHAPE CHOICE: one NAME, not the prefix — with its attribution control", () => {
  it("🛑 a `Team Rocket's ⟨X⟩ Energy` does NOT arm it, and the prefix reading WOULD", () => {
    // THE ASSERTION THE SHAPE CHOICE EXISTS FOR. `fix-tr-other-energy` is named
    // "Team Rocket's Fix Energy" — invented, because no such card is printed, which
    // is exactly the fact that makes the two readings indistinguishable on the real
    // pool. On THIS board they come apart: the prefix reading says TRUE, the member
    // says FALSE, and the +60 is not paid.
    const other = attachFromDeck(ready(7500), "p1", "fix-tr-other-energy", 1);
    expect(attachedNames(other, "p1")).toEqual(["fix-energy", "Team Rocket's Fix Energy"]);
    expect(prefixReading(other, "p1")).toBe(true);
    expect(conditionHolds(other, "p1", NAMED)).toBe(false);
    expect(damageDealt(other)).toBe(10);
  });

  it("🛑 …and that is the ONLY board where the member and the prefix reading differ", () => {
    // The other half of the control, and what keeps the equality from being a
    // superstition: on every attachment the real pool can produce, the two readings
    // AGREE — which is the measured statement "extensionally identical today", made
    // on boards rather than in a comment.
    for (const attachments of [
      [],
      ["fix-tr-energy"],
      ["fix-special"],
      ["fix-not-tr-energy"],
      ["fix-tr-energy", "fix-special"],
      ["fix-special", "fix-not-tr-energy"],
      ["fix-tr-energy", "fix-tr-energy"],
    ]) {
      let state = ready(7501);
      for (const id of attachments) state = attachFromDeck(state, "p1", id, 1);
      expect(conditionHolds(state, "p1", NAMED), attachments.join("+")).toBe(
        prefixReading(state, "p1"),
      );
    }
    // …and the invented card is where they disagree. Asserted last, so the sweep
    // above is a statement about the real pool rather than about the predicate.
    const other = attachFromDeck(ready(7502), "p1", "fix-tr-other-energy", 1);
    expect(conditionHolds(other, "p1", NAMED)).not.toBe(prefixReading(other, "p1"));
  });

  it("🛑 the prefix must be neither `includes` nor `endsWith`: 'Rival of …' is refused", () => {
    // `fix-not-tr-energy` is named "Rival of Team Rocket's Energy" — the name CONTAINS
    // the whole printed noun and is not EQUAL to it, so an `includes` or an `endsWith`
    // admits it. It is `fix-not-tr-body`'s shape (D242) one category over, and with
    // the row above it separates all three refutable predicates on real boards.
    const rival = attachFromDeck(ready(7503), "p1", "fix-not-tr-energy", 1);
    expect(attachedNames(rival, "p1")).toEqual(["fix-energy", "Rival of Team Rocket's Energy"]);
    expect(conditionHolds(rival, "p1", NAMED)).toBe(false);
    expect(prefixReading(rival, "p1")).toBe(false);
    expect(damageDealt(rival)).toBe(10);
    // …and the real card on the SAME shape of board is TRUE, so the loop is about the
    // name and not about the attachment machinery.
    const real = attachFromDeck(ready(7504), "p1", "fix-tr-energy", 1);
    expect(conditionHolds(real, "p1", NAMED)).toBe(true);
  });

  it("🛑 a second, DIFFERENT Energy alongside it does not disarm it", () => {
    // `.some`, not `.every`: the printed word is "any". A board carrying the named
    // card plus two decoys is still TRUE, and the decoys alone are still FALSE.
    let both = attachFromDeck(ready(7505), "p1", "fix-special", 1);
    both = attachFromDeck(both, "p1", "fix-tr-energy", 1);
    both = attachFromDeck(both, "p1", "fix-not-tr-energy", 1);
    expect(both.players.p1.active?.energy).toHaveLength(4);
    expect(conditionHolds(both, "p1", NAMED)).toBe(true);
    expect(damageDealt(both)).toBe(70);

    let decoys = attachFromDeck(ready(7506), "p1", "fix-special", 1);
    decoys = attachFromDeck(decoys, "p1", "fix-not-tr-energy", 1);
    expect(conditionHolds(decoys, "p1", NAMED)).toBe(false);
    expect(damageDealt(decoys)).toBe(10);
  });
});

describe("§4 — the near miss: a NAME against a PROVISION, on one board", () => {
  it("🛑 a plain Special satisfies `energy: \"special\"` and NOT this member", () => {
    // THE REASON `yourActiveHasEnergyAttached` WAS NOT WIDENED. That member reads by
    // PROVISION and by CARD CLASS; this one reads a printed NAME. `fix-special` is a
    // Special Energy with no prefix at all, so the two disagree on it — which is what
    // makes them two members rather than one field with two meanings.
    const special = attachFromDeck(ready(7600), "p1", "fix-special", 1);
    expect(conditionHolds(special, "p1", SPECIAL)).toBe(true);
    expect(conditionHolds(special, "p1", NAMED)).toBe(false);
    expect(damageDealt(special)).toBe(10);
  });

  it("🛑 …and `Team Rocket's Energy` satisfies BOTH, which is why the pair is a pair", () => {
    // The named card IS a Special, so the wider member is true of it too. A guard that
    // only ever saw this board could not tell the two members apart at all — which is
    // why the board above exists and is asserted first.
    const named = attachFromDeck(ready(7601), "p1", "fix-tr-energy", 1);
    expect(conditionHolds(named, "p1", SPECIAL)).toBe(true);
    expect(conditionHolds(named, "p1", NAMED)).toBe(true);
    expect(damageDealt(named)).toBe(70);
  });

  it("🛑 a BASIC Energy satisfies neither, and pays the cost all the same", () => {
    // `ready` already attaches one `fix-energy` to pay the `{C}`, so every "nothing
    // attached" board above is really "one BASIC attached" — stated here rather than
    // left implicit, because a member that answered TRUE on a basic would have been
    // green on the bare board for the wrong reason.
    const bare = ready(7602);
    expect(attachedNames(bare, "p1")).toEqual(["fix-energy"]);
    expect(conditionHolds(bare, "p1", SPECIAL)).toBe(false);
    expect(conditionHolds(bare, "p1", NAMED)).toBe(false);
    expect(damageDealt(bare)).toBe(10);
  });
});

describe("§5 — the ZONE and the SEAT: your ACTIVE, and nothing else", () => {
  it("🛑 the same card on your BENCH does not arm it", () => {
    // The printed pronoun is "this Pokémon", which the clause table resolved to YOUR
    // ACTIVE. A benched body holding the named Energy must not pay the attacker's
    // bonus — the direction that actually costs, since a `[active, ...bench]` spread
    // is one identifier away in this arm's own file.
    let benched = benchFromDeck(ready(7700), "p1", "fix-basic-1");
    benched = attachBenchFromDeck(benched, "p1", 0, "fix-tr-energy", 1);
    expect(benched.players.p1.bench[0]?.energy).toHaveLength(1);
    expect(conditionHolds(benched, "p1", NAMED)).toBe(false);
    expect(prefixReading(benched, "p1")).toBe(false);
    expect(damageDealt(benched)).toBe(10);
    // …and moving it to the ACTIVE arms it, so the rung is about the ZONE rather than
    // about the attachment never having landed.
    const active = attachFromDeck(ready(7701), "p1", "fix-tr-energy", 1);
    expect(conditionHolds(active, "p1", NAMED)).toBe(true);
  });

  it("🛑 the same card across the table does not arm it", () => {
    // Seat-relative, and asserted from BOTH seats on one board: the opponent's Active
    // holding the named Energy makes THEIR reading true and yours false.
    const theirs = attachFromDeck(ready(7702), "p2", "fix-tr-energy", 1);
    expect(conditionHolds(theirs, "p1", NAMED)).toBe(false);
    expect(conditionHolds(theirs, "p2", NAMED)).toBe(true);
    expect(damageDealt(theirs)).toBe(10);
  });

  it("🛑 a Pokémon TOOL slot is a different array and cannot reach it", () => {
    // `InPlayPokemon` carries `energy` and `tools` as separate uid arrays, and THAT is
    // what makes this arm need no `category` test where `matchesFilter`'s
    // `ownerPokemon` needs one. Driven by moving the very same uid across: the card
    // that arms the clause from `energy` is invisible from `tools`.
    const armed = attachFromDeck(ready(7703), "p1", "fix-tr-energy", 1);
    const active = armed.players.p1.active;
    if (active === null) throw new Error("p1 has no Active Pokémon");
    const asTool: GameState = {
      ...armed,
      players: {
        ...armed.players,
        p1: {
          ...armed.players.p1,
          active: { ...active, energy: active.energy.slice(0, 1), tools: active.energy.slice(1) },
        },
      },
    };
    expect(asTool.players.p1.active?.tools).toHaveLength(1);
    expect(conditionHolds(armed, "p1", NAMED)).toBe(true);
    expect(conditionHolds(asTool, "p1", NAMED)).toBe(false);
  });
});

describe("§6 — the clause row, D118's refusal, the note and D154's fold", () => {
  it("maps the printed sentence onto the new member at the printed 60", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 60,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourActiveHasNamedEnergyAttached", name: TR_ENERGY },
      },
    });
  });

  it("🛑 the TEMPLATE beside it still owns the energy TOKENS, and claims no name", () => {
    // `SELF_ENERGY_ATTACHED_CLAUSE` matches this printed clause and captures
    // "Team Rocket's"; the literal table is pass ONE, so the row wins. The template's
    // own sentences must keep resolving to the PROVISION member — otherwise the row
    // has been added by breaking the pattern rather than beside it.
    expect(
      deriveAttackDamageBonus("If this Pokémon has any {R} Energy attached, this attack does 90 more damage."),
    ).toEqual({
      per: 90,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourActiveHasEnergyAttached", energy: "Fire" },
      },
    });
    expect(
      deriveAttackDamageBonus("If this Pokémon has any Special Energy attached, this attack does 140 more damage."),
    ).toEqual({
      per: 140,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourActiveHasEnergyAttached", energy: "special" },
      },
    });
  });

  it("🛑 D118: an UNPRINTED energy NAME in the same shape resolves to NOTHING", () => {
    // THE REASON THIS IS A ROW AND NOT A TEMPLATE. A card name has no closed
    // vocabulary for a lookup to fail against, so `has any (.+) Energy attached`
    // parameterised over the NAME would answer every one of these with this member and
    // score +60 off cards nobody printed. If any of them ever resolves, a template has
    // been introduced where a row was measured to be right.
    for (const near of [
      "If this Pokémon has any Fixmon's Energy attached, this attack does 60 more damage.",
      "If this Pokémon has any Team Rocket's Fix Energy attached, this attack does 60 more damage.",
      "If this Pokémon has any Team Rocket's Pokémon attached, this attack does 60 more damage.",
      "If this Pokémon has any Team Rocket's Energy attached, this attack does 60 less damage.",
      "If your opponent's Active Pokémon has any Team Rocket's Energy attached, this attack does 60 more damage.",
    ]) {
      expect(resolvedByAnyReader(near), near).toBe(false);
    }
    // …and the taken sentence IS resolved, so the loop above is a statement about
    // those five strings rather than about the reader being asleep.
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
  });

  it("🛑 the note names the CARD whole, and does not round-trip to the printed bytes", () => {
    // The pronoun is resolved (D116) and the name already ends in "Energy", so the
    // pill reads as prose rather than as the printed clause. Asserted in the NEGATIVE
    // too, because three siblings in this family DO round-trip and a successor
    // "fixing" this one into the table key would be undoing a decision.
    expect(conditionNote(NAMED)).toBe("your Active Pokémon has a Team Rocket's Energy attached");
    expect(conditionNote(NAMED)).not.toBe(TAKEN_CLAUSE);
    expect(conditionNote(NAMED)).not.toBe(conditionNote(SPECIAL));
    // It is built from the PARAMETER rather than returned as a literal, so a second
    // named-Energy row costs no note arm.
    expect(
      conditionNote({ kind: "yourActiveHasNamedEnergyAttached", name: "Fixmon's Energy" }),
    ).toBe("your Active Pokémon has a Fixmon's Energy attached");
  });

  it("🛑 D154's fold, on BOTH sides: a curled SENTENCE and a curled CARD NAME", () => {
    // THE HAZARD THIS MEMBER INTRODUCES. A punctuation-normalising re-ingest curls the
    // printed sentence AND `Card.name` together. `literalClauseRow` already retries a
    // clause-table miss with U+2019 folded, so the KEY survives — and the VALUE
    // survives only because the ARM folds the card side before comparing. Folding one
    // and not the other is exactly D137's half-fix, wearing a proper noun.
    const curled = TAKEN.replaceAll("'", "’");
    expect(curled).toContain("’");
    expect(curled).not.toBe(TAKEN);
    expect(deriveAttackDamageBonus(curled)).toEqual(deriveAttackDamageBonus(TAKEN));

    // …and the CARD side, on a board: the same fixture with its NAME curled in the
    // state's own card pool, which is where `cardOfUid` reads it from.
    const armed = attachFromDeck(ready(7800), "p1", "fix-tr-energy", 1);
    const printed = armed.cardPool["fix-tr-energy"];
    if (printed === undefined) throw new Error("fix-tr-energy is not in the card pool");
    const curledBoard: GameState = {
      ...armed,
      cardPool: {
        ...armed.cardPool,
        "fix-tr-energy": { ...printed, name: printed.name.replaceAll("'", "’") },
      },
    };
    expect(attachedNames(curledBoard, "p1")[1]).toContain("’");
    expect(conditionHolds(curledBoard, "p1", NAMED)).toBe(true);
    expect(damageDealt(curledBoard)).toBe(70);
    // The fold is a NORMALISATION and not a wildcard: a differently-punctuated name is
    // still refused, so the arm has not been widened into an approximate match.
    const wrong: GameState = {
      ...armed,
      cardPool: {
        ...armed.cardPool,
        "fix-tr-energy": { ...printed, name: "Team Rockets Energy" },
      },
    };
    expect(conditionHolds(wrong, "p1", NAMED)).toBe(false);
  });
});
