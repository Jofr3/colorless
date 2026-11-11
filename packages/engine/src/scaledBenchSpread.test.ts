import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, splitAttackGateClause, splitAttackTrailingClause } from "./effects";
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
  setPrizes,
  driveSetup,
  roundTrip,
  mustDerive,
} from "./testFixtures";

const PRINTED =
  "This attack also does 10 damage to each of your opponent's Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const FLAT_OPP =
  "This attack also does 10 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const FLAT_OPP_50 =
  "This attack does 50 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const OWN_FLAT =
  "This attack also does 10 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const OWN_SCALED =
  "This attack also does 10 damage to each of your Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const CHOSEN_SCALED =
  "This attack does 60 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const SCALED_40 =
  "This attack also does 40 damage to each of your opponent's Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const program = (amount: number): readonly EffectOp[] => [
  { op: "spreadDamage", target: "opponentBench", amount, perTakenPrize: true },
];

const SEED = 11;

/** The attack indices, keyed by name so no case addresses a fold by number. */
const AT = {
  scaled: 0,
  flat: 1,
  own: 2,
  scaled40: 3,
  plain: 4,
} as const;

const BASE = 50;

const SPREAD_CARDS: Record<string, Card> = {
  "d505-drainer": battler("d505-drainer", {
    name: "D505 Drainer",
    types: ["Colorless"],
    hp: 330,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Prize Quake", effect: PRINTED, damage: BASE },
      { cost: ["Colorless"], name: "Flat Quake", effect: FLAT_OPP, damage: BASE },
      { cost: ["Colorless"], name: "Home Quake", effect: OWN_FLAT, damage: BASE },
      { cost: ["Colorless"], name: "Big Prize Quake", effect: SCALED_40, damage: BASE },
      // No effect text at all: the control that separates "the program ran and found
      // nothing to do" from "no program ran" on the ZERO-taken board of §5.
      { cost: ["Colorless"], name: "Plain Cuff", damage: BASE },
    ],
  }),
  "d505-wall": battler("d505-wall", { name: "D505 Wall", types: ["Colorless"], hp: 400 }),
  "d505-foe-a": battler("d505-foe-a", { name: "D505 Foe A", types: ["Colorless"], hp: 300 }),
  "d505-foe-b": battler("d505-foe-b", { name: "D505 Foe B", types: ["Colorless"], hp: 310 }),
  "d505-foe-c": battler("d505-foe-c", { name: "D505 Foe C", types: ["Colorless"], hp: 320 }),
  "d505-ally-a": battler("d505-ally-a", { name: "D505 Ally A", types: ["Colorless"], hp: 300 }),
  "d505-ally-b": battler("d505-ally-b", { name: "D505 Ally B", types: ["Colorless"], hp: 310 }),
};

const SPREAD_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...SPREAD_CARDS };

const SPREAD_DECK = deckOf({
  "d505-drainer": 8,
  "d505-wall": 8,
  "d505-foe-a": 8,
  "d505-foe-b": 8,
  "d505-foe-c": 8,
  "d505-ally-a": 8,
  "d505-ally-b": 8,
  "fix-energy": 4,
});

function openTable(first: Seat): GameState {
  return driveSetup(SEED, { p1: SPREAD_DECK, p2: SPREAD_DECK }, { pool: SPREAD_POOL, first });
}

