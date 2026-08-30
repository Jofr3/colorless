import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
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
import type { BoardCondition, GameEvent, GameState, Seat } from "./index";
import { isImmobilized } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  CROSS_BOARD_STATUS_DECK,
  attachFromDeck,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setConditions,
  types,
} from "./testFixtures";
import type { SpecialConditions } from "./types";
import { presentStatuses } from "./types";

// 🆕🆕 D377 — THE CROSS-BOARD STATUS PAIR: ONE CLOSED PRINTED VOCABULARY OVER THREE
// MODEL SHAPES, AND THE TOKEN PRICED AND DECLINED.
//
// D376 handed over a PAIR rather than a singleton, because the 2-printing band had
// emptied of cheap work: *"If your opponent's Active Pokémon is Burned, this attack
// does 40 more damage."* and *"…is Confused, this attack does 90 more damage."*,
// **1 legal printing each**, with the SHAPE question stated in advance —
// `SpecialConditions` stores Poison as a COUNTER (`poisonDamage`), Burn as a BOOLEAN
// (`burned`) and Confusion as ONE VALUE of a ROTATION ENUM (`rotation`), so one
// closed printed vocabulary of five words sits over three different model shapes.
//
// ✅ **AND IT CAME OUT AT THREE PRINTINGS, NOT TWO, BECAUSE THE CENSUS WAS WIDENED
// FROM A PHRASE TO A WORD.** D310/D311's standing rule — *a census is as narrow as
// the literal it matches* — applied to the handoff's own sweep: asking for every
// CONDITIONAL sentence carrying a status word rather than for *"is Burned"* turns up
// *"If your opponent's Active Pokémon **isn't** Burned, this attack does nothing."*
// (Centiskorch `sv05-037` "Charring Breath", {R}{R}, 180), a THIRD legal printing on
// a DIFFERENT consequent and the SAME board fact. That row is free: the polarity rule
// at the head of `ATTACK_REQUIREMENT_CLAUSES` means the skeleton owns the negation,
// so the row hands back the POSITIVE member and `attack.ts` cancels when it fails.
// D363's Sawk arrangement, one member over. §1 drives that count.
//
// 🛑 **THE SHAPE ANSWER, PART A: THE THREE MODEL SHAPES ARE A RED HERRING.** They
// already meet in exactly one place — `presentStatuses` (types.ts) projects the
// rotation enum, the poison counter and the burn boolean onto one closed `StatusName`
// list — and `opponentActiveHasSpecialCondition` has consumed that projection since
// D116 as `.length > 0`. So neither new arm picks a field; both ask the projection,
// which makes them **provable NARROWINGS of that member on every board** rather than
// agreeing readings of the same three fields. §5 SWEEPS that implication over every
// condition set the model can hold rather than asserting it once.
//
// 🛑 **THE SHAPE ANSWER, PART B: THE `status` TOKEN WAS PRICED FROM THE CATALOG AND
// DECLINED, AND D118's TEST IS NOT WHAT DECIDED IT.** D118's rule (a template is safe
// only when the varying token has a CLOSED vocabulary to fail against) PASSES here for
// the first time in this corner — the statuses are five printed words and nothing
// else. **It is the COUNT that refuses the token**, and §1 measures it rather than
// arguing it: three of the five vocabulary values are read at all, two of those three
// are already `opponentActivePoisoned` / `yourActivePoisoned`, and re-pointing a
// seat-named member at a token is a RENAME until proven otherwise (D365 recorded it,
// D366 reproduced it, D362 priced the analogous one at 31 sites across 7 files).
//
// ⚠️ **THE VACUITY MODES, NAMED BEFORE THE BUILD AND EACH DRIVEN ON A BOARD:**
//   • `isImmobilized` is `rotation === "asleep" || rotation === "paralyzed"` and
//     deliberately EXCLUDES Confused (§12 lets a Confused Pokémon attack and retreat),
//     so a member that reached for the nearest rotation predicate is FALSE on every
//     board this clause is about and green everywhere else — §5 asserts the two
//     DISAGREE on the Confused board;
//   • both statuses clear on the same events (benching, evolving, switching), so a
//     board that never moves the Active cannot tell "reads the field" from "reads a
//     constant" — §3 and §4 drive an ARM and a DISARM apiece, both through the GAME;
//   • the two clauses must not reach each other, so §5 fields one board carrying BOTH
//     statuses at once and one carrying each alone.
//
// ⚠️ **AND THE TWO STATUSES CLEAR DIFFERENTLY, WHICH THIS FILE PAYS FOR.** Burn is
// CURED BY A COIN at every Checkup (§13.2 — 20 damage, then a cure flip), so a board
// that arms it in-game and reads it a turn later is **seed-dependent**: §3 pins the
// seed and ASSERTS the flips off `CHECKUP_COIN_FLIP` rather than assuming them, and
// the HEADS seed beside it is the game-driven DISARM. Confusion has no cure flip and
// survives indefinitely; its disarm is §11's retreat, which clears the whole row.
//
// WHAT SHIPS: **2 new NULLARY `BoardCondition` members** (`opponentActiveBurned`,
// `opponentActiveConfused`), their **4** reader arms, **2** literal
// `CONDITIONAL_DAMAGE_CLAUSES` rows and **1** `ATTACK_REQUIREMENT_CLAUSES` row. Zero
// new maps, templates, patterns, ops, events or `packages/schema` bytes.
// `MATCH_RECORD_VERSION` stays 22 — both members are nullary and `SpecialConditions`
// has been in the persisted record since M3 with its shape untouched.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The two consequent skeletons, as labelled COPIES — the readers' own patterns are
    module-private. Whole-sentence anchored at BOTH ends, like theirs. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;
const NOTHING = /^If (.+), this attack does nothing\.$/;

