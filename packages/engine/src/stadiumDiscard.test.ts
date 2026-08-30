import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader as readByAny,
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
  splitAttackCancelClause,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackRequirement,
} from "./effects";
import type { EffectOp, GameEvent, GameState, Seat } from "./index";
import {
  STADIUM_DISCARD_DECK,
  attachFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 🆕🆕 D380 — THE STADIUM-DISCARD OP: THE FIRST SLICE IN THIS CORNER THAT BUYS AN
// OP RATHER THAN A PREDICATE, AND IT IS SMALLER THAN ITS NAME.
//
// Nine consecutive slices bought `BoardCondition` members worth one to three
// printings each. D379 measured the remainder and the arithmetic ended the era: the
// best clause row still on the table is worth ONE printing, and this family is worth
// ELEVEN. This slice takes SIX of them on ONE field-free op:
//
//   Hisuian Growlithe `sv06-099`/`sv06-181` "Blazing Destruction" (no cost, no damage)  ┐
//   Skarmory          `sv06-119`            "Big Storm"           ({C}{C}{C}, 90)       ├ "Discard a Stadium in play."          4
//   Mow Rotom         `sv10-009`            "Trimming Mower"      ({G}, 20)             ┘
//   Wooloo            `sv07-124`            "Knock Over"          ({C}{C}, 30)          ┐ "You may discard a Stadium in play."  2
//   Dubwool           `sv07-125`            "Knock Over"          ({C}{C}, 70)          ┘
//
// 🛑 **THE OP IS THREE LINES BECAUSE `playStadium` ALREADY WROTE THE TRANSITION.**
// cardplay.ts's §7.3 replace path has discarded the OUTGOING Stadium to its OWNER's
// pile and announced `STADIUM_DISCARDED` since M4. This op is that same move reached
// from the other direction — no new event, no new zone, no new state key, and
// `state.stadium` was already `{uid, owner} | null`. **PRICE AN OP AGAINST WHAT THE
// ZONE ALREADY DOES, NOT AGAINST ITS NAME.**
//
// ### THE FOUR SHAPE QUESTIONS, ANSWERED FROM THE CATALOG BEFORE ANYTHING WAS SPELLED
//
// 1. **`You may discard…` IS NEITHER A SECOND OP NOR A FLAG — IT IS D186's `optional`
//    OP, WHICH ALREADY EXISTS.** The printed sentence is the bare one with `You may `
//    in front of it and the verb lowercased; nothing else differs, so a field on
//    `discardStadium` would have been a second confirm mechanism beside a confirm op
//    that already has a prompt kind, a choice kind and a dialog on both surfaces.
//    ⚠️ And `optional`'s own doc block names the test this passes: the wrapper is for
//    an inner op with **no empty answer**, which a nullary discard is.
// 2. **AN EMPTY ZONE IS THREE DIFFERENT THINGS, AND THE CATALOG SAYS WHICH IS WHICH.**
//    The bare imperative makes it a silent NO-OP (§8.6, "do as much as you can" — the
//    printed sentence carries no "if you can't"); the *"You may"* spelling makes it a
//    question that must NOT BE ASKED, because `optional` parks unconditionally and a
//    confirm whose two answers leave the identical board is a decision with no stake —
//    hence the `conditionGate` on D378's `stadiumInPlay`; and *"…If you can't, this
//    attack does nothing."* makes it a CANCEL. 🛑 **`stadiumInPlay` ANSWERS THE THIRD
//    ONE TOO — ON THE BOARD FACT — AND THE SKELETON STILL REFUSES IT.** §7.3's zone is
//    a singleton and nothing in this engine can make an occupied zone undiscardable,
//    so *"you can't discard a Stadium in play"* is exactly *"the zone is empty"*. What
//    blocks it is the READER: `ATTACK_DOES_NOTHING` is anchored `^If`, and Eternatus
//    `sv08-141` "World Ender" prints its clause TRAILING and ANAPHORIC. effects.ts has
//    named that family beside `ATTACK_DOES_NOTHING` since D125 — and §6 RE-MEASURES it
//    in THIS population: **2 sentences / 2 printings** of the legal attack column, the
//    Stadium discard and a Basic {G} hand cost. So the mechanism is worth building for
//    the family, not for one card, and §6 leaves both of them named and loud.
//    🆕🆕 **D417 BUILT IT FOR ONE CARD, NOT FOR THE FAMILY** — `deriveAttackCancelRequirement`
//    reads the Stadium body and refuses the hand cost — so the prediction above was
//    right about the MECHANISM and wrong about its REACH, and §6's rung is re-pointed
//    at the SPLIT (D178: the clause stays, the correction is marked as one). ⚠️ And
//    D418 is where this file found out: its `READERS` list could not see D417's
//    reader, so §1 and §6 went on publishing a pre-D417 head for a whole slice.
// 3. **`discard that Stadium` NEEDS NO REFERENT, AND §7.3's SINGLETON IS THE REASON.**
//    D378 made `stadiumInPlay` nullary because the zone holds at most one Stadium;
//    the same fact makes *"a Stadium in play"* and *"that Stadium"* denote the same
//    card on every legal board — the antecedent tests the singleton and the tail
//    discards the singleton. The two tail sentences will therefore REUSE this op
//    unchanged rather than widen it.
// 4. **THE PILE IS THE STADIUM'S OWNER'S, NOT THE ACTOR'S** — the same
//    PRESENCE/OWNERSHIP line D378 drew one union over. §3 drives every reading on a
//    board where **P2** played the Stadium, because an op routing to `ctx.seat` is
//    green on every board where the attacker owns it and silently wrong on the boards
//    this family is actually printed for.
//
// ⚠️ **THE VACUITY MODES, NAMED BEFORE THE BUILD AND EACH DRIVEN ON A BOARD:**
//   • the op could write the PILE and leave the ZONE occupied (or the reverse), and
//     both halves are green against a uid-in-discard assertion alone — §3 therefore
//     reads Beach Court's CONTINUOUS retreat discount off a body already on the board,
//     which only stops applying when the zone is genuinely vacated;
//   • the op could route to the ACTOR's pile — §3's Stadium belongs to P2 and P1's
//     pile is asserted UNCHANGED, so an actor-routed op reddens by name;
//   • the `conditionGate` could be dropped and everything below §5's empty-zone rung
//     would still pass — that rung asserts the ABSENCE of a park, which is the only
//     observation a missing gate can move;
//   • the whole op could be dropped and the two sentences would go back to the
//     skipped-effect path — §2 pins both programs byte-for-byte and §4 asserts the
//     attack does NOT emit `ATTACK_EFFECT_SKIPPED`.
//
// WHAT SHIPS: **1 new FIELD-FREE `EffectOp`**, its **1** interpreter arm, **2**
// `deriveAttackEffect` arms and **2** whole-sentence anchors. Zero new events, zero
// new prompts, zero new `BoardCondition` members, zero new `packages/schema` bytes.
// `MATCH_RECORD_VERSION` stays **22**: adding a member to `EffectOp` is a WIDENING
// (D125) — no v22 deploy could have written `{op:"discardStadium"}`, so no v22 byte
// string means anything different under this one, and the op never parks, so
// `EffectContinuation.pendingOp` gains no inhabitant either (D335's test).

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The live readers, run as one — ~~the same set `censusAtHead.test.ts` uses~~.
    🆕🆕 D381 raised it from NINE to TEN (`deriveAttackOptionalCostBoost`), and that
    is exactly why one row left `STILL_OWED` below.

    🛑🛑 🆕🆕 **D418 — THE SENTENCE ABOVE IS STRUCK BECAUSE IT WAS FALSE, AND THE
    ROW IT BOASTS ABOUT IS THE PROOF THAT THE BOAST WAS UNCHECKED.** This list read
    ELEVEN from **D403** while `effects.ts` reached TWELVE at **D417**, so the claim
    to be "the same set `censusAtHead.test.ts` uses" was wrong for the whole of that
    window — and nothing anywhere compared the two. The missing entry was
    `deriveAttackCancelRequirement`, the reader D417 built for EXACTLY the sentence
    this file's `STILL_OWED` list names first: *"Discard a Stadium in play. If you
    can't, this attack does nothing."* ⚠️ **SO THE LIST DID NOT MERELY GO STALE — IT
    WENT STALE AGAINST ITS OWN SUBJECT**, and three published figures below (§1's
    `[4, 9]` and two §6 refusal rungs) went on stating a head that had moved.

    ⚠️ WHAT THIS LIST IS FOR NOW. Every figure in this file is computed through
    `resolvedByAnyReader` IMPORTED FROM `censusAttackCorpus.ts`, off the MODULE
    surface, so no edit here can move one again. The list survives as a DECLARED
    EXPECTATION for §1's first rung, which names the drifting reader. */
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
  // 🆕🆕 D418 — the TWELFTH (D417), and the one this file most needed.
  // 🆕🆕 D428 — THE THIRTEENTH, the PRE-DAMAGE Tool discard. ⚠️ SPLICED BEFORE THE
  // LAST ENTRY RATHER THAN APPENDED, D419's rule: mutant `find` strings quote an
  // array's LAST entries plus its closing bracket, and appending moves that anchor
  // without a character of it changing.
  deriveAttackPreDamage,
  deriveAttackCancelRequirement,
];

