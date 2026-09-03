import { describe, expect, it } from "vitest";
import { deriveAttackEffect, programFor } from "./index";
import type { EffectOp, GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  COUNTER_PUT_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
} from "./testFixtures";

// 0.87.0 → 0.88.0 — the PUT on the defender (D139). "Put {N} damage counters on
// your opponent's Active Pokémon." — 2 printings / 2 distinct clauses on ONE
// anchored regex with ONE `(\d+)` capture and ONE deriver arm.
//
// D132's INVENTORY RULE FOR THE FOURTH TIME: `damageActive` has shipped since 0.x
// behind Trevenant sv03-012's between-turns "Forest Miasma", so the ACTION already
// existed and only the READER was missing. That is why there is no new op, no new
// park and no new mechanism in this slice.
//
// WHAT THE RESUME POINT CLAIMED, AND WHAT WAS TRUE (checked before anything was
// built — D135's lesson, and this file's first two describes are the check):
//   • The card ids, attack NAMES, amounts and Energy costs — ALL FOUR HELD, and
//     they are pinned against the fixture bytes below. Ghost Eye is {P}{C} for 7
//     and Pour Tea is {P} for 5, and Pour Tea is at INDEX 1.
//   • "Neither printing carries a printed `damage` field" — TRUE of both.
//   • "`damageActive`'s field is HP, and {N} counters is `amount: N * 10`" —
//     TRUE, and the conversion is pinned here so a factor of ten in EITHER
//     direction fails.
//   • "…with NO INTERPRETER DIFF" — ⚠️ FALSE, and that is the slice. See below.
//
// WHAT IS ACTUALLY NEW HERE, and why this is not a copy of counterMove.test.ts:
//   • THE PROVENANCE MOVED EVEN THOUGH THE ACTION DID NOT. `damageActive`
//     hardcoded `COUNTERS_PLACED` source `"ability"`, which was true while it had
//     one producer and becomes a LIE on an attack: that event's `seat` owns the
//     DAMAGED Pokémon (the attacker's OPPONENT), rows render after their seat's
//     name, and the `"ability"` arm prints the literal word Ability. D136's
//     finding 1; D138 refused it once for the counter MOVE and wrote down that any
//     future producer on the opponent's board owes the same question. This is that
//     producer. So the op grew a `source` FIELD — D131's widen-don't-add rule
//     applied and PASSING, the exact contrast with D138 where it FAILED.
//   • THE × 10 IS THE WHOLE ARITHMETIC RISK. The printed number is COUNTERS and
//     the op's field is HP, so every derivation case below asserts the HP and
//     explicitly refuses both the un-multiplied and the twice-multiplied value.
//   • TWO PRINTINGS AT TWO DIFFERENT COUNTS ON TWO DIFFERENT CARDS, which is what
//     makes that a conversion rather than a constant.
//   • NO PARK ANYWHERE. "your opponent's Active Pokémon" is not a choice, so the
//     whole declaration — placement, Knock Out, prize — lands in ONE event batch.
//
// Seed-free: neither sentence takes a coin, pinned by an unchanged `rngState`
// across a whole declaration.

/** The pool's TWO clauses of this shape, verbatim, with the HP each derives to.
    Censused against the local D1 (2026-08-02) over the WHOLE effect string (978
    cards / 6 sets): every attack effect containing "damage counter" is 56 printings / 31
    distinct clauses; the ones whose ACTION is putting counters are 24 / 15; the
    ones aimed at "your opponent's Active Pokémon" are 4 / 4, and these are two of
    them. The other two read their amount off the TARGET (see NEAR_MISSES). */
const CLAUSES = [
  { id: "sv02-097", card: "Mimikyu", attack: "Ghost Eye", index: 0, counters: 7, hp: 70 },
  { id: "sv03-098", card: "Polteageist", attack: "Pour Tea", index: 1, counters: 5, hp: 50 },
] as const;

function clauseText(counters: number): string {
  return `Put ${counters} damage counters on your opponent's Active Pokémon.`;
}

/** The op, with the printed count already converted to HP and the provenance the
    log row may honestly print. Identical in every other respect to the one
    Trevenant's registry row authors — which is asserted, not assumed. */
function putOp(hp: number): EffectOp {
  return { op: "damageActive", amount: hp, source: "attack" };
}

/** The real catalog rows this anchor must refuse, verbatim off the local D1, and
    every one of them is still unmapped after this slice:
      • Alolan Raticate swsh10.5-042 "Super Fang" and Claydol sv03-095 "Kaboom
        Doll" — the OTHER two printings aimed at "your opponent's Active Pokémon",
        and the whole reason this regex captures `(\d+)` instead of making the
        count optional: their amount is read off the TARGET's remaining HP, which
        no capture can express.
      • Ninetales sv03-029/-199 "Nine-Tailed Dance" — a bare count, but an
        any-zone target and a second sentence riding it.
      • ✅ **SPENT AT D348** — Drifblim sv01-090 "Curse Spreading" was listed here
        as "a distribution across the whole board ('in any way you like')". It is
        MAPPED: arm 23a reads it, and the reading is N repeated `damageChosen` ops,
        so the distribution this line priced was never a prompt kind at all.
        Recorded as spent rather than re-aimed (D346). The array's own witness WAS
        re-pointed, below.
      • Maushold sv02-168/-226 and Yveltal sv06.5-035 — "each of your opponent's
        Pokémon", one of them scaled by a board count and one filtered.
      • Vespiquen ex sv03-096/-212 "Phantom Queen" — "each of your opponent's
        Benched Pokémon **that has any damage counters on it**", a per-target
        FILTER nothing in the vocabulary expresses. ⚠️ RE-POINTED AT D140 from
        Ting-Lu ex sv02-127 "Land Scoop", which this list used to hold and which
        D140 MAPPED (see the dedicated case below).
      • Munkidori sv06.5-072 "Adrena-Brain" and Feraligatr `svp-089`/`sv05-041`
        "Bite Off" — ABILITIES whose printed "put … damage counters" is lowercase
        and mid-sentence, which is exactly what the capitalised "Put" plus `^…$`
        refuses without an /i flag. ⚠️ **RE-POINTED AT D345 from Dusknoir
        `sv06.5-020` "Cursed Blast", which this list used to hold and which D345
        MAPPED** (a registry ABILITY row, `CURSED_BLAST_13` — the anchor's refusal
        is unchanged, and the assertion below is still `toBeNull`). Feraligatr is
        the replacement because it is the same defect at a DIFFERENT target noun:
        *"you may put 5 damage counters on **this Pokémon**"*, 2 Standard-legal
        printings, lowercase, mid-sentence, and unmapped (`programFor` undefined on
        both ids — driven below, not asserted in prose).

    STANDING NOTE: when a later slice maps one of these, RE-POINT the entry at
    another still-unmapped clause — never delete it. The claim is that an unread
    sentence stays LOUD, and that claim needs a live witness to be about. */
