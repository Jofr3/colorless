import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackRequirement,
} from "./effects";
import type { BoardCondition, GameEvent, GameState, Seat } from "./index";
import { countAttachedEnergy, providedEnergy } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  SAME_ENERGY_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 🆕🆕 D372 — THE CROSS-BOARD EQUAL-ENERGY CLAUSE, AND A SHAPE QUESTION THAT WAS
// ANSWERED BY FINDING IT RATHER THAN BY DECIDING IT.
//
// D371 handed over *"this Pokémon and your opponent's Active Pokémon have the same
// amount of Energy attached"* — **2 legal printings across TWO printed sentences**
// (+100 and +120, one printing each) — as the cheapest of the six clauses its own §1
// left pinned in the residue's 2-printing band, with three things measured in
// advance and one instruction: the CARDS-vs-UNITS question is already settled in the
// engine, so FIND that answer instead of re-deciding it.
//
// ✅ **CARDS, NOT UNITS — AND `countAttachedEnergy`'s OWN DOC BLOCK ARGUES THE CASE**
// (§2). `countAttachedEnergy(state, pokemon, null)` is the unfiltered CARD count and
// says so in its own words: *"one Energy card is one Energy however many units it
// provides"*, the identical rule `countEnergyInPlay` gives one function down. The
// member delegates and writes no counting code. ⚠️ **AND THE QUESTION WAS REAL**:
// one `fix-blend` (a Special providing TWO types from ONE card) against two basics
// is 1 ≠ 2 by CARD and 2 = 2 by UNIT, so the two readings disagree on a board this
// engine can build — driven in both directions rather than argued.
//
// ✅ **THE CROSS-BOARD FORM WAS ALREADY SHIPPED, ONE OPERATOR OVER** (§4).
// `attack.ts` SUMS `countAttachedEnergy(state, attacker, null)` and the same call on
// the defender's Active for *"…for each Energy attached to both Active Pokémon."*
// (8 legal printings). The same two operands, a sum instead of an equality — which
// is D371's lesson run forward and the reason this slice is cheap: *"the engine
// already reads this field"* was, this time, also *"the engine already asks this
// question"*.
//
// 🛑 **THE ZONE IS THE BODY AND NOT THE SIDE, AND THE WRONG CODE IS ALREADY
// IMPORTED** (§5). `countEnergyInPlay(state, seat, null)` has been in
// `interpreter.ts`'s import block since D193 and counts Active **plus Bench**. The
// printed subjects are two ACTIVE bodies. Benched Energy is invisible to this
// clause, and that is a board here rather than a sentence.
//
// 🛑 **SEAT-SYMMETRIC IN VALUE, ASYMMETRIC IN SPELLING — AND THIS IS THE FIRST
// MEMBER WHERE THOSE TWO COME APART** (§6). The printed sentence names the pronoun
// on one side and the full noun phrase on the other; the truth value commutes,
// because equality commutes over the two Actives. So the member is the vocabulary's
// SECOND seat-symmetric one, and `handSizesEqual`'s *"the ONE member"* comment went
// stale the moment this landed — corrected in `effects.ts`, `interpreter.ts` and
// `publicCount.test.ts` in the same commit. **A NEW MEMBER CAN FALSIFY A COMMENT IN
// A FILE IT DOES NOT TOUCH** (D370, in the other direction).
//
// ⚠️ **THE NEAR MISS IS PRINTED, IS ONE OPERATOR AWAY, AND WAS LEFT REFUSED** (§3).
// The legal pool prints *"If this Pokémon has more Energy attached than your
// opponent's Active Pokémon, this attack does 160 more damage."* — 1 legal printing,
// the SAME two operands under a STRICT inequality. Building it would have made this
// slice's `===` → `>` mutant green for the wrong reason; it is measured, driven as a
// refusal, and handed on priced.
// 🆕🆕 **D384 TOOK IT, TWELVE SLICES LATER, AT EXACTLY THE PRICE THIS FILE QUOTED** —
// Swalot `sv07-092` "Devouring Mouth", one nullary `moreActiveEnergyThanOpponent`
// member and one literal row. §3's refusal rung is now a DISJOINTNESS rung: the
// tripwire fired, and what it was pointing at is `moreEnergyBonus.test.ts`. The
// `===` → `>` mutant did NOT go green — the two members are separate and §5 drives
// both boards — which is the thing D372 was worried about, measured rather than
// hoped for.
//
// WHAT SHIPS: 1 new `BoardCondition` member (`activeEnergyCountsEqual`), its 2
// reader arms, 1 literal `CONDITIONAL_DAMAGE_CLAUSES` row and 1 new import. ZERO new
// vocabulary, maps, templates or patterns.

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
  deriveAttackBonusConsequent,
];
const resolvedByAnyReader = (text: string): boolean => READERS.some((read) => read(text) !== null);

/** THE TWO SENTENCES THIS SLICE BUYS, and the ONE clause inside both of them. The
    amount is captured by the skeleton, so a single clause-table row serves the
    pair — which is why this slice's census step is 2 SENTENCES and 2 PRINTINGS
    where the four before it were 1 sentence and 2 or 3 printings. */
const TAKEN_100 =
  "If this Pokémon and your opponent's Active Pokémon have the same amount of Energy attached, this attack does 100 more damage.";
const TAKEN_120 =
  "If this Pokémon and your opponent's Active Pokémon have the same amount of Energy attached, this attack does 120 more damage.";
const TAKEN_CLAUSE =
  "this Pokémon and your opponent's Active Pokémon have the same amount of Energy attached";

/** THE PRINTED NEAR MISS — the same two operands under a STRICT inequality, 1 legal
    printing. Left refused by D372, and 🆕🆕 **BUILT BY D384** as the separate member
    `moreActiveEnergyThanOpponent`; §3 keeps it as the DISJOINTNESS anchor. */
const STRICTLY_MORE =
  "If this Pokémon has more Energy attached than your opponent's Active Pokémon, this attack does 160 more damage.";

const EQUAL: BoardCondition = { kind: "activeEnergyCountsEqual" };

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: SAME_ENERGY_DECK, p2: SAME_ENERGY_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** The seat's opposite. Spelled once here rather than imported, because the member
    is seat-relative on the FACE of it and every board case below names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

/** `attacker` in `seat`'s Active Spot with the `{C}` paid by ONE `fix-energy` — so
    the attacking body starts at exactly ONE attached CARD, which every case below
    counts from — `fix-energyholder` across the table holding NOTHING, and BOTH
    benches EMPTY. `board` opens P1's turn, so a P2 case passes once more: a p1-only
    suite cannot tell "reads the two Actives" apart from "reads p1's and p2's". */
function ready(seed: number, seat: Seat = "p1", attacker = "fix-sameenergy"): GameState {
  let state = board(seed);
  if (seat === "p2") state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = setActiveFromDeck(state, seat, attacker);
  state = attachFromDeck(state, seat, "fix-energy", 1);
  state = setActiveFromDeck(state, other(seat), "fix-energyholder");
  return clearBench(clearBench(state, seat), other(seat));
}

