import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
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

// D363 — THE `$` WAS THE WRONG ANCHOR TO PRICE.
//
// 🛑 THE MEASUREMENT THAT CHOSE THIS ROW, AND IT IS A CORRECTION RATHER THAN AN
// INHERITANCE. D362 measured this widening at *"9 sentences / 27 printings of
// unrelated surface"* and refused it on that price, leaving the work unspent. Its
// COUNTS reproduce here to the printing (§1 re-derives them live); its
// ATTRIBUTION does not. `/^If (.+), this attack does nothing\.$/` has TWO anchors
// and they refuse DIFFERENT sentences:
//
//   • the `$` alone — a LEADING does-nothing sentence with a trailing companion:
//     **1 sentence / 2 printings** (Sawk `sv10.5w-049`/`-130`);
//   • the `^` alone — a LEADING companion, the does-nothing sentence last:
//     7 sentences / 23 printings ("Flip a coin. …", "Discard …. ", "Before doing
//     damage, …. ", "Switch in …. ");
//   • BOTH: 1 sentence / 2 printings.
//
// Confirmed pool-wide on the remote D1 (`luminous`, `$.effect`, 2026-08-18):
// `GLOB 'If *, this attack does nothing.*'` minus `GLOB 'If *, this attack does
// nothing.'` is **2 rows in 978 cards / 6 sets**, both Sawk, both `legal_standard = 1`.
// **A `$` WIDENING BUYS TWO PRINTINGS, NOT TWENTY-SEVEN.** §1 asserts the whole
// partition so the correction is a measurement in this file rather than a
// paragraph in another.
//
// 🛑 THE `^` IS UNTOUCHED AND MUST STAY UNTOUCHED. Sixteen of the 23 printings
// behind it are "Flip a coin. If tails, this attack does nothing.", which
// `deriveAttackCoinFlip` ALREADY resolves — reaching them from this reader would
// flip one attack twice. §2 asserts that in both directions.
//
// 🛑 AND THE WIDENING DOES NOT SHIP ALONE, BECAUSE A WIDENED ANCHOR WITH NOTHING
// BEHIND IT IS THE D278/D279 BUILD. Sawk prints TWO rules. Without an accounting
// seam the requirement alone would set `effectSimulated` and SILENCE a printed
// "isn't affected by Weakness or Resistance" the engine was not applying — half a
// sentence claimed, which is the exact failure this family has refused twice. So
// the anchor moves WITH `splitAttackRequirementClause` (D282's shape, D282's one
// safety property: it refuses to strip a clause the table does not carry) and
// with `effectSimulated`'s requirement term gated on "no split fired". §4 and §5
// drive both, on boards, in both directions.

/** Sawk `sv10.5w-049`/`-130` "Rising Chop" ({F}, 90 — D364 re-read the cost off
    `attacks_json`: it is ONE Fighting, not `{F}{C}`; the `fix-sawk` FIXTURE costs
    `{F}{C}` and that is a fixture choice, not the printing), as PRINTED. */
const SAWK =
  "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing. This attack's damage isn't affected by Weakness or Resistance.";
/** The leading sentence alone — anchor-admissible before D363 and after it. */
const SAWK_HEAD =
  "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing.";
/** The trailing sentence alone — `deriveAttackDamageSuppression`'s since D192. */
const SAWK_TAIL = "This attack's damage isn't affected by Weakness or Resistance.";
/** Palafin `sv03-062`/`-200`, the row that already read — §2's CONTROL. */
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
];
const readByAny = (s: string): boolean => READERS.some((r) => r(s) !== null);
const p = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [units]) => sum + units, 0);

