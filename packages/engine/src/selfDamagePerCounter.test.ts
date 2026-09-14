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
    expect([resolved.length, units(resolved)]).toEqual([540, 1578]);  // (🆕🆕🆕 **D513 +1 sentence / +1 printing — THE PRINTED *“of different types”*, THE FIRST DISTINCTNESS CONSTRAINT THIS ENGINE READS** — `censusAttackCorpus.ts` **FILE LINE 473**, *"Search your deck for up to 3 Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (Sylveon ex `sv06.5-050`), claimed by `deriveAttackEffect`. 🛑 **THE ANCHOR WAS NEVER THE BLOCKER** — `ATTACK_HAND_SEARCH`'s `([^,.]+?)` noun group has captured `Basic Energy cards of different types` WHOLE since D231 and the sentence died one step later in `HAND_SEARCH_PLURAL.get`, so the new optional group MOVES a phrase out of the noun rather than admitting a sentence the pattern refused (D510's rule, paid a second time). ✅ **ZERO new `CardFilter` members — and no widening of that union could EVER have reached this row**, because `matchesFilter` narrows each card INDEPENDENTLY while *“of different types”* is a predicate on the ANSWER SET. It rides D332's shipped `chooseCards.caps` instead — one cap of ONE per `energyProvidesOf` cell — so **ZERO** new prompt fields, validator branches or client mirrors. `MATCH_RECORD_VERSION` **HELD at 30**.) (🆕🆕🆕 **D512 +1 sentence / +2 printings — THE BOTH-SIDES BODY COUNT NARROWED BY TWO PRINTED NAME FRAGMENTS** — `censusAttackCorpus.ts` **FILE LINE 583**, *"This attack does 40 damage for each Pokémon in play that has \"Koffing\" or \"Weezing\" in its name (both yours and your opponent's)."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`IN_PLAY_BOTH_SIDES_NAME_MULTIPLY`), ONE new `CardFilter` member (`pokemonNameContaining`) and ONE new `DamageCountSource` member (`bothSidesPokemonInPlay` — the FIRST both-sides count in that union to carry a `CardFilter`; `bothSidesBenchCount` and `bothActivesEnergyCount` are both BARE, because their printed nouns carry no adjective and this one's is NARROWED in print). 🛑 **THE SHIPPED ANCHORS WERE RUN AGAINST THE ROW FIRST AND ALL FOUR REFUSE IT AT THE PATTERN** — the OPPOSITE answer to D510's one row up, and the reason this row genuinely owed a pattern: every in-play anchor requires the literal `for each of your ` and this sentence's head is SEATLESS, with the side named by a trailing parenthetical. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2**, measured at this head rather than carried (D451/D461). RAW summand ALONE: no registry row, no gate split and no trailing split — re-measured unmoved at registry 10/16, gate 5/13, trailing 11/21.) (🆕🆕🆕 **D510 +1 sentence / +2 printings — THE DISCARD PILE NARROWED BY A PRINTED NAME FRAGMENT** — `censusAttackCorpus.ts` **FILE LINE 543**, *"This attack does 20 damage for each Supporter card that has \"Team Rocket\" in its name in your discard pile."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` through ONE new `CardFilter` member (`supporterNameContaining`) and ONE PARAMETERISED noun in `discardPileFilter` — **ZERO new anchors**, because D440’s shipped `DISCARD_PILE_COUNT_MULTIPLY` had matched this row since it was written and the NOUN RESOLVER was the blocker. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2** — a TWO-printing sentence, the opposite of D508 one entry down, measured at this head rather than carried (D451/D461). RAW summand ALONE: registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved.) (🆕🆕🆕 **D508 +1 sentence / +1 printing — THE DISCARD PILE NARROWED BY A PRINTED ATTACK NAME** — `censusAttackCorpus.ts` **FILE LINE 542**, *"This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`DISCARD_PILE_ATTACK_NAME_MULTIPLY`) crossing D440's `cardsInDiscardPile` count with D446's `attackNamePokemon` filter — **ZERO new members in either union, ZERO evaluator bytes**. READER summand ALONE; registry, gate and trailing stand still at 10/16, 5/13, 11/21.) (🆕🆕🆕 **D507 +2 sentences / +2 printings — THE SPREAD THAT HITS **BOTH** BENCHES, AND THE OPTIONAL PRINTED CLAUSE THAT NARROWS IT TO THE ALREADY-DAMAGED BODIES** — `censusAttackCorpus.ts` **FILE LINES 515 and 526**, *"This attack also does 10 damage to each Benched Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)"* and *"This attack also does 40 damage to each Benched Pokémon **that has any damage counters on it** (both yours and your opponent's). (Don't apply…)"*, **2 sentences / 2 legal printings**, both claimed by `deriveAttackEffect` arm **6-ii** over ONE new anchor (`SPREAD_EACH_BOTH_BENCH`) whose OPTIONAL GROUP *is* the rider. 🛑 **THE BOTH-SIDES HALF COSTS NO TYPE AT ALL: it is a TWO-OP PROGRAM OF THE SAME OP** — `spreadDamage { yourBench }` then `spreadDamage { opponentBench }` — which is D482's shipped answer to the identical question one zone over, so `spreadDamage.target` gains **NO third member** and `counterEachAll`'s `filter` + `side` shape was refused rather than copied (D448/D449/D465's thrice-refused widening, same class). The op gains ONE OPTIONAL BOOLEAN RIDER, `damagedOnly` — `counterEachAll`'s own name on its own predicate `hasAnyDamageCounters`, D505's idiom one rider later. **ZERO** new `EffectOp` members, op KINDS, readers (surface unmoved at **13**), `CardFilter`/`BoardCondition`/`DamageCountSource` members, prompts, choice kinds, parks, events, error codes, `GameState`/`InPlayPokemon` fields, registry rows, `FIXTURE_POOL` ids (file-local `cardPool`, D414), `redact.ts` bytes, `packages/schema` bytes or `MATCH_RECORD_VERSION` bytes. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 2 AND 2**, MEASURED at this head rather than carried (D451/D461/D465) — both rows are 1-printing sentences. RAW summand ALONE: no registry row, no gate split, no trailing split — all three re-measured unmoved at registry 10/16, gate 5/13, trailing 11/21.) (🆕🆕🆕 **D505 +1 sentence / +3 printings — THE PRIZE-SCALED BENCH SPREAD, THE MISSING CELL OF A SHIPPED 2×2** — `censusAttackCorpus.ts` **FILE LINE 517**, *"This attack also does 10 damage to each of your opponent's Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 3 legal printings**, claimed by `deriveAttackEffect` arm **6-i** over ONE new anchor (`SPREAD_EACH_BENCH_TAKEN_PRIZES`) and ONE OPTIONAL BOOLEAN RIDER on the SHIPPED `spreadDamage` (`perTakenPrize` — D448's own name spelled on a second op, so `snipeAmount`'s structural parameter folds it UNCHANGED). **ZERO** new `EffectOp` members, op KINDS, readers (surface unmoved at **13**), prompts, choice kinds, parks, events, `GameState`/`InPlayPokemon` fields, registry rows, `FIXTURE_POOL` ids or `MATCH_RECORD_VERSION` bytes. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 3**, so a `.length` site takes +1 where a `units(…)` site takes +3 — the largest single printing step left in the residue's spread family, and the reason this row was worth taking before smaller ones (D451, re-paid again).) (🆕🆕🆕 **D500 +1 sentence / +1 printing — THE PRINTED CARD CATEGORY `Basic`, WHICH IS `Special`'s COMPLEMENT AND NOT A TENTH TYPE** — `censusAttackCorpus.ts` **FILE LINE 580**, *"This attack does 40 damage for each Basic Energy attached to this Pokémon."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` through **ONE ROW in `CLAUSE_ENERGY_TOKENS`** — the anchor `SELF_ENERGY_MULTIPLY` already admitted the token and the refusal lived one step later, in `attachedEnergyFilter`. **ZERO new anchors, ZERO new readers (surface unmoved at 13), ZERO new ops, ZERO new op FIELDS, ZERO new `DamageCountSource` members, ZERO new `FIXTURE_POOL` ids and ZERO `packages/schema` bytes.** ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — the row is 1/1 — and that was VERIFIED at both kinds of site rather than assumed from the row being singular (D451/D461).) (🆕🆕🆕 **D491 +1 sentence / +1 printing — THE ONLY DRAW IN THE COLUMN WHOSE SUBJECT IS NOT THE CONTROLLER** — corpus FILE LINE **199**, *"Each player draws 3 cards."*, claimed WHOLE by `deriveAttackEffect` through ONE new anchor over `drawCards` + ONE optional key `who?: "eachPlayer"`; reader surface still **13**. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1, measured.)   // (🆕🆕🆕 **D489 +1 sentence / +2 printings — THE HAND DISCARD WHOSE COUNT IS THE SNIPE'S MULTIPLIER** — `censusAttackCorpus.ts` FILE LINE **138**, *"Discard up to 3 Energy cards from your hand. This attack does 60 damage to 1 of your opponent's Pokémon for each Energy card you discarded in this way. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `HAND_DISCARD_THEN_SCALED_ANY_TARGET`, ONE new UNION ARM on the shipped `payFromHand` (the declinable `{count: "any"; cap}` quantifier, `discardEnergy.count`'s D361 widening at the sibling op) and ONE OPTIONAL key on the shipped `damageChosen` (`perRecorded: EffectSlot`). 🛑 **THE 2⁵ AXIS-DELETION LATTICE WAS RUN AND EXACTLY ONE OF ITS 32 POINTS BUILDS** — the all-five substitution — so no half of this sentence already shipped. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 AND 2** (D451/D464), so a `.length` site takes +1 where a `units(…)` site takes +2 — read the head name, not the neighbouring term. **ZERO** new `EffectOp` kinds, `EffectSlot` members, `CardFilter`/`DamageCountSource`/`BoardCondition` members, readers (surface still **13**), prompts, choice kinds, events, `FIXTURE_POOL` ids, `redact.ts` bytes, `packages/schema` bytes or `MATCH_RECORD_VERSION` bytes.) (🆕🆕🆕 **D488 +2 sentences / +2 printings — MILL YOUR OWN DECK, THEN SCALE BY WHAT WAS MILLED** — `censusAttackCorpus.ts` FILE LINES **126** and **129**, *"Discard the top {3|7} cards of your deck, and this attack does {80|70} damage for each {Energy card|Misty's Pokémon that} you discarded in this way."*, **2 sentences / 2 legal printings**, both claimed WHOLE by `deriveAttackEffect` through ONE new anchor `DECK_MILL_FILTERED_SCALED_DAMAGE` and TWO OPTIONAL keys on TWO SHIPPED ops (`discardDeckTop.recordAs`, `damageDefender.countFilter`). 🛑 **THE TWO ROWS SHARE ONE BLOCKER AND IT WAS PROVED BY AXIS DELETION, NOT BY RESEMBLANCE** (D483's cluster split 2+2 under the same test). **ZERO** new `EffectOp`/`EffectSlot`/`CardFilter`/`DamageCountSource` members, readers (surface still **13**), prompts, parks, events, `FIXTURE_POOL` ids or `packages/schema` bytes. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 2 AND 2**, MEASURED (D451/D461/D465).) (🆕🆕🆕 **D487 +1 sentence / +1 printing — THE DECK'S OTHER END** — `censusAttackCorpus.ts` FILE LINE **143**, *"Draw 3 cards from the bottom of your deck."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `ATTACK_DRAW_BOTTOM` over the SHIPPED `drawCards` op carrying ONE new OPTIONAL key `from?: "bottom"`. **ZERO** new `EffectOp` members, op VALUES on any other field, `BoardCondition`/`CardFilter` members, readers (surface still **13**), prompts, choice kinds, parks, events, error codes, `GameState`/`InPlayPokemon` fields, registry rows, `FIXTURE_POOL` ids (file-local `cardPool`, D414), `redact.ts` bytes or `packages/schema` bytes. 🛑 **`MATCH_RECORD_VERSION` STAYS 29 AND THE ADDRESS DOES PERSIST** — `drawCards` rides `recordGate.then` behind `payFromHand`'s park into `state.phase`, so this is NOT D470/D472's no-carrier argument; it is D125's WIDENING, DRIVEN in the LOSS direction (a v29 op with the key ABSENT still draws the TOP). ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1**, MEASURED here rather than carried (D451/D461/D465). RAW summand ALONE: no registry row, no gate split, no trailing split — re-measured unmoved at registry 10/16, gate 5/13, trailing 11/21.) (🆕🆕🆕 **D486 +1 sentence / +1 printing — THE GATED INCREMENT ON THE OPPONENT'S HAND DISCARD** — `censusAttackCorpus.ts` FILE LINE **668**, *"Your opponent discards a card from their hand. If this Pokémon evolved from Salandit during this turn, your opponent discards 2 more cards."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `ATTACK_OPPONENT_DISCARDS_HAND_MORE` over a TWO-OP program of ops that ALL SHIPPED (`opponentDiscardsFromHand` + `conditionGate` on D393's `yourActiveEvolvedFromThisTurn`), plus ONE new literal `CONDITIONAL_DAMAGE_CLAUSES` row. **ZERO** new op members, op fields, op values, `BoardCondition` members, readers (surface still 13), `interpreter.ts` bytes, `redact.ts` bytes or `packages/schema` bytes. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1, MEASURED.) (🆕🆕🆕 D485 +1 sentence / +1 printing — THE MANDATORY FILTERED SWEEP OF THE OPPONENT'S HAND, `censusAttackCorpus.ts` FILE LINE **673**, *"Your opponent reveals their hand. Discard all Item cards and Pokémon Tool cards you find there."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `ATTACK_REVEAL_AND_SWEEP` over the shipped `revealOpponentHand` plus ONE new `EffectOp` member `discardFromOpponentHand { filter: CardFilter }`. **ZERO** new `CardFilter` members — the printed *"Item cards and Pokémon Tool cards"* is `anyOf` over the shipped `item` and `toolCard` — and zero new op VALUES, prompts, events, error codes or `packages/schema` bytes; reader surface still **13**. RAW summand ALONE: no registry row, no gate split, no trailing split (10/16, 5/13, 11/21 all re-measured unmoved). ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1**, MEASURED at this head rather than carried (D451/D461/D465).) // (🆕🆕🆕 D483 +2 sentences / +2 printings — THE PRINTED CANDIDATE **CLASS** ON THE BENCHED SNIPE, `censusAttackCorpus.ts` FILE LINES **111** and **615**, **2 sentences / 2 legal printings**, both claimed WHOLE by `deriveAttackEffect` (arms 9b-bis and 6c) through ONE new group on the SHARED fragment `ALSO_BENCHED_SNIPE_BODY` and ONE new OPTIONAL op field `damageChosen.filter?: CardFilter`. RAW summand ALONE; reader surface still 13. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 2 AND 2, MEASURED at this head.) // (🆕🆕 D482 +1 sentence / +1 printing — THE WHOLE-SIDE SPREAD, `censusAttackCorpus.ts` FILE LINE **572**, *"This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` arm 6a-bis through ONE new anchor `SPREAD_EACH_OPPONENT_POKEMON` over a TWO-OP PROGRAM OF SHIPPED OPS (`damageDefender` flat + `spreadDamage { target: "opponentBench" }`) — **ZERO new op members, fields, values or `interpreter.ts` bytes**, reader surface still 13. RAW summand ALONE: no registry row, no gate split, no trailing split. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1.)// (🆕🆕 D479 +1 sentence / +1 printing — THE ATTACK-SIDE HAND REFRESH, `censusAttackCorpus.ts` FILE LINE 486, *"Shuffle your hand into your deck. Then, draw {N} cards."*, 1 sentence / 1 legal printing, claimed WHOLE by `deriveAttackEffect` arm 44b through ONE new anchor `SHUFFLE_HAND_DRAW` over `handRefresh { who: "you", draw: { kind: "fixed", count } }` — Youngster `sv01-198`'s hand-authored trainer program at a second address, so ZERO new `EffectOp` members, op FIELDS, op VALUES, readers (surface still 13), prompts, events, `interpreter.ts` or `redact.ts` bytes. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1, unlike D478's 1-vs-2 — derived here, not carried.) // (D478 +1 sentence / +2 printings — THE OTHER BRANCH OF A GATE THAT ALREADY SHIPS, `censusAttackCorpus.ts` FILE LINE 263, *"Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Confused."*, 1 sentence / 2 legal printings, claimed WHOLE by `deriveAttackEffect` arm 2b-bis through ONE new anchor `FLIP_DEFENDER_PAIR_OR_TAILS_STATUS` over a `coinFlipGate` with BOTH arms filled. `coinFlipGate.otherwise` shipped at D269 and arm 6d has emitted a two-armed gate since D416, so the mechanism the old refusal called absent was 209 decisions old. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2 — one file line, two legal printings; D476's and D475's agreed at 1 and 1, so this term was DERIVED here and not carried. RAW summand ALONE: no registry row, no gate split, no trailing split, reader surface still 13, ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414), ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, events or `interpreter.ts` bytes.) // (🆕🆕 D476 +1 sentence / +1 printing — THE FACE AXIS, THE LAST OPEN AXIS OF THE PRINTED PER-FACE FAMILY — `censusAttackCorpus.ts` **FILE LINE 217**, *"Flip 3 coins. For each tails, discard an Energy from this Pokémon."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor (`ATTACK_COIN_SELF_ENERGY_PER_TAILS`) and ONE **REQUIRED** `face: CoinFace` FIELD on the shipped `programPerHeads` member. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — D472's disagreed at 1 and 2, D473's agreed at 2 and 2, D474's disagreed at 1 and 2, D475's agreed at 1 and 1 — so this term was DERIVED at this head and not carried from the previous slice (D451/D461/D464). RAW summand ALONE: no registry row, no gate split, no trailing split, reader surface still 13, and **ZERO new `FIXTURE_POOL` ids** (file-local `cardPool`, D414), so every id ladder takes a ZERO term. ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, events, error codes or `AttackCoinFlip` MEMBERS — the op is `SELF_DISCARD_ONE`'s output byte for byte, and the FACE rides the member that already shipped.) // (🆕🆕 D475 +1 sentence / +1 printing — THE COIN FLIP COUNTED OVER BOTH ACTIVES — `censusAttackCorpus.ts` **FILE LINE 231**, *"Flip a coin for each Energy attached to both Active Pokémon. This attack does 60 damage for each heads."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor and a FIFTH, NULLARY `AttackFlipCount` member `bothActivesEnergy`. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — D472's disagreed at 1 and 2, D473's agreed at 2 and 2, D474's disagreed at 1 and 2, so this term was DERIVED at this head and not carried from the previous slice (D451/D461/D464). RAW summand ALONE: no registry row, no gate split, no trailing split, D464's compound route measured EMPTY, reader surface still 13, and **NO new `FIXTURE_POOL` id** — the printed sentence has sat on `fix-bothactives` index 2 as a refusal witness since D196, so every id ladder takes a ZERO term.) // 🆕🆕 D474 +1 sentence / +2 printings (THE BOARD-COUNTED COIN FLIP OVER BODIES — `censusAttackCorpus.ts` **FILE LINE 233**, *"Flip a coin for each {D} Pokémon you have in play. This attack does 60 damage for each heads."*, **1 sentence / 2 legal printings**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor and ONE new `AttackFlipCount` member `pokemonInPlay`. ⚠️ **THIS IS A LIVE HEAD, NOT A FROZEN TAIL** (D461/D462): the literal moves and there is no front term to add. ⚠️ **AND THE TWO UNITS DISAGREE, 1 AND 2** — the opposite of D473's 2-and-2 — so the number here was read off THIS assertion's head rather than copied from a sibling site. RAW summand ALONE: no registry row, no gate split, no trailing split, D464's compound route measured EMPTY, reader surface still 13.) // 🆕🆕 D470 +1 sentence / +1 printing (THE BOARD-WIDE OWN-SIDE ENERGY COUNT, NARROWED BY A PRINTED SUBGROUP NOUN — `censusAttackCorpus.ts` **FILE LINE 558**, *"This attack does 20 more damage for each {L} Energy attached to all of your Iono's Pokémon."*, **1 legal printing**, claimed WHOLE by `deriveAttackDamageBonus` through the new `SELF_ENERGY_FILTERED_SCALE` anchor. ONE anchor, ONE reader arm, ONE **OPTIONAL FIELD ON THE SHIPPED** `energyOnSelf` member (`filter?: CardFilter`), ONE evaluator branch and ONE **OPTIONAL PARAMETER ON THE SHARED** `countEnergyInPlay` — whose THREE call sites (`energyOnOpponent`'s board arm, `energyOnSelf`'s, and `interpreter.ts`'s `yourEnergyInPlayAtLeast`, the third of which is NOT an op) are byte-identical, because `undefined` is every body. D454's blast radius, ENUMERATED before a byte was written. DISJOINT FROM `SELF_ENERGY_SCALE` BY STRUCTURE and not by the lookahead, which D467/D468 require saying: both are `^…$` and this one demands a run of bytes ending in a SPACE that the shipped literal cannot spend; the `(?!opponent)` lookahead is a DIFFERENT guard doing a DIFFERENT job (it refuses a SEAT, not a subgroup) and it IS killable. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op fields, op values, prompts, events, error codes, registry rows, `CardFilter` MEMBERS, `packages/schema` bytes or `redact.ts` bytes; ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414). **`MATCH_RECORD_VERSION` STAYS 29** — an `AttackDamageBonus` is a parse-time LOCAL inside `attack()`, and `CardFilter` IS persisted but gains no MEMBER here (`ownerPokemon` has been an inhabitant since D242), driven over the SERIALIZED BYTES in `ownerBoardEnergyScaling.test.ts` §8.)  // 🆕🆕🆕 **D490 +1 sentence / +2 printings — THE MILL OF BOTH DECKS, SCALED BY THE ENERGY AMONG WHAT IT MILLED** (`censusAttackCorpus.ts` FILE LINE 130; the LAST unbuilt member of the `discarded in this way` family, claimed by `deriveAttackDiscardScaledBoost`'s new `eachDeckMill` member — the reader SURFACE stands still at 13). ⚠️ THE TWO STEPS DISAGREE, 1 AND 2.
    // 🆕🆕 D469 +1 sentence / +1 printing (THE OPPONENT'S WHOLE BOARD OF DAMAGE COUNTERS — `censusAttackCorpus.ts` **FILE LINE 534**, *"This attack does 10 more damage for each damage counter on all of your opponent's Pokémon."*, **1 legal printing**, claimed WHOLE by `deriveAttackDamageBonus` through the new `OPPONENT_BOARD_COUNTER_SCALE` anchor. ONE anchor, ONE reader arm, ONE NULLARY `DamageCountSource` member (`damageCountersOnOpponentBoard`), ONE evaluator arm and ONE shared board counter (`countDamageCountersInPlay`, continuous.ts, beside `countEnergyInPlay`/`countToolsInPlay`) — D406's cost table verbatim, at a second address. DISJOINT FROM `OPPONENT_COUNTER_SCALE` BY STRUCTURE and not by a lookahead, which D467/D468 require saying: both are `^…$` and disagree on a mandatory run of bytes at the same position. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op fields, op values, prompts, events, error codes, registry rows, `packages/schema` bytes or `redact.ts` bytes; ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414). **`MATCH_RECORD_VERSION` STAYS 29** — an `AttackDamageBonus` is a parse-time LOCAL inside `attack()` and there is no carrier at all, driven over the SERIALIZED BYTES in `opponentBoardCounterScaling.test.ts` §8 rather than reasoned from the type's name (D427).) // 🆕🆕 D468 +1 sentence / +1 printing (THE TYPED SELF-SWITCH — `censusAttackCorpus.ts` **FILE LINE 499**, *"Switch this Pokémon with 1 of your Benched {L} Pokémon."*, **1 legal printing**. ⚠️ **A LIVE HEAD, NOT A CHAIN — SO THE LITERAL MOVES AND NOTHING IS ADDED AT THE FRONT** (D461's table: the tell is the left-hand side of the assertion). ⚠️ **AND THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 HERE**, which is the easy case and is not a shape that carries — D467's was 2 vs 3.)  // 🆕🆕 D467 +2 sentences / +3 printings (THE ATTACKER'S OWN BENCH NARROWED BY A PRINTED NOUN, ON BOTH OF ITS COUNTING AXES — `censusAttackCorpus.ts` **file lines 544 and 622**, *"This attack does 20 damage for each damage counter on all of your Benched {F} Pokémon."* (2 legal, the `×` fold) and *"This attack does 80 more damage for each of your Benched Charjabug."* (1 legal, the `+` fold), **2 sentences / 3 legal printings**. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 2 vs 3** — two file lines carrying 2 and 1 printings, so MEASURE each site rather than copying one number into the other kind (D451/D461/D466). RAW summand ALONE: no registry row, no gate split, no trailing split, and the reader surface stands still at 13. TWO new anchors, ONE new OPTIONAL field on the shipped `damageCountersOnYourBench` member, ONE new `IN_PLAY_BODY_NOUNS` row and ZERO new `CardFilter` members — so `MATCH_RECORD_VERSION` STAYS 29 on the SERIALIZED-ALPHABET shape (D462) at ONE address, not two.)
    // 🆕🆕 D466 +2 sentences / +3 printings (THE PRINTED EVOLUTION-STAGE ORDINAL AS A BODY FILTER — `censusAttackCorpus.ts` **file lines 586 and 589**, *"This attack does 40 damage for each of your Stage 1 Pokémon in play."* (1 legal, the `×` fold) and *"This attack does 40 more damage for each Stage 2 Pokémon on your Bench."* (2 legal, the `+` fold), **2 sentences / 3 legal printings**, claimed by `deriveAttackDamageMultiplier` and `deriveAttackDamageBonus` respectively. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 2 vs 3** — two file lines carrying 1 and 2 printings, so a pass that copied one number into the other kind of site would be wrong at every site of the other kind (D451/D461); MEASURE each site. ONE new `CardFilter` member (`stagePokemon`, delegating to cards.ts `isStage1Pokemon`/`isStage2Pokemon`, which D387/D262 had already written for the `boardCondition` antecedents) and TWO new `IN_PLAY_BODY_NOUNS` rows — which is the WHOLE of file line 586, with **ZERO new anchors**, because D439's two shipped `in play` anchors already reached it and only the VOCABULARY refused. File line 589 costs ONE new anchor (`YOUR_BENCH_FILTERED_SCALE`) and ONE new OPTIONAL FIELD on the SHIPPED `yourBenchCount` member (`filter?: CardFilter`, D407's `energyOnSelf.zone` shape) — `undefined` is every body, so all ten shipped printings of that member emit a filter-less object byte for byte as before. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op fields, op values, prompts, events, error codes, registry rows, `packages/schema` bytes or `redact.ts` bytes; ONE new FIXTURE id (`fix-stage2body`) and ONE new attack on `fix-inplaybodies`. **`MATCH_RECORD_VERSION` STAYS 29 AT TWO ADDRESSES** — `CardFilter` IS persisted (D446 measured it: nine `EffectOp` fields carry one and an op rides `state.phase.cont.pendingOp`) and a WIDENING is free; `DamageCountSource` is PARSE-TIME and is not at a persisted address at all. 🛑 **`OPAQUE` MOVES, 81/116 → 80/114, AND `PHRASE-2` EMPTIES, 1/1 → 0/0 — AND THE INSTRUMENT STOOD STILL THIS SLICE** (`residue-census.ts` is untouched by D466), so unlike D465 this class-table delta really is a statement about the WORK.) 
    // …and the step is THIS sentence and nothing else: remove it and the pair is D464's.
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([without.length, units(without)]).toEqual([539, 1577]);  // (🆕🆕🆕 **D513 +1 sentence / +1 printing — THE PRINTED *“of different types”*, THE FIRST DISTINCTNESS CONSTRAINT THIS ENGINE READS** — `censusAttackCorpus.ts` **FILE LINE 473**, **1 sentence / 1 legal printing** (Sylveon ex `sv06.5-050`), claimed by `deriveAttackEffect`. 🛑 **THE ANCHOR WAS NEVER THE BLOCKER** — `ATTACK_HAND_SEARCH`'s `([^,.]+?)` noun group captured `Basic Energy cards of different types` WHOLE from the day it was written, and the refusal was one step later in `HAND_SEARCH_PLURAL.get` (D510's rule, paid a second time). ✅ **ZERO new `CardFilter` members, and no widening of that union could ever reach this row** — it rides D332's shipped `chooseCards.caps`, one cap of ONE per `energyProvidesOf` cell, so ZERO new prompt fields, validator branches or client mirrors. `MATCH_RECORD_VERSION` **HELD at 30**.) (🆕🆕🆕 **D512 — THE BOTH-SIDES BODY COUNT NARROWED BY TWO PRINTED NAME FRAGMENTS** — `censusAttackCorpus.ts` **FILE LINE 583**, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor, ONE new `CardFilter` member (`pokemonNameContaining`) and ONE new `DamageCountSource` member (`bothSidesPokemonInPlay`). **+1 sentence / +2 printings**, which this BEFORE-figure inherits because it is the live sum minus this slice's own row.) (🆕🆕🆕 **D510 +1 sentence / +2 printings — THE DISCARD PILE NARROWED BY A PRINTED NAME FRAGMENT** — `censusAttackCorpus.ts` **FILE LINE 543**, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` through ONE `CardFilter` member and ONE parameterised noun, **ZERO new anchors**. ⚠️ The SENTENCE step and the PRINTING step DISAGREE at 1 and 2.) (🆕🆕🆕 **D508 +1 sentence / +1 printing — THE DISCARD PILE NARROWED BY A PRINTED ATTACK NAME** — `censusAttackCorpus.ts` **FILE LINE 542**, *"This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`DISCARD_PILE_ATTACK_NAME_MULTIPLY`) crossing D440's `cardsInDiscardPile` count with D446's `attackNamePokemon` filter — **ZERO new members in either union, ZERO evaluator bytes**. READER summand ALONE; registry, gate and trailing stand still at 10/16, 5/13, 11/21. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1**, measured per site rather than copied between the two kinds of site (D451/D461).) 🆕🆕🆕 **D505 +1 sentence / +3 printings — THE PRIZE-SCALED BENCH SPREAD (corpus FILE LINE 517).** This pair is the resolving set MINUS this file's own sentence, so it steps by exactly what the line above it steps by — which is the point of measuring both: a slice that moved only one of the two would be visible here (D451/D465). (🆕🆕🆕 **D500 +1 sentence / +1 printing — THE PRINTED CARD CATEGORY `Basic`, WHICH IS `Special`'s COMPLEMENT AND NOT A TENTH TYPE** — `censusAttackCorpus.ts` **FILE LINE 580**, *"This attack does 40 damage for each Basic Energy attached to this Pokémon."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` through **ONE ROW in `CLAUSE_ENERGY_TOKENS`** — the anchor `SELF_ENERGY_MULTIPLY` already admitted the token and the refusal lived one step later, in `attachedEnergyFilter`. **ZERO new anchors, ZERO new readers (surface unmoved at 13), ZERO new ops, ZERO new op FIELDS, ZERO new `DamageCountSource` members, ZERO new `FIXTURE_POOL` ids and ZERO `packages/schema` bytes.** ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — the row is 1/1 — and that was VERIFIED at both kinds of site rather than assumed from the row being singular (D451/D461).) (🆕🆕🆕 **D491 ±1: THE ONLY DRAW IN THE COLUMN WHOSE SUBJECT IS NOT THE CONTROLLER** — corpus FILE LINE **199**, *"Each player draws 3 cards."*, 1 sentence / 1 legal printing.)  //  // 🆕🆕🆕 **D490 +1 sentence / +2 printings — THE MILL OF BOTH DECKS, SCALED BY THE ENERGY AMONG WHAT IT MILLED** (`censusAttackCorpus.ts` FILE LINE 130). ⚠️ THE TWO STEPS DISAGREE, 1 AND 2. (🆕🆕🆕 **D489 +1 sentence / +2 printings — THE HAND DISCARD WHOSE COUNT IS THE SNIPE'S MULTIPLIER; `censusAttackCorpus.ts` FILE LINE 138. ⚠️ THE TWO STEPS DISAGREE, 1 AND 2** — read the head name, not the neighbouring term.) (🆕🆕🆕 **D488 +2 sentences / +2 printings — MILL YOUR OWN DECK, THEN SCALE BY WHAT WAS MILLED** — `censusAttackCorpus.ts` FILE LINES **126** and **129**, *"Discard the top {3|7} cards of your deck, and this attack does {80|70} damage for each {Energy card|Misty's Pokémon that} you discarded in this way."*, **2 sentences / 2 legal printings**, both claimed WHOLE by `deriveAttackEffect` through ONE new anchor `DECK_MILL_FILTERED_SCALED_DAMAGE` and TWO OPTIONAL keys on TWO SHIPPED ops (`discardDeckTop.recordAs`, `damageDefender.countFilter`). 🛑 **THE TWO ROWS SHARE ONE BLOCKER AND IT WAS PROVED BY AXIS DELETION, NOT BY RESEMBLANCE** (D483's cluster split 2+2 under the same test). **ZERO** new `EffectOp`/`EffectSlot`/`CardFilter`/`DamageCountSource` members, readers (surface still **13**), prompts, parks, events, `FIXTURE_POOL` ids or `packages/schema` bytes. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 2 AND 2**, MEASURED (D451/D461/D465).) (🆕🆕🆕 **D487 +1 sentence / +1 printing — THE DECK'S OTHER END** — `censusAttackCorpus.ts` FILE LINE **143**, *"Draw 3 cards from the bottom of your deck."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `ATTACK_DRAW_BOTTOM` over the SHIPPED `drawCards` op carrying ONE new OPTIONAL key `from?: "bottom"`. ⚠️ **SECOND-WAVE SITE — masked behind a first failing `expect(` in the same `it` (D473's masked-second-failure effect), so it was found by a SECOND `check` round rather than by the first.** **ZERO** new `EffectOp` members, readers (surface still **13**), registry rows or `packages/schema` bytes; 🛑 **`MATCH_RECORD_VERSION` STAYS 29** at an address that DOES persist — D125's widening, driven in the LOSS direction. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1**, MEASURED at each site rather than copied between them (D451/D461).) (🆕🆕🆕 **D486 +1 sentence / +1 printing — THE GATED INCREMENT ON THE OPPONENT'S HAND DISCARD** — `censusAttackCorpus.ts` FILE LINE **668**, *"Your opponent discards a card from their hand. If this Pokémon evolved from Salandit during this turn, your opponent discards 2 more cards."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `ATTACK_OPPONENT_DISCARDS_HAND_MORE` over a TWO-OP program of ops that ALL SHIPPED (`opponentDiscardsFromHand` + `conditionGate` on D393's `yourActiveEvolvedFromThisTurn`), plus ONE new literal `CONDITIONAL_DAMAGE_CLAUSES` row. **ZERO** new op members, op fields, op values, `BoardCondition` members, readers (surface still 13), `interpreter.ts` bytes, `redact.ts` bytes or `packages/schema` bytes. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1, MEASURED.) (🆕🆕🆕 D485 +1 sentence / +1 printing — THE MANDATORY FILTERED SWEEP OF THE OPPONENT'S HAND, `censusAttackCorpus.ts` FILE LINE **673**, *"Your opponent reveals their hand. Discard all Item cards and Pokémon Tool cards you find there."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `ATTACK_REVEAL_AND_SWEEP` over the shipped `revealOpponentHand` plus ONE new `EffectOp` member `discardFromOpponentHand { filter: CardFilter }`; ZERO new `CardFilter` members and reader surface still **13**. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1, MEASURED at this head.) // (🆕🆕🆕 D483 +2 sentences / +2 printings — THE PRINTED CANDIDATE **CLASS** ON THE BENCHED SNIPE, `censusAttackCorpus.ts` FILE LINES **111** and **615**, **2 sentences / 2 legal printings**, both claimed WHOLE by `deriveAttackEffect` (arms 9b-bis and 6c) through ONE new group on the SHARED fragment `ALSO_BENCHED_SNIPE_BODY` and ONE new OPTIONAL op field `damageChosen.filter?: CardFilter`. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 2 AND 2, MEASURED. ⚠️ FOUND ON A SECOND `check` ROUND, BEHIND A SITE IN THE SAME `it` THAT THREW FIRST — D462's rule: vitest stops an `it` at its first throw, so a spelling-keyed pass is always short and the ROUND COUNT is the measurement.) // (🆕🆕 D479 +1 sentence / +1 printing — THE ATTACK-SIDE HAND REFRESH, `censusAttackCorpus.ts` FILE LINE 486, *"Shuffle your hand into your deck. Then, draw {N} cards."*, claimed WHOLE by `deriveAttackEffect` arm 44b through ONE new anchor `SHUFFLE_HAND_DRAW` over `handRefresh { who: "you", draw: { kind: "fixed", count } }` — Youngster `sv01-198`'s hand-authored program at a second address. ZERO new op members/fields/values, reader surface still 13. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1.) // (D478 +1 sentence / +2 printings — THE OTHER BRANCH OF A GATE THAT ALREADY SHIPS, `censusAttackCorpus.ts` FILE LINE 263, *"Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Confused."*, 1 sentence / 2 legal printings, claimed WHOLE by `deriveAttackEffect` arm 2b-bis through ONE new anchor `FLIP_DEFENDER_PAIR_OR_TAILS_STATUS` over a `coinFlipGate` with BOTH arms filled. `coinFlipGate.otherwise` shipped at D269 and arm 6d has emitted a two-armed gate since D416, so the mechanism the old refusal called absent was 209 decisions old. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2 — one file line, two legal printings; D476's and D475's agreed at 1 and 1, so this term was DERIVED here and not carried. RAW summand ALONE: no registry row, no gate split, no trailing split, reader surface still 13, ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414), ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, events or `interpreter.ts` bytes.) // (🆕🆕 D476 +1 sentence / +1 printing — THE FACE AXIS, THE LAST OPEN AXIS OF THE PRINTED PER-FACE FAMILY — `censusAttackCorpus.ts` **FILE LINE 217**, *"Flip 3 coins. For each tails, discard an Energy from this Pokémon."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor (`ATTACK_COIN_SELF_ENERGY_PER_TAILS`) and ONE **REQUIRED** `face: CoinFace` FIELD on the shipped `programPerHeads` member. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — D472's disagreed at 1 and 2, D473's agreed at 2 and 2, D474's disagreed at 1 and 2, D475's agreed at 1 and 1 — so this term was DERIVED at this head and not carried from the previous slice (D451/D461/D464). RAW summand ALONE: no registry row, no gate split, no trailing split, reader surface still 13, and **ZERO new `FIXTURE_POOL` ids** (file-local `cardPool`, D414), so every id ladder takes a ZERO term. ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, events, error codes or `AttackCoinFlip` MEMBERS — the op is `SELF_DISCARD_ONE`'s output byte for byte, and the FACE rides the member that already shipped.) // (🆕🆕 D475 +1 sentence / +1 printing — THE COIN FLIP COUNTED OVER BOTH ACTIVES, `censusAttackCorpus.ts` **FILE LINE 231**, claimed WHOLE by `deriveAttackCoinFlip`. ⚠️ FOUND ON THE SECOND `check` ROUND, BEHIND A SITE IN THE SAME `it` THAT THREW FIRST — D462's rule: vitest stops an `it` at its first throw, so a spelling-keyed pass is always short and the round count is the measurement.) // 🆕🆕 D474 +1 sentence / +2 printings (THE BOARD-COUNTED COIN FLIP OVER BODIES — `censusAttackCorpus.ts` **FILE LINE 233**, **1 sentence / 2 legal printings**, claimed WHOLE by `deriveAttackCoinFlip`. ⚠️ **FOUND ON THE SECOND `check` ROUND, BEHIND A SITE THAT THREW FIRST** — D462's rule: vitest stops an `it` at its first throw, so a spelling-keyed pass is always short. The head name was read at THIS site rather than copied from the sibling above it.) // 🆕🆕 D470 +1 sentence / +1 printing (THE BOARD-WIDE OWN-SIDE ENERGY COUNT, NARROWED BY A PRINTED SUBGROUP NOUN — `censusAttackCorpus.ts` **FILE LINE 558**, *"This attack does 20 more damage for each {L} Energy attached to all of your Iono's Pokémon."*, **1 legal printing**, claimed WHOLE by `deriveAttackDamageBonus` through the new `SELF_ENERGY_FILTERED_SCALE` anchor — ONE anchor, ONE arm, ONE OPTIONAL field on the SHIPPED `energyOnSelf` member, ONE evaluator branch, ONE OPTIONAL parameter on the SHARED `countEnergyInPlay`. RAW summand ALONE; the reader surface stands still at 13.) // (🆕🆕🆕 D482 — the WHOLE-SIDE SPREAD raises the head by 1 sentence / 1 printing (`censusAttackCorpus.ts` FILE LINE 572, arm 6a-bis, `SPREAD_EACH_OPPONENT_POKEMON` over `damageDefender` + `spreadDamage`), so this DERIVED figure moves with it. This slice's own sentence is NOT in this file's subtracted set, which is why the figure steps by exactly the head's step.)
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
    expect(engineVersion).toBe("0.400.0");
  });
});
