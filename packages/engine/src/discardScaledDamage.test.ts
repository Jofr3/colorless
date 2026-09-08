import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader as readByAny,
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
import type { EffectOp } from "./effects";
import type { GameEvent, GameState } from "./index";
import {
  DISCARD_SCALED_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.306.0 → 0.307.0 — 🆕🆕 D402: THE DISCARD-COUNT-SCALED ATTACK.
//
// "<You may discard any amount of|Discard all|Discard up to N> <{X}|Type|Basic>
//  Energy[ cards] from <this|your> Pokémon. This attack does P damage for each card
//  you discarded in this way." — 6 sentences / 13 legal printings, read by
// `ENERGY_DISCARD_SCALED_DAMAGE` into the two ops `registry.ts` has spelled BY HAND
// on two cards since D96: `discardEnergy {recordAs: "discarded"}` then
// `damageDefender {per, count: "discarded"}`.
//
// 🛑 THE SLICE IS A RE-PRICING OF A REFUSAL, AND WHAT WAS RE-DERIVED IS THE
// REFUSAL'S REASON. D96 wrote "a variable-count park the deriver deliberately
// refuses" on the day it INVENTED `count: "any"`, `recordAs` and `damageDefender`;
// D97 added `cap`. The sentence was unreadable then because there was nothing to
// read it INTO. Every piece has shipped since — so the arm costs one anchor.
//
// 🛑 AND ONLY THE MULTIPLY HALF IS TAKEN. §1 measures the split: the printed
// "does N damage for each" DROPS the base (the "N×" IS the per-unit, which is what
// a top-level `damageDefender` already means to `attack.ts`), while "does N MORE
// damage for each" KEEPS it — and this op cannot express that, because its hit is a
// separate `snipeActive` pass and Resistance, the reduction passive and the §8.1
// survival clamp are each paid once PER HIT. The additive half is a second reader,
// which is D163's finding on the sibling count source reproduced.

const attack = { type: "attack", seat: "p1", index: 0 } as const;

/** Every reader `exOnlyActive.test.ts` and `censusAtHead.test.ts` sweep with, so a
    sentence this file calls "unread" is unread by the WHOLE engine and not merely by
    the one reader it is about (D382's rule: a refusal claim that only asks its own
    producer is a claim about nothing). */
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
  deriveAttackOptionalCostBoost,
  // 🆕🆕 D419 — the TWELFTH reader (D417, `deriveAttackCancelRequirement`), which
  // this list never had.
  // ⚠️ SPLICED MID-LIST RATHER THAN APPENDED: mutant `find` strings in
  // `scripts/mutation/mutants.ts` quote an array's LAST entries plus its closing
  // `];`, and appending moves that anchor without a character of it changing —
  // the adjacency class D418 paid for once on `stadiumPresence.test.ts`.
  deriveAttackCancelRequirement,
  // 🆕🆕 D428 — THE THIRTEENTH, the PRE-DAMAGE Tool discard. ⚠️ SPLICED BEFORE THE
  // LAST ENTRY RATHER THAN APPENDED, D419's rule: mutant `find` strings quote an
  // array's LAST entries plus its closing bracket, and appending moves that anchor
  // without a character of it changing.
  deriveAttackPreDamage,
  deriveAttackDiscardScaledBoost,
];

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

/** The SIX printed sentences this anchor takes, transcribed from
    `legalAttackCorpus()` byte for byte. §1 asserts each one is really in the column
    at the printing count quoted beside it — the attribution control without which a
    paraphrase would pass every rung below it (D183). */
const TAKEN: readonly (readonly [number, string])[] = [
  [
    6,
    "You may discard any amount of Basic Energy from your Pokémon. This attack does 70 damage for each card you discarded in this way.",
  ],
  [
    2,
    "Discard all {L} Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way.",
  ],
  [
    2,
    "Discard up to 2 {M} Energy from this Pokémon. This attack does 120 damage for each card you discarded in this way.",
  ],
  [
    1,
    "Discard all {M} Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way.",
  ],
  [
    1,
    "Discard up to 3 {G} Energy cards from your Pokémon. This attack does 70 damage for each card you discarded in this way.",
  ],
  [
    1,
    "Discard up to 5 {R} Energy from this Pokémon. This attack does 70 damage for each card you discarded in this way.",
  ],
];

