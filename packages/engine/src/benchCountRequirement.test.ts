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

// D366 — THE OWN-BENCH COUNT, AND A COMPARATOR SETTLED FROM THE CATALOG BEFORE IT
// WAS SPELLED.
//
// D365 handed over four sentences / nine legal printings still behind the
// `"If <clause>, this attack does nothing."` skeleton, every one refused by
// VOCABULARY. **THE POPULATION REPRODUCES EXACTLY** (§1, re-derived live off the
// committed corpus and confirmed pool-wide on the remote D1 `luminous` `$.effect`
// on 2026-08-19 with the extractor verified against the 640 / 1,732 / 60,467
// total FIRST): 9 sentences / 18 legal units open with the skeleton, 5 s / 9 u
// were carried, 4 s / 9 u reached the table and MISSED.
//
// 🛑 **AND SO DOES THE PRICE, WHICH IS THE FIRST TIME IN FOUR SLICES.** D363
// found an inherited price too HIGH, D365 found one too LOW. This one is exact:
// partitioned by WHAT ACTUALLY REFUSES EACH, against the live `BoardCondition`
// union, the zero-new-vocabulary floor for D366's four is **0 rows / 0 sentences
// / 0 printings** — every one of the four needs an ADDITION, and §1 says so by
// value rather than by assertion. Victini is the largest at FOUR legal printings,
// twice any other, and it is the one this slice buys.
//
// 🛑 **THE COMPARATOR WAS A CATALOG QUESTION AND IT WAS ASKED FIRST.** The printed
// clause is *"4 or fewer"* under a NEGATIVE consequent, so the positive fact is
// *"5 or more"* — which on a §3.3 five-slot Bench is FULL. A `yourBenchIsFull`
// predicate would answer this card identically on every board it can ever reach,
// and would be wrong the day a printing spells a different threshold. The
// whole-pool `%Benched Pokémon%` census on all three text columns returns exactly
// TWO bench-count board facts: this one, and *"If your opponent has 3 or more
// Benched Pokémon, this attack does 80 more damage."* — the OTHER seat at a
// threshold that is NOT the cap. **THE PARAMETER IS LOAD-BEARING BECAUSE THE
// CATALOG VARIES IT, NOT BECAUSE A NUMBER READS BETTER THAN A PREDICATE.**
//
// WHAT SHIPS: ONE `BoardCondition` member (`yourBenchAtLeast`), TWO reader arms,
// ONE `ATTACK_REQUIREMENT_CLAUSES` row. ZERO new ops, events, error codes,
// regexes, registry rows, state fields, prompt kinds or choice kinds.

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

/** The four legal printings this slice buys. */
const VICTINI_IDS = ["sv10.5b-012", "sv10.5b-171", "sv10.5w-172", "svp-208"] as const;

/** The THREE sentences this slice leaves behind, with their legal printing counts
    and the vocabulary each still costs. D367's population, named rather than
    counted. */
const REFUSED: readonly (readonly [string, number, string])[] = [
  [
    "If you don't have exactly 3 cards in your hand, this attack does nothing.",
    2,
    "an OWN-hand exact-size member — `opponentHandAtMost` is the wrong seat AND the wrong comparator",
  ],
];

/** 🆕🆕 D377 — THE THIRD ROW OF D365's LIST, MOVED OUT OF `REFUSED` RATHER THAN
    DELETED FROM IT (D178: provenance is annotated, never overwritten). The entry
    below is D365's own words and its own price, and its last clause has STOPPED
    BEING TRUE: `opponentActiveBurned` now reads exactly that state field, bought by
    D377 for a BONUS clause one table over and reaching this consequent through
    `ATTACK_REQUIREMENT_CLAUSES`' polarity rule at no extra cost. Kept here so the
    partition below still sums to D365's 4 / 9 and so a successor can see WHICH item
    left the list and when. */
const TAKEN_SINCE: readonly (readonly [string, number, string, BoardCondition])[] = [
  // 🆕🆕 D378 — THE FIRST ROW OF D365's LIST, MOVED THE SAME WAY, AND D365's PRICE WAS
  // RIGHT ON BOTH HALVES: it said the sentence needed *"an ANY-OWNER stadium member"*
  // and that `yourStadiumInPlay` reads OWNERSHIP, and D378 added `stadiumInPlay`
  // BESIDE that member rather than re-pointing it. **THE REFUSAL WAS NOT OVERTURNED —
  // IT WAS PAID** (D178: annotate provenance, never overwrite it). One row of D365's
  // four is now the whole of what is left.
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
];

