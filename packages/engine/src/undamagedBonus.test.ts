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
import type { BoardCondition, GameState } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { programFor, registryCardIds } from "./registry";
import {
  UNDAMAGED_BONUS_DECK,
  attachFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setDamage,
} from "./testFixtures";

// 🆕🆕 D368 — A HANDED CANDIDATE DISQUALIFIED ON *SHAPE* RATHER THAN ON PRICE,
// AND A REFUSAL FOUND SCOPED.
//
// D367 handed over the largest item left behind the `CONDITIONAL_DAMAGE_BONUS`
// skeleton — *"this Pokémon has at least 2 extra Energy attached (in addition to
// this attack's cost)"*, **3 printings on one sentence, 5 across two** — and asked
// its successor to settle FIRST, from the catalog, whether that clause is a fact
// about the BOARD or about the DECLARATION, because if it is the latter it is not
// a `BoardCondition` at all and the candidate is the wrong shape for the table it
// would go in.
//
// 🛑 **IT IS A DECLARATION FACT.** §1 settles it without an argument: the identical
// clause is printed on TWO attacks with TWO DIFFERENT COSTS, so the same board
// answers it differently depending on which attack was declared.
//
// 🛑 **AND THE 3-PRINTING TIE-BREAK'S STATED PRICE WAS A STALE REFUSAL.** The
// handoff said it needs the `not` combinator D125 refused. D125's refusal is
// SCOPED to a RECURSIVE member; a FLAT complement owes no recursion arm, and this
// union already ships one. §2 prices that explicitly and §5 drives the difference
// between a complement and a negation on the one board where they disagree.
//
// WHAT SHIPS: **1 union member** (`yourActiveUndamaged`), **2 reader arms** and
// **1 literal clause row**. Arven's Mabosstiff ex `sv10-139`/`-218`/`-235`
// "Vigorous Tackle" ({C}, 30+, **+120**), **3 legal printings**.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/** The nine live readers, run as one — the same set `censusAtHead.test.ts`,
    `precociousEvolution.test.ts` and `benchNamedBonus.test.ts` use. */
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

/** THE SENTENCE THIS SLICE BUYS. */
const TAKEN = "If this Pokémon has no damage counters on it, this attack does 120 more damage.";

/** THE HANDED CANDIDATE, refused on SHAPE. Its two printed sentences differ only
    in the amount; the CLAUSE is byte-identical across both, which is exactly what
    made it look like one row for five printings. */
const DECLARATION_CLAUSE =
  "this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost)";
const DECLARATION_SENTENCES: readonly (readonly [string, number])[] = [
  [`If ${DECLARATION_CLAUSE}, this attack does 80 more damage.`, 3],
  [`If ${DECLARATION_CLAUSE}, this attack does 100 more damage.`, 2],
];

/** The three ids behind the taken sentence — remote D1 `luminous`
    (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`), `$.effect`, the extractor verified
    against the 640 / 1,732 / 60,467 total FIRST, 2026-08-19. Every one
    `legal_standard = 1` and `category = 'Pokemon'`. */
const TAKEN_IDS: readonly string[] = ["sv10-139", "sv10-218", "sv10-235"];

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: UNDAMAGED_BONUS_DECK, p2: UNDAMAGED_BONUS_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields `attacker` with one Energy paid, P2 fields a 200 HP body that
    survives 150, and BOTH benches start EMPTY. */
function ready(seed: number, attacker: string): GameState {
  let state = setActiveFromDeck(board(seed), "p1", attacker);
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  return clearBench(clearBench(state, "p1"), "p2");
}

