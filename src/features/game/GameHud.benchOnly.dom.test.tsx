// @vitest-environment jsdom
// 🆕🆕🆕 D565 — THE THIRD READ SITE of `AbilityProgram.benchOnly` (`activeOnly`'s mirror).
//
// Misty's Psyduck `sv10-045` "Flustered Leap" prints *"Once during your turn, if this Pokémon is
// on your Bench, …"*. `useAbility` refuses an Active use with ABILITY_BENCH_ONLY and
// `redactedAbilitiesOf` greys the wire row (both driven in `abilityBundleD565.test.ts`); this
// file is the HOT-SEAT surface, which has no wire between it and the state and therefore no
// other check. Without the term the Active row would be lit and its click would be refused —
// the D222 afford-then-reject. Two copies of the card are on the board, one per spot, so the
// Active row being greyed is attributable to the SPOT and nothing else (the Bench row, same
// card, same turn, is lit).

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { GameState, Seat } from "@luminous/engine";
import { applyAction } from "@luminous/engine";
import { SOURCE_UID_DECK, battler, driveSetup, mustApply } from "../../../packages/engine/src/testFixtures";
import { makeInPlay } from "../../../packages/engine/src/types";
import { installDomShims } from "../../test/domShims";
import { GameHud } from "./GameHud";
import { projectGameState } from "./projection";

beforeAll(installDomShims);
afterEach(cleanup);

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };
const PSYDUCK = "sv10-045";

/** P1's turn, both of P1's spots re-seated with a grafted Misty's Psyduck (Active + Bench 1);
    the displaced bodies go to the bottom of the deck, so every uid stays in one zone. */
function board(): GameState {
  let state = driveSetup(20260928, { p1: SOURCE_UID_DECK, p2: SOURCE_UID_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  const side = state.players.p1;
  const returned = [side.active, ...side.bench].flatMap((p) =>
    p === null ? [] : [...p.stack, ...p.energy, ...p.tools],
  );
  const card = battler(PSYDUCK, {
    name: "Misty's Psyduck",
    types: ["Water"],
    hp: 70,
    abilities: [
      {
        type: "Ability",
        name: "Flustered Leap",
        effect:
          "Once during your turn, if this Pokémon is on your Bench, you may discard the bottom card of your deck. If you do, discard all cards from this Pokémon and put this Pokémon on top of your deck.",
      },
    ],
    attacks: [{ cost: ["Water"], name: "Sprinkle Water", damage: 30 }],
  });
  return {
    ...state,
    cardPool: { ...state.cardPool, [PSYDUCK]: card },
    cardIdByUid: { ...state.cardIdByUid, "d565-psyduck-a": PSYDUCK, "d565-psyduck-b": PSYDUCK },
    players: {
      ...state.players,
      p1: {
        ...side,
        active: makeInPlay("d565-psyduck-a", 0),
        bench: [makeInPlay("d565-psyduck-b", 0)],
        deck: [...side.deck, ...returned],
      },
    },
  };
}

function renderHud(state: GameState) {
  render(
    <GameHud
      game={state}
      projection={projectGameState(state, "p1")}
      viewerSeat="p1"
      names={NAMES}
      dispatch={() => {}}
      onPlayAgain={() => {}}
    />,
  );
}

const row = (where: string) =>
  screen.getByRole("button", { name: `Flustered Leap · Misty's Psyduck (${where})` }) as HTMLButtonElement;

describe("D565 — GameHud greys a `benchOnly` Ability off the Bench", () => {
  it("🛑 the ACTIVE row is greyed, and the engine refuses that click ABILITY_BENCH_ONLY", () => {
    const state = board();
    renderHud(state);
    expect(row("Active").disabled).toBe(true);
    const result = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Flustered Leap",
    });
    expect(result.ok === false && result.error.code).toBe("ABILITY_BENCH_ONLY");
  });

  it("…and the BENCH row — the same card, the same turn — is lit, and the engine accepts it", () => {
    const state = board();
    renderHud(state);
    expect(row("Bench 1").disabled).toBe(false);
    const result = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Flustered Leap",
    });
    expect(result.ok).toBe(true);
  });
});
