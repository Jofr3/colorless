import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "./censusAttackCorpus";
import { countAttachedEnergy, providedEnergy } from "./continuous";
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
  FIXTURE_POOL,
  TYPED_ENERGY_THRESHOLD_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 🆕🆕 D391 — THE TYPED PER-BODY ENERGY THRESHOLD, AND THE SLICE WHOSE SHAPE
// QUESTION HONESTLY ANSWERED *FIELD*.
//
// Abomasnow `sv10-060` "Frozen Wood" ({W}{W}{W}{C}, `120+`, index **1** of TWO),
// **1 legal printing**: *"If this Pokémon has 2 or more {G} Energy attached, this
// attack does 120 more damage."*
//
// 🛑 **NINE CONSECUTIVE SLICES ANSWERED "SECOND MEMBER", AND A CONVENTION THAT
// ALWAYS ANSWERS THE SAME WAY HAS STOPPED BEING A MEASUREMENT.** D389 refused a
// SEAT parameter on `yourBenchAtLeast` on three grounds, and the strongest of them
// does not transfer here: that field would have been **REQUIRED** — a rename across
// 22 executable sites — and it would have saved no note body, because
// `conditionNote` prints a different SENTENCE per seat. `energy?` on
// `yourActiveEnergyAtLeast` is **OPTIONAL**: it edits ZERO of that member's 11
// executable sites, the delegate (`countAttachedEnergy`) has taken exactly this
// filter as a parameter since D128, and the note gains one interpolation SLOT
// rather than a second sentence. §2 drives all three of those as facts about the
// running code rather than restating them.
//
// ⚠️ **THE LINE THIS DRAWS**: the member's own doc block already separates it from
// `activeEnergyCountsEqual` by its COMPARAND. **A COMPARAND IS A SHAPE AND TAKES A
// MEMBER; A FILTER THE DELEGATE ALREADY ACCEPTS IS A FIELD.** That is the rule a
// successor inherits, so the next one is not a coin toss.
//
// 🛑 **AND THE PRINTED CARD IS WHAT MAKES THE FILTER NON-VACUOUS.** Frozen Wood
// costs **{W}{W}{W}{C}** and the clause counts **{G}** — a WATER Pokémon reading a
// GRASS clause — so with single-unit attachments every board that can legally
// declare the attack holds FOUR Energy cards, and the UNFILTERED reading at
// `count: 2` is TRUE on all of them. **Dropping the filter does not make the bonus
// wrong somewhere; it makes it UNCONDITIONAL** (§3, driven on the board).
//
// ⚠️ **A LITERAL ROW AND NOT A SIXTH TEMPLATE** (§5). Two tokens vary in principle,
// so D118's one-token test fails and D119's corollary applies — and a pattern would
// have been the WORST possible sixth one: `SELF_ENERGY_ATTACHED_CLAUSE` shares this
// clause's HEAD (`this Pokémon has `) *and* its TAIL (` Energy attached`), separated
// only by `any` versus a digit. That is the closest pair of anchors in the whole set
// and exactly what `clauseTemplateAnchors.test.ts` refuses.
//
// WHAT SHIPS: **1 optional FIELD** on a shipped `BoardCondition` member, **1 literal
// `CONDITIONAL_DAMAGE_CLAUSES` row**, **2 edited reader arms**, **2 fixtures**, **1
// `EnergyProgram` row** and **1 dedicated 60**. ZERO new members, maps, templates,
// patterns, ops or events; ZERO `packages/schema` bytes; `MATCH_RECORD_VERSION`
// stays **23**.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/** The nine live readers, run as one — the same set `censusAtHead.test.ts` and
    `inPlayTypeBonus.test.ts` use. */
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

/** THE SENTENCE THIS SLICE BUYS, byte-for-byte from the committed corpus. */
const TAKEN =
  "If this Pokémon has 2 or more {G} Energy attached, this attack does 120 more damage.";
const TAKEN_CLAUSE = "this Pokémon has 2 or more {G} Energy attached";

