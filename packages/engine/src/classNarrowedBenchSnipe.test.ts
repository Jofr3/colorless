import type { Card } from "@colorless/schema";
import manifest from "../package.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, deriveAttackOptionalCostBoost } from "./effects";
import { engineVersion } from "./index";
import type { GameEvent, GameState, PokemonRef, Seat } from "./index";
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
  setDamage,
  driveSetup,
  mustDerive,
} from "./testFixtures";

const CLASS_SEED = 483_0483;

const EX_OR_V_60 =
  "This attack does 60 damage to 1 of your opponent's Benched Pokémon ex or Benched Pokémon V. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const EX_THEN_210 =
  "Discard all Energy from this Pokémon, and this attack does 210 damage to 1 of your opponent's Benched Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const PLAIN_60 =
  "This attack does 40 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const SPREAD_EX_60 =
  "This attack does 60 damage to each of your opponent's Pokémon ex. This attack's damage isn't affected by Weakness or Resistance.";
const SPREAD_EX_V_100 =
  "This attack does 100 damage to each of your opponent's Pokémon ex and Pokémon V. This attack's damage isn't affected by Weakness or Resistance.";

const HIT_EX_OR_V = 0;
const HIT_EX_AFTER_PURGE = 1;
const HIT_ANY_BENCH = 2;
const NO_EFFECT_AT_ALL = 3;

const CLASS_CARDS: Record<string, Card> = {
  "d483-sniper": battler("d483-sniper", {
    name: "D483 Sniper",
    types: ["Colorless"],
    hp: 320,
    retreat: 1,
    attacks: [
      // No printed `damage` on the three snipes: none of these sentences carries an
      // "also", so the snipe IS the attack.
      { cost: ["Colorless"], name: "Rule Break", effect: EX_OR_V_60 },
      { cost: ["Colorless"], name: "Purge Lance", effect: EX_THEN_210 },
      { cost: ["Colorless"], name: "Wide Lance", effect: PLAIN_60 },
      // No effect text at all: the control that separates "the program ran and found
      // nothing" from "no program ran" on the ZERO-MATCH board of §6.
      { cost: ["Colorless"], name: "Plain Cuff", damage: 30 },
    ],
  }),
  "d483-wall": battler("d483-wall", { name: "D483 Wall", types: ["Colorless"], hp: 340 }),
  /** Bench 0 — an `ex`, and the ONLY body carrying a Weakness. §5 reads 60 off it and
      not 120, which is §8.5 (no Weakness on the Bench) driven rather than assumed. */
  "d483-foe-ex": battler("d483-foe-ex", {
    name: "D483 Foe ex",
    types: ["Colorless"],
    hp: 330,
    weaknesses: [{ type: "Colorless", value: "×2" }],
  }),
  /** Bench 1 — a `V`. The body that separates the printed pair from the printed
      singleton, and the body a dropped filter lands on. */
  "d483-foe-v": battler("d483-foe-v", { name: "D483 Foe V", types: ["Colorless"], hp: 320 }),
  /** Bench 2 — no rule box at all. */
  "d483-foe": battler("d483-foe", { name: "D483 Foe", types: ["Colorless"], hp: 310 }),
  /** Bench 3 — the SECOND `ex`, so the narrowed set is 2 and the pick is a real
      decision rather than the no-choice auto-take. */
  "d483-other-ex": battler("d483-other-ex", {
    name: "D483 Other ex",
    types: ["Colorless"],
    hp: 300,
  }),
};

const CLASS_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...CLASS_CARDS };

const CLASS_DECK = deckOf({
  "d483-sniper": 8,
  "d483-wall": 8,
  "d483-foe-ex": 8,
  "d483-foe-v": 8,
  "d483-foe": 6,
  "d483-other-ex": 6,
  "fix-energy": 8,
  "fix-water-energy": 8,
});

function openClassTable(first: Seat): GameState {
  return driveSetup(CLASS_SEED, { p1: CLASS_DECK, p2: CLASS_DECK }, { pool: CLASS_POOL, first });
}