/** Attack index 0 and report the damage actually dealt. */
function damageDealt(state: GameState): number {
  const after = mustApply(state, { type: "attack", seat: "p1", index: 0 });
  const dealt = after.events.find((e) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

describe("§1 — the handed candidate is a DECLARATION fact, settled from the CATALOG", () => {
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

  it("🛑 the SAME clause is printed on TWO attacks with TWO DIFFERENT COSTS", () => {
    // THE MEASUREMENT THAT DISQUALIFIES IT, recorded as data rather than as prose.
    // Remote D1 `luminous`, `$.effect` joined to `$.cost`, 2026-08-19:
    //
    //   Electivire ex  sv10-069/-212        High-Voltage Press  {L}{L}{C}  cost 3
    //   Jellicent ex   sv10.5w-045/-160/-168 Power Press        {P}{C}     cost 2
    //
    // "at least 2 extra … in addition to this attack's cost" is therefore TRUE at
    // 4 attached for Jellicent and FALSE at 4 attached for Electivire — WITH THE
    // BOARD IDENTICAL. A `BoardCondition` is `conditionHolds(state, seat, cond)`:
    // a state and a seat, and no attack. It structurally cannot answer this.
    const COSTS: readonly (readonly [string, number, number])[] = [
      ["Electivire ex sv10-069/-212", 3, 2],
      ["Jellicent ex sv10.5w-045/-160/-168", 2, 3],
    ];
    // The two costs are DIFFERENT — the whole disqualification in one assertion.
    expect(new Set(COSTS.map(([, cost]) => cost)).size).toBe(2);
    // …and the printings sum to the five the corpus prints across the two
    // sentences, so this table cannot drift from the population below.
    expect(COSTS.reduce((sum, [, , n]) => sum + n, 0)).toBe(5);
    // The threshold each cost implies is DIFFERENT TOO, which is the fact a
    // board-only predicate would have to guess at.
    expect(COSTS.map(([, cost]) => cost + 2)).toEqual([5, 4]);
  });

  it("🛑 …so it is NOT a `BoardCondition` — and D436 claims it as a `DamageCountSource` instead", () => {
    // Both printed sentences are real and are in the corpus at 3 and 2.
    //
    // 🆕🆕 **D436 — THE TRIPWIRE FIRED, AND IT FIRED FOR THE RIGHT REASON.** This rung
    // was written as *"the tripwire that fires the day a row IS added for a clause the
    // union cannot evaluate"*, and NO ROW WAS ADDED: the union is untouched, the two
    // exhaustive `switch (cond.kind)` statements gain no arm, and the sentence is
    // claimed by a WHOLE-SENTENCE ANCHOR feeding a `DamageCountSource` member whose
    // evaluator is handed the declared attack's EFFECTIVE cost. **§1's measurement
    // above is what makes that legal and it is unchanged** — two costs, one board, two
    // answers; a `(state, seat)` predicate still cannot do it and this one is not one.
    //
    // ⚠️ **THE `boardCondition` HALF OF THE CLAIM IS KEPT AS AN ASSERTION** rather than
    // dropped to prose, because it is the half D368 actually settled.
    //
    // 🛑 **AND D436's SENTENCE HERE — *"the day someone routes this clause through
    // `CONDITIONAL_DAMAGE_CLAUSES`, the derived `count.kind` changes and this rung
    // reddens"* — WAS FALSE, MEASURED.** `EXTRA_ENERGY_BONUS` is executed BEFORE
    // `CONDITIONAL_DAMAGE_BONUS` inside `deriveAttackDamageBonus`, so a table row
    // added for this clause is DEAD on this path and `count.kind` never moves. The
    // corpus row `D368-declaration-clause-gets-a-board-row` SURVIVED for exactly that
    // reason. **The discrimination is re-armed in the rung directly below**, which is
    // where the table claim now lives; this loop keeps the `DamageCountSource` half.
    for (const [sentence, printings] of DECLARATION_SENTENCES) {
      expect(units(corpus().filter(([, s]) => s === sentence)), sentence).toBe(printings);
      expect(resolvedByAnyReader(sentence), sentence).toBe(true);
      const read = deriveAttackDamageBonus(sentence);
      expect(read, sentence).not.toBeNull();
      expect(read?.count, sentence).toEqual({ kind: "extraEnergyUnitsBeyondCost", extra: 2 });
      expect(read?.per, sentence).toBe(Number(BONUS.exec(sentence)?.[2]));
      // Refused by VOCABULARY, not by the ANCHOR — D363's distinction. It matches
      // the skeleton and misses at the table, which is what made it look cheap.
      expect(BONUS.test(sentence.trim()), sentence).toBe(true);
    }
    // FIVE printings across TWO sentences on ONE clause — the number that made this
    // the biggest thing on D367's list, kept so a successor inherits it measured.
    expect(DECLARATION_SENTENCES.reduce((sum, [, n]) => sum + n, 0)).toBe(5);
    expect(new Set(DECLARATION_SENTENCES.map(([s]) => BONUS.exec(s)?.[1])).size).toBe(1);
  });

  it("🛑🆕🆕 NO `CONDITIONAL_DAMAGE_CLAUSES` ROW CLAIMS THE CLAUSE — driven at the two call sites the ANCHOR does not pre-empt", () => {
    // 🛑 **THE RUNG THE ONE ABOVE WAS CLAIMED TO BE.** D368's finding is a claim about
    // a TABLE — *"this clause is not a `BoardCondition`, so no row may map it"* — and
    // after D436 nothing executed it: the sentence that would have shown a row's
    // effect is claimed by `EXTRA_ENERGY_BONUS` first, so the row is invisible there.
    // This is D418's second half arriving one slice after the rule was written.
    // **THE QUESTION, ASKED: what could the OLD claim catch that the NEW one
    // cannot?** The old rung (read off `a2db519`, the commit before D436) asserted
    // `resolvedByAnyReader(sentence) === false` and
    // `deriveAttackDamageBonus(sentence) === null`. **THE ANSWER: a
    // `CONDITIONAL_DAMAGE_CLAUSES` row added for this clause** — under the old claim
    // both assertions flip; under the new one (*"`count.kind` is
    // `extraEnergyUnitsBeyondCost`"*) nothing moves, because the claim is TRUE under
    // a build carrying the row and under the real build alike. The re-pointing was
    // right — D436 really does claim the sentence, and re-point-do-not-delete is the
    // rule — but it dropped discrimination, and this rung buys it back.
    //
    // 🛑 **AND `EXTRA_ENERGY_BONUS`'s OWN DOC BLOCK SAID THIS ASSERTION WAS
    // IMPOSSIBLE** — *"No assertion can show that from outside this file:
    // `boardConditionForClause` is not exported, and every sentence carrying this
    // clause matches THIS anchor too."* The first clause is true and the second is not
    // a reason. `boardConditionForClause` has THREE call sites in `effects.ts`
    // (measured: `grep -n 'boardConditionForClause' packages/engine/src/effects.ts`
    // returns 15 hits, 12 of them prose, and the code sites are the declaration plus
    // `CONDITIONAL_BENCH_SNIPE`, `CONDITIONAL_DAMAGE_BONUS` and
    // `BONUS_CONSEQUENT_CONDITION[_THEN]`), and the anchor pre-empts exactly ONE of
    // them. The other two are reached by CARRIERS the anchor cannot match — a
    // `, and `/`. Then, ` consequent join, and the benched-snipe rider — and both of
    // their readers are exported. So the question is askable from outside, and the
    // three probes below ask it.
    //
    // ⚠️ **ONE AXIS (D427)**: the carriers are byte-identical per site and the CLAUSE
    // is the only thing substituted. ⚠️ **AND THE ADMITTED TWIN IS D368's OWN ROW
    // (D424)**: a reader that refused every clause would satisfy the refusal half on
    // its own and prove nothing, so the same carrier is driven with the taken clause
    // and required to resolve to the member this slice bought.
    //
    // ⚠️ These carriers are PROBES OF A VOCABULARY, not authored cards — the shape
    // `clauseApostrophe.test.ts` already uses to drive its TEMPLATE-owned bucket. No
    // printing in `legalAttackCorpus()` carries this clause under either skeleton
    // (measured: 0 of 640 for each of `BONUS_CONSEQUENT_CONDITION`,
    // `BONUS_CONSEQUENT_CONDITION_THEN` and `CONDITIONAL_BENCH_SNIPE`; 2 of 640 for
    // `CONDITIONAL_DAMAGE_BONUS`, which are the two the anchor claims), which is why
    // the difference is invisible to every census in the repo.
    const ROW_CLAUSE = BONUS.exec(TAKEN)?.[1] ?? "";
    expect(ROW_CLAUSE).toBe("this Pokémon has no damage counters on it");
    const PROBES = [
      {
        site: "BONUS_CONSEQUENT_CONDITION",
        carrier: (clause: string) =>
          `If ${clause}, this attack does 80 more damage, and discard all Energy from this Pokémon.`,
        read: (sentence: string): unknown => deriveAttackBonusConsequent(sentence),
      },
      {
        site: "BONUS_CONSEQUENT_CONDITION_THEN",
        carrier: (clause: string) =>
          `If ${clause}, this attack does 80 more damage. Then, discard all Energy from this Pokémon.`,
        read: (sentence: string): unknown => deriveAttackBonusConsequent(sentence),
      },
      {
        site: "CONDITIONAL_BENCH_SNIPE",
        carrier: (clause: string) =>
          `If ${clause}, this attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)`,
        read: (sentence: string): unknown => deriveAttackEffect(sentence),
      },
    ] as const;
    for (const { site, carrier, read } of PROBES) {
      // REFUSED — the table holds no row for the declaration clause, so the reader
      // falls through to null and the sentence stays LOUD.
      expect(read(carrier(DECLARATION_CLAUSE)), site).toBeNull();
      // ADMITTED — D368's own row, the SAME carrier, the clause the only difference.
      // Quoted (D426), because a bare substring would pass on a neighbouring member.
      expect(JSON.stringify(read(carrier(ROW_CLAUSE))), site).toContain('"yourActiveUndamaged"');
    }
    // …and the pre-emption itself, so the reason this rung exists cannot rot into
    // prose: at the ONE site the anchor covers, the SAME clause resolves — through
    // the anchor, not through the table.
    expect(deriveAttackDamageBonus(`If ${DECLARATION_CLAUSE}, this attack does 80 more damage.`)
      ?.count).toEqual({ kind: "extraEnergyUnitsBeyondCost", extra: 2 });
  });

  it("🛑 and 3 printings for a BOARD fact beat 5 printings for a fact of the wrong shape", () => {
    // The comparison written as arithmetic so it cannot rot into prose: the taken
    // sentence is worth 3, the disqualified one 5, and the slice takes the SMALLER
    // number because the larger one is not purchasable in this union at any price.
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(3);
    expect(DECLARATION_SENTENCES.reduce((sum, [, n]) => sum + n, 0)).toBeGreaterThan(3);
  });
});

describe("§2 — the price: a FLAT complement, not the `not` combinator D125 refused", () => {
  it("🛑 buys ONE member with TWO arms — and the producer set is closed at two", () => {
    // The claim that makes this purchase flat, DRIVEN rather than asserted: the
    // member answers on a board AND renders a note, which are the two exhaustive
    // `switch (cond.kind)` statements in the repo (S4's grep over non-test source
    // returns exactly `conditionHolds` and `conditionNote`). A `{ kind: "not" }`
    // combinator would instead have owed a RECURSION arm in five consumers.
    const cond: BoardCondition = { kind: "yourActiveUndamaged" };
    const state = ready(5100, "fix-mabosstiff");
    expect(typeof conditionHolds(state, "p1", cond)).toBe("boolean");
    expect(conditionNote(cond)).not.toBe("");
    // The note is POSITIVE English, which is the readable phrasing D125 said a
    // generic negation could not supply — it exists because this is a NAMED fact.
    expect(conditionNote(cond)).toBe("your Active Pokémon has no damage counters on it");
    expect(conditionNote(cond)).not.toContain("not ");
  });

  it("🛑 the union already ships a FLAT COMPLEMENT, so the shape is not new", () => {
    // `opponentActiveIsBasic` is documented as "the exact COMPLEMENT" of
    // `opponentActiveIsEvolution` and is its own flat member. Driven, not quoted:
    // both render a note and both answer on a board, exactly as this slice's pair
    // does — which is what makes "a complement is a board fact, only a negation
    // OPERATOR is a combinator" a measurement rather than a preference.
    const state = ready(5101, "fix-mabosstiff");
    const pairs: readonly BoardCondition[] = [
      { kind: "opponentActiveIsEvolution" },
      { kind: "opponentActiveIsBasic" },
      { kind: "yourActiveDamaged" },
      { kind: "yourActiveUndamaged" },
    ];
    for (const cond of pairs) {
      expect(typeof conditionHolds(state, "p1", cond), cond.kind).toBe("boolean");
      expect(conditionNote(cond), cond.kind).not.toBe("");
    }
  });

  it("the clause row resolves to the member, and the amount comes off the SKELETON", () => {
    const read = deriveAttackDamageBonus(TAKEN);
    expect(read).not.toBeNull();
    expect(read?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "yourActiveUndamaged" },
    });
    // The amount is captured one layer up, never off the clause row — which is why
    // this one row would serve a second printed amount for free.
    expect(read?.per).toBe(Number(BONUS.exec(TAKEN)?.[2]));
    expect(read?.per).toBe(120);
  });

  it("keeps the two CONSEQUENTS disjoint — D125's rule, on this clause", () => {
    // The requirement reader must never see a sentence meaning "+N"…
    expect(deriveAttackRequirement(TAKEN)).toBeNull();
    // …and the cancel spelling of the same clause must never reach the bonus table,
    // which is the direction that would score a bonus off a cancel.
    const clause = BONUS.exec(TAKEN)?.[1] ?? "";
    expect(deriveAttackDamageBonus(`If ${clause}, this attack does nothing.`)).toBeNull();
  });

  it("the anchors are whole-sentence at BOTH ends — no substring reaches the row", () => {
    const clause = BONUS.exec(TAKEN)?.[1] ?? "";
    // Lowercase `if` — the skeleton has no /i.
    expect(deriveAttackDamageBonus(`if ${clause}, this attack does 120 more damage.`)).toBeNull();
    // No trailing period is not the whole sentence.
    expect(deriveAttackDamageBonus(`If ${clause}, this attack does 120 more damage`)).toBeNull();
    // Leading text pins `^`.
    expect(
      deriveAttackDamageBonus(`Flip a coin. If ${clause}, this attack does 120 more damage.`),
    ).toBeNull();
    // A printed 0 adds nothing — the guard every arm in this family carries.
    expect(deriveAttackDamageBonus(`If ${clause}, this attack does 0 more damage.`)).toBeNull();
  });
});

