import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import {
  deriveAttackDamageBonus,
  deriveAttackRequirement,
  splitAttackRequirementClause,
} from "./effects";
import type { BoardCondition, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { programFor, registryCardIds } from "./registry";
import {
  REQUIREMENT_FLOOR_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setPrizes,
  types,
} from "./testFixtures";

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The skeleton, as a labelled COPY — the reader's own pattern is module-private.
    Tied to the live reader in both directions everywhere it is used. */
const SKELETON = /^If (.+?), this attack does nothing\.(?: (.+))?$/;

const BOUGHT: readonly (readonly [string, number, string])[] = [
  [
    "If you don't have the same number of cards in your hand as your opponent, this attack does nothing.",
    2,
    "Iron Boulder sv07-071/sv08.5-046",
  ],
  [
    "If your opponent doesn't have exactly 3 or 4 Prize cards remaining, this attack does nothing.",
    1,
    "Hop's Cramorant sv09-138",
  ],
  [
    "If you don't have Uxie and Azelf on your Bench, this attack does nothing.",
    2,
    "Mesprit sv08-079/sv08-204",
  ],
];

const REFUSED: readonly (readonly [string, number, string])[] = [];

const TAKEN_SINCE: readonly (readonly [string, number, string, BoardCondition])[] = [
  [
    "If your opponent's Active Pokémon isn't Burned, this attack does nothing.",
    1,
    "a BURNED member — the state field exists, no condition reads it (TAKEN at D377)",
    { kind: "opponentActiveBurned" },
  ],
  [
    "If there is no Stadium in play, this attack does nothing.",
    2,
    "an ANY-OWNER stadium member — `yourStadiumInPlay` cannot be widened without changing Falkner (TAKEN at D378)",
    { kind: "stadiumInPlay" },
  ],
  [
    "If you don't have exactly 3 cards in your hand, this attack does nothing.",
    2,
    "an OWN-hand exact-size member — `opponentHandAtMost` is the wrong seat AND the wrong comparator (TAKEN at D379)",
    { kind: "yourHandExactly", count: 3 },
  ],
];

const BOUGHT_IDS = ["sv07-071", "sv08.5-046", "sv09-138", "sv08-079", "sv08-204"] as const;

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: REQUIREMENT_FLOOR_DECK, p2: REQUIREMENT_FLOOR_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields `attacker` with its cost paid, P2 fields a 200 HP body that survives
    every print here, and BOTH benches start empty so each case adds only what it
    is about. */
function ready(seed: number, attacker: string, energy: readonly [string, number][]): GameState {
  let state = setActiveFromDeck(board(seed), "p1", attacker);
  for (const [id, n] of energy) state = attachFromDeck(state, "p1", id, n);
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  return clearBench(clearBench(state, "p2"), "p1");
}

/** TEST SURGERY: shrink `seat`'s hand to `size`, parking the surplus in the
    discard — `publicCount.test.ts`'s helper, shrink-only for its reason (growing a
    hand means drawing, which is a real action). */
function setHandSize(state: GameState, seat: Seat, size: number): GameState {
  const side = state.players[seat];
  if (size > side.hand.length) throw new Error(`${seat} hand is ${side.hand.length}, cannot grow`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        hand: side.hand.slice(0, size),
        discard: [...side.discard, ...side.hand.slice(size)],
      },
    },
  };
}

/** Attack index 0 and report whether the requirement CANCELLED it. */
function attackOutcome(state: GameState): { cancelled: boolean; kinds: string[] } {
  const after = mustApply(state, { type: "attack", seat: "p1", index: 0 });
  const kinds = types(after.events);
  const failed = after.events.find((e) => e.type === "ATTACK_FAILED");
  return {
    cancelled: failed !== undefined && (failed as { reason?: string }).reason === "requirement",
    kinds,
  };
}

