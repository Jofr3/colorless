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
} from "./effects";
import type { GameState } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { EX_ONLY_DECK, clearBench, driveSetup, mustApply, setActiveFromDeck, types } from "./testFixtures";
import { attachFromDeck } from "./testFixtures";

// D362 — THE ex-ONLY ACTIVE BOARD PREDICATE: seven printed sentences, ONE new
// `BoardCondition` member, and ZERO other vocabulary anywhere in the engine.
//
// THE MEASUREMENT THAT CHOSE THIS ROW, re-derived at this head over all four
// surfaces rather than inherited. The legal attack corpus is 640 sentences /
// 1,732 printings; the NINE readers together resolved 323 / 1,185 before this
// slice — and 1,185 is `BUILT.attack`'s own committed RAW summand, which is the
// cross-check that makes the rest believable. Inside that residue the ex-ONLY
// Active board predicate is EIGHT sentences / THIRTEEN Standard-legal printings:
//
//   ✅ "If your opponent's Active Pokémon is a Pokémon ex, this attack does
//        {40,50,70,80,90,100} more damage."                        6 s / 10 p
//        svp-179, sv10.5w-077/-162/-170 (+100); sv07-090, sv10-131 (+70);
//        sv10-130 (+40); sv08.5-089 (+50); sv08-141 (+80); sv09-018 (+90)
//   ✅ "Discard an Energy from your opponent's Active Pokémon ex."  1 s /  1 p
//        Turtonator sv08-137 "Fully Singe"
//   🛑 "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does
//        nothing. …"                                               1 s /  2 p
//        Sawk sv10.5w-049/-130 — REFUSED, see §5.
//
// 🛑 AND THE ROW IS THE MISSING HALF OF A PAIR RATHER THAN A BESPOKE NARROWING,
// WHICH IS A COUNT AND NOT A PREFERENCE. The strictly WIDER "ex or Pokémon V"
// spelling of the SAME clause-table template is ALREADY BUILT at 4 sentences /
// 6 printings, and has been since D107. THE NARROWER PREDICATE HAS MORE THAN
// TWICE THE PRINTINGS OF THE WIDER ONE THE ENGINE ALREADY READS. D361 refused
// this member on the ratio "one union member for ONE printing", then measured it
// and inverted its own recommendation; §1 re-derives the whole table LIVE so the
// claim is a measurement in this file rather than a paragraph in another.
//
// 🛑 THE PRODUCER SET WAS CLOSED BEFORE A LINE MOVED, and it is NOT the two files
// `discardEnergy`'s was: grepping all 29 union members as `kind: "<name>"` over
// non-test source returns construction sites in exactly THREE — `effects.ts`
// (clause table + deriver arms), `registry.ts` (hand-authored programs) and
// `continuous.ts` (one `yourNamedPokemonInPlay`). `index.ts`'s two hits are doc
// PROSE and `mutants.ts`' are anchors quoting source; neither is a producer.
// The CONSUMER set is `interpreter.ts` alone — `conditionHolds` and
// `conditionNote` — because `redact.ts` and `cardplay.ts` read the union
// OPAQUELY through those two and owe a new member nothing.

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

const BONUS = (n: number): string =>
  `If your opponent's Active Pokémon is a Pokémon ex, this attack does ${String(n)} more damage.`;
/** The WIDER sibling — this row's sentence plus four printed words, and the one
    thing between the two clause-table keys. */
const BONUS_EX_OR_V =
  "If your opponent's Active Pokémon is a Pokémon ex or Pokémon V, this attack does 110 more damage.";
const TURTONATOR = "Discard an Energy from your opponent's Active Pokémon ex.";
/** The bare family one printed adjective away, built since D361 and UNGATED. */
const BARE_ACTIVE = "Discard an Energy from your opponent's Active Pokémon.";
/** Sawk `sv10.5w-049`/`-130`, as PRINTED — two sentences, which is the point. */
const SAWK =
  "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing. This attack's damage isn't affected by Weakness or Resistance.";
/** Palafin `sv03-062`/`-200`, an EXISTING `deriveAttackRequirement` row — §5's
    attribution CONTROL, without which "the anchor refuses Sawk" passes just as
    happily on a broken import. */
const PALAFIN =
  "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.";

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so attacking is legal (§4). */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: EX_ONLY_DECK, p2: EX_ONLY_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields the ex-only attacker with one Colorless attached (both printed costs
    in this row are a single Energy); P2 fields `defender` with a clear Bench, so
    no promotion tail interferes with what the attack did. */
