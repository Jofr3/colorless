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
  EVOLVED_FROM_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  handUid,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 🆕🆕 D393 — THE EVOLVE PAIR: TWO PRINTED SENTENCES, ONE MECHANISM, ONE FIELD.
//
// Gholdengo `sv08-131` "Strike It Rich" ({M}, `30+`, index **0** of TWO):
//   *"If this Pokémon evolved from Gimmighoul during this turn, this attack does
//    90 more damage."* — **1 legal printing**
// Misty's Starmie `sv10-047` "Abrupt Flash" ({W}, `60+`, index 0 of ONE):
//   *"If this Pokémon evolved from Misty's Staryu during this turn, this attack
//    does 80 more damage."* — **1 legal printing**
//
// 🛑 **PRICED AS A PAIR, AND THAT IS WHAT ENDS FIVE SLICES OF A SATURATED
// 1-PRINTING BAND.** The two clauses differ only in the card they name, so one
// member and one `InPlayPokemon` field serve both. §1 re-derives the 2 off the
// committed corpus rather than inheriting it from a handoff.
//
// 🛑 **THE UNION HALF WAS THE EASY HALF; THE SLICE IS THE STATE SHAPE.** The
// handoff attached a FALSIFIABLE PREDICTION — a per-body `evolvedTurn: number |
// null` (D386's shape) and NOT a per-seat `GameState` record (D326's) — and named
// the two things most likely to falsify it. §2 tests it instead of assuming it.
//
//   · **FALSIFIER (a) FIRED AND ITS CONCLUSION DID NOT.** The handoff said: *"if
//     the placement turns out to have a single call site that already knows the
//     turn, a seat record may be cheaper to WRITE"*. **That site exists** —
//     `evolveOnto` (types.ts) is the engine's ONE evolution placement, reached by
//     `placeEvolution` from both hand routes and directly by all four
//     `evolveFromDeck*` ops, and it already writes `turnPlayed: state.turn`. So
//     the antecedent is TRUE and the consequent is FALSE: a seat record would be
//     written at the SAME single site and buy nothing, because the cost of a
//     per-body stamp was never the threading.
//   · **FALSIFIER (b) DID NOT FIRE.** `redactedInPlayOf` (redact.ts) names its
//     output fields one at a time rather than spreading the body, and
//     `packages/schema` has never carried `InPlayPokemon` at all. Both take ZERO
//     bytes, so D386's precedent transfers whole.
//   · **AND THE COMPILER TIED THEM, WHICH IS D386's RESULT AGAIN.** Measured under
//     `tsc -b --force` at this head: a REQUIRED field on `InPlayPokemon` costs
//     **1 file / 1 site** (`makeInPlay`) and a REQUIRED `GameState` record costs
//     **1 file / 1 site** (`setup.ts`).
//
// 🛑 **SO WHAT SETTLED IT IS THE PRINTED SUBJECT, AND §4 DRIVES IT ON A BOARD.**
// *"this Pokémon"* is one BODY. A per-seat record answers *"did this SEAT evolve
// something from Misty's Staryu this turn"* and pays the +80 to an Active that did
// nothing, on the ordinary board where the body that evolved is on the BENCH.
//
// 🛑 **`MATCH_RECORD_VERSION` 23 → 24**, the first bump since D386 and its exact
// case — a new REQUIRED field on a structure persisted inside `MatchRecord.state`.
// §5 states the reading a v23 record would get.
//
// WHAT SHIPS: **1 new `BoardCondition` member** (`yourActiveEvolvedFromThisTurn
// { name }`), **1 new REQUIRED `InPlayPokemon` field** (`evolvedTurn`), **2 literal
// `CONDITIONAL_DAMAGE_CLAUSES` rows**, **2 new exhaustive switch arms**, **4
// fixtures** and **1 dedicated deck**. ZERO edited reader arms, ZERO templates,
// patterns, maps, vocabulary, card predicates, ops, events, error codes, prompt
// kinds or registry rows; ZERO `redact.ts` and ZERO `packages/schema` bytes.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/** The nine live readers, run as one — the same set `censusAtHead.test.ts` and
    `benchNameSubstring.test.ts` use. */
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

