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
import { conditionHolds, conditionNote } from "./interpreter";
import {
  BENCH_NAMED_DAMAGED_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  handUid,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
} from "./testFixtures";

// 0.301.0 → 0.302.0 — 🆕🆕 D397: THE BENCHED-CUBONE FILTER.
//
// 🛑 ONE WALK WITH TWO TESTS ON THE SAME BODY, AND D391's SHAPE RULE AMENDED ON ITS
// THIRD TEST.
//
// Marowak `sv07-073` (Stellar Crown) "Bone Vengeance" ({C}{C}, `60+`, **+120**, at
// index **1** of TWO) prints *"If any of your Benched Cubone have any damage counters
// on them, this attack does 120 more damage."* — 1 legal printing. Both halves of that
// clause were already shipped members, and the slice is the discovery that HAVING BOTH
// HALVES IS NOT HAVING THE SENTENCE.
//
// 🛑 **`allOf` IS THE WRONG TOOL AND §3 REFUTES IT ON A BOARD RATHER THAN IN A
// COMMENT.** `allOf([yourBenchHasNamed "Cubone", yourBenchDamaged])` asks *"some
// benched Cubone exists"* AND *"some benched body is damaged"* — two INDEPENDENT
// existentials over one array — which a Bench holding an UNDAMAGED Cubone beside a
// DAMAGED filler satisfies. The printed clause runs ONE existential over the FILTERED
// set and answers FALSE there. That is the whole reason a third member exists.
//
// 🛑 **THE SHAPE QUESTION WAS "MEMBER OR FIELD" FOR THE THIRD TIME, AND §2 SETTLES IT
// ON MEASUREMENTS.** D391's rule reads *a comparand is a shape and takes a MEMBER; a
// filter the delegate already accepts is a FIELD*, and D396 established that its
// clauses can disagree. Here they do:
//   · DELEGATE → MEMBER. `yourBenchDamaged`'s arm is an inline `.some` with no
//     delegate, and `cards.ts` has no name predicate to hand a filter to. **The arm IS
//     the walk** (D396's words), so a field buys a BRANCH, not an argument.
//   · NOTE → FIELD. The two notes are ONE interpolation slot apart. Recorded, not
//     dropped — it is the second consecutive slice on which this clause dissented.
//   · SITES → even. 24 executable sites on the sibling; a field edits 3, a member 0.
//   · POLARITY → MEMBER, independently. `BoardCondition` is read at TWO polarities on
//     purpose (`onlyIf`/`barredIf`, `then`/`otherwise`), so a forgotten optional
//     `name` is silently wrong in opposite directions and never a type error.
//
// 🆕 **THE AMENDMENT, WHICH IS THE POINT OF TAKING THIS ROW AT ALL.** Over four tests
// — D391 FIELD, D392 MEMBER, D396 MEMBER, D397 MEMBER — the DELEGATE clause has
// predicted the answer **4/4** and the NOTE clause **2/4**, which is chance. So the
// NOTE clause is RETIRED AS A DECIDER and kept as a cost note, and the rule becomes:
// *a filter is a FIELD only when a SHIPPED delegate already accepts it; otherwise a
// MEMBER — and if the value is read at two polarities, MEMBER regardless.*
//
// 🛑 **AND THE §1.2 STACK READ IS BEHAVIOUR HERE, NOT HOUSEKEEPING (§5).** Damage
// survives an evolution and the NAME does not, so a damaged benched Cubone evolved
// into Marowak keeps every counter and STOPS satisfying the clause — the one board
// where the two tests this member conjoins move in opposite directions at once. It is
// driven on a real `evolve` action, and the attacker is the very species the benched
// Cubone becomes.
//
// WHAT SHIPS: **1 new `BoardCondition` member** (`yourBenchNamedDamaged { name }`), its
// **2** reader arms, **1 literal `CONDITIONAL_DAMAGE_CLAUSES` row**, **2 fixtures** and
// **1 dedicated 60**. ZERO new state, ops, events, error codes, readers, regexes,
// templates, patterns, registry rows, `redact.ts` bytes or `packages/schema` bytes,
// and `MATCH_RECORD_VERSION` stays 25.

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

