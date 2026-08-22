import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { deriveAttackDamageBonus } from "./effects";
import type { BoardCondition } from "./index";

// 🆕🆕 D390 — THE CROSS-PRODUCT RUNG, AND IT IS WRITTEN *BEFORE* THE FIFTH
// PATTERN IT EXISTS TO GUARD.
//
// 🛑 **`boardConditionForClause` HOLDS FOUR ANCHORED TEMPLATE PATTERNS, AND EACH
// ONE WAS APPENDED LAST ON THE SAME STATED GROUND: "the patterns are mutually
// exclusive at their anchors, so order decides nothing."** That sentence is in
// `effects.ts` FOUR times, once per pattern — and it is a CLAIM ABOUT THE WHOLE
// SET that not one line of this suite executed. It is the shape this repo keeps
// rediscovering (conventions, "A guard must be able to go RED"): an invariant
// stated in four comments is executed by none of them, and the fifth pattern is
// exactly the edit that can falsify it **silently**, because a pattern that
// claims a clause an earlier one owns is INVISIBLE from the outside — the
// earlier pattern still wins, still returns the right member, and nothing moves
// until the two are reordered or one of them declines.
//
// ⚠️ **SO THE GUARD WAS WRITTEN FIRST AND THE PATTERN SECOND**, which is the only
// order in which "the guard existed before the thing it guards against" is a
// fact rather than a story. At the head this file first landed on, the fifth row
// of `TEMPLATES` carried `cond: null` — the sentence was REAL and PRINTED and
// nothing in the engine claimed it — so the file was also the tripwire that
// fires the day it is built. 🆕 **D390 BUILT IT AND THE TRIPWIRE FIRED**: the row
// now carries `opponentInPlayHasType`, and NOT ONE of the twenty hybrids below
// changed, which is the whole content of the claim the four comments made.
//
// **HOW THE CROSS PRODUCT IS DRIVEN, AND WHY THIS SHAPE RATHER THAN A REGEX
// READ.** Every pattern here is `^<head><token><tail>$`, so the falsifiable
// question is whether pattern *j*'s tail can be reached from pattern *i*'s head.
// §2 builds every one of those N×(N−1) hybrids and requires each to be REFUSED.
// It goes RED for the loosening it is aimed at: drop the ` in play$` tail from
// the fifth pattern and `"your opponent has any {W} Pokémon on your Bench"`
// resolves to the in-play member — a Bench clause answered by a whole-board
// predicate, green everywhere the two happen to agree.
//
// 🛑 **AND THE ONE PLACE ORDER *IS* LOAD-BEARING IS PINNED SEPARATELY (§4).**
// The templates are disjoint from each other; they are NOT disjoint from the
// LITERAL table. `"your opponent's Active Pokémon is a Stage 1 Pokémon"` matches
// `OPPONENT_ACTIVE_TYPE_CLAUSE` and is a `CONDITIONAL_DAMAGE_CLAUSES` row, and
// the row wins **because the literal pass runs first** — the resolver's one real
// ordering dependency, stated as a rung so a successor cannot read "order
// decides nothing" as a claim about the whole function.

const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

/** One anchored template pattern of `boardConditionForClause`, split at the two
    seams the anchor is made of. `head` + `token` + `tail` is the printed CLAUSE
    byte for byte, and `per` is the amount the printed sentence carries — so the
    row is authored from the catalog rather than from a paraphrase (D183), and
    §1 re-derives `printings` off `legalAttackCorpus()` rather than trusting it.

    `cond` is the member the sentence resolves to, or **null** when the shape is
    real and printed and NOT BUILT at this head. */
type Template = {
  /** The pattern constant's name in `effects.ts` — this file cannot import it
      (they are module-private, deliberately) so the name is carried as a label
      and the BEHAVIOUR is what gets asserted. */
  readonly pattern: string;
  readonly head: string;
  readonly token: string;
  readonly tail: string;
  readonly per: number;
  readonly printings: number;
  readonly cond: BoardCondition | null;
};

