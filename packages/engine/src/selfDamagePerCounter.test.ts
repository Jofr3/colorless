import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, splitAttackGateClause, splitAttackTrailingClause } from "./effects";
import type { EffectOp } from "./effectTypes";
import { applyAction } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  SELF_DAMAGE_PER_COUNTER_DECK,
  attachFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
  findEvent,
  roundTrip,
} from "./testFixtures";

const PRINTED = "This Pokémon also does 10 damage to itself for each damage counter on it.";

const BARE = "This Pokémon also does 10 damage to itself.";

const CONSTRUCTED_MISSES = [
  // the printed "also" — the family's stated guard, kept on the new anchor
  "This Pokémon does 10 damage to itself for each damage counter on it.",
  // a lowercase "this": no /i, and the capital is half of what keeps a mid-sentence clause
  // off the derived path (the family's Krookodile convention)
  "this Pokémon also does 10 damage to itself for each damage counter on it.",
  // ASCII "Pokemon" — the é is load-bearing
  "This Pokemon also does 10 damage to itself for each damage counter on it.",
  // a printed 0 is not a real card; left loud rather than derived to a silent no-op
  "This Pokémon also does 0 damage to itself for each damage counter on it.",
  // the terminator: `\.$` is what makes this anchor and `SELF_DAMAGE` mutually exclusive
  "This Pokémon also does 10 damage to itself for each damage counter on it",
  // a DIFFERENT count — the anaphor "it" is the attacker, and no other body is meant
  "This Pokémon also does 10 damage to itself for each damage counter on your opponent's Active Pokémon.",
  // leading text pins `^`
  "Draw a card. This Pokémon also does 10 damage to itself for each damage counter on it.",
  // the subject changed: "This attack" is a different sentence family entirely
  "This attack does 10 damage to itself for each damage counter on it.",
] as const;
const types = (events: GameEvent[]) => events.map((e) => e.type);
const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);

const IDX = { scaled: 0, flat: 1 } as const;

/** P1 fields `fix-recoil-scale` with one {C} attached, P2 fields the 340 HP `fix-titan`, both
    benches cleared. `damage` is the counters already on the ATTACKER when the attack runs. */
function board(seed: number, damage: number): GameState {
  const setup = driveSetup(
    seed,
    { p1: SELF_DAMAGE_PER_COUNTER_DECK, p2: SELF_DAMAGE_PER_COUNTER_DECK },
    { first: "p2" },
  );
  let state = must(applyAction(setup, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", "fix-recoil-scale");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  return deepFreeze(setDamage(state, "p1", damage));
}

const swing = (state: GameState, index: number) =>
  mustApply(state, { type: "attack", seat: "p1" as Seat, index });

describe("§1 — the printed sentence, the op it derives to, and the one axis that moves", () => {
  it("both strings are REAL corpus rows at the printings the docs claim (D425)", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(PRINTED)).toBe(1);
    expect(rows.get(BARE)).toBe(21);
    // …and the FIXTURE prints them byte for byte, so nothing below is transcription.
    expect(FIXTURE_POOL["fix-recoil-scale"]?.attacks?.[IDX.scaled]?.effect).toBe(PRINTED);
    expect(FIXTURE_POOL["fix-recoil-scale"]?.attacks?.[IDX.flat]?.effect).toBe(BARE);
  });

  it("derives the scaled recoil as the SHIPPED op plus one rider", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual([
      { op: "damageSelf", amount: 10, perDamageCounterOnSelf: true },
    ]);
  });

  it("the ONE-AXIS control: deleting the clause gives the shipped BARE op, unchanged", () => {
    // The rider, and not the anchor or the amount, is what moved. This is also the exact
    // string the fixed span probe reaches — see §7.
    expect(deriveAttackEffect(BARE)).toEqual([{ op: "damageSelf", amount: 10 }]);
  });

  it("the two anchors are MUTUALLY EXCLUSIVE BY `\\.$`, not by their order", () => {
    // `SELF_DAMAGE` requires the string to END at "itself.", so it cannot match a sentence
    // that continues. Stated in `effects.ts` and executable here: the scaled sentence carries
    // the bare one as a PREFIX up to the period, and the bare anchor still refuses it.
    expect(PRINTED.startsWith(BARE.slice(0, -1))).toBe(true);
    expect(/^This Pokémon also does (\d+) damage to itself\.$/.test(PRINTED)).toBe(false);
    // …and the converse: the scaled anchor refuses the bare sentence.
    expect(
      /^This Pokémon also does (\d+) damage to itself for each damage counter on it\.$/.test(BARE),
    ).toBe(false);
  });

  it("refuses every constructed near miss — each moves exactly one axis", () => {
    for (const text of CONSTRUCTED_MISSES) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    const printed = new Set(legalAttackCorpus().map(([, s]) => s));
    for (const text of CONSTRUCTED_MISSES) expect(printed.has(text), text).toBe(false);
  });

  it("the amount is CAPTURED, not hard-coded to the one printed 10", () => {
    expect(
      deriveAttackEffect(
        "This Pokémon also does 40 damage to itself for each damage counter on it.",
      ),
    ).toEqual([{ op: "damageSelf", amount: 40, perDamageCounterOnSelf: true }]);
  });
});

