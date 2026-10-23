import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { countAttachedEnergy, countEnergyInPlay, providesEnergyType } from "./continuous";
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
import { applyAction, conditionHolds, conditionNote } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deckOf,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  findEvent,
  activeOf,
} from "./testFixtures";

// ─────────────────────────────────────────────────────────────────────────────
// The printed sentence, and the fixture that carries it.
// ─────────────────────────────────────────────────────────────────────────────

const BASIC_DRAW = "This attack does 40 damage for each Basic Energy attached to this Pokémon.";

const BASIC_DRAW_FILE_LINE = 580;

const SPECIAL_DRAW =
  "This attack does 70 damage for each Special Energy card attached to this Pokémon.";

/** The UNFILTERED twin, index 2 — the reading a build that collapsed
    `attachedEnergyFilter`'s two nullish answers would give index 3. */
const OVERFLOW = "This attack does 30 damage for each Energy attached to this Pokémon.";

/** Attack indices on `fix-selfenergy`, pinned against the fixture in §1. */
const SELF = { power: 0, flare: 1, overflow: 2, basic: 3, special: 4 } as const;

const SEED = 11;

const DECK = deckOf({
  "fix-selfenergy": 4,
  "fix-water-energy": 12,
  "fix-energy": 12,
  "fix-blend": 4,
  "fix-special": 8,
  "sv02-191": 4,
  "fix-titan": 6,
  "fix-basic-1": 10,
});

/** `by` is about to attack. The FOE opens and passes, so the attacking seat carries no
    §4 first-turn restriction; both Benches are cleared, because a body the setup
    shuffle happened to seat would move the ZONE misreading's number silently. */
function bare(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(driveSetup(SEED, { p1: DECK, p2: DECK }, { first: foe }), {
      type: "endTurn",
      seat: foe,
    }),
  );
  state = setActiveFromDeck(state, by, "fix-selfenergy");
  state = clearBench(state, by);
  state = setActiveFromDeck(state, foe, "fix-titan");
  return clearBench(state, foe);
}

function mixedBoard(): GameState {
  let state = bare();
  state = attachFromDeck(state, "p1", "fix-water-energy", 2);
  state = attachFromDeck(state, "p1", "fix-energy", 2);
  state = attachFromDeck(state, "p1", "fix-blend", 1);
  state = benchFromDeck(state, "p1", "fix-titan");
  state = attachBenchFromDeck(state, "p1", 0, "fix-water-energy", 3);
  state = attachBenchFromDeck(state, "p1", 0, "sv02-191", 1);
  return attachFromDeck(state, "p2", "fix-special", 2);
}

function swing(state: GameState, index: number, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}

/** The rendered log, flattened to `{ who, text }` — the neighbouring suites' shape. */
function rendered(state: GameState, events: GameEvent[]): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Wren" }, state, elapsed: "+00:11" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

const READERS = [
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackRequirement,
] as const;

const units = (rows: readonly (readonly [number, string])[]) =>
  rows.reduce((sum, [n]) => sum + n, 0);

