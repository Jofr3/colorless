import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
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

// 0.307.0 → 0.308.0 — 🆕🆕 D403: THE ADDITIVE HALF OF D402's FAMILY.
//
// "You may discard up to N [Basic] Energy from your Benched Pokémon. This attack does
//  P more damage for each card you discarded in this way." — 2 sentences / 8 legal
// printings, read by `deriveAttackDiscardScaledBoost` (the ELEVENTH reader) and
// assembled by `discardScaledBoostProgram(reading, base)` into the SAME two ops D402
// derives, with two differences: the discard's zone is the Bench alone, and the
// damage carries the printed BASE.
//
// 🛑 WHAT THIS SLICE IS ABOUT IS A MECHANISM, NOT A SENTENCE. D402 refused this half
// because `damageDefender {per, count}`'s hit is a SEPARATE `snipeActive` pass: a KEPT
// base would be dealt in the pre-program pipeline and the scaled part inside the
// program, and Resistance, `damageReductionAfterWR` and the §8.1 survival clamp are
// each paid ONCE PER HIT. §5 drives exactly that on a −30 body, which is the ONLY
// board where the two readings differ — Weakness DISTRIBUTES over a split hit and
// therefore cannot see the difference at all.

const attack = { type: "attack", seat: "p1", index: 0 } as const;

/** Every reader `censusAtHead.test.ts` sweeps with, so a sentence this file calls
    "unread" is unread by the WHOLE engine and not merely by the one reader it is
    about (D382's rule: a refusal claim that only asks its own producer is a claim
    about nothing). */
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
  // 🆕🆕 D419 — the TWELFTH reader (D417, `deriveAttackCancelRequirement`), which
  // this list never had.
  // ⚠️ SPLICED MID-LIST RATHER THAN APPENDED: mutant `find` strings in
  // `scripts/mutation/mutants.ts` quote an array's LAST entries plus its closing
  // `];`, and appending moves that anchor without a character of it changing —
  // the adjacency class D418 paid for once on `stadiumPresence.test.ts`.
  deriveAttackCancelRequirement,
  // 🆕🆕 D428 — THE THIRTEENTH, the PRE-DAMAGE Tool discard. ⚠️ SPLICED BEFORE THE
  // LAST ENTRY RATHER THAN APPENDED, D419's rule: mutant `find` strings quote an
  // array's LAST entries plus its closing bracket, and appending moves that anchor
  // without a character of it changing.
  deriveAttackPreDamage,
  deriveAttackDiscardScaledBoost,
];

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

/** The TWO printed sentences this reader takes, transcribed from `legalAttackCorpus()`
    byte for byte. §1 asserts each one is really in the column at the printing count
    quoted beside it — the attribution control without which a paraphrase would pass
    every rung below it (D183). */
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

/** 🆕🆕🆕 D490 — the THIRD printed head of this reader, `censusAttackCorpus.ts` FILE
    LINE 130 at **2 legal printings**, and the row this file held as REFUSED from D403 to
    D489. Asserted to be a corpus row below rather than trusted as typed (D452/D456). */
const MILL =
  "Discard the top card of each player's deck. This attack does 140 more damage for each Energy card discarded in this way.";

/** The reading, THROWN rather than asserted non-null: a `!` would be a lint error and,
    worse, would turn a reader that stopped reading into a `null` handed to a builder
    whose failure message names neither. This says which sentence went unread. */
function reading(text: string): AttackDiscardScaledBoost {
  const read = deriveAttackDiscardScaledBoost(text);
  if (read === null) throw new Error(`unread by deriveAttackDiscardScaledBoost: ${text}`);
  return read;
}

