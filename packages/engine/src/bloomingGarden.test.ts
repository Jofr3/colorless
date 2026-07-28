import { describe, expect, it } from "vitest";
import { disabledAbilityUids, programFor, seatRemovesWeakness } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  REMOVE_WEAKNESS_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  types,
} from "./testFixtures";

// 0.54.0 → 0.55.0 — Florges sv01-093 "Blooming Garden" (P3-M5, D104): the first
// long-tail continuous PASSIVE aura. "Your Pokémon in play have no Weakness." —
// the only "no Weakness" Ability in the sv01–03 pool (verbatim off the live D1).
//
// Modelled as a bare `PassiveEffects.removeWeakness` flag (own board,
// unconditional, NO "in the Active Spot" clause) read through the new
// `seatRemovesWeakness(state, seat)` — the own-board twin of `disabledAbilityUids`.
// The two Weakness read sites null the DEFENDER's Weakness before the §8.5
// pipeline (Resistance is untouched): attack.ts's main hit and interpreter.ts's
// snipeActive (Chien-Pao ex "Hail Blade"). Bench Pokémon never take
// Weakness-modified damage anyway, so the only observable effect is on the seat's
// Active while it defends — and the aura's source may sit on the Bench.

const bite = { type: "attack", seat: "p1", index: 0 } as const; // fix-attacker Bite — {C}, 30
const hailBlade = { type: "attack", seat: "p1", index: 0 } as const; // Chien-Pao ex — the parked discard

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Setup then open P1's turn (P2 went first and passed — so P1's first turn
    carries no §4 attack ban). ASSERTS both seats opened on the neutral,
    mulligan-free fix-bigbody: Ting-Lu ex is a Basic ex that could otherwise open
    Active and smuggle a live Cursed Land lock onto the board, and a fix-weak /
    fix-water-weak opener would pre-place a defender — either would quietly poison
    the assertions below. Every seed used here was picked against this gate. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: REMOVE_WEAKNESS_DECK, p2: REMOVE_WEAKNESS_DECK },
    { first: "p2" },
  );
  for (const seat of ["p1", "p2"] as const) {
    const opened = state.cardIdByUid[activeUid(state, seat)];
    if (opened !== "fix-bigbody") {
      throw new Error(`seed ${seed}: ${seat} opened on ${opened}, not the neutral fix-bigbody`);
    }
  }
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1's Fire fix-attacker (one {C} paid) across from P2's fix-weak (60 HP, ×2
    Fire) — the plain §8.5 main-hit matchup. Both bodies are surgeried in from the
    deck, so the opener stays the neutral fix-bigbody. */
function fireMatchup(seed: number): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-attacker");
  state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
  return setActiveFromDeck(state, "p2", "fix-weak");
}

/** P1's Chien-Pao ex (Water, two {W} attached) across from P2's fix-water-weak
    (200 HP, ×2 Water) — Hail Blade's `damageDefender` re-enters snipeActive's full
    §8.5 pipeline, so a {W} attacker doubles here. Two {W} pay the cost AND are
    discard fuel. */
function hailMatchup(seed: number): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "sv02-061");
  state = attachFromDeck(state, "p1", "fix-water-energy", 2);
  return setActiveFromDeck(state, "p2", "fix-water-weak");
}

/** Resolve Hail Blade's parked discard by picking exactly one {W} — 60 × 1 base. */
function discardOne(state: GameState): { state: GameState; events: GameEvent[] } {
  if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "discardEnergy") {
    throw new Error("expected a parked discardEnergy prompt");
  }
  const first = state.phase.prompt.discardable[0]?.uid;
  if (first === undefined) throw new Error("no discardable Energy");
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "discardEnergy", uids: [first] },
  });
}

describe("Blooming Garden — the registry row", () => {
  it("authors Florges sv01-093 as a bare removeWeakness flag, and nobody else", () => {
    expect(programFor("sv01-093")?.passive?.removeWeakness).toBe(true);
    // It is the ONLY removeWeakness print in the pool — the disableAbilities auras
    // and the plain attacker carry no such field.
    expect(programFor("sv01-096")?.passive?.removeWeakness).toBeUndefined(); // Klefki (a lock)
    expect(programFor("sv02-127")?.passive?.removeWeakness).toBeUndefined(); // Ting-Lu ex (a lock)
    expect(programFor("fix-attacker")?.passive?.removeWeakness).toBeUndefined();
  });
});

