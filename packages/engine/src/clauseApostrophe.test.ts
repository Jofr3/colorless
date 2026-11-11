import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackBonusConsequent, ATTACK_READERS } from "./effects";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  deriveAttackRequirement,
  splitAttackTrailingClause,
} from "./index";
import { FIXTURE_POOL } from "./testFixtures";

/** U+2019, spelled as an escape rather than pasted: this file is ABOUT the
    difference between two characters that render nearly identically, so every
    occurrence of the curly one is written where a reader can see which it is. */
const RSQUO = "’";
/** U+0027, the form the catalog actually prints. */
const APOS = "'";

/** The straight → curly rewrite a punctuation-normalising re-ingest would do. */
function curly(text: string): string {
  return text.replaceAll(APOS, RSQUO);
}

function foldNotes<T>(derived: T): T {
  if (Array.isArray(derived)) return derived.map((entry) => foldNotes(entry)) as T;
  if (derived === null || typeof derived !== "object") return derived;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(derived as Record<string, unknown>)) {
    out[key] = key === "note" && typeof value === "string" ? curly(value) : foldNotes(value);
  }
  return out as T;
}

const READERS = Object.fromEntries(ATTACK_READERS.map(({ name, read }) => [name, read]));

describe("the U+2019 fold — every apostrophe-bearing sentence the fixtures print", () => {
  const derivable: { sentence: string; ids: string[] }[] = [];
  for (const [id, card] of Object.entries(FIXTURE_POOL)) {
    for (const attack of card.attacks ?? []) {
      const sentence = attack.effect ?? "";
      if (!sentence.includes(APOS)) continue;
      if (!resolvedByAnyReader(sentence) && splitAttackTrailingClause(sentence) === null) {
        continue;
      }
      const existing = derivable.find((entry) => entry.sentence === sentence);
      if (existing === undefined) derivable.push({ sentence, ids: [id] });
      else existing.ids.push(id);
    }
  }

  it("finds the census it is supposed to sweep", () => {
    expect(derivable).toHaveLength(193);
    for (const entry of derivable) expect(entry.ids.length).toBeGreaterThanOrEqual(1);
  });

  it("derives the U+2019 spelling IDENTICALLY on every reader", () => {
    for (const { sentence, ids } of derivable) {
      const rewritten = curly(sentence);
      // The rewrite actually fired — otherwise the loop below asserts nothing.
      expect(rewritten).not.toBe(sentence);
      expect(rewritten).toContain(RSQUO);
      for (const [name, read] of Object.entries(READERS)) {
        expect(read(rewritten), `${name} lost ${ids.join("/")}: ${sentence}`).toEqual(
          foldNotes(read(sentence)),
        );
      }
      const split = splitAttackTrailingClause(sentence);
      if (split === null) {
        expect(Object.values(READERS).some((read) => read(rewritten) !== null)).toBe(true);
        continue;
      }
      const rewrittenSplit = splitAttackTrailingClause(rewritten);
      expect(rewrittenSplit, `composition lost ${ids.join("/")}: ${sentence}`).not.toBeNull();
      const composed = (parts: { head: string; tail: string }): unknown[] => [
        ...(deriveAttackEffect(parts.head) ?? []),
        ...(deriveAttackEffect(parts.tail) ?? []),
      ];
      expect(composed(rewrittenSplit as { head: string; tail: string })).toEqual(
        foldNotes(composed(split)),
      );
    }
  });
});

