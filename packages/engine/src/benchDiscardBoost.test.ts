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
  discardScaledBoostProgram,
} from "./effects";
import type { AttackDiscardScaledBoost } from "./effects";
import type { GameEvent, GameState } from "./index";
import {
  BENCH_BOOST_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

const attack = { type: "attack", seat: "p1", index: 0 } as const;

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
  deriveAttackOptionalCostBoost,
  deriveAttackCancelRequirement,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackDiscardScaledBoost,
];

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

const TAKEN: readonly (readonly [number, string])[] = [
  [
    6,
    "You may discard up to 2 Energy from your Benched Pokémon. This attack does 60 more damage for each card you discarded in this way.",
  ],
  [
    2,
    "You may discard up to 2 Basic Energy from your Benched Pokémon. This attack does 90 more damage for each card you discarded in this way.",
  ],
];

const BARE = TAKEN[0]?.[1] as string;
const BASIC = TAKEN[1]?.[1] as string;

const MILL =
  "Discard the top card of each player's deck. This attack does 140 more damage for each Energy card discarded in this way.";
const SELF_ATTACH =
  "This attack does 30 damage for each {W} Energy attached to this Pokémon. Before doing damage, you may attach any number of Basic {W} Energy cards from your hand to this Pokémon.";

/** The reading, THROWN rather than asserted non-null: a `!` would be a lint error and,
    worse, would turn a reader that stopped reading into a `null` handed to a builder
    whose failure message names neither. This says which sentence went unread. */
function reading(text: string): AttackDiscardScaledBoost {
  const read = deriveAttackDiscardScaledBoost(text);
  if (read === null) throw new Error(`unread by deriveAttackDiscardScaledBoost: ${text}`);
  return read;
}

describe("D403 §1 — the family this reader takes, measured live over the column", () => {
  it("D419 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the two printed sentences are really in the column, at 6 and 2 printings", () => {
    const rows = legalAttackCorpus();
    for (const [n, text] of TAKEN) {
      expect(
        rows.filter(([, s]) => s === text).map(([c]) => c),
        text,
      ).toEqual([n]);
    }
    expect(units(TAKEN)).toBe(8);
  });

  it("this reader takes EXACTLY those THREE, and no other reader takes any", () => {
    const claimed = legalAttackCorpus().filter(
      ([, s]) => deriveAttackDiscardScaledBoost(s) !== null,
    );
    expect(claimed).toHaveLength(4);
    expect(units(claimed)).toBe(11);
    expect([...claimed].sort()).toEqual(
      [...TAKEN, [2, MILL] as const, [1, SELF_ATTACH] as const].sort(),
    );
    expect(claimed.map(([, s]) => reading(s).kind).sort()).toEqual([
      "benchDiscard",
      "benchDiscard",
      "eachDeckMill",
      "selfHandAttach",
    ]);
    // …and the other ELEVEN refuse both, which is what makes "at most one reader fires
    // per attack" a structural property rather than a rule attack.ts has to keep.
    for (const [, s] of TAKEN) {
      for (const read of READERS) {
        if (read === deriveAttackDiscardScaledBoost) continue;
        expect(read(s), `${read.name} :: ${s}`).toBeNull();
      }
    }
  });

  it("`from your Benched Pokémon` occurs in the WHOLE column on these two only", () => {
    const bench = legalAttackCorpus().filter(([, s]) => s.includes("from your Benched Pokémon"));
    expect(bench).toHaveLength(2);
    expect(units(bench)).toBe(8);
    expect([...bench].sort()).toEqual([...TAKEN].sort());
  });

  it("D490 — the additive half has NO sentence left refused, and THIS reader owns all three", () => {
    const additive = legalAttackCorpus().filter(
      ([, s]) => s.includes("discarded in this way") && s.includes("more damage for each"),
    );
    expect(additive).toHaveLength(3);
    expect(units(additive)).toBe(10);
    const left = additive.filter(([, s]) => deriveAttackDiscardScaledBoost(s) === null);
    expect(left).toEqual([]);
    for (const [, s] of additive) {
      expect(resolvedByAnyReader(s), s).toBe(true);
      for (const read of READERS) {
        if (read === deriveAttackDiscardScaledBoost) {
          expect(read(s), `${read.name} :: ${s}`).not.toBeNull();
        } else {
          expect(read(s), `${read.name} :: ${s}`).toBeNull();
        }
      }
    }
  });

  it("D490 — the mill sentence is a REAL corpus row at 2 printings, byte for byte", () => {
    const rows = legalAttackCorpus().filter(([, s]) => s === MILL);
    expect(rows.map(([n]) => n)).toEqual([2]);
    expect(MILL.codePointAt(MILL.indexOf("player") + 6)).toBe(0x27);
  });
});

