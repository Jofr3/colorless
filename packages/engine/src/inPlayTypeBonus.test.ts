import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "./censusAttackCorpus";
import {
  POKEMON_TYPES,
  POKEMON_TYPE_BY_CODE,
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
import {
  FIXTURE_POOL,
  IN_PLAY_TYPE_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 🆕 D390 — THE OPPONENT-SEAT IN-PLAY TYPE READ, AND AN *ANCHOR* SHAPE QUESTION.
//
// D389 handed this over as the named next candidate at 1 printing / 2 mechanisms =
// **0.50**, with the seat half of the shape question already settled (a seat is a
// SECOND MEMBER in this union, never a field — fifty members, no seat field, three
// pairs differing in the seat alone) and one question left OPEN:
//
// 🛑 **`boardConditionForClause` HOLDS FOUR ANCHORED TEMPLATE PATTERNS AND EACH ONE
// ASSERTS, IN A COMMENT, THAT THE SET IS MUTUALLY EXCLUSIVE AT ITS ANCHORS.** Nothing
// executed that claim, and a FIFTH pattern is exactly the edit that can falsify it
// silently — an overlapping pattern is invisible from outside, because the earlier one
// still matches first and still returns the right member. So the guard was written and
// COMMITTED FIRST, at a head where this pattern did not exist, carrying this file's
// sentence as an unbuilt row: `clauseTemplateAnchors.test.ts`, a 5×4 head×tail cross
// product whose red was measured rather than argued.
//
// 🛑 **THE ZONE IS THE MEMBER, AND IT IS WRONG IN TWO OPPOSITE DIRECTIONS** (§5).
// Narrowing to the opponent's Active Spot is D279's refutation on a TYPE — the printed
// words are "in play", so a {W} body on the opponent's BENCH satisfies the clause and
// an Active-only reading silently UNDER-pays on exactly the boards the card is for.
// Widening to BOTH seats (`inPlayTypesIntersect`'s spread run twice) is the worse
// defect, because it lets the ATTACKER'S OWN side arm the clause. ⚠️ **AND THE PRINTED
// ATTACKER IS WHAT MAKES THE SECOND ONE VISIBLE AT ALL**: Electivire is `Lightning`
// reading a `{W}` clause, so unlike D370's Metal-on-Metal printings the wrong-seat
// reading is not self-satisfying and has to be driven with a Water body deliberately
// fielded on the attacker's side.
//
// ⚠️ **ZERO NEW VOCABULARY**: the token resolves through `CLAUSE_POKEMON_TYPES`, and
// the TRAP is PRINTED one token away — *"If your opponent has any Future Pokémon in
// play, this attack does 120 more damage."* (Slither Wing `sv06.5-026`) is
// byte-identical apart from the token, and `Future` is a banner no ingested column
// classifies (D204/D205, D207's measurement of the same shape on `Tera`).
//
// WHAT SHIPS: **1 parameterised union member** (`opponentInPlayHasType { type }`) with
// **2 reader arms**, and **1 anchored TEMPLATE** reusing an existing map whole.
// Electivire `sv05-054` "Short-Circuit Knuckle" ({C}{C}, `40+`, **+120**, index 0 of
// TWO), **1 legal printing**. ONE fixture, TWO bodies, ONE dedicated 60, ZERO new card
// predicates. `MATCH_RECORD_VERSION` **STAYS 23**.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/** The TWELVE live readers — the only instrument D385 allows as a REFUSAL ORACLE,
    since a set that omits a live reader can call a sentence "refused" that some
    reader already claims.

    🛑🛑 **D418 — CORRECTED, WITH THE WRONG WORD LEFT VISIBLE ABOVE ITS CORRECTION
    (D178).** The count read *"The TEN live readers"*, and the list under it was
    ELEVEN long — so the prose and the code it described disagreed with each other
    AND both disagreed with `effects.ts`, which exported twelve.

    ⚠️ **AND D385's RULE IS THE PART THAT SURVIVED INTACT AND WAS BROKEN ANYWAY.**
    The sentence after the count is exactly right and is exactly what happened: the
    list omitted `deriveAttackCancelRequirement` from **D417 (2026-08-24)**, one day,
    and §6's figure below called ONE sentence / ONE printing refused that
    `deriveAttackCancelRequirement` already claimed. **411 / 1,363 was wrong; the
    number is 412 / 1,364.** (🆕🆕 D420 then took it to 415 / 1,368 through the RAW
    summand — see §6.) A correctly stated rule with no rung under it is a
    comment.

    ⚠️ §6's figures now come from `resolvedByAnyReader` IMPORTED FROM
    `censusAttackCorpus.ts`, off the MODULE surface, so the refusal oracle D385
    demands is derived rather than declared. This list is what §6's first rung diffs
    against the module — the thing that names the drifting reader. */
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
  // 🆕🆕 D418 — the TWELFTH (D417), missed for exactly one day and one census figure.
  deriveAttackCancelRequirement,
];

/** THE SENTENCE THIS SLICE BUYS, byte for byte off the printing. */
const TAKEN =
  "If your opponent has any {W} Pokémon in play, this attack does 120 more damage.";
const TAKEN_CLAUSE = "your opponent has any {W} Pokémon in play";

/** The one id behind it — Electivire `sv05-054`, "Short-Circuit Knuckle" at index 0 of
    TWO, identified by INTERSECTING two brace-free limitlesstcg `text:` searches (their
    overlap is exactly TWO cards, the other being the `Future` trap below) and confirmed
    field for field against tcgdex `/v2/en/cards/sv05-054`: 140 HP, `Stage1` from
    Electabuzz, `types: ["Lightning"]`, retreat 3, ×2 Fighting, cost {C}{C}, damage
    `40+`, this effect byte for byte, and a second printed attack. **THE PRINTING COUNT
    IS `legalAttackCorpus()`'s, NEVER THE WEB'S.** */
const TAKEN_ID = "sv05-054";

/** 🛑 THE TRAP, and it is PRINTED — the same sentence one token over, at 1 legal
    printing. It must reach the SAME template and be refused at the MAP. */
const TRAP = "If your opponent has any Future Pokémon in play, this attack does 120 more damage.";
const TRAP_CLAUSE = "your opponent has any Future Pokémon in play";

/** This slice's condition, and the two members it sits between — the same FIELD on the
    wrong zone, and the same field on the wrong seat AND a third zone. */
const COND: BoardCondition = { kind: "opponentInPlayHasType", type: "Water" };
const ACTIVE_ONLY: BoardCondition = { kind: "opponentActiveHasType", type: "Water" };
const OWN_BENCH: BoardCondition = { kind: "yourBenchHasType", type: "Water" };

// ── boards ─────────────────────────────────────────────────────────────────────

/** P1 fields the printed attacker with {C}{C} paid and P2 fields the 200 HP defender;
    BOTH benches are emptied and then filled with exactly the bodies asked for, because
    `setActiveFromDeck` DISPLACES rather than replaces and a stray body is precisely the
    thing this file must not have. Returned on P2's turn. */
function ready(
  seed: number,
  opts: {
    opponentActive?: string;
    opponentBench?: readonly string[];
    ownBench?: readonly string[];
  } = {},
): GameState {
  let state = driveSetup(seed, { p1: IN_PLAY_TYPE_DECK, p2: IN_PLAY_TYPE_DECK }, { first: "p2" });
  state = setActiveFromDeck(state, "p1", "fix-shortcircuit");
  state = attachFromDeck(state, "p1", "fix-energy", 2);
  state = setActiveFromDeck(state, "p2", opts.opponentActive ?? "fix-bigbody");
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of opts.opponentBench ?? []) state = benchFromDeck(state, "p2", id);
  for (const id of opts.ownBench ?? []) state = benchFromDeck(state, "p1", id);
  return state;
}