describe("§1 — the population reproduces, and the PARTITION is published before the price", () => {
  it("re-derives 9 s / 18 u behind the skeleton, and 6 s / 13 u now carried", () => {
    const openers = corpus().filter(([, s]) => SKELETON.test(s.trim()));
    expect([openers.length, units(openers)]).toEqual([9, 18]);
    const carried = openers.filter(([, s]) => deriveAttackRequirement(s) !== null);
    expect([carried.length, units(carried)]).toEqual([9, 18]);
    const missing = openers.filter(([, s]) => deriveAttackRequirement(s) === null);
    expect([missing.length, units(missing)]).toEqual([0, 0]);
    expect(carried.length + missing.length).toBe(openers.length);
    expect(units(carried) + units(missing)).toBe(units(openers));
  });

  it("ZERO ANCHORS refuse any of the seven D364 handed over — the refusal is VOCABULARY", () => {
    expect(REFUSED).toEqual([]);
    expect(TAKEN_SINCE).toHaveLength(3);
    const carried = [...BOUGHT, ...REFUSED, ...TAKEN_SINCE].map(([s]) => s);
    expect(carried).toHaveLength(6);
    for (const sentence of carried) {
      expect(SKELETON.test(sentence.trim()), sentence).toBe(true);
      // …and the clause the anchor captures is the whole printed negative, so the
      // table lookup is the only thing that can have failed.
      expect(SKELETON.exec(sentence.trim())?.[1], sentence).toBeTruthy();
    }
    // Live tie: exactly the three bought ones resolve now, exactly the four
    // refused ones still do not.
    for (const [sentence, , who] of BOUGHT) {
      expect(deriveAttackRequirement(sentence), who).not.toBeNull();
    }
    for (const [sentence, , cost] of REFUSED) {
      expect(deriveAttackRequirement(sentence), cost).toBeNull();
    }
    for (const [sentence, , cost, member] of TAKEN_SINCE) {
      expect(deriveAttackRequirement(sentence), cost).toEqual(member);
    }
  });

  it("the FLOOR is 3 sentences / 5 printings, not the handoff's 2 / 3", () => {
    expect(BOUGHT).toHaveLength(3);
    expect(BOUGHT.reduce((sum, [, n]) => sum + n, 0)).toBe(5);
    for (const [sentence, expected, who] of BOUGHT) {
      const printed = corpus().filter(([, s]) => s === sentence);
      expect(units(printed), who).toBe(expected);
    }
    const residue: readonly (readonly [string, number, string])[] = [
      ...REFUSED,
      ...TAKEN_SINCE.map(([sentence, n, cost]) => [sentence, n, cost] as const),
    ];
    expect(REFUSED).toHaveLength(0);
    expect(TAKEN_SINCE).toHaveLength(3);
    expect(residue).toHaveLength(3);
    expect(residue.reduce((sum, [, n]) => sum + n, 0)).toBe(5);
    for (const [sentence, expected, cost] of residue) {
      const printed = corpus().filter(([, s]) => s === sentence);
      expect(units(printed), cost).toBe(expected);
    }
    expect(
      BOUGHT.reduce((sum, [, n]) => sum + n, 0) + residue.reduce((sum, [, n]) => sum + n, 0) + 4,
    ).toBe(14);
  });
});

describe("§2 — the NO-NEW-VOCABULARY refutation, and the substring trap", () => {
  it("all three map onto members that ALREADY EXISTED — spelled out, by value", () => {
    expect(
      deriveAttackRequirement(
        "If you don't have the same number of cards in your hand as your opponent, this attack does nothing.",
      ),
    ).toEqual({ kind: "handSizesEqual" });
    expect(
      deriveAttackRequirement(
        "If your opponent doesn't have exactly 3 or 4 Prize cards remaining, this attack does nothing.",
      ),
    ).toEqual({ kind: "opponentPrizesRemaining", counts: [3, 4] });
    expect(
      deriveAttackRequirement(
        "If you don't have Uxie and Azelf on your Bench, this attack does nothing.",
      ),
    ).toEqual({
      kind: "allOf",
      conditions: [
        { kind: "yourBenchHasNamed", name: "Uxie" },
        { kind: "yourBenchHasNamed", name: "Azelf" },
      ],
    });
  });

  it("the TWO CONSEQUENTS stay disjoint, and the trap is a SUBSTRING this time", () => {
    const cancel =
      "If you don't have the same number of cards in your hand as your opponent, this attack does nothing.";
    const bonus =
      "If you have the same number of cards in your hand as your opponent, this attack does 90 more damage.";
    // The positive clause IS a substring of the negative one — asserted, because
    // the whole trap rests on it.
    expect(cancel).toContain("have the same number of cards in your hand as your opponent");
    expect(bonus).toContain("have the same number of cards in your hand as your opponent");
    // …and the two readers still refuse each other's sentence outright.
    expect(deriveAttackRequirement(bonus)).toBeNull();
    expect(deriveAttackDamageBonus(cancel)).toBeNull();
    // Both really resolve on their OWN side — equality alone would be satisfied by
    // both readers going null on everything.
    expect(deriveAttackRequirement(cancel)).not.toBeNull();
    expect(deriveAttackDamageBonus(bonus)).not.toBeNull();
  });

  it("the anchor guards hold on all three new keys — no /i, and the period is required", () => {
    for (const [sentence] of BOUGHT) {
      const clause = SKELETON.exec(sentence)?.[1] ?? "";
      expect(clause).not.toBe("");
      // Lowercase `if` — the skeleton has no /i.
      expect(deriveAttackRequirement(`if ${clause}, this attack does nothing.`)).toBeNull();
      // No trailing period is not the whole sentence.
      expect(deriveAttackRequirement(`If ${clause}, this attack does nothing`)).toBeNull();
      // Leading text pins `^` — the coin family's shape, on these clauses.
      expect(
        deriveAttackRequirement(`Flip a coin. If ${clause}, this attack does nothing.`),
      ).toBeNull();
    }
  });
});

