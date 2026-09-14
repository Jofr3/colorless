import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
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
  deriveAttackRequirement,
} from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  OWN_BENCH_SNIPE_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  types,
} from "./testFixtures";

// 0.377.0 → 0.378.0 — 🆕🆕🆕 D482: THE WHOLE-SIDE SPREAD.
//
//   "This attack does 30 damage to each of your opponent's Pokémon.
//    (Don't apply Weakness and Resistance for Benched Pokémon.)"
//
// `censusAttackCorpus.ts` FILE LINE 572 — 1 sentence / 1 legal printing over
// `legalAttackCorpus()`'s 640 sentences / 1,732 printings, the `legal_standard = 1`
// attack column. `scripts/residue-census.ts` classed it `SUBST-2`: one token
// (`each` → `1`) from a sentence this engine already builds.
//
// 🛑 **THE SLICE IS A PRICE CORRECTION, AND THE CORRECTED PRICE IS *ZERO OPS*.**
// D447 priced this row as *"a THIRD `spreadDamage.target` plus a §8.5 asymmetry
// between the Active and the Bench"*. `conventions.md` repeated it at D459
// (*"D447 priced that row as a THIRD `spreadDamage.target` … both are true"*), and
// D462's resume point repeated it a third time and added *"three mechanisms — if you
// take it, take it as two slices"*. **All three are false at this head, and the reason
// is not that the price was careless: each restatement copied the last, and nothing in
// this repo executes a claim of the form "no composition of shipped ops spells this."**
//
// The printed sentence names TWO ZONES with TWO DIFFERENT §8.5 answers, and this
// engine has shipped one op for each of them since D189 and D316:
//
//   · the ACTIVE half is `damageDefender`'s FLAT arm — `snipeActive`'s full pipeline
//     (attacker pre-W/R bonus → debuff → Weakness → Resistance → the target's
//     reduction → §11 → the §8.1 survival clamp), which IS what "apply Weakness and
//     Resistance" means for the body in the Active Spot;
//   · the BENCH half is `spreadDamage` — flat, no W/R, already the owner of every
//     "each of your opponent's Benched Pokémon" printing in this column.
//
// **So the asymmetry the price was for is the BOUNDARY BETWEEN THE TWO OPS**, and the
// sentence is a two-op PROGRAM rather than a third `target` member. §2 reads both
// halves against their shipped producers; §5 drives the asymmetry on ONE printed card
// in TWO spots.
//
// ⚠️ **AND WIDENING THE OP WOULD HAVE COST AN INVARIANT RATHER THAN LINES.** index.ts
// 0.327.0 records *"D189's invariant survives. `spreadDamage` only ever touches
// `side.bench`, so it cannot move the actor off the Active Spot"* as the reason D425's
// own-side spread is safe, and continuous.ts leans on the same address twice. D425's
// own MEASURED price for widening this one op was FIVE mechanisms across 94 sites in
// 34 files. Composition leaves every one of those sentences true.
//
// ⚠️ **THE ANCHOR IS NARROWER THAN ITS SIBLING ON PURPOSE, AND ONE NARROWING IS
// LOAD-BEARING.** `SPREAD_EACH_BENCH` admits `(?:also )?` and CAPTURES the possessive;
// `SPREAD_EACH_OPPONENT_POKEMON` does neither. §1 measures all four variants over the
// whole corpus — they claim the IDENTICAL 1 sentence / 1 printing — so by D472 the
// generality is unpaid risk. But the `also` axis is worse than unpaid: `attack.ts`'s
// `programDamage` is `program?.some((step) => step.op === "damageDefender")`, so THIS
// arm DROPS the printed base (§8 drives it). That is right when the printed hit IS this
// op, and it is a SILENT DELETION OF A WHOLE MAIN HIT on an "also" wording. **A wider
// anchor is normally pure risk; here it is a known wrong answer.**
//
// ⚠️ **THE DEMONSTRATOR IS NOT A NEW FIXTURE (D414/D425).** `fix-pinpoint` is D447's
// body — Fighting, 140 HP, three printed snipe indices, each with a printed `damage: 30`
// — and every board below re-texts attack index 0 on a per-board `cardPool` CLONE. So
// `FIXTURE_POOL` is byte-unchanged and every id ladder takes a ZERO term. ⚠️ **AND THE
// SENTENCE IS NOT ALREADY FIELDED AS A REFUSAL WITNESS** (D475, checked before writing
// this file): the only place in the package that carries anything like it is
// `derivedDrawAndGust.test.ts`'s `NEAR_MISSES`, whose row is the COMPOUND
// *"… Switch this Pokémon with 1 of your Benched Pokémon."* at 10 damage — a different
// string, outside the documented population, and still refused (§3 asserts that here
// too, because a slice that widens an anchor owes the other file's control a re-run).

/** One seed for the whole suite. Nothing declared here flips a coin, and every Active,
    benched body, damage total and Prize row is placed by surgery — so a seed table
    would describe a shuffle rather than a rule (`ownBenchSnipe.test.ts`'s rule, and
    `OWN_BENCH_SPREAD_DECK`'s before it). */
const SEED = 5;

