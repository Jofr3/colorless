import { describe, expect, it } from "vitest";
import { deriveAttackEffect, programFor } from "./index";
// `applyAction` is imported as a TYPE only: the illegal-choice case builds a
// deliberately malformed action and casts it through `Parameters<typeof applyAction>[1]`
// so the cast is anchored on the real signature rather than on `any`.
import type {
  EffectOp,
  GameAction,
  GameEvent,
  GameState,
  PokemonRef,
  Seat,
  applyAction,
} from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  COUNTER_BENCH_PUT_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  clearBench,
  deepFreeze,
  driveSetup,
  expectErr,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  types,
} from "./testFixtures";

// 0.88.0 → 0.89.0 — the PUT on the opponent's BENCH (D140). "Put {N} damage
// counters on 1 of your opponent's Benched Pokémon." — 4 printings / 1 clause on
// ONE anchored regex with ONE `(\d+)` capture and ONE deriver arm.
//
// D132's INVENTORY RULE FOR THE FIFTH TIME: `damageChosen { target:
// "opponentBench", count: 1 }` has been authored since M4 slice 8 by Meowscarada
// ex sv02-015's "Bouquet Magic" registry row, at a different amount. So the ACTION,
// the PROMPT and the PARK all existed and only the READER was missing — zero
// `attack.ts`/`flow.ts`/`continuous.ts`/`rng.ts` diff.
//
// WHAT THE RESUME POINT CLAIMED, AND WHAT WAS TRUE (checked against the local D1
// before anything was designed — the standing instruction, and the first two
// describes below ARE the check):
//   • The four ids, the attack NAME "Land Scoop", the INDEX (0 on all four — the
//     card has exactly one attack), 2 counters, the printed damage 150 and the
//     {F}{F}{F} cost — ALL HELD, and all are pinned against the fixture bytes.
//   • "`damageChosen { target: "opponentBench", amount, count: 1 }` is already
//     AUTHORED by Meowscarada ex sv02-015" — TRUE, at amount 30, and asserted as
//     an op-identity rather than by eye.
//   • "`programFor("sv02-127")?.attack` is undefined and the sentence derives to
//     null today" — TRUE (counterPut.test.ts had already pinned it), and the
//     `.attack` half is STILL true after this slice, which is what proves the
//     derivation is doing the work.
//   • "`placeSnipe` hardcodes `"ability"`, the guard is `deals` and nothing
//     asserts it" — TRUE, all three parts. That is the slice.
//   • "two possessives-worth of apostrophe risk" — ⚠️ HALF TRUE and worth stating
//     precisely: the sentence carries TWO possessives ("your", "opponent's") but
//     only ONE apostrophe, so there is exactly one `['’]` slot and D137's
//     one-slot-classed-and-not-the-other hazard cannot arise here.
//
// WHAT IS NEW HERE, and why this is not a copy of counterPut.test.ts:
//   • THE LABEL, RESOLVED RATHER THAN NOTED. `placeSnipe` pushed `COUNTERS_PLACED`
//     source `"ability"` as a literal; this sentence is the first ATTACK to reach
//     that line, so the string became false. It now takes the provenance as a
//     PARAMETER, off a REQUIRED field on the op — and the guard D139 could only
//     write down is ASSERTED below, by sweeping every op the deriver produces from
//     the whole fixture pool and refusing `"ability"` on all of them.
//   • THE SENTENCE PARKS. Its target is a CHOICE, so unlike D139 there is a
//     prompt, a resume and an illegal-pick refusal, and the provenance has to
//     survive the round trip (it rides the parked op).
//   • ITS ATTACK CARRIES A PRINTED 150. This is the counter family's first D125
//     tail-order board: a real §8.5 hit on the Defender AND a flat placement on
//     the Bench in one declaration, in that order, with the epilogue behind both.
//   • THE FLAT CLAIM IS PINNED BY THREE PASSIVES, NOT BY WEAKNESS. §8.5 already
//     flattens Weakness on the Bench for BOTH readings, so the assertions that
//     actually separate a placement from a `deals: true` hit are the REDUCTION
//     passive (Bouffer) and the ex/V PREVENTION (Safeguard) — the latter available
//     only because this sentence's attacker has a rule box.
//
// Seed-free: this sentence takes no coin, pinned by an unchanged `rngState` across
// a whole park-and-resolve.

/** The clause, verbatim off the local D1 (2026-08-02), and the ONE it is.
    CENSUS: of the 24 printings / 15 clauses whose ACTION is putting counters
    (D139's census, re-read for this target rather than re-run), the ones aimed at
    "1 of your opponent's Benched Pokémon" are exactly these FOUR PRINTINGS OF ONE
    CARD on ONE clause. Every other printing of that noun phrase in the pool is an
    ABILITY — Meowscarada ex ×4 and Radiant Blastoise swsh10.5-018 — which this
    anchor refuses on case alone. */
const CLAUSE = "Put 2 damage counters on 1 of your opponent's Benched Pokémon.";

/** The four printings. FOUR IDS, ONE CARD, ONE CLAUSE — so this slice's warrant is
    D121's weaker form (one card in four rarities), which is why the second-printing
    argument is NOT what licenses it: the sentence is a whole printed shape with a
    captured count, and the count is what a fifth printing would vary. */
const PRINTINGS = ["sv02-127", "sv02-243", "sv02-263", "sv02-275"] as const;

const LAND_SCOOP_INDEX = 0;
/** 2 printed counters → 20 HP (§12). The whole arithmetic risk of the slice. */
const LAND_SCOOP_COUNTERS = 2;
const LAND_SCOOP_HP = 20;
/** The printed `damage` field, which rides the attack itself and not the program. */
const LAND_SCOOP_DAMAGE = 150;

function clauseText(counters: number): string {
  return `Put ${counters} damage counters on 1 of your opponent's Benched Pokémon.`;
}

/** The op, with the printed count already converted to HP and the provenance the
    COUNTERS_PLACED row may honestly print. Identical to the one Meowscarada ex's
    registry row authors except in `amount` and `source` — which is asserted. */
function putOp(hp: number): EffectOp {
  return { op: "damageChosen", target: "opponentBench", amount: hp, count: 1, source: "attack" };
}

/** Real catalog rows this anchor must refuse, verbatim off the local D1, and every
    one of them is still unmapped after this slice:
      • Vespiquen ex sv03-096/-212 "Phantom Queen" — the SAME zone with a
        per-target FILTER ("that has any damage counters on it"), which nothing in
        the vocabulary expresses.
      • Ninetales sv03-029/-199 "Nine-Tailed Dance" — a bare count on the same verb,
        but an ANY-ZONE target and a second, duration-scoped sentence riding it.
      • ✅ **SPENT AT D348** — Drifblim sv01-090 "Curse Spreading" was listed here
        as "a distribution across the whole board". It is MAPPED: arm 23a reads it,
        and the reading is N repeated `damageChosen` ops rather than the
        distribution PROMPT this line assumed. The entry is recorded as spent
        rather than re-aimed, because a note re-aimed at a different blocker
        disagrees with nothing and sends the next slice past a buildable card
        (D346's finding). The array's own witness WAS re-pointed, below.
      • Maushold sv02-168/-226 and Yveltal sv06.5-035 — "each of your opponent's
        Pokémon", one scaled by a board count and one filtered.
      • Alolan Raticate swsh10.5-042 "Super Fang" — the amount read off the TARGET.
      • Meowscarada ex sv02-015 and Radiant Blastoise swsh10.5-018 — the ABILITY
        printings of THIS EXACT ACTION, lowercase and mid-sentence, and the entire
        reason there is no /i flag on the anchor. They are the sharpest refusals in
        the list: they derive to the same op through the REGISTRY, so a reader that
        swallowed them would double-author the same card.

    STANDING NOTE: when a later slice maps one of these, RE-POINT the entry at
    another still-unmapped clause — never delete it. The claim is that an unread
    sentence stays LOUD, and that claim needs a live witness to be about. */
/** 🆕🆕🆕 D450 — the row that used to sit in `NEAR_MISSES` and is now MAPPED (arm 23f).
    Kept as a named constant so the claim about it reads beside the list it left. */
const WINDOWED_FOLD =
  "Put 2 damage counters on each of your opponent's Pokémon that has any damage counters on it.";