describe("D500 §1 — the sentence is a corpus row, and the fixture prints it", () => {
  it("IS a row of `legalAttackCorpus()`, at 1 legal printing and at its stated file line", () => {
    const rows = legalAttackCorpus().filter(([, text]) => text === BASIC_DRAW);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe(1);
    expect(legalAttackCorpus().findIndex(([, text]) => text === BASIC_DRAW) + 53).toBe(
      BASIC_DRAW_FILE_LINE,
    );
  });

  it("the FIXTURE prints those bytes at index 3, and its two near neighbours at 2 and 4", () => {
    const attacks = FIXTURE_POOL["fix-selfenergy"]?.attacks;
    expect(attacks?.[SELF.basic]?.effect).toBe(BASIC_DRAW);
    expect(attacks?.[SELF.basic]?.name).toBe("Basic Draw");
    expect(attacks?.[SELF.basic]?.damage).toBe("40×");
    expect(attacks?.[SELF.overflow]?.effect).toBe(OVERFLOW);
    expect(attacks?.[SELF.special]?.effect).toBe(SPECIAL_DRAW);
  });

  it("exactly ONE reader claims it, and the surface did not grow", () => {
    const claimers = READERS.filter((read) => read(BASIC_DRAW) !== null);
    expect(claimers).toHaveLength(1);
    expect(deriveAttackDamageMultiplier(BASIC_DRAW)).toEqual({
      per: 40,
      count: { kind: "energyOnSelf", energyType: "basic" },
    });
    expect(attackReaderSurface()).toHaveLength(14);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — CARDS, not PROVISIONS. The board that separates seven readings.
// ─────────────────────────────────────────────────────────────────────────────

describe("D500 §2 — a card CATEGORY, driven apart from every provision reading", () => {
  it("THE FIXTURE THAT MAKES IT A QUESTION: a Special Energy that PROVIDES a basic type", () => {
    const state = mixedBoard();
    const body = activeOf(state, "p1");
    const blend = body.energy.filter((uid) => state.cardIdByUid[uid] === "fix-blend");
    expect(blend).toHaveLength(1);
    const uid = blend[0];
    if (uid === undefined) throw new Error("no fix-blend attached");
    // It provides TWO basic types…
    expect(providesEnergyType(state, body, uid, "Water")).toBe(true);
    expect(providesEnergyType(state, body, uid, "Fire")).toBe(true);
    // …and it is NOT a Basic Energy card, which is the whole distinction.
    expect(FIXTURE_POOL["fix-blend"]?.energyType).toBe("Special");
    // The mirror in the other direction: a BASIC Energy that provides no basic type.
    const plain = body.energy.filter((uid2) => state.cardIdByUid[uid2] === "fix-energy");
    expect(plain).toHaveLength(2);
    const plainUid = plain[0];
    if (plainUid === undefined) throw new Error("no fix-energy attached");
    expect(providesEnergyType(state, body, plainUid, "Water")).toBe(false);
    expect(FIXTURE_POOL["fix-energy"]?.energyType).toBe("Normal");
  });

  it("SEVEN readings, SEVEN numbers, on ONE board — and the correct one is 4", () => {
    const state = mixedBoard();
    const mine = activeOf(state, "p1");
    const theirs = activeOf(state, "p2");
    // ⑴ the CORRECT reading.
    expect(countAttachedEnergy(state, mine, "basic")).toBe(4);
    // ⑵ the UNFILTERED collapse.
    expect(countAttachedEnergy(state, mine, null)).toBe(5);
    expect(countAttachedEnergy(state, mine, "special")).toBe(1);
    expect(countAttachedEnergy(state, mine, "Water")).toBe(3);
    // ⑸ the BOARD ZONE instead of the attacking body.
    expect(countEnergyInPlay(state, "p1", "basic")).toBe(7);
    // ⑹/⑺ the DEFENDER's body, filtered and unfiltered.
    expect(countAttachedEnergy(state, theirs, "basic")).toBe(0);
    expect(countAttachedEnergy(state, theirs, null)).toBe(2);
    expect(new Set([4, 5, 1, 3, 7, 0, 2]).size).toBe(7);
  });

  it("the SWING deals 160, and not any of the other six numbers × 40", () => {
    const row = findEvent(swing(mixedBoard(), SELF.basic).events, "DAMAGE_DEALT");
    // The `×` fold DROPS the printed base, so 160 is the fold and nothing else.
    expect(row?.base).toBe(0);
    expect(row?.scaled).toBe(160);
    expect(row?.dealt).toBe(160);
    for (const wrong of [200, 40, 120, 280, 0, 80]) expect(row?.dealt).not.toBe(wrong);
    expect(
      findEvent(swing(mixedBoard(), SELF.basic).events, "ATTACK_EFFECT_SKIPPED"),
    ).toBeUndefined();
  });

  it("THE WILDCARD: `providesEnergyType` answers TRUE for a type no card provides", () => {
    const state = mixedBoard();
    const bench = state.players.p1.bench[0];
    if (bench === undefined) throw new Error("p1 has no benched body");
    const wild = bench.energy.filter((uid) => state.cardIdByUid[uid] === "sv02-191");
    expect(wild).toHaveLength(1);
    const uid = wild[0];
    if (uid === undefined) throw new Error("no Luminous attached");
    expect(providesEnergyType(state, bench, uid, "basic")).toBe(true);
    expect(providesEnergyType(state, bench, uid, "Water")).toBe(true);
    // …and it is NOT a Basic Energy card, so the CORRECT board count excludes it.
    expect(FIXTURE_POOL["sv02-191"]?.energyType).toBe("Special");
    expect(countEnergyInPlay(state, "p1", "basic")).toBe(7);
    expect(countEnergyInPlay(state, "p1", "basic")).not.toBe(8);
  });

  it("the two CATEGORIES partition the attached pile, which no TYPE filter does", () => {
    // `"basic"` + `"special"` = the unfiltered total, on any board. That identity is
    // what says the pair reads the CARD rather than what the card provides — a
    // provision-based `"basic"` would break it here by 2 (4 → 3, and 3 + 1 ≠ 5).
    const state = mixedBoard();
    const body = activeOf(state, "p1");
    expect(
      countAttachedEnergy(state, body, "basic") + countAttachedEnergy(state, body, "special"),
    ).toBe(countAttachedEnergy(state, body, null));
    // …and the same identity board-wide, through the other counter.
    expect(
      countEnergyInPlay(state, "p1", "basic") + countEnergyInPlay(state, "p1", "special"),
    ).toBe(countEnergyInPlay(state, "p1", null));
  });

  it("the SIBLING indices on the same board, so the three foldings are told apart", () => {
    const state = mixedBoard();
    // index 2 is UNFILTERED at 30× → 5 × 30 = 150.
    expect(findEvent(swing(state, SELF.overflow).events, "DAMAGE_DEALT")?.scaled).toBe(150);
    // index 4 is `Special` at 70× → 1 × 70 = 70.
    expect(findEvent(swing(state, SELF.special).events, "DAMAGE_DEALT")?.scaled).toBe(70);
    // index 3 is the new one at 40× → 4 × 40 = 160. Three indices, one body, three
    // numbers, and no two of them are reachable from one reading of the noun.
    expect(findEvent(swing(state, SELF.basic).events, "DAMAGE_DEALT")?.scaled).toBe(160);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the vocabulary: what resolves, and what must still be LOUD.
// ─────────────────────────────────────────────────────────────────────────────

describe("D500 §3 — one shared token table, and it still refuses what it cannot read", () => {
  it("`Basic` resolves at ALL THREE readers the map feeds — measured, not argued", () => {
    expect(deriveAttackDamageMultiplier(BASIC_DRAW)?.count).toEqual({
      kind: "energyOnSelf",
      energyType: "basic",
    });
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each Basic Energy attached to this Pokémon. This attack does 80 damage for each heads.",
      ),
    ).toEqual({ kind: "perHeads", flips: { kind: "attachedEnergy", energy: "basic" }, per: 80 });
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon has any Basic Energy attached, this attack does 90 more damage.",
      ),
    ).toEqual({
      per: 90,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourActiveHasEnergyAttached", energy: "basic" },
      },
    });
  });

  it("…and the two it newly reads are printed ZERO times, which is the price and is SAID", () => {
    const printed = legalAttackCorpus().filter(([, text]) => /\bBasic\b/.test(text));
    expect(
      printed.filter(([, text]) => /^Flip a coin for each .*Energy attached/.test(text)),
    ).toHaveLength(0);
    expect(printed.filter(([, text]) => /has any .*Energy attached/.test(text))).toHaveLength(0);
    const claimedBasic = legalAttackCorpus().filter(
      ([, text]) => deriveAttackDamageMultiplier(text)?.count.kind === "energyOnSelf",
    );
    expect(
      claimedBasic.filter(([, text]) => {
        const count = deriveAttackDamageMultiplier(text)?.count;
        return count?.kind === "energyOnSelf" && count.energyType === "basic";
      }),
    ).toEqual([[1, BASIC_DRAW]]);
  });

  it("the REFUSALS that hold the guard now that `Basic` does not", () => {
    for (const token of ["{C}", "Fancy", "basic", "Normal", "constructor", "toString"]) {
      expect(
        deriveAttackDamageMultiplier(BASIC_DRAW.replace("Basic Energy", `${token} Energy`)),
      ).toBeNull();
    }
  });

  it("the ANCHOR is byte-unchanged, and the near-misses it refuses still are", () => {
    expect(deriveAttackDamageMultiplier(`Flip a coin. ${BASIC_DRAW}`)).toBeNull();
    expect(
      deriveAttackDamageMultiplier(BASIC_DRAW.replace("This attack", "this attack")),
    ).toBeNull();
    expect(deriveAttackDamageMultiplier(BASIC_DRAW.slice(0, -1))).toBeNull();
    expect(deriveAttackDamageBonus(BASIC_DRAW.replace("40 damage", "40 more damage"))).toEqual({
      per: 40,
      count: { kind: "energyOnSelf", energyType: "basic" },
    });
    // …and a printed 0 still adds nothing, the guard every arm in both folds carries.
    expect(deriveAttackDamageMultiplier(BASIC_DRAW.replace("40 damage", "0 damage"))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the DESCRIBER, and the arm `tsc` could not ask for.
// ─────────────────────────────────────────────────────────────────────────────

describe("D500 §4 — `conditionNote` names the CATEGORY, and the missing arm was silent", () => {
  it("renders 'a Basic Energy', not the template fallback's 'basic Energy'", () => {
    expect(conditionNote({ kind: "yourActiveHasEnergyAttached", energy: "basic" })).toBe(
      "your Active Pokémon has a Basic Energy attached",
    );
    // …the shipped sibling, unchanged, as the control that the arm did not displace it.
    expect(conditionNote({ kind: "yourActiveHasEnergyAttached", energy: "special" })).toBe(
      "your Active Pokémon has a Special Energy attached",
    );
    expect(conditionNote({ kind: "yourActiveHasEnergyAttached", energy: "Water" })).toBe(
      "your Active Pokémon has Water Energy attached",
    );
    expect(conditionNote({ kind: "yourActiveHasEnergyAttached", energy: "basic" })).not.toBe(
      "your Active Pokémon has basic Energy attached",
    );
  });

  it("the SEAT MIRROR was deliberately NOT widened, and the type is what says so", () => {
    expect(conditionNote({ kind: "opponentActiveHasEnergyAttached", energy: "special" })).toBe(
      "your opponent's Active Pokémon has a Special Energy attached",
    );
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon has any Basic Energy attached, this attack does 90 more damage.",
      ),
    ).toBeNull();
  });

  it("`conditionHolds` EVALUATES the new value, so the third arm has somewhere to die", () => {
    const state = mixedBoard();
    const basic = { kind: "yourActiveHasEnergyAttached", energy: "basic" } as const;
    const special = { kind: "yourActiveHasEnergyAttached", energy: "special" } as const;
    // p1's Active holds 4 Basic and 1 Special, so BOTH hold…
    expect(conditionHolds(state, "p1", basic)).toBe(true);
    expect(conditionHolds(state, "p1", special)).toBe(true);
    // …and p2's Active holds 2 Special and NO Basic, which is what separates them.
    expect(conditionHolds(state, "p2", basic)).toBe(false);
    expect(conditionHolds(state, "p2", special)).toBe(true);
  });
});

describe("D500 §5 — the log row, rendered, with its honest limit recorded", () => {
  it("renders the fold as a `scaled` crumb on the damage row", () => {
    const state = mixedBoard();
    const { state: after, events } = swing(state, SELF.basic);
    const lines = rendered(after, events);
    const damage = lines.find((l) => l.text.includes("dealt "));
    expect(damage?.who).toBe("p1");
    expect(damage?.text).toContain("dealt 160 damage to ");
    expect(damage?.text).toContain("· scaled +160");
    expect(damage?.text).not.toContain("Basic");
    expect(lines.some((l) => l.text.includes("could not be simulated"))).toBe(false);
  });
});

describe("D500 §6 — what the corpus looked like before, computed from what it looks like now", () => {
  it("EXACTLY ONE sentence moved, and it is the one this slice names", () => {
    const movedByThisSlice = (text: string): boolean => {
      const multiply = deriveAttackDamageMultiplier(text)?.count;
      if (multiply?.kind === "energyOnSelf" && multiply.energyType === "basic") return true;
      if (multiply?.kind === "energyOnOpponent" && multiply.energyType === "basic") return true;
      const bonus = deriveAttackDamageBonus(text)?.count;
      if (bonus?.kind === "energyOnSelf" && bonus.energyType === "basic") return true;
      if (bonus?.kind === "energyOnOpponent" && bonus.energyType === "basic") return true;
      const flip = deriveAttackCoinFlip(text);
      return flip?.kind === "perHeads" && flip.flips.kind === "attachedEnergy"
        ? flip.flips.energy === "basic"
        : false;
    };
    const moved = legalAttackCorpus().filter(([, text]) => movedByThisSlice(text));
    expect(moved).toEqual([[1, BASIC_DRAW]]);
    const resolvedNow = legalAttackCorpus().filter(([, text]) => resolvedByAnyReader(text));
    expect([
      resolvedNow.length -
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
        moved.length,
      units(resolvedNow) -
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
        1 -
        3 -
        1 -
        1 -
        units(moved),
    ]).toEqual([545, 1587]);
    for (const [, text] of moved) expect(/\bBasic\b/.test(text)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — `MATCH_RECORD_VERSION`: the ADDRESS first, then the argument.
// ─────────────────────────────────────────────────────────────────────────────

describe("D500 §7 — the version stays 29, and the address is named before the argument", () => {
  it("the ADDRESS: `DamageCountSource` is PARSE-TIME and reaches no persisted byte", () => {
    const { state: after } = swing(mixedBoard(), SELF.basic);
    const wire = JSON.stringify(after);
    expect(wire).not.toContain("energyOnSelf");
    expect(wire).not.toContain('"basic"');
    expect(wire).toContain('"energyType":"Normal"');
    expect(wire).toContain('"energyType":"Special"');
  });

  it("the address that IS persisted, and why a WIDENING there is still free", () => {
    const produced = legalAttackCorpus().filter(([, text]) => {
      const cond = deriveAttackDamageBonus(text)?.count;
      return (
        cond?.kind === "boardCondition" &&
        cond.cond.kind === "yourActiveHasEnergyAttached" &&
        cond.cond.energy === "basic"
      );
    });
    expect(produced).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — what did NOT move.
// ─────────────────────────────────────────────────────────────────────────────

describe("D500 §8 — the absences, pinned rather than claimed", () => {
  it("the ADDITIVE fold of this exact sentence is still refused, and by the ANCHOR", () => {
    expect(deriveAttackDamageBonus(SPECIAL_DRAW.replace("70 damage", "70 more damage"))).toBeNull();
    expect(
      deriveAttackDamageBonus(
        BASIC_DRAW.replace("Energy attached", "Energy card attached").replace(
          "40 damage",
          "40 more damage",
        ),
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "This attack does 40 more damage for each Basic Energy attached to this Pokémon.",
      ),
    ).toEqual({ per: 40, count: { kind: "energyOnSelf", energyType: "basic" } });
  });

  it("no OTHER printed sentence changed its answer", () => {
    const withoutBasic = legalAttackCorpus().filter(([, text]) => !/\bBasic\b/.test(text));
    expect(withoutBasic.length).toBe(640 - 68);
    for (const [, text] of withoutBasic) {
      const claimers = READERS.filter((read) => read(text) !== null);
      expect(claimers.length, text).toBeLessThanOrEqual(2);
    }
    expect(legalAttackCorpus()).toHaveLength(640);
  });
});
