import { describe, expect, it } from "vitest";
import { programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  SCORCHING_ARMOR_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
} from "./testFixtures";

// 0.49.0 → 0.50.0 — the `onDamagedByAttack` reactive-TRIGGER row (P3-M5, D99):
// Armarouge sv03-044 "Scorching Armor" — "If this Pokémon is in the Active Spot
// and is damaged by an attack from your opponent's Pokémon (even if this Pokémon
// is Knocked Out), the Attacking Pokémon is now Burned."
//
// The general trigger the D98 `damageAttacker` PASSIVE deliberately did NOT
// build: this one runs an EffectOp program (`applyStatus`) reactively, so it is a
// `TriggeredAbility` on a new `TriggerTiming` `onDamagedByAttack`, scanned at the
// SAME attack.ts spot as the recoil — right after DAMAGE_DEALT, gated on
// `dealt > 0`, main-hit Active only, BEFORE finishAttack's §8.1 sweep. So "even
// if Knocked Out" is free (a lethally-damaged Armarouge still Burns the attacker)
// and the "in the Active Spot" clause is enforced by the read site. The program
// runs under the DAMAGED Pokémon's seat, so `applyStatus target:"defender"` lands
// the Burn on the ATTACKER's Active (otherSeat).

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
    { p1: SCORCHING_ARMOR_DECK, p2: SCORCHING_ARMOR_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields fix-attacker with one {C} attached (pays Bite); P2 fields Armarouge.
    setActiveFromDeck displaces each setup Active (fix-bigbody) to the bench, so a
    KO always has a body to promote into. */
function fight(seed: number): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-attacker");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  return setActiveFromDeck(state, "p2", "sv03-044");
}

describe("Scorching Armor — the REGISTRY trigger (onDamagedByAttack)", () => {
  it("authors Armarouge (sv03-044) as an active-only onDamagedByAttack trigger", () => {
    expect(programFor("sv03-044")?.triggered).toEqual([
      {
        name: "Scorching Armor",
        trigger: "onDamagedByAttack",
        activeOnly: true,
        program: [{ op: "applyStatus", target: "defender", status: "burned" }],
      },
    ]);
  });
});

describe("Scorching Armor — Burn the attacker when damaged (§9)", () => {
  it("Bite deals 30, and the Attacking Pokémon is now Burned", () => {
    const state = fight(1);
    deepFreeze(state);

    const { events } = mustApply(state, bite);

    // The main hit first: 30 to Armarouge (120 HP — survives, no KO), Colorless
    // Bite so no Weakness engaged.
    const damage = find(events, "DAMAGE_DEALT");
    expect(damage).toMatchObject({ seat: "p2", dealt: 30, damage: 30 });

    // …then the trigger fires on the DAMAGED defender (P2, Armarouge)…
    expect(find(events, "ABILITY_TRIGGERED")).toMatchObject({
      seat: "p2",
      ability: "Scorching Armor",
    });
    // …Burning the ATTACKER's Active (P1) — otherSeat of the program's seat.
    expect(find(events, "STATUS_APPLIED")).toMatchObject({ seat: "p1", status: "burned" });

    // Order: DAMAGE_DEALT → ABILITY_TRIGGERED → STATUS_APPLIED, the reaction
    // folded immediately behind the damage it reacts to.
    const order = types(events);
    expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("ABILITY_TRIGGERED"));
    expect(order.indexOf("ABILITY_TRIGGERED")).toBeLessThan(order.indexOf("STATUS_APPLIED"));
  });
});

describe("Scorching Armor — 'even if this Pokémon is Knocked Out'", () => {
  it("Burns the attacker even when the attack KOs Armarouge", () => {
    // Armarouge pre-damaged to 100; Bite's 30 is lethal (130 ≥ 120): the Burn
    // must STILL land, because the trigger fires before finishAttack's §8.1 sweep.
    // The apply pauses at prize selection (before the Checkup), so the attacker's
    // burned flag is still set in `done`.
    let state = fight(2);
    state = setDamage(state, "p2", 100);
    const armarouge = state.players.p2.active?.stack.at(-1) ?? "";
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    // The trigger fired and Burned the attacker…
    expect(find(events, "ABILITY_TRIGGERED")).toMatchObject({ ability: "Scorching Armor" });
    expect(find(events, "STATUS_APPLIED")).toMatchObject({ seat: "p1", status: "burned" });
    expect(done.players.p1.active?.conditions.burned).toBe(true); // pre-Checkup, still set
    // …and Armarouge was Knocked Out all the same (the Burn landed before it).
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: armarouge });
    const order = types(events);
    expect(order.indexOf("STATUS_APPLIED")).toBeLessThan(order.indexOf("KNOCKED_OUT"));
    // A plain body — P1 takes its 1 Prize.
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });
});

describe("Scorching Armor — the read-site gate (only when actually damaged)", () => {
  it("does NOT Burn the attacker on a 0-damage attack (Yawn — a status)", () => {
    // "damaged by an attack" means damage was dealt. Yawn puts the defender to
    // Asleep and deals nothing, so the damage block never runs and the trigger
    // never fires — the attacker stays un-Burned.
    const state = fight(3);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, yawn);

    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(
      events.find((e) => e.type === "ABILITY_TRIGGERED" && e.ability === "Scorching Armor"),
    ).toBeUndefined();
    expect(done.players.p1.active?.conditions.burned).toBeFalsy();
    // Yawn DID resolve — the defender (P2) is the one that got a status (Asleep).
    expect(find(events, "STATUS_APPLIED")).toMatchObject({ seat: "p2" });
  });
});
