import { describe, expect, it } from "vitest";
import { boardViolations } from "./fixtures/fuzz";
import type { GameState, InPlayPokemon } from "./index";
import { MIXED_DECK, driveSetup, must, patchSide } from "./testFixtures";
import { applyAction } from "./index";

/** p2's turn 2 of a fresh game: both Active Spots filled, nothing queued, nothing lethal. */
function settled(): GameState {
  const state = driveSetup(7, { p1: MIXED_DECK, p2: MIXED_DECK }, { first: "p1" });
  return must(applyAction(state, { type: "endTurn", seat: "p1" }));
}

describe("the fuzz's board rules include the settled turn:action invariants (COR-P0E)", () => {
  it("a settled turn:action board breaks nothing", () => {
    const state = settled();
    expect(state.phase.kind).toBe("turn:action");
    expect(boardViolations(state, state)).toEqual([]);
  });

  it("flags a lethally damaged body left in play at turn:action, on either board", () => {
    const state = settled();
    for (const seat of ["p1", "p2"] as const) {
      const active = state.players[seat].active as InPlayPokemon;
      const lethal = patchSide(state, seat, { active: { ...active, damage: 990 } });
      expect(boardViolations(state, lethal), seat).toEqual([
        `turn:action with a lethally damaged ${seat} body`,
      ]);
    }
  });

  it("flags queued stages, an empty Active Spot and a win already met at turn:action", () => {
    const state = settled();
    const queued: GameState = { ...state, pending: [{ kind: "promote", seat: "p1" }] };
    expect(boardViolations(state, queued)).toEqual(["turn:action with stages queued: promote"]);
    const emptied = patchSide(state, "p1", { active: null, bench: [] });
    expect(boardViolations(state, emptied)).toEqual([
      "turn:action with p1's Active Spot empty",
      'turn:action while a win holds: {"result":"win","winner":"p2","reason":"noPokemon"}',
    ]);
  });
});
