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
  splitAttackGateClause,
  splitAttackRequirementClause,
} from "./effects";
import type { GameState } from "./index";
import { conditionNote } from "./interpreter";
import {
  FIXTURE_POOL,
  SAWK_SPLIT_DECK,
  attachFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// D363 — THE `$` WAS THE WRONG ANCHOR TO PRICE.
//
// 🛑 THE MEASUREMENT THAT CHOSE THIS ROW, AND IT IS A CORRECTION RATHER THAN AN
// INHERITANCE. D362 measured this widening at *"9 sentences / 27 printings of
// unrelated surface"* and refused it on that price, leaving the work unspent. Its
// COUNTS reproduce here to the printing (§1 re-derives them live); its
// ATTRIBUTION does not. `/^If (.+), this attack does nothing\.$/` has TWO anchors
// and they refuse DIFFERENT sentences:
//
//   • the `$` alone — a LEADING does-nothing sentence with a trailing companion:
//     **1 sentence / 2 printings** (Sawk `sv10.5w-049`/`-130`);
//   • the `^` alone — a LEADING companion, the does-nothing sentence last:
//     7 sentences / 23 printings ("Flip a coin. …", "Discard …. ", "Before doing
//     damage, …. ", "Switch in …. ");
//   • BOTH: 1 sentence / 2 printings.
//
// Confirmed pool-wide on the remote D1 (`luminous`, `$.effect`, 2026-08-18):
// `GLOB 'If *, this attack does nothing.*'` minus `GLOB 'If *, this attack does
// nothing.'` is **2 rows in 978 cards / 6 sets**, both Sawk, both `legal_standard = 1`.
// **A `$` WIDENING BUYS TWO PRINTINGS, NOT TWENTY-SEVEN.** §1 asserts the whole
// partition so the correction is a measurement in this file rather than a
// paragraph in another.
//
// 🛑 THE `^` IS UNTOUCHED AND MUST STAY UNTOUCHED. Sixteen of the 23 printings
// behind it are "Flip a coin. If tails, this attack does nothing.", which
// `deriveAttackCoinFlip` ALREADY resolves — reaching them from this reader would
// flip one attack twice. §2 asserts that in both directions.
//
// 🛑 AND THE WIDENING DOES NOT SHIP ALONE, BECAUSE A WIDENED ANCHOR WITH NOTHING
// BEHIND IT IS THE D278/D279 BUILD. Sawk prints TWO rules. Without an accounting
// seam the requirement alone would set `effectSimulated` and SILENCE a printed
// "isn't affected by Weakness or Resistance" the engine was not applying — half a
// sentence claimed, which is the exact failure this family has refused twice. So
// the anchor moves WITH `splitAttackRequirementClause` (D282's shape, D282's one
// safety property: it refuses to strip a clause the table does not carry) and
// with `effectSimulated`'s requirement term gated on "no split fired". §4 and §5
// drive both, on boards, in both directions.

/** Sawk `sv10.5w-049`/`-130` "Rising Chop" ({F}, 90 — D364 re-read the cost off
    `attacks_json`: it is ONE Fighting, not `{F}{C}`; the `fix-sawk` FIXTURE costs
    `{F}{C}` and that is a fixture choice, not the printing), as PRINTED. */
const SAWK =
  "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing. This attack's damage isn't affected by Weakness or Resistance.";
/** The leading sentence alone — anchor-admissible before D363 and after it. */
const SAWK_HEAD =
  "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing.";
/** The trailing sentence alone — `deriveAttackDamageSuppression`'s since D192. */
const SAWK_TAIL = "This attack's damage isn't affected by Weakness or Resistance.";
/** Palafin `sv03-062`/`-200`, the row that already read — §2's CONTROL. */
const PALAFIN =
  "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.";

const READERS: readonly ((t: string) => unknown)[] = [
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
const readByAny = (s: string): boolean => READERS.some((r) => r(s) !== null);
const p = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [units]) => sum + units, 0);

/** The OLD anchor, spelled out so the correction is driven rather than recalled.
    ⚠️ It is a COPY and it is labelled one: `ATTACK_DOES_NOTHING` is module-private,
    so this is the only way to compare the two reaches in one expression. §1 ties
    the copy to the live reader on both sides, which is what stops it rotting. */
const OLD_ANCHOR = /^If (.+), this attack does nothing\.$/;
/** The NEW anchor, same caveat. */
const NEW_ANCHOR = /^If (.+?), this attack does nothing\.(?: (.+))?$/;

/** Setup, then open P1's turn 2 (P2 went first and passed). */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: SAWK_SPLIT_DECK, p2: SAWK_SPLIT_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields Sawk with {F}{C} attached; P2 fields `defender` on a clear Bench. */
function ready(seed: number, defender: string): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-sawk");
  state = attachFromDeck(state, "p1", "fix-fighting-energy", 1);
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", defender);
  return clearBench(state, "p2");
}

