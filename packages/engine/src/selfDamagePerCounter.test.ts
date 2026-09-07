import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, splitAttackGateClause, splitAttackTrailingClause } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  SELF_DAMAGE_PER_COUNTER_DECK,
  attachFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
} from "./testFixtures";

// 0.363.0 → 0.364.0 — 🆕🆕 D465, THE RECOIL THAT SCALES OFF ITS OWN COUNTERS.
// *"This Pokémon also does 10 damage to itself for each damage counter on it."* —
// `censusAttackCorpus.ts` FILE LINE 500, **1 sentence / 1 legal printing** — one new anchor
// (`SELF_DAMAGE_PER_COUNTER`) beside `SELF_DAMAGE`, one new OPTIONAL FIELD on the SHIPPED
// `damageSelf` op (`perDamageCounterOnSelf`) and one fold (`recoilAmount`) in `interpreter.ts`.
//
// 🛑 **THE SLICE'S FIRST HALF WAS AN INSTRUMENT FIX, AND THIS ROW IS ITS TEST.** D464 found
// that `scripts/residue-census.ts`'s span probe tokenises on `" "` and rejoins on `" "`, so a
// deletion reaching the LAST token takes the sentence-final period with it and the remainder
// can never build — no corpus sentence ends without its terminator. It measured the cost and
// deliberately did not pay it: SIX residue rows / 9 printings sat in `OPAQUE` for that purely
// mechanical reason. D465 fixed the probe FIRST, re-ran the classifier, and only then chose a
// target from the corrected table. **This row was `OPAQUE` before the fix and `PHRASE-6`
// after it, and it was chosen because of that reclassification.** §7 keeps the relation
// executable: deleting the six-token tail *"for each damage counter on it."* and re-attaching
// the period reaches the BUILT bare twin, which is exactly what the probe now does.
//
// ⚠️ **`OPAQUE` DID NOT MOVE FOR THIS BUILD — 81/116 BEFORE AND AFTER** — because the fix had
// already taken the row out of it. That is the opposite of D463's and D464's close-outs and it
// is not an oversight: a class is a statement about the INSTRUMENT's reach, and the instrument
// changed in the same slice.
//
// ⚠️ **ZERO NEW `EffectOp` MEMBERS, `DamageCountSource` KINDS, READERS (the surface stands
// still at 13, asserted in §6), PROMPTS, EVENTS, ERROR CODES, REGISTRY ROWS, `packages/schema`
// BYTES or `redact.ts` BYTES.** ⚠️ **ONE new op FIELD and ONE new FIXTURE id, both said out
// loud** — nothing in `FIXTURE_POOL` printed this sentence (D464 could write "no new fixture
// id"; this slice cannot, and the difference is measured in `testFixtures.ts`'s own block).
//
// 🛑 **`damageCountersOnSelf` ALREADY SHIPS AND IS DELIBERATELY NOT USED.** `effects.ts`
// declares it as a `DamageCountSource` member, and that type says of itself that it is a
// PARSE-TIME type consumed in the same tick by `scaledAttackDamage` — **no `EffectOp` carries
// one**. Reaching for it would have meant either exporting `attack.ts`'s module-private fold
// (which needs a defender seat and an effective cost array, neither on `EffectContext`) or
// collapsing every boolean rider into a `scale?: DamageCountSource` field — a collapse D448
// and D449 PRICED at 24 sites across 10 files plus a `MATCH_RECORD_VERSION` bump, for zero
// extra printings. The rider is that measured refusal re-applied, not re-argued.

/** Corpus FILE LINE 500, byte for byte — asserted off `legalAttackCorpus()` in §1 rather than
    eyeballed. The `é` is U+00E9; the sentence prints no apostrophe, which is why this anchor
    needs no `['’]` class (D136/D137's rule stated where it does NOT apply). */
const PRINTED = "This Pokémon also does 10 damage to itself for each damage counter on it.";

/** The BARE twin, corpus FILE LINE 501 at 21 printings — the most reprinted recoil rider in
    the column, shipped since 0.x. It is the string the fixed span probe reaches, and the
    one-axis control on every board below. */
const BARE = "This Pokémon also does 10 damage to itself.";

/** 🛑 CONSTRUCTED, AND SAID OUT LOUD (D462's standing). The corpus prints exactly ONE scaled
    recoil, so this anchor has no printed near miss at all and its discipline can only be
    driven synthetically. Each entry moves exactly ONE axis off `PRINTED`. */
const CONSTRUCTED_MISSES = [
  // the printed "also" — the family's stated guard, kept on the new anchor
  "This Pokémon does 10 damage to itself for each damage counter on it.",
  // a lowercase "this": no /i, and the capital is half of what keeps a mid-sentence clause
  // off the derived path (the family's Krookodile convention)
  "this Pokémon also does 10 damage to itself for each damage counter on it.",
  // ASCII "Pokemon" — the é is load-bearing
  "This Pokemon also does 10 damage to itself for each damage counter on it.",
  // a printed 0 is not a real card; left loud rather than derived to a silent no-op
  "This Pokémon also does 0 damage to itself for each damage counter on it.",
  // the terminator: `\.$` is what makes this anchor and `SELF_DAMAGE` mutually exclusive
  "This Pokémon also does 10 damage to itself for each damage counter on it",
  // a DIFFERENT count — the anaphor "it" is the attacker, and no other body is meant
  "This Pokémon also does 10 damage to itself for each damage counter on your opponent's Active Pokémon.",
  // leading text pins `^`
  "Draw a card. This Pokémon also does 10 damage to itself for each damage counter on it.",
  // the subject changed: "This attack" is a different sentence family entirely
  "This attack does 10 damage to itself for each damage counter on it.",
] as const;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}
const types = (events: GameEvent[]) => events.map((e) => e.type);
const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);

