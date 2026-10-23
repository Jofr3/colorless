import type { Card } from "@colorless/schema";
import manifest from "../package.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, splitAttackGateClause, splitAttackTrailingClause } from "./effects";
import { engineVersion } from "./index";
import type { EffectOp, GameEvent, GameState, PokemonRef, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  driveSetup,
} from "./testFixtures";

const PURGE_SEED = 477_0477;

const TWO_THEN_120 =
  "Discard 2 Energy from this Pokémon. This attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const ALL_THEN_90 =
  "Discard all Energy from this Pokémon, and this attack also does 90 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const TYPED_THEN_180 =
  "Discard all {R} Energy from this Pokémon, and this attack does 180 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const ALL_THEN_ANY_120 =
  "Discard all Energy from this Pokémon, and this attack does 120 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const EX_THEN_210 =
  "Discard all Energy from this Pokémon, and this attack does 210 damage to 1 of your opponent's Benched Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const PURGE_ALL = 0;
const PURGE_TWO = 1;
const PURGE_TYPED = 2;
const PURGE_ANY = 3;
const PURGE_NONE = 4;

const PURGE_CARDS: Record<string, Card> = {
  "d477-purger": battler("d477-purger", {
    name: "D477 Purger",
    types: ["Colorless"],
    hp: 320,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Ashfall", damage: 30, effect: ALL_THEN_90 },
      { cost: ["Colorless"], name: "Twin Purge", damage: 30, effect: TWO_THEN_120 },
      // No printed `damage`: this sentence carries no `also`, so the snipe IS the attack.
      { cost: ["Colorless"], name: "Emberdump", effect: TYPED_THEN_180 },
      { cost: ["Colorless"], name: "Wide Purge", effect: ALL_THEN_ANY_120 },
      // No effect text at all: the control that separates "the program ran and found
      // nothing" from "no program ran" on the ZERO-MATCH board of §6.
      { cost: ["Colorless"], name: "Plain Cuff", damage: 30 },
    ],
  }),
  /** The defender. Big enough that nothing in this suite Knocks it Out, so every number
      read off the board is a damage figure rather than a promotion. */
  "d477-wall": battler("d477-wall", { name: "D477 Wall", types: ["Colorless"], hp: 340 }),
  "d477-benchtall": battler("d477-benchtall", { name: "D477 Tall", types: ["Colorless"], hp: 330 }),
  "d477-benchmid": battler("d477-benchmid", { name: "D477 Mid", types: ["Colorless"], hp: 310 }),
  "d477-benchlow": battler("d477-benchlow", { name: "D477 Low", types: ["Colorless"], hp: 290 }),
};

const PURGE_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...PURGE_CARDS };

const PURGE_DECK = deckOf({
  "d477-purger": 8,
  "d477-wall": 8,
  "d477-benchtall": 6,
  "d477-benchmid": 6,
  "d477-benchlow": 6,
  "fix-energy": 10,
  "fix-fire-energy": 8,
  "fix-water-energy": 8,
});

function openPurgeTable(first: Seat): GameState {
  return driveSetup(PURGE_SEED, { p1: PURGE_DECK, p2: PURGE_DECK }, { pool: PURGE_POOL, first });
}

function purgeTable(stock: readonly string[], oppBench: readonly string[]): GameState {
  let table = openPurgeTable("p2");
  table = mustApply(table, { type: "endTurn", seat: "p2" }).state;
  expect(table.turn).toBe(2);
  table = setActiveFromDeck(table, "p1", "d477-purger");
  table = setActiveFromDeck(table, "p2", "d477-wall");
  table = clearBench(table, "p1");
  table = clearBench(table, "p2");
  for (const card of stock) table = attachFromDeck(table, "p1", card, 1);
  for (const card of oppBench) table = benchFromDeck(table, "p2", card);
  return table;
}

/** The §5 board, spelled once: a DAMAGED defender and three benched bodies at three
    different HP with three different starting damages. Every wrong implementation this
    file can name answers a different vector. */