describe("§3 — the two NEAR-MISSES, one printed word and one seat apart", () => {
  it("🛑 'any' and 'no' are ONE WORD apart and must never reach each other's row", () => {
    const mine = "If this Pokémon has any damage counters on it, this attack does 90 more damage.";
    expect(deriveAttackDamageBonus(mine)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "yourActiveDamaged" },
    });
    expect(deriveAttackDamageBonus(TAKEN)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "yourActiveUndamaged" },
    });
    // The two clauses differ by exactly that word, stated so the near-miss is
    // measured rather than described.
    const a = BONUS.exec(mine)?.[1] ?? "";
    const b = BONUS.exec(TAKEN)?.[1] ?? "";
    expect(a.replace("any", "no")).toBe(b);
    expect(a).not.toBe(b);
  });

  it("🛑 the OPPONENT-seat twin of the same six words belongs to the OTHER table", () => {
    // Basculin `sv10.5w-024`/`-108` prints the same "has no damage counters on it"
    // on the opponent's seat under "does nothing", and D125's polarity flip maps it
    // to `opponentActiveDamaged`. One clause family, two tables, two seats, two
    // consequents — and it must not land on this slice's member.
    const basculin =
      "If your opponent's Active Pokémon has no damage counters on it before this attack does damage, this attack does nothing.";
    expect(units(corpus().filter(([, s]) => s === basculin))).toBe(2);
    expect(deriveAttackRequirement(basculin)).toEqual({ kind: "opponentActiveDamaged" });
    // It is NOT a bonus and NOT this slice's member, both directions.
    expect(deriveAttackDamageBonus(basculin)).toBeNull();
    expect(basculin).toContain("has no damage counters on it");
  });
});

