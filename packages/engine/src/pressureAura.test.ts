import { describe, expect, it } from "vitest";
import { applyDamageModifier } from "./cards";
import type { DamageModifier } from "./cards";
import { disabledAbilityUids, opposingAttackDebuff } from "./continuous";
import { deriveAttackEffect } from "./effects";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  PRESSURE_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  clearBench,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setPrizes,
} from "./testFixtures";

// 0.98.0 → 0.99.0 — the ALWAYS-ON ATTACKER-SIDE DAMAGE DEBUFF (P3-M5 long tail,
// D151), and the last unbuilt member of the family D149 opened:
//
//   "As long as this Pokémon is in the Active Spot, attacks used by your
//    opponent's Active Pokémon do 20 less damage (before applying Weakness and
//    Resistance)."                                    (Entei sv03-030 "Pressure")
//
// ⚠️ ONE PRINTING, AND THE COUNT IS THIS SESSION'S OWN QUERY, not D149's. The
// local D1 (2026-08-02, 978 cards / 6 sets) prints "less damage (before applying Weakness
// and Resistance)" on SIX rows — Houndoom sv06.5-008/-066, Florges sv01-093,
// Pidove swsh10.5-061, Pikachu sv02-062 and this one — and exactly one of the six
// is an ABILITY. Asked as its own question ("in the Active Spot" AND "less
// damage") the answer is Entei alone. The id's NAME, the Ability's name and the
// effect string were re-queried too: all three hold.
//
// ⚠️ IT IS `opposingRetreatBlocked`'s SHAPE AND NOT `passivesOf`'s, which is the
// whole reason D149 scoped it out and the whole content of this slice.
// `passivesOf` folds the HOLDER's own catalog row; this number belongs to the
// holder's OPPONENT, so it is a cross-board SCAN (continuous.ts
// `opposingAttackDebuff`) SUMMED beside `installedAttackDebuffOf` at the same four
// sites — exactly as the after-W/R reduction has summed its catalog and installed
// halves since D147. Nothing else moved: the four read sites, the clamp, the
// `DAMAGE_DEALT.debuff` field and the log's "· weakened −N" crumb all existed.
//
// ⚠️ AND THE TWO HALVES ANSWER §9 DIFFERENTLY, WHICH IS THE SHARPEST THING HERE.
// The aura is an ABILITY and a live Ability-lock silences it; D149's stamp is an
// attack INSTALLATION on a record and no lock can reach it. One board drives both
// at once ("the §9 pair" below), and that asymmetry is why the aura could never
// have been a `PassiveEffects` field read through the stamp's own reader.

/** The printed sentence, byte-for-byte off the local D1 row. */
const PRESSURE =
  "As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon do 20 less damage (before applying Weakness and Resistance).";
/** The printed amount, likewise. */
const AMOUNT = 20;
/** D149's DURATED sibling, for the summation and the §9 asymmetry. */
const GROWL =
  "During your opponent's next turn, the Defending Pokémon's attacks do 20 less damage (before applying Weakness and Resistance).";

/** One seed for the whole suite: nothing in this family flips a coin, so a seed
    table would describe a shuffle rather than a rule (D143's move, inherited by
    every durated slice since). */
const SEED = 7;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** ⚠️ THE ORDERING ORACLE — D149's, unchanged, because the aura lands at D149's
    step. §8.5's pre-W/R subtotal computed BOTH ways from a row's own reported
    fields, so the pin is on the ENGINE's arithmetic rather than on a number a test
    author typed: `beforeWR` clamps (base + bonus − debuff) and only then runs
    Weakness/Resistance; `afterWR` is the only other placement a build could
    plausibly choose. Every damage row here is checked against `beforeWR`, and
    every row reporting a Weakness is additionally asserted to DIFFER from
    `afterWR` — which is what makes the printed parenthetical observable rather
    than decorative. */
function pipeline(row: {
  base: number;
  scaled?: number;
  bonus?: number;
  debuff?: number;
  weakness: DamageModifier | null;
  resistance: DamageModifier | null;
  reduction?: number;
}): { beforeWR: number; afterWR: number } {
  const raw = row.base + (row.scaled ?? 0) + (row.bonus ?? 0);
  const debuff = row.debuff ?? 0;
  const reduction = row.reduction ?? 0;
  // The engine's OWN modifier fold (cards.ts), reused rather than re-implemented.
  const modify = (value: number): number =>
    Math.max(0, applyDamageModifier(applyDamageModifier(value, row.weakness), row.resistance));
  return {
    beforeWR: Math.max(0, modify(Math.max(0, raw - debuff)) - reduction),
    afterWR: Math.max(0, modify(raw) - debuff - reduction),
  };
}