const APOSTROPHE_BONUS_SENTENCES = [
  "If your opponent's Active Pokémon already has any damage counters on it, this attack does 180 more damage.",
  "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 50 more damage.",
  "If your opponent's Active Pokémon is Poisoned, this attack does 120 more damage.",
  // Sableye sv02-136 "Unseen Claw" — the pool's only "is affected by" clause.
  "If your opponent's Active Pokémon is affected by a Special Condition, this attack does 70 more damage.",
  "If your opponent's Active Pokémon is a Pokémon ex or Pokémon V, this attack does 100 more damage.",
  "If any of your Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 60 more damage.",
  "If any of your Ethan's Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 100 more damage.",
  "If your opponent's Active Pokémon is a Pokémon ex, this attack does 90 more damage.",
  "If your opponent's Active Pokémon is a Stage 1 Pokémon, this attack does 90 more damage.",
  "If your opponent's Active Pokémon is a Stage 2 Pokémon, this attack does 140 more damage.",
  "If your opponent's Active Pokémon is a Tera Pokémon, this attack does 230 more damage.",
  "If this Pokémon and your opponent's Active Pokémon have the same amount of Energy attached, this attack does 100 more damage.",
  "If this Pokémon has more Energy attached than your opponent's Active Pokémon, this attack does 160 more damage.",
  "If your opponent's Active Pokémon has a Pokémon Tool attached, this attack does 80 more damage.",
  "If this Pokémon has any Team Rocket's Energy attached, this attack does 60 more damage.",
  "If any of your Pokémon in play are the same type as any of your opponent's Pokémon in play, this attack does 120 more damage.",
  "If your opponent's Active Pokémon is Burned, this attack does 40 more damage.",
  "If your opponent's Active Pokémon is Confused, this attack does 90 more damage.",
  "If the Retreat Cost of your opponent's Active Pokémon is {C}{C} or more, this attack does 110 more damage.",
  "If this Pokémon evolved from Misty's Staryu during this turn, this attack does 80 more damage.",
] as const;

function carriedBonusClauses(): ReadonlySet<string> {
  const BONUS = /^If (.+), this attack does \d+ more damage\.$/;
  const carried = new Set<string>();
  for (const [, printed] of legalAttackCorpus()) {
    const clause = BONUS.exec(printed.trim())?.[1];
    if (clause === undefined) continue;
    if (deriveAttackDamageBonus(printed) === null) continue;
    carried.add(clause);
  }
  return carried;
}

const APOSTROPHE_REQUIREMENT_SENTENCES = [
  "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.",
  "If your opponent's Active Pokémon has no damage counters on it before this attack does damage, this attack does nothing.",
  "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing.",
  "If you don't have the same number of cards in your hand as your opponent, this attack does nothing.",
  "If your opponent doesn't have exactly 3 or 4 Prize cards remaining, this attack does nothing.",
  "If you don't have Uxie and Azelf on your Bench, this attack does nothing.",
  "If your opponent's Active Pokémon isn't Burned, this attack does nothing.",
  "If you don't have exactly 3 cards in your hand, this attack does nothing.",
] as const;

function carriedClauseSentences(): ReadonlySet<string> {
  const HEAD = /^(If .+?, this attack does nothing\.)/;
  const carried = new Set<string>();
  for (const [, printed] of legalAttackCorpus()) {
    if (deriveAttackRequirement(printed) === null) continue;
    carried.add(HEAD.exec(printed.trim())?.[1] ?? printed.trim());
  }
  return carried;
}

