import { describe, expect, it } from "vitest";
import {
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
} from "./effects";
import { applyAction } from "./index";
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
/** ⚠️ The coin near-miss — 1 printing, 1 LEGAL, and unread on BOTH sides: it is not
    `AttackFlipCount.attachedEnergy` either, because that member reads "attached to
    this Pokémon" (one body) and this names two. */
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
const SELF = { power: 0, flare: 1, overflow: 2, basic: 3 } as const;
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
    // REASON 2 — the count source is a TYPED count of BODIES on the attacker's own
    // Bench, and no member answers it. Driven on the count half ALONE, so this
    // assertion is about the count source and not about the sentence count.
    expect(deriveAttackDamageBonus(EVERYONE_DISCHARGE_COUNT_HALF)).toBeNull();
    expect(deriveAttackDamageMultiplier(EVERYONE_DISCHARGE_COUNT_HALF)).toBeNull();
    // …and the whole printing is unread by every reader in the family, which is
    // what makes it a witness at all.
    for (const read of [
      deriveAttackDamageBonus,
      deriveAttackDamageMultiplier,
      deriveAttackDamagePenalty,
      deriveAttackEffect,
      deriveAttackCoinFlip,
    ]) {
      expect(read(EVERYONE_DISCHARGE)).toBeNull();
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
    expect(deriveAttackDamageMultiplier(BASIC_DRAW)).toBeNull();
    expect(deriveAttackDamageBonus(BASIC_DRAW)).toBeNull();
    // `{C}` is deliberately absent from the token table — Colorless is the
    // conservative provision fallback for unauthored Special Energy, so a `{C}`
    // clause would quietly match cards nobody meant.
    expect(deriveAttackDamageBonus(POWER_DRAW.replace("each Energy", "each {C} Energy"))).toBeNull();
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
    // …and the board-wide spelling of the attacker's own Energy is UNPRINTED, so
    // there is no sentence that could ever want the other answer (pinned in the
    // exclusions below).
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

  it("the CATEGORY filter stays LOUD on a real board — the printed 40, never 3 × 40", () => {
    // Index 3 is a real LEGAL printing whose filter resolves to nothing. The engine
    // must flag it and fall back to the printed number, not score it: a reader that
    // collapsed the two nullish answers would deal 3 × 40 = 120 here off an
    // unfiltered count, on a board where the attacker holds no Basic-category
    // Energy question the engine can even ask.
    const state = mirrorBoard("fix-selfenergy");
    const { events } = swing(state, SELF.basic);
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toMatchObject({
      attack: "Basic Draw",
      damageModifier: "×",
    });
    // ⚠️ THE UNREAD `×` KEEPS ITS PRINTED BASE, which is the conservative fallback
    // and worth pinning: `base` is the printed 40 with NO `scaled` field at all, so
    // the row cannot be mistaken for a fold that happened to come out at 40.
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.base).toBe(40);
    expect(row?.dealt).toBe(40);
    expect(row?.scaled).toBeUndefined();
    expect(row?.dealt).not.toBe(120);
  });

  it("the printed refusals on `fix-bothactives` stay LOUD on a real board", () => {
    const state = mirrorBoard("fix-bothactives");
    for (const [index, name] of [
      [TWIN.blast, "Twin Blast"],
      [TWIN.flip, "Twin Flip"],
    ] as const) {
      expect(find(swing(state, index).events, "ATTACK_EFFECT_SKIPPED")).toMatchObject({
        attack: name,
      });
    }
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
    // ⚠️ THE BOTH-ACTIVES COIN ROW IS UNREAD ON EVERY SIDE, AND THAT IS MEASURED.
    // 1 printing / 1 LEGAL. It is NOT `AttackFlipCount.attachedEnergy` either:
    // that member reads "attached to this Pokémon", one body, and this names two.
    // So the pool's only legal both-Actives coin sentence stays LOUD, and the next
    // slice can price it from here instead of rediscovering it.
    expect(deriveAttackCoinFlip(TWIN_FLIP)).toBeNull();
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
    // The board-zone spelling of the ATTACKER's own Energy is UNPRINTED, so no
    // reader may invent it — pinned, because the next author to see two Energy
    // members will assume both reach both zones.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 60 damage for each Energy attached to all of your Pokémon.",
      ),
    ).toBeNull();
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
});
