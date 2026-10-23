import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader as readByAny,
} from "./censusAttackCorpus";
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
  splitAttackGateClause,
  splitAttackRequirementClause,
} from "./effects";
import type { GameState } from "./index";
import { conditionNote } from "./interpreter";
import {
  FIXTURE_POOL,
  SAWK_SPLIT_DECK,
  attachFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

const SAWK =
  "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing. This attack's damage isn't affected by Weakness or Resistance.";
const SAWK_HEAD = "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing.";
const SAWK_TAIL = "This attack's damage isn't affected by Weakness or Resistance.";
const PALAFIN =
  "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.";

const READERS: readonly ((t: string) => unknown)[] = [
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
const p = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [units]) => sum + units, 0);

const OLD_ANCHOR = /^If (.+), this attack does nothing\.$/;
/** The NEW anchor, same caveat. */
const NEW_ANCHOR = /^If (.+?), this attack does nothing\.(?: (.+))?$/;

/** Setup, then open P1's turn 2 (P2 went first and passed). */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: SAWK_SPLIT_DECK, p2: SAWK_SPLIT_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields Sawk with {F}{C} attached; P2 fields `defender` on a clear Bench. */
function ready(seed: number, defender: string): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-sawk");
  state = attachFromDeck(state, "p1", "fix-fighting-energy", 1);
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", defender);
  return clearBench(state, "p2");
}

describe("§1 — D362's counts reproduce and its ATTRIBUTION does not", () => {
  it("D418 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("re-derives 17 s / 43 p, 8 s / 16 p admissible, 9 s / 27 p refused under the OLD anchor", () => {
    const nothing = legalAttackCorpus().filter(([, s]) => /this attack does nothing\./.test(s));
    const admissible = nothing.filter(([, s]) => OLD_ANCHOR.test(s.trim()));
    const refused = nothing.filter(([, s]) => !OLD_ANCHOR.test(s.trim()));
    expect(nothing).toHaveLength(17);
    expect(p(nothing)).toBe(43);
    expect(admissible).toHaveLength(8);
    expect(p(admissible)).toBe(16);
    expect(refused).toHaveLength(9);
    expect(p(refused)).toBe(27);
    // The parts must add up in both units, in the same case that quotes them.
    expect(admissible.length + refused.length).toBe(nothing.length);
    expect(p(admissible) + p(refused)).toBe(p(nothing));
  });

  it("partitions the 9 refused BY WHICH ANCHOR — 1/2 behind `$`, 7/23 behind `^`, 1/2 behind both", () => {
    // THE CORRECTION, as an addition that can fail. `$`-only means the sentence
    // OPENS with the does-nothing clause; `^`-only means it ENDS with it.
    const HEAD_ONLY = /^If (.+), this attack does nothing\./;
    const TAIL_ONLY = /If (.+), this attack does nothing\.$/;
    const refused = legalAttackCorpus()
      .filter(([, s]) => /this attack does nothing\./.test(s))
      .filter(([, s]) => !OLD_ANCHOR.test(s.trim()));
    const byDollar = refused.filter(([, s]) => HEAD_ONLY.test(s.trim()));
    const byCaret = refused.filter(
      ([, s]) => !HEAD_ONLY.test(s.trim()) && TAIL_ONLY.test(s.trim()),
    );
    const byBoth = refused.filter(
      ([, s]) => !HEAD_ONLY.test(s.trim()) && !TAIL_ONLY.test(s.trim()),
    );

    expect(byDollar).toHaveLength(1);
    expect(p(byDollar)).toBe(2);
    expect(byDollar[0]?.[1]).toBe(SAWK);
    expect(byCaret).toHaveLength(7);
    expect(p(byCaret)).toBe(23);
    expect(byBoth).toHaveLength(1);
    expect(p(byBoth)).toBe(2);
    // Three disjoint parts of one whole, added in both units.
    expect(byDollar.length + byCaret.length + byBoth.length).toBe(refused.length);
    expect(p(byDollar) + p(byCaret) + p(byBoth)).toBe(p(refused));
    expect(p(byDollar) * 10).toBeLessThan(p(refused));
  });

  it("the NEW anchor's reach is 9 s / 18 p, and it is the OLD one plus EXACTLY Sawk", () => {
    const nothing = legalAttackCorpus().filter(([, s]) => /this attack does nothing\./.test(s));
    const before = nothing.filter(([, s]) => OLD_ANCHOR.test(s.trim()));
    const after = nothing.filter(([, s]) => NEW_ANCHOR.test(s.trim()));
    expect(after).toHaveLength(9);
    expect(p(after)).toBe(18);
    // Set difference in BOTH directions: nothing left, exactly one arrived.
    const gained = after.filter(([, s]) => !before.some(([, t]) => t === s));
    const lost = before.filter(([, s]) => !after.some(([, t]) => t === s));
    expect(gained.map(([, s]) => s)).toEqual([SAWK]);
    expect(lost).toHaveLength(0);
    // …and the copies above really are the READER's anchors and not two regexes
    // agreeing with each other: every sentence the NEW copy admits and the OLD
    // one refuses must be one the live reader now reaches, and vice versa.
    for (const [, s] of gained) expect(deriveAttackRequirement(s), s).not.toBeNull();
    for (const [, s] of before) expect(NEW_ANCHOR.test(s.trim()), s).toBe(true);
    expect(NEW_ANCHOR.test(SAWK)).toBe(true);
    expect(OLD_ANCHOR.test(SAWK)).toBe(false);
    expect(deriveAttackRequirement(SAWK)).not.toBeNull();
  });

  it("the census moves by exactly 2 printings on exactly 1 sentence", () => {
    const rows = legalAttackCorpus();
    const resolved = rows.filter(([, s]) => readByAny(s));
    const residue = rows.filter(([, s]) => !readByAny(s));
    expect(resolved).toHaveLength(600);
    expect(p(resolved)).toBe(1663);
    expect(residue).toHaveLength(40);
    expect(p(residue)).toBe(69);
    expect(resolved.length + residue.length).toBe(rows.length);
    expect(p(resolved) + p(residue)).toBe(p(rows));
    expect(resolved.some(([, s]) => s === SAWK)).toBe(true);
  });
});

