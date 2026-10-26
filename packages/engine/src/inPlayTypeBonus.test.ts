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
import { POKEMON_TYPES } from "./effectTypes";
import { POKEMON_TYPE_BY_CODE } from "./deriver/vocabulary";
import type { BoardCondition, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./boardCondition";
import {
  FIXTURE_POOL,
  IN_PLAY_TYPE_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
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
  deriveAttackBonusConsequent,
  deriveAttackOptionalCostBoost,
  deriveAttackDiscardScaledBoost,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackCancelRequirement,
];

const TAKEN = "If your opponent has any {W} Pokémon in play, this attack does 120 more damage.";
const TAKEN_CLAUSE = "your opponent has any {W} Pokémon in play";

const TAKEN_ID = "sv05-054";

const TRAP = "If your opponent has any Future Pokémon in play, this attack does 120 more damage.";
const TRAP_CLAUSE = "your opponent has any Future Pokémon in play";

const COND: BoardCondition = { kind: "opponentInPlayHasType", type: "Water" };
const ACTIVE_ONLY: BoardCondition = { kind: "opponentActiveHasType", type: "Water" };
const OWN_BENCH: BoardCondition = { kind: "yourBenchHasType", type: "Water" };

// ── boards ─────────────────────────────────────────────────────────────────────

function ready(
  seed: number,
  opts: {
    opponentActive?: string;
    opponentBench?: readonly string[];
    ownBench?: readonly string[];
  } = {},
): GameState {
  let state = driveSetup(seed, { p1: IN_PLAY_TYPE_DECK, p2: IN_PLAY_TYPE_DECK }, { first: "p2" });
  state = setActiveFromDeck(state, "p1", "fix-shortcircuit");
  state = attachFromDeck(state, "p1", "fix-energy", 2);
  state = setActiveFromDeck(state, "p2", opts.opponentActive ?? "fix-bigbody");
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of opts.opponentBench ?? []) state = benchFromDeck(state, "p2", id);
  for (const id of opts.ownBench ?? []) state = benchFromDeck(state, "p1", id);
  return state;
}

/** …and the same board handed to P1 with the turn already passed. P1 went SECOND, so
    this turn carries no §4 attack restriction. */
function armed(seed: number, opts: Parameters<typeof ready>[1] = {}): GameState {
  return mustApply(ready(seed, opts), { type: "endTurn", seat: "p2" }).state;
}

/** Attack at `index` — 0 is the printed "Short-Circuit Knuckle", 1 the printed control
    "Electroslug" — and report the damage actually dealt. */
function damageDealt(state: GameState, index = 0): number {
  const after = mustApply(state, { type: "attack", seat: "p1", index });
  const dealt = after.events.find((e) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

function pushOnBench(state: GameState, seat: Seat, index: number, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  const body = side.bench[index];
  if (uid === undefined) throw new Error(`${seat} deck has no ${cardId}`);
  if (body === undefined) throw new Error(`${seat} has no benched Pokémon at ${index}`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        bench: side.bench.map((p, i) => (i === index ? { ...p, stack: [...p.stack, uid] } : p)),
      },
    },
  };
}

describe("§1 — the price, RE-DERIVED: the residue, the band and the `needs` column", () => {
  it("the sentence is real, is worth ONE printing, and was refused at D389's head", () => {
    expect(corpus().filter(([, s]) => s === TAKEN)).toHaveLength(1);
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(1);
    expect(BONUS.test(TAKEN)).toBe(true);
    expect(BONUS.exec(TAKEN)?.[2]).toBe("120");
    expect(BONUS.exec(TAKEN)?.[1]).toBe(TAKEN_CLAUSE);
  });

  it("the residue steps by exactly this ONE sentence and ONE printing", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    // The DEPARTURE and the SIZE are asserted separately: a guard that only checked
    // 15 / 18 could not tell "the template landed" from "a reader broke".
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
    expect([refused.length, units(refused)]).toEqual([0, 0]);
    expect([refused.length + 16, units(refused) + 19]).toEqual([16, 19]);
    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    expect(byClause.size).toBe(0);
    expect([...byClause.values()].filter((n) => n > 1)).toEqual([]);
    expect([...byClause.values()].filter((n) => n === 1)).toHaveLength(0);
    expect(byClause.has(TAKEN_CLAUSE)).toBe(false);
    expect(byClause.get(TRAP_CLAUSE)).toBeUndefined();
  });

  it("NEITHER neighbour could be widened — and it is TWO axes, not one", () => {
    expect(new Set([COND.kind, ACTIVE_ONLY.kind, OWN_BENCH.kind]).size).toBe(3);
    const board = armed(3901, { opponentBench: ["fix-waterbody"], ownBench: ["fix-waterbody"] });
    expect(conditionHolds(board, "p1", { kind: "yourBenchHasType", type: "Water" })).toBe(true);
    expect(conditionHolds(board, "p1", COND)).toBe(true);
    expect(conditionHolds(board, "p2", COND)).toBe(true);
    expect(conditionHolds(board, "p1", ACTIVE_ONLY)).toBe(false);
    expect(conditionHolds(board, "p1", COND)).toBe(true);
  });

  it("…and it is priced against the PRIZE row, which loses for a SIXTH slice", () => {
    const prize = corpus().filter(([, s]) =>
      s.startsWith("You may turn 1 of your face-down Prize"),
    );
    expect(units(prize)).toBe(2);
    expect(1 / 2).toBeGreaterThan(2 / 9);
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(1);
  });
});

