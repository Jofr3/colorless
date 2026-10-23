import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import type { PokemonType } from "./effects";
import {
  POKEMON_TYPES,
  POKEMON_TYPE_BY_CODE,
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
import type { BoardCondition, GameEvent, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  BENCH_TYPE_DECK,
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
  deriveAttackCancelRequirement,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackBonusConsequent,
];

const TAKEN = "If you have any {M} Pokémon on your Bench, this attack does 80 more damage.";
const TAKEN_CLAUSE = "you have any {M} Pokémon on your Bench";

const TRAP = "If you have any Tera Pokémon on your Bench, this attack does 100 more damage.";
const TRAP_CLAUSE = "you have any Tera Pokémon on your Bench";

const METAL: BoardCondition = { kind: "yourBenchHasType", type: "Metal" };

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: BENCH_TYPE_DECK, p2: BENCH_TYPE_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** The seat's opposite. Spelled once here rather than imported, because the member
    is seat-relative and every board case below names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

function ready(seed: number, seat: Seat = "p1", attacker = "fix-benchtype"): GameState {
  let state = board(seed);
  if (seat === "p2") state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = setActiveFromDeck(state, seat, attacker);
  state = attachFromDeck(state, seat, "fix-energy", 1);
  state = setActiveFromDeck(state, other(seat), "fix-bigbody");
  return clearBench(clearBench(state, seat), other(seat));
}

function benched(state: GameState, seat: Seat, ...ids: readonly string[]): GameState {
  let next = state;
  for (const id of ids) next = benchFromDeck(next, seat, id);
  return next;
}

/** Attack index 0 from `seat` and report the damage actually dealt. */
function damageDealt(state: GameState, seat: Seat = "p1"): number {
  const after = mustApply(state, { type: "attack", seat, index: 0 });
  const dealt = after.events.find((e: GameEvent) => e.type === "DAMAGE_DEALT") as
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

describe("§1 — the price, RE-DERIVED: the `needs` column and the band, not the handoff's words", () => {
  it("D419 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the residue steps by exactly this sentence, and the 2-printing band by exactly one", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    // The DEPARTURE and the SIZE are asserted separately: a guard that only checked
    // 31 / 40 could not tell "the template landed" from "a reader broke".
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    expect(refused.length).toBe(0);
    expect(units(refused)).toBe(0);
    expect(refused.length + 23).toBe(23);
    expect(units(refused) + 27).toBe(27);
    expect(refused.length + 24).toBe(24);
    expect(units(refused) + 29).toBe(29);
    expect(refused.length + 25).toBe(25);
    expect(units(refused) + 32).toBe(32);
    expect(refused.length + 27).toBe(27);
    expect(units(refused) + 34).toBe(34);
    expect(refused.length + 28).toBe(28);
    expect(units(refused) + 36).toBe(36);
    expect(refused.length + 30).toBe(30);
    expect(units(refused) + 38).toBe(38);
    expect(refused.length + 31).toBe(31);
    expect(units(refused) + 40).toBe(40);
    expect(refused.length + 32).toBe(32);
    expect(units(refused) + 42).toBe(42);

    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    const band = [...byClause].filter(([, n]) => n === 2).map(([clause]) => clause);
    expect(band).toEqual([]);
    expect([...byClause.values()].filter((n) => n > 1)).toEqual([]);
    expect(byClause.size).toBe(0);
    expect(band.length + 2).toBe(2);
    expect(band.length + 3).toBe(3);
    expect(band.length + 4).toBe(4);
    expect(band.length + 5).toBe(5);
    expect(band.length + 6).toBe(6);
    expect(band.length + 7).toBe(7);
    expect(band.length + 8).toBe(8);
    expect([...byClause.values()]).toEqual([]);
  });

  it("the taken sentence is 2 legal printings, and that is ALL of them", () => {
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(2);
    expect(corpus().filter(([, s]) => s === TAKEN)).toHaveLength(1);
  });

  it("the `needs` column: NO existing member answers this, and the two near ones DISAGREE", () => {
    const state = benched(ready(6300), "p1", "fix-metalbody");
    expect(conditionHolds(state, "p1", METAL)).toBe(true);
    // Same FIELD, wrong body: the opponent's Active is `fix-bigbody`, Colorless.
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasType", type: "Metal" })).toBe(
      false,
    );
    // Same ZONE, wrong field: the benched body's NAME is not a type and never was.
    expect(conditionHolds(state, "p1", { kind: "yourBenchHasNamed", name: "Metal" })).toBe(false);
    // Same ZONE, no field at all — and a COUNT cannot stand in, which the next two
    // lines prove rather than assert: swap the benched body for a Fairy one and the
    // count is unchanged while this member flips.
    expect(conditionHolds(state, "p1", { kind: "yourBenchAtLeast", count: 1 })).toBe(true);
    const wrongType = benched(ready(6301), "p1", "fix-fairybody");
    expect(conditionHolds(wrongType, "p1", { kind: "yourBenchAtLeast", count: 1 })).toBe(true);
    expect(conditionHolds(wrongType, "p1", METAL)).toBe(false);
  });
});

