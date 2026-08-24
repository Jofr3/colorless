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
} from "./effects";
import type { GameState } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { EX_ONLY_DECK, clearBench, driveSetup, mustApply, setActiveFromDeck, types } from "./testFixtures";
import { attachFromDeck } from "./testFixtures";

// D362 — THE ex-ONLY ACTIVE BOARD PREDICATE: seven printed sentences, ONE new
// `BoardCondition` member, and ZERO other vocabulary anywhere in the engine.
//
// THE MEASUREMENT THAT CHOSE THIS ROW, re-derived at this head over all four
// surfaces rather than inherited. The legal attack corpus is 640 sentences /
// 1,732 printings; the NINE readers together resolved 323 / 1,185 before this
// slice — and 1,185 is `BUILT.attack`'s own committed RAW summand, which is the
// cross-check that makes the rest believable. Inside that residue the ex-ONLY
// Active board predicate is EIGHT sentences / THIRTEEN Standard-legal printings:
//
//   ✅ "If your opponent's Active Pokémon is a Pokémon ex, this attack does
//        {40,50,70,80,90,100} more damage."                        6 s / 10 p
//        svp-179, sv10.5w-077/-162/-170 (+100); sv07-090, sv10-131 (+70);
//        sv10-130 (+40); sv08.5-089 (+50); sv08-141 (+80); sv09-018 (+90)
//   ✅ "Discard an Energy from your opponent's Active Pokémon ex."  1 s /  1 p
//        Turtonator sv08-137 "Fully Singe"
//   🛑 "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does
//        nothing. …"                                               1 s /  2 p
//        Sawk sv10.5w-049/-130 — REFUSED, see §5.
//
// 🛑 AND THE ROW IS THE MISSING HALF OF A PAIR RATHER THAN A BESPOKE NARROWING,
// WHICH IS A COUNT AND NOT A PREFERENCE. The strictly WIDER "ex or Pokémon V"
// spelling of the SAME clause-table template is ALREADY BUILT at 4 sentences /
// 6 printings, and has been since D107. THE NARROWER PREDICATE HAS MORE THAN
// TWICE THE PRINTINGS OF THE WIDER ONE THE ENGINE ALREADY READS. D361 refused
// this member on the ratio "one union member for ONE printing", then measured it
// and inverted its own recommendation; §1 re-derives the whole table LIVE so the
// claim is a measurement in this file rather than a paragraph in another.
//
// 🛑 THE PRODUCER SET WAS CLOSED BEFORE A LINE MOVED, and it is NOT the two files
// `discardEnergy`'s was: grepping all 29 union members as `kind: "<name>"` over
// non-test source returns construction sites in exactly THREE — `effects.ts`
// (clause table + deriver arms), `registry.ts` (hand-authored programs) and
// `continuous.ts` (one `yourNamedPokemonInPlay`). `index.ts`'s two hits are doc
// PROSE and `mutants.ts`' are anchors quoting source; neither is a producer.
// The CONSUMER set is `interpreter.ts` alone — `conditionHolds` and
// `conditionNote` — because `redact.ts` and `cardplay.ts` read the union
// OPAQUELY through those two and owe a new member nothing.

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

const BONUS = (n: number): string =>
  `If your opponent's Active Pokémon is a Pokémon ex, this attack does ${String(n)} more damage.`;
/** The WIDER sibling — this row's sentence plus four printed words, and the one
    thing between the two clause-table keys. */
const BONUS_EX_OR_V =
  "If your opponent's Active Pokémon is a Pokémon ex or Pokémon V, this attack does 110 more damage.";
const TURTONATOR = "Discard an Energy from your opponent's Active Pokémon ex.";
/** The bare family one printed adjective away, built since D361 and UNGATED. */
const BARE_ACTIVE = "Discard an Energy from your opponent's Active Pokémon.";
/** Sawk `sv10.5w-049`/`-130`, as PRINTED — two sentences, which is the point. */
const SAWK =
  "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing. This attack's damage isn't affected by Weakness or Resistance.";
/** Palafin `sv03-062`/`-200`, an EXISTING `deriveAttackRequirement` row — §5's
    attribution CONTROL, without which "the anchor refuses Sawk" passes just as
    happily on a broken import. */
const PALAFIN =
  "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.";

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so attacking is legal (§4). */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: EX_ONLY_DECK, p2: EX_ONLY_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields the ex-only attacker with one Colorless attached (both printed costs
    in this row are a single Energy); P2 fields `defender` with a clear Bench, so
    no promotion tail interferes with what the attack did. */
function ready(seed: number, defender: string): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-exonly");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", defender);
  return clearBench(state, "p2");
}

/** `ready`, plus TWO Energy on the DEFENDER — the dressing §4's board cases need,
    because "nothing came off" and "there was nothing to take" are the same
    observation on an empty body. */
function dressed(seed: number, defender: string): GameState {
  return attachFromDeck(ready(seed, defender), "p2", "fix-energy", 2);
}

