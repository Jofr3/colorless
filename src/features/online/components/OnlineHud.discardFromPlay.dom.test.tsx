// @vitest-environment jsdom
import type { GameAction } from "@luminous/engine";
import type { RedactedGame, RedactedInPlay, RedactedPhase } from "@luminous/schema";
import { redactedPhaseSchema } from "@luminous/schema";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import { OnlineHud } from "./OnlineHud";

// 🆕🆕🆕 D576 — the Antique Fossils' "At any time during your turn, you may discard this card from play."
// (R-FO3) on the ONLINE client: the server folds the offer (`turn:action.discardable`, the engine's
// `discardableTargets`), and this panel renders one row per offer, dispatching `discardFromPlay` with the
// spot VERBATIM. Two halves, D210's two links:
//   (1) a SOURCE SCAN — wire offer ⟺ a dispatch under `src/features/online` (the api half of the
//       biconditional is `match.test.ts`: allowlist ⟺ the wire offer);
//   (2) a RENDER — what the row does: the server's label, the exact payload, and NO row when the server
//       sends none (a client that grew rows off `board` would offer a discard the engine refuses).

beforeAll(installDomShims);
afterEach(cleanup);

const ONLINE_SOURCES = import.meta.glob<string>(["../**/*.ts", "../**/*.tsx", "!../**/*.test.*"], {
  query: "?raw",
  import: "default",
  eager: true,
});

function onlineDispatches(actionType: string): boolean {
  return Object.values(ONLINE_SOURCES).some((source) => source.includes(`"${actionType}"`));
}

function turnActionWireShape(): Record<string, unknown> {
  const arm = redactedPhaseSchema.options.find((option) => option.shape.kind.value === "turn:action");
  if (arm === undefined) throw new Error("the wire phase union has no turn:action arm");
  return arm.shape;
}

function inPlay(id: string, cardId: string, name: string): RedactedInPlay {
  return {
    id,
    cardId,
    name,
    category: "Pokemon",
    trainerType: null,
    hasImage: false,
    battle: { damage: 0, hp: 60, conditions: { rotation: "none", poisonDamage: 0, burned: false, confusionDamage: 30 } },
    attached: { tools: [], energies: [] },
  };
}

function turnAction(discardable: Extract<RedactedPhase, { kind: "turn:action" }>["discardable"]): RedactedPhase {
  return {
    kind: "turn:action",
    attacks: [],
    retreat: null,
    abilities: [],
    trainers: [],
    rareCandy: [],
    stadiumAbility: null,
    discardable,
  };
}

function game(phase: RedactedPhase): RedactedGame {
  const side: RedactedGame["board"]["you"] = {
    hand: [],
    active: inPlay("a1", "sv07-130", "Antique Root Fossil"),
    bench: [inPlay("b1", "sv07-129", "Antique Cover Fossil")],
    prizesRemaining: 6,
    faceUpPrizes: [],
    deckCount: 50,
    discard: [],
  };
  return {
    seat: "p1",
    turn: 3,
    phase,
    board: { stadium: null, you: { ...side }, opponent: { ...side } },
    activePlayer: "you",
    waitingOn: "you",
    outcome: null,
  };
}

function discardSection(): HTMLElement | null {
  const heading = screen.queryByText("Discard from play");
  return heading === null ? null : (heading.parentElement as HTMLElement);
}

describe("OnlineHud — the Antique Fossils' discard-from-play rows (D576, R-FO3)", () => {
  it("scans a real online surface, and offers `discardFromPlay` EXACTLY when the wire carries `discardable`", () => {
    expect(Object.keys(ONLINE_SOURCES).length).toBeGreaterThan(8);
    expect(onlineDispatches("useStadiumAbility")).toBe(true);
    expect(onlineDispatches("noSuchActionType")).toBe(false);
    expect(onlineDispatches("discardFromPlay")).toBe("discardable" in turnActionWireShape());
    expect("discardable" in turnActionWireShape()).toBe(true);
  });

  it("renders one row per SERVER offer, labelled by the server, and dispatches the spot verbatim with the seat", () => {
    const onAction = vi.fn<(action: GameAction) => void>();
    render(
      <OnlineHud
        game={game(
          turnAction([
            { target: { spot: "active" }, label: "Antique Root Fossil (Active)" },
            { target: { spot: "bench", index: 0 }, label: "Antique Cover Fossil (Bench 1)" },
          ]),
        )}
        waitingOn="you"
        activePlaced
        onAction={onAction}
      />,
    );
    const section = discardSection();
    expect(section).not.toBeNull();
    const buttons = within(section as HTMLElement).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Antique Root Fossil (Active)", "Antique Cover Fossil (Bench 1)"]);
    fireEvent.click(buttons[1] as HTMLElement);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]?.[0]).toEqual({
      type: "discardFromPlay",
      seat: "p1",
      target: { spot: "bench", index: 0 },
    });
  });

  it("renders NO section when the server offers none — even with fossils on the board", () => {
    render(<OnlineHud game={game(turnAction([]))} waitingOn="you" activePlaced onAction={() => {}} />);
    expect(discardSection()).toBeNull();
  });
});