describe("§2 — the `^` is untouched, and the coin family proves it", () => {
  it("refuses every `^`-blocked printing in the corpus, one by one", () => {
    const refusedByCaret = legalAttackCorpus()
      .filter(([, s]) => /this attack does nothing\./.test(s))
      .filter(([, s]) => !/^If (.+), this attack does nothing\./.test(s.trim()));
    expect(refusedByCaret).toHaveLength(8);
    expect(p(refusedByCaret)).toBe(25);
    for (const [, s] of refusedByCaret) {
      expect(deriveAttackRequirement(s), s).toBeNull();
      expect(splitAttackRequirementClause(s), s).toBeNull();
    }
  });

  it("leaves the 16 coin-cancel printings on `deriveAttackCoinFlip` and nowhere else", () => {
    // The sharpest reason the `^` may not move: this sentence is ALREADY read.
    // A reader that also claimed it would take a second flip on one attack.
    const CANCEL = "Flip a coin. If tails, this attack does nothing.";
    const row = legalAttackCorpus().find(([, s]) => s === CANCEL);
    expect(row?.[0]).toBe(16);
    expect(deriveAttackCoinFlip(CANCEL)).toEqual({ kind: "cancelOnTails" });
    expect(deriveAttackRequirement(CANCEL)).toBeNull();
    expect(splitAttackRequirementClause(CANCEL)).toBeNull();
  });

  it("keeps the CONTROL that says the reader is really running — Palafin, unsplit", () => {
    expect(deriveAttackRequirement(PALAFIN)).toEqual({ kind: "yourActivePromotedThisTurn" });
    expect(deriveAttackRequirement(`${PALAFIN} ${SAWK_TAIL}`)).toEqual({
      kind: "yourActivePromotedThisTurn",
    });
    // …and the split hands the companion back rather than eating it.
    expect(splitAttackRequirementClause(`${PALAFIN} ${SAWK_TAIL}`)).toEqual({
      clause: PALAFIN,
      body: SAWK_TAIL,
    });
    expect(splitAttackRequirementClause(PALAFIN)).toBeNull();
  });
});