/** THE SENTENCE THIS SLICE BUYS — Marowak `sv07-073` "Bone Vengeance", 1 legal
    printing, byte-for-byte from the committed corpus. */
const TAKEN =
  "If any of your Benched Cubone have any damage counters on them, this attack does 120 more damage.";
const TAKEN_CLAUSE = "any of your Benched Cubone have any damage counters on them";

/** THE UNFILTERED SIBLING, shipped at D116 — the same array, the same field, the same
    seat, the NAME test dropped. Three printings at three amounts. */
const SIBLING_SENTENCES = [
  "If your Benched Pokémon have any damage counters on them, this attack does 120 more damage.",
  "If your Benched Pokémon have any damage counters on them, this attack does 80 more damage.",
  "If your Benched Pokémon have any damage counters on them, this attack does 90 more damage.",
] as const;

/** The printed control on the SAME body — index 0, no clause, no printed damage. */
const GROWL =
  "During your opponent's next turn, attacks used by the Defending Pokémon do 40 less damage (before applying Weakness and Resistance).";

const NAMED: BoardCondition = { kind: "yourBenchNamedDamaged", name: "Cubone" };
const ANY: BoardCondition = { kind: "yourBenchDamaged" };
const HAS_NAMED: BoardCondition = { kind: "yourBenchHasNamed", name: "Cubone" };
const COMPOSED: BoardCondition = { kind: "allOf", conditions: [HAS_NAMED, ANY] };

// ── boards ─────────────────────────────────────────────────────────────────────

/** P1 Active is the attacker with its `{C}{C}` paid, P2 Active is the 340 HP
    `fix-titan` defender, BOTH benches are emptied (`setActiveFromDeck` DISPLACES
    rather than replaces) and then P1's is filled with exactly the bodies asked for.
    Returned on P2's turn, so `armed` can hand it back with no §4 restriction. */
