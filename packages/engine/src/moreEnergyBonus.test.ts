import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import {
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
import type { BoardCondition, GameEvent, GameState, Seat } from "./index";
import { countAttachedEnergy, providedEnergy } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  MORE_ENERGY_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 🆕🆕 D384 — THE STRICT-INEQUALITY TWIN, TWELVE SLICES AFTER ITS OWN SLICE NAMED IT.
//
// D372 built *"this Pokémon and your opponent's Active Pokémon have the same amount of
// Energy attached"* and, in the same commit, wrote its near miss into four files: the
// SAME two operands, the SAME field, the SAME `countAttachedEnergy` call, and `>` where
// that row spells `=`. It priced the twin at one nullary member and one literal row,
// refused to build it (*"building it would have made the `===` → `>` mutant green for
// the wrong reason"*) and pinned the refusal in `sameEnergyBonus.test.ts` §3 so the day
// a reader claimed the sentence would redden by name.
//
//   Swalot `sv07-092` "Devouring Mouth" ({D}, 10+, **+160**)
//     *"If this Pokémon has more Energy attached than your opponent's Active Pokémon,
//      this attack does 160 more damage."*
//     **1 legal printing**
//
// ✅ **THE PRICE WAS RIGHT TO THE LINE, AND THAT IS THE RESULT WORTH RECORDING** (§1).
// One nullary `BoardCondition` member, one literal `CONDITIONAL_DAMAGE_CLAUSES` row,
// two exhaustive-switch arms in `interpreter.ts`, one fixture and one deck. ZERO new
// readers, ops, events, prompts, registry rows or `packages/schema` bytes — so
// `MATCH_RECORD_VERSION` stays 22. D199's rule says a `needs` column overstates as
// easily as it understates; this one did neither, and it was re-derived item by item
// against the code before a line was written rather than inherited from the handoff.
//
// 🛑 **TWO NULLARY MEMBERS, NOT ONE PARAMETERISED MEMBER — AND THE OPERATOR IS THE
// WHOLE ARGUMENT** (§3). Folding this into `activeEnergyCountsEqual` needs a member
// carrying an operator union, which is a GENERALISATION that renames a shipped nullary
// member: D362 priced that at 31 sites across 7 files, D365/D366 refused it twice and
// D383 refused it one member over. A second nullary member is free. What the two DO
// share is the read — the same call on the same two bodies — so the CARDS-vs-UNITS
// answer D372 settled cannot drift between them.
//
// 🛑 **IT IS THE FIRST CROSS-BODY MEMBER THAT IS SEAT-ASYMMETRIC IN VALUE, AND THAT IS
// A NEW SHAPE FOR THIS SUITE** (§4). `handSizesEqual`, `activeEnergyCountsEqual` and
// `inPlayTypesIntersect` all commute — every one of them answers the same on a board
// read from either seat, so a seat-blind implementation would have passed. `>` does
// not commute, so ONE board yields TWO DIFFERENT answers, and the far-seat rung stops
// being a formality: it is the only thing that can tell this member from its own
// inverse. D380's rule, reached by a member instead of by a board.
//
// 🛑 **AND THE `?? 0` SLIP IS WORSE ON THIS OPERATOR THAN ON THE EQUALITY** (§5).
// Reading a missing defender as zero arms this clause for an attacker holding a SINGLE
// card (1 > 0); the equality member had to be fooled at exactly zero. So the board that
// separates "empty" from "zero" here is the ORDINARY paying board rather than the
// unreachable unpaid one — the defect got easier to hit and easier to catch at once.
//
// ⚠️ **A MUTANT WAS RETIRED BY THIS SLICE.** D372's C5 inserted a SECOND clause-table
// entry for this sentence mapping onto the EQUAL member. The table is a `Map` built
// from an entry array, so the LAST duplicate key wins — and this slice's genuine row
// sits after C5's insertion point, which would have turned that mutant into a silent
// false SURVIVOR instead of an ERROR. **A `find` THAT STILL MATCHES EXACTLY ONCE IS NOT
// PROOF THE MUTANT STILL MEANS ANYTHING**: the exactly-once rule catches code that
// MOVED, never a premise a later slice made false. C5 is retired and D384's own C4
// carries the identical defect at this head.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/** The ten live readers, run as one — the same set `censusAtHead.test.ts` and
    `torrentialPump.test.ts` use. This slice adds NO reader, so the set is unchanged. */
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

/** THE SENTENCE THIS SLICE BUYS, byte-for-byte from the committed corpus, and the
    CLAUSE inside it that the table is keyed on. */
const TAKEN =
  "If this Pokémon has more Energy attached than your opponent's Active Pokémon, this attack does 160 more damage.";
const TAKEN_CLAUSE = "this Pokémon has more Energy attached than your opponent's Active Pokémon";

/** D372's sentence and member — the twin this one is separated from, kept here so the
    disjointness is driven on the real pair rather than asserted about it. */
const EQUAL_SENTENCE =
  "If this Pokémon and your opponent's Active Pokémon have the same amount of Energy attached, this attack does 100 more damage.";

const MORE: BoardCondition = { kind: "moreActiveEnergyThanOpponent" };
const EQUAL: BoardCondition = { kind: "activeEnergyCountsEqual" };

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: MORE_ENERGY_DECK, p2: MORE_ENERGY_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** The seat's opposite. Spelled once here rather than imported, because this member
    is seat-relative in VALUE and every board below has to name a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

/** `fix-moreenergy` in `seat`'s Active Spot with the `{C}` paid by ONE `fix-energy`
    — so the attacking body starts at exactly ONE attached CARD — `fix-energyholder`
    across the table holding NOTHING, and BOTH benches EMPTY. That opening board is
    already an ARMED one (1 > 0), which is the difference from D372's `ready`: an
    equality needs a matching count to pay, a strict inequality pays by default.
    `board` opens P1's turn, so a P2 case passes once more. */
function ready(seed: number, seat: Seat = "p1"): GameState {
  let state = board(seed);
  if (seat === "p2") state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = setActiveFromDeck(state, seat, "fix-moreenergy");
  state = attachFromDeck(state, seat, "fix-energy", 1);
  state = setActiveFromDeck(state, other(seat), "fix-energyholder");
  return clearBench(clearBench(state, seat), other(seat));
}

/** Attack index 0 from `seat` and report the damage actually dealt. */
function damageDealt(state: GameState, seat: Seat = "p1"): number {
  const after = mustApply(state, { type: "attack", seat, index: 0 });
  const dealt = after.events.find((e: GameEvent) => e.type === "DAMAGE_DEALT") as
    | { dealt?: number }
    | undefined;
  return dealt?.dealt ?? 0;
}

/** TEST SURGERY, local to this file: move `count` copies of `cardId` from the seat's
    deck onto bench[index]'s energy. `attachFromDeck` reaches the ACTIVE only, and the
    rung that separates "the two Active BODIES" from "the two SIDES" needs Energy
    somewhere the member must not see. Every uid stays in exactly one zone. */
function attachOnBench(
  state: GameState,
  seat: Seat,
  index: number,
  cardId: string,
  count: number,
): GameState {
  const side = state.players[seat];
  const uids = side.deck.filter((uid) => state.cardIdByUid[uid] === cardId).slice(0, count);
  const body = side.bench[index];
  if (uids.length < count) throw new Error(`${seat} deck has ${uids.length} ${cardId}`);
  if (body === undefined) throw new Error(`${seat} has no benched Pokémon at ${index}`);
  const taken = new Set(uids);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((uid) => !taken.has(uid)),
        bench: side.bench.map((p, i) => (i === index ? { ...p, energy: [...p.energy, ...uids] } : p)),
      },
    },
  };
}

