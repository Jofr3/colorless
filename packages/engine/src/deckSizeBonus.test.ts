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
import type { BoardCondition, GameState, Seat } from "./index";
import { redactGame } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  DECK_SIZE_BONUS_DECK,
  attachFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  trimDeckTo,
} from "./testFixtures";

// 0.302.0 → 0.303.0 — 🆕🆕 D398: THE DECK-SIZE READ.
//
// 🛑 THE LAST BUILDABLE SENTENCE BEHIND `CONDITIONAL_DAMAGE_BONUS`, AND A UNION
// INVARIANT CORRECTED RATHER THAN EXCEPTED.
//
// Rabsca `sv08-014` (Surging Sparks) "Counterturn" ({G}, `40+`, **+200**, at index
// **1** of TWO) prints *"If there are 3 or fewer cards in your deck, this attack does
// 200 more damage."* — 1 legal printing.
//
// 🛑 **THE POPULATION IS EXHAUSTED BY THIS ROW, AND §1 SAYS SO WITH BOTH HALVES OF
// THE PARTITION LIVE.** D397 enumerated the residue instead of sampling it: 8
// sentences / 11 printings, exactly ONE buildable. After this row it is **7 / 10**,
// and every one of the seven is a refusal that was measured rather than assumed —
// FIVE D207 BANNER clauses and, at 5 printings, D368's structural SHAPE refusal.
//
// 🛑 **D379's WARNING IS THE REASON §5 EXISTS: SATURATION LOOKS EXACTLY LIKE
// VACUITY.** When a population empties, a guard that says "everything left is
// refused" can be passed by a reader that refuses nothing at all if the set it
// quantifies over has gone empty — and one that says "the sentence is read" can be
// passed by a reader that reads everything. So the refusals here are DRIVEN FROM
// OUTSIDE the bonus population as well as inside it, and the sharpest one is this
// clause's own TWIN: Wo-Chien `sv08-015` "Hazardous Greed" prints the SAME antecedent
// byte for byte under *"…also does 120 damage to 2 of your opponent's Benched
// Pokémon"*, and no reader in the engine claims it. **THE SAME CLAUSE ACCEPTED UNDER
// ONE CONSEQUENT AND DECLINED UNDER ANOTHER IS A DISCRIMINATION NO "REFUSE
// EVERYTHING" AND NO "READ EVERYTHING" READER CAN IMITATE.**
//
// ✅ 🆕🆕 **D399 BUILT THE TWIN, AND THE PARAGRAPH ABOVE IS KEPT VERBATIM WITH ITS
// LAST CLAUSE NOW FALSE** (D178). The discrimination is re-homed on a finer axis
// rather than dropped: the two sentences still differ ONLY in the consequent, and the
// consequent alone now routes them to two DIFFERENT readers, each declining the
// other's printed sentence in the same run. See §5's first case.
//
// 🛑 **THE INVARIANT WAS WRONG, NOT THE CARD (§3).** `BoardCondition`'s doc block has
// said since D40 that a condition over hidden state *"(a hand's CONTENTS, a deck)"*
// would leak through the gate, and four consecutive resume points read that bare noun
// as an instruction to price a REFUSAL first. The hand half names CONTENTS on purpose,
// because a hand's SIZE is public and four shipped members read it; the deck half named
// the ZONE. `redact.ts` writes `deckCount: side.deck.length` for BOTH sides with no
// viewer test, so the member is evaluable on the wire — driven here through
// `redactGame` rather than argued from the source.
//
// 🛑 **MEMBER, NOT FIELD (§2), AND THE NEAREST CANDIDATE IS WRONG TWICE.**
// `opponentHandAtMost { count: 3 }` is keyed on *"your opponent has 3 or fewer cards in
// their hand"* — same comparator, same printed digit — and differs in the SEAT and in
// the ZONE at once. D379 refused the identical widening one zone over on the identical
// grounds. D391's rule as amended at D397 agrees and the DELEGATE clause binds: that
// arm is an inline `.length <= cond.count` with no delegate anywhere, so there is no
// walk to take a `zone` filter — the arm IS the walk. The NOTE clause dissents and is
// recorded as a COST note only; POLARITY vetoes an optional field independently.
//
// WHAT SHIPS: **1 new `BoardCondition` member** (`yourDeckAtMost { count }`), its **2**
// reader arms, **1 literal `CONDITIONAL_DAMAGE_CLAUSES` row** and **1 fixture**. ZERO
// new state, ops, events, error codes, readers, regexes, templates, patterns, registry
// rows, `redact.ts` bytes or `packages/schema` bytes, and `MATCH_RECORD_VERSION` stays
// 25.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/** The nine live readers, run as one — the same set `censusAtHead.test.ts` and
    `benchNamedDamagedBonus.test.ts` use. */
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