/** Setup, then open P1's turn 2 (P2 went first and passed). A DEDICATED deck
    (D270), so no other suite's seeded shuffles move. */
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
    // 🆕🆕 D377 — 6 / 13 -> 7 / 14 and the missing 3 / 5 -> 2 / 4: the CROSS-BOARD
    // STATUS PAIR took the third item on `REFUSED` below, off a member it bought for
    // a BONUS row in the same commit. The population (9 / 18) is unmoved.
    // 🆕🆕 D378 — 7 / 14 -> 8 / 16 and the missing 2 / 4 -> 1 / 2: STADIUM PRESENCE
    // took the FIRST item on `REFUSED`, again off a member bought for a BONUS row in
    // the same commit. The population (9 / 18) is still unmoved, and ONE row is left.
    const carried = openers.filter(([, s]) => deriveAttackRequirement(s) !== null);
    expect([carried.length, units(carried)]).toEqual([8, 16]);
    const missing = openers.filter(([, s]) => deriveAttackRequirement(s) === null);
    expect([missing.length, units(missing)]).toEqual([1, 2]);
    // THE PARTITION SUMS — parts that do not add to the population are not a
    // partition, however carefully each half is measured.
    expect(carried.length + missing.length).toBe(openers.length);
    expect(units(carried) + units(missing)).toBe(units(openers));
  });

  it("🛑 Victini is FOUR legal printings, priced against the corpus and not against itself", () => {
    // The handoff's headline number, re-derived. A printing count that rotted with
    // the sets reddens here rather than in a comment.
    expect(units(corpus().filter(([, s]) => s === V_FORCE))).toBe(4);
    // …and it really is the largest of the four D365 left. Every other sentence on
    // that list is worth strictly fewer printings, which is the claim that made it
    // the subject.
    for (const [sentence, count] of REFUSED) {
      expect(units(corpus().filter(([, s]) => s === sentence)), sentence).toBe(count);
      expect(count).toBeLessThan(4);
    }
    // The residue this slice leaves, priced the same way — 3 sentences / 5
    // printings, which with Victini's 4 is D365's own 4 / 9 to the unit.
    // 🆕🆕 D377 — the list is now TWO rows plus `TAKEN_SINCE`'s one, and the sum is
    // still D366's 3 / 5, which is what keeps this an accounting of D365's handoff
    // rather than a snapshot of today.
    // 🆕🆕 D378 — ONE row plus `TAKEN_SINCE`'s TWO, and the sum is STILL D366's 3 / 5.
    expect(REFUSED).toHaveLength(1);
    expect(TAKEN_SINCE).toHaveLength(2);
    const handed: readonly (readonly [string, number, string])[] = [
      ...REFUSED,
      ...TAKEN_SINCE.map(([sentence, n, cost]) => [sentence, n, cost] as const),
    ];
    expect(handed).toHaveLength(3);
    expect(handed.reduce((sum, [, n]) => sum + n, 0)).toBe(5);
    expect(handed.reduce((sum, [, n]) => sum + n, 0) + 4).toBe(9);
  });

  it("🛑 the FLOOR was 0 / 0 / 0 — every one of D365's four needed an ADDITION", () => {
    // D363 found an inherited price too HIGH and D365 found one too LOW, so this
    // slice states its floor as a NUMBER that measurement can contradict: of the
    // four sentences D365 handed over, how many were answerable with vocabulary
    // that already existed? ZERO. Victini is the proof by construction — this
    // slice had to buy a member to answer it — and the other three are named with
    // what each still costs, both of the driven refutations D365 recorded.
    expect([...REFUSED, ...TAKEN_SINCE]).toHaveLength(3);
    for (const [sentence, , cost] of REFUSED) {
      expect(deriveAttackRequirement(sentence), cost).toBeNull();
    }
    // 🆕🆕 D377 — and the one that LEFT the list is asserted from the other side, so
    // the record says "this was refused and is not any more" rather than going quiet.
    // 🆕🆕 D378 — the array carries the MEMBER each row now resolves to, so this pins
    // WHICH vocabulary paid the refusal and not merely that one did.
    for (const [sentence, , cost, member] of TAKEN_SINCE) {
      expect(deriveAttackRequirement(sentence), cost).toEqual(member);
    }
    // …and NONE of the three is refused by the ANCHOR: each matches the skeleton
    // and misses at the TABLE, so what refuses them is still VOCABULARY. (D363's
    // lesson: an anchor and a row differ in price by an order of magnitude.)
    for (const [sentence] of [...REFUSED, ...TAKEN_SINCE]) {
      expect(SKELETON.test(sentence.trim()), sentence).toBe(true);
      expect(SKELETON.exec(sentence.trim())?.[1], sentence).toBeTruthy();
    }
  });
});

