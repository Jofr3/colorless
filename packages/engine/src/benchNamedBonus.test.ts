import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import {
  POKEMON_TYPES,
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
import type { BoardCondition, GameState } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { programFor, registryCardIds } from "./registry";
import {
  BENCH_NAMED_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 🆕🆕 D367 — THE BONUS CONSEQUENT'S ZERO-VOCABULARY FLOOR, AND A HANDED
// CANDIDATE REFUSED ON A MEASUREMENT.
//
// D366 handed over ONE sentence — *"If your opponent has 3 or more Benched
// Pokémon, this attack does 80 more damage."*, **1 legal printing**, needing **one
// new `BoardCondition` member** — and said in its own handoff that it must be
// PRICED rather than taken for being the seat-mirror of what D366 shipped.
//
// 🛑 **PRICED, AND REFUSED.** §1 runs the nine live readers over the whole
// `legalAttackCorpus()` under the `CONDITIONAL_DAMAGE_BONUS` anchor and finds the
// candidate inside a residue of **43 sentences / 60 printings** at D366's head.
// Partitioning that residue by **WHAT ACTUALLY REFUSES EACH** — against the live
// union, which is the partition D363 and D365 both got wrong in opposite
// directions — gives a **ZERO-NEW-VOCABULARY FLOOR of 9 sentences / 13 legal
// printings**: nine sentences that are an EXISTING member at an EXISTING
// parameter, refused only because no row or token spells them.
//
// **THIRTEEN PRINTINGS FOR ZERO MEMBERS BOUGHT, AGAINST ONE PRINTING FOR ONE
// MEMBER BOUGHT.** D363 found an inherited price too HIGH, D365 found one too
// LOW, D366 found the floor was ZERO. This is the first slice in the family where
// the floor is the LARGEST thing on the table — and naming it is the finding.
//
// WHAT SHIPS: **7 literal rows** in `CONDITIONAL_DAMAGE_CLAUSES` and **one token
// map widened** (`CLAUSE_POKEMON_TYPES` learns the brace notation its sibling
// `CLAUSE_ENERGY_TOKENS` has carried since D118). ZERO new union members, ops,
// events, error codes, regexes, registry rows, state fields, prompt kinds or
// choice kinds; `MATCH_RECORD_VERSION` STAYS 22.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/** The nine live readers, run as one — the same set `censusAtHead.test.ts` and
    `precociousEvolution.test.ts` use. Duplicated rather than exported across
    files because the point is to run them a SECOND time, from outside. */
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

/** The NINE sentences this slice claims, with the printings the catalog prints and
    the EXISTING member each resolves to. Every count here is re-derived against
    the committed corpus below rather than trusted. */
const TAKEN: readonly (readonly [string, number, BoardCondition])[] = [
  [
    "If Durant is on your Bench, this attack does 20 more damage.",
    2,
    { kind: "yourBenchHasNamed", name: "Durant" },
  ],
  [
    "If Illumise is on your Bench, this attack does 60 more damage.",
    1,
    { kind: "yourBenchHasNamed", name: "Illumise" },
  ],
  [
    "If Mightyena is on your Bench, this attack does 90 more damage.",
    1,
    { kind: "yourBenchHasNamed", name: "Mightyena" },
  ],
  [
    "If Beldum and Metang are on your Bench, this attack does 150 more damage.",
    1,
    {
      kind: "allOf",
      conditions: [
        { kind: "yourBenchHasNamed", name: "Beldum" },
        { kind: "yourBenchHasNamed", name: "Metang" },
      ],
    },
  ],
  [
    "If your opponent's Active Pokémon is a Stage 2 Pokémon, this attack does 140 more damage.",
    2,
    { kind: "opponentActiveIsStage2" },
  ],
  [
    "If your opponent has 5 or fewer cards in their hand, this attack does 60 more damage.",
    1,
    { kind: "opponentHandAtMost", count: 5 },
  ],
  [
    "If your opponent has 4 or fewer Prize cards remaining, this attack does 70 more damage.",
    2,
    { kind: "opponentPrizesRemaining", counts: [0, 1, 2, 3, 4] },
  ],
  [
    "If your opponent's Active Pokémon is a {P} Pokémon, this attack does 30 more damage.",
    2,
    { kind: "opponentActiveHasType", type: "Psychic" },
  ],
  [
    "If your opponent's Active Pokémon is a {D} Pokémon, this attack does 100 more damage.",
    1,
    { kind: "opponentActiveHasType", type: "Darkness" },
  ],
];

/** The ids behind the thirteen printings — remote D1 `luminous`, `$.effect`, the
    extractor verified against the 640 / 1,732 / 60,467 total FIRST, 2026-08-19.
    Every one `legal_standard = 1` and `category = 'Pokemon'`, and NONE of the nine
    sentences has a `legal_standard = 0` copy anywhere in the catalog. */
const TAKEN_IDS: readonly string[] = [
  "sv10.5w-070",
  "sv10.5w-150",
  "sv06-009",
  "sv06-114",
  "sv09-063",
  "sv10-101",
  "sv10-214",
  "sv07-084",
  "svp-151",
  "sv08-038",
  "sv05-068",
  "sv05-170",
  "sv10-028",
];

/** The handed candidate, NOT taken — and the four biggest things left behind the
    bonus skeleton after this slice, each with what it still costs. */
const HANDED_CANDIDATE =
  "If your opponent has 3 or more Benched Pokémon, this attack does 80 more damage.";

const LEFT: readonly (readonly [string, number, string])[] = [
  [
    "If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack does 80 more damage.",
    3,
    // 🛑🆕🆕 D368 — THIS COST DESCRIPTION WAS WRONG, AND THE CORRECTION IS THE
    // FINDING. It is not "a member no one has written yet": it is NOT A BOARD FACT
    // AT ALL. The identical clause is printed on Electivire ex `sv10-069`/`-212`
    // ({L}{L}{C}) and Jellicent ex `sv10.5w-045`/`-160`/`-168` ({P}{C}), so the
    // SAME board answers it differently depending on which attack was declared —
    // and `conditionHolds(state, seat, cond)` is handed no attack. Priced and
    // disqualified on SHAPE in `undamagedBonus.test.ts` §1.
    "NOT A `BoardCondition` AT ALL — the clause reads THIS ATTACK'S COST, which two printings set to two different values, so no state+seat predicate can answer it",
  ],
  [
    // 🛑🆕🆕 D376 — AND AGAIN, FOR THE FIFTH SLICE RUNNING, AND THIS TIME THE ROW
    // HANDED OVER A *SHAPE INVERSION* RATHER THAN A GAP. The filtered DISCARD-PILE
    // THRESHOLD that sat here — whose cost string said the supply was certain and left
    // OPEN whether *"Basic {R} Energy cards"* is a card CLASS or a PROVISION — was
    // settled by D376 and built (`basicEnergyDiscard.test.ts`): a card CLASS plus a
    // printed TYPE, read through `CardFilter`'s existing `basicEnergy` arm, never
    // through `countEnergyInPlay`. ⚠️ **AND THE COST STRING ASKED THE RIGHT QUESTION**
    // — the open one WAS the whole price, because the sibling one zone over
    // (`yourEnergyInPlayAtLeast`) reads PROVISION, correctly, and a discard pile
    // provides nothing.
    //
    // 🛑 **WHAT TAKES ITS PLACE IS NOT THE HEAD OF A BAND — IT IS THE WHOLE BAND.**
    // The 2-printing band is now a SINGLE item, and it is the one three slices running
    // have deferred on the same measured ground. This row therefore stops being "the
    // cheapest thing left" and becomes "the cheapest thing left AND it is not cheap":
    // the next slice either pays a `MATCH_RECORD_VERSION` bump for it or goes a band
    // down, and either way the choice is priced HERE rather than rediscovered.
    "If this Pokémon was healed during this turn, this attack does 100 more damage.",
    2,
    "a PER-TURN EVENT, and the union's first that no CURRENT board carries — `state` records damage and status, not the fact that healing HAPPENED, so this needs a new per-turn flag that survives into `MatchRecord`: a PERSISTED-SHAPE change, hence a `MATCH_RECORD_VERSION` bump ON TOP of the engine bump, which is why three slices running have priced it above a 2-printing purchase",
  ],
  [HANDED_CANDIDATE, 1, "an opponent-seat bench COUNT — D366's own handoff, and the reason this slice measured instead of inheriting"],
];

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: BENCH_NAMED_DECK, p2: BENCH_NAMED_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields `attacker` with one Energy paid, P2 fields a 200 HP body that
    survives every printed base here, and BOTH benches start EMPTY — each case
    puts exactly the bodies it is about. */
function ready(seed: number, attacker: string, energy: string): GameState {
  let state = setActiveFromDeck(board(seed), "p1", attacker);
  state = attachFromDeck(state, "p1", energy, 1);
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  return clearBench(clearBench(state, "p1"), "p2");
}

function benched(state: GameState, ...ids: readonly string[]): GameState {
  let next = state;
  for (const id of ids) next = benchFromDeck(next, "p1", id);
  return next;
}

/** Attack index 0 and report the damage actually dealt. */
function damageDealt(state: GameState): { damage: number; kinds: string[] } {
  const after = mustApply(state, { type: "attack", seat: "p1", index: 0 });
  const dealt = after.events.find((e) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return { damage: dealt?.damage ?? 0, kinds: types(after.events) };
}

describe("§1 — the candidate was PRICED against the whole residue, not inherited", () => {
  it("🛑 the bonus skeleton's residue at D366's head was 43 sentences / 60 printings", () => {
    // Re-derived from the parts rather than quoted: everything under the anchor,
    // minus everything the nine readers now carry, plus what this slice took.
    const openers = corpus().filter(([, s]) => BONUS.test(s.trim()));
    expect([openers.length, units(openers)]).toEqual([81, 129]);
    const carried = openers.filter(([, s]) => resolvedByAnyReader(s));
    const refused = openers.filter(([, s]) => !resolvedByAnyReader(s));
    // THE PARTITION SUMS — parts that do not add to the population are not a
    // partition, however carefully each half is measured.
    expect(carried.length + refused.length).toBe(openers.length);
    expect(units(carried) + units(refused)).toBe(units(openers));
    // 🆕🆕 D372 — the residue is 28 / 36. D372 took **TWO sentences / TWO
    // printings** (ONE clause, the CROSS-BOARD EQUAL-ENERGY one, printed at two
    // amounts — `sameEnergyBonus.test.ts`), so the two terms of this chain stop
    // stepping in the 1-and-2 pattern the four slices before it kept, and every
    // earlier head is still re-derived from the measured one rather than quoted.
    // 🆕🆕 D371 — the residue was 30 / 38. D371 took ONE sentence / TWO printings
    // (the OPPONENT-RESISTANCE clause, `opponentResistanceBonus.test.ts`), so the
    // whole chain below gains one more term and every earlier head is still
    // re-derived from the measured one rather than quoted.
    // 🆕🆕 D370 — the residue was 31 / 40. D370 took ONE sentence / TWO printings
    // (the bench-scoped {M} TYPE clause, `benchTypeBonus.test.ts`), so the whole
    // chain below gains one term and every earlier head is still re-derived from
    // the measured one rather than quoted.
    // 🆕🆕 D369 — the residue was 32 / 42; at D368's head it was 33 / 44, at D367's
    // 34 / 47, and before D367 34 + 9 and 47 + 13. D369 took ONE sentence / TWO
    // printings (the cross-board Pokémon Tool clause, `opponentToolBonus.test.ts`),
    // so BOTH numbers step again and every figure below is re-derived from the
    // measured head rather than left frozen at the head that measured it.
    // 🆕🆕 D373 — the residue is 27 / 34. D373 took ONE sentence / TWO printings (the
    // UNIVERSAL-OVER-THE-BENCH clause, `benchAllDamagedBonus.test.ts`), so the chain
    // gains one more term and every earlier head is still re-derived from the
    // measured one rather than quoted.
    // 🆕🆕 D374 — the residue is 26 / 32. D374 took ONE sentence / TWO printings (the
    // NAMED-ENERGY clause, `trEnergyBonus.test.ts`) — the candidate this file's own
    // `LEFT` table has carried since D367 — so the chain gains one more term and
    // every earlier head is still re-derived from the measured one rather than quoted.
    // 🆕🆕 D375 — the residue is 25 / 30. D375 took ONE sentence / TWO printings (the
    // CROSS-BOARD TYPE INTERSECTION, `typeShareBonus.test.ts`) — the candidate this
    // file's own `LEFT` table promoted at D374 — so the chain gains one more term.
    // 🆕🆕 D376 — the residue is 24 / 28. D376 took ONE sentence / TWO printings (the
    // FILTERED DISCARD-PILE THRESHOLD, `basicEnergyDiscard.test.ts`) — the candidate
    // this file's own `LEFT` table promoted at D375 — so the chain gains one more term
    // and every earlier head is still re-derived from the measured one.
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
    expect([refused.length, units(refused)]).toEqual([21, 25]);
    expect([refused.length + 3, units(refused) + 3]).toEqual([24, 28]);
    expect([refused.length + 4, units(refused) + 5]).toEqual([25, 30]);
    expect([refused.length + 5, units(refused) + 7]).toEqual([26, 32]);
    expect([refused.length + 6, units(refused) + 9]).toEqual([27, 34]);
    expect([refused.length + 7, units(refused) + 11]).toEqual([28, 36]);
    expect([refused.length + 9, units(refused) + 13]).toEqual([30, 38]);
    expect([refused.length + 10, units(refused) + 15]).toEqual([31, 40]);
    expect([refused.length + 11, units(refused) + 17]).toEqual([32, 42]);
    expect([refused.length + 12, units(refused) + 19]).toEqual([33, 44]);
    expect([refused.length + 13, units(refused) + 19 + 3]).toEqual([34, 47]);
    expect([refused.length + 13 + TAKEN.length, units(refused) + 22 + 13]).toEqual([43, 60]);
  });

  it("🛑 the ZERO-VOCABULARY FLOOR over that residue was 9 sentences / 13 printings", () => {
    // The floor stated as a NUMBER measurement can contradict, D366's form. Each
    // of the nine is an EXISTING member at an EXISTING parameter — which is what
    // makes this slice's purchase ZERO union members — and the printing count is
    // re-derived from the corpus rather than carried.
    expect(TAKEN).toHaveLength(9);
    expect(TAKEN.reduce((sum, [, n]) => sum + n, 0)).toBe(13);
    for (const [sentence, printings] of TAKEN) {
      expect(units(corpus().filter(([, s]) => s === sentence)), sentence).toBe(printings);
    }
  });

  it("🛑 …and 13 beats the handed candidate's 1, which is why the candidate is NOT built", () => {
    // The handed sentence is real, is in the corpus at ONE printing, and is still
    // refused by all nine readers at this head. **A row was not added for it**, and
    // this rung is the tripwire that fires the day one is.
    expect(units(corpus().filter(([, s]) => s === HANDED_CANDIDATE))).toBe(1);
    expect(resolvedByAnyReader(HANDED_CANDIDATE)).toBe(false);
    expect(deriveAttackDamageBonus(HANDED_CANDIDATE)).toBeNull();
    expect(deriveAttackRequirement(HANDED_CANDIDATE)).toBeNull();
    // 13 to 1 — the comparison written as arithmetic so it cannot rot into prose.
    expect(TAKEN.reduce((sum, [, n]) => sum + n, 0)).toBeGreaterThan(
      units(corpus().filter(([, s]) => s === HANDED_CANDIDATE)) * 12,
    );
  });

  it("names what is LEFT, with what each still costs — and every one is still refused", () => {
    for (const [sentence, printings, cost] of LEFT) {
      expect(units(corpus().filter(([, s]) => s === sentence)), cost).toBe(printings);
      expect(resolvedByAnyReader(sentence), cost).toBe(false);
      // Refused by VOCABULARY, not by the ANCHOR — D363's distinction, which is
      // an order of magnitude in price. Each matches the skeleton and misses at
      // the table.
      expect(BONUS.test(sentence.trim()), sentence).toBe(true);
    }
    // 🆕🆕 D368 — the largest single item left is STILL 3 printings, but it is now
    // the DISQUALIFIED one: D368 took the other 3-printing entry (the undamaged
    // complement) and the declaration-fact clause cannot be taken at any price.
    // ⚠️ **SO THE LARGEST REMAINING *PURCHASABLE* ITEM IS 2**, which is the number
    // a successor should actually inherit — stated separately from the raw maximum
    // so the two cannot be confused for each other.
    expect(Math.max(...LEFT.map(([, n]) => n))).toBe(3);
    const purchasable = LEFT.filter(([, , cost]) => !cost.startsWith("NOT A `BoardCondition`"));
    expect(Math.max(...purchasable.map(([, n]) => n))).toBe(2);
    expect(LEFT).toHaveLength(3);
  });
});

describe("§2 — every taken sentence resolves to the EXISTING member, by value", () => {
  it("maps all nine to their member and their printed amount", () => {
    for (const [sentence, , cond] of TAKEN) {
      const read = deriveAttackDamageBonus(sentence);
      expect(read, sentence).not.toBeNull();
      expect(read?.count, sentence).toEqual({ kind: "boardCondition", cond });
      // The amount comes off the OUTER skeleton, never off the clause row — which
      // is why one row serves both Durant printings and both Regirock ex ones.
      expect(read?.per, sentence).toBe(Number(BONUS.exec(sentence)?.[2]));
    }
  });

  it("🛑 buys ZERO new union members — every member here already had both reader arms", () => {
    // The claim that makes this slice cheap, driven rather than asserted: each
    // condition answers on a board AND renders a note, which are the two
    // exhaustive `switch (cond.kind)` statements in the repo. A member added by
    // this slice would have needed two new arms; none did.
    const state = ready(4700, "fix-durant", "fix-energy");
    for (const [sentence, , cond] of TAKEN) {
      expect(typeof conditionHolds(state, "p1", cond), sentence).toBe("boolean");
      expect(conditionNote(cond), sentence).not.toBe("");
    }
  });

  it("keeps the two CONSEQUENTS disjoint — D125's rule, on all nine", () => {
    for (const [sentence] of TAKEN) {
      // The requirement reader must never see a sentence meaning "+N".
      expect(deriveAttackRequirement(sentence), sentence).toBeNull();
      // …and the cancel spelling of the same clause must never reach the bonus
      // table, which is the direction that would score a bonus off a cancel.
      const clause = BONUS.exec(sentence)?.[1] ?? "";
      expect(
        deriveAttackDamageBonus(`If ${clause}, this attack does nothing.`),
        clause,
      ).toBeNull();
    }
  });

  it("the anchors are whole-sentence at BOTH ends — no substring reaches a row", () => {
    const [sentence] = TAKEN[0] ?? ["", 0, { kind: "yourStadiumInPlay" } as BoardCondition];
    const clause = BONUS.exec(sentence)?.[1] ?? "";
    // Lowercase `if` — the skeleton has no /i.
    expect(deriveAttackDamageBonus(`if ${clause}, this attack does 20 more damage.`)).toBeNull();
    // No trailing period is not the whole sentence.
    expect(deriveAttackDamageBonus(`If ${clause}, this attack does 20 more damage`)).toBeNull();
    // Leading text pins `^`.
    expect(
      deriveAttackDamageBonus(`Flip a coin. If ${clause}, this attack does 20 more damage.`),
    ).toBeNull();
    // A printed 0 adds nothing — the guard every arm in this family carries.
    expect(deriveAttackDamageBonus(`If ${clause}, this attack does 0 more damage.`)).toBeNull();
  });
});

describe("§3 — the SELF-NAMING boards: 'on your Bench' is not 'in play', on two more cards", () => {
  it("🛑 Durant's clause names DURANT — the attacker's own card, and it must NOT satisfy itself", () => {
    // The board that refutes the widening in one line: a Durant in the ACTIVE
    // SPOT and an EMPTY Bench. `yourBenchHasNamed` is false; an "in play" reading
    // of the same name would be TRUE and the +20 would be unconditional.
    const alone = ready(4701, "fix-durant", "fix-energy");
    const topUid = alone.players.p1.active?.stack.at(-1) ?? "";
    expect(alone.cardIdByUid[topUid]).toBe("fix-durant");
    expect(alone.players.p1.bench).toHaveLength(0);
    expect(conditionHolds(alone, "p1", { kind: "yourBenchHasNamed", name: "Durant" })).toBe(false);
    expect(damageDealt(alone).damage).toBe(20);
    // …and with a SECOND Durant on the Bench the same board pays the bonus.
    const paired = benched(ready(4702, "fix-durant", "fix-energy"), "fix-durant");
    expect(conditionHolds(paired, "p1", { kind: "yourBenchHasNamed", name: "Durant" })).toBe(true);
    expect(damageDealt(paired).damage).toBe(40);
  });

  it("🛑 Mightyena's clause names MIGHTYENA — the same refutation, a second card", () => {
    const alone = ready(4703, "fix-mightyena", "fix-dark-energy");
    expect(alone.players.p1.bench).toHaveLength(0);
    expect(conditionHolds(alone, "p1", { kind: "yourBenchHasNamed", name: "Mightyena" })).toBe(
      false,
    );
    expect(damageDealt(alone).damage).toBe(30);
    const pack = benched(ready(4704, "fix-mightyena", "fix-dark-energy"), "fix-mightyena");
    expect(conditionHolds(pack, "p1", { kind: "yourBenchHasNamed", name: "Mightyena" })).toBe(true);
    expect(damageDealt(pack).damage).toBe(120);
  });

  it("Volbeat is the CONTROL — it names a DIFFERENT card, so the member is not 'another copy of me'", () => {
    // Two boards, one difference: the benched body's NAME. A nameless filler does
    // not satisfy the clause; Illumise does. That is what stops `yourBenchHasNamed`
    // being read as a self-reference, which the three self-naming printings above
    // could not distinguish on their own.
    const filler = benched(ready(4705, "fix-durant", "fix-energy"), "fix-benchfiller");
    expect(conditionHolds(filler, "p1", { kind: "yourBenchHasNamed", name: "Illumise" })).toBe(
      false,
    );
    const real = benched(ready(4706, "fix-durant", "fix-energy"), "fix-illumise");
    expect(conditionHolds(real, "p1", { kind: "yourBenchHasNamed", name: "Illumise" })).toBe(true);
    // 3 SELF-NAMING printings and 1 that is not — stated as a number, because "the
    // pool prints one" is the exact claim this slice found rotted in the table.
    expect(
      TAKEN.filter(([s]) => s.includes("is on your Bench") || s.includes("are on your Bench")),
    ).toHaveLength(4);
  });

  it("🛑 the `allOf` row needs BOTH bodies — one conjunct is not the conjunction", () => {
    const cond = TAKEN[3]?.[2] as BoardCondition;
    const neither = ready(4707, "fix-durant", "fix-energy");
    expect(conditionHolds(neither, "p1", cond)).toBe(false);
    const beldum = benched(ready(4708, "fix-durant", "fix-energy"), "fix-beldum");
    expect(conditionHolds(beldum, "p1", cond)).toBe(false);
    const metang = benched(ready(4709, "fix-durant", "fix-energy"), "fix-metang");
    expect(conditionHolds(metang, "p1", cond)).toBe(false);
    const both = benched(ready(4710, "fix-durant", "fix-energy"), "fix-beldum", "fix-metang");
    expect(conditionHolds(both, "p1", cond)).toBe(true);
    // …and the polarity is the OPPOSITE of D365's Mesprit row, which spells the
    // same two-name conjunction under a CANCEL where the skeleton owns the
    // negation. Same combinator, two consequents, no crossover.
    expect(
      deriveAttackRequirement("If you don't have Uxie and Azelf on your Bench, this attack does nothing."),
    ).not.toBeNull();
  });
});

describe("§4 — the Stage 2 row is not the Evolution row narrowed", () => {
  it("🛑 an Evolution defender that is a STAGE 1 does not satisfy it — driven both ways", () => {
    const cond: BoardCondition = { kind: "opponentActiveIsStage2" };
    const evolution: BoardCondition = { kind: "opponentActiveIsEvolution" };
    let stage1 = setActiveFromDeck(board(4720), "p2", "fix-stage1");
    stage1 = clearBench(stage1, "p2");
    expect(conditionHolds(stage1, "p1", evolution)).toBe(true);
    // The board that separates them: TRUE for the row three above, FALSE here.
    expect(conditionHolds(stage1, "p1", cond)).toBe(false);
    let stage2 = setActiveFromDeck(board(4721), "p2", "fix-stage2");
    stage2 = clearBench(stage2, "p2");
    expect(conditionHolds(stage2, "p1", cond)).toBe(true);
    expect(conditionHolds(stage2, "p1", evolution)).toBe(true);
  });

  it("the two rows are DIFFERENT keys and neither reaches the other", () => {
    const stage2 = TAKEN[4]?.[0] ?? "";
    expect(deriveAttackDamageBonus(stage2)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentActiveIsStage2" },
    });
    // The Stage 1 sibling the pool prints ONE legal printing of is deliberately
    // NOT bought — it stays refused, by name, so a successor inherits a measured
    // gap rather than a silent one.
    const stage1Sentence =
      "If your opponent's Active Pokémon is a Stage 1 Pokémon, this attack does 90 more damage.";
    expect(units(corpus().filter(([, s]) => s === stage1Sentence))).toBe(1);
    expect(resolvedByAnyReader(stage1Sentence)).toBe(false);
  });
});

describe("§5 — 'N or fewer' as an enumerated set, complete over the domain", () => {
  it("🛑 the prize row answers identically to `<= 4` at every representable count 0-6", () => {
    // The claim that makes a set exact rather than merely convenient: prize counts
    // are 0-6 by §3.8, so an enumeration over the whole domain and a threshold
    // cannot disagree on any board this engine can build. Driven at all SEVEN
    // values rather than at the boundary.
    const cond = TAKEN[6]?.[2] as { kind: "opponentPrizesRemaining"; counts: readonly number[] };
    expect(cond.counts).toEqual([0, 1, 2, 3, 4]);
    for (let n = 0; n <= 6; n += 1) {
      expect(cond.counts.includes(n), `prizes ${String(n)}`).toBe(n <= 4);
    }
    // …and the spelling is the one the repo ALREADY uses: `registry.ts` authors
    // the same shape for a printed "3 or fewer", the 0 included. Two producers,
    // one convention.
    const authored = registryCardIds().filter((id) =>
      JSON.stringify(programFor(id) ?? {}).includes('"opponentPrizesRemaining"'),
    );
    expect(authored.length).toBeGreaterThanOrEqual(2);
    for (const id of authored) {
      expect(JSON.stringify(programFor(id)), id).toContain("[0,1,2,3]");
    }
  });

  it("the hand row is the SAME member at a SECOND threshold, and both still resolve", () => {
    expect(deriveAttackDamageBonus(TAKEN[5]?.[0] ?? "")?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentHandAtMost", count: 5 },
    });
    // The row that was there first is untouched — a new threshold must not
    // re-interpret the old one, which whole-clause keys guarantee by construction.
    expect(
      deriveAttackDamageBonus(
        "If your opponent has 3 or fewer cards in their hand, this attack does 120 more damage.",
      )?.count,
    ).toEqual({ kind: "boardCondition", cond: { kind: "opponentHandAtMost", count: 3 } });
  });
});

describe("§6 — the token map: an ASYMMETRY between two sibling templates, closed", () => {
  it("🛑 BOTH notations now resolve, and they resolve to the SAME member", () => {
    // The defect: `CLAUSE_ENERGY_TOKENS` carries codes AND names and says why;
    // `CLAUSE_POKEMON_TYPES` carried names alone, so three legal printings spelled
    // in the other notation were refused by all nine readers.
    const glyph = deriveAttackDamageBonus(
      "If your opponent's Active Pokémon is a {P} Pokémon, this attack does 30 more damage.",
    );
    const name = deriveAttackDamageBonus(
      "If your opponent's Active Pokémon is a Psychic Pokémon, this attack does 30 more damage.",
    );
    expect(glyph).not.toBeNull();
    // EQUALITY, not merely non-null: two spellings of one board fact must produce
    // one value, which is D136's shape for the apostrophe fold applied to notation.
    expect(glyph).toEqual(name);
  });

  it("resolves EVERY member of POKEMON_TYPES in BOTH notations", () => {
    // Totality, so the map cannot rot the way a hand-kept alternation does. The
    // code map is already canonical against POKEMON_TYPES; this is the rung that
    // says the CLAUSE map inherited that.
    const CODE_OF: Readonly<Record<string, string>> = {
      Grass: "G",
      Fire: "R",
      Water: "W",
      Lightning: "L",
      Psychic: "P",
      Fighting: "F",
      Darkness: "D",
      Metal: "M",
      Fairy: "Y",
      Dragon: "N",
      Colorless: "C",
    };
    expect(POKEMON_TYPES).toHaveLength(11);
    for (const type of POKEMON_TYPES) {
      const code = CODE_OF[type];
      expect(code, type).toBeDefined();
      const byName = deriveAttackDamageBonus(
        `If your opponent's Active Pokémon is a ${type} Pokémon, this attack does 30 more damage.`,
      );
      const byCode = deriveAttackDamageBonus(
        `If your opponent's Active Pokémon is a {${String(code)}} Pokémon, this attack does 30 more damage.`,
      );
      expect(byName, type).not.toBeNull();
      expect(byCode, type).toEqual(byName);
      expect(byCode?.count, type).toEqual({
        kind: "boardCondition",
        cond: { kind: "opponentActiveHasType", type },
      });
    }
  });

  it("🛑 the pattern is still LOOSE and the MAP is still the vocabulary — non-types stay LOUD", () => {
    // The regex captures `(.+)`, so every one of these reaches the lookup and
    // MISSES it. If the map ever became the regex, these would silently resolve to
    // a type that does not exist.
    for (const notAType of ["Stage 1", "Stage 3", "Tera", "Evolution", "{Z}", "{}", "constructor"]) {
      expect(
        deriveAttackDamageBonus(
          `If your opponent's Active Pokémon is a ${notAType} Pokémon, this attack does 30 more damage.`,
        ),
        notAType,
      ).toBeNull();
    }
  });
});

describe("§7 — the census moves in exactly ONE summand, and the other three are measured", () => {
  it("🛑 raw 1,207 → 1,220 → 🆕 1,223 and resolving sentences 335 → 344 → 🆕 345", () => {
    const resolved = corpus().filter(([, text]) => resolvedByAnyReader(text));
    expect(resolved).toHaveLength(363); // 🆕🆕 D382 +1 sentence (THE `. Then, ` JOIN — D317's shape with the printed comma changed: Chi-Yu `sv06-039` "Ground Melter" ({R}{C}, `60+`) at 1 legal printing, ONE anchor constant and ONE consequent row on `deriveAttackBonusConsequent`, ZERO new readers and ZERO new ops) // 🆕🆕 D380 +2 sentences (THE STADIUM-DISCARD OP — `discardStadium`: *"Discard a Stadium in play."* at 4 legal printings and *"You may discard a Stadium in play."* at 2, ONE new FIELD-FREE `EffectOp` behind TWO whole-sentence anchors — the first slice in this run to buy an OP rather than a `BoardCondition`) // 🆕🆕 D379 +1 sentence (THE EXACT HAND-SIZE READ — `yourHandExactly { count }`: ONE CANCEL sentence at 2 legal printings, Alolan Dugtrio `sv08-123`/`sv08-208` "Trio-Cheehoo", and NO bonus twin — ONE new PARAMETERISED `BoardCondition` member and ONE `ATTACK_REQUIREMENT_CLAUSES` row, ZERO `CONDITIONAL_DAMAGE_CLAUSES` rows) // 🆕🆕 D378 **+2 SENTENCES / +3 PRINTINGS** (STADIUM PRESENCE — `stadiumInPlay`: ONE bonus sentence at 1 legal printing, Probopass `sv10-098` "Mountain Drop" +70, PLUS one CANCEL sentence on the SAME member at 2 printings, Fan Rotom `sv07-118`/`sv08.5-085` "Assault Landing" — ONE new NULLARY `BoardCondition` member, ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and ONE `ATTACK_REQUIREMENT_CLAUSES` row) // 🆕🆕 D377 **+3 SENTENCES / +3 PRINTINGS** (the CROSS-BOARD STATUS PAIR — TWO bonus sentences at 1 legal printing each, *"…is Burned"* +40 and *"…is Confused"* +90, PLUS one CANCEL sentence on the SAME member, *"…isn't Burned"*; TWO new NULLARY `BoardCondition` members, TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and ONE `ATTACK_REQUIREMENT_CLAUSES` row) // 🆕🆕 D376 +1 sentence (the FILTERED DISCARD-PILE THRESHOLD) // 🆕🆕 D375 +1 sentence (the CROSS-BOARD TYPE INTERSECTION) // 🆕🆕 D374 +1 sentence (the NAMED-ENERGY clause) // 🆕🆕 D373 +1 sentence (the UNIVERSAL-OVER-THE-BENCH clause) // 🆕🆕 D372 +2 sentences (ONE clause at TWO amounts) // 🆕🆕 D371 +1 sentence // 🆕🆕 D370 +1 sentence // 🆕🆕 D369 +1 sentence // 🆕🆕 D368 +1 sentence
    expect(units(resolved)).toBe(1254); // 🆕🆕 D382 +1 printing (THE `. Then, ` JOIN — one sentence, one legal printing) // 🆕🆕 D380 +6 printings (THE STADIUM-DISCARD OP — TWO sentences, 4 + 2 legal printings, on ONE new FIELD-FREE `EffectOp`) // 🆕🆕 D379 +2 (THE EXACT HAND-SIZE READ — one sentence, both printings under the CANCEL consequent) // 🆕🆕 D378 +3 (STADIUM PRESENCE — `stadiumInPlay`: ONE bonus sentence at 1 legal printing, Probopass `sv10-098` "Mountain Drop" +70, PLUS one CANCEL sentence on the SAME member at 2 printings, Fan Rotom `sv07-118`/`sv08.5-085` "Assault Landing" — ONE new NULLARY `BoardCondition` member, ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and ONE `ATTACK_REQUIREMENT_CLAUSES` row) // 🆕🆕 D377 +3 // 🆕🆕 D376 +2 printings (the FILTERED DISCARD-PILE THRESHOLD) // 🆕🆕 D375 +2 printings (the CROSS-BOARD TYPE INTERSECTION) // 🆕🆕 D374 +2 printings (the NAMED-ENERGY clause) // 🆕🆕 D373 +2 printings (the UNIVERSAL-OVER-THE-BENCH clause) // 🆕🆕 D372 +2 printings (the CROSS-BOARD EQUAL-ENERGY clause) // 🆕🆕 D371 +2 printings (the OPPONENT-RESISTANCE clause) // 🆕🆕 D370 +2 printings (the bench-scoped {M} TYPE clause) // 🆕🆕 D369 +2 printings (the CROSS-BOARD Pokémon Tool clause) // 🆕🆕 D368 +3 printings
    // The delta is EXACTLY this slice's nine sentences / thirteen printings —
    // re-added from the parts rather than incremented.
    // 🆕🆕 D369 — the two subtrahends each gain this slice's step (1 sentence /
    // 2 printings), so both figures below are still D366's head, re-derived from
    // the live total rather than frozen at the head that measured them.
    // 🆕🆕 D370 — a THIRD subtrahend on each line, same shape: this slice's step is
    // 1 sentence / 2 printings, so D366's head is still re-derived from the live
    // total rather than frozen at the head that measured it.
    // 🆕🆕 D371 — a FOURTH, and the same 1 / 2 step (the OPPONENT-RESISTANCE clause).
    // 🆕🆕 D372 — a FIFTH, and the FIRST that is not a 1 / 2 step: TWO sentences and
    // TWO printings, because one clause is printed at two amounts. The sentence term
    // therefore takes a `- 2` where the four before it each took a `- 1`, while the
    // printing term takes the same `- 2` they did — which is the whole arithmetic of
    // "a clause-keyed band entry is not a sentence count", written as a subtraction.
    // 🆕🆕 D373 — a SIXTH subtrahend on each line, and a 1 / 2 step again: the
    // sentence term takes a `- 1` where D372's took a `- 2`.
    // 🆕🆕 D374 — a SEVENTH subtrahend on each line, and another 1 / 2 step (the
    // NAMED-ENERGY clause), so the sentence term takes one more `- 1`.
    // 🆕🆕 D375 — an EIGHTH, and a 1 / 2 step again (the TYPE INTERSECTION).
    // 🆕🆕 D376 — a NINTH, and a 1 / 2 step again (the FILTERED DISCARD-PILE THRESHOLD).
    // 🆕🆕 D377 — a `- 3` term: the CROSS-BOARD STATUS PAIR resolved THREE sentences at once
    // (two bonus, one cancel), so D366's head is still re-derived from the live total.
    // 🆕🆕 D378 — a `- 2` / `- 3` pair: STADIUM PRESENCE resolved TWO sentences worth THREE
    // printings, so the two terms differ for the second time in this chain (D372 was the
    // first, the other way round) — one clause under two consequents is not one sentence.
    // 🆕🆕 D379 — a `- 1` / `- 2` pair, the ordinary step: the EXACT HAND-SIZE READ
    // resolved ONE sentence worth TWO printings, and it is the first slice in this
    // chain whose sentence arrives entirely under the CANCEL consequent.
    // 🆕🆕 D380 — a `- 2` / `- 6` pair at the head, the WIDEST ratio in this chain:
    // the STADIUM-DISCARD OP resolved TWO sentences worth SIX printings, and it is
    // the first term here bought by an `EffectOp` rather than a `BoardCondition`.
    // 🆕🆕 D382 — a `- 1` / `- 1` pair at the FRONT of both chains: the `. Then, `
    // JOIN resolved ONE sentence worth ONE printing, on zero new readers and zero
    // new ops. ⚠️ **BOTH CHAINS ARE EDITED AT THE FRONT, NEVER AT THE END.**
    expect(
      resolved.length - 1 - 2 - 1 - 2 - TAKEN.length - 3 - 1 - 1 - 1 - 1 - 2 - 1 - 1 - 1 - 1,
    ).toBe(335);
    expect(
      units(resolved) - 1 - 6 - 2 - 3 - 13 - 3 - 3 - 2 - 2 - 2 - 2 - 2 - 2 - 2 - 2,
    ).toBe(1207);
  });

  it("🛑 NONE of the thirteen ids is a registry ATTACK, so the +16 stands still", () => {
    // D366's rule: the registry summand is REGISTRY-keyed and the raw one is
    // READER-keyed, so a reader move must be shown not to touch the other.
    const ids = new Set(registryCardIds());
    expect(ids.size).toBe(708);
    // ⚠️ ONE of the thirteen IS in the registry — Volbeat `sv06-009` — and it is
    // there on an ABILITY program, which is exactly the count a slice does not
    // think it is checking. Named, rather than glossed by an "all absent" claim
    // that would have been false.
    const present = TAKEN_IDS.filter((id) => ids.has(id));
    expect(present).toEqual(["sv06-009"]);
    // Its program's ONLY key is `attackGate` — an ability-driven gate, not an
    // authored attack — which is why `REGISTRY_ATTACKS` does not hold it and the
    // +16 cannot move. The key set is the reason, not the habit (D338's rule).
    expect(Object.keys(programFor("sv06-009") ?? {})).toEqual(["attackGate"]);
    for (const id of TAKEN_IDS) {
      expect(programFor(id)?.attack, id).toBeUndefined();
    }
  });

  it("the SPLIT summand cannot move either — no taken sentence carries a gate clause", () => {
    for (const [sentence] of TAKEN) {
      // Each resolves WHOLE, so it can never enter the split term, which is
      // "refused whole, resolved once the gate clause is taken off".
      expect(resolvedByAnyReader(sentence), sentence).toBe(true);
    }
  });
});