/** The two sentences the REGISTRY authored (D96, D97) — neither is in the legal
    column any more, both cards having rotated, which is the whole of D187's argument
    for an arm. Kept here as the notation pair: `{W}` is brace-coded and `Psychic` is
    spelled out, so between them they exercise both alternations. */
const HAIL_BLADE =
  "You may discard any amount of {W} Energy from your Pokémon. This attack does 60 damage for each card you discarded in this way.";
const PSY_PURGE =
  "Discard up to 3 Psychic Energy from your Pokémon. This attack does 90 damage for each card you discarded in this way.";

describe("D402 §1 — the family, split by its FOLD, measured live over the column", () => {
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

  it("the whole 'discarded in this way' family is 12 sentences / 27 printings", () => {
    const family = legalAttackCorpus().filter(([, s]) => s.includes("discarded in this way"));
    expect(family).toHaveLength(12);
    expect(units(family)).toBe(27);
  });

  it("this anchor takes SIX of them, worth THIRTEEN printings — and only those", () => {
    const rows = legalAttackCorpus();
    // ⚠️ `"discarded in this way"` and not `"in this way"`: the shorter literal also
    // catches an ATTACH sentence ("If you attached Energy to a Pokémon in this way…",
    // 3 legal printings) that has nothing to do with this family and was already read.
    // A census is as narrow as the literal it matches — measured, not assumed.
    //
    // 🆕🆕🆕 **D488 RE-POINTED THIS PREDICATE RATHER THAN THIS NUMBER, AND THE
    // DISTINCTION IS THE WHOLE OF WHY THE RUNG SURVIVED (D438/D444/D477).** It used to
    // ask *"does `deriveAttackEffect` claim it?"*, which was a faithful stand-in for
    // *"does THIS ANCHOR claim it?"* only for as long as this anchor was the file's
    // only claimant of the family. D488 built the DECK-MILL half — the two sentences
    // the rung below has named as refused since D402 — through a second arm of the
    // SAME reader, so the old predicate now answers 8 / 15 and would have made this
    // file's headline figure a claim about someone else's work.
    // 🛑 **THE CLAIM IS THE OP, WHICH DISCRIMINATES THE TWO ARMS BY VALUE**: D402's
    // program opens with `discardEnergy` (Energy off a BOARD) and D488's with
    // `discardDeckTop` (cards off a DECK). A `.length` re-point would have been the
    // trap — the number would have gone on being right while the sentence it names
    // stopped being true.
    const takesEnergyOffTheBoard = (text: string): boolean => {
      const program = deriveAttackEffect(text);
      return program !== null && program[0]?.op === "discardEnergy";
    };
    const taken = rows.filter(
      ([, s]) => takesEnergyOffTheBoard(s) && s.includes("discarded in this way"),
    );
    expect(taken).toHaveLength(6);
    expect(units(taken)).toBe(13);
    // …and the two D488 took are claimed by the OTHER arm, named here so the 8 / 15 the
    // old predicate now answers is attributable rather than merely different.
    const mills = rows.filter(
      ([, s]) => s.includes("discarded in this way") && deriveAttackEffect(s)?.[0]?.op === "discardDeckTop",
    );
    expect(mills).toHaveLength(2);
    expect(units(mills)).toBe(2);
    // …and they are exactly the six transcribed above, at exactly those counts. A
    // sentence in `TAKEN` that the column does not print would make every parse rung
    // below it an assertion about a card nobody prints (D183).
    expect([...taken].sort()).toEqual([...TAKEN].sort());
  });

  it("🛑 the ADDITIVE half is 3 sentences / 10 printings, and D403 took 2 / 8 of them", () => {
    // The fold is the family's real split. "does N MORE damage for each" keeps the
    // printed base; `damageDefender {per, count}` deals its hit through a SEPARATE
    // `snipeActive` pass, so a kept base would pay Resistance, the reduction passive
    // and the §8.1 clamp TWICE.
    //
    // 🆕🆕 D403 — RE-POINTED RATHER THAN DELETED (D178), AND THE CLAIM IT USED TO
    // MAKE IS NAMED SO NOBODY THINKS IT WAS ALWAYS THIS. This rung read *"…and NOT
    // ONE of them is read"* and asserted `readByAny` FALSE on all three. D403 built
    // the mechanism it was blocked on — an optional `base` on `damageDefender`, which
    // makes `base + P × N` ONE §8.5 pass — so the refusal is now TWO sentences wide,
    // not three, and the rung asserts the SPLIT instead of the blanket. **THE SIZE OF
    // THE HALF IS UNCHANGED (3 / 10): what moved is how much of it is refused.**
    const more = legalAttackCorpus().filter(
      ([, s]) => s.includes("discarded in this way") && s.includes("more damage for each"),
    );
    expect(more).toHaveLength(3);
    expect(units(more)).toBe(10);
    // 🆕🆕🆕 **D490 — THE SPLIT CLOSES: 2 / 8 TAKEN AND 1 / 2 LEFT BECOMES 3 / 10 AND
    // NOTHING.** The half's SIZE is still unchanged at 3 / 10 — what moved a second time
    // is how much of it is refused. ⚠️ The prose above says *"all ELEVEN readers"* and
    // the surface has been THIRTEEN since D417; the count is corrected here and the
    // claim is asserted off the MODULE (`readByAny`) rather than off a number.
    const taken = more.filter(([, s]) => deriveAttackDiscardScaledBoost(s) !== null);
    expect(taken).toHaveLength(3);
    expect(units(taken)).toBe(10);
    const left = more.filter(([, s]) => deriveAttackDiscardScaledBoost(s) === null);
    expect(left).toEqual([]);
    // …and the DISJOINTNESS the old rung really carried is kept: every one of the three
    // is read by THIS reader and by no other, which is what makes "at most one reader
    // fires per attack" structural rather than a rule attack.ts has to keep.
    for (const [, s] of more) expect(readByAny(s), s).toBe(true);
  });

  it("🛑 the two NAMED FALSIFIERS interact: every Bench-only printing is ADDITIVE", () => {
    // The prediction this slice was handed said all 12 sentences were expressible
    // with no new op and no new field, the ONE widening being a Bench-only member on
    // `discardEnergy.from`. It is false, and the interesting part is WHY: the zone
    // and the fold are not independent. Every printing that says "from your Benched
    // Pokémon" also says "more", so the fold split removes the need for the union
    // member ENTIRELY rather than compounding with it — which is also why
    // `MATCH_RECORD_VERSION` stays 25.
    const bench = legalAttackCorpus().filter(
      ([, s]) => s.includes("discarded in this way") && s.includes("from your Benched Pokémon"),
    );
    expect(bench).toHaveLength(2);
    expect(units(bench)).toBe(8);
    for (const [, s] of bench) expect(s.includes("more damage for each"), s).toBe(true);
    // …and NOT ONE multiply printing names the Bench. Named as empty rather than
    // left unsaid (D400): this is the evidence cell the prediction was resting on.
    const benchMultiply = legalAttackCorpus().filter(
      ([, s]) =>
        s.includes("discarded in this way") &&
        s.includes("from your Benched Pokémon") &&
        !s.includes("more damage for each"),
    );
    expect(benchMultiply).toHaveLength(0);
  });

  it("🆕🆕🆕 the MULTIPLY half is now COMPLETE — nothing is left, and each half is named", () => {
    // What is left of the 12 once the 6 and the 3 are taken out USED TO BE THREE: two
    // DECK MILLS whose record is cards off a deck rather than Energy off a board, and
    // one HAND discard whose damage goes to a CHOSEN opponent Pokémon instead of the
    // defender. The rung's stated reason was *"both would need a recording mill or a
    // `damageChosen` that reads a slot"*.
    //
    // 🆕🆕🆕 **D488 BUILT THE RECORDING MILL AND D489 BUILT THE `damageChosen` THAT
    // READS A SLOT, SO BOTH NAMED REASONS ARE NOW PAID AND THE SET IS EMPTY.** D488's
    // note said in as many words: *"the `damageChosen` that reads a slot is still
    // unbuilt, and it is what the one remaining sentence needs."* That was a claim
    // about a mechanism and it was correct — `damageChosen.perRecorded` is the field,
    // `snipeAmount` is the fold it reaches, and both call sites already had the §9.2
    // record in scope. **Leaving the second blocker NAMED rather than editing the
    // comment down to what shipped is what made this slice one grep long** (D488's own
    // rule, and the receipt for it).
    //
    // 🛑 **AN EMPTY SET IS A WEAK CLAIM, SO THE RUNG DOES NOT STOP THERE (D438/D444).**
    // `toHaveLength(0)` is true under a reader widened to eat the whole column as well
    // as under the real build. What replaces the refusal is the PARTITION: every member
    // of the multiply half is claimed, by NAME, by the arm that owns it — a board
    // discard (`discardEnergy`), a deck mill (`discardDeckTop`) or a HAND discard
    // (`payFromHand`) — so a reader that widened past its own clause reddens here even
    // though the emptiness would not.
    const multiply = legalAttackCorpus().filter(
      ([, s]) => s.includes("discarded in this way") && !s.includes("more damage for each"),
    );
    expect(multiply).toHaveLength(9);
    expect(units(multiply)).toBe(17);
    const rest = multiply.filter(([, s]) => deriveAttackEffect(s) === null);
    expect(rest).toHaveLength(0);
    expect(units(rest)).toBe(0);
    // THE PARTITION, by the op each program opens with. Three arms, three heads, and
    // the three counts sum to the whole half — so a sentence that moved between arms
    // reddens, and so does one that left the family altogether.
    const openedBy = (kind: string) =>
      multiply.filter(([, s]) => deriveAttackEffect(s)?.[0]?.op === kind);
    expect([openedBy("discardEnergy").length, units(openedBy("discardEnergy"))]).toEqual([6, 13]);
    expect([openedBy("discardDeckTop").length, units(openedBy("discardDeckTop"))]).toEqual([2, 2]);
    expect([openedBy("payFromHand").length, units(openedBy("payFromHand"))]).toEqual([1, 2]);
    expect(
      openedBy("discardEnergy").length + openedBy("discardDeckTop").length + openedBy("payFromHand").length,
    ).toBe(multiply.length);
    // 🆕🆕🆕 **D489's ROW, PINNED BY VALUE RATHER THAN BY MEMBERSHIP.** The old rung
    // asserted this sentence STARTS with the hand-discard head and derives to null; a
    // re-point onto `.not.toBeNull()` would be green under a reader that eats the whole
    // column (D438's polarity rule). The claim is the two-op program, both quantifiers
    // and the slot that joins them — the ONE thing a wrong build gets wrong.
    const [handRow] = openedBy("payFromHand");
    if (handRow === undefined) throw new Error("the hand-discard row left the family");
    expect(handRow[1].startsWith("Discard up to 3 Energy cards from your hand."), handRow[1]).toBe(true);
    expect(deriveAttackEffect(handRow[1])).toEqual([
      {
        op: "payFromHand",
        count: "any",
        cap: 3,
        to: "discard",
        filter: { kind: "anyEnergy" },
        recordAs: "discarded",
      },
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 60,
        count: 1,
        source: "attack",
        deals: true,
        perRecorded: "discarded",
      },
    ]);
    // 🆕🆕🆕 **D490 — THE ADDITIVE HALF'S LEFTOVER IS BUILT, SO THE REFUSAL BECOMES A
    // PARTITION RATHER THAN A SHORTER LIST.** D489 kept this as *"still unread by every
    // reader … a mill of BOTH decks with a kept base"*, which was an exact description of
    // the price and is now paid: `discardDeckTop.whose` gained `"eachPlayer"` and the
    // additive reader gained a second member. Re-pointing to `toHaveLength(0)` alone would
    // have been true under a build that stopped matching the population at all, so the
    // POPULATION and its OWNER are both named (D438/D423).
    const additive = legalAttackCorpus().filter(
      ([, s]) => s.includes("discarded in this way") && s.includes("more damage for each"),
    );
    expect(additive).toHaveLength(3);
    expect(units(additive)).toBe(10);
    const additiveLeft = additive.filter(([, s]) => !readByAny(s));
    expect(additiveLeft).toEqual([]);
    // …and the OWNER is `deriveAttackDiscardScaledBoost` on all three, `deriveAttackEffect`
    // on NONE — which is the refusal this rung has really carried since D402: the printed
    // *"more"* keeps the attack's base, and `deriveAttackEffect` takes only a STRING, so an
    // arm there could never populate it. That claim survives the build intact.
    for (const [, s] of additive) {
      expect(deriveAttackEffect(s), s).toBeNull();
      expect(deriveAttackDiscardScaledBoost(s), s).not.toBeNull();
    }
    expect(
      additive.filter(([, s]) => s.startsWith("Discard the top card of each player's deck.")),
    ).toHaveLength(1);
    // The two that LEFT this list, and BY WHAT — a re-point onto the shape rather than
    // a deletion (D178/D438), so the day either regresses this rung says which.
    const built = legalAttackCorpus().filter(
      ([, s]) =>
        s.includes("discarded in this way") &&
        !s.includes("more damage for each") &&
        deriveAttackEffect(s)?.[0]?.op === "discardDeckTop",
    );
    expect(built).toHaveLength(2);
    expect(units(built)).toBe(2);
    for (const [, s] of built) {
      const program = deriveAttackEffect(s) as EffectOp[];
      expect(program, s).toHaveLength(2);
      expect(program[0], s).toMatchObject({ op: "discardDeckTop", whose: "self", recordAs: "discarded" });
      const scale = program[1];
      if (scale?.op !== "damageDefender") throw new Error(`not a damageDefender: ${s}`);
      expect(scale.count, s).toBe("discarded");
      expect(scale.countFilter, s).not.toBeUndefined();
    }
  });
});