/** THE TWO SENTENCES THIS SLICE BUYS, byte-for-byte from the committed corpus. */
const BARE = "Discard a Stadium in play.";
const MAY = "You may discard a Stadium in play.";

/** …and the THREE this slice leaves, each named with the mechanism it is waiting on.
    🆕🆕 **D381 TOOK THE FOURTH.** *"You may discard a Stadium in play. If you do, this
    attack does 140 more damage."* (Cetitan ex `sv10-065`/`sv10-210`, 2 printings) was
    on this list at D380 with the note *"a tenth reader"*; that reader now exists
    (`deriveAttackOptionalCostBoost`) and the row moved to `taken` below on ZERO new
    ops — it spends this slice's `discardStadium` and D378's `stadiumInPlay`.
    Kept as a list rather than as prose because §6 drives them: a successor who widens
    an anchor to swallow one of these reddens here by name. */
const STILL_OWED = [
  // 🆕🆕 **D417 TOOK THE TRAILING ANAPHORIC CANCEL** — Eternatus `sv08-141` "World
  // Ender" ({R}{D}{D}, 230), which sat on this list from D380 and is now
  // `TAKEN_BY_D417` below. It was the THIRD row to leave, and the only one whose
  // departure this file could not see: D381's and D382's readers were in the
  // `READERS` array and this one was not (see that array's doc block).
  // The remaining `discard that Stadium` TAIL — Ting-Lu `sv06-110` "Ground Crasher".
  // 🆕🆕 **D382 TOOK ITS TWIN AND LEFT THIS ONE**, and the reason is in the MIDDLE
  // clause rather than in the join: `AttackBonusConsequent` (D317) reads *"…this
  // attack does {N} more damage{join}{consequent}"*, and D382 widened `{join}` from
  // `, and ` to also admit `. Then, `. Chi-Yu's middle clause IS a bonus and left
  // through that widening; this one's is a SECOND HIT (*"also does 30 damage to
  // each…"*), which no bonus anchor can read at any join. **A reader widened at the
  // JOIN rather than at the ANCHOR would have swallowed it**, which is exactly why
  // `bonusConsequentThen.test.ts` §2 keeps it as its sharpest control.
  "If a Stadium is in play, this attack also does 30 damage to each of your opponent's Benched Pokémon, and discard that Stadium. (Don't apply Weakness and Resistance for Benched Pokémon.)",
] as const;

/** 🆕🆕 D382 — the row that LEFT `STILL_OWED`, kept rather than deleted (D178:
    annotate provenance, never overwrite it). Chi-Yu `sv06-039` "Ground Melter"
    ({R}{C}, `60+`) spent this slice's `discardStadium` and D378's `stadiumInPlay`
    through D317's assembler, on ZERO new readers and ZERO new ops — the SECOND row
    to leave this list that way, after D381's. */
const TAKEN_BY_D382 = "If a Stadium is in play, this attack does 60 more damage. Then, discard that Stadium.";

