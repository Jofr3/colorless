import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import type { PokemonType } from "./effectTypes";
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
import type { BoardCondition, GameEvent, GameState, Seat } from "./index";
import { resistanceOf, weaknessOf } from "./index";
import { conditionHolds, conditionNote } from "./boardCondition";
import {
  FIXTURE_POOL,
  OPPONENT_RESISTANCE_DECK,
  attachFromDeck,
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

const TAKEN =
  "If your opponent's Active Pokémon has {F} Resistance, this attack does 50 more damage.";
const TAKEN_CLAUSE = "your opponent's Active Pokémon has {F} Resistance";

const FIGHTING: BoardCondition = { kind: "opponentActiveHasResistance", type: "Fighting" };

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: OPPONENT_RESISTANCE_DECK, p2: OPPONENT_RESISTANCE_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** The seat's opposite. Spelled once here rather than imported, because the member
    is seat-relative and every board case below names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

function ready(
  seed: number,
  defender: string,
  attacker = "fix-oppresist",
  seat: Seat = "p1",
): GameState {
  let state = board(seed);
  if (seat === "p2") state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = setActiveFromDeck(state, seat, attacker);
  state = attachFromDeck(state, seat, "fix-energy", 1);
  state = setActiveFromDeck(state, other(seat), defender);
  return clearBench(clearBench(state, seat), other(seat));
}

/** Attack index 0 from `seat` and report the damage actually dealt. */
function damageDealt(state: GameState, seat: Seat = "p1"): number {
  const after = mustApply(state, { type: "attack", seat, index: 0 });
  const dealt = after.events.find((e: GameEvent) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

function pushOnActive(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  const body = side.active;
  if (uid === undefined) throw new Error(`${seat} deck has no ${cardId}`);
  if (body === null) throw new Error(`${seat} has no Active Pokémon`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        active: { ...body, stack: [...body.stack, uid] },
      },
    },
  };
}

/** TEST SURGERY: empty an Active Spot. No legal action reaches this board — a seat
    with no Active has lost — but the member commits to answering FALSE there, and
    a commitment nothing drives is a comment. */
function emptyActive(state: GameState, seat: Seat): GameState {
  return {
    ...state,
    players: { ...state.players, [seat]: { ...state.players[seat], active: null } },
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
    // 30 / 38 could not tell "the template landed" from "a reader broke".
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
    expect([...byClause.values()]).toEqual([]);
  });

  it("the taken sentence is 2 legal printings, and that is ALL of them", () => {
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(2);
    expect(corpus().filter(([, s]) => s === TAKEN)).toHaveLength(1);
    const shaped = corpus().filter(([, s]) =>
      /^If your opponent's Active Pokémon has .+ Resistance, /.test(s),
    );
    expect(shaped.map(([, s]) => s)).toEqual([TAKEN]);
  });

  it("the `needs` column: NO member of this union reads a printed DEFENSIVE column", () => {
    const state = ready(7100, "fix-fightresist");
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasType", type: "Fighting" })).toBe(
      false,
    );
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasType", type: "Colorless" })).toBe(
      true,
    );
    // Same body, the attachment members: nothing is attached across the table.
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasToolAttached" })).toBe(false);
    // Same body, the class members: a plain Basic, neither ex nor V nor Evolution.
    expect(conditionHolds(state, "p1", { kind: "opponentActiveIsExOrV" })).toBe(false);
    expect(conditionHolds(state, "p1", { kind: "opponentActiveIsEvolution" })).toBe(false);
    // And the WEAKNESS column, one field over in the same schema, is the near miss
    // a wrong transcription lands on — `fix-fightweak` separates them below (§5).
    const weak = ready(7101, "fix-fightweak");
    expect(conditionHolds(weak, "p1", FIGHTING)).toBe(false);
  });
});

