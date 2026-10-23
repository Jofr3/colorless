import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import {
  deriveAttackDamageBonus,
  deriveAttackRequirement,
  splitAttackRequirementClause,
} from "./effects";
import type { BoardCondition, GameState } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { programFor, registryCardIds } from "./registry";
import {
  BENCH_COUNT_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The skeleton, as a labelled COPY — the reader's own pattern is module-private.
    Tied to the live reader in both directions everywhere it is used. */
const SKELETON = /^If (.+?), this attack does nothing\.(?: (.+))?$/;

/** Victini's printed sentence, and the constructed companion the fixture's
    control attack prints beside it. */
const V_FORCE = "If you have 4 or fewer Benched Pokémon, this attack does nothing.";
const V_FORCE_RIDER = `${V_FORCE} Then, spin the wheel of fate.`;

const VICTINI_IDS = ["sv10.5b-012", "sv10.5b-171", "sv10.5w-172", "svp-208"] as const;

const REFUSED: readonly (readonly [string, number, string])[] = [];

const TAKEN_SINCE: readonly (readonly [string, number, string, BoardCondition])[] = [
  [
    "If there is no Stadium in play, this attack does nothing.",
    2,
    "an ANY-OWNER stadium member — `yourStadiumInPlay` reads ownership (D365, driven; TAKEN at D378)",
    { kind: "stadiumInPlay" },
  ],
  [
    "If your opponent's Active Pokémon isn't Burned, this attack does nothing.",
    1,
    "a BURNED member — the state field exists, no condition reads it (D365, driven; TAKEN at D377)",
    { kind: "opponentActiveBurned" },
  ],
  [
    "If you don't have exactly 3 cards in your hand, this attack does nothing.",
    2,
    "an OWN-hand exact-size member — `opponentHandAtMost` is the wrong seat AND the wrong comparator (D365, driven; TAKEN at D379)",
    { kind: "yourHandExactly", count: 3 },
  ],
];

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: BENCH_COUNT_DECK, p2: BENCH_COUNT_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields Victini with {R}{R} paid, P2 fields a 200 HP body that survives the
    printed 120, and BOTH benches start EMPTY — every case here adds exactly the
    bodies it is about. */
function ready(seed: number): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-victini");
  state = attachFromDeck(state, "p1", "fix-fire-energy", 2);
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  return clearBench(clearBench(state, "p1"), "p2");
}

/** Put `n` nameless bodies on P1's Bench. */
function withBench(state: GameState, n: number): GameState {
  let next = state;
  for (let i = 0; i < n; i += 1) next = benchFromDeck(next, "p1", "fix-benchfiller");
  return next;
}

/** Attack `index` and report whether the REQUIREMENT cancelled it. */
function attackOutcome(state: GameState, index = 0): { cancelled: boolean; kinds: string[] } {
  const after = mustApply(state, { type: "attack", seat: "p1", index });
  const failed = after.events.find((e) => e.type === "ATTACK_FAILED");
  return {
    cancelled: failed !== undefined && (failed as { reason?: string }).reason === "requirement",
    kinds: types(after.events),
  };
}

describe("§1 — the population reproduces, and this time SO DOES THE PRICE", () => {
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

  it("Victini is FOUR legal printings, priced against the corpus and not against itself", () => {
    expect(units(corpus().filter(([, s]) => s === V_FORCE))).toBe(4);
    for (const [sentence, count] of REFUSED) {
      expect(units(corpus().filter(([, s]) => s === sentence)), sentence).toBe(count);
      expect(count).toBeLessThan(4);
    }
    expect(REFUSED).toHaveLength(0);
    expect(TAKEN_SINCE).toHaveLength(3);
    const handed: readonly (readonly [string, number, string])[] = [
      ...REFUSED,
      ...TAKEN_SINCE.map(([sentence, n, cost]) => [sentence, n, cost] as const),
    ];
    expect(handed).toHaveLength(3);
    expect(handed.reduce((sum, [, n]) => sum + n, 0)).toBe(5);
    expect(handed.reduce((sum, [, n]) => sum + n, 0) + 4).toBe(9);
  });

  it("the FLOOR was 0 / 0 / 0 — every one of D365's four needed an ADDITION", () => {
    expect([...REFUSED, ...TAKEN_SINCE]).toHaveLength(3);
    for (const [sentence, , cost] of REFUSED) {
      expect(deriveAttackRequirement(sentence), cost).toBeNull();
    }
    for (const [sentence, , cost, member] of TAKEN_SINCE) {
      expect(deriveAttackRequirement(sentence), cost).toEqual(member);
    }
    for (const [sentence] of [...REFUSED, ...TAKEN_SINCE]) {
      expect(SKELETON.test(sentence.trim()), sentence).toBe(true);
      expect(SKELETON.exec(sentence.trim())?.[1], sentence).toBeTruthy();
    }
  });
});

