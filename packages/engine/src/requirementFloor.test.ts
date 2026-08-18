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

// D365 — THE FLOOR THE HANDOFF UNDERSTATED, AND THE PARTITION THAT FOUND IT.
//
// D364 handed over a population, a price and an ordering. The POPULATION
// reproduces exactly (§1, re-derived live off the committed corpus, and confirmed
// pool-wide on the remote D1 `luminous` `$.effect` on 2026-08-18 with the
// extractor verified against the 1,732-unit total FIRST): **9 sentences / 18 legal
// units open with the `"If <clause>, this attack does nothing."` skeleton, 2 s /
// 4 u were carried, 7 s / 14 u reached the table and MISSED.** Its "ZERO anchors
// refuse them" claim reproduces too — every one of the seven matches
// `ATTACK_DOES_NOTHING` and misses on the CLAUSE, so nothing regex-shaped is in
// the way and what refuses them is VOCABULARY.
//
// 🛑 **THE PRICE DOES NOT REPRODUCE, AND IT IS WRONG IN THE UNUSUAL DIRECTION.**
// The handoff put the zero-new-vocabulary floor at *"2 rows / 2 sentences / 3
// legal printings"* — `handSizesEqual` and `opponentPrizesRemaining`. Partition
// the seven by WHAT ACTUALLY REFUSES EACH, against the LIVE `BoardCondition`
// union, and it is **3 rows / 3 sentences / 5 legal printings**: Mesprit
// `sv08-079`/`sv08-204` *"If you don't have Uxie and Azelf on your Bench…"* is
// answerable TODAY, because `allOf` (D280) and `yourBenchHasNamed` (D118) already
// exist and a printed conjunction of two bench-name facts needs neither of them
// widened. The handoff never enumerated it. **A COUNT CAN REPRODUCE EXACTLY WHILE
// ITS ATTRIBUTION IS WRONG — AND THE ATTRIBUTION CAN BE WRONG BY LEAVING SOMETHING
// OUT**, which is the harder direction to notice, because an understated price
// looks like conservatism rather than like an error.
//
// 🛑 **AND NEITHER OF THE TWO THINGS THE HANDOFF CALLED "WIDENINGS" IS ONE. 0 OF
// 2**, driven in §4:
//
//   • `yourStadiumInPlay` yours→any would be a RENAME, not a widening. Its arm is
//     `state.stadium.owner === seat` and TWO live consumers depend on the
//     ownership — the registry `FALKNER` row and the positive clause row *"you
//     have a Stadium in play"* — so widening it changes what Falkner draws. **A
//     WIDENING IS FREE EXACTLY WHEN EVERY EXISTING CONSUMER WANTS THE WIDER
//     READING**, and that is a question about the consumers, not about whether the
//     member's NAME could stretch to cover the new sentence.
//   • Burned is an ADDITION. `StatusConditions.burned` exists on the model, but no
//     `BoardCondition` member reads it: `opponentActivePoisoned` reads a counter
//     amount, and `opponentActiveHasSpecialCondition` is ANY condition — narrowing
//     it to Burn would break Sableye's +70.
//
// WHAT SHIPS: three rows in `ATTACK_REQUIREMENT_CLAUSES`. ZERO new
// `BoardCondition` members, ops, events, error codes, regexes, registry rows or
// state fields. `allOf` gains its FIRST DERIVED PRODUCER (§6) and no consumer
// gains an arm.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The skeleton, as a labelled COPY — the reader's own pattern is module-private.
    Tied to the live reader in both directions everywhere it is used. */
const SKELETON = /^If (.+?), this attack does nothing\.(?: (.+))?$/;

/** The three sentences this slice BUYS, with their legal printing counts. */
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

/** The four sentences this slice REFUSES, with their legal printing counts and
    the vocabulary each would cost. D366's population, named rather than counted. */
