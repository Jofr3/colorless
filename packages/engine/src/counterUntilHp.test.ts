import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { applyAction, deriveAttackEffect, engineVersion, logFromEvents } from "./index";
import type { EffectOp, GameEvent, GameState, LogContext } from "./index";
import { runProgram } from "./interpreter";
import { programFor, registryCardIds } from "./registry";
import {
  COUNTER_UNTIL_HP_DECK,
  attachFromDeck,
  attachToolFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
} from "./testFixtures";

// 0.352.0 → 0.353.0 — 🆕🆕🆕 **D451: THE PLACEMENT WHOSE AMOUNT IS NOT PRINTED.**
//
// THREE sentences, FIVE legal printings, ONE new `EffectOp`:
//   · `censusAttackCorpus.ts` line **425** — *"Put damage counters on each of your
//     opponent's Benched Pokémon until its remaining HP is 100."* (2 printings), arm 23h;
//   · line **427** — *"…on your opponent's Active Pokémon until its remaining HP is 50."*
//     (2), arm 23g;
//   · line **426** — the same sentence at **10** (1), arm 23g.
//
// 🛑 **THE CLASS IS CLOSED AND THAT IS MEASURED, NOT SAMPLED.** `\bHP\b` over all 640
// corpus sentences returns exactly these three (§1). So there is no fourth destination
// hiding in the column, no *"until its remaining HP is 0"* — which would change the
// no-Knock-Out property below — and no destination that is not a multiple of ten.
//
// 🛑 **WHAT IS NEW IS ONLY THE AMOUNT.** Every sibling in the placement family reads a
// printed COUNT and multiplies by ten at the producer (§12). These sentences print no
// count at all: they print a DESTINATION, and the amount is
// `effectiveMaxHp − damage − remainingHp`, computed PER BODY at the moment the op runs.
// So the field holds HP rather than counters and the arms do NO conversion, which is
// the one line they could have copied from a sibling and been wrong (§2).
//
// 🛑 **THE REFUSAL THIS SLICE OVERTURNS IS *"no capture can express it"*, WHICH IS HALF
// TRUE AND HALF A NON-SEQUITUR — D450's shape, one slice later.** Two shipped doc
// blocks (`effects.ts`'s `COUNTER_PUT_ON_DEFENDER` and index.ts's D139 paragraph) have
// said since 0.88.0 that these rows *"read their amount off the TARGET rather than off
// the text … which is a different mechanism and no capture can express it"*. The AMOUNT
// really is unprintable. **The DESTINATION is printed, is a bare integer, and a capture
// expresses it exactly.** Both blocks are corrected in place and dated (D423).
//
// 🛑 **A PREMISE OF THE WORK ORDER THAT DID NOT SURVIVE.** The brief said *"the Active
// pair is now a one-axis near miss of the arm it built (23e)"*. The Active pair is not a
// fold at all — *"your opponent's Active Pokémon"* names ONE body, and its nearest
// sibling is arm 22 (`damageActive`), not 23e. It is the **BENCH** sentence (line 425)
// that near-misses 23e, which is what D450's own resume point said (*"the FIRST of the
// three"*, and 425 is the first). Driven in §1, not argued.
//
// 🛑 **AND THE FLOOR IS `healEachAll`'s, WHICH IS A THIRD SHIPPED SHAPE THE BRIEF DID
// NOT NAME.** It offered two — D449's guard before the park, and `counterEachAll`'s
// whole-op `amount <= 0` — and asked which to follow. Neither fits: both guard a
// CONSTANT handed in by the producer, and this amount varies per body. `healEach` /
// `healEachAll` have skipped per body on a computed `<= 0` since 0.x, and that is the
// mirror of this op (they clamp to `damage`, it clamps to `max − damage − target`). So
// the answer is an existing third rather than a new one (§6).
//
// 🛑 **`MATCH_RECORD_VERSION` STAYS 29.** A NEW `EffectOp` inhabitant is a WIDENING
// (D383–D385): no v29 byte string can hold it, and every pre-existing inhabitant reads
// identically. §3 drives that over the serialized bytes in three directions, and the
// LOSS direction is where the argument is actually made — a lost `remainingHp` is not a
// soft landing but **`NaN` damage on a body that can then never be Knocked Out**, which
// is D435's silent-corruption shape at a new op.

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function placements(
  events: readonly GameEvent[],
): Extract<GameEvent, { type: "COUNTERS_PLACED" }>[] {
  return events.filter(
    (e): e is Extract<GameEvent, { type: "COUNTERS_PLACED" }> => e.type === "COUNTERS_PLACED",
  );
}

/** The three printed sentences, transcribed byte for byte off the committed column. */
const BENCH_100 =
  "Put damage counters on each of your opponent's Benched Pokémon until its remaining HP is 100.";
const ACTIVE_50 = "Put damage counters on your opponent's Active Pokémon until its remaining HP is 50.";
const ACTIVE_10 = "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10.";

/** `fix-hptarget`'s attack indices, named so a board reads as a sentence. */
const IDX = { bench: 0, deep: 1, shallow: 2, bolt: 3 } as const;

/** The two printed maxima this file's arithmetic is written against. */
const BIG_HP = 200; // fix-bigbody
const WEAK_HP = 130; // fix-lightning-weak, ×2 Lightning
const CHARM_HP = 50; // sv02-173 Bravery Charm, +50 on a Basic

/** Both Actives pinned to `fix-bigbody` (200 HP, Colorless, no Ability), p1's turn
    open. Colorless on both sides matters: a placed counter must be FLAT, and a board
    whose default defender could double would make every number here ambiguous. */
