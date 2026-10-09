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
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import { applyAction, conditionHolds, engineVersion } from "./index";
import type { DamageCountSource, EffectOp, GameEvent, GameState } from "./index";
import manifest from "../package.json" with { type: "json" };
import { programFor, registryCardIds } from "./registry";
import {
  DEFENDER_STATUS_TRIPLE_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  clearBench,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
} from "./testFixtures";
import type { SpecialConditions } from "./types";
import { presentStatuses } from "./types";

// 0.404.0 → 0.405.0 — 🆕🆕🆕 D518: THE §12 SPECIAL-CONDITION TALLY ON THE DEFENDING
// ACTIVE, AND THE COUNT THAT SHARES ITS PREDICATE'S WALK.
//
// *"This attack does 100 damage for each Special Condition affecting your opponent's
// Active Pokémon."* — `censusAttackCorpus.ts` **FILE LINE 537**, **1 sentence / 2 legal
// printings**, claimed by `deriveAttackDamageMultiplier` through ONE new anchor
// (`OPPONENT_CONDITION_COUNT_MULTIPLY`) and ONE new `DamageCountSource` member
// (`specialConditionsOnOpponentActive`, the **20th**), deriving
// `{per:100, count:{kind:"specialConditionsOnOpponentActive"}}`.
//
// 🛑 **THE PREDICATE ALREADY SHIPPED AND WAS STRUCTURALLY UNABLE TO PAY — WHICH IS THE
// WHOLE PRICING ARGUMENT, AND §2 MEASURES IT RATHER THAN ASSERTING IT.**
// `BoardCondition.opponentActiveHasSpecialCondition` has read corpus FILE LINE 386
// (*"If your opponent's Active Pokémon is affected by a Special Condition, this attack
// does 120 more damage."*, **8 printings**, the family's largest row) since D116, and it
// reaches the damage fold through `DamageCountSource.boardCondition`. **That member is
// the 0-or-1 INDICATOR (D115)**: `attack.ts` spells it
// `conditionHolds(...) ? bonus.per : 0`, so its ceiling is `per` at every `per`. This
// row pays `per` per CONDITION and a body can carry THREE at once, so the delta is
// COUNTING rather than TESTING, and no reparameterisation of the shipped member reaches
// it. §3 drives a board that separates them by 200 HP.
//
// 🛑 **THE WALK IS SHARED, AND THAT IS WHAT MAKES THE INVARIANT STRUCTURAL RATHER THAN
// AGREED.** D159 as this repo applies it — *what D159 makes single is the WALK* (D516,
// D517, and now three consecutive slices) — and here the walk already existed.
// `presentStatuses` (types.ts) projects the rotation slot, Poison and Burn onto
// `StatusName`; the shipped predicate is `presentStatuses(...).length > 0` and the new
// evaluator arm is `presentStatuses(...).length`. So **predicate ⟺ count ≥ 1 holds BY
// CONSTRUCTION on every board**: there is no second definition that could disagree, and
// §5 sweeps the biconditional over every inhabitant of `SpecialConditions` rather than
// asserting it once. It is the same reason `opponentActiveBurned` and
// `opponentActiveConfused` (D377) ask the projection instead of the fields.
//
// 🛑 **THE COUNT IS AT MOST 3, AND THE NAÏVE READING ANSWERS 4.** `SpecialConditions`
// carries FOUR fields and only THREE conditions: `rotation` is an EXCLUSIVE enum (Asleep,
// Paralyzed and Confused share one slot, so it contributes 0 or 1), `poisonDamage > 0` is
// Poison's own flag, `burned` is Burn's — and **`confusionDamage` (D501) is a PARAMETER
// of Confusion rather than a condition**, meaningful only while `rotation === "confused"`.
// §3's trap board is Confused with `confusionDamage: 80`: it counts **ONE** and deals
// 100, where a set-fields tally would count two and deal 200.
//
// ⚠️ **MULTIPLY ONLY, AND THE ADDITIVE TWIN IS DELIBERATELY ABSENT.** The column prints
// *"…more damage for each Special Condition…"* ZERO times over all 640 legal sentences —
// the additive reading of this noun is spelled as the INDICATOR at line 386 — so
// `deriveAttackDamageBonus` gains nothing and the member is reachable from ONE reader.
// An additive anchor would be an arm no board reaches (D440's rule); §1 measures the zero.
//
// ⚠️ **THE CARRIERS ARE UNRESOLVED AND SAID SO (D425).** This checkout has no D1, so the
// two cards printing this sentence cannot be named and are not invented. The STRING and
// the PRINTING COUNT are transcription, asserted off `legalAttackCorpus()` in §1; the
// body is `fix-oxford`, a shipped synthetic fixture re-texted on a per-board `cardPool`
// clone (D414) — **ZERO new `FIXTURE_POOL` ids and ZERO new decks.**
//
// ⚠️ **THE WITNESS THIS SLICE EVICTED.** `scaledDamage.test.ts` homed its *"count source
// with no reader at all"* claim on THIS row at D469 and argued it two ways: no member
// answers the tally, and the indicator structurally cannot. **Both clauses were right, 49
// decisions early.** This slice pays the first and leaves the second true forever; the
// witness is re-homed onto corpus FILE LINE 596 and re-pointed there (D444), and the
// corpus-wide grep of `specialConditionsOnOpponentActive` and of `Special Condition`
// found no OTHER rung carrying this row's unbuiltness — D516's rule (4) run and
// answering NO, which is reported because a clean sweep is a measurement.
//
// ⚠️ **[D519, ONE SLICE LATER — FILE LINE 596 IS BUILT, so the sentence above is a record of
// what THIS slice did and not a statement about the column today.** The witness moved on to a
// SIXTH home. ⚠️ And the refusal D518 wrote for it was right in its verdict and wrong in its
// stated cause: the row needed a rider on the COUNT, not a `CardFilter` inhabitant — a card has
// no `damage` field, so the member it named could not have been written. **D519's grep, run on
// `CardFilter`-plus-damage rather than on the printed noun, found the correction already on
// record in `counterFold.test.ts` (D450) and green the whole time** — which is the half of
// D516's rule (4) that a noun-keyed sweep cannot reach.]**

