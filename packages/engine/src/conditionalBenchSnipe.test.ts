import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "./censusAttackCorpus";
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
import { applyAction } from "./index";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import {
  CONDITIONAL_BENCH_SNIPE_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  trimDeckTo,
  types,
} from "./testFixtures";

// 0.303.0 → 0.304.0 — 🆕🆕 D399: THE TWIN CONSEQUENT, AND THE ARITY THAT WAS A
// LITERAL IN THREE PLACES.
//
// Wo-Chien `sv08-015` (Surging Sparks) "Hazardous Greed" ({G}{C}, **20**, at index
// **0** of TWO) prints *"If there are 3 or fewer cards in your deck, this attack also
// does 120 damage to 2 of your opponent's Benched Pokémon. (Don't apply Weakness and
// Resistance for Benched Pokémon.)"* — 1 legal printing, and D398's clause byte for
// byte under a different consequent.
//
// 🛑 **THE NAMED RISK WAS ALREADY RETIRED, AND CHECKING IT IS WHAT MADE THE SLICE
// BIGGER.** D398 handed this row over with one thing to price first: whether the
// interpreter's pick really takes `count: 2` distinct bodies, *"every shipped
// `damageChosen` in the repo is `count: 1`, so that arity is UNEXERCISED"*. It is
// not. `interpreter.ts` has read `op.count` since M4 — the park is
// `choosePokemonMulti` at `min: take, max: take` over DISTINCT refs with §8.6
// clamping a short Bench — and TWO REGISTRY ROWS have spelled 2 for two hundred
// decisions (Hawlucha's "Flying Entry", Team Rocket's Crobat ex's "Biting Spree").
// ⚠️ **A HANDOFF'S "UNEXERCISED" IS A CLAIM ABOUT THE REPO AND ONE GREP IS CHEAPER
// THAN BELIEVING IT** — D398's own lesson (re-derive the REASON, not the verdict)
// read from the other side.
//
// 🛑 **SO WHAT THIS SLICE BUYS IS THE ARITY, AND THE SHARED FRAGMENT IS WHY.**
// `ALSO_BENCHED_SNIPE_BODY` exists (D383) so ONE printed clause has ONE reading, and
// its count was the literal `1` while the catalog printed 2 on FOUR legal printings.
// A gated anchor spelling its own arity would have shipped an engine that read
// *"If X, this attack also does 120 damage to 2 of…"* while refusing *"This attack
// also does 130 damage to 2 of…"* — contradicting itself about one printed clause on
// the strength of what came before the comma. The capture moves all THREE callers.
//
// **3 sentences / 5 printings.** `BUILT.attack` 1306 → 1311, the nine-reader
// instrument 377 / 1,269 → 380 / 1,274, its residue 263 / 463 → 260 / 458.
//
// WHAT SHIPS: **1 widened capture** in the shared fragment, **1 new anchor**
// (`CONDITIONAL_BENCH_SNIPE`), **1 new `deriveAttackEffect` arm**, **1 threaded
// reader field** (`AttackOptionalCostPayoff.benchSnipe.count`) and **1 fixture**.
// ZERO new state, ops, events, error codes, prompt kinds, choice kinds, exported
// readers, `BoardCondition` members, registry rows, interpreter arms, `redact.ts`
// bytes or `packages/schema` bytes — and `MATCH_RECORD_VERSION` stays **25**, asked
// of the parking op rather than assumed (see §6).

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The nine live readers, run as one — the same set `censusAtHead.test.ts` and
    `deckSizeBonus.test.ts` use. */
