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
import { countAttachedEnergy, providedEnergy } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  MORE_ENERGY_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 🆕🆕 D384 — THE STRICT-INEQUALITY TWIN, TWELVE SLICES AFTER ITS OWN SLICE NAMED IT.
//
// D372 built *"this Pokémon and your opponent's Active Pokémon have the same amount of
// Energy attached"* and, in the same commit, wrote its near miss into four files: the
// SAME two operands, the SAME field, the SAME `countAttachedEnergy` call, and `>` where
// that row spells `=`. It priced the twin at one nullary member and one literal row,
// refused to build it (*"building it would have made the `===` → `>` mutant green for
// the wrong reason"*) and pinned the refusal in `sameEnergyBonus.test.ts` §3 so the day
// a reader claimed the sentence would redden by name.
//
//   Swalot `sv07-092` "Devouring Mouth" ({D}, 10+, **+160**)
//     *"If this Pokémon has more Energy attached than your opponent's Active Pokémon,
//      this attack does 160 more damage."*
//     **1 legal printing**
//
// ✅ **THE PRICE WAS RIGHT TO THE LINE, AND THAT IS THE RESULT WORTH RECORDING** (§1).
// One nullary `BoardCondition` member, one literal `CONDITIONAL_DAMAGE_CLAUSES` row,
// two exhaustive-switch arms in `interpreter.ts`, one fixture and one deck. ZERO new
// readers, ops, events, prompts, registry rows or `packages/schema` bytes — so
// `MATCH_RECORD_VERSION` stays 22. D199's rule says a `needs` column overstates as
// easily as it understates; this one did neither, and it was re-derived item by item
// against the code before a line was written rather than inherited from the handoff.
//
// 🛑 **TWO NULLARY MEMBERS, NOT ONE PARAMETERISED MEMBER — AND THE OPERATOR IS THE
// WHOLE ARGUMENT** (§3). Folding this into `activeEnergyCountsEqual` needs a member
// carrying an operator union, which is a GENERALISATION that renames a shipped nullary
// member: D362 priced that at 31 sites across 7 files, D365/D366 refused it twice and
// D383 refused it one member over. A second nullary member is free. What the two DO
// share is the read — the same call on the same two bodies — so the CARDS-vs-UNITS
// answer D372 settled cannot drift between them.
//
// 🛑 **IT IS THE FIRST CROSS-BODY MEMBER THAT IS SEAT-ASYMMETRIC IN VALUE, AND THAT IS
// A NEW SHAPE FOR THIS SUITE** (§4). `handSizesEqual`, `activeEnergyCountsEqual` and
// `inPlayTypesIntersect` all commute — every one of them answers the same on a board
// read from either seat, so a seat-blind implementation would have passed. `>` does
// not commute, so ONE board yields TWO DIFFERENT answers, and the far-seat rung stops
// being a formality: it is the only thing that can tell this member from its own
// inverse. D380's rule, reached by a member instead of by a board.
//
// 🛑 **AND THE `?? 0` SLIP IS WORSE ON THIS OPERATOR THAN ON THE EQUALITY** (§5).
// Reading a missing defender as zero arms this clause for an attacker holding a SINGLE
// card (1 > 0); the equality member had to be fooled at exactly zero. So the board that
// separates "empty" from "zero" here is the ORDINARY paying board rather than the
// unreachable unpaid one — the defect got easier to hit and easier to catch at once.
//
// ⚠️ **A MUTANT WAS RETIRED BY THIS SLICE.** D372's C5 inserted a SECOND clause-table
// entry for this sentence mapping onto the EQUAL member. The table is a `Map` built
// from an entry array, so the LAST duplicate key wins — and this slice's genuine row
// sits after C5's insertion point, which would have turned that mutant into a silent
// false SURVIVOR instead of an ERROR. **A `find` THAT STILL MATCHES EXACTLY ONCE IS NOT
// PROOF THE MUTANT STILL MEANS ANYTHING**: the exactly-once rule catches code that
// MOVED, never a premise a later slice made false. C5 is retired and D384's own C4
// carries the identical defect at this head.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/** The TWELVE live readers, run as one.

    🛑🛑 **D418 — CORRECTED, WITH THE WRONG SENTENCE LEFT VISIBLE ABOVE ITS
    CORRECTION (D178).** This block read, verbatim:

    > *"The ten live readers, run as one — the same set `censusAtHead.test.ts` and
    > `torrentialPump.test.ts` use. This slice adds NO reader, so the set is
    > unchanged."*

    Three claims, and each fails differently. The COUNT said ten over a list of
    ELEVEN. The CITATION said `censusAtHead.test.ts` ran the same set; it ran
    TWELVE. ⚠️ **AND THE THIRD IS THE INSTRUCTIVE ONE — *"this slice adds NO reader,
    so the set is unchanged"* IS A VALID INFERENCE FROM A FALSE PREMISE.** It
    reasons about what THIS slice did, and the set had already moved underneath it:
    a list only goes stale through work done ELSEWHERE, so "I changed nothing" is
    the one warrant that can never establish it. The list missed
    `deriveAttackCancelRequirement` from **D417 (2026-08-24)**, and §6's figure below
    was 411 / 1,363 where the truth is 412 / 1,364. (🆕🆕 D420 then took it to
    415 / 1,368 through the RAW summand — see §6.)

    ⚠️ §6's figures now come from `resolvedByAnyReader` IMPORTED FROM
    `censusAttackCorpus.ts`, off the MODULE surface. This list is a DECLARED
    EXPECTATION diffed against the module by §6's first rung, and nothing else. */
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
  deriveAttackDiscardScaledBoost,
  // 🆕🆕 D418 — the TWELFTH (D417).
  // 🆕🆕 D428 — THE THIRTEENTH, the PRE-DAMAGE Tool discard. ⚠️ SPLICED BEFORE THE
  // LAST ENTRY RATHER THAN APPENDED, D419's rule: mutant `find` strings quote an
  // array's LAST entries plus its closing bracket, and appending moves that anchor
  // without a character of it changing.
  deriveAttackPreDamage,
  deriveAttackCancelRequirement,
];

/** THE SENTENCE THIS SLICE BUYS, byte-for-byte from the committed corpus, and the
    CLAUSE inside it that the table is keyed on. */
const TAKEN =
  "If this Pokémon has more Energy attached than your opponent's Active Pokémon, this attack does 160 more damage.";
const TAKEN_CLAUSE = "this Pokémon has more Energy attached than your opponent's Active Pokémon";

/** D372's sentence and member — the twin this one is separated from, kept here so the
    disjointness is driven on the real pair rather than asserted about it. */
const EQUAL_SENTENCE =
  "If this Pokémon and your opponent's Active Pokémon have the same amount of Energy attached, this attack does 100 more damage.";

const MORE: BoardCondition = { kind: "moreActiveEnergyThanOpponent" };
const EQUAL: BoardCondition = { kind: "activeEnergyCountsEqual" };

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: MORE_ENERGY_DECK, p2: MORE_ENERGY_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** The seat's opposite. Spelled once here rather than imported, because this member
    is seat-relative in VALUE and every board below has to name a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

/** `fix-moreenergy` in `seat`'s Active Spot with the `{C}` paid by ONE `fix-energy`
    — so the attacking body starts at exactly ONE attached CARD — `fix-energyholder`
    across the table holding NOTHING, and BOTH benches EMPTY. That opening board is
    already an ARMED one (1 > 0), which is the difference from D372's `ready`: an
    equality needs a matching count to pay, a strict inequality pays by default.
    `board` opens P1's turn, so a P2 case passes once more. */
function ready(seed: number, seat: Seat = "p1"): GameState {
  let state = board(seed);
  if (seat === "p2") state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = setActiveFromDeck(state, seat, "fix-moreenergy");
  state = attachFromDeck(state, seat, "fix-energy", 1);
  state = setActiveFromDeck(state, other(seat), "fix-energyholder");
  return clearBench(clearBench(state, seat), other(seat));
}

/** Attack index 0 from `seat` and report the damage actually dealt. */
function damageDealt(state: GameState, seat: Seat = "p1"): number {
  const after = mustApply(state, { type: "attack", seat, index: 0 });
  const dealt = after.events.find((e: GameEvent) => e.type === "DAMAGE_DEALT") as
    | { dealt?: number }
    | undefined;
  return dealt?.dealt ?? 0;
}

/** TEST SURGERY, local to this file: move `count` copies of `cardId` from the seat's
    deck onto bench[index]'s energy. `attachFromDeck` reaches the ACTIVE only, and the
    rung that separates "the two Active BODIES" from "the two SIDES" needs Energy
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
    readings of the printed noun, side by side, so a board that is supposed to separate
    them can be shown to. */
function cardsAndUnits(state: GameState, seat: Seat): readonly [number, number] {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active Pokémon`);
  return [countAttachedEnergy(state, active, null), providedEnergy(state, active).length];
}

describe("§1 — the price, RE-DERIVED, and BOTH consequents asked", () => {
  it("🛑 ONE sentence, ONE printing — and the clause is the whole population", () => {
    // Asserted as records AND as units, because those are the two columns the census
    // rungs are keyed on, and this is the family's first 1:1 step (D368 moved the
    // printing term by 3, D369-D376 by 2 each, D377 by 3, D380 by 6).
    const records = corpus().filter(([, s]) => s === TAKEN);
    expect(records).toHaveLength(1);
    expect(units(records)).toBe(1);
    // …and the CLAUSE is the whole population: no second sentence in the corpus
    // carries it under any amount, so the row cannot be short and cannot rot on a
    // reprint at a new number.
    const clauseRows = corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === TAKEN_CLAUSE);
    expect(clauseRows).toHaveLength(1);
    expect(units(clauseRows)).toBe(1);
    // ⚠️ THE ID BEHIND IT IS A WEB MEASUREMENT AND NOT A CATALOG ONE: this container
    // has no D1 credentials and the committed corpus carries sentences with counts and
    // no ids. limitlesstcg's tokenised text search offered Swalot (SCR 92) as the only
    // Standard-era candidate and `https://api.tcgdex.net/v2/en/cards/sv07-092` then
    // returned the name, the {D} cost, the `10+` base and this effect text
    // byte-for-byte at index 0 of two. Nothing on this path NEEDS the id — a literal
    // row is keyed on the printed clause and serves every printing in every set — so it
    // is recorded as provenance and asserted against nothing.
  });

  it("🛑 BOTH consequents were asked, and the CANCEL side is EMPTY", () => {
    // D379's rule, and the four slices before it (D363/D365/D377/D378) each put a
    // member in BOTH clause tables while D379 found one the CANCEL consequent alone
    // justified. So the sweep is over the OPERAND rather than over this sentence: every
    // corpus row mentioning Energy counted "than" another body, under any consequent.
    const family = corpus().filter(([, s]) => s.includes("Energy attached than"));
    expect(family).toHaveLength(1);
    expect(family[0]?.[1]).toBe(TAKEN);
    // …so there is no "…this attack does nothing." twin and no `ATTACK_REQUIREMENT_CLAUSES`
    // row is owed. Measured, not assumed — and the negative is spelled out so a
    // successor does not re-run the sweep to find out it was already run.
    expect(corpus().filter(([, s]) => s.includes("Energy attached than") && s.includes("this attack does nothing"))).toHaveLength(0);
  });

  it("🛑 the bonus residue steps by exactly ONE sentence and ONE printing", () => {
    // Re-derived off the same instrument the family has used since D368 — the live
    // readers over `legalAttackCorpus()` — rather than decremented from prose. The
    // DEPARTURE and the SIZE are asserted separately: a guard that only checked the
    // totals could not tell "the row landed" from "a reader broke".
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
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
    // …and the step is 1 and 1, the NARROWEST this chain has taken. Written as an
    // offset off the live head, which is what makes it re-derive rather than freeze.
    // 🆕🆕 D392 — the OFFSET gains one on each axis: the head moved, this one's did not.
    expect([refused.length + 16, units(refused) + 20]).toEqual([21, 25]);
  });

  it("🛑 D207's SUPPLY question does not ARISE, and that is a result rather than a skip", () => {
    // The member reads `InPlayPokemon.energy`: a GAME-STATE array the engine writes
    // itself on every attach the rules allow. There is no catalog column to be empty,
    // so the permanently-empty-candidate-set failure is unreachable by construction
    // rather than merely unobserved — and it is driven, on a board built by legal
    // setup plus this file's surgery.
    const state = attachFromDeck(ready(9200), "p2", "fix-energy", 2);
    expect(cardsAndUnits(state, "p1")[0]).toBe(1);
    expect(cardsAndUnits(state, "p2")[0]).toBe(2);
  });
});

describe("§2 — CARDS, not UNITS — and under `>` the wrong reading INVERTS", () => {
  it("🛑 one Special against one basic: 1 = 1 by CARD (false) and 2 > 1 by UNIT (true)", () => {
    // D372 settled the noun by FINDING the engine's answer rather than choosing one:
    // `countAttachedEnergy(…, null)` is the unfiltered CARD count, and *"one Energy
    // card is one Energy however many units it provides"* is its own doc block's
    // sentence. This member delegates to the identical call, so the two cannot drift.
    //
    // ⚠️ AND THE BOARD IS SHARPER HERE THAN IT WAS THERE. Under `===` a unit reading
    // merely disagreed; under `>` it answers the OPPOSITE on this board, so the wrong
    // noun is not a near miss but an inversion.
    let state = ready(9201);
    state = attachFromDeck(state, "p1", "fix-blend", 1); // p1 Active: 2 cards, 3 units
    expect(cardsAndUnits(state, "p1")).toEqual([2, 3]);
    expect(cardsAndUnits(state, "p2")).toEqual([0, 0]);
    // The narrow board: strip the attacker back to the Special alone against one basic.
    let level = ready(9202);
    level = attachFromDeck(level, "p2", "fix-blend", 1); // p2 Active: 1 card, 2 units
    expect(cardsAndUnits(level, "p1")).toEqual([1, 1]);
    expect(cardsAndUnits(level, "p2")).toEqual([1, 2]);
    // CARDS say 1 > 1 is FALSE; UNITS say 1 > 2 is FALSE too, so this board alone
    // proves nothing. It is the SEAT SWAP that separates them: from p2, CARDS say
    // 1 > 1 FALSE and UNITS say 2 > 1 TRUE.
    expect(conditionHolds(level, "p2", MORE)).toBe(false);
    expect(conditionHolds(level, "p1", MORE)).toBe(false);
    // …and the equality member answers TRUE on the same board, which is the pair's
    // disjointness driven rather than argued.
    expect(conditionHolds(level, "p1", EQUAL)).toBe(true);
    expect(conditionHolds(level, "p2", EQUAL)).toBe(true);
  });

  it("🛑 …and the other direction, which is the attribution control", () => {
    // Two basics against one Special: 2 > 1 by CARD (TRUE) and 2 > 2 by UNIT (FALSE),
    // so a unit reading answers FALSE exactly where the card reading answers TRUE. The
    // board above alone would be satisfied by a member that answered FALSE on any
    // `fix-blend` board for any reason at all.
    let state = attachFromDeck(ready(9203), "p1", "fix-energy", 1); // p1: 2 cards, 2 units
    state = attachFromDeck(state, "p2", "fix-blend", 1); // p2: 1 card, 2 units
    expect(cardsAndUnits(state, "p1")).toEqual([2, 2]);
    expect(cardsAndUnits(state, "p2")).toEqual([1, 2]);
    expect(conditionHolds(state, "p1", MORE)).toBe(true);
    expect(damageDealt(state)).toBe(170);
  });
});

describe("§3 — the round trip, and the TWIN it must not become", () => {
  it("the printed sentence resolves to this member at the printed amount", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 160,
      count: { kind: "boardCondition", cond: MORE },
    });
    // The amount lives in the skeleton's capture, so a reprint at a third number
    // resolves off the same row the day one is printed.
    expect(deriveAttackDamageBonus(TAKEN.replace("160", "40"))).toEqual({
      per: 40,
      count: { kind: "boardCondition", cond: MORE },
    });
  });

  it("🛑 the EQUAL twin still resolves to the OTHER member — neither row claims the other", () => {
    // The failure this rung exists for is the one D372's C5 mutant spelled: a row that
    // maps this sentence onto the equality member. It compiles, it looks like one more
    // legal printing for free, and it is wrong on every board where the attacker leads.
    // ⚠️ **THE TABLE IS A `Map` AND THE LAST DUPLICATE KEY WINS**, so a stray second row
    // for either sentence is silent unless something asserts the pairing in both
    // directions. Both directions are asserted here.
    expect(deriveAttackDamageBonus(TAKEN)?.count).toEqual({ kind: "boardCondition", cond: MORE });
    expect(deriveAttackDamageBonus(EQUAL_SENTENCE)?.count).toEqual({
      kind: "boardCondition",
      cond: EQUAL,
    });
    expect(deriveAttackDamageBonus(TAKEN)?.count).not.toEqual({
      kind: "boardCondition",
      cond: EQUAL,
    });
    // Keys are whole printed clauses and never substrings, so neither row can reach the
    // other's sentence by construction — driven rather than commented.
    expect(TAKEN_CLAUSE.includes("have the same amount of Energy attached")).toBe(false);
  });

  it("this sentence carries no CANCEL head, so the requirement reader refuses it", () => {
    expect(deriveAttackRequirement(TAKEN)).toBeNull();
    expect(TAKEN.includes("this attack does nothing")).toBe(false);
  });

  it("the U+2019 spelling folds, through the literal table's own retry", () => {
    // The clause key spells a possessive ("your opponent's"), so it is the fold's
    // population. `literalClauseRow` retries a miss with U+2019 folded to U+0027.
    const curly = TAKEN.replace(/'/g, "’");
    expect(curly).not.toBe(TAKEN);
    expect(deriveAttackDamageBonus(curly)).toEqual(deriveAttackDamageBonus(TAKEN));
  });

  it("the note is prose for a person and does NOT round-trip to the printed bytes", () => {
    // D116's pronoun rule: the note names the body a reader can see on the board rather
    // than the one the card's own text points at. Stated as an assertion so a successor
    // does not "fix" the note into the row's key.
    expect(conditionNote(MORE)).toBe(
      "your Active Pokémon has more Energy attached than your opponent's Active Pokémon",
    );
    expect(conditionNote(MORE)).not.toBe(TAKEN_CLAUSE);
    expect(deriveAttackDamageBonus(`If ${conditionNote(MORE)}, this attack does 160 more damage.`))
      .toBeNull();
    // …and it is not the twin's note either: the two differ in their VERB, which is the
    // one place a copy-paste of the neighbouring arm would go undetected.
    expect(conditionNote(MORE)).not.toBe(conditionNote(EQUAL));
  });
});

describe("§4 — SEAT ASYMMETRY: one board, two DIFFERENT answers", () => {
  it("🛑 the VALUE does NOT commute — the first member in this family where it does not", () => {
    // `handSizesEqual`, `activeEnergyCountsEqual` and `inPlayTypesIntersect` all
    // commute, so a seat-blind implementation of any of them passes a two-seat sweep.
    // `>` does not: on a board where p1 leads, this member is TRUE from p1 and FALSE
    // from p2, and those are two DIFFERENT answers rather than one re-derived twice.
    // **THIS IS THE RUNG THAT TELLS THE MEMBER FROM ITS OWN INVERSE**, and no board in
    // `sameEnergyBonus.test.ts` could have done it.
    const p1Leads = attachFromDeck(ready(9210), "p1", "fix-energy", 1);
    expect(cardsAndUnits(p1Leads, "p1")[0]).toBe(2);
    expect(cardsAndUnits(p1Leads, "p2")[0]).toBe(0);
    expect(conditionHolds(p1Leads, "p1", MORE)).toBe(true);
    expect(conditionHolds(p1Leads, "p2", MORE)).toBe(false);
    // …and the mirror board, so the asymmetry is shown to run both ways rather than
    // being a property of p1: p2's Active ahead makes p2 TRUE and p1 FALSE.
    const p2Leads = attachFromDeck(ready(9211), "p2", "fix-energy", 3);
    expect(cardsAndUnits(p2Leads, "p1")[0]).toBe(1);
    expect(cardsAndUnits(p2Leads, "p2")[0]).toBe(3);
    expect(conditionHolds(p2Leads, "p1", MORE)).toBe(false);
    expect(conditionHolds(p2Leads, "p2", MORE)).toBe(true);
    // The equality member is symmetric on both of those boards, which is the contrast
    // that makes the claim mean something.
    for (const seat of ["p1", "p2"] as const) {
      expect(conditionHolds(p1Leads, seat, EQUAL)).toBe(false);
      expect(conditionHolds(p2Leads, seat, EQUAL)).toBe(false);
    }
  });

  it("and it holds through a real attack from the FAR seat", () => {
    // A p1-only suite cannot tell "reads the attacker's Active against the defender's"
    // from "reads p1's against p2's" — the seat check every member in this family owes,
    // and the one that actually bites here.
    const state = ready(9212, "p2");
    expect(cardsAndUnits(state, "p2")[0]).toBe(1);
    expect(cardsAndUnits(state, "p1")[0]).toBe(0);
    expect(damageDealt(state, "p2")).toBe(170);
  });
});