const NEAR_MISSES = [
  "Put 3 damage counters on each of your opponent's Benched Pokémon that has any damage counters on it.",
  // ⚠️ RE-POINTED AT D143. This slot held Ninetales sv03-029/-199's "Nine-Tailed
  // Dance" — "Put 9 damage counters on 1 of your opponent's Pokémon. During your
  // next turn, this Pokémon can't attack." — which D143 MAPPED, so the witness
  // moved to Annihilape ex sv02-242 "Wrath of the Ancients" rather than being
  // deleted (the standing note below). The new row is a SELF put with an "up to"
  // AND a consequent that scales off what was placed: two axes this op has not
  // got, and neither of them the ZONE this anchor is about.
  "Put up to 12 damage counters on this Pokémon. This attack does 20 damage for each damage counter you placed in this way.",
  // ⚠️ RE-POINTED AT D348. This slot held "Put 8 damage counters on your opponent's
  // Pokémon in any way you like." (sv01-090/sv04.5-156) — the counter SPREAD, which
  // D348 MAPPED as arm 23a, so the witness moved rather than being deleted (the
  // standing note above). The replacement is the NEAREST STILL-UNREAD row by ZONE,
  // which is what this anchor is about: Palossand ex sv08-091/-221 "Barite Jail", 2
  // legal, same Bench, same verb, and refused on TWO axes at once — an "each of"
  // fold with no pick in it, and an amount read off the TARGET's remaining HP
  // rather than printed. Neither is a number this anchor could capture.
  // 🆕🆕 **RE-POINTED AGAIN AT D456**, and the occupant it replaces is corpus line 179
  // — the DELAYED retaliation at a printed count, 1 legal printing, refused here on the
  // TIMING (a durated *"During your opponent's next turn"* window this anchor's `^Put`
  // cannot open) and on the TARGET (*"the Attacking Pokémon"*, a body no zone in this op
  // names). **Both reasons were and remain true of THIS anchor**; the sentence went to
  // `installRecoil`, whose window and whose target those two clauses describe exactly —
  // and it cost ONE alternation, because D152's anchor demanded *"(even if **it** is
  // Knocked Out)"* and this printing spells *"(even if **this Pokémon** is)"*.
  //
  // The replacement is corpus line 526, 1 legal printing and still unread: this anchor's
  // exact noun phrase and quantifier with the DAMAGE verb instead of the placement verb,
  // and a per-target count. Refused on the VERB alone, which is the tightest axis this
  // slot has ever held.
  "This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  "Put 1 damage counter on each of your opponent's Pokémon for each of your Maushold in play.",
  // ⚠️ RE-POINTED AT D450 — this slot held the windowed opponent-side fold (corpus line 414), which D450 MAPPED (arms 23d/23e/23f
  // over `counterEachAll`), so the witness MOVED rather than being deleted (the standing
  // note above). The replacement is the CONFUSION SUBSTITUTION, 1 legal printing and still unread: it prints this anchor's verb and a count, and is refused on the VERB — the counters RAISE the Checkup's per-condition amount rather than being placed at all. The sentence it replaced is not gone from this
  // file: the claim about it is now an INEQUALITY of derived programs below the loop,
  // which is D418's second half and strictly stronger than the `toBeNull` it had.
  "Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that Pokémon for this Special Condition.",
  // 🆕🆕 **RE-POINTED AGAIN AT D456.** The slot held the delayed retaliation with its
  // amount read off *"the damage done to this Pokémon"* (corpus line 180, 2 legal
  // printings), refused here on the ground that *"the quantity is a HISTORY of the
  // opponent's turn"*. D456 claimed it: the quantity is a LOCAL at the §9 recoil site
  // (`attack.ts`'s own `dealt`, the same one its `dealt > 0` gate reads), so no history
  // and no recorded figure were ever needed — only a durated watcher, which `D152`'s
  // `InstalledRecoil` had been since before the refusal was written. Witness MOVED
  // rather than deleted (the standing note above).
  //
  // The replacement is corpus line 412, **3 legal printings** and the largest unread row
  // left in the placement family. It keeps the axis this slot is for — an amount that is
  // COMPUTED rather than captured (*"for each Basic {G} Energy card in your discard
  // pile"*) — and it is refused on this anchor's own ZONE besides: it names *"1 of your
  // opponent's Pokémon"* where this anchor requires the printed word **Benched**, so it
  // is one adjective and one count-source away in two different directions.
  "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.",
  "You must discard a Basic {G} Energy card from your hand in order to use this Ability. Once during your turn, you may put 3 damage counters on 1 of your opponent's Benched Pokémon.",
  "You must discard a Water Energy card from your hand in order to use this Ability. Once during your turn, you may put 2 damage counters on 1 of your opponent's Benched Pokémon.",
] as const;

/** 🆕🆕🆕 D451's two printed HP targets. NOT in `NEAR_MISSES` for D450's stated
    reason: both are MAPPED, so the claim about them is an INEQUALITY of derived
    programs rather than a `toBeNull` that would go green the day an arm lands. */
const BENCH_HP_TARGET =
  "Put damage counters on each of your opponent's Benched Pokémon until its remaining HP is 100.";
const ACTIVE_HP_TARGET =
  "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10.";

/** The SIBLING anchor, one noun phrase apart — D139's PUT on the DEFENDER. NOT in
    `NEAR_MISSES`, because it is MAPPED: the claim about it is not `toBeNull` but
    that each anchor keeps deriving its OWN op, in both directions. */
const DEFENDER_PUT_CLAUSE = "Put 7 damage counters on your opponent's Active Pokémon.";

/** U+2019, spelled as an ESCAPE rather than typed. */
const RSQUO = "\u2019";
/** U+00A0 — byte-different from an ASCII space and INVISIBLE in a diff, which is
    exactly why it is written as an ESCAPE. A typed one silently degrades to a
    plain space in an editor and the case then asserts nothing. */
const NBSP = "\u00A0";

/** fix-titan is 340 HP, so it absorbs the printed 150 without the epilogue
    sweeping the Defender out from under a bench assertion. */
const TITAN_HP = 340;
/** Not a multiple of 20 or 150, so no sum below is reachable two ways. */
const BENCH_HURT = 30;

const P1_ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const P2_ACTIVE: PokemonRef = { seat: "p2", spot: { spot: "active" } };
const P2_BENCH_0: PokemonRef = { seat: "p2", spot: { spot: "bench", index: 0 } };
const P2_BENCH_1: PokemonRef = { seat: "p2", spot: { spot: "bench", index: 1 } };

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** ONE BOARD, NO SWEEP. Nothing in this slice takes a coin, so there is no seed to
    vary (pinned by an unchanged `rngState` below).

    Setup, then open P1's turn 2 (P2 went first and passed) so the attack step is
    legal (§4). Both Active spots are pinned to fix-titan (340 HP, no Weakness, no
    Resistance, NO ATTACKS) and BOTH BENCHES ARE EMPTIED — D133's trap:
    `setActiveFromDeck` DISPLACES the Active it replaces onto the Bench, so every
    surgery leaves a stranger behind, and here the opponent's Bench IS the
    candidate list. A stray body would silently change what the prompt offers. */
function board(): GameState {
  let state = driveSetup(
    11,
    { p1: COUNTER_BENCH_PUT_DECK, p2: COUNTER_BENCH_PUT_DECK },
    { first: "p2" },
  );
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-titan");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return clearBench(clearBench(state, "p1"), "p2");
}

/** Field Ting-Lu ex as `seat`'s Active with three {F} attached — Land Scoop's
    printed cost. A Basic, so the surgery is a convenience; the bench clear after
    it is not. */
function tingLuActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(
    clearBench(setActiveFromDeck(state, seat, "sv02-127"), seat),
    seat,
    "fix-fighting-energy",
    3,
  );
}

/** Populate `seat`'s Bench from the deck, in order. */
function bench(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  return ids.reduce((next, id) => benchFromDeck(next, seat, id), state);
}

/** Declare Land Scoop on `seat`, freezing the prior state first — the purity check
    every neighbouring suite runs, hoisted because this file drives a dozen. */
function declare(state: GameState, seat: Seat = "p1"): { state: GameState; events: GameEvent[] } {
  deepFreeze(state);
  return mustApply(state, { type: "attack", seat, index: LAND_SCOOP_INDEX });
}