function table(oppRemaining = 3, ownRemaining = 6): GameState {
  let state = openTable("p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, "p1", "d505-drainer");
  state = setActiveFromDeck(state, "p2", "d505-wall");
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  state = attachFromDeck(state, "p1", "fix-energy", 2);
  for (const id of ["d505-foe-a", "d505-foe-b", "d505-foe-c"])
    state = benchFromDeck(state, "p2", id);
  for (const id of ["d505-ally-a", "d505-ally-b"]) state = benchFromDeck(state, "p1", id);
  state = setPrizes(state, "p2", oppRemaining);
  return setPrizes(state, "p1", ownRemaining);
}

function swing(state: GameState, index: number) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

/** `[active, ...bench]` damage — the whole discrimination of §4 to §6. */
function damageVector(state: GameState, seat: Seat): number[] {
  const side = state.players[seat];
  return [side.active?.damage ?? -1, ...side.bench.map((b) => b.damage)];
}

function damageRows(events: GameEvent[]): { seat: Seat; by: Seat; base: number; dealt: number }[] {
  return events.flatMap((e) =>
    e.type === "DAMAGE_DEALT" ? [{ seat: e.seat, by: e.by, base: e.base, dealt: e.dealt }] : [],
  );
}

function units(rows: readonly (readonly [number, string])[]): number {
  return rows.reduce((sum, [n]) => sum + n, 0);
}

describe("D505 §1 — the corpus row, the apostrophe bytes, and every anchor variant", () => {
  it("the specimen IS a row of `legalAttackCorpus()`, at the printing count the corpus states", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(PRINTED)).toBe(3);
    // …and so are all four printed neighbours the rungs below lean on.
    expect(rows.get(FLAT_OPP)).toBe(1);
    expect(rows.get(FLAT_OPP_50)).toBe(3);
    expect(rows.get(OWN_FLAT)).toBe(3);
    expect(rows.has(CHOSEN_SCALED)).toBe(false);
    expect(
      legalAttackCorpus().filter(([, s]) => s.includes("Prize card your opponent has taken")),
    ).toHaveLength(5);
    expect(rows.has(OWN_SCALED)).toBe(false);
    expect(rows.has(SCALED_40)).toBe(false);
  });

  it("both apostrophes are U+0027, measured with `codePointAt` and not by eye", () => {
    const slots = [...PRINTED].flatMap((c, i) =>
      c === "'" || c === "\u2019" ? [[i, c.codePointAt(0)]] : [],
    );
    expect(slots).toEqual([
      [56, 0x27],
      [124, 0x27],
    ]);
    expect(PRINTED).not.toContain("\u2019");
    expect(PRINTED).toContain("Pok\u00e9mon");
  });

  it("the four anchor variants claim the IDENTICAL 1 sentence / 3 printings — so three of them are pure risk", () => {
    const WR = "(?: \\(Don['\u2019]t apply Weakness and Resistance for Benched Pokémon\\.\\))?";
    const WR_MANDATORY =
      " \\(Don['\u2019]t apply Weakness and Resistance for Benched Pokémon\\.\\)";
    const SCALE = " for each Prize card your opponent has taken";
    const claims = (re: RegExp) => {
      const hit = legalAttackCorpus().filter(([, s]) => re.test(s));
      return [hit.length, units(hit)];
    };
    const narrow = new RegExp(
      `^This attack (?:also )?does (\\d+) damage to each of your opponent['\u2019]s Benched Pokémon${SCALE}\\.${WR}$`,
    );
    const widePossessive = new RegExp(
      `^This attack (?:also )?does (\\d+) damage to each of (your opponent['\u2019]s|your) Benched Pokémon${SCALE}\\.${WR}$`,
    );
    const alsoMandatory = new RegExp(
      `^This attack also does (\\d+) damage to each of your opponent['\u2019]s Benched Pokémon${SCALE}\\.${WR}$`,
    );
    const wrMandatory = new RegExp(
      `^This attack (?:also )?does (\\d+) damage to each of your opponent['\u2019]s Benched Pokémon${SCALE}\\.${WR_MANDATORY}$`,
    );
    expect(claims(narrow)).toEqual([1, 3]);
    expect(claims(widePossessive)).toEqual([1, 3]);
    expect(claims(alsoMandatory)).toEqual([1, 3]);
    expect(claims(wrMandatory)).toEqual([1, 3]);
    const alsoRefused = new RegExp(
      `^This attack does (\\d+) damage to each of your opponent['\u2019]s Benched Pokémon${SCALE}\\.${WR}$`,
    );
    expect(claims(alsoRefused)).toEqual([0, 0]);
    const scaleOptional = new RegExp(
      `^This attack (?:also )?does (\\d+) damage to each of your opponent['\u2019]s Benched Pokémon(?:${SCALE})?\\.${WR}$`,
    );
    expect(claims(scaleOptional)).toEqual([3, 7]);
  });

  it("AUTHORS nothing — the three legal printings are read off the TEXT, not from a registry row", () => {
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(deriveAttackEffect(PRINTED)).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE READER: ONE RIDER, AND THE FOUR NEIGHBOURS THAT MUST NOT GAIN IT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D505 §2 — the rider is read, and every neighbour is read WITHOUT it", () => {
  it("the print derives to ONE `spreadDamage` carrying `perTakenPrize`, spelled whole", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(program(10));
    // The amount is a CAPTURE and not a literal 10 — the probe amount is the witness.
    expect(deriveAttackEffect(SCALED_40)).toEqual(program(40));
  });

  it("…and the FLAT siblings are UNMOVED — the control without which the rung above is a tautology", () => {
    expect(deriveAttackEffect(FLAT_OPP)).toEqual([
      { op: "spreadDamage", target: "opponentBench", amount: 10 },
    ]);
    expect(deriveAttackEffect(FLAT_OPP_50)).toEqual([
      { op: "spreadDamage", target: "opponentBench", amount: 50 },
    ]);
    expect(deriveAttackEffect(OWN_FLAT)).toEqual([
      { op: "spreadDamage", target: "yourBench", amount: 10 },
    ]);
    for (const flat of [FLAT_OPP, FLAT_OPP_50, OWN_FLAT]) {
      const ops = mustDerive(deriveAttackEffect, flat);
      expect(Object.hasOwn(ops[0] ?? {}, "perTakenPrize")).toBe(false);
    }
  });

  it("the OWN-SIDE scaled spelling is REFUSED, and that is this anchor's spelled possessive", () => {
    expect(deriveAttackEffect(OWN_SCALED)).toBeNull();
    expect(deriveAttackEffect(PRINTED)).not.toBeNull();
  });

  it("the `1 of` cell of the 2×2 still derives to the OTHER op — the quantifier is the only difference", () => {
    // The two scaled cells share a rider NAME and nothing else: `damageChosen` PARKS and
    // asks for a target; `spreadDamage` asks nothing and hits every benched body. A build
    // that routed one sentence to the other op is caught here and nowhere else.
    expect(deriveAttackEffect(CHOSEN_SCALED)).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 60,
        count: 1,
        source: "attack",
        deals: true,
        perTakenPrize: true,
      },
    ]);
  });

  it("refuses the near-misses — and ADMITS one on the same axis beside each (D424)", () => {
    const pairs: readonly (readonly [string, string])[] = [
      // the quantifier: a word neither anchor spells
      ["`all of` (a quantifier neither anchor is keyed on)", PRINTED.replace("each of", "all of")],
      // the scaling NOUN: the sibling rider's source, which this anchor does not admit
      [
        "the ENERGY scale (`perEnergyOnSelf`'s clause)",
        PRINTED.replace(
          "for each Prize card your opponent has taken",
          "for each Energy attached to this Pokémon",
        ),
      ],
      // the lookalike é falls off the path silently, which is the family's standing reason
      ["a lookalike `Pokemon`", PRINTED.replace(/Pokémon/g, "Pokemon")],
      // no leading `This attack`: a mid-sentence clause must not reach this path
      ["a mid-sentence clause", `Flip a coin. ${PRINTED}`],
      // the lower-case leading word: this family carries no `/i`
      ["a lower-case leading `this`", PRINTED.replace("This attack", "this attack")],
      // a missing terminator, and TRAILING text past the `$`
      ["no sentence terminator", PRINTED.replace(". (Don't", " (Don't")],
      ["trailing text past the `$`", `${PRINTED} Draw a card.`],
    ];
    for (const [why, refused] of pairs) {
      expect(deriveAttackEffect(refused), `REFUSED: ${why}`).toBeNull();
      expect(deriveAttackEffect(PRINTED), `ADMITTED beside ${why}`).not.toBeNull();
    }
  });
});