/** p1 owns TURN 2 with the Sniper Active. BOTH benches are cleared before anything is
    placed — every figure below is a population over a bench, so a body the setup shuffle
    happened to place would move an answer silently. */
function classTable(oppBench: readonly string[]): GameState {
  let table = openClassTable("p2");
  table = mustApply(table, { type: "endTurn", seat: "p2" }).state;
  expect(table.turn).toBe(2);
  table = setActiveFromDeck(table, "p1", "d483-sniper");
  table = setActiveFromDeck(table, "p2", "d483-wall");
  table = clearBench(table, "p1");
  table = clearBench(table, "p2");
  // TWO Energy on the attacker, so §6's "the cost was paid anyway" reading is a
  // population that moves from 2 to 0 rather than a boolean.
  table = attachFromDeck(table, "p1", "fix-energy", 1);
  table = attachFromDeck(table, "p1", "fix-water-energy", 1);
  for (const card of oppBench) table = benchFromDeck(table, "p2", card);
  return table;
}

/** The §5 board: a damaged defender and FOUR benched bodies — `ex, V, plain, ex` — at
    four different HP with four different starting damages. */
const MIXED_BENCH = ["d483-foe-ex", "d483-foe-v", "d483-foe", "d483-other-ex"] as const;

function loadBearingBoard(): GameState {
  let table = classTable(MIXED_BENCH);
  table = setDamage(table, "p2", 40);
  table = setBenchDamage(table, "p2", 0, 10);
  table = setBenchDamage(table, "p2", 1, 20);
  table = setBenchDamage(table, "p2", 2, 30);
  table = setBenchDamage(table, "p2", 3, 40);
  return table;
}

function swing(state: GameState, index: number) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

function benchDamages(state: GameState, seat: Seat): number[] {
  return state.players[seat].bench.map((pokemon) => pokemon.damage);
}

function activeDamage(state: GameState, seat: Seat): number {
  return state.players[seat].active?.damage ?? 0;
}

function eventTypes(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}

function snipePrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  const prompt = state.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti") {
    throw new Error(`expected choosePokemonMulti, got ${prompt.kind}`);
  }
  return prompt;
}

/** Answers the snipe park with the candidate at `pick`. */
function answerSnipe(state: GameState, pick: number) {
  const prompt = snipePrompt(state);
  const chosen = prompt.candidates[pick];
  if (chosen === undefined) throw new Error(`no candidate ${pick}`);
  return {
    prompt,
    ...mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [chosen as PokemonRef] },
    }),
  };
}

/** The bench indices a prompt is offering, which is the whole discrimination of §5. */
function offeredBench(candidates: readonly PokemonRef[]): number[] {
  return candidates.map((ref) => {
    if (ref.seat !== "p2" || ref.spot.spot !== "bench")
      throw new Error("not an opponent bench ref");
    return ref.spot.index;
  });
}

const corpusRows = () => legalAttackCorpus();
const units = (rows: readonly (readonly [number, string])[]) =>
  rows.reduce((n, [count]) => n + count, 0);

