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
import type { EffectOp } from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import type { PokemonRef } from "./interpreter";
import {
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  battler,
  benchFromDeck,
  benchTopUid,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  types,
} from "./testFixtures";

// 0.415.0 → 0.416.0 — 🆕🆕🆕 D530: THE TARGET-COUNTER-SCALED BENCH SNIPE — A FOURTH RIDER ON
// `damageChosen`, THE FIRST WHOSE MULTIPLIER IS A FACT ABOUT THE BODY THE PLAYER HAS NOT CHOSEN YET.
//
// *"This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on
// that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"* —
// `censusAttackCorpus.ts` **FILE LINE 551** (`legalAttackCorpus()` index 498, asserted from the
// module in §2), **1 sentence / 1 legal printing** (no catalog id on this checkout — the demonstrator
// below is FILE-LOCAL and DECLARED, no id is invented, D425), claimed by `deriveAttackEffect` through
// ONE new anchor (`BENCHED_SNIPE_TARGET_COUNTERS`, beside `BENCHED_SNIPE_TAKEN_PRIZES`, same
// construction, disjoint by TAIL) as arm 6b′, ONE whole literal:
//
//   [{ op: "damageChosen", target: "opponentBench", amount: 20, count: 1, source: "attack",
//      deals: true, perDamageCounterOnTarget: true }]
//
// 🛑 **THE REFUSAL ON RECORD — "THE ARITY OF THE FOLD" — WAS A DESCRIPTION OF ONE CALL SITE, NOT A
// BLOCKER.** Four suites (`scaledAnySnipe` (b), `handDiscardScaledSnipe` (ii), `counterBenchPut`'s
// `NEAR_MISSES`, `classNarrowedBenchSnipe`'s saturating rung) held the row out because *"`snipeAmount`
// would need a fourth argument that does not exist until `applyChoice`, and the prompt could not quote
// its own number"*. Both halves are true and neither blocks: the fourth argument EXISTS at both sites
// where damage is dealt (`candidates[]` at `stepOp`'s forced branch, `choice.refs` at `applyChoice`),
// each pick folding ITS OWN counters; and the caption quotes the printed RULE rather than a number —
// D489's `handCostPhrase` precedent. All four are RE-POINTED, never deleted (D418), each asked what its
// OLD claim caught: the saturating form still claims the row on the class arm (that is still the
// WRONG reason and the measurement is kept), and the reader-surface refusals become the program equality.
//
// 🛑 **A DECIDED DISCREPANCY, PINNED (conventions "Deciding a discrepancy").** The card does not narrow
// to damaged bodies — D437's `damagedOnly` would be AUTHORING a window the print does not carry — so
// an UNDAMAGED body is still a candidate and the op still parks over it. Choosing it is choosing 20 × 0:
// `placeSnipe`'s `if (amount <= 0) return state;` deals nothing and files NO `DAMAGE_DEALT`, and no
// `ATTACK_EFFECT_SKIPPED` either (the program ran; the pick was answered). §4 (v) drives it.
//
// `MATCH_RECORD_VERSION` HELD at 30 (§3): the rider rides `phase.cont.pendingOp` — this op PARKS on a
// two-body Bench — but it is a WIDENING at a persisted address (D448/D489's serialized-alphabet
// argument): every v30 byte string is unchanged, absence still means unscaled, the new value is
// unreachable backwards; driven over v30 bytes in three directions rather than inherited.

/** Corpus FILE LINE 551, byte for byte. Asserted off the corpus in §2, never retyped elsewhere. */
const PRINTED =
  "This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** The same skeleton at a different printed amount — the amount is CAPTURED, not pinned. Constructed. */
const at = (n: number): string => PRINTED.replace("does 20 damage", `does ${n} damage`);
/** The FLAT sibling this anchor must NOT be confused with — the un-scaled `1 of` snipe arm 6c reads
    (`ALSO_BENCHED_SNIPE`, `(?:also )?`). Constructed at this amount (the column prints other amounts). */
