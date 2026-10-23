import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader as readByAny,
} from "./censusAttackCorpus";
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
import type { GameState } from "./index";
import {
  DISCARD_SCALED_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
  mustDerive,
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
    "You may discard any amount of Basic Energy from your Pokémon. This attack does 70 damage for each card you discarded in this way.",
  ],
  [
    2,
    "Discard all {L} Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way.",
  ],
  [
    2,
    "Discard up to 2 {M} Energy from this Pokémon. This attack does 120 damage for each card you discarded in this way.",
  ],
  [
    1,
    "Discard all {M} Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way.",
  ],
  [
    1,
    "Discard up to 3 {G} Energy cards from your Pokémon. This attack does 70 damage for each card you discarded in this way.",
  ],
  [
    1,
    "Discard up to 5 {R} Energy from this Pokémon. This attack does 70 damage for each card you discarded in this way.",
  ],
];

const HAIL_BLADE =
  "You may discard any amount of {W} Energy from your Pokémon. This attack does 60 damage for each card you discarded in this way.";
const PSY_PURGE =
  "Discard up to 3 Psychic Energy from your Pokémon. This attack does 90 damage for each card you discarded in this way.";

describe("D402 §1 — the family, split by its FOLD, measured live over the column", () => {
  it("D419 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the whole 'discarded in this way' family is 12 sentences / 27 printings", () => {
    const family = legalAttackCorpus().filter(([, s]) => s.includes("discarded in this way"));
    expect(family).toHaveLength(12);
    expect(units(family)).toBe(27);
  });

  it("this anchor takes SIX of them, worth THIRTEEN printings — and only those", () => {
    const rows = legalAttackCorpus();
    const takesEnergyOffTheBoard = (text: string): boolean => {
      const program = deriveAttackEffect(text);
      return program !== null && program[0]?.op === "discardEnergy";
    };
    const taken = rows.filter(
      ([, s]) => takesEnergyOffTheBoard(s) && s.includes("discarded in this way"),
    );
    expect(taken).toHaveLength(6);
    expect(units(taken)).toBe(13);
    const mills = rows.filter(
      ([, s]) =>
        s.includes("discarded in this way") && deriveAttackEffect(s)?.[0]?.op === "discardDeckTop",
    );
    expect(mills).toHaveLength(2);
    expect(units(mills)).toBe(2);
    expect([...taken].sort()).toEqual([...TAKEN].sort());
  });

  it("the ADDITIVE half is 3 sentences / 10 printings, and D403 took 2 / 8 of them", () => {
    const more = legalAttackCorpus().filter(
      ([, s]) => s.includes("discarded in this way") && s.includes("more damage for each"),
    );
    expect(more).toHaveLength(3);
    expect(units(more)).toBe(10);
    const taken = more.filter(([, s]) => deriveAttackDiscardScaledBoost(s) !== null);
    expect(taken).toHaveLength(3);
    expect(units(taken)).toBe(10);
    const left = more.filter(([, s]) => deriveAttackDiscardScaledBoost(s) === null);
    expect(left).toEqual([]);
    // …and the DISJOINTNESS the old rung really carried is kept: every one of the three
    // is read by THIS reader and by no other, which is what makes "at most one reader
    // fires per attack" structural rather than a rule attack.ts has to keep.
    for (const [, s] of more) expect(readByAny(s), s).toBe(true);
  });

  it("the two NAMED FALSIFIERS interact: every Bench-only printing is ADDITIVE", () => {
    const bench = legalAttackCorpus().filter(
      ([, s]) => s.includes("discarded in this way") && s.includes("from your Benched Pokémon"),
    );
    expect(bench).toHaveLength(2);
    expect(units(bench)).toBe(8);
    for (const [, s] of bench) expect(s.includes("more damage for each"), s).toBe(true);
    const benchMultiply = legalAttackCorpus().filter(
      ([, s]) =>
        s.includes("discarded in this way") &&
        s.includes("from your Benched Pokémon") &&
        !s.includes("more damage for each"),
    );
    expect(benchMultiply).toHaveLength(0);
  });

  it("the MULTIPLY half is now COMPLETE — nothing is left, and each half is named", () => {
    const multiply = legalAttackCorpus().filter(
      ([, s]) => s.includes("discarded in this way") && !s.includes("more damage for each"),
    );
    expect(multiply).toHaveLength(9);
    expect(units(multiply)).toBe(17);
    const rest = multiply.filter(([, s]) => deriveAttackEffect(s) === null);
    expect(rest).toHaveLength(0);
    expect(units(rest)).toBe(0);
    // THE PARTITION, by the op each program opens with. Three arms, three heads, and
    // the three counts sum to the whole half — so a sentence that moved between arms
    // reddens, and so does one that left the family altogether.
    const openedBy = (kind: string) =>
      multiply.filter(([, s]) => deriveAttackEffect(s)?.[0]?.op === kind);
    expect([openedBy("discardEnergy").length, units(openedBy("discardEnergy"))]).toEqual([6, 13]);
    expect([openedBy("discardDeckTop").length, units(openedBy("discardDeckTop"))]).toEqual([2, 2]);
    expect([openedBy("payFromHand").length, units(openedBy("payFromHand"))]).toEqual([1, 2]);
    expect(
      openedBy("discardEnergy").length +
        openedBy("discardDeckTop").length +
        openedBy("payFromHand").length,
    ).toBe(multiply.length);
    const [handRow] = openedBy("payFromHand");
    if (handRow === undefined) throw new Error("the hand-discard row left the family");
    expect(handRow[1].startsWith("Discard up to 3 Energy cards from your hand."), handRow[1]).toBe(
      true,
    );
    expect(deriveAttackEffect(handRow[1])).toEqual([
      {
        op: "payFromHand",
        count: "any",
        cap: 3,
        to: "discard",
        filter: { kind: "anyEnergy" },
        recordAs: "discarded",
      },
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 60,
        count: 1,
        source: "attack",
        deals: true,
        perRecorded: "discarded",
      },
    ]);
    const additive = legalAttackCorpus().filter(
      ([, s]) => s.includes("discarded in this way") && s.includes("more damage for each"),
    );
    expect(additive).toHaveLength(3);
    expect(units(additive)).toBe(10);
    const additiveLeft = additive.filter(([, s]) => !readByAny(s));
    expect(additiveLeft).toEqual([]);
    for (const [, s] of additive) {
      expect(deriveAttackEffect(s), s).toBeNull();
      expect(deriveAttackDiscardScaledBoost(s), s).not.toBeNull();
    }
    expect(
      additive.filter(([, s]) => s.startsWith("Discard the top card of each player's deck.")),
    ).toHaveLength(1);
    const built = legalAttackCorpus().filter(
      ([, s]) =>
        s.includes("discarded in this way") &&
        !s.includes("more damage for each") &&
        deriveAttackEffect(s)?.[0]?.op === "discardDeckTop",
    );
    expect(built).toHaveLength(2);
    expect(units(built)).toBe(2);
    for (const [, s] of built) {
      const program = mustDerive(deriveAttackEffect, s);
      expect(program, s).toHaveLength(2);
      expect(program[0], s).toMatchObject({
        op: "discardDeckTop",
        whose: "self",
        recordAs: "discarded",
      });
      const scale = program[1];
      if (scale?.op !== "damageDefender") throw new Error(`not a damageDefender: ${s}`);
      expect(scale.count, s).toBe("discarded");
      expect(scale.countFilter, s).not.toBeUndefined();
    }
  });
});