describe("§2 — THE SUPPLY CHECK, run FIRST: the column exists, and the floor is a FLOOR", () => {
  it("`Card.resistances` is a real ingested column the engine already reads", () => {
    const body = FIXTURE_POOL["fix-fightresist"];
    expect(body?.resistances).toEqual([{ type: "Fighting", value: "-30" }]);
    expect(typeof resistanceOf).toBe("function");
  });

  it("the population is a FLOOR on a BIASED SAMPLE and is not promoted to a census", () => {
    const ids = Object.keys(FIXTURE_POOL);
    const withResistance = ids.filter((id) => (FIXTURE_POOL[id]?.resistances ?? []).length > 0);
    const fighting = ids.filter((id) =>
      (FIXTURE_POOL[id]?.resistances ?? []).some((r) => r.type === "Fighting"),
    );
    expect(ids).toHaveLength(573);
    expect(withResistance).toHaveLength(28);
    expect(fighting).toHaveLength(18);
    expect(
      ids.length -
        1 -
        5 -
        4 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        3 -
        1 -
        3 -
        3 -
        1 -
        2 -
        3 -
        3 -
        1 -
        5 -
        2 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        2 -
        2 -
        2 -
        1 -
        1 -
        2 -
        2 -
        4 -
        3 -
        2 -
        3 -
        1 -
        3 -
        3 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1,
    ).toBe(468);
    expect(
      ids.length -
        1 -
        5 -
        4 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        3 -
        1 -
        3 -
        3 -
        1 -
        2 -
        3 -
        3 -
        1 -
        5 -
        2 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        2 -
        2 -
        2 -
        1 -
        1 -
        2 -
        2 -
        4 -
        3 -
        2 -
        3 -
        1 -
        3 -
        3 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2,
    ).toBe(466);
    expect(
      ids.length -
        1 -
        5 -
        4 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        3 -
        1 -
        3 -
        3 -
        1 -
        2 -
        3 -
        3 -
        1 -
        5 -
        2 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        2 -
        2 -
        2 -
        1 -
        1 -
        2 -
        2 -
        4 -
        3 -
        2 -
        3 -
        1 -
        3 -
        3 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1,
    ).toBe(465);
    expect(
      ids.length -
        1 -
        5 -
        4 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        3 -
        1 -
        3 -
        3 -
        1 -
        2 -
        3 -
        3 -
        1 -
        5 -
        2 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        2 -
        2 -
        2 -
        1 -
        1 -
        2 -
        2 -
        4 -
        3 -
        2 -
        3 -
        1 -
        3 -
        3 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        2,
    ).toBe(463);
    expect(
      ids.length -
        1 -
        5 -
        4 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        3 -
        1 -
        3 -
        3 -
        1 -
        2 -
        3 -
        3 -
        1 -
        5 -
        2 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        2 -
        2 -
        2 -
        1 -
        1 -
        2 -
        2 -
        4 -
        3 -
        2 -
        3 -
        1 -
        3 -
        3 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        2 -
        3,
    ).toBe(460);
    expect(
      ids.length -
        1 -
        5 -
        4 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        3 -
        1 -
        3 -
        3 -
        1 -
        2 -
        3 -
        3 -
        1 -
        5 -
        2 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        2 -
        2 -
        2 -
        1 -
        1 -
        2 -
        2 -
        4 -
        3 -
        2 -
        3 -
        1 -
        3 -
        3 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        2 -
        3 -
        1,
    ).toBe(459);
    expect(
      ids.length -
        1 -
        5 -
        4 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        3 -
        1 -
        3 -
        3 -
        1 -
        2 -
        3 -
        3 -
        1 -
        5 -
        2 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        2 -
        2 -
        2 -
        1 -
        1 -
        2 -
        2 -
        4 -
        3 -
        2 -
        3 -
        1 -
        3 -
        3 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        2 -
        3 -
        1 -
        2,
    ).toBe(457);
    expect(
      ids.length -
        1 -
        5 -
        4 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        3 -
        1 -
        3 -
        3 -
        1 -
        2 -
        3 -
        3 -
        1 -
        5 -
        2 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        2 -
        2 -
        2 -
        1 -
        1 -
        2 -
        2 -
        4 -
        3 -
        2 -
        3 -
        1 -
        3 -
        3 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        2 -
        3 -
        1 -
        2 -
        3,
    ).toBe(454);
    expect(
      ids.length -
        1 -
        5 -
        4 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        3 -
        1 -
        3 -
        3 -
        1 -
        2 -
        3 -
        3 -
        1 -
        5 -
        2 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        2 -
        2 -
        2 -
        1 -
        1 -
        2 -
        2 -
        4 -
        3 -
        2 -
        3 -
        1 -
        3 -
        3 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        2 -
        3 -
        1 -
        2 -
        3 -
        1,
    ).toBe(453);
    expect(
      ids.length -
        1 -
        5 -
        4 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        3 -
        1 -
        3 -
        3 -
        1 -
        2 -
        3 -
        3 -
        1 -
        5 -
        2 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        2 -
        2 -
        2 -
        1 -
        1 -
        2 -
        2 -
        4 -
        3 -
        2 -
        3 -
        1 -
        3 -
        3 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        2 -
        3 -
        1 -
        2 -
        3 -
        1 -
        3,
    ).toBe(450);
    expect(
      ids.length -
        1 -
        5 -
        4 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        3 -
        1 -
        3 -
        3 -
        1 -
        2 -
        3 -
        3 -
        1 -
        5 -
        2 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        2 -
        2 -
        2 -
        2 -
        1 -
        1 -
        2 -
        2 -
        4 -
        3 -
        2 -
        3 -
        1 -
        3 -
        3 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        2 -
        3 -
        1 -
        2 -
        3 -
        1 -
        3 -
        6,
    ).toBe(444);
    expect(withResistance.length - 3 - 1).toBe(24);
    expect(fighting.length - 2).toBe(16);
  });

  it("the VOCABULARY half is inherited, not re-run: `{F}` is a real `Card.types` value", () => {
    expect(POKEMON_TYPE_BY_CODE.F).toBe("Fighting");
    expect((POKEMON_TYPES as readonly string[]).includes("Fighting")).toBe(true);
  });
});

