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
import { conditionHolds, conditionNote } from "./boardCondition";
import {
  BENCH_ALL_DAMAGED_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
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
  deriveAttackCancelRequirement,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackBonusConsequent,
];

const TAKEN =
  "If all of your Benched Pokémon have at least 1 damage counter on them, this attack does 120 more damage.";
const TAKEN_CLAUSE = "all of your Benched Pokémon have at least 1 damage counter on them";

const EXISTENTIAL_SENTENCE =
  "If your Benched Pokémon have any damage counters on them, this attack does 100 more damage.";

const ALL: BoardCondition = { kind: "yourBenchAllDamaged" };
const ANY: BoardCondition = { kind: "yourBenchDamaged" };
const NO_ENERGY: BoardCondition = { kind: "noEnergyOnYourPokemon" };

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: BENCH_ALL_DAMAGED_DECK, p2: BENCH_ALL_DAMAGED_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** The seat's opposite. Spelled once here rather than imported, because the member
    is seat-relative on the face of it and every board below names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

function ready(seed: number, seat: Seat = "p1"): GameState {
  let state = board(seed);
  if (seat === "p2") state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = setActiveFromDeck(state, seat, "fix-benchall");
  state = attachFromDeck(state, seat, "fix-energy", 1);
  state = setActiveFromDeck(state, other(seat), "fix-bigbody");
  return clearBench(clearBench(state, seat), other(seat));
}

/** `ready`'s board with `count` `fix-basic-1` benched on `seat` and the damage in
    `damages` written onto them, index for index. `0` means an UNDAMAGED benched body,
    which is the only thing that separates `.every` from `.some`. */
function withBench(state: GameState, seat: Seat, damages: readonly number[]): GameState {
  let next = state;
  for (const _ of damages) next = benchFromDeck(next, seat, "fix-basic-1");
  damages.forEach((damage, index) => {
    if (damage > 0) next = setBenchDamage(next, seat, index, damage);
  });
  return next;
}

/** Attack index 0 from `seat` and report the damage actually dealt. */
function damageDealt(state: GameState, seat: Seat = "p1"): number {
  const after = mustApply(state, { type: "attack", seat, index: 0 });
  const dealt = after.events.find((e: GameEvent) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

function vacuousReading(state: GameState, seat: Seat): boolean {
  return state.players[seat].bench.every((p) => p !== null && p.damage > 0);
}

describe("§1 — the price, RE-DERIVED: a 1:2 step and the band down to four", () => {
  it("D419 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the residue steps by exactly this ONE sentence and TWO printings", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    expect(refused.length).toBe(0);
    expect(units(refused)).toBe(0);
    expect([refused.length + 24, units(refused) + 28]).toEqual([24, 28]);
    expect([refused.length + 25, units(refused) + 30]).toEqual([25, 30]);
    expect([refused.length + 26, units(refused) + 32]).toEqual([26, 32]);
    expect([refused.length + 27, units(refused) + 34]).toEqual([27, 34]);
    expect([refused.length + 28, units(refused) + 36]).toEqual([28, 36]);
    expect([refused.length + 30, units(refused) + 38]).toEqual([30, 38]);
    expect([refused.length + 31, units(refused) + 40]).toEqual([31, 40]);

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
    expect(band.length + 5).toBe(5);
    expect([...byClause.values()]).toEqual([]);
  });

  it("ONE sentence, TWO printings — and that is the WHOLE universal population", () => {
    const records = corpus().filter(([, s]) => s === TAKEN);
    expect(records).toHaveLength(1);
    expect(units(records)).toBe(2);
    const clauseRows = corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === TAKEN_CLAUSE);
    expect(clauseRows).toHaveLength(1);
    expect(units(clauseRows)).toBe(2);
    const universals = corpus().filter(([, s]) => /^If all of /.test(s));
    expect(universals).toHaveLength(1);
    expect(universals[0]?.[1]).toBe(TAKEN);
  });
});