describe("§2 — THE VOCABULARY CHECK, run FIRST: one token passes and its neighbour fails", () => {
  it("`{M}` resolves to a real `Card.types` value and `Tera` resolves to nothing", () => {
    expect(POKEMON_TYPE_BY_CODE.M).toBe("Metal");
    expect((POKEMON_TYPES as readonly string[]).includes("Metal")).toBe(true);
    // …and the banner sitting one token away is not in it, in EITHER notation.
    expect((POKEMON_TYPES as readonly string[]).includes("Tera")).toBe(false);
    expect(Object.values(POKEMON_TYPE_BY_CODE)).not.toContain("Tera");
  });

  it("both sentences are REAL and in the corpus — the trap is printed, not invented", () => {
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(2);
    expect(units(corpus().filter(([, s]) => s === TRAP))).toBe(1);
    // And they are the WHOLE population of this clause shape: the template's
    // vocabulary is the only thing standing between them.
    const shaped = corpus().filter(([, s]) =>
      /^If you have any .+ Pokémon on your Bench, /.test(s),
    );
    expect(shaped.map(([, s]) => s).sort()).toEqual([TRAP, TAKEN].sort());
  });

  it("D568 FLIPPED THE TRAP: the MAP still refuses `Tera` as a TYPE, and a LITERAL row now reads the sentence", () => {
    expect(BONUS.test(TRAP)).toBe(true);
    expect(deriveAttackDamageBonus(TRAP)).toEqual({
      per: 100,
      count: { kind: "boardCondition", cond: { kind: "yourBannerPokemonOnBench", banner: "Tera" } },
    });
    expect(resolvedByAnyReader(TRAP)).toBe(true);
    // …while the taken sentence, one token over, resolves.
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
    for (const type of POKEMON_TYPES) {
      expect(
        deriveAttackDamageBonus(
          `If you have any ${type} Pokémon on your Bench, this attack does 80 more damage.`,
        ),
        type,
      ).toEqual({
        per: 80,
        count: { kind: "boardCondition", cond: { kind: "yourBenchHasType", type } },
      });
    }
    for (const [code, type] of Object.entries(POKEMON_TYPE_BY_CODE)) {
      expect(
        deriveAttackDamageBonus(
          `If you have any {${code}} Pokémon on your Bench, this attack does 80 more damage.`,
        ),
        code,
      ).toEqual({
        per: 80,
        count: { kind: "boardCondition", cond: { kind: "yourBenchHasType", type } },
      });
    }
  });
});

