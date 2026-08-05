import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { GameState, PokemonRef } from "./index";
import {
  KORAIDON_DECK,
  benchFromDeck,
  deepFreeze,
  discardFromDeck,
  driveSetup,
  expectErr,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// M5 op-slice — MULTI-attach + endsTurn, authoring Koraidon ex "Dino Cry": "Once
// during your turn, you may attach up to 2 Basic {F} Energy cards from your
// discard pile to your Basic {F} Pokémon in any way you like. If you use this
// Ability, your turn ends." Two ideas:
//   • multi-attach ("up to 2 in any way") is just TWO attachEnergyFrom ops — the
//     interpreter parks on each target in turn; a second op with no {F} left
//     no-ops (so it attaches min(2, available));
//   • `AbilityProgram.endsTurn` folds the turn end (flow.ts settleProgram) once
//     the program completes — threaded across both parks.
// Targets are the controller's own Basic {F} Pokémon (targetType + basicOnly).

const ACTIVE_REF: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const DINO_CRY = { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: "Dino Cry" } as const;

/** Open P1's turn 2 with Koraidon ex as their Active and an EMPTY bench, so each
    test places exactly the {F}/non-{F} target set it needs (the sniperVs pattern
    — clearing the bench keeps the target census deterministic across seeds). */
function koraiBoard(seed: number): GameState {
  let state = driveSetup(seed, { p1: KORAIDON_DECK, p2: KORAIDON_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state; // → P1's turn 2
  state = setActiveFromDeck(state, "p1", "sv01-125"); // Koraidon ex Active (Basic {F})
  return { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
}

function benchRef(index: number): PokemonRef {
  return { seat: "p1", spot: { spot: "bench", index } };
}

describe("Koraidon ex — Dino Cry (attachEnergyFrom multi + endsTurn)", () => {
  it("attaches TWO {F} from discard across two parks, then ENDS the turn", () => {
    let state = koraiBoard(1); // Koraidon Active, empty bench
    state = benchFromDeck(state, "p1", "fix-fighting-1"); // bench[0] a second Basic {F}
    state = discardFromDeck(state, "p1", "fix-fighting-energy", 2);
    const benchIdx = 0; // fix-fighting-1

    // First attach parks (2 Basic {F} targets: Koraidon + fix-fighting-1).
    const p1 = mustApply(state, DINO_CRY).state;
    expect(p1.phase.kind).toBe("effect:choose");
    if (p1.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(p1.phase.endsTurn).toBe(true);
    expect(p1.phase.prompt.kind).toBe("choosePokemon");

    // Attach #1 → Koraidon (Active); the program re-parks for attach #2.
    const p2 = mustApply(p1, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref: ACTIVE_REF } }).state;
    expect(p2.phase.kind).toBe("effect:choose");
    if (p2.phase.kind !== "effect:choose") throw new Error("expected a second park");
    expect(p2.phase.endsTurn).toBe(true); // the flag survived the re-park

    // Attach #2 → the benched {F}; the program is done → the turn ends.
    const { state: done, events } = mustApply(p2, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: benchRef(benchIdx) },
    });
    expect(done.players.p1.active?.energy.length).toBe(1); // Koraidon
    expect(done.players.p1.bench[benchIdx]?.energy.length).toBe(1); // the benched {F}
    expect(types(events)).toContain("TURN_ENDED");
    expect(done.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
  });

  it("targets ONLY the controller's Basic {F} Pokémon (non-{F} and non-Basic {F} excluded)", () => {
    let state = koraiBoard(2); // Koraidon Active (Basic {F}), empty bench
    state = benchFromDeck(state, "p1", "fix-basic-1"); // bench[0] non-{F} — excluded by targetType
    state = benchFromDeck(state, "p1", "fix-fighting-1"); // bench[1] Basic {F} — a target
    state = benchFromDeck(state, "p1", "fix-fighting-evo"); // bench[2] Stage {F} — excluded by basicOnly
    state = discardFromDeck(state, "p1", "fix-fighting-energy", 1);
    const parked = mustApply(state, DINO_CRY).state;
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    const cands = parked.phase.prompt.candidates;
    // Koraidon (Active) + fix-fighting-1 (bench[1]) only.
    expect(cands).toHaveLength(2);
    expect(cands.some((c) => c.spot.spot === "bench" && c.spot.index === 0)).toBe(false); // non-{F}
    expect(cands.some((c) => c.spot.spot === "bench" && c.spot.index === 2)).toBe(false); // Stage {F}
  });

  it("with a single {F} in the discard, attaches 1 and STILL ends the turn", () => {
    let state = koraiBoard(3); // Koraidon is the ONLY Basic {F} (empty bench) → forced target
    state = discardFromDeck(state, "p1", "fix-fighting-energy", 1);
    // Forced first attach (1 target) → attach #1; second op finds no {F} → no-op → turn ends.
    const { state: done, events } = mustApply(state, DINO_CRY);
    expect(done.players.p1.active?.energy.length).toBe(1);
    expect(types(events)).toContain("TURN_ENDED");
    expect(done.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
  });

  it("rejects Dino Cry when the discard holds no Basic {F} Energy (can only whiff)", () => {
    const state = koraiBoard(4); // discard empty → no {F} source
    expectErr(state, DINO_CRY, "NO_LEGAL_TARGET");
  });

  it("never mutates the input state (frozen board survives a Dino Cry park)", () => {
    let state = koraiBoard(1);
    state = discardFromDeck(state, "p1", "fix-fighting-energy", 2);
    expect(() => applyAction(deepFreeze(state), DINO_CRY)).not.toThrow();
    // And the resolve step over a frozen parked board.
    const parked = mustApply(state, DINO_CRY).state;
    if (parked.phase.kind === "effect:choose") {
      expect(() =>
        applyAction(deepFreeze(parked), { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref: ACTIVE_REF } }),
      ).not.toThrow();
    }
  });
});
