import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackDamageBonus, deriveAttackRequirement } from "./effects";
import { POKEMON_TYPES } from "./effectTypes";
import type { BoardCondition, GameState } from "./index";
import { conditionHolds, conditionNote } from "./boardCondition";
import { programFor } from "./registry";
import {
  BENCH_NAMED_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
  programmedCardIds,
} from "./testFixtures";

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

const TAKEN: readonly (readonly [string, number, BoardCondition])[] = [
  [
    "If Durant is on your Bench, this attack does 20 more damage.",
    2,
    { kind: "yourBenchHasNamed", name: "Durant" },
  ],
  [
    "If Illumise is on your Bench, this attack does 60 more damage.",
    1,
    { kind: "yourBenchHasNamed", name: "Illumise" },
  ],
  [
    "If Mightyena is on your Bench, this attack does 90 more damage.",
    1,
    { kind: "yourBenchHasNamed", name: "Mightyena" },
  ],
  [
    "If Beldum and Metang are on your Bench, this attack does 150 more damage.",
    1,
    {
      kind: "allOf",
      conditions: [
        { kind: "yourBenchHasNamed", name: "Beldum" },
        { kind: "yourBenchHasNamed", name: "Metang" },
      ],
    },
  ],
  [
    "If your opponent's Active Pokémon is a Stage 2 Pokémon, this attack does 140 more damage.",
    2,
    { kind: "opponentActiveIsStage2" },
  ],
  [
    "If your opponent has 5 or fewer cards in their hand, this attack does 60 more damage.",
    1,
    { kind: "opponentHandAtMost", count: 5 },
  ],
  [
    "If your opponent has 4 or fewer Prize cards remaining, this attack does 70 more damage.",
    2,
    { kind: "opponentPrizesRemaining", counts: [0, 1, 2, 3, 4] },
  ],
  [
    "If your opponent's Active Pokémon is a {P} Pokémon, this attack does 30 more damage.",
    2,
    { kind: "opponentActiveHasType", type: "Psychic" },
  ],
  [
    "If your opponent's Active Pokémon is a {D} Pokémon, this attack does 100 more damage.",
    1,
    { kind: "opponentActiveHasType", type: "Darkness" },
  ],
];

const TAKEN_IDS: readonly string[] = [
  "sv10.5w-070",
  "sv10.5w-150",
  "sv06-009",
  "sv06-114",
  "sv09-063",
  "sv10-101",
  "sv10-214",
  "sv07-084",
  "svp-151",
  "sv08-038",
  "sv05-068",
  "sv05-170",
  "sv10-028",
];

const HANDED_CANDIDATE =
  "If your opponent has 3 or more Benched Pokémon, this attack does 80 more damage.";

const LEFT: readonly (readonly [string, number, string])[] = [
  [
    "If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack does 80 more damage.",
    3,
    "NOT A `BoardCondition` AT ALL — the clause reads THIS ATTACK'S COST, which two printings set to two different values, so no state+seat predicate can answer it",
  ],
];

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: BENCH_NAMED_DECK, p2: BENCH_NAMED_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields `attacker` with one Energy paid, P2 fields a 200 HP body that
    survives every printed base here, and BOTH benches start EMPTY — each case
    puts exactly the bodies it is about. */
function ready(seed: number, attacker: string, energy: string): GameState {
  let state = setActiveFromDeck(board(seed), "p1", attacker);
  state = attachFromDeck(state, "p1", energy, 1);
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  return clearBench(clearBench(state, "p1"), "p2");
}

function benched(state: GameState, ...ids: readonly string[]): GameState {
  let next = state;
  for (const id of ids) next = benchFromDeck(next, "p1", id);
  return next;
}

