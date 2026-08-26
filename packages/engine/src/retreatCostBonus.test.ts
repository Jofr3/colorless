import { describe, expect, it } from "vitest";
import { retreatCostOf } from "./cards";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "./censusAttackCorpus";
import { effectiveRetreatCost } from "./continuous";
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
import type { BoardCondition, GameState, InPlayPokemon, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  RETREAT_COST_BONUS_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 🆕🆕 D388 — ONE PRINTED NOUN PHRASE, TWO LIVE READINGS, AND THE SHAPE QUESTION
// SETTLED BEFORE A LINE WAS WRITTEN.
//
// D387 measured this row as the cheapest thing in the residue (**1 printing / 2
// mechanisms = 0.50**) and DELIBERATELY DID NOT TAKE IT, on D368's rule rather than
// on price: its SHAPE question was open. The printed noun phrase is *"the Retreat
// Cost of your opponent's Active Pokémon"*, and **this engine has TWO live readings
// of it, both already implemented and both already with consumers**:
//
//   • `retreatCostOf(card)` (cards.ts) — the printed {C} column, one field read;
//   • `effectiveRetreatCost(state, pokemon)` (continuous.ts, D322) — the BOARD FOLD:
//     printed + `stadiumRetreatDelta` + `opposingRetreatSurcharge` −
//     `alliedRetreatDiscount`, under ONE `Math.max(0, …)`, with the two free-retreat
//     auras short-circuiting to 0.
//
// **THEY DISAGREE ON EVERY BOARD CARRYING A RETREAT STADIUM OR A RETREAT AURA, AND
// THIS POOL HAS BOTH.** So the question was never "which do I build" but "which does
// the sentence NAME", and picking without asking would have been a coin toss with a
// 50 % chance of a silently wrong card.
//
// 🛑 **THE FOLD IS TAKEN, ON THREE GROUNDS AND NOT ON TASTE — AND §1 DRIVES ALL
// THREE RATHER THAN ASSERTING THEM.**
//   ⑴ THE ENGINE HAD ALREADY ANSWERED THIS EXACT NOUN PHRASE. `DamageCountSource`'s
//      `opponentActiveRetreatCost` (D110) reads *"for each {C} in your opponent's
//      Active Pokémon's Retreat Cost"* and attack.ts resolves it through the FOLD.
//      D159 forbids a second answer to a question the engine already answers, and a
//      printed reading here would make ONE printed phrase mean two things in one
//      engine.
//   ⑵ THE RULES MAKE RETREAT COST A CURRENT VALUE. `reference/ptcg-rules.md` §11
//      defines the cost off the printed symbols and records that effects reduce it,
//      but is SILENT on what a card TEXT naming it reads — so this went to the web,
//      as D373's did. The official account states an ORDER OF OPERATIONS over the
//      value (increases first, then reductions; a Pokémon left with no Retreat Cost
//      by an effect overrides every increase), which is arithmetic over something
//      that CHANGES. A printed constant would need no order of operations at all.
//   ⑶ AND IT IS THE READING WITH A FALSIFIER. §3 and §4 put the two readings on
//      OPPOSITE sides of the threshold, in BOTH directions, on four real boards.
//
// 🛑 **A GUARD THAT ONLY EXERCISES BOARDS WHERE THE TWO READINGS AGREE IS THE
// VACUOUS GUARD THIS REPO KEEPS REDISCOVERING (D200 → D214).** So every disagreement
// rung below asserts, on that board and before it reads any damage, that
// `retreatCostOf` and `effectiveRetreatCost` return DIFFERENT NUMBERS — D214's
// attribution control, applied to a pair of readings rather than to a build artifact.
//
// WHAT SHIPS: **1 parameterised union member** (`opponentActiveRetreatCostAtLeast`)
// with **2 reader arms**, and **1 literal clause row**. ZERO new card predicates and
// ZERO new modifier fixtures — all three retreat levers were already in the pool.
// Talonflame `sv07-123` "Aero Chase" ({C}{C}, `110+`, **+110**, index 0 of ONE),
// **1 legal printing**. `MATCH_RECORD_VERSION` **STAYS 23**.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/** The TWELVE live readers.

    🛑🛑 **D418 — CORRECTED, WITH THE WRONG SENTENCE LEFT VISIBLE ABOVE ITS
    CORRECTION (D178).** This block read, verbatim:

    > *"The nine live readers, run as one — the same set `censusAtHead.test.ts`,
    > `benchNamedBonus.test.ts` and `stage1Bonus.test.ts` use."*

    ⚠️ **THIS IS THE MOST BADLY WARRANTED OF THE SIX WORDINGS, BECAUSE IT NAMES
    THREE FILES INSTEAD OF ONE.** `censusAtHead.test.ts` ran TWELVE readers, and
    `benchNamedBonus.test.ts` ran nine — so the sentence was simultaneously wrong
    about the first and right about the second, and being right about the second is
    worthless: it was agreeing with a copy that was ALSO stale, which is what made
    the whole family look consistent while every file in it was wrong together.
    ⚠️ **CROSS-REFERENCING COPIES IS NOT A CHECK. IT IS THE APPEARANCE OF ONE.**

    The list has been nine long since **D381 (2026-08-21)** and missed
    `deriveAttackOptionalCostBoost` (D381), `deriveAttackDiscardScaledBoost` (D403)
    and `deriveAttackCancelRequirement` (D417). §7's head figure below was 406 /
    1,347 and is 412 / 1,364 (🆕🆕 D420 then took it to 415 / 1,368 through the RAW
    summand). The three FROZEN tails ([368, 1260], [367, 1259],
    [366, 1258]) do not move, which is the proof the error was only ever in the
    live-head term.

    ⚠️ WHAT CHANGED STRUCTURALLY: the figures are computed through
    `resolvedByAnyReader` IMPORTED FROM `censusAttackCorpus.ts`, off the MODULE
    surface. This list is now a DECLARED EXPECTATION, checked against the module by
    §7's first rung, and nothing else. */
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
  // 🆕🆕 D418 — the TENTH, ELEVENTH and TWELFTH (D381, D403, D417).
  deriveAttackOptionalCostBoost,
  deriveAttackDiscardScaledBoost,
  deriveAttackCancelRequirement,
];

/** THE SENTENCE THIS SLICE BUYS, byte for byte off the printing. */
const TAKEN =
  "If the Retreat Cost of your opponent's Active Pokémon is {C}{C} or more, this attack does 110 more damage.";

/** The one id behind it — Talonflame `sv07-123`, "Aero Chase" at index 0 of ONE,
    confirmed by id against tcgdex (`/v2/en/cards/sv07-123`: 140 HP, `Stage2`,
    `types: ["Colorless"]`, cost {C}{C}, damage `110+`, this effect byte for byte)
    and by a whole-sentence limitlesstcg `text:` search, which returns Talonflame
    SCR 123 as the only card in the intersection. The PRINTING COUNT is
    `legalAttackCorpus()`'s, never the web's. */
const TAKEN_ID = "sv07-123";

/** The SIBLING sentences — the same printed noun phrase under the "for each {C}"
    skeleton instead of a threshold — with their legal printing counts and whether
    a reader answers them today. The two that RESOLVE are the ones attack.ts sends
    through `effectiveRetreatCost`; the "less" pair sits in a different residue.
    Measured off `legalAttackCorpus()`, not inherited from a doc comment. */
const NOUN_PHRASE_SIBLINGS: readonly (readonly [string, number, boolean])[] = [
  [
    "This attack does 30 more damage for each {C} in your opponent's Active Pokémon's Retreat Cost.",
    1,
    true,
  ],
  [
    "This attack does 50 damage for each {C} in your opponent's Active Pokémon's Retreat Cost.",
    1,
    true,
  ],
  [
    "This attack does 30 less damage for each {C} in your opponent's Active Pokémon's Retreat Cost.",
    2,
    false,
  ],
  [
    "This attack does 50 less damage for each {C} in your opponent's Active Pokémon's Retreat Cost.",
    1,
    false,
  ],
];

/** This slice's condition at its printed threshold. */
const COND: BoardCondition = { kind: "opponentActiveRetreatCostAtLeast", count: 2 };

// ── boards ─────────────────────────────────────────────────────────────────────

/** P1 fields the printed attacker with {C}{C} paid, P2 fields `defender`, and BOTH
    benches start EMPTY — each board puts exactly the bodies it is about, and
    `fix-titan`'s own printed retreat of 4 would otherwise wander into the read.
    Returned on P2's turn. */