describe("§3 — the clause-table row, ZERO new vocabulary, and the round trip", () => {
  it("maps the printed NEGATIVE onto D362's EXISTING positive member", () => {
    expect(deriveAttackRequirement(SAWK)).toEqual({ kind: "opponentActiveIsEx" });
    expect(deriveAttackRequirement(SAWK_HEAD)).toEqual({ kind: "opponentActiveIsEx" });
    expect(conditionNote({ kind: "opponentActiveIsEx" })).toBe(
      "your opponent's Active Pokémon is a Pokémon ex",
    );
    expect(SAWK_HEAD).toBe(
      `If ${conditionNote({ kind: "opponentActiveIsEx" }).replace(" is a", " isn't a")}, this attack does nothing.`,
    );
  });

  it("keeps the two consequents DISJOINT — the negative never reaches the bonus table", () => {
    expect(deriveAttackDamageBonus(SAWK)).toBeNull();
    expect(deriveAttackDamageBonus(SAWK_HEAD)).toBeNull();
    expect(
      deriveAttackRequirement(
        "If your opponent's Active Pokémon is a Pokémon ex, this attack does 90 more damage.",
      ),
    ).toBeNull();
  });

  it("keys CHAR-FOR-CHAR — five rewrites of the clause all stay null", () => {
    for (const clause of [
      "your opponent's Active Pokemon isn't a Pokémon ex", // ASCII "Pokemon"
      "your opponent's Active Pokémon is not a Pokémon ex", // expanded contraction
      "your opponent's active Pokémon isn't a Pokémon ex", // lowercased noun
      "your opponents Active Pokémon isn't a Pokémon ex", // possessive dropped
      "your opponent's Active Pokémon isn't a Pokémon ex or Pokémon V", // the WIDER key
    ]) {
      expect(deriveAttackRequirement(`If ${clause}, this attack does nothing.`), clause).toBeNull();
    }
  });
});

describe("§4 — the split, and the accounting guard that makes it safe", () => {
  it("splits Sawk into the two sentences the engine already reads", () => {
    expect(splitAttackRequirementClause(SAWK)).toEqual({ clause: SAWK_HEAD, body: SAWK_TAIL });
    expect(deriveAttackRequirement(SAWK_HEAD)).toEqual({ kind: "opponentActiveIsEx" });
    expect(deriveAttackDamageSuppression(SAWK_TAIL)).toEqual({ weakness: true, resistance: true });
    expect(deriveAttackDamageSuppression(SAWK)).toBeNull();
  });

  it("refuses to strip a clause the TABLE does not carry — the accounting guard", () => {
    const unmapped = `If you don't have exactly 4 cards in your hand, this attack does nothing. ${SAWK_TAIL}`;
    expect(deriveAttackRequirement(unmapped)).toBeNull();
    expect(splitAttackRequirementClause(unmapped)).toBeNull();
    expect(legalAttackCorpus().some(([, s]) => s.includes("exactly 4 cards in your hand"))).toBe(
      false,
    );
    expect(
      deriveAttackRequirement("If there is no Stadium in play, this attack does nothing."),
    ).toEqual({ kind: "stadiumInPlay" });
    expect(
      deriveAttackRequirement(
        "If you don't have exactly 3 cards in your hand, this attack does nothing.",
      ),
    ).toEqual({ kind: "yourHandExactly", count: 3 });
    expect(
      splitAttackRequirementClause(
        `If you don't have exactly 3 cards in your hand, this attack does nothing. ${SAWK_TAIL}`,
      ),
    ).toEqual({
      clause: "If you don't have exactly 3 cards in your hand, this attack does nothing.",
      body: SAWK_TAIL,
    });
  });

  it("does not touch D282's gate split — two splits, two populations, no overlap", () => {
    // Both are leading-sentence strippers on the same string. If either claimed
    // the other's sentences the site would strip twice.
    for (const [, text] of legalAttackCorpus()) {
      if (splitAttackGateClause(text) === null) continue;
      expect(splitAttackRequirementClause(text), text).toBeNull();
    }
    expect(splitAttackGateClause(SAWK)).toBeNull();
  });
});

