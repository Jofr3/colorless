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

/** The three Standard-legal sentences, verbatim off remote D1 `colorless`
    (`735f0fb5-…`, 2026-08-15) through `json_each(attacks_json)`. */
const HEX_HURL = "Put 2 damage counters on your opponent's Benched Pokémon in any way you like.";
const PHANTOM_DIVE =
  "Put 6 damage counters on your opponent's Benched Pokémon in any way you like.";
const CURSED_DROP = "Put 4 damage counters on your opponent's Pokémon in any way you like.";

const LEGAL_SPREAD: readonly (readonly [string, number])[] = [
  [PHANTOM_DIVE, 4], // Dragapult ex sv06-130 / sv06-200 / sv08.5-073 / sv08.5-165
  [HEX_HURL, 3], // Flutter Mane svp-097 / sv05-078 / sv08.5-043
  [CURSED_DROP, 1], // Sinistcha sv06-022 — and the ONLY producer of the `opponentAny` branch
] as const;

const ROTATED_SPREAD: readonly (readonly [string, number])[] = [
  ["Put 8 damage counters on your opponent's Pokémon in any way you like.", 2], // sv01-090 / sv04.5-156
  ["Put 5 damage counters on your opponent's Benched Pokémon in any way you like.", 2], // sv04-076 / sv04-224
  ["Put 3 damage counters on your opponent's Pokémon in any way you like.", 2], // sv03.5-122 / sv03.5-179
  ["Put 3 damage counters on your opponent's Benched Pokémon in any way you like.", 1], // sv03.5-094
] as const;

const SCALED_PILE_TWIN =
  "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.";

/** THE NEAR MISSES — all real catalog rows, all sharing this sentence's opening
    noun phrase, and each refused on a DIFFERENT axis. */
const NEAR_MISSES = [
  // THE DETERMINER, and the whole difference from arm 23: "1 of" makes it ONE body
  // taking N counters where this anchor makes N counters each name their own.
  "Put 2 damage counters on 1 of your opponent's Benched Pokémon.",
  "Put 6 damage counters on 1 of your opponent's Benched Pokémon.",
  "Put 3 damage counters on each of your opponent's Benched Pokémon that has any damage counters on it.",
  "Put 1 damage counter on each of your opponent's Pokémon for each of your Maushold in play.",
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
      expect(op).not.toHaveProperty("deals");
      expect(op).not.toHaveProperty("ignoreWR");
      expect(op).not.toHaveProperty("optional");
      expect(op).not.toHaveProperty("perTakenPrize");
    }
    expect(new Set(ops.map((op) => JSON.stringify(op))).size).toBe(1);
  });

  it("converts counters → HP PER OP, and fails at a factor of ten either way", () => {
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
    expect(deriveAttackEffect(clause(0))).toBeNull();
    expect(deriveAttackEffect(clause(0))).not.toEqual([]);
  });

  it("is the SAME op arm 23 emits — D132's inventory rule, at the eighth instance", () => {
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
    const UNREAD = NEAR_MISSES.slice(2, NEAR_MISSES.length - 1);
    expect(NEAR_MISSES).toHaveLength(6);
    expect(UNREAD).toHaveLength(3);
    expect(UNREAD).not.toContain(SCALED_PILE_TWIN);
    for (const text of UNREAD) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    expect(deriveAttackEffect(SCALED_PILE_TWIN), SCALED_PILE_TWIN).not.toEqual(
      spread(2, "opponentBench"),
    );
    expect(deriveAttackEffect(SCALED_PILE_TWIN)?.map((o) => o.op)).toEqual([
      "damageChosen",
      "discardPileRetrieval",
      "shuffleDeck",
    ]);
    const HP_TARGET =
      "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10.";
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
    expect(
      deriveAttackEffect(
        "Put 2 damage counters on your opponent’s Benched Pokémon in any way you like.",
      ),
    ).toEqual(spread(2, "opponentBench"));
  });
});

describe("the CENSUS — 8 legal printings on 3 sentences, pinned against a live corpus", () => {
  it("resolves EXACTLY the three legal sentences in the committed corpus", () => {
    const hits = legalAttackCorpus().filter(([, sentence]) => {
      const ops = deriveAttackEffect(sentence);
      return (
        ops !== null &&
        ops.length > 1 &&
        ops.every((op) => (op as { op: string }).op === "damageChosen") &&
        ops.every((op) => (op as { deals?: true }).deals === undefined)
      );
    });
    expect(hits.map(([, s]) => s).sort()).toEqual(LEGAL_SPREAD.map(([s]) => s).sort());
    expect(hits).toHaveLength(3);
    expect(hits.reduce((sum, [units]) => sum + units, 0)).toBe(8);
    expect(
      hits.map(([units, s]) => [s, units] as const).sort((a, b) => a[0].localeCompare(b[0])),
    ).toEqual([...LEGAL_SPREAD].sort((a, b) => a[0].localeCompare(b[0])));
    const PICK_WITH_REPLACEMENT =
      "Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance.";
    const intruder = deriveAttackEffect(PICK_WITH_REPLACEMENT);
    expect(intruder).toHaveLength(6);
    expect((intruder ?? []).every((op) => (op as { op: string }).op === "damageChosen")).toBe(true);
    expect((intruder ?? []).every((op) => (op as { deals?: true }).deals === true)).toBe(true);
    expect(hits.map(([, s]) => s)).not.toContain(PICK_WITH_REPLACEMENT);
    for (const [sentence] of LEGAL_SPREAD) {
      const ops = deriveAttackEffect(sentence) ?? [];
      expect(ops.length, sentence).toBeGreaterThan(1);
      expect(
        ops.every((op) => (op as { deals?: true }).deals === undefined),
        sentence,
      ).toBe(true);
    }
  });

  it("reads the SEVEN rotated-out printings too — legality is not a regex property", () => {
    for (const [sentence, printings] of ROTATED_SPREAD) {
      expect(deriveAttackEffect(sentence), sentence).not.toBeNull();
      expect(printings).toBeGreaterThan(0);
    }
    expect(ROTATED_SPREAD).toHaveLength(4);
    expect(ROTATED_SPREAD.reduce((sum, [, n]) => sum + n, 0)).toBe(7);
    const corpus = new Set(legalAttackCorpus().map(([, s]) => s));
    for (const [sentence] of ROTATED_SPREAD) {
      expect(corpus.has(sentence), sentence).toBe(false);
    }
    expect(LEGAL_SPREAD.length + ROTATED_SPREAD.length).toBe(7);
    expect(
      LEGAL_SPREAD.reduce((s, [, n]) => s + n, 0) + ROTATED_SPREAD.reduce((s, [, n]) => s + n, 0),
    ).toBe(15);
  });

  it("buys no registry row — the eight printings are reader-keyed, all of them", () => {
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

  it("lets ALL N stack on ONE body — 'in any way you like' includes 'all here'", () => {
    let state = flutterMane(board());
    state = bench(state, "p2", ["fix-titan", "fix-titan"]);
    const first = declare(state);
    const a = mustApply(first.state, pick(P2_BENCH_0));
    const b = mustApply(a.state, pick(P2_BENCH_0));
    expect(b.state.players.p2.bench[0]?.damage).toBe(20);
    expect(b.state.players.p2.bench[1]?.damage).toBe(0);
  });

  it("keeps a LETHAL body in the candidate set across every pick", () => {
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