/** THE SENTENCE THIS SLICE BUYS, byte for byte from `legalAttackCorpus()`. */
const PRINTED =
  "This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** 🛑 THE ONE-TOKEN MINIMAL PAIR — the sentence `residue-census.ts` substituted TO, and
    the reason this row was `SUBST-2` rather than `OPAQUE`. It builds TODAY, to a
    completely different op, which is what makes §3's sharpest rung a `not.toEqual`
    rather than a `toBeNull` (D479's shape). */
const CHOSEN_ONE =
  "This attack does 30 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** The SHIPPED bench-only sibling AT THIS SUITE'S AMOUNT — `SPREAD_EACH_BENCH`'s
    string. The control without which every "the Active is reached" rung below would be
    consistent with a reader that claims everything (D424's rule).
    ⚠️ **CONSTRUCTED, AND SAID SO** (D452: a byte pin on an invented string is green by
    construction). The column prints this skeleton at 50/10/20 and NOT at 30, so the
    30 here is a board parameter and only `BENCH_ONLY_PRINTED` below is corpus data. */
const BENCH_ONLY =
  "This attack does 30 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** …and the REAL printed row of that skeleton, 3 legal printings, which is what §1
    pins. The amount is the only difference, and `SPREAD_EACH_BENCH` captures it. */
const BENCH_ONLY_PRINTED =
  "This attack does 50 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** The "also" wording this anchor REFUSES, and the whole of §3's headline: admitting it
    would hand `programDamage` a base to drop that the printed card meant to deal. */
const ALSO_FORM =
  "This attack also does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** The own-side wording this anchor REFUSES. D425's `D425-spread-side-flips` is the
    failure it is refused to avoid: an attack that damages the wrong side of the table. */
const OWN_SIDE =
  "This attack does 30 damage to each of your Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** The two `ex`/`V`-filtered siblings.

    🛑 **[CORRECTED AT D492, WHICH BUILT THEM.]** This block used to read *"the two
    `COMPOUND-tail` siblings that stay in the residue — a per-body CLASS filter no op in
    this family can ask, plus a second printed sentence."* **Both halves were true of the
    ops THIS anchor emits and false of the engine** (D450's boundary-versus-refusal
    distinction, at a doc block): `damageChosen.filter` has asked exactly that per-body
    class question since D483, and `snipeTargets` + `placeSnipe` already walk the Active
    AND the Bench of one side under it. D492 spells both rows as ONE `damageChosen` with
    `count: "all"`, `ignoreWR: true` and that filter — see `classedBoardSpread.test.ts`.
    **What was right was the SECOND sentence being a real blocker**: substituting the
    filter alone leaves a string all thirteen readers still refuse, because
    `splitAttackTrailingClause` will not compose a damage reader's tail.

    They are kept here, at their corpus printing counts, because §1's count rungs are
    about the COLUMN and did not move. Named so the next census greps the repo and finds
    them already counted (D171's Corviknight rule). */
const EX_FILTERED =
  "This attack does 60 damage to each of your opponent's Pokémon ex. This attack's damage isn't affected by Weakness or Resistance.";
const EX_V_FILTERED =
  "This attack does 100 damage to each of your opponent's Pokémon ex and Pokémon V. This attack's damage isn't affected by Weakness or Resistance.";

/** `derivedDrawAndGust.test.ts`'s `NEAR_MISSES` row, verbatim — outside the documented
    population (one of the 14 remote sets) and still refused after this widening. */
const COMPOUND_NEAR_MISS =
  "This attack does 10 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.) Switch this Pokémon with 1 of your Benched Pokémon.";

/** Every reader `censusAtHead.test.ts` sweeps with, so a sentence this file calls
    "unread" is unread by the WHOLE engine and not merely by the one reader it is about
    (D382). Guarded against the MODULE surface in §9, D419's rule. */
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
  deriveAttackCancelRequirement,
  deriveAttackPreDamage,
  deriveAttackDiscardScaledBoost,
];

/** THE PROGRAM, spelled once and reused, so a case cannot pass against a hand-copied
    literal that has drifted from what the file means by it. ⚠️ THE ORDER IS PART OF THE
    VALUE — see the mutant row `D482-whole-side-spread-order-flips`. */
const program = (amount: number): EffectOp[] => [
  { op: "damageDefender", amount },
  { op: "spreadDamage", target: "opponentBench", amount },
];

const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);

/** `by`'s opponent opens and passes, so the attacking seat carries no §4 first-turn
    restriction. BOTH Actives are placed by surgery and BOTH benches cleared: every
    number here is a POPULATION over a board, so a body the setup shuffle happened to
    place would silently move the answer. `OWN_BENCH_SNIPE_DECK`'s rule verbatim. */
function board(attacker: string, defender: string, by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: OWN_BENCH_SNIPE_DECK, p2: OWN_BENCH_SNIPE_DECK }, { first: opener }),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, attacker);
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 2);
  state = setActiveFromDeck(state, opener, defender);
  return clearBench(state, opener);
}

/** The printed damage box this suite gives its demonstrator, and it is chosen to be
    UNLIKE every other number on the board.

    🛑 **90 RATHER THAN `fix-pinpoint`'s OWN 30, AND THE COINCIDENCE IT AVOIDS WAS FOUND
    BY RUNNING THE SUITE RATHER THAN BY READING IT.** At the fixture's printed 30 the
    two candidate programs answer IDENTICALLY on the load-bearing board — mine drops the
    base and deals the op's 30 through ×2 (60), the bench-only sibling KEEPS the base and
    deals the printed 30 through ×2 (60) — so all four `DAMAGE_DEALT` rows agree and the
    discriminator §4 exists for is silently vacuous. **That is D479's UNKILLABLE-AS-WRITTEN
    class arriving in a suite instead of in a mutant row**, and it was invisible until a
    control went green for the wrong reason. At 90 the two answer 60 and 180. */