function ready(seed: number, bench: readonly string[] = []): GameState {
  let state = driveSetup(
    seed,
    { p1: BENCH_NAMED_DAMAGED_DECK, p2: BENCH_NAMED_DAMAGED_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p1", "fix-bonevengeance");
  state = attachFromDeck(state, "p1", "fix-energy", 2);
  // …plus the {F} that pays the index-0 control, so BOTH printed attacks are legal on
  // every board here and §6's index guard is live on all of them rather than on one.
  state = attachFromDeck(state, "p1", "fix-fighting-energy", 1);
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  return state;
}

/** …the same board handed to P1 with the turn already passed. P1 went SECOND, so
    this turn carries no §4 attack restriction. */
function armed(seed: number, bench: readonly string[] = []): GameState {
  return mustApply(ready(seed, bench), { type: "endTurn", seat: "p2" }).state;
}

/** …two turns further on, which is what §5 needs: §4/§10 bar evolving on a seat's
    FIRST turn, and `armed` hands back exactly that turn. */
function armedLater(seed: number, bench: readonly string[] = []): GameState {
  let state = mustApply(armed(seed, bench), { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  return state;
}

/** Attack at `index` — **1** is the printed "Bone Vengeance" and **0** the printed
    control "Growl" — and report the damage actually dealt. */
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
    // matched it and always captured the printed 120.
    expect(BONUS.test(TAKEN)).toBe(true);
    expect(BONUS.exec(TAKEN)?.[2]).toBe("120");
    expect(BONUS.exec(TAKEN)?.[1]).toBe(TAKEN_CLAUSE);
    // …and the clause is the whole population: no second sentence carries it under a
    // different amount, so the row cannot be short and cannot rot on a reprint.
    const clauseRows = corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === TAKEN_CLAUSE);
    expect(clauseRows).toHaveLength(1);
    expect(units(clauseRows)).toBe(1);
  });

  it("🛑 the UNFILTERED sibling is 3 printings and was ALREADY built — the price is one filter", () => {
    // The handoff's arithmetic, re-measured rather than believed: this row is the
    // sibling clause with a NAME filter and the SAME consequent, so nothing but the
    // filter is being bought.
    const sibling = corpus().filter(([, s]) =>
      s.includes("your Benched Pokémon have any damage counters on them"),
    );
    expect(sibling).toHaveLength(3);
    expect(units(sibling)).toBe(3);
    for (const sentence of SIBLING_SENTENCES) {
      expect(corpus().some(([, s]) => s === sentence), sentence).toBe(true);
      expect(deriveAttackDamageBonus(sentence)?.count).toEqual({
        kind: "boardCondition",
        cond: ANY,
      });
    }
  });

  it("🛑 the residue steps by exactly this ONE sentence and ONE printing", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    // The DEPARTURE and the SIZE are asserted separately: a guard that only checked
    // 8 / 11 could not tell "the row landed" from "a reader broke".
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
    // D396 left the residue at 9 / 12, re-derived here off the live readers.
    expect([refused.length, units(refused)]).toEqual([5, 5]); // 🆕🆕 D436 -2 sentences / -5 printings (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D398 — the DECK-SIZE READ took the LAST BUILDABLE sentence out (Rabsca `sv08-014` "Counterturn", 1 printing), so 8 / 11 -> 7 / 10 and the residue is now EXHAUSTED of buildable rows: FIVE D207 banners and D368's 5-printing SHAPE refusal are all that is left, and this figure can only move again if a refusal's REASON expires
    expect([refused.length + 4, units(refused) + 7]).toEqual([9, 12]); // 🆕🆕 D398 — 1 sentence / 1 printing out (THE DECK-SIZE READ)
    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    // `{1: 7, 5: 1}` → `{1: 6, 5: 1}`: a SINGLETON left the singleton band and nothing
    // else moved. The only clause above one printing is still the 5-printing
    // declaration clause D368 disqualified on SHAPE, so this rung goes red from the
    // other side too — a reader narrowing until some clause returns to 2 fails it.
    expect(byClause.size).toBe(5); // 🆕🆕 D436 -1 clause: the 5-printing DECLARATION clause LEAVES this residue, and the 5 remaining are the D207 banners (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D398 — 7 -> 6, the DECK-SIZE READ
    expect([...byClause.values()].filter((n) => n === 1)).toHaveLength(5); // 🆕🆕 D398 — the DECK-SIZE READ left the singleton band, 6 -> 5
    expect([...byClause.values()].filter((n) => n === 5)).toHaveLength(0);// 🆕🆕 D436 the 5-printing band EMPTIES with the declaration clause (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.)
    expect([...byClause.values()].filter((n) => n === 2)).toHaveLength(0);
  });

  it("🛑 a TEMPLATE is refused by the CORPUS, not by the count — the slot is not a name slot", () => {
    // The measurement that makes this a LITERAL row. A pattern would have to read the
    // token after "Benched" as a card NAME. The 640-sentence column shows that slot
    // taking a D207 BANNER, two OWNER prefixes and a BRACE CODE — none of which is a
    // `Card.name` and every one of which a `(.+)` capture would hand to an exact-name
    // equality that succeeds against nothing.
    const slot = (needle: string): number =>
      corpus().filter(([, s]) => s.includes(needle)).length;
    expect(slot("Benched Ancient Pokémon")).toBeGreaterThanOrEqual(1);
    expect(slot("Benched Team Rocket's Pokémon")).toBeGreaterThanOrEqual(1);
    expect(slot("Benched Cynthia's Pokémon")).toBeGreaterThanOrEqual(1);
    expect(slot("Benched {F} Pokémon")).toBeGreaterThanOrEqual(1);
    // …and under THIS skeleton the printed population is exactly one, so there is no
    // second name to generalise from either.
    const shaped = corpus().filter(([, s]) => /^If any of your Benched /.test(s));
    expect(shaped).toHaveLength(1);
    expect(shaped[0]?.[1]).toBe(TAKEN);
  });
});

