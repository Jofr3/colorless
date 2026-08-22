import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import {
  POKEMON_TYPES,
  POKEMON_TYPE_BY_CODE,
  deriveAttackBonusConsequent,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
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

/** The TEN live readers — the only instrument D385 allows as a REFUSAL ORACLE, since
    a set that omits a live reader can call a sentence "refused" that some reader
    already claims. */
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
];
const resolvedByAnyReader = (text: string): boolean => READERS.some((read) => read(text) !== null);

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
    expect([refused.length, units(refused)]).toEqual([13, 16]);
    // 🆕🆕 D392 — the OFFSET gains one on each axis: the head moved, D389's did not.
    expect([refused.length + 3, units(refused) + 3]).toEqual([16, 19]);
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
    expect(byClause.size).toBe(12);
    expect([...byClause.values()].filter((n) => n > 1)).toEqual([5]);
    // 🆕🆕 D391 — the TYPED PER-BODY ENERGY THRESHOLD left the 1-printing band too.
    // 🆕🆕 D392 — 12 -> **11**, the whole of this slice's step.
    expect([...byClause.values()].filter((n) => n === 1)).toHaveLength(11);
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
    expect([resolving.length, units(resolving)]).toEqual([374, 1271]); // 🆕🆕 D392 +1 sentence (THE SUBSTRING NAME READ — Team Rocket's Nidoqueen `sv10-116` "Love Impact" ({D}, `60+`, **+120**, index 0 of TWO) at 1 legal printing: ONE new `BoardCondition` member (`yourBenchHasNameContaining { fragment }`), ONE literal `CONDITIONAL_DAMAGE_CLAUSES` row and TWO NEW exhaustive-switch arms — a SECOND MEMBER and not a `match?:` field on `yourBenchHasNamed`, and it is the FIRST test of the rule D391 wrote down, which HELD: what changes is the comparison OPERATOR rather than a filter the delegate already takes, `conditionNote` needs a second SENTENCE rather than a second SLOT, and a member edits ZERO of `yourBenchHasNamed`'s 45 executable sites where an optional field edits THREE)
    // D389 left it at 371 / 1,268, and the difference is this sentence alone.
    // 🆕🆕 D391 — a `- 1` term at the FRONT of each chain: the TYPED PER-BODY
    // ENERGY THRESHOLD resolved ONE sentence worth ONE printing. ⚠️ THE CHAIN IS EDITED AT
    // THE FRONT, NEVER AT THE END.
    // 🆕🆕 D392 — one more `- 1` on each chain: the SUBSTRING NAME READ, 1 sentence / 1 printing.
    expect([resolving.length - 1 - 1 - 1, units(resolving) - 1 - 1 - 1]).toEqual([371, 1268]);
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
