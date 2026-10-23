import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, splitAttackGateClause, splitAttackTrailingClause } from "./effects";
import { engineVersion } from "./index";
import type { EffectOp, GameEvent, GameState, Seat } from "./index";
import { runProgram } from "./interpreter";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  driveSetup,
  roundTrip,
} from "./testFixtures";

const PRINTED_BOTH =
  "This attack also does 10 damage to each Benched Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** File line 526 — the same reading NARROWED by the printed board predicate. */
const PRINTED_DAMAGED =
  "This attack also does 40 damage to each Benched Pokémon that has any damage counters on it (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)";
const FLAT_OPP =
  "This attack also does 10 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const FLAT_OWN =
  "This attack also does 10 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const BOTH_40 =
  "This attack also does 40 damage to each Benched Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)";
const FOUR_ZONE =
  "This attack does 50 damage to each Pokémon that has any damage counters on it (both yours and your opponent's), except for this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const program = (amount: number, damagedOnly = false): readonly EffectOp[] =>
  damagedOnly
    ? [
        { op: "spreadDamage", target: "yourBench", amount, damagedOnly: true },
        { op: "spreadDamage", target: "opponentBench", amount, damagedOnly: true },
      ]
    : [
        { op: "spreadDamage", target: "yourBench", amount },
        { op: "spreadDamage", target: "opponentBench", amount },
      ];

const SEED = 11;

/** Attack indices, keyed by name so no case addresses a fold by number. */
const AT = {
  both: 0,
  damaged: 1,
  flatOpp: 2,
  flatOwn: 3,
  plain: 4,
  both40: 5,
} as const;

const BASE = 50;

const BOTH_BENCH_CARDS: Record<string, Card> = {
  "d507-quaker": battler("d507-quaker", {
    name: "D507 Quaker",
    types: ["Colorless"],
    hp: 330,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Table Quake", effect: PRINTED_BOTH, damage: BASE },
      { cost: ["Colorless"], name: "Bruise Quake", effect: PRINTED_DAMAGED, damage: BASE },
      { cost: ["Colorless"], name: "Far Quake", effect: FLAT_OPP, damage: BASE },
      { cost: ["Colorless"], name: "Home Quake", effect: FLAT_OWN, damage: BASE },
      // No effect text at all: the control that separates "the program ran and found
      // nothing to do" from "no program ran" on the undamaged board of §5.
      { cost: ["Colorless"], name: "Plain Cuff", damage: BASE },
      { cost: ["Colorless"], name: "Big Table Quake", effect: BOTH_40, damage: BASE },
    ],
  }),
  "d507-wall": battler("d507-wall", { name: "D507 Wall", types: ["Colorless"], hp: 400 }),
  /** The opponent's Bench: THREE bodies, so *"each"* against *"1 of"* is visible and a
      build that hit one body is killed (a bench of one makes the two agree). Distinct HP
      so no reading Knocks anything out — a KO stops answering a number. */
  "d507-foe-a": battler("d507-foe-a", { name: "D507 Foe A", types: ["Colorless"], hp: 300 }),
  "d507-foe-b": battler("d507-foe-b", { name: "D507 Foe B", types: ["Colorless"], hp: 310 }),
  "d507-foe-c": battler("d507-foe-c", { name: "D507 Foe C", types: ["Colorless"], hp: 320 }),
  "d507-ally-a": battler("d507-ally-a", { name: "D507 Ally A", types: ["Colorless"], hp: 300 }),
  "d507-ally-b": battler("d507-ally-b", { name: "D507 Ally B", types: ["Colorless"], hp: 310 }),
};

const BOTH_BENCH_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...BOTH_BENCH_CARDS };

const BOTH_BENCH_DECK = deckOf({
  "d507-quaker": 8,
  "d507-wall": 8,
  "d507-foe-a": 8,
  "d507-foe-b": 8,
  "d507-foe-c": 8,
  "d507-ally-a": 8,
  "d507-ally-b": 8,
  "fix-energy": 4,
});

function openTable(first: Seat): GameState {
  return driveSetup(
    SEED,
    { p1: BOTH_BENCH_DECK, p2: BOTH_BENCH_DECK },
    { pool: BOTH_BENCH_POOL, first },
  );
}

