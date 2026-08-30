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
import type { BoardCondition, GameAction, GameState, PendingStage, Seat } from "./index";
import { applyAction } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  FIXTURE_POOL,
  USED_ATTACK_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setConditions,
} from "./testFixtures";

// 🆕🆕 D394 — THE USED-ATTACK PAIR: TWO PRINTED SENTENCES, ONE MECHANISM, ONE
// FIELD — AND THE FIRST WINDOW IN THIS UNION THAT IS NOT THE TURN IN PROGRESS.
//
// Falinks `sv07-088` "All-Out Attack" ({C}{C}, `30+`, index **1** of TWO):
//   *"If this Pokémon used Form Ranks during your last turn, this attack does
//    90 more damage."* — **1 legal printing**
// Weezing `sv09-092` "Crazy Blast" ({D}{C}, `50+`, index **1** of TWO):
//   *"If this Pokémon used Pervasive Gas during your last turn, this attack does
//    120 more damage."* — **1 legal printing**
//
// 🛑 **THE UNION HALF WAS TRIVIAL AGAIN; THE SLICE WAS *WHOSE CLOCK*, AND THE
// HANDOFF SAID SO.** It attached a falsifiable prediction — a per-body
// `usedAttack: { name; turn } | null` and NOT a per-seat `GameState` record —
// and named the two things most likely to falsify it. §2 and §5 test both
// instead of assuming them.
//
//   · **FALSIFIER (a) DID NOT FIRE.** *"If the attack is recorded anywhere
//     already (grep `finishAttack` for what it writes) the field may be free."*
//     It records NOTHING about which attack was declared: `ATTACK_DECLARED`
//     carries the name as an EVENT and events are not state, and the only
//     attack-addressed records on the body — `lockedAttacks`, `boostedAttack` —
//     are keyed by INDEX and written by the OPPONENT's effects. The field is not
//     free.
//   · **FALSIFIER (b) DID NOT FIRE EITHER, AND IT IS THE ONE THAT WAS MEASURED
//     RATHER THAN READ.** *"If `state.turn` does not advance by exactly 2 between
//     a player's consecutive turns, the whole member needs a different clock and
//     BOTH shapes are wrong."* It advances by exactly 2, INCLUDING across a Knock
//     Out park of either kind — §5 drives both boards rather than citing
//     `turnTail`.
//   · **AND THE COMPILER TIED THE TWO SHAPES FOR THE THIRD CONSECUTIVE SLICE.**
//     Measured under `tsc -b --force` at this head: a REQUIRED `InPlayPokemon`
//     field costs **1 file / 1 site** (`makeInPlay`) and a REQUIRED `GameState`
//     record costs **1 file / 1 site** (`setup.ts`). §4 is the board that decides
//     it, and the printed subject is again the instrument.
//
// 🛑 **THE OTHER HALF OF THE SLICE IS AN ORDERING, AND IT IS WHAT MAKES THE FIELD
// WORK AT ALL.** The bonus clause is read at DECLARATION (attack.ts, D115's
// placement, so an attack cannot bootstrap its own condition). A stamp written
// beside `ATTACK_DECLARED` would overwrite LAST turn's record with THIS turn's
// attack **before** that read, and the printed bonus would never pay on any
// board. The one writer is `finishAttack` — this engine's definition of *"an
// attack was used"*. §6 drives the ordering in both directions.
//
// 🛑 **`MATCH_RECORD_VERSION` 24 → 25**, and it carries TWO required fields:
// `InPlayPokemon.usedAttack` and `PendingStage.attackEpilogue.attack`. §7 states
// the reading a v24 record would get for each.
//
// WHAT SHIPS: **1 new `BoardCondition` member** (`yourActiveUsedAttackLastTurn
// { attack }`), **1 new REQUIRED `InPlayPokemon` field** (`usedAttack`), **1 new
// REQUIRED field on one `PendingStage` member**, **1 predicate helper**
// (`usedAttackOnYourLastTurn`), **2 literal `CONDITIONAL_DAMAGE_CLAUSES` rows**,
// **2 new exhaustive switch arms**, **2 fixtures** and **1 dedicated deck**. ZERO
// edited reader arms, ZERO templates, patterns, maps, vocabulary, card
// predicates, ops, events, error codes, prompt kinds or registry rows; ZERO
// `redact.ts` and ZERO `packages/schema` bytes.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/** The nine live readers, run as one — the same set `censusAtHead.test.ts` and
    `evolvedFromBonus.test.ts` use. */
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
const FALINKS =
  "If this Pokémon used Form Ranks during your last turn, this attack does 90 more damage.";
const FALINKS_CLAUSE = "this Pokémon used Form Ranks during your last turn";
const WEEZING =
  "If this Pokémon used Pervasive Gas during your last turn, this attack does 120 more damage.";
const WEEZING_CLAUSE = "this Pokémon used Pervasive Gas during your last turn";