describe("§5 — the boards", () => {
  it("ONE against ZERO is the paying board — the printed +160", () => {
    const state = ready(9220);
    expect(cardsAndUnits(state, "p1")[0]).toBe(1);
    expect(cardsAndUnits(state, "p2")[0]).toBe(0);
    expect(conditionHolds(state, "p1", MORE)).toBe(true);
    expect(damageDealt(state)).toBe(170);
  });

  it("🛑 EQUAL is FALSE — the board that kills `>=`, and the twin's TRUE board", () => {
    // "More than" is not "at least", and `>` → `>=` is one keystroke on an arm whose
    // neighbour four lines up genuinely spells `>=` (`yourActiveEnergyAtLeast`). The
    // equal board is the ONLY board that separates them, and it is exactly the board
    // `activeEnergyCountsEqual` pays on — so the two members are shown disjoint on the
    // one board where a confusion between them would be invisible.
    const state = attachFromDeck(ready(9221), "p2", "fix-energy", 1);
    expect(cardsAndUnits(state, "p1")[0]).toBe(1);
    expect(cardsAndUnits(state, "p2")[0]).toBe(1);
    expect(conditionHolds(state, "p1", MORE)).toBe(false);
    expect(conditionHolds(state, "p1", EQUAL)).toBe(true);
    expect(damageDealt(state)).toBe(10);
  });

  it("the attacker holding FEWER is false, and it is a COMPARISON rather than a number", () => {
    // 1 against 2 and 2 against 5: the member is not a threshold on either operand, so
    // a board with a bigger attacker count that is still behind must stay FALSE.
    const one = attachFromDeck(ready(9222), "p2", "fix-energy", 2);
    expect(conditionHolds(one, "p1", MORE)).toBe(false);
    expect(damageDealt(one)).toBe(10);
    let two = attachFromDeck(ready(9223), "p1", "fix-energy", 1);
    two = attachFromDeck(two, "p2", "fix-energy", 5);
    expect(cardsAndUnits(two, "p1")[0]).toBe(2);
    expect(cardsAndUnits(two, "p2")[0]).toBe(5);
    expect(conditionHolds(two, "p1", MORE)).toBe(false);
    expect(damageDealt(two)).toBe(10);
  });

  it("…and it is not a threshold on the ATTACKER either: 4 against 4 is still false", () => {
    // The mirror of the rung above. A member that read "the attacker holds at least N"
    // passes every board where the attacker leads AND this one, so the equal board has
    // to be driven at a count well above zero as well as at one.
    let state = attachFromDeck(ready(9224), "p1", "fix-energy", 3);
    state = attachFromDeck(state, "p2", "fix-energy", 4);
    expect(cardsAndUnits(state, "p1")[0]).toBe(4);
    expect(cardsAndUnits(state, "p2")[0]).toBe(4);
    expect(conditionHolds(state, "p1", MORE)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("🛑 THE ZONE IS THE BODY: benched Energy is invisible, in both directions", () => {
    // `countEnergyInPlay(state, seat, null)` is one identifier away in
    // `interpreter.ts`'s own import block and answers Active PLUS Bench. Two boards,
    // because a single one is passed by any member that ignores the Bench by accident.
    //
    // (a) the two Actives are LEVEL and p1's SIDE leads: a seat-wide reading answers
    // TRUE where the body reading answers FALSE.
    let level = attachFromDeck(ready(9225), "p2", "fix-energy", 1);
    level = benchFromDeck(level, "p1", "fix-basic-1");
    level = attachOnBench(level, "p1", 0, "fix-energy", 2);
    expect(cardsAndUnits(level, "p1")[0]).toBe(1);
    expect(cardsAndUnits(level, "p2")[0]).toBe(1);
    expect(conditionHolds(level, "p1", MORE)).toBe(false);
    expect(damageDealt(level)).toBe(10);

    // (b) p1's ACTIVE leads and p2's SIDE leads: the body reading answers TRUE exactly
    // where a seat-wide reading answers FALSE.
    let split = attachFromDeck(ready(9226), "p1", "fix-energy", 1);
    split = benchFromDeck(split, "p2", "fix-basic-1");
    split = attachOnBench(split, "p2", 0, "fix-energy", 5);
    expect(cardsAndUnits(split, "p1")[0]).toBe(2);
    expect(cardsAndUnits(split, "p2")[0]).toBe(0);
    expect(conditionHolds(split, "p1", MORE)).toBe(true);
    expect(damageDealt(split)).toBe(170);
  });

  it("🛑 an EMPTY Active Spot is FALSE on either side, and `?? 0` is what that refuses", () => {
    // An absent Pokémon is not a Pokémon holding zero Energy. ⚠️ **AND THE SLIP IS
    // WORSE ON THIS OPERATOR THAN ON THE EQUALITY**: reading a missing DEFENDER as 0
    // arms this clause for an attacker holding one card (1 > 0), where the equality
    // member had to be fooled at exactly zero. So the board that separates "empty" from
    // "zero" here is the ORDINARY paying board, not an unreachable unpaid one.
    const paid = ready(9227);
    expect(cardsAndUnits(paid, "p1")[0]).toBe(1);
    expect(conditionHolds(emptyActive(paid, "p2"), "p1", MORE)).toBe(false);
    expect(conditionHolds(emptyActive(paid, "p1"), "p1", MORE)).toBe(false);
    // …and the both-empty board, where a zero-reading member is most obviously wrong:
    // no Pokémon on either side and nothing for a comparison to be about.
    expect(conditionHolds(emptyActive(emptyActive(paid, "p1"), "p2"), "p1", MORE)).toBe(false);
    // The far seat too, because the null guard has two sides and this member's answer
    // is seat-dependent: from p2 the same boards must also be FALSE.
    expect(conditionHolds(emptyActive(paid, "p1"), "p2", MORE)).toBe(false);
    expect(conditionHolds(emptyActive(paid, "p2"), "p2", MORE)).toBe(false);
  });
});

describe("§6 — the census moves in exactly ONE summand, and the step is 1 and 1", () => {
  it("🆕🆕 D418 — the hand-kept READERS list IS the module's reader surface", () => {
    // 🛑 THE GUARD THIS FILE NEVER HAD, IN D417's SHAPE. The doc block on `READERS`
    // warranted itself with *"this slice adds NO reader, so the set is unchanged"* —
    // an inference about work done HERE, which is the one thing that can never
    // establish a list stays current, since staleness only ever arrives from
    // elsewhere. This rung asks the MODULE instead of asking the slice.
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    // ⚠️ THE COUNT IS PINNED SEPARATELY FROM THE DIFF: a diff alone stays GREEN when a
    // reader leaves the module and this list together, and §6 would move silently.
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("the resolving corpus gains ONE sentence and ONE printing", () => {
    const resolved = corpus().filter(([, s]) => resolvedByAnyReader(s));
    // 🆕🆕 D385 — 366 -> **367** / 1,262 -> **1,263**, THE SECOND CONNECTIVE (Veluza ex
    // `sv09-043` "Purging Strike", 1 legal printing). The head moved and the OFFSET
    // below is what this rung is about, so it is re-derived rather than frozen — the
    // rule D384 wrote into `exactHandSize.test.ts` one file over, paid here.
    // 🆕🆕 D386 — 367 -> **368** / 1,263 -> **1,265**, THE HEALED-THIS-TURN CLAUSE
    // (Maractus `sv10.5b-008`/`-093` "Lively Needles", 2 legal printings). A 1:2 step,
    // so the two subtrahends below diverge again — which is the whole reason this rung
    // is written as an offset off the live head rather than as a frozen pair.
    expect(resolved).toHaveLength(469); // 🆕🆕🆕 D448 +2 sentences (A COUNT SOURCE ON THE SNIPE'S OWN AMOUNT — *"This attack does {20|30} damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. (Don't apply …)"* (corpus lines 552 and 570), **2 sentences / 3 legal printings**, claimed WHOLE by `deriveAttackEffect`'s arm 6d through ONE widening of the SHIPPED anchor `CHOSEN_ANY_TARGET` — an optional count clause taking group 3, which SHIFTED `ignoreWR` to 4 and the number word to 5, D447's index trap — over ONE new OPTIONAL `damageChosen` field `perEnergyOnSelf`. **ZERO new anchors, ZERO new readers, ZERO new ops, ZERO new `DamageCountSource` members, ZERO new `CardFilter` members, prompt kinds, choice kinds, `route` values, events, error codes, `GameState` fields, registry rows, `packages/schema` bytes or `redact.ts` bytes.** `MATCH_RECORD_VERSION` **STAYS 29** — the op PARKS, so its literal really is persisted at `phase.cont.pendingOp`, but a NEW OPTIONAL KEY whose ABSENCE means what it always meant is D125's widening and not D359's rename; driven over the SERIALIZED BYTES in three directions in `scaledAnySnipe.test.ts` §3. 🛑 **THE WORK ORDER'S PREMISE FAILED AND IS CORRECTED IN PLACE (D442): the snipe's amount has scaled since Wo-Chien "Covetous Ivy".** `snipeAmount` (interpreter.ts) is a SECOND, PARALLEL fold — `scaledAttackDamage`'s §8.5 fold reaches the DEFENDING Active only, speaks `DamageCountSource`, lives in a module that imports the interpreter and needs a `cost` `EffectContext` does not carry — so this slice gives an EXISTING fold its second inhabitant rather than building one. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at **13** (the arm sits inside `deriveAttackEffect`), and `REGISTRY_ATTACKS` (16 units / 10 sentences), `SPLIT_ATTACK_UNITS` (13) and `COMPOUND_ATTACK_UNITS` (21) were RE-MEASURED UNMOVED after the widening rather than assumed, D424's rule. ⚠️ AND NO COMPOUND COMPOSES, MEASURED ON BOTH SIDES: each sentence's only `. ` joiner precedes the W/R parenthetical, which `deriveAttackEffect` does not claim on its own, so `splitAttackTrailingClause` refused both at its TAIL test BEFORE the widening and refuses them at the SHADOW REFUSAL after it — D426's mechanism, two different refusals and one unmoved summand.) // 🆕🆕 D447 +3 sentences (THE CHOSEN BENCH SNIPE, BOTH SEATS AND BOTH WORDINGS — corpus rows 514/525 (*"This attack also does {10|40} damage to 1 of your Benched Pokémon. (Don't apply …)"*) and row 587 (*"This attack does 40 damage to 1 of your opponent's Benched Pokémon. (Don't apply …)"*), **3 sentences / 3 legal printings**, claimed by `deriveAttackEffect` arm 6c through TWO widenings of the shared `ALSO_BENCHED_SNIPE_BODY` (`(?:also )?` and a possessive CAPTURE) over ONE new `damageChosen.target` member `yourBench`. Reader SURFACE unmoved at 13.) // 🆕🆕 D446 +5 sentences (THE FILTERED IN-PLAY BODY COUNT, ON BOTH SEATS — *"This attack does N damage for each of your Pokémon in play that has the Round attack."* (3 sentences / 6 legal printings, corpus rows 496/532/566) and *"This attack does 60 damage for each of your opponent's Pokémon ex [and Pokémon V] in play."* (2 / 3, rows 560/559) — **5 sentences / 9 legal printings**, all claimed by `deriveAttackDamageMultiplier` through THREE new anchors over TWO new `CardFilter` members (`attackNamePokemon` reading `cards.ts attacksOf`, `suffixPokemon` reading `pokemonSuffixOf`) — the widening D439 priced and REFUSED for its CONSUMERS. **ZERO new `DamageCountSource` members**: D439's `yourPokemonInPlay` is RENAMED `pokemonInPlay` and gains a REQUIRED `seat`, which is D440's re-derived union rule (identical payload ⇒ one member with the discriminator as a field) and NOT the `opponentPokemonInPlay` sibling D439's own executable falsifier predicted. ZERO new ops, op fields, prompt kinds, choice kinds, `route` values, events, error codes, `GameState` fields, registry rows, `packages/schema` bytes or `redact.ts` bytes. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at **13** (all three arms sit inside `deriveAttackDamageMultiplier`), and `REGISTRY_ATTACKS` / `SPLIT_ATTACK_UNITS` / `COMPOUND_ATTACK_UNITS` were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D443 +2 sentences (THE OPPONENT-BOARD ENERGY MOVE — *"Move an Energy from 1 of your opponent's Pokémon to another of their Pokémon."* and *"You may move an Energy from your opponent's Active Pokémon to 1 of their Benched Pokémon."*, **2 sentences / 5 legal printings**. Claimed WHOLE by `deriveAttackEffect` through TWO new anchors over the SHIPPED `moveEnergy` op, which gained ONE optional rider, `side?: "opponent"` — the endpoints are the FREE route and `selfToBench` read off the other seat's board, so ZERO new `route` values, ZERO new ops, ZERO new prompt kinds and ZERO new `CardFilter` members. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at **13** (both arms sit inside `deriveAttackEffect`), and `REGISTRY_ATTACKS` / `SPLIT_ATTACK_UNITS` / `COMPOUND_ATTACK_UNITS` were RE-MEASURED UNMOVED rather than assumed. ⚠️ AND NO COMPOUND COMPOSES: neither sentence carries a `. ` joiner at all.) // 🆕🆕 D442 +3 sentences (THE DESTINATION-SIDE SPREAD — the printed *"in any way you like"* on the move-Energy family, **3 sentences / 3 legal printings**: Kilowattrel `sv08-067`'s *"Move all Energy from this Pokémon to your Benched Pokémon in any way you like."* plus the two *"You may move any amount of [{M}] Energy from your Pokémon to your other Pokémon in any way you like."* printings. Claimed WHOLE by `deriveAttackEffect` through TWO new anchors over the SHIPPED `moveEnergy` op, whose ANSWER became a MAP (`{ picks: {uid, dest}[] }` — `attachCards`' shape) and which gained ONE optional rider, `anyDest`. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at **13** (both arms sit inside `deriveAttackEffect`), and ZERO new ops, ZERO new prompt kinds and ZERO new `CardFilter` members — the typed `{M}` axis is the SHIPPED `providesEnergy`, one optional capture group in the shared anchor. `REGISTRY_ATTACKS`, `SPLIT_ATTACK_UNITS` and `COMPOUND_ATTACK_UNITS` were RE-MEASURED UNMOVED rather than assumed (D424). ⚠️ NO COMPOUND COMPOSES: none of the three holds a `. ` joiner at all, so both splitters return null before AND after. ⚠️ `MATCH_RECORD_VERSION` STAYS 29 — the RENAME is not at a persisted address (`MatchRecord` holds `state`+`log`; an `EffectChoice` is in neither), and both `anyDest` keys are OPTIONAL with the pre-D442 coupling as their absent arm — D334 twice, not D359.) // 🆕🆕 D441 -1 sentence (THE MANDATORY ENERGY MOVE — *"Move all Energy from this Pokémon to 1 of your Benched Pokémon."*, **1 sentence / 2 legal printings** (`sv08-020`/`-195` Castform), claimed WHOLE by `deriveAttackEffect` through ONE new anchor `ATTACK_MOVE_ALL_ENERGY_SELF_TO_BENCH` on the SHIPPED `moveEnergy` op, whose `max` gained the third inhabitant `"all"` and whose prompt gained an optional `min`. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at **13** (the arm sits inside `deriveAttackEffect`, not a fourteenth), and ZERO new ops, ZERO new `CardFilter` members and ZERO new prompt kinds. `REGISTRY_ATTACKS`, `SPLIT_ATTACK_UNITS` and `COMPOUND_ATTACK_UNITS` were RE-MEASURED UNMOVED rather than assumed (D424). ⚠️ NO COMPOUND COMPOSES: the sentence holds no `. ` joiner at all, so both splitters return null on it before AND after — D426 at the degenerate end. ⚠️ AND THE FAMILY's OTHER `all` SENTENCE IS STILL REFUSED, for the DESTINATION shape and not the quantifier — *"…to your Benched Pokémon in any way you like."* spreads one answer over many destinations where `moveEnergy` names one `dest`.) // 🆕🆕 D440 +4 sentences (THE FILTERED DISCARD-PILE COUNT — *"This attack does N [more] damage for each <noun> in your [opponent's] discard pile."*, **4 sentences / 8 legal printings** over four printed nouns, each mapped to a `CardFilter` member that ALREADY EXISTED: `Energy card`→`anyEnergy`, `Basic Energy card`→`basicEnergy` (UNTYPED — the printed noun names no type), `Item card`→`item`, `Ethan's Adventure card`→`byName`. Claimed WHOLE by `deriveAttackDamageBonus` (2 sentences / 4 printings) and `deriveAttackDamageMultiplier` (2 / 4) through TWO new anchors (`DISCARD_PILE_COUNT_SCALE`, `DISCARD_PILE_COUNT_MULTIPLY`) and the `discardPileFilter` vocabulary, feeding the SIXTEENTH `DamageCountSource` member `cardsInDiscardPile` and ONE `scaledAttackDamage` arm. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at **13** (both arms sit inside existing readers, not a fourteenth). **ZERO new `CardFilter` members**, which is what keeps `retrieveNoun`'s switch and `BENCHABLE_RETRIEVAL_KINDS` out of this slice. `REGISTRY_ATTACKS` (16 units), `SPLIT_ATTACK_UNITS` (13) and `COMPOUND_ATTACK_UNITS` (21) were RE-MEASURED UNMOVED after the anchors landed rather than assumed, D424's rule — their derivation rungs in `censusAtHead.test.ts` stayed green. ⚠️ AND NO COMPOUND COMPOSES, MEASURED ON ALL FOUR SPLITTERS AND ON BOTH SIDES: none of the four claimed sentences holds a `. ` joiner at all, so every splitter returns null before and after — D426's mechanism at the degenerate end. ⚠️ TWO ANCHOR-REACHABLE SENTENCES ARE LEFT LOUD FOR TWO DIFFERENT REASONS, NOT ONE REASON TWICE: `Ancient card` (2 printings) is DATA-BLOCKED — the banner is printed on the card FACE and is in no column of the persisted catalog and no field of tcgdex's card model (`types.ts`:146-149, re-read at D440) — and `Supporter card that has "Team Rocket" in its name` (2 printings) is UNBUILT, because `byName` is exact equality (`cards.ts`:518) and no `CardFilter` member matches a name SUBSTRING at any width; that one carries an EXECUTABLE falsifier pinned on the POPULATION in `discardPileScaling.test.ts` §6, which reddens the day it becomes buildable.) 🆕🆕 D439 +5 sentences (BODIES IN PLAY, FILTERED — *"This attack does N damage for each of your <noun> Pokémon in play."*, **5 sentences / 8 legal printings** over five printed nouns, each mapped to a `CardFilter` member that ALREADY EXISTED: `Basic Pokémon`→`basicPokemon`, `Pokémon`→`anyPokemon`, `Team Rocket's Pokémon`→`ownerPokemon`, `{G} Pokémon`→`typedPokemon`, `Evolution Pokémon`→`evolutionPokemon`. Claimed WHOLE by `deriveAttackDamageMultiplier` (4 sentences / 6 printings) and `deriveAttackDamageBonus` (1 / 2) through TWO new anchors (`IN_PLAY_BODY_MULTIPLY`, `IN_PLAY_BODY_SCALE`) and the `inPlayBodyFilter` vocabulary, feeding the FIFTEENTH `DamageCountSource` member `yourPokemonInPlay` and ONE `scaledAttackDamage` arm. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at **13** (both arms sit inside existing readers, not a fourteenth). **ZERO new `CardFilter` members**, which is what keeps `retrieveNoun`'s switch and `BENCHABLE_RETRIEVAL_KINDS` out of this slice. `REGISTRY_ATTACKS` (16 units), `SPLIT_ATTACK_UNITS` (13) and `COMPOUND_ATTACK_UNITS` (21) were RE-MEASURED UNMOVED after the anchors landed rather than assumed, D424's rule. ⚠️ AND NO COMPOUND COMPOSES, MEASURED ON BOTH SIDES: the family's one compound — *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, 2 legal — splits THREE ways on `COMPOUND_CLAUSE_BREAK`, so its TAIL is the parenthetical reminder, which `deriveAttackEffect` refuses; `splitAttackTrailingClause` therefore returns null on its FIRST guard and never consults the head, before AND after this slice — D426's mechanism at the three-way end. ⚠️ TWO ANCHOR-REACHABLE SENTENCES ARE LEFT LOUD AND FOR TWO DIFFERENT REASONS, NOT ONE REASON TWICE: `Ancient Pokémon` (2 printings) is DATA-BLOCKED — the banner is in no catalog column and no tcgdex field, re-read at D439 against `PREVENT_DAMAGE_FROM_CLASS`'s permanently-stated refusal — while `Stage 1 Pokémon` (1 printing) is merely UNBUILT, needing a `CardFilter` member that reads a printed stage ORDINAL. The three opponent-side rows are refused by the anchors' `(?!opponent)` lookahead and priced on their filter, not their side.) 🆕🆕 D438 +2 sentences (THE RETREAT-COST PENALTY — *"This attack does {30|50} less damage for each {C} in your opponent's Active Pokémon's Retreat Cost."*, corpus rows 573/603, **2 sentences / 3 legal printings** that differ at exactly ONE character position (the `3` vs the `5`, index 17 zero-based — DIFFED, not eyeballed), claimed WHOLE by `deriveAttackDamagePenalty` through ONE new anchor `RETREAT_COST_PENALTY` and ONE `if`. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at **13** (the arm sits inside an existing reader, not a fourteenth), and the count source it names — `opponentActiveRetreatCost` — plus its `scaledAttackDamage` arm have both shipped since D110, so no union member and no evaluator arm arrived with it. `REGISTRY_ATTACKS` (12 units), `SPLIT_ATTACK_UNITS` (13) and `COMPOUND_ATTACK_UNITS` (21) were RE-MEASURED UNMOVED after the anchor landed rather than assumed, D424's rule. ⚠️ AND NO COMPOUND COMPOSES, MEASURED ON BOTH SIDES: each sentence holds **zero** `. ` joiners, so `splitAttackTrailingClause` and `splitAttackGateClause` both return null on it before AND after the widening — D426's mechanism at the degenerate end.) 🆕🆕 D437 +1 sentence (THE FILTERED BENCH SNIPE — *"This attack also does 60 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, corpus row 528, **1 sentence / 3 legal printings**, claimed WHOLE by `deriveAttackEffect` through the SHARED fragment `ALSO_BENCHED_SNIPE_BODY` gaining a THIRD capture and ONE optional op field `damageChosen.damagedOnly`. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at 13 (the arm is inside `deriveAttackEffect`, not a fourteenth reader) and `REGISTRY_ATTACK_UNITS`, `SPLIT_ATTACK_UNITS` and `COMPOUND_ATTACK_UNITS` were RE-MEASURED UNMOVED after the widening rather than assumed, D424's rule. ⚠️ AND NO COMPOUND COMPOSES, MEASURED ON BOTH SIDES OF THE WIDENING: at D436's head `splitAttackTrailingClause` refused this sentence at its TAIL test — the only `. ` joiner in it precedes the W/R parenthetical, and `deriveAttackEffect` does not claim *"(Don't apply Weakness and Resistance for Benched Pokémon.)"* on its own — and after the widening it refuses at the SHADOW REFUSAL one line earlier, because a string a reader claims whole never reaches composition. Two different refusals, one unmoved summand: the printing arrives through the anchor and `COMPOUND_ATTACK_UNITS` stands still, D426's mechanism.) // 🆕🆕 D436 +2 sentences (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D435 +1 sentence (THE DELAYED FAMILY CLOSED — the DISCARD payload, corpus row 53, *"At the end of your opponent's next turn, discard the Defending Pokémon and all attached cards."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `DELAYED_DEFENDER_DISCARD` and ONE new field-free `EffectOp` `scheduleDiscard`. ⚠️ THE FAMILY'S THIRD PAYLOAD (corpus row 113, 2 printings) LANDED IN THE SAME SLICE AND IS **NOT** IN THIS TERM: it is a COMPOUND, refused by every whole-sentence reader by construction, and it arrives through `splitAttackTrailingClause` — so this instrument steps by 1 where `BUILT.attack` steps by 3, which is the reader-vs-compound split stated rather than left to be inferred from the size of the step.) 🆕🆕 D434 +1 sentence (THE DELAYED COUNTER PLACEMENT — *"At the end of your opponent's next turn, put 9 damage counters on the Defending Pokémon."*, corpus row 54, **1 sentence / 3 legal printings**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `DELAYED_DEFENDER_COUNTERS` and ONE new `EffectOp` `scheduleCounters`. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at 13 (the arm is inside `deriveAttackEffect`, not a fourteenth reader), and `SPLIT_ATTACK_UNITS`, `COMPOUND_ATTACK_UNITS` and `REGISTRY_ATTACK_UNITS` were RE-MEASURED UNMOVED after the anchor landed rather than assumed, D424's rule. ⚠️ AND NOTHING COMPOSES, MEASURED: corpus row 113 carries the same clock behind a head `deriveAttackEffect` already claims, but `splitAttackTrailingClause` refuses it because its TAIL — the family's KNOCK-OUT payload — is claimed by no reader, which is D426's mechanism read from the other end.) 🆕🆕 D432 +1 sentence (THE INSTALLED NO-WEAKNESS BAR — *"During your opponent's next turn, this Pokémon has no Weakness."*, corpus row 192, **1 sentence / 3 legal printings**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `SELF_NO_WEAKNESS` and ONE new field-free `EffectOp` `removeWeakness`. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at 13 (the arm is inside `deriveAttackEffect`, not a fourteenth reader), and `SPLIT_ATTACK_UNITS`, `COMPOUND_ATTACK_UNITS` and `REGISTRY_ATTACK_UNITS` were RE-MEASURED UNMOVED after the anchor landed rather than assumed, D424's rule. ⚠️ AND NO COMPOUND COMPOSES: the sentence is ONE clause with no `. ` joiner in it at all, so `splitAttackTrailingClause` never sees a tail — D426's mechanism, at the degenerate end.) 🆕🆕 D431 +1 sentence (THE PRIZE TAKEN WITHOUT A KNOCK OUT — *"Discard all Energy from this Pokémon, and take a Prize card."*, corpus row 108, **1 sentence / 3 legal printings**, claimed WHOLE by `deriveAttackEffect` through ONE new compound anchor `SELF_DISCARD_ALL_THEN_TAKE_PRIZE` and ONE new field-free `EffectOp` `takePrize`. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at 13 (the arm is inside `deriveAttackEffect`, not a fourteenth reader), and `SPLIT_ATTACK_UNITS`, `COMPOUND_ATTACK_UNITS` and `REGISTRY_ATTACK_UNITS` were RE-MEASURED UNMOVED after the anchor landed rather than assumed, D424's rule. ⚠️ AND THE COMPOUND COMPOSED NOTHING: `splitAttackTrailingClause` refuses this string twice over — the joiner is ", and" rather than ". ", and the tail *"take a Prize card."* is claimed by no reader — so the sentence arrives through the anchor and NOT through the splitter, which is why `COMPOUND_ATTACK_UNITS` does not move, D426's mechanism.) 🆕🆕 D429 +3 sentences / +3 printings (THE REST OF THE PRE-DAMAGE FAMILY — corpus rows 71, 72 and 74, *"…discard all Pokémon Tools and Special Energy from your opponent's Active Pokémon."*, *"…discard all Pokémon Tools from this Pokémon. If you can't discard any, this attack does nothing."* and *"…If you discarded a Pokémon Tool in this way, your opponent's Active Pokémon is now Paralyzed."*, **1 legal printing each**, measured over the `legal_standard = 1` attack column this corpus IS (640 sentences / 1,732 printings). All three claimed WHOLE by the SAME reader `deriveAttackPreDamage`, which gained three ANCHORS and three union members and no new instrument — so the ATTACK READER SURFACE STANDS STILL AT 13 and the step arrives through the RAW summand ALONE. ⚠️ `SPLIT_ATTACK_UNITS` (14), `COMPOUND_ATTACK_UNITS` (19) and `REGISTRY_ATTACK_UNITS` (16) were RE-MEASURED after the anchors landed rather than assumed (D424): all three unmoved.) 🆕🆕 D428 +1 sentence / +5 printings (THE PRE-DAMAGE TOOL DISCARD — *"Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon."* (**5 legal printings** on ONE sentence, corpus line 73), measured over the `legal_standard = 1` attack column this corpus IS (640 sentences / 1,732 printings). ONE new WHOLE-SENTENCE READER — `deriveAttackPreDamage`, the THIRTEENTH — and NOT an arm inside `deriveAttackEffect`, so the reader SURFACE moves 12 → 13 as well as the resolution figures. 🛑 THE SHAPE IS NOT AN `EffectOp`, and D125's rule is only half the reason: the printed act precedes damage and an effect program runs at `attack.ts`'s TAIL — and, the half D125 never faced, an `EffectOp[]` at a pre-damage call site could PARK, which §8.5 has no continuation for. The carrier is a closed `AttackPreDamage` union applied by a TOTAL function returning `GameState`, so the park is forbidden BY THE SIGNATURE rather than by a hand-kept list of safe ops (D222). ⚠️ A PREFIX STRIPPER ON THE SHARED HEAD `Before doing damage, ` WAS PRICED AND REFUSED WITH THE MEASUREMENT: over all 640 sentences FOUR open with that head and ZERO of the four remainders is claimed by any of the twelve readers, as printed OR re-capitalised — it buys nothing today and every sibling still needs its own arm. ⚠️ `SPLIT_ATTACK_UNITS` (14), `COMPOUND_ATTACK_UNITS` (19) and `REGISTRY_ATTACK_UNITS` (16) ALL STAND STILL, measured AFTER the reader landed rather than assumed (D424 gained a printing exactly this way): the one COMPOUND whose head this reader claims carries a TAIL `deriveAttackEffect` refuses.)  🆕🆕 D427 +1 sentence / +6 printings (HEAL SELF BY THE DAMAGE THIS ATTACK DEALT — *"Heal from this Pokémon the same amount of damage you did to your opponent's Active Pokémon."* (**6 legal printings** on ONE sentence), measured over the `legal_standard = 1` attack column this corpus IS (640 sentences / 1,732 printings). ONE new anchor and ONE new arm in `deriveAttackEffect` over the SHIPPED `heal` op, whose `amount` went `number` → `number | "dealt"`. 🛑 A LITERAL AND NOT A TEMPLATE: the loosest plausible family grep `/same amount of damage|damage you did|amount of damage/i` over all 640 sentences returns EXACTLY this row, so D121's two-printings-with-one-token-varying warrant is UNMET and any capture group would be a template over a population of one (D190b). ⚠️ THE CARRIER IS `EffectContext.dealt?: number` AND NOT `EffectRecord`, and the first reason is the VALUE TYPE rather than the meaning: every `EffectSlot` this engine files is a LIST OF CARD UIDS and this is an HP FIGURE, so the record has no slot for it and no widening that keeps its value type (D406 priced exactly that one slice before declining the sentence). ⚠️ `MATCH_RECORD_VERSION` STAYS 26 THOUGH THE CARRIER IS PERSISTED — `ctx` rides `EffectContinuation` into `phase.cont` exactly as `record` does, and an OPTIONAL key there is D125's WIDENING, `invokedBy` verbatim; the `heal.amount` union gained an INHABITANT, which is the same rule one address over. Driven both directions on a real park in `selfHealDealt.test.ts`, not asserted. ⚠️ `SPLIT_ATTACK_UNITS` AND `COMPOUND_ATTACK_UNITS` DO NOT MOVE, MEASURED AFTER THE ARM LANDED rather than assumed (D424 gained a printing exactly this way): the sentence occurs once in the column with no compound sibling, and `splitAttackTrailingClause` needs a TAIL this arm does not make readable.)  🆕🆕 D426 +2 sentences / +6 printings (THE OPPONENT-CHOOSES HAND DISCARD — *"Your opponent discards 2 cards from their hand."* (**4 legal printings**) and *"Your opponent discards a card from their hand."* (**2**) — **2 sentences / 6 printings**, measured over the `legal_standard = 1` attack column this corpus IS (640 sentences / 1,732 printings). ONE new anchor and ONE new arm over ONE new `EffectOp`: the anchor is an ALTERNATION over the printed count (`(?:(\d+) cards|a card)`) whose absent group is the ARTICLE, so both printed spellings are one template and the singular resolves to 1 rather than to a default. 🛑 THE MECHANISM THE SENTENCE DOES NOT ADVERTISE: this is the FIRST park in the engine whose ANSWERER is the non-controller AND whose candidates are HIDDEN card identities — the `decider` route (M5, Ortega) crosses the hidden-candidate `chooseCards` resolution here for the first time — so `redactedPromptOf`'s answerer gate is what keeps the ATTACKER from receiving a face-up list of the DEFENDER's hand and answering it; driven from both chairs, on the whole snapshot rather than on the prompt field. ⚠️ `COMPOUND_ATTACK_UNITS` DOES NOT MOVE, and that was MEASURED AFTER THE ARM LANDED rather than assumed (D424 gained a printing exactly this way): both related compounds stay refused, because `splitAttackTrailingClause` needs the TAIL claimed by `deriveAttackEffect` and this slice made a HEAD readable. ⚠️ `MATCH_RECORD_VERSION` STAYS 26 THOUGH THIS OP PARKS — it reaches `phase.cont.pendingOp`, the one persisted address an `EffectOp` is written at, and a NEW UNION INHABITANT is still D125's widening there; driven both directions.)  🆕🆕 D425 +3 sentences / +5 printings (THE OWN-SIDE BENCH-WIDE SPREAD — *"This attack also does {N} damage to each of YOUR Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, measured over the `legal_standard = 1` attack column this corpus IS (640 sentences / 1,732 printings): **3 sentences / 5 printings** — 10 (**3 printings**), 20 (**1**), 30 (**1**). Claimed by ZERO new anchors and ZERO new readers: `SPREAD_EACH_BENCH` already held the opponent-side twin and its possessive became a CAPTURE, so the arm returns the shipped `spreadDamage` op with `target` read off group 2. The op's `target` was a SINGLETON `"opponentBench"` and is now `"opponentBench" | "yourBench"`, which is a WIDENING — `MATCH_RECORD_VERSION` STAYS 26, driven both directions. 🛑 THE MECHANISM THE SENTENCE DOES NOT ADVERTISE: an attack's own damage can now Knock Out its USER's own benched Pokémon and §8.1 owes that Prize to the OPPONENT. The engine needed no new code for it — `finishAttack` already sweeps [defender, attacker] and each Knock Out's Prize already goes to `otherSeat(ref.seat)` — and all of it is DRIVEN in `ownBenchSpread.test.ts` rather than inherited. ⚠️ WHAT DID NEED A MECHANISM WAS THE LOG: `DAMAGE_DEALT` gained a REQUIRED `by: Seat`, because `log.ts` derived the dealer as `otherSeat(event.seat)` and this is the first row where those two seats are the SAME — the row credited the DEFENDER with damage the ATTACKER did to its own Bench. Events are transient and never persisted, so that field moves no version either.)  🆕🆕 D424 +3 sentences / +5 printings (THE TWO-STATUS PAIR — *"Your opponent's Active Pokémon is now {X} and {Y}."* and its coin-flipped twin, measured over the `legal_standard = 1` attack column this corpus IS (640 sentences / 1,732 printings): Burned+Confused (**3 printings**), and behind a coin flip Confused+Poisoned (**1**) and Paralyzed+Poisoned (**1**) — 3 sentences / 5 printings, claimed by TWO new anchors (`DEFENDER_STATUS_PAIR`, `FLIP_DEFENDER_STATUS_PAIR`) and ONE shared helper `defenderStatusPair` in `deriveAttackEffect`, whose program is TWO `applyStatus` ops in PRINTED ORDER — Dangerous Laser `sv06.5-058`'s already-shipped registry program reached from the attack side, cited rather than reinvented. 🛑 THE PAIR IS REFUSED WHEN BOTH WORDS SHARE A `SpecialConditions` FIELD: Asleep/Paralyzed/Confused are three values of ONE `rotation` slot, so a pair of them would resolve with the second op silently overwriting the first — a lie that resolves. ZERO of the 1,732 printings carry such a pair (pinned on the POPULATION in `defenderStatusPair.test.ts`, per D423's rule, not on a specimen string), so that arm is driven synthetically and says so. ⚠️ A FOURTH PRINTING COMPOSES FOR FREE AND ITS STEP LANDS ELSEWHERE: `splitAttackTrailingClause` now takes *"…is now Confused and Poisoned. Switch this Pokémon with 1 of your Benched Pokémon."* because its HEAD is newly claimed and its tail was already D189's, so the TRAILING split moves 9 → 10 sentences / 18 → 19 printings while this summand does not see it. And the two flip sentences are multi-clause AND newly claimed whole, which steps the shadow-refusal census 153 → 155.) 🆕🆕 D423 +1 sentence / +3 printings (THE OPPONENT-SIDE DAMAGE-COUNTER MULTIPLIER — *"This attack does 20 damage for each damage counter on your opponent's Active Pokémon."* (**3 legal printings** — Glalie `sv06-052` and Flapple `sv08-139`/`sv08-210`, TWO cards where the third printing is Flapple's Illustration Rare, so the step is +1 sentence and +3 printings), claimed by ONE new anchor `OPPONENT_COUNTER_MULTIPLY` and ONE `if` in `deriveAttackDamageMultiplier` — the `×` twin of D168's ADDITIVE arm on the SAME `DamageCountSource` member, so ZERO new count members, ZERO new evaluator arms, ZERO new folds and no branch in attack.ts. 🛑 AND IT IS A CORRECTION TO A PINNED ABSENCE THAT WAS WRONG WHEN WRITTEN, NOT ROTTED: `opponentCounterScaling.test.ts` asserted *"There is no no-adjective printing of this count source anywhere in the pool"* off D168's LOCAL SIX-SET sweep (978 cards / 6 sets — sv01/sv02/sv03/sv06.5/sve/swsh10.5), and both cards are `sv06`/`sv08`, sets that catalog has never held; the assertion passed only because the string it tested carries `per = 30`, an amount nothing prints. The legal attack column did NOT churn (D219 re-derived 640 sentences / 1,732 units / 60,467 chars to D187's digit, `censusAtHead.test.ts` has quoted that triple since D233, and D274 committed the `20` row at `a7e9a57`), and D183 records that `api.tcgdex.net` is network-refused in this container — so a re-ingest is ruled out by MEASUREMENT, not by argument. 🛑 THE RAW SUMMAND'S STEP AND NO OTHER'S, MEASURED RATHER THAN ASSERTED: the sentence carries no leading gate clause so `SPLIT_ATTACK_UNITS` stands still at 13; it is never a compound TAIL in this column so `COMPOUND_ATTACK_UNITS` stands still at 18; and the slice authors no registry row so `REGISTRY_ATTACK_UNITS` stands still at 16 — all three checked by `censusAtHead.test.ts` staying green on them while the raw summand moved. ⚠️ AND `clauseApostrophe.test.ts` MOVES 141 → 142, WHICH IS WHERE THIS SLICE DIFFERS FROM D421's AND D422's: this sentence DOES carry an apostrophe (`opponent's`, ASCII U+0027, byte-verified with `cat -A` on the corpus row rather than assumed — a brief for this slice guessed U+2019 and was wrong), so a census keyed on that CHARACTER sees it the moment it becomes derivable. The engine version moves 0.324.0 → 0.325.0 and `MATCH_RECORD_VERSION` STAYS 26, DRIVEN in `opponentCounterMultiply.test.ts` §7 by round-tripping the board through JSON and by comparing this fold's `DAMAGE_DEALT` key set against D168's SHIPPED additive row.) // 🆕🆕 D422 +1 sentence / +3 printings (THE OPTIONAL SELF-SWITCH — *"You may switch this Pokémon with 1 of your Benched Pokémon."* (**3 legal printings**), the family's LAST unbuilt sentence and the third member of a family D181 opened and D189 half-closed, claimed WHOLE by ONE new `deriveAttackEffect` arm returning `[{ op: "optional", note, then: [{ op: "switchActive" }] }]` — both ops shipped, ZERO new vocabulary. 🛑 THE RAW SUMMAND'S STEP AND NO OTHER'S, MEASURED RATHER THAN ASSERTED: the sentence carries no leading gate clause so `SPLIT_ATTACK_UNITS` stands still at 13; it is never a compound TAIL in this column (a live probe re-ran `splitAttackTrailingClause` over all 640 sentences AFTER the arm landed and the admitted set is UNCHANGED at 9 sentences / 18 printings) so `COMPOUND_ATTACK_UNITS` stands still at 18; and the slice authors no registry row so `REGISTRY_ATTACK_UNITS` stands still at 16. ⚠️ AND `clauseApostrophe.test.ts` STANDS STILL AT 141 TOO — this sentence carries NO apostrophe of either class (measured on the bytes: it names *this Pokémon* and *your* Bench, so there is no possessive and no contraction), and a census keyed on a CHARACTER cannot see a sentence that carries none however derivable it becomes. The engine version moves 0.323.0 → 0.324.0 and `MATCH_RECORD_VERSION` STAYS 26, DRIVEN in both directions in `optionalSelfSwitch.test.ts` §8 by round-tripping BOTH parks through JSON and comparing their key sets against parks THIS build writes for two SHIPPED sentences.) // 🆕🆕 D421 +1 sentence / +5 printings (THE UNTIL-IT-LEAVES-ACTIVE BAR — *"This Pokémon can't use Blaze Blitz again until it leaves the Active Spot."* (**5 legal printings** — Gouging Fire ex `sv05-038`/`-188`/`-204`/`-214` and `svp-144`, ONE card in five rarities, which is why the step is +1 sentence and +5 printings), claimed WHOLE by `deriveAttackEffect` arm 24a-ii as a LITERAL ROW (D121: the varying axis holds ONE attack name) over a WIDENED `preventAttackUse`. THE RAW SUMMAND'S STEP AND NO OTHER'S: the sentence carries no gate clause, is never a compound tail and has no registry row, so `SPLIT_ATTACK_UNITS` 13, `COMPOUND_ATTACK_UNITS` 18 and `REGISTRY_ATTACK_UNITS` 16 all stand still.) // 🆕🆕 D420 +3 sentences / +4 printings (THE HAND-ENERGY COST FAMILY — *"Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing."* (**2 legal printings**), *"Discard 2 Basic {G} Energy cards from your hand. If you can't discard 2 cards in this way, this attack does nothing."* (**1**) and *"Discard a Basic {G} Energy card from your hand. If you can't, this attack does nothing."* (**1**) — the six-Energy KO is EXACTLY the sentence D415's correction named as the KO residue NOTHING IN THIS REPO COULD BUILD, needing a hand-Energy COST and a does-nothing CANCEL rather than the park or the gate the other two residue members took; the other two printings charge the SAME cost, so all three are built TOGETHER rather than one at a time. Each is claimed WHOLE by ONE reader — `deriveAttackCancelRequirement`, whose `ATTACK_CANCEL_TRAILING` head list is WIDENED past D417's Stadium-only head — over TWO new `deriveAttackEffect` arms: 6f the bare cost, 6g the cost joined to a Knock Out by `", and "`, a COMMA join inside ONE sentence that `splitAttackTrailingClause`'s sentence-boundary `BREAK` cannot reach, which is why the compound needs an arm of its own rather than the composition path. 🛑 THE WHOLE DELTA ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER: a sentence claimed whole is RAW rather than split or compound, so `SPLIT_ATTACK_UNITS` stands still at 13 (the splitter finds no leading gate clause on any of the three), `COMPOUND_ATTACK_UNITS` at 18 (that term only ever counts what the whole-sentence anchors REFUSE, and these three are now claimed) and `REGISTRY_ATTACK_UNITS` at 16, the slice authoring no row. The engine version moves 0.321.0 → 0.322.0 and `MATCH_RECORD_VERSION` STAYS 26 — the cost pays through the SHIPPED `payFromHand` op and adds NO persisted field. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE DIFFERENT NUMBERS ON THE SAME ROW — 3 and 4, where D417's were 1 and 1 — the six-Energy KO printing on TWO ids and the other two on one each.) — 🆕🆕 D418 411 → 412 with NOTHING SHIPPED: D417's `deriveAttackCancelRequirement` was live and missing from this file's list. The FROZEN tail [365, 1261] does NOT move — 🆕🆕 D416 +2 sentences / +6 printings (THE PARKING KO PAIR — *"Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon."* (**4 legal printings**) and *"Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it."* (**2 legal printings**) — EXACTLY the two sentences D415 named as the residue that still needed a PARK, and they are built TOGETHER rather than one at a time because they are ONE op with two riders: ONE new PARKING `EffectOp` (`knockOutChosen`, REQUIRED `target: "opponentBench" | "opponentAny"` plus optional `basicOnly` / `damageCountersExactly`), reached through the EXISTING `choosePokemon` prompt and the EXISTING `KNOCKED_OUT` sweep. The op PARKS on `phase.cont.pendingOp` but adds ZERO persisted RECORD fields, so `MATCH_RECORD_VERSION` STAYS 26 (D307's paragraph: no v26 deploy can author `{ op: "knockOutChosen", … }` into a record THIS deploy reads) while the engine version moves 0.319.0 → 0.320.0. 🛑 THE WHOLE DELTA ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER: both sentences are claimed WHOLE by `deriveAttackEffect` (arms 6d and 6e), and a sentence resolved whole is RAW rather than split or compound, so `SPLIT_ATTACK_UNITS` stands still at 13 (the splitter finds no leading gate clause on either), `COMPOUND_ATTACK_UNITS` at 18 (that summand only ever counts what the whole-sentence anchors REFUSE, and these two are now claimed) and `REGISTRY_ATTACK_UNITS` at 16, the slice authoring no row. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE DIFFERENT NUMBERS ON THE SAME ROW — 2 and 6 — the flip sentence printing on FOUR ids and the counter-window sentence on TWO, where D415's were 1 and 1. ⚠️ AND EXACTLY ONE OF THE TWO JOINS `compoundCompose` §4's SHADOW-REFUSAL POPULATION, where D415's single sentence joined nothing: the flip sentence carries TWO `BREAK` boundaries (`Flip a coin.` ‖ `If heads, …` ‖ `If tails, …`) so it is THREE clauses, has always sat in the 271 multi-clause corpus, and is now claimed whole — 148 → **149** sentences / 421 → **425** printings; the counter-window sentence has no internal break at all, so it is ONE clause and was never in the 271. The `multiClause` pair 271 / 613 STANDS STILL, because both sentences were always IN the corpus and this slice changed only the CLAIM.) 🆕🆕 D415 +1 sentence / +1 printing (THE OPPONENT-SCOPED SPECIAL-ENERGY KO GATE — *"If your opponent's Active Pokémon has any Special Energy attached, it is Knocked Out."* — Haxorus `sv06.5-046`, **1 legal printing** — claimed WHOLE by `deriveAttackEffect` as ARM 6a WITH THE `cond` SWAPPED AND NOTHING ELSE: the same `conditionGate` over the same shipped FIELD-FREE `knockOutDefender` op D414 built, behind ONE new `BoardCondition` member `opponentActiveHasEnergyAttached` — the SEAT MIRROR of the shipped `yourActiveHasEnergyAttached`, same `energy` parameter, same `hasAttachedEnergy` predicate, one seat over. ZERO new readers, ZERO new effect fields and ZERO registry rows, so `MATCH_RECORD_VERSION` STAYS 26 while the engine version moves 0.318.0 → 0.319.0. 🛑 THE WHOLE DELTA ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER: the sentence is resolved WHOLE, and a sentence resolved whole is RAW rather than split or compound, so `SPLIT_ATTACK_UNITS` stands still at 13, `COMPOUND_ATTACK_UNITS` at 18 and `REGISTRY_ATTACK_UNITS` at 16. ⚠️ AND IT DOES NOT JOIN `compoundCompose` §4's SHADOW-REFUSAL POPULATION EITHER — it breaks on a COMMA and not on a sentence boundary, so it is ONE clause and was never among the 271 multi-clause sentences that rung counts; 148 / 421 STANDS STILL where D414's third sentence moved it. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE THE SAME NUMBER HERE — 1 and 1 — where D414's were 3 and 4.) 🆕🆕 D414 +3 sentences / +4 printings (THE KNOCK OUT THAT REACHES THE OTHER SIDE OF THE TABLE — *"If your opponent's Active Pokémon is a Basic Pokémon, it is Knocked Out."* (2), *"Both Active Pokémon are Knocked Out."* (1) and *"This Pokémon does 100 damage to itself. Flip a coin. If heads, your opponent's Active Pokémon is Knocked Out."* (1) — THREE whole-sentence anchors and THREE `deriveAttackEffect` arms over ONE new FIELD-FREE op (`knockOutDefender`), whose both-Actives spelling is a COMPOSITION of two shipped field-free ops rather than a `target` field, so no persisted union gains a member and `MATCH_RECORD_VERSION` STAYS 26. 🛑 THE WHOLE DELTA ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER, WHICH IS THE POINT: a reader claims each of the three sentences WHOLE, and a sentence resolved whole is RAW rather than split or compound. So `SPLIT_ATTACK_UNITS` stands still at 13 (the splitter finds no leading gate clause on any of the three), `COMPOUND_ATTACK_UNITS` stands still at 18 (the fourth summand only ever counts what the whole-sentence anchors REFUSE, and these three are now claimed), and `REGISTRY_ATTACK_UNITS` stands still at 16, the slice authoring no row. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE DIFFERENT NUMBERS ON THE SAME ROW — 3 and 4 — the Basic-gate sentence printing on TWO ids and the other two on one each. ⚠️ AND IT IS THE KO-WITHOUT-DAMAGE **SUBSET**: the printed family is SEVEN sentences / THIRTEEN printings and this slice takes exactly the four whose targets are NAMED by the printed text, the other three each needing a PARK over a filtered candidate set. 🛑 **THAT LAST CLAUSE WAS WRONG THREE WAYS AND IS CORRECTED IN PLACE BY D415 — NOT SILENTLY REWRITTEN: the original wording is left standing immediately above so the correction reads as one, per the family's standing rule that a witness moves rather than disappears.** (i) THE RESIDUE WAS FOUR SENTENCES / NINE PRINTINGS, NOT THREE — 4 + 4 sentences is the 7 this note counts, and 9 + 4 printings is the 13. (ii) THEY DID NOT "EACH" NEED A PARK, and "whose targets are NAMED" was never the discriminator that separated them: two of the four residue sentences name their targets in printed words as plainly as the three D414 took. What D414 actually took were the sentences needing NO vocabulary beyond the op and a shipped `BoardCondition`. **D415 then built a fourth on exactly those terms and needed no park at all** — *"If your opponent's Active Pokémon has any Special Energy attached, it is Knocked Out."* (Haxorus `sv06.5-046`, 1 printing), arm `6a` with the `cond` swapped and nothing else, over `opponentActiveHasEnergyAttached`: the SEAT MIRROR of the shipped `yourActiveHasEnergyAttached`, same `energy` parameter, same `hasAttachedEnergy` predicate, one seat over. ⚠️ SO THE RESIDUE AT HEAD IS THREE SENTENCES / EIGHT PRINTINGS, AND ONLY TWO OF THEM NEED A PARK: *"Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it."* (2) and *"Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon."* (4). The third is the HAND-ENERGY KO at `censusAttackCorpus.ts` line 93 — *"Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing."* (2) — which needs a hand-Energy COST and an *"If you can't …, this attack does nothing."* CANCEL, a different mechanism from both the park and the gate, and **NOTHING IN THIS REPO NAMED IT AT ALL** until D415 put it in `knockOutDefender.test.ts`'s `UNBUILT_TEXT` as `handEnergyKo`, where it can go red. ⚠️ THIS IS ONE OF THE NINE VERBATIM COPIES OF THE UNCORRECTED NOTE THAT `censusAtHead.test.ts` NAMED (`exOnlyActive`, `precociousEvolution`, `retreatCostBonus`, `sawkRequirementSplit`, `inPlayTypeBonus`, `sameEnergyBonus`, `moreEnergyBonus`, `opponentBenchCount`, `benchNamedBonus`) — D415 swept all nine rather than leaving them to be rediscovered.) 🆕🆕 D413 +2 sentences / +5 printings (THE ADDITIVE MULTI-COIN FOLD — *"Flip 2 coins. This attack does 30 more damage for each heads."* (3) and *"…does 50 more damage for each heads."* (2), ONE anchor (`ATTACK_COIN_MULTI_BONUS`) and ONE `deriveAttackCoinFlip` arm returning D129's `bonusOnHeads` over D127's `flips: { kind: "printed", count: 2 }` — a NEW COMBINATION of an already-shipped vocabulary and therefore not a new shape (D405's rule), so ZERO new ops, fields, readers, `BoardCondition` members or registry rows and `MATCH_RECORD_VERSION` STAYS 26. A READER-keyed move arriving through the RAW summand ALONE: a reader claims each sentence WHOLE, so `splitHead` and the COMPOUND term both stand still, and `REGISTRY_ATTACK_UNITS` stands still because this slice authors no rows.) 🆕🆕 D408 +2 sentences / +7 printings (THE BARE ATTACK LOCK, BOTH SEATS — *"During your opponent's next turn, the Defending Pokémon can't attack."* (3) and *"…can't use attacks."* (4), ONE ALTERNATION anchor (`DEFENDER_CANT_ATTACK_NEXT_TURN`) and ONE `deriveAttackEffect` arm returning D148's `preventAttack { target: "defender" }` unchanged: ZERO new ops, fields, readers, `BoardCondition` members or registry rows. ⚠️ THE SLICE'S THIRD SENTENCE MOVES NOTHING — *"During your next turn, this Pokémon can't use attacks."* (4 printings) ALREADY RESOLVED, to a lock keyed on an attack no card is named, so repairing it is invisible to every census figure) 🆕🆕 D407 +1 sentence / +4 printings (THE BOARD-WIDE OWN-ENERGY COUNT — *"This attack does 30 more damage for each {G} Energy attached to all of your Pokémon."*, ONE WIDENED whole-sentence anchor (`SELF_ENERGY_SCALE`) and ONE OPTIONAL `zone` on the SHIPPED `energyOnSelf` member, delegating to the `countEnergyInPlay` its opponent-side twin has called since D193: ZERO new members, counters, ops or registry rows) 🆕🆕 D406 +1 sentence / +5 printings (THE COUNTED TOOL SCALER — *"This attack does 30 damage for each Pokémon Tool attached to all of your Pokémon."*, ONE whole-sentence anchor (`YOUR_TOOLS_MULTIPLY`) and ONE `deriveAttackDamageMultiplier` arm over a THIRTEENTH `DamageCountSource` member, `toolsOnYourBoard`) 🆕🆕 D405 +1 sentence / +5 printings (THE MANDATORY OWN-BOARD ENERGY RETRIEVAL — *"Put an Energy attached to this Pokémon into your hand."*, ONE whole-sentence anchor and ONE `deriveAttackEffect` arm returning ONE `discardEnergy { from: "yourActive", filter: anyEnergy, to: "hand" }`: the op is D96's, the destination D295's and the absent `count` the op's OWN documented "one", so ZERO new ops, fields, readers, `BoardCondition` members or registry rows — a READER-keyed move, so `REGISTRY_ATTACK_UNITS` and `splitHead` both stand still. The whole price outside the reader was ONE caption branch on `discardNote`'s `yourActive` arm, which no census figure can see.) 🆕🆕 D404 +1 sentence / +7 printings (THE MANDATORY HAND WIPE AND REFILL — *"Discard your hand and draw 6 cards."*, ONE whole-sentence anchor and ONE `deriveAttackEffect` arm returning `discardHand` then `drawCards` in PRINTED ORDER: both ops shipped with Professor's Research, so ZERO new ops, fields, readers, `BoardCondition` members or registry rows, and `REGISTRY_ATTACK_UNITS` / `splitHead` stand still)  // 🆕🆕 D403 +2 sentences / +8 printings (THE ADDITIVE HALF OF D402's FAMILY — *"You may discard up to 2 [Basic] Energy from your Benched Pokémon. This attack does {60|90} more damage for each card you discarded in this way."* on an ELEVENTH reader plus an exported assembler taking the printed BASE, ONE `discardEnergy.from` member (`yourBench`) and ONE OPTIONAL `damageDefender.base` field; a READER-keyed move, so no registry summand moves and `MATCH_RECORD_VERSION` stays 25) // 🆕🆕 D402 +6 sentences / +13 printings (THE DISCARD-COUNT-SCALED ATTACK — the §9.2 `discarded` record read as a damage MULTIPLIER: ONE map-built whole-sentence anchor and ONE `deriveAttackEffect` arm returning the two-op pair `registry.ts` already spells BY HAND on two cards that have since ROTATED, so ZERO new ops, fields, `BoardCondition` members or registry rows and no registry summand moves) // 🆕🆕 D401 +4 sentences / +7 printings (THE SELF-DISCARD COST BEFORE AN ANY-TARGET SNIPE — one whole-sentence COMPOUND anchor over the §8 cost and the snipe, returning both ops in printed order; a READER-keyed move, so no registry summand moves) // 🆕🆕 D400 +2 sentences / +9 printings (THE ANY-TARGET ARITY — `CHOSEN_ANY_TARGET`'s hard-coded `1 of` captured and the W/R tail's number word required to AGREE with it; a READER-keyed move, so no registry summand moves) // 🆕🆕 D399 +3 sentences / +5 printings (THE TWIN CONSEQUENT AND THE ARITY — the gated Wo-Chien printing plus the FOUR the flat rider was refusing on the literal count `1`) // 🆕🆕 D398 +1 sentence / +1 printing (THE DECK-SIZE READ — Rabsca `sv08-014` "Counterturn" ({G}, `40+`, **+200**, index **1** of TWO) at 1 legal printing, taken by ONE new `BoardCondition` member (`yourDeckAtMost { count }`), TWO exhaustive-switch arms and ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row — a READER-keyed move, so `REGISTRY_ATTACK_UNITS` and `splitHead` BOTH stand still) // 🆕🆕 D397 +1 sentence / +1 printing (THE BENCHED-CUBONE FILTER — Marowak `sv07-073` "Bone Vengeance" ({C}{C}, `60+`, **+120**, index **1** of TWO) at 1 legal printing, taken by ONE new `BoardCondition` member (`yourBenchNamedDamaged { name }`), TWO exhaustive-switch arms and ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row — a READER-keyed move, so `REGISTRY_ATTACK_UNITS` and `splitHead` BOTH stand still) // 🆕🆕 D394 +2 sentences / +2 printings (THE USED-ATTACK PAIR — Falinks `sv07-088` "All-Out Attack" ({C}{C}, `30+`, **+90**, index 1 of TWO) and Weezing `sv09-092` "Crazy Blast" ({D}{C}, `50+`, **+120**, index 1 of TWO), 1 legal printing each: ONE new `BoardCondition` member (`yourActiveUsedAttackLastTurn { attack }`), ONE new REQUIRED `InPlayPokemon` field (`usedAttack`), ONE new REQUIRED field on `PendingStage.attackEpilogue`, TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and TWO new exhaustive-switch arms — the residue's LAST pair on one mechanism, the first window in the union that is not the turn in progress, and the third entry on this line to move `MATCH_RECORD_VERSION`, 24 -> 25) // 🆕🆕 D393 +2 sentences / +2 printings (THE EVOLVE PAIR — Gholdengo `sv08-131` "Strike It Rich" ({M}, `30+`, **+90**, index 0 of TWO) and Misty's Starmie `sv10-047` "Abrupt Flash" ({W}, `60+`, **+80**, index 0 of ONE), 1 legal printing each: ONE new `BoardCondition` member (`yourActiveEvolvedFromThisTurn { name }`), ONE new REQUIRED `InPlayPokemon` field (`evolvedTurn`), TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and TWO new exhaustive-switch arms — the residue's only PAIR on one mechanism, and the second entry on this line to move `MATCH_RECORD_VERSION`, 23 -> 24) // 🆕🆕 D392 +1 sentence (THE SUBSTRING NAME READ — Team Rocket's Nidoqueen `sv10-116` "Love Impact" ({D}, `60+`, **+120**, index 0 of TWO) at 1 legal printing: ONE new `BoardCondition` member (`yourBenchHasNameContaining { fragment }`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO NEW exhaustive-switch arms — a SECOND MEMBER and not a `match?:` field on `yourBenchHasNamed`, and it is the FIRST test of the rule D391 wrote down, which HELD: what changes is the comparison OPERATOR rather than a filter the delegate already takes, `conditionNote` needs a second SENTENCE rather than a second SLOT, and a member edits ZERO of `yourBenchHasNamed`'s 45 executable sites where an optional field edits THREE) // 🆕🆕 D391 +1 sentence (THE TYPED PER-BODY ENERGY THRESHOLD — Abomasnow `sv10-060` "Frozen Wood" ({W}{W}{W}{C}, `120+`, **+120**, index 1 of TWO) at 1 legal printing: ONE **OPTIONAL FIELD** (`energy?`) on the shipped `yourActiveEnergyAtLeast` member (D383), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO **edited** exhaustive-switch arms — a FIELD and NOT a second member, the OPPOSITE of D389's answer and RE-MEASURED rather than inherited: the field is OPTIONAL and edits ZERO of that member's 11 executable sites, and `countAttachedEnergy` already took exactly this filter) // 🆕🆕 D390 +1 sentence (THE OPPONENT-SEAT TYPE READ — Electivire `sv05-054` "Short-Circuit Knuckle" ({C}{C}, `40+`, **+120**) at 1 legal printing: ONE PARAMETERISED `BoardCondition` member (`opponentInPlayHasType { type }`), ONE anchored TEMPLATE reusing `CLAUSE_POKEMON_TYPES` whole and TWO exhaustive-switch arms — the family's FIFTH template pattern, and the first shipped behind a CROSS-PRODUCT anchor rung written at the PREVIOUS head) // 🆕🆕 D389 +1 sentence (THE OPPONENT-SEAT BENCH COUNT — Iron Crown `sv08-132` "Deleting Slash" ({M}{C}, `40+`, **+80**) at 1 legal printing: ONE PARAMETERISED `BoardCondition` member (`opponentBenchAtLeast { count }`), ONE literal clause row and TWO exhaustive-switch arms — a SECOND MEMBER and not a seat parameter on `yourBenchAtLeast`) // 🆕🆕 D388 +1 sentence (THE RETREAT-COST THRESHOLD — Talonflame `sv07-123` "Aero Chase" ({C}{C}, `110+`, **+110**) at 1 legal printing: ONE PARAMETERISED `BoardCondition` member (`opponentActiveRetreatCostAtLeast { count }`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO exhaustive-switch arms — ZERO new card predicates, because the printed noun phrase names `effectiveRetreatCost` (continuous.ts, D322) and not the printed `retreatCostOf` column, which is the SHAPE question D387 left open and this slice settled) // 🆕🆕 D387 +1 sentence (THE STAGE 1 CLAUSE — Paldean Tauros `sv08-018` "Spirited Tackle" ({R}{C}{C}, `90+`, **+90**) at 1 legal printing: ONE `cards.ts` predicate, ONE `BoardCondition` member (`opponentActiveIsStage1`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO exhaustive-switch arms) 🆕🆕 D433 +1 sentence / +3 printings (THE DEVOLUTION SWEEP — *"Devolve each of your opponent's evolved Pokémon by shuffling the highest Stage Evolution card on it into your opponent's deck."*, corpus row 88, **1 sentence / 3 legal printings**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `DEVOLVE_EACH_TO_DECK` and ONE new field-free `EffectOp` `devolveEach`. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at 13 (the arm is inside `deriveAttackEffect`, not a fourteenth reader), and `SPLIT_ATTACK_UNITS`, `COMPOUND_ATTACK_UNITS` and `REGISTRY_ATTACK_UNITS` were RE-MEASURED UNMOVED after the anchor landed rather than assumed, D424's rule. ⚠️ AND NO COMPOUND COMPOSES: the sentence is ONE clause with no `. ` joiner in it at all, so `splitAttackTrailingClause` never sees a tail — D426's mechanism, at the degenerate end.)
    expect(units(resolved)).toBe(1480); // 🆕🆕🆕 D448 +3 printings (A COUNT SOURCE ON THE SNIPE'S OWN AMOUNT — *"This attack does {20|30} damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. (Don't apply …)"* (corpus lines 552 and 570), **2 sentences / 3 legal printings**, claimed WHOLE by `deriveAttackEffect`'s arm 6d through ONE widening of the SHIPPED anchor `CHOSEN_ANY_TARGET` — an optional count clause taking group 3, which SHIFTED `ignoreWR` to 4 and the number word to 5, D447's index trap — over ONE new OPTIONAL `damageChosen` field `perEnergyOnSelf`. **ZERO new anchors, ZERO new readers, ZERO new ops, ZERO new `DamageCountSource` members, ZERO new `CardFilter` members, prompt kinds, choice kinds, `route` values, events, error codes, `GameState` fields, registry rows, `packages/schema` bytes or `redact.ts` bytes.** `MATCH_RECORD_VERSION` **STAYS 29** — the op PARKS, so its literal really is persisted at `phase.cont.pendingOp`, but a NEW OPTIONAL KEY whose ABSENCE means what it always meant is D125's widening and not D359's rename; driven over the SERIALIZED BYTES in three directions in `scaledAnySnipe.test.ts` §3. 🛑 **THE WORK ORDER'S PREMISE FAILED AND IS CORRECTED IN PLACE (D442): the snipe's amount has scaled since Wo-Chien "Covetous Ivy".** `snipeAmount` (interpreter.ts) is a SECOND, PARALLEL fold — `scaledAttackDamage`'s §8.5 fold reaches the DEFENDING Active only, speaks `DamageCountSource`, lives in a module that imports the interpreter and needs a `cost` `EffectContext` does not carry — so this slice gives an EXISTING fold its second inhabitant rather than building one. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at **13** (the arm sits inside `deriveAttackEffect`), and `REGISTRY_ATTACKS` (16 units / 10 sentences), `SPLIT_ATTACK_UNITS` (13) and `COMPOUND_ATTACK_UNITS` (21) were RE-MEASURED UNMOVED after the widening rather than assumed, D424's rule. ⚠️ AND NO COMPOUND COMPOSES, MEASURED ON BOTH SIDES: each sentence's only `. ` joiner precedes the W/R parenthetical, which `deriveAttackEffect` does not claim on its own, so `splitAttackTrailingClause` refused both at its TAIL test BEFORE the widening and refuses them at the SHADOW REFUSAL after it — D426's mechanism, two different refusals and one unmoved summand.) // 🆕🆕 D447 +3 printings (THE CHOSEN BENCH SNIPE, BOTH SEATS AND BOTH WORDINGS — corpus rows 514/525 (*"This attack also does {10|40} damage to 1 of your Benched Pokémon. (Don't apply …)"*) and row 587 (*"This attack does 40 damage to 1 of your opponent's Benched Pokémon. (Don't apply …)"*), **3 sentences / 3 legal printings**, claimed by `deriveAttackEffect` arm 6c through TWO widenings of the shared `ALSO_BENCHED_SNIPE_BODY` (`(?:also )?` and a possessive CAPTURE) over ONE new `damageChosen.target` member `yourBench`. Reader SURFACE unmoved at 13.) // 🆕🆕 D446 +9 printings (THE FILTERED IN-PLAY BODY COUNT, ON BOTH SEATS — *"This attack does N damage for each of your Pokémon in play that has the Round attack."* (3 sentences / 6 legal printings, corpus rows 496/532/566) and *"This attack does 60 damage for each of your opponent's Pokémon ex [and Pokémon V] in play."* (2 / 3, rows 560/559) — **5 sentences / 9 legal printings**, all claimed by `deriveAttackDamageMultiplier` through THREE new anchors over TWO new `CardFilter` members (`attackNamePokemon` reading `cards.ts attacksOf`, `suffixPokemon` reading `pokemonSuffixOf`) — the widening D439 priced and REFUSED for its CONSUMERS. **ZERO new `DamageCountSource` members**: D439's `yourPokemonInPlay` is RENAMED `pokemonInPlay` and gains a REQUIRED `seat`, which is D440's re-derived union rule (identical payload ⇒ one member with the discriminator as a field) and NOT the `opponentPokemonInPlay` sibling D439's own executable falsifier predicted. ZERO new ops, op fields, prompt kinds, choice kinds, `route` values, events, error codes, `GameState` fields, registry rows, `packages/schema` bytes or `redact.ts` bytes. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at **13** (all three arms sit inside `deriveAttackDamageMultiplier`), and `REGISTRY_ATTACKS` / `SPLIT_ATTACK_UNITS` / `COMPOUND_ATTACK_UNITS` were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D443 +5 printings (THE OPPONENT-BOARD ENERGY MOVE — *"Move an Energy from 1 of your opponent's Pokémon to another of their Pokémon."* and *"You may move an Energy from your opponent's Active Pokémon to 1 of their Benched Pokémon."*, **2 sentences / 5 legal printings**. Claimed WHOLE by `deriveAttackEffect` through TWO new anchors over the SHIPPED `moveEnergy` op, which gained ONE optional rider, `side?: "opponent"` — the endpoints are the FREE route and `selfToBench` read off the other seat's board, so ZERO new `route` values, ZERO new ops, ZERO new prompt kinds and ZERO new `CardFilter` members. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at **13** (both arms sit inside `deriveAttackEffect`), and `REGISTRY_ATTACKS` / `SPLIT_ATTACK_UNITS` / `COMPOUND_ATTACK_UNITS` were RE-MEASURED UNMOVED rather than assumed. ⚠️ AND NO COMPOUND COMPOSES: neither sentence carries a `. ` joiner at all.) // 🆕🆕 D442 +3 printings (the same three sentences, one legal printing each; see the sentence literal above for the whole note). // 🆕🆕 D441 -2 printings (the same one sentence; see the sentence literal above for the whole note). // 🆕🆕 D440 +8 printings (THE FILTERED DISCARD-PILE COUNT — *"This attack does N [more] damage for each <noun> in your [opponent's] discard pile."*, **4 sentences / 8 legal printings** over four printed nouns, each mapped to a `CardFilter` member that ALREADY EXISTED: `Energy card`→`anyEnergy`, `Basic Energy card`→`basicEnergy` (UNTYPED — the printed noun names no type), `Item card`→`item`, `Ethan's Adventure card`→`byName`. Claimed WHOLE by `deriveAttackDamageBonus` (2 sentences / 4 printings) and `deriveAttackDamageMultiplier` (2 / 4) through TWO new anchors (`DISCARD_PILE_COUNT_SCALE`, `DISCARD_PILE_COUNT_MULTIPLY`) and the `discardPileFilter` vocabulary, feeding the SIXTEENTH `DamageCountSource` member `cardsInDiscardPile` and ONE `scaledAttackDamage` arm. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at **13** (both arms sit inside existing readers, not a fourteenth). **ZERO new `CardFilter` members**, which is what keeps `retrieveNoun`'s switch and `BENCHABLE_RETRIEVAL_KINDS` out of this slice. `REGISTRY_ATTACKS` (16 units), `SPLIT_ATTACK_UNITS` (13) and `COMPOUND_ATTACK_UNITS` (21) were RE-MEASURED UNMOVED after the anchors landed rather than assumed, D424's rule — their derivation rungs in `censusAtHead.test.ts` stayed green. ⚠️ AND NO COMPOUND COMPOSES, MEASURED ON ALL FOUR SPLITTERS AND ON BOTH SIDES: none of the four claimed sentences holds a `. ` joiner at all, so every splitter returns null before and after — D426's mechanism at the degenerate end. ⚠️ TWO ANCHOR-REACHABLE SENTENCES ARE LEFT LOUD FOR TWO DIFFERENT REASONS, NOT ONE REASON TWICE: `Ancient card` (2 printings) is DATA-BLOCKED — the banner is printed on the card FACE and is in no column of the persisted catalog and no field of tcgdex's card model (`types.ts`:146-149, re-read at D440) — and `Supporter card that has "Team Rocket" in its name` (2 printings) is UNBUILT, because `byName` is exact equality (`cards.ts`:518) and no `CardFilter` member matches a name SUBSTRING at any width; that one carries an EXECUTABLE falsifier pinned on the POPULATION in `discardPileScaling.test.ts` §6, which reddens the day it becomes buildable.) 🆕🆕 D439 +8 printings (BODIES IN PLAY, FILTERED — *"This attack does N damage for each of your <noun> Pokémon in play."*, **5 sentences / 8 legal printings** over five printed nouns, each mapped to a `CardFilter` member that ALREADY EXISTED: `Basic Pokémon`→`basicPokemon`, `Pokémon`→`anyPokemon`, `Team Rocket's Pokémon`→`ownerPokemon`, `{G} Pokémon`→`typedPokemon`, `Evolution Pokémon`→`evolutionPokemon`. Claimed WHOLE by `deriveAttackDamageMultiplier` (4 sentences / 6 printings) and `deriveAttackDamageBonus` (1 / 2) through TWO new anchors (`IN_PLAY_BODY_MULTIPLY`, `IN_PLAY_BODY_SCALE`) and the `inPlayBodyFilter` vocabulary, feeding the FIFTEENTH `DamageCountSource` member `yourPokemonInPlay` and ONE `scaledAttackDamage` arm. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at **13** (both arms sit inside existing readers, not a fourteenth). **ZERO new `CardFilter` members**, which is what keeps `retrieveNoun`'s switch and `BENCHABLE_RETRIEVAL_KINDS` out of this slice. `REGISTRY_ATTACKS` (16 units), `SPLIT_ATTACK_UNITS` (13) and `COMPOUND_ATTACK_UNITS` (21) were RE-MEASURED UNMOVED after the anchors landed rather than assumed, D424's rule. ⚠️ AND NO COMPOUND COMPOSES, MEASURED ON BOTH SIDES: the family's one compound — *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, 2 legal — splits THREE ways on `COMPOUND_CLAUSE_BREAK`, so its TAIL is the parenthetical reminder, which `deriveAttackEffect` refuses; `splitAttackTrailingClause` therefore returns null on its FIRST guard and never consults the head, before AND after this slice — D426's mechanism at the three-way end. ⚠️ TWO ANCHOR-REACHABLE SENTENCES ARE LEFT LOUD AND FOR TWO DIFFERENT REASONS, NOT ONE REASON TWICE: `Ancient Pokémon` (2 printings) is DATA-BLOCKED — the banner is in no catalog column and no tcgdex field, re-read at D439 against `PREVENT_DAMAGE_FROM_CLASS`'s permanently-stated refusal — while `Stage 1 Pokémon` (1 printing) is merely UNBUILT, needing a `CardFilter` member that reads a printed stage ORDINAL. The three opponent-side rows are refused by the anchors' `(?!opponent)` lookahead and priced on their filter, not their side.) 🆕🆕 D438 +3 printings (THE RETREAT-COST PENALTY — *"This attack does {30|50} less damage for each {C} in your opponent's Active Pokémon's Retreat Cost."*, corpus rows 573/603, **2 sentences / 3 legal printings** that differ at exactly ONE character position (the `3` vs the `5`, index 17 zero-based — DIFFED, not eyeballed), claimed WHOLE by `deriveAttackDamagePenalty` through ONE new anchor `RETREAT_COST_PENALTY` and ONE `if`. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at **13** (the arm sits inside an existing reader, not a fourteenth), and the count source it names — `opponentActiveRetreatCost` — plus its `scaledAttackDamage` arm have both shipped since D110, so no union member and no evaluator arm arrived with it. `REGISTRY_ATTACKS` (12 units), `SPLIT_ATTACK_UNITS` (13) and `COMPOUND_ATTACK_UNITS` (21) were RE-MEASURED UNMOVED after the anchor landed rather than assumed, D424's rule. ⚠️ AND NO COMPOUND COMPOSES, MEASURED ON BOTH SIDES: each sentence holds **zero** `. ` joiners, so `splitAttackTrailingClause` and `splitAttackGateClause` both return null on it before AND after the widening — D426's mechanism at the degenerate end.) 🆕🆕 D437 +3 printings (THE FILTERED BENCH SNIPE — *"This attack also does 60 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, corpus row 528, **1 sentence / 3 legal printings**, claimed WHOLE by `deriveAttackEffect` through the SHARED fragment `ALSO_BENCHED_SNIPE_BODY` gaining a THIRD capture and ONE optional op field `damageChosen.damagedOnly`. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at 13 (the arm is inside `deriveAttackEffect`, not a fourteenth reader) and `REGISTRY_ATTACK_UNITS`, `SPLIT_ATTACK_UNITS` and `COMPOUND_ATTACK_UNITS` were RE-MEASURED UNMOVED after the widening rather than assumed, D424's rule. ⚠️ AND NO COMPOUND COMPOSES, MEASURED ON BOTH SIDES OF THE WIDENING: at D436's head `splitAttackTrailingClause` refused this sentence at its TAIL test — the only `. ` joiner in it precedes the W/R parenthetical, and `deriveAttackEffect` does not claim *"(Don't apply Weakness and Resistance for Benched Pokémon.)"* on its own — and after the widening it refuses at the SHADOW REFUSAL one line earlier, because a string a reader claims whole never reaches composition. Two different refusals, one unmoved summand: the printing arrives through the anchor and `COMPOUND_ATTACK_UNITS` stands still, D426's mechanism.) // 🆕🆕 D436 +5 printings (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D435 +1 printing (THE DELAYED FAMILY CLOSED — the DISCARD payload, corpus row 53, *"At the end of your opponent's next turn, discard the Defending Pokémon and all attached cards."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `DELAYED_DEFENDER_DISCARD` and ONE new field-free `EffectOp` `scheduleDiscard`. ⚠️ THE FAMILY'S THIRD PAYLOAD (corpus row 113, 2 printings) LANDED IN THE SAME SLICE AND IS **NOT** IN THIS TERM: it is a COMPOUND, refused by every whole-sentence reader by construction, and it arrives through `splitAttackTrailingClause` — so this instrument steps by 1 where `BUILT.attack` steps by 3, which is the reader-vs-compound split stated rather than left to be inferred from the size of the step.) 🆕🆕 D434 +3 printings (THE DELAYED COUNTER PLACEMENT — *"At the end of your opponent's next turn, put 9 damage counters on the Defending Pokémon."*, corpus row 54, **1 sentence / 3 legal printings**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `DELAYED_DEFENDER_COUNTERS` and ONE new `EffectOp` `scheduleCounters`. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at 13 (the arm is inside `deriveAttackEffect`, not a fourteenth reader), and `SPLIT_ATTACK_UNITS`, `COMPOUND_ATTACK_UNITS` and `REGISTRY_ATTACK_UNITS` were RE-MEASURED UNMOVED after the anchor landed rather than assumed, D424's rule. ⚠️ AND NOTHING COMPOSES, MEASURED: corpus row 113 carries the same clock behind a head `deriveAttackEffect` already claims, but `splitAttackTrailingClause` refuses it because its TAIL — the family's KNOCK-OUT payload — is claimed by no reader, which is D426's mechanism read from the other end.) 🆕🆕 D432 +3 printings (THE INSTALLED NO-WEAKNESS BAR — *"During your opponent's next turn, this Pokémon has no Weakness."*, corpus row 192, **1 sentence / 3 legal printings**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `SELF_NO_WEAKNESS` and ONE new field-free `EffectOp` `removeWeakness`. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at 13 (the arm is inside `deriveAttackEffect`, not a fourteenth reader), and `SPLIT_ATTACK_UNITS`, `COMPOUND_ATTACK_UNITS` and `REGISTRY_ATTACK_UNITS` were RE-MEASURED UNMOVED after the anchor landed rather than assumed, D424's rule. ⚠️ AND NO COMPOUND COMPOSES: the sentence is ONE clause with no `. ` joiner in it at all, so `splitAttackTrailingClause` never sees a tail — D426's mechanism, at the degenerate end.) 🆕🆕 D431 +3 printings (THE PRIZE TAKEN WITHOUT A KNOCK OUT — *"Discard all Energy from this Pokémon, and take a Prize card."*, corpus row 108, **1 sentence / 3 legal printings**, claimed WHOLE by `deriveAttackEffect` through ONE new compound anchor `SELF_DISCARD_ALL_THEN_TAKE_PRIZE` and ONE new field-free `EffectOp` `takePrize`. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at 13 (the arm is inside `deriveAttackEffect`, not a fourteenth reader), and `SPLIT_ATTACK_UNITS`, `COMPOUND_ATTACK_UNITS` and `REGISTRY_ATTACK_UNITS` were RE-MEASURED UNMOVED after the anchor landed rather than assumed, D424's rule. ⚠️ AND THE COMPOUND COMPOSED NOTHING: `splitAttackTrailingClause` refuses this string twice over — the joiner is ", and" rather than ". ", and the tail *"take a Prize card."* is claimed by no reader — so the sentence arrives through the anchor and NOT through the splitter, which is why `COMPOUND_ATTACK_UNITS` does not move, D426's mechanism.) 🆕🆕 D429 +3 sentences / +3 printings (THE REST OF THE PRE-DAMAGE FAMILY — corpus rows 71, 72 and 74, *"…discard all Pokémon Tools and Special Energy from your opponent's Active Pokémon."*, *"…discard all Pokémon Tools from this Pokémon. If you can't discard any, this attack does nothing."* and *"…If you discarded a Pokémon Tool in this way, your opponent's Active Pokémon is now Paralyzed."*, **1 legal printing each**, measured over the `legal_standard = 1` attack column this corpus IS (640 sentences / 1,732 printings). All three claimed WHOLE by the SAME reader `deriveAttackPreDamage`, which gained three ANCHORS and three union members and no new instrument — so the ATTACK READER SURFACE STANDS STILL AT 13 and the step arrives through the RAW summand ALONE. ⚠️ `SPLIT_ATTACK_UNITS` (14), `COMPOUND_ATTACK_UNITS` (19) and `REGISTRY_ATTACK_UNITS` (16) were RE-MEASURED after the anchors landed rather than assumed (D424): all three unmoved.) 🆕🆕 D428 +1 sentence / +5 printings (THE PRE-DAMAGE TOOL DISCARD — *"Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon."* (**5 legal printings** on ONE sentence, corpus line 73), measured over the `legal_standard = 1` attack column this corpus IS (640 sentences / 1,732 printings). ONE new WHOLE-SENTENCE READER — `deriveAttackPreDamage`, the THIRTEENTH — and NOT an arm inside `deriveAttackEffect`, so the reader SURFACE moves 12 → 13 as well as the resolution figures. 🛑 THE SHAPE IS NOT AN `EffectOp`, and D125's rule is only half the reason: the printed act precedes damage and an effect program runs at `attack.ts`'s TAIL — and, the half D125 never faced, an `EffectOp[]` at a pre-damage call site could PARK, which §8.5 has no continuation for. The carrier is a closed `AttackPreDamage` union applied by a TOTAL function returning `GameState`, so the park is forbidden BY THE SIGNATURE rather than by a hand-kept list of safe ops (D222). ⚠️ A PREFIX STRIPPER ON THE SHARED HEAD `Before doing damage, ` WAS PRICED AND REFUSED WITH THE MEASUREMENT: over all 640 sentences FOUR open with that head and ZERO of the four remainders is claimed by any of the twelve readers, as printed OR re-capitalised — it buys nothing today and every sibling still needs its own arm. ⚠️ `SPLIT_ATTACK_UNITS` (14), `COMPOUND_ATTACK_UNITS` (19) and `REGISTRY_ATTACK_UNITS` (16) ALL STAND STILL, measured AFTER the reader landed rather than assumed (D424 gained a printing exactly this way): the one COMPOUND whose head this reader claims carries a TAIL `deriveAttackEffect` refuses.)  🆕🆕 D427 +1 sentence / +6 printings (HEAL SELF BY THE DAMAGE THIS ATTACK DEALT — *"Heal from this Pokémon the same amount of damage you did to your opponent's Active Pokémon."* (**6 legal printings** on ONE sentence), measured over the `legal_standard = 1` attack column this corpus IS (640 sentences / 1,732 printings). ONE new anchor and ONE new arm in `deriveAttackEffect` over the SHIPPED `heal` op, whose `amount` went `number` → `number | "dealt"`. 🛑 A LITERAL AND NOT A TEMPLATE: the loosest plausible family grep `/same amount of damage|damage you did|amount of damage/i` over all 640 sentences returns EXACTLY this row, so D121's two-printings-with-one-token-varying warrant is UNMET and any capture group would be a template over a population of one (D190b). ⚠️ THE CARRIER IS `EffectContext.dealt?: number` AND NOT `EffectRecord`, and the first reason is the VALUE TYPE rather than the meaning: every `EffectSlot` this engine files is a LIST OF CARD UIDS and this is an HP FIGURE, so the record has no slot for it and no widening that keeps its value type (D406 priced exactly that one slice before declining the sentence). ⚠️ `MATCH_RECORD_VERSION` STAYS 26 THOUGH THE CARRIER IS PERSISTED — `ctx` rides `EffectContinuation` into `phase.cont` exactly as `record` does, and an OPTIONAL key there is D125's WIDENING, `invokedBy` verbatim; the `heal.amount` union gained an INHABITANT, which is the same rule one address over. Driven both directions on a real park in `selfHealDealt.test.ts`, not asserted. ⚠️ `SPLIT_ATTACK_UNITS` AND `COMPOUND_ATTACK_UNITS` DO NOT MOVE, MEASURED AFTER THE ARM LANDED rather than assumed (D424 gained a printing exactly this way): the sentence occurs once in the column with no compound sibling, and `splitAttackTrailingClause` needs a TAIL this arm does not make readable.)  🆕🆕 D426 +2 sentences / +6 printings (THE OPPONENT-CHOOSES HAND DISCARD — *"Your opponent discards 2 cards from their hand."* (**4 legal printings**) and *"Your opponent discards a card from their hand."* (**2**) — **2 sentences / 6 printings**, measured over the `legal_standard = 1` attack column this corpus IS (640 sentences / 1,732 printings). ONE new anchor and ONE new arm over ONE new `EffectOp`: the anchor is an ALTERNATION over the printed count (`(?:(\d+) cards|a card)`) whose absent group is the ARTICLE, so both printed spellings are one template and the singular resolves to 1 rather than to a default. 🛑 THE MECHANISM THE SENTENCE DOES NOT ADVERTISE: this is the FIRST park in the engine whose ANSWERER is the non-controller AND whose candidates are HIDDEN card identities — the `decider` route (M5, Ortega) crosses the hidden-candidate `chooseCards` resolution here for the first time — so `redactedPromptOf`'s answerer gate is what keeps the ATTACKER from receiving a face-up list of the DEFENDER's hand and answering it; driven from both chairs, on the whole snapshot rather than on the prompt field. ⚠️ `COMPOUND_ATTACK_UNITS` DOES NOT MOVE, and that was MEASURED AFTER THE ARM LANDED rather than assumed (D424 gained a printing exactly this way): both related compounds stay refused, because `splitAttackTrailingClause` needs the TAIL claimed by `deriveAttackEffect` and this slice made a HEAD readable. ⚠️ `MATCH_RECORD_VERSION` STAYS 26 THOUGH THIS OP PARKS — it reaches `phase.cont.pendingOp`, the one persisted address an `EffectOp` is written at, and a NEW UNION INHABITANT is still D125's widening there; driven both directions.)  🆕🆕 D425 +3 sentences / +5 printings (THE OWN-SIDE BENCH-WIDE SPREAD — *"This attack also does {N} damage to each of YOUR Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, measured over the `legal_standard = 1` attack column this corpus IS (640 sentences / 1,732 printings): **3 sentences / 5 printings** — 10 (**3 printings**), 20 (**1**), 30 (**1**). Claimed by ZERO new anchors and ZERO new readers: `SPREAD_EACH_BENCH` already held the opponent-side twin and its possessive became a CAPTURE, so the arm returns the shipped `spreadDamage` op with `target` read off group 2. The op's `target` was a SINGLETON `"opponentBench"` and is now `"opponentBench" | "yourBench"`, which is a WIDENING — `MATCH_RECORD_VERSION` STAYS 26, driven both directions. 🛑 THE MECHANISM THE SENTENCE DOES NOT ADVERTISE: an attack's own damage can now Knock Out its USER's own benched Pokémon and §8.1 owes that Prize to the OPPONENT. The engine needed no new code for it — `finishAttack` already sweeps [defender, attacker] and each Knock Out's Prize already goes to `otherSeat(ref.seat)` — and all of it is DRIVEN in `ownBenchSpread.test.ts` rather than inherited. ⚠️ WHAT DID NEED A MECHANISM WAS THE LOG: `DAMAGE_DEALT` gained a REQUIRED `by: Seat`, because `log.ts` derived the dealer as `otherSeat(event.seat)` and this is the first row where those two seats are the SAME — the row credited the DEFENDER with damage the ATTACKER did to its own Bench. Events are transient and never persisted, so that field moves no version either.)  🆕🆕 D424 +3 sentences / +5 printings (THE TWO-STATUS PAIR — *"Your opponent's Active Pokémon is now {X} and {Y}."* and its coin-flipped twin, measured over the `legal_standard = 1` attack column this corpus IS (640 sentences / 1,732 printings): Burned+Confused (**3 printings**), and behind a coin flip Confused+Poisoned (**1**) and Paralyzed+Poisoned (**1**) — 3 sentences / 5 printings, claimed by TWO new anchors (`DEFENDER_STATUS_PAIR`, `FLIP_DEFENDER_STATUS_PAIR`) and ONE shared helper `defenderStatusPair` in `deriveAttackEffect`, whose program is TWO `applyStatus` ops in PRINTED ORDER — Dangerous Laser `sv06.5-058`'s already-shipped registry program reached from the attack side, cited rather than reinvented. 🛑 THE PAIR IS REFUSED WHEN BOTH WORDS SHARE A `SpecialConditions` FIELD: Asleep/Paralyzed/Confused are three values of ONE `rotation` slot, so a pair of them would resolve with the second op silently overwriting the first — a lie that resolves. ZERO of the 1,732 printings carry such a pair (pinned on the POPULATION in `defenderStatusPair.test.ts`, per D423's rule, not on a specimen string), so that arm is driven synthetically and says so. ⚠️ A FOURTH PRINTING COMPOSES FOR FREE AND ITS STEP LANDS ELSEWHERE: `splitAttackTrailingClause` now takes *"…is now Confused and Poisoned. Switch this Pokémon with 1 of your Benched Pokémon."* because its HEAD is newly claimed and its tail was already D189's, so the TRAILING split moves 9 → 10 sentences / 18 → 19 printings while this summand does not see it. And the two flip sentences are multi-clause AND newly claimed whole, which steps the shadow-refusal census 153 → 155.) 🆕🆕 D423 +1 sentence / +3 printings (THE OPPONENT-SIDE DAMAGE-COUNTER MULTIPLIER — *"This attack does 20 damage for each damage counter on your opponent's Active Pokémon."*, **3 legal printings** on TWO cards — Glalie `sv06-052` and Flapple `sv08-139`/`sv08-210`, the third being Flapple's Illustration Rare — claimed by ONE anchor `OPPONENT_COUNTER_MULTIPLY` and ONE `if` in `deriveAttackDamageMultiplier`, on the `DamageCountSource` member D168 already shipped, so the step arrives through the RAW summand ALONE and `SPLIT_ATTACK_UNITS` (13), `COMPOUND_ATTACK_UNITS` (18) and `REGISTRY_ATTACK_UNITS` (16) ALL stand still. 🛑 IT IS A CORRECTION TO AN ABSENCE PINNED IN ERROR — D168 declared this spelling unprinted off a LOCAL SIX-SET sweep and both cards are `sv06`/`sv08`, sets that catalog has never held.) // 🆕🆕 D422 +1 sentence / +3 printings (THE OPTIONAL SELF-SWITCH — *"You may switch this Pokémon with 1 of your Benched Pokémon."* (**3 legal printings**), the family's LAST unbuilt sentence and the third member of a family D181 opened and D189 half-closed, claimed WHOLE by ONE new `deriveAttackEffect` arm returning `[{ op: "optional", note, then: [{ op: "switchActive" }] }]` — both ops shipped, ZERO new vocabulary. 🛑 THE RAW SUMMAND'S STEP AND NO OTHER'S, MEASURED RATHER THAN ASSERTED: the sentence carries no leading gate clause so `SPLIT_ATTACK_UNITS` stands still at 13; it is never a compound TAIL in this column (a live probe re-ran `splitAttackTrailingClause` over all 640 sentences AFTER the arm landed and the admitted set is UNCHANGED at 9 sentences / 18 printings) so `COMPOUND_ATTACK_UNITS` stands still at 18; and the slice authors no registry row so `REGISTRY_ATTACK_UNITS` stands still at 16. ⚠️ AND `clauseApostrophe.test.ts` STANDS STILL AT 141 TOO — this sentence carries NO apostrophe of either class (measured on the bytes: it names *this Pokémon* and *your* Bench, so there is no possessive and no contraction), and a census keyed on a CHARACTER cannot see a sentence that carries none however derivable it becomes. The engine version moves 0.323.0 → 0.324.0 and `MATCH_RECORD_VERSION` STAYS 26, DRIVEN in both directions in `optionalSelfSwitch.test.ts` §8 by round-tripping BOTH parks through JSON and comparing their key sets against parks THIS build writes for two SHIPPED sentences.) // 🆕🆕 D421 +1 sentence / +5 printings (THE UNTIL-IT-LEAVES-ACTIVE BAR — *"This Pokémon can't use Blaze Blitz again until it leaves the Active Spot."*, Gouging Fire ex `sv05-038`/`-188`/`-204`/`-214` and `svp-144`: ONE card in five rarities, so ONE sentence and FIVE printings. Claimed WHOLE by `deriveAttackEffect` arm 24a-ii as a LITERAL ROW over a WIDENED `preventAttackUse`, so the step arrives through the RAW summand ALONE and `SPLIT_ATTACK_UNITS` 13, `COMPOUND_ATTACK_UNITS` 18 and `REGISTRY_ATTACK_UNITS` 16 all stand still.) // 🆕🆕 D420 +3 sentences / +4 printings (THE HAND-ENERGY COST FAMILY — *"Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing."* (**2 legal printings**), *"Discard 2 Basic {G} Energy cards from your hand. If you can't discard 2 cards in this way, this attack does nothing."* (**1**) and *"Discard a Basic {G} Energy card from your hand. If you can't, this attack does nothing."* (**1**) — the six-Energy KO is EXACTLY the sentence D415's correction named as the KO residue NOTHING IN THIS REPO COULD BUILD, needing a hand-Energy COST and a does-nothing CANCEL rather than the park or the gate the other two residue members took; the other two printings charge the SAME cost, so all three are built TOGETHER rather than one at a time. Each is claimed WHOLE by ONE reader — `deriveAttackCancelRequirement`, whose `ATTACK_CANCEL_TRAILING` head list is WIDENED past D417's Stadium-only head — over TWO new `deriveAttackEffect` arms: 6f the bare cost, 6g the cost joined to a Knock Out by `", and "`, a COMMA join inside ONE sentence that `splitAttackTrailingClause`'s sentence-boundary `BREAK` cannot reach, which is why the compound needs an arm of its own rather than the composition path. 🛑 THE WHOLE DELTA ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER: a sentence claimed whole is RAW rather than split or compound, so `SPLIT_ATTACK_UNITS` stands still at 13 (the splitter finds no leading gate clause on any of the three), `COMPOUND_ATTACK_UNITS` at 18 (that term only ever counts what the whole-sentence anchors REFUSE, and these three are now claimed) and `REGISTRY_ATTACK_UNITS` at 16, the slice authoring no row. The engine version moves 0.321.0 → 0.322.0 and `MATCH_RECORD_VERSION` STAYS 26 — the cost pays through the SHIPPED `payFromHand` op and adds NO persisted field. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE DIFFERENT NUMBERS ON THE SAME ROW — 3 and 4, where D417's were 1 and 1 — the six-Energy KO printing on TWO ids and the other two on one each.) — 🆕🆕 D418 1363 → 1364, the same +1 (Eternatus `sv08-141`, one printing) — 🆕🆕 D416 +2 sentences / +6 printings (THE PARKING KO PAIR — *"Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon."* (**4 legal printings**) and *"Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it."* (**2 legal printings**) — EXACTLY the two sentences D415 named as the residue that still needed a PARK, and they are built TOGETHER rather than one at a time because they are ONE op with two riders: ONE new PARKING `EffectOp` (`knockOutChosen`, REQUIRED `target: "opponentBench" | "opponentAny"` plus optional `basicOnly` / `damageCountersExactly`), reached through the EXISTING `choosePokemon` prompt and the EXISTING `KNOCKED_OUT` sweep. The op PARKS on `phase.cont.pendingOp` but adds ZERO persisted RECORD fields, so `MATCH_RECORD_VERSION` STAYS 26 (D307's paragraph: no v26 deploy can author `{ op: "knockOutChosen", … }` into a record THIS deploy reads) while the engine version moves 0.319.0 → 0.320.0. 🛑 THE WHOLE DELTA ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER: both sentences are claimed WHOLE by `deriveAttackEffect` (arms 6d and 6e), and a sentence resolved whole is RAW rather than split or compound, so `SPLIT_ATTACK_UNITS` stands still at 13 (the splitter finds no leading gate clause on either), `COMPOUND_ATTACK_UNITS` at 18 (that summand only ever counts what the whole-sentence anchors REFUSE, and these two are now claimed) and `REGISTRY_ATTACK_UNITS` at 16, the slice authoring no row. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE DIFFERENT NUMBERS ON THE SAME ROW — 2 and 6 — the flip sentence printing on FOUR ids and the counter-window sentence on TWO, where D415's were 1 and 1. ⚠️ AND EXACTLY ONE OF THE TWO JOINS `compoundCompose` §4's SHADOW-REFUSAL POPULATION, where D415's single sentence joined nothing: the flip sentence carries TWO `BREAK` boundaries (`Flip a coin.` ‖ `If heads, …` ‖ `If tails, …`) so it is THREE clauses, has always sat in the 271 multi-clause corpus, and is now claimed whole — 148 → **149** sentences / 421 → **425** printings; the counter-window sentence has no internal break at all, so it is ONE clause and was never in the 271. The `multiClause` pair 271 / 613 STANDS STILL, because both sentences were always IN the corpus and this slice changed only the CLAIM.) 🆕🆕 D415 +1 sentence / +1 printing (THE OPPONENT-SCOPED SPECIAL-ENERGY KO GATE — *"If your opponent's Active Pokémon has any Special Energy attached, it is Knocked Out."* — Haxorus `sv06.5-046`, **1 legal printing** — claimed WHOLE by `deriveAttackEffect` as ARM 6a WITH THE `cond` SWAPPED AND NOTHING ELSE: the same `conditionGate` over the same shipped FIELD-FREE `knockOutDefender` op D414 built, behind ONE new `BoardCondition` member `opponentActiveHasEnergyAttached` — the SEAT MIRROR of the shipped `yourActiveHasEnergyAttached`, same `energy` parameter, same `hasAttachedEnergy` predicate, one seat over. ZERO new readers, ZERO new effect fields and ZERO registry rows, so `MATCH_RECORD_VERSION` STAYS 26 while the engine version moves 0.318.0 → 0.319.0. 🛑 THE WHOLE DELTA ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER: the sentence is resolved WHOLE, and a sentence resolved whole is RAW rather than split or compound, so `SPLIT_ATTACK_UNITS` stands still at 13, `COMPOUND_ATTACK_UNITS` at 18 and `REGISTRY_ATTACK_UNITS` at 16. ⚠️ AND IT DOES NOT JOIN `compoundCompose` §4's SHADOW-REFUSAL POPULATION EITHER — it breaks on a COMMA and not on a sentence boundary, so it is ONE clause and was never among the 271 multi-clause sentences that rung counts; 148 / 421 STANDS STILL where D414's third sentence moved it. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE THE SAME NUMBER HERE — 1 and 1 — where D414's were 3 and 4.) 🆕🆕 D414 +3 sentences / +4 printings (THE KNOCK OUT THAT REACHES THE OTHER SIDE OF THE TABLE — *"If your opponent's Active Pokémon is a Basic Pokémon, it is Knocked Out."* (2), *"Both Active Pokémon are Knocked Out."* (1) and *"This Pokémon does 100 damage to itself. Flip a coin. If heads, your opponent's Active Pokémon is Knocked Out."* (1) — THREE whole-sentence anchors and THREE `deriveAttackEffect` arms over ONE new FIELD-FREE op (`knockOutDefender`), whose both-Actives spelling is a COMPOSITION of two shipped field-free ops rather than a `target` field, so no persisted union gains a member and `MATCH_RECORD_VERSION` STAYS 26. 🛑 THE WHOLE DELTA ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER, WHICH IS THE POINT: a reader claims each of the three sentences WHOLE, and a sentence resolved whole is RAW rather than split or compound. So `SPLIT_ATTACK_UNITS` stands still at 13 (the splitter finds no leading gate clause on any of the three), `COMPOUND_ATTACK_UNITS` stands still at 18 (the fourth summand only ever counts what the whole-sentence anchors REFUSE, and these three are now claimed), and `REGISTRY_ATTACK_UNITS` stands still at 16, the slice authoring no row. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE DIFFERENT NUMBERS ON THE SAME ROW — 3 and 4 — the Basic-gate sentence printing on TWO ids and the other two on one each. ⚠️ AND IT IS THE KO-WITHOUT-DAMAGE **SUBSET**: the printed family is SEVEN sentences / THIRTEEN printings and this slice takes exactly the four whose targets are NAMED by the printed text, the other three each needing a PARK over a filtered candidate set. 🛑 **THAT LAST CLAUSE WAS WRONG THREE WAYS AND IS CORRECTED IN PLACE BY D415 — NOT SILENTLY REWRITTEN: the original wording is left standing immediately above so the correction reads as one, per the family's standing rule that a witness moves rather than disappears.** (i) THE RESIDUE WAS FOUR SENTENCES / NINE PRINTINGS, NOT THREE — 4 + 4 sentences is the 7 this note counts, and 9 + 4 printings is the 13. (ii) THEY DID NOT "EACH" NEED A PARK, and "whose targets are NAMED" was never the discriminator that separated them: two of the four residue sentences name their targets in printed words as plainly as the three D414 took. What D414 actually took were the sentences needing NO vocabulary beyond the op and a shipped `BoardCondition`. **D415 then built a fourth on exactly those terms and needed no park at all** — *"If your opponent's Active Pokémon has any Special Energy attached, it is Knocked Out."* (Haxorus `sv06.5-046`, 1 printing), arm `6a` with the `cond` swapped and nothing else, over `opponentActiveHasEnergyAttached`: the SEAT MIRROR of the shipped `yourActiveHasEnergyAttached`, same `energy` parameter, same `hasAttachedEnergy` predicate, one seat over. ⚠️ SO THE RESIDUE AT HEAD IS THREE SENTENCES / EIGHT PRINTINGS, AND ONLY TWO OF THEM NEED A PARK: *"Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it."* (2) and *"Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon."* (4). The third is the HAND-ENERGY KO at `censusAttackCorpus.ts` line 93 — *"Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing."* (2) — which needs a hand-Energy COST and an *"If you can't …, this attack does nothing."* CANCEL, a different mechanism from both the park and the gate, and **NOTHING IN THIS REPO NAMED IT AT ALL** until D415 put it in `knockOutDefender.test.ts`'s `UNBUILT_TEXT` as `handEnergyKo`, where it can go red. ⚠️ THIS IS ONE OF THE NINE VERBATIM COPIES OF THE UNCORRECTED NOTE THAT `censusAtHead.test.ts` NAMED (`exOnlyActive`, `precociousEvolution`, `retreatCostBonus`, `sawkRequirementSplit`, `inPlayTypeBonus`, `sameEnergyBonus`, `moreEnergyBonus`, `opponentBenchCount`, `benchNamedBonus`) — D415 swept all nine rather than leaving them to be rediscovered.) 🆕🆕 D413 +2 sentences / +5 printings (THE ADDITIVE MULTI-COIN FOLD — *"Flip 2 coins. This attack does 30 more damage for each heads."* (3) and *"…does 50 more damage for each heads."* (2), ONE anchor (`ATTACK_COIN_MULTI_BONUS`) and ONE `deriveAttackCoinFlip` arm returning D129's `bonusOnHeads` over D127's `flips: { kind: "printed", count: 2 }` — a NEW COMBINATION of an already-shipped vocabulary and therefore not a new shape (D405's rule), so ZERO new ops, fields, readers, `BoardCondition` members or registry rows and `MATCH_RECORD_VERSION` STAYS 26. A READER-keyed move arriving through the RAW summand ALONE: a reader claims each sentence WHOLE, so `splitHead` and the COMPOUND term both stand still, and `REGISTRY_ATTACK_UNITS` stands still because this slice authors no rows.) 🆕🆕 D408 +2 sentences / +7 printings (THE BARE ATTACK LOCK, BOTH SEATS — *"During your opponent's next turn, the Defending Pokémon can't attack."* (3) and *"…can't use attacks."* (4), ONE ALTERNATION anchor (`DEFENDER_CANT_ATTACK_NEXT_TURN`) and ONE `deriveAttackEffect` arm returning D148's `preventAttack { target: "defender" }` unchanged: ZERO new ops, fields, readers, `BoardCondition` members or registry rows. ⚠️ THE SLICE'S THIRD SENTENCE MOVES NOTHING — *"During your next turn, this Pokémon can't use attacks."* (4 printings) ALREADY RESOLVED, to a lock keyed on an attack no card is named, so repairing it is invisible to every census figure) 🆕🆕 D407 +4 printings (THE BOARD-WIDE OWN-ENERGY COUNT — *"…for each {G} Energy attached to all of your Pokémon."*, the `+` fold, so the printed `20+` base is KEPT and an Energy-free board still deals it) 🆕🆕 D406 +5 printings (THE COUNTED TOOL SCALER — *"This attack does 30 damage for each Pokémon Tool attached to all of your Pokémon."*, the `×` fold, so the printed `30×` base is DROPPED and a Tool-less board deals nothing) 🆕🆕 D405 +5 printings (THE MANDATORY OWN-BOARD ENERGY RETRIEVAL — *"Put an Energy attached to this Pokémon into your hand."*, ONE anchor and ONE `deriveAttackEffect` arm over an already-shipped op and an already-shipped destination) 🆕🆕 D403 +2 sentences / +8 printings (THE ADDITIVE HALF OF D402's FAMILY — *"You may discard up to 2 [Basic] Energy from your Benched Pokémon. This attack does {60|90} more damage for each card you discarded in this way."* on an ELEVENTH reader plus an exported assembler taking the printed BASE, ONE `discardEnergy.from` member (`yourBench`) and ONE OPTIONAL `damageDefender.base` field; a READER-keyed move, so no registry summand moves and `MATCH_RECORD_VERSION` stays 25) // 🆕🆕 D402 +13 printings (THE DISCARD-COUNT-SCALED ATTACK) // 🆕🆕 D401 +7 printings (THE SELF-DISCARD COST BEFORE AN ANY-TARGET SNIPE) // 🆕🆕 D400 +9 printings (THE ANY-TARGET ARITY) // 🆕🆕 D399 +5 printings (THE TWIN CONSEQUENT AND THE ARITY) // 🆕🆕 D398 +1 printing (THE DECK-SIZE READ) // 🆕🆕 D397 +1 printing (THE BENCHED-CUBONE FILTER — Marowak `sv07-073` "Bone Vengeance" ({C}{C}, `60+`, **+120**, index **1** of TWO) at 1 legal printing, READER-keyed) // 🆕🆕 D394 +2 sentences / +2 printings (THE USED-ATTACK PAIR — Falinks `sv07-088` "All-Out Attack" ({C}{C}, `30+`, **+90**, index 1 of TWO) and Weezing `sv09-092` "Crazy Blast" ({D}{C}, `50+`, **+120**, index 1 of TWO), 1 legal printing each: ONE new `BoardCondition` member (`yourActiveUsedAttackLastTurn { attack }`), ONE new REQUIRED `InPlayPokemon` field (`usedAttack`), ONE new REQUIRED field on `PendingStage.attackEpilogue`, TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and TWO new exhaustive-switch arms — the residue's LAST pair on one mechanism, the first window in the union that is not the turn in progress, and the third entry on this line to move `MATCH_RECORD_VERSION`, 24 -> 25) // 🆕🆕 D393 +2 printings (THE EVOLVE PAIR — Gholdengo `sv08-131` and Misty's Starmie `sv10-047`, one printing each, both READER-keyed) // 🆕🆕 D392 +1 printing (THE SUBSTRING NAME READ — one sentence, one printing: the 1:1 shape for a seventh slice running, and the first taken by a member whose payload field is deliberately NOT named `name`) // 🆕🆕 D391 +1 printing (THE TYPED PER-BODY ENERGY THRESHOLD — Abomasnow `sv10-060` "Frozen Wood" at 1 legal printing: an OPTIONAL FIELD on a shipped `BoardCondition` member, so the READER-keyed summand moves and no registry summand does) // 🆕🆕 D390 +1 printing (THE OPPONENT-SEAT TYPE READ — one sentence, one printing: the 1:1 shape for the fourth slice running) // 🆕🆕 D389 +1 printing (THE OPPONENT-SEAT BENCH COUNT — one sentence, one printing: the 1:1 shape for the third slice running) // 🆕🆕 D388 +1 printing (THE RETREAT-COST THRESHOLD — one sentence, one printing: the 1:1 shape, and the fold is the reading the engine had already given this noun phrase since 0.61.0) // 🆕🆕 D387 +1 printing (THE STAGE 1 CLAUSE — one sentence, one legal printing) 🆕🆕 D433 +3 units (THE DEVOLUTION SWEEP — *"Devolve each of your opponent's evolved Pokémon by shuffling the highest Stage Evolution card on it into your opponent's deck."*, corpus row 88, **1 sentence / 3 legal printings**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `DEVOLVE_EACH_TO_DECK` and ONE new field-free `EffectOp` `devolveEach`. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at 13 (the arm is inside `deriveAttackEffect`, not a fourteenth reader), and `SPLIT_ATTACK_UNITS`, `COMPOUND_ATTACK_UNITS` and `REGISTRY_ATTACK_UNITS` were RE-MEASURED UNMOVED after the anchor landed rather than assumed, D424's rule. ⚠️ AND NO COMPOUND COMPOSES: the sentence is ONE clause with no `. ` joiner in it at all, so `splitAttackTrailingClause` never sees a tail — D426's mechanism, at the degenerate end.)
    // The step, as an offset off the live head rather than a frozen pair. It is the
    // family's first 1:1 step: D368 moved 1:3, D369-D376 1:2 each, D377 3:3, D378 2:3,
    // D379 1:2, D380 2:6, D382 1:1 on the OTHER instrument and D383 1:5.
    // 🆕🆕 D387 — a `- 1` / `- 1` pair at the FRONT of both terms: the STAGE 1 CLAUSE
    // resolved ONE sentence worth ONE printing.
    // 🆕🆕 D388 — a `- 1` / `- 1` pair at the FRONT of both terms: the RETREAT-COST
    // THRESHOLD resolved ONE sentence worth ONE printing, the family's second
    // consecutive 1:1 step.
    // 🆕🆕 D389 — a `- 1` / `- 1` pair at the FRONT of both terms: the OPPONENT-SEAT
    // BENCH COUNT resolved ONE sentence worth ONE printing, the family's third
    // consecutive 1:1 step.
    // 🆕🆕 D390 — a `- 1` / `- 1` pair at the FRONT of both chains: the OPPONENT-SEAT
    // TYPE READ resolved ONE sentence worth ONE printing, the family's fourth
    // consecutive 1:1 step. ⚠️ **BOTH CHAINS ARE EDITED AT THE FRONT, NEVER AT THE END.**
    // 🆕🆕 D391 — one more `- 1` term at the FRONT of each chain: the TYPED PER-BODY
    // ENERGY THRESHOLD resolved ONE sentence worth ONE printing. ⚠️ THE CHAIN IS EDITED AT
    // THE FRONT, NEVER AT THE END.
    // 🆕🆕 D392 — one more term at the FRONT of the chain: the SUBSTRING NAME READ
    // resolved ONE sentence worth ONE printing. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
    // 🆕🆕 D401 — a `- 4` / `- 7` pair at the FRONT of the two chains: the SELF-DISCARD
    // COST BEFORE AN ANY-TARGET SNIPE resolved FOUR sentences worth SEVEN printings.
    // ⚠️ THE CHAINS ARE EDITED AT THE FRONT AND KEYED ON THE FROZEN TAIL (D397's rule).
    // 🆕🆕 D403 — a `- 2` / `- 8` pair at the FRONT of the two chains: the ADDITIVE
    // HALF OF D402's FAMILY resolved TWO sentences worth EIGHT printings.
    // ⚠️ THE CHAINS ARE EDITED AT THE FRONT AND KEYED ON THE FROZEN TAIL (D397's rule).
    // 🆕🆕 D404 — a `- 1` / `- 7` pair at the FRONT of the two chains: THE MANDATORY
    // HAND WIPE AND REFILL resolved ONE sentence worth SEVEN printings.
    // ⚠️ THE CHAINS ARE EDITED AT THE FRONT AND KEYED ON THE FROZEN TAIL (D397's rule).
    expect([
      // 🆕🆕 D397 — one more term at the FRONT of the chain: the BENCHED-CUBONE FILTER, 1 sentence / 1 printing. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
    // 🆕🆕 D398 — one more term at the FRONT of each chain: the DECK-SIZE READ, 1 sentence / 1 printing. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
      // 🆕🆕 D406 — a `- 1` / `- 5` pair at the FRONT of the two chains: THE COUNTED TOOL SCALER resolved ONE sentence worth FIVE printings. ⚠️ EDITED AT THE FRONT AND KEYED ON THE FROZEN TAIL (D397's rule).
      // 🆕🆕 D407 — a `- 1` / `- 4` pair at the FRONT of the two chains: THE BOARD-WIDE OWN-ENERGY COUNT resolved ONE sentence worth FOUR printings. ⚠️ EDITED AT THE FRONT, KEYED ON THE FROZEN TAIL (D397's rule).
      // 🆕🆕 D413 — a `- 2` / `- 5` pair at the FRONT of the two chains: THE ADDITIVE
      // MULTI-COIN FOLD resolved TWO sentences worth FIVE printings (3 at `30 more`, 2 at
      // `50 more`), through the RAW summand alone. ⚠️ THE CHAIN IS EDITED AT THE FRONT,
      // NEVER AT THE END — the frozen tail is what makes this file's own step readable
      // across another slice's move.
      // 🆕🆕 D414 — a `- 3` / `- 4` pair at the FRONT of the two chains: THE
      // KNOCK-OUT-WITHOUT-DAMAGE SUBSET resolved 3 sentences worth 4 printings —
      // *"If your opponent's Active Pokémon is a Basic Pokémon, it is Knocked Out."* (2),
      // *"Both Active Pokémon are Knocked Out."* (1) and *"This Pokémon does 100 damage to
      // itself. Flip a coin. If heads, your opponent's Active Pokémon is Knocked Out."* (1) —
      // through the RAW summand ALONE, each sentence claimed WHOLE by a `deriveAttackEffect`
      // arm over ONE new FIELD-FREE op (`knockOutDefender`), so `SPLIT_ATTACK_UNITS` (13),
      // `COMPOUND_ATTACK_UNITS` (18) and `REGISTRY_ATTACK_UNITS` (16) ALL stand still.
      // ⚠️ THE CHAIN IS EDITED AT THE FRONT, NEVER AT THE END — the frozen tail is what
      // makes this file's own step readable across eighteen other slices' moves.
      // 🆕🆕 D415 — a `- 1` term at the FRONT of each chain: THE OPPONENT-SCOPED SPECIAL-ENERGY KO GATE, ONE sentence worth ONE printing (*"If your opponent's Active Pokémon has any Special Energy attached, it is Knocked Out."*, Haxorus `sv06.5-046`), claimed WHOLE by arm 6a with the `cond` swapped and nothing else, so the step arrives through the RAW summand ALONE and `SPLIT_ATTACK_UNITS` (13), `COMPOUND_ATTACK_UNITS` (18) and `REGISTRY_ATTACK_UNITS` (16) ALL stand still. ⚠️ EDITED AT THE FRONT, NEVER AT THE END — the frozen tail is what makes this file's own step readable across the other slices' moves.
      // 🆕🆕 D416 — a `- 2` / `- 6` pair at the FRONT of each chain: THE PARKING KO PAIR, TWO sentences worth SIX printings (*"Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon."*, 4 printings, and *"Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it."*, 2) — the two sentences D415's note named as the residue that still needed a PARK, both now claimed WHOLE by `deriveAttackEffect` over ONE new PARKING op (`knockOutChosen`) that adds ZERO persisted record fields, so the step arrives through the RAW summand ALONE, `SPLIT_ATTACK_UNITS` (13), `COMPOUND_ATTACK_UNITS` (18) and `REGISTRY_ATTACK_UNITS` (16) ALL stand still and `MATCH_RECORD_VERSION` STAYS 26. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE DIFFERENT NUMBERS AGAIN — 2 and 6 — the flip sentence printing on FOUR ids and the counter-window sentence on TWO. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      // 🆕🆕 D418 — a `- 1` term at the FRONT of each chain, and the ONLY pair in
      // either that no slice ever shipped: D417's `deriveAttackCancelRequirement`,
      // live in `effects.ts` and missing from this file's `READERS` list, worth ONE
      // sentence / ONE printing — so the two chains take the SAME step. ⚠️ **THE
      // FROZEN TAIL [365, 1261] DOES NOT MOVE**: the baselines were right and only the
      // live-head term was wrong. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      // 🆕🆕 D420 — a `- 3` / `- 4` pair at the FRONT of the two chains: THE HAND-ENERGY COST FAMILY resolved THREE
      // sentences worth FOUR printings — *"Discard 6 Basic {G} Energy cards from your hand, and Knock Out your
      // opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing."* (2),
      // *"Discard 2 Basic {G} Energy cards from your hand. If you can't discard 2 cards in this way, this attack does
      // nothing."* (1) and *"Discard a Basic {G} Energy card from your hand. If you can't, this attack does nothing."*
      // (1) — all three claimed WHOLE by the WIDENED trailing-cancel anchor `deriveAttackCancelRequirement` over two
      // new `deriveAttackEffect` arms (6f, 6g), so the step arrives through the RAW summand ALONE and
      // `SPLIT_ATTACK_UNITS` (13), `COMPOUND_ATTACK_UNITS` (18) and `REGISTRY_ATTACK_UNITS` (16) ALL stand still. ⚠️
      // **THE FROZEN TAIL DOES NOT MOVE.** ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      // 🆕🆕 D421 — one more term at the FRONT of each chain: THE UNTIL-IT-LEAVES-ACTIVE BAR,
      // 1 sentence / 5 printings (Gouging Fire ex in five rarities), through the RAW summand alone.
      // ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      // 🆕🆕 D422 — one more term at the FRONT of each chain: THE OPTIONAL SELF-SWITCH,
      // 1 sentence / 3 printings (*"You may switch this Pokémon with 1 of your Benched
      // Pokémon."*), the family's LAST unbuilt printing, through the RAW summand ALONE —
      // `SPLIT_ATTACK_UNITS` (13), `COMPOUND_ATTACK_UNITS` (18) and `REGISTRY_ATTACK_UNITS`
      // (16) ALL stand still, and the compound admitted set was RE-MEASURED over all 640
      // corpus sentences AFTER the arm landed (UNCHANGED at 9 / 18) rather than assumed.
      // ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      // 🆕🆕 D424 — one more term at the FRONT of each chain: THE TWO-STATUS PAIR, 3 sentences / 5 printings
      // (*"Your opponent's Active Pokémon is now {X} and {Y}."* — Burned+Confused (3) — plus its coin-flipped
      // twin at Confused+Poisoned (1) and Paralyzed+Poisoned (1)), through the RAW summand ALONE:
      // `SPLIT_ATTACK_UNITS` (13) and `REGISTRY_ATTACK_UNITS` (16) stand still, and `COMPOUND_ATTACK_UNITS`
      // moves 18 -> 19 on a printing that is NOT in this chain (the splitter composes it; no reader claims
      // it whole). Re-measured over all 640 corpus sentences AFTER the arms landed, not assumed.
      // ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      // 🆕🆕 **D426 RESTORED THIS FROZEN TAIL AND ADDED THE TERM D425 OWED IT.** D425's own step (THE OWN-SIDE BENCH-WIDE SPREAD, 3 sentences / 5 printings) was paid by MOVING THE TAIL instead of by adding a front term — in this file, in the same commit that DID add the term to the sibling chain below, so it was a slip rather than a decision. ⚠️ **THE FROZEN TAIL IS THE WHOLE DISCRIMINATION** (D418): it does not move, and that is the proof that every historical baseline here was right and only the live head ever changed. A tail that steps with the head asserts nothing a `resolving.length` read does not already assert. So the front now carries D425's `- 3` / `- 5` AND D426's `- 2` / `- 6` — THE OPPONENT-CHOOSES HAND DISCARD, 2 sentences / 6 printings, through the RAW summand ALONE (`SPLIT_ATTACK_UNITS`, `COMPOUND_ATTACK_UNITS` and `REGISTRY_ATTACK_UNITS` all stand still, the compound set RE-MEASURED over all 640 corpus sentences AFTER the arm landed rather than assumed) — and the tail is back at its pre-D425 value. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      // 🆕🆕 **D427 — A `- 1` TERM AT THE FRONT, AND THE FROZEN ENDPOINT IS UNTOUCHED.** HEAL SELF BY THE DAMAGE THIS ATTACK DEALT — *"Heal from this Pokémon the same amount of damage you did to your opponent's Active Pokémon."*, **1 sentence / 6 legal printings** (corpus line 286), claimed WHOLE by ONE new anchor and ONE new arm in `deriveAttackEffect` over the shipped `heal` op (`amount: number | "dealt"`). `SPLIT_ATTACK_UNITS` (13), `COMPOUND_ATTACK_UNITS` (19) and `REGISTRY_ATTACK_UNITS` (16) ALL stand still — re-measured over all 640 corpus sentences AFTER the arm landed rather than assumed (D424 gained a printing exactly this way), because a sentence claimed whole is RAW and this arm makes no new TAIL readable. ⚠️ EDITED AT THE FRONT, NEVER AT THE END — and the endpoint was DIFFED AGAINST HEAD after the edit, which is D426's check for D425's slip: bumping the constant leaves `head === head`, passes review, and survives a whole mutation sweep because the assertion still holds.
      // 🆕🆕 **D428 — A `- 1` TERM AT THE FRONT, AND THE FROZEN ENDPOINT IS UNTOUCHED**
      // (D426's rule about D425: a frozen tail that moves with the head asserts
      // `head === head`, and no sweep can tell you). THE PRE-DAMAGE TOOL DISCARD —
      // *"Before doing damage, discard all Pokémon Tools from your opponent's Active
      // Pokémon."*, **1 sentence / 5 legal printings** (corpus line 73), claimed WHOLE
      // by the new THIRTEENTH reader. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      // 🆕🆕 **D429 — A `- 3` TERM AT THE FRONT, AND THE FROZEN ENDPOINT IS UNTOUCHED**
      // (D426's rule about D425). THE REST OF THE PRE-DAMAGE FAMILY — corpus rows 71, 72
      // and 74, **3 sentences / 3 legal printings**, all three claimed WHOLE by the SAME
      // reader `deriveAttackPreDamage` (surface unmoved at 13), so the step arrives
      // through the RAW summand ALONE. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      // 🆕🆕 **D431 — A `- 1` TERM AT THE FRONT, AND THE FROZEN ENDPOINT IS UNTOUCHED.**
      // THE PRIZE TAKEN WITHOUT A KNOCK OUT — *"Discard all Energy from this Pokémon, and take
      // a Prize card."*, corpus row 108, ONE sentence / **3 legal printings**, claimed WHOLE by
      // `deriveAttackEffect` through one new compound anchor. The reader SURFACE stands still at
      // 13 (an ARM, not a fourteenth reader), so the step is the RAW summand ALONE.
      // ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      // 🆕🆕 **D437 — A `- 1` TERM AT THE FRONT, AND THE FROZEN ENDPOINT IS UNTOUCHED**
      // (D426's rule about D425, diffed against `88b03a2` after the edit). THE FILTERED BENCH
      // SNIPE — corpus row 528, **1 sentence / 3 legal printings**, claimed WHOLE by
      // `deriveAttackEffect` through the shared fragment's THIRD capture, so the reader SURFACE
      // stands still at 13 and the step arrives through the RAW summand ALONE. 🛑 BOTH chains in
      // this file were stepped, not only the one that reddened (D431). ⚠️ EDITED AT THE FRONT,
      // NEVER AT THE END.
      // 🆕🆕 **D438 — A `- 2` / `- 3` PAIR AT THE FRONT OF THIS CHAIN, AND THE FROZEN ENDPOINT IS UNTOUCHED
      // (D426).** THE RETREAT-COST PENALTY — *"This attack does {30|50} less damage for each {C} in your
      // opponent's Active Pokémon's Retreat Cost."*, corpus rows 573/603, **2 sentences / 3 legal printings**,
      // claimed WHOLE by `deriveAttackDamagePenalty` through ONE anchor and ONE `if`. ⚠️ EDITED AT THE FRONT,
      // NEVER AT THE END: the right-hand side is the historical constant, and a tail that moves with the head
      // asserts `head === head`. 🛑 EVERY SIBLING CHAIN IN THIS FILE WAS STEPPED IN THE SAME PASS (D431) —
      // vitest stops at the first failing assertion in an `it`, so a green run after fixing the one that
      // reddened is evidence the runner stopped early and nothing else.
      // 🆕🆕 **D445 — A `- 3` TERM AT THE FRONT OF THIS CHAIN, AND THE FROZEN ENDPOINT IS UNTOUCHED
      // (D426).** THE OPPONENT'S HAND, COUNTED, AND WHAT HAPPENS AFTER THE REVEAL — corpus rows
      // 564, 672 and 675, **3 sentences / 6 legal printings**. Two are claimed by
      // `deriveAttackDamageMultiplier` through the seventeenth `DamageCountSource`
      // (`cardsInOpponentHand`) and one by `deriveAttackEffect` through a `dest: "discard"`
      // widening of `bottomFromOpponentHand`. ⚠️ **ROW 675 IS CLAIMED BY BOTH OF THOSE READERS —
      // the first two-reader sentence in this column — AND STILL COUNTS ONCE HERE**, which is why
      // the term is 3 and not 4. The reader SURFACE stands still at **13**, and
      // `SPLIT_ATTACK_UNITS` / `COMPOUND_ATTACK_UNITS` / `REGISTRY_ATTACK_UNITS` were RE-MEASURED
      // UNMOVED rather than assumed, so the step arrives through the RAW summand ALONE.
      // ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      resolved.length - 2 /* 🆕🆕🆕 D448 front term: A COUNT SOURCE ON THE SNIPE'S OWN AMOUNT — corpus lines 552/570, 2 sentences / 3 legal printings, claimed WHOLE by `deriveAttackEffect` arm 6d through ONE widening of the SHIPPED anchor `CHOSEN_ANY_TARGET` over ONE new optional `damageChosen` field `perEnergyOnSelf`, so the step arrives through the RAW summand ALONE and the reader SURFACE stands still at 13. EDITED AT THE FRONT, NEVER AT THE END. */ - 3 /* 🆕🆕🆕 D447 front term: the chosen bench snipe, both seats and both wordings — corpus rows 514/525/587, 3 sentences / 3 legal printings, through the RAW summand alone. EDITED AT THE FRONT, NEVER AT THE END. */ - 5 - 3 - 2 - 3 - 1 - 4 - 5 - 2 - 1 - 2 - 1 - 1 - 1 - 1 - 3 - 1 - 1 - 2 - 3 - 3 - 1 - 1 - 3 - 1 - 2 - 1 - 3 - 2 - 2 - 1 - 1 - 1 - 1 - 2 - 6 - 4 - 2 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 3,
      // 🆕🆕 D421 — one more term at the FRONT of each chain: THE UNTIL-IT-LEAVES-ACTIVE BAR,
      // 1 sentence / 5 printings (Gouging Fire ex in five rarities), through the RAW summand alone.
      // ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      // 🆕🆕 D424 — one more term at the FRONT of each chain: THE TWO-STATUS PAIR, 3 sentences / 5 printings
      // (*"Your opponent's Active Pokémon is now {X} and {Y}."* — Burned+Confused (3) — plus its coin-flipped
      // twin at Confused+Poisoned (1) and Paralyzed+Poisoned (1)), through the RAW summand ALONE:
      // `SPLIT_ATTACK_UNITS` (13) and `REGISTRY_ATTACK_UNITS` (16) stand still, and `COMPOUND_ATTACK_UNITS`
      // moves 18 -> 19 on a printing that is NOT in this chain (the splitter composes it; no reader claims
      // it whole). Re-measured over all 640 corpus sentences AFTER the arms landed, not assumed.
      // ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      // 🆕🆕 **D426 RESTORED THIS FROZEN TAIL AND ADDED THE TERM D425 OWED IT.** D425's own step (THE OWN-SIDE BENCH-WIDE SPREAD, 3 sentences / 5 printings) was paid by MOVING THE TAIL instead of by adding a front term — in this file, in the same commit that DID add the term to the sibling chain below, so it was a slip rather than a decision. ⚠️ **THE FROZEN TAIL IS THE WHOLE DISCRIMINATION** (D418): it does not move, and that is the proof that every historical baseline here was right and only the live head ever changed. A tail that steps with the head asserts nothing a `resolving.length` read does not already assert. So the front now carries D425's `- 3` / `- 5` AND D426's `- 2` / `- 6` — THE OPPONENT-CHOOSES HAND DISCARD, 2 sentences / 6 printings, through the RAW summand ALONE (`SPLIT_ATTACK_UNITS`, `COMPOUND_ATTACK_UNITS` and `REGISTRY_ATTACK_UNITS` all stand still, the compound set RE-MEASURED over all 640 corpus sentences AFTER the arm landed rather than assumed) — and the tail is back at its pre-D425 value. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      // 🆕🆕 **D427 — A `- 6` TERM AT THE FRONT, AND THE FROZEN ENDPOINT IS UNTOUCHED.** HEAL SELF BY THE DAMAGE THIS ATTACK DEALT — *"Heal from this Pokémon the same amount of damage you did to your opponent's Active Pokémon."*, **1 sentence / 6 legal printings** (corpus line 286), claimed WHOLE by ONE new anchor and ONE new arm in `deriveAttackEffect` over the shipped `heal` op (`amount: number | "dealt"`). `SPLIT_ATTACK_UNITS` (13), `COMPOUND_ATTACK_UNITS` (19) and `REGISTRY_ATTACK_UNITS` (16) ALL stand still — re-measured over all 640 corpus sentences AFTER the arm landed rather than assumed (D424 gained a printing exactly this way), because a sentence claimed whole is RAW and this arm makes no new TAIL readable. ⚠️ EDITED AT THE FRONT, NEVER AT THE END — and the endpoint was DIFFED AGAINST HEAD after the edit, which is D426's check for D425's slip: bumping the constant leaves `head === head`, passes review, and survives a whole mutation sweep because the assertion still holds.
      // 🆕🆕 **D428 — A `- 5` TERM AT THE FRONT, AND THE FROZEN ENDPOINT IS UNTOUCHED.**
      // The printing half of the same step: 5 legal printings on the ONE pre-damage
      // Tool-discard sentence. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      // 🆕🆕 **D429 — A `- 3` TERM AT THE FRONT, AND THE FROZEN ENDPOINT IS UNTOUCHED**
      // (D426's rule about D425). THE REST OF THE PRE-DAMAGE FAMILY — corpus rows 71, 72
      // and 74, **3 sentences / 3 legal printings**, all three claimed WHOLE by the SAME
      // reader `deriveAttackPreDamage` (surface unmoved at 13), so the step arrives
      // through the RAW summand ALONE. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      // 🆕🆕 **D431 — A `- 3` TERM AT THE FRONT, AND THE FROZEN ENDPOINT IS UNTOUCHED.**
      // The printing half of the same step: **3 legal printings** on the ONE prize-taking
      // sentence. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      // 🆕🆕 **D437 — A `- 3` TERM AT THE FRONT, AND THE FROZEN ENDPOINT IS UNTOUCHED**
      // (D426's rule about D425, diffed against `88b03a2` after the edit). THE FILTERED BENCH
      // SNIPE — corpus row 528, **1 sentence / 3 legal printings**, claimed WHOLE by
      // `deriveAttackEffect` through the shared fragment's THIRD capture, so the reader SURFACE
      // stands still at 13 and the step arrives through the RAW summand ALONE. 🛑 BOTH chains in
      // this file were stepped, not only the one that reddened (D431). ⚠️ EDITED AT THE FRONT,
      // NEVER AT THE END.
      // 🆕🆕 **D438 — A `- 2` / `- 3` PAIR AT THE FRONT OF THIS CHAIN, AND THE FROZEN ENDPOINT IS UNTOUCHED
      // (D426).** THE RETREAT-COST PENALTY — *"This attack does {30|50} less damage for each {C} in your
      // opponent's Active Pokémon's Retreat Cost."*, corpus rows 573/603, **2 sentences / 3 legal printings**,
      // claimed WHOLE by `deriveAttackDamagePenalty` through ONE anchor and ONE `if`. ⚠️ EDITED AT THE FRONT,
      // NEVER AT THE END: the right-hand side is the historical constant, and a tail that moves with the head
      // asserts `head === head`. 🛑 EVERY SIBLING CHAIN IN THIS FILE WAS STEPPED IN THE SAME PASS (D431) —
      // vitest stops at the first failing assertion in an `it`, so a green run after fixing the one that
      // reddened is evidence the runner stopped early and nothing else.
      // 🆕🆕 **D445 — A `- 6` TERM AT THE FRONT OF THIS CHAIN, AND THE FROZEN ENDPOINT IS UNTOUCHED
      // (D426).** The printings half of the note on the sentence chain above: 3 + 2 + 1 = **6
      // legal printings** across corpus rows 675, 672 and 564.
      // ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      units(resolved) - 3 /* 🆕🆕🆕 D448 front term: the PRINTINGS half of the note above: 2 + 1 = 3 legal printings across corpus lines 552 and 570. EDITED AT THE FRONT, NEVER AT THE END. */ - 3 /* 🆕🆕🆕 D447 front term: the chosen bench snipe, both seats and both wordings — corpus rows 514/525/587, 3 sentences / 3 legal printings, through the RAW summand alone. EDITED AT THE FRONT, NEVER AT THE END. */ - 9 - 6 - 5 - 3 - 2 - 8 - 8 - 3 - 3 - 5 - 1 - 3 - 3 - 3 - 3 - 5 - 6 - 6 - 5 - 5 - 3 - 5 - 4 - 1 - 6 - 1 - 4 - 5 - 7 - 4 - 5 - 5 - 7 - 8 - 13 - 7 - 9 - 5 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 4,
        // 🆕🆕 D423 — the OPPONENT-SIDE DAMAGE-COUNTER MULTIPLIER, ONE sentence / THREE printings (*"This attack does 20 damage for each damage counter on your opponent's Active Pokémon."* — Glalie `sv06-052`, Flapple `sv08-139`/`sv08-210`), claimed by ONE anchor and ONE `if` on a `DamageCountSource` member D168 already shipped, so the step arrives through the RAW summand alone. 🛑 A CORRECTION TO AN ABSENCE PINNED IN ERROR: D168 declared this spelling unprinted off a LOCAL SIX-SET sweep and both cards are `sv06`/`sv08`.
    ]).toEqual([367, 1267]); // 🆕🆕 **D435 — A `- 1` TERM AT THE FRONT OF EACH CHAIN, AND THE FROZEN ENDPOINT IS UNTOUCHED (D426).** THE DELAYED FAMILY CLOSED: the DISCARD payload (corpus row 53, *"At the end of your opponent's next turn, discard the Defending Pokémon and all attached cards."*, **1 sentence / 1 legal printing**) is the only half of D435 that a WHOLE-SENTENCE reader claims. The KNOCK-OUT payload (corpus row 113, 2 printings) is a COMPOUND and moves `COMPOUND_ATTACK_UNITS` 19 → 21 instead, so it never enters this chain. ⚠️ EDITED AT THE FRONT, NEVER AT THE END — diffed against the previous commit. 🆕🆕 D434 +1 sentence / +3 printings (THE DELAYED COUNTER PLACEMENT — corpus row 54, *"At the end of your opponent's next turn, put 9 damage counters on the Defending Pokémon."*, **1 sentence / 3 legal printings**, claimed WHOLE by `deriveAttackEffect`. A READER-keyed move; nothing composes and no registry row was authored.) 
  });

  it("🛑 the move is READER-keyed: no registry row and no gate clause", () => {
    // The two hand-carried summands `censusAtHead.test.ts` splits `BUILT.attack` into
    // stand still, and that is measured rather than assumed: the printed sentence
    // carries no "does nothing" head, so `splitAttackGateClause` cannot see it, and this
    // slice authors no registry row at all.
    expect(deriveAttackRequirement(TAKEN)).toBeNull();
    expect(TAKEN.includes("this attack does nothing")).toBe(false);
  });
});