function table(damaged = false): GameState {
  let state = openTable("p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, "p1", "d507-quaker");
  state = setActiveFromDeck(state, "p2", "d507-wall");
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  state = attachFromDeck(state, "p1", "fix-energy", 2);
  for (const id of ["d507-foe-a", "d507-foe-b", "d507-foe-c"])
    state = benchFromDeck(state, "p2", id);
  for (const id of ["d507-ally-a", "d507-ally-b"]) state = benchFromDeck(state, "p1", id);
  if (damaged) {
    state = setBenchDamage(state, "p2", 0, 10);
    state = setBenchDamage(state, "p1", 1, 20);
  }
  return state;
}

function swing(state: GameState, index: number) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

/** `[active, ...bench]` damage — the whole discrimination of §4 to §6. */
function damageVector(state: GameState, seat: Seat): number[] {
  const side = state.players[seat];
  return [side.active?.damage ?? -1, ...side.bench.map((b) => b.damage)];
}

function damageRows(events: GameEvent[]): { seat: Seat; dealt: number }[] {
  return events.flatMap((e) =>
    e.type === "DAMAGE_DEALT" ? [{ seat: e.seat, dealt: e.dealt }] : [],
  );
}

function units(rows: readonly (readonly [number, string])[]): number {
  return rows.reduce((sum, [n]) => sum + n, 0);
}

describe("D507 §1 — the two corpus rows, the apostrophe bytes, and every anchor variant", () => {
  it("both specimens ARE rows of `legalAttackCorpus()`, at the counts the corpus states", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(PRINTED_BOTH)).toBe(1);
    expect(rows.get(PRINTED_DAMAGED)).toBe(1);
    expect(rows.get(FOUR_ZONE)).toBe(1);
    expect(rows.get(BOTH_40)).toBeUndefined();
    // The two one-sided controls ARE printed, which is what makes them controls.
    expect(rows.get(FLAT_OPP)).toBe(1);
    expect(rows.get(FLAT_OWN)).toBe(3);
  });

  it("every apostrophe in both prints is U+0027, measured with `codePointAt` and not by eye", () => {
    for (const text of [PRINTED_BOTH, PRINTED_DAMAGED]) {
      const marks = [...text].filter((ch) => ch === "'" || ch === "’");
      expect(marks.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < text.length; i += 1) {
        const code = text.codePointAt(i);
        expect(code, `U+2019 at ${i} of ${text}`).not.toBe(0x2019);
      }
    }
    // …and the CURLY spelling still derives, which is what the character class buys.
    expect(deriveAttackEffect(PRINTED_BOTH.replace(/'/g, "’"))).toEqual(program(10));
  });

  it("the anchor's FOUR variants, measured over all 640 rows — and only one of them is right", () => {
    const corpus = legalAttackCorpus();
    const claims = (re: RegExp) => {
      const rows = corpus.filter(([, s]) => re.test(s));
      return [rows.length, units(rows)];
    };
    const SHIPPED =
      /^This attack (?:also )?does (\d+) damage to each Benched Pokémon( that has any damage counters on it)? \(both yours and your opponent['’]s\)\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/;
    const CLAUSE_MANDATORY =
      /^This attack (?:also )?does (\d+) damage to each Benched Pokémon that has any damage counters on it \(both yours and your opponent['’]s\)\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/;
    const CLAUSE_FREE =
      /^This attack (?:also )?does (\d+) damage to each Benched Pokémon \(both yours and your opponent['’]s\)\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/;
    const NO_ALSO =
      /^This attack does (\d+) damage to each Benched Pokémon( that has any damage counters on it)? \(both yours and your opponent['’]s\)\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/;
    expect(claims(SHIPPED)).toEqual([2, 2]);
    expect(claims(CLAUSE_MANDATORY)).toEqual([1, 1]);
    expect(claims(CLAUSE_FREE)).toEqual([1, 1]);
    expect(claims(NO_ALSO)).toEqual([0, 0]);
  });

  it("the W/R parenthetical is OPTIONAL and the optionality claims the same rows", () => {
    const corpus = legalAttackCorpus();
    const MANDATORY =
      /^This attack (?:also )?does (\d+) damage to each Benched Pokémon( that has any damage counters on it)? \(both yours and your opponent['’]s\)\. \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\)$/;
    const rows = corpus.filter(([, s]) => MANDATORY.test(s));
    expect([rows.length, units(rows)]).toEqual([2, 2]);
    // …and the tail-less spellings derive, which is what the optional group buys.
    expect(
      deriveAttackEffect(
        "This attack also does 10 damage to each Benched Pokémon (both yours and your opponent's).",
      ),
    ).toEqual(program(10));
    expect(
      deriveAttackEffect(
        "This attack also does 40 damage to each Benched Pokémon that has any damage counters on it (both yours and your opponent's).",
      ),
    ).toEqual(program(40, true));
  });

  it("the two anchors of this family are DISJOINT, so their ORDER is free (D502's question)", () => {
    const corpus = legalAttackCorpus();
    const mine = corpus.filter(
      ([, s]) => (deriveAttackEffect(s) ?? []).filter((o) => o.op === "spreadDamage").length === 2,
    );
    expect(mine.map(([, s]) => s).sort()).toEqual(
      [PRINTED_BOTH, PRINTED_DAMAGED, FOUR_ZONE].sort(),
    );
    expect(deriveAttackEffect(FOUR_ZONE)?.[0]?.op).toBe("conditionGate");
    const theirs = corpus.filter(([, s]) => {
      const ops = deriveAttackEffect(s) ?? [];
      return ops.length === 1 && ops[0]?.op === "spreadDamage";
    });
    expect(theirs.map(([, s]) => s)).not.toContain(PRINTED_BOTH);
    expect(theirs.map(([, s]) => s)).not.toContain(PRINTED_DAMAGED);
    expect(theirs.length).toBeGreaterThanOrEqual(4);
  });

  it("AUTHORS nothing — the two legal printings are read off the TEXT, not from a registry row", () => {
    expect(Object.keys(BOTH_BENCH_CARDS).every((id) => FIXTURE_POOL[id] === undefined)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE TWO READINGS, AND EVERY NEAR-MISS WITH AN ADMISSION BESIDE IT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D507 §2 — both prints derive, the rider is read, and every neighbour is read WITHOUT it", () => {
  it("file line 515 derives to TWO `spreadDamage` ops, spelled whole and in seat order", () => {
    expect(deriveAttackEffect(PRINTED_BOTH)).toEqual(program(10));
  });

  it("file line 526 derives to the SAME pair carrying `damagedOnly` on BOTH ops", () => {
    expect(deriveAttackEffect(PRINTED_DAMAGED)).toEqual(program(40, true));
  });

  it("…and the ONE-SIDED siblings are UNMOVED — the control without which the two above are tautologies", () => {
    expect(deriveAttackEffect(FLAT_OPP)).toEqual([
      { op: "spreadDamage", target: "opponentBench", amount: 10 },
    ]);
    expect(deriveAttackEffect(FLAT_OWN)).toEqual([
      { op: "spreadDamage", target: "yourBench", amount: 10 },
    ]);
    // Neither carries the rider, and neither became a two-op program.
    for (const text of [FLAT_OPP, FLAT_OWN]) {
      const ops = deriveAttackEffect(text) as EffectOp[];
      expect(ops).toHaveLength(1);
      expect(JSON.stringify(ops)).not.toContain("damagedOnly");
    }
  });

  it("the AMOUNT is the capture, not a constant — the 40 probe on the unfiltered spelling", () => {
    expect(deriveAttackEffect(BOTH_40)).toEqual(program(40));
  });

  it("refuses the near-misses — and ADMITS one on the same axis beside each (D424)", () => {
    const pairs: readonly (readonly [string, string, string])[] = [
      // the seat scope: drop the parenthetical and no reader owns an ownerless bench noun
      [
        "the parenthetical deleted (an ownerless bench noun)",
        "This attack also does 10 damage to each Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        PRINTED_BOTH,
      ],
      // the parenthetical's WORDING: a spelling the column does not print
      [
        "`(both yours and your opponent's)` reworded",
        "This attack also does 10 damage to each Benched Pokémon (yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)",
        PRINTED_BOTH,
      ],
      // the quantifier: "1 of" is a CHOICE and a different op
      [
        "`1 of` (a choice, and a different op)",
        "This attack also does 10 damage to 1 Benched Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)",
        PRINTED_BOTH,
      ],
      // the ZONE: "each Pokémon" reaches the Actives, and that is §8's refusal
      [
        "`each Pokémon` (four zones, not two)",
        "This attack also does 10 damage to each Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)",
        PRINTED_BOTH,
      ],
      // the PREDICATE's wording: a board fact this engine's rider does not spell
      [
        "`that has no damage counters on it` (the complement)",
        "This attack also does 40 damage to each Benched Pokémon that has no damage counters on it (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)",
        PRINTED_DAMAGED,
      ],
      // the lookalike é falls off the path silently, which is the family's reason
      ["a lookalike `Pokemon`", PRINTED_BOTH.replace(/Pokémon/g, "Pokemon"), PRINTED_BOTH],
      // no leading `This attack`: a mid-sentence clause must not reach this path
      ["a mid-sentence clause", `Flip a coin. ${PRINTED_BOTH}`, PRINTED_BOTH],
    ];
    for (const [why, refused, admitted] of pairs) {
      expect(deriveAttackEffect(refused), `REFUSED: ${why}`).toBeNull();
      expect(deriveAttackEffect(admitted), `ADMITTED beside ${why}`).not.toBeNull();
    }
  });
});

const AXES = {
  damaged: [" that has any damage counters on it", ""],
  amount: ["40", "10"],
  wr: [" (Don't apply Weakness and Resistance for Benched Pokémon.)", ""],
  also: ["also ", ""],
} as const;

type Bit = 0 | 1;
const BITS: readonly Bit[] = [0, 1];

function latticePoint(b: Bit, d: Bit, n: Bit, w: Bit, o: Bit): string {
  const noun =
    b === 0
      ? `each Benched Pokémon${AXES.damaged[d]} (both yours and your opponent's)`
      : `each of your Benched Pokémon${AXES.damaged[d]}`;
  return `This attack ${AXES.also[o]}does ${AXES.amount[n]} damage to ${noun}.${AXES.wr[w]}`;
}

function buildsHere(text: string): boolean {
  if (resolvedByAnyReader(text)) return true;
  const gate = splitAttackGateClause(text);
  if (gate !== null && (gate.body === "" || resolvedByAnyReader(gate.body))) return true;
  return splitAttackTrailingClause(text) !== null;
}

function claimedByTheNewArm(text: string): boolean {
  const spreads = (deriveAttackEffect(text) ?? []).filter((op) => op.op === "spreadDamage");
  return (
    spreads.length === 2 &&
    spreads.some((op) => op.op === "spreadDamage" && op.target === "yourBench") &&
    spreads.some((op) => op.op === "spreadDamage" && op.target === "opponentBench")
  );
}

function vector(pred: (t: string) => boolean): { built: number[]; total: number[] } {
  const built = [0, 0, 0, 0, 0, 0];
  const total = [0, 0, 0, 0, 0, 0];
  for (const b of BITS)
    for (const d of BITS)
      for (const n of BITS)
        for (const w of BITS)
          for (const o of BITS) {
            const point = latticePoint(b, d, n, w, o);
            const weight = b + d + n + w + o;
            total[weight] = (total[weight] ?? 0) + 1;
            if (pred(point) && !claimedByTheNewArm(point)) built[weight] = (built[weight] ?? 0) + 1;
          }
  return { built, total };
}

function builtBefore(point: string): boolean {
  return buildsHere(point) && !claimedByTheNewArm(point);
}

describe("D507 §3 — the 2⁵ axis-substitution lattice, over BOTH predicates", () => {
  it("the print is weight 0 and every one of the 32 points is a DISTINCT string", () => {
    expect(latticePoint(0, 0, 0, 0, 0)).toBe(PRINTED_DAMAGED);
    expect(latticePoint(0, 1, 1, 0, 0)).toBe(PRINTED_BOTH);
    const points = new Set(
      BITS.flatMap((b) =>
        BITS.flatMap((d) =>
          BITS.flatMap((n) => BITS.flatMap((w) => BITS.map((o) => latticePoint(b, d, n, w, o)))),
        ),
      ),
    );
    expect(points.size).toBe(32);
    for (const axis of Object.values(AXES)) expect(axis[0]).not.toBe(axis[1]);
    expect(latticePoint(0, 0, 0, 0, 0)).not.toBe(latticePoint(1, 0, 0, 0, 0));
  });

  it("READERS-ONLY reads `0/1 · 0/5 · 1/10 · 3/10 · 3/5 · 1/1`", () => {
    const { built, total } = vector(resolvedByAnyReader);
    expect(total).toEqual([1, 5, 10, 10, 5, 1]);
    expect(built).toEqual([0, 0, 1, 3, 3, 1]);
    // A quarter of the lattice builds, which is the arithmetic signature of TWO blocking
    // axes in CONJUNCTION over an otherwise free 2³ — see the rung two down.
    expect(built.reduce((x, y) => x + y)).toBe(8);
  });

  it("SPLITTER-INCLUSIVE reads the SAME vector, and the splitters are null at 32 of 32", () => {
    const { built, total } = vector(buildsHere);
    expect(total).toEqual([1, 5, 10, 10, 5, 1]);
    expect(built).toEqual([0, 0, 1, 3, 3, 1]);
    let divergent = 0;
    let bothNull = 0;
    for (const b of BITS)
      for (const d of BITS)
        for (const n of BITS)
          for (const w of BITS)
            for (const o of BITS) {
              const point = latticePoint(b, d, n, w, o);
              const readersOnly = resolvedByAnyReader(point) && !claimedByTheNewArm(point);
              if (readersOnly !== builtBefore(point)) divergent++;
              if (
                splitAttackGateClause(point) === null &&
                splitAttackTrailingClause(point) === null
              )
                bothNull++;
            }
    expect(divergent).toBe(0);
    expect(bothNull).toBe(32);
  });

  it("THE FACTORISATION — AN EIGHTH SHAPE: two axes flip at 8/16 each, three at 0/16", () => {
    const names = ["scope", "damaged", "amount", "wr", "also"] as const;
    const flips: Record<string, [number, number]> = {};
    for (let axis = 0; axis < 5; axis++) {
      let moved = 0;
      let cells = 0;
      for (const b of BITS)
        for (const d of BITS)
          for (const n of BITS)
            for (const w of BITS)
              for (const o of BITS) {
                const bits: Bit[] = [b, d, n, w, o];
                if (bits[axis] === 1) continue;
                cells++;
                const on: Bit[] = [...bits];
                on[axis] = 1;
                const here = builtBefore(latticePoint(...(bits as [Bit, Bit, Bit, Bit, Bit])));
                const there = builtBefore(latticePoint(...(on as [Bit, Bit, Bit, Bit, Bit])));
                if (here !== there) moved++;
              }
      flips[names[axis] as string] = [moved, cells];
    }
    expect(flips).toEqual({
      scope: [8, 16],
      damaged: [8, 16],
      amount: [0, 16],
      wr: [0, 16],
      also: [0, 16],
    });
    // …and the THREE separating boards, spelled out so the conjunction is readable from
    // the strings and not only from the counts: either axis alone is refused, and only
    // the pair together builds.
    expect(builtBefore(latticePoint(1, 0, 1, 1, 1))).toBe(false);
    expect(builtBefore(latticePoint(0, 1, 1, 1, 1))).toBe(false);
    expect(builtBefore(latticePoint(1, 1, 0, 0, 0))).toBe(true);
    const claimed = new Set<string>();
    for (const b of BITS)
      for (const d of BITS)
        for (const n of BITS)
          for (const w of BITS)
            for (const o of BITS) {
              const point = latticePoint(b, d, n, w, o);
              if (claimedByTheNewArm(point)) claimed.add(point);
            }
    const expected = new Set<string>();
    for (const d of BITS)
      for (const n of BITS)
        for (const w of BITS) for (const o of BITS) expected.add(latticePoint(0, d, n, w, o));
    expect(claimed.size).toBe(16);
    expect([...claimed].sort()).toEqual([...expected].sort());
    expect(claimed.has(PRINTED_DAMAGED)).toBe(true);
    expect(claimed.has(PRINTED_BOTH)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE BOARD: ONE NUMBER, TWO BENCHES, AND NEITHER ACTIVE SPLASHED.
// ─────────────────────────────────────────────────────────────────────────────

describe("D507 §4 — the same printed number lands on both benches, and on nothing else", () => {
  it("five benched bodies across TWO seats each take 10, and the defender takes the printed base", () => {
    const { state: done } = swing(table(), AT.both);
    expect(damageVector(done, "p2")).toEqual([BASE, 10, 10, 10]);
    expect(damageVector(done, "p1")).toEqual([0, 10, 10]);
  });

  it("…and the ONE-SIDED siblings on the SAME board hit ONE bench each — the attribution control (D214)", () => {
    const far = swing(table(), AT.flatOpp).state;
    expect(damageVector(far, "p2")).toEqual([BASE, 10, 10, 10]);
    expect(damageVector(far, "p1")).toEqual([0, 0, 0]);
    const home = swing(table(), AT.flatOwn).state;
    expect(damageVector(home, "p2")).toEqual([BASE, 0, 0, 0]);
    expect(damageVector(home, "p1")).toEqual([0, 10, 10]);
  });

  it("the AMOUNT is the capture: the 40-probe deals 40 on every benched body of both seats", () => {
    const { state: done } = swing(table(), AT.both40);
    expect(damageVector(done, "p2")).toEqual([BASE, 40, 40, 40]);
    expect(damageVector(done, "p1")).toEqual([0, 40, 40]);
  });

  it("the printed base STILL LANDS, which is what the word `also` buys", () => {
    // The control that separates "the program ran" from "the program replaced the hit":
    // the effect-less attack deals the base and nothing else on the same board.
    const plain = swing(table(), AT.plain).state;
    expect(damageVector(plain, "p2")).toEqual([BASE, 0, 0, 0]);
    expect(damageVector(plain, "p1")).toEqual([0, 0, 0]);
  });

  it("an EMPTY own bench is a silent whiff on that leg and the other leg still lands", () => {
    let state = table();
    state = clearBench(state, "p1");
    const { state: done, events } = swing(state, AT.both);
    expect(damageVector(done, "p2")).toEqual([BASE, 10, 10, 10]);
    expect(damageVector(done, "p1")).toEqual([0]);
    expect(damageRows(events).filter((r) => r.seat === "p1")).toEqual([]);
  });
});

describe("D507 §5 — `damagedOnly` narrows both benches, and the flat sibling does not", () => {
  it("only the two bodies that already carried counters take the 40 — one per seat", () => {
    const { state: done } = swing(table(true), AT.damaged);
    // p2 bench index 0 started at 10; indexes 1 and 2 were clean and stay clean.
    expect(damageVector(done, "p2")).toEqual([BASE, 50, 0, 0]);
    expect(damageVector(done, "p1")).toEqual([0, 0, 60]);
  });

  it("the UNFILTERED reading on the SAME board hits everybody — the rung above is about the RIDER", () => {
    const { state: done } = swing(table(true), AT.both);
    expect(damageVector(done, "p2")).toEqual([BASE, 20, 10, 10]);
    expect(damageVector(done, "p1")).toEqual([0, 10, 30]);
  });

  it("an UNDAMAGED body files NO `DAMAGE_DEALT` row at all — not a row of zero", () => {
    // The difference between "skipped" and "hit for nothing" is invisible in the damage
    // vector and loud in the log, which is where a prevention would have shown up. Four
    // rows: the printed base plus exactly two benched bodies.
    const { events } = swing(table(true), AT.damaged);
    expect(damageRows(events)).toEqual([
      { seat: "p2", dealt: BASE },
      { seat: "p1", dealt: 40 },
      { seat: "p2", dealt: 40 },
    ]);
  });

  it("a board where NOTHING is damaged is a total whiff on both benches, and the base still lands", () => {
    // The zero-candidate board, which is where a build that ignored the rider is loudest.
    const { state: done, events } = swing(table(), AT.damaged);
    expect(damageVector(done, "p2")).toEqual([BASE, 0, 0, 0]);
    expect(damageVector(done, "p1")).toEqual([0, 0, 0]);
    expect(damageRows(events)).toEqual([{ seat: "p2", dealt: BASE }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE SEAT ORDER, WHICH IS OBSERVABLE RATHER THAN COSMETIC.
// ─────────────────────────────────────────────────────────────────────────────

describe("D507 §6 — the attacker's own bench is walked FIRST", () => {
  it("the log reads base, then BOTH own-bench rows, then all three opponent-bench rows", () => {
    const { events } = swing(table(), AT.both);
    expect(damageRows(events)).toEqual([
      { seat: "p2", dealt: BASE },
      { seat: "p1", dealt: 10 },
      { seat: "p1", dealt: 10 },
      { seat: "p2", dealt: 10 },
      { seat: "p2", dealt: 10 },
      { seat: "p2", dealt: 10 },
    ]);
  });

  it("the ORDER survives into the derived program, where a mutant can be seen without a board", () => {
    const ops = deriveAttackEffect(PRINTED_BOTH) as EffectOp[];
    expect(ops.map((o) => (o.op === "spreadDamage" ? o.target : o.op))).toEqual([
      "yourBench",
      "opponentBench",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE RECORD CONSTANT, ARGUED AT THE ADDRESS AND DRIVEN OVER v30 BYTES.
// ─────────────────────────────────────────────────────────────────────────────

describe("D507 §7 — `MATCH_RECORD_VERSION` holds at 30, and D505's argument is RE-DERIVED", () => {
  const ctx = { seat: "p1" as Seat, invokedBy: "attack" as const };

  const V30_PROGRAM = [
    { op: "spreadDamage", target: "yourBench", amount: 40 },
    { op: "spreadDamage", target: "opponentBench", amount: 40 },
  ] as unknown as EffectOp[];

  it("each op differs in exactly ONE key, and the v30 bytes survive a JSON round trip", () => {
    const derived = deriveAttackEffect(PRINTED_DAMAGED) as EffectOp[];
    expect(derived).toHaveLength(2);
    derived.forEach((op, i) => {
      const old = V30_PROGRAM[i] as unknown as Record<string, unknown>;
      const differing = Object.keys(op).filter(
        (k) =>
          JSON.stringify((op as unknown as Record<string, unknown>)[k]) !== JSON.stringify(old[k]),
      );
      expect(differing).toEqual(["damagedOnly"]);
    });
    expect(roundTrip(V30_PROGRAM)).toEqual(V30_PROGRAM);
    expect(roundTrip(deriveAttackEffect(PRINTED_BOTH))).toEqual(
      V30_PROGRAM.map((o) => ({ ...o, amount: 10 })),
    );
  });

  it("NEITHER op parks — `runProgram` answers `done` over the WHOLE length-two program", () => {
    const state = table(true);
    const events: GameEvent[] = [];
    const run = runProgram(state, deriveAttackEffect(PRINTED_DAMAGED) as EffectOp[], ctx, events);
    expect(run.kind).toBe("done");
    expect(swing(state, AT.damaged).state.phase.kind).not.toBe("effect:choose");
  });

  it("a v30 program WITHOUT the rider splashes the UNDAMAGED bodies too — the LOSS direction", () => {
    const state = table(true);
    const events: GameEvent[] = [];
    const run = runProgram(state, V30_PROGRAM, ctx, events);
    if (run.kind !== "done") throw new Error("expected done");
    expect(damageVector(run.state, "p2")).toEqual([0, 50, 40, 40]);
    expect(damageVector(run.state, "p1")).toEqual([0, 40, 60]);
  });

  it("…and the NEW bytes on the SAME board answer differently — both directions or neither (D441)", () => {
    const state = table(true);
    const events: GameEvent[] = [];
    const run = runProgram(state, deriveAttackEffect(PRINTED_DAMAGED) as EffectOp[], ctx, events);
    if (run.kind !== "done") throw new Error("expected done");
    expect(damageVector(run.state, "p2")).toEqual([0, 50, 0, 0]);
    expect(damageVector(run.state, "p1")).toEqual([0, 0, 60]);
  });
});

describe("D507 §8 — the FOUR-ZONE sibling is REFUSED, and the condition that reverses it is named", () => {
  const FOUR_ZONE_PROGRAM: readonly EffectOp[] = [
    {
      op: "conditionGate",
      cond: { kind: "opponentActiveDamaged" },
      then: [{ op: "damageDefender", amount: 50 }],
    },
    { op: "spreadDamage", target: "yourBench", amount: 50, damagedOnly: true },
    { op: "spreadDamage", target: "opponentBench", amount: 50, damagedOnly: true },
  ];

  it("it IS a corpus row, it is now BUILT (D520), and neither splitter reaches it", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(FOUR_ZONE)).toBe(1);
    expect(resolvedByAnyReader(FOUR_ZONE)).toBe(true);
    expect(deriveAttackEffect(FOUR_ZONE)).toEqual(FOUR_ZONE_PROGRAM);
    expect(splitAttackGateClause(FOUR_ZONE)).toBeNull();
    expect(splitAttackTrailingClause(FOUR_ZONE)).toBeNull();
  });

  it("the ZONE is the difference, and it is ONE printed token — `each Pokémon`, not `each Benched Pokémon`", () => {
    const benched = FOUR_ZONE.replace("to each Pokémon", "to each Benched Pokémon")
      .replace(", except for this Pokémon", "")
      .replace("This attack does", "This attack also does");
    expect(deriveAttackEffect(benched)).toEqual(program(50, true));
    expect(deriveAttackEffect(FOUR_ZONE)).toEqual(FOUR_ZONE_PROGRAM);
    expect(deriveAttackEffect(FOUR_ZONE)).not.toEqual(deriveAttackEffect(benched));
    expect(
      deriveAttackEffect(benched.replace("to each Benched Pokémon", "to each Pokémon")),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        benched.replace(
          " (both yours and your opponent's).",
          " (both yours and your opponent's), except for this Pokémon.",
        ),
      ),
    ).toBeNull();
  });
});

describe("D507 §9 — the residue, the surface, the version, and what stands still", () => {
  it("the RAW reader-only residue fell by exactly 2 sentences / 2 printings, and both rows left it", () => {
    const unbuilt = legalAttackCorpus().filter(([, s]) => !resolvedByAnyReader(s));
    expect([unbuilt.length, units(unbuilt)]).toEqual([40, 69]);
    expect(unbuilt.map(([, s]) => s)).not.toContain(PRINTED_BOTH);
    expect(unbuilt.map(([, s]) => s)).not.toContain(PRINTED_DAMAGED);
    expect(unbuilt.map(([, s]) => s)).not.toContain(FOUR_ZONE);
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect([rows.get(PRINTED_BOTH), rows.get(PRINTED_DAMAGED)]).toEqual([1, 1]);
  });

  it("the reader surface is still THIRTEEN, derived from the module", () => {
    expect(attackReaderSurface()).toHaveLength(14);
    expect(attackReaderSurface()).toContain("deriveAttackEffect");
  });

  it("NEITHER SPLITTER claims either print — the reader arm is the only claimant", () => {
    for (const text of [PRINTED_BOTH, PRINTED_DAMAGED]) {
      expect(splitAttackGateClause(text)).toBeNull();
      expect(splitAttackTrailingClause(text)).toBeNull();
    }
  });

  it("engineVersion and `manifest.version` agree, and the bump is owed for BEHAVIOUR", () => {
    expect(engineVersion).toBe(manifest.version);
  });

  it("what this slice does NOT move, stated as zeroes (D496)", () => {
    expect(Object.keys(BOTH_BENCH_CARDS).every((id) => FIXTURE_POOL[id] === undefined)).toBe(true);
    for (const text of [PRINTED_BOTH, PRINTED_DAMAGED]) {
      const ops = deriveAttackEffect(text) as EffectOp[];
      expect(ops.map((o) => o.op)).toEqual(["spreadDamage", "spreadDamage"]);
      expect(ops.map((o) => (o.op === "spreadDamage" ? o.target : ""))).toEqual([
        "yourBench",
        "opponentBench",
      ]);
    }
  });
});