describe("§4 — driven on boards: the member decides the damage", () => {
  it("an UNDAMAGED attacker deals 30 + 120", () => {
    expect(damageDealt(ready(5200, "fix-mabosstiff"))).toBe(150);
  });

  it("a DAMAGED attacker deals the base 30 and nothing more", () => {
    const state = setDamage(ready(5200, "fix-mabosstiff"), "p1", 10);
    expect(state.players.p1.active?.damage).toBe(10);
    expect(damageDealt(state)).toBe(30);
  });

  it("🛑 ONE damage counter is enough to switch it off — the boundary is 0, not 'a lot'", () => {
    // 10 damage is one counter, the smallest amount the game can put on a body. The
    // member reads `=== 0`, so the step is between 0 and 10 and nowhere else.
    for (const damage of [0, 10, 20, 50]) {
      const state = setDamage(ready(5201, "fix-mabosstiff"), "p1", damage);
      expect(damageDealt(state), `damage=${damage}`).toBe(damage === 0 ? 150 : 30);
    }
  });

  it("reads at DECLARATION — the counters it walked in with, not the ones it takes", () => {
    // The defender is a 200 HP body, so nothing here KOs and the attacker takes no
    // damage during its own attack; the point is that the read happens once, at the
    // top of §8.5, exactly as its complement's does.
    const state = ready(5202, "fix-mabosstiff");
    expect(state.players.p1.active?.damage).toBe(0);
    const after = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(after.state.players.p2.active?.damage).toBe(150);
  });
});