function expectBeforeWR(row: Extract<GameEvent, { type: "DAMAGE_DEALT" }>): void {
  const { beforeWR, afterWR } = pipeline(row);
  expect(row.dealt).toBe(row.prevented === true ? 0 : beforeWR);
  if (row.weakness !== null && (row.debuff ?? 0) > 0 && row.prevented !== true) {
    expect(beforeWR).not.toBe(afterWR);
    expect(row.dealt).not.toBe(afterWR);
  }
}

/** Every attacker this suite declares, with the INDEX and the energy its cost
    needs — read off the local D1 per printing (D144's rule, D146's names). */
const ATTACKERS = {
  "sv02-062": { index: 1, energy: [{ id: "fix-lightning-energy", count: 1 }, { id: "fix-energy", count: 1 }] }, // Pikachu "Pika Bolt" (30)
  "sv01-048": { index: 0, energy: [{ id: "fix-water-energy", count: 1 }, { id: "fix-energy", count: 1 }] }, // Alomomola "Surf" (30, WATER)
  "sv02-127": { index: 0, energy: [{ id: "fix-fighting-energy", count: 3 }] }, // Ting-Lu ex "Land Scoop" (150)
  "sv01-069": { index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // Rotom "Linear Attack" (snipe 20)
  "fix-feint": { index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // "Feint Attack" ({C}, 50, ignoreWR)
  "fix-sniper": { index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // "Spread Shot" (30 + 20 each benched)
  "fix-bramble": { index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // "Bramble" (40 per taken Prize, benched)
  "sv03-030": { index: 0, energy: [{ id: "fix-energy", count: 3 }] }, // Entei "Blaze Ball" (60, no {R} in this deck)
} as const;

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. The
    ATTACKER goes on P1's Active and `defender` on P2's — and the aura is read off
    the board at DAMAGE time, so both bodies have to be in the Active Spot before
    the declaration, which is the whole content of "both ends Active". */
function board(attacker: keyof typeof ATTACKERS, defender: string): GameState {
  let state = must(
    applyAction(driveSetup(SEED, { p1: PRESSURE_DECK, p2: PRESSURE_DECK }, { first: "p2" }), {
      type: "endTurn",
      seat: "p2",
    }),
  );
  state = setActiveFromDeck(state, "p1", attacker);
  for (const { id, count } of ATTACKERS[attacker].energy) {
    state = attachFromDeck(state, "p1", id, count);
  }
  state = setActiveFromDeck(state, "p2", defender);
  return state;
}

function swing(state: GameState, attacker: keyof typeof ATTACKERS, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: ATTACKERS[attacker].index });
}

/** D149's record, written straight onto a body. The stamped half and the aura half
    are installed by opposite seats on opposite turns and no single declaration can
    put both live, so the interaction cases DRIVE the aura (it is a board fact) and
    CONSTRUCT the stamp — D144/D146's precedent, and D149's own `withDebuff`. */
function withDebuff(state: GameState, seat: Seat, amount: number, turn = state.turn): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error("no Active to stamp");
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, active: { ...active, attackDamageDebuff: { turn, amount } } },
    },
  };
}

/** Put damage counters on a seat's Active — the switch that arms Ting-Lu ex's
    "Cursed Land" against it (the lock's printed clause is "that have any damage
    counters on them"). */
function withDamage(state: GameState, seat: Seat, damage: number): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error("no Active to damage");
  return { ...state, players: { ...state.players, [seat]: { ...side, active: { ...active, damage } } } };
}

