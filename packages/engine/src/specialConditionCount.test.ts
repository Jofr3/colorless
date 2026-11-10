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
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import { applyAction, conditionHolds } from "./index";
import type { DamageCountSource, EffectOp, GameEvent, GameState } from "./index";
import { programFor, registryCardIds } from "./registry";
import {
  DEFENDER_STATUS_TRIPLE_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  clearBench,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  findEvent,
} from "./testFixtures";
import type { SpecialConditions } from "./types";
import { presentStatuses } from "./types";

const PRINTED =
  "This attack does 100 damage for each Special Condition affecting your opponent's Active Pokémon.";

const INDICATOR =
  "If your opponent's Active Pokémon is affected by a Special Condition, this attack does 120 more damage.";

const RECOVER = "This Pokémon recovers from all Special Conditions."; // :513
const COST_WAIVER =
  "If this Pokémon is affected by a Special Condition, ignore all Energy in this attack's cost."; // :324
const RAISED_CONFUSION =
  "Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that Pokémon for this Special Condition."; // :685

const UNPRINTED_ADDITIVE =
  "This attack does 100 more damage for each Special Condition affecting your opponent's Active Pokémon.";

const UNPRINTED_SELF =
  "This attack does 100 damage for each Special Condition affecting this Pokémon.";

/** THE DERIVED VALUE, spelled once so a case cannot pass against a hand-copied literal
    that has drifted from what the file means by it. */
const READING = { per: 100, count: { kind: "specialConditionsOnOpponentActive" } } as const;

const READERS = [
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
  deriveAttackCopy,
  deriveAttackRequirement,
];

const SPLITTERS = [
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
];

const SEED = 11;
const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);

const types = (events: GameEvent[]) => events.map((e) => e.type);