describe("§2 — the COMPARATOR, settled from the catalog before it was spelled", () => {
  it("the row maps to `yourBenchAtLeast { count: 5 }` — the printed 4, flipped", () => {
    expect(deriveAttackRequirement(V_FORCE)).toEqual({ kind: "yourBenchAtLeast", count: 5 });
    expect(V_FORCE).toContain("4 or fewer");
    expect((deriveAttackRequirement(V_FORCE) as { count: number }).count).toBe(5);
  });

  it("the pool VARIES the threshold and the SEAT, so a full-Bench predicate is the wrong shape", () => {
    const benchCounts = corpus().filter(
      ([, s]) => /\d+ or (fewer|more) Benched Pokémon/.test(s) && !s.includes("damage counters"),
    );
    expect(benchCounts.map(([, s]) => s).sort()).toEqual([
      "If you have 4 or fewer Benched Pokémon, this attack does nothing.",
      "If your opponent has 3 or more Benched Pokémon, this attack does 80 more damage.",
    ]);
    expect(benchCounts.some(([, s]) => s.includes("3 or more"))).toBe(true);
    const sibling =
      "If your opponent has 3 or more Benched Pokémon, this attack does 80 more damage.";
    expect(units(corpus().filter(([, s]) => s === sibling))).toBe(1);
    expect(deriveAttackDamageBonus(sibling)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentBenchAtLeast", count: 3 },
    });
    expect(deriveAttackRequirement(sibling)).toBeNull();
    expect(deriveAttackRequirement(V_FORCE)).toEqual({ kind: "yourBenchAtLeast", count: 5 });
  });

  it("the anchor guards hold on the new key — no /i, the period is required, `^` is pinned", () => {
    const clause = SKELETON.exec(V_FORCE)?.[1] ?? "";
    expect(clause).toBe("you have 4 or fewer Benched Pokémon");
    // Lowercase `if` — the skeleton has no /i.
    expect(deriveAttackRequirement(`if ${clause}, this attack does nothing.`)).toBeNull();
    // No trailing period is not the whole sentence.
    expect(deriveAttackRequirement(`If ${clause}, this attack does nothing`)).toBeNull();
    // Leading text pins `^` — the coin family's shape, on this clause.
    expect(
      deriveAttackRequirement(`Flip a coin. If ${clause}, this attack does nothing.`),
    ).toBeNull();
    expect(deriveAttackDamageBonus(V_FORCE)).toBeNull();
    expect(
      deriveAttackRequirement(
        "If you have 4 or fewer Benched Pokémon, this attack does 80 more damage.",
      ),
    ).toBeNull();
  });
});

describe("§3 — the two WIDENING candidates are not widenings, and that is DRIVEN", () => {
  it("`yourOwnerPokemonInPlayAtLeast` counts the ACTIVE too — one body more, on Victini's own board", () => {
    const full = withBench(ready(4101), 5);
    expect(full.players.p1.bench).toHaveLength(5);
    expect(full.players.p1.active).not.toBeNull();
    expect(conditionHolds(full, "p1", { kind: "yourBenchAtLeast", count: 5 })).toBe(true);
    // …and at FOUR benched the two answers SEPARATE: the printed card cancels, an
    // in-play reading of the same 5 would let it attack.
    const four = withBench(ready(4102), 4);
    expect(four.players.p1.bench).toHaveLength(4);
    expect(conditionHolds(four, "p1", { kind: "yourBenchAtLeast", count: 5 })).toBe(false);
    const inPlay = 1 + four.players.p1.bench.length;
    expect(inPlay).toBe(5);
    // The board that refutes the widening in one line: bench 4, in play 5.
    expect(inPlay).not.toBe(four.players.p1.bench.length);
    // And the existing member is UNTOUCHED — it still requires its owner prefix,
    // so a nameless filler Bench does not satisfy it at any count.
    expect(
      conditionHolds(full, "p1", {
        kind: "yourOwnerPokemonInPlayAtLeast",
        owner: "Team Rocket",
        count: 1,
      }),
    ).toBe(false);
  });

  it("`yourBenchHasNamed` reads a NAME, so it cannot be widened into a COUNT", () => {
    const full = withBench(ready(4103), 5);
    expect(conditionHolds(full, "p1", { kind: "yourBenchAtLeast", count: 5 })).toBe(true);
    expect(conditionHolds(full, "p1", { kind: "yourBenchHasNamed", name: "Uxie" })).toBe(false);
    expect(conditionHolds(full, "p1", { kind: "yourBenchHasNamed", name: "Victini" })).toBe(false);
    const widenings = [
      conditionHolds(full, "p1", { kind: "yourBenchAtLeast", count: 5 }) ===
        conditionHolds(full, "p1", { kind: "yourBenchHasNamed", name: "Uxie" }),
      1 + full.players.p1.bench.length === full.players.p1.bench.length,
    ];
    expect(widenings.filter(Boolean)).toHaveLength(0);
  });
});