const TEMPLATES: readonly Template[] = [
  {
    pattern: "SELF_ENERGY_ATTACHED_CLAUSE",
    head: "this Pokémon has any ",
    token: "{L}",
    tail: " Energy attached",
    per: 80,
    printings: 1,
    cond: { kind: "yourActiveHasEnergyAttached", energy: "Lightning" },
  },
  {
    pattern: "OPPONENT_ACTIVE_TYPE_CLAUSE",
    head: "your opponent's Active Pokémon is a ",
    token: "{P}",
    tail: " Pokémon",
    per: 30,
    printings: 2,
    cond: { kind: "opponentActiveHasType", type: "Psychic" },
  },
  {
    pattern: "YOUR_BENCH_TYPE_CLAUSE",
    head: "you have any ",
    token: "{M}",
    tail: " Pokémon on your Bench",
    per: 80,
    printings: 2,
    cond: { kind: "yourBenchHasType", type: "Metal" },
  },
  {
    pattern: "OPPONENT_ACTIVE_RESISTANCE_CLAUSE",
    head: "your opponent's Active Pokémon has ",
    token: "{F}",
    tail: " Resistance",
    per: 50,
    printings: 2,
    cond: { kind: "opponentActiveHasResistance", type: "Fighting" },
  },
  {
    // 🆕 D390 — THE TRIPWIRE FIRED, AND THIS IS WHAT IT WAS FOR. This row shipped
    // one commit earlier at `cond: null`, with the cross product below already
    // holding for the SHAPE before any pattern claimed it — so the guard was
    // written against the anchor rather than against the code, which is the only
    // arrangement in which "the templates are mutually exclusive" is a
    // measurement. D390 built the pattern; the row now carries its member, and the
    // twenty hybrids below are unchanged and still refused.
    pattern: "OPPONENT_IN_PLAY_TYPE_CLAUSE",
    head: "your opponent has any ",
    token: "{W}",
    tail: " Pokémon in play",
    per: 120,
    printings: 1,
    cond: { kind: "opponentInPlayHasType", type: "Water" },
  },
];

/** The printed clause of a row — head + token + tail, in that order and nothing
    else, so a rewritten anchor cannot be hidden behind a hand-written string. */
const clauseOf = (t: Template): string => `${t.head}${t.token}${t.tail}`;

/** The bonus skeleton around a clause, spelled here rather than imported for
    `benchNamedBonus.test.ts`'s reason: the reader's own pattern is
    module-private and the point is to build the sentence from OUTSIDE it. */
const sentence = (clause: string, per: number): string =>
  `If ${clause}, this attack does ${per} more damage.`;

describe("§1 — every template answers its OWN printed sentence, and the fifth now has one", () => {
  it("each row's clause is PRINTED, at the stated number of legal printings", () => {
    for (const t of TEMPLATES) {
      const text = sentence(clauseOf(t), t.per);
      // The population is the committed `legal_standard = 1` attack column, and
      // the count is re-derived from it rather than carried in prose (D206).
      expect(corpus().filter(([, s]) => s === text), t.pattern).toHaveLength(1);
      expect(units(corpus().filter(([, s]) => s === text)), t.pattern).toBe(t.printings);
    }
    // 8 printings across 5 shapes — the arithmetic closed so a row that quietly
    // stops matching the catalog cannot hide behind the per-row loop above.
    expect(TEMPLATES.reduce((sum, t) => sum + t.printings, 0)).toBe(8);
  });

  it("🛑 resolves to its OWN member — which is what 'no earlier pattern shadows it' means", () => {
    for (const t of TEMPLATES) {
      const got = deriveAttackDamageBonus(sentence(clauseOf(t), t.per));
      if (t.cond === null) {
        // An UNBUILT row: the shape is printed and no pattern's anchor reaches it,
        // which is D363's ANCHOR refusal rather than a vocabulary one. The branch
        // is kept after D390 emptied it — this is where the NEXT candidate shape
        // goes, and keeping it is what makes the next fifth-pattern slice able to
        // write its guard first the way this one did.
        expect(got, t.pattern).toBeNull();
      } else {
        expect(got, t.pattern).toEqual({
          per: t.per,
          count: { kind: "boardCondition", cond: t.cond },
        });
      }
    }
  });

  it("the built rows land on FIVE DISTINCT members — no two shapes collapse", () => {
    const kinds = TEMPLATES.flatMap((t) => (t.cond === null ? [] : [t.cond.kind]));
    expect(new Set(kinds).size).toBe(kinds.length);
    // 🆕 D390 — 4 -> **5**, and the two numbers are stated separately on purpose:
    // the second is the width of the cross product below and the first is how much
    // of it is BUILT, so a row added as a candidate and a row added as a member are
    // different events here.
    expect(kinds).toHaveLength(5);
    expect(TEMPLATES).toHaveLength(5);
  });
});

