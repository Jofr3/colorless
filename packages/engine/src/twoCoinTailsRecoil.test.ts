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
import { flipCoin } from "./rng";
import {
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
} from "./testFixtures";

// 0.407.0 → 0.408.0 — 🆕🆕🆕 D521: THE TWO-COIN BOTH-TAILS RECOIL — ZERO VOCABULARY, AND A
// REFUSAL THAT WAS WRONG IN ITS CARRIER.
//
// *"Flip 2 coins. If both of them are tails, this Pokémon also does 90 damage to itself."* —
// `censusAttackCorpus.ts` **FILE LINE 202**, **1 sentence / 2 legal printings**, claimed by
// `deriveAttackEffect` through ONE new anchor (`FLIP_TWO_BOTH_TAILS_SELF_DAMAGE`, beside D145's
// one-coin `FLIP_TAILS_SELF_DAMAGE`) and ONE new arm directly after D145's, deriving ONE
// SHIPPED op:
//
//     [ { op: "coinFlipGate", coins: 2, onTails: true,
//         then: [ { op: "damageSelf", amount: 90 } ] } ]
//
// 🛑 **THE PRICE IS ONE ANCHOR AND ONE ARM — ZERO NEW VOCABULARY.** `coins` is D355's field,
// `onTails` is D144's, `damageSelf` is M5's; no `interpreter.ts` byte, no `attack.ts` byte, no
// reader (surface 13), registry row, `FIXTURE_POOL` id, prompt, event or schema byte. The
// `then` is byte-identical to what the BARE recoil anchor derives for the same N — one action
// per sentence, the coins procedure in front of it (D144/D145's family claim, at N=2).
//
// 🛑 **THE REFUSAL THAT KEPT THIS ROW UNBUILT NAMED THE WRONG CARRIER.**
// `selfDamagePerCounter.test.ts` §4 carried it as *"blocked on the coin structure
// (`AttackFlipCount` + a both-tails gate)"*, and the D355 block at `coinFlipGate.coins` said the
// three both-tails printings were *"out of reach by COLUMN"*. `AttackFlipCount` is
// `deriveAttackCoinFlip`'s DAMAGE-COUNT type — it claims the column's OTHER both-tails row (FILE
// LINE 213, a per-heads count with a Confusion tail, `perHeadsThenThreshold`) — and this recoil
// is not a count: it is a program op behind D355's shipped `coins`, the exact shape D145 shipped
// for the one-coin print. `deriveAttackEffect` has emitted `coinFlipGate` for attack text since
// D144/D145, so the column argument was false the day it was written. D520 (2)'s rule applied:
// the op HITS ONE BODY — the attacker — and a one-body recoil behind a coin is a GATE, not a
// count. Four stale copies corrected in place (D442/D508): the D355 block in `effects.ts`, the
// D355 changelog prose in `index.ts`, the §4 rung, and the `what` of
// `D355-energycoin-gains-ontails`.
//
// 🛑 **THE BASE RULE — THE ONE-COIN SIBLING'S, THE OPPOSITE CASE FROM D520's.** Every printing
// carries a printed base (*"also"*). `attack.ts`'s `programDamage` walks the top level and the
// gate is not a damage op, so the base lands in §8.5 and the recoil runs at the program's tail
// — Oinkologne sv03-183's exact path (`testFixtures.ts` "High-Impact Kick"). §2 asserts the
// order (DAMAGE_DEALT before the two flips), the flat recoil (no W/R against the attacker's own
// Weakness — the demonstrator is Weak to its OWN type), and the self-KO swept by the epilogue.
//
// ⚠️ **WHICH TWO OF `sv06-090`, `sv10-148`, `sv10-202` CARRY THIS ROW IS UNRESOLVABLE ON THIS
// CHECKOUT** — no local D1, no catalog sqlite; the D355 census named all three across FILE LINES
// 202 AND 213 without splitting them (D425) — and the ids are NOT invented. The demonstrator is a
// FILE-LOCAL pool with its own deck (D414/D452/D520's shape): zero `FIXTURE_POOL` ids.
//
// ⚠️ **ASSERT BY ENUMERATING THE FLIP ROWS, NEVER BY GREPPING FOR THE FACE YOU EXPECT** (D269's
// idiom): every board below reads its faces off the `ATTACK_EFFECT_COIN_FLIP` rows of the SAME
// log, and the seed is a RESULT of a search over `SEEDS` rather than a constant.

/** Corpus FILE LINE 202, byte for byte. */
const PRINTED = "Flip 2 coins. If both of them are tails, this Pokémon also does 90 damage to itself.";
/** The same shape at a different N — the amount is CAPTURED, not pinned (C7). Constructed. */
const FIFTY = "Flip 2 coins. If both of them are tails, this Pokémon also does 50 damage to itself.";
/** The one-coin sibling's SHAPE at the same N (D145 — Oinkologne sv03-183 prints it at 60; the
    sentence is NOT a row of the legal column, measured in §1) and the BARE recoil. */