describe("§5 — on a board: the requirement gates, the suppression lands, the residue stays loud", () => {
  it("CANCELS into a body that is not a Pokémon ex, and the turn still ends", () => {
    const after = mustApply(ready(61, "fix-bigbody"), { type: "attack", seat: "p1", index: 0 });
    expect(types(after.events)).toContain("ATTACK_FAILED");
    expect(after.events.find((e) => e.type === "ATTACK_FAILED")).toMatchObject({
      reason: "requirement",
    });
    expect(types(after.events)).not.toContain("DAMAGE_DEALT");
    expect(types(after.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("CANCELS into a Pokémon V — the board where this member and `…IsExOrV` disagree", () => {
    const after = mustApply(ready(62, "fix-pokemon-v"), { type: "attack", seat: "p1", index: 0 });
    expect(after.events.find((e) => e.type === "ATTACK_FAILED")).toMatchObject({
      reason: "requirement",
    });
    expect(types(after.events)).not.toContain("DAMAGE_DEALT");
  });

  it("lands 90 into an ex whose printed Weakness is Fighting ×2 — the SUPPRESSION half", () => {
    expect(FIXTURE_POOL["sv06.5-036"]?.weaknesses).toEqual([{ type: "Fighting", value: "×2" }]);
    expect(FIXTURE_POOL["fix-sawk"]?.types).toEqual(["Fighting"]);
    const after = mustApply(ready(63, "sv06.5-036"), { type: "attack", seat: "p1", index: 0 });
    const hit = after.events.find((e) => e.type === "DAMAGE_DEALT");
    expect(hit).toMatchObject({ base: 90, dealt: 90 });
    expect(types(after.events)).not.toContain("ATTACK_FAILED");
    expect(types(after.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("REPORTS the companion it cannot read, naming the BODY and not the compound", () => {
    // The gate on `effectSimulated`. `fix-sawk` index 1 prints the SAME mapped
    // leading clause with a companion no reader resolves; without the gate the
    // requirement would set `effectSimulated` and this event would not exist.
    const after = mustApply(ready(64, "sv06.5-036"), { type: "attack", seat: "p1", index: 1 });
    const skipped = after.events.find((e) => e.type === "ATTACK_EFFECT_SKIPPED");
    expect(skipped).toBeDefined();
    expect(skipped).toMatchObject({ effect: "Then, spin the wheel of fate." });
    // …and the requirement it DID read still gates the attack: this one lands,
    // because the Active IS an ex.
    expect(types(after.events)).not.toContain("ATTACK_FAILED");
  });

  it("keeps the WHOLE string loud when the leading clause is UNMAPPED", () => {
    const after = mustApply(ready(65, "sv06.5-036"), { type: "attack", seat: "p1", index: 2 });
    const skipped = after.events.find((e) => e.type === "ATTACK_EFFECT_SKIPPED");
    expect(skipped).toBeDefined();
    expect(skipped).toMatchObject({
      effect: `If you don't have exactly 4 cards in your hand, this attack does nothing. ${SAWK_TAIL}`,
    });
    // No requirement was read, so nothing was gated…
    expect(types(after.events)).not.toContain("ATTACK_FAILED");
    // …and the printed 20 lands DOUBLED by Okidogi's Fighting Weakness, because
    // the suppression sentence was never reached. That is the correct loud
    // behaviour and it is asserted rather than assumed.
    expect(after.events.find((e) => e.type === "DAMAGE_DEALT")).toMatchObject({ dealt: 40 });
  });
});

describe("§6 — what this slice did NOT buy", () => {
  it("authors ZERO registry rows for either Sawk printing", async () => {
    const { programFor, registryCardIds } = await import("./registry");
    for (const id of ["sv10.5w-049", "sv10.5w-130"]) {
      expect(programFor(id), id).toBeUndefined();
      expect(registryCardIds().includes(id), id).toBe(false);
    }
  });

  it("the ROTATED and NON-ATTACK columns cannot move — the sentence is attack-only", () => {
    const row = legalAttackCorpus().find(([, s]) => s === SAWK);
    expect(row?.[0]).toBe(2);
  });
});
