import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackCopy,
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
import { countAttachedEnergy, providedEnergy } from "./index";
import { conditionHolds, conditionNote } from "./boardCondition";
import {
  MORE_ENERGY_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

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
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackCancelRequirement,
];

const TAKEN =
  "If this Pokémon has more Energy attached than your opponent's Active Pokémon, this attack does 160 more damage.";
const TAKEN_CLAUSE = "this Pokémon has more Energy attached than your opponent's Active Pokémon";

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
        bench: side.bench.map((p, i) =>
          i === index ? { ...p, energy: [...p.energy, ...uids] } : p,
        ),
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
  it("ONE sentence, ONE printing — and the clause is the whole population", () => {
    const records = corpus().filter(([, s]) => s === TAKEN);
    expect(records).toHaveLength(1);
    expect(units(records)).toBe(1);
    const clauseRows = corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === TAKEN_CLAUSE);
    expect(clauseRows).toHaveLength(1);
    expect(units(clauseRows)).toBe(1);
  });

  it("BOTH consequents were asked, and the CANCEL side is EMPTY", () => {
    const family = corpus().filter(([, s]) => s.includes("Energy attached than"));
    expect(family).toHaveLength(1);
    expect(family[0]?.[1]).toBe(TAKEN);
    expect(
      corpus().filter(
        ([, s]) => s.includes("Energy attached than") && s.includes("this attack does nothing"),
      ),
    ).toHaveLength(0);
  });

  it("the bonus residue steps by exactly ONE sentence and ONE printing", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    expect(refused.length).toBe(0);
    expect(units(refused)).toBe(0);
    expect([refused.length + 21, units(refused) + 25]).toEqual([21, 25]);
  });

  it("D207's SUPPLY question does not ARISE, and that is a result rather than a skip", () => {
    const state = attachFromDeck(ready(9200), "p2", "fix-energy", 2);
    expect(cardsAndUnits(state, "p1")[0]).toBe(1);
    expect(cardsAndUnits(state, "p2")[0]).toBe(2);
  });
});

describe("§2 — CARDS, not UNITS — and under `>` the wrong reading INVERTS", () => {
  it("one Special against one basic: 1 = 1 by CARD (false) and 2 > 1 by UNIT (true)", () => {
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

  it("…and the other direction, which is the attribution control", () => {
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
    expect(deriveAttackDamageBonus(TAKEN.replace("160", "40"))).toEqual({
      per: 40,
      count: { kind: "boardCondition", cond: MORE },
    });
  });

  it("the EQUAL twin still resolves to the OTHER member — neither row claims the other", () => {
    expect(deriveAttackDamageBonus(TAKEN)?.count).toEqual({ kind: "boardCondition", cond: MORE });
    expect(deriveAttackDamageBonus(EQUAL_SENTENCE)?.count).toEqual({
      kind: "boardCondition",
      cond: EQUAL,
    });
    expect(deriveAttackDamageBonus(TAKEN)?.count).not.toEqual({
      kind: "boardCondition",
      cond: EQUAL,
    });
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
    expect(conditionNote(MORE)).toBe(
      "your Active Pokémon has more Energy attached than your opponent's Active Pokémon",
    );
    expect(conditionNote(MORE)).not.toBe(TAKEN_CLAUSE);
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(MORE)}, this attack does 160 more damage.`),
    ).toBeNull();
    // …and it is not the twin's note either: the two differ in their VERB, which is the
    // one place a copy-paste of the neighbouring arm would go undetected.
    expect(conditionNote(MORE)).not.toBe(conditionNote(EQUAL));
  });
});

describe("§4 — SEAT ASYMMETRY: one board, two DIFFERENT answers", () => {
  it("the VALUE does NOT commute — the first member in this family where it does not", () => {
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

  it("EQUAL is FALSE — the board that kills `>=`, and the twin's TRUE board", () => {
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

  it("THE ZONE IS THE BODY: benched Energy is invisible, in both directions", () => {
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

  it("an EMPTY Active Spot is FALSE on either side, and `?? 0` is what that refuses", () => {
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
  it("D418 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the resolving corpus gains ONE sentence and ONE printing", () => {
    const resolved = corpus().filter(([, s]) => resolvedByAnyReader(s));
    expect(resolved).toHaveLength(600);
    expect(units(resolved)).toBe(1663);
    expect([
      resolved.length -
        6 -
        3 -
        4 -
        4 -
        2 -
        2 -
        1 -
        4 -
        1 -
        2 -
        2 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        3 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        2 -
        1 -
        1 -
        2 -
        1 -
        2 -
        3 -
        1 -
        1 -
        2 -
        2 -
        2 -
        3 -
        3 -
        2 -
        2 -
        3 -
        5 -
        3 -
        2 -
        3 -
        1 -
        4 -
        5 -
        2 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        3 -
        1 -
        1 -
        2 -
        3 -
        3 -
        1 -
        1 -
        3 -
        1 -
        2 -
        1 -
        3 -
        2 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        6 -
        4 -
        2 -
        3 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        3,
      units(resolved) -
        6 -
        5 -
        9 -
        6 -
        2 -
        2 -
        1 -
        4 -
        2 -
        4 -
        2 -
        2 -
        2 -
        1 -
        1 -
        2 -
        3 -
        2 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        2 -
        1 -
        2 -
        3 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        4 -
        1 -
        2 -
        2 -
        2 -
        1 -
        2 -
        5 -
        1 -
        1 -
        2 -
        2 -
        2 -
        1 -
        1 -
        1 -
        3 -
        3 -
        1 -
        2 -
        2 -
        2 -
        4 -
        4 -
        2 -
        2 -
        3 -
        3 -
        2 -
        5 -
        3 -
        2 -
        3 -
        3 -
        9 -
        6 -
        5 -
        3 -
        2 -
        8 -
        8 -
        3 -
        3 -
        5 -
        1 -
        3 -
        3 -
        3 -
        3 -
        5 -
        6 -
        6 -
        5 -
        5 -
        3 -
        5 -
        4 -
        1 -
        6 -
        1 -
        4 -
        5 -
        7 -
        4 -
        5 -
        5 -
        7 -
        8 -
        13 -
        7 -
        9 -
        5 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        4,
    ]).toEqual([381, 1285]);
  });

  it("the move is READER-keyed: no registry row and no gate clause", () => {
    expect(deriveAttackRequirement(TAKEN)).toBeNull();
    expect(TAKEN.includes("this attack does nothing")).toBe(false);
  });
});