const ONE_COIN = "Flip a coin. If tails, this Pokémon also does 90 damage to itself.";
const BARE = "This Pokémon also does 90 damage to itself.";
/** The column's OTHER both-tails row, FILE LINE 213 — `deriveAttackCoinFlip`'s, not this arm's. */
const PER_HEADS_THEN_CONFUSE =
  "Flip 2 coins. This attack does 90 damage for each heads. If both of them are tails,  your opponent's Active Pokémon is now Confused.";
/** The `to itself` row still unbuilt after this slice — FILE LINE 607, a compound. */
const PRIZE_RECOIL_COMPOUND =
  "This attack does 50 more damage for each Prize card your opponent has taken. This Pokémon also does 30 damage to itself.";

/** THE PROGRAM, spelled once at the captured amount. */
const program = (amount: number): EffectOp[] => [
  {
    op: "coinFlipGate",
    coins: 2,
    onTails: true,
    // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
    then: [{ op: "damageSelf", amount }],
  },
];
const PROGRAM = program(90);

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
// The demonstrator — a FILE-LOCAL pool and its own deck (D414/D452/D520).
// ─────────────────────────────────────────────────────────────────────────────

/** 130 HP against a 90 recoil — D134's fixture-HP trap turned into the numbers: a FRESH body
    survives its own attack once, a body already carrying 40 or more does not, so the self-KO
    is one `setDamage` away and is never reached by accident. The attacker is {R} and Weak to
    {R} ×2 ON PURPOSE: a recoil routed through §8.5 with the attacker as its own source would
    double, and §2 asserts it does not. */
const HP = 130;
const RECOIL = 90;
const BASE = 100;

const TWO_COIN_CARDS: Record<string, Card> = {
  "d521-recoiler": battler("d521-recoiler", {
    name: "D521 Recoiler",
    types: ["Fire"],
    hp: HP,
    retreat: 1,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [
      /** index 0 — the control: no effect, so no coin and no rng draw on the same deck. */
      { cost: ["Colorless"], name: "Plain Jab", damage: 30 },
      /** index 1 — FILE LINE 202 verbatim, with a printed base so the base-lands-then-recoil
          path is driven (the BASE RULE, the one-coin sibling's). */
      { cost: ["Colorless"], name: "Double Tails Charge", damage: BASE, effect: PRINTED },
    ],
  }),
  /** The SAME shape at 50 — the amount-not-pinned witness (C7). */
  "d521-fifty": battler("d521-fifty", {
    name: "D521 Fifty",
    types: ["Fire"],
    hp: HP,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Plain Jab", damage: 30 },
      { cost: ["Colorless"], name: "Half Tails Charge", damage: 60, effect: FIFTY },
    ],
  }),
  /** The defender — 400 HP, nothing here is a Knock Out on ITS side. Also the attacker's
      lone benched body on the self-KO board. */
  "d521-wall": battler("d521-wall", { name: "D521 Wall", types: ["Colorless"], hp: 400 }),
};

const TWO_COIN_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...TWO_COIN_CARDS };

/** Its own deck (D270), 60 counted before the first run: 12 + 8 + 16 + 24. */
const TWO_COIN_DECK = deckOf({
  "d521-recoiler": 12,
  "d521-fifty": 8,
  "d521-wall": 16,
  "fix-energy": 24,
});

/** [1..220], the range `energyCoin.test.ts` searches — the seed is a RESULT of a search. */
const SEEDS = Array.from({ length: 220 }, (_, i) => i + 1);