/** …and the same board handed to P1 with the turn already passed. P1 went SECOND, so
    this turn carries no §4 attack restriction. */
function armed(seed: number, opts: Parameters<typeof ready>[1] = {}): GameState {
  return mustApply(ready(seed, opts), { type: "endTurn", seat: "p2" }).state;
}

/** Attack at `index` — 0 is the printed "Short-Circuit Knuckle", 1 the printed control
    "Electroslug" — and report the damage actually dealt. */
function damageDealt(state: GameState, index = 0): number {
  const after = mustApply(state, { type: "attack", seat: "p1", index });
  const dealt = after.events.find((e) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

/** TEST SURGERY, local to this file and borrowed verbatim from `benchTypeBonus.test.ts`:
    push a card from `seat`'s deck onto the TOP of bench[index]'s stack, so the body's
    IDENTITY (§1.2) is the pushed card while the card underneath is unchanged. It drives
    the `topCardOf` read directly — a real evolution needs an `evolvesFrom` chain these
    synthetic bodies do not carry, and the reader's claim is about the stack TOP rather
    than about how it got there. */
function pushOnBench(state: GameState, seat: Seat, index: number, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  const body = side.bench[index];
  if (uid === undefined) throw new Error(`${seat} deck has no ${cardId}`);
  if (body === undefined) throw new Error(`${seat} has no benched Pokémon at ${index}`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        bench: side.bench.map((p, i) => (i === index ? { ...p, stack: [...p.stack, uid] } : p)),
      },
    },
  };
}

describe("§1 — the price, RE-DERIVED: the residue, the band and the `needs` column", () => {
  it("🛑 the sentence is real, is worth ONE printing, and was refused at D389's head", () => {
    expect(corpus().filter(([, s]) => s === TAKEN)).toHaveLength(1);
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(1);
    // It reached the SKELETON all along and missed at the TEMPLATE PASS — refused by
    // the ANCHOR and not by the vocabulary, which is D363's distinction and the more
    // expensive of the two: `{W}` was already a `CLAUSE_POKEMON_TYPES` key, and no
    // pattern's anchor reached the sentence.
    expect(BONUS.test(TAKEN)).toBe(true);
    expect(BONUS.exec(TAKEN)?.[2]).toBe("120");
    expect(BONUS.exec(TAKEN)?.[1]).toBe(TAKEN_CLAUSE);
  });

  it("🛑 the residue steps by exactly this ONE sentence and ONE printing", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    // The DEPARTURE and the SIZE are asserted separately: a guard that only checked
    // 15 / 18 could not tell "the template landed" from "a reader broke".
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
    // D389 left the residue at 16 / 19, re-derived here off the live readers rather
    // than quoted. 🛑 THE 2-PRINTING BAND WAS ALREADY EMPTY AND STAYS EMPTY, so the
    // band rung below is aimed at the WHOLE distribution and its refusal comes from
    // OUTSIDE the emptied band (D379's saturation rule).
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
    // 🆕🆕 D392 — the OFFSET gains one on each axis: the head moved, D389's did not.
    expect([refused.length + 9, units(refused) + 9]).toEqual([16, 19]); // 🆕🆕 D398 — 1 sentence / 1 printing out (THE DECK-SIZE READ)
    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    // `{1: 14, 5: 1}` → `{1: 13, 5: 1}`: a SINGLETON left the singleton band and
    // nothing else moved. The only clause above one printing is still the 5-printing
    // declaration clause D368 disqualified on SHAPE — a fact about the whole
    // distribution, which is what keeps this rung able to go red for the reason that
    // matters (a reader narrowing so any clause returns to 2 fails it too).
    // 🆕🆕 D391 — the TYPED PER-BODY ENERGY THRESHOLD left the 1-printing band.
    // 🆕🆕 D392 — 13 -> **12**: the SUBSTRING NAME READ's clause left the 1-printing band.
    expect(byClause.size).toBe(6); // 🆕🆕 D398 — the DECK-SIZE READ took ONE more singleton out, a 1:1 step, and it was the LAST BUILDABLE one // 🆕🆕 D397 — the BENCHED-CUBONE FILTER took ONE more singleton out, back to a 1:1 step // 🆕🆕 D394 — the USED-ATTACK PAIR took TWO more singletons out at once, the second two-step in two slices
    expect([...byClause.values()].filter((n) => n > 1)).toEqual([5]);
    // 🆕🆕 D391 — the TYPED PER-BODY ENERGY THRESHOLD left the 1-printing band too.
    // 🆕🆕 D392 — 12 -> **11**, the whole of this slice's step.
    expect([...byClause.values()].filter((n) => n === 1)).toHaveLength(5); // 🆕🆕 D398 — the DECK-SIZE READ left the singleton band, 6 -> 5 // 🆕🆕 D397 — the BENCHED-CUBONE FILTER took ONE more singleton out, back to a 1:1 step // 🆕🆕 D394 — the USED-ATTACK PAIR took TWO more singletons out at once, the second two-step in two slices
    expect(byClause.has(TAKEN_CLAUSE)).toBe(false);
    // …and the TRAP is still in the residue, at its own printing, which is what makes
    // "the residue fell by one" a statement about THIS sentence.
    expect(byClause.get(TRAP_CLAUSE)).toBe(1);
  });

  it("🛑 NEITHER neighbour could be widened — and it is TWO axes, not one", () => {
    // D131 says widen before you add, so both were priced that way. The three members
    // are named as VALUES: collapsing any of them into a parameter of another deletes
    // a member kind and this rung stops compiling.
    expect(new Set([COND.kind, ACTIVE_ONLY.kind, OWN_BENCH.kind]).size).toBe(3);
    // ⑴ The SEAT half is D389's answer, re-stated as a fact rather than re-argued: this
    //    union carries pairs that differ in the seat alone, and every one of them is a
    //    SECOND MEMBER. Driven, not quoted — the two seat twins DISAGREE on one board.
    const board = armed(3901, { opponentBench: ["fix-waterbody"], ownBench: ["fix-waterbody"] });
    expect(conditionHolds(board, "p1", { kind: "yourBenchHasType", type: "Water" })).toBe(true);
    expect(conditionHolds(board, "p1", COND)).toBe(true);
    expect(conditionHolds(board, "p2", COND)).toBe(true);
    // ⑵ The ZONE half is NOT a relabelling, and that is the part the seat argument does
    //    not reach: an Active Spot holds ONE body and "in play" is a variable-size set,
    //    so "is a {W} Pokémon" becomes "SOME body is". The board that shows it is the
    //    one where the {W} is BENCHED — a quantifier answers TRUE and a lookup FALSE.
    expect(conditionHolds(board, "p1", ACTIVE_ONLY)).toBe(false);
    expect(conditionHolds(board, "p1", COND)).toBe(true);
  });

  it("🛑 …and it is priced against the PRIZE row, which loses for a SIXTH slice", () => {
    // D382's practice, inherited by eight consecutive slices: the winner is stated as
    // arithmetic against the runner-up rather than as a preference. This row is
    // 1 printing / 2 mechanisms; the face-up Prize row is 2 printings / 9.
    const prize = corpus().filter(([, s]) => s.startsWith("You may turn 1 of your face-down Prize"));
    expect(units(prize)).toBe(2);
    expect(1 / 2).toBeGreaterThan(2 / 9);
    // …and the Prize row's extra cost is the one this row does not owe at all: a
    // `MATCH_RECORD_VERSION` bump. Asserted by the fact that nothing here is persisted
    // — see §6, which asks the question of the member rather than of the file.
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(1);
  });
});