/** The nine live readers, run as one — the same set `censusAtHead.test.ts` uses. */
const READERS: readonly ((text: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  // 🆕🆕 D419 — the THREE readers this list never had (D381, D403, D417), written
  // in NAME order rather than in landing order because the guard below diffs a
  // SORTED list against the module surface.
  // ⚠️ SPLICED MID-LIST RATHER THAN APPENDED: mutant `find` strings in
  // `scripts/mutation/mutants.ts` quote an array's LAST entries plus its closing
  // `];`, and appending moves that anchor without a character of it changing —
  // the adjacency class D418 paid for once on `stadiumPresence.test.ts`.
  deriveAttackCancelRequirement,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalCostBoost,
  // 🆕🆕 D428 — THE THIRTEENTH, the PRE-DAMAGE Tool discard. ⚠️ SPLICED BEFORE THE
  // LAST ENTRY RATHER THAN APPENDED, D419's rule: mutant `find` strings quote an
  // array's LAST entries plus its closing bracket, and appending moves that anchor
  // without a character of it changing.
  deriveAttackPreDamage,
  deriveAttackBonusConsequent,
];

/** THE THREE SENTENCES THIS SLICE BUYS, byte-for-byte from the committed corpus. */
const ROASTING_HEAT =
  "If your opponent's Active Pokémon is Burned, this attack does 40 more damage.";
const MENTAL_CRUSH =
  "If your opponent's Active Pokémon is Confused, this attack does 90 more damage.";
const CHARRING_BREATH =
  "If your opponent's Active Pokémon isn't Burned, this attack does nothing.";

const BURNED_CLAUSE = "your opponent's Active Pokémon is Burned";
const CONFUSED_CLAUSE = "your opponent's Active Pokémon is Confused";
const NOT_BURNED_CLAUSE = "your opponent's Active Pokémon isn't Burned";

/** The two setter sentences the cast uses to arm its own antecedents — both already
    built, both `applyStatus`, and neither one of them this slice's business except as
    the honest route onto a board. */
const SINGE = "Your opponent's Active Pokémon is now Burned.";
const PERPLEX = "Your opponent's Active Pokémon is now Confused.";

const BURNED: BoardCondition = { kind: "opponentActiveBurned" };
const CONFUSED: BoardCondition = { kind: "opponentActiveConfused" };
/** The member the two new ones are NARROWINGS of — the shipped `.length > 0` over the
    same projection, reported beside them on every board in §5. */
const ANY_STATUS: BoardCondition = { kind: "opponentActiveHasSpecialCondition" };
/** The nearest sibling in the printed vocabulary — one word apart, one board, and the
    two clauses are the same code-point length. */
const POISONED: BoardCondition = { kind: "opponentActivePoisoned" };

/** The five printed status words, in the order §12 lists them. THE CLOSED VOCABULARY
    the declined token would have varied over. */
const PRINTED_STATUSES = ["Asleep", "Burned", "Confused", "Paralyzed", "Poisoned"] as const;

// ── boards ─────────────────────────────────────────────────────────────────────

/** Setup, then P1's turn 2 (P2 went first and passed) — P1's first unrestricted turn,
    so the attack step is legal (§4) — with BOTH Active spots pinned to a neutral
    200 HP `fix-bigbody`. Pinning is what keeps every assertion seed-independent: all
    three attackers in `CROSS_BOARD_STATUS_DECK` are BASICS and any of them could
    otherwise be the dealt starter. Each displaced starter lands on its own bench, so
    both seats open with a non-empty bench — which §4's retreat DISARM needs. */
function board(seed: number): GameState {
  let state = driveSetup(
    seed,
    { p1: CROSS_BOARD_STATUS_DECK, p2: CROSS_BOARD_STATUS_DECK },
    { first: "p2" },
  );
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-bigbody");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  return state;
}

/** `board`, handed over to P2. Both members are CROSS-BOARD on the face of them, and
    a P1-only suite cannot tell "reads the OPPONENT's Active" apart from "reads p2's
    Active" — so §6 drives every reading from the far seat too. */
function boardP2(seed: number): GameState {
  return mustApply(board(seed), { type: "endTurn", seat: "p1" }).state;
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

/** Slugma's body, paid `{R}`. */
const roastheat = (state: GameState, seat: Seat = "p1"): GameState =>
  fielded(state, seat, "fix-roastheat", [["fix-fire-energy", 1]]);

/** Tapu Lele's body, paid `{P}{C}{C}` — enough for either printed attack, and the
    typed slot is paid by a typed card so no board can confuse the two. */
const mindcrush = (state: GameState, seat: Seat = "p1"): GameState =>
  fielded(state, seat, "fix-mindcrush", [
    ["fix-psychic-energy", 1],
    ["fix-energy", 2],
  ]);

/** Centiskorch's body, paid `{R}{R}` — enough for "Singe" or "Charring Breath". */
const charbreath = (state: GameState, seat: Seat = "p1"): GameState =>
  fielded(state, seat, "fix-charbreath", [["fix-fire-energy", 2]]);

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Every `CHECKUP_COIN_FLIP` in a batch, as `seat:status:result` strings. §13.2's cure
    flip is what makes an in-game Burn board seed-dependent, so it is READ rather than
    assumed. */
const flips = (events: GameEvent[]): string[] =>
  events
    .filter((e): e is Extract<GameEvent, { type: "CHECKUP_COIN_FLIP" }> => {
      return e.type === "CHECKUP_COIN_FLIP";
    })
    .map((e) => `${e.seat}:${e.status}:${e.result}`);

/** The three readings of the OPPONENT's Active reported together, so a rung says WHICH
    one it separates. `anyStatus` is the shipped member both new ones narrow. */
function readings(
  state: GameState,
  seat: Seat,
): { burned: boolean; confused: boolean; poisoned: boolean; anyStatus: boolean } {
  return {
    burned: conditionHolds(state, seat, BURNED),
    confused: conditionHolds(state, seat, CONFUSED),
    poisoned: conditionHolds(state, seat, POISONED),
    anyStatus: conditionHolds(state, seat, ANY_STATUS),
  };
}

describe("§1 — the price, RE-DERIVED: a 3:3 step, and a census widened from a phrase to a WORD", () => {
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

  it("🛑 the bonus residue steps by exactly TWO sentences and TWO printings", () => {
    // D376 left the residue at 24 records / 28 printings. Both figures are re-derived
    // here off the same instrument — the nine live readers over `legalAttackCorpus()`
    // — rather than quoted.
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    // The DEPARTURE and the SIZE are asserted separately: a guard that only checked
    // 22 / 26 could not tell "the two rows landed" from "a reader broke".
    expect(refused.some(([, s]) => s === ROASTING_HEAT)).toBe(false);
    expect(refused.some(([, s]) => s === MENTAL_CRUSH)).toBe(false);
        // 🆕🆕 D378 — 22 / 26 -> 21 / 25: STADIUM PRESENCE (`stadiumInPlay`) left this
    // residue — ONE sentence at ONE printing (Probopass `sv10-098` "Mountain Drop",
    // +70) — re-derived live rather than decremented. ⚠️ AND TWO OF THAT SLICE'S
    // THREE PRINTINGS ARE NOT IN THIS NUMBER: the same board fact is printed under
    // the "does nothing" consequent by Fan Rotom, which is a different skeleton and a
    // different residue — and there it is the BIGGER half.
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
    // 🛑 AND THE STEP IS 2:2 ON THIS COLUMN. Every earlier head is re-derived from THIS
    // one rather than frozen: D376's 24/28, D375's 25/30, D374's 26/32, D373's 27/34.
    // 🆕🆕 D392 — the OFFSET gains one on each axis: the head moved, this one's did not.
    expect([refused.length + 19, units(refused) + 23]).toEqual([24, 28]);
    // 🆕🆕 D392 — the OFFSET gains one on each axis: the head moved, this one's did not.
    expect([refused.length + 20, units(refused) + 25]).toEqual([25, 30]);
    expect([refused.length + 21, units(refused) + 27]).toEqual([26, 32]);
    expect([refused.length + 22, units(refused) + 29]).toEqual([27, 34]);
  });

  it("🛑 the CANCEL residue steps too — the third printing nobody was counting", () => {
    // The sentence D376's handoff did not name. It is a DIFFERENT consequent, so it
    // sits in a different residue and moves a different number: the "does nothing"
    // skeleton's unread remainder was 3 sentences / 5 printings at D376's head.
    const refused = corpus().filter(([, s]) => NOTHING.test(s.trim()) && !resolvedByAnyReader(s));
    expect(refused.some(([, s]) => s === CHARRING_BREATH)).toBe(false);
    // 🆕🆕 D378 — 2 / 4 -> 1 / 2: STADIUM PRESENCE took the bigger of the two
    // sentences this rung had left (Fan Rotom `sv07-118`/`sv08.5-085`, 2 printings),
    // so the cancel residue is now a SINGLE sentence — the exact hand-size read.
    // 🛑 🆕🆕 D379 — 1 / 2 -> **0 / 0**: THE EXACT HAND-SIZE READ took the last one
    // (`yourHandExactly`), and the does-nothing skeleton is SATURATED. Every earlier
    // head is still re-derived from this one rather than frozen, which is what keeps
    // this rung an accounting of the run rather than a snapshot of today.
    expect(refused).toEqual([]);
    expect([refused.length + 1, units(refused) + 2]).toEqual([1, 2]);
    expect([refused.length + 2, units(refused) + 4]).toEqual([2, 4]);
    expect([refused.length + 3, units(refused) + 5]).toEqual([3, 5]);
  });

  it("🛑 THREE sentences, ONE legal printing each — a 3:3 step, which this run has not taken", () => {
    for (const sentence of [ROASTING_HEAT, MENTAL_CRUSH, CHARRING_BREATH]) {
      const records = corpus().filter(([, s]) => s === sentence);
      expect(records, sentence).toHaveLength(1);
      expect(units(records), sentence).toBe(1);
    }
    // …and no second sentence carries either clause under a different amount, so
    // neither bonus row can be short and neither can rot on a reprint at a new N.
    for (const clause of [BURNED_CLAUSE, CONFUSED_CLAUSE]) {
      const rows = corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === clause);
      expect(rows, clause).toHaveLength(1);
      expect(units(rows), clause).toBe(1);
    }
    const cancelRows = corpus().filter(([, s]) => NOTHING.exec(s.trim())?.[1] === NOT_BURNED_CLAUSE);
    expect(cancelRows).toHaveLength(1);
    expect(units(cancelRows)).toBe(1);
    // ⚠️ THE IDS ARE NOT READ FROM THE CATALOG — D369's constraint, unchanged: this
    // container has no D1 credentials and no local sqlite copy. Slugma `sv05-028`,
    // Tapu Lele `sv08-092` and Centiskorch `sv05-037` are recorded in the members' doc
    // blocks from a WEB lookup confirmed by id against tcgdex, and nothing on this path
    // needs an id: a literal row is keyed on the printed clause and serves every
    // printing of it.
  });

  it("🛑 THE `status` TOKEN, PRICED FROM THE CATALOG: five printed words, THREE of them read", () => {
    // THE MEASUREMENT THAT DECIDES THE SHAPE, and the rung that reddens the day it
    // stops being true. D118's closed-vocabulary test PASSES here — §12 prints exactly
    // five status words — so what refuses a `{ kind: "opponentActiveStatus", status }`
    // member is not safety but ARITHMETIC.
    const read = new Map<string, { sentences: number; printings: number }>();
    for (const word of PRINTED_STATUSES) {
      const rows = corpus().filter(([, s]) => s.includes(`is ${word}`) || s.includes(`isn't ${word}`));
      read.set(word, { sentences: rows.length, printings: units(rows) });
    }
    expect(Object.fromEntries(read)).toEqual({
      // ALL BUILT before this slice, as TWO NULLARY seat-named members: 3 sentences /
      // 5 printings cross-board on `opponentActivePoisoned`, 1 sentence / 3 printings
      // same-seat on `yourActivePoisoned`.
      Poisoned: { sentences: 4, printings: 8 },
      // This slice — and BOTH consequents, which is why it is 2 and not 1.
      Burned: { sentences: 2, printings: 2 },
      // This slice.
      Confused: { sentences: 1, printings: 1 },
      // 🛑 THE TWO VALUES A TOKEN WOULD BUY REACHABILITY FOR, AND NOTHING PRINTS THEM.
      // Both words appear all over the legal attack column as SETTERS ("is now
      // Asleep"), which is a different sentence and a different mechanism; as a READ
      // antecedent they are absent.
      Asleep: { sentences: 0, printings: 0 },
      Paralyzed: { sentences: 0, printings: 0 },
    });
    // …so the token serves EXACTLY the 3 printings this slice's two rows serve, and
    // the only way it could serve more is by absorbing the two Poison members — which
    // is a RENAME (D362: 31 sites across 7 files), not a widening.
    const tokenServes = (read.get("Burned")?.printings ?? 0) + (read.get("Confused")?.printings ?? 0);
    expect(tokenServes).toBe(3);
    // ⚠️ AND THE SETTER SIDE IS ENORMOUS BY COMPARISON, which is the measurement that
    // says why the vocabulary "feels" bigger than the read population is. The pool
    // prints these five words as CONSEQUENTS far more often than as antecedents; that
    // half is `applyStatus`'s and has been built since M3.
    const setters = corpus().filter(([, s]) => PRINTED_STATUSES.some((w) => s.includes(`is now ${w}`)));
    expect(setters.length).toBeGreaterThan(read.get("Poisoned")?.sentences ?? 0);
    expect(resolvedByAnyReader(SINGE)).toBe(true);
    expect(resolvedByAnyReader(PERPLEX)).toBe(true);
  });

  it("🛑 the two bands above this one did NOT move — nothing here re-priced them", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    // The 2-printing band is STILL a single item and still the expensive one: *"this
    // Pokémon was healed during this turn"* needs a PER-TURN HEALED FLAG on the state,
    // which is a persisted-shape change and therefore a `MATCH_RECORD_VERSION` bump on
    // top of the engine bump. Five slices have deferred it on that ground.
    const band2 = [...byClause].filter(([, n]) => n === 2).map(([clause]) => clause);
    // 🆕🆕 D386 — ONE -> ZERO: the healed-this-turn clause was bought out of the band
    // (`healedThisTurn.test.ts`), and THE 2-PRINTING BAND IS NOW EMPTY. 🛑 D379's
    // SATURATION SHAPE — an emptied population cannot go red for the reason that
    // matters — so the refusal is driven from OUTSIDE it: the ONLY clause left above
    // ONE printing is the 5-printing declaration clause D368 disqualified on SHAPE,
    // and the 1-printing band is SIXTEEN deep (D387 took one out of it).
    expect(band2).toEqual([]);
    expect([...byClause.values()].filter((n) => n > 1)).toEqual([]);// 🆕🆕 D436 the `n > 1` BAND IS NOW EMPTY — its one occupant was the 5-printing DECLARATION clause and this slice claims it. The rung still goes RED the moment any reader narrows so that a clause returns above one printing (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.)
    // 🆕🆕 D387 — 18 -> **17**: the STAGE 1 clause left the 1-printing band, which is
    // the ONLY band that moved. The 2-printing band was already empty and stays empty,
    // and the refusal is still driven from OUTSIDE it.
    // 🆕🆕 D388 — 17 -> **16**: the RETREAT-COST THRESHOLD left the 1-printing band,
    // which is the ONLY band that moved. The 2-printing band was already empty and stays
    // empty, and the refusal is still driven from OUTSIDE it.
    // 🆕🆕 D389 — 16 -> **15**: the OPPONENT-SEAT BENCH COUNT left the 1-printing
    // band, the only band that moved.
    // 🆕🆕 D390 — 15 -> **14**: the OPPONENT-SEAT TYPE READ left the 1-printing band,
    // which is again the ONLY band that moved. The 2-printing band was already empty
    // and stays empty, and the refusal is still driven from OUTSIDE it.
    expect(byClause.size).toBe(5); // 🆕🆕 D436 -1 clause: the 5-printing DECLARATION clause LEAVES this residue, and the 5 remaining are the D207 banners (THE "EXTRA ENERGY" DECLARATION READ — corpus rows 319/320, **2 sentences / 5 legal printings on ONE clause**, the record D368 refused on SHAPE as a `BoardCondition` and this slice takes as a `DamageCountSource` (`extraEnergyUnitsBeyondCost`), because the predicate reads THIS ATTACK'S COST and the fold runs inside `attack()` where that cost is a local. Claimed WHOLE by `deriveAttackDamageBonus` through ONE new anchor `EXTRA_ENERGY_BONUS`, so the RAW reader summand alone steps: the reader SURFACE stands still at 13 and the registry / split / compound summands were RE-MEASURED UNMOVED rather than assumed.) // 🆕🆕 D398 — the DECK-SIZE READ took ONE more singleton out, a 1:1 step, and it was the LAST BUILDABLE one // 🆕🆕 D397 — the BENCHED-CUBONE FILTER took ONE more singleton out, back to a 1:1 step // 🆕🆕 D394 — the USED-ATTACK PAIR took TWO more singletons out at once, the second two-step in two slices // 🆕🆕 D392 — the SUBSTRING NAME READ left the 1-printing band // 🆕🆕 D391 — the TYPED PER-BODY ENERGY THRESHOLD left the 1-printing band
    // 🆕🆕 **D436 — 5 → 1: THE DECLARATION CLAUSE LEFT, AND THE RESIDUE IS NOW FLAT.**
    // That clause was the only thing in this band above one printing; D436 reads it as
    // a `DamageCountSource` (the refusal D368 wrote was of a `BoardCondition`, and it
    // still stands as written). The rung is kept because a FLAT maximum is the claim a
    // successor needs: it goes RED the moment any clause returns above one printing,
    // which is the direction that matters once the band has emptied.
    expect(Math.max(...byClause.values())).toBe(1);
    // 🛑 THE 1-PRINTING BAND IS WHERE THIS SLICE CAME FROM AND IT IS STILL DEEP: after
    // taking two out of it, nineteen clauses remain at one printing apiece. The pair
    // was worth taking because ONE purchase served THREE printings, not because the
    // band was thin.
    // 🆕🆕 D378 — 19 -> 18: the Stadium-PRESENCE bonus clause left the band.
    // 🆕🆕 D384 — 18 -> 17: the STRICT-INEQUALITY TWIN left the band, and it is the
    // whole of that slice — a 1-printing clause bought for ONE nullary member, which
    // is the trade this paragraph called "not worth taking" when TWO printings were
    // available for one purchase. It was taken because the band above it is EMPTY of
    // anything cheaper: the only 2-printing clause left needs a persisted per-turn
    // HEALED flag and a `MATCH_RECORD_VERSION` bump.
    // 🆕🆕 D387 — 17 -> **16**: the STAGE 1 clause left the singleton band, the same
    // trade one slice on — a 1-printing clause bought for ONE nullary member plus one
    // `cards.ts` predicate. The band above is STILL empty, and the only clause left
    // above one printing is the 5-printing declaration one, disqualified on SHAPE.
    // 🆕🆕 D390 — 15 -> **14**: the OPPONENT-SEAT TYPE READ left the singleton band,
    // the same trade one slice on — a 1-printing clause bought for ONE parameterised
    // member plus one anchored template. The band above is STILL empty, and the only
    // clause left above one printing is the 5-printing declaration one, disqualified
    // on SHAPE.
    // 🆕🆕 D391 — the TYPED PER-BODY ENERGY THRESHOLD left the 1-printing band.
    // 🆕🆕 D392 — 12 -> **11**, the whole of this slice's step.
    expect([...byClause].filter(([, n]) => n === 1)).toHaveLength(5); // 🆕🆕 D398 — the DECK-SIZE READ left the singleton band, 6 -> 5 // 🆕🆕 D397 — the BENCHED-CUBONE FILTER took ONE more singleton out, back to a 1:1 step // 🆕🆕 D394 — the USED-ATTACK PAIR took TWO more singletons out at once
  });
});