/** Attack index 0 and report the damage actually dealt. */
function damageDealt(state: GameState): { damage: number; kinds: string[] } {
  const after = mustApply(state, { type: "attack", seat: "p1", index: 0 });
  const dealt = after.events.find((e) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return { damage: dealt?.damage ?? 0, kinds: types(after.events) };
}

describe("§1 — the candidate was PRICED against the whole residue, not inherited", () => {
  it("the bonus skeleton's residue at D366's head was 43 sentences / 60 printings", () => {
    const openers = corpus().filter(([, s]) => BONUS.test(s.trim()));
    expect([openers.length, units(openers)]).toEqual([81, 129]);
    const carried = openers.filter(([, s]) => resolvedByAnyReader(s));
    const refused = openers.filter(([, s]) => !resolvedByAnyReader(s));
    expect(carried.length + refused.length).toBe(openers.length);
    expect(units(carried) + units(refused)).toBe(units(openers));
    expect([refused.length, units(refused)]).toEqual([0, 0]);
    expect([refused.length + 34, units(refused) + 44 + 3]).toEqual([34, 47]);
    expect([refused.length + 34 + TAKEN.length, units(refused) + 47 + 13]).toEqual([43, 60]);
  });

  it("the ZERO-VOCABULARY FLOOR over that residue was 9 sentences / 13 printings", () => {
    expect(TAKEN).toHaveLength(9);
    expect(TAKEN.reduce((sum, [, n]) => sum + n, 0)).toBe(13);
    for (const [sentence, printings] of TAKEN) {
      expect(units(corpus().filter(([, s]) => s === sentence)), sentence).toBe(printings);
    }
  });

  it("…and 13 beat the handed candidate's 1 — which is why D367 refused it, and D389 took it", () => {
    expect(units(corpus().filter(([, s]) => s === HANDED_CANDIDATE))).toBe(1);
    expect(resolvedByAnyReader(HANDED_CANDIDATE)).toBe(true);
    expect(deriveAttackDamageBonus(HANDED_CANDIDATE)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentBenchAtLeast", count: 3 },
    });
    expect(deriveAttackRequirement(HANDED_CANDIDATE)).toBeNull();
    // 13 to 1 — the comparison written as arithmetic so it cannot rot into prose.
    expect(TAKEN.reduce((sum, [, n]) => sum + n, 0)).toBeGreaterThan(
      units(corpus().filter(([, s]) => s === HANDED_CANDIDATE)) * 12,
    );
  });

  it("names what is LEFT, with what each still costs — and the last of them is now CLAIMED", () => {
    for (const [sentence, printings, cost] of LEFT) {
      expect(units(corpus().filter(([, s]) => s === sentence)), cost).toBe(printings);
      expect(resolvedByAnyReader(sentence), cost).toBe(true);
      expect(BONUS.test(sentence.trim()), sentence).toBe(true);
    }
    expect(Math.max(...LEFT.map(([, n]) => n))).toBe(3);
    const purchasable = LEFT.filter(([, , cost]) => !cost.startsWith("NOT A `BoardCondition`"));
    expect(purchasable).toEqual([]);
    expect(LEFT).toHaveLength(1);
    expect(LEFT[0]?.[2].startsWith("NOT A `BoardCondition`")).toBe(true);
    expect(resolvedByAnyReader(LEFT[0]?.[0] ?? "")).toBe(true);
  });
});

describe("§2 — every taken sentence resolves to the EXISTING member, by value", () => {
  it("maps all nine to their member and their printed amount", () => {
    for (const [sentence, , cond] of TAKEN) {
      const read = deriveAttackDamageBonus(sentence);
      expect(read, sentence).not.toBeNull();
      expect(read?.count, sentence).toEqual({ kind: "boardCondition", cond });
      expect(read?.per, sentence).toBe(Number(BONUS.exec(sentence)?.[2]));
    }
  });

  it("buys ZERO new union members — every member here already had both reader arms", () => {
    const state = ready(4700, "fix-durant", "fix-energy");
    for (const [sentence, , cond] of TAKEN) {
      expect(typeof conditionHolds(state, "p1", cond), sentence).toBe("boolean");
      expect(conditionNote(cond), sentence).not.toBe("");
    }
  });

  it("keeps the two CONSEQUENTS disjoint — D125's rule, on all nine", () => {
    for (const [sentence] of TAKEN) {
      // The requirement reader must never see a sentence meaning "+N".
      expect(deriveAttackRequirement(sentence), sentence).toBeNull();
      // …and the cancel spelling of the same clause must never reach the bonus
      // table, which is the direction that would score a bonus off a cancel.
      const clause = BONUS.exec(sentence)?.[1] ?? "";
      expect(deriveAttackDamageBonus(`If ${clause}, this attack does nothing.`), clause).toBeNull();
    }
  });

  it("the anchors are whole-sentence at BOTH ends — no substring reaches a row", () => {
    const [sentence] = TAKEN[0] ?? ["", 0, { kind: "yourStadiumInPlay" } as BoardCondition];
    const clause = BONUS.exec(sentence)?.[1] ?? "";
    // Lowercase `if` — the skeleton has no /i.
    expect(deriveAttackDamageBonus(`if ${clause}, this attack does 20 more damage.`)).toBeNull();
    // No trailing period is not the whole sentence.
    expect(deriveAttackDamageBonus(`If ${clause}, this attack does 20 more damage`)).toBeNull();
    // Leading text pins `^`.
    expect(
      deriveAttackDamageBonus(`Flip a coin. If ${clause}, this attack does 20 more damage.`),
    ).toBeNull();
    // A printed 0 adds nothing — the guard every arm in this family carries.
    expect(deriveAttackDamageBonus(`If ${clause}, this attack does 0 more damage.`)).toBeNull();
  });
});

