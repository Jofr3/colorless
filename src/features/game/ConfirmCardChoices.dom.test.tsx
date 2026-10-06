// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GameState } from "@luminous/engine";
import { redactGame } from "@luminous/engine";
import { redactedGameSchema } from "@luminous/schema";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { driveSetup, typedEnergy } from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { OnlineHud } from "../online/components/OnlineHud";
import { GameHud } from "./GameHud";
import { projectGameState, projectionFromRedacted } from "./projection";

beforeAll(installDomShims);
afterEach(cleanup);

const NOTE = "Which Energy do you want to attach?";

function energyChoice(single = false): GameState {
  const state = driveSetup(170, undefined, { first: "p1" });
  return {
    ...state,
    cardPool: {
      ...state.cardPool,
      "fix-fire-energy": { ...typedEnergy("fix-fire-energy", "Fire"), image: "fire" },
      "fix-water-energy": { ...typedEnergy("fix-water-energy", "Water"), image: "water" },
    },
    cardIdByUid: {
      ...state.cardIdByUid,
      "chosen-fire": "fix-fire-energy",
      "chosen-water": "fix-water-energy",
    },
    phase: {
      kind: "effect:choose",
      seat: "p1",
      prompt: {
        kind: "confirm",
        note: NOTE,
        labels: {
          yes: "Attach Fire Energy",
          no: single ? "Keep it in your hand" : "Attach Water Energy",
        },
        cards: { yes: "chosen-fire", ...(single ? {} : { no: "chosen-water" }) },
      },
      cont: {
        // biome-ignore lint/suspicious/noThenProperty: effect branch, not a thenable.
        pendingOp: { op: "optional", note: NOTE, then: [] },
        rest: [],
        ctx: { seat: "p1" },
      },
    },
  };
}

describe.each(["local", "online"] as const)("%s Energy card choice", (surface) => {
  function show(single = false) {
    const state = energyChoice(single);
    const dispatch = vi.fn();
    const wire = redactedGameSchema.parse(redactGame(state, "p1"));
    expect(projectionFromRedacted(wire).pendingDecision).toEqual(
      projectGameState(state, "p1").pendingDecision,
    );
    render(
      surface === "local" ? (
        <GameHud
          game={state}
          projection={projectGameState(state, "p1")}
          viewerSeat="p1"
          names={{ p1: "You", p2: "Opponent" }}
          dispatch={dispatch}
          onPlayAgain={() => {}}
        />
      ) : (
        <OnlineHud game={wire} waitingOn="you" activePlaced onAction={dispatch} />
      ),
    );
    return dispatch;
  }

  it.each([
    { name: "Fire Energy", yes: true },
    { name: "Water Energy", yes: false },
  ])("shows both card faces and attaches $name when clicked", ({ name, yes }) => {
    const dispatch = show();
    expect(screen.getByRole("heading", { name: NOTE })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Fire Energy" }).tagName).toBe("IMG");
    expect(screen.getByRole("img", { name: "Water Energy" }).tagName).toBe("IMG");
    expect(screen.queryByRole("button", { name: "Attach Fire Energy" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes },
    });
  });

  it("keeps the decline available when only one Energy was found", () => {
    const dispatch = show(true);
    expect(screen.getAllByRole("img")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Keep it in your hand" }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: false },
    });
  });
});
