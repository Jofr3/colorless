import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
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
import { applyAction, createGame, engineVersion } from "./index";
import type { EffectOp, GameEvent, GameState, Seat } from "./index";
import { conditionHolds, countPokemonInPlay, runProgram } from "./interpreter";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  types,
} from "./testFixtures";

// 0.406.0 → 0.407.0 — 🆕🆕🆕 D520: THE FOUR-ZONE DAMAGED-BODY SPREAD, AND D507's REFUSAL
// OF IT WAS WRONG IN ITS VERDICT *AND* IN ITS CARRIER.
//
// *"This attack does 50 damage to each Pokémon that has any damage counters on it (both
// yours and your opponent's), except for this Pokémon. (Don't apply Weakness and
// Resistance for Benched Pokémon.)"* — `censusAttackCorpus.ts` **FILE LINE 601**,
// **1 sentence / 1 legal printing**, claimed by `deriveAttackEffect` through ONE new
// anchor (`SPREAD_EACH_DAMAGED_FOUR_ZONE`) and ONE new arm (6-iii), deriving THREE
// SHIPPED ops:
//
//     [ { op: "conditionGate", cond: { kind: "opponentActiveDamaged" },
//         then: [ { op: "damageDefender", amount: 50 } ] },
//       { op: "spreadDamage", target: "yourBench",     amount: 50, damagedOnly: true },
//       { op: "spreadDamage", target: "opponentBench", amount: 50, damagedOnly: true } ]
//
// 🛑 **THE PRICE IS ONE ANCHOR AND ONE ARM — ZERO NEW VOCABULARY.** No `EffectOp` kind or
// field, no `BoardCondition`/`CardFilter`/`DamageCountSource` member, no `interpreter.ts`
// byte, no `attack.ts` byte, no reader (surface 13), registry row, `FIXTURE_POOL` id,
// prompt, event or schema byte. Four zones, two §8.5 answers, two shipped ops: the
// opponent's ACTIVE through `damageDefender`'s FLAT arm (Weakness and Resistance applied —
// `snipeActive`'s pipeline, never parks), gated on the shipped ONE-BODY predicate
// `opponentActiveDamaged` (D115) inside the shipped `conditionGate`; BOTH BENCHES through
// D507's two `damagedOnly` `spreadDamage` ops (flat — the printed parenthetical). *"except
// for this Pokémon"* is STRUCTURAL: the attacker is its own Active and no op names it.
//
// 🛑 **D507 REFUSED THIS ROW, AND THE REFUSAL WAS WRONG TWICE** (D479's third mode; the
// D518→D519 shape one slice later). It priced the Active half as *"a per-body board
// predicate on `damageDefender`'s FLAT arm"* — a rider on a two-member union owing a
// `damagedOnly?: never` on the sibling — and named a falsifier (*"the flat arm carries a
// per-body predicate for a reason of its own, or a second four-zone print"*). **The
// falsifier never fired because the premise was wrong.** The flat arm hits ONE body, and
// *"has any damage counters on it"* asked of ONE body is a `BoardCondition` that has
// shipped since D115 (corpus rows 357–359, 5 printings, *"If your opponent's Active Pokémon
// already has any damage counters on it, this attack does N more damage"*). A rider on the
// op would have been a SECOND spelling of a shipped predicate — what D159 forbids. D507's
// own note (a) said the self-exclusion was structural, and then priced the row on
// something else. §8 of `bothBenchSpread.test.ts` is re-pointed as the correction; its
// *"the UNION ARITY is what makes it dear"* rung is rewritten — the arity was never the
// price, because the predicate was never going on the op.
//
// 🛑 **THE BASE RULE (attack.ts is NOT edited).** `programDamage` walks the TOP LEVEL only,
// so the gated `damageDefender` is invisible to it and a printed base — if any — lands
// PRE-program. Correct here ONLY because the printing is read as base-less: the gate is the
// FIRST op and reads *"has any damage counters"* off the board BEFORE this attack's own
// hit, honouring the predicate's declared *"already"* timing. ⚠️ **THE PRINTING'S DAMAGE
// BOX IS UNRESOLVABLE ON THIS CHECKOUT** — no local D1, no catalog sqlite; the corpus
// records the sentence and its count, never the id (D425) — and the id is stated
// unresolved, never invented. If the printing carries a damage box, `attack.ts` owes a
// D316/D317-style claim at its `scaledBase` ternary, because the gate would then read the
// defender as damaged BY THE BASE HIT ITSELF. The demonstrator is base-less (NO `damage`
// key — D228's precedent, `testFixtures.ts` "Drag Off"), and §2 asserts both halves.
//
// ⚠️ **TWO SPELLINGS OF "DAMAGED", DRIVEN RATHER THAN UNIFIED.** `opponentActiveDamaged`
// reads `active.damage > 0` (D115's bytes) while the walks read `hasAnyDamageCounters`
// (`pokemon.damage > 0`). `interpreter.ts` is not edited; §4 drives the biconditional
// body by body instead — gate fires ⟺ the shipped walk counts the defender, and each
// bench's hit set equals `countPokemonInPlay(…, damagedOnly = true)`'s set.
//
// ⚠️ **THE ORDER IS ACTIVE → OWN BENCH → OPPONENT BENCH** — D482's *"Active first"* composed
// with D507's controller-first walk — and it is observable in the `DAMAGE_DEALT` log and in
// the resulting state against a hand-built sequence (D258/D482). §5 drives it.
//
// ⚠️ **NO `(?:also )?`** — this arm emits a MAIN hit (D505's discriminator: which op the arm
// emits), and the column prints no `also` form, no `more` twin and no second four-zone
// print (§7, all measured ZERO). The demonstrator is a FILE-LOCAL pool (D414/D452): zero
// `FIXTURE_POOL` ids, its own deck, no shared deck edited (D412).

/** Corpus FILE LINE 601, byte for byte. */
const FOUR_ZONE =
  "This attack does 50 damage to each Pokémon that has any damage counters on it (both yours and your opponent's), except for this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** The five rows of the `that has any damage counters` family — now 5 of 5 built. */
const EACH_ALL = "Put 2 damage counters on each of your opponent's Pokémon that has any damage counters on it.";
const BOTH_BENCH_DAMAGED =
  "This attack also does 40 damage to each Benched Pokémon that has any damage counters on it (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)";
const CHOSEN =
  "This attack also does 60 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const COUNTED = "This attack does 50 damage for each of your Pokémon that has any damage counters on it.";

/** THE PROGRAM, spelled once at the captured amount so no rung passes against a hand-copied
    literal that drifted. ⚠️ THE ORDER IS PART OF THE VALUE (§5, `D520-four-zone-order-flips`). */
const program = (amount: number): EffectOp[] => [
  {
    op: "conditionGate",
    cond: { kind: "opponentActiveDamaged" },
    // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
    then: [{ op: "damageDefender", amount }],
  },
  { op: "spreadDamage", target: "yourBench", amount, damagedOnly: true },
  { op: "spreadDamage", target: "opponentBench", amount, damagedOnly: true },
];
const PROGRAM = program(50);

/** Arm 6-ii's program (D507), the zone-noun sibling §6 reads beside this one. */
const benchProgram = (amount: number, damagedOnly: boolean): EffectOp[] =>
  damagedOnly
    ? [
        { op: "spreadDamage", target: "yourBench", amount, damagedOnly: true },
        { op: "spreadDamage", target: "opponentBench", amount, damagedOnly: true },
      ]
    : [
        { op: "spreadDamage", target: "yourBench", amount },
        { op: "spreadDamage", target: "opponentBench", amount },
      ];

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

const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);
const claims = (re: RegExp): readonly [number, number, readonly string[]] => {
  const rows = legalAttackCorpus().filter(([, s]) => re.test(s));
  return [rows.length, units(rows), rows.map(([, s]) => s)];
};

// ─────────────────────────────────────────────────────────────────────────────
// The demonstrator — a FILE-LOCAL pool and its own deck (D414/D452/D412).
// ─────────────────────────────────────────────────────────────────────────────

const SEED = 20;
const AMOUNT = 50;