/** The parked `choosePokemonMulti` prompt, narrowed — a state that did NOT park
    fails here rather than three assertions later. */
function multiPrompt(state: GameState): {
  candidates: PokemonRef[];
  min: number;
  max: number;
  declinable: boolean;
  note: string;
} {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "choosePokemonMulti") {
    throw new Error(`expected choosePokemonMulti, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

/** The answer to the park: a SET of one, since `damageChosen` uses the multi
    prompt even at `count: 1` (the shape is a set, dispatched in one go). */
function pick(ref: PokemonRef, seat: Seat = "p1"): GameAction {
  return { type: "resolveEffect", seat, choice: { kind: "pokemonMulti", refs: [ref] } };
}

describe("the anchor — 4 printings, 1 clause, one regex with one (\\d+) capture", () => {
  it("derives the printed clause, and the amount is HP rather than counters", () => {
    expect(deriveAttackEffect(CLAUSE)).toEqual([putOp(LAND_SCOOP_HP)]);
    // ONE op, FIVE keys, and the shape claim: the count lands in a FIELD (D131),
    // not in a row of a lookup table — D120's template rule needs a CLOSED
    // vocabulary to reject against and a bare integer has none.
    const ops = deriveAttackEffect(CLAUSE);
    expect(ops).toHaveLength(1);
    expect(Object.keys(ops?.[0] as object).sort()).toEqual([
      "amount",
      "count",
      "op",
      "source",
      "target",
    ]);
    // ⚠️ AND `deals` IS ABSENT, not false. That absence is the whole routing
    // decision: `deals: true` would emit DAMAGE_DEALT, re-admit the benched
    // reduction passive and the ex/V prevention, and never reach the counter path
    // this slice exists to label. A placed counter is not attack damage even when
    // an attack printed it (the `damageActive` rule).
    expect(ops?.[0]).not.toHaveProperty("deals");
    expect(ops?.[0]).not.toHaveProperty("ignoreWR");
    expect(ops?.[0]).not.toHaveProperty("perTakenPrize");
    expect(ops?.[0]).not.toHaveProperty("optional");
  });

  it("⚠️ CONVERTS counters → HP, and fails at a factor of ten in EITHER direction", () => {
    // `damageChosen.amount` is HP (the interpreter adds it straight onto `damage`),
    // the printed number is COUNTERS, and §12 fixes one counter at 10 HP. A build
    // that forgot the × 10 places 2; one that applied it twice places 200. Both are
    // refused explicitly, because `toEqual` on the right answer alone would still
    // pass a suite whose expected value was copied from the bug.
    const derived = deriveAttackEffect(CLAUSE);
    expect(derived).toEqual([putOp(LAND_SCOOP_COUNTERS * 10)]);
    expect(derived).not.toEqual([putOp(LAND_SCOOP_COUNTERS)]);
    expect(derived).not.toEqual([putOp(LAND_SCOOP_COUNTERS * 100)]);
    expect(LAND_SCOOP_HP).toBe(LAND_SCOOP_COUNTERS * 10);
    // AND IT IS A CONVERSION, NOT A CONSTANT. The pool prints this clause at one
    // count only, so unlike D139 the second data point cannot come from a second
    // card — it comes from the capture itself, which is the same claim about the
    // same line of code.
    expect(deriveAttackEffect(clauseText(1))).toEqual([putOp(10)]);
    expect(deriveAttackEffect(clauseText(13))).toEqual([putOp(130)]);
    expect(deriveAttackEffect(clauseText(1))).not.toEqual(deriveAttackEffect(clauseText(13)));
  });

  it("is the SAME op Meowscarada ex's registry row authors — D132's inventory rule", () => {
    // The op existed before the reader did: Meowscarada ex sv02-015's "Bouquet
    // Magic" has produced `damageChosen { target: "opponentBench", count: 1 }` since
    // M4 slice 8, and its row does the identical counters → HP conversion by hand
    // (3 printed counters → `amount: 30`).
    const authored = programFor("sv02-015")?.abilities?.[0];
    expect(authored?.name).toBe("Bouquet Magic");
    expect(authored?.program?.[1]).toEqual({
      op: "damageChosen",
      target: "opponentBench",
      amount: 30,
      count: 1,
      source: "ability",
    });
    // …and the derived op is that op with TWO fields changed and nothing else —
    // written as a REBUILD of the authored row rather than as a fresh literal, so
    // the claim is "these differ in exactly these keys" rather than "both happen to
    // look like this".
    const authoredOp = authored?.program?.[1] as Record<string, unknown>;
    expect(deriveAttackEffect(CLAUSE)).toEqual([
      { ...authoredOp, amount: LAND_SCOOP_HP, source: "attack" },
    ]);
    expect(Object.keys(authoredOp).sort()).toEqual(
      Object.keys(deriveAttackEffect(CLAUSE)?.[0] as object).sort(),
    );
    // THE PROVENANCE IS THE ONLY NON-NUMERIC DIFFERENCE, and it is a FIELD rather
    // than a second op member because everything downstream of it is byte-identical
    // — D131's widen-don't-add rule applied and PASSING, exactly as it did at D139
    // and exactly as it FAILED at D138.
    expect(authoredOp.source).toBe("ability");
    expect((deriveAttackEffect(CLAUSE)?.[0] as Record<string, unknown>).source).toBe("attack");
  });

  it("refuses the EIGHT real catalog rows that share its words", () => {
    for (const text of NEAR_MISSES) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // THE TWO THAT MATTER MOST are the ABILITY printings of this exact action.
    // Both already produce this op through the REGISTRY, so a reader that swallowed
    // them would author the same placement twice — and both are refused by the
    // capital "Put" plus `^…$` alone, with no /i anywhere in this file.
    expect(deriveAttackEffect(NEAR_MISSES[6])).toBeNull();
    expect(deriveAttackEffect(NEAR_MISSES[7])).toBeNull();
    // Vespiquen ex's is the nearest by ZONE — same Bench, same verb, a per-target
    // filter and "each of" instead of "1 of".
    expect(deriveAttackEffect(NEAR_MISSES[0])).toBeNull();

    // 🆕🆕🆕 **D450 — THE ROW THAT LEFT THIS LIST, AND THE CLAIM IT WAS REALLY MAKING.**
    // *"Put 2 damage counters on each of your opponent's Pokémon that has any damage
    // counters on it."* (corpus line 414) was a `toBeNull` here until D450 built it as
    // arm 23f. A `toBeNull` on a sentence the catalog PRINTS is a liability rather than
    // a guard (D449), so the slot was re-pointed above and the claim moved here as an
    // INEQUALITY of derived programs — which still goes RED on the defect this rung was
    // about (an anchor loose enough to swallow the "each of" fold) and cannot go green
    // by accident when a sibling arm lands.
    expect(deriveAttackEffect(WINDOWED_FOLD)).not.toEqual(deriveAttackEffect(CLAUSE));
    expect(deriveAttackEffect(WINDOWED_FOLD)?.[0]?.op).toBe("counterEachAll");
    expect(deriveAttackEffect(CLAUSE)?.[0]?.op).toBe("damageChosen");

    // 🆕🆕🆕 **D451 — THE TWO ROWS THAT LEFT THIS LIST THIS SLICE, AND THE SAME REPAIR.**
    // The Bench-scoped HP target is the sharpest of the pair: it shares this anchor's
    // ZONE and its verb and differs only in where the amount comes from, so an anchor
    // loose enough to swallow it would place a flat `N × 10` where the card prints a
    // subtraction. Asserted as an INEQUALITY plus both positives, never as a nullity.
    expect(deriveAttackEffect(BENCH_HP_TARGET)).not.toEqual(deriveAttackEffect(CLAUSE));
    expect(deriveAttackEffect(BENCH_HP_TARGET)?.[0]?.op).toBe("counterUntilRemainingHp");
    expect(deriveAttackEffect(ACTIVE_HP_TARGET)?.[0]?.op).toBe("counterUntilRemainingHp");
    // …and the two HP targets are told apart by their TARGET and by nothing else,
    // which is what makes this anchor's zone word load-bearing one file over.
    expect(deriveAttackEffect(BENCH_HP_TARGET)).not.toEqual(deriveAttackEffect(ACTIVE_HP_TARGET));
  });

  it("stays disjoint from the SIBLING anchor in BOTH directions", () => {
    // D139's PUT on the DEFENDER shares this sentence's first four words and its
    // last two, and differs only in the target noun phrase. Both anchors are `^…$`,
    // so no ordering of the deriver's arms can matter — but that is worth asserting
    // rather than reasoning about, and the assertion is that each keeps deriving
    // its OWN op rather than that either returns null.
    expect(deriveAttackEffect(DEFENDER_PUT_CLAUSE)).toEqual([
      { op: "damageActive", amount: 70, source: "attack" },
    ]);
    expect(deriveAttackEffect(DEFENDER_PUT_CLAUSE)).not.toContainEqual(
      expect.objectContaining({ op: "damageChosen" }),
    );
    expect(deriveAttackEffect(CLAUSE)).toEqual([putOp(LAND_SCOOP_HP)]);
    expect(deriveAttackEffect(CLAUSE)).not.toContainEqual(
      expect.objectContaining({ op: "damageActive" }),
    );
    // …and the two really do share their opening, which is what makes the
    // disjointness a claim about the TARGET rather than a coincidence.
    expect(DEFENDER_PUT_CLAUSE.startsWith("Put ")).toBe(true);
    expect(CLAUSE.startsWith("Put ")).toBe(true);
    expect(DEFENDER_PUT_CLAUSE.endsWith(" Pokémon.")).toBe(true);
    expect(CLAUSE.endsWith(" Pokémon.")).toBe(true);
  });

  it("refuses the anchor, punctuation, case and token rewrites — but trims outer space", () => {
    for (const text of [
      // NO TRAILING PERIOD — the `$` sits after it.
      "Put 2 damage counters on 1 of your opponent's Benched Pokémon",
      // "!" for "." — the same one-character difference from the other side.
      "Put 2 damage counters on 1 of your opponent's Benched Pokémon!",
      // A LOWERCASE first word: half of what keeps the FIVE Ability printings of
      // this same action off this path, and the reason there is no /i flag.
      "put 2 damage counters on 1 of your opponent's Benched Pokémon.",
      // THE SINGULAR NOUN. Deliberately NOT a branch (D139's call, inherited): the
      // pool prints only the plural on attacks.
      "Put 2 damage counter on 1 of your opponent's Benched Pokémon.",
      // NO COUNT AT ALL — the shape whose amount is read off the target.
      "Put damage counters on 1 of your opponent's Benched Pokémon.",
      // "up to", a BOUNDED count. The op's `count` is EXACT by its own doc block, so
      // a reader that swallowed the words would place the maximum for a card that
      // prints a choice.
      "Put up to 2 damage counters on 1 of your opponent's Benched Pokémon.",
      // A NON-INTEGER and a SIGNED count — `\d+` takes neither, and a placement of
      // -20 would HEAL the target.
      "Put 2.5 damage counters on 1 of your opponent's Benched Pokémon.",
      "Put -2 damage counters on 1 of your opponent's Benched Pokémon.",
      // ⚠️ THE SEAT, FLIPPED. "1 of YOUR Benched Pokémon" is the catastrophic miss:
      // the op has no seat field to be wrong in, so a reader that lost the word
      // "opponent's" would place counters on the attacker's own board with nothing
      // downstream to notice.
      "Put 2 damage counters on 1 of your Benched Pokémon.",
      // THE ZONE, re-aimed TWO ways here — each a real reading elsewhere in the pool.
      // 🆕🛑 **D449 — THE THIRD REWRITE LEFT THIS LOOP BECAUSE IT STOPPED BEING NULL.**
      // *"Put 2 damage counters on 1 of your opponent's Pokémon."* — this sentence with
      // the word **Benched** deleted — is a real legal printing (corpus line 413, 1
      // printing) and is claimed by `COUNTER_PUT_ON_OPPONENT_ANY` (arm 23b) as of D449.
      // RE-POINTED, not deleted: the claim was always *"the ZONE is what tells these two
      // anchors apart"*, and it is now made as an inequality of derived ops below, which
      // still goes red on a reader that dropped the word and cannot go green by accident.
      "Put 2 damage counters on each of your opponent's Benched Pokémon.",
      "Put 2 damage counters on your opponent's Benched Pokémon.",
      // THE COUNT OF TARGETS. "2 of" is a different pick and the op's `count` field
      // would have to carry it; the anchor spells the literal "1 of".
      "Put 2 damage counters on 2 of your opponent's Benched Pokémon.",
      // A NON-BREAKING SPACE where an ASCII one is printed. Spelled as an ESCAPE.
      `Put${NBSP}2 damage counters on 1 of your opponent's Benched Pokémon.`,
      // An INTERIOR double space is not trimmable.
      "Put  2 damage counters on 1 of your opponent's Benched Pokémon.",
      // A LEADING RIDER pins `^` — this is how a gated printing arrives.
      "Flip a coin. If heads, put 2 damage counters on 1 of your opponent's Benched Pokémon.",
      // A SECOND SENTENCE riding the same action — the shape the `$` exists for, and
      // NOT hypothetical: Ninetales sv03-029 prints exactly this pattern one zone
      // over, so the first printing that extends THIS sentence must land loudly
      // rather than half-resolve with a rider the engine never saw.
      "Put 2 damage counters on 1 of your opponent's Benched Pokémon. During your next turn, this Pokémon can't attack.",
      // Empty.
      "",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // Outer whitespace SURVIVES by design (the deriver trims), so this states which
    // drift is tolerated and which is not.
    expect(deriveAttackEffect(`\t  ${CLAUSE}\n`)).toEqual([putOp(LAND_SCOOP_HP)]);
  });

  it("🆕 D449 — dropping the word Benched gives the ANY-ZONE op, not this one and not null", () => {
    // The one-axis pair this file's whole target claim rests on, now that both sides
    // are read: the SAME verb, the SAME count, the SAME amount, one word apart, two
    // different `target` members. A reader that lost the word would produce the first
    // program where the second is printed, and place counters on the opponent's ACTIVE
    // for a card whose sentence names their Bench.
    const anyZone = CLAUSE.replace(" Benched", "");
    expect(anyZone).not.toBe(CLAUSE);
    expect(deriveAttackEffect(anyZone)).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: LAND_SCOOP_HP, count: 1, source: "attack" },
    ]);
    expect(deriveAttackEffect(CLAUSE)).toEqual([putOp(LAND_SCOOP_HP)]);
    expect(deriveAttackEffect(anyZone)).not.toEqual(deriveAttackEffect(CLAUSE));
  });

  it("refuses a printed ZERO but ACCEPTS the ungrammatical singular count", () => {
    // A printed "Put 0 damage counters" is not a real card and here it is WORSE than
    // a silent no-op: it would PARK the attacker on a choice with no possible
    // outcome. It stays on the loud ATTACK_EFFECT_SKIPPED path.
    expect(deriveAttackEffect(clauseText(0))).toBeNull();
    // "Put 1 damage counters …" is unprinted and ungrammatical, and it DERIVES —
    // D131's call for "the top 1 cards", D135's for the unprinted "Heal all damage
    // …" and D139's for this same capture: the sentence is unambiguous and the op
    // expresses it exactly, so refusing it would be a claim about the INGEST rather
    // than about the GAME.
    expect(deriveAttackEffect(clauseText(1))).toEqual([putOp(10)]);
    expect(deriveAttackEffect(clauseText(999))).toEqual([putOp(9990)]);
  });

  it("derives the CURLY apostrophe identically — and there is exactly ONE slot", () => {
    // The claim is EQUALITY with the straight form, never merely "the curly one is
    // non-null": a non-null check passes on a reader that folded the clause into
    // some other row. clauseApostrophe.test.ts's DISCOVERED sweep picks this
    // sentence up from the FIXTURE, which is why that census moved 35 → 36.
    const curly = CLAUSE.replaceAll("'", RSQUO);
    expect(curly).not.toBe(CLAUSE);
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(CLAUSE));
    expect(deriveAttackEffect(curly)).toEqual([putOp(LAND_SCOOP_HP)]);
    // ⚠️ AND THE PRECISE FORM OF THE RESUME POINT'S WARNING. It flagged "two
    // possessives-worth of apostrophe risk" — D137's hazard, where classing one
    // slot and not the other reads like a whole fix. TWO POSSESSIVES IS RIGHT AND
    // TWO APOSTROPHES IS NOT: "your" carries no mark, so the sentence has exactly
    // one, the regex has exactly one `['’]`, and the asymmetry D137 found in
    // RETREAT_COST_SCALE cannot arise here. Asserted rather than argued.
    expect(CLAUSE.split("'")).toHaveLength(2);
    expect(curly.split(RSQUO)).toHaveLength(2);
    expect(CLAUSE).toContain("your opponent's");
  });
});

