import type { Card } from "@colorless/schema";
import { redactedAttackSchema } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { attackGateOf, effectiveAttackCost } from "./continuous";
import {
  deriveAttackEffect,
  splitAttackGateClause,
  splitAttackTrailingClause,
  timingGateFromAttackText,
} from "./effects";
import type { GameEvent } from "./events";
import { applyAction, attackCostAt, attackTimingBlocked, costMet, redactGame } from "./index";
import type { GameState } from "./index";
import { conditionHolds, conditionNote } from "./boardCondition";
import { providedEnergy } from "./continuous";
import {
  FIXTURE_POOL,
  attachFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  setConditions,
  setDamage,
  types,
  activeOf,
  driveSetup,
} from "./testFixtures";

const ALT = "If this Pokémon has any damage counters on it, this attack can be used for {F}.";
const WAIVE =
  "If this Pokémon is affected by a Special Condition, ignore all Energy in this attack's cost.";
const EXTRA =
  "If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack does 50 more damage.";

const OLD_CLAUSES = [
  "If you go second, you can't use this attack during your first turn.",
  "If you go first, you can use this attack during your first turn.",
  "You can use this attack only if you go second, and only during your first turn.",
  "You can use this attack only if this Pokémon used Rollout during your last turn.",
  "If 1 of your Pokémon used Angelite during your last turn, this attack can't be used.",
] as const;

/** The demonstrators' PRINTED costs — each differs from `{F}` and from `[]`. */
const ALT_PRINTED = ["Water", "Water", "Colorless"] as const;
const WAIVE_PRINTED = ["Grass", "Grass", "Colorless"] as const;

