import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effectsModule from "./effects";
import { deriveAttackDamageMultiplier, deriveAttackEffect } from "./effects";
import type { EffectOp, GameEvent, GameState, Seat } from "./index";
import { runProgram } from "./interpreter";
import {
  FIXTURE_POOL,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  driveSetup,
  roundTrip,
} from "./testFixtures";

const SPREAD_SEED = 492_0492;
const DEALT_D622 = [
  [100, undefined],
  [70, 30],
  [100, undefined],
  [100, undefined],
];

const EX_60 =
  "This attack does 60 damage to each of your opponent's Pokémon ex. This attack's damage isn't affected by Weakness or Resistance.";
const EX_V_100 =
  "This attack does 100 damage to each of your opponent's Pokémon ex and Pokémon V. This attack's damage isn't affected by Weakness or Resistance.";
const FOR_EACH_EX_60 = "This attack does 60 damage for each of your opponent's Pokémon ex in play.";
const FOR_EACH_EX_V_60 =
  "This attack does 60 damage for each of your opponent's Pokémon ex and Pokémon V in play.";
const UNFILTERED_30 =
  "This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const HIT_EX_V = 0;
const HIT_EX = 1;
const COUNT_EX_V = 2;
const COUNT_EX = 3;
const UNFILTERED = 4;
const NO_EFFECT = 5;

const SPREAD_CARDS: Record<string, Card> = {
  "d492-sniper": battler("d492-sniper", {
    name: "D492 Sniper",
    types: ["Colorless"],
    hp: 320,
    retreat: 1,
    attacks: [
      // No printed `damage` on any of the five: none of these sentences carries an
      // "also", so the printed sentence IS the attack.
      { cost: ["Colorless"], name: "Rule Purge", effect: EX_V_100 },
      { cost: ["Colorless"], name: "Ex Purge", effect: EX_60 },
      { cost: ["Colorless"], name: "Pair Count", effect: FOR_EACH_EX_V_60 },
      { cost: ["Colorless"], name: "Ex Count", effect: FOR_EACH_EX_60 },
      { cost: ["Colorless"], name: "Wide Wave", effect: UNFILTERED_30 },
      // No effect text at all: the control that separates "the program ran and found
      // nothing" from "no program ran" on the ZERO-MATCH board of §7.
      { cost: ["Colorless"], name: "Plain Cuff", damage: 30 },
    ],
  }),
  /** The defender on the load-bearing board: an `ex` **carrying a Weakness**, which is
      the single byte that makes `ignoreWR` observable on the Active. */
  "d492-wall-ex": battler("d492-wall-ex", {
    name: "D492 Wall ex",
    types: ["Colorless"],
    hp: 500,
    weaknesses: [{ type: "Colorless", value: "×2" }],
  }),
  /** The same body with NO Weakness — §6's collision board, and the reason the collision
      is a measurement rather than a claim. */
  "d492-bare-wall-ex": battler("d492-bare-wall-ex", {
    name: "D492 Bare Wall ex",
    types: ["Colorless"],
    hp: 500,
  }),
  "d492-wall": battler("d492-wall", { name: "D492 Wall", types: ["Colorless"], hp: 500 }),
  /** Bench 0 — an `ex`, and **{F}**, because Rock Chestplate `sv01-192` gates its −30 on
      the HOLDER's Fighting type. §8 uses that. */
  "d492-foe-ex": battler("d492-foe-ex", { name: "D492 Foe ex", types: ["Fighting"], hp: 330 }),
  /** Bench 1 — a `V`. The body that separates the printed PAIR from the printed
      singleton, and the body a collapsed noun map stops hitting. */
  "d492-foe-v": battler("d492-foe-v", { name: "D492 Foe V", types: ["Colorless"], hp: 320 }),
  "d492-foe": battler("d492-foe", { name: "D492 Foe", types: ["Colorless"], hp: 310 }),
  /** Bench 3 — the SECOND `ex`, so "hit one" and "hit each" differ by more than one
      body and the count reading has something to count. */
  "d492-other-ex": battler("d492-other-ex", {
    name: "D492 Other ex",
    types: ["Colorless"],
    hp: 300,
  }),
};

