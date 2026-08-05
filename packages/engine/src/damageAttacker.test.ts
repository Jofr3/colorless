import { describe, expect, it } from "vitest";
import { programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  DAMAGE_ATTACKER_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  handUid,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
} from "./testFixtures";

// 0.48.0 → 0.49.0 — the `damageAttacker` reactive-recoil row (P3-M5, D98):
// "If this Pokémon is in the Active Spot and is damaged by an attack from your
// opponent's Pokémon (even if this Pokémon is Knocked Out), put N damage counters
// on the Attacking Pokémon." — Cacnea/Cacturne "Counterattack Quills" (30) and
// Stunfisk "Custom Trap" (50, only while a Pokémon Tool is attached).
//
// Modelled as a defender-side PASSIVE (the shape of damageReductionAfterWR),
// NOT a new op or trigger: attack.ts folds it in right after DAMAGE_DEALT,
// placing flat counters (outside the §8.5 W/R pipeline) on the Attacking Pokémon
// when `dealt > 0`, BEFORE finishAttack's both-board §8.1 sweep. So "even if
// Knocked Out" is free, and a lethal retaliation KOs the attacker, prized to the
// defender. The "in the Active Spot" clause is enforced by the read site — only
// the main-hit Active defender retaliates.

const bite = { type: "attack", seat: "p1", index: 0 } as const; // Bite — {C}, 30, no effect
const yawn = { type: "attack", seat: "p1", index: 2 } as const; // Yawn — no damage, a status

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Setup then open P1's turn (P2 went first and passed) — P1 is the attacker. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: DAMAGE_ATTACKER_DECK, p2: DAMAGE_ATTACKER_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields fix-attacker with one {C} attached (pays Bite); P2 fields `defender`.
    setActiveFromDeck displaces each setup Active (fix-bigbody) to the bench, so a
    KO always has a body to promote into. */
function fight(seed: number, defender: string): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-attacker");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  return setActiveFromDeck(state, "p2", defender);
}

function attackerDamage(state: GameState): number | undefined {
  return state.players.p1.active?.damage;
}

describe("damageAttacker — the REGISTRY passive (Counterattack Quills / Custom Trap)", () => {
  it("authors Cacnea, Cacturne and Stunfisk with the right amounts + Tool gate", () => {
    // Cacnea and Cacturne share the byte-identical Counterattack Quills program.
    expect(programFor("sv01-005")?.passive).toEqual({ damageAttacker: { amount: 30 } });
    expect(programFor("sv01-006")?.passive).toEqual({ damageAttacker: { amount: 30 } });
    // Stunfisk's Custom Trap is the requiresTool variant, 50.
    expect(programFor("sv03-112")?.passive).toEqual({
      damageAttacker: { amount: 50, requiresTool: true },
    });
  });
});

describe("Counterattack Quills — 3 counters on the attacker when damaged (§9)", () => {
  it("Cacnea (sv01-005): Bite deals 30, and 30 recoil lands on the attacker", () => {
    const state = fight(1, "sv01-005");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    // The main hit first: 30 to Cacnea, no W/R (fixture has no weakness).
    const damage = find(events, "DAMAGE_DEALT");
    expect(damage).toMatchObject({ seat: "p2", dealt: 30, damage: 30 });
    expect(done.players.p2.active?.damage).toBe(30); // 60 HP — survives, no KO

    // …then the recoil: 30 flat counters on the ATTACKER (this seat's Active),
    // emitted RIGHT after the hit as a COUNTERS_PLACED labelled by the MECHANISM.
    // ⚠️ `source` was `"ability"` here until 0.90.0 — true of Counterattack Quills
    // and false of the Tool that shares this exact code path (D141). The label is
    // the same for BOTH now, which is the whole point: the read site sums them.
    const recoil = find(events, "COUNTERS_PLACED");
    expect(recoil).toMatchObject({ seat: "p1", amount: 30, source: "counterattack" });
    expect(attackerDamage(done)).toBe(30); // 120 HP attacker — survives

    // Order: the retaliation is folded immediately behind the damage it reacts to.
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "COUNTERS_PLACED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED"); // Bite has no effect text
  });

  it("Cacturne (sv01-006): the same 30 recoil off the shared program", () => {
    const { state: done, events } = mustApply(fight(2, "sv01-006"), bite);
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ seat: "p1", amount: 30 });
    expect(attackerDamage(done)).toBe(30);
  });
});

