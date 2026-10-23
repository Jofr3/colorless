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
import { conditionHolds, conditionNote } from "./interpreter";
import {
  SAME_ENERGY_DECK,
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

const TAKEN_100 =
  "If this Pokémon and your opponent's Active Pokémon have the same amount of Energy attached, this attack does 100 more damage.";
const TAKEN_120 =
  "If this Pokémon and your opponent's Active Pokémon have the same amount of Energy attached, this attack does 120 more damage.";
const TAKEN_CLAUSE =
  "this Pokémon and your opponent's Active Pokémon have the same amount of Energy attached";

const STRICTLY_MORE =
  "If this Pokémon has more Energy attached than your opponent's Active Pokémon, this attack does 160 more damage.";

const EQUAL: BoardCondition = { kind: "activeEnergyCountsEqual" };

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: SAME_ENERGY_DECK, p2: SAME_ENERGY_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** The seat's opposite. Spelled once here rather than imported, because the member
    is seat-relative on the FACE of it and every board case below names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

function ready(seed: number, seat: Seat = "p1", attacker = "fix-sameenergy"): GameState {
  let state = board(seed);
  if (seat === "p2") state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = setActiveFromDeck(state, seat, attacker);
  state = attachFromDeck(state, seat, "fix-energy", 1);
  state = setActiveFromDeck(state, other(seat), "fix-energyholder");
  return clearBench(clearBench(state, seat), other(seat));
}

function unpaid(seed: number): GameState {
  const state = setActiveFromDeck(
    setActiveFromDeck(board(seed), "p1", "fix-sameenergy"),
    "p2",
    "fix-energyholder",
  );
  return clearBench(clearBench(state, "p1"), "p2");
}

/** Attack index 0 from `seat` and report the damage actually dealt. */
function damageDealt(state: GameState, seat: Seat = "p1"): number {
  const after = mustApply(state, { type: "attack", seat, index: 0 });
  const dealt = after.events.find((e: GameEvent) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
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
    readings of the printed noun, side by side, so a board that is supposed to
    separate them can be shown to. */
function cardsAndUnits(state: GameState, seat: Seat): readonly [number, number] {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active Pokémon`);
  return [countAttachedEnergy(state, active, null), providedEnergy(state, active).length];
}

describe("§1 — the price, RE-DERIVED: the residue, the band, and a step of TWO sentences", () => {
  it("the residue steps by exactly these TWO sentences, and the band by exactly one CLAUSE", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    expect(refused.some(([, s]) => s === TAKEN_100)).toBe(false);
    expect(refused.some(([, s]) => s === TAKEN_120)).toBe(false);
    expect(refused.length).toBe(0);
    expect(units(refused)).toBe(0);
    expect([refused.length + 24, units(refused) + 28]).toEqual([24, 28]);
    expect([refused.length + 25, units(refused) + 30]).toEqual([25, 30]);
    expect([refused.length + 26, units(refused) + 32]).toEqual([26, 32]);
    expect([refused.length + 27, units(refused) + 34]).toEqual([27, 34]);
    expect([refused.length + 28, units(refused) + 36]).toEqual([28, 36]);
    expect([refused.length + 30, units(refused) + 38]).toEqual([30, 38]);
    expect([refused.length + 31, units(refused) + 40]).toEqual([31, 40]);
    expect([refused.length + 32, units(refused) + 42]).toEqual([32, 42]);
    expect([refused.length + 33, units(refused) + 44]).toEqual([33, 44]);

    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    const band = [...byClause].filter(([, n]) => n === 2).map(([clause]) => clause);
    expect(band).toEqual([]);
    expect([...byClause.values()].filter((n) => n > 1)).toEqual([]);
    expect(byClause.size).toBe(0);
    expect(band.length + 2).toBe(2);
    expect(band.length + 3).toBe(3);
    expect(band.length + 4).toBe(4);
    expect(band.length + 5).toBe(5);
    expect(band.length + 6).toBe(6);
    expect(band.length + 7).toBe(7);
    expect(band.length + 8).toBe(8);
    expect([...byClause.values()]).toEqual([]);
  });

  it("TWO sentences, ONE clause, ONE printing each — and that is ALL of them", () => {
    const records = corpus().filter(([, s]) => s === TAKEN_100 || s === TAKEN_120);
    expect(records).toHaveLength(2);
    expect(units(records)).toBe(2);
    for (const [n] of records) expect(n).toBe(1);
    const clauseRows = corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === TAKEN_CLAUSE);
    expect(clauseRows).toHaveLength(2);
    expect(units(clauseRows)).toBe(2);
  });

  it("D207's SUPPLY question does not ARISE here, and that is a result rather than a skip", () => {
    const state = attachFromDeck(ready(9100), "p2", "fix-energy", 2);
    expect(cardsAndUnits(state, "p1")[0]).toBe(1);
    expect(cardsAndUnits(state, "p2")[0]).toBe(2);
  });
});

describe("§2 — the SHAPE question: CARDS, not UNITS, and the engine had already decided", () => {
  it("`countAttachedEnergy(…, null)` IS the card count, and the two readings DISAGREE on a board", () => {
    let state = attachFromDeck(ready(9101), "p1", "fix-energy", 1); // p1 Active: 2 cards
    state = attachFromDeck(state, "p2", "fix-blend", 1); // p2 Active: 1 card, 2 units
    expect(cardsAndUnits(state, "p1")).toEqual([2, 2]);
    expect(cardsAndUnits(state, "p2")).toEqual([1, 2]);
    // THE UNITS AGREE AND THE CARDS DO NOT. The member reads CARDS, so it is FALSE.
    expect(conditionHolds(state, "p1", EQUAL)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("…and the OTHER direction, which is the attribution control", () => {
    let state = attachFromDeck(ready(9102), "p1", "fix-energy", 1); // p1 Active: 2 cards, 2 units
    state = attachFromDeck(state, "p2", "fix-blend", 2); // p2 Active: 2 cards, 4 units
    expect(cardsAndUnits(state, "p1")).toEqual([2, 2]);
    expect(cardsAndUnits(state, "p2")).toEqual([2, 4]);
    expect(conditionHolds(state, "p1", EQUAL)).toBe(true);
    expect(damageDealt(state)).toBe(110);
  });

  it("the rule is `countAttachedEnergy`'s and is not restated here", () => {
    // The member delegates, so the two readings of the printed noun cannot drift:
    // whatever the §6.3 counter says about a Special is what this clause says. Shown
    // by equality against the helper on the same bodies rather than by a comment.
    let state = attachFromDeck(ready(9103), "p1", "fix-blend", 1);
    state = attachFromDeck(state, "p2", "fix-blend", 2);
    const p1 = state.players.p1.active;
    const p2 = state.players.p2.active;
    if (p1 === null || p2 === null) throw new Error("board has an empty Active Spot");
    expect(countAttachedEnergy(state, p1, null)).toBe(2);
    expect(countAttachedEnergy(state, p2, null)).toBe(2);
    expect(conditionHolds(state, "p1", EQUAL)).toBe(true);
    // …and a SPECIAL counts as one card here exactly as a basic does, which is the
    // sentence `countAttachedEnergy`'s doc block spells out.
    expect(providedEnergy(state, p1).length).toBe(3);
    expect(providedEnergy(state, p2).length).toBe(4);
  });
});

describe("§3 — the round trip, and the printed near miss that stays REFUSED", () => {
  it("both printed sentences resolve to ONE member at TWO amounts", () => {
    for (const [sentence, per] of [
      [TAKEN_100, 100],
      [TAKEN_120, 120],
    ] as const) {
      expect(deriveAttackDamageBonus(sentence)).toEqual({
        per,
        count: { kind: "boardCondition", cond: EQUAL },
      });
    }
    expect(deriveAttackDamageBonus(TAKEN_100.replace("100", "40"))).toEqual({
      per: 40,
      count: { kind: "boardCondition", cond: EQUAL },
    });
  });

  it("D384 — the STRICT-INEQUALITY twin is BUILT, and it resolves to the OTHER member", () => {
    expect(corpus().filter(([, s]) => s === STRICTLY_MORE)).toHaveLength(1);
    expect(units(corpus().filter(([, s]) => s === STRICTLY_MORE))).toBe(1);
    expect(BONUS.exec(STRICTLY_MORE)?.[1]).toBe(
      "this Pokémon has more Energy attached than your opponent's Active Pokémon",
    );
    expect(deriveAttackDamageBonus(STRICTLY_MORE)).toEqual({
      per: 160,
      count: { kind: "boardCondition", cond: { kind: "moreActiveEnergyThanOpponent" } },
    });
    expect(deriveAttackDamageBonus(STRICTLY_MORE)?.count).not.toEqual({
      kind: "boardCondition",
      cond: EQUAL,
    });
    expect(deriveAttackDamageBonus(TAKEN_100)?.count).toEqual({
      kind: "boardCondition",
      cond: EQUAL,
    });
    // …and the two members disagree on a board, which is the whole reason they are
    // two. `moreEnergyBonus.test.ts` drives the pair properly; this is the one rung
    // that has to stay HERE, because it is this file's claim that went stale.
    const equalBoard = attachFromDeck(ready(9140), "p2", "fix-energy", 1);
    const aheadBoard = attachFromDeck(ready(9141), "p1", "fix-energy", 1);
    expect(conditionHolds(equalBoard, "p1", EQUAL)).toBe(true);
    expect(conditionHolds(equalBoard, "p1", { kind: "moreActiveEnergyThanOpponent" })).toBe(false);
    expect(conditionHolds(aheadBoard, "p1", EQUAL)).toBe(false);
    expect(conditionHolds(aheadBoard, "p1", { kind: "moreActiveEnergyThanOpponent" })).toBe(true);
  });

  it("the SUM over the same two bodies is a different mechanism and stays one", () => {
    const sum = "This attack does 30 more damage for each Energy attached to both Active Pokémon.";
    expect(units(corpus().filter(([, s]) => s === sum))).toBe(8);
    expect(deriveAttackDamageBonus(sum)?.count).not.toEqual({
      kind: "boardCondition",
      cond: EQUAL,
    });
  });

  it("the U+2019 spelling folds, through the literal table's own retry", () => {
    const curly = TAKEN_100.replace(/'/g, "’");
    expect(curly).not.toBe(TAKEN_100);
    expect(deriveAttackDamageBonus(curly)).toEqual(deriveAttackDamageBonus(TAKEN_100));
  });

  it("the note is prose for a person and does NOT round-trip to the printed bytes", () => {
    expect(conditionNote(EQUAL)).toBe(
      "your Active Pokémon and your opponent's Active Pokémon have the same amount of Energy attached",
    );
    expect(conditionNote(EQUAL)).not.toBe(TAKEN_CLAUSE);
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(EQUAL)}, this attack does 100 more damage.`),
    ).toBeNull();
  });
});