describe("§1 — D362's counts reproduce and its ATTRIBUTION does not", () => {
  it("re-derives 17 s / 43 p, 8 s / 16 p admissible, 9 s / 27 p refused under the OLD anchor", () => {
    const nothing = legalAttackCorpus().filter(([, s]) => /this attack does nothing\./.test(s));
    const admissible = nothing.filter(([, s]) => OLD_ANCHOR.test(s.trim()));
    const refused = nothing.filter(([, s]) => !OLD_ANCHOR.test(s.trim()));
    expect(nothing).toHaveLength(17);
    expect(p(nothing)).toBe(43);
    expect(admissible).toHaveLength(8);
    expect(p(admissible)).toBe(16);
    expect(refused).toHaveLength(9);
    expect(p(refused)).toBe(27);
    // The parts must add up in both units, in the same case that quotes them.
    expect(admissible.length + refused.length).toBe(nothing.length);
    expect(p(admissible) + p(refused)).toBe(p(nothing));
  });

  it("🛑 partitions the 9 refused BY WHICH ANCHOR — 1/2 behind `$`, 7/23 behind `^`, 1/2 behind both", () => {
    // THE CORRECTION, as an addition that can fail. `$`-only means the sentence
    // OPENS with the does-nothing clause; `^`-only means it ENDS with it.
    const HEAD_ONLY = /^If (.+), this attack does nothing\./;
    const TAIL_ONLY = /If (.+), this attack does nothing\.$/;
    const refused = legalAttackCorpus()
      .filter(([, s]) => /this attack does nothing\./.test(s))
      .filter(([, s]) => !OLD_ANCHOR.test(s.trim()));
    const byDollar = refused.filter(([, s]) => HEAD_ONLY.test(s.trim()));
    const byCaret = refused.filter(
      ([, s]) => !HEAD_ONLY.test(s.trim()) && TAIL_ONLY.test(s.trim()),
    );
    const byBoth = refused.filter(
      ([, s]) => !HEAD_ONLY.test(s.trim()) && !TAIL_ONLY.test(s.trim()),
    );

    expect(byDollar).toHaveLength(1);
    expect(p(byDollar)).toBe(2);
    expect(byDollar[0]?.[1]).toBe(SAWK);
    expect(byCaret).toHaveLength(7);
    expect(p(byCaret)).toBe(23);
    expect(byBoth).toHaveLength(1);
    expect(p(byBoth)).toBe(2);
    // Three disjoint parts of one whole, added in both units.
    expect(byDollar.length + byCaret.length + byBoth.length).toBe(refused.length);
    expect(p(byDollar) + p(byCaret) + p(byBoth)).toBe(p(refused));
    // 🛑 THE CLAIM D362 GOT WRONG, as an inequality: the `$` is worth an order of
    // magnitude less than the block it was priced at.
    expect(p(byDollar) * 10).toBeLessThan(p(refused));
  });

  it("the NEW anchor's reach is 9 s / 18 p, and it is the OLD one plus EXACTLY Sawk", () => {
    const nothing = legalAttackCorpus().filter(([, s]) => /this attack does nothing\./.test(s));
    const before = nothing.filter(([, s]) => OLD_ANCHOR.test(s.trim()));
    const after = nothing.filter(([, s]) => NEW_ANCHOR.test(s.trim()));
    expect(after).toHaveLength(9);
    expect(p(after)).toBe(18);
    // Set difference in BOTH directions: nothing left, exactly one arrived.
    const gained = after.filter(([, s]) => !before.some(([, t]) => t === s));
    const lost = before.filter(([, s]) => !after.some(([, t]) => t === s));
    expect(gained.map(([, s]) => s)).toEqual([SAWK]);
    expect(lost).toHaveLength(0);
    // …and the copies above really are the READER's anchors and not two regexes
    // agreeing with each other: every sentence the NEW copy admits and the OLD
    // one refuses must be one the live reader now reaches, and vice versa.
    for (const [, s] of gained) expect(deriveAttackRequirement(s), s).not.toBeNull();
    for (const [, s] of before) expect(NEW_ANCHOR.test(s.trim()), s).toBe(true);
    expect(NEW_ANCHOR.test(SAWK)).toBe(true);
    expect(OLD_ANCHOR.test(SAWK)).toBe(false);
    expect(deriveAttackRequirement(SAWK)).not.toBeNull();
  });

  it("the census moves by exactly 2 printings on exactly 1 sentence", () => {
    const rows = legalAttackCorpus();
    const resolved = rows.filter(([, s]) => readByAny(s));
    const residue = rows.filter(([, s]) => !readByAny(s));
    expect(resolved).toHaveLength(400); // 🆕🆕 D413 +2 sentences / +5 printings (THE ADDITIVE MULTI-COIN FOLD — *"Flip 2 coins. This attack does 30 more damage for each heads."* (3) and *"…does 50 more damage for each heads."* (2), ONE anchor (`ATTACK_COIN_MULTI_BONUS`) and ONE `deriveAttackCoinFlip` arm returning D129's `bonusOnHeads` over D127's `flips: { kind: "printed", count: 2 }` — a NEW COMBINATION of an already-shipped vocabulary and therefore not a new shape (D405's rule), so ZERO new ops, fields, readers, `BoardCondition` members or registry rows and `MATCH_RECORD_VERSION` STAYS 26. A READER-keyed move arriving through the RAW summand ALONE: a reader claims each sentence WHOLE, so `splitHead` and the COMPOUND term both stand still, and `REGISTRY_ATTACK_UNITS` stands still because this slice authors no rows.) 🆕🆕 D408 +2 sentences / +7 printings (THE BARE ATTACK LOCK, BOTH SEATS — *"During your opponent's next turn, the Defending Pokémon can't attack."* (3) and *"…can't use attacks."* (4), ONE ALTERNATION anchor (`DEFENDER_CANT_ATTACK_NEXT_TURN`) and ONE `deriveAttackEffect` arm returning D148's `preventAttack { target: "defender" }` unchanged: ZERO new ops, fields, readers, `BoardCondition` members or registry rows. ⚠️ THE SLICE'S THIRD SENTENCE MOVES NOTHING — *"During your next turn, this Pokémon can't use attacks."* (4 printings) ALREADY RESOLVED, to a lock keyed on an attack no card is named, so repairing it is invisible to every census figure) 🆕🆕 D407 +1 sentence / +4 printings (THE BOARD-WIDE OWN-ENERGY COUNT — *"This attack does 30 more damage for each {G} Energy attached to all of your Pokémon."*, ONE WIDENED whole-sentence anchor (`SELF_ENERGY_SCALE`) and ONE OPTIONAL `zone` on the SHIPPED `energyOnSelf` member, delegating to the `countEnergyInPlay` its opponent-side twin has called since D193: ZERO new members, counters, ops or registry rows) 🆕🆕 D406 +1 sentence / +5 printings (THE COUNTED TOOL SCALER — *"This attack does 30 damage for each Pokémon Tool attached to all of your Pokémon."*, ONE whole-sentence anchor (`YOUR_TOOLS_MULTIPLY`) and ONE `deriveAttackDamageMultiplier` arm over a THIRTEENTH `DamageCountSource` member, `toolsOnYourBoard`) 🆕🆕 D405 +1 sentence / +5 printings (THE MANDATORY OWN-BOARD ENERGY RETRIEVAL — *"Put an Energy attached to this Pokémon into your hand."*, ONE whole-sentence anchor and ONE `deriveAttackEffect` arm returning ONE `discardEnergy { from: "yourActive", filter: anyEnergy, to: "hand" }`: the op is D96's, the destination D295's and the absent `count` the op's OWN documented "one", so ZERO new ops, fields, readers, `BoardCondition` members or registry rows — a READER-keyed move, so `REGISTRY_ATTACK_UNITS` and `splitHead` both stand still. The whole price outside the reader was ONE caption branch on `discardNote`'s `yourActive` arm, which no census figure can see.) 🆕🆕 D404 +1 sentence / +7 printings (THE MANDATORY HAND WIPE AND REFILL — *"Discard your hand and draw 6 cards."*, ONE whole-sentence anchor and ONE `deriveAttackEffect` arm returning `discardHand` then `drawCards` in PRINTED ORDER: both ops shipped with Professor's Research, so ZERO new ops, fields, readers, `BoardCondition` members or registry rows, and `REGISTRY_ATTACK_UNITS` / `splitHead` stand still)  // 🆕🆕 D402 +6 sentences / +13 printings (THE DISCARD-COUNT-SCALED ATTACK — the §9.2 `discarded` record read as a damage MULTIPLIER: ONE map-built whole-sentence anchor and ONE `deriveAttackEffect` arm returning the two-op pair `registry.ts` already spells BY HAND on two cards that have since ROTATED, so ZERO new ops, fields, `BoardCondition` members or registry rows and no registry summand moves) // 🆕🆕 D401 +4 sentences / +7 printings (THE SELF-DISCARD COST BEFORE AN ANY-TARGET SNIPE — one whole-sentence COMPOUND anchor over the §8 cost and the snipe, returning both ops in printed order; a READER-keyed move, so no registry summand moves) // 🆕🆕 D400 +2 sentences / +9 printings (THE ANY-TARGET ARITY — `CHOSEN_ANY_TARGET`'s hard-coded `1 of` captured and the W/R tail's number word required to AGREE with it; a READER-keyed move, so no registry summand moves) // 🆕🆕 D399 +3 sentences / +5 printings (THE TWIN CONSEQUENT AND THE ARITY — Wo-Chien `sv08-015` "Hazardous Greed" behind a `conditionGate`, plus the FOUR printings the flat rider was refusing on the literal count `1`; a READER-keyed move, so no registry summand moves) // 🆕🆕 D398 +1 sentence / +1 printing (THE DECK-SIZE READ — Rabsca `sv08-014` "Counterturn" ({G}, `40+`, **+200**, index **1** of TWO) at 1 legal printing, taken by ONE new `BoardCondition` member (`yourDeckAtMost { count }`), TWO exhaustive-switch arms and ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row — a READER-keyed move, so `REGISTRY_ATTACK_UNITS` and `splitHead` BOTH stand still) // 🆕🆕 D397 +1 sentence / +1 printing (THE BENCHED-CUBONE FILTER — Marowak `sv07-073` "Bone Vengeance" ({C}{C}, `60+`, **+120**, index **1** of TWO) at 1 legal printing, taken by ONE new `BoardCondition` member (`yourBenchNamedDamaged { name }`), TWO exhaustive-switch arms and ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row — a READER-keyed move, so `REGISTRY_ATTACK_UNITS` and `splitHead` BOTH stand still) // 🆕🆕 D394 +2 sentences / +2 printings (THE USED-ATTACK PAIR — Falinks `sv07-088` "All-Out Attack" ({C}{C}, `30+`, **+90**, index 1 of TWO) and Weezing `sv09-092` "Crazy Blast" ({D}{C}, `50+`, **+120**, index 1 of TWO), 1 legal printing each: ONE new `BoardCondition` member (`yourActiveUsedAttackLastTurn { attack }`), ONE new REQUIRED `InPlayPokemon` field (`usedAttack`), ONE new REQUIRED field on `PendingStage.attackEpilogue`, TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and TWO new exhaustive-switch arms — the residue's LAST pair on one mechanism, the first window in the union that is not the turn in progress, and the third entry on this line to move `MATCH_RECORD_VERSION`, 24 -> 25) // 🆕🆕 D393 +2 sentences / +2 printings (THE EVOLVE PAIR — Gholdengo `sv08-131` "Strike It Rich" ({M}, `30+`, **+90**, index 0 of TWO) and Misty's Starmie `sv10-047` "Abrupt Flash" ({W}, `60+`, **+80**, index 0 of ONE), 1 legal printing each: ONE new `BoardCondition` member (`yourActiveEvolvedFromThisTurn { name }`), ONE new REQUIRED `InPlayPokemon` field (`evolvedTurn`), TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and TWO new exhaustive-switch arms — the residue's only PAIR on one mechanism, and the second entry on this line to move `MATCH_RECORD_VERSION`, 23 -> 24) // 🆕🆕 D392 +1 sentence (THE SUBSTRING NAME READ — Team Rocket's Nidoqueen `sv10-116` "Love Impact" ({D}, `60+`, **+120**, index 0 of TWO) at 1 legal printing: ONE new `BoardCondition` member (`yourBenchHasNameContaining { fragment }`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO NEW exhaustive-switch arms — a SECOND MEMBER and not a `match?:` field on `yourBenchHasNamed`, and it is the FIRST test of the rule D391 wrote down, which HELD: what changes is the comparison OPERATOR rather than a filter the delegate already takes, `conditionNote` needs a second SENTENCE rather than a second SLOT, and a member edits ZERO of `yourBenchHasNamed`'s 45 executable sites where an optional field edits THREE) // 🆕🆕 D391 +1 sentence (THE TYPED PER-BODY ENERGY THRESHOLD — Abomasnow `sv10-060` "Frozen Wood" ({W}{W}{W}{C}, `120+`, **+120**, index 1 of TWO) at 1 legal printing: ONE **OPTIONAL FIELD** (`energy?`) on the shipped `yourActiveEnergyAtLeast` member (D383), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO **edited** exhaustive-switch arms — a FIELD and NOT a second member, the OPPOSITE of D389's answer and RE-MEASURED rather than inherited: the field is OPTIONAL and edits ZERO of that member's 11 executable sites, and `countAttachedEnergy` already took exactly this filter) // 🆕🆕 D390 +1 sentence (THE OPPONENT-SEAT TYPE READ — Electivire `sv05-054` "Short-Circuit Knuckle" ({C}{C}, `40+`, **+120**) at 1 legal printing: ONE PARAMETERISED `BoardCondition` member (`opponentInPlayHasType { type }`), ONE anchored TEMPLATE reusing `CLAUSE_POKEMON_TYPES` whole and TWO exhaustive-switch arms — the family's FIFTH template pattern, and the first shipped behind a CROSS-PRODUCT anchor rung written at the PREVIOUS head) // 🆕🆕 D389 +1 sentence (THE OPPONENT-SEAT BENCH COUNT — Iron Crown `sv08-132` "Deleting Slash" ({M}{C}, `40+`, **+80**) at 1 legal printing: ONE PARAMETERISED `BoardCondition` member (`opponentBenchAtLeast { count }`), ONE literal clause row and TWO exhaustive-switch arms — a SECOND MEMBER and not a seat parameter on `yourBenchAtLeast`) // 🆕🆕 D388 +1 sentence (THE RETREAT-COST THRESHOLD — Talonflame `sv07-123` "Aero Chase" ({C}{C}, `110+`, **+110**) at 1 legal printing: ONE PARAMETERISED `BoardCondition` member (`opponentActiveRetreatCostAtLeast { count }`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO exhaustive-switch arms — ZERO new card predicates, because the printed noun phrase names `effectiveRetreatCost` (continuous.ts, D322) and not the printed `retreatCostOf` column, which is the SHAPE question D387 left open and this slice settled) // 🆕🆕 D387 +1 sentence (THE STAGE 1 CLAUSE — Paldean Tauros `sv08-018` "Spirited Tackle" ({R}{C}{C}, `90+`, **+90**) at 1 legal printing: ONE `cards.ts` predicate (`isStage1Pokemon`), ONE `BoardCondition` member (`opponentActiveIsStage1`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO exhaustive-switch arms — a SUBSET of `opponentActiveIsEvolution` that is NOT a narrowing of it, so that member and all NINE of its printings stand still) // 🆕🆕 D386 +1 sentence (THE HEALED-THIS-TURN CLAUSE — Maractus `sv10.5b-008`/`-093` "Lively Needles" ({G}, `20+`, **+100**) at 2 legal printings: ONE `BoardCondition` member (`yourActiveHealedThisTurn`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row, TWO exhaustive-switch arms and ONE new REQUIRED `InPlayPokemon` field — the first entry on this line to move `MATCH_RECORD_VERSION`, 22 -> 23. ⚠️ AND THE FIRST IN FOUR SLICES THIS NINE-READER INSTRUMENT CAN SEE AT ALL: D385 resolved through the TENTH reader and left this figure standing) // 🆕🆕 D384 +1 sentence (THE STRICT-INEQUALITY TWIN — Swalot `sv07-092` "Devouring Mouth" ({D}, `10+`, **+160**) at 1 legal printing: ONE nullary `BoardCondition` member (`moreActiveEnergyThanOpponent`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO exhaustive-switch arms — the sentence D372 priced, refused and pinned as its own near miss) // 🆕🆕 D382 +1 sentence (THE `. Then, ` JOIN — D317's shape with the printed comma changed: Chi-Yu `sv06-039` "Ground Melter" ({R}{C}, `60+`) at 1 legal printing, ONE anchor constant and ONE consequent row on `deriveAttackBonusConsequent`, ZERO new readers and ZERO new ops) // 🆕🆕 D380 +2 sentences (THE STADIUM-DISCARD OP — `discardStadium`: *"Discard a Stadium in play."* at 4 legal printings and *"You may discard a Stadium in play."* at 2, ONE new FIELD-FREE `EffectOp` behind TWO whole-sentence anchors — the first slice in this run to buy an OP rather than a `BoardCondition`) // 🆕🆕 D379 +1 sentence (THE EXACT HAND-SIZE READ — `yourHandExactly { count }`: ONE CANCEL sentence at 2 legal printings, Alolan Dugtrio `sv08-123`/`sv08-208` "Trio-Cheehoo", and NO bonus twin — the FIRST slice in this family whose member has no `CONDITIONAL_DAMAGE_CLAUSES` row) // 🆕🆕 D378 +2 sentences (STADIUM PRESENCE — `stadiumInPlay`: ONE bonus sentence at 1 legal printing, Probopass `sv10-098` "Mountain Drop" +70, PLUS one CANCEL sentence on the SAME member at 2 printings, Fan Rotom `sv07-118`/`sv08.5-085` "Assault Landing" — ONE new NULLARY `BoardCondition` member, ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and ONE `ATTACK_REQUIREMENT_CLAUSES` row) // 🆕🆕 D377 **+3 SENTENCES / +3 PRINTINGS** (the CROSS-BOARD STATUS PAIR — TWO bonus sentences at 1 legal printing each, *"…is Burned"* +40 and *"…is Confused"* +90, PLUS one CANCEL sentence on the SAME member, *"…isn't Burned"*; TWO new NULLARY `BoardCondition` members, TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and ONE `ATTACK_REQUIREMENT_CLAUSES` row) // 🆕🆕 D376 +1 sentence (the FILTERED DISCARD-PILE THRESHOLD, 2 printings, ONE new PARAMETERISED member + ONE literal row) // 🆕🆕 D375 +1 sentence (the CROSS-BOARD TYPE INTERSECTION, 2 printings, ONE new NULLARY member + ONE literal row) // 🆕🆕 D374 +1 sentence (the NAMED-ENERGY clause, 2 printings, ONE new member + ONE literal row) // 🆕🆕 D373 +1 sentence (the UNIVERSAL-OVER-THE-BENCH clause, 2 printings, ONE new member + ONE literal row) // 🆕🆕 D372 **+2 SENTENCES** (the CROSS-BOARD EQUAL-ENERGY clause, printed under TWO sentences at 1 printing each, ONE new member + ONE literal row) — the first step on this line that is not +1 // 🆕🆕 D371 +1 sentence (the OPPONENT-RESISTANCE clause, 2 printings, ONE new member + ONE new template) // 🆕🆕 D370 +1 sentence (the bench-scoped {M} TYPE clause, 2 printings, ONE new member + ONE new template) // 🆕🆕 D369 +1 sentence (the cross-board Pokémon Tool clause, 2 printings) // 🆕🆕 D368 +1 sentence (Arven's Mabosstiff ex, 3 printings, ONE new member). // 🆕🆕 D367 +9 sentences (13 printings, ZERO new members). // 🆕🆕 D366 +1 sentence (Victini, 4 printings). // 330 at D362, 331 at D363, 🆕🆕 334 at D365 (+3 sentences / +5 printings, three more rows in the SAME table this file is about — the census this case pins is whole-corpus, so it moves whenever the table does)
    expect(p(resolved)).toBe(1336); // 🆕🆕 D413 +2 sentences / +5 printings (THE ADDITIVE MULTI-COIN FOLD — *"Flip 2 coins. This attack does 30 more damage for each heads."* (3) and *"…does 50 more damage for each heads."* (2), ONE anchor (`ATTACK_COIN_MULTI_BONUS`) and ONE `deriveAttackCoinFlip` arm returning D129's `bonusOnHeads` over D127's `flips: { kind: "printed", count: 2 }` — a NEW COMBINATION of an already-shipped vocabulary and therefore not a new shape (D405's rule), so ZERO new ops, fields, readers, `BoardCondition` members or registry rows and `MATCH_RECORD_VERSION` STAYS 26. A READER-keyed move arriving through the RAW summand ALONE: a reader claims each sentence WHOLE, so `splitHead` and the COMPOUND term both stand still, and `REGISTRY_ATTACK_UNITS` stands still because this slice authors no rows.) 🆕🆕 D408 +2 sentences / +7 printings (THE BARE ATTACK LOCK, BOTH SEATS — *"During your opponent's next turn, the Defending Pokémon can't attack."* (3) and *"…can't use attacks."* (4), ONE ALTERNATION anchor (`DEFENDER_CANT_ATTACK_NEXT_TURN`) and ONE `deriveAttackEffect` arm returning D148's `preventAttack { target: "defender" }` unchanged: ZERO new ops, fields, readers, `BoardCondition` members or registry rows. ⚠️ THE SLICE'S THIRD SENTENCE MOVES NOTHING — *"During your next turn, this Pokémon can't use attacks."* (4 printings) ALREADY RESOLVED, to a lock keyed on an attack no card is named, so repairing it is invisible to every census figure) 🆕🆕 D407 +4 printings (THE BOARD-WIDE OWN-ENERGY COUNT — *"…for each {G} Energy attached to all of your Pokémon."*, the `+` fold, so the printed `20+` base is KEPT and an Energy-free board still deals it) 🆕🆕 D406 +5 printings (THE COUNTED TOOL SCALER — *"This attack does 30 damage for each Pokémon Tool attached to all of your Pokémon."*, the `×` fold, so the printed `30×` base is DROPPED and a Tool-less board deals nothing) 🆕🆕 D405 +5 printings (THE MANDATORY OWN-BOARD ENERGY RETRIEVAL — *"Put an Energy attached to this Pokémon into your hand."*, ONE anchor and ONE `deriveAttackEffect` arm over an already-shipped op and an already-shipped destination) 🆕🆕 D402 +13 printings (THE DISCARD-COUNT-SCALED ATTACK) // 🆕🆕 D401 +7 printings (THE SELF-DISCARD COST BEFORE AN ANY-TARGET SNIPE) // 🆕🆕 D400 +9 printings (THE ANY-TARGET ARITY) // 🆕🆕 D399 +5 printings (THE TWIN CONSEQUENT AND THE ARITY) // 🆕🆕 D398 +1 printing (THE DECK-SIZE READ) // 🆕🆕 D397 +1 printing (THE BENCHED-CUBONE FILTER — Marowak `sv07-073` "Bone Vengeance" ({C}{C}, `60+`, **+120**, index **1** of TWO) at 1 legal printing, READER-keyed) // 🆕🆕 D394 — the USED-ATTACK PAIR: +2 sentences / +2 printings, a READER-keyed move // 🆕🆕 D393 +2 printings (THE EVOLVE PAIR — Gholdengo `sv08-131` and Misty's Starmie `sv10-047`, one printing each, both READER-keyed) // 🆕🆕 D392 +1 printing (THE SUBSTRING NAME READ — one sentence, one printing: the 1:1 shape for a seventh slice running, and the first taken by a member whose payload field is deliberately NOT named `name`) // 🆕🆕 D391 +1 printing (THE TYPED PER-BODY ENERGY THRESHOLD — Abomasnow `sv10-060` "Frozen Wood" at 1 legal printing: an OPTIONAL FIELD on a shipped `BoardCondition` member, so the READER-keyed summand moves and no registry summand does) // 🆕🆕 D390 +1 printing (THE OPPONENT-SEAT TYPE READ — one sentence, one printing: the 1:1 shape for the fourth slice running) // 🆕🆕 D389 +1 printing (THE OPPONENT-SEAT BENCH COUNT — one sentence, one printing: the 1:1 shape for the third slice running) // 🆕🆕 D388 +1 printing (THE RETREAT-COST THRESHOLD — one sentence, one printing: the 1:1 shape, and the fold is the reading the engine had already given this noun phrase since 0.61.0) // 🆕🆕 D387 +1 printing (THE STAGE 1 CLAUSE — one sentence, one legal printing; the family's third 1:1 step) // 🆕🆕 D386 +2 printings (THE HEALED-THIS-TURN CLAUSE — one sentence, two legal printings, a 1:2 step) // 🆕🆕 D384 +1 printing (THE STRICT-INEQUALITY TWIN — one sentence, one legal printing; the family's FIRST 1:1 step) // 🆕🆕 D382 +1 printing (THE `. Then, ` JOIN — one sentence, one legal printing) // 🆕🆕 D380 +6 printings (THE STADIUM-DISCARD OP — TWO sentences, 4 + 2 legal printings, on ONE new FIELD-FREE `EffectOp`) // 🆕🆕 D379 +2 printings (THE EXACT HAND-SIZE READ) // 🆕🆕 D378 +3 printings (STADIUM PRESENCE — `stadiumInPlay`: ONE bonus sentence at 1 legal printing, Probopass `sv10-098` "Mountain Drop" +70, PLUS one CANCEL sentence on the SAME member at 2 printings, Fan Rotom `sv07-118`/`sv08.5-085` "Assault Landing" — ONE new NULLARY `BoardCondition` member, ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and ONE `ATTACK_REQUIREMENT_CLAUSES` row) // 🆕🆕 D377 +3 // 🆕🆕 D376 +2. // 🆕🆕 D375 +2. // 🆕🆕 D374 +2. // 🆕🆕 D373 +2. // 🆕🆕 D372 +2. // 🆕🆕 D371 +2. // 🆕🆕 D370 +2. // 🆕🆕 D369 +2. // 🆕🆕 D368 +3. // 🆕🆕 D367 +13. // 🆕🆕 D366 +4. // 1,196 at D362, 1,198 at D363
    expect(residue).toHaveLength(240); // 🆕🆕 D413 -2 sentences / -5 printings (THE ADDITIVE MULTI-COIN FOLD — *"Flip 2 coins. This attack does 30 more damage for each heads."* (3) and *"…does 50 more damage for each heads."* (2) LEAVE this residue through the SWEEP, the exact mirror of the resolving column's +2 / +5 two lines up and re-derived from the refusal set rather than decremented. ONE anchor (`ATTACK_COIN_MULTI_BONUS`) and ONE `deriveAttackCoinFlip` arm over the SHIPPED `bonusOnHeads` × `printed` pair, so the corpus total is untouched and the two sum rungs below are what say so.) 🆕🆕 D408 -2 sentences / -7 printings (THE BARE ATTACK LOCK, BOTH SEATS — *"During your opponent's next turn, the Defending Pokémon can't attack."* (3) and *"…can't use attacks."* (4), ONE ALTERNATION anchor (`DEFENDER_CANT_ATTACK_NEXT_TURN`) and ONE `deriveAttackEffect` arm returning D148's `preventAttack { target: "defender" }` unchanged: ZERO new ops, fields, readers, `BoardCondition` members or registry rows. ⚠️ THE SLICE'S THIRD SENTENCE MOVES NOTHING — *"During your next turn, this Pokémon can't use attacks."* (4 printings) ALREADY RESOLVED, to a lock keyed on an attack no card is named, so repairing it is invisible to every census figure) 🆕🆕 D407 — THE BOARD-WIDE OWN-ENERGY COUNT: -1 sentence / -4 printings, a READER-keyed move 🆕🆕 D406 — THE COUNTED TOOL SCALER: -1 sentence / -5 printings, a READER-keyed move 🆕🆕 D405 — THE MANDATORY OWN-BOARD ENERGY RETRIEVAL: -1 sentence / -5 printings, a READER-keyed move 🆕🆕 D404 — THE MANDATORY HAND WIPE AND REFILL: -1 sentence / -7 printings, a READER-keyed move // 🆕🆕 D402 — THE DISCARD-COUNT-SCALED ATTACK: -6 sentences / -13 printings, a READER-keyed move // 🆕🆕 D401 — THE SELF-DISCARD COST BEFORE AN ANY-TARGET SNIPE: -4 sentences / -7 printings, a READER-keyed move // 🆕🆕 D400 — THE ANY-TARGET ARITY: -2 sentences / -9 printings, a READER-keyed move // 🆕🆕 D399 — THE TWIN CONSEQUENT AND THE ARITY: -3 sentences / -5 printings, a READER-keyed move // 🆕🆕 D398 — the DECK-SIZE READ: -1 sentence / -1 printing, a READER-keyed move // // 🆕🆕 D397 — the BENCHED-CUBONE FILTER: +1 sentence / +1 printing, a READER-keyed move // 🆕🆕 D394 — the USED-ATTACK PAIR: +2 sentences / +2 printings, a READER-keyed move // 🆕🆕 D393 -2 sentences (THE EVOLVE PAIR — two sentences worth one printing each) // 🆕🆕 D392 -1 sentence (THE SUBSTRING NAME READ — one sentence worth one printing) // 🆕🆕 D391 -1 sentence (THE TYPED PER-BODY ENERGY THRESHOLD — one sentence worth one printing) // 🆕🆕 D390 -1 sentence (THE OPPONENT-SEAT TYPE READ — one sentence worth one printing) // 🆕🆕 D389 -1 sentence (THE OPPONENT-SEAT BENCH COUNT — one sentence worth one printing) // 🆕🆕 D388 -1 sentence (THE RETREAT-COST THRESHOLD — one sentence worth one printing) // 🆕🆕 D387 -1 sentence (THE STAGE 1 CLAUSE — one sentence worth one printing) // 🆕🆕 D386 -1 sentence (THE HEALED-THIS-TURN CLAUSE — one sentence worth two printings) // 🆕🆕 D384 -1 sentence (THE STRICT-INEQUALITY TWIN — Swalot `sv07-092` "Devouring Mouth", 1 legal printing) // 🆕🆕 D382 -1 sentence (THE `. Then, ` JOIN) // 🆕🆕 D380 -2 sentences (THE STADIUM-DISCARD OP — two sentences worth SIX printings) // 🆕🆕 D379 -1 sentence (THE EXACT HAND-SIZE READ) // 🆕🆕 D378 -2 sentences (STADIUM PRESENCE — `stadiumInPlay`, TWO sentences worth THREE printings across BOTH consequents) // 🆕🆕 D377 -3 // 🆕🆕 D376 -1 sentence (the FILTERED DISCARD-PILE THRESHOLD) // 🆕🆕 D375 -1 sentence (the CROSS-BOARD TYPE INTERSECTION) // 🆕🆕 D374 -1 sentence (the NAMED-ENERGY clause) // 🆕🆕 D373 -1 sentence (the UNIVERSAL-OVER-THE-BENCH clause) // 🆕🆕 D372 -2 sentences // 🆕🆕 D371 -1 sentence // 🆕🆕 D370 -1 sentence // 🆕🆕 D369 -1 sentence // 🆕🆕 D368 -1 sentence // 🆕🆕 D367 -9 sentences // 🆕🆕 D366 -1 sentence
    expect(p(residue)).toBe(396); // 🆕🆕 D413 -2 sentences / -5 printings (THE ADDITIVE MULTI-COIN FOLD — *"Flip 2 coins. This attack does 30 more damage for each heads."* (3) and *"…does 50 more damage for each heads."* (2) LEAVE this residue through the SWEEP, the exact mirror of the resolving column's +2 / +5 two lines up and re-derived from the refusal set rather than decremented. ONE anchor (`ATTACK_COIN_MULTI_BONUS`) and ONE `deriveAttackCoinFlip` arm over the SHIPPED `bonusOnHeads` × `printed` pair, so the corpus total is untouched and the two sum rungs below are what say so.) 🆕🆕 D408 -2 sentences / -7 printings (THE BARE ATTACK LOCK, BOTH SEATS — *"During your opponent's next turn, the Defending Pokémon can't attack."* (3) and *"…can't use attacks."* (4), ONE ALTERNATION anchor (`DEFENDER_CANT_ATTACK_NEXT_TURN`) and ONE `deriveAttackEffect` arm returning D148's `preventAttack { target: "defender" }` unchanged: ZERO new ops, fields, readers, `BoardCondition` members or registry rows. ⚠️ THE SLICE'S THIRD SENTENCE MOVES NOTHING — *"During your next turn, this Pokémon can't use attacks."* (4 printings) ALREADY RESOLVED, to a lock keyed on an attack no card is named, so repairing it is invisible to every census figure) 🆕🆕 D407 — THE BOARD-WIDE OWN-ENERGY COUNT: -4 printings, a READER-keyed move 🆕🆕 D406 — THE COUNTED TOOL SCALER: -5 printings, a READER-keyed move 🆕🆕 D405 — THE MANDATORY OWN-BOARD ENERGY RETRIEVAL: -5 printings, a READER-keyed move 🆕🆕 D404 — THE MANDATORY HAND WIPE AND REFILL: -7 printings, a READER-keyed move // 🆕🆕 D402 — THE DISCARD-COUNT-SCALED ATTACK: -13 printings, a READER-keyed move // 🆕🆕 D401 — THE SELF-DISCARD COST BEFORE AN ANY-TARGET SNIPE: -7 printings, a READER-keyed move // 🆕🆕 D400 — THE ANY-TARGET ARITY: -9 printings, a READER-keyed move // 🆕🆕 D399 — THE TWIN CONSEQUENT AND THE ARITY: -5 printings, a READER-keyed move // 🆕🆕 D398 — the DECK-SIZE READ: -1 printing, a READER-keyed move // 🆕🆕 D397 — the BENCHED-CUBONE FILTER: +1 printing, a READER-keyed move // 🆕🆕 D394 — the USED-ATTACK PAIR: +2 sentences / +2 printings, a READER-keyed move // 🆕🆕 D393 -2 printings (THE EVOLVE PAIR) // 🆕🆕 D392 -1 printing (THE SUBSTRING NAME READ) // 🆕🆕 D391 -1 printing (THE TYPED PER-BODY ENERGY THRESHOLD) // 🆕🆕 D390 -1 printing (THE OPPONENT-SEAT TYPE READ) // 🆕🆕 D389 -1 printing (THE OPPONENT-SEAT BENCH COUNT) // 🆕🆕 D388 -1 printing (THE RETREAT-COST THRESHOLD) // 🆕🆕 D387 -1 printing (THE STAGE 1 CLAUSE) // 🆕🆕 D386 -2 printings (THE HEALED-THIS-TURN CLAUSE) // 🆕🆕 D384 -1 printing (THE STRICT-INEQUALITY TWIN) // 🆕🆕 D382 -1 printing (THE `. Then, ` JOIN) // 🆕🆕 D380 -6 printings (THE STADIUM-DISCARD OP) // 🆕🆕 D379 -2 printings (THE EXACT HAND-SIZE READ) // 🆕🆕 D378 -3 printings (STADIUM PRESENCE — `stadiumInPlay`: ONE bonus sentence at 1 legal printing, Probopass `sv10-098` "Mountain Drop" +70, PLUS one CANCEL sentence on the SAME member at 2 printings, Fan Rotom `sv07-118`/`sv08.5-085` "Assault Landing" — ONE new NULLARY `BoardCondition` member, ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and ONE `ATTACK_REQUIREMENT_CLAUSES` row) // 🆕🆕 D377 -3 // 🆕🆕 D376 -2. // 🆕🆕 D375 -2. // 🆕🆕 D374 -2. // 🆕🆕 D373 -2. // 🆕🆕 D372 -2. // 🆕🆕 D371 -2. // 🆕🆕 D370 -2. // 🆕🆕 D369 -2. // 🆕🆕 D368 -3. // 🆕🆕 D367 -13. // 🆕🆕 D366 -4.
    expect(resolved.length + residue.length).toBe(rows.length);
    expect(p(resolved) + p(residue)).toBe(p(rows));
    // The one sentence that moved, named — a delta of 2 could otherwise be any
    // two printings at all.
    expect(resolved.some(([, s]) => s === SAWK)).toBe(true);
  });
});