const LOCAL_CARDS: Record<string, Card> = {
  /** `:316` at index 0, and an unclaused attack at index 1 — the address control. */
  "d545-alt": {
    ...(FIXTURE_POOL["fix-basic-1"] as Card),
    id: "d545-alt",
    name: "d545-alt",
    types: ["Fighting"],
    hp: 300,
    retreat: 1,
    attacks: [
      { cost: [...ALT_PRINTED], name: "Rock Alternate", damage: "30", effect: ALT },
      { cost: [...ALT_PRINTED], name: "Plain Rock", damage: "30" },
    ],
  },
  /** `:324` at index 0, and an unclaused attack at index 1. */
  "d545-waive": {
    ...(FIXTURE_POOL["fix-basic-1"] as Card),
    id: "d545-waive",
    name: "d545-waive",
    types: ["Grass"],
    hp: 300,
    retreat: 1,
    attacks: [
      { cost: [...WAIVE_PRINTED], name: "Free Vine", damage: "40", effect: WAIVE },
      { cost: [...WAIVE_PRINTED], name: "Plain Vine", damage: "40" },
    ],
  },
  "d545-waive-extra": {
    ...(FIXTURE_POOL["fix-basic-1"] as Card),
    id: "d545-waive-extra",
    name: "d545-waive-extra",
    types: ["Grass"],
    hp: 300,
    retreat: 1,
    attacks: [
      {
        cost: [...WAIVE_PRINTED],
        name: "Surplus Vine",
        damage: "40+",
        effect: `${WAIVE} ${EXTRA}`,
      },
    ],
  },
  "d545-wall": {
    ...(FIXTURE_POOL["fix-basic-1"] as Card),
    id: "d545-wall",
    name: "d545-wall",
    types: ["Colorless"],
    hp: 600,
    retreat: 1,
    attacks: [],
  },
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const COST_DECK = deckOf({
  "d545-alt": 4,
  "d545-waive": 4,
  "d545-waive-extra": 2,
  "d545-wall": 10,
  "sv03-192": 2, // Pokémon League Headquarters — the Basic surcharge (Stadium)
  "sv03-052": 2, // Seismitoad — "Quaking Zone", the opposing surcharge
  "fix-fighting-energy": 8,
  "fix-water-energy": 8,
  "fix-grass-energy": 8,
  "fix-energy": 12, // Basic, provides {C}
});

const SEED = 20260925;
const ALT_INDEX = 0;
const WAIVE_INDEX = 0;
const PLAIN_INDEX = 1;

function localSetup(): GameState {
  return driveSetup(SEED, { p1: COST_DECK, p2: COST_DECK }, { pool: POOL, first: "p1" });
}

type Energy = Partial<Record<"F" | "W" | "G" | "C", number>>;
const ENERGY_ID = {
  F: "fix-fighting-energy",
  W: "fix-water-energy",
  G: "fix-grass-energy",
  C: "fix-energy",
} as const;

/** P1's turn 3 (past §4): P1 fields `attacker` with exactly `energy` attached and an empty
    Bench; P2 fields `defender` (600 HP, no Weakness) alone. */
function ready(attacker: string, energy: Energy, defender = "d545-wall"): GameState {
  let state = localSetup();
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  for (const key of ["F", "W", "G", "C"] as const) {
    const n = energy[key] ?? 0;
    if (n > 0) state = attachFromDeck(state, "p1", ENERGY_ID[key], n);
  }
  state = clearBench(setActiveFromDeck(state, "p2", defender), "p2");
  return state;
}

/** Play League HQ from P1's deck into the shared Stadium zone. */
function withLeagueHq(state: GameState): GameState {
  const next = handFromDeck(state, "p1", "sv03-192", 1);
  return mustApply(next, { type: "playTrainer", seat: "p1", uid: handUid(next, "p1", "sv03-192") })
    .state;
}

/** What the §8.2 gate charges P1's Active at `index`, through the exported seam. */
function charged(state: GameState, index: number): readonly string[] {
  const body = activeOf(state, "p1");
  return attackCostAt(state, "p1", body, index, providedEnergy(state, body));
}

function declare(state: GameState, index: number) {
  return applyAction(state, { type: "attack", seat: "p1", index });
}

/** The declaration is REJECTED with `code`, and the message is returned for pinning. */
function rejected(state: GameState, index: number, code: string): string {
  const result = declare(state, index);
  if (result.ok) throw new Error(`expected ${code}, but the attack applied`);
  expect(result.error.code).toBe(code);
  return result.error.message;
}

function applied(state: GameState, index: number): GameEvent[] {
  const result = declare(state, index);
  if (!result.ok) {
    throw new Error(
      `expected the attack to apply, got ${result.error.code}: ${result.error.message}`,
    );
  }
  const names = types(result.events);
  expect(names).toContain("ATTACK_DECLARED");
  expect(names).toContain("DAMAGE_DEALT");
  expect(names).not.toContain("ATTACK_EFFECT_SKIPPED");
  return result.events;
}

function attackRows(state: GameState) {
  const phase = redactGame(state, "p1").phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.attacks;
}

const damaged = (state: GameState) => setDamage(state, "p1", 10);

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the derivation and the table.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — both sentences are WHOLE gate clauses, and nothing else moved", () => {
  it("the corpus rows are the committed bytes, 1 legal printing each", () => {
    expect(legalAttackCorpus().filter(([, s]) => s === ALT)).toEqual([[1, ALT]]);
    expect(legalAttackCorpus().filter(([, s]) => s === WAIVE)).toEqual([[1, WAIVE]]);
  });

  it('each splits as the WHOLE text — `body: ""`, D395\'s path — and no reader claims it', () => {
    expect(splitAttackGateClause(ALT)).toEqual({ clause: ALT, body: "" });
    expect(splitAttackGateClause(WAIVE)).toEqual({ clause: WAIVE, body: "" });
    for (const text of [ALT, WAIVE]) {
      expect(resolvedByAnyReader(text)).toBe(false);
      expect(deriveAttackEffect(text)).toBeNull();
      expect(splitAttackTrailingClause(text)).toBeNull();
    }
  });

  it("the two gates, BY VALUE — and they are not each other's", () => {
    expect(timingGateFromAttackText(ALT)).toEqual({
      kind: "alternateCostIf",
      condition: { kind: "yourActiveDamaged" },
      cost: ["Fighting"],
    });
    expect(timingGateFromAttackText(WAIVE)).toEqual({
      kind: "costWaivedIf",
      condition: { kind: "yourActiveHasSpecialCondition" },
    });
  });

  it("all SEVEN rows are pairwise disjoint under the leading AND trailing splits ( D593: the list's EIGHTH row, Cutting Riposte's {D}, is clauseRowsMeD593 §1's)", () => {
    const all = [...OLD_CLAUSES, ALT, WAIVE];
    expect(new Set(all).size).toBe(7);
    for (const a of all) {
      for (const b of all) {
        if (a === b) continue;
        expect(a.startsWith(`${b} `)).toBe(false);
        expect(a.endsWith(` ${b}`)).toBe(false);
      }
      if (!([ALT, WAIVE] as string[]).includes(a)) {
        expect(["onlyIf", "barredIf", "firstTurnExempt"]).toContain(
          timingGateFromAttackText(a)?.kind,
        );
      }
    }
    expect(splitAttackGateClause(`${ALT} ${WAIVE}`)).toBeNull();
    expect(splitAttackGateClause(`${OLD_CLAUSES[0]} ${ALT}`)).toBeNull();
  });

  it("NO OTHER CORPUS ROW NEWLY SPLITS — the gate population is 9 sentences / 19 printings", () => {
    const split = legalAttackCorpus().filter(([, s]) => splitAttackGateClause(s) !== null);
    expect(split).toHaveLength(9);
    expect(split.reduce((sum, [n]) => sum + n, 0)).toBe(19);
    const costRows = split.filter(([, s]) => {
      const kind = timingGateFromAttackText(s)?.kind;
      return kind === "alternateCostIf" || kind === "costWaivedIf";
    });
    expect(costRows.map(([, s]) => s).sort()).toEqual([ALT, WAIVE].sort());
  });

  it("`attackGateOf` answers the clause at index 0 and NOTHING at index 1 — index-keyed", () => {
    const alt = ready("d545-alt", {});
    expect(attackGateOf(alt, activeOf(alt, "p1"), ALT_INDEX)?.kind).toBe("alternateCostIf");
    expect(attackGateOf(alt, activeOf(alt, "p1"), PLAIN_INDEX)).toBeUndefined();
    const waive = ready("d545-waive", {});
    expect(attackGateOf(waive, activeOf(waive, "p1"), WAIVE_INDEX)?.kind).toBe("costWaivedIf");
    expect(attackGateOf(waive, activeOf(waive, "p1"), PLAIN_INDEX)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the new member, and the seat it reads.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — `yourActiveHasSpecialCondition` is the SELF twin, and reads the caller's seat", () => {
  const cond = { kind: "yourActiveHasSpecialCondition" } as const;

  it("false on a clean Active, true under each of Poison, Burn, Confusion, Sleep, Paralysis", () => {
    const clean = ready("d545-waive", {});
    expect(conditionHolds(clean, "p1", cond)).toBe(false);
    for (const status of [
      { poisonDamage: 10 },
      { burned: true },
      { rotation: "confused" as const },
      { rotation: "asleep" as const },
      { rotation: "paralyzed" as const },
    ]) {
      expect(conditionHolds(setConditions(clean, "p1", status), "p1", cond)).toBe(true);
    }
  });

  it("the OPPONENT's condition does not satisfy it — the seat is the caller's", () => {
    const foe = setConditions(ready("d545-waive", {}), "p2", { poisonDamage: 10 });
    expect(conditionHolds(foe, "p1", cond)).toBe(false);
    expect(conditionHolds(foe, "p2", cond)).toBe(true);
    expect(conditionHolds(foe, "p1", { kind: "opponentActiveHasSpecialCondition" })).toBe(true);
  });

  it("its note drops the printed pronoun (D116)", () => {
    expect(conditionNote(cond)).toBe("your Active Pokémon is affected by a Special Condition");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — `:316`, the ALTERNATE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — `:316` is an ALTERNATE cost: never stricter than printed", () => {
  it("condition FALSE: `{F}` alone does not pay, and the message names the PRINTED cost", () => {
    const state = ready("d545-alt", { F: 1 });
    expect(charged(state, ALT_INDEX)).toEqual(ALT_PRINTED);
    expect(rejected(state, ALT_INDEX, "ATTACK_COST_UNMET")).toBe(
      "Rock Alternate costs [Water, Water, Colorless]",
    );
  });

  it("condition FALSE: the printed cost pays as it always did", () => {
    const state = ready("d545-alt", { W: 2, C: 1 });
    expect(charged(state, ALT_INDEX)).toEqual(ALT_PRINTED);
    applied(state, ALT_INDEX);
  });

  it("condition TRUE, only `{F}` payable: charged `[Fighting]` and the attack applies", () => {
    const state = damaged(ready("d545-alt", { F: 1 }));
    expect(charged(state, ALT_INDEX)).toEqual(["Fighting"]);
    applied(state, ALT_INDEX);
  });

  it("condition TRUE, only the PRINTED cost payable: still applies — NOT a replacement", () => {
    const state = damaged(ready("d545-alt", { W: 2, C: 1 }));
    expect(charged(state, ALT_INDEX)).toEqual(ALT_PRINTED);
    applied(state, ALT_INDEX);
  });

  it("condition TRUE, BOTH payable: the alternate is what is charged", () => {
    const state = damaged(ready("d545-alt", { W: 2, C: 1, F: 1 }));
    expect(charged(state, ALT_INDEX)).toEqual(["Fighting"]);
    applied(state, ALT_INDEX);
  });

  it("condition TRUE, NEITHER payable: rejected, and the message names the PRINTED cost", () => {
    // The third UNRULED decision: with nothing payable the gate publishes the printed
    // (effective) charge, not the alternate.
    const state = damaged(ready("d545-alt", { W: 1 }));
    expect(charged(state, ALT_INDEX)).toEqual(ALT_PRINTED);
    expect(rejected(state, ALT_INDEX, "ATTACK_COST_UNMET")).toBe(
      "Rock Alternate costs [Water, Water, Colorless]",
    );
  });

  it("the clause is on index 0 ONLY — index 1 on the same damaged body is charged its print", () => {
    const state = damaged(ready("d545-alt", { F: 1 }));
    expect(charged(state, PLAIN_INDEX)).toEqual(ALT_PRINTED);
    expect(rejected(state, PLAIN_INDEX, "ATTACK_COST_UNMET")).toBe(
      "Plain Rock costs [Water, Water, Colorless]",
    );
  });

  it("identity is preserved on the common board: no clause in effect returns the printed array", () => {
    const state = ready("d545-alt", { W: 2, C: 1 });
    const body = activeOf(state, "p1");
    const printed = state.cardPool["d545-alt"]?.attacks?.[ALT_INDEX]?.cost;
    expect(charged(state, ALT_INDEX)).toBe(printed);
    expect(effectiveAttackCost(state, body, printed ?? [])).toBe(printed);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE TRAP.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — THE TRAP: a cost clause whose condition HOLDS never blocks", () => {
  it("`attackTimingBlocked` answers undefined for both kinds, condition true AND false", () => {
    for (const state of [
      ready("d545-alt", {}),
      damaged(ready("d545-alt", {})),
      ready("d545-waive", {}),
      setConditions(ready("d545-waive", {}), "p1", { poisonDamage: 10 }),
    ]) {
      expect(attackTimingBlocked(state, "p1", activeOf(state, "p1"), 0)).toBeUndefined();
    }
  });

  it("the condition-TRUE boards are NOT refused with ATTACK_PREVENTED — they apply", () => {
    const alt = damaged(ready("d545-alt", { F: 1 }));
    const altResult = declare(alt, ALT_INDEX);
    expect(altResult.ok ? "ok" : altResult.error.code).toBe("ok");
    const waive = setConditions(ready("d545-waive", {}), "p1", { burned: true });
    const waiveResult = declare(waive, WAIVE_INDEX);
    expect(waiveResult.ok ? "ok" : waiveResult.error.code).toBe("ok");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — `:324`, the WAIVE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — `:324` waives the whole cost while the attacker carries a Special Condition", () => {
  it("condition FALSE, no Energy: rejected, the message names the printed cost", () => {
    const state = ready("d545-waive", {});
    expect(charged(state, WAIVE_INDEX)).toEqual(WAIVE_PRINTED);
    expect(rejected(state, WAIVE_INDEX, "ATTACK_COST_UNMET")).toBe(
      "Free Vine costs [Grass, Grass, Colorless]",
    );
  });

  it("POISONED, no Energy: charged `[]`, and the attack applies", () => {
    const state = setConditions(ready("d545-waive", {}), "p1", { poisonDamage: 10 });
    expect(charged(state, WAIVE_INDEX)).toEqual([]);
    applied(state, WAIVE_INDEX);
  });

  it("BURNED, no Energy: charged `[]`, and the attack applies", () => {
    const state = setConditions(ready("d545-waive", {}), "p1", { burned: true });
    expect(charged(state, WAIVE_INDEX)).toEqual([]);
    applied(state, WAIVE_INDEX);
  });

  it("CONFUSED is a Special Condition too — charged `[]` (not declared: the flip is rng)", () => {
    const state = setConditions(ready("d545-waive", {}), "p1", { rotation: "confused" });
    expect(charged(state, WAIVE_INDEX)).toEqual([]);
  });

  it("ASLEEP / PARALYZED: the cost is waived and the attack is STILL barred by §12", () => {
    for (const rotation of ["asleep", "paralyzed"] as const) {
      const state = setConditions(ready("d545-waive", {}), "p1", { rotation });
      expect(charged(state, WAIVE_INDEX)).toEqual([]);
      rejected(state, WAIVE_INDEX, "STATUS_PREVENTS_ATTACK");
      expect(attackRows(state)[WAIVE_INDEX]?.playable).toBe(false);
    }
  });

  it("the OPPONENT being Poisoned waives nothing — the condition is on THIS Pokémon", () => {
    const state = setConditions(ready("d545-waive", {}), "p2", { poisonDamage: 10 });
    expect(charged(state, WAIVE_INDEX)).toEqual(WAIVE_PRINTED);
    rejected(state, WAIVE_INDEX, "ATTACK_COST_UNMET");
  });

  it("the clause is on index 0 ONLY — index 1 on the same Poisoned body is charged its print", () => {
    const state = setConditions(ready("d545-waive", {}), "p1", { poisonDamage: 10 });
    expect(charged(state, PLAIN_INDEX)).toEqual(WAIVE_PRINTED);
    rejected(state, PLAIN_INDEX, "ATTACK_COST_UNMET");
  });

  it("the waive leaves every attached unit as `extra` — the charge is the empty array", () => {
    const state = setConditions(ready("d545-waive", { G: 2 }), "p1", { poisonDamage: 10 });
    expect(charged(state, WAIVE_INDEX)).toEqual([]);
    expect(costMet(charged(state, WAIVE_INDEX), [])).toBe(true);
  });

  it("…and the extra-Energy reader SEES it: the waived `[]` is what `scaledAttackDamage` counts against", () => {
    const dealt = (state: GameState): number => {
      const hit = applied(state, WAIVE_INDEX).find((e) => e.type === "DAMAGE_DEALT") as
        | { damage?: number }
        | undefined;
      return hit?.damage ?? 0;
    };
    const attach: Energy = { G: 2, C: 1 };
    const clean = ready("d545-waive-extra", attach);
    expect(charged(clean, WAIVE_INDEX)).toEqual(WAIVE_PRINTED);
    expect(dealt(clean)).toBe(40);
    const poisoned = setConditions(ready("d545-waive-extra", attach), "p1", { poisonDamage: 10 });
    expect(charged(poisoned, WAIVE_INDEX)).toEqual([]);
    expect(dealt(poisoned)).toBe(90);
    // …and the printed threshold still binds under the waive: ONE unit is 1 extra, not 2.
    const one = setConditions(ready("d545-waive-extra", { G: 1 }), "p1", { poisonDamage: 10 });
    expect(dealt(one)).toBe(40);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the continuous surcharges: THE ORDER PINS.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — League HQ and Quaking Zone: alternate-THEN-surcharge, surcharge-THEN-waive", () => {
  it("League HQ, condition FALSE: the printed cost takes its {C} (the control)", () => {
    const state = withLeagueHq(ready("d545-alt", { W: 2, C: 1 }));
    expect(charged(state, ALT_INDEX)).toEqual([...ALT_PRINTED, "Colorless"]);
    expect(rejected(state, ALT_INDEX, "ATTACK_COST_UNMET")).toBe(
      "Rock Alternate costs [Water, Water, Colorless, Colorless]",
    );
  });

  it("League HQ, `:316` TRUE, `{F}` alone: the ALTERNATE takes the surcharge too — rejected", () => {
    const state = withLeagueHq(damaged(ready("d545-alt", { F: 1 })));
    // Neither `[F, C]` nor the printed-plus-{C} is payable, so the charge (and the message)
    // is the EFFECTIVE printed cost.
    expect(charged(state, ALT_INDEX)).toEqual([...ALT_PRINTED, "Colorless"]);
    expect(rejected(state, ALT_INDEX, "ATTACK_COST_UNMET")).toBe(
      "Rock Alternate costs [Water, Water, Colorless, Colorless]",
    );
  });

  it("League HQ, `:316` TRUE, `{F}{C}`: charged `[Fighting, Colorless]` and applies", () => {
    const state = withLeagueHq(damaged(ready("d545-alt", { F: 1, C: 1 })));
    expect(charged(state, ALT_INDEX)).toEqual(["Fighting", "Colorless"]);
    applied(state, ALT_INDEX);
  });

  it("Quaking Zone, `:316` TRUE: `{F}` alone is rejected, `{F}{C}` applies", () => {
    const lone = damaged(ready("d545-alt", { F: 1 }, "sv03-052"));
    expect(charged(lone, ALT_INDEX)).toEqual([...ALT_PRINTED, "Colorless"]);
    rejected(lone, ALT_INDEX, "ATTACK_COST_UNMET");
    const paid = damaged(ready("d545-alt", { F: 1, C: 1 }, "sv03-052"));
    expect(charged(paid, ALT_INDEX)).toEqual(["Fighting", "Colorless"]);
    applied(paid, ALT_INDEX);
  });

  it("League HQ, `:324` FALSE: the printed cost takes its {C} (the control)", () => {
    const state = withLeagueHq(ready("d545-waive", {}));
    expect(charged(state, WAIVE_INDEX)).toEqual([...WAIVE_PRINTED, "Colorless"]);
    expect(rejected(state, WAIVE_INDEX, "ATTACK_COST_UNMET")).toBe(
      "Free Vine costs [Grass, Grass, Colorless, Colorless]",
    );
  });

  it("League HQ, `:324` TRUE, no Energy: WAIVE-LAST — the surcharge is ignored with the rest", () => {
    const state = withLeagueHq(setConditions(ready("d545-waive", {}), "p1", { poisonDamage: 10 }));
    expect(charged(state, WAIVE_INDEX)).toEqual([]);
    applied(state, WAIVE_INDEX);
  });

  it("Quaking Zone, `:324` TRUE, no Energy: WAIVE-LAST on the opposing aura too", () => {
    const state = setConditions(ready("d545-waive", {}, "sv03-052"), "p1", { burned: true });
    expect(charged(state, WAIVE_INDEX)).toEqual([]);
    applied(state, WAIVE_INDEX);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — the wire.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — `redactedAttacksOf` publishes the charged array as `effectiveCost`", () => {
  it("condition FALSE: no `effectiveCost` — the frame is byte-identical to the unclaused one", () => {
    const rows = attackRows(ready("d545-alt", { F: 1 }));
    expect(rows[ALT_INDEX]?.effectiveCost).toBeUndefined();
    expect(rows[ALT_INDEX]?.playable).toBe(false);
    expect(rows[ALT_INDEX]?.cost).toEqual(ALT_PRINTED);
  });

  it("`:316` TRUE and `{F}` attached: `effectiveCost` is `[Fighting]` and the row is playable", () => {
    const rows = attackRows(damaged(ready("d545-alt", { F: 1 })));
    expect(rows[ALT_INDEX]).toMatchObject({
      cost: ALT_PRINTED,
      effectiveCost: ["Fighting"],
      playable: true,
    });
    expect(redactedAttackSchema.safeParse(rows[ALT_INDEX]).success).toBe(true);
    // The index-1 control on the same body is the print, unpayable.
    expect(rows[PLAIN_INDEX]?.effectiveCost).toBeUndefined();
    expect(rows[PLAIN_INDEX]?.playable).toBe(false);
  });

  it("`:316` TRUE but only the printed cost payable: no `effectiveCost`, still playable", () => {
    const rows = attackRows(damaged(ready("d545-alt", { W: 2, C: 1 })));
    expect(rows[ALT_INDEX]?.effectiveCost).toBeUndefined();
    expect(rows[ALT_INDEX]?.playable).toBe(true);
  });

  it("`:324` TRUE: `effectiveCost` is `[]` and the row is playable with no Energy attached", () => {
    const rows = attackRows(setConditions(ready("d545-waive", {}), "p1", { poisonDamage: 10 }));
    expect(rows[WAIVE_INDEX]).toMatchObject({
      cost: WAIVE_PRINTED,
      effectiveCost: [],
      playable: true,
    });
    expect(redactedAttackSchema.safeParse(rows[WAIVE_INDEX]).success).toBe(true);
  });

  it("`:324` FALSE: no `effectiveCost`, not playable", () => {
    const rows = attackRows(ready("d545-waive", {}));
    expect(rows[WAIVE_INDEX]?.effectiveCost).toBeUndefined();
    expect(rows[WAIVE_INDEX]?.playable).toBe(false);
  });

  it("League HQ + `:324` TRUE: `effectiveCost` is `[]`, not `[Colorless]`", () => {
    const rows = attackRows(
      withLeagueHq(setConditions(ready("d545-waive", {}), "p1", { burned: true })),
    );
    expect(rows[WAIVE_INDEX]).toMatchObject({ effectiveCost: [], playable: true });
  });
});