/** THE TRAP THAT STAYS IN THE RESIDUE — the largest thing in it (5 printings) and
    disqualified on SHAPE at D368, not on vocabulary: *"at least 2 extra Energy
    attached (in addition to this attack's cost)"* reads THIS ATTACK'S COST, and
    `conditionHolds(state, seat, cond)` is handed no attack. It shares this slice's
    printed noun and even its digit, which is what makes it the right control. */
const TRAP_CLAUSE =
  "this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost)";

/** The member this slice's row resolves to — the NARROWED form. */
const COND: BoardCondition = { kind: "yourActiveEnergyAtLeast", energy: "Grass", count: 2 };
/** …and the UNNARROWED form of the SAME member, D383's shipped shape untouched. */
const BARE: BoardCondition = { kind: "yourActiveEnergyAtLeast", count: 2 };
/** The typed-but-UNQUANTIFIED neighbour on the same body (D118). */
const ANY_GRASS: BoardCondition = { kind: "yourActiveHasEnergyAttached", energy: "Grass" };

// ── boards ─────────────────────────────────────────────────────────────────────

/** P1 fields the printed attacker with the Energy asked for, P2 fields the 340 HP
    defender, and BOTH benches are emptied and then filled with exactly the bodies
    asked for — `setActiveFromDeck` DISPLACES rather than replaces, and a stray body
    is precisely the thing a file about counting must not have. Returned on P2's
    turn.

    ⚠️ THE ATTACHMENTS ARE AN ORDERED RECORD AND EVERY BOARD BELOW NAMES ITS OWN, so
    no rung inherits an Energy it did not ask for. */