function openTable(seed: number, first: Seat): GameState {
  const created = createGame({
    seed,
    decks: { p1: TWO_COIN_DECK, p2: TWO_COIN_DECK },
    cardPool: TWO_COIN_POOL,
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
  readonly attacker?: "d521-recoiler" | "d521-fifty";
  /** Prior damage on the attacker — the self-KO is `>= 40` (130 − 90). */
  readonly self?: number;
  /** Bench one body for the attacker so a self-KO has something to promote. Default EMPTY. */
  readonly bench?: boolean;
};

/** p1 owns TURN 2 with the attacker Active. NONE of these surgeries touches `rngState`
    (`setActiveFromDeck` / `clearBench` / `attachFromDeck` / `setDamage` are board edits), which
    is what makes one seed table right for every board shape below. */
function table(seed: number, board: Board = {}): GameState {
  let state = openTable(seed, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  if (state.turn !== 2) throw new Error(`expected turn 2, got ${String(state.turn)}`);
  state = setActiveFromDeck(state, "p1", board.attacker ?? "d521-recoiler");
  state = setActiveFromDeck(state, "p2", "d521-wall");
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  if (board.bench) state = benchFromDeck(state, "p1", "d521-wall");
  if (board.self !== undefined) state = setDamage(state, "p1", board.self);
  return state;
}

type Swing = { seed: number; before: GameState; after: GameState; events: GameEvent[] };

function swing(seed: number, board: Board = {}, index = 1): Swing {
  const before = table(seed, board);
  const { state: after, events } = mustApply(before, { type: "attack", seat: "p1", index });
  return { seed, before, after, events };
}

/** EVERY face this declaration filed, IN PRINTED ORDER — read off the SAME log. */
function facesOf(events: readonly GameEvent[]): string[] {
  return events
    .filter((e): e is Extract<GameEvent, { type: "ATTACK_EFFECT_COIN_FLIP" }> => e.type === "ATTACK_EFFECT_COIN_FLIP")
    .map((e) => e.result);
}

/** The FIRST seed whose declaration filed exactly `faces` on `board` — a RESULT, not a constant. */
function firstBoardWithFaces(faces: readonly string[], board: Board = {}): Swing {
  for (const seed of SEEDS) {
    const played = swing(seed, board);
    if (facesOf(played.events).join("-") === faces.join("-")) return played;
  }
  throw new Error(`no seed in SEEDS produced ${faces.join("-")}`);
}

const TT = ["tails", "tails"] as const;
const HT = ["heads", "tails"] as const;
const TH = ["tails", "heads"] as const;
const HH = ["heads", "heads"] as const;
const FACES = [TT, HT, TH, HH] as const;

function recoilRows(events: readonly GameEvent[]) {
  return events.flatMap((e) =>
    e.type === "COUNTERS_PLACED" && e.source === "self" ? [{ seat: e.seat, amount: e.amount }] : [],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — derivation: the exact program, its key set, its `then`, and the row's census identity.
// ─────────────────────────────────────────────────────────────────────────────

describe("D521 §1 — the printed row derives to EXACTLY the one-op program", () => {
  it("🛑 file line 202 derives to the two-coin tails gate over the bare recoil", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
  });

  it("🛑 the gate's sorted KEY SET is exactly [coins, onTails, op, then] — no stray field, no missing one", () => {
    // `toEqual` alone could not see a MISSING key any better than a `toMatchObject` (D355's
    // lesson on Energy Coin); `tailsSelfCost.test.ts` makes this rung per arm, and so does this.
    const op = (deriveAttackEffect(PRINTED) as EffectOp[])[0] as object;
    expect(Object.keys(op).sort()).toEqual(["coins", "onTails", "op", "then"]);
  });

  it("🛑 the `then` is BYTE-EQUAL to what the bare recoil anchor derives — one action, the coins in front of it", () => {
    const gate = (deriveAttackEffect(PRINTED) as EffectOp[])[0];
    if (gate?.op !== "coinFlipGate") throw new Error("op 0 is not a coinFlipGate");
    expect(gate.then).toEqual(deriveAttackEffect(BARE));
    expect(deriveAttackEffect(BARE)).toEqual([{ op: "damageSelf", amount: 90 }]);
    // …and the one-coin sibling's `then` is the SAME bytes — the family claim at N=1 and N=2.
    const one = (deriveAttackEffect(ONE_COIN) as EffectOp[])[0];
    if (one?.op !== "coinFlipGate") throw new Error("sibling op 0 is not a coinFlipGate");
    expect(one.then).toEqual(gate.then);
    expect(Object.keys(one).sort()).toEqual(["onTails", "op", "then"]);
  });

  it("🛑 the sentence is the CORPUS's bytes at exactly TWO printings, it is RESOLVED, and the raw file line IS 202", () => {
    const rows = legalAttackCorpus().filter(([, s]) => s === PRINTED);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe(2);
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    // FILE LINE 202 is a claim about the FILE, so it is read off the file (1-indexed).
    const corpus = Object.entries(RAW).find(([k]) => k.endsWith("/censusAttackCorpus.ts"))?.[1] ?? "";
    expect(corpus.split("\n")[201]).toBe(`2 ${PRINTED}`);
  });

  it("🛑 the anchor's claimed set over all 640 rows is EXACTLY {file line 202} — 1 sentence / 2 printings", () => {
    // Re-spelled here so the claim is a MEASUREMENT over the column rather than a reading of
    // the regex (D472/D477). Literal `2`, literal `both of them are`, captured amount.
    const mine = /^Flip 2 coins\. If both of them are tails, this Pokémon also does (\d+) damage to itself\.$/;
    const [n, u, rows] = claims(mine);
    expect([n, u]).toEqual([1, 2]);
    expect(rows).toEqual([PRINTED]);
    expect(legalAttackCorpus()).toHaveLength(640);
    // …and the one-coin sibling's anchor is DISJOINT from this one over the column. ⚠️ MEASURED
    // 0 / 0 at this head: the one-coin sentence is not a row of the LEGAL column at all (its
    // warrant was always D134's SHAPE rule, `effects.ts` says so at the anchor), so the first
    // draft's `[1, 1]` here was a belief and went red — the corpus, not the regex, is the witness.
    const sibling = /^Flip a coin\. If tails, this Pokémon also does (\d+) damage to itself\.$/;
    expect(claims(sibling)[2]).not.toContain(PRINTED);
    expect(claims(sibling).slice(0, 2)).toEqual([0, 0]);
    expect(legalAttackCorpus().some(([, s]) => s === ONE_COIN)).toBe(false);
  });

  it("🛑 `deriveAttackEffect` is the ONLY claimant — twelve readers and four splitters are null", () => {
    for (const reader of READERS) {
      if (reader === deriveAttackEffect) continue;
      expect(reader(PRINTED), reader.name).toBeNull();
    }
    for (const splitter of SPLITTERS) expect(splitter(PRINTED), splitter.name).toBeNull();
  });

  it("🛑 the column's OTHER both-tails row (file line 213) stays `deriveAttackCoinFlip`'s — the wrong carrier, measured", () => {
    // `AttackFlipCount` IS the type this row uses (a per-heads DAMAGE COUNT with a both-tails
    // Confusion tail); the recoil never wanted it. The two rows are disjoint on both sides.
    const rows = legalAttackCorpus().filter(([, s]) => /both of them are tails/.test(s));
    expect(rows.map(([, s]) => s).sort()).toEqual([PRINTED, PER_HEADS_THEN_CONFUSE].sort());
    expect(deriveAttackEffect(PER_HEADS_THEN_CONFUSE)).toBeNull();
    expect(deriveAttackCoinFlip(PER_HEADS_THEN_CONFUSE)?.kind).toBe("perHeadsThenThreshold");
    expect(deriveAttackCoinFlip(PRINTED)).toBeNull();
  });

  it("🛑 the `to itself` remainder is now exactly ONE row — file line 607, the compound — and the one-coin sibling still derives", () => {
    const unbuilt = legalAttackCorpus().filter(([, s]) => s.includes("to itself") && !resolvedByAnyReader(s));
    expect(unbuilt.map(([, s]) => s)).toEqual([PRIZE_RECOIL_COMPOUND]);
    expect(units(unbuilt)).toBe(4);
    expect(deriveAttackEffect(ONE_COIN)).toEqual([
      {
        op: "coinFlipGate",
        onTails: true,
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "damageSelf", amount: 90 }],
      },
    ]);
  });

  it("AUTHORS nothing — the legal printings are read off the TEXT, and the reader surface is still THIRTEEN", () => {
    expect(attackReaderSurface()).toHaveLength(13);
    expect(attackReaderSurface()).toContain("deriveAttackEffect");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §1b — the COUNT × UNANIMITY lattice, both anchor ends, and the negative controls.
// ─────────────────────────────────────────────────────────────────────────────

describe("D521 §1b — COUNT × UNANIMITY: exactly the two PRINTED corners build", () => {
  const COUNT = ["a coin", "2 coins"] as const;
  const UNANIMITY = ["If tails", "If both of them are tails"] as const;
  const point = (count: string, unanimity: string) =>
    `Flip ${count}. ${unanimity}, this Pokémon also does 90 damage to itself.`;

  it("🛑 the 2×2 lattice: (a coin × If tails) and (2 coins × If both…) build; both single-axis points derive null", () => {
    const built: string[] = [];
    for (const c of COUNT) {
      for (const u of UNANIMITY) {
        const s = point(c, u);
        if (deriveAttackEffect(s) !== null) built.push(s);
      }
    }
    expect(built.sort()).toEqual([ONE_COIN, PRINTED].sort());
    expect(point("a coin", "If tails")).toBe(ONE_COIN);
    expect(point("2 coins", "If both of them are tails")).toBe(PRINTED);
    // The single-axis points, by name — MEASURED null at this head (pre-slice 1 of 4, now 2 of 4).
    expect(deriveAttackEffect(point("2 coins", "If tails"))).toBeNull();
    expect(deriveAttackEffect(point("a coin", "If both of them are tails"))).toBeNull();
    expect(resolvedByAnyReader(point("2 coins", "If tails"))).toBe(false);
    expect(resolvedByAnyReader(point("a coin", "If both of them are tails"))).toBe(false);
    // …and neither single-axis point is printed: the literals co-vary in the column.
    for (const s of [point("2 coins", "If tails"), point("a coin", "If both of them are tails")]) {
      expect(legalAttackCorpus().some(([, t]) => t === s), s).toBe(false);
    }
  });

  it("🛑 the anchor is WHOLE-SENTENCE at BOTH ends — a prefixed print and a suffixed print each derive null (D520 (3); `D521-two-coin-anchor-loses-the-head` / `-tail`)", () => {
    // The lattice above is blind to the anchor's ENDS: every point starts with `Flip` and ends
    // with `itself.`. These two rungs are the ones that see them. Both strings are CONSTRUCTED
    // and labelled as such (D440); neither is printed.
    const prefixed = `Discard a card from your hand. ${PRINTED}`;
    const suffixed = `${PRINTED} Then, draw a card.`;
    expect(legalAttackCorpus().some(([, s]) => s === prefixed || s === suffixed)).toBe(false);
    expect(deriveAttackEffect(prefixed)).toBeNull();
    expect(deriveAttackEffect(suffixed)).toBeNull();
    expect(resolvedByAnyReader(prefixed)).toBe(false);
    expect(resolvedByAnyReader(suffixed)).toBe(false);
  });

  it("🛑 negative controls, ONE axis apart each, all null — pinned by the LIVE null, not by a citation", () => {
    // There is NO heads-gated recoil anchor in `effects.ts` to cite as a disjointness witness
    // (measured: no non-comment line spells `both of them are heads`), so each control is a
    // measurement at this head rather than a reading of a neighbour.
    const controls: Record<string, string> = {
      "the FACE flipped": "Flip 2 coins. If both of them are heads, this Pokémon also does 90 damage to itself.",
      "the UNANIMITY word (either)": "Flip 2 coins. If either of them is tails, this Pokémon also does 90 damage to itself.",
      "the COUNT raised to 3": "Flip 3 coins. If both of them are tails, this Pokémon also does 90 damage to itself.",
      "the COUNT raised to 3 with `all`": "Flip 3 coins. If all of them are tails, this Pokémon also does 90 damage to itself.",
      "the `also` dropped": "Flip 2 coins. If both of them are tails, this Pokémon does 90 damage to itself.",
      "the period dropped": "Flip 2 coins. If both of them are tails, this Pokémon also does 90 damage to itself",
    };
    for (const [why, s] of Object.entries(controls)) {
      expect(s, why).not.toBe(PRINTED);
      expect(deriveAttackEffect(s), why).toBeNull();
      expect(resolvedByAnyReader(s), why).toBe(false);
      expect(legalAttackCorpus().some(([, t]) => t === s), why).toBe(false);
    }
  });

  it("🛑 a printed ZERO derives null — the bare arm's guard, verbatim (`D521-two-coin-printed-zero-derives`)", () => {
    expect(deriveAttackEffect(PRINTED.replace("does 90 damage", "does 0 damage"))).toBeNull();
    expect(deriveAttackEffect(ONE_COIN.replace("does 90 damage", "does 0 damage"))).toBeNull();
  });

  it("🛑 the amount is CAPTURED, not pinned — the 50-print derives the same shape at 50 (`D521-two-coin-arm-pins-the-amount`)", () => {
    expect(deriveAttackEffect(FIFTY)).toEqual(program(50));
    expect(deriveAttackEffect(PRINTED.replace("does 90 damage", "does 10 damage"))).toEqual(program(10));
    // …and the constructed 50-print is not itself in the column (D440 — labelled constructed).
    expect(legalAttackCorpus().some(([, s]) => s === FIFTY)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the executor on four seeded boards, asserting by ENUMERATING the flip rows.
// ─────────────────────────────────────────────────────────────────────────────

describe("D521 §2 — four seeded boards: recoil on [T,T] only, two rows always, base always", () => {
  it("🛑 the four face pairs are all REACHABLE in SEEDS, and each board's faces are read off its own log", () => {
    for (const faces of FACES) {
      const played = firstBoardWithFaces(faces);
      expect(facesOf(played.events)).toEqual([...faces]);
    }
  });

  it("🛑 the recoil lands on [T,T] ONLY — 90 on the attacker; the three other boards leave it at 0", () => {
    for (const faces of FACES) {
      const { after, events } = firstBoardWithFaces(faces);
      const unanimousTails = faces.every((f) => f === "tails");
      expect(after.players.p1.active?.damage, faces.join("-")).toBe(unanimousTails ? RECOIL : 0);
      expect(recoilRows(events), faces.join("-")).toEqual(unanimousTails ? [{ seat: "p1", amount: RECOIL }] : []);
    }
  });

  it("🛑 exactly TWO `ATTACK_EFFECT_COIN_FLIP` rows on EVERY board, in printed order, filed by the attacker's seat", () => {
    for (const faces of FACES) {
      const { events } = firstBoardWithFaces(faces);
      const flips = events.filter((e) => e.type === "ATTACK_EFFECT_COIN_FLIP");
      expect(flips, faces.join("-")).toHaveLength(2);
      expect(flips.every((e) => e.type === "ATTACK_EFFECT_COIN_FLIP" && e.seat === "p1")).toBe(true);
      expect(facesOf(events)).toEqual([...faces]);
    }
  });

  it("🛑 `rngState` advances EXACTLY two `flipCoin` steps on every face — D144's invariant at N=2 (`D521-two-coin-arm-flips-three` / `-drops-coins`)", () => {
    for (const faces of FACES) {
      const { before, after } = firstBoardWithFaces(faces);
      const [, one] = flipCoin(before.rngState);
      const [, two] = flipCoin(one);
      expect(after.rngState, faces.join("-")).toBe(two);
      expect(after.rngState).not.toBe(before.rngState);
      expect(after.rngState).not.toBe(one);
    }
    // …and the index-0 control on the SAME deck takes NO coin at all: the draw belongs to the gate.
    const { seed } = firstBoardWithFaces(TT);
    const control = swing(seed, {}, 0);
    expect(control.after.rngState).toBe(control.before.rngState);
    expect(types(control.events)).not.toContain("ATTACK_EFFECT_COIN_FLIP");
    expect(control.after.players.p2.active?.damage).toBe(30);
  });

  it("🛑 the printed BASE reaches the defender on every face, and lands BEFORE the coins (the BASE RULE)", () => {
    for (const faces of FACES) {
      const { after, events } = firstBoardWithFaces(faces);
      expect(after.players.p2.active?.damage, faces.join("-")).toBe(BASE);
      // ATTACK_DECLARED, the §8.5 hit, then the two flips — the program runs at the tail.
      expect(types(events).slice(0, 4)).toEqual([
        "ATTACK_DECLARED",
        "DAMAGE_DEALT",
        "ATTACK_EFFECT_COIN_FLIP",
        "ATTACK_EFFECT_COIN_FLIP",
      ]);
    }
  });

  it("🛑 the recoil is FLAT — the attacker is Weak to its OWN type and still takes exactly 90, not 180", () => {
    const { after, before } = firstBoardWithFaces(TT);
    const card = TWO_COIN_CARDS["d521-recoiler"];
    expect(card?.types).toEqual(["Fire"]);
    expect(card?.weaknesses).toEqual([{ type: "Fire", value: "×2" }]);
    expect(before.players.p1.active?.damage).toBe(0);
    expect(after.players.p1.active?.damage).toBe(RECOIL);
    expect(after.players.p1.active?.damage).not.toBe(RECOIL * 2);
  });

  it("🛑 on [T,T] the attacker KEEPS its Energy — the consequent is the recoil, not the neighbour's discard (`D521-two-coin-then-copies-the-discard-neighbour`)", () => {
    const { before, after, events } = firstBoardWithFaces(TT);
    expect(before.players.p1.active?.energy).toHaveLength(1);
    expect(after.players.p1.active?.energy).toHaveLength(1);
    expect(types(events)).not.toContain("ENERGY_DISCARDED");
    expect(after.players.p1.active?.damage).toBe(RECOIL);
  });

  it("🛑 no `ATTACK_EFFECT_SKIPPED` on any board — the sentence is READ, not skipped", () => {
    for (const faces of FACES) {
      expect(types(firstBoardWithFaces(faces).events), faces.join("-")).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
  });

  it("🛑 an attack ENDS the turn (D491) — on every non-KO board the phase is p2's action phase on turn 3", () => {
    for (const faces of FACES) {
      const { after, events } = firstBoardWithFaces(faces);
      expect(after.phase, faces.join("-")).toEqual({ kind: "turn:action", seat: "p2" });
      expect(after.turn).toBe(3);
      expect(types(events)).toContain("TURN_ENDED");
      expect(types(events)).not.toContain("KNOCKED_OUT");
    }
  });

  it("🛑 `programPlayable` is TRUE with an EMPTY Bench — nothing in the program parks or needs a target", () => {
    const state = table(firstBoardWithFaces(TT).seed);
    expect(state.players.p1.bench).toHaveLength(0);
    expect(programPlayable(state, PROGRAM, "p1")).toBe(true);
    expect(programPlayable(state, PROGRAM, "p1", activeUid(state, "p1"))).toBe(true);
  });

  it("🛑 the 50-amount print recoils exactly 50 on its own [T,T] board (`D521-two-coin-arm-pins-the-amount`)", () => {
    const { after, events } = firstBoardWithFaces(TT, { attacker: "d521-fifty" });
    expect(facesOf(events)).toEqual([...TT]);
    expect(after.players.p1.active?.damage).toBe(50);
    expect(after.players.p2.active?.damage).toBe(60);
    expect(recoilRows(events)).toEqual([{ seat: "p1", amount: 50 }]);
    // …and on a non-unanimous board the fifty-print recoils nothing either.
    const { after: mixed } = firstBoardWithFaces(HT, { attacker: "d521-fifty" });
    expect(mixed.players.p1.active?.damage).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2b — the self-KO, swept by the attack epilogue, and the turn sequenced explicitly.
// ─────────────────────────────────────────────────────────────────────────────

describe("D521 §2b — the self-KO on a pre-damaged body, and the turn ends only after the Prize and the promotion", () => {
  it("🛑 130 HP, 40 prior, 90 recoil on [T,T] — the attacker is Knocked Out by the epilogue's two-seat §8.1 sweep", () => {
    // D134's fixture-HP trap turned into the case it warns about: a fresh body survives, a
    // body carrying >= 40 does not, so the KO is one `setDamage` away and never accidental.
    const { seed } = firstBoardWithFaces(TT);
    const before = table(seed, { self: 40, bench: true });
    const attacker = activeUid(before, "p1");
    const { state: after, events } = mustApply(before, { type: "attack", seat: "p1", index: 1 });
    expect(facesOf(events)).toEqual([...TT]);
    expect(events.find((e) => e.type === "KNOCKED_OUT")).toMatchObject({ seat: "p1", uid: attacker });
    expect(after.players.p1.discard).toContain(attacker);
    // The defender took the base and is NOT out — a PURE self-KO.
    expect(after.players.p2.active?.damage).toBe(BASE);
    // ⚠️ AN ATTACK ENDS THE TURN, BUT NOT YET: the KO interrupts with its own queue behind it.
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    expect(after.pending.map((s) => s.kind)).toEqual(["takePrizes", "promote", "endTurn", "checkup", "startTurn"]);
    expect(types(events)).not.toContain("TURN_ENDED");
    // Drive it out: p2 takes its Prize, p1 force-promotes its lone benched body, THEN the turn passes.
    const next = must(applyAction(after, { type: "takePrizes", seat: "p2", prizeIndices: [0] }));
    expect(next.players.p2.prizes).toHaveLength(5);
    expect(next.players.p1.active).not.toBeNull();
    expect(next.players.p1.active?.stack).not.toContain(attacker);
    expect(next.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 the SAME primed board on [H,H] survives — the coins are the whole difference", () => {
    const { seed } = firstBoardWithFaces(HH);
    const before = table(seed, { self: 40, bench: true });
    const attacker = activeUid(before, "p1");
    const { state: after, events } = mustApply(before, { type: "attack", seat: "p1", index: 1 });
    expect(facesOf(events)).toEqual([...HH]);
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(activeUid(after, "p1")).toBe(attacker);
    expect(after.players.p1.active?.damage).toBe(40);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 a fresh body with 30 prior SURVIVES the recoil at exactly 120 of 130 — the KO threshold is 40, measured", () => {
    const { seed } = firstBoardWithFaces(TT);
    const before = table(seed, { self: 30, bench: true });
    const { state: after, events } = mustApply(before, { type: "attack", seat: "p1", index: 1 });
    expect(facesOf(events)).toEqual([...TT]);
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(after.players.p1.active?.damage).toBe(120);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the census figures, with their units.
// ─────────────────────────────────────────────────────────────────────────────

describe("D521 §3 — the census moved in exactly ONE summand, by 1 sentence / 2 printings", () => {
  it("🛑 the reader arm reads 548 sentences / 1,589 printings, and the row is IN it", () => {
    const resolved = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    // 🆕🆕🆕 D522 +1 sentence / +1 printing (THE STADIUM-GATED BENCH SPREAD WITH THE STADIUM DISCARD —
    // corpus FILE LINE 293, claimed by `deriveAttackEffect` arm 43-bis through
    // `STADIUM_GATED_BENCH_SPREAD`; the sentence and printing steps AGREE, 1 and 1): 548/1589 →
    // 549/1590 and 547/1587 → 548/1588. ⚠️ This suite's own literals sat OUTSIDE the annotated-chain
    // sweep's shape (they were never annotated at D521) and were found by the full `check` (D419).
    // 🆕🆕🆕 D523 +1 sentence / +1 printing (THE DECK-DESTINATION DISCARD-PILE RETRIEVAL — corpus
    // FILE LINE 485, *"Shuffle up to 3 Basic {W} Energy cards from your discard pile into your
    // deck."*, claimed by `deriveAttackEffect` through `ATTACK_DISCARD_SHUFFLE_BACK`, the arm after
    // the D237 arm — Pal Pad's registry pair with the hand twin's filter, ZERO new vocabulary; the
    // sentence and printing steps AGREE, 1 and 1): 549/1590 → 550/1591 and 548/1588 → 549/1589.
    // 🆕🆕🆕 D524 +1 sentence / +1 printing (THE PURPOSE-CONNECTIVE OPTIONAL-COST BOOST WITH THE
    // ALL-SELF-ENERGY-TO-HAND COST — corpus FILE LINE 652, *"You may put all Energy attached to this
    // Pokémon into your hand to have this attack do 80 more damage."*, claimed by
    // `deriveAttackOptionalCostBoost` through the purpose skeleton over one new cost-table row, ZERO
    // new vocabulary; the sentence and printing steps AGREE, 1 and 1): 550/1591 → 551/1592 and
    // 549/1589 → 550/1590. Stepped by hand again (outside the annotated-chain sweep's shape).
    expect([resolved.length, units(resolved)]).toEqual([551, 1592]);
    expect(resolved.map(([, s]) => s)).toContain(PRINTED);
    // …and the step is THIS sentence and nothing else: remove it and the pair is D520's.
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([without.length, units(without)]).toEqual([550, 1590]);
  });

  it("🛑 the RAW reader-only residue fell by exactly 1 sentence / 2 printings — 92 / 143 — and the row left it", () => {
    const unbuilt = legalAttackCorpus().filter(([, s]) => !resolvedByAnyReader(s));
    // 🆕🆕🆕 D522 −1 sentence / −1 printing (corpus FILE LINE 293, see §3's first rung): 92/143 → 91/142.
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

  it("🛑 the move is READER-keyed: no registry row, no gate clause, no trailing split claims the row", () => {
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the version, the heading, and what stands still.
// ─────────────────────────────────────────────────────────────────────────────

const RAW: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string,
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob("./{censusAttackCorpus,index,effects}.ts", { query: "?raw", import: "default", eager: true });

describe("D521 §4 — the version steps, the heading is written, and what stands still", () => {
  it("engineVersion and `manifest.version` agree, and the bump is owed for BEHAVIOUR", () => {
    // ⚠️ The version is NOT spelled in this `it(…)` title (D460's fourth class).
    expect(engineVersion).toBe("0.411.0");
    expect(manifest.version).toBe(engineVersion);
  });

  it("🛑 the changelog heading for this bump is present in `index.ts`, labelled with its decision", () => {
    const index = Object.entries(RAW).find(([k]) => k.endsWith("/index.ts"))?.[1] ?? "";
    expect(index.length).toBeGreaterThan(1_000_000);
    expect(index).toContain("engineVersion 0.407.0 → **0.408.0** (D521");
  });

  it("🛑 the stale 'out of reach by COLUMN' claim is corrected IN PLACE in both prose copies (D442/D508)", () => {
    const effects = Object.entries(RAW).find(([k]) => k.endsWith("/effects.ts"))?.[1] ?? "";
    const index = Object.entries(RAW).find(([k]) => k.endsWith("/index.ts"))?.[1] ?? "";
    expect(effects).toContain("THAT SENTENCE WAS FALSE THE DAY IT WAS");
    expect(index).toContain("THE PARENTHETICAL IS CORRECTED IN PLACE (D442/D508)");
    // …and the anchor's own commentary does NOT spell the `op: "…",` form (D516/D520 (4)): the
    // raw producer count of the two ops reads CODE — one new site each.
    expect(effects.split('op: "coinFlipGate",').length - 1).toBe(21);
    expect(effects.split('op: "damageSelf",').length - 1).toBe(6);
  });

  it("🛑 `MATCH_RECORD_VERSION` HOLDS at 30: zero new serialized bytes, `damageSelf` never parks, the gate is spliced", () => {
    // Every kind, field and value in the program already ships (`coins` since D355, `onTails`
    // since D144), so the program survives a JSON round trip unchanged and a v30 deploy could
    // already have written it.
    expect(JSON.parse(JSON.stringify(PROGRAM))).toEqual(PROGRAM);
    // The declaration never parks: no board above ended in `effect:choose`.
    for (const faces of FACES) {
      expect(firstBoardWithFaces(faces).after.phase.kind, faces.join("-")).not.toBe("effect:choose");
    }
  });

  it("🛑 the demonstrator is FILE-LOCAL — zero `FIXTURE_POOL` ids, the shared pool untouched, the deck is 60", () => {
    expect(Object.keys(TWO_COIN_CARDS).every((id) => FIXTURE_POOL[id] === undefined)).toBe(true);
    expect(TWO_COIN_DECK).toHaveLength(60);
    // HP on D134's trap, stated as the arithmetic: fresh survives once, >= 40 prior does not.
    expect(HP - RECOIL).toBe(40);
    expect(HP - 2 * RECOIL).toBeLessThan(0);
  });
});
