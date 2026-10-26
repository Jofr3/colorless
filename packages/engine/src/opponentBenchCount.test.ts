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
import type { BoardCondition, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./boardCondition";
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  OPPONENT_BENCH_COUNT_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setDamage,
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
const resolvedByNine = (text: string): boolean =>
  READERS.slice(0, 9).some((read) => read(text) !== null);

const TAKEN = "If your opponent has 3 or more Benched Pokémon, this attack does 80 more damage.";

const TAKEN_ID = "sv08-132";

const SIBLING = "If you have 4 or fewer Benched Pokémon, this attack does nothing.";

const COND: BoardCondition = { kind: "opponentBenchAtLeast", count: 3 };
const TWIN: BoardCondition = { kind: "yourBenchAtLeast", count: 3 };

const SEAT_PAIRS: readonly (readonly [BoardCondition, BoardCondition])[] = [
  [{ kind: "yourActiveDamaged" }, { kind: "opponentActiveDamaged" }],
  [{ kind: "yourActivePoisoned" }, { kind: "opponentActivePoisoned" }],
  [{ kind: "yourActiveHasToolAttached" }, { kind: "opponentActiveHasToolAttached" }],
];

// ── boards ─────────────────────────────────────────────────────────────────────

function ready(seed: number, opponentBench: number, ownBench = 0): GameState {
  let state = driveSetup(
    seed,
    { p1: OPPONENT_BENCH_COUNT_DECK, p2: OPPONENT_BENCH_COUNT_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p1", "fix-deletingslash");
  state = attachFromDeck(state, "p1", "fix-metal-energy", 1);
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(clearBench(state, "p1"), "p2");
  for (let i = 0; i < opponentBench; i += 1) state = benchFromDeck(state, "p2", "fix-benchfiller");
  for (let i = 0; i < ownBench; i += 1) state = benchFromDeck(state, "p1", "fix-benchfiller");
  return state;
}

/** …and the same board handed to P1 with the turn already passed. P1 went SECOND,
    so this turn carries no §4 attack restriction. */
function armed(seed: number, opponentBench: number, ownBench = 0): GameState {
  return mustApply(ready(seed, opponentBench, ownBench), { type: "endTurn", seat: "p2" }).state;
}

/** Attack at `index` — 0 is the printed "Deleting Slash", 1 the printed control
    "Slicing Blade" — and report the damage actually dealt. */
function damageDealt(state: GameState, index = 0): number {
  const after = mustApply(state, { type: "attack", seat: "p1", index });
  const dealt = after.events.find((e) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

const benchOf = (state: GameState, seat: Seat): number => state.players[seat].bench.length;

describe("§1 — the SHAPE question: a SECOND MEMBER, and the price re-measured", () => {
  it("the sentence is real, is worth ONE printing, and was refused at D388's head", () => {
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(1);
    expect(corpus().filter(([, s]) => s === TAKEN)).toHaveLength(1);
    expect(BONUS.test(TAKEN)).toBe(true);
    expect(BONUS.exec(TAKEN)?.[2]).toBe("80");
    // The clause is what the table is keyed on, and it is the printed bytes between
    // the leading "If " and the ", this attack does".
    expect(BONUS.exec(TAKEN)?.[1]).toBe("your opponent has 3 or more Benched Pokémon");
  });

  it("⑴ the union already answers the SEAT question three times — and never with a field", () => {
    // The precedent, driven as VALUES rather than quoted from a doc block: three
    // pairs, six distinct members, six DISTINCT notes. Collapsing any pair into a
    // seat parameter deletes a member kind, and this table stops compiling.
    const notes = new Set<string>();
    for (const [own, far] of SEAT_PAIRS) {
      expect(own.kind, far.kind).not.toBe(far.kind);
      notes.add(conditionNote(own));
      notes.add(conditionNote(far));
    }
    expect(notes.size).toBe(6);
    expect(COND.kind).not.toBe(TWIN.kind);
    expect(conditionNote(COND)).not.toBe(conditionNote(TWIN));
    // The seat-alone claim is not decoration: on ONE board each pair DISAGREES,
    // which is what makes the two members two predicates and not one name twice.
    // Damage is the cheapest of the three to build, so it is the one driven here.
    const damaged = setDamage(ready(3101, 0), "p2", 50);
    expect(conditionHolds(damaged, "p1", { kind: "yourActiveDamaged" })).toBe(false);
    expect(conditionHolds(damaged, "p1", { kind: "opponentActiveDamaged" })).toBe(true);
    // …and from the other seat the two answers swap, which is what "seat-relative"
    // means and what a hard-coded `"p2"` would fail.
    expect(conditionHolds(damaged, "p2", { kind: "yourActiveDamaged" })).toBe(true);
    expect(conditionHolds(damaged, "p2", { kind: "opponentActiveDamaged" })).toBe(false);
  });

  it("⑵ every live consumer of the SHIPPED member still answers — a re-pointing was a RENAME", () => {
    expect(deriveAttackRequirement(SIBLING)).toEqual({ kind: "yourBenchAtLeast", count: 5 });
    const five = armed(3102, 0, 5);
    expect(benchOf(five, "p1")).toBe(5);
    expect(conditionHolds(five, "p1", { kind: "yourBenchAtLeast", count: 5 })).toBe(true);
    expect(conditionHolds(five, "p1", { kind: "yourBenchAtLeast", count: 6 })).toBe(false);
    expect(conditionNote({ kind: "yourBenchAtLeast", count: 5 })).toBe(
      "you have 5 or more Benched Pokémon",
    );
    expect(deriveAttackRequirement(TAKEN)).toBeNull();
    expect(deriveAttackDamageBonus(SIBLING)).toBeNull();
  });

  it("⑶ the NOTE is a DIFFERENT printed sentence per seat, so a seat field saves no body", () => {
    expect(conditionNote(TWIN)).toBe("you have 3 or more Benched Pokémon");
    expect(conditionNote(COND)).toBe("your opponent has 3 or more Benched Pokémon");
    // …and THIS one is a FULL round trip: byte-identical to its clause-table key,
    // which the twin's can never be. That is what the two seats print differently.
    expect(conditionNote(COND)).toBe(BONUS.exec(TAKEN)?.[1]);
    expect(TAKEN).toContain(conditionNote(COND));
    expect(TAKEN).not.toContain(conditionNote(TWIN));
    // Both are built from the PARAMETER, so a second printed threshold is legible
    // without a second string on either seat.
    expect(conditionNote({ kind: "opponentBenchAtLeast", count: 5 })).toBe(
      "your opponent has 5 or more Benched Pokémon",
    );
  });

  it("the price, as arithmetic rather than as prose — 1 / 2 against the Prize row's 2 / 9", () => {
    const mine = { printings: 1, mechanisms: 2 };
    const prizeRow = { printings: 2, mechanisms: 9 };
    expect(mine.printings).toBe(units(corpus().filter(([, s]) => s === TAKEN)));
    expect(mine.printings / mine.mechanisms).toBeGreaterThan(
      prizeRow.printings / prizeRow.mechanisms,
    );
    const prizeSentence =
      "You may turn 1 of your face-down Prize cards face up. If you do, this attack does 80 more damage. (That Prize card remains face up for the rest of the game.)";
    expect(units(corpus().filter(([, s]) => s === prizeSentence))).toBe(prizeRow.printings);
    const stillUnread =
      "Reveal the top 5 cards of your deck. This attack does 70 damage for each Future card you find there. Then, discard those Future cards and shuffle the other cards back into your deck.";
    expect(units(corpus().filter(([, s]) => s === stillUnread))).toBe(prizeRow.printings);
    expect(resolvedByAnyReader(stillUnread)).toBe(false);
    expect(resolvedByAnyReader(prizeSentence)).toBe(true);
  });
});

describe("§2 — the clause row: one PARAMETERISED member, two arms, and the anchors", () => {
  it("buys ONE member with TWO arms — the two exhaustive switches, and no more", () => {
    expect(typeof conditionHolds(ready(3201, 3), "p1", COND)).toBe("boolean");
    expect(conditionNote(COND)).toBe("your opponent has 3 or more Benched Pokémon");
  });

  it("the clause row resolves to the member AT COUNT 3, and the amount comes off the SKELETON", () => {
    const read = deriveAttackDamageBonus(TAKEN);
    expect(read).not.toBeNull();
    expect(read?.count).toEqual({ kind: "boardCondition", cond: COND });
    expect((read?.count as { cond: { count: number } }).cond.count).toBe(3);
    expect(read?.per).toBe(Number(BONUS.exec(TAKEN)?.[2]));
    expect(read?.per).toBe(80);
  });

  it("keeps the two CONSEQUENTS disjoint — D125's rule, on this clause", () => {
    expect(deriveAttackRequirement(TAKEN)).toBeNull();
    const clause = BONUS.exec(TAKEN)?.[1] ?? "";
    expect(deriveAttackRequirement(`If ${clause}, this attack does nothing.`)).toBeNull();
  });

  it("the SIBLING key cannot reach this row, and this row cannot reach the SIBLING key", () => {
    // The two bench-count board facts are now spelled by two members under two
    // consequents, and the sharpest way for that to go wrong is for one to claim the
    // other's sentence. Both directions.
    expect(deriveAttackDamageBonus(SIBLING)).toBeNull();
    expect(deriveAttackRequirement(TAKEN)).toBeNull();
    expect(deriveAttackRequirement(SIBLING)).not.toEqual(COND);
    expect(deriveAttackDamageMultiplier(TAKEN)).toBeNull();
    expect(deriveAttackDamagePenalty(TAKEN)).toBeNull();
  });

  it("the anchors are whole-sentence at BOTH ends — no substring and no near threshold reaches the row", () => {
    for (const n of [1, 2, 4, 5]) {
      const near = `If your opponent has ${String(n)} or more Benched Pokémon, this attack does 80 more damage.`;
      expect(deriveAttackDamageBonus(near), String(n)).toBeNull();
    }
    // …the OWN-side mirror, which is the whole seat question spelled as a sentence
    // the catalog does not print under this consequent.
    expect(
      deriveAttackDamageBonus(
        "If you have 3 or more Benched Pokémon, this attack does 80 more damage.",
      ),
    ).toBeNull();
    // …the "or fewer" polarity, which would be a different member entirely.
    expect(
      deriveAttackDamageBonus(
        "If your opponent has 3 or fewer Benched Pokémon, this attack does 80 more damage.",
      ),
    ).toBeNull();
    // …the IN-PLAY wording, which counts one body more.
    expect(
      deriveAttackDamageBonus(
        "If your opponent has 3 or more Pokémon in play, this attack does 80 more damage.",
      ),
    ).toBeNull();
    // Lowercase `if` — the skeleton has no /i — and a leading companion pins `^`.
    expect(deriveAttackDamageBonus(TAKEN.replace(/^If/, "if"))).toBeNull();
    expect(deriveAttackDamageBonus(`Flip a coin. ${TAKEN}`)).toBeNull();
    expect(deriveAttackDamageBonus(TAKEN.replace(/\.$/, ", and discard an Energy."))).toBeNull();
  });
});

describe("§3 — on a BOARD: the opponent's Bench from 0 to 5, and the turn at 3", () => {
  it("the whole ladder — 0,1,2 deal the printed 40 and 3,4,5 deal 120", () => {
    // Every legal Bench size, driven as a ladder rather than as two boards, so
    // `count: 2`, `count: 4` and a strict `>` are each red on a rung of their own.
    for (let n = 0; n <= 5; n += 1) {
      const state = armed(3300 + n, n);
      expect(benchOf(state, "p2"), `bench ${String(n)}`).toBe(n);
      expect(conditionHolds(state, "p1", COND), `bench ${String(n)}`).toBe(n >= 3);
      expect(damageDealt(state), `bench ${String(n)}`).toBe(n >= 3 ? 120 : 40);
    }
  });

  it("the boundary is between 2 and 3 and it is the ONLY one — off by one either way is a real card", () => {
    // Both neighbours of the printed 3 are reachable Bench sizes, which is what makes
    // a stored 2 or a stored 4 a real bug rather than a formatting difference.
    const two = armed(3310, 2);
    const three = armed(3311, 3);
    expect(conditionHolds(two, "p1", { kind: "opponentBenchAtLeast", count: 2 })).toBe(true);
    expect(conditionHolds(two, "p1", COND)).toBe(false);
    expect(conditionHolds(three, "p1", COND)).toBe(true);
    expect(conditionHolds(three, "p1", { kind: "opponentBenchAtLeast", count: 4 })).toBe(false);
    // "or more" is a FLOOR (`>=`), the twin's reading: at exactly the threshold the
    // clause HOLDS, and a `>` build deals 40 here.
    expect(damageDealt(three)).toBe(120);
  });

  it("the ACTIVE SPOT IS NOT COUNTED — an Active and two Benched is not three Benched", () => {
    const state = armed(3320, 2);
    expect(state.players.p2.active).not.toBeNull();
    expect(benchOf(state, "p2")).toBe(2);
    // Three Pokémon in play, two Benched. If the Active were spread in, this would
    // hold — the printed word is "Benched", exactly as the twin reads it.
    expect(1 + benchOf(state, "p2")).toBe(3);
    expect(conditionHolds(state, "p1", COND)).toBe(false);
    expect(damageDealt(state)).toBe(40);
  });

  it("an EMPTY opponent Bench is FALSE at every printed threshold above zero", () => {
    const state = armed(3330, 0);
    expect(benchOf(state, "p2")).toBe(0);
    for (const count of [1, 2, 3, 4, 5]) {
      expect(
        conditionHolds(state, "p1", { kind: "opponentBenchAtLeast", count }),
        String(count),
      ).toBe(false);
    }
    // …and a threshold of 0 is vacuously TRUE, which is a `>=` fact and not a special
    // case — stated so a build that special-cased the empty Bench to `false` is red.
    expect(conditionHolds(state, "p1", { kind: "opponentBenchAtLeast", count: 0 })).toBe(true);
  });

  it("the CONTROL attack is untouched by the clause — index 1 deals its flat 100 at every Bench", () => {
    for (const n of [0, 3, 5]) {
      const state = attachFromDeck(armed(3340 + n, n), "p1", "fix-energy", 1);
      expect(conditionHolds(state, "p1", COND), `bench ${String(n)}`).toBe(n >= 3);
      expect(damageDealt(state, 1), `bench ${String(n)}`).toBe(100);
    }
  });
});

describe("§4 — THE SEAT IS THE WHOLE MEMBER, and it is driven rather than named", () => {
  it("a FULL OWN Bench does NOT satisfy it — the defect the second member exists to avoid", () => {
    const state = armed(3401, 0, 5);
    expect([benchOf(state, "p1"), benchOf(state, "p2")]).toEqual([5, 0]);
    expect(conditionHolds(state, "p1", COND)).toBe(false);
    expect(damageDealt(state)).toBe(40);
    // …and the twin says TRUE on the very same board and the very same seat, which is
    // the two members differing in the SEAT ALONE, shown rather than argued.
    expect(conditionHolds(state, "p1", TWIN)).toBe(true);
    expect(conditionHolds(state, "p1", COND)).not.toBe(conditionHolds(state, "p1", TWIN));
  });

  it("…and the MIRROR: a full OPPONENT Bench with an empty own Bench lands the 120", () => {
    // The other half of the same statement, so a build that read the seats backwards
    // is red on one of the two rather than green on both.
    const state = armed(3402, 5, 0);
    expect([benchOf(state, "p1"), benchOf(state, "p2")]).toEqual([0, 5]);
    expect(conditionHolds(state, "p1", COND)).toBe(true);
    expect(conditionHolds(state, "p1", TWIN)).toBe(false);
    expect(damageDealt(state)).toBe(120);
  });

  it("it is SEAT-RELATIVE, not hard-coded to p2 — one board, two seats, opposite answers", () => {
    const state = ready(3403, 0, 5);
    expect([benchOf(state, "p1"), benchOf(state, "p2")]).toEqual([5, 0]);
    expect(conditionHolds(state, "p1", COND)).toBe(false);
    expect(conditionHolds(state, "p2", COND)).toBe(true);
    // …and the twin's two answers are the exact complement, on the same board.
    expect(conditionHolds(state, "p1", TWIN)).toBe(true);
    expect(conditionHolds(state, "p2", TWIN)).toBe(false);
  });

  it("the two seats move INDEPENDENTLY — a board where both are 3 answers TRUE for both", () => {
    const state = armed(3404, 3, 3);
    expect([benchOf(state, "p1"), benchOf(state, "p2")]).toEqual([3, 3]);
    expect(conditionHolds(state, "p1", COND)).toBe(true);
    expect(conditionHolds(state, "p1", TWIN)).toBe(true);
    expect(conditionHolds(state, "p2", COND)).toBe(true);
    expect(damageDealt(state)).toBe(120);
  });
});

describe("§5 — the fixture, the census this row moves, and the summands it does not", () => {
  it("D418 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the demonstrator is the printed card — TWO attacks at their printed indices, and the `40+` is real", () => {
    const card = FIXTURE_POOL["fix-deletingslash"];
    const attacks = card?.attacks ?? [];
    expect(attacks).toHaveLength(2);
    expect(attacks[0]?.name).toBe("Deleting Slash");
    expect(attacks[0]?.damage).toBe("40+");
    expect(attacks[0]?.cost).toEqual(["Metal", "Colorless"]);
    expect(attacks[0]?.effect).toBe(TAKEN);
    expect(attacks[1]?.name).toBe("Slicing Blade");
    expect(attacks[1]?.damage).toBe(100);
    expect(attacks[1]?.cost).toEqual(["Metal", "Colorless", "Colorless"]);
    expect(attacks[1]?.effect ?? null).toBeNull();
    expect([card?.hp, card?.stage, card?.retreat]).toEqual([130, "Basic", 2]);
    expect(card?.types).toEqual(["Metal"]);
    for (const id of ["fix-deletingslash", "fix-bigbody", "fix-benchfiller"]) {
      expect(FIXTURE_POOL[id]?.weaknesses ?? null, id).toBeNull();
      expect(FIXTURE_POOL[id]?.resistances ?? null, id).toBeNull();
    }
    // …and the defender outlives the BOOSTED total, so no §8.1 Prize tail ever runs
    // underneath an assertion whose subject is the damage number.
    expect(FIXTURE_POOL["fix-bigbody"]?.hp ?? 0).toBeGreaterThan(120);
  });

  it("the ONE id is all of the sentence's printings, and it is not in the registry", () => {
    const ids = new Set(registryCardIds());
    expect(ids.has(TAKEN_ID)).toBe(false);
    expect(programFor(TAKEN_ID)).toBeUndefined();
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(1);
  });

  it("the corpus prints exactly TWO bench-count board facts, and they differ in seat AND threshold", () => {
    const benchCounts = corpus().filter(
      ([, s]) => /\d+ or (fewer|more) Benched Pokémon/.test(s) && !s.includes("damage counters"),
    );
    expect(benchCounts.map(([, s]) => s).sort()).toEqual([SIBLING, TAKEN]);
    expect(benchCounts.every(([, s]) => resolvedByAnyReader(s))).toBe(true);
    // Different seat, different threshold, different consequent — three axes, and
    // only ONE of them is a member field.
    expect(SIBLING).toContain("you have");
    expect(TAKEN).toContain("your opponent has");
    expect(deriveAttackRequirement(SIBLING)).toEqual({ kind: "yourBenchAtLeast", count: 5 });
    expect((deriveAttackDamageBonus(TAKEN)?.count as { cond: { count: number } }).cond.count).toBe(
      3,
    );
  });

  it("the bonus residue is 16 / 19, and the 2-PRINTING BAND IS STILL EMPTY", () => {
    const openers = corpus().filter(([, s]) => BONUS.test(s.trim()));
    expect([openers.length, units(openers)]).toEqual([81, 129]);
    const refused = openers.filter(([, s]) => !resolvedByAnyReader(s));
    expect([refused.length, units(refused)]).toEqual([0, 0]);
    const refusedByNine = openers.filter(([, s]) => !resolvedByNine(s));
    expect([refusedByNine.length, units(refusedByNine)]).toEqual([0, 0]);
    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    expect([...byClause.values()].filter((n) => n > 1)).toEqual([]);
    expect([...byClause.values()].filter((n) => n === 1)).toHaveLength(0);
    expect(byClause.size).toBe(0);
    expect(
      resolvedByAnyReader(
        "If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack does 80 more damage.",
      ),
    ).toBe(true);
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
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
    ]).toEqual([384, 1286]);
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
        1 -
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
        2 -
        3 -
        2 -
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
        2 -
        1 -
        1 -
        2 -
        1 -
        2 -
        2 -
        1 -
        2 -
        3 -
        1 -
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
        1 -
        1 -
        2 -
        1 -
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
        1 -
        1,
    ]).toEqual([375, 1276]);
  });
});