describe("§3 — the SELF-NAMING boards: 'on your Bench' is not 'in play', on two more cards", () => {
  it("Durant's clause names DURANT — the attacker's own card, and it must NOT satisfy itself", () => {
    // The board that refutes the widening in one line: a Durant in the ACTIVE
    // SPOT and an EMPTY Bench. `yourBenchHasNamed` is false; an "in play" reading
    // of the same name would be TRUE and the +20 would be unconditional.
    const alone = ready(4701, "fix-durant", "fix-energy");
    const topUid = alone.players.p1.active?.stack.at(-1) ?? "";
    expect(alone.cardIdByUid[topUid]).toBe("fix-durant");
    expect(alone.players.p1.bench).toHaveLength(0);
    expect(conditionHolds(alone, "p1", { kind: "yourBenchHasNamed", name: "Durant" })).toBe(false);
    expect(damageDealt(alone).damage).toBe(20);
    // …and with a SECOND Durant on the Bench the same board pays the bonus.
    const paired = benched(ready(4702, "fix-durant", "fix-energy"), "fix-durant");
    expect(conditionHolds(paired, "p1", { kind: "yourBenchHasNamed", name: "Durant" })).toBe(true);
    expect(damageDealt(paired).damage).toBe(40);
  });

  it("Mightyena's clause names MIGHTYENA — the same refutation, a second card", () => {
    const alone = ready(4703, "fix-mightyena", "fix-dark-energy");
    expect(alone.players.p1.bench).toHaveLength(0);
    expect(conditionHolds(alone, "p1", { kind: "yourBenchHasNamed", name: "Mightyena" })).toBe(
      false,
    );
    expect(damageDealt(alone).damage).toBe(30);
    const pack = benched(ready(4704, "fix-mightyena", "fix-dark-energy"), "fix-mightyena");
    expect(conditionHolds(pack, "p1", { kind: "yourBenchHasNamed", name: "Mightyena" })).toBe(true);
    expect(damageDealt(pack).damage).toBe(120);
  });

  it("Volbeat is the CONTROL — it names a DIFFERENT card, so the member is not 'another copy of me'", () => {
    const filler = benched(ready(4705, "fix-durant", "fix-energy"), "fix-benchfiller");
    expect(conditionHolds(filler, "p1", { kind: "yourBenchHasNamed", name: "Illumise" })).toBe(
      false,
    );
    const real = benched(ready(4706, "fix-durant", "fix-energy"), "fix-illumise");
    expect(conditionHolds(real, "p1", { kind: "yourBenchHasNamed", name: "Illumise" })).toBe(true);
    expect(
      TAKEN.filter(([s]) => s.includes("is on your Bench") || s.includes("are on your Bench")),
    ).toHaveLength(4);
  });

  it("the `allOf` row needs BOTH bodies — one conjunct is not the conjunction", () => {
    const cond = TAKEN[3]?.[2] as BoardCondition;
    const neither = ready(4707, "fix-durant", "fix-energy");
    expect(conditionHolds(neither, "p1", cond)).toBe(false);
    const beldum = benched(ready(4708, "fix-durant", "fix-energy"), "fix-beldum");
    expect(conditionHolds(beldum, "p1", cond)).toBe(false);
    const metang = benched(ready(4709, "fix-durant", "fix-energy"), "fix-metang");
    expect(conditionHolds(metang, "p1", cond)).toBe(false);
    const both = benched(ready(4710, "fix-durant", "fix-energy"), "fix-beldum", "fix-metang");
    expect(conditionHolds(both, "p1", cond)).toBe(true);
    expect(
      deriveAttackRequirement(
        "If you don't have Uxie and Azelf on your Bench, this attack does nothing.",
      ),
    ).not.toBeNull();
  });
});