describe("⚠️ the guard, ASSERTED rather than relied on — no derived op says 'ability'", () => {
  it("sweeps EVERY op the deriver produces from the whole fixture pool", () => {
    // THIS IS THE CASE D139 SAID DID NOT EXIST. Before 0.89.0 `placeSnipe`'s
    // counter path pushed the literal string `"ability"`, kept honest only by the
    // accident that every DERIVED attack snipe set `deals: true` and routed to
    // DAMAGE_DEALT instead — "a flag chosen for an unrelated reason that nothing
    // asserts". Nothing asserted it because the guard was never stated; it is
    // stated here, and it is TOTAL over the pool rather than a list somebody
    // maintains: every attack effect in FIXTURE_POOL goes through the real reader
    // and every op carrying a provenance is checked.
    const sourced: { id: string; op: string; source: string }[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const attack of card.attacks ?? []) {
        for (const op of deriveAttackEffect(attack.effect ?? "") ?? []) {
          const source = (op as { source?: unknown }).source;
          if (typeof source === "string") sourced.push({ id, op: op.op, source });
        }
      }
    }
    // The sweep found something — otherwise the loop below asserts nothing, which
    // is the failure mode a "no bad rows" test has by construction.
    expect(sourced.length).toBeGreaterThan(0);
    // 🛑 D234 — THE SWEEP IS OVER A FIELD **NAME**, AND TWO UNRELATED FIELDS SHARE
    // IT. Until this slice every op the deriver could emit with a string `source`
    // carried a PROVENANCE (`DamageSource` — "attack" | "ability"), so "every
    // `source` is 'attack'" was a total claim that happened to be true.
    // `attachEnergyFrom.source` is a ZONE ("hand" | "discard") and has been since
    // M5; the day an ATTACK first derived that op (D234) this guard went red
    // against a perfectly correct program. **The guard was right to fail — its
    // predicate was wider than its subject** — so it is partitioned rather than
    // narrowed: an op carrying `source` must be classified as one or the other,
    // and an UNCLASSIFIED one fails here. That keeps the totality (a new
    // provenance-carrying op cannot slip past by not being on a list) while making
    // the assertion true of what it is actually about.
    // 🆕🆕🆕 D450 — `counterEachAll` is the THIRD op on the provenance side, and it
    // arrives here for the same reason the other two did: its `source` was a
    // HARDCODED `"ability"` in the interpreter until an attack reached it. The row
    // below is what makes this guard bite on the three fold arms.
    // 🆕🆕🆕 D451 — `counterUntilRemainingHp` is the FOURTH op on the provenance side,
    // and it arrives here for the reason the other three did: `source` is a log label
    // whose wrong value is a row saying "Ability:" about an attack, and nothing but this
    // sweep would have noticed. It is the first one to arrive with the field REQUIRED
    // from birth rather than after a hardcode was caught.
    const PROVENANCE_SOURCE = new Set([
      "damageActive",
      "damageChosen",
      "counterEachAll",
      "counterUntilRemainingHp",
    ]);
    const ZONE_SOURCE = new Set(["attachEnergyFrom"]);
    for (const row of sourced) {
      expect(
        PROVENANCE_SOURCE.has(row.op) || ZONE_SOURCE.has(row.op),
        `${row.id} derived ${row.op} with an UNCLASSIFIED \`source\` — is it a provenance or a zone?`,
      ).toBe(true);
    }
    // ⚠️ AND NOT ONE OF THE PROVENANCE ROWS CLAIMS TO BE AN ABILITY. An attack's
    // own printed sentence is never an Ability, whatever op it lands on: the row
    // would render under the DAMAGED Pokémon's seat with the literal word Ability
    // on it (D136's finding 1). This is the assertion that fails if a later arm
    // copies a registry row, or if somebody "simplifies" the field back to a
    // default.
    for (const row of sourced.filter((r) => PROVENANCE_SOURCE.has(r.op))) {
      expect(row.source, `${row.id} derived ${row.op} as ${row.source}`).toBe("attack");
    }
    // …and the zone half is pinned to zone values, so the partition is not a way
    // of excusing a row from being checked at all.
    for (const row of sourced.filter((r) => ZONE_SOURCE.has(r.op))) {
      expect(["hand", "discard"], `${row.id} derived ${row.op} as ${row.source}`).toContain(
        row.source,
      );
    }
    // Every op that carries the field is actually represented, so the sweep is not
    // silently covering one of them only.
    expect(new Set(sourced.map((r) => r.op))).toEqual(
      new Set([...PROVENANCE_SOURCE, ...ZONE_SOURCE]),
    );
  });

  it("and every AUTHORED counter placement still says 'ability' — both values reach it", () => {
    // A field is only meaningful if both of its values are produced, so the other
    // side is pinned from the registry: the three rows that take `placeSnipe`'s
    // counter path are all Abilities, and all three still say so. A build that
    // flipped the default breaks this and nothing else.
    const rows = [
      { id: "sv01-118", name: "Flying Entry", index: 0 },
      { id: "sv02-015", name: "Bouquet Magic", index: 1 },
      { id: "swsh10.5-018", name: "Pump Shot", index: 1 },
    ] as const;
    for (const { id, index } of rows) {
      const program =
        programFor(id)?.abilities?.[0]?.program ?? programFor(id)?.triggered?.[0]?.program;
      const op = program?.[index] as Record<string, unknown> | undefined;
      expect(op?.op, id).toBe("damageChosen");
      expect(op?.source, id).toBe("ability");
      // …and none of them sets `deals`, which is what puts them on the counter path
      // in the first place — the guard's other half, stated rather than assumed.
      expect(op).not.toHaveProperty("deals");
    }
  });

  it("⚠️ answers the OTHER half of the question — spreadDamage and damageSelf are NOT exposed", () => {
    // The resume point left this open, and it is answerable with evidence rather
    // than a reading of the code.
    //
    // `spreadDamage` — ZERO EXPOSURE, structurally: it emits `DAMAGE_DEALT`, an
    // event that carries no provenance enum at all, so there is no label to be
    // false. Driven here rather than argued: Cetoddle sv02-053's "Avalanche" is the
    // shape, and what comes back is a DAMAGE_DEALT with the §8.5 fields on it.
    const spread = deriveAttackEffect(
      "This attack also does 10 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    );
    expect(spread).toEqual([{ op: "spreadDamage", target: "opponentBench", amount: 10 }]);
    expect(spread?.[0]).not.toHaveProperty("source");
    //
    // `damageSelf` — ZERO EXPOSURE, for a different and stronger reason: it DOES
    // emit COUNTERS_PLACED, but with source `"self"`, whose `seat` is `ctx.seat` —
    // the ACTOR's own. D136's finding 1 is that a row renders after the seat's name
    // and that seat may not be the actor; here the two are the same seat by
    // construction, so the active-voice row ("… did N damage to itself") is true
    // whoever placed it. And `"self"` names the DIRECTION rather than the invoker,
    // so unlike `"ability"` it does not become false when a new producer appears.
    const recoil = deriveAttackEffect("This Pokémon also does 30 damage to itself.");
    expect(recoil).toEqual([{ op: "damageSelf", amount: 30 }]);
    expect(recoil?.[0]).not.toHaveProperty("source");
    // Neither op has a `source` field to get wrong, which is the whole finding: the
    // exposure was never "COUNTERS_PLACED has an enum", it was "one op's producer
    // set can grow past the label the interpreter hardcoded". Only `damageChosen`
    // could, and it has.
  });
});