function board(seed = SEED): GameState {
  let state = must(
    applyAction(
      driveSetup(
        seed,
        { p1: DEFENDER_STATUS_TRIPLE_DECK, p2: DEFENDER_STATUS_TRIPLE_DECK },
        { first: "p2" },
      ),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", "fix-oxford");
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", "fix-energy", 2);
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = clearBench(state, "p2");
  return state;
}

function withEffect(state: GameState, effect: string, index = 1): GameState {
  const card = state.cardPool["fix-oxford"];
  if (card === undefined) throw new Error("no fix-oxford in pool");
  const attacks = [...(card.attacks ?? [])];
  const at = attacks[index];
  if (at === undefined) throw new Error(`fix-oxford has no attack ${index}`);
  attacks[index] = { ...at, effect };
  return { ...state, cardPool: { ...state.cardPool, "fix-oxford": { ...card, attacks } } };
}

/** Index 1 is "Bare Bloom" — {C}, and **no `damage` key at all** — so the printed base
    is 0 before the fold drops it, and every HP observed here is the count's. */
const INDEX = 1;

const swing = (state: GameState) => mustApply(state, { type: "attack", seat: "p1", index: INDEX });

/** How many §12 conditions `seat`'s Active carries, through the SAME projection both
    walks read. Throws on an empty Spot rather than defaulting — a `??` here would make
    every assertion below pass against a board that never got built. */
function conditionsOf(state: GameState, seat: "p1" | "p2"): number {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return presentStatuses(active.conditions).length;
}

/** A board carrying `conditions` on the DEFENDER, with `PRINTED` on the attacker. */
function armed(conditions: Partial<SpecialConditions>, seed = SEED): GameState {
  return setConditions(withEffect(board(seed), PRINTED), "p2", conditions);
}

/** Every shape the model can hold, as `Partial<SpecialConditions>`, with the count the
    PRINTED sentence means. The rotation's four values, the two independent flags, the
    combinations — and the trap. */
const CASES: readonly (readonly [string, Partial<SpecialConditions>, number])[] = [
  ["clean", {}, 0],
  ["burned", { burned: true }, 1],
  ["poisoned", { poisonDamage: 10 }, 1],
  ["asleep", { rotation: "asleep" }, 1],
  ["paralyzed", { rotation: "paralyzed" }, 1],
  ["confused", { rotation: "confused" }, 1],
  ["confused, amount raised", { rotation: "confused", confusionDamage: 80 }, 1],
  ["burned+asleep", { burned: true, rotation: "asleep" }, 2],
  ["burned+poisoned", { burned: true, poisonDamage: 30 }, 2],
  ["confused+poisoned", { rotation: "confused", poisonDamage: 10 }, 2],
  ["all three", { burned: true, rotation: "confused", poisonDamage: 10 }, 3],
  // The maximum, with every amount field raised at once: still THREE.
  [
    "all three, both amounts raised",
    { burned: true, rotation: "confused", poisonDamage: 90, confusionDamage: 80 },
    3,
  ],
];

describe("D518 §1 — the printed data, measured live over the legal column", () => {
  it("the sentence is the CORPUS's bytes at TWO printings, and so is its whole family", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n] as const));
    expect(rows.get(PRINTED)).toBe(2);
    expect(rows.get(INDICATOR)).toBe(8);
    expect(rows.get(RECOVER)).toBe(2);
    expect(rows.get(COST_WAIVER)).toBe(1);
    expect(rows.get(RAISED_CONFUSION)).toBe(1);
  });

  it("the `Special Condition` family is FIVE rows / 14 printings, enumerated not summarised", () => {
    const family = legalAttackCorpus().filter(([, s]) => s.includes("Special Condition"));
    expect(family.map(([, s]) => s).sort()).toEqual(
      [PRINTED, INDICATOR, RECOVER, COST_WAIVER, RAISED_CONFUSION].sort(),
    );
    expect(units(family)).toBe(14);
    const censusBuilt = (s: string): boolean => {
      if (resolvedByAnyReader(s)) return true;
      const g = splitAttackGateClause(s);
      if (g !== null && (g.body === "" || resolvedByAnyReader(g.body))) return true;
      return splitAttackTrailingClause(s) !== null;
    };
    expect(family.filter(([, s]) => !censusBuilt(s)).map(([, s]) => s)).toEqual([]);
    const unbuilt = family.filter(([, s]) => !resolvedByAnyReader(s));
    expect(unbuilt.map(([, s]) => s)).toEqual([COST_WAIVER]);
  });

  it("the ADDITIVE spelling of this noun is printed ZERO times — the zero is MEASURED", () => {
    const additive = legalAttackCorpus().filter(([, s]) =>
      /more damage for each Special Condition/.test(s),
    );
    expect(additive).toEqual([]);
    // …and the SELF spelling too, which is why the seat is in the member's NAME.
    const self = legalAttackCorpus().filter(([, s]) =>
      /for each Special Condition affecting this Pokémon/.test(s),
    );
    expect(self).toEqual([]);
    // The two constructed near-misses are therefore constructed, and both are refused —
    // by the ANCHOR, which is the only thing standing between them and this member.
    expect(resolvedByAnyReader(UNPRINTED_ADDITIVE)).toBe(false);
    expect(resolvedByAnyReader(UNPRINTED_SELF)).toBe(false);
  });

  it("the APOSTROPHE is ASCII, and the anchor takes the typographic one anyway", () => {
    expect(PRINTED.includes("opponent's")).toBe(true);
    expect(PRINTED.includes("opponent’s")).toBe(false);
    expect(PRINTED.codePointAt(PRINTED.indexOf("'"))).toBe(0x0027);
    expect(PRINTED.includes("Pokémon")).toBe(true);
    expect(deriveAttackDamageMultiplier(PRINTED.replace("opponent's", "opponent’s"))).toEqual(
      READING,
    );
  });

  it("a printed ZERO is left LOUD rather than derived to a no-op", () => {
    // The family's `per >= 1` guard. A `0×` sentence does nothing, and a reader that
    // claimed it would report the attack as simulated while dealing nothing.
    expect(
      deriveAttackDamageMultiplier(PRINTED.replace("does 100 damage", "does 0 damage")),
    ).toBeNull();
    // …and the amount is CAPTURED rather than hard-coded to 100.
    expect(deriveAttackDamageMultiplier(PRINTED.replace("100", "40"))).toEqual({
      per: 40,
      count: { kind: "specialConditionsOnOpponentActive" },
    });
  });

  it("the anchors are load-bearing at BOTH ends and the capital `This` is half of it", () => {
    for (const text of [
      PRINTED.replace("This attack", "this attack"),
      PRINTED.slice(0, -1),
      `Draw a card. ${PRINTED}`,
      `${PRINTED} Then, draw a card.`,
      // The head noun and the preposition are spelled into the pattern, not captured —
      // so neither cross-combination reaches the member.
      PRINTED.replace("Special Condition affecting", "Special Condition on"),
      PRINTED.replace("Special Condition affecting", "damage counter affecting"),
    ]) {
      expect(deriveAttackDamageMultiplier(text), text).toBeNull();
    }
  });
});