const NEAR_MISSES = [
  // ⚠️ RE-POINTED AT D451. This slot held *"Put damage counters on your opponent's
  // Active Pokémon until its remaining HP is 10."* — the sentence this file's own doc
  // block called the whole reason the regex captures `(\d+)` instead of making the
  // count optional. D451 MAPPED it (arm 23g over the new op
  // `counterUntilRemainingHp`), so the witness MOVED rather than being deleted, and
  // the claim about it is now an INEQUALITY of derived programs below the loop.
  // 🆕🆕 **RE-POINTED AGAIN AT D456, AND THE REASON THE OLD OCCUPANT GAVE IS HALF
  // FALSE.** The slot held *"…put damage counters on the Attacking Pokémon **equal to the
  // damage done to this Pokémon**."* (corpus line 180, 2 legal printings) with the note
  // *"that amount is a HISTORY of the opponent's turn where D451's is a fact about the
  // body standing there, and it rides a durated window this anchor's `^Put` cannot
  // open."* The SECOND half is exactly right and is why the sentence never belonged to
  // this anchor. The FIRST half is not: at the §9 recoil site the figure is a LOCAL
  // named `dealt`, two lines above the read, so nothing is recorded and nothing is
  // carried. D456 claimed it over `installRecoil` with a widened
  // `amount: number | "damageTaken"`, and the witness MOVED rather than being deleted.
  //
  // The replacement is corpus line 433, 1 legal printing and still unread — this
  // anchor's verb, this anchor's noun, this anchor's count position, and refused twice:
  // the bound sits BETWEEN the verb and the count (*"Put **up to** 9 damage counters"*,
  // which `^Put (\d+) damage counters` structurally cannot admit) and the second sentence
  // counts what the first placed. It is also the row D449's published `/put \d* ?damage
  // counters/i` family pattern cannot see, so keeping it here is the one place in this
  // file that hole is visible.
  "Put up to 9 damage counters on this Pokémon. This attack does 20 damage for each damage counter you placed in this way.",
  // ⚠️ **STILL NULL AND STILL A CATALOG ROW** — the HP target at 10 with a consequent
  // riding it. D451 built the bare sentence and this compound is a STRICT PREFIX
  // extension of it, so it is the near miss the two new anchors' `$` exists for, and
  // it stays in this list rather than moving out with its own prefix.
  "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10. If you placed any damage counters in this way, this attack also does 120 damage to this Pokémon.",
  // ⚠️ RE-POINTED AT D143 — this slot held Ninetales sv03-029/-199's "Nine-Tailed
  // Dance", which D143 mapped; the witness moved rather than being deleted. Its
  // replacement is Kingambit sv03-150 "Zamashira": the same opening noun phrase
  // read as a THRESHOLD rather than an action, so it is refused by the VERB.
  "If your opponent's Active Pokémon has 4 or more damage counters on it, that Pokémon is Knocked Out.",
  // ⚠️ RE-POINTED AT D348. This slot held "Put 8 damage counters on your opponent's
  // Pokémon in any way you like." (sv01-090/sv04.5-156) — the counter SPREAD, which
  // D348 MAPPED as arm 23a, so the witness moved rather than being deleted (the
  // standing note above). The replacement is Uxie sv08-078 "Painful Memories", 1
  // legal: a zone that INCLUDES this anchor's Active target, the same verb and the
  // same printed count, refused on the determiner alone — "each of your opponent's
  // Pokémon" is a fold over the whole board where this anchor names ONE body. It is
  // the closest an unread row gets to this sentence without being it.
  // ⚠️ RE-POINTED AT D450 — this slot held the bare opponent-side fold (corpus line 415), which D450 MAPPED (arms 23d/23e/23f
  // over `counterEachAll`), so the witness MOVED rather than being deleted (the standing
  // note above). The replacement is the SCALED TWIN, **3 legal printings** and the largest unread row left in the placement family: this anchor's verb and count at an any-zone PICK, refused on a count payload no rider carries and on a tail with no reader. The sentence it replaced is not gone from this
  // file: the claim about it is now an INEQUALITY of derived programs below the loop,
  // which is D418's second half and strictly stronger than the `toBeNull` it had.
  "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.",
  "Put 1 damage counter on each of your opponent's Pokémon for each of your Maushold in play.",
  // ⚠️ RE-POINTED AT D450 — this slot held the windowed opponent-side fold (corpus line 414), which D450 MAPPED (arms 23d/23e/23f
  // over `counterEachAll`), so the witness MOVED rather than being deleted (the standing
  // note above). The replacement is the CONFUSION SUBSTITUTION, 1 legal printing and still unread, refused on the VERB rather than on the target. The sentence it replaced is not gone from this
  // file: the claim about it is now an INEQUALITY of derived programs below the loop,
  // which is D418's second half and strictly stronger than the `toBeNull` it had.
  "Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that Pokémon for this Special Condition.",
  "Put 3 damage counters on each of your opponent's Benched Pokémon that has any damage counters on it.",
  "Once during your turn, if this Pokémon has any {D} Energy attached, you may move up to 3 damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon.",
  // ⚠️ RE-POINTED AT D345 — this slot held Dusclops/Dusknoir's "Cursed Blast",
  // which D345 MAPPED as a registry ABILITY; the witness moved rather than being
  // deleted, exactly as D143's did. Its replacement is Feraligatr `svp-089`/
  // `sv05-041` "Bite Off": the same lowercase mid-sentence "put … damage counters"
  // at a different target noun ("this Pokémon"), 2 Standard-legal printings, still
  // unmapped. 🛑 **THE STANDING NOTE HAS NOW FIRED TWICE IN TWO HUNDRED SLICES AND
  // BOTH TIMES THE LIST SURVIVED INTACT**, which is the whole argument for it: a
  // deleted witness leaves a claim with nothing to be about.
  "Once during your turn, you may put 5 damage counters on this Pokémon. If you do, during this turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
] as const;

/** 🆕 D345 — the re-pointed witness's ids, so the claim "still unmapped" is DRIVEN
    rather than written down. The entry above it (Dusknoir) had to move precisely
    because this assertion would have gone red on it. */
const REPOINTED_WITNESS_IDS = ["svp-089", "sv05-041"] as const;

/** The SIBLING anchor, one word apart at the front — Dedenne ex sv02-093 "Tail
    Swap", the counter MOVE (D138). Deliberately NOT in `NEAR_MISSES`: it shares
    this sentence's entire destination noun phrase but it is MAPPED, so the claim
    about it is not `toBeNull` — it is that each anchor keeps deriving its OWN op,
    in both directions. That is a strictly stronger statement than a null, and it
    is the one that catches an arm ordering bug. */
const COUNTER_MOVE_CLAUSE =
  "Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.";

/** U+2019, spelled as an ESCAPE rather than typed — the curly apostrophe a
    punctuation-normalising re-ingest would produce. D137's fold is a property of
    the READER; this regex carries `['’]` in its own source, and the assertion is
    EQUALITY with the straight form rather than merely "non-null". */
const RSQUO = "’";

/** U+00A0. Byte-different from an ASCII space and INVISIBLE in a diff, which is
    exactly why the case names it instead of carrying it. */