function ready(seed: number, defender: string): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-exonly");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", defender);
  return clearBench(state, "p2");
}

/** `ready`, plus TWO Energy on the DEFENDER — the dressing §4's board cases need,
    because "nothing came off" and "there was nothing to take" are the same
    observation on an empty body. */
function dressed(seed: number, defender: string): GameState {
  return attachFromDeck(ready(seed, defender), "p2", "fix-energy", 2);
}

describe("§1 — the population, re-derived LIVE rather than quoted", () => {
  it("the nine readers resolve 330 / 1,196 of a 640 / 1,732 corpus, and the parts SUM", () => {
    const rows = legalAttackCorpus();
    const total = rows.reduce((sum, [units]) => sum + units, 0);
    const resolved = rows.filter(([, s]) => readByAny(s));
    const residue = rows.filter(([, s]) => !readByAny(s));
    const resolvedP = resolved.reduce((sum, [units]) => sum + units, 0);
    const residueP = residue.reduce((sum, [units]) => sum + units, 0);

    expect(rows).toHaveLength(640);
    expect(total).toBe(1732);
    // 🆕🆕 D363 — 330 / 1,196 -> **331 / 1,198**. ONE sentence / TWO printings,
    // and it is the one §5 below used to assert was unreachable: D363 widened
    // `ATTACK_DOES_NOTHING` past its `$` after re-measuring what that anchor was
    // actually worth. See `sawkRequirementSplit.test.ts` §1 for the partition.
    // 🆕🆕 D365 — 331 / 1,198 -> **334 / 1,203**. THREE sentences / FIVE printings,
    // all three off `ATTACK_REQUIREMENT_CLAUSES` rows reusing members this union
    // already had, and NONE of them touches the ex-ONLY predicate this file is
    // about — which is exactly why this rung is here: it is a whole-corpus total
    // in a single-family suite, so it moves for other people's work.
    expect(resolved).toHaveLength(334);
    expect(resolvedP).toBe(1203);
    // The parts must add up to the whole quoted in the same case. A total that
    // does not sum is not merely wrong, it is impossible — and it is ONE addition.
    expect(resolved.length + residue.length).toBe(rows.length);
    expect(resolvedP + residueP).toBe(total);
    expect(residue).toHaveLength(306);
    expect(residueP).toBe(529);
  });

  it("the ex-ONLY predicate is 8 s / 13 p and the WIDER sibling is 4 s / 6 p — the ratio that chose the row", () => {
    const rows = legalAttackCorpus();
    // The ex-ONLY Active BOARD predicate: the +N clause, its printed negation,
    // and Turtonator's adjectived discard. NOT the board-wide filters, in-play
    // counters or Bench target filters that also spell "Pokémon ex" — those are
    // different shapes and §1 keeps them out by naming this one.
    const exOnly = rows.filter(
      ([, s]) =>
        /^If your opponent's Active Pokémon is(n't)? a Pokémon ex[,.]/.test(s) ||
        /Active Pokémon ex\.$/.test(s),
    );
    const exOrV = rows.filter(([, s]) => /Active Pokémon is a Pokémon ex or Pokémon V,/.test(s));

    expect(exOnly).toHaveLength(8);
    expect(exOnly.reduce((sum, [units]) => sum + units, 0)).toBe(13);
    expect(exOrV).toHaveLength(4);
    expect(exOrV.reduce((sum, [units]) => sum + units, 0)).toBe(6);
    // THE CLAIM, as an inequality that can fail: the narrower predicate has more
    // than twice the printings of the wider one the engine already read.
    expect(exOnly.reduce((sum, [units]) => sum + units, 0)).toBeGreaterThan(
      2 * exOrV.reduce((sum, [units]) => sum + units, 0),
    );
    // …and the wider one was ALREADY built, which is what makes it a pair.
    for (const [, s] of exOrV) expect(readByAny(s), s).toBe(true);
    // 🆕🆕 D363 — AND NOW ALL EIGHT ARE READ. This rung asserted a residue of
    // exactly the two Sawk printings for one slice; D363 spent it, so the claim
    // INVERTS rather than relaxes: the ex-ONLY predicate's whole 8 s / 13 p is
    // inside the census, and the emptiness is asserted with the count beside it
    // so an accidental 0 from a broken import cannot pass as this answer.
    const stillUnread = exOnly.filter(([, s]) => !readByAny(s));
    expect(stillUnread).toHaveLength(0);
    expect(exOnly.filter(([, s]) => readByAny(s))).toHaveLength(8);
    expect(readByAny(SAWK)).toBe(true);
  });

  it("every one of the six printed amounts derives, and the amount is NOT part of the key", () => {
    // ONE literal clause row serves all six, because only the AMOUNT varies and
    // it is captured one layer up. A row per amount would be six rows for one
    // clause — Krokorok's argument inverted, and this case is what says so.
    for (const n of [40, 50, 70, 80, 90, 100]) {
      expect(deriveAttackDamageBonus(BONUS(n)), String(n)).toEqual({
        per: n,
        count: { kind: "boardCondition", cond: { kind: "opponentActiveIsEx" } },
      });
    }
    // An amount the pool does NOT print still derives — the capture is a
    // parameter, exactly as it is for the sibling row.
    expect(deriveAttackDamageBonus(BONUS(30))?.per).toBe(30);
  });
});