describe("§3 — the template: N from the sentence, and a round trip across NOTATIONS", () => {
  it("maps the printed sentence onto the new member at the printed 80", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 80,
      count: { kind: "boardCondition", cond: METAL },
    });
  });

  it("takes N FROM THE SENTENCE, not from the card", () => {
    for (const per of [10, 30, 250]) {
      expect(
        deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does ${per} more damage.`),
      ).toEqual({ per, count: { kind: "boardCondition", cond: METAL } });
    }
    // A printed 0 adds nothing — the guard every arm in this family carries, so the
    // sentence stays LOUD rather than deriving a no-op bonus.
    expect(
      deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does 0 more damage.`),
    ).toBeNull();
  });

  it("`conditionNote` is NOT the clause key — and re-derives to the member anyway", () => {
    expect(conditionNote(METAL)).toBe("you have any Metal Pokémon on your Bench");
    expect(conditionNote(METAL)).not.toBe(TAKEN_CLAUSE);
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(METAL)}, this attack does 80 more damage.`)
        ?.count,
    ).toEqual({ kind: "boardCondition", cond: METAL });
    // And it holds for every type, both directions, which is what makes it a
    // property of the TEMPLATE rather than a fact about Metal.
    for (const type of POKEMON_TYPES) {
      const cond: BoardCondition = { kind: "yourBenchHasType", type };
      expect(
        deriveAttackDamageBonus(`If ${conditionNote(cond)}, this attack does 40 more damage.`)
          ?.count,
        type,
      ).toEqual({ kind: "boardCondition", cond });
    }
  });

  it("the SIBLING template's note was found NOT round-tripping to the bytes either", () => {
    const bracePrinted = corpus().filter(([, s]) =>
      /^If your opponent's Active Pokémon is a \{[A-Z]\} Pokémon, /.test(s),
    );
    expect(units(bracePrinted)).toBe(5);
    const braceBonus = bracePrinted.filter(([, s]) => BONUS.test(s.trim()));
    expect(units(braceBonus)).toBe(3);
    const cond: BoardCondition = { kind: "opponentActiveHasType", type: "Psychic" };
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a {P} Pokémon, this attack does 30 more damage.",
      ),
    ).toEqual({ per: 30, count: { kind: "boardCondition", cond } });
    // The note answers the NAME, not the printed glyph — right answer, stale claim.
    expect(conditionNote(cond)).toBe("your opponent's Active Pokémon is a Psychic Pokémon");
    expect(conditionNote(cond)).not.toContain("{P}");
    // …and re-derives to the same member, which is the claim that survived.
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(cond)}, this attack does 30 more damage.`)?.count,
    ).toEqual({ kind: "boardCondition", cond });
  });

  it("pins the BYTES — a lookalike character would un-map the clause silently", () => {
    // 75 code points; the clause inside it is 38. The é in "Pokémon" is the
    // character this rung exists for — two UTF-8 bytes, one code point, and a
    // decomposed spelling would read identically in a diff.
    expect(TAKEN.length).toBe(75);
    expect(TAKEN_CLAUSE.length).toBe(38);
    expect(TAKEN).toContain("é");
    expect(TAKEN).not.toContain("́");
    // The braces are the catalog's notation and are NOT regex syntax here — the
    // capture is `(.+)` and the map holds the literal `{M}`.
    expect(TAKEN_CLAUSE).toContain("{M}");
    expect(TAKEN).not.toContain("'");
    expect(TAKEN).not.toContain("’");
  });
});

describe("§4 — the near-misses stay LOUD, and the siblings are untouched", () => {
  it("refuses CONSTRUCTED rewrites of the clause — the shape is char-for-char", () => {
    expect(TRAP_CLAUSE).toBe("you have any Tera Pokémon on your Bench");
    for (const clause of [
      // Not a type at all, and each of these is a real printed word elsewhere.
      "you have any Basic Pokémon on your Bench",
      "you have any Stage 2 Pokémon on your Bench",
      "you have any Pokémon ex on your Bench",
      // The other ZONE — "in play" is `yourNamedPokemonInPlay`'s printed word, and
      // reading it here is the exact widening §5 refutes on a board.
      "you have any {M} Pokémon in play",
      // The other SEAT.
      "your opponent has any {M} Pokémon on your Bench",
      "you have any {M} Pokémon on your opponent's Bench",
      // A COUNT rather than an existential — a different member, unbuilt.
      "you have 2 or more {M} Pokémon on your Bench",
      // The Active Spot, which the printed word "Bench" excludes.
      "you have any {M} Pokémon in your Active Spot",
      // De-accented: the exact silent failure the byte guard above exists for.
      "you have any {M} Pokemon on your Bench",
      // The brace stripped — `M` alone is not a key in either half of the map.
      "you have any M Pokémon on your Bench",
      "you have any {M} Energy on your Bench",
    ]) {
      expect(
        deriveAttackDamageBonus(`If ${clause}, this attack does 80 more damage.`),
        clause,
      ).toBeNull();
    }
  });

  it("keeps the outer anchor guards on this sentence too", () => {
    for (const text of [
      // Lowercase leading "if" — the matcher has no /i.
      `if ${TAKEN_CLAUSE}, this attack does 80 more damage.`,
      // No trailing period is not the whole sentence.
      `If ${TAKEN_CLAUSE}, this attack does 80 more damage`,
      // A real trailing clause pins `$`.
      `If ${TAKEN_CLAUSE}, this attack does 80 more damage. Then, draw a card.`,
      // Leading text pins `^`.
      `Flip a coin. If ${TAKEN_CLAUSE}, this attack does 80 more damage.`,
      // The "×"/multiply twin, which `deriveAttackDamageMultiplier` owns.
      `If ${TAKEN_CLAUSE}, this attack does 80 damage.`,
    ]) {
      expect(deriveAttackDamageBonus(text), text).toBeNull();
    }
  });

  it("the two SIBLING templates still answer their own sentences — nothing was re-pointed", () => {
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon has any {R} Energy attached, this attack does 90 more damage.",
      ),
    ).toEqual({
      per: 90,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourActiveHasEnergyAttached", energy: "Fire" },
      },
    });
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a Dragon Pokémon, this attack does 90 more damage.",
      ),
    ).toEqual({
      per: 90,
      count: {
        kind: "boardCondition",
        cond: { kind: "opponentActiveHasType", type: "Dragon" },
      },
    });
    expect(
      deriveAttackDamageBonus("If Durant is on your Bench, this attack does 20 more damage."),
    ).toEqual({
      per: 20,
      count: { kind: "boardCondition", cond: { kind: "yourBenchHasNamed", name: "Durant" } },
    });
  });
});