function ready(
  seed: number,
  attach: Readonly<Record<string, number>>,
  opts: { ownBench?: readonly string[]; opponentAttach?: Readonly<Record<string, number>> } = {},
): GameState {
  let state = driveSetup(
    seed,
    { p1: TYPED_ENERGY_THRESHOLD_DECK, p2: TYPED_ENERGY_THRESHOLD_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p1", "fix-frozenwood");
  for (const [id, n] of Object.entries(attach)) state = attachFromDeck(state, "p1", id, n);
  state = setActiveFromDeck(state, "p2", "fix-titan");
  for (const [id, n] of Object.entries(opts.opponentAttach ?? {})) {
    state = attachFromDeck(state, "p2", id, n);
  }
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of opts.ownBench ?? []) state = benchFromDeck(state, "p1", id);
  return state;
}

/** …and the same board handed to P1 with the turn already passed. P1 went SECOND, so
    this turn carries no §4 attack restriction. */
function armed(
  seed: number,
  attach: Readonly<Record<string, number>>,
  opts: Parameters<typeof ready>[2] = {},
): GameState {
  return mustApply(ready(seed, attach, opts), { type: "endTurn", seat: "p2" }).state;
}

/** Attack at `index` — **1** is the printed "Frozen Wood" and **0** the printed
    control "Lunge Out" — and report the damage actually dealt. The default is 1
    because the clause is on the SECOND printed attack, which is itself a first for
    this family of demonstrators. */
function damageDealt(state: GameState, index = 1): number {
  const after = mustApply(state, { type: "attack", seat: "p1", index });
  const dealt = after.events.find((e) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

/** The attacker's own body, for the direct `countAttachedEnergy` probes. */
function activeOf(state: GameState, seat: Seat = "p1") {
  const body = state.players[seat].active;
  if (body === null) throw new Error(`${seat} has no Active Pokémon`);
  return body;
}

describe("§1 — the price, RE-DERIVED: the residue, the band and the shape of the step", () => {
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

  it("🛑 it is the ONLY printed threshold of its shape, which is why the ROW is not short", () => {
    // The population that decides "row or template" (D118/D119): every legal attack
    // sentence spelling a NUMERIC threshold over Energy attached to one body. There
    // is exactly ONE, at ONE value, on ONE energy code — so a template would be
    // parameterising over a pool of one on BOTH axes at once, which is the Absol
    // argument one zone over, re-run here rather than inherited.
    const thresholds = corpus().filter(([, s]) => /\d+ or more \S+ Energy attached/.test(s));
    expect(thresholds).toHaveLength(1);
    expect(thresholds[0]?.[1]).toBe(TAKEN);
    // ⚠️ AND THE UNTYPED THRESHOLD IS PRINTED NOWHERE AT ALL, which is the fact
    // D383's block asserted and this rung keeps executing: that member was authored
    // from a printed COST's arity, and this slice does not change that — it adds the
    // one printed CLAUSE the member can now answer.
    expect(corpus().filter(([, s]) => /has \d+ or more Energy attached/.test(s))).toHaveLength(0);
  });

  it("🛑 the residue steps by exactly this ONE sentence and ONE printing", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    // The DEPARTURE and the SIZE are asserted separately: a guard that only checked
    // 14 / 17 could not tell "the row landed" from "a reader broke".
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
    // D390 left the residue at 15 / 18, re-derived here off the live readers rather
    // than quoted. 🛑 THE 2-PRINTING BAND WAS ALREADY EMPTY AND STAYS EMPTY, so the
    // band rung below is aimed at the WHOLE distribution and its refusal comes from
    // OUTSIDE the emptied band (D379's saturation rule).
    // 🆕🆕 D392 — 14 / 17 -> **13 / 16**: the SUBSTRING NAME READ left this residue — ONE
    // sentence at ONE printing (Team Rocket's Nidoqueen `sv10-116` "Love Impact", +120) —
    // re-derived live rather than decremented. 🛑 THE 2-PRINTING BAND STAYS EMPTY and the
    // distribution goes `{1: 12, 5: 1}` -> `{1: 11, 5: 1}`. ⚠️ AND THIS STEP WAS TAKEN BY A
    // SECOND MEMBER, the OPPOSITE shape from D391's one slice back — the measurements that
    // decided it are driven in `benchNameSubstring.test.ts` §2.
    expect([refused.length, units(refused)]).toEqual([5, 5]); // 🆕🆕 D436 -2 sentences / -5 printings (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D398 — the DECK-SIZE READ took the LAST BUILDABLE sentence out (Rabsca `sv08-014` "Counterturn", 1 printing), so 8 / 11 -> 7 / 10 and the residue is now EXHAUSTED of buildable rows: FIVE D207 banners and D368's 5-printing SHAPE refusal are all that is left, and this figure can only move again if a refusal's REASON expires
    // 🆕🆕 D392 — the OFFSET gains one on each axis: the head moved, D390's did not.
    expect([refused.length + 10, units(refused) + 13]).toEqual([15, 18]); // 🆕🆕 D398 — 1 sentence / 1 printing out (THE DECK-SIZE READ)
    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    // `{1: 13, 5: 1}` → `{1: 12, 5: 1}`: a SINGLETON left the singleton band and
    // nothing else moved. The only clause above one printing is still the 5-printing
    // declaration clause D368 disqualified on SHAPE — a fact about the whole
    // distribution, which is what keeps this rung able to go red for the reason that
    // matters (a reader narrowing so any clause returns to 2 fails it too).
    // 🆕🆕 D392 — 13 -> **12**: the SUBSTRING NAME READ's clause left the 1-printing band.
    expect(byClause.size).toBe(5); // 🆕🆕 D436 -1 clause: the 5-printing DECLARATION clause LEAVES this residue, and the 5 remaining are the D207 banners (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D398 — the DECK-SIZE READ took ONE more singleton out, a 1:1 step, and it was the LAST BUILDABLE one // 🆕🆕 D397 — the BENCHED-CUBONE FILTER took ONE more singleton out, back to a 1:1 step // 🆕🆕 D394 — the USED-ATTACK PAIR took TWO more singletons out at once, the second two-step in two slices
    expect([...byClause.values()].filter((n) => n > 1)).toEqual([]);// 🆕🆕 D436 the `n > 1` BAND IS NOW EMPTY — its one occupant was the 5-printing DECLARATION clause and this slice claims it. The rung still goes RED the moment any reader narrows so that a clause returns above one printing (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.)
    // 🆕🆕 D392 — 12 -> **11**, the whole of this slice's step.
    expect([...byClause.values()].filter((n) => n === 1)).toHaveLength(5); // 🆕🆕 D398 — the DECK-SIZE READ left the singleton band, 6 -> 5 // 🆕🆕 D397 — the BENCHED-CUBONE FILTER took ONE more singleton out, back to a 1:1 step // 🆕🆕 D394 — the USED-ATTACK PAIR took TWO more singletons out at once, the second two-step in two slices
    expect(byClause.has(TAKEN_CLAUSE)).toBe(false);
    // 🆕🆕 **D436 — THE TRAP LEFT THE RESIDUE, AND ITS STATED REASON WAS RIGHT ABOUT
    // THE VOCABULARY AND WRONG ABOUT THE SENTENCE.** This rung read *"refused for a
    // reason no vocabulary can fix: it reads the attack's own cost, and this member is
    // handed no attack"* — true of `BoardCondition`, which is still handed no attack,
    // and false of the engine, because `DamageCountSource` is evaluated inside
    // `attack()` where the declared cost is a local. ⚠️ **A REFUSAL SCOPED TO ONE
    // VOCABULARY MUST SAY SO** (D423's scoped-claim rule, arriving at a refusal).
    // The rung is INVERTED rather than deleted (D418): it still names the clause, still
    // pins its 5 printings against the corpus, and now reddens if the claim is lost.
    expect(byClause.get(TRAP_CLAUSE)).toBeUndefined();
    expect(
      units(corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === TRAP_CLAUSE)),
    ).toBe(5);
    expect(
      deriveAttackDamageBonus(`If ${TRAP_CLAUSE}, this attack does 100 more damage.`)?.count,
    ).toEqual({ kind: "extraEnergyUnitsBeyondCost", extra: 2 });
  });
});

describe("§2 — THE SHAPE CHOICE: an OPTIONAL FIELD, driven rather than argued", () => {
  it("🛑 the UNNARROWED member is untouched — same answer, same note, byte for byte", () => {
    // THE WHOLE CLAIM THAT SEPARATES A WIDENING FROM A RENAME. D383's shipped shape
    // is `{ kind, count }` with no `energy`, and nine of its eleven executable sites
    // spell exactly that. If the field had cost those sites anything, it would cost
    // it HERE — the bare object still type-checks, still answers the unfiltered card
    // count, and still returns the string it always returned.
    const board = armed(4111, { "fix-water-energy": 3, "fix-energy": 1 });
    expect(countAttachedEnergy(board, activeOf(board), null)).toBe(4);
    expect(conditionHolds(board, "p1", BARE)).toBe(true);
    expect(conditionNote(BARE)).toBe("your Active Pokémon has 2 or more Energy attached");
    expect(conditionNote({ kind: "yourActiveEnergyAtLeast", count: 3 })).toBe(
      "your Active Pokémon has 3 or more Energy attached",
    );
  });

  it("🛑 ABSENT MEANS UNNARROWED, and the narrowing is MONOTONE on every board here", () => {
    // D326's property, which is the reason an optional field is a widening at all: the
    // filtered set is a SUBSET of `pokemon.energy`, so the narrowed gate is TRUE on a
    // strict subset of the boards the bare one is — never on a board the bare one
    // refuses. Swept over the four attachment shapes this file builds rather than
    // asserted once, because "monotone" is a claim about all of them.
    const boards: readonly Readonly<Record<string, number>>[] = [
      { "fix-water-energy": 3, "fix-energy": 1 },
      { "fix-water-energy": 3, "fix-grass-energy": 1 },
      { "fix-water-energy": 3, "fix-grass-energy": 2 },
      { "fix-water-energy": 3, "fix-grassdouble": 1 },
    ];
    let strictlyNarrower = 0;
    for (const [i, attach] of boards.entries()) {
      const board = armed(4120 + i, attach);
      const bare = conditionHolds(board, "p1", BARE);
      const typed = conditionHolds(board, "p1", COND);
      expect(bare || !typed, JSON.stringify(attach)).toBe(true);
      if (bare && !typed) strictlyNarrower += 1;
    }
    // …and it is not VACUOUSLY monotone: three of the four boards separate them, so a
    // filter that silently did nothing would fail this line rather than pass it.
    expect(strictlyNarrower).toBe(3);
  });

  it("🛑 the note gains a SLOT, not a sentence — all three spellings from one string", () => {
    // The half of D389's refusal that genuinely did not transfer. There, the seat
    // parameter would have needed `conditionNote` to print a DIFFERENT sentence per
    // value, so the field saved no body. Here every spelling is the same sentence with
    // one noun phrase swapped, which is why the arm is one `return`.
    expect(conditionNote(COND)).toBe("your Active Pokémon has 2 or more Grass Energy attached");
    expect(conditionNote({ kind: "yourActiveEnergyAtLeast", count: 4, energy: "Water" })).toBe(
      "your Active Pokémon has 4 or more Water Energy attached",
    );
    // `Special` is the CARD CLASS and not a type (D118), so it is spelled whole rather
    // than run through the type slot — the one branch inside the branch.
    expect(conditionNote({ kind: "yourActiveEnergyAtLeast", count: 2, energy: "special" })).toBe(
      "your Active Pokémon has 2 or more Special Energy attached",
    );
    // ⚠️ AND THE BRACE CODE IS GONE FROM ALL OF THEM: a reject pill is read off the
    // board by a person, so the note does NOT round-trip to the printed bytes even
    // though the row's KEY does. Both directions are pinned in §5.
    expect(conditionNote(COND)).not.toContain("{G}");
  });

  it("🛑 a `count: 1` narrowing WOULD restate the neighbour — and nothing prints it", () => {
    // The overlap an honest field/member comparison has to name: at a count of 1 this
    // member and `yourActiveHasEnergyAttached` are the same predicate. It is NOT a
    // discriminator between the two shapes — a second member would have carried the
    // identical overlap — and it is D205's never-spelled shape rather than an
    // ambiguity, because the count comes off the printed digit and the pool prints 2.
    const boards: readonly Readonly<Record<string, number>>[] = [
      { "fix-water-energy": 3, "fix-energy": 1 },
      { "fix-water-energy": 3, "fix-grass-energy": 1 },
      { "fix-water-energy": 3, "fix-grass-energy": 2 },
    ];
    for (const attach of boards) {
      const board = armed(4130, attach);
      expect(conditionHolds(board, "p1", { ...COND, count: 1 })).toBe(
        conditionHolds(board, "p1", ANY_GRASS),
      );
    }
    expect(corpus().filter(([, s]) => /has 1 or more \S+ Energy attached/.test(s))).toHaveLength(0);
  });
});

describe("§3 — the clause DRIVES, and the UNFILTERED reading is unconditional", () => {
  it("🛑 120 bare, 240 boosted, and the printed control attack moves neither", () => {
    // The `120+` marker is real: the reader consumes the "+" and attack.ts drops the
    // printed base into the gate, so both halves of the assembly are exercised.
    expect(damageDealt(armed(4141, { "fix-water-energy": 3, "fix-grass-energy": 2 }))).toBe(240);
    expect(damageDealt(armed(4142, { "fix-water-energy": 3, "fix-energy": 1 }))).toBe(120);
    // "Lunge Out" ({C}{C}{C}, a flat 90) is the printed control at index 0 — the same
    // body, the same board, a number this clause cannot reach.
    expect(damageDealt(armed(4143, { "fix-water-energy": 3, "fix-grass-energy": 2 }), 0)).toBe(90);
    expect(damageDealt(armed(4144, { "fix-water-energy": 3, "fix-energy": 1 }), 0)).toBe(90);
  });

  it("🛑 THE ATTRIBUTION CONTROL: dropping the filter pays the +120 on EVERY board", () => {
    // D214's rule, and the sharpest form this run has had. The printed cost is
    // {W}{W}{W}{C} and the clause counts {G}, so with single-unit attachments any
    // board that can legally declare "Frozen Wood" holds FOUR Energy cards — and the
    // unfiltered reading at 2 is TRUE on all of them. **A mutant that passes `null`
    // instead of `cond.energy` does not misjudge some boards; it makes the printed
    // bonus unconditional**, which is why the FALSE case here is a real board and not
    // an unpayable one.
    const cost = FIXTURE_POOL["fix-frozenwood"]?.attacks?.[1]?.cost ?? [];
    expect(cost).toEqual(["Water", "Water", "Water", "Colorless"]);
    expect(cost).not.toContain("Grass");
    const boards: readonly Readonly<Record<string, number>>[] = [
      { "fix-water-energy": 3, "fix-energy": 1 },
      { "fix-water-energy": 3, "fix-grass-energy": 1 },
      { "fix-water-energy": 4 },
    ];
    for (const [i, attach] of boards.entries()) {
      const board = armed(4150 + i, attach);
      // it can pay, so the board is one the printing really reaches…
      expect(damageDealt(board), JSON.stringify(attach)).toBe(120);
      // …and the unfiltered reading is TRUE on it, so the filter is the whole answer.
      expect(conditionHolds(board, "p1", BARE), JSON.stringify(attach)).toBe(true);
      expect(conditionHolds(board, "p1", COND), JSON.stringify(attach)).toBe(false);
    }
  });

  it("🛑 the THRESHOLD is a FLOOR, swept at the printed value and both neighbours", () => {
    // D379's rule (`exactHandSize`): drive the value and its two neighbours, because
    // `>=` → `>` and `>=` → `===` are each green on every other count. Grass 0..3
    // against thresholds 1..3, and the whole table is derived from `>=` rather than
    // written out, so a mutated operator fails a cell rather than a spelling.
    for (let grass = 0; grass <= 3; grass += 1) {
      const attach: Record<string, number> = { "fix-water-energy": 3 };
      if (grass > 0) attach["fix-grass-energy"] = grass;
      else attach["fix-energy"] = 1;
      const board = armed(4160 + grass, attach);
      expect(countAttachedEnergy(board, activeOf(board), "Grass"), `grass=${grass}`).toBe(grass);
      for (const count of [1, 2, 3]) {
        expect(
          conditionHolds(board, "p1", { ...COND, count }),
          `grass=${grass} count=${count}`,
        ).toBe(grass >= count);
      }
    }
  });

  it("🛑 an EMPTY Active Spot is FALSE, not a throw and not a body holding zero", () => {
    // The standing rule for every body-reading member in this union, and unreachable
    // from the attack path (§8 guarantees an Active) — so only a direct probe sees it.
    const board = armed(4170, { "fix-water-energy": 3, "fix-grass-energy": 2 });
    const empty: GameState = {
      ...board,
      players: { ...board.players, p1: { ...board.players.p1, active: null } },
    };
    expect(conditionHolds(empty, "p1", COND)).toBe(false);
    expect(conditionHolds(empty, "p1", BARE)).toBe(false);
    // …and at a count of 0 as well, which is where a `?? 0` slip would answer TRUE.
    expect(conditionHolds(empty, "p1", { ...COND, count: 0 })).toBe(false);
  });
});

describe("§4 — CARDS, not UNITS — and the fixture that can tell them apart", () => {
  it("🛑 `fix-grassdouble` provides TWO {G} units from ONE card, and it counts ONE", () => {
    // The question the resume point put in FRONT of this build, answered on a board
    // rather than inherited from the untyped arm's paragraph. `countAttachedEnergy`
    // counts CARDS — "one Energy card is one Energy however many units it provides" —
    // and the typed branch filters those cards by PROVISION rather than re-tallying
    // units, so the two readings disagree here and only here.
    const board = armed(4180, { "fix-water-energy": 3, "fix-grassdouble": 1 });
    const body = activeOf(board);
    expect(providedEnergy(board, body).filter((u) => u === "Grass")).toHaveLength(2);
    expect(countAttachedEnergy(board, body, "Grass")).toBe(1);
    expect(countAttachedEnergy(board, body, null)).toBe(4);
    // 🛑 AND IT SHOWS IN THE PRINTED NUMBER: a UNITS reading pays the +120 on this
    // board and the engine does not.
    expect(conditionHolds(board, "p1", COND)).toBe(false);
    expect(damageDealt(board)).toBe(120);
  });

  it("🛑 TWO of them DO arm it — two cards, four units, and the cards are what count", () => {
    const board = armed(4181, { "fix-water-energy": 3, "fix-grassdouble": 2 });
    const body = activeOf(board);
    expect(providedEnergy(board, body).filter((u) => u === "Grass")).toHaveLength(4);
    expect(countAttachedEnergy(board, body, "Grass")).toBe(2);
    expect(damageDealt(board)).toBe(240);
  });

  it("🛑 `fix-blend` could NOT have asked this question, which is why a new row exists", () => {
    // D390's rule one member over: a fixture's discriminating power is relative to the
    // PARAMETER UNDER TEST. `fix-blend` provides two DISTINCT types, so under a {G}
    // question it contributes one Grass card and one Grass unit and the two readings
    // agree — reusing it would have left the units defect alive while the suite read
    // as thorough. The declaration is executed, not asserted in prose.
    expect(FIXTURE_POOL["fix-grassdouble"]?.energyType).toBe("Special");
    const board = armed(4182, { "fix-water-energy": 3, "fix-grassdouble": 1 });
    const provided = providedEnergy(board, activeOf(board));
    // ONE card, TWO identical units — the duplicate survives `providedEnergy`'s
    // `flatMap`, which is what makes the disagreement measurable at all.
    expect(new Set(provided.filter((u) => u === "Grass")).size).toBe(1);
    expect(provided.filter((u) => u === "Grass")).toHaveLength(2);
  });

  it("🛑 PROVISION, not the printed card class: a Special counts toward a typed clause", () => {
    // D118's standing rule, and the reason the typed branch goes through
    // `providesEnergyType` rather than reading `Card.name`. Two Grass-providing
    // SPECIALS arm a clause whose printed noun is "{G} Energy", exactly as two Basic
    // {G} do — one card each, whatever the class.
    const specials = armed(4183, { "fix-water-energy": 3, "fix-grassdouble": 2 });
    const basics = armed(4184, { "fix-water-energy": 3, "fix-grass-energy": 2 });
    expect(conditionHolds(specials, "p1", COND)).toBe(true);
    expect(conditionHolds(basics, "p1", COND)).toBe(true);
    // …and the WATER attachments never count, on either board, which is the filter
    // doing its one job.
    expect(countAttachedEnergy(specials, activeOf(specials), "Water")).toBe(3);
    expect(countAttachedEnergy(basics, activeOf(basics), "Water")).toBe(3);
  });
});

describe("§5 — the ROW, its refusals, and why it is not a sixth TEMPLATE", () => {
  it("maps the printed sentence onto the narrowed member at the printed 120", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: COND },
    });
  });

  it("🛑 the TEMPLATE beside it shares BOTH anchors and still claims nothing here", () => {
    // `SELF_ENERGY_ATTACHED_CLAUSE` is `^this Pokémon has any (.+) Energy attached$` —
    // this clause's HEAD and TAIL with `any` where the digit is. It is the closest
    // pair of anchors in the whole template set, which is the reason this shape is a
    // ROW: as a sixth pattern it would have entered
    // `clauseTemplateAnchors.test.ts`'s cross product overlapping an existing one at
    // BOTH seams. Driven in both directions.
    expect(
      deriveAttackDamageBonus("If this Pokémon has any {G} Energy attached, this attack does 120 more damage."),
    ).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: ANY_GRASS },
    });
    // …and the template does NOT answer the digit shape, on the very code it owns.
    expect(
      deriveAttackDamageBonus("If this Pokémon has any 2 or more {G} Energy attached, this attack does 120 more damage."),
    ).toBe(null);
  });

  it("🛑 a ROW is keyed WHOLE: the same shape at another code or another count is refused", () => {
    // The price of D119's corollary, stated as a measurement rather than a caveat.
    // Neither of these is printed, so the refusal is about a sentence the catalog
    // does not have — and the day one prints, it is one more row and not a re-reading
    // of this one.
    for (const clause of [
      "this Pokémon has 2 or more {R} Energy attached",
      "this Pokémon has 3 or more {G} Energy attached",
      "this Pokémon has 2 or more Grass Energy attached",
      "this Pokémon has 2 or more {C} Energy attached",
    ]) {
      expect(corpus().some(([, s]) => BONUS.exec(s.trim())?.[1] === clause), clause).toBe(false);
      expect(deriveAttackDamageBonus(`If ${clause}, this attack does 120 more damage.`), clause).toBe(
        null,
      );
    }
  });

  it("keeps the outer sentence anchors, so the row cannot be reached from a fragment", () => {
    for (const text of [
      `if ${TAKEN_CLAUSE}, this attack does 120 more damage.`,
      `If ${TAKEN_CLAUSE}, this attack does 120 more damage`,
      `If ${TAKEN_CLAUSE}, this attack does 120 more damage. Then, draw a card.`,
      `Flip a coin. If ${TAKEN_CLAUSE}, this attack does 120 more damage.`,
    ]) {
      expect(deriveAttackDamageBonus(text), text).toBe(null);
    }
  });

  it("🛑 the note does NOT round-trip to the row's key, and the key is not the note", () => {
    // The brace code is part of the KEY and the note spells the name (D118), so the
    // two are asserted against each other explicitly rather than left to look alike.
    expect(TAKEN_CLAUSE).toContain("{G}");
    expect(conditionNote(COND)).toBe("your Active Pokémon has 2 or more Grass Energy attached");
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(COND)}, this attack does 120 more damage.`),
    ).toBe(null);
  });
});

describe("§6 — the ZONE and the SEAT: your ACTIVE's own attachments, and nothing else", () => {
  it("🛑 Grass on your own BENCH does not arm it", () => {
    // The near miss the import list makes available: `countEnergyInPlay` is one
    // identifier away in interpreter.ts and would read the whole SIDE. Every board
    // with an empty Bench is green either way, so this rung fields one deliberately.
    let state = ready(4191, { "fix-water-energy": 3, "fix-energy": 1 }, { ownBench: ["fix-titan"] });
    state = attachBenchFromDeck(state, "p1", 0, "fix-grass-energy", 2);
    const board = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    expect(countAttachedEnergy(board, activeOf(board), "Grass")).toBe(0);
    expect(conditionHolds(board, "p1", COND)).toBe(false);
    expect(damageDealt(board)).toBe(120);
  });

  it("🛑 Grass across the table does not arm it either", () => {
    const board = armed(
      4192,
      { "fix-water-energy": 3, "fix-energy": 1 },
      { opponentAttach: { "fix-grass-energy": 2 } },
    );
    expect(countAttachedEnergy(board, activeOf(board, "p2"), "Grass")).toBe(2);
    expect(conditionHolds(board, "p1", COND)).toBe(false);
    expect(conditionHolds(board, "p2", COND)).toBe(true);
    expect(damageDealt(board)).toBe(120);
  });

  it("🛑 …and the member is SEAT-RELATIVE, told apart on ONE board from BOTH seats", () => {
    // D380's rule: a p1-only suite cannot tell "reads YOUR Active" from "reads p1's
    // Active". One board, two seats, two DIFFERENT answers.
    const board = armed(
      4193,
      { "fix-water-energy": 3, "fix-grass-energy": 2 },
      { opponentAttach: { "fix-energy": 2 } },
    );
    expect(conditionHolds(board, "p1", COND)).toBe(true);
    expect(conditionHolds(board, "p2", COND)).toBe(false);
  });
});