describe("§2 — THE CROSS PRODUCT: no pattern's head reaches another pattern's tail", () => {
  it("🛑 refuses every head×tail hybrid — the four comments' invariant, executed", () => {
    let pairs = 0;
    for (const from of TEMPLATES) {
      for (const to of TEMPLATES) {
        if (from.pattern === to.pattern) continue;
        pairs += 1;
        // `from`'s anchor head and token, `to`'s anchor tail. Every one of these
        // is a well-formed bonus sentence whose CLAUSE belongs to no pattern, so
        // a pattern loose enough to span two anchors claims one of them and this
        // rung goes red at the exact pair that overlapped.
        const hybrid = `${from.head}${from.token}${to.tail}`;
        expect(deriveAttackDamageBonus(sentence(hybrid, from.per)), hybrid).toBeNull();
        // …and the hybrid is a CONSTRUCTED sentence, never a printed one, so a
        // refusal here can never be refusing something the catalog actually
        // prints (the failure mode a hand-written near-miss list has).
        expect(corpus().some(([, s]) => s === sentence(hybrid, from.per)), hybrid).toBe(false);
      }
    }
    // N×(N−1) with N = 5. Stated as arithmetic so deleting a row from
    // `TEMPLATES` cannot quietly shrink the matrix this rung walks.
    expect(pairs).toBe(TEMPLATES.length * (TEMPLATES.length - 1));
    expect(pairs).toBe(20);
  });

  it("keeps the outer sentence anchors on every shape, not just on the ones with tests", () => {
    for (const t of TEMPLATES) {
      const clause = clauseOf(t);
      for (const text of [
        // Lowercase leading "if" — the matcher has no /i.
        `if ${clause}, this attack does ${String(t.per)} more damage.`,
        // No trailing period is not the whole sentence.
        `If ${clause}, this attack does ${String(t.per)} more damage`,
        // A real trailing clause pins `$`.
        `If ${clause}, this attack does ${String(t.per)} more damage. Then, draw a card.`,
        // Leading text pins `^`.
        `Flip a coin. If ${clause}, this attack does ${String(t.per)} more damage.`,
      ]) {
        expect(deriveAttackDamageBonus(text), text).toBeNull();
      }
    }
  });
});

describe("§3 — the MAP is the vocabulary, and the two maps do not leak into each other", () => {
  it("🛑 refuses a token that resolves in the OTHER token map", () => {
    // `CLAUSE_ENERGY_TOKENS` and `CLAUSE_POKEMON_TYPES` are built from different
    // schema lists and share most of their brace codes — but not all of them,
    // and the disagreements are deliberate. `Special` is the CARD CLASS and is
    // an energy token only; `Colorless`/`{C}` and `Dragon`/`{N}` are Pokémon
    // types with no energy row, because `{C}` is the provision fallback for
    // every unauthored Special Energy and must not match a clause.
    for (const [clause, why] of [
      ["this Pokémon has any Colorless Energy attached", "a type name in the ENERGY clause"],
      ["this Pokémon has any {C} Energy attached", "the fallback code, kept out of the energy map"],
      ["this Pokémon has any Dragon Energy attached", "a type with no Basic Energy behind it"],
      ["your opponent's Active Pokémon is a Special Pokémon", "an energy CLASS as a body type"],
      ["you have any Special Pokémon on your Bench", "the same, one zone over"],
      ["your opponent's Active Pokémon has Special Resistance", "the same, one column over"],
      ["your opponent has any Special Pokémon in play", "the same, on D390's shape"],
    ] as const) {
      expect(deriveAttackDamageBonus(sentence(clause, 90)), why).toBeNull();
    }
  });

  it("🛑 refuses the catalog's OWN traps — real printed sentences, refused at the map", () => {
    // These are PRINTED (D207's banner: `Tera` is demand with no supply column),
    // so the refusal is about a sentence that exists rather than one invented to
    // be refused — and it is refused at the VOCABULARY while §2's hybrids are
    // refused at the ANCHOR, which is D363's distinction and an order of
    // magnitude in what each would cost to build.
    for (const text of [
      "If your opponent's Active Pokémon is a Tera Pokémon, this attack does 230 more damage.",
      "If you have any Tera Pokémon on your Bench, this attack does 100 more damage.",
      "If your opponent has any Future Pokémon in play, this attack does 120 more damage.",
    ]) {
      expect(corpus().some(([, s]) => s === text), text).toBe(true);
      expect(deriveAttackDamageBonus(text), text).toBeNull();
    }
  });
});

describe("§4 — the LITERAL table is the one place ORDER decides something", () => {
  it("🛑 a clause a template ALSO matches still lands on its literal row", () => {
    // `"your opponent's Active Pokémon is a Stage 1 Pokémon"` matches
    // `OPPONENT_ACTIVE_TYPE_CLAUSE` — the capture is "Stage 1", which reaches
    // `CLAUSE_POKEMON_TYPES` and misses it — AND it is a
    // `CONDITIONAL_DAMAGE_CLAUSES` row (D387). The row wins because the literal
    // pass runs FIRST, and that is a genuine ordering dependency: the templates
    // are disjoint from EACH OTHER, never from the table above them.
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a Stage 1 Pokémon, this attack does 90 more damage.",
      ),
    ).toEqual({ per: 90, count: { kind: "boardCondition", cond: { kind: "opponentActiveIsStage1" } } });
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a Stage 2 Pokémon, this attack does 140 more damage.",
      ),
    ).toEqual({ per: 140, count: { kind: "boardCondition", cond: { kind: "opponentActiveIsStage2" } } });
    // Both are printed, so this rung is about the catalog and not about a
    // constructed collision.
    expect(
      units(
        corpus().filter(
          ([, s]) =>
            s ===
            "If your opponent's Active Pokémon is a Stage 1 Pokémon, this attack does 90 more damage.",
        ),
      ),
    ).toBe(1);
  });
});