describe("§4 — the Stage 2 row is not the Evolution row narrowed", () => {
  it("an Evolution defender that is a STAGE 1 does not satisfy it — driven both ways", () => {
    const cond: BoardCondition = { kind: "opponentActiveIsStage2" };
    const evolution: BoardCondition = { kind: "opponentActiveIsEvolution" };
    let stage1 = setActiveFromDeck(board(4720), "p2", "fix-stage1");
    stage1 = clearBench(stage1, "p2");
    expect(conditionHolds(stage1, "p1", evolution)).toBe(true);
    expect(conditionHolds(stage1, "p1", cond)).toBe(false);
    let stage2 = setActiveFromDeck(board(4721), "p2", "fix-stage2");
    stage2 = clearBench(stage2, "p2");
    expect(conditionHolds(stage2, "p1", cond)).toBe(true);
    expect(conditionHolds(stage2, "p1", evolution)).toBe(true);
  });

  it("the two rows are DIFFERENT keys and neither reaches the other", () => {
    const stage2 = TAKEN[4]?.[0] ?? "";
    expect(deriveAttackDamageBonus(stage2)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentActiveIsStage2" },
    });
    const stage1Sentence =
      "If your opponent's Active Pokémon is a Stage 1 Pokémon, this attack does 90 more damage.";
    expect(units(corpus().filter(([, s]) => s === stage1Sentence))).toBe(1);
    expect(deriveAttackDamageBonus(stage1Sentence)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentActiveIsStage1" },
    });
    // …and the two keys differ by ONE PRINTED DIGIT, which is what makes the
    // whole-clause key the thing keeping them apart.
    expect(stage1Sentence.replace("Stage 1", "Stage 2")).not.toBe(stage2);
  });
});

describe("§5 — 'N or fewer' as an enumerated set, complete over the domain", () => {
  it("the prize row answers identically to `<= 4` at every representable count 0-6", () => {
    const cond = TAKEN[6]?.[2] as { kind: "opponentPrizesRemaining"; counts: readonly number[] };
    expect(cond.counts).toEqual([0, 1, 2, 3, 4]);
    for (let n = 0; n <= 6; n += 1) {
      expect(cond.counts.includes(n), `prizes ${String(n)}`).toBe(n <= 4);
    }
    // …and the spelling is the one the repo ALREADY uses: `registry.ts` authors
    // the same shape for a printed "3 or fewer", the 0 included. Two producers,
    // one convention.
    const authored = programmedCardIds().filter((id) =>
      JSON.stringify(programFor(id) ?? {}).includes('"opponentPrizesRemaining"'),
    );
    expect(authored.length).toBeGreaterThanOrEqual(2);
    const briar = new Set(["sv07-132", "sv07-163", "sv07-171", "sv08.5-100"]);
    const acerola = new Set(["me01-113", "me01-165", "me01-183", "me02.5-180"]);
    for (const id of authored) {
      const want = briar.has(id)
        ? '"counts":[2]'
        : acerola.has(id)
          ? '"counts":[0,1,2]}'
          : "[0,1,2,3]";
      expect(JSON.stringify(programFor(id)), id).toContain(want);
    }
  });

  it("the hand row is the SAME member at a SECOND threshold, and both still resolve", () => {
    expect(deriveAttackDamageBonus(TAKEN[5]?.[0] ?? "")?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentHandAtMost", count: 5 },
    });
    expect(
      deriveAttackDamageBonus(
        "If your opponent has 3 or fewer cards in their hand, this attack does 120 more damage.",
      )?.count,
    ).toEqual({ kind: "boardCondition", cond: { kind: "opponentHandAtMost", count: 3 } });
  });
});

