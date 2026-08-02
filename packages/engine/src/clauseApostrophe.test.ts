import { describe, expect, it } from "vitest";
import {
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  deriveAttackRequirement,
} from "./index";
import { FIXTURE_POOL } from "./testFixtures";

// D137 — THE APOSTROPHE FOLD, the literal-clause-table half of D136's hardening.
//
// D136 (the first `/code-review` this branch had since D96) found three regexes
// spelling `opponent's` straight-only while every sibling reading the SAME noun
// phrase carried `['’]` — a class `effects.ts` documents as existing "so a
// re-ingest changing only punctuation cannot silently un-derive" the sentence. It
// fixed the three and wrote the rest down rather than expanding into it: the
// LITERAL clause tables have the identical exposure, and A MAP KEY CANNOT CARRY A
// CHARACTER CLASS. One exact string of bytes, or nothing.
//
// So the hardening moved from the KEY to the LOOKUP. `literalClauseRow` (private
// to effects.ts) tries the clause as printed FIRST, and only on a miss retries it
// with U+2019 folded to U+0027. Every exact lookup on printed text in the engine
// goes through it — four tables, five call sites:
//
//   CONDITIONAL_DAMAGE_CLAUSES   19 rows, 5 with an apostrophe  (D115+)
//   ATTACK_REQUIREMENT_CLAUSES    2 rows, 2 with an apostrophe  (D125)
//   CLAUSE_ENERGY_TOKENS         19 rows, 0 — closed vocabulary (D118), 2 sites
//   CLAUSE_POKEMON_TYPES         11 rows, 0 — closed vocabulary (D120)
//
// THE SHAPE OF EVERY ASSERTION HERE IS THE ONE D136 ESTABLISHED: equality with
// the straight form, never merely "the curly one is non-null". The apostrophe
// carries NO meaning, so the two spellings must produce the SAME value — a test
// that only checked for non-null would pass on a reader that folded the clause
// into some other row entirely.
//
// AND THE FOLD IS APOSTROPHE-ONLY, WHICH IS HALF OF WHAT THIS SUITE PINS. No
// lowercasing, no trimming, no Unicode normalisation of the é in `Pokémon`: the
// tables commit to a real U+00E9 and to a matcher with no /i, and those
// commitments are load-bearing. The negative block below is what stops a later
// session "improving" the fold into a general normaliser, which would owe a
// row-by-row argument that no two distinct printed clauses collide under it.
//
// Reader-level on purpose. The fold is a property of five pure functions, and
// every row it protects is already driven end-to-end by the slice suite that
// bought it (conditionalDamage, attackRequirement, typeNameClause, promotedClause
// and their neighbours). Re-driving a match here would re-assert those slices,
// not this one.

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

/** The five printed-text readers, by name — the complete set `attack.ts` calls
    (see effects.ts's disjointness note). Named so a failure says WHICH reader
    lost the sentence. */
const READERS = {
  damageBonus: deriveAttackDamageBonus,
  damageMultiplier: deriveAttackDamageMultiplier,
  requirement: deriveAttackRequirement,
  effect: deriveAttackEffect,
  coinFlip: deriveAttackCoinFlip,
} as const;