describe("§2 — the THREE keys, the printed BYTES, and two tables that must not meet", () => {
  it("maps both printed BONUS sentences onto the new members at the printed amounts", () => {
    expect(deriveAttackDamageBonus(ROASTING_HEAT)).toEqual({
      per: 40,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveBurned" } },
    });
    expect(deriveAttackDamageBonus(MENTAL_CRUSH)).toEqual({
      per: 90,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveConfused" } },
    });
  });

  it("maps the printed NEGATION onto the POSITIVE member — the skeleton owns the 'isn't'", () => {
    // `ATTACK_REQUIREMENT_CLAUSES`' polarity rule: the row hands back the POSITIVE fact
    // and `attack.ts` cancels when it does NOT hold. So the printed "isn't" costs no
    // `{ kind: "not" }` and no second member — which is the whole reason the third
    // printing was free.
    expect(deriveAttackRequirement(CHARRING_BREATH)).toEqual({ kind: "opponentActiveBurned" });
    // …and it is the SAME member the bonus row returns, not a look-alike.
    const bonus = deriveAttackDamageBonus(ROASTING_HEAT);
    expect(deriveAttackRequirement(CHARRING_BREATH)).toEqual(
      bonus?.count.kind === "boardCondition" ? bonus.count.cond : null,
    );
  });

  it("🛑 the KEYS are the printed bytes, pinned by CODE-POINT COUNT", () => {
    // D183's defect is an arm authored from a PARAPHRASE, and the count is what catches
    // a transcription that reads right and is not the printed sentence.
    expect(ROASTING_HEAT).toHaveLength(77);
    expect(MENTAL_CRUSH).toHaveLength(79);
    expect(CHARRING_BREATH).toHaveLength(73);
    expect(BURNED_CLAUSE).toHaveLength(40);
    expect(CONFUSED_CLAUSE).toHaveLength(42);
    expect(NOT_BURNED_CLAUSE).toHaveLength(43);
    expect(BONUS.exec(ROASTING_HEAT)?.[1]).toBe(BURNED_CLAUSE);
    expect(BONUS.exec(MENTAL_CRUSH)?.[1]).toBe(CONFUSED_CLAUSE);
    expect(NOTHING.exec(CHARRING_BREATH)?.[1]).toBe(NOT_BURNED_CLAUSE);
    // ⚠️ ALL THREE KEYS CARRY A REAL U+00E9 AND AN ASCII APOSTROPHE, and the cancel key
    // carries TWO apostrophes ("opponent's" and "isn't") exactly as Sawk's does. So
    // unlike D376's pure-ASCII row these lean on D137's U+2019 fold and on D154's
    // é check, and asserting it is what keeps a successor from "simplifying" the
    // lookup back through a raw `Map.get`.
    for (const key of [BURNED_CLAUSE, CONFUSED_CLAUSE, NOT_BURNED_CLAUSE]) {
      expect(key, key).toContain("é");
      expect(key, key).toContain("'");
      expect(key, key).not.toContain("’");
    }
    expect([...NOT_BURNED_CLAUSE].filter((ch) => ch === "'")).toHaveLength(2);
  });

  it("🛑 the Confused key and the Poisoned key are the SAME LENGTH, one word apart", () => {
    // The sharpest near-miss in the §12 corner of `CONDITIONAL_DAMAGE_CLAUSES`: two
    // rows, one board, one field-free reading, identical shape and identical code-point
    // count. A substring-keyed lookup would be undetectable here.
    expect(CONFUSED_CLAUSE).toHaveLength(42);
    expect("your opponent's Active Pokémon is Poisoned").toHaveLength(42);
    expect(deriveAttackDamageBonus("If your opponent's Active Pokémon is Poisoned, this attack does 120 more damage.")).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: { kind: "opponentActivePoisoned" } },
    });
  });

  it("🛑 the two TABLES cannot reach each other — D125's disjointness, both directions", () => {
    // A clause meaning "the attack does N more damage if X" must never be reachable
    // from a sentence meaning "the attack does nothing if X", and vice versa. The two
    // maps share a lookup HELPER and no lookup, so this is closed by construction —
    // and here is where it is DRIVEN, because this slice is the first to put one
    // member in both tables since D363.
    expect(deriveAttackRequirement(ROASTING_HEAT)).toBeNull();
    expect(deriveAttackRequirement(MENTAL_CRUSH)).toBeNull();
    expect(deriveAttackDamageBonus(CHARRING_BREATH)).toBeNull();
    // …and the CONSTRUCTED crossings — each clause under the OTHER consequent — are
    // refused by every reader, so neither table has quietly learned the other's key.
    for (const crossed of [
      "If your opponent's Active Pokémon is Burned, this attack does nothing.",
      "If your opponent's Active Pokémon is Confused, this attack does nothing.",
      "If your opponent's Active Pokémon isn't Burned, this attack does 40 more damage.",
      "If your opponent's Active Pokémon isn't Confused, this attack does 90 more damage.",
    ]) {
      expect(resolvedByAnyReader(crossed), crossed).toBe(false);
    }
  });

  it("🛑 nine constructed rewrites resolve to NOTHING — the printed words are the key", () => {
    for (const near of [
      // the SEAT flipped — this is the same clause the pool prints for Poison on the
      // OTHER side, and the possessive is the only thing separating them.
      "If this Pokémon is Burned, this attack does 40 more damage.",
      "If this Pokémon is Confused, this attack does 90 more damage.",
      // a status the catalog never reads — the two values a token would have admitted.
      "If your opponent's Active Pokémon is Asleep, this attack does 40 more damage.",
      "If your opponent's Active Pokémon is Paralyzed, this attack does 90 more damage.",
      // the SETTER wording under a bonus consequent
      "If your opponent's Active Pokémon is now Burned, this attack does 40 more damage.",
      // the Bench instead of the Active Spot
      "If your opponent's Benched Pokémon is Burned, this attack does 40 more damage.",
      // the plural possessive dropped
      "If the Defending Pokémon is Confused, this attack does 90 more damage.",
      // "affected by" — the WIDER member's own wording, narrowed to one word
      "If your opponent's Active Pokémon is affected by Burned, this attack does 40 more damage.",
      // a curly apostrophe AND a lookalike é together is still a miss on the ROTATION
      // word, so this one proves the fold is not doing the work a wrong word would need.
      "If your opponent's Active Pokémon is Confuzed, this attack does 90 more damage.",
    ]) {
      expect(resolvedByAnyReader(near), near).toBe(false);
    }
    // …and all three taken sentences ARE resolved, so the loop above is a statement
    // about those nine strings rather than about the readers being asleep.
    for (const taken of [ROASTING_HEAT, MENTAL_CRUSH, CHARRING_BREATH]) {
      expect(resolvedByAnyReader(taken), taken).toBe(true);
    }
  });

  it("🛑 both notes ROUND-TRIP to their bonus keys, and neither to the cancel key", () => {
    // Unlike D376's neighbour, these clauses name no pronoun, no timing word and no
    // energy glyph, so the note IS the printed key — the same full round-trip the two
    // Poison notes make. What it is NOT is the cancel key: a note describes the board,
    // and the board is either Burned or it is not.
    expect(conditionNote(BURNED)).toBe(BURNED_CLAUSE);
    expect(conditionNote(CONFUSED)).toBe(CONFUSED_CLAUSE);
    expect(deriveAttackDamageBonus(`If ${conditionNote(BURNED)}, this attack does 40 more damage.`)).toEqual(
      { per: 40, count: { kind: "boardCondition", cond: BURNED } },
    );
    expect(deriveAttackDamageBonus(`If ${conditionNote(CONFUSED)}, this attack does 90 more damage.`)).toEqual(
      { per: 90, count: { kind: "boardCondition", cond: CONFUSED } },
    );
    expect(conditionNote(BURNED)).not.toBe(NOT_BURNED_CLAUSE);
    // ⚠️ AND THE WIDER MEMBER'S NOTE IS STILL ITS OWN, so a successor cannot collapse
    // the three §12 pills into one.
    expect(conditionNote(ANY_STATUS)).toBe(
      "your opponent's Active Pokémon is affected by a Special Condition",
    );
    expect(conditionNote(POISONED)).toBe("your opponent's Active Pokémon is Poisoned");
    expect(new Set([conditionNote(BURNED), conditionNote(CONFUSED), conditionNote(POISONED), conditionNote(ANY_STATUS)]).size).toBe(4);
  });
});

