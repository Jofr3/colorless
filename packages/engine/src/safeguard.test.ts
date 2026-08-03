import { describe, expect, it } from "vitest";
import { programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  SAFEGUARD_DECK,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.57.0 → 0.58.0 — Mimikyu sv02-097 (P3-M5 long tail, D107): "Prevent all damage
// done to this Pokémon by attacks from your opponent's Pokémon ex and Pokémon V."
//
// The defender-side twin of `damageReductionAfterWR` (Bouffer) — a FULL null
// instead of a flat subtraction — but the prevention is GATED on the ATTACKER's
// rule-box class (`isExOrV`: ex or V, NOT VMAX/VSTAR/GX), which is known only at
// the damage read sites. It rides `passivesOf` like the reduction and is honored
// at all four attack-damage sites (main hit + spread + both snipe arms), because
// Safeguard has no "in the Active Spot" clause. sv02-097 is the only ex/V-gated
// total-prevention print in the sv01–03 pool.
//
// ⚠️ D159 — THE "SEPARATE FAMILY" THIS BLOCK USED TO POINT AT HAS LANDED, and the
// claim is re-pointed rather than deleted: the type-gated Dachsbun sv01-099 /
// Bellibolt sv03-078/-201 "prevent all damage from {R}/{L}" are now
// `PassiveEffects.preventDamageFromType`, a SIBLING field of the flag this suite
// drives rather than a widening of it (`attackerFilter.test.ts` says why, and the
// two are read side by side on the same `||` at all four sites). What stays true
// here is the SCOPE of this file's own claim — sv02-097 is the only printing whose
// gate is the RULE BOX — and the counting note worth carrying: §D146's census puts
// six always-on printings in this neighbourhood and THIS ONE IS THE SIXTH, which is
// why every remainder list's "6 printings" priced five cards' worth of work.

const bite = { type: "attack", seat: "p1", index: 0 } as const; // Bite — {C}, 30, no effect
const exSpread = { type: "attack", seat: "p1", index: 1 } as const; // fix-attacker-ex Spread Shot
const sniperSpread = { type: "attack", seat: "p1", index: 0 } as const; // fix-sniper Spread Shot

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Setup, then field the Mimikyu defender in P2's ACTIVE spot and hand the turn
    to P1, who fields `attackerId` with one {C} attached (main-hit path). */
function fightMain(seed: number, attackerId: string): GameState {
  let state = driveSetup(seed, { p1: SAFEGUARD_DECK, p2: SAFEGUARD_DECK }, { first: "p2" });
  state = setActiveFromDeck(state, "p2", "sv02-097");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attackerId);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** The spread path: P2's Active is a plain 200 HP body, the Mimikyu sits on the
    BENCH (where Safeguard still protects it — no Active-Spot clause). Setup also
    auto-benches the dominant fix-bigbody, so Mimikyu is not necessarily bench[0]:
    find it by card id. */
function fightSpread(seed: number, attackerId: string): GameState {
  let state = driveSetup(seed, { p1: SAFEGUARD_DECK, p2: SAFEGUARD_DECK }, { first: "p2" });
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = benchFromDeck(state, "p2", "sv02-097");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attackerId);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** The benched Mimikyu's InPlayPokemon (found by card id, not bench slot). */
function benchedMimikyu(state: GameState) {
  return state.players.p2.bench.find((p) => state.cardIdByUid[p.stack.at(-1) ?? ""] === "sv02-097");
}

describe("Safeguard — the registry data row (preventDamageFromExV)", () => {
  it("authors sv02-097 as a bare preventDamageFromExV passive", () => {
    expect(programFor("sv02-097")?.passive).toEqual({ preventDamageFromExV: true });
  });
});

describe("Safeguard — the main hit prevents an ex/V attacker's damage", () => {
  it("an ex attacker's Bite is fully prevented — 0 damage, flagged prevented", () => {
    const state = fightMain(1, "fix-attacker-ex");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    // Bite would be a flat 30 (Mimikyu is Metal-weak, not Fire-weak), but the ex
    // gate nulls it to 0 and the event marks WHY it is 0.
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 0, prevented: true });
    expect(done.players.p2.active?.damage).toBe(0);
  });

  it("a V attacker's Bite is fully prevented too", () => {
    const state = fightMain(2, "fix-attacker-v");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(done.players.p2.active?.damage).toBe(0);
  });
});

describe("Safeguard — the ex/V gate does NOT fire on other attackers", () => {
  it("a plain (non-rule-box) attacker deals its full damage", () => {
    const state = fightMain(3, "fix-attacker");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    const hit = find(events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ seat: "p2", dealt: 30 });
    expect(hit?.prevented).toBeUndefined();
    expect(done.players.p2.active?.damage).toBe(30);
  });

  it("a VMAX attacker deals full damage — the gate is ex/V-specific, not any rule box", () => {
    // `isExOrV` reads the suffix literally: "Fixmon VMAX" ends in "VMAX", not
    // " V", so Safeguard (which names only ex and V) must NOT prevent it.
    const state = fightMain(4, "fix-attacker-vmax");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    const hit = find(events, "DAMAGE_DEALT");
    expect(hit).toMatchObject({ dealt: 30 });
    expect(hit?.prevented).toBeUndefined();
    expect(done.players.p2.active?.damage).toBe(30);
  });
});

describe("Safeguard — protection reaches the BENCH (no Active-Spot clause)", () => {
  it("an ex attacker's spread is prevented on a benched Mimikyu", () => {
    const state = fightSpread(5, "fix-attacker-ex");
    const mimikyuUid = benchedMimikyu(state)?.stack.at(-1);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, exSpread);

    // The Active (fix-bigbody) still eats Spread Shot's 30…
    expect(done.players.p2.active?.damage).toBe(30);
    // …but the benched Mimikyu's 20 spread is prevented to 0 (ex attacker).
    const benchHit = events.find(
      (e) => e.type === "DAMAGE_DEALT" && e.uid === mimikyuUid,
    ) as Extract<GameEvent, { type: "DAMAGE_DEALT" }> | undefined;
    expect(benchHit).toMatchObject({ seat: "p2", dealt: 0, prevented: true });
    expect(benchedMimikyu(done)?.damage).toBe(0);
  });

  it("a plain spread attacker still hits the benched Mimikyu for full", () => {
    const state = fightSpread(6, "fix-sniper");
    const mimikyuUid = benchedMimikyu(state)?.stack.at(-1);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, sniperSpread);

    const benchHit = events.find(
      (e) => e.type === "DAMAGE_DEALT" && e.uid === mimikyuUid,
    ) as Extract<GameEvent, { type: "DAMAGE_DEALT" }> | undefined;
    expect(benchHit).toMatchObject({ dealt: 20 });
    expect(benchHit?.prevented).toBeUndefined();
    expect(benchedMimikyu(done)?.damage).toBe(20);
  });
});