/** THE TWO SENTENCES THIS SLICE BUYS, byte for byte off the committed corpus. */
const GOLD =
  "If this Pokémon evolved from Gimmighoul during this turn, this attack does 90 more damage.";
const GOLD_CLAUSE = "this Pokémon evolved from Gimmighoul during this turn";
const STAR =
  "If this Pokémon evolved from Misty's Staryu during this turn, this attack does 80 more damage.";
const STAR_CLAUSE = "this Pokémon evolved from Misty's Staryu during this turn";

/** THE THIRD PRINTING OF THE SAME BOARD FACT, WHICH **D393** DELIBERATELY DID NOT
    BUY: its consequent is a DISCARD, not damage, so the outer skeleton refuses it
    before the clause table is consulted. Named here so a successor prices it from a
    measurement rather than rediscovering it.

    🆕🆕 **D486 BUILT IT, AND THE HALF OF THIS NOTE THAT SAID *"nothing here has to
    change when that day comes"* WAS FALSE** — corrected in place and dated
    (D178/D442/D466) rather than deleted. The refusal's stated REASON still holds
    exactly as written: the bonus skeleton `BONUS` below does still refuse this
    sentence, and it always will. What was wrong is the implied repair. *"One
    consequent away"* pointed at `deriveAttackBonusConsequent`, whose reading carries a
    REQUIRED `bonus: number` this sentence prints no damage for; the row was in fact one
    COMPOUND ANCHOR away in `deriveAttackEffect`, over a composition of ops that had all
    shipped — and it also needed a THIRD `CONDITIONAL_DAMAGE_CLAUSES` row, which is
    precisely the *"nothing here has to change"* that turned out to be wrong.
    ⚠️ **A refusal can be right about every fact it states and wrong about which file
    pays** (D479's REASON-ONLY class, one field over). Driven in
    `evolvedDiscardCompound.test.ts`; this file keeps its half as a MEASUREMENT. */
const SALANDIT =
  "Your opponent discards a card from their hand. If this Pokémon evolved from Salandit during this turn, your opponent discards 2 more cards.";

const GIMMIGHOUL: BoardCondition = {
  kind: "yourActiveEvolvedFromThisTurn",
  name: "Gimmighoul",
};
const STARYU: BoardCondition = {
  kind: "yourActiveEvolvedFromThisTurn",
  name: "Misty's Staryu",
};

// ── boards ─────────────────────────────────────────────────────────────────────

/** A board on **P1's SECOND turn**, because §4/§10 refuses an evolution on a
    player's own first turn (`FIRST_TURN_EVOLVE`, turn.ts) — three `endTurn`s are
    the cheapest route to a turn on which the printed line of play is legal at all.

    P1's Active and Bench are then arranged from the deck: `setActiveFromDeck`
    DISPLACES rather than replaces, so both benches are emptied afterwards. Every
    body placed this way arrives through `makeInPlay(uid, 0)` — `turnPlayed` 0 and
    **`evolvedTurn` null** — which is exactly the un-evolved state the FALSE cases
    below need and the state an evolution then overwrites. */
function ready(
  seed: number,
  opts: { active: string; bench?: readonly string[]; energy: string },
): GameState {
  let state = driveSetup(seed, { p1: EVOLVED_FROM_DECK, p2: EVOLVED_FROM_DECK }, { first: "p2" });
  for (const seat of ["p2", "p1", "p2"] as const) {
    state = mustApply(state, { type: "endTurn", seat }).state;
  }
  state = setActiveFromDeck(state, "p1", opts.active);
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of opts.bench ?? []) state = benchFromDeck(state, "p1", id);
  return attachFromDeck(state, "p1", opts.energy, 3);
}

/** Play `cardId` out of P1's hand as an evolution onto `target`. The card is
    moved deck → hand first, so no board below depends on what the opening draw
    happened to contain. */
function evolve(state: GameState, cardId: string, target: number | "active"): GameState {
  const withCard = handFromDeck(state, "p1", cardId, 1);
  return mustApply(withCard, {
    type: "evolve",
    seat: "p1",
    uid: handUid(withCard, "p1", cardId),
    target: target === "active" ? { spot: "active" } : { spot: "bench", index: target },
  }).state;
}

