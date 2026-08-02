import { describe, expect, it } from "vitest";
import { programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  ROCKY_HELMET_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
} from "./testFixtures";

// 0.56.0 → 0.57.0 — Rocky Helmet sv01-193 (P3-M5 long tail, D106): "If the
// Pokémon this card is attached to is in the Active Spot and is damaged by an
// attack from your opponent's Pokémon (even if it is Knocked Out), put 2 damage
// counters on the Attacking Pokémon." (Tool)
//
// This is the Tool twin of Counterattack Quills — it rides D98's `damageAttacker`
// passive machinery VERBATIM: `passivesOf` already folds an attached Tool's
// `damageAttacker` into its seat-free sum, and attack.ts places the counters on
// the main-hit Active defender's attacker BEFORE finishAttack's §8.1 sweep. So it
// is a pure DATA ROW — no new op. The Rocky-Helmet-specific fact is that the
// recoil is granted by the TOOL, not the body: a bare fix-bigbody never
// retaliates, and bolting Rocky Helmet onto it turns 20 HP back onto the attacker.

const bite = { type: "attack", seat: "p1", index: 0 } as const; // Bite — {C}, 30, no effect
const yawn = { type: "attack", seat: "p1", index: 2 } as const; // Yawn — no damage, a status

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function attackerDamage(state: GameState): number | undefined {
  return state.players.p1.active?.damage;
}

/** Setup, then let P2 (who went first) field a plain body and bolt Rocky Helmet
    onto it, hand the turn to P1, and field the attacker with one {C} attached. */
function equip(seed: number): GameState {
  let state = driveSetup(seed, { p1: ROCKY_HELMET_DECK, p2: ROCKY_HELMET_DECK }, { first: "p2" });
  // P2's turn — plant a plain 200 HP body and attach Rocky Helmet to it.
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = handFromDeck(state, "p2", "sv01-193", 1);
  const helmet = handUid(state, "p2", "sv01-193");
  state = mustApply(state, {
    type: "attachTool",
    seat: "p2",
    uid: helmet,
    target: { spot: "active" },
  }).state;
  expect(state.players.p2.active?.tools).toEqual([helmet]);
  // Hand the turn to P1 and field the attacker.
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-attacker");
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** The same board with a BARE holder — no Rocky Helmet — to prove the recoil is
    the Tool's, not the body's. */
function bare(seed: number): GameState {
  let state = driveSetup(seed, { p1: ROCKY_HELMET_DECK, p2: ROCKY_HELMET_DECK }, { first: "p2" });
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-attacker");
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

describe("Rocky Helmet — the registry data row (D98 damageAttacker on a Tool)", () => {
  it("authors sv01-193 as a 20 HP (2-counter) damageAttacker passive, no requiresTool", () => {
    // 2 damage counters = 20 HP; unconditional once attached — the Tool IS the
    // source, so (unlike Custom Trap) no `requiresTool` gate.
    expect(programFor("sv01-193")?.passive).toEqual({ damageAttacker: { amount: 20 } });
  });
});

describe("Rocky Helmet — 2 counters on the attacker when the holder is damaged", () => {
  it("Bite deals 30, and 20 recoil lands on the attacker, right behind the hit", () => {
    const state = equip(1);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    // The main hit: 30 to the holder (200 HP fix-bigbody — survives, no W/R).
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 30, damage: 30 });
    expect(done.players.p2.active?.damage).toBe(30);

    // …then the Tool's recoil: 20 flat counters on the ATTACKER, labelled by the
    // MECHANISM. ⚠️ THIS LINE ASSERTED `source: "ability"` UNTIL 0.90.0, on a card
    // that is a TOOL — the suite pinning the defect as intended, for the third time
    // in this family (D136's two, then this). It is POSITIVE about the new intent
    // now: a Tool's recoil is not an Ability, and `counterattack.test.ts` owns the
    // general form of the claim over the whole pool.
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p1",
      amount: 20,
      source: "counterattack",
    });
    expect(attackerDamage(done)).toBe(20); // 120 HP attacker — survives

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
});

describe("Rocky Helmet — the recoil is the TOOL's, not the body's", () => {
  it("a BARE holder (no Rocky Helmet) does NOT retaliate", () => {
    // fix-bigbody carries no passive of its own; without the Tool, Bite deals its
    // 30 and nothing comes back — the recoil is granted solely by Rocky Helmet.
    const state = bare(2);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 30 });
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(attackerDamage(done)).toBe(0);
  });
});

describe("Rocky Helmet — 'even if it is Knocked Out'", () => {
  it("retaliates even when the attack KOs the holder", () => {
    // The holder pre-damaged to 180; Bite's 30 is lethal (210 ≥ 200): the recoil
    // must STILL land, because it is folded before finishAttack's §8.1 sweep.
    let state = equip(3);
    const holder = state.players.p2.active?.stack.at(-1) ?? "";
    state = setDamage(state, "p2", 180);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    // The recoil landed…
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ seat: "p1", amount: 20 });
    expect(attackerDamage(done)).toBe(20);
    // …and the holder was Knocked Out all the same (COUNTERS_PLACED before it).
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: holder });
    const order = types(events);
    expect(order.indexOf("COUNTERS_PLACED")).toBeLessThan(order.indexOf("KNOCKED_OUT"));
    // A plain body — P1 takes its 1 Prize.
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });
});

describe("Rocky Helmet — the read-site gate (only when actually damaged)", () => {
  it("does NOT retaliate on a 0-damage attack (Yawn — a status, no counters)", () => {
    // "damaged by an attack" means damage was dealt. Yawn puts the holder to sleep
    // and deals nothing, so the damage block never runs and no recoil fires.
    const state = equip(4);
    deepFreeze(state);

    const { events } = mustApply(state, yawn);

    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(find(events, "STATUS_APPLIED")).toBeDefined(); // Yawn DID resolve (Asleep)
  });
});