/** THE THREE PRINTINGS OF THE SAME BOARD FACT THIS SLICE DELIBERATELY DOES NOT
    BUY, quoted here so a successor prices them from a measurement rather than
    rediscovering them. Each is refused by a DIFFERENT part of the machine:
      · ROLLOUT — the same subject and the same window under an ATTACK-GATE
        skeleton ("You can use this attack only if …"), so the bonus pattern never
        sees it. `yourActiveUsedAttackLastTurn { attack: "Rollout" }` would serve
        it UNCHANGED; what it needs is the D281/D282 gate seam, which is derived
        from a `CardProgram.attackGate` today and is a different slice.
      · ANGELITE — the same window and the same field, but the subject is *"1 of
        your Pokémon"* (anywhere in play, not the Active), so it needs a SECOND
        member over the same field, plus a cancel consequent.
      · ANCIENT — the same clock and the same mechanism with a BANNER bolted on,
        refused on D207's ground and NOT on the window. */
const ROLLOUT = "You can use this attack only if this Pokémon used Rollout during your last turn.";
const ANGELITE =
  "Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all attached cards into your opponent's deck. If 1 of your Pokémon used Angelite during your last turn, this attack can't be used.";
const ANCIENT =
  "If 1 of your other Ancient Pokémon used an attack during your last turn, this attack does 150 more damage.";

const FORM_RANKS: BoardCondition = {
  kind: "yourActiveUsedAttackLastTurn",
  attack: "Form Ranks",
};
const PERVASIVE_GAS: BoardCondition = {
  kind: "yourActiveUsedAttackLastTurn",
  attack: "Pervasive Gas",
};

// ── boards ─────────────────────────────────────────────────────────────────────

