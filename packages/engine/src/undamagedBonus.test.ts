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
import type { BoardCondition, GameState } from "./index";
import { conditionHolds, conditionNote } from "./boardCondition";
import { programFor, registryCardIds } from "./registry";
import {
  UNDAMAGED_BONUS_DECK,
  attachFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setDamage,
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

const TAKEN = "If this Pokémon has no damage counters on it, this attack does 120 more damage.";

const DECLARATION_CLAUSE =
  "this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost)";
const DECLARATION_SENTENCES: readonly (readonly [string, number])[] = [
  [`If ${DECLARATION_CLAUSE}, this attack does 80 more damage.`, 3],
  [`If ${DECLARATION_CLAUSE}, this attack does 100 more damage.`, 2],
];

const TAKEN_IDS: readonly string[] = ["sv10-139", "sv10-218", "sv10-235"];

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: UNDAMAGED_BONUS_DECK, p2: UNDAMAGED_BONUS_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields `attacker` with one Energy paid, P2 fields a 200 HP body that
    survives 150, and BOTH benches start EMPTY. */
function ready(seed: number, attacker: string): GameState {
  let state = setActiveFromDeck(board(seed), "p1", attacker);
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  return clearBench(clearBench(state, "p1"), "p2");
}

/** Attack index 0 and report the damage actually dealt. */
function damageDealt(state: GameState): number {
  const after = mustApply(state, { type: "attack", seat: "p1", index: 0 });
  const dealt = after.events.find((e) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

describe("§1 — the handed candidate is a DECLARATION fact, settled from the CATALOG", () => {
  it("D419 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the SAME clause is printed on TWO attacks with TWO DIFFERENT COSTS", () => {
    const COSTS: readonly (readonly [string, number, number])[] = [
      ["Electivire ex sv10-069/-212", 3, 2],
      ["Jellicent ex sv10.5w-045/-160/-168", 2, 3],
    ];
    // The two costs are DIFFERENT — the whole disqualification in one assertion.
    expect(new Set(COSTS.map(([, cost]) => cost)).size).toBe(2);
    expect(COSTS.reduce((sum, [, , n]) => sum + n, 0)).toBe(5);
    // The threshold each cost implies is DIFFERENT TOO, which is the fact a
    // board-only predicate would have to guess at.
    expect(COSTS.map(([, cost]) => cost + 2)).toEqual([5, 4]);
  });

  it("…so it is NOT a `BoardCondition` — and D436 claims it as a `DamageCountSource` instead", () => {
    for (const [sentence, printings] of DECLARATION_SENTENCES) {
      expect(units(corpus().filter(([, s]) => s === sentence)), sentence).toBe(printings);
      expect(resolvedByAnyReader(sentence), sentence).toBe(true);
      const read = deriveAttackDamageBonus(sentence);
      expect(read, sentence).not.toBeNull();
      expect(read?.count, sentence).toEqual({ kind: "extraEnergyUnitsBeyondCost", extra: 2 });
      expect(read?.per, sentence).toBe(Number(BONUS.exec(sentence)?.[2]));
      expect(BONUS.test(sentence.trim()), sentence).toBe(true);
    }
    expect(DECLARATION_SENTENCES.reduce((sum, [, n]) => sum + n, 0)).toBe(5);
    expect(new Set(DECLARATION_SENTENCES.map(([s]) => BONUS.exec(s)?.[1])).size).toBe(1);
  });

  it("NO `CONDITIONAL_DAMAGE_CLAUSES` ROW CLAIMS THE CLAUSE — driven at the two call sites the ANCHOR does not pre-empt", () => {
    const ROW_CLAUSE = BONUS.exec(TAKEN)?.[1] ?? "";
    expect(ROW_CLAUSE).toBe("this Pokémon has no damage counters on it");
    const PROBES = [
      {
        site: "BONUS_CONSEQUENT_CONDITION",
        carrier: (clause: string) =>
          `If ${clause}, this attack does 80 more damage, and discard all Energy from this Pokémon.`,
        read: (sentence: string): unknown => deriveAttackBonusConsequent(sentence),
      },
      {
        site: "BONUS_CONSEQUENT_CONDITION_THEN",
        carrier: (clause: string) =>
          `If ${clause}, this attack does 80 more damage. Then, discard all Energy from this Pokémon.`,
        read: (sentence: string): unknown => deriveAttackBonusConsequent(sentence),
      },
      {
        site: "CONDITIONAL_BENCH_SNIPE",
        carrier: (clause: string) =>
          `If ${clause}, this attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)`,
        read: (sentence: string): unknown => deriveAttackEffect(sentence),
      },
    ] as const;
    for (const { site, carrier, read } of PROBES) {
      if (site === "CONDITIONAL_BENCH_SNIPE") {
        expect(JSON.stringify(read(carrier(DECLARATION_CLAUSE))), site).toContain(
          '"extraEnergyBeyondAttackCost"',
        );
      } else {
        expect(read(carrier(DECLARATION_CLAUSE)), site).toBeNull();
      }
      expect(JSON.stringify(read(carrier(ROW_CLAUSE))), site).toContain('"yourActiveUndamaged"');
    }
    // …and the pre-emption itself, so the reason this rung exists cannot rot into
    // prose: at the ONE site the anchor covers, the SAME clause resolves — through
    // the anchor, not through the table.
    expect(
      deriveAttackDamageBonus(`If ${DECLARATION_CLAUSE}, this attack does 80 more damage.`)?.count,
    ).toEqual({ kind: "extraEnergyUnitsBeyondCost", extra: 2 });
  });

  it("and 3 printings for a BOARD fact beat 5 printings for a fact of the wrong shape", () => {
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(3);
    expect(DECLARATION_SENTENCES.reduce((sum, [, n]) => sum + n, 0)).toBeGreaterThan(3);
  });
});

describe("§2 — the price: a FLAT complement, not the `not` combinator D125 refused", () => {
  it("buys ONE member with TWO arms — and the producer set is closed at two", () => {
    const cond: BoardCondition = { kind: "yourActiveUndamaged" };
    const state = ready(5100, "fix-mabosstiff");
    expect(typeof conditionHolds(state, "p1", cond)).toBe("boolean");
    expect(conditionNote(cond)).not.toBe("");
    expect(conditionNote(cond)).toBe("your Active Pokémon has no damage counters on it");
    expect(conditionNote(cond)).not.toContain("not ");
  });

  it("the union already ships a FLAT COMPLEMENT, so the shape is not new", () => {
    const state = ready(5101, "fix-mabosstiff");
    const pairs: readonly BoardCondition[] = [
      { kind: "opponentActiveIsEvolution" },
      { kind: "opponentActiveIsBasic" },
      { kind: "yourActiveDamaged" },
      { kind: "yourActiveUndamaged" },
    ];
    for (const cond of pairs) {
      expect(typeof conditionHolds(state, "p1", cond), cond.kind).toBe("boolean");
      expect(conditionNote(cond), cond.kind).not.toBe("");
    }
  });

  it("the clause row resolves to the member, and the amount comes off the SKELETON", () => {
    const read = deriveAttackDamageBonus(TAKEN);
    expect(read).not.toBeNull();
    expect(read?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "yourActiveUndamaged" },
    });
    expect(read?.per).toBe(Number(BONUS.exec(TAKEN)?.[2]));
    expect(read?.per).toBe(120);
  });

  it("keeps the two CONSEQUENTS disjoint — D125's rule, on this clause", () => {
    // The requirement reader must never see a sentence meaning "+N"…
    expect(deriveAttackRequirement(TAKEN)).toBeNull();
    // …and the cancel spelling of the same clause must never reach the bonus table,
    // which is the direction that would score a bonus off a cancel.
    const clause = BONUS.exec(TAKEN)?.[1] ?? "";
    expect(deriveAttackDamageBonus(`If ${clause}, this attack does nothing.`)).toBeNull();
  });

  it("the anchors are whole-sentence at BOTH ends — no substring reaches the row", () => {
    const clause = BONUS.exec(TAKEN)?.[1] ?? "";
    // Lowercase `if` — the skeleton has no /i.
    expect(deriveAttackDamageBonus(`if ${clause}, this attack does 120 more damage.`)).toBeNull();
    // No trailing period is not the whole sentence.
    expect(deriveAttackDamageBonus(`If ${clause}, this attack does 120 more damage`)).toBeNull();
    // Leading text pins `^`.
    expect(
      deriveAttackDamageBonus(`Flip a coin. If ${clause}, this attack does 120 more damage.`),
    ).toBeNull();
    // A printed 0 adds nothing — the guard every arm in this family carries.
    expect(deriveAttackDamageBonus(`If ${clause}, this attack does 0 more damage.`)).toBeNull();
  });
});

describe("§3 — the two NEAR-MISSES, one printed word and one seat apart", () => {
  it("'any' and 'no' are ONE WORD apart and must never reach each other's row", () => {
    const mine = "If this Pokémon has any damage counters on it, this attack does 90 more damage.";
    expect(deriveAttackDamageBonus(mine)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "yourActiveDamaged" },
    });
    expect(deriveAttackDamageBonus(TAKEN)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "yourActiveUndamaged" },
    });
    const a = BONUS.exec(mine)?.[1] ?? "";
    const b = BONUS.exec(TAKEN)?.[1] ?? "";
    expect(a.replace("any", "no")).toBe(b);
    expect(a).not.toBe(b);
  });

  it("the OPPONENT-seat twin of the same six words belongs to the OTHER table", () => {
    const basculin =
      "If your opponent's Active Pokémon has no damage counters on it before this attack does damage, this attack does nothing.";
    expect(units(corpus().filter(([, s]) => s === basculin))).toBe(2);
    expect(deriveAttackRequirement(basculin)).toEqual({ kind: "opponentActiveDamaged" });
    expect(deriveAttackDamageBonus(basculin)).toBeNull();
    expect(basculin).toContain("has no damage counters on it");
  });
});