const PRINTED_BASE = 90;

/** Re-text `fix-pinpoint`'s attack INDEX 0 — BOTH its effect string and its printed
    damage box — on a board's OWN `cardPool` copy.
    ⚠️ **NOT A FIXTURE EDIT** — `FIXTURE_POOL` is shared by every suite in this package
    and D412 reddened three of D409's boards by widening a shared one. This mutates a
    per-board clone, so nothing outside the calling `it` can see it. */
function withEffect(state: GameState, effect: string): GameState {
  const card = state.cardPool["fix-pinpoint"];
  if (card === undefined) throw new Error("no fix-pinpoint in pool");
  const attacks = card.attacks ?? [];
  const first = attacks[0];
  if (first === undefined) throw new Error("fix-pinpoint has no attack 0");
  return {
    ...state,
    cardPool: {
      ...state.cardPool,
      "fix-pinpoint": {
        ...card,
        attacks: [{ ...first, effect, damage: PRINTED_BASE }, ...attacks.slice(1)],
      },
    },
  };
}

function bench(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  let next = state;
  for (const id of ids) next = benchFromDeck(next, seat, id);
  return next;
}

function swing(state: GameState, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: 0 });
}

/** Every `DAMAGE_DEALT` row in order, flattened to the three fields every case below
    reads: who owns the damaged body, who DEALT it, and how much landed. */