describe("D402 §2 — the parse: every capture is a field of the two ops", () => {
  it("the SIX printed sentences derive to the discard + the scaled hit, in printed order", () => {
    expect(deriveAttackEffect(TAKEN[0]?.[1] as string)).toEqual([
      {
        op: "discardEnergy",
        from: "yours",
        filter: { kind: "basicEnergy" },
        count: "any",
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 70, count: "discarded" },
    ]);
    expect(deriveAttackEffect(TAKEN[1]?.[1] as string)).toEqual([
      {
        op: "discardEnergy",
        from: "yourActive",
        filter: { kind: "providesEnergy", energyType: "Lightning" },
        count: "all",
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 50, count: "discarded" },
    ]);
    expect(deriveAttackEffect(TAKEN[2]?.[1] as string)).toEqual([
      {
        op: "discardEnergy",
        from: "yourActive",
        filter: { kind: "providesEnergy", energyType: "Metal" },
        count: "any",
        cap: 2,
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 120, count: "discarded" },
    ]);
    expect(deriveAttackEffect(TAKEN[3]?.[1] as string)).toEqual([
      {
        op: "discardEnergy",
        from: "yourActive",
        filter: { kind: "providesEnergy", energyType: "Metal" },
        count: "all",
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 50, count: "discarded" },
    ]);
    // The ONE printing that spells the plural noun — "Energy **cards**" — and the ONE
    // that pairs "up to N" with the whole-board zone. Both on the same sentence, which
    // is why the noun alternation and the zone capture cannot be tested apart here.
    expect(deriveAttackEffect(TAKEN[4]?.[1] as string)).toEqual([
      {
        op: "discardEnergy",
        from: "yours",
        filter: { kind: "providesEnergy", energyType: "Grass" },
        count: "any",
        cap: 3,
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 70, count: "discarded" },
    ]);
    expect(deriveAttackEffect(TAKEN[5]?.[1] as string)).toEqual([
      {
        op: "discardEnergy",
        from: "yourActive",
        filter: { kind: "providesEnergy", energyType: "Fire" },
        count: "any",
        cap: 5,
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 70, count: "discarded" },
    ]);
  });

  it("🛑 the two ROTATED registry sentences derive to their own authored programs", () => {
    // D187, as an assertion: an arm transfers across sets and a row does not. Neither
    // of these is in the legal column any more, so both rows serve ZERO Standard-legal
    // printings while the arm serves 13 — and the arm reads them anyway, because
    // rotation decides who may PLAY a card, not what the card SAYS (D358).
    expect(legalAttackCorpus().some(([, s]) => s === HAIL_BLADE)).toBe(false);
    expect(legalAttackCorpus().some(([, s]) => s === PSY_PURGE)).toBe(false);
    expect(deriveAttackEffect(HAIL_BLADE)).toEqual([
      {
        op: "discardEnergy",
        from: "yours",
        filter: { kind: "providesEnergy", energyType: "Water" },
        count: "any",
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 60, count: "discarded" },
    ]);
    expect(deriveAttackEffect(PSY_PURGE)).toEqual([
      {
        op: "discardEnergy",
        from: "yours",
        filter: { kind: "providesEnergy", energyType: "Psychic" },
        count: "any",
        cap: 3,
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 90, count: "discarded" },
    ]);
  });

  it("the TYPE comes from the MAP, so every code and every name resolves", () => {
    // `TYPED_SELF_DISCARD`'s convention, one anchor over: a type is a PARAMETER and
    // both alternations are built FROM `ENERGY_TYPE_BY_CODE` / `ENERGY_TYPE_BY_NAME`,
    // so a tenth type costs no line. `{Y}`/`Fairy` has ZERO printings on this shape
    // and derives regardless — which is exactly the claim.
    for (const [code, type] of [
      ["G", "Grass"],
      ["R", "Fire"],
      ["W", "Water"],
      ["L", "Lightning"],
      ["P", "Psychic"],
      ["F", "Fighting"],
      ["D", "Darkness"],
      ["M", "Metal"],
      ["Y", "Fairy"],
    ] as const) {
      const expected = [
        {
          op: "discardEnergy",
          from: "yourActive",
          filter: { kind: "providesEnergy", energyType: type },
          count: "all",
          recordAs: "discarded",
        },
        { op: "damageDefender", per: 30, count: "discarded" },
      ];
      expect(
        deriveAttackEffect(
          `Discard all {${code}} Energy from this Pokémon. This attack does 30 damage for each card you discarded in this way.`,
        ),
      ).toEqual(expected);
      expect(
        deriveAttackEffect(
          `Discard all ${type} Energy from this Pokémon. This attack does 30 damage for each card you discarded in this way.`,
        ),
      ).toEqual(expected);
    }
  });
});

