import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { countAttachedEnergy, countEnergyInPlay, providesEnergyType } from "./continuous";
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
import { applyAction, conditionHolds, conditionNote, engineVersion } from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
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
} from "./testFixtures";

// 0.391.0 → 0.392.0 — **THE PRINTED CARD CATEGORY `Basic`, AND IT IS `Special`'s
// COMPLEMENT RATHER THAN A TENTH ENERGY TYPE (D500).**
//
//   `censusAttackCorpus.ts` FILE LINE 580
//   "This attack does 40 damage for each Basic Energy attached to this Pokémon."
//   1 sentence / 1 Standard-legal printing, the `×` fold.
//
// 🛑 **THE WHOLE BUILD IS ONE ROW IN `CLAUSE_ENERGY_TOKENS`.** The anchor
// (`SELF_ENERGY_MULTIPLY`) has admitted the token since the day it was written — its
// filter group is `(?:(.+) )?` and `Basic` matches it — and the sentence was refused
// one step LATER, by `attachedEnergyFilter` answering `undefined` for a token the map
// had no key for. `selfEnergyScaling.test.ts`'s D459 rung had said exactly that
// (*"the ANCHOR admits both and `attachedEnergyFilter` is what tells them apart"*) and
// nobody had priced it.
//
// ⚠️ **THE RECORDED REFUSAL NAMED A CARRIER AND THE CARRIER WAS WRONG (D457/D499).**
// Two doc blocks in `effects.ts` and a rung in `benchBodyScaling.test.ts` said this
// sentence *"asks a question `countEnergyInPlay` does not answer"*. Both halves fail:
//   · `countEnergyInPlay` has answered a card-CATEGORY question since D159 —
//     `"special"` is one, read off `isSpecialEnergy` rather than through provision —
//     so the category was never outside its vocabulary; and
//   · this sentence never reaches `countEnergyInPlay` at all. *"attached to this
//     Pokémon"* is the ZONE-LESS path and delegates to `countAttachedEnergy`.
// The refusal was REASON-ONLY wrong (D479's third class) and the verdict it produced
// — "unbuilt" — was true; what it cost was that nobody re-derived the price for 300+
// decisions, which is D478's loop exactly (a refusal stops a family being built, an
// unbuilt family attracts no rows, and no rows means nothing re-derives the refusal).
//
// 🛑 **IT IS A CARDS QUESTION AND NOT A PROVISION QUESTION, AND §2 IS WHERE THAT IS
// DRIVEN.** A Special Energy may PROVIDE a basic type — `fix-blend`'s registry
// `EnergyProgram` provides `["Fire", "Water"]` — so *"each Basic Energy attached"* and
// *"each {W} Energy attached"* count DIFFERENT CARDS on one board. The new arm asks
// `matchesFilter`'s shipped `basicEnergy` predicate (`card.energyType === "Normal"`),
// which is the same predicate the DISCARD-PILE reader already resolves this printed
// noun to — one noun, one answer (D159) — reached through a different vocabulary
// because an attached count is narrowed by an energy token and a pile count by a
// `CardFilter`.
//
// THE AXIS LATTICE, run over all 13 `deriveAttack*` exports before anything was
// written. Four segments were counted from the PRINT — AMOUNT (`40`), FOLD
// (`damage` vs `more damage`), NOUN (`Basic`) and TAIL (`this Pokémon`) — and **three
// of the four are DEGENERATE** by D491/D494's test: each one's PRINTED value already
// builds on an otherwise-built sentence, so substituting it changes nothing. The
// honest table is 2¹ and its built-by-weight vector is **`0/1 · 1/1`**:
//
//   weight 0 (the print)              1 point,  0 built
//   weight 1 (NOUN → `{W}`)           1 point,  1 built
//
// That is a FOURTH lattice shape beside D489/D490/D494's (one built point at FULL
// weight), D495's (`0/1 · 2/2 · 0/1`, every segment built) and D499's (`0/1 · 1/3 ·
// 0/1`, the blocker is the JOIN). **One axis, and it is a single printed TOKEN** —
// which says the answer is neither an anchor nor a seam but a VOCABULARY entry, and
// is why this slice costs zero anchor bytes and zero reader bytes.
//
// WHAT MOVED, and what did not:
//   · `CLAUSE_ENERGY_TOKENS` gains ONE row, `["Basic", "basic"]`, beside `["Special",
//     "special"]`; the map's value type widens by one inhabitant.
//   · `countAttachedEnergy`, `countEnergyInPlay` and `hasAttachedEnergy` each gain ONE
//     arm, all three delegating to one new module-private `basicEnergyUids`.
//   · `conditionNote` gains ONE arm — **and `tsc` said nothing about its absence**,
//     because the branch it would have fallen into is a TEMPLATE STRING (§4).
//   · **ZERO** new anchors, readers (surface unmoved at **13**), ops, op fields,
//     `DamageCountSource` members, `CardFilter` members, prompts, events, error codes,
//     registry rows, `FIXTURE_POOL` ids, `packages/schema` bytes, `redact.ts` bytes or
//     UI bytes.
//   · **`MATCH_RECORD_VERSION` STAYS 29**, and the address is named before the
//     argument (§7).

// ─────────────────────────────────────────────────────────────────────────────
// The printed sentence, and the fixture that carries it.
// ─────────────────────────────────────────────────────────────────────────────