const READERS: readonly ((text: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  // 🆕🆕 D419 — the THREE readers this list never had (D381, D403, D417), written
  // in NAME order rather than in landing order because the guard below diffs a
  // SORTED list against the module surface.
  // ⚠️ SPLICED MID-LIST RATHER THAN APPENDED: mutant `find` strings in
  // `scripts/mutation/mutants.ts` quote an array's LAST entries plus its closing
  // `];`, and appending moves that anchor without a character of it changing —
  // the adjacency class D418 paid for once on `stadiumPresence.test.ts`.
  deriveAttackCancelRequirement,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalCostBoost,
  // 🆕🆕 D428 — THE THIRTEENTH, the PRE-DAMAGE Tool discard. ⚠️ SPLICED BEFORE THE
  // LAST ENTRY RATHER THAN APPENDED, D419's rule: mutant `find` strings quote an
  // array's LAST entries plus its closing bracket, and appending moves that anchor
  // without a character of it changing.
  deriveAttackPreDamage,
  deriveAttackBonusConsequent,
];

/** THE SENTENCE THIS SLICE BUYS — Wo-Chien `sv08-015` "Hazardous Greed", 1 legal
    printing, byte-for-byte from the committed corpus. */
const TAKEN =
  "If there are 3 or fewer cards in your deck, this attack also does 120 damage to 2 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const TAKEN_CLAUSE = "there are 3 or fewer cards in your deck";

/** D398's sentence — the SAME antecedent under the OTHER consequent. Kept here as
    well as in `deckSizeBonus.test.ts` because the discrimination this file makes is
    about the PAIR, and a pair asserted in only one of its two homes is one edit away
    from being asserted nowhere. */
const TWIN = "If there are 3 or fewer cards in your deck, this attack does 200 more damage.";

/** The printed control on the SAME body — index 1, no clause, and a sentence
    `deriveAttackEffect` has read for many slices. It is the attack that ARMS the
    clause, which is why it is not inert (see §5). */
const ENTANGLING_WHIP = "Discard the top 3 cards of your deck.";

/** The op the gate carries, spelled once. `deals: true` makes it ATTACK DAMAGE
    rather than placed counters (so a benched reduction passive still applies);
    Weakness and Resistance never apply to a benched target either way (§8.5), which
    is what the printed parenthetical reminds the player of. */
const SNIPE: EffectOp = {
  op: "damageChosen",
  target: "opponentBench",
  amount: 120,
  count: 2,
  source: "attack",
  deals: true,
};

// ── boards ─────────────────────────────────────────────────────────────────────

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** P1 Active is Wo-Chien with THREE {G} attached (enough for both printed costs),
    P2 Active is the 340 HP `fix-titan` Defender, and BOTH benches are emptied
    (`setActiveFromDeck` DISPLACES rather than replaces). Returned on P2's turn so
    `armed` can hand it back with no §4 restriction. */
function ready(seed: number): GameState {
  let state = driveSetup(
    seed,
    { p1: CONDITIONAL_BENCH_SNIPE_DECK, p2: CONDITIONAL_BENCH_SNIPE_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p1", "fix-hazardousgreed");
  state = attachFromDeck(state, "p1", "fix-grass-energy", 3);
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return clearBench(clearBench(state, "p1"), "p2");
}

/** …the same board handed to P1 with the turn already passed, P2's Bench filled with
    `benched` bodies, and P1's deck THEN trimmed to exactly `deck` cards.

    🛑 **THE TRIM COMES LAST, AND THAT ORDERING IS D398's FINDING RE-USED RATHER THAN
    RE-DISCOVERED.** `endTurn` starts P1's turn and a turn starts with a §5.1 DRAW, so
    a deck trimmed to N BEFORE the pass is a deck of N − 1 when the clause is read.
    Every body benched is `fix-titan` (340 HP, no attacks): it survives the 120 so no
    §8.1 Prize tail lands under a damage assertion, and it can never move a number. */
function armed(seed: number, deck: number, benched: number): GameState {
  let state = mustApply(ready(seed), { type: "endTurn", seat: "p2" }).state;
  for (let i = 0; i < benched; i += 1) state = benchFromDeck(state, "p2", "fix-titan");
  return trimDeckTo(state, "p1", deck);
}

// ── §1 ─────────────────────────────────────────────────────────────────────────

describe("§1 — the price, RE-DERIVED off the corpus rather than inherited", () => {
  it("🆕🆕 D419 — the hand-kept READERS list IS the module's reader surface", () => {
    // 🛑 THE GUARD THIS FILE NEVER HAD, IN D417's SHAPE AND D418's WORDING. This
    // copy was hand-kept and NOTHING compared it to what `effects.ts` exports, so
    // it could sit short of the module indefinitely — which is precisely the state
    // `censusAtHead.test.ts` was in before D417 and thirty more files were in after
    // D418. A guard in another file guards that file's copy alone.
    //
    // ⚠️ AND THE FIGURES NO LONGER COME OFF THIS LIST AT ALL. Resolution below is
    // computed through `resolvedByAnyReader` IMPORTED from `censusAttackCorpus.ts`,
    // off the MODULE surface, so no edit here can move a census number again. What
    // survives is a DECLARED EXPECTATION, and this rung is its only remaining job.
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    // ⚠️ THE COUNT IS PINNED SEPARATELY FROM THE DIFF ABOVE, and the separation is
    // load-bearing: a diff alone stays GREEN when a slice deletes a reader from the
    // module and from this list in the SAME commit, and the figures would then move
    // with nothing naming the cause.
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("🛑 the gated sentence is real, is worth ONE printing, and was refused by all nine", () => {
    expect(corpus().filter(([, s]) => s === TAKEN)).toHaveLength(1);
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(1);
    // It shares D398's antecedent BYTE FOR BYTE — the fact the whole discrimination
    // in §4 turns on, asserted rather than eyeballed.
    expect(TAKEN.startsWith(`If ${TAKEN_CLAUSE}, `)).toBe(true);
    expect(TWIN.startsWith(`If ${TAKEN_CLAUSE}, `)).toBe(true);
    expect(TAKEN.slice(`If ${TAKEN_CLAUSE}, `.length)).toBe(
      "this attack also does 120 damage to 2 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    );
  });

  it("🛑 the FOUR ungated printings were refused by a LITERAL and nothing else", () => {
    // 🛑 THE MEASUREMENT THAT TURNED A ONE-PRINTING SLICE INTO A FIVE-PRINTING ONE.
    // The count-2 spelling of the flat rider is TWO sentences worth FOUR printings in
    // the legal attack column, and until this slice every one of them was on the loud
    // ATTACK_EFFECT_SKIPPED path because `ALSO_BENCHED_SNIPE_BODY` spelled `1 of`.
    // Taken off the committed corpus, so the figure cannot rot into a guess.
    const flatTwos = corpus().filter(([, s]) =>
      /^This attack also does \d+ damage to 2 of your opponent's Benched Pokémon\./.test(s),
    );
    expect(flatTwos).toHaveLength(2);
    expect(units(flatTwos)).toBe(4);
    for (const [, s] of flatTwos) expect(resolvedByAnyReader(s), s).toBe(true);
    // …and the whole step this slice makes is those four plus the gated one.
    expect(units(flatTwos) + 1).toBe(5);
  });

  it("🛑 the count-2 arity one anchor over is BUILT, and D401 built the compound beside it too", () => {
    // ⚠️ **THE PRICE OF THE NEXT SLICE, MEASURED HERE — AND D400 THEN SPENT IT.** This
    // rung was written as a HANDOFF: the same literal `1` sat in `CHOSEN_ANY_TARGET`
    // over TWO sentences worth NINE printings, and the rung asserted the population,
    // that both were unresolved, and that exactly one of them (6 printings) carried
    // the plural W/R tail. D400 widened that anchor, so the "unresolved" half went
    // true — and it is RE-HOMED ON A FINER AXIS rather than deleted (D399's rule):
    // the population figure is unchanged and still guards the arithmetic, while the
    // resolution half becomes a DISCRIMINATION between two sentence families that
    // differ only in what comes BEFORE the count.
    const anyTwos = corpus().filter(([, s]) =>
      /^This attack does \d+ damage to [2-9] of your opponent's Pokémon\./.test(s),
    );
    expect(anyTwos).toHaveLength(2);
    expect(units(anyTwos)).toBe(9);
    for (const [, s] of anyTwos) expect(resolvedByAnyReader(s), s).toBe(true);
    // The plural tail is the half that was a READING rather than a capture, and D400
    // settled it by requiring the tail's number to AGREE with the count.
    expect(anyTwos.filter(([, s]) => s.includes("those Pokémon"))).toHaveLength(1);
    expect(units(anyTwos.filter(([, s]) => s.includes("those Pokémon")))).toBe(6);
    // 🛑 THE FINER AXIS: the SAME rider at the SAME arity, behind a leading discard.
    // ⚠️ **RE-POINTED AT D401, NOT DELETED, AND THE DISCRIMINATION SURVIVES THE
    // BUILD.** D399 wrote this half as "still refused by all nine" and said why: a
    // count capture structurally cannot move these, because they are off the
    // `^This attack does` anchor. That remains exactly true — what read them at D401
    // is a SECOND whole-sentence anchor, not a wider first one — so the population
    // stands and the resolution flips, which is the same re-homing D400 did to this
    // rung's own predecessor one slice back.
    const compounds = corpus().filter(([, s]) =>
      /^Discard .* This attack does \d+ damage to [2-9] of your opponent's Pokémon\./.test(s),
    );
    expect(compounds).toHaveLength(2);
    expect(units(compounds)).toBe(4);
    for (const [, s] of compounds) expect(resolvedByAnyReader(s), s).toBe(true);
    // …and the axis that still discriminates: the compound's reading is TWO ops, the
    // bare rider's is ONE. A reader that had widened `CHOSEN_ANY_TARGET` into a prefix
    // match would pass every line above this one and drop a printed Energy cost.
    for (const [, s] of compounds) expect(deriveAttackEffect(s), s).toHaveLength(2);
  });
});

// ── §2 ─────────────────────────────────────────────────────────────────────────

describe("§2 — the READING: one gate, one op, and the arity read off the sentence", () => {
  it("🛑 the printed sentence derives to a conditionGate over D398's member", () => {
    expect(deriveAttackEffect(TAKEN)).toEqual([
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "conditionGate", cond: { kind: "yourDeckAtMost", count: 3 }, then: [SNIPE] },
    ]);
  });

  it("🛑 there is NO `otherwise` arm, and its absence is the printed base's", () => {
    // D135's rule: a field that means nothing on one arm is worse than no field. The
    // printed 20 rides the attack's own `damage` and lands whatever the clause says,
    // so the NO arm genuinely buys nothing — an empty array here would be a branch
    // claiming otherwise, and §3 drives the board that proves the 20 is unmoved.
    const [gate] = deriveAttackEffect(TAKEN) ?? [];
    if (gate?.op !== "conditionGate") throw new Error("expected a conditionGate");
    expect(gate.otherwise).toBeUndefined();
    expect(Object.hasOwn(gate, "otherwise")).toBe(false);
  });

  it("🛑 BOTH numbers are CAPTURED — the amount and the count, at values no printing shares", () => {
    // The guard against a reader that remembered Wo-Chien's numbers instead of
    // reading them. Neither 55 nor 3 is printed on this skeleton anywhere.
    expect(
      deriveAttackEffect(
        "If there are 3 or fewer cards in your deck, this attack also does 55 damage to 3 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "yourDeckAtMost", count: 3 },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ ...SNIPE, amount: 55, count: 3 }],
      },
    ]);
  });

  it("🛑 a printed 0 in EITHER position stays on the loud path", () => {
    for (const text of [
      "If there are 3 or fewer cards in your deck, this attack also does 0 damage to 2 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "If there are 3 or fewer cards in your deck, this attack also does 120 damage to 0 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("🛑 the fixture's printed bytes ARE the corpus's — the fixture cannot drift off the card", () => {
    // D183's rule: an arm written from a paraphrase passes a test written against the
    // same paraphrase and matches no real card. The fixture transcribes tcgdex; the
    // corpus transcribes D1; this line is where the two are required to agree.
    expect(corpus().some(([, s]) => s === TAKEN)).toBe(true);
  });
});

// ── §3 ─────────────────────────────────────────────────────────────────────────

describe("§3 — the count-2 pick on a real board: two DISTINCT bodies, §8.6-clamped", () => {
  it("🛑 the gate is FALSE on a full deck — the printed 20 lands and nothing parks", () => {
    const { state: done, events } = mustApply(armed(3900, 40, 3), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(findAll(events, "DAMAGE_DEALT")).toHaveLength(1);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", base: 20, dealt: 20 });
    expect(done.players.p2.active?.damage).toBe(20);
    for (const body of done.players.p2.bench) expect(body.damage).toBe(0);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 on a SHORT deck it parks for EXACTLY 2 of 3, and the third body takes nothing", () => {
    // The rung the whole slice is about. `min` AND `max` are 2 — the printed number
    // is a floor as well as a ceiling — so a Bench of three is a real decision and
    // the unchosen body is the control that makes "2" mean 2 rather than "all".
    const { state: parked, events } = mustApply(armed(3901, 3, 3), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", base: 20, dealt: 20 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect([prompt.min, prompt.max]).toEqual([2, 2]);
    expect(prompt.candidates).toHaveLength(3);
    expect(prompt.declinable).toBe(false);
    expect(prompt.note).toContain("Choose 2");
    expect(prompt.note).toContain("120 damage");
    const { state: done, events: e2 } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "pokemonMulti",
        refs: [prompt.candidates[0] as PokemonRef, prompt.candidates[1] as PokemonRef],
      },
    });
    // TWO hits, DAMAGE_DEALT rather than COUNTERS_PLACED, flat (no W/R on a Bench).
    expect(types(e2)).not.toContain("COUNTERS_PLACED");
    const dealt = findAll(e2, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(2);
    for (const row of dealt) expect(row).toMatchObject({ base: 120, weakness: null, dealt: 120 });
    expect(done.players.p2.bench.map((b) => b.damage)).toEqual([120, 120, 0]);
    expect(done.players.p2.active?.damage).toBe(20);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 the two picks must be DISTINCT — the same body twice is refused", () => {
    // The half `count: 2` could get wrong without moving any total: 240 on one body.
    // `validateChoice` refuses it against the PARKED prompt, so a crafted frame walks
    // into an error rather than into a double hit.
    const parked = mustApply(armed(3902, 3, 3), { type: "attack", seat: "p1", index: 0 }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const one = prompt.candidates[0] as PokemonRef;
    const twice = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [one, one] },
    });
    expect(twice.ok).toBe(false);
    // …and so is a SHORT answer: the printed 2 is a floor, so one body is not "some".
    const short = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [one] },
    });
    expect(short.ok).toBe(false);
    // …and so is the empty one — this sentence prints no "you may".
    const none = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [] },
    });
    expect(none.ok).toBe(false);
  });

  it("🛑 a Bench of exactly 2 AUTO-TAKES both — no decision is left, so no prompt", () => {
    const { state: done, events } = mustApply(armed(3903, 3, 2), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(done.players.p2.bench.map((b) => b.damage)).toEqual([120, 120]);
    expect(done.players.p2.active?.damage).toBe(20);
  });

  it("🛑 a Bench of ONE is §8.6's 'do as much as you can' — one hit, not a refusal", () => {
    // The arity's sharpest board and the one a count-1 engine could never reach: the
    // printed 2 is clamped to the candidates rather than refusing the whole rider.
    const { state: done, events } = mustApply(armed(3904, 3, 1), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(findAll(events, "DAMAGE_DEALT")).toHaveLength(2); // the 20 and one 120
    expect(done.players.p2.bench.map((b) => b.damage)).toEqual([120]);
    expect(done.players.p2.active?.damage).toBe(20);
  });

  it("🛑 an EMPTY Bench whiffs the rider and keeps the printed 20", () => {
    const { state: done, events } = mustApply(armed(3905, 3, 0), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(findAll(events, "DAMAGE_DEALT")).toHaveLength(1);
    expect(done.players.p2.active?.damage).toBe(20);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("never mutates the state it was given (purity — through the auto-take arm)", () => {
    const state = armed(3906, 3, 2);
    deepFreeze(state);
    expect(() => applyAction(state, { type: "attack", seat: "p1", index: 0 })).not.toThrow();
  });
});

// ── §4 ─────────────────────────────────────────────────────────────────────────

describe("§4 — the DISCRIMINATION, on both axes, so neither saturation can imitate it", () => {
  it("🛑 SAME clause, two consequents, two READERS — and each declines the other's sentence", () => {
    // 🛑 D379's SATURATION TRAP, AND THE AXIS D398's VERSION OF THIS RUNG USED TO
    // OWN. That slice required the twin to be refused by everything; this one built
    // it, so the discrimination is re-homed rather than dropped. The two printed
    // sentences differ ONLY in the consequent, and the consequent alone routes them
    // to two different readers. A reader that answered everything fails the two
    // refusal halves; one that answered nothing fails the two acceptance halves.
    expect(deriveAttackEffect(TAKEN)).not.toBeNull();
    expect(deriveAttackDamageBonus(TAKEN)).toBeNull();
    expect(deriveAttackDamageBonus(TWIN)).not.toBeNull();
    expect(deriveAttackEffect(TWIN)).toBeNull();
    // …and BOTH answers carry the SAME member, which is what "the clause is shared"
    // means operationally: one vocabulary table, consulted from two skeletons.
    const [gate] = deriveAttackEffect(TAKEN) ?? [];
    if (gate?.op !== "conditionGate") throw new Error("expected a conditionGate");
    expect(gate.cond).toEqual({ kind: "yourDeckAtMost", count: 3 });
    expect(deriveAttackDamageBonus(TWIN)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "yourDeckAtMost", count: 3 },
    });
  });

  it("🛑 SAME consequent, an UNMAPPED clause — the sentence stays LOUD", () => {
    // The other axis, and the one that keeps `(.+)` from being a licence: the
    // antecedent is a real printed clause in every case below and NONE of them is in
    // `CONDITIONAL_DAMAGE_CLAUSES`, so the whole sentence must return null. Flamigo's
    // is the sharpest — this file's arm is the reason that sentence's refusal moved
    // from the SHAPE to the CLAUSE, and `alsoBenchedSnipe.test.ts` says so.
    const unmapped = [
      "Flamigo is on your Bench",
      "your opponent's Active Pokémon is a Tera Pokémon",
      "you have any Tera Pokémon on your Bench",
      "your opponent has any Future Pokémon in play",
    ];
    for (const clause of unmapped) {
      const printed = `If ${clause}, this attack also does 120 damage to 2 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)`;
      expect(deriveAttackEffect(printed), clause).toBeNull();
      expect(resolvedByAnyReader(printed), clause).toBe(false);
    }
    // …and the SAME skeleton with the MAPPED clause is read, in the same case, so
    // this is a discrimination and not four independent absences.
    expect(deriveAttackEffect(TAKEN)).not.toBeNull();
  });

  it("🛑 no OTHER reader claims the gated sentence, so nothing was widened by accident", () => {
    for (const read of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(TAKEN), read.name).toBeNull();
    }
  });

  it("🛑 a SECOND sentence after the period is refused — the anchor is whole at BOTH ends", () => {
    // 🛑 **THE RUNG THE MUTATION HARNESS ASKED FOR, AND THE REASON IT HAD TO.** The
    // first version of this section drove the `$` with a TRAILING-CLAUSE near-miss
    // (*"…Benched Pokémon that has any damage counters on it."*) and `--decision D399`
    // reported the terminator mutant SURVIVED. The near-miss was refused one level
    // down: the shared BODY ends in a literal `\.` right after *Pokémon*, so a
    // sentence that CONTINUES there never reaches the anchor's `$` at all. ⚠️ **A
    // NEAR-MISS THAT THE FRAGMENT ALREADY REFUSES PROVES NOTHING ABOUT THE ANCHOR
    // WRAPPED AROUND IT** — the only string that can reach a whole-sentence
    // terminator is one the fragment matches ENTIRELY and that then keeps going, i.e.
    // a COMPOUND. Both spellings are driven, with and without the optional clarifier,
    // because the clarifier group is where a prefix match would otherwise stop.
    //
    // The defect a prefix match would ship is `deriveAttackBonusConsequent`'s own
    // stated one, one reader over: it would swallow the damage and silently DROP the
    // second sentence, so a printed discard would vanish rather than stay loud.
    for (const compound of [
      `${TAKEN} ${ENTANGLING_WHIP}`,
      "If there are 3 or fewer cards in your deck, this attack also does 120 damage to 2 of your opponent's Benched Pokémon. Discard the top 3 cards of your deck.",
    ]) {
      expect(deriveAttackEffect(compound), compound).toBeNull();
      expect(resolvedByAnyReader(compound), compound).toBe(false);
    }
    // …and the same string with the tail removed IS read, in the same case, so what
    // refuses the compound is the terminator and not the clause or the consequent.
    expect(deriveAttackEffect(TAKEN)).not.toBeNull();
  });

  it("🛑 the neighbouring benched shapes keep their OWN ops behind the same clause", () => {
    // The CONSEQUENT is a whole clause, so the sibling spellings must not be swallowed
    // by it. `each of` is a spread, `2 of your opponent's Pokémon` is the any-target
    // snipe (a different op), `your Benched` is a self-target, and a trailing clause
    // continues where the body's own `\.` ends. All four carry a MAPPED antecedent
    // here, so what refuses them is the consequent alone. ⚠️ **THESE FOUR TEST THE
    // SHARED BODY, NOT THE ANCHOR'S TERMINATOR** — the case above is the one that
    // tests that, and conflating the two is what the harness caught.
    //
    // 🛑🛑 **THE FOURTH ROW'S REFUSAL CHANGED MECHANISM AT D437 AND THE ASSERTION DID
    // NOT, WHICH IS EXACTLY THE SHAPE OF D436's GAP.** When this case was written the
    // trailing clause was refused ONE LEVEL DOWN: `ALSO_BENCHED_SNIPE_BODY` ended in a
    // literal `\.` right after *Pokémon*, so a sentence that CONTINUED there never
    // reached this anchor at all. D437 widened that fragment — the clause is now its
    // THIRD capture — so the string MATCHES the body, and what refuses it is the gated
    // arm's NUMBER AGREEMENT: *"that has … on it"* is singular and may only ride
    // *"1 of"*. **BOTH refusals are true; only one of them is still the reason**, and
    // a rung that merely kept saying `toBeNull()` would be TRUE-BUT-TOOTHLESS if a
    // build forgot the new guard (D418's second half). Two things re-arm it:
    //   • the ADMISSION directly below — the SAME consequent at `1 of` IS read, and it
    //     carries `damagedOnly`, so this loop's fourth row is now a claim about the
    //     NUMBER rather than about the clause;
    //   • the mutant `D437-gated-agreement-dropped`, which drops that guard and is
    //     killed BY THIS FILE. The tripwire is re-armed where it lives rather than
    //     replaced by a new one in the new slice's own suite (D384's rule, which D436
    //     broke by re-pointing seven rungs and never asking what a MUTANT rested on).
    for (const consequent of [
      "this attack also does 30 damage to each of your opponent's Benched Pokémon.",
      "this attack also does 30 damage to 2 of your opponent's Pokémon.",
      "this attack also does 30 damage to 2 of your opponent's Benched Pokémon that has any damage counters on it.",
    ]) {
      expect(deriveAttackEffect(`If ${TAKEN_CLAUSE}, ${consequent}`), consequent).toBeNull();
    }
    // 🛑🛑 **D447 — THE THIRD ROW LEFT THIS LOOP, AND THE REASON IS THE PARAGRAPH
    // ABOVE HAPPENING A SECOND TIME.** *"2 of YOUR Benched Pokémon"* was refused as a
    // SELF-TARGET; the shared body reads the possessive as its group 3 now, so the
    // gated arm returns the same `conditionGate` with `target: "yourBench"`. Keeping
    // `toBeNull()` would have pinned a refusal the engine no longer makes (D444), and
    // deleting the row outright would have thrown away the only place the gated
    // caller's SIDE is observable. It is an ADMISSION now, with the side asserted —
    // which is what re-arms it against `D447-gated-caller-drops-the-side`.
    expect(
      deriveAttackEffect(`If ${TAKEN_CLAUSE}, this attack also does 30 damage to 2 of your Benched Pokémon.`),
    ).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "yourDeckAtMost", count: 3 },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          { op: "damageChosen", target: "yourBench", amount: 30, count: 2, source: "attack", deals: true },
        ],
      },
    ]);
    // 🆕🆕 D437 — THE ADMISSION, one axis from the fourth row above: the same clause at
    // the arity it is printed against IS read, through the shared fragment's new
    // capture, and the op carries the narrowing. No card prints this composition; the
    // reading is stated because a fragment with three callers owes three readings.
    expect(
      deriveAttackEffect(
        `If ${TAKEN_CLAUSE}, this attack also does 30 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it.`,
      ),
    ).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "yourDeckAtMost", count: 3 },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          {
            op: "damageChosen",
            target: "opponentBench",
            amount: 30,
            count: 1,
            source: "attack",
            deals: true,
            damagedOnly: true,
          },
        ],
      },
    ]);
  });
});