/** 🆕🆕 D417 — the THIRD row to leave `STILL_OWED`, kept rather than deleted (D178)
    and asserted RESOLVED in §6. Eternatus `sv08-141` "World Ender" ({R}{D}{D}, 230)
    spends this slice's `discardStadium` under a CANCEL consequent read by
    `deriveAttackCancelRequirement` — the trailing anaphoric split D380 named as the
    missing mechanism, built exactly as predicted, on ZERO new ops.

    🛑🛑 **AND THIS FILE WENT ON CALLING IT REFUSED FOR A WHOLE SLICE**, because the
    `READERS` array above did not carry D417's reader. §1's `taken` figure read
    `[4, 9]` when the truth was `[5, 10]`, and §6's two refusal rungs asserted a
    refusal that had stopped existing — the exact defect D382 recorded one slice
    back, reproduced by the same mechanism a third time. **THE INSTRUMENT WAS FIXED AT
    D418 BY DELETING IT**: every figure here now runs off `censusAttackCorpus.ts`'s
    module-derived predicate, which has no list to fall behind. */
const TAKEN_BY_D417 = "Discard a Stadium in play. If you can't, this attack does nothing.";

const BEACH_COURT = "sv01-167";

// ── boards ─────────────────────────────────────────────────────────────────────

/** Put a Beach Court (`sv01-167`) into `seat`'s hand and play it — the shared §7.3
    zone then carries `owner: seat`, which is the ONLY thing the discard's
    DESTINATION reads. ⚠️ **A CONSTRUCTED `state.stadium` WOULD HAVE BEEN GREEN AND
    DEAD** (D310/D314/D318's rule): what is under test is that the Stadium the RULES
    put in the zone is the one this op takes out of it. */
function playStadium(state: GameState, seat: Seat): GameState {
  const withCard = handFromDeck(state, seat, BEACH_COURT, 1);
  const uid = handUid(withCard, seat, BEACH_COURT);
  return mustApply(withCard, { type: "playTrainer", seat, uid }).state;
}

/** Setup, then P1's turn 2 (P2 went first and passed) — P1's first unrestricted turn,
    so the attack step is legal (§4) — with BOTH Active spots pinned to a neutral
    200 HP `fix-bigbody`. `owner` says who, if anyone, played the one Stadium: P2 has
    to play it on its OWN turn, which is why the choice is made here rather than by a
    caller reaching in afterwards. */