describe("§4 — on a BOARD: the cancel, the land, and the boundary between them", () => {
  it("0 through 4 Benched CANCELS, and it is the REQUIREMENT that cancels", () => {
    for (let n = 0; n <= 4; n += 1) {
      const outcome = attackOutcome(withBench(ready(4200 + n), n));
      expect(outcome.cancelled, `bench ${String(n)}`).toBe(true);
      expect(outcome.kinds, `bench ${String(n)}`).not.toContain("DAMAGE_DEALT");
      // The cancel is SIMULATED, not skipped: both halves of the printed card are
      // accounted for, so nothing lands on the loud path.
      expect(outcome.kinds, `bench ${String(n)}`).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
  });

  it("FIVE Benched lands the printed 120 — the same board, one body more", () => {
    const outcome = attackOutcome(withBench(ready(4210), 5));
    expect(outcome.cancelled).toBe(false);
    expect(outcome.kinds).toContain("DAMAGE_DEALT");
    expect(outcome.kinds).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("the boundary is between 4 and 5 and it is the ONLY one — off by one either way is a real card", () => {
    const base = (n: number, seed: number) => withBench(ready(seed), n);
    const holds = (n: number, count: number) =>
      conditionHolds(base(n, 4300 + n), "p1", { kind: "yourBenchAtLeast", count });
    expect([0, 1, 2, 3, 4].map((n) => holds(n, 5))).toEqual([false, false, false, false, false]);
    expect(holds(5, 5)).toBe(true);
    expect(holds(4, 4)).toBe(true);
    expect(holds(4, 5)).toBe(false);
    expect(holds(5, 6)).toBe(false);
  });

  it("the ACTIVE SPOT IS NOT COUNTED — a full Bench is 5 and not 6", () => {
    const full = withBench(ready(4310), 5);
    expect(full.players.p1.active).not.toBeNull();
    expect(full.players.p1.bench).toHaveLength(5);
    // Bench-only, exactly as `yourBenchDamaged` and `yourBenchHasNamed` read the
    // printed word. If the Active were spread in, `count: 6` would hold here.
    expect(conditionHolds(full, "p1", { kind: "yourBenchAtLeast", count: 6 })).toBe(false);
    // …and the OPPONENT's Bench is invisible to it: a seat-relative member, so
    // filling P2's Bench cannot satisfy P1's requirement.
    let oppFull = full;
    for (let i = 0; i < 5; i += 1) oppFull = benchFromDeck(oppFull, "p2", "fix-benchfiller");
    expect(oppFull.players.p2.bench).toHaveLength(5);
    const empty = clearBench(oppFull, "p1");
    expect(conditionHolds(empty, "p1", { kind: "yourBenchAtLeast", count: 5 })).toBe(false);
    expect(conditionHolds(empty, "p2", { kind: "yourBenchAtLeast", count: 5 })).toBe(true);
  });

  it("the note is read off the BOARD and states the POSITIVE fact", () => {
    const cond = deriveAttackRequirement(V_FORCE) as BoardCondition;
    expect(conditionNote(cond)).toBe("you have 5 or more Benched Pokémon");
    // It never repeats the printed "4 or fewer" — the note tells a player what to
    // DO, and the sentence's negation was discharged by the skeleton.
    expect(conditionNote(cond)).not.toContain("4 or fewer");
    // Built from the PARAMETER rather than hard-coded, which is the only thing
    // that keeps it honest when the threshold varies (see §2's sibling).
    expect(conditionNote({ kind: "yourBenchAtLeast", count: 3 })).toBe(
      "you have 3 or more Benched Pokémon",
    );
  });
});

describe("§5 — the census terms, MEASURED rather than assumed", () => {
  it("S2 — none of the four ids is a registry row, so the registry summand cannot move", () => {
    const ids = registryCardIds();
    expect(ids).toHaveLength(1451);
    for (const id of VICTINI_IDS) {
      expect(ids, id).not.toContain(id);
      expect(programFor(id), id).toBeUndefined();
    }
  });

  it("the SPLIT term stands still, and the branch is proven LIVE beside it", () => {
    expect(splitAttackRequirementClause(V_FORCE)).toBeNull();
    expect(SKELETON.exec(V_FORCE.trim())?.[2]).toBeUndefined();
    // …and the fixture's CONTROL attack proves the branch is live on this very
    // clause: with a companion behind it the split fires and hands the remainder
    // back rather than eating it.
    expect(splitAttackRequirementClause(V_FORCE_RIDER)).toEqual({
      clause: V_FORCE,
      body: "Then, spin the wheel of fate.",
    });
    // The requirement is still read off the UNSPLIT string, which is the order
    // `attack.ts` commits to.
    expect(deriveAttackRequirement(V_FORCE_RIDER)).toEqual(deriveAttackRequirement(V_FORCE));
  });

  it("the control attack CANCELS too — the split does not smuggle the requirement away", () => {
    expect(attackOutcome(withBench(ready(4400), 2), 1).cancelled).toBe(true);
    const landed = attackOutcome(withBench(ready(4401), 5), 1);
    expect(landed.cancelled).toBe(false);
    expect(landed.kinds).toContain("DAMAGE_DEALT");
    // The companion is UNREAD by design, so the loud path is what reports it —
    // this is the accounting guard showing through, not a failure.
    expect(landed.kinds).toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("exactly ONE corpus sentence moved, and it is worth exactly FOUR units", () => {
    const nowCarried = corpus().filter(
      ([, s]) => SKELETON.test(s.trim()) && deriveAttackRequirement(s) !== null,
    );
    expect(nowCarried).toHaveLength(9);
    const victini = nowCarried.filter(([, s]) => s === V_FORCE);
    expect(units(victini)).toBe(4);
    expect(units(nowCarried) - units(victini) - 2 - 2 - 1).toBe(9);
  });
});

describe("§6 — the exhaustive readers, and the guard D365 keyed on the wrong population", () => {
  it("BOTH `switch (cond.kind)` readers gained an arm, and both answer", () => {
    const state = withBench(ready(4500), 5);
    const cond = deriveAttackRequirement(V_FORCE) as BoardCondition;
    expect(typeof conditionHolds(state, "p1", cond)).toBe("boolean");
    expect(conditionNote(cond).length).toBeGreaterThan(0);
    // …and the member is reachable through the recursive combinator too, at no
    // cost: `allOf` folds it with the same `.every` it folds everything with.
    expect(
      conditionHolds(state, "p1", {
        kind: "allOf",
        conditions: [
          { kind: "yourBenchAtLeast", count: 5 },
          { kind: "yourBenchAtLeast", count: 1 },
        ],
      }),
    ).toBe(true);
    expect(
      conditionHolds(state, "p1", {
        kind: "allOf",
        conditions: [
          { kind: "yourBenchAtLeast", count: 5 },
          { kind: "yourBenchAtLeast", count: 6 },
        ],
      }),
    ).toBe(false);
  });

  it("the table's FIRST apostrophe-free key — and that is what D365's completeness guard got wrong", () => {
    expect(V_FORCE).not.toContain("'");
    expect(deriveAttackRequirement(V_FORCE)).not.toBeNull();
    const carried = corpus()
      .filter(([, s]) => deriveAttackRequirement(s) !== null && SKELETON.test(s.trim()))
      .map(([, s]) => /^(If .+?, this attack does nothing\.)/.exec(s.trim())?.[1] ?? s.trim());
    expect(carried).toHaveLength(9);
    expect(carried.filter((s) => s.includes("'"))).toHaveLength(7);
    expect(carried.filter((s) => !s.includes("'"))).toHaveLength(2);
    expect(carried.filter((s) => !s.includes("'")).sort()).toEqual(
      [V_FORCE, "If there is no Stadium in play, this attack does nothing."].sort(),
    );
  });
});