describe("the fixture's printed text — every claim on the resume point, checked", () => {
  it("pins Ting-Lu ex sv02-127 — LAND SCOOP, {F}{F}{F}, 2 counters, printed 150", () => {
    // On the deriver path a one-character drift un-simulates the card with no other
    // failure anywhere, so the bytes get pinned here — and the resume point's
    // catalog claims (ids, attack NAME, index, count, printed damage, Energy cost)
    // are exactly these bytes.
    const landScoop = FIXTURE_POOL["sv02-127"]?.attacks?.[LAND_SCOOP_INDEX];
    expect(landScoop).toEqual({
      cost: ["Fighting", "Fighting", "Fighting"],
      name: "Land Scoop",
      effect: CLAUSE,
      damage: LAND_SCOOP_DAMAGE,
    });
    expect(deriveAttackEffect(landScoop?.effect ?? "")).toEqual([putOp(LAND_SCOOP_HP)]);
    // ⚠️ THE PRINTED `damage` IS PRESENT, which is where this differs from every
    // earlier counter-family printing: D138's and D139's four printings carried
    // none, so the placement was their entire visible result. Here a real §8.5 hit
    // runs first (D125's tail).
    expect(landScoop?.damage).toBe(LAND_SCOOP_DAMAGE);
    expect(FIXTURE_POOL["sv02-127"]?.name).toBe("Ting-Lu ex");
    expect(FIXTURE_POOL["sv02-127"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv02-127"]?.hp).toBe(240);
    expect(FIXTURE_POOL["sv02-127"]?.types).toEqual(["Fighting"]);
    // ONE attack only — which is what makes INDEX 0 a fact rather than a guess.
    // D139 found Pour Tea at index 1 on a card with two, so the check is not idle.
    expect(FIXTURE_POOL["sv02-127"]?.attacks).toHaveLength(1);
    expect(LAND_SCOOP_INDEX).toBe(0);
  });

  it("costs ZERO registry ATTACK rows, on all FOUR printings", () => {
    // If the card grew a row the registry would win (`programFor(id)?.attack?.[i]
    // ?? derive`) and every assertion above would keep passing while testing
    // nothing about the text.
    for (const id of PRINTINGS) {
      expect(programFor(id)?.attack, id).toBeUndefined();
    }
    // ⚠️ AND TING-LU EX IS THE SAME KIND OF WITNESS MIMIKYU WAS AT D139: it HAS a
    // registry row — the Cursed Land ability-lock passive (D100) — and its attack
    // still derives off printed text. A row on the CARD is not a row on the ATTACK,
    // the distinction D135 got wrong in the other direction, and all four printings
    // share the one program.
    for (const id of PRINTINGS) {
      expect(programFor(id)?.passive, id).toEqual({
        disableAbilities: {
          side: "opponent",
          requiresDamage: true,
          requiresActive: true,
          exemptSuffix: "ex",
        },
      });
    }
    expect(new Set(PRINTINGS.map((id) => programFor(id)))).toHaveProperty("size", 1);
  });
});

describe("end to end — D125's tail: the 150, then the pick, then the placement", () => {
  it("hits the Defender for 150 FIRST, then PARKS on which Benched body", () => {
    // §8's printed order and D125's tail placement, driven rather than assumed:
    // the attack's own `damage` field runs through the full §8.5 pipeline BEFORE
    // the effect program, and the program's park sits behind it with the epilogue
    // still queued.
    let state = tingLuActive(board(), "p1");
    state = bench(state, "p2", ["fix-titan", "fix-titan"]);
    const defender = activeUid(state, "p2");
    const { state: parked, events } = declare(state);

    expect(types(events)).toEqual(["ATTACK_DECLARED", "DAMAGE_DEALT", "EFFECT_PENDING"]);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      seat: "p2",
      uid: defender,
      base: LAND_SCOOP_DAMAGE,
      dealt: LAND_SCOOP_DAMAGE,
    });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(parked.players.p2.active?.damage).toBe(LAND_SCOOP_DAMAGE);

    // THE PROMPT: exactly one, mandatory, over the OPPONENT's Bench only. The
    // printed "1 of" is a floor as well as a ceiling — no "up to" anywhere on this
    // card — so min and max are both 1 and the pick is not declinable.
    const prompt = multiPrompt(parked);
    expect(prompt.min).toBe(1);
    expect(prompt.max).toBe(1);
    expect(prompt.declinable).toBe(false);
    expect(prompt.candidates).toEqual([P2_BENCH_0, P2_BENCH_1]);
    expect(prompt.candidates).not.toContainEqual(P2_ACTIVE);
    expect(prompt.candidates).not.toContainEqual(P1_ACTIVE);
    // The heading quotes the printed unit back — COUNTERS, not the HP the op
    // carries — so a player never reads the internal number.
    expect(prompt.note).toBe(
      "Choose 1 of your opponent's Benched Pokémon (2 damage counters each).",
    );

    // …and the pick lands 20 on the chosen body and nothing on the other.
    const chosen = benchTopUid(parked, "p2", 0);
    const { state: done, events: resolved } = mustApply(parked, pick(P2_BENCH_0));
    expect(all(resolved, "COUNTERS_PLACED")).toEqual([
      { type: "COUNTERS_PLACED", seat: "p2", uid: chosen, amount: LAND_SCOOP_HP, source: "attack" },
    ]);
    expect(done.players.p2.bench[0]?.damage).toBe(LAND_SCOOP_HP);
    expect(done.players.p2.bench[1]?.damage).toBe(0);
    // NOT a DAMAGE_DEALT row for the placement — the event TYPE is as much the
    // claim as the number, since DAMAGE_DEALT carries weakness/resistance fields
    // precisely because it went through the pipeline. The 150 did; this did not.
    expect(types(resolved)).not.toContain("DAMAGE_DEALT");
    expect(types(resolved)).toEqual([
      "COUNTERS_PLACED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
    // The ATTACKER is untouched — this sentence has no cost and no recoil.
    expect(done.players.p1.active?.damage).toBe(0);
  });

  it("adds onto EXISTING damage rather than setting it", () => {
    let state = tingLuActive(board(), "p1");
    state = bench(state, "p2", ["fix-titan", "fix-titan"]);
    state = setBenchDamage(state, "p2", 1, BENCH_HURT);
    const { state: parked } = declare(state);
    const { state: done } = mustApply(parked, pick(P2_BENCH_1));
    expect(done.players.p2.bench[1]?.damage).toBe(BENCH_HURT + LAND_SCOOP_HP);
    expect(done.players.p2.bench[1]?.damage).not.toBe(LAND_SCOOP_HP);
  });

  it("FORCES a single benched body — one action, no prompt at all", () => {
    // §8.6 "do as much as you can", and the M1 no-choice doctrine: a mandatory pick
    // over exactly `count` candidates has no decision left in it, so it auto-takes.
    // The whole declaration is then ONE event batch.
    let state = tingLuActive(board(), "p1");
    state = bench(state, "p2", ["fix-titan"]);
    const only = benchTopUid(state, "p2", 0);
    const { state: done, events } = declare(state);

    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "COUNTERS_PLACED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(find(events, "COUNTERS_PLACED")).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p2",
      uid: only,
      amount: LAND_SCOOP_HP,
      source: "attack",
    });
    expect(done.players.p2.bench[0]?.damage).toBe(LAND_SCOOP_HP);
  });

  it("an EMPTY opponent Bench is a silent WHIFF, and NOT an ATTACK_EFFECT_SKIPPED", () => {
    // D135's ending, one family on: a derived program means the sentence WAS read,
    // whatever it then did (`attack.ts`'s `effectSimulated` is `program !== null`).
    // So there is no prompt, no COUNTERS_PLACED and no loud row — and the printed
    // 150 still lands, because the placement is a rider on it rather than the whole
    // attack.
    const state = tingLuActive(board(), "p1");
    expect(state.players.p2.bench).toHaveLength(0);
    const { state: done, events } = declare(state);

    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(LAND_SCOOP_DAMAGE);
    expect(done.players.p2.active?.damage).toBe(LAND_SCOOP_DAMAGE);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("runs from the OTHER SEAT too — the row's `seat` is derived, not hardcoded", () => {
    // Every case above attacks from p1, so a build that wrote "p2" into the
    // placement passes all of them.
    let state = board();
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = tingLuActive(state, "p2");
    state = bench(state, "p1", ["fix-titan", "fix-titan"]);
    const { state: parked, events } = declare(state, "p2");

    expect(multiPrompt(parked).candidates).toEqual([
      { seat: "p1", spot: { spot: "bench", index: 0 } },
      { seat: "p1", spot: { spot: "bench", index: 1 } },
    ]);
    expect(find(events, "DAMAGE_DEALT")?.seat).toBe("p1");
    const chosen = benchTopUid(parked, "p1", 1);
    const { state: done, events: resolved } = mustApply(
      parked,
      pick({ seat: "p1", spot: { spot: "bench", index: 1 } }, "p2"),
    );
    expect(find(resolved, "COUNTERS_PLACED")).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p1",
      uid: chosen,
      amount: LAND_SCOOP_HP,
      source: "attack",
    });
    // …and the attacker's OWN side took nothing.
    expect(done.players.p2.active?.damage).toBe(0);
    expect(done.players.p2.bench.every((p) => p.damage === 0)).toBe(true);
  });

  it("consumes NO rng across the whole park-and-resolve round trip", () => {
    // The amount is read off the TEXT and the target off a choice, so this suite
    // runs on one board with no seed sweep. Worth an assertion rather than a
    // comment: a build that reached for a flip would desynchronise the next coin in
    // an online match — and the PARK is where a re-shuffle would hide.
    let state = tingLuActive(board(), "p1");
    state = bench(state, "p2", ["fix-titan", "fix-titan"]);
    const { state: parked } = declare(state);
    expect(parked.rngState).toBe(state.rngState);
    const { state: done } = mustApply(parked, pick(P2_BENCH_0));
    expect(done.rngState).toBe(state.rngState);
  });

  it("REJECTS every illegal pick — own board, the Active, an index past the end", () => {
    // "1 of your opponent's Benched Pokémon" is a zone AND a seat scope, and
    // `candidates` is the whole legality rule, so every refusal comes from one
    // membership test. Neither coordinate is hypothetical on a wire: an index is a
    // number a client computes and a seat is a field it fills in.
    let state = tingLuActive(board(), "p1");
    state = bench(state, "p1", ["fix-titan"]);
    state = bench(state, "p2", ["fix-titan", "fix-titan"]);
    const { state: parked } = declare(state);
    const resolve = (choice: unknown) =>
      ({ type: "resolveEffect", seat: "p1", choice }) as Parameters<typeof applyAction>[1];

    // THE ATTACKER'S OWN BENCH — a real Pokémon on the wrong side, and the exact
    // miss the "opponent's" rewrite in the anchor case is about.
    expectErr(
      parked,
      resolve({ kind: "pokemonMulti", refs: [{ seat: "p1", spot: { spot: "bench", index: 0 } }] }),
      "BAD_EFFECT_CHOICE",
    );
    // THE DEFENDER. It is the opponent's and it is in play; the printed word
    // "Benched" is the entire difference, so this is the assertion that the word did
    // work — and it is the one that separates this sentence from Ninetales's
    // any-zone neighbour.
    expectErr(parked, resolve({ kind: "pokemonMulti", refs: [P2_ACTIVE] }), "BAD_EFFECT_CHOICE");
    expectErr(parked, resolve({ kind: "pokemonMulti", refs: [P1_ACTIVE] }), "BAD_EFFECT_CHOICE");
    // AN INDEX PAST THE END — p2 has exactly two benched bodies.
    expectErr(
      parked,
      resolve({ kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "bench", index: 2 } }] }),
      "BAD_EFFECT_CHOICE",
    );
    // TWO REFS for a pick of one — `min === max === 1`, so a superset is not an
    // answer either.
    expectErr(
      parked,
      resolve({ kind: "pokemonMulti", refs: [P2_BENCH_0, P2_BENCH_1] }),
      "BAD_EFFECT_CHOICE",
    );
    // NONE — the pick is mandatory (no printed "up to", no printed "you may"), so
    // the empty set is not the legal decline it is for Hawlucha.
    expectErr(parked, resolve({ kind: "pokemonMulti", refs: [] }), "BAD_EFFECT_CHOICE");
    // And the single-pick shape does not answer a multi prompt.
    expectErr(parked, resolve({ kind: "pokemon", ref: P2_BENCH_0 }), "BAD_EFFECT_CHOICE");
    // The park survived every refusal — a rejected action changes nothing.
    expect(parked.phase.kind).toBe("effect:choose");
  });
});