describe("§2 — the COMPARATOR, settled from the catalog before it was spelled", () => {
  it("🛑 the row maps to `yourBenchAtLeast { count: 5 }` — the printed 4, flipped", () => {
    expect(deriveAttackRequirement(V_FORCE)).toEqual({ kind: "yourBenchAtLeast", count: 5 });
    // The polarity flip is the whole row: the skeleton owns the negation, so a
    // printed "4 or fewer" is stored as the positive floor FIVE. The sentence says
    // 4 and the value says 5, and that gap is asserted rather than left to a
    // comment.
    expect(V_FORCE).toContain("4 or fewer");
    expect((deriveAttackRequirement(V_FORCE) as { count: number }).count).toBe(5);
  });

  it("🛑 the pool VARIES the threshold and the SEAT, so a full-Bench predicate is the wrong shape", () => {
    // The census that settled the parameter, re-stated as a corpus assertion. The
    // legal attack column holds exactly TWO bench-COUNT board facts and they agree
    // on nothing: different seat, different threshold, different consequent.
    const benchCounts = corpus().filter(
      ([, s]) => /\d+ or (fewer|more) Benched Pokémon/.test(s) && !s.includes("damage counters"),
    );
    expect(benchCounts.map(([, s]) => s).sort()).toEqual([
      "If you have 4 or fewer Benched Pokémon, this attack does nothing.",
      "If your opponent has 3 or more Benched Pokémon, this attack does 80 more damage.",
    ]);
    // The sibling's threshold is THREE, which is not the Bench cap — so "5" on
    // this row is a parameter the catalog varies and not the cap wearing a number.
    expect(benchCounts.some(([, s]) => s.includes("3 or more"))).toBe(true);
    // …and it is UNBUILT at this head, on BOTH readers. D367's population, named
    // rather than counted: 1 legal printing, and it wants a seat sibling of the
    // member this slice just bought.
    const sibling = "If your opponent has 3 or more Benched Pokémon, this attack does 80 more damage.";
    expect(units(corpus().filter(([, s]) => s === sibling))).toBe(1);
    expect(deriveAttackDamageBonus(sibling)).toBeNull();
    expect(deriveAttackRequirement(sibling)).toBeNull();
  });

  it("the anchor guards hold on the new key — no /i, the period is required, `^` is pinned", () => {
    const clause = SKELETON.exec(V_FORCE)?.[1] ?? "";
    expect(clause).toBe("you have 4 or fewer Benched Pokémon");
    // Lowercase `if` — the skeleton has no /i.
    expect(deriveAttackRequirement(`if ${clause}, this attack does nothing.`)).toBeNull();
    // No trailing period is not the whole sentence.
    expect(deriveAttackRequirement(`If ${clause}, this attack does nothing`)).toBeNull();
    // Leading text pins `^` — the coin family's shape, on this clause.
    expect(deriveAttackRequirement(`Flip a coin. If ${clause}, this attack does nothing.`)).toBeNull();
    // 🛑 AND THE TWO CONSEQUENTS STAY DISJOINT (D125): the bonus reader must not
    // see a sentence meaning CANCEL, and the requirement reader must not see one
    // meaning +N.
    expect(deriveAttackDamageBonus(V_FORCE)).toBeNull();
    expect(
      deriveAttackRequirement("If you have 4 or fewer Benched Pokémon, this attack does 80 more damage."),
    ).toBeNull();
  });
});