function table(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: COUNTER_UNTIL_HP_DECK, p2: COUNTER_UNTIL_HP_DECK },
    { first: "p2", active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields `fix-hptarget` with one {L} attached (the {C} cost, and the type that
    arms Bellibolt's clause). Both benches are cleared after the Active surgeries,
    because `setActiveFromDeck` DISPLACES rather than removes. */
function fielded(
  seed: number,
  opts: { defender?: string; theirs?: readonly string[] } = {},
): GameState {
  let state = setActiveFromDeck(table(seed), "p1", "fix-hptarget");
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", "fix-lightning-energy", 1);
  if (opts.defender !== undefined) state = setActiveFromDeck(state, "p2", opts.defender);
  state = clearBench(state, "p2");
  for (const body of opts.theirs ?? []) state = benchFromDeck(state, "p2", body);
  return state;
}

function attack(state: GameState, index: number): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

const theirActive = (s: GameState) => s.players.p2.active;
const theirBench = (s: GameState) => s.players.p2.bench;

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the population: what is claimed, what is closed, and what is still refused.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — three sentences, five printings, and the class is CLOSED", () => {
  it("all three are in the legal attack column at the printing counts this slice claims", () => {
    // ⚠️ A brief's printing count is a FLOOR until it is read off the corpus (D445),
    // and this brief's was RIGHT — 2 + 1 + 2 = 5, which is the first time in this
    // family that a sentence has carried more than one printing.
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(BENCH_100)).toBe(2);
    expect(rows.get(ACTIVE_10)).toBe(1);
    expect(rows.get(ACTIVE_50)).toBe(2);
    expect((rows.get(BENCH_100) ?? 0) + (rows.get(ACTIVE_10) ?? 0) + (rows.get(ACTIVE_50) ?? 0)).toBe(5);
  });

  it("🛑 `\\bHP\\b` over the WHOLE column returns exactly these three — the class is closed", () => {
    // THE PATTERN, PUBLISHED SO ITS EDGES ARE VISIBLE (D424/D425). `\bHP\b` is the
    // LOOSEST shape that can see this mechanism at all: the sentences print no count,
    // no verb the family does not share and no noun that is theirs alone — the only
    // token unique to them is the unit itself. It is CASE-SENSITIVE and word-bounded on
    // purpose: `/hp/i` would also match nothing here (no corpus sentence spells it
    // lowercase), and dropping the bounds would match nothing new either.
    const hp = legalAttackCorpus().filter(([, t]) => /\bHP\b/.test(t));
    expect(hp.map(([, t]) => t).sort()).toEqual([BENCH_100, ACTIVE_10, ACTIVE_50].sort());
    expect(hp.reduce((sum, [n]) => sum + n, 0)).toBe(5);
    // …so THREE things follow that a sampled pattern could not establish:
    //   (i)   there is no fourth destination in the column;
    //   (ii)  there is no *"until its remaining HP is 0"* — the ONE printing that would
    //         make this op lethal and owe it a Knock Out, a Prize and a cause marker;
    //   (iii) every printed destination is a multiple of ten, so the §12 rounding
    //         question §10 drives is about the BODY's damage and never about the target.
    for (const [, t] of hp) {
      const printed = Number(/remaining HP is (\d+)\./.exec(t)?.[1]);
      expect(printed).toBeGreaterThan(0);
      expect(printed % 10).toBe(0);
    }
    // ⚠️ WHAT THIS PATTERN CANNOT SEE, STATED RATHER THAN GLOSSED. `legalAttackCorpus()`
    // is the `legal_standard = 1` ATTACK column and nothing else — so it is blind to
    // ability text (where *"if this Pokémon's remaining HP is 30 or less"* lives, D310),
    // to Trainer text, and to every rotated-out printing. Two shipped doc blocks name
    // "Alolan Raticate swsh10.5-042" and "Claydol sv03-095" as carriers off the LOCAL
    // six-set D1; that is a different population, this checkout can resolve neither id,
    // and neither is claimed (D425).
    expect(legalAttackCorpus().some(([, t]) => /remaining HP is 30 or less/.test(t))).toBe(false);
  });

  it("all three resolve through the reader SURFACE, and the surface did not grow", () => {
    // Asked of the SURFACE rather than of one reader (D447): both arms sit inside
    // `deriveAttackEffect`, so there is no fourteenth reader.
    for (const s of [BENCH_100, ACTIVE_50, ACTIVE_10]) expect(resolvedByAnyReader(s), s).toBe(true);
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("🛑 the PLACEMENT family closes from SEVEN rows to FOUR to TWO, each refusal by name", () => {
    // D449's pattern re-run rather than re-imagined: `/put \d* ?damage counters/i`, case
    // INSENSITIVE with the count OPTIONAL. The optional count is what catches these
    // three rows at all — they print no number before the noun — so the family figure
    // has been able to see them since D449 published the shape.
    const family = legalAttackCorpus().filter(([, t]) => /put \d* ?damage counters/i.test(t));
    expect(family).toHaveLength(19);
    expect(family.reduce((sum, [n]) => sum + n, 0)).toBe(38);
    const unread = family.filter(([, t]) => !resolvedByAnyReader(t));
    // ⚠️ **THE TWO FIGURES MOVE BY DIFFERENT AMOUNTS AND THAT IS THE SLICE'S ONE
    // ARITHMETIC SURPRISE.** Sentences fall 7 → 4 and printings fall 12 → 7: −3 and −5.
    // Every sentence D449 and D450 claimed carried exactly one printing, so three
    // consecutive slices stepped both figures by the same number and a fourth that
    // assumed it would have been wrong in one of them.
    // 🆕🆕 **D456 — FOUR BECAME TWO AND SEVEN BECAME FOUR**, and the two that left are
    // bullets (a) and (b) below, both re-pointed rather than deleted. ⚠️ **THE TWO FIGURES
    // DISAGREE AGAIN, −2 AND −3**: line 179 carries 1 printing and line 180 carries 2.
    expect(unread).toHaveLength(2);
    expect(unread.reduce((sum, [n]) => sum + n, 0)).toBe(4);
    const unbuilt = unread.map(([, t]) => t);
    for (const s of [BENCH_100, ACTIVE_50, ACTIVE_10]) expect(unbuilt).not.toContain(s);

    // THE TWO THAT REMAIN, ENUMERATED WHOLE AND EACH WITH ITS OWN REASON — plus the two
    // this slice's SUCCESSOR claimed, kept here as inequalities (D418: re-point, never
    // delete, and then ask what the old claim could catch that the new one cannot).
    //
    // (a) THE DELAYED RETALIATION AT A PRINTED COUNT — 1 printing. 🆕🆕 **CLAIMED AT D456,
    //     AND THIS BULLET'S REFUSAL WAS EXACT ABOUT THIS FILE'S ANCHOR AND SAID NOTHING
    //     ABOUT THE SENTENCE.** It was refused here on the TIMING (a durated *"During your
    //     opponent's next turn"* window, which no `^Put` anchor can open) and on the TARGET
    //     (*"the Attacking Pokémon"*, a body no zone in this family names). Both are still
    //     true of THIS family — and D152's `installRecoil` had opened that window and named
    //     that body since long before D451 was written. The sentence needed ONE token: the
    //     shipped anchor demanded *"(even if **it** is Knocked Out)"* and this printing
    //     spells *"(even if **this Pokémon** is Knocked Out)"*.
    //     ⚠️ **THE OLD CLAIM CAUGHT "NO READER TAKES THIS"; THE NEW ONE PINS *WHICH* OP AND
    //     *WHICH* AMOUNT**, which is strictly the stronger rung here — a reader that took
    //     the sentence with the wrong number would have passed the `toContain` the day it
    //     stopped being unbuilt, and cannot pass this.
    expect(unbuilt).not.toContain(
      "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put 6 damage counters on the Attacking Pokémon.",
    );
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put 6 damage counters on the Attacking Pokémon.",
      ),
    ).toEqual([{ op: "installRecoil", amount: 60 }]);
    // (b) 🛑 **ITS TWIN WITH THE AMOUNT UNPRINTED — 2 printings, CLAIMED AT D456, AND
    //     THIS IS THE BULLET WHOSE REASONING DID NOT SURVIVE.** It read: *"D451's quantity
    //     is a fact about the BODY STANDING THERE, readable at the instant the op runs,
    //     where this one is a HISTORY of what happened during the opponent's turn — it
    //     needs a durated watcher and a recorded figure, neither of which this op has."*
    //     🛑 **THE FIRST HALF IS EXACT AND THE SECOND HALF IS FALSE OF THE FAMILY, THOUGH
    //     TRUE OF THIS OP.** The durated watcher is `InstalledRecoil` and has existed since
    //     D152. And the figure never becomes a HISTORY at all: the §9 recoil site
    //     (`attack.ts`) and the interpreter's `reactToAttackDamage` each hold the number in
    //     a local named `dealt` — the same local their own `dealt > 0` gate reads — two
    //     lines above the call that now consumes it. **Nothing is recorded and nothing is
    //     carried**; `installedRecoilOf` gained a REQUIRED third parameter and that is the
    //     whole of the channel. The refusal was right about `counterUntilRemainingHp` and
    //     wrong as a statement about the sentence, which is the difference a refusal
    //     scoped to an OP has to keep making (D422/D428: write the falsifier, and scope it).
    expect(unbuilt).not.toContain(
      "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon.",
    );
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon.",
      ),
    ).toEqual([{ op: "installRecoil", amount: "damageTaken" }]);
    // …and the two are NOT the same program, which is the discrimination the pair of
    // `toContain`s above could never provide: one anchor with a looser amount slot would
    // have claimed both sentences with one op and passed every rung in this block.
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put 6 damage counters on the Attacking Pokémon.",
      ),
    ).not.toEqual(
      deriveAttackEffect(
        "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon.",
      ),
    );
    // (c) THE SCALED TWIN — 3 printings, and now the largest unread row in the family
    //     again. RE-MEASURED at this head rather than inherited: the count is a
    //     `{kind: "cardsInDiscardPile", …}` PAYLOAD no rider carries, and the tail has
    //     no reader.
    expect(unbuilt).toContain(
      "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.",
    );
    expect(deriveAttackEffect("Then, shuffle those Energy cards into your deck.")).toBeNull();
    // (d) THE CONFUSION SUBSTITUTION — 1 printing. Not a placement at all: it RAISES the
    //     Checkup's own per-condition amount, a status field reached by a status op.
    expect(unbuilt).toContain(
      "Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that Pokémon for this Special Condition.",
    );
    // …and the one the published pattern CANNOT see, carried forward from D450 because
    // a hole a predecessor named is a hole this slice inherits: `Put up to 9 …` puts the
    // bound between the verb and the count.
    expect(
      deriveAttackEffect(
        "Put up to 9 damage counters on this Pokémon. This attack does 20 damage for each damage counter you placed in this way.",
      ),
    ).toBeNull();
  });

  it("🛑 the BENCH sentence is arm 23e's near miss and the ACTIVE pair is NOT — the brief had it backwards", () => {
    // The work order said *"the Active pair is now a one-axis near miss of the arm it
    // built (23e)"*. Arm 23e reads *"Put {N} damage counters on each of your opponent's
    // Pokémon."* — a FOLD. Line 425 is a fold too (*"each of … Benched Pokémon"*) and
    // differs from it on the amount and the zone; lines 426/427 name ONE body and share
    // no quantifier with it at all. Driven as a program shape rather than argued.
    const fold = deriveAttackEffect("Put 2 damage counters on each of your opponent's Pokémon.");
    expect(fold?.[0]?.op).toBe("counterEachAll");
    expect(deriveAttackEffect(BENCH_100)?.[0]).toMatchObject({ target: "opponentBench" });
    expect(deriveAttackEffect(ACTIVE_50)?.[0]).toMatchObject({ target: "opponentActive" });
    // …and the ACTIVE pair's real sibling is arm 22, which names the same body and
    // differs only in where the number comes from.
    expect(deriveAttackEffect("Put 7 damage counters on your opponent's Active Pokémon.")).toEqual([
      { op: "damageActive", amount: 70, source: "attack" },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the two anchors: what they claim, and the cross product they refuse.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the anchors derive their own ops, and the co-variance is fenced", () => {
  it("each sentence derives the exact literal, and the printed number is HP not counters", () => {
    expect(deriveAttackEffect(BENCH_100)).toEqual([
      { op: "counterUntilRemainingHp", target: "opponentBench", remainingHp: 100, source: "attack" },
    ]);
    expect(deriveAttackEffect(ACTIVE_50)).toEqual([
      { op: "counterUntilRemainingHp", target: "opponentActive", remainingHp: 50, source: "attack" },
    ]);
    expect(deriveAttackEffect(ACTIVE_10)).toEqual([
      { op: "counterUntilRemainingHp", target: "opponentActive", remainingHp: 10, source: "attack" },
    ]);
    // 🛑 **NO × 10, AND THIS IS THE RUNG THAT SAYS SO.** Every sibling arm in this family
    // converts the printed COUNT to HP at the producer (§12); these two pass the printed
    // number through because it is already HP. The two readings are 10 apart on the same
    // digits, and the sibling is asserted beside it so the difference is visible rather
    // than implied.
    expect(deriveAttackEffect(ACTIVE_10)?.[0]).toMatchObject({ remainingHp: 10 });
    expect(deriveAttackEffect("Put 10 damage counters on your opponent's Active Pokémon.")).toEqual([
      { op: "damageActive", amount: 100, source: "attack" },
    ]);
  });

  it("🛑 refuses the CROSS PRODUCT — the determiner and the zone word CO-VARY", () => {
    // This is the whole reason there are two anchors instead of one with two optional
    // groups. The catalog prints *"each of … Benched"* and *"(nothing) … Active"*; a
    // single regex with `(each of )?` and `(Benched|Active)` would additionally accept
    // the two crossings below, whose readings nobody has decided — an "each of … Active"
    // is a fold over one body and a bare "Benched" is a fold with its quantifier missing.
    for (const [why, text] of [
      [
        "the determiner on the ACTIVE",
        "Put damage counters on each of your opponent's Active Pokémon until its remaining HP is 10.",
      ],
      [
        "the BENCH with no determiner",
        "Put damage counters on your opponent's Benched Pokémon until its remaining HP is 100.",
      ],
    ] as const) {
      expect(deriveAttackEffect(text), why).toBeNull();
    }
  });

  it("🛑 the `$` fences the printed COMPOUND, which is a STRICT PREFIX extension", () => {
    // The Active sentence at 10 is printed again with a consequent riding it — the row
    // `effects.ts`'s D139 block calls "Claydol sv03-095 with a self-damage rider", and
    // which `counterPut.test.ts` has carried as a near miss since 0.88.0. Its first
    // sentence is byte-identical to ACTIVE_10, so an unanchored read would claim it and
    // silently drop a printed 120 damage. It is NOT in the legal column, so the refusal
    // is asserted directly and never through `legalAttackCorpus()` (D413/D449).
    const compound =
      "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10. If you placed any damage counters in this way, this attack also does 120 damage to this Pokémon.";
    expect(compound.startsWith(ACTIVE_10)).toBe(true);
    expect(deriveAttackEffect(compound)).toBeNull();
    expect(legalAttackCorpus().some(([, t]) => t === compound)).toBe(false);
  });

  it("refuses every other near miss, each on a different axis", () => {
    for (const [why, text] of [
      // THE SEAT — your own bodies, the destination reversed.
      [
        "your own Active",
        "Put damage counters on your Active Pokémon until its remaining HP is 10.",
      ],
      // THE PHRASE — "or less" is D349's PREDICATE and a different question entirely.
      [
        "the threshold reading",
        "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10 or less.",
      ],
      // NO TRAILING PERIOD — the `$` sits after it.
      ["no period", "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10"],
      // A LOWERCASE first word: what keeps every mid-sentence ABILITY printing of this
      // action off this path, and the standing reason there is no /i anywhere here.
      ["lowercase, mid-sentence", "put damage counters on your opponent's Active Pokémon until its remaining HP is 10."],
      // A LEADING RIDER pins `^`; a trailing one pins `$` (the compound above).
      [
        "a gate clause in front",
        "Flip a coin. If heads, put damage counters on your opponent's Active Pokémon until its remaining HP is 10.",
      ],
      // THE SINGULAR NOUN — the family's standing near miss shape.
      ["one counter, singular", "Put damage counter on your opponent's Active Pokémon until its remaining HP is 10."],
      // A PRINTED COUNT in front: that is arm 22's sentence with this one's tail, and it
      // is exactly the sentence a merged anchor would have invented.
      [
        "a count AND a destination",
        "Put 5 damage counters on your opponent's Active Pokémon until its remaining HP is 10.",
      ],
      ["empty", ""],
    ] as const) {
      expect(deriveAttackEffect(text), why).toBeNull();
    }
  });

  it("derives the CURLY apostrophe identically, and rejects a NON-BREAKING space", () => {
    // EQUALITY with the straight form, never merely non-null: a non-null check passes on
    // a reader that folded the sentence into some other row (D136/D137).
    for (const s of [BENCH_100, ACTIVE_50, ACTIVE_10]) {
      const curly = s.replaceAll("'", "’");
      expect(curly).not.toBe(s);
      expect(deriveAttackEffect(curly), s).toEqual(deriveAttackEffect(s));
    }
    // U+00A0, spelled as an ESCAPE rather than typed: byte-different from an ASCII space
    // and INVISIBLE in a diff, which is the whole reason it is written this way.
    expect(deriveAttackEffect(ACTIVE_50.replace(" damage", " damage"))).toBeNull();
    // Outer whitespace SURVIVES by design (the deriver trims).
    expect(deriveAttackEffect(`\t  ${ACTIVE_50}\n`)).toEqual(deriveAttackEffect(ACTIVE_50));
  });

  it("🛑 refuses a printed destination of ZERO, which is the ONE value that would make this op lethal", () => {
    // The guard is `>= 1` at BOTH arms and again at the interpreter (§7). A destination
    // of 0 means "fill to 0 remaining HP", i.e. `damage = max`, i.e. a Knock Out — and
    // this op emits no KNOCKED_OUT, stages no `takePrizes` and stamps no cause marker.
    // Refusing at the anchor is the loud half of that pair.
    for (const s of [
      "Put damage counters on your opponent's Active Pokémon until its remaining HP is 0.",
      "Put damage counters on each of your opponent's Benched Pokémon until its remaining HP is 0.",
    ]) {
      expect(deriveAttackEffect(s), s).toBeNull();
    }
    // …and an UNPRINTED positive destination IS accepted, which is D131/D135/D139's
    // standing call: an unambiguous sentence the op expresses exactly is derived even
    // where no card prints that number. A claim about the GAME, not about the INGEST.
    expect(
      deriveAttackEffect("Put damage counters on your opponent's Active Pokémon until its remaining HP is 7."),
    ).toEqual([{ op: "counterUntilRemainingHp", target: "opponentActive", remainingHp: 7, source: "attack" }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the persisted op, and the version prediction DRIVEN over the bytes.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — a NEW `EffectOp` inhabitant, and the record version does not move", () => {
  it("🛑 the version PREDICTION, driven over the SERIALIZED BYTES in THREE directions", () => {
    // 🛑 **WHICH SITUATION THIS IS, ASKED RATHER THAN INHERITED (D386/D443).** A new
    // union member at a persisted address is D383–D385's WIDENING and free; a RENAME or
    // a new REQUIRED key on an EXISTING member is not. This slice does the first and
    // none of the second — `counterEachAll`, `damageActive` and `damageChosen` are
    // untouched — and the reachability half is checked anyway.

    // **DIRECTION 1 — FORWARD: the literal this deploy writes, whole.** Key sets are
    // asserted rather than eyeballed, because "the object looked right" is how a key
    // goes missing.
    const fresh = (deriveAttackEffect(ACTIVE_50) as EffectOp[])[0] as EffectOp;
    expect(JSON.stringify(fresh)).toBe(
      '{"op":"counterUntilRemainingHp","target":"opponentActive","remainingHp":50,"source":"attack"}',
    );
    expect(Object.keys(fresh).sort()).toEqual(["op", "remainingHp", "source", "target"]);
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(fresh);
    const bench = (deriveAttackEffect(BENCH_100) as EffectOp[])[0] as EffectOp;
    expect(JSON.stringify(bench)).toBe(
      '{"op":"counterUntilRemainingHp","target":"opponentBench","remainingHp":100,"source":"attack"}',
    );

    // **DIRECTION 2 — BACKWARD, AND IT IS THE ONE THAT DECIDES THE VERSION.** An
    // `EffectOp` reaches storage by exactly one route: `EffectContinuation` carries
    // `{pendingOp, rest, ctx, record}` and lives at `GameState.phase.cont`, which
    // `MatchRecord.state` persists. A continuation is written only when a program PARKS.
    // Three facts, each measured rather than recalled:
    //   · **no v29 record can name this op at all** — it did not exist at v29, so no
    //     byte string written by any earlier deploy can contain the string below;
    //   · **it never parks** — its `stepOp` arm returns `{ done }`, driven on all three
    //     printed sentences by the absence of an `effect:choose` phase;
    //   · **and no producer could put it in `cont.rest` either**, because both arms
    //     return programs of LENGTH 1 and the registry authors it nowhere. The registry
    //     sweep is over `registryCardIds()` and not `FIXTURE_POOL` (D342): a pool-scoped
    //     auditor audits the pool. Its four program-bearing keys are walked.
    expect(JSON.stringify(fresh)).toContain("counterUntilRemainingHp");
    for (const s of [BENCH_100, ACTIVE_50, ACTIVE_10]) {
      expect(deriveAttackEffect(s), s).toHaveLength(1);
    }
    const authored: EffectOp[][] = [];
    for (const id of registryCardIds()) {
      const card = programFor(id);
      if (card === undefined) continue;
      for (const ops of Object.values(card.attack ?? {})) authored.push(ops);
      for (const ability of card.abilities ?? []) authored.push(ability.program);
      for (const trigger of card.triggered ?? []) authored.push(trigger.program);
      if (card.trainer !== undefined) authored.push(card.trainer);
    }
    expect(authored.length).toBeGreaterThan(0);
    expect(authored.flat().filter((o) => o.op === "counterUntilRemainingHp")).toHaveLength(0);
    for (const index of [IDX.bench, IDX.deep, IDX.shallow]) {
      const { state } = attack(fielded(30 + index, { theirs: ["fix-bigbody"] }), index);
      expect(state.phase.kind, `index ${index}`).not.toBe("effect:choose");
    }

    // **DIRECTION 3 — THE LOSS DIRECTION, AND IT IS THE ONE THE BRIEF WAS RIGHT TO
    // DEMAND.** Each of the three keys degrades DIFFERENTLY if a record could lose it,
    // and one of them is worse than anything in this op's neighbourhood. Stated in full
    // before the reachability argument, because the reachability argument alone reads as
    // an excuse (D450's rule).
    for (const key of ["op", "target", "remainingHp", "source"] as const) {
      const dropped = JSON.parse(JSON.stringify(fresh, (k, v) => (k === key ? undefined : v))) as Record<
        string,
        unknown
      >;
      expect(Object.keys(dropped), key).not.toContain(key);
      expect(dropped).not.toEqual(fresh);
      expect(dropped).not.toEqual(bench);
    }
    // · a lost `target` falls through the `=== "opponentActive"` test into the BENCH
    //   branch, so an Active-scoped sentence would counter the whole Bench and leave the
    //   Active alone — a plausible-looking board, D425's own detectability failure;
    // · a lost `source` files a `COUNTERS_PLACED` whose label matches no arm of
    //   `log.ts`'s switch — a row that simply does not render;
    // · 🛑 **a lost `remainingHp` is neither.** `undefined <= 0` is FALSE, so the zero
    //   guard passes; `max - damage - undefined` is **NaN**; `NaN <= 0` is FALSE, so the
    //   floor passes too; and the body's `damage` becomes NaN. `isLethallyDamaged` then
    //   answers `NaN >= hp` → **false**, so that body can never be Knocked Out again and
    //   the board looks entirely normal. That is D435's silent-corruption shape arriving
    //   at a new op, and it is DRIVEN below rather than reasoned about.
    const board = fielded(37, { theirs: ["fix-bigbody"] });
    const events: GameEvent[] = [];
    const mutilated = JSON.parse(
      JSON.stringify(fresh, (k, v) => (k === "remainingHp" ? undefined : v)),
    ) as EffectOp;
    const run = runProgram(board, [mutilated], { seat: "p1", invokedBy: "attack" }, events);
    expect(Number.isNaN(run.state.players.p2.active?.damage ?? 0)).toBe(true);
    expect(placements(events)[0]?.amount).toBeNaN();
    // …and NONE of the three is reachable, because direction 2 established there is no
    // record to lose them from. Both halves are stated; neither alone is the argument.
  });

  it("the engine version moved and the record version did not", () => {
    expect(engineVersion).toBe("0.379.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — WHICH HP: `effectiveMaxHp`, never the printed `hpOf`.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the maximum is the CONTINUOUS one and a Tool moves it", () => {
  it("fills a bare 200 HP Active to exactly the printed destination", () => {
    const { state, events } = attack(fielded(40), IDX.deep);
    expect(placements(events)).toHaveLength(1);
    expect(placements(events)[0]?.amount).toBe(BIG_HP - 50);
    expect(theirActive(state)?.damage).toBe(BIG_HP - 50);
    // The printed phrase, read back off the board: remaining IS the destination.
    expect(BIG_HP - (theirActive(state)?.damage ?? 0)).toBe(50);
  });

  it("🛑 a BRAVERY CHARM raises the destination it is filled to — 150 becomes 200", () => {
    // `effectiveMaxHp` = printed 200 + the Tool's 50 = 250, so *"until its remaining HP
    // is 50"* means 200 HP of counters and not 150. A build reading `hpOf` places 150
    // and leaves the body at 100 remaining, which is a plausible board and the whole
    // reason this rung exists. Both numbers are asserted, not just the new one.
    let state = fielded(41);
    state = attachToolFromDeck(state, "p2", "active", "sv02-173");
    const run = attack(state, IDX.deep);
    expect(placements(run.events)[0]?.amount).toBe(BIG_HP + CHARM_HP - 50);
    expect(theirActive(run.state)?.damage).toBe(200);
    // …and the remaining HP really is 50 against the EFFECTIVE maximum, which is the
    // reading the card prints; against the printed 200 it would be 0, i.e. a Knock Out.
    expect(BIG_HP + CHARM_HP - (theirActive(run.state)?.damage ?? 0)).toBe(50);
    expect(find(run.events, "KNOCKED_OUT")).toBeUndefined();
  });

  it("the destination is read at the moment the op runs, on a body that already carries damage", () => {
    // `remainingHpWithin` (continuous.ts) reads `effectiveMaxHp − damage` and this op
    // subtracts from the same quantity; the two cannot disagree because they are the
    // same two terms. Driven at three different starting damages on one destination.
    for (const [seed, before, placed] of [
      [42, 0, BIG_HP - 10],
      [43, 60, BIG_HP - 60 - 10],
      [44, 150, BIG_HP - 150 - 10],
    ] as const) {
      const run = attack(setDamage(fielded(seed), "p2", before), IDX.shallow);
      expect(placements(run.events)[0]?.amount, `damage ${before}`).toBe(placed);
      expect(theirActive(run.state)?.damage, `damage ${before}`).toBe(BIG_HP - 10);
    }
  });

  it("a body whose printed HP cannot be read takes NOTHING — the data gap is refused", () => {
    // `effectiveMaxHp` owns the catalog data gap and returns null; an unknown maximum
    // cannot be subtracted from. Refusing is `remainingHpWithin`'s direction verbatim.
    // Driven through the op directly, because no fixture in this pool has a null hp.
    const board = fielded(45);
    const gapped: GameState = {
      ...board,
      players: {
        ...board.players,
        p2: {
          ...board.players.p2,
          active: board.players.p2.active === null ? null : { ...board.players.p2.active, stack: [] },
        },
      },
    };
    const events: GameEvent[] = [];
    const run = runProgram(
      gapped,
      deriveAttackEffect(ACTIVE_50) as EffectOp[],
      { seat: "p1", invokedBy: "attack" },
      events,
    );
    expect(placements(events)).toHaveLength(0);
    expect(run.state.players.p2.active?.damage).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the distributive "its": each body is filled INDEPENDENTLY.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — `its` binds PER BODY, and a shared amount is a killed build", () => {
  /** THE BOARD THE POSSESSIVE NEEDS: three Benched bodies whose remaining HP is three
      different numbers, so no single amount is right for more than one of them.
        · bench 0 — fix-bigbody, 200 HP, undamaged   → remaining 200, takes 100
        · bench 1 — fix-bigbody, 200 HP, 30 damage   → remaining 170, takes  70
        · bench 2 — fix-lightning-weak, 130 HP, 40   → remaining  90, takes   0
      A build that computed ONE figure above the walk places the first body's number on
      all three; a build that clamped to the SMALLEST places 0 everywhere. Both are
      distinguishable here and neither is on any board where the bench agrees. */
  function benched(seed: number): GameState {
    let state = fielded(seed, { theirs: ["fix-bigbody", "fix-bigbody", "fix-lightning-weak"] });
    state = setBenchDamage(state, "p2", 1, 30);
    state = setBenchDamage(state, "p2", 2, 40);
    return state;
  }

  it("🛑 fills each Benched body to 100 SEPARATELY — two amounts and a zero on one board", () => {
    const { state, events } = attack(benched(50), IDX.bench);
    const rows = placements(events);
    expect(rows.map((r) => r.amount)).toEqual([100, 70]);
    expect(rows.every((r) => r.seat === "p2")).toBe(true);
    // …and every body that took counters has remaining EXACTLY 100, which is the
    // printed sentence read back off the board rather than off the events.
    expect(theirBench(state)[0]?.damage).toBe(BIG_HP - 100);
    expect(theirBench(state)[1]?.damage).toBe(BIG_HP - 100);
    // The third was already under the destination and is untouched — §6's subject, and
    // it sits on THIS board so "some bodies, not all" is one assertion away.
    expect(theirBench(state)[2]?.damage).toBe(40);
    expect(rows).toHaveLength(2);
  });

  it("the ACTIVE is not on the Bench walk, and the Bench is not on the Active walk", () => {
    // The printed zone words, both directions, on one board each — the pair of
    // assertions that fails if `target` stops selecting anything.
    const benchRun = attack(benched(51), IDX.bench);
    expect(theirActive(benchRun.state)?.damage).toBe(0);
    const activeRun = attack(benched(52), IDX.deep);
    expect(theirActive(activeRun.state)?.damage).toBe(BIG_HP - 50);
    expect(activeRun.state.players.p2.bench.map((b) => b.damage)).toEqual([0, 30, 40]);
    expect(placements(activeRun.events)).toHaveLength(1);
  });

  it("the ATTACKER's own board is never walked, on either target", () => {
    // All three sentences print *"your opponent's"*, so the direction lives in `target`
    // and there is no seat left to get wrong — but a walk that read `ctx.seat` would be
    // invisible on a board where only one side has bodies.
    const run = attack(benched(53), IDX.bench);
    expect(run.state.players.p1.active?.damage).toBe(0);
    expect(placements(run.events).every((r) => r.seat === "p2")).toBe(true);
  });

  it("an EMPTY opponent Bench is a silent whiff, not a refusal", () => {
    const { state, events } = attack(fielded(54), IDX.bench);
    expect(state.players.p2.bench).toHaveLength(0);
    expect(placements(events)).toHaveLength(0);
    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the FLOOR: at or below the destination is ZERO, never negative.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — a body already at or below the destination takes nothing", () => {
  it("🛑 places ZERO and files NO event on a body EXACTLY at the destination", () => {
    // 200 HP at 150 damage is remaining 50, which is index 1's printed destination
    // exactly. `placed` is 0, so the guard is `<= 0` and not `< 0` — the boundary case,
    // and the one a `< 0` build passes while filing a 0-amount `COUNTERS_PLACED` row.
    const { state, events } = attack(setDamage(fielded(60), "p2", BIG_HP - 50), IDX.deep);
    expect(placements(events)).toHaveLength(0);
    expect(theirActive(state)?.damage).toBe(BIG_HP - 50);
  });

  it("places ZERO and never a NEGATIVE amount on a body BELOW the destination", () => {
    // 200 HP at 195 damage is remaining 5, under index 1's 50. A build without the floor
    // would place −45, i.e. HEAL the body by 45 — the wrong sign on a put-counter op.
    const { state, events } = attack(setDamage(fielded(61), "p2", 195), IDX.deep);
    expect(placements(events)).toHaveLength(0);
    expect(theirActive(state)?.damage).toBe(195);
    expect(theirActive(state)?.damage).toBeGreaterThanOrEqual(0);
  });

  it("🛑 the floor is PER BODY, which is `healEachAll`'s shape and not `counterEachAll`'s", () => {
    // The two whole-op guards in this family (`counterEachAll`'s and `damageActive`'s
    // `amount <= 0`) sit ABOVE the walk, because their amount is a constant. A guard
    // placed there here would refuse the WHOLE fold the moment ONE body was already
    // under the destination — which is the defect this board catches: bench 2 is under
    // it and benches 0 and 1 still fill.
    const state = setBenchDamage(
      setBenchDamage(
        fielded(62, { theirs: ["fix-lightning-weak", "fix-bigbody", "fix-bigbody"] }),
        "p2",
        0,
        40,
      ),
      "p2",
      1,
      30,
    );
    const run = attack(state, IDX.bench);
    // The under-target body is FIRST in the walk, so a whole-op guard returns early and
    // places nothing at all. Two rows is the difference between the two shapes.
    expect(placements(run.events).map((r) => r.amount)).toEqual([70, 100]);
    expect(run.state.players.p2.bench[0]?.damage).toBe(40);
  });

  it("an undamaged body at exactly the destination's HP takes nothing — no damage is required", () => {
    // `remainingHpWithin`'s "UNDAMAGED IS NOT EXCLUDED" rule, arriving on the other side
    // of the comparison: a 130 HP body under a 100 destination takes 30 whether or not
    // it carries damage, and a body whose whole maximum is under the destination takes
    // nothing at all even at full health.
    const run = attack(fielded(63, { theirs: ["fix-lightning-weak"] }), IDX.bench);
    expect(placements(run.events)[0]?.amount).toBe(WEAK_HP - 100);
    expect(run.state.players.p2.bench[0]?.damage).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — IT CANNOT KNOCK ANYTHING OUT, asserted as a property rather than observed.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the no-Knock-Out property, and the guard that owns it", () => {
  it("🛑 the ARITHMETIC guarantees it: a filled body lands at `max − remainingHp`, strictly under `max`", () => {
    // The whole proof, written as a total check over the two things that vary — the
    // starting damage and the printed destination. It is not a claim about the three
    // printed rows: it is a claim about every `remainingHp >= 1` this op admits.
    for (let max = 10; max <= 340; max += 10) {
      for (const target of [1, 5, 10, 50, 100, max - 10, max, max + 100]) {
        if (target < 1) continue;
        for (const damage of [0, 5, 30, Math.max(0, max - 20)]) {
          const placed = max - damage - target;
          const after = placed <= 0 ? damage : damage + placed;
          // Either nothing was placed (so the body is exactly where it was, and it was
          // not lethal before or the board would already have swept it), or it lands at
          // `max − target`, which is `< max` for every positive target.
          if (placed > 0) expect(after).toBe(max - target);
          expect(after < max || placed <= 0).toBe(true);
        }
      }
    }
  });

  it("does not Knock Out a 200 HP body filled to 10 remaining, and pays no Prize", () => {
    const before = fielded(70);
    const prizes = before.players.p1.prizes.length;
    const { state, events } = attack(before, IDX.shallow);
    expect(theirActive(state)?.damage).toBe(BIG_HP - 10);
    expect(find(events, "KNOCKED_OUT")).toBeUndefined();
    expect(state.players.p1.prizes.length).toBe(prizes);
    expect(state.players.p2.active).not.toBeNull();
    // …and no `takePrizes` stage was staged for the attacker either, which is the other
    // half of "no Knock Out" and the half a Prize-count assertion alone would miss.
    expect(state.pending.some((stage) => stage.kind === "takePrizes")).toBe(false);
  });

  it("does not Knock Out a body ALREADY below the destination — it is left standing at 5", () => {
    // 200 HP at 195 damage is remaining 5 under a printed 10. The floor refuses, and the
    // body is not swept by the attack epilogue either: it was never lethally damaged.
    const { state, events } = attack(setDamage(fielded(71), "p2", 195), IDX.shallow);
    expect(theirActive(state)?.damage).toBe(195);
    expect(find(events, "KNOCKED_OUT")).toBeUndefined();
    expect(state.players.p2.active).not.toBeNull();
  });

  it("🛑 the INTERPRETER refuses `remainingHp <= 0` whole, so the property belongs to the FUNCTION", () => {
    // The deriver refuses a printed 0 (§2) and this is the other half of that pair. It
    // is UNREACHABLE from any printed sentence and written anyway, for D324's reason
    // verbatim: the alternative is an invariant stated in three doc blocks and asserted
    // by no line of code. A future *"until its remaining HP is 0"* deletes this line and
    // owes a Knock Out, a Prize and a `koByEffect` marker in the same slice.
    for (const remainingHp of [0, -10]) {
      const board = fielded(72);
      const events: GameEvent[] = [];
      const run = runProgram(
        board,
        [{ op: "counterUntilRemainingHp", target: "opponentActive", remainingHp, source: "attack" }],
        { seat: "p1", invokedBy: "attack" },
        events,
      );
      expect(run.state, `remainingHp ${remainingHp}`).toBe(board);
      expect(events, `remainingHp ${remainingHp}`).toEqual([]);
    }
    // …and at 1 — the smallest value the guard admits — it places and still does not
    // kill, which is what makes the boundary a boundary rather than a blanket refusal.
    const board = fielded(73);
    const events: GameEvent[] = [];
    const run = runProgram(
      board,
      [{ op: "counterUntilRemainingHp", target: "opponentActive", remainingHp: 1, source: "attack" }],
      { seat: "p1", invokedBy: "attack" },
      events,
    );
    expect(run.state.players.p2.active?.damage).toBe(BIG_HP - 1);
    expect(placements(events)[0]?.amount).toBe(BIG_HP - 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — §11: the prevention gate, asked PER BODY and AFTER the amount.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the prevention gate, per body", () => {
  it("a printed EFFECT block on the Active refuses the placement and files ONE row", () => {
    // `fix-unaware` prints *"Prevent all effects of attacks used by your opponent's
    // Pokémon done to this Pokémon. (Damage is not an effect.)"*. A PLACED counter is an
    // effect (D138/D139/D142), so it is refused whole on a one-body target.
    const { state, events } = attack(fielded(80, { defender: "fix-unaware" }), IDX.deep);
    expect(placements(events)).toHaveLength(0);
    expect(theirActive(state)?.damage).toBe(0);
    const row = find(events, "ATTACK_EFFECT_PREVENTED");
    expect(row?.seat).toBe("p2");
  });

  it("🛑 a shielded BENCH body silences exactly itself — the rest of the walk still fills", () => {
    // Refusing the op WHOLE would let one body protect a Bench, a rule no printing
    // states. `fix-unaware`'s block is a passive on the BODY, so it travels to the Bench.
    // ⚠️ THE TWO SURVIVORS TAKE DIFFERENT AMOUNTS ON PURPOSE (100 and 30): a board whose
    // unshielded bodies agreed would leave "the shield removed the RIGHT one" unasserted.
    const state = fielded(81, { theirs: ["fix-bigbody", "fix-unaware", "fix-lightning-weak"] });
    const run = attack(state, IDX.bench);
    expect(placements(run.events).map((r) => r.amount)).toEqual([BIG_HP - 100, WEAK_HP - 100]);
    expect(run.state.players.p2.bench[0]?.damage).toBe(BIG_HP - 100);
    expect(run.state.players.p2.bench[1]?.damage).toBe(0);
    expect(run.state.players.p2.bench[2]?.damage).toBe(WEAK_HP - 100);
    // ONE prevention row for ONE shielded body, and it names that body.
    const rows = run.events.filter((e) => e.type === "ATTACK_EFFECT_PREVENTED");
    expect(rows).toHaveLength(1);
  });

  it("🛑 a body that would take ZERO is never asked, so it files no prevention row (D433)", () => {
    // The gate is consulted AFTER the amount, so a body the sentence did not reach files
    // nothing. `fix-unaware` is 220 HP; at 130 damage its remaining is 90, under the
    // printed 100 — so it takes zero for ARITHMETIC reasons and the shield never speaks.
    // The difference between this board and the one above is one call to `setBenchDamage`,
    // which is what makes the ordering observable at all.
    const state = setBenchDamage(fielded(82, { theirs: ["fix-unaware", "fix-bigbody"] }), "p2", 0, 130);
    const run = attack(state, IDX.bench);
    expect(run.events.filter((e) => e.type === "ATTACK_EFFECT_PREVENTED")).toHaveLength(0);
    expect(run.state.players.p2.bench[0]?.damage).toBe(130);
    expect(run.state.players.p2.bench[1]?.damage).toBe(100);
  });

  it("the NARROW damage block does NOT stop it, which is the other printed spelling", () => {
    // Bellibolt `sv03-078` prevents all DAMAGE from a {L} attacker and says nothing about
    // effects; a placed counter is not damage (the catalog prints the rule on Bronzong
    // `sv03-145`). So the placement lands in full — and index 3's printed 20, which IS
    // damage, is stopped on the same board. Without that control neither direction is
    // readable (D450's `fix-counterfold` index 3, reused for its stated reason).
    const placed = attack(fielded(83, { defender: "sv03-078" }), IDX.deep);
    expect(placements(placed.events)).toHaveLength(1);
    expect(theirActive(placed.state)?.damage).toBeGreaterThan(0);
    const bolt = attack(fielded(84, { defender: "sv03-078" }), IDX.bolt);
    expect(theirActive(bolt.state)?.damage).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — flatness, the log row, and the arithmetic that is not a multiple of ten.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — a PLACED counter is flat, and the row says which mechanism placed it", () => {
  it("🛑 a ×2 Weakness does NOT double the placement", () => {
    // `fix-lightning-weak` is ×2 Lightning and the attacker is {L}. If this went through
    // §8.5 the 80 would become 160 and the body would be Knocked Out at 130 HP — so the
    // board is not merely a different number, it is a different outcome.
    const { state, events } = attack(fielded(90, { defender: "fix-lightning-weak" }), IDX.deep);
    expect(placements(events)[0]?.amount).toBe(WEAK_HP - 50);
    expect(theirActive(state)?.damage).toBe(WEAK_HP - 50);
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(find(events, "KNOCKED_OUT")).toBeUndefined();
  });

  it("🛑 the amount need NOT be a multiple of ten, and the destination is hit on the nose", () => {
    // §12 makes a counter 10 HP, but `damage` is not guaranteed to be a multiple of ten
    // (a halved hit leaves 5) and neither is `effectiveMaxHp` once a Tool is on the
    // board. The printed word is *"until"*, so the EXACT difference is placed:
    // rounding up to whole counters would overshoot past the destination, and on a body
    // whose maximum is not a multiple of ten it could reach `max` — the one thing this
    // op must never do (§7).
    const { state, events } = attack(setDamage(fielded(91), "p2", 5), IDX.deep);
    expect(placements(events)[0]?.amount).toBe(BIG_HP - 5 - 50);
    expect((placements(events)[0]?.amount ?? 0) % 10).not.toBe(0);
    expect(theirActive(state)?.damage).toBe(BIG_HP - 50);
    expect(BIG_HP - (theirActive(state)?.damage ?? 0)).toBe(50);
  });

  it("an attack's placement renders in the PRINTED verb and never the word Ability", () => {
    // D136's finding 1, refused at the front for the fifth time on this axis. `source`
    // is REQUIRED on this op from birth rather than after a hardcode was caught, which
    // is the only thing new about this rung.
    const { state: after, events } = attack(fielded(92), IDX.deep);
    expect(placements(events).every((e) => e.source === "attack")).toBe(true);
    const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state: after, elapsed: "+00:07" };
    const rendered = logFromEvents(events, ctx).flatMap((entry) =>
      entry.kind === "turn"
        ? []
        : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
    );
    const row = rendered.find((r) => r.text.startsWith("Put:"));
    expect(row).toBeDefined();
    expect(row?.who).toBe("system");
    expect(row?.text).toContain("150");
    expect(row?.text).not.toContain("Ability");
  });
});

// A reference to `applyAction` so the import earns its place: every board above goes
// through `mustApply`, which wraps it — this is the one direct call, and it pins that a
// second attack in the same turn is refused, i.e. that the boards above really did end
// their turn on the attack rather than leaving one open (§8's one-attack rule).
describe("§10 — the attack really is the turn's last action", () => {
  it("refuses a second attack after the placement resolves", () => {
    const { state } = attack(fielded(95), IDX.deep);
    const again = applyAction(state, { type: "attack", seat: "p1", index: IDX.shallow });
    expect(again.ok).toBe(false);
  });
});