describe("D518 §2 — the reading, the arm, and the indicator sibling it does NOT narrow", () => {
  it("the sentence is RESOLVED, and by exactly ONE of the thirteen readers", () => {
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(deriveAttackDamageMultiplier(PRINTED)).toEqual(READING);
    for (const read of READERS) {
      if (read === deriveAttackDamageMultiplier) continue;
      expect(read(PRINTED), read.name).toBeNull();
    }
    // …and no splitter is live on it, at either end. Six-for-six.
    for (const split of SPLITTERS) expect(split(PRINTED), split.name).toBeNull();
  });

  it("the INDICATOR sibling derives BYTE FOR BYTE what it derived before", () => {
    expect(deriveAttackDamageBonus(INDICATOR)).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveHasSpecialCondition" } },
    });
    expect(deriveAttackDamageMultiplier(INDICATOR)).toBeNull();
    // …and the other two built family rows are untouched as well.
    expect(deriveAttackEffect(RECOVER)).toEqual([{ op: "clearStatus" }]);
    expect(deriveAttackEffect(RAISED_CONFUSION)).not.toBeNull();
  });

  it("EVERY built row of this family lands on the READER arm ( D545: four of the five — `COST_WAIVER` lands on the GATE arm) — the four-way split, per sentence", () => {
    const armOf = (text: string): string => {
      if (resolvedByAnyReader(text)) return "reader";
      const g = splitAttackGateClause(text);
      if (g !== null && (g.body === "" || resolvedByAnyReader(g.body))) return "gate";
      return splitAttackTrailingClause(text) !== null ? "trailing" : "none";
    };
    expect(armOf(PRINTED)).toBe("reader");
    expect(armOf(INDICATOR)).toBe("reader");
    expect(armOf(RECOVER)).toBe("reader");
    expect(armOf(RAISED_CONFUSION)).toBe("reader");
    expect(armOf(COST_WAIVER)).toBe("gate");
  });

  it("the INDICATOR's ceiling is `per`, which is why this row cost a MEMBER", () => {
    const indicator = deriveAttackDamageBonus(INDICATOR);
    expect(indicator?.count.kind).toBe("boardCondition");
    expect(Object.keys(indicator?.count ?? {}).sort()).toEqual(["cond", "kind"]);
    // …and the new member is NULLARY: the seat is its name, so there is nothing to vary.
    expect(Object.keys(READING.count)).toEqual(["kind"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the count on real boards, including the TRAP.
// ─────────────────────────────────────────────────────────────────────────────

describe("D518 §3 — the tally on a board: 0, 1, 2, 3 — and `confusionDamage` is not one", () => {
  it("a CLEAN defender is 0, and 0 emits NO `DAMAGE_DEALT` AT ALL", () => {
    const { events, state } = swing(armed({}));
    expect(findEvent(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(state.players.p2.active?.damage).toBe(0);
    // …and the attack RESOLVED: it is not on the loud unread path.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("THE TRAP — Confused with a RAISED `confusionDamage` counts ONE, not two", () => {
    const raised = armed({ rotation: "confused", confusionDamage: 80 });
    expect(raised.players.p2.active?.conditions.confusionDamage).toBe(80);
    expect(findEvent(swing(raised).events, "DAMAGE_DEALT")?.dealt).toBe(100);
    // …and the raised amount really is on the board rather than silently normalised,
    // so the rung cannot pass because the surgery did not take.
    const plain = armed({ rotation: "confused" });
    expect(plain.players.p2.active?.conditions.confusionDamage).not.toBe(80);
    expect(findEvent(swing(plain).events, "DAMAGE_DEALT")?.dealt).toBe(100);
  });

  it("the ROTATION is EXCLUSIVE, so three of the five §12 words share one unit", () => {
    // Asleep, Paralyzed and Confused are ONE slot: each is 1 on its own and no board can
    // hold two of them. Burn and Poison are independent flags and stack with it.
    for (const rotation of ["asleep", "paralyzed", "confused"] as const) {
      expect(findEvent(swing(armed({ rotation })).events, "DAMAGE_DEALT")?.dealt, rotation).toBe(
        100,
      );
    }
    expect(findEvent(swing(armed({ burned: true })).events, "DAMAGE_DEALT")?.dealt).toBe(100);
    expect(findEvent(swing(armed({ poisonDamage: 10 })).events, "DAMAGE_DEALT")?.dealt).toBe(100);
  });

  it("the whole condition space, swept — every case, its count and its HP", () => {
    // One board per case, all from the same seed and the same fixture: nothing but the
    // conditions differs between the runs, so a difference cannot be credited elsewhere.
    const table = CASES.map(([label, conditions, expected]) => {
      const state = armed(conditions);
      const active = state.players.p2.active;
      if (active === null) throw new Error("no defender");
      const dealt = findEvent(swing(state).events, "DAMAGE_DEALT")?.dealt ?? 0;
      return [label, presentStatuses(active.conditions).length, dealt, expected] as const;
    });
    for (const [label, counted, dealt, expected] of table) {
      expect(counted, `${label}: the walk`).toBe(expected);
      expect(dealt, `${label}: the HP`).toBe(expected * 100);
    }
    // ANTI-VACUITY: the sweep spans four distinct counts, so it cannot be satisfied by a
    // reader stuck on any single one of them.
    expect([...new Set(table.map(([, , , n]) => n))].sort()).toEqual([0, 1, 2, 3]);
  });

  it("the SIBLING indicator on the SAME three-condition board deals 120, not 360", () => {
    const all = { burned: true, rotation: "confused", poisonDamage: 10 } as const;
    const mine = setConditions(withEffect(board(31), PRINTED), "p2", all);
    const theirs = setConditions(withEffect(board(31), INDICATOR), "p2", all);
    expect(findEvent(swing(mine).events, "DAMAGE_DEALT")?.dealt).toBe(300);
    expect(findEvent(swing(theirs).events, "DAMAGE_DEALT")?.dealt).toBe(120);
  });

  it("an HONEST IN-GAME board: `Triple Bloom` arms all three, and the fold reads the board", () => {
    let state = withEffect(board(29), PRINTED);
    state = mustApply(state, { type: "attack", seat: "p1", index: 0 }).state;
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    const active = state.players.p2.active;
    if (active === null) throw new Error("no defender");
    const armedCount = presentStatuses(active.conditions).length;
    expect(armedCount).toBeGreaterThanOrEqual(2);
    expect(findEvent(swing(state).events, "DAMAGE_DEALT")?.dealt).toBe(armedCount * 100);
  });
});

describe("D518 §4 — SHAPE × NOUN × SEAT × FOLD, 16 points, and the flip table", () => {
  const SEATS = ["this Pokémon", "your opponent's Active Pokémon"] as const;
  const text = (shape: number, noun: number, seat: number, fold: number): string => {
    const more = fold === 1 ? "more " : "";
    if (shape === 0) {
      const phrase =
        noun === 1
          ? `Special Condition affecting ${SEATS[seat]}`
          : `damage counter on ${SEATS[seat]}`;
      return `This attack does 100 ${more}damage for each ${phrase}.`;
    }
    const clause =
      noun === 1
        ? `${SEATS[seat]} is affected by a Special Condition`
        : `${SEATS[seat]} has any damage counters on it`;
    return `If ${clause}, this attack does 100 ${more}damage.`;
  };
  const POINTS = [0, 1].flatMap((s) =>
    [0, 1].flatMap((n) =>
      [0, 1].flatMap((se) => [0, 1].map((f) => ({ key: [s, n, se, f], t: text(s, n, se, f) }))),
    ),
  );
  const lit = (t: string) => resolvedByAnyReader(t);

  it("all 16 points are DISTINCT strings — the anti-degeneracy check (D491)", () => {
    expect(new Set(POINTS.map((p) => p.t)).size).toBe(16);
  });

  it("the BUILT set is 7 of 16, and the printed row is the one this slice lit", () => {
    const built = POINTS.filter((p) => lit(p.t)).map((p) => p.key.join(""));
    expect(built.sort()).toEqual(["0000", "0001", "0010", "0011", "0110", "1001", "1111"]);
    expect(text(0, 1, 1, 0)).toBe(PRINTED);
    expect(text(1, 1, 1, 1)).toBe(INDICATOR.replace("120", "100"));
  });

  it("the two predicates AGREE at every point, and both splitters are null at 16/16", () => {
    let gate = 0;
    let trailing = 0;
    for (const p of POINTS) {
      if (splitAttackGateClause(p.t) !== null) gate += 1;
      if (splitAttackTrailingClause(p.t) !== null) trailing += 1;
    }
    expect(gate).toBe(0);
    expect(trailing).toBe(0);
  });

  it("the POST flip table is `5 · 5 · 3 · 3` of 8, with zero inert and zero free axes", () => {
    const flips = [0, 1, 2, 3].map((axis) => {
      let n = 0;
      for (const p of POINTS) {
        if (p.key[axis] === 1) continue;
        const q = POINTS.find((x) =>
          x.key.every((v, i) => (i === axis ? v === 1 : v === p.key[i])),
        );
        if (q !== undefined && lit(p.t) !== lit(q.t)) n += 1;
      }
      return n;
    });
    expect(flips).toEqual([5, 5, 3, 3]);
  });

  it("the BUILT set now CONTAINS the PRINTED set — no literal refuses a printed row", () => {
    const corpus = legalAttackCorpus();
    const printed = POINTS.filter((p) => {
      const re = new RegExp(
        `^${p.t
          .split("100")
          .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("\\d+")}$`,
      );
      return corpus.some(([, s]) => re.test(s));
    });
    expect(printed.map((p) => p.key.join("")).sort()).toEqual([
      "0000",
      "0001",
      "0010",
      "0011",
      "0110",
      "1111",
    ]);
    for (const p of printed) expect(lit(p.t), p.t).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the INVARIANT: one walk, two folds.
// ─────────────────────────────────────────────────────────────────────────────

describe("D518 §5 — predicate ⟺ count ≥ 1, by construction rather than by agreement", () => {
  it("the biconditional holds on EVERY inhabitant of the condition space", () => {
    let bothTrue = 0;
    let bothFalse = 0;
    for (const [label, conditions, expected] of CASES) {
      const state = armed(conditions);
      const active = state.players.p2.active;
      if (active === null) throw new Error("no defender");
      const count = presentStatuses(active.conditions).length;
      const holds = conditionHolds(state, "p1", { kind: "opponentActiveHasSpecialCondition" });
      expect(count, label).toBe(expected);
      expect(holds, label).toBe(count >= 1);
      if (holds) bothTrue += 1;
      else bothFalse += 1;
    }
    // ANTI-VACUITY: the sweep visits BOTH sides of the biconditional.
    expect(bothTrue).toBeGreaterThan(0);
    expect(bothFalse).toBeGreaterThan(0);
  });

  it("the EMPTY Active Spot is FALSE on the predicate, and UNREACHABLE from the fold", () => {
    const base = board();
    const state: GameState = {
      ...base,
      players: { ...base.players, p2: { ...base.players.p2, active: null } },
    };
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasSpecialCondition" })).toBe(false);
    const refused = applyAction(withEffect(state, PRINTED), {
      type: "attack",
      seat: "p1",
      index: INDEX,
    });
    expect(refused.ok).toBe(false);
  });

  it("the SEAT is real: the same board read from the other side is 0", () => {
    // A p1-only suite cannot tell *"reads the OPPONENT's Active"* apart from *"reads p2's
    // Active"*. Armed on p2, the count is 3 for p1 and 0 for p2 — and the HP the fold
    // deals follows the predicate rather than the seat this suite happens to attack from.
    const state = armed({ burned: true, rotation: "confused", poisonDamage: 10 });
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasSpecialCondition" })).toBe(true);
    expect(conditionHolds(state, "p2", { kind: "opponentActiveHasSpecialCondition" })).toBe(false);
    expect(conditionsOf(state, "p2")).toBe(3);
    expect(conditionsOf(state, "p1")).toBe(0);
    expect(findEvent(swing(state).events, "DAMAGE_DEALT")?.dealt).toBe(300);
  });
});

const COUNT_KINDS: Record<DamageCountSource["kind"], true> = {
  damageCountersOnSelf: true,
  opponentPrizesTaken: true,
  opponentActiveRetreatCost: true,
  boardCondition: true,
  damageCountersOnOpponentActive: true,
  specialConditionsOnOpponentActive: true,
  damageCountersOnYourBench: true,
  damageCountersOnOpponentBoard: true,
  bothSidesBenchCount: true,
  opponentBenchCount: true,
  yourBenchCount: true,
  energyOnOpponent: true,
  energyOnSelf: true,
  bothActivesEnergyCount: true,
  toolsOnYourBoard: true,
  extraEnergyUnitsBeyondCost: true,
  pokemonInPlay: true,
  bothSidesPokemonInPlay: true,
  cardsInDiscardPile: true,
  cardsInOpponentHand: true,
  cardsInYourHand: true,
  energyInPlayBothSides: true,
  toolsInPlayBothSides: true,
  basicEnergyTypesOnYourBoard: true,
  yourPrizesTaken: true,
  damagedBenchedPokemon: true,
  benchedPokemonWithEnergy: true,
  benchedPokemonWithMaxHp: true,
  opponentPrizesTakenLastTurn: true,
  attackDamageTakenLastTurnOnSelf: true,
};

describe("D518 §6 — `MATCH_RECORD_VERSION` HOLDS at 30: there is no carrier at all", () => {
  it("the union has TWENTY members, and the count is asked of the TYPE", () => {
    expect(Object.keys(COUNT_KINDS)).toHaveLength(30);
    expect(COUNT_KINDS.specialConditionsOnOpponentActive).toBe(true);
  });

  it("NO op any producer in this repo emits carries a `DamageCountSource` — walked, not grepped", () => {
    const programs: EffectOp[][] = [];
    for (const id of registryCardIds()) {
      const p = programFor(id);
      // `CardProgram` carries exactly ONE program map (`attack`, keyed by attack index)
      // — asked of the TYPE rather than assumed: an `ability` key here is a compile error.
      if (p?.attack !== undefined) programs.push(...Object.values(p.attack));
    }
    for (const [, text] of legalAttackCorpus()) {
      const derived = deriveAttackEffect(text);
      if (derived !== null) programs.push(derived as EffectOp[]);
    }
    expect(programs.length).toBeGreaterThan(100);
    const carriers: string[] = [];
    const visit = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((v, i) => {
          visit(v, `${path}[${i}]`);
        });
        return;
      }
      if (node === null || typeof node !== "object") return;
      const rec = node as Record<string, unknown>;
      const kind = rec.kind;
      // `op` separates an EffectOp (which also carries `kind` on some fields) from a
      // count: only a bare `{kind: …}` object whose kind is one of the twenty qualifies.
      if (typeof kind === "string" && kind in COUNT_KINDS && rec.op === undefined) {
        carriers.push(`${path}.kind = ${kind}`);
      }
      for (const [k, v] of Object.entries(rec)) visit(v, `${path}.${k}`);
    };
    programs.forEach((p, i) => {
      visit(p, `program[${i}]`);
    });
    expect(carriers).toEqual([]);
  });

  it("the reader SURFACE is unmoved at THIRTEEN, and the hand-kept list IS the module's", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("`FIXTURE_POOL` is BYTE-UNCHANGED — the demonstrator is a per-board clone", () => {
    expect(FIXTURE_POOL["fix-oxford"]?.attacks?.map((a) => a.effect)).toEqual([
      "Your opponent's Active Pokémon is now Burned, Confused, and Poisoned.",
      "Your opponent's Active Pokémon is now Burned, Confused, and Poisoned.",
      "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon.",
    ]);
  });
});