describe("the U+2019 fold — every apostrophe-bearing sentence the fixtures print", () => {
  /** Every distinct printed attack effect in FIXTURE_POOL that carries an
      apostrophe AND that at least one reader resolves. DISCOVERED, not listed:
      the sentences this suite must cover are exactly the ones the engine derives
      today, so a row (or a regex, or a template) added by a later slice is swept
      the day its fixture lands rather than the day somebody remembers to add it
      here. */
  const derivable: { sentence: string; ids: string[] }[] = [];
  for (const [id, card] of Object.entries(FIXTURE_POOL)) {
    for (const attack of card.attacks ?? []) {
      const sentence = attack.effect ?? "";
      if (!sentence.includes(APOS)) continue;
      if (Object.values(READERS).every((read) => read(sentence) === null)) continue;
      const existing = derivable.find((entry) => entry.sentence === sentence);
      if (existing === undefined) derivable.push({ sentence, ids: [id] });
      else existing.ids.push(id);
    }
  }

  it("finds the census it is supposed to sweep", () => {
    // 41 distinct sentences at D145 — UNCHANGED from D144, and that is a result
    // rather than an omission. D145 added THREE fixtures (Pikachu ex sv02-063,
    // Beartic sv03-054, Oinkologne sv03-183) and its two mapped sentences carry
    // NO APOSTROPHE AT ALL — the first pair in the tails family with no D136/D137
    // exposure to class. The one apostrophe-bearing sentence those fixtures print
    // is Oinkologne's index-0 "Confounding Cologne" ("Your opponent's Active
    // Pokémon is now Confused."), which `fix-statuser` has printed since M2 — so
    // it adds an ID to an existing row and not a row, which is exactly what a
    // `sentence` census is supposed to do.
    // 41 distinct sentences at D144 (40 at D143, 38 at D142, 36 at D140/D141, 35
    // at D139, 33 at D138, 32 at D137). D144 added ONE — the TAILS-gated self-lock
    // ("Flip a coin. If tails, during your next turn, this Pokémon can't attack."),
    // carried by BOTH of its new fixtures (Oinkologne sv01-157 and Paldean
    // Clodsire ex sv02-130) and therefore ONE row on a `sentence` census, exactly
    // as D140's Land Scoop was. Its exposed slot is the same CONTRACTION D143's
    // pair introduced, on a regex written a whole slice later — which is precisely
    // what a DISCOVERED census is for: nobody had this file open.
    // D143 added TWO — Alomomola sv01-048's "Aqua Slash"
    // ("During your next turn, this Pokémon can't attack.") and Ninetales
    // sv03-029's "Nine-Tailed Dance" (that sentence again, behind a counter PUT) —
    // and they are the first entries here whose apostrophes are CONTRACTIONS
    // rather than possessives on one of them and both kinds on the other, which
    // is precisely the asymmetry D137 found `ATTACK_REQUIREMENT_CLAUSES` exposed
    // on. Both regexes class every slot, and this sweep is what proves it.
    // D142 added TWO — Scyther sv03-004's "Agility" and Togedemaru
    // sv03-151's "Defense Curl", the gated PREVENT clause's two printed
    // spellings, both carrying "your opponent's" — and they were swept the moment
    // the fixtures landed, which is exactly what this census is for: neither
    // regex was written with this file open, and both are now proven to survive a
    // U+2019 re-ingest by the same assertion that covers the other 36. D141 added
    // none (it added no apostrophe-bearing fixture). D138
    // added one — Dedenne ex sv02-093's "Tail Swap" — D139 added TWO at once,
    // Mimikyu sv02-097's "Ghost Eye" and Polteageist sv03-098's "Pour Tea" (the
    // same shape at two different counts, so two distinct sentences), and D140
    // added ONE, Ting-Lu ex sv02-127's "Land Scoop" — four PRINTINGS of it in the
    // catalog but only one fixture and, being a `sentence` census, only one row.
    // Each landed here the day its FIXTURE did, which is the whole design.
    // THE NUMBER MOVES WITH THE FIXTURES, not with
    // this file: it is here so that a slice which adds an apostrophe-bearing
    // printing has to look at this suite once and confirm the new sentence folds,
    // rather than silently widening the pool it does not cover. If it drops, a
    // reader stopped deriving something and the failure belongs here as much as in
    // the slice suite that owns it.
    expect(derivable).toHaveLength(41);
    // Every entry names at least one real card id — the sweep read fixtures, not
    // constructed text.
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
          read(sentence),
        );
      }
      // And at least one of them still says something — equality alone would be
      // satisfied by all five going null together, which is precisely the
      // regression this suite exists to catch.
      expect(Object.values(READERS).some((read) => read(rewritten) !== null)).toBe(true);
    }
  });
});

/** The five `CONDITIONAL_DAMAGE_CLAUSES` rows whose key holds an apostrophe,
    written as the whole printed sentence D115's skeleton reads. Listed as well as
    swept: the sweep proves the fixtures survive a re-ingest, this proves the
    specific rows the fold was built for do — and it keeps saying so if a fixture
    is ever renumbered out of the pool. Amounts are the printed ones. */
const APOSTROPHE_BONUS_SENTENCES = [
  // Gyarados ex sv01-045/-225 "Tyrannical Tail" — the "already" row.
  "If your opponent's Active Pokémon already has any damage counters on it, this attack does 180 more damage.",
  // Seviper sv02-137 "Cross-Cut" — the Evolution row (D105's reading).
  "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 50 more damage.",
  // Seviper sv01-128 "Venoshock" — the CROSS-BOARD Poison row. Its own-board twin
  // ("If this Pokémon is Poisoned") is one possessive away and carries NO
  // apostrophe, which is exactly why the keys are whole clauses (D116).
  "If your opponent's Active Pokémon is Poisoned, this attack does 120 more damage.",
  // Sableye sv02-136 "Unseen Claw" — the pool's only "is affected by" clause.
  "If your opponent's Active Pokémon is affected by a Special Condition, this attack does 70 more damage.",
  // Ceruledge sv02-098 "Fighting Sword" — the ex-or-V row, NOT a `hasRuleBox` read.
  "If your opponent's Active Pokémon is a Pokémon ex or Pokémon V, this attack does 100 more damage.",
] as const;