describe("D403 §2 — the reading, and the program the assembler builds from it", () => {
  it("every capture is a field of the two ops", () => {
    expect(deriveAttackDiscardScaledBoost(BARE)).toEqual({
      kind: "benchDiscard",
      cap: 2,
      per: 60,
      filter: { kind: "anyEnergy" },
    });
    expect(deriveAttackDiscardScaledBoost(BASIC)).toEqual({
      kind: "benchDiscard",
      cap: 2,
      per: 90,
      filter: { kind: "basicEnergy" },
    });
    expect(deriveAttackDiscardScaledBoost(MILL)).toEqual({ kind: "eachDeckMill", per: 140 });
  });

  it("the assembler folds the PRINTED BASE into the ONE damage op", () => {
    // The whole reason this is a reader plus an exported builder rather than a
    // `deriveAttackEffect` arm: `deriveAttackEffect` takes only a string, so a
    // captured `more` would have produced an op whose `base` nothing could populate.
    expect(discardScaledBoostProgram(reading(BARE), 50)).toEqual([
      {
        op: "discardEnergy",
        from: "yourBench",
        filter: { kind: "anyEnergy" },
        count: "any",
        cap: 2,
        recordAs: "discarded",
      },
      { op: "damageDefender", base: 50, per: 60, count: "discarded" },
    ]);
    expect(discardScaledBoostProgram(reading(BASIC), 30)).toEqual([
      {
        op: "discardEnergy",
        from: "yourBench",
        filter: { kind: "basicEnergy" },
        count: "any",
        cap: 2,
        recordAs: "discarded",
      },
      { op: "damageDefender", base: 30, per: 90, count: "discarded" },
    ]);
  });

  it("`base` is SPELLED even at zero — one reading, one program shape", () => {
    const [, hit] = discardScaledBoostProgram(reading(BARE), 0);
    expect(hit).toEqual({ op: "damageDefender", base: 0, per: 60, count: "discarded" });
    expect(Object.keys(hit ?? {}).includes("base")).toBe(true);
  });

  it("`deriveAttackEffect` refuses BOTH — the two producers are disjoint", () => {
    for (const [, s] of TAKEN) expect(deriveAttackEffect(s), s).toBeNull();
  });
});