const AXES = {
  scale: [" for each Prize card your opponent has taken", ""],
  seat: ["your opponent's", "your"],
  amount: ["10", "30"],
  wr: [" (Don't apply Weakness and Resistance for Benched Pokémon.)", ""],
  also: ["also ", ""],
} as const;

type Bit = 0 | 1;
const BITS: readonly Bit[] = [0, 1];

function latticePoint(a: Bit, s: Bit, n: Bit, w: Bit, o: Bit): string {
  return `This attack ${AXES.also[o]}does ${AXES.amount[n]} damage to each of ${AXES.seat[s]} Benched Pokémon${AXES.scale[a]}.${AXES.wr[w]}`;
}

function buildsHere(text: string): boolean {
  if (resolvedByAnyReader(text)) return true;
  const gate = splitAttackGateClause(text);
  if (gate !== null && (gate.body === "" || resolvedByAnyReader(gate.body))) return true;
  return splitAttackTrailingClause(text) !== null;
}

function claimedByTheNewArm(text: string): boolean {
  return (deriveAttackEffect(text) ?? []).some(
    (op) => op.op === "spreadDamage" && op.perTakenPrize === true,
  );
}

function vector(pred: (t: string) => boolean): { built: number[]; total: number[] } {
  const built = [0, 0, 0, 0, 0, 0];
  const total = [0, 0, 0, 0, 0, 0];
  for (const a of BITS)
    for (const s of BITS)
      for (const n of BITS)
        for (const w of BITS)
          for (const o of BITS) {
            const point = latticePoint(a, s, n, w, o);
            const weight = a + s + n + w + o;
            total[weight] = (total[weight] ?? 0) + 1;
            if (pred(point) && !claimedByTheNewArm(point)) built[weight] = (built[weight] ?? 0) + 1;
          }
  return { built, total };
}