const IDX = { scaled: 0, flat: 1 } as const;

/** P1 fields `fix-recoil-scale` with one {C} attached, P2 fields the 340 HP `fix-titan`, both
    benches cleared. `damage` is the counters already on the ATTACKER when the attack runs. */
function board(seed: number, damage: number): GameState {
  const setup = driveSetup(
    seed,
    { p1: SELF_DAMAGE_PER_COUNTER_DECK, p2: SELF_DAMAGE_PER_COUNTER_DECK },
    { first: "p2" },
  );
  let state = must(applyAction(setup, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", "fix-recoil-scale");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  return deepFreeze(setDamage(state, "p1", damage));
}

const swing = (state: GameState, index: number) =>
  mustApply(state, { type: "attack", seat: "p1" as Seat, index });

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the reader, and the sentence is a real printed row rather than an invention.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed sentence, the op it derives to, and the one axis that moves", () => {
  it("🛑 both strings are REAL corpus rows at the printings the docs claim (D425)", () => {
    // D463's rule, paid before anything is built on top of the string: a suite that invents a
    // sentence tests its own typing. `rows` is the committed `legal_standard = 1` column.
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(PRINTED)).toBe(1);
    expect(rows.get(BARE)).toBe(21);
    // …and the FIXTURE prints them byte for byte, so nothing below is transcription.
    expect(FIXTURE_POOL["fix-recoil-scale"]?.attacks?.[IDX.scaled]?.effect).toBe(PRINTED);
    expect(FIXTURE_POOL["fix-recoil-scale"]?.attacks?.[IDX.flat]?.effect).toBe(BARE);
  });

  it("derives the scaled recoil as the SHIPPED op plus one rider", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual([
      { op: "damageSelf", amount: 10, perDamageCounterOnSelf: true },
    ]);
  });

  it("🛑 the ONE-AXIS control: deleting the clause gives the shipped BARE op, unchanged", () => {
    // The rider, and not the anchor or the amount, is what moved. This is also the exact
    // string the fixed span probe reaches — see §7.
    expect(deriveAttackEffect(BARE)).toEqual([{ op: "damageSelf", amount: 10 }]);
  });

  it("🛑 the two anchors are MUTUALLY EXCLUSIVE BY `\\.$`, not by their order", () => {
    // `SELF_DAMAGE` requires the string to END at "itself.", so it cannot match a sentence
    // that continues. Stated in `effects.ts` and executable here: the scaled sentence carries
    // the bare one as a PREFIX up to the period, and the bare anchor still refuses it.
    expect(PRINTED.startsWith(BARE.slice(0, -1))).toBe(true);
    expect(/^This Pokémon also does (\d+) damage to itself\.$/.test(PRINTED)).toBe(false);
    // …and the converse: the scaled anchor refuses the bare sentence.
    expect(
      /^This Pokémon also does (\d+) damage to itself for each damage counter on it\.$/.test(BARE),
    ).toBe(false);
  });

  it("refuses every constructed near miss — each moves exactly one axis", () => {
    for (const text of CONSTRUCTED_MISSES) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    // ⚠️ AND NONE OF THEM IS A PRINTED ROW, which is what makes them constructions rather
    // than measurements — said out loud rather than left to be assumed.
    const printed = new Set(legalAttackCorpus().map(([, s]) => s));
    for (const text of CONSTRUCTED_MISSES) expect(printed.has(text), text).toBe(false);
  });

  it("🛑 the amount is CAPTURED, not hard-coded to the one printed 10", () => {
    expect(
      deriveAttackEffect("This Pokémon also does 40 damage to itself for each damage counter on it."),
    ).toEqual([{ op: "damageSelf", amount: 40, perDamageCounterOnSelf: true }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the census moves in exactly ONE summand.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the census moves in exactly ONE summand, and the step is 1 and 1", () => {
  it("🛑 the resolving corpus gains ONE sentence and ONE printing", () => {
    const resolved = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    expect([resolved.length, units(resolved)]).toEqual([516, 1545]);  // (🆕🆕🆕 D483 +2 sentences / +2 printings — THE PRINTED CANDIDATE **CLASS** ON THE BENCHED SNIPE, `censusAttackCorpus.ts` FILE LINES **111** and **615**, **2 sentences / 2 legal printings**, both claimed WHOLE by `deriveAttackEffect` (arms 9b-bis and 6c) through ONE new group on the SHARED fragment `ALSO_BENCHED_SNIPE_BODY` and ONE new OPTIONAL op field `damageChosen.filter?: CardFilter`. RAW summand ALONE; reader surface still 13. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 2 AND 2, MEASURED at this head.) // (🆕🆕 D482 +1 sentence / +1 printing — THE WHOLE-SIDE SPREAD, `censusAttackCorpus.ts` FILE LINE **572**, *"This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` arm 6a-bis through ONE new anchor `SPREAD_EACH_OPPONENT_POKEMON` over a TWO-OP PROGRAM OF SHIPPED OPS (`damageDefender` flat + `spreadDamage { target: "opponentBench" }`) — **ZERO new op members, fields, values or `interpreter.ts` bytes**, reader surface still 13. RAW summand ALONE: no registry row, no gate split, no trailing split. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1.)// (🆕🆕 D479 +1 sentence / +1 printing — THE ATTACK-SIDE HAND REFRESH, `censusAttackCorpus.ts` FILE LINE 486, *"Shuffle your hand into your deck. Then, draw {N} cards."*, 1 sentence / 1 legal printing, claimed WHOLE by `deriveAttackEffect` arm 44b through ONE new anchor `SHUFFLE_HAND_DRAW` over `handRefresh { who: "you", draw: { kind: "fixed", count } }` — Youngster `sv01-198`'s hand-authored trainer program at a second address, so ZERO new `EffectOp` members, op FIELDS, op VALUES, readers (surface still 13), prompts, events, `interpreter.ts` or `redact.ts` bytes. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1, unlike D478's 1-vs-2 — derived here, not carried.) // (D478 +1 sentence / +2 printings — THE OTHER BRANCH OF A GATE THAT ALREADY SHIPS, `censusAttackCorpus.ts` FILE LINE 263, *"Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Confused."*, 1 sentence / 2 legal printings, claimed WHOLE by `deriveAttackEffect` arm 2b-bis through ONE new anchor `FLIP_DEFENDER_PAIR_OR_TAILS_STATUS` over a `coinFlipGate` with BOTH arms filled. `coinFlipGate.otherwise` shipped at D269 and arm 6d has emitted a two-armed gate since D416, so the mechanism the old refusal called absent was 209 decisions old. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2 — one file line, two legal printings; D476's and D475's agreed at 1 and 1, so this term was DERIVED here and not carried. RAW summand ALONE: no registry row, no gate split, no trailing split, reader surface still 13, ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414), ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, events or `interpreter.ts` bytes.) // (🆕🆕 D476 +1 sentence / +1 printing — THE FACE AXIS, THE LAST OPEN AXIS OF THE PRINTED PER-FACE FAMILY — `censusAttackCorpus.ts` **FILE LINE 217**, *"Flip 3 coins. For each tails, discard an Energy from this Pokémon."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor (`ATTACK_COIN_SELF_ENERGY_PER_TAILS`) and ONE **REQUIRED** `face: CoinFace` FIELD on the shipped `programPerHeads` member. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — D472's disagreed at 1 and 2, D473's agreed at 2 and 2, D474's disagreed at 1 and 2, D475's agreed at 1 and 1 — so this term was DERIVED at this head and not carried from the previous slice (D451/D461/D464). RAW summand ALONE: no registry row, no gate split, no trailing split, reader surface still 13, and **ZERO new `FIXTURE_POOL` ids** (file-local `cardPool`, D414), so every id ladder takes a ZERO term. ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, events, error codes or `AttackCoinFlip` MEMBERS — the op is `SELF_DISCARD_ONE`'s output byte for byte, and the FACE rides the member that already shipped.) // (🆕🆕 D475 +1 sentence / +1 printing — THE COIN FLIP COUNTED OVER BOTH ACTIVES — `censusAttackCorpus.ts` **FILE LINE 231**, *"Flip a coin for each Energy attached to both Active Pokémon. This attack does 60 damage for each heads."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor and a FIFTH, NULLARY `AttackFlipCount` member `bothActivesEnergy`. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — D472's disagreed at 1 and 2, D473's agreed at 2 and 2, D474's disagreed at 1 and 2, so this term was DERIVED at this head and not carried from the previous slice (D451/D461/D464). RAW summand ALONE: no registry row, no gate split, no trailing split, D464's compound route measured EMPTY, reader surface still 13, and **NO new `FIXTURE_POOL` id** — the printed sentence has sat on `fix-bothactives` index 2 as a refusal witness since D196, so every id ladder takes a ZERO term.) // 🆕🆕 D474 +1 sentence / +2 printings (THE BOARD-COUNTED COIN FLIP OVER BODIES — `censusAttackCorpus.ts` **FILE LINE 233**, *"Flip a coin for each {D} Pokémon you have in play. This attack does 60 damage for each heads."*, **1 sentence / 2 legal printings**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor and ONE new `AttackFlipCount` member `pokemonInPlay`. ⚠️ **THIS IS A LIVE HEAD, NOT A FROZEN TAIL** (D461/D462): the literal moves and there is no front term to add. ⚠️ **AND THE TWO UNITS DISAGREE, 1 AND 2** — the opposite of D473's 2-and-2 — so the number here was read off THIS assertion's head rather than copied from a sibling site. RAW summand ALONE: no registry row, no gate split, no trailing split, D464's compound route measured EMPTY, reader surface still 13.) // 🆕🆕 D470 +1 sentence / +1 printing (THE BOARD-WIDE OWN-SIDE ENERGY COUNT, NARROWED BY A PRINTED SUBGROUP NOUN — `censusAttackCorpus.ts` **FILE LINE 558**, *"This attack does 20 more damage for each {L} Energy attached to all of your Iono's Pokémon."*, **1 legal printing**, claimed WHOLE by `deriveAttackDamageBonus` through the new `SELF_ENERGY_FILTERED_SCALE` anchor. ONE anchor, ONE reader arm, ONE **OPTIONAL FIELD ON THE SHIPPED** `energyOnSelf` member (`filter?: CardFilter`), ONE evaluator branch and ONE **OPTIONAL PARAMETER ON THE SHARED** `countEnergyInPlay` — whose THREE call sites (`energyOnOpponent`'s board arm, `energyOnSelf`'s, and `interpreter.ts`'s `yourEnergyInPlayAtLeast`, the third of which is NOT an op) are byte-identical, because `undefined` is every body. D454's blast radius, ENUMERATED before a byte was written. DISJOINT FROM `SELF_ENERGY_SCALE` BY STRUCTURE and not by the lookahead, which D467/D468 require saying: both are `^…$` and this one demands a run of bytes ending in a SPACE that the shipped literal cannot spend; the `(?!opponent)` lookahead is a DIFFERENT guard doing a DIFFERENT job (it refuses a SEAT, not a subgroup) and it IS killable. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op fields, op values, prompts, events, error codes, registry rows, `CardFilter` MEMBERS, `packages/schema` bytes or `redact.ts` bytes; ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414). **`MATCH_RECORD_VERSION` STAYS 29** — an `AttackDamageBonus` is a parse-time LOCAL inside `attack()`, and `CardFilter` IS persisted but gains no MEMBER here (`ownerPokemon` has been an inhabitant since D242), driven over the SERIALIZED BYTES in `ownerBoardEnergyScaling.test.ts` §8.)
    // 🆕🆕 D469 +1 sentence / +1 printing (THE OPPONENT'S WHOLE BOARD OF DAMAGE COUNTERS — `censusAttackCorpus.ts` **FILE LINE 534**, *"This attack does 10 more damage for each damage counter on all of your opponent's Pokémon."*, **1 legal printing**, claimed WHOLE by `deriveAttackDamageBonus` through the new `OPPONENT_BOARD_COUNTER_SCALE` anchor. ONE anchor, ONE reader arm, ONE NULLARY `DamageCountSource` member (`damageCountersOnOpponentBoard`), ONE evaluator arm and ONE shared board counter (`countDamageCountersInPlay`, continuous.ts, beside `countEnergyInPlay`/`countToolsInPlay`) — D406's cost table verbatim, at a second address. DISJOINT FROM `OPPONENT_COUNTER_SCALE` BY STRUCTURE and not by a lookahead, which D467/D468 require saying: both are `^…$` and disagree on a mandatory run of bytes at the same position. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op fields, op values, prompts, events, error codes, registry rows, `packages/schema` bytes or `redact.ts` bytes; ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414). **`MATCH_RECORD_VERSION` STAYS 29** — an `AttackDamageBonus` is a parse-time LOCAL inside `attack()` and there is no carrier at all, driven over the SERIALIZED BYTES in `opponentBoardCounterScaling.test.ts` §8 rather than reasoned from the type's name (D427).) // 🆕🆕 D468 +1 sentence / +1 printing (THE TYPED SELF-SWITCH — `censusAttackCorpus.ts` **FILE LINE 499**, *"Switch this Pokémon with 1 of your Benched {L} Pokémon."*, **1 legal printing**. ⚠️ **A LIVE HEAD, NOT A CHAIN — SO THE LITERAL MOVES AND NOTHING IS ADDED AT THE FRONT** (D461's table: the tell is the left-hand side of the assertion). ⚠️ **AND THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 HERE**, which is the easy case and is not a shape that carries — D467's was 2 vs 3.)  // 🆕🆕 D467 +2 sentences / +3 printings (THE ATTACKER'S OWN BENCH NARROWED BY A PRINTED NOUN, ON BOTH OF ITS COUNTING AXES — `censusAttackCorpus.ts` **file lines 544 and 622**, *"This attack does 20 damage for each damage counter on all of your Benched {F} Pokémon."* (2 legal, the `×` fold) and *"This attack does 80 more damage for each of your Benched Charjabug."* (1 legal, the `+` fold), **2 sentences / 3 legal printings**. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 2 vs 3** — two file lines carrying 2 and 1 printings, so MEASURE each site rather than copying one number into the other kind (D451/D461/D466). RAW summand ALONE: no registry row, no gate split, no trailing split, and the reader surface stands still at 13. TWO new anchors, ONE new OPTIONAL field on the shipped `damageCountersOnYourBench` member, ONE new `IN_PLAY_BODY_NOUNS` row and ZERO new `CardFilter` members — so `MATCH_RECORD_VERSION` STAYS 29 on the SERIALIZED-ALPHABET shape (D462) at ONE address, not two.)
    // 🆕🆕 D466 +2 sentences / +3 printings (THE PRINTED EVOLUTION-STAGE ORDINAL AS A BODY FILTER — `censusAttackCorpus.ts` **file lines 586 and 589**, *"This attack does 40 damage for each of your Stage 1 Pokémon in play."* (1 legal, the `×` fold) and *"This attack does 40 more damage for each Stage 2 Pokémon on your Bench."* (2 legal, the `+` fold), **2 sentences / 3 legal printings**, claimed by `deriveAttackDamageMultiplier` and `deriveAttackDamageBonus` respectively. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 2 vs 3** — two file lines carrying 1 and 2 printings, so a pass that copied one number into the other kind of site would be wrong at every site of the other kind (D451/D461); MEASURE each site. ONE new `CardFilter` member (`stagePokemon`, delegating to cards.ts `isStage1Pokemon`/`isStage2Pokemon`, which D387/D262 had already written for the `boardCondition` antecedents) and TWO new `IN_PLAY_BODY_NOUNS` rows — which is the WHOLE of file line 586, with **ZERO new anchors**, because D439's two shipped `in play` anchors already reached it and only the VOCABULARY refused. File line 589 costs ONE new anchor (`YOUR_BENCH_FILTERED_SCALE`) and ONE new OPTIONAL FIELD on the SHIPPED `yourBenchCount` member (`filter?: CardFilter`, D407's `energyOnSelf.zone` shape) — `undefined` is every body, so all ten shipped printings of that member emit a filter-less object byte for byte as before. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op fields, op values, prompts, events, error codes, registry rows, `packages/schema` bytes or `redact.ts` bytes; ONE new FIXTURE id (`fix-stage2body`) and ONE new attack on `fix-inplaybodies`. **`MATCH_RECORD_VERSION` STAYS 29 AT TWO ADDRESSES** — `CardFilter` IS persisted (D446 measured it: nine `EffectOp` fields carry one and an op rides `state.phase.cont.pendingOp`) and a WIDENING is free; `DamageCountSource` is PARSE-TIME and is not at a persisted address at all. 🛑 **`OPAQUE` MOVES, 81/116 → 80/114, AND `PHRASE-2` EMPTIES, 1/1 → 0/0 — AND THE INSTRUMENT STOOD STILL THIS SLICE** (`residue-census.ts` is untouched by D466), so unlike D465 this class-table delta really is a statement about the WORK.) 
    // …and the step is THIS sentence and nothing else: remove it and the pair is D464's.
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([without.length, units(without)]).toEqual([515, 1544]); // (🆕🆕🆕 D483 +2 sentences / +2 printings — THE PRINTED CANDIDATE **CLASS** ON THE BENCHED SNIPE, `censusAttackCorpus.ts` FILE LINES **111** and **615**, **2 sentences / 2 legal printings**, both claimed WHOLE by `deriveAttackEffect` (arms 9b-bis and 6c) through ONE new group on the SHARED fragment `ALSO_BENCHED_SNIPE_BODY` and ONE new OPTIONAL op field `damageChosen.filter?: CardFilter`. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 2 AND 2, MEASURED. ⚠️ FOUND ON A SECOND `check` ROUND, BEHIND A SITE IN THE SAME `it` THAT THREW FIRST — D462's rule: vitest stops an `it` at its first throw, so a spelling-keyed pass is always short and the ROUND COUNT is the measurement.) // (🆕🆕 D479 +1 sentence / +1 printing — THE ATTACK-SIDE HAND REFRESH, `censusAttackCorpus.ts` FILE LINE 486, *"Shuffle your hand into your deck. Then, draw {N} cards."*, claimed WHOLE by `deriveAttackEffect` arm 44b through ONE new anchor `SHUFFLE_HAND_DRAW` over `handRefresh { who: "you", draw: { kind: "fixed", count } }` — Youngster `sv01-198`'s hand-authored program at a second address. ZERO new op members/fields/values, reader surface still 13. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1.) // (D478 +1 sentence / +2 printings — THE OTHER BRANCH OF A GATE THAT ALREADY SHIPS, `censusAttackCorpus.ts` FILE LINE 263, *"Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Confused."*, 1 sentence / 2 legal printings, claimed WHOLE by `deriveAttackEffect` arm 2b-bis through ONE new anchor `FLIP_DEFENDER_PAIR_OR_TAILS_STATUS` over a `coinFlipGate` with BOTH arms filled. `coinFlipGate.otherwise` shipped at D269 and arm 6d has emitted a two-armed gate since D416, so the mechanism the old refusal called absent was 209 decisions old. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2 — one file line, two legal printings; D476's and D475's agreed at 1 and 1, so this term was DERIVED here and not carried. RAW summand ALONE: no registry row, no gate split, no trailing split, reader surface still 13, ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414), ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, events or `interpreter.ts` bytes.) // (🆕🆕 D476 +1 sentence / +1 printing — THE FACE AXIS, THE LAST OPEN AXIS OF THE PRINTED PER-FACE FAMILY — `censusAttackCorpus.ts` **FILE LINE 217**, *"Flip 3 coins. For each tails, discard an Energy from this Pokémon."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor (`ATTACK_COIN_SELF_ENERGY_PER_TAILS`) and ONE **REQUIRED** `face: CoinFace` FIELD on the shipped `programPerHeads` member. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — D472's disagreed at 1 and 2, D473's agreed at 2 and 2, D474's disagreed at 1 and 2, D475's agreed at 1 and 1 — so this term was DERIVED at this head and not carried from the previous slice (D451/D461/D464). RAW summand ALONE: no registry row, no gate split, no trailing split, reader surface still 13, and **ZERO new `FIXTURE_POOL` ids** (file-local `cardPool`, D414), so every id ladder takes a ZERO term. ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, events, error codes or `AttackCoinFlip` MEMBERS — the op is `SELF_DISCARD_ONE`'s output byte for byte, and the FACE rides the member that already shipped.) // (🆕🆕 D475 +1 sentence / +1 printing — THE COIN FLIP COUNTED OVER BOTH ACTIVES, `censusAttackCorpus.ts` **FILE LINE 231**, claimed WHOLE by `deriveAttackCoinFlip`. ⚠️ FOUND ON THE SECOND `check` ROUND, BEHIND A SITE IN THE SAME `it` THAT THREW FIRST — D462's rule: vitest stops an `it` at its first throw, so a spelling-keyed pass is always short and the round count is the measurement.) // 🆕🆕 D474 +1 sentence / +2 printings (THE BOARD-COUNTED COIN FLIP OVER BODIES — `censusAttackCorpus.ts` **FILE LINE 233**, **1 sentence / 2 legal printings**, claimed WHOLE by `deriveAttackCoinFlip`. ⚠️ **FOUND ON THE SECOND `check` ROUND, BEHIND A SITE THAT THREW FIRST** — D462's rule: vitest stops an `it` at its first throw, so a spelling-keyed pass is always short. The head name was read at THIS site rather than copied from the sibling above it.) // 🆕🆕 D470 +1 sentence / +1 printing (THE BOARD-WIDE OWN-SIDE ENERGY COUNT, NARROWED BY A PRINTED SUBGROUP NOUN — `censusAttackCorpus.ts` **FILE LINE 558**, *"This attack does 20 more damage for each {L} Energy attached to all of your Iono's Pokémon."*, **1 legal printing**, claimed WHOLE by `deriveAttackDamageBonus` through the new `SELF_ENERGY_FILTERED_SCALE` anchor — ONE anchor, ONE arm, ONE OPTIONAL field on the SHIPPED `energyOnSelf` member, ONE evaluator branch, ONE OPTIONAL parameter on the SHARED `countEnergyInPlay`. RAW summand ALONE; the reader surface stands still at 13.) // (🆕🆕🆕 D482 — the WHOLE-SIDE SPREAD raises the head by 1 sentence / 1 printing (`censusAttackCorpus.ts` FILE LINE 572, arm 6a-bis, `SPREAD_EACH_OPPONENT_POKEMON` over `damageDefender` + `spreadDamage`), so this DERIVED figure moves with it. This slice's own sentence is NOT in this file's subtracted set, which is why the figure steps by exactly the head's step.)
    // 🆕🆕 D469 +1 sentence / +1 printing (THE OPPONENT'S WHOLE BOARD OF DAMAGE COUNTERS — `censusAttackCorpus.ts` **FILE LINE 534**, *"This attack does 10 more damage for each damage counter on all of your opponent's Pokémon."*, **1 legal printing**, claimed WHOLE by `deriveAttackDamageBonus` through the new `OPPONENT_BOARD_COUNTER_SCALE` anchor. ONE anchor, ONE reader arm, ONE NULLARY `DamageCountSource` member (`damageCountersOnOpponentBoard`), ONE evaluator arm and ONE shared board counter (`countDamageCountersInPlay`, continuous.ts, beside `countEnergyInPlay`/`countToolsInPlay`) — D406's cost table verbatim, at a second address. DISJOINT FROM `OPPONENT_COUNTER_SCALE` BY STRUCTURE and not by a lookahead, which D467/D468 require saying: both are `^…$` and disagree on a mandatory run of bytes at the same position. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op fields, op values, prompts, events, error codes, registry rows, `packages/schema` bytes or `redact.ts` bytes; ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414). **`MATCH_RECORD_VERSION` STAYS 29** — an `AttackDamageBonus` is a parse-time LOCAL inside `attack()` and there is no carrier at all, driven over the SERIALIZED BYTES in `opponentBoardCounterScaling.test.ts` §8 rather than reasoned from the type's name (D427).) // 🆕🆕 D468 +1 sentence / +1 printing (THE TYPED SELF-SWITCH — `censusAttackCorpus.ts` **FILE LINE 499**, *"Switch this Pokémon with 1 of your Benched {L} Pokémon."*, **1 legal printing**. ⚠️ **A LIVE HEAD, NOT A CHAIN** — the literal moves and nothing is added at the front (D461). ⚠️ **THIS SITE WAS MASKED BEHIND ANOTHER IN THE SAME `it` AND ONLY SURFACED ON THE THIRD `check` ROUND** — vitest stops an `it` at its first throw, so the runner's list is never the population (D462/D465).)  // 🆕🆕 D467 +2 sentences / +3 printings (THE ATTACKER'S OWN BENCH NARROWED BY A PRINTED NOUN, ON BOTH OF ITS COUNTING AXES — `censusAttackCorpus.ts` **file lines 544 and 622**, **2 sentences / 3 legal printings**, RAW summand ALONE. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 2 vs 3** — MEASURE each site (D451/D461/D466).)
    // 🆕🆕 D466 +2 sentences / +3 printings (THE PRINTED EVOLUTION-STAGE ORDINAL AS A BODY FILTER — `censusAttackCorpus.ts` **file lines 586 and 589**, *"This attack does 40 damage for each of your Stage 1 Pokémon in play."* (1 legal, the `×` fold) and *"This attack does 40 more damage for each Stage 2 Pokémon on your Bench."* (2 legal, the `+` fold), **2 sentences / 3 legal printings**, claimed by `deriveAttackDamageMultiplier` and `deriveAttackDamageBonus` respectively. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 2 vs 3** — two file lines carrying 1 and 2 printings, so a pass that copied one number into the other kind of site would be wrong at every site of the other kind (D451/D461); MEASURE each site. ONE new `CardFilter` member (`stagePokemon`, delegating to cards.ts `isStage1Pokemon`/`isStage2Pokemon`, which D387/D262 had already written for the `boardCondition` antecedents) and TWO new `IN_PLAY_BODY_NOUNS` rows — which is the WHOLE of file line 586, with **ZERO new anchors**, because D439's two shipped `in play` anchors already reached it and only the VOCABULARY refused. File line 589 costs ONE new anchor (`YOUR_BENCH_FILTERED_SCALE`) and ONE new OPTIONAL FIELD on the SHIPPED `yourBenchCount` member (`filter?: CardFilter`, D407's `energyOnSelf.zone` shape) — `undefined` is every body, so all ten shipped printings of that member emit a filter-less object byte for byte as before. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op fields, op values, prompts, events, error codes, registry rows, `packages/schema` bytes or `redact.ts` bytes; ONE new FIXTURE id (`fix-stage2body`) and ONE new attack on `fix-inplaybodies`. **`MATCH_RECORD_VERSION` STAYS 29 AT TWO ADDRESSES** — `CardFilter` IS persisted (D446 measured it: nine `EffectOp` fields carry one and an op rides `state.phase.cont.pendingOp`) and a WIDENING is free; `DamageCountSource` is PARSE-TIME and is not at a persisted address at all. 🛑 **`OPAQUE` MOVES, 81/116 → 80/114, AND `PHRASE-2` EMPTIES, 1/1 → 0/0 — AND THE INSTRUMENT STOOD STILL THIS SLICE** (`residue-census.ts` is untouched by D466), so unlike D465 this class-table delta really is a statement about the WORK.) 
  });

  it("🛑 the move is READER-keyed: no registry row, no gate clause, no trailing split", () => {
    // The three summands `censusAtHead.test.ts` splits `BUILT.attack` into, RE-MEASURED
    // rather than assumed — a move that arrived through any of them would be a different
    // claim about what this slice did (D312/D338's shape).
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    // The reader SURFACE does not move: the arm rides `deriveAttackEffect`, which already ships.
    expect(attackReaderSurface()).toHaveLength(13);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the board: the fold is real, and ZERO counters is SILENT.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the recoil scales off the attacker's own counters", () => {
  it("🛑 the multiplier is the COUNTER count — 3 counters → 30, 7 → 70, on one sentence", () => {
    // §12: one counter is 10 HP. 30 damage on the body is 3 counters, so the printed 10
    // becomes 30 — and the attacker ends at 30 + 30 = 60.
    const three = swing(board(1, 30), IDX.scaled);
    expect(find(three.events, "COUNTERS_PLACED")).toMatchObject({ amount: 30, source: "self" });
    expect(three.state.players.p1.active?.damage).toBe(60);
    // A second, different multiplier so "30" cannot be a hard-coded number: 7 counters → 70,
    // and 70 + 70 = 140 on a 200 HP body, which still does not KO.
    const seven = swing(board(2, 70), IDX.scaled);
    expect(find(seven.events, "COUNTERS_PLACED")).toMatchObject({ amount: 70, source: "self" });
    expect(seven.state.players.p1.active?.damage).toBe(140);
  });

  it("🛑 THE LOSS DIRECTION — an UNDAMAGED attacker takes NO recoil and emits NO event", () => {
    // "For each" means EACH, not "at least one". Zero counters × 10 is 0, and `damageSelf` is
    // silent on a non-positive amount, so there is no `COUNTERS_PLACED` row at all — not a
    // row saying nothing happened. This is the plausible degradation D421 says to design
    // against, and it is the direction a reader who thinks "scaling implies a minimum" gets
    // wrong.
    const { state, events } = swing(board(3, 0), IDX.scaled);
    expect(state.players.p1.active?.damage).toBe(0);
    expect(find(events, "COUNTERS_PLACED")).toBeUndefined();
    // ⚠️ AND THE ATTACK ITSELF STILL HAPPENED — the defender took the printed 20. Without
    // this half, "no recoil" is indistinguishable from "the attack did nothing".
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 20 });
    expect(state.players.p2.active?.damage).toBe(20);
  });

  it("🛑 the CONTROL on the same body: index 1 stays at the printed 10 with 3 counters", () => {
    // Same fixture, same board, same printed amount, clause deleted → 10 and not 30. Without
    // this rung "the recoil was 30" is equally consistent with a build that scales EVERY
    // recoil, and with one that reads the amount off the body's damage directly.
    const { state, events } = swing(board(4, 30), IDX.flat);
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ amount: 10, source: "self" });
    expect(state.players.p1.active?.damage).toBe(40);
  });

  it("🛑 the count is FLOORED, and a non-multiple of 10 proves the division is there", () => {
    // 25 HP of damage is TWO counters, not two and a half: `Math.floor(damage / 10)`, the same
    // arithmetic `scaledAttackDamage`'s `damageCountersOnSelf` arm does. A fold written as
    // `damage / 10` reads 2.5 here and places 25; a fold written as `damage` places 250.
    const { state, events } = swing(board(5, 25), IDX.scaled);
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ amount: 20, source: "self" });
    expect(state.players.p1.active?.damage).toBe(45);
  });

  it("🛑 THE FOLD READS THE BODY BEFORE IT WRITES IT — the recoil is not self-referential", () => {
    // The single most likely wrong build: fold AFTER the placement, or fold twice. At 3
    // counters the right answer is 30 (3 × 10) and the board ends at 60; a fold that saw its
    // own placement would read 6 counters and end at 90. The two are distinguished by ONE
    // number, and only a board can distinguish them — no reader test can.
    const { state, events } = swing(board(6, 30), IDX.scaled);
    const placed = events.filter((e) => e.type === "COUNTERS_PLACED");
    expect(placed).toHaveLength(1); // one read, one write, no fixed point
    expect(state.players.p1.active?.damage).toBe(60);
    expect(state.players.p1.active?.damage).not.toBe(90);
  });

  it("🛑 the recoil is OUTSIDE the §8.5 pipeline — COUNTERS_PLACED, not DAMAGE_DEALT", () => {
    // Inherited from `damageSelf` and re-asserted here because the rider is new: self-damage
    // takes no Weakness, no Resistance and no reduction (you have no Weakness to your own
    // attack), so it lands as a counter placement on the attacker's own seat. The defender's
    // hit is the DAMAGE_DEALT row, and the two must not be confused.
    const { events } = swing(board(7, 30), IDX.scaled);
    expect(types(events)).toContain("COUNTERS_PLACED");
    const self = find(events, "COUNTERS_PLACED");
    expect(self?.seat).toBe("p1");
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(20);
    // …and the recoil's 30 never appears as dealt damage anywhere.
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the derived bytes, driven in THREE directions including LOSS.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the op's bytes, three directions, and why none of them is persisted", () => {
  it("🛑 `MATCH_RECORD_VERSION` STAYS 29 — the argument is REACHABILITY, and it is DRIVEN", () => {
    // ⚠️ D461's shape, NOT D462/D463's SERIALIZED ALPHABET shape, and the difference matters:
    // the alphabet argument says "these bytes already ship", which is FALSE here — the key
    // `perDamageCounterOnSelf` has never appeared in an op before. The reachability argument
    // says the bytes can never reach a record at all, and that is what is asserted below.
    //
    // An `EffectOp` reaches a `MatchRecord` through exactly one door: `phase.cont.rest`, the
    // ops left parked behind an op that asked a question. So a new field is unreachable when
    // (a) its own op never parks and (b) no producer can put it AFTER a parking op.
    const program = deriveAttackEffect(PRINTED);
    // (b) — the only producer returns a program of LENGTH ONE, so there is no earlier op at
    // all, let alone a parking one. This is D464's "EMPTY BY POSITION" read from the front.
    expect(program).toHaveLength(1);
    // (a) — resolving the attack leaves NO continuation: the phase is back to a normal turn
    // and nothing was persisted. A parking op would leave `phase.cont` behind instead.
    const { state } = swing(board(8, 30), IDX.scaled);
    expect("cont" in state.phase).toBe(false);
    // ⚠️ AND THE SAME IS TRUE ON THE ZERO-COUNTER BOARD, where the op is a silent no-op —
    // a whiff is not a park, and the two are easy to confuse in a `stepOp` arm.
    expect("cont" in swing(board(9, 0), IDX.scaled).state.phase).toBe(false);
  });

  it("🛑 DIRECTION 1 — the OLD spelling is untouched: the bare op gains no key", () => {
    // D125's widening test. The rider's ABSENCE still means what it meant before this slice,
    // byte for byte — a build that made the key required, or that defaulted it to `false`
    // rather than omitting it, fails here.
    expect(JSON.stringify(deriveAttackEffect(BARE)?.[0])).toBe(
      '{"op":"damageSelf","amount":10}',
    );
  });

  it("🛑 DIRECTION 2 — the NEW value round-trips byte for byte, key order kept", () => {
    const fresh = deriveAttackEffect(PRINTED)?.[0];
    expect(JSON.stringify(fresh)).toBe(
      '{"op":"damageSelf","amount":10,"perDamageCounterOnSelf":true}',
    );
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(fresh);
  });

  it("🛑 DIRECTION 3 — a record that LOSES the key degrades LOUDLY (D421's criterion)", () => {
    // A dropped rider makes the recoil place the printed 10 where the card places 10 × N.
    // That is a strictly SMALLER number off by a factor the board can read, not a plausible
    // neighbouring behaviour. ⚠️ IT IS INVISIBLE AT EXACTLY ONE COUNTER, and that exposure is
    // stated rather than claimed away — it is why §3 drives the fold at 3, 7 and 2 and never
    // at 1.
    const fresh = deriveAttackEffect(PRINTED)?.[0];
    const dropped = JSON.parse(
      JSON.stringify(fresh, (k, v) => (k === "perDamageCounterOnSelf" ? undefined : v)),
    ) as EffectOp;
    expect(dropped).toEqual(deriveAttackEffect(BARE)?.[0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the corpus neighbourhood: what this anchor buys, and what it leaves loud.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the family, measured over the whole column rather than described", () => {
  it("🛑 FOURTEEN rows / 72 printings, and exactly ONE of them scales the RECOIL", () => {
    // The loosest plausible shape for "a recoil": every corpus sentence containing
    // `to itself`. ⚠️ **WHAT IT CANNOT SEE**: a recoil spelled without those two words —
    // *"put N damage counters on this Pokémon"* is a different op and a different family, and
    // is deliberately outside this claim.
    const family = legalAttackCorpus().filter(([, s]) => s.includes("to itself"));
    expect([family.length, units(family)]).toEqual([14, 72]);
    // 🛑 **AND THE OBVIOUS NARROWING OVER-INCLUDES, MEASURED RATHER THAN ASSUMED.** TWO of
    // the fourteen contain `for each` — and only one of them scales the RECOIL. The other's
    // `for each` belongs to the ATTACK's own damage clause and its recoil is flat at 30.
    // This is the same mistake `scaledAnySnipe.test.ts`'s family grep makes one file over
    // (`t.includes("damage to ")` matches "damage to ITSELF"), found here by writing the
    // narrow claim first and letting the count disagree.
    const anyForEach = family.filter(([, s]) => /for each/.test(s));
    expect(anyForEach).toHaveLength(2);
    const scaledRecoil = family.filter(([, s]) => /damage to itself for each/.test(s));
    expect(scaledRecoil.map(([, s]) => s)).toEqual([PRINTED]);
    // …so this anchor buys the whole scaled-recoil class and leaves NO printed twin refused
    // for want of the same mechanism — the check that `OPAQUE`-as-EXPENSIVE keeps getting
    // wrong in the other direction.
  });

  it("🛑 the family's UNBUILT remainder is TWO rows, NAMED, and neither wants this rider", () => {
    const unbuilt = legalAttackCorpus()
      .filter(([, s]) => s.includes("to itself") && !resolvedByAnyReader(s))
      .map(([, s]) => s);
    expect(unbuilt).toHaveLength(2);
    // (a) corpus FILE LINE 202, 2 printings — a recoil behind a TWO-COIN threshold. Blocked
    //     on the coin structure (`AttackFlipCount` + a both-tails gate), not on any scaling:
    //     its amount is the flat printed 90.
    expect(unbuilt).toContain(
      "Flip 2 coins. If both of them are tails, this Pokémon also does 90 damage to itself.",
    );
    // (b) corpus FILE LINE 607, 4 printings — a COMPOUND whose head is a taken-Prize damage
    //     multiplier and whose tail is the shipped flat recoil. Blocked on the JOIN, and its
    //     `for each` is the one this file's other rung shows the loose pattern over-includes.
    expect(unbuilt).toContain(
      "This attack does 50 more damage for each Prize card your opponent has taken. This Pokémon also does 30 damage to itself.",
    );
    // …and NEITHER is blocked on the counter rider, which is the claim that makes this slice
    // a closed one rather than the first of a family.
    for (const s of unbuilt) expect(s.includes("damage to itself for each"), s).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the instrument that picked this row, kept executable.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — the span probe's tail repair, which is why this row was visible at all", () => {
  it("🛑 deleting the six-token tail and RE-ATTACHING the period reaches the BUILT twin", () => {
    // This is `scripts/residue-census.ts`'s `keptAfterDeletion`, transcribed as the relation
    // it asserts rather than imported (the script is outside `tsc -b`'s project references and
    // outside vitest's include globs, so importing it here would break the typecheck —
    // `scripts/residue-census-gate.ts` is where the function itself is driven).
    const tok = PRINTED.split(" ");
    const plain = tok.slice(0, tok.length - 6).join(" ");
    // ⚠️ THE PLAIN JOIN IS THE DEFECT: it loses the period and builds nothing.
    expect(plain).toBe("This Pokémon also does 10 damage to itself");
    expect(deriveAttackEffect(plain)).toBeNull();
    // …and the repair — re-attach the sentence terminator — reaches the shipped bare twin.
    expect(`${plain}.`).toBe(BARE);
    expect(resolvedByAnyReader(`${plain}.`)).toBe(true);
  });

  it("the engine version moved and the two spellings agree", () => {
    expect(engineVersion).toBe("0.379.0");
  });
});