describe("§2 — the SHAPE question, measured on the running code rather than argued", () => {
  it("🛑 the NOTE clause dissents — ONE interpolation slot — and it is recorded, not hidden", () => {
    // THE MEASUREMENT THAT ARGUED FOR A FIELD, run rather than described. Unlike D392's
    // pair, these two notes share an interpolation shape exactly: replace one noun and
    // the sibling's string comes back byte-identical. That is a real cost of choosing a
    // member, and it lost to the DELEGATE clause rather than to a tie.
    expect(conditionNote(ANY)).toBe("1 of your Benched Pokémon has damage counters on it");
    expect(conditionNote(NAMED)).toBe("1 of your Benched Cubone has damage counters on it");
    const slotted = (name: string): string => `1 of your Benched ${name} has damage counters on it`;
    expect(conditionNote(NAMED)).toBe(slotted("Cubone"));
    expect(conditionNote(ANY)).toBe(slotted("Pokémon"));
    // …and the note is read off the BOARD, so it does NOT round-trip to the clause key
    // (the key is the printed plural). Asserted rather than left for a successor to
    // "fix" one into the other.
    expect(conditionNote(NAMED)).not.toBe(TAKEN_CLAUSE);
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(NAMED)}, this attack does 120 more damage.`),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(ANY)}, this attack does 120 more damage.`),
    ).toBeNull();
  });

  it("🛑 the shipped sibling is UNTOUCHED — a second member edits ZERO of its sites", () => {
    // The other half of the price, and the thing an optional field could not have
    // promised: an optional field is invisible to the compiler at every site that
    // ignores it, so the 22 shipped `kind: "yourBenchDamaged"` literals would all have
    // silently acquired a new meaning. Here they cannot have — the member's own arms
    // are byte-identical and its answers are the ones it always gave.
    expect(conditionNote(ANY)).toBe("1 of your Benched Pokémon has damage counters on it");
    for (const sentence of SIBLING_SENTENCES) {
      expect(deriveAttackDamageBonus(sentence)?.count).toEqual({
        kind: "boardCondition",
        cond: ANY,
      });
    }
    // …and the UNIVERSAL twin one row over is untouched too, which matters because a
    // `name?:` field on one of a pair is a field the other silently lacks.
    expect(
      deriveAttackDamageBonus(
        "If all of your Benched Pokémon have at least 1 damage counter on them, this attack does 120 more damage.",
      )?.count,
    ).toEqual({ kind: "boardCondition", cond: { kind: "yourBenchAllDamaged" } });
  });

  it("🛑 the POLARITY argument, on a board: the unnarrowed read is a DIFFERENT answer", () => {
    // Why a REQUIRED field on a distinct member beats an optional one on the sibling.
    // `BoardCondition` is read at two polarities on purpose, so a row that forgot the
    // filter would take the answer below — and this board says the two answers differ,
    // which is exactly the silent defect an optional field cannot be stopped from
    // shipping. It is a compile error here instead.
    const state = armed(3970, ["fix-benchfiller"]);
    const hurt = setBenchDamage(state, "p1", 0, 30);
    expect(conditionHolds(hurt, "p1", ANY)).toBe(true);
    expect(conditionHolds(hurt, "p1", NAMED)).toBe(false);
  });
});

describe("§3 — `allOf` IS THE WRONG TOOL, refuted on a board rather than in a comment", () => {
  it("🛑 an UNDAMAGED Cubone beside a DAMAGED filler satisfies the composition and NOT the clause", () => {
    // THE BOARD THE WHOLE MEMBER EXISTS FOR. Both halves hold — a benched Cubone
    // exists, and a benched body is damaged — but they hold of DIFFERENT bodies, and
    // the printed clause asks for one body that is both.
    let state = armed(3971, ["fix-cubone", "fix-benchfiller"]);
    state = setBenchDamage(state, "p1", 1, 30);
    expect(conditionHolds(state, "p1", HAS_NAMED)).toBe(true);
    expect(conditionHolds(state, "p1", ANY)).toBe(true);
    expect(conditionHolds(state, "p1", COMPOSED)).toBe(true);
    expect(conditionHolds(state, "p1", NAMED)).toBe(false);
    // …and the damage the printing actually deals on that board is the UNBOOSTED 60,
    // which is what a composed program would have paid 180 for.
    expect(damageDealt(state)).toBe(60);
  });

  it("🛑 move the counters onto the CUBONE and every reading agrees again", () => {
    // The control for the row above: the composition is not WRONG, it is WEAKER, so it
    // must still agree wherever the clause holds. A guard that only showed a
    // disagreement could not tell "narrower" from "broken".
    let state = armed(3972, ["fix-cubone", "fix-benchfiller"]);
    state = setBenchDamage(state, "p1", 0, 10);
    expect(conditionHolds(state, "p1", NAMED)).toBe(true);
    expect(conditionHolds(state, "p1", COMPOSED)).toBe(true);
    expect(damageDealt(state)).toBe(180);
  });

  it("🛑 the member IMPLIES the unfiltered sibling on every board this suite builds", () => {
    // The invariant a narrowing owes: `∃p. named(p) ∧ damaged(p)` cannot hold where
    // `∃p. damaged(p)` does not. Swept over the boards, both seats, rather than argued.
    const benches: readonly (readonly string[])[] = [
      [],
      ["fix-cubone"],
      ["fix-benchfiller"],
      ["fix-cubone", "fix-benchfiller"],
      ["fix-benchfiller", "fix-cubone"],
      ["fix-cubone", "fix-cubone"],
    ];
    let seen = 0;
    for (const [i, bench] of benches.entries()) {
      const base = armed(3980 + i, bench);
      for (let index = 0; index < bench.length; index += 1) {
        for (const damage of [0, 10, 120]) {
          const state = setBenchDamage(base, "p1", index, damage);
          for (const seat of ["p1", "p2"] as const) {
            if (conditionHolds(state, seat, NAMED)) {
              expect(conditionHolds(state, seat, ANY), `${bench.join()}/${index}/${damage}`).toBe(
                true,
              );
              seen += 1;
            }
          }
        }
      }
    }
    // …and the sweep is not vacuous: some board in it actually satisfied the member.
    expect(seen).toBeGreaterThan(0);
  });
});