describe("§2 — the `^` is untouched, and the coin family proves it", () => {
  it("refuses every `^`-blocked printing in the corpus, one by one", () => {
    const refusedByCaret = legalAttackCorpus()
      .filter(([, s]) => /this attack does nothing\./.test(s))
      .filter(([, s]) => !/^If (.+), this attack does nothing\./.test(s.trim()));
    expect(refusedByCaret).toHaveLength(8);
    expect(p(refusedByCaret)).toBe(25);
    for (const [, s] of refusedByCaret) {
      expect(deriveAttackRequirement(s), s).toBeNull();
      expect(splitAttackRequirementClause(s), s).toBeNull();
    }
  });

  it("🛑 leaves the 16 coin-cancel printings on `deriveAttackCoinFlip` and nowhere else", () => {
    // The sharpest reason the `^` may not move: this sentence is ALREADY read.
    // A reader that also claimed it would take a second flip on one attack.
    const CANCEL = "Flip a coin. If tails, this attack does nothing.";
    const row = legalAttackCorpus().find(([, s]) => s === CANCEL);
    expect(row?.[0]).toBe(16);
    expect(deriveAttackCoinFlip(CANCEL)).toEqual({ kind: "cancelOnTails" });
    expect(deriveAttackRequirement(CANCEL)).toBeNull();
    expect(splitAttackRequirementClause(CANCEL)).toBeNull();
  });

  it("keeps the CONTROL that says the reader is really running — Palafin, unsplit", () => {
    // D362's control, kept and inverted where it should invert. Palafin's row
    // reads today…
    expect(deriveAttackRequirement(PALAFIN)).toEqual({ kind: "yourActivePromotedThisTurn" });
    // …and NOW it keeps reading with the identical trailing sentence bolted on,
    // which is the whole diff. D362 asserted this returned null.
    expect(deriveAttackRequirement(`${PALAFIN} ${SAWK_TAIL}`)).toEqual({
      kind: "yourActivePromotedThisTurn",
    });
    // …and the split hands the companion back rather than eating it.
    expect(splitAttackRequirementClause(`${PALAFIN} ${SAWK_TAIL}`)).toEqual({
      clause: PALAFIN,
      body: SAWK_TAIL,
    });
    // A SINGLE-sentence printing is NOT a split — there is no body to return, and
    // returning `{body:""}` would make "is there a remainder" depend on a string.
    expect(splitAttackRequirementClause(PALAFIN)).toBeNull();
  });
});