/** TEST SURGERY: empty an Active Spot. No legal action reaches this board — a seat
    with no Active has lost — but the member commits to answering FALSE there, and a
    commitment nothing drives is a comment. */
function emptyActive(state: GameState, seat: Seat): GameState {
  return {
    ...state,
    players: { ...state.players, [seat]: { ...state.players[seat], active: null } },
  };
}

/** How many Energy CARDS and how many UNITS `seat`'s Active is holding — the two
    readings of the printed noun, side by side, so a board that is supposed to separate
    them can be shown to. */
function cardsAndUnits(state: GameState, seat: Seat): readonly [number, number] {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active Pokémon`);
  return [countAttachedEnergy(state, active, null), providedEnergy(state, active).length];
}

describe("§1 — the price, RE-DERIVED, and BOTH consequents asked", () => {
  it("🛑 ONE sentence, ONE printing — and the clause is the whole population", () => {
    // Asserted as records AND as units, because those are the two columns the census
    // rungs are keyed on, and this is the family's first 1:1 step (D368 moved the
    // printing term by 3, D369-D376 by 2 each, D377 by 3, D380 by 6).
    const records = corpus().filter(([, s]) => s === TAKEN);
    expect(records).toHaveLength(1);
    expect(units(records)).toBe(1);
    // …and the CLAUSE is the whole population: no second sentence in the corpus
    // carries it under any amount, so the row cannot be short and cannot rot on a
    // reprint at a new number.
    const clauseRows = corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === TAKEN_CLAUSE);
    expect(clauseRows).toHaveLength(1);
    expect(units(clauseRows)).toBe(1);
    // ⚠️ THE ID BEHIND IT IS A WEB MEASUREMENT AND NOT A CATALOG ONE: this container
    // has no D1 credentials and the committed corpus carries sentences with counts and
    // no ids. limitlesstcg's tokenised text search offered Swalot (SCR 92) as the only
    // Standard-era candidate and `https://api.tcgdex.net/v2/en/cards/sv07-092` then
    // returned the name, the {D} cost, the `10+` base and this effect text
    // byte-for-byte at index 0 of two. Nothing on this path NEEDS the id — a literal
    // row is keyed on the printed clause and serves every printing in every set — so it
    // is recorded as provenance and asserted against nothing.
  });

  it("🛑 BOTH consequents were asked, and the CANCEL side is EMPTY", () => {
    // D379's rule, and the four slices before it (D363/D365/D377/D378) each put a
    // member in BOTH clause tables while D379 found one the CANCEL consequent alone
    // justified. So the sweep is over the OPERAND rather than over this sentence: every
    // corpus row mentioning Energy counted "than" another body, under any consequent.
    const family = corpus().filter(([, s]) => s.includes("Energy attached than"));
    expect(family).toHaveLength(1);
    expect(family[0]?.[1]).toBe(TAKEN);
    // …so there is no "…this attack does nothing." twin and no `ATTACK_REQUIREMENT_CLAUSES`
    // row is owed. Measured, not assumed — and the negative is spelled out so a
    // successor does not re-run the sweep to find out it was already run.
    expect(corpus().filter(([, s]) => s.includes("Energy attached than") && s.includes("this attack does nothing"))).toHaveLength(0);
  });

  it("🛑 the bonus residue steps by exactly ONE sentence and ONE printing", () => {
    // Re-derived off the same instrument the family has used since D368 — the live
    // readers over `legalAttackCorpus()` — rather than decremented from prose. The
    // DEPARTURE and the SIZE are asserted separately: a guard that only checked the
    // totals could not tell "the row landed" from "a reader broke".
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    // 🆕🆕 D386 — 20 / 24 -> 19 / 22: the HEALED-THIS-TURN clause left this residue —
    // ONE sentence at TWO printings (Maractus `sv10.5b-008`/`-093` "Lively Needles",
    // +100) — re-derived live rather than decremented. 🛑 AND IT EMPTIES THE 2-PRINTING
    // BAND: it was the last clause in it, so every band rung below is re-aimed off the
    // WHOLE distribution rather than off a list that can no longer be non-empty (D379).
    expect(refused.length).toBe(19);
    expect(units(refused)).toBe(22);
    // …and the step is 1 and 1, the NARROWEST this chain has taken. Written as an
    // offset off the live head, which is what makes it re-derive rather than freeze.
    expect([refused.length + 2, units(refused) + 3]).toEqual([21, 25]);
  });

  it("🛑 D207's SUPPLY question does not ARISE, and that is a result rather than a skip", () => {
    // The member reads `InPlayPokemon.energy`: a GAME-STATE array the engine writes
    // itself on every attach the rules allow. There is no catalog column to be empty,
    // so the permanently-empty-candidate-set failure is unreachable by construction
    // rather than merely unobserved — and it is driven, on a board built by legal
    // setup plus this file's surgery.
    const state = attachFromDeck(ready(9200), "p2", "fix-energy", 2);
    expect(cardsAndUnits(state, "p1")[0]).toBe(1);
    expect(cardsAndUnits(state, "p2")[0]).toBe(2);
  });
});