describe("Counterattack Quills — 'even if this Pokémon is Knocked Out'", () => {
  it("retaliates even when the attack KOs the defender", () => {
    // Cacnea pre-damaged to 40, Bite's 30 is lethal (70 ≥ 60): the recoil must
    // STILL land, because it is folded before finishAttack's §8.1 sweep.
    let state = fight(3, "sv01-005");
    state = setDamage(state, "p2", 40);
    const cacnea = state.players.p2.active?.stack.at(-1) ?? "";
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    // The recoil landed…
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ seat: "p1", amount: 30 });
    expect(attackerDamage(done)).toBe(30);
    // …and the defender was Knocked Out all the same (COUNTERS_PLACED before it).
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: cacnea });
    const order = types(events);
    expect(order.indexOf("COUNTERS_PLACED")).toBeLessThan(order.indexOf("KNOCKED_OUT"));
    // A plain body — P1 takes its 1 Prize.
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });

  it("a lethal retaliation Knocks Out the ATTACKER, prized to the defender", () => {
    // The attacker pre-damaged to 100; the 30 recoil is lethal (130 ≥ 120).
    // Because it runs before the both-board sweep, the attacker is Knocked Out
    // and the Prize goes to P2 — the defender's side, mid-P1's-turn.
    let state = fight(4, "sv01-005");
    state = setDamage(state, "p1", 100);
    const attacker = state.players.p1.active?.stack.at(-1) ?? "";
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ seat: "p1", amount: 30 });
    const ko = find(events, "KNOCKED_OUT");
    expect(ko).toMatchObject({ seat: "p1", uid: attacker }); // the attacker itself
    expect(done.players.p2.active?.damage).toBe(30); // Cacnea (60 HP) survived the 30
    // The KO'd side is P1, so its opponent P2 takes the Prize (§8.1).
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p2", count: 1 });
  });
});

describe("damageAttacker — the read-site gate (only when actually damaged / Active)", () => {
  it("does NOT retaliate on a 0-damage attack (Yawn — a status, no counters)", () => {
    // "damaged by an attack" means damage was dealt. Yawn puts the defender to
    // Asleep and deals nothing, so the damage block never runs and no recoil fires.
    const state = fight(5, "sv01-005");
    deepFreeze(state);

    const { events } = mustApply(state, yawn);

    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(find(events, "STATUS_APPLIED")).toBeDefined(); // Yawn DID resolve (Asleep)
  });
});

describe("Custom Trap — Stunfisk's recoil is gated on a Pokémon Tool", () => {
  it("does NOT retaliate with no Tool attached", () => {
    // Stunfisk carries requiresTool: with a bare Stunfisk the passive contributes
    // nothing, so Bite deals its 30 and no counters come back.
    const state = fight(6, "sv03-112");
    const { state: done, events } = mustApply(state, bite);

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 30 });
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(attackerDamage(done)).toBe(0);
  });

  it("retaliates for 50 once a Tool is attached", () => {
    // Field Stunfisk on P2's turn and give it Vitality Band (an inert Tool here —
    // it never attacks), then hand the turn to P1 and Bite it.
    let state = driveSetup(
      7,
      { p1: DAMAGE_ATTACKER_DECK, p2: DAMAGE_ATTACKER_DECK },
      { first: "p2" },
    );
    state = setActiveFromDeck(state, "p2", "sv03-112");
    state = handFromDeck(state, "p2", "sv01-197", 1);
    const band = handUid(state, "p2", "sv01-197");
    state = mustApply(state, {
      type: "attachTool",
      seat: "p2",
      uid: band,
      target: { spot: "active" },
    }).state;
    expect(state.players.p2.active?.tools).toEqual([band]);
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state; // → P1's turn
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = attachFromDeck(state, "p1", "fix-energy", 1);

    const { state: done, events } = mustApply(state, bite);

    // 50 and not 70: Vitality Band is an INERT Tool here (it grants no recoil of
    // its own), so this is the gate firing rather than the D141 sum — the sum has
    // its own case in `counterattack.test.ts`, on a Tool that DOES grant one.
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p1",
      amount: 50,
      source: "counterattack",
    });
    expect(attackerDamage(done)).toBe(50); // 120 HP attacker — survives
  });
});