// ─────────────────────────────────────────────────────────────────────────────
// The datum: the catalog row, the fixture, and the registry row.
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed datum — re-queried, not inherited", () => {
  it("carries Entei's NAME, its printed Ability and its printed attack verbatim", () => {
    // ⚠️ THE FIXTURE WAS PARTIAL AND NOTHING COULD FAIL ON IT (D149's lesson).
    // sv03-030 has sat in FIXTURE_POOL since 0.35.0 as the unsimulated-"+" witness,
    // verbatim on every field it carried and carrying NO `abilities` array at all —
    // on a card with exactly one printed Ability, which is this slice's whole
    // mechanism. A partial fixture is a valid `Card`, so every assertion about it
    // passed. D151 added the row; this test is what now fails if it is dropped.
    expect(FIXTURE_POOL["sv03-030"]?.name).toBe("Entei");
    expect(FIXTURE_POOL["sv03-030"]?.hp).toBe(130);
    expect(FIXTURE_POOL["sv03-030"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv03-030"]?.abilities).toEqual([
      { type: "Ability", name: "Pressure", effect: PRESSURE },
    ]);
    // The attack row is unchanged and asserted beside it, because the two arrays
    // are the two ways this fixture could be wrong by omission.
    expect(FIXTURE_POOL["sv03-030"]?.attacks).toEqual([
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Blaze Ball",
        damage: "60+",
        effect: "This attack does 20 more damage for each {R} Energy attached to this Pokémon.",
      },
    ]);
  });

  it("is AUTHORED in the registry and still REFUSED by the attack deriver", () => {
    // The registry row is the datum's whole cost — one flag, one number.
    expect(programFor("sv03-030")?.passive).toEqual({ opponentActiveAttackDebuff: AMOUNT });
    expect(programFor("sv03-030")?.attack).toBeUndefined();
    // …and the sentence STAYS LOUD as attack text, which is the other half of the
    // refusal D149 pinned: deriving a permanent Ability into a one-shot op would
    // install a one-turn stamp onto the wrong body. Re-pointed rather than deleted.
    expect(deriveAttackEffect(PRESSURE)).toBeNull();
    // The DURATED sibling still derives, and neither sentence reaches the other's
    // reader — the family's taxonomy is unchanged by the aura landing.
    expect(deriveAttackEffect(GROWL)).toEqual([{ op: "weakenDefenderAttacks", amount: 20 }]);
  });

  it("is the ONLY printing — the census, run as its own question", () => {
    // Every id in the pool carrying `opponentActiveAttackDebuff`. One row, because
    // the D1 query ("in the Active Spot" AND "less damage") returns one card.
    const ids = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.opponentActiveAttackDebuff !== undefined,
    );
    expect(ids).toEqual(["sv03-030"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The scan: both Active clauses, and what leaving the spot does.
// ─────────────────────────────────────────────────────────────────────────────

describe("opposingAttackDebuff — the cross-board scan", () => {
  it("reads 20 for the opponent's Active while Entei is Active, and 0 for Entei's side", () => {
    const state = board("sv02-062", "sv03-030");
    const p1Active = state.players.p1.active;
    const p2Active = state.players.p2.active;
    if (p1Active === null || p2Active === null) throw new Error("board");
    // The TARGET end: P1's Active is "your opponent's Active Pokémon".
    expect(opposingAttackDebuff(state, p1Active)).toBe(AMOUNT);
    // …and the aura never weakens its OWN side. Entei's own "Blaze Ball" is not
    // "attacks used by your opponent's Active Pokémon", and asking the source is
    // the cheapest way to say so.
    expect(opposingAttackDebuff(state, p2Active)).toBe(0);
  });

  it("SOURCE clause: a BENCHED Entei does nothing (contrast opposingRetreatSurcharge)", () => {
    // The print OPENS with "As long as this Pokémon is in the Active Spot", so
    // unlike Spidops ex's surcharge — whose sentence scopes only the target — the
    // source end is Active-gated too. This is the assertion that distinguishes the
    // two members of the cross-board pair.
    let state = board("sv02-062", "fix-titan");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "sv03-030");
    const p1Active = state.players.p1.active;
    if (p1Active === null) throw new Error("board");
    expect(opposingAttackDebuff(state, p1Active)).toBe(0);
  });

  it("TARGET clause: a BENCHED attacker reads 0 even with Entei Active", () => {
    let state = board("sv02-062", "sv03-030");
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "fix-titan");
    const benched = state.players.p1.bench[0];
    if (benched === undefined) throw new Error("board");
    expect(opposingAttackDebuff(state, benched)).toBe(0);
  });

  it("an empty opposing Active Spot reads 0 rather than throwing", () => {
    // Totality, `opposingRetreatBlocked`'s arm verbatim: between a KO and the
    // promotion the spot really is null.
    const state = board("sv02-062", "sv03-030");
    const p1Active = state.players.p1.active;
    if (p1Active === null) throw new Error("board");
    const empty: GameState = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, active: null } },
    };
    expect(opposingAttackDebuff(empty, p1Active)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The four read sites, driven end to end.
// ─────────────────────────────────────────────────────────────────────────────

describe("the four damage sites — 20 off every one", () => {
  it("attack.ts main hit: Pika Bolt 30 into Entei lands 10, and the row REPORTS the 20", () => {
    const { events } = swing(board("sv02-062", "sv03-030"), "sv02-062");
    const row = find(events, "DAMAGE_DEALT");
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.base).toBe(30);
    expect(row.debuff).toBe(AMOUNT);
    expect(row.dealt).toBe(10);
    expectBeforeWR(row);
  });

  it("⚠️ THE PARENTHETICAL IS OBSERVABLE: Surf 30 into ×2-Water Entei lands 20, not 40", () => {
    // The one board in the pool where the two placements of the subtraction give
    // different numbers off a printed card. (30 − 20) × 2 = 20; 30 × 2 − 20 = 40.
    const { events } = swing(board("sv01-048", "sv03-030"), "sv01-048");
    const row = find(events, "DAMAGE_DEALT");
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row.debuff).toBe(AMOUNT);
    expect(row.dealt).toBe(20);
    expectBeforeWR(row); // …and asserts the OTHER reading is a different number.
  });

  it("interpreter spreadDamage: the aura comes off the BENCH splash too", () => {
    // The printed sentence scopes the ATTACKER and says nothing about the target,
    // which is exactly D149's census finding applied to the always-on member.
    let state = board("fix-sniper", "sv03-030");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    const { events } = swing(state, "fix-sniper");
    const rows = findAll(events, "DAMAGE_DEALT");
    // Row 0 is the main hit on Entei (30 − 20 = 10); row 1 the 20 splash, clamped
    // to 0 by the same 20.
    expect(rows.map((r) => r.dealt)).toEqual([10, 0]);
    expect(rows.map((r) => r.debuff)).toEqual([AMOUNT, AMOUNT]);
    for (const row of rows) expectBeforeWR(row);
  });

  it("interpreter placeSnipe `deals` arm: a benched pick is weakened as well", () => {
    let state = board("fix-bramble", "sv03-030");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    state = setPrizes(state, "p2", 4); // 2 taken → Bramble is 80
    const { events } = swing(state, "fix-bramble");
    const row = find(events, "DAMAGE_DEALT");
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.base).toBe(80);
    expect(row.debuff).toBe(AMOUNT);
    expect(row.dealt).toBe(60);
    expectBeforeWR(row);
  });

  it("interpreter snipeActive: Linear Attack's 20 into Entei clamps to 0", () => {
    // The clamp is at the pre-W/R step, and this is the printed board that reaches
    // it: 20 − 20 = 0, and a clamped zero is not a negative that later steps undo.
    // P2's Bench is emptied so the count-1 `opponentAny` pick auto-takes the Active
    // rather than parking (anyTargetSnipe.test.ts's idiom).
    const { events } = swing(clearBench(board("sv01-069", "sv03-030"), "p2"), "sv01-069");
    const row = find(events, "DAMAGE_DEALT");
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.base).toBe(20);
    expect(row.debuff).toBe(AMOUNT);
    expect(row.dealt).toBe(0);
  });

  it("⚠️ `ignoreWR` NULLS THE AURA AT snipeActive AND ONLY THERE", () => {
    // "Feint Attack" — "isn't affected by Weakness or Resistance, or by any effects
    // on that Pokémon". At THIS site the aura's source and "that Pokémon" are the
    // SAME BODY by construction (both are the opponent's Active), so the clause
    // reaches it and the 50 lands whole. The stamped half on the same line is NOT
    // nulled — it lives on the attacker's record — and the control below pins that
    // the aura really was live on this board.
    const state = clearBench(board("fix-feint", "sv03-030"), "p2");
    const { events } = swing(state, "fix-feint");
    const row = find(events, "DAMAGE_DEALT");
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.debuff).toBeUndefined();
    expect(row.dealt).toBe(50);
    // The control: the same attacker under a STAMP keeps paying it, so "nulled" is
    // a statement about the AURA and not about this site reading nothing at all.
    const stamped = swing(withDebuff(state, "p1", 20), "fix-feint");
    expect(find(stamped.events, "DAMAGE_DEALT")?.debuff).toBe(20);
    expect(find(stamped.events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });

  it("…but NOT at placeSnipe's bench arm, where the source is a DIFFERENT body", () => {
    // Same attack, same `ignoreWR`, a BENCHED pick: "that Pokémon" is now the
    // benched body and Entei's Ability is not an effect on IT — the aura's source is
    // still the Active across the table. So the 50 is weakened to 30 here while the
    // identical declaration one test up lands 50. That pair is the whole reading.
    let state = board("fix-feint", "sv03-030");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const pick = prompt.candidates.find(
      (ref) => ref.seat === "p2" && ref.spot.spot === "bench" && ref.spot.index === 0,
    );
    expect(pick).toBeDefined();
    if (pick === undefined) return;
    const { events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [pick] },
    });
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.debuff).toBe(AMOUNT);
    expect(row?.dealt).toBe(30);
    expect(benchTopUid(parked, "p2", 0)).toBe(row?.uid);
  });

  it("Entei's OWN attack is untouched — the aura is one-directional", () => {
    const { events } = swing(board("sv03-030", "fix-titan"), "sv03-030", "p1");
    const row = find(events, "DAMAGE_DEALT");
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.base).toBe(60); // no {R} in PRESSURE_DECK, so "60+" is a flat 60
    expect(row.debuff).toBeUndefined();
    expect(row.dealt).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The two halves of one number.
// ─────────────────────────────────────────────────────────────────────────────

describe("summation with D149's stamp, and the §9 pair", () => {
  it("SUMS: a stamped 20 plus the aura's 20 takes 40 off one hit", () => {
    // The number has two sources and one slot, exactly as the after-W/R reduction
    // has since D147. Ting-Lu ex's 150 → 110.
    const state = withDebuff(board("sv02-127", "sv03-030"), "p1", 20);
    const { events } = swing(state, "sv02-127");
    const row = find(events, "DAMAGE_DEALT");
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.debuff).toBe(40);
    expect(row.dealt).toBe(110);
    expectBeforeWR(row);
  });

  it("⚠️ THE §9 PAIR ON ONE BOARD — the lock silences the AURA and not the STAMP", () => {
    // Ting-Lu ex "Cursed Land": "As long as this Pokémon is in the Active Spot,
    // your opponent's Pokémon in play that have any damage counters on them have no
    // Abilities, except for Pokémon ex." Entei is a damaged non-ex Basic, so ONE
    // board switches the aura off with a `damage` field and leaves everything else
    // identical — which is the sharpest test this slice can write, because the two
    // halves of one number are being asked the same question and must answer
    // differently. The stamp is an attack INSTALLATION on a record; no Ability-lock
    // can reach it. The aura IS an Ability.
    const armed = withDebuff(board("sv02-127", "sv03-030"), "p1", 20);
    const locked = withDamage(armed, "p2", 10);

    const enteiUid = activeUid(locked, "p2");
    expect(disabledAbilityUids(armed).has(enteiUid)).toBe(false); // undamaged: free
    expect(disabledAbilityUids(locked).has(enteiUid)).toBe(true); // damaged: silenced

    // The scan itself, before any damage is dealt.
    const attacker = locked.players.p1.active;
    if (attacker === null) throw new Error("board");
    expect(opposingAttackDebuff(locked, attacker)).toBe(0);

    // …and driven end to end: 150 − 20 (stamp only), where the unlocked board took
    // 40 off. The stamp survives the very lock that killed the aura.
    const { events } = swing(locked, "sv02-127");
    const row = find(events, "DAMAGE_DEALT");
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.debuff).toBe(20);
    expect(row.dealt).toBe(130);
  });

  it("the lock is the ONLY difference — the same board with no stamp reads 0", () => {
    // The control that stops the case above passing for the wrong reason: with the
    // stamp removed, a locked Entei takes the FULL 150 and the row reports no
    // debuff at all.
    const locked = withDamage(board("sv02-127", "sv03-030"), "p2", 10);
    const { events } = swing(locked, "sv02-127");
    const row = find(events, "DAMAGE_DEALT");
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.debuff).toBeUndefined();
    expect(row.dealt).toBe(150);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Voice.
// ─────────────────────────────────────────────────────────────────────────────

describe("the log — rendered and READ, not copied", () => {
  it("renders the aura's crumb under the DAMAGED seat's row, and it is honest", () => {
    // ⚠️ D149's VOICE QUESTION, ASKED AGAIN RATHER THAN INHERITED. This slice emits
    // NO new event — the number lands in `DAMAGE_DEALT.debuff`, whose crumb
    // ("· weakened −N") already existed. But that row is emitted under the seat that
    // OWNS THE DAMAGED POKÉMON (D136's finding 1), which is Entei's own seat, and
    // D149's row wording ("during your opponent's next turn") would have been false
    // there. The crumb this slice reuses says nothing about a duration or an owner —
    // it states a subtraction — so it is honest under BOTH seats, and THAT is why no
    // wording moved. Read, not assumed.
    const { state, events } = swing(board("sv02-062", "sv03-030"), "sv02-062");
    const ctx: LogContext = { names: { p1: "Ember", p2: "Wren" }, state, elapsed: "+00:07" };
    const rendered = logFromEvents(events, ctx)
      .flatMap((entry) =>
        entry.kind === "turn" ? [] : [`${entry.who}: ${entry.segments.map((s) => s.text).join("")}`],
      )
      .join("\n");
    expect(rendered).toContain("weakened −20");
    // The row is the victim's, and the victim is the aura's own holder — a wording
    // that named a turn or an installer would be wrong here.
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.seat).toBe("p2");
  });
});