/** THE SENTENCE THIS SLICE BUYS — Rabsca `sv08-014` "Counterturn", 1 legal
    printing, byte-for-byte from the committed corpus. */
const TAKEN = "If there are 3 or fewer cards in your deck, this attack does 200 more damage.";
const TAKEN_CLAUSE = "there are 3 or fewer cards in your deck";

/** THE TWIN, one consequent over — Wo-Chien `sv08-015` "Hazardous Greed", 1 legal
    printing. The SAME antecedent byte for byte, and NOT in the bonus residue at all,
    because `CONDITIONAL_DAMAGE_BONUS` never sees it.

    ✅ 🆕🆕 **D399 BOUGHT IT, AND THE PARAGRAPH ABOVE IS KEPT VERBATIM WITH ITS
    "no reader claims it" HALF NOW FALSE** (D178: provenance is annotated, never
    overwritten). `deriveAttackEffect` reads it through `CONDITIONAL_BENCH_SNIPE`,
    which resolves THIS member's clause through the SAME `CONDITIONAL_DAMAGE_CLAUSES`
    row this slice authored. §5's discrimination is re-homed rather than deleted —
    see the case's own note. */
const TWIN =
  "If there are 3 or fewer cards in your deck, this attack also does 120 damage to 2 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** The printed control on the SAME body — index 0, no clause, and a sentence
    `deriveAttackEffect` has read since 0.x. */
const TRIPLE_DRAW = "Draw 3 cards.";

const DECK: BoardCondition = { kind: "yourDeckAtMost", count: 3 };
/** The nearest wrong answer in the whole union: same comparator, same printed digit,
    wrong SEAT and wrong ZONE. */
const HAND: BoardCondition = { kind: "opponentHandAtMost", count: 3 };

// ── boards ─────────────────────────────────────────────────────────────────────

/** P1 Active is the attacker with its {G} paid, P2 Active is the 340 HP `fix-titan`
    defender and BOTH benches are emptied (`setActiveFromDeck` DISPLACES rather than
    replaces). Returned on P2's turn, so `armed` can hand it back with no §4
    restriction. */