/** `ready`'s board with the cost NOT paid: both Active Spots filled and NOTHING
    attached on either side. No attack can be declared from it — the printed `{C}`
    is unpaid — and it is the only board where the attacking body holds ZERO, which
    is what the 0 = 0 rung and the empty-Active rung are both about. */
function unpaid(seed: number): GameState {
  const state = setActiveFromDeck(
    setActiveFromDeck(board(seed), "p1", "fix-sameenergy"),
    "p2",
    "fix-energyholder",
  );
  return clearBench(clearBench(state, "p1"), "p2");
}

/** Attack index 0 from `seat` and report the damage actually dealt. */
function damageDealt(state: GameState, seat: Seat = "p1"): number {
  const after = mustApply(state, { type: "attack", seat, index: 0 });
  const dealt = after.events.find((e: GameEvent) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

/** TEST SURGERY, local to this file: move `count` copies of `cardId` from the seat's
    deck onto bench[index]'s energy. `attachFromDeck` reaches the ACTIVE only, and
    the rung that separates "the two Active BODIES" from "the two SIDES" needs Energy
    somewhere the member must not see. Every uid stays in exactly one zone. */
function attachOnBench(
  state: GameState,
  seat: Seat,
  index: number,
  cardId: string,
  count: number,
): GameState {
  const side = state.players[seat];
  const uids = side.deck.filter((uid) => state.cardIdByUid[uid] === cardId).slice(0, count);
  const body = side.bench[index];
  if (uids.length < count) throw new Error(`${seat} deck has ${uids.length} ${cardId}`);
  if (body === undefined) throw new Error(`${seat} has no benched Pokémon at ${index}`);
  const taken = new Set(uids);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((uid) => !taken.has(uid)),
        bench: side.bench.map((p, i) => (i === index ? { ...p, energy: [...p.energy, ...uids] } : p)),
      },
    },
  };
}

/** TEST SURGERY: empty an Active Spot. No legal action reaches this board — a seat
    with no Active has lost — but the member commits to answering FALSE there, and a
    commitment nothing drives is a comment. */
function emptyActive(state: GameState, seat: Seat): GameState {
  return {
    ...state,
    players: { ...state.players, [seat]: { ...state.players[seat], active: null } },
  };
}

/** How many Energy CARDS and how many UNITS `seat`'s Active is holding — the two
    readings of the printed noun, side by side, so a board that is supposed to
    separate them can be shown to. */
function cardsAndUnits(state: GameState, seat: Seat): readonly [number, number] {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active Pokémon`);
  return [countAttachedEnergy(state, active, null), providedEnergy(state, active).length];
}

describe("§1 — the price, RE-DERIVED: the residue, the band, and a step of TWO sentences", () => {
  it("🛑 the residue steps by exactly these TWO sentences, and the band by exactly one CLAUSE", () => {
    // D371 left the residue at 30 / 38 and pinned SIX clauses at 2 printings. Both
    // figures are re-derived here off the same instrument — the nine live readers
    // over `legalAttackCorpus()` — rather than quoted.
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    // The DEPARTURE and the SIZE are asserted separately: a guard that only checked
    // 28 / 36 could not tell "the row landed" from "a reader broke".
    expect(refused.some(([, s]) => s === TAKEN_100)).toBe(false);
    expect(refused.some(([, s]) => s === TAKEN_120)).toBe(false);
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
    expect(refused.length).toBe(7); // 🆕🆕 D398 — 8 -> 7, the DECK-SIZE READ, and the LAST buildable sentence in this residue
    expect(units(refused)).toBe(10); // 🆕🆕 D398 — 11 -> 10, the DECK-SIZE READ's one printing
    // 🛑 AND THE STEP IS 2 AND 2, WHICH IS THE FIRST 2:2 STEP IN THIS RUN. D368 moved
    // it 1:3 and D369/D370/D371 each 1:2. Every earlier head is re-derived from THIS
    // one rather than frozen, and the sentence term moves by TWO where the printing
    // term moves by two — the arithmetic that says a CLAUSE-keyed band entry is not
    // a sentence count.
    // 🆕🆕 D373 — one more term on each chain, and the step is 1 sentence /
    // 2 printings (the UNIVERSAL-OVER-THE-BENCH clause).
    // 🆕🆕 D374 — one more term on each chain, and the step is 1 sentence /
    // 2 printings (the NAMED-ENERGY clause).
    // 🆕🆕 D375 — one more term again, same 1:2 step (the TYPE INTERSECTION).
    // 🆕🆕 D376 — one more term on every chain below, same 1:2 step (the FILTERED
    // DISCARD-PILE THRESHOLD). ⚠️ THE HEAD IS NOW 24 / 28, so every OFFSET here moved
    // by one sentence and two printings while the expected values stayed put — which
    // is the point of writing them as offsets off the live head at all.
    // 🆕🆕 D392 — the OFFSET gains one on each axis: the head moved, this one's did not.
    expect([refused.length + 17, units(refused) + 18]).toEqual([24, 28]);
    // 🆕🆕 D392 — the OFFSET gains one on each axis: the head moved, this one's did not.
    expect([refused.length + 18, units(refused) + 20]).toEqual([25, 30]);
    expect([refused.length + 19, units(refused) + 22]).toEqual([26, 32]);
    expect([refused.length + 20, units(refused) + 24]).toEqual([27, 34]);
    expect([refused.length + 21, units(refused) + 26]).toEqual([28, 36]);
    expect([refused.length + 23, units(refused) + 28]).toEqual([30, 38]);
    expect([refused.length + 24, units(refused) + 30]).toEqual([31, 40]);
    expect([refused.length + 25, units(refused) + 32]).toEqual([32, 42]);
    expect([refused.length + 26, units(refused) + 34]).toEqual([33, 44]);

    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    // FIVE at 2 printings once this slice's clause has left the band — D371's six
    // minus the one taken, spelled out so a successor inherits the tie-break
    // MEASURED rather than re-running it. Every one of them is a different
    // mechanism, and the shape of each is named in the resume point.
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
    expect([...byClause.values()].filter((n) => n > 1)).toEqual([5]);
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
    expect(byClause.size).toBe(6); // 🆕🆕 D398 — the DECK-SIZE READ took ONE more singleton out, a 1:1 step, and it was the LAST BUILDABLE one // 🆕🆕 D397 — the BENCHED-CUBONE FILTER took ONE more singleton out, back to a 1:1 step // 🆕🆕 D394 — the USED-ATTACK PAIR took TWO more singletons out at once, the second two-step in two slices
    expect(band.length + 2).toBe(2);
    // …with this slice's clause counted back in the band it is SIX, with D371's as
    // well SEVEN, and with D370's as well EIGHT — the chain D368's handoff opened.
    expect(band.length + 3).toBe(3);
    expect(band.length + 4).toBe(4);
    expect(band.length + 5).toBe(5);
    expect(band.length + 6).toBe(6);
    expect(band.length + 7).toBe(7);
    expect(band.length + 8).toBe(8);
    // The 5-printing declaration clause D368 disqualified on SHAPE is still the
    // largest thing in the residue and still refused, so nothing here re-priced it.
    expect(Math.max(...byClause.values())).toBe(5);
  });

  it("🛑 TWO sentences, ONE clause, ONE printing each — and that is ALL of them", () => {
    // The measurement the handoff made and this file re-makes: the clause is printed
    // under TWO distinct sentences, so the census's SENTENCE term moves by 2 while
    // its PRINTING term moves by 2 as well. Asserted as records AND as units,
    // because those are the two columns the fourteen census rungs are keyed on.
    const records = corpus().filter(([, s]) => s === TAKEN_100 || s === TAKEN_120);
    expect(records).toHaveLength(2);
    expect(units(records)).toBe(2);
    for (const [n] of records) expect(n).toBe(1);
    // …and the CLAUSE is the whole population: no third sentence in the corpus
    // carries it under any amount, so the row cannot be short and cannot rot on a
    // reprint at a new number.
    const clauseRows = corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === TAKEN_CLAUSE);
    expect(clauseRows).toHaveLength(2);
    expect(units(clauseRows)).toBe(2);
    // ⚠️ THE IDS BEHIND THOSE TWO PRINTINGS ARE NOT RECORDED, DELIBERATELY — D369's
    // finding, unchanged at D372: this container has no D1 credentials (`bunx
    // wrangler d1 execute` returns `CLOUDFLARE_API_TOKEN` unset) and there is no
    // local sqlite catalog, so they could not be read and are NOT guessed. Nothing
    // on this path needs them: a literal row is keyed on the printed clause, so it
    // serves every printing of it in every set.
  });

  it("🛑 D207's SUPPLY question does not ARISE here, and that is a result rather than a skip", () => {
    // Every member this family has bought since D368 reads an INGESTED CARD COLUMN —
    // `tools`, `types`, `resistances` — so "does a column CLASSIFY this?" had to be
    // asked each time, and `Tera` is what happens when the answer is no.
    //
    // This member reads `InPlayPokemon.energy`: a GAME-STATE array the engine writes
    // itself on every attach the rules allow. There is no catalog column to be empty,
    // so the permanently-empty-candidate-set failure is unreachable by construction
    // rather than merely unobserved. Driven rather than asserted: the count is
    // non-zero on a board built entirely by legal setup plus this file's surgery.
    const state = attachFromDeck(ready(9100), "p2", "fix-energy", 2);
    expect(cardsAndUnits(state, "p1")[0]).toBe(1);
    expect(cardsAndUnits(state, "p2")[0]).toBe(2);
  });
});