/** Corpus FILE LINE 537, byte for byte. */
const PRINTED =
  "This attack does 100 damage for each Special Condition affecting your opponent's Active Pokémon.";

/** Corpus FILE LINE 386 — the INDICATOR sibling on the same printed noun, 8 printings.
    Read for its PROGRAM rather than its verdict (D514): which arm claims a sibling, and
    with what value, is what prices a row. */
const INDICATOR =
  "If your opponent's Active Pokémon is affected by a Special Condition, this attack does 120 more damage.";

/** The rest of the printed `Special Condition` family, enumerated rather than
    summarised (D428). Both are BUILT and neither is a count. */
const RECOVER = "This Pokémon recovers from all Special Conditions."; // :513
const COST_WAIVER =
  "If this Pokémon is affected by a Special Condition, ignore all Energy in this attack's cost."; // :324
const RAISED_CONFUSION =
  "Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that Pokémon for this Special Condition."; // :685

/** The ADDITIVE spelling of THIS row — printed ZERO times, which is why no additive
    anchor was written. Constructed, and labelled as such (D452). */
const UNPRINTED_ADDITIVE =
  "This attack does 100 more damage for each Special Condition affecting your opponent's Active Pokémon.";

/** The SELF spelling — printed ZERO times, which is why the seat is in the member's
    NAME rather than in a field (D168/D104). Constructed. */
const UNPRINTED_SELF =
  "This attack does 100 damage for each Special Condition affecting this Pokémon.";

/** THE DERIVED VALUE, spelled once so a case cannot pass against a hand-copied literal
    that has drifted from what the file means by it. */
const READING = { per: 100, count: { kind: "specialConditionsOnOpponentActive" } } as const;

const READERS = [
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
  // 🆕🆕🆕 D573 — THE FOURTEENTH, the copy-attack reader. Spliced before the last entry (D419).
  deriveAttackCopy,
  deriveAttackRequirement,
];

const SPLITTERS = [
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
];

const SEED = 11;
const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

const types = (events: GameEvent[]) => events.map((e) => e.type);

/** Setup, then P1's turn 2 (P2 went first and passed) — P1's first unrestricted turn
    (§4). `fix-oxford` attacks, `fix-titan` defends: **340 HP and NO attacks**, so the
    three-condition board (300 damage) survives and no Knock Out can move a Prize, end
    the game or take a status off the board behind the assertion's back. Both benches are
    cleared, so every number read here is read off the two Actives. */
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
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = clearBench(state, "p2");
  return state;
}

/** Re-text `fix-oxford`'s attack `index` on THIS board's `cardPool` copy.
    ⚠️ **NOT A FIXTURE EDIT** — `FIXTURE_POOL` is shared by many suites and D412
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

/** Index 1 is "Bare Bloom" — {C}, and **no `damage` key at all** — so the printed base
    is 0 before the fold drops it, and every HP observed here is the count's. */
const INDEX = 1;

const swing = (state: GameState) => mustApply(state, { type: "attack", seat: "p1", index: INDEX });

/** How many §12 conditions `seat`'s Active carries, through the SAME projection both
    walks read. Throws on an empty Spot rather than defaulting — a `??` here would make
    every assertion below pass against a board that never got built. */
function conditionsOf(state: GameState, seat: "p1" | "p2"): number {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return presentStatuses(active.conditions).length;
}

/** A board carrying `conditions` on the DEFENDER, with `PRINTED` on the attacker. */
function armed(conditions: Partial<SpecialConditions>, seed = SEED): GameState {
  return setConditions(withEffect(board(seed), PRINTED), "p2", conditions);
}

/** Every shape the model can hold, as `Partial<SpecialConditions>`, with the count the
    PRINTED sentence means. The rotation's four values, the two independent flags, the
    combinations — and the trap. */