describe("§3 — the SPLIT term stands still, and it is asserted rather than assumed", () => {
  it("all three are SINGLE sentences, so `splitAttackRequirementClause` returns null", () => {
    for (const [sentence, , who] of BOUGHT) {
      expect(splitAttackRequirementClause(sentence), who).toBeNull();
      // …and the reason is the EMPTY BODY branch, not the accounting guard: the
      // skeleton's optional trailing group captured nothing.
      expect(SKELETON.exec(sentence.trim())?.[2], who).toBeUndefined();
    }
  });

  it("but the split WOULD fire on any of them with a companion — the branch is live", () => {
    for (const [sentence, , who] of BOUGHT) {
      const compound = `${sentence} Then, spin the wheel of fate.`;
      const split = splitAttackRequirementClause(compound);
      expect(split, who).not.toBeNull();
      expect(split?.clause, who).toBe(sentence);
      expect(split?.body, who).toBe("Then, spin the wheel of fate.");
      // The requirement is still read off the UNSPLIT string, which is the order
      // attack.ts commits to.
      expect(deriveAttackRequirement(compound), who).toEqual(deriveAttackRequirement(sentence));
    }
  });
});

describe("§4 — the two 'widenings' are not widenings, and that is DRIVEN", () => {
  it("`yourStadiumInPlay` reads OWNERSHIP, so yours→any is a RENAME", () => {
    const state = board(2201);
    const p2Stadium: GameState = {
      ...state,
      stadium: { uid: "stadium-uid", owner: "p2" },
    } as GameState;
    expect(conditionHolds(p2Stadium, "p1", { kind: "yourStadiumInPlay" })).toBe(false);
    expect(conditionHolds(p2Stadium, "p2", { kind: "yourStadiumInPlay" })).toBe(true);
    // An any-owner predicate would answer TRUE for BOTH seats on this board, and
    // the two answers above are what say the member is not that predicate.
    expect(
      conditionHolds(p2Stadium, "p1", { kind: "yourStadiumInPlay" }) ===
        conditionHolds(p2Stadium, "p2", { kind: "yourStadiumInPlay" }),
    ).toBe(false);
    const stadiumRequirement = deriveAttackRequirement(
      "If there is no Stadium in play, this attack does nothing.",
    );
    expect(stadiumRequirement).toEqual({ kind: "stadiumInPlay" });
    expect(stadiumRequirement).not.toEqual({ kind: "yourStadiumInPlay" });
    // …and on THIS board — the opponent's Stadium — the two answers differ, which is
    // the board the rename would have got wrong.
    expect(conditionHolds(p2Stadium, "p1", { kind: "stadiumInPlay" })).toBe(true);
    expect(conditionHolds(p2Stadium, "p1", { kind: "yourStadiumInPlay" })).toBe(false);
  });

  it("Burn is an ADDITION — no member reads it, and the ANY-condition one is wider", () => {
    // `opponentActiveHasSpecialCondition` is TRUE on a Burned board AND on an
    // Asleep one, so it cannot stand in for "isn't Burned": the requirement would
    // hold on a board the printed card cancels on.
    let state = ready(2202, "fix-cramorant", [["fix-energy", 1]]);
    const withBurn = burn(state, "p2");
    expect(conditionHolds(withBurn, "p1", { kind: "opponentActiveHasSpecialCondition" })).toBe(
      true,
    );
    const withSleep = rotate(state, "p2", "asleep");
    expect(conditionHolds(withSleep, "p1", { kind: "opponentActiveHasSpecialCondition" })).toBe(
      true,
    );
    // Two DIFFERENT boards, one answer — which is exactly why narrowing this
    // member would be wrong and adding a sibling is what the sentence costs.
    state = withSleep;
    const burnedRequirement = deriveAttackRequirement(
      "If your opponent's Active Pokémon isn't Burned, this attack does nothing.",
    );
    expect(burnedRequirement).toEqual({ kind: "opponentActiveBurned" });
    expect(burnedRequirement).not.toEqual({ kind: "opponentActiveHasSpecialCondition" });
    expect(conditionHolds(state, "p1", { kind: "opponentActiveBurned" })).toBe(false);
    expect(conditionHolds(withBurn, "p1", { kind: "opponentActiveBurned" })).toBe(true);
  });
});