describe("§1 — the printed `ex`/`V` class over the whole column, and what blocks each row", () => {
  it("the PATTERN, run over all 640 rows: 20 sentences / 30 printings name the class", () => {
    const CLASS = /Pokémon (ex|V|VMAX|VSTAR|V-UNION)\b/;
    const named = corpusRows().filter(([, s]) => CLASS.test(s));
    expect(named).toHaveLength(20);
    expect(units(named)).toBe(30);
    const built = named.filter(([, s]) => resolvedByAnyReader(s));
    expect(built).toHaveLength(20);
    expect(units(built)).toBe(30);
  });

  it("the RESIDUE half of that pattern, and the brief's four-row cluster is 4 of 6", () => {
    const CLASS = /Pokémon (ex|V|VMAX|VSTAR|V-UNION)\b/;
    const residue = corpusRows().filter(([, s]) => CLASS.test(s) && !resolvedByAnyReader(s));
    expect(residue).toHaveLength(0);
    expect(units(residue)).toBe(0);
    expect(residue.map(([, s]) => s)).not.toContain(EX_OR_V_60);
    expect(residue.map(([, s]) => s)).not.toContain(EX_THEN_210);
  });

  it("both printed rows are real corpus rows at their measured printing counts", () => {
    const rows = new Map(corpusRows().map(([n, s]) => [s, n]));
    expect(corpusRows()).toHaveLength(640);
    expect(units(corpusRows())).toBe(1732);
    expect(rows.get(EX_OR_V_60)).toBe(1);
    expect(rows.get(EX_THEN_210)).toBe(1);
    expect(rows.get(PLAIN_60)).toBe(1);
    expect(rows.get(SPREAD_EX_60)).toBe(2);
    expect(rows.get(SPREAD_EX_V_100)).toBe(2);
  });

  it("THE SPLIT: the snipes have ONE blocker and the spreads have TWO (D458's disproof)", () => {
    expect(resolvedByAnyReader(EX_OR_V_60.replace(" ex or Benched Pokémon V", ""))).toBe(true);
    expect(
      resolvedByAnyReader(EX_THEN_210.replace("Benched Pokémon ex.", "Benched Pokémon.")),
    ).toBe(true);
    expect(resolvedByAnyReader(SPREAD_EX_60.replace(" ex", ""))).toBe(false);
    expect(
      resolvedByAnyReader(
        SPREAD_EX_60.replace(" This attack's damage isn't affected by Weakness or Resistance.", ""),
      ),
    ).toBe(false);
    expect(resolvedByAnyReader(SPREAD_EX_V_100.replace(" ex and Pokémon V", ""))).toBe(false);
    expect(
      resolvedByAnyReader(
        "This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toBe(true);
  });

  it("the SPREADS' composition candidate exists, is spellable TODAY, and is refused", () => {
    const narrowed = mustDerive(deriveAttackEffect, EX_THEN_210);
    const snipe = narrowed[1];
    if (snipe?.op !== "damageChosen") throw new Error("expected a damageChosen");
    expect(snipe.filter).toEqual({ kind: "suffixPokemon", suffix: "ex" });
    for (const [text, amount] of [
      [SPREAD_EX_60, 60],
      [SPREAD_EX_V_100, 100],
    ] as const) {
      const spread = mustDerive(deriveAttackEffect, text);
      expect(spread, text).toHaveLength(1);
      const hit = spread[0];
      if (hit?.op !== "damageChosen") throw new Error(`expected a damageChosen for ${text}`);
      expect(hit.amount).toBe(amount);
      expect(hit.count).toBe("all");
      expect(hit.deals).toBe(true);
      expect(hit.ignoreWR).toBe(true);
      expect(hit.target).toBe("opponentAny");
    }
  });
});

describe("§2 — two programs, exactly these bytes, and each half is the bare anchor's own", () => {
  it("the two programs are exactly these bytes", () => {
    expect(deriveAttackEffect(EX_OR_V_60)).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 60,
        count: 1,
        source: "attack",
        deals: true,
        filter: {
          kind: "anyOf",
          filters: [
            { kind: "suffixPokemon", suffix: "ex" },
            { kind: "suffixPokemon", suffix: "V" },
          ],
        },
      },
    ]);
    expect(deriveAttackEffect(EX_THEN_210)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 210,
        count: 1,
        source: "attack",
        deals: true,
        filter: { kind: "suffixPokemon", suffix: "ex" },
      },
    ]);
  });

  it("D132's INVENTORY RULE: the narrowed op differs from the bare one in ONE key", () => {
    const narrowed = mustDerive(deriveAttackEffect, EX_OR_V_60)[0];
    const bare = mustDerive(deriveAttackEffect, PLAIN_60)[0];
    if (narrowed?.op !== "damageChosen" || bare?.op !== "damageChosen") {
      throw new Error("expected two damageChosen ops");
    }
    expect(narrowed.target).toBe(bare.target);
    expect(narrowed.count).toBe(bare.count);
    expect(narrowed.source).toBe(bare.source);
    expect(narrowed.deals).toBe(bare.deals);
    expect(narrowed.damagedOnly).toBeUndefined();
    expect(bare.filter).toBeUndefined();
    expect(narrowed.filter).not.toBeUndefined();
  });

  it("the compound's COST half is byte-identical to the bare discard anchor's output", () => {
    const compound = mustDerive(deriveAttackEffect, EX_THEN_210);
    expect(compound[0]).toEqual(
      mustDerive(deriveAttackEffect, "Discard all Energy from this Pokémon.")[0],
    );
  });

  it("the two printed nouns map to filters `matchesFilter` already understood (D446)", () => {
    const pair = mustDerive(deriveAttackEffect, EX_OR_V_60)[0];
    if (pair?.op !== "damageChosen" || pair.filter?.kind !== "anyOf") {
      throw new Error("expected an anyOf filter");
    }
    expect(pair.filter.filters).toHaveLength(2);
    // …and the ORDER is the printed order, `ex` then `V`, which is what the caption
    // renders in §4.
    expect(
      pair.filter.filters.map((f) => (f.kind === "suffixPokemon" ? f.suffix : f.kind)),
    ).toEqual(["ex", "V"]);
  });
});