function damage(events: GameEvent[]): { seat: Seat; by: Seat; dealt: number }[] {
  return events.flatMap((e) =>
    e.type === "DAMAGE_DEALT" ? [{ seat: e.seat, by: e.by, dealt: e.dealt }] : [],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, and the FOUR anchor variants measured over all 640 rows.
// ─────────────────────────────────────────────────────────────────────────────

describe("D482 §1 — the printed data, measured live over the legal column", () => {
  it("🛑 the sentence is the CORPUS's bytes at ONE printing, and so are its four neighbours", () => {
    // D183's rule: author and assert against the printed bytes, never a paraphrase.
    // D456's: derive the specimen from `legalAttackCorpus()` where you can.
    const rows = new Map(legalAttackCorpus().map(([n, text]) => [text, n]));
    expect(rows.get(PRINTED)).toBe(1);
    expect(rows.get(CHOSEN_ONE)).toBe(2);
    expect(rows.get(BENCH_ONLY_PRINTED)).toBe(3);
    // ⚠️ …and the amount this suite's boards use for that skeleton is NOT printed at
    // all, which is stated rather than left for a reader to assume (D452).
    expect(rows.get(BENCH_ONLY)).toBeUndefined();
    expect(rows.get(EX_FILTERED)).toBe(2);
    expect(rows.get(EX_V_FILTERED)).toBe(2);
    // ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — D479's agreed
    // at 1 and 1, D478's disagreed at 1 vs 2 — so every census term this slice writes
    // is the same number, and a pass that carried the habit of reading the two apart
    // would still be right here for the wrong reason. Stated so the next slice does not
    // inherit the coincidence (D451/D461/D464).
    expect([1, units(legalAttackCorpus().filter(([, s]) => s === PRINTED))]).toEqual([1, 1]);
    // The apostrophe bytes are MEASURED, not remembered (D421/D440): the corpus holds
    // U+0027 in both slots — the possessive and `Don't` — never U+2019.
    expect(PRINTED.includes("opponent's")).toBe(true);
    expect(PRINTED.includes("opponent’s")).toBe(false);
    expect(PRINTED.codePointAt(PRINTED.indexOf("'"))).toBe(0x0027);
    expect(PRINTED.codePointAt(PRINTED.lastIndexOf("'"))).toBe(0x0027);
    // …and the é is the real U+00E9 in every slot, which is what the anchor spells.
    expect(PRINTED.codePointAt(PRINTED.indexOf("é"))).toBe(0x00e9);
  });

  it("🛑 ALL FOUR ANCHOR VARIANTS CLAIM THE SAME 1 SENTENCE / 1 PRINTING — D472, executable", () => {
    // 🛑 **THE MEASUREMENT THAT JUSTIFIES THE NARROWING, LEFT IN EXECUTABLE FORM** (D477:
    // an override — or a deliberate refusal to override — is legitimate only as a
    // recorded rung a successor can re-run and reverse). The shipped sibling
    // `SPREAD_EACH_BENCH` admits `(?:also )?` AND captures the possessive; this anchor
    // does neither, and the whole argument for that is the four numbers below.
    const VARIANTS: readonly (readonly [string, RegExp])[] = [
      [
        "narrow (as shipped)",
        new RegExp(
          `^This attack does (\\d+) damage to each of your opponent['’]s Pokémon\\.` +
            `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
        ),
      ],
      [
        "wide: the possessive captured, `SPREAD_EACH_BENCH`'s shape",
        new RegExp(
          `^This attack does (\\d+) damage to each of (your opponent['’]s|your) Pokémon\\.` +
            `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
        ),
      ],
      [
        "wide: `(?:also )?` admitted",
        new RegExp(
          `^This attack (?:also )?does (\\d+) damage to each of your opponent['’]s Pokémon\\.` +
            `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
        ),
      ],
      [
        "narrower still: the W/R clarifier REQUIRED",
        new RegExp(
          `^This attack does (\\d+) damage to each of your opponent['’]s Pokémon\\. ` +
            `\\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\)$`,
        ),
      ],
    ];
    for (const [label, re] of VARIANTS) {
      const hits = legalAttackCorpus().filter(([, s]) => re.test(s));
      expect([label, hits.length, units(hits)]).toEqual([label, 1, 1]);
      expect([label, hits[0]?.[1]]).toEqual([label, PRINTED]);
    }
    // 🛑 SO THE GENERALITY BUYS NOTHING, AND ON THE `also` AXIS IT COSTS A WRONG PROGRAM
    // (§3 and §8). On the possessive axis it costs D425's named failure — an attack that
    // damages the wrong side of the table. On the parenthetical axis it costs nothing in
    // either direction, and the sibling's shape is kept there for exactly that reason:
    // §8.5 makes the clarifier true whether or not a reprint prints it.
  });

  it("🆕🆕🆕 D482 — the sentence is now RESOLVED, and by exactly one reader", () => {
    // The transition this slice IS, asserted off the MODULE surface rather than off the
    // hand-kept list above (D419) — so no edit to `READERS` can move it.
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(deriveAttackEffect(PRINTED)).toEqual(program(30));
    for (const read of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(PRINTED), read.name).toBeNull();
    }
    // 🛑 **[RE-POINTED AT D492, WHICH BUILT THE OLD SUBJECTS.]** This loop ran over
    // `EX_FILTERED` / `EX_V_FILTERED` and asserted all thirteen readers refused them.
    // D492 claims both, so the OLD subjects no longer have the property — and D444's
    // repair is to find a subject that still does rather than to relax the claim, D438's
    // is to NAME the new owner instead of flipping a boolean. Both are done here.
    //
    // The subjects that still have it are the same two class nouns under **THIS
    // anchor's own parenthetical tail** — one axis from `PRINTED` (the NOUN) and one axis
    // from D492's rows (the TAIL), so a widening in either direction reddens this rung.
    // The column prints neither; they are CONSTRUCTED and labelled so (D440).
    for (const text of [
      "This attack does 30 damage to each of your opponent's Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "This attack does 30 damage to each of your opponent's Pokémon ex and Pokémon V. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    ]) {
      expect(resolvedByAnyReader(text), text).toBe(false);
      for (const read of READERS) expect(read(text), `${read.name} / ${text}`).toBeNull();
    }
    // …and the printed pair is now OWNED, by name, with every other reader still refusing
    // — which is strictly stronger than the boolean this used to be (D438).
    for (const text of [EX_FILTERED, EX_V_FILTERED]) {
      expect(deriveAttackEffect(text), text).not.toBeNull();
      for (const read of READERS) {
        if (read === deriveAttackEffect) continue;
        expect(read(text), `${read.name} / ${text}`).toBeNull();
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the reading, and both halves read against their SHIPPED producers.
// ─────────────────────────────────────────────────────────────────────────────

describe("D482 §2 — a two-op program of ops that already ship", () => {
  it("🛑 the BENCH half is byte-identical to `SPREAD_EACH_BENCH`'s own output", () => {
    // 🛑 THE RUNG THAT SAYS "NO NEW OP" AS BEHAVIOUR RATHER THAN AS A COMMENT. The
    // second op is not a look-alike written from the same reading — it is the SAME
    // VALUE the shipped bench-only anchor produces for the same amount, compared
    // against that anchor's live answer rather than against a re-typed literal (D479's
    // "one sentence, two producers, and they must agree byte for byte").
    const bare = deriveAttackEffect(BENCH_ONLY);
    expect(bare).toEqual([{ op: "spreadDamage", target: "opponentBench", amount: 30 }]);
    expect(deriveAttackEffect(PRINTED)?.slice(1)).toEqual(bare);
  });

  it("🛑 the ACTIVE half is `damageDefender`'s FLAT arm — the §8.5 pipeline, not a counter", () => {
    // The op that is NOT `damageActive`. D228 states the difference and it is the whole
    // reason the printed parenthetical says "for Benched Pokémon" and not "at all":
    // `damageActive` PLACES counters (no Weakness, no Resistance, no reduction passive,
    // a COUNTERS_PLACED row); `damageDefender` deals attack damage through `snipeActive`.
    // §5 drives the difference on a board; here it is pinned at the value.
    expect(deriveAttackEffect(PRINTED)?.[0]).toEqual({ op: "damageDefender", amount: 30 });
    // …and it is the FLAT arm: the union refuses `per`/`count` beside `amount`
    // (`discardEnergy`'s idiom, effects.ts), so an op carrying both cannot be spelled.
    const head = deriveAttackEffect(PRINTED)?.[0];
    expect(head !== undefined && "amount" in head).toBe(true);
    expect(Object.keys(head ?? {}).sort()).toEqual(["amount", "op"]);
  });

  it("the AMOUNT is a printed capture and BOTH halves take it", () => {
    // D400's number-agreement rule: the distributive "each of" gives every body the
    // SAME printed number, so a build that halved, split or shared it across the board
    // is a different program at the value before it is a different board.
    for (const n of [10, 30, 120]) {
      const text = PRINTED.replace("30 damage", `${n} damage`);
      expect(deriveAttackEffect(text), text).toEqual(program(n));
    }
    // A printed 0 is not a real card; both ops carry their own `<= 0` guard, so the
    // program is still built and both halves resolve to no-ops rather than to a
    // "dealt 0" row. Asserted at the reader so the guard's home stays visible.
    expect(deriveAttackEffect(PRINTED.replace("30 damage", "0 damage"))).toEqual(program(0));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the refusals, each pinned on ONE printed byte.
// ─────────────────────────────────────────────────────────────────────────────

describe("D482 §3 — the refusals, and the sharpest one is a `not.toEqual`", () => {
  it("🛑 the QUANTIFIER refuses BOTH WAYS — `each of` and `1 of` are different OPS", () => {
    // D399's rule: the POSITIVE control first, or a near-miss refused for some OTHER
    // reason proves nothing about the byte you meant to test.
    expect(deriveAttackEffect(PRINTED)).toEqual(program(30));
    // 🛑 THE SHARPEST RUNG IN THE FILE, AND IT IS NOT A `toBeNull`. This is the exact
    // substitution `residue-census.ts` used to class the row `SUBST-2`, so BOTH strings
    // build and "the other anchor refuses mine" can only be said as "it derives to
    // something else entirely".
    expect(deriveAttackEffect(CHOSEN_ONE)).not.toEqual(program(30));
    expect(deriveAttackEffect(CHOSEN_ONE)).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 30,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
  });

  it("🛑 `also` IS REFUSED, and it is the one narrowing that is not merely unpaid risk", () => {
    // 🛑 THE HEADLINE REFUSAL. `attack.ts`'s `programDamage` drops the printed base when
    // the program contains a `damageDefender`, so admitting the "also" wording would
    // deal the rider and DELETE the main hit the word "also" exists to announce. The
    // sibling `SPREAD_EACH_BENCH` admits it safely because a bench spread claims nothing.
    // Measured in §1: the "also" form claims no extra corpus row, so the refusal is free.
    expect(deriveAttackEffect(ALSO_FORM)).toBeNull();
    for (const read of READERS) expect(read(ALSO_FORM), read.name).toBeNull();
    // …while the sibling's own "also" wording still builds, which is what makes the line
    // above a claim about THIS anchor and not about the word.
    expect(deriveAttackEffect(`This attack also does 30 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)`)).toEqual(
      [{ op: "spreadDamage", target: "opponentBench", amount: 30 }],
    );
  });

  it("🛑 the POSSESSIVE is spelled, not captured — the own-side wording is refused", () => {
    // D425's `D425-spread-side-flips` is the failure this refusal avoids: a build that
    // read the possessive and aimed at the attacker's own board. The sentence is not
    // printed in this column at all (§1), so capturing it would be a program with no
    // printing — and the day it IS printed it earns its own arm, because the own-side
    // Active is `damageSubject`/`damageSelf` territory and not `damageDefender`'s.
    expect(deriveAttackEffect(OWN_SIDE)).toBeNull();
    for (const read of READERS) expect(read(OWN_SIDE), read.name).toBeNull();
    // …and the sibling's own-side wording still builds, at `target: "yourBench"`.
    expect(
      deriveAttackEffect(
        "This attack also does 30 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([{ op: "spreadDamage", target: "yourBench", amount: 30 }]);
  });

  it("the ZONE NOUN is load-bearing — `Benched Pokémon` is a different program", () => {
    // One word, two programs. Without this pair, a build that dropped the whole
    // `damageDefender` half would still look correct on every bench assertion in §4.
    expect(deriveAttackEffect(BENCH_ONLY)).toEqual([
      { op: "spreadDamage", target: "opponentBench", amount: 30 },
    ]);
    expect(deriveAttackEffect(BENCH_ONLY)).not.toEqual(program(30));
  });

  it("the anchor is WHOLE-SENTENCE — a leading or trailing clause is refused", () => {
    for (const text of [
      `Draw a card. ${PRINTED}`,
      `${PRINTED} Your turn ends.`,
      `${PRINTED} This attack's damage isn't affected by Weakness or Resistance.`,
      // 🛑 `derivedDrawAndGust.test.ts`'s `NEAR_MISSES` row, verbatim. It is outside the
      // documented population (one of the 14 remote sets), it is the shape an unanchored
      // build eats, and this slice's widening must not have admitted it — which is a
      // claim that file cannot make about THIS anchor, so it is made here.
      COMPOUND_NEAR_MISS,
      // 🛑 **[RE-POINTED AT D492.]** These two slots held `EX_FILTERED` / `EX_V_FILTERED`
      // and asserted `deriveAttackEffect` refused them; D492 built both, so the subjects
      // moved to the same two class nouns under THIS anchor's parenthetical tail. The
      // claim is unchanged and is the one that matters here — **this anchor's noun slot is
      // the literal `Pokémon` and admits no class narrowing** — and it now differs from a
      // BUILT string on exactly one axis in each direction (D427).
      "This attack does 30 damage to each of your opponent's Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "This attack does 30 damage to each of your opponent's Pokémon ex and Pokémon V. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      // Case is load-bearing: no reader in `effects.ts` carries an `/i`.
      PRINTED.toLowerCase(),
      PRINTED.toUpperCase(),
      // The trailing period is required — the failure mode this repo names first,
      // because a regex written from a paraphrase matches no real card.
      "This attack does 30 damage to each of your opponent's Pokémon",
      // A non-numeric amount, and a missing one.
      "This attack does X damage to each of your opponent's Pokémon.",
      "This attack does damage to each of your opponent's Pokémon.",
      // The clarifier mangled — an optional group is not a wildcard tail.
      `${PRINTED.replace("Benched Pokémon.)", "Benched Pokémon.")}`,
      "This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness for Benched Pokémon.)",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE BOARD — one fixture, re-texted on a per-board `cardPool` clone (D414).
// ─────────────────────────────────────────────────────────────────────────────

/** THE LOAD-BEARING BOARD, and every body on it is chosen so that *hit-everything*,
    *hit-active-only* and *hit-bench-only* are THREE DISTINGUISHABLE ANSWERS:

      P1 Active  `fix-pinpoint`      Fighting, 140 HP, printed `damage: 30`, re-texted
      P2 Active  `fix-fighting-weak` 200 HP, ×2 Fighting → 30 becomes **60**
      P2 Bench 0 `fix-fighting-weak` THE SAME PRINTED CARD on a Bench → **30**, flat
      P2 Bench 1 `fix-onko`          30 HP → the 30 KNOCKS IT OUT
      P2 Bench 2 `fix-titan`         340 HP → **30**, and survives

    The bench holds a body at each of three fates (flat-and-weak, lethal, filler), the
    two `fix-fighting-weak` copies differ ONLY in the spot they occupy, and no two of the
    three candidate builds agree on the resulting board. */
function loaded(effect: string = PRINTED): GameState {
  let state = board("fix-pinpoint", "fix-fighting-weak");
  state = bench(state, "p2", ["fix-fighting-weak", "fix-onko", "fix-titan"]);
  return withEffect(state, effect);
}

describe("D482 §4 — hit-everything, hit-active-only and hit-bench-only are three answers", () => {
  it("🛑 EVERY body on the opponent's side takes the hit, and the Active takes it FIRST", () => {
    const state = loaded();
    deepFreeze(state);
    const { state: done, events } = swing(state);

    // 🛑 FOUR ROWS, IN PRINTED ORDER: the Active first (through §8.5, so 60), then the
    // Bench in bench order (flat 30 each). A hit-active-only build files ONE row; a
    // hit-bench-only build files three and none of them is 60; a build that walked the
    // bench first files the same four in the wrong order. All three are separated here.
    expect(damage(events)).toEqual([
      { seat: "p2", by: "p1", dealt: 60 },
      { seat: "p2", by: "p1", dealt: 30 },
      { seat: "p2", by: "p1", dealt: 30 },
      { seat: "p2", by: "p1", dealt: 30 },
    ]);
    // …and the BOARD agrees with the wire. `fix-onko` is Knocked Out, so the bench it
    // leaves behind is two bodies deep and the survivors carry 30 each.
    expect(done.players.p2.active?.damage).toBe(60);
    expect(events.some((e) => e.type === "KNOCKED_OUT")).toBe(true);
    // The attacker's OWN board is untouched — the printed possessive is the opponent's.
    expect(done.players.p1.active?.damage).toBe(0);
    expect(done.players.p1.bench).toHaveLength(0);
  });

  it("…and the bench-only program answers 180 on the Active, not 60 — a DIFFERENT board", () => {
    // THE DISCRIMINATOR, driven rather than argued: the SAME board, the SAME amount, the
    // sibling sentence. If the arm had reused `SPREAD_EACH_BENCH`'s program this is the
    // board it would have produced. ⚠️ **THE ACTIVE IS STILL HIT — by the PRINTED BASE,
    // which that program does not claim** — so the discriminator is the NUMBER and not
    // the presence of a row, and at `fix-pinpoint`'s own printed 30 the two programs
    // would have agreed on all four rows (see `PRINTED_BASE`).
    const { state: done, events } = swing(loaded(BENCH_ONLY));
    expect(damage(events).map((d) => d.dealt)).toEqual([180, 30, 30, 30]);
    expect(done.players.p2.active?.damage).toBe(180);
  });

  it("…and the CHOSEN-single program parks instead of resolving inline", () => {
    // The third answer, and it is not a number at all: `damageChosen` over `opponentAny`
    // opens a CHOICE. A build that read `each of` as `1 of` does not merely hit fewer
    // bodies — it stops the attack in `effect:choose`, which no board assertion above
    // could have told apart from "the spread was skipped".
    const { state: parked } = swing(loaded(CHOSEN_ONE));
    expect(parked.phase.kind).toBe("effect:choose");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the printed parenthetical, driven on ONE card in TWO spots.
// ─────────────────────────────────────────────────────────────────────────────

describe("D482 §5 — Weakness applies on the Active and NOT on the Bench", () => {
  it("🛑 the SAME ×2 Fighting body DOUBLES in the Active Spot and stays FLAT on the Bench", () => {
    // 🛑 THE W/R TAIL, DRIVEN AND NOT ASSUMED, AND IT IS WHY THIS SENTENCE IS TWO OPS.
    // `fix-fighting-weak` is on the board TWICE — Active and Bench 0 — and the attacker
    // is Fighting. One printed card, two spots, two answers, and the only thing that
    // differs is which op reached it. A single-op build (a third `spreadDamage.target`
    // walking Active + Bench with the fold's flat model) answers 30 and 30; a build that
    // ran §8.5 over the whole side answers 60 and 60. Both are red here.
    const { state: done, events } = swing(loaded());
    const rows = damage(events);
    expect(rows[0]?.dealt).toBe(60); // ×2 Fighting on the ACTIVE — doubled
    expect(rows[1]?.dealt).toBe(30); // the SAME CARD on a BENCH — flat
    expect(done.players.p2.active?.damage).toBe(60);
    expect(done.players.p2.bench[0]?.damage).toBe(30);
    // …and the two bodies really are the same printed card, resolved through
    // `cardIdByUid` off the stack top, so the pair above is a statement about the ZONE
    // and not about two different fixtures.
    expect(done.cardIdByUid[activeUid(done, "p2")]).toBe("fix-fighting-weak");
    expect(done.cardIdByUid[benchTopUid(done, "p2", 0)]).toBe("fix-fighting-weak");
  });

  it("…and a NEUTRAL Active takes the flat 30, which is the control on the doubling", () => {
    // Without this, "60" above is consistent with an arm that simply doubles the Active.
    let state = board("fix-pinpoint", "fix-titan");
    state = bench(state, "p2", ["fix-titan"]);
    const { events } = swing(withEffect(state, PRINTED));
    expect(damage(events).map((d) => d.dealt)).toEqual([30, 30]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the KO among them, and whose Prize it is.
// ─────────────────────────────────────────────────────────────────────────────

describe("D482 §6 — a spread that Knocks Out a benched body mid-board", () => {
  it("🛑 the 30 HP body dies, the 340 HP body does not, and the ATTACKER takes the Prize", () => {
    const { state: after, events } = swing(loaded());
    expect(events.some((e) => e.type === "KNOCKED_OUT")).toBe(true);
    // The Prize is the ATTACKER's — the mirror of D425's own-side spread, where it was
    // the opponent's. Both directions of `collectKnockOutPass` are therefore driven in
    // this package rather than argued from one side.
    if (after.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
    expect(after.phase.seat).toBe("p1");
    const { state: done } = mustApply(after, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(done.players.p1.prizes).toHaveLength(5);
    expect(done.players.p2.prizes).toHaveLength(6);
    // The KO'd body left the Bench and the two SURVIVORS kept their damage — the fold
    // walked past a body it killed rather than stopping at it.
    expect(done.players.p2.bench).toHaveLength(2);
    expect(done.players.p2.bench.map((p) => p.damage)).toEqual([30, 30]);
    // …and the ACTIVE, which took 60, is nowhere near its 200.
    expect(done.players.p2.active?.damage).toBe(60);
  });

  it("…a body ALREADY damaged is Knocked Out by the same 30, and an undamaged twin is not", () => {
    // The lethality is arithmetic, not a property of `fix-onko`: two `fix-titan`s, one
    // pre-damaged to 320. Same op, same amount, opposite fates on one board.
    let state = board("fix-pinpoint", "fix-titan");
    state = bench(state, "p2", ["fix-titan", "fix-titan"]);
    state = setBenchDamage(state, "p2", 0, 320);
    const { state: after, events } = swing(withEffect(state, PRINTED));
    expect(damage(events).map((d) => d.dealt)).toEqual([30, 30, 30]);
    expect(events.some((e) => e.type === "KNOCKED_OUT")).toBe(true);
    if (after.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
    const { state: done } = mustApply(after, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(done.players.p2.bench).toHaveLength(1);
    expect(done.players.p2.bench[0]?.damage).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — the ZERO-MATCH board, with its controls.
// ─────────────────────────────────────────────────────────────────────────────

describe("D482 §7 — an EMPTY opponent Bench, and the two builds that agree there", () => {
  it("🛑 a lone Active takes its W/R-applied hit and the spread half is silently a no-op", () => {
    // 🛑 THE ZERO-MATCH BOARD, AND IT IS THE ONE BOARD ON WHICH *hit-everything* AND
    // *hit-active-only* AGREE — which is exactly why §4 does not use it and why it is
    // named here rather than left as a gap. `spreadDamage` returns the state untouched
    // when `side.bench.length === 0`: no event, no ATTACK_EFFECT_SKIPPED (the sentence
    // WAS read), no error.
    const state = board("fix-pinpoint", "fix-fighting-weak");
    expect(state.players.p2.bench).toHaveLength(0);
    const { state: done, events } = swing(withEffect(state, PRINTED));
    expect(damage(events)).toEqual([{ seat: "p2", by: "p1", dealt: 60 }]);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(done.players.p2.active?.damage).toBe(60);
    expect(done.players.p2.bench).toHaveLength(0);
  });

  it("…and the CONTROL: the same empty bench under the bench-only sibling files the BASE", () => {
    // The control that makes the rung above a statement about the ACTIVE half. Under
    // `SPREAD_EACH_BENCH`'s program the spread half has nothing to walk and the ONE row
    // that lands is the PRINTED BASE through ×2 — 180, not 60. So the 60 above is the
    // `damageDefender` op and nothing else, which no "did anything land?" assertion
    // could have said.
    const state = board("fix-pinpoint", "fix-fighting-weak");
    const { state: done, events } = swing(withEffect(state, BENCH_ONLY));
    expect(damage(events)).toEqual([{ seat: "p2", by: "p1", dealt: 180 }]);
    expect(done.players.p2.active?.damage).toBe(180);
  });

  it("…and a printed ZERO places nothing FROM EITHER OP, on a board that is otherwise §4's", () => {
    // Both ops guard `amount <= 0` independently, so a 0 is a no-op on BOTH zones rather
    // than on one — the asymmetry that would exist if only one of them carried a guard.
    // ⚠️ **THE BASE IS STILL DROPPED**, because `programDamage` reads the op NAME and not
    // its amount: the program still contains a `damageDefender`, so the printed 90 does
    // not leak back in through the gap the guards open. That is the one board on which
    // "the amount is zero" and "the base is claimed" are separable, and it is here
    // rather than argued.
    const { state: done, events } = swing(loaded(PRINTED.replace("30 damage", "0 damage")));
    expect(damage(events)).toEqual([]);
    expect(done.players.p2.active?.damage).toBe(0);
    expect(done.players.p2.bench.map((p) => p.damage)).toEqual([0, 0, 0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — the printed base, and the reason `also` is refused.
// ─────────────────────────────────────────────────────────────────────────────

describe("D482 §8 — the printed base is DROPPED, and that is `programDamage`'s doing", () => {
  it("🛑 the demonstrator prints `damage: 90` and the Active takes 60 — the OP's number", () => {
    // 🛑 THE MECHANISM BEHIND §3's `also` REFUSAL, DRIVEN. `attack.ts`'s
    // `programDamage` sees the `damageDefender` in this program and zeroes the printed
    // base, so the Active takes the OP's 30 through ×2 (60) and the printed 90 never
    // lands. Were the base kept — which is exactly what an admitted "also" wording would
    // deserve and this one would not — this board would file 180 first and 60 after it.
    const state = loaded();
    expect(state.cardPool["fix-pinpoint"]?.attacks?.[0]?.damage).toBe(PRINTED_BASE);
    const { state: done, events } = swing(state);
    expect(damage(events).map((d) => d.dealt)).toEqual([60, 30, 30, 30]);
    expect(damage(events).some((d) => d.dealt === 180)).toBe(false);
    expect(done.players.p2.active?.damage).toBe(60);
  });

  it("…and the sibling KEEPS its base on the identical board, which is the control", () => {
    // `spreadDamage` alone does NOT satisfy `programDamage`, so the printed 90 lands as
    // the main hit and doubles to 180 on the ×2 Active, plus the three flat bench rows.
    // Without this control, §8.1 is consistent with an engine that never deals a printed
    // base at all — and at `fix-pinpoint`'s own printed 30 the two boards would have been
    // byte-identical (see `PRINTED_BASE`).
    const { state: done, events } = swing(loaded(BENCH_ONLY));
    expect(damage(events).map((d) => d.dealt)).toEqual([180, 30, 30, 30]);
    expect(done.players.p2.active?.damage).toBe(180);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — the pins: the reader surface, the version, and the record constant.
// ─────────────────────────────────────────────────────────────────────────────

describe("D482 §9 — the surface, the version and what does NOT move", () => {
  it("the hand-kept READERS list is the MODULE's, not a copy that has gone short", () => {
    // D419's rule: a hand-kept list that nothing compares to the module can sit short of
    // it indefinitely, and every "unread by the whole engine" claim above rests on it.
    expect(READERS.map((r) => r.name).sort()).toEqual([...attackReaderSurface()].sort());
    expect(READERS).toHaveLength(13);
  });

  it("engineVersion is 0.400.0 and the bump is owed for BEHAVIOUR", () => {
    // A sentence that derived to `null` derives to a program: `packages/engine`
    // behaviour moved, so the version steps. ⚠️ THE VERSION TAX, RE-MEASURED AT THIS
    // HEAD RATHER THAN INHERITED — 57 assertions / 73 sites across 57 files, against the
    // "37 assertions / 41 sites" index.ts still forecast from D459. See the 0.378.0
    // block, which records the class the old count did not have at all: 13 `it(…)`
    // TITLES that spell the version.
    expect(engineVersion).toBe("0.400.0");
  });

  it("🛑 `MATCH_RECORD_VERSION` does NOT move, and the argument is BOTH of D463's tests", () => {
    // ① THE SERIALIZED ALPHABET DOES NOT GROW. Both ops, both op names and every one of
    //    their field values already ship — `damageDefender { amount }` since D316 and
    //    `spreadDamage { target: "opponentBench", amount }` since the op existed. This
    //    slice adds no member, no field and no value that could appear in a persisted
    //    program, so no v29 record can hold anything new and no new record can hold
    //    anything a v29 deploy cannot read.
    const ops = deriveAttackEffect(PRINTED) ?? [];
    expect(ops.map((o) => o.op)).toEqual(["damageDefender", "spreadDamage"]);
    expect(JSON.parse(JSON.stringify(ops))).toEqual(program(30));
    // ② REACHABILITY (D450) IS EMPTY. Neither op PARKS — `spreadDamage`'s interpreter
    //    arm returns `{ done }` unconditionally (index.ts 0.327.0 says so in those
    //    words) and `damageDefender`'s ends in `snipeActive`, which resolves inline. So
    //    neither can reach `phase.cont.pendingOp` or `rest`. Driven rather than argued:
    //    the loaded board resolves to a KO phase, never to `effect:choose`.
    const { state: after } = swing(loaded());
    expect(after.phase.kind).not.toBe("effect:choose");
  });
});
