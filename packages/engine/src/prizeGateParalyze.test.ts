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
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import { applyAction, conditionHolds, conditionNote, engineVersion } from "./index";
import type { BoardCondition, EffectOp, GameEvent, GameOverReason, GameState } from "./index";
import { programFor, registryCardIds } from "./registry";
import {
  DEFENDER_STATUS_TRIPLE_DECK,
  attachFromDeck,
  clearBench,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setPrizes,
} from "./testFixtures";

// 0.403.0 → 0.404.0 — 🆕🆕 D517: THE PRIZE-GATED PARALYSIS, AND THE FIRST
// `BoardCondition` THAT READS **YOUR OWN** PRIZE COUNT.
//
// *"If you have exactly 1 Prize card remaining, your opponent's Active Pokémon is now
// Paralyzed."* — `censusAttackCorpus.ts` **FILE LINE 342**, **1 sentence / 1 legal
// printing**, claimed WHOLE by `deriveAttackEffect` arm 6a-iii through ONE new anchor
// (`SELF_PRIZE_GATE_PARALYZE`) and ONE new `BoardCondition` member
// (`yourPrizesRemaining`, the **61st**), deriving
// `[{op:"conditionGate", cond:{kind:"yourPrizesRemaining", counts:[1]},
//   then:[{op:"applyStatus", target:"defender", status:"paralyzed"}]}]`.
//
// 🛑 **THE CONSEQUENT WAS ALREADY BUILT AND THE GATE WAS THE WHOLE OF WHAT WAS
// MISSING — MEASURED AT THE PRE-SLICE HEAD RATHER THAN INFERRED.** The bare
// *"Your opponent's Active Pokémon is now Paralyzed."* has resolved through THIS VERY
// READER to THIS VERY `applyStatus` op since 0.x; the gated row resolved through no
// reader, no registry row, no gate split and no trailing split. §2 drives both halves
// side by side, which is what makes "the gate was the blocker" a measurement.
// ⚠️ **AND THE CONSEQUENT IS A READER FACT RATHER THAN A PRINTING FACT** — it is printed
// STANDALONE on ZERO legal attacks and reaches the column only as a compound's TAIL, which
// §1 asserts. The first draft of that rung claimed 21 printings for it and the corpus said
// `undefined`: a number nobody measured, in a file whose whole subject is measurement.
//
// 🛑 **AND `splitAttackGateClause` WAS NEVER LIVE ON THIS ROW, WHICH A PRE-SLICE BRIEF
// HAD BACKWARDS.** A leading `If …,` clause is NOT what that splitter reads: its
// vocabulary is a CLOSED FOUR-ENTRY list of printed TIMING clauses matched whole and
// terminated by `. ` (*"If you go second, you can't use this attack during your first
// turn."* and its three siblings). This row's leading clause is in neither the list nor
// the shape, so the splitter answers `null` **by construction** — asserted in §5 across
// all sixteen cells of the lattice rather than once on the printed string. The row
// therefore lands on the **READER** arm, which is also the arm all three of its BUILT
// prize siblings land on: corpus `:343` and `:353` through `deriveAttackDamageBonus`,
// `:350` through `deriveAttackRequirement`. Zero of the four are gate-arm builds.
// 🆕🆕🆕 **D545 — *"a CLOSED FOUR-ENTRY list of printed TIMING clauses"* IS WITHDRAWN
// as a present-tense claim.** The list was already five entries at D541, and D545 put two
// leading `If …,` COST clauses on it (rows 6 and 7 of `ATTACK_GATE_CLAUSES`:
// `alternateCostIf` for corpus `:316`, `costWaivedIf` for `:324`), so a leading `If …,`
// clause of another kind CAN reach the splitter now, when its whole printed text is a row.
// This row's verdict is unmoved: its leading clause is not a row, so §5's sixteen `null`s
// still hold and it is still a READER build.
//
// 🛑 **A FIFTH NAME FOR A FOURTH READING OF ONE PILE, AND IT IS THE HOUSE IDIOM RATHER
// THAN A SLIP.** `registry.ts`'s D207 block says outright *"TWO SPELLINGS EXIST AND
// THEY ARE NOT THE SAME NUMBER"*, and at this head four readings ship:
// `BoardCondition.opponentPrizesRemaining` (the opponent's REMAINING),
// `DamageCountSource.opponentPrizesTaken` (`6 − remaining`),
// `MaxHpScale.opponentPrizesTaken` (the same number in a third union) and
// `HandRefreshDraw.prizeCount` (the AFFECTED PLAYER's remaining — which under
// `who: "you"` is **exactly the number this row needs**). Embedding that last one was
// priced and refused for D516's reason, re-derived here rather than cited: **what D159
// makes single is the WALK, never the union.** This member's walk is `conditionHolds`,
// the ONE evaluator behind all three `BoardCondition` consumers; `handRefreshDrawCount`
// is a different walk taking a DEALT-TO seat and answering a DRAW COUNT. §7 asserts the
// relation. `AttackFlipCount` and `MaxHpScale` both re-spell a shipped member under
// exactly that argument, in writing.
//
// ⚠️ **AND THE SEAT IS A MEMBER RATHER THAN A FIELD, WHICH IS MEASURED OFF THE UNION
// AND NOT ASSERTED.** `BoardCondition` already spells SIX seat mirrors as separate
// members and carries ZERO seat FIELDS (§6 walks `conditionNote` for the pairs). Adding
// `seat` to `opponentPrizesRemaining` would also be a RENAME with live consumers — two
// `registry.ts` authorings, three `CONDITIONAL_DAMAGE_CLAUSES` rows and the
// `refusedPrintings.ts` row that cites it by name — which D362 records as the opposite
// of a free widening.
//
// 🛑 **THE REFUSAL THAT ORDERED THIS SLICE WAS WRITTEN AT D119, NAMED `yourPrizesRemaining`
// BY THAT EXACT NAME, AND STAYED GREEN WHEN IT LANDED.** `publicCount.test.ts`'s Slaking V
// rung ended *"It would want a `yourPrizesRemaining` sibling; nothing here claims it, so it
// stays loud"* — `48f38c0c`, 2026-08-01, **398 decisions** before this slice. D473 aged 42
// and D479 aged 37. 🛑 **AND BUILDING THE MEMBER DID NOT REDDEN IT**: that sentence is an
// ABILITY attack lock and is still refused, so a pass chasing only the rungs that went red
// would have left it GREEN AND WRONG — D516's rule (4) paying out on its first outing, and
// the rung was found by GREPPING THE REFUSAL'S NOUN over the test column rather than by the
// suite. It is RE-POINTED there, not deleted (D444).
//
// ⚠️ **THE CARRIER IS UNRESOLVED AND SAID SO (D425).** This checkout has no D1, so the
// card printing this sentence cannot be named and is not invented. The STRING and the
// PRINTING COUNT are transcription, asserted off `legalAttackCorpus()` in §1; the body
// is `fix-oxford`, a shipped synthetic fixture re-texted on a per-board `cardPool`
// clone (D414) — **ZERO new `FIXTURE_POOL` ids and ZERO new decks.**