describe("§3 — the clause-table row, ZERO new vocabulary, and the round trip", () => {
  it("maps the printed NEGATIVE onto D362's EXISTING positive member", () => {
    expect(deriveAttackRequirement(SAWK)).toEqual({ kind: "opponentActiveIsEx" });
    expect(deriveAttackRequirement(SAWK_HEAD)).toEqual({ kind: "opponentActiveIsEx" });
    // 🛑 THE NO-NEW-VOCABULARY CLAIM, DRIVEN: the note this member already
    // produced is the POSITIVE clause D362's bonus table keys on, and the printed
    // negative is that clause with "is" → "isn't". One member, two consequents.
    expect(conditionNote({ kind: "opponentActiveIsEx" })).toBe(
      "your opponent's Active Pokémon is a Pokémon ex",
    );
    expect(SAWK_HEAD).toBe(
      `If ${conditionNote({ kind: "opponentActiveIsEx" }).replace(" is a", " isn't a")}, this attack does nothing.`,
    );
  });

  it("keeps the two consequents DISJOINT — the negative never reaches the bonus table", () => {
    // D125's standing rule, re-asserted on the new pair: a clause read under
    // "does nothing" must not be reachable from "does N more damage" or back.
    expect(deriveAttackDamageBonus(SAWK)).toBeNull();
    expect(deriveAttackDamageBonus(SAWK_HEAD)).toBeNull();
    expect(
      deriveAttackRequirement(
        "If your opponent's Active Pokémon is a Pokémon ex, this attack does 90 more damage.",
      ),
    ).toBeNull();
  });

  it("keys CHAR-FOR-CHAR — five rewrites of the clause all stay null", () => {
    for (const clause of [
      "your opponent's Active Pokemon isn't a Pokémon ex", // ASCII "Pokemon"
      "your opponent's Active Pokémon is not a Pokémon ex", // expanded contraction
      "your opponent's active Pokémon isn't a Pokémon ex", // lowercased noun
      "your opponents Active Pokémon isn't a Pokémon ex", // possessive dropped
      "your opponent's Active Pokémon isn't a Pokémon ex or Pokémon V", // the WIDER key
    ]) {
      expect(
        deriveAttackRequirement(`If ${clause}, this attack does nothing.`),
        clause,
      ).toBeNull();
    }
  });
});