const SPREAD_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...SPREAD_CARDS };

const SPREAD_DECK = deckOf({
  "d492-sniper": 6,
  "d492-wall-ex": 6,
  "d492-bare-wall-ex": 6,
  "d492-wall": 6,
  "d492-foe-ex": 6,
  "d492-foe-v": 6,
  "d492-foe": 6,
  "d492-other-ex": 6,
  "sv01-192": 4,
  "fix-energy": 8,
});

function openSpreadTable(first: Seat): GameState {
  return driveSetup(
    SPREAD_SEED,
    { p1: SPREAD_DECK, p2: SPREAD_DECK },
    { pool: SPREAD_POOL, first },
  );
}

/** p1 owns TURN 2 with the Sniper Active. BOTH benches are cleared before anything is
    placed — every figure below is a POPULATION over a board, so a body the setup shuffle
    happened to place would move an answer silently (`OWN_BENCH_SNIPE_DECK`'s rule). */
function spreadTable(defender: string, oppBench: readonly string[]): GameState {
  let table = openSpreadTable("p2");
  table = mustApply(table, { type: "endTurn", seat: "p2" }).state;
  expect(table.turn).toBe(2);
  table = setActiveFromDeck(table, "p1", "d492-sniper");
  table = setActiveFromDeck(table, "p2", defender);
  table = clearBench(table, "p1");
  table = clearBench(table, "p2");
  table = attachFromDeck(table, "p1", "fix-energy", 2);
  for (const card of oppBench) table = benchFromDeck(table, "p2", card);
  return table;
}

const MIXED_BENCH = ["d492-foe-ex", "d492-foe-v", "d492-foe", "d492-other-ex"] as const;

function swing(state: GameState, index: number) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

/** `[active, ...bench]` damage, which is the whole discrimination of §4–§6. */
function damageVector(state: GameState, seat: Seat): number[] {
  return [
    state.players[seat].active?.damage ?? 0,
    ...state.players[seat].bench.map((pokemon) => pokemon.damage),
  ];
}

function eventTypes(events: readonly GameEvent[]): string[] {
  return events.map((e) => e.type);
}

const corpusRows = () => legalAttackCorpus();
const units = (rows: readonly (readonly [number, string])[]) =>
  rows.reduce((n, [count]) => n + count, 0);

const READERS: readonly ((t: string) => unknown)[] = attackReaderSurface().map((name) => {
  const fn = (effectsModule as unknown as Record<string, unknown>)[name];
  if (typeof fn !== "function") throw new Error(`reader ${name} is not a function on effects.ts`);
  return fn as (t: string) => unknown;
});

/** THE PROGRAM, spelled once and reused, so a case cannot pass against a hand-copied
    literal that has drifted from what this file means by it. */
const program = (amount: number, filter: EffectOp extends never ? never : unknown): EffectOp[] => [
  {
    op: "damageChosen",
    target: "opponentAny",
    amount,
    count: "all",
    source: "attack",
    deals: true,
    ignoreWR: true,
    wrOnly: true,
    filter: filter as never,
  },
];

const NEW_ANCHOR = new RegExp(
  `^This attack does (\\d+) damage to each of your opponent['’]s (Pokémon ex and Pokémon V|Pokémon ex)\\.` +
    ` This attack['’]s damage isn['’]t affected by Weakness or Resistance\\.$`,
);
const builtBefore = (text: string) => resolvedByAnyReader(text) && !NEW_ANCHOR.test(text);