describe("the literal clause tables — the rows the fold was built for", () => {
  it("folds all NINE apostrophe rows of CONDITIONAL_DAMAGE_CLAUSES", () => {
    for (const sentence of APOSTROPHE_BONUS_SENTENCES) {
      const straight = deriveAttackDamageBonus(sentence);
      // The straight form is the baseline and must still resolve — the fold is a
      // FALLBACK behind an exact hit, so this is the assertion that proves the
      // exact hit is still the one being taken.
      expect(straight).not.toBeNull();
      expect(straight?.count.kind).toBe("boardCondition");
      expect(deriveAttackDamageBonus(curly(sentence))).toEqual(straight);
    }
  });

  it("D367 — the BONUS list is COMPLETE, re-derived from the live bonus reader", () => {
    const carried = carriedBonusClauses();
    const withApostrophe = [...carried].filter((clause) => clause.includes(APOS));
    expect(carried.size).toBe(60);
    expect(withApostrophe).toHaveLength(24);
    const TEMPLATE_OWNED = [
      "your opponent's Active Pokémon has {F} Resistance",
      "your opponent's Active Pokémon is a {D} Pokémon",
      "your opponent's Active Pokémon is a {P} Pokémon",
    ];
    const ANCHOR_OWNED = [
      "this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost)",
    ];
    const rowClauses = withApostrophe.filter(
      (clause) => !TEMPLATE_OWNED.includes(clause) && !ANCHOR_OWNED.includes(clause),
    );
    expect(rowClauses).toHaveLength(20);
    expect(APOSTROPHE_BONUS_SENTENCES).toHaveLength(20);
    expect(rowClauses.length + TEMPLATE_OWNED.length + ANCHOR_OWNED.length).toBe(
      withApostrophe.length,
    );
    // …and the third bucket really is carried, so an empty `ANCHOR_OWNED` could not
    // satisfy the arithmetic by accident.
    for (const clause of ANCHOR_OWNED) expect(withApostrophe, clause).toContain(clause);
    const listedClauses = APOSTROPHE_BONUS_SENTENCES.map(
      (sentence) => /^If (.+), this attack does \d+ more damage\.$/.exec(sentence)?.[1] ?? sentence,
    );
    expect([...rowClauses].sort()).toEqual([...listedClauses].sort());
    // And every listed sentence really resolves — a list that had drifted onto a
    // clause the table dropped would otherwise pass the set check vacuously.
    for (const sentence of APOSTROPHE_BONUS_SENTENCES) {
      expect(deriveAttackDamageBonus(sentence), sentence).not.toBeNull();
    }
    for (const clause of TEMPLATE_OWNED) {
      expect(
        deriveAttackDamageBonus(`If ${clause}, this attack does 30 more damage.`),
      ).not.toBeNull();
    }
    for (const clause of ANCHOR_OWNED) {
      expect(
        deriveAttackBonusConsequent(
          `If ${clause}, this attack does 80 more damage, and discard all Energy from this Pokémon.`,
        ),
        clause,
      ).toBeNull();
      expect(
        deriveAttackBonusConsequent(
          "If this Pokémon has no damage counters on it, this attack does 80 more damage, and discard all Energy from this Pokémon.",
        ),
      ).not.toBeNull();
    }
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a Psychic Pokémon, this attack does 30 more damage.",
      ),
    ).toEqual(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a {P} Pokémon, this attack does 30 more damage.",
      ),
    );
  });

  it("D367 — and the APOSTROPHE-FREE bonus clauses are accounted for too", () => {
    const carried = carriedBonusClauses();
    const without = [...carried].filter((clause) => !clause.includes(APOS)).sort();
    expect(without).toHaveLength(36);
    expect(without).toEqual(
      [
        'a Pokémon that has "Nidoking" in its name is on your Bench',
        "1 of your other Ancient Pokémon used an attack during your last turn",
        "a Stadium is in play",
        "all of your Benched Pokémon have at least 1 damage counter on them",
        "any of your Benched Cubone have any damage counters on them",
        "Beldum and Metang are on your Bench",
        "Durant is on your Bench",
        "Illumise is on your Bench",
        "Mightyena is on your Bench",
        "there are 3 or fewer cards in your deck",
        "this Pokémon evolved from Gimmighoul during this turn",
        "this Pokémon has 2 or more {G} Energy attached",
        "this Pokémon has a Pokémon Tool attached",
        "this Pokémon has any Special Energy attached",
        "this Pokémon has any {F} Energy attached",
        "this Pokémon has any {L} Energy attached",
        "this Pokémon has no damage counters on it",
        "this Pokémon is Poisoned",
        "this Pokémon moved from your Bench to the Active Spot this turn",
        "this Pokémon used Form Ranks during your last turn",
        "this Pokémon used Pervasive Gas during your last turn",
        "this Pokémon was healed during this turn",
        "you have any {M} Pokémon on your Bench",
        "you have any Tera Pokémon on your Bench",
        "you have 10 or more Basic {R} Energy cards in your discard pile",
        "you have at least 3 {D} Energy in play",
        "you have more Prize cards remaining than your opponent",
        "you have the same number of cards in your hand as your opponent",
        "your Benched Pokémon have any damage counters on them",
        "your opponent has 3 or fewer cards in their hand",
        "your opponent has 3 or more Benched Pokémon",
        "your opponent has 4 or fewer Prize cards remaining",
        "your opponent has 5 or fewer cards in their hand",
        "your opponent has any {W} Pokémon in play",
        "your opponent has any Future Pokémon in play",
        "you played a Future Supporter card from your hand during this turn",
      ].sort(),
    );
    expect(without.length + 24).toBe(carried.size);
    expect(carried.size).toBe(60);
    const D367_APOSTROPHE_FREE = [
      "Beldum and Metang are on your Bench",
      "Durant is on your Bench",
      "Illumise is on your Bench",
      "Mightyena is on your Bench",
      "your opponent has 4 or fewer Prize cards remaining",
      "your opponent has 5 or fewer cards in their hand",
    ];
    expect(D367_APOSTROPHE_FREE).toHaveLength(6);
    for (const clause of D367_APOSTROPHE_FREE) expect(without, clause).toContain(clause);
    expect(without.filter((c) => c.includes("or fewer"))).toHaveLength(4);
  });

  it("folds ALL SIX rows of ATTACK_REQUIREMENT_CLAUSES — contraction, possessive, and both at once", () => {
    for (const sentence of APOSTROPHE_REQUIREMENT_SENTENCES) {
      const straight = deriveAttackRequirement(sentence);
      expect(straight, sentence).not.toBeNull();
      expect(deriveAttackRequirement(curly(sentence)), sentence).toEqual(straight);
    }
  });

  it("D365 — the list is COMPLETE, re-derived from the live reader and not from the comment", () => {
    const carried = carriedClauseSentences();
    const withApostrophe = [...carried].filter((s) => s.includes(APOS));
    expect(carried.size).toBe(9);
    expect(withApostrophe).toHaveLength(7);
    for (const sentence of withApostrophe) {
      expect(APOSTROPHE_REQUIREMENT_SENTENCES).toContain(sentence);
    }
    const dead = APOSTROPHE_REQUIREMENT_SENTENCES.filter((s) => !carried.has(s));
    expect(dead).toEqual([
      "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.",
    ]);
    expect(APOSTROPHE_REQUIREMENT_SENTENCES).toHaveLength(8);
    for (const sentence of APOSTROPHE_REQUIREMENT_SENTENCES) {
      expect(deriveAttackRequirement(sentence), sentence).not.toBeNull();
    }
  });

  it("D366 — and the APOSTROPHE-FREE rows are accounted for too, off the same live reader", () => {
    const carried = carriedClauseSentences();
    const withoutApostrophe = [...carried].filter((s) => !s.includes(APOS)).sort();
    expect(withoutApostrophe).toEqual([
      "If there is no Stadium in play, this attack does nothing.",
      "If you have 4 or fewer Benched Pokémon, this attack does nothing.",
    ]);
    // The two halves PARTITION the carried set — parts that do not add up are not
    // a partition, however carefully each half is named.
    expect([...carried].filter((s) => s.includes(APOS)).length + withoutApostrophe.length).toBe(
      carried.size,
    );
    // …and the fold really is a NO-OP on this key, which is the property that made
    // it wrong to list it above: rewriting an apostrophe it does not contain
    // changes nothing, so the "folds identically" claim would have been vacuous.
    for (const sentence of withoutApostrophe) {
      expect(curly(sentence), sentence).toBe(sentence);
      expect(deriveAttackRequirement(sentence), sentence).not.toBeNull();
    }
  });

  it("keeps the two consequents' vocabularies DISJOINT under the fold", () => {
    for (const sentence of APOSTROPHE_BONUS_SENTENCES) {
      expect(deriveAttackRequirement(curly(sentence))).toBeNull();
    }
    for (const sentence of APOSTROPHE_REQUIREMENT_SENTENCES) {
      expect(deriveAttackDamageBonus(curly(sentence))).toBeNull();
    }
  });

  it("leaves the apostrophe-FREE rows exactly where they were", () => {
    const untouched = [
      "If you have a Stadium in play, this attack does 80 more damage.",
      "If you have at least 3 {D} Energy in play, this attack does 50 more damage.",
      "If Falinks is on your Bench, this attack does 90 more damage.",
    ];
    for (const sentence of untouched) {
      expect(sentence).not.toContain(APOS);
      expect(deriveAttackDamageBonus(sentence)).not.toBeNull();
      expect(deriveAttackDamageBonus(curly(sentence))).toEqual(deriveAttackDamageBonus(sentence));
    }
  });
});