function loadBearingBoard(stock: readonly string[]): GameState {
  let table = purgeTable(stock, ["d477-benchtall", "d477-benchmid", "d477-benchlow"]);
  table = setDamage(table, "p2", 40);
  table = setBenchDamage(table, "p2", 0, 10);
  table = setBenchDamage(table, "p2", 1, 20);
  table = setBenchDamage(table, "p2", 2, 30);
  return table;
}

function swingPurge(state: GameState, index: number) {
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

function dealtRows(events: GameEvent[]): { seat: Seat; by: Seat; dealt: number }[] {
  return events.flatMap((e) =>
    e.type === "DAMAGE_DEALT" ? [{ seat: e.seat, by: e.by, dealt: e.dealt }] : [],
  );
}

function payTheCost(state: GameState): { state: GameState; events: GameEvent[] } {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  const prompt = state.phase.prompt;
  if (prompt.kind !== "discardEnergy")
    throw new Error(`expected discardEnergy, got ${prompt.kind}`);
  if (prompt.scope.kind !== "total") throw new Error("expected a total-scoped discard");
  const uids = prompt.discardable.slice(0, prompt.scope.count).map((offer) => offer.uid);
  if (uids.length < prompt.scope.count) throw new Error("a discardEnergy park short of offers");
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "discardEnergy", uids },
  });
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

/** Counted by code point, the sibling suites' spelling. */
function utf8Length(text: string): number {
  let total = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    total += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return total;
}

const corpusRows = () => legalAttackCorpus();

describe("§1 — three printed rows, and the family they belong to", () => {
  it("the column did not move, and each of the three is a corpus row at its printing count", () => {
    const rows = new Map(corpusRows().map(([units, sentence]) => [sentence, units]));
    expect(corpusRows()).toHaveLength(640);
    expect(corpusRows().reduce((n, [units]) => n + units, 0)).toBe(1732);
    expect(rows.get(TWO_THEN_120)).toBe(2);
    expect(rows.get(ALL_THEN_90)).toBe(2);
    expect(rows.get(TYPED_THEN_180)).toBe(1);
    expect([TWO_THEN_120, ALL_THEN_90, TYPED_THEN_180]).toHaveLength(3);
    expect(
      [TWO_THEN_120, ALL_THEN_90, TYPED_THEN_180].reduce((n, s) => n + (rows.get(s) ?? 0), 0),
    ).toBe(5);
  });

  it("the bytes are the CORPUS's bytes, not a retyping, and every slot is U+0027", () => {
    for (const printed of [TWO_THEN_120, ALL_THEN_90, TYPED_THEN_180, ALL_THEN_ANY_120]) {
      expect(
        corpusRows().some(([, s]) => s === printed),
        printed,
      ).toBe(true);
      expect(printed).not.toContain("’");
      expect(printed).toContain("'");
    }
    // Three `Pokémon` apiece — the cost's, the target's and the clarifier's — so each
    // UTF-8 figure runs three bytes ahead of the code-point count.
    expect(TWO_THEN_120).toHaveLength(168);
    expect(utf8Length(TWO_THEN_120)).toBe(171);
    expect(ALL_THEN_90).toHaveLength(173);
    expect(utf8Length(ALL_THEN_90)).toBe(176);
    expect(TYPED_THEN_180).toHaveLength(173);
    expect(utf8Length(TYPED_THEN_180)).toBe(176);
  });

  it("the WHOLE printed family is EIGHT rows, published as the pattern that was RUN", () => {
    const family = corpusRows().filter(([, s]) =>
      /^Discard .* from this Pokémon[.,] (and )?[Tt]his attack .*damage to /.test(s),
    );
    expect(family).toHaveLength(8);
    expect(family.reduce((n, [units]) => n + units, 0)).toBe(13);
    const claimed = family.filter(([, s]) => resolvedByAnyReader(s));
    expect(claimed).toHaveLength(8);
    expect(claimed.reduce((n, [units]) => n + units, 0)).toBe(13);
    const left = family.filter(([, s]) => !resolvedByAnyReader(s));
    expect(left.map(([, s]) => s)).toEqual([]);
    expect(
      corpusRows().filter(([, s]) => /^Discard .* from your (hand|Pokémon)\. This attack/.test(s)),
    ).not.toHaveLength(0);
  });

  it("the row that WAS left is built, and D477's own price is graded here", () => {
    const program = deriveAttackEffect(EX_THEN_210) as EffectOp[];
    expect(program).toHaveLength(2);
    const snipe = program[1];
    if (snipe?.op !== "damageChosen") throw new Error("expected a damageChosen");
    expect(snipe.filter).toEqual({ kind: "suffixPokemon", suffix: "ex" });
    expect(corpusRows().some(([, s]) => s === EX_THEN_210)).toBe(true);
    const stripped = EX_THEN_210.replace("Benched Pokémon ex.", "Benched Pokémon.");
    const bare = deriveAttackEffect(stripped) as EffectOp[];
    expect(bare).not.toBeNull();
    expect(bare[1]).not.toEqual(snipe);
    expect((bare[1] as { filter?: unknown }).filter).toBeUndefined();
  });
});