const FLAT =
  "This attack does 20 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** D437's window sibling — corpus FILE LINE 528, 3 legal printings: the SAME noun phrase with a
    candidate NARROWING where this row has a MULTIPLIER (and the rider's `also`). Derives its OWN op
    (`damagedOnly`). Transcribed off the column, asserted there in §1. */
const WINDOW_SIBLING =
  "This attack also does 60 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** The Prize sibling — Wo-Chien ex "Covetous Ivy", arm 6b: the SAME head with the OTHER tail. */
const PRIZE_SIBLING =
  "This attack does 40 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken.";
/** The SAME multiplier spelled on the ATTACKER — a corpus row, 7 legal printings — which stays on
    ITS reader (`deriveAttackDamageMultiplier`, the "×" family's `damageCountersOnSelf`), not this one. */
const SELF_COUNTERS = "This attack does 20 damage for each damage counter on this Pokémon.";

/** THE PROGRAM, spelled once — key order as arm 6b′ emits it. */
const PROGRAM: readonly EffectOp[] = [
  {
    op: "damageChosen",
    target: "opponentBench",
    amount: 20,
    count: 1,
    source: "attack",
    deals: true,
    perDamageCounterOnTarget: true,
  },
];
const program = (amount: number): readonly EffectOp[] => [{ ...(PROGRAM[0] as EffectOp), amount } as EffectOp];

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

/** The anchor, re-spelled HERE as the whole-sentence claim it makes over the column (§1's claimed-set
    rung) — the ASCII-apostrophe form, which is what the column prints. */
const ANCHOR =
  /^This attack does (\d+) damage to 1 of your opponent['’]s Benched Pokémon for each damage counter on that Pokémon\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/;

// ─────────────────────────────────────────────────────────────────────────────
// The demonstrator — a FILE-LOCAL pool and its own deck (D414/D452/D520–D528).
// ─────────────────────────────────────────────────────────────────────────────

/** DECLARED, not read: the printing's base and cost are unresolvable here (no D1, no `FIXTURE_POOL`
    id). The attack prints NO base damage — the scaled snipe is the whole hit. */
const SNIPER = "d530-sniper";
const PLAIN = "fix-energy";
/** P2's Active — 400 HP, no W/R, never a candidate. */
const WALL = "d530-wall";
/** P2's Bench body — 300 HP Colorless, no Weakness: 140 lands without a KO. */
const PAL = "d530-pal";
/** P2's OTHER Bench body — 300 HP with ×2 LIGHTNING Weakness (the attacker is {L}): the §8.5 control,
    a Bench target that W/R must NOT touch. */
const WEAK = "d530-weak";
/** The control's printed base. */
const JAB = 30;

const SNIPE_CARDS: Record<string, Card> = {
  [SNIPER]: battler(SNIPER, {
    name: "D530 Sniper",
    types: ["Lightning"],
    hp: 130,
    retreat: 2,
    attacks: [
      /** index 0 — FILE LINE 551 verbatim, with a DECLARED cost and NO base. */
      { cost: ["Colorless"], name: "Counter Snipe", effect: PRINTED },
      /** index 1 — the control: a flat hit on the Active, no effect, no program. */
      { cost: ["Colorless"], name: "Plain Jab", damage: JAB },
    ],
  }),
  [WALL]: battler(WALL, { name: "D530 Wall", types: ["Colorless"], hp: 400 }),
  [PAL]: battler(PAL, { name: "D530 Pal", types: ["Colorless"], hp: 300 }),
  [WEAK]: battler(WEAK, {
    name: "D530 Weakling",
    types: ["Water"],
    hp: 300,
    weaknesses: [{ type: "Lightning", value: "×2" }],
  }),
};

const SNIPE_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...SNIPE_CARDS };

/** Its own deck (D270), 60 counted before the first run: 8 + 8 + 12 + 4 + 28. */
const SNIPE_DECK = deckOf({
  [SNIPER]: 8,
  [WALL]: 8,
  [PAL]: 12,
  [WEAK]: 4,
  [PLAIN]: 28,
});

/** The opening shuffle only — nothing on this board flips a coin (stated, D523 (8)). */
const SEED = 7;

function openTable(seed: number, first: Seat): GameState {
  const created = createGame({
    seed,
    decks: { p1: SNIPE_DECK, p2: SNIPE_DECK },
    cardPool: SNIPE_POOL,
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

type Body = { readonly id: string; readonly damage: number };
const pal = (damage: number): Body => ({ id: PAL, damage });
const weak = (damage: number): Body => ({ id: WEAK, damage });

/** p1 owns TURN 2 with the sniper Active holding ONE Colorless Basic (the {C} cost); P2 went first.
    Both Benches are CLEARED after the Active surgeries (`setActiveFromDeck` displaces onto the Bench),
    then P2's Bench is refilled from `bench` in order and each body's damage is SURGERED to the HP named
    (the unit under test is COUNTERS = floor(damage / 10), so the surgery is in HP on purpose). */
function table(bench: readonly Body[]): GameState {
  let state = openTable(SEED, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  if (state.turn !== 2) throw new Error(`expected turn 2, got ${String(state.turn)}`);
  state = setActiveFromDeck(state, "p1", SNIPER);
  state = setActiveFromDeck(state, "p2", WALL);
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  bench.forEach((body, i) => {
    state = benchFromDeck(state, "p2", body.id);
    state = setBenchDamage(state, "p2", i, body.damage);
  });
  state = attachFromDeck(state, "p1", PLAIN, 1);
  return state;
}

type Swing = { before: GameState; after: GameState; events: GameEvent[] };

function swing(bench: readonly Body[], index = 0): Swing {
  const before = table(bench);
  const { state: after, events } = mustApply(before, { type: "attack", seat: "p1", index });
  return { before, after, events };
}

function multiPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "choosePokemonMulti") {
    throw new Error(`expected choosePokemonMulti, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}
function continuation(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
  return state.phase.cont;
}
const benchRef = (index: number): PokemonRef => ({ seat: "p2", spot: { spot: "bench", index } });
const activeRef: PokemonRef = { seat: "p2", spot: { spot: "active" } };

/** Answer the parked choosePokemonMulti with ONE body. */
const pick = (state: GameState, ref: PokemonRef, seat: Seat = "p1") =>
  mustApply(state, { type: "resolveEffect", seat, choice: { kind: "pokemonMulti", refs: [ref] } });

function dealtRows(events: readonly GameEvent[]) {
  return events.filter((e): e is Extract<GameEvent, { type: "DAMAGE_DEALT" }> => e.type === "DAMAGE_DEALT");
}
const benchDamage = (state: GameState) => state.players.p2.bench.map((b) => b.damage);

/** THE CAPTION, MEASURED ONCE and pinned byte for byte: `snipeNote` with the rider set — the printed
    RULE, no number × N (`D530-caption-drops-the-rule`). */
const CAPTION = "Choose 1 of your opponent's Benched Pokémon (20 damage for each damage counter on it).";

// ─────────────────────────────────────────────────────────────────────────────
// §1 — reading: the exact program, the captured amount, the near-misses, the siblings, the claimed set.
// ─────────────────────────────────────────────────────────────────────────────

describe("D530 §1 — file line 551 derives to EXACTLY the count-1 opponentBench snipe with `perDamageCounterOnTarget`", () => {
  it("🛑 the row derives to the program byte for byte, with EXACTLY these seven keys (`D530-arm-drops-the-rider`)", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
    const got = deriveAttackEffect(PRINTED);
    if (got === null) throw new Error("the row derived null");
    expect(got).toHaveLength(1);
    expect(Object.keys(got[0] ?? {}).sort()).toEqual([
      "amount",
      "count",
      "deals",
      "op",
      "perDamageCounterOnTarget",
      "source",
      "target",
    ]);
    const op = got[0] as Record<string, unknown>;
    expect(op.perDamageCounterOnTarget).toBe(true);
    // The sibling riders are ABSENT, not false — an absent key and `false` would be two spellings.
    for (const absent of ["perTakenPrize", "perEnergyOnSelf", "perRecorded", "damagedOnly", "ignoreWR", "filter", "optional"]) {
      expect(absent in op, absent).toBe(false);
    }
    // …and it is the ASCII-apostrophe print that is in the column; the curly one is a constructed twin
    // the `['’]` slots also admit (the column prints only the former — measured).
    const curly = PRINTED.replace("opponent's", "opponent’s").replace("Don't", "Don’t");
    expect(curly).not.toBe(PRINTED);
    expect(deriveAttackEffect(curly)).toEqual(PROGRAM);
    expect(legalAttackCorpus().some(([, s]) => s === curly)).toBe(false);
  });

  it("🛑 the amount is CAPTURED, not pinned — 10, 30 and 50 derive at 10, 30 and 50; a printed 0 stays on the LOUD path (`D530-arm-admits-a-printed-zero`)", () => {
    expect(deriveAttackEffect(at(10))).toEqual(program(10));
    expect(deriveAttackEffect(at(30))).toEqual(program(30));
    expect(deriveAttackEffect(at(50))).toEqual(program(50));
    expect(deriveAttackEffect(at(0))).toBeNull();
    expect(resolvedByAnyReader(at(0))).toBe(false);
    // The one-character control: the same sentence at 1 derives.
    expect(deriveAttackEffect(at(1))).toEqual(program(1));
    for (const s of [at(10), at(30), at(50), at(0), at(1)]) {
      expect(legalAttackCorpus().some(([, t]) => t === s), s).toBe(false);
    }
  });

  it("🛑 `deriveAttackEffect` is the ONLY claimant — twelve readers and four splitters are null — and the reader surface is still THIRTEEN", () => {
    for (const reader of READERS) {
      if (reader === deriveAttackEffect) continue;
      expect(reader(PRINTED), reader.name).toBeNull();
    }
    for (const splitter of SPLITTERS) expect(splitter(PRINTED), splitter.name).toBeNull();
    expect(deriveAttackEffect(PRINTED)).not.toBeNull();
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(attackReaderSurface()).toHaveLength(13);
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
  });

  it("🛑 the anchor is WHOLE-SENTENCE at BOTH ends: a PREFIXED and a SUFFIXED print are null on every reader and every splitter (`D530-anchor-loses-the-head` / `-anchor-loses-the-tail`)", () => {
    const prefixed = `Draw a card. ${PRINTED}`;
    const suffixed = `${PRINTED} Draw a card.`;
    for (const s of [prefixed, suffixed]) {
      expect(legalAttackCorpus().some(([, t]) => t === s), s).toBe(false);
      for (const reader of READERS) expect(reader(s), `${reader.name} on ${s.slice(0, 12)}…`).toBeNull();
      for (const splitter of SPLITTERS) expect(splitter(s), `${splitter.name} on ${s.slice(0, 12)}…`).toBeNull();
      expect(resolvedByAnyReader(s), s).toBe(false);
    }
    // ⚠️ MEASURED, not assumed: unlike D528's row, the trailing splitter does NOT compose on the
    // suffixed print here (its own guard refuses this head), so the suffixed sentence is null
    // everywhere rather than `{head, tail}` — pinned as read.
    expect(splitAttackTrailingClause(suffixed)).toBeNull();
  });

  it("🛑 the single-axis near-misses: `2 of`, `Pokémon` without `Benched`, and `on this Pokémon` are null on EVERY reader — none is a printed sentence", () => {
    const twoOf = PRINTED.replace("to 1 of", "to 2 of");
    const unbenched = PRINTED.replace("Benched Pokémon for", "Pokémon for");
    const onThis = PRINTED.replace("on that Pokémon", "on this Pokémon");
    for (const s of [twoOf, unbenched, onThis]) {
      expect(s).not.toBe(PRINTED);
      expect(legalAttackCorpus().some(([, t]) => t === s), s).toBe(false);
      for (const reader of READERS) expect(reader(s), `${reader.name}: ${s.slice(24, 60)}`).toBeNull();
      expect(resolvedByAnyReader(s), s).toBe(false);
    }
    // The literal `1 of` is what keeps a count-2 per-target fold UNPRINTED and UNREACHABLE from the
    // deriver — the per-ref fold in the interpreter is what keeps a registry-authored one honest.
    expect(deriveAttackEffect(twoOf)).toBeNull();
  });

  it("🛑 the D465-family spelling of the SAME multiplier on the ATTACKER stays on ITS reader — an INEQUALITY, not a null (it is a printed row, 7 legal printings)", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(SELF_COUNTERS)).toBe(7);
    expect(resolvedByAnyReader(SELF_COUNTERS)).toBe(true);
    // Not THIS reader: the head is "does N damage for each", not "does N damage to 1 of".
    expect(deriveAttackEffect(SELF_COUNTERS)).toBeNull();
    expect(deriveAttackDamageMultiplier(SELF_COUNTERS)).toEqual({ per: 20, count: { kind: "damageCountersOnSelf" } });
    expect(deriveAttackDamageMultiplier(PRINTED)).toBeNull();
    expect(deriveAttackDamageBonus(PRINTED)).toBeNull();
  });

  it("🛑 the three SIBLINGS on the same noun phrase each keep their OWN op — inequality rungs in every direction (D418's second half)", () => {
    // The FLAT `1 of` snipe (arm 6c): the same seven keys minus the rider, and NOT this program.
    expect(deriveAttackEffect(FLAT)).toEqual([
      { op: "damageChosen", target: "opponentBench", amount: 20, count: 1, source: "attack", deals: true },
    ]);
    expect(deriveAttackEffect(FLAT)).not.toEqual(PROGRAM);
    // D437's window sibling (corpus FILE LINE 528): a candidate NARROWING, not a multiplier.
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(WINDOW_SIBLING)).toBe(3);
    expect(deriveAttackEffect(WINDOW_SIBLING)).toEqual([
      { op: "damageChosen", target: "opponentBench", amount: 60, count: 1, source: "attack", deals: true, damagedOnly: true },
    ]);
    expect(deriveAttackEffect(WINDOW_SIBLING)?.[0]).not.toHaveProperty("perDamageCounterOnTarget");
    // Covetous Ivy (arm 6b): the OTHER tail, the OTHER rider.
    expect(deriveAttackEffect(PRIZE_SIBLING)).toEqual([
      { op: "damageChosen", target: "opponentBench", amount: 40, count: 1, source: "attack", deals: true, perTakenPrize: true },
    ]);
    expect(deriveAttackEffect(PRIZE_SIBLING)?.[0]).not.toHaveProperty("perDamageCounterOnTarget");
    expect(deriveAttackEffect(PRINTED)?.[0]).not.toHaveProperty("perTakenPrize");
    expect(deriveAttackEffect(PRINTED)?.[0]).not.toHaveProperty("damagedOnly");
  });

  it("🛑 the anchor's claimed set over the legal column is EXACTLY [the row], at `legalAttackCorpus()` index 498 / 1 printing", () => {
    const claimed = legalAttackCorpus().filter(([, s]) => ANCHOR.test(s));
    expect(claimed).toEqual([[1, PRINTED]]);
    expect(legalAttackCorpus().findIndex(([, s]) => s === PRINTED)).toBe(498);
    expect(legalAttackCorpus()[498]).toEqual([1, PRINTED]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — census: the row is resolved, the reader arm stepped by 1/1, the raw residue fell by 1/1.
// ─────────────────────────────────────────────────────────────────────────────

describe("D530 §2 — the census moved in exactly ONE summand, by 1 sentence / 1 printing", () => {
  it("🛑 the reader arm reads 556 sentences / 1,598 printings, and the row is IN it", () => {
    // 🆕🆕🆕 D530's OWN literals, annotated in-slice so the next sweep sees them (D523 (4)–D528):
    // the reader arm 555/1597 → 556/1598 — corpus FILE LINE 551, ⚠️ sentence step 1 / printing step 1.
    const resolved = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    expect([resolved.length, units(resolved)]).toEqual([556, 1598]);
    expect(resolved.map(([, s]) => s)).toContain(PRINTED);
    // ⚠️ THE OWN-ROW `without` PAIR: resolved minus THIS suite's ONE-printing row is 555/1597 (D525 (5)'s
    // trap — the next sweep re-derives this by hand as resolved − its row, never by value).
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([without.length, units(without)]).toEqual([555, 1597]);
  });

  it("🛑 the RAW reader-only residue fell by exactly 1 sentence / 1 printing — 84 / 134 — and the row left it", () => {
    // 🆕🆕🆕 D530's OWN literal (corpus FILE LINE 551, see the rung above): 85/135 → 84/134.
    const unbuilt = legalAttackCorpus().filter(([, s]) => !resolvedByAnyReader(s));
    expect([unbuilt.length, units(unbuilt)]).toEqual([84, 134]);
    expect(unbuilt.map(([, s]) => s)).not.toContain(PRINTED);
    const all = legalAttackCorpus();
    expect(unbuilt.length + 556).toBe(all.length);
    expect(units(unbuilt) + 1598).toBe(units(all));
    expect([all.length, units(all)]).toEqual([640, 1732]);
  });

  it("🛑 the move is READER-keyed: no gate clause, no trailing split, no cancel split, no requirement split claims the row itself", () => {
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the persisted address: a WIDENING, `MATCH_RECORD_VERSION` HELD at 30, driven over v30 bytes.
// ─────────────────────────────────────────────────────────────────────────────

describe("D530 §3 — a new optional rider on a PERSISTED op, and the record version does not move", () => {
  it("🛑 the version PREDICTION, driven over the SERIALIZED BYTES in three directions (scaledAnySnipe §3's shape)", () => {
    // 🛑 WHICH OF THE TWO SITUATIONS THIS IS, ASKED RATHER THAN INHERITED. It is NOT "the type is
    // unpersisted": `damageChosen` PARKS — §4 (i) parks this very op over a two-body Bench — so the
    // literal genuinely rides `GameState.phase.cont.pendingOp` into a stored match record. It is the
    // OTHER situation: a WIDENING, where every value a v30 deploy could have written still means
    // exactly what it meant.
    //
    // DIRECTION 1 — every byte string a v30 deploy could have written is unchanged. No v30 record
    // carries this key, and its ABSENCE has one meaning before and after: an unscaled hit. Driven
    // through JSON rather than asserted on the object, because the claim is about BYTES — and the
    // two pre-slice strings STILL DERIVE from their own printed sentences (the rider was not a rename).
    const preSlice = [
      '{"op":"damageChosen","target":"opponentBench","amount":40,"count":1,"source":"attack","deals":true,"perTakenPrize":true}',
      '{"op":"damageChosen","target":"opponentBench","amount":60,"count":1,"source":"attack","deals":true,"damagedOnly":true}',
    ];
    for (const bytes of preSlice) {
      const revived = JSON.parse(bytes) as EffectOp;
      expect(JSON.stringify(revived)).toBe(bytes); // no key gained, none lost, order kept
    }
    expect(deriveAttackEffect(PRIZE_SIBLING)?.[0]).toEqual(JSON.parse(preSlice[0] as string));
    expect(deriveAttackEffect(WINDOW_SIBLING)?.[0]).toEqual(JSON.parse(preSlice[1] as string));

    // DIRECTION 2 — the NEW value cannot appear in any record an older deploy wrote, and this deploy
    // round-trips it byte for byte.
    const fresh = deriveAttackEffect(PRINTED)?.[0];
    expect(JSON.stringify(fresh)).toBe(
      '{"op":"damageChosen","target":"opponentBench","amount":20,"count":1,"source":"attack","deals":true,"perDamageCounterOnTarget":true}',
    );
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(fresh);

    // DIRECTION 3 — a record that LOSES the key degrades LOUDLY ENOUGH (D421's criterion applied): a
    // dropped rider makes the snipe deal `amount` where the card prints `amount × N` — off by a factor
    // the board can read at ≥ 2 counters, and the dropped op is exactly the FLAT sibling arm 6c derives.
    // ⚠️ It IS invisible at exactly ONE counter (20 × 1 = 20), the same exposure `perTakenPrize` has
    // carried at one taken Prize since Covetous Ivy shipped (D448's caveat) — stated rather than
    // claimed away, and it is why §4 drives the fold at THREE and SEVEN.
    const dropped = JSON.parse(
      JSON.stringify(fresh, (k, v) => (k === "perDamageCounterOnTarget" ? undefined : v)),
    ) as EffectOp;
    expect(dropped).toEqual(deriveAttackEffect(FLAT)?.[0]);
    expect(dropped).not.toEqual(fresh);
  });

  it("🛑 the parked `pendingOp`'s key set, sorted, carries the rider — and nothing else new", () => {
    const parked = swing([pal(30), pal(70)]).after;
    const cont = continuation(parked);
    expect(Object.keys(cont.pendingOp).sort()).toEqual([
      "amount",
      "count",
      "deals",
      "op",
      "perDamageCounterOnTarget",
      "source",
      "target",
    ]);
    expect(Object.keys(cont).sort()).toEqual(["ctx", "pendingOp", "rest"]);
    expect(JSON.stringify(cont.pendingOp)).toBe(JSON.stringify(PROGRAM[0]));
    expect(cont.rest).toEqual([]);
  });

  it("🛑 `MATCH_RECORD_VERSION` is 30 in `apps/api` — a widening, not a new shape", () => {
    const match = Object.entries(RAW).find(([k]) => k.endsWith("/lobby/match.ts"))?.[1] ?? "";
    expect(match).toContain("export const MATCH_RECORD_VERSION = 30;");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the board: the park, the per-target fold at 3 and 7, the forced one-body Bench, the 0-counter
// decision, the refusals, W/R on a Bench target, the rng, the replay, the control.
// ─────────────────────────────────────────────────────────────────────────────

describe("D530 §4 — the pick reads the CHOSEN body's counters: 3 → 60, 7 → 140, on one op, one board", () => {
  it("🛑 the board is what it says: P1's sniper is Active with one Colorless Basic, P2's wall is Active at 0, P2's Bench is Pal(30) and Pal(70), turn 2", () => {
    const before = table([pal(30), pal(70)]);
    expect(before.players.p1.active?.energy).toHaveLength(1);
    expect(before.cardIdByUid[activeUid(before, "p1")]).toBe(SNIPER);
    expect(before.cardIdByUid[activeUid(before, "p2")]).toBe(WALL);
    expect(before.players.p2.active?.damage).toBe(0);
    expect(before.players.p1.bench).toHaveLength(0);
    expect(before.players.p2.bench.map((b) => before.cardIdByUid[b.stack[0] ?? ""])).toEqual([PAL, PAL]);
    expect(benchDamage(before)).toEqual([30, 70]);
    expect(before.turn).toBe(2);
    expect(table([]).players.p2.bench).toHaveLength(0);
  });

  it("🛑 (i) a two-body Bench PARKS: `effect:choose` / `choosePokemonMulti { the two Bench refs, min 1, max 1, declinable false }`, the Active NOT a candidate, the caption quoting the printed RULE (no number × N), NO damage yet, no flip, the turn NOT ended (`D530-caption-drops-the-rule`)", () => {
    const { before, after, events } = swing([pal(30), pal(70)]);
    expect(after.phase.kind).toBe("effect:choose");
    expect(after.phase.kind === "effect:choose" && after.phase.seat).toBe("p1");
    const prompt = multiPrompt(after);
    expect(prompt).toEqual({
      kind: "choosePokemonMulti",
      candidates: [benchRef(0), benchRef(1)],
      min: 1,
      max: 1,
      declinable: false,
      note: CAPTION,
    });
    expect(prompt.candidates.some((ref) => ref.spot.spot === "active")).toBe(false);
    expect(prompt.note).not.toContain(" each)");
    expect(prompt.note).not.toContain("60");
    expect(prompt.note).not.toContain("140");
    expect(dealtRows(events)).toHaveLength(0);
    expect(types(events)).toEqual(["ATTACK_DECLARED", "EFFECT_PENDING"]);
    expect(benchDamage(after)).toEqual([30, 70]);
    expect(after.players.p2.active?.damage).toBe(0);
    expect(after.rngState).toBe(before.rngState);
    expect(continuation(after).pendingOp).toEqual(PROGRAM[0]);
  });

  it("🛑 (ii) answer index 0 (3 counters) → 60 dealt to THAT body ONLY: one `DAMAGE_DEALT { base 60, dealt 60 }` on its uid, the other body UNMOVED, the turn ends (`D530-fold-ignores-the-target` / `-answer-passes-no-ref`)", () => {
    const { after: parked } = swing([pal(30), pal(70)]);
    const { state, events } = pick(parked, benchRef(0));
    expect(dealtRows(events)).toHaveLength(1);
    expect(dealtRows(events)[0]).toMatchObject({
      seat: "p2",
      by: "p1",
      uid: benchTopUid(parked, "p2", 0),
      base: 60,
      dealt: 60,
    });
    expect(benchDamage(state)).toEqual([90, 70]);
    expect(state.players.p2.active?.damage).toBe(0);
    expect(types(events)).toEqual(["DAMAGE_DEALT", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 (iii) answer index 1 (7 counters) → 140 dealt to THAT body ONLY — the same op, the same board, a DIFFERENT number: the multiplier is the TARGET's", () => {
    const { after: parked } = swing([pal(30), pal(70)]);
    const { state, events } = pick(parked, benchRef(1));
    expect(dealtRows(events)).toHaveLength(1);
    expect(dealtRows(events)[0]).toMatchObject({ uid: benchTopUid(parked, "p2", 1), base: 140, dealt: 140 });
    expect(benchDamage(state)).toEqual([30, 210]);
    // …and the unit is COUNTERS with the house FLOOR: a body at 65 HP of damage carries SIX counters
    // (`damageCountersOn`), so the pick deals 120 and not 130 (`D530-fold-counts-the-attacker`
    // reads 0 here — the attacker is undamaged — and deals nothing).
    const floored = pick(swing([pal(65), pal(70)]).after, benchRef(0));
    expect(dealtRows(floored.events)[0]).toMatchObject({ base: 120, dealt: 120 });
    expect(benchDamage(floored.state)).toEqual([185, 70]);
  });

  it("🛑 (iv) a ONE-body Bench is FORCED — no park, no phase, 20 × its counters dealt inline, the turn ends (`D530-forced-branch-passes-the-flat-amount`)", () => {
    const { after, events } = swing([pal(70)]);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(dealtRows(events)).toHaveLength(1);
    expect(dealtRows(events)[0]).toMatchObject({ uid: benchTopUid(after, "p2", 0), base: 140, dealt: 140 });
    expect(benchDamage(after)).toEqual([210]);
    expect(types(events)).toEqual(["ATTACK_DECLARED", "DAMAGE_DEALT", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    // A second one-body board at a different count, so 140 is not confusable with a constant.
    const three = swing([pal(30)]);
    expect(dealtRows(three.events)[0]).toMatchObject({ base: 60, dealt: 60 });
    expect(benchDamage(three.after)).toEqual([90]);
  });

  it("🛑 (v) THE DECIDED DISCREPANCY: a one-body Bench at 0 counters is still forced — NO `DAMAGE_DEALT`, no park, no `ATTACK_EFFECT_SKIPPED`, the body UNMOVED, the turn ends; and on a two-body Bench the undamaged body is STILL a candidate and choosing it deals nothing", () => {
    const { after, events } = swing([pal(0)]);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(dealtRows(events)).toHaveLength(0);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).toEqual(["ATTACK_DECLARED", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(benchDamage(after)).toEqual([0]);
    // The card does NOT narrow to damaged bodies (D437's `damagedOnly` would be authoring): the
    // undamaged body is offered beside the damaged one, and picking it is picking 20 × 0.
    const { after: parked } = swing([pal(0), pal(30)]);
    expect(multiPrompt(parked).candidates).toEqual([benchRef(0), benchRef(1)]);
    const zero = pick(parked, benchRef(0));
    expect(dealtRows(zero.events)).toHaveLength(0);
    expect(types(zero.events)).toEqual(["TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(benchDamage(zero.state)).toEqual([0, 30]);
    const thirty = pick(parked, benchRef(1));
    expect(dealtRows(thirty.events)[0]).toMatchObject({ base: 60, dealt: 60 });
    expect(benchDamage(thirty.state)).toEqual([0, 90]);
  });

  it("🛑 (vi) an EMPTY opponent Bench is a silent no-op — no park, no damage, no skip, the turn ends", () => {
    const { after, events } = swing([]);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(dealtRows(events)).toHaveLength(0);
    expect(types(events)).toEqual(["ATTACK_DECLARED", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(after.players.p2.active?.damage).toBe(0);
  });

  it("🛑 (vii) the refusals at the park: the Active's ref, TWO refs, an empty pick, and the wrong seat are all refused and the board is UNMOVED", () => {
    const { after: parked } = swing([pal(30), pal(70)]);
    const refuse = (refs: PokemonRef[], seat: Seat = "p1") =>
      applyAction(parked, { type: "resolveEffect", seat, choice: { kind: "pokemonMulti", refs } });
    expect(refuse([activeRef]).ok).toBe(false);
    expect(refuse([benchRef(0), benchRef(1)]).ok).toBe(false);
    expect(refuse([]).ok).toBe(false);
    expect(refuse([benchRef(0)], "p2").ok).toBe(false);
    expect(refuse([{ seat: "p1", spot: { spot: "active" } }]).ok).toBe(false);
    expect(benchDamage(parked)).toEqual([30, 70]);
    expect(parked.phase.kind).toBe("effect:choose");
  });

  it("🛑 (viii) §8.5 — a Bench target's ×2 Weakness to the {L} attacker is NOT applied: the Weakling at 3 counters takes 60, not 120", () => {
    const { after: parked } = swing([weak(30), pal(70)]);
    const { state, events } = pick(parked, benchRef(0));
    expect(state.cardIdByUid[benchTopUid(parked, "p2", 0)]).toBe(WEAK);
    expect(dealtRows(events)).toHaveLength(1);
    expect(dealtRows(events)[0]).toMatchObject({ base: 60, dealt: 60 });
    expect(benchDamage(state)).toEqual([90, 70]);
    // …and the Weakness is REAL on this body: the control's flat jab on the same card as ACTIVE doubles.
    let control = table([]);
    control = setActiveFromDeck(control, "p2", WEAK);
    control = clearBench(control, "p2");
    const jab = mustApply(control, { type: "attack", seat: "p1", index: 1 });
    expect(dealtRows(jab.events)[0]).toMatchObject({ base: JAB, dealt: JAB * 2 });
  });

  it("🛑 (ix) `rngState` is UNTOUCHED through the park and the pick — nothing on this board flips", () => {
    const { before, after } = swing([pal(30), pal(70)]);
    expect(after.rngState).toBe(before.rngState);
    expect(pick(after, benchRef(1)).state.rngState).toBe(before.rngState);
    const forced = swing([pal(70)]);
    expect(forced.after.rngState).toBe(forced.before.rngState);
  });

  it("🛑 (x) replays identically — the same parked board and events twice; the parked state JSON round-trips BYTE-EQUAL and resumes from its bytes to the same 140", () => {
    const a = swing([pal(30), pal(70)]);
    const b = swing([pal(30), pal(70)]);
    expect(b.after).toEqual(a.after);
    expect(b.events).toEqual(a.events);
    const persisted = JSON.parse(JSON.stringify(a.after)) as GameState;
    expect(persisted).toEqual(a.after);
    expect(JSON.stringify(persisted)).toBe(JSON.stringify(a.after));
    const live = pick(a.after, benchRef(1));
    const replayed = pick(persisted, benchRef(1));
    expect(replayed.events).toEqual(live.events);
    expect(replayed.state).toEqual(live.state);
    expect(dealtRows(replayed.events)[0]).toMatchObject({ base: 140, dealt: 140 });
  });

  it("🛑 (xi) the index-1 control: the flat jab on the Active, no park, no Bench damage, `rngState` UNMOVED, the turn ends", () => {
    const { before, after, events } = swing([pal(30), pal(70)], 1);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(after.rngState).toBe(before.rngState);
    expect(types(events)).toEqual(["ATTACK_DECLARED", "DAMAGE_DEALT", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(dealtRows(events)[0]).toMatchObject({ uid: activeUid(before, "p2"), base: JAB, dealt: JAB });
    expect(benchDamage(after)).toEqual([30, 70]);
  });

  it("never mutates the state it was given (purity — through the park and the pick)", () => {
    const before = table([pal(30), pal(70)]);
    const frozen = JSON.stringify(before);
    const { state: parked } = mustApply(before, { type: "attack", seat: "p1", index: 0 });
    expect(JSON.stringify(before)).toBe(frozen);
    const parkedBytes = JSON.stringify(parked);
    pick(parked, benchRef(1));
    expect(JSON.stringify(parked)).toBe(parkedBytes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — `programPlayable` is UNCHANGED: the grey-out reads `snipeTargets` only.
// ─────────────────────────────────────────────────────────────────────────────

describe("D530 §5 — the grey-out funnel reads only `snipeTargets`: a damage-free Bench is still playable, an empty one is not", () => {
  it("🛑 `programPlayable` is TRUE over two undamaged bodies (the card does not narrow to damaged ones) and FALSE over an empty Bench — the rider changes neither answer", () => {
    expect(programPlayable(table([pal(0), pal(0)]), PROGRAM, "p1")).toBe(true);
    expect(programPlayable(table([pal(30), pal(70)]), PROGRAM, "p1")).toBe(true);
    expect(programPlayable(table([]), PROGRAM, "p1")).toBe(false);
    // The FLAT sibling answers identically on every board — the funnel cannot see the rider.
    const flat = deriveAttackEffect(FLAT);
    if (flat === null) throw new Error("the flat sibling derived null");
    for (const bench of [[pal(0), pal(0)], [pal(30), pal(70)], []] as const) {
      expect(programPlayable(table(bench), flat, "p1")).toBe(programPlayable(table(bench), PROGRAM, "p1"));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the version, the changelog heading, the literals this suite drove.
// ─────────────────────────────────────────────────────────────────────────────

const RAW: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string | readonly string[],
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob(["./{censusAttackCorpus,index,effects,interpreter}.ts", "../../../apps/api/src/lobby/match.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("D530 §6 — the version steps and the bytes this suite drove are the bytes that shipped", () => {
  it("engineVersion and `manifest.version` agree, and the bump is owed for BEHAVIOUR", () => {
    // ⚠️ The version is NOT spelled in this `it(…)` title (D460's fourth class).
    expect(engineVersion).toBe("0.416.0");
    expect(manifest.version).toBe(engineVersion);
  });

  it("🛑 the changelog heading for this bump is present in `index.ts`, labelled with its decision; the anchor, the arm's rider literal and the fold's branch are byte for byte what this suite drove", () => {
    const index = Object.entries(RAW).find(([k]) => k.endsWith("/index.ts"))?.[1] ?? "";
    expect(index.length).toBeGreaterThan(1_000_000);
    expect(index).toContain("engineVersion 0.415.0 → **0.416.0** (D530");
    const effects = Object.entries(RAW).find(([k]) => k.endsWith("/effects.ts"))?.[1] ?? "";
    expect(effects).toContain(
      "const BENCHED_SNIPE_TARGET_COUNTERS = new RegExp(\n  `^This attack does (\\\\d+) damage to 1 of your opponent['’]s Benched Pokémon ` +\n    \"for each damage counter on that Pokémon\\\\.\" +\n    `(?: \\\\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\\\.\\\\))?$`,\n);",
    );
    expect(effects).toContain("          deals: true,\n          perDamageCounterOnTarget: true,\n");
    expect(effects).toContain("      perDamageCounterOnTarget?: true;");
    const interpreter = Object.entries(RAW).find(([k]) => k.endsWith("/interpreter.ts"))?.[1] ?? "";
    expect(interpreter).toContain(
      "  if (op.perDamageCounterOnTarget === true) {\n    if (target === undefined) return op.amount;\n    const body = refPokemon(state, target);\n    return body === undefined ? 0 : op.amount * damageCountersOn(body);\n  }\n",
    );
    expect(interpreter).toContain("snipeAmount(op, next, ctx, record, ref)");
    expect(interpreter).toContain("snipeAmount(op, resumed, ctx, record, ref)");
    // The three shipped call sites are UNTOUCHED: the park, the spread, the resumed flat pick.
    expect(interpreter.split("snipeAmount(op, state, ctx, record)")).toHaveLength(4);
    // NO new op, no new prompt kind: the widening is one optional key.
    expect(effects).not.toContain('op: "damageChosenScaled"');
  });
});