describe("§3 — BURNED: armed by the game, and CURED by the game", () => {
  it("vs a CLEAN Active the printed 10 stands", () => {
    const state = roastheat(board(30));
    expect(state.players.p2.active?.conditions.burned).toBe(false);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 10, dealt: 10 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("vs a BURNED Active it adds the whole 40 → 50", () => {
    const state = setConditions(roastheat(board(31)), "p2", { burned: true });
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 10, scaled: 40, dealt: 50 });
  });

  it("🛑 is armed by the GAME — Singe one turn, Roasting Heat the next, with the CURE FLIPS read", () => {
    // The end-to-end case: no `setConditions` anywhere. Centiskorch's index-0 "Singe"
    // (a derived `applyStatus` that deals no damage at all) Burns the spot its own
    // sibling printing reads two turns later.
    //
    // 🛑 AND THE SEED IS PINNED BECAUSE §13.2 FLIPS A CURE COIN AT EVERY CHECKUP. Two
    // Checkups run between Singe and Roasting Heat — one when P1's attack ends the
    // turn and one when P2 passes back — so the Burn only survives on two TAILS. The
    // flips are ASSERTED off `CHECKUP_COIN_FLIP` rather than assumed, which is what
    // makes this rung fail LOUDLY (and with a readable message) if the RNG ever moves,
    // instead of silently becoming the clean-Active case wearing a Burn's name.
    let state = charbreath(board(5));
    const singe = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // Singe deals nothing itself — the only damage in its batch is §13.2's.
    expect(find(singe.events, "DAMAGE_DEALT")).toBeUndefined();
    expect(types(singe.events)).toContain("STATUS_APPLIED");
    expect(flips(singe.events)).toEqual(["p2:burned:tails"]);
    state = singe.state;
    expect(state.players.p2.active?.conditions.burned).toBe(true);
    expect(state.players.p2.active?.damage).toBe(20); // one Checkup tick

    const back = mustApply(state, { type: "endTurn", seat: "p2" });
    expect(flips(back.events)).toEqual(["p2:burned:tails"]);
    state = back.state;
    expect(state.players.p2.active?.conditions.burned).toBe(true);
    expect(state.players.p2.active?.damage).toBe(40); // a second tick, on the way back
    expect(state.players.p1.active?.damage).toBe(0); // Centiskorch was never Burned

    // Swap the attacker: Slugma takes the spot Centiskorch was holding. THE BURN IS
    // ON THE OTHER SIDE OF THE TABLE, so nothing about moving YOUR Active touches it.
    const { events } = mustApply(roastheat(state), { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 10, scaled: 40, dealt: 50 });
  });

  it("🛑 THE DISARM, and it is the GAME's: a HEADS cure flip puts the bonus back to 10", () => {
    // The other half of the same board. Seed 2 flips HEADS at the very first Checkup,
    // so §13.2 cures the Burn Singe just applied — and the member has to notice.
    // Without this rung "reads the field" is indistinguishable from "reads a constant
    // that happens to be true after Singe".
    let state = charbreath(board(2));
    const singe = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(flips(singe.events)).toEqual(["p2:burned:heads"]);
    expect(types(singe.events)).toContain("STATUS_CLEARED");
    state = singe.state;
    expect(state.players.p2.active?.conditions.burned).toBe(false);
    expect(state.players.p2.active?.damage).toBe(20); // the tick landed before the cure

    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    // …and with the Burn gone there is no second tick and no second flip.
    expect(state.players.p2.active?.damage).toBe(20);
    const { events } = mustApply(roastheat(state), { type: "attack", seat: "p1", index: 0 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 10, dealt: 10 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("🛑 THE OTHER CONSEQUENT: Charring Breath CANCELS on a clean Active and lands 180 on a Burned one", () => {
    // The same member, read through `ATTACK_REQUIREMENT_CLAUSES`. A cancelled attack
    // is an attack that was USED: no damage, and the turn still ends.
    const clean = mustApply(charbreath(board(32)), { type: "attack", seat: "p1", index: 1 });
    expect(find(clean.events, "ATTACK_FAILED")).toMatchObject({ seat: "p1", reason: "requirement" });
    expect(find(clean.events, "DAMAGE_DEALT")).toBeUndefined();
    expect(types(clean.events)).toContain("TURN_ENDED");
    expect(types(clean.events)).not.toContain("ATTACK_EFFECT_SKIPPED");

    const burned = mustApply(setConditions(charbreath(board(32)), "p2", { burned: true }), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    expect(find(burned.events, "ATTACK_FAILED")).toBeUndefined();
    expect(find(burned.events, "DAMAGE_DEALT")).toMatchObject({ base: 180, dealt: 180 });
  });

  it("🛑 and the cancel reads BURN specifically — Confusion does not unlock it", () => {
    // The pairing that proves the requirement row is not "any Special Condition"
    // wearing a narrower name. One board, two statuses, two answers.
    const confused = setConditions(charbreath(board(33)), "p2", { rotation: "confused" });
    expect(readings(confused, "p1")).toEqual({
      burned: false,
      confused: true,
      poisoned: false,
      anyStatus: true,
    });
    const { events } = mustApply(confused, { type: "attack", seat: "p1", index: 1 });
    expect(find(events, "ATTACK_FAILED")).toMatchObject({ reason: "requirement" });
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
  });
});

describe("§4 — CONFUSED: armed by the card itself, disarmed by §11's retreat", () => {
  it("vs a CLEAN Active the printed 90 stands", () => {
    const state = mindcrush(board(34));
    expect(state.players.p2.active?.conditions.rotation).toBe("none");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 90, dealt: 90 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("vs a CONFUSED Active it adds the whole 90 → 180", () => {
    const state = setConditions(mindcrush(board(35)), "p2", { rotation: "confused" });
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 90, scaled: 90, dealt: 180 });
  });

  it("🛑 is armed by the CARD ITSELF — Perplex one turn, Mental Crush the next, and NO cure flip", () => {
    // Tapu Lele's own index-0 sets the condition its index-1 reads, exactly as Seviper
    // sv01-128 does for Poison. AND THE CONTRAST WITH §3 IS THE POINT: Confusion has no
    // §13 cure flip, so this board needs no pinned seed at all — the batch carries ZERO
    // `CHECKUP_COIN_FLIP` events and the status simply survives.
    let state = mindcrush(board(36));
    const perplex = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(perplex.events, "DAMAGE_DEALT")).toMatchObject({ base: 20, dealt: 20 });
    expect(types(perplex.events)).toContain("STATUS_APPLIED");
    expect(flips(perplex.events)).toEqual([]);
    state = perplex.state;
    expect(state.players.p2.active?.conditions.rotation).toBe("confused");

    const back = mustApply(state, { type: "endTurn", seat: "p2" });
    expect(flips(back.events)).toEqual([]);
    state = back.state;
    expect(state.players.p2.active?.conditions.rotation).toBe("confused");

    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 90, scaled: 90, dealt: 180 });
    // 20 + 180 against fix-bigbody's 200 — the bonus is what makes it lethal (90 alone
    // would have left the body on 90).
    expect(types(events)).toContain("KNOCKED_OUT");
  });

  it("🛑 THE DISARM, and it is the GAME's: P2 RETREATS and the bonus goes back to 90", () => {
    // §11 — retreating clears the whole status row, and the Pokémon that arrives is a
    // different body with a clean one. No surgery: a real `retreat` action taken by the
    // seat that owns the condition, on that seat's own turn (Confusion restricts
    // neither the attack gate nor the retreat gate, which is exactly why
    // `isImmobilized` excludes it).
    let state = mustApply(mindcrush(board(37)), { type: "attack", seat: "p1", index: 0 }).state;
    expect(state.players.p2.active?.conditions.rotation).toBe("confused");
    expect(conditionHolds(state, "p1", CONFUSED)).toBe(true);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const active = state.players.p2.active;
    if (active === null) throw new Error("p2 has no Active");
    // …and P2 is free to retreat while Confused, which is the §12 reading this member
    // depends on and `isImmobilized` denies for the other two rotation values.
    expect(isImmobilized(active.conditions)).toBe(false);
    const retreated = mustApply(state, {
      type: "retreat",
      seat: "p2",
      discardEnergy: [...active.energy],
      promoteBenchIndex: 0,
    });
    expect(types(retreated.events)).toContain("RETREATED");
    expect(find(retreated.events, "STATUS_CLEARED")).toMatchObject({
      seat: "p2",
      statuses: ["confused"],
    });
    state = retreated.state;
    expect(state.players.p2.active?.conditions.rotation).toBe("none");
    expect(conditionHolds(state, "p1", CONFUSED)).toBe(false);

    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 90, dealt: 90 });
    expect(dealt?.scaled).toBeUndefined();
  });
});