describe("§2 — two ops in printed order, and each half is the bare anchor's own output", () => {
  it("the three programs are exactly these bytes", () => {
    expect(deriveAttackEffect(TWO_THEN_120)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: 2 },
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 120,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
    expect(deriveAttackEffect(ALL_THEN_90)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 90,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
    expect(deriveAttackEffect(TYPED_THEN_180)).toEqual([
      {
        op: "discardEnergy",
        from: "yourActive",
        filter: { kind: "providesEnergy", energyType: "Fire" },
        count: "all",
      },
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 180,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
  });

  it("D132's INVENTORY RULE: each half is BYTE-IDENTICAL to the bare anchor's output", () => {
    const two = deriveAttackEffect(TWO_THEN_120) as EffectOp[];
    expect(two[0]).toEqual(
      (deriveAttackEffect("Discard 2 Energy from this Pokémon.") as EffectOp[])[0],
    );
    expect(two[1]).toEqual(
      (
        deriveAttackEffect(
          "This attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        ) as EffectOp[]
      )[0],
    );
    const typed = deriveAttackEffect(TYPED_THEN_180) as EffectOp[];
    expect(typed[0]).toEqual(
      (deriveAttackEffect("Discard all {R} Energy from this Pokémon.") as EffectOp[])[0],
    );
    expect(typed[1]).toEqual(
      (
        deriveAttackEffect(
          "This attack does 180 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        ) as EffectOp[]
      )[0],
    );
  });

  it("the ANY-target sibling is UNMOVED — this slice added a reader, it did not re-aim one", () => {
    for (const printed of [
      ALL_THEN_ANY_120,
      "Discard 2 Energy from this Pokémon. This attack does 120 damage to 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "Discard all Energy from this Pokémon. This attack does 110 damage to 3 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "Discard all Energy from this Pokémon. This attack does 120 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    ]) {
      const program = deriveAttackEffect(printed) as EffectOp[];
      const snipe = program[1];
      if (snipe?.op !== "damageChosen") throw new Error(`not a damageChosen: ${printed}`);
      expect(snipe.target, printed).toBe("opponentAny");
    }
  });
});

describe("§3 — the anchor's generalisations claim nothing extra, and that is on purpose", () => {
  const NARROWEST =
    /^Discard (all|\d+)(?: \{([GRWLPFDMY])\})? Energy from this Pokémon(?:\. This|, and this) attack (?:also )?does (\d+) damage to (\d+) of your opponent's Benched Pokémon\.(?: \(Don't apply Weakness and Resistance for Benched Pokémon\.\))?$/;

  it("the shared fragment's generality claims EXACTLY the rows a literal would", () => {
    const byNarrow = corpusRows().filter(([, s]) => NARROWEST.test(s));
    expect(byNarrow.map(([, s]) => s).sort()).toEqual(
      [TWO_THEN_120, ALL_THEN_90, TYPED_THEN_180].sort(),
    );
    expect(byNarrow.reduce((n, [units]) => n + units, 0)).toBe(5);
    // …and the same three are exactly what the shipped arm claims.
    const byArm = corpusRows().filter(([, s]) => {
      const program = deriveAttackEffect(s);
      if (program === null || program.length !== 2) return false;
      const [cost, snipe] = program;
      return (
        cost?.op === "discardEnergy" &&
        snipe?.op === "damageChosen" &&
        snipe.target === "opponentBench"
      );
    });
    expect(byArm.map(([, s]) => s).sort()).toEqual(
      [TWO_THEN_120, ALL_THEN_90, TYPED_THEN_180, EX_THEN_210].sort(),
    );
    const bought = byArm.filter(([, s]) => !NARROWEST.test(s));
    expect(bought.map(([, s]) => s)).toEqual([EX_THEN_210]);
    expect(bought.reduce((n, [units]) => n + units, 0)).toBe(1);
  });

  it("`also` is NOT what refused these rows, and stripping it changes no answer", () => {
    const bare = ALL_THEN_90.replace("attack also does", "attack does");
    expect(deriveAttackEffect(bare)).toEqual(deriveAttackEffect(ALL_THEN_90));
    const alsoed = TYPED_THEN_180.replace("attack does", "attack also does");
    expect(deriveAttackEffect(alsoed)).toEqual(deriveAttackEffect(TYPED_THEN_180));
    expect(corpusRows().some(([, s]) => s === bare)).toBe(false);
    expect(corpusRows().some(([, s]) => s === alsoed)).toBe(false);
  });

  it("the SIDE is read off the printed possessive, on a CONSTRUCTED own-side compound", () => {
    const ownSide = ALL_THEN_90.replace("1 of your opponent's Benched", "1 of your Benched");
    expect(corpusRows().some(([, s]) => s === ownSide)).toBe(false);
    const program = deriveAttackEffect(ownSide) as EffectOp[];
    expect(program).toHaveLength(2);
    const snipe = program[1];
    if (snipe?.op !== "damageChosen") throw new Error("expected a damageChosen");
    expect(snipe.target).toBe("yourBench");
    const printed = deriveAttackEffect(ALL_THEN_90) as EffectOp[];
    const printedSnipe = printed[1];
    if (printedSnipe?.op !== "damageChosen") throw new Error("expected a damageChosen");
    expect(printedSnipe.target).toBe("opponentBench");
    expect(deriveAttackEffect(ownSide)).not.toEqual(deriveAttackEffect(ALL_THEN_90));
  });

  it("the type slot is `{X}` only, and the spelled-out notation would buy ZERO", () => {
    // `TYPED_SELF_DISCARD` admits both notations; this anchor admits one, and the reason
    // is the same measurement as above. Over all 640 rows the column prints NO
    // spelled-out typed discard in front of a snipe at all.
    const spelled = corpusRows().filter(([, s]) =>
      /^Discard (all|\d+) (Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Dragon|Fairy) Energy from this Pokémon/.test(
        s,
      ),
    );
    expect(spelled).toHaveLength(0);
    for (const code of ["G", "R", "W", "L", "P", "F", "D", "M", "Y"]) {
      const constructed = TYPED_THEN_180.replace("{R}", `{${code}}`);
      expect(deriveAttackEffect(constructed), code).not.toBeNull();
    }
    // …while a code the map does NOT carry stays LOUD rather than counting every card.
    expect(deriveAttackEffect(TYPED_THEN_180.replace("{R}", "{C}"))).toBeNull();
  });
});

describe("§4 — what the anchor refuses, and why the two anchors cannot collide", () => {
  it("a printed 0 in ANY of the THREE positions stays LOUD, each against its own twin", () => {
    for (const [bad, good] of [
      [
        "Discard 0 Energy from this Pokémon. This attack also does 120 damage to 1 of your opponent's Benched Pokémon.",
        "Discard 2 Energy from this Pokémon. This attack also does 120 damage to 1 of your opponent's Benched Pokémon.",
      ],
      [
        "Discard 2 Energy from this Pokémon. This attack also does 0 damage to 1 of your opponent's Benched Pokémon.",
        "Discard 2 Energy from this Pokémon. This attack also does 1 damage to 1 of your opponent's Benched Pokémon.",
      ],
      [
        "Discard 2 Energy from this Pokémon. This attack also does 120 damage to 0 of your opponent's Benched Pokémon.",
        "Discard 2 Energy from this Pokémon. This attack also does 120 damage to 1 of your opponent's Benched Pokémon.",
      ],
    ] as const) {
      expect(deriveAttackEffect(bad), bad).toBeNull();
      expect(deriveAttackEffect(good), good).not.toBeNull();
    }
  });

  it("D400's number AGREEMENT rides in with the shared fragment", () => {
    const one =
      "Discard 2 Energy from this Pokémon. This attack also does 120 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)";
    const two = one.replace("to 1 of", "to 2 of");
    const narrowed = deriveAttackEffect(one) as EffectOp[];
    const snipe = narrowed[1];
    if (snipe?.op !== "damageChosen") throw new Error("expected a damageChosen");
    expect(snipe.damagedOnly).toBe(true);
    expect(deriveAttackEffect(two)).toBeNull();
    expect(corpusRows().some(([, s]) => s === one || s === two)).toBe(false);
  });

  it("the anchor's TERMINATOR: a compound that BEGINS with a printed compound is refused", () => {
    // Dropping the `$` would turn this into a PREFIX match and it would LOOK LIKE A
    // COVERAGE WIN. Driven at BOTH stopping points, because the optional clarifier is
    // exactly where a prefix match would otherwise halt.
    for (const text of [
      "Discard all Energy from this Pokémon, and this attack also does 90 damage to 1 of your opponent's Benched Pokémon. Your opponent's Active Pokémon is now Paralyzed.",
      `${ALL_THEN_90} Your opponent's Active Pokémon is now Paralyzed.`,
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    expect(
      deriveAttackEffect(
        "Discard all Energy from this Pokémon, and this attack also does 90 damage to 1 of your opponent's Benched Pokémon.",
      ),
    ).not.toBeNull();
  });

  it("STRUCTURAL disjointness from D401's anchor, in BOTH directions (D467)", () => {
    const benchOnes = [TWO_THEN_120, ALL_THEN_90, TYPED_THEN_180];
    const anyOnes = [ALL_THEN_ANY_120];
    for (const printed of benchOnes) {
      const program = deriveAttackEffect(printed) as EffectOp[];
      const snipe = program[1];
      if (snipe?.op !== "damageChosen") throw new Error(`not a damageChosen: ${printed}`);
      expect(snipe.target, printed).toBe("opponentBench");
    }
    for (const printed of anyOnes) {
      const program = deriveAttackEffect(printed) as EffectOp[];
      const snipe = program[1];
      if (snipe?.op !== "damageChosen") throw new Error(`not a damageChosen: ${printed}`);
      expect(snipe.target, printed).toBe("opponentAny");
    }
    expect(deriveAttackEffect(ALL_THEN_90)).not.toEqual(deriveAttackEffect(ALL_THEN_ANY_120));
  });

  it("the trailing PARENTHETICAL is the anchor's, and it is what stopped the ONE `COMPOSE` row", () => {
    expect(splitAttackTrailingClause(TWO_THEN_120)).toBeNull();
    expect(splitAttackGateClause(TWO_THEN_120)).toBeNull();
    // Both halves DO build on their own, which is the whole content of the `COMPOSE`
    // class — and now the anchor claims the whole string, so the shadow refusal at the
    // top of the splitter is what refuses it and the tail test is no longer reached.
    expect(deriveAttackEffect("Discard 2 Energy from this Pokémon.")).not.toBeNull();
    expect(
      deriveAttackEffect(
        "This attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).not.toBeNull();
    expect(resolvedByAnyReader(TWO_THEN_120)).toBe(true);
    expect(
      deriveAttackEffect(
        "Discard all {R} Energy from this Pokémon, and this attack does 180 damage to 1 of your opponent's Benched Pokémon.",
      ),
    ).toEqual(deriveAttackEffect(TYPED_THEN_180));
  });
});

describe("§5 — the snipe lands where it was told to, on a board that can say otherwise", () => {
  it("the candidate set is the opponent's BENCH — three refs, and NOT the Active", () => {
    const table = loadBearingBoard(["fix-energy", "fix-water-energy"]);
    const { state: parked } = swingPurge(table, PURGE_ALL);
    const prompt = snipePrompt(parked);
    expect(prompt.candidates).toHaveLength(3);
    expect(prompt.candidates.every((ref) => ref.seat === "p2")).toBe(true);
    expect(prompt.candidates.every((ref) => ref.spot.spot === "bench")).toBe(true);
    expect(prompt.min).toBe(1);
    expect(prompt.max).toBe(1);
  });

  it("the pick decides WHICH benched body takes it, and every wrong answer is a different vector", () => {
    const table = loadBearingBoard(["fix-energy", "fix-water-energy"]);
    // The main hit lands first: the defender starts at 40 and Ashfall prints 30.
    for (const [pick, wanted] of [
      [0, [100, 20, 30]],
      [1, [10, 110, 30]],
      [2, [10, 20, 120]],
    ] as const) {
      const { state: parked } = swingPurge(table, PURGE_ALL);
      const { state: done } = answerSnipe(parked, pick);
      expect(benchDamages(done, "p2"), `pick ${pick}`).toEqual([...wanted]);
      // …and the Active took the MAIN hit and NOTHING else. A build that applied the
      // snipe to the Active answers 160 here and leaves the bench at [10, 20, 30].
      expect(activeDamage(done, "p2"), `pick ${pick}`).toBe(70);
      expect(benchDamages(done, "p1"), `pick ${pick}`).toEqual([]);
    }
  });

  it("the benched hit is FLAT — no Weakness, no Resistance — and the Active's is not", () => {
    // §8.5 scopes W/R to the Active/Defending Pokémon. The bench body is Colorless with
    // no Weakness printed, so the honest control is the ANY-target sibling one index over:
    // the same head, the same cost, and a target set that includes the Active.
    const table = loadBearingBoard(["fix-energy", "fix-water-energy"]);
    const { state: parked } = swingPurge(table, PURGE_ANY);
    const wide = snipePrompt(parked);
    expect(wide.candidates).toHaveLength(4);
    expect(wide.candidates.filter((ref) => ref.spot.spot === "active")).toHaveLength(1);
    // Aim it at the Active and the 120 lands there; the bench does not move.
    const activeAt = wide.candidates.findIndex((ref) => ref.spot.spot === "active");
    const { state: done, events } = answerSnipe(parked, activeAt);
    expect(activeDamage(done, "p2")).toBe(160);
    expect(benchDamages(done, "p2")).toEqual([10, 20, 30]);
    expect(dealtRows(events).map((r) => r.dealt)).toEqual([120]);
  });

  it("BOTH prompts RENDER, and each names the zone its own funnel offers (D473)", () => {
    const table = loadBearingBoard(["fix-energy", "fix-water-energy", "fix-fire-energy"]);
    const { state: costPark } = swingPurge(table, PURGE_TWO);
    if (costPark.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const costPrompt = costPark.phase.prompt;
    if (costPrompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    expect(costPrompt.note).not.toBe("");
    expect(costPrompt.scope).toEqual({ kind: "total", count: 2 });
    const { state: snipePark } = payTheCost(costPark);
    const note = snipePrompt(snipePark).note;
    expect(note).toBe("Choose 1 of your opponent's Benched Pokémon (120 damage each).");
    // …and the ANY-target sibling's caption names the WIDER zone on the same board, so
    // the word is read off the op rather than hard-coded (the pair is the claim).
    const wide = snipePrompt(swingPurge(table, PURGE_ANY).state).note;
    expect(wide).toBe("Choose 1 of your opponent's Pokémon (120 damage each).");
  });

  it("the DAMAGE_DEALT row names the victim's seat and the DEALER, and the dealer is p1", () => {
    const table = loadBearingBoard(["fix-energy", "fix-water-energy"]);
    const { state: parked } = swingPurge(table, PURGE_ALL);
    const { events } = answerSnipe(parked, 1);
    expect(dealtRows(events)).toEqual([{ seat: "p2", by: "p1", dealt: 90 }]);
  });

  it("the amounts are READ, not assumed: 90, 120 and 180 land as printed", () => {
    // Three attacks, three printed amounts, one board — so an arm that hardcoded any of
    // them (or read the wrong capture) answers a number this rung names.
    const rich = loadBearingBoard(["fix-energy", "fix-water-energy", "fix-fire-energy"]);
    const first = answerSnipe(swingPurge(rich, PURGE_ALL).state, 1).state;
    expect(benchDamages(first, "p2")).toEqual([10, 110, 30]);
    const second = answerSnipe(payTheCost(swingPurge(rich, PURGE_TWO).state).state, 1).state;
    expect(benchDamages(second, "p2")).toEqual([10, 140, 30]);
    const third = answerSnipe(swingPurge(rich, PURGE_TYPED).state, 1).state;
    expect(benchDamages(third, "p2")).toEqual([10, 200, 30]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE ZERO-MATCH BOARD, WITH CONTROLS SEPARATING IT FROM SILENCE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — an empty opponent Bench is a SILENT no-op, and the silence is attributed", () => {
  it("the cost is still PAID, the attack still resolves, and nothing is sniped", () => {
    // The interpreter's `candidates.length === 0` arm returns the state untouched. That
    // reads exactly like "the program never ran", so the discard is the witness that it
    // did — and it is the half of the sentence that has nothing to do with the Bench.
    const empty = purgeTable(["fix-energy", "fix-water-energy"], []);
    expect(empty.players.p2.bench).toHaveLength(0);
    expect(empty.players.p1.active?.energy).toHaveLength(2);
    const { state: done, events } = swingPurge(empty, PURGE_ALL);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(done.players.p1.active?.energy).toEqual([]);
    expect(activeDamage(done, "p2")).toBe(30);
    expect(dealtRows(events).map((r) => r.dealt)).toEqual([30]);
    expect(eventTypes(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("THE CONTROL: the SAME board with one benched body fires, and the plain attack never could", () => {
    const oneBody = purgeTable(["fix-energy", "fix-water-energy"], ["d477-benchmid"]);
    const { state: parked } = swingPurge(oneBody, PURGE_ALL);
    expect(parked.phase.kind).not.toBe("effect:choose");
    expect(benchDamages(parked, "p2")).toEqual([90]);
    const empty = purgeTable(["fix-energy", "fix-water-energy"], []);
    const { state: plain, events } = swingPurge(empty, PURGE_NONE);
    expect(activeDamage(plain, "p2")).toBe(30);
    expect(plain.players.p1.active?.energy).toHaveLength(2);
    expect(eventTypes(events)).not.toContain("ENERGY_DISCARDED");
  });

  it("and the ANY-target sibling is NOT silent on the same empty board", () => {
    const empty = purgeTable(["fix-energy", "fix-water-energy"], []);
    const { state: done } = swingPurge(empty, PURGE_ANY);
    expect(activeDamage(done, "p2")).toBe(120);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE COST, DRIVEN INDEPENDENTLY OF THE DAMAGE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the self-discard half, on its own terms", () => {
  it("`all` empties the attacker whatever is attached, and resolves INLINE", () => {
    const three = loadBearingBoard(["fix-energy", "fix-water-energy", "fix-fire-energy"]);
    expect(three.players.p1.active?.energy).toHaveLength(3);
    const { state: parked } = swingPurge(three, PURGE_ALL);
    // `all` has no decision in it, so the FIRST park a player sees is the snipe's.
    expect(snipePrompt(parked).candidates).toHaveLength(3);
    expect(parked.players.p1.active?.energy).toEqual([]);
  });

  it("the TYPED cost discards only what provides {R}, and leaves the rest standing", () => {
    const mixed = loadBearingBoard(["fix-energy", "fix-water-energy", "fix-fire-energy"]);
    const before = mixed.players.p1.active?.energy ?? [];
    expect(before).toHaveLength(3);
    const { state: parked } = swingPurge(mixed, PURGE_TYPED);
    const after = parked.players.p1.active?.energy ?? [];
    expect(after).toHaveLength(2);
    expect(after.every((uid) => parked.cardIdByUid[uid] !== "fix-fire-energy")).toBe(true);
    // …and the snipe behind it still fires, so the two ops are sequenced and not
    // alternatives.
    const { state: done } = answerSnipe(parked, 2);
    expect(benchDamages(done, "p2")).toEqual([10, 20, 210]);
  });

  it("the COUNT-2 cost PARKS on a genuine choice, and the snipe parks AFTER it", () => {
    const mixed = loadBearingBoard(["fix-energy", "fix-water-energy", "fix-fire-energy"]);
    const { state: firstPark } = swingPurge(mixed, PURGE_TWO);
    expect(firstPark.phase.kind).toBe("effect:choose");
    if (firstPark.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(firstPark.phase.prompt.kind).toBe("discardEnergy");
    // The SNIPE is still in `rest` at this point — the tail the continuation carries.
    expect(firstPark.phase.cont.rest.map((op) => op.op)).toEqual(["damageChosen"]);
    const { state: secondPark } = payTheCost(firstPark);
    expect(snipePrompt(secondPark).candidates).toHaveLength(3);
    const { state: done } = answerSnipe(secondPark, 0);
    expect(benchDamages(done, "p2")).toEqual([130, 20, 30]);
    // Exactly two Energy went, and one stayed.
    expect(done.players.p1.active?.energy).toHaveLength(1);
  });

  it("a UNIFORM pile does not park the cost, which is the control for the rung above", () => {
    // Three copies of one class: `interchangeableCandidates` collapses them, the pick is
    // forced, and the discard resolves inline — so the first prompt is the snipe's.
    const uniform = loadBearingBoard(["fix-energy"]);
    const { state: parked } = swingPurge(uniform, PURGE_TWO);
    expect(snipePrompt(parked).candidates).toHaveLength(3);
    expect(parked.players.p1.active?.energy).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — WHAT DID NOT MOVE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the surface, the version, and the mechanisms this slice did not add", () => {
  it("the reader SURFACE stands still at 13 — the arm is inside `deriveAttackEffect`", () => {
    expect(attackReaderSurface()).toHaveLength(14);
    expect(attackReaderSurface()).toContain("deriveAttackEffect");
  });

  it("engineVersion is 0.555.0 and `manifest.version` agrees", () => {
    expect(manifest.version).toBe(engineVersion);
  });

  it("the three sentences produce NO op this engine did not already emit", () => {
    const kinds = new Set(
      [TWO_THEN_120, ALL_THEN_90, TYPED_THEN_180].flatMap((s) =>
        (deriveAttackEffect(s) ?? []).map((op) => op.op),
      ),
    );
    expect([...kinds].sort()).toEqual(["damageChosen", "discardEnergy"]);
  });

  it("the derived programs are frozen-safe and stable across calls", () => {
    for (const printed of [TWO_THEN_120, ALL_THEN_90, TYPED_THEN_180]) {
      const once = deepFreeze(deriveAttackEffect(printed));
      expect(deriveAttackEffect(printed)).toEqual(once);
    }
  });
});
