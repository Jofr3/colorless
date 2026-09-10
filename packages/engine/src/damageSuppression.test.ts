import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effectsModule from "./effects";
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
  splitAttackRequirementClause,
} from "./effects";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  DAMAGE_SUPPRESSION_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.124.0 → 0.125.0 — MAIN-HIT DAMAGE-MODIFIER SUPPRESSION (P3-M5 long tail, D192).
//
// The printed "This attack's damage isn't affected by …" clause, on the MAIN HIT:
// the §8.5 pipeline's first sentence that removes STEPS rather than moving numbers.
// Four fully anchored printed sentences on the ATTACK side and one printed ABILITY,
// resolving into THREE independent booleans and ONE shared read site.
//
// ⚠️ EVERY COUNT HERE IS A RE-MEASUREMENT, NOT AN INHERITANCE. Remote D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`), 3,786 rows / 20 sets, of which **2,021
// carry `legal_standard = 1`** (⇔ regulation mark H or I, plus unmarked Basic
// Energy), queried 2026-08-04 over `attacks_json` and `abilities_json` via
// `json_each` + `json_extract(value,'$.effect')`.
//
//   printed sentence                                    rows  legal  sets
//   ──────────────────────────────────────────────────  ────  ─────  ──────────────
//   "…by any effects on your opponent's Active Pokémon."  29     15   T
//   "…by Resistance."                                     17      9   R
//   "…by Weakness or Resistance, or by any effects on
//     your opponent's Active Pokémon."                    10      8   W + R + T
//   "…by Weakness or Resistance."                          2      2   W + R
//                                                        ───    ───
//                                                         58     34
//
//   ABILITY (`abilities_json`), the whole population — ONE sentence, ONE card:
//   "Damage from attacks used by this Pokémon isn't affected by any effects on
//    your opponent's Active Pokémon."                      6      6   T
//   Walking Wake ex "Azure Seas": sv05-050/-189/-205/-215, sv08.5-178, svp-127.
//
// ⚠️ THE THINGS THAT TURNED OUT WRONG, STATED FIRST BECAUSE THEY ARE THE POINT:
//
//   • **`suppressWeakness` does NOT occur alone in the sentences this slice
//     BUILDS.** The recon that scoped this work priced the three booleans on
//     "Weakness and Resistance each occur ALONE in the legal pool, so they cannot
//     share a field". Re-derived: `resistance` alone is real and BUILT (9 legal —
//     Landorus sv08-110 "Buster Swing" and seven siblings); `weakness` alone is
//     real in the LEGAL POOL but lives entirely in the DEFERRED rider printings
//     (2 legal, below). Inside the built four, Weakness is only ever printed
//     beside Resistance, so those two COULD have shared one field today. They do
//     not, for two reasons that are structural rather than anticipatory: the two
//     are read at two DIFFERENT §8.5 steps (the Weakness ternary already carries a
//     null path, `seatRemovesWeakness`; the Resistance one had none), and the very
//     first deferred rider to land would have to un-merge them. The correction is
//     recorded rather than the conclusion silently kept.
//
//   • **`suppressResistance`'s legal count is 17, not the 22 the recon quoted.**
//     17 = 9 (alone) + 8 (compound). The 22 is reachable only by adding all five
//     deferred riders, and only 3 of those 5 name Resistance at all. The same
//     arithmetic on Weakness DOES give the recon's 15 (10 built + 5 riders), and
//     `suppressTargetEffects`' 23 (15 + 8) is exact.
//
//   • **A `FIXTURE_POOL` sweep — run as a SEPARATE population, before anything was
//     written — found a carrier, which four slices running did not.** Bellibolt
//     sv03-078/-201 "Thunderous Edge" has printed sentence #1 verbatim since D159,
//     where the fixture comment called it "a live question this slice deliberately
//     does not answer". It is answered here, with NO fixture edit: both printings
//     become simulated. Nothing in `attackerFilter.test.ts` moves, because
//     Bellibolt is a DEFENDER in every case that file drives — checked by running
//     the suite, not by reading it.
//
// ⚠️ **+5 LEGAL RIDER-ON-COMPOUND PRINTINGS ARE DEFERRED, AND PINNED AS AN ABSENCE
// RATHER THAN REACHED FOR.** In each the clause is a TRAILING sentence on a
// compound whose leading half is a different rule:
//
//   "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does
//    nothing. This attack's damage isn't affected by Weakness or Resistance."   2
//   "If you have 3 or more Energy in play, this attack does 70 more damage.
//    This attack's damage isn't affected by Weakness."                          1
//   "This attack does 10 damage for each damage counter on all of your Benched
//    Cynthia's Pokémon. This attack's damage isn't affected by Weakness."       1
//   "Your opponent flips a coin for each of their Benched Pokémon. This attack
//    does 80 damage … for each tails. …isn't affected by Weakness or
//    Resistance."                                                               1
//
// Every deriver in this engine is FULLY ANCHORED — `^…$`, leading or trailing text
// falls to the loud ATTACK_EFFECT_SKIPPED path — so admitting these means a
// SENTENCE-SPLITTING seam (parse the compound into sentences, run each reader over
// each), not a looser regex. A search-style pattern would silently claim the whole
// compound and simulate a card whose leading clause the engine cannot read at all;
// four of the five are blocked on that leading clause independently. Their
// refusal is asserted below, verbatim.
//
// ⚠️ **NOT `damageChosen.ignoreWR`, AND ITS WRITER AND READERS WERE VERIFIED BEFORE
// THE CONCLUSION.** That field has ONE writer (`CHOSEN_ANY_TARGET`'s optional
// group 2 in effects.ts — 🆕🆕 D400: group 3 now, the count having taken 2 — Umbreon
// "Feint Attack" sv03-130) and TWO read paths
// (interpreter.ts `snipeActive` and `placeSnipe`'s `deals` arm). It is a member of
// an OP, and the main hit has no op: this sentence IS the whole printed effect of
// an attack whose damage comes from its `damage` field. It is also ONE boolean
// where three are needed. Sibling, not shared — and the sibling relationship is
// asserted in BOTH directions below.

