import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
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
  optionalCostBoostProgram,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import type { AttackOptionalCostBoost } from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { EffectOp, GameEvent, GameState, Seat } from "./index";
import { logFromEvents } from "./log";
import { redactGame } from "./redact";
import {
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  battler,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.410.0 → 0.411.0 — 🆕🆕🆕 D524: THE PURPOSE-CONNECTIVE OPTIONAL-COST BOOST WITH THE
// ALL-SELF-ENERGY-TO-HAND COST — ZERO VOCABULARY.
//
// *"You may put all Energy attached to this Pokémon into your hand to have this attack do 80 more
// damage."* — `censusAttackCorpus.ts` **FILE LINE 652** (`legalAttackCorpus()` index 599), **1
// sentence / 1 legal printing**, claimed by `deriveAttackOptionalCostBoost` through a SECOND SKELETON
// (`OPTIONAL_COST_PURPOSE_BOOST` — the purpose connective *"to have this attack do N more damage"*
// beside D381's *". If you do, "* skeleton) over ONE new cost-table row
// (`OPTIONAL_COST_PUT_ALL_SELF_ENERGY_TO_HAND`), deriving:
//
//     { cond: { kind: "yourActiveEnergyAtLeast", count: 1 },
//       ops: [ { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" },
//                count: "all", to: "hand" } ],
//       payoff: { kind: "moreDamage", bonus: 80 } }
//
// 🛑 **THE PRICE IS ONE ANCHOR PAIR, ONE COST ROW AND ONE ARM — ZERO NEW VOCABULARY.** The op is
// D405's arm (`PUT_SELF_ENERGY_TO_HAND`) with `count: "all"`; the gate is D383's member at `count:
// 1`; the payoff is D381's; the assembler (`optionalCostBoostProgram`) and `attack.ts`'s read site
// are UNCHANGED. No `interpreter.ts`, `attack.ts`, `types.ts`, `redact.ts`, `cardplay.ts`,
// `events.ts`, `log.ts` or projection byte, no reader (surface 13), registry row, `FIXTURE_POOL` id,
// prompt, event or schema byte. `MATCH_RECORD_VERSION` HELD at 30.
//
// 🛑 **`count: 1` IS NOT D385's "INVENTED ARITY".** It is the payability of `count: "all"` over
// `anyEnergy` — a NON-EMPTY set — the fact `yourHandNotEmpty` states nullarily for the hand; a new
// nullary member would be vocabulary for a fact a shipped member already answers
// (`countAttachedEnergy(state, pokemon, null)` is the unfiltered CARD count, false on an empty
// Active). §2 drives it: 0 Energy → NO question, the base is dealt, the turn ends.
//
// 🛑 **A SECOND SKELETON, NOT A THIRD CONNECTIVE.** The purpose spelling changes the payoff's VERB
// (*"do"* for *"does"*) and its punctuation, so `OPTIONAL_COST_PAYOFF_MORE_DAMAGE` is NOT widened to
// `(does|do)` (that would make *". If you do, this attack do N more damage."* readable — D190b): the
// bonus is captured by the purpose anchor and the `moreDamage` payoff is built inline. The COST goes
// through the SAME table, so every cost row transfers across both skeletons (D383's table
// composition — stated in §1, not special-cased).
//
// ⚠️ **THE PRINTING'S CARD CANNOT BE READ ON THIS CHECKOUT** — not in `FIXTURE_POOL`, no D1, no
// sqlite (D425/D523 (5)). The demonstrator is a FILE-LOCAL pool with its own 60-card deck and
// DECLARED base 40 / cost {C}; no id is invented. `fix-energy` (Colorless Basic) and `fix-special`
// (an unauthored Special) are the Energy.
//
// 🛑 **THE BASE IS INSIDE THE ARMS.** `attack.ts`'s `costBoostOwnsTheBase` is true for a
// `moreDamage` payoff, so no `DAMAGE_DEALT` lands before the confirm: the hit is `damageDefender
// (base + bonus)` in the YES arm and `damageDefender(base)` in the NO arm and in the gate's
// `otherwise` — measured in §2, not assumed. The boost folds PRE-Weakness (`boostedArms`): a Weak
// defender takes (40 + 80) × 2 = 240.

/** Corpus FILE LINE 652, byte for byte. */
const PRINTED =
  "You may put all Energy attached to this Pokémon into your hand to have this attack do 80 more damage.";
/** The same skeleton at a different bonus — the digit is CAPTURED, not pinned. Constructed. */
const at = (bonus: number): string => PRINTED.replace("do 80 more", `do ${bonus} more`);
/** D405's mandatory TAKEN — read by `deriveAttackEffect` and by NOTHING ELSE. */
const D405_TAKEN = "Put an Energy attached to this Pokémon into your hand.";
/** THIS cost under D381's finite skeleton — derives through table composition (constructed). */
const FINITE_SKELETON =
  "You may put all Energy attached to this Pokémon into your hand. If you do, this attack does 80 more damage.";
/** D385's cost under THIS skeleton — the same composition from the other side (constructed). */
const HAND_PURPOSE = "You may discard your hand to have this attack do 30 more damage.";
/** 🛑 THE A2 CONTROL: `does` for `do` — false on the real build, TRUE under
    `D498-resolution-compares-against-undefined` (every `null` re-read as a claim). */
const DOES_FOR_DO =
  "You may put all Energy attached to this Pokémon into your hand to have this attack does 80 more damage.";

const DISCARD_ALL_TO_HAND: EffectOp = {
  op: "discardEnergy",
  from: "yourActive",
  filter: { kind: "anyEnergy" },
  count: "all",
  to: "hand",
};

/** THE READING, spelled once at the captured bonus. */
const reading = (bonus: number): AttackOptionalCostBoost => ({
  cond: { kind: "yourActiveEnergyAtLeast", count: 1 },
  ops: [DISCARD_ALL_TO_HAND],
  payoff: { kind: "moreDamage", bonus },
});
const READING = reading(80);

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
  deriveAttackRequirement,
];
const SPLITTERS = [
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
];