function board(seed: number, owner: Seat | null = null): GameState {
  let state = driveSetup(
    seed,
    { p1: STADIUM_DISCARD_DECK, p2: STADIUM_DISCARD_DECK },
    { first: "p2" },
  );
  if (owner === "p2") state = playStadium(state, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  if (owner === "p1") state = playStadium(state, "p1");
  state = setActiveFromDeck(state, "p1", "fix-bigbody");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  return state;
}

/** Field `cardId` in `seat`'s Active Spot and pay `spec` onto it symbol-for-symbol.
    Must run in that order: `attachFromDeck` attaches to whatever is Active. */
function fielded(
  state: GameState,
  seat: Seat,
  cardId: string,
  spec: readonly (readonly [string, number])[] = [],
): GameState {
  let next = setActiveFromDeck(state, seat, cardId);
  for (const [id, count] of spec) next = attachFromDeck(next, seat, id, count);
  return next;
}

/** Hisuian Growlithe's body. NO Energy is attached, because the printed attack takes
    none — which is what makes the discard the only thing on the board that moved. */
const blazingDestruction = (state: GameState, seat: Seat = "p1"): GameState =>
  fielded(state, seat, "fix-blazedestruct");

/** Wooloo's body, paid `{C}{C}`. */
const knockOver = (state: GameState, seat: Seat = "p1"): GameState =>
  fielded(state, seat, "fix-knockover", [["fix-energy", 2]]);

const attack = (state: GameState, seat: Seat = "p1") =>
  mustApply(state, { type: "attack", seat, index: 0 });

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** THREE SEEDS (D270's rule). No coin is flipped anywhere on this seam — the op is a
    deterministic zone move — so three is the family's default rather than five. */
const SEEDS = [9001, 9013, 9029] as const;

describe("§1 — the price, MEASURED: six printings on one op, against ONE for the best clause row", () => {
  it("🆕🆕 D418 — the hand-kept READERS list IS the module's reader surface", () => {
    // 🛑 THE GUARD THIS FILE NEVER HAD, IN D417's SHAPE — and the file that needed it
    // most, because the reader this list was missing is the one built for the sentence
    // §6 names first. Until this slice nothing anywhere compared this list to what
    // `effects.ts` exports, so it stayed ELEVEN from D403 while the module reached
    // TWELVE at D417, and three of this file's claims were false the whole time.
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    // ⚠️ THE COUNT IS PINNED SEPARATELY FROM THE DIFF, because the diff alone stays
    // GREEN when a reader leaves the module and this list in the same commit — and
    // §1's and §6's figures would then move with nothing naming the cause.
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("🛑 the family is 6 sentences / 11 printings, and 5 / 10 of them now resolve", () => {
    // Both columns, off the same instrument, exactly as the resume point demands:
    // `corpus().filter(...)` gives the RECORDS and `units(...)` gives the PRINTINGS.
    const family = corpus().filter(([, s]) => s.includes("Stadium") && s.includes("iscard"));
    expect([family.length, units(family)]).toEqual([6, 11]);
    // 🆕🆕 D381 — `taken` is 2 → 3 and 6 → 8 printings, and the third row cost NO new
    // op: the reversed optional boost is a READING over this slice's own op.
    // 🆕🆕 D382 — 3 → **4** and 8 → **9**, and the FOURTH row cost no new op either:
    // Chi-Yu's tail is D317's assembler reached through a widened JOIN.
    // 🛑🛑 🆕🆕 **D418 — 4 / 9 WAS NOT A HEAD, IT WAS A STALE ONE, AND THE CORRECTION
    // IS 5 / 10.** ⚠️ The line above is left standing because it was TRUE when written
    // and the mistake is not in it (D178): what went wrong is that **D417 took a FIFTH
    // row** — Eternatus's trailing anaphoric cancel, `TAKEN_BY_D417` — and this figure
    // did not move, because the `READERS` list it was computed through could not see
    // D417's reader. The predicate is now imported from `censusAttackCorpus.ts` and
    // derived from the module, so a sixth departure cannot go unnoticed the same way.
    const taken = family.filter(([, s]) => s === BARE || s === MAY || readByAny(s));
    expect([taken.length, units(taken)]).toEqual([5, 10]);
    expect(taken.map(([, s]) => s)).toContain(TAKEN_BY_D382);
    expect(taken.map(([, s]) => s)).toContain(TAKEN_BY_D417);
    const left = family.filter(([, s]) => (STILL_OWED as readonly string[]).includes(s));
    // 🆕🆕 D418 — 2 / 2 -> **1 / 1**, the other half of D417's step: the row moved OUT
    // of `STILL_OWED` rather than the total moving, which is what keeps the partition
    // below a partition.
    expect([left.length, units(left)]).toEqual([1, 1]);
    // The parts sum, which is what makes a partition a partition — and what stops a
    // successor quietly moving a sentence from one list to the other.
    expect(taken.length + left.length).toBe(family.length);
    expect(units(taken) + units(left)).toBe(units(family));
  });

  it("🛑 the two sentences carry 4 and 2 printings, and no third spelling hides behind them", () => {
    const bare = corpus().filter(([, s]) => s === BARE);
    expect([bare.length, units(bare)]).toEqual([1, 4]);
    const may = corpus().filter(([, s]) => s === MAY);
    expect([may.length, units(may)]).toEqual([1, 2]);
    // 🛑 THE CENSUS WAS ASKED FOR THE WORD, NOT THE PHRASE (D310/D311, D377). Every
    // legal attack sentence carrying "Stadium" at all is nine, and the six that also
    // carry "discard" in either case are exactly the family above — so nothing here is
    // hiding behind a spelling this slice did not think to try.
    const anyStadium = corpus().filter(([, s]) => s.includes("Stadium"));
    expect(anyStadium).toHaveLength(9);
    expect(corpus().filter(([, s]) => /stadium/i.test(s))).toHaveLength(anyStadium.length);
    // …and no printing spells the discard with a lower-case noun or a possessive,
    // which is the pair of variants a `GLOB` census would have had to rule out.
    expect(corpus().filter(([, s]) => /discard .{0,12}stadium/i.test(s))).toHaveLength(6);
    expect(
      corpus().some(([, s]) => /discard (your|their|your opponent's) Stadium/.test(s)),
    ).toBe(false);
  });

  it("🛑 it is worth SIX times the best remaining clause row, which is why the era ended", () => {
    // D379 left the bonus residue at 21 sentences / 25 printings, and FLAT: the
    // 5-printing band is D368's standing SHAPE refusal and the 2-printing band is the
    // deferred HEALED flag, so everything a clause row could still take is a
    // 1-printing row. Re-derived here rather than quoted.
    const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !readByAny(s));
    // 🆕🆕 D384 — 21 / 25 -> 20 / 24: the STRICT-INEQUALITY TWIN left this residue —
    // ONE sentence at ONE printing (Swalot `sv07-092` "Devouring Mouth", +160) — and
    // it is the family's FIRST 1:1 step, re-derived live rather than decremented.
    // ⚠️ AND IT IS THE SENTENCE D372 PRICED AND REFUSED: the same two Active bodies as
    // `activeEnergyCountsEqual`, under `>` instead of `===`, on a SECOND nullary member.
    // 🆕🆕 D386 — 20 / 24 -> 19 / 22: the HEALED-THIS-TURN clause left this residue —
    // ONE sentence at TWO printings (Maractus `sv10.5b-008`/`-093` "Lively Needles",
    // +100), a 1:2 step — and it was NOT a singleton, so unlike D384's step this one
    // falls on the NON-singleton side and the arithmetic below moves with it.
    // 🆕🆕 D387 — 19 / 22 -> **18 / 21**: the STAGE 1 clause left this residue — ONE
    // sentence at ONE printing (Paldean Tauros `sv08-018` "Spirited Tackle", +90), a
    // 1:1 step and a SINGLETON, so the whole step falls on the 1-printing band.
    // 🆕🆕 D388 — 18 / 21 -> **17 / 20**: the RETREAT-COST THRESHOLD left this residue
    // — ONE sentence at ONE printing (Talonflame `sv07-123` "Aero Chase", +110) —
    // re-derived live rather than decremented. 🛑 THE 2-PRINTING BAND STAYS EMPTY and
    // the distribution goes `{1: 16, 5: 1}` -> `{1: 15, 5: 1}`, so every band rung is
    // still aimed at the WHOLE distribution (D379).
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
    expect([refused.length, units(refused)]).toEqual([5, 5]); // 🆕🆕 D436 -2 sentences / -5 printings (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D398 — the DECK-SIZE READ took the LAST BUILDABLE sentence out (Rabsca `sv08-014` "Counterturn", 1 printing), so 8 / 11 -> 7 / 10 and the residue is now EXHAUSTED of buildable rows: FIVE D207 banners and D368's 5-printing SHAPE refusal are all that is left, and this figure can only move again if a refusal's REASON expires
    const singletons = refused.filter(([n]) => n === 1);
    // ⚠️ **THE 5-PRINTING BAND IS TWO ROWS, NOT ONE**, which the handoff's prose did
    // not say: D368's *"in addition to this attack's cost"* is printed at 100 (2) AND
    // at 80 (3). With the deferred HEALED row that is THREE non-singleton records
    // carrying SEVEN printings, and the 1-printing band is the remaining EIGHTEEN.
    // 🆕🆕 D384 — EIGHTEEN -> SEVENTEEN. The STRICT-INEQUALITY TWIN was a SINGLETON, so
    // the whole step falls on this band and the three non-singleton records are
    // untouched: 3 / 7 stands. ⚠️ **THAT IS THE ARITHMETIC THIS RUNG EXISTS FOR** — the
    // comparison it makes (six printings for one op against one for the best clause
    // row) is unchanged by a slice that takes another one out of the singleton band.
    // 🆕🆕 D386 — 3 / 7 -> **2 / 5**, and the singleton band STANDS STILL at 17 / 17.
    // The deferred HEALED row this paragraph counted was taken, so the non-singleton
    // side loses one record and two printings while the band below it is untouched —
    // the exact mirror of D384's step, and the reason both halves are asserted.
    // 🛑 WHAT IS LEFT ABOVE THE SINGLETONS IS ONE CLAUSE PRINTED AT TWO AMOUNTS, and
    // it is the row D368 disqualified on SHAPE: the comparison this rung makes (six
    // printings for one op against one for the best clause row) is now made against a
    // band with no purchasable member above 1 at all.
    // 🆕🆕 **D436 — 2 / 5 → 0 / 0: THE NON-SINGLETON SIDE IS EMPTY.** The one clause
    // above the singleton band was D368's declaration row, printed at two amounts, and
    // D436 claims it. The comparison this rung exists to make — six printings for one
    // op against the best clause row — is now made against a band that is ENTIRELY
    // singletons, which is the strongest form of the same statement rather than a
    // weaker one, and it reddens the moment any clause returns above one printing.
    expect(refused.length - singletons.length).toBe(0);
    expect(units(refused) - units(singletons)).toBe(0);
    // 🆕🆕 D387 — the singleton band 17 / 17 -> **16 / 16** and the non-singleton side
    // STANDS STILL at 2 / 5: the STAGE 1 clause was a SINGLETON, so this is D384's
    // step repeated and the comparison this rung makes (six printings for one op
    // against ONE for the best clause row) is unchanged by it.
    // 🆕🆕 D388 — the singleton band 16 / 16 -> **15 / 15** and the non-singleton side
    // STANDS STILL at 2 / 5 for the THIRD consecutive slice: the RETREAT-COST
    // THRESHOLD was a SINGLETON too, so the comparison this rung makes (six printings
    // for one op against ONE for the best clause row) is again unchanged by it.
    // 🆕🆕 D390 — the singleton band 14 / 14 -> **13 / 13** and the non-singleton side
    // STANDS STILL at 2 / 5 for the FIFTH consecutive slice: the OPPONENT-SEAT TYPE
    // READ was a SINGLETON too, so the comparison this rung makes (six printings for
    // one op against ONE for the best clause row) is again unchanged by it.
    // 🆕🆕 D391 — 13 -> **12**: the TYPED PER-BODY ENERGY THRESHOLD was a SINGLETON
    // too, so the comparison this rung makes (six printings for one op against ONE for the
    // best clause row) is again unchanged by it.
    // 🆕🆕 D392 — 12 / 12 -> **11 / 11**: the SUBSTRING NAME READ was a singleton.
    expect([singletons.length, units(singletons)]).toEqual([5, 5]); // 🆕🆕 D398 — the DECK-SIZE READ took ONE more singleton out // 🆕🆕 D397 — the BENCHED-CUBONE FILTER took ONE more singleton out // 🆕🆕 D394 — the USED-ATTACK PAIR took TWO more singletons out at once, the second two-step in two slices // 🆕🆕 D393 — 11 / 11 -> **9 / 9**: the EVOLVE PAIR was TWO singletons on one mechanism, which is the first two-step this line has seen and the reason the 1-printing band stopped being saturated
    // SIX printings against ONE. The comparison is the slice's whole argument, so it
    // is asserted rather than written down.
    expect(units(corpus().filter(([, s]) => s === BARE || s === MAY))).toBe(6 * 1);
  });
});

describe("§2 — the two readings, pinned byte-for-byte", () => {
  it("the BARE imperative derives the op ALONE — no gate, because an empty zone is a no-op", () => {
    expect(deriveAttackEffect(BARE)).toEqual([{ op: "discardStadium" }]);
  });

  it("the printed 'You may' derives the gate, the confirm and the op, in that order", () => {
    const expected: EffectOp[] = [
      {
        op: "conditionGate",
        cond: { kind: "stadiumInPlay" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          {
            op: "optional",
            note: MAY,
            // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
            then: [{ op: "discardStadium" }],
          },
        ],
      },
    ];
    expect(deriveAttackEffect(MAY)).toEqual(expected);
    // The confirm's note is the WHOLE printed sentence and not a re-voicing — the op's
    // own contract, and what the dialog shows.
    const gate = deriveAttackEffect(MAY)?.[0];
    if (gate === undefined || gate.op !== "conditionGate") throw new Error("expected the gate");
    const inner = gate.then[0];
    if (inner === undefined || inner.op !== "optional") throw new Error("expected the confirm");
    expect(inner.note).toBe(MAY);
    // …and NO `otherwise` on either gate: the printed sentence buys nothing on a
    // decline and nothing on an empty zone, and D316's field is ABSENT rather than
    // empty (D135 — absent is the unmarked printing).
    expect(gate.otherwise).toBeUndefined();
    expect(inner.otherwise).toBeUndefined();
  });

  it("🛑 the anchors are WHOLE-SENTENCE, so every compound printing of the family is refused", () => {
    for (const sentence of [...STILL_OWED, TAKEN_BY_D382]) {
      expect(deriveAttackEffect(sentence), sentence).toBeNull();
    }
    // …and the near misses a floating match would have swallowed. Neither is a printed
    // sentence; both are the fragments the four compounds are built out of.
    expect(deriveAttackEffect("discard that Stadium.")).toBeNull();
    expect(deriveAttackEffect("You may discard a Stadium in play. If you do, this attack does 10 more damage.")).toBeNull();
  });
});

describe("§3 — the board: the OWNER's pile, and a zone that is genuinely vacated", () => {
  it.each(SEEDS)("seed %i — P2's Stadium goes to P2's discard, not the attacker's", (seed) => {
    const before = blazingDestruction(board(seed, "p2"));
    const stadium = before.stadium;
    if (stadium === null) throw new Error("expected P2's Stadium in the zone");
    expect(stadium.owner).toBe("p2");
    const p1Discard = before.players.p1.discard.length;
    const p2Discard = before.players.p2.discard.length;

    const result = attack(before);
    const state = result.state;

    // The zone is EMPTY…
    expect(state.stadium).toBeNull();
    // …the card is in the OWNER's pile…
    expect(state.players.p2.discard).toContain(stadium.uid);
    expect(state.players.p2.discard).toHaveLength(p2Discard + 1);
    // …and the ACTOR's pile did not move. 🛑 THIS IS THE RUNG AN ACTOR-ROUTED OP
    // REDDENS ON, and it is the whole reason the board is built with P2 as owner.
    expect(state.players.p1.discard).toHaveLength(p1Discard);
    expect(state.players.p1.discard).not.toContain(stadium.uid);
    // 🛑🛑 **AND THE PILE IS THE *ONLY* THING THAT MOVED — A RUNG THE MUTATION HARNESS
    // ASKED FOR AND THE FIRST DRAFT OF THIS FILE DID NOT HAVE.**
    // `D380-stadium-discard-routes-to-the-other-seat` SURVIVED the four assertions
    // above. It reads `players[otherSeat(owner)]` and writes the result back under
    // `owner`, so P2's whole side is replaced by P1's with the uid appended — and on
    // a board where both piles are EMPTY and both decks come from one list, *"contains
    // the uid"* and *"grew by one"* are BOTH STILL TRUE. **A SEAT DEFECT CAN HIDE
    // INSIDE A SYMMETRIC BOARD**, which is D202's unreachable-population finding one
    // mechanism over. The repair is not a bigger pile: it is asserting the pile's
    // CONTENTS as an extension of its own former contents, and pinning the zones a
    // cross-seat read would overwrite. ⚠️ **A WHOLE-SIDE COMPARISON WAS TRIED FIRST
    // AND IS WRONG**: the attack ends P1's turn, so P2 legitimately DRAWS before this
    // line runs, and the guard would have been red on a correct engine.
    expect(state.players.p2.discard).toEqual([...before.players.p2.discard, stadium.uid]);
    expect(state.players.p2.active).toEqual(before.players.p2.active);
    expect(state.players.p2.bench).toEqual(before.players.p2.bench);
    expect(state.players.p1.discard).toEqual(before.players.p1.discard);
    // 🆕🆕 D394 — THE ATTACKER'S OWN BODY IS THE ONE EXCEPTION NOW, AND IT IS NAMED
    // RATHER THAN RELAXED. `finishAttack` stamps `usedAttack` on the body that
    // declared, so "nothing else moved" is asserted MODULO that one key and the key
    // is then pinned to the printed attack name. Widening this to a partial match
    // would have given back exactly the cross-seat blindness the rung exists for.
    expect(state.players.p1.active).toEqual({
      ...before.players.p1.active,
      usedAttack: { name: "Blazing Destruction", turn: before.turn },
    });
    // The EXISTING event, under the OWNER's seat — `playStadium`'s row verbatim.
    expect(find(result.events, "STADIUM_DISCARDED")).toEqual({
      type: "STADIUM_DISCARDED",
      seat: "p2",
      uid: stadium.uid,
    });
    // …and the attack was not skipped, which is what a dropped op would look like.
    expect(types(result.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it.each(SEEDS)("seed %i — the zone's CONTINUOUS effect stops applying, which a pile write cannot fake", (seed) => {
    // 🛑 THE ANTI-VACUITY RUNG. An op that appended the uid to a pile and left
    // `state.stadium` occupied passes every assertion above about the pile; an op that
    // nulled the zone and forgot the pile passes every assertion about the zone. Beach
    // Court prints *"Basic Pokémon retreat cost {C} less"*, so its departure is
    // readable off a body that was already on the board before the attack.
    let state = blazingDestruction(board(seed, "p2"));
    const defender = state.players.p2.active;
    if (defender === null) throw new Error("expected P2's Active");
    // `fix-bigbody` is a Basic with retreat 1, discounted to 0 while the zone holds it.
    expect(effectiveRetreatCost(state, defender)).toBe(0);
    state = attack(state).state;
    const after = state.players.p2.active;
    if (after === null) throw new Error("expected P2's Active");
    expect(effectiveRetreatCost(state, after)).toBe(1);
  });

  it.each(SEEDS)("seed %i — the same op on the attacker's OWN Stadium routes to the attacker", (seed) => {
    // The other half of the ownership read: `stadium.owner` is not a constant, and a
    // hard-coded `otherSeat(ctx.seat)` would be green on the case above and red here.
    let state = blazingDestruction(board(seed, "p1"));
    const stadium = state.stadium;
    if (stadium === null) throw new Error("expected P1's Stadium in the zone");
    const p2Discard = state.players.p2.discard.length;
    const result = attack(state);
    state = result.state;
    expect(state.stadium).toBeNull();
    expect(state.players.p1.discard).toContain(stadium.uid);
    expect(state.players.p2.discard).toHaveLength(p2Discard);
    expect(find(result.events, "STADIUM_DISCARDED")?.seat).toBe("p1");
  });

  it.each(SEEDS)("seed %i — it works from the FAR SEAT too: the op reads the zone, not p1", (seed) => {
    // The op is seat-INDEPENDENT on its face (it never looks at `ctx.seat`), and a
    // P1-only suite cannot tell "reads the zone" apart from "reads p1's Stadium".
    let state = mustApply(board(seed, "p1"), { type: "endTurn", seat: "p1" }).state;
    state = blazingDestruction(state, "p2");
    const stadium = state.stadium;
    if (stadium === null) throw new Error("expected P1's Stadium in the zone");
    const result = attack(state, "p2");
    expect(result.state.stadium).toBeNull();
    // P2 attacked; the Stadium is P1's; it goes to P1's pile.
    expect(result.state.players.p1.discard).toContain(stadium.uid);
    expect(find(result.events, "STADIUM_DISCARDED")?.seat).toBe("p1");
  });
});

describe("§4 — the EMPTY zone: a silent no-op, and not a skipped effect", () => {
  it.each(SEEDS)("seed %i — the bare imperative resolves with nothing to discard", (seed) => {
    const state = blazingDestruction(board(seed, null));
    expect(state.stadium).toBeNull();
    const p1Discard = state.players.p1.discard.length;
    const p2Discard = state.players.p2.discard.length;
    const result = attack(state);
    // §8.6's "do as much as you can" — the attack RESOLVES, both piles stand still…
    expect(types(result.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(result.events)).not.toContain("ATTACK_FAILED");
    expect(result.state.players.p1.discard).toHaveLength(p1Discard);
    expect(result.state.players.p2.discard).toHaveLength(p2Discard);
    // …and NO event is emitted for a discard that did not happen. A row here would
    // announce a card that does not exist.
    expect(types(result.events)).not.toContain("STADIUM_DISCARDED");
    // The turn is handed back to the actor, not parked on anything.
    expect(result.state.phase.kind).not.toBe("effect:choose");
  });
});

describe("§5 — the printed 'You may': a confirm that is asked ONLY when it has a stake", () => {
  it.each(SEEDS)("seed %i — an OCCUPIED zone parks a confirm, and YES discards to the owner", (seed) => {
    let state = knockOver(board(seed, "p2"));
    const stadium = state.stadium;
    if (stadium === null) throw new Error("expected P2's Stadium in the zone");
    const parked = attack(state);
    expect(parked.state.phase.kind).toBe("effect:choose");
    expect(find(parked.events, "EFFECT_PENDING")).toEqual({
      type: "EFFECT_PENDING",
      seat: "p1",
      note: MAY,
    });
    // …and the printed 30 has already landed: the confirm is about the discard, not
    // about the attack.
    expect(find(parked.events, "DAMAGE_DEALT")).toMatchObject({ base: 30, dealt: 30 });

    const done = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    state = done.state;
    expect(state.stadium).toBeNull();
    expect(state.players.p2.discard).toContain(stadium.uid);
    expect(find(done.events, "STADIUM_DISCARDED")?.seat).toBe("p2");
  });

  it.each(SEEDS)("seed %i — and NO leaves the zone exactly as it was", (seed) => {
    const state = knockOver(board(seed, "p2"));
    const stadium = state.stadium;
    if (stadium === null) throw new Error("expected P2's Stadium in the zone");
    const parked = attack(state);
    const done = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: false },
    });
    // 🛑 THE DEFECT THIS OP CAN HAVE, per `optional`'s own doc: a confirm that
    // silently applies on "no".
    expect(done.state.stadium).toEqual(stadium);
    expect(done.state.players.p2.discard).not.toContain(stadium.uid);
    expect(types(done.events)).not.toContain("STADIUM_DISCARDED");
  });

  it.each(SEEDS)("seed %i — 🛑 an EMPTY zone is not asked at all, which is the gate's whole job", (seed) => {
    // The rung a dropped `conditionGate` reddens on, and the ONLY one it can: without
    // the gate the program parks a confirm whose "yes" and "no" leave the identical
    // board — a decision with no stake, and a dialog the player cannot answer usefully.
    const state = knockOver(board(seed, null));
    expect(state.stadium).toBeNull();
    const result = attack(state);
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(types(result.events)).not.toContain("EFFECT_PENDING");
    expect(types(result.events)).not.toContain("STADIUM_DISCARDED");
    // The attack still resolves its printed 30 — the gate refuses the question, not
    // the attack.
    expect(find(result.events, "DAMAGE_DEALT")).toMatchObject({ base: 30, dealt: 30 });
  });
});

describe("§6 — what this slice did NOT buy", () => {
  it("🛑 the ONE COMPOUND printing left stays LOUD, waiting on a named mechanism", () => {
    for (const sentence of STILL_OWED) {
      expect(readByAny(sentence), sentence).toBe(false);
    }
    // 🆕🆕 D381 — FIVE printings became THREE, and the two that left did so through a
    // READER rather than through an op.
    // 🆕🆕 D382 — THREE became **TWO**, the same way a third time. Two singletons is
    // the number the next slice is choosing against, and both are named above with
    // the mechanism each is waiting on.
    // 🛑🛑 🆕🆕 **D418 — TWO became ONE at D417, AND THIS RUNG DID NOT NOTICE**: the
    // loop above ran over a `STILL_OWED` that still held Eternatus, and asserted a
    // refusal `deriveAttackCancelRequirement` had already ended. It was GREEN because
    // this file's `READERS` list could not see that reader — **a refusal guard whose
    // instrument cannot see the reader that expired it reads green for the wrong
    // reason** (D211/D379), for the third time in this file. The loop is unchanged;
    // what changed is the list it walks and the predicate it walks with.
    const left = corpus().filter(([, s]) => (STILL_OWED as readonly string[]).includes(s));
    expect(units(left)).toBe(1);
    // 🛑 …and the rows that LEFT are asserted to have left, so this rung cannot go
    // green by a successor quietly shortening the list (D379's saturation trap).
    expect(readByAny(TAKEN_BY_D382)).toBe(true);
    expect(readByAny(TAKEN_BY_D417)).toBe(true);
  });

  it("🛑 the TRAILING ANAPHORIC cancel is a FAMILY of 3 printings, not one card — and D420 closed it", () => {
    // Why Eternatus is not half-built here: `ATTACK_DOES_NOTHING`'s `^If` refuses every
    // one of them, and effects.ts has carried that count since D125. The member the
    // sentence needs (`stadiumInPlay`) already exists — what is missing is a SPLIT that
    // reads a clause printed BEHIND its body.
    const anaphoric = corpus().filter(([, s]) =>
      s.includes("If you can't, this attack does nothing."),
    );
    // ⚠️ **AND THE COUNT IS TWO IN *THIS* POPULATION, NOT THE THREE effects.ts PRINTS
    // BESIDE `ATTACK_DOES_NOTHING`.** That figure is not a `legal_standard = 1` one —
    // this is the legal attack column and it holds two: the Stadium discard and Ogerpon
    // `sv06-025`-shaped *"Discard a Basic {G} Energy card from your hand."* **A COUNT
    // WITHOUT ITS POPULATION IS A FLOOR** (D183/D187), and the older comment is a floor
    // against this one rather than wrong.
    expect([anaphoric.length, units(anaphoric)]).toEqual([2, 2]);
    // 🛑 THE CLAIM THIS RUNG ACTUALLY OWNS IS ABOUT `ATTACK_DOES_NOTHING`'s ANCHOR,
    // and that claim is STILL TRUE OF BOTH: `deriveAttackRequirement` is anchored `^If`
    // and refuses a clause printed BEHIND its body, which is the whole reason D380
    // could not half-build Eternatus here.
    for (const [, s] of anaphoric) expect(deriveAttackRequirement(s), s).toBeNull();
    // 🛑🛑 🆕🆕 **D418 — THE SECOND HALF OF THIS LOOP WAS A DIFFERENT CLAIM AND IT
    // STOPPED BEING TRUE AT D417, SO IT IS RE-POINTED RATHER THAN DELETED** (D316/D317's
    // pattern). It read `expect(readByAny(s)).toBe(false)` over BOTH rows — *"no reader
    // anywhere claims either of these"* — and D417 built `deriveAttackCancelRequirement`
    // for exactly the Stadium one. ⚠️ **AND THE ROW BELOW IS WHY THE RUNG IS WORTH
    // KEEPING AT ALL**: its subject is that this is a FAMILY and not a card, and the
    // family is now SPLIT — which is a sharper form of the same claim than the refusal
    // was. The split is asserted in both directions so neither half can rot quietly.
    const [stadiumRow, handRow] = [
      anaphoric.filter(([, s]) => s === TAKEN_BY_D417),
      anaphoric.filter(([, s]) => s !== TAKEN_BY_D417),
    ];
    expect([stadiumRow.length, handRow.length]).toEqual([1, 1]);
    for (const [, s] of stadiumRow) {
      expect(deriveAttackCancelRequirement(s), s).not.toBeNull();
      expect(readByAny(s), s).toBe(true);
    }
    // 🛑🛑 🆕🆕 **D420 SETTLED THE DEBT, AND THIS HALF IS INVERTED RATHER THAN DELETED
    // — D418's OWN LESSON, APPLIED TO D418's OWN RUNG.** It read
    // `expect(deriveAttackCancelRequirement(s)).toBeNull()` / `readByAny(s) === false`
    // over the hand row, under the reason *"a split that reads the trailing clause
    // generally would have taken both; D417's reads the Stadium body only."* D420
    // widened `ATTACK_CANCEL_TRAILING` to a CLOSED alternation and added the row —
    // together with the `deriveAttackEffect` arm the row needed, which is the half
    // `ATTACK_CANCEL_HEADS`' doc block was corrected for.
    //
    // ⚠️ **AND THE INVERTED FORM STILL DISCRIMINATES, WHICH IS THE THING D418 GOT
    // WRONG ONE RUNG DOWN.** The claim below is not "some reader claims it" (which the
    // Stadium row already satisfies): it is that the two rows resolve to DIFFERENT
    // facts off the byte-identical clause, which is exactly the head-keying property a
    // clause-keyed table would break and a saturating anchor would erase.
    for (const [, s] of handRow) {
      expect(deriveAttackCancelRequirement(s), s).not.toBeNull();
      expect(readByAny(s), s).toBe(true);
    }
    expect(deriveAttackCancelRequirement(handRow[0]?.[1] ?? "")).not.toEqual(
      deriveAttackCancelRequirement(stadiumRow[0]?.[1] ?? ""),
    );
    // 🛑 AND THE SECOND ONE IS WHY THIS IS A FAMILY AND NOT A CARD: it is a HAND COST
    // whose "can't" points at a different mechanism entirely, so the split that reads
    // the trailing clause had to be general over its body, exactly as
    // `splitAttackRequirementClause` is general over its leading one — and D420 is the
    // slice that proved it was, by adding a second body and touching neither the
    // splitter's shape nor the site.
    expect(anaphoric.some(([, s]) => s.startsWith("Discard a Basic"))).toBe(true);
  });

  it("🛑 the bare anchor's TERMINATOR still refuses an UNMAPPED tail — D418's own repair re-armed", () => {
    // 🛑 THIS RUNG EXISTS BECAUSE A MUTANT SURVIVED, AND THE MUTANT SURVIVED BECAUSE
    // OF A REPAIR MADE IN THIS FILE. `D380-bare-anchor-loses-its-terminator` drops the
    // `$` from `DISCARD_STADIUM`, turning a whole-sentence anchor into a PREFIX match
    // — so a sentence that merely OPENS with the printed clause is claimed whole and
    // whatever follows it is silently deleted. That row named this file as its killer.
    //
    // ⚠️ **D418 RE-POINTED THIS FILE'S REFUSAL RUNGS AND, WITHOUT MEANING TO, REMOVED
    // THE WITNESS.** Before D417 the killer was `readByAny(Eternatus) === false`: with
    // the `$` gone the prefix match claimed that sentence and the rung reddened. D417
    // made the sentence genuinely resolved and D418 re-pointed the rung to say so — a
    // TRUE claim, and a claim that **no longer discriminates**, because `readByAny` is
    // now `true` under the mutant and under the real build alike.
    //
    // 🛑 **RE-POINTING A REFUSAL RUNG ONTO A DIFFERENT TRUE CLAIM CAN SILENTLY DROP THE
    // DISCRIMINATION THE OLD CLAIM PROVIDED.** Both claims are correct; only one of
    // them could go red. This rung pins what the terminator is actually FOR, on a
    // string the splitter deliberately refuses, which is where the prefix match is
    // still observable.
    //
    // The tail is UNMAPPED on purpose: `splitAttackCancelClause` refuses any head its
    // table does not carry, so this string reaches `deriveAttackEffect` WHOLE — which
    // is exactly the position Eternatus's sentence occupied before D417 built the
    // splitter that now strips it.
    const bare = "Discard a Stadium in play.";
    const unmappedTail = `${bare} Draw a card.`;
    expect(splitAttackCancelClause(unmappedTail)).toBeNull();
    // 🛑 THE ASSERTION THE MUTANT DIES ON: a prefix match would return the op here.
    expect(deriveAttackEffect(unmappedTail)).toBeNull();
    // …and the CONTROL, so this cannot pass on a build where the anchor stopped
    // reading anything at all.
    expect(deriveAttackEffect(bare)).toEqual([{ op: "discardStadium" }]);
    // …and the string this rung is really about — the one D417 taught the splitter to
    // strip — is the SAME head with a MAPPED tail, which the splitter does take.
    expect(splitAttackCancelClause(TAKEN_BY_D417)?.head).toBe(bare);
  });

  it("bought no new event, no new prompt and no second Stadium zone", () => {
    // The op reuses `STADIUM_DISCARDED`, which `playStadium` has emitted since M4 —
    // asserted by driving the OTHER producer on the same board shape and comparing the
    // row's SHAPE, so a new event type would redden here rather than in a grep.
    const attacked = attack(blazingDestruction(board(SEEDS[0], "p2")));
    const row = find(attacked.events, "STADIUM_DISCARDED");
    if (row === undefined) throw new Error("expected the discard row");
    expect(Object.keys(row).sort()).toEqual(["seat", "type", "uid"]);
  });

  it("bought no play GATE and no registry row — the op reaches the board through attack text only", () => {
    // No printed Trainer or Ability spells this sentence, so `programPlayable` gains
    // nothing: an unknown op falls through its loop as playable, which is correct for
    // an op whose empty answer is a legal resolution.
    const abilityOrEffect = corpus().filter(([, s]) => s === BARE || s === MAY);
    expect(abilityOrEffect).toHaveLength(2);
    // …and every one of the six printings is an ATTACK, which is what makes
    // `deriveAttackEffect` the whole read site.
    expect(units(abilityOrEffect)).toBe(6);
  });
});
