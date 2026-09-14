import { describe, expect, it } from "vitest";
import { attackReaderSurface, resolvedByAnyReader } from "./censusAttackCorpus";
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
import { applyAction, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  SELF_ENERGY_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.125.0 → 0.126.0 — the TENTH and ELEVENTH `DamageCountSource` members (P3-M5
// long tail, D196), and the re-homing that had to happen before either could be
// built:
//
//   `energyOnSelf {energyType}`  — Energy attached to the ATTACKING body, with an
//                                  optional type filter    (ADD **and** MULTIPLY)
//   `bothActivesEnergyCount`     — Energy attached to the TWO Actives, summed
//                                                          (ADD only)
//
// ⚠️ THE HEADLINE IS NOT A MEMBER, IT IS A FIXTURE THAT CHANGED SIGN.
// `energyOnSelf` is the LARGEST member this family has ever taken — 21 legal
// printings, more than D193's three put together — and it was the last one built,
// because its sentence was load-bearing as a NEGATIVE. Entei sv03-030 "Blaze Ball"
// ("This attack does 20 more damage for each {R} Energy attached to this
// Pokémon.") had been this engine's canonical UNSIMULATED-"+" witness since
// 0.35.0. D193 implemented the member, ran the suite, counted **5 assertions
// across 4 files** turning red, and REVERTED rather than retire a fixture four
// suites depend on. That refusal was correct and this slice starts by paying for
// it: the witness moved FIRST, then the members landed.
//
//   D193's list, re-measured by implementing the member again: **exactly right.**
//   scaledDamage.test.ts ×2, perEnergyFlip.test.ts, log.test.ts, checkup.test.ts.
//   A sixth failure exists but is not on that list and could not have been —
//   benchBodyScaling.test.ts's own PINNED ABSENCE for `bothActivesEnergyCount`,
//   which only this slice's SECOND member touches. D193 pinned it deliberately and
//   handed it forward; it is flipped there rather than deleted.
//
// ⚠️ THE REPLACEMENT WITNESS IS PACHIRISU sv01-068 "Everyone Discharge" ({L}{C},
// "10+"), and it is chosen because it stays unread for THREE INDEPENDENT REASONS
// where Entei had one:
//
//   1. It is a TWO-SENTENCE printing — "This attack does 20 more damage for each
//      of your Benched {L} Pokémon. This attack's damage isn't affected by
//      Weakness." — and every reader in this family is whole-sentence anchored
//      (`^…\.$`) with no composition path.
//   2. Its count is a TYPED count of BODIES on the attacker's own Bench, and no
//      `DamageCountSource` member counts bodies with a type filter: D193's two
//      body counts are untyped, and D196's two Energy counts are not bodies.
//   3. ⚠️ ITS SUPPRESSION HALF IS REFUSED IN ISOLATION TOO, AND THIS SLICE HAD IT
//      WRONG BEFORE MEASURING. The plan was that reason 1 would be sharpened by
//      the second sentence being one D192 already reads — "the anchor refuses a
//      printing one of whose sentences a reader already answers". It does not.
//      "This attack's damage isn't affected by Weakness." has **zero standalone
//      printings** in the D1 (2026-08-04); the catalog prints that clause only as
//      the TAIL of a two-sentence attack (3 rows), which is exactly why D192's
//      four anchored spellings do not include a Weakness-only one. So the
//      composition has no readable half at all.
//
// A slice that builds the typed bench count still leaves reasons 1 and 3 standing;
// one that adds sentence splitting still leaves reason 2. That is precisely the
// property Entei lacked, and the reason D193's revert happened at all.
//
// ⚠️ AND THE SWAP IS LIKE-FOR-LIKE ON LEGALITY, which is worth stating because it
// is the one axis where a witness could quietly get worse: Entei's "Blaze Ball"
// sentence is 2 printings / **0 legal** and Pachirisu's is 3 printings / **0
// legal**. Neither witness was ever a Standard-legal row; both are real printings
// carried verbatim in the pool, and the re-homing does not trade a legal witness
// for a rotated one.
//
// ⚠️ TWO POPULATIONS, SWEPT SEPARATELY (D156's rule), EVERY COUNT RE-MEASURED
// against the D1 (2026-08-04): 3,786 rows, **2,021 Standard-legal**
// (`legal_standard = 1` ⇔ regulation mark H/I plus unmarked Basic Energy). The
// six-set census population (`sv01`,`sv02`,`sv03`,`sv06.5`,`sve`,`swsh10.5`) is
// 978 rows of which only **127** are legal, so a six-set figure and a legal figure
// describe near-disjoint populations. Every count below is the LEGAL one with the
// whole-catalog figure beside it.
//
//   member                    legal   catalog   folds MEASURED
//   energyOnSelf                21       38     ADD (12 / 26) + MULTIPLY (9 / 12)
//   bothActivesEnergyCount       8       10     ADD only
//
// ⚠️ THE THINGS THAT TURNED OUT WRONG OR SURPRISING, STATED FIRST:
//
//   • **D193's `energyOnSelf` count of 21 is right and an earlier recon's 23 is
//     not**, and the two rows in the gap are both LEGAL — which is why a raw
//     sentence sweep cannot be trusted as a build estimate. "This attack does 40
//     damage for each **Basic Energy** attached to this Pokémon." (1 legal)
//     filters on a card CATEGORY that resolves to nothing, and "This attack does
//     30 damage for each {W} Energy attached to this Pokémon. **Before doing
//     damage, you may attach** any number of Basic {W} Energy cards from your hand
//     to this Pokémon." (1 legal) is a two-sentence printing the anchor refuses.
//     Both are carried as fixture indices here rather than argued.
//
//   • **`bothActivesEnergyCount` is ADD-only by LEGALITY, not by ABSENCE — the
//     opposite answer to `bothSidesBenchCount`.** Its bare twin IS printed ("This
//     attack does 30 damage for each Energy attached to both Active Pokémon.");
//     it is 1 printing and **0 legal**. D193's neighbour is ADD-only because the
//     twin does not exist at all. Telling those two apart is the difference
//     between "no pattern is owed" and "a pattern is owed and refused".
//
//   • 🆕🆕 **D475 — THE COIN FORM OF THIS NOUN IS BUILT, AND THE THIRD INDEX ON
//     `fix-bothactives` IS NO LONGER A REFUSAL.** "Flip a coin for each Energy
//     attached to both Active Pokémon. This attack does 60 damage for each heads."
//     (corpus FILE LINE 231, 1 printing / 1 LEGAL) reads through
//     `deriveAttackCoinFlip` and a NULLARY `AttackFlipCount.bothActivesEnergy`. The
//     two facts this file recorded about it both HELD — it is not
//     `attachedEnergy` (one body against two) and neither damage reader may take it —
//     which is why every rung here was re-pointed by naming the new owner rather than
//     deleted. **"Twin Blast" is still refused and is now the file's only both-Actives
//     refusal**, so the "X refused / Y admitted" pair (D424) is one index apart.
//
//   • **The FIXTURE_POOL sweep found ONE reuse, and it is the load-bearing
//     negative.** Five slices running found zero; this one found `sv03-030`
//     carrying `energyOnSelf`'s exact sentence — which is the whole story of this
//     slice, and would have been discovered as a red suite instead of as a
//     measurement if the sweep had not been run first. That sweep is a test below.

// ─────────────────────────────────────────────────────────────────────────────
// The printed sentences, transcribed char-for-char off the D1 rows. None of them
// carries an apostrophe, which is why `clauseApostrophe.test.ts` takes no diff for
// this slice — see the census note in the version block at the foot of this file.
// ─────────────────────────────────────────────────────────────────────────────

/** ADDITIVE, UNTYPED — 2 legal printings, printed `30+`. */
const POWER_DRAW = "This attack does 50 more damage for each Energy attached to this Pokémon.";
/** ADDITIVE, `{R}`-FILTERED — 1 legal printing, printed `40+`. The additive fold is
    where the type filters live: five distinct ones across 12 legal printings. */
const FLARE_DRAW = "This attack does 80 more damage for each {R} Energy attached to this Pokémon.";
/** MULTIPLY, UNTYPED — 5 legal printings on this exact sentence, the single
    biggest row in the family. All 9 legal multiply printings are untyped. */
const OVERFLOW = "This attack does 30 damage for each Energy attached to this Pokémon.";
/** ⚠️ THE CATEGORY ROW — 1 LEGAL printing, and NOT buildable. `Basic` is a card
    category, not a type; it is absent from `CLAUSE_ENERGY_TOKENS` and resolves to
    nothing, so the reader must stay LOUD rather than score the unfiltered total. */
const BASIC_DRAW = "This attack does 40 damage for each Basic Energy attached to this Pokémon.";
/** 🆕🆕 D459 — THE OTHER CATEGORY ROW, and the minimal pair of the one above: 1
    sentence / **2 LEGAL** printings (`censusAttackCorpus.ts` line **618**), printed
    with the noun `Energy card` where every other row in this family prints `Energy`.
    `Special` IS in `CLAUSE_ENERGY_TOKENS`, so the only thing that ever blocked it
    was the word `card` — measured, not argued: deleting that one token from the
    printed string made `deriveAttackDamageMultiplier` answer with `energyType:
    "special"` INTACT, which is what `scripts/residue-census.ts` prints for this row
    and what separates it from the residue's nine other one-token blockers. */
const SPECIAL_DRAW =
  "This attack does 70 damage for each Special Energy card attached to this Pokémon.";
/** ⚠️ THE TWO-SENTENCE ROW — 1 LEGAL printing, and NOT buildable. Its second
    sentence ATTACHES Energy before damage, which is the one thing in this family
    that could make "read at DECLARATION" observable; the anchor refuses it. */
const ATTACH_THEN_DRAW =
  "This attack does 30 damage for each {W} Energy attached to this Pokémon. Before doing damage, you may attach any number of Basic {W} Energy cards from your hand to this Pokémon.";
/** Entei sv03-030 "Blaze Ball" — the real card that used to be the unsimulated-"+"
    witness and is now this member's only REAL-CARD positive case. */
const BLAZE_BALL = "This attack does 20 more damage for each {R} Energy attached to this Pokémon.";

/** BOTH Actives, ADDITIVE — 10 printings, **8 LEGAL**, printed `30+` on every row.
    One verbatim sentence; the pool prints no typed spelling of it in any column. */
const TWIN_SURGE =
  "This attack does 30 more damage for each Energy attached to both Active Pokémon.";
/** ⚠️ Its bare twin — 1 printing, **0 LEGAL**, and REFUSED. */
const TWIN_BLAST = "This attack does 30 damage for each Energy attached to both Active Pokémon.";
/** The coin form of the same printed noun — 1 printing, 1 LEGAL. 🆕🆕 **D475 BUILT
    IT**, and the two facts this file carried about it both held: it is NOT
    `AttackFlipCount.attachedEnergy` (that member reads *"attached to this Pokémon"*,
    one body, and this names two), and it is not either DAMAGE reader's either — it is
    `deriveAttackCoinFlip` through a fifth, NULLARY `AttackFlipCount` member
    `bothActivesEnergy`. The rungs below were RE-POINTED rather than deleted (D418):
    what they were really pinning is that the DAMAGE readers still refuse it, and that
    claim is untouched. */
const TWIN_FLIP =
  "Flip a coin for each Energy attached to both Active Pokémon. This attack does 60 damage for each heads.";

/** Pachirisu sv01-068 "Everyone Discharge" — the RE-HOMED unsimulated-"+" witness,
    and its two halves taken apart. */
const EVERYONE_DISCHARGE =
  "This attack does 20 more damage for each of your Benched {L} Pokémon. This attack's damage isn't affected by Weakness.";
const EVERYONE_DISCHARGE_COUNT_HALF =
  "This attack does 20 more damage for each of your Benched {L} Pokémon.";
const EVERYONE_DISCHARGE_SUPPRESS_HALF = "This attack's damage isn't affected by Weakness.";

/** The SNIPE shape — 5 printings / 3 LEGAL. A CHOSEN target sits between the
    amount and the "for each", so neither scaling reader can line up. */
const SNIPE_SCALE =
  "This attack does 20 damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** D128's family — 5 printings / 1 LEGAL on the self side. */
const COIN_PER_ENERGY =
  "Flip a coin for each Energy attached to this Pokémon. This attack does 80 damage for each heads.";

/** One seed for the whole suite: nothing here flips a coin on a path that matters,
    and every Active, Benched body and attached Energy is placed by surgery — so a
    seed table would describe a shuffle rather than a rule (D143's move, inherited
    by every scaling suite since). */
const SEED = 5;

/** The attack indices, keyed by name so no case addresses a fold by number. */
const SELF = { power: 0, flare: 1, overflow: 2, basic: 3, special: 4 } as const;
const TWIN = { surge: 0, blast: 1, flip: 2 } as const;
const OPP = { drain: 0, siphon: 1, field: 2, flare: 3 } as const;
const BENCH = { herd: 0, crowd: 1, flank: 2 } as const;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** `by`'s opponent opens and passes, so the attacking seat carries no §4
    first-turn restriction. BOTH Benches are cleared and both Actives placed by
    surgery: every number this suite measures is a POPULATION, so a body the setup
    shuffle happened to place would silently move the answer. */
function board(attacker: string, defender: string, by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: SELF_ENERGY_DECK, p2: SELF_ENERGY_DECK }, { first: opener }),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, attacker);
  state = clearBench(state, by);
  state = setActiveFromDeck(state, opener, defender);
  return clearBench(state, opener);
}

