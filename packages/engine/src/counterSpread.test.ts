import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { deriveAttackEffect, programFor } from "./index";
import type { EffectOp, GameAction, GameEvent, GameState, PokemonRef, Seat } from "./index";
import {
  COUNTER_SPREAD_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.253.0 → 0.254.0 — THE COUNTER **SPREAD** (D348, arm 23a). "Put {N} damage
// counters on your opponent's [Benched] Pokémon in any way you like." — **8 legal
// printings on 3 sentences**, the largest count this family has mapped in one arm
// since D143's twenty, and a reader that buys NOTHING ELSE.
//
// 🛑 THE FINDING, AND IT IS A PRICE REFUTED RATHER THAN PAID. The handoff priced
// this family as a NEW PROMPT KIND — a counter distribution park, on the argument
// that "`damageChosen` places on ONE body and `moveCountersChosen` moves between
// two; neither can express a many-to-many DISTRIBUTION". It is not one.
// **"In any way you like" at a PRINTED COUNT is N independent ops** (D346, and
// `attachEnergyFrom`'s own doc block since D205); the compound MAP exists for
// *"any NUMBER"*, which has no N to unroll. 6, 2 and 4 are printed counts, so the
// op SEQUENCE is the sentence: N repeated `damageChosen { count: 1, amount: 10 }`,
// an op that has existed since M4 slice 8. **ZERO new ops, ZERO new op fields,
// ZERO new prompt kinds, no `MATCH_RECORD_VERSION` move.**
//
// ⚠️ AND THE UNROLL IS **EXACT** RATHER THAN CLOSE. The printed placement is
// simultaneous; N sequential picks are the same board only if the candidate set
// cannot change between them. Two facts make it identical, and this file DRIVES
// both rather than reasoning about them:
//   1. `snipeTargets` applies **no HP filter** — a body already at lethal is still
//      a candidate.
//   2. A program op **never sweeps Knock Outs**; the sweep is the attack epilogue.
// So stacking all N on one body is legal, spreading them is legal, and the board
// after N picks is the board the card prints. `fix-victim` (30 HP) is in the deck
// precisely to make that a measurement: three of Hex Hurl's counters kill it, and
// a mid-sequence sweep would drop it out of the park between picks.
//
// ⚠️ WHAT THIS FILE PINS THAT PROSE CANNOT. The census below is not a recorded
// number — it LOOPS `legalAttackCorpus()` and pins the arm's population by
// SENTENCE. D347's finding: a population pinned against a live instrument is a
// prose figure that cannot rot silently. The doc block on
// `COUNTER_SPREAD_ON_OPPONENT` in `effects.ts` quotes 8/3, and this is what makes
// that quote answerable to something.

/** The three Standard-legal sentences, verbatim off remote D1 `luminous`
    (`735f0fb5-…`, 2026-08-15) through `json_each(attacks_json)`. */
const HEX_HURL = "Put 2 damage counters on your opponent's Benched Pokémon in any way you like.";
const PHANTOM_DIVE =
  "Put 6 damage counters on your opponent's Benched Pokémon in any way you like.";
const CURSED_DROP = "Put 4 damage counters on your opponent's Pokémon in any way you like.";

/** The three legal sentences with their LEGAL PRINTING counts — the unit that
    matters, and the one D347 caught a slice getting wrong. 4 + 3 + 1 = **8**. */
const LEGAL_SPREAD: readonly (readonly [string, number])[] = [
  [PHANTOM_DIVE, 4], // Dragapult ex sv06-130 / sv06-200 / sv08.5-073 / sv08.5-165
  [HEX_HURL, 3], // Flutter Mane svp-097 / sv05-078 / sv08.5-043
  [CURSED_DROP, 1], // Sinistcha sv06-022 — and the ONLY producer of the `opponentAny` branch
] as const;

/** ⚠️ THE ROTATED-OUT HALF, and it is here because the anchor reads it too — a
    bare `(\d+)` has no CLOSED vocabulary to reject against (D139), so legality is
    not a property the regex can see. **SEVEN printings on FOUR sentences**, at
    three distinct counts. Re-derived on remote D1 2026-08-15, NOT inherited: the
    landed doc block said "five rotated-out printings", which is the SENTENCE list
    `8/5/3/3` wearing a printing count's name. */
const ROTATED_SPREAD: readonly (readonly [string, number])[] = [
  ["Put 8 damage counters on your opponent's Pokémon in any way you like.", 2], // sv01-090 / sv04.5-156
  ["Put 5 damage counters on your opponent's Benched Pokémon in any way you like.", 2], // sv04-076 / sv04-224
  ["Put 3 damage counters on your opponent's Pokémon in any way you like.", 2], // sv03.5-122 / sv03.5-179
  ["Put 3 damage counters on your opponent's Benched Pokémon in any way you like.", 1], // sv03.5-094
] as const;

/** THE NEAR MISSES — all real catalog rows, all sharing this sentence's opening
    noun phrase, and each refused on a DIFFERENT axis. */
const NEAR_MISSES = [
  // THE DETERMINER, and the whole difference from arm 23: "1 of" makes it ONE body
  // taking N counters where this anchor makes N counters each name their own.
  "Put 2 damage counters on 1 of your opponent's Benched Pokémon.",
  "Put 6 damage counters on 1 of your opponent's Benched Pokémon.",
  // A per-target FILTER and a fold — no pick anywhere in it.
  // ⚠️ RE-POINTED AT D450 — this slot held the windowed opponent-side fold (corpus line 414), which D450 MAPPED (arms 23d/23e/23f
  // over `counterEachAll`), so the witness MOVED rather than being deleted (the standing
  // note above). The replacement is the SCALED TWIN, **3 legal printings** and still unread: it shares this anchor's whole opening noun phrase and is refused on its count payload and its tail. The sentence it replaced is not gone from this
  // file: the claim about it is now an INEQUALITY of derived programs below the loop,
  // which is D418's second half and strictly stronger than the `toBeNull` it had.
  "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.",
  "Put 3 damage counters on each of your opponent's Benched Pokémon that has any damage counters on it.",
  // ⚠️ RE-POINTED AT D451. This slot held *"Put damage counters on your opponent's
  // Active Pokémon until its remaining HP is 10."* — "the amount read off the TARGET
  // rather than printed" — which D451 MAPPED (arm 23g over the new op
  // `counterUntilRemainingHp`), so the witness MOVED rather than being deleted and the
  // claim about it is an INEQUALITY of derived programs below the loop. The replacement
  // is the SCALED FOLD: *"Put 1 damage counter on each of your opponent's Pokémon for
  // each of your Maushold in play."* — a real catalog row with **0 Standard-legal
  // printings**, refused on the SINGULAR noun and on a `pokemonInPlay` scale, and the
  // nearest thing this family has to a fold with no pick in it. 🛑 It is named here as
  // a CATALOG row and never through `legalAttackCorpus()`, which would be a claim about
  // the wrong population (D413/D449).
  "Put 1 damage counter on each of your opponent's Pokémon for each of your Maushold in play.",
  // The distribution tail on a MOVE rather than a PUT, and behind a status clause —
  // the one row in the catalog that carries this file's phrase and is NOT its arm.
  "Your opponent's Active Pokémon is now Confused. You may move any number of damage counters from your opponent's Pokémon to their other Pokémon in any way you like.",
  // "any number" rather than a printed count: the compound MAP's shape, which has
  // no N to unroll and is the reading this arm's finding refuses.
  "You may attach any number of Basic Energy cards from your hand to your Pokémon in any way you like.",
] as const;

const P1_ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const P2_ACTIVE: PokemonRef = { seat: "p2", spot: { spot: "active" } };
const P2_BENCH_0: PokemonRef = { seat: "p2", spot: { spot: "bench", index: 0 } };
const P2_BENCH_1: PokemonRef = { seat: "p2", spot: { spot: "bench", index: 1 } };

/** ONE counter, in HP. §12 fixes the unit and the PRODUCER does the conversion —
    the interpreter never sees the printed number and cannot convert twice. */
const ONE_COUNTER_HP = 10;

/** The op every arm-23a sentence unrolls into, at a given zone. The count is the
    LENGTH of the array and never a field — which is the one place this arm could
    have gone wrong in the other direction. */
function spreadOp(target: "opponentBench" | "opponentAny"): EffectOp {
  return {
    op: "damageChosen",
    target,
    amount: ONE_COUNTER_HP,
    count: 1,
    source: "attack",
  } as EffectOp;
}

/** N copies of it — the whole reading of the sentence, written as a REPEAT so the
    test cannot accidentally agree with a build that emitted one fat op. */
function spread(n: number, target: "opponentBench" | "opponentAny"): EffectOp[] {
  return Array.from({ length: n }, () => spreadOp(target));
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** ONE BOARD, NO SWEEP. Nothing here takes a coin, so there is no seed to vary.
    Both Actives are pinned to `fix-titan` (340 HP, no Weakness, no Resistance, NO
    attacks) and BOTH BENCHES ARE EMPTIED — D133's trap: `setActiveFromDeck`
    DISPLACES the Active it replaces onto the Bench, and here the opponent's Bench
    IS the candidate list, so a stray body silently changes what the prompt offers. */
function board(): GameState {
  let state = driveSetup(11, { p1: COUNTER_SPREAD_DECK, p2: COUNTER_SPREAD_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-titan");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return clearBench(clearBench(state, "p1"), "p2");
}

/** Field the `opponentBench` spread body as p1's Active with three Energy — Hex
    Hurl's printed {C}{C}{C}. */
function flutterMane(state: GameState): GameState {
  return attachFromDeck(
    clearBench(setActiveFromDeck(state, "p1", "fix-spread-bench"), "p1"),
    "p1",
    "fix-grass-energy",
    3,
  );
}

/** Field the `opponentAny` spread body as p1's Active with one {G} — Cursed
    Drop's whole printed cost. */
function sinistcha(state: GameState): GameState {
  return attachFromDeck(
    clearBench(setActiveFromDeck(state, "p1", "fix-spread-any"), "p1"),
    "p1",
    "fix-grass-energy",
    1,
  );
}

/** Populate `seat`'s Bench from the deck, in order. */
function bench(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  return ids.reduce((next, id) => benchFromDeck(next, seat, id), state);
}

function declare(state: GameState): { state: GameState; events: GameEvent[] } {
  deepFreeze(state);
  return mustApply(state, { type: "attack", seat: "p1", index: 0 });
}

/** The parked `choosePokemonMulti` prompt, narrowed — a state that did NOT park
    fails HERE rather than three assertions later. */
function multiPrompt(state: GameState): {
  candidates: PokemonRef[];
  min: number;
  max: number;
} {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "choosePokemonMulti") {
    throw new Error(`expected choosePokemonMulti, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt as unknown as {
    candidates: PokemonRef[];
    min: number;
    max: number;
  };
}

function pick(ref: PokemonRef): GameAction {
  return { type: "resolveEffect", seat: "p1", choice: { kind: "pokemonMulti", refs: [ref] } };
}

describe("the SPREAD anchor — N repeated ops, not a new prompt kind", () => {
  it("unrolls each legal sentence into exactly N identical ops", () => {
    expect(deriveAttackEffect(HEX_HURL)).toEqual(spread(2, "opponentBench"));
    expect(deriveAttackEffect(PHANTOM_DIVE)).toEqual(spread(6, "opponentBench"));
    expect(deriveAttackEffect(CURSED_DROP)).toEqual(spread(4, "opponentAny"));
    // 🛑 THE COUNT IS THE **LENGTH**, NOT A FIELD. This is the one direction the
    // build could have gone wrong that still "looks right": one op carrying
    // `count: 6` or `amount: 60` is a different placement entirely — one body
    // taking the lot — and it is exactly what arm 23's sentence means. Both are
    // refused explicitly rather than left to `toEqual` on the right answer.
    expect(deriveAttackEffect(PHANTOM_DIVE)).toHaveLength(6);
    expect(deriveAttackEffect(PHANTOM_DIVE)).not.toEqual([
      { op: "damageChosen", target: "opponentBench", amount: 10, count: 6, source: "attack" },
    ]);
    expect(deriveAttackEffect(PHANTOM_DIVE)).not.toEqual([
      { op: "damageChosen", target: "opponentBench", amount: 60, count: 1, source: "attack" },
    ]);
  });

  it("carries FIVE keys per op, and `deals` is ABSENT rather than false", () => {
    const ops = deriveAttackEffect(PHANTOM_DIVE) ?? [];
    expect(ops).toHaveLength(6);
    for (const op of ops) {
      expect(Object.keys(op as object).sort()).toEqual([
        "amount",
        "count",
        "op",
        "source",
        "target",
      ]);
      // ⚠️ The absence is the whole routing decision, for arm 23's reason verbatim:
      // `deals: true` would emit DAMAGE_DEALT, re-admit the benched reduction
      // passive and the ex/V prevention, and never reach the counter path. A placed
      // counter is not attack damage even when an attack printed it.
      expect(op).not.toHaveProperty("deals");
      expect(op).not.toHaveProperty("ignoreWR");
      expect(op).not.toHaveProperty("optional");
      expect(op).not.toHaveProperty("perTakenPrize");
    }
    // ⚠️ AND EVERY OP IS THE SAME op — a build that unrolled with a decreasing
    // amount, or that marked the last one, would pass every assertion above.
    expect(new Set(ops.map((op) => JSON.stringify(op))).size).toBe(1);
  });

  it("⚠️ converts counters → HP PER OP, and fails at a factor of ten either way", () => {
    // The printed number is COUNTERS, `damageChosen.amount` is HP, §12 fixes one
    // counter at 10. A build that forgot the ×10 places 1 per op; one that applied
    // it to the total places 20 on two ops. Both refused explicitly.
    expect(deriveAttackEffect(HEX_HURL)).toEqual(spread(2, "opponentBench"));
    expect(deriveAttackEffect(HEX_HURL)).not.toEqual([
      { op: "damageChosen", target: "opponentBench", amount: 1, count: 1, source: "attack" },
      { op: "damageChosen", target: "opponentBench", amount: 1, count: 1, source: "attack" },
    ]);
    expect(deriveAttackEffect(HEX_HURL)).not.toEqual([
      { op: "damageChosen", target: "opponentBench", amount: 20, count: 1, source: "attack" },
      { op: "damageChosen", target: "opponentBench", amount: 20, count: 1, source: "attack" },
    ]);
    // AND THE AMOUNT IS A CONSTANT WHERE THE LENGTH IS THE VARIABLE — the exact
    // inverse of arm 23, whose amount scales and whose length is always 1.
    for (const [sentence] of [...LEGAL_SPREAD, ...ROTATED_SPREAD]) {
      const ops = deriveAttackEffect(sentence) ?? [];
      expect(new Set(ops.map((op) => (op as { amount: number }).amount))).toEqual(
        new Set([ONE_COUNTER_HP]),
      );
    }
  });

  it("reads the ZONE off the optional `Benched` capture and nothing else", () => {
    // present → `opponentBench`; absent → `opponentAny`, which offers the ACTIVE too.
    const benched = deriveAttackEffect(HEX_HURL) ?? [];
    const anyZone = deriveAttackEffect(CURSED_DROP) ?? [];
    expect(new Set(benched.map((op) => (op as { target: string }).target))).toEqual(
      new Set(["opponentBench"]),
    );
    expect(new Set(anyZone.map((op) => (op as { target: string }).target))).toEqual(
      new Set(["opponentAny"]),
    );
    // ⚠️ AND THE BRANCH IS EARNED (D104's minimal-shape rule): the `opponentAny`
    // side is not a reading nothing prints — Sinistcha `sv06-022` is a real,
    // Standard-legal printing that omits the word, and it is the ONLY one.
    const anyZoneLegal = LEGAL_SPREAD.filter(([s]) => !s.includes("Benched"));
    expect(anyZoneLegal.map(([, n]) => n)).toEqual([1]);
    // …and the two differ in the TARGET and in nothing else, written as a rebuild
    // rather than as two fresh literals.
    expect(deriveAttackEffect(CURSED_DROP)?.[0]).toEqual({
      ...(deriveAttackEffect(HEX_HURL)?.[0] as object),
      target: "opponentAny",
    });
  });

  it("takes the count from the CAPTURE, and refuses a printed zero", () => {
    const clause = (n: number) =>
      `Put ${n} damage counters on your opponent's Benched Pokémon in any way you like.`;
    expect(deriveAttackEffect(clause(1))).toHaveLength(1);
    expect(deriveAttackEffect(clause(13))).toHaveLength(13);
    expect(deriveAttackEffect(clause(1))).not.toEqual(deriveAttackEffect(clause(13)));
    // ⚠️ `counters >= 1` IS THE GUARD, and it returns NULL rather than an empty
    // program: an attack that silently reported an effect moving nothing is worse
    // than one that reports no effect at all. Leave it loud.
    expect(deriveAttackEffect(clause(0))).toBeNull();
    expect(deriveAttackEffect(clause(0))).not.toEqual([]);
  });

  it("is the SAME op arm 23 emits — D132's inventory rule, at the eighth instance", () => {
    // The op existed before this reader did. Meowscarada ex `sv02-015`'s "Bouquet
    // Magic" has produced `damageChosen { target: "opponentBench", count: 1 }`
    // since M4 slice 8, at amount 30 and through the REGISTRY.
    const authored = programFor("sv02-015")?.abilities?.[0]?.program?.[1] as Record<
      string,
      unknown
    >;
    expect(authored?.op).toBe("damageChosen");
    expect(authored?.count).toBe(1);
    // …and each derived op is that op with two fields changed and NOTHING added —
    // which is the claim "this arm buys a reader and nothing else", asserted rather
    // than stated.
    expect(deriveAttackEffect(HEX_HURL)?.[0]).toEqual({
      ...authored,
      amount: ONE_COUNTER_HP,
      source: "attack",
    });
    expect(Object.keys(authored).sort()).toEqual(
      Object.keys(deriveAttackEffect(HEX_HURL)?.[0] as object).sort(),
    );
  });

  it("refuses the near misses, and stays disjoint from arm 23 in BOTH directions", () => {
    for (const text of NEAR_MISSES) {
      expect(deriveAttackEffect(text), text).not.toEqual(spread(2, "opponentBench"));
    }
    // The determiner is the whole difference, and arm 23 keeps deriving its OWN op
    // rather than returning null — the disjointness is a claim about the TARGET.
    expect(deriveAttackEffect(NEAR_MISSES[0])).toEqual([
      { op: "damageChosen", target: "opponentBench", amount: 20, count: 1, source: "attack" },
    ]);
    expect(deriveAttackEffect(NEAR_MISSES[0])).toHaveLength(1);
    expect(deriveAttackEffect(HEX_HURL)).toHaveLength(2);
    // The four that no anchor in this family reads at all.
    for (const text of NEAR_MISSES.slice(2, 6)) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    // 🆕🆕🆕 **D451 — THE ROW THAT LEFT THIS LIST, AS AN INEQUALITY.** It shares this
    // anchor's verb and its opponent-side possessive and differs on the TAIL: *"in any
    // way you like"* opens a distribution where *"until its remaining HP is N"* closes
    // an arithmetic. An anchor that dropped its tail would claim both, so the claim is
    // made in the form that still goes red on that defect.
    const HP_TARGET = "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10.";
    expect(deriveAttackEffect(HP_TARGET)?.[0]?.op).toBe("counterUntilRemainingHp");
    expect(deriveAttackEffect(HP_TARGET)).not.toEqual(spread(2, "opponentBench"));
    // …and it derives to ONE op where this anchor unrolls to N, which is the structural
    // difference the two readings turn on.
    expect(deriveAttackEffect(HP_TARGET)).toHaveLength(1);
  });

  it("refuses case, punctuation and token rewrites — no /i anywhere on this path", () => {
    for (const text of [
      // NO TRAILING PERIOD — the `$` sits after it.
      "Put 2 damage counters on your opponent's Benched Pokémon in any way you like",
      // A LOWERCASE first word: what keeps every mid-sentence ABILITY printing of
      // this same action off this path, and the reason there is no /i flag.
      "put 2 damage counters on your opponent's Benched Pokémon in any way you like.",
      // THE SINGULAR NOUN — deliberately not a branch; the pool prints only plural.
      "Put 2 damage counter on your opponent's Benched Pokémon in any way you like.",
      // The distribution tail dropped: that is arm 23's sentence minus its determiner,
      // which is a sentence the catalog does not print and this anchor must not invent.
      "Put 2 damage counters on your opponent's Benched Pokémon.",
      // "in any way you want" — the tail is a fixed phrase, not a paraphrase class.
      "Put 2 damage counters on your opponent's Benched Pokémon in any way you want.",
      // YOUR OWN side rather than the opponent's: the destination reversed, the one
      // difference a loose matcher would get catastrophically wrong.
      "Put 2 damage counters on your Benched Pokémon in any way you like.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    // ⚠️ THE POSSESSIVE CARRIES BOTH APOSTROPHES (D136/D137) in its ONE marked slot,
    // and U+2019 is spelled as an ESCAPE rather than typed — a typed one degrades to
    // ASCII in an editor and the case then asserts nothing.
    expect(
      deriveAttackEffect(
        "Put 2 damage counters on your opponent’s Benched Pokémon in any way you like.",
      ),
    ).toEqual(spread(2, "opponentBench"));
  });
});

describe("the CENSUS — 8 legal printings on 3 sentences, pinned against a live corpus", () => {
  it("🛑 resolves EXACTLY the three legal sentences in the committed corpus", () => {
    // ⚠️ THIS IS THE RUNG THAT MAKES THE PROSE ANSWERABLE. `effects.ts`'s doc block
    // quotes "8 legal printings on 3 sentences"; a recorded constant would agree
    // with itself forever. This LOOPS the corpus — the same instrument
    // `censusAtHead` derives `BUILT.attack` from — so widening the anchor by one
    // sentence reddens this file by name.
    const hits = legalAttackCorpus().filter(([, sentence]) => {
      const ops = deriveAttackEffect(sentence);
      return (
        ops !== null &&
        ops.length > 1 &&
        ops.every((op) => (op as { op: string }).op === "damageChosen")
      );
    });
    expect(hits.map(([, s]) => s).sort()).toEqual(LEGAL_SPREAD.map(([s]) => s).sort());
    // THE SENTENCE COUNT and THE PRINTING COUNT are DIFFERENT UNITS and both are
    // pinned — D347's lesson, which caught a printing count wearing a sentence
    // count's name in this very family.
    expect(hits).toHaveLength(3);
    expect(hits.reduce((sum, [units]) => sum + units, 0)).toBe(8);
    // …and the corpus's own per-sentence counts are the ones recorded above, so the
    // 4 / 3 / 1 split cannot drift either.
    expect(
      hits.map(([units, s]) => [s, units] as const).sort((a, b) => a[0].localeCompare(b[0])),
    ).toEqual([...LEGAL_SPREAD].sort((a, b) => a[0].localeCompare(b[0])));
  });

  it("reads the SEVEN rotated-out printings too — legality is not a regex property", () => {
    // ⚠️ A bare `(\d+)` has no CLOSED vocabulary to reject against (D139), so the
    // anchor reads every count the family was ever printed at. That is intended,
    // and it is why the corpus rung above is scoped to `legal_standard = 1` while
    // this one is not.
    for (const [sentence, printings] of ROTATED_SPREAD) {
      expect(deriveAttackEffect(sentence), sentence).not.toBeNull();
      expect(printings).toBeGreaterThan(0);
    }
    expect(ROTATED_SPREAD).toHaveLength(4);
    expect(ROTATED_SPREAD.reduce((sum, [, n]) => sum + n, 0)).toBe(7);
    // 🛑 AND NONE OF THE SEVEN IS IN THE LEGAL CORPUS — which is what makes them
    // rotated rather than merely unlisted, and is the half a hand-kept table gets
    // wrong. The landed doc block said "five rotated-out printings"; `8/5/3/3` is
    // the four SENTENCES, and this is the unit that disagrees with it.
    const corpus = new Set(legalAttackCorpus().map(([, s]) => s));
    for (const [sentence] of ROTATED_SPREAD) {
      expect(corpus.has(sentence), sentence).toBe(false);
    }
    // The whole anchor-shaped population, both halves: 8 + 7 = 15 printings on 7
    // sentences, which is the figure the re-derivation corrected.
    expect(LEGAL_SPREAD.length + ROTATED_SPREAD.length).toBe(7);
    expect(
      LEGAL_SPREAD.reduce((s, [, n]) => s + n, 0) + ROTATED_SPREAD.reduce((s, [, n]) => s + n, 0),
    ).toBe(15);
  });

  it("buys no registry row — the eight printings are reader-keyed, all of them", () => {
    // 🛑 The arm's whole claim is that it authors a READER. If any of the eight ids
    // carried a registry `attack` program, the census would be double-counting it.
    for (const id of [
      "sv06-130",
      "sv06-200",
      "sv08.5-073",
      "sv08.5-165",
      "svp-097",
      "sv05-078",
      "sv08.5-043",
      "sv06-022",
    ]) {
      expect(programFor(id)?.attack, id).toBeUndefined();
    }
  });
});

describe("DRIVEN — the unroll is the printed placement, not an approximation of it", () => {
  it("parks N times, one pick each, and lands N counters", () => {
    // Hex Hurl: {C}{C}{C}, printed 90 damage, TWO counters. The bench holds two
    // bodies, so the spread has somewhere to spread to.
    let state = flutterMane(board());
    state = bench(state, "p2", ["fix-titan", "fix-titan"]);
    const first = declare(state);
    // PARK ONE.
    const promptA = multiPrompt(first.state);
    expect(promptA.min).toBe(1);
    expect(promptA.max).toBe(1);
    const after1 = mustApply(first.state, pick(P2_BENCH_0));
    // PARK TWO — the second op, and the proof that N ops park N times rather than
    // one prompt collecting N refs.
    const promptB = multiPrompt(after1.state);
    expect(promptB.max).toBe(1);
    const after2 = mustApply(after1.state, pick(P2_BENCH_1));
    expect(after2.state.phase.kind).not.toBe("effect:choose");
    // ONE counter each, on two different bodies — the spread the card prints.
    expect(after2.state.players.p2.bench[0]?.damage).toBe(10);
    expect(after2.state.players.p2.bench[1]?.damage).toBe(10);
  });

  it("🛑 lets ALL N stack on ONE body — 'in any way you like' includes 'all here'", () => {
    let state = flutterMane(board());
    state = bench(state, "p2", ["fix-titan", "fix-titan"]);
    const first = declare(state);
    const a = mustApply(first.state, pick(P2_BENCH_0));
    // ⚠️ THE SAME BODY AGAIN. If the interpreter narrowed the candidate set after a
    // pick — treating the sequence as a "distribute across distinct bodies" prompt —
    // this would be rejected, and the reading would be wrong in the direction the
    // handoff's price assumed.
    const b = mustApply(a.state, pick(P2_BENCH_0));
    expect(b.state.players.p2.bench[0]?.damage).toBe(20);
    expect(b.state.players.p2.bench[1]?.damage).toBe(0);
  });

  it("🛑 keeps a LETHAL body in the candidate set across every pick", () => {
    // ⚠️ THIS IS THE RUNG THE WHOLE "EXACT, not close" CLAIM RESTS ON, and it is
    // driven rather than argued. `fix-victim` is 30 HP: three of Hex Hurl's counters
    // would kill it — but Hex Hurl only has two, so the sharper case is Cursed Drop's
    // FOUR. Either way the claim is the same: a body at or past lethal is STILL a
    // candidate on the next pick, because `snipeTargets` applies no HP filter and a
    // program op never sweeps Knock Outs (the sweep is the attack epilogue).
    let state = sinistcha(board());
    state = bench(state, "p2", ["fix-victim", "fix-titan"]);
    const doomed = benchTopUid(state, "p2", 0);
    let cur = declare(state);
    // The declare batch places nothing and sweeps nothing — the park comes first.
    expect(types(cur.events)).not.toContain("KNOCKED_OUT");

    // FOUR picks, ALL on the 30 HP body. It is at lethal after the THIRD.
    const batches: GameEvent[][] = [];
    for (let i = 0; i < 4; i += 1) {
      const prompt = multiPrompt(cur.state);
      // ⚠️ THE CLAIM: the victim is offered EVERY time, including on pick 4 when it
      // is already 10 HP past lethal. `snipeTargets` applies no HP filter, so the
      // candidate set is IDENTICAL at every pick — which is exactly what makes N
      // sequential picks the simultaneous placement the card prints.
      expect(
        prompt.candidates.some(
          (c) => c.spot.spot === "bench" && (c.spot as { index: number }).index === 0,
        ),
        `pick ${i + 1} still offers the lethal body`,
      ).toBe(true);
      expect(prompt.candidates, `pick ${i + 1} candidate count`).toHaveLength(3);
      cur = mustApply(cur.state, pick(P2_BENCH_0));
      batches.push(cur.events);
    }
    expect(cur.state.phase.kind).not.toBe("effect:choose");

    // 🛑 AND THE KNOCK OUT LANDS EXACTLY ONCE, IN THE **LAST** BATCH. The first
    // three picks — including the third, which puts the body AT lethal — sweep
    // nothing at all: a program op never sweeps Knock Outs. A build that swept
    // mid-sequence would KO on pick 3 and then have only two candidates left on
    // pick 4, which is the failure this whole rung exists to refuse.
    expect(types(batches[0] ?? [])).not.toContain("KNOCKED_OUT");
    expect(types(batches[1] ?? [])).not.toContain("KNOCKED_OUT");
    expect(types(batches[2] ?? [])).not.toContain("KNOCKED_OUT");
    const swept = all(batches[3] ?? [], "KNOCKED_OUT");
    expect(swept).toHaveLength(1);
    expect(swept[0]).toMatchObject({ seat: "p2", uid: doomed });
    // 40 HP of counters on a 30 HP body: the placement is not clamped by lethality.
    expect(all(batches[3] ?? [], "COUNTERS_PLACED")).toHaveLength(1);
  });

  it("offers the ACTIVE only on the `opponentAny` branch — the zone, driven", () => {
    // Cursed Drop omits "Benched", so the opponent's ACTIVE is a candidate.
    // ⚠️ TWO bench bodies on both boards, deliberately: at ONE candidate the park
    // is auto-resolved and there is no prompt to read the zone off. The zone claim
    // needs a REAL choice to be a claim about.
    let anyState = sinistcha(board());
    anyState = bench(anyState, "p2", ["fix-titan", "fix-titan"]);
    const anyPrompt = multiPrompt(declare(anyState).state);
    expect(anyPrompt.candidates.some((c) => c.spot.spot === "active")).toBe(true);
    // Hex Hurl prints "Benched", so it is NOT.
    let benchState = flutterMane(board());
    benchState = bench(benchState, "p2", ["fix-titan", "fix-titan"]);
    const benchPrompt = multiPrompt(declare(benchState).state);
    expect(benchPrompt.candidates.some((c) => c.spot.spot === "active")).toBe(false);
    expect(benchPrompt.candidates.every((c) => c.spot.spot === "bench")).toBe(true);
  });

  it("rides the attack's own printed damage — D125's tail order at N picks", () => {
    // Hex Hurl declares a real §8.5 90 BESIDE the placement. The order is
    // damage → program → epilogue sweep, and the placement must not be folded into
    // the damage (which is what `deals` would have done).
    let state = flutterMane(board());
    state = bench(state, "p2", ["fix-titan", "fix-titan"]);
    const first = declare(state);
    // The Defender took the printed 90 BEFORE the program parked.
    const defender = first.state.players.p2.active;
    expect(defender?.damage).toBe(90);
    const a = mustApply(first.state, pick(P2_BENCH_0));
    const b = mustApply(a.state, pick(P2_BENCH_1));
    // …and the Defender is untouched by the two counters, which went to the Bench.
    expect(b.state.players.p2.active?.damage).toBe(90);
    // 🛑 AND CURSED DROP IS THE OTHER END OF THE SPLIT: no printed damage at all,
    // so the family has a driven producer on both sides.
    let noDamage = sinistcha(board());
    noDamage = bench(noDamage, "p2", ["fix-titan"]);
    const drop = declare(noDamage);
    expect(drop.state.players.p2.active?.damage).toBe(0);
  });

  it("places NOTHING, N times over, on a board with no legal target", () => {
    // §8.6 is the only thing that softens the placement: each op is EXACT at 1 and
    // mandatory (no printed "up to", no "you may"), so an empty candidate set places
    // nothing — N times — rather than erroring or stalling the turn.
    const state = flutterMane(board()); // p2's bench was cleared and never repopulated
    const first = declare(state);
    expect(first.state.phase.kind).not.toBe("effect:choose");
    expect(first.state.players.p2.bench).toHaveLength(0);
    // The printed damage still lands: an unplaceable program is not a failed attack.
    expect(first.state.players.p2.active?.damage).toBe(90);
  });

  it("keeps `P1`'s own board out of the candidate set entirely", () => {
    let state = flutterMane(board());
    state = bench(state, "p1", ["fix-titan", "fix-titan"]);
    state = bench(state, "p2", ["fix-titan", "fix-titan"]);
    const prompt = multiPrompt(declare(state).state);
    for (const c of prompt.candidates) {
      expect(c.seat, JSON.stringify(c)).toBe("p2");
    }
    expect(prompt.candidates).not.toContainEqual(P1_ACTIVE);
    expect(prompt.candidates).toContainEqual(P2_BENCH_0);
    expect(prompt.candidates).not.toContainEqual(P2_ACTIVE);
    expect(activeUid(state, "p1")).toBeDefined();
  });
});