const REFUSED: readonly (readonly [string, number, string])[] = [
  [
    "If there is no Stadium in play, this attack does nothing.",
    2,
    "an ANY-OWNER stadium member — `yourStadiumInPlay` cannot be widened without changing Falkner",
  ],
  [
    "If you don't have exactly 3 cards in your hand, this attack does nothing.",
    2,
    "an OWN-hand exact-size member — `opponentHandAtMost` is the wrong seat AND the wrong comparator",
  ],
  [
    "If you have 4 or fewer Benched Pokémon, this attack does nothing.",
    4,
    "an own-BENCH-COUNT member — nothing in the union counts your own bodies",
  ],
  [
    "If your opponent's Active Pokémon isn't Burned, this attack does nothing.",
    1,
    "a BURNED member — the state field exists, no condition reads it",
  ],
];

/** The five ids this slice's three sentences are printed on. */
const BOUGHT_IDS = [
  "sv07-071",
  "sv08.5-046",
  "sv09-138",
  "sv08-079",
  "sv08-204",
] as const;

/** Setup, then open P1's turn 2 (P2 went first and passed). A DEDICATED deck
    (D270), so no other suite's seeded shuffles move. */
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
  it("re-derives 9 s / 18 u behind the skeleton, and 5 s / 9 u now carried", () => {
    const openers = corpus().filter(([, s]) => SKELETON.test(s.trim()));
    expect([openers.length, units(openers)]).toEqual([9, 18]);
    const carried = openers.filter(([, s]) => deriveAttackRequirement(s) !== null);
    expect([carried.length, units(carried)]).toEqual([5, 9]);
    const missing = openers.filter(([, s]) => deriveAttackRequirement(s) === null);
    expect([missing.length, units(missing)]).toEqual([4, 9]);
    // THE PARTITION SUMS. Parts that do not add to the population are not a
    // partition, however carefully each half is measured.
    expect(carried.length + missing.length).toBe(openers.length);
    expect(units(carried) + units(missing)).toBe(units(openers));
  });

  it("🛑 ZERO ANCHORS refuse any of the seven D364 handed over — the refusal is VOCABULARY", () => {
    // The claim the handoff made, re-derived rather than inherited: every one of
    // the seven MATCHES the skeleton and fails at the TABLE. If any had been
    // refused by the pattern, the price would have been an anchor and not a row,
    // and D363's whole lesson is that those two prices differ by an order of
    // magnitude.
    const seven = [...BOUGHT, ...REFUSED].map(([s]) => s);
    expect(seven).toHaveLength(7);
    for (const sentence of seven) {
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
  });

  it("🛑 the FLOOR is 3 sentences / 5 printings, not the handoff's 2 / 3", () => {
    // The correction, as a measurement. `BOUGHT` is priced against the corpus
    // rather than against itself, so a printing count that rotted with the sets
    // reddens here.
    expect(BOUGHT).toHaveLength(3);
    expect(BOUGHT.reduce((sum, [, n]) => sum + n, 0)).toBe(5);
    for (const [sentence, expected, who] of BOUGHT) {
      const printed = corpus().filter(([, s]) => s === sentence);
      expect(units(printed), who).toBe(expected);
    }
    // And the residue this slice leaves, priced the same way — 4 / 9.
    expect(REFUSED).toHaveLength(4);
    expect(REFUSED.reduce((sum, [, n]) => sum + n, 0)).toBe(9);
    for (const [sentence, expected, cost] of REFUSED) {
      const printed = corpus().filter(([, s]) => s === sentence);
      expect(units(printed), cost).toBe(expected);
    }
    // 5 + 9 = 14, which is D364's own missing population to the unit.
    expect(
      BOUGHT.reduce((sum, [, n]) => sum + n, 0) + REFUSED.reduce((sum, [, n]) => sum + n, 0),
    ).toBe(14);
  });
});