/** The OLD anchor, spelled out so the correction is driven rather than recalled.
    ⚠️ It is a COPY and it is labelled one: `ATTACK_DOES_NOTHING` is module-private,
    so this is the only way to compare the two reaches in one expression. §1 ties
    the copy to the live reader on both sides, which is what stops it rotting. */
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

  it("🛑 partitions the 9 refused BY WHICH ANCHOR — 1/2 behind `$`, 7/23 behind `^`, 1/2 behind both", () => {
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
    // 🛑 THE CLAIM D362 GOT WRONG, as an inequality: the `$` is worth an order of
    // magnitude less than the block it was priced at.
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
    expect(resolved).toHaveLength(350); // 🆕🆕 D372 **+2 SENTENCES** (the CROSS-BOARD EQUAL-ENERGY clause, printed under TWO sentences at 1 printing each, ONE new member + ONE literal row) — the first step on this line that is not +1 // 🆕🆕 D371 +1 sentence (the OPPONENT-RESISTANCE clause, 2 printings, ONE new member + ONE new template) // 🆕🆕 D370 +1 sentence (the bench-scoped {M} TYPE clause, 2 printings, ONE new member + ONE new template) // 🆕🆕 D369 +1 sentence (the cross-board Pokémon Tool clause, 2 printings) // 🆕🆕 D368 +1 sentence (Arven's Mabosstiff ex, 3 printings, ONE new member). // 🆕🆕 D367 +9 sentences (13 printings, ZERO new members). // 🆕🆕 D366 +1 sentence (Victini, 4 printings). // 330 at D362, 331 at D363, 🆕🆕 334 at D365 (+3 sentences / +5 printings, three more rows in the SAME table this file is about — the census this case pins is whole-corpus, so it moves whenever the table does)
    expect(p(resolved)).toBe(1231); // 🆕🆕 D372 +2. // 🆕🆕 D371 +2. // 🆕🆕 D370 +2. // 🆕🆕 D369 +2. // 🆕🆕 D368 +3. // 🆕🆕 D367 +13. // 🆕🆕 D366 +4. // 1,196 at D362, 1,198 at D363
    expect(residue).toHaveLength(290); // 🆕🆕 D372 -2 sentences // 🆕🆕 D371 -1 sentence // 🆕🆕 D370 -1 sentence // 🆕🆕 D369 -1 sentence // 🆕🆕 D368 -1 sentence // 🆕🆕 D367 -9 sentences // 🆕🆕 D366 -1 sentence
    expect(p(residue)).toBe(501); // 🆕🆕 D372 -2. // 🆕🆕 D371 -2. // 🆕🆕 D370 -2. // 🆕🆕 D369 -2. // 🆕🆕 D368 -3. // 🆕🆕 D367 -13. // 🆕🆕 D366 -4.
    expect(resolved.length + residue.length).toBe(rows.length);
    expect(p(resolved) + p(residue)).toBe(p(rows));
    // The one sentence that moved, named — a delta of 2 could otherwise be any
    // two printings at all.
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

  it("🛑 leaves the 16 coin-cancel printings on `deriveAttackCoinFlip` and nowhere else", () => {
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
    // D362's control, kept and inverted where it should invert. Palafin's row
    // reads today…
    expect(deriveAttackRequirement(PALAFIN)).toEqual({ kind: "yourActivePromotedThisTurn" });
    // …and NOW it keeps reading with the identical trailing sentence bolted on,
    // which is the whole diff. D362 asserted this returned null.
    expect(deriveAttackRequirement(`${PALAFIN} ${SAWK_TAIL}`)).toEqual({
      kind: "yourActivePromotedThisTurn",
    });
    // …and the split hands the companion back rather than eating it.
    expect(splitAttackRequirementClause(`${PALAFIN} ${SAWK_TAIL}`)).toEqual({
      clause: PALAFIN,
      body: SAWK_TAIL,
    });
    // A SINGLE-sentence printing is NOT a split — there is no body to return, and
    // returning `{body:""}` would make "is there a remainder" depend on a string.
    expect(splitAttackRequirementClause(PALAFIN)).toBeNull();
  });
});

describe("§3 — the clause-table row, ZERO new vocabulary, and the round trip", () => {
  it("maps the printed NEGATIVE onto D362's EXISTING positive member", () => {
    expect(deriveAttackRequirement(SAWK)).toEqual({ kind: "opponentActiveIsEx" });
    expect(deriveAttackRequirement(SAWK_HEAD)).toEqual({ kind: "opponentActiveIsEx" });
    // 🛑 THE NO-NEW-VOCABULARY CLAIM, DRIVEN: the note this member already
    // produced is the POSITIVE clause D362's bonus table keys on, and the printed
    // negative is that clause with "is" → "isn't". One member, two consequents.
    expect(conditionNote({ kind: "opponentActiveIsEx" })).toBe(
      "your opponent's Active Pokémon is a Pokémon ex",
    );
    expect(SAWK_HEAD).toBe(
      `If ${conditionNote({ kind: "opponentActiveIsEx" }).replace(" is a", " isn't a")}, this attack does nothing.`,
    );
  });

  it("keeps the two consequents DISJOINT — the negative never reaches the bonus table", () => {
    // D125's standing rule, re-asserted on the new pair: a clause read under
    // "does nothing" must not be reachable from "does N more damage" or back.
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
      expect(
        deriveAttackRequirement(`If ${clause}, this attack does nothing.`),
        clause,
      ).toBeNull();
    }
  });
});