/** Declare P1's attack at `index` and report the damage actually dealt. */
function damageDealt(state: GameState, index = 0): number {
  const after = mustApply(state, { type: "attack", seat: "p1", index });
  const dealt = after.events.find((e) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

const activeOf = (state: GameState, seat: Seat) => state.players[seat].active;

// ────────────────────────────────────────────────────────────────────────────
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

  it("🛑 the PAIR is real, is worth 2 printings, and both reached the SKELETON all along", () => {
    for (const [sentence, clause, amount] of [
      [GOLD, GOLD_CLAUSE, "90"],
      [STAR, STAR_CLAUSE, "80"],
    ] as const) {
      expect(corpus().filter(([, s]) => s === sentence)).toHaveLength(1);
      expect(units(corpus().filter(([, s]) => s === sentence))).toBe(1);
      // Both were refused at the CLAUSE, not at the skeleton: the bonus pattern
      // always matched and always captured the printed amount.
      expect(BONUS.test(sentence)).toBe(true);
      expect(BONUS.exec(sentence)?.[1]).toBe(clause);
      expect(BONUS.exec(sentence)?.[2]).toBe(amount);
    }
    // 🛑 **THE PAIR IS THE PRICE, AND THIS IS THE ASSERTION THAT SAYS SO.** Two
    // sentences, one printing each, two DIFFERENT printed amounts — so the amount
    // lives in the outer skeleton and the clauses differ only in the card they name.
    // A slice that bought one of them would have bought the same field for half.
    const pair = corpus().filter(([, s]) => s === GOLD || s === STAR);
    expect(pair).toHaveLength(2);
    expect(units(pair)).toBe(2);
    expect(new Set(pair.map(([, s]) => BONUS.exec(s)?.[2]))).toEqual(new Set(["90", "80"]));
  });

  it("🛑 the FAMILY is THREE and the third is refused by THIS file's SKELETON, not by its clause", () => {
    // The population that decides how wide this member has to be. The legal attack
    // column prints "evolved from" THREE times, and the third — Salandit's — carries
    // the SAME board fact under a DISCARD consequent, so the bonus skeleton refuses
    // it before `CONDITIONAL_DAMAGE_CLAUSES` is ever consulted.
    const family = corpus().filter(([, s]) => s.includes("evolved from"));
    expect(family).toHaveLength(3);
    expect(units(family)).toBe(3);
    const shaped = family.filter(([, s]) => BONUS.test(s.trim()));
    expect(shaped).toHaveLength(2);
    expect(new Set(shaped.map(([, s]) => s))).toEqual(new Set([GOLD, STAR]));
    // 🆕🆕 **D486 RE-POINTED THE LAST THREE LINES OF THIS RUNG, AND THE MOVE IS THE
    // POINT.** They used to read *"AND IT STAYS UNRESOLVED, which is what says this
    // slice did not quietly widen a reader into a sentence it was never priced for.
    // The member is ONE consequent away from serving it and nothing here has to
    // change when that day comes"*. **The sentence is now RESOLVED — by
    // `deriveAttackEffect`, through a compound anchor, and the clause table DID have
    // to change** (a third literal row). ⚠️ **The refusal this file owns survives
    // whole, and it is the one worth keeping executable:** `BONUS` — this file's copy
    // of the bonus skeleton — still refuses the sentence, so D393's *"refused by its
    // consequent, not by its clause"* is true today, was true when written, and is
    // measured here rather than remembered. What is gone is only the inference about
    // where the repair would land (D479's REASON-ONLY class).
    expect(corpus().some(([, s]) => s === SALANDIT)).toBe(true);
    expect(BONUS.test(SALANDIT.trim())).toBe(false);
    expect(deriveAttackBonusConsequent(SALANDIT)).toBeNull();
    expect(deriveAttackDamageBonus(SALANDIT)).toBeNull();
    // …and it is claimed by exactly ONE reader, which is not one of this file's two.
    expect(resolvedByAnyReader(SALANDIT)).toBe(true);
    expect(READERS.filter((read) => read(SALANDIT) !== null).map((read) => read.name)).toEqual([
      "deriveAttackEffect",
    ]);
    // 🛑 **THE CLAUSE IS SHARED AND THE THIRD ROW IS THIS MEMBER'S THIRD NAME**, so the
    // family the two rows above were priced as a PAIR for is now a TRIPLE — and one
    // member still serves all three, which is D393's whole argument surviving a slice
    // it did not anticipate.
    expect(deriveAttackEffect(SALANDIT)?.[1]).toMatchObject({
      op: "conditionGate",
      cond: { kind: "yourActiveEvolvedFromThisTurn", name: "Salandit" },
    });
  });

  it("🛑 the residue steps by exactly TWO sentences and TWO printings", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    // The DEPARTURE and the SIZE are asserted separately: a guard that only checked
    // 11 / 14 could not tell "the two rows landed" from "a reader broke".
    expect(refused.some(([, s]) => s === GOLD)).toBe(false);
    expect(refused.some(([, s]) => s === STAR)).toBe(false);
    expect(resolvedByAnyReader(GOLD)).toBe(true);
    expect(resolvedByAnyReader(STAR)).toBe(true);
    // D392 left the residue at 13 / 16, re-derived here off the live readers.
    expect([refused.length, units(refused)]).toEqual([5, 5]); // 🆕🆕 D436 -2 sentences / -5 printings (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D398 — the DECK-SIZE READ took the LAST BUILDABLE sentence out (Rabsca `sv08-014` "Counterturn", 1 printing), so 8 / 11 -> 7 / 10 and the residue is now EXHAUSTED of buildable rows: FIVE D207 banners and D368's 5-printing SHAPE refusal are all that is left, and this figure can only move again if a refusal's REASON expires
    expect([refused.length + 8, units(refused) + 11]).toEqual([13, 16]); // 🆕🆕 D398 — 1 sentence / 1 printing out (THE DECK-SIZE READ)
    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    // `{1: 11, 5: 1}` → `{1: 9, 5: 1}`: TWO singletons left the singleton band and
    // nothing else moved. The only clause above one printing is still the 5-printing
    // declaration clause D368 disqualified on SHAPE, so this rung goes red from the
    // other side too — a reader narrowing until some clause returns to 2 fails it.
    expect(byClause.size).toBe(5); // 🆕🆕 D436 -1 clause: the 5-printing DECLARATION clause LEAVES this residue, and the 5 remaining are the D207 banners (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D398 — the DECK-SIZE READ took ONE more singleton out, a 1:1 step, and it was the LAST BUILDABLE one // 🆕🆕 D397 — the BENCHED-CUBONE FILTER took ONE more singleton out, back to a 1:1 step // 🆕🆕 D394 — the USED-ATTACK PAIR took TWO more singletons out at once, the second two-step in two slices
    expect([...byClause.values()].filter((n) => n === 1)).toHaveLength(5); // 🆕🆕 D398 — the DECK-SIZE READ left the singleton band, 6 -> 5 // 🆕🆕 D397 — the BENCHED-CUBONE FILTER took ONE more singleton out, back to a 1:1 step // 🆕🆕 D394 — the USED-ATTACK PAIR took TWO more singletons out at once, the second two-step in two slices
    expect([...byClause.values()].filter((n) => n === 5)).toHaveLength(0);// 🆕🆕 D436 the 5-printing band EMPTIES with the declaration clause (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.)
    expect([...byClause.values()].filter((n) => n === 2)).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("§2 — the SHAPE questions, measured on the running code rather than argued", () => {
  it("🛑 ONE member serves BOTH printings — the pair shares a `kind` and differs in `name`", () => {
    // The union half, and the whole argument for pricing the pair as a pair: the two
    // clause rows resolve to the SAME member at DIFFERENT names, so a second member
    // (or a second field) would have been two spellings of one board fact.
    expect(deriveAttackDamageBonus(GOLD)).toEqual({
      per: 90,
      count: { kind: "boardCondition", cond: GIMMIGHOUL },
    });
    expect(deriveAttackDamageBonus(STAR)).toEqual({
      per: 80,
      count: { kind: "boardCondition", cond: STARYU },
    });
    expect(GIMMIGHOUL.kind).toBe(STARYU.kind);
  });

  it("🛑 the note takes a SLOT, not a second SENTENCE — and round-trips to BOTH keys", () => {
    // D391's rule read from the FIELD side for once: the two printings differ in a
    // token the note interpolates, so `conditionNote` gains ONE arm with ONE slot
    // rather than one arm per printing. That is the half of D389's arithmetic that
    // DOES transfer here, and it is why a second member was never a candidate.
    expect(conditionNote(GIMMIGHOUL)).toBe("your Active Pokémon evolved from Gimmighoul during this turn");
    expect(conditionNote(STARYU)).toBe(
      "your Active Pokémon evolved from Misty's Staryu during this turn",
    );
    // …and the note differs from its `CONDITIONAL_DAMAGE_CLAUSES` key by exactly the
    // resolved pronoun (D116) and nothing else, in BOTH directions.
    expect(conditionNote(GIMMIGHOUL).replace("your Active Pokémon", "this Pokémon")).toBe(
      GOLD_CLAUSE,
    );
    expect(conditionNote(STARYU).replace("your Active Pokémon", "this Pokémon")).toBe(STAR_CLAUSE);
    // The round trip through the table, at the PRINTED clause rather than the note.
    expect(deriveAttackDamageBonus(`If ${GOLD_CLAUSE}, this attack does 90 more damage.`)?.count).toEqual({
      kind: "boardCondition",
      cond: GIMMIGHOUL,
    });
    expect(deriveAttackDamageBonus(`If ${STAR_CLAUSE}, this attack does 80 more damage.`)?.count).toEqual({
      kind: "boardCondition",
      cond: STARYU,
    });
  });

  it("🛑 TWO LITERAL ROWS AND NO SIXTH TEMPLATE — an unprinted name resolves to NOTHING", () => {
    // 🛑 THE ASSERTION THAT SAYS "ROW, NOT PATTERN". A template
    // `^this Pokémon evolved from (.+) during this turn$` would capture a card NAME,
    // which is open-ended and has nothing to fail against, so an unprinted name would
    // resolve to a predicate that answers FALSE forever and SILENTLY. Under two rows
    // it lands on the loud unresolved path instead — which is the whole difference,
    // and it is the reading D392 settled one cluster over.
    for (const name of ["Rayquaza", "Staryu", "gimmighoul", "Misty's Starmie"]) {
      const invented = `If this Pokémon evolved from ${name} during this turn, this attack does 90 more damage.`;
      expect(resolvedByAnyReader(invented), name).toBe(false);
    }
    // ⚠️ "Staryu" and "gimmighoul" are the two near misses that matter: the first
    // drops the printed possessive and the second changes one letter's case. Neither
    // resolves, so the row keys are the printed bytes and not a normalisation of them.
  });

  it("⚠️ the PRE-EVOLUTION NAME is read off the STACK, so the member buys only ONE field", () => {
    // The measurement behind "one field, not two". `evolveOnto` APPENDS, so the card
    // evolved FROM is always the entry one below the stack TOP — §1.2's identity rule
    // read one position down. A stored name would be a second spelling of a fact the
    // stack already holds, and the two could disagree (D222).
    const state = evolve(ready(11, { active: "fix-gimmighoul", energy: "fix-metal-energy" }), "fix-strikeitrich", "active");
    const active = activeOf(state, "p1");
    expect(active?.stack).toHaveLength(2);
    expect(state.cardIdByUid[active?.stack[0] ?? ""]).toBe("fix-gimmighoul");
    expect(state.cardIdByUid[active?.stack[1] ?? ""]).toBe("fix-strikeitrich");
    // …and the field that IS bought is one number, on the body, equal to the turn.
    expect(active?.evolvedTurn).toBe(state.turn);
    expect(Object.keys(active ?? {})).toContain("evolvedTurn");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("§3 — the two printed cards, on boards, at the printed numbers", () => {
  it("🛑 Gholdengo: 30 un-evolved, 120 when it evolved from Gimmighoul THIS turn", () => {
    // FALSE — placed straight into play, so `evolvedTurn` is null and the printed
    // base stands alone. This is the case that goes red if the arm ever answers
    // TRUE off `evolveFrom` (a fact about the CARD) instead of off the stamp.
    const flat = ready(1, { active: "fix-strikeitrich", energy: "fix-metal-energy" });
    expect(conditionHolds(flat, "p1", GIMMIGHOUL)).toBe(false);
    expect(damageDealt(flat)).toBe(30);
    // TRUE — a Gimmighoul evolved into it on this very turn: 30 + 90.
    const armed = evolve(
      ready(1, { active: "fix-gimmighoul", energy: "fix-metal-energy" }),
      "fix-strikeitrich",
      "active",
    );
    expect(conditionHolds(armed, "p1", GIMMIGHOUL)).toBe(true);
    expect(damageDealt(armed)).toBe(120);
  });

  it("🛑 Misty's Starmie: 60 un-evolved, 140 when it evolved from Misty's Staryu THIS turn", () => {
    const flat = ready(2, { active: "fix-abruptflash", energy: "fix-water-energy" });
    expect(conditionHolds(flat, "p1", STARYU)).toBe(false);
    expect(damageDealt(flat)).toBe(60);
    const armed = evolve(
      ready(2, { active: "fix-mistystaryu", energy: "fix-water-energy" }),
      "fix-abruptflash",
      "active",
    );
    expect(conditionHolds(armed, "p1", STARYU)).toBe(true);
    expect(damageDealt(armed)).toBe(140);
  });

  it("🛑 THE CROSS-CONTROL: each armed board leaves the OTHER card's clause FALSE", () => {
    // 🛑 THIS IS WHAT THE PAIR BUYS THAT NEITHER PRINTING COULD BUY ALONE. An arm
    // that read only the turn stamp and ignored `cond.name` would pass every test
    // either card could write by itself, and fails here: a Gholdengo that evolved
    // this turn must NOT satisfy Misty's Starmie's clause, and the reverse.
    const gold = evolve(
      ready(3, { active: "fix-gimmighoul", energy: "fix-metal-energy" }),
      "fix-strikeitrich",
      "active",
    );
    expect(conditionHolds(gold, "p1", GIMMIGHOUL)).toBe(true);
    expect(conditionHolds(gold, "p1", STARYU)).toBe(false);
    const star = evolve(
      ready(3, { active: "fix-mistystaryu", energy: "fix-water-energy" }),
      "fix-abruptflash",
      "active",
    );
    expect(conditionHolds(star, "p1", STARYU)).toBe(true);
    expect(conditionHolds(star, "p1", GIMMIGHOUL)).toBe(false);
  });

  it("🛑 THE CLOCK: an evolution made on an EARLIER turn stops paying, with no clear", () => {
    // The other half of the arm, and the reason the field is a turn STAMP rather than
    // a flag: the fact expires by arithmetic. Nothing in `startTurn` clears it, so a
    // successor cannot forget to — and this case is what would go red if somebody
    // "simplified" `evolvedTurn === state.turn` to `evolvedTurn !== null`.
    let state = evolve(
      ready(4, { active: "fix-gimmighoul", energy: "fix-metal-energy" }),
      "fix-strikeitrich",
      "active",
    );
    const stamped = activeOf(state, "p1")?.evolvedTurn;
    expect(stamped).toBe(state.turn);
    expect(conditionHolds(state, "p1", GIMMIGHOUL)).toBe(true);
    // …round the table once and ask again. The STAMP is untouched and the ANSWER
    // has changed, which is the difference between an expiring fact and a cleared one.
    for (const seat of ["p1", "p2"] as const) {
      state = mustApply(state, { type: "endTurn", seat }).state;
    }
    expect(activeOf(state, "p1")?.evolvedTurn).toBe(stamped);
    expect(state.turn).not.toBe(stamped);
    expect(conditionHolds(state, "p1", GIMMIGHOUL)).toBe(false);
    expect(damageDealt(state)).toBe(30);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("§4 — the board that REFUTES a per-seat record, driven rather than argued", () => {
  it("🛑 a BENCHED body evolving does NOT arm the Active's clause", () => {
    // 🛑 **THE MEASUREMENT THAT SETTLED THE SHAPE QUESTION.** The compiler tied a
    // per-body field and a per-seat `GameState` record at 1 file / 1 site each, and
    // `evolveOnto` — the single placement — would have written either one just as
    // cheaply. What separates them is the printed SUBJECT, *"this Pokémon"*, and this
    // is the ordinary board on which the two readings disagree:
    //
    //   Active : Misty's Starmie, placed straight into play, NEVER evolved
    //   Bench  : Misty's Staryu, evolved into a Misty's Starmie THIS turn
    //
    // A per-seat record answers *"did this seat evolve something from Misty's Staryu
    // this turn"* → TRUE, and pays the Active a +80 it did not earn. The stamp is on
    // the BODY, so the Active reads its own `evolvedTurn` (null) and collects 60.
    const state = evolve(
      ready(5, {
        active: "fix-abruptflash",
        bench: ["fix-mistystaryu"],
        energy: "fix-water-energy",
      }),
      "fix-abruptflash",
      0,
    );
    // The seat DID evolve, this turn, from exactly the printed card…
    const benched = state.players.p1.bench[0];
    expect(benched?.evolvedTurn).toBe(state.turn);
    expect(state.cardIdByUid[benched?.stack[0] ?? ""]).toBe("fix-mistystaryu");
    // …and the Active did not, so the clause is FALSE and the attack does its base.
    expect(activeOf(state, "p1")?.evolvedTurn).toBeNull();
    expect(conditionHolds(state, "p1", STARYU)).toBe(false);
    expect(damageDealt(state)).toBe(60);
  });

  it("⚠️ TWO bodies evolving in one turn is the case a seat-level TURN cannot express", () => {
    // The second half of the same finding, and the reason a `Record<Seat, number>`
    // (D326's `lastKoTurn` shape) would not have worked either: one turn number per
    // seat cannot say WHICH body it belongs to, and both of these are stamped with
    // the same turn while only one of them is the attacker.
    const state = evolve(
      evolve(
        ready(6, {
          active: "fix-gimmighoul",
          bench: ["fix-mistystaryu"],
          energy: "fix-metal-energy",
        }),
        "fix-strikeitrich",
        "active",
      ),
      "fix-abruptflash",
      0,
    );
    expect(activeOf(state, "p1")?.evolvedTurn).toBe(state.turn);
    expect(state.players.p1.bench[0]?.evolvedTurn).toBe(state.turn);
    // Same turn, same seat, two bodies, two DIFFERENT pre-evolution names — and the
    // Active's is the only one the printed clause is about.
    expect(conditionHolds(state, "p1", GIMMIGHOUL)).toBe(true);
    expect(conditionHolds(state, "p1", STARYU)).toBe(false);
    expect(damageDealt(state)).toBe(120);
  });

  it("⚠️ the stamp is SEAT-BLIND, because `state.turn` is global", () => {
    // D124's second payoff, inherited unchanged and asserted rather than quoted: the
    // stamp needs no seat guard. P2's Active is stamped with P1's turn number by
    // nothing here — it was never evolved — and the assertion that matters is that
    // the comparison is total: `conditionHolds` answers for either seat in any phase.
    const state = evolve(
      ready(7, { active: "fix-gimmighoul", energy: "fix-metal-energy" }),
      "fix-strikeitrich",
      "active",
    );
    expect(conditionHolds(state, "p1", GIMMIGHOUL)).toBe(true);
    expect(conditionHolds(state, "p2", GIMMIGHOUL)).toBe(false);
    expect(activeOf(state, "p2")?.evolvedTurn).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("§5 — the fixtures, the persisted shape, and the premise this slice killed", () => {
  it("the four fixtures carry the printed bytes, chains included", () => {
    const gold = FIXTURE_POOL["fix-strikeitrich"];
    expect(gold?.name).toBe("Gholdengo");
    expect(gold?.stage).toBe("Stage1");
    expect(gold?.evolveFrom).toBe("Gimmighoul");
    expect(gold?.hp).toBe(130);
    expect(gold?.attacks?.[0]?.name).toBe("Strike It Rich");
    expect(gold?.attacks?.[0]?.effect).toBe(GOLD);
    expect(gold?.attacks?.[0]?.damage).toBe("30+");
    // ⚠️ INDEX 1 IS D312's "Surf Back", transcribed whole (D306) and deliberately
    // NOT declared on any board here: it is a REGISTRY row keyed on the real
    // `sv08-131`, so on a `fix-*` id it resolves to nothing and takes the loud
    // `ATTACK_EFFECT_SKIPPED` path. Gholdengo is now the engine's first card with a
    // REGISTRY attack at one index and a DERIVED one at another.
    expect(gold?.attacks?.[1]?.name).toBe("Surf Back");
    const star = FIXTURE_POOL["fix-abruptflash"];
    expect(star?.name).toBe("Misty's Starmie");
    expect(star?.stage).toBe("Stage1");
    expect(star?.evolveFrom).toBe("Misty's Staryu");
    expect(star?.attacks).toHaveLength(1);
    expect(star?.attacks?.[0]?.effect).toBe(STAR);
    // 🛑 THE TWO PRE-EVOLUTION NAMES ARE THE PRINTED BYTES, POSSESSIVE INCLUDED.
    // The arm compares this `name` to the clause key, so a tidy "Staryu" would make
    // the demonstrator match no printed sentence at all — D183's defect, in a name.
    expect(FIXTURE_POOL["fix-gimmighoul"]?.name).toBe("Gimmighoul");
    expect(FIXTURE_POOL["fix-mistystaryu"]?.name).toBe("Misty's Staryu");
    expect(FIXTURE_POOL["fix-mistystaryu"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["fix-gimmighoul"]?.stage).toBe("Basic");
  });

  it("🛑 the key with the APOSTROPHE is U+0027, and the fold reaches it for real", () => {
    // ⚠️ FIVE SLICES OF NEW CLAUSE KEYS LANDED IN THE APOSTROPHE-FREE HALF; THIS ONE
    // SPLITS. `Gimmighoul`'s key bears no apostrophe and `Misty's Staryu`'s bears one,
    // so `literalClauseRow`'s U+2019 → U+0027 fold (D137) reaches a row of this slice
    // for real rather than as standing insurance — asserted against the committed
    // corpus rather than eyeballed, because a key authored with a typographic
    // apostrophe resolves NOTHING, silently (D183's defect in punctuation).
    expect(STAR_CLAUSE.includes("'")).toBe(true);
    expect(STAR_CLAUSE.includes("’")).toBe(false);
    expect(GOLD_CLAUSE.includes("'")).toBe(false);
    expect(corpus().some(([, s]) => s === STAR)).toBe(true);
    // …and the curly spelling of the SAME sentence resolves to the SAME member,
    // which is what the fold is for.
    const curly = STAR.replace("'", "’");
    expect(curly).not.toBe(STAR);
    expect(deriveAttackDamageBonus(curly)?.count).toEqual({
      kind: "boardCondition",
      cond: STARYU,
    });
  });

  it("🛑 `evolvedTurn` is REQUIRED and every in-play body carries it — the 23 → 24 case", () => {
    // The persisted question, asked at the one address a widening argument does NOT
    // reach: a NEW REQUIRED FIELD on a structure inside `MatchRecord.state`. A v23
    // record's bodies carry no `evolvedTurn` at all, so a resumed match would read
    // `undefined === state.turn` FALSE and silently withhold the printed +90 from the
    // player who evolved into the attacker on the very turn the match was interrupted.
    // `MATCH_RECORD_VERSION` is 24 (`apps/api/src/lobby/match.test.ts` holds the tie).
    const state = ready(8, {
      active: "fix-strikeitrich",
      bench: ["fix-gimmighoul", "fix-mistystaryu"],
      energy: "fix-metal-energy",
    });
    const bodies = [
      ...(["p1", "p2"] as const).flatMap((seat) => [
        state.players[seat].active,
        ...state.players[seat].bench,
      ]),
    ];
    expect(bodies.length).toBeGreaterThanOrEqual(4);
    for (const body of bodies) {
      expect(body === null || "evolvedTurn" in body).toBe(true);
      expect(body?.evolvedTurn ?? null).toBeNull();
    }
  });
});