describe("§2 — CARDS, not UNITS — and under `>` the wrong reading INVERTS", () => {
  it("🛑 one Special against one basic: 1 = 1 by CARD (false) and 2 > 1 by UNIT (true)", () => {
    // D372 settled the noun by FINDING the engine's answer rather than choosing one:
    // `countAttachedEnergy(…, null)` is the unfiltered CARD count, and *"one Energy
    // card is one Energy however many units it provides"* is its own doc block's
    // sentence. This member delegates to the identical call, so the two cannot drift.
    //
    // ⚠️ AND THE BOARD IS SHARPER HERE THAN IT WAS THERE. Under `===` a unit reading
    // merely disagreed; under `>` it answers the OPPOSITE on this board, so the wrong
    // noun is not a near miss but an inversion.
    let state = ready(9201);
    state = attachFromDeck(state, "p1", "fix-blend", 1); // p1 Active: 2 cards, 3 units
    expect(cardsAndUnits(state, "p1")).toEqual([2, 3]);
    expect(cardsAndUnits(state, "p2")).toEqual([0, 0]);
    // The narrow board: strip the attacker back to the Special alone against one basic.
    let level = ready(9202);
    level = attachFromDeck(level, "p2", "fix-blend", 1); // p2 Active: 1 card, 2 units
    expect(cardsAndUnits(level, "p1")).toEqual([1, 1]);
    expect(cardsAndUnits(level, "p2")).toEqual([1, 2]);
    // CARDS say 1 > 1 is FALSE; UNITS say 1 > 2 is FALSE too, so this board alone
    // proves nothing. It is the SEAT SWAP that separates them: from p2, CARDS say
    // 1 > 1 FALSE and UNITS say 2 > 1 TRUE.
    expect(conditionHolds(level, "p2", MORE)).toBe(false);
    expect(conditionHolds(level, "p1", MORE)).toBe(false);
    // …and the equality member answers TRUE on the same board, which is the pair's
    // disjointness driven rather than argued.
    expect(conditionHolds(level, "p1", EQUAL)).toBe(true);
    expect(conditionHolds(level, "p2", EQUAL)).toBe(true);
  });

  it("🛑 …and the other direction, which is the attribution control", () => {
    // Two basics against one Special: 2 > 1 by CARD (TRUE) and 2 > 2 by UNIT (FALSE),
    // so a unit reading answers FALSE exactly where the card reading answers TRUE. The
    // board above alone would be satisfied by a member that answered FALSE on any
    // `fix-blend` board for any reason at all.
    let state = attachFromDeck(ready(9203), "p1", "fix-energy", 1); // p1: 2 cards, 2 units
    state = attachFromDeck(state, "p2", "fix-blend", 1); // p2: 1 card, 2 units
    expect(cardsAndUnits(state, "p1")).toEqual([2, 2]);
    expect(cardsAndUnits(state, "p2")).toEqual([1, 2]);
    expect(conditionHolds(state, "p1", MORE)).toBe(true);
    expect(damageDealt(state)).toBe(170);
  });
});