/** Both `ATTACK_REQUIREMENT_CLAUSES` rows — the whole table, and both keys carry
    an apostrophe (a CONTRACTION in one, a POSSESSIVE in the other, so the fold is
    exercised on both grammatical uses the pool prints). */
const APOSTROPHE_REQUIREMENT_SENTENCES = [
  // Palafin sv03-062/-200 "Justice Kick" — "didn't", the contraction. Note "the
  // Bench", NOT "your Bench": the trap D125's doc block flags, untouched by this.
  "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.",
  // Lycanroc sv03-117 "Finishing Fang" — the possessive, and the pool's longest
  // clause key.
  "If your opponent's Active Pokémon has no damage counters on it before this attack does damage, this attack does nothing.",
] as const;

describe("the literal clause tables — the rows the fold was built for", () => {
  it("folds all FIVE apostrophe rows of CONDITIONAL_DAMAGE_CLAUSES", () => {
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

  it("folds BOTH rows of ATTACK_REQUIREMENT_CLAUSES — contraction and possessive", () => {
    for (const sentence of APOSTROPHE_REQUIREMENT_SENTENCES) {
      const straight = deriveAttackRequirement(sentence);
      expect(straight).not.toBeNull();
      expect(deriveAttackRequirement(curly(sentence))).toEqual(straight);
    }
  });

  it("keeps the two consequents' vocabularies DISJOINT under the fold", () => {
    // D125's rule, re-asserted in the curly spelling: sharing the lookup HELPER is
    // not sharing the TABLE. A clause meaning "does 120 more damage if X" must
    // stay unreachable from a sentence meaning "does nothing if X", and a fold
    // that had been written as one normalised table instead of one function taking
    // a table would have quietly merged them.
    for (const sentence of APOSTROPHE_BONUS_SENTENCES) {
      expect(deriveAttackRequirement(curly(sentence))).toBeNull();
    }
    for (const sentence of APOSTROPHE_REQUIREMENT_SENTENCES) {
      expect(deriveAttackDamageBonus(curly(sentence))).toBeNull();
    }
  });

  it("leaves the apostrophe-FREE rows exactly where they were", () => {
    // Fourteen of the nineteen conditional rows spell no apostrophe at all, so the
    // fold must be a no-op for them — `literalClauseRow` never allocates a second
    // string for text with no U+2019 in it. Three representatives, one per shape
    // the table holds (bare tag, parameterised member, card NAME).
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
    // The tables' doc blocks commit to a real U+00E9, verified against the D1
    // rows, and an ASCII "Pokemon" is a DIFFERENT STRING that must stay LOUD. This
    // is the assertion that stops the fold growing into a general normaliser: an
    // NFKD-and-strip pass would make this pass and would then owe a row-by-row
    // argument that no two printed clauses collide, which nobody has made.
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
    // The whole point of a literal table is that an unrecognised clause returns
    // null and keeps its loud ATTACK_EFFECT_SKIPPED row — never a silent 0. The
    // fold widens WHICH BYTES reach a row; it must not widen WHICH ROWS exist.
    // Okidogi ex's real own-board clause under the wrong possessive, and a clause
    // the pool prints under a consequent this skeleton never reaches.
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
    // `OPPONENT_ACTIVE_TYPE_CLAUSE` carries the class in its own source (D136), so
    // the curly sentence never reaches the fold at all: the literal table misses
    // it in BOTH spellings and the pattern claims it. Asserted here so the two
    // mechanisms stay legible as two — if a later session deleted the class on the
    // grounds that "the fold handles it", the literal pass would still miss and
    // this would go red.
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
    // These two regexes were the last straight-only patterns in effects.ts. D136
    // named three and fixed three; it did not look for a sentence carrying TWO
    // possessives, and this pair carries the only ones in the pool. Both slots now
    // hold `['’]`, so the additive and multiply twins fold together — half a fix
    // reads exactly like the whole one until a re-ingest lands.
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