describe("§3 — the class group is a MAP, and the two wider forms are measured and refused", () => {
  /** The shared fragment's class group, re-spelled here rather than exported (the module
      keeps its anchors private), in the three candidate shapes. Group `[4]` of
      `ALSO_BENCHED_SNIPE_BODY`, between the noun and the damaged-body window. */
  const shape = (cls: string) =>
    new RegExp(
      `^This attack (?:also )?does (\\d+) damage to (\\d+) of (your opponent's|your) Benched Pokémon${cls}( that has any damage counters on it)?\\.(?: \\(Don't apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
    );
  const MAPPED = shape("(?: (ex or Benched Pokémon V|ex))?");
  const WHOLE_SUFFIX_VOCABULARY = shape(
    "(?: (?:ex|V|VMAX|VSTAR)(?: or Benched Pokémon (?:ex|V|VMAX|VSTAR))?)?",
  );
  const SATURATING = shape("(?: [^.]+)?");

  it("the WIDER capture claims EXACTLY the same rows, so it is pure RISK and is refused", () => {
    const mapped = corpusRows().filter(([, s]) => MAPPED.test(s));
    const wide = corpusRows().filter(([, s]) => WHOLE_SUFFIX_VOCABULARY.test(s));
    expect(mapped.map(([, s]) => s).sort()).toEqual(wide.map(([, s]) => s).sort());
    expect(units(mapped)).toBe(units(wide));
    const bare = corpusRows().filter(([, s]) => shape("").test(s));
    expect(mapped.length - bare.length).toBe(1);
  });

  it("the SATURATING form is NOT merely unpaid — it is a KNOWN WRONG ANSWER", () => {
    const mapped = corpusRows().filter(([, s]) => MAPPED.test(s));
    const saturating = corpusRows().filter(([, s]) => SATURATING.test(s));
    const extra = saturating.filter(([, s]) => !mapped.some(([, m]) => m === s));
    expect(extra.map(([, s]) => s)).toEqual([
      "This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    ]);
    expect(resolvedByAnyReader(extra[0]?.[1] ?? "")).toBe(true);
    expect(deriveAttackEffect(extra[0]?.[1] ?? "")).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 20,
        count: 1,
        source: "attack",
        deals: true,
        perDamageCounterOnTarget: true,
      },
    ]);
    expect(MAPPED.test(extra[0]?.[1] ?? "")).toBe(false);
  });

  it("the observable direction is CLOSED: every key the map carries resolves", () => {
    for (const noun of ["ex", "ex or Benched Pokémon V"]) {
      const constructed = `This attack does 60 damage to 1 of your opponent's Benched Pokémon ${noun}. (Don't apply Weakness and Resistance for Benched Pokémon.)`;
      expect(deriveAttackEffect(constructed), noun).not.toBeNull();
    }
    for (const noun of ["V", "VMAX", "VSTAR", "GX", "ex or Benched Pokémon VMAX"]) {
      const constructed = `This attack does 60 damage to 1 of your opponent's Benched Pokémon ${noun}. (Don't apply Weakness and Resistance for Benched Pokémon.)`;
      expect(deriveAttackEffect(constructed), noun).toBeNull();
      expect(
        corpusRows().some(([, s]) => s === constructed),
        noun,
      ).toBe(false);
    }
  });

  it("THE ALTERNATION ORDER BUYS NOTHING, AND THE ROW THAT PROVED IT IS A SURVIVOR", () => {
    const withOrder = (nouns: readonly string[]) =>
      new RegExp(
        `^This attack (?:also )?does (\\d+) damage to (\\d+) of (your opponent's|your) Benched Pokémon(?: (${nouns.join("|")}))?( that has any damage counters on it)?\\.(?: \\(Don't apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
      );
    const longestFirst = withOrder(["ex or Benched Pokémon V", "ex"]);
    const shortestFirst = withOrder(["ex", "ex or Benched Pokémon V"]);
    const byLongest = corpusRows().filter(([, s]) => longestFirst.test(s));
    const byShortest = corpusRows().filter(([, s]) => shortestFirst.test(s));
    expect(byLongest.map(([, s]) => s)).toEqual(byShortest.map(([, s]) => s));
    expect(units(byLongest)).toBe(units(byShortest));
    expect(byShortest.map(([, s]) => s)).toContain(EX_OR_V_60);
    // …and the shipped arm still answers the `anyOf`, which is what the old rung asserted and
    // is kept because it is true and cheap — just not a statement about the ORDER.
    const pair = mustDerive(deriveAttackEffect, EX_OR_V_60);
    const snipe = pair[0];
    if (snipe?.op !== "damageChosen") throw new Error("expected a damageChosen");
    expect(snipe.filter?.kind).toBe("anyOf");
  });
});