describe("§4 — the member on the board: seat, zone, empty set", () => {
  it("🛑 own seat only — the opponent's damaged Cubone pays nothing", () => {
    let state = armed(3990, ["fix-cubone"]);
    state = setBenchDamage(state, "p1", 0, 20);
    expect(conditionHolds(state, "p1", NAMED)).toBe(true);
    expect(conditionHolds(state, other("p1"), NAMED)).toBe(false);
  });

  it("🛑 BENCH only — a damaged Cubone in the ACTIVE Spot does not satisfy it", () => {
    // The printed word is "Benched", and `yourBenchDamaged` / `yourBenchHasNamed`
    // exclude the Active for the same reason. Built by putting the Cubone in the spot
    // rather than by asserting the arm's shape.
    let state = armed(3991);
    state = setActiveFromDeck(state, "p1", "fix-cubone");
    state = clearBench(state, "p1");
    const active = state.players.p1.active;
    expect(active).not.toBeNull();
    state = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, active: active === null ? null : { ...active, damage: 50 } },
      },
    };
    expect(conditionHolds(state, "p1", { kind: "yourActiveDamaged" })).toBe(true);
    expect(conditionHolds(state, "p1", NAMED)).toBe(false);
  });

  it("🛑 an EMPTY Bench is FALSE, and a Cubone with NO counters is FALSE", () => {
    expect(conditionHolds(armed(3992), "p1", NAMED)).toBe(false);
    expect(conditionHolds(armed(3993, ["fix-cubone"]), "p1", NAMED)).toBe(false);
    // …and the empty-Bench FALSE is forced rather than chosen: `∃` over the empty set.
    expect(conditionHolds(armed(3992), "p1", ANY)).toBe(false);
  });

  it("🛑 the NAME is exact and un-normalised — a damaged non-Cubone is FALSE at any amount", () => {
    const base = armed(3994, ["fix-benchfiller"]);
    for (const damage of [10, 50, 120]) {
      expect(conditionHolds(setBenchDamage(base, "p1", 0, damage), "p1", NAMED), `${damage}`).toBe(
        false,
      );
    }
    // …and a member asked for a name nothing on the Bench carries is FALSE even where
    // the Cubone reading is TRUE, which is what makes `name` a real parameter.
    let cubone = armed(3995, ["fix-cubone"]);
    cubone = setBenchDamage(cubone, "p1", 0, 10);
    expect(conditionHolds(cubone, "p1", NAMED)).toBe(true);
    expect(
      conditionHolds(cubone, "p1", { kind: "yourBenchNamedDamaged", name: "Marowak" }),
    ).toBe(false);
    expect(conditionHolds(cubone, "p1", { kind: "yourBenchNamedDamaged", name: "cubone" })).toBe(
      false,
    );
  });
});