describe("§4 — the split, and the accounting guard that makes it safe", () => {
  it("splits Sawk into the two sentences the engine already reads", () => {
    expect(splitAttackRequirementClause(SAWK)).toEqual({ clause: SAWK_HEAD, body: SAWK_TAIL });
    // Both halves read, SEPARATELY, by readers that predate this slice.
    expect(deriveAttackRequirement(SAWK_HEAD)).toEqual({ kind: "opponentActiveIsEx" });
    expect(deriveAttackDamageSuppression(SAWK_TAIL)).toEqual({ weakness: true, resistance: true });
    // 🛑 AND `DAMAGE_SUPPRESSION` IS BYTE-UNCHANGED: it still refuses the compound
    // WHOLE. What changed is the string the site hands it, not the anchor.
    expect(deriveAttackDamageSuppression(SAWK)).toBeNull();
  });

  it("🛑 refuses to strip a clause the TABLE does not carry — the accounting guard", () => {
    // The whole safety of the widening. An unmapped leading clause must keep its
    // WHOLE printed string, or the site would report only the remainder and a
    // printed requirement would be silently deleted.
    // 🛑 ⚠️ 🆕🆕 **D379 — THE SUBJECT IS NOW CONSTRUCTED, AND THAT IS THE EXPIRY D378
    // WROTE DOWN ARRIVING ONE SLICE LATER.** This rung named the Stadium-PRESENCE
    // sentence from D363 until D378 built it, then the exact hand-size read until
    // D379 built THAT one — and the legal attack column now holds NO unmapped
    // does-nothing opener at all, so there is no printed sentence left to re-point
    // to. The clause below is the printed one with its PARAMETER moved by one.
    //
    // ⚠️ **WHAT THE CONSTRUCTION COSTS AND WHAT IT BUYS.** It costs the guard its
    // catalog provenance — the assertion that the corpus really prints this string is
    // GONE and is replaced by its opposite. It buys a defect no printed sentence can
    // express: `ATTACK_REQUIREMENT_CLAUSES` is keyed on a LITERAL, so a table
    // "simplified" into a `\d+` pattern would MAP this and the accounting guard would
    // strip a companion sentence nothing had answered. The near-miss is now the
    // sharpest one available rather than merely the last one left.
    const unmapped = `If you don't have exactly 4 cards in your hand, this attack does nothing. ${SAWK_TAIL}`;
    expect(deriveAttackRequirement(unmapped)).toBeNull();
    expect(splitAttackRequirementClause(unmapped)).toBeNull();
    // …and the leading sentence is NOT one the corpus prints, which is stated as an
    // assertion rather than left as a comment — this is exactly the line that used to
    // say the opposite.
    expect(
      legalAttackCorpus().some(([, s]) => s.includes("exactly 4 cards in your hand")),
    ).toBe(false);
    // 🛑 AND BOTH SENTENCES THIS RUNG USED TO NAME ARE NOW MAPPED, asserted from the
    // other side rather than deleted (D178): each refusal was real, and what changed
    // is the head, not the rule.
    expect(
      deriveAttackRequirement("If there is no Stadium in play, this attack does nothing."),
    ).toEqual({ kind: "stadiumInPlay" });
    expect(
      deriveAttackRequirement(
        "If you don't have exactly 3 cards in your hand, this attack does nothing.",
      ),
    ).toEqual({ kind: "yourHandExactly", count: 3 });
    // 🛑 …AND THE PRINTED ONE IS STRIPPABLE WHERE THE CONSTRUCTED ONE IS NOT, on the
    // very same companion. One `expect` apart, which is what makes the guard's subject
    // a near miss rather than a straw string.
    expect(
      splitAttackRequirementClause(
        `If you don't have exactly 3 cards in your hand, this attack does nothing. ${SAWK_TAIL}`,
      ),
    ).toEqual({
      clause: "If you don't have exactly 3 cards in your hand, this attack does nothing.",
      body: SAWK_TAIL,
    });
  });

  it("does not touch D282's gate split — two splits, two populations, no overlap", () => {
    // Both are leading-sentence strippers on the same string. If either claimed
    // the other's sentences the site would strip twice.
    for (const [, text] of legalAttackCorpus()) {
      if (splitAttackGateClause(text) === null) continue;
      expect(splitAttackRequirementClause(text), text).toBeNull();
    }
    expect(splitAttackGateClause(SAWK)).toBeNull();
  });
});