describe("§2 — THE BOUNDARY: an empty Bench is FALSE, and the two prior data points are each other's negation", () => {
  it("the union's two 'precedents' are `∃` and `¬∃` — forced, not chosen", () => {
    const empty = ready(7100);
    expect(empty.players.p1.bench).toEqual([]);
    expect(empty.players.p1.active).not.toBeNull();
    expect(conditionHolds(empty, "p1", NO_ENERGY)).toBe(false); // the Active paid `{C}`
    expect(conditionHolds(empty, "p1", ANY)).toBe(false);
    // The two printed sentences, side by side: "none … any" against "… any", which is
    // `¬∃` against `∃`. A pair of negations is one data point, not two, and it says
    // nothing at all about a POSITIVE universal.
    expect(conditionNote(NO_ENERGY)).toBe("none of your Pokémon have any Energy attached");
    expect(conditionNote(ANY)).toBe("1 of your Benched Pokémon has damage counters on it");
    expect(conditionNote(NO_ENERGY).startsWith("none of")).toBe(true);
    const nothing: GameState = {
      ...empty,
      players: { ...empty.players, p1: { ...empty.players.p1, active: null } },
    };
    expect(conditionHolds(nothing, "p1", NO_ENERGY)).toBe(true);
    expect(conditionHolds(nothing, "p1", ANY)).toBe(false);
  });

  it("THE CHOICE: an empty Bench is FALSE, and the vacuous reading would say TRUE", () => {
    const empty = ready(7101);
    expect(empty.players.p1.bench).toEqual([]);
    expect(vacuousReading(empty, "p1")).toBe(true);
    expect(conditionHolds(empty, "p1", ALL)).toBe(false);
    expect(damageDealt(empty)).toBe(10);
    // Both seats, because "your Bench" is seat-relative and an empty-bench answer that
    // was really a p1 answer would pass every rung above.
    const emptyP2 = ready(7102, "p2");
    expect(emptyP2.players.p2.bench).toEqual([]);
    expect(conditionHolds(emptyP2, "p2", ALL)).toBe(false);
    expect(damageDealt(emptyP2, "p2")).toBe(10);
  });

  it("…and FALSE is the ONLY board where the guard and the vacuous reading differ", () => {
    // The other half of the control, and the thing that keeps the `length > 0` from
    // being a superstition: on every NON-EMPTY bench the guard is inert, so it cannot
    // be quietly changing an answer somewhere else. Swept across the shapes.
    const base = ready(7103);
    for (const damages of [[10], [0], [10, 10], [10, 0], [0, 10], [10, 10, 10], [10, 0, 10]]) {
      const state = withBench(base, "p1", damages);
      expect(state.players.p1.bench).toHaveLength(damages.length);
      expect(conditionHolds(state, "p1", ALL), damages.join("/")).toBe(vacuousReading(state, "p1"));
    }
    // …and on the empty one they disagree. Asserted last, so the sweep above is a
    // statement about non-empty benches rather than about benches.
    expect(conditionHolds(base, "p1", ALL)).not.toBe(vacuousReading(base, "p1"));
  });

  it("the invariant the guard buys: the universal IMPLIES the existential, on every board", () => {
    const shapes: readonly (readonly number[])[] = [
      [],
      [0],
      [10],
      [0, 0],
      [10, 0],
      [10, 10],
      [10, 10, 10, 10, 10],
      [10, 10, 10, 10, 0],
    ];
    for (const seat of ["p1", "p2"] as const) {
      const base = ready(7104, seat);
      for (const damages of shapes) {
        const state = withBench(base, seat, damages);
        const all = conditionHolds(state, seat, ALL);
        const any = conditionHolds(state, seat, ANY);
        expect(!all || any, `${seat} ${damages.join("/")}`).toBe(true);
      }
    }
    // And the sweep really does contain a board where they DISAGREE, or "∀ ⟹ ∃"
    // would be satisfied by a member that is never true at all.
    const partial = withBench(ready(7105), "p1", [10, 0]);
    expect(conditionHolds(partial, "p1", ANY)).toBe(true);
    expect(conditionHolds(partial, "p1", ALL)).toBe(false);
  });
});