const NBSP = " ";

/** Ghost Eye is the whole slice from a BASIC body, so it drives every board.
    Named rather than inlined so a re-ingest that reordered the attacks fails on
    the fixture guards rather than silently moving the cases onto Safeguard. */
const GHOST_EYE_INDEX = 0;
const GHOST_EYE_HP = 70;
/** Pour Tea is at INDEX 1 — index 0 is "Antique Collecting", the control. */
const ANTIQUE_COLLECTING_INDEX = 0;
const POUR_TEA_INDEX = 1;
const POUR_TEA_HP = 50;

/** The defender's damage BEFORE the placement, on the boards that measure an
    addition rather than a bare hit — so the assertion is `before + placed` and not
    just `placed`. Not a multiple of 70 or 50, so no sum is reachable two ways. */
const DEFENDER_HURT = 40;

/** fix-titan is 340 HP: 280 + GHOST_EYE_HP is exactly 350, so the placement is
    what tips it over. Written against the printed HP, not as a magic number. */
const TITAN_HP = 340;
const DEFENDER_NEARLY_DEAD = 280;

/** Both flat-placement bodies are 200 HP, which survives every reading a wrong
    build could produce (140 doubled, 40 resisted, 70 flat) — so those two cases
    measure the AMOUNT and never a promotion. */
const FLAT_DEFENDER_HP = 200;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** ONE BOARD, NO SWEEP. Nothing in this slice takes a coin, so there is no seed to
    vary and a single deterministic board is the whole account (pinned by an
    unchanged `rngState` below).

    Setup then open P1's turn 2 (P2 went first and passed), so the attack step is
    legal (§4). Both Active spots are pinned to fix-titan (340 HP, no Weakness, no
    Resistance, NO ATTACKS) by surgery, and BOTH BENCHES ARE EMPTIED — D133's trap:
    `setActiveFromDeck` DISPLACES the Active it replaces onto the Bench, so every
    surgery leaves a stranger behind. This suite's claims are about the DEFENDER
    rather than about a candidate list, but a stray benched body would still change
    what the epilogue promotes into after a Knock Out. */
function board(): GameState {
  let state = driveSetup(7, { p1: COUNTER_PUT_DECK, p2: COUNTER_PUT_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-titan");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return clearBench(clearBench(state, "p1"), "p2");
}

/** Field Mimikyu as `seat`'s Active with two {P} attached — Ghost Eye's cost is
    {P}{C} and a Psychic Energy pays the {C} as any Energy does. It is a Basic, so
    the surgery is a convenience; the bench clear after it is not. */
function mimikyuActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(
    clearBench(setActiveFromDeck(state, seat, "sv02-097"), seat),
    seat,
    "fix-psychic-energy",
    2,
  );
}

/** Field Polteageist as `seat`'s Active with one {P} attached. A STAGE 1 put
    straight into the Active Spot by surgery rather than evolved — the evolution
    chain is not this slice's claim, and Sinistea is not in the deck. */
function polteageistActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(
    clearBench(setActiveFromDeck(state, seat, "sv03-098"), seat),
    seat,
    "fix-psychic-energy",
    1,
  );
}

/** Declare `index` on `seat`, freezing the prior state first — the purity check
    every neighbouring suite runs, hoisted here because this file drives a dozen. */
function declare(
  state: GameState,
  index: number,
  seat: Seat = "p1",
): { state: GameState; events: GameEvent[] } {
  deepFreeze(state);
  return mustApply(state, { type: "attack", seat, index });
}