describe("§5 — on a BOARD: each of the three cancels and lands, and the ids are named", () => {
  it("handSizesEqual — equal hands attack, unequal hands do NOTHING", () => {
    const base = ready(3101, "fix-ironboulder", [
      ["fix-psychic-energy", 1],
      ["fix-energy", 1],
    ]);
    const equal = setHandSize(setHandSize(base, "p1", 4), "p2", 4);
    expect(conditionHolds(equal, "p1", { kind: "handSizesEqual" })).toBe(true);
    const landed = attackOutcome(equal);
    expect(landed.cancelled).toBe(false);
    expect(landed.kinds).toContain("DAMAGE_DEALT");
    // …and the SAME board one card apart cancels outright: no damage, and NOT on
    // the loud path — the sentence is simulated, so nothing is flagged.
    const uneven = setHandSize(equal, "p2", 3);
    expect(conditionHolds(uneven, "p1", { kind: "handSizesEqual" })).toBe(false);
    const cancelled = attackOutcome(uneven);
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.kinds).not.toContain("DAMAGE_DEALT");
    expect(cancelled.kinds).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("opponentPrizesRemaining — 3 and 4 land, 2 and 5 do NOTHING (membership, not a range)", () => {
    const base = ready(3102, "fix-cramorant", [["fix-energy", 1]]);
    for (const count of [3, 4]) {
      const state = setPrizes(base, "p2", count);
      expect(conditionHolds(state, "p1", { kind: "opponentPrizesRemaining", counts: [3, 4] })).toBe(
        true,
      );
      expect(attackOutcome(state).cancelled, `p2 at ${count} prizes`).toBe(false);
    }
    for (const count of [2, 5]) {
      const state = setPrizes(base, "p2", count);
      expect(conditionHolds(state, "p1", { kind: "opponentPrizesRemaining", counts: [3, 4] })).toBe(
        false,
      );
      const out = attackOutcome(state);
      expect(out.cancelled, `p2 at ${count} prizes`).toBe(true);
      expect(out.kinds).not.toContain("DAMAGE_DEALT");
    }
  });

  it("the `allOf` row — BOTH names required, and ONE of them is not enough", () => {
    const base = ready(3103, "fix-mesprit", [["fix-psychic-energy", 2]]);
    const both = benchFromDeck(benchFromDeck(base, "p1", "fix-uxie"), "p1", "fix-azelf");
    const landed = attackOutcome(both);
    expect(landed.cancelled).toBe(false);
    expect(landed.kinds).toContain("DAMAGE_DEALT");
    const onlyUxie = benchFromDeck(base, "p1", "fix-uxie");
    expect(attackOutcome(onlyUxie).cancelled).toBe(true);
    const onlyAzelf = benchFromDeck(base, "p1", "fix-azelf");
    expect(attackOutcome(onlyAzelf).cancelled).toBe(true);
    const bystanders = benchFromDeck(
      benchFromDeck(base, "p1", "fix-lakebystander"),
      "p1",
      "fix-lakebystander",
    );
    expect(attackOutcome(bystanders).cancelled).toBe(true);
    // An EMPTY bench is false, not a throw — the sibling rule every member here
    // follows.
    expect(attackOutcome(base).cancelled).toBe(true);
  });

  it("the ATTRIBUTION control: the gate really runs and answers TRUE unforced", () => {
    const state = setActiveFromDeck(clearBench(board(3104), "p1"), "p1", "fix-uxie");
    // `fix-uxie` prints no attack at all, so declaring one is rejected rather than
    // cancelled — the loudest possible statement that nothing above is a no-op.
    expect(state.players.p1.active).not.toBeNull();
    const after = mustApply(
      attachFromDeck(
        setActiveFromDeck(state, "p1", "fix-ironboulder"),
        "p1",
        "fix-psychic-energy",
        2,
      ),
      { type: "attack", seat: "p1", index: 0 },
    );
    // Hands are dealt EQUAL at setup (7 each, both seats drew the same), so this
    // untouched board LANDS — the requirement is running and answering TRUE.
    expect(types(after.events)).toContain("DAMAGE_DEALT");
  });

  it("S2 — none of the five ids is a registry row, so the registry summand cannot move", () => {
    const ids = registryCardIds();
    expect(ids).toHaveLength(1451);
    for (const id of BOUGHT_IDS) {
      expect(ids, id).not.toContain(id);
      expect(programFor(id), id).toBeUndefined();
    }
  });
});

describe("§6 — `allOf` gains its first DERIVED producer, and nothing downstream moves", () => {
  it("every `allOf` before this slice was authored in registry.ts — 5 sites, ~~14~~ ids ( D582 (D539): *14* WITHDRAWN — 15 since the `me` alias Terapagos ex `me02.5-179`; D591: 8 sites / 24 ids with the Flapping trio; D599: 9 sites / 26 ids with Anthea & Concordia; D628: 10 sites / 27 ids with Latios)", () => {
    const withAllOf = registryCardIds().filter((id) =>
      JSON.stringify(programFor(id) ?? {}).includes('"allOf"'),
    );
    expect(withAllOf).toHaveLength(27);
    for (const id of BOUGHT_IDS) expect(withAllOf, id).not.toContain(id);
  });

  it("the derived value is folded by the SAME recursion, and notes readably", () => {
    const cond = deriveAttackRequirement(
      "If you don't have Uxie and Azelf on your Bench, this attack does nothing.",
    ) as BoardCondition;
    // `conditionHolds` descends it with `.every` — driven on three boards rather
    // than asserted about the arm.
    const base = ready(3201, "fix-mesprit", [["fix-psychic-energy", 2]]);
    expect(conditionHolds(base, "p1", cond)).toBe(false);
    expect(conditionHolds(benchFromDeck(base, "p1", "fix-uxie"), "p1", cond)).toBe(false);
    expect(
      conditionHolds(
        benchFromDeck(benchFromDeck(base, "p1", "fix-uxie"), "p1", "fix-azelf"),
        "p1",
        cond,
      ),
    ).toBe(true);
    // And the note joins the two conjuncts with " and ", which is `allOf`'s own
    // documented rendering — no new arm, no new phrasing.
    expect(conditionNote(cond)).toBe("Uxie is on your Bench and Azelf is on your Bench");
  });

  it("the EXHAUSTIVE-SWITCH count is unchanged: this slice adds no reader arm", () => {
    const state = ready(3202, "fix-mesprit", [["fix-psychic-energy", 2]]);
    for (const [sentence, , who] of BOUGHT) {
      const cond = deriveAttackRequirement(sentence) as BoardCondition;
      expect(typeof conditionHolds(state, "p1", cond), who).toBe("boolean");
      expect(conditionNote(cond).length, who).toBeGreaterThan(0);
    }
  });
});

/** TEST SURGERY: Burn `seat`'s Active. Local to §4's refutation — the point is
    that no `BoardCondition` reads this field, so no shared helper exists. */
function burn(state: GameState, seat: Seat): GameState {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active Pokémon`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...state.players[seat],
        active: { ...active, conditions: { ...active.conditions, burned: true } },
      },
    },
  };
}

/** TEST SURGERY: put `seat`'s Active into a rotation condition. */
function rotate(state: GameState, seat: Seat, rotation: "asleep"): GameState {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active Pokémon`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...state.players[seat],
        active: { ...active, conditions: { ...active.conditions, rotation } },
      },
    },
  };
}