describe("§5 — the ONE board where a complement and a NEGATION disagree", () => {
  it("🛑 an EMPTY Active Spot is FALSE on BOTH arms — `!yourActiveDamaged` would be TRUE", () => {
    // THE ASSERTION THAT MAKES THIS A MEMBER RATHER THAN AN OPERATOR. With no
    // Active, `yourActiveDamaged` is false; a `{ kind: "not" }` wrapper around it
    // would therefore be TRUE, and an absent Pokémon would satisfy "this Pokémon
    // has no damage counters on it". The member is written with a POSITIVE null
    // guard on both arms, so both are false and the two are complements only where
    // an Active exists.
    let state = ready(5300, "fix-mabosstiff");
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, active: null } } };
    expect(conditionHolds(state, "p1", { kind: "yourActiveDamaged" })).toBe(false);
    expect(conditionHolds(state, "p1", { kind: "yourActiveUndamaged" })).toBe(false);
    // …and the negation-of-the-complement really would have differed here, which is
    // what turns this from a style note into a measurement.
    expect(!conditionHolds(state, "p1", { kind: "yourActiveDamaged" })).toBe(true);
  });

  it("…and WITH an Active they are exact complements at every damage value", () => {
    for (const damage of [0, 10, 60, 120]) {
      const state = setDamage(ready(5301, "fix-mabosstiff"), "p1", damage);
      const damaged = conditionHolds(state, "p1", { kind: "yourActiveDamaged" });
      const undamaged = conditionHolds(state, "p1", { kind: "yourActiveUndamaged" });
      expect(damaged, `damage=${damage}`).toBe(damage > 0);
      expect(undamaged, `damage=${damage}`).toBe(!damaged);
    }
  });
});