describe("§4 — driven on boards: the member decides the damage", () => {
  it("an UNDAMAGED attacker deals 30 + 120", () => {
    expect(damageDealt(ready(5200, "fix-mabosstiff"))).toBe(150);
  });

  it("a DAMAGED attacker deals the base 30 and nothing more", () => {
    const state = setDamage(ready(5200, "fix-mabosstiff"), "p1", 10);
    expect(state.players.p1.active?.damage).toBe(10);
    expect(damageDealt(state)).toBe(30);
  });

  it("ONE damage counter is enough to switch it off — the boundary is 0, not 'a lot'", () => {
    // 10 damage is one counter, the smallest amount the game can put on a body. The
    // member reads `=== 0`, so the step is between 0 and 10 and nowhere else.
    for (const damage of [0, 10, 20, 50]) {
      const state = setDamage(ready(5201, "fix-mabosstiff"), "p1", damage);
      expect(damageDealt(state), `damage=${damage}`).toBe(damage === 0 ? 150 : 30);
    }
  });

  it("reads at DECLARATION — the counters it walked in with, not the ones it takes", () => {
    // The defender is a 200 HP body, so nothing here KOs and the attacker takes no
    // damage during its own attack; the point is that the read happens once, at the
    // top of §8.5, exactly as its complement's does.
    const state = ready(5202, "fix-mabosstiff");
    expect(state.players.p1.active?.damage).toBe(0);
    const after = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(after.state.players.p2.active?.damage).toBe(150);
  });
});