describe("the placement is FLAT — three benched modifiers it must skip", () => {
  it("skips WEAKNESS — a ×2 FIGHTING body takes 20, not 40", () => {
    // Ting-Lu ex is a FIGHTING attacker, so a build that routed the placement
    // through `snipeActive`'s §8.5 pipeline doubles it. §8.5 already says Weakness
    // never applies on the Bench, so this pins the ROUTE rather than the rule — and
    // it is the weakest of the three claims here for exactly that reason.
    let state = tingLuActive(board(), "p1");
    state = bench(state, "p2", ["fix-fighting-weak"]);
    expect(FIXTURE_POOL["fix-fighting-weak"]?.weaknesses).toEqual([
      { type: "Fighting", value: "×2" },
    ]);
    expect(FIXTURE_POOL["sv02-127"]?.types).toEqual(["Fighting"]);

    const { state: done, events } = declare(state);
    expect(find(events, "COUNTERS_PLACED")?.amount).toBe(LAND_SCOOP_HP);
    expect(done.players.p2.bench[0]?.damage).toBe(LAND_SCOOP_HP);
    expect(done.players.p2.bench[0]?.damage).not.toBe(LAND_SCOOP_HP * 2);
    // The 200 HP body survives every reading a wrong build could produce, so this
    // case measures the AMOUNT and never a promotion.
    expect(FIXTURE_POOL["fix-fighting-weak"]?.hp).toBe(200);
  });

  it("⚠️ skips the REDUCTION passive — Bouffalant takes 20, not 0", () => {
    // THE FIRST CLAIM THAT ACTUALLY SEPARATES THE TWO READINGS. Bouffer reduces
    // "damage from attacks" by 20 AFTER Weakness/Resistance, and `placeSnipe`'s
    // `deals: true` arm applies it on the Bench (that is Wo-Chien's route). A placed
    // counter is not damage from an attack — `damageActive`'s rule verbatim — so a
    // `deals` build reads exactly 0 here where the correct one reads 20.
    let state = tingLuActive(board(), "p1");
    state = bench(state, "p2", ["sv03-174"]);
    expect(programFor("sv03-174")?.passive).toEqual({ damageReductionAfterWR: 20 });
    const target = benchTopUid(state, "p2", 0);

    const { state: done, events } = declare(state);
    expect(all(events, "COUNTERS_PLACED")).toEqual([
      { type: "COUNTERS_PLACED", seat: "p2", uid: target, amount: LAND_SCOOP_HP, source: "attack" },
    ]);
    expect(done.players.p2.bench[0]?.damage).toBe(LAND_SCOOP_HP);
    expect(done.players.p2.bench[0]?.damage).not.toBe(0);
    // The Bouffer body is UNDAMAGED when the passive would be read, on purpose:
    // Ting-Lu ex's own Cursed Land aura strips Abilities from the opponent's
    // DAMAGED non-ex Pokémon, so a pre-damaged Bouffalant would have lost Bouffer
    // anyway and the case would pass for the wrong reason.
    expect(all(events, "DAMAGE_DEALT").map((d) => d.uid)).not.toContain(target);
  });

  it("⚠️ skips the ex/V PREVENTION — Safeguard does NOT stop it, and the attacker IS an ex", () => {
    // THE SHARPEST ASSERTION IN THE SLICE, and one D139 could not buy: Mimikyu's
    // "Safeguard" prevents ALL damage done to it by an opponent's Pokémon ex/V, it
    // has no "Active Spot" clause (so it protects a BENCHED Mimikyu too), and
    // Ting-Lu ex has the rule box that triggers it. A `deals: true` build therefore
    // prevents the hit ENTIRELY and emits a DAMAGE_DEALT carrying `prevented: true`
    // and `dealt: 0`; a placed counter is not "damage done", so the real reading
    // lands 20 and never consults the passive at all.
    let state = tingLuActive(board(), "p1");
    state = bench(state, "p2", ["sv02-097"]);
    expect(programFor("sv02-097")?.passive).toEqual({ preventDamageFromExV: true });
    expect(FIXTURE_POOL["sv02-127"]?.name).toContain(" ex");
    const guarded = benchTopUid(state, "p2", 0);

    const { state: done, events } = declare(state);
    expect(find(events, "COUNTERS_PLACED")).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p2",
      uid: guarded,
      amount: LAND_SCOOP_HP,
      source: "attack",
    });
    expect(done.players.p2.bench[0]?.damage).toBe(LAND_SCOOP_HP);
    // No prevented row anywhere — the placement never reached the arm that could
    // produce one.
    expect(all(events, "DAMAGE_DEALT").every((d) => d.prevented === undefined)).toBe(true);
    expect(all(events, "DAMAGE_DEALT").map((d) => d.uid)).not.toContain(guarded);
  });
});