function ready(seed: number): GameState {
  let state = driveSetup(
    seed,
    { p1: DECK_SIZE_BONUS_DECK, p2: DECK_SIZE_BONUS_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p1", "fix-counterturn");
  state = attachFromDeck(state, "p1", "fix-grass-energy", 1);
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return clearBench(clearBench(state, "p1"), "p2");
}

/** …the same board handed to P1 with the turn already passed, and P1's deck then
    trimmed to exactly `deck` cards. P1 went SECOND, so this turn carries no §4 attack
    restriction.

    🛑 **THE TRIM COMES AFTER THE TURN PASSES, AND THAT ORDERING IS THE WHOLE REASON
    THIS HELPER EXISTS.** `endTurn` starts P1's turn, and a turn starts with a §5.1
    DRAW — so a deck trimmed to N BEFORE the pass is a deck of N − 1 when the clause is
    read, and a deck trimmed to 0 is a §14.3 deck-out LOSS before an attack can be
    declared at all. Trimming after the draw is what makes `deck` mean the number the
    printed clause reads. (Both failures were observed, not reasoned about: the
    boundary case went green at the wrong value and the empty-deck case threw
    `GAME_OVER: deckOut`.) */
function armed(seed: number, deck: number): GameState {
  return trimDeckTo(mustApply(ready(seed), { type: "endTurn", seat: "p2" }).state, "p1", deck);
}

/** Attack at `index` — **1** is the printed "Counterturn" and **0** the printed
    "Triple Draw" — and report the damage actually dealt. */
function damageDealt(state: GameState, index = 1): number {
  const after = mustApply(state, { type: "attack", seat: "p1", index });
  const dealt = after.events.find((e) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

/** The seat's opposite, spelled once — every board below names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

describe("§1 — the price, RE-DERIVED off the corpus rather than inherited", () => {
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

  it("🛑 the sentence is real, is worth ONE printing, and reached the SKELETON all along", () => {
    expect(corpus().filter(([, s]) => s === TAKEN)).toHaveLength(1);
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(1);
    // It was refused at the CLAUSE, not at the skeleton: the bonus pattern always
    // matched it and always captured the printed 200.
    expect(BONUS.test(TAKEN)).toBe(true);
    expect(BONUS.exec(TAKEN)?.[2]).toBe("200");
    expect(BONUS.exec(TAKEN)?.[1]).toBe(TAKEN_CLAUSE);
    // …and the clause is the whole population UNDER THIS SKELETON: no second sentence
    // carries it at a different amount, so the row cannot be short.
    const clauseRows = corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === TAKEN_CLAUSE);
    expect(clauseRows).toHaveLength(1);
    expect(units(clauseRows)).toBe(1);
  });

  it("🛑 the residue steps by exactly this ONE sentence and ONE printing, and is then EXHAUSTED", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    // The DEPARTURE and the SIZE are asserted separately: a guard that only checked
    // 7 / 10 could not tell "the row landed" from "a reader broke".
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
    // D397 left the residue at 8 / 11, re-derived here off the live readers.
    expect([refused.length, units(refused)]).toEqual([5, 5]);// 🆕🆕 D436 -2 sentences / -5 printings (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.)
    expect([refused.length + 3, units(refused) + 6]).toEqual([8, 11]);
    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    // `{1: 6, 5: 1}` → `{1: 5, 5: 1}`: a SINGLETON left the singleton band and nothing
    // else moved. The only clause above one printing is still the 5-printing
    // declaration clause D368 disqualified on SHAPE, so this rung goes red from the
    // other side too — a reader narrowing until some clause returns to 2 fails it.
    expect(byClause.size).toBe(5);// 🆕🆕 D436 -1 clause: the 5-printing DECLARATION clause LEAVES this residue, and the 5 remaining are the D207 banners (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.)
    expect([...byClause.values()].filter((n) => n === 1)).toHaveLength(5);
    expect([...byClause.values()].filter((n) => n === 5)).toHaveLength(0);// 🆕🆕 D436 the 5-printing band EMPTIES with the declaration clause (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.)
    expect([...byClause.values()].filter((n) => n === 2)).toHaveLength(0);
  });

  it("🛑 the residue is EXHAUSTED OF BUILDABLE ROWS, and each remaining one is named and classified", () => {
    // 🛑 THE CLAIM THIS SLICE ENDS ON, WRITTEN AS A PARTITION RATHER THAN AS A COUNT.
    // Every clause left is a refusal with a REASON, and the reasons are two: a D207
    // BANNER no ingested column classifies, or D368's structural shape refusal. If a
    // successor ever finds a THIRD kind here, this case is where it shows up.
    //
    // 🆕🆕 **D436 — THE SHAPE BUCKET IS NOW EMPTY, AND THAT IS THE FINDING RATHER
    // THAN A NARROWING.** D368's refusal was of a `BoardCondition`; D436 reads the
    // identical sentence as a `DamageCountSource`, where the declared attack's cost
    // is in scope — so the clause LEAVES this residue and one of the two reasons has
    // no occupant left. ⚠️ **THE BUCKET IS KEPT AND ITS EMPTINESS IS ASSERTED, and
    // the clause is asserted CLAIMED beside it** (D418: a re-pointed rung must keep
    // the discrimination the old one had). The old rung went red if the clause got
    // claimed; this one goes red if it stops being claimed OR if a third kind of
    // refusal appears, which is the pair of directions that matters now.
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    const clauses = new Set(refused.map(([, s]) => BONUS.exec(s.trim())?.[1] ?? ""));
    const BANNERS = ["Ancient ", "Tera ", "Future "] as const;
    const SHAPE = "this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost)";
    const banner = [...clauses].filter((c) => BANNERS.some((b) => c.includes(b)));
    const shape = [...clauses].filter((c) => c === SHAPE);
    expect(banner).toHaveLength(5);
    expect(shape).toHaveLength(0);
    // …and the clause the bucket was built for is CLAIMED, on BOTH of its printed
    // amounts, so "the bucket is empty" cannot be satisfied by the clause vanishing
    // from the catalog instead of being read.
    for (const amount of [80, 100]) {
      expect(resolvedByAnyReader(`If ${SHAPE}, this attack does ${amount} more damage.`)).toBe(true);
    }
    // …and the partition is EXACT: nothing is left over and nothing is double-counted.
    expect(banner.length + shape.length).toBe(clauses.size);
    for (const c of banner) expect(shape).not.toContain(c);
  });

  it("🛑 the deck-cardinality column is ONE threshold in ONE direction, which is why `count` is a parameter and the KEY is a row", () => {
    // The measurement behind two design calls at once. A `there are (\d+) or fewer`
    // TEMPLATE would accept a threshold the catalog prints nowhere (D373's rule: a
    // number has no closed vocabulary to fail against), and a `counts` LIST would be
    // reachability nobody prints (D377's arithmetic). Both are refused by the same
    // count, taken over the whole 640-sentence column rather than over this skeleton.
    const deckClauses = corpus().filter(([, s]) => s.includes("cards in your deck"));
    expect(deckClauses).toHaveLength(2);
    expect(units(deckClauses)).toBe(2);
    for (const [, s] of deckClauses) expect(s).toContain("there are 3 or fewer cards in your deck");
    // …and the two differ ONLY in the consequent, which is the fact §5 turns on.
    expect(new Set(deckClauses.map(([, s]) => s))).toEqual(new Set([TAKEN, TWIN]));
    // The direction is the other half: the column prints no deck FLOOR at any value,
    // so `<=` is not one of two readings the catalog offers.
    expect(corpus().filter(([, s]) => /\d+ or more cards in your deck/.test(s))).toHaveLength(0);
  });
});

describe("§2 — the SHAPE question, measured on the running code rather than argued", () => {
  it("🛑 the nearest candidate is `opponentHandAtMost` and it is wrong in the SEAT and in the ZONE at once", () => {
    // THE MEASUREMENT THAT DECIDED "ADDITION, NOT WIDENING" — D379's arithmetic one
    // zone over. The two printed clauses share the comparator AND the digit, so the
    // only thing that could separate them is what they read, and this board separates
    // them: P1's deck is short and P1's opponent holds a full hand.
    const state = armed(3980, 3);
    expect(conditionHolds(state, "p1", DECK)).toBe(true);
    expect(conditionHolds(state, "p1", HAND)).toBe(false);
    expect(state.players.p2.hand.length).toBeGreaterThan(3);
    expect(state.players.p2.deck.length).toBeGreaterThan(3);
    // …and the shipped member is UNTOUCHED, which is what a second member promises and
    // an optional `zone?` on the sibling could not: its clause row still answers with
    // its own kind, and the digit it carries is still 3.
    expect(
      deriveAttackDamageBonus(
        "If your opponent has 3 or fewer cards in their hand, this attack does 120 more damage.",
      )?.count,
    ).toEqual({ kind: "boardCondition", cond: HAND });
  });

  it("🛑 the NOTE clause dissents — ONE noun apart — and it is recorded, not hidden", () => {
    // THE MEASUREMENT THAT ARGUED FOR A FIELD, run rather than described. It lost to
    // the DELEGATE clause, which is what its 2/4 record over D391/D392/D396/D397
    // earns it, and recording it is what keeps the rule falsifiable.
    expect(conditionNote(DECK)).toBe("you have 3 or fewer cards in your deck");
    expect(conditionNote(HAND)).toBe("your opponent has 3 or fewer cards in their hand");
    const slotted = (subject: string, zone: string): string =>
      `${subject} 3 or fewer cards in ${zone}`;
    expect(conditionNote(DECK)).toBe(slotted("you have", "your deck"));
    expect(conditionNote(HAND)).toBe(slotted("your opponent has", "their hand"));
    // …and the note is read off the BOARD, so it does NOT round-trip to the clause key
    // (the key's head is the expletive "there are"). Asserted rather than left for a
    // successor to "fix" one into the other.
    expect(conditionNote(DECK)).not.toBe(TAKEN_CLAUSE);
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(DECK)}, this attack does 200 more damage.`),
    ).toBeNull();
  });

  it("🛑 the count is a PARAMETER: a member at another threshold answers differently on one board", () => {
    // What makes `count` a real field rather than a constant wearing a name. The
    // catalog prints one threshold today; the member is asked at three, on a board
    // where they disagree, so a build that buried the 3 in the kind fails here.
    const state = armed(3981, 5);
    expect(conditionHolds(state, "p1", DECK)).toBe(false);
    expect(conditionHolds(state, "p1", { kind: "yourDeckAtMost", count: 5 })).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "yourDeckAtMost", count: 4 })).toBe(false);
  });
});

describe("§3 — the INVARIANT the union got wrong: a cardinality is not a content", () => {
  it("🛑 `deckCount` crosses the wire for BOTH sides, so the member is evaluable on a projection", () => {
    // THE MEASUREMENT FOUR RESUME POINTS ASKED FOR AND NONE TOOK. The union's doc block
    // named "a deck" as hidden state, and this is the check that says what part of it
    // is: the SIZE ships, with no viewer test, on the near side and the far side alike.
    // Driven through `redactGame` rather than read off `redact.ts` — the shape of the
    // projection is the claim, not the source line.
    const state = armed(3982, 3);
    for (const seat of ["p1", "p2"] as const) {
      const view = redactGame(state, seat);
      expect(view.board.you.deckCount).toBe(state.players[seat].deck.length);
      expect(view.board.opponent.deckCount).toBe(state.players[other(seat)].deck.length);
    }
    // …and the CONTENTS do not, which is the line the corrected invariant draws: the
    // projection carries a number and no card identity for either deck.
    const view = redactGame(state, "p1");
    expect(JSON.stringify(view.board)).not.toContain(state.players.p1.deck[0] ?? "«empty»");
    expect(view.board.you.deckCount).toBe(3);
    // The member's answer is a function of that number alone, so the host and a client
    // holding only the projection agree by construction.
    expect(conditionHolds(state, "p1", DECK)).toBe(view.board.you.deckCount <= 3);
  });
});

describe("§4 — the member on the board: seat, zone, boundary, empty deck", () => {
  it("🛑 the boundary is driven at 2, 3 and 4 — `<` and `===` are each green at one of them", () => {
    // The only mistake this one line can make, in both directions at once. `<` is green
    // at 2 and wrong at 3; `===` is green at 3 and wrong at 2; `>=` is wrong at all
    // three. Boards, not an argument.
    expect(conditionHolds(armed(3990, 2), "p1", DECK)).toBe(true);
    expect(conditionHolds(armed(3991, 3), "p1", DECK)).toBe(true);
    expect(conditionHolds(armed(3992, 4), "p1", DECK)).toBe(false);
  });

  it("🛑 an EMPTY deck is TRUE, and that board is ORDINARY rather than an edge", () => {
    // §14.3's deck-out loss is checked at the DRAW step and nowhere else, so a player
    // who has milled themselves to zero attacks legally this turn. `<=` is what makes
    // the printing pay there; a `>= 1 &&` guard bolted on would fail here.
    const state = armed(3993, 0);
    expect(state.players.p1.deck).toHaveLength(0);
    expect(conditionHolds(state, "p1", DECK)).toBe(true);
    expect(damageDealt(state)).toBe(240);
  });

  it("🛑 own seat only — a SHORT deck on the far side pays this seat nothing", () => {
    // The seat half of the "wrong twice" argument, driven rather than typed: the same
    // board answers TRUE for the seat whose deck is short and FALSE for the other,
    // which is exactly the difference a `seat` field on one member could not make
    // visible.
    const state = armed(3994, 3);
    expect(conditionHolds(state, "p1", DECK)).toBe(true);
    expect(conditionHolds(state, other("p1"), DECK)).toBe(false);
    expect(state.players.p2.deck.length).toBeGreaterThan(3);
  });

  it("🛑 the ZONE is the deck — a short HAND and a short DISCARD move nothing", () => {
    // The zone half. `trimDeckTo` files the trimmed cards into the DISCARD, so the
    // board below has a long discard and a short deck; the member reads only one of
    // them, and the hand it never looks at is whatever setup dealt.
    const state = armed(3995, 3);
    expect(state.players.p1.discard.length).toBeGreaterThan(3);
    expect(conditionHolds(state, "p1", DECK)).toBe(true);
    // …and on a full deck it is FALSE however small the other zones are.
    const full = armed(3996, 40);
    expect(conditionHolds(full, "p1", DECK)).toBe(false);
    expect(full.players.p1.hand.length).toBeLessThan(40);
  });
});

describe("§5 — the REFUSALS, driven from OUTSIDE the population as well as inside it", () => {
  it("🛑 the TWIN carries this clause byte for byte and is routed to a DIFFERENT reader", () => {
    // 🛑 D379's SATURATION TRAP, DEFUSED — AND RE-HOMED AT D399 RATHER THAN DELETED.
    // Until D399 this case required all nine readers to DECLINE the twin while the row
    // one consequent over was accepted; D399 built the twin, so that exact half is
    // gone. The replacement is the same argument on a finer axis and is STRONGER: the
    // two printed sentences share their antecedent byte for byte and differ only in
    // the consequent, and the consequent alone routes them to two DIFFERENT readers —
    // each of which declines the other's printed sentence in the same run. A reader
    // that answered everything fails both refusal halves; one that answered nothing
    // fails both acceptance halves; and a reader that simply widened until it caught
    // the twin would be caught by `deriveAttackDamageBonus(TWIN)` going non-null.
    expect(corpus().filter(([, s]) => s === TWIN)).toHaveLength(1);
    expect(TWIN.startsWith(`If ${TAKEN_CLAUSE}, `)).toBe(true);
    expect(BONUS.test(TWIN)).toBe(false);
    // ⒜ the twin is read, by `deriveAttackEffect` ALONE, and it carries THIS member.
    expect(resolvedByAnyReader(TWIN)).toBe(true);
    expect(deriveAttackEffect(TWIN)).toEqual([
      {
        op: "conditionGate",
        cond: DECK,
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          {
            op: "damageChosen",
            target: "opponentBench",
            amount: 120,
            count: 2,
            source: "attack",
            deals: true,
          },
        ],
      },
    ]);
    for (const read of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(TWIN), read.name).toBeNull();
    }
    // ⒝ …and the accepted half, in the same case, so the pair is a DISCRIMINATION and
    // not two independent claims: the SAME clause, the OTHER consequent, the OTHER
    // reader — and `deriveAttackEffect` declines this one as flatly as
    // `deriveAttackDamageBonus` declines the twin.
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 200,
      count: { kind: "boardCondition", cond: DECK },
    });
    expect(deriveAttackEffect(TAKEN)).toBeNull();
    expect(deriveAttackDamageBonus(TWIN)).toBeNull();
  });

  it("🛑 no OTHER reader claims the taken sentence, so nothing was widened by accident", () => {
    for (const read of READERS) {
      if (read === deriveAttackDamageBonus) continue;
      expect(read(TAKEN), read.name).toBeNull();
    }
  });

  it("🛑 the key is a WHOLE clause: neither a shortened nor a lengthened spelling reaches it", () => {
    // Keys are whole printed clauses and never substrings, which is what keeps this row
    // off its neighbours. Each of these is one printed word from the real key and every
    // one must stay LOUD — including the two that name a REAL sibling member's zone.
    const nearMisses = [
      "there are 3 or fewer cards in your hand",
      "there are 3 or fewer cards in their deck",
      "there are 3 or fewer cards in your discard pile",
      "there are 4 or fewer cards in your deck",
      "there are 3 or more cards in your deck",
      "there is 1 or fewer cards in your deck",
      "you have 3 or fewer cards in your deck",
    ];
    for (const clause of nearMisses) {
      expect(
        deriveAttackDamageBonus(`If ${clause}, this attack does 200 more damage.`),
        clause,
      ).toBeNull();
    }
  });

  it("🛑 the five BANNER clauses left in the residue are still refused, one at a time", () => {
    // The other half of the exhaustion claim, driven BY NAME rather than by a count —
    // a count over a set that emptied would go green for the wrong reason. Every one of
    // these is a D207 banner no ingested column classifies, and every one must stay on
    // the loud ATTACK_EFFECT_SKIPPED path until a supply-side column exists.
    const banners = [
      "1 of your other Ancient Pokémon used an attack during your last turn",
      "you have any Tera Pokémon on your Bench",
      "your opponent's Active Pokémon is a Tera Pokémon",
      "you played a Future Supporter card from your hand during this turn",
      "your opponent has any Future Pokémon in play",
    ];
    for (const clause of banners) {
      const printed = `If ${clause}, this attack does 100 more damage.`;
      expect(deriveAttackDamageBonus(printed), clause).toBeNull();
      // …and each is a REAL printed clause, so this list cannot rot into a set of
      // strings the catalog never carried.
      expect(
        corpus().some(([, s]) => BONUS.exec(s.trim())?.[1] === clause),
        clause,
      ).toBe(true);
    }
  });
});

describe("§6 — the printing end to end, at the index it is actually printed at", () => {
  it("🛑 40 on a full deck, 240 on a short one — attributable to the CLAUSE", () => {
    expect(damageDealt(armed(3997, 40))).toBe(40);
    expect(damageDealt(armed(3998, 3))).toBe(240);
  });

  it("🛑 the clause sits at INDEX 1, and the index-0 control is the one that empties the deck", () => {
    // The guard against a card-keyed rather than index-keyed read, and the reason
    // transcribing the card WHOLE (D306) paid here. "Triple Draw" has no printed damage
    // and no clause, so a bonus that leaked across indices shows up as a number — and
    // it also DRAWS the deck to zero, which is the clearest statement this suite can
    // make that the clause is read at DECLARATION rather than after the program runs.
    const state = armed(3999, 3);
    expect(deriveAttackDamageBonus(TRIPLE_DRAW)).toBeNull();
    expect(damageDealt(state, 0)).toBe(0);
    const drawn = mustApply(state, { type: "attack", seat: "p1", index: 0 }).state;
    expect(drawn.players.p1.deck).toHaveLength(0);
    // …and the clause read at declaration on the ORIGINAL board is the one that pays.
    expect(damageDealt(state)).toBe(240);
  });
});