const FOUR_ZONE_CARDS: Record<string, Card> = {
  /** The attacker: {R}, so `d520-weak`'s printed `×2 Fire` is the W/R attribution control
      (D214/D427 — one printed row apart from `d520-wall`). ⚠️ **NO `damage` KEY** — the BASE
      RULE's witness; §2 asserts the key is absent. */
  "d520-splasher": battler("d520-splasher", {
    name: "D520 Splasher",
    types: ["Fire"],
    hp: 330,
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Hurt Splash", effect: FOUR_ZONE }],
  }),
  /** The defender WITHOUT Weakness — the flat control. 400 HP: nothing here is a Knock Out. */
  "d520-wall": battler("d520-wall", { name: "D520 Wall", types: ["Colorless"], hp: 400 }),
  /** The same defender with ONE printed row more: `×2 Fire`. On the Active it doubles the hit;
      on the Bench (§3) the same body takes the flat number — the printed parenthetical. */
  "d520-weak": battler("d520-weak", {
    name: "D520 Weak",
    types: ["Colorless"],
    hp: 400,
    weaknesses: [{ type: "Fire", value: "×2" }],
  }),
  /** The opponent's Bench: THREE bodies with distinct HP, so *"each"* is visible. */
  "d520-foe-a": battler("d520-foe-a", { name: "D520 Foe A", types: ["Colorless"], hp: 300 }),
  "d520-foe-b": battler("d520-foe-b", { name: "D520 Foe B", types: ["Colorless"], hp: 310 }),
  "d520-foe-c": battler("d520-foe-c", { name: "D520 Foe C", types: ["Colorless"], hp: 320 }),
  /** The attacker's own Bench: TWO bodies, because every one-sided build passes every
      opponent-only board (D425's rule). */
  "d520-ally-a": battler("d520-ally-a", { name: "D520 Ally A", types: ["Colorless"], hp: 300 }),
  "d520-ally-b": battler("d520-ally-b", { name: "D520 Ally B", types: ["Colorless"], hp: 310 }),
};

const FOUR_ZONE_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...FOUR_ZONE_CARDS };

/** Its own deck (D270), 60 counted before the first run: 8 + 6 + 6 + 8 + 8 + 8 + 6 + 6 + 4. */
const FOUR_ZONE_DECK = deckOf({
  "d520-splasher": 8,
  "d520-wall": 6,
  "d520-weak": 6,
  "d520-foe-a": 8,
  "d520-foe-b": 8,
  "d520-foe-c": 8,
  "d520-ally-a": 6,
  "d520-ally-b": 6,
  "fix-energy": 4,
});