describe("the fold is APOSTROPHE-ONLY — the scope guard", () => {
  it("does NOT fold the é in Pokémon", () => {
    const asciiE =
      "If your opponent's Active Pokemon is Poisoned, this attack does 120 more damage.";
    expect(deriveAttackDamageBonus(asciiE)).toBeNull();
    expect(deriveAttackDamageBonus(curly(asciiE))).toBeNull();
  });

  it("does NOT lowercase — the matcher still has no /i", () => {
    // `Poisoned`, `Active`, `Benched`, `Evolution` and `Special Condition` are
    // capitalised as printed and told from ordinary words by nothing else.
    const lowered =
      "If your opponent's Active Pokémon is poisoned, this attack does 120 more damage.";
    expect(deriveAttackDamageBonus(lowered)).toBeNull();
    expect(deriveAttackDamageBonus(curly(lowered))).toBeNull();
  });

  it("does NOT trim inside the clause", () => {
    // The readers trim the SENTENCE (`text.trim()`); nothing trims or collapses
    // whitespace within it, and the fold added no such pass. A doubled space is a
    // different clause and stays loud in both spellings.
    const doubled =
      "If your opponent's Active  Pokémon is Poisoned, this attack does 120 more damage.";
    expect(deriveAttackDamageBonus(doubled)).toBeNull();
    expect(deriveAttackDamageBonus(curly(doubled))).toBeNull();
  });

  it("does not invent a row for an UNMAPPED clause in either spelling", () => {
    const unmapped = [
      "If your opponent's Pokémon is Poisoned, this attack does 120 more damage.",
      "If your opponent's Active Pokémon is a Basic Pokémon, this attack does 60 more damage.",
    ];
    for (const sentence of unmapped) {
      expect(deriveAttackDamageBonus(sentence)).toBeNull();
      expect(deriveAttackDamageBonus(curly(sentence))).toBeNull();
      expect(deriveAttackRequirement(curly(sentence))).toBeNull();
    }
  });
});