describe("§2 — the VOCABULARY question, run FIRST and shared whole", () => {
  it("🛑 `{W}` is a real `Card.types` value and `Future` is not — the trap is PRINTED", () => {
    // D207's check, and the reason the capture is loose: the MAP is the vocabulary.
    expect(POKEMON_TYPE_BY_CODE.W).toBe("Water");
    expect(POKEMON_TYPES).toContain("Water");
    expect(POKEMON_TYPES).not.toContain("Future");
    // The trap is a REAL printing, not a sentence invented to be refused.
    expect(units(corpus().filter(([, s]) => s === TRAP))).toBe(1);
    expect(deriveAttackDamageBonus(TRAP)).toBeNull();
    expect(resolvedByAnyReader(TRAP)).toBe(false);
    // …and the two sentences differ in the TOKEN alone, which is what makes the
    // refusal a property of the map rather than of the anchor.
    expect(TAKEN.replace("{W}", "Future")).toBe(TRAP);
  });

  it("resolves the printed sentence, and every type in BOTH notations", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: COND },
    });
    // ZERO NEW MAP: the same closed vocabulary the three sibling templates use, in
    // both notations since D367. A type added to the schema is admitted here by
    // construction, which is what a hand-kept alternation could not promise.
    for (const type of POKEMON_TYPES) {
      expect(
        deriveAttackDamageBonus(`If your opponent has any ${type} Pokémon in play, this attack does 120 more damage.`),
        type,
      ).toEqual({ per: 120, count: { kind: "boardCondition", cond: { kind: "opponentInPlayHasType", type } } });
    }
    for (const [code, type] of Object.entries(POKEMON_TYPE_BY_CODE)) {
      expect(
        deriveAttackDamageBonus(`If your opponent has any {${code}} Pokémon in play, this attack does 120 more damage.`),
        code,
      ).toEqual({ per: 120, count: { kind: "boardCondition", cond: { kind: "opponentInPlayHasType", type } } });
    }
  });
});