const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);
const claims = (re: RegExp): readonly [number, number, readonly string[]] => {
  const rows = legalAttackCorpus().filter(([, s]) => re.test(s));
  return [rows.length, units(rows), rows.map(([, s]) => s)];
};

/** D381's census regex and the WIDE one `purgingStrike.test.ts` carries — both still EXCLUDE the
    row (no `. If ` in it), so the 7/14 and 8/15 partition rungs in those suites do not move. */
const NARROW = /^You may .*If you do,/;
const WIDE = /^You may .*\. If /;

// ─────────────────────────────────────────────────────────────────────────────
// The demonstrator — a FILE-LOCAL pool and its own deck (D414/D452/D520/D522/D523).
// ─────────────────────────────────────────────────────────────────────────────

/** DECLARED, not read: the printing's base is unresolvable here. 40 keeps the base, the boosted
    hit (120) and the Weak hit (240) pairwise distinguishable. */
const BASE = 40;
const BONUS = 80;
const PLAIN = "fix-energy";
const SPECIAL = "fix-special";

const ENERGY_TO_HAND_CARDS: Record<string, Card> = {
  "d524-charger": battler("d524-charger", {
    name: "D524 Charger",
    types: ["Lightning"],
    hp: 130,
    retreat: 2,
    attacks: [
      /** index 0 — the control: no effect, no program. */
      { cost: ["Colorless"], name: "Plain Jab", damage: 30 },
      /** index 1 — FILE LINE 652 verbatim, with a DECLARED base and cost. */
      { cost: ["Colorless"], name: "Volt Surrender", damage: BASE, effect: PRINTED },
      /** index 2 — the SAME sentence on a DECLARED cost-free print: the only way to stand an
          attacker with 0 Energy in front of the gate (the {C} print cannot be declared bare —
          `ATTACK_COST_UNMET`, measured in §2 (iv)). */
      { cost: [], name: "Free Volt Surrender", damage: BASE, effect: PRINTED },
    ],
  }),
  /** The defender — 400 HP, no W/R. */
  "d524-wall": battler("d524-wall", { name: "D524 Wall", types: ["Colorless"], hp: 400 }),
  /** The Weak defender — 400 HP, Weak ×2 to the attacker's Lightning: the pre-W/R fold rung. */
  "d524-weakwall": battler("d524-weakwall", {
    name: "D524 Weak Wall",
    types: ["Colorless"],
    hp: 400,
    weaknesses: [{ type: "Lightning", value: "×2" }],
  }),
};

const ENERGY_TO_HAND_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...ENERGY_TO_HAND_CARDS };

/** Its own deck (D270), 60 counted before the first run: 12 + 12 + 8 + 20 + 8. */
const ENERGY_TO_HAND_DECK = deckOf({
  "d524-charger": 12,
  "d524-wall": 12,
  "d524-weakwall": 8,
  [PLAIN]: 20,
  [SPECIAL]: 8,
});

/** Nothing in this program draws on the rng (no coin, no shuffle, no deck search), so the seed
    describes the opening shuffle only. Stated (D523 (8)). */
const SEED = 11;