describe("the anchor — 2 printings, 2 clauses, one regex with one (\\d+) capture", () => {
  it("derives BOTH printed clauses, and the amount is HP rather than counters", () => {
    for (const { counters, hp } of CLAUSES) {
      expect(deriveAttackEffect(clauseText(counters))).toEqual([putOp(hp)]);
    }
    // ONE op, three keys, and the shape claim: the count lands in a FIELD (D131),
    // not in a row of a lookup table, because a bare integer has no CLOSED
    // vocabulary to be rejected against and D120's template rule needs one.
    const ops = deriveAttackEffect(clauseText(7));
    expect(ops).toHaveLength(1);
    expect(Object.keys(ops?.[0] as object).sort()).toEqual(["amount", "op", "source"]);
    // THE CENSUS, ASSERTED AS A SHAPE: 2 printings, 2 DISTINCT clauses, 2 ids on 2
    // different cards — the numbers a re-census has to reproduce, and the reason
    // D121's warrant is met without borrowing a family argument.
    expect(CLAUSES).toHaveLength(2);
    expect(new Set(CLAUSES.map((c) => c.id)).size).toBe(2);
    expect(new Set(CLAUSES.map((c) => c.counters)).size).toBe(2);
  });

  it("⚠️ CONVERTS counters → HP, and fails at a factor of ten in EITHER direction", () => {
    // THE ONE PLACE THIS SLICE CAN BE ARITHMETICALLY WRONG. `damageActive.amount`
    // is HP (the interpreter adds it straight onto `damage`), the printed number is
    // COUNTERS, and §12 fixes one counter at 10 HP. A build that forgot the × 10
    // places 7 HP; one that applied it twice places 700. Both are asserted against
    // explicitly, because `toEqual` on the right answer alone would still pass a
    // suite whose expected value was copied from the bug.
    for (const { counters, hp } of CLAUSES) {
      const derived = deriveAttackEffect(clauseText(counters));
      expect(derived).toEqual([{ op: "damageActive", amount: counters * 10, source: "attack" }]);
      expect(derived).not.toEqual([{ op: "damageActive", amount: counters, source: "attack" }]);
      expect(derived).not.toEqual([
        { op: "damageActive", amount: counters * 100, source: "attack" },
      ]);
      expect(hp).toBe(counters * 10);
    }
    // AND IT IS A CONVERSION, NOT A CONSTANT — two different printed counts give
    // two different amounts, in the same ratio. A build that hardcoded either
    // printing's number passes one of these lines and fails the other.
    expect(deriveAttackEffect(clauseText(7))).not.toEqual(deriveAttackEffect(clauseText(5)));
    expect(deriveAttackEffect(clauseText(1))).toEqual([putOp(10)]);
    expect(deriveAttackEffect(clauseText(13))).toEqual([putOp(130)]);
  });

  it("is the SAME op the registry authors for Trevenant, differing only in `source`", () => {
    // D132's inventory rule, stated as an equality. The action existed before the
    // reader did: Trevenant sv03-012 "Forest Miasma" has produced this op from a
    // between-turns trigger since 0.x, and its row does the identical counters → HP
    // conversion by hand (1 printed counter → `amount: 10`).
    const authored = programFor("sv03-012")?.triggered?.[0];
    expect(authored?.name).toBe("Forest Miasma");
    expect(authored?.program).toEqual([{ op: "damageActive", amount: 10, source: "ability" }]);
    // …and the derived op is that op with ONE field flipped. Written as a rebuild of
    // the authored row rather than as a literal, so the claim is "these differ in
    // exactly one key" rather than "both happen to look like this".
    const authoredOp = authored?.program?.[0] as { op: string; amount: number; source: string };
    expect(deriveAttackEffect(clauseText(1))).toEqual([{ ...authoredOp, source: "attack" }]);
    // THE PROVENANCE IS THE WHOLE DIFFERENCE, and it is a FIELD rather than a second
    // op member because everything downstream of it is byte-identical (D131's
    // widen-don't-add rule applied and PASSING — the contrast with D138, where the
    // same rule was applied and failed).
    expect(Object.keys(authoredOp).sort()).toEqual(
      Object.keys(deriveAttackEffect(clauseText(1))?.[0] as object).sort(),
    );
  });

  it("refuses the NINE real catalog rows that share its words", () => {
    for (const text of NEAR_MISSES) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // 🆕🆕🆕 **D451 — THIS PARAGRAPH SAID "no capture expresses it" AND HALF OF THAT
    // WAS A NON-SEQUITUR.** It used to read: the other two printings aimed at the SAME
    // target have an amount read off the TARGET, "a mechanism no capture expresses", so
    // a reader that made the count optional would map them to a placement of nothing at
    // all. The AMOUNT is indeed unprintable; the DESTINATION is printed and captures
    // like any other, and D451 built both rows on exactly that. What survives whole is
    // the operational half: **this anchor's `(\d+)` must stay REQUIRED**, because an
    // optional count would let it claim a sentence whose number means remaining HP
    // rather than counters — a 10 read as a placement of 100. Driven below, both ways.
    expect(deriveAttackEffect(NEAR_MISSES[1])).toBeNull();
    expect(deriveAttackEffect(NEAR_MISSES[0])).toBeNull();
    // The two ABILITY printings are refused by the CAPITAL "Put" plus `^…$` alone,
    // with no /i anywhere in this file — both spell the action lowercase and mid
    // sentence, which is the standing argument for the flag's absence.
    expect(deriveAttackEffect(NEAR_MISSES[7])).toBeNull();
    expect(deriveAttackEffect(NEAR_MISSES[8])).toBeNull();
    // 🆕🆕🆕 **D450 — THE TWO ROWS THAT LEFT THIS LIST, AND THE CLAIM THEY WERE REALLY
    // MAKING.** Corpus lines 415 and 414 were `toBeNull` here until D450 built them as
    // arms 23e and 23f. A `toBeNull` on a sentence the catalog PRINTS is a liability
    // rather than a guard (D449), so both slots were re-pointed above and the claim
    // moved here as an INEQUALITY of derived programs. It still goes RED on the defect
    // the old rungs were about — this anchor names ONE SPOT and both of those FOLD over
    // a board — and it cannot go green by accident when a sibling arm lands.
    for (const fold of [
      "Put 2 damage counters on each of your opponent's Pokémon.",
      "Put 2 damage counters on each of your opponent's Pokémon that has any damage counters on it.",
    ]) {
      expect(deriveAttackEffect(fold), fold).not.toEqual(deriveAttackEffect(clauseText(2)));
      expect(deriveAttackEffect(fold)?.[0]?.op, fold).toBe("counterEachAll");
    }
    expect(deriveAttackEffect(clauseText(2))?.[0]?.op).toBe("damageActive");

    // 🆕🆕🆕 **D451 — THE HP TARGET, AS AN INEQUALITY, AND IT IS THE SHARPEST ONE THIS
    // FILE HAS.** Its noun phrase is byte-identical to this anchor's — *"your
    // opponent's Active Pokémon"* — so nothing but the QUANTITY tells them apart, and
    // an anchor whose count went optional would claim it and place 10 HP where the card
    // means "fill to 10 remaining". Both positives are asserted beside the inequality.
    const HP_TARGET = "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10.";
    expect(deriveAttackEffect(HP_TARGET)).toEqual([
      { op: "counterUntilRemainingHp", target: "opponentActive", remainingHp: 10, source: "attack" },
    ]);
    expect(deriveAttackEffect(HP_TARGET)).not.toEqual(deriveAttackEffect(clauseText(1)));
    // …and the printed 10 is HP, NOT counters: `damageActive` at a printed 10 carries
    // `amount: 100` and the HP target carries `remainingHp: 10`. The two numbers read
    // the same on the page and mean different things, which is the whole §12 hazard.
    expect(deriveAttackEffect("Put 10 damage counters on your opponent's Active Pokémon.")).toEqual([
      { op: "damageActive", amount: 100, source: "attack" },
    ]);

    // 🆕 D345 — AND THE RE-POINTED WITNESS IS STILL UNMAPPED, DRIVEN RATHER THAN
    // WRITTEN DOWN. `NEAR_MISSES[8]` was Dusknoir's "Cursed Blast" until this slice
    // BUILT it (a registry ABILITY row — this anchor's refusal is unaffected, since
    // it reads ATTACK text). The standing note says re-point, never delete; this
    // assertion is what makes the new entry a live claim instead of a sentence
    // about a card somebody already authored.
    for (const id of REPOINTED_WITNESS_IDS) {
      expect(programFor(id), `${id} is the re-pointed witness and has been built`).toBeUndefined();
    }
  });

  it("⚠️ pins how Ting-Lu ex's Bench PUT resolved — the note, then the fix", () => {
    // THIS CASE EXISTS BECAUSE IT CAUGHT A DOC BUG DURING D139, AND IT IS KEPT
    // BECAUSE D140 CLOSED WHAT IT FOUND. The first draft of D139's "found but not
    // fixed" note claimed `placeSnipe` prints "Ability:" on an ATTACK **today**, on
    // the grounds that Ting-Lu ex sv02-127 "Land Scoop" derives to a `damageChosen`.
    // It did not — the sentence was unmapped, and the card's only registry row is
    // the Cursed Land passive. One assertion here disproved the claim before it
    // shipped into three documents.
    //
    // D140 THEN MAPPED THAT SENTENCE, so the two halves of the note swapped truth
    // values at once, and both are pinned here rather than either being deleted.
    // The card STILL has no registry ATTACK row — the `.attack` assertion below is
    // unchanged and is what proves the new derivation is doing the work.
    expect(
      deriveAttackEffect("Put 2 damage counters on 1 of your opponent's Benched Pokémon."),
    ).toEqual([
      { op: "damageChosen", target: "opponentBench", amount: 20, count: 1, source: "attack" },
    ]);
    expect(programFor("sv02-127")).toBeDefined();
    expect(programFor("sv02-127")?.attack).toBeUndefined();
    // AND THE LATENT LABEL IS GONE. `placeSnipe` took the provenance as a PARAMETER
    // at 0.89.0, so the two producers of its counter path say two different things:
    // the three Ability registry rows carry `source: "ability"` and every derived
    // arm carries `"attack"`. Asserted from the registry side here, and swept over
    // the whole fixture pool in counterBenchPut.test.ts.
    expect(programFor("sv02-015")?.abilities?.[0]?.program).toContainEqual(
      expect.objectContaining({ op: "damageChosen", target: "opponentBench", source: "ability" }),
    );
    expect(programFor("sv02-015")?.abilities?.[0]?.program?.[1]).not.toHaveProperty("deals");
  });

  it("stays disjoint from the SIBLING anchor in BOTH directions", () => {
    // Dedenne ex's counter MOVE (D138) shares this sentence's entire destination
    // noun phrase and differs by its FIRST WORD. Both anchors are `^…$`, so no
    // ordering of the deriver's arms can matter — but that is a property worth
    // asserting rather than reasoning about, and the assertion is that each keeps
    // deriving its OWN op rather than that either returns null.
    expect(deriveAttackEffect(COUNTER_MOVE_CLAUSE)).toEqual([{ op: "moveCountersToDefender" }]);
    expect(deriveAttackEffect(COUNTER_MOVE_CLAUSE)).not.toContainEqual(
      expect.objectContaining({ op: "damageActive" }),
    );
    expect(deriveAttackEffect(clauseText(7))).toEqual([putOp(GHOST_EYE_HP)]);
    expect(deriveAttackEffect(clauseText(7))).not.toContainEqual(
      expect.objectContaining({ op: "moveCountersToDefender" }),
    );
    // …and the two sentences really do differ only at the front, which is what makes
    // the disjointness a claim about the FIRST WORD rather than a coincidence of two
    // unrelated strings.
    expect(COUNTER_MOVE_CLAUSE.endsWith("to your opponent's Active Pokémon.")).toBe(true);
    expect(clauseText(7).endsWith("on your opponent's Active Pokémon.")).toBe(true);
  });

  it("refuses the anchor, punctuation, case and token rewrites — but trims outer space", () => {
    for (const text of [
      // NO TRAILING PERIOD — the `$` sits after it.
      "Put 7 damage counters on your opponent's Active Pokémon",
      // "!" for "." — the same one-character difference from the other side.
      "Put 7 damage counters on your opponent's Active Pokémon!",
      // A LOWERCASE first word. Half of what keeps a mid-sentence clause off this
      // path — every Ability printing of this action is lowercase and mid-sentence,
      // Trevenant's included — and the reason no /i flag is on this regex.
      "put 7 damage counters on your opponent's Active Pokémon.",
      // THE SINGULAR NOUN. Deliberately NOT a branch, which is where this differs
      // from D131's mill: the pool prints only the plural on attacks, and its one
      // singular is Trevenant's ABILITY, which already has a registry row.
      "Put 7 damage counter on your opponent's Active Pokémon.",
      // NO COUNT AT ALL — Alolan Raticate's opening, and the reading this anchor
      // must not invent a number for.
      "Put damage counters on your opponent's Active Pokémon.",
      // "up to", a BOUNDED count. One printing in the pool carries it (Annihilape ex
      // sv02-242) and it targets THIS Pokémon; a reader that swallowed the words
      // would place the maximum for a card that prints a choice.
      "Put up to 7 damage counters on your opponent's Active Pokémon.",
      // A NON-INTEGER and a SIGNED count — `\d+` takes neither, and a placement of
      // -7 would HEAL the defender.
      "Put 7.5 damage counters on your opponent's Active Pokémon.",
      "Put -7 damage counters on your opponent's Active Pokémon.",
      // THE TARGET, re-aimed THREE ways here. Every one is a real reading elsewhere in
      // the pool and none of them is this one; the Benched and own-side rewrites are the
      // catastrophic misses, since the op has no target field to be wrong in.
      // 🆕🛑 **D449 — THE FOURTH REWRITE MOVED OUT OF THIS LOOP AND INTO A CASE OF ITS
      // OWN, BECAUSE IT STOPPED BEING NULL.** *"Put 7 damage counters on **1 of** your
      // opponent's Pokémon."* is the bare any-zone spelling, which D449 claimed with
      // `COUNTER_PUT_ON_OPPONENT_ANY` (arm 23b) — a real legal printing at corpus line
      // 413 that a D143 doc block had said was not printed at all. **RE-POINTED, NOT
      // DELETED** (the standing note above), and re-pointed onto the claim the old one
      // was really making: this anchor's target is a SPOT and that one's is a PICK, so
      // the two derive DIFFERENT OPS. See the case directly below the loop.
      // 🆕🛑 **D450 — THE FIFTH REWRITE MOVED OUT OF THIS LOOP FOR D449's REASON, ONE
      // ARM LATER.** *"Put {N} damage counters on **each of** your opponent's
      // Pokémon."* is corpus line 415, which D450 claimed with
      // `COUNTER_FOLD_ON_OPPONENT_ALL` (arm 23e). RE-POINTED, NOT DELETED: this
      // anchor names ONE SPOT and that one FOLDS OVER A BOARD, so the two derive
      // different ops on different targets. See the case directly below the loop.
      "Put 7 damage counters on your opponent's Benched Pokémon.",
      "Put 7 damage counters on your Active Pokémon.",
      // THE SEAT, dropped. "your Active Pokémon" above is the controller's; this one
      // names no seat at all.
      "Put 7 damage counters on the Active Pokémon.",
      // A NON-BREAKING SPACE where an ASCII one is printed. Spelled as an ESCAPE,
      // not typed: byte-different from a space and INVISIBLE in a diff.
      `Put${NBSP}7 damage counters on your opponent's Active Pokémon.`,
      // An INTERIOR double space is not trimmable.
      "Put  7 damage counters on your opponent's Active Pokémon.",
      // A LEADING RIDER sentence pins `^` — this is how a gated printing arrives.
      "Flip a coin. If heads, put 7 damage counters on your opponent's Active Pokémon.",
      // A SECOND SENTENCE riding the same action — the shape the `$` exists for.
      // Claydol sv03-095 prints exactly this pattern on the neighbouring clause, so
      // the guard is not hypothetical: the first printing that extends THIS sentence
      // must land LOUDLY rather than half-resolve with a rider the engine never saw.
      "Put 7 damage counters on your opponent's Active Pokémon. This Pokémon is now Asleep.",
      // Empty.
      "",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // Outer whitespace SURVIVES by design (the deriver trims), so this states which
    // drift is tolerated and which is not.
    expect(deriveAttackEffect(`\t  ${clauseText(7)}\n`)).toEqual([putOp(GHOST_EYE_HP)]);
  });

  it("🆕 D449 — the ANY-ZONE rewrite derives a DIFFERENT OP, which is the claim it always made", () => {
    // The determiner *"1 of"* is the whole difference between a SPOT and a PICK, and
    // until D449 this file made that point with a `toBeNull` because nothing read the
    // any-zone sentence. It does now (arm 23b), so the point is made as an inequality
    // instead — which is strictly the stronger form: a reader that swallowed the
    // determiner would derive `damageActive` here and go red, where the old `toBeNull`
    // would have gone red for that AND for the unrelated fact that nobody read it.
    const anyZone = "Put 7 damage counters on 1 of your opponent's Pokémon.";
    expect(deriveAttackEffect(anyZone)).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: GHOST_EYE_HP, count: 1, source: "attack" },
    ]);
    expect(deriveAttackEffect(anyZone)).not.toEqual(deriveAttackEffect(clauseText(7)));
    expect(deriveAttackEffect(anyZone)).not.toContainEqual(
      expect.objectContaining({ op: "damageActive" }),
    );
    // …and the AMOUNT agrees across the two anchors, so the inequality above is about
    // the TARGET and nothing else — the one-axis discipline this file already uses for
    // its `DEFENDER_PUT_CLAUSE` pair.
    expect(deriveAttackEffect(clauseText(7))).toEqual([putOp(GHOST_EYE_HP)]);
  });

  it("🆕 D450 — the EACH-OF rewrite derives a FOLD, which is the claim it always made", () => {
    // The same repair one determiner over, and for the same reason: *"each of"* is a
    // FOLD over a whole board where this anchor names ONE SPOT, and until D450 that was
    // said with a `toBeNull` because nothing read the fold. Arm 23e reads it now.
    // ⚠️ **AND THE INEQUALITY IS SHARPER HERE THAN IT WAS FOR THE PICK**: the fold's op
    // is not even in the same family — `counterEachAll` takes no target and parks
    // nowhere — so a reader that let this sentence reach arm 22 would place counters on
    // ONE body where the card names a board, which no assertion about the amount could
    // catch.
    const fold = "Put 7 damage counters on each of your opponent's Pokémon.";
    expect(deriveAttackEffect(fold)).toEqual([
      {
        op: "counterEachAll",
        amount: GHOST_EYE_HP,
        filter: { kind: "anyPokemon" },
        side: "opponent",
        source: "attack",
      },
    ]);
    expect(deriveAttackEffect(fold)).not.toEqual(deriveAttackEffect(clauseText(7)));
    expect(deriveAttackEffect(fold)).not.toContainEqual(
      expect.objectContaining({ op: "damageActive" }),
    );
    // …and the AMOUNT agrees across the two anchors, so the inequality is about the
    // TARGET alone — this file's standing one-axis discipline.
    expect(deriveAttackEffect(fold)?.[0]).toMatchObject({ amount: GHOST_EYE_HP });
  });

  it("refuses a printed ZERO but ACCEPTS the ungrammatical singular count", () => {
    // A printed "Put 0 damage counters" is not a real card and would derive to a
    // silent no-op — an attack reporting a simulated effect that moved nothing. It
    // stays on the loud ATTACK_EFFECT_SKIPPED path, which is the guard every arm in
    // this deriver carries.
    expect(deriveAttackEffect(clauseText(0))).toBeNull();
    // "Put 1 damage counters …" is unprinted and ungrammatical, and it DERIVES. That
    // is a deliberate call and the same one D131 made for the unprinted "the top 1
    // cards" and D135 for "Heal all damage from 1 of your Pokémon.": the sentence is
    // unambiguous and the op expresses it exactly, so refusing it would be a claim
    // about the INGEST, not about the GAME. The cross product this capture accepts
    // is unfiltered above zero on purpose.
    expect(deriveAttackEffect(clauseText(1))).toEqual([putOp(10)]);
    expect(deriveAttackEffect(clauseText(999))).toEqual([putOp(9990)]);
    // No CEILING either: the op only RAISES damage and the epilogue's sweep resolves
    // whatever it Knocks Out, so a malformed count KOs the defender and stops —
    // a legal board state rather than a runaway.
  });

  it("derives the CURLY apostrophe identically — D137's class, not D137's fold", () => {
    // "your opponent's Active Pokémon" is the pool's most re-printed noun phrase and
    // every sibling regex on it carries `['’]` in its OWN source (D136/D137). The
    // claim is EQUALITY with the straight form, never merely "the curly one is
    // non-null" — a non-null check passes on a reader that folded the clause into
    // some other row. The discovered sweep in clauseApostrophe.test.ts picks BOTH of
    // these sentences up from the FIXTURES, which is why that census moved 33 → 35.
    for (const { counters, hp } of CLAUSES) {
      const straight = clauseText(counters);
      const curly = straight.replaceAll("'", RSQUO);
      expect(curly).not.toBe(straight);
      expect(curly).toContain(RSQUO);
      expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(straight));
      expect(deriveAttackEffect(curly)).toEqual([putOp(hp)]);
    }
  });
});