describe("§5 — driven on boards: the Bench decides it, and the ACTIVE SPOT never does", () => {
  it("a {M} body on your Bench pays the +80 — 10 + 80", () => {
    const state = benched(ready(6310), "p1", "fix-metalbody");
    expect(damageDealt(state)).toBe(90);
  });

  it("an EMPTY Bench pays the printed base and nothing more", () => {
    const state = ready(6311);
    expect(state.players.p1.bench).toHaveLength(0);
    expect(conditionHolds(state, "p1", METAL)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("THE ATTACKER IS ITSELF {M} AND ARMS NOTHING — 'Bench' is not 'in play'", () => {
    const alone = ready(6312);
    const topUid = alone.players.p1.active?.stack.at(-1) ?? "";
    expect(alone.cardIdByUid[topUid]).toBe("fix-benchtype");
    expect(alone.players.p1.active?.stack).toHaveLength(1);
    expect(conditionHolds(alone, "p1", METAL)).toBe(false);
    expect(damageDealt(alone)).toBe(10);
    // …and the SAME board with a second Metal body benched pays the bonus, so the
    // false above is the ZONE and not a broken predicate.
    const paired = benched(ready(6313), "p1", "fix-metalbody");
    expect(conditionHolds(paired, "p1", METAL)).toBe(true);
    expect(damageDealt(paired)).toBe(90);
  });

  it("a DUAL-TYPED body arms it — `.includes`, never `types[0] ===`", () => {
    const state = benched(ready(6314), "p1", "fix-dualbody");
    expect(state.players.p1.bench[0]).toBeDefined();
    expect(conditionHolds(state, "p1", METAL)).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "yourBenchHasType", type: "Water" })).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "yourBenchHasType", type: "Fairy" })).toBe(false);
    expect(damageDealt(state)).toBe(90);
  });

  it("a REAL but WRONG type arms nothing, and neither does a DEFAULTED one", () => {
    // Two distinct false cases, because "no type written on the fixture" and "a type
    // written that does not match" are different boards: `fix-fairybody` is Fairy by
    // declaration and `fix-benchfiller` is Colorless by `printedTypesOf`'s default.
    const fairy = benched(ready(6315), "p1", "fix-fairybody");
    expect(conditionHolds(fairy, "p1", METAL)).toBe(false);
    expect(damageDealt(fairy)).toBe(10);
    const filler = benched(ready(6316), "p1", "fix-benchfiller");
    expect(conditionHolds(filler, "p1", METAL)).toBe(false);
    expect(conditionHolds(filler, "p1", { kind: "yourBenchHasType", type: "Colorless" })).toBe(
      true,
    );
    expect(damageDealt(filler)).toBe(10);
  });

  it("ONE match among many is enough — the printed word is 'any'", () => {
    // An existential over the whole Bench, not over slot 0: the Metal body is last.
    const state = benched(ready(6317), "p1", "fix-fairybody", "fix-benchfiller", "fix-metalbody");
    expect(state.players.p1.bench).toHaveLength(3);
    expect(conditionHolds(state, "p1", METAL)).toBe(true);
    expect(damageDealt(state)).toBe(90);
  });

  it("the identity is the STACK TOP (§1.2) — an evolved body stops arming it", () => {
    // `yourBenchHasNamed`'s rule, on the type field. A Metal body with a Fairy card
    // pushed on top is a FAIRY Pokémon; reading `stack[0]` would still answer Metal.
    let state = benched(ready(6318), "p1", "fix-metalbody");
    expect(conditionHolds(state, "p1", METAL)).toBe(true);
    state = pushOnBench(state, "p1", 0, "fix-fairybody");
    expect(state.players.p1.bench[0]?.stack).toHaveLength(2);
    expect(conditionHolds(state, "p1", METAL)).toBe(false);
    expect(conditionHolds(state, "p1", { kind: "yourBenchHasType", type: "Fairy" })).toBe(true);
    expect(damageDealt(state)).toBe(10);
  });

  it("it reads the OPPONENT's Bench as FALSE — the seat is half the member", () => {
    // A Metal body on the OTHER side of the table arms nothing. Without this the
    // predicate could be reading "either Bench" and every case above would pass.
    const state = benched(ready(6319), "p2", "fix-metalbody");
    expect(state.players.p2.bench).toHaveLength(1);
    expect(state.players.p1.bench).toHaveLength(0);
    expect(conditionHolds(state, "p1", METAL)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("answers from BOTH seats — it reads the Bench OF `seat`, not p1's", () => {
    // A p1-only suite cannot tell "reads YOUR Bench" apart from "reads p1's Bench".
    const state = benched(ready(6320, "p2"), "p2", "fix-metalbody");
    expect(damageDealt(state, "p2")).toBe(90);
    for (const seat of ["p1", "p2"] as const) {
      expect(conditionHolds(state, seat, METAL), seat).toBe(seat === "p2");
    }
  });

  it("the parameter is carried, not fixed — the same board answers 11 questions", () => {
    // The member is PARAMETERISED, so the board must answer differently per type.
    // Exactly one of the eleven is true on a single-Metal Bench.
    const state = benched(ready(6321), "p1", "fix-metalbody");
    const held = POKEMON_TYPES.filter((type: PokemonType) =>
      conditionHolds(state, "p1", { kind: "yourBenchHasType", type }),
    );
    expect(held).toEqual(["Metal"]);
  });
});

describe("§6 — the census, and a 2-printing sentence this slice found on the way past", () => {
  it("the corpus totals STAND STILL — this slice adds no catalog row", () => {
    expect(corpus().length).toBe(640);
    expect(units(corpus())).toBe(1732);
  });

  it("THE ANTECEDENT THIS FAMILY ALREADY READS IS PRINTED UNDER A CONSEQUENT D472 BUILT", () => {
    const statusFamily = corpus().filter(([, s]) =>
      /^If your opponent's Active Pokémon is a .+ Pokémon, it is now /.test(s),
    );
    expect(statusFamily).toHaveLength(1);
    expect(statusFamily[0]?.[1]).toBe(
      "If your opponent's Active Pokémon is a {N} Pokémon, it is now Paralyzed.",
    );
    expect(units(statusFamily)).toBe(2);
    const printed = statusFamily[0]?.[1] ?? "";
    // THE OWNER, BY NAME AND BY VALUE — not `not.toBeNull()`, which a wrong-but-shaped
    // program satisfies too.
    expect(deriveAttackEffect(printed)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveHasType", type: "Dragon" },
        ops: [{ op: "applyStatus", target: "defender", status: "paralyzed" }],
      },
    ]);
    for (const read of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(printed)).toBeNull();
    }
    // …and the antecedent inside it resolves TODAY, which is the half that is free.
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a {N} Pokémon, this attack does 30 more damage.",
      ),
    ).toEqual({
      per: 30,
      count: {
        kind: "boardCondition",
        cond: { kind: "opponentActiveHasType", type: "Dragon" },
      },
    });
  });
});