const CASES: readonly (readonly [string, Partial<SpecialConditions>, number])[] = [
  ["clean", {}, 0],
  ["burned", { burned: true }, 1],
  ["poisoned", { poisonDamage: 10 }, 1],
  ["asleep", { rotation: "asleep" }, 1],
  ["paralyzed", { rotation: "paralyzed" }, 1],
  ["confused", { rotation: "confused" }, 1],
  // 🛑 THE TRAP, AND IT IS THE REASON THIS MEMBER DELEGATES. FOUR fields are set and the
  // printed answer is ONE: `confusionDamage` is a PARAMETER of Confusion (D501), not a
  // condition, and `rotation` is EXCLUSIVE.
  ["confused, amount raised", { rotation: "confused", confusionDamage: 80 }, 1],
  ["burned+asleep", { burned: true, rotation: "asleep" }, 2],
  ["burned+poisoned", { burned: true, poisonDamage: 30 }, 2],
  ["confused+poisoned", { rotation: "confused", poisonDamage: 10 }, 2],
  ["all three", { burned: true, rotation: "confused", poisonDamage: 10 }, 3],
  // The maximum, with every amount field raised at once: still THREE.
  [
    "all three, both amounts raised",
    { burned: true, rotation: "confused", poisonDamage: 90, confusionDamage: 80 },
    3,
  ],
];

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, measured live over the legal column.
// ─────────────────────────────────────────────────────────────────────────────