describe("§2 — the SHAPE question: CARDS, not UNITS, and the engine had already decided", () => {
  it("🛑 `countAttachedEnergy(…, null)` IS the card count, and the two readings DISAGREE on a board", () => {
    // The question the handoff ordered settled before a predicate was spelled: "the
    // same amount of Energy attached" reads as Energy CARDS or as the UNITS they
    // provide. It is settled by FINDING the engine's answer, not by choosing one —
    // and the finding is only worth something if the two answers can differ, which
    // is what this board shows.
    //
    // `fix-blend` is the FIXTURE Special that provides TWO distinct types ({R} and
    // {W}) from ONE card. One of them against two basics is 1 ≠ 2 by CARD and
    // 2 = 2 by UNIT.
    let state = attachFromDeck(ready(9101), "p1", "fix-energy", 1); // p1 Active: 2 cards
    state = attachFromDeck(state, "p2", "fix-blend", 1); // p2 Active: 1 card, 2 units
    expect(cardsAndUnits(state, "p1")).toEqual([2, 2]);
    expect(cardsAndUnits(state, "p2")).toEqual([1, 2]);
    // THE UNITS AGREE AND THE CARDS DO NOT. The member reads CARDS, so it is FALSE.
    expect(conditionHolds(state, "p1", EQUAL)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("🛑 …and the OTHER direction, which is the attribution control", () => {
    // The board above alone would be satisfied by a member that always answered
    // FALSE on a `fix-blend` board for any reason at all. This one inverts it: TWO
    // `fix-blend` against two basics is 2 = 2 by CARD and 2 ≠ 4 by UNIT, so a UNIT
    // reading answers FALSE exactly where the card reading answers TRUE.
    let state = attachFromDeck(ready(9102), "p1", "fix-energy", 1); // p1 Active: 2 cards, 2 units
    state = attachFromDeck(state, "p2", "fix-blend", 2); // p2 Active: 2 cards, 4 units
    expect(cardsAndUnits(state, "p1")).toEqual([2, 2]);
    expect(cardsAndUnits(state, "p2")).toEqual([2, 4]);
    expect(conditionHolds(state, "p1", EQUAL)).toBe(true);
    expect(damageDealt(state)).toBe(110);
  });

  it("the rule is `countAttachedEnergy`'s and is not restated here", () => {
    // The member delegates, so the two readings of the printed noun cannot drift:
    // whatever the §6.3 counter says about a Special is what this clause says. Shown
    // by equality against the helper on the same bodies rather than by a comment.
    let state = attachFromDeck(ready(9103), "p1", "fix-blend", 1);
    state = attachFromDeck(state, "p2", "fix-blend", 2);
    const p1 = state.players.p1.active;
    const p2 = state.players.p2.active;
    if (p1 === null || p2 === null) throw new Error("board has an empty Active Spot");
    expect(countAttachedEnergy(state, p1, null)).toBe(2);
    expect(countAttachedEnergy(state, p2, null)).toBe(2);
    expect(conditionHolds(state, "p1", EQUAL)).toBe(true);
    // …and a SPECIAL counts as one card here exactly as a basic does, which is the
    // sentence `countAttachedEnergy`'s doc block spells out.
    expect(providedEnergy(state, p1).length).toBe(3);
    expect(providedEnergy(state, p2).length).toBe(4);
  });
});

describe("§3 — the round trip, and the printed near miss that stays REFUSED", () => {
  it("both printed sentences resolve to ONE member at TWO amounts", () => {
    for (const [sentence, per] of [
      [TAKEN_100, 100],
      [TAKEN_120, 120],
    ] as const) {
      expect(deriveAttackDamageBonus(sentence)).toEqual({
        per,
        count: { kind: "boardCondition", cond: EQUAL },
      });
    }
    // The amount lives in the skeleton's capture, so a THIRD amount would resolve
    // off the same row the day one is printed — the property that makes this one
    // row rather than two.
    expect(deriveAttackDamageBonus(TAKEN_100.replace("100", "40"))).toEqual({
      per: 40,
      count: { kind: "boardCondition", cond: EQUAL },
    });
  });

  it("🆕🆕 D384 — the STRICT-INEQUALITY twin is BUILT, and it resolves to the OTHER member", () => {
    // 🛑 **THE TRIPWIRE FIRED, AND THIS IS WHAT IT LOOKS LIKE FROM THE OTHER SIDE.**
    // This test read *"is 1 legal printing, and is still refused"* for twelve slices,
    // with a comment saying *"the day a reader claims that sentence, it reddens here
    // naming the clause"*. D384 claimed it, this reddened, and the repair is a
    // DISJOINTNESS assertion rather than a deletion — the population half of the claim
    // (1 sentence, 1 printing, and the clause the skeleton captures) never depended on
    // the refusal and is kept verbatim.
    expect(corpus().filter(([, s]) => s === STRICTLY_MORE)).toHaveLength(1);
    expect(units(corpus().filter(([, s]) => s === STRICTLY_MORE))).toBe(1);
    expect(BONUS.exec(STRICTLY_MORE)?.[1]).toBe(
      "this Pokémon has more Energy attached than your opponent's Active Pokémon",
    );
    // 🛑 **IT IS A SECOND MEMBER AND NOT THIS ONE**, which is the thing D372 refused to
    // let a clause table decide by accident: keys are whole printed clauses and never
    // substrings, so this row could never have reached that sentence — and now that a
    // row DOES, the pairing is asserted in BOTH directions, because
    // `CONDITIONAL_DAMAGE_CLAUSES` is a `Map` and a stray duplicate key is silent.
    expect(deriveAttackDamageBonus(STRICTLY_MORE)).toEqual({
      per: 160,
      count: { kind: "boardCondition", cond: { kind: "moreActiveEnergyThanOpponent" } },
    });
    expect(deriveAttackDamageBonus(STRICTLY_MORE)?.count).not.toEqual({
      kind: "boardCondition",
      cond: EQUAL,
    });
    expect(deriveAttackDamageBonus(TAKEN_100)?.count).toEqual({
      kind: "boardCondition",
      cond: EQUAL,
    });
    // …and the two members disagree on a board, which is the whole reason they are
    // two. `moreEnergyBonus.test.ts` drives the pair properly; this is the one rung
    // that has to stay HERE, because it is this file's claim that went stale.
    const equalBoard = attachFromDeck(ready(9140), "p2", "fix-energy", 1);
    const aheadBoard = attachFromDeck(ready(9141), "p1", "fix-energy", 1);
    expect(conditionHolds(equalBoard, "p1", EQUAL)).toBe(true);
    expect(conditionHolds(equalBoard, "p1", { kind: "moreActiveEnergyThanOpponent" })).toBe(false);
    expect(conditionHolds(aheadBoard, "p1", EQUAL)).toBe(false);
    expect(conditionHolds(aheadBoard, "p1", { kind: "moreActiveEnergyThanOpponent" })).toBe(true);
  });

  it("the SUM over the same two bodies is a different mechanism and stays one", () => {
    // *"This attack does 30 more damage for each Energy attached to both Active
    // Pokémon."* reads the SAME two operands through the SAME counter and SUMS them
    // — 8 legal printings, resolved by a DIFFERENT reader, and it must not become
    // this member. One pair of operands, three questions (sum, equality, strict
    // inequality), and only the middle one is bought here.
    const sum = "This attack does 30 more damage for each Energy attached to both Active Pokémon.";
    expect(units(corpus().filter(([, s]) => s === sum))).toBe(8);
    expect(deriveAttackDamageBonus(sum)?.count).not.toEqual({
      kind: "boardCondition",
      cond: EQUAL,
    });
  });

  it("the U+2019 spelling folds, through the literal table's own retry", () => {
    // The clause key spells a possessive ("your opponent's"), so it is the fold's
    // population and not the pattern class's — this row is a LITERAL row and the
    // template pass never sees it. `literalClauseRow` retries a miss with U+2019
    // folded to U+0027, which is the mechanism under test.
    const curly = TAKEN_100.replace(/'/g, "’");
    expect(curly).not.toBe(TAKEN_100);
    expect(deriveAttackDamageBonus(curly)).toEqual(deriveAttackDamageBonus(TAKEN_100));
  });

  it("the note is prose for a person and does NOT round-trip to the printed bytes", () => {
    // D116's pronoun rule: the note names the body a reader can see on the board
    // rather than the one the card's own text points at. Stated as an assertion so a
    // successor does not "fix" the note into the row's key.
    expect(conditionNote(EQUAL)).toBe(
      "your Active Pokémon and your opponent's Active Pokémon have the same amount of Energy attached",
    );
    expect(conditionNote(EQUAL)).not.toBe(TAKEN_CLAUSE);
    expect(deriveAttackDamageBonus(`If ${conditionNote(EQUAL)}, this attack does 100 more damage.`))
      .toBeNull();
  });
});

describe("§4 — the `needs` column RE-DERIVED: no existing member answers this", () => {
  it("🛑 the two near members read the same FIELD and ask different questions", () => {
    // D199's rule, driven rather than listed, on ONE board: p1's Active holds a
    // basic and a `fix-blend` (2 cards), p2's Active holds one basic (1 card), and
    // p2 has a benched body holding one more.
    let state = attachFromDeck(ready(9110), "p1", "fix-blend", 1);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = attachOnBench(state, "p2", 0, "fix-energy", 1);
    expect(cardsAndUnits(state, "p1")[0]).toBe(2);
    expect(cardsAndUnits(state, "p2")[0]).toBe(1);
    // The member: 2 ≠ 1 over the two ACTIVE bodies.
    expect(conditionHolds(state, "p1", EQUAL)).toBe(false);
    // `yourActiveHasEnergyAttached` reads the same FIELD on the same BODY and asks a
    // PRESENCE question rather than a comparison — and it answers differently for
    // the two seats on this board, so it cannot stand in for an equality in either
    // direction.
    const special: BoardCondition = { kind: "yourActiveHasEnergyAttached", energy: "special" };
    expect(conditionHolds(state, "p1", special)).toBe(true);
    expect(conditionHolds(state, "p2", special)).toBe(false);
    // `yourEnergyInPlayAtLeast` reads the same field on the whole SIDE and asks a
    // THRESHOLD. Its zone is the one §5 separates on a board, and its comparison is
    // a floor rather than an equality: p2's SIDE holds 2 Energy where p2's ACTIVE
    // holds 1.
    expect(conditionHolds(state, "p2", { kind: "yourEnergyInPlayAtLeast", energy: "Fire", count: 1 }))
      .toBe(false);
    expect(conditionHolds(state, "p1", { kind: "yourEnergyInPlayAtLeast", energy: "Fire", count: 1 }))
      .toBe(true);
    // `handSizesEqual` is the same COMPARISON on a different field, and it is the
    // member whose doc block this slice had to correct. It answers about hands and
    // says nothing about this board's Energy — asserted against the live hands so
    // the rung cannot pass by coincidence.
    expect(conditionHolds(state, "p1", { kind: "handSizesEqual" })).toBe(
      state.players.p1.hand.length === state.players.p2.hand.length,
    );
  });
});

describe("§5 — the boards", () => {
  it("EQUAL at one and one — the printed +100", () => {
    const state = attachFromDeck(ready(9120), "p2", "fix-energy", 1);
    expect(conditionHolds(state, "p1", EQUAL)).toBe(true);
    expect(damageDealt(state)).toBe(110);
  });

  it("the OTHER printed sentence, on its own body, at +120", () => {
    const state = attachFromDeck(ready(9121, "p1", "fix-sameenergy-120"), "p2", "fix-energy", 1);
    expect(damageDealt(state)).toBe(130);
  });

  it("EQUAL is an EQUALITY and not a number: 3 and 3 arm it exactly as 1 and 1 do", () => {
    let state = attachFromDeck(ready(9122), "p1", "fix-energy", 2);
    state = attachFromDeck(state, "p2", "fix-energy", 3);
    expect(cardsAndUnits(state, "p1")[0]).toBe(3);
    expect(cardsAndUnits(state, "p2")[0]).toBe(3);
    expect(damageDealt(state)).toBe(110);
  });

  it("ZERO and ZERO is equal — the boundary a `> 0` guard would drop", () => {
    // Read directly rather than through an attack: the attacker cannot declare
    // without paying its `{C}`, so this board is reachable only before the cost is
    // on. The clause is about a COUNT and 0 = 0 is as true as 3 = 3.
    const state = unpaid(9123);
    expect(cardsAndUnits(state, "p1")).toEqual([0, 0]);
    expect(cardsAndUnits(state, "p2")).toEqual([0, 0]);
    expect(conditionHolds(state, "p1", EQUAL)).toBe(true);
  });

  it("the attacker holding FEWER is false", () => {
    const state = attachFromDeck(ready(9124), "p2", "fix-energy", 2);
    expect(conditionHolds(state, "p1", EQUAL)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("🛑 the attacker holding MORE is false too — the board a `>=` or `>` reading passes", () => {
    // The mutant this rung exists for: `===` → `>=` is one keystroke, and the pool
    // PRINTS the strict-inequality sentence one row over (§3), so the wrong operator
    // is a real card's question rather than an invented one. Both boards are needed:
    // the equal one above kills `>`, this one kills `>=` and `>`.
    let state = attachFromDeck(ready(9125), "p1", "fix-energy", 1);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    expect(cardsAndUnits(state, "p1")[0]).toBe(2);
    expect(cardsAndUnits(state, "p2")[0]).toBe(1);
    expect(conditionHolds(state, "p1", EQUAL)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("🛑 THE ZONE IS THE BODY: benched Energy is invisible, in both directions", () => {
    // `countEnergyInPlay(state, seat, null)` is one identifier away in
    // `interpreter.ts`'s own import block and answers Active PLUS Bench. Two boards,
    // because a single one is passed by any member that ignores the Bench for the
    // wrong reason (or by accident).
    //
    // (a) the two Actives AGREE and the two SIDES do not: benched Energy on p2 only.
    let equalActives = attachFromDeck(ready(9126), "p2", "fix-energy", 1);
    equalActives = benchFromDeck(equalActives, "p2", "fix-basic-1");
    equalActives = attachOnBench(equalActives, "p2", 0, "fix-energy", 2);
    expect(conditionHolds(equalActives, "p1", EQUAL)).toBe(true);
    expect(damageDealt(equalActives)).toBe(110);

    // (b) the two Actives DISAGREE and the two SIDES agree: p1's Active is one short
    // and p1's Bench makes the SIDE total level, so a seat-wide reading flips TRUE
    // exactly where the body reading is FALSE.
    let unequalActives = attachFromDeck(ready(9127), "p2", "fix-energy", 1);
    unequalActives = benchFromDeck(unequalActives, "p1", "fix-basic-1");
    unequalActives = attachOnBench(unequalActives, "p1", 0, "fix-energy", 1);
    unequalActives = attachFromDeck(unequalActives, "p2", "fix-energy", 1);
    expect(cardsAndUnits(unequalActives, "p1")[0]).toBe(1);
    expect(cardsAndUnits(unequalActives, "p2")[0]).toBe(2);
    expect(conditionHolds(unequalActives, "p1", EQUAL)).toBe(false);
    expect(damageDealt(unequalActives)).toBe(10);
  });

  it("🛑 an EMPTY Active Spot is FALSE on either side, and ZERO is why it has to be driven", () => {
    // The deliberate asymmetry: an absent Pokémon is not a Pokémon holding zero
    // Energy. **THE BOARD THAT SEPARATES THEM IS THE ZERO-ENERGY ONE**, and only
    // that one: on a board where the attacker holds a card, "empty" and "zero" both
    // answer FALSE and a `?? 0` reading is invisible. Here the attacker holds
    // nothing, so a member that read a missing Active as 0 would answer TRUE — the
    // silent arming this guard exists to refuse.
    const zero = unpaid(9128);
    expect(cardsAndUnits(zero, "p1")).toEqual([0, 0]);
    expect(conditionHolds(zero, "p1", EQUAL)).toBe(true);
    expect(conditionHolds(emptyActive(zero, "p2"), "p1", EQUAL)).toBe(false);
    expect(conditionHolds(emptyActive(zero, "p1"), "p1", EQUAL)).toBe(false);
    // …and the both-empty board, where a zero-reading member is most obviously
    // wrong: no Pokémon on either side and nothing for an equality to be about.
    expect(conditionHolds(emptyActive(emptyActive(zero, "p1"), "p2"), "p1", EQUAL)).toBe(false);
    // The same commitment on a board where the attacker HAS Energy, so the null
    // guard is shown to be positive on both sides rather than only on the one the
    // zero board exercises.
    const paid = ready(9129);
    expect(conditionHolds(emptyActive(paid, "p2"), "p1", EQUAL)).toBe(false);
    expect(conditionHolds(emptyActive(paid, "p1"), "p1", EQUAL)).toBe(false);
  });
});

describe("§6 — SEAT SYMMETRY: which KIND, and the comment it falsified", () => {
  it("🛑 the VALUE commutes on every board, while the SPELLING does not", () => {
    // `handSizesEqual` has been documented since D119 as "the ONE member of this
    // whole vocabulary that is SEAT-SYMMETRIC". This is the second, and it is the
    // first where the two senses of the word come apart:
    //
    //   • the printed SENTENCE is asymmetric — "this Pokémon" on one side (D116's
    //     pronoun, resolved to the attacker's Active by the clause table) and the
    //     full noun phrase on the other;
    //   • the TRUTH VALUE is symmetric, because equality commutes over the two
    //     Active bodies.
    //
    // Both readings are driven, on an equal board and on an unequal one.
    const equal = attachFromDeck(ready(9130), "p2", "fix-energy", 1);
    const uneven = attachFromDeck(ready(9131), "p2", "fix-energy", 3);
    for (const seat of ["p1", "p2"] as const) {
      expect(conditionHolds(equal, seat, EQUAL)).toBe(true);
      expect(conditionHolds(uneven, seat, EQUAL)).toBe(false);
    }
    // …and the SPELLING half: the printed clause names the two sides differently, so
    // "symmetric" was a claim about the value and had to be said which.
    expect(TAKEN_CLAUSE.includes("this Pokémon")).toBe(true);
    expect(TAKEN_CLAUSE.includes("your opponent's Active Pokémon")).toBe(true);
  });

  it("and it holds through a real attack from the FAR seat", () => {
    // A p1-only suite cannot tell "reads the two Actives" apart from "reads p1's and
    // p2's" — the seat check every member in this family owes.
    const state = attachFromDeck(ready(9132, "p2"), "p1", "fix-energy", 1);
    expect(damageDealt(state, "p2")).toBe(110);
  });
});

describe("§7 — the census moves in exactly ONE summand, and the step is 2 and 2", () => {
  it("the resolving corpus gains TWO sentences and TWO printings", () => {
    const resolved = corpus().filter(([, s]) => resolvedByAnyReader(s));
    expect(resolved).toHaveLength(382); // 🆕🆕 D400 +2 sentences / +9 printings (THE ANY-TARGET ARITY — `CHOSEN_ANY_TARGET`'s hard-coded `1 of` captured and the W/R tail's number word required to AGREE with it; a READER-keyed move, so no registry summand moves) // 🆕🆕 D399 +3 sentences / +5 printings (THE TWIN CONSEQUENT AND THE ARITY — Wo-Chien `sv08-015` "Hazardous Greed" behind a `conditionGate`, plus the FOUR printings the flat rider was refusing on the literal count `1`; a READER-keyed move, so no registry summand moves) // 🆕🆕 D398 +1 sentence / +1 printing (THE DECK-SIZE READ — Rabsca `sv08-014` "Counterturn" ({G}, `40+`, **+200**, index **1** of TWO) at 1 legal printing, taken by ONE new `BoardCondition` member (`yourDeckAtMost { count }`), TWO exhaustive-switch arms and ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row — a READER-keyed move, so `REGISTRY_ATTACK_UNITS` and `splitHead` BOTH stand still) // 🆕🆕 D397 +1 sentence / +1 printing (THE BENCHED-CUBONE FILTER — Marowak `sv07-073` "Bone Vengeance" ({C}{C}, `60+`, **+120**, index **1** of TWO) at 1 legal printing, taken by ONE new `BoardCondition` member (`yourBenchNamedDamaged { name }`), TWO exhaustive-switch arms and ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row — a READER-keyed move, so `REGISTRY_ATTACK_UNITS` and `splitHead` BOTH stand still) // 🆕🆕 D394 +2 sentences / +2 printings (THE USED-ATTACK PAIR — Falinks `sv07-088` "All-Out Attack" ({C}{C}, `30+`, **+90**, index 1 of TWO) and Weezing `sv09-092` "Crazy Blast" ({D}{C}, `50+`, **+120**, index 1 of TWO), 1 legal printing each: ONE new `BoardCondition` member (`yourActiveUsedAttackLastTurn { attack }`), ONE new REQUIRED `InPlayPokemon` field (`usedAttack`), ONE new REQUIRED field on `PendingStage.attackEpilogue`, TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and TWO new exhaustive-switch arms — the residue's LAST pair on one mechanism, the first window in the union that is not the turn in progress, and the third entry on this line to move `MATCH_RECORD_VERSION`, 24 -> 25) // 🆕🆕 D393 +2 sentences / +2 printings (THE EVOLVE PAIR — Gholdengo `sv08-131` "Strike It Rich" ({M}, `30+`, **+90**, index 0 of TWO) and Misty's Starmie `sv10-047` "Abrupt Flash" ({W}, `60+`, **+80**, index 0 of ONE), 1 legal printing each: ONE new `BoardCondition` member (`yourActiveEvolvedFromThisTurn { name }`), ONE new REQUIRED `InPlayPokemon` field (`evolvedTurn`), TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and TWO new exhaustive-switch arms — the residue's only PAIR on one mechanism, and the second entry on this line to move `MATCH_RECORD_VERSION`, 23 -> 24) // 🆕🆕 D392 +1 sentence (THE SUBSTRING NAME READ — Team Rocket's Nidoqueen `sv10-116` "Love Impact" ({D}, `60+`, **+120**, index 0 of TWO) at 1 legal printing: ONE new `BoardCondition` member (`yourBenchHasNameContaining { fragment }`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO NEW exhaustive-switch arms — a SECOND MEMBER and not a `match?:` field on `yourBenchHasNamed`, and it is the FIRST test of the rule D391 wrote down, which HELD: what changes is the comparison OPERATOR rather than a filter the delegate already takes, `conditionNote` needs a second SENTENCE rather than a second SLOT, and a member edits ZERO of `yourBenchHasNamed`'s 45 executable sites where an optional field edits THREE) // 🆕🆕 D391 +1 sentence (THE TYPED PER-BODY ENERGY THRESHOLD — Abomasnow `sv10-060` "Frozen Wood" ({W}{W}{W}{C}, `120+`, **+120**, index 1 of TWO) at 1 legal printing: ONE **OPTIONAL FIELD** (`energy?`) on the shipped `yourActiveEnergyAtLeast` member (D383), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO **edited** exhaustive-switch arms — a FIELD and NOT a second member, the OPPOSITE of D389's answer and RE-MEASURED rather than inherited: the field is OPTIONAL and edits ZERO of that member's 11 executable sites, and `countAttachedEnergy` already took exactly this filter) // 🆕🆕 D390 +1 sentence (THE OPPONENT-SEAT TYPE READ — Electivire `sv05-054` "Short-Circuit Knuckle" ({C}{C}, `40+`, **+120**) at 1 legal printing: ONE PARAMETERISED `BoardCondition` member (`opponentInPlayHasType { type }`), ONE anchored TEMPLATE reusing `CLAUSE_POKEMON_TYPES` whole and TWO exhaustive-switch arms — the family's FIFTH template pattern, and the first shipped behind a CROSS-PRODUCT anchor rung written at the PREVIOUS head) // 🆕🆕 D389 +1 sentence (THE OPPONENT-SEAT BENCH COUNT — Iron Crown `sv08-132` "Deleting Slash" ({M}{C}, `40+`, **+80**) at 1 legal printing: ONE PARAMETERISED `BoardCondition` member (`opponentBenchAtLeast { count }`), ONE literal clause row and TWO exhaustive-switch arms — a SECOND MEMBER and not a seat parameter on `yourBenchAtLeast`) // 🆕🆕 D388 +1 sentence (THE RETREAT-COST THRESHOLD — Talonflame `sv07-123` "Aero Chase" ({C}{C}, `110+`, **+110**) at 1 legal printing: ONE PARAMETERISED `BoardCondition` member (`opponentActiveRetreatCostAtLeast { count }`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO exhaustive-switch arms — ZERO new card predicates, because the printed noun phrase names `effectiveRetreatCost` (continuous.ts, D322) and not the printed `retreatCostOf` column, which is the SHAPE question D387 left open and this slice settled) // 🆕🆕 D387 +1 sentence (THE STAGE 1 CLAUSE — Paldean Tauros `sv08-018` "Spirited Tackle" ({R}{C}{C}, `90+`, **+90**) at 1 legal printing: ONE `cards.ts` predicate (`isStage1Pokemon`), ONE `BoardCondition` member (`opponentActiveIsStage1`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO exhaustive-switch arms — a SUBSET of `opponentActiveIsEvolution` that is NOT a narrowing of it, so that member and all NINE of its printings stand still) // 🆕🆕 D386 +1 sentence (THE HEALED-THIS-TURN CLAUSE — Maractus `sv10.5b-008`/`-093` "Lively Needles" ({G}, `20+`, **+100**) at 2 legal printings: ONE `BoardCondition` member (`yourActiveHealedThisTurn`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row, TWO exhaustive-switch arms and ONE new REQUIRED `InPlayPokemon` field (`healedTurn`) — the FIRST entry on this chain to move `MATCH_RECORD_VERSION`, 22 -> 23. ⚠️ AND THE FIRST IN FOUR SLICES THAT THIS NINE-READER INSTRUMENT CAN SEE AT ALL: D385's sentence resolved through the TENTH reader and left this figure standing) // 🆕🆕 D384 +1 sentence (THE STRICT-INEQUALITY TWIN — Swalot `sv07-092` "Devouring Mouth" ({D}, `10+`, **+160**) at 1 legal printing: ONE nullary `BoardCondition` member (`moreActiveEnergyThanOpponent`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO exhaustive-switch arms — the sentence D372 priced, refused and pinned as its own near miss) // 🆕🆕 D382 +1 sentence (THE `. Then, ` JOIN — D317's shape with the printed comma changed: Chi-Yu `sv06-039` "Ground Melter" ({R}{C}, `60+`) at 1 legal printing, ONE anchor constant and ONE consequent row on `deriveAttackBonusConsequent`, ZERO new readers and ZERO new ops) // 🆕🆕 D380 +2 sentences (THE STADIUM-DISCARD OP — `discardStadium`: *"Discard a Stadium in play."* at 4 legal printings and *"You may discard a Stadium in play."* at 2, ONE new FIELD-FREE `EffectOp` behind TWO whole-sentence anchors — the first slice in this run to buy an OP rather than a `BoardCondition`) // 🆕🆕 D379 +1 sentence (THE EXACT HAND-SIZE READ — `yourHandExactly { count }`: ONE CANCEL sentence at 2 legal printings, Alolan Dugtrio `sv08-123`/`sv08-208` "Trio-Cheehoo", and NO bonus twin) // 🆕🆕 D378 +2 sentences (STADIUM PRESENCE — `stadiumInPlay`: ONE bonus sentence at 1 legal printing, Probopass `sv10-098` "Mountain Drop" +70, PLUS one CANCEL sentence on the SAME member at 2 printings, Fan Rotom `sv07-118`/`sv08.5-085` "Assault Landing" — ONE new NULLARY `BoardCondition` member, ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and ONE `ATTACK_REQUIREMENT_CLAUSES` row) // 🆕🆕 D377 **+3 SENTENCES / +3 PRINTINGS** (the CROSS-BOARD STATUS PAIR — TWO bonus sentences at 1 legal printing each, *"…is Burned"* +40 and *"…is Confused"* +90, PLUS one CANCEL sentence on the SAME member, *"…isn't Burned"*; TWO new NULLARY `BoardCondition` members, TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and ONE `ATTACK_REQUIREMENT_CLAUSES` row) // 🆕🆕 D376 +1 sentence (the FILTERED DISCARD-PILE THRESHOLD) // 🆕🆕 D375 +1 sentence (the CROSS-BOARD TYPE INTERSECTION) // 🆕🆕 D374 +1 sentence (the NAMED-ENERGY clause) // 🆕🆕 D373 +1 sentence (the UNIVERSAL-OVER-THE-BENCH clause) // 🆕🆕 D372 +2 sentences (ONE clause, two amounts) // 🆕🆕 D371 +1 // 🆕🆕 D370 +1 // 🆕🆕 D369 +1 // 🆕🆕 D368 +1
    expect(units(resolved)).toBe(1283); // 🆕🆕 D400 +9 printings (THE ANY-TARGET ARITY) // 🆕🆕 D399 +5 printings (THE TWIN CONSEQUENT AND THE ARITY) // 🆕🆕 D398 +1 printing (THE DECK-SIZE READ) // 🆕🆕 D397 +1 printing (THE BENCHED-CUBONE FILTER — Marowak `sv07-073` "Bone Vengeance" ({C}{C}, `60+`, **+120**, index **1** of TWO) at 1 legal printing, READER-keyed) // 🆕🆕 D394 +2 sentences / +2 printings (THE USED-ATTACK PAIR — Falinks `sv07-088` "All-Out Attack" ({C}{C}, `30+`, **+90**, index 1 of TWO) and Weezing `sv09-092` "Crazy Blast" ({D}{C}, `50+`, **+120**, index 1 of TWO), 1 legal printing each: ONE new `BoardCondition` member (`yourActiveUsedAttackLastTurn { attack }`), ONE new REQUIRED `InPlayPokemon` field (`usedAttack`), ONE new REQUIRED field on `PendingStage.attackEpilogue`, TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and TWO new exhaustive-switch arms — the residue's LAST pair on one mechanism, the first window in the union that is not the turn in progress, and the third entry on this line to move `MATCH_RECORD_VERSION`, 24 -> 25) // 🆕🆕 D393 +2 printings (THE EVOLVE PAIR — Gholdengo `sv08-131` and Misty's Starmie `sv10-047`, one printing each, both READER-keyed) // 🆕🆕 D392 +1 printing (THE SUBSTRING NAME READ — one sentence, one printing: the 1:1 shape for a seventh slice running, and the first taken by a member whose payload field is deliberately NOT named `name`) // 🆕🆕 D391 +1 printing (THE TYPED PER-BODY ENERGY THRESHOLD — Abomasnow `sv10-060` "Frozen Wood" at 1 legal printing: an OPTIONAL FIELD on a shipped `BoardCondition` member, so the READER-keyed summand moves and no registry summand does) // 🆕🆕 D390 +1 printing (THE OPPONENT-SEAT TYPE READ — one sentence, one printing: the 1:1 shape for the fourth slice running) // 🆕🆕 D389 +1 printing (THE OPPONENT-SEAT BENCH COUNT — one sentence, one printing: the 1:1 shape for the third slice running) // 🆕🆕 D388 +1 printing (THE RETREAT-COST THRESHOLD — one sentence, one printing: the 1:1 shape, and the fold is the reading the engine had already given this noun phrase since 0.61.0) // 🆕🆕 D387 +1 printing (THE STAGE 1 CLAUSE — one sentence, one legal printing; the family's third 1:1 step) // 🆕🆕 D386 +2 printings (THE HEALED-THIS-TURN CLAUSE — one sentence, two legal printings, a 1:2 step) // 🆕🆕 D384 +1 printing (THE STRICT-INEQUALITY TWIN — one sentence, one legal printing; the family's FIRST 1:1 step) // 🆕🆕 D382 +1 printing (THE `. Then, ` JOIN — one sentence, one legal printing) // 🆕🆕 D380 +6 printings (THE STADIUM-DISCARD OP — TWO sentences, 4 + 2 legal printings, on ONE new FIELD-FREE `EffectOp`) // 🆕🆕 D379 +2 printings (THE EXACT HAND-SIZE READ — one sentence, both printings under the CANCEL consequent) // 🆕🆕 D378 +3 printings (STADIUM PRESENCE — `stadiumInPlay`: ONE bonus sentence at 1 legal printing, Probopass `sv10-098` "Mountain Drop" +70, PLUS one CANCEL sentence on the SAME member at 2 printings, Fan Rotom `sv07-118`/`sv08.5-085` "Assault Landing" — ONE new NULLARY `BoardCondition` member, ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and ONE `ATTACK_REQUIREMENT_CLAUSES` row) // 🆕🆕 D377 +3 // 🆕🆕 D376 +2 printings // 🆕🆕 D375 +2 printings // 🆕🆕 D374 +2 printings // 🆕🆕 D373 +2 printings // 🆕🆕 D372 +2 printings // 🆕🆕 D371 +2 // 🆕🆕 D370 +2 // 🆕🆕 D369 +2 // 🆕🆕 D368 +3
    // The FOUR slices before this one each moved the sentence term by exactly 1;
    // this one moves it by 2 while moving the printing term by the same 2 as three
    // of them. Re-derived from the live head both ways rather than quoted.
    // 🆕🆕 D373 — one more term on each: this slice's step is 1 sentence / 2 printings.
    // 🆕🆕 D374 — and one more again, the NAMED-ENERGY clause, also 1 sentence /
    // 2 printings.
    // 🆕🆕 D375 — and one more again, the TYPE INTERSECTION, also 1 sentence /
    // 2 printings.
    // 🆕🆕 D376 — a FIFTH subtrahend on each line, and a 1 / 2 step again (the FILTERED
    // DISCARD-PILE THRESHOLD).
    // 🆕🆕 D377 — a `- 3` term: the CROSS-BOARD STATUS PAIR resolved THREE sentences at once.
    // 🆕🆕 D378 — a `- 2` / `- 3` pair: STADIUM PRESENCE resolved TWO sentences worth THREE
    // printings, so the two lines take DIFFERENT subtrahends — one clause under two
    // consequents is two sentences and three printings, not a 1:1 step.
    // 🆕🆕 D379 — back to a `- 1` / `- 2` pair: the EXACT HAND-SIZE READ resolved ONE
    // sentence worth TWO printings, and it is the first in this chain to arrive
    // entirely under the CANCEL consequent with no bonus row beside it.
    // 🆕🆕 D380 — a `- 2` / `- 6` pair, the WIDEST ratio this chain has taken: the
    // STADIUM-DISCARD OP resolved TWO sentences worth SIX printings. It is also the
    // first term here bought by an `EffectOp` rather than by a `BoardCondition`,
    // which this rung cannot tell apart — a census asks whether a reader answered,
    // never what it answered with.
    // 🆕🆕 D382 — a `- 1` / `- 1` pair at the FRONT of both chains: the `. Then, `
    // JOIN resolved ONE sentence worth ONE printing, on ZERO new readers and ZERO
    // new ops — the narrowest ratio this chain has taken, and the mirror of D380's
    // widest. ⚠️ **BOTH CHAINS ARE EDITED AT THE FRONT, NEVER AT THE END.**
    // 🆕🆕 D384 — a `- 1` / `- 1` pair at the FRONT of both chains again: the
    // STRICT-INEQUALITY TWIN resolved ONE sentence worth ONE printing, the family's
    // first 1:1 step through THIS instrument as well. ⚠️ **BOTH CHAINS ARE EDITED AT
    // THE FRONT, NEVER AT THE END.**
    // 🆕🆕 D386 — a `- 1` / `- 2` pair at the FRONT of both chains: the HEALED-THIS-TURN
    // clause resolved ONE sentence worth TWO printings, so the two chains take
    // DIFFERENT leading subtrahends again. ⚠️ **BOTH CHAINS ARE EDITED AT THE FRONT,
    // NEVER AT THE END.**
    // 🆕🆕 D387 — a `- 1` / `- 1` pair at the FRONT of both chains: the STAGE 1 CLAUSE
    // resolved ONE sentence worth ONE printing. ⚠️ **BOTH CHAINS ARE EDITED AT THE
    // FRONT, NEVER AT THE END.**
    // 🆕🆕 D388 — a `- 1` / `- 1` pair at the FRONT of both chains: the RETREAT-COST
    // THRESHOLD resolved ONE sentence worth ONE printing. ⚠️ **BOTH CHAINS ARE EDITED
    // AT THE FRONT, NEVER AT THE END.**
    // 🆕🆕 D389 — a `- 1` / `- 1` pair at the FRONT of both chains: the OPPONENT-SEAT
    // BENCH COUNT resolved ONE sentence worth ONE printing, the family's third
    // consecutive 1:1 step. ⚠️ **BOTH CHAINS ARE EDITED AT THE FRONT, NEVER AT THE END.**
    // 🆕🆕 D390 — a `- 1` / `- 1` pair at the FRONT of both chains: the OPPONENT-SEAT
    // TYPE READ resolved ONE sentence worth ONE printing, the family's fourth
    // consecutive 1:1 step. ⚠️ **BOTH CHAINS ARE EDITED AT THE FRONT, NEVER AT THE END.**
    // 🆕🆕 D392 — one more term at the FRONT of the chain: the SUBSTRING NAME READ
    // resolved ONE sentence worth ONE printing. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
    // 🆕🆕 D398 — one more term at the FRONT of both chains: the DECK-SIZE READ, 1 sentence /
    // 1 printing. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN `.toBe(N)` TAIL (D397).
    // 🆕🆕 D399 — a `- 3` / `- 5` pair at the FRONT of both chains: the TWIN CONSEQUENT
    // AND THE ARITY resolved THREE sentences worth FIVE printings, the widest ratio
    // this instrument has taken since D380. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE
    // FROZEN `.toBe(N)` TAIL (D397).
    expect(
      // 🆕🆕 D397 — one more term at the FRONT of the chain: the BENCHED-CUBONE FILTER, 1 sentence / 1 printing. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      resolved.length - 2 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 2 - 3 - 1 - 1 - 1 - 1 - 2 - 2,
    ).toBe(348);
    expect(
      units(resolved) - 9 - 5 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 2 - 1 - 1 - 2 - 3 - 3 - 2 - 2 - 2 - 2 - 2 - 6,
    ).toBe(1229);
  });

  it("🛑 the move is READER-keyed: no registry row and no gate clause", () => {
    // The two hand-carried summands `censusAtHead.test.ts` splits `BUILT.attack`
    // into stand still, and that is measured here rather than assumed: neither
    // printed sentence carries a "does nothing" head (so `splitAttackGateClause`
    // cannot see it) and this slice authors no registry row at all.
    for (const sentence of [TAKEN_100, TAKEN_120]) {
      expect(deriveAttackRequirement(sentence)).toBeNull();
      expect(sentence.includes("this attack does nothing")).toBe(false);
    }
  });
});