describe("§5 — the ONE board where a complement and a NEGATION disagree", () => {
  it("an EMPTY Active Spot is FALSE on BOTH arms — `!yourActiveDamaged` would be TRUE", () => {
    let state = ready(5300, "fix-mabosstiff");
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, active: null } } };
    expect(conditionHolds(state, "p1", { kind: "yourActiveDamaged" })).toBe(false);
    expect(conditionHolds(state, "p1", { kind: "yourActiveUndamaged" })).toBe(false);
    // …and the negation-of-the-complement really would have differed here, which is
    // what turns this from a style note into a measurement.
    expect(!conditionHolds(state, "p1", { kind: "yourActiveDamaged" })).toBe(true);
  });

  it("…and WITH an Active they are exact complements at every damage value", () => {
    for (const damage of [0, 10, 60, 120]) {
      const state = setDamage(ready(5301, "fix-mabosstiff"), "p1", damage);
      const damaged = conditionHolds(state, "p1", { kind: "yourActiveDamaged" });
      const undamaged = conditionHolds(state, "p1", { kind: "yourActiveUndamaged" });
      expect(damaged, `damage=${damage}`).toBe(damage > 0);
      expect(undamaged, `damage=${damage}`).toBe(!damaged);
    }
  });
});

describe("§6 — the census this row moves, and the three summands it does not", () => {
  it("the three ids are all of the sentence's printings, and none is in the registry", () => {
    expect(TAKEN_IDS).toHaveLength(3);
    const ids = new Set(registryCardIds());
    for (const id of TAKEN_IDS) expect(ids.has(id), id).toBe(false);
    for (const id of TAKEN_IDS) expect(programFor(id), id).toBeUndefined();
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(TAKEN_IDS.length);
  });

  it("the ZERO-VOCABULARY FLOOR is now 0 / 0 — D367 drained it, so this slice had to buy", () => {
    const SELF_ENERGY = /^this Pokémon has any (.+) Energy attached$/;
    const ACTIVE_TYPE = /^your opponent's Active Pokémon is a (.+) Pokémon$/;
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    const anchored: string[] = [];
    for (const [, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      const token = SELF_ENERGY.exec(clause)?.[1] ?? ACTIVE_TYPE.exec(clause)?.[1];
      if (token !== undefined) anchored.push(token);
    }
    expect(anchored.sort()).toEqual([]);
    expect(anchored.filter((t) => t === "Tera")).toHaveLength(0);
    expect(
      deriveAttackDamageBonus(
        "If you have any Stage 1 Pokémon on your Bench, this attack does 30 more damage.",
      ),
    ).toBeNull();
    const rocket =
      "If this Pokémon has any Team Rocket's Energy attached, this attack does 60 more damage.";
    expect(corpus().some(([, s]) => s === rocket)).toBe(true);
    expect(resolvedByAnyReader(rocket)).toBe(true);
    expect(deriveAttackDamageBonus(rocket)).toEqual({
      per: 60,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourActiveHasNamedEnergyAttached", name: "Team Rocket's Energy" },
      },
    });
    // …and the token map it did NOT learn: the trap's own widening stays unbought, so
    // the anchored template still refuses the string outright.
    expect(SELF_ENERGY.exec("this Pokémon has any Team Rocket's Energy attached")?.[1]).toBe(
      "Team Rocket's",
    );
  });
});