describe("§3 — the note round-trips to the MEMBER, and deliberately not to the bytes", () => {
  it("🛑 spells the type NAME for a printed brace code, and re-derives to this member", () => {
    // D118's rule: a reject pill and a HUD tooltip are read off the board by a person,
    // and `{W}` is a card-face glyph. So the note does NOT round-trip to the printed
    // bytes…
    expect(conditionNote(COND)).toBe("your opponent has any Water Pokémon in play");
    expect(conditionNote(COND)).not.toContain("{W}");
    expect(conditionNote(COND)).not.toBe(TAKEN_CLAUSE);
    // …and it DOES round-trip to the same MEMBER, through `CLAUSE_POKEMON_TYPES`'s
    // spelled-out half, which is the stronger of the two properties and the one D367's
    // widening bought for this whole family.
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(COND)}, this attack does 120 more damage.`),
    ).toEqual({ per: 120, count: { kind: "boardCondition", cond: COND } });
    // The two SEAT-adjacent notes are different strings, which is what makes the
    // second member a second predicate rather than one name twice.
    expect(conditionNote(ACTIVE_ONLY)).toBe("your opponent's Active Pokémon is a Water Pokémon");
    expect(conditionNote(OWN_BENCH)).toBe("you have any Water Pokémon on your Bench");
    expect(new Set([conditionNote(COND), conditionNote(ACTIVE_ONLY), conditionNote(OWN_BENCH)]).size).toBe(3);
  });

  it("pins the BYTES — a lookalike character would un-map the clause silently", () => {
    // The é in "Pokémon" is the character this rung exists for: two UTF-8 bytes, one
    // code point, and a decomposed spelling would read identically in a diff.
    expect(TAKEN_CLAUSE).toContain("é");
    expect(TAKEN_CLAUSE).not.toContain("́");
    expect(TAKEN_CLAUSE).toContain("{W}");
    // 🛑 NO APOSTROPHE ANYWHERE, and that is the character that decides which half of
    // `clauseApostrophe.test.ts`'s partition this clause lands in: its two nearest
    // siblings spell a POSSESSIVE and carry D136's class, and this one spells
    // "your opponent HAS" and has nothing to class.
    expect(TAKEN_CLAUSE).not.toContain("'");
    expect(TAKEN_CLAUSE).not.toContain("’");
  });
});

describe("§4 — the near-misses stay LOUD, and the four siblings are untouched", () => {
  it("refuses CONSTRUCTED rewrites of the clause — the shape is char-for-char", () => {
    for (const clause of [
      // The TRAP, first: a real printed sentence, refused at the map.
      TRAP_CLAUSE,
      // Not a type at all, and each of these is a real printed word elsewhere.
      "your opponent has any Basic Pokémon in play",
      "your opponent has any Tera Pokémon in play",
      "your opponent has any Pokémon ex in play",
      // The other SEAT — the printed subject is "your opponent".
      "you have any {W} Pokémon in play",
      // The other ZONES, both narrower than "in play".
      "your opponent has any {W} Pokémon on their Bench",
      "your opponent has any {W} Pokémon in the Active Spot",
      // A COUNT rather than an existential — a different member, unbuilt.
      "your opponent has 2 or more {W} Pokémon in play",
      // De-accented: the exact silent failure the byte guard above exists for.
      "your opponent has any {W} Pokemon in play",
      // The brace stripped — `W` alone is not a key in either half of the map.
      "your opponent has any W Pokémon in play",
      // An ENERGY notation borrowed onto a body: D118's clause reads "Energy".
      "your opponent has any {W} Energy in play",
    ]) {
      expect(
        deriveAttackDamageBonus(`If ${clause}, this attack does 120 more damage.`),
        clause,
      ).toBeNull();
    }
  });

  it("keeps the outer anchor guards on this sentence too", () => {
    for (const text of [
      // Lowercase leading "if" — the matcher has no /i.
      `if ${TAKEN_CLAUSE}, this attack does 120 more damage.`,
      // No trailing period is not the whole sentence.
      `If ${TAKEN_CLAUSE}, this attack does 120 more damage`,
      // A real trailing clause pins `$`.
      `If ${TAKEN_CLAUSE}, this attack does 120 more damage. Then, draw a card.`,
      // Leading text pins `^`.
      `Flip a coin. If ${TAKEN_CLAUSE}, this attack does 120 more damage.`,
      // The "×"/multiply twin, which `deriveAttackDamageMultiplier` owns.
      `If ${TAKEN_CLAUSE}, this attack does 120 damage.`,
    ]) {
      expect(deriveAttackDamageBonus(text), text).toBeNull();
    }
    // And the sentence arrives through the BONUS consequent ALONE — D125's
    // disjointness, asked of this sentence rather than assumed of the family.
    expect(deriveAttackRequirement(TAKEN)).toBeNull();
    expect(deriveAttackDamageMultiplier(TAKEN)).toBeNull();
  });

  it("🛑 the FOUR sibling templates still answer their own sentences — nothing was re-pointed", () => {
    // The pattern was appended LAST, and `clauseTemplateAnchors.test.ts` drives the
    // whole 5×4 cross product. These four are here as well because a suite about THIS
    // member should be able to say, on its own, that the four it was appended behind
    // are unmoved.
    expect(deriveAttackDamageBonus(
      "If this Pokémon has any {L} Energy attached, this attack does 80 more damage.",
    )?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "yourActiveHasEnergyAttached", energy: "Lightning" },
    });
    expect(deriveAttackDamageBonus(
      "If your opponent's Active Pokémon is a {P} Pokémon, this attack does 30 more damage.",
    )?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentActiveHasType", type: "Psychic" },
    });
    expect(deriveAttackDamageBonus(
      "If you have any {M} Pokémon on your Bench, this attack does 80 more damage.",
    )?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "yourBenchHasType", type: "Metal" },
    });
    expect(deriveAttackDamageBonus(
      "If your opponent's Active Pokémon has {F} Resistance, this attack does 50 more damage.",
    )?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentActiveHasResistance", type: "Fighting" },
    });
    // …and the LITERAL table still wins first, which is the resolver's ONE real
    // ordering dependency and the thing "order decides nothing" does not cover.
    expect(deriveAttackDamageBonus(
      "If your opponent's Active Pokémon is a Stage 1 Pokémon, this attack does 90 more damage.",
    )?.count).toEqual({ kind: "boardCondition", cond: { kind: "opponentActiveIsStage1" } });
  });
});

describe("§5 — the ZONE and the SEAT, driven on boards rather than argued", () => {
  it("the bare attack is 40 and the control attack is 140 — nothing is boosted by default", () => {
    // `fix-bigbody` is Colorless and both benches are empty, so no body on the table
    // can arm the clause. 40 is the printed base with the "+" consumed.
    const state = armed(3910);
    expect(conditionHolds(state, "p1", COND)).toBe(false);
    expect(damageDealt(state)).toBe(40);
  });

  it("🛑 a {W} on the opponent's ACTIVE arms it — 40 becomes 160", () => {
    const state = armed(3911, { opponentActive: "fix-waterbody" });
    expect(conditionHolds(state, "p1", COND)).toBe(true);
    expect(damageDealt(state)).toBe(40 + 120);
  });

  it("🛑 …AND SO DOES A {W} ON THE OPPONENT'S BENCH, which is what refutes the ACTIVE-ONLY reading", () => {
    // D279's refutation with a TYPE. The Active Spot holds a Colorless 200 HP body, so
    // `opponentActiveHasType` is FALSE on this board while the printed clause is TRUE
    // — the two members are driven apart on ONE board rather than compared in prose.
    const state = armed(3912, { opponentBench: ["fix-waterbody"] });
    expect(conditionHolds(state, "p1", ACTIVE_ONLY)).toBe(false);
    expect(conditionHolds(state, "p1", COND)).toBe(true);
    expect(damageDealt(state)).toBe(160);
  });

  it("🛑 …and a {W} on the ATTACKER'S OWN side does NOT, which refutes the BOTH-SEATS reading", () => {
    // The opposite defect and the worse one: `inPlayTypesIntersect`'s spread run twice
    // would let this side arm its own clause. ⚠️ THE ATTACKER IS LIGHTNING, so this
    // board has to FIELD a Water body to be a real refutation — the printing cannot
    // satisfy itself the way D370's Metal ones could.
    const state = armed(3913, { ownBench: ["fix-waterbody", "fix-waterbody"] });
    expect(FIXTURE_POOL["fix-shortcircuit"]?.types).toEqual(["Lightning"]);
    expect(conditionHolds(state, "p1", OWN_BENCH)).toBe(true);
    expect(conditionHolds(state, "p1", COND)).toBe(false);
    expect(damageDealt(state)).toBe(40);
    // …and from the OTHER seat the same board answers TRUE, which is what
    // `otherSeat(seat)` means and what a hard-coded `"p2"` would fail.
    expect(conditionHolds(state, "p2", COND)).toBe(true);
  });

  it("🛑 reads `types` with `.includes`, never `types[0]` — the dual-typed board", () => {
    // `fix-inplaydual` is `["Fire", "Water"]`, with Water at a NON-ZERO index. D370's
    // `fix-dualbody` is `["Water", "Metal"]` and cannot separate the two readings for a
    // WATER clause at all, which is why this file casts its own body.
    expect(FIXTURE_POOL["fix-inplaydual"]?.types).toEqual(["Fire", "Water"]);
    const state = armed(3914, { opponentBench: ["fix-inplaydual"] });
    expect(conditionHolds(state, "p1", COND)).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "opponentInPlayHasType", type: "Fire" })).toBe(true);
    expect(damageDealt(state)).toBe(160);
  });

  it("a REAL type that is not this one leaves it false — the refusal is not a null check", () => {
    const state = armed(3915, { opponentBench: ["fix-fairybody", "fix-fairybody"] });
    expect(FIXTURE_POOL["fix-fairybody"]?.types).toEqual(["Fairy"]);
    expect(conditionHolds(state, "p1", COND)).toBe(false);
    expect(conditionHolds(state, "p1", { kind: "opponentInPlayHasType", type: "Fairy" })).toBe(true);
    expect(damageDealt(state)).toBe(40);
  });

  it("🛑 reads the stack TOP — a {W} buried under another body stops satisfying it", () => {
    // §1.2: the stack TOP is the Pokémon's identity, so an evolution ARMS or DISARMS
    // this clause mid-turn. Driven with the surgery helper rather than a real
    // evolution, because the reader's claim is about the TOP and not about how it got
    // there — and the un-pushed board is asserted first, so the rung cannot pass by
    // being false for some other reason.
    const before = armed(3916, { opponentBench: ["fix-waterbody"] });
    expect(conditionHolds(before, "p1", COND)).toBe(true);
    const after = pushOnBench(before, "p2", 0, "fix-fairybody");
    expect(conditionHolds(after, "p1", COND)).toBe(false);
    expect(damageDealt(after)).toBe(40);
  });

  it("an EMPTY opposing board is FALSE, and that is forced rather than chosen", () => {
    // The printed word is "any", so the predicate is a positive existential and an
    // empty set cannot satisfy it (D369's distinction — forced by logic, not by a
    // convention). Unreachable in a legal game, which is exactly why it wants a rung.
    const state = armed(3917);
    const empty: GameState = {
      ...state,
      players: {
        ...state.players,
        p2: { ...state.players.p2, active: null, bench: [] },
      },
    };
    expect(conditionHolds(empty, "p1", COND)).toBe(false);
  });

  it("the CONTROL attack is untouched by every board above", () => {
    // An attack on the SAME body whose damage the clause cannot move — so a defect
    // that boosted everything rather than this attack shows up as a 260.
    const state = armed(3918, { opponentActive: "fix-waterbody" });
    const paid = attachFromDeck(attachFromDeck(state, "p1", "fix-lightning-energy", 2), "p1", "fix-energy", 2);
    expect(conditionHolds(paid, "p1", COND)).toBe(true);
    expect(damageDealt(paid, 1)).toBe(140);
  });
});

describe("§6 — the fixture, the census this row moves, and the questions asked of it", () => {
  it("🆕🆕 D418 — the hand-kept READERS list IS the module's reader surface", () => {
    // 🛑 THE GUARD THIS FILE NEVER HAD, IN D417's SHAPE — and the file that needed it
    // most, because its `READERS` doc block STATES D385's refusal-oracle rule
    // correctly and was then broken by exactly the failure the rule describes. A
    // stated rule with nothing re-running it is a comment; this is the rung.
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    // ⚠️ THE COUNT IS PINNED SEPARATELY FROM THE DIFF: a diff alone stays GREEN when a
    // reader is deleted from the module and this list in one commit, and the figures
    // below would move with nothing naming the cause.
    expect(attackReaderSurface()).toHaveLength(12);
  });

  it("the fixture is the PRINTING, transcribed and not interpolated", () => {
    const card = FIXTURE_POOL["fix-shortcircuit"];
    expect(card?.stage).toBe("Stage1");
    expect(card?.evolveFrom).toBe("Electabuzz");
    expect(card?.hp).toBe(140);
    expect(card?.types).toEqual(["Lightning"]);
    expect(card?.retreat).toBe(3);
    expect(card?.weaknesses).toEqual([{ type: "Fighting", value: "×2" }]);
    // TWO attacks at their PRINTED indices, and the printed `40+` marker is real: the
    // reader consumes the "+" and attack.ts drops the printed base into the gate.
    expect(card?.attacks).toHaveLength(2);
    expect(card?.attacks?.[0]).toEqual({
      cost: ["Colorless", "Colorless"],
      name: "Short-Circuit Knuckle",
      damage: "40+",
      effect: TAKEN,
    });
    expect(card?.attacks?.[1]?.damage).toBe(140);
    // A `fix-*` id, so no `catalogManifest.test.ts` row is owed, and the NAME spells no
    // possessive so the three `/^[A-Z][A-Za-z' ]*'s /` sweeps stand still.
    expect(card?.name).toBe("Fixlectivire");
    expect(/^[A-Z][A-Za-z' ]*'s /.test(card?.name ?? "")).toBe(false);
    // The real id is carried as a STRING and never seated — this container has no D1
    // credentials, and `sv05` is in none of `CATALOG_MANIFEST`'s six sets.
    expect(TAKEN_ID).toBe("sv05-054");
    expect(FIXTURE_POOL[TAKEN_ID]).toBeUndefined();
  });

  it("🛑 the TEN-reader instrument steps by exactly 1 sentence / 1 printing", () => {
    // The 1:1 shape D387, D388 and D389 took. Both columns, because a step in one and
    // not the other is a different event.
    const resolving = corpus().filter(([, s]) => resolvedByAnyReader(s));
    // 🆕🆕 D391 — +1 sentence / +1 printing: the TYPED PER-BODY ENERGY THRESHOLD, an
    // OPTIONAL FIELD on a shipped member rather than a new one, so the READER-keyed summand
    // moves and no registry summand does.
    expect([resolving.length, units(resolving)]).toEqual([417, 1376]); // 🆕🆕 D422 +1 sentence / +3 printings (THE OPTIONAL SELF-SWITCH — *"You may switch this Pokémon with 1 of your Benched Pokémon."* (**3 legal printings**), the family's LAST unbuilt sentence and the third member of a family D181 opened and D189 half-closed, claimed WHOLE by ONE new `deriveAttackEffect` arm returning `[{ op: "optional", note, then: [{ op: "switchActive" }] }]` — both ops shipped, ZERO new vocabulary. 🛑 THE RAW SUMMAND'S STEP AND NO OTHER'S, MEASURED RATHER THAN ASSERTED: the sentence carries no leading gate clause so `SPLIT_ATTACK_UNITS` stands still at 13; it is never a compound TAIL in this column (a live probe re-ran `splitAttackTrailingClause` over all 640 sentences AFTER the arm landed and the admitted set is UNCHANGED at 9 sentences / 18 printings) so `COMPOUND_ATTACK_UNITS` stands still at 18; and the slice authors no registry row so `REGISTRY_ATTACK_UNITS` stands still at 16. ⚠️ AND `clauseApostrophe.test.ts` STANDS STILL AT 141 TOO — this sentence carries NO apostrophe of either class (measured on the bytes: it names *this Pokémon* and *your* Bench, so there is no possessive and no contraction), and a census keyed on a CHARACTER cannot see a sentence that carries none however derivable it becomes. The engine version moves 0.323.0 → 0.324.0 and `MATCH_RECORD_VERSION` STAYS 26, DRIVEN in both directions in `optionalSelfSwitch.test.ts` §8 by round-tripping BOTH parks through JSON and comparing their key sets against parks THIS build writes for two SHIPPED sentences.) // 🆕🆕 D421 +1 sentence / +5 printings (THE UNTIL-IT-LEAVES-ACTIVE BAR — *"This Pokémon can't use Blaze Blitz again until it leaves the Active Spot."* (**5 legal printings** — Gouging Fire ex `sv05-038`/`-188`/`-204`/`-214` and `svp-144`, ONE card in five rarities, which is why the step is +1 sentence and +5 printings), claimed WHOLE by `deriveAttackEffect` arm 24a-ii as a LITERAL ROW (D121: the varying axis holds ONE attack name) over a WIDENED `preventAttackUse`. THE RAW SUMMAND'S STEP AND NO OTHER'S: the sentence carries no gate clause, is never a compound tail and has no registry row, so `SPLIT_ATTACK_UNITS` 13, `COMPOUND_ATTACK_UNITS` 18 and `REGISTRY_ATTACK_UNITS` 16 all stand still.) // 🆕🆕 D420 +3 sentences / +4 printings (THE HAND-ENERGY COST FAMILY — *"Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing."* (**2 legal printings**), *"Discard 2 Basic {G} Energy cards from your hand. If you can't discard 2 cards in this way, this attack does nothing."* (**1**) and *"Discard a Basic {G} Energy card from your hand. If you can't, this attack does nothing."* (**1**) — the six-Energy KO is EXACTLY the sentence D415's correction named as the KO residue NOTHING IN THIS REPO COULD BUILD, needing a hand-Energy COST and a does-nothing CANCEL rather than the park or the gate the other two residue members took; the other two printings charge the SAME cost, so all three are built TOGETHER rather than one at a time. Each is claimed WHOLE by ONE reader — `deriveAttackCancelRequirement`, whose `ATTACK_CANCEL_TRAILING` head list is WIDENED past D417's Stadium-only head — over TWO new `deriveAttackEffect` arms: 6f the bare cost, 6g the cost joined to a Knock Out by `", and "`, a COMMA join inside ONE sentence that `splitAttackTrailingClause`'s sentence-boundary `BREAK` cannot reach, which is why the compound needs an arm of its own rather than the composition path. 🛑 THE WHOLE DELTA ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER: a sentence claimed whole is RAW rather than split or compound, so `SPLIT_ATTACK_UNITS` stands still at 13 (the splitter finds no leading gate clause on any of the three), `COMPOUND_ATTACK_UNITS` at 18 (that term only ever counts what the whole-sentence anchors REFUSE, and these three are now claimed) and `REGISTRY_ATTACK_UNITS` at 16, the slice authoring no row. The engine version moves 0.321.0 → 0.322.0 and `MATCH_RECORD_VERSION` STAYS 26 — the cost pays through the SHIPPED `payFromHand` op and adds NO persisted field. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE DIFFERENT NUMBERS ON THE SAME ROW — 3 and 4, where D417's were 1 and 1 — the six-Energy KO printing on TWO ids and the other two on one each.) — 🆕🆕 D418 [411, 1363] → [412, 1364] with NOTHING SHIPPED: D417's `deriveAttackCancelRequirement` was live in `effects.ts` and absent from this file's list, so this figure called ONE sentence / ONE printing refused that a reader already claimed. The FROZEN tail [371, 1268] does NOT move — 🆕🆕 D416 +2 sentences / +6 printings (THE PARKING KO PAIR — *"Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon."* (**4 legal printings**) and *"Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it."* (**2 legal printings**) — EXACTLY the two sentences D415 named as the residue that still needed a PARK, and they are built TOGETHER rather than one at a time because they are ONE op with two riders: ONE new PARKING `EffectOp` (`knockOutChosen`, REQUIRED `target: "opponentBench" | "opponentAny"` plus optional `basicOnly` / `damageCountersExactly`), reached through the EXISTING `choosePokemon` prompt and the EXISTING `KNOCKED_OUT` sweep. The op PARKS on `phase.cont.pendingOp` but adds ZERO persisted RECORD fields, so `MATCH_RECORD_VERSION` STAYS 26 (D307's paragraph: no v26 deploy can author `{ op: "knockOutChosen", … }` into a record THIS deploy reads) while the engine version moves 0.319.0 → 0.320.0. 🛑 THE WHOLE DELTA ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER: both sentences are claimed WHOLE by `deriveAttackEffect` (arms 6d and 6e), and a sentence resolved whole is RAW rather than split or compound, so `SPLIT_ATTACK_UNITS` stands still at 13 (the splitter finds no leading gate clause on either), `COMPOUND_ATTACK_UNITS` at 18 (that summand only ever counts what the whole-sentence anchors REFUSE, and these two are now claimed) and `REGISTRY_ATTACK_UNITS` at 16, the slice authoring no row. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE DIFFERENT NUMBERS ON THE SAME ROW — 2 and 6 — the flip sentence printing on FOUR ids and the counter-window sentence on TWO, where D415's were 1 and 1. ⚠️ AND EXACTLY ONE OF THE TWO JOINS `compoundCompose` §4's SHADOW-REFUSAL POPULATION, where D415's single sentence joined nothing: the flip sentence carries TWO `BREAK` boundaries (`Flip a coin.` ‖ `If heads, …` ‖ `If tails, …`) so it is THREE clauses, has always sat in the 271 multi-clause corpus, and is now claimed whole — 148 → **149** sentences / 421 → **425** printings; the counter-window sentence has no internal break at all, so it is ONE clause and was never in the 271. The `multiClause` pair 271 / 613 STANDS STILL, because both sentences were always IN the corpus and this slice changed only the CLAIM.) 🆕🆕 D415 +1 sentence / +1 printing (THE OPPONENT-SCOPED SPECIAL-ENERGY KO GATE — *"If your opponent's Active Pokémon has any Special Energy attached, it is Knocked Out."* — Haxorus `sv06.5-046`, **1 legal printing** — claimed WHOLE by `deriveAttackEffect` as ARM 6a WITH THE `cond` SWAPPED AND NOTHING ELSE: the same `conditionGate` over the same shipped FIELD-FREE `knockOutDefender` op D414 built, behind ONE new `BoardCondition` member `opponentActiveHasEnergyAttached` — the SEAT MIRROR of the shipped `yourActiveHasEnergyAttached`, same `energy` parameter, same `hasAttachedEnergy` predicate, one seat over. ZERO new readers, ZERO new effect fields and ZERO registry rows, so `MATCH_RECORD_VERSION` STAYS 26 while the engine version moves 0.318.0 → 0.319.0. 🛑 THE WHOLE DELTA ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER: the sentence is resolved WHOLE, and a sentence resolved whole is RAW rather than split or compound, so `SPLIT_ATTACK_UNITS` stands still at 13, `COMPOUND_ATTACK_UNITS` at 18 and `REGISTRY_ATTACK_UNITS` at 16. ⚠️ AND IT DOES NOT JOIN `compoundCompose` §4's SHADOW-REFUSAL POPULATION EITHER — it breaks on a COMMA and not on a sentence boundary, so it is ONE clause and was never among the 271 multi-clause sentences that rung counts; 148 / 421 STANDS STILL where D414's third sentence moved it. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE THE SAME NUMBER HERE — 1 and 1 — where D414's were 3 and 4.) 🆕🆕 D414 +3 sentences / +4 printings (THE KNOCK OUT THAT REACHES THE OTHER SIDE OF THE TABLE — *"If your opponent's Active Pokémon is a Basic Pokémon, it is Knocked Out."* (2), *"Both Active Pokémon are Knocked Out."* (1) and *"This Pokémon does 100 damage to itself. Flip a coin. If heads, your opponent's Active Pokémon is Knocked Out."* (1) — THREE whole-sentence anchors and THREE `deriveAttackEffect` arms over ONE new FIELD-FREE op (`knockOutDefender`), whose both-Actives spelling is a COMPOSITION of two shipped field-free ops rather than a `target` field, so no persisted union gains a member and `MATCH_RECORD_VERSION` STAYS 26. 🛑 THE WHOLE DELTA ARRIVES THROUGH THE **RAW** SUMMAND AND THROUGH NO OTHER, WHICH IS THE POINT: a reader claims each of the three sentences WHOLE, and a sentence resolved whole is RAW rather than split or compound. So `SPLIT_ATTACK_UNITS` stands still at 13 (the splitter finds no leading gate clause on any of the three), `COMPOUND_ATTACK_UNITS` stands still at 18 (the fourth summand only ever counts what the whole-sentence anchors REFUSE, and these three are now claimed), and `REGISTRY_ATTACK_UNITS` stands still at 16, the slice authoring no row. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP ARE DIFFERENT NUMBERS ON THE SAME ROW — 3 and 4 — the Basic-gate sentence printing on TWO ids and the other two on one each. ⚠️ AND IT IS THE KO-WITHOUT-DAMAGE **SUBSET**: the printed family is SEVEN sentences / THIRTEEN printings and this slice takes exactly the four whose targets are NAMED by the printed text, the other three each needing a PARK over a filtered candidate set. 🛑 **THAT LAST CLAUSE WAS WRONG THREE WAYS AND IS CORRECTED IN PLACE BY D415 — NOT SILENTLY REWRITTEN: the original wording is left standing immediately above so the correction reads as one, per the family's standing rule that a witness moves rather than disappears.** (i) THE RESIDUE WAS FOUR SENTENCES / NINE PRINTINGS, NOT THREE — 4 + 4 sentences is the 7 this note counts, and 9 + 4 printings is the 13. (ii) THEY DID NOT "EACH" NEED A PARK, and "whose targets are NAMED" was never the discriminator that separated them: two of the four residue sentences name their targets in printed words as plainly as the three D414 took. What D414 actually took were the sentences needing NO vocabulary beyond the op and a shipped `BoardCondition`. **D415 then built a fourth on exactly those terms and needed no park at all** — *"If your opponent's Active Pokémon has any Special Energy attached, it is Knocked Out."* (Haxorus `sv06.5-046`, 1 printing), arm `6a` with the `cond` swapped and nothing else, over `opponentActiveHasEnergyAttached`: the SEAT MIRROR of the shipped `yourActiveHasEnergyAttached`, same `energy` parameter, same `hasAttachedEnergy` predicate, one seat over. ⚠️ SO THE RESIDUE AT HEAD IS THREE SENTENCES / EIGHT PRINTINGS, AND ONLY TWO OF THEM NEED A PARK: *"Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it."* (2) and *"Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon."* (4). The third is the HAND-ENERGY KO at `censusAttackCorpus.ts` line 93 — *"Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing."* (2) — which needs a hand-Energy COST and an *"If you can't …, this attack does nothing."* CANCEL, a different mechanism from both the park and the gate, and **NOTHING IN THIS REPO NAMED IT AT ALL** until D415 put it in `knockOutDefender.test.ts`'s `UNBUILT_TEXT` as `handEnergyKo`, where it can go red. ⚠️ THIS IS ONE OF THE NINE VERBATIM COPIES OF THE UNCORRECTED NOTE THAT `censusAtHead.test.ts` NAMED (`exOnlyActive`, `precociousEvolution`, `retreatCostBonus`, `sawkRequirementSplit`, `inPlayTypeBonus`, `sameEnergyBonus`, `moreEnergyBonus`, `opponentBenchCount`, `benchNamedBonus`) — D415 swept all nine rather than leaving them to be rediscovered.) 🆕🆕 D413 +2 sentences / +5 printings (THE ADDITIVE MULTI-COIN FOLD — *"Flip 2 coins. This attack does 30 more damage for each heads."* (3) and *"…does 50 more damage for each heads."* (2), ONE anchor (`ATTACK_COIN_MULTI_BONUS`) and ONE `deriveAttackCoinFlip` arm returning D129's `bonusOnHeads` over D127's `flips: { kind: "printed", count: 2 }` — a NEW COMBINATION of an already-shipped vocabulary and therefore not a new shape (D405's rule), so ZERO new ops, fields, readers, `BoardCondition` members or registry rows and `MATCH_RECORD_VERSION` STAYS 26. A READER-keyed move arriving through the RAW summand ALONE: a reader claims each sentence WHOLE, so `splitHead` and the COMPOUND term both stand still, and `REGISTRY_ATTACK_UNITS` stands still because this slice authors no rows.) 🆕🆕 D408 +2 sentences / +7 printings (THE BARE ATTACK LOCK, BOTH SEATS — *"During your opponent's next turn, the Defending Pokémon can't attack."* (3) and *"…can't use attacks."* (4), ONE ALTERNATION anchor (`DEFENDER_CANT_ATTACK_NEXT_TURN`) and ONE `deriveAttackEffect` arm returning D148's `preventAttack { target: "defender" }` unchanged: ZERO new ops, fields, readers, `BoardCondition` members or registry rows. ⚠️ THE SLICE'S THIRD SENTENCE MOVES NOTHING — *"During your next turn, this Pokémon can't use attacks."* (4 printings) ALREADY RESOLVED, to a lock keyed on an attack no card is named, so repairing it is invisible to every census figure) 🆕🆕 D407 +1 sentence / +4 printings (THE BOARD-WIDE OWN-ENERGY COUNT — *"This attack does 30 more damage for each {G} Energy attached to all of your Pokémon."*, ONE WIDENED whole-sentence anchor (`SELF_ENERGY_SCALE`) and ONE OPTIONAL `zone` on the SHIPPED `energyOnSelf` member, delegating to the `countEnergyInPlay` its opponent-side twin has called since D193: ZERO new members, counters, ops or registry rows) 🆕🆕 D406 +1 sentence / +5 printings (THE COUNTED TOOL SCALER — *"This attack does 30 damage for each Pokémon Tool attached to all of your Pokémon."*, ONE whole-sentence anchor (`YOUR_TOOLS_MULTIPLY`) and ONE `deriveAttackDamageMultiplier` arm over a THIRTEENTH `DamageCountSource` member, `toolsOnYourBoard`) 🆕🆕 D405 +1 sentence / +5 printings (THE MANDATORY OWN-BOARD ENERGY RETRIEVAL — *"Put an Energy attached to this Pokémon into your hand."*, ONE whole-sentence anchor and ONE `deriveAttackEffect` arm returning ONE `discardEnergy { from: "yourActive", filter: anyEnergy, to: "hand" }`: the op is D96's, the destination D295's and the absent `count` the op's OWN documented "one", so ZERO new ops, fields, readers, `BoardCondition` members or registry rows — a READER-keyed move, so `REGISTRY_ATTACK_UNITS` and `splitHead` both stand still. The whole price outside the reader was ONE caption branch on `discardNote`'s `yourActive` arm, which no census figure can see.) 🆕🆕 D404 +1 sentence / +7 printings (THE MANDATORY HAND WIPE AND REFILL — *"Discard your hand and draw 6 cards."*, ONE whole-sentence anchor and ONE `deriveAttackEffect` arm returning `discardHand` then `drawCards` in PRINTED ORDER: both ops shipped with Professor's Research, so ZERO new ops, fields, readers, `BoardCondition` members or registry rows, and `REGISTRY_ATTACK_UNITS` / `splitHead` stand still)  // 🆕🆕 D403 +2 sentences / +8 printings (THE ADDITIVE HALF OF D402's FAMILY — *"You may discard up to 2 [Basic] Energy from your Benched Pokémon. This attack does {60|90} more damage for each card you discarded in this way."* on an ELEVENTH reader plus an exported assembler taking the printed BASE, ONE `discardEnergy.from` member (`yourBench`) and ONE OPTIONAL `damageDefender.base` field; a READER-keyed move, so no registry summand moves and `MATCH_RECORD_VERSION` stays 25) // 🆕🆕 D402 +6 sentences / +13 printings (THE DISCARD-COUNT-SCALED ATTACK — the §9.2 `discarded` record read as a damage MULTIPLIER: ONE map-built whole-sentence anchor and ONE `deriveAttackEffect` arm returning the two-op pair `registry.ts` already spells BY HAND on two cards that have since ROTATED, so ZERO new ops, fields, `BoardCondition` members or registry rows and no registry summand moves) // 🆕🆕 D401 +4 sentences / +7 printings (THE SELF-DISCARD COST BEFORE AN ANY-TARGET SNIPE — one whole-sentence COMPOUND anchor over the §8 cost and the snipe, returning both ops in printed order; a READER-keyed move, so no registry summand moves) // 🆕🆕 D400 +2 sentences / +9 printings (THE ANY-TARGET ARITY — `CHOSEN_ANY_TARGET`'s hard-coded `1 of` captured and the W/R tail's number word required to AGREE with it; a READER-keyed move, so no registry summand moves) // 🆕🆕 D399 +3 sentences / +5 printings (THE TWIN CONSEQUENT AND THE ARITY — the gated Wo-Chien printing plus the FOUR the flat rider was refusing on the literal count `1`) // 🆕🆕 D398 +1 sentence / +1 printing (THE DECK-SIZE READ — Rabsca `sv08-014` "Counterturn" ({G}, `40+`, **+200**, index **1** of TWO) at 1 legal printing, taken by ONE new `BoardCondition` member (`yourDeckAtMost { count }`), TWO exhaustive-switch arms and ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row — a READER-keyed move, so `REGISTRY_ATTACK_UNITS` and `splitHead` BOTH stand still) // 🆕🆕 D397 +1 sentence / +1 printing (THE BENCHED-CUBONE FILTER — Marowak `sv07-073` "Bone Vengeance" ({C}{C}, `60+`, **+120**, index **1** of TWO) at 1 legal printing, taken by ONE new `BoardCondition` member (`yourBenchNamedDamaged { name }`), TWO exhaustive-switch arms and ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row — a READER-keyed move, so `REGISTRY_ATTACK_UNITS` and `splitHead` BOTH stand still) // 🆕🆕 D394 +2 sentences / +2 printings (THE USED-ATTACK PAIR — Falinks `sv07-088` "All-Out Attack" ({C}{C}, `30+`, **+90**, index 1 of TWO) and Weezing `sv09-092` "Crazy Blast" ({D}{C}, `50+`, **+120**, index 1 of TWO), 1 legal printing each: ONE new `BoardCondition` member (`yourActiveUsedAttackLastTurn { attack }`), ONE new REQUIRED `InPlayPokemon` field (`usedAttack`), ONE new REQUIRED field on `PendingStage.attackEpilogue`, TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and TWO new exhaustive-switch arms — the residue's LAST pair on one mechanism, the first window in the union that is not the turn in progress, and the third entry on this line to move `MATCH_RECORD_VERSION`, 24 -> 25) // 🆕🆕 D393 +2 sentences / +2 printings (THE EVOLVE PAIR — Gholdengo `sv08-131` "Strike It Rich" ({M}, `30+`, **+90**, index 0 of TWO) and Misty's Starmie `sv10-047` "Abrupt Flash" ({W}, `60+`, **+80**, index 0 of ONE), 1 legal printing each: ONE new `BoardCondition` member (`yourActiveEvolvedFromThisTurn { name }`), ONE new REQUIRED `InPlayPokemon` field (`evolvedTurn`), TWO literal `CONDITIONAL_DAMAGE_CLAUSES` rows and TWO new exhaustive-switch arms — the residue's only PAIR on one mechanism, and the second entry on this line to move `MATCH_RECORD_VERSION`, 23 -> 24) // 🆕🆕 D392 +1 sentence (THE SUBSTRING NAME READ — Team Rocket's Nidoqueen `sv10-116` "Love Impact" ({D}, `60+`, **+120**, index 0 of TWO) at 1 legal printing: ONE new `BoardCondition` member (`yourBenchHasNameContaining { fragment }`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO NEW exhaustive-switch arms — a SECOND MEMBER and not a `match?:` field on `yourBenchHasNamed`, and it is the FIRST test of the rule D391 wrote down, which HELD: what changes is the comparison OPERATOR rather than a filter the delegate already takes, `conditionNote` needs a second SENTENCE rather than a second SLOT, and a member edits ZERO of `yourBenchHasNamed`'s 45 executable sites where an optional field edits THREE)
    // D389 left it at 371 / 1,268, and the difference is this sentence alone.
    // 🆕🆕 D391 — a `- 1` term at the FRONT of each chain: the TYPED PER-BODY
    // ENERGY THRESHOLD resolved ONE sentence worth ONE printing. ⚠️ THE CHAIN IS EDITED AT
    // THE FRONT, NEVER AT THE END.
    // 🆕🆕 D392 — one more `- 1` on each chain: the SUBSTRING NAME READ, 1 sentence / 1 printing.
    // 🆕🆕 D398 — one more `- 1` on each chain: the DECK-SIZE READ, 1 sentence / 1 printing.
    // 🆕🆕 D400 — a `- 2` / `- 9` pair at the FRONT of both chains: the ANY-TARGET
    // ARITY resolved TWO sentences worth NINE printings, the widest ratio this
    // instrument has taken. ⚠️ EDITED AT THE FRONT, AND KEYED ON THE FROZEN TAIL (D397).
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
      // exported the day before and never added to this file's `READERS` list, worth
      // ONE sentence / ONE printing (Eternatus `sv08-141`) — so for once the two chains
      // take the SAME step. ⚠️ **THE FROZEN TAIL [371, 1268] DOES NOT MOVE**, which is
      // the proof the baselines were right and only the live-head term was wrong.
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
      // 🆕🆕 D421 — a `- 1` / `- 5` pair at the FRONT of the two chains: THE UNTIL-IT-LEAVES-ACTIVE
      // BAR resolved ONE sentence worth FIVE printings — *"This Pokémon can't use Blaze Blitz again until it
      // leaves the Active Spot."* (Gouging Fire ex `sv05-038`/`-188`/`-204`/`-214` and `svp-144`, one card in five
      // rarities) — claimed WHOLE by `deriveAttackEffect` arm 24a-ii as a LITERAL ROW over a WIDENED
      // `preventAttackUse`, so the step arrives through the RAW summand ALONE and `SPLIT_ATTACK_UNITS` (13),
      // `COMPOUND_ATTACK_UNITS` (18) and `REGISTRY_ATTACK_UNITS` (16) ALL stand still. ⚠️ **THE FROZEN TAIL DOES
      // NOT MOVE.** ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      // 🆕🆕 D422 — one more term at the FRONT of each chain: THE OPTIONAL SELF-SWITCH,
      // 1 sentence / 3 printings (*"You may switch this Pokémon with 1 of your Benched
      // Pokémon."*), the family's LAST unbuilt printing, through the RAW summand ALONE —
      // `SPLIT_ATTACK_UNITS` (13), `COMPOUND_ATTACK_UNITS` (18) and `REGISTRY_ATTACK_UNITS`
      // (16) ALL stand still, and the compound admitted set was RE-MEASURED over all 640
      // corpus sentences AFTER the arm landed (UNCHANGED at 9 / 18) rather than assumed.
      // ⚠️ EDITED AT THE FRONT, NEVER AT THE END.
      resolving.length - 1 - 1 - 3 - 1 - 2 - 1 - 3 - 2 - 2 - 1 - 1 - 1 - 1 - 2 - 6 - 4 - 2 - 3 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1,
      units(resolving) - 3 - 5 - 4 - 1 - 6 - 1 - 4 - 5 - 7 - 4 - 5 - 5 - 7 - 8 - 13 - 7 - 9 - 5 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1 - 1,
    ]).toEqual([371, 1268]);
  });

  it("🛑 the move is READER-keyed: no registry row, no gate clause, nothing persisted", () => {
    // The two hand-carried summands `censusAtHead.test.ts` splits `BUILT.attack` into
    // stand still, and that is measured rather than assumed: the sentence carries no
    // "does nothing" head (so `splitAttackGateClause` cannot see it) and this slice
    // authors no registry row at all.
    expect(TAKEN.includes("this attack does nothing")).toBe(false);
    expect(deriveAttackRequirement(TAKEN)).toBeNull();
    // …and the PERSISTED question, asked of the MEMBER rather than of the file
    // (D335's discriminator): the `type` lives only inside a derived `CardProgram`, a
    // `conditionGate` resolves inline and never parks, and the arm is a pure READ. No
    // v23 byte string can contain a member that did not exist, and none means anything
    // different under this head — so `MATCH_RECORD_VERSION` STAYS 23.
    expect(Object.keys(COND).sort()).toEqual(["kind", "type"]);
  });
});