describe("the KNOCK OUTs it can cause — the epilogue sweep, behind the park", () => {
  it("KOs the benched pick AFTER the choice lands — prize to the ATTACKER", () => {
    // The op only RAISES damage; the sweep is the attack EPILOGUE's two-seat one
    // (flow.ts `finishAttack`), reading the POST-effect board — and it runs after
    // the park just as much as inline, because `settleProgram(..., { resumeTail:
    // true })` leaves `attackEpilogue` on `state.pending` until the choice lands
    // (D135). So the Knock Out arrives in the RESOLVE batch, not the declare one.
    let state = tingLuActive(board(), "p1");
    state = bench(state, "p2", ["fix-titan", "fix-titan"]);
    state = setBenchDamage(state, "p2", 0, TITAN_HP - LAND_SCOOP_HP);
    const doomed = benchTopUid(state, "p2", 0);

    const { state: parked, events } = declare(state);
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(parked.pending.length).toBeGreaterThan(0);

    const { state: after, events: resolved } = mustApply(parked, pick(P2_BENCH_0));
    expect(types(resolved)).toEqual(["COUNTERS_PLACED", "KNOCKED_OUT", "PRIZES_OWED"]);
    expect(find(resolved, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: doomed });
    // THE PRIZE IS OWED TO THE ATTACKER — the seat that declared, not the seat that
    // owns the Knocked Out body. fix-titan carries no rule box, so it is exactly
    // one, and WHICH prize card is a decision, so the resolution stops here.
    expect(find(resolved, "PRIZES_OWED")).toEqual({ type: "PRIZES_OWED", seat: "p1", count: 1 });
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    expect(types(resolved)).not.toContain("TURN_ENDED");
    // …and taking the prize drains the rest of the tail.
    const { state: done } = mustApply(after, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(done.players.p1.prizes).toHaveLength(5);
    expect(done.players.p2.bench).toHaveLength(1);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("stops ONE point short and does not KO — the boundary, not just the crossing", () => {
    // The complement: a build that swept on "damage >= hp - 10" (a counters-vs-HP
    // confusion in the KO check rather than in the reader) Knocks this body out too.
    let state = tingLuActive(board(), "p1");
    state = bench(state, "p2", ["fix-titan"]);
    state = setBenchDamage(state, "p2", 0, TITAN_HP - LAND_SCOOP_HP - 10);
    const { state: done, events } = declare(state);

    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(done.players.p2.bench[0]?.damage).toBe(TITAN_HP - 10);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("sweeps BOTH boards' Knock Outs at once — the 150's and the placement's", () => {
    // The declaration can Knock Out TWO bodies: the Defender from the printed 150
    // and the chosen Benched one from the counters. Both land in the epilogue's
    // single two-seat sweep, so the prizes are owed together — which is the
    // strongest statement that the placement joins the attack's tail rather than
    // running as its own event.
    let state = tingLuActive(board(), "p1");
    state = setDamage(state, "p2", TITAN_HP - LAND_SCOOP_DAMAGE);
    state = bench(state, "p2", ["fix-titan", "fix-titan"]);
    state = setBenchDamage(state, "p2", 1, TITAN_HP - LAND_SCOOP_HP);
    const defender = activeUid(state, "p2");
    const doomed = benchTopUid(state, "p2", 1);

    const { state: parked, events } = declare(state);
    // The Defender is already lethally hit, and the KO still waits for the pick.
    expect(find(events, "DAMAGE_DEALT")?.damage).toBe(TITAN_HP);
    expect(types(events)).not.toContain("KNOCKED_OUT");

    const { state: after, events: resolved } = mustApply(parked, pick(P2_BENCH_1));
    // BOTH Knock Outs land in ONE sweep, in ONE batch — the sharpest statement
    // that the placement joins the attack's tail rather than running as its own
    // event.
    expect(all(resolved, "KNOCKED_OUT").map((k) => k.uid)).toEqual([defender, doomed]);
    expect(after.players.p2.active).toBeNull();
    expect(after.players.p2.bench).toHaveLength(1);
    // …and the PRIZES are queued as ONE STAGE PER KNOCK OUT rather than one summed
    // row: `advance` stops at the first, so the batch carries a single
    // `PRIZES_OWED` of 1 and the second stage waits behind it. Pinned because a
    // reader of "2 KOs" would otherwise expect a 2 here, and both are on the
    // ATTACKER's seat.
    expect(all(resolved, "PRIZES_OWED")).toEqual([{ type: "PRIZES_OWED", seat: "p1", count: 1 }]);
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    const { state: mid } = mustApply(after, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(mid.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    const { state: done } = mustApply(mid, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(done.players.p1.prizes).toHaveLength(4);
  });
});

describe("the log — an ATTACK's bench placement must not be labelled an Ability", () => {
  it("renders a SYSTEM row in the printed verb, and never the word Ability", () => {
    // D136's finding 1, refused at the source for the THIRD time (D138's "moved",
    // D139's "attack", and now the op that carried the hardcoded string).
    // `COUNTERS_PLACED.seat` OWNS the damaged Pokémon — here the attacker's
    // OPPONENT — and rows render after their seat's name, so an active-voice row
    // under this seat would read as the victim doing it to itself. And the
    // `"ability"` arm prints the literal word Ability, which on an attack is simply
    // false.
    let state = tingLuActive(board(), "p1");
    state = bench(state, "p2", ["fix-titan"]);
    const { state: done, events } = declare(state);
    const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state: done, elapsed: "+00:14" };
    const rendered = logFromEvents(events, ctx).flatMap((entry) =>
      entry.kind === "turn"
        ? []
        : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
    );

    const placed = rendered.find((r) => r.text.startsWith("Put:"));
    expect(placed).toBeDefined();
    expect(placed?.who).toBe("system");
    expect(placed?.text).toContain(String(LAND_SCOOP_HP));
    // THE LABEL THE HARDCODED STRING WOULD HAVE PRINTED. This is the assertion that
    // fails the moment somebody "simplifies" the field away or restores the literal.
    expect(placed?.text).not.toContain("Ability");
    // The ACTOR is named by the ATTACK_DECLARED row directly above — D136's own
    // argument for a passive/system row over an actor field — and the 150 renders as
    // its OWN row in between, so a reader can tell the two halves apart.
    const declared = rendered.find((r) => r.text.includes("Land Scoop"));
    expect(declared?.who).toBe("p1");
    expect(rendered.indexOf(declared as (typeof rendered)[number])).toBeLessThan(
      rendered.indexOf(placed as (typeof rendered)[number]),
    );
    expect(rendered.some((r) => r.text.includes(String(LAND_SCOOP_DAMAGE)))).toBe(true);
  });

  it("still renders MEOWSCARADA's placement as an Ability row — the other producer", () => {
    // The field is only meaningful if BOTH values reach the log, so the `"ability"`
    // arm is asserted here rather than left to an older suite: one op, two
    // provenances, two rows. Built from the registry row's own `source` so a build
    // that flipped the default breaks this and nothing else.
    const authored = programFor("sv02-015")?.abilities?.[0]?.program?.[1] as {
      source: "ability" | "attack";
    };
    expect(authored.source).toBe("ability");
    const state = board();
    const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: "+00:14" };
    const uid = benchTopUid(bench(state, "p2", ["fix-titan"]), "p2", 0);
    const rows = logFromEvents(
      [
        {
          type: "COUNTERS_PLACED",
          seat: "p2",
          uid,
          amount: 30,
          source: authored.source,
        },
      ],
      { ...ctx, state: bench(state, "p2", ["fix-titan"]) },
    ).flatMap((entry) =>
      entry.kind === "turn"
        ? []
        : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
    );
    expect(rows[0]?.who).toBe("system");
    expect(rows[0]?.text.startsWith("Ability: ")).toBe(true);
    expect(rows[0]?.text).not.toContain("Put:");
  });
});