/** The printed bytes, and they are `fix-selfenergy`'s attack index 3 — a fixture that
    has carried this sentence as a REFUSAL since D196 and flips sign here. §1 asserts
    both that it is a row of `legalAttackCorpus()` and that the fixture prints it, so
    no line of this file quotes a hand-retyped string (D452/D490). */
const BASIC_DRAW = "This attack does 40 damage for each Basic Energy attached to this Pokémon.";

/** `censusAttackCorpus.ts`'s own file line for the row above (`fileLine = index + 53`,
    D448's convention). Asserted against the corpus rather than trusted. */
const BASIC_DRAW_FILE_LINE = 580;

/** The MINIMAL PAIR, one index over: the other printed card CATEGORY. D459 built it
    and its doc block named `Basic` as the token the vocabulary lacked. */
const SPECIAL_DRAW =
  "This attack does 70 damage for each Special Energy card attached to this Pokémon.";

/** The UNFILTERED twin, index 2 — the reading a build that collapsed
    `attachedEnergyFilter`'s two nullish answers would give index 3. */
const OVERFLOW = "This attack does 30 damage for each Energy attached to this Pokémon.";

/** Attack indices on `fix-selfenergy`, pinned against the fixture in §1. */
const SELF = { power: 0, flare: 1, overflow: 2, basic: 3, special: 4 } as const;

/** ONE seed. Nothing here flips a coin and every body and every attachment is placed
    by surgery, so the seed describes a shuffle and nothing else (D143). */
const SEED = 11;

/** 🆕🆕 **ITS OWN 60 (D412/D427), rather than a widening of `SELF_ENERGY_DECK`.** That
    deck is 60 EXACTLY and feeds `selfEnergyScaling.test.ts`'s seeded boards; adding
    `fix-blend` to it would have had to take four slots from somewhere and reshuffled
    boards this slice has nothing to do with. Every id below is already in
    `FIXTURE_POOL`, so this file adds **zero** fixture-pool entries and pays none of
    D460/D465's fixture census tax.

    The cast, and the number each card exists to make different:
      · `fix-selfenergy` — the attacker. Index 3 prints the target sentence; indices 2
        and 4 are the two readings it must not collapse into.
      · `fix-water-energy` — a BASIC Energy that PROVIDES `Water`.
      · `fix-energy` — a BASIC Energy whose name does not parse, so it provides only
        `Colorless`. It is what separates *"is a Basic Energy card"* from *"provides a
        basic type"* in the direction where the naive reading counts too FEW.
      · 🛑 `fix-blend` — a SPECIAL Energy whose registry `EnergyProgram` provides
        `["Fire", "Water"]`. It is the one card in the pool that separates the two
        readings in the direction where the naive reading counts too MANY, and it is
        the whole reason this file exists rather than three more rungs next door.
      · `fix-special` — a SPECIAL Energy with no program, so `Colorless` only. The
        control for `fix-blend`: same card class, no basic provision.
      · 🛑 `sv02-191` **Luminous Energy** — a SPECIAL Energy that provides the
        WILDCARD `ANY_ENERGY`, so `providesEnergyType` answers TRUE of it for every
        type name — *including a string no card provides at all*. It is on this board
        for ONE reason and the reason is a measurement: without it,
        `D500-board-arm-forgets-its-continue` is **INERT** (D450) and reports a suite
        gap that does not exist. The mutation makes `countEnergyInPlay`'s category arm
        fall through into the provision ternary, and that second term is `0` on any
        board where nothing provides a wildcard — which was every board this file
        fielded on the first probe, and is why the row SURVIVED 483 files / 11,023
        tests under `--only … --full` (D455/D499). **The suite was fixed and the row's
        `find`/`replace` were left byte-for-byte** (D496).
      · `fix-titan` — 340 HP, no Weakness and no Resistance, so every number below is
        the fold and nothing else; also the Bench filler.
      · `fix-basic-1` — setup Actives, so `driveSetup` never reaches for a body a case
        cares about. */
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

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

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

/** 🛑 **THE BOARD, built so that SEVEN plausible implementations answer SEVEN
    DIFFERENT numbers off ONE printed 40** (D482/D485/D492: name the board on which two
    candidates differ *before* writing any board).

      p1 (attacking)                                    p2 (defending)
        Active  fix-selfenergy   2 {W} + 2 {C} + blend    Active  fix-titan  2 special
        Bench 0 fix-titan        3 {W} + Luminous

    · **4** — the CORRECT reading: Energy CARDS attached to the attacking body whose
      `energyType` is `Normal`.                                   → `scaled` **160**
    · 5 — the UNFILTERED count, the collapse `attachedEnergyFilter` exists to
      prevent.                                                    → 200
    · 1 — `"special"`, the NEIGHBOURING ARM'S REAL CODE (D190b).   → 40
    · 🛑 **3** — *"provides some basic type"*, the reading a builder who took `Basic`
      for a type-family would write. `fix-blend` provides `Water`, so it is counted IN;
      the two `fix-energy` provide only `Colorless`, so they are counted OUT. **Wrong
      in BOTH directions at once on one board.**                   → 120
    · 7 — the BOARD zone rather than the attacking body (4 + 3; the Luminous on the
      Bench is a SPECIAL and is counted out, which is the same card question asked one
      body over).                                                   → 280
    · 0 — the defender's body.                                     → 0
    · 2 — the defender's body, unfiltered.                         → 80

    `fix-titan` is 340 HP with no Weakness and no Resistance, so 280 does not KO and no
    comparison is truncated. */