describe("§5 — the §12 cluster: four rows, one board, and the NESTING swept", () => {
  /** Every condition set the model can hold, as `Partial<SpecialConditions>` — the
      rotation's four values, the two independent flags, and the combinations that
      matter. The whole point is that a rung says which reading it separates. */
  const CASES: readonly (readonly [string, Partial<SpecialConditions>])[] = [
    ["clean", {}],
    ["burned", { burned: true }],
    ["confused", { rotation: "confused" }],
    ["asleep", { rotation: "asleep" }],
    ["paralyzed", { rotation: "paralyzed" }],
    ["poisoned", { poisonDamage: 10 }],
    ["burned+confused", { burned: true, rotation: "confused" }],
    ["burned+asleep", { burned: true, rotation: "asleep" }],
    ["confused+poisoned", { rotation: "confused", poisonDamage: 10 }],
    ["all three", { burned: true, rotation: "confused", poisonDamage: 10 }],
  ];

  it("🛑 the four members answer the WHOLE condition space, and none is an alias of another", () => {
    const table = new Map<string, ReturnType<typeof readings>>();
    for (const [label, conditions] of CASES) {
      const state = setConditions(board(40), "p2", conditions);
      table.set(label, readings(state, "p1"));
    }
    expect(Object.fromEntries(table)).toEqual({
      clean: { burned: false, confused: false, poisoned: false, anyStatus: false },
      burned: { burned: true, confused: false, poisoned: false, anyStatus: true },
      confused: { burned: false, confused: true, poisoned: false, anyStatus: true },
      // 🛑 THE TWO ROTATION VALUES `isImmobilized` NAMES, AND THE CONFUSED MEMBER IS
      // FALSE ON BOTH. A member spelled `isImmobilized(...)` would be true on these two
      // rows and false on the one above them — inverted on every board that matters.
      asleep: { burned: false, confused: false, poisoned: false, anyStatus: true },
      paralyzed: { burned: false, confused: false, poisoned: false, anyStatus: true },
      poisoned: { burned: false, confused: false, poisoned: true, anyStatus: true },
      // 🛑 THE BOARD THAT PROVES THE TWO NEW CLAUSES CANNOT REACH EACH OTHER: both are
      // true together and each is separately true alone, which no single wrong reading
      // produces.
      "burned+confused": { burned: true, confused: true, poisoned: false, anyStatus: true },
      "burned+asleep": { burned: true, confused: false, poisoned: false, anyStatus: true },
      "confused+poisoned": { burned: false, confused: true, poisoned: true, anyStatus: true },
      "all three": { burned: true, confused: true, poisoned: true, anyStatus: true },
    });
  });

  it("🛑 the NESTING is swept, not asserted once: each named status IMPLIES the wide member", () => {
    // What reading `presentStatuses` buys instead of the raw fields: the implication is
    // true BY CONSTRUCTION rather than by two readers agreeing. Swept over every board
    // in `CASES`, in both directions — the converse is FALSE, and the boards that
    // falsify it are the three the named members do not name.
    let wideAndUnnamed = 0;
    for (const [label, conditions] of CASES) {
      const state = setConditions(board(41), "p2", conditions);
      const r = readings(state, "p1");
      if (r.burned) expect(r.anyStatus, label).toBe(true);
      if (r.confused) expect(r.anyStatus, label).toBe(true);
      if (r.poisoned) expect(r.anyStatus, label).toBe(true);
      if (r.anyStatus && !r.burned && !r.confused && !r.poisoned) wideAndUnnamed += 1;
      // …and the projection the arms read is the SAME list the STATUS_CLEARED events
      // and the status chips are built from, so "is Burned" can never drift from what
      // the board shows.
      const active = state.players.p2.active;
      if (active !== null) {
        expect(presentStatuses(active.conditions).includes("burned"), label).toBe(r.burned);
        expect(presentStatuses(active.conditions).includes("confused"), label).toBe(r.confused);
      }
    }
    // Asleep and Paralyzed: two boards where the wide member is TRUE and all three
    // named ones are FALSE, which is what stops this sweep from being vacuous.
    expect(wideAndUnnamed).toBe(2);
  });

  it("🛑 ONE board carrying BOTH statuses pays BOTH bonuses, each at its own printed amount", () => {
    // The two attacks are declared off the SAME state, so nothing but the clause
    // differs between the runs — and the amounts are the printed 40 and 90, not one
    // number twice.
    const both = setConditions(board(42), "p2", { burned: true, rotation: "confused" });
    const roast = mustApply(roastheat(both), { type: "attack", seat: "p1", index: 0 }).events;
    expect(find(roast, "DAMAGE_DEALT")).toMatchObject({ base: 10, scaled: 40, dealt: 50 });
    const crush = mustApply(mindcrush(both), { type: "attack", seat: "p1", index: 1 }).events;
    expect(find(crush, "DAMAGE_DEALT")).toMatchObject({ base: 90, scaled: 90, dealt: 180 });
  });

  it("🛑 a BURNED defender does NOT pay the Confused bonus, and vice versa", () => {
    // The crossing that a copied arm would silently pass. Two boards, each carrying
    // exactly one status, each read by the attack that names the OTHER one.
    const burnedOnly = setConditions(board(43), "p2", { burned: true });
    const crush = mustApply(mindcrush(burnedOnly), { type: "attack", seat: "p1", index: 1 }).events;
    const crushDealt = find(crush, "DAMAGE_DEALT");
    expect(crushDealt).toMatchObject({ base: 90, dealt: 90 });
    expect(crushDealt?.scaled).toBeUndefined();

    const confusedOnly = setConditions(board(44), "p2", { rotation: "confused" });
    const roast = mustApply(roastheat(confusedOnly), { type: "attack", seat: "p1", index: 0 }).events;
    const roastDealt = find(roast, "DAMAGE_DEALT");
    expect(roastDealt).toMatchObject({ base: 10, dealt: 10 });
    expect(roastDealt?.scaled).toBeUndefined();
  });
});