function builtBefore(point: string): boolean {
  return buildsHere(point) && !claimedByTheNewArm(point);
}

describe("D505 §3 — the 2⁵ axis-substitution lattice, over BOTH predicates", () => {
  it("the print is weight 0 and every one of the 32 points is a DISTINCT string", () => {
    expect(latticePoint(0, 0, 0, 0, 0)).toBe(PRINTED);
    const points = new Set(
      BITS.flatMap((a) =>
        BITS.flatMap((s) =>
          BITS.flatMap((n) => BITS.flatMap((w) => BITS.map((o) => latticePoint(a, s, n, w, o)))),
        ),
      ),
    );
    expect(points.size).toBe(32);
    for (const axis of Object.values(AXES)) expect(axis[0]).not.toBe(axis[1]);
  });

  it("READERS-ONLY reads `0/1 · 1/5 · 4/10 · 6/10 · 4/5 · 1/1`", () => {
    const { built, total } = vector(resolvedByAnyReader);
    expect(total).toEqual([1, 5, 10, 10, 5, 1]);
    expect(built).toEqual([0, 1, 4, 6, 4, 1]);
    // Exactly half the lattice builds, which is the arithmetic signature of one blocking
    // axis on an otherwise free 2⁴ — see the rung two down.
    expect(built.reduce((x, y) => x + y)).toBe(16);
  });

  it("SPLITTER-INCLUSIVE reads the SAME vector, and the splitters are null at 32 of 32", () => {
    const { built, total } = vector(buildsHere);
    expect(total).toEqual([1, 5, 10, 10, 5, 1]);
    expect(built).toEqual([0, 1, 4, 6, 4, 1]);
    let divergent = 0;
    let bothNull = 0;
    for (const a of BITS)
      for (const s of BITS)
        for (const n of BITS)
          for (const w of BITS)
            for (const o of BITS) {
              const point = latticePoint(a, s, n, w, o);
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

  it("THE FACTORISATION: A1 flips the verdict at 16/16 cells and the other four at 0/16 each", () => {
    const names = ["scale", "seat", "amount", "wr", "also"] as const;
    const flips: Record<string, [number, number]> = {};
    for (let axis = 0; axis < 5; axis++) {
      let moved = 0;
      let cells = 0;
      for (const a of BITS)
        for (const s of BITS)
          for (const n of BITS)
            for (const w of BITS)
              for (const o of BITS) {
                const bits: Bit[] = [a, s, n, w, o];
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
      scale: [16, 16],
      seat: [0, 16],
      amount: [0, 16],
      wr: [0, 16],
      also: [0, 16],
    });
    // …and the two SEPARATING BOARDS, spelled out so the factorisation is readable from
    // the strings and not only from the counts: A1 printed ⇒ refused at full substitution
    // of the other four; A1 substituted ⇒ built at ZERO substitution of the other four.
    expect(builtBefore(latticePoint(0, 1, 1, 1, 1))).toBe(false);
    expect(builtBefore(latticePoint(1, 0, 0, 0, 0))).toBe(true);
    const claimed = new Set<string>();
    for (const a of BITS)
      for (const s of BITS)
        for (const n of BITS)
          for (const w of BITS)
            for (const o of BITS) {
              const point = latticePoint(a, s, n, w, o);
              if (claimedByTheNewArm(point)) claimed.add(point);
            }
    const expected = new Set<string>();
    for (const n of BITS)
      for (const w of BITS) for (const o of BITS) expected.add(latticePoint(0, 0, n, w, o));
    expect(claimed.size).toBe(8);
    expect([...claimed].sort()).toEqual([...expected].sort());
    expect(claimed.has(PRINTED)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE BOARD: THE SPREAD SCALES, THE BASE STILL LANDS, THE OWN BENCH DOES NOT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D505 §4 — three taken Prizes, three benched bodies, one printed base", () => {
  it("each of the three benched bodies takes `10 × 3`, and the Active takes the printed base", () => {
    const { state: done, events } = swing(table(3), AT.scaled);
    expect(damageVector(done, "p2")).toEqual([BASE, 30, 30, 30]);
    expect(damageVector(done, "p2")).not.toEqual([BASE, 10, 10, 10]);
    // FOUR rows, the Active's first (§8.5 resolves the Active Spot before anything
    // splashes), each naming the DAMAGED body's owner and the ATTACKER as the dealer.
    expect(damageRows(events)).toEqual([
      { seat: "p2", by: "p1", base: BASE, dealt: BASE },
      { seat: "p2", by: "p1", base: 30, dealt: 30 },
      { seat: "p2", by: "p1", base: 30, dealt: 30 },
      { seat: "p2", by: "p1", base: 30, dealt: 30 },
    ]);
  });

  it("the ATTACKER's own Bench takes NOTHING — the seat rung, which needs both benches fielded", () => {
    const { state: done } = swing(table(3), AT.scaled);
    expect(damageVector(done, "p1")).toEqual([0, 0, 0]);
    // …and the own-side FLAT sibling on the identical board hits the other way, which is
    // the control that stops the rung above from passing on a build that spreads nowhere.
    const { state: home } = swing(table(3), AT.own);
    expect(damageVector(home, "p1")).toEqual([0, 10, 10]);
    expect(damageVector(home, "p2")).toEqual([BASE, 0, 0, 0]);
  });

  it("the printed base STILL LANDS, which is what the word `also` buys and what D482 could not have", () => {
    const { state: plain } = swing(table(3), AT.plain);
    expect(damageVector(plain, "p2")).toEqual([BASE, 0, 0, 0]);
    const { state: scaled } = swing(table(3), AT.scaled);
    expect(damageVector(scaled, "p2")[0]).toBe(damageVector(plain, "p2")[0]);
  });

  it("the AMOUNT is the capture: the 40-probe deals `40 × 3` on the same board", () => {
    const { state: done } = swing(table(3), AT.scaled40);
    expect(damageVector(done, "p2")).toEqual([BASE, 120, 120, 120]);
  });

  it("…and the FLAT opponent-side sibling on the same board deals a flat 10 — the pair is the finding", () => {
    const { state: done } = swing(table(3), AT.flat);
    expect(damageVector(done, "p2")).toEqual([BASE, 10, 10, 10]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE ZERO-TAKEN BOARD: THE SILENT WHIFF, THROUGH A SHIPPED EARLY RETURN.
// ─────────────────────────────────────────────────────────────────────────────

describe("D505 §5 — nothing taken, nothing dealt, and no row filed", () => {
  it("an opponent who has taken NO Prizes takes no spread at all", () => {
    // The fold returns `10 × 0`, and `spreadDamage`'s own first line refuses `amount <= 0`
    // — which is why arm 6-i carries no `per >= 1` guard where the `1 of` sibling does
    // (that one would otherwise build a PROMPT over a 0-damage pick).
    const { state: done, events } = swing(table(6), AT.scaled);
    expect(damageVector(done, "p2")).toEqual([BASE, 0, 0, 0]);
    expect(damageRows(events)).toEqual([{ seat: "p2", by: "p1", base: BASE, dealt: BASE }]);
  });

  it("…and the FLAT sibling on the SAME board still deals 10 — the attribution control (D214)", () => {
    // Without this, "no benched damage" above is green on a build where `spreadDamage`
    // stopped working entirely.
    const { state: done } = swing(table(6), AT.flat);
    expect(damageVector(done, "p2")).toEqual([BASE, 10, 10, 10]);
  });

  it("one taken Prize is the ARITHMETIC COINCIDENCE board, and it is named rather than used", () => {
    const { state: scaled } = swing(table(5), AT.scaled);
    const { state: flat } = swing(table(5), AT.flat);
    expect(damageVector(scaled, "p2")).toEqual(damageVector(flat, "p2"));
    expect(damageVector(scaled, "p2")).toEqual([BASE, 10, 10, 10]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE SEAT THE FOLD READS, AND THE SEAT THE SPREAD HITS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D505 §6 — two seats, two Prize counts, and the coincidence that hides a defect", () => {
  it("the fold counts the OPPONENT's taken Prizes, on a board where the two seats differ", () => {
    const board = table(3, 1);
    expect(board.players.p1.prizes).toHaveLength(1);
    expect(board.players.p2.prizes).toHaveLength(3);
    const { state: done } = swing(board, AT.scaled);
    expect(damageVector(done, "p2")).toEqual([BASE, 30, 30, 30]);
    expect(damageVector(done, "p2")).not.toEqual([BASE, 50, 50, 50]);
  });

  it("the spread's VICTIM is the opponent's Bench, and the switch's opponent arm had no row for 80 decisions", () => {
    const { state: done } = swing(table(3, 1), AT.scaled);
    expect(damageVector(done, "p1")).toEqual([0, 0, 0]);
    expect(damageVector(done, "p2")).toEqual([BASE, 30, 30, 30]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — `MATCH_RECORD_VERSION` STAYS 30, ADDRESS FIRST AND BOTH HALVES DRIVEN.
// ─────────────────────────────────────────────────────────────────────────────

describe("D505 §7 — the record constant, argued at the address and driven over v30 bytes", () => {
  const ctx = { seat: "p1" as Seat, invokedBy: "attack" as const };

  const V30_SPREAD = {
    op: "spreadDamage",
    target: "opponentBench",
    amount: 10,
  } as unknown as EffectOp;

  it("the two ops differ in exactly ONE key, and the v30 bytes survive a JSON round trip", () => {
    const derived = mustDerive(deriveAttackEffect, PRINTED)[0];
    if (derived === undefined) throw new Error("expected a program");
    const differing = Object.keys(derived).filter(
      (k) =>
        JSON.stringify((derived as unknown as Record<string, unknown>)[k]) !==
        JSON.stringify((V30_SPREAD as unknown as Record<string, unknown>)[k]),
    );
    expect(differing).toEqual(["perTakenPrize"]);
    expect(roundTrip(V30_SPREAD)).toEqual(V30_SPREAD);
    expect(deriveAttackEffect(PRINTED)).toHaveLength(1);
  });

  it("the op NEVER PARKS — `runProgram` answers `done` on a board with three candidates", () => {
    // The `pendingOp` door closed, driven rather than argued. Three benched bodies is a
    // board on which the CHOSEN sibling one cell over genuinely parks, so this is not
    // vacuous on an empty bench.
    const state = table(3);
    const events: GameEvent[] = [];
    const run = runProgram(state, mustDerive(deriveAttackEffect, PRINTED), ctx, {}, events);
    expect(run.kind).toBe("done");
    // …and the whole attack resolves without an `effect:choose` phase either.
    expect(swing(state, AT.scaled).state.phase.kind).not.toBe("effect:choose");
  });

  it("a v30 `spreadDamage` WITHOUT the rider still means the flat spread on the same board", () => {
    // The LOSS direction. Three taken Prizes, so the two readings differ by 20 HP per
    // body and the rung cannot pass by accident.
    const state = table(3);
    const events: GameEvent[] = [];
    const run = runProgram(state, [V30_SPREAD], ctx, {}, events);
    if (run.kind !== "done") throw new Error("expected done");
    expect(damageVector(run.state, "p2")).toEqual([0, 10, 10, 10]);
  });

  it("…and the NEW bytes on the SAME board answer differently — both directions or neither (D441)", () => {
    const state = table(3);
    const events: GameEvent[] = [];
    const run = runProgram(state, mustDerive(deriveAttackEffect, PRINTED), ctx, {}, events);
    if (run.kind !== "done") throw new Error("expected done");
    expect(damageVector(run.state, "p2")).toEqual([0, 30, 30, 30]);
  });
});

describe("D505 §8 — the residue, the surface, the version, and what stands still", () => {
  it("the RAW reader-only residue fell by exactly 1 sentence / 3 printings, and this row left it", () => {
    const unbuilt = legalAttackCorpus().filter(([, s]) => !resolvedByAnyReader(s));
    expect(unbuilt.map(([, s]) => s)).not.toContain(PRINTED);
    const row = legalAttackCorpus().find(([, s]) => s === PRINTED);
    expect(row?.[0]).toBe(3);
  });

  it("NEITHER SPLITTER claims the print — the reader arm is the only claimant", () => {
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
  });

  it("what this slice does NOT move, stated as zeroes (D496)", () => {
    expect(Object.keys(SPREAD_CARDS).every((id) => FIXTURE_POOL[id] === undefined)).toBe(true);
    const ops = mustDerive(deriveAttackEffect, PRINTED);
    expect(ops.map((o) => o.op)).toEqual(["spreadDamage"]);
  });
});