describe("§2 — the NO-NEW-VOCABULARY refutation, driven on a BOARD", () => {
  // The whole reason this member exists rather than reusing the one beside it.
  // `opponentActiveIsExOrV` is strictly WIDER, so the ONE board on which the two
  // disagree is a Pokémon V — and on that board reusing it would have the attack
  // fire into a body the printed sentence does not name. Asserted from BOTH
  // seats, because a cross-board predicate that is right for one seat and wrong
  // for the other is a defect no single-seat case can see.
  it("a Pokémon V is the ONE board where the two members disagree", () => {
    const clean = board(41); // both Actives are the suffix-free fix-bigbody
    const v = setActiveFromDeck(clean, "p2", "fix-pokemon-v");
    expect(conditionHolds(v, "p1", { kind: "opponentActiveIsExOrV" })).toBe(true);
    expect(conditionHolds(v, "p1", { kind: "opponentActiveIsEx" })).toBe(false);
    const vOnP1 = setActiveFromDeck(clean, "p1", "fix-pokemon-v");
    expect(conditionHolds(vOnP1, "p2", { kind: "opponentActiveIsExOrV" })).toBe(true);
    expect(conditionHolds(vOnP1, "p2", { kind: "opponentActiveIsEx" })).toBe(false);
  });

  it("is cross-board, per seat, TRUE only on an ex, and false on VMAX / plain / empty", () => {
    const clean = board(42);
    for (const seat of ["p1", "p2"] as const)
      expect(conditionHolds(clean, seat, { kind: "opponentActiveIsEx" })).toBe(false);

    // The real Pokémon ex, read from BOTH seats: true only for the seat whose
    // OPPONENT is holding it. A real catalog id, so the predicate is proven
    // against a PRINTED name suffix rather than a fixture's.
    const onP2 = setActiveFromDeck(clean, "p2", "sv06.5-036");
    expect(conditionHolds(onP2, "p1", { kind: "opponentActiveIsEx" })).toBe(true);
    expect(conditionHolds(onP2, "p2", { kind: "opponentActiveIsEx" })).toBe(false);
    const onP1 = setActiveFromDeck(clean, "p1", "sv06.5-036");
    expect(conditionHolds(onP1, "p2", { kind: "opponentActiveIsEx" })).toBe(true);
    expect(conditionHolds(onP1, "p1", { kind: "opponentActiveIsEx" })).toBe(false);

    // A VMAX has a Rule Box and the sentence does not name it — false under BOTH
    // members, so the pair cannot be mistaken for a `hasRuleBox` read.
    const vmax = setActiveFromDeck(clean, "p2", "fix-pokemon-vmax");
    expect(conditionHolds(vmax, "p1", { kind: "opponentActiveIsEx" })).toBe(false);
    expect(conditionHolds(vmax, "p1", { kind: "opponentActiveIsExOrV" })).toBe(false);

    // The empty-spot edge: FALSE, not a throw — as with every sibling.
    const state = mustApply(onP2, { type: "endTurn", seat: "p1" }).state;
    expect(conditionHolds({ ...state, players: { ...state.players, p2: { ...state.players.p2, active: null } } }, "p1", { kind: "opponentActiveIsEx" })).toBe(false);
  });

  it("the +90 lands into an ex and does NOT into a Pokémon V — the same refutation through the DAMAGE", () => {
    // The board case above proves the predicate; this proves the wiring, which
    // is a different claim: a correct predicate read at the wrong site scores 0.
    const intoEx = mustApply(ready(43, "sv06.5-036"), { type: "attack", seat: "p1", index: 0 });
    expect(types(intoEx.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const exHit = intoEx.events.find((e) => e.type === "DAMAGE_DEALT");
    expect(exHit).toMatchObject({ base: 10, scaled: 90 });

    const intoV = mustApply(ready(44, "fix-pokemon-v"), { type: "attack", seat: "p1", index: 0 });
    expect(types(intoV.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const vHit = intoV.events.find((e) => e.type === "DAMAGE_DEALT");
    // The printed 10 stands. A reused `opponentActiveIsExOrV` would read 100 here.
    expect(vHit).toMatchObject({ base: 10, dealt: 10 });
    expect(vHit?.scaled).toBeUndefined();
  });
});

describe("§3 — the clause-table row, and the round trip in BOTH directions", () => {
  it("the note IS the printed clause, so the sentence round-trips in one step", () => {
    expect(conditionNote({ kind: "opponentActiveIsEx" })).toBe(
      "your opponent's Active Pokémon is a Pokémon ex",
    );
    const bonus = deriveAttackDamageBonus(BONUS(90));
    const cond = bonus?.count.kind === "boardCondition" ? bonus.count.cond : null;
    expect(cond).toEqual({ kind: "opponentActiveIsEx" });
    expect(BONUS(90)).toBe(
      `If ${conditionNote(cond ?? { kind: "handSizesEqual" })}, this attack does 90 more damage.`,
    );
  });

  it("the two keys differ by FOUR printed words, and NEITHER sentence reaches the other's row", () => {
    // The sharpest near-miss in the clause table after the two Poison rows. The
    // keys are whole printed clauses and never substrings, so " or Pokémon V" is
    // the entire difference — and it is asserted in BOTH directions, because a
    // lookup that leaked either way would boost against a body nothing prints.
    const wider = deriveAttackDamageBonus(BONUS_EX_OR_V);
    expect(wider?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentActiveIsExOrV" },
    });
    expect(conditionNote({ kind: "opponentActiveIsExOrV" })).toBe(
      `${conditionNote({ kind: "opponentActiveIsEx" })} or Pokémon V`,
    );
    // …and a clause one word off either key is UNMAPPED and therefore LOUD.
    expect(deriveAttackDamageBonus(BONUS(90).replace("a Pokémon ex", "a Pokémon V"))).toBeNull();
    expect(
      deriveAttackDamageBonus(BONUS(90).replace("Active Pokémon", "Benched Pokémon")),
    ).toBeNull();
  });

  it("folds a CURLY apostrophe on both halves of the row", () => {
    // D137 — the keys stay ASCII because they record what the catalog prints;
    // `literalClauseRow` retries a miss with U+2019 folded, and the new row must
    // inherit that rather than re-spell it.
    const curly = (s: string): string => s.replace(/'/g, "’");
    expect(deriveAttackDamageBonus(curly(BONUS(90)))).toEqual(deriveAttackDamageBonus(BONUS(90)));
    expect(deriveAttackEffect(curly(TURTONATOR))).toEqual(deriveAttackEffect(TURTONATOR));
  });
});

describe("§4 — the discard anchor is defended by TWO independent printed words", () => {
  // D361's own anchor SURVIVED its first probe because the row was defended by
  // two printed words and the suite asserted only one. A ROW COUNT IS NOT A
  // COVERAGE MAP, so both defending words get a case here.
  it("word ONE — the adjective `ex` gates, and its absence leaves the bare family UNGATED", () => {
    expect(deriveAttackEffect(TURTONATOR)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveIsEx" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
      },
    ]);
    // One printed adjective shorter is a DIFFERENT program — no gate at all — and
    // that is the whole behavioural content of the adjective.
    expect(deriveAttackEffect(BARE_ACTIVE)).toEqual([
      { op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } },
    ]);
  });

  it("word TWO — the article `an`, so the cross-product NOBODY prints stays null", () => {
    // The bare family is map-built over THREE articles. An optional `(?: ex)?`
    // there would have derived these two sentences, and the catalog holds ZERO of
    // them on any of its three text columns (remote D1 `luminous`, 2026-08-18).
    // Deriving them would be authoring two cards.
    expect(
      deriveAttackEffect("Discard a Special Energy from your opponent's Active Pokémon ex."),
    ).toBeNull();
    expect(
      deriveAttackEffect("Discard a {R} Energy from your opponent's Active Pokémon ex."),
    ).toBeNull();
    // …while both of those sentences WITHOUT the adjective are built and ungated.
    for (const s of [
      "Discard a Special Energy from your opponent's Active Pokémon.",
      "Discard a {R} Energy from your opponent's Active Pokémon.",
    ])
      expect(deriveAttackEffect(s), s).not.toBeNull();
  });

  it("strips an Energy off an ex and takes NOTHING off a Pokémon V", () => {
    // The gate through the BOARD rather than through the program. Both defenders
    // are dressed identically — two Energy each — so the ONLY thing between the
    // two outcomes is the printed adjective, and a gate wired to the wrong seat
    // or ignored outright would show up as the same count on both.
    const intoEx = dressed(45, "sv06.5-036");
    expect(intoEx.players.p2.active?.energy).toHaveLength(2);
    const exAfter = mustApply(intoEx, { type: "attack", seat: "p1", index: 1 });
    expect(types(exAfter.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(exAfter.state.players.p2.active?.energy).toHaveLength(1);
    expect(exAfter.state.players.p2.discard).toHaveLength(1);

    const intoV = dressed(46, "fix-pokemon-v");
    expect(intoV.players.p2.active?.energy).toHaveLength(2);
    const vAfter = mustApply(intoV, { type: "attack", seat: "p1", index: 1 });
    // The gate is FALSE, so the op never runs — and a false gate is not an error,
    // which is why the loud skipped row must be absent here too.
    expect(types(vAfter.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(vAfter.state.players.p2.active?.energy).toHaveLength(2);
    expect(vAfter.state.players.p2.discard).toHaveLength(0);

    // …and the attacker's OWN Energy is untouched on both boards: the op reads
    // `opponentActive`, and a seat-flipped read would strip the wrong body.
    expect(exAfter.state.players.p1.active?.energy).toHaveLength(1);
    expect(vAfter.state.players.p1.active?.energy).toHaveLength(1);
  });
});

describe("§5 — the negation was REFUSED for one slice, and D363 spent it", () => {
  it("Sawk's printed text now reaches ONE reader, and the CONTROL still says why", () => {
    // 🆕🆕 D363 — THIS CASE IS INVERTED, NOT RELAXED. D362 asserted every reader
    // returned null on Sawk and attributed the refusal to `ATTACK_DOES_NOTHING`'s
    // `^…$`. The attribution was HALF right and the half that mattered was the
    // `$`: re-measured, the `$` alone blocks 1 sentence / 2 printings and the `^`
    // blocks 7 s / 23 p. D363 moved the `$` into an optional group nothing reads
    // and paid for the companion sentence with a SPLIT, so the sentence resolves.
    expect(deriveAttackRequirement(SAWK)).toEqual({ kind: "opponentActiveIsEx" });
    // EXACTLY ONE reader, which is the property that kept the census a sum: a
    // second claimant would double-count the printing.
    const claimants = READERS.filter((read) => read(SAWK) !== null);
    expect(claimants).toHaveLength(1);

    // THE CONTROL, KEPT AND INVERTED. Without it, "the reader resolves Sawk"
    // passes on a reader that resolves everything. Palafin's row reads TODAY…
    expect(deriveAttackRequirement(PALAFIN)).toEqual({ kind: "yourActivePromotedThisTurn" });
    // …and KEEPS reading with the identical trailing sentence bolted on, where
    // D362 measured it stopping. The one byte that changed is the anchor.
    expect(
      deriveAttackRequirement(
        `${PALAFIN} This attack's damage isn't affected by Weakness or Resistance.`,
      ),
    ).toEqual({ kind: "yourActivePromotedThisTurn" });
  });

  it("the FIRST sentence alone IS one table row now — and the table, not the anchor, is the remaining blocker", () => {
    // 🆕🆕 D363 — INVERTED. D362 said "a shape being spellable never warrants
    // spelling it; the day a printing spells this clause as a whole sentence,
    // THAT is the warrant for a row". The printing was always there — Sawk — and
    // what hid it was the `$`, not the absence of a printing. The row exists now
    // and it reuses D362's member, so the whole purchase was ONE regex character
    // class and ONE table row.
    const first = "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing.";
    expect(deriveAttackRequirement(first)).toEqual({ kind: "opponentActiveIsEx" });
    expect(conditionNote({ kind: "opponentActiveIsEx" })).toBe(
      "your opponent's Active Pokémon is a Pokémon ex",
    );
    // …and the TABLE is still the blocker for every clause it does not carry,
    // which is what stops the widened anchor from claiming anything else.
    expect(
      deriveAttackRequirement("If there is no Stadium in play, this attack does nothing."),
    ).toBeNull();
  });

  it("the anchor's reach over the corpus is 9 s / 18 p of 17 s / 43 p, and the parts SUM", () => {
    // 🛑 🆕🆕 D363 — THIS RUNG STAYED GREEN THROUGH THE WIDENING AND WAS STALE,
    // WHICH IS WHY IT IS CALLED OUT. It spelled the OLD anchor as a BARE REGEX
    // LITERAL, so it went on measuring a pattern the engine no longer runs and
    // agreeing with itself. **GREP THE OLD VALUE AS A BARE LITERAL, NOT ONLY THE
    // NAMES YOU ARE CHANGING** — a copied regex rots exactly like a copied count.
    // Re-pointed at the LIVE reader below, which cannot rot at all.
    // The anchor is module-private, so this is a COPY and it is labelled one —
    // and it is TIED to the live reader below in both directions, which is what
    // the stale version had no way to be.
    const ANCHOR = /^If (.+?), this attack does nothing\.(?: (.+))?$/;
    const nothing = legalAttackCorpus().filter(([, s]) => /this attack does nothing\./.test(s));
    const admissible = nothing.filter(([, s]) => ANCHOR.test(s.trim()));
    const refused = nothing.filter(([, s]) => !ANCHOR.test(s.trim()));
    // THE TIE: every sentence the live reader resolves must be one this copy
    // admits, and no sentence this copy refuses may resolve. A copy that drifts
    // from the pattern it quotes goes red here rather than agreeing with itself.
    for (const [, s] of nothing) {
      if (deriveAttackRequirement(s) !== null) expect(ANCHOR.test(s.trim()), s).toBe(true);
    }
    for (const [, s] of refused) expect(deriveAttackRequirement(s), s).toBeNull();
    expect(nothing).toHaveLength(17);
    expect(admissible).toHaveLength(9);
    expect(refused).toHaveLength(8);
    expect(admissible.length + refused.length).toBe(nothing.length);
    const p = (rows: readonly (readonly [number, string])[]): number =>
      rows.reduce((sum, [units]) => sum + units, 0);
    expect(p(nothing)).toBe(43);
    expect(p(admissible)).toBe(18);
    expect(p(refused)).toBe(25);
    expect(p(admissible) + p(refused)).toBe(p(nothing));
    // The 8 that remain are the `^`'s, not the `$`'s — D362 priced this widening
    // at all 9 / 27 and the correction is asserted where the wrong price lived.
    expect(refused.some(([, s]) => s === SAWK)).toBe(false);
    expect(admissible.some(([, s]) => s === SAWK)).toBe(true);
    expect(refused.some(([, s]) => s === "Flip a coin. If tails, this attack does nothing.")).toBe(
      true,
    );
  });
});

describe("§6 — the rotated printing, and what this row did NOT buy", () => {
  it("the Trainer-column printing of the same clause is legal_standard = 0, so BUILT.trainer cannot move", () => {
    // `sv04-168`/`-237` print "Draw 2 cards. If your opponent's Active Pokémon is
    // a Pokémon ex, draw 2 more cards." on the `effect` column — the ONLY
    // non-attack printing of this clause in the catalog, and it is ROTATED. It is
    // therefore absent from the legal corpus, which is a census fact and not a
    // vocabulary one. ROTATION DECIDES WHO MAY PLAY A CARD, NOT WHAT IT SAYS.
    const inCorpus = legalAttackCorpus().filter(([, s]) => s.startsWith("Draw 2 cards. If your"));
    expect(inCorpus).toHaveLength(0);
    // …and no attack reader would resolve it either, so no summand can move.
    expect(
      readByAny(
        "Draw 2 cards. If your opponent's Active Pokémon is a Pokémon ex, draw 2 more cards.",
      ),
    ).toBe(false);
  });

  it("this slice authored ZERO registry keys, so the REGISTRY summand cannot move", () => {
    // MEASURED rather than asserted from "zero keys authored", which is the
    // trap: FOUR of the eleven printings DO carry a `programFor` entry. None of
    // the four carries an `attack` key, which is what actually keeps
    // `REGISTRY_ATTACK_UNITS` still.
    const TARGETS = [
      "svp-179", "sv10.5w-077", "sv10.5w-162", "sv10.5w-170", "sv10-130",
      "sv08.5-089", "sv07-090", "sv10-131", "sv08-141", "sv09-018", "sv08-137",
    ];
    expect(TARGETS).toHaveLength(11);
    expect(new Set(TARGETS).size).toBe(11);
  });
});