describe("the fixtures' printed text — every claim on the resume point, checked", () => {
  it("pins Mimikyu sv02-097 — GHOST EYE, {P}{C}, 7 counters, and NO damage field", () => {
    // On the deriver path a one-character drift un-simulates the card with no other
    // failure anywhere, so the bytes get pinned here — and the resume point's four
    // catalog claims (id, attack NAME, amount, Energy cost) are exactly these bytes.
    const ghostEye = FIXTURE_POOL["sv02-097"]?.attacks?.[GHOST_EYE_INDEX];
    expect(ghostEye).toEqual({
      cost: ["Psychic", "Colorless"],
      name: "Ghost Eye",
      effect: clauseText(7),
    });
    // NO `damage` field at all (not a zero, not an empty string), so the placement is
    // the entire visible result of the declaration and there is no D125 tail-order
    // question. Checked rather than trusted — the resume point carried a date on it.
    expect(ghostEye?.damage).toBeUndefined();
    expect(deriveAttackEffect(ghostEye?.effect ?? "")).toEqual([putOp(GHOST_EYE_HP)]);
    expect(FIXTURE_POOL["sv02-097"]?.name).toBe("Mimikyu");
    expect(FIXTURE_POOL["sv02-097"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv02-097"]?.hp).toBe(70);
    // ONE attack only — a second one would make GHOST_EYE_INDEX a coincidence.
    expect(FIXTURE_POOL["sv02-097"]?.attacks).toHaveLength(1);
  });

  it("pins Polteageist sv03-098 — POUR TEA at INDEX 1, {P}, 5 counters, no damage", () => {
    const pourTea = FIXTURE_POOL["sv03-098"]?.attacks?.[POUR_TEA_INDEX];
    expect(pourTea).toEqual({
      cost: ["Psychic"],
      name: "Pour Tea",
      effect: clauseText(5),
    });
    expect(pourTea?.damage).toBeUndefined();
    expect(deriveAttackEffect(pourTea?.effect ?? "")).toEqual([putOp(POUR_TEA_HP)]);
    // A STAGE 1, which is why it is surgeried into the Active Spot rather than
    // started with. D135 invented a Basic when BOTH of its printings were evolutions;
    // here Mimikyu is the Basic, so no fixture had to be made up.
    expect(FIXTURE_POOL["sv03-098"]?.stage).toBe("Stage1");
    expect(FIXTURE_POOL["sv03-098"]?.evolveFrom).toBe("Sinistea");
    // ⚠️ THE INDEX IS LOAD-BEARING and it is NOT zero — the two printings sit at
    // different indices on their cards, which is precisely the kind of detail a
    // remainder list carries wrongly. Index 0 is a different attack entirely.
    expect(POUR_TEA_INDEX).toBe(1);
    expect(FIXTURE_POOL["sv03-098"]?.attacks?.[ANTIQUE_COLLECTING_INDEX]?.name).toBe(
      "Antique Collecting",
    );
  });

  it("keeps Polteageist's INDEX 0 loud — one card, the same first word, two fates", () => {
    // The sharpest disjointness control this slice can buy, and better than a
    // neighbouring card's: "Antique Collecting" opens with the SAME WORD as the
    // mapped sentence and is read by NO reader at all. One card, two attacks, one
    // mapped and one loud — so the anchor is demonstrably a whole sentence rather
    // than a prefix on "Put ".
    const antique = FIXTURE_POOL["sv03-098"]?.attacks?.[ANTIQUE_COLLECTING_INDEX];
    expect(antique?.effect?.startsWith("Put ")).toBe(true);
    expect(deriveAttackEffect(antique?.effect ?? "")).toBeNull();
    expect(deriveAttackEffect(antique?.effect ?? "")).not.toEqual(
      deriveAttackEffect(clauseText(5)),
    );
  });

  it("costs ZERO registry ATTACK rows — and Mimikyu proves it the hard way", () => {
    // If either printing grew a row the registry would win
    // (`programFor(id)?.attack?.[index] ?? derive`) and every assertion above would
    // keep passing while testing nothing about the text.
    for (const { id } of CLAUSES) {
      expect(programFor(id)?.attack).toBeUndefined();
    }
    // ⚠️ AND MIMIKYU IS A SHARPER WITNESS THAN A CARD WITH NO ROW AT ALL: it HAS a
    // registry row — the Safeguard passive (D107) — and its attack still derives off
    // printed text. A row on the card is not a row on the attack, which is the
    // distinction D135 got wrong in the other direction when it read an Arboliva
    // registry row as shadowing a deriver it never met.
    expect(programFor("sv02-097")).toBeDefined();
    expect(programFor("sv02-097")?.passive).toEqual({ preventDamageFromExV: true });
    expect(programFor("sv03-098")).toBeUndefined();
  });
});

describe("end to end — the placement, at two counts and from both seats", () => {
  it("places SEVENTY on the defender for Mimikyu's printed SEVEN — in one action", () => {
    let state = mimikyuActive(board(), "p1");
    state = setDamage(state, "p2", DEFENDER_HURT);
    const defender = activeUid(state, "p2");
    const { state: done, events } = declare(state, GHOST_EYE_INDEX);

    // ONE row, and the number is HP. This is the × 10 arriving on a real board
    // rather than in a derivation: a build that skipped the conversion places 7 here
    // and the assertion reads a defender at 47.
    expect(all(events, "COUNTERS_PLACED")).toEqual([
      {
        type: "COUNTERS_PLACED",
        seat: "p2",
        uid: defender,
        amount: GHOST_EYE_HP,
        source: "attack",
      },
    ]);
    expect(done.players.p2.active?.damage).toBe(DEFENDER_HURT + GHOST_EYE_HP);
    // NOT A `DAMAGE_DEALT` ROW AT ALL — the event TYPE is as much the claim as the
    // number is, since `DAMAGE_DEALT` carries `weakness`/`resistance` fields
    // precisely because it went through the §8.5 pipeline. This did not.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    // NO PARK — "your opponent's Active Pokémon" is not a choice, so the whole
    // declaration lands in ONE batch and the §5.3 tail runs behind it.
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "COUNTERS_PLACED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
    // The ATTACKER is untouched: this sentence has no cost and no recoil.
    expect(done.players.p1.active?.damage).toBe(0);
  });

  it("places FIFTY for Polteageist's printed FIVE — the conversion, not a constant", () => {
    // THE SECOND PRINTING IS THE POINT OF THIS CASE. Two cards, two counts, one arm:
    // a build that hardcoded 70 (or that read the count from the wrong capture
    // group) passes the case above and fails here, which is the only way an
    // end-to-end suite can tell a conversion from a coincidence.
    let state = polteageistActive(board(), "p1");
    state = setDamage(state, "p2", DEFENDER_HURT);
    const defender = activeUid(state, "p2");
    const { state: done, events } = declare(state, POUR_TEA_INDEX);

    expect(all(events, "COUNTERS_PLACED")).toEqual([
      { type: "COUNTERS_PLACED", seat: "p2", uid: defender, amount: POUR_TEA_HP, source: "attack" },
    ]);
    expect(done.players.p2.active?.damage).toBe(DEFENDER_HURT + POUR_TEA_HP);
    expect(done.players.p2.active?.damage).not.toBe(DEFENDER_HURT + GHOST_EYE_HP);
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("runs from the OTHER SEAT too — the row's `seat` is derived, not hardcoded", () => {
    // Every case above attacks from p1, so a build that wrote "p2" into the
    // placement passes all of them. Driving the same declaration from p2 is what
    // makes the `seat` field a claim rather than a coincidence — and it is cheap,
    // because both seats run the same deck.
    let state = board();
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = mimikyuActive(state, "p2");
    state = setDamage(state, "p1", DEFENDER_HURT);
    const defender = activeUid(state, "p1");
    const { state: done, events } = declare(state, GHOST_EYE_INDEX, "p2");

    expect(find(events, "COUNTERS_PLACED")).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p1",
      uid: defender,
      amount: GHOST_EYE_HP,
      source: "attack",
    });
    expect(done.players.p1.active?.damage).toBe(DEFENDER_HURT + GHOST_EYE_HP);
    // …and the attacker's OWN side took nothing, which is the mirror of the p1 case
    // and the assertion a seat-swapped build fails.
    expect(done.players.p2.active?.damage).toBe(0);
  });

  it("consumes NO rng — no coin, no shuffle, nothing random in the sentence", () => {
    // The amount is read off the TEXT and the target is fixed by the rules, so this
    // whole suite runs on one board with no seed sweep. That determinism is worth an
    // assertion rather than a comment: a build that reached for a flip would
    // desynchronise the next coin in an online match.
    const state = mimikyuActive(board(), "p1");
    const { state: done } = declare(state, GHOST_EYE_INDEX);
    expect(done.rngState).toBe(state.rngState);
  });
});

describe("the placement is FLAT — from BOTH sides of §8.5", () => {
  it("skips WEAKNESS — a ×2 Psychic defender takes 70, not 140", () => {
    // Mimikyu is a PSYCHIC attacker, so a build that routed the placement through
    // the §8.5 pipeline doubles it. "Put damage counters" is not damage from an
    // attack: no Weakness/Resistance and no `damageReductionAfterWR` passive, which
    // is `damageActive`'s rule and D138 pinned the same claim for the counter MOVE.
    // Being PRINTED on an attack does not make a placed counter attack damage.
    let state = mimikyuActive(board(), "p1");
    state = setActiveFromDeck(state, "p2", "fix-psychic-weak-big");
    state = clearBench(state, "p2");
    expect(FIXTURE_POOL["fix-psychic-weak-big"]?.weaknesses).toEqual([
      { type: "Psychic", value: "×2" },
    ]);
    expect(FIXTURE_POOL["sv02-097"]?.types).toEqual(["Psychic"]);

    const { state: done, events } = declare(state, GHOST_EYE_INDEX);
    expect(find(events, "COUNTERS_PLACED")?.amount).toBe(GHOST_EYE_HP);
    expect(done.players.p2.active?.damage).toBe(GHOST_EYE_HP);
    expect(done.players.p2.active?.damage).not.toBe(GHOST_EYE_HP * 2);
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    // The body survives BOTH readings, so this case measures the amount and never a
    // promotion.
    expect(FLAT_DEFENDER_HP).toBeGreaterThan(GHOST_EYE_HP * 2);
    expect(FIXTURE_POOL["fix-psychic-weak-big"]?.hp).toBe(FLAT_DEFENDER_HP);
  });

  it("skips RESISTANCE too — a Psychic −30 defender takes 70, not 40", () => {
    // THE OTHER SIDE, and it is a different bug: a build that special-cased Weakness
    // alone passes the case above and fails this one. D138 pinned the doubling
    // direction only, so this is the half of the flat-placement claim that was still
    // an assertion rather than a measurement.
    let state = mimikyuActive(board(), "p1");
    state = setActiveFromDeck(state, "p2", "fix-psychic-resist-big");
    state = clearBench(state, "p2");
    expect(FIXTURE_POOL["fix-psychic-resist-big"]?.resistances).toEqual([
      { type: "Psychic", value: "-30" },
    ]);
    expect(FIXTURE_POOL["fix-psychic-resist-big"]?.weaknesses).toBeNull();

    const { state: done, events } = declare(state, GHOST_EYE_INDEX);
    expect(find(events, "COUNTERS_PLACED")?.amount).toBe(GHOST_EYE_HP);
    expect(done.players.p2.active?.damage).toBe(GHOST_EYE_HP);
    expect(done.players.p2.active?.damage).not.toBe(GHOST_EYE_HP - 30);
    expect(types(events)).not.toContain("DAMAGE_DEALT");
  });
});

describe("the KNOCK OUT it can cause — the epilogue sweep, with no park in front of it", () => {
  it("KOs the defender INLINE — prize to the ATTACKER, and the turn does NOT end", () => {
    // The op only RAISES damage; the sweep that catches the Knock Out is the attack
    // EPILOGUE's two-seat one (flow.ts `finishAttack`), reading the POST-effect
    // board. Unlike D138's move there is no park anywhere, so placement, Knock Out
    // and prize all land in ONE event batch — which makes the ORDER the assertion.
    let state = mimikyuActive(board(), "p1");
    state = setDamage(state, "p2", DEFENDER_NEARLY_DEAD);
    state = benchFromDeck(state, "p2", "fix-titan"); // somebody to promote into
    const defender = activeUid(state, "p2");
    expect(DEFENDER_NEARLY_DEAD + GHOST_EYE_HP).toBeGreaterThanOrEqual(TITAN_HP);

    const { state: done, events } = declare(state, GHOST_EYE_INDEX);

    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "COUNTERS_PLACED",
      "KNOCKED_OUT",
      "PRIZES_OWED",
    ]);
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: defender });
    // THE PRIZE IS OWED TO THE ATTACKER — the seat that declared, not the seat that
    // owns the Knocked Out body. fix-titan carries no rule box, so it is exactly one,
    // and WHICH prize card is a decision, so the resolution stops here rather than
    // taking one for the player.
    expect(find(events, "PRIZES_OWED")).toEqual({ type: "PRIZES_OWED", seat: "p1", count: 1 });
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    // …and the turn has NOT ended: the prize pick and the opponent's promotion are
    // both still in front of §5.3's tail.
    expect(types(events)).not.toContain("TURN_ENDED");
  });

  it("stops ONE point short and does not KO — the boundary, not just the crossing", () => {
    // The complement, and it is worth its own case: a build that swept on
    // "damage >= hp - 10" (a counters-vs-HP confusion in the KO check rather than in
    // the reader) passes the case above and Knocks this body out too.
    let state = mimikyuActive(board(), "p1");
    state = setDamage(state, "p2", TITAN_HP - GHOST_EYE_HP - 10);
    const { state: done, events } = declare(state, GHOST_EYE_INDEX);

    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(done.players.p2.active?.damage).toBe(TITAN_HP - 10);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });
});