describe("D402 §2 — the parse: every capture is a field of the two ops", () => {
  it("the SIX printed sentences derive to the discard + the scaled hit, in printed order", () => {
    expect(deriveAttackEffect(TAKEN[0]?.[1] as string)).toEqual([
      {
        op: "discardEnergy",
        from: "yours",
        filter: { kind: "basicEnergy" },
        count: "any",
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 70, count: "discarded" },
    ]);
    expect(deriveAttackEffect(TAKEN[1]?.[1] as string)).toEqual([
      {
        op: "discardEnergy",
        from: "yourActive",
        filter: { kind: "providesEnergy", energyType: "Lightning" },
        count: "all",
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 50, count: "discarded" },
    ]);
    expect(deriveAttackEffect(TAKEN[2]?.[1] as string)).toEqual([
      {
        op: "discardEnergy",
        from: "yourActive",
        filter: { kind: "providesEnergy", energyType: "Metal" },
        count: "any",
        cap: 2,
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 120, count: "discarded" },
    ]);
    expect(deriveAttackEffect(TAKEN[3]?.[1] as string)).toEqual([
      {
        op: "discardEnergy",
        from: "yourActive",
        filter: { kind: "providesEnergy", energyType: "Metal" },
        count: "all",
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 50, count: "discarded" },
    ]);
    expect(deriveAttackEffect(TAKEN[4]?.[1] as string)).toEqual([
      {
        op: "discardEnergy",
        from: "yours",
        filter: { kind: "providesEnergy", energyType: "Grass" },
        count: "any",
        cap: 3,
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 70, count: "discarded" },
    ]);
    expect(deriveAttackEffect(TAKEN[5]?.[1] as string)).toEqual([
      {
        op: "discardEnergy",
        from: "yourActive",
        filter: { kind: "providesEnergy", energyType: "Fire" },
        count: "any",
        cap: 5,
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 70, count: "discarded" },
    ]);
  });

  it("the two ROTATED registry sentences derive to their own authored programs", () => {
    expect(legalAttackCorpus().some(([, s]) => s === HAIL_BLADE)).toBe(false);
    expect(legalAttackCorpus().some(([, s]) => s === PSY_PURGE)).toBe(false);
    expect(deriveAttackEffect(HAIL_BLADE)).toEqual([
      {
        op: "discardEnergy",
        from: "yours",
        filter: { kind: "providesEnergy", energyType: "Water" },
        count: "any",
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 60, count: "discarded" },
    ]);
    expect(deriveAttackEffect(PSY_PURGE)).toEqual([
      {
        op: "discardEnergy",
        from: "yours",
        filter: { kind: "providesEnergy", energyType: "Psychic" },
        count: "any",
        cap: 3,
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 90, count: "discarded" },
    ]);
  });

  it("the TYPE comes from the MAP, so every code and every name resolves", () => {
    for (const [code, type] of [
      ["G", "Grass"],
      ["R", "Fire"],
      ["W", "Water"],
      ["L", "Lightning"],
      ["P", "Psychic"],
      ["F", "Fighting"],
      ["D", "Darkness"],
      ["M", "Metal"],
      ["Y", "Fairy"],
    ] as const) {
      const expected = [
        {
          op: "discardEnergy",
          from: "yourActive",
          filter: { kind: "providesEnergy", energyType: type },
          count: "all",
          recordAs: "discarded",
        },
        { op: "damageDefender", per: 30, count: "discarded" },
      ];
      expect(
        deriveAttackEffect(
          `Discard all {${code}} Energy from this Pokémon. This attack does 30 damage for each card you discarded in this way.`,
        ),
      ).toEqual(expected);
      expect(
        deriveAttackEffect(
          `Discard all ${type} Energy from this Pokémon. This attack does 30 damage for each card you discarded in this way.`,
        ),
      ).toEqual(expected);
    }
  });
});