function openTable(seed: number, first: Seat): GameState {
  const created = createGame({
    seed,
    decks: { p1: ENERGY_TO_HAND_DECK, p2: ENERGY_TO_HAND_DECK },
    cardPool: ENERGY_TO_HAND_POOL,
  });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let table = created.state;
  if (table.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  table = must(applyAction(table, { type: "chooseFirstPlayer", seat: table.phase.coinWinner, first }));
  while (table.phase.kind === "setup:drawExtra") {
    const drawing = table.phase;
    const owing = (["p1", "p2"] as const).find((s) => !drawing.decided[s]);
    if (owing === undefined) throw new Error("setup:drawExtra with every seat decided");
    table = must(applyAction(table, { type: "setupDrawExtra", seat: owing, count: drawing.owed[owing] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    table = must(applyAction(table, { type: "setupPlaceActive", seat, uid: firstBasicInHand(table, seat) }));
  }
  for (const seat of ["p1", "p2"] as const) {
    table = must(applyAction(table, { type: "setupReady", seat }));
  }
  return table;
}

type Board = {
  /** Colorless Basic Energy attached to P1's attacker. Default 2. */
  readonly plain?: number;
  /** Unauthored Special Energy attached beside them. Default 0. */
  readonly special?: number;
  /** The Weak defender instead of the plain wall. */
  readonly weak?: boolean;
};

/** p1 owns TURN 2 with the attacker Active; P2 went first. The attacker holds `plain` Colorless
    Basic + `special` Special Energy; the defender is the plain wall or the Weak one. */
function table(board: Board = {}): GameState {
  let state = openTable(SEED, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  if (state.turn !== 2) throw new Error(`expected turn 2, got ${String(state.turn)}`);
  state = setActiveFromDeck(state, "p1", "d524-charger");
  state = setActiveFromDeck(state, "p2", board.weak === true ? "d524-weakwall" : "d524-wall");
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  const plain = board.plain ?? 2;
  if (plain > 0) state = attachFromDeck(state, "p1", PLAIN, plain);
  const special = board.special ?? 0;
  if (special > 0) state = attachFromDeck(state, "p1", SPECIAL, special);
  return state;
}

type Swing = { before: GameState; after: GameState; events: GameEvent[] };

function swing(board: Board = {}, index = 1): Swing {
  const before = table(board);
  const { state: after, events } = mustApply(before, { type: "attack", seat: "p1", index });
  return { before, after, events };
}

function confirmPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "confirm") {
    throw new Error(`expected confirm, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

/** `optionalCostBoost.test.ts`'s idiom: answer the parked confirm. */
const say = (state: GameState, yes: boolean) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes } });

const attached = (state: GameState): readonly string[] => state.players.p1.active?.energy ?? [];

const NAMES = { p1: "P1", p2: "P2" } as const;
const rows = (events: readonly GameEvent[], state: GameState): string[] =>
  logFromEvents(events, { names: NAMES, state, elapsed: "+00:09" }).map((entry) =>
    entry.kind === "turn" ? `— turn ${entry.turn} —` : entry.segments.map((s) => s.text).join(""),
  );

function discardedRows(events: readonly GameEvent[]) {
  return events.filter(
    (e): e is Extract<GameEvent, { type: "ENERGY_DISCARDED" }> => e.type === "ENERGY_DISCARDED",
  );
}
function dealtRows(events: readonly GameEvent[]) {
  return events.filter((e): e is Extract<GameEvent, { type: "DAMAGE_DEALT" }> => e.type === "DAMAGE_DEALT");
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — derivation: the exact reading, the captured bonus, both anchor ends, the single-axis
// near-misses, table composition in both directions, the D405 twin, the only claimant, the census
// identity.
// ─────────────────────────────────────────────────────────────────────────────

describe("D524 §1 — the printed row derives to EXACTLY D405's op at `all` behind D383's gate at 1 with D381's payoff", () => {
  it("🛑 file line 652 derives to the reading — cond, the ONE op (count `all`, to `hand`), payoff `moreDamage 80` (`D524-cost-row-drops-all` / `-drops-hand` / `-gate-copies-the-stadium-row` / `-gate-count-zero`)", () => {
    expect(deriveAttackOptionalCostBoost(PRINTED)).toEqual(READING);
    const got = deriveAttackOptionalCostBoost(PRINTED);
    if (got === null) throw new Error("the row derived null");
    expect(got.ops).toHaveLength(1);
    expect(Object.keys(got.ops[0] ?? {}).sort()).toEqual(["count", "filter", "from", "op", "to"]);
    expect(got.cond).toEqual({ kind: "yourActiveEnergyAtLeast", count: 1 });
    expect(got.payoff).toEqual({ kind: "moreDamage", bonus: 80 });
    // The op is D405's arm with `count: "all"` — measured against the D405 derivation, not quoted.
    const [d405] = deriveAttackEffect(D405_TAKEN) as EffectOp[];
    expect(got.ops[0]).toEqual({ ...d405, count: "all" });
  });

  it("🛑 the bonus is CAPTURED, not pinned — 30 and 120 derive at 30 and 120; a printed 0 derives null (`D524-purpose-bonus-zero-derives`)", () => {
    expect(deriveAttackOptionalCostBoost(at(30))).toEqual(reading(30));
    expect(deriveAttackOptionalCostBoost(at(120))).toEqual(reading(120));
    expect(deriveAttackOptionalCostBoost(at(0))).toBeNull();
    expect(resolvedByAnyReader(at(0))).toBe(false);
    for (const s of [at(30), at(120), at(0)]) expect(legalAttackCorpus().some(([, t]) => t === s), s).toBe(false);
  });

  it("🛑 the purpose anchor is WHOLE-SENTENCE at BOTH ends — a prefixed print and a suffixed print each derive null (D520 (3); `D524-purpose-anchor-loses-the-head` / `-tail`)", () => {
    const prefixed = `Draw a card. ${PRINTED}`;
    const suffixed = `${PRINTED} Draw a card.`;
    expect(legalAttackCorpus().some(([, s]) => s === prefixed || s === suffixed)).toBe(false);
    expect(deriveAttackOptionalCostBoost(prefixed)).toBeNull();
    expect(deriveAttackOptionalCostBoost(suffixed)).toBeNull();
    expect(resolvedByAnyReader(prefixed)).toBe(false);
    expect(resolvedByAnyReader(suffixed)).toBe(false);
  });

  it("🛑 single-axis near-misses, ONE token apart each, all null on the real build — `an` for `all`, `discard` for `put`, the deck, `does` for `do`, the opponent's Active, and the cost anchor's `$` (`D524-cost-row-anchor-loses-the-tail` / `-purpose-anchor-takes-the-finite-verb`)", () => {
    const controls: Record<string, string> = {
      "`an` for `all` — the D405 quantifier under the purpose connective (no row spells it)":
        "You may put an Energy attached to this Pokémon into your hand to have this attack do 80 more damage.",
      "`discard` for `put` — the verb is a literal":
        "You may discard all Energy attached to this Pokémon into your hand to have this attack do 80 more damage.",
      "`into your deck` for `into your hand` — the destination is a literal (the D383 row shuffles a COUNT)":
        "You may put all Energy attached to this Pokémon into your deck to have this attack do 80 more damage.",
      "`does` for `do` — the finite verb exists only under the finite skeleton (THE A2 CONTROL)": DOES_FOR_DO,
      "`your opponent's Active Pokémon` for `this Pokémon` — the subject is a literal":
        "You may put all Energy attached to your opponent's Active Pokémon into your hand to have this attack do 80 more damage.",
      "`… into your hand and draw a card` — the cost anchor's `$` (`D524-cost-row-anchor-loses-the-tail`)":
        "You may put all Energy attached to this Pokémon into your hand and draw a card to have this attack do 80 more damage.",
    };
    for (const [why, s] of Object.entries(controls)) {
      expect(s, why).not.toBe(PRINTED);
      expect(deriveAttackOptionalCostBoost(s), why).toBeNull();
      expect(resolvedByAnyReader(s), why).toBe(false);
      expect(legalAttackCorpus().some(([, t]) => t === s), why).toBe(false);
    }
  });

  it("⚠️ TABLE COMPOSITION, stated in BOTH directions (D383/D421): this cost under the FINITE skeleton derives the SAME reading, and D385's hand cost under the PURPOSE skeleton derives its own — neither is special-cased", () => {
    expect(deriveAttackOptionalCostBoost(FINITE_SKELETON)).toEqual(READING);
    expect(deriveAttackOptionalCostBoost(HAND_PURPOSE)).toEqual({
      cond: { kind: "yourHandNotEmpty" },
      ops: [{ op: "discardHand" }],
      payoff: { kind: "moreDamage", bonus: 30 },
    });
    // 0 legal attack printings spell either — the transfer is a property of the tables.
    for (const s of [FINITE_SKELETON, HAND_PURPOSE]) {
      expect(legalAttackCorpus().some(([, t]) => t === s), s).toBe(false);
    }
  });

  it("🛑 D405's mandatory TAKEN still derives ONLY through `deriveAttackEffect` — this reader returns null on it, and the D405 arm returns null on the row", () => {
    expect(deriveAttackEffect(D405_TAKEN)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, to: "hand" },
    ]);
    expect(deriveAttackOptionalCostBoost(D405_TAKEN)).toBeNull();
    expect(deriveAttackEffect(PRINTED)).toBeNull();
    expect(legalAttackCorpus().filter(([, s]) => s === D405_TAKEN).map(([n]) => n)).toEqual([5]);
  });

  it("🛑 `deriveAttackOptionalCostBoost` is the ONLY claimant — twelve readers and four splitters are null — and the reader surface is still THIRTEEN", () => {
    for (const reader of READERS) {
      if (reader === deriveAttackOptionalCostBoost) continue;
      expect(reader(PRINTED), reader.name).toBeNull();
    }
    for (const splitter of SPLITTERS) expect(splitter(PRINTED), splitter.name).toBeNull();
    expect(deriveAttackOptionalCostBoost(PRINTED)).not.toBeNull();
    expect(attackReaderSurface()).toHaveLength(13);
    expect(attackReaderSurface()).toContain("deriveAttackOptionalCostBoost");
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
  });

  it("🛑 the sentence is the CORPUS's bytes at exactly ONE printing, at index 599, it is RESOLVED, and the raw file line IS 652", () => {
    const corpus = legalAttackCorpus();
    expect(corpus.filter(([, s]) => s === PRINTED)).toEqual([[1, PRINTED]]);
    expect(corpus.findIndex(([, s]) => s === PRINTED)).toBe(599);
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    const raw = Object.entries(RAW).find(([k]) => k.endsWith("/censusAttackCorpus.ts"))?.[1] ?? "";
    expect(raw.split("\n")[651]).toBe(`1 ${PRINTED}`);
  });

  it("🛑 the purpose anchor's claimed set over all 640 rows is EXACTLY {file line 652}; D381's NARROW 7/14 and the WIDE 8/15 census regexes still EXCLUDE it, so `optionalCostBoost.test.ts` / `purgingStrike.test.ts`'s partitions do not move", () => {
    const [n, u, claimed] = claims(/^You may (.+) to have this attack do (\d+) more damage\.$/);
    expect([n, u]).toEqual([1, 1]);
    expect(claimed).toEqual([PRINTED]);
    expect(claims(/to have this attack/).slice(0, 2)).toEqual([1, 1]);
    expect(legalAttackCorpus()).toHaveLength(640);
    expect(NARROW.test(PRINTED)).toBe(false);
    expect(WIDE.test(PRINTED)).toBe(false);
    expect(claims(NARROW).slice(0, 2)).toEqual([7, 14]);
    expect(claims(WIDE).slice(0, 2)).toEqual([8, 15]);
    // …and the reader's whole domain over the column is those regexes' readable members PLUS
    // this row: 3 / 8 under the finite skeleton, 1 / 1 under the purpose one.
    const read = legalAttackCorpus().filter(([, s]) => deriveAttackOptionalCostBoost(s) !== null);
    expect([read.length, units(read)]).toEqual([4, 9]);
    expect(read.map(([, s]) => s)).toContain(PRINTED);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the executor: the gate, the confirm, YES, NO, the empty Active, one Energy, Weakness, the
// log, the redacted view, the control, and a Special beside a Basic.
// ─────────────────────────────────────────────────────────────────────────────

describe("D524 §2 — the gate asks only on a non-empty Active, the confirm holds the hit, YES moves every Energy to the hand BEFORE the boosted hit", () => {
  it("🛑 the assembled program is `optionalCostBoostProgram`'s UNCHANGED shape: gate → confirm{ [all→hand, 120] / [40] } / [40]", () => {
    expect(optionalCostBoostProgram(READING, BASE, PRINTED)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "yourActiveEnergyAtLeast", count: 1 },
        // biome-ignore lint/suspicious/noThenProperty: the effect contract's gated-step list, not a thenable.
        then: [
          {
            op: "optional",
            note: PRINTED,
            // biome-ignore lint/suspicious/noThenProperty: the effect contract's accepted-arm list, not a thenable.
            then: [DISCARD_ALL_TO_HAND, { op: "damageDefender", amount: BASE + BONUS }],
            otherwise: [{ op: "damageDefender", amount: BASE }],
          },
        ],
        otherwise: [{ op: "damageDefender", amount: BASE }],
      },
    ]);
  });

  it("🛑 the board is what it says: P1's attacker is Active with two Colorless Basic, P2's wall is Active, both benches empty, turn 2", () => {
    const before = table();
    expect(attached(before)).toHaveLength(2);
    for (const uid of attached(before)) expect(before.cardIdByUid[uid]).toBe(PLAIN);
    expect(before.cardIdByUid[activeUid(before, "p2")]).toBe("d524-wall");
    expect(before.players.p1.bench).toHaveLength(0);
    expect(before.players.p2.bench).toHaveLength(0);
    expect(before.turn).toBe(2);
    expect(ENERGY_TO_HAND_CARDS["d524-charger"]?.attacks?.[1]?.effect).toBe(PRINTED);
    expect(ENERGY_TO_HAND_CARDS["d524-charger"]?.attacks?.[1]?.damage).toBe(BASE);
  });

  it("🛑 (i) 2 Energy attached → the gate passes and the CONFIRM parks: `effect:choose`, `confirm`, note === the whole printed sentence, and NO `DAMAGE_DEALT` yet (the hit is inside the arms — MEASURED)", () => {
    const { before, after, events } = swing();
    expect(after.phase.kind).toBe("effect:choose");
    const prompt = confirmPrompt(after);
    expect(prompt.note).toBe(PRINTED);
    expect(after.phase.kind === "effect:choose" && after.phase.seat).toBe("p1");
    expect(types(events)).toContain("ATTACK_DECLARED");
    expect(dealtRows(events)).toHaveLength(0);
    expect(after.players.p2.active?.damage).toBe(0);
    expect(discardedRows(events)).toHaveLength(0);
    expect(types(events)).not.toContain("TURN_ENDED");
    // Nothing moved at the park: the Energy is still attached, the hand is unchanged.
    expect(attached(after)).toEqual(attached(before));
    expect(after.players.p1.hand).toEqual(before.players.p1.hand);
  });

  it("🛑 (ii) YES: both Energy uids move to P1's HAND, the attacker holds 0, `ENERGY_DISCARDED { to: \"hand\" }` comes BEFORE `DAMAGE_DEALT`, the hit is 120 (base + 80), the turn ends (D491)", () => {
    const { after: parked } = swing();
    const moved = [...attached(parked)];
    const { state, events } = say(parked, true);
    expect(state.players.p1.hand).toHaveLength(parked.players.p1.hand.length + 2);
    for (const uid of moved) expect(state.players.p1.hand).toContain(uid);
    expect(attached(state)).toHaveLength(0);
    expect(state.players.p1.discard).toEqual(parked.players.p1.discard);
    const discarded = discardedRows(events);
    expect(discarded).toHaveLength(1);
    expect(discarded[0]).toMatchObject({ seat: "p1", actor: "p1", to: "hand", from: { spot: "active" } });
    expect([...(discarded[0]?.uids ?? [])].sort()).toEqual([...moved].sort());
    const dealt = dealtRows(events);
    expect(dealt).toHaveLength(1);
    expect(dealt[0]).toMatchObject({ seat: "p2", by: "p1", uid: activeUid(parked, "p2"), dealt: BASE + BONUS });
    expect(types(events).indexOf("ENERGY_DISCARDED")).toBeLessThan(types(events).indexOf("DAMAGE_DEALT"));
    expect(state.players.p2.active?.damage).toBe(BASE + BONUS);
    expect(types(events)).toContain("TURN_ENDED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(state.turn).toBe(3);
  });

  it("🛑 (iii) NO: the base 40 only, the hand unchanged, both Energy still attached, no `ENERGY_DISCARDED`, the turn ends", () => {
    const { after: parked } = swing();
    const { state, events } = say(parked, false);
    expect(state.players.p1.hand).toEqual(parked.players.p1.hand);
    expect(attached(state)).toEqual(attached(parked));
    expect(discardedRows(events)).toHaveLength(0);
    const dealt = dealtRows(events);
    expect(dealt).toHaveLength(1);
    expect(dealt[0]?.dealt).toBe(BASE);
    expect(state.players.p2.active?.damage).toBe(BASE);
    expect(types(events)).toContain("TURN_ENDED");
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 (iv) 0 Energy attached → NO prompt (the gate refuses the question — `D524-gate-count-zero` asks it), the base 40 is dealt, no `ENERGY_DISCARDED`, the turn ends — driven through the DECLARED cost-free print, because the {C} print cannot be declared bare (MEASURED: `ATTACK_COST_UNMET`)", () => {
    // ⚠️ THE GATE'S FALSE ARM IS UNREACHABLE FOR THE COSTED PRINT, AND THAT IS STATED RATHER THAN
    // HIDDEN: an attack costing {C} needs one Energy CARD attached, and one card is `count: 1`.
    // The gate is the cost's PAYABILITY stated for the table's obligation (D385's connective
    // block: necessary AND sufficient), not a board this print reaches — the same shape as the
    // D385 hand row's `yourHandNotEmpty` on a hand that always holds the card just drawn.
    const bare = table({ plain: 0 });
    const refused = applyAction(bare, { type: "attack", seat: "p1", index: 1 });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("the {C} print was declared with no Energy attached");
    expect(refused.error.code).toBe("ATTACK_COST_UNMET");
    const { before, after, events } = swing({ plain: 0 }, 2);
    expect(attached(before)).toHaveLength(0);
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(discardedRows(events)).toHaveLength(0);
    expect(dealtRows(events)).toHaveLength(1);
    expect(after.players.p2.active?.damage).toBe(BASE);
    expect(after.players.p1.hand).toEqual(before.players.p1.hand);
    expect(types(events)).toContain("TURN_ENDED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 (v) 1 Energy attached → the question IS asked (the gate is `>= 1`, not `> 1`), YES moves that one uid to the hand and deals 120", () => {
    const { before, after } = swing({ plain: 1 });
    expect(attached(before)).toHaveLength(1);
    expect(confirmPrompt(after).note).toBe(PRINTED);
    const [only] = attached(after);
    const { state, events } = say(after, true);
    expect(state.players.p1.hand).toHaveLength(after.players.p1.hand.length + 1);
    expect(state.players.p1.hand).toContain(only);
    expect(attached(state)).toHaveLength(0);
    expect(discardedRows(events).map((e) => e.uids)).toEqual([[only]]);
    expect(state.players.p2.active?.damage).toBe(BASE + BONUS);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 (vi) a Weak defender, YES → (40 + 80) × 2 = 240: the boost folds PRE-Weakness (`boostedArms`), and NO → 40 × 2 = 80", () => {
    const { after: parked } = swing({ weak: true });
    expect(parked.cardIdByUid[activeUid(parked, "p2")]).toBe("d524-weakwall");
    const yes = say(parked, true);
    expect(yes.state.players.p2.active?.damage).toBe((BASE + BONUS) * 2);
    expect(dealtRows(yes.events)[0]?.dealt).toBe(240);
    const no = say(swing({ weak: true }).after, false);
    expect(no.state.players.p2.active?.damage).toBe(BASE * 2);
  });

  it("🛑 (vii) the log row for the move reads \"put … into P1's hand\" (`log.ts`'s hand arm), NOT \"discarded\" (`D524-cost-row-drops-hand`), and the damage row follows it", () => {
    const { after: parked } = swing();
    const { state, events } = say(parked, true);
    const lines = rows(events, state);
    // MEASURED, not assumed: the `to: "hand"` arm of `log.ts`'s ENERGY_DISCARDED row.
    const put = lines.indexOf("put fix-energy ×2 from P1's D524 Charger into P1's hand");
    expect(put).toBeGreaterThanOrEqual(0);
    expect(lines.some((r) => r.includes("discarded"))).toBe(false);
    const hit = lines.indexOf("dealt 120 damage to D524 Wall");
    expect(hit).toBeGreaterThan(put);
    expect(lines).toContain("ended their turn");
  });

  it("🛑 (viii) the OPPONENT's redacted view after YES: P1's hand grew by 2 face-down backs and names none of them; the ENERGY_DISCARDED row is what named the moved (public) Energy", () => {
    const { after: parked } = swing();
    const { state, events } = say(parked, true);
    // From P2's seat, P1 is `board.opponent`.
    const before = redactGame(parked, "p2");
    const after = redactGame(state, "p2");
    expect(after.board.opponent.hand).toHaveLength(before.board.opponent.hand.length + 2);
    const ownNames = new Set(Object.values(ENERGY_TO_HAND_POOL).map((c) => c.name));
    for (const card of after.board.opponent.hand) expect(ownNames.has(card.name), card.name).toBe(false);
    // …while P1's own view names them: the two uids are face-up in `board.you.hand`.
    const mine = redactGame(state, "p1");
    expect(mine.board.you.hand.filter((c) => c.name === PLAIN)).toHaveLength(
      redactGame(parked, "p1").board.you.hand.filter((c) => c.name === PLAIN).length + 2,
    );
    // …and the event that names the cards is the public one.
    expect(discardedRows(events)[0]?.uids).toHaveLength(2);
  });

  it("🛑 (ix) the index-0 control: no prompt, no `ENERGY_DISCARDED`, 30 dealt, the Energy stays attached, the turn ends", () => {
    const { before, after, events } = swing({}, 0);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(discardedRows(events)).toHaveLength(0);
    expect(after.players.p2.active?.damage).toBe(30);
    expect(attached(after)).toEqual(attached(before));
    expect(after.players.p1.hand).toEqual(before.players.p1.hand);
  });

  it("🛑 (x) a Special Energy attached beside a Basic → BOTH move (filter `anyEnergy`, `count: \"all\"` — `D524-cost-row-drops-all` would move ONE and park nothing on identical prints)", () => {
    const { before, after } = swing({ plain: 1, special: 1 });
    expect(attached(before)).toHaveLength(2);
    expect(attached(before).map((uid) => before.cardIdByUid[uid]).sort()).toEqual([PLAIN, SPECIAL].sort());
    expect(confirmPrompt(after).note).toBe(PRINTED);
    const moved = [...attached(after)];
    const { state, events } = say(after, true);
    // ONE park only: the `"all"` discard resolves inline, so the confirm's YES drains the tail.
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(attached(state)).toHaveLength(0);
    for (const uid of moved) expect(state.players.p1.hand).toContain(uid);
    expect([...(discardedRows(events)[0]?.uids ?? [])].sort()).toEqual([...moved].sort());
    expect(state.players.p2.active?.damage).toBe(BASE + BONUS);
    expect(FIXTURE_POOL[SPECIAL]?.category).toBe("Energy");
  });

  it("🛑 the confirm is the program's ONLY park on every board above — after YES the phase is never `effect:choose` again (`D524-cost-row-count-any` would park a SECOND, declinable pick on top of the confirm)", () => {
    for (const board of [{}, { plain: 1 }, { plain: 1, special: 1 }, { weak: true }] as const) {
      const { after } = swing(board);
      const { state } = say(after, true);
      expect(state.phase.kind, JSON.stringify(board)).toBe("turn:action");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the census figures, with their units.
// ─────────────────────────────────────────────────────────────────────────────

describe("D524 §3 — the census moved in exactly ONE summand, by 1 sentence / 1 printing", () => {
  it("🛑 the reader arm reads 551 sentences / 1,592 printings, and the row is IN it", () => {
    // 🆕🆕🆕 D524's OWN literals, annotated in-slice so the next sweep sees them (D523 (4)): the
    // reader arm 550/1591 → 551/1592, the `without` pair 549/1590 → 550/1591 — corpus FILE LINE
    // 652, sentence step == printing step == 1.
    const resolved = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    expect([resolved.length, units(resolved)]).toEqual([551, 1592]);
    expect(resolved.map(([, s]) => s)).toContain(PRINTED);
    // …and the step is THIS sentence and nothing else: remove it and the pair is D523's.
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([without.length, units(without)]).toEqual([550, 1591]);
  });

  it("🛑 the RAW reader-only residue fell by exactly 1 sentence / 1 printing — 89 / 140 — and the row left it", () => {
    // 🆕🆕🆕 D524's OWN literal (corpus FILE LINE 652, see §3's first rung): 90/141 → 89/140.
    const unbuilt = legalAttackCorpus().filter(([, s]) => !resolvedByAnyReader(s));
    expect([unbuilt.length, units(unbuilt)]).toEqual([89, 140]);
    expect(unbuilt.map(([, s]) => s)).not.toContain(PRINTED);
    // The parts add up to the whole quoted in the same case.
    const all = legalAttackCorpus();
    expect(unbuilt.length + 551).toBe(all.length);
    expect(units(unbuilt) + 1592).toBe(units(all));
    expect([all.length, units(all)]).toEqual([640, 1732]);
  });

  it("🛑 the move is READER-keyed: no gate clause, no trailing split, no cancel split, no requirement split claims the row", () => {
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the version, the heading, the corrected prose, and what stands still.
// ─────────────────────────────────────────────────────────────────────────────

const RAW: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string,
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob("./{censusAttackCorpus,index,effects}.ts", { query: "?raw", import: "default", eager: true });

describe("D524 §4 — the version steps, the heading is written, the prose is corrected, and what stands still", () => {
  it("engineVersion and `manifest.version` agree, and the bump is owed for BEHAVIOUR", () => {
    // ⚠️ The version is NOT spelled in this `it(…)` title (D460's fourth class).
    expect(engineVersion).toBe("0.411.0");
    expect(manifest.version).toBe(engineVersion);
  });

  it("🛑 the changelog heading for this bump is present in `index.ts`, labelled with its decision", () => {
    const index = Object.entries(RAW).find(([k]) => k.endsWith("/index.ts"))?.[1] ?? "";
    expect(index.length).toBeGreaterThan(1_000_000);
    expect(index).toContain("engineVersion 0.410.0 → **0.411.0** (D524");
  });

  it("🛑 the prose is corrected IN PLACE in `effects.ts` (D178/D442): the D405 anchor's block names the one reader over, the connective block carries the second skeleton, the cost table names its fourth row; the payoff table is NOT widened to `(does|do)`", () => {
    const effects = Object.entries(RAW).find(([k]) => k.endsWith("/effects.ts"))?.[1] ?? "";
    expect(effects).toContain("D524 — STILL TRUE OF THIS ANCHOR, AND THE COMPOUND IS BUILT ONE READER OVER");
    expect(effects).toContain("D524 — A SECOND SKELETON, NOT A THIRD CONNECTIVE");
    expect(effects).toContain("D524 — THE FOURTH ROW, AND IT BUYS NO OP AND NO GATE MEMBER");
    expect(effects).toContain("const OPTIONAL_COST_PAYOFF_MORE_DAMAGE = /^this attack does (\\d+) more damage\\.$/;");
    expect(effects).toContain('const OPTIONAL_COST_CONNECTIVE = "(?:If you do|If you discarded any cards in this way)";');
    // The purpose anchor and the cost anchor, byte for byte.
    expect(effects).toContain("const OPTIONAL_COST_PURPOSE_BOOST = /^You may (.+) to have this attack do (\\d+) more damage\\.$/;");
    expect(effects).toContain("const OPTIONAL_COST_PUT_ALL_SELF_ENERGY_TO_HAND = /^put all Energy attached to this Pokémon into your hand$/;");
  });

  it("🛑 `MATCH_RECORD_VERSION` HOLDS at 30: zero new serialized bytes — the reading and the program round-trip unchanged, and the park is D381's shipped confirm", () => {
    // Every kind, field and value already ships: `discardEnergy { count: "all", to: "hand" }`
    // (D361's `"all"`, D295's `to`), `yourActiveEnergyAtLeast` (D383), `optional` (D316),
    // `conditionGate`, `damageDefender`. A v30 deploy could already have written every byte.
    expect(JSON.parse(JSON.stringify(READING))).toEqual(READING);
    const program = optionalCostBoostProgram(READING, BASE, PRINTED);
    expect(JSON.parse(JSON.stringify(program))).toEqual(program);
    const { after } = swing();
    const prompt = confirmPrompt(after);
    expect(JSON.parse(JSON.stringify(prompt))).toEqual(prompt);
  });

  it("🛑 the demonstrator is FILE-LOCAL — zero `FIXTURE_POOL` ids, the deck is 60, the Energy are the shared pool's Colorless Basic and unauthored Special", () => {
    expect(Object.keys(ENERGY_TO_HAND_CARDS).every((id) => FIXTURE_POOL[id] === undefined)).toBe(true);
    expect(ENERGY_TO_HAND_DECK).toHaveLength(60);
    expect(FIXTURE_POOL[PLAIN]?.name).toBe(PLAIN);
    expect(FIXTURE_POOL[SPECIAL]?.name).toBe(SPECIAL);
  });
});