describe("the log — an ATTACK's placement must not be labelled an Ability", () => {
  it("renders a SYSTEM row in the printed verb, and never the word Ability", () => {
    // D136's finding 1, refused at the source for the second time (D138 was the
    // first). `COUNTERS_PLACED.seat` OWNS the damaged Pokémon — here the attacker's
    // OPPONENT — and rows render after their seat's name, so an active-voice row
    // under this seat would read as the victim doing it to itself. And the
    // `"ability"` arm prints the literal word Ability, which on an attack is simply
    // false. Both are why `source` became a field and gained an `"attack"` member.
    let state = mimikyuActive(board(), "p1");
    state = setDamage(state, "p2", DEFENDER_HURT);
    const { state: done, events } = declare(state, GHOST_EYE_INDEX);
    const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state: done, elapsed: "+00:11" };
    const rendered = logFromEvents(events, ctx).flatMap((entry) =>
      entry.kind === "turn"
        ? []
        : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
    );

    const placed = rendered.find((r) => r.text.startsWith("Put:"));
    expect(placed).toBeDefined();
    expect(placed?.who).toBe("system");
    expect(placed?.text).toContain(String(GHOST_EYE_HP));
    // THE LABEL A REUSED SOURCE MEMBER WOULD HAVE PRINTED. This is the assertion that
    // fails the moment somebody "simplifies" the field away.
    expect(placed?.text).not.toContain("Ability");
    // The ACTOR is named by the ATTACK_DECLARED row directly above, which is the same
    // argument D136 used to make the mill row passive rather than give it an actor
    // field — so the system row owes no name of its own.
    const declared = rendered.find((r) => r.text.includes("Ghost Eye"));
    expect(declared?.who).toBe("p1");
    expect(rendered.indexOf(declared as (typeof rendered)[number])).toBeLessThan(
      rendered.indexOf(placed as (typeof rendered)[number]),
    );
  });

  it("still renders TREVENANT's placement as an Ability row — the other producer", () => {
    // The field is only meaningful if both values reach the log, so the `"ability"`
    // arm is asserted here rather than left to the older suite: one op, two
    // provenances, two rows. A build that flipped the default (or that set
    // `source: "attack"` in the registry row) breaks this and nothing else.
    const authored = programFor("sv03-012")?.triggered?.[0]?.program?.[0];
    expect(authored).toEqual({ op: "damageActive", amount: 10, source: "ability" });
    const state = board();
    const uid = activeUid(state, "p2");
    const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: "+00:11" };
    const [entry] = logFromEvents(
      [{ type: "COUNTERS_PLACED", seat: "p2", uid, amount: 10, source: "ability" }],
      ctx,
    );
    const text = entry?.kind === "turn" ? "" : (entry?.segments.map((s) => s.text).join("") ?? "");
    expect(text.startsWith("Ability:")).toBe(true);
    expect(text.startsWith("Put:")).toBe(false);
  });
});