/** The four printed attack sentences, char-for-char off the D1 rows. */
const S_EFFECTS =
  "This attack's damage isn't affected by any effects on your opponent's Active Pokémon.";
const S_RESISTANCE = "This attack's damage isn't affected by Resistance.";
const S_WR_EFFECTS =
  "This attack's damage isn't affected by Weakness or Resistance, or by any effects on your opponent's Active Pokémon.";
const S_WR = "This attack's damage isn't affected by Weakness or Resistance.";
/** 🆕 D493 — the bare-`Weakness` clause, which this reader refuses and the column
    never prints on its own. Named so its two claims (zero standalone rows, two
    compound tails) are greppable from one identifier rather than retyped. */
const WEAKNESS_ONLY_CLAUSE = "This attack's damage isn't affected by Weakness.";
/** The printed ABILITY, char-for-char (Walking Wake ex "Azure Seas"). */
const S_ABILITY =
  "Damage from attacks used by this Pokémon isn't affected by any effects on your opponent's Active Pokémon.";

/** The deferred legal riders, verbatim. Carried as data so their refusal is
    driven on real printed text rather than on a constructed near-miss.

    🆕🆕🆕 **D493 — THE LIST IS SPLIT BY REASON RATHER THAN SHORTENED (D441).** Two of
    its four members have since been BUILT, by two different mechanisms and for two
    different reasons, and shortening the list would have left the remaining two
    carrying a justification nobody re-checked. What every member below still shares
    — and what this file's rung actually asserts — is that `DAMAGE_SUPPRESSION`
    itself, the four-arm whole-sentence pattern, refuses ALL of them. That claim is
    true of the built ones too, and saying so is the point: neither was built by
    loosening this pattern. */
const DEFERRED_RIDERS = [
  // BUILT at D363, and NOT by this reader: `splitAttackRequirementClause` strips the
  // leading does-nothing clause and hands the BODY — which is a printed sentence
  // `DAMAGE_SUPPRESSION` already claimed — to attack.ts's read site.
  "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing. This attack's damage isn't affected by Weakness or Resistance.",
  // 🛑 **BUILT AT D494, AND THE PARAGRAPH BELOW WAS TRUE WHEN WRITTEN AND IS NOW
  // HISTORY.** It read: *"STILL DEFERRED, and its blocker is its own LEADING half: the
  // head derives to `null` under all thirteen readers, so no split and no compound
  // anchor can reach it."* Every clause of that was correct at D493's head and it was a
  // MEASUREMENT rather than an inheritance — what changed is that D494 taught
  // `boardConditionForClause` the printed clause *"you have 3 or more Energy in play"*
  // (`yourEnergyInPlayAtLeast` with `energy: null`, the member's field widened from a
  // narrowing to an optional one) and added a SECOND whole-sentence anchor,
  // `CONDITIONAL_BONUS_SUPPRESSED`, spelling the head and this tail together. Kept and
  // dated rather than deleted (D442/D466): the blocker really was the leading half, and
  // a successor reading only the new state cannot see that the two halves were priced
  // separately. `DAMAGE_SUPPRESSION` is byte-unchanged, so this row stays in the list.
  "If you have 3 or more Energy in play, this attack does 70 more damage. This attack's damage isn't affected by Weakness.",
  // BUILT at D493, and NOT by this reader either: a SECOND whole-sentence anchor
  // spelling the head and the tail together, read by `deriveAttackDamageMultiplier`
  // for the fold and by `deriveAttackDamageSuppression`'s own compound arm for the
  // §8.5 step. `DAMAGE_SUPPRESSION` is byte-unchanged, which is why this row stays
  // in the list below rather than leaving it.
  "This attack does 10 damage for each damage counter on all of your Benched Cynthia's Pokémon. This attack's damage isn't affected by Weakness.",
  // STILL DEFERRED, and its blocker is also its LEADING half — here a TWO-clause head
  // (a per-Bench coin count and a per-tails snipe) that no reader claims.
  "Your opponent flips a coin for each of their Benched Pokémon. This attack does 80 damage to your opponent's Active Pokémon for each tails. This attack's damage isn't affected by Weakness or Resistance.",
] as const;
/** The ZERO-LEGAL rider `FIXTURE_POOL` already carries (Pachirisu sv01-068/-208
    "Everyone Discharge", 3 catalog / 0 legal) — the same refusal, driven on a
    sentence that is in the pool TODAY, so a later slice that loosens the anchor
    finds out here. */
const POOL_RIDER =
  "This attack does 20 more damage for each of your Benched {L} Pokémon. This attack's damage isn't affected by Weakness.";
/** Umbreon "Feint Attack" sv03-130 — the OP-borne twin, which must stay on
    `damageChosen.ignoreWR` and must NOT be read by this slice's deriver. */
const FEINT_ATTACK =
  "This attack does 50 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on that Pokémon.";

/** U+2019, spelled as an escape (clauseApostrophe.test.ts's idiom). */
const RSQUO = "’";
const curly = (text: string): string => text.replaceAll("'", RSQUO);

/** One seed: nothing here flips a coin and every body and Energy is placed by
    surgery, so a seed table would describe a shuffle rather than a rule. */
const SEED = 5;

/** The attack indices on `fix-suppressor`, keyed by the boolean(s) each sets, so
    no case addresses a sentence by number. Index order is the measured legal
    count, largest first. */
const IDX = { effects: 0, resistance: 1, wrEffects: 2, wr: 3, control: 4 } as const;
/** The index-5 PROBE — the same clause on a printed `60+`, which no real card has. */
const PROBE = 5;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** P2 opens and passes, so P1 carries no §4 first-turn restriction. Both Benches
    are cleared and both Actives placed by surgery — every number here is a
    PIPELINE, so a body the setup shuffle happened to place would silently move
    the seat-wide aura. One Fire Energy pays every `{C}` cost in the suite. */