describe("§3 — the round trip, and the TWIN it must not become", () => {
  it("the printed sentence resolves to this member at the printed amount", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 160,
      count: { kind: "boardCondition", cond: MORE },
    });
    // The amount lives in the skeleton's capture, so a reprint at a third number
    // resolves off the same row the day one is printed.
    expect(deriveAttackDamageBonus(TAKEN.replace("160", "40"))).toEqual({
      per: 40,
      count: { kind: "boardCondition", cond: MORE },
    });
  });

  it("🛑 the EQUAL twin still resolves to the OTHER member — neither row claims the other", () => {
    // The failure this rung exists for is the one D372's C5 mutant spelled: a row that
    // maps this sentence onto the equality member. It compiles, it looks like one more
    // legal printing for free, and it is wrong on every board where the attacker leads.
    // ⚠️ **THE TABLE IS A `Map` AND THE LAST DUPLICATE KEY WINS**, so a stray second row
    // for either sentence is silent unless something asserts the pairing in both
    // directions. Both directions are asserted here.
    expect(deriveAttackDamageBonus(TAKEN)?.count).toEqual({ kind: "boardCondition", cond: MORE });
    expect(deriveAttackDamageBonus(EQUAL_SENTENCE)?.count).toEqual({
      kind: "boardCondition",
      cond: EQUAL,
    });
    expect(deriveAttackDamageBonus(TAKEN)?.count).not.toEqual({
      kind: "boardCondition",
      cond: EQUAL,
    });
    // Keys are whole printed clauses and never substrings, so neither row can reach the
    // other's sentence by construction — driven rather than commented.
    expect(TAKEN_CLAUSE.includes("have the same amount of Energy attached")).toBe(false);
  });

  it("this sentence carries no CANCEL head, so the requirement reader refuses it", () => {
    expect(deriveAttackRequirement(TAKEN)).toBeNull();
    expect(TAKEN.includes("this attack does nothing")).toBe(false);
  });

  it("the U+2019 spelling folds, through the literal table's own retry", () => {
    // The clause key spells a possessive ("your opponent's"), so it is the fold's
    // population. `literalClauseRow` retries a miss with U+2019 folded to U+0027.
    const curly = TAKEN.replace(/'/g, "’");
    expect(curly).not.toBe(TAKEN);
    expect(deriveAttackDamageBonus(curly)).toEqual(deriveAttackDamageBonus(TAKEN));
  });

  it("the note is prose for a person and does NOT round-trip to the printed bytes", () => {
    // D116's pronoun rule: the note names the body a reader can see on the board rather
    // than the one the card's own text points at. Stated as an assertion so a successor
    // does not "fix" the note into the row's key.
    expect(conditionNote(MORE)).toBe(
      "your Active Pokémon has more Energy attached than your opponent's Active Pokémon",
    );
    expect(conditionNote(MORE)).not.toBe(TAKEN_CLAUSE);
    expect(deriveAttackDamageBonus(`If ${conditionNote(MORE)}, this attack does 160 more damage.`))
      .toBeNull();
    // …and it is not the twin's note either: the two differ in their VERB, which is the
    // one place a copy-paste of the neighbouring arm would go undetected.
    expect(conditionNote(MORE)).not.toBe(conditionNote(EQUAL));
  });
});