// ── §5 ─────────────────────────────────────────────────────────────────────────

describe("§5 — the printing end to end, at the index it is printed at", () => {
  it("🛑 the clause sits at INDEX 0, and INDEX 1 is what ARMS it", () => {
    // 🛑 THE TWO-TURN COMBO THE CARD IS BUILT AROUND, AND THE REASON D306's
    // TRANSCRIBE-WHOLE RULE PAID AGAIN. "Entangling Whip" MILLS three cards off its
    // own deck, so a six-card deck becomes three; the turn passes, P1's §5.1 draw
    // takes it to two, and the clause is then TRUE. Nothing here is synthetic: both
    // numbers come off the printed card.
    expect(deriveAttackEffect(ENTANGLING_WHIP)).toEqual([
      { op: "discardDeckTop", whose: "self", count: 3 },
    ]);
    const start = armed(3907, 6, 3);
    expect(start.players.p1.deck).toHaveLength(6);
    const milled = mustApply(start, { type: "attack", seat: "p1", index: 1 }).state;
    expect(milled.players.p1.deck).toHaveLength(3);
    expect(milled.players.p2.active?.damage).toBe(130);
    // Back to P1 — the §5.1 draw takes the deck to two, and the gate is now armed.
    const mine = mustApply(milled, { type: "endTurn", seat: "p2" }).state;
    expect(mine.players.p1.deck).toHaveLength(2);
    const { state: parked, events } = mustApply(mine, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 20, dealt: 20 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "choosePokemonMulti") throw new Error("expected multi");
    expect([parked.phase.prompt.min, parked.phase.prompt.max]).toEqual([2, 2]);
    // …and the Defender has taken BOTH printed hits by now, which is the statement
    // that the two attacks are the same card's and not two fixtures'.
    expect(parked.players.p2.active?.damage).toBe(150);
  });

  it("🛑 index 0 on a full deck is a bare 20 — the index is not the clause", () => {
    // The guard against a card-keyed rather than index-keyed read, from the other
    // side: the same body, the same index, a deck that fails the clause.
    const { state: done } = mustApply(armed(3908, 40, 3), { type: "attack", seat: "p1", index: 0 });
    expect(done.players.p2.active?.damage).toBe(20);
    expect(done.players.p2.bench.map((b) => b.damage)).toEqual([0, 0, 0]);
  });
});