function ready(seed: number, defender: string): GameState {
  let state = driveSetup(
    seed,
    { p1: RETREAT_COST_BONUS_DECK, p2: RETREAT_COST_BONUS_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p1", "fix-aerochase");
  state = attachFromDeck(state, "p1", "fix-energy", 2);
  state = setActiveFromDeck(state, "p2", defender);
  return clearBench(clearBench(state, "p1"), "p2");
}

/** …and the same board handed to P1 with the turn already passed. P1 went SECOND,
    so this turn carries no §4 attack restriction. */
function armed(seed: number, defender: string): GameState {
  return mustApply(ready(seed, defender), { type: "endTurn", seat: "p2" }).state;
}

/** P1 plays `cardId` into the shared Stadium zone. Only ever ONE at a time, so the
    two retreat Stadiums are driven by REPLACING each other and never by stacking. */
function withStadium(state: GameState, cardId: string): GameState {
  const next = handFromDeck(state, "p1", cardId, 1);
  return mustApply(next, { type: "playTrainer", seat: "p1", uid: handUid(next, "p1", cardId) })
    .state;
}

/** Attack INDEX 0 — the printed index of "Aero Chase" — and report the damage
    actually dealt. */
function damageDealt(state: GameState): number {
  const after = mustApply(state, { type: "attack", seat: "p1", index: 0 });
  const dealt = after.events.find((e) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return active;
}

/** The PRINTED reading of the clause's noun phrase, on `seat`'s Active — the rival
    the build declined. Spelled here rather than imported from the engine on
    purpose: it is what a WRONG build would have written, and a rung that names it
    is a rung that can go red for the reason that matters. */
function printedCostOf(state: GameState, seat: Seat): number {
  const active = activeOf(state, seat);
  const topUid = active.stack[active.stack.length - 1];
  const card = FIXTURE_POOL[state.cardIdByUid[topUid ?? ""] ?? ""];
  if (card === undefined) throw new Error("no top card");
  return retreatCostOf(card);
}

/** The FOLD, on `seat`'s Active. */
const foldedCostOf = (state: GameState, seat: Seat): number =>
  effectiveRetreatCost(state, activeOf(state, seat));

/** 🛑 THE ATTRIBUTION CONTROL (D214), and the reason this file is not vacuous. On
    a board meant to separate the two readings, ASSERT THEY ARE SEPARATED — before
    any damage is read. A board where the two happen to agree cannot pose as a
    driven disagreement, and the whole slice rests on these four calls. */
function assertReadingsDisagree(state: GameState, printed: number, folded: number): void {
  expect(printedCostOf(state, "p2")).toBe(printed);
  expect(foldedCostOf(state, "p2")).toBe(folded);
  expect(printed).not.toBe(folded);
}

describe("§1 — the SHAPE question: which reading does the printed noun phrase name?", () => {
  it("🛑 the sentence is real, is worth ONE printing, and was refused at D387's head", () => {
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(1);
    expect(corpus().filter(([, s]) => s === TAKEN)).toHaveLength(1);
    // It reached the SKELETON all along and missed at the TABLE — refused by
    // VOCABULARY and never by the ANCHOR, which is D363's distinction and an order of
    // magnitude in price.
    expect(BONUS.test(TAKEN)).toBe(true);
    expect(BONUS.exec(TAKEN)?.[2]).toBe("110");
    // The clause is what the table is keyed on, and it is the printed bytes between
    // the leading "If " and the ", this attack does".
    expect(BONUS.exec(TAKEN)?.[1]).toBe(
      "the Retreat Cost of your opponent's Active Pokémon is {C}{C} or more",
    );
  });

  it("🛑 BOTH readings are live and BOTH have consumers — this was never 'which do I build'", () => {
    // The premise of the whole shape question, driven rather than asserted. Two
    // different functions, two different signatures, both exported, and on a plain
    // board they AGREE — which is exactly why a suite of plain boards proves nothing.
    const plain = ready(9101, "fix-retreat2-titan");
    expect(printedCostOf(plain, "p2")).toBe(2);
    expect(foldedCostOf(plain, "p2")).toBe(2);
    // `retreatCostOf` takes a CARD and `effectiveRetreatCost` takes a STATE and an
    // IN-PLAY BODY: the fold needs the board because three of its four terms are
    // scans over other Pokémon. That difference is why one of them can be right.
    expect(retreatCostOf.length).toBe(1);
    expect(effectiveRetreatCost.length).toBe(2);
  });

  it("🛑 ⑴ the ENGINE HAD ALREADY ANSWERED this noun phrase, and it answered with the FOLD", () => {
    // D159's rule is what makes the reading mandatory rather than merely available:
    // do not invent a second answer to a question the engine already answers.
    // `DamageCountSource.opponentActiveRetreatCost` reads the SAME printed noun
    // phrase under the "for each {C}" skeleton, and attack.ts sends it through
    // `effectiveRetreatCost`. Driven by SENTENCE off the live corpus, so a reader
    // narrowing or a rotation moves this rung.
    let phraseUnits = 0;
    let resolving = 0;
    for (const [sentence, printings, resolves] of NOUN_PHRASE_SIBLINGS) {
      expect(units(corpus().filter(([, s]) => s === sentence)), sentence).toBe(printings);
      expect(resolvedByAnyReader(sentence), sentence).toBe(resolves);
      expect(sentence).toContain("your opponent's Active Pokémon's Retreat Cost");
      phraseUnits += printings;
      if (resolves) resolving += printings;
    }
    // FIVE legal printings of the noun phrase under the sibling skeleton, TWO of them
    // resolving — and this slice's sentence is the SIXTH printing of the same phrase,
    // spelled the other way round ("the Retreat Cost OF your opponent's Active").
    expect([phraseUnits, resolving]).toEqual([5, 2]);
    expect(phraseUnits + units(corpus().filter(([, s]) => s === TAKEN))).toBe(6);
    // …and the two that resolve BOTH land on the count source that reads the fold.
    for (const [sentence] of NOUN_PHRASE_SIBLINGS.filter(([, , r]) => r)) {
      const read =
        deriveAttackDamageBonus(sentence) ?? deriveAttackDamageMultiplier(sentence) ?? null;
      expect(read?.count, sentence).toEqual({ kind: "opponentActiveRetreatCost" });
    }
  });

  it("🛑 ⑵ …and the fold is the value the RULES describe: an order of operations, not a constant", () => {
    // `reference/ptcg-rules.md` §11 defines the cost off the printed symbols and is
    // silent on what a card TEXT naming it reads; the official account (reached from
    // this container, D373's route) states that increases apply first and reductions
    // second, and that a Pokémon left with no Retreat Cost by an effect overrides
    // every increase. BOTH halves are already inside `effectiveRetreatCost`, and this
    // rung is what stops that being a claim about a doc: an increase and a reduction
    // are driven on ONE body, and the result is not the printed number.
    const raised = withStadium(armed(9102, "fix-retreat1-titan"), "sv02-175");
    assertReadingsDisagree(raised, 1, 2);
    const lowered = withStadium(armed(9102, "fix-retreat2-titan"), "sv01-167");
    assertReadingsDisagree(lowered, 2, 1);
    // …and the floor is applied to the SUM, so a reduction cannot drive the value
    // negative — the `Math.max(0, …)` D322 put around the whole expression.
    const floored = withStadium(armed(9102, "fix-retreat1-titan"), "sv01-167");
    expect(printedCostOf(floored, "p2")).toBe(1);
    expect(foldedCostOf(floored, "p2")).toBe(0);
  });

  it("the price, as arithmetic rather than as prose — 1 / 2 against the Prize row's 2 / 9", () => {
    // D382's practice, inherited by six consecutive slices. The mechanisms are
    // counted D386's way ("the member plus its two arms" is ONE): the parameterised
    // member with its two arms, and the clause row. There is NO third — no card
    // predicate, because the fold has been live since D322.
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
    // The claim that makes this purchase flat, DRIVEN rather than asserted: the
    // member answers on a board AND renders a note, which are the two exhaustive
    // `switch (cond.kind)` statements in the repo.
    expect(typeof conditionHolds(ready(9201, "fix-retreat2-titan"), "p1", COND)).toBe("boolean");
    // The note keeps the printed sentence's own word order — the subject is "the
    // Retreat Cost", not the Pokémon — because this card prints the fact as a WHOLE
    // CLAUSE and there is no noun phrase to re-voice. The `{C}{C}` glyph resolves to
    // its ARITY, the family's standing trade (D118): a pill is read by a person.
    expect(conditionNote(COND)).toBe(
      "the Retreat Cost of your opponent's Active Pokémon is 2 or more",
    );
    // So it does NOT round-trip to the printed bytes, and the ONLY difference is the
    // glyph — stated as a substitution rather than left as a shrug.
    expect(TAKEN).toContain(conditionNote(COND).replace(" is 2 or more", " is {C}{C} or more"));
  });

  it("the clause row resolves to the member AT COUNT 2, and the amount comes off the SKELETON", () => {
    const read = deriveAttackDamageBonus(TAKEN);
    expect(read).not.toBeNull();
    expect(read?.count).toEqual({ kind: "boardCondition", cond: COND });
    // The `{C}{C}` glyph is stored as the NUMBER 2 — the arity the fold returns —
    // never as the printed brace pair.
    expect((read?.count as { cond: { count: number } }).cond.count).toBe(2);
    // The amount is captured one layer up, never off the clause row — which is why
    // this one row would serve a second printed amount for free.
    expect(read?.per).toBe(Number(BONUS.exec(TAKEN)?.[2]));
    expect(read?.per).toBe(110);
  });

  it("keeps the two CONSEQUENTS disjoint — D125's rule, on this clause", () => {
    expect(deriveAttackRequirement(TAKEN)).toBeNull();
    const clause = BONUS.exec(TAKEN)?.[1] ?? "";
    expect(deriveAttackDamageBonus(`If ${clause}, this attack does nothing.`)).toBeNull();
  });

  it("🛑 the SIBLING skeleton cannot reach this row, and this row cannot reach the SIBLING count source", () => {
    // The two live readings of one noun phrase are now spelled by two DIFFERENT
    // members under two DIFFERENT skeletons, and the sharpest way for that to go
    // wrong is for one to claim the other's sentence. Both directions, by sentence.
    for (const [sentence] of NOUN_PHRASE_SIBLINGS) {
      expect(BONUS.test(sentence), sentence).toBe(false);
      expect(deriveAttackDamageBonus(sentence)?.count, sentence).not.toEqual({
        kind: "boardCondition",
        cond: COND,
      });
    }
    expect(deriveAttackDamageMultiplier(TAKEN)).toBeNull();
    expect(deriveAttackDamagePenalty(TAKEN)).toBeNull();
  });

  it("the anchors are whole-sentence at BOTH ends — no substring and no near threshold reaches the row", () => {
    // The key is a WHOLE printed clause and never a substring, so a threshold the
    // catalog does not print resolves to NOTHING rather than to this row at the
    // wrong count — an unrecognised clause must stay LOUD (ATTACK_EFFECT_SKIPPED),
    // never silently score at 0 or at 2.
    for (const glyph of ["{C}", "{C}{C}{C}", "{C}{C}{C}{C}"]) {
      const near = `If the Retreat Cost of your opponent's Active Pokémon is ${glyph} or more, this attack does 110 more damage.`;
      expect(deriveAttackDamageBonus(near), glyph).toBeNull();
    }
    // …and the OWN-side mirror the catalog does not print either.
    expect(
      deriveAttackDamageBonus(
        "If the Retreat Cost of your Active Pokémon is {C}{C} or more, this attack does 110 more damage.",
      ),
    ).toBeNull();
    // A leading or trailing companion falls off the whole-sentence anchors.
    expect(deriveAttackDamageBonus(`Flip a coin. ${TAKEN}`)).toBeNull();
    expect(deriveAttackDamageBonus(TAKEN.replace(/\.$/, ", and discard an Energy."))).toBeNull();
  });
});

describe("§3 — THE DISAGREEMENT, driven where the FOLD IS LARGER than the printed column", () => {
  it("a printed-{C} defender is FALSE bare — both readings agree, and this is the control", () => {
    const state = armed(9301, "fix-retreat1-titan");
    expect(printedCostOf(state, "p2")).toBe(1);
    expect(foldedCostOf(state, "p2")).toBe(1);
    expect(conditionHolds(state, "p1", COND)).toBe(false);
    expect(damageDealt(state)).toBe(110);
  });

  it("🛑 …and the STADIUM TERM flips it: printed {C}, folded {C}{C}, 110 → 220", () => {
    // 🛑 THE RUNG THE WHOLE SLICE RESTS ON. Calamitous Wasteland `sv02-175` adds {C}
    // to each Basic non-{F} Pokémon in play, so this ONE body reads 1 under
    // `retreatCostOf` and 2 under `effectiveRetreatCost`. A build that had taken the
    // printed column is GREEN on every other rung in this file and RED here — it
    // would deal 110.
    const state = withStadium(armed(9302, "fix-retreat1-titan"), "sv02-175");
    assertReadingsDisagree(state, 1, 2);
    expect(conditionHolds(state, "p1", COND)).toBe(true);
    expect(damageDealt(state)).toBe(220);
  });

  it("🛑 …and so does the AURA TERM, with NO Stadium in play at all", () => {
    // A SECOND summand of the same fold, reached from the ATTACKER's own Bench:
    // Spidops ex `sv01-019`'s "Trap Territory" is `opponentActiveRetreatSurcharge`,
    // whose printed sentence scopes only the TARGET — so a BENCHED holder still
    // imposes it. This rung is what keeps the disagreement from being a fact about
    // the shared Stadium zone, which is the narrower thing a one-lever suite would
    // actually have proved.
    const state = benchFromDeck(armed(9303, "fix-retreat1-titan"), "p1", "sv01-019");
    expect(state.stadium ?? null).toBeNull();
    assertReadingsDisagree(state, 1, 2);
    expect(conditionHolds(state, "p1", COND)).toBe(true);
    expect(damageDealt(state)).toBe(220);
  });

  it("the two ADDITIVE terms SUM, and the clause is still TRUE at {C}{C}{C}", () => {
    // Both levers on one body: printed 1 + Stadium 1 + aura 1 = 3. The floor is
    // applied ONCE to the sum (D322), and "or more" is a floor — so 3 passes a
    // threshold of 2 and a build spelling `=== 2` is red here.
    const state = benchFromDeck(
      withStadium(armed(9304, "fix-retreat1-titan"), "sv02-175"),
      "p1",
      "sv01-019",
    );
    assertReadingsDisagree(state, 1, 3);
    expect(conditionHolds(state, "p1", COND)).toBe(true);
    expect(damageDealt(state)).toBe(220);
  });
});

describe("§4 — THE MIRROR: driven where the FOLD IS SMALLER than the printed column", () => {
  it("a printed-{C}{C} defender is TRUE bare — the threshold EXACTLY, so `>` is refused", () => {
    const state = armed(9401, "fix-retreat2-titan");
    expect(printedCostOf(state, "p2")).toBe(2);
    expect(foldedCostOf(state, "p2")).toBe(2);
    expect(conditionHolds(state, "p1", COND)).toBe(true);
    // "or more" is a FLOOR (`>=`), `yourBenchAtLeast`'s reading and not a strict
    // inequality: at exactly the threshold the clause HOLDS, and a `>` build deals
    // 110 here.
    expect(damageDealt(state)).toBe(220);
  });

  it("🛑 …and Beach Court flips it the OTHER WAY: printed {C}{C}, folded {C}, 220 → 110", () => {
    // 🛑 **A LADDER NEEDS BOTH DIRECTIONS.** §3's two rungs are both green under a
    // wrong build that read `printed + 1`; this one is not. Beach Court `sv01-167`
    // takes {C} off each Basic, so the body reads 2 printed and 1 folded, and the
    // clause is FALSE where the printed column says true.
    const state = withStadium(armed(9402, "fix-retreat2-titan"), "sv01-167");
    assertReadingsDisagree(state, 2, 1);
    expect(conditionHolds(state, "p1", COND)).toBe(false);
    expect(damageDealt(state)).toBe(110);
  });

  it("the floor is applied to the SUM — a printed {C} under Beach Court is 0, not −1", () => {
    const state = withStadium(armed(9403, "fix-retreat1-titan"), "sv01-167");
    assertReadingsDisagree(state, 1, 0);
    expect(conditionHolds(state, "p1", COND)).toBe(false);
    expect(damageDealt(state)).toBe(110);
  });

  it("🛑 the two Stadiums REPLACE each other, so the same body answers both ways in one game", () => {
    // Only one Stadium is ever in the shared zone (§7.3), which is what makes this
    // the sharpest single board in the file: ONE printed body, ONE printed cost, and
    // the clause's answer moves because the BOARD moved. Under `retreatCostOf`
    // nothing here could ever change.
    const base = armed(9404, "fix-retreat2-titan");
    expect(conditionHolds(base, "p1", COND)).toBe(true);
    const discounted = withStadium(base, "sv01-167");
    assertReadingsDisagree(discounted, 2, 1);
    expect(conditionHolds(discounted, "p1", COND)).toBe(false);
    // §7.3 allows ONE Stadium play per turn, so the swap costs two `endTurn`s —
    // which is the rule doing its job and is left as a line of play rather than
    // surgeried around.
    const nextTurn = mustApply(
      mustApply(discounted, { type: "endTurn", seat: "p1" }).state,
      { type: "endTurn", seat: "p2" },
    ).state;
    expect(conditionHolds(nextTurn, "p1", COND)).toBe(false);
    const surcharged = withStadium(nextTurn, "sv02-175");
    assertReadingsDisagree(surcharged, 2, 3);
    expect(conditionHolds(surcharged, "p1", COND)).toBe(true);
    // The printed column never moved through any of it — which is the statement.
    for (const state of [base, discounted, nextTurn, surcharged])
      expect(printedCostOf(state, "p2")).toBe(2);
  });
});

describe("§5 — the THRESHOLD is a parameter and a FLOOR, and the null arm", () => {
  it("🛑 every folded cost from 0 to 3 is reachable, and the answer turns at exactly 2", () => {
    // The whole domain this file can build, driven as a ladder rather than as two
    // boards — so `>= 1`, `> 2` and `=== 2` are each red on a rung of their own.
    const rungs: readonly (readonly [GameState, number, boolean])[] = [
      [withStadium(armed(9501, "fix-retreat1-titan"), "sv01-167"), 0, false],
      [armed(9501, "fix-retreat1-titan"), 1, false],
      [armed(9501, "fix-retreat2-titan"), 2, true],
      [withStadium(armed(9501, "fix-retreat2-titan"), "sv02-175"), 3, true],
    ];
    for (const [state, folded, holds] of rungs) {
      expect(foldedCostOf(state, "p2"), `folded ${String(folded)}`).toBe(folded);
      expect(conditionHolds(state, "p1", COND), `folded ${String(folded)}`).toBe(holds);
      expect(damageDealt(state), `folded ${String(folded)}`).toBe(holds ? 220 : 110);
    }
  });

  it("the `count` is a PARAMETER — the same board answers differently at other thresholds", () => {
    // D118's argument for a parameter over a member name: the sentence varies on one
    // token, so a second printed threshold is a second ROW and never a second member.
    // Driven on a folded cost of 2.
    const state = armed(9502, "fix-retreat2-titan");
    expect(foldedCostOf(state, "p2")).toBe(2);
    for (const [count, holds] of [
      [0, true],
      [1, true],
      [2, true],
      [3, false],
      [4, false],
    ] as const) {
      expect(
        conditionHolds(state, "p1", { kind: "opponentActiveRetreatCostAtLeast", count }),
        `count ${String(count)}`,
      ).toBe(holds);
    }
    // …and the NOTE is built from the parameter too, so a second row is legible
    // without a second string.
    expect(conditionNote({ kind: "opponentActiveRetreatCostAtLeast", count: 4 })).toBe(
      "the Retreat Cost of your opponent's Active Pokémon is 4 or more",
    );
  });

  it("🛑 an EMPTY Active Spot is FALSE — not a Pokémon retreating for free", () => {
    // The null arm every body-reading member in this family carries. The attack gate
    // guarantees a Defending Pokémon at the one live read site, so this covers the
    // directly-invoked edge — and it is FALSE rather than a throw, and specifically
    // NOT the `0 >= 0` a build that defaulted the missing cost to zero would give at
    // a threshold of 0.
    let state = ready(9503, "fix-retreat2-titan");
    state = { ...state, players: { ...state.players, p2: { ...state.players.p2, active: null } } };
    expect(conditionHolds(state, "p1", COND)).toBe(false);
    expect(
      conditionHolds(state, "p1", { kind: "opponentActiveRetreatCostAtLeast", count: 0 }),
    ).toBe(false);
  });

  it("it is SEAT-RELATIVE — the same board answers differently for the other seat", () => {
    // P1's Active is the printed attacker (retreat 0) and P2's is the {C}{C} body, so
    // the two seats MUST disagree. This is the shape the still-open seat-parameter
    // question (D365/D366) needs concrete boards for, and it is the FIFTH.
    const state = ready(9504, "fix-retreat2-titan");
    expect(printedCostOf(state, "p1")).toBe(0);
    expect(conditionHolds(state, "p1", COND)).toBe(true);
    expect(conditionHolds(state, "p2", COND)).toBe(false);
    // …and the surcharge is seat-relative too: Spidops ex on P1's Bench raises P2's
    // Active and leaves P1's own alone, so a build that read "p2's Active" rather
    // than "the asker's opponent's Active" is red on the second call.
    const auraed = benchFromDeck(state, "p1", "sv01-019");
    expect(foldedCostOf(auraed, "p2")).toBe(3);
    expect(foldedCostOf(auraed, "p1")).toBe(0);
    expect(conditionHolds(auraed, "p1", COND)).toBe(true);
    expect(conditionHolds(auraed, "p2", COND)).toBe(false);
  });
});

describe("§6 — the fixture, the census this row moves, and the summands it does not", () => {
  it("🆕🆕 D418 — the hand-kept READERS list IS the module's reader surface", () => {
    // 🛑 THE GUARD THIS FILE NEVER HAD, IN D417's SHAPE. The doc block on `READERS`
    // named THREE sibling files as its warrant; none of them was checking this list,
    // and two of the three were stale themselves. This rung replaces the
    // cross-reference with a measurement against the MODULE.
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    // ⚠️ THE COUNT IS PINNED SEPARATELY: a diff alone stays GREEN when a reader
    // leaves the module and this list in one commit, and the chains below would then
    // move with nothing naming the cause.
    expect(attackReaderSurface()).toHaveLength(12);
  });

  it("the demonstrator is the printed card — ONE attack at index 0, and the `110+` is real", () => {
    // D306: transcribed, not interpolated. The real card prints ONE attack and so
    // does this, and the "+" marker is load-bearing — the reader consumes it and
    // attack.ts drops the printed base into the gate, so a flat `110` would exercise
    // the wrong half of the assembly.
    const attacks = FIXTURE_POOL["fix-aerochase"]?.attacks ?? [];
    expect(attacks).toHaveLength(1);
    expect(attacks[0]?.name).toBe("Aero Chase");
    expect(attacks[0]?.damage).toBe("110+");
    expect(attacks[0]?.cost).toEqual(["Colorless", "Colorless"]);
    expect(attacks[0]?.effect).toBe(TAKEN);
    // …and the two defenders differ in their printed retreat and in NOTHING else,
    // which is what makes the printed column the only variable between §3 and §4.
    const light = FIXTURE_POOL["fix-retreat1-titan"];
    const heavy = FIXTURE_POOL["fix-retreat2-titan"];
    expect([light?.hp, heavy?.hp]).toEqual([340, 340]);
    expect([light?.stage, heavy?.stage]).toEqual(["Basic", "Basic"]);
    expect([light?.types, heavy?.types]).toEqual([["Colorless"], ["Colorless"]]);
    expect([light?.retreat, heavy?.retreat]).toEqual([1, 2]);
    // Colorless is load-bearing, not incidental: Calamitous Wasteland's surcharge
    // carries `excludesType: "Fighting"`, so a {F} body would be EXEMPT and §3's
    // Stadium rung would silently test nothing.
    expect(programFor("sv02-175")?.stadium?.basicRetreatSurcharge?.excludesType).toBe("Fighting");
  });

  it("🛑 the ONE id is all of the sentence's printings, and it is not in the registry", () => {
    // The standing-still of the other summands, MEASURED not assumed: a READER-keyed
    // move must be shown not to touch the REGISTRY-keyed one.
    const ids = new Set(registryCardIds());
    expect(ids.has(TAKEN_ID)).toBe(false);
    expect(programFor(TAKEN_ID)).toBeUndefined();
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(1);
  });

  it("🛑 the bonus residue is 17 / 20, and the 2-PRINTING BAND IS STILL EMPTY", () => {
    // Re-derived from the parts rather than quoted, and the DEPARTURE is what the
    // band rung asserts (D379's saturation rule): an absence is not a measurement,
    // so the whole distribution is stated and the refusal is driven from OUTSIDE the
    // emptied band.
    const openers = corpus().filter(([, s]) => BONUS.test(s.trim()));
    expect([openers.length, units(openers)]).toEqual([81, 129]);
    const refused = openers.filter(([, s]) => !resolvedByAnyReader(s));
    // 🆕🆕 D389 — 17 / 20 -> **16 / 19**: the OPPONENT-SEAT BENCH COUNT left this
    // residue — ONE sentence at ONE printing (Iron Crown `sv08-132` "Deleting Slash",
    // +80) — re-derived live rather than decremented. 🛑 THE 2-PRINTING BAND STAYS
    // EMPTY and the distribution goes `{1: 15, 5: 1}` -> `{1: 14, 5: 1}`, so every
    // band rung is still aimed at the WHOLE distribution (D379).
    // 🆕🆕 D390 — 16 / 19 -> **15 / 18**: the OPPONENT-SEAT TYPE READ left this
    // residue — ONE sentence at ONE printing (Electivire `sv05-054` "Short-Circuit
    // Knuckle", +120) — re-derived live rather than decremented. 🛑 THE 2-PRINTING
    // BAND STAYS EMPTY and the distribution goes `{1: 14, 5: 1}` -> `{1: 13, 5: 1}`,
    // so every band rung is still aimed at the WHOLE distribution (D379).
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
    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    // 🆕🆕 D388 — `{1: 16, 5: 1}` → `{1: 15, 5: 1}`. The band `n > 1` is STILL `[5]`
    // and still the DECLARATION clause D368 disqualified on SHAPE, which is outside
    // the 2-printing band by construction and is what keeps this rung able to go red
    // for the reason that matters: a reader narrowing so any clause returns to 2
    // fails it, as does that clause being claimed.
    expect([...byClause.values()].filter((n) => n > 1)).toEqual([5]);
    // 🆕🆕 D390 — 15 -> **14**: the OPPONENT-SEAT TYPE READ left the singleton band,
    // the same trade one slice on — a 1-printing clause bought for ONE parameterised
    // member plus one anchored template. The band above is STILL empty, and the only
    // clause left above one printing is the 5-printing declaration one, disqualified
    // on SHAPE.
    // 🆕🆕 D391 — the TYPED PER-BODY ENERGY THRESHOLD left the 1-printing band.
    // 🆕🆕 D392 — 12 -> **11**, the whole of this slice's step.
    expect([...byClause.values()].filter((n) => n === 1)).toHaveLength(5); // 🆕🆕 D398 — the DECK-SIZE READ left the singleton band, 6 -> 5 // 🆕🆕 D397 — the BENCHED-CUBONE FILTER took ONE more singleton out, back to a 1:1 step // 🆕🆕 D394 — the USED-ATTACK PAIR took TWO more singletons out at once, the second two-step in two slices
    // 🆕🆕 D391 — the TYPED PER-BODY ENERGY THRESHOLD left the 1-printing band.
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

  it("the NINE-reader instrument steps by exactly 1 sentence / 1 printing", () => {
    // The 1:1 shape D382, D384 and D387 took. Both columns, because a step in one
    // and not the other is a different event.
    const resolving = corpus().filter(([, s]) => resolvedByAnyReader(s));
    // 🆕🆕 D391 — +1 sentence / +1 printing: the TYPED PER-BODY ENERGY THRESHOLD, an
    // OPTIONAL FIELD on a shipped member rather than a new one, so the READER-keyed summand
    // moves and no registry summand does.
    expect([resolving.length, units(resolving)]).toEqual([415, 1368]); // 🆕🆕 D420 +3 sentences / +4 printings (THE HAND-ENERGY COST FAMILY — *"Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing."* (**2 legal printings**), *"Discard 2 Basic {G} Energy cards from your hand. If you can't discard 2 cards in this way, this attack does nothing."* (**1**) and *"Discard a Basic {G} Energy card from your hand. If you can't, this attack does nothing."* (**1**) — the six-Energy KO is EXACTLY the sentence D415's correction named as the KO residue NOTHING IN THIS REPO COULD BUILD, needing a hand-Energy COST and a does-nothing CANCEL rather than the park or the gate the other two residue members took; the other two printings charge the SAME cost, so all three are built TOGETHER rather than one at a time. Each is claimed WHOLE by ONE reader — `deriveAttackCancelRequirement`, whose `ATTACK_CANCEL_TRAILING` head list is WIDENED past D417's Stadium-only head — over TWO new `deriveAttackEffect` arms: 6f the bare cost, 6g the cost joined to a Knock Out by `", and "`, a COMMA join inside ONE sentence that `splitAttackTrailingClause`'s sentence-boundary `BREAK` cannot reach, which is why the compound needs an arm of its own rather than the composition path. 🛑 THE WHOLE DELTA ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER: a sentence claimed whole is RAW rather than split or compound, so `SPLIT_ATTACK_UNITS` stands still at 13 (the splitter finds no leading gate clause on any of the three), `COMPOUND_ATTACK_UNITS` at 18 (that term only ever counts what the whole-sentence anchors REFUSE, and these three are now claimed) and `REGISTRY_ATTACK_UNITS` at 16, the slice authoring no row. The engine version moves 0.321.0 → 0.322.0 and `MATCH_RECORD_VERSION` STAYS 26 — the cost pays through the SHIPPED `payFromHand` op and adds NO persisted field. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE DIFFERENT NUMBERS ON THE SAME ROW — 3 and 4, where D417's were 1 and 1 — the six-Energy KO printing on TWO ids and the other two on one each.) — 🆕🆕 D418 [406, 1347] → [412, 1364] and NOTHING SHIPPED: three readers (D381 +3/+8, D403 +2/+8, D417 +1/+1) were live in `effects.ts` and absent from this file's list. The three FROZEN tails below do NOT move — 🆕🆕 D416 +2 sentences / +6 printings (THE PARKING KO PAIR — *"Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon."* (**4 legal printings**) and *"Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it."* (**2 legal printings**) — EXACTLY the two sentences D415 named as the residue that still needed a PARK, and they are built TOGETHER rather than one at a time because they are ONE op with two riders: ONE new PARKING `EffectOp` (`knockOutChosen`, REQUIRED `target: "opponentBench" | "opponentAny"` plus optional `basicOnly` / `damageCountersExactly`), reached through the EXISTING `choosePokemon` prompt and the EXISTING `KNOCKED_OUT` sweep. The op PARKS on `phase.cont.pendingOp` but adds ZERO persisted RECORD fields, so `MATCH_RECORD_VERSION` STAYS 26 (D307's paragraph: no v26 deploy can author `{ op: "knockOutChosen", … }` into a record THIS deploy reads) while the engine version moves 0.319.0 → 0.320.0. 🛑 THE WHOLE DELTA ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER: both sentences are claimed WHOLE by `deriveAttackEffect` (arms 6d and 6e), and a sentence resolved whole is RAW rather than split or compound, so `SPLIT_ATTACK_UNITS` stands still at 13 (the splitter finds no leading gate clause on either), `COMPOUND_ATTACK_UNITS` at 18 (that summand only ever counts what the whole-sentence anchors REFUSE, and these two are now claimed) and `REGISTRY_ATTACK_UNITS` at 16, the slice authoring no row. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE DIFFERENT NUMBERS ON THE SAME ROW — 2 and 6 — the flip sentence printing on FOUR ids and the counter-window sentence on TWO, where D415's were 1 and 1. ⚠️ AND EXACTLY ONE OF THE TWO JOINS `compoundCompose` §4's SHADOW-REFUSAL POPULATION, where D415's single sentence joined nothing: the flip sentence carries TWO `BREAK` boundaries (`Flip a coin.` ‖ `If heads, …` ‖ `If tails, …`) so it is THREE clauses, has always sat in the 271 multi-clause corpus, and is now claimed whole — 148 → **149** sentences / 421 → **425** printings; the counter-window sentence has no internal break at all, so it is ONE clause and was never in the 271. The `multiClause` pair 271 / 613 STANDS STILL, because both sentences were always IN the corpus and this slice changed only the CLAIM.) 🆕🆕 D415 +1 sentence / +1 printing (THE OPPONENT-SCOPED SPECIAL-ENERGY KO GATE — *"If your opponent's Active Pokémon has any Special Energy attached, it is Knocked Out."* — Haxorus `sv06.5-046`, **1 legal printing** — claimed WHOLE by `deriveAttackEffect` as ARM 6a WITH THE `cond` SWAPPED AND NOTHING ELSE: the same `conditionGate` over the same shipped FIELD-FREE `knockOutDefender` op D414 built, behind ONE new `BoardCondition` member `opponentActiveHasEnergyAttached` — the SEAT MIRROR of the shipped `yourActiveHasEnergyAttached`, same `energy` parameter, same `hasAttachedEnergy` predicate, one seat over. ZERO new readers, ZERO new effect fields and ZERO registry rows, so `MATCH_RECORD_VERSION` STAYS 26 while the engine version moves 0.318.0 → 0.319.0. 🛑 THE WHOLE DELTA ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER: the sentence is resolved WHOLE, and a sentence resolved whole is RAW rather than split or compound, so `SPLIT_ATTACK_UNITS` stands still at 13, `COMPOUND_ATTACK_UNITS` at 18 and `REGISTRY_ATTACK_UNITS` at 16. ⚠️ AND IT DOES NOT JOIN `compoundCompose` §4's SHADOW-REFUSAL POPULATION EITHER — it breaks on a COMMA and not on a sentence boundary, so it is ONE clause and was never among the 271 multi-clause sentences that rung counts; 148 / 421 STANDS STILL where D414's third sentence moved it. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE THE SAME NUMBER HERE — 1 and 1 — where D414's were 3 and 4.) 🆕🆕 D414 +3 sentences / +4 printings (THE KNOCK OUT THAT REACHES THE OTHER SIDE OF THE TABLE — *"If your opponent's Active Pokémon is a Basic Pokémon, it is Knocked Out."* (2), *"Both Active Pokémon are Knocked Out."* (1) and *"This Pokémon does 100 damage to itself. Flip a coin. If heads, your opponent's Active Pokémon is Knocked Out."* (1) — THREE whole-sentence anchors and THREE `deriveAttackEffect` arms over ONE new FIELD-FREE op (`knockOutDefender`), whose both-Actives spelling is a COMPOSITION of two shipped field-free ops rather than a `target` field, so no persisted union gains a member and `MATCH_RECORD_VERSION` STAYS 26. 🛑 THE WHOLE DELTA ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER, WHICH IS THE POINT: a reader claims each of the three sentences WHOLE, and a sentence resolved whole is RAW rather than split or compound. So `SPLIT_ATTACK_UNITS` stands still at 13 (the splitter finds no leading gate clause on any of the three), `COMPOUND_ATTACK_UNITS` stands still at 18 (the fourth summand only ever counts what the whole-sentence anchors REFUSE, and these three are now claimed), and `REGISTRY_ATTACK_UNITS` stands still at 16, the slice authoring no row. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE DIFFERENT NUMBERS ON THE SAME ROW — 3 and 4 — the Basic-gate sentence printing on TWO ids and the other two on one each. ⚠️ AND IT IS THE KO-WITHOUT-DAMAGE **SUBSET**: the printed family is SEVEN sentences / THIRTEEN printings and this slice takes exactly the four whose targets are NAMED by the printed text, the other three each needing a PARK over a filtered candidate set. 🛑 **THAT LAST CLAUSE WAS WRONG THREE WAYS AND IS CORRECTED IN PLACE BY D415 — NOT SILENTLY REWRITTEN: the original wording is left standing immediately above so the correction reads as one, per the family's standing rule that a witness moves rather than disappears.** (i) THE RESIDUE WAS FOUR SENTENCES / NINE PRINTINGS, NOT THREE — 4 + 4 sentences is the 7 this note counts, and 9 + 4 printings is the 13. (ii) THEY DID NOT "EACH" NEED A PARK, and "whose targets are NAMED" was never the discriminator that separated them: two of the four residue sentences name their targets in printed words as plainly as the three D414 took. What D414 actually took were the sentences needing NO vocabulary beyond the op and a shipped `BoardCondition`. **D415 then built a fourth on exactly those terms and needed no park at all** — *"If your opponent's Active Pokémon has any Special Energy attached, it is Knocked Out."* (Haxorus `sv06.5-046`, 1 printing), arm `6a` with the `cond` swapped and nothing else, over `opponentActiveHasEnergyAttached`: the SEAT MIRROR of the shipped `yourActiveHasEnergyAttached`, same `energy` parameter, same `hasAttachedEnergy` predicate, one seat over. ⚠️ SO THE RESIDUE AT HEAD IS THREE SENTENCES / EIGHT PRINTINGS, AND ONLY TWO OF THEM NEED A PARK: *"Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it."* (2) and *"Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon."* (4). The third is the HAND-ENERGY KO at `censusAttackCorpus.ts` line 93 — *"Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing."* (2) — which needs a hand-Energy COST and an *"If you can't …, this attack does nothing."* CANCEL, a different mechanism from both the park and the gate, and **NOTHING IN THIS REPO NAMED IT AT ALL** until D415 put it in `knockOutDefender.test.ts`'s `UNBUILT_TEXT` as `handEnergyKo`, where it can go red. ⚠️ THIS IS ONE OF THE NINE VERBATIM COPIES OF THE UNCORRECTED NOTE THAT `censusAtHead.test.ts` NAMED (`exOnlyActive`, `precociousEvolution`, `retreatCostBonus`, `sawkRequirementSplit`, `inPlayTypeBonus`, `sameEnergyBonus`, `moreEnergyBonus`, `opponentBenchCount`, `benchNamedBonus`) — D415 swept all nine rather than leaving them to be rediscovered.) 🆕🆕 D413 +2 sentences / +5 printings (THE ADDITIVE MULTI-COIN FOLD — *"Flip 2 coins. This attack does 30 more damage for each heads."* (3) and *"…does 50 more damage for each heads."* (2), ONE anchor (`ATTACK_COIN_MULTI_BONUS`) and ONE `deriveAttackCoinFlip` arm returning D129's `bonusOnHeads` over D127's `flips: { kind: "printed", count: 2 }` — a NEW COMBINATION of an already-shipped vocabulary and therefore not a new shape (D405's rule), so ZERO new ops, fields, readers, `BoardCondition` members or registry rows and `MATCH_RECORD_VERSION` STAYS 26. A READER-keyed move arriving through the RAW summand ALONE: a reader claims each sentence WHOLE, so `splitHead` and the COMPOUND term both stand still, and `REGISTRY_ATTACK_UNITS` stands still because this slice authors no rows.) 🆕🆕 D408 +2 sentences / +7 printings (THE BARE ATTACK LOCK, BOTH SEATS — *"During your opponent's next turn, the Defending Pokémon can't attack."* (3) and *"…can't use attacks."* (4), ONE ALTERNATION anchor (`DEFENDER_CANT_ATTACK_NEXT_TURN`) and ONE `deriveAttackEffect` arm returning D148's `preventAttack { target: "defender" }` unchanged: ZERO new ops, fields, readers, `BoardCondition` members or registry rows. ⚠️ THE SLICE'S THIRD SENTENCE MOVES NOTHING — *"During your next turn, this Pokémon can't use attacks."* (4 printings) ALREADY RESOLVED, to a lock keyed on an attack no card is named, so repairing it is invisible to every census figure) 🆕🆕 D407 +1 sentence / +4 printings (THE BOARD-WIDE OWN-ENERGY COUNT — *"This attack does 30 more damage for each {G} Energy attached to all of your Pokémon."*, ONE WIDENED whole-sentence anchor (`SELF_ENERGY_SCALE`) and ONE OPTIONAL `zone` on the SHIPPED `energyOnSelf` member, delegating to the `countEnergyInPlay` its opponent-side twin has called since D193: ZERO new members, counters, ops or registry rows) 🆕🆕 D406 +1 sentence / +5 printings (THE COUNTED TOOL SCALER — *"This attack does 30 damage for each Pokémon Tool attached to all of your Pokémon."*, ONE whole-sentence anchor and ONE `deriveAttackDamageMultiplier` arm over a THIRTEENTH `DamageCountSource` member) 🆕🆕 D405 +1 sentence / +5 printings (THE MANDATORY OWN-BOARD ENERGY RETRIEVAL — *"Put an Energy attached to this Pokémon into your hand."*, ONE whole-sentence anchor and ONE `deriveAttackEffect` arm returning ONE `discardEnergy { from: "yourActive", filter: anyEnergy, to: "hand" }`: the op is D96's, the destination D295's and the absent `count` the op's OWN documented "one", so ZERO new ops, fields, readers, `BoardCondition` members or registry rows — a READER-keyed move, so `REGISTRY_ATTACK_UNITS` and `splitHead` both stand still. The whole price outside the reader was ONE caption branch on `discardNote`'s `yourActive` arm, which no census figure can see.) 🆕🆕 D404 +1 sentence / +7 printings (THE MANDATORY HAND WIPE AND REFILL — *"Discard your hand and draw 6 cards."*, ONE whole-sentence anchor and ONE `deriveAttackEffect` arm returning `discardHand` then `drawCards` in PRINTED ORDER: both ops shipped with Professor's Research, so ZERO new ops, fields, readers, `BoardCondition` members or registry rows, and `REGISTRY_ATTACK_UNITS` / `splitHead` stand still)  // 🆕🆕 D402 +6 sentences / +13 printings (THE DISCARD-COUNT-SCALED ATTACK — the §9.2 `discarded` record read as a damage MULTIPLIER: ONE map-built whole-sentence anchor and ONE `deriveAttackEffect` arm returning the two-op pair `registry.ts` already spells BY HAND on two cards that have since ROTATED, so ZERO new ops, fields, `BoardCondition` members or registry rows and no registry summand moves) // 🆕🆕 D401 +4 sentences / +7 printings (THE SELF-DISCARD COST BEFORE AN ANY-TARGET SNIPE — one whole-sentence COMPOUND anchor over the §8 cost and the snipe, returning both ops in printed order; a READER-keyed move, so no registry summand moves) // 🆕🆕 D400 +2 sentences / +9 printings (THE ANY-TARGET ARITY — `CHOSEN_ANY_TARGET`'s hard-coded `1 of` captured and the W/R tail's number word required to AGREE with it; a READER-keyed move, so no registry summand moves) // 🆕🆕 D399 +3 sentences / +5 printings (THE TWIN CONSEQUENT AND THE ARITY — Wo-Chien `sv08-015` "Hazardous Greed" behind a `conditionGate`, plus the FOUR printings the flat rider was refusing on the literal count `1`; a READER-keyed move, so no registry summand moves) // 🆕🆕 D398 +1 sentence / +1 printing (THE DECK-SIZE READ — Rabsca `sv08-014` "Counterturn" ({G}, `40+`, **+200**, index **1** of TWO) at 1 legal printing, taken by ONE new `BoardCondition` member (`yourDeckAtMost { count }`), TWO exhaustive-switch arms and ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row — a READER-keyed move, so `REGISTRY_ATTACK_UNITS` and `splitHead` BOTH stand still) // 🆕🆕 D397 +1 sentence / +1 printing (THE BENCHED-CUBONE FILTER — Marowak `sv07-073` "Bone Vengeance" ({C}{C}, `60+`, **+120**, index **1** of TWO) at 1 legal printing, taken by ONE new `BoardCondition` member (`yourBenchNamedDamaged { name }`), TWO exhaustive-switch arms and ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row — a READER-keyed move, so `REGISTRY_ATTACK_UNITS` and `splitHead` BOTH stand still) // 🆕🆕 D394 +2 sentences / +2 printings (THE USED-ATTACK PAIR — Falinks `sv07-088` "All-Out Attack" ({C}{C}, `30+`, **+90**, index 1 of TWO) and Weezing `sv09-092` "Crazy Blast" ({D}{C}, `50+`, **+120**, index 1 of TWO), 1 legal printing each: ONE new `BoardCondition` member (`yourActiveUsedAttackLastTurn { attack }`), ONE new REQUIRED `InPlayPokemon` field (`usedAttack`), ONE new REQUIRED field on `PendingStage.attackEpilogue`, TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and TWO new exhaustive-switch arms — the residue's LAST pair on one mechanism, the first window in the union that is not the turn in progress, and the third entry on this line to move `MATCH_RECORD_VERSION`, 24 -> 25) // 🆕🆕 D393 +2 sentences / +2 printings (THE EVOLVE PAIR — Gholdengo `sv08-131` "Strike It Rich" ({M}, `30+`, **+90**, index 0 of TWO) and Misty's Starmie `sv10-047` "Abrupt Flash" ({W}, `60+`, **+80**, index 0 of ONE), 1 legal printing each: ONE new `BoardCondition` member (`yourActiveEvolvedFromThisTurn { name }`), ONE new REQUIRED `InPlayPokemon` field (`evolvedTurn`), TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and TWO new exhaustive-switch arms — the residue's only PAIR on one mechanism, and the second entry on this line to move `MATCH_RECORD_VERSION`, 23 -> 24) // 🆕🆕 D392 +1 sentence (THE SUBSTRING NAME READ — Team Rocket's Nidoqueen `sv10-116` "Love Impact" ({D}, `60+`, **+120**, index 0 of TWO) at 1 legal printing: ONE new `BoardCondition` member (`yourBenchHasNameContaining { fragment }`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO NEW exhaustive-switch arms — a SECOND MEMBER and not a `match?:` field on `yourBenchHasNamed`, and it is the FIRST test of the rule D391 wrote down, which HELD: what changes is the comparison OPERATOR rather than a filter the delegate already takes, `conditionNote` needs a second SENTENCE rather than a second SLOT, and a member edits ZERO of `yourBenchHasNamed`'s 45 executable sites where an optional field edits THREE)
    // 🆕🆕 D390 — a SECOND `- 1` term at the FRONT, for D389's reason verbatim: the
    // OPPONENT-SEAT TYPE READ resolved ONE sentence worth ONE printing, and this file's
    // own step stays the difference between two adjacent rungs.
    // 🆕🆕 D391 — a `- 1` term at the FRONT of each chain: the TYPED PER-BODY
    // ENERGY THRESHOLD resolved ONE sentence worth ONE printing. ⚠️ THE CHAIN IS EDITED AT
    // THE FRONT, NEVER AT THE END.
    // 🆕🆕 D392 — one more `- 1` on each chain: the SUBSTRING NAME READ, 1 sentence / 1 printing.
    // 🆕🆕 D398 — one more `- 1` on each chain: the DECK-SIZE READ, 1 sentence / 1 printing.
    // 🆕🆕 D399 — a `- 3` / `- 5` pair at the FRONT of the two chains, and the FIRST
    // time in this file that they take DIFFERENT terms: the TWIN CONSEQUENT AND THE
    // ARITY resolved THREE sentences worth FIVE printings. ⚠️ THE CHAIN IS EDITED AT
    // THE FRONT AND KEYED ON THE FROZEN `.toEqual([N, M])` TAIL (D397's rule).
    // 🆕🆕 D401 — a `- 4` / `- 7` pair at the FRONT of the two chains: the SELF-DISCARD
    // COST BEFORE AN ANY-TARGET SNIPE resolved FOUR sentences worth SEVEN printings.
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
      // 🆕🆕 D418 — `- 3 - 2 - 1` on the sentence chain and `- 8 - 8 - 1` on the
      // printings chain, at the FRONT of each, and they are the only terms in either
      // that NO SLICE EVER SHIPPED: D381's, D403's and D417's readers, live in
      // `effects.ts` and missing from this file's `READERS` list. ⚠️ **THE THREE FROZEN
      // TAILS BELOW DO NOT MOVE** — the head steps 406 → 412 / 1,347 → 1,364 and every
      // baseline holds, which is the proof that only the live-head term was ever wrong.
      // ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN.
      // 🆕🆕 D420 — a `- 3` / `- 4` pair at the FRONT of the two chains: THE HAND-ENERGY COST FAMILY resolved THREE
      // sentences worth FOUR printings — *"Discard 6 Basic {G} Energy cards from your hand, and Knock Out your
      // opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing."* (2),
      // *"Discard 2 Basic {G} Energy cards from your hand. If you can't discard 2 cards in this way, this attack does
      // nothing."* (1) and *"Discard a Basic {G} Energy card from your hand. If you can't, this attack does nothing."*
      // (1) — all three claimed WHOLE by the WIDENED trailing-cancel anchor `deriveAttackCancelRequirement` over two
      // new `deriveAttackEffect` arms (6f, 6g), so the step arrives through the RAW summand ALONE and
      // `SPLIT_ATTACK_UNITS` (13), `COMPOUND_ATTACK_UNITS` (18) and `REGISTRY_ATTACK_UNITS` (16) ALL stand still. ⚠️
      // **THE FROZEN TAIL DOES NOT MOVE.** ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      resolving.length - 3 - 3 - 2 - 1 - 2 - 1 - 3 - 2 - 2 - 1 - 1 - 1 - 1 - 6 - 4 - 2 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1,
      units(resolving) - 4 - 8 - 8 - 1 - 6 - 1 - 4 - 5 - 7 - 4 - 5 - 5 - 7 - 13 - 7 - 9 - 5 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1,
    ]).toEqual([368, 1260]);
    // 🆕🆕 D389 — a `- 1` term at the FRONT of each chain, so THIS file's own step is
    // still the difference between two adjacent rungs while the HEAD above moves for
    // somebody else's work: D389 resolved ONE sentence worth ONE printing (the
    // OPPONENT-SEAT BENCH COUNT). ⚠️ THE CHAIN IS EDITED AT THE FRONT, NEVER AT THE END.
    // 🆕🆕 D391 — one more `- 1` term at the FRONT of each chain: the TYPED PER-BODY
    // ENERGY THRESHOLD resolved ONE sentence worth ONE printing. ⚠️ THE CHAIN IS EDITED AT
    // THE FRONT, NEVER AT THE END.
    // 🆕🆕 D392 — one more `- 1` on each chain: the SUBSTRING NAME READ, 1 sentence / 1 printing.
    // 🆕🆕 D398 — one more term at the FRONT of each chain: the DECK-SIZE READ, 1 sentence / 1 printing. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D399 — a `- 3` / `- 5` pair at the FRONT of each chain: the TWIN CONSEQUENT AND THE ARITY, THREE sentences worth FIVE printings. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D401 — a `- 4` / `- 7` pair at the FRONT of each chain: the SELF-DISCARD COST BEFORE AN ANY-TARGET SNIPE, FOUR sentences worth SEVEN printings. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D405 — a `- 1` / `- 5` pair at the FRONT of each chain: the MANDATORY OWN-BOARD ENERGY RETRIEVAL, ONE sentence worth FIVE printings. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D406 — a `- 1` / `- 5` pair at the FRONT of each chain: the COUNTED TOOL SCALER, ONE sentence worth FIVE printings. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D407 — a `- 1` / `- 4` pair at the FRONT of each chain: THE BOARD-WIDE OWN-ENERGY COUNT, ONE sentence worth FOUR printings. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D413 — a `- 2` / `- 5` pair at the FRONT of each chain: THE ADDITIVE MULTI-COIN FOLD, TWO sentences worth FIVE printings, arriving through the RAW summand alone. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D414 — a `- 3` / `- 4` pair at the FRONT of each chain: THE KNOCK-OUT-WITHOUT-DAMAGE SUBSET, THREE sentences worth FOUR printings, arriving through the RAW summand alone (each claimed WHOLE by a `deriveAttackEffect` arm over ONE new FIELD-FREE op, so `SPLIT_ATTACK_UNITS` (13), `COMPOUND_ATTACK_UNITS` (18) and `REGISTRY_ATTACK_UNITS` (16) ALL stand still). ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D415 — a `- 1` term at the FRONT of each chain: THE OPPONENT-SCOPED SPECIAL-ENERGY KO GATE, ONE sentence worth ONE printing (*"If your opponent's Active Pokémon has any Special Energy attached, it is Knocked Out."*, Haxorus `sv06.5-046`), claimed WHOLE by arm 6a with the `cond` swapped and nothing else, so the step arrives through the RAW summand ALONE and `SPLIT_ATTACK_UNITS` (13), `COMPOUND_ATTACK_UNITS` (18) and `REGISTRY_ATTACK_UNITS` (16) ALL stand still. ⚠️ EDITED AT THE FRONT, NEVER AT THE END — the frozen tail is what makes this file's own step readable across the other slices' moves.
    // 🆕🆕 D416 — a `- 2` / `- 6` pair at the FRONT of each chain: THE PARKING KO PAIR, TWO sentences worth SIX printings (*"Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon."*, 4 printings, and *"Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it."*, 2) — the two sentences D415's note named as the residue that still needed a PARK, both now claimed WHOLE by `deriveAttackEffect` over ONE new PARKING op (`knockOutChosen`) that adds ZERO persisted record fields, so the step arrives through the RAW summand ALONE, `SPLIT_ATTACK_UNITS` (13), `COMPOUND_ATTACK_UNITS` (18) and `REGISTRY_ATTACK_UNITS` (16) ALL stand still and `MATCH_RECORD_VERSION` STAYS 26. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE DIFFERENT NUMBERS AGAIN — 2 and 6 — the flip sentence printing on FOUR ids and the counter-window sentence on TWO. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      // 🆕🆕 D418 — `- 3 - 2 - 1` on the sentence chain and `- 8 - 8 - 1` on the
      // printings chain, at the FRONT of each, and they are the only terms in either
      // that NO SLICE EVER SHIPPED: D381's, D403's and D417's readers, live in
      // `effects.ts` and missing from this file's `READERS` list. ⚠️ **THE THREE FROZEN
      // TAILS BELOW DO NOT MOVE** — the head steps 406 → 412 / 1,347 → 1,364 and every
      // baseline holds, which is the proof that only the live-head term was ever wrong.
      // ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN.
    // 🆕🆕 D420 — a `- 3` / `- 4` pair at the FRONT of the two chains: THE HAND-ENERGY COST FAMILY resolved THREE
    // sentences worth FOUR printings — *"Discard 6 Basic {G} Energy cards from your hand, and Knock Out your
    // opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing."* (2),
    // *"Discard 2 Basic {G} Energy cards from your hand. If you can't discard 2 cards in this way, this attack does
    // nothing."* (1) and *"Discard a Basic {G} Energy card from your hand. If you can't, this attack does nothing."*
    // (1) — all three claimed WHOLE by the WIDENED trailing-cancel anchor `deriveAttackCancelRequirement` over two
    // new `deriveAttackEffect` arms (6f, 6g), so the step arrives through the RAW summand ALONE and
    // `SPLIT_ATTACK_UNITS` (13), `COMPOUND_ATTACK_UNITS` (18) and `REGISTRY_ATTACK_UNITS` (16) ALL stand still. ⚠️
    // **THE FROZEN TAIL DOES NOT MOVE.** ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
    expect([resolving.length - 3 - 3 - 2 - 1 - 2 - 1 - 3 - 2 - 2 - 1 - 1 - 1 - 1 - 6 - 4 - 2 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1, units(resolving) - 4 - 8 - 8 - 1 - 6 - 1 - 4 - 5 - 7 - 4 - 5 - 5 - 7 - 13 - 7 - 9 - 5 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1]).toEqual([367, 1259]);
    // D387 left it at 366 / 1,258, and the difference is this file's sentence alone.
    // 🆕🆕 D398 — one more term at the FRONT of each chain: the DECK-SIZE READ, 1 sentence / 1 printing. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D399 — a `- 3` / `- 5` pair at the FRONT of each chain: the TWIN CONSEQUENT AND THE ARITY, THREE sentences worth FIVE printings. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D401 — a `- 4` / `- 7` pair at the FRONT of each chain: the SELF-DISCARD COST BEFORE AN ANY-TARGET SNIPE, FOUR sentences worth SEVEN printings. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D405 — a `- 1` / `- 5` pair at the FRONT of this chain too: the MANDATORY OWN-BOARD ENERGY RETRIEVAL, ONE sentence worth FIVE printings. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D406 — a `- 1` / `- 5` pair at the FRONT of this chain too: the COUNTED TOOL SCALER, ONE sentence worth FIVE printings. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D407 — a `- 1` / `- 4` pair at the FRONT of this chain too: THE BOARD-WIDE OWN-ENERGY COUNT, ONE sentence worth FOUR printings. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D413 — a `- 2` / `- 5` pair at the FRONT of this chain too: THE ADDITIVE MULTI-COIN FOLD, TWO sentences worth FIVE printings, arriving through the RAW summand alone. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D414 — a `- 3` / `- 4` pair at the FRONT of this chain too: THE KNOCK-OUT-WITHOUT-DAMAGE SUBSET, THREE sentences worth FOUR printings, arriving through the RAW summand alone (each claimed WHOLE by a `deriveAttackEffect` arm over ONE new FIELD-FREE op, so `SPLIT_ATTACK_UNITS` (13), `COMPOUND_ATTACK_UNITS` (18) and `REGISTRY_ATTACK_UNITS` (16) ALL stand still). ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN (D397).
    // 🆕🆕 D415 — a `- 1` term at the FRONT of each chain: THE OPPONENT-SCOPED SPECIAL-ENERGY KO GATE, ONE sentence worth ONE printing (*"If your opponent's Active Pokémon has any Special Energy attached, it is Knocked Out."*, Haxorus `sv06.5-046`), claimed WHOLE by arm 6a with the `cond` swapped and nothing else, so the step arrives through the RAW summand ALONE and `SPLIT_ATTACK_UNITS` (13), `COMPOUND_ATTACK_UNITS` (18) and `REGISTRY_ATTACK_UNITS` (16) ALL stand still. ⚠️ EDITED AT THE FRONT, NEVER AT THE END — the frozen tail is what makes this file's own step readable across the other slices' moves.
    // 🆕🆕 D416 — a `- 2` / `- 6` pair at the FRONT of each chain: THE PARKING KO PAIR, TWO sentences worth SIX printings (*"Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon."*, 4 printings, and *"Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it."*, 2) — the two sentences D415's note named as the residue that still needed a PARK, both now claimed WHOLE by `deriveAttackEffect` over ONE new PARKING op (`knockOutChosen`) that adds ZERO persisted record fields, so the step arrives through the RAW summand ALONE, `SPLIT_ATTACK_UNITS` (13), `COMPOUND_ATTACK_UNITS` (18) and `REGISTRY_ATTACK_UNITS` (16) ALL stand still and `MATCH_RECORD_VERSION` STAYS 26. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE DIFFERENT NUMBERS AGAIN — 2 and 6 — the flip sentence printing on FOUR ids and the counter-window sentence on TWO. ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      // 🆕🆕 D418 — `- 3 - 2 - 1` on the sentence chain and `- 8 - 8 - 1` on the
      // printings chain, at the FRONT of each, and they are the only terms in either
      // that NO SLICE EVER SHIPPED: D381's, D403's and D417's readers, live in
      // `effects.ts` and missing from this file's `READERS` list. ⚠️ **THE THREE FROZEN
      // TAILS BELOW DO NOT MOVE** — the head steps 406 → 412 / 1,347 → 1,364 and every
      // baseline holds, which is the proof that only the live-head term was ever wrong.
      // ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL RATHER THAN ON THE CHAIN.
    // 🆕🆕 D420 — a `- 3` / `- 4` pair at the FRONT of the two chains: THE HAND-ENERGY COST FAMILY resolved THREE
    // sentences worth FOUR printings — *"Discard 6 Basic {G} Energy cards from your hand, and Knock Out your
    // opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing."* (2),
    // *"Discard 2 Basic {G} Energy cards from your hand. If you can't discard 2 cards in this way, this attack does
    // nothing."* (1) and *"Discard a Basic {G} Energy card from your hand. If you can't, this attack does nothing."*
    // (1) — all three claimed WHOLE by the WIDENED trailing-cancel anchor `deriveAttackCancelRequirement` over two
    // new `deriveAttackEffect` arms (6f, 6g), so the step arrives through the RAW summand ALONE and
    // `SPLIT_ATTACK_UNITS` (13), `COMPOUND_ATTACK_UNITS` (18) and `REGISTRY_ATTACK_UNITS` (16) ALL stand still. ⚠️
    // **THE FROZEN TAIL DOES NOT MOVE.** ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
    expect([resolving.length - 3 - 3 - 2 - 1 - 2 - 1 - 3 - 2 - 2 - 1 - 1 - 1 - 1 - 6 - 4 - 2 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1, units(resolving) - 4 - 8 - 8 - 1 - 6 - 1 - 4 - 5 - 7 - 4 - 5 - 5 - 7 - 13 - 7 - 9 - 5 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1]).toEqual([366, 1258]);
  });
});