describe("D402 §3 — the refusals, each pinned on ONE printed byte", () => {
  it("the FOLD and the ZONE each refuse INDEPENDENTLY of the other", () => {
    const derivable =
      "Discard up to 2 Basic Energy from your Pokémon. This attack does 60 damage for each card you discarded in this way.";
    expect(deriveAttackEffect(derivable)).not.toBeNull();
    // …the FOLD alone: the same sentence with the printed "more" put back.
    expect(
      deriveAttackEffect(
        "Discard up to 2 Basic Energy from your Pokémon. This attack does 60 more damage for each card you discarded in this way.",
      ),
    ).toBeNull();
    // …the ZONE alone: the same sentence with the printed "Benched" put back.
    expect(
      deriveAttackEffect(
        "Discard up to 2 Basic Energy from your Benched Pokémon. This attack does 60 damage for each card you discarded in this way.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "You may discard up to 2 Energy from your Benched Pokémon. This attack does 60 more damage for each card you discarded in this way.",
      ),
    ).toBeNull();
  });

  it("the QUANTIFIER is three COUPLED literals — the cross-product is not derived", () => {
    for (const text of [
      "Discard any amount of {W} Energy from your Pokémon. This attack does 60 damage for each card you discarded in this way.",
      "You may discard all {W} Energy from your Pokémon. This attack does 60 damage for each card you discarded in this way.",
      "You may discard 2 {W} Energy from your Pokémon. This attack does 60 damage for each card you discarded in this way.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("an UNTYPED noun is refused — this half of the family never prints one ( D597 (D539): of the PERIOD spelling only — the `me` comma spelling prints a bare noun, Garland Ray / Double Eater)", () => {
    expect(
      deriveAttackEffect(
        "Discard up to 2 Energy from your Pokémon. This attack does 60 damage for each card you discarded in this way.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "Discard all Energy from this Pokémon. This attack does 60 damage for each card you discarded in this way.",
      ),
    ).toBeNull();
  });

  it("{C} and {N} are refused — the map's own vocabulary, not the regex's", () => {
    // `ENERGY_TYPE_BY_CODE` has no `C` (Colorless is the conservative provision
    // fallback for every unauthored Special Energy, so a {C} filter would silently
    // match cards nobody meant) and no `N` (there is no Basic Dragon Energy).
    for (const text of [
      "Discard all {C} Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way.",
      "Discard all Colorless Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way.",
      "Discard all {N} Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way.",
      "Discard all Dragon Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("a printed 0 in EITHER number stays loud — no silent no-op", () => {
    // Two captured numbers, two positivity guards, asserted apart. A 0 per-unit is an
    // attack that deals nothing however much comes off; a "up to 0" is a park with no
    // pick. Both belong on the `ATTACK_EFFECT_SKIPPED` path, not in a program.
    expect(
      deriveAttackEffect(
        "You may discard any amount of Basic Energy from your Pokémon. This attack does 0 damage for each card you discarded in this way.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "Discard up to 0 {M} Energy from this Pokémon. This attack does 120 damage for each card you discarded in this way.",
      ),
    ).toBeNull();
    // …and 1 is fine in both slots, so the guards are `>= 1` and not `> 1`.
    expect(
      deriveAttackEffect(
        "Discard up to 1 {M} Energy from this Pokémon. This attack does 1 damage for each card you discarded in this way.",
      ),
    ).not.toBeNull();
  });

  it("the ANCHORS: leading text, a trailing clause, and the capital all refuse", () => {
    for (const text of [
      // `^` — a real compound whose first clause is something else entirely.
      "Draw a card. Discard all {L} Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way.",
      // `$` — a real trailing clause, the shape three of this file's anchors exist for.
      "Discard all {L} Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way. Then, draw a card.",
      // No /i: the capitalised first word is half of what keeps a MID-SENTENCE clause
      // off the derived path.
      "discard all {L} Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way.",
      // The tail's own capital, for the same reason.
      "Discard all {L} Energy from this Pokémon. this attack does 50 damage for each card you discarded in this way.",
      // The sentence's own halves, alone: the FIRST is `TYPED_SELF_DISCARD`'s and
      // derives to ONE op; the SECOND is nobody's and derives to none.
      "This attack does 50 damage for each card you discarded in this way.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    // …and the first half alone still derives to the BARE typed discard — the proof
    // that this anchor was added BESIDE `TYPED_SELF_DISCARD` and did not swallow it.
    expect(deriveAttackEffect("Discard all {L} Energy from this Pokémon.")).toEqual([
      {
        op: "discardEnergy",
        from: "yourActive",
        filter: { kind: "providesEnergy", energyType: "Lightning" },
        count: "all",
      },
    ]);
  });
});

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1 goes second, so
    their first turn carries no §4 attack restriction. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: DISCARD_SCALED_DECK, p2: DISCARD_SCALED_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields `attacker` with the named Energy attached, against a neutral 200 HP
    `fix-bigbody` — so a count is never confounded with a Knock Out. */
function fielded(
  seed: number,
  attacker: string,
  energy: { readonly [id: string]: number },
): GameState {
  let state = setActiveFromDeck(board(seed), "p1", attacker);
  for (const [id, n] of Object.entries(energy)) state = attachFromDeck(state, "p1", id, n);
  return setActiveFromDeck(state, "p2", "fix-bigbody");
}

function activeEnergy(state: GameState, seat: "p1" | "p2"): string[] {
  return [...(state.players[seat].active?.energy ?? [])];
}

function discardPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
  return state.phase.prompt;
}

describe('D402 §4 — the `count: "all"` arm: the record filed with NOTHING parking', () => {
  it("strips every {L}, keeps the rest, and deals 50 × 3 = 150 in ONE action", () => {
    const state = fielded(1, "fix-allscale", {
      "fix-lightning-energy": 3,
      "fix-energy": 1,
      "fix-special": 1,
    });
    const before = activeEnergy(state, "p1");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, attack);

    expect(done.phase.kind).not.toBe("effect:choose");
    const discarded = findEvent(events, "ENERGY_DISCARDED");
    expect(discarded).toMatchObject({ seat: "p1", actor: "p1", uids: before.slice(0, 3) });
    expect(activeEnergy(done, "p1")).toEqual(before.slice(3));
    expect(activeEnergy(done, "p1")).toHaveLength(2);
    // …and the damage the record feeds, dealt through the same §8.5 pipeline.
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 150 });
    expect(done.players.p2.active?.damage).toBe(150);
    // The printed order, and nothing between the two ops.
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "ENERGY_DISCARDED",
      "DAMAGE_DEALT",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
  });

  it("ZERO {L} attached deals ZERO — the printed `50×` base is SUPPRESSED", () => {
    // The whole point of `programDamage`. With no match the record is EMPTY, the
    // per-unit multiplies to nothing, and the printed 50 must not leak through the
    // pre-program pipeline. A kept base would deal 50 here.
    const state = fielded(2, "fix-allscale", { "fix-energy": 1, "fix-special": 1 });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, attack);
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("ENERGY_DISCARDED");
    expect(done.players.p2.active?.damage ?? 0).toBe(0);
    // …and the coverage flag is NOT raised: the program owns the text and the "×".
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("ONE {L} deals 50 — the count is what scales, not the board", () => {
    const state = fielded(3, "fix-allscale", { "fix-lightning-energy": 1, "fix-energy": 1 });
    const { state: done, events } = mustApply(state, attack);
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(50);
    expect(activeEnergy(done, "p1")).toHaveLength(1);
  });
});

describe("D402 §5 — the declinable arm, and the caption `energyNoun` grew for it", () => {
  it("the prompt is the PRINTED noun phrase, and the offer is Basic Energy only", () => {
    // "from your Pokémon" is the whole own side, so a BENCHED Basic Energy is fuel.
    // `fix-special` is refused: "Basic Energy" names the CARD, not what it provides.
    let state = fielded(4, "fix-basicscale", { "fix-energy": 2, "fix-special": 1 });
    state = benchFromDeck(state, "p1", "fix-bigbody");
    const benchIndex = state.players.p1.bench.length - 1;
    state = attachBenchFromDeck(state, "p1", benchIndex, "fix-lightning-energy", 1);
    const activeBasics = activeEnergy(state, "p1").slice(0, 2);
    const special = activeEnergy(state, "p1")[2] as string;
    const benchBasic = state.players.p1.bench[benchIndex]?.energy[0] as string;
    deepFreeze(state);

    const { state: parked, events } = mustApply(state, attack);

    expect(parked.phase.kind).toBe("effect:choose");
    expect(discardPrompt(parked).note).toBe(
      "Discard any amount of Basic Energy from your Pokémon.",
    );
    expect(discardPrompt(parked).scope).toEqual({ kind: "upTo", max: 3 });
    expect(discardPrompt(parked).discardable.map((d) => d.uid)).toEqual([
      ...activeBasics,
      benchBasic,
    ]);
    expect(discardPrompt(parked).discardable.map((d) => d.uid)).not.toContain(special);
    // Nothing dealt yet — the whole attack's damage waits behind the choice.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
  });

  it("declining discards nothing and deals ZERO — the `70×` base suppressed again", () => {
    const state = fielded(5, "fix-basicscale", { "fix-energy": 2 });
    const { state: parked } = mustApply(state, attack);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [] },
    });
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(activeEnergy(done, "p1")).toHaveLength(2);
    expect(done.players.p2.active?.damage ?? 0).toBe(0);
  });

  it("taking TWO of three deals 140, and leaves the third attached", () => {
    let state = fielded(6, "fix-basicscale", { "fix-energy": 3 });
    deepFreeze(state);
    const { state: parked } = mustApply(state, attack);
    const picks = discardPrompt(parked).discardable.map((d) => d.uid);
    expect(picks).toHaveLength(3);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: picks.slice(0, 2) },
    });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(140);
    expect(activeEnergy(done, "p1")).toEqual([picks[2]]);
    state = done;
    expect(state.players.p2.active?.damage).toBe(140);
  });
});