function step(state: GameState, action: GameAction): GameState {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.code}`);
  return result.state;
}

/** Drain every decision this file's boards can park on, taking the cheapest
    answer each time: decline the deck search, take prize 0, promote bench 0.
    Deliberately TOTAL over the three interrupts rather than asserting a
    particular one — the phases are asserted where they are the subject (§5). */
function drain(state: GameState): GameState {
  let next = state;
  for (let guard = 0; guard < 10; guard += 1) {
    const phase = next.phase;
    if (phase.kind === "effect:choose") {
      next = step(next, {
        type: "resolveEffect",
        seat: phase.seat,
        choice: { kind: "cards", uids: [] },
      });
      continue;
    }
    if (phase.kind === "ko:takePrizes") {
      next = step(next, {
        type: "takePrizes",
        seat: phase.seat,
        prizeIndices: Array.from({ length: phase.count }, (_, index) => index),
      });
      continue;
    }
    if (phase.kind === "ko:promote") {
      next = step(next, { type: "promote", seat: phase.seat, benchIndex: 0 });
      continue;
    }
    return next;
  }
  throw new Error("drain did not settle");
}

/** A board on **P1's FIRST turn of the game that may attack** — P2 goes first and
    passes, so §4's going-first bar never applies and one `endTurn` is the whole
    setup. Both Actives are then arranged from the deck (`setActiveFromDeck`
    DISPLACES rather than replaces, so both benches are emptied afterwards), and
    P1 is given enough Energy for either card's whole two-attack sequence.
    Every body placed this way arrives through `makeInPlay` — **`usedAttack`
    null** — which is exactly the never-attacked state the FALSE cases need. */
function ready(
  seed: number,
  opts: { active: string; defender?: string; defenderBench?: readonly string[] },
): GameState {
  let state = driveSetup(seed, { p1: USED_ATTACK_DECK, p2: USED_ATTACK_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", opts.active);
  state = setActiveFromDeck(state, "p2", opts.defender ?? "fix-titan");
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of opts.defenderBench ?? []) state = benchFromDeck(state, "p2", id);
  state = attachFromDeck(state, "p1", "fix-dark-energy", 3);
  return attachFromDeck(state, "p1", "fix-energy", 3);
}

/** Declare P1's attack at `index`, settle every decision it parks on, and hand
    back BOTH the damage this hit dealt and the resulting board.

    ⚠️ `dealt` AND NOT `damage`: the event's `damage` is the defending body's
    RUNNING total, and every board in this file lands two hits on one defender
    (the named attack, then the bonus attack two turns later). Reading `damage`
    would silently add the first hit to the second and make every number here
    look 30 too big — which is exactly what it did on the first draft. */
function attack(state: GameState, index: number): { dealt: number; state: GameState } {
  const after = mustApply(state, { type: "attack", seat: "p1", index });
  const row = after.events.find((event) => event.type === "DAMAGE_DEALT") as
    | { dealt?: number }
    | undefined;
  return { dealt: row?.dealt ?? 0, state: drain(after.state) };
}

/** Hand the turn back to P1 from the board `attack` left behind (P1's attack
    already ended P1's turn, so this is P2's pass and nothing else). */
function backToP1(state: GameState): GameState {
  return drain(mustApply(state, { type: "endTurn", seat: "p2" }).state);
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
      [FALINKS, FALINKS_CLAUSE, "90"],
      [WEEZING, WEEZING_CLAUSE, "120"],
    ] as const) {
      expect(corpus().filter(([, s]) => s === sentence)).toHaveLength(1);
      expect(units(corpus().filter(([, s]) => s === sentence))).toBe(1);
      // Both were refused at the CLAUSE, not at the skeleton: the bonus pattern
      // always matched and always captured the printed amount.
      expect(BONUS.test(sentence)).toBe(true);
      expect(BONUS.exec(sentence)?.[1]).toBe(clause);
      expect(BONUS.exec(sentence)?.[2]).toBe(amount);
    }
    // 🛑 THE PAIR IS THE PRICE. Two sentences, one printing each, two DIFFERENT
    // printed amounts — so the amount lives in the outer skeleton and the clauses
    // differ only in the ATTACK they name. A slice that bought one of them would
    // have bought the same field, the same stage widening and the same
    // `MATCH_RECORD_VERSION` bump for half the printings.
    const pair = corpus().filter(([, s]) => s === FALINKS || s === WEEZING);
    expect(pair).toHaveLength(2);
    expect(units(pair)).toBe(2);
    expect(new Set(pair.map(([, s]) => BONUS.exec(s)?.[2]))).toEqual(new Set(["90", "120"]));
  });

  it("🛑 the FIELD is worth 6 printings across FOUR sentences — and 4 of them stay unbought", () => {
    // 🛑 **THE MEASUREMENT THE HANDOFF DID NOT HAVE, AND IT RE-PRICES THIS ADDRESS
    // UPWARD.** The clock this slice builds is printed on FIVE sentences, and the
    // per-body `usedAttack` field answers FOUR of them. Only the two with a bonus
    // consequent AND the "this Pokémon" subject are bought here.
    const family = corpus().filter(([, s]) => s.includes("during your last turn"));
    expect(family).toHaveLength(5);
    expect(units(family)).toBe(7);
    expect(new Set(family.map(([, s]) => s))).toEqual(
      new Set([FALINKS, WEEZING, ROLLOUT, ANGELITE, ANCIENT]),
    );
    // …and the three that are NOT bought stay unresolved by every reader, which is
    // what says this slice did not quietly widen one of them (D207's practice:
    // record the refusal as a measurement).
    for (const sentence of [ROLLOUT, ANGELITE, ANCIENT]) {
      expect(resolvedByAnyReader(sentence), sentence).toBe(false);
    }
    // ⚠️ AND THEY ARE REFUSED IN TWO DIFFERENT PLACES, which is the distinction the
    // `needs` column turns on. ROLLOUT and ANGELITE never reach the clause table at
    // all — their SKELETON is not the bonus one — while ANCIENT matches the skeleton
    // exactly and is refused at the CLAUSE, which is why it is the one of the three
    // that sits in the bonus residue below.
    expect(BONUS.test(ROLLOUT.trim())).toBe(false);
    expect(BONUS.test(ANGELITE.trim())).toBe(false);
    expect(BONUS.test(ANCIENT.trim())).toBe(true);
    expect(BONUS.exec(ANCIENT.trim())?.[1]).toBe(
      "1 of your other Ancient Pokémon used an attack during your last turn",
    );
    // ROLLOUT is the sharpest of the three: SAME subject, SAME window, SAME field —
    // refused only by its skeleton, so the member serves it the day a gate seam
    // reads it. ANGELITE is 3 printings on one row and needs a second MEMBER (its
    // subject is "1 of your Pokémon", anywhere in play). ANCIENT is refused at the
    // BANNER and not at the window, which is where this family actually stops.
    expect(units(corpus().filter(([, s]) => s === ROLLOUT))).toBe(1);
    expect(units(corpus().filter(([, s]) => s === ANGELITE))).toBe(3);
    expect(units(corpus().filter(([, s]) => s === ANCIENT))).toBe(1);
  });

  it("🛑 the residue steps by exactly TWO sentences and TWO printings", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    // The DEPARTURE and the SIZE are asserted separately: a guard that only checked
    // 9 / 12 could not tell "the two rows landed" from "a reader broke".
    expect(refused.some(([, s]) => s === FALINKS)).toBe(false);
    expect(refused.some(([, s]) => s === WEEZING)).toBe(false);
    expect(resolvedByAnyReader(FALINKS)).toBe(true);
    expect(resolvedByAnyReader(WEEZING)).toBe(true);
    // D393 left the residue at 11 / 14, re-derived here off the live readers.
    expect([refused.length, units(refused)]).toEqual([5, 5]); // 🆕🆕 D436 -2 sentences / -5 printings (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D398 — the DECK-SIZE READ took the LAST BUILDABLE sentence out (Rabsca `sv08-014` "Counterturn", 1 printing), so 8 / 11 -> 7 / 10 and the residue is now EXHAUSTED of buildable rows: FIVE D207 banners and D368's 5-printing SHAPE refusal are all that is left, and this figure can only move again if a refusal's REASON expires
    expect([refused.length + 6, units(refused) + 9]).toEqual([11, 14]); // 🆕🆕 D398 — 1 sentence / 1 printing out (THE DECK-SIZE READ)
    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    // `{1: 9, 5: 1}` → `{1: 7, 5: 1}`: TWO singletons left the singleton band and
    // nothing else moved. The only clause above one printing is still the 5-printing
    // declaration clause D368 disqualified on SHAPE, so this rung goes red from the
    // other side too — a reader narrowing until some clause returns to 2 fails it.
    expect(byClause.size).toBe(5); // 🆕🆕 D436 -1 clause: the 5-printing DECLARATION clause LEAVES this residue, and the 5 remaining are the D207 banners (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D398 — the DECK-SIZE READ took ONE more singleton out, a 1:1 step, and it was the LAST BUILDABLE one // 🆕🆕 D397 — the BENCHED-CUBONE FILTER took ONE more singleton out, back to a 1:1 step
    expect([...byClause.values()].filter((n) => n === 1)).toHaveLength(5); // 🆕🆕 D398 — the DECK-SIZE READ left the singleton band, 6 -> 5 // 🆕🆕 D397 — the BENCHED-CUBONE FILTER took ONE more singleton out, back to a 1:1 step
    expect([...byClause.values()].filter((n) => n === 5)).toHaveLength(0);// 🆕🆕 D436 the 5-printing band EMPTIES with the declaration clause (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.)
    expect([...byClause.values()].filter((n) => n === 2)).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("§2 — the SHAPE questions, measured on the running code rather than argued", () => {
  it("🛑 ONE member serves BOTH printings — the pair shares a `kind` and differs in `attack`", () => {
    expect(deriveAttackDamageBonus(FALINKS)).toEqual({
      per: 90,
      count: { kind: "boardCondition", cond: FORM_RANKS },
    });
    expect(deriveAttackDamageBonus(WEEZING)).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: PERVASIVE_GAS },
    });
    expect(FORM_RANKS.kind).toBe(PERVASIVE_GAS.kind);
  });

  it("🛑 the payload field is `attack` and NOT `name` — D392's rule, applied to a NEIGHBOUR", () => {
    // 🛑 **THE ASSERTION THAT KEEPS TWO STRINGS APART.** The member directly above
    // this one in the union carries `name: string` and it is a POKÉMON name
    // (`yourActiveEvolvedFromThisTurn`); this one is an ATTACK name. Nothing in the
    // type system separates two `string`s, so the IDENTIFIER is the whole guard —
    // which is exactly why D392 named its own substring field `fragment` rather
    // than `name`. This rung goes red on a rename in either direction.
    expect(Object.keys(FORM_RANKS).sort()).toEqual(["attack", "kind"]);
    expect("name" in FORM_RANKS).toBe(false);
    const neighbour: BoardCondition = {
      kind: "yourActiveEvolvedFromThisTurn",
      name: "Gimmighoul",
    };
    expect(Object.keys(neighbour).sort()).toEqual(["kind", "name"]);
  });

  it("🛑 the note takes a SLOT, not a second SENTENCE — and round-trips to BOTH keys", () => {
    // D393's ONE-ARM-ONE-SLOT reading: the two printings differ in a token the note
    // interpolates, so `conditionNote` gains ONE arm with ONE slot. The slot is then
    // load-bearing enough to be worth its own mutant — one arm now renders two
    // clauses, and an arm that dropped the token would render the same pill for
    // Falinks and for Weezing.
    expect(conditionNote(FORM_RANKS)).toBe(
      "your Active Pokémon used Form Ranks during your last turn",
    );
    expect(conditionNote(PERVASIVE_GAS)).toBe(
      "your Active Pokémon used Pervasive Gas during your last turn",
    );
    // …and the note differs from its `CONDITIONAL_DAMAGE_CLAUSES` key by exactly the
    // resolved pronoun (D116) and nothing else, in BOTH directions. The possessive
    // "your last turn" is KEPT, for `yourPokemonKoedOnOpponentsLastTurn`'s reason.
    expect(conditionNote(FORM_RANKS).replace("your Active Pokémon", "this Pokémon")).toBe(
      FALINKS_CLAUSE,
    );
    expect(conditionNote(PERVASIVE_GAS).replace("your Active Pokémon", "this Pokémon")).toBe(
      WEEZING_CLAUSE,
    );
    // The round trip through the table, at the PRINTED clause rather than the note.
    expect(
      deriveAttackDamageBonus(`If ${FALINKS_CLAUSE}, this attack does 90 more damage.`)?.count,
    ).toEqual({ kind: "boardCondition", cond: FORM_RANKS });
    expect(
      deriveAttackDamageBonus(`If ${WEEZING_CLAUSE}, this attack does 120 more damage.`)?.count,
    ).toEqual({ kind: "boardCondition", cond: PERVASIVE_GAS });
  });

  it("🛑 TWO LITERAL ROWS AND NO SIXTH TEMPLATE — an unprinted attack resolves to NOTHING", () => {
    // 🛑 THE ASSERTION THAT SAYS "ROW, NOT PATTERN", and this token makes the case
    // sharper than D393's. A template `^this Pokémon used (.+) during your last
    // turn$` would capture an ATTACK name, which is open-ended AND is never checked
    // against the card — so *"used Surf Back during your last turn"* would resolve
    // to a predicate that answers FALSE forever and SILENTLY, on a body that CAN
    // use Surf Back. Under two rows it lands on the loud unresolved path instead.
    for (const name of ["Surf Back", "Rollout", "form ranks", "Form Rank", "Pervasive gas"]) {
      const invented = `If this Pokémon used ${name} during your last turn, this attack does 90 more damage.`;
      expect(resolvedByAnyReader(invented), name).toBe(false);
    }
    // ⚠️ "Rollout" is the near miss that matters most: it is a REAL printed attack
    // name in this very family (see §1), and it still resolves to nothing here,
    // because its own printing carries a different skeleton and this table is keyed
    // on whole clauses rather than on the token inside them.
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("§3 — the two printed cards, on boards, at the printed numbers", () => {
  it("🛑 Falinks: 30 with no history, 120 the turn after Form Ranks", () => {
    // FALSE — nothing has attacked yet, so `usedAttack` is null and the printed base
    // stands alone. This is the case that goes red if the arm ever answers TRUE off
    // a null record.
    const flat = ready(1, { active: "fix-alloutattack" });
    expect(conditionHolds(flat, "p1", FORM_RANKS)).toBe(false);
    expect(attack(flat, 1).dealt).toBe(30);
    // TRUE — spend a whole turn on "Form Ranks" (index 0, which deals NOTHING at
    // all), hand the turn over, and come back: 30 + 90.
    const armed = backToP1(attack(ready(1, { active: "fix-alloutattack" }), 0).state);
    expect(conditionHolds(armed, "p1", FORM_RANKS)).toBe(true);
    expect(attack(armed, 1).dealt).toBe(120);
  });

  it("🛑 Weezing: 50 with no history, 170 the turn after Pervasive Gas", () => {
    const flat = ready(2, { active: "fix-crazyblast" });
    expect(conditionHolds(flat, "p1", PERVASIVE_GAS)).toBe(false);
    expect(attack(flat, 1).dealt).toBe(50);
    const armed = backToP1(attack(ready(2, { active: "fix-crazyblast" }), 0).state);
    expect(conditionHolds(armed, "p1", PERVASIVE_GAS)).toBe(true);
    expect(attack(armed, 1).dealt).toBe(170);
  });

  it("🛑 THE CROSS-CONTROL: each armed board leaves the OTHER card's clause FALSE", () => {
    // 🛑 THIS IS WHAT THE PAIR BUYS THAT NEITHER PRINTING COULD BUY ALONE. An arm
    // that read only the turn stamp and ignored `cond.attack` would pass every test
    // either card could write by itself, and fails here: a Falinks that used Form
    // Ranks must NOT satisfy Weezing's clause, and the reverse.
    const falinks = backToP1(attack(ready(3, { active: "fix-alloutattack" }), 0).state);
    expect(conditionHolds(falinks, "p1", FORM_RANKS)).toBe(true);
    expect(conditionHolds(falinks, "p1", PERVASIVE_GAS)).toBe(false);
    const weezing = backToP1(attack(ready(3, { active: "fix-crazyblast" }), 0).state);
    expect(conditionHolds(weezing, "p1", PERVASIVE_GAS)).toBe(true);
    expect(conditionHolds(weezing, "p1", FORM_RANKS)).toBe(false);
  });

  it("🛑 THE CLOCK: the stamp stops paying two turns later, with no clear", () => {
    // The other half of the arm, and the reason the field is a turn STAMP rather
    // than a flag: the fact expires by arithmetic. Nothing in `startTurn` clears it,
    // so a successor cannot forget to — and this case is what would go red if
    // somebody "simplified" `turn === state.turn - 2` to `usedAttack !== null`.
    let state = backToP1(attack(ready(4, { active: "fix-crazyblast" }), 0).state);
    const stamped = activeOf(state, "p1")?.usedAttack;
    expect(stamped).toEqual({ name: "Pervasive Gas", turn: state.turn - 2 });
    expect(conditionHolds(state, "p1", PERVASIVE_GAS)).toBe(true);
    // …round the table once more and ask again. The STAMP is untouched and the
    // ANSWER has changed, which is the difference between an expiring fact and a
    // cleared one.
    for (const seat of ["p1", "p2"] as const) {
      state = drain(mustApply(state, { type: "endTurn", seat }).state);
    }
    expect(activeOf(state, "p1")?.usedAttack).toEqual(stamped);
    expect(conditionHolds(state, "p1", PERVASIVE_GAS)).toBe(false);
    expect(attack(state, 1).dealt).toBe(50);
  });

  it("⚠️ the stamp is SEAT-BLIND, and OFF-TURN it is FALSE by PARITY rather than by a guard", () => {
    // `state.turn` is global and the record is on the body, so the arm needs no seat
    // operand at all — and the property that replaces one is arithmetic: `- 2` keeps
    // the CURRENT turn's parity, and a body is only ever stamped on turns its own
    // controller held. So the far seat gets an honest FALSE rather than a borrowed
    // TRUE, which is `yourFirstTurn`'s guarantee arrived at a third way.
    const armed = backToP1(attack(ready(5, { active: "fix-crazyblast" }), 0).state);
    expect(conditionHolds(armed, "p1", PERVASIVE_GAS)).toBe(true);
    expect(conditionHolds(armed, "p2", PERVASIVE_GAS)).toBe(false);
    expect(activeOf(armed, "p2")?.usedAttack).toBeNull();
    // …and asked DURING P2's turn, when `state.turn - 2` names a turn P1 never held,
    // P1's own true fact reads FALSE. Recorded as the arm's honest limit rather than
    // hidden: nothing printed asks this member off-turn.
    const offTurn = drain(mustApply(armed, { type: "endTurn", seat: "p1" }).state);
    expect(offTurn.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
    expect(activeOf(offTurn, "p1")?.usedAttack).toEqual({
      name: "Pervasive Gas",
      turn: offTurn.turn - 3,
    });
    expect(conditionHolds(offTurn, "p1", PERVASIVE_GAS)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("§4 — the board that REFUTES a per-seat record, driven rather than argued", () => {
  it("🛑 a SECOND Weezing does not inherit the first one's attack history", () => {
    // 🛑 **THE MEASUREMENT THAT SETTLED THE SHAPE QUESTION**, and this row is the one
    // place in the residue where a per-seat record had real precedent: `lastKoTurn`
    // (D271/D326) answers the other closed-window question exactly that way, and the
    // compiler prices the two shapes identically (1 file / 1 site each). What
    // separates them is the printed SUBJECT, *"this Pokémon"*, and this is the
    // ordinary board on which the two readings disagree:
    //
    //   turn N   : Weezing A is Active and uses "Pervasive Gas"
    //   turn N+2 : a SECOND Weezing takes the Active Spot; A stands on the Bench
    //
    // A per-seat record answers *"did this SEAT use Pervasive Gas last turn"* → TRUE
    // and pays +120 to a body that has never attacked in its life.
    const used = backToP1(attack(ready(6, { active: "fix-crazyblast" }), 0).state);
    const swapped = attachFromDeck(
      attachFromDeck(setActiveFromDeck(used, "p1", "fix-crazyblast"), "p1", "fix-dark-energy", 3),
      "p1",
      "fix-energy",
      3,
    );
    // The SEAT did use Pervasive Gas, on its last turn, and the body that did it is
    // still in play carrying the proof…
    expect(swapped.players.p1.bench.at(-1)?.usedAttack).toEqual({
      name: "Pervasive Gas",
      turn: swapped.turn - 2,
    });
    // …and the Active did not, so the clause is FALSE and the attack does its base.
    expect(activeOf(swapped, "p1")?.usedAttack).toBeNull();
    expect(conditionHolds(swapped, "p1", PERVASIVE_GAS)).toBe(false);
    expect(attack(swapped, 1).dealt).toBe(50);
  });

  it("⚠️ the stamp SURVIVES the zone move, which a per-seat record could not express", () => {
    // The other half of the same finding, and the reason the record has to live on
    // the BODY rather than on the spot: the attacker that used the named attack is
    // now on the BENCH, still carrying its own history, while the Active carries
    // none. One turn number per seat cannot say which of the two it belongs to —
    // and unlike D393's stamp this one is READ on a later turn than it is written,
    // so surviving a zone move is not a bonus property but the whole requirement.
    const used = backToP1(attack(ready(7, { active: "fix-crazyblast" }), 0).state);
    const benched = setActiveFromDeck(used, "p1", "fix-titan").players.p1.bench.at(-1);
    expect(benched?.usedAttack).toEqual({ name: "Pervasive Gas", turn: used.turn - 2 });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("§5 — THE CLOCK, MEASURED ACROSS A KNOCK OUT PARK", () => {
  it("🛑 an ATTACK-epilogue KO holds the counter at the ending turn — and Δ is still 2", () => {
    // 🛑 **THE MEASUREMENT THE HANDOFF DEMANDED, AND THE ONE THAT MAKES `- 2` A FACT
    // RATHER THAN A GUESS.** `state.turn` is a GLOBAL counter, so "your last turn"
    // is two counter steps back **only if nothing inserts or skips a step**. A Knock
    // Out is the interrupt that could: it parks the tail on a player decision for an
    // unbounded time. So build it.
    const board = ready(8, {
      active: "fix-crazyblast",
      defender: "fix-victim", // 30 HP — "Pervasive Gas"'s printed 30 is exactly lethal
      defenderBench: ["fix-titan"],
    });
    const declaredAt = board.turn;
    const parked = step(board, { type: "attack", seat: "p1", index: 0 });
    // The park is REAL and it is where the printed KO sequence puts it: the prize and
    // promotion stages sit in FRONT of the turn tail, so `startTurn` has not run.
    expect(parked.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p1" });
    expect(parked.pending.map((stage: PendingStage) => stage.kind)).toEqual([
      "takePrizes",
      "promote",
      "endTurn",
      "checkup",
      "startTurn",
    ]);
    // 🛑 AND THE COUNTER HAS NOT MOVED: the whole interrupt happens INSIDE the
    // attacking turn, which is why the stamp `finishAttack` wrote is the right one.
    expect(parked.turn).toBe(declaredAt);
    const settled = drain(parked);
    expect(activeOf(settled, "p1")?.usedAttack).toEqual({
      name: "Pervasive Gas",
      turn: declaredAt,
    });
    // …and P1's next turn is exactly TWO counter steps on, KO and all.
    const next = backToP1(settled);
    expect(next.turn).toBe(declaredAt + 2);
    expect(conditionHolds(next, "p1", PERVASIVE_GAS)).toBe(true);
    expect(attack(next, 1).dealt).toBe(170);
  });

  it("🛑 a CHECKUP KO parks BETWEEN the turns and does not insert a step either", () => {
    // The second park shape, and the one that sits in a genuinely different place:
    // a Checkup Knock Out happens after `endTurn` and before `startTurn`, so its
    // stages are spliced in front of a tail that has ONE `startTurn` left rather
    // than three stages. If any park could make `- 2` wrong, it would be this one.
    const used = attack(ready(9, { active: "fix-crazyblast", defenderBench: ["fix-titan"] }), 0);
    const declaredAt = used.state.turn - 1;
    // Poison the far seat lethally, then end P2's turn: the Checkup tick KOs.
    const poisoned = setConditions(used.state, "p2", { poisonDamage: 400 });
    const parked = mustApply(poisoned, { type: "endTurn", seat: "p2" }).state;
    expect(parked.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p1" });
    expect(parked.pending.map((stage: PendingStage) => stage.kind)).toEqual([
      "takePrizes",
      "promote",
      "startTurn",
    ]);
    // The counter is still on the ENDING turn while the park is open…
    expect(parked.turn).toBe(declaredAt + 1);
    // …and one `startTurn` later P1 is back, exactly two steps from where it attacked.
    const next = drain(parked);
    expect(next.turn).toBe(declaredAt + 2);
    expect(next.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
    expect(conditionHolds(next, "p1", PERVASIVE_GAS)).toBe(true);
    expect(attack(next, 1).dealt).toBe(170);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("§6 — the WRITE SITE: the read is at the front of the declaration, the write at the back", () => {
  it("🛑 this attack does NOT clobber its own antecedent — the bonus pays AND the stamp moves", () => {
    // 🛑 **THE ORDERING THAT IS THE SLICE, DRIVEN IN ONE CASE.** A stamp written
    // beside `ATTACK_DECLARED` would overwrite `{Pervasive Gas, N}` with
    // `{Crazy Blast, N+2}` BEFORE `scaledAttackDamage` reads the clause, and the
    // printed +120 would never land on any board in this file. Both halves are
    // asserted together, because either alone is satisfiable by a build that is
    // wrong in the other direction: the bonus lands, AND the record has moved on.
    const armed = backToP1(attack(ready(10, { active: "fix-crazyblast" }), 0).state);
    expect(activeOf(armed, "p1")?.usedAttack).toEqual({
      name: "Pervasive Gas",
      turn: armed.turn - 2,
    });
    const after = attack(armed, 1);
    expect(after.dealt).toBe(170);
    expect(activeOf(after.state, "p1")?.usedAttack).toEqual({
      name: "Crazy Blast",
      turn: armed.turn,
    });
  });

  it("🛑 a PARKED attack still stamps, and the stage is what carries the name across the park", () => {
    // 🛑 **THE ROUTE THE `PendingStage` FIELD EXISTS FOR.** Falinks's index 0 is a
    // deck search, so declaring it PARKS on `effect:choose` with the epilogue queued
    // behind — and `declared.name` is out of scope by the time that stage drains.
    // The stage carries it, so the body is stamped with the printed name and not
    // with `undefined`.
    const board = ready(11, { active: "fix-alloutattack" });
    const parked = step(board, { type: "attack", seat: "p1", index: 0 });
    expect(parked.phase.kind).toBe("effect:choose");
    expect(parked.pending).toEqual([
      { kind: "attackEpilogue", seat: "p1", uid: parked.players.p1.active?.stack.at(-1), attack: "Form Ranks" },
    ]);
    // Nothing is stamped WHILE it is parked — the write is in `finishAttack`, which
    // the epilogue stage has not reached yet.
    expect(activeOf(parked, "p1")?.usedAttack).toBeNull();
    const settled = drain(parked);
    expect(activeOf(settled, "p1")?.usedAttack).toEqual({
      name: "Form Ranks",
      turn: board.turn,
    });
  });

  it("⚠️ `finishAttack` is the definition of USED — a cancelled attack still counts", () => {
    // The placement argument, driven on the one board this file can reach cheaply:
    // Weezing's index 0 has an effect program that resolves inline, and the turn ends
    // through the same tail whatever happened inside it. The claim being pinned is
    // that the stamp is written on EVERY exit out of `attack.ts` rather than only on
    // the damage-dealing one — which is the reading attack.ts already states in as
    // many words for the D125 requirement gate ("a cancelled attack is an attack that
    // was USED"). A build that stamped beside `DAMAGE_DEALT` instead would leave
    // Falinks's "Form Ranks" — which deals NO damage at all and emits no such row —
    // permanently unrecorded, and the whole card unbuildable.
    const board = ready(12, { active: "fix-alloutattack" });
    const after = attack(board, 0);
    expect(activeOf(after.state, "p1")?.usedAttack).toEqual({
      name: "Form Ranks",
      turn: board.turn,
    });
    expect(after.dealt).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("§7 — the fixtures and the persisted shape", () => {
  it("the two fixtures carry the printed bytes, BOTH attacks and their indexes", () => {
    const falinks = FIXTURE_POOL["fix-alloutattack"];
    expect(falinks?.name).toBe("Falinks");
    expect(falinks?.stage).toBe("Basic");
    expect(falinks?.hp).toBe(110);
    expect(falinks?.attacks).toHaveLength(2);
    // 🛑 THE INDEXES ARE THE POINT: the clause is on index 1 and names index 0.
    expect(falinks?.attacks?.[0]?.name).toBe("Form Ranks");
    expect(falinks?.attacks?.[0]?.damage).toBeUndefined();
    expect(falinks?.attacks?.[1]?.name).toBe("All-Out Attack");
    expect(falinks?.attacks?.[1]?.damage).toBe("30+");
    expect(falinks?.attacks?.[1]?.effect).toBe(FALINKS);
    const weezing = FIXTURE_POOL["fix-crazyblast"];
    expect(weezing?.name).toBe("Weezing");
    expect(weezing?.stage).toBe("Stage1");
    expect(weezing?.evolveFrom).toBe("Koffing");
    expect(weezing?.hp).toBe(130);
    expect(weezing?.attacks?.[0]?.name).toBe("Pervasive Gas");
    expect(weezing?.attacks?.[0]?.damage).toBe(30);
    expect(weezing?.attacks?.[1]?.name).toBe("Crazy Blast");
    expect(weezing?.attacks?.[1]?.damage).toBe("50+");
    expect(weezing?.attacks?.[1]?.effect).toBe(WEEZING);
    // 🛑 THE NAMED ATTACK'S PRINTED NAME IS THE CLAUSE KEY'S TOKEN, BYTE FOR BYTE.
    // The arm compares the two, so a tidy "Form Rank" on either side would make the
    // demonstrator match no printed sentence at all — D183's defect, in an attack
    // name. Asserted in BOTH directions rather than eyeballed.
    expect(FALINKS_CLAUSE).toContain(falinks?.attacks?.[0]?.name ?? "");
    expect(WEEZING_CLAUSE).toContain(weezing?.attacks?.[0]?.name ?? "");
    expect(FORM_RANKS.kind === "yourActiveUsedAttackLastTurn" && FORM_RANKS.attack).toBe(
      falinks?.attacks?.[0]?.name,
    );
    expect(PERVASIVE_GAS.kind === "yourActiveUsedAttackLastTurn" && PERVASIVE_GAS.attack).toBe(
      weezing?.attacks?.[0]?.name,
    );
  });

  it("🛑 `usedAttack` is REQUIRED and every in-play body carries it — half of the 24 → 25 case", () => {
    // The persisted question at the address a widening argument does NOT reach: a
    // NEW REQUIRED FIELD on a structure inside `MatchRecord.state`. A v24 record's
    // bodies carry no `usedAttack` at all, so a resumed match reads the clause FALSE
    // forever and the printed bonus silently stops existing.
    // `MATCH_RECORD_VERSION` is 25 (`apps/api/src/lobby/match.test.ts` holds the tie).
    const state = ready(13, { active: "fix-crazyblast", defenderBench: ["fix-titan"] });
    const bodies = (["p1", "p2"] as const).flatMap((seat) => [
      state.players[seat].active,
      ...state.players[seat].bench,
    ]);
    expect(bodies.length).toBeGreaterThanOrEqual(3);
    for (const body of bodies) {
      expect(body === null || "usedAttack" in body).toBe(true);
      expect(body?.usedAttack ?? null).toBeNull();
    }
  });

  it("🛑 the `attackEpilogue` stage's `attack` is REQUIRED — the OTHER half of 24 → 25", () => {
    // The half a `MatchRecord` gate is really for: a v24 record saved PARKED
    // mid-attack carries an epilogue stage with no `attack` key at all, and draining
    // it would stamp the attacking body with `undefined` as an attack name while the
    // record went on looking healthy. The key is present on every such stage this
    // build writes, and it is the PRINTED name.
    const parked = step(ready(14, { active: "fix-alloutattack" }), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    const epilogue = parked.pending.find(
      (stage: PendingStage) => stage.kind === "attackEpilogue",
    );
    expect(epilogue).toBeDefined();
    expect(epilogue && "attack" in epilogue && epilogue.attack).toBe("Form Ranks");
  });
});
