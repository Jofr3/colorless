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
  deriveAttackRequirement,
} from "./effects";
import type { BoardCondition, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  OPPONENT_BENCH_COUNT_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setDamage,
} from "./testFixtures";

// 🆕🆕 D389 — THE OPPONENT-SEAT BENCH COUNT, AND THE SEAT-PARAMETER QUESTION THIS
// RUN DEFERRED FOR SIXTEEN SLICES.
//
// D366 shipped `yourBenchAtLeast` and named this exact printing in its own handoff
// as *"a DIFFERENT seat at a DIFFERENT threshold"*, leaving the shape question open.
// Every slice since has been able to avoid it. This one cannot: unlike D379's
// hand-size pair — which differed in the seat **AND** the comparator, two independent
// defects, so an ADDITION was forced — **this candidate differs from the shipped
// member in the SEAT ALONE**, which is the strongest case a seat parameter has ever
// had here.
//
// 🛑 **IT IS A SECOND MEMBER, ON THREE GROUNDS, ALL MEASURED AT THIS HEAD AND NONE
// QUOTED FORWARD — AND §1 DRIVES ALL THREE RATHER THAN ASSERTING THEM.**
//   ⑴ THE ENGINE HAD ALREADY ANSWERED THE SEAT QUESTION, THREE TIMES. `BoardCondition`
//      holds 49 members and NOT ONE carries a seat field, and it holds THREE pairs
//      that differ in the seat alone — `yourActiveDamaged`/`opponentActiveDamaged`,
//      `yourActivePoisoned`/`opponentActivePoisoned`, and
//      `yourActiveHasToolAttached`/`opponentActiveHasToolAttached` (D369, whose block
//      argues the point in as many words). D388's §1 move applied to a SHAPE rather
//      than to a noun phrase: before arguing, grep for whether this engine has already
//      answered it.
//   ⑵ AND D362's 31-SITE PRICE WAS RE-MEASURED RATHER THAN QUOTED — IT STANDS.
//      `yourBenchAtLeast` occurs 35 times across 10 files, of which **22 are
//      EXECUTABLE** (20 `kind:` literals and 2 exhaustive-switch arms) across 5 files.
//      The handoff was explicit that the number might collapse, because this member
//      has ONE clause row and TWO arms; it does not. The second member edits ZERO
//      existing sites.
//   ⑶ AND THE NOTE PROVES THE PARAMETER WOULD SAVE NOTHING: `conditionNote` renders a
//      DIFFERENT PRINTED SENTENCE per seat, so a `seat` field moves two strings into a
//      branch inside one arm rather than deleting a body — and pays the rename on top.
//
// ⚠️ **AND THE REFUSAL IS NOT TAKEN ON THE ARITHMETIC ALONE.** D365 recorded that
// re-pointing a shipped member at a seat parameter is a RENAME until proven otherwise
// and D366 reproduced it; this run had never actually tested it. §1 drives EVERY live
// consumer of `yourBenchAtLeast` on a board — its one clause row and both its arms —
// and then drives the two members APART on one board.
//
// WHAT SHIPS: **1 parameterised union member** (`opponentBenchAtLeast`) with **2
// reader arms**, and **1 literal clause row**. Iron Crown `sv08-132` "Deleting Slash"
// ({M}{C}, `40+`, **+80**, index 0 of TWO), **1 legal printing**. ONE fixture, ONE
// dedicated 60, ZERO new card predicates. `MATCH_RECORD_VERSION` **STAYS 23**.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/** 🛑 THE **TWELVE**-reader instrument, which is the only one D385 allows as a
    REFUSAL ORACLE: a set that omits a live reader can call a sentence "refused" that
    some reader already claims.

    🛑🛑🛑 **D418 — CORRECTED IN PLACE, WITH THE WRONG CLAUSES LEFT STANDING ABOVE
    THEIR CORRECTION, WHICH IS THIS REPO'S RULE (D178: what a claim was WARRANTED BY
    is the part that rots).** This block read, verbatim:

    > *"🛑 THE **TEN**-reader instrument, which is the only one D385 allows as a
    > REFUSAL ORACLE: a set that omits a live reader can call a sentence "refused"
    > that some reader already claims. `censusAtHead.test.ts` runs these ten;
    > `benchNamedBonus.test.ts` and `retreatCostBonus.test.ts` run the NINE without
    > `deriveAttackOptionalCostBoost`, and both numbers are right for what they
    > measure. ⚠️ The residue partition below is asserted to be the SAME under both
    > sets, so the choice of instrument is a measured invariant here rather than a
    > preference."*

    ⚠️⚠️ **THE FIRST SENTENCE IS AN EXACT DIAGNOSIS OF THE PARAGRAPH THAT FOLLOWS
    IT.** *"A set that omits a live reader can call a sentence 'refused' that some
    reader already claims"* — that is what this file's own set was doing, in this
    file's own §5, while the sentence sat here being true. Four things after it were
    false at D418's head:

      • **"THE TEN-reader instrument"** — the list under it was **ELEVEN** long. The
        prose and the code it annotated disagreed, and neither matched the module.
      • **"`censusAtHead.test.ts` runs these ten"** — it runs **TWELVE**, and had
        since D417 the day before.
      • **"`benchNamedBonus.test.ts` and `retreatCostBonus.test.ts` run the NINE
        without `deriveAttackOptionalCostBoost`"** — they were missing **THREE**
        readers, not one: `deriveAttackOptionalCostBoost` (D381),
        `deriveAttackDiscardScaledBoost` (D403) and `deriveAttackCancelRequirement`
        (D417). Naming the ONE turned an unnoticed gap into a SPECIFIED one, which is
        strictly worse: a reader looking for drift would have found the difference
        already accounted for.
      • **"both numbers are right for what they measure"** — ⚠️ **NEITHER WAS.** The
        nine-reader files measured 406 / 1,347 and the truth over their own corpus is
        412 / 1,364; this file measured 411 / 1,363 and the truth is 412 / 1,364
        (🆕🆕 D420 then took that figure to 415 / 1,368 through the RAW summand). The
        clause reads as a considered reconciliation of two instruments and was in
        fact two wrong numbers being excused by each other.

    ⚠️ **WHAT SURVIVES INTACT IS THE LAST SENTENCE, AND IT IS WHY THE DAMAGE STOPPED
    HERE**: the residue partition below IS asserted under two instruments, and that
    invariant held — the nine-reader and the full-surface partitions agree on §5's
    residue to the digit. An invariant between two instruments cannot notice that
    BOTH are short of the module. Only a comparison against the module can, and that
    is now the first rung of §5.

    ⚠️ §5's figures come from `resolvedByAnyReader` IMPORTED FROM
    `censusAttackCorpus.ts`, off the MODULE surface. This list is a DECLARED
    EXPECTATION diffed against the module, plus the SOURCE of the nine-reader
    comparison instrument below. */
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
  // 🆕🆕 D418 — the TWELFTH (D417). ⚠️ IT GOES AT THE END ON PURPOSE: `resolvedByNine`
  // below is `READERS.slice(0, 9)`, so the nine-reader comparison instrument is
  // positional and every reader added after D317 must land behind the ninth.
  deriveAttackCancelRequirement,
];
/** The NINE — ⚠️ **AND D418 CORRECTED WHAT THEY ARE.** This read *"the NINE, as the
    sibling files spell them"*, and that was true and was the problem: five sibling
    files DID spell nine, in August 2026, against a twelve-reader module. They spell
    twelve now. So this is no longer a description of what anybody else runs; it is a
    DELIBERATE SHORT INSTRUMENT, kept because §5's residue invariant is worth having
    — it shows the partition does not depend on where the reader surface stops.
    ⚠️ It is not, and never was, a check that the surface is complete. */
const resolvedByNine = (text: string): boolean =>
  READERS.slice(0, 9).some((read) => read(text) !== null);

/** THE SENTENCE THIS SLICE BUYS, byte for byte off the printing. */
const TAKEN =
  "If your opponent has 3 or more Benched Pokémon, this attack does 80 more damage.";

/** The one id behind it — Iron Crown `sv08-132`, "Deleting Slash" at index 0 of TWO,
    confirmed by id against tcgdex (`/v2/en/cards/sv08-132`: 130 HP, `Basic`,
    `types: ["Metal"]`, cost {M}{C}, damage `40+`, this effect byte for byte) and by
    INTERSECTING two brace-free limitlesstcg `text:` searches, which meet at Iron
    Crown SSP 132 as the only Standard printing. The PRINTING COUNT is
    `legalAttackCorpus()`'s, never the web's. */
const TAKEN_ID = "sv08-132";

