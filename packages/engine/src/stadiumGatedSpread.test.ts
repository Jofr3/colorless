import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { programPlayable } from "./cardplay";
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
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { EffectOp, GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  types,
} from "./testFixtures";

// 0.408.0 → 0.409.0 — 🆕🆕🆕 D522: THE STADIUM-GATED BENCH SPREAD WITH THE STADIUM DISCARD — ZERO
// VOCABULARY, AND A REFUSAL THAT WAS RIGHT ABOUT THE OP AND WRONG ABOUT THE READER.
//
// *"If a Stadium is in play, this attack also does 30 damage to each of your opponent's Benched
// Pokémon, and discard that Stadium. (Don't apply Weakness and Resistance for Benched Pokémon.)"*
// — Ting-Lu `sv06-110` "Ground Crasher", `censusAttackCorpus.ts` **FILE LINE 293**
// (`legalAttackCorpus()` index 240), **1 sentence / 1 legal printing**, claimed by
// `deriveAttackEffect` through ONE new anchor (`STADIUM_GATED_BENCH_SPREAD`, directly under
// D380's `MAY_DISCARD_STADIUM`) and ONE new arm directly after arm 43 (43-bis), deriving THREE
// SHIPPED ops in arm 43's exact shape minus the `optional`:
//
//     [ { op: "conditionGate", cond: { kind: "stadiumInPlay" },
//         then: [ { op: "spreadDamage", target: "opponentBench", amount: 30 },
//                 { op: "discardStadium" } ] } ]
//
// 🛑 **THE PRICE IS ONE ANCHOR AND ONE ARM — ZERO NEW VOCABULARY.** `conditionGate` is D111's,
// `stadiumInPlay` D378's, `spreadDamage {opponentBench}` D134/D425's, `discardStadium` D380's; no
// `interpreter.ts` byte, no `attack.ts` byte, no reader (surface 13), registry row, `FIXTURE_POOL`
// id, prompt, event or schema byte. The `then` is BYTE-EQUAL to the two halves' own derivations
// concatenated in printed order (§1 measures both halves rather than quoting them).
//
// 🛑 **THE REFUSAL WAS RIGHT ABOUT THE OP AND WRONG ABOUT THE READER.** The row sat in
// `stadiumDiscard.test.ts`'s `STILL_OWED`, `stadiumPresence.test.ts`'s `CEILING` and `index.ts`'s
// D382 block under *"needs a bonus-consequent reader as well as the op"* / *"claims 1/1 and leaves
// 1/1"*. Both halves had shipped by D382; the reader named was the wrong carrier: the middle clause
// is a SECOND HIT — the body-set `spreadDamage` `deriveAttackEffect` has walked since D134 — never
// a bonus, so no `AttackBonusConsequent` join could read it at any spelling (D521 (2)'s rule: ask
// what the op HITS). `deriveAttackBonusConsequent` STAYS null on it; the `, and discard that
// Stadium` join is disjoint from the bonus readers' `more damage, and` / `more damage. Then, `.
// Three refusal families kept and INVERTED with D522 provenance (D436/D418) — see those files.
//
// 🛑 **THE BASE RULE — D521's "also" path.** The top-level op is a `conditionGate`, not
// `damageDefender`, so `attack.ts`'s top-level `programDamage` stays false and the printed base
// lands in §8.5 BEFORE the program; the spread and the discard run at the tail. §2 asserts the
// base row precedes every program row, the FLAT bench hit (a body Weak to the attacker takes 30,
// not 60), the discard to the OWNER's pile (P2's — D380 §3), and the bench KO swept by
// `finishAttack`'s two-seat `collectKnockOuts`.
//
// 🛑 **THE ORDER — SPREAD, THEN DISCARD — IS PRINTED AND UNOBSERVABLE ON EVERY LEGAL BOARD** (the
// D382 argument, re-run at the anchor): flat bench HP, Neutralization Zone `sv06.5-060` only bites
// an attacking ex, and a vacated `hpDelta` Stadium lowers a maximum the epilogue checks AFTER the
// whole program. It is pinned in the ASSEMBLED PROGRAM by §1's `toEqual` (D382's route), which is
// the ONE rung the swapped-order mutant (`D522-gated-spread-then-order-swapped`) is declared
// killed by; §2 deliberately does NOT assert the spread rows' position against the discard row.
//
// ⚠️ **TING-LU `sv06-110`'s PRINTED BASE AND COST CANNOT BE READ ON THIS CHECKOUT** — it is not in
// `FIXTURE_POOL` (asserted in §4) and there is no D1 and no sqlite here (D425/D521 (5)). The
// demonstrator is a FILE-LOCAL pool with its own 60-card deck and DECLARED values (D414/D452/D520's
// shape); no id is invented.

/** Corpus FILE LINE 293, byte for byte. */
const PRINTED =
  "If a Stadium is in play, this attack also does 30 damage to each of your opponent's Benched Pokémon, and discard that Stadium. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** The same shape at a different N — the amount is CAPTURED, not pinned (C9). Constructed. */