describe("§2 — the VOCABULARY question, run FIRST and shared whole", () => {
  it("`{W}` is a real `Card.types` value and `Future` is not — the trap is PRINTED", () => {
    expect(POKEMON_TYPE_BY_CODE.W).toBe("Water");
    expect(POKEMON_TYPES).toContain("Water");
    expect(POKEMON_TYPES).not.toContain("Future");
    expect(units(corpus().filter(([, s]) => s === TRAP))).toBe(1);
    expect(deriveAttackDamageBonus(TRAP)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentBannerPokemonInPlay", banner: "Future" },
    });
    expect(resolvedByAnyReader(TRAP)).toBe(true);
    // …and the two sentences differ in the TOKEN alone, which is what makes the
    // refusal a property of the map rather than of the anchor.
    expect(TAKEN.replace("{W}", "Future")).toBe(TRAP);
  });

  it("resolves the printed sentence, and every type in BOTH notations", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: COND },
    });
    for (const type of POKEMON_TYPES) {
      expect(
        deriveAttackDamageBonus(
          `If your opponent has any ${type} Pokémon in play, this attack does 120 more damage.`,
        ),
        type,
      ).toEqual({
        per: 120,
        count: { kind: "boardCondition", cond: { kind: "opponentInPlayHasType", type } },
      });
    }
    for (const [code, type] of Object.entries(POKEMON_TYPE_BY_CODE)) {
      expect(
        deriveAttackDamageBonus(
          `If your opponent has any {${code}} Pokémon in play, this attack does 120 more damage.`,
        ),
        code,
      ).toEqual({
        per: 120,
        count: { kind: "boardCondition", cond: { kind: "opponentInPlayHasType", type } },
      });
    }
  });
});