describe("D518 §1 — the printed data, measured live over the legal column", () => {
  it("🛑 the sentence is the CORPUS's bytes at TWO printings, and so is its whole family", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n] as const));
    expect(rows.get(PRINTED)).toBe(2);
    expect(rows.get(INDICATOR)).toBe(8);
    expect(rows.get(RECOVER)).toBe(2);
    expect(rows.get(COST_WAIVER)).toBe(1);
    expect(rows.get(RAISED_CONFUSION)).toBe(1);
  });

  it("🛑 the `Special Condition` family is FIVE rows / 14 printings, enumerated not summarised", () => {
    const family = legalAttackCorpus().filter(([, s]) => s.includes("Special Condition"));
    expect(family.map(([, s]) => s).sort()).toEqual(
      [PRINTED, INDICATOR, RECOVER, COST_WAIVER, RAISED_CONFUSION].sort(),
    );
    expect(units(family)).toBe(14);
    // 🛑 ~~FOUR OF THE FIVE ARE NOW BUILT.~~ ~~The one that is not is the COST modifier, whose
    // blocker is `effectiveAttackCost` and not this union at all — named so a successor
    // does not read this slice as having left a count unbuilt.~~
    // 🆕🆕🆕 **D545 — ALL FIVE ARE BUILT, AND THE STRUCK BLOCKER WAS THE WRONG SEAM.**
    // `COST_WAIVER` (corpus `:324`) is built on the GATE arm as a WHOLE printed clause
    // (`costWaivedIf`, `body: ""`), read by `attackCostAt` (attack.ts) — which WRAPS
    // `effectiveAttackCost` rather than changing it. The rung is RE-KEYED from the READER
    // predicate to the census's own four-arm predicate (reader → gate → trailing), so the
    // next build of a family row reddens it rather than leaving a stale list green: the
    // reader-only list is still `[COST_WAIVER]`, and that is pinned below as what it is.
    const censusBuilt = (s: string): boolean => {
      if (resolvedByAnyReader(s)) return true;
      const g = splitAttackGateClause(s);
      if (g !== null && (g.body === "" || resolvedByAnyReader(g.body))) return true;
      return splitAttackTrailingClause(s) !== null;
    };
    expect(family.filter(([, s]) => !censusBuilt(s)).map(([, s]) => s)).toEqual([]);
    const unbuilt = family.filter(([, s]) => !resolvedByAnyReader(s));
    expect(unbuilt.map(([, s]) => s)).toEqual([COST_WAIVER]);
  });

  it("🛑 the ADDITIVE spelling of this noun is printed ZERO times — the zero is MEASURED", () => {
    // D440's rule: an arm no board reaches is not written. The sweep is over all 640
    // legal sentences and over BOTH seats, so it cannot be satisfied by looking at the
    // one row this slice builds.
    const additive = legalAttackCorpus().filter(([, s]) =>
      /more damage for each Special Condition/.test(s),
    );
    expect(additive).toEqual([]);
    // …and the SELF spelling too, which is why the seat is in the member's NAME.
    const self = legalAttackCorpus().filter(([, s]) =>
      /for each Special Condition affecting this Pokémon/.test(s),
    );
    expect(self).toEqual([]);
    // The two constructed near-misses are therefore constructed, and both are refused —
    // by the ANCHOR, which is the only thing standing between them and this member.
    expect(resolvedByAnyReader(UNPRINTED_ADDITIVE)).toBe(false);
    expect(resolvedByAnyReader(UNPRINTED_SELF)).toBe(false);
  });

  it("the APOSTROPHE is ASCII, and the anchor takes the typographic one anyway", () => {
    expect(PRINTED.includes("opponent's")).toBe(true);
    expect(PRINTED.includes("opponent’s")).toBe(false);
    expect(PRINTED.codePointAt(PRINTED.indexOf("'"))).toBe(0x0027);
    expect(PRINTED.includes("Pokémon")).toBe(true);
    // D137's `['’]` class, so a punctuation-normalising re-ingest cannot un-build the row.
    expect(deriveAttackDamageMultiplier(PRINTED.replace("opponent's", "opponent’s"))).toEqual(
      READING,
    );
  });

  it("a printed ZERO is left LOUD rather than derived to a no-op", () => {
    // The family's `per >= 1` guard. A `0×` sentence does nothing, and a reader that
    // claimed it would report the attack as simulated while dealing nothing.
    expect(
      deriveAttackDamageMultiplier(PRINTED.replace("does 100 damage", "does 0 damage")),
    ).toBeNull();
    // …and the amount is CAPTURED rather than hard-coded to 100.
    expect(deriveAttackDamageMultiplier(PRINTED.replace("100", "40"))).toEqual({
      per: 40,
      count: { kind: "specialConditionsOnOpponentActive" },
    });
  });

  it("the anchors are load-bearing at BOTH ends and the capital `This` is half of it", () => {
    for (const text of [
      PRINTED.replace("This attack", "this attack"),
      PRINTED.slice(0, -1),
      `Draw a card. ${PRINTED}`,
      `${PRINTED} Then, draw a card.`,
      // The head noun and the preposition are spelled into the pattern, not captured —
      // so neither cross-combination reaches the member.
      PRINTED.replace("Special Condition affecting", "Special Condition on"),
      PRINTED.replace("Special Condition affecting", "damage counter affecting"),
    ]) {
      expect(deriveAttackDamageMultiplier(text), text).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the reader, the ARM, and the sibling's PROGRAM (D514).
// ─────────────────────────────────────────────────────────────────────────────

describe("D518 §2 — the reading, the arm, and the indicator sibling it does NOT narrow", () => {
  it("🆕🆕🆕 the sentence is RESOLVED, and by exactly ONE of the thirteen readers", () => {
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(deriveAttackDamageMultiplier(PRINTED)).toEqual(READING);
    for (const read of READERS) {
      if (read === deriveAttackDamageMultiplier) continue;
      expect(read(PRINTED), read.name).toBeNull();
    }
    // …and no splitter is live on it, at either end. Six-for-six.
    for (const split of SPLITTERS) expect(split(PRINTED), split.name).toBeNull();
  });

  it("🛑 the INDICATOR sibling derives BYTE FOR BYTE what it derived before", () => {
    // The slice WIDENS and never narrows: corpus FILE LINE 386 (8 printings, the family's
    // largest row) still reaches `boardCondition` over the shipped predicate. A new arm
    // placed ahead of the wrong one is exactly how a widening becomes a regression.
    expect(deriveAttackDamageBonus(INDICATOR)).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveHasSpecialCondition" } },
    });
    expect(deriveAttackDamageMultiplier(INDICATOR)).toBeNull();
    // …and the other two built family rows are untouched as well.
    expect(deriveAttackEffect(RECOVER)).toEqual([{ op: "clearStatus" }]);
    expect(deriveAttackEffect(RAISED_CONFUSION)).not.toBeNull();
  });

  it("🛑 EVERY built row of this family lands on the READER arm (🆕 D545: four of the five — `COST_WAIVER` lands on the GATE arm) — the four-way split, per sentence", () => {
    // D514's rule: which ARM claims a sibling is what prices a row, ~~and the gate arm is a
    // CLOSED four-entry TIMING list that no `If …,` clause of any other kind reaches
    // (D517)~~. Asked per sentence rather than off the totals.
    // 🆕🆕🆕 D545 — the struck clause is FALSE: the list was already five entries at D541,
    // and D545 added two leading `If …,` COST clauses to it (`alternateCostIf` for `:316`,
    // `costWaivedIf` for `:324` = `COST_WAIVER`), so a non-TIMING `If …,` clause now reaches
    // the gate arm when its whole printed text is a row.
    const armOf = (text: string): string => {
      if (resolvedByAnyReader(text)) return "reader";
      const g = splitAttackGateClause(text);
      // 🆕 D529 — widened with the census: a clause-only split (`body: ""`) is the gate arm.
      if (g !== null && (g.body === "" || resolvedByAnyReader(g.body))) return "gate";
      return splitAttackTrailingClause(text) !== null ? "trailing" : "none";
    };
    expect(armOf(PRINTED)).toBe("reader");
    expect(armOf(INDICATOR)).toBe("reader");
    expect(armOf(RECOVER)).toBe("reader");
    expect(armOf(RAISED_CONFUSION)).toBe("reader");
    // 🆕🆕🆕 D545 — `"none"` → `"gate"`: the whole printed text is the seventh row of
    // `ATTACK_GATE_CLAUSES` (`costWaivedIf`), split with `body: ""` (D395's path). So
    // the heading's *"EVERY built row … lands on the READER arm"* is now true of FOUR of
    // the five, and this one is the GATE arm's (the title says so in its D545 note).
    expect(armOf(COST_WAIVER)).toBe("gate");
  });

  it("🛑 the INDICATOR's ceiling is `per`, which is why this row cost a MEMBER", () => {
    // The pricing argument, driven at the type rather than argued in prose. The shipped
    // member carries a `BoardCondition` and nothing else — there is no amount, no list
    // and no multiplier on it — so the fold `conditionHolds(...) ? per : 0` is the most
    // it can ever produce. §3's three-condition board is 300 and the indicator's is 100.
    const indicator = deriveAttackDamageBonus(INDICATOR);
    expect(indicator?.count.kind).toBe("boardCondition");
    expect(Object.keys(indicator?.count ?? {}).sort()).toEqual(["cond", "kind"]);
    // …and the new member is NULLARY: the seat is its name, so there is nothing to vary.
    expect(Object.keys(READING.count)).toEqual(["kind"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the count on real boards, including the TRAP.
// ─────────────────────────────────────────────────────────────────────────────

describe("D518 §3 — the tally on a board: 0, 1, 2, 3 — and `confusionDamage` is not one", () => {
  it("🛑 a CLEAN defender is 0, and 0 emits NO `DAMAGE_DEALT` AT ALL", () => {
    // The `×` fold drops the printed base, and attack.ts guards the whole §8.5 pipeline
    // on `scaledBase + scaledTotal > 0`. So the printed floor here is silence, not a
    // zero-HP row — the shape every member of this fold already has.
    const { events, state } = swing(armed({}));
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(state.players.p2.active?.damage).toBe(0);
    // …and the attack RESOLVED: it is not on the loud unread path.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 THE TRAP — Confused with a RAISED `confusionDamage` counts ONE, not two", () => {
    // 🛑 FOUR FIELDS SET, ONE CONDITION. `confusionDamage` (D501) is a PARAMETER of
    // Confusion and is meaningful only while `rotation === "confused"`; a tally that
    // counted SET FIELDS would read 2 here and deal 200. The two answers are 100 HP
    // apart on one board, which is what makes this a measurement rather than a caption.
    const raised = armed({ rotation: "confused", confusionDamage: 80 });
    expect(raised.players.p2.active?.conditions.confusionDamage).toBe(80);
    expect(find(swing(raised).events, "DAMAGE_DEALT")?.dealt).toBe(100);
    // …and the raised amount really is on the board rather than silently normalised,
    // so the rung cannot pass because the surgery did not take.
    const plain = armed({ rotation: "confused" });
    expect(plain.players.p2.active?.conditions.confusionDamage).not.toBe(80);
    expect(find(swing(plain).events, "DAMAGE_DEALT")?.dealt).toBe(100);
  });

  it("🛑 the ROTATION is EXCLUSIVE, so three of the five §12 words share one unit", () => {
    // Asleep, Paralyzed and Confused are ONE slot: each is 1 on its own and no board can
    // hold two of them. Burn and Poison are independent flags and stack with it.
    for (const rotation of ["asleep", "paralyzed", "confused"] as const) {
      expect(find(swing(armed({ rotation })).events, "DAMAGE_DEALT")?.dealt, rotation).toBe(100);
    }
    expect(find(swing(armed({ burned: true })).events, "DAMAGE_DEALT")?.dealt).toBe(100);
    expect(find(swing(armed({ poisonDamage: 10 })).events, "DAMAGE_DEALT")?.dealt).toBe(100);
  });

  it("🛑 the whole condition space, swept — every case, its count and its HP", () => {
    // One board per case, all from the same seed and the same fixture: nothing but the
    // conditions differs between the runs, so a difference cannot be credited elsewhere.
    const table = CASES.map(([label, conditions, expected]) => {
      const state = armed(conditions);
      const active = state.players.p2.active;
      if (active === null) throw new Error("no defender");
      const dealt = find(swing(state).events, "DAMAGE_DEALT")?.dealt ?? 0;
      return [label, presentStatuses(active.conditions).length, dealt, expected] as const;
    });
    for (const [label, counted, dealt, expected] of table) {
      expect(counted, `${label}: the walk`).toBe(expected);
      expect(dealt, `${label}: the HP`).toBe(expected * 100);
    }
    // ANTI-VACUITY: the sweep spans four distinct counts, so it cannot be satisfied by a
    // reader stuck on any single one of them.
    expect([...new Set(table.map(([, , , n]) => n))].sort()).toEqual([0, 1, 2, 3]);
  });

  it("🛑 the SIBLING indicator on the SAME three-condition board deals 120, not 360", () => {
    // The attribution control for the whole slice. The indicator's 8-printing sentence
    // and this row's sit on the same board, and the numbers are the printed 120 against
    // 300 — a build that routed this sentence through `boardCondition` would read 100.
    const all = { burned: true, rotation: "confused", poisonDamage: 10 } as const;
    const mine = setConditions(withEffect(board(31), PRINTED), "p2", all);
    const theirs = setConditions(withEffect(board(31), INDICATOR), "p2", all);
    expect(find(swing(mine).events, "DAMAGE_DEALT")?.dealt).toBe(300);
    expect(find(swing(theirs).events, "DAMAGE_DEALT")?.dealt).toBe(120);
  });

  it("🛑 an HONEST IN-GAME board: `Triple Bloom` arms all three, and the fold reads the board", () => {
    // Surgery is the primary instrument above (crossBoardStatus.test.ts §5's precedent),
    // and this rung is the control that says the member reads a REAL board rather than a
    // shape only `setConditions` produces. `fix-oxford` index 0 prints *"Your opponent's
    // Active Pokémon is now Burned, Confused, and Poisoned."* — a built `applyStatus`
    // batch — so the conditions arrive the way a game delivers them.
    //
    // ⚠️ **AN ATTACK ENDS THE TURN [🆕🆕🆕 D570 (D539): except a FIRST attack under Festival Lead with Festival Grounds in play, which no board here builds] (D491)**, so the tally is read a full round later, and
    // §13.2's Burn coin may cure the Burn in between. The expectation is therefore
    // DERIVED from the board at declaration rather than pinned at 3: what is asserted is
    // that the fold equals `100 × presentStatuses(defender)`, whatever the Checkup did —
    // plus a floor of TWO, so the rung cannot pass on a board that lost everything.
    let state = withEffect(board(29), PRINTED);
    state = mustApply(state, { type: "attack", seat: "p1", index: 0 }).state;
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    const active = state.players.p2.active;
    if (active === null) throw new Error("no defender");
    const armedCount = presentStatuses(active.conditions).length;
    expect(armedCount).toBeGreaterThanOrEqual(2);
    expect(find(swing(state).events, "DAMAGE_DEALT")?.dealt).toBe(armedCount * 100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the 2⁴ lattice, on BOTH sides (D503/D505/D508).
// ─────────────────────────────────────────────────────────────────────────────

describe("D518 §4 — SHAPE × NOUN × SEAT × FOLD, 16 points, and the flip table", () => {
  const SEATS = ["this Pokémon", "your opponent's Active Pokémon"] as const;
  /** `shape` 0 = the COUNT sentence, 1 = the PREDICATE one; `noun` 0 = damage counters,
      1 = Special Conditions; `seat` 0 = self, 1 = the opponent's Active; `fold` 0 =
      multiply, 1 = additive. All sixteen are grammatical English and none is invented
      vocabulary — the four axes are the sentence's OWN variation. */
  const text = (shape: number, noun: number, seat: number, fold: number): string => {
    const more = fold === 1 ? "more " : "";
    if (shape === 0) {
      const phrase =
        noun === 1
          ? `Special Condition affecting ${SEATS[seat]}`
          : `damage counter on ${SEATS[seat]}`;
      return `This attack does 100 ${more}damage for each ${phrase}.`;
    }
    const clause =
      noun === 1
        ? `${SEATS[seat]} is affected by a Special Condition`
        : `${SEATS[seat]} has any damage counters on it`;
    return `If ${clause}, this attack does 100 ${more}damage.`;
  };
  const POINTS = [0, 1].flatMap((s) =>
    [0, 1].flatMap((n) =>
      [0, 1].flatMap((se) => [0, 1].map((f) => ({ key: [s, n, se, f], t: text(s, n, se, f) }))),
    ),
  );
  const lit = (t: string) => resolvedByAnyReader(t);

  it("all 16 points are DISTINCT strings — the anti-degeneracy check (D491)", () => {
    expect(new Set(POINTS.map((p) => p.t)).size).toBe(16);
  });

  it("🛑 the BUILT set is 7 of 16, and the printed row is the one this slice lit", () => {
    const built = POINTS.filter((p) => lit(p.t)).map((p) => p.key.join(""));
    expect(built.sort()).toEqual(["0000", "0001", "0010", "0011", "0110", "1001", "1111"]);
    // `0110` IS the printed row, and `0010` — its only lit neighbour before the build —
    // is the damage-counter twin one NOUN flip away.
    expect(text(0, 1, 1, 0)).toBe(PRINTED);
    expect(text(1, 1, 1, 1)).toBe(INDICATOR.replace("120", "100"));
  });

  it("🛑 the two predicates AGREE at every point, and both splitters are null at 16/16", () => {
    // D503's rule run: readers-only and the full residue predicate give the same verdict
    // everywhere, so nothing in this lattice is claimed by a splitter or the registry.
    let gate = 0;
    let trailing = 0;
    for (const p of POINTS) {
      if (splitAttackGateClause(p.t) !== null) gate += 1;
      if (splitAttackTrailingClause(p.t) !== null) trailing += 1;
    }
    expect(gate).toBe(0);
    expect(trailing).toBe(0);
  });

  it("🛑 the POST flip table is `5 · 5 · 3 · 3` of 8, with zero inert and zero free axes", () => {
    const flips = [0, 1, 2, 3].map((axis) => {
      let n = 0;
      for (const p of POINTS) {
        if (p.key[axis] === 1) continue;
        const q = POINTS.find((x) => x.key.every((v, i) => (i === axis ? v === 1 : v === p.key[i])));
        if (q !== undefined && lit(p.t) !== lit(q.t)) n += 1;
      }
      return n;
    });
    // SHAPE · NOUN · SEAT · FOLD. Every axis flips somewhere (no INERT axis) and none
    // flips everywhere (no axis is a pure blocker) — which is what distinguishes this
    // shape from D505's seventh and D508's ninth. The PRE table was `4 · 6 · 2 · 2`:
    // NOUN FELL as the printed point stopped blocking while the other three ROSE, each
    // having gained a lit neighbour (D513's phenomenon, fifth occurrence).
    expect(flips).toEqual([5, 5, 3, 3]);
  });

  it("🛑 the BUILT set now CONTAINS the PRINTED set — no literal refuses a printed row", () => {
    // Six of the sixteen points are printed at SOME amount; all six build. The one
    // built-but-unprinted point (`1001`) was already built before this slice.
    const corpus = legalAttackCorpus();
    const printed = POINTS.filter((p) => {
      const re = new RegExp(
        `^${p.t
          .split("100")
          .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("\\d+")}$`,
      );
      return corpus.some(([, s]) => re.test(s));
    });
    expect(printed.map((p) => p.key.join("")).sort()).toEqual([
      "0000",
      "0001",
      "0010",
      "0011",
      "0110",
      "1111",
    ]);
    for (const p of printed) expect(lit(p.t), p.t).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the INVARIANT: one walk, two folds.
// ─────────────────────────────────────────────────────────────────────────────

describe("D518 §5 — predicate ⟺ count ≥ 1, by construction rather than by agreement", () => {
  it("🛑 the biconditional holds on EVERY inhabitant of the condition space", () => {
    // The claim D159 buys here, swept rather than asserted once. `conditionHolds` walks
    // `presentStatuses(...).length > 0`; this member walks `presentStatuses(...).length`.
    // If the two could disagree on any board, that would be the finding; they cannot, and
    // this is the assertion that says so out loud.
    let bothTrue = 0;
    let bothFalse = 0;
    for (const [label, conditions, expected] of CASES) {
      const state = armed(conditions);
      const active = state.players.p2.active;
      if (active === null) throw new Error("no defender");
      const count = presentStatuses(active.conditions).length;
      const holds = conditionHolds(state, "p1", { kind: "opponentActiveHasSpecialCondition" });
      expect(count, label).toBe(expected);
      expect(holds, label).toBe(count >= 1);
      if (holds) bothTrue += 1;
      else bothFalse += 1;
    }
    // ANTI-VACUITY: the sweep visits BOTH sides of the biconditional.
    expect(bothTrue).toBeGreaterThan(0);
    expect(bothFalse).toBeGreaterThan(0);
  });

  it("🛑 the EMPTY Active Spot is FALSE on the predicate, and UNREACHABLE from the fold", () => {
    // ⚠️ **THE HONEST FORM OF THIS RUNG, AND THE FIRST DRAFT WAS VACUOUS.** Both walks
    // carry an `active === null` guard — `false` on the predicate, `0` on the count — and
    // `0 >= 1` is false, so they agree. But the COUNT's guard cannot be reached from a
    // board at all: §8's gate refuses an attack with no Defending Pokémon, which is what
    // is DRIVEN here rather than a `?? default` that asserts `0 === 0`.
    const base = board();
    const state: GameState = {
      ...base,
      players: { ...base.players, p2: { ...base.players.p2, active: null } },
    };
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasSpecialCondition" })).toBe(false);
    const refused = applyAction(withEffect(state, PRINTED), {
      type: "attack",
      seat: "p1",
      index: INDEX,
    });
    expect(refused.ok).toBe(false);
  });

  it("🛑 the SEAT is real: the same board read from the other side is 0", () => {
    // A p1-only suite cannot tell *"reads the OPPONENT's Active"* apart from *"reads p2's
    // Active"*. Armed on p2, the count is 3 for p1 and 0 for p2 — and the HP the fold
    // deals follows the predicate rather than the seat this suite happens to attack from.
    const state = armed({ burned: true, rotation: "confused", poisonDamage: 10 });
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasSpecialCondition" })).toBe(true);
    expect(conditionHolds(state, "p2", { kind: "opponentActiveHasSpecialCondition" })).toBe(false);
    expect(conditionsOf(state, "p2")).toBe(3);
    expect(conditionsOf(state, "p1")).toBe(0);
    expect(find(swing(state).events, "DAMAGE_DEALT")?.dealt).toBe(300);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — `MATCH_RECORD_VERSION`, and what this slice did NOT buy.
// ─────────────────────────────────────────────────────────────────────────────

/** Every inhabitant of `DamageCountSource["kind"]`, as a TOTAL `Record` — D446's
    compile-enforced idiom. ⚠️ **A `readonly string[]` ANNOTATED with the union would NOT
    be a guard on it** (D512's finding: widening a union cannot make a narrower array
    illegal). A 21st member makes this object fail to COMPILE. */
const COUNT_KINDS: Record<DamageCountSource["kind"], true> = {
  damageCountersOnSelf: true,
  opponentPrizesTaken: true,
  opponentActiveRetreatCost: true,
  boardCondition: true,
  damageCountersOnOpponentActive: true,
  specialConditionsOnOpponentActive: true,
  damageCountersOnYourBench: true,
  damageCountersOnOpponentBoard: true,
  bothSidesBenchCount: true,
  opponentBenchCount: true,
  yourBenchCount: true,
  energyOnOpponent: true,
  energyOnSelf: true,
  bothActivesEnergyCount: true,
  toolsOnYourBoard: true,
  extraEnergyUnitsBeyondCost: true,
  pokemonInPlay: true,
  bothSidesPokemonInPlay: true,
  cardsInDiscardPile: true,
  cardsInOpponentHand: true,
  // 🆕🆕🆕 D600 — WP14's `cardsInYourHand` (Galarian Meowth's fold, Alakazam's `damageActive.per`).
  cardsInYourHand: true,
  // 🆕🆕🆕 D607 — WP28a's three nullary members (Delphox, Bronzong, Sylveon ex folds).
  energyInPlayBothSides: true,
  toolsInPlayBothSides: true,
  basicEnergyTypesOnYourBoard: true,
  // 🆕🆕🆕 D620 — WP10's `yourPrizesTaken` (Incessant Onslaught, Cheerful Flame, Gobble Down).
  yourPrizesTaken: true,
  // 🆕🆕🆕 D623 — WP28b's three Bench-body members (Gourgeist ex, Armarouge, Igglybuff folds).
  damagedBenchedPokemon: true,
  benchedPokemonWithEnergy: true,
  benchedPokemonWithMaxHp: true,
};

describe("D518 §6 — `MATCH_RECORD_VERSION` HOLDS at 30: there is no carrier at all", () => {
  it("🛑 the union has TWENTY members, and the count is asked of the TYPE", () => {
    // 🆕🆕🆕 D600 (D539): "TWENTY" is the count at this slice, kept as written — 21 since WP14's
    // `cardsInYourHand`. 🆕🆕🆕 D607: 24 since WP28a's three. 🆕🆕🆕 D620: 25 since WP10's `yourPrizesTaken`. 🆕🆕🆕 D623: 28 since WP28b's three.
    expect(Object.keys(COUNT_KINDS)).toHaveLength(28);
    expect(COUNT_KINDS.specialConditionsOnOpponentActive).toBe(true);
  });

  it("🛑 NO op any producer in this repo emits carries a `DamageCountSource` — walked, not grepped", () => {
    // [🆕🆕🆕 D600 (D539): "NO op any producer in this repo emits" is WITHDRAWN as a repo-wide
    // claim, kept as written — the walk below covers the legal `sv` attack column and the
    // registry's ATTACK programs only. `drawCards.per` (D557/D569/D599, Trainer programs; D557's
    // rides a parked `rest`) and D600's `damageActive.per` (`cardsInYourHand`, derived for the `me`
    // Alakazam "Powerful Hand") carry one outside it. The walked population is still carrier-free.]
    // 🛑 THE VERSION QUESTION, SETTLED EITHER WAY RATHER THAN LEFT IMPLIED (D517's rule).
    // A `BoardCondition` DOES reach a persisted address, through `EffectContinuation.rest`
    // inside `MatchRecord.state.phase`. A `DamageCountSource` does not, because nothing
    // persisted holds one: a damage FOLD emits no `EffectOp` at all (D508), and
    // `scale?: DamageCountSource` — the field that WOULD create the carrier — stands
    // refused for the third time (D448/D449/D507).
    //
    // This walks every op object every producer in the repo emits and asserts that no
    // VALUE anywhere inside one is a `DamageCountSource`. The day `scale?` lands and a
    // producer sets it, this goes RED and the next member owes the bump.
    const programs: EffectOp[][] = [];
    for (const id of registryCardIds()) {
      const p = programFor(id);
      // `CardProgram` carries exactly ONE program map (`attack`, keyed by attack index)
      // — asked of the TYPE rather than assumed: an `ability` key here is a compile error.
      if (p?.attack !== undefined) programs.push(...Object.values(p.attack));
    }
    for (const [, text] of legalAttackCorpus()) {
      const derived = deriveAttackEffect(text);
      if (derived !== null) programs.push(derived as EffectOp[]);
    }
    expect(programs.length).toBeGreaterThan(100);
    const carriers: string[] = [];
    const visit = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((v, i) => visit(v, `${path}[${i}]`));
        return;
      }
      if (node === null || typeof node !== "object") return;
      const rec = node as Record<string, unknown>;
      const kind = rec.kind;
      // `op` separates an EffectOp (which also carries `kind` on some fields) from a
      // count: only a bare `{kind: …}` object whose kind is one of the twenty qualifies.
      if (typeof kind === "string" && kind in COUNT_KINDS && rec.op === undefined) {
        carriers.push(`${path}.kind = ${kind}`);
      }
      for (const [k, v] of Object.entries(rec)) visit(v, `${path}.${k}`);
    };
    programs.forEach((p, i) => visit(p, `program[${i}]`));
    expect(carriers).toEqual([]);
  });

  it("🛑 the reader SURFACE is unmoved at THIRTEEN, and the hand-kept list IS the module's", () => {
    // D419's guard. The COUNT is pinned separately from the diff, because a diff alone
    // stays green when a slice deletes a reader from the module and from this list in the
    // same commit.
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14 /* 🆕🆕🆕 D573: 13 → 14, + deriveAttackCopy */);
  });

  it("🛑 `FIXTURE_POOL` is BYTE-UNCHANGED — the demonstrator is a per-board clone", () => {
    // D414/D452: ZERO new fixture ids, so every `ids.length` ladder takes a ZERO term.
    // `fix-oxford` index 1 still prints its own sentence in the SHARED pool, and the whole
    // attack list is asserted rather than index 1 alone (D437: truncating an array is a
    // change a single-index read cannot see).
    expect(FIXTURE_POOL["fix-oxford"]?.attacks?.map((a) => a.effect)).toEqual([
      "Your opponent's Active Pokémon is now Burned, Confused, and Poisoned.",
      "Your opponent's Active Pokémon is now Burned, Confused, and Poisoned.",
      "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon.",
    ]);
  });

  it("the engine version moved with the behaviour, and `manifest.version` agrees", () => {
    expect(engineVersion).toBe("0.509.0");
    expect(manifest.version).toBe("0.509.0");
  });
});