describe("§3 — the near miss: `.every` against `.some`, on ONE board", () => {
  it("two benched bodies, ONE damaged — the existential TRUE, the universal FALSE", () => {
    const state = withBench(ready(7200), "p1", [10, 0]);
    expect(state.players.p1.bench.map((p) => p.damage)).toEqual([10, 0]);
    expect(conditionHolds(state, "p1", ANY)).toBe(true);
    expect(conditionHolds(state, "p1", ALL)).toBe(false);
    expect(damageDealt(state)).toBe(10);

    // Damage the second body and the universal flips while the existential does not
    // move — which is what makes the pair a discrimination rather than a coincidence.
    const both = setBenchDamage(state, "p1", 1, 10);
    expect(conditionHolds(both, "p1", ANY)).toBe(true);
    expect(conditionHolds(both, "p1", ALL)).toBe(true);
    expect(damageDealt(both)).toBe(130);
  });

  it("the ZONE is the Bench: the Active's damage is invisible to it, either way", () => {
    // The printed word is "Benched". A damaged ACTIVE over an all-damaged bench must
    // not change the answer, and — the direction that actually costs — a damaged
    // Active must not RESCUE a bench holding an undamaged body.
    const undamagedBench = withBench(ready(7201), "p1", [0]);
    const active = undamagedBench.players.p1.active;
    if (active === null) throw new Error("p1 has no Active Pokémon");
    const hurtActive: GameState = {
      ...undamagedBench,
      players: {
        ...undamagedBench.players,
        p1: { ...undamagedBench.players.p1, active: { ...active, damage: 50 } },
      },
    };
    expect(hurtActive.players.p1.active?.damage).toBe(50);
    expect(conditionHolds(hurtActive, "p1", ALL)).toBe(false);
    expect(damageDealt(hurtActive)).toBe(10);
    // …and the other way: an all-damaged bench under an UNDAMAGED Active is TRUE.
    const allDamaged = withBench(ready(7202), "p1", [10]);
    expect(allDamaged.players.p1.active?.damage).toBe(0);
    expect(conditionHolds(allDamaged, "p1", ALL)).toBe(true);
    expect(damageDealt(allDamaged)).toBe(130);
  });

  it("the SEAT is yours: the opponent's bench cannot arm or disarm it", () => {
    // `withBench` on the OTHER seat only. P1's own bench is empty, so the member is
    // false; filling the opponent's bench with damaged bodies must not move it, and
    // an opponent's UNDAMAGED bench must not falsify an all-damaged one of yours.
    const theirs = withBench(ready(7203), "p2", [10, 10]);
    expect(theirs.players.p2.bench).toHaveLength(2);
    expect(conditionHolds(theirs, "p1", ALL)).toBe(false);
    expect(conditionHolds(theirs, "p2", ALL)).toBe(true);

    const mine = withBench(withBench(ready(7204), "p1", [10]), "p2", [0, 0]);
    expect(conditionHolds(mine, "p1", ALL)).toBe(true);
    expect(conditionHolds(mine, "p2", ALL)).toBe(false);
    expect(damageDealt(mine)).toBe(130);
  });

  it("'at least 1' is 1 DAMAGE COUNTER, i.e. any damage at all — not a threshold", () => {
    const one = withBench(ready(7205), "p1", [10]);
    expect(conditionHolds(one, "p1", ALL)).toBe(true);
    const none = withBench(ready(7206), "p1", [0]);
    expect(conditionHolds(none, "p1", ALL)).toBe(false);
    const many = withBench(ready(7207), "p1", [50]);
    expect(conditionHolds(many, "p1", ALL)).toBe(true);
  });
});

describe("§4 — the clause row and the note: an EXACT round trip, and a refusal beside it", () => {
  it("maps the printed sentence onto the new member at the printed 120", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: { kind: "yourBenchAllDamaged" } },
    });
  });

  it("the EXISTENTIAL sentence still resolves to the EXISTENTIAL member", () => {
    expect(deriveAttackDamageBonus(EXISTENTIAL_SENTENCE)).toEqual({
      per: 100,
      count: { kind: "boardCondition", cond: { kind: "yourBenchDamaged" } },
    });
    expect(deriveAttackDamageBonus(TAKEN)).not.toEqual(
      deriveAttackDamageBonus(EXISTENTIAL_SENTENCE),
    );
  });

  it("the note keeps the QUANTIFIER, and round-trips through the reader", () => {
    expect(conditionNote(ALL)).toBe(TAKEN_CLAUSE);
    expect(conditionNote(ALL)).not.toBe(conditionNote(ANY));
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(ALL)}, this attack does 120 more damage.`),
    ).toEqual({ per: 120, count: { kind: "boardCondition", cond: ALL } });
  });

  it("the neighbouring universals the catalog does NOT print stay refused", () => {
    for (const near of [
      "If all of your Benched Pokémon have at least 2 damage counters on them, this attack does 120 more damage.",
      "If all of your Pokémon have at least 1 damage counter on them, this attack does 120 more damage.",
      "If all of your opponent's Benched Pokémon have at least 1 damage counter on them, this attack does 120 more damage.",
      "If all of your Benched Pokémon have at least 1 damage counter on them, this attack does 120 less damage.",
    ]) {
      expect(resolvedByAnyReader(near), near).toBe(false);
    }
    // …and the taken sentence is resolved, so the loop above is a statement about
    // those four strings rather than about the reader being asleep.
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
  });
});