describe("§5 — the §1.2 STACK read, which is this member's whole behaviour", () => {
  it("🛑 evolving the damaged Cubone into Marowak KEEPS the counters and LOSES the clause", () => {
    // THE BOARD ONLY THIS MEMBER HAS. Damage rides the body across an evolution and the
    // NAME does not, so the two tests this member conjoins move in opposite directions
    // at the same instant. Driven on a real `evolve` action, and the species the Cubone
    // becomes is the attacker's own.
    let state = armedLater(3996, ["fix-cubone"]);
    state = setBenchDamage(state, "p1", 0, 30);
    expect(conditionHolds(state, "p1", NAMED)).toBe(true);
    expect(conditionHolds(state, "p1", HAS_NAMED)).toBe(true);
    expect(conditionHolds(state, "p1", ANY)).toBe(true);

    state = handFromDeck(state, "p1", "fix-bonevengeance", 1);
    const evolved = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", "fix-bonevengeance"),
      target: { spot: "bench", index: 0 },
    }).state;

    // The counters are still there…
    expect(evolved.players.p1.bench[0]?.damage).toBe(30);
    expect(conditionHolds(evolved, "p1", ANY)).toBe(true);
    // …and the name is not, so the clause has stopped holding.
    expect(conditionHolds(evolved, "p1", HAS_NAMED)).toBe(false);
    expect(conditionHolds(evolved, "p1", NAMED)).toBe(false);
    // …and the damage the printing deals follows the clause, not the counters.
    expect(damageDealt(evolved)).toBe(60);
  });
});

describe("§6 — the printing end to end, at the index it is actually printed at", () => {
  it("🛑 60 with no damaged Cubone, 180 with one — attributable to the CLAUSE", () => {
    expect(damageDealt(armed(3997, ["fix-cubone"]))).toBe(60);
    let hurt = armed(3998, ["fix-cubone"]);
    hurt = setBenchDamage(hurt, "p1", 0, 10);
    expect(damageDealt(hurt)).toBe(180);
  });

  it("🛑 the clause sits at INDEX 1 and the index-0 control carries none of it", () => {
    // The guard against a card-keyed rather than index-keyed read: "Growl" is on the
    // same body, has no printed damage and no bonus clause, so a bonus that leaked
    // across indices would show up here as a number.
    let hurt = armed(3999, ["fix-cubone"]);
    hurt = setBenchDamage(hurt, "p1", 0, 10);
    expect(damageDealt(hurt, 0)).toBe(0);
    // …and the control sentence is nothing this reader claims.
    expect(deriveAttackDamageBonus(GROWL)).toBeNull();
  });
});

describe("§7 — the clause table: three readings of one array, mutually unreachable", () => {
  it("🛑 each of the three printed clauses resolves to its OWN member and no other", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: NAMED },
    });
    expect(deriveAttackDamageBonus(SIBLING_SENTENCES[0])).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: ANY },
    });
    expect(
      deriveAttackDamageBonus(
        "If all of your Benched Pokémon have at least 1 damage counter on them, this attack does 120 more damage.",
      ),
    ).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: { kind: "yourBenchAllDamaged" } },
    });
  });

  it("🛑 no OTHER reader claims the sentence, so nothing was widened by accident", () => {
    for (const read of READERS) {
      if (read === deriveAttackDamageBonus) continue;
      expect(read(TAKEN), read.name).toBeNull();
    }
  });

  it("🛑 the key is a WHOLE clause: neither a shortened nor a lengthened spelling reaches it", () => {
    // Keys are whole printed clauses and never substrings, which is what keeps the
    // three bench rows apart. Each of these is one printed word from the real key and
    // every one must stay LOUD.
    const nearMisses = [
      "any of your Benched Cubone have damage counters on them",
      "any of your Benched Cubone has any damage counters on them",
      "your Benched Cubone have any damage counters on them",
      "any of your Benched Marowak have any damage counters on them",
      "any of your opponent's Benched Cubone have any damage counters on them",
    ];
    for (const clause of nearMisses) {
      expect(
        deriveAttackDamageBonus(`If ${clause}, this attack does 120 more damage.`),
        clause,
      ).toBeNull();
    }
  });
});