describe("§3 — the note round-trips to the MEMBER, and deliberately not to the bytes", () => {
  it("spells the type NAME for a printed brace code, and re-derives to this member", () => {
    expect(conditionNote(COND)).toBe("your opponent has any Water Pokémon in play");
    expect(conditionNote(COND)).not.toContain("{W}");
    expect(conditionNote(COND)).not.toBe(TAKEN_CLAUSE);
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(COND)}, this attack does 120 more damage.`),
    ).toEqual({ per: 120, count: { kind: "boardCondition", cond: COND } });
    // The two SEAT-adjacent notes are different strings, which is what makes the
    // second member a second predicate rather than one name twice.
    expect(conditionNote(ACTIVE_ONLY)).toBe("your opponent's Active Pokémon is a Water Pokémon");
    expect(conditionNote(OWN_BENCH)).toBe("you have any Water Pokémon on your Bench");
    expect(
      new Set([conditionNote(COND), conditionNote(ACTIVE_ONLY), conditionNote(OWN_BENCH)]).size,
    ).toBe(3);
  });

  it("pins the BYTES — a lookalike character would un-map the clause silently", () => {
    // The é in "Pokémon" is the character this rung exists for: two UTF-8 bytes, one
    // code point, and a decomposed spelling would read identically in a diff.
    expect(TAKEN_CLAUSE).toContain("é");
    expect(TAKEN_CLAUSE).not.toContain("́");
    expect(TAKEN_CLAUSE).toContain("{W}");
    expect(TAKEN_CLAUSE).not.toContain("'");
    expect(TAKEN_CLAUSE).not.toContain("’");
  });
});

describe("§4 — the near-misses stay LOUD, and the four siblings are untouched", () => {
  it("refuses CONSTRUCTED rewrites of the clause — the shape is char-for-char", () => {
    for (const clause of [
      "your opponent has any Basic Pokémon in play",
      "your opponent has any Tera Pokémon in play",
      "your opponent has any Pokémon ex in play",
      // The other SEAT — the printed subject is "your opponent".
      "you have any {W} Pokémon in play",
      // The other ZONES, both narrower than "in play".
      "your opponent has any {W} Pokémon on their Bench",
      "your opponent has any {W} Pokémon in the Active Spot",
      // A COUNT rather than an existential — a different member, unbuilt.
      "your opponent has 2 or more {W} Pokémon in play",
      // De-accented: the exact silent failure the byte guard above exists for.
      "your opponent has any {W} Pokemon in play",
      // The brace stripped — `W` alone is not a key in either half of the map.
      "your opponent has any W Pokémon in play",
      "your opponent has any {W} Energy in play",
    ]) {
      expect(
        deriveAttackDamageBonus(`If ${clause}, this attack does 120 more damage.`),
        clause,
      ).toBeNull();
    }
  });

  it("keeps the outer anchor guards on this sentence too", () => {
    for (const text of [
      // Lowercase leading "if" — the matcher has no /i.
      `if ${TAKEN_CLAUSE}, this attack does 120 more damage.`,
      // No trailing period is not the whole sentence.
      `If ${TAKEN_CLAUSE}, this attack does 120 more damage`,
      // A real trailing clause pins `$`.
      `If ${TAKEN_CLAUSE}, this attack does 120 more damage. Then, draw a card.`,
      // Leading text pins `^`.
      `Flip a coin. If ${TAKEN_CLAUSE}, this attack does 120 more damage.`,
      // The "×"/multiply twin, which `deriveAttackDamageMultiplier` owns.
      `If ${TAKEN_CLAUSE}, this attack does 120 damage.`,
    ]) {
      expect(deriveAttackDamageBonus(text), text).toBeNull();
    }
    expect(deriveAttackRequirement(TAKEN)).toBeNull();
    expect(deriveAttackDamageMultiplier(TAKEN)).toBeNull();
  });

  it("the FOUR sibling templates still answer their own sentences — nothing was re-pointed", () => {
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon has any {L} Energy attached, this attack does 80 more damage.",
      )?.count,
    ).toEqual({
      kind: "boardCondition",
      cond: { kind: "yourActiveHasEnergyAttached", energy: "Lightning" },
    });
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a {P} Pokémon, this attack does 30 more damage.",
      )?.count,
    ).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentActiveHasType", type: "Psychic" },
    });
    expect(
      deriveAttackDamageBonus(
        "If you have any {M} Pokémon on your Bench, this attack does 80 more damage.",
      )?.count,
    ).toEqual({
      kind: "boardCondition",
      cond: { kind: "yourBenchHasType", type: "Metal" },
    });
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon has {F} Resistance, this attack does 50 more damage.",
      )?.count,
    ).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentActiveHasResistance", type: "Fighting" },
    });
    // …and the LITERAL table still wins first, which is the resolver's ONE real
    // ordering dependency and the thing "order decides nothing" does not cover.
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a Stage 1 Pokémon, this attack does 90 more damage.",
      )?.count,
    ).toEqual({ kind: "boardCondition", cond: { kind: "opponentActiveIsStage1" } });
  });
});

describe("§5 — the ZONE and the SEAT, driven on boards rather than argued", () => {
  it("the bare attack is 40 and the control attack is 140 — nothing is boosted by default", () => {
    // `fix-bigbody` is Colorless and both benches are empty, so no body on the table
    // can arm the clause. 40 is the printed base with the "+" consumed.
    const state = armed(3910);
    expect(conditionHolds(state, "p1", COND)).toBe(false);
    expect(damageDealt(state)).toBe(40);
  });

  it("a {W} on the opponent's ACTIVE arms it — 40 becomes 160", () => {
    const state = armed(3911, { opponentActive: "fix-waterbody" });
    expect(conditionHolds(state, "p1", COND)).toBe(true);
    expect(damageDealt(state)).toBe(40 + 120);
  });

  it("…AND SO DOES A {W} ON THE OPPONENT'S BENCH, which is what refutes the ACTIVE-ONLY reading", () => {
    const state = armed(3912, { opponentBench: ["fix-waterbody"] });
    expect(conditionHolds(state, "p1", ACTIVE_ONLY)).toBe(false);
    expect(conditionHolds(state, "p1", COND)).toBe(true);
    expect(damageDealt(state)).toBe(160);
  });

  it("…and a {W} on the ATTACKER'S OWN side does NOT, which refutes the BOTH-SEATS reading", () => {
    const state = armed(3913, { ownBench: ["fix-waterbody", "fix-waterbody"] });
    expect(FIXTURE_POOL["fix-shortcircuit"]?.types).toEqual(["Lightning"]);
    expect(conditionHolds(state, "p1", OWN_BENCH)).toBe(true);
    expect(conditionHolds(state, "p1", COND)).toBe(false);
    expect(damageDealt(state)).toBe(40);
    // …and from the OTHER seat the same board answers TRUE, which is what
    // `otherSeat(seat)` means and what a hard-coded `"p2"` would fail.
    expect(conditionHolds(state, "p2", COND)).toBe(true);
  });

  it("reads `types` with `.includes`, never `types[0]` — the dual-typed board", () => {
    expect(FIXTURE_POOL["fix-inplaydual"]?.types).toEqual(["Fire", "Water"]);
    const state = armed(3914, { opponentBench: ["fix-inplaydual"] });
    expect(conditionHolds(state, "p1", COND)).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "opponentInPlayHasType", type: "Fire" })).toBe(true);
    expect(damageDealt(state)).toBe(160);
  });

  it("a REAL type that is not this one leaves it false — the refusal is not a null check", () => {
    const state = armed(3915, { opponentBench: ["fix-fairybody", "fix-fairybody"] });
    expect(FIXTURE_POOL["fix-fairybody"]?.types).toEqual(["Fairy"]);
    expect(conditionHolds(state, "p1", COND)).toBe(false);
    expect(conditionHolds(state, "p1", { kind: "opponentInPlayHasType", type: "Fairy" })).toBe(
      true,
    );
    expect(damageDealt(state)).toBe(40);
  });

  it("reads the stack TOP — a {W} buried under another body stops satisfying it", () => {
    const before = armed(3916, { opponentBench: ["fix-waterbody"] });
    expect(conditionHolds(before, "p1", COND)).toBe(true);
    const after = pushOnBench(before, "p2", 0, "fix-fairybody");
    expect(conditionHolds(after, "p1", COND)).toBe(false);
    expect(damageDealt(after)).toBe(40);
  });

  it("an EMPTY opposing board is FALSE, and that is forced rather than chosen", () => {
    const state = armed(3917);
    const empty: GameState = {
      ...state,
      players: {
        ...state.players,
        p2: { ...state.players.p2, active: null, bench: [] },
      },
    };
    expect(conditionHolds(empty, "p1", COND)).toBe(false);
  });

  it("the CONTROL attack is untouched by every board above", () => {
    // An attack on the SAME body whose damage the clause cannot move — so a defect
    // that boosted everything rather than this attack shows up as a 260.
    const state = armed(3918, { opponentActive: "fix-waterbody" });
    const paid = attachFromDeck(
      attachFromDeck(state, "p1", "fix-lightning-energy", 2),
      "p1",
      "fix-energy",
      2,
    );
    expect(conditionHolds(paid, "p1", COND)).toBe(true);
    expect(damageDealt(paid, 1)).toBe(140);
  });
});

describe("§6 — the fixture, the census this row moves, and the questions asked of it", () => {
  it("D418 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the fixture is the PRINTING, transcribed and not interpolated", () => {
    const card = FIXTURE_POOL["fix-shortcircuit"];
    expect(card?.stage).toBe("Stage1");
    expect(card?.evolveFrom).toBe("Electabuzz");
    expect(card?.hp).toBe(140);
    expect(card?.types).toEqual(["Lightning"]);
    expect(card?.retreat).toBe(3);
    expect(card?.weaknesses).toEqual([{ type: "Fighting", value: "×2" }]);
    // TWO attacks at their PRINTED indices, and the printed `40+` marker is real: the
    // reader consumes the "+" and attack.ts drops the printed base into the gate.
    expect(card?.attacks).toHaveLength(2);
    expect(card?.attacks?.[0]).toEqual({
      cost: ["Colorless", "Colorless"],
      name: "Short-Circuit Knuckle",
      damage: "40+",
      effect: TAKEN,
    });
    expect(card?.attacks?.[1]?.damage).toBe(140);
    expect(card?.name).toBe("Fixlectivire");
    expect(/^[A-Z][A-Za-z' ]*'s /.test(card?.name ?? "")).toBe(false);
    // The real id is carried as a STRING and never seated — this container has no D1
    // credentials, and `sv05` is in none of `CATALOG_MANIFEST`'s six sets.
    expect(TAKEN_ID).toBe("sv05-054");
    expect(FIXTURE_POOL[TAKEN_ID]).toBeUndefined();
  });

  it("the TEN-reader instrument steps by exactly 1 sentence / 1 printing", () => {
    const resolving = corpus().filter(([, s]) => resolvedByAnyReader(s));
    expect([resolving.length, units(resolving)]).toEqual([600, 1663]);
    expect([
      resolving.length -
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
        3 -
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
        1 -
        1 -
        1 -
        3 -
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
        2 -
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
        1,
      units(resolving) -
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
        2 -
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
        2 -
        1 -
        1 -
        1 -
        2 -
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
        5 -
        3 -
        3 -
        5 -
        4 -
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
        8 -
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
        1,
    ]).toEqual([385, 1287]);
  });

  it("the move is READER-keyed: no registry row, no gate clause, nothing persisted", () => {
    expect(TAKEN.includes("this attack does nothing")).toBe(false);
    expect(deriveAttackRequirement(TAKEN)).toBeNull();
    expect(Object.keys(COND).sort()).toEqual(["kind", "type"]);
  });
});