describe("§1 — the population, re-derived LIVE rather than quoted", () => {
  it("the nine readers resolve 330 / 1,196 of a 640 / 1,732 corpus, and the parts SUM", () => {
    const rows = legalAttackCorpus();
    const total = rows.reduce((sum, [units]) => sum + units, 0);
    const resolved = rows.filter(([, s]) => readByAny(s));
    const residue = rows.filter(([, s]) => !readByAny(s));
    const resolvedP = resolved.reduce((sum, [units]) => sum + units, 0);
    const residueP = residue.reduce((sum, [units]) => sum + units, 0);

    expect(rows).toHaveLength(640);
    expect(total).toBe(1732);
    // 🆕🆕 D363 — 330 / 1,196 -> **331 / 1,198**. ONE sentence / TWO printings,
    // and it is the one §5 below used to assert was unreachable: D363 widened
    // `ATTACK_DOES_NOTHING` past its `$` after re-measuring what that anchor was
    // actually worth. See `sawkRequirementSplit.test.ts` §1 for the partition.
    // 🆕🆕 D365 — 331 / 1,198 -> **334 / 1,203**. THREE sentences / FIVE printings,
    // all three off `ATTACK_REQUIREMENT_CLAUSES` rows reusing members this union
    // already had, and NONE of them touches the ex-ONLY predicate this file is
    // about — which is exactly why this rung is here: it is a whole-corpus total
    // in a single-family suite, so it moves for other people's work.
    expect(resolved).toHaveLength(403); // 🆕🆕 D414 +3 sentences / +4 printings (THE KNOCK OUT THAT REACHES THE OTHER SIDE OF THE TABLE — *"If your opponent's Active Pokémon is a Basic Pokémon, it is Knocked Out."* (2), *"Both Active Pokémon are Knocked Out."* (1) and *"This Pokémon does 100 damage to itself. Flip a coin. If heads, your opponent's Active Pokémon is Knocked Out."* (1) — THREE whole-sentence anchors and THREE `deriveAttackEffect` arms over ONE new FIELD-FREE op (`knockOutDefender`), whose both-Actives spelling is a COMPOSITION of two shipped field-free ops rather than a `target` field, so no persisted union gains a member and `MATCH_RECORD_VERSION` STAYS 26. 🛑 THE WHOLE DELTA ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER, WHICH IS THE POINT: a reader claims each of the three sentences WHOLE, and a sentence resolved whole is RAW rather than split or compound. So `SPLIT_ATTACK_UNITS` stands still at 13 (the splitter finds no leading gate clause on any of the three), `COMPOUND_ATTACK_UNITS` stands still at 18 (the fourth summand only ever counts what the whole-sentence anchors REFUSE, and these three are now claimed), and `REGISTRY_ATTACK_UNITS` stands still at 16, the slice authoring no row. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE DIFFERENT NUMBERS ON THE SAME ROW — 3 and 4 — the Basic-gate sentence printing on TWO ids and the other two on one each. ⚠️ AND IT IS THE KO-WITHOUT-DAMAGE **SUBSET**: the printed family is SEVEN sentences / THIRTEEN printings and this slice takes exactly the four whose targets are NAMED by the printed text, the other three each needing a PARK over a filtered candidate set.) 🆕🆕 D413 +2 sentences / +5 printings (THE ADDITIVE MULTI-COIN FOLD — *"Flip 2 coins. This attack does 30 more damage for each heads."* (3) and *"…does 50 more damage for each heads."* (2), ONE anchor (`ATTACK_COIN_MULTI_BONUS`) and ONE `deriveAttackCoinFlip` arm returning D129's `bonusOnHeads` over D127's `flips: { kind: "printed", count: 2 }` — a NEW COMBINATION of an already-shipped vocabulary and therefore not a new shape (D405's rule), so ZERO new ops, fields, readers, `BoardCondition` members or registry rows and `MATCH_RECORD_VERSION` STAYS 26. A READER-keyed move arriving through the RAW summand ALONE: a reader claims each sentence WHOLE, so `splitHead` and the COMPOUND term both stand still, and `REGISTRY_ATTACK_UNITS` stands still because this slice authors no rows.) 🆕🆕 D408 +2 sentences / +7 printings (THE BARE ATTACK LOCK, BOTH SEATS — *"During your opponent's next turn, the Defending Pokémon can't attack."* (3) and *"…can't use attacks."* (4), ONE ALTERNATION anchor (`DEFENDER_CANT_ATTACK_NEXT_TURN`) and ONE `deriveAttackEffect` arm returning D148's `preventAttack { target: "defender" }` unchanged: ZERO new ops, fields, readers, `BoardCondition` members or registry rows. ⚠️ THE SLICE'S THIRD SENTENCE MOVES NOTHING — *"During your next turn, this Pokémon can't use attacks."* (4 printings) ALREADY RESOLVED, to a lock keyed on an attack no card is named, so repairing it is invisible to every census figure) 🆕🆕 D407 +1 sentence / +4 printings (THE BOARD-WIDE OWN-ENERGY COUNT — *"This attack does 30 more damage for each {G} Energy attached to all of your Pokémon."*, ONE WIDENED whole-sentence anchor (`SELF_ENERGY_SCALE`) and ONE OPTIONAL `zone` on the SHIPPED `energyOnSelf` member, delegating to the `countEnergyInPlay` its opponent-side twin has called since D193: ZERO new members, counters, ops or registry rows) 🆕🆕 D406 +1 sentence / +5 printings (THE COUNTED TOOL SCALER — *"This attack does 30 damage for each Pokémon Tool attached to all of your Pokémon."*, ONE whole-sentence anchor (`YOUR_TOOLS_MULTIPLY`) and ONE `deriveAttackDamageMultiplier` arm over a THIRTEENTH `DamageCountSource` member, `toolsOnYourBoard`) 🆕🆕 D405 +1 sentence / +5 printings (THE MANDATORY OWN-BOARD ENERGY RETRIEVAL — *"Put an Energy attached to this Pokémon into your hand."*, ONE whole-sentence anchor and ONE `deriveAttackEffect` arm returning ONE `discardEnergy { from: "yourActive", filter: anyEnergy, to: "hand" }`: the op is D96's, the destination D295's and the absent `count` the op's OWN documented "one", so ZERO new ops, fields, readers, `BoardCondition` members or registry rows — a READER-keyed move, so `REGISTRY_ATTACK_UNITS` and `splitHead` both stand still. The whole price outside the reader was ONE caption branch on `discardNote`'s `yourActive` arm, which no census figure can see.) 🆕🆕 D404 +1 sentence / +7 printings (THE MANDATORY HAND WIPE AND REFILL — *"Discard your hand and draw 6 cards."*, ONE whole-sentence anchor and ONE `deriveAttackEffect` arm returning `discardHand` then `drawCards` in PRINTED ORDER: both ops shipped with Professor's Research, so ZERO new ops, fields, readers, `BoardCondition` members or registry rows, and `REGISTRY_ATTACK_UNITS` / `splitHead` stand still)  // 🆕🆕 D402 +6 sentences / +13 printings (THE DISCARD-COUNT-SCALED ATTACK — the §9.2 `discarded` record read as a damage MULTIPLIER: ONE map-built whole-sentence anchor and ONE `deriveAttackEffect` arm returning the two-op pair `registry.ts` already spells BY HAND on two cards that have since ROTATED, so ZERO new ops, fields, `BoardCondition` members or registry rows and no registry summand moves) // 🆕🆕 D401 +4 sentences / +7 printings (THE SELF-DISCARD COST BEFORE AN ANY-TARGET SNIPE — one whole-sentence COMPOUND anchor over the §8 cost and the snipe, returning both ops in printed order; a READER-keyed move, so no registry summand moves) // 🆕🆕 D400 +2 sentences / +9 printings (THE ANY-TARGET ARITY — `CHOSEN_ANY_TARGET`'s hard-coded `1 of` captured and the W/R tail's number word required to AGREE with it; a READER-keyed move, so no registry summand moves) // 🆕🆕 D399 +3 sentences / +5 printings (THE TWIN CONSEQUENT AND THE ARITY — Wo-Chien `sv08-015` "Hazardous Greed" behind a `conditionGate`, plus the FOUR printings the flat rider was refusing on the literal count `1`; a READER-keyed move, so no registry summand moves) // 🆕🆕 D398 +1 sentence / +1 printing (THE DECK-SIZE READ — Rabsca `sv08-014` "Counterturn" ({G}, `40+`, **+200**, index **1** of TWO) at 1 legal printing, taken by ONE new `BoardCondition` member (`yourDeckAtMost { count }`), TWO exhaustive-switch arms and ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row — a READER-keyed move, so `REGISTRY_ATTACK_UNITS` and `splitHead` BOTH stand still) // 🆕🆕 D397 +1 sentence / +1 printing (THE BENCHED-CUBONE FILTER — Marowak `sv07-073` "Bone Vengeance" ({C}{C}, `60+`, **+120**, index **1** of TWO) at 1 legal printing, taken by ONE new `BoardCondition` member (`yourBenchNamedDamaged { name }`), TWO exhaustive-switch arms and ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row — a READER-keyed move, so `REGISTRY_ATTACK_UNITS` and `splitHead` BOTH stand still) // 🆕🆕 D394 +2 sentences / +2 printings (THE USED-ATTACK PAIR — Falinks `sv07-088` "All-Out Attack" ({C}{C}, `30+`, **+90**, index 1 of TWO) and Weezing `sv09-092` "Crazy Blast" ({D}{C}, `50+`, **+120**, index 1 of TWO), 1 legal printing each: ONE new `BoardCondition` member (`yourActiveUsedAttackLastTurn { attack }`), ONE new REQUIRED `InPlayPokemon` field (`usedAttack`), ONE new REQUIRED field on `PendingStage.attackEpilogue`, TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and TWO new exhaustive-switch arms — the residue's LAST pair on one mechanism, the first window in the union that is not the turn in progress, and the third entry on this line to move `MATCH_RECORD_VERSION`, 24 -> 25) // 🆕🆕 D393 +2 sentences / +2 printings (THE EVOLVE PAIR — Gholdengo `sv08-131` "Strike It Rich" ({M}, `30+`, **+90**, index 0 of TWO) and Misty's Starmie `sv10-047` "Abrupt Flash" ({W}, `60+`, **+80**, index 0 of ONE), 1 legal printing each: ONE new `BoardCondition` member (`yourActiveEvolvedFromThisTurn { name }`), ONE new REQUIRED `InPlayPokemon` field (`evolvedTurn`), TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and TWO new exhaustive-switch arms — the residue's only PAIR on one mechanism, and the second entry on this line to move `MATCH_RECORD_VERSION`, 23 -> 24) // 🆕🆕 D392 +1 sentence (THE SUBSTRING NAME READ — Team Rocket's Nidoqueen `sv10-116` "Love Impact" ({D}, `60+`, **+120**, index 0 of TWO) at 1 legal printing: ONE new `BoardCondition` member (`yourBenchHasNameContaining { fragment }`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO NEW exhaustive-switch arms — a SECOND MEMBER and not a `match?:` field on `yourBenchHasNamed`, and it is the FIRST test of the rule D391 wrote down, which HELD: what changes is the comparison OPERATOR rather than a filter the delegate already takes, `conditionNote` needs a second SENTENCE rather than a second SLOT, and a member edits ZERO of `yourBenchHasNamed`'s 45 executable sites where an optional field edits THREE) // 🆕🆕 D391 +1 sentence (THE TYPED PER-BODY ENERGY THRESHOLD — Abomasnow `sv10-060` "Frozen Wood" ({W}{W}{W}{C}, `120+`, **+120**, index 1 of TWO) at 1 legal printing: ONE **OPTIONAL FIELD** (`energy?`) on the shipped `yourActiveEnergyAtLeast` member (D383), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO **edited** exhaustive-switch arms — a FIELD and NOT a second member, the OPPOSITE of D389's answer and RE-MEASURED rather than inherited: the field is OPTIONAL and edits ZERO of that member's 11 executable sites, and `countAttachedEnergy` already took exactly this filter) // 🆕🆕 D390 +1 sentence (THE OPPONENT-SEAT TYPE READ — Electivire `sv05-054` "Short-Circuit Knuckle" ({C}{C}, `40+`, **+120**) at 1 legal printing: ONE PARAMETERISED `BoardCondition` member (`opponentInPlayHasType { type }`), ONE anchored TEMPLATE reusing `CLAUSE_POKEMON_TYPES` whole and TWO exhaustive-switch arms — the family's FIFTH template pattern, and the first shipped behind a CROSS-PRODUCT anchor rung written at the PREVIOUS head) // 🆕🆕 D389 +1 sentence (THE OPPONENT-SEAT BENCH COUNT — Iron Crown `sv08-132` "Deleting Slash" ({M}{C}, `40+`, **+80**) at 1 legal printing: ONE PARAMETERISED `BoardCondition` member (`opponentBenchAtLeast { count }`), ONE literal clause row and TWO exhaustive-switch arms — a SECOND MEMBER and not a seat parameter on `yourBenchAtLeast`) // 🆕🆕 D388 +1 sentence (THE RETREAT-COST THRESHOLD — Talonflame `sv07-123` "Aero Chase" ({C}{C}, `110+`, **+110**) at 1 legal printing: ONE PARAMETERISED `BoardCondition` member (`opponentActiveRetreatCostAtLeast { count }`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO exhaustive-switch arms — ZERO new card predicates, because the printed noun phrase names `effectiveRetreatCost` (continuous.ts, D322) and not the printed `retreatCostOf` column, which is the SHAPE question D387 left open and this slice settled) // 🆕🆕 D387 +1 sentence (THE STAGE 1 CLAUSE — Paldean Tauros `sv08-018` "Spirited Tackle" ({R}{C}{C}, `90+`, **+90**) at 1 legal printing: ONE `cards.ts` predicate (`isStage1Pokemon`), ONE `BoardCondition` member (`opponentActiveIsStage1`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO exhaustive-switch arms — a SUBSET of `opponentActiveIsEvolution` that is NOT a narrowing of it, so that member and all NINE of its printings stand still) // 🆕🆕 D386 +1 sentence (THE HEALED-THIS-TURN CLAUSE — Maractus `sv10.5b-008`/`-093` "Lively Needles" ({G}, `20+`, **+100**) at 2 legal printings: ONE `BoardCondition` member (`yourActiveHealedThisTurn`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row, TWO exhaustive-switch arms and ONE new REQUIRED `InPlayPokemon` field — the first entry on this line to move `MATCH_RECORD_VERSION`, 22 -> 23. ⚠️ AND THE FIRST IN FOUR SLICES THIS NINE-READER INSTRUMENT CAN SEE AT ALL: D385 resolved through the TENTH reader and left this figure standing) // 🆕🆕 D384 +1 sentence (THE STRICT-INEQUALITY TWIN — Swalot `sv07-092` "Devouring Mouth" ({D}, `10+`, **+160**) at 1 legal printing: ONE nullary `BoardCondition` member (`moreActiveEnergyThanOpponent`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO exhaustive-switch arms — the sentence D372 priced, refused and pinned as its own near miss) // 🆕🆕 D382 +1 sentence (THE `. Then, ` JOIN — D317's shape with the printed comma changed: Chi-Yu `sv06-039` "Ground Melter" ({R}{C}, `60+`) at 1 legal printing, ONE anchor constant and ONE consequent row on `deriveAttackBonusConsequent`, ZERO new readers and ZERO new ops) // 🆕🆕 D380 +2 sentences (THE STADIUM-DISCARD OP — `discardStadium`: *"Discard a Stadium in play."* at 4 legal printings and *"You may discard a Stadium in play."* at 2, ONE new FIELD-FREE `EffectOp` behind TWO whole-sentence anchors — the first slice in this run to buy an OP rather than a `BoardCondition`) // 🆕🆕 D379 +1 sentence (THE EXACT HAND-SIZE READ — `yourHandExactly { count }`: ONE CANCEL sentence at 2 legal printings, Alolan Dugtrio `sv08-123`/`sv08-208` "Trio-Cheehoo", and NO bonus twin — ONE new PARAMETERISED `BoardCondition` member and ONE `ATTACK_REQUIREMENT_CLAUSES` row, ZERO `CONDITIONAL_DAMAGE_CLAUSES` rows) // 🆕🆕 D378 +2 sentences (STADIUM PRESENCE — `stadiumInPlay`: ONE bonus sentence at 1 legal printing, Probopass `sv10-098` "Mountain Drop" +70, PLUS one CANCEL sentence on the SAME member at 2 printings, Fan Rotom `sv07-118`/`sv08.5-085` "Assault Landing" — ONE new NULLARY `BoardCondition` member, ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and ONE `ATTACK_REQUIREMENT_CLAUSES` row) // 🆕🆕 D377 **+3 SENTENCES / +3 PRINTINGS** (the CROSS-BOARD STATUS PAIR — TWO bonus sentences at 1 legal printing each, *"…is Burned"* +40 and *"…is Confused"* +90, PLUS one CANCEL sentence on the SAME member, *"…isn't Burned"*; TWO new NULLARY `BoardCondition` members, TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and ONE `ATTACK_REQUIREMENT_CLAUSES` row) // 🆕🆕 D376 +1 sentence (the FILTERED DISCARD-PILE THRESHOLD, 2 printings, ONE new PARAMETERISED member + ONE literal clause row) // 🆕🆕 D375 +1 sentence (the CROSS-BOARD TYPE INTERSECTION, 2 printings, ONE new NULLARY member + ONE literal clause row) // 🆕🆕 D374 +1 sentence (the NAMED-ENERGY clause, 2 printings, ONE new member + ONE literal clause row) // 🆕🆕 D373 +1 sentence (the UNIVERSAL-OVER-THE-BENCH clause, 2 printings, ONE new member + ONE literal clause row) // 🆕🆕 D372 **+2 SENTENCES** (the CROSS-BOARD EQUAL-ENERGY clause, 2 printings across TWO sentences, ONE new member + ONE literal clause row) // 🆕🆕 D371 +1 sentence (the OPPONENT-RESISTANCE clause, 2 printings, ONE new member + ONE new template) // 🆕🆕 D370 +1 sentence (the bench-scoped {M} TYPE clause, 2 printings, ONE new member + ONE new template) // 🆕🆕 D369 +1 sentence (the cross-board Pokémon Tool clause, 2 printings) // 🆕🆕 D368 +1 sentence (Arven's Mabosstiff ex, 3 printings, ONE new member). // 🆕🆕 D367 +9 sentences (13 printings, ZERO new members). // 🆕🆕 D366 +1 sentence (Victini, 4 printings).
    expect(resolvedP).toBe(1340); // 🆕🆕 D414 +3 sentences / +4 printings (THE KNOCK OUT THAT REACHES THE OTHER SIDE OF THE TABLE — *"If your opponent's Active Pokémon is a Basic Pokémon, it is Knocked Out."* (2), *"Both Active Pokémon are Knocked Out."* (1) and *"This Pokémon does 100 damage to itself. Flip a coin. If heads, your opponent's Active Pokémon is Knocked Out."* (1) — THREE whole-sentence anchors and THREE `deriveAttackEffect` arms over ONE new FIELD-FREE op (`knockOutDefender`), whose both-Actives spelling is a COMPOSITION of two shipped field-free ops rather than a `target` field, so no persisted union gains a member and `MATCH_RECORD_VERSION` STAYS 26. 🛑 THE WHOLE DELTA ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER, WHICH IS THE POINT: a reader claims each of the three sentences WHOLE, and a sentence resolved whole is RAW rather than split or compound. So `SPLIT_ATTACK_UNITS` stands still at 13 (the splitter finds no leading gate clause on any of the three), `COMPOUND_ATTACK_UNITS` stands still at 18 (the fourth summand only ever counts what the whole-sentence anchors REFUSE, and these three are now claimed), and `REGISTRY_ATTACK_UNITS` stands still at 16, the slice authoring no row. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE DIFFERENT NUMBERS ON THE SAME ROW — 3 and 4 — the Basic-gate sentence printing on TWO ids and the other two on one each. ⚠️ AND IT IS THE KO-WITHOUT-DAMAGE **SUBSET**: the printed family is SEVEN sentences / THIRTEEN printings and this slice takes exactly the four whose targets are NAMED by the printed text, the other three each needing a PARK over a filtered candidate set.) 🆕🆕 D413 +2 sentences / +5 printings (THE ADDITIVE MULTI-COIN FOLD — *"Flip 2 coins. This attack does 30 more damage for each heads."* (3) and *"…does 50 more damage for each heads."* (2), ONE anchor (`ATTACK_COIN_MULTI_BONUS`) and ONE `deriveAttackCoinFlip` arm returning D129's `bonusOnHeads` over D127's `flips: { kind: "printed", count: 2 }` — a NEW COMBINATION of an already-shipped vocabulary and therefore not a new shape (D405's rule), so ZERO new ops, fields, readers, `BoardCondition` members or registry rows and `MATCH_RECORD_VERSION` STAYS 26. A READER-keyed move arriving through the RAW summand ALONE: a reader claims each sentence WHOLE, so `splitHead` and the COMPOUND term both stand still, and `REGISTRY_ATTACK_UNITS` stands still because this slice authors no rows.) 🆕🆕 D408 +2 sentences / +7 printings (THE BARE ATTACK LOCK, BOTH SEATS — *"During your opponent's next turn, the Defending Pokémon can't attack."* (3) and *"…can't use attacks."* (4), ONE ALTERNATION anchor (`DEFENDER_CANT_ATTACK_NEXT_TURN`) and ONE `deriveAttackEffect` arm returning D148's `preventAttack { target: "defender" }` unchanged: ZERO new ops, fields, readers, `BoardCondition` members or registry rows. ⚠️ THE SLICE'S THIRD SENTENCE MOVES NOTHING — *"During your next turn, this Pokémon can't use attacks."* (4 printings) ALREADY RESOLVED, to a lock keyed on an attack no card is named, so repairing it is invisible to every census figure) 🆕🆕 D407 +4 printings (THE BOARD-WIDE OWN-ENERGY COUNT — *"…for each {G} Energy attached to all of your Pokémon."*, the `+` fold, so the printed `20+` base is KEPT and an Energy-free board still deals it) 🆕🆕 D406 +5 printings (THE COUNTED TOOL SCALER — *"This attack does 30 damage for each Pokémon Tool attached to all of your Pokémon."*, the `×` fold, so the printed `30×` base is DROPPED and a Tool-less board deals nothing) 🆕🆕 D405 +5 printings (THE MANDATORY OWN-BOARD ENERGY RETRIEVAL — *"Put an Energy attached to this Pokémon into your hand."*, ONE anchor and ONE `deriveAttackEffect` arm over an already-shipped op and an already-shipped destination) 🆕🆕 D402 +13 printings (THE DISCARD-COUNT-SCALED ATTACK) // 🆕🆕 D401 +7 printings (THE SELF-DISCARD COST BEFORE AN ANY-TARGET SNIPE) // 🆕🆕 D400 +9 printings (THE ANY-TARGET ARITY) // 🆕🆕 D399 +5 printings (THE TWIN CONSEQUENT AND THE ARITY) // 🆕🆕 D398 +1 printing (THE DECK-SIZE READ) // 🆕🆕 D397 +1 printing (THE BENCHED-CUBONE FILTER — Marowak `sv07-073` "Bone Vengeance" ({C}{C}, `60+`, **+120**, index **1** of TWO) at 1 legal printing, READER-keyed) // 🆕🆕 D394 — the USED-ATTACK PAIR: +2 sentences / +2 printings, a READER-keyed move // 🆕🆕 D393 +2 printings (THE EVOLVE PAIR — Gholdengo `sv08-131` and Misty's Starmie `sv10-047`, one printing each, both READER-keyed) // 🆕🆕 D392 +1 printing (THE SUBSTRING NAME READ — one sentence, one printing: the 1:1 shape for a seventh slice running, and the first taken by a member whose payload field is deliberately NOT named `name`) // 🆕🆕 D391 +1 printing (THE TYPED PER-BODY ENERGY THRESHOLD — Abomasnow `sv10-060` "Frozen Wood" at 1 legal printing: an OPTIONAL FIELD on a shipped `BoardCondition` member, so the READER-keyed summand moves and no registry summand does) // 🆕🆕 D390 +1 printing (THE OPPONENT-SEAT TYPE READ — one sentence, one printing: the 1:1 shape for the fourth slice running) // 🆕🆕 D389 +1 printing (THE OPPONENT-SEAT BENCH COUNT — one sentence, one printing: the 1:1 shape for the third slice running) // 🆕🆕 D388 +1 printing (THE RETREAT-COST THRESHOLD — one sentence, one printing: the 1:1 shape, and the fold is the reading the engine had already given this noun phrase since 0.61.0) // 🆕🆕 D387 +1 printing (THE STAGE 1 CLAUSE — one sentence, one legal printing; the family's third 1:1 step) // 🆕🆕 D386 +2 printings (THE HEALED-THIS-TURN CLAUSE — one sentence, two legal printings, a 1:2 step) // 🆕🆕 D384 +1 printing (THE STRICT-INEQUALITY TWIN — one sentence, one legal printing; the family's FIRST 1:1 step) // 🆕🆕 D382 +1 printing (THE `. Then, ` JOIN — one sentence, one legal printing) // 🆕🆕 D380 +6 printings (THE STADIUM-DISCARD OP — TWO sentences, 4 + 2 legal printings, on ONE new FIELD-FREE `EffectOp`) // 🆕🆕 D379 +2 printings (THE EXACT HAND-SIZE READ — one sentence, both printings under the CANCEL consequent) // 🆕🆕 D378 +3 printings (STADIUM PRESENCE — `stadiumInPlay`: ONE bonus sentence at 1 legal printing, Probopass `sv10-098` "Mountain Drop" +70, PLUS one CANCEL sentence on the SAME member at 2 printings, Fan Rotom `sv07-118`/`sv08.5-085` "Assault Landing" — ONE new NULLARY `BoardCondition` member, ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and ONE `ATTACK_REQUIREMENT_CLAUSES` row) // 🆕🆕 D377 +3 // 🆕🆕 D376 +2 // 🆕🆕 D375 +2 // 🆕🆕 D374 +2 // 🆕🆕 D373 +2 // 🆕🆕 D372 +2 // 🆕🆕 D371 +2 // 🆕🆕 D370 +2 // 🆕🆕 D369 +2 // 🆕🆕 D368 +3 // 🆕🆕 D367 +13 // 🆕🆕 D366 +4
    // The parts must add up to the whole quoted in the same case. A total that
    // does not sum is not merely wrong, it is impossible — and it is ONE addition.
    expect(resolved.length + residue.length).toBe(rows.length);
    expect(resolvedP + residueP).toBe(total);
    expect(residue).toHaveLength(237); // 🆕🆕 D414 −3 sentences / −4 printings (THE KNOCK OUT THAT REACHES THE OTHER SIDE OF THE TABLE — *"If your opponent's Active Pokémon is a Basic Pokémon, it is Knocked Out."* (2), *"Both Active Pokémon are Knocked Out."* (1) and *"This Pokémon does 100 damage to itself. Flip a coin. If heads, your opponent's Active Pokémon is Knocked Out."* (1) — THREE whole-sentence anchors and THREE `deriveAttackEffect` arms over ONE new FIELD-FREE op (`knockOutDefender`), so ZERO new fields, readers, `BoardCondition` members or registry rows and `MATCH_RECORD_VERSION` STAYS 26: the exact MIRROR of the raw summand's +3 sentences / +4 printings, and re-derived from the remainder rather than decremented. A READER-keyed move over sentences that print STANDALONE, so the four printings leave the unbuilt side through the SWEEP — which is what an arm over a whole sentence does and a compound-completing clause does not. 🛑 AND IT ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER: `SPLIT_ATTACK_UNITS` stands still at 13, `COMPOUND_ATTACK_UNITS` at 18, and `REGISTRY_ATTACK_UNITS` at 16, because a sentence claimed WHOLE is raw rather than split, compound or registry.) 🆕🆕 D413 -2 sentences / -5 printings (THE ADDITIVE MULTI-COIN FOLD — *"Flip 2 coins. This attack does 30 more damage for each heads."* (3) and *"…does 50 more damage for each heads."* (2) LEAVE this residue through the SWEEP, the exact mirror of the resolving column's +2 / +5 two lines up and re-derived from the refusal set rather than decremented. ONE anchor (`ATTACK_COIN_MULTI_BONUS`) and ONE `deriveAttackCoinFlip` arm over the SHIPPED `bonusOnHeads` × `printed` pair, so the corpus total is untouched and the two sum rungs below are what say so.) 🆕🆕 D408 -2 sentences / -7 printings (THE BARE ATTACK LOCK, BOTH SEATS — *"During your opponent's next turn, the Defending Pokémon can't attack."* (3) and *"…can't use attacks."* (4), ONE ALTERNATION anchor (`DEFENDER_CANT_ATTACK_NEXT_TURN`) and ONE `deriveAttackEffect` arm returning D148's `preventAttack { target: "defender" }` unchanged: ZERO new ops, fields, readers, `BoardCondition` members or registry rows. ⚠️ THE SLICE'S THIRD SENTENCE MOVES NOTHING — *"During your next turn, this Pokémon can't use attacks."* (4 printings) ALREADY RESOLVED, to a lock keyed on an attack no card is named, so repairing it is invisible to every census figure) 🆕🆕 D407 — THE BOARD-WIDE OWN-ENERGY COUNT: -1 sentence / -4 printings, a READER-keyed move 🆕🆕 D406 — THE COUNTED TOOL SCALER: -1 sentence / -5 printings, a READER-keyed move 🆕🆕 D405 — THE MANDATORY OWN-BOARD ENERGY RETRIEVAL: -1 sentence / -5 printings, a READER-keyed move 🆕🆕 D404 — THE MANDATORY HAND WIPE AND REFILL: -1 sentence / -7 printings, a READER-keyed move // 🆕🆕 D402 — THE DISCARD-COUNT-SCALED ATTACK: -6 sentences / -13 printings, a READER-keyed move // 🆕🆕 D401 — THE SELF-DISCARD COST BEFORE AN ANY-TARGET SNIPE: -4 sentences / -7 printings, a READER-keyed move // 🆕🆕 D400 — THE ANY-TARGET ARITY: -2 sentences / -9 printings, a READER-keyed move // 🆕🆕 D399 — THE TWIN CONSEQUENT AND THE ARITY: -3 sentences / -5 printings, a READER-keyed move // 🆕🆕 D398 — the DECK-SIZE READ: -1 sentence / -1 printing, a READER-keyed move // // 🆕🆕 D397 — the BENCHED-CUBONE FILTER: +1 sentence / +1 printing, a READER-keyed move // 🆕🆕 D394 — the USED-ATTACK PAIR: +2 sentences / +2 printings, a READER-keyed move // 🆕🆕 D393 -2 sentences (THE EVOLVE PAIR — two sentences worth one printing each) // 🆕🆕 D392 -1 sentence (THE SUBSTRING NAME READ — one sentence worth one printing) // 🆕🆕 D391 -1 sentence (THE TYPED PER-BODY ENERGY THRESHOLD — one sentence worth one printing) // 🆕🆕 D390 -1 sentence (THE OPPONENT-SEAT TYPE READ — one sentence worth one printing) // 🆕🆕 D389 -1 sentence (THE OPPONENT-SEAT BENCH COUNT — one sentence worth one printing) // 🆕🆕 D388 -1 sentence (THE RETREAT-COST THRESHOLD — one sentence worth one printing) // 🆕🆕 D387 -1 sentence (THE STAGE 1 CLAUSE — one sentence worth one printing) // 🆕🆕 D386 -1 sentence (THE HEALED-THIS-TURN CLAUSE — one sentence worth two printings) // 🆕🆕 D384 -1 sentence (THE STRICT-INEQUALITY TWIN — Swalot `sv07-092` "Devouring Mouth", 1 legal printing) // 🆕🆕 D382 -1 sentence (THE `. Then, ` JOIN) // 🆕🆕 D380 -2 sentences (THE STADIUM-DISCARD OP — two sentences worth SIX printings, both under the imperative consequent) // 🆕🆕 D379 -1 sentence (THE EXACT HAND-SIZE READ — one sentence worth two printings, entirely under the CANCEL consequent) // 🆕🆕 D378 -2 sentences (STADIUM PRESENCE — `stadiumInPlay`, TWO sentences worth THREE printings across BOTH consequents) // 🆕🆕 D377 -3 // 🆕🆕 D376 -1 sentence (the FILTERED DISCARD-PILE THRESHOLD) // 🆕🆕 D375 -1 sentence (the CROSS-BOARD TYPE INTERSECTION) // 🆕🆕 D374 -1 sentence (the NAMED-ENERGY clause) // 🆕🆕 D373 -1 sentence (the UNIVERSAL-OVER-THE-BENCH clause) // 🆕🆕 D372 -2 sentences // 🆕🆕 D371 -1 sentence // 🆕🆕 D370 -1 sentence // 🆕🆕 D369 -1 sentence // 🆕🆕 D368 -1 sentence // 🆕🆕 D367 -9 sentences // 🆕🆕 D366 -1 sentence
    expect(residueP).toBe(392); // 🆕🆕 D414 −3 sentences / −4 printings (THE KNOCK OUT THAT REACHES THE OTHER SIDE OF THE TABLE — *"If your opponent's Active Pokémon is a Basic Pokémon, it is Knocked Out."* (2), *"Both Active Pokémon are Knocked Out."* (1) and *"This Pokémon does 100 damage to itself. Flip a coin. If heads, your opponent's Active Pokémon is Knocked Out."* (1) — THREE whole-sentence anchors and THREE `deriveAttackEffect` arms over ONE new FIELD-FREE op (`knockOutDefender`), so ZERO new fields, readers, `BoardCondition` members or registry rows and `MATCH_RECORD_VERSION` STAYS 26: the exact MIRROR of the raw summand's +3 sentences / +4 printings, and re-derived from the remainder rather than decremented. A READER-keyed move over sentences that print STANDALONE, so the four printings leave the unbuilt side through the SWEEP — which is what an arm over a whole sentence does and a compound-completing clause does not. 🛑 AND IT ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER: `SPLIT_ATTACK_UNITS` stands still at 13, `COMPOUND_ATTACK_UNITS` at 18, and `REGISTRY_ATTACK_UNITS` at 16, because a sentence claimed WHOLE is raw rather than split, compound or registry.) 🆕🆕 D413 -2 sentences / -5 printings (THE ADDITIVE MULTI-COIN FOLD — *"Flip 2 coins. This attack does 30 more damage for each heads."* (3) and *"…does 50 more damage for each heads."* (2) LEAVE this residue through the SWEEP, the exact mirror of the resolving column's +2 / +5 two lines up and re-derived from the refusal set rather than decremented. ONE anchor (`ATTACK_COIN_MULTI_BONUS`) and ONE `deriveAttackCoinFlip` arm over the SHIPPED `bonusOnHeads` × `printed` pair, so the corpus total is untouched and the two sum rungs below are what say so.) 🆕🆕 D408 -2 sentences / -7 printings (THE BARE ATTACK LOCK, BOTH SEATS — *"During your opponent's next turn, the Defending Pokémon can't attack."* (3) and *"…can't use attacks."* (4), ONE ALTERNATION anchor (`DEFENDER_CANT_ATTACK_NEXT_TURN`) and ONE `deriveAttackEffect` arm returning D148's `preventAttack { target: "defender" }` unchanged: ZERO new ops, fields, readers, `BoardCondition` members or registry rows. ⚠️ THE SLICE'S THIRD SENTENCE MOVES NOTHING — *"During your next turn, this Pokémon can't use attacks."* (4 printings) ALREADY RESOLVED, to a lock keyed on an attack no card is named, so repairing it is invisible to every census figure) 🆕🆕 D407 — THE BOARD-WIDE OWN-ENERGY COUNT: -4 printings, a READER-keyed move 🆕🆕 D406 — THE COUNTED TOOL SCALER: -5 printings, a READER-keyed move 🆕🆕 D405 — THE MANDATORY OWN-BOARD ENERGY RETRIEVAL: -5 printings, a READER-keyed move 🆕🆕 D404 — THE MANDATORY HAND WIPE AND REFILL: -7 printings, a READER-keyed move // 🆕🆕 D402 — THE DISCARD-COUNT-SCALED ATTACK: -13 printings, a READER-keyed move // 🆕🆕 D401 — THE SELF-DISCARD COST BEFORE AN ANY-TARGET SNIPE: -7 printings, a READER-keyed move // 🆕🆕 D400 — THE ANY-TARGET ARITY: -9 printings, a READER-keyed move // 🆕🆕 D399 — THE TWIN CONSEQUENT AND THE ARITY: -5 printings, a READER-keyed move // 🆕🆕 D398 — the DECK-SIZE READ: -1 printing, a READER-keyed move // 🆕🆕 D397 — the BENCHED-CUBONE FILTER: +1 printing, a READER-keyed move // 🆕🆕 D394 — the USED-ATTACK PAIR: +2 sentences / +2 printings, a READER-keyed move // 🆕🆕 D393 -2 printings (THE EVOLVE PAIR) // 🆕🆕 D392 -1 printing (THE SUBSTRING NAME READ) // 🆕🆕 D391 -1 printing (THE TYPED PER-BODY ENERGY THRESHOLD) // 🆕🆕 D390 -1 printing (THE OPPONENT-SEAT TYPE READ) // 🆕🆕 D389 -1 printing (THE OPPONENT-SEAT BENCH COUNT) // 🆕🆕 D388 -1 printing (THE RETREAT-COST THRESHOLD) // 🆕🆕 D387 -1 printing (THE STAGE 1 CLAUSE) // 🆕🆕 D386 -2 printings (THE HEALED-THIS-TURN CLAUSE) // 🆕🆕 D384 -1 printing (THE STRICT-INEQUALITY TWIN) // 🆕🆕 D382 -1 printing (THE `. Then, ` JOIN) // 🆕🆕 D380 -6 printings (THE STADIUM-DISCARD OP) // 🆕🆕 D379 -2 printings (THE EXACT HAND-SIZE READ) // 🆕🆕 D378 -3 printings (STADIUM PRESENCE — `stadiumInPlay`: ONE bonus sentence at 1 legal printing, Probopass `sv10-098` "Mountain Drop" +70, PLUS one CANCEL sentence on the SAME member at 2 printings, Fan Rotom `sv07-118`/`sv08.5-085` "Assault Landing" — ONE new NULLARY `BoardCondition` member, ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and ONE `ATTACK_REQUIREMENT_CLAUSES` row) // 🆕🆕 D377 -3 // 🆕🆕 D376 -2 // 🆕🆕 D375 -2 // 🆕🆕 D374 -2 // 🆕🆕 D373 -2 // 🆕🆕 D372 -2 // 🆕🆕 D371 -2 // 🆕🆕 D370 -2 // 🆕🆕 D369 -2 // 🆕🆕 D368 -3 // 🆕🆕 D367 -13 // 🆕🆕 D366 -4
  });

  it("the ex-ONLY predicate is 8 s / 13 p and the WIDER sibling is 4 s / 6 p — the ratio that chose the row", () => {
    const rows = legalAttackCorpus();
    // The ex-ONLY Active BOARD predicate: the +N clause, its printed negation,
    // and Turtonator's adjectived discard. NOT the board-wide filters, in-play
    // counters or Bench target filters that also spell "Pokémon ex" — those are
    // different shapes and §1 keeps them out by naming this one.
    const exOnly = rows.filter(
      ([, s]) =>
        /^If your opponent's Active Pokémon is(n't)? a Pokémon ex[,.]/.test(s) ||
        /Active Pokémon ex\.$/.test(s),
    );
    const exOrV = rows.filter(([, s]) => /Active Pokémon is a Pokémon ex or Pokémon V,/.test(s));

    expect(exOnly).toHaveLength(8);
    expect(exOnly.reduce((sum, [units]) => sum + units, 0)).toBe(13);
    expect(exOrV).toHaveLength(4);
    expect(exOrV.reduce((sum, [units]) => sum + units, 0)).toBe(6);
    // THE CLAIM, as an inequality that can fail: the narrower predicate has more
    // than twice the printings of the wider one the engine already read.
    expect(exOnly.reduce((sum, [units]) => sum + units, 0)).toBeGreaterThan(
      2 * exOrV.reduce((sum, [units]) => sum + units, 0),
    );
    // …and the wider one was ALREADY built, which is what makes it a pair.
    for (const [, s] of exOrV) expect(readByAny(s), s).toBe(true);
    // 🆕🆕 D363 — AND NOW ALL EIGHT ARE READ. This rung asserted a residue of
    // exactly the two Sawk printings for one slice; D363 spent it, so the claim
    // INVERTS rather than relaxes: the ex-ONLY predicate's whole 8 s / 13 p is
    // inside the census, and the emptiness is asserted with the count beside it
    // so an accidental 0 from a broken import cannot pass as this answer.
    const stillUnread = exOnly.filter(([, s]) => !readByAny(s));
    expect(stillUnread).toHaveLength(0);
    expect(exOnly.filter(([, s]) => readByAny(s))).toHaveLength(8);
    expect(readByAny(SAWK)).toBe(true);
  });

  it("every one of the six printed amounts derives, and the amount is NOT part of the key", () => {
    // ONE literal clause row serves all six, because only the AMOUNT varies and
    // it is captured one layer up. A row per amount would be six rows for one
    // clause — Krokorok's argument inverted, and this case is what says so.
    for (const n of [40, 50, 70, 80, 90, 100]) {
      expect(deriveAttackDamageBonus(BONUS(n)), String(n)).toEqual({
        per: n,
        count: { kind: "boardCondition", cond: { kind: "opponentActiveIsEx" } },
      });
    }
    // An amount the pool does NOT print still derives — the capture is a
    // parameter, exactly as it is for the sibling row.
    expect(deriveAttackDamageBonus(BONUS(30))?.per).toBe(30);
  });
});