describe("§3 — the two WIDENING candidates are not widenings, and that is DRIVEN", () => {
  it("🛑 `yourOwnerPokemonInPlayAtLeast` counts the ACTIVE too — one body more, on Victini's own board", () => {
    // The candidate: drop its `owner` and read it as "you have N or more Pokémon
    // in play". Its arm spreads `[side.active, ...side.bench]`, so on every board
    // Victini can attack from — which is every board where it HAS an Active — the
    // two predicates are one body apart. A full Bench is 5 Benched and 6 in play.
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

  it("🛑 `yourBenchHasNamed` reads a NAME, so it cannot be widened into a COUNT", () => {
    // The second candidate: make its `name` optional and add a count. Its arm
    // resolves `topCardOf(state, p)?.name`, which two live consumers depend on
    // (D280's `allOf` row and Falinks' +90), and a Bench of five nameless fillers
    // satisfies the COUNT while satisfying no NAME at all. Two predicates, one
    // board, opposite answers.
    const full = withBench(ready(4103), 5);
    expect(conditionHolds(full, "p1", { kind: "yourBenchAtLeast", count: 5 })).toBe(true);
    expect(conditionHolds(full, "p1", { kind: "yourBenchHasNamed", name: "Uxie" })).toBe(false);
    expect(conditionHolds(full, "p1", { kind: "yourBenchHasNamed", name: "Victini" })).toBe(false);
    // 0 OF 2 — stated as a number, the way D365 stated its own.
    const widenings = [
      conditionHolds(full, "p1", { kind: "yourBenchAtLeast", count: 5 }) ===
        conditionHolds(full, "p1", { kind: "yourBenchHasNamed", name: "Uxie" }),
      1 + full.players.p1.bench.length === full.players.p1.bench.length,
    ];
    expect(widenings.filter(Boolean)).toHaveLength(0);
  });
});

describe("§4 — on a BOARD: the cancel, the land, and the boundary between them", () => {
  it("🛑 0 through 4 Benched CANCELS, and it is the REQUIREMENT that cancels", () => {
    for (let n = 0; n <= 4; n += 1) {
      const outcome = attackOutcome(withBench(ready(4200 + n), n));
      expect(outcome.cancelled, `bench ${String(n)}`).toBe(true);
      expect(outcome.kinds, `bench ${String(n)}`).not.toContain("DAMAGE_DEALT");
      // The cancel is SIMULATED, not skipped: both halves of the printed card are
      // accounted for, so nothing lands on the loud path.
      expect(outcome.kinds, `bench ${String(n)}`).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
  });

  it("🛑 FIVE Benched lands the printed 120 — the same board, one body more", () => {
    const outcome = attackOutcome(withBench(ready(4210), 5));
    expect(outcome.cancelled).toBe(false);
    expect(outcome.kinds).toContain("DAMAGE_DEALT");
    expect(outcome.kinds).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 the boundary is between 4 and 5 and it is the ONLY one — off by one either way is a real card", () => {
    // The mutation rows on this member are a threshold and a comparator, so the
    // suite has to be able to tell 4 from 5 from 6. `count: 4` would attack off a
    // four-body Bench (the row above proves it must not); `count: 6` could never
    // attack at all, because `BENCH_MAX` is 5.
    const base = (n: number, seed: number) => withBench(ready(seed), n);
    const holds = (n: number, count: number) =>
      conditionHolds(base(n, 4300 + n), "p1", { kind: "yourBenchAtLeast", count });
    expect([0, 1, 2, 3, 4].map((n) => holds(n, 5))).toEqual([false, false, false, false, false]);
    expect(holds(5, 5)).toBe(true);
    // A stored 4 would separate from the shipped 5 on exactly one Bench size, and
    // that Bench size is reachable — which is what makes the row a real bug and
    // not a formatting difference.
    expect(holds(4, 4)).toBe(true);
    expect(holds(4, 5)).toBe(false);
    // A stored 6 is unreachable at every legal Bench size, `BENCH_MAX` included.
    expect(holds(5, 6)).toBe(false);
  });

  it("🛑 the ACTIVE SPOT IS NOT COUNTED — a full Bench is 5 and not 6", () => {
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
  it("🛑 S2 — none of the four ids is a registry row, so the registry summand cannot move", () => {
    const ids = registryCardIds();
    expect(ids).toHaveLength(708);
    for (const id of VICTINI_IDS) {
      expect(ids, id).not.toContain(id);
      expect(programFor(id), id).toBeUndefined();
    }
  });

  it("🛑 the SPLIT term stands still, and the branch is proven LIVE beside it", () => {
    // The printed attack is a SINGLE sentence, so nothing is stripped and
    // `splitHead` is untouched — the census claim, asserted rather than assumed.
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

  it("🛑 the control attack CANCELS too — the split does not smuggle the requirement away", () => {
    // Index 1 on the fixture. A split that ran BEFORE the requirement read would
    // hand the reader "Then, spin the wheel of fate.", find no row, and let 20
    // damage land on a board the clause cancels on.
    expect(attackOutcome(withBench(ready(4400), 2), 1).cancelled).toBe(true);
    const landed = attackOutcome(withBench(ready(4401), 5), 1);
    expect(landed.cancelled).toBe(false);
    expect(landed.kinds).toContain("DAMAGE_DEALT");
    // The companion is UNREAD by design, so the loud path is what reports it —
    // this is the accounting guard showing through, not a failure.
    expect(landed.kinds).toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 exactly ONE corpus sentence moved, and it is worth exactly FOUR units", () => {
    // The raw summand's delta, derived from the corpus rather than announced. Any
    // other sentence starting to resolve in the same commit reddens here.
    const nowCarried = corpus().filter(
      ([, s]) => SKELETON.test(s.trim()) && deriveAttackRequirement(s) !== null,
    );
    expect(nowCarried).toHaveLength(8); // 🆕🆕 D378 +1 — the Stadium-PRESENCE row. // 🆕🆕 D377 +1 — the "isn't Burned" row.
    const victini = nowCarried.filter(([, s]) => s === V_FORCE);
    expect(units(victini)).toBe(4);
    // 🆕🆕 D377 — a `- 1` term, so D365's head is still RE-DERIVED from the live
    // total rather than frozen at the head that measured it.
    // 🆕🆕 D378 — a `- 2` term beside it: the Stadium-PRESENCE row is worth TWO
    // printings, so the two subtrahends differ and the head is still D365's 9.
    expect(units(nowCarried) - units(victini) - 2 - 1).toBe(9); // D365's head, unmoved.
  });
});

describe("§6 — the exhaustive readers, and the guard D365 keyed on the wrong population", () => {
  it("🛑 BOTH `switch (cond.kind)` readers gained an arm, and both answer", () => {
    // The consumer set is TWO (D280 measured it), and unlike D365 this slice owes
    // both of them — which is the difference between a row that reuses vocabulary
    // and one that buys it. Driven rather than asserted about the arms.
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

  it("🛑 the table's FIRST apostrophe-free key — and that is what D365's completeness guard got wrong", () => {
    // D365 repaired a stale hand-written list with a guard that re-derives the
    // table's reachable size FROM THE LIVE READER. The repair was right and its
    // POPULATION was wrong: it counted every carried sentence, not every carried
    // sentence THE FOLD IS ABOUT. This row is the first that separates the two.
    expect(V_FORCE).not.toContain("'");
    expect(deriveAttackRequirement(V_FORCE)).not.toBeNull();
    // Six of the seven rows carry an apostrophe; five of THOSE are reachable from
    // the legal corpus (Palafin's is `legal_standard = 0`). The corpus now carries
    // SIX sentences and only FIVE of them belong to the fold's population.
    const carried = corpus()
      .filter(([, s]) => deriveAttackRequirement(s) !== null && SKELETON.test(s.trim()))
      .map(([, s]) => /^(If .+?, this attack does nothing\.)/.exec(s.trim())?.[1] ?? s.trim());
    // 🆕🆕 D377 — 6 -> 7 and the apostrophe half 5 -> 6: the new key spells BOTH
    // "opponent's" and "isn't", so it lands squarely in the fold's population and
    // the apostrophe-FREE half stands still at Victini alone.
    // 🆕🆕 D378 — 7 -> 8 and the apostrophe half STANDS STILL at 6, so the
    // apostrophe-FREE half is 2 for the first time: *"If there is no Stadium in
    // play"* carries neither an apostrophe nor a é, which is the SECOND such key in
    // this table and the exact case D365's guard could not see. **THE POPULATION
    // DISTINCTION THIS RUNG EXISTS FOR IS NOW MADE BY TWO ROWS RATHER THAN ONE.**
    expect(carried).toHaveLength(8);
    expect(carried.filter((s) => s.includes("'"))).toHaveLength(6);
    expect(carried.filter((s) => !s.includes("'"))).toHaveLength(2);
    // A guard that had not learned the difference would demand this sentence be
    // listed among the apostrophe rows, which would be a false claim about it.
    // 🆕🆕 D378 — the apostrophe-free set is NAMED rather than counted, and it is now
    // TWO. Sorted, so the assertion does not depend on corpus order.
    expect(carried.filter((s) => !s.includes("'")).sort()).toEqual(
      [V_FORCE, "If there is no Stadium in play, this attack does nothing."].sort(),
    );
  });
});