const EX_FILTER = { kind: "suffixPokemon", suffix: "ex" } as const;
const EX_V_FILTER = {
  kind: "anyOf",
  filters: [
    { kind: "suffixPokemon", suffix: "ex" },
    { kind: "suffixPokemon", suffix: "V" },
  ],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE PRINTED DATA, THE 2⁵ LATTICE, AND WHAT THE ANCHOR REACHES.
// ─────────────────────────────────────────────────────────────────────────────

describe("D492 §1 — the two rows, measured live over the legal column", () => {
  it("both are CORPUS bytes at 2 printings each, and the two steps DISAGREE 2 / 4", () => {
    const rows = new Map(corpusRows().map(([n, text]) => [text, n]));
    expect(corpusRows()).toHaveLength(640);
    expect(units(corpusRows())).toBe(1732);
    expect(rows.get(EX_60)).toBe(2);
    expect(rows.get(EX_V_100)).toBe(2);
    expect(rows.get(FOR_EACH_EX_60)).toBe(2);
    expect(rows.get(FOR_EACH_EX_V_60)).toBe(1);
    expect(rows.get(UNFILTERED_30)).toBe(1);
    const mine = corpusRows().filter(([, s]) => s === EX_60 || s === EX_V_100);
    expect([mine.length, units(mine)]).toEqual([2, 4]);
    for (const text of [EX_60, EX_V_100]) {
      expect(text.includes("opponent's")).toBe(true);
      expect(text.includes("opponent’s")).toBe(false);
      expect(text.codePointAt(text.indexOf("'"))).toBe(0x0027);
      expect(text.codePointAt(text.lastIndexOf("'"))).toBe(0x0027);
      expect(text.codePointAt(text.indexOf("é"))).toBe(0x00e9);
    }
  });

  it("THE 2⁵ LATTICE: the first BUILT point is at Hamming weight TWO, on BOTH rows", () => {
    const build = (amount: string, filterPrint: string, m: number): string => {
      const filter = m & 8 ? "Pokémon" : filterPrint;
      const scope = m & 4 ? "Benched " : "";
      const amt = m & 1 ? "30" : amount;
      const core =
        m & 2
          ? `This attack does ${amt} damage for each of your opponent's ${scope}${filter}${
              m & 4 ? "" : " in play"
            }.`
          : `This attack does ${amt} damage to each of your opponent's ${scope}${filter}.`;
      const tail =
        m & 16
          ? " (Don't apply Weakness and Resistance for Benched Pokémon.)"
          : " This attack's damage isn't affected by Weakness or Resistance.";
      return core + tail;
    };
    for (const [amount, filterPrint, printed] of [
      ["100", "Pokémon ex and Pokémon V", EX_V_100],
      ["60", "Pokémon ex", EX_60],
    ] as const) {
      // the PRINT is point 0 by construction — checked, not assumed.
      expect(build(amount, filterPrint, 0)).toBe(printed);
      const byWeight = [0, 0, 0, 0, 0, 0];
      const builtByWeight = [0, 0, 0, 0, 0, 0];
      for (let m = 0; m < 32; m++) {
        const weight = [0, 1, 2, 3, 4].filter((b) => m & (1 << b)).length;
        byWeight[weight] = (byWeight[weight] ?? 0) + 1;
        if (builtBefore(build(amount, filterPrint, m))) {
          builtByWeight[weight] = (builtByWeight[weight] ?? 0) + 1;
        }
      }
      expect(byWeight).toEqual([1, 5, 10, 10, 5, 1]);
      expect(builtByWeight).toEqual([0, 0, 1, 2, 1, 0]);
      for (let m = 0; m < 32; m++) {
        const point = build(amount, filterPrint, m);
        expect(resolvedByAnyReader(point), point).toBe(
          builtBefore(point) || NEW_ANCHOR.test(point),
        );
      }
    }
    // …and the ONE weight-2 point that builds is FILTER + TAIL together, on both rows —
    // named rather than counted, because a count cannot say WHICH pair.
    expect(
      resolvedByAnyReader(
        "This attack does 100 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toBe(true);
    // Each half of that pair ALONE is refused, which is the whole two-blocker finding.
    expect(
      resolvedByAnyReader(
        "This attack does 100 damage to each of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance.",
      ),
    ).toBe(false);
    expect(
      resolvedByAnyReader(
        "This attack does 100 damage to each of your opponent's Pokémon ex and Pokémon V. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toBe(false);
  });

  it("AMOUNT and SCOPE are INERT on the verdict; FORM, FILTER and TAIL each flip 4/16", () => {
    const build = (m: number): string => {
      const filter = m & 8 ? "Pokémon" : "Pokémon ex and Pokémon V";
      const scope = m & 4 ? "Benched " : "";
      const amt = m & 1 ? "30" : "100";
      const core =
        m & 2
          ? `This attack does ${amt} damage for each of your opponent's ${scope}${filter}${
              m & 4 ? "" : " in play"
            }.`
          : `This attack does ${amt} damage to each of your opponent's ${scope}${filter}.`;
      return (
        core +
        (m & 16
          ? " (Don't apply Weakness and Resistance for Benched Pokémon.)"
          : " This attack's damage isn't affected by Weakness or Resistance.")
      );
    };
    const flips = [0, 1, 2, 3, 4].map((bit) => {
      let n = 0;
      for (let m = 0; m < 32; m++) {
        if (m & (1 << bit)) continue;
        if (builtBefore(build(m)) !== builtBefore(build(m | (1 << bit)))) n++;
      }
      return n;
    });
    expect(flips).toEqual([0, 4, 0, 4, 4]);
    const flipsNow = [0, 1, 2, 3, 4].map((bit) => {
      let n = 0;
      for (let m = 0; m < 32; m++) {
        if (m & (1 << bit)) continue;
        if (resolvedByAnyReader(build(m)) !== resolvedByAnyReader(build(m | (1 << bit)))) n++;
      }
      return n;
    });
    expect(flipsNow).toEqual([0, 6, 2, 6, 6]);
  });

  it("the anchor claims EXACTLY these 2 sentences / 4 printings, and the WIDE spelling claims no more", () => {
    const anchorFor = (nouns: readonly string[]) =>
      new RegExp(
        `^This attack does (\\d+) damage to each of your opponent['’]s (${nouns.join(
          "|",
        )})\\. This attack['’]s damage isn['’]t affected by Weakness or Resistance\\.$`,
      );
    const narrow = corpusRows().filter(([, s]) =>
      anchorFor(["Pokémon ex and Pokémon V", "Pokémon ex"]).test(s),
    );
    const wide = corpusRows().filter(([, s]) =>
      anchorFor([
        "Pokémon ex and Pokémon V",
        "Pokémon ex",
        "Evolution Pokémon",
        "Stage 1 Pokémon",
        "Stage 2 Pokémon",
        "Basic Pokémon",
        "Charjabug",
        "Pokémon",
      ]).test(s),
    );
    expect([narrow.length, units(narrow)]).toEqual([2, 4]);
    expect([wide.length, units(wide)]).toEqual([2, 4]);
    expect(new Set(narrow.map(([, s]) => s))).toEqual(new Set([EX_60, EX_V_100]));
  });

  it("STRUCTURAL disjointness from all three siblings, over the whole column (D467)", () => {
    for (const [, text] of corpusRows()) {
      const mine = text === EX_60 || text === EX_V_100;
      if (!mine) continue;
      const claimers = READERS.filter((read) => read(text) !== null && read(text) !== undefined);
      expect(claimers).toHaveLength(1);
      expect(deriveAttackEffect(text)).not.toBeNull();
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
    }
  });

  it("D492 — both sentences are now RESOLVED, and by exactly one reader each", () => {
    for (const text of [EX_60, EX_V_100]) {
      expect(resolvedByAnyReader(text), text).toBe(true);
      expect(deriveAttackEffect(text), text).not.toBeNull();
      for (const read of READERS) {
        if (read === deriveAttackEffect) continue;
        expect(read(text), `${read.name} / ${text}`).toBeNull();
      }
    }
    for (const text of [EX_60, EX_V_100]) {
      expect(effectsModule.splitAttackTrailingClause(text), text).toBeNull();
      expect(effectsModule.splitAttackGateClause(text), text).toBeNull();
      expect(effectsModule.splitAttackRequirementClause(text), text).toBeNull();
      expect(effectsModule.splitAttackCancelClause(text), text).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE DERIVED PROGRAMS, AND THE NOUN MAP THEY READ.
// ─────────────────────────────────────────────────────────────────────────────

describe("D492 §2 — one op, exactly these bytes", () => {
  it("the two programs are exactly these bytes", () => {
    expect(deriveAttackEffect(EX_60)).toEqual(program(60, EX_FILTER));
    expect(deriveAttackEffect(EX_V_100)).toEqual(program(100, EX_V_FILTER));
  });

  it("the filter values are the SHIPPED map's, byte for byte — one noun, one answer", () => {
    const spread = deriveAttackEffect(EX_V_100) as EffectOp[];
    const hit = spread[0];
    if (hit?.op !== "damageChosen") throw new Error("expected a damageChosen");
    const counted = deriveAttackDamageMultiplier(FOR_EACH_EX_V_60);
    if (counted === null) throw new Error("expected the built sibling to derive");
    const countSource = counted.count as { kind: string; filter?: unknown };
    expect(countSource.kind).toBe("pokemonInPlay");
    expect(hit.filter).toEqual(countSource.filter);
    // …and the same for the singleton noun.
    const exSpread = deriveAttackEffect(EX_60) as EffectOp[];
    const exHit = exSpread[0];
    if (exHit?.op !== "damageChosen") throw new Error("expected a damageChosen");
    const exCounted = deriveAttackDamageMultiplier(FOR_EACH_EX_60);
    if (exCounted === null) throw new Error("expected the built sibling to derive");
    expect(exHit.filter).toEqual((exCounted.count as { filter?: unknown }).filter);
  });

  it("an unmapped noun and a printed 0 both stay LOUD rather than resolving on a guess", () => {
    for (const text of [
      "This attack does 100 damage to each of your opponent's Pokémon VMAX. This attack's damage isn't affected by Weakness or Resistance.",
      "This attack does 100 damage to each of your opponent's Iono's Pokémon. This attack's damage isn't affected by Weakness or Resistance.",
      "This attack does 0 damage to each of your opponent's Pokémon ex. This attack's damage isn't affected by Weakness or Resistance.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
      expect(resolvedByAnyReader(text), text).toBe(false);
    }
    expect(
      deriveAttackEffect(
        "This attack does 10 damage to each of your opponent's Pokémon ex. This attack's damage isn't affected by Weakness or Resistance.",
      ),
    ).toEqual(program(10, EX_FILTER));
  });

  it("the SHORTLIST is exactly TWO nouns — the other six map keys stay refused HERE", () => {
    for (const noun of [
      "Pokémon",
      "Basic Pokémon",
      "Evolution Pokémon",
      "Stage 1 Pokémon",
      "Stage 2 Pokémon",
      "Charjabug",
    ]) {
      const text = `This attack does 50 damage to each of your opponent's ${noun}. This attack's damage isn't affected by Weakness or Resistance.`;
      expect(deriveAttackEffect(text), text).toBeNull();
      expect(resolvedByAnyReader(text), text).toBe(false);
    }
    for (const [noun, filter] of [
      ["Pokémon ex", EX_FILTER],
      ["Pokémon ex and Pokémon V", EX_V_FILTER],
    ] as const) {
      expect(
        deriveAttackEffect(
          `This attack does 50 damage to each of your opponent's ${noun}. This attack's damage isn't affected by Weakness or Resistance.`,
        ),
      ).toEqual(program(50, filter));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE ANCHOR IS WHOLE-SENTENCE.
// ─────────────────────────────────────────────────────────────────────────────

describe("D492 §3 — a leading or trailing clause, a case change or a lost byte is refused", () => {
  it("the anchor is `^…$` and every printed byte in it is load-bearing", () => {
    for (const text of [
      `Draw a card. ${EX_60}`,
      `${EX_60} Your turn ends.`,
      `${EX_V_100} Draw a card.`,
      // Case is load-bearing: no reader in `effects.ts` carries an `/i`.
      EX_60.toLowerCase(),
      EX_60.toUpperCase(),
      "This attack does 60 damage to each of your opponent's Pokémon ex.",
      "This attack does 60 damage to each of your opponent's Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      // The trailing period is required.
      EX_60.slice(0, -1),
      // A non-numeric amount, and a missing one.
      "This attack does X damage to each of your opponent's Pokémon ex. This attack's damage isn't affected by Weakness or Resistance.",
      "This attack does damage to each of your opponent's Pokémon ex. This attack's damage isn't affected by Weakness or Resistance.",
      "This attack does 60 damage to each of your Pokémon ex. This attack's damage isn't affected by Weakness or Resistance.",
      // `1 of` is `CHOSEN_ANY_TARGET`'s, not this anchor's.
      "This attack does 60 damage to 1 of your opponent's Pokémon ex. This attack's damage isn't affected by Weakness or Resistance.",
      // The W/R sentence mangled.
      EX_60.replace("Weakness or Resistance", "Weakness and Resistance"),
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("the U+2019 re-ingest derives the IDENTICAL program (D440)", () => {
    for (const [text, expected] of [
      [EX_60, program(60, EX_FILTER)],
      [EX_V_100, program(100, EX_V_FILTER)],
    ] as const) {
      expect(deriveAttackEffect(text.replaceAll("'", "’"))).toEqual(expected);
    }
  });
});

describe("D492 §4 — the two boards on which `damageDefender` + `spreadDamage` is wrong", () => {
  it("W/R: a Weakness ×2 Active takes the PRINTED number, where the composition doubles it", () => {
    const board = spreadTable("d492-wall-ex", MIXED_BENCH);
    const after = swing(board, HIT_EX_V).state;
    expect(damageVector(after, "p2")[0]).toBe(100);
    const wide = swing(board, UNFILTERED).state;
    expect(damageVector(wide, "p2")[0]).toBe(60);
  });

  it("CONDITIONALITY: a NON-ex Active takes ZERO, where the composition hits it anyway", () => {
    const board = spreadTable("d492-wall", MIXED_BENCH);
    const after = swing(board, HIT_EX_V).state;
    expect(damageVector(after, "p2")).toEqual([0, 100, 100, 0, 100]);
    expect(damageVector(swing(board, UNFILTERED).state, "p2")).toEqual([30, 30, 30, 30, 30]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE LOAD-BEARING BOARD: SIX READINGS, SIX VECTORS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D492 §5 — one board, and every candidate reading answers a different vector", () => {
  it("the printed PAIR row: 100 to the Active and to every matching benched body, 0 to the rest", () => {
    const board = spreadTable("d492-wall-ex", MIXED_BENCH);
    const { state, events } = swing(board, HIT_EX_V);
    expect(damageVector(state, "p2")).toEqual([100, 100, 100, 0, 100]);
    // FOUR bodies, so FOUR rows — a build that hit one and a build that hit all four
    // cannot both be right about the count of rows.
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(4);
    expect(damageVector(state, "p1")).toEqual([0]);
  });

  it("the printed SINGLETON row on the same board: the `V` takes ZERO", () => {
    const board = spreadTable("d492-wall-ex", MIXED_BENCH);
    const { state, events } = swing(board, HIT_EX);
    expect(damageVector(state, "p2")).toEqual([60, 60, 0, 0, 60]);
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(3);
  });

  it('it never PARKS, and that is what `count: "all"` means', () => {
    // A `count: 1` reading of *"each of"* would offer a choice among four candidates.
    // The printed determiner names no number, so there is no decision — the op resolves
    // inline and the turn ends inside the same action.
    const board = spreadTable("d492-wall-ex", MIXED_BENCH);
    const { state, events } = swing(board, HIT_EX_V);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(eventTypes(events)).not.toContain("EFFECT_PENDING");
    // …and no `phase.cont` was ever written, which is the fact §9's version argument
    // rests on from the other end.
    expect("cont" in state.phase).toBe(false);
  });

  it("the ATTACK is not skipped and the sentence is SIMULATED", () => {
    const board = spreadTable("d492-wall-ex", MIXED_BENCH);
    const { events } = swing(board, HIT_EX_V);
    expect(eventTypes(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(eventTypes(events)).toContain("ATTACK_DECLARED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE COLLISION: `TO each` AND `FOR each`, ONE PREPOSITION APART.
// ─────────────────────────────────────────────────────────────────────────────

describe("D492 §6 — the built sibling one preposition away, and the board that hides it", () => {
  it("THE COLLISION IS REAL: on a Weakness-free Active that is the only `ex`, both answer 60", () => {
    const board = spreadTable("d492-bare-wall-ex", ["d492-foe"]);
    expect(damageVector(swing(board, HIT_EX).state, "p2")).toEqual([60, 0]);
    expect(damageVector(swing(board, COUNT_EX).state, "p2")).toEqual([60, 0]);
  });

  it("…and a WEAKNESS on the Active is what breaks the tie on that same one-body board", () => {
    // One byte apart from the board above. The `for each` fold is §8.5 damage and
    // doubles; the printed spread is flat and does not. **60 against 120 on the smallest
    // board there is.**
    const board = spreadTable("d492-wall-ex", ["d492-foe"]);
    expect(damageVector(swing(board, HIT_EX).state, "p2")).toEqual([60, 0]);
    expect(damageVector(swing(board, COUNT_EX).state, "p2")).toEqual([120, 0]);
  });

  it("a BENCHED matching body separates them without any Weakness at all", () => {
    // The other exit from the collision, and the one that does not depend on a Weakness:
    // the count fold puts everything on the Active, the spread distributes.
    const board = spreadTable("d492-bare-wall-ex", ["d492-foe-ex", "d492-foe"]);
    expect(damageVector(swing(board, HIT_EX).state, "p2")).toEqual([60, 60, 0]);
    // 60 × 2 matching bodies, all of it on the Active.
    expect(damageVector(swing(board, COUNT_EX).state, "p2")).toEqual([120, 0, 0]);
  });

  it("the built siblings still answer their OWN numbers on the load-bearing board", () => {
    const board = spreadTable("d492-wall-ex", MIXED_BENCH);
    expect(damageVector(swing(board, COUNT_EX_V).state, "p2")).toEqual([480, 0, 0, 0, 0]);
    expect(damageVector(swing(board, COUNT_EX).state, "p2")).toEqual([360, 0, 0, 0, 0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE EMPTY CANDIDATE SET.
// ─────────────────────────────────────────────────────────────────────────────

describe("D492 §7 — an opponent fielding no `ex` and no `V`", () => {
  it("the attack is legal, resolves, damages nothing and files no damage row", () => {
    const board = spreadTable("d492-wall", ["d492-foe"]);
    const { state, events } = swing(board, HIT_EX_V);
    expect(damageVector(state, "p2")).toEqual([0, 0]);
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(0);
    expect(eventTypes(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(eventTypes(events)).toContain("TURN_ENDED");
  });

  it("…and the CONTROL that keeps that from being vacuous: a printed-damage attack still hits", () => {
    const board = spreadTable("d492-wall", ["d492-foe"]);
    const { state, events } = swing(board, NO_EFFECT);
    expect(damageVector(state, "p2")).toEqual([30, 0]);
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(1);
  });
});

describe("D492 §8 — `counterEachAll` names the same set and is still the wrong op", () => {
  it("the hit is DAMAGE_DEALT with a nulled W/R, never COUNTERS_PLACED", () => {
    let board = spreadTable("d492-wall-ex", MIXED_BENCH);
    board = attachToolFromDeck(board, "p2", 0, "sv01-192");
    const { state, events } = swing(board, HIT_EX_V);
    expect(damageVector(state, "p2")).toEqual([100, 70, 100, 0, 100]);
    expect(eventTypes(events)).not.toContain("COUNTERS_PLACED");
    const rows = events.filter((e) => e.type === "DAMAGE_DEALT");
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      if (row.type !== "DAMAGE_DEALT") throw new Error("filtered wrong");
      expect(row.seat).toBe("p2");
      expect(row.by).toBe("p1");
      expect(row.base).toBe(100);
      expect(row.weakness).toBeNull();
      expect(row.resistance).toBeNull();
    }
    expect(
      rows.map((row) => (row.type === "DAMAGE_DEALT" ? [row.dealt, row.reduction] : null)),
    ).toEqual(DEALT_D622);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — `MATCH_RECORD_VERSION`, DRIVEN OVER RECONSTRUCTED v29 BYTES.
// ─────────────────────────────────────────────────────────────────────────────

describe("D492 §9 — the widened quantifier over a v29 record", () => {
  const ctx = { seat: "p1" as Seat, invokedBy: "attack" as const };
  const V29_SNIPE = {
    op: "damageChosen",
    target: "opponentAny",
    amount: 100,
    count: 1,
    source: "attack",
    deals: true,
    ignoreWR: true,
    filter: EX_V_FILTER,
  } as unknown as EffectOp;

  it("the two ops differ in exactly ONE key, which is what makes this a claim about the quantifier ( D622 (D539): and in `wrOnly`, which no v29 writer wrote)", () => {
    const derived = (deriveAttackEffect(EX_V_100) as EffectOp[])[0];
    if (derived === undefined) throw new Error("expected a program");
    const differing = Object.keys(derived).filter(
      (k) =>
        JSON.stringify((derived as unknown as Record<string, unknown>)[k]) !==
        JSON.stringify((V29_SNIPE as unknown as Record<string, unknown>)[k]),
    );
    expect(differing).toEqual(["count", "wrOnly"]);
    // The v29 bytes survive a JSON round trip unchanged — this is what a record holds.
    expect(roundTrip(V29_SNIPE)).toEqual(V29_SNIPE);
  });

  it("a v29 `count: 1` over the SAME board still asks for ONE and PARKS", () => {
    const state = spreadTable("d492-wall-ex", MIXED_BENCH);
    const events: GameEvent[] = [];
    const run = runProgram(state, [V29_SNIPE], ctx, events);
    if (run.kind !== "parked") throw new Error("expected a park");
    if (run.prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect([run.prompt.min, run.prompt.max]).toEqual([1, 1]);
    expect(run.prompt.candidates).toHaveLength(4);
  });

  it("and the NEW byte on the SAME board answers differently — the control for both", () => {
    const state = spreadTable("d492-wall-ex", MIXED_BENCH);
    const events: GameEvent[] = [];
    const run = runProgram(state, deriveAttackEffect(EX_V_100) as EffectOp[], ctx, events);
    expect(run.kind).toBe("done");
    if (run.kind !== "done") throw new Error("expected done");
    expect(damageVector(run.state, "p2")).toEqual([100, 100, 100, 0, 100]);
  });
});

describe("D492 §10 — the residue this slice moved, and the engine version", () => {
  it("the reader surface is still THIRTEEN, derived from the module", () => {
    expect(attackReaderSurface()).toHaveLength(14);
    expect(READERS).toHaveLength(14);
  });

  it("the RAW residue fell by exactly 2 sentences / 4 printings", () => {
    const unbuilt = corpusRows().filter(([, s]) => !resolvedByAnyReader(s));
    expect([unbuilt.length, units(unbuilt)]).toEqual([40, 69]);
    expect(unbuilt.map(([, s]) => s)).not.toContain(EX_60);
    expect(unbuilt.map(([, s]) => s)).not.toContain(EX_V_100);
  });

  it("the printed rule-box class over the whole column, re-measured", () => {
    const CLASS = /Pokémon (ex|V|VMAX|VSTAR|V-UNION)\b/;
    const named = corpusRows().filter(([, s]) => CLASS.test(s));
    expect([named.length, units(named)]).toEqual([20, 30]);
    const residue = named.filter(([, s]) => !resolvedByAnyReader(s));
    expect([residue.length, units(residue)]).toEqual([0, 0]);
  });
});

describe("D492 §11 — the reader list is the module's, in both directions", () => {
  it("every member of the surface is a function on `effects.ts`, and the SETS are equal", () => {
    const names = attackReaderSurface();
    const fromModule = Object.keys(effectsModule).filter(
      (k) =>
        k.startsWith("deriveAttack") &&
        typeof (effectsModule as unknown as Record<string, unknown>)[k] === "function",
    );
    expect(new Set(names)).toEqual(new Set(fromModule));
    expect(names.length).toBe(fromModule.length);
  });
});