/** Corpus FILE LINE 342, byte for byte. */
const PRINTED =
  "If you have exactly 1 Prize card remaining, your opponent's Active Pokémon is now Paralyzed.";

/** The CONSEQUENT alone — the control that separates *"the gate was missing"* from
    *"the status was missing"*. ⚠️ **NOT a row of the legal attack column**: it is printed
    standalone on ZERO legal attacks and reaches the column only as the TAIL of a compound
    (D409's trailing splitter). §1 asserts that rather than a printing count — the first
    draft of this file claimed one, and the corpus refuted it. */
const BARE = "Your opponent's Active Pokémon is now Paralyzed.";

/** The three BUILT prize siblings, by corpus file line. Read for their PROGRAMS rather
    than their verdicts (D514), because which ARM claims a sibling is what prices a row. */
const SIB_MORE = "If you have more Prize cards remaining than your opponent, this attack does 90 more damage."; // :343
const SIB_NOT_34 = "If your opponent doesn't have exactly 3 or 4 Prize cards remaining, this attack does nothing."; // :350
const SIB_4_FEWER = "If your opponent has 4 or fewer Prize cards remaining, this attack does 70 more damage."; // :353

/** Corpus FILE LINE 346 — the row that shares this row's GATE and is deliberately NOT
    built here. See §8, which drives the refusal rather than asserting it.
    (🆕🆕🆕 D575 (D539): ~~"drives the refusal"~~ WITHDRAWN — D575 BUILT the row (N's Sigilyph
    `sv09-064` "Victory Symbol", the `winGame` op); §8 now pins the derived program.) */
const WIN_ROW =
  "If you use this attack when you have exactly 1 Prize card remaining, you win this game.";

/** THE PROGRAM, spelled once so a case cannot pass against a hand-copied literal. */
const PROGRAM: EffectOp[] = [
  {
    op: "conditionGate",
    cond: { kind: "yourPrizesRemaining", counts: [1] },
    // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
    then: [{ op: "applyStatus", target: "defender", status: "paralyzed" }],
  },
];

const READERS = [
  deriveAttackEffect,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackBonusConsequent,
  deriveAttackOptionalCostBoost,
  deriveAttackCancelRequirement,
  deriveAttackPreDamage,
  // 🆕🆕🆕 D573 — THE FOURTEENTH, the copy-attack reader. Spliced before the last entry (D419).
  deriveAttackCopy,
  deriveAttackDiscardScaledBoost,
];

const SEED = 11;