describe("§4 — the prompt names the class, and it is `retrieveNoun`'s FIRST live suffix arm", () => {
  it("the singleton caption quotes the printed noun", () => {
    const { state: parked } = swing(loadBearingBoard(), HIT_EX_AFTER_PURGE);
    expect(snipePrompt(parked).note).toBe(
      "Choose 1 of your opponent's Benched Pokémon ex (210 damage each).",
    );
  });

  it("the PAIR caption is the `anyOf` join, and the one word it does not quote is named", () => {
    const { state: parked } = swing(loadBearingBoard(), HIT_EX_OR_V);
    expect(snipePrompt(parked).note).toBe(
      "Choose 1 of your opponent's Benched Pokémon ex or Pokémon V (60 damage each).",
    );
    expect(snipePrompt(parked).note).not.toBe(
      "Choose 1 of your opponent's Benched Pokémon ex or Benched Pokémon V (60 damage each).",
    );
  });

  it("the UN-NARROWED caption is untouched, which is what makes the two above a claim", () => {
    const { state: parked } = swing(loadBearingBoard(), HIT_ANY_BENCH);
    expect(snipePrompt(parked).note).toBe(
      "Choose 1 of your opponent's Benched Pokémon (40 damage each).",
    );
  });
});

describe("§5 — the candidate set is the class, and every wrong reading is a different set", () => {
  it("THE THREE READINGS ANSWER THREE DIFFERENT CANDIDATE LISTS ON THIS BOARD", () => {
    const board = loadBearingBoard();
    const exOnly = offeredBench(snipePrompt(swing(board, HIT_EX_AFTER_PURGE).state).candidates);
    const exOrV = offeredBench(snipePrompt(swing(board, HIT_EX_OR_V).state).candidates);
    const dropped = offeredBench(snipePrompt(swing(board, HIT_ANY_BENCH).state).candidates);
    expect(exOnly).toEqual([0, 3]);
    expect(exOrV).toEqual([0, 1, 3]);
    expect(dropped).toEqual([0, 1, 2, 3]);
    // The three are pairwise DISTINCT — the property the sections below rest on, asserted
    // rather than eyeballed.
    expect(new Set([exOnly, exOrV, dropped].map((l) => l.join(","))).size).toBe(3);
    // …and none of them offers the Active, which is the zone half of the same claim.
    for (const index of [HIT_EX_AFTER_PURGE, HIT_EX_OR_V, HIT_ANY_BENCH]) {
      const prompt = snipePrompt(swing(board, index).state);
      expect(prompt.candidates.every((ref) => ref.seat === "p2")).toBe(true);
      expect(prompt.candidates.every((ref) => ref.spot.spot === "bench")).toBe(true);
      expect(prompt.min).toBe(1);
      expect(prompt.max).toBe(1);
    }
  });

  it("the PAIR lands on the body a dropped filter could not reach", () => {
    // Candidate 2 of the `ex or V` list is bench 3; candidate 2 of the UNFILTERED list is
    // bench 2. Two different bodies, two different vectors, one printed index.
    const { state: after } = answerSnipe(swing(loadBearingBoard(), HIT_EX_OR_V).state, 2);
    expect(benchDamages(after, "p2")).toEqual([10, 20, 30, 100]);
    // …and the Active is untouched: this sentence carries no printed `damage` and no
    // `damageDefender`, so the whole attack is the snipe.
    expect(activeDamage(after, "p2")).toBe(40);
  });

  it("the SINGLETON lands on the second `ex`, which is bench 3 and not bench 1", () => {
    const { state: after } = answerSnipe(swing(loadBearingBoard(), HIT_EX_AFTER_PURGE).state, 1);
    expect(benchDamages(after, "p2")).toEqual([10, 20, 30, 250]);
    expect(benchDamages(after, "p2")).not.toEqual([10, 230, 30, 40]);
  });

  it("the un-narrowed control lands where the narrowed one cannot", () => {
    // Candidate 2 of the unfiltered list is bench 2 — the plain body, which no narrowed
    // reading offers at all. If this rung and the two above ever agree, the narrowing has
    // stopped narrowing.
    const { state: after } = answerSnipe(swing(loadBearingBoard(), HIT_ANY_BENCH).state, 2);
    expect(benchDamages(after, "p2")).toEqual([10, 20, 70, 40]);
  });

  it("the hit is FLAT on the Bench: a ×2 Weakness on bench 0 does not double it", () => {
    const { state: after, events } = answerSnipe(swing(loadBearingBoard(), HIT_EX_OR_V).state, 0);
    expect(benchDamages(after, "p2")).toEqual([70, 20, 30, 40]);
    expect(eventTypes(events)).toContain("DAMAGE_DEALT");
  });

  it("a filtered set of exactly ONE is FORCED, where the same board PARKS unfiltered", () => {
    const oneEx = classTable(["d483-foe-v", "d483-foe-ex", "d483-foe"]);
    const { state: forced } = swing(oneEx, HIT_EX_AFTER_PURGE);
    expect(forced.phase.kind).not.toBe("effect:choose");
    expect(benchDamages(forced, "p2")).toEqual([0, 210, 0]);
    const { state: parks } = swing(oneEx, HIT_ANY_BENCH);
    expect(parks.phase.kind).toBe("effect:choose");
    expect(offeredBench(snipePrompt(parks).candidates)).toEqual([0, 1, 2]);
  });
});

