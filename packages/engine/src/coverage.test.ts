import { describe, expect, it } from "vitest";
import { applyAction, programFor } from "./index";
import type { GameState } from "./index";
import {
  COVERAGE_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
} from "./testFixtures";

/** Setup then open P1's turn 2 (P2 went first and passed) — P1 goes second, so
    turn 2 is their first unrestricted turn (Supporters play, attacks are legal). */
function covBoard(seed: number): GameState {
  const state = driveSetup(seed, { p1: COVERAGE_DECK, p2: COVERAGE_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

const bite = { type: "attack", seat: "p1", index: 0 } as const; // fix-attacker Bite [C] 30

describe("M5 coverage pass #1 — the 5 existing-op cards", () => {
  it("registry resolves a program for each authored id", () => {
    for (const id of ["sv01-185", "sv01-187", "sv01-180", "sv02-150", "sv01-121"]) {
      expect(programFor(id)).toBeDefined();
    }
  });

  it("Nemona (Supporter) draws 3 cards", () => {
    let state = covBoard(1);
    state = handFromDeck(state, "p1", "sv01-180", 1);
    const uid = handUid(state, "p1", "sv01-180");
    const handBefore = state.players.p1.hand.length;
    const { state: after, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    const drawn = findEvent(events, "CARDS_DRAWN");
    expect(drawn).toMatchObject({ seat: "p1", reason: "effect" });
    expect(drawn?.uids).toHaveLength(3);
    // Nemona left hand (−1) then drew 3 → net +2.
    expect(after.players.p1.hand.length).toBe(handBefore - 1 + 3);
  });

  it("Poké Ball: heads parks on a Pokémon search; tails does nothing (NO shuffle)", () => {
    let sawHeads = false;
    let sawTails = false;
    for (let seed = 0; seed < 24 && !(sawHeads && sawTails); seed++) {
      let state = covBoard(seed);
      state = handFromDeck(state, "p1", "sv01-185", 1);
      const uid = handUid(state, "p1", "sv01-185");
      const { state: after, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
      const flip = findEvent(events, "ATTACK_EFFECT_COIN_FLIP");
      if (flip === undefined) throw new Error("Poké Ball did not flip");
      if (flip.result === "heads") {
        sawHeads = true;
        // The deck holds Pokémon → the search parks (an "up to 1" choice).
        expect(after.phase.kind).toBe("effect:choose");
        if (after.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
        expect(after.phase.prompt.kind).toBe("chooseCards");
      } else {
        sawTails = true;
        // Tails does NOTHING — and critically NO shuffle: the shuffleDeck sits
        // INSIDE the coin-flip gate, so a tails play cannot reorder the deck.
        expect(after.phase.kind).toBe("turn:action");
        expect(types(events)).not.toContain("DECK_SEARCHED");
        expect(types(events)).not.toContain("SHUFFLE");
        expect(types(events)).not.toContain("EFFECT_PENDING");
      }
    }
    expect(sawHeads && sawTails).toBe(true);
  });

  it("Pokémon Catcher: heads gusts an opponent Benched Pokémon; tails does nothing", () => {
    let sawHeads = false;
    let sawTails = false;
    for (let seed = 0; seed < 24 && !(sawHeads && sawTails); seed++) {
      let state = covBoard(seed);
      state = benchFromDeck(state, "p2", "fix-basic-1"); // one opp Bench → forced gust (no park)
      state = handFromDeck(state, "p1", "sv01-187", 1);
      const uid = handUid(state, "p1", "sv01-187");
      const oppActiveBefore = activeUid(state, "p2");
      const oppBench0 = benchTopUid(state, "p2", 0);
      const { state: after, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
      const flip = findEvent(events, "ATTACK_EFFECT_COIN_FLIP");
      if (flip === undefined) throw new Error("Pokémon Catcher did not flip");
      if (flip.result === "heads") {
        sawHeads = true;
        expect(types(events)).toContain("POKEMON_SWITCHED");
        expect(activeUid(after, "p2")).toBe(oppBench0); // the benched one is now Active
      } else {
        sawTails = true;
        expect(types(events)).not.toContain("POKEMON_SWITCHED");
        expect(activeUid(after, "p2")).toBe(oppActiveBefore); // unchanged
      }
    }
    expect(sawHeads && sawTails).toBe(true);
  });

  it("Pokémon Catcher into an EMPTY opponent Bench is rejected, but Poké Ball is not", () => {
    let state = covBoard(1);
    expect(state.players.p2.bench).toHaveLength(0);
    state = handFromDeck(state, "p1", "sv01-187", 1);
    const catcher = handUid(state, "p1", "sv01-187");
    const rejected = applyAction(state, { type: "playTrainer", seat: "p1", uid: catcher });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe("NO_LEGAL_TARGET");
    // …whereas a DECK is not public knowledge, so "this search will find nothing"
    // is never a fact the state establishes — searchDeck stays "playable enough"
    // and Poké Ball is legal no matter what the deck holds.
    const withBall = handFromDeck(state, "p1", "sv01-185", 1);
    const ball = handUid(withBall, "p1", "sv01-185");
    expect(applyAction(withBall, { type: "playTrainer", seat: "p1", uid: ball }).ok).toBe(true);
  });

  it("Copperajah ex's Bronze Body reduces attack damage by 30 (after W/R)", () => {
    let state = covBoard(2);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = attachFromDeck(state, "p1", "fix-energy", 1); // pays Bite [C]
    state = setActiveFromDeck(state, "p2", "sv02-150"); // Copperajah ex Active (280 HP)
    const { state: after, events } = mustApply(state, bite);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 30, reduction: 30, dealt: 0 });
    expect(after.players.p2.active?.damage).toBe(0); // 30 − 30, floored
  });

  it("Stonjourner's Exoskeleton reduces attack damage by 20 (after W/R)", () => {
    let state = covBoard(3);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = setActiveFromDeck(state, "p2", "sv01-121"); // Stonjourner Active (140 HP)
    const { state: after, events } = mustApply(state, bite);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 30, reduction: 20, dealt: 10 });
    expect(after.players.p2.active?.damage).toBe(10); // 30 − 20
  });

  it("never mutates the input state (frozen board survives a coin-gated play)", () => {
    let state = covBoard(4);
    state = handFromDeck(state, "p1", "sv01-185", 1);
    const uid = handUid(state, "p1", "sv01-185");
    expect(() =>
      applyAction(deepFreeze(state), { type: "playTrainer", seat: "p1", uid }),
    ).not.toThrow();
  });
});