function board(seed = SEED): GameState {
  let state = must(
    applyAction(
      driveSetup(
        seed,
        { p1: DEFENDER_STATUS_TRIPLE_DECK, p2: DEFENDER_STATUS_TRIPLE_DECK },
        { first: "p2" },
      ),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", "fix-oxford");
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", "fix-energy", 2);
  // 340 HP, NO attacks, no Weakness or Resistance — nothing this suite drives can Knock
  // it Out, so a status can never be lost to a §8.1 tail and no Prize can move on its own.
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = clearBench(state, "p2");
  return state;
}

/** Re-text `fix-oxford`'s attack `index` on THIS board's `cardPool` copy.
    ⚠️ **NOT A FIXTURE EDIT** — `FIXTURE_POOL` is shared by sixteen suites and D412
    reddened three boards by widening a shared one. */
function withEffect(state: GameState, effect: string, index = 1): GameState {
  const card = state.cardPool["fix-oxford"];
  if (card === undefined) throw new Error("no fix-oxford in pool");
  const attacks = [...(card.attacks ?? [])];
  const at = attacks[index];
  if (at === undefined) throw new Error(`fix-oxford has no attack ${index}`);
  attacks[index] = { ...at, effect };
  return { ...state, cardPool: { ...state.cardPool, "fix-oxford": { ...card, attacks } } };
}

/** Index 1 is "Bare Bloom" — {C}, and **no `damage` key at all** — so no §8.5 hit lands
    beside the status and every observation here is the gate's. */
const INDEX = 1;

function swing(state: GameState) {
  return mustApply(state, { type: "attack", seat: "p1", index: INDEX });
}

function defenderParalyzed(state: GameState): boolean {
  const active = state.players.p2.active;
  if (active === null) throw new Error("no defender");
  return active.conditions.rotation === "paralyzed";
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, measured live over the legal column.
// ─────────────────────────────────────────────────────────────────────────────

describe("D517 §1 — the printed data, measured live over the legal column", () => {
  it("🛑 the sentence is the CORPUS's bytes at ONE printing, and so are its four relatives", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n] as const));
    expect(rows.get(PRINTED)).toBe(1);
    expect(rows.get(WIN_ROW)).toBe(1);
    expect(rows.get(SIB_MORE)).toBe(2);
    expect(rows.get(SIB_NOT_34)).toBe(1);
    expect(rows.get(SIB_4_FEWER)).toBe(2);
    // 🛑 **THE CONSEQUENT IS NOT A ROW OF THIS COLUMN AT ALL, AND THE FIRST DRAFT OF
    //    THIS RUNG ASSERTED THAT IT WAS.** *"Your opponent's Active Pokémon is now
    //    Paralyzed."* is printed STANDALONE on ZERO legal attacks — it reaches the column
    //    only as the TAIL of a compound, which D409's trailing splitter hands to the very
    //    reader this slice's new arm reuses. So the pricing claim is about the READER
    //    rather than about a printing, and it is stated that way rather than rounded up.
    expect(rows.get(BARE)).toBeUndefined();
    expect(deriveAttackEffect(BARE)).not.toBeNull();
    expect(
      splitAttackTrailingClause(
        "Discard all Energy from this Pokémon. Your opponent's Active Pokémon is now Paralyzed.",
      ),
    ).toEqual({
      head: "Discard all Energy from this Pokémon.",
      tail: BARE,
    });
  });

  it("the APOSTROPHE is ASCII, and the anchor would silently miss a typographic one", () => {
    expect(PRINTED.includes("opponent's")).toBe(true);
    expect(PRINTED.includes("opponent’s")).toBe(false);
    expect(PRINTED.codePointAt(PRINTED.indexOf("'"))).toBe(0x0027);
    // …and the anchor carries `['’]` from its first draft (D136/D137), so a
    // punctuation-normalising re-ingest cannot un-build the row.
    expect(deriveAttackEffect(PRINTED.replace("opponent's", "opponent’s"))).toEqual(PROGRAM);
  });

  it("🛑 the column's PRIZE-CLAUSE family is FIVE rows, and this one is the LAST unbuilt half", () => {
    // D435 — not incrementing is also a measurement. Every legal attack sentence whose
    // text mentions a Prize COUNT clause, enumerated rather than summarised (D428).
    const family = legalAttackCorpus().filter(
      ([, s]) => s.includes("Prize card remaining") || s.includes("Prize cards remaining"),
    );
    expect(family.map(([, s]) => s).sort()).toEqual(
      [PRINTED, WIN_ROW, SIB_MORE, SIB_NOT_34, SIB_4_FEWER].sort(),
    );
    expect(units(family)).toBe(7);
    // Four of the five are now built; `WIN_ROW` is the one that is not, and §8 says why.
    // 🆕🆕🆕 D575 (D539): ~~"`WIN_ROW` is the one that is not"~~ — it IS built now (N's Sigilyph
    // "Victory Symbol", the `winGame` op behind this member at `[1]`), so the family is CLOSED.
    const unbuilt = family.filter(([, s]) => !resolvedByAnyReader(s));
    expect(unbuilt.map(([, s]) => s)).toEqual([]);
  });

  it("🆕🆕 D517 — the sentence is now RESOLVED, and by exactly one reader", () => {
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
    for (const read of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(PRINTED), read.name).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the program, and WHICH ARM claims each sibling (D514).
// ─────────────────────────────────────────────────────────────────────────────

describe("D517 §2 — the program, read against the consequent and against the siblings", () => {
  it("🛑 the GATE was the whole blocker: the CONSEQUENT's own program is this gate's `then`", () => {
    // The measurement that prices the slice. The bare sentence derives an `applyStatus`;
    // the gated sentence derives THAT LIST, unchanged, inside a `conditionGate`. So the
    // payload is not new vocabulary — it is `deriveAttackEffect`'s own output reused.
    const bare = deriveAttackEffect(BARE);
    expect(bare).toEqual([{ op: "applyStatus", target: "defender", status: "paralyzed" }]);
    const mine = deriveAttackEffect(PRINTED);
    expect(mine).toHaveLength(1);
    const gate = mine?.[0];
    expect(gate?.op).toBe("conditionGate");
    expect(gate !== undefined && gate.op === "conditionGate" ? gate.then : null).toEqual(bare);
  });

  it("no `otherwise` arm, and the key is ABSENT rather than `undefined`-valued", () => {
    // The printed sentence has no second consequent. A JSON record is what a successor
    // diffs, so the shape must be minimal rather than merely equivalent.
    expect(Object.keys(deriveAttackEffect(PRINTED)?.[0] ?? {}).sort()).toEqual([
      "cond",
      "op",
      "then",
    ]);
  });

  it("🛑 ALL THREE BUILT SIBLINGS ARE READER-ARM BUILDS, AND SO IS THIS ROW", () => {
    // D514's rule and the correction of a pre-slice brief that priced this row as a
    // GATE-arm build. The four-way subtraction asked per sentence, not the totals.
    const armOf = (text: string): string => {
      if (resolvedByAnyReader(text)) return "reader";
      const g = splitAttackGateClause(text);
      // 🆕 D529 — widened with the census: a clause-only split (`body: ""`) is the gate arm.
      if (g !== null && (g.body === "" || resolvedByAnyReader(g.body))) return "gate";
      return splitAttackTrailingClause(text) !== null ? "trailing" : "none";
    };
    expect(armOf(PRINTED)).toBe("reader");
    expect(armOf(SIB_MORE)).toBe("reader");
    expect(armOf(SIB_NOT_34)).toBe("reader");
    expect(armOf(SIB_4_FEWER)).toBe("reader");
    // …and their PROGRAMS, not merely their verdicts: two different readers and two
    // different carriers for one printed noun phrase.
    expect(deriveAttackDamageBonus(SIB_MORE)).toEqual({
      per: 90,
      count: { kind: "boardCondition", cond: { kind: "morePrizesThanOpponent" } },
    });
    expect(deriveAttackDamageBonus(SIB_4_FEWER)).toEqual({
      per: 70,
      count: {
        kind: "boardCondition",
        cond: { kind: "opponentPrizesRemaining", counts: [0, 1, 2, 3, 4] },
      },
    });
    expect(deriveAttackRequirement(SIB_NOT_34)).toEqual({
      kind: "opponentPrizesRemaining",
      counts: [3, 4],
    });
  });

  it("🛑 the union carries NO NEGATION, and `:350`'s *doesn't have* is folded by the READER", () => {
    // Checked before the shape was chosen. The printed clause is NEGATIVE
    // (*"doesn't have exactly 3 or 4 … this attack does nothing"*) and the stored
    // condition is POSITIVE (`counts: [3, 4]`) — the requirement skeleton owns the
    // negation, so a `not` member would have been a second way to spell one answer.
    const req = deriveAttackRequirement(SIB_NOT_34) as BoardCondition & { counts: number[] };
    expect(req.counts).toEqual([3, 4]);
    expect(JSON.stringify(req)).not.toContain("not");
    // And `:353`'s inequality is spelled the same way: as the SATISFYING SET — read off
    // the whole `count` rather than through a cast, so the shape is asserted too.
    expect(deriveAttackDamageBonus(SIB_4_FEWER)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentPrizesRemaining", counts: [0, 1, 2, 3, 4] },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the member, driven at every reachable count and against its twin.
// ─────────────────────────────────────────────────────────────────────────────

describe("D517 §3 — `yourPrizesRemaining` is `opponentPrizesRemaining` RE-SEATED, and nothing else", () => {
  it("🛑 the two members disagree exactly where the two SEATS disagree, over all 7×7 boards", () => {
    // §3.8 bounds a prize row at 0-6, so this is the WHOLE domain rather than a sample —
    // which is what makes `counts.includes(…)` behaviourally exact here (D367's argument,
    // re-run one seat over). 49 boards, both members, both seats.
    const mine: BoardCondition = { kind: "yourPrizesRemaining", counts: [1] };
    const theirs: BoardCondition = { kind: "opponentPrizesRemaining", counts: [1] };
    let disagreements = 0;
    for (let a = 0; a <= 6; a++) {
      for (let b = 0; b <= 6; b++) {
        let state = board();
        state = setPrizes(state, "p1", a);
        state = setPrizes(state, "p2", b);
        expect(conditionHolds(state, "p1", mine), `p1 ${a}/${b}`).toBe(a === 1);
        expect(conditionHolds(state, "p1", theirs), `p1' ${a}/${b}`).toBe(b === 1);
        // The mirror is symmetric: read from p2's chair the two swap operands.
        expect(conditionHolds(state, "p2", mine), `p2 ${a}/${b}`).toBe(b === 1);
        expect(conditionHolds(state, "p2", theirs), `p2' ${a}/${b}`).toBe(a === 1);
        if (conditionHolds(state, "p1", mine) !== conditionHolds(state, "p1", theirs)) {
          disagreements += 1;
        }
      }
    }
    // 🛑 THE SEAT IS OBSERVABLE, which is the only thing that makes a second member
    // necessary rather than decorative: on 12 of the 49 boards the two answer differently.
    expect(disagreements).toBe(12);
  });

  it("the `counts` LIST is set MEMBERSHIP and not a threshold, at the twin's own witness", () => {
    // `[2, 4]` is deliberately not "2 to 4" — D207's claim about the twin, asserted on
    // the mirror so the pair cannot drift apart on the one property their shape encodes.
    const gap: BoardCondition = { kind: "yourPrizesRemaining", counts: [2, 4] };
    const seen: boolean[] = [];
    for (let a = 0; a <= 6; a++) seen.push(conditionHolds(setPrizes(board(), "p1", a), "p1", gap));
    expect(seen).toEqual([false, false, true, false, true, false, false]);
  });

  it("🛑 `conditionNote` ROUND-TRIPS to the printed clause, and the plural agrees", () => {
    // D515's finding applied: a describer arm that is missing fails SILENTLY. This one
    // is compiler-required (the switch has no `default` and returns `string`), so the
    // check that earns its keep is the TEXT rather than the presence.
    expect(conditionNote({ kind: "yourPrizesRemaining", counts: [1] })).toBe(
      "you have exactly 1 Prize card remaining",
    );
    expect(PRINTED.startsWith(`If ${conditionNote({ kind: "yourPrizesRemaining", counts: [1] })},`)).toBe(
      true,
    );
    expect(conditionNote({ kind: "yourPrizesRemaining", counts: [2, 4] })).toBe(
      "you have exactly 2 or 4 Prize cards remaining",
    );
    // …and it differs from the twin's by exactly the SUBJECT, which is the claim the
    // pair makes about itself.
    expect(conditionNote({ kind: "opponentPrizesRemaining", counts: [1] })).toBe(
      "your opponent has exactly 1 Prize card remaining",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the board: the status lands at ONE prize and at no other count.
// ─────────────────────────────────────────────────────────────────────────────

describe("D517 §4 — the gate on a real board, at every count the rules can reach", () => {
  it("🛑 PARALYSIS lands at 1 Prize remaining and at NO other count, 0 through 6", () => {
    const landed: number[] = [];
    for (let n = 0; n <= 6; n++) {
      // 0 is reachable as a BOARD (the §14 check runs on the take, not on the count),
      // and it is the sharpest near miss of `counts: [1]` from below.
      const state = withEffect(setPrizes(board(), "p1", n), PRINTED);
      const { state: done } = swing(state);
      if (defenderParalyzed(done)) landed.push(n);
    }
    expect(landed).toEqual([1]);
  });

  it("🛑 the OPPONENT's count does not move the answer — the twin would read the other seat", () => {
    // The control that separates "this member works" from "this board paralyses".
    // P1 holds 1 Prize throughout; P2's row is swept across its whole domain.
    for (let n = 0; n <= 6; n++) {
      let state = setPrizes(board(), "p1", 1);
      state = setPrizes(state, "p2", n);
      const { state: done } = swing(withEffect(state, PRINTED));
      expect(defenderParalyzed(done), `foe ${n}`).toBe(true);
    }
    // …and with the seats exchanged the gate is shut at every one of the seven.
    for (let n = 0; n <= 6; n++) {
      let state = setPrizes(board(), "p1", 3);
      state = setPrizes(state, "p2", n);
      const { state: done } = swing(withEffect(state, PRINTED));
      expect(defenderParalyzed(done), `self3 foe ${n}`).toBe(false);
    }
  });

  it("the gate emits NO event of its own, and the shut arm is SILENT rather than loud", () => {
    // A `conditionGate` announces nothing: the condition is public, so unlike a coin
    // flip it tells the opponent nothing they cannot see. And a shut gate is not an
    // unread sentence — the row must NOT fall to `ATTACK_EFFECT_SKIPPED`.
    const shut = swing(withEffect(setPrizes(board(), "p1", 4), PRINTED));
    expect(all(shut.events, "STATUS_APPLIED")).toHaveLength(0);
    expect(all(shut.events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    const open = swing(withEffect(setPrizes(board(), "p1", 1), PRINTED));
    const applied = all(open.events, "STATUS_APPLIED");
    expect(applied).toHaveLength(1);
    expect(applied[0]?.status).toBe("paralyzed");
    expect(all(open.events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
  });

  it("🛑 the BARE consequent on the SAME board paralyses at EVERY count, which is the control", () => {
    // Without this rung "paralysis at 1" is indistinguishable from "paralysis whenever
    // this fixture attacks" (D399, read from the other side).
    for (let n = 0; n <= 6; n++) {
      const { state: done } = swing(withEffect(setPrizes(board(), "p1", n), BARE));
      expect(defenderParalyzed(done), `bare ${n}`).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the refusals, and the LATTICE that priced the slice.
// ─────────────────────────────────────────────────────────────────────────────

/** The 2⁴ lattice this slice was priced on: WRAP × SEAT × COUNT × CONSEQUENT, each axis
    flipped between two strings the catalog actually prints somewhere. */
const WRAP = ["If ", "If you use this attack when "] as const;
const SEAT = ["you have", "your opponent has"] as const;
const COUNT = ["exactly 1 Prize card remaining", "4 or fewer Prize cards remaining"] as const;
const CONS = [
  "your opponent's Active Pokémon is now Paralyzed.",
  "this attack does 90 more damage.",
] as const;

function cell(i: number): string {
  return `${WRAP[(i >> 3) & 1]}${SEAT[(i >> 2) & 1]} ${COUNT[(i >> 1) & 1]}, ${CONS[i & 1]}`;
}

function cellBuilds(text: string): boolean {
  if (resolvedByAnyReader(text)) return true;
  const g = splitAttackGateClause(text);
  // 🆕 D529 — widened with the census: a clause-only split (`body: ""`) is credited. No cell is one.
  if (g !== null && (g.body === "" || resolvedByAnyReader(g.body))) return true;
  return splitAttackTrailingClause(text) !== null;
}

describe("D517 §5 — the lattice, computed on BOTH predicates", () => {
  it("🛑 the SIXTEEN cells are SIXTEEN DISTINCT STRINGS, so no flip is a no-op", () => {
    expect(new Set(Array.from({ length: 16 }, (_, i) => cell(i))).size).toBe(16);
    expect(cell(0)).toBe(PRINTED);
    expect(cell(8)).toBe(
      "If you use this attack when you have exactly 1 Prize card remaining, your opponent's Active Pokémon is now Paralyzed.",
    );
  });

  it("🛑 THREE of SIXTEEN build, and the flips read CONS 3 · COUNT 1 · SEAT 3 · WRAP 3", () => {
    const vals = Array.from({ length: 16 }, (_, i) => cellBuilds(cell(i)));
    expect(vals.filter(Boolean)).toHaveLength(3);
    // The built set: the printed row itself, plus the two SEAT-mirrored damage rows that
    // sit together on the COUNT axis.
    expect(vals.map((v, i) => (v ? i : -1)).filter((i) => i >= 0)).toEqual([0, 5, 7]);
    const flips = [0, 1, 2, 3].map((bit) => {
      let n = 0;
      for (let i = 0; i < 16; i++) {
        const j = i ^ (1 << bit);
        if (i < j && vals[i] !== vals[j]) n += 1;
      }
      return n;
    });
    // CONS, COUNT, SEAT, WRAP — in bit order.
    expect(flips).toEqual([3, 1, 3, 3]);
  });

  it("🛑 THE GATE SPLITTER IS NULL AT 16 OF 16 — the two predicates AGREE EVERYWHERE", () => {
    // D503's rule run, and it answers NO here for a STRUCTURAL reason rather than by
    // luck: `splitAttackGateClause`'s vocabulary is a closed list of four printed TIMING
    // clauses, so a leading `If <board fact>,` can never be one. The pre-slice brief's
    // premise that "a leading `If …,` clause makes the gate splitter live" is FALSE, and
    // this is the rung that says so.
    // 🆕🆕🆕 D545 LANDING — *"a closed list of four printed TIMING clauses, so a leading
    // `If <board fact>,` can never be one"* is WITHDRAWN as a present-tense claim: the list
    // has SEVEN rows (4 at D517, 5 at D541, 7 at D545), and rows 6 and 7 are leading
    // `If <board fact>,` COST clauses (corpus `:316`, `:324`). What still makes this rung
    // structural is that the list is CLOSED and matched WHOLE: no lattice cell below is a row.
    for (let i = 0; i < 16; i++) {
      expect(splitAttackGateClause(cell(i)), cell(i)).toBeNull();
      expect(splitAttackTrailingClause(cell(i)), cell(i)).toBeNull();
    }
    // …and it is null on the sibling rows too, so "reader arm" is not an artefact of the
    // lattice's own vocabulary.
    for (const s of [PRINTED, BARE, WIN_ROW, SIB_MORE, SIB_NOT_34, SIB_4_FEWER]) {
      expect(splitAttackGateClause(s), s).toBeNull();
    }
  });

  it("the anchor is WHOLE-SENTENCE — a leading or trailing rider is refused", () => {
    expect(deriveAttackEffect(`Draw a card. ${PRINTED}`)).toBeNull();
    expect(deriveAttackEffect(`${PRINTED} Draw a card.`)).toBeNull();
    expect(deriveAttackEffect(PRINTED.replace(/\.$/, ""))).toBeNull();
    expect(deriveAttackEffect(PRINTED.replace("If ", "if "))).toBeNull();
  });

  it("🛑 the COUNT and the STATUS WORD are both spelled into the anchor, and both refuse", () => {
    // One printed sentence, one anchor (arm 6a/6a-ii's own call). The generality that
    // was refused — widening the clause slot to `(.+)` over `CONDITIONAL_DAMAGE_CLAUSES`
    // — is re-measured in §7 as buying ZERO printings.
    expect(
      deriveAttackEffect(
        "If you have exactly 2 Prize cards remaining, your opponent's Active Pokémon is now Paralyzed.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "If you have exactly 1 Prize card remaining, your opponent's Active Pokémon is now Confused.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "If your opponent has exactly 1 Prize card remaining, your opponent's Active Pokémon is now Paralyzed.",
      ),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the describer surfaces, checked rather than assumed (D515).
// ─────────────────────────────────────────────────────────────────────────────

describe("D517 §6 — the describer surfaces, and the union's seat idiom", () => {
  it("🛑 the op NEVER PARKS, so `describeBranch` never sees it and no caption is owed", () => {
    // D515's slice failed silently because a park's caption had no arm for its op. This
    // program cannot reach that surface at all: `conditionGate` is SPLICED by
    // `runProgram`'s queue loop and never stepped, and its only payload is `applyStatus`,
    // which resolves inline. Driven rather than argued — an attack that parked would
    // leave the phase in `effect:choose`.
    const { state: done } = swing(withEffect(setPrizes(board(), "p1", 1), PRINTED));
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(defenderParalyzed(done)).toBe(true);
  });

  it("🛑 `conditionNote` IS the only describer a `BoardCondition` has, and it is TOTAL", () => {
    // attack.ts's own doc block: `conditionNote` is *"the one place that knows what a
    // `BoardCondition` means"*. It has no `default`, so a member without an arm is a
    // COMPILE error rather than a silent blank — the opposite of D515's failure mode.
    expect(conditionNote({ kind: "yourPrizesRemaining", counts: [1] })).not.toBe("");
  });

  it("🛑 the union spells SIX seat MIRRORS as separate members and ZERO seat FIELDS", () => {
    // Measured off the live describer rather than read out of a doc block (D516's
    // rule: ask the type, and let a live derivation outrank an extraction).
    const PAIRS: readonly (readonly [BoardCondition, BoardCondition])[] = [
      [{ kind: "yourActiveDamaged" }, { kind: "opponentActiveDamaged" }],
      [
        { kind: "yourActiveHasEnergyAttached", energy: "special" },
        { kind: "opponentActiveHasEnergyAttached", energy: "special" },
      ],
      [{ kind: "yourActiveHasToolAttached" }, { kind: "opponentActiveHasToolAttached" }],
      [{ kind: "yourActivePoisoned" }, { kind: "opponentActivePoisoned" }],
      [
        { kind: "yourBenchAtLeast", count: 2 },
        { kind: "opponentBenchAtLeast", count: 2 },
      ],
      [{ kind: "yourStadiumInPlay" }, { kind: "stadiumInPlay" }],
    ];
    expect(PAIRS).toHaveLength(6);
    for (const [mine, theirs] of PAIRS) {
      expect(mine.kind).not.toBe(theirs.kind);
      expect(conditionNote(mine)).not.toBe(conditionNote(theirs));
      // …and neither carries a `seat` key, which is the half that makes the idiom a
      // claim about the union rather than about naming.
      expect(Object.keys(mine)).not.toContain("seat");
      expect(Object.keys(theirs)).not.toContain("seat");
    }
    // The pair this slice adds is the SEVENTH.
    expect(Object.keys({ kind: "yourPrizesRemaining", counts: [1] })).not.toContain("seat");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — what this slice did NOT buy, and the two version constants.
// ─────────────────────────────────────────────────────────────────────────────

describe("D517 §7 — the price, and both version constants", () => {
  it("the hand-kept READERS list IS the module's reader surface, still THIRTEEN", () => {
    expect(attackReaderSurface()).toHaveLength(14 /* 🆕🆕🆕 D573: 13 → 14, + deriveAttackCopy */);
    expect(READERS).toHaveLength(14 /* 🆕🆕🆕 D573: 13 → 14, + deriveAttackCopy */);
  });

  it("🛑 the GENERALISED clause slot would buy ZERO printings, MEASURED over the column", () => {
    // The road not taken, priced rather than dismissed. A reader keyed on
    // `^If (.+), your opponent's Active Pokémon is now Paralyzed\.$` over the shipped
    // clause table claims this row and NO OTHER in the legal column, so the generality is
    // free of printings — and it would make a table written for the *"does N more damage"*
    // consequent reachable from a STATUS consequent, which is the separation D125
    // installed deliberately.
    const LOOSE = /^If (.+), your opponent's Active Pokémon is now Paralyzed\.$/;
    const hits = legalAttackCorpus().filter(([, s]) => LOOSE.test(s));
    expect(hits.map(([, s]) => s)).toEqual([PRINTED]);
    expect(units(hits)).toBe(1);
  });

  it("🛑 `prizeCount` and this member are the SAME NUMBER in DIFFERENT WALKS", () => {
    // The fourth-spelling argument, driven. `HandRefreshDraw.prizeCount` reads the
    // AFFECTED PLAYER's remaining Prizes — the very number this member reads under
    // `who: "you"` — and it is still not the carrier, because what D159 makes single is
    // the WALK. This member's walk takes (state, ACTING seat) and answers a BOOLEAN; the
    // draw walk takes a DEALT-TO seat and answers a COUNT. The signatures are the proof.
    const state = setPrizes(board(), "p1", 1);
    expect(state.players.p1.prizes).toHaveLength(1);
    expect(conditionHolds(state, "p1", { kind: "yourPrizesRemaining", counts: [1] })).toBe(true);
    // A boolean is not a count: `conditionHolds` cannot express "draw 1", and
    // `handRefreshDrawCount` cannot express "is it exactly 1". Two answers, two walks.
    expect(typeof conditionHolds(state, "p1", { kind: "yourPrizesRemaining", counts: [1] })).toBe(
      "boolean",
    );
  });

  it("🛑 the ENGINE version moved and `MATCH_RECORD_VERSION` did not, and both are argued", () => {
    expect(engineVersion).toBe("0.554.0");
  });

  it("🛑 REACHABILITY IS EMPTY, MEASURED OVER EVERY PRODUCER RATHER THAN ASSERTED", () => {
    // D450's question, and it is the one that decides `MATCH_RECORD_VERSION` here.
    // A `BoardCondition` reaches a persisted address ONLY through a parked program:
    // `EffectContinuation` carries `{pendingOp, rest}` inside `MatchRecord.state.phase`,
    // and `rest` holds every op AFTER the parking one. So a gate carrying this member is
    // persisted the moment any authored list places it behind another op — and the
    // SERIALIZED ALPHABET DOES grow, since `{"kind":"yourPrizesRemaining"}` is a byte
    // string no v30 deploy can write, so D452's *"this byte already ships"* out is NOT
    // available and this measurement is the whole of the claim.
    //
    // This walks BOTH producer sets — `registryCardIds()`'s whole program objects and
    // every program `deriveAttackEffect` returns over the legal column — and asserts the
    // invariant: **anything containing a `yourPrizesRemaining` sits at index 0 of the list
    // it belongs to, and carries no op that can park.** A successor who appends one after
    // a parking op reddens this rung and owes the bump; nothing else would notice.
    const PARKING = new Set([
      "chooseCards",
      "payFromHand",
      "searchDeck",
      "lookAtTopN",
      "damageChosen",
      "knockOutChosen",
      "healChosen",
      "moveCountersChosen",
      "opponentMayDraw",
      "opponentSwitchOut",
      "opponentDiscardsFromHand",
      "attachEnergyFrom",
      "attachFromDeck",
      "attachFromTop",
      "attachFromHand",
      "discardPileRetrieval",
      "evolveFromDeckChosen",
      "evolveFromDeckEachChosen",
      "preventChosenAttack",
      "reorderTop",
      "switchActive",
      "returnBenched",
      "moveEnergy",
    ]);
    const holds = (v: unknown): boolean => {
      if (Array.isArray(v)) return v.some(holds);
      if (v === null || typeof v !== "object") return false;
      const rec = v as Record<string, unknown>;
      if (rec.kind === "yourPrizesRemaining") return true;
      return Object.values(rec).some(holds);
    };
    const opsUnder = (v: unknown, out: string[]): void => {
      if (Array.isArray(v)) {
        for (const el of v) opsUnder(el, out);
        return;
      }
      if (v === null || typeof v !== "object") return;
      const rec = v as Record<string, unknown>;
      if (typeof rec.op === "string") out.push(rec.op);
      for (const el of Object.values(rec)) opsUnder(el, out);
    };
    const offenders: string[] = [];
    let carriers = 0;
    let opLists = 0;
    const walk = (v: unknown, where: string): void => {
      if (Array.isArray(v)) {
        const ops = v.filter((e) => e !== null && typeof e === "object" && "op" in (e as object));
        if (ops.length === v.length && v.length > 0) {
          opLists += 1;
          v.forEach((el, i) => {
            if (!holds(el)) return;
            carriers += 1;
            if (i > 0) offenders.push(`${where}[${i}] is not at index 0`);
            const inner: string[] = [];
            opsUnder(el, inner);
            for (const op of inner) {
              if (PARKING.has(op)) offenders.push(`${where}[${i}] carries parking op ${op}`);
            }
          });
        }
        v.forEach((el, i) => walk(el, `${where}[${i}]`));
        return;
      }
      if (v === null || typeof v !== "object") return;
      for (const [k, el] of Object.entries(v as Record<string, unknown>)) walk(el, `${where}.${k}`);
    };
    for (const id of registryCardIds()) walk(programFor(id), id);
    let derived = 0;
    for (const [, text] of legalAttackCorpus()) {
      const program = deriveAttackEffect(text);
      if (program === null) continue;
      derived += 1;
      walk(program, `derived:${text.slice(0, 40)}`);
    }
    expect(offenders).toEqual([]);
    // …and the walk actually SAW the member, so an empty `offenders` is a finding rather
    // than a walk that missed (D200 — a guard that cannot go red is not a guard).
    // 🆕🆕🆕 D575 — 1 → 2: N's Sigilyph "Victory Symbol" carries the member too, at index 0 of its
    // derived list and around the non-parking `winGame`, so the invariant still holds of both.
    // 🆕🆕🆕 D588 — 2 → 6: Lillie's Determination ×4 (`LILLIES_DETERMINATION`) gates its refresh on
    // `yourPrizesRemaining` [6], at index 0 of its one-op `trainer` list around two non-parking
    // `handRefresh` arms, so the invariant holds of all six.
    expect(carriers).toBe(6);
    expect(opLists).toBeGreaterThan(100);
    expect(derived).toBeGreaterThan(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE FOLLOW-ON THIS MEMBER UNBLOCKS, AND THE REFUSAL, DRIVEN.
// ─────────────────────────────────────────────────────────────────────────────

describe("D517 §8 — corpus `:346` shares this GATE and is deliberately NOT built (🆕🆕🆕 D575: BUILT — the falsifier below fired as written)", () => {
  it("🛑 FALSIFIER — the gate is now available to it and the CONSEQUENT is what is missing", () => {
    // 🛑 THE REFUSAL, WRITTEN AGAINST A FUNCTION RATHER THAN A SPELLING (D473/D479,
    // both of which aged 42 and 37 decisions because they named what was MISSING).
    //
    // `censusAttackCorpus.ts` FILE LINE 346 — *"If you use this attack when you have
    // exactly 1 Prize card remaining, you win this game."*, 1 sentence / 1 legal
    // printing — needs the SAME gate this slice buys, at the SAME value. What it does
    // not have is anywhere to put its consequent: **there is no win, game-end, victory
    // or concede op in `EffectOp` at all.** That is a whole mechanism (§14 reached
    // outside the prize/deck-out/no-body routes), not a clause, and it is out of scope.
    //
    // 🛑 **WHAT WOULD FALSIFY THIS REFUSAL**, stated as a criterion a successor can
    // check rather than as a mood: an `EffectOp` whose resolution can end the game.
    // The rung below is that criterion, executed — it walks every op name any producer
    // in the repo emits and asserts that NONE of them is one. The day such an op ships,
    // this goes RED and the row becomes a two-line arm over the member built here.
    const names = new Set<string>();
    const collect = (v: unknown): void => {
      if (Array.isArray(v)) {
        for (const el of v) collect(el);
        return;
      }
      if (v === null || typeof v !== "object") return;
      const rec = v as Record<string, unknown>;
      if (typeof rec.op === "string") names.add(rec.op);
      for (const el of Object.values(rec)) collect(el);
    };
    for (const id of registryCardIds()) collect(programFor(id));
    for (const [, text] of legalAttackCorpus()) collect(deriveAttackEffect(text));
    expect(names.size).toBeGreaterThan(50);
    const ENDERS = [...names].filter((n) => /win|victor|gameEnd|endGame|concede|forfeit/i.test(n));
    // 🆕🆕🆕 D575 — THE FALSIFIER FIRED, AS WRITTEN: `winGame` shipped (N's Sigilyph
    // "Victory Symbol", `:346`), and the row became the two-line arm over this member that
    // the paragraph above forecast — `conditionGate { yourPrizesRemaining [1] }` around it.
    // The refusal is WITHDRAWN (D539) and kept as the record (D418); the rungs now pin the build.
    expect(ENDERS).toEqual(["winGame"]);
    // …and the row is READ now, whole, by the anchor `WIN_AT_ONE_PRIZE` (effects.ts).
    expect(resolvedByAnyReader(WIN_ROW)).toBe(true);
    expect(deriveAttackEffect(WIN_ROW)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "yourPrizesRemaining", counts: [1] },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "winGame" }],
      },
    ]);
  });

  it("🛑 the PRICE of `:346`, recorded: the GATE is free and the WRAPPER is one group", () => {
    // Two of the three pieces are already paid for, which is what makes this a follow-on
    // rather than a second slice of this size. (a) The GATE is this member at `[1]`,
    // built. (b) The WRAPPER — `If you use this attack when <clause>, …` — is a SECOND
    // printed spelling of a leading condition and is ONE anchor group; it is not in
    // `ATTACK_GATE_CLAUSES` and cannot be, that list being TIMING clauses (🆕 D545:
    // ~~that list being TIMING clauses~~ — rows 6 and 7 are COST clauses now; the
    // wrapper still is not in it, because the list holds WHOLE printed clauses and this
    // is an open-ended prefix). (c) The
    // CONSEQUENT is the whole cost, and it is unpriced here on purpose.
    expect(conditionHolds(setPrizes(board(), "p1", 1), "p1", {
      kind: "yourPrizesRemaining",
      counts: [1],
    })).toBe(true);
    expect(WIN_ROW.startsWith("If you use this attack when you have exactly 1 Prize card")).toBe(
      true,
    );
    // ⚠️ AND THE WRAPPER IS A FAMILY OF EXACTLY ONE at this head, measured — so building
    // it generally would be scaffolding for a pool of one (D121).
    const wrapped = legalAttackCorpus().filter(([, s]) =>
      s.startsWith("If you use this attack when "),
    );
    expect(wrapped.map(([, s]) => s)).toEqual([WIN_ROW]);
  });

  it("🛑 THE MISSING PIECE IS §14 ITSELF, AND IT IS TWO TYPES DEEP — ASKED OF THE TYPE", () => {
    // D516's rule applied to a refusal rather than to a count: **ask the type.** A
    // `Record<GameOverReason, …>` is TOTAL, so the compiler enumerates the union for us
    // and a fifth reason makes THIS FILE fail to compile — which is a stronger tripwire
    // than any grep over prose, and the same instrument `log.ts` already uses.
    // 🆕🆕🆕 D575 — THE TRIPWIRE FIRED AS DESIGNED: the fifth reason, `cardEffect`, landed with
    // N's Sigilyph "Victory Symbol" (`winGame`), and this literal failed to compile until it was
    // added. Kept as the record (D418), with the fifth member.
    const REASONS: Record<GameOverReason, true> = {
      prizesTaken: true,
      noPokemon: true,
      deckOut: true,
      conceded: true,
      cardEffect: true,
    };
    expect(Object.keys(REASONS).sort()).toEqual(
      ["cardEffect", "conceded", "deckOut", "noPokemon", "prizesTaken"].sort(),
    );
    // 🛑 **NONE OF THE FOUR IS "a card said so".** Every one is a BOARD condition
    // `evaluateWin` derives from the state; *"you win this game"* is a printed
    // DECLARATION, so the row needs a FIFTH inhabitant as well as an op — and the
    // inhabitant is on a union that `MatchRecord.state.phase` carries directly, which is
    // a `MATCH_RECORD_VERSION` question rather than a reader one.
    // (🆕🆕🆕 D575 (D539): ~~"NONE OF THE FOUR IS 'a card said so'"~~ — there are FIVE now, and
    // the fifth IS: `cardEffect`, riding the ELEVENTH `MATCH_RECORD_VERSION` position, 37 → 38.)
    expect(Object.keys(REASONS)).toHaveLength(5);
  });
});