describe("§6 — no `ex` on the opponent's side: silent, and the silence is the FILTER's", () => {
  /** No `ex` anywhere: a `V`, a plain body, a plain body. */
  const zeroMatch = () => classTable(["d483-foe-v", "d483-foe", "d483-foe"]);

  it("the narrowed snipe finds nothing, files no prompt, and is NOT `ATTACK_EFFECT_SKIPPED`", () => {
    const { state: after, events } = swing(zeroMatch(), HIT_EX_AFTER_PURGE);
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(benchDamages(after, "p2")).toEqual([0, 0, 0]);
    expect(eventTypes(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("CONTROL A — the COST still ran, so the program ran and the snipe alone whiffed", () => {
    // The sharpest control available: this sentence's FIRST op is a cost, and it is paid
    // whether or not the second op finds a body. Two Energy on the attacker before, zero
    // after — a population that moves, not a boolean.
    const board = zeroMatch();
    expect(board.players.p1.active?.energy).toHaveLength(2);
    const { state: after, events } = swing(board, HIT_EX_AFTER_PURGE);
    expect(after.players.p1.active?.energy).toHaveLength(0);
    expect(eventTypes(events)).toContain("ENERGY_DISCARDED");
  });

  it("CONTROL B — the same board is NOT silent for the PAIR, so the `ex` key is the gate", () => {
    const { state: after } = swing(zeroMatch(), HIT_EX_OR_V);
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(benchDamages(after, "p2")).toEqual([60, 0, 0]);
  });

  it("CONTROL C — the same board is NOT silent unfiltered, so the BENCH is not empty", () => {
    const { state: parked } = swing(zeroMatch(), HIT_ANY_BENCH);
    expect(offeredBench(snipePrompt(parked).candidates)).toEqual([0, 1, 2]);
  });

  it("CONTROL D — an effect-FREE attack separates 'found nothing' from 'no program ran'", () => {
    const { state: after, events } = swing(zeroMatch(), NO_EFFECT_AT_ALL);
    expect(activeDamage(after, "p2")).toBe(30);
    expect(after.players.p1.active?.energy).toHaveLength(2);
    expect(eventTypes(events)).not.toContain("ENERGY_DISCARDED");
  });

  it("CONTROL E — an EMPTY bench is silent too, and for a different reason than the filter", () => {
    // The pre-existing zero, kept beside the new one so a build that collapsed the two
    // (narrowing at the wrong layer, or an `op.filter` read as a bench-length test) has
    // somewhere to die.
    const { state: after } = swing(classTable([]), HIT_EX_OR_V);
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(after.players.p2.bench).toHaveLength(0);
  });
});

describe("§7 — what the class group refuses, and what it must not have moved", () => {
  it("the class is the ONE axis, asserted as an INEQUALITY of programs (D449)", () => {
    for (const [narrowed, stripped] of [
      [EX_OR_V_60, EX_OR_V_60.replace(" ex or Benched Pokémon V", "")],
      [EX_THEN_210, EX_THEN_210.replace("Benched Pokémon ex.", "Benched Pokémon.")],
    ] as const) {
      const a = mustDerive(deriveAttackEffect, narrowed);
      const b = mustDerive(deriveAttackEffect, stripped);
      expect(b, stripped).not.toBeNull();
      expect(a.length, narrowed).toBe(b.length);
      expect(a, narrowed).not.toEqual(b);
      const last = b[b.length - 1];
      expect((last as { filter?: unknown }).filter, stripped).toBeUndefined();
    }
  });

  it("the class and the damaged-body window are NEVER co-printed, and the PAIR is refused", () => {
    const both =
      "This attack does 60 damage to 1 of your opponent's Benched Pokémon ex that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)";
    expect(deriveAttackEffect(both)).toBeNull();
    expect(corpusRows().some(([, s]) => s === both)).toBe(false);
    expect(
      deriveAttackEffect(
        "This attack does 60 damage to 1 of your opponent's Benched Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).not.toBeNull();
    expect(
      deriveAttackEffect(
        "This attack also does 60 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).not.toBeNull();
    // The same pair behind the self-discard head, which is the FOURTH caller and the one
    // that would drift if only the first were guarded.
    expect(
      deriveAttackEffect(
        "Discard all Energy from this Pokémon, and this attack does 210 damage to 1 of your opponent's Benched Pokémon ex that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toBeNull();
  });

  it("the CLASS noun is number-INVARIANT, unlike the window beside it", () => {
    const two =
      "This attack does 60 damage to 2 of your opponent's Benched Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)";
    const program = mustDerive(deriveAttackEffect, two);
    const snipe = program[0];
    if (snipe?.op !== "damageChosen") throw new Error("expected a damageChosen");
    expect(snipe.count).toBe(2);
    expect(corpusRows().some(([, s]) => s === two)).toBe(false);
  });

  it("the OTHER THREE callers of the shared fragment answer exactly as they did", () => {
    expect(
      deriveAttackEffect(
        "This attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 30,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
    expect(
      deriveAttackEffect(
        "If there are 3 or fewer cards in your deck, this attack also does 120 damage to 2 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "yourDeckAtMost", count: 3 },
        ops: [
          {
            op: "damageChosen",
            target: "opponentBench",
            amount: 120,
            count: 2,
            source: "attack",
            deals: true,
          },
        ],
      },
    ]);
    const gatedClass = mustDerive(
      deriveAttackEffect,
      "If there are 3 or fewer cards in your deck, this attack also does 120 damage to 1 of your opponent's Benched Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    );
    const gate = gatedClass[0];
    if (gate?.op !== "conditionGate") throw new Error("expected a conditionGate");
    const inner = gate.ops[0];
    if (inner?.op !== "damageChosen") throw new Error("expected a gated damageChosen");
    expect(inner.filter).toEqual({ kind: "suffixPokemon", suffix: "ex" });
    expect(
      deriveAttackEffect(
        "This attack also does 40 damage to 1 of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([
      {
        op: "damageChosen",
        target: "yourBench",
        amount: 40,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
  });

  it("the FOURTH caller REFUSES the class, on the reason it refuses the other two riders", () => {
    const payoff =
      "You may shuffle 3 Energy attached to this Pokémon into your deck. If you do, this attack also does 60 damage to 1 of your opponent's Benched Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)";
    expect(deriveAttackOptionalCostBoost(payoff)).toBeNull();
    expect(corpusRows().some(([, s]) => s === payoff)).toBe(false);
    const windowed =
      "You may shuffle 3 Energy attached to this Pokémon into your deck. If you do, this attack also does 60 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)";
    expect(deriveAttackOptionalCostBoost(windowed)).toBeNull();
    expect(corpusRows().some(([, s]) => s === windowed)).toBe(false);
    expect(
      deriveAttackOptionalCostBoost(
        "You may shuffle 3 Energy attached to this Pokémon into your deck. If you do, this attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      )?.payoff,
    ).toEqual({ kind: "benchSnipe", amount: 120, count: 1 });
    expect(
      corpusRows().some(
        ([, s]) =>
          s ===
          "You may shuffle 3 Energy attached to this Pokémon into your deck. If you do, this attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toBe(true);
  });

  it("a printed 0 in EITHER position still stays LOUD alongside the class", () => {
    for (const [bad, good] of [
      [
        "This attack does 0 damage to 1 of your opponent's Benched Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        "This attack does 1 damage to 1 of your opponent's Benched Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ],
      [
        "This attack does 60 damage to 0 of your opponent's Benched Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        "This attack does 60 damage to 1 of your opponent's Benched Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ],
    ] as const) {
      expect(deriveAttackEffect(bad), bad).toBeNull();
      expect(deriveAttackEffect(good), good).not.toBeNull();
    }
  });
});

describe("§8 — the persisted address, and why 29 does not move", () => {
  it("engineVersion is 0.555.0 and `manifest.version` agrees", () => {
    expect(manifest.version).toBe(engineVersion);
  });

  it("a v29 record that LOST the key resolves to the identical board", () => {
    const parked = swing(loadBearingBoard(), HIT_EX_AFTER_PURGE).state;
    const wire = JSON.parse(JSON.stringify(parked)) as {
      phase: { cont: { pendingOp: Record<string, unknown> } };
    };
    expect(wire.phase.cont.pendingOp.filter).toEqual({ kind: "suffixPokemon", suffix: "ex" });
    // The v29 record REBUILT without the key rather than with it deleted — same bytes, and
    // `noDelete` is a lint rule this file has no reason to argue with.
    const { filter: _dropped, ...withoutFilter } = wire.phase.cont.pendingOp;
    expect(Object.keys(withoutFilter)).not.toContain("filter");
    const stale = {
      ...wire,
      phase: { ...wire.phase, cont: { ...wire.phase.cont, pendingOp: withoutFilter } },
    } as unknown as GameState;
    const intact = answerSnipe(parked, 1);
    const resumed = answerSnipe(stale, 1);
    expect(benchDamages(resumed.state, "p2")).toEqual(benchDamages(intact.state, "p2"));
    expect(resumed.state.players.p2.bench.map((b) => b.damage)).toEqual([10, 20, 30, 250]);
  });
});