function openTable(first: Seat): GameState {
  const created = createGame({
    seed: SEED,
    decks: { p1: FOUR_ZONE_DECK, p2: FOUR_ZONE_DECK },
    cardPool: FOUR_ZONE_POOL,
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

/** Existing damage to seed, body by body. Absent means clean. */
type Damage = {
  readonly defender?: number;
  readonly self?: number;
  readonly own?: readonly number[];
  readonly foe?: readonly number[];
};

/** p1 owns TURN 2 with the Splasher Active. **BOTH benches are cleared before anything is
    placed** (every figure here is a POPULATION), then the opponent's three and the attacker's
    two are benched unless `benches` is false, and `damage` seeds the board the printed
    predicate discriminates on. */
function table(defender: "d520-wall" | "d520-weak" = "d520-wall", damage: Damage = {}, benches = true): GameState {
  let state = openTable("p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, "p1", "d520-splasher");
  state = setActiveFromDeck(state, "p2", defender);
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  if (benches) {
    for (const id of ["d520-foe-a", "d520-foe-b", "d520-foe-c"]) state = benchFromDeck(state, "p2", id);
    for (const id of ["d520-ally-a", "d520-ally-b"]) state = benchFromDeck(state, "p1", id);
  }
  if (damage.defender !== undefined) state = setDamage(state, "p2", damage.defender);
  if (damage.self !== undefined) state = setDamage(state, "p1", damage.self);
  (damage.own ?? []).forEach((d, i) => {
    if (d > 0) state = setBenchDamage(state, "p1", i, d);
  });
  (damage.foe ?? []).forEach((d, i) => {
    if (d > 0) state = setBenchDamage(state, "p2", i, d);
  });
  return state;
}

/** 🛑 THE CANONICAL BOARD — every zone has a damaged body AND a clean one, and the attacker's
    own Active is damaged so *"except for this Pokémon"* has something to exclude:

      p1 (attacker)                              p2 (defender)
        Active  d520-splasher   dmg 40             d520-wall / d520-weak   dmg 10
        Bench 0 d520-ally-a     clean              d520-foe-a              dmg 10
        Bench 1 d520-ally-b     dmg 20             d520-foe-b              clean
                                                   d520-foe-c              dmg 30

    Seven bodies, four of them candidates (defender, ally 1, foe 0, foe 2), and the damaged
    indices DIFFER between the two benches so a build that walked one bench's positions
    onto the other is killed. */
const CANONICAL: Damage = { defender: 10, self: 40, own: [0, 20], foe: [10, 0, 30] };

function swing(state: GameState) {
  return mustApply(state, { type: "attack", seat: "p1", index: 0 });
}

/** `[active, ...bench]` damage — the discrimination of §3 to §5. */
function damageVector(state: GameState, seat: Seat): number[] {
  const side = state.players[seat];
  return [side.active?.damage ?? -1, ...side.bench.map((b) => b.damage)];
}

function damageRows(events: GameEvent[]): { seat: Seat; dealt: number }[] {
  return events.flatMap((e) => (e.type === "DAMAGE_DEALT" ? [{ seat: e.seat, dealt: e.dealt }] : []));
}

const ctx = { seat: "p1" as Seat, invokedBy: "attack" as const };

function run(state: GameState, ops: readonly EffectOp[]): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const result = runProgram(state, ops, ctx, events);
  if (result.kind !== "done") throw new Error(`expected done, got ${result.kind}`);
  return { state: result.state, events };
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the census: the row, the family, the readers and the four sibling anchors.
// ─────────────────────────────────────────────────────────────────────────────

describe("D520 §1 — the printed row, its family, and the anchors it sits beside", () => {
  it("🛑 the sentence is the CORPUS's bytes at exactly ONE printing, and it is now RESOLVED", () => {
    const rows = legalAttackCorpus().filter(([, s]) => s === FOUR_ZONE);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe(1);
    expect(resolvedByAnyReader(FOUR_ZONE)).toBe(true);
  });

  it("🛑 both apostrophes in the print are U+0027, measured with `codePointAt` and not by eye", () => {
    const marks = [...FOUR_ZONE].filter((ch) => ch === "'" || ch === "’");
    expect(marks).toHaveLength(2);
    for (let i = 0; i < FOUR_ZONE.length; i += 1) {
      expect(FOUR_ZONE.codePointAt(i), `U+2019 at ${i}`).not.toBe(0x2019);
    }
    // …and the CURLY spelling still derives, which is what the `['’]` class buys.
    expect(deriveAttackEffect(FOUR_ZONE.replace(/'/g, "’"))).toEqual(PROGRAM);
  });

  it("🛑 `deriveAttackEffect` is the ONLY claimant — twelve readers and four splitters are null", () => {
    for (const reader of READERS) {
      if (reader === deriveAttackEffect) continue;
      expect(reader(FOUR_ZONE), reader.name).toBeNull();
    }
    for (const splitter of SPLITTERS) expect(splitter(FOUR_ZONE), splitter.name).toBeNull();
    expect(deriveAttackDamageMultiplier(FOUR_ZONE)).toBeNull();
    expect(splitAttackGateClause(FOUR_ZONE)).toBeNull();
    expect(splitAttackTrailingClause(FOUR_ZONE)).toBeNull();
  });

  it("🛑 the `that has any damage counters` family is 5 sentences / 7 printings, and it is CLOSED — 5 of 5 built", () => {
    const family = legalAttackCorpus().filter(([, s]) => /that ha[sv]e? any damage counters/i.test(s));
    expect(family).toHaveLength(5);
    expect(units(family)).toBe(7);
    expect(family.map(([, s]) => s).sort()).toEqual(
      [EACH_ALL, BOTH_BENCH_DAMAGED, CHOSEN, COUNTED, FOUR_ZONE].sort(),
    );
    for (const [, s] of family) expect(resolvedByAnyReader(s), s).toBe(true);
    expect(family.filter(([, s]) => !resolvedByAnyReader(s))).toEqual([]);
  });

  it("🛑 the new anchor claims exactly the printed row, and the FOUR sibling anchors' claimed sets are UNCHANGED", () => {
    // The siblings, re-spelled here so the disjointness is a MEASUREMENT over all 640 rows
    // rather than a reading of the regexes (D472/D477). Each demands a different token after
    // `each `: `of `, `Benched`, `of your opponent's`, and this one `Pokémon that has`.
    const mine =
      /^This attack does (\d+) damage to each Pokémon that has any damage counters on it \(both yours and your opponent['’]s\), except for this Pokémon\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/;
    const arm6 =
      /^This attack (?:also )?does (\d+) damage to each of (your opponent['’]s|your) Benched Pokémon\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/;
    const arm6ii =
      /^This attack (?:also )?does (\d+) damage to each Benched Pokémon( that has any damage counters on it)? \(both yours and your opponent['’]s\)\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/;
    const arm6aBis =
      /^This attack does (\d+) damage to each of your opponent['’]s Pokémon\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/;
    const arm6aTer =
      /^This attack does (\d+) damage to each of your opponent['’]s (Pokémon ex and Pokémon V|Pokémon ex)\. This attack's damage isn't affected by Weakness or Resistance\.$/;
    const [n, u, rows] = claims(mine);
    expect([n, u]).toEqual([1, 1]);
    expect(rows).toEqual([FOUR_ZONE]);
    // Sibling sets, measured at this head: 5/9, 2/2, 1/1, 2/4 — the pre-slice figures.
    expect(claims(arm6).slice(0, 2)).toEqual([5, 9]);
    expect(claims(arm6ii).slice(0, 2)).toEqual([2, 2]);
    expect(claims(arm6aBis).slice(0, 2)).toEqual([1, 1]);
    expect(claims(arm6aTer).slice(0, 2)).toEqual([2, 4]);
    // …and pairwise DISJOINT from this one.
    for (const sib of [arm6, arm6ii, arm6aBis, arm6aTer]) {
      expect(claims(sib)[2]).not.toContain(FOUR_ZONE);
    }
    // The siblings still derive to THEIR programs — the new arm claimed nothing of theirs.
    expect(deriveAttackEffect(BOTH_BENCH_DAMAGED)).toEqual(benchProgram(40, true));
  });

  it("AUTHORS nothing — the legal printing is read off the TEXT, and the reader surface is still THIRTEEN", () => {
    expect(attackReaderSurface()).toHaveLength(14 /* 🆕🆕🆕 D573: 13 → 14, + deriveAttackCopy */);
    expect(attackReaderSurface()).toContain("deriveAttackEffect");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the exact program, and the BASE RULE's two witnesses.
// ─────────────────────────────────────────────────────────────────────────────

describe("D520 §2 — the program, spelled whole, and the base rule's witnesses", () => {
  it("🛑 file line 601 derives to EXACTLY the three-op program, in order", () => {
    expect(deriveAttackEffect(FOUR_ZONE)).toEqual(PROGRAM);
  });

  it("🛑 per-op fields: a one-body gate with NO `otherwise`, a flat hit, two damagedOnly spreads", () => {
    const ops = deriveAttackEffect(FOUR_ZONE) as EffectOp[];
    expect(ops).toHaveLength(3);
    const [gate, own, foe] = ops;
    if (gate?.op !== "conditionGate") throw new Error("op 0 is not a conditionGate");
    expect(gate.cond).toEqual({ kind: "opponentActiveDamaged" });
    expect(gate.otherwise).toBeUndefined();
    expect(gate.then).toEqual([{ op: "damageDefender", amount: AMOUNT }]);
    const hit = gate.then[0];
    if (hit?.op !== "damageDefender") throw new Error("gated op is not a damageDefender");
    expect(hit.amount).toBe(AMOUNT);
    expect("per" in hit).toBe(false);
    expect("count" in hit).toBe(false);
    if (own?.op !== "spreadDamage" || foe?.op !== "spreadDamage") throw new Error("legs are not spreads");
    expect([own.target, foe.target]).toEqual(["yourBench", "opponentBench"]);
    expect([own.amount, foe.amount]).toEqual([AMOUNT, AMOUNT]);
    expect([own.damagedOnly, foe.damagedOnly]).toEqual([true, true]);
  });

  it("🛑 the TOP LEVEL has no `damageDefender` — so `attack.ts`'s `programDamage` is false and the base lands pre-program", () => {
    const ops = deriveAttackEffect(FOUR_ZONE) as EffectOp[];
    expect(ops.some((o) => o.op === "damageDefender")).toBe(false);
    expect(ops.map((o) => o.op)).toEqual(["conditionGate", "spreadDamage", "spreadDamage"]);
  });

  it("🛑 …and the demonstrator prints NO `damage` box, which is what makes the base rule correct here", () => {
    const attack = FOUR_ZONE_CARDS["d520-splasher"]?.attacks?.[0];
    if (attack === undefined) throw new Error("no attack 0");
    expect(attack.effect).toBe(FOUR_ZONE);
    expect("damage" in attack).toBe(false);
  });

  it("🛑 the AMOUNT is the capture — a 30 probe derives the same shape at 30 (constructed, not printed)", () => {
    const probe = FOUR_ZONE.replace("does 50 damage", "does 30 damage");
    expect(legalAttackCorpus().some(([, s]) => s === probe)).toBe(false);
    expect(deriveAttackEffect(probe)).toEqual(program(30));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — boards: W/R on the Active, flat on both benches, self excluded.
// ─────────────────────────────────────────────────────────────────────────────

describe("D520 §3 — the canonical board: four zones, two §8.5 answers, one exclusion", () => {
  it("🛑 a DAMAGED defender takes 50 through the flat arm; the damaged bench bodies on BOTH sides take 50; the clean ones nothing", () => {
    const { state, events } = swing(table("d520-wall", CANONICAL));
    expect(damageRows(events)).toEqual([
      { seat: "p2", dealt: 50 },
      { seat: "p1", dealt: 50 },
      { seat: "p2", dealt: 50 },
      { seat: "p2", dealt: 50 },
    ]);
    expect(damageVector(state, "p2")).toEqual([60, 60, 0, 80]);
    expect(damageVector(state, "p1")).toEqual([40, 0, 70]);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 the Active hit goes THROUGH Weakness: the ×2 defender takes 100 where the control takes 50, and the benches are unmoved (D214)", () => {
    const weak = swing(table("d520-weak", CANONICAL));
    const wall = swing(table("d520-wall", CANONICAL));
    expect(damageRows(weak.events)[0]).toEqual({ seat: "p2", dealt: 100 });
    expect(damageRows(wall.events)[0]).toEqual({ seat: "p2", dealt: 50 });
    expect(damageVector(weak.state, "p2")).toEqual([110, 60, 0, 80]);
    // Everything after the Active row is byte-identical between the two boards.
    expect(damageRows(weak.events).slice(1)).toEqual(damageRows(wall.events).slice(1));
    expect(damageVector(weak.state, "p1")).toEqual(damageVector(wall.state, "p1"));
  });

  it("🛑 an UNDAMAGED defender takes NOTHING and files no `DAMAGE_DEALT` for the Active — the gate is the difference", () => {
    const { state, events } = swing(table("d520-weak", { ...CANONICAL, defender: 0 }));
    expect(damageRows(events)).toEqual([
      { seat: "p1", dealt: 50 },
      { seat: "p2", dealt: 50 },
      { seat: "p2", dealt: 50 },
    ]);
    expect(damageVector(state, "p2")).toEqual([0, 60, 0, 80]);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 `except for this Pokémon` — the attacker's OWN damaged Active is untouched on a board where it is the only candidate", () => {
    const { state, events } = swing(table("d520-wall", { self: 40 }));
    expect(damageRows(events)).toEqual([]);
    expect(damageVector(state, "p1")).toEqual([40, 0, 0]);
    expect(damageVector(state, "p2")).toEqual([0, 0, 0, 0]);
  });

  it("🛑 each bench body is hit iff it is damaged — a second pattern with the damaged indices swapped", () => {
    const { state, events } = swing(table("d520-wall", { own: [20, 0], foe: [0, 10, 0] }));
    expect(damageRows(events)).toEqual([
      { seat: "p1", dealt: 50 },
      { seat: "p2", dealt: 50 },
    ]);
    expect(damageVector(state, "p1")).toEqual([0, 70, 0]);
    expect(damageVector(state, "p2")).toEqual([0, 0, 60, 0]);
  });

  it("🛑 EMPTY benches: the Active leg still lands alone, and neither spread files a row", () => {
    const { state, events } = swing(table("d520-weak", { defender: 10 }, false));
    expect(state.players.p1.bench).toHaveLength(0);
    expect(state.players.p2.bench).toHaveLength(0);
    expect(damageRows(events)).toEqual([{ seat: "p2", dealt: 100 }]);
    expect(damageVector(state, "p2")).toEqual([110]);
  });

  it("🛑 a lone UNDAMAGED defender with empty benches: no damage at all, and it is NOT an `ATTACK_EFFECT_SKIPPED`", () => {
    const { state, events } = swing(table("d520-wall", {}, false));
    expect(damageRows(events)).toEqual([]);
    expect(events.some((e) => e.type === "DAMAGE_DEALT")).toBe(false);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(damageVector(state, "p2")).toEqual([0]);
    // …and the attack still ended the turn (D491): p1 no longer holds it.
    expect(state.turn).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the biconditionals, body by body: the gate against the walk, the spreads against the count.
// ─────────────────────────────────────────────────────────────────────────────

describe("D520 §4 — gate ⟺ walk, and each bench's hit set ⟺ the count's set", () => {
  it("🛑 the gate fires ⟺ `countPokemonInPlay(…, damagedOnly)` counts the defender — at 0, 10 and max−1", () => {
    for (const d of [0, 10, 399]) {
      const state = table("d520-wall", { defender: d }, false);
      const gate = conditionHolds(state, "p1", { kind: "opponentActiveDamaged" });
      const counted = countPokemonInPlay(state, "p2", { kind: "anyPokemon" }, true);
      expect(gate, `defender ${d}: gate`).toBe(d > 0);
      expect(counted, `defender ${d}: count`).toBe(d > 0 ? 1 : 0);
      expect(gate, `defender ${d}: gate ⟺ count`).toBe(counted === 1);
      // …and the PROGRAM agrees: the Active row is filed iff the gate fired.
      const { events } = run(state, PROGRAM);
      expect(damageRows(events).some((r) => r.seat === "p2"), `defender ${d}: hit`).toBe(gate);
    }
  });

  it("🛑 on every damage pattern of the seven-body board, each bench's hit set is the count's set", () => {
    const PATTERNS: readonly (readonly [string, Damage])[] = [
      ["clean", {}],
      ["canonical", CANONICAL],
      ["own only", { own: [10, 10] }],
      ["foe only", { foe: [10, 10, 10] }],
      ["alternating", { defender: 10, own: [10, 0], foe: [0, 10, 0] }],
      ["every body", { defender: 10, self: 10, own: [10, 10], foe: [10, 10, 10] }],
    ];
    let bothOn = 0;
    let bothOff = 0;
    for (const [label, damage] of PATTERNS) {
      const state = table("d520-wall", damage);
      const { state: after } = run(state, PROGRAM);
      for (const seat of ["p1", "p2"] as const) {
        const before = state.players[seat].bench.map((b) => b.damage);
        const hits = after.players[seat].bench.map((b, i) => b.damage > (before[i] ?? 0));
        for (let i = 0; i < hits.length; i += 1) {
          expect(hits[i], `${label} ${seat} bench ${i}`).toBe((before[i] ?? 0) > 0);
          if (hits[i] === true) bothOn += 1;
          else bothOff += 1;
        }
        // The shipped walk over the same seat: hits plus the Active iff damaged — the Active is
        // the one body the bench-scoped op cannot see and the one the GATE sees instead.
        const active = state.players[seat].active?.damage ?? 0;
        expect(countPokemonInPlay(state, seat, { kind: "anyPokemon" }, true), `${label} ${seat} count`).toBe(
          hits.filter(Boolean).length + (active > 0 ? 1 : 0),
        );
      }
      // …and the attacker's own Active never moves, whatever the pattern.
      expect(after.players.p1.active?.damage).toBe(state.players.p1.active?.damage);
    }
    expect(bothOn).toBeGreaterThan(0);
    expect(bothOff).toBeGreaterThan(0);
  });

  it("🛑 the SEAT MIRROR is a different predicate — `yourActiveDamaged` reads the attacker, and this program does not", () => {
    // A board where ONLY the attacker's Active is damaged: the mirror holds, the printed
    // gate does not, and the defender takes nothing (`D520-gate-reads-the-attacker`).
    const state = table("d520-wall", { self: 40 });
    expect(conditionHolds(state, "p1", { kind: "yourActiveDamaged" })).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "opponentActiveDamaged" })).toBe(false);
    const { events } = swing(state);
    expect(damageRows(events)).toEqual([]);
    // …and the other way round on the canonical board's opposite: defender damaged, self clean.
    const flipped = table("d520-wall", { defender: 10 });
    expect(conditionHolds(flipped, "p1", { kind: "yourActiveDamaged" })).toBe(false);
    expect(damageRows(swing(flipped).events)).toEqual([{ seat: "p2", dealt: 50 }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the order: Active, then the attacker's Bench, then the opponent's.
// ─────────────────────────────────────────────────────────────────────────────

describe("D520 §5 — the order is Active → own Bench → opponent Bench, and it is observable", () => {
  it("🛑 the `DAMAGE_DEALT` log reads the Active row, then the own-bench row, then both opponent-bench rows", () => {
    const { events } = swing(table("d520-wall", CANONICAL));
    expect(damageRows(events).map((r) => r.seat)).toEqual(["p2", "p1", "p2", "p2"]);
  });

  it("🛑 the derived program runs to the SAME state and log as a hand-built Active → own → opponent sequence (D258/D482)", () => {
    const state = table("d520-wall", CANONICAL);
    const derived = run(state, deriveAttackEffect(FOUR_ZONE) as EffectOp[]);
    const hand = run(state, [
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveDamaged" },
        // biome-ignore lint/suspicious/noThenProperty: gated-step list, not a thenable.
        then: [{ op: "damageDefender", amount: 50 }],
      },
      { op: "spreadDamage", target: "yourBench", amount: 50, damagedOnly: true },
      { op: "spreadDamage", target: "opponentBench", amount: 50, damagedOnly: true },
    ]);
    expect(derived.events).toEqual(hand.events);
    expect(derived.state).toEqual(hand.state);
    expect(derived.state.rngState).toEqual(hand.state.rngState);
  });

  it("🛑 …and the FLIPPED order (gate after the spreads) is a DIFFERENT log on the same board", () => {
    const state = table("d520-wall", CANONICAL);
    const [gate, own, foe] = PROGRAM;
    if (gate === undefined || own === undefined || foe === undefined) throw new Error("program");
    const flipped = run(state, [own, foe, gate]);
    expect(damageRows(flipped.events).map((r) => r.seat)).toEqual(["p1", "p2", "p2", "p2"]);
    expect(damageRows(flipped.events)).not.toEqual(damageRows(run(state, PROGRAM).events));
  });

  it("🛑 the ORDER survives into the derived program, where a mutant can be seen without a board", () => {
    const ops = deriveAttackEffect(FOUR_ZONE) as EffectOp[];
    expect(ops.map((o) => (o.op === "spreadDamage" ? o.target : o.op))).toEqual([
      "conditionGate",
      "yourBench",
      "opponentBench",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the 2⁵ lattice: NOUN × CLAUSE × BOTH × EXCEPT × ALSO.
// ─────────────────────────────────────────────────────────────────────────────

/** Axis order: `also` · zone noun · damaged clause · both-sides parenthetical · except clause. */
function point(also: boolean, benched: boolean, clause: boolean, both: boolean, except: boolean): string {
  return `This attack ${also ? "also " : ""}does 50 damage to each ${benched ? "Benched " : ""}Pokémon${
    clause ? " that has any damage counters on it" : ""
  }${both ? " (both yours and your opponent's)" : ""}${except ? ", except for this Pokémon" : ""}. (Don't apply Weakness and Resistance for Benched Pokémon.)`;
}

const POINTS = (() => {
  const out: { key: string; text: string }[] = [];
  for (const also of [false, true])
    for (const benched of [false, true])
      for (const clause of [false, true])
        for (const both of [false, true])
          for (const except of [false, true]) {
            out.push({
              key: [also, benched, clause, both, except].map((b) => (b ? "1" : "0")).join(""),
              text: point(also, benched, clause, both, except),
            });
          }
  return out;
})();

describe("D520 §6 — the 2⁵ lattice, both predicates, and the two zone nouns", () => {
  it("🛑 the print is a point of the lattice and all 32 points are DISTINCT strings", () => {
    expect(POINTS).toHaveLength(32);
    expect(new Set(POINTS.map((p) => p.text)).size).toBe(32);
    expect(POINTS.find((p) => p.key === "00111")?.text).toBe(FOUR_ZONE);
  });

  it("🛑 both splitters (and the other two) are null at 32 of 32 points — readers-only and splitter-inclusive agree", () => {
    for (const p of POINTS) {
      for (const splitter of SPLITTERS) expect(splitter(p.text), `${p.key}: ${splitter.name}`).toBeNull();
    }
  });

  it("🛑 EXACTLY the printed point derives this program; the four `each Benched` cells without `except` derive 6-ii's; nothing else builds", () => {
    const built = POINTS.filter((p) => READERS.some((r) => r(p.text) !== null)).map((p) => p.key);
    expect(built.sort()).toEqual(["00111", "01010", "01110", "11010", "11110"]);
    for (const p of POINTS) {
      const derived = deriveAttackEffect(p.text);
      if (p.key === "00111") expect(derived, p.key).toEqual(PROGRAM);
      else if (p.key === "01010" || p.key === "11010") expect(derived, p.key).toEqual(benchProgram(50, false));
      else if (p.key === "01110" || p.key === "11110") expect(derived, p.key).toEqual(benchProgram(50, true));
      else expect(derived, p.key).toBeNull();
    }
  });

  it("🛑 the `also` variant of the print is NULL — this arm emits a MAIN hit, so the word would delete a base", () => {
    expect(deriveAttackEffect(FOUR_ZONE.replace("This attack does", "This attack also does"))).toBeNull();
  });

  it("🛑 the two zone nouns derive DIFFERENT programs — `each Pokémon` reaches the Actives, `each Benched Pokémon` does not", () => {
    const benched = FOUR_ZONE.replace("to each Pokémon", "to each Benched Pokémon")
      .replace(", except for this Pokémon", "")
      .replace("This attack does", "This attack also does");
    expect(deriveAttackEffect(benched)).toEqual(benchProgram(50, true));
    expect(deriveAttackEffect(FOUR_ZONE)).toEqual(PROGRAM);
    expect(deriveAttackEffect(FOUR_ZONE)).not.toEqual(deriveAttackEffect(benched));
    // The except clause on the Benched noun is a string NO arm owns.
    expect(deriveAttackEffect(benched.replace(" (both yours and your opponent's).", " (both yours and your opponent's), except for this Pokémon."))).toBeNull();
  });

  it("🛑 every single-axis deletion from the print is NULL — the anchor is whole-sentence", () => {
    for (const p of POINTS) {
      const distance = [...p.key].filter((c, i) => c !== "00111"[i]).length;
      if (distance === 1) expect(deriveAttackEffect(p.text), p.key).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — the zeros, measured.
// ─────────────────────────────────────────────────────────────────────────────

describe("D520 §7 — zeros measured over all 640 rows", () => {
  it("🛑 there is NO second four-zone print — the shape occurs once in the column", () => {
    const shape = legalAttackCorpus().filter(([, s]) => /each Pokémon that has any damage counters/.test(s));
    expect(shape.map(([, s]) => s)).toEqual([FOUR_ZONE]);
  });

  it("🛑 there is NO `also` print and NO `more` twin of this sentence", () => {
    expect(legalAttackCorpus().filter(([, s]) => /also does \d+ damage to each Pokémon that/.test(s))).toEqual([]);
    expect(legalAttackCorpus().filter(([, s]) => /more damage to each Pokémon/.test(s))).toEqual([]);
  });

  it("🛑 the `also`-admitting and the `except`-less anchor variants claim nothing new — measured, not argued", () => {
    const withAlso =
      /^This attack (?:also )?does (\d+) damage to each Pokémon that has any damage counters on it \(both yours and your opponent['’]s\), except for this Pokémon\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/;
    const withoutExcept =
      /^This attack does (\d+) damage to each Pokémon that has any damage counters on it \(both yours and your opponent['’]s\)\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/;
    expect(claims(withAlso).slice(0, 2)).toEqual([1, 1]);
    // The except-less form does not even claim the printed row — it is a LOUD wrong anchor.
    expect(claims(withoutExcept).slice(0, 2)).toEqual([0, 0]);
  });

  it("🛑 the anchor is WHOLE-SENTENCE at BOTH ends — a prefixed print and a suffixed print each derive null (D497's pair; `D520-four-zone-anchor-loses-the-head` / `-tail`)", () => {
    // ⚠️ The single-axis deletions of §6 cannot see either end: every lattice point starts
    // with `This attack` and ends with the parenthetical. These two are the rungs that do.
    // Both strings are CONSTRUCTED and labelled as such (D440); neither is printed.
    const prefixed = `Discard a card from your hand. ${FOUR_ZONE}`;
    const suffixed = `${FOUR_ZONE} Then, draw a card.`;
    expect(legalAttackCorpus().some(([, s]) => s === prefixed || s === suffixed)).toBe(false);
    expect(deriveAttackEffect(prefixed)).toBeNull();
    expect(deriveAttackEffect(suffixed)).toBeNull();
    expect(resolvedByAnyReader(suffixed)).toBe(false);
  });

  it("🛑 a printed ZERO derives null — the family's guard (`D520-printed-zero-derives`)", () => {
    expect(deriveAttackEffect(FOUR_ZONE.replace("does 50 damage", "does 0 damage"))).toBeNull();
  });

  it("🛑 the RAW reader-only residue fell by exactly 1 sentence / 1 printing, and the row left it", () => {
    const unbuilt = legalAttackCorpus().filter(([, s]) => !resolvedByAnyReader(s));
    // 🆕🆕🆕 D521 −1 sentence / −2 printings (THE TWO-COIN BOTH-TAILS RECOIL — corpus FILE LINE 202,
    // claimed by `deriveAttackEffect` through `FLIP_TWO_BOTH_TAILS_SELF_DAMAGE`; the sentence and
    // printing steps DISAGREE, 1 vs 2): 93/145 → 92/143 and 547/1587 → 548/1589.
    // 🆕🆕🆕 D522 −1 sentence / −1 printing (THE STADIUM-GATED BENCH SPREAD WITH THE STADIUM DISCARD —
    // corpus FILE LINE 293, Ting-Lu `sv06-110`, claimed by `deriveAttackEffect` arm 43-bis through
    // `STADIUM_GATED_BENCH_SPREAD`; the sentence and printing steps AGREE, 1 and 1): 92/143 → 91/142
    // and 548/1589 → 549/1590. ⚠️ This site sits OUTSIDE the annotated-chain sweep's shape (D521 (4))
    // and is stepped by hand; the full `check` is what finds it.
    // 🆕🆕🆕 D523 −1 sentence / −1 printing (THE DECK-DESTINATION DISCARD-PILE RETRIEVAL — corpus FILE
    // LINE 485, claimed by `deriveAttackEffect` through `ATTACK_DISCARD_SHUFFLE_BACK`, the arm after
    // the D237 arm; the sentence and printing steps AGREE, 1 and 1): 91/142 → 90/141 and 549/1590 →
    // 550/1591. Stepped by hand again — this site sits outside the annotated-chain sweep's shape.
    // 🆕🆕🆕 D524 −1 sentence / −1 printing (THE PURPOSE-CONNECTIVE OPTIONAL-COST BOOST WITH THE
    // ALL-SELF-ENERGY-TO-HAND COST — corpus FILE LINE 652, claimed by `deriveAttackOptionalCostBoost`
    // through the purpose skeleton over one new cost-table row; the sentence and printing steps AGREE,
    // 1 and 1): 90/141 → 89/140 and 550/1591 → 551/1592. Stepped by hand a third time — outside the
    // annotated-chain sweep's shape.
    // 🆕🆕🆕 D525 −1 sentence / −2 printings (THE HEADS COUNT READ AS AN "UP TO" CEILING BY ONE OP — corpus
    // FILE LINE 219, 2 legal printings, claimed by `deriveAttackCoinFlip` as the seventh member
    // `retrievalUpToHeads`; ⚠️ the sentence step is 1 and the PRINTING step is 2): 89/140 → 88/138 and
    // 551/1592 → 552/1594. Stepped by hand a fourth time — outside the annotated-chain sweep's shape.
    // 🆕🆕🆕 D526 −1 sentence / −1 printing (corpus FILE LINE 218, see §3's first rung; the two steps agree at 1): 88/138 → 87/137.
    // 🆕🆕🆕 D527 −1 sentence / −1 printing (corpus FILE LINE 454, see the reader-arm rung above; the two steps agree at 1): 87/137 → 86/136.
    // 🆕🆕🆕 **D530 −1 sentence / −1 printing — THE TARGET-COUNTER-SCALED BENCH SNIPE — A FOURTH `damageChosen` RIDER, `perDamageCounterOnTarget`, READ PER REF AT THE ANSWER** — `censusAttackCorpus.ts` **FILE LINE 551** (`legalAttackCorpus()` index 498), *"This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing** (no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new anchor (`BENCHED_SNIPE_TARGET_COUNTERS`, beside `BENCHED_SNIPE_TAKEN_PRIZES`, disjoint by TAIL) as arm 6b′ — a READER move: reader arm 555/1597 → 556/1598, raw residue 85/135 → 84/134; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.415.0 → 0.416.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.
    // 🆕🆕🆕 D528 −1 sentence / −1 printing (THE HEADS-CEILINGED DISCARD-TO-BENCH ENERGY ATTACH — THE ATTACH TWIN OF D525, ZERO VOCABULARY, NO NEW `AttackCoinFlip` MEMBER — corpus FILE LINE 215, *"Flip 3 coins. Attach a number of Basic {L} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like."*, 1 legal printing, claimed by `deriveAttackCoinFlip` as `programPerHeads` over ONE copy of D358's discard-spread op, H declinable parks at the existing fold, ZERO new vocabulary, no fold/interpreter bytes; the sentence and printing steps AGREE at 1): 86/136 → 85/135. Stepped by hand (outside the annotated-chain sweep's shape).
    expect([unbuilt.length, units(unbuilt)]).toEqual([40, 69]);  // (🆕🆕🆕 **D579 −1 sentence / −1 printing — THE CENSUS CLOSE-OUT** leaves the raw residue: Koraidon `sv08-116`, claimed WHOLE by a reader; Walking Wake `sv06-063` (a registry row) STAYS raw — measured 40/69.) (🆕🆕🆕 **D575 −6 sentences / −6 printings — THE MRV-38 ATTACK SLICE** leave the raw residue: file lines 177, 181, 182, 346, 394 and 690, each claimed WHOLE by a new `deriveAttackEffect` anchor (Glimmora's compound included, so it does not stay raw the way D574's Alakazam did) — measured 41/70, as the D575 judge predicted.) (🆕🆕🆕 **D574 −3 sentences / −5 printings — THE COPY-FAMILY REMAINDER + SABLEYE** leave the raw residue (file lines 434, 131 and 649, claimed whole by readers); Alakazam (686, composed on the trailing seam) and Malamar (489, a registry row) STAY in the raw reader-only residue — measured 47/76 where the D574 judge predicted 46/75.) (🆕🆕🆕 **D573 −4 sentences / −9 printings — THE COPY-ATTACK SUBSTITUTION** leaves the residue: `deriveAttackCopy` claims file lines 77, 78, 80 and 245 whole; Haughty Order and Seek Inspiration stay.) (🆕🆕🆕 **D569 −4 sentences / −6 printings — THE PARADOX BANNER READERS LEFT THE RAW RESIDUE** — Koraidon ×2, Roaring Moon ×2, Iron Valiant, Slither Wing; the reader rung's +4/+6 seen from the other side (58/96 → 54/90)) (🆕🆕🆕 **D568 −2 sentences / −2 printings — THE TWO TERA CLAUSES LEFT THE RAW RESIDUE** — Ho-Oh `sv08-019` and Regigigas `sv08.5-086`, the reader rung's +2/+2 seen from the other side (60/98 → 58/96)) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: raw reader-only residue 62/100 → 60/98.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: raw reader-only residue 63/101 → 62/100.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: raw reader-only residue 67/105 → 63/101.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: raw reader-only residue 68/107 → 67/105.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: raw reader-only residue 70/111 → 68/107.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: raw reader-only residue 72/113 → 70/111.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: raw reader-only residue 73/115 → 72/113.)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: raw reader-only residue 74/117 → 73/115.)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34, leading count column `1`), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing** (no card id resolves on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d540-*`), claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen` — a READER move: reader arm 564/1613 → 565/1614, raw residue 76/119 → 75/118, `BUILT.attack` 1664 → 1665, residue 49/68 → 48/67; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.424.0 → 0.425.0, `MATCH_RECORD_VERSION` HELD at 30 (D125's widening at a persisted address — and this op DOES park, so a record really can hold it, which is why the version claim rests on the widening and not on parking). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 1 — they AGREE for the first time in six slices, which is the one case where a copied number would be right by accident, so every site was measured.)  // (🆕🆕🆕 **D539 +1 sentence / +2 printings — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS, so no record that can exist holds the new value). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 77/121 → 76/119.)  // (🆕🆕🆕 **D538 −1 sentence / −3 printings — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 78/124 → 77/121.)  // (🆕🆕🆕 **D537 −1 sentence / −2 printings — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 79/126 → 78/124.)  // (🆕🆕🆕 **D536 −1 sentence / −3 printings — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT — ONE NEW FIELD-FREE `EffectOp` MEMBER `discardDefender` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229` — the ids ARE resolved on this checkout and are used as ids; the printed BASE DAMAGE is NOT, so it is driven on the file-local declared demonstrator `d536-moltres`, D425), claimed by `deriveAttackEffect` through ONE new ZERO-capture anchor (`TR_ENERGY_COST_THEN_DISCARD_DEFENDER`, beside `HAND_COST_THEN_OPPONENT_DISCARD`) as `discardEnergy{from:"yourActive", filter:{byName "Team Rocket's Energy"}, recordAs:"discarded"}` gated through the FIRST shipped `recordGate{slot:"discarded"}` into the new `discardDefender` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING; the op never parks and is FIELD-FREE). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 3 — harder than D535's 1-and-2, so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 80/129 → 79/126.)  // (🆕🆕🆕 **D535 −1 sentence / −2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 −1 sentence / −1 printing — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D532 −1 sentence / −1 printing — THE CROSS-SEAT DISCARD-PILE ATTACH — `attachEnergyFrom` GAINS THE OPTIONAL KEY `whose: "opponent"` (on the op AND on `AttachTargetRiders`, read through ONE resolver)** — `censusAttackCorpus.ts` **FILE LINE 70** (`legalAttackCorpus()` index 17), *"Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like."*, **1 sentence / 1 legal printing** (Grafaiai `sv08-121`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_DISCARD_ATTACH`, beside the factory-built `DISCARD_ATTACH`) as D360's spread ONE KEY OVER — a READER move: reader arm 557/1599 → 558/1600, raw residue 83/133 → 82/132; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.417.0 → 0.418.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D531 −1 sentence / −1 printing — THE BOARD-TYPED HAND SEARCH — `searchDeck` GAINS THE PARK-TIME RIDER `typedAsAttachedBasicEnergy`** — `censusAttackCorpus.ts` **FILE LINE 483** (`legalAttackCorpus()` index 430), *"Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (sv07-065 per the retired D231 deferral; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_HAND_SEARCH_TYPED_AS_ATTACHED`, beside `ATTACK_HAND_SEARCH_BENCH_COUNT`) whose rider the park resolves against the SOURCE body's attached Basic Energy — a READER move: reader arm 556/1598 → 557/1599, raw residue 84/134 → 83/133; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.416.0 → 0.417.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)
    expect(unbuilt.map(([, s]) => s)).not.toContain(FOUR_ZONE);
    const resolved = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    // 🆕🆕🆕 D526 +1 sentence / +1 printing (THE THREE-TIER HEADS LADDER — corpus FILE LINE 218, *"Flip 3 coins. If 1 of them is heads, this attack does 20 more damage. If 2 of them are heads, this attack does 50 more damage. If all of them are heads, this attack does 80 more damage."*,
    // 1 legal printing, claimed by `deriveAttackCoinFlip` as the eighth member `bonusLadder`, spent at `attack.ts`'s existing damage fold as an
    // exclusive three-tier table, ZERO new vocabulary; the sentence and printing steps AGREE at 1): 552/1594 → 553/1595, and the own-row
    // `without` pair re-derived BY HAND as resolved minus this suite's row (D525 (5)). Stepped by hand again (outside the annotated-chain sweep's shape).
    // 🆕🆕🆕 D527 +1 sentence / +1 printing (THE DYNAMIC-max HAND SEARCH — corpus FILE LINE 454, *"Search your deck for a number of cards up to the number of your Benched Pokémon and put them into your hand. Then, shuffle your deck."*,
    // 1 legal printing, claimed by `deriveAttackEffect` through `ATTACK_HAND_SEARCH_BENCH_COUNT` as the sibling's two-op shape with `max: "yourBenchCount"`, resolved at the park against the
    // attacker's Bench at step time, ZERO new vocabulary, one persisted-field widening with `MATCH_RECORD_VERSION` HELD at 30; the sentence and printing steps AGREE at 1): 553/1595 → 554/1596, and the own-row
    // `without` pair re-derived BY HAND as resolved minus this suite's row (D525 (5)). Stepped by hand again (outside the annotated-chain sweep's shape).
    // 🆕🆕🆕 **D530 +1 sentence / +1 printing — THE TARGET-COUNTER-SCALED BENCH SNIPE — A FOURTH `damageChosen` RIDER, `perDamageCounterOnTarget`, READ PER REF AT THE ANSWER** — `censusAttackCorpus.ts` **FILE LINE 551** (`legalAttackCorpus()` index 498), *"This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing** (no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new anchor (`BENCHED_SNIPE_TARGET_COUNTERS`, beside `BENCHED_SNIPE_TAKEN_PRIZES`, disjoint by TAIL) as arm 6b′ — a READER move: reader arm 555/1597 → 556/1598, raw residue 85/135 → 84/134; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.415.0 → 0.416.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.
    // 🆕🆕🆕 D528 +1 sentence / +1 printing (THE HEADS-CEILINGED DISCARD-TO-BENCH ENERGY ATTACH — THE ATTACH TWIN OF D525, ZERO VOCABULARY, NO NEW `AttackCoinFlip` MEMBER — corpus FILE LINE 215, *"Flip 3 coins. Attach a number of Basic {L} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like."*, 1 legal printing, claimed by `deriveAttackCoinFlip` as `programPerHeads` over ONE copy of D358's discard-spread op, H declinable parks at the existing fold, ZERO new vocabulary, no fold/interpreter bytes; the sentence and printing steps AGREE at 1): 554/1596 → 555/1597. Stepped by hand (outside the annotated-chain sweep's shape).
    expect([resolved.length, units(resolved)]).toEqual([600, 1663]);  // (🆕🆕🆕 **D579 +1 sentence / +1 printing — THE CENSUS CLOSE-OUT** — Koraidon `sv08-116` "Unrelenting Onslaught", claimed WHOLE by `deriveAttackDamageBonus` through one `CONDITIONAL_DAMAGE_CLAUSES` literal; Walking Wake `sv06-063` is a REGISTRY row and moves no reader figure.) (🆕🆕🆕 **D575 +6 sentences / +6 printings — THE MRV-38 ATTACK SLICE** — `deriveAttackEffect`'s six new whole-sentence anchors claim `censusAttackCorpus.ts` file lines 177 (Hypno "Daydream"), 181 (Miraidon "C.O.D.E.: Protect"), 182 (Iron Moth "Anachronism Repulsor"), 346 (N's Sigilyph "Victory Symbol"), 394 (Team Rocket's Blipbug "Searching Eyes") and 690 (Glimmora "Corrosive Shards", the compound claimed WHOLE) — one printing each, so the sentence and printing steps AGREE. A READER move.) (🆕🆕🆕 **D574 +3 sentences / +5 printings — THE COPY-FAMILY REMAINDER + SABLEYE** — `deriveAttackCopy`'s two RESOLVE-TIME anchors claim `censusAttackCorpus.ts` file lines 434 and 131 WHOLE (Haughty Order ×3, Seek Inspiration) and `deriveAttackEffect`'s new anchor claims file line 649 (Sableye "Damage Collection"). Alakazam (686) composes through the TRAILING seam and Malamar (489) is a REGISTRY row — neither is a reader move. A READER move; the sentence step (3) and the printing step (5) DISAGREE, so each site was classified by its unit.) (🆕🆕🆕 **D573 +4 sentences / +9 printings — THE COPY-ATTACK SUBSTITUTION** — `deriveAttackCopy`, the FOURTEENTH reader, claims `censusAttackCorpus.ts` file lines 77, 78, 80 and 245 WHOLE: Night Joker ×4, Foul Play ×2 + Metronome, Gemstone Mimicry, Try to Imitate. A READER move; the sentence step (4) and the printing step (9) DISAGREE, so each site was classified by its unit.) (🆕🆕🆕 **D569 +4 sentences / +6 printings — THE PARADOX BANNER READERS** — Koraidon `sv05-119`/`svp-091` "Primordial Beatdown" (`IN_PLAY_BODY_NOUNS` "Ancient Pokémon"), Roaring Moon `sv05-109`/`sv08.5-065` "Vengeance Fletching" (`DISCARD_PILE_NOUNS` "Ancient card"), Iron Valiant `sv05-080` "Majestic Sword" and Slither Wing `sv06.5-026` "Iron Smasher" (two literal `CONDITIONAL_DAMAGE_CLAUSES` rows), all over `banners.ts`' widened table (582/1636 → 586/1642)) (🆕🆕🆕 **D568 +2 sentences / +2 printings — THE TWO TERA CLAUSES, NOW THAT THE BANNER HAS A WRITER** — Ho-Oh `sv08-019` "Shining Blaze" (*"If you have any Tera Pokémon on your Bench, this attack does 100 more damage."*) and Regigigas `sv08.5-086` "Jewel Breaker" (*"If your opponent's Active Pokémon is a Tera Pokémon, this attack does 230 more damage."*), one legal printing each, two literal `CONDITIONAL_DAMAGE_CLAUSES` rows over `banners.ts` (580/1634 → 582/1636)) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: reader arm 578/1632 → 580/1634.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: reader arm 577/1631 → 578/1632.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: reader arm 573/1627 → 577/1631.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: reader arm 572/1625 → 573/1627.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: reader arm 570/1621 → 572/1625.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: reader arm 568/1619 → 570/1621.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: reader arm 567/1617 → 568/1619.)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: reader arm 566/1615 → 567/1617.)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen`. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 for the first time in six slices — the one case where a copied number is right by accident, so THIS SITE was measured off the live failure and never copied from a neighbour.)  // (🆕🆕🆕 **D539 +1 sentence / +2 printings — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3). THIS SITE: 563/1611 → 564/1613.)  // (🆕🆕🆕 **D538 +1 sentence / +3 printings — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 562/1608 → 563/1611.)  // (🆕🆕🆕 **D537 +1 sentence / +2 printings — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 561/1606 → 562/1608.)  // (🆕🆕🆕 **D536 +1 sentence / +3 printings — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT — ONE NEW FIELD-FREE `EffectOp` MEMBER `discardDefender` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229` — the ids ARE resolved on this checkout and are used as ids; the printed BASE DAMAGE is NOT, so it is driven on the file-local declared demonstrator `d536-moltres`, D425), claimed by `deriveAttackEffect` through ONE new ZERO-capture anchor (`TR_ENERGY_COST_THEN_DISCARD_DEFENDER`, beside `HAND_COST_THEN_OPPONENT_DISCARD`) as `discardEnergy{from:"yourActive", filter:{byName "Team Rocket's Energy"}, recordAs:"discarded"}` gated through the FIRST shipped `recordGate{slot:"discarded"}` into the new `discardDefender` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING; the op never parks and is FIELD-FREE). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 3 — harder than D535's 1-and-2, so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 560/1603 → 561/1606.)  // (🆕🆕🆕 **D535 +1 sentence / +2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 +1 sentence / +1 printing — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D532 +1 sentence / +1 printing — THE CROSS-SEAT DISCARD-PILE ATTACH — `attachEnergyFrom` GAINS THE OPTIONAL KEY `whose: "opponent"` (on the op AND on `AttachTargetRiders`, read through ONE resolver)** — `censusAttackCorpus.ts` **FILE LINE 70** (`legalAttackCorpus()` index 17), *"Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like."*, **1 sentence / 1 legal printing** (Grafaiai `sv08-121`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_DISCARD_ATTACH`, beside the factory-built `DISCARD_ATTACH`) as D360's spread ONE KEY OVER — a READER move: reader arm 557/1599 → 558/1600, raw residue 83/133 → 82/132; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.417.0 → 0.418.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D531 +1 sentence / +1 printing — THE BOARD-TYPED HAND SEARCH — `searchDeck` GAINS THE PARK-TIME RIDER `typedAsAttachedBasicEnergy`** — `censusAttackCorpus.ts` **FILE LINE 483** (`legalAttackCorpus()` index 430), *"Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (sv07-065 per the retired D231 deferral; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_HAND_SEARCH_TYPED_AS_ATTACHED`, beside `ATTACK_HAND_SEARCH_BENCH_COUNT`) whose rider the park resolves against the SOURCE body's attached Basic Energy — a READER move: reader arm 556/1598 → 557/1599, raw residue 84/134 → 83/133; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.416.0 → 0.417.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — the version.
// ─────────────────────────────────────────────────────────────────────────────

const RAW: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string,
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob("./{effects,registry,index}.ts", { query: "?raw", import: "default", eager: true });

describe("D520 §8 — the version steps, and the heading is written", () => {
  it("engineVersion and `manifest.version` agree, and the bump is owed for BEHAVIOUR", () => {
    // ⚠️ The version is NOT spelled in this `it(…)` title (D460's fourth class).
    expect(engineVersion).toBe("0.484.0");
    expect(manifest.version).toBe(engineVersion);
  });

  it("🛑 the changelog heading for this bump is present in `index.ts`, labelled with its decision", () => {
    const index = Object.entries(RAW).find(([k]) => k.endsWith("/index.ts"))?.[1] ?? "";
    expect(index.length).toBeGreaterThan(1_000_000);
    expect(index).toContain("engineVersion 0.406.0 → **0.407.0** (D520");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — what stands still.
// ─────────────────────────────────────────────────────────────────────────────

describe("D520 §9 — no new op kind, the producer counts moved as stated, and the record constant holds", () => {
  const text = Object.entries(RAW)
    .filter(([k]) => !k.endsWith("/index.ts"))
    .map(([, v]) => v)
    .join("\n");
  const declarations = (name: string) => (text.match(new RegExp(`op: "${name}";`, "g")) ?? []).length;
  const producers = (name: string) => (text.match(new RegExp(`op: "${name}",`, "g")) ?? []).length;

  it("🛑 `EffectOp` gained NO kind: `spreadDamage` is still ONE member, `damageDefender` still TWO, `conditionGate` ONE", () => {
    expect(Object.keys(RAW).filter((k) => !k.endsWith("/index.ts"))).toHaveLength(2);
    expect(declarations("spreadDamage")).toBe(1);
    expect(declarations("damageDefender")).toBe(2);
    expect(declarations("conditionGate")).toBe(1);
  });

  it("🛑 the producer counts moved by exactly this arm: `spreadDamage` 7 → 9, `damageDefender` 9 → 10", () => {
    // D507's confound, restated as the CORRECTION: the arity was never the price, and the
    // producer count is reported with the sites this slice authored named (D427).
    // 🆕🆕🆕 D522 — `spreadDamage` 9 → 10: arm 43-bis (the Stadium-gated Bench spread, corpus FILE
    // LINE 293) is one more raw site; `damageDefender` is untouched at 10. Outside the sweep's
    // shape, found by the full `check` (D419/D521 (4)).
    // 🆕🆕🆕 D552 — `damageDefender` 10 → 11: `discardScaledBoostProgram`'s `selfHandAttach`
    // case is one more raw site (corpus FILE LINE 569); `spreadDamage` untouched at 10.
    expect(producers("spreadDamage")).toBe(10);
    // 🆕🆕🆕 D571 — `damageDefender` 11 → 12: registry.ts `DESTRUCTO_PRESS`'s `{ op:
    // "damageDefender", per: 70, count: "discarded" }` is one more raw site; `spreadDamage`
    // untouched at 10. Outside the census sweep's shape, found by the full run (D419/D521 (4)).
    // 🆕🆕🆕 D579 — `damageDefender` 12 → 13: registry.ts `UNDULATING_SLICE`'s top-level `{ op:
    // "damageDefender", per: 20, count: "placed" }` is one more raw site; `spreadDamage` untouched
    // at 10. Outside the census sweep's shape, found by the full run (D419/D521 (4)).
    // 🆕🆕🆕 D597 — `damageDefender` 13 → 16: effects.ts arm 10d's `commaHit`, the `handDiscard` case of
    // `discardScaledBoostProgram` and registry.ts `INFERNO_X` are three more raw sites; `spreadDamage`
    // untouched at 10.
    expect(producers("damageDefender")).toBe(16);
  });

  it("🛑 `MATCH_RECORD_VERSION` HOLDS at 30: zero new serialized bytes, no op parks, the gate is spliced", () => {
    // Every kind, field and value in the program already ships — a v30 deploy could already
    // write these bytes — so the program survives a JSON round trip unchanged.
    expect(JSON.parse(JSON.stringify(PROGRAM))).toEqual(PROGRAM);
    // Neither damage op parks and the gate is spliced: `runProgram` answers `done` over the
    // WHOLE program on a board where a CHOSEN sibling would genuinely park (five benched
    // bodies), so `phase.cont.pendingOp` and `rest` are never written.
    const state = table("d520-wall", CANONICAL);
    const events: GameEvent[] = [];
    expect(runProgram(state, PROGRAM, ctx, events).kind).toBe("done");
    expect(swing(state).state.phase.kind).not.toBe("effect:choose");
  });

  it("🛑 the demonstrator is FILE-LOCAL — zero `FIXTURE_POOL` ids, and the shared pool is untouched", () => {
    expect(Object.keys(FOUR_ZONE_CARDS).every((id) => FIXTURE_POOL[id] === undefined)).toBe(true);
    expect(FOUR_ZONE_DECK).toHaveLength(60);
  });
});