describe("D403 §1 — the family this reader takes, measured live over the column", () => {
  it("🆕🆕 D419 — the hand-kept READERS list IS the module's reader surface", () => {
    // 🛑 THE GUARD THIS FILE NEVER HAD, IN D417's SHAPE AND D418's WORDING. This
    // copy was hand-kept and NOTHING compared it to what `effects.ts` exports, so
    // it could sit short of the module indefinitely — which is precisely the state
    // `censusAtHead.test.ts` was in before D417 and thirty more files were in after
    // D418. A guard in another file guards that file's copy alone.
    //
    // ⚠️ AND THE FIGURES NO LONGER COME OFF THIS LIST AT ALL. Resolution below is
    // computed through `resolvedByAnyReader` IMPORTED from `censusAttackCorpus.ts`,
    // off the MODULE surface, so no edit here can move a census number again. What
    // survives is a DECLARED EXPECTATION, and this rung is its only remaining job.
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    // ⚠️ THE COUNT IS PINNED SEPARATELY FROM THE DIFF ABOVE, and the separation is
    // load-bearing: a diff alone stays GREEN when a slice deletes a reader from the
    // module and from this list in the SAME commit, and the figures would then move
    // with nothing naming the cause.
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("the two printed sentences are really in the column, at 6 and 2 printings", () => {
    const rows = legalAttackCorpus();
    for (const [n, text] of TAKEN) {
      expect(rows.filter(([, s]) => s === text).map(([c]) => c), text).toEqual([n]);
    }
    expect(units(TAKEN)).toBe(8);
  });

  it("🛑 this reader takes EXACTLY those THREE, and no other reader takes any", () => {
    // 🆕🆕🆕 **D490 — 2 sentences / 8 printings → 3 / 10, AND THE THIRD IS THE ONE THE
    // RUNG BELOW USED TO HOLD AS REFUSED.** Re-pointed by MEMBER rather than decremented
    // (D418/D488): a bare `toHaveLength(3)` would stay green under a build that claimed
    // some *other* third sentence, so the partition is asserted by `kind` — the two
    // bench-discard heads and the one two-deck mill — which reddens the day either arm
    // eats the other's printing.
    const claimed = legalAttackCorpus().filter(
      ([, s]) => deriveAttackDiscardScaledBoost(s) !== null,
    );
    expect(claimed).toHaveLength(3);
    expect(units(claimed)).toBe(10);
    expect([...claimed].sort()).toEqual([...TAKEN, [2, MILL] as const].sort());
    expect(
      claimed.map(([, s]) => reading(s).kind).sort(),
    ).toEqual(["benchDiscard", "benchDiscard", "eachDeckMill"]);
    // …and the other ELEVEN refuse both, which is what makes "at most one reader fires
    // per attack" a structural property rather than a rule attack.ts has to keep.
    for (const [, s] of TAKEN) {
      for (const read of READERS) {
        if (read === deriveAttackDiscardScaledBoost) continue;
        expect(read(s), `${read.name} :: ${s}`).toBeNull();
      }
    }
  });

  it("🛑 `from your Benched Pokémon` occurs in the WHOLE column on these two only", () => {
    // The zone is spelled as a LITERAL rather than captured, and this is the
    // measurement behind that choice: D402's anchor reads `(this|your) Pokémon` as a
    // free parameter because the multiply family prints BOTH values, and the additive
    // family prints exactly one. Named as exactly-two rather than left unsaid (D400).
    const bench = legalAttackCorpus().filter(([, s]) => s.includes("from your Benched Pokémon"));
    expect(bench).toHaveLength(2);
    expect(units(bench)).toBe(8);
    expect([...bench].sort()).toEqual([...TAKEN].sort());
  });

  it("🆕🆕🆕 D490 — the additive half has NO sentence left refused, and THIS reader owns all three", () => {
    // 🛑 **THE OLD RUNG SAID THE OPPOSITE AND ITS STATED REASON WAS FALSE WHEN
    // WRITTEN.** It read: *"its record is cards off two DECKS rather than Energy off a
    // board, so it needs a recording mill this engine does not have. Refused by all
    // TWELVE readers"*. TWO of its three clauses were wrong by D490: the recording mill
    // shipped at **D488** (`discardDeckTop.recordAs`), so the engine HAD one for two
    // slices; and the surface had been THIRTEEN since D417, not twelve. What was
    // genuinely missing was the two-deck WALK (`whose: "eachPlayer"`) — one value on a
    // shipped field. The clause is corrected here rather than deleted, dated, and with
    // the measurement that falsified it (D442/D466).
    //
    // ⚠️ **RE-POINTED, NOT DELETED, AND THE NEW CLAIM KEEPS BOTH POLARITIES** (D438):
    // the population still says which sentences carry the additive marker, the OWNER is
    // named by function, and the OTHER TWELVE readers are still asserted to refuse all
    // three — which is the half a bare `.not.toBeNull()` would have discarded.
    const additive = legalAttackCorpus().filter(
      ([, s]) => s.includes("discarded in this way") && s.includes("more damage for each"),
    );
    expect(additive).toHaveLength(3);
    expect(units(additive)).toBe(10);
    // NOTHING is left refused, and the count is asserted as a POPULATION rather than as
    // a specimen (D423) so the day a fourth additive sentence is printed and unread this
    // rung names it instead of quietly staying at zero.
    const left = additive.filter(([, s]) => deriveAttackDiscardScaledBoost(s) === null);
    expect(left).toEqual([]);
    for (const [, s] of additive) {
      expect(resolvedByAnyReader(s), s).toBe(true);
      // 🆕🆕 D419 — asserted off the MODULE first. The loop below names WHICH reader
      // answered and is kept for that; it can only walk the readers this file lists,
      // which is the failure mode D418 measured in 38 files.
      for (const read of READERS) {
        if (read === deriveAttackDiscardScaledBoost) {
          expect(read(s), `${read.name} :: ${s}`).not.toBeNull();
        } else {
          expect(read(s), `${read.name} :: ${s}`).toBeNull();
        }
      }
    }
  });

  it("🆕🆕🆕 D490 — the mill sentence is a REAL corpus row at 2 printings, byte for byte", () => {
    // D452/D456: a refusal or a claim pinned on a HAND-RETYPED string is green by
    // construction. The specimen is asserted to be a row of the committed corpus and its
    // PRINTING COUNT is read off the corpus too — which is what tells a file-line
    // citation from an array index in one look (D448).
    const rows = legalAttackCorpus().filter(([, s]) => s === MILL);
    expect(rows.map(([n]) => n)).toEqual([2]);
    // The apostrophe is U+0027, MEASURED with `codePointAt` rather than by eye (D421,
    // D440). The whole 640-row column carries zero U+2019, so the anchor's `['’]` arm is
    // latent by design and `clauseApostrophe.test.ts`'s re-ingest sweep is what drives it.
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
    // 🆕🆕🆕 D490 — the SECOND member, beside its siblings so the discriminator is
    // visible as a partition rather than as a field one arm happens to carry. It has no
    // `cap` and no `filter` at all: the mill is mandatory and unfiltered, and the printed
    // noun narrows the COUNT, not the movement.
    expect(deriveAttackDiscardScaledBoost(MILL)).toEqual({ kind: "eachDeckMill", per: 140 });
  });

  it("🛑 the assembler folds the PRINTED BASE into the ONE damage op", () => {
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
    // An ABSENT `base` already means something specific on this op: the multiply
    // family's DROPPED base. A builder that omitted it at 0 would give one reading two
    // program shapes for no behavioural difference, and would make the op's own
    // doc's distinction unreadable off a built program.
    const [, hit] = discardScaledBoostProgram(reading(BARE), 0);
    expect(hit).toEqual({ op: "damageDefender", base: 0, per: 60, count: "discarded" });
    expect(Object.keys(hit ?? {}).includes("base")).toBe(true);
  });

  it("🛑 `deriveAttackEffect` refuses BOTH — the two producers are disjoint", () => {
    // D402's anchor ends its damage clause at `does (\d+) damage for each` and its
    // zone at `from (this|your) Pokémon`, so it refuses these sentences on TWO bytes.
    // If it ever claimed one, `attack.ts` would append this program on top of that
    // one and the attack would hit twice.
    for (const [, s] of TAKEN) expect(deriveAttackEffect(s), s).toBeNull();
  });
});

describe("D403 §3 — the refusals, each pinned on ONE printed byte", () => {
  it("🛑 the FOLD, the ZONE and the OFFER each refuse INDEPENDENTLY", () => {
    // D399's rule: a near-miss the anchor already refuses for another reason proves
    // nothing about the byte you meant to test. THE POSITIVE CONTROL FIRST.
    expect(deriveAttackDiscardScaledBoost(BARE)).not.toBeNull();
    // …the FOLD alone: the printed "more" taken out. That is D402's sentence shape,
    // and this reader must not claim it — both producers would then build a program.
    expect(
      deriveAttackDiscardScaledBoost(
        "You may discard up to 2 Energy from your Benched Pokémon. This attack does 60 damage for each card you discarded in this way.",
      ),
    ).toBeNull();
    // …the ZONE alone: "Benched" taken out. The whole own side is D402's `yours`, and
    // reading it here would offer the Energy that paid for the attack.
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
    // No additive printing carries a brace code or a written-out type, so admitting
    // them would be authoring cards (D361's refused matrix). The two spellings the
    // column prints are the two this reader reads, and nothing else.
    for (const text of [
      "You may discard up to 2 {W} Energy from your Benched Pokémon. This attack does 60 more damage for each card you discarded in this way.",
      "You may discard up to 2 Water Energy from your Benched Pokémon. This attack does 60 more damage for each card you discarded in this way.",
      "You may discard up to 2 Special Energy from your Benched Pokémon. This attack does 60 more damage for each card you discarded in this way.",
    ]) {
      expect(deriveAttackDiscardScaledBoost(text), text).toBeNull();
    }
  });

  it("a printed 0 in EITHER number stays loud — no silent no-op", () => {
    // Two captured numbers, two positivity guards, asserted apart (D361: a row count
    // is not a coverage map). A "up to 0" is a park with no pick; a 0 per-card is a
    // clause that buys nothing however much comes off. Both belong on the loud
    // `ATTACK_EFFECT_SKIPPED` path.
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
      // The capital, and the tail's own capital — D246's rule, this file's version.
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
  it("🛑 the ACTIVE's Energy is NOT offered — this is what `yourBench` buys", () => {
    // `from: "yours"` would offer all three: the Energy that PAID for this attack sits
    // on the Active, and a cost is not spent, so the whole-board member would let the
    // card fund its own boost with the Energy it just attacked with. The printed
    // sentence says "your Benched Pokémon", and this is the board that can tell them
    // apart — the ONE reason the union grew a fourth own-board member.
    // THREE on the Bench and one on the Active, deliberately: three candidates against
    // a printed ceiling of two is what makes the `cap` OBSERVABLE — an uncapped offer
    // reads `max: 3` on this board and `max: 2` on a two-Energy one, so a two-Energy
    // board would have been green under a dropped cap.
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
      // ONE row, never two — the whole claim, read off the event log.
      expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(1);
    }
  });

  it("🛑 THE DISCRIMINATOR: a −30 RESISTANCE is paid ONCE, so two discards deal 140", () => {
    // The rung this whole slice exists for. `fix-psychic-resist-big` prints −30 against
    // Psychic and `fix-benchboost` is a Psychic attacker, so:
    //
    //   ONE pass (this build)  : (50 + 120) − 30 = 140
    //   TWO passes (D402's refusal, built anyway): (50 − 30) + (120 − 30) = 110
    //   base DROPPED           : 120 − 30 = 90
    //   base NOT suppressed    : (50 − 30) + (50 + 120 − 30) = 160
    //
    // Four numbers on one board, and only the first is right. ⚠️ WEAKNESS CANNOT TEST
    // THIS AT ALL: a ×2 DISTRIBUTES over a split hit, so both readings return the same
    // number — which is why the pool's −30 body is the instrument and no ×2 rung is
    // written here. A subtraction is what separates one hit from two.
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
    // The decline arm, and it is arithmetic rather than an `otherwise`: N = 0 makes the
    // one op deal `base + P × 0`, so `50 − 30 = 20`. D381's two gates each needed an
    // explicit second arm carrying the printed base; this reading needs none, and that
    // is the cheapest possible answer to D135's rule.
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

  it("🛑 neither half of `ATTACK_EFFECT_SKIPPED` fires, on BOTH printed sentences", () => {
    // The reading owns the printed EFFECT and the printed "+" marker, so both
    // `*Simulated` terms `attack.ts` gained are load-bearing.
    //
    // 🛑 **THE ROW IS EMITTED BY THE `attack` ACTION, NOT BY THE `resolveEffect` THAT
    // FOLLOWS IT, AND THE FIRST DRAFT OF THIS FILE ASSERTED IT ON THE WRONG ONE.** The
    // §5 rung below used to carry `not.toContain("ATTACK_EFFECT_SKIPPED")` over the
    // RESOLVE step's events — where the row can never appear, because the attack has
    // already been declared — so it was green under both mutants and the D403 probe
    // reported them as GAPs. `mustApply(state, attack)` is the only place this can be
    // read, and a park splits the two event lists in a way that makes the mistake
    // invisible to every other assertion in the file.
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