describe("D402 §3 — the refusals, each pinned on ONE printed byte", () => {
  it("🛑 the FOLD and the ZONE each refuse INDEPENDENTLY of the other", () => {
    // D399's rule: a near-miss the anchor already refuses for another reason proves
    // nothing about the byte you meant to test. The printed additive sentence differs
    // from a derivable one in TWO places at once, so each is varied alone.
    // THE POSITIVE CONTROL FIRST, so the three refusals below are known to be one
    // byte from a sentence this anchor really does read.
    const derivable =
      "Discard up to 2 Basic Energy from your Pokémon. This attack does 60 damage for each card you discarded in this way.";
    expect(deriveAttackEffect(derivable)).not.toBeNull();
    // …the FOLD alone: the same sentence with the printed "more" put back.
    expect(
      deriveAttackEffect(
        "Discard up to 2 Basic Energy from your Pokémon. This attack does 60 more damage for each card you discarded in this way.",
      ),
    ).toBeNull();
    // …the ZONE alone: the same sentence with the printed "Benched" put back.
    expect(
      deriveAttackEffect(
        "Discard up to 2 Basic Energy from your Benched Pokémon. This attack does 60 damage for each card you discarded in this way.",
      ),
    ).toBeNull();
    // …and the sentence AS PRINTED, which differs in both places at once plus the
    // uncoupled "You may". It is the one the column actually carries (6 printings).
    expect(
      deriveAttackEffect(
        "You may discard up to 2 Energy from your Benched Pokémon. This attack does 60 more damage for each card you discarded in this way.",
      ),
    ).toBeNull();
  });

  it("the QUANTIFIER is three COUPLED literals — the cross-product is not derived", () => {
    // D361's rule. The column prints "You may discard any amount of", "Discard all"
    // and "Discard up to N"; it prints NEITHER of the two crossings below, so a
    // `(?:You may )?` prefix times an `(any amount|all|up to N)` tail would have
    // derived two sentences nobody prints.
    for (const text of [
      "Discard any amount of {W} Energy from your Pokémon. This attack does 60 damage for each card you discarded in this way.",
      "You may discard all {W} Energy from your Pokémon. This attack does 60 damage for each card you discarded in this way.",
      "You may discard 2 {W} Energy from your Pokémon. This attack does 60 damage for each card you discarded in this way.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("an UNTYPED noun is refused — this half of the family never prints one", () => {
    // The filter is REQUIRED. Every multiply printing narrows the discard to a type
    // or to "Basic"; a bare "Energy" appears only behind the Bench-only additive
    // spellings, so admitting `anyEnergy` here would resolve a sentence the column
    // does not carry on this shape.
    expect(
      deriveAttackEffect(
        "Discard up to 2 Energy from your Pokémon. This attack does 60 damage for each card you discarded in this way.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "Discard all Energy from this Pokémon. This attack does 60 damage for each card you discarded in this way.",
      ),
    ).toBeNull();
  });

  it("{C} and {N} are refused — the map's own vocabulary, not the regex's", () => {
    // `ENERGY_TYPE_BY_CODE` has no `C` (Colorless is the conservative provision
    // fallback for every unauthored Special Energy, so a {C} filter would silently
    // match cards nobody meant) and no `N` (there is no Basic Dragon Energy).
    for (const text of [
      "Discard all {C} Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way.",
      "Discard all Colorless Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way.",
      "Discard all {N} Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way.",
      "Discard all Dragon Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("a printed 0 in EITHER number stays loud — no silent no-op", () => {
    // Two captured numbers, two positivity guards, asserted apart. A 0 per-unit is an
    // attack that deals nothing however much comes off; a "up to 0" is a park with no
    // pick. Both belong on the `ATTACK_EFFECT_SKIPPED` path, not in a program.
    expect(
      deriveAttackEffect(
        "You may discard any amount of Basic Energy from your Pokémon. This attack does 0 damage for each card you discarded in this way.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "Discard up to 0 {M} Energy from this Pokémon. This attack does 120 damage for each card you discarded in this way.",
      ),
    ).toBeNull();
    // …and 1 is fine in both slots, so the guards are `>= 1` and not `> 1`.
    expect(
      deriveAttackEffect(
        "Discard up to 1 {M} Energy from this Pokémon. This attack does 1 damage for each card you discarded in this way.",
      ),
    ).not.toBeNull();
  });

  it("the ANCHORS: leading text, a trailing clause, and the capital all refuse", () => {
    for (const text of [
      // `^` — a real compound whose first clause is something else entirely.
      "Draw a card. Discard all {L} Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way.",
      // `$` — a real trailing clause, the shape three of this file's anchors exist for.
      "Discard all {L} Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way. Then, draw a card.",
      // No /i: the capitalised first word is half of what keeps a MID-SENTENCE clause
      // off the derived path.
      "discard all {L} Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way.",
      // The tail's own capital, for the same reason.
      "Discard all {L} Energy from this Pokémon. this attack does 50 damage for each card you discarded in this way.",
      // The sentence's own halves, alone: the FIRST is `TYPED_SELF_DISCARD`'s and
      // derives to ONE op; the SECOND is nobody's and derives to none.
      "This attack does 50 damage for each card you discarded in this way.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    // …and the first half alone still derives to the BARE typed discard — the proof
    // that this anchor was added BESIDE `TYPED_SELF_DISCARD` and did not swallow it.
    expect(deriveAttackEffect("Discard all {L} Energy from this Pokémon.")).toEqual([
      {
        op: "discardEnergy",
        from: "yourActive",
        filter: { kind: "providesEnergy", energyType: "Lightning" },
        count: "all",
      },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE BOARD. Two fixtures, one per quantifier arm.
// ─────────────────────────────────────────────────────────────────────────────

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1 goes second, so
    their first turn carries no §4 attack restriction. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: DISCARD_SCALED_DECK, p2: DISCARD_SCALED_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields `attacker` with the named Energy attached, against a neutral 200 HP
    `fix-bigbody` — so a count is never confounded with a Knock Out. */
function fielded(
  seed: number,
  attacker: string,
  energy: { readonly [id: string]: number },
): GameState {
  let state = setActiveFromDeck(board(seed), "p1", attacker);
  for (const [id, n] of Object.entries(energy)) state = attachFromDeck(state, "p1", id, n);
  return setActiveFromDeck(state, "p2", "fix-bigbody");
}

function activeEnergy(state: GameState, seat: "p1" | "p2"): string[] {
  return [...(state.players[seat].active?.energy ?? [])];
}

function discardPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
  return state.phase.prompt;
}

describe("D402 §4 — the `count: \"all\"` arm: the record filed with NOTHING parking", () => {
  it("strips every {L}, keeps the rest, and deals 50 × 3 = 150 in ONE action", () => {
    // "Discard all {L} Energy from this Pokémon." asks nothing — every match comes
    // off — so this is the first program in the engine to file a §9.2 record from the
    // interpreter's INLINE branch. The `fix-energy` that paid the {C} cost and the
    // `fix-special` stay attached: the filter is `providesEnergy` Lightning and a
    // Special Energy provides {C}.
    const state = fielded(1, "fix-allscale", {
      "fix-lightning-energy": 3,
      "fix-energy": 1,
      "fix-special": 1,
    });
    const before = activeEnergy(state, "p1");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, attack);

    expect(done.phase.kind).not.toBe("effect:choose");
    const discarded = find(events, "ENERGY_DISCARDED");
    expect(discarded).toMatchObject({ seat: "p1", actor: "p1", uids: before.slice(0, 3) });
    expect(activeEnergy(done, "p1")).toEqual(before.slice(3));
    expect(activeEnergy(done, "p1")).toHaveLength(2);
    // …and the damage the record feeds, dealt through the same §8.5 pipeline.
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 150 });
    expect(done.players.p2.active?.damage).toBe(150);
    // The printed order, and nothing between the two ops.
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "ENERGY_DISCARDED",
      "DAMAGE_DEALT",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
  });

  it("🛑 ZERO {L} attached deals ZERO — the printed `50×` base is SUPPRESSED", () => {
    // The whole point of `programDamage`. With no match the record is EMPTY, the
    // per-unit multiplies to nothing, and the printed 50 must not leak through the
    // pre-program pipeline. A kept base would deal 50 here.
    const state = fielded(2, "fix-allscale", { "fix-energy": 1, "fix-special": 1 });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, attack);
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("ENERGY_DISCARDED");
    expect(done.players.p2.active?.damage ?? 0).toBe(0);
    // …and the coverage flag is NOT raised: the program owns the text and the "×".
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("ONE {L} deals 50 — the count is what scales, not the board", () => {
    const state = fielded(3, "fix-allscale", { "fix-lightning-energy": 1, "fix-energy": 1 });
    const { state: done, events } = mustApply(state, attack);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(50);
    expect(activeEnergy(done, "p1")).toHaveLength(1);
  });
});

describe("D402 §5 — the declinable arm, and the caption `energyNoun` grew for it", () => {
  it("🛑 the prompt is the PRINTED noun phrase, and the offer is Basic Energy only", () => {
    // "from your Pokémon" is the whole own side, so a BENCHED Basic Energy is fuel.
    // `fix-special` is refused: "Basic Energy" names the CARD, not what it provides.
    let state = fielded(4, "fix-basicscale", { "fix-energy": 2, "fix-special": 1 });
    state = benchFromDeck(state, "p1", "fix-bigbody");
    const benchIndex = state.players.p1.bench.length - 1;
    state = attachBenchFromDeck(state, "p1", benchIndex, "fix-lightning-energy", 1);
    const activeBasics = activeEnergy(state, "p1").slice(0, 2);
    const special = activeEnergy(state, "p1")[2] as string;
    const benchBasic = state.players.p1.bench[benchIndex]?.energy[0] as string;
    deepFreeze(state);

    const { state: parked, events } = mustApply(state, attack);

    expect(parked.phase.kind).toBe("effect:choose");
    // 🆕🆕 D402 — the caption used to fall through to the generic "Energy", which
    // would have promised the player any Energy over a Basic-only pick. `energyNoun`
    // grew a `basicEnergy` arm for exactly this prompt.
    expect(discardPrompt(parked).note).toBe(
      "Discard any amount of Basic Energy from your Pokémon.",
    );
    expect(discardPrompt(parked).scope).toEqual({ kind: "upTo", max: 3 });
    expect(discardPrompt(parked).discardable.map((d) => d.uid)).toEqual([
      ...activeBasics,
      benchBasic,
    ]);
    expect(discardPrompt(parked).discardable.map((d) => d.uid)).not.toContain(special);
    // Nothing dealt yet — the whole attack's damage waits behind the choice.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
  });

  it("declining discards nothing and deals ZERO — the `70×` base suppressed again", () => {
    const state = fielded(5, "fix-basicscale", { "fix-energy": 2 });
    const { state: parked } = mustApply(state, attack);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [] },
    });
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(activeEnergy(done, "p1")).toHaveLength(2);
    expect(done.players.p2.active?.damage ?? 0).toBe(0);
  });

  it("taking TWO of three deals 140, and leaves the third attached", () => {
    let state = fielded(6, "fix-basicscale", { "fix-energy": 3 });
    deepFreeze(state);
    const { state: parked } = mustApply(state, attack);
    const picks = discardPrompt(parked).discardable.map((d) => d.uid);
    expect(picks).toHaveLength(3);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: picks.slice(0, 2) },
    });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(140);
    expect(activeEnergy(done, "p1")).toEqual([picks[2]]);
    state = done;
    expect(state.players.p2.active?.damage).toBe(140);
  });
});