describe("§4 — SEAT ASYMMETRY: one board, two DIFFERENT answers", () => {
  it("🛑 the VALUE does NOT commute — the first member in this family where it does not", () => {
    // `handSizesEqual`, `activeEnergyCountsEqual` and `inPlayTypesIntersect` all
    // commute, so a seat-blind implementation of any of them passes a two-seat sweep.
    // `>` does not: on a board where p1 leads, this member is TRUE from p1 and FALSE
    // from p2, and those are two DIFFERENT answers rather than one re-derived twice.
    // **THIS IS THE RUNG THAT TELLS THE MEMBER FROM ITS OWN INVERSE**, and no board in
    // `sameEnergyBonus.test.ts` could have done it.
    const p1Leads = attachFromDeck(ready(9210), "p1", "fix-energy", 1);
    expect(cardsAndUnits(p1Leads, "p1")[0]).toBe(2);
    expect(cardsAndUnits(p1Leads, "p2")[0]).toBe(0);
    expect(conditionHolds(p1Leads, "p1", MORE)).toBe(true);
    expect(conditionHolds(p1Leads, "p2", MORE)).toBe(false);
    // …and the mirror board, so the asymmetry is shown to run both ways rather than
    // being a property of p1: p2's Active ahead makes p2 TRUE and p1 FALSE.
    const p2Leads = attachFromDeck(ready(9211), "p2", "fix-energy", 3);
    expect(cardsAndUnits(p2Leads, "p1")[0]).toBe(1);
    expect(cardsAndUnits(p2Leads, "p2")[0]).toBe(3);
    expect(conditionHolds(p2Leads, "p1", MORE)).toBe(false);
    expect(conditionHolds(p2Leads, "p2", MORE)).toBe(true);
    // The equality member is symmetric on both of those boards, which is the contrast
    // that makes the claim mean something.
    for (const seat of ["p1", "p2"] as const) {
      expect(conditionHolds(p1Leads, seat, EQUAL)).toBe(false);
      expect(conditionHolds(p2Leads, seat, EQUAL)).toBe(false);
    }
  });

  it("and it holds through a real attack from the FAR seat", () => {
    // A p1-only suite cannot tell "reads the attacker's Active against the defender's"
    // from "reads p1's against p2's" — the seat check every member in this family owes,
    // and the one that actually bites here.
    const state = ready(9212, "p2");
    expect(cardsAndUnits(state, "p2")[0]).toBe(1);
    expect(cardsAndUnits(state, "p1")[0]).toBe(0);
    expect(damageDealt(state, "p2")).toBe(170);
  });
});