describe("§4 — the split, and the accounting guard that makes it safe", () => {
  it("splits Sawk into the two sentences the engine already reads", () => {
    expect(splitAttackRequirementClause(SAWK)).toEqual({ clause: SAWK_HEAD, body: SAWK_TAIL });
    // Both halves read, SEPARATELY, by readers that predate this slice.
    expect(deriveAttackRequirement(SAWK_HEAD)).toEqual({ kind: "opponentActiveIsEx" });
    expect(deriveAttackDamageSuppression(SAWK_TAIL)).toEqual({ weakness: true, resistance: true });
    // 🛑 AND `DAMAGE_SUPPRESSION` IS BYTE-UNCHANGED: it still refuses the compound
    // WHOLE. What changed is the string the site hands it, not the anchor.
    expect(deriveAttackDamageSuppression(SAWK)).toBeNull();
  });

  it("🛑 refuses to strip a clause the TABLE does not carry — the accounting guard", () => {
    // The whole safety of the widening. An unmapped leading clause must keep its
    // WHOLE printed string, or the site would report only the remainder and a
    // printed requirement would be silently deleted.
    const unmapped = `If there is no Stadium in play, this attack does nothing. ${SAWK_TAIL}`;
    expect(deriveAttackRequirement(unmapped)).toBeNull();
    expect(splitAttackRequirementClause(unmapped)).toBeNull();
    // …and the leading sentence IS one the corpus prints and this engine refuses,
    // so the guard is driven on real text rather than a constructed near-miss.
    expect(
      legalAttackCorpus().some(
        ([, s]) => s === "If there is no Stadium in play, this attack does nothing.",
      ),
    ).toBe(true);
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
    // 🛑 AND NOTHING IS FLAGGED: both printed sentences are accounted for, so the
    // cancel is a SIMULATED outcome and not an unread one.
    expect(types(after.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("CANCELS into a Pokémon V — the board where this member and `…IsExOrV` disagree", () => {
    // D362 drove that disagreement under the POSITIVE consequent. Under the
    // NEGATIVE one the answer inverts, and a reused wider member would let the
    // attack through here instead of cancelling it.
    const after = mustApply(ready(62, "fix-pokemon-v"), { type: "attack", seat: "p1", index: 0 });
    expect(after.events.find((e) => e.type === "ATTACK_FAILED")).toMatchObject({
      reason: "requirement",
    });
    expect(types(after.events)).not.toContain("DAMAGE_DEALT");
  });

  it("🛑 lands 90 into an ex whose printed Weakness is Fighting ×2 — the SUPPRESSION half", () => {
    // The row's second sentence, observable: Okidogi ex prints Weakness Fighting
    // ×2 and Sawk is Fighting, so an engine that dropped the trailing sentence
    // would deal 180 here. The two answers are one `toBe` apart.
    expect(FIXTURE_POOL["sv06.5-036"]?.weaknesses).toEqual([{ type: "Fighting", value: "×2" }]);
    expect(FIXTURE_POOL["fix-sawk"]?.types).toEqual(["Fighting"]);
    const after = mustApply(ready(63, "sv06.5-036"), { type: "attack", seat: "p1", index: 0 });
    const hit = after.events.find((e) => e.type === "DAMAGE_DEALT");
    expect(hit).toMatchObject({ base: 90, dealt: 90 });
    expect(types(after.events)).not.toContain("ATTACK_FAILED");
    expect(types(after.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 REPORTS the companion it cannot read, naming the BODY and not the compound", () => {
    // The gate on `effectSimulated`. `fix-sawk` index 1 prints the SAME mapped
    // leading clause with a companion no reader resolves; without the gate the
    // requirement would set `effectSimulated` and this event would not exist.
    const after = mustApply(ready(64, "sv06.5-036"), { type: "attack", seat: "p1", index: 1 });
    const skipped = after.events.find((e) => e.type === "ATTACK_EFFECT_SKIPPED");
    expect(skipped).toBeDefined();
    // ⚠️ THE BODY ALONE — not the whole printed string. Naming the half the
    // engine still cannot read is D282's rule, inherited here.
    expect(skipped).toMatchObject({ effect: "Then, spin the wheel of fate." });
    // …and the requirement it DID read still gates the attack: this one lands,
    // because the Active IS an ex.
    expect(types(after.events)).not.toContain("ATTACK_FAILED");
  });

  it("🛑 keeps the WHOLE string loud when the leading clause is UNMAPPED", () => {
    // The accounting guard, on a board. `fix-sawk` index 2 prints an unmapped
    // leading clause with a companion the engine CAN read — so a split that
    // ignored the table would report nothing and apply a suppression whose
    // requirement it never enforced.
    const after = mustApply(ready(65, "sv06.5-036"), { type: "attack", seat: "p1", index: 2 });
    const skipped = after.events.find((e) => e.type === "ATTACK_EFFECT_SKIPPED");
    expect(skipped).toBeDefined();
    expect(skipped).toMatchObject({
      effect: `If there is no Stadium in play, this attack does nothing. ${SAWK_TAIL}`,
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
    // Measured on the remote D1 (`luminous`, 2026-08-18) rather than assumed: the
    // sentence returns ZERO rows on `effect` and ZERO on `abilities_json`, and
    // both `attacks_json` rows are `legal_standard = 1`. Recorded here as the two
    // printing ids, which is the half a test can re-check.
    const row = legalAttackCorpus().find(([, s]) => s === SAWK);
    expect(row?.[0]).toBe(2);
  });
});