const FIFTY =
  "If a Stadium is in play, this attack also does 50 damage to each of your opponent's Benched Pokémon, and discard that Stadium. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** The two BARE halves, each a REAL printed sentence read by `deriveAttackEffect` long before this
    slice — the `then` is their derivations concatenated. */
const BARE_SPREAD =
  "This attack also does 30 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const BARE_DISCARD = "Discard a Stadium in play.";
/** The family's other two `^If a Stadium is in play` rows — FILE LINES 294 and 295 — each
    another reader's. */
const MELTER_TEXT =
  "If a Stadium is in play, this attack does 60 more damage. Then, discard that Stadium.";
const BONUS_TEXT = "If a Stadium is in play, this attack does 70 more damage.";

/** THE PROGRAM, spelled once at the captured amount. */
const program = (amount: number): EffectOp[] => [
  {
    op: "conditionGate",
    cond: { kind: "stadiumInPlay" },
    // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
    then: [
      { op: "spreadDamage", target: "opponentBench", amount },
      { op: "discardStadium" },
    ],
  },
];
const PROGRAM = program(30);

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

// ─────────────────────────────────────────────────────────────────────────────
// The demonstrator — a FILE-LOCAL pool and its own deck (D414/D452/D520/D521).
// ─────────────────────────────────────────────────────────────────────────────

/** DECLARED, not read: Ting-Lu's printed base is unresolvable here. 100 keeps the base row
    distinguishable from the printed 30 on every log. */
const BASE = 100;
const SPREAD = 30;
const BEACH_COURT = "sv01-167";

const GATED_SPREAD_CARDS: Record<string, Card> = {
  "d522-crasher": battler("d522-crasher", {
    name: "D522 Crasher",
    types: ["Fighting"],
    hp: 130,
    retreat: 2,
    attacks: [
      /** index 0 — the control: no effect, no program. */
      { cost: ["Colorless"], name: "Plain Jab", damage: 30 },
      /** index 1 — FILE LINE 293 verbatim, with a DECLARED base so the base-lands-then-program
          path is driven (the BASE RULE). */
      { cost: ["Colorless"], name: "Ground Crasher", damage: BASE, effect: PRINTED },
    ],
  }),
  /** The SAME shape at 50 — the amount-not-pinned witness (C9). */
  "d522-fifty": battler("d522-fifty", {
    name: "D522 Fifty",
    types: ["Fighting"],
    hp: 130,
    retreat: 2,
    attacks: [
      { cost: ["Colorless"], name: "Plain Jab", damage: 30 },
      { cost: ["Colorless"], name: "Half Crasher", damage: 60, effect: FIFTY },
    ],
  }),
  /** The defender and the neutral benched body — 400 HP, no W/R. */
  "d522-wall": battler("d522-wall", { name: "D522 Wall", types: ["Colorless"], hp: 400 }),
  /** A benched body WEAK to the attacker — the flat-spread witness (30, not 60). */
  "d522-weakling": battler("d522-weakling", {
    name: "D522 Weakling",
    types: ["Lightning"],
    hp: 200,
    weaknesses: [{ type: "Fighting", value: "×2" }],
  }),
  /** A 60 HP benched body — pre-damaged to 30 it dies to the printed 30 exactly. */
  "d522-brittle": battler("d522-brittle", { name: "D522 Brittle", types: ["Colorless"], hp: 60 }),
};

const GATED_SPREAD_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...GATED_SPREAD_CARDS };

/** Its own deck (D270), 60 counted before the first run: 8 + 4 + 12 + 8 + 8 + 4 + 16. */
const GATED_SPREAD_DECK = deckOf({
  "d522-crasher": 8,
  "d522-fifty": 4,
  "d522-wall": 12,
  "d522-weakling": 8,
  "d522-brittle": 8,
  [BEACH_COURT]: 4,
  "fix-energy": 16,
});

/** Nothing in this program draws on the rng (no coin, no shuffle — §2 asserts it), so the seed
    describes the opening shuffle and nothing else (D143). */
const SEED = 11;