/** The SIBLING sentence — the same board fact on the OTHER seat, at the other
    threshold, under the other consequent. D366 shipped it and handed this one on. */
const SIBLING = "If you have 4 or fewer Benched Pokémon, this attack does nothing.";

/** This slice's condition at its printed threshold, and the shipped twin it differs
    from in the SEAT ALONE. */
const COND: BoardCondition = { kind: "opponentBenchAtLeast", count: 3 };
const TWIN: BoardCondition = { kind: "yourBenchAtLeast", count: 3 };

/** 🛑 THE THREE PAIRS THIS UNION ALREADY CARRIES THAT DIFFER IN THE SEAT ALONE, each
    shipped as a SECOND MEMBER rather than as a seat parameter. Named as VALUES, so
    collapsing any pair into a parameter deletes a member kind and this table stops
    compiling — which is the strongest form the claim can take. */
const SEAT_PAIRS: readonly (readonly [BoardCondition, BoardCondition])[] = [
  [{ kind: "yourActiveDamaged" }, { kind: "opponentActiveDamaged" }],
  [{ kind: "yourActivePoisoned" }, { kind: "opponentActivePoisoned" }],
  [{ kind: "yourActiveHasToolAttached" }, { kind: "opponentActiveHasToolAttached" }],
];

// ── boards ─────────────────────────────────────────────────────────────────────

/** P1 fields the printed attacker with {M}{C} paid and P2 fields the 200 HP
    defender; BOTH benches are emptied and then filled to exactly the depths asked
    for, because `setActiveFromDeck` DISPLACES rather than replaces and a stray body
    is precisely the thing this file must not have. Returned on P2's turn. */