function board(attacker: string, defender: string): GameState {
  let state = must(
    applyAction(
      driveSetup(
        SEED,
        { p1: DAMAGE_SUPPRESSION_DECK, p2: DAMAGE_SUPPRESSION_DECK },
        { first: "p2" },
      ),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", attacker);
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
  state = setActiveFromDeck(state, "p2", defender);
  return clearBench(state, "p2");
}

function swing(state: GameState, index: number, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}

/** Put Neutralization Zone into the shared zone from `seat`'s hand — the OFF-TARGET
    prevention this clause must not reach (attackerFilter.test.ts's idiom). */
function withStadium(state: GameState, seat: Seat = "p1"): GameState {
  const next = handFromDeck(state, seat, "sv06.5-060", 1);
  return mustApply(next, {
    type: "playTrainer",
    seat,
    uid: handUid(next, seat, "sv06.5-060"),
  }).state;
}

/** TEST SURGERY, local on purpose: stamp `InPlayPokemon.attackDamageDebuff` on P1's
    Active for THIS turn. The real path installs it from the opponent's previous
    attack; what this suite needs is the READ, and driving two turns to reach it
    would put a promotion and an energy attach between the board and the assertion.
    Local rather than in `testFixtures.ts` because exactly one suite asks. */
function withInstalledDebuff(state: GameState, amount: number): GameState {
  const active = state.players.p1.active;
  if (active === null) throw new Error("no Active to stamp");
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...state.players.p1,
        active: { ...active, attackDamageDebuff: { turn: state.turn, amount } },
      },
    },
  };
}

/** The `dealt` on the one DAMAGE_DEALT row. */
function dealt(state: GameState, index: number): number | null {
  return find(swing(state, index).events, "DAMAGE_DEALT")?.dealt ?? null;
}

/** …and the whole row, for the cases that assert WHICH step reported the change. */
function row(state: GameState, index: number) {
  return find(swing(state, index).events, "DAMAGE_DEALT");
}

// ─────────────────────────────────────────────────────────────────────────────
// The fixture pool — a SEPARATE population, swept before anything was authored.
// ─────────────────────────────────────────────────────────────────────────────