describe("§3 — the template: N from the sentence, and a round trip across NOTATIONS", () => {
  it("maps the printed sentence onto the new member at the printed 50", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 50,
      count: { kind: "boardCondition", cond: FIGHTING },
    });
  });

  it("takes N FROM THE SENTENCE, not from the card", () => {
    for (const per of [10, 30, 250]) {
      expect(
        deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does ${per} more damage.`),
      ).toEqual({ per, count: { kind: "boardCondition", cond: FIGHTING } });
    }
    // A printed 0 adds nothing — the guard every arm in this family carries, so the
    // sentence stays LOUD rather than deriving a no-op bonus.
    expect(
      deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does 0 more damage.`),
    ).toBeNull();
  });

  it("the MAP is the vocabulary, not the regex — all 22 spellings resolve", () => {
    for (const type of POKEMON_TYPES) {
      expect(
        deriveAttackDamageBonus(
          `If your opponent's Active Pokémon has ${type} Resistance, this attack does 50 more damage.`,
        ),
        type,
      ).toEqual({
        per: 50,
        count: {
          kind: "boardCondition",
          cond: { kind: "opponentActiveHasResistance", type },
        },
      });
    }
    for (const [code, type] of Object.entries(POKEMON_TYPE_BY_CODE)) {
      expect(
        deriveAttackDamageBonus(
          `If your opponent's Active Pokémon has {${code}} Resistance, this attack does 50 more damage.`,
        ),
        code,
      ).toEqual({
        per: 50,
        count: {
          kind: "boardCondition",
          cond: { kind: "opponentActiveHasResistance", type },
        },
      });
    }
  });

  it("`conditionNote` is NOT the clause key — and re-derives to the member anyway", () => {
    expect(conditionNote(FIGHTING)).toBe("your opponent's Active Pokémon has Fighting Resistance");
    expect(conditionNote(FIGHTING)).not.toBe(TAKEN_CLAUSE);
    expect(conditionNote(FIGHTING)).not.toContain("{F}");
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(FIGHTING)}, this attack does 50 more damage.`)
        ?.count,
    ).toEqual({ kind: "boardCondition", cond: FIGHTING });
    // And it holds for every type, both directions, which is what makes it a
    // property of the TEMPLATE rather than a fact about Fighting.
    for (const type of POKEMON_TYPES) {
      const cond: BoardCondition = { kind: "opponentActiveHasResistance", type };
      expect(
        deriveAttackDamageBonus(`If ${conditionNote(cond)}, this attack does 40 more damage.`)
          ?.count,
        type,
      ).toEqual({ kind: "boardCondition", cond });
    }
  });

  it("the APOSTROPHE class is load-bearing HERE in a way it was not for D370", () => {
    const curly = TAKEN.replace("opponent's", "opponent’s");
    expect(curly).not.toBe(TAKEN);
    expect(curly).toContain("’");
    expect(deriveAttackDamageBonus(curly)).toEqual({
      per: 50,
      count: { kind: "boardCondition", cond: FIGHTING },
    });
    expect(deriveAttackDamageBonus(curly)).toEqual(deriveAttackDamageBonus(TAKEN));
  });

  it("pins the BYTES — a lookalike character would un-map the clause silently", () => {
    // 86 code points; the clause inside it is 49. The é in "Pokémon" is the
    // character this rung exists for — two UTF-8 bytes, one code point, and a
    // decomposed spelling would read identically in a diff.
    expect(TAKEN.length).toBe(86);
    expect(TAKEN_CLAUSE.length).toBe(49);
    expect(TAKEN).toContain("é");
    expect(TAKEN).not.toContain("́");
    // The braces are the catalog's notation and are NOT regex syntax here — the
    // capture is `(.+)` and the map holds the literal `{F}`.
    expect(TAKEN_CLAUSE).toContain("{F}");
    expect(TAKEN).toContain("'");
    expect(TAKEN).not.toContain("’");
    // "Resistance" is CAPITALISED as printed, and the matcher has no /i.
    expect(TAKEN_CLAUSE.endsWith(" Resistance")).toBe(true);
  });
});

describe("§4 — the near-misses stay LOUD, and the siblings are untouched", () => {
  it("refuses CONSTRUCTED rewrites of the clause — the shape is char-for-char", () => {
    for (const clause of [
      "your opponent's Active Pokémon has {F} Weakness",
      "your opponent's Active Pokémon has Fighting Weakness",
      // Not a type at all — each of these reaches the map and misses it.
      "your opponent's Active Pokémon has Tera Resistance",
      "your opponent's Active Pokémon has Basic Resistance",
      "your opponent's Active Pokémon has any Resistance",
      "your opponent's Active Pokémon has no Resistance",
      // The other SEAT and the other ZONE.
      "your Active Pokémon has {F} Resistance",
      "this Pokémon has {F} Resistance",
      "any of your opponent's Benched Pokémon has {F} Resistance",
      "your opponent's Active Pokémon has {F} resistance",
      // De-accented: the exact silent failure the byte guard above exists for.
      "your opponent's Active Pokemon has {F} Resistance",
      // The brace stripped — `F` alone is not a key in either half of the map.
      "your opponent's Active Pokémon has F Resistance",
      // The §8.5 phrasing, which is a modifier and not a board fact.
      "your opponent's Active Pokémon has -30 Fighting Resistance",
    ]) {
      expect(
        deriveAttackDamageBonus(`If ${clause}, this attack does 50 more damage.`),
        clause,
      ).toBeNull();
    }
  });

  it("keeps the outer anchor guards on this sentence too", () => {
    for (const text of [
      // Lowercase leading "if" — the matcher has no /i.
      `if ${TAKEN_CLAUSE}, this attack does 50 more damage.`,
      // No trailing period is not the whole sentence.
      `If ${TAKEN_CLAUSE}, this attack does 50 more damage`,
      // A real trailing clause pins `$`.
      `If ${TAKEN_CLAUSE}, this attack does 50 more damage. Then, draw a card.`,
      // Leading text pins `^`.
      `Flip a coin. If ${TAKEN_CLAUSE}, this attack does 50 more damage.`,
      // The "×"/multiply twin, which `deriveAttackDamageMultiplier` owns.
      `If ${TAKEN_CLAUSE}, this attack does 50 damage.`,
    ]) {
      expect(deriveAttackDamageBonus(text), text).toBeNull();
    }
  });

  it("the three SIBLING templates still answer their own sentences — nothing was re-pointed", () => {
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
      count: { kind: "boardCondition", cond: { kind: "opponentActiveHasType", type: "Dragon" } },
    });
    expect(
      deriveAttackDamageBonus(
        "If you have any {M} Pokémon on your Bench, this attack does 80 more damage.",
      ),
    ).toEqual({
      per: 80,
      count: { kind: "boardCondition", cond: { kind: "yourBenchHasType", type: "Metal" } },
    });
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon has a Pokémon Tool attached, this attack does 80 more damage.",
      ),
    ).toEqual({
      per: 80,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveHasToolAttached" } },
    });
  });
});

describe("§5 — driven on boards: the printed COLUMN decides it, and `resistanceOf` never does", () => {
  it("A METAL ATTACKER, A FIGHTING-RESISTANT DEFENDER — the clause is TRUE and §8.5 is NULL", () => {
    const state = ready(7110, "fix-fightresist");
    const attacker = FIXTURE_POOL["fix-oppresist"];
    const defender = FIXTURE_POOL["fix-fightresist"];
    if (attacker === undefined || defender === undefined) throw new Error("fixture missing");
    // The helper, asked directly: NULL, because Metal is not Fighting.
    expect(attacker.types).toEqual(["Metal"]);
    expect(resistanceOf(attacker, defender)).toBeNull();
    // The member, asked on the same board: TRUE.
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(true);
    // …and the dealt number is the difference between the two readings. 10 + 50,
    // with no §8.5 subtraction because the helper is null. A member routed through
    // `resistanceOf` pays 10 here, which is what makes this rung able to go RED.
    expect(damageDealt(state)).toBe(60);
  });

  it("the SAME attack on a FIGHTING body: both fire, and the numbers stack", () => {
    const state = ready(7111, "fix-fightresist", "fix-oppresist-f");
    const attacker = FIXTURE_POOL["fix-oppresist-f"];
    const defender = FIXTURE_POOL["fix-fightresist"];
    if (attacker === undefined || defender === undefined) throw new Error("fixture missing");
    expect(attacker.types).toEqual(["Fighting"]);
    expect(resistanceOf(attacker, defender)).toEqual({ op: "subtract", amount: 30 });
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(true);
    expect(damageDealt(state)).toBe(30);
  });

  it("a body with NO Resistance column pays the printed base and nothing more", () => {
    const state = ready(7112, "fix-bigbody");
    expect(FIXTURE_POOL["fix-bigbody"]?.resistances).toBeNull();
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("a REAL Resistance of the WRONG type arms nothing — two distinct false boards", () => {
    const state = ready(7113, "fix-grassresist");
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(false);
    // …and the member is PARAMETERISED, so the same board answers TRUE one token
    // over. Without this line the false above could be a broken predicate.
    expect(
      conditionHolds(state, "p1", { kind: "opponentActiveHasResistance", type: "Grass" }),
    ).toBe(true);
    expect(damageDealt(state)).toBe(10);
  });

  it("a FIGHTING WEAKNESS arms nothing — the column one field over, driven", () => {
    const state = ready(7114, "fix-fightweak");
    const defender = FIXTURE_POOL["fix-fightweak"];
    if (defender === undefined) throw new Error("fixture missing");
    expect(defender.weaknesses).toEqual([{ type: "Fighting", value: "×2" }]);
    expect(defender.resistances).toBeNull();
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("…and that Weakness column is LIVE, so the false above is not an inert fixture", () => {
    const state = ready(7115, "fix-fightweak", "fix-oppresist-f");
    const attacker = FIXTURE_POOL["fix-oppresist-f"];
    const defender = FIXTURE_POOL["fix-fightweak"];
    if (attacker === undefined || defender === undefined) throw new Error("fixture missing");
    expect(weaknessOf(attacker, defender)).toEqual({ op: "multiply", amount: 2 });
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(false);
    expect(damageDealt(state)).toBe(20);
  });

  it("TWO entries, the match SECOND and VALUE-LESS — `.some`, and `type` alone", () => {
    const state = ready(7116, "fix-dualresist");
    const defender = FIXTURE_POOL["fix-dualresist"];
    if (defender === undefined) throw new Error("fixture missing");
    expect(defender.resistances).toEqual([{ type: "Grass", value: "-30" }, { type: "Fighting" }]);
    expect(defender.resistances?.[1]?.value).toBeUndefined();
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(true);
    expect(
      conditionHolds(state, "p1", { kind: "opponentActiveHasResistance", type: "Grass" }),
    ).toBe(true);
    expect(damageDealt(state)).toBe(60);
  });

  it("the identity is the STACK TOP — an evolved body answers with the top card's column", () => {
    let state = ready(7117, "fix-fightresist");
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(true);
    state = pushOnActive(state, "p2", "fix-bigbody");
    expect(state.players.p2.active?.stack).toHaveLength(2);
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("it reads the OPPONENT's Active — the seat is half the member", () => {
    const mirror = clearBench(
      setActiveFromDeck(ready(7118, "fix-bigbody"), "p1", "fix-fightresist"),
      "p1",
    );
    expect(mirror.players.p1.active).not.toBeNull();
    expect(conditionHolds(mirror, "p1", FIGHTING)).toBe(false);
    // …and from p2, whose OPPONENT is the seat now holding it, TRUE. Same board,
    // opposite answers, so the false above is the SEAT and not a dead predicate.
    expect(conditionHolds(mirror, "p2", FIGHTING)).toBe(true);
    // The ordinary orientation, for the same pair of answers the other way round.
    const state = ready(7119, "fix-fightresist");
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(true);
    expect(conditionHolds(state, "p2", FIGHTING)).toBe(false);
  });

  it("answers from BOTH seats — it reads the opponent OF `seat`, not p1's", () => {
    // A p1-only suite cannot tell "reads YOUR OPPONENT's Active" apart from "reads
    // p2's Active". P2 attacks here, and pays the bonus.
    const state = ready(7120, "fix-fightresist", "fix-oppresist", "p2");
    expect(damageDealt(state, "p2")).toBe(60);
    for (const seat of ["p1", "p2"] as const) {
      expect(conditionHolds(state, seat, FIGHTING), seat).toBe(seat === "p2");
    }
  });

  it("an EMPTY Active Spot is FALSE, not a throw", () => {
    // The commitment every card-reading member in this union makes, driven rather
    // than commented. No legal action reaches this board, so the surgery is local.
    const state = emptyActive(ready(7121, "fix-fightresist"), "p2");
    expect(state.players.p2.active).toBeNull();
    expect(conditionHolds(state, "p1", FIGHTING)).toBe(false);
  });

  it("the parameter is carried, not fixed — the same board answers 11 questions", () => {
    // The member is PARAMETERISED, so the board must answer differently per type.
    // Exactly one of the eleven is true against a single-entry Fighting Resistance.
    const state = ready(7122, "fix-fightresist");
    const held = POKEMON_TYPES.filter((type: PokemonType) =>
      conditionHolds(state, "p1", { kind: "opponentActiveHasResistance", type }),
    );
    expect(held).toEqual(["Fighting"]);
  });
});

describe("§6 — the census stands still", () => {
  it("the corpus totals STAND STILL — this slice adds no catalog row", () => {
    expect(corpus().length).toBe(640);
    expect(units(corpus())).toBe(1732);
  });
});