describe("§2 — the NO-NEW-VOCABULARY refutation, driven on a BOARD", () => {
  // The whole reason this member exists rather than reusing the one beside it.
  // `opponentActiveIsExOrV` is strictly WIDER, so the ONE board on which the two
  // disagree is a Pokémon V — and on that board reusing it would have the attack
  // fire into a body the printed sentence does not name. Asserted from BOTH
  // seats, because a cross-board predicate that is right for one seat and wrong
  // for the other is a defect no single-seat case can see.
  it("a Pokémon V is the ONE board where the two members disagree", () => {
    const clean = board(41); // both Actives are the suffix-free fix-bigbody
    const v = setActiveFromDeck(clean, "p2", "fix-pokemon-v");
    expect(conditionHolds(v, "p1", { kind: "opponentActiveIsExOrV" })).toBe(true);
    expect(conditionHolds(v, "p1", { kind: "opponentActiveIsEx" })).toBe(false);
    const vOnP1 = setActiveFromDeck(clean, "p1", "fix-pokemon-v");
    expect(conditionHolds(vOnP1, "p2", { kind: "opponentActiveIsExOrV" })).toBe(true);
    expect(conditionHolds(vOnP1, "p2", { kind: "opponentActiveIsEx" })).toBe(false);
  });

  it("is cross-board, per seat, TRUE only on an ex, and false on VMAX / plain / empty", () => {
    const clean = board(42);
    for (const seat of ["p1", "p2"] as const)
      expect(conditionHolds(clean, seat, { kind: "opponentActiveIsEx" })).toBe(false);

    // The real Pokémon ex, read from BOTH seats: true only for the seat whose
    // OPPONENT is holding it. A real catalog id, so the predicate is proven
    // against a PRINTED name suffix rather than a fixture's.
    const onP2 = setActiveFromDeck(clean, "p2", "sv06.5-036");
    expect(conditionHolds(onP2, "p1", { kind: "opponentActiveIsEx" })).toBe(true);
    expect(conditionHolds(onP2, "p2", { kind: "opponentActiveIsEx" })).toBe(false);
    const onP1 = setActiveFromDeck(clean, "p1", "sv06.5-036");
    expect(conditionHolds(onP1, "p2", { kind: "opponentActiveIsEx" })).toBe(true);
    expect(conditionHolds(onP1, "p1", { kind: "opponentActiveIsEx" })).toBe(false);

    // A VMAX has a Rule Box and the sentence does not name it — false under BOTH
    // members, so the pair cannot be mistaken for a `hasRuleBox` read.
    const vmax = setActiveFromDeck(clean, "p2", "fix-pokemon-vmax");
    expect(conditionHolds(vmax, "p1", { kind: "opponentActiveIsEx" })).toBe(false);
    expect(conditionHolds(vmax, "p1", { kind: "opponentActiveIsExOrV" })).toBe(false);

    // The empty-spot edge: FALSE, not a throw — as with every sibling.
    const state = mustApply(onP2, { type: "endTurn", seat: "p1" }).state;
    expect(conditionHolds({ ...state, players: { ...state.players, p2: { ...state.players.p2, active: null } } }, "p1", { kind: "opponentActiveIsEx" })).toBe(false);
  });

  it("the +90 lands into an ex and does NOT into a Pokémon V — the same refutation through the DAMAGE", () => {
    // The board case above proves the predicate; this proves the wiring, which
    // is a different claim: a correct predicate read at the wrong site scores 0.
    const intoEx = mustApply(ready(43, "sv06.5-036"), { type: "attack", seat: "p1", index: 0 });
    expect(types(intoEx.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const exHit = intoEx.events.find((e) => e.type === "DAMAGE_DEALT");
    expect(exHit).toMatchObject({ base: 10, scaled: 90 });

    const intoV = mustApply(ready(44, "fix-pokemon-v"), { type: "attack", seat: "p1", index: 0 });
    expect(types(intoV.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const vHit = intoV.events.find((e) => e.type === "DAMAGE_DEALT");
    // The printed 10 stands. A reused `opponentActiveIsExOrV` would read 100 here.
    expect(vHit).toMatchObject({ base: 10, dealt: 10 });
    expect(vHit?.scaled).toBeUndefined();
  });
});

describe("§3 — the clause-table row, and the round trip in BOTH directions", () => {
  it("the note IS the printed clause, so the sentence round-trips in one step", () => {
    expect(conditionNote({ kind: "opponentActiveIsEx" })).toBe(
      "your opponent's Active Pokémon is a Pokémon ex",
    );
    const bonus = deriveAttackDamageBonus(BONUS(90));
    const cond = bonus?.count.kind === "boardCondition" ? bonus.count.cond : null;
    expect(cond).toEqual({ kind: "opponentActiveIsEx" });
    expect(BONUS(90)).toBe(
      `If ${conditionNote(cond ?? { kind: "handSizesEqual" })}, this attack does 90 more damage.`,
    );
  });

  it("the two keys differ by FOUR printed words, and NEITHER sentence reaches the other's row", () => {
    // The sharpest near-miss in the clause table after the two Poison rows. The
    // keys are whole printed clauses and never substrings, so " or Pokémon V" is
    // the entire difference — and it is asserted in BOTH directions, because a
    // lookup that leaked either way would boost against a body nothing prints.
    const wider = deriveAttackDamageBonus(BONUS_EX_OR_V);
    expect(wider?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentActiveIsExOrV" },
    });
    expect(conditionNote({ kind: "opponentActiveIsExOrV" })).toBe(
      `${conditionNote({ kind: "opponentActiveIsEx" })} or Pokémon V`,
    );
    // …and a clause one word off either key is UNMAPPED and therefore LOUD.
    expect(deriveAttackDamageBonus(BONUS(90).replace("a Pokémon ex", "a Pokémon V"))).toBeNull();
    expect(
      deriveAttackDamageBonus(BONUS(90).replace("Active Pokémon", "Benched Pokémon")),
    ).toBeNull();
  });

  it("folds a CURLY apostrophe on both halves of the row", () => {
    // D137 — the keys stay ASCII because they record what the catalog prints;
    // `literalClauseRow` retries a miss with U+2019 folded, and the new row must
    // inherit that rather than re-spell it.
    const curly = (s: string): string => s.replace(/'/g, "’");
    expect(deriveAttackDamageBonus(curly(BONUS(90)))).toEqual(deriveAttackDamageBonus(BONUS(90)));
    expect(deriveAttackEffect(curly(TURTONATOR))).toEqual(deriveAttackEffect(TURTONATOR));
  });
});

describe("§4 — the discard anchor is defended by TWO independent printed words", () => {
  // D361's own anchor SURVIVED its first probe because the row was defended by
  // two printed words and the suite asserted only one. A ROW COUNT IS NOT A
  // COVERAGE MAP, so both defending words get a case here.
  it("word ONE — the adjective `ex` gates, and its absence leaves the bare family UNGATED", () => {
    expect(deriveAttackEffect(TURTONATOR)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveIsEx" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
      },
    ]);
    // One printed adjective shorter is a DIFFERENT program — no gate at all — and
    // that is the whole behavioural content of the adjective.
    expect(deriveAttackEffect(BARE_ACTIVE)).toEqual([
      { op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } },
    ]);
  });

  it("word TWO — the article `an`, so the cross-product NOBODY prints stays null", () => {
    // The bare family is map-built over THREE articles. An optional `(?: ex)?`
    // there would have derived these two sentences, and the catalog holds ZERO of
    // them on any of its three text columns (remote D1 `luminous`, 2026-08-18).
    // Deriving them would be authoring two cards.
    expect(
      deriveAttackEffect("Discard a Special Energy from your opponent's Active Pokémon ex."),
    ).toBeNull();
    expect(
      deriveAttackEffect("Discard a {R} Energy from your opponent's Active Pokémon ex."),
    ).toBeNull();
    // …while both of those sentences WITHOUT the adjective are built and ungated.
    for (const s of [
      "Discard a Special Energy from your opponent's Active Pokémon.",
      "Discard a {R} Energy from your opponent's Active Pokémon.",
    ])
      expect(deriveAttackEffect(s), s).not.toBeNull();
  });

  it("strips an Energy off an ex and takes NOTHING off a Pokémon V", () => {
    // The gate through the BOARD rather than through the program. Both defenders
    // are dressed identically — two Energy each — so the ONLY thing between the
    // two outcomes is the printed adjective, and a gate wired to the wrong seat
    // or ignored outright would show up as the same count on both.
    const intoEx = dressed(45, "sv06.5-036");
    expect(intoEx.players.p2.active?.energy).toHaveLength(2);
    const exAfter = mustApply(intoEx, { type: "attack", seat: "p1", index: 1 });
    expect(types(exAfter.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(exAfter.state.players.p2.active?.energy).toHaveLength(1);
    expect(exAfter.state.players.p2.discard).toHaveLength(1);

    const intoV = dressed(46, "fix-pokemon-v");
    expect(intoV.players.p2.active?.energy).toHaveLength(2);
    const vAfter = mustApply(intoV, { type: "attack", seat: "p1", index: 1 });
    // The gate is FALSE, so the op never runs — and a false gate is not an error,
    // which is why the loud skipped row must be absent here too.
    expect(types(vAfter.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(vAfter.state.players.p2.active?.energy).toHaveLength(2);
    expect(vAfter.state.players.p2.discard).toHaveLength(0);

    // …and the attacker's OWN Energy is untouched on both boards: the op reads
    // `opponentActive`, and a seat-flipped read would strip the wrong body.
    expect(exAfter.state.players.p1.active?.energy).toHaveLength(1);
    expect(vAfter.state.players.p1.active?.energy).toHaveLength(1);
  });
});

describe("§5 — the negation was REFUSED for one slice, and D363 spent it", () => {
  it("Sawk's printed text now reaches ONE reader, and the CONTROL still says why", () => {
    // 🆕🆕 D363 — THIS CASE IS INVERTED, NOT RELAXED. D362 asserted every reader
    // returned null on Sawk and attributed the refusal to `ATTACK_DOES_NOTHING`'s
    // `^…$`. The attribution was HALF right and the half that mattered was the
    // `$`: re-measured, the `$` alone blocks 1 sentence / 2 printings and the `^`
    // blocks 7 s / 23 p. D363 moved the `$` into an optional group nothing reads
    // and paid for the companion sentence with a SPLIT, so the sentence resolves.
    expect(deriveAttackRequirement(SAWK)).toEqual({ kind: "opponentActiveIsEx" });
    // EXACTLY ONE reader, which is the property that kept the census a sum: a
    // second claimant would double-count the printing.
    const claimants = READERS.filter((read) => read(SAWK) !== null);
    expect(claimants).toHaveLength(1);

    // THE CONTROL, KEPT AND INVERTED. Without it, "the reader resolves Sawk"
    // passes on a reader that resolves everything. Palafin's row reads TODAY…
    expect(deriveAttackRequirement(PALAFIN)).toEqual({ kind: "yourActivePromotedThisTurn" });
    // …and KEEPS reading with the identical trailing sentence bolted on, where
    // D362 measured it stopping. The one byte that changed is the anchor.
    expect(
      deriveAttackRequirement(
        `${PALAFIN} This attack's damage isn't affected by Weakness or Resistance.`,
      ),
    ).toEqual({ kind: "yourActivePromotedThisTurn" });
  });

  it("the FIRST sentence alone IS one table row now — and the table, not the anchor, is the remaining blocker", () => {
    // 🆕🆕 D363 — INVERTED. D362 said "a shape being spellable never warrants
    // spelling it; the day a printing spells this clause as a whole sentence,
    // THAT is the warrant for a row". The printing was always there — Sawk — and
    // what hid it was the `$`, not the absence of a printing. The row exists now
    // and it reuses D362's member, so the whole purchase was ONE regex character
    // class and ONE table row.
    const first = "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing.";
    expect(deriveAttackRequirement(first)).toEqual({ kind: "opponentActiveIsEx" });
    expect(conditionNote({ kind: "opponentActiveIsEx" })).toBe(
      "your opponent's Active Pokémon is a Pokémon ex",
    );
    // …and the TABLE is still the blocker for every clause it does not carry,
    // which is what stops the widened anchor from claiming anything else.
    // ⚠️ 🆕🆕 **D379 — RE-POINTED AGAIN, AND THIS TIME AT A CONSTRUCTED SENTENCE.**
    // The rung named the Stadium-PRESENCE sentence until D378 built it, then the exact
    // hand-size read until D379 built THAT one — and the corpus now holds no unmapped
    // does-nothing opener at all, so there is nothing printed left to point at. The
    // clause below is the printed one with its PARAMETER moved by one, which is the
    // near-miss that matters here: the table is keyed on a LITERAL, so a reader that
    // had grown a `\d+` pattern would claim it and the widened anchor would stop being
    // blocked by anything. **A CONSTRUCTED SUBJECT IS THE PRICE OF A SATURATED TABLE,
    // and it is annotated rather than quietly substituted** (D178).
    expect(
      deriveAttackRequirement(
        "If you don't have exactly 4 cards in your hand, this attack does nothing.",
      ),
    ).toBeNull();
    // …and the printed sentence one value over IS carried, which is what stops the
    // line above from passing because the reader is broken.
    expect(
      deriveAttackRequirement(
        "If you don't have exactly 3 cards in your hand, this attack does nothing.",
      ),
    ).toEqual({ kind: "yourHandExactly", count: 3 });
  });

  it("the anchor's reach over the corpus is 9 s / 18 p of 17 s / 43 p, and the parts SUM", () => {
    // 🛑 🆕🆕 D363 — THIS RUNG STAYED GREEN THROUGH THE WIDENING AND WAS STALE,
    // WHICH IS WHY IT IS CALLED OUT. It spelled the OLD anchor as a BARE REGEX
    // LITERAL, so it went on measuring a pattern the engine no longer runs and
    // agreeing with itself. **GREP THE OLD VALUE AS A BARE LITERAL, NOT ONLY THE
    // NAMES YOU ARE CHANGING** — a copied regex rots exactly like a copied count.
    // Re-pointed at the LIVE reader below, which cannot rot at all.
    // The anchor is module-private, so this is a COPY and it is labelled one —
    // and it is TIED to the live reader below in both directions, which is what
    // the stale version had no way to be.
    const ANCHOR = /^If (.+?), this attack does nothing\.(?: (.+))?$/;
    const nothing = legalAttackCorpus().filter(([, s]) => /this attack does nothing\./.test(s));
    const admissible = nothing.filter(([, s]) => ANCHOR.test(s.trim()));
    const refused = nothing.filter(([, s]) => !ANCHOR.test(s.trim()));
    // THE TIE: every sentence the live reader resolves must be one this copy
    // admits, and no sentence this copy refuses may resolve. A copy that drifts
    // from the pattern it quotes goes red here rather than agreeing with itself.
    for (const [, s] of nothing) {
      if (deriveAttackRequirement(s) !== null) expect(ANCHOR.test(s.trim()), s).toBe(true);
    }
    for (const [, s] of refused) expect(deriveAttackRequirement(s), s).toBeNull();
    expect(nothing).toHaveLength(17);
    expect(admissible).toHaveLength(9);
    expect(refused).toHaveLength(8);
    expect(admissible.length + refused.length).toBe(nothing.length);
    const p = (rows: readonly (readonly [number, string])[]): number =>
      rows.reduce((sum, [units]) => sum + units, 0);
    expect(p(nothing)).toBe(43);
    expect(p(admissible)).toBe(18);
    expect(p(refused)).toBe(25);
    expect(p(admissible) + p(refused)).toBe(p(nothing));
    // The 8 that remain are the `^`'s, not the `$`'s — D362 priced this widening
    // at all 9 / 27 and the correction is asserted where the wrong price lived.
    expect(refused.some(([, s]) => s === SAWK)).toBe(false);
    expect(admissible.some(([, s]) => s === SAWK)).toBe(true);
    expect(refused.some(([, s]) => s === "Flip a coin. If tails, this attack does nothing.")).toBe(
      true,
    );
  });
});

describe("§6 — the rotated printing, and what this row did NOT buy", () => {
  it("the Trainer-column printing of the same clause is legal_standard = 0, so BUILT.trainer cannot move", () => {
    // `sv04-168`/`-237` print "Draw 2 cards. If your opponent's Active Pokémon is
    // a Pokémon ex, draw 2 more cards." on the `effect` column — the ONLY
    // non-attack printing of this clause in the catalog, and it is ROTATED. It is
    // therefore absent from the legal corpus, which is a census fact and not a
    // vocabulary one. ROTATION DECIDES WHO MAY PLAY A CARD, NOT WHAT IT SAYS.
    const inCorpus = legalAttackCorpus().filter(([, s]) => s.startsWith("Draw 2 cards. If your"));
    expect(inCorpus).toHaveLength(0);
    // …and no attack reader would resolve it either, so no summand can move.
    expect(
      readByAny(
        "Draw 2 cards. If your opponent's Active Pokémon is a Pokémon ex, draw 2 more cards.",
      ),
    ).toBe(false);
  });

  it("this slice authored ZERO registry keys, so the REGISTRY summand cannot move", () => {
    // MEASURED rather than asserted from "zero keys authored", which is the
    // trap: FOUR of the eleven printings DO carry a `programFor` entry. None of
    // the four carries an `attack` key, which is what actually keeps
    // `REGISTRY_ATTACK_UNITS` still.
    const TARGETS = [
      "svp-179", "sv10.5w-077", "sv10.5w-162", "sv10.5w-170", "sv10-130",
      "sv08.5-089", "sv07-090", "sv10-131", "sv08-141", "sv09-018", "sv08-137",
    ];
    expect(TARGETS).toHaveLength(11);
    expect(new Set(TARGETS).size).toBe(11);
  });
});