describe("§6 — the SEAT axis: cross-board, per seat, and FALSE with no Active", () => {
  it("both members read the OPPONENT's Active and answer per seat", () => {
    const burned = setConditions(board(45), "p2", { burned: true });
    expect(conditionHolds(burned, "p1", BURNED)).toBe(true);
    expect(conditionHolds(burned, "p2", BURNED)).toBe(false);
    const mirrored = setConditions(board(45), "p1", { burned: true });
    expect(conditionHolds(mirrored, "p2", BURNED)).toBe(true);
    expect(conditionHolds(mirrored, "p1", BURNED)).toBe(false);

    const confused = setConditions(board(46), "p2", { rotation: "confused" });
    expect(conditionHolds(confused, "p1", CONFUSED)).toBe(true);
    expect(conditionHolds(confused, "p2", CONFUSED)).toBe(false);
    const mirroredC = setConditions(board(46), "p1", { rotation: "confused" });
    expect(conditionHolds(mirroredC, "p2", CONFUSED)).toBe(true);
    expect(conditionHolds(mirroredC, "p1", CONFUSED)).toBe(false);
  });

  it("🛑 a P2 declaration pays the same bonuses — not a p1-shaped reading", () => {
    // A p1-only suite cannot tell "reads the OPPONENT's Active" apart from "reads p2's
    // Active", so both printings are declared from the far seat on real boards.
    const burned = setConditions(boardP2(47), "p1", { burned: true });
    const roast = mustApply(roastheat(burned, "p2"), { type: "attack", seat: "p2", index: 0 }).events;
    expect(find(roast, "DAMAGE_DEALT")).toMatchObject({ base: 10, scaled: 40, dealt: 50 });

    const confused = setConditions(boardP2(48), "p1", { rotation: "confused" });
    const crush = mustApply(mindcrush(confused, "p2"), { type: "attack", seat: "p2", index: 1 }).events;
    expect(find(crush, "DAMAGE_DEALT")).toMatchObject({ base: 90, scaled: 90, dealt: 180 });
  });

  it("🛑 an EMPTY Active Spot answers FALSE rather than throwing — for both members", () => {
    // The live attack gate guarantees a Defending Pokémon, so no board reachable through
    // `attack` presents a null Active; only a direct `conditionHolds` call finds this
    // edge, and both new Active-reading members have to answer FALSE.
    const state = board(49);
    const side = state.players.p2;
    const active = side.active;
    if (active === null) throw new Error("p2 has no Active");
    const empty: GameState = {
      ...state,
      players: {
        ...state.players,
        p2: {
          ...side,
          active: null,
          discard: [...side.discard, ...active.stack, ...active.energy, ...active.tools],
        },
      },
    };
    expect(conditionHolds(empty, "p1", BURNED)).toBe(false);
    expect(conditionHolds(empty, "p1", CONFUSED)).toBe(false);
    // …and the wide member they narrow answers FALSE on the same board, so the three
    // agree about the edge as well as about the boards.
    expect(conditionHolds(empty, "p1", ANY_STATUS)).toBe(false);
  });
});