describe("§2 — the NO-NEW-VOCABULARY refutation, and the substring trap", () => {
  it("🛑 all three map onto members that ALREADY EXISTED — spelled out, by value", () => {
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

  it("🛑 the TWO CONSEQUENTS stay disjoint, and the trap is a SUBSTRING this time", () => {
    // Delete the two characters "n't" plus "do " from Iron Boulder's key and you
    // have Bronzong's key exactly — one table maps it to a CANCEL, the other to a
    // +90. A reader built on `includes` rather than on whole-clause equality would
    // score a damage bonus off a sentence meaning "do nothing", which is the one
    // direction D125's disjointness rule exists to forbid.
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
  it("🛑 all three are SINGLE sentences, so `splitAttackRequirementClause` returns null", () => {
    // The census claim `precociousEvolution.test.ts` makes about `splitHead` (13,
    // unmoved) rests on this and nothing else. D363's row moved the split term's
    // NEIGHBOURHOOD because Sawk prints a companion; these three do not.
    for (const [sentence, , who] of BOUGHT) {
      expect(splitAttackRequirementClause(sentence), who).toBeNull();
      // …and the reason is the EMPTY BODY branch, not the accounting guard: the
      // skeleton's optional trailing group captured nothing.
      expect(SKELETON.exec(sentence.trim())?.[2], who).toBeUndefined();
    }
  });

  it("but the split WOULD fire on any of them with a companion — the branch is live", () => {
    // Without this the case above passes on a reader that had stopped splitting
    // altogether. Constructed, and labelled: no printing carries these shapes.
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
  it("🛑 `yourStadiumInPlay` reads OWNERSHIP, so yours→any is a RENAME", () => {
    // The refutation on a board: with the OPPONENT's Stadium in the zone, the
    // member is FALSE. Fan Rotom's printed clause is *"there is no Stadium in
    // play"* — no possessive at all — so an any-owner reading is a DIFFERENT
    // predicate, and re-pointing this member at it would silently change what
    // Falkner draws.
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
    // And the sentence is STILL unread, which is the whole point of refusing it.
    expect(
      deriveAttackRequirement("If there is no Stadium in play, this attack does nothing."),
    ).toBeNull();
  });

  it("🛑 Burn is an ADDITION — no member reads it, and the ANY-condition one is wider", () => {
    // `opponentActiveHasSpecialCondition` is TRUE on a Burned board AND on an
    // Asleep one, so it cannot stand in for "isn't Burned": the requirement would
    // hold on a board the printed card cancels on.
    let state = ready(2202, "fix-cramorant", [["fix-energy", 1]]);
    const withBurn = burn(state, "p2");
    expect(conditionHolds(withBurn, "p1", { kind: "opponentActiveHasSpecialCondition" })).toBe(true);
    const withSleep = rotate(state, "p2", "asleep");
    expect(conditionHolds(withSleep, "p1", { kind: "opponentActiveHasSpecialCondition" })).toBe(
      true,
    );
    // Two DIFFERENT boards, one answer — which is exactly why narrowing this
    // member would be wrong and adding a sibling is what the sentence costs.
    state = withSleep;
    expect(
      deriveAttackRequirement("If your opponent's Active Pokémon isn't Burned, this attack does nothing."),
    ).toBeNull();
  });
});

describe("§5 — on a BOARD: each of the three cancels and lands, and the ids are named", () => {
  it("🛑 handSizesEqual — equal hands attack, unequal hands do NOTHING", () => {
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

  it("🛑 opponentPrizesRemaining — 3 and 4 land, 2 and 5 do NOTHING (membership, not a range)", () => {
    const base = ready(3102, "fix-cramorant", [["fix-energy", 1]]);
    for (const count of [3, 4]) {
      const state = setPrizes(base, "p2", count);
      expect(conditionHolds(state, "p1", { kind: "opponentPrizesRemaining", counts: [3, 4] })).toBe(
        true,
      );
      expect(attackOutcome(state).cancelled, `p2 at ${count} prizes`).toBe(false);
    }
    // 🛑 THE MEMBERSHIP CLAIM. 2 is BELOW the list and 5 is ABOVE it, and both are
    // FALSE — a "between 3 and 4" reading answers this card identically on every
    // board, so the only thing that can tell the two readings apart is driving the
    // values OUTSIDE the interval on both sides.
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

  it("🛑 the `allOf` row — BOTH names required, and ONE of them is not enough", () => {
    const base = ready(3103, "fix-mesprit", [["fix-psychic-energy", 2]]);
    const both = benchFromDeck(benchFromDeck(base, "p1", "fix-uxie"), "p1", "fix-azelf");
    const landed = attackOutcome(both);
    expect(landed.cancelled).toBe(false);
    expect(landed.kinds).toContain("DAMAGE_DEALT");
    // 🛑 THE REFUTATION THE COMBINATOR EXISTS FOR. With ONLY Uxie the attack does
    // nothing — an `allOf` folded with `.some` instead of `.every`, or a row that
    // read one name and dropped the other, passes the case above and fails here.
    const onlyUxie = benchFromDeck(base, "p1", "fix-uxie");
    expect(attackOutcome(onlyUxie).cancelled).toBe(true);
    const onlyAzelf = benchFromDeck(base, "p1", "fix-azelf");
    expect(attackOutcome(onlyAzelf).cancelled).toBe(true);
    // And a bench of the SAME SHAPE under a different name fails too, so the row
    // is keyed on the printed names and not on "two bodies are benched".
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

  it("🛑 the ATTRIBUTION control: the gate really runs and answers TRUE unforced", () => {
    // D214's attribution control, in the direction the three cases above cannot
    // cover: they all show a CANCEL, so a requirement wired to cancel
    // unconditionally would pass every one of them. This one asserts the opposite
    // outcome on an untouched board.
    //
    // ⚠️ **AND THE CONTROL THAT NAMES NONE OF THIS SLICE'S IDS IS §1, NOT THIS
    // CASE.** §1 walks the committed corpus and names no fixture and no card id at
    // all; probed by deleting the Mesprit row, it goes red on 2 of its 3 cases
    // while this file's board cases still pass their non-Mesprit halves. A control
    // that shares a fixture with the thing it controls is an attribution control,
    // not an independence one, and the two are worth keeping apart.
    const state = setActiveFromDeck(
      clearBench(board(3104), "p1"),
      "p1",
      "fix-uxie",
    );
    // `fix-uxie` prints no attack at all, so declaring one is rejected rather than
    // cancelled — the loudest possible statement that nothing above is a no-op.
    expect(state.players.p1.active).not.toBeNull();
    const after = mustApply(
      attachFromDeck(setActiveFromDeck(state, "p1", "fix-ironboulder"), "p1", "fix-psychic-energy", 2),
      { type: "attack", seat: "p1", index: 0 },
    );
    // Hands are dealt EQUAL at setup (7 each, both seats drew the same), so this
    // untouched board LANDS — the requirement is running and answering TRUE.
    expect(types(after.events)).toContain("DAMAGE_DEALT");
  });

  it("🛑 S2 — none of the five ids is a registry row, so the registry summand cannot move", () => {
    const ids = registryCardIds();
    expect(ids).toHaveLength(708);
    for (const id of BOUGHT_IDS) {
      expect(ids, id).not.toContain(id);
      expect(programFor(id), id).toBeUndefined();
    }
  });
});

describe("§6 — `allOf` gains its first DERIVED producer, and nothing downstream moves", () => {
  it("🛑 every `allOf` before this slice was authored in registry.ts — 5 sites, 14 ids", () => {
    const withAllOf = registryCardIds().filter((id) =>
      JSON.stringify(programFor(id) ?? {}).includes('"allOf"'),
    );
    expect(withAllOf).toHaveLength(14);
    // …and NONE of them is one of this slice's ids, so the derived producer is
    // genuinely new rather than a second path to an existing value.
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

  it("🛑 the EXHAUSTIVE-SWITCH count is unchanged: this slice adds no reader arm", () => {
    // The two `switch (cond.kind)` statements in interpreter.ts are the whole
    // consumer set (D280 measured it at TWO where D125's note had said five). A
    // row reusing existing members owes neither of them anything, and the proof is
    // that all three derived values are answerable by BOTH readers today.
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