describe("§6 — the census this row moves, and the three summands it does not", () => {
  it("🛑 the three ids are all of the sentence's printings, and none is in the registry", () => {
    // The standing-still of the other summands, MEASURED not assumed. S2 walks all
    // 708 registry programs; none of the three ids is among them, so
    // `REGISTRY_ATTACK_UNITS` cannot move and this is a purely READER-keyed step.
    expect(TAKEN_IDS).toHaveLength(3);
    const ids = new Set(registryCardIds());
    for (const id of TAKEN_IDS) expect(ids.has(id), id).toBe(false);
    for (const id of TAKEN_IDS) expect(programFor(id), id).toBeUndefined();
    // …and the corpus agrees on the printing count, so the id list and the census
    // cannot drift apart.
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(TAKEN_IDS.length);
  });

  it("🛑 the ZERO-VOCABULARY FLOOR is now 0 / 0 — D367 drained it, so this slice had to buy", () => {
    // The floor stated as a NUMBER measurement can contradict, D366's form. Of the
    // sentences still refused behind this skeleton, the ones that reach a live
    // anchored TEMPLATE and miss only at its token map are the zero-member floor —
    // and there are none that are real floor. The three that reach an anchor are
    // TRAPS, each named with why taking it would be wrong.
    const SELF_ENERGY = /^this Pokémon has any (.+) Energy attached$/;
    const ACTIVE_TYPE = /^your opponent's Active Pokémon is a (.+) Pokémon$/;
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    const anchored: string[] = [];
    for (const [, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      const token = SELF_ENERGY.exec(clause)?.[1] ?? ACTIVE_TYPE.exec(clause)?.[1];
      if (token !== undefined) anchored.push(token);
    }
    // 🆕 D374 — **TWO, WHERE THIS ROW MEASURED THREE, AND THE ONE THAT LEFT IS THE
    // ONE THIS COMMENT CALLED A TRAP.** The list is a live derivation, so it steps on
    // its own the day a token stops being refused.
    // 🆕🆕 D387 — **TWO -> ONE, AND IT STEPPED ON ITS OWN EXACTLY AS PROMISED.** "Stage
    // 1" left because D387 bought `opponentActiveIsStage1` — and it left through the
    // LITERAL table, not through the token map: the loose pattern still reaches
    // `CLAUSE_POKEMON_TYPES` with that token and still misses it, so the map's
    // vocabulary is unchanged and the anchored-template floor is unchanged with it.
    expect(anchored.sort()).toEqual(["Tera"]);
    // The one that remains is a trap and not floor: "Tera" is not a `Card.types` value
    // at all — it is DEMAND with no supply column (D207), so no predicate over the
    // catalog can answer it. So the floor over this residue is STILL ZERO, which is
    // the measurement that says a member has to be bought or nothing taken.
    expect(anchored.filter((t) => t === "Tera")).toHaveLength(1);
    // 🛑 …and the token that LEFT is proved to have left through the ROW rather than
    // through the MAP, on the template that shares the map and owns no literal row.
    expect(
      deriveAttackDamageBonus(
        "If you have any Stage 1 Pokémon on your Bench, this attack does 30 more damage.",
      ),
    ).toBeNull();
    // 🛑 **AND "Team Rocket's" LEFT THE WAY THIS ROW SAID IT WOULD HAVE TO.** D368
    // wrote it down as a trap because `energy: "special"` would ALSO match Reversal
    // Energy — a widening the printing does not ask for. D374 did not widen that
    // token map: it bought `yourActiveHasNamedEnergyAttached`, a LITERAL row keyed on
    // the whole printed clause, and the sentence now resolves to a member that reads
    // a printed card NAME rather than the Special class. Asserted here rather than in
    // the new suite alone, because the CLAIM being graded is this file's.
    const rocket =
      "If this Pokémon has any Team Rocket's Energy attached, this attack does 60 more damage.";
    expect(corpus().some(([, s]) => s === rocket)).toBe(true);
    expect(resolvedByAnyReader(rocket)).toBe(true);
    expect(deriveAttackDamageBonus(rocket)).toEqual({
      per: 60,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourActiveHasNamedEnergyAttached", name: "Team Rocket's Energy" },
      },
    });
    // …and the token map it did NOT learn: the trap's own widening stays unbought, so
    // the anchored template still refuses the string outright.
    expect(SELF_ENERGY.exec("this Pokémon has any Team Rocket's Energy attached")?.[1]).toBe(
      "Team Rocket's",
    );
  });
});