function mixedBoard(): GameState {
  let state = bare();
  state = attachFromDeck(state, "p1", "fix-water-energy", 2);
  state = attachFromDeck(state, "p1", "fix-energy", 2);
  state = attachFromDeck(state, "p1", "fix-blend", 1);
  state = benchFromDeck(state, "p1", "fix-titan");
  state = attachBenchFromDeck(state, "p1", 0, "fix-water-energy", 3);
  // 🛑 THE WILDCARD, ALONE AMONG SPECIALS ON ITS BODY so Luminous is not demoted to
  // Colorless by a sibling (`demoteWithOtherSpecial`). See the deck's note: it is here
  // to make `D500-board-arm-forgets-its-continue` observable, and nothing else on this
  // board provides `ANY_ENERGY`.
  state = attachBenchFromDeck(state, "p1", 0, "sv02-191", 1);
  return attachFromDeck(state, "p2", "fix-special", 2);
}

function swing(state: GameState, index: number, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return active;
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
  deriveAttackRequirement,
] as const;

const units = (rows: readonly (readonly [number, string])[]) =>
  rows.reduce((sum, [n]) => sum + n, 0);

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed row, and the shape of the payment.
// ─────────────────────────────────────────────────────────────────────────────

describe("D500 §1 — the sentence is a corpus row, and the fixture prints it", () => {
  it("🛑 IS a row of `legalAttackCorpus()`, at 1 legal printing and at its stated file line", () => {
    // D490's rule: assert that a specimen IS a corpus row and read its printing count
    // off the corpus rather than typing it. A byte pin measures an invention exactly
    // as faithfully as it measures the truth.
    const rows = legalAttackCorpus().filter(([, text]) => text === BASIC_DRAW);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe(1);
    // …and the FILE LINE the header quotes, derived rather than remembered (D448).
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

  it("🛑 exactly ONE reader claims it, and the surface did not grow", () => {
    // The payment was a VOCABULARY row, not a reader. A slice that had added a reader
    // would move this length; a slice that had added an anchor would not, but would
    // show up in §3's near-miss rungs. Both are pinned so the two cannot be confused.
    const claimers = READERS.filter((read) => read(BASIC_DRAW) !== null);
    expect(claimers).toHaveLength(1);
    expect(deriveAttackDamageMultiplier(BASIC_DRAW)).toEqual({
      per: 40,
      count: { kind: "energyOnSelf", energyType: "basic" },
    });
    expect(attackReaderSurface()).toHaveLength(13);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — CARDS, not PROVISIONS. The board that separates seven readings.
// ─────────────────────────────────────────────────────────────────────────────

describe("D500 §2 — a card CATEGORY, driven apart from every provision reading", () => {
  it("🛑 THE FIXTURE THAT MAKES IT A QUESTION: a Special Energy that PROVIDES a basic type", () => {
    // 🛑 **THIS IS THE RUNG THE WHOLE SLICE TURNS ON.** If no card in the pool provided
    // a basic type while not BEING a Basic Energy card, then "counts cards" and "counts
    // things that provide a basic type" would be the same function on every board this
    // repo can build, and the distinction would be untestable rather than merely
    // untested (D486's provable-blindness class). `fix-blend` is that card.
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

  it("🛑 SEVEN readings, SEVEN numbers, on ONE board — and the correct one is 4", () => {
    const state = mixedBoard();
    const mine = activeOf(state, "p1");
    const theirs = activeOf(state, "p2");
    // ⑴ the CORRECT reading.
    expect(countAttachedEnergy(state, mine, "basic")).toBe(4);
    // ⑵ the UNFILTERED collapse.
    expect(countAttachedEnergy(state, mine, null)).toBe(5);
    // ⑶ the NEIGHBOURING ARM (D190b: a mutant should be the real code next door).
    expect(countAttachedEnergy(state, mine, "special")).toBe(1);
    // ⑷ 🛑 the PROVISION reading, wrong in BOTH directions at once: it counts the two
    //    Water basics and the Special that provides Water, and misses the two basics
    //    that provide only Colorless.
    expect(countAttachedEnergy(state, mine, "Water")).toBe(3);
    // ⑸ the BOARD ZONE instead of the attacking body.
    expect(countEnergyInPlay(state, "p1", "basic")).toBe(7);
    // ⑹/⑺ the DEFENDER's body, filtered and unfiltered.
    expect(countAttachedEnergy(state, theirs, "basic")).toBe(0);
    expect(countAttachedEnergy(state, theirs, null)).toBe(2);
    // …and all seven are distinct, asserted rather than eyeballed (D482's
    // arithmetic-coincidence class: compute what each candidate answers and confirm
    // they differ, or the board proves nothing).
    expect(new Set([4, 5, 1, 3, 7, 0, 2]).size).toBe(7);
  });

  it("🛑 the SWING deals 160, and not any of the other six numbers × 40", () => {
    const row = find(swing(mixedBoard(), SELF.basic).events, "DAMAGE_DEALT");
    // The `×` fold DROPS the printed base, so 160 is the fold and nothing else.
    expect(row?.base).toBe(0);
    expect(row?.scaled).toBe(160);
    expect(row?.dealt).toBe(160);
    for (const wrong of [200, 40, 120, 280, 0, 80]) expect(row?.dealt).not.toBe(wrong);
    // …and the sentence is NOT on the loud path, which is what a reverted vocabulary
    // row would look like: `base` 40, no `scaled`, and an ATTACK_EFFECT_SKIPPED row.
    expect(find(swing(mixedBoard(), SELF.basic).events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("🛑 THE WILDCARD: `providesEnergyType` answers TRUE for a type no card provides", () => {
    // 🛑 **THE SHARPEST FORM OF CARDS-VERSUS-PROVISIONS, AND IT IS WHY THE BOARD-WIDE
    // ARM NEEDS ITS OWN `continue`.** Luminous Energy provides `ANY_ENERGY`, and
    // `providesEnergyType` is `units.includes(type) || units.includes(ANY_ENERGY)` —
    // so it answers TRUE for **every** string, including `"basic"`, which names a card
    // CATEGORY and not a type and which no card provides at all. A provision question
    // asked with a category word is not merely wrong, it is *unfalsifiable in the
    // TRUE direction* on any board holding a wildcard.
    //
    // ⚠️ **THIS RUNG EXISTS BECAUSE A MUTANT SURVIVED AND WAS DISCRIMINATED RATHER
    // THAN EXPLAINED AWAY** (D455/D499): `D500-board-arm-forgets-its-continue` drops
    // the `continue` so the category arm falls through into the provision ternary.
    // That second term is `0` on every board without a wildcard, so the row was INERT
    // (D450) and survived **483 files / 11,023 tests** under `--only … --full`. The
    // fix was the SUITE, not the row (D496).
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
    // 🛑 The mutant answers 8 — the 7 above plus this one wildcard — which is the
    // whole of what separates the two builds, and it is ONE card wide.
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
    expect(countEnergyInPlay(state, "p1", "basic") + countEnergyInPlay(state, "p1", "special")).toBe(
      countEnergyInPlay(state, "p1", null),
    );
  });

  it("⚠️ the SIBLING indices on the same board, so the three foldings are told apart", () => {
    const state = mixedBoard();
    // index 2 is UNFILTERED at 30× → 5 × 30 = 150.
    expect(find(swing(state, SELF.overflow).events, "DAMAGE_DEALT")?.scaled).toBe(150);
    // index 4 is `Special` at 70× → 1 × 70 = 70.
    expect(find(swing(state, SELF.special).events, "DAMAGE_DEALT")?.scaled).toBe(70);
    // index 3 is the new one at 40× → 4 × 40 = 160. Three indices, one body, three
    // numbers, and no two of them are reachable from one reading of the noun.
    expect(find(swing(state, SELF.basic).events, "DAMAGE_DEALT")?.scaled).toBe(160);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the vocabulary: what resolves, and what must still be LOUD.
// ─────────────────────────────────────────────────────────────────────────────

describe("D500 §3 — one shared token table, and it still refuses what it cannot read", () => {
  it("`Basic` resolves at ALL THREE readers the map feeds — measured, not argued", () => {
    // `CLAUSE_ENERGY_TOKENS` has three direct consumers and the token now resolves at
    // every one of them. That uniformity is the D159 property being bought: the printed
    // word means the same thing wherever it is printed.
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
      count: { kind: "boardCondition", cond: { kind: "yourActiveHasEnergyAttached", energy: "basic" } },
    });
  });

  it("⚠️ …and the two it newly reads are printed ZERO times, which is the price and is SAID", () => {
    // 🛑 **D472's DISCIPLINE, MEASURED OVER ALL 640 ROWS.** The widening claims exactly
    // ONE sentence that was refused before — the target — and nothing else. The other
    // two readers' `Basic` spellings are READABLE and UNPRINTED, which is D470's own
    // stated consequence at this family: *"a reader is a function of TEXT, and a noun
    // the column does not print simply never arrives."* Guarding them out would be a
    // second answer to what one shared token names (D159).
    const printed = legalAttackCorpus().filter(([, text]) => /\bBasic\b/.test(text));
    expect(
      printed.filter(([, text]) => /^Flip a coin for each .*Energy attached/.test(text)),
    ).toHaveLength(0);
    expect(printed.filter(([, text]) => /has any .*Energy attached/.test(text))).toHaveLength(0);
    // …and the ONE row the widening claims, named.
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

  it("🛑 the REFUSALS that hold the guard now that `Basic` does not", () => {
    // D424: every "X is admitted" owes a neighbouring "Y is refused" on the same axis,
    // and the LOUD half of `attachedEnergyFilter`'s two-nullish rule used to be carried
    // by `Basic`. It is carried by these two now — `{C}`, whose absence is a DECISION
    // (Colorless is the provision fallback for every unauthored Special Energy, so a
    // `{C}` filter would quietly match cards nobody meant), and a bogus token, whose
    // absence has no expiry date at all.
    for (const token of ["{C}", "Fancy", "basic", "Normal", "constructor", "toString"]) {
      expect(
        deriveAttackDamageMultiplier(BASIC_DRAW.replace("Basic Energy", `${token} Energy`)),
      ).toBeNull();
    }
    // ⚠️ `basic` LOWERCASE is in that list on purpose: the map is keyed on the printed
    // spelling and the matcher carries no `/i`, so the value's own name is not a key.
  });

  it("the ANCHOR is byte-unchanged, and the near-misses it refuses still are", () => {
    // The whole-sentence anchor did the refusing for none of this and must still do the
    // refusing for all of its own cases: leading text, a lowercase `this`, a missing
    // period, and the ADDITIVE fold, which D459 deliberately did not widen.
    expect(deriveAttackDamageMultiplier(`Flip a coin. ${BASIC_DRAW}`)).toBeNull();
    expect(deriveAttackDamageMultiplier(BASIC_DRAW.replace("This attack", "this attack"))).toBeNull();
    expect(deriveAttackDamageMultiplier(BASIC_DRAW.slice(0, -1))).toBeNull();
    // ⚠️ **THE ADDITIVE SPELLING IS NOT A NEAR MISS AND THE FIRST DRAFT OF THIS RUNG
    // SAID IT WAS.** `SELF_ENERGY_SCALE` has always admitted a bare filter token, so
    // the `+` twin of this sentence reads the moment the token resolves. What D459
    // declined to widen was the ` card` SPELLING on the additive fold, and §8 is where
    // that absence is pinned. Corrected here rather than deleted, because a rung that
    // claims a refusal the engine does not make is D423's shape.
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
  it("🛑 renders 'a Basic Energy', not the template fallback's 'basic Energy'", () => {
    // 🛑 **THE DESCRIBER OBLIGATION WAS TRACED, NOT ARGUED (D478/D489), AND IT WAS THE
    // ONE THE CATEGORY ARGUMENT WOULD HAVE MISSED.** `withConsequence` has exactly one
    // call site and returns the prompt unchanged unless the QUEUE holds a `recordGate`
    // on the slot a PARKING op files — a `DamageCountSource` never parks and a
    // `conditionGate` is not a parking op, so that half of the obligation is EMPTY.
    // `conditionNote` is the half that was live, and the compiler could not report it:
    // the arm's else branch is a TEMPLATE STRING, so a widened `energy` type compiles
    // and renders the raw value. Without the new arm this reads *"your Active Pokémon
    // has basic Energy attached"* — lowercase, and naming a card CATEGORY as though it
    // were a type — on a reject pill and a HUD tooltip, with every suite green and the
    // census stepped. That is D473's defect exactly, found by opening the call site.
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
    // 🛑 …and the new note is NOT the fallback's string, which is what makes this rung
    // able to go red rather than merely present (D200).
    expect(conditionNote({ kind: "yourActiveHasEnergyAttached", energy: "basic" })).not.toBe(
      "your Active Pokémon has basic Energy attached",
    );
  });

  it("⚠️ the SEAT MIRROR was deliberately NOT widened, and the type is what says so", () => {
    // `opponentActiveHasEnergyAttached` is produced by a LITERAL clause row rather than
    // by the token map, so nothing can hand it `"basic"`. A wider type there would be a
    // field no producer can set — D193/D196's own reason for refusing their siblings a
    // zone — so the member keeps `BasicEnergyType | "special"` and this rung records
    // that the asymmetry is a decision rather than an oversight.
    expect(conditionNote({ kind: "opponentActiveHasEnergyAttached", energy: "special" })).toBe(
      "your opponent's Active Pokémon has a Special Energy attached",
    );
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon has any Basic Energy attached, this attack does 90 more damage.",
      ),
    ).toBeNull();
  });

  it("🛑 `conditionHolds` EVALUATES the new value, so the third arm has somewhere to die", () => {
    // 🛑 **D456's RULE, PAID BEFORE IT BECAME A FINDING.** `hasAttachedEnergy` gained a
    // `"basic"` arm because `conditionHolds`'s `yourActiveHasEnergyAttached` delegates
    // to it — and NO PRINTING spells that clause with `Basic`, so without this rung the
    // arm would be live, correct, and separated from every wrong implementation by
    // nothing at all (D479's UNKILLABLE-AS-WRITTEN class). The clause is constructed and
    // said to be constructed (D121); what it buys is that a mutation of that arm has a
    // board to fail on.
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

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the LOG row, RENDERED rather than reasoned about (D456/D499).
// ─────────────────────────────────────────────────────────────────────────────

describe("D500 §5 — the log row, rendered, with its honest limit recorded", () => {
  it("renders the fold as a `scaled` crumb on the damage row", () => {
    const state = mixedBoard();
    const { state: after, events } = swing(state, SELF.basic);
    const lines = rendered(after, events);
    const damage = lines.find((l) => l.text.includes("dealt "));
    expect(damage?.who).toBe("p1");
    expect(damage?.text).toContain("dealt 160 damage to ");
    expect(damage?.text).toContain("· scaled +160");
    // ⚠️ **AND THE HONEST LIMIT, RECORDED AT THE RUNG (D456/D499): the row cannot name
    // the NOUN.** `DAMAGE_DEALT` carries `scaled` as a number and nothing about which
    // count source produced it, so this line is byte-identical under the correct
    // reading and under any wrong reading that happens to answer 4. The log is not a
    // discriminator for this slice and §2 is; that is said here rather than left for a
    // later reader to discover by trusting a green line.
    expect(damage?.text).not.toContain("Basic");
    // The loud row a reverted vocabulary would print is ABSENT — which the log CAN see.
    expect(lines.some((l) => l.text.includes("could not be simulated"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the pre-state, derived rather than quoted (D491).
// ─────────────────────────────────────────────────────────────────────────────

describe("D500 §6 — what the corpus looked like before, computed from what it looks like now", () => {
  it("🛑 EXACTLY ONE sentence moved, and it is the one this slice names", () => {
    // D491's executable form: a pre-slice table written as prose is the unfalsifiable
    // claim D465 forbids, so the OLD verdict is DERIVED from the current one by
    // subtracting what the new vocabulary row claims. A point was refused before iff it
    // is claimed now AND its derived energy value is the card category `"basic"` —
    // because `"basic"` is the only value `CLAUSE_ENERGY_TOKENS` gained.
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
    // …so the corpus BEFORE this slice resolved exactly one sentence and one printing
    // fewer, and every one of those points was refused by all thirteen readers.
    const resolvedNow = legalAttackCorpus().filter(([, text]) => resolvedByAnyReader(text));
    // 🆕🆕🆕 D501 — A FRONT TERM, NOT A STEPPED ENDPOINT (D426/D461/D462). This
    // rung's claim is *the corpus BEFORE D500*, and the endpoint 530 / 1564 is the
    // frozen historical value: bumping it would have turned the assertion into
    // `head === head` and no sweep could tell. D501 claimed corpus FILE LINE 685
    // (1 sentence / 1 printing), so the live head grew and a `- 1 / - 1` at the FRONT
    // is what keeps the endpoint meaning what it says.
    expect([
      resolvedNow.length - 1 /* 🆕🆕🆕 D510, corpus FILE LINE 543, 1 sentence / 2 printings — THE DISCARD PILE NARROWED BY A PRINTED NAME FRAGMENT, `deriveAttackDamageMultiplier` over ONE new `CardFilter` member (`supporterNameContaining`) and ONE PARAMETERISED noun in `discardPileFilter` — **ZERO new anchors**, because D440's shipped anchor had matched this row since the day it was written. ⚠️ **A TERM AT THE FRONT, AND THE FROZEN ENDPOINT IS UNTOUCHED** (D426/D463). 🛑 **AND THE SENTENCE TERM IS 1 WHERE THE PRINTING TERM IS 2** — every D508 term beside it is 1 and 1, so a successor copying the neighbour would be wrong on one of the two chains. */ - 1 /* 🆕🆕🆕 D508, corpus FILE LINE 542, 1 sentence / 1 printing — THE DISCARD PILE NARROWED BY A PRINTED ATTACK NAME, `deriveAttackDamageMultiplier` over ONE new anchor crossing D440's `cardsInDiscardPile` count with D446's `attackNamePokemon` filter, ZERO new members in either union. The SENTENCE term and the PRINTING term are both 1, MEASURED on each side rather than copied across (D451). EDITED AT THE FRONT, NEVER AT THE END (D426). */ - 1 /* 🆕🆕🆕 D505, corpus FILE LINE 517, 1 sentence / 3 printings — the SENTENCE term is 1 and the PRINTING term below is 3, which is the whole of D451 in one pair of front terms. EDITED AT THE FRONT, NEVER AT THE ENDPOINT. */ - 1 /* D502, corpus FILE LINE 440, 1 sentence / 1 printing */ - 1 /* D501, corpus FILE LINE 685 */ - moved.length,
      units(resolvedNow) - 2 /* 🆕🆕🆕 D510, corpus FILE LINE 543, 1 sentence / 2 printings — THE DISCARD PILE NARROWED BY A PRINTED NAME FRAGMENT, `deriveAttackDamageMultiplier` over ONE new `CardFilter` member (`supporterNameContaining`) and ONE PARAMETERISED noun in `discardPileFilter` — **ZERO new anchors**, because D440's shipped anchor had matched this row since the day it was written. ⚠️ **A TERM AT THE FRONT, AND THE FROZEN ENDPOINT IS UNTOUCHED** (D426/D463). 🛑 **AND THE SENTENCE TERM IS 1 WHERE THE PRINTING TERM IS 2** — every D508 term beside it is 1 and 1, so a successor copying the neighbour would be wrong on one of the two chains. */ - 1 /* 🆕🆕🆕 D508, corpus FILE LINE 542, 1 sentence / 1 printing — THE DISCARD PILE NARROWED BY A PRINTED ATTACK NAME, `deriveAttackDamageMultiplier` over ONE new anchor crossing D440's `cardsInDiscardPile` count with D446's `attackNamePokemon` filter, ZERO new members in either union. The SENTENCE term and the PRINTING term are both 1, MEASURED on each side rather than copied across (D451). EDITED AT THE FRONT, NEVER AT THE END (D426). */ - 3 /* 🆕🆕🆕 D505, corpus FILE LINE 517, 3 printings on 1 sentence */ - 1 /* D502, corpus FILE LINE 440, 1 sentence / 1 printing */ - 1 /* D501, same row, 1 printing */ - units(moved),
    ]).toEqual([534, 1569]);  // (🆕🆕🆕 **D513 +1 sentence / +1 printing — THE PRINTED *“of different types”*, THE FIRST DISTINCTNESS CONSTRAINT THIS ENGINE READS** — `censusAttackCorpus.ts` **FILE LINE 473**, *"Search your deck for up to 3 Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (Sylveon ex `sv06.5-050`), claimed by `deriveAttackEffect`. 🛑 **THE ANCHOR WAS NEVER THE BLOCKER** — `ATTACK_HAND_SEARCH`'s `([^,.]+?)` noun group has captured `Basic Energy cards of different types` WHOLE since D231 and the sentence died one step later in `HAND_SEARCH_PLURAL.get`, so the new optional group MOVES a phrase out of the noun rather than admitting a sentence the pattern refused (D510's rule, paid a second time). ✅ **ZERO new `CardFilter` members — and no widening of that union could EVER have reached this row**, because `matchesFilter` narrows each card INDEPENDENTLY while *“of different types”* is a predicate on the ANSWER SET. It rides D332's shipped `chooseCards.caps` instead — one cap of ONE per `energyProvidesOf` cell — so **ZERO** new prompt fields, validator branches or client mirrors. `MATCH_RECORD_VERSION` **HELD at 30**.) (🆕🆕🆕 **D512 — THE BOTH-SIDES BODY COUNT NARROWED BY TWO PRINTED NAME FRAGMENTS** — `censusAttackCorpus.ts` **FILE LINE 583**, *"This attack does 40 damage for each Pokémon in play that has \"Koffing\" or \"Weezing\" in its name (both yours and your opponent's)."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor, ONE new `CardFilter` member (`pokemonNameContaining`) and ONE new `DamageCountSource` member (`bothSidesPokemonInPlay`). 🛑 **ALL FOUR SHIPPED IN-PLAY ANCHORS WERE RUN AGAINST THE ROW FIRST AND ALL FOUR REFUSE IT AT THE PATTERN** — the opposite answer to D510's, because every one of them requires the literal `for each of your ` and this sentence's head is SEATLESS. **+1 sentence / +2 printings**, which this BEFORE-figure inherits because it is computed from the live readers minus the row D500 names.) (🆕🆕🆕 **D510 +1 sentence / +2 printings — THE DISCARD PILE NARROWED BY A PRINTED NAME FRAGMENT** — `censusAttackCorpus.ts` **FILE LINE 543**, *"This attack does 20 damage for each Supporter card that has \"Team Rocket\" in its name in your discard pile."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` through ONE new `CardFilter` member (`supporterNameContaining`) and ONE PARAMETERISED noun in `discardPileFilter` — **ZERO new anchors**, because D440’s shipped `DISCARD_PILE_COUNT_MULTIPLY` had matched this row since it was written and the NOUN RESOLVER was the blocker. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2** — a TWO-printing sentence, the opposite of D508 one entry down, measured at this head rather than carried (D451/D461). RAW summand ALONE: registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved.) (🆕🆕🆕 **D507 +2 sentences / +2 printings — THE SPREAD THAT HITS **BOTH** BENCHES, AND THE OPTIONAL PRINTED CLAUSE THAT NARROWS IT TO THE ALREADY-DAMAGED BODIES** — `censusAttackCorpus.ts` **FILE LINES 515 and 526**, *"This attack also does 10 damage to each Benched Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)"* and *"This attack also does 40 damage to each Benched Pokémon **that has any damage counters on it** (both yours and your opponent's). (Don't apply…)"*, **2 sentences / 2 legal printings**, both claimed by `deriveAttackEffect` arm **6-ii** over ONE new anchor (`SPREAD_EACH_BOTH_BENCH`) whose OPTIONAL GROUP *is* the rider. 🛑 **THE BOTH-SIDES HALF COSTS NO TYPE AT ALL: it is a TWO-OP PROGRAM OF THE SAME OP** — `spreadDamage { yourBench }` then `spreadDamage { opponentBench }` — which is D482's shipped answer to the identical question one zone over, so `spreadDamage.target` gains **NO third member** and `counterEachAll`'s `filter` + `side` shape was refused rather than copied (D448/D449/D465's thrice-refused widening, same class). The op gains ONE OPTIONAL BOOLEAN RIDER, `damagedOnly` — `counterEachAll`'s own name on its own predicate `hasAnyDamageCounters`, D505's idiom one rider later. **ZERO** new `EffectOp` members, op KINDS, readers (surface unmoved at **13**), `CardFilter`/`BoardCondition`/`DamageCountSource` members, prompts, choice kinds, parks, events, error codes, `GameState`/`InPlayPokemon` fields, registry rows, `FIXTURE_POOL` ids (file-local `cardPool`, D414), `redact.ts` bytes, `packages/schema` bytes or `MATCH_RECORD_VERSION` bytes. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 2 AND 2**, MEASURED at this head rather than carried (D451/D461/D465) — both rows are 1-printing sentences. RAW summand ALONE: no registry row, no gate split, no trailing split — all three re-measured unmoved at registry 10/16, gate 5/13, trailing 11/21.)
    // ⚠️ **AND THE POINTS THE NEW ROW CLAIMS ARE EXACTLY THE ONES THAT MOVED** — the
    // second half of D491's rung, which is what reddens if a later slice widens the
    // vocabulary across a point this lattice recorded as refused.
    for (const [, text] of moved) expect(/\bBasic\b/.test(text)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — `MATCH_RECORD_VERSION`: the ADDRESS first, then the argument.
// ─────────────────────────────────────────────────────────────────────────────

describe("D500 §7 — the version stays 29, and the address is named before the argument", () => {
  it("🛑 the ADDRESS: `DamageCountSource` is PARSE-TIME and reaches no persisted byte", () => {
    // 🛑 **NAME THE ADDRESS FIRST (D443/D463), AND DERIVE IT RATHER THAN ASSUMING IT
    // (D499).** The value this slice's printed sentence produces rides
    // `AttackDamageMultiplier.count` — a `DamageCountSource` — which is built by a
    // reader from card text and consumed by `scaledAttackDamage` in the same tick. No
    // `EffectOp` carries one, no `GameState` field stores one and no `GameEvent` names
    // one, so it is not at a persisted address in either direction and the
    // member/inhabitant test has no version consequence there (D473's rule: before
    // applying a persistence-based rule, establish that the thing persists).
    const { state: after } = swing(mixedBoard(), SELF.basic);
    const wire = JSON.stringify(after);
    expect(wire).not.toContain("energyOnSelf");
    expect(wire).not.toContain("\"basic\"");
    // ⚠️ **`energyType` IS ON THE WIRE AND IT IS A DIFFERENT AXIS, WHICH IS WORTH
    // PINNING RATHER THAN WORKING AROUND.** The serialized `cardPool` carries the
    // CATALOG column `Card.energyType: "Normal" | "Special"` — the ingest's own
    // classification of an Energy card — while the value this slice widened is the
    // ENGINE's `DamageCountSource.energyType`, a parse-time reading of a printed
    // token. Two vocabularies, one field NAME, and the first draft of this rung
    // asserted the name absent and went red for the wrong reason. The catalog column
    // is what the new `"basic"` arm READS through `matchesFilter`; it did not change.
    expect(wire).toContain('"energyType":"Normal"');
    expect(wire).toContain('"energyType":"Special"');
  });

  it("🛑 the address that IS persisted, and why a WIDENING there is still free", () => {
    // ⚠️ **AND THE SLICE HAS A SECOND SHAPE CHANGE AT A DIFFERENT ADDRESS, SO THE
    // QUESTION IS ASKED TWICE (D443).** `BoardCondition.yourActiveHasEnergyAttached`
    // also gained the inhabitant, and THAT one is persisted: `conditionGate.cond`
    // carries a `BoardCondition`, an `EffectOp` rides `state.phase.cont.pendingOp`, and
    // that is inside `MatchRecord.state`.
    //
    // 🛑 **IT IS D125/D333's CASE — A UNION THAT GAINS AN INHABITANT — SO IT COSTS
    // NOTHING.** The record's own discriminator is *"would an old record MEAN something
    // else"*. No v29 byte string can hold `"basic"`, because no producer put it there:
    // the ONLY thing that emits the value into a `BoardCondition` is the D118 clause,
    // and the sweep below is what says the derived column produces none. Every
    // pre-existing inhabitant reads exactly as it read before, because the arms added
    // are new branches ahead of the shipped ones rather than edits to them.
    const produced = legalAttackCorpus().filter(([, text]) => {
      const cond = deriveAttackDamageBonus(text)?.count;
      return (
        cond?.kind === "boardCondition" &&
        cond.cond.kind === "yourActiveHasEnergyAttached" &&
        cond.cond.energy === "basic"
      );
    });
    expect(produced).toEqual([]);
    // …and the engine version DID move, because a card can reach the behaviour change.
    expect(engineVersion).toBe("0.400.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — what did NOT move.
// ─────────────────────────────────────────────────────────────────────────────

describe("D500 §8 — the absences, pinned rather than claimed", () => {
  it("the ADDITIVE fold of this exact sentence is still refused, and by the ANCHOR", () => {
    // D459 measured that `more damage for each … Energy card attached to this Pokémon.`
    // is printed nowhere, and declined to widen `SELF_ENERGY_SCALE` for symmetry. That
    // absence is untouched here: what D500 paid for is the TOKEN, and the token is
    // resolved one step after the anchor, so an anchor-shaped absence cannot move.
    expect(deriveAttackDamageBonus(SPECIAL_DRAW.replace("70 damage", "70 more damage"))).toBeNull();
    expect(
      deriveAttackDamageBonus(BASIC_DRAW.replace("Energy attached", "Energy card attached")
        .replace("40 damage", "40 more damage")),
    ).toBeNull();
    // …while the ` card`-LESS additive spelling DOES read, which is the control saying
    // the refusal above is about the word `card` and not about the word `Basic`. Both
    // halves are needed: without this line the rung would pass under a build that
    // refused the whole additive fold (D424's admitted/refused pair).
    expect(
      deriveAttackDamageBonus("This attack does 40 more damage for each Basic Energy attached to this Pokémon."),
    ).toEqual({ per: 40, count: { kind: "energyOnSelf", energyType: "basic" } });
  });

  it("no OTHER printed sentence changed its answer", () => {
    // The strongest form of "nothing else moved": every corpus row whose text does not
    // contain the token this slice taught is claimed by the same number of readers it
    // would have been claimed by before, because no reader and no anchor was touched.
    // The only reachable change is through `CLAUSE_ENERGY_TOKENS`, which is keyed on
    // the literal `Basic`.
    const withoutBasic = legalAttackCorpus().filter(([, text]) => !/\bBasic\b/.test(text));
    expect(withoutBasic.length).toBe(640 - 68);
    for (const [, text] of withoutBasic) {
      const claimers = READERS.filter((read) => read(text) !== null);
      expect(claimers.length, text).toBeLessThanOrEqual(2);
    }
    expect(legalAttackCorpus()).toHaveLength(640);
  });
});