describe("the fixture pool — swept first, and it was NOT empty", () => {
  it("⚠️ Bellibolt sv03-078/-201 already printed sentence #1, and now derives it", () => {
    // D156's rule, asserted rather than remembered — and this time the sweep
    // returned something. "Thunderous Edge" has carried this sentence verbatim
    // since D159 with a fixture comment declaring it unanswered; the answer costs
    // no fixture edit, and the ids are named so a later slice that changes either
    // printing learns it here.
    const carriers = Object.entries(FIXTURE_POOL)
      .filter(
        ([id, card]) =>
          id !== "fix-suppressor" &&
          (card.attacks ?? []).some((a) =>
            [S_EFFECTS, S_RESISTANCE, S_WR_EFFECTS, S_WR].includes(a.effect ?? ""),
          ),
      )
      .map(([id]) => id);
    expect(carriers).toEqual(["sv03-078", "sv03-201"]);
    for (const id of ["sv03-078", "sv03-201"] as const) {
      const printed = FIXTURE_POOL[id]?.attacks?.[0];
      expect(printed?.name).toBe("Thunderous Edge");
      expect(deriveAttackDamageSuppression(printed?.effect ?? "")).toEqual({ targetEffects: true });
    }
  });

  it("…and the pool's OTHER carrier is a DEFERRED rider that stays unsimulated", () => {
    // Pachirisu sv01-068/-208 "Everyone Discharge" — the same clause as a trailing
    // rider on a typed bench count. 3 catalog printings, 0 legal. It must stay on
    // the loud path, and the fact that a real fixture already carries the shape is
    // what makes this a driven refusal rather than a constructed one.
    for (const id of ["sv01-068", "sv01-208"] as const) {
      expect(FIXTURE_POOL[id]?.attacks?.[0]?.effect).toBe(POOL_RIDER);
    }
    expect(deriveAttackDamageSuppression(POOL_RIDER)).toBeNull();
  });

  it("holds no fixture printing the ABILITY sentence except this slice's own", () => {
    const carriers = Object.entries(FIXTURE_POOL)
      .filter(([, card]) => (card.abilities ?? []).some((a) => a.effect === S_ABILITY))
      .map(([id]) => id);
    expect(carriers).toEqual(["fix-azureseas"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The reader.
// ─────────────────────────────────────────────────────────────────────────────

describe("deriveAttackDamageSuppression — four sentences, three booleans", () => {
  it("reads each printed sentence into exactly the booleans it names", () => {
    expect(deriveAttackDamageSuppression(S_EFFECTS)).toEqual({ targetEffects: true });
    expect(deriveAttackDamageSuppression(S_RESISTANCE)).toEqual({ resistance: true });
    expect(deriveAttackDamageSuppression(S_WR_EFFECTS)).toEqual({
      weakness: true,
      resistance: true,
      targetEffects: true,
    });
    expect(deriveAttackDamageSuppression(S_WR)).toEqual({ weakness: true, resistance: true });
  });

  it("⚠️ the ALTERNATION ORDER is behaviour: the compound must beat its own prefix", () => {
    // JS alternation is leftmost-first and "Weakness or Resistance" is a PREFIX of
    // "Weakness or Resistance, or by any effects on…". Ordered the other way the
    // compound could never match — it would fail the `\.$` anchor and fall to the
    // loud path, silently losing 8 legal printings. Asserted as the pair, because
    // the failure is invisible on either sentence alone.
    expect(deriveAttackDamageSuppression(S_WR_EFFECTS)?.targetEffects).toBe(true);
    expect(deriveAttackDamageSuppression(S_WR)?.targetEffects).toBeUndefined();
  });

  it("each of the three booleans is ABSENT rather than false when unnamed", () => {
    // The shape matters at the read site: attack.ts asks `?.weakness === true`, so
    // an arm that returned `{weakness: false}` would read identically — and an arm
    // that returned `{}` for an unrecognised sentence would suppress nothing while
    // claiming the attack was simulated. `toEqual` on the whole object is what
    // pins that a matched sentence names exactly its own steps.
    expect(Object.keys(deriveAttackDamageSuppression(S_RESISTANCE) ?? {})).toEqual(["resistance"]);
    expect(Object.keys(deriveAttackDamageSuppression(S_EFFECTS) ?? {})).toEqual(["targetEffects"]);
  });

  it("reads the U+2019 spelling IDENTICALLY on all four (D137's fold)", () => {
    // Equality with the straight form, never merely non-null — D136's shape. Each
    // sentence carries THREE exposed apostrophes ("attack's", "isn't", and on two
    // of them "opponent's"), and the class sits in the PATTERN because the
    // capture-per-arm dispatch never looks at the matched text.
    for (const sentence of [S_EFFECTS, S_RESISTANCE, S_WR_EFFECTS, S_WR]) {
      expect(deriveAttackDamageSuppression(curly(sentence))).toEqual(
        deriveAttackDamageSuppression(sentence),
      );
      expect(deriveAttackDamageSuppression(curly(sentence))).not.toBeNull();
    }
  });

  it("refuses a lowercased 'this', a missing period, and leading/trailing text", () => {
    expect(deriveAttackDamageSuppression(S_WR.replace("This", "this"))).toBeNull();
    expect(deriveAttackDamageSuppression(S_WR.replace(/\.$/, ""))).toBeNull();
    expect(deriveAttackDamageSuppression(`Draw a card. ${S_WR}`)).toBeNull();
    expect(deriveAttackDamageSuppression(`${S_WR} Draw a card.`)).toBeNull();
    // …and the object swapped to bare `Weakness`. ⚠️ 🆕🆕🆕 **D493 — THE COMMENT HERE
    // USED TO SAY "a plausible near-miss the pool does NOT print", AND THAT WAS
    // IMPRECISE RATHER THAN FALSE.** The pool does not print this sentence STANDALONE
    // (zero rows in the 640-row column, asserted below), and it DOES print the clause,
    // twice, as the tail of `DEFERRED_RIDERS[1]` and `[2]`. The distinction is the
    // whole of why D493 built file line 529 with a compound anchor instead of adding a
    // fifth arm here: an arm would be vocabulary with no printing behind it (D440),
    // and this rung plus two more in two other files rest on its absence.
    expect(legalAttackCorpus().filter(([, t]) => t === WEAKNESS_ONLY_CLAUSE)).toEqual([]);
    expect(
      legalAttackCorpus().filter(([, t]) => t.endsWith(` ${WEAKNESS_ONLY_CLAUSE}`)),
    ).toHaveLength(2);
    expect(deriveAttackDamageSuppression(WEAKNESS_ONLY_CLAUSE)).toBeNull();
  });

  it("⚠️ `DAMAGE_SUPPRESSION` refuses every rider-on-compound, built or not", () => {
    // 🆕🆕🆕 **D493 — THE CLAIM IS NARROWED TO THIS PATTERN AND WIDENED IN EVIDENCE.**
    // Two of the four are now built (see the list's own comments), so *"refuses all
    // five deferred riders"* had become a sentence about a set that no longer exists.
    // What is still true, and is what the four arms were designed to guarantee, is
    // that NONE of them reaches `DAMAGE_SUPPRESSION`: every deriver in this file is
    // `^…$` anchored and leading text falls to the loud path. Both builds went round
    // it — one through a SPLIT, one through a SECOND anchor — and this rung is what
    // says so.
    // (a) THE PATTERN ITSELF still refuses three of the four whole — every rider whose
    // build did not come from this reader — and the POOL rider besides.
    for (const rider of [DEFERRED_RIDERS[0], DEFERRED_RIDERS[3], POOL_RIDER]) {
      expect(deriveAttackDamageSuppression(rider), rider).toBeNull();
    }
    // …and the two that are BUILT are built by something else, asserted by NAME so a
    // future loosening of this pattern cannot be mistaken for the real mechanism
    // (D438: name the owner, keep the refusals).
    expect(splitAttackRequirementClause(DEFERRED_RIDERS[0])).toEqual({
      clause: "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing.",
      body: S_WR,
    });
    expect(deriveAttackDamageSuppression(DEFERRED_RIDERS[2])).toEqual({ weakness: true });
    expect(deriveAttackDamageMultiplier(DEFERRED_RIDERS[2])).toEqual({
      per: 10,
      count: { kind: "damageCountersOnYourBench", filter: { kind: "ownerPokemon", owner: "Cynthia" } },
    });
    // 🆕🆕🆕 **D494 — RIDER [1] IS BUILT NOW, AND NOT BY THIS READER EITHER.** A THIRD
    // whole-sentence anchor, `CONDITIONAL_BONUS_SUPPRESSED`, spelling the printed
    // conditional bonus and this exact tail together — read by `deriveAttackDamageBonus`
    // for the fold and by `deriveAttackDamageSuppression`'s own compound arm for the
    // §8.5 step. `DAMAGE_SUPPRESSION` is BYTE-UNCHANGED, which is why the row stays in
    // the list above rather than leaving it, and why the loop below still refuses [3].
    // ⚠️ **NAMED BY VALUE AND BY OWNER, WITH THE ELEVEN REFUSALS KEPT** (D438): a
    // `.not.toBeNull()` re-point would be true under a mistaken widening of THIS
    // pattern as well, which is the one thing the rung exists to catch.
    expect(deriveAttackDamageSuppression(DEFERRED_RIDERS[1])).toEqual({ weakness: true });
    expect(deriveAttackDamageBonus(DEFERRED_RIDERS[1])).toEqual({
      per: 70,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourEnergyInPlayAtLeast", energy: null, count: 3 },
      },
    });
    for (const name of attackReaderSurface()) {
      if (name === "deriveAttackDamageBonus" || name === "deriveAttackDamageSuppression") continue;
      const read = (effectsModule as unknown as Record<string, (t: string) => unknown>)[name];
      expect(read?.(DEFERRED_RIDERS[1]) ?? null, name).toBeNull();
    }
    // …and the two that are NOT built are still refused by every one of the thirteen,
    // which is the half that would go quiet if a later slice widened something.
    for (const rider of [DEFERRED_RIDERS[3]]) {
      expect(resolvedByAnyReader(rider), rider).toBe(false);
    }
  });

  it("is DISJOINT from all TWELVE sibling readers on all four sentences", () => {
    // The whole-sentence anchor is what makes "a card carries at most one" true,
    // and it is asserted rather than argued: no other reader may answer on this
    // text, and this reader may not answer on theirs.
    const others = [
      deriveAttackDamageBonus,
      deriveAttackDamageMultiplier,
      deriveAttackDamagePenalty,
      deriveAttackRequirement,
      deriveAttackEffect,
      // 🆕🆕 D419 — COMPLETED TO THE MODULE'S TWELVE. This list was hand-kept INLINE,
      // which is why D418's survey of forty module-level `READERS` arrays did not see
      // it at all. ⚠️ A REFUSAL OVER A SHORT LIST IS NOT FALSE, IT IS NARROWER — the
      // missing reader is simply never asked and the rung stays green, which is the
      // failure mode this whole run is about.
      deriveAttackBonusConsequent,
      deriveAttackCancelRequirement,
      deriveAttackDiscardScaledBoost,
      deriveAttackOptionalBoost,
      deriveAttackOptionalCostBoost,
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
    expect([...others.map((read) => read.name), "deriveAttackDamageSuppression"].sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(13);

    for (const sentence of [S_EFFECTS, S_RESISTANCE, S_WR_EFFECTS, S_WR]) {
      for (const read of others) expect(read(sentence)).toBeNull();
    }
    for (const sentence of [
      "This attack does 20 more damage for each damage counter on this Pokémon.",
      "Your opponent's Active Pokémon is now Asleep.",
    ]) {
      expect(deriveAttackDamageSuppression(sentence)).toBeNull();
    }
  });

  it("⚠️ does NOT read Feint Attack — that sentence stays on `damageChosen.ignoreWR`", () => {
    // The sibling relationship, asserted in BOTH directions: this reader declines
    // the op-borne twin, and the op-borne twin still derives its op with the flag.
    // The single writer / two read paths were verified in the file before this
    // slice concluded the field could not be reused; this pins that it was not
    // disturbed.
    expect(deriveAttackDamageSuppression(FEINT_ATTACK)).toBeNull();
    expect(deriveAttackEffect(FEINT_ATTACK)).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 50,
        count: 1,
        source: "attack",
        deals: true,
        ignoreWR: true,
      },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The registry — the ABILITY half's storage.
// ─────────────────────────────────────────────────────────────────────────────

describe("the ability half — Walking Wake ex 'Azure Seas'", () => {
  it("fields all SIX Standard-legal printings, and nothing else carries the field", () => {
    for (const id of [
      "sv05-050",
      "sv05-189",
      "sv05-205",
      "sv05-215",
      "sv08.5-178",
      "svp-127",
    ] as const) {
      expect(programFor(id)?.passive).toEqual({ suppressTargetEffectsOnAttack: true });
    }
    // The reprints share ONE object — the program is keyed by id, and a build that
    // keyed it on the body would field one printing and drop five.
    expect(programFor("sv05-189")?.passive).toBe(programFor("sv05-050")?.passive);
    // Real ids get no fixture: they are outside the local 6-set `CATALOG_MANIFEST`
    // and the generator cannot be re-run here (`SQLITE_CANTOPEN`). D190's idiom.
    for (const id of ["sv05-050", "sv08.5-178", "svp-127"] as const) {
      expect(FIXTURE_POOL[id]).toBeUndefined();
    }
  });

  it("the synthetic demonstrator carries the printed sentence byte for byte", () => {
    expect(FIXTURE_POOL["fix-azureseas"]?.abilities).toEqual([
      { type: "Ability", name: "Azure Seas", effect: S_ABILITY },
    ]);
    // Its ONE attack prints NO effect — anything it suppresses came from the
    // Ability, because there is no attack text for a deriver to read.
    expect(FIXTURE_POOL["fix-azureseas"]?.attacks).toEqual([
      { cost: ["Colorless"], name: "Surge", damage: 60 },
    ]);
    expect(programFor("fix-azureseas")?.passive).toEqual({ suppressTargetEffectsOnAttack: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8.5, end to end.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8.5 — the ORDER witness, on one board and four sentences", () => {
  // `fix-suppresswall`: ×2 Fire Weakness AND a −30 post-W/R reduction, off a
  // printed 60. FOUR distinct numbers from one attacker on one body:
  //
  //   control     (nothing suppressed)   60 × 2 − 30 = 90
  //   effects     (T)                    60 × 2      = 120
  //   W + R                              60     − 30 = 30
  //   W + R + T                          60           = 60
  //
  // ⚠️ AND IT DOES NOT COMMUTE, WHICH IS THE WHOLE REASON THIS BOARD EXISTS. The
  // control alone pins the ORDER: reduction-before-Weakness reads
  // (60 − 30) × 2 = 60, and 90 ≠ 60. The two suppressions then remove one operand
  // each, so the three remaining numbers reconstruct which step was skipped rather
  // than merely showing that something changed.
  const wall = () => board("fix-suppressor", "fix-suppresswall");

  it("the control takes Weakness THEN the reduction — 90, not 60", () => {
    expect(dealt(wall(), IDX.control)).toBe(90);
    expect(row(wall(), IDX.control)).toMatchObject({
      base: 60,
      weakness: { op: "multiply", amount: 2 },
      reduction: 30,
    });
  });

  it("`targetEffects` alone removes the REDUCTION and leaves Weakness: 120", () => {
    expect(dealt(wall(), IDX.effects)).toBe(120);
    // Reported, not inferred: the row still carries the Weakness it applied and
    // drops the `reduction` field entirely, so the log reconstructs which step went.
    expect(row(wall(), IDX.effects)).toMatchObject({ weakness: { op: "multiply", amount: 2 } });
    expect(row(wall(), IDX.effects)?.reduction).toBeUndefined();
  });

  it("`weakness + resistance` removes Weakness and leaves the reduction: 30", () => {
    expect(dealt(wall(), IDX.wr)).toBe(30);
    expect(row(wall(), IDX.wr)).toMatchObject({ weakness: null, reduction: 30 });
  });

  it("all three removes both: the printed 60, unmodified", () => {
    expect(dealt(wall(), IDX.wrEffects)).toBe(60);
    expect(row(wall(), IDX.wrEffects)).toMatchObject({ weakness: null, resistance: null });
    expect(row(wall(), IDX.wrEffects)?.reduction).toBeUndefined();
  });

  it("…and the four numbers are DISTINCT, which is what makes each arm observable", () => {
    const state = wall();
    const numbers = [IDX.control, IDX.effects, IDX.wr, IDX.wrEffects].map((i) => dealt(state, i));
    expect(numbers).toEqual([90, 120, 30, 60]);
    expect(new Set(numbers).size).toBe(4);
  });

  it("`resistance` alone changes NOTHING here — the board has no Resistance", () => {
    // The negative that separates the three booleans: a Resistance suppression on
    // a body with no Resistance must leave Weakness and the reduction alone. A
    // build that folded Weakness and Resistance into one field reads 120 here.
    expect(dealt(wall(), IDX.resistance)).toBe(90);
  });
});

describe("§8.5 — Resistance, and the ordering witness that does NOT exist", () => {
  const rwall = () => board("fix-suppressor", "fix-resistwall");

  it("suppressing Resistance moves the number: 0 → 30 on a −30/−30 body", () => {
    // `fix-resistwall` is −30 Fire Resistance AND −30 after W/R, off a printed 60:
    // the control is 60 − 30 − 30 = 0, and removing the Resistance step leaves 30.
    expect(dealt(rwall(), IDX.control)).toBe(0);
    expect(dealt(rwall(), IDX.resistance)).toBe(30);
    expect(row(rwall(), IDX.resistance)).toMatchObject({ resistance: null, reduction: 30 });
  });

  it("⚠️ PINNED ABSENCE: `suppressResistance` alone can NEVER witness an ORDER", () => {
    // Resistance and the post-W/R reduction are BOTH subtractions under monotone
    // floors, and `max(0, max(0, x − a) − b) === max(0, x − a − b)` for every
    // a, b ≥ 0 — so the two steps commute EXACTLY and no board can tell their order.
    // Driven as arithmetic over the whole reachable range rather than written as a
    // board that would pass while asserting nothing.
    for (let x = 0; x <= 300; x += 10) {
      for (const a of [0, 30]) {
        for (const b of [0, 10, 20, 30, 100]) {
          expect(Math.max(0, Math.max(0, x - a) - b)).toBe(Math.max(0, Math.max(0, x - b) - a));
        }
      }
    }
    // And the second half of the absence is a CATALOG fact, not an arithmetic one:
    // ordering Resistance against WEAKNESS needs a body listing one type in both
    // columns, and the D1 holds ZERO such rows over all 3,786 (measured 2026-08-04
    // by joining `weaknesses_json` against `resistances_json` on `$.type`). The
    // only body that can is `fix-weak-tough`, which is SYNTHETIC and says so.
    expect(FIXTURE_POOL["fix-weak-tough"]?.weaknesses).toEqual([{ type: "Fire", value: "×2" }]);
    expect(FIXTURE_POOL["fix-weak-tough"]?.resistances).toEqual([{ type: "Fire", value: "-30" }]);
  });

  it("on the synthetic both-modifier body the three arms separate cleanly", () => {
    // 60 × 2 − 30 = 90 (control), 60 × 2 = 120 (Resistance gone), 60 (both gone).
    // The ORDER here is already pinned by the control — this slice's contribution
    // is that removing ONE operand moves the number by exactly that operand, which
    // is the value witness and not a second order witness.
    const wt = () => board("fix-suppressor", "fix-weak-tough");
    expect(dealt(wt(), IDX.control)).toBe(90);
    expect(dealt(wt(), IDX.resistance)).toBe(120);
    expect(dealt(wt(), IDX.wr)).toBe(60);
    expect(dealt(wt(), IDX.wrEffects)).toBe(60);
    // …and `targetEffects` reaches NEITHER: Weakness and Resistance are printed
    // card PROPERTIES, not "effects on" a Pokémon. This is the negative that keeps
    // the widest sentence from swallowing the other two.
    expect(dealt(wt(), IDX.effects)).toBe(90);
  });
});

describe("§8.5 — what 'any effects on your opponent's Active Pokémon' reaches", () => {
  it("the PRE-W/R aura whose source IS the opponent's Active (Entei 'Pressure')", () => {
    // D151's reading, arriving at the main hit: `opposingAttackDebuff`'s source is
    // the opponent's Active Spot and the clause names exactly that body, so this
    // term goes — while the other two terms of the same `debuff` sum (a stamp on
    // the ATTACKER's record, and this attack's own printed penalty) stand, because
    // neither is an effect on the defender at all.
    const entei = () => board("fix-suppressor", "sv03-030");
    expect(row(entei(), IDX.control)).toMatchObject({ dealt: 40, debuff: 20 });
    expect(dealt(entei(), IDX.effects)).toBe(60);
    expect(row(entei(), IDX.effects)?.debuff).toBeUndefined();
    // …and the sentence that does NOT name effects leaves the aura alone.
    expect(dealt(entei(), IDX.resistance)).toBe(40);
    expect(dealt(entei(), IDX.wr)).toBe(40);
    expect(dealt(entei(), IDX.wrEffects)).toBe(60);
  });

  it("an ON-TARGET PREVENTION (Dachsbun's {R} filter) — nulled, damage lands", () => {
    // The prevention arm: `preventDamageFromTypes` is a catalog aura on the damaged
    // body, so the clause reaches it and a Fire attacker gets through.
    const dachs = () => board("fix-suppressor", "sv01-099");
    expect(row(dachs(), IDX.control)).toMatchObject({ dealt: 0, prevented: true });
    expect(dealt(dachs(), IDX.effects)).toBe(60);
    expect(row(dachs(), IDX.effects)?.prevented).toBeUndefined();
    expect(dealt(dachs(), IDX.wrEffects)).toBe(60);
    // …and the two sentences that do NOT name effects leave the prevention up.
    expect(row(dachs(), IDX.resistance)).toMatchObject({ dealt: 0, prevented: true });
    expect(row(dachs(), IDX.wr)).toMatchObject({ dealt: 0, prevented: true });
  });

  it("⚠️ the SEAT-WIDE aura SPLITS rather than nulls — D161's reading, inherited", () => {
    // Hariyama's "All of your Pokémon take 10 less damage" has a source set that
    // CONTAINS its target set, so "any effects on your opponent's Active Pokémon"
    // reaches exactly the part the defending body is granting ITSELF. An ACTIVE
    // Hariyama loses its own 10…
    const self = () => board("fix-suppressor", "sv02-113");
    expect(row(self(), IDX.control)).toMatchObject({ dealt: 50, reduction: 10 });
    expect(dealt(self(), IDX.effects)).toBe(60);

    // …and a BENCHED Hariyama shielding a different Active keeps shielding it
    // through the same declaration. That pair is what makes `"othersOnly"`
    // observable rather than argued: a build that nulled the seat aura outright
    // reads 60 on the second board.
    const teammate = () => benchFromDeck(board("fix-suppressor", "fix-bigbody"), "p2", "sv02-113");
    expect(row(teammate(), IDX.control)).toMatchObject({ dealt: 50, reduction: 10 });
    expect(row(teammate(), IDX.effects)).toMatchObject({ dealt: 50, reduction: 10 });
  });

  it("⚠️ a STADIUM's prevention SURVIVES the clause — the OFF-TARGET half, driven", () => {
    // D159's grouping, and this is the board that makes it observable at the MAIN
    // HIT rather than only at the two snipe arms. Neutralization Zone sv06.5-060
    // ("Prevent all damage done to Pokémon that don't have a Rule Box … by attacks
    // from the opponent's Pokémon ex and Pokémon V") is a rule whose source is the
    // shared Stadium ZONE — an effect on no Pokémon whatever — so "any effects on
    // your opponent's Active Pokémon" cannot reach it.
    //
    // `fix-azureseas` is the attacker BECAUSE it is a V (the Stadium filters on the
    // attacker's rule box) and because its suppression comes from an Ability with
    // no attack text at all: the hit is suppressed as hard as this engine can
    // suppress it, and the Stadium still nulls it.
    const zone = withStadium(board("fix-azureseas", "fix-suppresswall"));
    expect(row(zone, 0)).toMatchObject({ dealt: 0, prevented: true });
    // …and the control on the same board, so the 0 is the Stadium and not the
    // suppression having gone missing: without the Stadium the same declaration
    // reads 120.
    expect(dealt(board("fix-azureseas", "fix-suppresswall"), 0)).toBe(120);
  });

  it("⚠️ the ATTACKER's OWN installed pre-W/R debuff is NOT nulled", () => {
    // The `debuff` sum's other two terms. `installedAttackDebuffOf` reads a stamp
    // on the ATTACKER's record ("During your opponent's next turn, attacks used by
    // the Defending Pokémon do N less damage"), which is an effect on the attacker
    // and not on "your opponent's Active Pokémon" — the same reading that keeps the
    // attacker's pre-W/R BONUS alive at the two snipe arms, applied to the term
    // below it. A build that nulled the whole `debuff` under the clause reads 60.
    const stamped = withInstalledDebuff(board("fix-suppressor", "fix-bigbody"), 20);
    expect(row(stamped, IDX.control)).toMatchObject({ dealt: 40, debuff: 20 });
    expect(row(stamped, IDX.effects)).toMatchObject({ dealt: 40, debuff: 20 });
    // …and on a board carrying BOTH sources the clause takes exactly one of them:
    // Entei's aura (source = the opponent's Active) goes, the stamp stays.
    const both = withInstalledDebuff(board("fix-suppressor", "sv03-030"), 20);
    expect(row(both, IDX.control)).toMatchObject({ dealt: 20, debuff: 40 });
    expect(row(both, IDX.effects)).toMatchObject({ dealt: 40, debuff: 20 });
  });

  it("the OFF-TARGET pair stays OUTSIDE the guard — D159's grouping, verbatim", () => {
    // Both off-target reads (`benchShieldedFromDamage`, `stadiumPreventsDamage`) are
    // FALSE by construction on the main-hit path — the defender is an Active — so
    // this asserts the STRUCTURE the way the site itself can: no board here is
    // prevented by anything the guard does not own, and the guard never turns a
    // prevented hit into damage except through an ON-TARGET source. The live proof
    // of the split is at the two snipe arms (attackerFilter.test.ts).
    const plain = board("fix-suppressor", "fix-bigbody");
    for (const index of Object.values(IDX)) {
      expect(row(plain, index)?.prevented).toBeUndefined();
      expect(dealt(plain, index)).toBe(60);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The shared read site.
// ─────────────────────────────────────────────────────────────────────────────

describe("the ability half and the attack half SHARE the read site", () => {
  it("an empty-text attack from an 'Azure Seas' body reads the SAME numbers", () => {
    // `fix-azureseas`' only attack prints no effect at all, so every difference
    // below came from the Ability — and each number is byte-identical to
    // `fix-suppressor`'s `targetEffects` sentence on the same board. That identity
    // IS the correctness claim for sharing the read site: three §8.5 steps consult
    // one local and none can tell which half answered.
    const pairs: [string, number][] = [
      ["fix-suppresswall", 120],
      ["sv03-030", 60],
      ["sv01-099", 60],
      ["sv02-113", 60],
      ["fix-weak-tough", 90],
      ["fix-resistwall", 30],
    ];
    for (const [defender, expected] of pairs) {
      expect(dealt(board("fix-azureseas", defender), 0), defender).toBe(expected);
      expect(dealt(board("fix-suppressor", defender), IDX.effects), defender).toBe(expected);
    }
  });

  it("⚠️ …but NOT the storage: a §9 lock kills the ability half and not the attack half", () => {
    // Spiritomb sv02-089 "Fettered in Misfortune" ("Basic Pokémon V in play … have
    // no Abilities") is the pool's only `disableAbilities` row with no Active-Spot
    // clause on its SOURCE, so it locks from the Bench — which is what lets it
    // reach a body that must be Active to attack. ONE board, both signs:
    //
    //   `fix-azureseas` (a Basic V) loses Azure Seas → 90, the control's number;
    //   `fix-suppressor`'s printed SENTENCE is attack text, which no Ability-lock
    //   addresses → 120, unchanged.
    //
    // A single shared field written by a board scan would have to answer this
    // question once and would get one of the two wrong.
    const locked = (attacker: string) =>
      benchFromDeck(board(attacker, "fix-suppresswall"), "p1", "sv02-089");
    expect(dealt(locked("fix-azureseas"), 0)).toBe(90);
    expect(dealt(locked("fix-suppressor"), IDX.effects)).toBe(120);
    // The control on the same locked board, so the 90 above is the lock and not
    // some other thing this board does.
    expect(dealt(locked("fix-suppressor"), IDX.control)).toBe(90);
  });

  it("the ability rides `passivesOf`, so it travels with the body and needs no stamp", () => {
    // Nothing is written to `InPlayPokemon`: the same fixture read twice on two
    // freshly built boards gives the same answer, and no state field carries it.
    const first = board("fix-azureseas", "fix-suppresswall");
    expect(dealt(first, 0)).toBe(120);
    expect(dealt(board("fix-azureseas", "fix-suppresswall"), 0)).toBe(120);
    expect(first.players.p1.active).not.toHaveProperty("suppressTargetEffectsOnAttack");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The fixtures, whole.
// ─────────────────────────────────────────────────────────────────────────────

describe("the authored fixtures", () => {
  it("carry `fix-suppressor`'s WHOLE attack list, indices and printed text", () => {
    // The whole list, so the fixture cannot be wrong by OMISSION (D156's failure
    // mode) and no later slice indexes into a short one. SYNTHETIC on purpose:
    // every real carrier is in sv05–sv10.5w and `CATALOG_MANIFEST` measures a
    // 978-row / 6-set catalog holding none of them.
    expect(FIXTURE_POOL["fix-suppressor"]?.attacks).toEqual([
      { cost: ["Colorless"], name: "Shred", damage: 60, effect: S_EFFECTS },
      { cost: ["Colorless"], name: "Rock Hurl", damage: 60, effect: S_RESISTANCE },
      { cost: ["Colorless"], name: "Demolish", damage: 60, effect: S_WR_EFFECTS },
      { cost: ["Colorless"], name: "Yoga Kick", damage: 60, effect: S_WR },
      { cost: ["Colorless"], name: "Tackle", damage: 60 },
      { cost: ["Colorless"], name: "Probe Cut", damage: "60+", effect: S_RESISTANCE },
    ]);
    expect(FIXTURE_POOL["fix-suppressor"]?.types).toEqual(["Fire"]);
  });

  it("carry the two synthetic walls' modifiers and their registry rows", () => {
    expect(FIXTURE_POOL["fix-suppresswall"]?.weaknesses).toEqual([{ type: "Fire", value: "×2" }]);
    expect(FIXTURE_POOL["fix-suppresswall"]?.resistances).toBeNull();
    expect(FIXTURE_POOL["fix-resistwall"]?.resistances).toEqual([{ type: "Fire", value: "-30" }]);
    expect(FIXTURE_POOL["fix-resistwall"]?.weaknesses).toBeNull();
    for (const id of ["fix-suppresswall", "fix-resistwall"] as const) {
      expect(programFor(id)?.passive).toEqual({ damageReductionAfterWR: 30 });
    }
  });

  it("⚠️ the index-5 PROBE stays LOUD: the clause explains no `+` MODIFIER", () => {
    // `effectSimulated` gained a term at D192 and `modifierSimulated` deliberately
    // did NOT. All 34 legal printings of this clause sit on a flat printed damage,
    // so no catalog board can reach this question; the probe is what makes the
    // answer assertable. The row must name the MODIFIER as the unexplained part
    // while the effect text is resolved — a build that folded the new reader into
    // `modifierSimulated` by default emits nothing here.
    const skipped = find(
      swing(board("fix-suppressor", "fix-bigbody"), PROBE).events,
      "ATTACK_EFFECT_SKIPPED",
    );
    expect(skipped).toMatchObject({ attack: "Probe Cut", damageModifier: "+" });
    // …and the sentence is still READ: the Resistance suppression really fires on
    // the same declaration, so this is a modifier the shape cannot explain and not
    // a sentence it cannot parse.
    expect(dealt(board("fix-suppressor", "fix-resistwall"), PROBE)).toBe(30);
  });

  it("emit NO ATTACK_EFFECT_SKIPPED — all five declarations are simulated", () => {
    // The loud path is the engine's honesty channel; a sentence this slice claims
    // to read must not also be reported as skipped, and the CONTROL (no text at
    // all) must not be reported either.
    const state = board("fix-suppressor", "fix-suppresswall");
    for (const index of Object.values(IDX)) {
      expect(find(swing(state, index).events, "ATTACK_EFFECT_SKIPPED"), `${index}`).toBeUndefined();
    }
    expect(
      find(swing(board("fix-azureseas", "fix-suppresswall"), 0).events, "ATTACK_EFFECT_SKIPPED"),
    ).toBeUndefined();
  });
});