describe("the TEMPLATE pass is untouched — the fold applies to the literal pass", () => {
  it("still reads D120's type template through its own `['’]` class", () => {
    const wonderFlash =
      "If your opponent's Active Pokémon is a Dragon Pokémon, this attack does 90 more damage.";
    const bonus = deriveAttackDamageBonus(wonderFlash);
    expect(bonus?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentActiveHasType", type: "Dragon" },
    });
    expect(deriveAttackDamageBonus(curly(wonderFlash))).toEqual(bonus);
  });

  it("still reads D118's energy template, whose token can hold no apostrophe", () => {
    // The clause carries no possessive, so this is not a fold case — it is the
    // proof that routing the TOKEN maps through `literalClauseRow` changed nothing
    // for the closed vocabularies. Both notations, since the pool prints both.
    const braced = "If this Pokémon has any {R} Energy attached, this attack does 90 more damage.";
    const spelled =
      "If this Pokémon has any Fire Energy attached, this attack does 90 more damage.";
    for (const sentence of [braced, spelled]) {
      expect(deriveAttackDamageBonus(sentence)?.count).toEqual({
        kind: "boardCondition",
        cond: { kind: "yourActiveHasEnergyAttached", energy: "Fire" },
      });
    }
    // An unresolvable token still falls through to null — the fold did not turn a
    // miss into a member.
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon has any {C} Energy attached, this attack does 90 more damage.",
      ),
    ).toBeNull();
  });

  it("reads the retreat-cost pair in BOTH spellings — D137's census finding", () => {
    const additive =
      "This attack does 30 more damage for each {C} in your opponent's Active Pokémon's Retreat Cost.";
    const multiply =
      "This attack does 50 damage for each {C} in your opponent's Active Pokémon's Retreat Cost.";
    expect(curly(additive).split(RSQUO)).toHaveLength(3); // both possessives rewritten
    expect(deriveAttackDamageBonus(curly(additive))).toEqual(deriveAttackDamageBonus(additive));
    expect(deriveAttackDamageBonus(additive)?.count).toEqual({
      kind: "opponentActiveRetreatCost",
    });
    expect(deriveAttackDamageMultiplier(curly(multiply))).toEqual(
      deriveAttackDamageMultiplier(multiply),
    );
    expect(deriveAttackDamageMultiplier(multiply)?.count).toEqual({
      kind: "opponentActiveRetreatCost",
    });
  });
});