describe("§6 — the token map: an ASYMMETRY between two sibling templates, closed", () => {
  it("BOTH notations now resolve, and they resolve to the SAME member", () => {
    const glyph = deriveAttackDamageBonus(
      "If your opponent's Active Pokémon is a {P} Pokémon, this attack does 30 more damage.",
    );
    const name = deriveAttackDamageBonus(
      "If your opponent's Active Pokémon is a Psychic Pokémon, this attack does 30 more damage.",
    );
    expect(glyph).not.toBeNull();
    expect(glyph).toEqual(name);
  });

  it("resolves EVERY member of POKEMON_TYPES in BOTH notations", () => {
    // Totality, so the map cannot rot the way a hand-kept alternation does. The
    // code map is already canonical against POKEMON_TYPES; this is the rung that
    // says the CLAUSE map inherited that.
    const CODE_OF: Readonly<Record<string, string>> = {
      Grass: "G",
      Fire: "R",
      Water: "W",
      Lightning: "L",
      Psychic: "P",
      Fighting: "F",
      Darkness: "D",
      Metal: "M",
      Fairy: "Y",
      Dragon: "N",
      Colorless: "C",
    };
    expect(POKEMON_TYPES).toHaveLength(11);
    for (const type of POKEMON_TYPES) {
      const code = CODE_OF[type];
      expect(code, type).toBeDefined();
      const byName = deriveAttackDamageBonus(
        `If your opponent's Active Pokémon is a ${type} Pokémon, this attack does 30 more damage.`,
      );
      const byCode = deriveAttackDamageBonus(
        `If your opponent's Active Pokémon is a {${String(code)}} Pokémon, this attack does 30 more damage.`,
      );
      expect(byName, type).not.toBeNull();
      expect(byCode, type).toEqual(byName);
      expect(byCode?.count, type).toEqual({
        kind: "boardCondition",
        cond: { kind: "opponentActiveHasType", type },
      });
    }
  });

  it("D387's literal row won its clause, and the TYPE MAP learned nothing from it", () => {
    expect(
      deriveAttackDamageBonus(
        "If you have any Stage 1 Pokémon on your Bench, this attack does 30 more damage.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a Stage 1 Pokémon, this attack does 30 more damage.",
      )?.count,
    ).toEqual({ kind: "boardCondition", cond: { kind: "opponentActiveIsStage1" } });
  });

  it("the pattern is still LOOSE and the MAP is still the vocabulary — non-types stay LOUD", () => {
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a Tera Pokémon, this attack does 30 more damage.",
      )?.count,
    ).toEqual({ kind: "boardCondition", cond: { kind: "opponentActiveIsBanner", banner: "Tera" } });
    for (const notAType of ["Stage 3", "Evolution", "{Z}", "{}", "constructor"]) {
      expect(
        deriveAttackDamageBonus(
          `If your opponent's Active Pokémon is a ${notAType} Pokémon, this attack does 30 more damage.`,
        ),
        notAType,
      ).toBeNull();
    }
  });
});

describe("§7 — the census moves in exactly ONE summand, and the other three are measured", () => {
  it("raw 1,207 → 1,220 → 1,223 and resolving sentences 335 → 344 → 345", () => {
    const resolved = corpus().filter(([, text]) => resolvedByAnyReader(text));
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
        2 -
        1 -
        2 -
        TAKEN.length -
        3 -
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
        1,
    ).toBe(355);
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
        3 -
        5 -
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
        3 -
        1 -
        1 -
        2 -
        1 -
        1 -
        6 -
        2 -
        3 -
        13 -
        3 -
        3 -
        2 -
        2 -
        2 -
        2 -
        2 -
        2 -
        2 -
        2,
    ).toBe(1233);
  });

  it("NONE of the thirteen ids is a registry ATTACK, so the +16 stands still", () => {
    const ids = new Set(programmedCardIds());
    expect(ids.size).toBe(1552);
    const present = TAKEN_IDS.filter((id) => ids.has(id));
    expect(present).toEqual(["sv06-009"]);
    expect(Object.keys(programFor("sv06-009") ?? {})).toEqual(["attackGate"]);
    for (const id of TAKEN_IDS) {
      expect(programFor(id)?.attack, id).toBeUndefined();
    }
  });

  it("the SPLIT summand cannot move either — no taken sentence carries a gate clause", () => {
    for (const [sentence] of TAKEN) {
      // Each resolves WHOLE, so it can never enter the split term, which is
      // "refused whole, resolved once the gate clause is taken off".
      expect(resolvedByAnyReader(sentence), sentence).toBe(true);
    }
  });
});