function ready(seed: number, opponentBench: number, ownBench = 0): GameState {
  let state = driveSetup(
    seed,
    { p1: OPPONENT_BENCH_COUNT_DECK, p2: OPPONENT_BENCH_COUNT_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p1", "fix-deletingslash");
  state = attachFromDeck(state, "p1", "fix-metal-energy", 1);
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(clearBench(state, "p1"), "p2");
  for (let i = 0; i < opponentBench; i += 1) state = benchFromDeck(state, "p2", "fix-benchfiller");
  for (let i = 0; i < ownBench; i += 1) state = benchFromDeck(state, "p1", "fix-benchfiller");
  return state;
}

/** …and the same board handed to P1 with the turn already passed. P1 went SECOND,
    so this turn carries no §4 attack restriction. */
function armed(seed: number, opponentBench: number, ownBench = 0): GameState {
  return mustApply(ready(seed, opponentBench, ownBench), { type: "endTurn", seat: "p2" }).state;
}

/** Attack at `index` — 0 is the printed "Deleting Slash", 1 the printed control
    "Slicing Blade" — and report the damage actually dealt. */
function damageDealt(state: GameState, index = 0): number {
  const after = mustApply(state, { type: "attack", seat: "p1", index });
  const dealt = after.events.find((e) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

const benchOf = (state: GameState, seat: Seat): number => state.players[seat].bench.length;

describe("§1 — the SHAPE question: a SECOND MEMBER, and the price re-measured", () => {
  it("🛑 the sentence is real, is worth ONE printing, and was refused at D388's head", () => {
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(1);
    expect(corpus().filter(([, s]) => s === TAKEN)).toHaveLength(1);
    // It reached the SKELETON all along and missed at the TABLE — refused by
    // VOCABULARY and never by the ANCHOR, which is D363's distinction and an order of
    // magnitude in price.
    expect(BONUS.test(TAKEN)).toBe(true);
    expect(BONUS.exec(TAKEN)?.[2]).toBe("80");
    // The clause is what the table is keyed on, and it is the printed bytes between
    // the leading "If " and the ", this attack does".
    expect(BONUS.exec(TAKEN)?.[1]).toBe("your opponent has 3 or more Benched Pokémon");
  });

  it("🛑 ⑴ the union already answers the SEAT question three times — and never with a field", () => {
    // The precedent, driven as VALUES rather than quoted from a doc block: three
    // pairs, six distinct members, six DISTINCT notes. Collapsing any pair into a
    // seat parameter deletes a member kind, and this table stops compiling.
    const notes = new Set<string>();
    for (const [own, far] of SEAT_PAIRS) {
      expect(own.kind, far.kind).not.toBe(far.kind);
      notes.add(conditionNote(own));
      notes.add(conditionNote(far));
    }
    expect(notes.size).toBe(6);
    // …and this slice's pair is the FOURTH, spelled the same way.
    expect(COND.kind).not.toBe(TWIN.kind);
    expect(conditionNote(COND)).not.toBe(conditionNote(TWIN));
    // The seat-alone claim is not decoration: on ONE board each pair DISAGREES,
    // which is what makes the two members two predicates and not one name twice.
    // Damage is the cheapest of the three to build, so it is the one driven here.
    const damaged = setDamage(ready(3101, 0), "p2", 50);
    expect(conditionHolds(damaged, "p1", { kind: "yourActiveDamaged" })).toBe(false);
    expect(conditionHolds(damaged, "p1", { kind: "opponentActiveDamaged" })).toBe(true);
    // …and from the other seat the two answers swap, which is what "seat-relative"
    // means and what a hard-coded `"p2"` would fail.
    expect(conditionHolds(damaged, "p2", { kind: "yourActiveDamaged" })).toBe(true);
    expect(conditionHolds(damaged, "p2", { kind: "opponentActiveDamaged" })).toBe(false);
  });

  it("🛑 ⑵ every live consumer of the SHIPPED member still answers — a re-pointing was a RENAME", () => {
    // D365 recorded it and D366 reproduced it: re-pointing a seat-named member at a
    // seat parameter is a RENAME until proven otherwise, so the refusal is only worth
    // what its evidence is. `yourBenchAtLeast`'s live consumers are ONE clause row and
    // TWO arms, and all three are driven here rather than counted.
    expect(deriveAttackRequirement(SIBLING)).toEqual({ kind: "yourBenchAtLeast", count: 5 });
    const five = armed(3102, 0, 5);
    expect(benchOf(five, "p1")).toBe(5);
    expect(conditionHolds(five, "p1", { kind: "yourBenchAtLeast", count: 5 })).toBe(true);
    expect(conditionHolds(five, "p1", { kind: "yourBenchAtLeast", count: 6 })).toBe(false);
    expect(conditionNote({ kind: "yourBenchAtLeast", count: 5 })).toBe(
      "you have 5 or more Benched Pokémon",
    );
    // …and its clause row is UNTOUCHED in both directions: the shipped key still maps
    // to the shipped member, and this slice's key does not reach it.
    expect(deriveAttackRequirement(TAKEN)).toBeNull();
    expect(deriveAttackDamageBonus(SIBLING)).toBeNull();
  });

  it("🛑 ⑶ the NOTE is a DIFFERENT printed sentence per seat, so a seat field saves no body", () => {
    // The measured reason the parameter is a false economy rather than merely
    // unconventional: `conditionNote` has to write both strings whatever the shape
    // is, so a `seat` field moves them into a branch inside one arm and pays the
    // rename on top.
    expect(conditionNote(TWIN)).toBe("you have 3 or more Benched Pokémon");
    expect(conditionNote(COND)).toBe("your opponent has 3 or more Benched Pokémon");
    // …and THIS one is a FULL round trip: byte-identical to its clause-table key,
    // which the twin's can never be. That is what the two seats print differently.
    expect(conditionNote(COND)).toBe(BONUS.exec(TAKEN)?.[1]);
    expect(TAKEN).toContain(conditionNote(COND));
    expect(TAKEN).not.toContain(conditionNote(TWIN));
    // Both are built from the PARAMETER, so a second printed threshold is legible
    // without a second string on either seat.
    expect(conditionNote({ kind: "opponentBenchAtLeast", count: 5 })).toBe(
      "your opponent has 5 or more Benched Pokémon",
    );
  });

  it("the price, as arithmetic rather than as prose — 1 / 2 against the Prize row's 2 / 9", () => {
    // D382's practice, inherited by seven consecutive slices. The mechanisms are
    // counted D386's way ("the member plus its two arms" is ONE): the parameterised
    // member with its two arms, and the clause row. There is NO third — no card
    // predicate, because a Bench length needs none.
    const mine = { printings: 1, mechanisms: 2 };
    const prizeRow = { printings: 2, mechanisms: 9 };
    expect(mine.printings).toBe(units(corpus().filter(([, s]) => s === TAKEN)));
    expect(mine.printings / mine.mechanisms).toBeGreaterThan(
      prizeRow.printings / prizeRow.mechanisms,
    );
    // …and the loser's printing count is still what D385 measured, so the comparison
    // is between two live numbers and not between a live one and a remembered one.
    const prizeSentence =
      "You may turn 1 of your face-down Prize cards face up. If you do, this attack does 80 more damage. (That Prize card remains face up for the rest of the game.)";
    expect(units(corpus().filter(([, s]) => s === prizeSentence))).toBe(prizeRow.printings);
    expect(resolvedByAnyReader(prizeSentence)).toBe(false);
  });
});

describe("§2 — the clause row: one PARAMETERISED member, two arms, and the anchors", () => {
  it("🛑 buys ONE member with TWO arms — the two exhaustive switches, and no more", () => {
    expect(typeof conditionHolds(ready(3201, 3), "p1", COND)).toBe("boolean");
    expect(conditionNote(COND)).toBe("your opponent has 3 or more Benched Pokémon");
  });

  it("the clause row resolves to the member AT COUNT 3, and the amount comes off the SKELETON", () => {
    const read = deriveAttackDamageBonus(TAKEN);
    expect(read).not.toBeNull();
    expect(read?.count).toEqual({ kind: "boardCondition", cond: COND });
    expect((read?.count as { cond: { count: number } }).cond.count).toBe(3);
    // The amount is captured one layer up, never off the clause row — which is why
    // this one row would serve a second printed amount for free.
    expect(read?.per).toBe(Number(BONUS.exec(TAKEN)?.[2]));
    expect(read?.per).toBe(80);
  });

  it("keeps the two CONSEQUENTS disjoint — D125's rule, on this clause", () => {
    expect(deriveAttackRequirement(TAKEN)).toBeNull();
    const clause = BONUS.exec(TAKEN)?.[1] ?? "";
    expect(deriveAttackRequirement(`If ${clause}, this attack does nothing.`)).toBeNull();
  });

  it("🛑 the SIBLING key cannot reach this row, and this row cannot reach the SIBLING key", () => {
    // The two bench-count board facts are now spelled by two members under two
    // consequents, and the sharpest way for that to go wrong is for one to claim the
    // other's sentence. Both directions.
    expect(deriveAttackDamageBonus(SIBLING)).toBeNull();
    expect(deriveAttackRequirement(TAKEN)).toBeNull();
    expect(deriveAttackRequirement(SIBLING)).not.toEqual(COND);
    expect(deriveAttackDamageMultiplier(TAKEN)).toBeNull();
    expect(deriveAttackDamagePenalty(TAKEN)).toBeNull();
  });

  it("the anchors are whole-sentence at BOTH ends — no substring and no near threshold reaches the row", () => {
    // The key is a WHOLE printed clause and never a substring, so a threshold the
    // catalog does not print resolves to NOTHING rather than to this row at the wrong
    // count — an unrecognised clause must stay LOUD (ATTACK_EFFECT_SKIPPED), never
    // silently score at 0 or at 3.
    for (const n of [1, 2, 4, 5]) {
      const near = `If your opponent has ${String(n)} or more Benched Pokémon, this attack does 80 more damage.`;
      expect(deriveAttackDamageBonus(near), String(n)).toBeNull();
    }
    // …the OWN-side mirror, which is the whole seat question spelled as a sentence
    // the catalog does not print under this consequent.
    expect(
      deriveAttackDamageBonus(
        "If you have 3 or more Benched Pokémon, this attack does 80 more damage.",
      ),
    ).toBeNull();
    // …the "or fewer" polarity, which would be a different member entirely.
    expect(
      deriveAttackDamageBonus(
        "If your opponent has 3 or fewer Benched Pokémon, this attack does 80 more damage.",
      ),
    ).toBeNull();
    // …the IN-PLAY wording, which counts one body more.
    expect(
      deriveAttackDamageBonus(
        "If your opponent has 3 or more Pokémon in play, this attack does 80 more damage.",
      ),
    ).toBeNull();
    // Lowercase `if` — the skeleton has no /i — and a leading companion pins `^`.
    expect(deriveAttackDamageBonus(TAKEN.replace(/^If/, "if"))).toBeNull();
    expect(deriveAttackDamageBonus(`Flip a coin. ${TAKEN}`)).toBeNull();
    expect(deriveAttackDamageBonus(TAKEN.replace(/\.$/, ", and discard an Energy."))).toBeNull();
  });
});

describe("§3 — on a BOARD: the opponent's Bench from 0 to 5, and the turn at 3", () => {
  it("🛑 the whole ladder — 0,1,2 deal the printed 40 and 3,4,5 deal 120", () => {
    // Every legal Bench size, driven as a ladder rather than as two boards, so
    // `count: 2`, `count: 4` and a strict `>` are each red on a rung of their own.
    for (let n = 0; n <= 5; n += 1) {
      const state = armed(3300 + n, n);
      expect(benchOf(state, "p2"), `bench ${String(n)}`).toBe(n);
      expect(conditionHolds(state, "p1", COND), `bench ${String(n)}`).toBe(n >= 3);
      expect(damageDealt(state), `bench ${String(n)}`).toBe(n >= 3 ? 120 : 40);
    }
  });

  it("🛑 the boundary is between 2 and 3 and it is the ONLY one — off by one either way is a real card", () => {
    // Both neighbours of the printed 3 are reachable Bench sizes, which is what makes
    // a stored 2 or a stored 4 a real bug rather than a formatting difference.
    const two = armed(3310, 2);
    const three = armed(3311, 3);
    expect(conditionHolds(two, "p1", { kind: "opponentBenchAtLeast", count: 2 })).toBe(true);
    expect(conditionHolds(two, "p1", COND)).toBe(false);
    expect(conditionHolds(three, "p1", COND)).toBe(true);
    expect(conditionHolds(three, "p1", { kind: "opponentBenchAtLeast", count: 4 })).toBe(false);
    // "or more" is a FLOOR (`>=`), the twin's reading: at exactly the threshold the
    // clause HOLDS, and a `>` build deals 40 here.
    expect(damageDealt(three)).toBe(120);
  });

  it("🛑 the ACTIVE SPOT IS NOT COUNTED — an Active and two Benched is not three Benched", () => {
    const state = armed(3320, 2);
    expect(state.players.p2.active).not.toBeNull();
    expect(benchOf(state, "p2")).toBe(2);
    // Three Pokémon in play, two Benched. If the Active were spread in, this would
    // hold — the printed word is "Benched", exactly as the twin reads it.
    expect(1 + benchOf(state, "p2")).toBe(3);
    expect(conditionHolds(state, "p1", COND)).toBe(false);
    expect(damageDealt(state)).toBe(40);
  });

  it("an EMPTY opponent Bench is FALSE at every printed threshold above zero", () => {
    const state = armed(3330, 0);
    expect(benchOf(state, "p2")).toBe(0);
    for (const count of [1, 2, 3, 4, 5]) {
      expect(
        conditionHolds(state, "p1", { kind: "opponentBenchAtLeast", count }),
        String(count),
      ).toBe(false);
    }
    // …and a threshold of 0 is vacuously TRUE, which is a `>=` fact and not a special
    // case — stated so a build that special-cased the empty Bench to `false` is red.
    expect(conditionHolds(state, "p1", { kind: "opponentBenchAtLeast", count: 0 })).toBe(true);
  });

  it("the CONTROL attack is untouched by the clause — index 1 deals its flat 100 at every Bench", () => {
    // The printed card's second attack, at its printed index. The clause is on
    // "Deleting Slash" alone, so a bonus that leaked onto the body rather than onto
    // the attack shows up here and nowhere else.
    // Its printed cost is one {C} MORE than "Deleting Slash"'s, so the third symbol is
    // attached here and NOWHERE else — every other board in this file carries exactly
    // the printed {M}{C} of the attack it declares.
    for (const n of [0, 3, 5]) {
      const state = attachFromDeck(armed(3340 + n, n), "p1", "fix-energy", 1);
      expect(conditionHolds(state, "p1", COND), `bench ${String(n)}`).toBe(n >= 3);
      expect(damageDealt(state, 1), `bench ${String(n)}`).toBe(100);
    }
  });
});

describe("§4 — THE SEAT IS THE WHOLE MEMBER, and it is driven rather than named", () => {
  it("🛑 a FULL OWN Bench does NOT satisfy it — the defect the second member exists to avoid", () => {
    // 🛑 THE RUNG THE WHOLE SLICE RESTS ON. The mistake an author would actually make
    // is `state.players[seat].bench.length`, copied down from the twin one line up:
    // it is green on every board where the two Benches happen to match, and wrong
    // here. P1 has FIVE Benched and P2 has NONE.
    const state = armed(3401, 0, 5);
    expect([benchOf(state, "p1"), benchOf(state, "p2")]).toEqual([5, 0]);
    expect(conditionHolds(state, "p1", COND)).toBe(false);
    expect(damageDealt(state)).toBe(40);
    // …and the twin says TRUE on the very same board and the very same seat, which is
    // the two members differing in the SEAT ALONE, shown rather than argued.
    expect(conditionHolds(state, "p1", TWIN)).toBe(true);
    expect(conditionHolds(state, "p1", COND)).not.toBe(conditionHolds(state, "p1", TWIN));
  });

  it("🛑 …and the MIRROR: a full OPPONENT Bench with an empty own Bench lands the 120", () => {
    // The other half of the same statement, so a build that read the seats backwards
    // is red on one of the two rather than green on both.
    const state = armed(3402, 5, 0);
    expect([benchOf(state, "p1"), benchOf(state, "p2")]).toEqual([0, 5]);
    expect(conditionHolds(state, "p1", COND)).toBe(true);
    expect(conditionHolds(state, "p1", TWIN)).toBe(false);
    expect(damageDealt(state)).toBe(120);
  });

  it("🛑 it is SEAT-RELATIVE, not hard-coded to p2 — one board, two seats, opposite answers", () => {
    // `conditionHolds` is seat-RELATIVE, which is the reason D369 gives for writing a
    // second arm rather than a recursive call on the twin. A build spelling `"p2"`
    // instead of `otherSeat(seat)` is green on the first call and red on the second.
    const state = ready(3403, 0, 5);
    expect([benchOf(state, "p1"), benchOf(state, "p2")]).toEqual([5, 0]);
    expect(conditionHolds(state, "p1", COND)).toBe(false);
    expect(conditionHolds(state, "p2", COND)).toBe(true);
    // …and the twin's two answers are the exact complement, on the same board.
    expect(conditionHolds(state, "p1", TWIN)).toBe(true);
    expect(conditionHolds(state, "p2", TWIN)).toBe(false);
  });

  it("the two seats move INDEPENDENTLY — a board where both are 3 answers TRUE for both", () => {
    // The board where the two members AGREE, named as such: a suite that only ever
    // fielded symmetric benches would be green under the wrong-seat build, which is
    // exactly what the rungs above refuse. This one exists so the agreement case is
    // measured rather than absent.
    const state = armed(3404, 3, 3);
    expect([benchOf(state, "p1"), benchOf(state, "p2")]).toEqual([3, 3]);
    expect(conditionHolds(state, "p1", COND)).toBe(true);
    expect(conditionHolds(state, "p1", TWIN)).toBe(true);
    expect(conditionHolds(state, "p2", COND)).toBe(true);
    expect(damageDealt(state)).toBe(120);
  });
});

describe("§5 — the fixture, the census this row moves, and the summands it does not", () => {
  it("🆕🆕 D418 — the hand-kept READERS list IS the module's reader surface", () => {
    // 🛑 THE GUARD THIS FILE NEVER HAD, IN D417's SHAPE, and the file with the least
    // excuse for not having it: its `READERS` doc block STATES the failure mode —
    // *"a set that omits a live reader can call a sentence 'refused' that some reader
    // already claims"* — and then went on to omit one for a day and publish 411 /
    // 1,363 for a corpus whose true figure is 412 / 1,364 (🆕🆕 D420: 415 / 1,368).
    // ⚠️ AND THE INVARIANT BELOW COULD NOT HAVE CAUGHT IT: comparing the NINE-reader
    // partition against this list's compares two SHORT instruments to each other, and
    // two instruments that are both behind the module agree perfectly. Only a
    // comparison AGAINST THE MODULE closes it, which is this rung.
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    // ⚠️ THE COUNT IS PINNED SEPARATELY FROM THE DIFF: a diff alone stays GREEN when a
    // reader is deleted from the module and this list in one commit, and every figure
    // below would move with nothing naming the cause.
    expect(attackReaderSurface()).toHaveLength(12);
  });

  it("the demonstrator is the printed card — TWO attacks at their printed indices, and the `40+` is real", () => {
    // D306: transcribed, not interpolated. The real card prints TWO attacks and so
    // does this, and the "+" marker is load-bearing — the reader consumes it and
    // attack.ts drops the printed base into the gate, so a flat `40` would exercise
    // the wrong half of the assembly.
    const card = FIXTURE_POOL["fix-deletingslash"];
    const attacks = card?.attacks ?? [];
    expect(attacks).toHaveLength(2);
    expect(attacks[0]?.name).toBe("Deleting Slash");
    expect(attacks[0]?.damage).toBe("40+");
    expect(attacks[0]?.cost).toEqual(["Metal", "Colorless"]);
    expect(attacks[0]?.effect).toBe(TAKEN);
    expect(attacks[1]?.name).toBe("Slicing Blade");
    expect(attacks[1]?.damage).toBe(100);
    expect(attacks[1]?.cost).toEqual(["Metal", "Colorless", "Colorless"]);
    expect(attacks[1]?.effect ?? null).toBeNull();
    expect([card?.hp, card?.stage, card?.retreat]).toEqual([130, "Basic", 2]);
    expect(card?.types).toEqual(["Metal"]);
    // 🛑 NO WEAKNESS AND NO RESISTANCE ANYWHERE IN THE CAST, which is what makes the
    // 40 and the 120 attributable to the clause and to nothing else.
    for (const id of ["fix-deletingslash", "fix-bigbody", "fix-benchfiller"]) {
      expect(FIXTURE_POOL[id]?.weaknesses ?? null, id).toBeNull();
      expect(FIXTURE_POOL[id]?.resistances ?? null, id).toBeNull();
    }
    // …and the defender outlives the BOOSTED total, so no §8.1 Prize tail ever runs
    // underneath an assertion whose subject is the damage number.
    expect(FIXTURE_POOL["fix-bigbody"]?.hp ?? 0).toBeGreaterThan(120);
  });

  it("🛑 the ONE id is all of the sentence's printings, and it is not in the registry", () => {
    // The standing-still of the other summands, MEASURED not assumed: a READER-keyed
    // move must be shown not to touch the REGISTRY-keyed one.
    const ids = new Set(registryCardIds());
    expect(ids.has(TAKEN_ID)).toBe(false);
    expect(programFor(TAKEN_ID)).toBeUndefined();
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(1);
  });

  it("🛑 the corpus prints exactly TWO bench-count board facts, and they differ in seat AND threshold", () => {
    // D366's own census, re-derived at this head — and now BOTH are built, which is
    // the step. It is also the rung that keeps the parameter honest: the catalog
    // varies the THRESHOLD, so a threshold buried in a member name would already have
    // cost a second member.
    const benchCounts = corpus().filter(
      ([, s]) => /\d+ or (fewer|more) Benched Pokémon/.test(s) && !s.includes("damage counters"),
    );
    expect(benchCounts.map(([, s]) => s).sort()).toEqual([SIBLING, TAKEN]);
    expect(benchCounts.every(([, s]) => resolvedByAnyReader(s))).toBe(true);
    // Different seat, different threshold, different consequent — three axes, and
    // only ONE of them is a member field.
    expect(SIBLING).toContain("you have");
    expect(TAKEN).toContain("your opponent has");
    expect(deriveAttackRequirement(SIBLING)).toEqual({ kind: "yourBenchAtLeast", count: 5 });
    expect((deriveAttackDamageBonus(TAKEN)?.count as { cond: { count: number } }).cond.count).toBe(
      3,
    );
  });

  it("🛑 the bonus residue is 16 / 19, and the 2-PRINTING BAND IS STILL EMPTY", () => {
    // Re-derived from the parts rather than quoted, and the DEPARTURE is what the
    // band rung asserts (D379's saturation rule): an absence is not a measurement, so
    // the whole distribution is stated and the refusal is driven from OUTSIDE the
    // emptied band.
    const openers = corpus().filter(([, s]) => BONUS.test(s.trim()));
    expect([openers.length, units(openers)]).toEqual([81, 129]);
    const refused = openers.filter(([, s]) => !resolvedByAnyReader(s));
    // 🆕🆕 D390 — 16 / 19 -> **15 / 18**: the OPPONENT-SEAT TYPE READ left this residue
    // — ONE sentence at ONE printing (Electivire `sv05-054` "Short-Circuit Knuckle",
    // +120) — re-derived live rather than decremented. 🛑 THE 2-PRINTING BAND STAYS
    // EMPTY and the distribution goes `{1: 14, 5: 1}` -> `{1: 13, 5: 1}`.
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
    expect([refused.length, units(refused)]).toEqual([7, 10]); // 🆕🆕 D398 — the DECK-SIZE READ took the LAST BUILDABLE sentence out (Rabsca `sv08-014` "Counterturn", 1 printing), so 8 / 11 -> 7 / 10 and the residue is now EXHAUSTED of buildable rows: FIVE D207 banners and D368's 5-printing SHAPE refusal are all that is left, and this figure can only move again if a refusal's REASON expires
    // ⚠️ AND THE PARTITION DOES NOT DEPEND ON WHICH INSTRUMENT DRAWS IT: the NINE
    // readers and the TEN agree on this residue exactly, so D385's "only the
    // ten-reader one may be a refusal oracle" is satisfied here without the two
    // numbers being allowed to drift apart silently.
    const refusedByNine = openers.filter(([, s]) => !resolvedByNine(s));
    // 🆕🆕 D391 — 15 / 18 -> **14 / 17** on the NINE-reader instrument too, the same
    // ONE sentence / ONE printing step the ten-reader one takes.
    // 🆕🆕 D392 — 14 / 17 -> 13 / 16, the SUBSTRING NAME READ leaving the residue.
    expect([refusedByNine.length, units(refusedByNine)]).toEqual([7, 10]); // 🆕🆕 D398 — 1 sentence / 1 printing out (THE DECK-SIZE READ) // 🆕🆕 D397 — 9 / 12 -> 8 / 11, the BENCHED-CUBONE FILTER leaving the residue on ONE sentence // 🆕🆕 D394 — 11 / 14 -> 9 / 12, the USED-ATTACK PAIR leaving the residue on the NINE-reader instrument too
    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    // 🆕🆕 D389 — `{1: 15, 5: 1}` → `{1: 14, 5: 1}`. The band `n > 1` is STILL `[5]`
    // and still the DECLARATION clause D368 disqualified on SHAPE, which is outside
    // the 2-printing band by construction and is what keeps this rung able to go red
    // for the reason that matters: a reader narrowing so any clause returns to 2
    // fails it, as does that clause being claimed.
    expect([...byClause.values()].filter((n) => n > 1)).toEqual([5]);
    // 🆕🆕 D390 — `{1: 14, 5: 1}` → `{1: 13, 5: 1}`: the OPPONENT-SEAT TYPE READ left
    // the singleton band and nothing else moved. The band `n > 1` is STILL `[5]`.
    // 🆕🆕 D391 — the TYPED PER-BODY ENERGY THRESHOLD left the 1-printing band too.
    // 🆕🆕 D392 — 12 -> **11**, the whole of this slice's step.
    expect([...byClause.values()].filter((n) => n === 1)).toHaveLength(5); // 🆕🆕 D398 — the DECK-SIZE READ left the singleton band, 6 -> 5 // // 🆕🆕 D397 — the BENCHED-CUBONE FILTER took ONE more singleton out, back to a 1:1 step // 🆕🆕 D394 — the USED-ATTACK PAIR took TWO more singletons out at once, the second two-step in two slices
    // 🆕🆕 D391 — the TYPED PER-BODY ENERGY THRESHOLD left the 1-printing band too.
    // 🆕🆕 D392 — 13 -> **12**: the SUBSTRING NAME READ's clause left the 1-printing band.
    expect(byClause.size).toBe(6); // 🆕🆕 D398 — the DECK-SIZE READ took ONE more singleton out, a 1:1 step, and it was the LAST BUILDABLE one // 🆕🆕 D397 — the BENCHED-CUBONE FILTER took ONE more singleton out, back to a 1:1 step // 🆕🆕 D394 — the USED-ATTACK PAIR took TWO more singletons out at once, the second two-step in two slices
    expect(
      resolvedByAnyReader(
        "If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack does 80 more damage.",
      ),
    ).toBe(false);
    // …and this slice's sentence has LEFT the residue, which is the step itself.
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
  });

  it("the TEN-reader instrument steps by exactly 1 sentence / 1 printing", () => {
    // The 1:1 shape D382, D384, D387 and D388 took. Both columns, because a step in
    // one and not the other is a different event.
    const resolving = corpus().filter(([, s]) => resolvedByAnyReader(s));
    // 🆕🆕 D391 — +1 sentence / +1 printing: the TYPED PER-BODY ENERGY THRESHOLD, an
    // OPTIONAL FIELD on a shipped member rather than a new one, so the READER-keyed summand
    // moves and no registry summand does.
    expect([resolving.length, units(resolving)]).toEqual([415, 1368]); // 🆕🆕 D420 +3 sentences / +4 printings (THE HAND-ENERGY COST FAMILY — *"Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing."* (**2 legal printings**), *"Discard 2 Basic {G} Energy cards from your hand. If you can't discard 2 cards in this way, this attack does nothing."* (**1**) and *"Discard a Basic {G} Energy card from your hand. If you can't, this attack does nothing."* (**1**) — the six-Energy KO is EXACTLY the sentence D415's correction named as the KO residue NOTHING IN THIS REPO COULD BUILD, needing a hand-Energy COST and a does-nothing CANCEL rather than the park or the gate the other two residue members took; the other two printings charge the SAME cost, so all three are built TOGETHER rather than one at a time. Each is claimed WHOLE by ONE reader — `deriveAttackCancelRequirement`, whose `ATTACK_CANCEL_TRAILING` head list is WIDENED past D417's Stadium-only head — over TWO new `deriveAttackEffect` arms: 6f the bare cost, 6g the cost joined to a Knock Out by `", and "`, a COMMA join inside ONE sentence that `splitAttackTrailingClause`'s sentence-boundary `BREAK` cannot reach, which is why the compound needs an arm of its own rather than the composition path. 🛑 THE WHOLE DELTA ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER: a sentence claimed whole is RAW rather than split or compound, so `SPLIT_ATTACK_UNITS` stands still at 13 (the splitter finds no leading gate clause on any of the three), `COMPOUND_ATTACK_UNITS` at 18 (that term only ever counts what the whole-sentence anchors REFUSE, and these three are now claimed) and `REGISTRY_ATTACK_UNITS` at 16, the slice authoring no row. The engine version moves 0.321.0 → 0.322.0 and `MATCH_RECORD_VERSION` STAYS 26 — the cost pays through the SHIPPED `payFromHand` op and adds NO persisted field. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE DIFFERENT NUMBERS ON THE SAME ROW — 3 and 4, where D417's were 1 and 1 — the six-Energy KO printing on TWO ids and the other two on one each.) — 🆕🆕 D418 [411, 1363] → [412, 1364] with NOTHING SHIPPED: D417's `deriveAttackCancelRequirement` was live in `effects.ts` and missing from this file's list, so this figure called ONE sentence / ONE printing refused that a reader already claimed — the exact failure this file's own doc block describes. The FROZEN tail [371, 1268] does NOT move — 🆕🆕 D416 +2 sentences / +6 printings (THE PARKING KO PAIR — *"Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon."* (**4 legal printings**) and *"Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it."* (**2 legal printings**) — EXACTLY the two sentences D415 named as the residue that still needed a PARK, and they are built TOGETHER rather than one at a time because they are ONE op with two riders: ONE new PARKING `EffectOp` (`knockOutChosen`, REQUIRED `target: "opponentBench" | "opponentAny"` plus optional `basicOnly` / `damageCountersExactly`), reached through the EXISTING `choosePokemon` prompt and the EXISTING `KNOCKED_OUT` sweep. The op PARKS on `phase.cont.pendingOp` but adds ZERO persisted RECORD fields, so `MATCH_RECORD_VERSION` STAYS 26 (D307's paragraph: no v26 deploy can author `{ op: "knockOutChosen", … }` into a record THIS deploy reads) while the engine version moves 0.319.0 → 0.320.0. 🛑 THE WHOLE DELTA ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER: both sentences are claimed WHOLE by `deriveAttackEffect` (arms 6d and 6e), and a sentence resolved whole is RAW rather than split or compound, so `SPLIT_ATTACK_UNITS` stands still at 13 (the splitter finds no leading gate clause on either), `COMPOUND_ATTACK_UNITS` at 18 (that summand only ever counts what the whole-sentence anchors REFUSE, and these two are now claimed) and `REGISTRY_ATTACK_UNITS` at 16, the slice authoring no row. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE DIFFERENT NUMBERS ON THE SAME ROW — 2 and 6 — the flip sentence printing on FOUR ids and the counter-window sentence on TWO, where D415's were 1 and 1. ⚠️ AND EXACTLY ONE OF THE TWO JOINS `compoundCompose` §4's SHADOW-REFUSAL POPULATION, where D415's single sentence joined nothing: the flip sentence carries TWO `BREAK` boundaries (`Flip a coin.` ‖ `If heads, …` ‖ `If tails, …`) so it is THREE clauses, has always sat in the 271 multi-clause corpus, and is now claimed whole — 148 → **149** sentences / 421 → **425** printings; the counter-window sentence has no internal break at all, so it is ONE clause and was never in the 271. The `multiClause` pair 271 / 613 STANDS STILL, because both sentences were always IN the corpus and this slice changed only the CLAIM.) 🆕🆕 D415 +1 sentence / +1 printing (THE OPPONENT-SCOPED SPECIAL-ENERGY KO GATE — *"If your opponent's Active Pokémon has any Special Energy attached, it is Knocked Out."* — Haxorus `sv06.5-046`, **1 legal printing** — claimed WHOLE by `deriveAttackEffect` as ARM 6a WITH THE `cond` SWAPPED AND NOTHING ELSE: the same `conditionGate` over the same shipped FIELD-FREE `knockOutDefender` op D414 built, behind ONE new `BoardCondition` member `opponentActiveHasEnergyAttached` — the SEAT MIRROR of the shipped `yourActiveHasEnergyAttached`, same `energy` parameter, same `hasAttachedEnergy` predicate, one seat over. ZERO new readers, ZERO new effect fields and ZERO registry rows, so `MATCH_RECORD_VERSION` STAYS 26 while the engine version moves 0.318.0 → 0.319.0. 🛑 THE WHOLE DELTA ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER: the sentence is resolved WHOLE, and a sentence resolved whole is RAW rather than split or compound, so `SPLIT_ATTACK_UNITS` stands still at 13, `COMPOUND_ATTACK_UNITS` at 18 and `REGISTRY_ATTACK_UNITS` at 16. ⚠️ AND IT DOES NOT JOIN `compoundCompose` §4's SHADOW-REFUSAL POPULATION EITHER — it breaks on a COMMA and not on a sentence boundary, so it is ONE clause and was never among the 271 multi-clause sentences that rung counts; 148 / 421 STANDS STILL where D414's third sentence moved it. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE THE SAME NUMBER HERE — 1 and 1 — where D414's were 3 and 4.) 🆕🆕 D414 +3 sentences / +4 printings (THE KNOCK OUT THAT REACHES THE OTHER SIDE OF THE TABLE — *"If your opponent's Active Pokémon is a Basic Pokémon, it is Knocked Out."* (2), *"Both Active Pokémon are Knocked Out."* (1) and *"This Pokémon does 100 damage to itself. Flip a coin. If heads, your opponent's Active Pokémon is Knocked Out."* (1) — THREE whole-sentence anchors and THREE `deriveAttackEffect` arms over ONE new FIELD-FREE op (`knockOutDefender`), whose both-Actives spelling is a COMPOSITION of two shipped field-free ops rather than a `target` field, so no persisted union gains a member and `MATCH_RECORD_VERSION` STAYS 26. 🛑 THE WHOLE DELTA ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER, WHICH IS THE POINT: a reader claims each of the three sentences WHOLE, and a sentence resolved whole is RAW rather than split or compound. So `SPLIT_ATTACK_UNITS` stands still at 13 (the splitter finds no leading gate clause on any of the three), `COMPOUND_ATTACK_UNITS` stands still at 18 (the fourth summand only ever counts what the whole-sentence anchors REFUSE, and these three are now claimed), and `REGISTRY_ATTACK_UNITS` stands still at 16, the slice authoring no row. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE DIFFERENT NUMBERS ON THE SAME ROW — 3 and 4 — the Basic-gate sentence printing on TWO ids and the other two on one each. ⚠️ AND IT IS THE KO-WITHOUT-DAMAGE **SUBSET**: the printed family is SEVEN sentences / THIRTEEN printings and this slice takes exactly the four whose targets are NAMED by the printed text, the other three each needing a PARK over a filtered candidate set. 🛑 **THAT LAST CLAUSE WAS WRONG THREE WAYS AND IS CORRECTED IN PLACE BY D415 — NOT SILENTLY REWRITTEN: the original wording is left standing immediately above so the correction reads as one, per the family's standing rule that a witness moves rather than disappears.** (i) THE RESIDUE WAS FOUR SENTENCES / NINE PRINTINGS, NOT THREE — 4 + 4 sentences is the 7 this note counts, and 9 + 4 printings is the 13. (ii) THEY DID NOT "EACH" NEED A PARK, and "whose targets are NAMED" was never the discriminator that separated them: two of the four residue sentences name their targets in printed words as plainly as the three D414 took. What D414 actually took were the sentences needing NO vocabulary beyond the op and a shipped `BoardCondition`. **D415 then built a fourth on exactly those terms and needed no park at all** — *"If your opponent's Active Pokémon has any Special Energy attached, it is Knocked Out."* (Haxorus `sv06.5-046`, 1 printing), arm `6a` with the `cond` swapped and nothing else, over `opponentActiveHasEnergyAttached`: the SEAT MIRROR of the shipped `yourActiveHasEnergyAttached`, same `energy` parameter, same `hasAttachedEnergy` predicate, one seat over. ⚠️ SO THE RESIDUE AT HEAD IS THREE SENTENCES / EIGHT PRINTINGS, AND ONLY TWO OF THEM NEED A PARK: *"Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it."* (2) and *"Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon."* (4). The third is the HAND-ENERGY KO at `censusAttackCorpus.ts` line 93 — *"Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing."* (2) — which needs a hand-Energy COST and an *"If you can't …, this attack does nothing."* CANCEL, a different mechanism from both the park and the gate, and **NOTHING IN THIS REPO NAMED IT AT ALL** until D415 put it in `knockOutDefender.test.ts`'s `UNBUILT_TEXT` as `handEnergyKo`, where it can go red. ⚠️ THIS IS ONE OF THE NINE VERBATIM COPIES OF THE UNCORRECTED NOTE THAT `censusAtHead.test.ts` NAMED (`exOnlyActive`, `precociousEvolution`, `retreatCostBonus`, `sawkRequirementSplit`, `inPlayTypeBonus`, `sameEnergyBonus`, `moreEnergyBonus`, `opponentBenchCount`, `benchNamedBonus`) — D415 swept all nine rather than leaving them to be rediscovered.) 🆕🆕 D413 +2 sentences / +5 printings (THE ADDITIVE MULTI-COIN FOLD — *"Flip 2 coins. This attack does 30 more damage for each heads."* (3) and *"…does 50 more damage for each heads."* (2), ONE anchor (`ATTACK_COIN_MULTI_BONUS`) and ONE `deriveAttackCoinFlip` arm returning D129's `bonusOnHeads` over D127's `flips: { kind: "printed", count: 2 }` — a NEW COMBINATION of an already-shipped vocabulary and therefore not a new shape (D405's rule), so ZERO new ops, fields, readers, `BoardCondition` members or registry rows and `MATCH_RECORD_VERSION` STAYS 26. A READER-keyed move arriving through the RAW summand ALONE: a reader claims each sentence WHOLE, so `splitHead` and the COMPOUND term both stand still, and `REGISTRY_ATTACK_UNITS` stands still because this slice authors no rows.) 🆕🆕 D408 +2 sentences / +7 printings (THE BARE ATTACK LOCK, BOTH SEATS — *"During your opponent's next turn, the Defending Pokémon can't attack."* (3) and *"…can't use attacks."* (4), ONE ALTERNATION anchor (`DEFENDER_CANT_ATTACK_NEXT_TURN`) and ONE `deriveAttackEffect` arm returning D148's `preventAttack { target: "defender" }` unchanged: ZERO new ops, fields, readers, `BoardCondition` members or registry rows. ⚠️ THE SLICE'S THIRD SENTENCE MOVES NOTHING — *"During your next turn, this Pokémon can't use attacks."* (4 printings) ALREADY RESOLVED, to a lock keyed on an attack no card is named, so repairing it is invisible to every census figure) 🆕🆕 D407 +1 sentence / +4 printings (THE BOARD-WIDE OWN-ENERGY COUNT — *"This attack does 30 more damage for each {G} Energy attached to all of your Pokémon."*, ONE WIDENED whole-sentence anchor (`SELF_ENERGY_SCALE`) and ONE OPTIONAL `zone` on the SHIPPED `energyOnSelf` member, delegating to the `countEnergyInPlay` its opponent-side twin has called since D193: ZERO new members, counters, ops or registry rows) 🆕🆕 D406 +1 sentence / +5 printings (THE COUNTED TOOL SCALER — *"This attack does 30 damage for each Pokémon Tool attached to all of your Pokémon."*, ONE whole-sentence anchor (`YOUR_TOOLS_MULTIPLY`) and ONE `deriveAttackDamageMultiplier` arm over a THIRTEENTH `DamageCountSource` member, `toolsOnYourBoard`) 🆕🆕 D405 +1 sentence / +5 printings (THE MANDATORY OWN-BOARD ENERGY RETRIEVAL — *"Put an Energy attached to this Pokémon into your hand."*, ONE whole-sentence anchor and ONE `deriveAttackEffect` arm returning ONE `discardEnergy { from: "yourActive", filter: anyEnergy, to: "hand" }`: the op is D96's, the destination D295's and the absent `count` the op's OWN documented "one", so ZERO new ops, fields, readers, `BoardCondition` members or registry rows — a READER-keyed move, so `REGISTRY_ATTACK_UNITS` and `splitHead` both stand still. The whole price outside the reader was ONE caption branch on `discardNote`'s `yourActive` arm, which no census figure can see.) 🆕🆕 D404 +1 sentence / +7 printings (THE MANDATORY HAND WIPE AND REFILL — *"Discard your hand and draw 6 cards."*, ONE whole-sentence anchor and ONE `deriveAttackEffect` arm returning `discardHand` then `drawCards` in PRINTED ORDER: both ops shipped with Professor's Research, so ZERO new ops, fields, readers, `BoardCondition` members or registry rows, and `REGISTRY_ATTACK_UNITS` / `splitHead` stand still)  // 🆕🆕 D403 +2 sentences / +8 printings (THE ADDITIVE HALF OF D402's FAMILY — *"You may discard up to 2 [Basic] Energy from your Benched Pokémon. This attack does {60|90} more damage for each card you discarded in this way."* on an ELEVENTH reader plus an exported assembler taking the printed BASE, ONE `discardEnergy.from` member (`yourBench`) and ONE OPTIONAL `damageDefender.base` field; a READER-keyed move, so no registry summand moves and `MATCH_RECORD_VERSION` stays 25) // 🆕🆕 D402 +6 sentences / +13 printings (THE DISCARD-COUNT-SCALED ATTACK — the §9.2 `discarded` record read as a damage MULTIPLIER: ONE map-built whole-sentence anchor and ONE `deriveAttackEffect` arm returning the two-op pair `registry.ts` already spells BY HAND on two cards that have since ROTATED, so ZERO new ops, fields, `BoardCondition` members or registry rows and no registry summand moves) // 🆕🆕 D401 +4 sentences / +7 printings (THE SELF-DISCARD COST BEFORE AN ANY-TARGET SNIPE — one whole-sentence COMPOUND anchor over the §8 cost and the snipe, returning both ops in printed order; a READER-keyed move, so no registry summand moves) // 🆕🆕 D400 +2 sentences / +9 printings (THE ANY-TARGET ARITY — `CHOSEN_ANY_TARGET`'s hard-coded `1 of` captured and the W/R tail's number word required to AGREE with it; a READER-keyed move, so no registry summand moves) // 🆕🆕 D399 +3 sentences / +5 printings (THE TWIN CONSEQUENT AND THE ARITY — the gated Wo-Chien printing plus the FOUR the flat rider was refusing on the literal count `1`) // 🆕🆕 D398 +1 sentence / +1 printing (THE DECK-SIZE READ — Rabsca `sv08-014` "Counterturn" ({G}, `40+`, **+200**, index **1** of TWO) at 1 legal printing, taken by ONE new `BoardCondition` member (`yourDeckAtMost { count }`), TWO exhaustive-switch arms and ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row — a READER-keyed move, so `REGISTRY_ATTACK_UNITS` and `splitHead` BOTH stand still) // 🆕🆕 D397 +1 sentence / +1 printing (THE BENCHED-CUBONE FILTER — Marowak `sv07-073` "Bone Vengeance" ({C}{C}, `60+`, **+120**, index **1** of TWO) at 1 legal printing, taken by ONE new `BoardCondition` member (`yourBenchNamedDamaged { name }`), TWO exhaustive-switch arms and ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row — a READER-keyed move, so `REGISTRY_ATTACK_UNITS` and `splitHead` BOTH stand still) // 🆕🆕 D394 +2 sentences / +2 printings (THE USED-ATTACK PAIR — Falinks `sv07-088` "All-Out Attack" ({C}{C}, `30+`, **+90**, index 1 of TWO) and Weezing `sv09-092` "Crazy Blast" ({D}{C}, `50+`, **+120**, index 1 of TWO), 1 legal printing each: ONE new `BoardCondition` member (`yourActiveUsedAttackLastTurn { attack }`), ONE new REQUIRED `InPlayPokemon` field (`usedAttack`), ONE new REQUIRED field on `PendingStage.attackEpilogue`, TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and TWO new exhaustive-switch arms — the residue's LAST pair on one mechanism, the first window in the union that is not the turn in progress, and the third entry on this line to move `MATCH_RECORD_VERSION`, 24 -> 25) // 🆕🆕 D393 +2 sentences / +2 printings (THE EVOLVE PAIR — Gholdengo `sv08-131` "Strike It Rich" ({M}, `30+`, **+90**, index 0 of TWO) and Misty's Starmie `sv10-047` "Abrupt Flash" ({W}, `60+`, **+80**, index 0 of ONE), 1 legal printing each: ONE new `BoardCondition` member (`yourActiveEvolvedFromThisTurn { name }`), ONE new REQUIRED `InPlayPokemon` field (`evolvedTurn`), TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and TWO new exhaustive-switch arms — the residue's only PAIR on one mechanism, and the second entry on this line to move `MATCH_RECORD_VERSION`, 23 -> 24) // 🆕🆕 D392 +1 sentence (THE SUBSTRING NAME READ — Team Rocket's Nidoqueen `sv10-116` "Love Impact" ({D}, `60+`, **+120**, index 0 of TWO) at 1 legal printing: ONE new `BoardCondition` member (`yourBenchHasNameContaining { fragment }`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO NEW exhaustive-switch arms — a SECOND MEMBER and not a `match?:` field on `yourBenchHasNamed`, and it is the FIRST test of the rule D391 wrote down, which HELD: what changes is the comparison OPERATOR rather than a filter the delegate already takes, `conditionNote` needs a second SENTENCE rather than a second SLOT, and a member edits ZERO of `yourBenchHasNamed`'s 45 executable sites where an optional field edits THREE)
    // 🆕🆕 D390 — a `- 1` term at the FRONT of the chain, so THIS file's own step is
    // still the difference between two adjacent rungs while the HEAD above moves for
    // somebody else's work: D390 resolved ONE sentence worth ONE printing (the
    // OPPONENT-SEAT TYPE READ). ⚠️ THE CHAIN IS EDITED AT THE FRONT, NEVER AT THE END.
    // 🆕🆕 D391 — a `- 1` term at the FRONT of each chain: the TYPED PER-BODY
    // ENERGY THRESHOLD resolved ONE sentence worth ONE printing. ⚠️ THE CHAIN IS EDITED AT
    // THE FRONT, NEVER AT THE END.
    // 🆕🆕 D392 — one more `- 1` on each chain: the SUBSTRING NAME READ, 1 sentence / 1 printing.
    // 🆕🆕 D398 — one more `- 1` on each chain: the DECK-SIZE READ, 1 sentence / 1 printing.
    // 🆕🆕 D401 — a `- 4` / `- 7` pair at the FRONT of the two chains: the SELF-DISCARD
    // COST BEFORE AN ANY-TARGET SNIPE resolved FOUR sentences worth SEVEN printings.
    // ⚠️ THE CHAINS ARE EDITED AT THE FRONT AND KEYED ON THE FROZEN TAIL (D397's rule).
    // 🆕🆕 D403 — a `- 2` / `- 8` pair at the FRONT of the two chains: the ADDITIVE
    // HALF OF D402's FAMILY resolved TWO sentences worth EIGHT printings.
    // ⚠️ THE CHAINS ARE EDITED AT THE FRONT AND KEYED ON THE FROZEN TAIL (D397's rule).
    // 🆕🆕 D404 — a `- 1` / `- 7` pair at the FRONT of both chains: THE MANDATORY HAND
    // WIPE AND REFILL resolved ONE sentence worth SEVEN printings. ⚠️ THE CHAIN IS
    // EDITED AT THE FRONT, NEVER AT THE END — the frozen `.toEqual([N, M])` tail is
    // what makes this file's own step readable across fourteen other slices' moves.
    // 🆕🆕 D405 — a `- 1` / `- 5` pair at the FRONT of both chains: THE MANDATORY
    // OWN-BOARD ENERGY RETRIEVAL resolved ONE sentence worth FIVE printings. ⚠️ THE
    // CHAIN IS EDITED AT THE FRONT, NEVER AT THE END — the frozen `.toEqual([N, M])`
    // tail is what makes this file's own step readable across fifteen other slices'
    // moves.
    // 🆕🆕 D406 — a `- 1` / `- 5` pair at the FRONT of both chains: THE COUNTED TOOL
    // SCALER resolved ONE sentence worth FIVE printings. ⚠️ THE CHAIN IS EDITED AT THE
    // FRONT, NEVER AT THE END — the frozen `.toEqual([N, M])` tail is what makes this
    // file's own step readable across sixteen other slices' moves.
    expect([
      // 🆕🆕 D407 — a `- 1` / `- 4` pair at the FRONT of the two chains: THE BOARD-WIDE
      // OWN-ENERGY COUNT resolved ONE sentence worth FOUR printings. ⚠️ THE CHAIN IS
      // EDITED AT THE FRONT, NEVER AT THE END — the frozen tail is what makes this
      // file's own step readable across seventeen other slices' moves.
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
      // live in `effects.ts` and absent from this file's `READERS` list, worth ONE
      // sentence / ONE printing — so the two chains take the SAME step. ⚠️ **THE
      // FROZEN TAIL [371, 1268] DOES NOT MOVE**, which is the proof that every
      // baseline here was right and only the live-head term was ever wrong.
      // ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      // 🆕🆕 D420 — a `- 3` / `- 4` pair at the FRONT of the two chains: THE HAND-ENERGY COST FAMILY resolved THREE
      // sentences worth FOUR printings — *"Discard 6 Basic {G} Energy cards from your hand, and Knock Out your
      // opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing."* (2),
      // *"Discard 2 Basic {G} Energy cards from your hand. If you can't discard 2 cards in this way, this attack does
      // nothing."* (1) and *"Discard a Basic {G} Energy card from your hand. If you can't, this attack does nothing."*
      // (1) — all three claimed WHOLE by the WIDENED trailing-cancel anchor `deriveAttackCancelRequirement` over two
      // new `deriveAttackEffect` arms (6f, 6g), so the step arrives through the RAW summand ALONE and
      // `SPLIT_ATTACK_UNITS` (13), `COMPOUND_ATTACK_UNITS` (18) and `REGISTRY_ATTACK_UNITS` (16) ALL stand still. ⚠️
      // **THE FROZEN TAIL DOES NOT MOVE.** ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      resolving.length - 3 - 1 - 2 - 1 - 3 - 2 - 2 - 1 - 1 - 1 - 1 - 2 - 6 - 4 - 2 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1,
      units(resolving) - 4 - 1 - 6 - 1 - 4 - 5 - 7 - 4 - 5 - 5 - 7 - 8 - 13 - 7 - 9 - 5 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1,
    ]).toEqual([371, 1268]);
    // D388 left it at 370 / 1,267, and the difference is this sentence alone.
    // 🆕🆕 D391 — one more `- 1` term at the FRONT of each chain: the TYPED PER-BODY
    // ENERGY THRESHOLD resolved ONE sentence worth ONE printing. ⚠️ THE CHAIN IS EDITED AT
    // THE FRONT, NEVER AT THE END.
    // 🆕🆕 D392 — one more `- 1` on each chain: the SUBSTRING NAME READ, 1 sentence / 1 printing.
    // 🆕🆕 D398 — one more term at the FRONT of each chain: the DECK-SIZE READ, 1 sentence / 1 printing. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D399 — a `- 3` / `- 5` pair at the FRONT of each chain: the TWIN CONSEQUENT AND THE ARITY, THREE sentences worth FIVE printings. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D401 — a `- 4` / `- 7` pair at the FRONT of each chain: the SELF-DISCARD COST BEFORE AN ANY-TARGET SNIPE, FOUR sentences worth SEVEN printings. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D405 — a `- 1` / `- 5` pair at the FRONT of each chain: the MANDATORY OWN-BOARD ENERGY RETRIEVAL, ONE sentence worth FIVE printings. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D406 — a `- 1` / `- 5` pair at the FRONT of each chain: THE COUNTED TOOL SCALER, ONE sentence worth FIVE printings. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D407 — a `- 1` / `- 4` pair at the FRONT of each chain: THE BOARD-WIDE OWN-ENERGY COUNT, ONE sentence worth FOUR printings. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D413 — a `- 2` / `- 5` pair at the FRONT of each chain: THE ADDITIVE MULTI-COIN FOLD, TWO sentences worth FIVE printings, arriving through the RAW summand alone. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D414 — a `- 3` / `- 4` pair at the FRONT of each chain: THE KNOCK-OUT-WITHOUT-DAMAGE SUBSET, THREE sentences worth FOUR printings, arriving through the RAW summand alone (each claimed WHOLE by a `deriveAttackEffect` arm over ONE new FIELD-FREE op, so `SPLIT_ATTACK_UNITS` (13), `COMPOUND_ATTACK_UNITS` (18) and `REGISTRY_ATTACK_UNITS` (16) ALL stand still). ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D415 — a `- 1` term at the FRONT of each chain: THE OPPONENT-SCOPED SPECIAL-ENERGY KO GATE, ONE sentence worth ONE printing (*"If your opponent's Active Pokémon has any Special Energy attached, it is Knocked Out."*, Haxorus `sv06.5-046`), claimed WHOLE by arm 6a with the `cond` swapped and nothing else, so the step arrives through the RAW summand ALONE and `SPLIT_ATTACK_UNITS` (13), `COMPOUND_ATTACK_UNITS` (18) and `REGISTRY_ATTACK_UNITS` (16) ALL stand still. ⚠️ EDITED AT THE FRONT, NEVER AT THE END — the frozen tail is what makes this file's own step readable across the other slices' moves.
    // 🆕🆕 D416 — a `- 2` / `- 6` pair at the FRONT of each chain: THE PARKING KO PAIR, TWO sentences worth SIX printings (*"Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon."*, 4 printings, and *"Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it."*, 2) — the two sentences D415's note named as the residue that still needed a PARK, both now claimed WHOLE by `deriveAttackEffect` over ONE new PARKING op (`knockOutChosen`) that adds ZERO persisted record fields, so the step arrives through the RAW summand ALONE, `SPLIT_ATTACK_UNITS` (13), `COMPOUND_ATTACK_UNITS` (18) and `REGISTRY_ATTACK_UNITS` (16) ALL stand still and `MATCH_RECORD_VERSION` STAYS 26. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE DIFFERENT NUMBERS AGAIN — 2 and 6 — the flip sentence printing on FOUR ids and the counter-window sentence on TWO. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      // 🆕🆕 D418 — a `- 1` term at the FRONT of each chain, and the ONLY pair in
      // either that no slice ever shipped: D417's `deriveAttackCancelRequirement`,
      // live in `effects.ts` and absent from this file's `READERS` list, worth ONE
      // sentence / ONE printing — so the two chains take the SAME step. ⚠️ **THE
      // FROZEN TAIL [371, 1268] DOES NOT MOVE**, which is the proof that every
      // baseline here was right and only the live-head term was ever wrong.
      // ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
    // 🆕🆕 D420 — a `- 3` / `- 4` pair at the FRONT of the two chains: THE HAND-ENERGY COST FAMILY resolved THREE
    // sentences worth FOUR printings — *"Discard 6 Basic {G} Energy cards from your hand, and Knock Out your
    // opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing."* (2),
    // *"Discard 2 Basic {G} Energy cards from your hand. If you can't discard 2 cards in this way, this attack does
    // nothing."* (1) and *"Discard a Basic {G} Energy card from your hand. If you can't, this attack does nothing."*
    // (1) — all three claimed WHOLE by the WIDENED trailing-cancel anchor `deriveAttackCancelRequirement` over two
    // new `deriveAttackEffect` arms (6f, 6g), so the step arrives through the RAW summand ALONE and
    // `SPLIT_ATTACK_UNITS` (13), `COMPOUND_ATTACK_UNITS` (18) and `REGISTRY_ATTACK_UNITS` (16) ALL stand still. ⚠️
    // **THE FROZEN TAIL DOES NOT MOVE.** ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
    expect([resolving.length - 3 - 1 - 2 - 1 - 3 - 2 - 2 - 1 - 1 - 1 - 1 - 2 - 6 - 4 - 2 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1, units(resolving) - 4 - 1 - 6 - 1 - 4 - 5 - 7 - 4 - 5 - 5 - 7 - 8 - 13 - 7 - 9 - 5 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1]).toEqual([370, 1267]);
  });
});
