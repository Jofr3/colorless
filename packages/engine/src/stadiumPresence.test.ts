import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader as readByAny,
} from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackOptionalCostBoost,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackPreDamage,
  deriveAttackRequirement,
} from "./effects";
import type { BoardCondition, GameEvent, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  STADIUM_PRESENCE_DECK,
  attachFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 🆕🆕 D378 — STADIUM PRESENCE: THE HALF OF §7.3 THAT SURVIVES REDACTION, AND THE
// RENAME NEXT DOOR THAT WAS REFUSED AGAIN.
//
// D377 handed this over with the shape question already stated, and the answer held:
// ONE new NULLARY `BoardCondition` member, `stadiumInPlay`, serving BOTH consequents
// and THREE legal printings.
//
//   Probopass  `sv10-098`              "Mountain Drop"   ({C}{C}{C}, 70+)  +70 with a Stadium out
//   Fan Rotom  `sv07-118`/`sv08.5-085` "Assault Landing" ({C}, 70)         cancels with the zone EMPTY
//
// 🛑 **THE NEAR MISS IS A MEMBER THAT ALREADY EXISTS, AND THE WHOLE FILE IS BUILT
// AROUND DRIVING THE DISAGREEMENT RATHER THAN ASSERTING IT.** `yourStadiumInPlay`
// reads §7.3 OWNERSHIP and has two live consumers whose ownership is load-bearing —
// registry `FALKNER` and the positive `CONDITIONAL_DAMAGE_CLAUSES` row *"you have a
// Stadium in play"* (Palossand `sv02-096` "Earthen Power", +80). Widening it to
// presence would make Palossand fire off the OPPONENT's Stadium, so yours→any is a
// RENAME and not a widening (D362: a widening is free only when every existing
// consumer wants the wider reading). **THE PRINTED TEXT SETTLES IT WITHOUT A
// JUDGEMENT CALL** — neither new sentence carries a possessive (*"a Stadium"*,
// *"there is no Stadium"*) where Palossand's says *"you have"*. §4 fields BOTH cards
// on ONE board with the Stadium played by P2 and reports the two answers side by
// side: Probopass +70 PRESENT, Palossand +80 ABSENT.
//
// ✅ **AND IT IS THE FIRST STADIUM MEMBER THAT DOES NOT WIDEN THE P4 GAP.** The
// union's own doc block says the online projection does NOT carry the Stadium's
// owner, which is what makes `yourStadiumInPlay` unevaluable on a remote client;
// `RedactedBoard.stadium` is a nullable CARD with no owner field, so this member is
// exactly `board.stadium !== null` on the wire. Presence survives redaction,
// ownership does not.
//
// ⚠️ **THE VACUITY MODES, NAMED BEFORE THE BUILD AND EACH DRIVEN ON A BOARD:**
//   • the arm is the ownership arm with the owner test DELETED, so an arm that kept
//     the owner test is green on every board where P1 owns the Stadium — §3 and §4
//     therefore run every reading on a board where P2 owns it, and §3 sweeps
//     seat-agreement over all three zone states;
//   • the two clause rows point at ONE member, so a row that pointed at
//     `yourStadiumInPlay` instead reads right and is wrong only on the P2 board —
//     §5's cancel case is the one that would then cancel an attack the card resolves;
//   • the requirement row's polarity is owned by the skeleton, so a row that stored
//     the NEGATION would cancel exactly when the card fires — §5 drives both.
//
// ⚠️ **AND A RECORD FOUR OTHER FILES HELD IS FALSIFIED BY THIS SLICE.**
// *"If there is no Stadium in play, this attack does nothing."* was the corpus
// sentence `sawkRequirementSplit.test.ts`, `exOnlyActive.test.ts`,
// `requirementFloor.test.ts` and `benchCountRequirement.test.ts` used as their
// UNMAPPED example — one of them on a real board, through `fix-sawk`'s index-2
// printed effect. Every one is re-pointed at the sentence that is STILL unmapped
// rather than deleted (D178: provenance is annotated, never overwritten).
//
// WHAT SHIPS: **1 new NULLARY `BoardCondition` member**, its **2** reader arms, **1**
// literal `CONDITIONAL_DAMAGE_CLAUSES` row and **1** `ATTACK_REQUIREMENT_CLAUSES`
// row. Zero new maps, templates, patterns, ops, events or `packages/schema` bytes.
// `MATCH_RECORD_VERSION` stays 22 — the member is nullary and `state.stadium` has
// been in the persisted record since M4 with its shape untouched.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The two consequent skeletons, as labelled COPIES — the readers' own patterns are
    module-private. Whole-sentence anchored at BOTH ends, like theirs. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;
const NOTHING = /^If (.+), this attack does nothing\.$/;

/** ~~The TEN live readers, run as one — the same set `censusAtHead.test.ts` uses.~~

    🛑 **D382 ADDED THE TENTH, AND THE OMISSION WAS A REFUSAL CLAIM THAT HAD
    STOPPED BEING TRUE.** `deriveAttackOptionalCostBoost` shipped at D381 and
    claimed Cetitan ex's *"You may discard a Stadium in play. If you do, …"* — a
    sentence this file's `DISCARD_OP` list asserts is REFUSED. With the reader
    missing from this array the assertion stayed green while being false, which is
    the exact shape D211/D379 name: **a refusal guard whose instrument cannot see
    the reader that expired it reads green for the wrong reason.** The list below is
    re-partitioned in the same commit.

    🛑🛑 🆕🆕 **D418 — READ THE PARAGRAPH ABOVE AGAIN, THEN NOTE THAT IT HAPPENED
    AGAIN, TO THIS FILE, IN THE SAME LIST, TO THE SAME NEIGHBOURING SENTENCE.** D403
    added an eleventh reader and D417 a twelfth (`deriveAttackCancelRequirement`,
    built for Eternatus `sv08-141`'s *"Discard a Stadium in play. If you can't, …"*
    — **the one remaining entry of `DISCARD_OP`**). This array was never widened, so
    §1's ceiling rung and §6's first rung went on asserting that sentence REFUSED
    while a live reader claimed it. The header count is struck: the list read TEN,
    then ELEVEN, and the module reached TWELVE.

    ⚠️ **D382 FIXED THE SYMPTOM AND THIS IS WHAT THAT COSTS.** Widening a copy buys
    correctness until the next reader ships; nothing checks a copy, so the next
    reader always wins. D418 therefore stops the FIGURES depending on the copy:
    every `readByAny` call below is `censusAttackCorpus.ts`'s module-derived
    predicate, and this array survives only as the DECLARED EXPECTATION §1's first
    rung compares against the module — a comparison that names the drifting reader
    instead of going quiet. */
const READERS: readonly ((text: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  // 🆕🆕 D428 — THE THIRTEENTH, the PRE-DAMAGE Tool discard.
  // 🛑 **SPLICED HERE, ABOVE THE LAST THREE ENTRIES, FOR THE REASON THE BLOCK BELOW
  // ALREADY SPELLS OUT — AND THE FIRST DRAFT GOT IT WRONG AND `precheck` SAID SO.**
  // This slice's bulk edit put it between `deriveAttackOptionalCostBoost` and
  // `deriveAttackDiscardScaledBoost`, which broke
  // `D382-refusal-instrument-loses-the-tenth-reader`'s three-line anchor without a
  // character of the quoted lines changing — `find occurs 0×`, exactly the adjacency
  // rot D403 and D418 each paid once. **`precheck` costs seconds and a whole-corpus
  // sweep costs ninety minutes** (D414). §1's first rung sorts by NAME, so position
  // here carries no meaning of its own.
  deriveAttackPreDamage,
  // 🆕🆕 D418 — the TWELFTH (D417), the reader built for `DISCARD_OP`'s own sentence.
  // ⚠️ **IT IS SPLICED IN HERE RATHER THAN APPENDED, AND THAT IS NOT COSMETIC.**
  // `mutants.ts`'s `D382-refusal-instrument-loses-the-tenth-reader` anchors on the
  // LAST THREE ENTRIES OF THIS ARRAY FOLLOWED BY `];`; appending would have moved
  // `];` and broken that anchor without a character of the quoted lines changing —
  // the adjacency class the mutation brief's rule 12 names, and the same rot D403
  // had to re-transcribe that row for. §1's first rung sorts by NAME, so position
  // here carries no meaning of its own.
  deriveAttackCancelRequirement,
  deriveAttackBonusConsequent,
  deriveAttackOptionalCostBoost,
  deriveAttackDiscardScaledBoost,
];

/** THE TWO SENTENCES THIS SLICE BUYS, byte-for-byte from the committed corpus. */
const MOUNTAIN_DROP = "If a Stadium is in play, this attack does 70 more damage.";
const ASSAULT_LANDING = "If there is no Stadium in play, this attack does nothing.";
/** The OWNERSHIP sentence one row up in the same table — the near miss, and the
    control every board in §4 is measured against. */
const EARTHEN_POWER = "If you have a Stadium in play, this attack does 80 more damage.";

const PRESENCE_CLAUSE = "a Stadium is in play";
const NO_PRESENCE_CLAUSE = "there is no Stadium in play";
const OWNERSHIP_CLAUSE = "you have a Stadium in play";

const PRESENT: BoardCondition = { kind: "stadiumInPlay" };
const OWNED: BoardCondition = { kind: "yourStadiumInPlay" };

/** THE CEILING, PRICED FROM THE CORPUS AND LEFT. Both read the same board fact and
    both carry a TAIL that needs a Stadium-DISCARD op this engine does not have. */
const CEILING = [
  "If a Stadium is in play, this attack also does 30 damage to each of your opponent's Benched Pokémon, and discard that Stadium. (Don't apply Weakness and Resistance for Benched Pokémon.)",
] as const;
/** …and the op itself, which is a BIGGER slice than the floor this one took.

    🛑 **THE HANDOFF PRICED THIS AT 8 PRINTINGS AND IT IS 9.** It enumerated
    *"Discard a Stadium in play."* (4), *"You may discard a Stadium in play."* (2) and
    the *"If you do, …140 more damage"* spelling (2), and did not see the FOURTH
    sentence — *"Discard a Stadium in play. If you can't, this attack does nothing."*
    (Eternatus `sv08-141` "World Ender", 1 printing), which is the same op under the
    CANCEL consequent. **THE SAME MISS D377 RECORDED, ONE FAMILY OVER: A CENSUS RUN
    FOR ONE CONSEQUENT IS A FLOOR FOR THE OTHER.**

    ⚠️⚠️ 🆕🆕 **D380 BUILT THE OP AND THIS LIST HAS BEEN SPLIT IN TWO, NOT DELETED.**
    The prediction above was exactly right about the mechanism and exactly right
    about the count; what it could not know is that the four sentences would be
    taken in TWO pieces. `TAKEN_BY_D380` holds the two BARE spellings — 6 of the 9
    printings, on one field-free `EffectOp` — and `DISCARD_OP` keeps the two the op
    alone cannot reach: each needs a READER this file's slice did not buy either (a
    trailing anaphoric requirement split, and `OPTIONAL_DAMAGE_BOOST` with its two
    halves swapped). **THE CEILING WAS PRICED RIGHT AND CLIMBED IN TWO STEPS, WHICH
    IS WHAT A PRICE IS FOR** (D178: annotate provenance, never overwrite it). */
const TAKEN_BY_D380 = [
  "Discard a Stadium in play.",
  "You may discard a Stadium in play.",
] as const;
/** 🛑🛑 🆕🆕 **D418 — THIS LIST IS NOW EMPTY, AND ITS LAST ENTRY LEFT AT D417.**
    Eternatus `sv08-141`'s *"Discard a Stadium in play. If you can't, this attack does
    nothing."* moved to `TAKEN_SINCE`: `deriveAttackCancelRequirement` is the trailing
    anaphoric split this list named as the missing mechanism, built exactly as priced.
    ⚠️ **THE CEILING THIS FILE PRICED AT NINE PRINTINGS IS THEREFORE FULLY CLIMBED**,
    in FIVE steps, and every step after the first cost no new op at all — which is the
    strongest form of the claim the block above makes about what a price is for.

    The list is kept at zero rather than deleted: §1's partition still names it, and an
    EMPTY refusal list that is asserted empty says something a deleted one cannot. */
const DISCARD_OP = [] as readonly string[];

/** 🆕🆕 D382 — THE ROWS THAT LEFT THE TWO LISTS ABOVE, kept rather than deleted
    (D178: annotate provenance, never overwrite it) and ASSERTED RESOLVED below, so
    neither rung can go green by a successor quietly shortening a refusal list.

    * Cetitan ex `sv10-065`/`sv10-210` (**2** printings) left `DISCARD_OP` at **D381**
      — `deriveAttackOptionalCostBoost`, the tenth reader. ⚠️ **THIS FILE DID NOT
      NOTICE FOR A WHOLE SLICE**, because its `READERS` array had nine entries; that
      is the omission the doc block above records.
    * Chi-Yu `sv06-039` (**1** printing) left `CEILING` at **D382** — D317's
      assembler reached through a widened JOIN, on zero new readers and zero new ops.

    Both spend D378's `stadiumInPlay` and D380's `discardStadium`, which is the whole
    point of the ceiling this file priced: **it was climbed in FOUR steps, and every
    step after the first cost no new mechanism at all.** */
const TAKEN_SINCE = [
  "You may discard a Stadium in play. If you do, this attack does 140 more damage.",
  "If a Stadium is in play, this attack does 60 more damage. Then, discard that Stadium.",
  // 🆕🆕 **D417** — Eternatus `sv08-141` "World Ender" (**1** printing) left
  // `DISCARD_OP`, through `deriveAttackCancelRequirement`. ⚠️ **AND THIS FILE DID NOT
  // NOTICE, FOR THE SECOND TIME AND FOR THE IDENTICAL REASON** — the `READERS` array
  // above was eleven entries against a twelve-reader module — which is why D418 stops
  // computing these figures from an array at all rather than widening one again.
  "Discard a Stadium in play. If you can't, this attack does nothing.",
] as const;

// ── boards ─────────────────────────────────────────────────────────────────────

/** Put a Beach Court (`sv01-167`) into `seat`'s hand and play it — the shared §7.3
    zone then carries `owner: seat`, which is the ONLY thing the two members read
    differently. */
function playStadium(state: GameState, seat: Seat): GameState {
  const withCard = handFromDeck(state, seat, "sv01-167", 1);
  const uid = handUid(withCard, seat, "sv01-167");
  return mustApply(withCard, { type: "playTrainer", seat, uid }).state;
}

/** Setup, then P1's turn 2 (P2 went first and passed) — P1's first unrestricted turn,
    so the attack step is legal (§4) — with BOTH Active spots pinned to a neutral
    200 HP `fix-bigbody`. `owner` says who, if anyone, played the one Stadium: P2 has
    to play it on its OWN turn, which is why the choice is made here and not by a
    caller reaching in afterwards. */
function board(seed: number, owner: Seat | null = null): GameState {
  let state = driveSetup(
    seed,
    { p1: STADIUM_PRESENCE_DECK, p2: STADIUM_PRESENCE_DECK },
    { first: "p2" },
  );
  if (owner === "p2") state = playStadium(state, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  if (owner === "p1") state = playStadium(state, "p1");
  state = setActiveFromDeck(state, "p1", "fix-bigbody");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  return state;
}

/** `board`, handed over to P2. The member is seat-INDEPENDENT on its face, and a
    P1-only suite cannot tell "reads the zone" apart from "reads p1's Stadium" — so
    every board reading is taken from the far seat too. */
function boardP2(seed: number, owner: Seat | null = null): GameState {
  return mustApply(board(seed, owner), { type: "endTurn", seat: "p1" }).state;
}

/** Field `cardId` in `seat`'s Active Spot and pay `spec` onto it symbol-for-symbol.
    Must run in that order: `attachFromDeck` attaches to whatever is Active. */
function fielded(
  state: GameState,
  seat: Seat,
  cardId: string,
  spec: readonly (readonly [string, number])[],
): GameState {
  let next = setActiveFromDeck(state, seat, cardId);
  for (const [id, count] of spec) next = attachFromDeck(next, seat, id, count);
  return next;
}

/** Probopass's body, paid `{C}{C}{C}`. */
const mountainDrop = (state: GameState, seat: Seat = "p1"): GameState =>
  fielded(state, seat, "fix-mountaindrop", [["fix-energy", 3]]);

/** Fan Rotom's body, paid `{C}`. */
const assaultLanding = (state: GameState, seat: Seat = "p1"): GameState =>
  fielded(state, seat, "fix-assaultland", [["fix-energy", 1]]);

/** Palossand's body, paid `{P}{C}{C}` — the OWNERSHIP control. */
const earthenPower = (state: GameState, seat: Seat = "p1"): GameState =>
  fielded(state, seat, "sv02-096", [
    ["fix-psychic-energy", 1],
    ["fix-energy", 2],
  ]);

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

describe("§1 — the price, RE-DERIVED: a 2:3 step whose CANCEL half is the bigger half", () => {
  it("🆕🆕 D418 — the hand-kept READERS list IS the module's reader surface", () => {
    // 🛑 THE GUARD THIS FILE NEVER HAD, IN D417's SHAPE. D382 widened this array by
    // hand after a refusal rung went green and false; nothing was added to CHECK it,
    // so D403's and D417's readers walked past the same door and the same rung went
    // green and false a second time. **A COPY THAT IS CORRECTED BUT NOT CHECKED IS A
    // COPY THAT WILL DRIFT AGAIN**, and this is the rung that says so out loud.
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    // ⚠️ THE COUNT IS PINNED SEPARATELY FROM THE DIFF, because the diff alone stays
    // GREEN when a reader leaves the module and this list in the same commit — and
    // every figure in §1 would then move with nothing naming the cause.
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("🛑 the bonus residue steps by exactly ONE sentence and ONE printing", () => {
    // D377 left the residue at 22 records / 26 printings. Both figures are re-derived
    // here off the same instrument — the nine live readers over `legalAttackCorpus()`
    // — rather than quoted.
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !readByAny(s));
    // The DEPARTURE and the SIZE are asserted separately: a guard that only checked
    // 21 / 25 could not tell "the row landed" from "a reader broke".
    expect(refused.some(([, s]) => s === MOUNTAIN_DROP)).toBe(false);
    // 🆕🆕 D384 — 21 / 25 -> 20 / 24: the STRICT-INEQUALITY TWIN left this residue —
    // ONE sentence at ONE printing (Swalot `sv07-092` "Devouring Mouth", +160) — and
    // it is the family's FIRST 1:1 step, re-derived live rather than decremented.
    // ⚠️ AND IT IS THE SENTENCE D372 PRICED AND REFUSED: the same two Active bodies as
    // `activeEnergyCountsEqual`, under `>` instead of `===`, on a SECOND nullary member.
    // 🆕🆕 D386 — 20 / 24 -> 19 / 22: the HEALED-THIS-TURN clause left this residue —
    // ONE sentence at TWO printings (Maractus `sv10.5b-008`/`-093` "Lively Needles",
    // +100) — re-derived live rather than decremented. 🛑 AND IT EMPTIES THE 2-PRINTING
    // BAND: it was the last clause in it, so every band rung below is re-aimed off the
    // WHOLE distribution rather than off a list that can no longer be non-empty (D379).
    // 🆕🆕 D387 — 19 / 22 -> **18 / 21**: the STAGE 1 clause left this residue — ONE
    // sentence at ONE printing (Paldean Tauros `sv08-018` "Spirited Tackle", +90) —
    // re-derived live rather than decremented. 🛑 THE 2-PRINTING BAND STAYS EMPTY and
    // the distribution goes `{1: 17, 5: 1}` -> `{1: 16, 5: 1}`, so every band rung is
    // still aimed at the WHOLE distribution and its refusal still comes from OUTSIDE
    // the emptied band (D379).
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
    expect(refused.length).toBe(5); // 🆕🆕 D436 -2 sentences (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D398 — 8 -> 7, the DECK-SIZE READ, and the LAST buildable sentence in this residue
    expect(units(refused)).toBe(5); // 🆕🆕 D436 -5 printings (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D398 — 11 -> 10, the DECK-SIZE READ's one printing
    // 🛑 EVERY EARLIER HEAD IS RE-DERIVED FROM THIS ONE rather than frozen: D377's
    // 22/26, D376's 24/28, D375's 25/30, D374's 26/32, D373's 27/34.
    // 🆕🆕 D392 — the OFFSET gains one on each axis: the head moved, this one's did not.
    expect([refused.length + 17, units(refused) + 21]).toEqual([22, 26]);
    // 🆕🆕 D392 — the OFFSET gains one on each axis: the head moved, this one's did not.
    expect([refused.length + 19, units(refused) + 23]).toEqual([24, 28]);
    // 🆕🆕 D392 — the OFFSET gains one on each axis: the head moved, this one's did not.
    expect([refused.length + 20, units(refused) + 25]).toEqual([25, 30]);
    expect([refused.length + 21, units(refused) + 27]).toEqual([26, 32]);
    expect([refused.length + 22, units(refused) + 29]).toEqual([27, 34]);
  });

  it("🛑 the CANCEL residue steps TWICE as far — and D379 took the ONE left behind it", () => {
    // The half that makes D378 worth more than its bonus row. D377 left the
    // does-nothing remainder at 2 sentences / 4 printings; D378 took the bigger of the
    // two and NAMED the last one as still owed.
    //
    // ⚠️ 🆕🆕 **D379 TOOK IT, SO THIS RUNG IS RE-AIMED AT THE STEP RATHER THAN THE
    // REMAINDER.** The residue is now ZERO and there is no sentence to name; what this
    // file still owns is that `ASSAULT_LANDING` is not in it and that D378's own step
    // was 2 s / 4 p -> 1 s / 2 p. Both are re-derived from the live head below rather
    // than frozen — D379's own `exactHandSize.test.ts` §1 is where the zero is
    // asserted as a figure.
    const refused = corpus().filter(([, s]) => NOTHING.test(s.trim()) && !readByAny(s));
    expect(refused.some(([, s]) => s === ASSAULT_LANDING)).toBe(false);
    expect(refused).toEqual([]);
    expect([refused.length + 1, units(refused) + 2]).toEqual([1, 2]);
    expect([refused.length + 2, units(refused) + 4]).toEqual([2, 4]);
  });

  it("🛑 TWO sentences, THREE legal printings — 1 under the bonus and 2 under the cancel", () => {
    const bonusRows = corpus().filter(([, s]) => s === MOUNTAIN_DROP);
    expect(bonusRows).toHaveLength(1);
    expect(units(bonusRows)).toBe(1);
    const cancelRows = corpus().filter(([, s]) => s === ASSAULT_LANDING);
    expect(cancelRows).toHaveLength(1);
    expect(units(cancelRows)).toBe(2);
    // 🛑 AND THE CANCEL HALF IS THE BIGGER HALF, WHICH IS A FIRST. D363's Sawk,
    // D365's Iron Boulder and D377's Centiskorch each put a member in both tables
    // with the BONUS consequent carrying the weight; here it is 1 against 2.
    expect(units(cancelRows)).toBeGreaterThan(units(bonusRows));
    expect(units(bonusRows) + units(cancelRows)).toBe(3);
    // …and no second sentence carries either clause under a different amount, so the
    // bonus row cannot be short and cannot rot on a reprint at a new N.
    expect(corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === PRESENCE_CLAUSE)).toHaveLength(
      1,
    );
    expect(
      corpus().filter(([, s]) => NOTHING.exec(s.trim())?.[1] === NO_PRESENCE_CLAUSE),
    ).toHaveLength(1);
    // ⚠️ THE IDS ARE NOT READ FROM THE CATALOG — D369's constraint, unchanged: this
    // container has no D1 credentials and no local sqlite copy. Probopass `sv10-098`
    // and Fan Rotom `sv07-118`/`sv08.5-085` are recorded in the member's doc block
    // from a WEB lookup confirmed by id against tcgdex, and nothing on this path needs
    // an id: a literal row is keyed on the printed clause and serves every printing.
  });

  it("🛑 the requirement table's reach goes 7 s / 14 p → 8 s / 16 p, and D379 SATURATED it", () => {
    // The accounting `splitOrder.test.ts` §4 keeps. The whole does-nothing OPENER
    // population is unmoved — this slice mapped one of them, it did not print one.
    // ⚠️ 🆕🆕 D379 mapped the LAST one, so the reach is now 9 / 18 and what this file
    // still owns is that `ASSAULT_LANDING` is inside the mapped set.
    const openers = corpus().filter(([, s]) => /^If .+?, this attack does nothing\./.test(s));
    expect([openers.length, units(openers)]).toEqual([9, 18]);
    const mapped = openers.filter(([, s]) => deriveAttackRequirement(s) !== null);
    expect([mapped.length, units(mapped)]).toEqual([9, 18]);
    expect(mapped.some(([, s]) => s === ASSAULT_LANDING)).toBe(true);
    const unmapped = openers.filter(([, s]) => deriveAttackRequirement(s) === null);
    expect([unmapped.length, units(unmapped)]).toEqual([0, 0]);
    // The parts sum, which is what makes a partition a partition.
    expect(mapped.length + unmapped.length).toBe(openers.length);
    expect(units(mapped) + units(unmapped)).toBe(units(openers));
  });

  it("🛑 THE CEILING IS PRICED AND LEFT — 'discard that Stadium' is a WHOLE OP at 8 printings", () => {
    // The handoff's warning, measured rather than repeated: do not let the ceiling eat
    // the floor. Two more legal sentences read THIS board fact and both carry a tail…
    for (const sentence of CEILING) {
      const rows = corpus().filter(([, s]) => s === sentence);
      expect(rows, sentence).toHaveLength(1);
      expect(units(rows), sentence).toBe(1);
      // …and both are STILL refused by every reader, which is what makes them a
      // separate slice rather than a thing this one half-did.
      expect(readByAny(sentence), sentence).toBe(false);
    }
    // The op they need was worth more on its own than this whole slice: four
    // sentences, NINE legal printings, none of them read at D378 — and the handoff
    // said eight, having counted the family under one consequent only.
    // 🆕🆕 **D380 TOOK 6 OF THE 9.** The two BARE spellings now RESOLVE, and the
    // partition below is what keeps that a measured step rather than a deletion:
    // the family is still 4 sentences / 9 printings and the two lists still sum to it.
    const builtRows = corpus().filter(([, s]) => (TAKEN_BY_D380 as readonly string[]).includes(s));
    expect([builtRows.length, units(builtRows)]).toEqual([2, 6]);
    for (const [, s] of builtRows) expect(readByAny(s), s).toBe(true);
    const opRows = corpus().filter(([, s]) => (DISCARD_OP as readonly string[]).includes(s));
    // 🆕🆕 D381/D382 — 2 sentences / 3 printings became **1 / 1**: Cetitan ex's two
    // printings left through the tenth reader. The family total is unchanged, which
    // is what keeps this a measured step rather than a deletion.
    // 🛑🛑 🆕🆕 **D418 — 1 / 1 became ZERO at D417, AND THE LOOP BELOW WAS ASSERTING
    // THE OPPOSITE.** `deriveAttackCancelRequirement` claimed Eternatus's sentence a
    // whole slice ago; this file's eleven-entry `READERS` array could not see it, so
    // `expect(readByAny(s)).toBe(false)` ran over that row and passed. ⚠️ **THE ROW IS
    // NOT DELETED — IT IS MOVED TO `TAKEN_SINCE` AND ASSERTED RESOLVED**, which is the
    // only shape in which "the ceiling was climbed" stays falsifiable (D379's
    // saturation trap, and the same handling D381/D382 gave Cetitan).
    expect(opRows).toHaveLength(0);
    expect(units(opRows)).toBe(0);
    const sinceRows = corpus().filter(([, s]) => (TAKEN_SINCE as readonly string[]).includes(s));
    // 🆕🆕 D418 — 2 / 3 -> **3 / 4**: exactly what `opRows` lost, which is what makes
    // this a re-partition rather than a deletion.
    expect([sinceRows.length, units(sinceRows)]).toEqual([3, 4]);
    // …and the family total is UNMOVED at 4 / 9. The two rows that left `DISCARD_OP`
    // are the `TAKEN_SINCE` entries still inside the DISCARD family — Chi-Yu's is a
    // `discard that Stadium` CEILING row, not one of these four — so the addend is
    // DERIVED here rather than written as the literal it used to be.
    const sinceDiscardFamily = sinceRows.filter(([, s]) => /iscard a Stadium in play/.test(s));
    expect([sinceDiscardFamily.length, units(sinceDiscardFamily)]).toEqual([2, 3]);
    expect([
      builtRows.length + opRows.length + sinceDiscardFamily.length,
      units(builtRows) + units(opRows) + units(sinceDiscardFamily),
    ]).toEqual([4, 9]);
    for (const [, s] of opRows) expect(readByAny(s), s).toBe(false);
    for (const [, s] of sinceRows) expect(readByAny(s), s).toBe(true);
    // 🛑 AND THE CENSUS WAS ASKED FOR THE WORD, NOT THE PHRASE (D310/D311, D377).
    // Every legal attack sentence carrying "Stadium" at all is exactly nine, and the
    // partition below accounts for all of them — so nothing in this family is hiding
    // behind a spelling this slice did not think to try.
    const anyStadium = corpus().filter(([, s]) => s.includes("Stadium"));
    expect(anyStadium).toHaveLength(9);
    const taken = anyStadium.filter(([, s]) => s === MOUNTAIN_DROP || s === ASSAULT_LANDING);
    const searchRow = anyStadium.filter(([, s]) =>
      s.startsWith("Search your deck for a Stadium card"),
    );
    expect(taken).toHaveLength(2);
    expect(searchRow).toHaveLength(1);
    expect(
      taken.length +
        searchRow.length +
        CEILING.length +
        DISCARD_OP.length +
        TAKEN_BY_D380.length +
        TAKEN_SINCE.length,
    ).toBe(anyStadium.length);
    // …and there is no lower-case spelling to have missed: the catalog capitalises the
    // noun everywhere, so a case-insensitive census would return the identical nine.
    expect(corpus().filter(([, s]) => /stadium/i.test(s))).toHaveLength(anyStadium.length);
  });
});

describe("§2 — the two keys, the printed BYTES, and two tables that must not meet", () => {
  it("maps the printed BONUS sentence onto the new member at the printed amount", () => {
    expect(deriveAttackDamageBonus(MOUNTAIN_DROP)).toEqual({
      per: 70,
      count: { kind: "boardCondition", cond: { kind: "stadiumInPlay" } },
    });
  });

  it("maps the printed NEGATION onto the POSITIVE member — the skeleton owns the 'no'", () => {
    // `ATTACK_REQUIREMENT_CLAUSES`' polarity rule: the row hands back the POSITIVE
    // fact and `attack.ts` cancels when it does NOT hold. So the printed *"there is
    // no"* costs no `{ kind: "not" }` and no second member.
    expect(deriveAttackRequirement(ASSAULT_LANDING)).toEqual({ kind: "stadiumInPlay" });
    // …and it is the SAME member the bonus row returns, not a look-alike.
    const bonus = deriveAttackDamageBonus(MOUNTAIN_DROP);
    expect(deriveAttackRequirement(ASSAULT_LANDING)).toEqual(
      bonus?.count.kind === "boardCondition" ? bonus.count.cond : null,
    );
  });

  it("🛑 the OWNERSHIP sentence still maps to the OWNERSHIP member — the row was not re-pointed", () => {
    // The half of "this is not a rename" that lives in the tables. Palossand's printed
    // sentence must keep answering `yourStadiumInPlay`; if a successor "simplifies"
    // the two rows into one, this is the assertion that reddens.
    expect(deriveAttackDamageBonus(EARTHEN_POWER)).toEqual({
      per: 80,
      count: { kind: "boardCondition", cond: { kind: "yourStadiumInPlay" } },
    });
    expect(deriveAttackDamageBonus(EARTHEN_POWER)).not.toEqual(
      deriveAttackDamageBonus(MOUNTAIN_DROP),
    );
  });

  it("🛑 the KEYS are the printed bytes, pinned by CODE-POINT COUNT", () => {
    // D183's defect is an arm authored from a PARAPHRASE, and the count is what
    // catches a transcription that reads right and is not the printed sentence.
    expect(MOUNTAIN_DROP).toHaveLength(57);
    expect(ASSAULT_LANDING).toHaveLength(57);
    expect(PRESENCE_CLAUSE).toHaveLength(20);
    expect(NO_PRESENCE_CLAUSE).toHaveLength(27);
    expect(BONUS.exec(MOUNTAIN_DROP)?.[1]).toBe(PRESENCE_CLAUSE);
    expect(NOTHING.exec(ASSAULT_LANDING)?.[1]).toBe(NO_PRESENCE_CLAUSE);
    // ⚠️ NEITHER KEY CARRIES AN APOSTROPHE OR A é, WHICH IS UNUSUAL IN BOTH TABLES —
    // so D137's U+2019 fold and D154's é check are INERT on this pair. Stated rather
    // than left to be rediscovered: a successor looking for the fold's effect here
    // will not find one, and that is correct.
    for (const key of [PRESENCE_CLAUSE, NO_PRESENCE_CLAUSE]) {
      expect(key, key).not.toContain("'");
      expect(key, key).not.toContain("’");
      expect(key, key).not.toContain("é");
    }
    // …and the OWNERSHIP key is the one that carries the possessive VERB rather than
    // an apostrophe, which is exactly the byte-level difference the whole slice turns
    // on: "you have a Stadium" against "a Stadium".
    expect(OWNERSHIP_CLAUSE).toHaveLength(26);
    expect(OWNERSHIP_CLAUSE.endsWith(PRESENCE_CLAUSE.replace(" is in play", ""))).toBe(false);
    expect(OWNERSHIP_CLAUSE).toContain("Stadium in play");
    expect(PRESENCE_CLAUSE).not.toContain("you");
    expect(NO_PRESENCE_CLAUSE).not.toContain("you");
  });

  it("🛑 the two TABLES cannot reach each other — D125's disjointness, both directions", () => {
    // A clause meaning "the attack does N more damage if X" must never be reachable
    // from a sentence meaning "the attack does nothing if X", and vice versa. This is
    // the fourth member to sit in both tables and the first whose two keys are not
    // one word apart, so the crossing is spelled out on all four combinations.
    expect(deriveAttackRequirement(`If ${PRESENCE_CLAUSE}, this attack does nothing.`)).toBeNull();
    expect(
      deriveAttackDamageBonus(`If ${NO_PRESENCE_CLAUSE}, this attack does 70 more damage.`),
    ).toBeNull();
    expect(deriveAttackRequirement(`If ${OWNERSHIP_CLAUSE}, this attack does nothing.`)).toBeNull();
    expect(deriveAttackDamageBonus(MOUNTAIN_DROP)).not.toBeNull();
    expect(deriveAttackRequirement(ASSAULT_LANDING)).not.toBeNull();
  });

  it("🛑 refuses five constructed rewrites the catalog does not print", () => {
    // Every one of these reads like the printed sentence and is not it. A substring or
    // fuzzy lookup would take at least three.
    for (const clause of [
      "a Stadium card is in play",
      "there is a Stadium in play",
      "a Stadium is in play for either player",
      "your opponent has a Stadium in play",
      "there is no Stadium card in play",
    ]) {
      expect(deriveAttackDamageBonus(`If ${clause}, this attack does 70 more damage.`), clause).toBe(
        null,
      );
      expect(deriveAttackRequirement(`If ${clause}, this attack does nothing.`), clause).toBeNull();
    }
  });

  it("the reject fragment is the printed clause verbatim — nothing to re-seat", () => {
    // `conditionNote` is player-facing on both paths (the engine's reject pill and the
    // greyed HUD row's tooltip). Most arms drop a pronoun or re-voice a noun phrase
    // (D116, D296); this one needs neither, because the sentence never says "you".
    expect(conditionNote(PRESENT)).toBe(PRESENCE_CLAUSE);
    expect(conditionNote(OWNED)).toBe(OWNERSHIP_CLAUSE);
    expect(conditionNote(PRESENT)).not.toBe(conditionNote(OWNED));
  });
});

describe("§3 — PRESENCE vs OWNERSHIP on the shared zone, read from BOTH seats", () => {
  it("an EMPTY zone is false for both members and both seats", () => {
    const empty = board(70);
    expect(empty.stadium).toBeNull();
    for (const seat of ["p1", "p2"] as const) {
      expect(conditionHolds(empty, seat, PRESENT), seat).toBe(false);
      expect(conditionHolds(empty, seat, OWNED), seat).toBe(false);
    }
  });

  it("🛑 with the OPPONENT's Stadium out the two members DISAGREE — the board this slice exists for", () => {
    const p2Owns = board(71, "p2");
    expect(p2Owns.stadium?.owner).toBe("p2");
    // Presence is TRUE for the seat that does not own it…
    expect(conditionHolds(p2Owns, "p1", PRESENT)).toBe(true);
    // …and ownership is FALSE for that same seat on that same state. One `toBe` apart,
    // and an arm that kept the owner test answers `false` on the line above.
    expect(conditionHolds(p2Owns, "p1", OWNED)).toBe(false);
    expect(conditionHolds(p2Owns, "p1", PRESENT)).not.toBe(conditionHolds(p2Owns, "p1", OWNED));
  });

  it("🛑 PRESENCE is SEAT-INDEPENDENT and OWNERSHIP is not — swept over all three zone states", () => {
    // §7.3's zone is a shared singleton, so two seats can disagree about WHOSE it is
    // and never about whether one is there. This is the first member in the union
    // whose answer does not depend on `seat`, and the sweep is what says so.
    const boards: readonly (readonly [string, GameState])[] = [
      ["empty", board(72)],
      ["p1 owns", board(73, "p1")],
      ["p2 owns", board(74, "p2")],
    ];
    let disagreements = 0;
    for (const [label, state] of boards) {
      expect(conditionHolds(state, "p1", PRESENT), label).toBe(conditionHolds(state, "p2", PRESENT));
      expect(conditionHolds(state, "p1", PRESENT), label).toBe(state.stadium !== null);
      if (conditionHolds(state, "p1", OWNED) !== conditionHolds(state, "p2", OWNED)) {
        disagreements += 1;
      }
    }
    // 🛑 THE COUNT IS WHAT STOPS THE SWEEP BEING VACUOUS: the ownership member
    // disagrees across seats on exactly the two OCCUPIED boards, so "presence agrees"
    // is a fact about presence and not about a suite that never filled the zone.
    expect(disagreements).toBe(2);
  });

  it("🛑 the ownership member's own reading is unchanged — Falkner's fact still holds", () => {
    // The regression this slice's whole shape argument rests on. If `yourStadiumInPlay`
    // had been widened, this is the line that would have gone green-for-the-wrong-reason
    // rather than red — so it is asserted in BOTH directions on BOTH owners.
    const p1Owns = board(75, "p1");
    expect(conditionHolds(p1Owns, "p1", OWNED)).toBe(true);
    expect(conditionHolds(p1Owns, "p2", OWNED)).toBe(false);
    const p2Owns = board(76, "p2");
    expect(conditionHolds(p2Owns, "p2", OWNED)).toBe(true);
    expect(conditionHolds(p2Owns, "p1", OWNED)).toBe(false);
  });
});

describe("§4 — the BONUS consequent on a board: 70 → 140, with Palossand as the control", () => {
  it("with an EMPTY zone the printed 70 stands — and nothing is flagged", () => {
    const state = mountainDrop(board(77));
    expect(state.stadium).toBeNull();
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // `effectSimulated` / `modifierSimulated` ride `scaling !== null`, not on the
    // clause holding, so a false clause is still a SIMULATED outcome.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 70, dealt: 70 });
    // `scaled` is omitted at 0 — the clause genuinely added nothing.
    expect(dealt?.scaled).toBeUndefined();
  });

  it("adds the whole printed 70 off the ATTACKER's own Stadium", () => {
    const { events } = mustApply(mountainDrop(board(78, "p1")), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 70, scaled: 70, dealt: 140 });
  });

  it("🛑 adds it off the OPPONENT's Stadium too — and Palossand's +80 does NOT, on the same board", () => {
    // THE CASE THE WHOLE SLICE IS ABOUT. One state, one Stadium, played by P2; two
    // cards whose printed sentences differ by the words "you have"; two different
    // answers. A member re-pointed at ownership scores 70 here, and a Palossand
    // re-pointed at presence scores 160 on the line below.
    const base = board(79, "p2");
    expect(base.stadium?.owner).toBe("p2");
    const boosted = mustApply(mountainDrop(base), { type: "attack", seat: "p1", index: 0 });
    expect(find(boosted.events, "DAMAGE_DEALT")).toMatchObject({
      base: 70,
      scaled: 70,
      dealt: 140,
    });
    const control = mustApply(earthenPower(base), { type: "attack", seat: "p1", index: 1 });
    const controlHit = find(control.events, "DAMAGE_DEALT");
    expect(controlHit).toMatchObject({ base: 80, dealt: 80 });
    expect(controlHit?.scaled).toBeUndefined();
    // Neither is flagged: both sentences are read, they just answer differently.
    expect(types(boosted.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(control.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("scores the same from the FAR SEAT — the reading is not p1's", () => {
    const { events } = mustApply(mountainDrop(boardP2(80, "p1"), "p2"), {
      type: "attack",
      seat: "p2",
      index: 0,
    });
    // P1 owns the Stadium and P2 is attacking, so this is the mirror of the case
    // above: presence holds, and it holds for the seat that did not play it.
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 70, scaled: 70, dealt: 140 });
  });
});

describe("§5 — the CANCEL consequent on a board: the zone is the gate", () => {
  it("🛑 CANCELS with an EMPTY zone, and the turn still ends", () => {
    const state = assaultLanding(board(81));
    expect(state.stadium).toBeNull();
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).toContain("ATTACK_FAILED");
    expect(find(events, "ATTACK_FAILED")).toMatchObject({ reason: "requirement" });
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    // 🛑 AND NOTHING IS FLAGGED: the printed sentence is accounted for, so the cancel
    // is a SIMULATED outcome and not an unread one.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("RESOLVES off the attacker's own Stadium — the polarity, the right way round", () => {
    const { events } = mustApply(assaultLanding(board(82, "p1")), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(events)).not.toContain("ATTACK_FAILED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 70, dealt: 70 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 RESOLVES off the OPPONENT's Stadium — the attack a `yourStadiumInPlay` row would have CANCELLED", () => {
    // The mutant this file exists to kill, driven as a board rather than described:
    // a requirement row pointed at the ownership member reads right and cancels an
    // attack the printed card resolves.
    const base = board(83, "p2");
    expect(base.stadium?.owner).toBe("p2");
    expect(conditionHolds(base, "p1", OWNED)).toBe(false);
    const { events } = mustApply(assaultLanding(base), { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_FAILED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 70, dealt: 70 });
  });

  it("cancels and resolves identically from the FAR SEAT", () => {
    const empty = mustApply(assaultLanding(boardP2(84), "p2"), {
      type: "attack",
      seat: "p2",
      index: 0,
    });
    expect(find(empty.events, "ATTACK_FAILED")).toMatchObject({ reason: "requirement" });
    const occupied = mustApply(assaultLanding(boardP2(85, "p1"), "p2"), {
      type: "attack",
      seat: "p2",
      index: 0,
    });
    expect(types(occupied.events)).not.toContain("ATTACK_FAILED");
    expect(find(occupied.events, "DAMAGE_DEALT")).toMatchObject({ base: 70, dealt: 70 });
  });
});

describe("§6 — what this slice did NOT buy", () => {
  it("bought no Stadium-DISCARD op, and the sentences that need one stay LOUD", () => {
    // ⚠️ 🆕🆕 **RE-AIMED AT D380, AND THE EXPIRY WAS PREDICTED BY THIS FILE'S OWN
    // CEILING BLOCK.** D380 built `discardStadium`, so the two BARE spellings this
    // rung used to name now resolve — they are asserted RESOLVED in §1 and dropped
    // from here rather than kept as a refusal that has stopped being true. What
    // D378 did not buy is unchanged: the two `discard that Stadium` TAILS (which
    // need a bonus-consequent reader as well as the op) and the two COMPOUND
    // discard sentences (which need a requirement split and a tenth reader). **A
    // GUARD KEYED ON A REFUSAL HAS AN EXPIRY DATE, AND THE SLICE THAT EXPIRES IT
    // OWNS THE REWRITE.**
    //
    // 🛑🛑 🆕🆕 **D418 — AND D417 EXPIRED THE OTHER HALF WITHOUT OWNING THE REWRITE,
    // BECAUSE NOTHING HERE COULD GO RED.** `DISCARD_OP` is now empty (its last entry,
    // Eternatus's compound cancel, is `TAKEN_SINCE` and is asserted RESOLVED below),
    // so what this loop still claims is the CEILING alone: the `discard that Stadium`
    // tail, which needs a bonus-consequent reader as well as the op. ⚠️ The loop is
    // NOT re-pointed at a narrower reader set — the claim *"no live reader takes this"*
    // is still exactly true of the row that is left, and weakening it would throw away
    // the only thing this rung is for.
    expect(CEILING.length + DISCARD_OP.length).toBe(1);
    for (const sentence of [...CEILING, ...DISCARD_OP]) {
      expect(readByAny(sentence), sentence).toBe(false);
    }
    // …and the positive half, so this rung cannot go green by refusing everything.
    for (const sentence of [...TAKEN_BY_D380, ...TAKEN_SINCE]) {
      expect(readByAny(sentence), sentence).toBe(true);
    }
  });

  it("bought no second Stadium member — the union gained ONE kind and the old one is untouched", () => {
    // A slice that "fixed" the near miss by adding an opponent-owned member too would
    // pass every rung above. The catalog prints no such clause, so it would be a member
    // with zero printings behind it.
    expect(
      corpus().some(([, s]) => (BONUS.exec(s.trim())?.[1] ?? "").includes("opponent's Stadium")),
    ).toBe(false);
    expect(conditionHolds(board(86, "p2"), "p1", OWNED)).toBe(false);
  });

  it("bought no play GATE — this member reaches the board through printed ATTACK text only", () => {
    // `conditionNote` is the reject fragment for a play gate, and no card carries this
    // one as one today. Pinned directly (as `boardCondition.test.ts` pins the other
    // unreachable arms) so a typo in player-facing copy cannot ship unseen.
    expect(conditionNote(PRESENT)).toBe("a Stadium is in play");
  });
});