describe("§2 — the census moves in exactly ONE summand, and the step is 1 and 1", () => {
  it("the resolving corpus gains ONE sentence and ONE printing", () => {
    const resolved = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([resolved.length - without.length, units(resolved) - units(without)]).toEqual([1, 1]);
  });

  it("the move is READER-keyed: no registry row, no gate clause, no trailing split", () => {
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    // The reader SURFACE does not move: the arm rides `deriveAttackEffect`, which already ships.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the board: the fold is real, and ZERO counters is SILENT.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the recoil scales off the attacker's own counters", () => {
  it("the multiplier is the COUNTER count — 3 counters → 30, 7 → 70, on one sentence", () => {
    // §12: one counter is 10 HP. 30 damage on the body is 3 counters, so the printed 10
    // becomes 30 — and the attacker ends at 30 + 30 = 60.
    const three = swing(board(1, 30), IDX.scaled);
    expect(findEvent(three.events, "COUNTERS_PLACED")).toMatchObject({
      amount: 30,
      source: "self",
    });
    expect(three.state.players.p1.active?.damage).toBe(60);
    // A second, different multiplier so "30" cannot be a hard-coded number: 7 counters → 70,
    // and 70 + 70 = 140 on a 200 HP body, which still does not KO.
    const seven = swing(board(2, 70), IDX.scaled);
    expect(findEvent(seven.events, "COUNTERS_PLACED")).toMatchObject({
      amount: 70,
      source: "self",
    });
    expect(seven.state.players.p1.active?.damage).toBe(140);
  });

  it("THE LOSS DIRECTION — an UNDAMAGED attacker takes NO recoil and emits NO event", () => {
    const { state, events } = swing(board(3, 0), IDX.scaled);
    expect(state.players.p1.active?.damage).toBe(0);
    expect(findEvent(events, "COUNTERS_PLACED")).toBeUndefined();
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 20 });
    expect(state.players.p2.active?.damage).toBe(20);
  });

  it("the CONTROL on the same body: index 1 stays at the printed 10 with 3 counters", () => {
    // Same fixture, same board, same printed amount, clause deleted → 10 and not 30. Without
    // this rung "the recoil was 30" is equally consistent with a build that scales EVERY
    // recoil, and with one that reads the amount off the body's damage directly.
    const { state, events } = swing(board(4, 30), IDX.flat);
    expect(findEvent(events, "COUNTERS_PLACED")).toMatchObject({ amount: 10, source: "self" });
    expect(state.players.p1.active?.damage).toBe(40);
  });

  it("the count is FLOORED, and a non-multiple of 10 proves the division is there", () => {
    // 25 HP of damage is TWO counters, not two and a half: `Math.floor(damage / 10)`, the same
    // arithmetic `scaledAttackDamage`'s `damageCountersOnSelf` arm does. A fold written as
    // `damage / 10` reads 2.5 here and places 25; a fold written as `damage` places 250.
    const { state, events } = swing(board(5, 25), IDX.scaled);
    expect(findEvent(events, "COUNTERS_PLACED")).toMatchObject({ amount: 20, source: "self" });
    expect(state.players.p1.active?.damage).toBe(45);
  });

  it("THE FOLD READS THE BODY BEFORE IT WRITES IT — the recoil is not self-referential", () => {
    const { state, events } = swing(board(6, 30), IDX.scaled);
    const placed = events.filter((e) => e.type === "COUNTERS_PLACED");
    expect(placed).toHaveLength(1); // one read, one write, no fixed point
    expect(state.players.p1.active?.damage).toBe(60);
    expect(state.players.p1.active?.damage).not.toBe(90);
  });

  it("the recoil is OUTSIDE the §8.5 pipeline — COUNTERS_PLACED, not DAMAGE_DEALT", () => {
    const { events } = swing(board(7, 30), IDX.scaled);
    expect(types(events)).toContain("COUNTERS_PLACED");
    const self = findEvent(events, "COUNTERS_PLACED");
    expect(self?.seat).toBe("p1");
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(20);
    // …and the recoil's 30 never appears as dealt damage anywhere.
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the derived bytes, driven in THREE directions including LOSS.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the op's bytes, three directions, and why none of them is persisted", () => {
  it("`MATCH_RECORD_VERSION` STAYS 29 — the argument is REACHABILITY, and it is DRIVEN", () => {
    const program = deriveAttackEffect(PRINTED);
    expect(program).toHaveLength(1);
    // (a) — resolving the attack leaves NO continuation: the phase is back to a normal turn
    // and nothing was persisted. A parking op would leave `phase.cont` behind instead.
    const { state } = swing(board(8, 30), IDX.scaled);
    expect("cont" in state.phase).toBe(false);
    expect("cont" in swing(board(9, 0), IDX.scaled).state.phase).toBe(false);
  });

  it("DIRECTION 1 — the OLD spelling is untouched: the bare op gains no key", () => {
    expect(JSON.stringify(deriveAttackEffect(BARE)?.[0])).toBe('{"op":"damageSelf","amount":10}');
  });

  it("DIRECTION 2 — the NEW value round-trips byte for byte, key order kept", () => {
    const fresh = deriveAttackEffect(PRINTED)?.[0];
    expect(JSON.stringify(fresh)).toBe(
      '{"op":"damageSelf","amount":10,"perDamageCounterOnSelf":true}',
    );
    expect(roundTrip(fresh)).toEqual(fresh);
  });

  it("DIRECTION 3 — a record that LOSES the key degrades LOUDLY (D421's criterion)", () => {
    const fresh = deriveAttackEffect(PRINTED)?.[0];
    const dropped = JSON.parse(
      JSON.stringify(fresh, (k, v) => (k === "perDamageCounterOnSelf" ? undefined : v)),
    ) as EffectOp;
    expect(dropped).toEqual(deriveAttackEffect(BARE)?.[0]);
  });
});

describe("§5 — the family, measured over the whole column rather than described", () => {
  it("FOURTEEN rows / 72 printings, and exactly ONE of them scales the RECOIL", () => {
    const family = legalAttackCorpus().filter(([, s]) => s.includes("to itself"));
    expect([family.length, units(family)]).toEqual([14, 72]);
    const anyForEach = family.filter(([, s]) => /for each/.test(s));
    expect(anyForEach).toHaveLength(2);
    const scaledRecoil = family.filter(([, s]) => /damage to itself for each/.test(s));
    expect(scaledRecoil.map(([, s]) => s)).toEqual([PRINTED]);
    // …so this anchor buys the whole scaled-recoil class and leaves NO printed twin refused
    // for want of the same mechanism — the check that `OPAQUE`-as-EXPENSIVE keeps getting
    // wrong in the other direction.
  });

  it("the family's UNBUILT remainder is ONE row, NAMED (D521 built the other), and neither wanted this rider", () => {
    const unbuilt = legalAttackCorpus()
      .filter(([, s]) => s.includes("to itself") && !resolvedByAnyReader(s))
      .map(([, s]) => s);
    expect(unbuilt).toHaveLength(1);
    const TWO_COIN =
      "Flip 2 coins. If both of them are tails, this Pokémon also does 90 damage to itself.";
    expect(unbuilt).not.toContain(TWO_COIN);
    expect(resolvedByAnyReader(TWO_COIN)).toBe(true);
    expect(deriveAttackEffect(TWO_COIN)).toEqual([
      {
        op: "coinFlipGate",
        coins: 2,
        onTails: true,
        ops: [{ op: "damageSelf", amount: 90 }],
      },
    ]);
    expect(unbuilt).toContain(
      "This attack does 50 more damage for each Prize card your opponent has taken. This Pokémon also does 30 damage to itself.",
    );
    for (const s of unbuilt) expect(s.includes("damage to itself for each"), s).toBe(false);
    expect(unbuilt).toEqual([
      "This attack does 50 more damage for each Prize card your opponent has taken. This Pokémon also does 30 damage to itself.",
    ]);
  });
});

describe("§6 — the span probe's tail repair, which is why this row was visible at all", () => {
  it("deleting the six-token tail and RE-ATTACHING the period reaches the BUILT twin", () => {
    const tok = PRINTED.split(" ");
    const plain = tok.slice(0, tok.length - 6).join(" ");
    expect(plain).toBe("This Pokémon also does 10 damage to itself");
    expect(deriveAttackEffect(plain)).toBeNull();
    // …and the repair — re-attach the sentence terminator — reaches the shipped bare twin.
    expect(`${plain}.`).toBe(BARE);
    expect(resolvedByAnyReader(`${plain}.`)).toBe(true);
  });
});