describe("§5 — the boards", () => {
  it("ONE against ZERO is the paying board — the printed +160", () => {
    const state = ready(9220);
    expect(cardsAndUnits(state, "p1")[0]).toBe(1);
    expect(cardsAndUnits(state, "p2")[0]).toBe(0);
    expect(conditionHolds(state, "p1", MORE)).toBe(true);
    expect(damageDealt(state)).toBe(170);
  });

  it("🛑 EQUAL is FALSE — the board that kills `>=`, and the twin's TRUE board", () => {
    // "More than" is not "at least", and `>` → `>=` is one keystroke on an arm whose
    // neighbour four lines up genuinely spells `>=` (`yourActiveEnergyAtLeast`). The
    // equal board is the ONLY board that separates them, and it is exactly the board
    // `activeEnergyCountsEqual` pays on — so the two members are shown disjoint on the
    // one board where a confusion between them would be invisible.
    const state = attachFromDeck(ready(9221), "p2", "fix-energy", 1);
    expect(cardsAndUnits(state, "p1")[0]).toBe(1);
    expect(cardsAndUnits(state, "p2")[0]).toBe(1);
    expect(conditionHolds(state, "p1", MORE)).toBe(false);
    expect(conditionHolds(state, "p1", EQUAL)).toBe(true);
    expect(damageDealt(state)).toBe(10);
  });

  it("the attacker holding FEWER is false, and it is a COMPARISON rather than a number", () => {
    // 1 against 2 and 2 against 5: the member is not a threshold on either operand, so
    // a board with a bigger attacker count that is still behind must stay FALSE.
    const one = attachFromDeck(ready(9222), "p2", "fix-energy", 2);
    expect(conditionHolds(one, "p1", MORE)).toBe(false);
    expect(damageDealt(one)).toBe(10);
    let two = attachFromDeck(ready(9223), "p1", "fix-energy", 1);
    two = attachFromDeck(two, "p2", "fix-energy", 5);
    expect(cardsAndUnits(two, "p1")[0]).toBe(2);
    expect(cardsAndUnits(two, "p2")[0]).toBe(5);
    expect(conditionHolds(two, "p1", MORE)).toBe(false);
    expect(damageDealt(two)).toBe(10);
  });

  it("…and it is not a threshold on the ATTACKER either: 4 against 4 is still false", () => {
    // The mirror of the rung above. A member that read "the attacker holds at least N"
    // passes every board where the attacker leads AND this one, so the equal board has
    // to be driven at a count well above zero as well as at one.
    let state = attachFromDeck(ready(9224), "p1", "fix-energy", 3);
    state = attachFromDeck(state, "p2", "fix-energy", 4);
    expect(cardsAndUnits(state, "p1")[0]).toBe(4);
    expect(cardsAndUnits(state, "p2")[0]).toBe(4);
    expect(conditionHolds(state, "p1", MORE)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("🛑 THE ZONE IS THE BODY: benched Energy is invisible, in both directions", () => {
    // `countEnergyInPlay(state, seat, null)` is one identifier away in
    // `interpreter.ts`'s own import block and answers Active PLUS Bench. Two boards,
    // because a single one is passed by any member that ignores the Bench by accident.
    //
    // (a) the two Actives are LEVEL and p1's SIDE leads: a seat-wide reading answers
    // TRUE where the body reading answers FALSE.
    let level = attachFromDeck(ready(9225), "p2", "fix-energy", 1);
    level = benchFromDeck(level, "p1", "fix-basic-1");
    level = attachOnBench(level, "p1", 0, "fix-energy", 2);
    expect(cardsAndUnits(level, "p1")[0]).toBe(1);
    expect(cardsAndUnits(level, "p2")[0]).toBe(1);
    expect(conditionHolds(level, "p1", MORE)).toBe(false);
    expect(damageDealt(level)).toBe(10);

    // (b) p1's ACTIVE leads and p2's SIDE leads: the body reading answers TRUE exactly
    // where a seat-wide reading answers FALSE.
    let split = attachFromDeck(ready(9226), "p1", "fix-energy", 1);
    split = benchFromDeck(split, "p2", "fix-basic-1");
    split = attachOnBench(split, "p2", 0, "fix-energy", 5);
    expect(cardsAndUnits(split, "p1")[0]).toBe(2);
    expect(cardsAndUnits(split, "p2")[0]).toBe(0);
    expect(conditionHolds(split, "p1", MORE)).toBe(true);
    expect(damageDealt(split)).toBe(170);
  });

  it("🛑 an EMPTY Active Spot is FALSE on either side, and `?? 0` is what that refuses", () => {
    // An absent Pokémon is not a Pokémon holding zero Energy. ⚠️ **AND THE SLIP IS
    // WORSE ON THIS OPERATOR THAN ON THE EQUALITY**: reading a missing DEFENDER as 0
    // arms this clause for an attacker holding one card (1 > 0), where the equality
    // member had to be fooled at exactly zero. So the board that separates "empty" from
    // "zero" here is the ORDINARY paying board, not an unreachable unpaid one.
    const paid = ready(9227);
    expect(cardsAndUnits(paid, "p1")[0]).toBe(1);
    expect(conditionHolds(emptyActive(paid, "p2"), "p1", MORE)).toBe(false);
    expect(conditionHolds(emptyActive(paid, "p1"), "p1", MORE)).toBe(false);
    // …and the both-empty board, where a zero-reading member is most obviously wrong:
    // no Pokémon on either side and nothing for a comparison to be about.
    expect(conditionHolds(emptyActive(emptyActive(paid, "p1"), "p2"), "p1", MORE)).toBe(false);
    // The far seat too, because the null guard has two sides and this member's answer
    // is seat-dependent: from p2 the same boards must also be FALSE.
    expect(conditionHolds(emptyActive(paid, "p1"), "p2", MORE)).toBe(false);
    expect(conditionHolds(emptyActive(paid, "p2"), "p2", MORE)).toBe(false);
  });
});

describe("§6 — the census moves in exactly ONE summand, and the step is 1 and 1", () => {
  it("the resolving corpus gains ONE sentence and ONE printing", () => {
    const resolved = corpus().filter(([, s]) => resolvedByAnyReader(s));
    // 🆕🆕 D385 — 366 -> **367** / 1,262 -> **1,263**, THE SECOND CONNECTIVE (Veluza ex
    // `sv09-043` "Purging Strike", 1 legal printing). The head moved and the OFFSET
    // below is what this rung is about, so it is re-derived rather than frozen — the
    // rule D384 wrote into `exactHandSize.test.ts` one file over, paid here.
    // 🆕🆕 D386 — 367 -> **368** / 1,263 -> **1,265**, THE HEALED-THIS-TURN CLAUSE
    // (Maractus `sv10.5b-008`/`-093` "Lively Needles", 2 legal printings). A 1:2 step,
    // so the two subtrahends below diverge again — which is the whole reason this rung
    // is written as an offset off the live head rather than as a frozen pair.
    expect(resolved).toHaveLength(368);
    expect(units(resolved)).toBe(1265);
    // The step, as an offset off the live head rather than a frozen pair. It is the
    // family's first 1:1 step: D368 moved 1:3, D369-D376 1:2 each, D377 3:3, D378 2:3,
    // D379 1:2, D380 2:6, D382 1:1 on the OTHER instrument and D383 1:5.
    expect([resolved.length - 3, units(resolved) - 4]).toEqual([365, 1261]);
  });

  it("🛑 the move is READER-keyed: no registry row and no gate clause", () => {
    // The two hand-carried summands `censusAtHead.test.ts` splits `BUILT.attack` into
    // stand still, and that is measured rather than assumed: the printed sentence
    // carries no "does nothing" head, so `splitAttackGateClause` cannot see it, and this
    // slice authors no registry row at all.
    expect(deriveAttackRequirement(TAKEN)).toBeNull();
    expect(TAKEN.includes("this attack does nothing")).toBe(false);
  });
});