// ── §6 ─────────────────────────────────────────────────────────────────────────

describe("§6 — the questions this slice had to ask and answer NO to", () => {
  it("🛑 the parking op gains NO field, which is why MATCH_RECORD_VERSION stays 25", () => {
    // `damageChosen` rides `GameState.phase.cont.pendingOp` while its pick is open —
    // its own doc block records that adding a REQUIRED field cost MATCH_RECORD_VERSION
    // 2 → 3. This slice adds none: `count` has been required since M4 and the VALUE 2
    // was already authored by two registry rows, so a v25 record can already hold this
    // op and means exactly what it meant. Driven off the parked op rather than argued.
    const parked = mustApply(armed(3909, 3, 3), { type: "attack", seat: "p1", index: 0 }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const pending = parked.phase.cont.pendingOp;
    expect(pending).toEqual(SNIPE);
    expect(Object.keys(pending ?? {}).sort()).toEqual(
      ["amount", "count", "deals", "op", "source", "target"].sort(),
    );
  });

  it("🛑 the gate itself never reaches the wire — a conditionGate resolves inline", () => {
    // The other half of the same question. `runProgram` splices a gate's branch into
    // the work queue it is already walking, so the CONDITION is gone by the time
    // anything parks: what a record could carry is the op above and nothing else.
    const parked = mustApply(armed(3910, 3, 3), { type: "attack", seat: "p1", index: 0 }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(JSON.stringify(parked.phase.cont)).not.toContain("conditionGate");
    expect(JSON.stringify(parked.phase.cont)).not.toContain("yourDeckAtMost");
  });
});