describe("Blooming Garden — the §8.5 main hit (attack.ts)", () => {
  it("with no aura, fix-weak's ×2 Fire Weakness doubles Bite to 60 (the control)", () => {
    const state = fireMatchup(1);
    deepFreeze(state);
    const { events } = mustApply(state, bite);
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(dealt?.dealt).toBe(60);
  });

  it("a Florges on the DEFENDER's Bench nulls the Weakness — Bite deals 30, no KO", () => {
    // The aura works from the Bench (no "in the Active Spot" clause) and reaches
    // the seat's Active defender: 30 instead of 60, and the 60 HP fix-weak now
    // SURVIVES — the same hit that KO'd it in the control.
    let state = fireMatchup(3);
    state = benchFromDeck(state, "p2", "sv01-093");
    deepFreeze(state);
    const { state: done, events } = mustApply(state, bite);
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt?.weakness).toBeNull();
    expect(dealt?.dealt).toBe(30);
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(done.players.p2.active?.damage).toBe(30);
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("is OWN-board only — a Florges on the ATTACKER's side does NOT shield the defender", () => {
    // "YOUR Pokémon" = the aura's own board. Florges on P1's Bench protects P1's
    // Pokémon, never P2's defender, so fix-weak's Weakness still doubles.
    let state = fireMatchup(6);
    state = benchFromDeck(state, "p1", "sv01-093");
    const { events } = mustApply(state, bite);
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(dealt?.dealt).toBe(60);
  });
});

describe("Blooming Garden — the snipe hit (interpreter.ts snipeActive, Hail Blade)", () => {
  it("with no aura, Hail Blade doubles off fix-water-weak's ×2 Water — 60 × 2 = 120", () => {
    const { state: parked } = mustApply(hailMatchup(10), hailBlade);
    const { events } = discardOne(parked);
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(dealt?.dealt).toBe(120);
  });

  it("a Florges on the DEFENDER's Bench nulls the snipeActive Weakness — 60, not 120", () => {
    // The SECOND read site: `damageDefender` → snipeActive gates its Weakness on
    // the same aura, so the protected Active takes the un-doubled 60.
    let state = hailMatchup(19);
    state = benchFromDeck(state, "p2", "sv01-093");
    const { state: parked } = mustApply(state, hailBlade);
    const { events } = discardOne(parked);
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt?.weakness).toBeNull();
    expect(dealt?.dealt).toBe(60);
  });
});

describe("Blooming Garden — seatRemovesWeakness: detection + §9 lock gating", () => {
  it("reads true only for the seat holding the Florges (own-board), from the Bench", () => {
    let state = board(21);
    expect(seatRemovesWeakness(state, "p1")).toBe(false);
    expect(seatRemovesWeakness(state, "p2")).toBe(false);
    state = benchFromDeck(state, "p2", "sv01-093");
    expect(seatRemovesWeakness(state, "p2")).toBe(true); // the source's own board
    expect(seatRemovesWeakness(state, "p1")).toBe(false); // never the opponent's
  });

  it("a §9 lock (Ting-Lu ex 'Cursed Land') on a DAMAGED Florges switches the aura off", () => {
    // Blooming Garden IS a printed Ability, so it joins the disabledAbilityUids
    // checklist: a damaged, non-ex Florges opposite an Active Ting-Lu ex loses it.
    let state = board(24);
    state = benchFromDeck(state, "p2", "sv01-093");
    const florgesIndex = state.players.p2.bench.length - 1;
    const florges = benchTopUid(state, "p2", florgesIndex);
    state = setActiveFromDeck(state, "p1", "sv02-127"); // Ting-Lu ex Active across the table

    // UNDAMAGED: outside Cursed Land's "damaged" target set — the aura stands.
    expect(disabledAbilityUids(state).has(florges)).toBe(false);
    expect(seatRemovesWeakness(state, "p2")).toBe(true);

    // Take a counter → now locked → Blooming Garden goes dark.
    const damaged = setBenchDamage(state, "p2", florgesIndex, 20);
    expect(disabledAbilityUids(damaged).has(florges)).toBe(true);
    expect(seatRemovesWeakness(damaged, "p2")).toBe(false);
  });
});