describe("§5 — on a board: the requirement gates, the suppression lands, the residue stays loud", () => {
  it("CANCELS into a body that is not a Pokémon ex, and the turn still ends", () => {
    const after = mustApply(ready(61, "fix-bigbody"), { type: "attack", seat: "p1", index: 0 });
    expect(types(after.events)).toContain("ATTACK_FAILED");
    expect(after.events.find((e) => e.type === "ATTACK_FAILED")).toMatchObject({
      reason: "requirement",
    });
    expect(types(after.events)).not.toContain("DAMAGE_DEALT");
    // 🛑 AND NOTHING IS FLAGGED: both printed sentences are accounted for, so the
    // cancel is a SIMULATED outcome and not an unread one.
    expect(types(after.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("CANCELS into a Pokémon V — the board where this member and `…IsExOrV` disagree", () => {
    // D362 drove that disagreement under the POSITIVE consequent. Under the
    // NEGATIVE one the answer inverts, and a reused wider member would let the
    // attack through here instead of cancelling it.
    const after = mustApply(ready(62, "fix-pokemon-v"), { type: "attack", seat: "p1", index: 0 });
    expect(after.events.find((e) => e.type === "ATTACK_FAILED")).toMatchObject({
      reason: "requirement",
    });
    expect(types(after.events)).not.toContain("DAMAGE_DEALT");
  });

  it("🛑 lands 90 into an ex whose printed Weakness is Fighting ×2 — the SUPPRESSION half", () => {
    // The row's second sentence, observable: Okidogi ex prints Weakness Fighting
    // ×2 and Sawk is Fighting, so an engine that dropped the trailing sentence
    // would deal 180 here. The two answers are one `toBe` apart.
    expect(FIXTURE_POOL["sv06.5-036"]?.weaknesses).toEqual([{ type: "Fighting", value: "×2" }]);
    expect(FIXTURE_POOL["fix-sawk"]?.types).toEqual(["Fighting"]);
    const after = mustApply(ready(63, "sv06.5-036"), { type: "attack", seat: "p1", index: 0 });
    const hit = after.events.find((e) => e.type === "DAMAGE_DEALT");
    expect(hit).toMatchObject({ base: 90, dealt: 90 });
    expect(types(after.events)).not.toContain("ATTACK_FAILED");
    expect(types(after.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 REPORTS the companion it cannot read, naming the BODY and not the compound", () => {
    // The gate on `effectSimulated`. `fix-sawk` index 1 prints the SAME mapped
    // leading clause with a companion no reader resolves; without the gate the
    // requirement would set `effectSimulated` and this event would not exist.
    const after = mustApply(ready(64, "sv06.5-036"), { type: "attack", seat: "p1", index: 1 });
    const skipped = after.events.find((e) => e.type === "ATTACK_EFFECT_SKIPPED");
    expect(skipped).toBeDefined();
    // ⚠️ THE BODY ALONE — not the whole printed string. Naming the half the
    // engine still cannot read is D282's rule, inherited here.
    expect(skipped).toMatchObject({ effect: "Then, spin the wheel of fate." });
    // …and the requirement it DID read still gates the attack: this one lands,
    // because the Active IS an ex.
    expect(types(after.events)).not.toContain("ATTACK_FAILED");
  });

  it("🛑 keeps the WHOLE string loud when the leading clause is UNMAPPED", () => {
    // The accounting guard, on a board. `fix-sawk` index 2 prints an unmapped
    // leading clause with a companion the engine CAN read — so a split that
    // ignored the table would report nothing and apply a suppression whose
    // requirement it never enforced.
    const after = mustApply(ready(65, "sv06.5-036"), { type: "attack", seat: "p1", index: 2 });
    const skipped = after.events.find((e) => e.type === "ATTACK_EFFECT_SKIPPED");
    expect(skipped).toBeDefined();
    // ⚠️ 🆕🆕 D379 — the fixture's clause is now CONSTRUCTED ("exactly 4"); see
    // `testFixtures.ts`'s block on this attack and §4 above for what that costs and
    // what it buys.
    expect(skipped).toMatchObject({
      effect: `If you don't have exactly 4 cards in your hand, this attack does nothing. ${SAWK_TAIL}`,
    });
    // No requirement was read, so nothing was gated…
    expect(types(after.events)).not.toContain("ATTACK_FAILED");
    // …and the printed 20 lands DOUBLED by Okidogi's Fighting Weakness, because
    // the suppression sentence was never reached. That is the correct loud
    // behaviour and it is asserted rather than assumed.
    expect(after.events.find((e) => e.type === "DAMAGE_DEALT")).toMatchObject({ dealt: 40 });
  });
});

describe("§6 — what this slice did NOT buy", () => {
  it("authors ZERO registry rows for either Sawk printing", async () => {
    const { programFor, registryCardIds } = await import("./registry");
    for (const id of ["sv10.5w-049", "sv10.5w-130"]) {
      expect(programFor(id), id).toBeUndefined();
      expect(registryCardIds().includes(id), id).toBe(false);
    }
  });

  it("the ROTATED and NON-ATTACK columns cannot move — the sentence is attack-only", () => {
    // Measured on the remote D1 (`luminous`, 2026-08-18) rather than assumed: the
    // sentence returns ZERO rows on `effect` and ZERO on `abilities_json`, and
    // both `attacks_json` rows are `legal_standard = 1`. Recorded here as the two
    // printing ids, which is the half a test can re-check.
    const row = legalAttackCorpus().find(([, s]) => s === SAWK);
    expect(row?.[0]).toBe(2);
  });
});