describe("D403 §3 — the refusals, each pinned on ONE printed byte", () => {
  it("the FOLD, the ZONE and the OFFER each refuse INDEPENDENTLY", () => {
    expect(deriveAttackDiscardScaledBoost(BARE)).not.toBeNull();
    expect(
      deriveAttackDiscardScaledBoost(
        "You may discard up to 2 Energy from your Benched Pokémon. This attack does 60 damage for each card you discarded in this way.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDiscardScaledBoost(
        "You may discard up to 2 Energy from your Pokémon. This attack does 60 more damage for each card you discarded in this way.",
      ),
    ).toBeNull();
    // …the OFFER alone: the printed "You may" taken out. The catalog prints this
    // family's quantifier as ONE coupled phrase; a mandatory "Discard up to 2" is a
    // sentence nobody prints, and admitting it would derive a park with no decline.
    expect(
      deriveAttackDiscardScaledBoost(
        "Discard up to 2 Energy from your Benched Pokémon. This attack does 60 more damage for each card you discarded in this way.",
      ),
    ).toBeNull();
  });

  it("the FILTER is the printed contrast and not the nine-type map", () => {
    for (const text of [
      "You may discard up to 2 {W} Energy from your Benched Pokémon. This attack does 60 more damage for each card you discarded in this way.",
      "You may discard up to 2 Water Energy from your Benched Pokémon. This attack does 60 more damage for each card you discarded in this way.",
      "You may discard up to 2 Special Energy from your Benched Pokémon. This attack does 60 more damage for each card you discarded in this way.",
    ]) {
      expect(deriveAttackDiscardScaledBoost(text), text).toBeNull();
    }
  });

  it("a printed 0 in EITHER number stays loud — no silent no-op", () => {
    expect(
      deriveAttackDiscardScaledBoost(
        "You may discard up to 0 Energy from your Benched Pokémon. This attack does 60 more damage for each card you discarded in this way.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDiscardScaledBoost(
        "You may discard up to 2 Energy from your Benched Pokémon. This attack does 0 more damage for each card you discarded in this way.",
      ),
    ).toBeNull();
    // …and 1 is fine in both slots, so the guards are `>= 1` and not `> 1`.
    expect(
      deriveAttackDiscardScaledBoost(
        "You may discard up to 1 Energy from your Benched Pokémon. This attack does 1 more damage for each card you discarded in this way.",
      ),
    ).toEqual({ kind: "benchDiscard", cap: 1, per: 1, filter: { kind: "anyEnergy" } });
  });

  it("the anchor is WHOLE-SENTENCE — a leading or trailing clause is refused", () => {
    for (const text of [
      `Draw a card. ${BARE}`,
      `${BARE} Draw a card.`,
      BARE.replace("You may", "you may"),
      BARE.replace("This attack does", "this attack does"),
      // The halves alone: neither is anybody's sentence.
      "You may discard up to 2 Energy from your Benched Pokémon.",
      "This attack does 60 more damage for each card you discarded in this way.",
    ]) {
      expect(deriveAttackDiscardScaledBoost(text), text).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE BOARD. Two fixtures, one per printed filter.
// ─────────────────────────────────────────────────────────────────────────────

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1 goes second, so their
    first turn carries no §4 attack restriction. */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: BENCH_BOOST_DECK, p2: BENCH_BOOST_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields `attacker` holding ONE `fix-energy` (the printed {C} cost, attached to the
    ACTIVE — which is the body `from: "yourBench"` must never offer), with `bench`
    Energy on a single benched `fix-bigbody`. P2's Active is `defender`. */
function fielded(
  seed: number,
  attacker: string,
  bench: readonly (readonly [string, number])[],
  defender = "fix-bigbody",
): { state: GameState; benchIndex: number } {
  let state = setActiveFromDeck(board(seed), "p1", attacker);
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = benchFromDeck(state, "p1", "fix-bigbody");
  const benchIndex = state.players.p1.bench.length - 1;
  for (const [id, n] of bench) state = attachBenchFromDeck(state, "p1", benchIndex, id, n);
  return { state: setActiveFromDeck(state, "p2", defender), benchIndex };
}

function discardPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
  return state.phase.prompt;
}

function benchEnergy(state: GameState, index: number): string[] {
  return [...(state.players.p1.bench[index]?.energy ?? [])];
}

describe("D403 §4 — the Bench-only zone, and the caption it forced", () => {
  it("the ACTIVE's Energy is NOT offered — this is what `yourBench` buys", () => {
    const { state, benchIndex } = fielded(1, "fix-benchboost", [["fix-lightning-energy", 3]]);
    const activeEnergy = [...(state.players.p1.active?.energy ?? [])];
    const bench = benchEnergy(state, benchIndex);
    expect(activeEnergy).toHaveLength(1);
    expect(bench).toHaveLength(3);
    deepFreeze(state);

    const { state: parked, events } = mustApply(state, attack);

    expect(parked.phase.kind).toBe("effect:choose");
    expect(discardPrompt(parked).discardable.map((d) => d.uid)).toEqual(bench);
    expect(discardPrompt(parked).discardable.map((d) => d.uid)).not.toContain(activeEnergy[0]);
    expect(discardPrompt(parked).scope).toEqual({ kind: "upTo", max: 2 });
    // …and the caption is the printed sentence minus its "You may", which is the arm
    // `discardNote`'s exhaustive `switch` could not compile without.
    expect(discardPrompt(parked).note).toBe("Discard up to 2 Energy from your Benched Pokémon.");
    // Nothing dealt yet — the whole attack's damage waits behind the choice.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
  });

  it("the Basic filter narrows the SAME zone, and says so in the caption", () => {
    // "Basic Energy" names the CARD, not what it provides: `fix-special` provides {C}
    // and is refused, which is the one board where a `providesEnergy` reading and a
    // `basicEnergy` one part company.
    const { state, benchIndex } = fielded(2, "fix-benchbasicboost", [
      ["fix-energy", 1],
      ["fix-special", 1],
    ]);
    const bench = benchEnergy(state, benchIndex);
    deepFreeze(state);
    const { state: parked } = mustApply(state, attack);
    expect(discardPrompt(parked).discardable.map((d) => d.uid)).toEqual([bench[0]]);
    expect(discardPrompt(parked).note).toBe(
      "Discard up to 2 Basic Energy from your Benched Pokémon.",
    );
  });

  it("the discard comes off the BENCH SPOT, in the controller's own pile", () => {
    const { state, benchIndex } = fielded(3, "fix-benchboost", [["fix-lightning-energy", 2]]);
    const bench = benchEnergy(state, benchIndex);
    const { state: parked } = mustApply(state, attack);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: bench },
    });
    expect(find(events, "ENERGY_DISCARDED")).toMatchObject({
      seat: "p1",
      actor: "p1",
      uids: bench,
      from: { spot: "bench", index: benchIndex },
    });
    expect(benchEnergy(done, benchIndex)).toEqual([]);
    expect(done.players.p1.discard).toEqual(expect.arrayContaining(bench));
  });
});

describe("D403 §5 — `base + P × N` is ONE §8.5 pass, driven where it is observable", () => {
  it("on a NEUTRAL body the sum is 50 / 110 / 170 — the base is KEPT", () => {
    // The multiply family drops its printed base (the "N×" IS the per-unit); this one
    // keeps it, because the printed marker is a "+". Three counts, three sums, and the
    // base is visible in all three.
    const cases: readonly (readonly [number, number, number])[] = [
      [4, 0, 50],
      [5, 1, 110],
      [6, 2, 170],
    ];
    for (const [seed, take, dealt] of cases) {
      const { state, benchIndex } = fielded(seed, "fix-benchboost", [["fix-lightning-energy", 2]]);
      const bench = benchEnergy(state, benchIndex);
      const { state: parked } = mustApply(state, attack);
      const { state: done, events } = mustApply(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "discardEnergy", uids: bench.slice(0, take) },
      });
      expect(find(events, "DAMAGE_DEALT")?.dealt, `${take} discarded`).toBe(dealt);
      expect(done.players.p2.active?.damage, `${take} discarded`).toBe(dealt);
      expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(1);
    }
  });

  it("THE DISCRIMINATOR: a −30 RESISTANCE is paid ONCE, so two discards deal 140", () => {
    const { state, benchIndex } = fielded(
      7,
      "fix-benchboost",
      [["fix-lightning-energy", 2]],
      "fix-psychic-resist-big",
    );
    const bench = benchEnergy(state, benchIndex);
    deepFreeze(state);
    const { state: parked } = mustApply(state, attack);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: bench },
    });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(140);
    expect(done.players.p2.active?.damage).toBe(140);
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(1);
  });

  it("…and the SAME body takes 20 on a decline — the Resistance still paid once", () => {
    const { state, benchIndex } = fielded(
      8,
      "fix-benchboost",
      [["fix-lightning-energy", 2]],
      "fix-psychic-resist-big",
    );
    void benchIndex;
    const { state: parked } = mustApply(state, attack);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [] },
    });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(20);
    expect(done.players.p2.active?.damage).toBe(20);
  });

  it("an EMPTY Bench asks nothing and still deals the printed base", () => {
    // No candidate at all: the op files an EMPTY record and resolves inline, and the
    // damage reads 0 off it. Nothing parks, and the attack is still a 50-damage attack
    // — which is exactly what a `damageDefender` with no `base` would have deleted.
    const { state } = fielded(9, "fix-benchboost", []);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, attack);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(types(events)).not.toContain("ENERGY_DISCARDED");
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(50);
    // …and the flag stays down on the inline path too, where the whole attack is one
    // action and the two event lists the rung above has to keep apart are the same one.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("the 90-per fixture scales by ITS number, and the coverage flag stays down", () => {
    // A different base and a different per-unit on the same shape: 30 + 90 = 120. The
    // pair exists so a rung that read the wrong card would have to be wrong twice to
    // look right.
    const { state, benchIndex } = fielded(10, "fix-benchbasicboost", [["fix-energy", 2]]);
    const bench = benchEnergy(state, benchIndex);
    const { state: parked } = mustApply(state, attack);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: bench.slice(0, 1) },
    });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(120);
    expect(done.players.p2.active?.damage).toBe(120);
  });

  it("neither half of `ATTACK_EFFECT_SKIPPED` fires, on BOTH printed sentences", () => {
    for (const attacker of ["fix-benchboost", "fix-benchbasicboost"] as const) {
      const { state } = fielded(12, attacker, [["fix-energy", 2]]);
      deepFreeze(state);
      const { events } = mustApply(state, attack);
      expect(types(events), attacker).toContain("ATTACK_DECLARED");
      expect(types(events), attacker).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
  });

  it("the printed order is discard-then-damage, with nothing between", () => {
    const { state, benchIndex } = fielded(11, "fix-benchboost", [["fix-lightning-energy", 2]]);
    const bench = benchEnergy(state, benchIndex);
    const { state: parked } = mustApply(state, attack);
    const { events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: bench },
    });
    expect(types(events)).toEqual([
      "ENERGY_DISCARDED",
      "DAMAGE_DEALT",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
  });
});