describe("§4 — the `needs` column RE-DERIVED: no existing member answers this", () => {
  it("the two near members read the same FIELD and ask different questions", () => {
    let state = attachFromDeck(ready(9110), "p1", "fix-blend", 1);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = attachOnBench(state, "p2", 0, "fix-energy", 1);
    expect(cardsAndUnits(state, "p1")[0]).toBe(2);
    expect(cardsAndUnits(state, "p2")[0]).toBe(1);
    // The member: 2 ≠ 1 over the two ACTIVE bodies.
    expect(conditionHolds(state, "p1", EQUAL)).toBe(false);
    const special: BoardCondition = { kind: "yourActiveHasEnergyAttached", energy: "special" };
    expect(conditionHolds(state, "p1", special)).toBe(true);
    expect(conditionHolds(state, "p2", special)).toBe(false);
    expect(
      conditionHolds(state, "p2", { kind: "yourEnergyInPlayAtLeast", energy: "Fire", count: 1 }),
    ).toBe(false);
    expect(
      conditionHolds(state, "p1", { kind: "yourEnergyInPlayAtLeast", energy: "Fire", count: 1 }),
    ).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "handSizesEqual" })).toBe(
      state.players.p1.hand.length === state.players.p2.hand.length,
    );
  });
});

describe("§5 — the boards", () => {
  it("EQUAL at one and one — the printed +100", () => {
    const state = attachFromDeck(ready(9120), "p2", "fix-energy", 1);
    expect(conditionHolds(state, "p1", EQUAL)).toBe(true);
    expect(damageDealt(state)).toBe(110);
  });

  it("the OTHER printed sentence, on its own body, at +120", () => {
    const state = attachFromDeck(ready(9121, "p1", "fix-sameenergy-120"), "p2", "fix-energy", 1);
    expect(damageDealt(state)).toBe(130);
  });

  it("EQUAL is an EQUALITY and not a number: 3 and 3 arm it exactly as 1 and 1 do", () => {
    let state = attachFromDeck(ready(9122), "p1", "fix-energy", 2);
    state = attachFromDeck(state, "p2", "fix-energy", 3);
    expect(cardsAndUnits(state, "p1")[0]).toBe(3);
    expect(cardsAndUnits(state, "p2")[0]).toBe(3);
    expect(damageDealt(state)).toBe(110);
  });

  it("ZERO and ZERO is equal — the boundary a `> 0` guard would drop", () => {
    // Read directly rather than through an attack: the attacker cannot declare
    // without paying its `{C}`, so this board is reachable only before the cost is
    // on. The clause is about a COUNT and 0 = 0 is as true as 3 = 3.
    const state = unpaid(9123);
    expect(cardsAndUnits(state, "p1")).toEqual([0, 0]);
    expect(cardsAndUnits(state, "p2")).toEqual([0, 0]);
    expect(conditionHolds(state, "p1", EQUAL)).toBe(true);
  });

  it("the attacker holding FEWER is false", () => {
    const state = attachFromDeck(ready(9124), "p2", "fix-energy", 2);
    expect(conditionHolds(state, "p1", EQUAL)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("the attacker holding MORE is false too — the board a `>=` or `>` reading passes", () => {
    let state = attachFromDeck(ready(9125), "p1", "fix-energy", 1);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    expect(cardsAndUnits(state, "p1")[0]).toBe(2);
    expect(cardsAndUnits(state, "p2")[0]).toBe(1);
    expect(conditionHolds(state, "p1", EQUAL)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("THE ZONE IS THE BODY: benched Energy is invisible, in both directions", () => {
    let equalActives = attachFromDeck(ready(9126), "p2", "fix-energy", 1);
    equalActives = benchFromDeck(equalActives, "p2", "fix-basic-1");
    equalActives = attachOnBench(equalActives, "p2", 0, "fix-energy", 2);
    expect(conditionHolds(equalActives, "p1", EQUAL)).toBe(true);
    expect(damageDealt(equalActives)).toBe(110);

    // (b) the two Actives DISAGREE and the two SIDES agree: p1's Active is one short
    // and p1's Bench makes the SIDE total level, so a seat-wide reading flips TRUE
    // exactly where the body reading is FALSE.
    let unequalActives = attachFromDeck(ready(9127), "p2", "fix-energy", 1);
    unequalActives = benchFromDeck(unequalActives, "p1", "fix-basic-1");
    unequalActives = attachOnBench(unequalActives, "p1", 0, "fix-energy", 1);
    unequalActives = attachFromDeck(unequalActives, "p2", "fix-energy", 1);
    expect(cardsAndUnits(unequalActives, "p1")[0]).toBe(1);
    expect(cardsAndUnits(unequalActives, "p2")[0]).toBe(2);
    expect(conditionHolds(unequalActives, "p1", EQUAL)).toBe(false);
    expect(damageDealt(unequalActives)).toBe(10);
  });

  it("an EMPTY Active Spot is FALSE on either side, and ZERO is why it has to be driven", () => {
    const zero = unpaid(9128);
    expect(cardsAndUnits(zero, "p1")).toEqual([0, 0]);
    expect(conditionHolds(zero, "p1", EQUAL)).toBe(true);
    expect(conditionHolds(emptyActive(zero, "p2"), "p1", EQUAL)).toBe(false);
    expect(conditionHolds(emptyActive(zero, "p1"), "p1", EQUAL)).toBe(false);
    // …and the both-empty board, where a zero-reading member is most obviously
    // wrong: no Pokémon on either side and nothing for an equality to be about.
    expect(conditionHolds(emptyActive(emptyActive(zero, "p1"), "p2"), "p1", EQUAL)).toBe(false);
    // The same commitment on a board where the attacker HAS Energy, so the null
    // guard is shown to be positive on both sides rather than only on the one the
    // zero board exercises.
    const paid = ready(9129);
    expect(conditionHolds(emptyActive(paid, "p2"), "p1", EQUAL)).toBe(false);
    expect(conditionHolds(emptyActive(paid, "p1"), "p1", EQUAL)).toBe(false);
  });
});

describe("§6 — SEAT SYMMETRY: which KIND, and the comment it falsified", () => {
  it("the VALUE commutes on every board, while the SPELLING does not", () => {
    const equal = attachFromDeck(ready(9130), "p2", "fix-energy", 1);
    const uneven = attachFromDeck(ready(9131), "p2", "fix-energy", 3);
    for (const seat of ["p1", "p2"] as const) {
      expect(conditionHolds(equal, seat, EQUAL)).toBe(true);
      expect(conditionHolds(uneven, seat, EQUAL)).toBe(false);
    }
    // …and the SPELLING half: the printed clause names the two sides differently, so
    // "symmetric" was a claim about the value and had to be said which.
    expect(TAKEN_CLAUSE.includes("this Pokémon")).toBe(true);
    expect(TAKEN_CLAUSE.includes("your opponent's Active Pokémon")).toBe(true);
  });

  it("and it holds through a real attack from the FAR seat", () => {
    // A p1-only suite cannot tell "reads the two Actives" apart from "reads p1's and
    // p2's" — the seat check every member in this family owes.
    const state = attachFromDeck(ready(9132, "p2"), "p1", "fix-energy", 1);
    expect(damageDealt(state, "p2")).toBe(110);
  });
});

describe("§7 — the census moves in exactly ONE summand, and the step is 2 and 2", () => {
  it("D418 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the resolving corpus gains TWO sentences and TWO printings", () => {
    const resolved = corpus().filter(([, s]) => resolvedByAnyReader(s));
    expect(resolved).toHaveLength(600);
    expect(units(resolved)).toBe(1663);
    expect(
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
        3 -
        2 -
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
        1 -
        1 -
        1 -
        1 -
        2 -
        3 -
        1 -
        1 -
        1 -
        1 -
        2 -
        2,
    ).toBe(368);
    expect(
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
        3 -
        5 -
        4 -
        8 -
        8 -
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
        2 -
        1 -
        1 -
        2 -
        3 -
        3 -
        2 -
        2 -
        2 -
        2 -
        2 -
        6,
    ).toBe(1255);
  });

  it("the move is READER-keyed: no registry row and no gate clause", () => {
    for (const sentence of [TAKEN_100, TAKEN_120]) {
      expect(deriveAttackRequirement(sentence)).toBeNull();
      expect(sentence.includes("this attack does nothing")).toBe(false);
    }
  });
});