function openTable(seed: number, first: Seat): GameState {
  const created = createGame({
    seed,
    decks: { p1: GATED_SPREAD_DECK, p2: GATED_SPREAD_DECK },
    cardPool: GATED_SPREAD_POOL,
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

/** Put a Beach Court into `seat`'s hand and play it — `stadiumPresence.test.ts`'s idiom. The
    zone then carries `owner: seat`, which is what the discard's OWNER's-pile rung reads. */
function playStadium(state: GameState, seat: Seat): GameState {
  const withCard = handFromDeck(state, seat, BEACH_COURT, 1);
  const uid = handUid(withCard, seat, BEACH_COURT);
  return mustApply(withCard, { type: "playTrainer", seat, uid }).state;
}

type Board = {
  readonly attacker?: "d522-crasher" | "d522-fifty";
  /** P2 plays Beach Court on its own turn 1. Default PRESENT — the printed antecedent's yes arm. */
  readonly stadium?: boolean;
  /** The opponent's Bench, in order. Default a neutral body and a Weak one. */
  readonly oppBench?: readonly string[];
  /** Prior damage on the opponent's bench slot 0. */
  readonly benchDamage?: number;
  /** Bench one neutral body for the attacker — the own-Bench-untouched witness (C8). */
  readonly ownBench?: boolean;
};

/** p1 owns TURN 2 with the attacker Active; P2 went first and (by default) played the Stadium on
    its own turn. NONE of the surgeries touches `rngState`. */
function table(board: Board = {}): GameState {
  let state = openTable(SEED, "p2");
  if (board.stadium !== false) state = playStadium(state, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  if (state.turn !== 2) throw new Error(`expected turn 2, got ${String(state.turn)}`);
  state = setActiveFromDeck(state, "p1", board.attacker ?? "d522-crasher");
  state = setActiveFromDeck(state, "p2", "d522-wall");
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  for (const id of board.oppBench ?? ["d522-wall", "d522-weakling"]) state = benchFromDeck(state, "p2", id);
  if (board.ownBench) state = benchFromDeck(state, "p1", "d522-wall");
  if (board.benchDamage !== undefined) state = setBenchDamage(state, "p2", 0, board.benchDamage);
  return state;
}

type Swing = { before: GameState; after: GameState; events: GameEvent[] };

function swing(board: Board = {}, index = 1): Swing {
  const before = table(board);
  const { state: after, events } = mustApply(before, { type: "attack", seat: "p1", index });
  return { before, after, events };
}

function damageRows(events: readonly GameEvent[]) {
  return events.filter((e): e is Extract<GameEvent, { type: "DAMAGE_DEALT" }> => e.type === "DAMAGE_DEALT");
}

function stadiumRows(events: readonly GameEvent[]) {
  return events.filter(
    (e): e is Extract<GameEvent, { type: "STADIUM_DISCARDED" }> => e.type === "STADIUM_DISCARDED",
  );
}

/** The stack TOP of a benched body — `InPlayPokemon` carries no `uid` (D521 (8)). */
function benchUids(state: GameState, seat: Seat): string[] {
  return state.players[seat].bench.map((p) => {
    const top = p.stack[p.stack.length - 1];
    if (top === undefined) throw new Error("empty stack on the Bench");
    return top;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — derivation: the exact program, its key set, its `then`, the row's census identity, the
// reader partition of its family, and the negative controls.
// ─────────────────────────────────────────────────────────────────────────────

describe("D522 §1 — the printed row derives to EXACTLY arm 43's shape minus the `optional`", () => {
  it("🛑 file line 293 derives to the Stadium gate over [spread, discard] — and this `toEqual` is what pins the printed ORDER (`D522-gated-spread-then-order-swapped`)", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
  });

  it("🛑 the gate's sorted KEY SET is exactly [cond, op, then] — no `otherwise` (D135), and the spread carries no `damagedOnly` (D507's rider is not printed)", () => {
    const gate = (deriveAttackEffect(PRINTED) as EffectOp[])[0];
    if (gate?.op !== "conditionGate") throw new Error("op 0 is not a conditionGate");
    expect(Object.keys(gate).sort()).toEqual(["cond", "op", "then"]);
    expect(gate.otherwise).toBeUndefined();
    const [spread, discard] = gate.then;
    if (spread?.op !== "spreadDamage") throw new Error("then[0] is not a spreadDamage");
    if (discard?.op !== "discardStadium") throw new Error("then[1] is not a discardStadium");
    expect(Object.keys(spread).sort()).toEqual(["amount", "op", "target"]);
    expect(Object.keys(discard)).toEqual(["op"]);
    expect(gate.then).toHaveLength(2);
  });

  it("🛑 the `then` is BYTE-EQUAL to the two bare halves' OWN derivations, concatenated in printed order (measured, not quoted)", () => {
    const gate = (deriveAttackEffect(PRINTED) as EffectOp[])[0];
    if (gate?.op !== "conditionGate") throw new Error("op 0 is not a conditionGate");
    const spread = deriveAttackEffect(BARE_SPREAD);
    const discard = deriveAttackEffect(BARE_DISCARD);
    expect(spread).toEqual([{ op: "spreadDamage", target: "opponentBench", amount: 30 }]);
    expect(discard).toEqual([{ op: "discardStadium" }]);
    expect(gate.then).toEqual([...(spread as EffectOp[]), ...(discard as EffectOp[])]);
    // …and the `cond` is arm 43's own member, spelled — the same bytes `MAY_DISCARD_STADIUM`'s
    // gate carries (D378's `stadiumInPlay`, not `yourStadiumInPlay` — C4).
    const may = (deriveAttackEffect("You may discard a Stadium in play.") as EffectOp[])[0];
    if (may?.op !== "conditionGate") throw new Error("arm 43's op 0 is not a conditionGate");
    expect(gate.cond).toEqual(may.cond);
    expect(gate.cond).toEqual({ kind: "stadiumInPlay" });
  });

  it("🛑 the sentence is the CORPUS's bytes at exactly ONE printing, at index 240, it is RESOLVED, and the raw file line IS 293", () => {
    const corpus = legalAttackCorpus();
    const rows = corpus.filter(([, s]) => s === PRINTED);
    expect(rows).toEqual([[1, PRINTED]]);
    expect(corpus.findIndex(([, s]) => s === PRINTED)).toBe(240);
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    // FILE LINE 293 is a claim about the FILE, so it is read off the file (1-indexed).
    const raw = Object.entries(RAW).find(([k]) => k.endsWith("/censusAttackCorpus.ts"))?.[1] ?? "";
    expect(raw.split("\n")[292]).toBe(`1 ${PRINTED}`);
  });

  it("🛑 the anchor's claimed set over all 640 rows is EXACTLY {file line 293} — and the optional-clarifier form claims the IDENTICAL 1 / 1 (measured, so nobody tidies it either way)", () => {
    // Re-spelled here so the claim is a MEASUREMENT over the column rather than a reading of
    // the regex (D472/D477): apostrophe slots on BOTH apostrophes, captured amount, the
    // clarifier a REQUIRED literal.
    const mine =
      /^If a Stadium is in play, this attack also does (\d+) damage to each of your opponent['’]s Benched Pokémon, and discard that Stadium\. \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\)$/;
    const [n, u, rows] = claims(mine);
    expect([n, u]).toEqual([1, 1]);
    expect(rows).toEqual([PRINTED]);
    expect(legalAttackCorpus()).toHaveLength(640);
    // The optional-group spelling: identical claim over the column, MEASURED — the literal is
    // kept because it is the print, and the clarifier-less string derives null (below).
    const optional =
      /^If a Stadium is in play, this attack also does (\d+) damage to each of your opponent['’]s Benched Pokémon, and discard that Stadium\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/;
    expect(claims(optional).slice(0, 2)).toEqual([1, 1]);
    expect(claims(optional)[2]).toEqual([PRINTED]);
  });

  it("🛑 `deriveAttackEffect` is the ONLY claimant — twelve readers and four splitters are null (`splitAttackGateClause` included: the `If` is the substance, not a leading timing gate)", () => {
    for (const reader of READERS) {
      if (reader === deriveAttackEffect) continue;
      expect(reader(PRINTED), reader.name).toBeNull();
    }
    for (const splitter of SPLITTERS) expect(splitter(PRINTED), splitter.name).toBeNull();
    expect(splitAttackGateClause(PRINTED)).toBeNull();
  });

  it("🛑 the three `^If a Stadium is in play` rows PARTITION over three readers — 293 → effect, 294 → bonus-consequent, 295 → damage-bonus — measured in BOTH directions", () => {
    const rows = legalAttackCorpus().filter(([, s]) => /^If a Stadium is in play/.test(s));
    expect(rows.map(([, s]) => s).sort()).toEqual([PRINTED, MELTER_TEXT, BONUS_TEXT].sort());
    expect(units(rows)).toBe(3);
    const owner = (s: string): string[] =>
      READERS.filter((read) => read(s) !== null).map((read) => read.name);
    expect(owner(PRINTED)).toEqual(["deriveAttackEffect"]);
    expect(owner(MELTER_TEXT)).toEqual(["deriveAttackBonusConsequent"]);
    expect(owner(BONUS_TEXT)).toEqual(["deriveAttackDamageBonus"]);
    // …and the JOIN reader was NOT widened: D382's control keeps its claim on this row.
    expect(deriveAttackBonusConsequent(PRINTED)).toBeNull();
    expect(deriveAttackEffect(MELTER_TEXT)).toBeNull();
    expect(deriveAttackEffect(BONUS_TEXT)).toBeNull();
  });

  it("🛑 `/that Stadium/` is TWO rows, BOTH resolved, by DIFFERENT readers — the family is 2 / 2 built, 1 / 1 each", () => {
    const rows = legalAttackCorpus().filter(([, s]) => /that Stadium/.test(s));
    expect(rows.map(([, s]) => s).sort()).toEqual([PRINTED, MELTER_TEXT].sort());
    expect(units(rows)).toBe(2);
    for (const [, s] of rows) expect(resolvedByAnyReader(s), s).toBe(true);
    expect(deriveAttackEffect(PRINTED)).not.toBeNull();
    expect(deriveAttackBonusConsequent(MELTER_TEXT)).not.toBeNull();
  });

  it("🛑 the `, and discard that Stadium` join is DISJOINT from the bonus readers' joins — neither `more damage, and ` nor `more damage. Then, ` occurs in the row, and their claims exclude it", () => {
    expect(PRINTED).not.toContain("more damage, and ");
    expect(PRINTED).not.toContain("more damage. Then, ");
    expect(PRINTED).toContain("Benched Pokémon, and discard that Stadium.");
    expect(claims(/more damage, and /)[2]).not.toContain(PRINTED);
    expect(claims(/more damage\. Then, /)[2]).not.toContain(PRINTED);
    expect(claims(/more damage\. Then, /)[2]).toContain(MELTER_TEXT);
  });

  it("🛑 the anchor is WHOLE-SENTENCE at BOTH ends — a prefixed print and a suffixed print each derive null (D520 (3); `D522-gated-spread-anchor-loses-the-head` / `-tail`)", () => {
    // Both strings are CONSTRUCTED and labelled as such (D440); neither is printed.
    const prefixed = `Discard a card from your hand. ${PRINTED}`;
    const suffixed = `${PRINTED} Then, draw a card.`;
    expect(legalAttackCorpus().some(([, s]) => s === prefixed || s === suffixed)).toBe(false);
    expect(deriveAttackEffect(prefixed)).toBeNull();
    expect(deriveAttackEffect(suffixed)).toBeNull();
    expect(resolvedByAnyReader(prefixed)).toBe(false);
    expect(resolvedByAnyReader(suffixed)).toBe(false);
  });

  it("🛑 single-axis controls, ONE clause apart each, all null on `deriveAttackEffect` AND `deriveAttackBonusConsequent` — pinned by the LIVE null", () => {
    const controls: Record<string, string> = {
      "the CLARIFIER dropped":
        "If a Stadium is in play, this attack also does 30 damage to each of your opponent's Benched Pokémon, and discard that Stadium.",
      "the GATE dropped":
        "This attack also does 30 damage to each of your opponent's Benched Pokémon, and discard that Stadium. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "the DISCARD dropped":
        "If a Stadium is in play, this attack also does 30 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "the SPREAD dropped": "If a Stadium is in play, discard that Stadium.",
      "the bare lowercase consequent": "discard that Stadium.",
      "the `also` dropped (`D522-gated-spread-anchor-drops-also`)":
        "If a Stadium is in play, this attack does 30 damage to each of your opponent's Benched Pokémon, and discard that Stadium. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    };
    for (const [why, s] of Object.entries(controls)) {
      expect(s, why).not.toBe(PRINTED);
      expect(deriveAttackEffect(s), why).toBeNull();
      expect(deriveAttackBonusConsequent(s), why).toBeNull();
      expect(resolvedByAnyReader(s), why).toBe(false);
      expect(legalAttackCorpus().some(([, t]) => t === s), why).toBe(false);
    }
  });

  it("🛑 a printed ZERO derives null — the guard is redundant at the interpreter and kept for the LOUD path (`D522-gated-spread-printed-zero-derives`)", () => {
    expect(deriveAttackEffect(PRINTED.replace("does 30 damage", "does 0 damage"))).toBeNull();
    expect(resolvedByAnyReader(PRINTED.replace("does 30 damage", "does 0 damage"))).toBe(false);
  });

  it("🛑 the amount is CAPTURED, not pinned — the 50-print derives the same shape at 50 (`D522-gated-spread-arm-pins-the-amount`)", () => {
    expect(deriveAttackEffect(FIFTY)).toEqual(program(50));
    expect(deriveAttackEffect(PRINTED.replace("does 30 damage", "does 10 damage"))).toEqual(program(10));
    // …and the constructed 50-print is not itself in the column (D440 — labelled constructed).
    expect(legalAttackCorpus().some(([, s]) => s === FIFTY)).toBe(false);
  });

  it("AUTHORS nothing — the legal printing is read off the TEXT, and the reader surface is still THIRTEEN", () => {
    expect(attackReaderSurface()).toHaveLength(13);
    expect(attackReaderSurface()).toContain("deriveAttackEffect");
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the executor: a P2-OWNED Beach Court in the zone, the base before the program, the flat
// spread, the discard to the OWNER's pile, and the boards where the antecedent is false.
// ─────────────────────────────────────────────────────────────────────────────

describe("D522 §2 — Stadium PRESENT: the base lands first, the Bench takes 30 flat, the owner's Stadium is discarded", () => {
  it("🛑 the board is what it says: P2 owns the Stadium, P1's attacker is Active with one Energy, P2 has a neutral body and a WEAK body benched", () => {
    const before = table();
    expect(before.stadium?.owner).toBe("p2");
    expect(before.players.p1.active?.energy).toHaveLength(1);
    expect(before.players.p2.bench).toHaveLength(2);
    expect(before.players.p1.bench).toHaveLength(0);
    expect(GATED_SPREAD_CARDS["d522-weakling"]?.weaknesses).toEqual([{ type: "Fighting", value: "×2" }]);
    expect(GATED_SPREAD_CARDS["d522-crasher"]?.types).toEqual(["Fighting"]);
    expect(before.turn).toBe(2);
  });

  it("🛑 exactly ONE base row on the DEFENDER, and it lands BEFORE every program row (the BASE RULE — D521's `also` path)", () => {
    const { before, events } = swing();
    const defender = activeUid(before, "p2");
    const rows = damageRows(events);
    const baseRows = rows.filter((r) => r.uid === defender);
    expect(baseRows).toHaveLength(1);
    expect(baseRows[0]).toMatchObject({ seat: "p2", by: "p1", uid: defender, base: BASE, dealt: BASE });
    // ATTACK_DECLARED, then the §8.5 hit, then the program.
    expect(types(events).slice(0, 2)).toEqual(["ATTACK_DECLARED", "DAMAGE_DEALT"]);
    const baseAt = events.indexOf(baseRows[0] as GameEvent);
    for (const row of rows) if (row.uid !== defender) expect(events.indexOf(row)).toBeGreaterThan(baseAt);
    const discardAt = events.findIndex((e) => e.type === "STADIUM_DISCARDED");
    expect(discardAt).toBeGreaterThan(baseAt);
  });

  it("🛑 each benched body takes the printed 30 FLAT — the body WEAK to the attacker takes 30, not 60, and its row files `weakness: null` (`D522-gated-spread-arm-drops-the-spread`)", () => {
    const { before, after, events } = swing();
    expect(after.players.p2.bench.map((p) => p.damage)).toEqual([SPREAD, SPREAD]);
    const bench = benchUids(before, "p2");
    const benchRows = damageRows(events).filter((r) => bench.includes(r.uid));
    expect(benchRows).toHaveLength(2);
    for (const row of benchRows) {
      expect(row).toMatchObject({ seat: "p2", by: "p1", base: SPREAD, dealt: SPREAD, weakness: null, resistance: null });
    }
    // The defender took the base only — the spread is BENCH-scoped.
    expect(after.players.p2.active?.damage).toBe(BASE);
  });

  it("🛑 `STADIUM_DISCARDED` fires under the OWNER's seat, the card is in P2's pile and not P1's, and the zone is null after (D380 §3; `D522-gated-spread-arm-drops-the-discard`)", () => {
    const { before, after, events } = swing();
    const stadium = before.stadium;
    if (stadium === null) throw new Error("expected P2's Stadium in the zone");
    expect(stadiumRows(events)).toEqual([{ type: "STADIUM_DISCARDED", seat: "p2", uid: stadium.uid }]);
    expect(after.stadium).toBeNull();
    expect(after.players.p2.discard).toEqual([...before.players.p2.discard, stadium.uid]);
    expect(after.players.p1.discard).toEqual(before.players.p1.discard);
    expect(after.players.p1.discard).not.toContain(stadium.uid);
  });

  it("🛑 no `ATTACK_EFFECT_SKIPPED`, and an attack ENDS the turn (D491) — p2's action phase on turn 3", () => {
    const { after, events } = swing();
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(types(events)).toContain("TURN_ENDED");
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(after.turn).toBe(3);
  });

  it("🛑 the attacker's OWN Bench is untouched — `opponentBench`, not `yourBench` (`D522-gated-spread-arm-targets-your-bench`)", () => {
    const { before, after, events } = swing({ ownBench: true });
    expect(before.players.p1.bench).toHaveLength(1);
    expect(after.players.p1.bench.map((p) => p.damage)).toEqual([0]);
    expect(after.players.p2.bench.map((p) => p.damage)).toEqual([SPREAD, SPREAD]);
    const own = benchUids(before, "p1");
    expect(damageRows(events).some((r) => own.includes(r.uid))).toBe(false);
    expect(damageRows(events).some((r) => r.seat === "p1")).toBe(false);
    expect(after.players.p1.active?.damage).toBe(0);
  });

  it("🛑 `rngState` is UNMOVED — no coin, no shuffle — and the index-0 control on the same deck neither spreads nor discards", () => {
    const { before, after, events } = swing();
    expect(after.rngState).toBe(before.rngState);
    expect(types(events)).not.toContain("ATTACK_EFFECT_COIN_FLIP");
    const control = swing({}, 0);
    expect(control.after.rngState).toBe(control.before.rngState);
    expect(control.after.stadium).not.toBeNull();
    expect(control.after.players.p2.bench.map((p) => p.damage)).toEqual([0, 0]);
    expect(control.after.players.p2.active?.damage).toBe(30);
    expect(types(control.events)).not.toContain("STADIUM_DISCARDED");
  });

  it("🛑 the 50-print spreads exactly 50 to each benched body on its own board, and still discards (`D522-gated-spread-arm-pins-the-amount`)", () => {
    const { after, events } = swing({ attacker: "d522-fifty" });
    expect(after.players.p2.bench.map((p) => p.damage)).toEqual([50, 50]);
    expect(after.players.p2.active?.damage).toBe(60);
    expect(after.stadium).toBeNull();
    expect(stadiumRows(events)).toHaveLength(1);
  });

  it("🛑 `programPlayable` is TRUE — nothing in the program parks or needs a target — with and without a Bench across the table", () => {
    const full = table();
    expect(programPlayable(full, PROGRAM, "p1")).toBe(true);
    expect(programPlayable(full, PROGRAM, "p1", activeUid(full, "p1"))).toBe(true);
    const empty = table({ oppBench: [] });
    expect(empty.players.p2.bench).toHaveLength(0);
    expect(programPlayable(empty, PROGRAM, "p1")).toBe(true);
    const bare = table({ stadium: false });
    expect(bare.stadium).toBeNull();
    expect(programPlayable(bare, PROGRAM, "p1")).toBe(true);
  });
});

describe("D522 §2b — Stadium ABSENT, an EMPTY Bench, and the Knock Out the spread causes", () => {
  it("🛑 Stadium ABSENT → the base only: Bench untouched, no `STADIUM_DISCARDED`, no `ATTACK_EFFECT_SKIPPED`, the turn ends (`D522-gated-spread-arm-reads-ownership`'s other face)", () => {
    const { before, after, events } = swing({ stadium: false });
    expect(before.stadium).toBeNull();
    expect(after.players.p2.active?.damage).toBe(BASE);
    expect(after.players.p2.bench.map((p) => p.damage)).toEqual([0, 0]);
    expect(damageRows(events)).toHaveLength(1);
    expect(types(events)).not.toContain("STADIUM_DISCARDED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 the P2-OWNED Stadium is what the gate reads — `stadiumInPlay` is PRESENCE, not `yourStadiumInPlay`'s OWNERSHIP (`D522-gated-spread-arm-reads-ownership`)", () => {
    // The attacker is P1 and the Stadium is P2's: an ownership member would answer NO here and
    // the program would neither spread nor discard. Presence answers YES.
    const { before, after } = swing();
    expect(before.stadium?.owner).toBe("p2");
    expect(before.stadium?.owner).not.toBe("p1");
    expect(after.players.p2.bench.map((p) => p.damage)).toEqual([SPREAD, SPREAD]);
    expect(after.stadium).toBeNull();
  });

  it("🛑 Stadium present with an EMPTY opponent Bench → the discard still happens (the spread's own empty early return), no damage row but the base", () => {
    const { before, after, events } = swing({ oppBench: [] });
    const stadium = before.stadium;
    if (stadium === null) throw new Error("expected P2's Stadium in the zone");
    expect(before.players.p2.bench).toHaveLength(0);
    expect(damageRows(events)).toHaveLength(1);
    expect(after.players.p2.active?.damage).toBe(BASE);
    expect(stadiumRows(events)).toEqual([{ type: "STADIUM_DISCARDED", seat: "p2", uid: stadium.uid }]);
    expect(after.stadium).toBeNull();
    expect(after.players.p2.discard).toContain(stadium.uid);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 a benched body at 30 remaining is KNOCKED OUT by the spread, the ATTACKER's Prize is owed (`finishAttack`'s two-seat sweep), and the Stadium is still discarded", () => {
    // 60 HP `d522-brittle` in slot 0, pre-damaged to 30: the printed 30 is exactly lethal.
    const { before, after, events } = swing({ oppBench: ["d522-brittle", "d522-wall"], benchDamage: 30 });
    const [brittle] = benchUids(before, "p2");
    expect(events.find((e) => e.type === "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: brittle });
    expect(after.stadium).toBeNull();
    expect(types(events)).toContain("STADIUM_DISCARDED");
    // ⚠️ AN ATTACK ENDS THE TURN, BUT NOT YET: the KO interrupts with the Prize in front of it.
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    expect(types(events)).not.toContain("TURN_ENDED");
    const done = must(applyAction(after, { type: "takePrizes", seat: "p1", prizeIndices: [0] }));
    expect(done.players.p1.prizes).toHaveLength(5);
    expect(done.players.p2.prizes).toHaveLength(6);
    // The KO'd body left the Bench; the survivor kept its 30; the defender took the base.
    expect(done.players.p2.bench.map((p) => p.damage)).toEqual([SPREAD]);
    expect(done.players.p2.discard).toContain(brittle);
    expect(done.players.p2.active?.damage).toBe(BASE);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 the SAME primed body with the Stadium ABSENT survives — the antecedent is the whole difference", () => {
    const { after, events } = swing({ oppBench: ["d522-brittle", "d522-wall"], benchDamage: 30, stadium: false });
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(after.players.p2.bench.map((p) => p.damage)).toEqual([30, 0]);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the census figures, with their units.
// ─────────────────────────────────────────────────────────────────────────────

describe("D522 §3 — the census moved in exactly ONE summand, by 1 sentence / 1 printing", () => {
  it("🛑 the reader arm reads 549 sentences / 1,590 printings, and the row is IN it", () => {
    const resolved = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    // 🆕🆕🆕 D523 +1 sentence / +1 printing (THE DECK-DESTINATION DISCARD-PILE RETRIEVAL — corpus
    // FILE LINE 485, *"Shuffle up to 3 Basic {W} Energy cards from your discard pile into your
    // deck."*, claimed by `deriveAttackEffect` through `ATTACK_DISCARD_SHUFFLE_BACK`, the arm after
    // the D237 arm — Pal Pad's registry pair with the hand twin's filter, ZERO new vocabulary; the
    // sentence and printing steps AGREE, 1 and 1): 549/1590 → 550/1591 and 548/1589 → 549/1590.
    // ⚠️ This suite's own literals sat OUTSIDE the annotated-chain sweep's shape (never annotated at
    // D522) and are stepped by hand (D522 (4)).
    // 🆕🆕🆕 D524 +1 sentence / +1 printing (THE PURPOSE-CONNECTIVE OPTIONAL-COST BOOST WITH THE
    // ALL-SELF-ENERGY-TO-HAND COST — corpus FILE LINE 652, *"You may put all Energy attached to this
    // Pokémon into your hand to have this attack do 80 more damage."*, claimed by
    // `deriveAttackOptionalCostBoost` through the purpose skeleton over one new cost-table row, ZERO
    // new vocabulary; the sentence and printing steps AGREE, 1 and 1): 550/1591 → 551/1592 and
    // 549/1590 → 550/1591. Stepped by hand again (outside the annotated-chain sweep's shape).
    expect([resolved.length, units(resolved)]).toEqual([551, 1592]);
    expect(resolved.map(([, s]) => s)).toContain(PRINTED);
    // …and the step is THIS sentence and nothing else: remove it and the pair is D521's.
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([without.length, units(without)]).toEqual([550, 1591]);
  });

  it("🛑 the RAW reader-only residue fell by exactly 1 sentence / 1 printing — 91 / 142 — and the row left it", () => {
    const unbuilt = legalAttackCorpus().filter(([, s]) => !resolvedByAnyReader(s));
    // 🆕🆕🆕 D523 −1 sentence / −1 printing (corpus FILE LINE 485, see §3's first rung): 91/142 → 90/141.
    // 🆕🆕🆕 D524 −1 sentence / −1 printing (corpus FILE LINE 652, see §3's first rung): 90/141 → 89/140.
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

describe("D522 §4 — the version steps, the heading is written, the prose is corrected, and what stands still", () => {
  it("engineVersion and `manifest.version` agree, and the bump is owed for BEHAVIOUR", () => {
    // ⚠️ The version is NOT spelled in this `it(…)` title (D460's fourth class).
    expect(engineVersion).toBe("0.411.0");
    expect(manifest.version).toBe(engineVersion);
  });

  it("🛑 the changelog heading for this bump is present in `index.ts`, labelled with its decision", () => {
    const index = Object.entries(RAW).find(([k]) => k.endsWith("/index.ts"))?.[1] ?? "";
    expect(index.length).toBeGreaterThan(1_000_000);
    expect(index).toContain("engineVersion 0.408.0 → **0.409.0** (D522");
  });

  it("🛑 the stale refusal is corrected IN PLACE in both prose copies (D442/D508), and the anchor's commentary does not inflate the producer counts (D516)", () => {
    const effects = Object.entries(RAW).find(([k]) => k.endsWith("/effects.ts"))?.[1] ?? "";
    const index = Object.entries(RAW).find(([k]) => k.endsWith("/index.ts"))?.[1] ?? "";
    // The D380 op block (~7505) and the D382 changelog block (~14526).
    expect(effects).toContain("D522 — BOTH TAILS ARE NOW BUILT");
    expect(index).toContain("D522 — THE 1 / 1 LEFT IS NOW 0 / 0");
    // …and the raw producer counts read CODE, one new site each — the anchor block spells the
    // program without the `op: "…",` form (D516/D520 (4)/D521): 16 → 17, 9 → 10, 5 → 6, MEASURED.
    expect(effects.split('op: "conditionGate",').length - 1).toBe(17);
    expect(effects.split('op: "spreadDamage",').length - 1).toBe(10);
    expect(effects.split('{ op: "discardStadium" }').length - 1).toBe(6);
  });

  it("🛑 `MATCH_RECORD_VERSION` HOLDS at 30: zero new serialized bytes, neither op parks, the gate is spliced", () => {
    // Every kind, field and value in the program already ships (`stadiumInPlay` since D378,
    // `discardStadium` since D380, `spreadDamage {opponentBench}` since D134/D425), so the
    // program survives a JSON round trip unchanged and a v30 deploy could already have written it.
    expect(JSON.parse(JSON.stringify(PROGRAM))).toEqual(PROGRAM);
    // The declaration never parks: no board above ended in `effect:choose`.
    for (const board of [{}, { stadium: false }, { oppBench: [] }] as const) {
      expect(swing(board).after.phase.kind).not.toBe("effect:choose");
    }
  });

  it("🛑 the demonstrator is FILE-LOCAL — zero `FIXTURE_POOL` ids, Ting-Lu `sv06-110` is NOT in the pool (its base and cost are unresolvable here, D425), the deck is 60", () => {
    expect(Object.keys(GATED_SPREAD_CARDS).every((id) => FIXTURE_POOL[id] === undefined)).toBe(true);
    expect(FIXTURE_POOL["sv06-110"]).toBeUndefined();
    expect(FIXTURE_POOL[BEACH_COURT]?.name).toBe("Beach Court");
    expect(GATED_SPREAD_DECK).toHaveLength(60);
    // The arithmetic the KO board rests on: 60 HP, 30 prior, 30 printed.
    expect((GATED_SPREAD_CARDS["d522-brittle"]?.hp ?? 0) - 30).toBe(SPREAD);
  });
});
