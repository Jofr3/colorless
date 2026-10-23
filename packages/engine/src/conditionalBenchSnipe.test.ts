import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackCopy,
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

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

const READERS: readonly ((text: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackCancelRequirement,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackBonusConsequent,
];

const TAKEN =
  "If there are 3 or fewer cards in your deck, this attack also does 120 damage to 2 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const TAKEN_CLAUSE = "there are 3 or fewer cards in your deck";

const TWIN = "If there are 3 or fewer cards in your deck, this attack does 200 more damage.";

/** The printed control on the SAME body — index 1, no clause, and a sentence
    `deriveAttackEffect` has read for many slices. It is the attack that ARMS the
    clause, which is why it is not inert (see §5). */
const ENTANGLING_WHIP = "Discard the top 3 cards of your deck.";

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

function armed(seed: number, deck: number, benched: number): GameState {
  let state = mustApply(ready(seed), { type: "endTurn", seat: "p2" }).state;
  for (let i = 0; i < benched; i += 1) state = benchFromDeck(state, "p2", "fix-titan");
  return trimDeckTo(state, "p1", deck);
}

// ── §1 ─────────────────────────────────────────────────────────────────────────

describe("§1 — the price, RE-DERIVED off the corpus rather than inherited", () => {
  it("D419 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the gated sentence is real, is worth ONE printing, and was refused by all nine", () => {
    expect(corpus().filter(([, s]) => s === TAKEN)).toHaveLength(1);
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(1);
    expect(TAKEN.startsWith(`If ${TAKEN_CLAUSE}, `)).toBe(true);
    expect(TWIN.startsWith(`If ${TAKEN_CLAUSE}, `)).toBe(true);
    expect(TAKEN.slice(`If ${TAKEN_CLAUSE}, `.length)).toBe(
      "this attack also does 120 damage to 2 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    );
  });

  it("the FOUR ungated printings were refused by a LITERAL and nothing else", () => {
    const flatTwos = corpus().filter(([, s]) =>
      /^This attack also does \d+ damage to 2 of your opponent's Benched Pokémon\./.test(s),
    );
    expect(flatTwos).toHaveLength(2);
    expect(units(flatTwos)).toBe(4);
    for (const [, s] of flatTwos) expect(resolvedByAnyReader(s), s).toBe(true);
    expect(units(flatTwos) + 1).toBe(5);
  });

  it("the count-2 arity one anchor over is BUILT, and D401 built the compound beside it too", () => {
    const anyTwos = corpus().filter(([, s]) =>
      /^This attack does \d+ damage to [2-9] of your opponent's Pokémon\./.test(s),
    );
    expect(anyTwos).toHaveLength(2);
    expect(units(anyTwos)).toBe(9);
    for (const [, s] of anyTwos) expect(resolvedByAnyReader(s), s).toBe(true);
    expect(anyTwos.filter(([, s]) => s.includes("those Pokémon"))).toHaveLength(1);
    expect(units(anyTwos.filter(([, s]) => s.includes("those Pokémon")))).toBe(6);
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
  it("the printed sentence derives to a conditionGate over D398's member", () => {
    expect(deriveAttackEffect(TAKEN)).toEqual([
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "conditionGate", cond: { kind: "yourDeckAtMost", count: 3 }, then: [SNIPE] },
    ]);
  });

  it("there is NO `otherwise` arm, and its absence is the printed base's", () => {
    const [gate] = deriveAttackEffect(TAKEN) ?? [];
    if (gate?.op !== "conditionGate") throw new Error("expected a conditionGate");
    expect(gate.otherwise).toBeUndefined();
    expect(Object.hasOwn(gate, "otherwise")).toBe(false);
  });

  it("BOTH numbers are CAPTURED — the amount and the count, at values no printing shares", () => {
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

  it("a printed 0 in EITHER position stays on the loud path", () => {
    for (const text of [
      "If there are 3 or fewer cards in your deck, this attack also does 0 damage to 2 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "If there are 3 or fewer cards in your deck, this attack also does 120 damage to 0 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("the fixture's printed bytes ARE the corpus's — the fixture cannot drift off the card", () => {
    expect(corpus().some(([, s]) => s === TAKEN)).toBe(true);
  });
});

// ── §3 ─────────────────────────────────────────────────────────────────────────

describe("§3 — the count-2 pick on a real board: two DISTINCT bodies, §8.6-clamped", () => {
  it("the gate is FALSE on a full deck — the printed 20 lands and nothing parks", () => {
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

  it("on a SHORT deck it parks for EXACTLY 2 of 3, and the third body takes nothing", () => {
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

  it("the two picks must be DISTINCT — the same body twice is refused", () => {
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

  it("a Bench of exactly 2 AUTO-TAKES both — no decision is left, so no prompt", () => {
    const { state: done, events } = mustApply(armed(3903, 3, 2), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(done.players.p2.bench.map((b) => b.damage)).toEqual([120, 120]);
    expect(done.players.p2.active?.damage).toBe(20);
  });

  it("a Bench of ONE is §8.6's 'do as much as you can' — one hit, not a refusal", () => {
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

  it("an EMPTY Bench whiffs the rider and keeps the printed 20", () => {
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
  it("SAME clause, two consequents, two READERS — and each declines the other's sentence", () => {
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

  it("SAME consequent, an UNMAPPED clause — the sentence stays LOUD", () => {
    for (const [clause, cond] of [
      [
        "your opponent's Active Pokémon is a Tera Pokémon",
        { kind: "opponentActiveIsBanner", banner: "Tera" },
      ],
      [
        "you have any Tera Pokémon on your Bench",
        { kind: "yourBannerPokemonOnBench", banner: "Tera" },
      ],
      [
        "1 of your other Ancient Pokémon used an attack during your last turn",
        { kind: "yourOtherBannerPokemonAttackedLastTurn", banner: "Ancient" },
      ],
    ] as const) {
      const printed = `If ${clause}, this attack also does 120 damage to 2 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)`;
      const [gate] = deriveAttackEffect(printed) ?? [];
      expect(gate?.op === "conditionGate" ? gate.cond : undefined, clause).toEqual(cond);
    }
    const unmapped = [
      "Flamigo is on your Bench",
      "1 of your other Future Pokémon used an attack during your last turn",
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

  it("no OTHER reader claims the gated sentence, so nothing was widened by accident", () => {
    for (const read of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(TAKEN), read.name).toBeNull();
    }
  });

  it("a SECOND sentence after the period is refused — the anchor is whole at BOTH ends", () => {
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

  it("the neighbouring benched shapes keep their OWN ops behind the same clause", () => {
    for (const consequent of [
      "this attack also does 30 damage to each of your opponent's Benched Pokémon.",
      "this attack also does 30 damage to 2 of your opponent's Pokémon.",
      "this attack also does 30 damage to 2 of your opponent's Benched Pokémon that has any damage counters on it.",
    ]) {
      expect(deriveAttackEffect(`If ${TAKEN_CLAUSE}, ${consequent}`), consequent).toBeNull();
    }
    expect(
      deriveAttackEffect(
        `If ${TAKEN_CLAUSE}, this attack also does 30 damage to 2 of your Benched Pokémon.`,
      ),
    ).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "yourDeckAtMost", count: 3 },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          {
            op: "damageChosen",
            target: "yourBench",
            amount: 30,
            count: 2,
            source: "attack",
            deals: true,
          },
        ],
      },
    ]);
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
  it("the clause sits at INDEX 0, and INDEX 1 is what ARMS it", () => {
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

  it("index 0 on a full deck is a bare 20 — the index is not the clause", () => {
    // The guard against a card-keyed rather than index-keyed read, from the other
    // side: the same body, the same index, a deck that fails the clause.
    const { state: done } = mustApply(armed(3908, 40, 3), { type: "attack", seat: "p1", index: 0 });
    expect(done.players.p2.active?.damage).toBe(20);
    expect(done.players.p2.bench.map((b) => b.damage)).toEqual([0, 0, 0]);
  });
});

// ── §6 ─────────────────────────────────────────────────────────────────────────

describe("§6 — the questions this slice had to ask and answer NO to", () => {
  it("the parking op gains NO field, which is why MATCH_RECORD_VERSION stays 25", () => {
    const parked = mustApply(armed(3909, 3, 3), { type: "attack", seat: "p1", index: 0 }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const pending = parked.phase.cont.pendingOp;
    expect(pending).toEqual(SNIPE);
    expect(Object.keys(pending ?? {}).sort()).toEqual(
      ["amount", "count", "deals", "op", "source", "target"].sort(),
    );
  });

  it("the gate itself never reaches the wire — a conditionGate resolves inline", () => {
    // The other half of the same question. `runProgram` splices a gate's branch into
    // the work queue it is already walking, so the CONDITION is gone by the time
    // anything parks: what a record could carry is the op above and nothing else.
    const parked = mustApply(armed(3910, 3, 3), { type: "attack", seat: "p1", index: 0 }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(JSON.stringify(parked.phase.cont)).not.toContain("conditionGate");
    expect(JSON.stringify(parked.phase.cont)).not.toContain("yourDeckAtMost");
  });
});