/** …with `count` `fix-titan`s standing on `seat`'s Bench. */
function withBench(state: GameState, seat: Seat, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i += 1) next = benchFromDeck(next, seat, "fix-titan");
  return next;
}

function swing(state: GameState, index: number, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}

/** The `dealt` on the one DAMAGE_DEALT row, or null when the attack dealt none. */
function dealt(events: GameEvent[]): number | null {
  return find(events, "DAMAGE_DEALT")?.dealt ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The fixture pool — a SEPARATE population, swept BEFORE anything was written.
// ─────────────────────────────────────────────────────────────────────────────

describe("the fixture pool — swept first, and this time it was NOT empty", () => {
  it("⚠️ FOUND EXACTLY ONE REUSE, AND IT IS THE LOAD-BEARING NEGATIVE (sv03-030)", () => {
    // D156's rule, asserted rather than remembered. FIVE slices running have swept
    // this pool expecting reuse and found ZERO — and this is the sweep that pays
    // out, on the one sentence where a silent collision costs the most.
    // `sv03-030` Entei carries `energyOnSelf`'s exact printed sentence, and it
    // carried it as an assertion that NOTHING reads it. A slice that skipped this
    // sweep would have met the fact as five red assertions in four files it does
    // not own (which is exactly what happened to D193) instead of as a measurement
    // before the first line was written.
    //
    // The sweep is kept as a test so a later slice that adds one of these
    // sentences to another fixture learns it here rather than by a double answer.
    const mine = new Set(["fix-selfenergy", "fix-bothactives"]);
    const sentences = [
      POWER_DRAW,
      FLARE_DRAW,
      OVERFLOW,
      BASIC_DRAW,
      ATTACH_THEN_DRAW,
      BLAZE_BALL,
      TWIN_SURGE,
      TWIN_BLAST,
      TWIN_FLIP,
    ];
    const carriers = Object.entries(FIXTURE_POOL).filter(
      ([id, card]) =>
        !mine.has(id) && (card.attacks ?? []).some((a) => sentences.includes(a.effect ?? "")),
    );
    expect(carriers.map(([id]) => id)).toEqual(["sv03-030"]);
    // …and it is BLAZE_BALL specifically, at index 0 — named so a later slice that
    // changes which sentence Entei carries cannot satisfy this by accident.
    expect(FIXTURE_POOL["sv03-030"]?.attacks?.[0]?.effect).toBe(BLAZE_BALL);
    // The BOTH-ACTIVES member found the empty pool the other five slices did: no
    // fixture printed any of its three sentences before this one.
    const twins = [TWIN_SURGE, TWIN_BLAST, TWIN_FLIP];
    const twinCarriers = Object.entries(FIXTURE_POOL).filter(
      ([id, card]) =>
        !mine.has(id) && (card.attacks ?? []).some((a) => twins.includes(a.effect ?? "")),
    );
    expect(twinCarriers.map(([id]) => id)).toEqual([]);
  });

  it("carries `fix-selfenergy`'s WHOLE attack list, indices and printed markers", () => {
    // The whole list, so the fixture cannot be wrong by OMISSION (D156's failure
    // mode) and no later slice indexes into a short one. SYNTHETIC on purpose: the
    // manifest generator reads a `.wrangler` D1 that is absent from this container
    // (`SQLITE_CANTOPEN`), so `CATALOG_MANIFEST` cannot be regenerated and a
    // real-card fixture could not be diffed against its printing — `fix-*` bodies
    // are skipped by `catalogManifest.test.ts` by construction. The STRINGS are
    // the catalog's, char for char, with their real printed bases.
    expect(FIXTURE_POOL["fix-selfenergy"]?.attacks).toEqual([
      { cost: ["Colorless"], name: "Power Draw", effect: POWER_DRAW, damage: "30+" },
      { cost: ["Colorless"], name: "Flare Draw", effect: FLARE_DRAW, damage: "40+" },
      { cost: ["Colorless"], name: "Overflow", effect: OVERFLOW, damage: "30×" },
      { cost: ["Colorless"], name: "Basic Draw", effect: BASIC_DRAW, damage: "40×" },
      // 🆕🆕 D459 — index 4. The SENTENCE is the catalog's char for char; the NAME and
      // the `70×` marker are SYNTHETIC and the fixture's doc block says so (D425: an
      // unresolvable card is stated as unresolved, never invented).
      { cost: ["Colorless"], name: "Special Draw", effect: SPECIAL_DRAW, damage: "70×" },
    ]);
    // Fire, because the ordering witness needs a ×2-Fire defender.
    expect(FIXTURE_POOL["fix-selfenergy"]?.types).toEqual(["Fire"]);
  });

  it("carries `fix-bothactives`' WHOLE attack list — one member and TWO refusals", () => {
    expect(FIXTURE_POOL["fix-bothactives"]?.attacks).toEqual([
      { cost: ["Colorless"], name: "Twin Surge", effect: TWIN_SURGE, damage: "30+" },
      { cost: ["Colorless"], name: "Twin Blast", effect: TWIN_BLAST, damage: "30×" },
      { cost: ["Colorless"], name: "Twin Flip", effect: TWIN_FLIP, damage: "60×" },
    ]);
    expect(FIXTURE_POOL["fix-bothactives"]?.types).toEqual(["Fire"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The RE-HOMING — the assertion set that had to move before either member landed.
// ─────────────────────────────────────────────────────────────────────────────

describe("the unsimulated-'+' witness, re-homed off Entei onto Pachirisu", () => {
  it("Entei's sentence changed SIGN: the reader that refused it now answers it", () => {
    // The half that used to be a null. `energyOnSelf` reads Blaze Ball with the
    // TYPE FILTER resolved — `Fire`, not `null` — so the member is not merely
    // matching the sentence but reading the `{R}` inside it.
    expect(deriveAttackDamageBonus(BLAZE_BALL)).toEqual({
      per: 20,
      count: { kind: "energyOnSelf", energyType: "Fire" },
    });
    expect(deriveAttackDamageMultiplier(BLAZE_BALL)).toBeNull();
  });

  it("Pachirisu's printing stays unread — and BOTH reasons are driven separately", () => {
    // ⚠️ THE WHOLE POINT OF THE REPLACEMENT, and it is asserted as independent
    // facts rather than one, because the value of this witness is that any one of
    // them alone would keep it standing.
    //
    // REASON 1 — the printing is TWO sentences and every reader here is
    // whole-sentence anchored, so the COMPOSITION is refused whatever the halves
    // do.
    expect(deriveAttackDamageSuppression(EVERYONE_DISCHARGE)).toBeNull();
    // ⚠️ AND A MEASUREMENT THAT CORRECTED THIS SLICE'S OWN PREMISE. The plan said
    // the second sentence is one D192's suppression reader answers when printed
    // alone; it is NOT. "This attack's damage isn't affected by Weakness." has
    // **zero standalone printings** in the D1 (2026-08-04) — the catalog prints it
    // only ever as the TAIL of a two-sentence attack (3 rows, of which 2 are legal
    // and neither is this card). D192's four anchored spellings are "…Resistance.",
    // "…Weakness or Resistance.", "…any effects on your opponent's Active
    // Pokémon." and the compound; a Weakness-only sentence is not among them
    // BECAUSE the pool does not print one standalone. So the suppression half is
    // refused even in isolation, which is a THIRD independent reason rather than
    // the corroboration it was expected to be.
    expect(deriveAttackDamageSuppression(EVERYONE_DISCHARGE_SUPPRESS_HALF)).toBeNull();
    // …and D192's reader is alive on the spellings the pool DOES print standalone,
    // so the null above is a refusal and not a dead reader.
    expect(
      deriveAttackDamageSuppression("This attack's damage isn't affected by Weakness or Resistance."),
    ).toEqual({ weakness: true, resistance: true });
    // REASON 2 — 🆕🆕 **D467: THIS REASON HAS EXPIRED, AND IT IS RECORDED HERE
    // RATHER THAN DELETED (D444/D447).** It used to read *"the count source is a
    // TYPED count of BODIES on the attacker's own Bench, and no member answers
    // it"*. `yourBenchCount` gained an optional `filter` at D466 and the attacker's
    // Bench gained a CAPTURING anchor at D467, so the count half is READ now — with
    // the `{L}` resolved to Lightning, which is the half that says the noun is
    // parsed rather than matched. **The witness survives on REASON 1 and REASON 3,
    // which is exactly why it was written as three independent facts** ("any one of
    // them alone would keep it standing") — and this is the first time that
    // construction has had to pay out.
    expect(deriveAttackDamageBonus(EVERYONE_DISCHARGE_COUNT_HALF)).toEqual({
      per: 20,
      count: {
        kind: "yourBenchCount",
        filter: { kind: "typedPokemon", pokemonType: "Lightning" },
      },
    });
    // …and the `×` fold still refuses it, because the adjective picks the fold and
    // the column prints no filtered `×` Bench sentence at all (D435).
    expect(deriveAttackDamageMultiplier(EVERYONE_DISCHARGE_COUNT_HALF)).toBeNull();
    // …and the whole printing is unread by every reader in the family, which is
    // what makes it a witness at all.
    const readers = [
      deriveAttackDamageBonus,
      deriveAttackDamageMultiplier,
      deriveAttackDamagePenalty,
      deriveAttackEffect,
      // 🆕🆕 D419 — COMPLETED TO THE MODULE'S TWELVE. This list was hand-kept INLINE,
      // which is why D418's survey of forty module-level `READERS` arrays did not see
      // it at all. ⚠️ A REFUSAL OVER A SHORT LIST IS NOT FALSE, IT IS NARROWER — the
      // missing reader is simply never asked and the rung stays green, which is the
      // failure mode this whole run is about.
      deriveAttackBonusConsequent,
      deriveAttackCancelRequirement,
      deriveAttackDamageSuppression,
      deriveAttackDiscardScaledBoost,
      deriveAttackOptionalBoost,
      deriveAttackOptionalCostBoost,
      deriveAttackRequirement,
      // 🆕🆕 D428 — THE THIRTEENTH, the PRE-DAMAGE Tool discard. ⚠️ SPLICED BEFORE THE
      // LAST ENTRY RATHER THAN APPENDED, D419's rule: mutant `find` strings quote an
      // array's LAST entries plus its closing bracket, and appending moves that anchor
      // without a character of it changing.
      deriveAttackPreDamage,
      deriveAttackCoinFlip,
    ];
    // 🆕🆕 D419 — THE TWO-RUNG GUARD, CO-LOCATED because this list is function-local.
    // The diff names the drifting reader; the COUNT is pinned separately because a
    // diff alone stays GREEN when a slice deletes a reader from the module and from
    // this list in the same commit.
    expect(readers.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(13);
    // 🆕🆕 D419 — the claim taken off the MODULE. The loop below names WHICH reader
    // broke; this line is what makes "unread by every reader in the family" a fact
    // about `effects.ts` rather than about the array above it.
    expect(resolvedByAnyReader(EVERYONE_DISCHARGE), EVERYONE_DISCHARGE).toBe(false);
    for (const read of readers) {
      expect(read(EVERYONE_DISCHARGE), read.name).toBeNull();
    }
    // The fixture really prints it, so the assertions above are about a card and
    // not about a string this file made up. sv01-208 is the byte-identical second
    // printing, and it must move in step or the witness is only half re-homed.
    expect(FIXTURE_POOL["sv01-068"]?.attacks?.[0]?.effect).toBe(EVERYONE_DISCHARGE);
    expect(FIXTURE_POOL["sv01-208"]?.attacks?.[0]?.effect).toBe(EVERYONE_DISCHARGE);
    expect(FIXTURE_POOL["sv01-068"]?.attacks?.[0]?.damage).toBe("10+");
  });

  it("⚠️ the re-homed witness is TRIPLY protected — any one reason alone suffices", () => {
    // Stated as an assertion rather than a comment, because it is the property
    // that makes this re-homing survive the next slice and Entei's did not.
    //
    // A slice that builds the typed bench count: reason 1 still holds. The proof
    // is that the ONE-sentence form and the TWO-sentence form are different
    // strings, and the reader is anchored on the whole of what it is given.
    expect(EVERYONE_DISCHARGE.startsWith(EVERYONE_DISCHARGE_COUNT_HALF)).toBe(true);
    expect(EVERYONE_DISCHARGE).not.toBe(EVERYONE_DISCHARGE_COUNT_HALF);
    // A slice that adds sentence splitting: reason 2 still holds — the count half
    // is refused on its own, above, by a reader given nothing but that half.
    //
    // And the contrast with Entei is the whole argument: Blaze Ball was ONE
    // sentence, so its single reason (no count source) was the only thing keeping
    // it loud, and the first slice to build that count source retired it.
    expect(BLAZE_BALL.split(". ").length).toBe(1);
    expect(EVERYONE_DISCHARGE.split(". ").length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The readers.
// ─────────────────────────────────────────────────────────────────────────────

describe("deriveAttackDamageBonus / …Multiplier — the two new members", () => {
  it("reads the ATTACKER's own Energy on BOTH folds, typed and untyped", () => {
    expect(deriveAttackDamageBonus(POWER_DRAW)).toEqual({
      per: 50,
      count: { kind: "energyOnSelf", energyType: null },
    });
    expect(deriveAttackDamageBonus(FLARE_DRAW)).toEqual({
      per: 80,
      count: { kind: "energyOnSelf", energyType: "Fire" },
    });
    expect(deriveAttackDamageMultiplier(OVERFLOW)).toEqual({
      per: 30,
      count: { kind: "energyOnSelf", energyType: null },
    });
    // The `per` is CAPTURED, not hard-coded — three different amounts on one
    // sentence shape, which is what makes every damage assertion below a claim
    // about the capture.
    expect(deriveAttackDamageBonus(POWER_DRAW.replace("50 more", "10 more"))?.per).toBe(10);
    expect(deriveAttackDamageMultiplier(OVERFLOW.replace("30 damage", "50 damage"))?.per).toBe(50);
  });

  it("⚠️ tells 'no filter' from 'a filter I could not read' — `null` vs LOUD", () => {
    // THE GUARD THIS WHOLE MEMBER TURNS ON, and the one D193 paid a seventh edit
    // for on the opponent side. An ABSENT type token is the UNTYPED reading
    // (`energyType: null`, count every attached card). An UNRESOLVABLE one must
    // count NOTHING and say so — collapsing the two would make "for each Basic
    // Energy attached…" quietly score the unfiltered total, which is a bigger
    // number on a real legal printing.
    expect(deriveAttackDamageMultiplier(OVERFLOW)?.count).toEqual({
      kind: "energyOnSelf",
      energyType: null,
    });
    // 🆕🆕 **D500 RE-POINTED THIS HALF RATHER THAN DELETING IT (D438/D444), AND THE
    // RUNG'S DISCRIMINATION MOVED WITH IT.** `Basic` used to be this rung's
    // unresolvable token; it is in `CLAUSE_ENERGY_TOKENS` now and resolves to the
    // card CATEGORY `"basic"`, so the claim above it is that the reader answers the
    // category rather than the unfiltered total — a build that collapsed the two
    // nullish answers would answer `energyType: null` here and score every attached
    // card.
    //
    // 🛑 **WHAT THE OLD CLAIM COULD CATCH THAT THIS ONE CANNOT** (D418's second
    // half): a re-point onto a token that RESOLVES is true under the real build and
    // under a build that quietly defaulted an unresolvable token, so it can no longer
    // see the collapse on its own. The LOUD half is carried by the two lines below —
    // `{C}`, which is deliberately absent from the table, and a junk token that never
    // could be in it — and those are now the only rungs in this file that hold it.
    expect(deriveAttackDamageMultiplier(BASIC_DRAW)).toEqual({
      per: 40,
      count: { kind: "energyOnSelf", energyType: "basic" },
    });
    // `{C}` is deliberately absent from the token table — Colorless is the
    // conservative provision fallback for unauthored Special Energy, so a `{C}`
    // clause would quietly match cards nobody meant.
    expect(deriveAttackDamageBonus(POWER_DRAW.replace("each Energy", "each {C} Energy"))).toBeNull();
    // 🆕🆕 D500 — and a token that could never be in the table, so the LOUD half does
    // not rest on one deliberately-omitted code. `{C}`'s absence is a DECISION and
    // could in principle be revisited; `Fancy` is not a word the vocabulary has any
    // reason to gain, so this is the half of the pair with no expiry date.
    expect(
      deriveAttackDamageBonus(POWER_DRAW.replace("each Energy", "each Fancy Energy")),
    ).toBeNull();
    // …while `Special` and the spelled-out names DO resolve, through the shared
    // token table rather than a local lookup (D118's dual notation).
    expect(deriveAttackDamageBonus(POWER_DRAW.replace("each Energy", "each Special Energy"))).toEqual(
      { per: 50, count: { kind: "energyOnSelf", energyType: "special" } },
    );
    expect(deriveAttackDamageBonus(FLARE_DRAW.replace("{R}", "Water"))).toEqual({
      per: 80,
      count: { kind: "energyOnSelf", energyType: "Water" },
    });
  });

  it("reads BOTH Actives on the additive fold only", () => {
    expect(deriveAttackDamageBonus(TWIN_SURGE)).toEqual({
      per: 30,
      count: { kind: "bothActivesEnergyCount" },
    });
    expect(deriveAttackDamageMultiplier(TWIN_SURGE)).toBeNull();
  });

  it("⚠️ PINS THE ABSENCE: `bothActivesEnergyCount` is ADD-only by LEGALITY", () => {
    // …and NOT by absence, which is the OPPOSITE answer to `bothSidesBenchCount`
    // and the reason this is a pin rather than a shrug. The bare twin IS printed —
    // 1 printing, **0 LEGAL** — so refusing it is a decision about the legal pool
    // and not a statement that the sentence does not exist. Building the arm would
    // have bought a regex and an evaluator branch for a card no legal deck plays.
    expect(deriveAttackDamageMultiplier(TWIN_BLAST)).toBeNull();
    expect(deriveAttackDamageBonus(TWIN_BLAST)).toBeNull();
    expect(deriveAttackDamagePenalty(TWIN_SURGE.replace(" more damage", " less damage"))).toBeNull();
    // The twin is a real string the fixture prints, not one this test constructed.
    expect(FIXTURE_POOL["fix-bothactives"]?.attacks?.[TWIN.blast]?.effect).toBe(TWIN_BLAST);
  });

  it("⚠️ PINS THE ABSENCE: no TYPE FILTER on the both-Actives sentence", () => {
    // The pool prints no typed spelling of it in any text column, so an optional
    // capture here would be a field no reader could ever set — the mirror of
    // D193's refusal to give OPPONENT_ENERGY_SCALE a zone it can never vary. A
    // typed printing therefore stays LOUD, which is the correct answer and not a
    // gap.
    expect(deriveAttackDamageBonus(TWIN_SURGE.replace("each Energy", "each {R} Energy"))).toBeNull();
    expect(deriveAttackDamageBonus(TWIN_SURGE)?.count).toEqual({
      kind: "bothActivesEnergyCount",
    });
  });

  it("refuses the near-misses by the anchors alone — leading text, lowercase, no period", () => {
    for (const sentence of [POWER_DRAW, FLARE_DRAW, OVERFLOW, TWIN_SURGE]) {
      const read = (t: string) => deriveAttackDamageBonus(t) ?? deriveAttackDamageMultiplier(t);
      expect(read(`Flip a coin. If heads, ${sentence.toLowerCase()}`)).toBeNull();
      expect(read(sentence.replace(/^This/, "this"))).toBeNull();
      expect(read(sentence.slice(0, -1))).toBeNull();
      expect(read(`${sentence} Then, shuffle your deck.`)).toBeNull();
    }
  });

  it("⚠️ the greedy `(.+)` cannot swallow a leading sentence into the type token", () => {
    // The one shape this pattern's optional capture could go wrong on: a
    // multi-sentence printing whose TAIL happens to be this sentence's tail. The
    // `^This attack does (\d+) ` head is what stops it, and if it ever did match,
    // the swallowed token would be unresolvable and the arm would stay LOUD
    // anyway — two independent guards, driven rather than argued.
    expect(deriveAttackDamageMultiplier(`Draw a card. ${OVERFLOW}`)).toBeNull();
    expect(deriveAttackDamageBonus(`Draw a card. ${POWER_DRAW}`)).toBeNull();
    // And the two-sentence LEGAL printing this family really has: refused, with
    // its second sentence intact so the refusal is about composition.
    expect(deriveAttackDamageMultiplier(ATTACH_THEN_DRAW)).toBeNull();
    expect(deriveAttackDamageBonus(ATTACH_THEN_DRAW)).toBeNull();
    expect(ATTACH_THEN_DRAW.split(". ").length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The evaluator, on boards where every member gives a DIFFERENT number.
// ─────────────────────────────────────────────────────────────────────────────

/** THE MIRROR BOARD — one setup on which all six members of this neighbourhood
    disagree, so a reader that started answering two of them collapses visibly.

      attacker's Active   3 Energy (2 × {R}, 1 × {W})
      attacker's Bench    5 bodies, the first holding 1 × {R}
      defender's Active   5 Energy
      defender's Bench    1 body holding 2 Energy

    `energyOnSelf` untyped 3 · `energyOnSelf {R}` 2 · the attacker's whole SIDE 4 ·
    `energyOnOpponent` active 5 · `energyOnOpponent` board 7 ·
    `bothActivesEnergyCount` 8 · `opponentBenchCount` 1 · `bothSidesBenchCount` 6.
    Eight distinct numbers on one board.

    ⚠️ 8 ≠ 7 IS ONE LOAD-BEARING INEQUALITY. `bothActives` = self + oppActive and
    `board` = oppActive + oppBench, so the two coincide exactly when the attacker
    holds as much as the opponent's Bench — the boards are chosen so it does not.

    ⚠️ AND THE {R} ON THE ATTACKER'S BENCH IS THE OTHER, ADDED AFTER A MUTANT
    SURVIVED. The first version of this board left the attacker's five Benched
    bodies BARE, which made "the Active" and "the whole side" the same 3 — so
    `countEnergyInPlay(state, attackerSeat, …)` (the board-zone call copied
    verbatim off `energyOnOpponent`'s own arm one line up, and exactly the mistake
    an author writing the mirror would make) passed every case. One {R} on
    `bench[0]` separates them in BOTH readings at once: untyped 3 vs 4, and
    filtered 2 vs 3. */
function mirrorBoard(attacker: string): GameState {
  let state = board(attacker, "fix-titan");
  state = attachFromDeck(state, "p1", "fix-fire-energy", 2);
  state = attachFromDeck(state, "p1", "fix-water-energy", 1);
  state = attachFromDeck(state, "p2", "fix-water-energy", 5);
  state = withBench(state, "p2", 1);
  state = attachBenchFromDeck(state, "p2", 0, "fix-water-energy", 2);
  state = withBench(state, "p1", 5);
  return attachBenchFromDeck(state, "p1", 0, "fix-fire-energy", 1);
}

describe("scaledAttackDamage — the MIRROR board, where all seven answers differ", () => {
  it("counts the ATTACKER's own Energy, untyped: 3 × 50 onto a printed 30", () => {
    expect(dealt(swing(mirrorBoard("fix-selfenergy"), SELF.power).events)).toBe(30 + 3 * 50);
  });

  it("counts the ATTACKER's own {R} Energy only: 2, not the 3 it holds", () => {
    // The filter reads by PROVISION (D118), so this is the same question
    // `hasAttachedEnergy` answers and not a second opinion about it. The Water
    // Energy sitting on the same body is what makes 2 ≠ 3 a claim.
    expect(dealt(swing(mirrorBoard("fix-selfenergy"), SELF.flare).events)).toBe(40 + 2 * 80);
  });

  it("counts BOTH Actives: 3 mine + 5 theirs = 8 × 30 onto a printed 30", () => {
    // ⚠️ AND 8 IS NOT 3, NOT 5, AND NOT 7 — the three answers a reader that
    // answered one end, the other end, or the opponent's whole board would give on
    // this identical board. That is the mirror this member owes.
    expect(dealt(swing(mirrorBoard("fix-bothactives"), TWIN.surge).events)).toBe(30 + 8 * 30);
  });

  it("⚠️ the MIRROR: D193's four opponent-side answers on the SAME board", () => {
    // Driven rather than argued. If `energyOnSelf` had been implemented by
    // widening `energyOnOpponent` with a seat, or `bothActivesEnergyCount` by
    // reusing the board zone, one of these numbers would move — and no assertion
    // inside this slice's own fixtures could see it.
    const opp = mirrorBoard("fix-oppenergy");
    expect(dealt(swing(opp, OPP.drain).events)).toBe(30 + 5 * 30); // active zone: 5
    expect(dealt(swing(opp, OPP.siphon).events)).toBe(5 * 20); // active zone, × fold
    expect(dealt(swing(opp, OPP.field).events)).toBe(7 * 60); // board zone: 5 + 2
    const bodies = mirrorBoard("fix-benchcount");
    expect(dealt(swing(bodies, BENCH.crowd).events)).toBe(20 + 1 * 20); // their Bench: 1 BODY
    expect(dealt(swing(bodies, BENCH.herd).events)).toBe(20 + 6 * 20); // both Benches: 5 + 1
  });

  it("⚠️ counts ONE BODY, not the attacker's side — 3 and 2, never 4 and 3", () => {
    // ⚠️ THE ASSERTION A MUTANT BOUGHT. `energyOnSelf`'s printed noun is "attached
    // to THIS Pokémon", one body — and the neighbouring `energyOnOpponent` arm
    // directly above it in `scaledAttackDamage` really does call
    // `countEnergyInPlay(state, seat, energyType)` for its board zone, so copying
    // that line is the mistake an author writing this mirror would actually make.
    // It survived the first mutation round because the attacker's Bench was bare.
    //
    // Both readings are separated here at once, which is what makes this a claim
    // about the ZONE rather than about the filter: untyped is 3 and not 4,
    // filtered is 2 and not 3.
    const state = mirrorBoard("fix-selfenergy");
    expect(state.players.p1.active?.energy).toHaveLength(3);
    expect(state.players.p1.bench[0]?.energy).toHaveLength(1);
    expect(dealt(swing(state, SELF.power).events)).toBe(30 + 3 * 50);
    expect(dealt(swing(state, SELF.power).events)).not.toBe(30 + 4 * 50);
    expect(dealt(swing(state, SELF.flare).events)).toBe(40 + 2 * 80);
    expect(dealt(swing(state, SELF.flare).events)).not.toBe(40 + 3 * 80);
    // …and the board-wide spelling of the attacker's own Energy was UNPRINTED when
    // D196 measured it, so there was no sentence that could ever want the other
    // answer. 🆕🆕 **D407: THERE IS ONE NOW** — *"…for each {G} Energy attached to
    // all of your Pokémon."*, 4 legal printings — and it takes the `zone: "board"`
    // path instead. What is pinned below is that THESE sentences still take THIS
    // one: the field is optional and its absent value is the attacking body.
  });

  it("⚠️ counts CARDS, not units — and delegates rather than re-deriving", () => {
    // §6.3's reading, inherited from `countAttachedEnergy` rather than restated:
    // an Energy card is ONE Energy however many units it provides. The untyped arm
    // reads `pokemon.energy.length`, so the two Fire and one Water on the attacker
    // are 3 whatever they pay for — which is also why the {C} cost being paid by
    // one of the counted cards cannot skew the answer.
    const state = mirrorBoard("fix-selfenergy");
    expect(state.players.p1.active?.energy).toHaveLength(3);
    expect(dealt(swing(state, SELF.power).events)).toBe(30 + 3 * 50);
  });

  it("an attacker holding ONLY its cost still counts it — 1, never 0", () => {
    // The degenerate end. The Energy that PAYS is attached, so it COUNTS; a member
    // that subtracted the cost would give 0 here and a plausible-looking one.
    let state = board("fix-selfenergy", "fix-titan");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    expect(dealt(swing(state, SELF.power).events)).toBe(30 + 1 * 50);
    // …and with the defender bare, BOTH Actives is that same 1.
    let twin = board("fix-bothactives", "fix-titan");
    twin = attachFromDeck(twin, "p1", "fix-energy", 1);
    expect(dealt(swing(twin, TWIN.surge).events)).toBe(30 + 1 * 30);
  });

  it("the `×` fold DROPS the printed base — 3 × 30 is 90, not 120", () => {
    const state = mirrorBoard("fix-selfenergy");
    const row = find(swing(state, SELF.overflow).events, "DAMAGE_DEALT");
    expect(FIXTURE_POOL["fix-selfenergy"]?.attacks?.[SELF.overflow]?.damage).toBe("30×");
    expect(row?.base).toBe(0);
    expect(row?.scaled).toBe(90);
    expect(row?.dealt).toBe(90);
  });

  it("🆕🆕 D500 — the CATEGORY filter FOLDS on a real board, and this board cannot prove it right", () => {
    // 🆕🆕 **D500 INVERTED THIS RUNG, AND THE HONEST FORM SAYS WHAT THE BOARD CANNOT
    // SHOW.** Index 3 is a real LEGAL printing (`censusAttackCorpus.ts` file line
    // 580, 1 legal) and `Basic` now resolves, so the loud path is gone and the `×`
    // fold runs: `mirrorBoard` attaches 2 {R} + 1 {W} to the attacker, all three
    // BASIC Energy cards, so the count is 3 and the row is 3 × 40 = 120 — the very
    // number the old comment named as the *wrong* answer, because it was the
    // unfiltered one.
    //
    // 🛑 **THAT COINCIDENCE IS THE POINT, AND IT IS WHY THIS RUNG IS NOT THE
    // DISCRIMINATOR** (D482's arithmetic-coincidence class). With ZERO Special Energy
    // on the body, `energyType: "basic"` and `energyType: null` are the same count on
    // this board and would be the same number under either build. The board that
    // separates them — and separates both from the `"special"` reading and from a
    // PROVISION reading — is `basicEnergyScaling.test.ts` §2, which fields a Special
    // that provides a basic type. This rung pins that the sentence is no longer loud
    // and says plainly that it proves nothing further.
    const state = mirrorBoard("fix-selfenergy");
    const { events } = swing(state, SELF.basic);
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    // ⚠️ THE `×` FOLD DROPS THE PRINTED BASE, which is the half that DOES discriminate
    // here: the pre-D500 loud path kept the printed 40 with no `scaled` field at all,
    // so a build that silently reverted the vocabulary would answer 40 and no `scaled`
    // rather than 120 and a `scaled`.
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.base).toBe(0);
    expect(row?.scaled).toBe(120);
    expect(row?.dealt).toBe(120);
    expect(row?.dealt).not.toBe(40);
  });

  it("the printed refusal on `fix-bothactives` stays LOUD on a real board — and D475's does NOT", () => {
    // 🆕🆕 **D475 SPLIT THIS RUNG IN TWO AND KEPT BOTH HALVES (D424: every "X is
    // refused" owes a neighbouring "Y is admitted" on the same axis).** "Twin Blast"
    // is still refused — it is the MULTIPLY twin of `bothActivesEnergyCount`, printed
    // once and **0 LEGAL**, so no arm was built and the loud path is the right answer.
    // "Twin Flip" is corpus file line 231 and D475 reads it, so it must NOT be loud,
    // and asserting the absence of the row here is what stops a later slice quietly
    // un-building it: an `ATTACK_EFFECT_SKIPPED` naming "Twin Flip" is now a defect.
    const state = mirrorBoard("fix-bothactives");
    expect(find(swing(state, TWIN.blast).events, "ATTACK_EFFECT_SKIPPED")).toMatchObject({
      attack: "Twin Blast",
    });
    const flipped = swing(state, TWIN.flip);
    expect(find(flipped.events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    // …and it really FLIPPED, once per Energy CARD on the two Actives. `mirrorBoard`
    // gives P1's Active 2 Fire + 1 Water and P2's Active 5 Water, so the count is
    // **3 + 5 = 8** — the same two piles the "Twin Surge" case above folds at 30 each
    // for 30 + 8 x 30. That the DAMAGE fold and the FLIP count read the identical
    // number off the identical board is the point: one printed noun, one counter
    // (D159). Only the flip COUNT is asserted here — 8 heads would be 480 against
    // `fix-titan`'s 340 HP, so the seed decides whether a Knock Out truncates the
    // tail, and the count is the fact this rung is about.
    expect(flipped.events.filter((e) => e.type === "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ordering — one witness that does NOT commute, and the absences that cannot have
// one.
// ─────────────────────────────────────────────────────────────────────────────

describe("the FOLD's position in §8.5 — pre-W/R, witnessed and pinned", () => {
  it("the ADDITIVE fold runs BEFORE Weakness: (30 + 50) × 2 = 160, not 30 × 2 + 50", () => {
    // A witness that does NOT commute, which is the only kind worth writing. A
    // MULTIPLIER is what makes the two orderings differ; a subtractive modifier
    // would give the same number either way and would assert nothing. Both
    // readings (160 and 110) are under `fix-pokemon-v-weak`'s 210 HP, so no KO
    // truncates the comparison.
    let state = board("fix-selfenergy", "fix-pokemon-v-weak");
    state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
    const row = find(swing(state, SELF.power).events, "DAMAGE_DEALT");
    expect(row?.base).toBe(30);
    expect(row?.scaled).toBe(50);
    expect(row?.dealt).toBe(160);
    expect(row?.dealt).not.toBe(110);
  });

  it("BOTH Actives folds pre-W/R too: (30 + 2 × 30) × 2 = 180, not 30 × 2 + 60", () => {
    // The same witness on the member whose count spans the table — and here the
    // DEFENDER contributes to the very number that is then doubled by its own
    // Weakness, which is a shape no other member in this family has.
    let state = board("fix-bothactives", "fix-pokemon-v-weak");
    state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
    state = attachFromDeck(state, "p2", "fix-water-energy", 1);
    const row = find(swing(state, TWIN.surge).events, "DAMAGE_DEALT");
    expect(row?.base).toBe(30);
    expect(row?.scaled).toBe(60);
    expect(row?.dealt).toBe(180);
    expect(row?.dealt).not.toBe(120);
  });

  it("⚠️ PINS THE ABSENCE: the `×` fold has ONE term, so NO ordering witness exists", () => {
    // D193's result, repeating on this member for the same structural reason:
    // where the multiply fold drops the printed base there is nothing for `scaled`
    // to be ordered against, so every ordering of a one-term sum agrees. This
    // asserts the ABSENCE — the base really is dropped, at a printed base that is
    // NOT zero — rather than writing a board that passes while claiming nothing.
    let state = board("fix-selfenergy", "fix-pokemon-v-weak");
    state = attachFromDeck(state, "p1", "fix-fire-energy", 2);
    const row = find(swing(state, SELF.overflow).events, "DAMAGE_DEALT");
    // ⚠️ AND THE ROW SAYS SO IN ITS OWN SHAPE, which is sharper than the
    // arithmetic: `base` is **0**, not the printed 30 and not the folded 60, and
    // the whole term sits in `scaled`. There is no second summand anywhere in the
    // row for an ordering to permute.
    expect(FIXTURE_POOL["fix-selfenergy"]?.attacks?.[SELF.overflow]?.damage).toBe("30×");
    expect(row?.base).toBe(0);
    expect(row?.scaled).toBe(60);
    expect(row?.dealt).toBe(120); // × 2 Weakness, applied to the one term
  });

  it("⚠️ PINS THE ABSENCE: 'the DECLARATION snapshot' is unobservable for ENERGY", () => {
    // ⚠️ THE ONE MUTANT THAT SURVIVED, AND IT SURVIVED BECAUSE IT IS EQUIVALENT —
    // recorded here rather than quietly dropped. `scaledAttackDamage` is handed
    // `active`, the Active as of DECLARATION, and the plausible mutation is to read
    // `state.players[attackerSeat].active` instead. For `damageCountersOnSelf` that
    // difference is REAL and already witnessed elsewhere (a Confused attacker takes
    // 30 before the fold, so the two disagree on `damage`). For `energyOnSelf` it
    // cannot be: the ONLY mutation of the attacker between `let next = state` and
    // the fold is that confusion self-damage, which rebuilds the body through
    // `withActive` and carries `energy` across untouched — and on tails the attack
    // returns at ATTACK_FAILED without reaching the fold at all. Nothing in the
    // whole path removes an Energy from the attacker before its damage is scaled.
    //
    // So no board can tell the two readings apart, and the honest move is to pin
    // the absence rather than dress up a passing board as a witness. What IS
    // assertable is the invariant that makes it an absence: the attacker's Energy
    // is identical before and after the swing.
    const before = mirrorBoard("fix-selfenergy");
    const after = swing(before, SELF.power).state;
    expect(after.players.p1.active?.energy).toEqual(before.players.p1.active?.energy);
    // …and the sentences are single-clause, so none of them can attach or discard
    // Energy mid-attack either (the two-sentence printing that could is refused —
    // see the case below).
    for (const sentence of [POWER_DRAW, FLARE_DRAW, OVERFLOW, TWIN_SURGE]) {
      expect(deriveAttackEffect(sentence)).toBeNull();
    }
  });

  it("⚠️ PINS THE ABSENCE: no BUILT sentence here can mutate the resource it counts", () => {
    // "Read at DECLARATION" owes a witness whenever an attack could change the
    // thing it is priced on. None of the four BUILT sentences can: none removes an
    // Energy from a Pokémon, and none is a multi-sentence printing.
    for (const sentence of [POWER_DRAW, FLARE_DRAW, OVERFLOW, TWIN_SURGE]) {
      expect(deriveAttackEffect(sentence)).toBeNull();
      expect(sentence.split(". ").length).toBe(1);
    }
    // ⚠️ AND THE POOL DOES PRINT THE ONE SENTENCE THAT WOULD MAKE IT OBSERVABLE —
    // which is why this is a pinned absence and not an unexamined one. "…Before
    // doing damage, you may attach any number of Basic {W} Energy cards from your
    // hand to this Pokémon." (1 LEGAL) attaches Energy MID-ATTACK, so on that card
    // declaration-time and damage-time counts really would differ. The
    // whole-sentence anchor refuses it, so the engine never has to answer, and the
    // refusal is therefore load-bearing rather than incidental.
    expect(deriveAttackDamageMultiplier(ATTACH_THEN_DRAW)).toBeNull();
    expect(ATTACH_THEN_DRAW).toContain("Before doing damage, you may attach");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The rows this family does NOT own.
// ─────────────────────────────────────────────────────────────────────────────

describe("the EXCLUSIONS — neighbourhoods that route elsewhere or stay loud", () => {
  it("the SNIPE scales (3 legal) stay on `damageChosen`, never on this fold", () => {
    // A CHOSEN target sits between the amount and the "for each", so `(\d+) damage
    // for each` never lines up. Both readers refuse, both spellings.
    for (const per of [20, 30]) {
      const text = SNIPE_SCALE.replace("does 20 damage", `does ${per} damage`);
      expect(deriveAttackDamageBonus(text)).toBeNull();
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
    }
    // …and its typed sibling, which is the same shape with a spelled-out filter.
    expect(
      deriveAttackDamageMultiplier(SNIPE_SCALE.replace("each Energy", "each Grass Energy")),
    ).toBeNull();
  });

  it("D128's coin family keeps BOTH of its self-side and both-Actives rows", () => {
    // "Flip a coin for each Energy attached to this Pokémon. …" is
    // `AttackFlipCount.attachedEnergy` and must not reach a damage reader — a
    // sentence that reached both would fold once off the board and once off the
    // coin, which is a bigger number on the same event.
    expect(deriveAttackCoinFlip(COIN_PER_ENERGY)).not.toBeNull();
    expect(deriveAttackDamageBonus(COIN_PER_ENERGY)).toBeNull();
    expect(deriveAttackDamageMultiplier(COIN_PER_ENERGY)).toBeNull();
    // 🆕🆕 **D475 — THE BOTH-ACTIVES COIN ROW IS NOW READ, BY THE COIN READER AND
    // BY NOTHING ELSE.** Re-pointed by NAMING THE OWNER rather than flipped to a bare
    // `not.toBeNull()` (D438): the half of the old claim worth keeping is that the two
    // DAMAGE readers still refuse it, and that half is asserted unchanged beneath the
    // positive one. It is NOT `AttackFlipCount.attachedEnergy` — that member reads
    // "attached to this Pokémon", one body, and this names two — so the member is a
    // fifth, NULLARY one.
    expect(deriveAttackCoinFlip(TWIN_FLIP)).toEqual({
      kind: "perHeads",
      flips: { kind: "bothActivesEnergy" },
      per: 60,
    });
    expect(deriveAttackCoinFlip(TWIN_FLIP)).not.toEqual(deriveAttackCoinFlip(COIN_PER_ENERGY));
    expect(deriveAttackDamageBonus(TWIN_FLIP)).toBeNull();
    expect(deriveAttackDamageMultiplier(TWIN_FLIP)).toBeNull();
  });

  it("the ABILITY row that names this noun places COUNTERS and is refused", () => {
    // 2 printings / 2 LEGAL, and the only non-attack text in the pool that counts
    // "Energy attached to this Pokémon". It is a §9 recoil trigger, not a damage
    // clause, and no reader in this family may answer it.
    const ability =
      "If this Pokémon is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), put 2 damage counters on the Attacking Pokémon for each {M} Energy attached to this Pokémon.";
    expect(deriveAttackDamageBonus(ability)).toBeNull();
    expect(deriveAttackDamageMultiplier(ability)).toBeNull();
  });

  it("the D193 members did not widen — their sentences still answer only their own", () => {
    // The other direction of the mirror, at the reader rather than the evaluator:
    // `energyOnSelf` must not have loosened the opponent-side patterns into
    // answering the self-side noun, and vice versa.
    const oppActive =
      "This attack does 30 more damage for each Energy attached to your opponent's Active Pokémon.";
    expect(deriveAttackDamageBonus(oppActive)?.count).toEqual({
      kind: "energyOnOpponent",
      zone: "active",
      energyType: null,
    });
    expect(deriveAttackDamageBonus(POWER_DRAW)?.count).toEqual({
      kind: "energyOnSelf",
      energyType: null,
    });
    // 🆕🆕 **D407 SPLIT THIS CLAIM IN TWO, AND ONLY HALF OF IT SURVIVED.** The
    // board-zone spelling of the ATTACKER's own Energy is printed on the ADDITIVE
    // fold (4 legal printings, typed `{G}`) and is now read there; it is printed
    // NOWHERE on the `×` fold, so that reader still may not invent it. Both halves
    // are asserted, because the next author to see two Energy members will assume
    // both reach both zones — and on this side exactly one of them does.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 60 damage for each Energy attached to all of your Pokémon.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each {G} Energy attached to all of your Pokémon.",
      )?.count,
    ).toEqual({ kind: "energyOnSelf", zone: "board", energyType: "Grass" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🆕🆕 D459 — THE PRINTED NOUN `Energy card`, AND THE MINIMAL PAIR IT MAKES WITH
// INDEX 3.
//
// ONE optional group on `SELF_ENERGY_MULTIPLY` (`Energy(?: card)?`), on the `×`
// fold only. ZERO new ops, op fields, `DamageCountSource` members, readers
// (surface unmoved at 13), prompt kinds, error codes, registry rows,
// `packages/schema` bytes, `redact.ts` bytes and **ZERO evaluator bytes** —
// `attack.ts`'s `energyOnSelf` arm delegates to `countAttachedEnergy`, which has
// answered `"special"` since D159, so the whole build is a regex and a fixture.
//
// 🛑 **WHY THIS ROW AND NOT ANOTHER: THE INSTRUMENT PICKED IT, AND THE REASON IS
// PRINTABLE.** `scripts/residue-census.ts` (D459) classifies all 130 residue
// sentences by the single deletion or substitution that reaches a built string.
// TEN of them were one-token deletions. NINE lose the deleted token's meaning
// when it goes — `Basic`, `Benched`, `Ancient`, `Future`, `{L}`, `{F}`, `Iono's`
// — and their derived values say so, dropping the filter entirely. THIS one does
// not: the remainder derives to `{per: 70, count: {kind: "energyOnSelf",
// energyType: "special"}}`, with the filter intact, so the deleted token carries
// no information the derived value lacks. That is a SPELLING blocker rather than
// a SEMANTIC one, and it is the difference between a `(?: card)?` and a new
// mechanism. **The instrument prints the VALUE, not only the verdict, and that is
// the whole of the targeting decision.**
// ─────────────────────────────────────────────────────────────────────────────

/** The D459 board: FOUR cards attached to the attacker, of THREE kinds, chosen so
    every plausible misreading is a different number. 2 Special → 140; unfiltered
    would be 4 → 280; `{R}` would be 1 → 70; `{W}` would be 1 → 70. `fix-titan`
    (340 HP, no W/R) absorbs all of them, so no KO truncates a comparison. */
function specialBoard(): GameState {
  let state = board("fix-selfenergy", "fix-titan");
  state = attachFromDeck(state, "p1", "fix-special", 2);
  state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
  return attachFromDeck(state, "p1", "fix-water-energy", 1);
}

describe("D459 — the `Energy card` spelling, on the `×` fold only", () => {
  it("the printed sentence resolves, and the `Special` filter survives the widening", () => {
    // The whole build in one assertion: the sentence that answered `null` at
    // D458's head answers a typed count now, and `special` is IN the answer. A
    // widening that had let the optional group swallow the type token would show
    // up here as `energyType: null` and score every attached card.
    expect(deriveAttackDamageMultiplier(SPECIAL_DRAW)).toEqual({
      per: 70,
      count: { kind: "energyOnSelf", energyType: "special" },
    });
    // …and the sentence is the FIXTURE's printed bytes, not a string this test
    // built (D456: the specimen in a rung must be the printed bytes).
    expect(FIXTURE_POOL["fix-selfenergy"]?.attacks?.[SELF.special]?.effect).toBe(SPECIAL_DRAW);
  });

  it("🆕🆕 D500 — THE MINIMAL PAIR RESOLVED: two card CATEGORIES, one vocabulary", () => {
    // 🆕🆕 **D500 — THE PAIR IS NOW A PAIR OF ANSWERS RATHER THAN AN ANSWER AND A
    // REFUSAL, AND THE OLD RUNG'S CLAIM IS KEPT AS THE REASON.** The two rows differ
    // in the category token alone; the ANCHOR admitted both all along and
    // `attachedEnergyFilter` was what told them apart. D459 recorded that as the
    // reason widening the anchor could not have made the refusal quieter — and it is
    // also the reason D500 cost no anchor byte: the blocker was one missing row in
    // `CLAUSE_ENERGY_TOKENS`, and the map is where it was paid.
    //
    // ⚠️ Driven with the ` card` spelling too. D459's optional group was measured as
    // claiming exactly `Special Energy card`; it now claims the `Basic` spelling as
    // well, which is a consequence of the VOCABULARY and not of the anchor — the
    // anchor is byte-identical to D459's.
    expect(deriveAttackDamageMultiplier(BASIC_DRAW)).toEqual({
      per: 40,
      count: { kind: "energyOnSelf", energyType: "basic" },
    });
    expect(deriveAttackDamageMultiplier(BASIC_DRAW.replace("Energy", "Energy card"))).toEqual({
      per: 40,
      count: { kind: "energyOnSelf", energyType: "basic" },
    });
    // …and the ADDITIVE fold is STILL not widened, so the `+` twin of this sentence
    // is refused for the anchor's reason rather than the vocabulary's. That absence
    // is D459's and this slice did not touch it.
    expect(deriveAttackDamageBonus(BASIC_DRAW)).toBeNull();
  });

  it("⚠️ PINS THE ABSENCE: the ADDITIVE twin is NOT widened, and the column is why", () => {
    // `more damage for each … Energy card attached to this Pokémon.` is printed
    // NOWHERE in the legal attack column, so a `SELF_ENERGY_SCALE` group would be
    // a field no printing could ever set — D196's own reason for refusing
    // `energyOnSelf` a zone and D193's for refusing `OPPONENT_ENERGY_SCALE` one.
    // The absence is pinned here rather than left to a comment.
    const additive = SPECIAL_DRAW.replace(" damage", " more damage");
    expect(deriveAttackDamageBonus(additive)).toBeNull();
    expect(deriveAttackDamageMultiplier(additive)).toBeNull();
    // The board-wide tail is not widened either — one spelling, one fold.
    expect(
      deriveAttackDamageMultiplier(
        SPECIAL_DRAW.replace("attached to this Pokémon", "attached to all of your Pokémon"),
      ),
    ).toBeNull();
  });

  it("⚠️ the optional group is a SPELLING, so the ` card`-less form still reads the same", () => {
    // Both spellings of one noun produce the same value — which is the claim that
    // makes this a widening rather than a second reading. The untyped ` card`
    // form is UNPRINTED and reads as the untyped total; that is a deliberate
    // consequence of an optional group and is pinned rather than discovered.
    expect(deriveAttackDamageMultiplier(SPECIAL_DRAW.replace("Energy card", "Energy"))).toEqual({
      per: 70,
      count: { kind: "energyOnSelf", energyType: "special" },
    });
    expect(deriveAttackDamageMultiplier(OVERFLOW.replace("Energy", "Energy card"))).toEqual({
      per: 30,
      count: { kind: "energyOnSelf", energyType: null },
    });
  });

  it("refuses the near-misses by the anchor alone — leading text, lowercase, no period", () => {
    const read = (t: string) => deriveAttackDamageBonus(t) ?? deriveAttackDamageMultiplier(t);
    expect(read(`Flip a coin. If heads, ${SPECIAL_DRAW.toLowerCase()}`)).toBeNull();
    expect(read(SPECIAL_DRAW.replace(/^This/, "this"))).toBeNull();
    expect(read(SPECIAL_DRAW.slice(0, -1))).toBeNull();
    expect(read(`${SPECIAL_DRAW} Then, shuffle your deck.`)).toBeNull();
    // ⚠️ AND THE GROUP IS A LITERAL, NOT A WILDCARD: one other noun in its place
    // is refused, so `(?: card)?` cannot be read as "anything may sit here".
    expect(read(SPECIAL_DRAW.replace("Energy card", "Energy cards"))).toBeNull();
    expect(read(SPECIAL_DRAW.replace("Energy card", "Energy Tool"))).toBeNull();
  });

  it("counts SPECIALS on a real board — 2 × 70 = 140, never 280, 70 or 0", () => {
    // The four numbers a wrong reading gives on this identical board: 280 if the
    // filter were dropped, 70 if it counted `{R}` or `{W}`, 0 if it counted a
    // category it cannot resolve. Only one of them is 140.
    const row = find(swing(specialBoard(), SELF.special).events, "DAMAGE_DEALT");
    expect(row?.scaled).toBe(140);
    expect(row?.dealt).toBe(140);
    // The `×` fold drops the printed base, exactly as index 2's does.
    expect(row?.base).toBe(0);
    expect(row?.dealt).not.toBe(280);
    expect(row?.dealt).not.toBe(70);
  });

  it("🆕🆕 D500 — THE MINIMAL PAIR ON ONE BOARD: both fold, and they COMPLEMENT", () => {
    // 🆕🆕 **D500 — INDEX 3 FOLDS NOW TOO, AND THE BOARD BECOMES A COMPLEMENT CHECK.**
    // `specialBoard()` attaches 2 `fix-special` + 1 {R} + 1 {W}: two Special Energy
    // CARDS and two Basic ones. So index 3 counts 2 and index 4 counts 2, and the two
    // counts SUM to the unfiltered 4 — which is the property `"basic"` and
    // `"special"` have that no type filter has, and the one a build that spelled the
    // new arm as a PROVISION question would break.
    //
    // ⚠️ **THE TWO INDICES ANSWER DIFFERENT DAMAGE ONLY BECAUSE THEIR `per` DIFFERS
    // (40 against 70), NOT BECAUSE THEIR COUNTS DO**, and that is said out loud so the
    // numbers below are not read as separating the two readings. `2 × 40 = 80` and
    // `2 × 70 = 140`; swap the two `energyType` values and this board answers 80 and
    // 140 still. The board that separates the readings by COUNT is
    // `basicEnergyScaling.test.ts` §2.
    const state = specialBoard();
    const basic = swing(state, SELF.basic).events;
    expect(find(basic, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(find(basic, "DAMAGE_DEALT")?.scaled).toBe(80);
    const special = swing(state, SELF.special).events;
    expect(find(special, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(find(special, "DAMAGE_DEALT")?.scaled).toBe(140);
    // 🛑 THE COMPLEMENT: 2 + 2 = 4, and the unfiltered fold on the same body is 4
    // (index 2, `30×`, so 120). A `"basic"` arm written as *"provides some basic
    // type"* would answer 2 here as well — both Specials provide only Colorless — so
    // this rung does NOT separate that reading either, and says so.
    expect(find(swing(state, SELF.overflow).events, "DAMAGE_DEALT")?.scaled).toBe(4 * 30);
  });

  it("the census sees it: the sentence LEAVES the residue by the READER arm", () => {
    // `resolvedByAnyReader` is the census's first summand, and this sentence moves
    // through it — no registry row, no gate split, no trailing split. The
    // whole-corpus figures `censusAtHead.test.ts` pins are what record the size of
    // the move (485 / 1502 resolved, residue 129 / 180); this rung is what says
    // WHICH arm moved.
    expect(resolvedByAnyReader(SPECIAL_DRAW)).toBe(true);
    // 🆕🆕 **D500 — THIS ONE FLIPPED, AND IT FLIPPED THROUGH THE SAME ARM.** The
    // sentence left the residue by `deriveAttackDamageMultiplier` claiming it, with no
    // registry row, no gate split and no trailing split — and with the reader surface
    // standing still at 13, because the payment was a VOCABULARY row rather than a
    // reader. That combination (residue falls, surface unmoved) is what says the cost
    // was a map entry and not a parser.
    expect(resolvedByAnyReader(BASIC_DRAW)).toBe(true);
    expect(attackReaderSurface()).toHaveLength(13);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The record shape, derived rather than inherited.
// ─────────────────────────────────────────────────────────────────────────────

describe("the record-shape derivation, made rather than inherited", () => {
  it("⚠️ `MATCH_RECORD_VERSION` STAYS 12 — and here is the derivation, not the habit", () => {
    // D189 moved it 11 → 12 because `PendingStage.attackEpilogue` gained a
    // REQUIRED field, and a parked program lives in `GameState.phase` — so a saved
    // record could carry the old shape. The rule that follows is about what is
    // STORED, and this slice stores nothing:
    //
    //   • `DamageCountSource` is a PARSE-TIME type. Both new members are produced
    //     by `deriveAttackDamageBonus` / `deriveAttackDamageMultiplier` from card
    //     TEXT at declaration and consumed by `scaledAttackDamage` in the same
    //     tick. They appear in no `GameState` field, no `PendingStage`, no
    //     `@luminous/schema` projection and no redaction — swept, and
    //     `scaledAttackDamage`'s switch is the repo's ONLY dispatch over the union.
    //   • NO new `EffectOp` inhabitant, which is D189's stated bump condition: an
    //     op can be parked mid-program inside `GameState.phase`, and a count
    //     source can never be.
    //   • NO new function signature and NO widened parameter — unlike D193, which
    //     had to widen `countEnergyInPlay`. Both evaluator arms call
    //     `countAttachedEnergy` at a shape it already had, so even D181's
    //     reachability-widening precedent is not needed here.
    //   • The re-homing moves TEST fixtures and deck composition only.
    //     `FIXTURE_POOL` and `SCALED_DAMAGE_DECK` are test scaffolding; neither is
    //     a record field, and no saved record names a fixture id.
    //
    // A version-12 record replayed against this engine reads every field it
    // carries with the same meaning, so the gate must not reject it.
    expect(deriveAttackDamageBonus(TWIN_SURGE)).not.toBeNull();
    expect(deriveAttackEffect(TWIN_SURGE)).toBeNull(); // no op, so nothing can park
    expect(deriveAttackEffect(POWER_DRAW)).toBeNull();
    expect(deriveAttackEffect(OVERFLOW)).toBeNull();
  });

  it("🆕🆕 D459 — `MATCH_RECORD_VERSION` STAYS 29, and this is the STRONGEST form of the argument", () => {
    // D450's rule for a non-parking change is REACHABILITY: can the thing this
    // slice touched ever appear inside a saved record? Here it cannot, and the
    // reason is one step stronger than the block above's — that one argued a NEW
    // `DamageCountSource` member is parse-time; **this slice adds no member at
    // all.** `{kind: "energyOnSelf", energyType: "special"}` is an inhabitant the
    // union has carried since D196, produced by `boardWideEnergyScaling`'s zone
    // arm already; the only byte that moved is one optional group inside a regex
    // in `effects.ts`. A regex is not a field.
    //
    //   • NO new `EffectOp` inhabitant, so nothing new can park in
    //     `GameState.phase` — D189's stated bump condition, untouched.
    //   • NO new op FIELD, prompt key, `packages/schema` byte or `redact.ts` byte.
    //   • The derived value is consumed by `scaledAttackDamage` in the SAME TICK
    //     it is produced and appears in no `GameState` field, no `PendingStage`
    //     and no projection.
    //   • The evaluator is UNCHANGED: `attack.ts`'s `energyOnSelf` arm calls
    //     `countAttachedEnergy` at a shape it already had.
    //
    // 🛑 AND THE LOSS DIRECTION IS VACUOUS HERE, WHICH IS THE POINT AND NOT A GAP
    // (D458's finding, one slice on): "is losing the new information detectable?"
    // has no subject, because NOTHING NEW IS STORED. The only observable change is
    // that a v29 record replayed against this engine now folds a sentence it used
    // to flag — a REPLAY difference the version gate is not for and cannot express.
    expect(deriveAttackDamageMultiplier(SPECIAL_DRAW)).not.toBeNull();
    expect(deriveAttackEffect(SPECIAL_DRAW)).toBeNull(); // no op, so nothing can park
    // The inhabitant is not new: the board-zone arm has produced `special` since D407.
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each Special Energy attached to all of your Pokémon.",
      ),
    ).toEqual({ per: 30, count: { kind: "energyOnSelf", zone: "board", energyType: "special" } });
  });

  it("engineVersion is 0.400.0 and `manifest.version` agrees", () => {
    // 🆕🆕 D459 — 0.357.0 → **0.358.0**, and the bump is owed for BEHAVIOUR and for
    // nothing else, which is the same shape D458's was: no op, no field, no prompt
    // key, no wire byte and no vocabulary diff moved, so a reader looking for one
    // would find none and conclude wrongly. What moved is that a printed sentence
    // that derived to `null` at 0.357.0 derives to a typed count at 0.358.0.
    // ⚠️ THE VERSION TAX, RE-MEASURED AT THIS HEAD BY `grep -c` OVER BOTH SPELLINGS
    // RATHER THAN INHERITED: **36 assertions / 40 sites** before this rung — 35
    // `expect(engineVersion).toBe(…)` across 35 test files, ONE
    // `expect(manifest.version).toBe(…)` in `legacyEnergy.test.ts`, `package.json`,
    // the declaration, its doc block and `D275`'s mutant `find`. That is D458's
    // forecast of "36 / 40" reproduced TO THE DIGIT — the first inherited figure in
    // this series to be checked and found right. This rung is the 37th assertion,
    // so a successor inherits 37 / 41 (D427's mechanism as arithmetic).
    expect(engineVersion).toBe("0.400.0");
  });
});
